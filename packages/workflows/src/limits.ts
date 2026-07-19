import { WorkflowDefinitionError } from "./errors.js";
import type { WorkflowLimits } from "./types.js";

/** Workflow defaults and hard caps. */

export const DEFAULT_MAX_NODES = 1000;
export const HARD_MAX_NODES = 10_000;
export const DEFAULT_MAX_FAN_OUT = 64;
export const HARD_MAX_FAN_OUT = 1_024;
export const DEFAULT_MAX_CONCURRENCY = 8;
export const HARD_MAX_CONCURRENCY = 256;
export const DEFAULT_MAX_NODE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const HARD_MAX_NODE_OUTPUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_CHECKPOINT_BYTES = 1 * 1024 * 1024;
export const HARD_MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_NODE_RETRIES = 100;
export const HARD_MAX_NODE_TIMEOUT_MS = 86_400_000;
export const DEFAULT_EVENT_BUFFER = 2048;
export const DEFAULT_LIST_PAGE_SIZE = 100;
export const HARD_LIST_PAGE_CAP = 500;
export const DEFAULT_MAX_NESTED_DEPTH = 8;
export const HARD_MAX_NESTED_DEPTH = 32;
export const DEFAULT_MAX_STATE_BYTES = 64 * 1024;
export const HARD_MAX_STATE_BYTES = 512 * 1024;
export const DEFAULT_MAX_STATE_HISTORY = 32;
export const HARD_MAX_STATE_HISTORY = 128;
export const DEFAULT_MAX_REPLAY_DEPTH = 8;
export const HARD_MAX_REPLAY_DEPTH = 32;
export const DEFAULT_SCHEDULE_PAGE_SIZE = 100;
export const HARD_SCHEDULE_PAGE_CAP = 500;
export const DEFAULT_MAX_SCHEDULE_CLAIMS = 16;
export const HARD_MAX_SCHEDULE_CLAIMS = 256;
export const DEFAULT_SCHEDULE_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_SCHEDULE_LEASE_TTL_MS = 30_000;
export const DEFAULT_MAX_SCHEDULE_INPUT_BYTES = 256 * 1024;
export const HARD_MAX_SCHEDULE_INPUT_BYTES = 1 * 1024 * 1024;

export const WORKFLOW_CHECKPOINT_SCHEMA_VERSION = 1 as const;

const LIMIT_CAPS: Readonly<Record<keyof WorkflowLimits, number>> = {
  maxNodes: HARD_MAX_NODES,
  maxFanOut: HARD_MAX_FAN_OUT,
  maxConcurrency: HARD_MAX_CONCURRENCY,
  maxNodeOutputBytes: HARD_MAX_NODE_OUTPUT_BYTES,
  maxCheckpointBytes: HARD_MAX_CHECKPOINT_BYTES,
  maxNestedDepth: HARD_MAX_NESTED_DEPTH,
  maxStateBytes: HARD_MAX_STATE_BYTES,
  maxStateHistory: HARD_MAX_STATE_HISTORY,
  maxReplayDepth: HARD_MAX_REPLAY_DEPTH,
};

export function validateWorkflowLimit(name: string, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
    throw new WorkflowDefinitionError(`${name} must be a positive safe integer at most ${hardCap}`);
  }
  return value;
}

export function validateWorkflowLimits(limits?: WorkflowLimits): void {
  if (!limits) return;
  for (const [name, hardCap] of Object.entries(LIMIT_CAPS) as [keyof WorkflowLimits, number][]) {
    const value = limits[name];
    if (value !== undefined) validateWorkflowLimit(name, value, hardCap);
  }
}
