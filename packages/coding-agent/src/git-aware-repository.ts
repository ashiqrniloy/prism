/**
 * Git-aware repository enumeration over `git ls-files`.
 *
 * Detection: `git rev-parse --is-inside-work-tree` (cached per instance).
 * Non-Git / detection failure → native fallback. Post-detection Git failure → fail closed.
 * No hand-rolled `.gitignore` parser; argv is fixed host-side only.
 */

import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createBoundGitRunner, gitText, type BoundGitRunner, type CreateGitRunnerOptions, GitError } from "./git-exec.js";
import { DEFAULT_MAX_LS_FILES_OUTPUT_BYTES, HARD_MAX_LS_FILES_OUTPUT_BYTES, validateCodingLimit } from "./limits.js";
import {
  createLocalRepositoryOperations,
  RepositoryError,
  toRepoRelative,
  type RepoListEntry,
  type RepositoryLimitOptions,
  type RepositoryOperations,
  type RepositoryWalk,
  type RepositoryWalkEvent,
  type RepositoryWalkLimits,
} from "./repository.js";

export interface GitAwareRepositoryOptions {
  readonly git?: CreateGitRunnerOptions | BoundGitRunner;
  readonly fallback?: RepositoryOperations;
  /** Host-config only, never model-settable. Default false: ignored paths stay excluded. */
  readonly includeIgnored?: boolean;
  readonly limits?: RepositoryLimitOptions;
  /** Override freeze default/hard `ls-files` stdout cap. */
  readonly maxLsFilesOutputBytes?: number;
}

function isBoundGitRunner(value: CreateGitRunnerOptions | BoundGitRunner): value is BoundGitRunner {
  return typeof (value as BoundGitRunner).exec === "function" && typeof (value as BoundGitRunner).gitPath === "string";
}

function shouldSkipName(name: string, includeHidden: boolean, exclude: ReadonlySet<string>): boolean {
  if (name === "." || name === "..") return true;
  if (exclude.has(name)) return true;
  if (!includeHidden && name.startsWith(".")) return true;
  return false;
}

function pathHasSkippedComponent(relativePath: string, includeHidden: boolean, exclude: ReadonlySet<string>): boolean {
  for (const part of relativePath.split("/")) {
    if (shouldSkipName(part, includeHidden, exclude)) return true;
  }
  return false;
}

/** Parse NUL-delimited `git ls-files -z` stdout. */
export function parseGitLsFilesZ(buffer: Buffer): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      if (i > start) out.push(buffer.subarray(start, i).toString("utf8"));
      start = i + 1;
    }
  }
  if (start < buffer.length) out.push(buffer.subarray(start).toString("utf8"));
  return out;
}

function depthFromStart(relativePath: string, startRel: string): number {
  const rel =
    startRel === "."
      ? relativePath
      : relativePath === startRel
        ? ""
        : relativePath.startsWith(`${startRel}/`)
          ? relativePath.slice(startRel.length + 1)
          : relativePath;
  if (rel === "" || rel === ".") return 0;
  return rel.split("/").length - 1;
}

function isUnderStart(relativePath: string, startRel: string): boolean {
  if (startRel === "." || startRel === "") return true;
  return relativePath === startRel || relativePath.startsWith(`${startRel}/`);
}

async function* walkGitFiles(
  rootReal: string,
  startAbsolute: string,
  limits: RepositoryWalkLimits,
  files: readonly string[],
): AsyncGenerator<RepositoryWalkEvent> {
  const startRel = toRepoRelative(rootReal, startAbsolute);
  const dirSeen = new Set<string>();
  const planned: Array<{ path: string; kind: "directory" | "file"; depth: number }> = [];

  for (const relativePath of files) {
    if (limits.signal?.aborted) throw new RepositoryError("Operation aborted");
    if (limits.deadlineAt !== undefined && Date.now() >= limits.deadlineAt) {
      throw new RepositoryError("Repository operation exceeded time limit");
    }
    if (!relativePath || relativePath.includes("\0")) continue;
    if (relativePath === ".git" || relativePath.startsWith(".git/")) continue;
    if (!isUnderStart(relativePath, startRel)) continue;
    if (pathHasSkippedComponent(relativePath, limits.includeHidden, limits.exclude)) continue;

    const fileDepth = depthFromStart(relativePath, startRel);
    if (fileDepth > limits.maxDepth) continue;

    // Synthesize parent directories within the start scope (native walker emits dirs too).
    const parts = relativePath.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      if (!isUnderStart(acc, startRel)) continue;
      if (pathHasSkippedComponent(acc, limits.includeHidden, limits.exclude)) break;
      const dirDepth = depthFromStart(acc, startRel);
      if (dirDepth > limits.maxDepth) break;
      if (!dirSeen.has(acc)) {
        dirSeen.add(acc);
        planned.push({ path: acc, kind: "directory", depth: dirDepth });
      }
    }
    planned.push({ path: relativePath, kind: "file", depth: fileDepth });
  }

  planned.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  let scannedEntries = 0;
  let scannedFiles = 0;

  for (const item of planned) {
    if (limits.signal?.aborted) throw new RepositoryError("Operation aborted");
    if (limits.deadlineAt !== undefined && Date.now() >= limits.deadlineAt) {
      throw new RepositoryError("Repository operation exceeded time limit");
    }
    if (scannedEntries >= limits.maxEntries) {
      yield { type: "limit", truncatedBy: "entries" };
      return;
    }

    const absolutePath = join(rootReal, item.path);
    const rootResolved = resolve(rootReal);
    const absResolved = resolve(absolutePath);
    if (absResolved !== rootResolved && !absResolved.startsWith(`${rootResolved}/`)) continue;

    let kind: RepoListEntry["kind"] = item.kind;
    let size: number | undefined;
    try {
      const st = await lstat(absolutePath);
      if (st.isSymbolicLink()) kind = "symlink";
      else if (st.isDirectory()) kind = "directory";
      else if (st.isFile()) {
        kind = "file";
        size = st.size;
      } else kind = "other";
    } catch {
      // Missing after ls-files (race) — skip.
      continue;
    }

    if (kind === "file") {
      if (scannedFiles >= limits.maxFiles) {
        yield { type: "limit", truncatedBy: "files" };
        return;
      }
      scannedFiles++;
    }

    scannedEntries++;
    const entry: RepoListEntry = size === undefined ? { path: item.path, kind } : { path: item.path, kind, size };
    yield { type: "entry", entry, absolutePath, depth: item.depth };
  }
}

/**
 * Repository operations that prefer Git tracked/unignored enumeration.
 * Outside a Git work tree (or when detection fails), delegates to `fallback`.
 */
export function createGitAwareRepositoryOperations(cwd: string, options?: GitAwareRepositoryOptions): RepositoryOperations {
  const fallback = options?.fallback ?? createLocalRepositoryOperations(options?.limits);
  const includeIgnored = options?.includeIgnored === true;
  const maxLsBytes = validateCodingLimit(
    "maxLsFilesOutputBytes",
    options?.maxLsFilesOutputBytes ?? DEFAULT_MAX_LS_FILES_OUTPUT_BYTES,
    HARD_MAX_LS_FILES_OUTPUT_BYTES,
  );

  let detected: boolean | undefined;
  let runnerPromise: Promise<BoundGitRunner> | undefined;
  let gitOps: RepositoryOperations | undefined;

  function getRunner(): Promise<BoundGitRunner> {
    if (!runnerPromise) {
      const git = options?.git;
      runnerPromise =
        git && isBoundGitRunner(git)
          ? Promise.resolve(git)
          : createBoundGitRunner({
              ...(git as CreateGitRunnerOptions | undefined),
              maxOutputBytes: maxLsBytes,
            });
    }
    return runnerPromise;
  }

  async function detect(signal?: AbortSignal): Promise<boolean> {
    if (detected !== undefined) return detected;
    try {
      const result = await (await getRunner()).exec({
        args: ["rev-parse", "--is-inside-work-tree"],
        cwd,
        signal,
        maxOutputBytes: 64,
      });
      detected = result.exitCode === 0 && gitText(result).trim() === "true";
    } catch {
      detected = false;
    }
    return detected;
  }

  async function listGitPaths(signal?: AbortSignal): Promise<string[]> {
    const runner = await getRunner();
    // Fixed argv only — never model-supplied flags (Task 0 freeze).
    const primary = await runner.exec({
      args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      cwd,
      signal,
      maxOutputBytes: maxLsBytes,
    });
    if (primary.timedOut) throw new RepositoryError("Repository operation exceeded time limit");
    if (primary.aborted) throw new RepositoryError("Operation aborted");
    if (primary.exitCode !== 0) {
      throw new RepositoryError(`git ls-files failed (exit ${primary.exitCode})`);
    }
    const paths = new Set(parseGitLsFilesZ(primary.stdout));

    if (includeIgnored) {
      // Second invocation only when host opts into ignored paths (≤ 2 total per freeze).
      const ignored = await runner.exec({
        args: ["ls-files", "-o", "-i", "--exclude-standard", "-z"],
        cwd,
        signal,
        maxOutputBytes: maxLsBytes,
      });
      if (ignored.timedOut) throw new RepositoryError("Repository operation exceeded time limit");
      if (ignored.aborted) throw new RepositoryError("Operation aborted");
      if (ignored.exitCode !== 0) {
        throw new RepositoryError(`git ls-files (ignored) failed (exit ${ignored.exitCode})`);
      }
      for (const p of parseGitLsFilesZ(ignored.stdout)) paths.add(p);
    }

    return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function getGitOps(): RepositoryOperations {
    if (!gitOps) {
      const walk: RepositoryWalk = async function* (rootReal, startAbsolute, limits) {
        let files: string[];
        try {
          files = await listGitPaths(limits.signal);
        } catch (error) {
          if (error instanceof RepositoryError) throw error;
          if (error instanceof GitError) {
            if (/abort/i.test(error.message)) throw new RepositoryError("Operation aborted");
            if (/time|exceeded/i.test(error.message)) {
              throw new RepositoryError("Repository operation exceeded time limit");
            }
            throw new RepositoryError(error.message);
          }
          throw new RepositoryError(error instanceof Error ? error.message : String(error));
        }
        yield* walkGitFiles(rootReal, startAbsolute, limits, files);
      };
      gitOps = createLocalRepositoryOperations(options?.limits, walk);
    }
    return gitOps;
  }

  async function route<T>(signal: AbortSignal | undefined, gitCall: () => Promise<T>, nativeCall: () => Promise<T>): Promise<T> {
    if (!(await detect(signal))) return nativeCall();
    return gitCall();
  }

  return {
    list: (request) =>
      route(
        request.signal,
        () => getGitOps().list(request),
        () => fallback.list(request),
      ),
    search: (request) =>
      route(
        request.signal,
        () => getGitOps().search(request),
        () => fallback.search(request),
      ),
    glob: (request) =>
      route(
        request.signal,
        () => getGitOps().glob(request),
        () => fallback.glob(request),
      ),
  };
}
