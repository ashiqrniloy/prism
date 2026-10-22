/**
 * The package's session state and its ledger log.
 *
 * State (`prism.state.session("om", …)`) holds the per-session toggle and the worker model refs the
 * `om:model` command set. The ledger itself is append-only and lives in the session log
 * (`prism.state.log("ledger")`), so later records never replace earlier ones and a fork carries the
 * records up to the fork point.
 */
import type { JsonObject, JsonValue, ModelRef } from "@arnilo/prism";

import { foldObservationalMemoryLedger, type ObservationalMemoryLedger } from "./ledger.js";

export const OM_STATE_KEY = "om";
export const OM_LEDGER_KEY = "ledger";

/** One session's toggle plus the worker model refs, stored as JSON (a `ModelRef` string or object). */
export interface ObservationalMemoryState {
  readonly enabled: boolean;
  readonly observerModel?: JsonValue;
  readonly reflectorModel?: JsonValue;
}

export function initialObservationalMemoryState(enabled: boolean): JsonObject {
  return { enabled };
}

/** The stored JSON as state, with an absent or malformed field read as unset. */
export function readObservationalMemoryState(value: JsonValue): ObservationalMemoryState {
  const record: JsonObject = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  return {
    enabled: record.enabled === true,
    ...(record.observerModel === undefined || record.observerModel === null ? {} : { observerModel: record.observerModel }),
    ...(record.reflectorModel === undefined || record.reflectorModel === null ? {} : { reflectorModel: record.reflectorModel }),
  };
}

/** State as the JSON the session slot persists. */
export function writeObservationalMemoryState(state: ObservationalMemoryState): JsonObject {
  return {
    enabled: state.enabled,
    ...(state.observerModel === undefined ? {} : { observerModel: state.observerModel }),
    ...(state.reflectorModel === undefined ? {} : { reflectorModel: state.reflectorModel }),
  };
}

/** The ref `om:model` stored, as the `ModelRef` the kernel resolves. */
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

/** The ledger a session's log records fold to. A record that is not one of the three is skipped. */
export function ledgerOf(records: readonly JsonValue[]): ObservationalMemoryLedger {
  return foldObservationalMemoryLedger(records);
}
