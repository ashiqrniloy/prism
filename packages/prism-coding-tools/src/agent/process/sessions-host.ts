/**
 * Shared mutable registry for managed process sessions.
 * Lifted out of the createProcessSessions closure so phase modules take it explicitly.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { DEFAULT_MAX_TERMINAL_COLUMNS, DEFAULT_MAX_TERMINAL_ROWS } from "../limits.js";
import type { OutputAccumulator } from "../output-accumulator.js";
import { type ProcessRecoveryBackend, ProcessRecoveryError, resolveProcessRecoveryLimits } from "./recovery.js";
import {
  type CodingProcessEvent,
  type CreateProcessSessionsOptions,
  type ProcessExitResult,
  type ProcessPtyHandle,
  type ProcessSandboxHandle,
  type ProcessSession,
  ProcessSessionError,
  type ProcessSessionState,
  type ProcessTerminalRequest,
  type ResolvedProcessSessionLimits,
  resolveProcessSessionLimits,
} from "./types.js";

/** Default TERM for PTY sessions (validated <= maxTerminalTermBytes). */
export const DEFAULT_TERM = "xterm-256color";

export function ownershipKey(
  ownership: CreateProcessSessionsOptions["ownership"],
  identity: CreateProcessSessionsOptions["identity"],
): string {
  if (ownership) {
    return `${ownership.tenantId ?? ""}:${ownership.accountId ?? ""}:${ownership.userId ?? ""}`;
  }
  if (identity) {
    return `${identity.tenantId}:${identity.accountId ?? ""}:${identity.userId ?? ""}`;
  }
  return "default";
}

export function commandFingerprint(command: string, args: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([command, ...args]))
    .digest("hex");
}

export function isInsideRoot(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  if (to === from) return true;
  const rel = relative(from, to);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface SessionRecord {
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

export interface SessionsHost {
  readonly workspace: string;
  readonly limits: ResolvedProcessSessionLimits;
  readonly defaultOwner: string;
  readonly policy: CreateProcessSessionsOptions["policy"];
  readonly onEvent: CreateProcessSessionsOptions["onEvent"];
  readonly sandbox: CreateProcessSessionsOptions["sandbox"];
  readonly ptyBackend: CreateProcessSessionsOptions["ptyBackend"];
  readonly ptyResizeCapable: boolean;
  readonly sessions: Map<string, SessionRecord>;
  disposed: boolean;
  sandboxLost: boolean;
  readonly checkpoints: CreateProcessSessionsOptions["checkpoints"];
  readonly leases: CreateProcessSessionsOptions["leases"];
  readonly ownerId: CreateProcessSessionsOptions["ownerId"];
  readonly recoveryBackend: ProcessRecoveryBackend | undefined;
  readonly recoveryLimits: ReturnType<typeof resolveProcessRecoveryLimits>;
  readonly durable: boolean;
  readonly ownership: CreateProcessSessionsOptions["ownership"];
}

export function createSessionsHost(options: CreateProcessSessionsOptions): SessionsHost {
  const checkpoints = options.checkpoints;
  const leases = options.leases;
  const ownerId = options.ownerId;
  const recoveryBackend = options.recoveryBackend;
  const durable = checkpoints !== undefined || leases !== undefined || ownerId !== undefined || recoveryBackend !== undefined;
  if (durable && !(checkpoints && leases && ownerId)) {
    throw new ProcessRecoveryError(
      "ERR_PRISM_RECOVERY_UNSUPPORTED",
      "durable process recovery requires checkpoints, leases, and ownerId together",
    );
  }
  return {
    workspace: resolve(options.cwd),
    limits: resolveProcessSessionLimits(options.limits),
    defaultOwner: ownershipKey(options.ownership, options.identity),
    policy: options.policy,
    onEvent: options.onEvent,
    sandbox: options.sandbox,
    ptyBackend: options.ptyBackend,
    ptyResizeCapable: options.ptyBackend?.capabilities?.resize === true,
    sessions: new Map(),
    disposed: false,
    sandboxLost: false,
    checkpoints,
    leases,
    ownerId,
    recoveryBackend,
    recoveryLimits: resolveProcessRecoveryLimits(options.recoveryLimits),
    durable,
    ownership: options.ownership,
  };
}

export function emit(host: SessionsHost, event: CodingProcessEvent): void {
  host.onEvent?.(event);
}

export function assertNotDisposed(host: SessionsHost): void {
  if (host.disposed) throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", "process sessions disposed");
}

export function isTerminalState(state: ProcessSessionState): boolean {
  return state === "exited" || state === "killed" || state === "released" || state === "expired" || state === "unknown";
}

export function settleWaiters(record: SessionRecord): void {
  const result: ProcessExitResult = { exitCode: record.exitCode, state: record.state };
  const waiters = record.waiters;
  record.waiters = [];
  for (const resolveWait of waiters) resolveWait(result);
}

export function resolveTerminal(
  host: SessionsHost,
  terminal: ProcessTerminalRequest | undefined,
): { columns: number; rows: number; term: string } {
  const columns = terminal?.columns ?? Math.min(DEFAULT_MAX_TERMINAL_COLUMNS, host.limits.maxTerminalColumns);
  const rows = terminal?.rows ?? Math.min(DEFAULT_MAX_TERMINAL_ROWS, host.limits.maxTerminalRows);
  const term = terminal?.term ?? DEFAULT_TERM;
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > host.limits.maxTerminalColumns) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `columns must be 1..${host.limits.maxTerminalColumns}`);
  }
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > host.limits.maxTerminalRows) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `rows must be 1..${host.limits.maxTerminalRows}`);
  }
  if (Buffer.byteLength(term, "utf8") > host.limits.maxTerminalTermBytes) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_PTY_LIMIT", `term exceeds maxTerminalTermBytes (${host.limits.maxTerminalTermBytes})`);
  }
  return { columns, rows, term };
}
