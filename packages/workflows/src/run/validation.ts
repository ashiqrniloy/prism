/** validation (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */

import type { JsonObject } from "@arnilo/prism";
import { WorkflowRuntimeError } from "../errors.js";
import { DEFAULT_MAX_STATE_BYTES, DEFAULT_MAX_STATE_HISTORY } from "../limits.js";
import type { RunWorkflowOptions } from "../types.js";
import { assertWithinBytes, redactValue } from "../util.js";
import { cloneState } from "./checkpoint.js";
import type { SchedulerState } from "./main.js";

export async function validateState(state: SchedulerState, options: RunWorkflowOptions): Promise<void> {
  const maxBytes = state.workflow.limits?.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES;
  assertWithinBytes(state.state, maxBytes, "Workflow state");
  if (state.workflow.state?.schema && !options.validateState) {
    throw new WorkflowRuntimeError("Workflow state schema requires validateState", "ERR_PRISM_WORKFLOW_STATE_VALIDATOR");
  }
  if (options.validateState) {
    await awaitSignal(
      Promise.resolve(
        options.validateState({
          value: cloneState(state.state),
          schema: state.workflow.state?.schema,
          signal: options.signal,
        }),
      ),
      options.signal,
    );
  }
}

async function awaitSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function updateWorkflowState(
  state: SchedulerState,
  patch: JsonObject,
  updateOptions: import("../types.js").WorkflowStateUpdateOptions | undefined,
  options: RunWorkflowOptions,
): Promise<Readonly<JsonObject>> {
  let result: JsonObject = state.state;
  const update = state.stateChain
    .catch(() => undefined)
    .then(async () => {
      const next = updateOptions?.mode === "replace" ? cloneState(patch) : { ...cloneState(state.state), ...cloneState(patch) };
      const redacted = redactValue(next, options.redactor);
      const maxHistory = state.workflow.limits?.maxStateHistory ?? DEFAULT_MAX_STATE_HISTORY;
      if (state.stateVersion + 1 >= maxHistory) {
        throw new WorkflowRuntimeError(
          `Workflow state history exceeds maxStateHistory (${maxHistory})`,
          "ERR_PRISM_WORKFLOW_STATE_HISTORY",
        );
      }
      const candidate: SchedulerState = { ...state, state: redacted };
      await validateState(candidate, options);
      state.state = redacted;
      state.stateVersion += 1;
      state.stateHistory.set(state.stateVersion, cloneState(redacted));
      result = cloneState(redacted);
    });
  state.stateChain = update.catch(() => undefined);
  await update;
  return result;
}

/** Resolve the effective fan-out limit for a node. */
