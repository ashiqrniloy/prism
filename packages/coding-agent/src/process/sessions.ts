/**
 * Managed ProcessSession registry — native spawn or optional sandbox startProcess.
 */
import { createHash, randomBytes } from "node:crypto";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { assertExecutionAllowed, ExecutionDeniedError } from "@arnilo/prism";
import { OutputAccumulator } from "../output-accumulator.js";
import { resolveToCwd } from "../path-utils.js";
import { killProcessTree } from "../shell.js";
import {
  type CodingProcessEvent,
  type CreateProcessSessionsOptions,
  type ProcessExitResult,
  type ProcessSandboxHandle,
  type ProcessSession,
  type ProcessSessionMetadata,
  type ProcessSessions,
  type ProcessSessionState,
  type ProcessStartRequest,
  ProcessSessionError,
  resolveProcessSessionLimits,
} from "./types.js";

function ownershipKey(ownership: CreateProcessSessionsOptions["ownership"], identity: CreateProcessSessionsOptions["identity"]): string {
  if (ownership) {
    return `${ownership.tenantId ?? ""}:${ownership.accountId ?? ""}:${ownership.userId ?? ""}`;
  }
  if (identity) {
    return `${identity.tenantId}:${identity.accountId ?? ""}:${identity.userId ?? ""}`;
  }
  return "default";
}

function commandFingerprint(command: string, args: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([command, ...args]))
    .digest("hex");
}

function isInsideRoot(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  if (to === from) return true;
  const rel = relative(from, to);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function nowIso(): string {
  return new Date().toISOString();
}

interface SessionRecord {
  id: string;
  owner: string;
  workspace: string;
  command: string;
  args: readonly string[];
  commandFingerprint: string;
  policyDecision: string;
  startedAt: string;
  exitedAt?: string;
  releaseOnCancel: boolean;
  expiresAt: number;
  state: ProcessSessionState;
  exitCode: number | null;
  child?: ChildProcessWithoutNullStreams;
  backend?: ProcessSandboxHandle;
  pid?: number;
  accumulator: OutputAccumulator;
  waiters: Array<(result: ProcessExitResult) => void>;
  stdinClosed: boolean;
  handle: ProcessSession;
}

export function createProcessSessions(options: CreateProcessSessionsOptions): ProcessSessions {
  const workspace = resolve(options.cwd);
  const limits = resolveProcessSessionLimits(options.limits);
  const defaultOwner = ownershipKey(options.ownership, options.identity);
  const policy = options.policy;
  const onEvent = options.onEvent;
  const sandbox = options.sandbox;
  const sessions = new Map<string, SessionRecord>();
  let disposed = false;
  let sandboxLost = false;

  const emit = (event: CodingProcessEvent): void => {
    onEvent?.(event);
  };

  const assertNotDisposed = (): void => {
    if (disposed) throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "process sessions disposed");
  };

  const reconcileAllUnknown = (): number => {
    let n = 0;
    for (const record of [...sessions.values()]) {
      if (record.state !== "running" && record.state !== "starting") continue;
      terminateRecord(record, "unknown", null);
      n += 1;
    }
    return n;
  };

  const checkSandboxAlive = async (): Promise<void> => {
    if (!sandbox?.status || sandboxLost) return;
    try {
      const status = await sandbox.status();
      if (status.state !== "running") {
        sandboxLost = true;
        reconcileAllUnknown();
      }
    } catch {
      sandboxLost = true;
      reconcileAllUnknown();
    }
  };

  const sweepExpired = (): void => {
    const now = Date.now();
    for (const record of sessions.values()) {
      if (record.state !== "running" && record.state !== "starting") continue;
      if (now < record.expiresAt) continue;
      terminateRecord(record, "expired", null);
    }
  };

  const settleWaiters = (record: SessionRecord): void => {
    const result: ProcessExitResult = { exitCode: record.exitCode, state: record.state };
    const waiters = record.waiters;
    record.waiters = [];
    for (const resolveWait of waiters) resolveWait(result);
  };

  const terminateRecord = (record: SessionRecord, state: ProcessSessionState, exitCode: number | null): void => {
    if (
      record.state === "exited" ||
      record.state === "killed" ||
      record.state === "released" ||
      record.state === "expired" ||
      record.state === "unknown"
    ) {
      return;
    }
    const child = record.child;
    const backend = record.backend;
    record.child = undefined;
    record.backend = undefined;
    if (state === "released") {
      try {
        child?.stdout.removeAllListeners();
        child?.stderr.removeAllListeners();
        child?.stdout.destroy();
        child?.stderr.destroy();
        child?.stdin.destroy();
        child?.unref();
      } catch {
        // best effort
      }
      void backend?.release().catch(() => undefined);
    } else if (state === "killed" || state === "expired" || state === "unknown") {
      if (child?.pid) {
        try {
          killProcessTree(child.pid);
        } catch {
          // best effort
        }
      }
      if (backend) {
        void backend.kill().catch(() => undefined);
      }
    } else if (state === "exited" && child) {
      try {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      } catch {
        // best effort
      }
    }
    record.state = state;
    record.exitCode = state === "unknown" || state === "released" ? null : exitCode;
    record.exitedAt = nowIso();
    record.stdinClosed = true;
    try {
      record.accumulator.finish();
    } catch {
      // ignore
    }
    settleWaiters(record);
    const type =
      state === "exited"
        ? "process_exited"
        : state === "killed"
          ? "process_killed"
          : state === "released"
            ? "process_released"
            : state === "expired"
              ? "process_expired"
              : "process_unknown";
    emit({
      type,
      sessionId: record.id,
      processId: record.pid !== undefined ? String(record.pid) : record.id,
      owner: record.owner,
      exitCode: record.exitCode,
      at: record.exitedAt,
    });
  };

  const assertPolicy = async (operation: string, command: string, args: readonly string[], cwd: string, owner: string): Promise<string> => {
    try {
      await assertExecutionAllowed(policy, {
        kind: "shell",
        operation,
        command,
        paths: [cwd],
        risk: "high",
        metadata: { args: [...args], owner },
      });
      return "allow";
    } catch (error) {
      const message =
        error instanceof ExecutionDeniedError
          ? (error.decision.reason ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", message);
    }
  };

  const requireRecord = (sessionId: string, owner?: string): SessionRecord => {
    assertNotDisposed();
    sweepExpired();
    const record = sessions.get(sessionId);
    if (!record) throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `unknown session: ${sessionId}`);
    if (owner !== undefined && owner !== record.owner) {
      throw new ProcessSessionError("ERR_PRISM_PROCESS_OWNERSHIP", "session owner mismatch");
    }
    return record;
  };

  const makeHandle = (record: SessionRecord): ProcessSession => {
    const assertAttached = (): void => {
      if (record.state === "released") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "session released");
      }
    };

    const handle: ProcessSession = {
      get id() {
        return record.id;
      },
      get state() {
        sweepExpired();
        void checkSandboxAlive();
        return record.state;
      },
      get owner() {
        return record.owner;
      },
      metadata(): ProcessSessionMetadata {
        sweepExpired();
        return {
          id: record.id,
          commandFingerprint: record.commandFingerprint,
          owner: record.owner,
          workspace: record.workspace,
          policyDecision: record.policyDecision,
          startedAt: record.startedAt,
          exitedAt: record.exitedAt,
          state: record.state,
          releaseOnCancel: record.releaseOnCancel,
        };
      },
      async output(request) {
        assertAttached();
        sweepExpired();
        await checkSandboxAlive();
        const cursor = request?.cursor ?? 0;
        const maxBytes = request?.maxBytes ?? limits.maxOutputChunkBytes;
        if (maxBytes > limits.maxOutputChunkBytes) {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `maxBytes exceeds maxOutputChunkBytes (${limits.maxOutputChunkBytes})`);
        }
        const { data, nextCursor } = record.accumulator.readRaw(cursor, maxBytes);
        const eof = record.state !== "running" && record.state !== "starting" && nextCursor >= record.accumulator.getTotalRawBytes();
        return { data: data.toString("utf8"), cursor: nextCursor, eof };
      },
      async input(data) {
        assertAttached();
        sweepExpired();
        await checkSandboxAlive();
        if (record.state !== "running") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot input in state ${record.state}`);
        }
        await assertPolicy("process_input", record.command, record.args, record.workspace, record.owner);
        const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
        if (buf.byteLength > limits.maxInputBytes) {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `input exceeds maxInputBytes (${limits.maxInputBytes})`);
        }
        if (record.backend) {
          await record.backend.write(buf);
          return;
        }
        if (record.stdinClosed || !record.child?.stdin.writable) {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "stdin closed");
        }
        await new Promise<void>((resolveWrite, rejectWrite) => {
          record.child!.stdin.write(buf, (err) => (err ? rejectWrite(err) : resolveWrite()));
        });
      },
      async wait(waitOptions) {
        assertAttached();
        sweepExpired();
        await checkSandboxAlive();
        if (record.state !== "running" && record.state !== "starting") {
          return { exitCode: record.exitCode, state: record.state };
        }
        return await new Promise<ProcessExitResult>((resolveWait, rejectWait) => {
          const onDone = (result: ProcessExitResult) => {
            cleanup();
            resolveWait(result);
          };
          const onAbort = () => {
            cleanup();
            rejectWait(new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "wait aborted"));
          };
          let timer: NodeJS.Timeout | undefined;
          const cleanup = () => {
            if (timer) clearTimeout(timer);
            waitOptions?.signal?.removeEventListener("abort", onAbort);
            const idx = record.waiters.indexOf(onDone);
            if (idx >= 0) record.waiters.splice(idx, 1);
          };
          record.waiters.push(onDone);
          if (waitOptions?.timeoutMs !== undefined) {
            timer = setTimeout(() => {
              cleanup();
              rejectWait(new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", "wait timed out"));
            }, waitOptions.timeoutMs);
          }
          if (waitOptions?.signal) {
            if (waitOptions.signal.aborted) onAbort();
            else waitOptions.signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      },
      async signal(name) {
        assertAttached();
        sweepExpired();
        await checkSandboxAlive();
        if (record.state !== "running") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot signal in state ${record.state}`);
        }
        await assertPolicy("process_signal", record.command, record.args, record.workspace, record.owner);
        if (record.backend) {
          await record.backend.signal(name);
          return;
        }
        if (!record.pid) throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "process has no pid");
        try {
          process.kill(-record.pid, name);
        } catch {
          try {
            process.kill(record.pid, name);
          } catch (error) {
            throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", error instanceof Error ? error.message : String(error));
          }
        }
      },
      async kill() {
        assertAttached();
        sweepExpired();
        await checkSandboxAlive();
        if (record.state !== "running" && record.state !== "starting") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot kill in state ${record.state}`);
        }
        await assertPolicy("process_kill", record.command, record.args, record.workspace, record.owner);
        if (record.backend) {
          try {
            await record.backend.kill();
          } catch {
            // still mark killed
          }
        }
        terminateRecord(record, "killed", null);
      },
      async release() {
        assertAttached();
        sweepExpired();
        if (record.state !== "running" && record.state !== "starting") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot release in state ${record.state}`);
        }
        if (record.backend) {
          try {
            await record.backend.release();
          } catch {
            // still mark released
          }
        }
        terminateRecord(record, "released", null);
      },
    };
    return handle;
  };

  return {
    async start(request: ProcessStartRequest): Promise<ProcessSession> {
      assertNotDisposed();
      sweepExpired();
      await checkSandboxAlive();

      if (request.pty) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_UNSUPPORTED", "PTY not supported on this host");
      }
      if (!request.command || typeof request.command !== "string") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", "command required");
      }

      if (sandbox && typeof sandbox.startProcess !== "function") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_UNSUPPORTED", "sandbox adapter does not support startProcess");
      }
      if (sandboxLost) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_UNSUPPORTED", "sandbox lost; cannot start process");
      }

      const active = [...sessions.values()].filter((s) => s.state === "running" || s.state === "starting").length;
      if (active >= limits.maxSessions) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `maxSessions (${limits.maxSessions}) reached`);
      }

      const cwdInput = request.cwd ?? ".";
      const cwd = resolveToCwd(cwdInput, workspace);
      if (!isInsideRoot(workspace, cwd)) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", "cwd escapes workspace root");
      }

      const args = request.args ?? [];
      const owner = request.owner ?? defaultOwner;
      const lifetimeMs = request.lifetimeMs ?? limits.maxLifetimeMs;
      if (lifetimeMs > limits.maxLifetimeMs) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `lifetimeMs exceeds maxLifetimeMs (${limits.maxLifetimeMs})`);
      }

      const policyDecision = await assertPolicy("process_start", request.command, args, cwd, owner);

      const id = `proc_${randomBytes(8).toString("hex")}`;
      const accumulator = new OutputAccumulator({
        maxBytes: limits.maxOutputChunkBytes,
        maxLines: 100_000,
        maxTotalOutputBytes: limits.maxTotalOutputBytes,
        tempFilePrefix: "prism-proc",
      });

      const record: SessionRecord = {
        id,
        owner,
        workspace,
        command: request.command,
        args,
        commandFingerprint: commandFingerprint(request.command, args),
        policyDecision,
        startedAt: nowIso(),
        releaseOnCancel: request.releaseOnCancel === true,
        expiresAt: Date.now() + lifetimeMs,
        state: "starting",
        exitCode: null,
        accumulator,
        waiters: [],
        stdinClosed: false,
        handle: null as unknown as ProcessSession,
      };
      record.handle = makeHandle(record);
      sessions.set(id, record);

      const onData = (buf: Buffer) => {
        accumulator.append(buf);
      };

      try {
        if (sandbox?.startProcess) {
          const handle = await sandbox.startProcess({
            file: request.command,
            args,
            cwd,
            env: request.env,
            onData,
          });
          record.backend = handle;
          record.state = "running";
          void handle
            .wait()
            .then((result) => {
              if (record.state !== "running" && record.state !== "starting") return;
              terminateRecord(record, "exited", result.exitCode);
            })
            .catch(() => {
              if (record.state !== "running" && record.state !== "starting") return;
              terminateRecord(record, "unknown", null);
            });
        } else {
          const env = { ...process.env, ...(request.env ?? {}) };
          const child = spawn(request.command, [...args], {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
            detached: process.platform !== "win32",
            windowsHide: true,
          }) as ChildProcessWithoutNullStreams;
          record.child = child;
          record.pid = child.pid;
          record.state = "running";
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.stdin.on("close", () => {
            record.stdinClosed = true;
          });
          child.on("error", () => {
            terminateRecord(record, "unknown", null);
          });
          child.on("exit", (code, signal) => {
            if (record.state !== "running" && record.state !== "starting") return;
            if (signal) terminateRecord(record, "killed", code);
            else terminateRecord(record, "exited", code);
          });
        }
      } catch (error) {
        sessions.delete(id);
        throw new ProcessSessionError("ERR_PRISM_PROCESS_UNSUPPORTED", error instanceof Error ? error.message : String(error));
      }

      emit({
        type: "process_started",
        sessionId: id,
        processId: record.pid !== undefined ? String(record.pid) : id,
        owner,
        at: record.startedAt,
      });

      return record.handle;
    },

    get(sessionId: string, owner?: string): ProcessSession {
      return requireRecord(sessionId, owner).handle;
    },

    async cancelOwned(owner: string, cancelOptions?: { release?: boolean }): Promise<void> {
      assertNotDisposed();
      sweepExpired();
      await checkSandboxAlive();
      const release = cancelOptions?.release === true;
      for (const record of [...sessions.values()]) {
        if (record.owner !== owner) continue;
        if (record.state !== "running" && record.state !== "starting") continue;
        if (release || record.releaseOnCancel) {
          if (record.backend) {
            try {
              await record.backend.release();
            } catch {
              // continue
            }
          }
          terminateRecord(record, "released", null);
        } else {
          if (record.backend) {
            try {
              await record.backend.kill();
            } catch {
              // continue
            }
          }
          terminateRecord(record, "killed", null);
        }
      }
    },

    async markUnknown(sessionId: string, owner?: string): Promise<void> {
      const record = requireRecord(sessionId, owner);
      if (record.state !== "running" && record.state !== "starting") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot mark unknown in state ${record.state}`);
      }
      terminateRecord(record, "unknown", null);
    },

    async reconcile(): Promise<{ readonly markedUnknown: number }> {
      assertNotDisposed();
      const markedUnknown = reconcileAllUnknown();
      return { markedUnknown };
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      for (const record of [...sessions.values()]) {
        if (record.state === "running" || record.state === "starting") {
          if (record.backend) {
            try {
              await record.backend.kill();
            } catch {
              // best effort
            }
          }
          terminateRecord(record, "killed", null);
        } else if (record.state === "released" && record.pid) {
          try {
            killProcessTree(record.pid);
          } catch {
            // best effort
          }
          record.pid = undefined;
        }
        try {
          await record.accumulator.cleanupTempFile();
        } catch {
          // best effort
        }
      }
      sessions.clear();
    },
  };
}
