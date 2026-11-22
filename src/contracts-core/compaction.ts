/** Contracts-core compaction family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ErrorInfo, JsonValue } from "./content.js";
import type { SessionEntry } from "./session.js";
import type { SessionContext } from "../session-context.js";

/** Who asked for a compaction: the kernel's configured trigger, a manual `session.compact()`, or overflow recovery. */
export type CompactionReason = "manual" | "auto" | "overflow";

export interface CompactionContext {
  readonly sessionId: string;
  /**
   * The slot owner's session view, when a package owns the `compaction` slot. Absent when the owner is
   * `"host"` or `"kernel"`. Needs the owner's own capabilities for `background` and `entries`.
   */
  readonly session?: SessionContext;
  readonly entries: readonly SessionEntry[];
  readonly keepRecentEntries?: number;
  /**
   * The active model's per-request input cap (`resolveInputCap`), when one resolves from the host's
   * spec or the provider catalog. Sizes the default compactor's token-budget tail.
   */
  readonly inputCapTokens?: number;
  /** `CompactionOptions.maxSummaryChars`, forwarded to the compactor (plan 229 Task 5). */
  readonly maxSummaryChars?: number;
  readonly trigger?: CompactionReason | string;
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

/**
 * Host-programmable compact-when gate, evaluated by {@link resolveShouldCompact}.
 *
 * Two uses: a `compaction.when` handler composes it as its own policy (the compaction package's
 * `trigger` does), and `CompactionOptions.trigger` sets the kernel's fallback, which runs only when
 * every handler abstains (plan 229 Task 4).
 */
export type CompactionTrigger =
  | { readonly type: "threshold_entries"; readonly entries: number }
  | { readonly type: "threshold_tokens"; readonly tokens: number }
  | { readonly type: "input_ratio"; readonly ratio: number }
  | { readonly type: "each_turn" }
  | {
      readonly type: "custom";
      readonly shouldCompact: (context: CompactionTriggerContext) => boolean | Promise<boolean>;
    };

/**
 * The kernel's auto trigger when `AgentConfig.compaction` sets neither `trigger` nor
 * `thresholdEntries` (plan 229 Task 4): compact at 80% of the model's input cap. A safety net against
 * provider rejection, not a quality gate: a measured `threshold_tokens` is the better host setting.
 * A model with no resolvable cap gets no default trigger.
 */
export const DEFAULT_COMPACTION_TRIGGER: Readonly<{ type: "input_ratio"; ratio: number }> = Object.freeze({
  type: "input_ratio",
  ratio: 0.8,
});

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
    case "threshold_tokens":
      if (!Number.isSafeInteger(trigger.tokens) || trigger.tokens < 1) {
        throw new TypeError("compaction trigger threshold_tokens.tokens must be a positive safe integer");
      }
      return trigger;
    case "input_ratio":
      if (!Number.isFinite(trigger.ratio) || trigger.ratio <= 0 || trigger.ratio >= 1) {
        throw new TypeError("compaction trigger input_ratio.ratio must be a number in (0, 1)");
      }
      return trigger;
    case "each_turn":
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

/**
 * Non-strategy compaction knobs. The implementation is the `compaction` slot (`AgentConfig.slots
 * .compaction`); these only size and time it. `false` on `AgentConfig.compaction`/`RunOptions
 * .compaction` turns off the kernel's auto trigger; a `compaction.when` vote and overflow recovery
 * still compact.
 */
export interface CompactionOptions {
  /**
   * The kernel's auto trigger, used only when every `compaction.when` handler abstains. Replaces
   * {@link DEFAULT_COMPACTION_TRIGGER}; when both this and `thresholdEntries` are set, this wins.
   */
  readonly trigger?: CompactionTrigger;
  /** Entry-count gate for the kernel's auto trigger; replaces {@link DEFAULT_COMPACTION_TRIGGER}. */
  readonly thresholdEntries?: number;
  readonly keepRecentEntries?: number;
  readonly maxSummaryChars?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** Gates a compaction decision can fall back to when no `trigger` is configured. */
export interface ResolveShouldCompactOptions {
  /** Host trigger; when set it replaces the gates below. */
  readonly trigger?: CompactionTrigger;
  /** Session gate: compact when the branch holds more than this many entries. */
  readonly thresholdEntries?: number;
}

/** Everything a compaction decision reads. Estimates only — never raw payloads. */
export interface ResolveShouldCompactInput {
  readonly sessionId: string;
  readonly entryCount: number;
  /** Turn index when called between turns; undefined at run start. */
  readonly turn?: number;
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
 * The compact-when decision used by the kernel's default auto trigger and by host attach loops
 * that gate their own post-run compaction (plan 074 C11).
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
    return false;
  }
  assertCompactionTrigger(trigger);
  if (trigger.type === "each_turn") return input.turn !== undefined && input.entryCount > 0;
  if (trigger.type === "threshold_entries") return input.entryCount > trigger.entries;
  if (trigger.type === "threshold_tokens") return estimateOnce() >= trigger.tokens;
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

export interface CompactionEntryData {
  readonly throughEntryId?: string;
  readonly keepEntryIds?: readonly string[];
  readonly strategy?: string;
  readonly trigger?: CompactionReason | string;
  /**
   * Written by the kernel, not the compactor (plan 230 Task 3): the state folded from the branch before
   * this entry, so a run reads the branch from here on (`SessionBranchRead.from: "compaction"`). A
   * compaction without it makes the kernel read the whole branch.
   */
  readonly checkpoint?: {
    readonly version: 1;
    /** Entries on the branch before this compaction entry. */
    readonly branchLength: number;
    /** `package_state` data in fold order: each key's latest `set`, then its `append` / `replace` records. */
    readonly packageState: readonly {
      readonly schemaVersion: 1;
      readonly package: string;
      readonly key: string;
      readonly value: JsonValue;
      readonly op?: "set" | "append" | "replace";
    }[];
    /** Per `(vendor, key)` totals of the `external_state` log: records held, their JSON bytes, the last `seq`. */
    readonly externalState: readonly {
      readonly vendor: string;
      readonly key: string;
      readonly count: number;
      readonly bytes: number;
      readonly seq: number;
    }[];
    /** Message, `run_checkpoint`, `session_limits` and session-links entries `keepEntryIds` names before `throughEntryId`, in branch order. */
    readonly pinnedEntryIds: readonly string[];
  };
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
  /** Longest provider `Retry-After` hint honored, in ms (default 60,000; hard cap 600,000). A hint
   *  within it is the delay exactly; a longer one fails the turn without sleeping. */
  readonly maxRetryAfterMs?: number;
  /**
   * Retry a run turn whose stream failed transiently after output began (default `true`). The failed
   * attempt ends with `turn.completed { error }` and the next opens with `turn.started { attempt, retry }`;
   * a consumer discards the failed attempt's deltas. The retry re-sends the whole request, so its input
   * tokens are billed again. `false` keeps such a failure final. Package model calls retry only before
   * their first event and ignore this field.
   */
  readonly afterOutput?: boolean;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}
