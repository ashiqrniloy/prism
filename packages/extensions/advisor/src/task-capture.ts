import type { Message, PackageAPI } from "@arnilo/prism";
import { messageText } from "./consult.js";
import type { AdvisorConfig } from "./config.js";

/** Runs whose input was seen, so `validate` can pin the task even when the transcript slice is short. */
export interface CapturedTask {
  readonly messages: readonly Message[];
}

/** Process-memory record of each run's input. Dropped when the run ends; bounded against a leaked run id. */
export interface TaskStore {
  capture(runId: string, messages: readonly Message[]): void;
  get(runId: string): CapturedTask | undefined;
  forget(runId: string): void;
}

const MAX_CAPTURED_RUNS = 32;

export function createTaskStore(prism: PackageAPI<AdvisorConfig>): TaskStore {
  const runs = prism.state.agent<Record<string, CapturedTask>>("tasks", {});
  return {
    capture(runId, messages) {
      const current = runs.get();
      if (current[runId] !== undefined) return;
      // A steer also passes `run.input`: only the run's first input is the task, and an empty run
      // (a resume) must not overwrite what was captured.
      // An empty input (a resume, a bare `run("")`) is not a task; the validator infers from history.
      const task = messages.filter((message) => message.role === "user" && messageText(message).length > 0);
      if (task.length === 0) return;
      const next = { ...current, [runId]: { messages: task } };
      const ids = Object.keys(next);
      for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_CAPTURED_RUNS))) delete next[stale];
      runs.set(next);
    },
    get(runId) {
      return runs.get()[runId];
    },
    forget(runId) {
      const current = { ...runs.get() };
      if (current[runId] === undefined) return;
      delete current[runId];
      runs.set(current);
    },
  };
}

/**
 * Task capture, registered only when `validate` is set (it is the only reader). `run.input` supplies
 * the run id on its hook context (the payload is a bare message list), so the first input the run
 * passes through is kept as its task; a later steer is ignored because the run already has one. A run
 * whose input was not captured, such as one resumed after a restart, is handled by the validator: it
 * infers the task from the first user message of `history`.
 */
export function registerTaskCapture(prism: PackageAPI<AdvisorConfig>, store: TaskStore): void {
  prism.hooks.on("run.input", (messages, context) => {
    if (context.runId !== "") store.capture(context.runId, messages);
    return messages;
  });
}
