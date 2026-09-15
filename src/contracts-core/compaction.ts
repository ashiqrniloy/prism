/** Contracts-core compaction family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ErrorInfo } from "./content.js";
import type { SessionEntry } from "./session.js";

export interface CompactionStrategy {
  readonly name: string;
  compact(context: CompactionContext): Promise<CompactionResult> | CompactionResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompactionContext {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  readonly keepRecentEntries?: number;
  readonly trigger?: "manual" | "auto" | string;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface CompactionResult {
  readonly summary: string;
  readonly entries?: readonly SessionEntry[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Inputs a compaction trigger decides on. Estimates and ids only — never raw payloads. */
export interface CompactionTriggerContext {
  readonly sessionId: string;
  readonly entryCount: number;
  readonly estimatedInputTokens: number;
  readonly inputCapTokens: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** Host-programmable compact-when gate (plan 074 C11). Omitted → `thresholdEntries` only. */
export type CompactionTrigger =
  | { readonly type: "threshold_entries"; readonly entries: number }
  | { readonly type: "input_ratio"; readonly ratio: number }
  | {
      readonly type: "custom";
      readonly shouldCompact: (context: CompactionTriggerContext) => boolean | Promise<boolean>;
    };

/** Validate a host trigger at config time, so an unknown `type` fails at create (C11). */
export function assertCompactionTrigger(trigger: CompactionTrigger): CompactionTrigger {
  if (typeof trigger !== "object" || trigger === null) {
    throw new TypeError("compaction trigger must be an object");
  }
  switch (trigger.type) {
    case "threshold_entries":
      if (!Number.isSafeInteger(trigger.entries) || trigger.entries < 1) {
        throw new TypeError("compaction trigger threshold_entries.entries must be a positive safe integer");
      }
      return trigger;
    case "input_ratio":
      if (!Number.isFinite(trigger.ratio) || trigger.ratio <= 0 || trigger.ratio >= 1) {
        throw new TypeError("compaction trigger input_ratio.ratio must be a number in (0, 1)");
      }
      return trigger;
    case "custom":
      if (typeof trigger.shouldCompact !== "function") {
        throw new TypeError("compaction trigger custom.shouldCompact must be a function");
      }
      return trigger;
    default:
      throw new TypeError(`unknown compaction trigger type: ${String((trigger as { type?: unknown }).type)}`);
  }
}

export interface CompactionOptions {
  readonly strategy?: CompactionStrategy;
  readonly thresholdEntries?: number;
  /** Replaces the `thresholdEntries` gate when set; omitted keeps today's entry-count gate. */
  readonly trigger?: CompactionTrigger;
  readonly keepRecentEntries?: number;
  readonly maxSummaryChars?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** Legacy gates a compaction decision can fall back to when no `trigger` is configured. */
export interface ResolveShouldCompactOptions {
  /** Host trigger; when set it replaces the legacy gates below. */
  readonly trigger?: CompactionTrigger;
  /** Session gate: compact when the branch holds more than this many entries. */
  readonly thresholdEntries?: number;
  /** Attach-loop gate: compact when the estimated input is at or above this many tokens. */
  readonly compactAfterTokens?: number;
}

/** Everything a compaction decision reads. Estimates only — never raw payloads. */
export interface ResolveShouldCompactInput {
  readonly sessionId: string;
  readonly entryCount: number;
  /** Estimated tokens of the would-be input; called at most once, and only when a ratio or custom trigger reads it. */
  readonly estimateInputTokens: () => number;
  /** Resolved input cap (the attention compiler's `resolveInputCap`); called at most once, and only when a ratio or custom trigger reads it. */
  readonly resolveInputCapTokens: () => number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  /** Receives the failure behind a fail-closed `false`. */
  readonly onError?: (error: unknown) => void;
}

/**
 * The single compact-when decision used by `autoCompact` and by host attach loops that gate their
 * own post-run compaction (plan 074 C11).
 *
 * Precedence: an explicit `trigger` replaces the legacy gates. Only the token gates below a `trigger`
 * replace are lazy — a `threshold_entries` trigger, or a `custom` callback that only reads counts,
 * never pays for the token estimate or the input cap.
 *
 * Failure policy: a malformed trigger throws (`assertCompactionTrigger`, config error), while a
 * throwing `custom.shouldCompact` — including a callback that reads an unresolvable cap — decides
 * `false` and reports through `onError`, so a host bug can never compact on a guess.
 */
export async function resolveShouldCompact(options: ResolveShouldCompactOptions, input: ResolveShouldCompactInput): Promise<boolean> {
  let estimated: number | undefined;
  let cap: number | undefined;
  const estimateOnce = () => (estimated ??= input.estimateInputTokens());
  const capOnce = () => (cap ??= input.resolveInputCapTokens());

  const trigger = options.trigger;
  if (trigger === undefined) {
    if (options.thresholdEntries !== undefined) return input.entryCount > options.thresholdEntries;
    if (options.compactAfterTokens !== undefined) return estimateOnce() >= options.compactAfterTokens;
    return false;
  }
  assertCompactionTrigger(trigger);
  if (trigger.type === "threshold_entries") return input.entryCount > trigger.entries;
  if (trigger.type === "input_ratio") return estimateOnce() >= trigger.ratio * capOnce();

  // Getter-backed so a callback that only reads counts never forces cap resolution, which throws
  // when the active model declares no context window.
  const context: CompactionTriggerContext = {
    sessionId: input.sessionId,
    entryCount: input.entryCount,
    get estimatedInputTokens() {
      return estimateOnce();
    },
    get inputCapTokens() {
      return capOnce();
    },
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  try {
    return (await trigger.shouldCompact(context)) === true;
  } catch (error) {
    input.onError?.(error);
    return false;
  }
}

export interface CompactionMiddlewarePayload {
  readonly context: CompactionContext;
  readonly result: CompactionResult;
}

export interface CompactionEntryData {
  readonly throughEntryId?: string;
  readonly keepEntryIds?: readonly string[];
  readonly strategy?: string;
  readonly trigger?: "manual" | "auto" | string;
}

export interface RetryPolicy {
  readonly name: string;
  decide(context: RetryContext): Promise<RetryDecision> | RetryDecision;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly error: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryOptions {
  readonly policy?: RetryPolicy;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryMiddlewarePayload {
  readonly context: RetryContext;
  readonly decision: RetryDecision;
}
