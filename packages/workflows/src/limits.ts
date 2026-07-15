/** Pinned Plan 057 performance defaults. */

export const DEFAULT_MAX_NODES = 1000;
export const DEFAULT_MAX_FAN_OUT = 64;
export const DEFAULT_MAX_CONCURRENCY = 8;
export const DEFAULT_MAX_NODE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_CHECKPOINT_BYTES = 1 * 1024 * 1024;
export const DEFAULT_EVENT_BUFFER = 2048;
export const DEFAULT_LIST_PAGE_SIZE = 100;
export const HARD_LIST_PAGE_CAP = 500;

export const WORKFLOW_CHECKPOINT_SCHEMA_VERSION = 1 as const;
