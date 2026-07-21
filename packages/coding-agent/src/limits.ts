export const DEFAULT_MAX_LINES = 2_000;
export const HARD_MAX_LINES = 100_000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const HARD_MAX_BYTES = 1024 * 1024;

export const DEFAULT_MAX_TEXT_SCAN_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_TEXT_SCAN_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;
export const HARD_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export const DEFAULT_MAX_WRITE_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_WRITE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_FILE_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_EDIT_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_INPUT_BYTES = 2 * 1024 * 1024;
export const HARD_MAX_EDIT_INPUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_EDITS = 100;
export const HARD_MAX_EDITS = 1_000;

export const DEFAULT_SHELL_TIMEOUT_SECONDS = 600;
export const HARD_SHELL_TIMEOUT_SECONDS = 3_600;
export const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_TOTAL_OUTPUT_BYTES = 1024 * 1024 * 1024;

/** Repository list/search defaults and hard caps (Phase 4 / review-coverage). */
export const DEFAULT_MAX_REPO_DEPTH = 32;
export const HARD_MAX_REPO_DEPTH = 128;
export const DEFAULT_MAX_REPO_ENTRIES = 10_000;
export const HARD_MAX_REPO_ENTRIES = 100_000;
export const DEFAULT_MAX_REPO_FILES = 10_000;
export const HARD_MAX_REPO_FILES = 100_000;
export const DEFAULT_MAX_REPO_RESULTS = 1_000;
export const HARD_MAX_REPO_RESULTS = 10_000;
export const DEFAULT_MAX_REPO_CONCURRENCY = 8;
export const HARD_MAX_REPO_CONCURRENCY = 32;

export const DEFAULT_MAX_SEARCH_SCAN_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_SEARCH_SCAN_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_MAX_SEARCH_FILE_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_SEARCH_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_SEARCH_MATCHES = 1_000;
export const HARD_MAX_SEARCH_MATCHES = 10_000;
export const DEFAULT_MAX_SEARCH_PATTERN_BYTES = 512;
export const HARD_MAX_SEARCH_PATTERN_BYTES = 4_096;
export const DEFAULT_MAX_SEARCH_LINE_BYTES = 50 * 1024;
export const HARD_MAX_SEARCH_LINE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_SEARCH_CONTEXT_LINES = 5;
export const HARD_MAX_SEARCH_CONTEXT_LINES = 20;
export const DEFAULT_MAX_SEARCH_TIME_MS = 30_000;
export const HARD_MAX_SEARCH_TIME_MS = 300_000;
export const DEFAULT_BINARY_SNIFF_BYTES = 8_192;

/** Structured Git / named-check / PR-handoff defaults and hard caps (Phase 4). */
export const DEFAULT_MAX_GIT_PATHS = 1_000;
export const HARD_MAX_GIT_PATHS = 10_000;
export const DEFAULT_MAX_GIT_REF_BYTES = 1_024;
export const HARD_MAX_GIT_REF_BYTES = 4_096;
export const DEFAULT_MAX_GIT_MESSAGE_BYTES = 64 * 1024;
export const HARD_MAX_GIT_MESSAGE_BYTES = 256 * 1024;
export const DEFAULT_MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
export const HARD_MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_GIT_DIFF_LINES = 10_000;
export const HARD_MAX_GIT_DIFF_LINES = 100_000;
export const DEFAULT_MAX_GIT_CHANGED_FILES = 1_000;
export const HARD_MAX_GIT_CHANGED_FILES = 10_000;
export const DEFAULT_MAX_GIT_PATCH_BYTES = 16 * 1024 * 1024;
export const HARD_MAX_GIT_PATCH_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_GIT_WORKTREES = 4;
export const HARD_MAX_GIT_WORKTREES = 16;
export const DEFAULT_GIT_TIMEOUT_MS = 120_000;
export const HARD_GIT_TIMEOUT_MS = 600_000;

export const DEFAULT_MAX_CHECK_NAMES = 8;
export const HARD_MAX_CHECK_NAMES = 32;
export const DEFAULT_MAX_CHECK_CONCURRENCY = 1;
export const HARD_MAX_CHECK_CONCURRENCY = 4;
export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000;
export const HARD_CHECK_TIMEOUT_MS = 60 * 60_000;
export const DEFAULT_MAX_CHECK_DIAGNOSTIC_LINES = 2_000;
export const HARD_MAX_CHECK_DIAGNOSTIC_LINES = 100_000;
export const DEFAULT_MAX_CHECK_OUTPUT_BYTES = 4 * 1024 * 1024;
export const HARD_MAX_CHECK_OUTPUT_BYTES = 64 * 1024 * 1024;

export const DEFAULT_MAX_PR_HANDOFF_BYTES = 256 * 1024;
export const HARD_MAX_PR_HANDOFF_BYTES = 1024 * 1024;
export const DEFAULT_MAX_PR_COMMITS = 100;
export const HARD_MAX_PR_COMMITS = 1_000;

/** Durable coding plan / checkpoint metadata defaults and hard caps (Phase 4 Task 4). */
export const DEFAULT_MAX_PLAN_BYTES = 256 * 1024;
export const HARD_MAX_PLAN_BYTES = 1024 * 1024;
export const DEFAULT_MAX_TODOS = 1_000;
export const HARD_MAX_TODOS = 10_000;
export const DEFAULT_MAX_TODO_TEXT_BYTES = 512;
export const HARD_MAX_TODO_TEXT_BYTES = 4_096;
export const DEFAULT_MAX_CODING_ARTIFACTS = 16;
export const HARD_MAX_CODING_ARTIFACTS = 64;
export const DEFAULT_MAX_CODING_ARTIFACT_BYTES = 256 * 1024 * 1024;
export const HARD_MAX_CODING_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_CHECK_SUMMARY_BYTES = 1_024;
export const HARD_MAX_CHECK_SUMMARY_BYTES = 8_192;
export const DEFAULT_MAX_CODING_CHECKPOINT_BYTES = 64 * 1024;
export const HARD_MAX_CODING_CHECKPOINT_BYTES = 512 * 1024;

/** Validate one configurable coding resource limit. Invalid values fail instead of clamping. */
export function validateCodingLimit(name: string, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
    throw new Error(`${name} must be a positive safe integer at most ${hardCap}`);
  }
  return value;
}

/** Validate a non-negative integer limit (0 allowed), still capped. */
export function validateCodingLimitAllowZero(name: string, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > hardCap) {
    throw new Error(`${name} must be a non-negative safe integer at most ${hardCap}`);
  }
  return value;
}
