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
import {
  createAttentionFoldLedger,
  createAttentionStickyFrontier,
  type AttentionFoldLedger,
  type AttentionStickyFrontier,
  parseAttentionStickyFrontier,
  restoreAttentionStickyFrontier,
  serializeAttentionStickyFrontier,
} from "./attention.js";

export const ATTENTION_STATE_KEY = "contextEngineering.attention";
export const FOLD_LOG_KEY = "contextEngineering.folds";
export const ACTIVATED_TOOLS_KEY = "contextEngineering.activated";

/** Newest folded bodies kept in the rebuilt ledger; older ones are re-summarized on demand. */
export const MAX_LEDGER_BODIES = 64;

export interface AttentionSessionState {
  readonly frontier: AttentionStickyFrontier;
  readonly ledger: AttentionFoldLedger;
}

export function initialAttentionState(): JsonObject {
  return serializeAttentionStickyFrontier(createAttentionStickyFrontier()) as unknown as JsonObject;
}

/** Read the frontier value; a malformed or absent value restores an empty frontier. */
export function readFrontier(value: JsonValue): AttentionStickyFrontier {
  const parsed = parseAttentionStickyFrontier(value);
  return parsed ? restoreAttentionStickyFrontier(parsed) : createAttentionStickyFrontier();
}

export function writeFrontier(frontier: AttentionStickyFrontier): JsonObject {
  return serializeAttentionStickyFrontier(frontier) as unknown as JsonObject;
}

/** Rebuild the ledger from the log's records, newest last, capped at {@link MAX_LEDGER_BODIES}. */
export function readLedger(entries: readonly JsonValue[]): AttentionFoldLedger {
  const ledger = createAttentionFoldLedger();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as { readonly id?: unknown; readonly body?: unknown };
    if (typeof record.id !== "string" || typeof record.body !== "string") continue;
    ledger.bodies.set(record.id, record.body);
  }
  while (ledger.bodies.size > MAX_LEDGER_BODIES) {
    const oldest = ledger.bodies.keys().next();
    if (oldest.done) break;
    ledger.bodies.delete(oldest.value);
  }
  return ledger;
}

export function readAttentionState(frontierValue: JsonValue, logEntries: readonly JsonValue[]): AttentionSessionState {
  return { frontier: readFrontier(frontierValue), ledger: readLedger(logEntries) };
}

/** The names-only activated set: persisted as an array so a reopened session keeps its activations. */
export function readActivatedNames(value: JsonValue): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as { readonly activated?: unknown };
  if (!Array.isArray(record.activated)) return [];
  return record.activated.filter((entry): entry is string => typeof entry === "string");
}

export function writeActivatedNames(names: readonly string[]): JsonObject {
  return { activated: [...names] };
}


