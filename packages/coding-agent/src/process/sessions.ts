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
  type ProcessPtyHandle,
  type ProcessSandboxHandle,
  type ProcessSession,
  type ProcessSessionMetadata,
  type ProcessSessions,
  type ProcessSessionState,
  type ProcessStartRequest,
  type ProcessTerminalRequest,
  ProcessSessionError,
  resolveProcessSessionLimits,
} from "./types.js";
import {
  type ProcessRecoveryRecord,
  type ProcessRecoveryRecordReport,
  type ProcessRecoveryReport,
  acquireRecordLease,
  attachWithTimeout,
  buildProcessRecoveryRecord,
  deleteProcessRecoveryRecord,
  loadProcessRecoveryRecord,
  loadProcessRecoveryRecords,
  PROCESS_RECOVERY_LEASE_NAMESPACE,
  releaseRecordLease,
  resolveProcessRecoveryLimits,
  saveProcessRecoveryRecord,
  validateBackendRef,
} from "./recovery.js";
import { ProcessRecoveryError } from "./recovery.js";
import {
  DEFAULT_MAX_TERMINAL_COLUMNS,
  DEFAULT_MAX_TERMINAL_ROWS,
} from "../limits.js";

/** Default TERM for PTY sessions (validated <= maxTerminalTermBytes). */
const DEFAULT_TERM = "xterm-256color";

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
  pty?: ProcessPtyHandle;
  ptyTerminal?: { columns: number; rows: number; term: string };
  ptyResizeAt: number[];
  pid?: number;
  accumulator: OutputAccumulator;
  waiters: Array<(result: ProcessExitResult) => void>;
  stdinClosed: boolean;
  handle: ProcessSession;
  /** Durable recovery bookkeeping (plan 026 Task 5); absent when durability is not configured. */
  backendRef?: string;
  recoveryFencingToken: number;
  recoveryVersion: number;
  /** Opaque lease claim token for renewal/release; never serialized, memory only. */
  recoveryLeaseToken?: string;
  /** Serializes durable transition writes per record so CAS order never inverts on slow stores. */
  recoveryWriteChain?: Promise<void>;
}

export function createProcessSessions(options: CreateProcessSessionsOptions): ProcessSessions {
  const workspace = resolve(options.cwd);
  const limits = resolveProcessSessionLimits(options.limits);
  const defaultOwner = ownershipKey(options.ownership, options.identity);
  const policy = options.policy;
  const onEvent = options.onEvent;
  const sandbox = options.sandbox;
  const ptyBackend = options.ptyBackend;
  const ptyResizeCapable = ptyBackend?.capabilities?.resize === true;
  const sessions = new Map<string, SessionRecord>();
  let disposed = false;
  let sandboxLost = false;

  // Durable process recovery (plan 026 Task 5): checkpoints + leases + ownerId
  // activate the seam together; a partial recovery configuration fails closed
  // at construction (no implicit activation, no half-durable state).
  const checkpoints = options.checkpoints;
  const leases = options.leases;
  const ownerId = options.ownerId;
  const recoveryBackend = options.recoveryBackend;
  const recoveryLimits = resolveProcessRecoveryLimits(options.recoveryLimits);
  const durable =
    checkpoints !== undefined || leases !== undefined || ownerId !== undefined || recoveryBackend !== undefined;
  if (durable && !(checkpoints && leases && ownerId)) {
    throw new ProcessRecoveryError(
      "ERR_PRISM_RECOVERY_UNSUPPORTED",
      "durable process recovery requires checkpoints, leases, and ownerId together",
    );
  }

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

  const resolveTerminal = (terminal: ProcessTerminalRequest | undefined): { columns: number; rows: number; term: string } => {
    const columns = terminal?.columns ?? Math.min(DEFAULT_MAX_TERMINAL_COLUMNS, limits.maxTerminalColumns);
    const rows = terminal?.rows ?? Math.min(DEFAULT_MAX_TERMINAL_ROWS, limits.maxTerminalRows);
    const term = terminal?.term ?? DEFAULT_TERM;
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > limits.maxTerminalColumns) {
      throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `columns must be 1..${limits.maxTerminalColumns}`);
    }
    if (!Number.isSafeInteger(rows) || rows < 1 || rows > limits.maxTerminalRows) {
      throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `rows must be 1..${limits.maxTerminalRows}`);
    }
    if (Buffer.byteLength(term, "utf8") > limits.maxTerminalTermBytes) {
      throw new ProcessSessionError(
        "ERR_PRISM_PROCESS_PTY_LIMIT",
        `term exceeds maxTerminalTermBytes (${limits.maxTerminalTermBytes})`,
      );
    }
    return { columns, rows, term };
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

  // Durable transition write: fire-and-forget CAS (fence/version conflicts mean
  // another replica moved the record first — the newer state wins). The crash
  // window between a terminal transition and its durable write converges on
  // recovery to attach/terminal/unknown, never a duplicate spawn.
  const persistTransition = (record: SessionRecord): void => {
    if (!durable || record.recoveryVersion === 0) return;
    const next = buildProcessRecoveryRecord({
      id: record.id,
      owner: record.owner,
      workspace: record.workspace,
      command: record.command,
      args: record.args,
      commandFingerprint: record.commandFingerprint,
      policyDecision: record.policyDecision,
      startedAt: record.startedAt,
      state: record.state,
      exitCode: record.exitCode,
      releaseOnCancel: record.releaseOnCancel,
      expiresAt: record.expiresAt,
      ...(record.backendRef !== undefined ? { backendRef: record.backendRef } : {}),
      ...(record.ptyTerminal !== undefined ? { pty: record.ptyTerminal } : {}),
      fencingToken: record.recoveryFencingToken,
    });
    const expectedVersion = record.recoveryVersion;
    record.recoveryVersion += 1;
    const write = async (): Promise<void> => {
      try {
        await saveProcessRecoveryRecord({
          checkpoints: checkpoints!,
          record: next,
          expectedVersion,
          version: record.recoveryVersion,
          ownership: options.ownership,
        });
      } catch {
        // stale fence or store failure: the durable record keeps its last state
        return;
      }
      void evictRecoveryOverflow();
      // Terminal transition: release the record lease (clean shutdown makes
      // recovery immediate). Live running/starting transitions renew it so a
      // crashed replica's lease lapses within TTL while a live one stays
      // fenced. Best effort on both.
      if (isTerminalState(record.state)) {
        if (record.recoveryLeaseToken) {
          void releaseRecordLease({
            leases: leases!,
            id: record.id,
            ownerId: ownerId!,
            token: record.recoveryLeaseToken,
            ownership: options.ownership,
          });
          record.recoveryLeaseToken = undefined;
        }
      } else if (record.recoveryLeaseToken) {
        void leases!
          .renewLease({
            namespace: PROCESS_RECOVERY_LEASE_NAMESPACE,
            key: `recover:${record.id}`,
            ownerId: ownerId!,
            token: record.recoveryLeaseToken,
            ttlMs: recoveryLimits.leaseTtlMs,
            ...options.ownership,
          })
          .catch(() => {
            // lease lapsed or fenced elsewhere; recovery is attestation-gated
          });
      }
    };
    // Per-record chain: transition CAS writes must never invert order on slow
    // stores (a later terminal write landing before the running write would
    // fail its CAS and leave the record running forever).
    record.recoveryWriteChain = (record.recoveryWriteChain ?? Promise.resolve()).then(write, write);
  };

  // Bound durable record growth: after a terminal transition, drop the oldest
  // terminal records until at most maxRecords remain (running/starting records
  // are never evicted). Best effort, bounded work.
  const evictRecoveryOverflow = async (): Promise<void> => {
    if (!durable) return;
    try {
      const page = await loadProcessRecoveryRecords({ checkpoints: checkpoints!, limits: { ...recoveryLimits, maxRecords: recoveryLimits.maxRecords + 1 }, ownership: options.ownership });
      if (page.records.length <= recoveryLimits.maxRecords) return;
      const overflow = page.records.length - recoveryLimits.maxRecords;
      let evicted = 0;
      for (const { record } of [...page.records].reverse()) {
        if (evicted >= overflow) break;
        if (record.state === "running" || record.state === "starting") continue;
        await deleteProcessRecoveryRecord({ checkpoints: checkpoints!, id: record.id, ownership: options.ownership });
        evicted += 1;
      }
    } catch {
      // best effort: caps are enforced again on the next transition
    }
  };

  const isTerminalState = (state: ProcessSessionState): boolean =>
    state === "exited" || state === "killed" || state === "released" || state === "expired" || state === "unknown";

  // Atomic starting|running -> unknown (never an exit code). Returns false when
  // a fence/version conflict means another replica moved the record first.
  const persistRecoveryUnknown = async (
    current: ProcessRecoveryRecord,
    version: number,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const next = buildProcessRecoveryRecord({ ...current, state: "unknown", exitCode: null, updatedAt: nowIso() });
    try {
      await saveProcessRecoveryRecord({
        checkpoints: checkpoints!,
        record: next,
        expectedVersion: version,
        version: version + 1,
        ownership: options.ownership,
        signal,
      });
      return true;
    } catch {
      return false;
    }
  };

  // Reattach an attested handle into the live registry. Recovered sessions
  // expose control (input/signal/kill/release/resize/wait) through the handle;
  // output streaming is not re-established after a restart — the host backend
  // owns any buffered output behind its opaque ref.
  const attachRecoveredHandle = (current: ProcessRecoveryRecord, handle: ProcessPtyHandle | ProcessSandboxHandle, version: number): void => {
    const accumulator = new OutputAccumulator({
      maxBytes: limits.maxOutputChunkBytes,
      maxLines: 100_000,
      maxTotalOutputBytes: limits.maxTotalOutputBytes,
      tempFilePrefix: "prism-proc",
    });
    const record: SessionRecord = {
      id: current.id,
      owner: current.owner,
      workspace: current.workspace,
      command: current.command,
      args: current.args,
      commandFingerprint: current.commandFingerprint,
      policyDecision: current.policyDecision,
      startedAt: current.startedAt,
      releaseOnCancel: current.releaseOnCancel,
      expiresAt: current.expiresAt,
      state: "running",
      exitCode: null,
      ptyTerminal: current.pty,
      ptyResizeAt: [],
      accumulator,
      waiters: [],
      stdinClosed: false,
      handle: null as unknown as ProcessSession,
      backendRef: current.backendRef,
      recoveryFencingToken: current.fencingToken,
      recoveryVersion: version,
    };
    if (current.pty !== undefined) {
      record.pty = handle as ProcessPtyHandle;
    } else {
      record.backend = handle as ProcessSandboxHandle;
    }
    record.handle = makeHandle(record);
    sessions.set(record.id, record);
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
    const pty = record.pty;
    record.child = undefined;
    record.backend = undefined;
    record.pty = undefined;
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
      void pty?.release().catch(() => undefined);
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
      if (pty) {
        void pty.kill().catch(() => undefined);
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
    persistTransition(record);
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
          pty: record.ptyTerminal !== undefined,
          terminal: record.ptyTerminal,
          ptyBackendMetadata: record.pty?.metadata,
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
        sweepExpired();
        await checkSandboxAlive();
        if (record.state !== "running" && record.state !== "starting") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot kill in state ${record.state}`);
        }
        await assertPolicy("process_kill", record.command, record.args, record.workspace, record.owner);
        const ptyHandle = record.pty;
        const backendHandle = record.backend;
        // Mark terminal synchronously FIRST: a backend kill may resolve the
        // wait() promise, whose handler must not race into a fabricated
        // 'exited' before the kill is recorded. The explicit call below is
        // the existing parity double-kill; its result is ignored.
        if (ptyHandle || backendHandle) {
          terminateRecord(record, "killed", null);
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
        terminateRecord(record, "killed", null);
      },
      async release() {
        assertAttached();
        sweepExpired();
        if (record.state !== "running" && record.state !== "starting") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot release in state ${record.state}`);
        }
        const ptyRelease = record.pty;
        const backendRelease = record.backend;
        if (ptyRelease || backendRelease) {
          terminateRecord(record, "released", null);
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
        terminateRecord(record, "released", null);
      },
    };
    if (ptyResizeCapable) {
      handle.resize = async (dimensions) => {
        assertAttached();
        sweepExpired();
        await checkSandboxAlive();
        if (record.state !== "running") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot resize in state ${record.state}`);
        }
        const columns = dimensions.columns;
        const rows = dimensions.rows;
        if (!Number.isSafeInteger(columns) || columns < 1 || columns > limits.maxTerminalColumns) {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `columns must be 1..${limits.maxTerminalColumns}`);
        }
        if (!Number.isSafeInteger(rows) || rows < 1 || rows > limits.maxTerminalRows) {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `rows must be 1..${limits.maxTerminalRows}`);
        }
        if (!record.pty || typeof record.pty.resize !== "function") {
          throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "session does not support resize");
        }
        const now = Date.now();
        record.ptyResizeAt = record.ptyResizeAt.filter((t) => now - t < 60_000);
        if (record.ptyResizeAt.length >= limits.maxTerminalResizesPerMinute) {
          throw new ProcessSessionError(
            "ERR_PRISM_PROCESS_PTY_LIMIT",
            `resize rate exceeds maxTerminalResizesPerMinute (${limits.maxTerminalResizesPerMinute})`,
          );
        }
        await assertPolicy("process_resize", record.command, record.args, record.workspace, record.owner);
        record.ptyResizeAt.push(now);
        try {
          await record.pty.resize({ columns, rows });
        } catch {
          terminateRecord(record, "unknown", null);
          throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_BACKEND", "PTY backend resize failed");
        }
        record.ptyTerminal = { ...record.ptyTerminal!, columns, rows };
      };
    }
    return handle;
  };

  return {
    async start(request: ProcessStartRequest): Promise<ProcessSession> {
      assertNotDisposed();
      sweepExpired();
      await checkSandboxAlive();

      if (request.pty && (!ptyBackend || typeof ptyBackend.startPty !== "function")) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_UNSUPPORTED", "PTY not supported on this host");
      }
      if (!request.command || typeof request.command !== "string") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_POLICY", "command required");
      }
      const ptyTerminal = request.pty ? resolveTerminal(request.terminal) : undefined;

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
        ptyTerminal,
        ptyResizeAt: [],
        accumulator,
        waiters: [],
        stdinClosed: false,
        handle: null as unknown as ProcessSession,
        recoveryFencingToken: 0,
        recoveryVersion: 0,
      };
      record.handle = makeHandle(record);
      sessions.set(id, record);

      // Durable recovery: intent is persisted BEFORE spawn. The per-record lease
      // fences replica coordination; the fencing token is stored in the record
      // so every later CAS write is monotonic. On any write/fence failure the
      // start fails closed (record removed, no half-durable process).
      let recoveryLease: { token: string } | undefined;
      if (durable) {
        const lease = await acquireRecordLease({
          leases: leases!,
          id,
          ownerId: ownerId!,
          ttlMs: recoveryLimits.leaseTtlMs,
          ownership: options.ownership,
          signal: request.signal,
        });
        if (!lease) {
          sessions.delete(id);
          throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_FENCE", "recovery lease for new session is held by another replica");
        }
        recoveryLease = { token: lease.token };
        record.recoveryLeaseToken = lease.token;
        record.recoveryFencingToken = lease.fencingToken;
        const intent = buildProcessRecoveryRecord({
          id,
          owner,
          workspace,
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
          checkpoints: checkpoints!,
          record: intent,
          expectedVersion: 0,
          version: 1,
          ownership: options.ownership,
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
              ptyBackend!.startPty!({
                file: request.command,
                args,
                cwd,
                env: request.env,
                columns: ptyTerminal!.columns,
                rows: ptyTerminal!.rows,
                term: ptyTerminal!.term,
                onData,
              }),
              limits.maxPtyAttachTimeoutMs,
            );
            const metadataJson = handle.metadata !== undefined ? JSON.stringify(handle.metadata) : undefined;
            if (metadataJson !== undefined && Buffer.byteLength(metadataJson, "utf8") > limits.maxPtyBackendMetadataBytes) {
              throw new ProcessSessionError(
                "ERR_PRISM_PROCESS_PTY_LIMIT",
                `pty backend metadata exceeds maxPtyBackendMetadataBytes (${limits.maxPtyBackendMetadataBytes})`,
              );
            }
            if (handle.ref !== undefined) record.backendRef = validateBackendRef(handle.ref, recoveryLimits);
            record.pty = handle;
            record.state = "running";
            persistTransition(record);
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
          } catch (error) {
            sessions.delete(id);
            if (error instanceof ProcessSessionError) throw error;
            if (error instanceof ProcessRecoveryError) throw error;
            throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_BACKEND", "PTY backend failed to start");
          }
        } else if (sandbox?.startProcess) {
          const handle = await sandbox.startProcess({
            file: request.command,
            args,
            cwd,
            env: request.env,
            onData,
          });
          if (handle.ref !== undefined) record.backendRef = validateBackendRef(handle.ref, recoveryLimits);
          record.backend = handle;
          record.state = "running";
          persistTransition(record);
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
          persistTransition(record);
        }
      } catch (error) {
        sessions.delete(id);
        if (durable) {
          // No half-durable process: drop the intent/running record and release
          // the recovery lease. The host store is authoritative.
          await deleteProcessRecoveryRecord({ checkpoints: checkpoints!, id, ownership: options.ownership, signal: request.signal });
          if (recoveryLease) {
            await releaseRecordLease({
              leases: leases!,
              id,
              ownerId: ownerId!,
              token: recoveryLease.token,
              ownership: options.ownership,
              signal: request.signal,
            });
          }
        }
        if (error instanceof ProcessSessionError) throw error;
        if (error instanceof ProcessRecoveryError) throw error;
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
        const cancelPty = record.pty;
        const cancelBackend = record.backend;
        if (release || record.releaseOnCancel) {
          if (cancelPty || cancelBackend) {
            terminateRecord(record, "released", null);
            if (cancelPty) {
              try {
                await cancelPty.release();
              } catch {
                // continue
              }
            } else {
              try {
                await cancelBackend!.release();
              } catch {
                // continue
              }
            }
          } else {
            terminateRecord(record, "released", null);
          }
        } else {
          if (cancelPty || cancelBackend) {
            terminateRecord(record, "killed", null);
            if (cancelPty) {
              try {
                await cancelPty.kill();
              } catch {
                // continue
              }
            } else {
              try {
                await cancelBackend!.kill();
              } catch {
                // continue
              }
            }
          } else {
            terminateRecord(record, "killed", null);
          }
        }
      }
      // Durable pass (plan 026 Task 5): cancellation of a recovered/unattached
      // process either reaches the attached backend (above) or records unknown —
      // never a fabricated exit. Lease + CAS guard every mutation so two replicas
      // cannot cancel the same record into different outcomes.
      if (durable) {
        const { records } = await loadProcessRecoveryRecords({
          checkpoints: checkpoints!,
          limits: recoveryLimits,
          ownership: options.ownership,
        });
        for (const { record, version } of records) {
          if (record.owner !== owner) continue;
          if (isTerminalState(record.state)) continue;
          if (sessions.has(record.id)) continue; // handled by the live pass above
          const lease = await acquireRecordLease({
            leases: leases!,
            id: record.id,
            ownerId: ownerId!,
            ttlMs: recoveryLimits.leaseTtlMs,
            ownership: options.ownership,
          });
          if (!lease) continue; // another replica owns or is recovering it
          try {
            await persistRecoveryUnknown(record, version);
          } finally {
            await releaseRecordLease({
              leases: leases!,
              id: record.id,
              ownerId: ownerId!,
              token: lease.token,
              ownership: options.ownership,
            });
          }
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

    async recover(recoverOptions?: { signal?: AbortSignal }): Promise<ProcessRecoveryReport> {
      assertNotDisposed();
      if (!durable) {
        throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNSUPPORTED", "durable process recovery is not configured on this host");
      }
      sweepExpired();
      const { records } = await loadProcessRecoveryRecords({
        checkpoints: checkpoints!,
        limits: recoveryLimits,
        ownership: options.ownership,
        signal: recoverOptions?.signal,
      });
      const report: ProcessRecoveryRecordReport[] = [];
      let attached = 0;
      let terminal = 0;
      let unknown = 0;
      for (const { record } of records) {
        const live = sessions.get(record.id);
        if (live) {
          // Already live in this registry: nothing to do, report the truth.
          report.push({ id: record.id, outcome: "attached", state: live.state, exitCode: live.exitCode });
          if (live.state === "running" || live.state === "starting") attached += 1;
          else terminal += 1;
          continue;
        }
        if (
          record.state === "exited" ||
          record.state === "killed" ||
          record.state === "released" ||
          record.state === "expired" ||
          record.state === "unknown"
        ) {
          report.push({ id: record.id, outcome: "terminal", state: record.state, exitCode: record.exitCode });
          terminal += 1;
          continue;
        }
        // starting | running durable record without a live handle: attach-if-
        // attested, else atomic unknown. Never fabricate an exit code.
        const lease = await acquireRecordLease({
          leases: leases!,
          id: record.id,
          ownerId: ownerId!,
          ttlMs: recoveryLimits.leaseTtlMs,
          ownership: options.ownership,
          signal: recoverOptions?.signal,
        });
        if (!lease) {
          // Another replica owns or is recovering this record.
          report.push({ id: record.id, outcome: "unknown", state: record.state, exitCode: null });
          unknown += 1;
          continue;
        }
        try {
          // Fresh CAS read under the lease: another replica may have moved the record.
          const fresh = await loadProcessRecoveryRecord({
            checkpoints: checkpoints!,
            id: record.id,
            limits: recoveryLimits,
            ownership: options.ownership,
            signal: recoverOptions?.signal,
          });
          if (!fresh) {
            report.push({ id: record.id, outcome: "terminal", state: "unknown", exitCode: null, error: "ERR_PRISM_RECOVERY_UNKNOWN" });
            terminal += 1;
            continue;
          }
          const current = fresh.record;
          if (
            current.state === "exited" ||
            current.state === "killed" ||
            current.state === "released" ||
            current.state === "expired" ||
            current.state === "unknown"
          ) {
            report.push({ id: current.id, outcome: "terminal", state: current.state, exitCode: current.exitCode });
            terminal += 1;
            continue;
          }
          if (Date.now() >= current.expiresAt) {
            // Lifetime lapsed while unrecovered: persist the expiry.
            const expired = buildProcessRecoveryRecord({
              ...current,
              state: "expired",
              exitCode: null,
              updatedAt: nowIso(),
            });
            await saveProcessRecoveryRecord({
              checkpoints: checkpoints!,
              record: expired,
              expectedVersion: fresh.version,
              version: fresh.version + 1,
              ownership: options.ownership,
              signal: recoverOptions?.signal,
            });
            report.push({ id: current.id, outcome: "terminal", state: "expired", exitCode: null });
            terminal += 1;
            continue;
          }
          const active = [...sessions.values()].filter((s) => s.state === "running" || s.state === "starting").length;
          if (active >= limits.maxSessions) {
            // Cannot admit another live session: record unknown (fails closed).
            await persistRecoveryUnknown(current, fresh.version, recoverOptions?.signal);
            report.push({ id: current.id, outcome: "unknown", state: "unknown", exitCode: null });
            unknown += 1;
            continue;
          }
          let attachErrorCode: ProcessRecoveryRecordReport["error"];
          if (current.backendRef !== undefined && recoveryBackend) {
            try {
              const handle = await attachWithTimeout(recoveryBackend, current.backendRef, recoveryLimits.attachTimeoutMs);
              if (handle) {
                attachRecoveredHandle(current, handle, fresh.version);
                attached += 1;
                report.push({ id: current.id, outcome: "attached", state: "running", exitCode: null });
                continue;
              }
            } catch (attachError) {
              attachErrorCode =
                attachError instanceof ProcessRecoveryError
                  ? attachError.code
                  : ("ERR_PRISM_RECOVERY_UNKNOWN" as const);
            }
          }
          // No ref, no backend, unattested attach, or attach failure: atomic unknown.
          const saved = await persistRecoveryUnknown(current, fresh.version, recoverOptions?.signal);
          if (!saved) {
            // CAS/fence conflict: another replica moved the record; re-report its state.
            const again = await loadProcessRecoveryRecord({
              checkpoints: checkpoints!,
              id: current.id,
              limits: recoveryLimits,
              ownership: options.ownership,
              signal: recoverOptions?.signal,
            });
            const reported = again?.record;
            report.push({
              id: current.id,
              outcome: reported && isTerminalState(reported.state) ? "terminal" : "unknown",
              state: reported?.state ?? "unknown",
              exitCode: reported?.exitCode ?? null,
              error: attachErrorCode,
            });
            if (reported && isTerminalState(reported.state)) terminal += 1;
            else unknown += 1;
            continue;
          }
          report.push({ id: current.id, outcome: "unknown", state: "unknown", exitCode: null, error: attachErrorCode });
          unknown += 1;
        } finally {
          await releaseRecordLease({
            leases: leases!,
            id: record.id,
            ownerId: ownerId!,
            token: lease.token,
            ownership: options.ownership,
            signal: recoverOptions?.signal,
          });
        }
      }
      return { records: report, attached, terminal, unknown };
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      for (const record of [...sessions.values()]) {
        if (record.state === "running" || record.state === "starting") {
          if (record.pty) {
            try {
              await record.pty.kill();
            } catch {
              // best effort
            }
          }
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
        if (record.recoveryLeaseToken) {
          void releaseRecordLease({
            leases: leases!,
            id: record.id,
            ownerId: ownerId!,
            token: record.recoveryLeaseToken,
            ownership: options.ownership,
          });
          record.recoveryLeaseToken = undefined;
        }
      }
      sessions.clear();
    },
  };
}
