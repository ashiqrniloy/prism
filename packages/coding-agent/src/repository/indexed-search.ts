/**
 * Phase 26 Task 2: host-indexed repository search seam.
 *
 * `createIndexedRepositoryOperations` composes a host-owned incremental index
 * backend with an existing literal `RepositoryOperations` fallback. `repo_search`
 * stays bounded literal by default; `indexed_literal`/`semantic` modes are
 * explicit and never fall back silently when the index is missing, stale, or
 * failed. Index output is untrusted: every hit is containment-checked,
 * bounded, and labeled `untrusted_index` on the result.
 */
import { isAbsolute, join, resolve } from "node:path";
import {
  DEFAULT_MAX_INDEX_QUERY_TIMEOUT_MS,
  DEFAULT_MAX_INDEX_SNIPPET_BYTES,
  DEFAULT_MAX_INDEX_STALE_MAX_AGE_MS,
  DEFAULT_MAX_INDEX_UPDATE_BYTES,
  DEFAULT_MAX_INDEX_UPDATE_FILES,
  DEFAULT_MAX_REPO_RESULTS,
  HARD_MAX_INDEX_QUERY_TIMEOUT_MS,
  HARD_MAX_INDEX_SNIPPET_BYTES,
  HARD_MAX_INDEX_STALE_MAX_AGE_MS,
  HARD_MAX_INDEX_UPDATE_BYTES,
  HARD_MAX_INDEX_UPDATE_FILES,
  HARD_MAX_REPO_RESULTS,
  validateCodingLimit,
} from "../limits.js";
import { isPathInsideRoot } from "./path.js";
import type { RepositoryOperations, RepositorySearchMatch, RepositorySearchRequest, RepositorySearchResult } from "./types.js";

/** Frozen index state machine: empty | building | ready | stale | failed. */
export type IndexState = "empty" | "building" | "ready" | "stale" | "failed";

export const INDEX_STATES: readonly IndexState[] = ["empty", "building", "ready", "stale", "failed"];

export interface IndexResourceDiagnostics {
  readonly entries: number;
  readonly bytes: number;
  readonly lastUpdatedAt?: number;
}

export interface RepositoryIndexStatus {
  readonly state: IndexState;
  /** Source revision the index was built from; required when `requireSourceRevision`. */
  readonly sourceRevision?: string;
  /** Indexed-at timestamp (epoch ms); used for the staleness age check. */
  readonly updatedAt?: number;
  readonly diagnostics?: IndexResourceDiagnostics;
}

export type IndexFileChangeKind = "add" | "edit" | "delete" | "rename";

export interface IndexFileChange {
  /** Repository-relative path (forward slashes, no leading slash, no `..`). */
  readonly path: string;
  readonly kind: IndexFileChangeKind;
  /** Rename source path (repository-relative). */
  readonly oldPath?: string;
  readonly bytes?: number;
}

export interface RepositoryIndexUpdateRequest {
  /** Optional host identity scoping (bounded; never credential-bearing). */
  readonly repositoryId?: string;
  readonly worktreeId?: string;
  /** Revision the changes apply on top of. */
  readonly sourceRevision: string;
  readonly changes: readonly IndexFileChange[];
}

export interface RepositoryIndexRemoveRequest {
  /** Repository-relative paths to drop from the index. */
  readonly paths: readonly string[];
}

export interface IndexSearchHit {
  /** Repository-relative path (validated for containment). */
  readonly path: string;
  /** Relevance in [0,1]; non-finite or out-of-range scores fail closed. */
  readonly score: number;
  /** Snippet text (bounded; treated as untrusted prompt-injection surface). */
  readonly snippet: string;
}

export interface RepositoryIndexQueryRequest {
  readonly query: string;
  readonly mode: "indexed_literal" | "semantic";
  /** Optional repository-relative scope filter. */
  readonly path?: string;
  readonly maxResults: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface RepositoryIndexQueryResult {
  readonly hits: readonly IndexSearchHit[];
  readonly truncated: boolean;
}

export interface RepositoryIndexBackend {
  /** Explicit capability declaration; semantic mode is never duck-typed. */
  readonly capabilities: { readonly semantic: boolean };
  update(request: RepositoryIndexUpdateRequest): Promise<void>;
  remove(request: RepositoryIndexRemoveRequest): Promise<void>;
  search(request: RepositoryIndexQueryRequest): Promise<RepositoryIndexQueryResult>;
  status(): Promise<RepositoryIndexStatus>;
  dispose(): Promise<void>;
}

export interface ResolvedIndexLimits {
  readonly maxUpdateFiles: number;
  readonly maxUpdateBytes: number;
  readonly maxResults: number;
  readonly maxSnippetBytes: number;
  readonly staleMaxAgeMs: number;
  readonly queryTimeoutMs: number;
}

export interface IndexLimitOptions {
  readonly maxUpdateFiles?: number;
  readonly maxUpdateBytes?: number;
  readonly maxResults?: number;
  readonly maxSnippetBytes?: number;
  readonly staleMaxAgeMs?: number;
  readonly queryTimeoutMs?: number;
}

export function resolveIndexLimits(options?: IndexLimitOptions): ResolvedIndexLimits {
  return {
    maxUpdateFiles: validateCodingLimit(
      "maxUpdateFiles",
      options?.maxUpdateFiles ?? DEFAULT_MAX_INDEX_UPDATE_FILES,
      HARD_MAX_INDEX_UPDATE_FILES,
    ),
    maxUpdateBytes: validateCodingLimit(
      "maxUpdateBytes",
      options?.maxUpdateBytes ?? DEFAULT_MAX_INDEX_UPDATE_BYTES,
      HARD_MAX_INDEX_UPDATE_BYTES,
    ),
    maxResults: validateCodingLimit("maxResults", options?.maxResults ?? DEFAULT_MAX_REPO_RESULTS, HARD_MAX_REPO_RESULTS),
    maxSnippetBytes: validateCodingLimit(
      "maxSnippetBytes",
      options?.maxSnippetBytes ?? DEFAULT_MAX_INDEX_SNIPPET_BYTES,
      HARD_MAX_INDEX_SNIPPET_BYTES,
    ),
    staleMaxAgeMs: validateCodingLimit(
      "staleMaxAgeMs",
      options?.staleMaxAgeMs ?? DEFAULT_MAX_INDEX_STALE_MAX_AGE_MS,
      HARD_MAX_INDEX_STALE_MAX_AGE_MS,
    ),
    queryTimeoutMs: validateCodingLimit(
      "queryTimeoutMs",
      options?.queryTimeoutMs ?? DEFAULT_MAX_INDEX_QUERY_TIMEOUT_MS,
      HARD_MAX_INDEX_QUERY_TIMEOUT_MS,
    ),
  };
}

export class IndexError extends Error {
  constructor(
    readonly code:
      | "ERR_PRISM_INDEX_UNSUPPORTED"
      | "ERR_PRISM_INDEX_STALE"
      | "ERR_PRISM_INDEX_FAILED"
      | "ERR_PRISM_INDEX_LIMIT"
      | "ERR_PRISM_INDEX_TIMEOUT"
      | "ERR_PRISM_INDEX_UNTRUSTED",
    message: string,
  ) {
    super(message);
    this.name = "IndexError";
  }
}

export interface IndexedRepositoryOptions {
  /** Host-owned incremental index backend (never started or built implicitly). */
  readonly index: RepositoryIndexBackend;
  /** Literal fallback (e.g. createGitAwareRepositoryOperations) for mode "literal". */
  readonly fallback: RepositoryOperations;
  /** Modes this composite accepts; default literal only. `indexed_literal`/`semantic` must be listed explicitly. */
  readonly allowedModes?: readonly ("literal" | "indexed_literal" | "semantic")[];
  readonly stale?: {
    readonly maxAgeMs?: number;
    /** Require the index to attest a sourceRevision before serving queries. */
    readonly requireSourceRevision?: boolean;
  };
  readonly limits?: IndexLimitOptions;
}

export interface IndexFacade {
  update(request: RepositoryIndexUpdateRequest): Promise<void>;
  remove(request: RepositoryIndexRemoveRequest): Promise<void>;
  status(): Promise<RepositoryIndexStatus>;
  dispose(): Promise<void>;
}

const MAX_IDENTITY_BYTES = 512;
const MAX_REVISION_BYTES = 4096;

function assertRelativeRepoPath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new IndexError("ERR_PRISM_INDEX_UNTRUSTED", "index reported an invalid path");
  }
  if (path.startsWith("/") || path.includes("\\") || isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")) {
    throw new IndexError("ERR_PRISM_INDEX_UNTRUSTED", "index reported a path outside the repository");
  }
  return path;
}

function assertBoundedIdentity(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_IDENTITY_BYTES) {
    throw new IndexError("ERR_PRISM_INDEX_LIMIT", `${label} exceeds the identity bound`);
  }
  return value;
}

function assertBoundedRevision(value: string): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_REVISION_BYTES) {
    throw new IndexError("ERR_PRISM_INDEX_LIMIT", "sourceRevision is required and bounded");
  }
  return value;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let end = 0;
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return value.slice(0, end);
}

function isFresh(status: RepositoryIndexStatus, staleMaxAgeMs: number, requireSourceRevision: boolean): IndexError | null {
  switch (status.state) {
    case "failed":
      return new IndexError("ERR_PRISM_INDEX_FAILED", "index is failed; no search is served");
    case "empty":
      return new IndexError("ERR_PRISM_INDEX_STALE", "index has no data; update it before querying");
    case "building":
      return new IndexError("ERR_PRISM_INDEX_STALE", "index is still building");
    case "ready":
    case "stale":
      break;
    default:
      return new IndexError("ERR_PRISM_INDEX_FAILED", "index reported an unknown state");
  }
  if (status.updatedAt === undefined) {
    return new IndexError("ERR_PRISM_INDEX_STALE", "index does not attest a freshness timestamp");
  }
  if (Date.now() - status.updatedAt > staleMaxAgeMs) {
    return new IndexError("ERR_PRISM_INDEX_STALE", "index is stale; refresh it before querying");
  }
  if (requireSourceRevision && status.sourceRevision === undefined) {
    return new IndexError("ERR_PRISM_INDEX_STALE", "index does not attest a source revision");
  }
  return null;
}

function isIndexMode(mode: string | undefined): mode is "indexed_literal" | "semantic" {
  return mode === "indexed_literal" || mode === "semantic";
}

/**
 * Compose a host index with a literal fallback. Mode "literal" is routed to
 * `fallback` unchanged; indexed modes are served only by the host backend with
 * freshness checks, result validation, and no silent fallback.
 */
export function createIndexedRepositoryOperations(
  cwd: string,
  options: IndexedRepositoryOptions,
): RepositoryOperations & { readonly index: IndexFacade } {
  const allowed = new Set(options.allowedModes ?? ["literal"]);
  const resolved = resolveIndexLimits(options.limits);
  const staleMaxAgeMs = options.stale?.maxAgeMs ?? resolved.staleMaxAgeMs;
  const requireSourceRevision = options.stale?.requireSourceRevision === true;
  const root = resolve(cwd);

  const backend = options.index;

  async function checkFresh(): Promise<RepositoryIndexStatus> {
    let status: RepositoryIndexStatus;
    try {
      status = await backend.status();
    } catch {
      throw new IndexError("ERR_PRISM_INDEX_FAILED", "index status failed");
    }
    const stale = isFresh(status, staleMaxAgeMs, requireSourceRevision);
    if (stale) throw stale;
    return status;
  }

  function validateHit(hit: IndexSearchHit, scope: string | undefined): RepositorySearchMatch {
    const path = assertRelativeRepoPath(hit.path);
    const absolute = join(root, ...path.split("/"));
    if (!isPathInsideRoot(root, absolute)) {
      throw new IndexError("ERR_PRISM_INDEX_UNTRUSTED", "index reported a path outside the repository root");
    }
    if (scope !== undefined && scope !== "." && path !== scope && !path.startsWith(`${scope}/`)) {
      throw new IndexError("ERR_PRISM_INDEX_UNTRUSTED", "index reported a result outside the requested path scope");
    }
    if (typeof hit.score !== "number" || !Number.isFinite(hit.score) || hit.score < 0 || hit.score > 1) {
      throw new IndexError("ERR_PRISM_INDEX_UNTRUSTED", "index reported an invalid score");
    }
    const snippet = typeof hit.snippet === "string" ? truncateUtf8(hit.snippet, resolved.maxSnippetBytes) : "";
    return {
      path,
      line: 0,
      column: 0,
      text: snippet,
      before: [],
      after: [],
      score: hit.score,
    };
  }

  return {
    async search(request: RepositorySearchRequest): Promise<RepositorySearchResult> {
      const mode = request.mode ?? "literal";
      if (!isIndexMode(mode)) return options.fallback.search(request);

      if (!allowed.has(mode)) {
        throw new IndexError("ERR_PRISM_INDEX_UNSUPPORTED", `search mode ${mode} is not enabled on this composite`);
      }
      if (mode === "semantic" && backend.capabilities.semantic !== true) {
        throw new IndexError("ERR_PRISM_INDEX_UNSUPPORTED", "semantic search is not supported by this index backend");
      }
      const status = await checkFresh();

      let scope: string | undefined;
      if (request.path !== undefined && request.path !== "" && request.path !== ".") {
        scope = assertRelativeRepoPath(request.path);
      }

      const timeoutMs = Math.min(request.deadlineMs ?? resolved.queryTimeoutMs, resolved.queryTimeoutMs);
      const deadlineAt = Date.now() + timeoutMs;
      const maxResults = Math.min(
        resolved.maxResults,
        validateCodingLimit("maxMatches", request.maxMatches ?? resolved.maxResults, HARD_MAX_REPO_RESULTS),
      );
      let queryResult: RepositoryIndexQueryResult;
      try {
        queryResult = await Promise.race([
          backend.search({
            query: request.query,
            mode,
            path: scope,
            maxResults,
            signal: request.signal,
            deadlineMs: timeoutMs,
          }),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new IndexError("ERR_PRISM_INDEX_TIMEOUT", "index query timed out")), timeoutMs + 5);
            timer.unref();
          }),
        ]);
      } catch (error) {
        if (error instanceof IndexError) throw error;
        if (request.signal?.aborted) throw new IndexError("ERR_PRISM_INDEX_TIMEOUT", "index query aborted");
        throw new IndexError("ERR_PRISM_INDEX_FAILED", "index query failed");
      }

      if (Date.now() > deadlineAt) {
        throw new IndexError("ERR_PRISM_INDEX_TIMEOUT", "index query exceeded the deadline");
      }

      const seen = new Set<string>();
      const matches: RepositorySearchMatch[] = [];
      for (const hit of queryResult.hits) {
        if (matches.length >= maxResults) break;
        const match = validateHit(hit, scope);
        if (seen.has(match.path)) continue; // duplicate paths: keep first
        seen.add(match.path);
        matches.push(match);
      }

      return {
        matches,
        truncated: queryResult.truncated || queryResult.hits.length > matches.length,
        truncatedBy: queryResult.truncated || queryResult.hits.length > matches.length ? "index" : null,
        scannedBytes: 0,
        scannedFiles: 0,
        scannedEntries: 0,
        filesSkippedBinary: 0,
        filesSkippedOversize: 0,
        indexed: {
          mode,
          state: status.state,
          sourceRevision: status.sourceRevision,
          updatedAt: status.updatedAt,
        },
        untrusted_index: true,
      };
    },

    list: (request) => options.fallback.list(request),
    glob: (request) => options.fallback.glob(request),

    index: {
      async update(request: RepositoryIndexUpdateRequest): Promise<void> {
        assertBoundedRevision(request.sourceRevision);
        assertBoundedIdentity(request.repositoryId, "repositoryId");
        assertBoundedIdentity(request.worktreeId, "worktreeId");
        if (!Array.isArray(request.changes) || request.changes.length > resolved.maxUpdateFiles) {
          throw new IndexError("ERR_PRISM_INDEX_LIMIT", `update exceeds the ${resolved.maxUpdateFiles} change cap`);
        }
        let totalBytes = Buffer.byteLength(request.sourceRevision, "utf8");
        const updates: IndexFileChange[] = [];
        const removals: string[] = [];
        for (const change of request.changes) {
          assertRelativeRepoPath(change.path);
          if (change.oldPath !== undefined) assertRelativeRepoPath(change.oldPath);
          if (change.bytes !== undefined && (typeof change.bytes !== "number" || !Number.isFinite(change.bytes) || change.bytes < 0)) {
            throw new IndexError("ERR_PRISM_INDEX_LIMIT", "change bytes must be a non-negative finite number");
          }
          totalBytes += Buffer.byteLength(change.path, "utf8") + (change.oldPath ? Buffer.byteLength(change.oldPath, "utf8") : 0);
          if (totalBytes > resolved.maxUpdateBytes) {
            throw new IndexError("ERR_PRISM_INDEX_LIMIT", `update exceeds the ${resolved.maxUpdateBytes} byte cap`);
          }
          if (change.kind === "delete") {
            removals.push(change.path);
          } else if (change.kind === "rename") {
            removals.push(change.oldPath!);
            updates.push({ path: change.path, kind: "add", bytes: change.bytes });
          } else {
            updates.push(change);
          }
        }
        try {
          if (updates.length > 0)
            await backend.update({
              repositoryId: request.repositoryId,
              worktreeId: request.worktreeId,
              sourceRevision: request.sourceRevision,
              changes: updates,
            });
          if (removals.length > 0) await backend.remove({ paths: removals });
        } catch {
          throw new IndexError("ERR_PRISM_INDEX_FAILED", "index update failed");
        }
      },

      async remove(request: RepositoryIndexRemoveRequest): Promise<void> {
        if (!Array.isArray(request.paths) || request.paths.length > resolved.maxUpdateFiles) {
          throw new IndexError("ERR_PRISM_INDEX_LIMIT", `remove exceeds the ${resolved.maxUpdateFiles} path cap`);
        }
        const paths = request.paths.map((p) => assertRelativeRepoPath(p));
        try {
          await backend.remove({ paths });
        } catch {
          throw new IndexError("ERR_PRISM_INDEX_FAILED", "index remove failed");
        }
      },

      async status(): Promise<RepositoryIndexStatus> {
        let status: RepositoryIndexStatus;
        try {
          status = await backend.status();
        } catch {
          throw new IndexError("ERR_PRISM_INDEX_FAILED", "index status failed");
        }
        if (!INDEX_STATES.includes(status.state)) {
          throw new IndexError("ERR_PRISM_INDEX_FAILED", "index reported an unknown state");
        }
        return status;
      },

      async dispose(): Promise<void> {
        try {
          await backend.dispose();
        } catch {
          throw new IndexError("ERR_PRISM_INDEX_FAILED", "index dispose failed");
        }
      },
    },
  };
}

/** Stable repo-relative label used in errors; kept for tests and docs. */
export function indexErrorCode(error: unknown): string | undefined {
  return error instanceof IndexError ? error.code : undefined;
}
