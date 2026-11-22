import { WorkflowDefinitionError } from "./errors.js";
import type { WorkflowLimits } from "./types.js";

/**
 * Workflow defaults. Every value is the host's to set (plan 239 Task 5): a workflow definition, a run option or an
 * adapter option carries it, and the host's value is the cap. There is no hidden ceiling above it.
 */

export const DEFAULT_MAX_NODES = 1000;
export const DEFAULT_MAX_FAN_OUT = 64;
/** A gate node's `maxIterations` when it sets none. A loop node must set its own. */
export const DEFAULT_MAX_GATE_ITERATIONS = 64;
export const WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_CONCURRENCY = 8;
export const DEFAULT_MAX_NODE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_CHECKPOINT_BYTES = 1 * 1024 * 1024;
export const DEFAULT_EVENT_BUFFER = 2048;
export const DEFAULT_LIST_PAGE_SIZE = 100;
/** Largest `list({ limit })` page a checkpoint adapter returns; `createWorkflowCheckpointAdapter({ maxListLimit })`. */
export const DEFAULT_MAX_LIST_LIMIT = 500;
export const DEFAULT_MAX_NESTED_DEPTH = 8;
export const DEFAULT_MAX_STATE_BYTES = 64 * 1024;
export const DEFAULT_MAX_STATE_HISTORY = 32;
export const DEFAULT_MAX_REPLAY_DEPTH = 8;
/** Retry wait per attempt of a failed node; `node.retryBackoff.stepMs`. */
export const DEFAULT_RETRY_BACKOFF_STEP_MS = 25;
/** Longest retry wait of a failed node; `node.retryBackoff.maxMs`. */
export const DEFAULT_MAX_RETRY_BACKOFF_MS = 1000;

export const WORKFLOW_CHECKPOINT_SCHEMA_VERSION = 2 as const;

const LIMIT_NAMES: readonly (keyof WorkflowLimits)[] = [
  "maxNodes",
  "maxFanOut",
  "maxConcurrency",
  "maxSupersteps",
  "maxNodeOutputBytes",
  "maxCheckpointBytes",
  "maxNestedDepth",
  "maxStateBytes",
  "maxStateHistory",
  "maxReplayDepth",
  "maxIterationRecords",
];

/** A configured workflow limit: a positive safe integer. The host's value is the cap. */
export function validateWorkflowLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkflowDefinitionError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function validateWorkflowLimits(limits?: WorkflowLimits): void {
  if (!limits) return;
  for (const name of LIMIT_NAMES) {
    const value = limits[name];
    // `maxSupersteps: null` is the host's explicit choice to leave a cyclic workflow unbounded.
    if (value === null && name === "maxSupersteps") continue;
    if (value !== undefined) validateWorkflowLimit(name, value as number);
  }
}
