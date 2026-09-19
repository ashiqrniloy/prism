/**
 * Checkpoint restore hooks (plan 094 Task 3). A hook restores one external layer (git commit,
 * document version, workspace fingerprint) recorded in a checkpoint's sidecar metadata.
 *
 * All-or-nothing: hooks run before the resume claims the checkpoint. The first hook that fails
 * or times out aborts the resume with `CheckpointRestoreError` naming that hook, so the
 * conversation restore never applies on top of a half-restored external world. Hosts that need
 * every layer back where they were re-run the whole restore after fixing the failing layer.
 */

/** Per-hook ceiling for a restore (plan 094 Task 3 default). */
export const DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS = 10_000;

/** One hook that completed during a restore. */
export interface CheckpointRestoreAuditEntry {
  readonly hook: string;
  readonly durationMs: number;
}

/** Audit of a completed restore: every hook that ran, in order. */
export interface CheckpointRestoreAudit {
  readonly hooks: readonly CheckpointRestoreAuditEntry[];
  readonly durationMs: number;
}

/**
 * Host code restoring one external layer. `signal` aborts on the per-hook timeout and on the
 * caller's abort, so a hook that talks to a remote system can cancel instead of dangling.
 */
export type CheckpointRestoreHook<Context> = (checkpoint: Context, signal: AbortSignal) => void | Promise<void>;

/** Thrown when a restore hook fails or times out; the checkpoint and conversation are untouched. */
export class CheckpointRestoreError extends Error {
  readonly code = "ERR_PRISM_CHECKPOINT_RESTORE";
  /** Name of the failing hook (`fn.name` or `hook[i]`). */
  readonly hook: string;
  constructor(hook: string, cause: unknown) {
    super(`Checkpoint restore hook ${hook} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "CheckpointRestoreError";
    this.hook = hook;
  }
}

export interface RunCheckpointRestoreHooksOptions {
  /** Per-hook timeout; defaults to `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Caller abort: checked between hooks and combined into each hook's signal. */
  readonly signal?: AbortSignal;
}

/**
 * Run restore hooks sequentially and report the audit. A hook failure throws
 * `CheckpointRestoreError` immediately (later hooks do not run); an already-aborted caller signal
 * throws its own abort reason so the resume reads as cancelled rather than as a restore failure.
 */
export async function runCheckpointRestoreHooks<Context>(
  hooks: readonly CheckpointRestoreHook<Context>[],
  context: Context,
  options: RunCheckpointRestoreHooksOptions = {},
): Promise<CheckpointRestoreAudit> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS;
  const started = Date.now();
  const entries: CheckpointRestoreAuditEntry[] = [];
  for (const [index, hook] of hooks.entries()) {
    options.signal?.throwIfAborted();
    const name = hook.name || `hook[${index}]`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const hookStarted = Date.now();
    try {
      await hook(context, signal);
    } catch (error) {
      // Our own abort means the hook either ignored the signal or lost the race; name the timeout.
      const timedOut = controller.signal.aborted && !options.signal?.aborted;
      throw new CheckpointRestoreError(name, timedOut ? controller.signal.reason : error);
    } finally {
      clearTimeout(timer);
    }
    entries.push({ hook: name, durationMs: Date.now() - hookStarted });
  }
  return { hooks: entries, durationMs: Date.now() - started };
}
