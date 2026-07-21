/**
 * Bounded repository walk primitives for list/search tools.
 *
 * Streams the tree with Node `opendir` / `lstat`; never follows symlink escapes,
 * rejects devices/FIFOs/sockets for descent, and charges finite depth/entry/file
 * limits before retaining the next result. No glob/index/watcher dependency.
 */
import { open, opendir, lstat, realpath } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
} from "./limits.js";
import { resolveToCwd } from "./path-utils.js";

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
  readonly truncatedBy:
    | "matches"
    | "scan"
    | "file"
    | "entries"
    | "files"
    | "depth"
    | "time"
    | "abort"
    | "pattern"
    | null;
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
  readonly mode?: "literal" | "regex";
  readonly caseSensitive?: boolean;
  readonly includeHidden?: boolean;
  readonly exclude?: readonly string[];
  readonly context?: number;
  readonly maxMatches?: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface RepositoryOperations {
  list(request: RepositoryListRequest): Promise<RepositoryListResult>;
  search(request: RepositorySearchRequest): Promise<RepositorySearchResult>;
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
    maxEntries: validateCodingLimit(
      "maxEntries",
      options?.maxEntries ?? DEFAULT_MAX_REPO_ENTRIES,
      HARD_MAX_REPO_ENTRIES,
    ),
    maxFiles: validateCodingLimit("maxFiles", options?.maxFiles ?? DEFAULT_MAX_REPO_FILES, HARD_MAX_REPO_FILES),
    maxResults: validateCodingLimit(
      "maxResults",
      options?.maxResults ?? DEFAULT_MAX_REPO_RESULTS,
      HARD_MAX_REPO_RESULTS,
    ),
    maxConcurrency: validateCodingLimit(
      "maxConcurrency",
      options?.maxConcurrency ?? DEFAULT_MAX_REPO_CONCURRENCY,
      HARD_MAX_REPO_CONCURRENCY,
    ),
    maxScanBytes: validateCodingLimit(
      "maxScanBytes",
      options?.maxScanBytes ?? DEFAULT_MAX_SEARCH_SCAN_BYTES,
      HARD_MAX_SEARCH_SCAN_BYTES,
    ),
    maxFileBytes: validateCodingLimit(
      "maxFileBytes",
      options?.maxFileBytes ?? DEFAULT_MAX_SEARCH_FILE_BYTES,
      HARD_MAX_SEARCH_FILE_BYTES,
    ),
    maxMatches: validateCodingLimit(
      "maxMatches",
      options?.maxMatches ?? DEFAULT_MAX_SEARCH_MATCHES,
      HARD_MAX_SEARCH_MATCHES,
    ),
    maxPatternBytes: validateCodingLimit(
      "maxPatternBytes",
      options?.maxPatternBytes ?? DEFAULT_MAX_SEARCH_PATTERN_BYTES,
      HARD_MAX_SEARCH_PATTERN_BYTES,
    ),
    maxLineBytes: validateCodingLimit(
      "maxLineBytes",
      options?.maxLineBytes ?? DEFAULT_MAX_SEARCH_LINE_BYTES,
      HARD_MAX_SEARCH_LINE_BYTES,
    ),
    maxContextLines: validateCodingLimitAllowZero(
      "maxContextLines",
      options?.maxContextLines ?? DEFAULT_MAX_SEARCH_CONTEXT_LINES,
      HARD_MAX_SEARCH_CONTEXT_LINES,
    ),
    maxTimeMs: validateCodingLimit(
      "maxTimeMs",
      options?.maxTimeMs ?? DEFAULT_MAX_SEARCH_TIME_MS,
      HARD_MAX_SEARCH_TIME_MS,
    ),
    binarySniffBytes: DEFAULT_BINARY_SNIFF_BYTES,
    exclude: Object.freeze([...(options?.exclude ?? DEFAULT_REPO_EXCLUDE)]),
  };
}

/** Normalize a workspace-relative path to stable forward-slash form. */
export function toRepoRelative(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (rel === "") return ".";
  return rel.split(sep).join("/");
}

function isPathInsideRoot(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  if (to === from) return true;
  const rel = relative(from, to);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolve a list/search start path under the workspace root.
 * Symlink escapes fail closed after realpath when the path exists.
 */
export async function resolveRepoPath(root: string, inputPath: string | undefined): Promise<{
  absolute: string;
  relative: string;
  rootReal: string;
}> {
  const rootResolved = resolve(root);
  let rootReal: string;
  try {
    rootReal = await realpath(rootResolved);
  } catch {
    throw new RepositoryError(`workspace root is missing or unreadable: ${rootResolved}`);
  }

  if (!inputPath || inputPath === "." || inputPath === "./") {
    return { absolute: rootReal, relative: ".", rootReal };
  }

  const candidate = resolveToCwd(inputPath, rootReal);
  if (!isPathInsideRoot(rootReal, candidate)) {
    throw new RepositoryError(`path escapes workspace root: ${inputPath}`);
  }

  try {
    const real = await realpath(candidate);
    if (!isPathInsideRoot(rootReal, real)) {
      throw new RepositoryError(`path resolves outside workspace root: ${inputPath}`);
    }
    return { absolute: real, relative: toRepoRelative(rootReal, real), rootReal };
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    // ENOENT: allow listing a missing path to fail later with a clear error.
    return { absolute: candidate, relative: toRepoRelative(rootReal, candidate), rootReal };
  }
}

function shouldSkipName(name: string, includeHidden: boolean, exclude: ReadonlySet<string>): boolean {
  if (name === "." || name === "..") return true;
  if (exclude.has(name)) return true;
  if (!includeHidden && name.startsWith(".")) return true;
  return false;
}

function kindFromDirent(dirent: Dirent): RepoEntryKind {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "directory";
  if (dirent.isFile()) return "file";
  return "other";
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RepositoryError("Operation aborted");
}

function assertDeadline(deadlineAt: number | undefined): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new RepositoryError("Repository operation exceeded time limit");
  }
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, DEFAULT_BINARY_SNIFF_BYTES);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function compileSearchPattern(
  query: string,
  mode: "literal" | "regex",
  caseSensitive: boolean,
  maxPatternBytes: number,
): { testLine: (line: string) => { column: number } | null; patternBytes: number } {
  const patternBytes = Buffer.byteLength(query, "utf8");
  if (patternBytes < 1) throw new RepositoryError("query must be non-empty");
  if (patternBytes > maxPatternBytes) {
    throw new RepositoryError(`query exceeds ${maxPatternBytes} byte pattern limit`);
  }

  if (mode === "literal") {
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

  let regex: RegExp;
  try {
    regex = new RegExp(query, caseSensitive ? "u" : "iu");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepositoryError(`invalid regular expression: ${message}`);
  }
  return {
    patternBytes,
    testLine: (line) => {
      regex.lastIndex = 0;
      const match = regex.exec(line);
      return match && match.index !== undefined ? { column: match.index + 1 } : null;
    },
  };
}

interface WalkLimits {
  maxDepth: number;
  maxEntries: number;
  maxFiles: number;
  exclude: ReadonlySet<string>;
  includeHidden: boolean;
  signal?: AbortSignal;
  deadlineAt?: number;
}

type WalkEvent =
  | { type: "entry"; entry: RepoListEntry; absolutePath: string; depth: number }
  | { type: "limit"; truncatedBy: "entries" | "files" | "depth" };

async function* walkRepository(
  rootReal: string,
  startAbsolute: string,
  limits: WalkLimits,
): AsyncGenerator<WalkEvent> {
  const queue: Array<{ absolute: string; relative: string; depth: number }> = [
    {
      absolute: startAbsolute,
      relative: toRepoRelative(rootReal, startAbsolute),
      depth: 0,
    },
  ];
  let scannedEntries = 0;
  let scannedFiles = 0;

  while (queue.length > 0) {
    assertNotAborted(limits.signal);
    assertDeadline(limits.deadlineAt);
    const current = queue.shift()!;
    if (current.depth > limits.maxDepth) {
      yield { type: "limit", truncatedBy: "depth" };
      return;
    }

    let dir;
    try {
      dir = await opendir(current.absolute);
    } catch (error) {
      if (current.relative === "." || current.depth === 0) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RepositoryError(`cannot open directory: ${message}`);
      }
      continue;
    }

    const names: Dirent[] = [];
    try {
      for await (const dirent of dir) {
        assertNotAborted(limits.signal);
        assertDeadline(limits.deadlineAt);
        names.push(dirent);
      }
    } finally {
      await dir.close().catch(() => undefined);
    }

    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const dirent of names) {
      assertNotAborted(limits.signal);
      assertDeadline(limits.deadlineAt);
      if (shouldSkipName(dirent.name, limits.includeHidden, limits.exclude)) continue;

      if (scannedEntries >= limits.maxEntries) {
        yield { type: "limit", truncatedBy: "entries" };
        return;
      }
      scannedEntries++;

      const absolutePath = join(current.absolute, dirent.name);
      if (!isPathInsideRoot(rootReal, absolutePath)) continue;

      let kind = kindFromDirent(dirent);
      let size: number | undefined;

      // Re-check with lstat so we never follow symlinks for type/size.
      try {
        const st = await lstat(absolutePath);
        if (st.isSymbolicLink()) kind = "symlink";
        else if (st.isDirectory()) kind = "directory";
        else if (st.isFile()) kind = "file";
        else kind = "other";
        if (kind === "file") size = st.size;
      } catch {
        continue;
      }

      if (kind === "file") {
        if (scannedFiles >= limits.maxFiles) {
          yield { type: "limit", truncatedBy: "files" };
          return;
        }
        scannedFiles++;
      }

      const relativePath =
        current.relative === "." ? dirent.name : `${current.relative}/${dirent.name}`;
      const entry: RepoListEntry = size === undefined ? { path: relativePath, kind } : { path: relativePath, kind, size };
      yield { type: "entry", entry, absolutePath, depth: current.depth };

      if (kind === "directory") {
        const nextDepth = current.depth + 1;
        if (nextDepth > limits.maxDepth) {
          yield { type: "limit", truncatedBy: "depth" };
          return;
        }
        queue.push({ absolute: absolutePath, relative: relativePath, depth: nextDepth });
      }
    }
  }
}

async function listLocal(request: RepositoryListRequest, defaults: ResolvedRepositoryLimits): Promise<RepositoryListResult> {
  const resolved = await resolveRepoPath(request.root, request.path);
  const maxResults = validateCodingLimit(
    "maxResults",
    request.maxResults ?? defaults.maxResults,
    HARD_MAX_REPO_RESULTS,
  );
  const offset = validateCodingLimitAllowZero("offset", request.offset ?? 0, HARD_MAX_REPO_ENTRIES);
  const maxDepth = validateCodingLimit("maxDepth", request.maxDepth ?? defaults.maxDepth, HARD_MAX_REPO_DEPTH);
  const exclude = new Set(request.exclude ?? defaults.exclude);
  const deadlineAt =
    request.deadlineMs !== undefined ? Date.now() + request.deadlineMs : Date.now() + defaults.maxTimeMs;

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
        kind === "file"
          ? { path: resolved.relative, kind, size: startStat.size }
          : { path: resolved.relative, kind };
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
    for await (const event of walkRepository(resolved.rootReal, resolved.absolute, {
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

async function searchLocal(
  request: RepositorySearchRequest,
  defaults: ResolvedRepositoryLimits,
): Promise<RepositorySearchResult> {
  const mode = request.mode ?? "literal";
  if (mode !== "literal" && mode !== "regex") {
    throw new RepositoryError(`unsupported search mode: ${String(mode)}`);
  }
  const caseSensitive = request.caseSensitive === true;
  const { testLine } = compileSearchPattern(
    request.query,
    mode,
    caseSensitive,
    defaults.maxPatternBytes,
  );

  const resolved = await resolveRepoPath(request.root, request.path);
  const maxMatches = validateCodingLimit(
    "maxMatches",
    request.maxMatches ?? defaults.maxMatches,
    HARD_MAX_SEARCH_MATCHES,
  );
  const context = validateCodingLimitAllowZero(
    "context",
    request.context ?? defaults.maxContextLines,
    HARD_MAX_SEARCH_CONTEXT_LINES,
  );
  const exclude = new Set(request.exclude ?? defaults.exclude);
  const deadlineAt =
    request.deadlineMs !== undefined ? Date.now() + request.deadlineMs : Date.now() + defaults.maxTimeMs;

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
      for await (const event of walkRepository(resolved.rootReal, resolved.absolute, {
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

/** Local filesystem repository operations (default backend). */
export function createLocalRepositoryOperations(
  limits?: RepositoryLimitOptions,
): RepositoryOperations {
  const resolved = resolveRepositoryLimits(limits);
  return {
    list: (request) => listLocal(request, resolved),
    search: (request) => searchLocal(request, resolved),
  };
}
