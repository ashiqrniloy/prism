/**
 * Structured Git operations over a typed runner.
 *
 * All invocations use file+argument arrays with `--` pathspec separation,
 * `git check-ref-format` for refs, and safe config that disables hooks,
 * external diff/textconv, pagers, and credential prompts by default.
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  createBoundGitRunner,
  GitError,
  gitRequireOk,
  gitText,
  type BoundGitRunner,
  type CreateGitRunnerOptions,
  type GitExecResult,
} from "./git-exec.js";
import { parsePorcelainV2, type GitStatusResult } from "./git-status.js";
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
    maxRefBytes: validateCodingLimit(
      "maxRefBytes",
      options?.maxRefBytes ?? DEFAULT_MAX_GIT_REF_BYTES,
      HARD_MAX_GIT_REF_BYTES,
    ),
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
    maxDiffLines: validateCodingLimit(
      "maxDiffLines",
      options?.maxDiffLines ?? DEFAULT_MAX_GIT_DIFF_LINES,
      HARD_MAX_GIT_DIFF_LINES,
    ),
    maxChangedFiles: validateCodingLimit(
      "maxChangedFiles",
      options?.maxChangedFiles ?? DEFAULT_MAX_GIT_CHANGED_FILES,
      HARD_MAX_GIT_CHANGED_FILES,
    ),
    maxPatchBytes: validateCodingLimit(
      "maxPatchBytes",
      options?.maxPatchBytes ?? DEFAULT_MAX_GIT_PATCH_BYTES,
      HARD_MAX_GIT_PATCH_BYTES,
    ),
    maxWorktrees: validateCodingLimit(
      "maxWorktrees",
      options?.maxWorktrees ?? DEFAULT_MAX_GIT_WORKTREES,
      HARD_MAX_GIT_WORKTREES,
    ),
    maxPrCommits: validateCodingLimit(
      "maxPrCommits",
      options?.maxPrCommits ?? DEFAULT_MAX_PR_COMMITS,
      HARD_MAX_PR_COMMITS,
    ),
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

export interface GitOperations {
  status(options?: { includeIgnored?: boolean; signal?: AbortSignal }): Promise<GitStatusResult>;
  diff(options?: {
    staged?: boolean;
    paths?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ text: string; truncated: boolean; lineCount: number; artifact?: ArtifactReference }>;
  branch(options: {
    action: "validate" | "create" | "switch" | "list";
    name?: string;
    createCheckpoint?: boolean;
    signal?: AbortSignal;
  }): Promise<{ refs?: string[]; name?: string; checkpoint?: string }>;
  worktree(options: {
    action: "list" | "add" | "remove";
    path?: string;
    branch?: string;
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<{ worktrees: readonly { path: string; head?: string; branch?: string }[]; path?: string }>;
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
  const kept = lines.slice(0, maxLines).join("\n") + "\n";
  return { text: kept, truncated: true, lineCount };
}

async function withTempFile<T>(
  prefix: string,
  contents: string | Buffer,
  fn: (path: string) => Promise<T>,
): Promise<T> {
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
    const result = await gitRequireOk(runner, {
      args,
      cwd,
      signal: request?.signal,
      maxOutputBytes: limits.maxOutputBytes,
    }, "git status");
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
    paths?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ text: string; truncated: boolean; lineCount: number; artifact?: ArtifactReference }> {
    const built = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if (request?.staged) built.push("--cached");
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
    action: "validate" | "create" | "switch" | "list";
    name?: string;
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
    action: "list" | "add" | "remove";
    path?: string;
    branch?: string;
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<{ worktrees: readonly { path: string; head?: string; branch?: string }[]; path?: string }> {
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
      const worktrees: Array<{ path: string; head?: string; branch?: string }> = [];
      let current: { path: string; head?: string; branch?: string } | undefined;
      for (const record of records) {
        if (record.startsWith("worktree ")) {
          if (current) worktrees.push(current);
          current = { path: record.slice("worktree ".length) };
        } else if (current && record.startsWith("HEAD ")) {
          current.head = record.slice("HEAD ".length);
        } else if (current && record.startsWith("branch ")) {
          current.branch = record.slice("branch ".length);
        }
      }
      if (current) worktrees.push(current);
      if (worktrees.length > limits.maxWorktrees) {
        return { worktrees: worktrees.slice(0, limits.maxWorktrees) };
      }
      return { worktrees };
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
      await gitRequireOk(
        runner,
        { args, cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes },
        "git worktree add",
      );
      return { worktrees: (await worktree({ action: "list", signal: request.signal })).worktrees, path: request.path };
    }

    // remove
    if (!request.path) throw new GitError("worktree path is required");
    const args = ["worktree", "remove"];
    if (request.force) args.push("--force");
    args.push("--", request.path);
    await gitRequireOk(
      runner,
      { args, cwd, signal: request.signal, maxOutputBytes: limits.maxOutputBytes },
      "git worktree remove",
    );
    return { worktrees: (await worktree({ action: "list", signal: request.signal })).worktrees, path: request.path };
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
          ? await ensureCleanOrCheckpoint(
              request.createCheckpoint,
              request.signal,
              `git apply ${request.action}`,
            )
          : undefined;

      // Always check first for apply/reverse.
      const checkArgs =
        request.action === "reverse"
          ? ["apply", "--reverse", "--check"]
          : ["apply", "--check"];
      const check = await runApply(checkArgs, filePath);
      if (check.exitCode !== 0) {
        const output = (gitText(check, "stderr") || gitText(check)).trim();
        if (checkpoint) await restoreCheckpoint(checkpoint, request.signal).catch(() => undefined);
        return { ok: false, checkpoint, restored: Boolean(checkpoint), output: output || "patch check failed" };
      }

      const applyArgs =
        request.action === "reverse"
          ? ["apply", "--reverse"]
          : ["apply"];
      const result = await runApply(applyArgs, filePath);
      if (result.exitCode !== 0) {
        const output = (gitText(result, "stderr") || gitText(result)).trim();
        let restored = false;
        if (checkpoint) {
          restored = await restoreCheckpoint(checkpoint, request.signal).catch(() => false);
        } else {
          // Best-effort restore of tracked files when no checkpoint was taken (clean tree).
          await runner.exec({
            args: ["checkout", "--", "."],
            cwd,
            signal: request.signal,
            maxOutputBytes: limits.maxOutputBytes,
          }).catch(() => undefined);
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

    const checkpoint = await ensureCleanOrCheckpoint(
      request.createCheckpoint,
      request.signal,
      "git commit",
      new Set(paths),
    );

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
      await runner.exec({
        args: ["reset", "-q", "HEAD", "--", ...paths],
        cwd,
        signal: request.signal,
        maxOutputBytes: limits.maxOutputBytes,
      }).catch(() => undefined);
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

  return { status, diff, branch, worktree, apply, commit, prHandoff };
}

export { parsePorcelainV2 } from "./git-status.js";
export type { GitStatusResult, GitStatusEntry, GitStatusBranch, GitStatusEntryKind } from "./git-status.js";
export {
  GitError,
  SAFE_GIT_ENV,
  SAFE_GIT_CONFIG_ARGS,
  createBoundGitRunner,
  runGitCli,
} from "./git-exec.js";
export type { GitRunner, GitExecRequest, GitExecResult, BoundGitRunner, CreateGitRunnerOptions } from "./git-exec.js";
