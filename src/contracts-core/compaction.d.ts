/** Contracts-core compaction family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ErrorInfo } from "./content.js";
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
 * Not an auto-compaction seam of its own: the session's only auto trigger is the `compaction.when`
 * hook, and a handler composes this gate as its own policy (OM's attach loop and Prism Code's
 * `compaction` config do). Kept because the four trigger kinds are policy no caller should re-derive.
 */
export type CompactionTrigger = {
    readonly type: "threshold_entries";
    readonly entries: number;
} | {
    readonly type: "threshold_tokens";
    readonly tokens: number;
} | {
    readonly type: "input_ratio";
    readonly ratio: number;
} | {
    readonly type: "each_turn";
} | {
    readonly type: "custom";
    readonly shouldCompact: (context: CompactionTriggerContext) => boolean | Promise<boolean>;
};
/** Validate a host trigger at config time, so an unknown `type` fails at create (C11). */
export declare function assertCompactionTrigger(trigger: CompactionTrigger): CompactionTrigger;
/**
 * Non-strategy compaction knobs. The implementation is the `compaction` slot (`AgentConfig.slots
 * .compaction`); these only size and time it. `false` on `AgentConfig.compaction`/`RunOptions
 * .compaction` disables compaction entirely.
 */
export interface CompactionOptions {
    /** Entry-count gate for the kernel's default auto trigger; used only when every `compaction.when` handler abstains. */
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
export declare function resolveShouldCompact(options: ResolveShouldCompactOptions, input: ResolveShouldCompactInput): Promise<boolean>;
export interface CompactionEntryData {
    readonly throughEntryId?: string;
    readonly keepEntryIds?: readonly string[];
    readonly strategy?: string;
    readonly trigger?: CompactionReason | string;
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
