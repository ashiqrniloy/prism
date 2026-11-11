/** Repository search family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */

import { lstat, open } from "node:fs/promises";
import { HARD_MAX_SEARCH_CONTEXT_LINES, HARD_MAX_SEARCH_MATCHES, validateCodingLimit, validateCodingLimitAllowZero } from "../limits.js";
import { compileGlob } from "../glob-match.js";
import { assertDeadline, assertNotAborted, isBinaryBuffer, resolveRepoPath } from "./path.js";
import type {
  RepositoryFileMatcher,
  RepositoryLineMatch,
  RepositorySearchMatch,
  RepositorySearchRequest,
  RepositorySearchResult,
  ResolvedRepositoryLimits,
} from "./types.js";
import { RepositoryError } from "./types.js";
import type { RepositoryWalk } from "./walk.js";

export function compileSearchPattern(
  query: string,
  caseSensitive: boolean,
  maxPatternBytes: number,
): { testLine: (line: string) => { column: number } | null; patternBytes: number } {
  const patternBytes = Buffer.byteLength(query, "utf8");
  if (patternBytes < 1) throw new RepositoryError("query must be non-empty");
  if (patternBytes > maxPatternBytes) {
    throw new RepositoryError(`query exceeds ${maxPatternBytes} byte pattern limit`);
  }

  if (caseSensitive) {
    return {
      patternBytes,
      testLine: (line) => {
        const column = line.indexOf(query);
        return column >= 0 ? { column: column + 1 } : null;
      },
    };
  }
  const needle = query.toLowerCase();
  return {
    patternBytes,
    testLine: (line) => {
      const column = line.toLowerCase().indexOf(needle);
      return column >= 0 ? { column: column + 1 } : null;
    },
  };
}

/**
 * One file's text → its line matches with context. Pure, no I/O: the `grep` worker imports this
 * too, so literal and regex modes format from the same matches.
 */
export function matchLines(
  text: string,
  testLine: (line: string) => { column: number } | null,
  context: number,
  maxLineBytes: number,
): RepositoryLineMatch[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const out: RepositoryLineMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (maxLineBytes > 0 && Buffer.byteLength(line, "utf8") > maxLineBytes) continue;
    const hit = testLine(line);
    if (!hit) continue;
    out.push({
      line: i + 1,
      column: hit.column,
      text: line,
      before: lines.slice(Math.max(0, i - context), i),
      after: lines.slice(i + 1, i + 1 + context),
    });
  }
  return out;
}

/** The literal matcher: `matchLines` over a compiled substring test. */
export function literalMatcher(
  query: string,
  caseSensitive: boolean,
  maxPatternBytes: number,
  maxLineBytes: number,
): RepositoryFileMatcher {
  const { testLine } = compileSearchPattern(query, caseSensitive, maxPatternBytes);
  return (text, context) => matchLines(text, testLine, context, maxLineBytes);
}

type FileOutcome = "ok" | "binary" | "oversize" | "scan" | "matches";

/** Read one bounded file and collect its matches. Whole-file read: the file is already size-capped. */
async function searchFile(
  absolutePath: string,
  relativePath: string,
  matcher: RepositoryFileMatcher,
  options: {
    maxFileBytes: number;
    maxScanBytesRemaining: () => number;
    chargeScan: (n: number) => void;
    context: number;
    maxMatchesRemaining: () => number;
    pushMatch: (match: RepositorySearchMatch) => void;
    signal?: AbortSignal;
    deadlineAt?: number;
    binarySniffBytes: number;
  },
): Promise<FileOutcome> {
  assertNotAborted(options.signal);
  assertDeadline(options.deadlineAt);

  const handle = await open(absolutePath, "r");
  try {
    const st = await handle.stat();
    if (st.size > options.maxFileBytes) return "oversize";
    const remaining = options.maxScanBytesRemaining();
    if (remaining <= 0) return "scan";
    if (st.size > remaining) {
      options.chargeScan(remaining);
      return "scan";
    }
    const buf = await handle.readFile();
    options.chargeScan(buf.length);
    if (isBinaryBuffer(buf.subarray(0, options.binarySniffBytes))) return "binary";

    for (const match of await matcher(buf.toString("utf8"), options.context)) {
      if (options.maxMatchesRemaining() <= 0) return "matches";
      options.pushMatch({ path: relativePath, ...match });
    }
    return "ok";
  } finally {
    await handle.close();
  }
}

export async function searchLocal(
  request: RepositorySearchRequest,
  defaults: ResolvedRepositoryLimits,
  walk: RepositoryWalk,
): Promise<RepositorySearchResult> {
  const mode = request.mode ?? "literal";
  if (mode !== "literal") {
    throw new RepositoryError(`unsupported search mode: ${String(mode)} (literal only)`);
  }
  const caseSensitive = request.caseSensitive === true;
  const matcher = request.matcher ?? literalMatcher(request.query, caseSensitive, defaults.maxPatternBytes, defaults.maxLineBytes);

  const resolved = await resolveRepoPath(request.root, request.path);
  const maxMatches = validateCodingLimit("maxMatches", request.maxMatches ?? defaults.maxMatches, HARD_MAX_SEARCH_MATCHES);
  const context = validateCodingLimitAllowZero("context", request.context ?? defaults.maxContextLines, HARD_MAX_SEARCH_CONTEXT_LINES);
  const exclude = new Set(request.exclude ?? defaults.exclude);
  const globMatch = request.glob !== undefined ? compileGlob(request.glob) : undefined;
  const deadlineAt = request.deadlineMs !== undefined ? Date.now() + request.deadlineMs : Date.now() + defaults.maxTimeMs;

  const matches: RepositorySearchMatch[] = [];
  let scannedBytes = 0;
  let scannedFiles = 0;
  let scannedEntries = 0;
  let filesSkippedBinary = 0;
  let filesSkippedOversize = 0;
  let truncated = false;
  let truncatedBy: RepositorySearchResult["truncatedBy"] = null;

  const runFile = async (absolutePath: string, relativePath: string): Promise<void> => {
    if (truncated) return;
    const status = await searchFile(absolutePath, relativePath, matcher, {
      maxFileBytes: defaults.maxFileBytes,
      maxScanBytesRemaining: () => defaults.maxScanBytes - scannedBytes,
      chargeScan: (n) => {
        scannedBytes += n;
      },
      context,
      maxMatchesRemaining: () => maxMatches - matches.length,
      pushMatch: (match) => {
        if (matches.length < maxMatches) matches.push(match);
      },
      signal: request.signal,
      deadlineAt,
      binarySniffBytes: defaults.binarySniffBytes,
    });
    if (status === "binary") filesSkippedBinary++;
    else if (status === "oversize") filesSkippedOversize++;
    else if (status === "scan") {
      truncated = true;
      truncatedBy = "scan";
    } else if (status === "matches") {
      truncated = true;
      truncatedBy = "matches";
    }
  };

  try {
    const startStat = await lstat(resolved.absolute);
    if (startStat.isFile()) {
      scannedEntries = 1;
      if (globMatch === undefined || globMatch(resolved.relative)) {
        scannedFiles = 1;
        await runFile(resolved.absolute, resolved.relative);
      }
    } else if (startStat.isDirectory()) {
      for await (const event of walk(resolved.rootReal, resolved.absolute, {
        maxDepth: defaults.maxDepth,
        maxEntries: defaults.maxEntries,
        maxFiles: defaults.maxFiles,
        exclude,
        includeHidden: request.includeHidden === true,
        signal: request.signal,
        deadlineAt,
      })) {
        if (truncated) break;
        if (event.type === "limit") {
          truncated = true;
          truncatedBy = event.truncatedBy;
          break;
        }
        scannedEntries++;
        if (event.entry.kind !== "file") continue;
        if (globMatch !== undefined && !globMatch(event.entry.path)) continue;
        scannedFiles++;
        try {
          await runFile(event.absolutePath, event.entry.path);
        } catch (error) {
          if (error instanceof RepositoryError) {
            if (error.message === "Operation aborted") {
              truncated = true;
              truncatedBy = "abort";
              break;
            }
            if (error.message === "Repository operation exceeded time limit") {
              truncated = true;
              truncatedBy = "time";
              break;
            }
          }
          // Unreadable files are skipped; walk continues.
        }
      }
    } else if (startStat.isSymbolicLink()) {
      // Symlink starts are not followed for search content.
      scannedEntries = 1;
    }
  } catch (error) {
    if (error instanceof RepositoryError && error.message === "Operation aborted") {
      truncated = true;
      truncatedBy = "abort";
    } else if (error instanceof RepositoryError && error.message === "Repository operation exceeded time limit") {
      truncated = true;
      truncatedBy = "time";
    } else if (error instanceof RepositoryError) {
      throw error;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      throw new RepositoryError(`cannot search path: ${message}`);
    }
  }

  if (!truncated && matches.length >= maxMatches) {
    truncated = true;
    truncatedBy = "matches";
  }

  matches.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });

  return {
    matches: matches.slice(0, maxMatches),
    truncated,
    truncatedBy,
    scannedBytes,
    scannedFiles,
    scannedEntries,
    filesSkippedBinary,
    filesSkippedOversize,
  };
}
