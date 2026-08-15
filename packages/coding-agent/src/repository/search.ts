/** Repository search family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */
import { HARD_MAX_SEARCH_CONTEXT_LINES, HARD_MAX_SEARCH_MATCHES, validateCodingLimit, validateCodingLimitAllowZero } from "../limits.js";
import { lstat, open } from "node:fs/promises";
import type { RepositorySearchMatch, RepositorySearchRequest, RepositorySearchResult, ResolvedRepositoryLimits } from "./types.js";
import { RepositoryError } from "./types.js";
import type { RepositoryWalk } from "./walk.js";
import { assertDeadline, assertNotAborted, isBinaryBuffer, resolveRepoPath } from "./path.js";

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

async function searchFileLines(
  absolutePath: string,
  relativePath: string,
  testLine: (line: string) => { column: number } | null,
  options: {
    maxFileBytes: number;
    maxLineBytes: number;
    maxScanBytesRemaining: () => number;
    chargeScan: (n: number) => void;
    context: number;
    maxMatchesRemaining: () => number;
    pushMatch: (match: RepositorySearchMatch) => void;
    signal?: AbortSignal;
    deadlineAt?: number;
    binarySniffBytes: number;
  },
): Promise<"ok" | "binary" | "oversize" | "scan" | "matches"> {
  assertNotAborted(options.signal);
  assertDeadline(options.deadlineAt);

  const handle = await open(absolutePath, "r");
  try {
    const st = await handle.stat();
    if (st.size > options.maxFileBytes) return "oversize";

    const sniff = Buffer.allocUnsafe(Math.min(options.binarySniffBytes, st.size));
    const { bytesRead: sniffed } = await handle.read(sniff, 0, sniff.length, 0);
    if (isBinaryBuffer(sniff.subarray(0, sniffed))) return "binary";

    // Rewind and stream the whole file (already size-capped).
    let offset = 0;
    let lineStart = 0;
    let lineNumber = 1;
    let pending = Buffer.alloc(0);
    const before: string[] = [];
    const pendingAfter: Array<{ match: RepositorySearchMatch; remaining: number }> = [];
    const readBuf = Buffer.allocUnsafe(64 * 1024);

    const emitLine = (raw: Buffer): "ok" | "scan" | "matches" => {
      assertNotAborted(options.signal);
      assertDeadline(options.deadlineAt);
      const lineBytes = raw.length;
      if (lineBytes > options.maxLineBytes) {
        // Skip oversized lines but still charge scan budget for the bytes seen.
        options.chargeScan(lineBytes);
        if (options.maxScanBytesRemaining() < 0) return "scan";
        lineNumber++;
        return "ok";
      }
      options.chargeScan(lineBytes);
      if (options.maxScanBytesRemaining() < 0) return "scan";

      const text = raw.toString("utf8");
      // Drain after-context for previous matches.
      for (let i = pendingAfter.length - 1; i >= 0; i--) {
        const item = pendingAfter[i]!;
        if (item.remaining > 0) {
          (item.match.after as string[]).push(text);
          item.remaining--;
        }
        if (item.remaining <= 0) pendingAfter.splice(i, 1);
      }

      const hit = testLine(text);
      if (hit) {
        if (options.maxMatchesRemaining() <= 0) return "matches";
        const match: RepositorySearchMatch = {
          path: relativePath,
          line: lineNumber,
          column: hit.column,
          text,
          before: before.slice(-options.context),
          after: [],
        };
        options.pushMatch(match);
        if (options.context > 0) pendingAfter.push({ match, remaining: options.context });
      }

      if (options.context > 0) {
        before.push(text);
        if (before.length > options.context) before.shift();
      }
      lineNumber++;
      return "ok";
    };

    while (offset < st.size) {
      assertNotAborted(options.signal);
      assertDeadline(options.deadlineAt);
      if (options.maxScanBytesRemaining() <= 0) return "scan";
      if (options.maxMatchesRemaining() <= 0) return "matches";
      const { bytesRead } = await handle.read(readBuf, 0, readBuf.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      pending = Buffer.concat([pending, readBuf.subarray(0, bytesRead)]);

      let start = 0;
      for (let i = 0; i < pending.length; i++) {
        if (pending[i] === 0x0a) {
          const end = i > start && pending[i - 1] === 0x0d ? i - 1 : i;
          const status = emitLine(pending.subarray(start, end));
          if (status !== "ok") return status;
          start = i + 1;
          lineStart = offset - (pending.length - start);
        }
      }
      pending = pending.subarray(start);
      void lineStart;
    }

    if (pending.length > 0) {
      const status = emitLine(pending);
      if (status !== "ok") return status;
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
  const { testLine } = compileSearchPattern(request.query, caseSensitive, defaults.maxPatternBytes);

  const resolved = await resolveRepoPath(request.root, request.path);
  const maxMatches = validateCodingLimit("maxMatches", request.maxMatches ?? defaults.maxMatches, HARD_MAX_SEARCH_MATCHES);
  const context = validateCodingLimitAllowZero("context", request.context ?? defaults.maxContextLines, HARD_MAX_SEARCH_CONTEXT_LINES);
  const exclude = new Set(request.exclude ?? defaults.exclude);
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
    const status = await searchFileLines(absolutePath, relativePath, testLine, {
      maxFileBytes: defaults.maxFileBytes,
      maxLineBytes: defaults.maxLineBytes,
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
      scannedFiles = 1;
      await runFile(resolved.absolute, resolved.relative);
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
