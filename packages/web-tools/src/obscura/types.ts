import type { ObscuraProcessLimits } from "./limits.js";

export interface ObscuraProcessOptions {
  /** Absolute path to the executable (the `obscura` binary, or e.g. `/usr/bin/docker`). Never run through a shell. */
  readonly command: string;
  /** Argument vector passed byte-for-byte, e.g. `["serve", "--host", "127.0.0.1", "--port", "9222"]` or `["run", "--rm", "-i", "h4ckf0r0day/obscura", "mcp"]`. */
  readonly args?: readonly string[];
  /**
   * Explicit environment for the child. When omitted, a minimal allow-list
   * (`PATH`, `HOME`) is inherited; the full host environment is never passed.
   */
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  /** Capture stderr (default, capped) or discard it. */
  readonly stderr?: "pipe" | "ignore";
  /**
   * Explicit host opt-in permitting `--allow-private-network`, `--allow-file-access`,
   * or a non-loopback `--host` binding in `args`. Off by default and rejected otherwise.
   */
  readonly allowInsecureFlags?: boolean;
  readonly limits?: Partial<ObscuraProcessLimits>;
}

export interface ObscuraExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ObscuraCloseOptions {
  readonly signal?: AbortSignal;
  /** Override the configured shutdown grace period for this close. */
  readonly shutdownTimeoutMs?: number;
}

export interface OwnedObscuraProcess {
  readonly pid: number | undefined;
  /** Resolves when the process is gone; rejects on spawn failure. */
  readonly exited: Promise<ObscuraExit>;
  /** Capped stderr collected so far (empty when stderr is "ignore"). */
  stderrText(): string;
  /**
   * Poll `probe()` until it returns true, bounded by `startupTimeoutMs`.
   * Kills the owned process on timeout or abort.
   */
  waitReady(probe: () => boolean | Promise<boolean>, options?: { signal?: AbortSignal }): Promise<void>;
  /** SIGTERM (group-wide on POSIX), then SIGKILL after the grace period. Idempotent. */
  close(options?: ObscuraCloseOptions): Promise<void>;
}
