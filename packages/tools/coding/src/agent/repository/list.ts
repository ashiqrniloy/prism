/** Repository list family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */

import { lstat } from "node:fs/promises";
import {
  HARD_MAX_REPO_DEPTH,
  HARD_MAX_REPO_ENTRIES,
  HARD_MAX_REPO_RESULTS,
  validateCodingLimit,
  validateCodingLimitAllowZero,
} from "../limits.js";
import { resolveRepoPath } from "./path.js";
import type { RepoEntryKind, RepoListEntry, RepositoryListRequest, RepositoryListResult, ResolvedRepositoryLimits } from "./types.js";
import { RepositoryError } from "./types.js";
import type { RepositoryWalk } from "./walk.js";

export async function listLocal(
  request: RepositoryListRequest,
  defaults: ResolvedRepositoryLimits,
  walk: RepositoryWalk,
): Promise<RepositoryListResult> {
  const resolved = await resolveRepoPath(request.root, request.path);
  const maxResults = validateCodingLimit("maxResults", request.maxResults ?? defaults.maxResults, HARD_MAX_REPO_RESULTS);
  const offset = validateCodingLimitAllowZero("offset", request.offset ?? 0, HARD_MAX_REPO_ENTRIES);
  const maxDepth = validateCodingLimit("maxDepth", request.maxDepth ?? defaults.maxDepth, HARD_MAX_REPO_DEPTH);
  const exclude = new Set(request.exclude ?? defaults.exclude);
  const deadlineAt = request.deadlineMs !== undefined ? Date.now() + request.deadlineMs : Date.now() + defaults.maxTimeMs;

  const collected: RepoListEntry[] = [];
  let scannedEntries = 0;
  let scannedFiles = 0;
  let seen = 0;
  let truncated = false;
  let truncatedBy: RepositoryListResult["truncatedBy"] = null;

  // Single-file start: return that entry when it falls within the page window.
  try {
    const startStat = await lstat(resolved.absolute);
    if (!startStat.isDirectory()) {
      let kind: RepoEntryKind = "other";
      if (startStat.isSymbolicLink()) kind = "symlink";
      else if (startStat.isFile()) kind = "file";
      const entry: RepoListEntry =
        kind === "file" ? { path: resolved.relative, kind, size: startStat.size } : { path: resolved.relative, kind };
      scannedEntries = 1;
      scannedFiles = kind === "file" ? 1 : 0;
      if (offset === 0 && maxResults > 0) collected.push(entry);
      else if (offset === 0 && maxResults === 0) {
        truncated = true;
        truncatedBy = "results";
      }
      return {
        entries: collected,
        truncated,
        truncatedBy,
        scannedEntries,
        scannedFiles,
        offset,
        nextOffset: undefined,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepositoryError(`cannot open path: ${message}`);
  }

  try {
    for await (const event of walk(resolved.rootReal, resolved.absolute, {
      maxDepth,
      maxEntries: defaults.maxEntries,
      maxFiles: defaults.maxFiles,
      exclude,
      includeHidden: request.includeHidden === true,
      signal: request.signal,
      deadlineAt,
    })) {
      if (event.type === "limit") {
        truncated = true;
        truncatedBy = event.truncatedBy;
        break;
      }
      scannedEntries++;
      if (event.entry.kind === "file") scannedFiles++;
      if (seen < offset) {
        seen++;
        continue;
      }
      if (collected.length >= maxResults) {
        truncated = true;
        truncatedBy = "results";
        break;
      }
      collected.push(event.entry);
      seen++;
    }
  } catch (error) {
    if (error instanceof RepositoryError && error.message === "Operation aborted") {
      return {
        entries: collected,
        truncated: true,
        truncatedBy: "abort",
        scannedEntries,
        scannedFiles,
        offset,
        nextOffset: collected.length > 0 || offset > 0 ? offset + collected.length : undefined,
      };
    }
    if (error instanceof RepositoryError && error.message === "Repository operation exceeded time limit") {
      return {
        entries: collected,
        truncated: true,
        truncatedBy: "time",
        scannedEntries,
        scannedFiles,
        offset,
        nextOffset: offset + collected.length,
      };
    }
    throw error;
  }

  return {
    entries: collected,
    truncated,
    truncatedBy,
    scannedEntries,
    scannedFiles,
    offset,
    nextOffset: truncated ? offset + collected.length : undefined,
  };
}
