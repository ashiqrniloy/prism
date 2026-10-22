/**
 * Structured Git operations over a typed runner.
 *
 * All invocations use file+argument arrays with `--` pathspec separation,
 * `git check-ref-format` for refs, and safe config that disables hooks,
 * external diff/textconv, pagers, and credential prompts by default.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "./artifacts.js";
import {
  type BoundGitRunner,
  type CreateGitRunnerOptions,
  createBoundGitRunner,
  GitError,
  type GitExecResult,
  gitRequireOk,
  gitText,
} from "./git-exec.js";
import { type GitStatusResult, parsePorcelainV2 } from "./git-status.js";
import {
  DEFAULT_MAX_GIT_CHANGED_FILES,
  DEFAULT_MAX_GIT_DIFF_LINES,
  DEFAULT_MAX_GIT_MESSAGE_BYTES,
  DEFAULT_MAX_GIT_OUTPUT_BYTES,
  DEFAULT_MAX_GIT_PATCH_BYTES,
  DEFAULT_MAX_GIT_PATHS,
  DEFAULT_MAX_GIT_REF_BYTES,
  DEFAULT_MAX_GIT_WORKTREES,
  DEFAULT_MAX_PR_COMMITS,
  DEFAULT_MAX_PR_HANDOFF_BYTES,
  HARD_MAX_GIT_CHANGED_FILES,
  HARD_MAX_GIT_DIFF_LINES,
  HARD_MAX_GIT_MESSAGE_BYTES,
  HARD_MAX_GIT_OUTPUT_BYTES,
  HARD_MAX_GIT_PATCH_BYTES,
  HARD_MAX_GIT_PATHS,
  HARD_MAX_GIT_REF_BYTES,
  HARD_MAX_GIT_WORKTREES,
  HARD_MAX_PR_COMMITS,
  HARD_MAX_PR_HANDOFF_BYTES,
  validateCodingLimit,
} from "./limits.js";
import { resolveToCwd } from "./path-utils.js";

export interface GitLimitOptions {
  readonly maxPaths?: number;
  readonly maxRefBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxDiffLines?: number;
  readonly maxChangedFiles?: number;
  readonly maxPatchBytes?: number;
  readonly maxWorktrees?: number;
  readonly maxPrCommits?: number;
  readonly maxPrHandoffBytes?: number;
}

export interface ResolvedGitLimits {
  readonly maxPaths: number;
  readonly maxRefBytes: number;
  readonly maxMessageBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiffLines: number;
  readonly maxChangedFiles: number;
  readonly maxPatchBytes: number;
  readonly maxWorktrees: number;
  readonly maxPrCommits: number;
  readonly maxPrHandoffBytes: number;
}

export function resolveGitLimits(options?: GitLimitOptions): ResolvedGitLimits {
  return {
    maxPaths: validateCodingLimit("maxPaths", options?.maxPaths ?? DEFAULT_MAX_GIT_PATHS, HARD_MAX_GIT_PATHS),
    maxRefBytes: validateCodingLimit("maxRefBytes", options?.maxRefBytes ?? DEFAULT_MAX_GIT_REF_BYTES, HARD_MAX_GIT_REF_BYTES),
    maxMessageBytes: validateCodingLimit(
      "maxMessageBytes",
      options?.maxMessageBytes ?? DEFAULT_MAX_GIT_MESSAGE_BYTES,
      HARD_MAX_GIT_MESSAGE_BYTES,
    ),
    maxOutputBytes: validateCodingLimit(
      "maxOutputBytes",
      options?.maxOutputBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES,
      HARD_MAX_GIT_OUTPUT_BYTES,
    ),
    maxDiffLines: validateCodingLimit("maxDiffLines", options?.maxDiffLines ?? DEFAULT_MAX_GIT_DIFF_LINES, HARD_MAX_GIT_DIFF_LINES),
    maxChangedFiles: validateCodingLimit(
      "maxChangedFiles",
      options?.maxChangedFiles ?? DEFAULT_MAX_GIT_CHANGED_FILES,
      HARD_MAX_GIT_CHANGED_FILES,
    ),
    maxPatchBytes: validateCodingLimit("maxPatchBytes", options?.maxPatchBytes ?? DEFAULT_MAX_GIT_PATCH_BYTES, HARD_MAX_GIT_PATCH_BYTES),
    maxWorktrees: validateCodingLimit("maxWorktrees", options?.maxWorktrees ?? DEFAULT_MAX_GIT_WORKTREES, HARD_MAX_GIT_WORKTREES),
    maxPrCommits: validateCodingLimit("maxPrCommits", options?.maxPrCommits ?? DEFAULT_MAX_PR_COMMITS, HARD_MAX_PR_COMMITS),
    maxPrHandoffBytes: validateCodingLimit(
      "maxPrHandoffBytes",
      options?.maxPrHandoffBytes ?? DEFAULT_MAX_PR_HANDOFF_BYTES,
      HARD_MAX_PR_HANDOFF_BYTES,
    ),
  };
}

export interface ArtifactReference {
  readonly kind: "patch" | "bundle" | "diff" | "other";
  readonly uri: string;
  readonly sha256: string;
  readonly bytes: number;
}

export type ArtifactWriter = (input: {
  readonly kind: ArtifactReference["kind"];
  readonly filename: string;
  readonly bytes: Buffer;
}) => Promise<ArtifactReference>;

export interface PrHandoff {
  readonly base: string;
  readonly head: string;
  readonly commits: readonly { sha: string; subject: string }[];
  readonly changedPaths: readonly string[];
  readonly diffstat: string;
  readonly checks: readonly { name: string; exitCode: number; summary: string }[];
  readonly artifact?: ArtifactReference;
}

/** One entry from `git worktree list --porcelain -z` (plan 026 Task 3). */
export interface GitWorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  /** Porcelain `locked` record present. */
  locked?: boolean;
  /** Lock reason text when the porcelain record carries one. */
  lockReason?: string;
}

export interface GitFingerprint {
  /** SHA-256 of the credential-free remote URL plus default branch; never the URL itself. */
  readonly remoteFingerprint: string;
  readonly defaultBranch?: string;
}

export interface GitOperations {
  status(options?: { includeIgnored?: boolean; signal?: AbortSignal }): Promise<GitStatusResult>;
  diff(options?: {
    staged?: boolean;
    /** Diff the worktree against this commit-ish instead of the index (`git diff <base>`). */
    base?: string;
    paths?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ text: string; truncated: boolean; lineCount: number; artifact?: ArtifactReference }>;
  branch(options: {
    action: "validate" | "create" | "switch" | "list" | "delete";
    name?: string;
    /** `delete` only: `-D` instead of the merged-only default `-d`. */
    force?: boolean;
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ refs?: string[]; name?: string; checkpoint?: string }>;
  worktree(options: {
    action: "list" | "add" | "remove" | "lock" | "unlock";
    path?: string;
    branch?: string;
    /** `add` only: the commit-ish the new branch starts at (default `HEAD`). */
    base?: string;
    force?: boolean;
    reason?: string;
    signal?: AbortSignal;
  }): Promise<{ worktrees: readonly GitWorktreeEntry[]; path?: string }>;
  /**
   * Read-only merge probe (`merge-tree --write-tree --name-only`). Returns the merged tree oid
   * and the conflicted paths; a clean merge reports none. Never touches a ref, the index, or a
   * worktree, so a conflict leaves every tree byte-for-byte unchanged.
   */
  mergeTree(options: { into: string; from: string; signal?: AbortSignal }): Promise<{ tree: string; conflicts: readonly string[] }>;
  /**
   * Create a commit object from an existing tree (`commit-tree`). Writes one loose object and no
   * ref. The repository's configured identity is used; with none configured this fails.
   */
  commitTree(options: { tree: string; parents: readonly string[]; message: string; signal?: AbortSignal }): Promise<string>;
  /**
   * Stage every change in the worktree, including untracked files (`add -A`). Mutates the index;
   * callers that need it unchanged snapshot it first with {@link GitOperations.writeTree}.
   */
  stageAll(options?: { signal?: AbortSignal }): Promise<void>;
  /** The tree object of the current index (`write-tree`). Writes one loose object and no ref. */
  writeTree(options?: { signal?: AbortSignal }): Promise<string>;
  /** Replace the index with `tree` (`read-tree`), leaving the worktree untouched. */
  readTree(options: { tree: string; signal?: AbortSignal }): Promise<void>;
  /** Compare-and-swap a ref (`update-ref`). `expected` makes the update fail when the ref moved. */
  updateRef(options: { ref: string; to: string; expected?: string; signal?: AbortSignal }): Promise<void>;
  /**
   * Fast-forward the checked-out branch to `to` (`merge --ff-only`), updating the index and the
   * worktree so they stay consistent with HEAD. Refuses when `to` is not a descendant.
   */
  fastForward(options: { to: string; signal?: AbortSignal }): Promise<void>;
  /** Untracked, non-ignored paths (`ls-files --others --exclude-standard`), worktree-relative. */
  untrackedFiles(options?: { signal?: AbortSignal }): Promise<readonly string[]>;
  /**
   * Repository identity for durable correlation: credential-free remote
   * fingerprint plus default branch. Runs bounded read-only git queries only.
   */
  fingerprint(options?: { signal?: AbortSignal }): Promise<GitFingerprint>;
  apply(options: {
    patch: string;
    action: "check" | "apply" | "reverse";
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; checkpoint?: string; restored?: boolean; output: string }>;
  commit(options: {
    paths: readonly string[];
    message: string;
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ sha: string; checkpoint?: string }>;
  prHandoff(options: {
    base: string;
    head?: string;
    checks?: readonly { name: string; exitCode: number; summary: string }[];
    includeBundle?: boolean;
    signal?: AbortSignal;
  }): Promise<PrHandoff>;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

async function validateBranchName(
  runner: BoundGitRunner,
  cwd: string,
  name: string,
  limits: ResolvedGitLimits,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof name !== "string" || name.length === 0) throw new GitError("branch name is required");
  if (byteLength(name) > limits.maxRefBytes) throw new GitError(`branch name exceeds ${limits.maxRefBytes} byte limit`);
  if (name.includes("\0") || name.includes("\n") || name.includes("\r") || name.startsWith("-")) {
    throw new GitError("branch name must not start with '-' or contain NUL/newlines");
  }
  const result = await runner.exec({
    args: ["check-ref-format", "--branch", name],
    cwd,
    signal,
    maxOutputBytes: 64 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new GitError(`invalid branch name: ${name}`);
  }
  return name;
}

async function validateRef(
  runner: BoundGitRunner,
  cwd: string,
  ref: string,
  limits: ResolvedGitLimits,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof ref !== "string" || !ref.startsWith("refs/")) throw new GitError("ref must be a full refs/ name");
  if (byteLength(ref) > limits.maxRefBytes) throw new GitError(`ref exceeds ${limits.maxRefBytes} byte limit`);
  if (ref.includes("\0") || ref.includes("\n") || ref.includes("\r") || ref.includes("..")) {
    throw new GitError("ref must not contain NUL/newlines or '..'");
  }
  const result = await runner.exec({ args: ["check-ref-format", ref], cwd, signal, maxOutputBytes: 64 * 1024 });
  if (result.exitCode !== 0) throw new GitError(`invalid ref: ${ref}`);
  return ref;
}

/**
 * Validate a commit-ish (`HEAD`, a ref, an oid, `HEAD~1`) for use as a git argument. A leading
 * `-` is refused so the value can never be read as an option, and NUL/newlines are refused.
 */
function validateCommitish(value: string, limits: ResolvedGitLimits): string {
  if (typeof value !== "string" || value.length === 0) throw new GitError("commit-ish is required");
  if (byteLength(value) > limits.maxRefBytes) throw new GitError(`commit-ish exceeds ${limits.maxRefBytes} byte limit`);
  if (value.startsWith("-") || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new GitError("commit-ish must not start with '-' or contain NUL/newlines");
  }
  return value;
}

function validatePaths(paths: readonly string[], limits: ResolvedGitLimits): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new GitError("paths must be a non-empty array");
  }
  if (paths.length > limits.maxPaths) {
    throw new GitError(`paths exceed ${limits.maxPaths} entry limit`);
  }
  const out: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0) {
      throw new GitError("each path must be a non-empty string");
    }
    if (path.includes("\0")) throw new GitError("path must not contain NUL");
    // Keep leading-dash paths as data; always pass after `--`.
    out.push(path);
  }
  return out;
}

function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean; lineCount: number } {
  if (text.length === 0) return { text: "", truncated: false, lineCount: 0 };
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) lines.pop();
  const lineCount = lines.length;
  if (lineCount <= maxLines) return { text, truncated: false, lineCount };
  const kept = `${lines.slice(0, maxLines).join("\n")}\n`;
  return { text: kept, truncated: true, lineCount };
}

async function withTempFile<T>(prefix: string, contents: string | Buffer, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(dir, "payload");
  try {
    await writeFile(filePath, contents, { mode: 0o600 });
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface CreateGitOperationsOptions extends CreateGitRunnerOptions, GitLimitOptions {
  readonly cwd: string;
  readonly artifactWriter?: ArtifactWriter;
  /** Required for `commit` when the repository has no usable identity. */
  readonly commitIdentity?: { readonly name: string; readonly email: string };
}

export async function createGitOperations(options: CreateGitOperationsOptions): Promise<GitOperations> {
  const cwd = resolveToCwd(options.cwd, process.cwd());
  const limits = resolveGitLimits(options);
  const runner = await createBoundGitRunner(options);
  const artifacts = options.artifactWriter;

  async function status(request?: { includeIgnored?: boolean; signal?: AbortSignal }): Promise<GitStatusResult> {
    const args = ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"];
    if (request?.includeIgnored) args.push("--ignored=traditional");
    const result = await gitRequireOk(
      runner,
      {
        args,
        cwd,
        signal: request?.signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git status",
    );
    return parsePorcelainV2(result.stdout, { maxEntries: limits.maxChangedFiles });
  }

  async function ensureCleanOrCheckpoint(
    createCheckpoint: boolean | undefined,
    signal: AbortSignal | undefined,
    label: string,
    allowPaths?: ReadonlySet<string>,
  ): Promise<string | undefined> {
    const current = await status({ signal });
    const blocking = current.entries.filter((entry) => {
      if (entry.kind === "ignored") return false;
      if (!allowPaths) return true;
      if (allowPaths.has(entry.path)) return false;
      if (entry.origPath && allowPaths.has(entry.origPath)) return false;
      return true;
    });
    if (blocking.length === 0) return undefined;
    if (!createCheckpoint) {
      throw new GitError(
        `${label} refused: worktree is dirty. Pass createCheckpoint=true to stash a bounded checkpoint first, or use a disposable worktree.`,
      );
    }
    const stashPaths = [...new Set(blocking.flatMap((entry) => (entry.origPath ? [entry.path, entry.origPath] : [entry.path])))];
    if (stashPaths.length > limits.maxPaths) {
      throw new GitError(`checkpoint paths exceed ${limits.maxPaths} entry limit`);
    }
    await gitRequireOk(
      runner,
      {
        args: ["stash", "push", "-u", "-m", "prism-git-checkpoint", "--", ...stashPaths],
        cwd,
        signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git stash checkpoint",
    );
    const top = await gitRequireOk(
      runner,
      { args: ["rev-parse", "-q", "--verify", "refs/stash"], cwd, signal, maxOutputBytes: 64 * 1024 },
      "git rev-parse stash",
    );
    return gitText(top).trim() || "refs/stash";
  }

  async function restoreCheckpoint(checkpoint: string | undefined, signal?: AbortSignal): Promise<boolean> {
    if (!checkpoint) return false;
    await gitRequireOk(
      runner,
      {
        args: ["stash", "pop", "--index"],
        cwd,
        signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git stash pop",
    );
    return true;
  }

  async function diff(request?: {
    staged?: boolean;
    base?: string;
    paths?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ text: string; truncated: boolean; lineCount: number; artifact?: ArtifactReference }> {
    const built = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if (request?.staged) built.push("--cached");
    if (request?.base !== undefined) {
      built.push(validateCommitish(request.base, limits));
    }
    built.push("--");
    if (request?.paths) {
      built.push(...validatePaths(request.paths, limits));
    }
    const result = await gitRequireOk(
      runner,
      { args: built, cwd, signal: request?.signal, maxOutputBytes: limits.maxOutputBytes },
      "git diff",
    );
    const raw = gitText(result);
    const trimmed = truncateLines(raw, limits.maxDiffLines);
    let artifact: ArtifactReference | undefined;
    if (trimmed.truncated && artifacts) {
      artifact = await artifacts({
        kind: "diff",
        filename: "diff.patch",
        bytes: Buffer.from(raw, "utf8"),
      });
    }
    return { ...trimmed, artifact };
  }

  async function branch(request: {
    action: "validate" | "create" | "switch" | "list" | "delete";
    name?: string;
    force?: boolean;
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ refs?: string[]; name?: string; checkpoint?: string }> {
    if (request.action === "list") {
      const result = await gitRequireOk(
        runner,
        {
          args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
          cwd,
          signal: request.signal,
          maxOutputBytes: limits.maxOutputBytes,
        },
        "git for-each-ref",
      );
      const refs = gitText(result)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return { refs };
    }

    const name = await validateBranchName(runner, cwd, request.name ?? "", limits, request.signal);
    if (request.action === "validate") return { name };

    if (request.action === "create") {
      await gitRequireOk(
        runner,
        { args: ["branch", "--", name], cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes },
        "git branch create",
      );
      return { name };
    }

    if (request.action === "delete") {
      // `-d` (default) refuses a branch that is not fully merged; `-D` is the caller's explicit choice.
      await gitRequireOk(
        runner,
        {
          args: ["branch", request.force === true ? "-D" : "-d", "--", name],
          cwd,
          signal: request.signal,
          maxOutputBytes: limits.maxOutputBytes,
        },
        "git branch delete",
      );
      return { name };
    }

    // switch
    const checkpoint = await ensureCleanOrCheckpoint(request.createCheckpoint, request.signal, "git switch");
    try {
      await gitRequireOk(
        runner,
        { args: ["switch", "--", name], cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes },
        "git switch",
      );
      return { name, checkpoint };
    } catch (error) {
      if (checkpoint) await restoreCheckpoint(checkpoint, request.signal).catch(() => undefined);
      throw error;
    }
  }

  async function worktree(request: {
    action: "list" | "add" | "remove" | "lock" | "unlock";
    path?: string;
    branch?: string;
    base?: string;
    force?: boolean;
    reason?: string;
    signal?: AbortSignal;
  }): Promise<{ worktrees: readonly GitWorktreeEntry[]; path?: string }> {
    if (request.action === "list") {
      const result = await gitRequireOk(
        runner,
        {
          args: ["worktree", "list", "--porcelain", "-z"],
          cwd,
          signal: request.signal,
          maxOutputBytes: limits.maxOutputBytes,
        },
        "git worktree list",
      );
      const records = gitText(result).split("\0").filter(Boolean);
      const worktrees: GitWorktreeEntry[] = [];
      let current: GitWorktreeEntry | undefined;
      for (const record of records) {
        if (record.startsWith("worktree ")) {
          if (current) worktrees.push(current);
          current = { path: record.slice("worktree ".length) };
        } else if (current && record.startsWith("HEAD ")) {
          current.head = record.slice("HEAD ".length);
        } else if (current && record.startsWith("branch ")) {
          current.branch = record.slice("branch ".length);
        } else if (current && record.startsWith("locked")) {
          current.locked = true;
          const reason = record.slice("locked".length).trim();
          if (reason) current.lockReason = reason;
        }
      }
      if (current) worktrees.push(current);
      if (worktrees.length > limits.maxWorktrees) {
        return { worktrees: worktrees.slice(0, limits.maxWorktrees) };
      }
      return { worktrees };
    }

    if (request.action === "lock" || request.action === "unlock") {
      if (!request.path) throw new GitError("worktree path is required");
      if (request.path.includes("\0") || request.path.startsWith("-")) {
        throw new GitError("worktree path must not start with '-' or contain NUL");
      }
      const args = ["worktree", request.action];
      if (request.action === "lock" && request.reason) {
        if (request.reason.includes("\0") || Buffer.byteLength(request.reason, "utf8") > 1024) {
          throw new GitError("worktree lock reason must be bounded and NUL-free");
        }
        args.push("--reason", request.reason);
      }
      args.push("--", request.path);
      await gitRequireOk(
        runner,
        { args, cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes },
        `git worktree ${request.action}`,
      );
      return { worktrees: (await worktree({ action: "list", signal: request.signal })).worktrees, path: request.path };
    }

    if (request.action === "add") {
      const existing = await worktree({ action: "list", signal: request.signal });
      if (existing.worktrees.length >= limits.maxWorktrees) {
        throw new GitError(`worktree count would exceed ${limits.maxWorktrees} limit`);
      }
      if (!request.path) throw new GitError("worktree path is required");
      if (request.path.includes("\0") || request.path.startsWith("-")) {
        throw new GitError("worktree path must not start with '-' or contain NUL");
      }
      const args = ["worktree", "add"];
      if (request.branch) {
        const branchName = await validateBranchName(runner, cwd, request.branch, limits, request.signal);
        args.push("-b", branchName);
      }
      args.push("--", request.path);
      if (request.base !== undefined) {
        args.push(validateCommitish(request.base, limits));
      }
      await gitRequireOk(runner, { args, cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes }, "git worktree add");
      return { worktrees: (await worktree({ action: "list", signal: request.signal })).worktrees, path: request.path };
    }

    // remove
    if (!request.path) throw new GitError("worktree path is required");
    const args = ["worktree", "remove"];
    if (request.force) args.push("--force");
    args.push("--", request.path);
    await gitRequireOk(runner, { args, cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes }, "git worktree remove");
    return { worktrees: (await worktree({ action: "list", signal: request.signal })).worktrees, path: request.path };
  }

  async function mergeTree(request: {
    into: string;
    from: string;
    signal?: AbortSignal;
  }): Promise<{ tree: string; conflicts: readonly string[] }> {
    const into = await validateBranchName(runner, cwd, request.into, limits, request.signal);
    const from = await validateBranchName(runner, cwd, request.from, limits, request.signal);
    const result = await runner.exec({
      args: ["merge-tree", "--write-tree", "--name-only", into, from],
      cwd,
      signal: request.signal,
      maxOutputBytes: limits.maxOutputBytes,
    });
    if (result.timedOut) throw new GitError("git merge-tree timed out", result.exitCode);
    if (result.aborted) throw new GitError("git merge-tree aborted", result.exitCode);
    // 0 = clean, 1 = conflicts (both report a tree); anything else is a usage/version failure the
    // caller maps to an unsupported-git error rather than a merge result.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const detail = gitText(result, "stderr").trim() || gitText(result).trim() || `exit ${result.exitCode}`;
      throw new GitError(`git merge-tree failed: ${detail}`, result.exitCode);
    }
    const lines = gitText(result).split("\n");
    const tree = (lines.shift() ?? "").trim();
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new GitError("git merge-tree did not report a tree");
    if (result.exitCode === 0) return { tree, conflicts: [] };
    // Conflicted paths come first, then a blank line, then informational messages.
    const conflicts: string[] = [];
    for (const line of lines) {
      if (line.trim() === "") break;
      conflicts.push(line.trim());
    }
    return { tree, conflicts };
  }

  async function commitTree(request: { tree: string; parents: readonly string[]; message: string; signal?: AbortSignal }): Promise<string> {
    if (!/^[0-9a-f]{40,64}$/.test(request.tree)) throw new GitError("commit-tree requires a tree oid");
    if (!Array.isArray(request.parents) || request.parents.length === 0) {
      throw new GitError("commit-tree requires at least one parent");
    }
    if (typeof request.message !== "string" || request.message.trim().length === 0) {
      throw new GitError("commit message is required");
    }
    if (byteLength(request.message) > limits.maxMessageBytes) {
      throw new GitError(`commit message exceeds ${limits.maxMessageBytes} byte limit`);
    }
    const args = ["commit-tree", request.tree];
    for (const parent of request.parents) {
      args.push("-p", await validateBranchName(runner, cwd, parent, limits, request.signal));
    }
    args.push("-m", request.message);
    const result = await gitRequireOk(runner, { args, cwd, signal: request.signal, maxOutputBytes: 64 * 1024 }, "git commit-tree");
    const sha = gitText(result).trim();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new GitError("git commit-tree did not report a commit");
    return sha;
  }

  async function stageAll(options?: { signal?: AbortSignal }): Promise<void> {
    await gitRequireOk(runner, { args: ["add", "-A"], cwd, signal: options?.signal, maxOutputBytes: limits.maxOutputBytes }, "git add -A");
  }

  async function writeTree(options?: { signal?: AbortSignal }): Promise<string> {
    const result = await gitRequireOk(
      runner,
      { args: ["write-tree"], cwd, signal: options?.signal, maxOutputBytes: 64 * 1024 },
      "git write-tree",
    );
    const tree = gitText(result).trim();
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new GitError("git write-tree did not report a tree");
    return tree;
  }

  async function readTree(request: { tree: string; signal?: AbortSignal }): Promise<void> {
    await gitRequireOk(
      runner,
      { args: ["read-tree", validateCommitish(request.tree, limits)], cwd, signal: request.signal, maxOutputBytes: 64 * 1024 },
      "git read-tree",
    );
  }

  async function updateRef(request: { ref: string; to: string; expected?: string; signal?: AbortSignal }): Promise<void> {
    const ref = await validateRef(runner, cwd, request.ref, limits, request.signal);
    const to = await validateBranchName(runner, cwd, request.to, limits, request.signal);
    const args = ["update-ref", ref, to];
    if (request.expected !== undefined) {
      args.push(await validateBranchName(runner, cwd, request.expected, limits, request.signal));
    }
    await gitRequireOk(runner, { args, cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes }, "git update-ref");
  }

  async function fastForward(request: { to: string; signal?: AbortSignal }): Promise<void> {
    const to = await validateBranchName(runner, cwd, request.to, limits, request.signal);
    await gitRequireOk(
      runner,
      { args: ["merge", "--ff-only", "--no-edit", to], cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes },
      "git merge --ff-only",
    );
  }

  async function untrackedFiles(options?: { signal?: AbortSignal }): Promise<readonly string[]> {
    const result = await gitRequireOk(
      runner,
      {
        args: ["ls-files", "--others", "--exclude-standard", "-z"],
        cwd,
        signal: options?.signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git ls-files --others",
    );
    const paths = gitText(result).split("\0").filter(Boolean);
    return paths.length > limits.maxChangedFiles ? paths.slice(0, limits.maxChangedFiles) : paths;
  }

  async function fingerprint(options?: { signal?: AbortSignal }): Promise<GitFingerprint> {
    const optional = async (args: readonly string[]): Promise<string | undefined> => {
      const result = await runner.exec({ args, cwd, signal: options?.signal, maxOutputBytes: 64 * 1024 });
      if (result.exitCode !== 0) return undefined;
      const text = gitText(result).trim();
      return text.length > 0 ? text : undefined;
    };
    const remoteUrl = await optional(["config", "--get", "remote.origin.url"]);
    const originHead = await optional(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
    const initDefault = await optional(["config", "--get", "init.defaultBranch"]);
    const defaultBranch = originHead ? originHead.replace(/^origin\//, "") : initDefault;
    const redacted = redactRemoteUrl(remoteUrl ?? "");
    const fingerprintSource = Buffer.from(`${redacted}\0${defaultBranch ?? ""}`, "utf8");
    return { remoteFingerprint: sha256Hex(fingerprintSource), defaultBranch };
  }

  async function apply(request: {
    patch: string;
    action: "check" | "apply" | "reverse";
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; checkpoint?: string; restored?: boolean; output: string }> {
    if (typeof request.patch !== "string") throw new GitError("patch must be a string");
    const patchBytes = byteLength(request.patch);
    if (patchBytes < 1) throw new GitError("patch must be non-empty");
    if (patchBytes > limits.maxPatchBytes) {
      throw new GitError(`patch exceeds ${limits.maxPatchBytes} byte limit`);
    }

    const runApply = async (args: string[], filePath: string): Promise<GitExecResult> =>
      runner.exec({
        args: [...args, "--", filePath],
        cwd,
        signal: request.signal,
        maxOutputBytes: limits.maxOutputBytes,
      });

    return await withTempFile("prism-git-patch-", request.patch, async (filePath) => {
      if (request.action === "check") {
        const result = await runApply(["apply", "--check"], filePath);
        const output = (gitText(result, "stderr") || gitText(result)).trim();
        if (result.exitCode !== 0) {
          return { ok: false, output: output || `exit ${result.exitCode}` };
        }
        return { ok: true, output: output || "patch applies cleanly" };
      }

      const checkpoint =
        request.action === "apply"
          ? await ensureCleanOrCheckpoint(request.createCheckpoint, request.signal, `git apply ${request.action}`)
          : undefined;

      // Always check first for apply/reverse.
      const checkArgs = request.action === "reverse" ? ["apply", "--reverse", "--check"] : ["apply", "--check"];
      const check = await runApply(checkArgs, filePath);
      if (check.exitCode !== 0) {
        const output = (gitText(check, "stderr") || gitText(check)).trim();
        if (checkpoint) await restoreCheckpoint(checkpoint, request.signal).catch(() => undefined);
        return { ok: false, checkpoint, restored: Boolean(checkpoint), output: output || "patch check failed" };
      }

      const applyArgs = request.action === "reverse" ? ["apply", "--reverse"] : ["apply"];
      const result = await runApply(applyArgs, filePath);
      if (result.exitCode !== 0) {
        const output = (gitText(result, "stderr") || gitText(result)).trim();
        let restored = false;
        if (checkpoint) {
          restored = await restoreCheckpoint(checkpoint, request.signal).catch(() => false);
        } else {
          // Best-effort restore of tracked files when no checkpoint was taken (clean tree).
          await runner
            .exec({
              args: ["checkout", "--", "."],
              cwd,
              signal: request.signal,
              maxOutputBytes: limits.maxOutputBytes,
            })
            .catch(() => undefined);
          restored = true;
        }
        return { ok: false, checkpoint, restored, output: output || `apply failed with exit ${result.exitCode}` };
      }
      return {
        ok: true,
        checkpoint,
        output: (gitText(result, "stderr") || gitText(result) || "patch applied").trim(),
      };
    });
  }

  async function commit(request: {
    paths: readonly string[];
    message: string;
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ sha: string; checkpoint?: string }> {
    const paths = validatePaths(request.paths, limits);
    if (typeof request.message !== "string" || request.message.trim().length === 0) {
      throw new GitError("commit message is required");
    }
    if (byteLength(request.message) > limits.maxMessageBytes) {
      throw new GitError(`commit message exceeds ${limits.maxMessageBytes} byte limit`);
    }

    const identity = options.commitIdentity;
    if (!identity?.name?.trim() || !identity?.email?.trim()) {
      throw new GitError("commitIdentity name and email are required for git commit");
    }
    if (identity.name.includes("\n") || identity.email.includes("\n")) {
      throw new GitError("commitIdentity must not contain newlines");
    }

    const checkpoint = await ensureCleanOrCheckpoint(request.createCheckpoint, request.signal, "git commit", new Set(paths));

    try {
      await gitRequireOk(
        runner,
        {
          args: ["add", "--", ...paths],
          cwd,
          signal: request.signal,
          maxOutputBytes: limits.maxOutputBytes,
        },
        "git add",
      );

      await withTempFile("prism-git-msg-", request.message, async (messageFile) => {
        await gitRequireOk(
          runner,
          {
            args: [
              "-c",
              `user.name=${identity.name}`,
              "-c",
              `user.email=${identity.email}`,
              "commit",
              "--no-verify",
              "-F",
              messageFile,
              "--",
              ...paths,
            ],
            cwd,
            signal: request.signal,
            maxOutputBytes: limits.maxOutputBytes,
          },
          "git commit",
        );
      });

      const shaResult = await gitRequireOk(
        runner,
        { args: ["rev-parse", "HEAD"], cwd, signal: request.signal, maxOutputBytes: 64 * 1024 },
        "git rev-parse HEAD",
      );
      return { sha: gitText(shaResult).trim(), checkpoint };
    } catch (error) {
      // Reset index for the attempted paths; never drop pre-existing dirty work unless checkpointed.
      await runner
        .exec({
          args: ["reset", "-q", "HEAD", "--", ...paths],
          cwd,
          signal: request.signal,
          maxOutputBytes: limits.maxOutputBytes,
        })
        .catch(() => undefined);
      if (checkpoint) await restoreCheckpoint(checkpoint, request.signal).catch(() => undefined);
      throw error;
    }
  }

  async function prHandoff(request: {
    base: string;
    head?: string;
    checks?: readonly { name: string; exitCode: number; summary: string }[];
    includeBundle?: boolean;
    signal?: AbortSignal;
  }): Promise<PrHandoff> {
    const base = request.base;
    if (!base || byteLength(base) > limits.maxRefBytes) {
      throw new GitError("base ref is required and must be within ref byte limits");
    }
    const headResult = await gitRequireOk(
      runner,
      {
        args: ["rev-parse", "--verify", request.head ?? "HEAD"],
        cwd,
        signal: request.signal,
        maxOutputBytes: 64 * 1024,
      },
      "git rev-parse head",
    );
    const head = gitText(headResult).trim();

    const baseShaResult = await gitRequireOk(
      runner,
      { args: ["rev-parse", "--verify", base], cwd, signal: request.signal, maxOutputBytes: 64 * 1024 },
      "git rev-parse base",
    );
    const baseSha = gitText(baseShaResult).trim();

    const log = await gitRequireOk(
      runner,
      {
        args: ["log", "--format=%H%x09%s", `${baseSha}..${head}`],
        cwd,
        signal: request.signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git log",
    );
    const commits = gitText(log)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limits.maxPrCommits)
      .map((line) => {
        const tab = line.indexOf("\t");
        if (tab < 0) return { sha: line, subject: "" };
        return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
      });

    const nameStatus = await gitRequireOk(
      runner,
      {
        args: ["diff", "--no-ext-diff", "--no-textconv", "--name-only", `${baseSha}...${head}`],
        cwd,
        signal: request.signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git diff name-only",
    );
    const changedPaths = gitText(nameStatus)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limits.maxChangedFiles)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const stat = await gitRequireOk(
      runner,
      {
        args: ["diff", "--no-ext-diff", "--no-textconv", "--stat", `${baseSha}...${head}`],
        cwd,
        signal: request.signal,
        maxOutputBytes: limits.maxOutputBytes,
      },
      "git diff --stat",
    );
    const diffstat = truncateLines(gitText(stat), 200).text.trim();

    let artifact: ArtifactReference | undefined;
    if (artifacts) {
      if (request.includeBundle) {
        const bundleDir = await mkdtemp(join(tmpdir(), "prism-git-bundle-"));
        const bundlePath = join(bundleDir, "handoff.bundle");
        try {
          await gitRequireOk(
            runner,
            {
              args: ["bundle", "create", bundlePath, `${baseSha}..${head}`],
              cwd,
              signal: request.signal,
              maxOutputBytes: limits.maxOutputBytes,
            },
            "git bundle create",
          );
          const { readFile } = await import("node:fs/promises");
          const bytes = await readFile(bundlePath);
          artifact = await artifacts({ kind: "bundle", filename: "handoff.bundle", bytes });
        } finally {
          await rm(bundleDir, { recursive: true, force: true });
        }
      } else {
        const patch = await gitRequireOk(
          runner,
          {
            args: ["diff", "--no-ext-diff", "--no-textconv", "--binary", `${baseSha}...${head}`],
            cwd,
            signal: request.signal,
            maxOutputBytes: limits.maxOutputBytes,
          },
          "git diff patch",
        );
        artifact = await artifacts({
          kind: "patch",
          filename: "handoff.patch",
          bytes: patch.stdout,
        });
      }
    }

    const handoff: PrHandoff = {
      base: baseSha,
      head,
      commits,
      changedPaths,
      diffstat,
      checks: [...(request.checks ?? [])],
      artifact,
    };

    const encoded = Buffer.from(JSON.stringify(handoff), "utf8");
    if (encoded.length > limits.maxPrHandoffBytes) {
      throw new GitError(`PR handoff JSON exceeds ${limits.maxPrHandoffBytes} byte limit`);
    }
    return handoff;
  }

  return {
    status,
    diff,
    branch,
    worktree,
    mergeTree,
    commitTree,
    updateRef,
    fastForward,
    stageAll,
    writeTree,
    readTree,
    untrackedFiles,
    fingerprint,
    apply,
    commit,
    prHandoff,
  };
}

/** Strip credentials from a remote URL, keeping scheme and host/path (plan 026 Task 3). */
export function redactRemoteUrl(url: string): string {
  if (typeof url !== "string" || url.length === 0) return "";
  let rest = url;
  let scheme = "";
  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/)/i.exec(url);
  if (schemeMatch) {
    scheme = schemeMatch[1];
    rest = url.slice(scheme.length);
  }
  const at = rest.lastIndexOf("@");
  const slash = rest.indexOf("/");
  if (at >= 0 && (slash < 0 || at < slash)) rest = rest.slice(at + 1);
  return scheme + rest;
}

export type { BoundGitRunner, CreateGitRunnerOptions, GitExecRequest, GitExecResult, GitRunner } from "./git-exec.js";
export {
  createBoundGitRunner,
  GitError,
  runGitCli,
  SAFE_GIT_CONFIG_ARGS,
  SAFE_GIT_ENV,
} from "./git-exec.js";
export type { GitStatusBranch, GitStatusEntry, GitStatusEntryKind, GitStatusResult } from "./git-status.js";
export { parsePorcelainV2 } from "./git-status.js";
