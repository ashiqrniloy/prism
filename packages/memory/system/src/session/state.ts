/**
 * The package's session state and its ledger log.
 *
 * State (`prism.state.session("memory.session", …)`) holds the per-session toggle, the worker model
 * refs the `memory:session:model` command set, and the episode scope `memory:scope` set (`scope.ts`). The ledger itself is append-only and lives in the
 * session log (`prism.state.log("memory.session.ledger")`), so later records never replace earlier ones
 * and a fork carries the records up to the fork point.
 */
import type { JsonObject, JsonValue, ModelRef } from "@arnilo/prism";

import { foldObservationalMemoryLedger, type ObservationalMemoryLedger } from "./ledger.js";

export const SESSION_STATE_KEY = "memory.session";
export const SESSION_LEDGER_KEY = "memory.session.ledger";

/** One session's toggle plus the worker model refs, stored as JSON (a `ModelRef` string or object). */
export interface ObservationalMemoryState {
  readonly enabled: boolean;
  readonly stmModel?: JsonValue;
  readonly wmModel?: JsonValue;
  /** The episode scope as `scope.ts` stores it; `null` after `memory:scope { clear: true }`; absent when never set. */
  readonly scope?: JsonValue;
}

export function initialObservationalMemoryState(enabled: boolean): JsonObject {
  return { enabled };
}

/** The stored JSON as state, with an absent or malformed field read as unset. */
export function readObservationalMemoryState(value: JsonValue): ObservationalMemoryState {
  const record: JsonObject = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  return {
    enabled: record.enabled === true,
    ...(record.stmModel === undefined || record.stmModel === null ? {} : { stmModel: record.stmModel }),
    ...(record.wmModel === undefined || record.wmModel === null ? {} : { wmModel: record.wmModel }),
    ...(record.scope === undefined ? {} : { scope: record.scope }),
  };
}

/** State as the JSON the session slot persists. */
export function writeObservationalMemoryState(state: ObservationalMemoryState): JsonObject {
  return {
    enabled: state.enabled,
    ...(state.stmModel === undefined ? {} : { stmModel: state.stmModel }),
    ...(state.wmModel === undefined ? {} : { wmModel: state.wmModel }),
    ...(state.scope === undefined ? {} : { scope: state.scope }),
  };
}

/** The ref `memory:session:model` stored, as the `ModelRef` the kernel resolves. */
export function storedModelRef(value: JsonValue | undefined): ModelRef | undefined {
  return value === undefined ? undefined : (value as ModelRef);
}

/**
 * The JSON form of a `ModelRef`. Session state rejects a value that is not JSON, so a model object
 * carrying a function fails closed at the write (`state_not_json`) instead of persisting.
 */
export function toStoredModelRef(ref: ModelRef): JsonValue {
  return JSON.parse(JSON.stringify(ref)) as JsonValue;
}

/** The ledger a session's log records fold to. A record that is not a ledger record (a `scope.set`) is skipped. */
export function ledgerOf(records: readonly JsonValue[]): ObservationalMemoryLedger {
  return foldObservationalMemoryLedger(records);
}
