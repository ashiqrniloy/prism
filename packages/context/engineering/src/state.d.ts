/**
 * Per-session state for `@arnilo/prism-context-engineering` (plan 158 Task 7).
 *
 * The kernel kept the attention sticky frontier and fold ledger in the durable run state and the
 * activated-tool set in a run-scoped object. A package has no run state, so both live in the
 * session's own package state instead:
 *
 * - the **sticky frontier** is one `state.session` value (bounded: 256 thinking keys + 256 tool-call
 *   ids), read synchronously per turn and written only when a stage mutates;
 * - the **fold ledger** is one `state.log` record per newly folded body, read synchronously per
 *   turn and rebuilt into the newest-64 ledger the compiler re-applies from. A log record rather
 *   than one big value keeps each write bounded by `maxSummaryBytes`;
 * - the **activated tool set** is one `state.session` value holding names only.
 *
 * Every reader fails closed: a record that does not parse restores nothing, so a resumed session
 * re-folds rather than re-applying a body it cannot trust.
 */
import type { JsonObject, JsonValue } from "@arnilo/prism";
import { type AttentionFoldLedger, type AttentionStickyFrontier } from "./attention.js";
export declare const ATTENTION_STATE_KEY = "contextEngineering.attention";
/** Cache-aware fold batch frontier (plan 194 Task 4): the tool-call ids already cleared. */
export declare const FOLD_FRONTIER_KEY = "contextEngineering.foldFrontier";
export declare const FOLD_LOG_KEY = "contextEngineering.folds";
export declare const ACTIVATED_TOOLS_KEY = "contextEngineering.activated";
/** Newest folded bodies kept in the rebuilt ledger; older ones are re-summarized on demand. */
export declare const MAX_LEDGER_BODIES = 64;
/** Newest cleared tool-call ids kept in the fold frontier. An evicted id re-folds to the same
 *  bytes on the next advance (the stub is derived from the stored result), so eviction is safe. */
export declare const MAX_FOLD_FRONTIER_IDS = 4096;
export interface AttentionSessionState {
    readonly frontier: AttentionStickyFrontier;
    readonly ledger: AttentionFoldLedger;
}
export declare function initialAttentionState(): JsonObject;
/** Read the frontier value; a malformed or absent value restores an empty frontier. */
export declare function readFrontier(value: JsonValue): AttentionStickyFrontier;
export declare function writeFrontier(frontier: AttentionStickyFrontier): JsonObject;
/** Rebuild the ledger from the log's records, newest last, capped at {@link MAX_LEDGER_BODIES}. */
export declare function readLedger(entries: readonly JsonValue[]): AttentionFoldLedger;
export declare function readAttentionState(frontierValue: JsonValue, logEntries: readonly JsonValue[]): AttentionSessionState;
/** The names-only activated set: persisted as an array so a reopened session keeps its activations. */
/** Read the batch frontier; a malformed or absent value restores nothing (fail closed). */
export declare function readFoldFrontier(value: JsonValue | undefined): ReadonlySet<string>;
export declare function writeFoldFrontier(ids: Iterable<string>): JsonObject;
export declare function readActivatedNames(value: JsonValue): readonly string[];
export declare function writeActivatedNames(names: readonly string[]): JsonObject;
