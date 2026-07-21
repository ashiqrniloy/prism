import type { BashOperations } from "@arnilo/prism-coding-agent";
import type { Readable } from "node:stream";

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
  readonly export?: (
    stream: Readable,
    metadata: SandboxExportMetadata,
  ) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface SandboxAdapter {
  exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }>;
}

/**
 * Disposable sandbox lifecycle used by the Docker/OCI reference adapter.
 * Extends the shell-only `SandboxAdapter` with typed exec, status, and cleanup.
 */
export interface DisposableSandbox extends SandboxAdapter {
  readonly id: string;
  /** Present after workspace import; content hash only (no secrets). */
  readonly importIdentity?: SandboxExportMetadata;
  /** Present after a successful `close({ export })`; use for resume hash checks. */
  readonly lastExportIdentity?: SandboxExportMetadata;
  execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }>;
  status(): Promise<SandboxStatus>;
  stop(options?: { graceMs?: number; signal?: AbortSignal }): Promise<void>;
  kill(options?: { signal?: AbortSignal }): Promise<void>;
  close(options?: SandboxCloseOptions): Promise<SandboxExportMetadata | undefined>;
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
