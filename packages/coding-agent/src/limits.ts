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
/** Phase 9 freeze: `git ls-files` stdout cap for ignore-aware enumeration. */
export const DEFAULT_MAX_LS_FILES_OUTPUT_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_LS_FILES_OUTPUT_BYTES = 64 * 1024 * 1024;
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

/** Phase 9 freeze: language-intelligence / LSP client caps. */
export const DEFAULT_MAX_LSP_MESSAGE_BYTES = 4 * 1024 * 1024;
export const HARD_MAX_LSP_MESSAGE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_LSP_DIAGNOSTICS_PER_FILE = 200;
export const HARD_MAX_LSP_DIAGNOSTICS_PER_FILE = 1_000;
export const DEFAULT_MAX_LSP_PENDING_REQUESTS = 32;
export const HARD_MAX_LSP_PENDING_REQUESTS = 128;
export const DEFAULT_MAX_LSP_RESULTS_PER_QUERY = 500;
export const HARD_MAX_LSP_RESULTS_PER_QUERY = 5_000;
export const DEFAULT_MAX_LSP_TIMEOUT_MS = 30_000;
export const HARD_MAX_LSP_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_LSP_SERVERS = 4;
export const HARD_MAX_LSP_SERVERS = 8;
/** Freeze: restart budget is fixed at 3 (not host-configurable above). */
export const LSP_RESTARTS_PER_SERVER = 3;

/** Phase 9 freeze: managed process-session caps. */
export const DEFAULT_MAX_PROCESS_SESSIONS = 8;
export const HARD_MAX_PROCESS_SESSIONS = 32;
export const DEFAULT_MAX_PROCESS_INPUT_BYTES = 64 * 1024;
export const HARD_MAX_PROCESS_INPUT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_PROCESS_LIFETIME_MS = 4 * 60 * 60 * 1000;
export const HARD_MAX_PROCESS_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES = 50 * 1024;
export const HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES = 1024 * 1024;
/** Total output reuses existing accumulator ceilings (64 MiB / 1 GiB). */
export const DEFAULT_MAX_PROCESS_TOTAL_OUTPUT_BYTES = DEFAULT_MAX_TOTAL_OUTPUT_BYTES;
export const HARD_MAX_PROCESS_TOTAL_OUTPUT_BYTES = HARD_MAX_TOTAL_OUTPUT_BYTES;

/** Phase 26 Task 0 freeze: host-selected PTY terminal caps (interactive sessions). */
export const DEFAULT_MAX_TERMINAL_COLUMNS = 120;
export const HARD_MAX_TERMINAL_COLUMNS = 500;
export const DEFAULT_MAX_TERMINAL_ROWS = 40;
export const HARD_MAX_TERMINAL_ROWS = 200;
export const DEFAULT_MAX_TERMINAL_TERM_BYTES = 64;
export const HARD_MAX_TERMINAL_TERM_BYTES = 256;
export const DEFAULT_MAX_TERMINAL_RESIZES_PER_MINUTE = 60;
export const HARD_MAX_TERMINAL_RESIZES_PER_MINUTE = 600;
export const DEFAULT_MAX_PTY_ATTACH_TIMEOUT_MS = 30_000;
export const HARD_MAX_PTY_ATTACH_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_PTY_BACKEND_METADATA_BYTES = 4 * 1024;
export const HARD_MAX_PTY_BACKEND_METADATA_BYTES = 16 * 1024;

/** Phase 26 Task 0 freeze: host index caps (indexed_literal/semantic repo_search). */
export const DEFAULT_MAX_INDEX_UPDATE_FILES = 1_000;
export const HARD_MAX_INDEX_UPDATE_FILES = 10_000;
export const DEFAULT_MAX_INDEX_UPDATE_BYTES = 16 * 1024 * 1024;
export const HARD_MAX_INDEX_UPDATE_BYTES = 64 * 1024 * 1024;
/** Index result cap reuses the repository results caps (1000 / 10000). */
export const DEFAULT_MAX_INDEX_SNIPPET_BYTES = 4 * 1024;
export const HARD_MAX_INDEX_SNIPPET_BYTES = 16 * 1024;
export const DEFAULT_MAX_INDEX_STALE_MAX_AGE_MS = 60_000;
export const HARD_MAX_INDEX_STALE_MAX_AGE_MS = 300_000;
export const DEFAULT_MAX_INDEX_QUERY_TIMEOUT_MS = 30_000;
export const HARD_MAX_INDEX_QUERY_TIMEOUT_MS = 120_000;

/** Forge (GitHub adapter) defaults and hard caps (Phase 9 Task 5). */
export const DEFAULT_MAX_FORGE_PAGES_PER_OPERATION = 10;
export const HARD_MAX_FORGE_PAGES_PER_OPERATION = 100;
export const DEFAULT_MAX_FORGE_PAYLOAD_BYTES = 1024 * 1024;
export const HARD_MAX_FORGE_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_FORGE_COMMENTS_PER_REVIEW = 100;
export const HARD_MAX_FORGE_COMMENTS_PER_REVIEW = 1000;
export const DEFAULT_MAX_FORGE_REQUEST_CONCURRENCY = 4;
export const HARD_MAX_FORGE_REQUEST_CONCURRENCY = 8;
export const DEFAULT_MAX_FORGE_REQUEST_TIMEOUT_MS = 30_000;
export const HARD_MAX_FORGE_REQUEST_TIMEOUT_MS = 120_000;

/** Phase 26 Task 0 freeze: coding workspace lifecycle caps (multi-repo/worktree, plan 026 Task 3). */
export const DEFAULT_MAX_WORKSPACE_REPOSITORIES = 4;
export const HARD_MAX_WORKSPACE_REPOSITORIES = 16;
/** Worktree cap reuses the git worktree caps (4 / 16). */
export const DEFAULT_MAX_WORKSPACE_WORKTREES = DEFAULT_MAX_GIT_WORKTREES;
export const HARD_MAX_WORKSPACE_WORKTREES = HARD_MAX_GIT_WORKTREES;
export const DEFAULT_MAX_WORKSPACE_RECORD_BYTES = 64 * 1024;
export const HARD_MAX_WORKSPACE_RECORD_BYTES = 256 * 1024;
export const DEFAULT_MAX_WORKSPACE_LEASE_TTL_MS = 30_000;
export const HARD_MAX_WORKSPACE_LEASE_TTL_MS = 300_000;
export const DEFAULT_MAX_WORKSPACE_CLEANUP_OPERATIONS = 100;
export const HARD_MAX_WORKSPACE_CLEANUP_OPERATIONS = 1_000;

/** Plan 026 Task 5: durable process/ACP recovery caps (frozen in the phase26 manifest). */
export const DEFAULT_MAX_RECOVERY_RECORDS = 32;
export const HARD_MAX_RECOVERY_RECORDS = 128;
export const DEFAULT_MAX_RECOVERY_LEASE_TTL_MS = 30_000;
export const HARD_MAX_RECOVERY_LEASE_TTL_MS = 300_000;
export const DEFAULT_MAX_RECOVERY_ATTACH_TIMEOUT_MS = 30_000;
export const HARD_MAX_RECOVERY_ATTACH_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RECOVERY_BACKEND_REF_BYTES = 1024;
export const HARD_MAX_RECOVERY_BACKEND_REF_BYTES = 4 * 1024;
export const DEFAULT_MAX_RECOVERY_RECORD_BYTES = 64 * 1024;
export const HARD_MAX_RECOVERY_RECORD_BYTES = 256 * 1024;

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
