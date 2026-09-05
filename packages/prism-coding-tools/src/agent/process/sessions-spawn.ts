/**
 * Spawn / attach a managed process session (native, sandbox, or PTY).
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { assertExecutionAllowed, ExecutionDeniedError } from "@arnilo/prism";
import { buildChildEnv, DEFAULT_CHILD_ENV_INHERIT } from "../env.js";
import { OutputAccumulator } from "../output-accumulator.js";
import { resolveToCwd } from "../path-utils.js";
import {
  acquireRecordLease,
  buildProcessRecoveryRecord,
  deleteProcessRecoveryRecord,
  ProcessRecoveryError,
  releaseRecordLease,
  saveProcessRecoveryRecord,
  validateBackendRef,
} from "./recovery.js";
import {
  assertNotDisposed,
  commandFingerprint,
  emit,
  isInsideRoot,
  nowIso,
  resolveTerminal,
  type SessionRecord,
  type SessionsHost,
} from "./sessions-host.js";
import { persistTransition } from "./sessions-monitor.js";
import { checkSandboxAlive, sweepExpired, terminateRecord } from "./sessions-teardown.js";
import {
  type ProcessExitResult,
  type ProcessSession,
  ProcessSessionError,
  type ProcessSessionMetadata,
  type ProcessStartRequest,
} from "./types.js";

/**
 * Start-budget for host PTY attachment (frozen cap). Timeout fails closed with
 * ERR_PRISM_PROCESS_PTY_LIMIT; the underlying promise result is discarded.
 */
function withPtyAttachTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `PTY attach timed out (${timeoutMs}ms)`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function assertPolicy(
  host: SessionsHost,
  operation: string,
  command: string,
  args: readonly string[],
  cwd: string,
  owner: string,
): Promise<string> {
  try {
    await assertExecutionAllowed(host.policy, {
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
}

export function makeHandle(host: SessionsHost, record: SessionRecord): ProcessSession {
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
      sweepExpired(host);
      void checkSandboxAlive(host);
      return record.state;
    },
    get owner() {
      return record.owner;
    },
    metadata(): ProcessSessionMetadata {
      sweepExpired(host);
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
        pty: record.ptyTerminal !== undefined,
        terminal: record.ptyTerminal,
        ptyBackendMetadata: record.pty?.metadata,
      };
    },
    async output(request) {
      assertAttached();
      sweepExpired(host);
      await checkSandboxAlive(host);
      const cursor = request?.cursor ?? 0;
      const maxBytes = request?.maxBytes ?? host.limits.maxOutputChunkBytes;
      if (maxBytes > host.limits.maxOutputChunkBytes) {
        throw new ProcessSessionError(
          "ERR_PRISM_PROCESS_LIMIT",
          `maxBytes exceeds maxOutputChunkBytes (${host.limits.maxOutputChunkBytes})`,
        );
      }
      const { data, nextCursor } = record.accumulator.readRaw(cursor, maxBytes);
      const eof = record.state !== "running" && record.state !== "starting" && nextCursor >= record.accumulator.getTotalRawBytes();
      return { data: data.toString("utf8"), cursor: nextCursor, eof };
    },
    async input(data) {
      assertAttached();
      sweepExpired(host);
      await checkSandboxAlive(host);
      if (record.state !== "running") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot input in state ${record.state}`);
      }
      await assertPolicy(host, "process_input", record.command, record.args, record.workspace, record.owner);
      const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      if (buf.byteLength > host.limits.maxInputBytes) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `input exceeds maxInputBytes (${host.limits.maxInputBytes})`);
      }
      if (record.pty) {
        if (buf.includes(0)) {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", "NUL bytes are not permitted in PTY input");
        }
        await record.pty.write(buf);
        return;
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
      sweepExpired(host);
      await checkSandboxAlive(host);
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
      sweepExpired(host);
      await checkSandboxAlive(host);
      if (record.state !== "running") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot signal in state ${record.state}`);
      }
      await assertPolicy(host, "process_signal", record.command, record.args, record.workspace, record.owner);
      if (record.pty) {
        await record.pty.signal(name);
        return;
      }
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
      sweepExpired(host);
      await checkSandboxAlive(host);
      if (record.state !== "running" && record.state !== "starting") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot kill in state ${record.state}`);
      }
      await assertPolicy(host, "process_kill", record.command, record.args, record.workspace, record.owner);
      const ptyHandle = record.pty;
      const backendHandle = record.backend;
      // Mark terminal synchronously FIRST: a backend kill may resolve the
      // wait() promise, whose handler must not race into a fabricated
      // 'exited' before the kill is recorded. The explicit call below is
      // the existing parity double-kill; its result is ignored.
      if (ptyHandle || backendHandle) {
        terminateRecord(host, record, "killed", null);
        if (ptyHandle) {
          try {
            await ptyHandle.kill();
          } catch {
            // still marked killed
          }
        } else {
          try {
            await backendHandle!.kill();
          } catch {
            // still marked killed
          }
        }
        return;
      }
      terminateRecord(host, record, "killed", null);
    },
    async release() {
      assertAttached();
      sweepExpired(host);
      if (record.state !== "running" && record.state !== "starting") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot release in state ${record.state}`);
      }
      const ptyRelease = record.pty;
      const backendRelease = record.backend;
      if (ptyRelease || backendRelease) {
        terminateRecord(host, record, "released", null);
        if (ptyRelease) {
          try {
            await ptyRelease.release();
          } catch {
            // still marked released
          }
        } else {
          try {
            await backendRelease!.release();
          } catch {
            // still marked released
          }
        }
        return;
      }
      terminateRecord(host, record, "released", null);
    },
  };
  if (host.ptyResizeCapable) {
    handle.resize = async (dimensions) => {
      assertAttached();
      sweepExpired(host);
      await checkSandboxAlive(host);
      if (record.state !== "running") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot resize in state ${record.state}`);
      }
      const columns = dimensions.columns;
      const rows = dimensions.rows;
      if (!Number.isSafeInteger(columns) || columns < 1 || columns > host.limits.maxTerminalColumns) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `columns must be 1..${host.limits.maxTerminalColumns}`);
      }
      if (!Number.isSafeInteger(rows) || rows < 1 || rows > host.limits.maxTerminalRows) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `rows must be 1..${host.limits.maxTerminalRows}`);
      }
      if (!record.pty || typeof record.pty.resize !== "function") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "session does not support resize");
      }
      const now = Date.now();
      record.ptyResizeAt = record.ptyResizeAt.filter((t) => now - t < 60_000);
      if (record.ptyResizeAt.length >= host.limits.maxTerminalResizesPerMinute) {
        throw new ProcessSessionError(
          "ERR_PRISM_PROCESS_PTY_LIMIT",
          `resize rate exceeds maxTerminalResizesPerMinute (${host.limits.maxTerminalResizesPerMinute})`,
        );
      }
      await assertPolicy(host, "process_resize", record.command, record.args, record.workspace, record.owner);
      record.ptyResizeAt.push(now);
      try {
        await record.pty.resize({ columns, rows });
      } catch {
        terminateRecord(host, record, "unknown", null);
        throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_BACKEND", "PTY backend resize failed");
      }
      record.ptyTerminal = { ...record.ptyTerminal!, columns, rows };
    };
  }
  return handle;
}

export async function startSession(host: SessionsHost, request: ProcessStartRequest): Promise<ProcessSession> {
  assertNotDisposed(host);
  sweepExpired(host);
  await checkSandboxAlive(host);

  if (request.pty && (!host.ptyBackend || typeof host.ptyBackend.startPty !== "function")) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_UNSUPPORTED", "PTY not supported on this host");
  }
  if (!request.command || typeof request.command !== "string") {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", "command required");
  }
  const ptyTerminal = request.pty ? resolveTerminal(host, request.terminal) : undefined;

  if (host.sandbox && typeof host.sandbox.startProcess !== "function") {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_UNSUPPORTED", "sandbox adapter does not support startProcess");
  }
  if (host.sandboxLost) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_UNSUPPORTED", "sandbox lost; cannot start process");
  }

  const active = [...host.sessions.values()].filter((s) => s.state === "running" || s.state === "starting").length;
  if (active >= host.limits.maxSessions) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `maxSessions (${host.limits.maxSessions}) reached`);
  }

  const cwdInput = request.cwd ?? ".";
  const cwd = resolveToCwd(cwdInput, host.workspace);
  if (!isInsideRoot(host.workspace, cwd)) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", "cwd escapes workspace root");
  }

  const args = request.args ?? [];
  const owner = request.owner ?? host.defaultOwner;
  const lifetimeMs = request.lifetimeMs ?? host.limits.maxLifetimeMs;
  if (lifetimeMs > host.limits.maxLifetimeMs) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_LIMIT", `lifetimeMs exceeds maxLifetimeMs (${host.limits.maxLifetimeMs})`);
  }

  const policyDecision = await assertPolicy(host, "process_start", request.command, args, cwd, owner);

  const id = `proc_${randomBytes(8).toString("hex")}`;
  const accumulator = new OutputAccumulator({
    maxBytes: host.limits.maxOutputChunkBytes,
    maxLines: 100_000,
    maxTotalOutputBytes: host.limits.maxTotalOutputBytes,
    tempFilePrefix: "prism-proc",
  });

  const record: SessionRecord = {
    id,
    owner,
    workspace: host.workspace,
    command: request.command,
    args,
    commandFingerprint: commandFingerprint(request.command, args),
    policyDecision,
    startedAt: nowIso(),
    releaseOnCancel: request.releaseOnCancel === true,
    expiresAt: Date.now() + lifetimeMs,
    state: "starting",
    exitCode: null,
    ptyTerminal,
    ptyResizeAt: [],
    accumulator,
    waiters: [],
    stdinClosed: false,
    handle: null as unknown as ProcessSession,
    recoveryFencingToken: 0,
    recoveryVersion: 0,
  };
  record.handle = makeHandle(host, record);
  host.sessions.set(id, record);

  // Durable recovery: intent is persisted BEFORE spawn. The per-record lease
  // fences replica coordination; the fencing token is stored in the record
  // so every later CAS write is monotonic. On any write/fence failure the
  // start fails closed (record removed, no half-durable process).
  let recoveryLease: { token: string } | undefined;
  if (host.durable) {
    const lease = await acquireRecordLease({
      leases: host.leases!,
      id,
      ownerId: host.ownerId!,
      ttlMs: host.recoveryLimits.leaseTtlMs,
      ownership: host.ownership,
      signal: request.signal,
    });
    if (!lease) {
      host.sessions.delete(id);
      throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_FENCE", "recovery lease for new session is held by another replica");
    }
    recoveryLease = { token: lease.token };
    record.recoveryLeaseToken = lease.token;
    record.recoveryFencingToken = lease.fencingToken;
    const intent = buildProcessRecoveryRecord({
      id,
      owner,
      workspace: host.workspace,
      command: request.command,
      args,
      commandFingerprint: commandFingerprint(request.command, args),
      policyDecision,
      startedAt: record.startedAt,
      state: "starting",
      exitCode: null,
      releaseOnCancel: record.releaseOnCancel,
      expiresAt: record.expiresAt,
      ...(ptyTerminal !== undefined ? { pty: ptyTerminal } : {}),
      fencingToken: lease.fencingToken,
    });
    const saved = await saveProcessRecoveryRecord({
      checkpoints: host.checkpoints!,
      record: intent,
      expectedVersion: 0,
      version: 1,
      ownership: host.ownership,
      signal: request.signal,
    });
    record.recoveryVersion = saved.version;
  }

  const onData = (buf: Buffer) => {
    // PTY hosts can deliver trailing bytes after the session already went
    // terminal (host wait() resolving ahead of the last pty drain); ignore
    // them instead of appending to a finished accumulator.
    if (record.state === "running" || record.state === "starting") {
      accumulator.append(buf);
    }
  };

  try {
    if (request.pty) {
      try {
        const handle = await withPtyAttachTimeout(
          host.ptyBackend!.startPty!({
            file: request.command,
            args,
            cwd,
            env: request.env,
            columns: ptyTerminal!.columns,
            rows: ptyTerminal!.rows,
            term: ptyTerminal!.term,
            onData,
          }),
          host.limits.maxPtyAttachTimeoutMs,
        );
        const metadataJson = handle.metadata !== undefined ? JSON.stringify(handle.metadata) : undefined;
        if (metadataJson !== undefined && Buffer.byteLength(metadataJson, "utf8") > host.limits.maxPtyBackendMetadataBytes) {
          throw new ProcessSessionError(
            "ERR_PRISM_PROCESS_PTY_LIMIT",
            `pty backend metadata exceeds maxPtyBackendMetadataBytes (${host.limits.maxPtyBackendMetadataBytes})`,
          );
        }
        if (handle.ref !== undefined) record.backendRef = validateBackendRef(handle.ref, host.recoveryLimits);
        record.pty = handle;
        record.state = "running";
        persistTransition(host, record);
        void handle
          .wait()
          .then((result) => {
            if (record.state !== "running" && record.state !== "starting") return;
            terminateRecord(host, record, "exited", result.exitCode);
          })
          .catch(() => {
            if (record.state !== "running" && record.state !== "starting") return;
            terminateRecord(host, record, "unknown", null);
          });
      } catch (error) {
        host.sessions.delete(id);
        if (error instanceof ProcessSessionError) throw error;
        if (error instanceof ProcessRecoveryError) throw error;
        throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_BACKEND", "PTY backend failed to start");
      }
    } else if (host.sandbox?.startProcess) {
      const handle = await host.sandbox.startProcess({
        file: request.command,
        args,
        cwd,
        env: request.env,
        onData,
      });
      if (handle.ref !== undefined) record.backendRef = validateBackendRef(handle.ref, host.recoveryLimits);
      record.backend = handle;
      record.state = "running";
      persistTransition(host, record);
      void handle
        .wait()
        .then((result) => {
          if (record.state !== "running" && record.state !== "starting") return;
          terminateRecord(host, record, "exited", result.exitCode);
        })
        .catch(() => {
          if (record.state !== "running" && record.state !== "starting") return;
          terminateRecord(host, record, "unknown", null);
        });
    } else {
      const env = buildChildEnv({ inherit: DEFAULT_CHILD_ENV_INHERIT, set: request.env }); // allow-list; never pass process.env through
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
        terminateRecord(host, record, "unknown", null);
      });
      child.on("exit", (code, signal) => {
        if (record.state !== "running" && record.state !== "starting") return;
        if (signal) terminateRecord(host, record, "killed", code);
        else terminateRecord(host, record, "exited", code);
      });
      persistTransition(host, record);
    }
  } catch (error) {
    host.sessions.delete(id);
    if (host.durable) {
      // No half-durable process: drop the intent/running record and release
      // the recovery lease. The host store is authoritative.
      await deleteProcessRecoveryRecord({ checkpoints: host.checkpoints!, id, ownership: host.ownership, signal: request.signal });
      if (recoveryLease) {
        await releaseRecordLease({
          leases: host.leases!,
          id,
          ownerId: host.ownerId!,
          token: recoveryLease.token,
          ownership: host.ownership,
          signal: request.signal,
        });
      }
    }
    if (error instanceof ProcessSessionError) throw error;
    if (error instanceof ProcessRecoveryError) throw error;
    throw new ProcessSessionError("ERR_PRISM_PROCESS_UNSUPPORTED", error instanceof Error ? error.message : String(error));
  }

  emit(host, {
    type: "process_started",
    sessionId: id,
    processId: record.pid !== undefined ? String(record.pid) : id,
    owner,
    at: record.startedAt,
  });

  return record.handle;
}
