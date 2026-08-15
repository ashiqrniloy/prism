/** Repository types family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */
import {
  DEFAULT_BINARY_SNIFF_BYTES,
  DEFAULT_MAX_REPO_CONCURRENCY,
  DEFAULT_MAX_REPO_DEPTH,
  DEFAULT_MAX_REPO_ENTRIES,
  DEFAULT_MAX_REPO_FILES,
  DEFAULT_MAX_REPO_RESULTS,
  DEFAULT_MAX_SEARCH_CONTEXT_LINES,
  DEFAULT_MAX_SEARCH_FILE_BYTES,
  DEFAULT_MAX_SEARCH_LINE_BYTES,
  DEFAULT_MAX_SEARCH_MATCHES,
  DEFAULT_MAX_SEARCH_PATTERN_BYTES,
  DEFAULT_MAX_SEARCH_SCAN_BYTES,
  DEFAULT_MAX_SEARCH_TIME_MS,
  HARD_MAX_REPO_CONCURRENCY,
  HARD_MAX_REPO_DEPTH,
  HARD_MAX_REPO_ENTRIES,
  HARD_MAX_REPO_FILES,
  HARD_MAX_REPO_RESULTS,
  HARD_MAX_SEARCH_CONTEXT_LINES,
  HARD_MAX_SEARCH_FILE_BYTES,
  HARD_MAX_SEARCH_LINE_BYTES,
  HARD_MAX_SEARCH_MATCHES,
  HARD_MAX_SEARCH_PATTERN_BYTES,
  HARD_MAX_SEARCH_SCAN_BYTES,
  HARD_MAX_SEARCH_TIME_MS,
  validateCodingLimit,
  validateCodingLimitAllowZero,
} from "../limits.js";

export type RepoEntryKind = "file" | "directory" | "symlink" | "other";

export interface RepoListEntry {
  readonly path: string;
  readonly kind: RepoEntryKind;
  readonly size?: number;
}

export interface RepositoryListResult {
  readonly entries: readonly RepoListEntry[];
  readonly truncated: boolean;
  readonly truncatedBy: "results" | "entries" | "files" | "depth" | "time" | "abort" | null;
  readonly scannedEntries: number;
  readonly scannedFiles: number;
  readonly nextOffset?: number;
  readonly offset: number;
}

export interface RepositoryGlobResult {
  readonly paths: readonly string[];
  readonly truncated: boolean;
  readonly truncatedBy: RepositoryListResult["truncatedBy"];
  readonly scannedEntries: number;
  readonly scannedFiles: number;
  readonly nextOffset?: number;
  readonly offset: number;
}

export type RepoSearchOutputMode = "content" | "files_with_matches" | "count";

export interface RepositorySearchMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface RepositorySearchResult {
  readonly matches: readonly RepositorySearchMatch[];
  readonly truncated: boolean;
  readonly truncatedBy: "matches" | "scan" | "file" | "entries" | "files" | "depth" | "time" | "abort" | "pattern" | null;
  readonly scannedBytes: number;
  readonly scannedFiles: number;
  readonly scannedEntries: number;
  readonly filesSkippedBinary: number;
  readonly filesSkippedOversize: number;
}

export interface ResolvedRepositoryLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxFiles: number;
  readonly maxResults: number;
  readonly maxConcurrency: number;
  readonly maxScanBytes: number;
  readonly maxFileBytes: number;
  readonly maxMatches: number;
  readonly maxPatternBytes: number;
  readonly maxLineBytes: number;
  readonly maxContextLines: number;
  readonly maxTimeMs: number;
  readonly binarySniffBytes: number;
  readonly exclude: readonly string[];
}

export interface RepositoryLimitOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly maxFiles?: number;
  readonly maxResults?: number;
  readonly maxConcurrency?: number;
  readonly maxScanBytes?: number;
  readonly maxFileBytes?: number;
  readonly maxMatches?: number;
  readonly maxPatternBytes?: number;
  readonly maxLineBytes?: number;
  readonly maxContextLines?: number;
  readonly maxTimeMs?: number;
  /** Basename denylist skipped during descent (default `.git`, `node_modules`, `dist`). */
  readonly exclude?: readonly string[];
}

export interface RepositoryListRequest {
  readonly root: string;
  readonly path?: string;
  readonly includeHidden?: boolean;
  readonly exclude?: readonly string[];
  readonly maxDepth?: number;
  readonly maxResults?: number;
  readonly offset?: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface RepositorySearchRequest {
  readonly root: string;
  readonly query: string;
  readonly path?: string;
  readonly mode?: "literal";
  readonly outputMode?: RepoSearchOutputMode;
  readonly caseSensitive?: boolean;
  readonly includeHidden?: boolean;
  readonly exclude?: readonly string[];
  readonly context?: number;
  readonly maxMatches?: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface RepositoryGlobRequest {
  readonly root: string;
  readonly pattern: string;
  readonly path?: string;
  readonly includeHidden?: boolean;
  readonly exclude?: readonly string[];
  readonly maxDepth?: number;
  readonly maxResults?: number;
  readonly offset?: number;
  /** Opt-in bounded `{a,b}` expansion (default false; expansion bounds in glob-match.ts). */
  readonly braceExpansion?: boolean;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface RepositoryOperations {
  list(request: RepositoryListRequest): Promise<RepositoryListResult>;
  search(request: RepositorySearchRequest): Promise<RepositorySearchResult>;
  glob(request: RepositoryGlobRequest): Promise<RepositoryGlobResult>;
}

export const DEFAULT_REPO_EXCLUDE = Object.freeze([".git", "node_modules", "dist"]);

export class RepositoryError extends Error {
  readonly code = "ERR_PRISM_REPOSITORY";
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

export function resolveRepositoryLimits(options?: RepositoryLimitOptions): ResolvedRepositoryLimits {
  return {
    maxDepth: validateCodingLimit("maxDepth", options?.maxDepth ?? DEFAULT_MAX_REPO_DEPTH, HARD_MAX_REPO_DEPTH),
    maxEntries: validateCodingLimit("maxEntries", options?.maxEntries ?? DEFAULT_MAX_REPO_ENTRIES, HARD_MAX_REPO_ENTRIES),
    maxFiles: validateCodingLimit("maxFiles", options?.maxFiles ?? DEFAULT_MAX_REPO_FILES, HARD_MAX_REPO_FILES),
    maxResults: validateCodingLimit("maxResults", options?.maxResults ?? DEFAULT_MAX_REPO_RESULTS, HARD_MAX_REPO_RESULTS),
    maxConcurrency: validateCodingLimit(
      "maxConcurrency",
      options?.maxConcurrency ?? DEFAULT_MAX_REPO_CONCURRENCY,
      HARD_MAX_REPO_CONCURRENCY,
    ),
    maxScanBytes: validateCodingLimit("maxScanBytes", options?.maxScanBytes ?? DEFAULT_MAX_SEARCH_SCAN_BYTES, HARD_MAX_SEARCH_SCAN_BYTES),
    maxFileBytes: validateCodingLimit("maxFileBytes", options?.maxFileBytes ?? DEFAULT_MAX_SEARCH_FILE_BYTES, HARD_MAX_SEARCH_FILE_BYTES),
    maxMatches: validateCodingLimit("maxMatches", options?.maxMatches ?? DEFAULT_MAX_SEARCH_MATCHES, HARD_MAX_SEARCH_MATCHES),
    maxPatternBytes: validateCodingLimit(
      "maxPatternBytes",
      options?.maxPatternBytes ?? DEFAULT_MAX_SEARCH_PATTERN_BYTES,
      HARD_MAX_SEARCH_PATTERN_BYTES,
    ),
    maxLineBytes: validateCodingLimit("maxLineBytes", options?.maxLineBytes ?? DEFAULT_MAX_SEARCH_LINE_BYTES, HARD_MAX_SEARCH_LINE_BYTES),
    maxContextLines: validateCodingLimitAllowZero(
      "maxContextLines",
      options?.maxContextLines ?? DEFAULT_MAX_SEARCH_CONTEXT_LINES,
      HARD_MAX_SEARCH_CONTEXT_LINES,
    ),
    maxTimeMs: validateCodingLimit("maxTimeMs", options?.maxTimeMs ?? DEFAULT_MAX_SEARCH_TIME_MS, HARD_MAX_SEARCH_TIME_MS),
    binarySniffBytes: DEFAULT_BINARY_SNIFF_BYTES,
    exclude: Object.freeze([...(options?.exclude ?? DEFAULT_REPO_EXCLUDE)]),
  };
}

/** Normalize a workspace-relative path to stable forward-slash form. */
