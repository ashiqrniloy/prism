/**
 * ExecFile-backed filesystem and repository operations for a disposable sandbox tree.
 *
 * Paths must stay under `workspaceRoot` (default `/workspace`). Commands use fixed
 * `/bin/sh -c` scripts with positional args so content never needs shell escaping.
 * No host↔container sync loops — each op is one (or chunked-write) execFile call.
 */
import { posix } from "node:path";
import {
  compileSearchPattern,
  isBinaryBuffer,
  resolveRepositoryLimits,
  type EditOperations,
  type ReadOperations,
  type ReadTextOptions,
  type ReadTextResult,
  type RepositoryLimitOptions,
  type RepositoryListResult,
  type RepositoryOperations,
  type RepositorySearchMatch,
  type RepositorySearchResult,
  type WriteOperations,
  HARD_MAX_WRITE_BYTES,
  HARD_MAX_EDIT_FILE_BYTES,
  HARD_MAX_TEXT_SCAN_BYTES,
} from "@arnilo/prism-coding-agent";
import type { DisposableSandbox } from "./sandbox.js";

/** Fixed scripts — tests match these exact strings. */
export const SANDBOX_FS_SCRIPTS = Object.freeze({
  read: 'dd if="$1" bs="$2" count=1 status=none 2>/dev/null',
  write: 'printf "%s" "$1" | base64 -d > "$2"',
  append: 'printf "%s" "$1" | base64 -d >> "$2"',
  truncate: ': > "$1"',
  mkdir: 'mkdir -p -- "$1"',
  access: 'test -e -- "$1"',
  stat: 'wc -c < "$1"',
  // Absolute paths; prune common heavy dirs. Extra excludes filtered in JS.
  find: `find "$1" -mindepth 1 -maxdepth "$2" \\( -name .git -o -name node_modules -o -name dist \\) -prune -o \\( -type f -o -type d -o -type l \\) -print 2>/dev/null`,
});

export class SandboxFsError extends Error {
  readonly code = "ERR_PRISM_SANDBOX_FS";
  constructor(message: string) {
    super(message);
    this.name = "SandboxFsError";
  }
}

export interface SandboxFsOperationsOptions {
  readonly workspaceRoot?: string;
  /** Cap collected exec stdout (default HARD_MAX_TEXT_SCAN_BYTES). */
  readonly maxOutputBytes?: number;
}

export interface SandboxRepositoryOperationsOptions {
  readonly workspaceRoot?: string;
  readonly limits?: RepositoryLimitOptions;
  readonly maxOutputBytes?: number;
}

/** Stay under typical ARG_MAX when base64-encoding write chunks. */
const WRITE_CHUNK_BYTES = 256 * 1024;

function normalizeWorkspaceRoot(root: string | undefined): string {
  const value = root ?? "/workspace";
  if (!posix.isAbsolute(value) || value.includes("\0")) {
    throw new SandboxFsError("workspaceRoot must be an absolute container path");
  }
  return posix.resolve(value);
}

/** Fail closed if target escapes workspace root (posix string containment; no host realpath). */
export function assertSandboxPath(workspaceRoot: string, absolutePath: string): string {
  if (!absolutePath || absolutePath.includes("\0")) {
    throw new SandboxFsError("path must be a non-empty absolute container path");
  }
  if (!posix.isAbsolute(absolutePath)) {
    throw new SandboxFsError(`path must be absolute under sandbox workspace: ${absolutePath}`);
  }
  const root = posix.resolve(workspaceRoot);
  const target = posix.resolve(absolutePath);
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new SandboxFsError(`path escapes sandbox workspace: ${absolutePath}`);
  }
  return target;
}

async function execCollect(
  sandbox: DisposableSandbox,
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    timeout?: number;
    maxBytes: number;
  },
): Promise<{ exitCode: number | null; stdout: Buffer }> {
  if (options.signal?.aborted) throw new SandboxFsError("Operation aborted");
  const chunks: Buffer[] = [];
  let size = 0;
  const { exitCode } = await sandbox.execFile({
    file,
    args: [...args],
    cwd: options.cwd,
    signal: options.signal,
    timeout: options.timeout,
    onData: (data) => {
      if (size + data.byteLength > options.maxBytes) {
        throw new SandboxFsError(`sandbox exec output exceeded ${options.maxBytes} bytes`);
      }
      chunks.push(data);
      size += data.byteLength;
    },
  });
  return { exitCode, stdout: Buffer.concat(chunks, size) };
}

function sh(
  sandbox: DisposableSandbox,
  script: string,
  positional: readonly string[],
  options: { cwd: string; signal?: AbortSignal; timeout?: number; maxBytes: number },
): Promise<{ exitCode: number | null; stdout: Buffer }> {
  return execCollect(sandbox, "/bin/sh", ["-c", script, "prism-sandbox-fs", ...positional], options);
}

function paginateText(buffer: Buffer, options: ReadTextOptions): ReadTextResult {
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  if (text.endsWith("\n") && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const totalLines = lines.length;
  const startIndex = Math.max(0, options.offset - 1);
  const maxLines = options.limit ?? options.maxLines;
  let retained = 0;
  let outputLines = 0;
  const out: string[] = [];
  let truncatedBy: "lines" | "bytes" | null = null;
  let firstLineExceedsLimit = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (outputLines === 0 && Buffer.byteLength(line, "utf8") > options.maxBytes) {
      firstLineExceedsLimit = true;
      truncatedBy = "bytes";
      break;
    }
    if (outputLines >= maxLines) {
      truncatedBy = "lines";
      break;
    }
    if (retained + lineBytes > options.maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    out.push(line);
    retained += lineBytes;
    outputLines += 1;
  }

  const hasMore = startIndex + outputLines < totalLines || truncatedBy !== null;
  return {
    content: firstLineExceedsLimit ? "" : out.join("\n"),
    startLine: options.offset,
    outputLines: firstLineExceedsLimit ? 0 : outputLines,
    hasMore,
    nextOffset: hasMore ? options.offset + (firstLineExceedsLimit ? 0 : outputLines) : undefined,
    truncatedBy,
    firstLineExceedsLimit,
    scannedBytes: buffer.byteLength,
    totalLines,
    totalBytes: buffer.byteLength,
  };
}

function toRel(root: string, abs: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (abs === root) return ".";
  if (abs.startsWith(prefix)) return abs.slice(prefix.length);
  return abs;
}

export function createSandboxFilesystemOperations(
  sandbox: DisposableSandbox,
  options?: SandboxFsOperationsOptions,
): { read: ReadOperations; write: WriteOperations; edit: EditOperations } {
  const workspaceRoot = normalizeWorkspaceRoot(options?.workspaceRoot);

  const readFile = async (
    absolutePath: string,
    opts: { maxBytes: number; signal?: AbortSignal },
  ): Promise<Buffer> => {
    const path = assertSandboxPath(workspaceRoot, absolutePath);
    const maxBytes = Math.min(Math.max(1, opts.maxBytes), HARD_MAX_TEXT_SCAN_BYTES);
    const { exitCode, stdout } = await sh(sandbox, SANDBOX_FS_SCRIPTS.read, [path, String(maxBytes)], {
      cwd: workspaceRoot,
      signal: opts.signal,
      maxBytes,
    });
    if (exitCode !== 0) throw new SandboxFsError(`failed to read ${path}`);
    return stdout.byteLength > maxBytes ? stdout.subarray(0, maxBytes) : stdout;
  };

  const access = async (absolutePath: string, opts?: { signal?: AbortSignal }): Promise<void> => {
    const path = assertSandboxPath(workspaceRoot, absolutePath);
    const { exitCode } = await sh(sandbox, SANDBOX_FS_SCRIPTS.access, [path], {
      cwd: workspaceRoot,
      signal: opts?.signal,
      maxBytes: 64,
    });
    if (exitCode !== 0) throw new SandboxFsError(`ENOENT: ${path}`);
  };

  const statFile = async (
    absolutePath: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ size: number }> => {
    const path = assertSandboxPath(workspaceRoot, absolutePath);
    const { exitCode, stdout } = await sh(sandbox, SANDBOX_FS_SCRIPTS.stat, [path], {
      cwd: workspaceRoot,
      signal: opts?.signal,
      maxBytes: 64,
    });
    if (exitCode !== 0) throw new SandboxFsError(`failed to stat ${path}`);
    const size = Number.parseInt(stdout.toString("utf8").trim(), 10);
    if (!Number.isFinite(size) || size < 0) throw new SandboxFsError(`invalid size for ${path}`);
    return { size };
  };

  const mkdir = async (dir: string, opts?: { signal?: AbortSignal }): Promise<void> => {
    const path = assertSandboxPath(workspaceRoot, dir);
    const { exitCode } = await sh(sandbox, SANDBOX_FS_SCRIPTS.mkdir, [path], {
      cwd: workspaceRoot,
      signal: opts?.signal,
      maxBytes: 64,
    });
    if (exitCode !== 0) throw new SandboxFsError(`failed to mkdir ${path}`);
  };

  const writeFile = async (
    absolutePath: string,
    content: string,
    opts?: { maxBytes?: number; signal?: AbortSignal },
  ): Promise<void> => {
    const path = assertSandboxPath(workspaceRoot, absolutePath);
    const maxBytes = Math.min(opts?.maxBytes ?? HARD_MAX_WRITE_BYTES, HARD_MAX_WRITE_BYTES);
    const buf = Buffer.from(content, "utf8");
    if (buf.byteLength > maxBytes) {
      throw new SandboxFsError(`write exceeds ${maxBytes} byte limit`);
    }

    // Ensure parent exists (best-effort).
    const parent = posix.dirname(path);
    if (parent !== path && parent !== workspaceRoot) {
      await mkdir(parent, { signal: opts?.signal }).catch(() => undefined);
    }

    if (buf.byteLength === 0) {
      const { exitCode } = await sh(sandbox, SANDBOX_FS_SCRIPTS.truncate, [path], {
        cwd: workspaceRoot,
        signal: opts?.signal,
        maxBytes: 64,
      });
      if (exitCode !== 0) throw new SandboxFsError(`failed to truncate ${path}`);
      return;
    }

    for (let offset = 0; offset < buf.byteLength; offset += WRITE_CHUNK_BYTES) {
      const chunk = buf.subarray(offset, offset + WRITE_CHUNK_BYTES);
      const b64 = chunk.toString("base64");
      const useScript = offset === 0 ? SANDBOX_FS_SCRIPTS.write : SANDBOX_FS_SCRIPTS.append;
      const { exitCode } = await sh(sandbox, useScript, [b64, path], {
        cwd: workspaceRoot,
        signal: opts?.signal,
        maxBytes: 64,
      });
      if (exitCode !== 0) throw new SandboxFsError(`failed to write ${path}`);
    }
  };

  const read: ReadOperations = {
    readFile,
    readText: async (absolutePath, options) => {
      if (options.signal?.aborted) throw new SandboxFsError("Operation aborted");
      const maxScan = Math.min(options.maxScanBytes, HARD_MAX_TEXT_SCAN_BYTES);
      const buf = await readFile(absolutePath, { maxBytes: maxScan, signal: options.signal });
      return paginateText(buf, options);
    },
    access,
    statFile,
  };

  const write: WriteOperations = { writeFile, mkdir };

  const edit: EditOperations = {
    readFile: async (absolutePath, opts) => {
      const maxBytes = Math.min(opts.maxBytes, HARD_MAX_EDIT_FILE_BYTES);
      return readFile(absolutePath, { maxBytes, signal: opts.signal });
    },
    writeFile: async (absolutePath, content, opts) =>
      writeFile(absolutePath, content, { maxBytes: HARD_MAX_EDIT_FILE_BYTES, signal: opts?.signal }),
    access,
    statFile,
  };

  return { read, write, edit };
}

export function createSandboxRepositoryOperations(
  sandbox: DisposableSandbox,
  options?: SandboxRepositoryOperationsOptions,
): RepositoryOperations {
  const workspaceRoot = normalizeWorkspaceRoot(options?.workspaceRoot);
  const limits = resolveRepositoryLimits(options?.limits);
  const maxOutputBytes = options?.maxOutputBytes ?? HARD_MAX_TEXT_SCAN_BYTES;
  const { read } = createSandboxFilesystemOperations(sandbox, {
    workspaceRoot,
    maxOutputBytes,
  });

  async function listAbsPaths(
    startAbs: string,
    maxDepth: number,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const root = assertSandboxPath(workspaceRoot, startAbs);
    const depth = Math.min(Math.max(1, maxDepth), limits.maxDepth);
    const { stdout } = await sh(sandbox, SANDBOX_FS_SCRIPTS.find, [root, String(depth)], {
      cwd: workspaceRoot,
      signal,
      maxBytes: maxOutputBytes,
    });
    return stdout
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => assertSandboxPath(workspaceRoot, line));
  }

  return {
    async list(request): Promise<RepositoryListResult> {
      if (request.signal?.aborted) throw new SandboxFsError("Operation aborted");
      const root = assertSandboxPath(workspaceRoot, request.root);
      const start = request.path ? assertSandboxPath(workspaceRoot, posix.resolve(root, request.path)) : root;
      const maxDepth = request.maxDepth ?? limits.maxDepth;
      const maxResults = request.maxResults ?? limits.maxResults;
      const offset = request.offset ?? 0;
      const exclude = new Set(request.exclude ?? limits.exclude);
      const includeHidden = request.includeHidden === true;

      const absPaths = await listAbsPaths(start, maxDepth, request.signal);
      const entries: RepositoryListResult["entries"][number][] = [];
      let scannedEntries = 0;
      let scannedFiles = 0;
      let truncatedBy: RepositoryListResult["truncatedBy"] = null;

      for (const absPath of absPaths) {
        if (request.signal?.aborted) {
          truncatedBy = "abort";
          break;
        }
        const rel = toRel(start, absPath);
        const base = posix.basename(rel);
        if (!includeHidden && base.startsWith(".")) continue;
        if (exclude.has(base)) continue;
        scannedEntries += 1;
        if (scannedEntries > limits.maxEntries) {
          truncatedBy = "entries";
          break;
        }

        try {
          const st = await read.statFile(absPath, { signal: request.signal });
          scannedFiles += 1;
          if (scannedFiles > limits.maxFiles) {
            truncatedBy = "files";
            break;
          }
          entries.push({ path: rel, kind: "file", size: st.size });
        } catch {
          entries.push({ path: rel, kind: "directory" });
        }

        if (entries.length >= offset + maxResults) {
          truncatedBy = truncatedBy ?? "results";
          break;
        }
      }

      const sliced = entries.slice(offset, offset + maxResults);
      const truncated = truncatedBy !== null || entries.length > offset + sliced.length;
      return {
        entries: sliced,
        truncated,
        truncatedBy: truncated ? (truncatedBy ?? "results") : null,
        scannedEntries,
        scannedFiles,
        offset,
        nextOffset: truncated ? offset + sliced.length : undefined,
      };
    },

    async search(request): Promise<RepositorySearchResult> {
      if (request.signal?.aborted) throw new SandboxFsError("Operation aborted");
      const root = assertSandboxPath(workspaceRoot, request.root);
      const start = request.path ? assertSandboxPath(workspaceRoot, posix.resolve(root, request.path)) : root;
      const { testLine } = compileSearchPattern(
        request.query,
        request.mode ?? "literal",
        request.caseSensitive === true,
        limits.maxPatternBytes,
      );
      const maxMatches = request.maxMatches ?? limits.maxMatches;
      const context = Math.min(request.context ?? limits.maxContextLines, limits.maxContextLines);
      const exclude = new Set(request.exclude ?? limits.exclude);
      const includeHidden = request.includeHidden === true;
      const deadlineAt = Date.now() + (request.deadlineMs ?? limits.maxTimeMs);

      const absPaths = await listAbsPaths(start, limits.maxDepth, request.signal);
      const matches: RepositorySearchMatch[] = [];
      let scannedBytes = 0;
      let scannedFiles = 0;
      let scannedEntries = 0;
      let filesSkippedBinary = 0;
      let filesSkippedOversize = 0;
      let truncatedBy: RepositorySearchResult["truncatedBy"] = null;

      for (const absPath of absPaths) {
        if (Date.now() >= deadlineAt) {
          truncatedBy = "time";
          break;
        }
        if (request.signal?.aborted) {
          truncatedBy = "abort";
          break;
        }
        const rel = toRel(start, absPath);
        const base = posix.basename(rel);
        if (!includeHidden && base.startsWith(".")) continue;
        if (exclude.has(base)) continue;
        scannedEntries += 1;

        let buf: Buffer;
        try {
          const st = await read.statFile(absPath, { signal: request.signal });
          if (st.size > limits.maxFileBytes) {
            filesSkippedOversize += 1;
            continue;
          }
          buf = await read.readFile(absPath, {
            maxBytes: Math.min(st.size, limits.maxFileBytes),
            signal: request.signal,
          });
        } catch {
          continue;
        }

        scannedFiles += 1;
        scannedBytes += buf.byteLength;
        if (scannedBytes > limits.maxScanBytes) {
          truncatedBy = "scan";
          break;
        }
        if (isBinaryBuffer(buf)) {
          filesSkippedBinary += 1;
          continue;
        }

        const text = buf.toString("utf8");
        const lines = text.split("\n");
        if (text.endsWith("\n") && lines[lines.length - 1] === "") lines.pop();
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (Buffer.byteLength(line, "utf8") > limits.maxLineBytes) continue;
          const hit = testLine(line);
          if (!hit) continue;
          matches.push({
            path: rel,
            line: i + 1,
            column: hit.column,
            text: line,
            before: lines.slice(Math.max(0, i - context), i),
            after: lines.slice(i + 1, i + 1 + context),
          });
          if (matches.length >= maxMatches) {
            truncatedBy = "matches";
            break;
          }
        }
        if (truncatedBy === "matches") break;
      }

      return {
        matches,
        truncated: truncatedBy !== null,
        truncatedBy,
        scannedBytes,
        scannedFiles,
        scannedEntries,
        filesSkippedBinary,
        filesSkippedOversize,
      };
    },
  };
}
