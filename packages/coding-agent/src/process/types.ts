import type { AgentIdentity, ExecutionPolicy, OwnershipScope } from "@arnilo/prism";
import {
  DEFAULT_MAX_PROCESS_INPUT_BYTES,
  DEFAULT_MAX_PROCESS_LIFETIME_MS,
  DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
  DEFAULT_MAX_PROCESS_SESSIONS,
  DEFAULT_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
  DEFAULT_MAX_PTY_ATTACH_TIMEOUT_MS,
  DEFAULT_MAX_PTY_BACKEND_METADATA_BYTES,
  DEFAULT_MAX_TERMINAL_COLUMNS,
  DEFAULT_MAX_TERMINAL_RESIZES_PER_MINUTE,
  DEFAULT_MAX_TERMINAL_ROWS,
  DEFAULT_MAX_TERMINAL_TERM_BYTES,
  HARD_MAX_PROCESS_INPUT_BYTES,
  HARD_MAX_PROCESS_LIFETIME_MS,
  HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
  HARD_MAX_PROCESS_SESSIONS,
  HARD_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
  HARD_MAX_PTY_ATTACH_TIMEOUT_MS,
  HARD_MAX_PTY_BACKEND_METADATA_BYTES,
  HARD_MAX_TERMINAL_COLUMNS,
  HARD_MAX_TERMINAL_RESIZES_PER_MINUTE,
  HARD_MAX_TERMINAL_ROWS,
  HARD_MAX_TERMINAL_TERM_BYTES,
  validateCodingLimit,
} from "../limits.js";

/** Duck-typed long-running sandbox handle (mirrors coding-security SandboxProcessHandle). */
export interface ProcessSandboxHandle {
  write(data: Uint8Array): Promise<void>;
  signal(name: string): Promise<void>;
  kill(): Promise<void>;
  release(): Promise<void>;
  wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number | null }>;
}

export interface ProcessSandboxStartRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly onData?: (data: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

/** Optional sandbox backend for ProcessSessions.
 * Presence of `startProcess` = long-running capable; absence fails closed.
 */
export interface ProcessSandboxBackend {
  startProcess?(request: ProcessSandboxStartRequest): Promise<ProcessSandboxHandle>;
  status?(): Promise<{ readonly state: string }>;
}

/** Bounded terminal geometry + TERM for interactive PTY sessions (frozen caps in limits.ts). */
export interface ProcessTerminalRequest {
  /** 1..maxTerminalColumns (default 120; host-configured max wins when smaller). */
  readonly columns?: number;
  /** 1..maxTerminalRows (default 40; host-configured max wins when smaller). */
  readonly rows?: number;
  /** TERM string, UTF-8 bytes <= maxTerminalTermBytes (default "xterm-256color"). */
  readonly term?: string;
}

/** Bounded resize dimensions for an interactive PTY session. */
export interface ProcessTerminalResize {
  readonly columns: number;
  readonly rows: number;
}

/**
 * Host PTY handle (mirrors ProcessSandboxHandle) plus optional bounded resize
 * and backend metadata. Capability is explicit: the session handle exposes
 * `resize` only when the backend declared `capabilities.resize`.
 */
export interface ProcessPtyHandle {
  write(data: Uint8Array): Promise<void>;
  signal(name: string): Promise<void>;
  kill(): Promise<void>;
  release(): Promise<void>;
  resize?(dimensions: ProcessTerminalResize): Promise<void>;
  /** Bounded host metadata (UTF-8 JSON bytes <= maxPtyBackendMetadataBytes), surfaced via session metadata(). */
  readonly metadata?: Readonly<Record<string, string>>;
  wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number | null }>;
}

export interface ProcessPtyStartRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
  readonly term: string;
  readonly onData?: (data: Buffer) => void;
  readonly signal?: AbortSignal;
}

/**
 * Host-selected PTY backend. Capability and metadata are explicit, never
 * duck-typed: `pty: true` requires a backend whose `startPty` is present
 * (otherwise `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before process creation) and
 * `capabilities.resize` must be true for the session handle to expose resize.
 */
export interface ProcessPtyBackend {
  startPty?(request: ProcessPtyStartRequest): Promise<ProcessPtyHandle>;
  readonly capabilities?: { readonly resize: boolean };
}

export type ProcessSessionState = "starting" | "running" | "exited" | "killed" | "released" | "expired" | "unknown";

export type ProcessSessionErrorCode =
  | "ERR_PRISM_PROCESS_POLICY"
  | "ERR_PRISM_PROCESS_OWNERSHIP"
  | "ERR_PRISM_PROCESS_STATE"
  | "ERR_PRISM_PROCESS_LIMIT"
  | "ERR_PRISM_PROCESS_PTY_UNSUPPORTED"
  | "ERR_PRISM_PROCESS_PTY_BACKEND"
  | "ERR_PRISM_PROCESS_PTY_LIMIT"
  | "ERR_PRISM_PROCESS_UNSUPPORTED";

export class ProcessSessionError extends Error {
  readonly code: ProcessSessionErrorCode;
  constructor(code: ProcessSessionErrorCode, message: string) {
    super(message);
    this.name = "ProcessSessionError";
    this.code = code;
  }
}

export interface ProcessSessionLimits {
  readonly maxSessions?: number;
  readonly maxInputBytes?: number;
  readonly maxLifetimeMs?: number;
  readonly maxOutputChunkBytes?: number;
  readonly maxTotalOutputBytes?: number;
  /** Phase 26: PTY terminal bounds (defaults/hard caps frozen in limits.ts). */
  readonly maxTerminalColumns?: number;
  readonly maxTerminalRows?: number;
  readonly maxTerminalTermBytes?: number;
  readonly maxTerminalResizesPerMinute?: number;
  readonly maxPtyAttachTimeoutMs?: number;
  readonly maxPtyBackendMetadataBytes?: number;
}

export interface ResolvedProcessSessionLimits {
  readonly maxSessions: number;
  readonly maxInputBytes: number;
  readonly maxLifetimeMs: number;
  readonly maxOutputChunkBytes: number;
  readonly maxTotalOutputBytes: number;
  readonly maxTerminalColumns: number;
  readonly maxTerminalRows: number;
  readonly maxTerminalTermBytes: number;
  readonly maxTerminalResizesPerMinute: number;
  readonly maxPtyAttachTimeoutMs: number;
  readonly maxPtyBackendMetadataBytes: number;
}

export function resolveProcessSessionLimits(limits?: ProcessSessionLimits): ResolvedProcessSessionLimits {
  return {
    maxSessions: validateCodingLimit("maxSessions", limits?.maxSessions ?? DEFAULT_MAX_PROCESS_SESSIONS, HARD_MAX_PROCESS_SESSIONS),
    maxInputBytes: validateCodingLimit(
      "maxInputBytes",
      limits?.maxInputBytes ?? DEFAULT_MAX_PROCESS_INPUT_BYTES,
      HARD_MAX_PROCESS_INPUT_BYTES,
    ),
    maxLifetimeMs: validateCodingLimit(
      "maxLifetimeMs",
      limits?.maxLifetimeMs ?? DEFAULT_MAX_PROCESS_LIFETIME_MS,
      HARD_MAX_PROCESS_LIFETIME_MS,
    ),
    maxOutputChunkBytes: validateCodingLimit(
      "maxOutputChunkBytes",
      limits?.maxOutputChunkBytes ?? DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
      HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
    ),
    maxTotalOutputBytes: validateCodingLimit(
      "maxTotalOutputBytes",
      limits?.maxTotalOutputBytes ?? DEFAULT_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
      HARD_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
    ),
    maxTerminalColumns: validateCodingLimit(
      "maxTerminalColumns",
      limits?.maxTerminalColumns ?? DEFAULT_MAX_TERMINAL_COLUMNS,
      HARD_MAX_TERMINAL_COLUMNS,
    ),
    maxTerminalRows: validateCodingLimit(
      "maxTerminalRows",
      limits?.maxTerminalRows ?? DEFAULT_MAX_TERMINAL_ROWS,
      HARD_MAX_TERMINAL_ROWS,
    ),
    maxTerminalTermBytes: validateCodingLimit(
      "maxTerminalTermBytes",
      limits?.maxTerminalTermBytes ?? DEFAULT_MAX_TERMINAL_TERM_BYTES,
      HARD_MAX_TERMINAL_TERM_BYTES,
    ),
    maxTerminalResizesPerMinute: validateCodingLimit(
      "maxTerminalResizesPerMinute",
      limits?.maxTerminalResizesPerMinute ?? DEFAULT_MAX_TERMINAL_RESIZES_PER_MINUTE,
      HARD_MAX_TERMINAL_RESIZES_PER_MINUTE,
    ),
    maxPtyAttachTimeoutMs: validateCodingLimit(
      "maxPtyAttachTimeoutMs",
      limits?.maxPtyAttachTimeoutMs ?? DEFAULT_MAX_PTY_ATTACH_TIMEOUT_MS,
      HARD_MAX_PTY_ATTACH_TIMEOUT_MS,
    ),
    maxPtyBackendMetadataBytes: validateCodingLimit(
      "maxPtyBackendMetadataBytes",
      limits?.maxPtyBackendMetadataBytes ?? DEFAULT_MAX_PTY_BACKEND_METADATA_BYTES,
      HARD_MAX_PTY_BACKEND_METADATA_BYTES,
    ),
  };
}

export interface ProcessStartRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Default false. true without a host ptyBackend.startPty →
   * ERR_PRISM_PROCESS_PTY_UNSUPPORTED before process creation; backend
   * failures → ERR_PRISM_PROCESS_PTY_BACKEND; terminal/resize/attach bounds →
   * ERR_PRISM_PROCESS_PTY_LIMIT.
   */
  readonly pty?: boolean;
  /** Bounded terminal geometry + TERM for pty: true sessions. */
  readonly terminal?: ProcessTerminalRequest;
  readonly lifetimeMs?: number;
  /** Owner string for this session; defaults to registry ownership key. */
  readonly owner?: string;
  /** When true, run cancel releases instead of killing (default kill). */
  readonly releaseOnCancel?: boolean;
}

export interface ProcessOutputChunk {
  readonly data: string;
  /** Next byte cursor for paging. */
  readonly cursor: number;
  readonly eof: boolean;
}

export interface ProcessExitResult {
  readonly exitCode: number | null;
  readonly state: ProcessSessionState;
}

export interface ProcessSessionMetadata {
  readonly id: string;
  readonly commandFingerprint: string;
  readonly owner: string;
  readonly workspace: string;
  readonly policyDecision: string;
  readonly startedAt: string;
  readonly exitedAt?: string;
  readonly state: ProcessSessionState;
  readonly releaseOnCancel: boolean;
  /** True when the session runs through the host ptyBackend. */
  readonly pty: boolean;
  /** Resolved terminal geometry + TERM for PTY sessions (bounded at start). */
  readonly terminal?: { readonly columns: number; readonly rows: number; readonly term: string };
  /** Bounded backend metadata (validated <= maxPtyBackendMetadataBytes at start). */
  readonly ptyBackendMetadata?: Readonly<Record<string, string>>;
}

export interface ProcessSession {
  readonly id: string;
  readonly state: ProcessSessionState;
  readonly owner: string;
  metadata(): ProcessSessionMetadata;
  output(request?: { cursor?: number; maxBytes?: number }): Promise<ProcessOutputChunk>;
  input(data: string | Uint8Array): Promise<void>;
  wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ProcessExitResult>;
  signal(name: "SIGTERM" | "SIGINT" | "SIGHUP"): Promise<void>;
  kill(): Promise<void>;
  release(): Promise<void>;
  /** Present only when the host backend declared `capabilities.resize` (PTY sessions). */
  resize?(dimensions: ProcessTerminalResize): Promise<void>;
}

export type CodingProcessEvent = {
  readonly type: "process_started" | "process_exited" | "process_killed" | "process_released" | "process_expired" | "process_unknown";
  readonly sessionId: string;
  readonly processId: string;
  readonly owner: string;
  readonly exitCode?: number | null;
  readonly at: string;
};

export interface ProcessSessions {
  start(request: ProcessStartRequest): Promise<ProcessSession>;
  get(sessionId: string, owner?: string): ProcessSession;
  /** Kill (default) or release all sessions for `owner`. */
  cancelOwned(owner: string, options?: { release?: boolean }): Promise<void>;
  /** Mark a running session unknown (backend loss); never fabricates exitCode. */
  markUnknown(sessionId: string, owner?: string): Promise<void>;
  /**
   * Host resume / sandbox-loss reconciliation: mark every running/starting session unknown.
   * Never fabricates exitCode. O(owned sessions).
   */
  reconcile(): Promise<{ readonly markedUnknown: number }>;
  dispose(): Promise<void>;
}

export interface CreateProcessSessionsOptions {
  readonly cwd: string;
  readonly policy?: ExecutionPolicy;
  readonly limits?: ProcessSessionLimits;
  readonly onEvent?: (event: CodingProcessEvent) => void;
  readonly ownership?: OwnershipScope;
  /** Host-verified identity; projects onto default owner when ownership omitted. */
  readonly identity?: AgentIdentity;
  /**
   * When set: use `startProcess` if present; otherwise start() fails closed
   * (`ERR_PRISM_PROCESS_UNSUPPORTED`). Native spawn only when sandbox omitted.
   */
  readonly sandbox?: ProcessSandboxBackend;
  /**
   * Phase 26: optional host-selected PTY backend. `pty: true` delegates only
   * to this backend; absent backend or missing startPty fails closed with
   * `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before process creation.
   */
  readonly ptyBackend?: ProcessPtyBackend;
}
