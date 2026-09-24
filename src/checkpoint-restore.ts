/**
 * Checkpoint restore hooks (plan 094 Task 3; reverse compensation plan 109 Task 2). A hook restores
 * one external layer (git commit, document version, workspace fingerprint) recorded in a
 * checkpoint's sidecar metadata.
 *
 * All-or-nothing: hooks run before the resume claims the checkpoint. The first hook that fails or
 * times out aborts the resume with `CheckpointRestoreError` naming that hook, so the conversation
 * restore never applies on top of a half-restored external world. A handler may also declare a
 * `compensate` direction: on failure the applied layers — including the failing one, which may be
 * half-applied — are undone in reverse order and the error carries a best-effort
 * `CheckpointRestoreCompensation` report. Compensation never runs after the caller aborted, never
 * masks the original failure, and the checkpoint stays resumable either way.
 */

import type { SecretRedactor } from "./redaction.js";

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
 * Host code restoring or compensating one external layer. `signal` aborts on the per-hook timeout
 * and on the caller's abort, so a hook that talks to a remote system can cancel instead of dangling.
 */
export type CheckpointRestoreHook<Context> = (checkpoint: Context, signal: AbortSignal) => void | Promise<void>;

/** Object form of a restore handler: an identity plus the layer's undo direction (plan 109 Task 2). */
interface CheckpointRestoreHandlerObject<Context> {
  /** Stable name reported in the audit and in `CheckpointRestoreError.compensation`; defaults to the restore hook's name, then `hook[i]`. */
  readonly id?: string;
  readonly restore: CheckpointRestoreHook<Context>;
  /** Undo for this layer, run when a later hook — or this one — fails. Absent = the layer has no undo. */
  readonly compensate?: CheckpointRestoreHook<Context>;
}

/**
 * A restore handler: today's bare function, or `{ id?, restore, compensate? }` to declare an undo
 * direction. Bare functions behave exactly as in plan 094 and are never compensated.
 */
export type CheckpointRestoreHandler<Context> = CheckpointRestoreHook<Context> | CheckpointRestoreHandlerObject<Context>;

/** Best-effort record of the reverse compensation pass after a failed restore (plan 109 Task 2). */
export interface CheckpointRestoreCompensation {
  /** Names of the hooks whose `compensate` ran, most recently applied layer first. */
  readonly ran: readonly string[];
  /** First compensation that failed; the pass still continues with the remaining layers. */
  readonly failed?: { readonly hook: string; readonly reason: string };
}

/** Thrown when a restore hook fails or times out; the checkpoint and conversation are untouched. */
export class CheckpointRestoreError extends Error {
  readonly code = "ERR_PRISM_CHECKPOINT_RESTORE";
  /** Name of the failing hook (`id`, `hook.name`, or `hook[i]`). */
  readonly hook: string;
  /** Present only when at least one `compensate` ran; omitted otherwise, as in plan 094. */
  declare readonly compensation?: CheckpointRestoreCompensation;
  constructor(hook: string, cause: unknown, compensation?: CheckpointRestoreCompensation) {
    super(`Checkpoint restore hook ${hook} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "CheckpointRestoreError";
    this.hook = hook;
    if (compensation) this.compensation = compensation;
  }
}

export interface RunCheckpointRestoreHooksOptions {
  /** Per-hook timeout; defaults to `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Caller abort: checked between hooks and combined into each hook's signal. */
  readonly signal?: AbortSignal;
  /** Applied to the bounded compensation reason; absent = the message is reported as-is (still capped). */
  readonly redactor?: SecretRedactor;
}

/** Compensation reasons are operator hints, not log lines: capped at this many UTF-8 bytes. */
const MAX_COMPENSATION_REASON_BYTES = 1_024;

interface NormalizedRestoreHandler<Context> {
  readonly id: string;
  readonly restore: CheckpointRestoreHook<Context>;
  readonly compensate?: CheckpointRestoreHook<Context>;
}

/** One handler identity per restore, resolved once at the executor boundary (plan 109 Task 2). */
function normalizeRestoreHandler<Context>(handler: CheckpointRestoreHandler<Context>, index: number): NormalizedRestoreHandler<Context> {
  if (typeof handler === "function") return { id: handler.name || `hook[${index}]`, restore: handler };
  return {
    id: handler.id ?? handler.restore.name ?? `hook[${index}]`,
    restore: handler.restore,
    ...(handler.compensate ? { compensate: handler.compensate } : {}),
  };
}

type RestoreHandlerOutcome = { readonly ok: true; readonly durationMs: number } | { readonly ok: false; readonly cause: unknown };

/** Run one direction of one handler under the per-hook timeout, reporting failure instead of throwing. */
async function invokeRestoreHandler<Context>(
  handler: CheckpointRestoreHook<Context>,
  context: Context,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<RestoreHandlerOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
  const started = Date.now();
  try {
    await handler(context, signal);
    return { ok: true, durationMs: Date.now() - started };
  } catch (error) {
    // Our own abort means the hook either ignored the signal or lost the race; name the timeout.
    const timedOut = controller.signal.aborted && !callerSignal?.aborted;
    return { ok: false, cause: timedOut ? controller.signal.reason : error };
  } finally {
    clearTimeout(timer);
  }
}

/** UTF-8-safe truncation; no suffix, so the cap is exact. */
function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}

/** Redacted, byte-bounded operator hint; hook arguments are never copied into it. */
function compensationReason(error: unknown, redactor: SecretRedactor | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateUtf8Bytes(redactor ? redactor.redact(message) : message, MAX_COMPENSATION_REASON_BYTES);
}

/**
 * Reverse pass over the applied layers (`failedIndex`…0, failing hook first). Best-effort: a
 * failing compensation is recorded once and the pass continues; a caller abort stops the pass and
 * rethrows the abort reason unchanged, so a cancel still reads as cancelled.
 */
async function compensateRestoreHandlers<Context>(
  handlers: readonly NormalizedRestoreHandler<Context>[],
  failedIndex: number,
  context: Context,
  timeoutMs: number,
  options: RunCheckpointRestoreHooksOptions,
): Promise<CheckpointRestoreCompensation | undefined> {
  const ran: string[] = [];
  let failed: CheckpointRestoreCompensation["failed"];
  for (let index = failedIndex; index >= 0; index -= 1) {
    const handler = handlers[index];
    if (!handler?.compensate) continue;
    options.signal?.throwIfAborted();
    const outcome = await invokeRestoreHandler(handler.compensate, context, timeoutMs, options.signal);
    options.signal?.throwIfAborted();
    ran.push(handler.id);
    if (!outcome.ok && failed === undefined) failed = { hook: handler.id, reason: compensationReason(outcome.cause, options.redactor) };
  }
  if (ran.length === 0) return undefined;
  return { ran, ...(failed ? { failed } : {}) };
}

/**
 * Run restore handlers sequentially and report the audit. A handler failure throws
 * `CheckpointRestoreError` immediately (later handlers do not run) after a best-effort reverse
 * compensation pass over the applied layers; with no `compensate` declared anywhere, the failure
 * shape is exactly plan 094's. An already-aborted caller signal throws its own abort reason so the
 * resume reads as cancelled rather than as a restore failure, and a caller abort during the pass
 * stops it before the next handler runs.
 */
export async function runCheckpointRestoreHooks<Context>(
  hooks: readonly CheckpointRestoreHandler<Context>[],
  context: Context,
  options: RunCheckpointRestoreHooksOptions = {},
): Promise<CheckpointRestoreAudit> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS;
  const started = Date.now();
  const entries: CheckpointRestoreAuditEntry[] = [];
  const handlers = hooks.map((handler, index) => normalizeRestoreHandler(handler, index));
  for (const [index, handler] of handlers.entries()) {
    options.signal?.throwIfAborted();
    const outcome = await invokeRestoreHandler(handler.restore, context, timeoutMs, options.signal);
    if (!outcome.ok) {
      // Security: never run host compensation code once the caller has aborted.
      const compensation = options.signal?.aborted
        ? undefined
        : await compensateRestoreHandlers(handlers, index, context, timeoutMs, options);
      throw new CheckpointRestoreError(handler.id, outcome.cause, compensation);
    }
    entries.push({ hook: handler.id, durationMs: outcome.durationMs });
  }
  return { hooks: entries, durationMs: Date.now() - started };
}
