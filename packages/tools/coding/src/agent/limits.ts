export const DEFAULT_MAX_LINES = 2_000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export const DEFAULT_MAX_TEXT_SCAN_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;

export const DEFAULT_MAX_WRITE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_FILE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_INPUT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_EDITS = 100;

export const DEFAULT_SHELL_TIMEOUT_SECONDS = 600;
export const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Repository list/search defaults and hard caps (Phase 4 / review-coverage). */
export const DEFAULT_MAX_REPO_DEPTH = 32;
export const DEFAULT_MAX_REPO_ENTRIES = 10_000;
export const DEFAULT_MAX_REPO_FILES = 10_000;
export const DEFAULT_MAX_REPO_RESULTS = 1_000;
export const DEFAULT_MAX_REPO_CONCURRENCY = 8;

export const DEFAULT_MAX_SEARCH_SCAN_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_SEARCH_FILE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_SEARCH_MATCHES = 1_000;
export const DEFAULT_MAX_SEARCH_PATTERN_BYTES = 512;
export const DEFAULT_MAX_SEARCH_LINE_BYTES = 50 * 1024;
export const DEFAULT_MAX_SEARCH_CONTEXT_LINES = 5;
export const DEFAULT_MAX_SEARCH_TIME_MS = 30_000;
export const DEFAULT_BINARY_SNIFF_BYTES = 8_192;

/** Structured Git / named-check / PR-handoff defaults and hard caps (Phase 4). */
export const DEFAULT_MAX_GIT_PATHS = 1_000;
export const DEFAULT_MAX_GIT_REF_BYTES = 1_024;
export const DEFAULT_MAX_GIT_MESSAGE_BYTES = 64 * 1024;
export const DEFAULT_MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Phase 9 freeze: `git ls-files` stdout cap for ignore-aware enumeration. */
export const DEFAULT_MAX_LS_FILES_OUTPUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_GIT_DIFF_LINES = 10_000;
export const DEFAULT_MAX_GIT_CHANGED_FILES = 1_000;
export const DEFAULT_MAX_GIT_PATCH_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_GIT_WORKTREES = 4;
export const DEFAULT_GIT_TIMEOUT_MS = 120_000;

export const DEFAULT_MAX_CHECK_CONCURRENCY = 1;
export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MAX_CHECK_DIAGNOSTIC_LINES = 2_000;
export const DEFAULT_MAX_CHECK_OUTPUT_BYTES = 4 * 1024 * 1024;

export const DEFAULT_MAX_PR_HANDOFF_BYTES = 256 * 1024;
export const DEFAULT_MAX_PR_COMMITS = 100;

/** Durable coding plan / checkpoint metadata defaults and hard caps (Phase 4 Task 4). */
export const DEFAULT_MAX_PLAN_BYTES = 256 * 1024;
export const DEFAULT_MAX_TODOS = 1_000;
export const DEFAULT_MAX_TODO_TEXT_BYTES = 512;
export const DEFAULT_MAX_CODING_ARTIFACTS = 16;
export const DEFAULT_MAX_CODING_ARTIFACT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_CHECK_SUMMARY_BYTES = 1_024;
export const DEFAULT_MAX_CODING_CHECKPOINT_BYTES = 64 * 1024;

/** Phase 9 freeze: language-intelligence / LSP client caps. */
export const DEFAULT_MAX_LSP_MESSAGE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_LSP_DIAGNOSTICS_PER_FILE = 200;
export const DEFAULT_MAX_LSP_PENDING_REQUESTS = 32;
export const DEFAULT_MAX_LSP_RESULTS_PER_QUERY = 500;
export const DEFAULT_MAX_LSP_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_LSP_SERVERS = 4;
/** Freeze: restart budget is fixed at 3 (not host-configurable above). */
export const LSP_RESTARTS_PER_SERVER = 3;

/** Phase 9 freeze: managed process-session caps. */
export const DEFAULT_MAX_PROCESS_SESSIONS = 8;
export const DEFAULT_MAX_PROCESS_INPUT_BYTES = 64 * 1024;
export const DEFAULT_MAX_PROCESS_LIFETIME_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES = 50 * 1024;
/** Total output reuses existing accumulator ceilings (64 MiB / 1 GiB). */
export const DEFAULT_MAX_PROCESS_TOTAL_OUTPUT_BYTES = DEFAULT_MAX_TOTAL_OUTPUT_BYTES;

/** Phase 26 Task 0 freeze: host-selected PTY terminal caps (interactive sessions). */
export const DEFAULT_MAX_TERMINAL_COLUMNS = 120;
export const DEFAULT_MAX_TERMINAL_ROWS = 40;
export const DEFAULT_MAX_TERMINAL_TERM_BYTES = 64;
export const DEFAULT_MAX_TERMINAL_RESIZES_PER_MINUTE = 60;
export const DEFAULT_MAX_PTY_ATTACH_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_PTY_BACKEND_METADATA_BYTES = 4 * 1024;

/** Phase 26 Task 0 freeze: host index caps (indexed_literal/semantic grep). */
export const DEFAULT_MAX_INDEX_UPDATE_FILES = 1_000;
export const DEFAULT_MAX_INDEX_UPDATE_BYTES = 16 * 1024 * 1024;
/** Index result cap reuses the repository results caps (1000 / 10000). */
export const DEFAULT_MAX_INDEX_SNIPPET_BYTES = 4 * 1024;
export const DEFAULT_MAX_INDEX_STALE_MAX_AGE_MS = 60_000;
export const DEFAULT_MAX_INDEX_QUERY_TIMEOUT_MS = 30_000;

/** Diagnostic caps shared by `coding_check` deltas and the `diagnostics` tool. */
export const DEFAULT_MAX_REVIEW_DIAGNOSTICS = 500;
export const DEFAULT_MAX_DIAGNOSTIC_MESSAGE_BYTES = 4 * 1024;

/** Forge (GitHub adapter) defaults and hard caps (Phase 9 Task 5). */
export const DEFAULT_MAX_FORGE_PAGES_PER_OPERATION = 10;
export const DEFAULT_MAX_FORGE_PAYLOAD_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FORGE_COMMENTS_PER_REVIEW = 100;
export const DEFAULT_MAX_FORGE_REQUEST_CONCURRENCY = 4;
export const DEFAULT_MAX_FORGE_REQUEST_TIMEOUT_MS = 30_000;

/** Plan 165 Task 6: `workspace.diff` bounds (files listed, bytes of one file's diff). */
export const DEFAULT_MAX_WORKSPACE_DIFF_FILES = 200;
export const DEFAULT_MAX_WORKSPACE_DIFF_BYTES = 1024 * 1024;

/** Plan 026 Task 5: durable process/ACP recovery caps (frozen in the phase26 manifest). */
export const DEFAULT_MAX_RECOVERY_RECORDS = 32;
export const DEFAULT_MAX_RECOVERY_LEASE_TTL_MS = 30_000;
export const DEFAULT_MAX_RECOVERY_ATTACH_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RECOVERY_BACKEND_REF_BYTES = 1024;
export const DEFAULT_MAX_RECOVERY_RECORD_BYTES = 64 * 1024;

/**
 * Validate one coding limit. Invalid values fail instead of clamping. `ceiling` is given only for a value a model
 * passes as a tool argument; a host-set value has no ceiling above it (plan 239 Task 5: the host's value is the cap).
 */
export function validateCodingLimit(name: string, value: number, ceiling?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (ceiling !== undefined && value > ceiling)) {
    throw new Error(
      ceiling === undefined ? `${name} must be a positive safe integer` : `${name} must be a positive safe integer at most ${ceiling}`,
    );
  }
  return value;
}

/** Validate a non-negative integer limit (0 allowed); `ceiling` as for {@link validateCodingLimit}. */
export function validateCodingLimitAllowZero(name: string, value: number, ceiling?: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || (ceiling !== undefined && value > ceiling)) {
    throw new Error(
      ceiling === undefined
        ? `${name} must be a non-negative safe integer`
        : `${name} must be a non-negative safe integer at most ${ceiling}`,
    );
  }
  return value;
}

/**
 * Ceilings on values a model passes as coding tool arguments (plan 239 Task 5). The host raises or lowers each in
 * the `ceilings` tool option or `packageConfig["@arnilo/prism-tools/coding"].ceilings`; the model never can.
 */
export interface CodingArgCeilings {
  /** `grep({ maxMatches })`. Default 10,000. */
  readonly searchMatches?: number;
  /** `grep({ context })`. Default 20. */
  readonly searchContextLines?: number;
  /** `glob` / `ls` `maxResults`. Default 10,000. */
  readonly repoResults?: number;
  /** `glob` / `ls` `maxDepth`. Default 128. */
  readonly repoDepth?: number;
  /** `shell({ timeout })`, in seconds. Default 3,600. */
  readonly shellTimeoutSeconds?: number;
  /** `shell_output({ waitSeconds })`. Default 60. */
  readonly backgroundWaitSeconds?: number;
  /** `delete({ recursive: true, maxEntries })`. Default 100,000. */
  readonly recursiveDeleteEntries?: number;
}

export type ResolvedCodingArgCeilings = { readonly [K in keyof CodingArgCeilings]-?: number };

export const DEFAULT_CODING_ARG_CEILINGS: ResolvedCodingArgCeilings = Object.freeze({
  searchMatches: 10_000,
  searchContextLines: 20,
  repoResults: 10_000,
  repoDepth: 128,
  shellTimeoutSeconds: 3_600,
  backgroundWaitSeconds: 60,
  recursiveDeleteEntries: 100_000,
});

/** The host's `ceilings` over the defaults; each a positive safe integer, an unknown key rejected. */
export function resolveCodingArgCeilings(ceilings?: CodingArgCeilings): ResolvedCodingArgCeilings {
  const out: Record<string, number> = { ...DEFAULT_CODING_ARG_CEILINGS };
  for (const [key, value] of Object.entries(ceilings ?? {})) {
    if (!(key in DEFAULT_CODING_ARG_CEILINGS)) throw new Error(`ceilings.${key} is not a coding argument ceiling`);
    if (value !== undefined) out[key] = validateCodingLimit(`ceilings.${key}`, value as number);
  }
  return Object.freeze(out) as ResolvedCodingArgCeilings;
}
