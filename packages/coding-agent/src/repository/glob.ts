/** Repository glob family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */
import {
  HARD_MAX_REPO_DEPTH,
  HARD_MAX_REPO_ENTRIES,
  HARD_MAX_REPO_RESULTS,
  validateCodingLimit,
  validateCodingLimitAllowZero,
} from "../limits.js";
import { expandGlobBraces, matchGlobPattern, validateGlobPattern } from "../glob-match.js";
import { lstat } from "node:fs/promises";
import type { RepositoryGlobRequest, RepositoryGlobResult, ResolvedRepositoryLimits } from "./types.js";
import { RepositoryError } from "./types.js";
import type { RepositoryWalk } from "./walk.js";
import { resolveRepoPath } from "./path.js";

export async function globLocal(
  request: RepositoryGlobRequest,
  defaults: ResolvedRepositoryLimits,
  walk: RepositoryWalk,
): Promise<RepositoryGlobResult> {
  try {
    validateGlobPattern(request.pattern, defaults.maxPatternBytes, { braceExpansion: request.braceExpansion === true });
  } catch (error) {
    throw new RepositoryError(error instanceof Error ? error.message : String(error));
  }
  // Opt-in bounded brace expansion: textual alternatives only (never touches the
  // filesystem); bounds enforced by expandGlobBraces (max alternatives / bytes).
  const patterns = request.braceExpansion === true ? expandGlobBraces(request.pattern) : [request.pattern];
  const resolved = await resolveRepoPath(request.root, request.path);
  const maxResults = validateCodingLimit("maxResults", request.maxResults ?? defaults.maxResults, HARD_MAX_REPO_RESULTS);
  const offset = validateCodingLimitAllowZero("offset", request.offset ?? 0, HARD_MAX_REPO_ENTRIES);
  const maxDepth = validateCodingLimit("maxDepth", request.maxDepth ?? defaults.maxDepth, HARD_MAX_REPO_DEPTH);
  const exclude = new Set(request.exclude ?? defaults.exclude);
  const deadlineAt = request.deadlineMs !== undefined ? Date.now() + request.deadlineMs : Date.now() + defaults.maxTimeMs;

  const collected: string[] = [];
  let scannedEntries = 0;
  let scannedFiles = 0;
  let seen = 0;
  let truncated = false;
  let truncatedBy: RepositoryGlobResult["truncatedBy"] = null;

  const matchesAnyPattern = (relativePath: string): boolean => {
    for (const p of patterns) {
      if (matchGlobPattern(p, relativePath)) return true;
    }
    return false;
  };

  const maybeCollect = (relativePath: string): boolean => {
    if (!matchesAnyPattern(relativePath)) return false;
    if (seen < offset) {
      seen++;
      return false;
    }
    if (collected.length >= maxResults) {
      truncated = true;
      truncatedBy = "results";
      return true;
    }
    collected.push(relativePath);
    seen++;
    return truncated;
  };

  try {
    const startStat = await lstat(resolved.absolute);
    if (!startStat.isDirectory()) {
      scannedEntries = 1;
      if (startStat.isFile()) {
        scannedFiles = 1;
        if (matchesAnyPattern(resolved.relative)) {
          if (offset === 0 && maxResults > 0) collected.push(resolved.relative);
          else if (offset === 0 && maxResults === 0) {
            truncated = true;
            truncatedBy = "results";
          }
        }
      }
      return {
        paths: collected,
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
      if (event.entry.kind !== "file") continue;
      if (maybeCollect(event.entry.path)) break;
    }
  } catch (error) {
    if (error instanceof RepositoryError && error.message === "Operation aborted") {
      return {
        paths: collected,
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
        paths: collected,
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
    paths: collected,
    truncated,
    truncatedBy,
    scannedEntries,
    scannedFiles,
    offset,
    nextOffset: truncated ? offset + collected.length : undefined,
  };
}

/** Local filesystem repository operations (default backend). */
