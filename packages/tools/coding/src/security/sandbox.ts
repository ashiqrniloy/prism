import type { Readable } from "node:stream";
import type { BashOperations } from "../agent/index.js";

export interface SandboxExecRequest {
  readonly command: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onData?: (data: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

export interface SandboxExecFileRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly onData?: (data: Buffer) => void;
  readonly signal?: AbortSignal;
  /** Wall timeout in milliseconds. */
  readonly timeout?: number;
}

export type SandboxStatusState = "running" | "stopped" | "removed" | "failed";

/** Vendor snapshot kind. `filesystem` drops RAM/processes on resume; `memory` restores them. */
export type SandboxSnapshotKind = "memory" | "filesystem";

export interface SandboxPauseResult {
  readonly kind: SandboxSnapshotKind;
  readonly state: "paused";
}

export interface SandboxStatus {
  readonly id: string;
  readonly state: SandboxStatusState;
  readonly image: string;
  readonly startedAt: number;
  readonly lastActivityAt: number;
  readonly commandCount: number;
  /** Content identity of the imported workspace tree (when import ran). */
  readonly importIdentity?: SandboxExportMetadata;
  /** Content identity of the last successful close export (resume check). */
  readonly lastExportIdentity?: SandboxExportMetadata;
  /** Set when `state` is `stopped` because the backend paused rather than exited. */
  readonly snapshot?: { readonly kind: SandboxSnapshotKind };
}

export interface SandboxExportMetadata {
  readonly sha256: string;
  readonly entryCount: number;
  readonly byteCount: number;
  readonly format: "tar";
}

export interface SandboxCloseOptions {
  /**
   * Host-owned artifact writer. Receives a bounded tar stream plus finalized
   * SHA-256/entry/byte metadata. Partial failures must discard the host artifact.
   */
  readonly export?: (stream: Readable, metadata: SandboxExportMetadata) => Promise<void>;
  readonly signal?: AbortSignal;
}

/**
 * Explicit isolation/coherence capabilities of a sandbox backend or composition.
 *
 * Every field is a claim that MUST hold before security-sensitive host policy
 * may rely on it. Omission (or invalid metadata) resolves every field false —
 * a backend can never gain a capability by omission or by interface shape.
 *
 * `workspaceCoherent`: shell, filesystem, and repository tools observe one
 * workspace tree. `filesystemIsolated`: sandbox processes cannot touch the
 * host filesystem. `networkIsolated`: no reachable network (or only an
 * isolated one). `processIsolated`: sandbox processes run in a separate
 * process namespace. `privilegeIsolated`: sandbox processes cannot obtain
 * host privileges (root-in-container without user namespaces is NOT reliable).
 * `egressRestricted`: any network egress is forced through a controlled
 * proxy/firewall (a dedicated field because `networkIsolated` cannot represent
 * custom networks that exist but have proxy-constrained egress).
 */
export interface SandboxCapabilities {
  readonly workspaceCoherent: boolean;
  readonly filesystemIsolated: boolean;
  readonly networkIsolated: boolean;
  readonly processIsolated: boolean;
  readonly privilegeIsolated: boolean;
  readonly egressRestricted: boolean;
}

export interface SandboxAdapter {
  exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }>;
  /**
   * Optional host attestation of isolation controls. Omitted metadata (or
   * malformed/non-boolean/unknown fields) resolves every capability false;
   * this is host attestation, never verified by Prism.
   */
  readonly capabilities?: Readonly<SandboxCapabilities>;
}

/**
 * Disposable sandbox lifecycle used by the Docker/OCI reference adapter.
 * Extends the shell-only `SandboxAdapter` with typed exec, status, and cleanup.
 */
/**
 * Long-running process handle inside a disposable sandbox.
 * Optional on {@link DisposableSandbox.startProcess}; absence = one-shot-only adapter.
 */
export interface SandboxProcessHandle {
  readonly pid?: number;
  write(data: Uint8Array): Promise<void>;
  signal(name: string): Promise<void>;
  kill(): Promise<void>;
  release(): Promise<void>;
  wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number | null }>;
  /** Opaque non-secret reattachment ref for durable process recovery. */
  readonly ref?: string;
}

export interface DisposableSandbox extends SandboxAdapter {
  readonly id: string;
  readonly labels?: Readonly<Record<string, string>>;
  /** Present after workspace import; content hash only (no secrets). */
  readonly importIdentity?: SandboxExportMetadata;
  /** Present after a successful `close({ export })`; use for resume hash checks. */
  readonly lastExportIdentity?: SandboxExportMetadata;
  execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }>;
  status(): Promise<SandboxStatus>;
  stop(options?: { graceMs?: number; signal?: AbortSignal }): Promise<void>;
  kill(options?: { signal?: AbortSignal }): Promise<void>;
  close(options?: SandboxCloseOptions): Promise<SandboxExportMetadata | undefined>;
  /**
   * Optional long-running process capability. Detected, never assumed.
   * Absence → ProcessSessions.start over this sandbox fails closed with ERR_PRISM_PROCESS_UNSUPPORTED.
   */
  startProcess?(request: SandboxExecFileRequest): Promise<SandboxProcessHandle>;
  /**
   * Optional process reattachment capability for durable recovery.
   * Resolves an attested backend ref to an existing live handle; returns null otherwise.
   */
  attachProcess?(ref: string): Promise<SandboxProcessHandle | null>;
  /**
   * Optional snapshot/pause. Detected, never assumed.
   * `keepMemory: false` is filesystem-only: resume reboots and running processes are gone.
   * A refused pause must leave the sandbox running (or unknown) — never claim paused.
   */
  pause?(options?: { keepMemory?: boolean; signal?: AbortSignal }): Promise<SandboxPauseResult>;
  /** Explicit resume after pause. Must not run as a side effect of exec/connect. */
  resume?(options?: { signal?: AbortSignal }): Promise<void>;
}

export class SandboxExecutionError extends Error {
  readonly code = "ERR_PRISM_SANDBOX_EXECUTION";
  constructor(message: string) {
    super(message);
    this.name = "SandboxExecutionError";
  }
}

/** Map a host-owned sandbox adapter to coding-agent `BashOperations`. */
export function createSandboxBashOperations(adapter: SandboxAdapter): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      try {
        return await adapter.exec({
          command,
          cwd,
          env: options.env,
          onData: options.onData,
          signal: options.signal,
          timeout: options.timeout,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SandboxExecutionError(message);
      }
    },
  };
}
