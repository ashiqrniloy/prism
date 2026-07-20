/** Default experiment worker concurrency. */
export const DEFAULT_EXPERIMENT_CONCURRENCY = 1;

/** Hard ceiling for experiment concurrency. */
export const HARD_EXPERIMENT_CONCURRENCY_CAP = 32;

/** Default sample rate (always score). */
export const DEFAULT_SAMPLE_RATE = 1;

/** Default page size for evaluation store queries. */
export const DEFAULT_EVALUATION_PAGE_SIZE = 100;

/** Hard ceiling for evaluation store page size. */
export const HARD_EVALUATION_PAGE_CAP = 1000;

export const DEFAULT_TRACE_PAGE_SIZE = 100;
export const HARD_TRACE_PAGE_SIZE = 1000;
export const DEFAULT_TRACE_PAGES = 20;
export const HARD_TRACE_PAGES = 100;
export const DEFAULT_TRACE_MAX_BYTES = 4 * 1024 * 1024;
export const HARD_TRACE_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;
export const HARD_JUDGE_TIMEOUT_MS = 300_000;
export const DEFAULT_JUDGE_MAX_ATTEMPTS = 1;
export const HARD_JUDGE_MAX_ATTEMPTS = 3;
export const DEFAULT_JUDGE_MAX_OUTPUT_BYTES = 16 * 1024;
export const HARD_JUDGE_MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_COMPARISON_CANDIDATES = 8;
export const HARD_COMPARISON_CANDIDATES = 32;
export const DEFAULT_REPORT_MAX_BYTES = 4 * 1024 * 1024;
export const HARD_REPORT_MAX_BYTES = 32 * 1024 * 1024;
export const HARD_DATASET_ITEMS = 10_000;
export const DEFAULT_CANDIDATE_MAX_BYTES = 1024 * 1024;
export const HARD_CANDIDATE_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_JUDGE_MAX_INPUT_BYTES = 1024 * 1024;
export const HARD_JUDGE_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_JUDGE_MAX_RUBRIC_BYTES = 16 * 1024;
export const HARD_JUDGE_MAX_RUBRIC_BYTES = 64 * 1024;
