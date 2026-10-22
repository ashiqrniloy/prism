/**
 * The `workspace` service: disposable git worktrees for delegated coding work.
 *
 * It is the in-process replacement for the retired 0.12 workspace lifecycle (plan 026 Task 3). Durable records, leases, checkpoints, and multi-repository identity are gone: Phase 16
 * moves those into `@arnilo/prism-workflows`. What remains is one bounded, host-owned service over
 * the existing `GitOperations` runner, with the exclude writer shared with the driver kit.
 *
 * Git is spawned only on service calls: package setup costs one `git rev-parse` probe, the runner
 * and the repository's commit identity are resolved on the first call, and a worktree's own
 * `GitOperations` instance is created on its first use and dropped on dispose.
 *
 * ```ts
 * const workspace = prism.services.consume<WorkspaceService>("workspace");
 * const wt = await workspace.worktree.create({ sessionId: child.id });
 * const overlay = await workspace.excludeOverlay(wt.path, [{ path: ".agents/hooks.json", content: "{}" }]);
 * const { changes } = await workspace.diff(wt.path);
 * const merged = await workspace.merge(wt.path, { into: "main", commit: { message: "delegated change" } });
 * await overlay.dispose();
 * await wt.dispose({ force: true });
 * ```
 */
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { type ExcludeBlock, writeExcludeBlock } from "@arnilo/prism/driver-kit";

import { type CreateGitOperationsOptions, createGitOperations, type GitOperations, type GitWorktreeEntry } from "../agent/git.js";
import { createBoundGitRunner, type GitRunner, gitText } from "../agent/git-exec.js";
import { type CodingLifecycleEvent, createCodingLifecycleEmitter } from "../agent/lifecycle.js";
import {
  DEFAULT_MAX_GIT_WORKTREES,
  DEFAULT_MAX_WORKSPACE_DIFF_BYTES,
  DEFAULT_MAX_WORKSPACE_DIFF_FILES,
  HARD_MAX_GIT_WORKTREES,
  HARD_MAX_WORKSPACE_DIFF_BYTES,
  HARD_MAX_WORKSPACE_DIFF_FILES,
  validateCodingLimit,
} from "../agent/limits.js";
import { type FileChange, type WorkspaceDiffBounds, workspaceDiff } from "./diff.js";
import { WorkspaceServiceError } from "./errors.js";
import { mergeWorktree, type WorkspaceMergeRequest, type WorkspaceMergeResult } from "./merge.js";

/** One overlay file to write into a worktree, relative to the worktree root. */
export interface WorkspaceOverlayFile {
  readonly path: string;
  readonly content: string;
}

export interface WorkspaceOverlay {
  /** Removes the overlay files and their exclude block. Idempotent. */
  dispose(): Promise<void>;
}

export interface WorkspaceWorktreeCreate {
  /** New branch name; default `prism/<short id>`. */
  readonly branch?: string;
  /** Commit-ish the branch starts at; default `HEAD`. */
  readonly base?: string;
  /**
   * Binds this worktree to a session for tool routing (plan 165 Task 7). A sandboxed service
   * refuses the binding: the routed tools would leave the sandbox root.
   */
  readonly sessionId?: string;
}

export interface WorkspaceWorktreeRebind {
  /** The recorded worktree path. Must be inside the worktree root. */
  readonly path: string;
  /** The session to bind it to. */
  readonly sessionId: string;
  /** The recorded branch; when given, it must match the worktree's checked-out branch. */
  readonly branch?: string;
  /** The recorded base commit; default is the merge base of the branch and the main tree's `HEAD`. */
  readonly base?: string;
}

export interface WorkspaceWorktree {
  /** Absolute worktree path. */
  readonly path: string;
  readonly branch: string;
  /** The commit the branch started at. */
  readonly base: string;
  readonly sessionId?: string;
  /**
   * Removes this worktree's overlays and exclude blocks, unlocks and removes the worktree, drops
   * the session binding, and deletes the branch when git considers it fully merged. Refuses a
   * dirty worktree unless `force`. Idempotent.
   */
  dispose(options?: { force?: boolean }): Promise<void>;
}

export interface WorkspaceService {
  readonly worktree: {
    create(request?: WorkspaceWorktreeCreate): Promise<WorkspaceWorktree>;
    /** The active worktree bound to `sessionId`, when there is one. */
    bound(sessionId: string): WorkspaceWorktree | undefined;
    /**
     * Re-adopts a worktree this service (in any earlier process) created and left behind, binding it to
     * `sessionId`. It fails closed with `workspace_unknown` unless the path is inside the worktree root,
     * registered with git, locked with this service's marker, and (when given) on the recorded branch.
     * Idempotent for the same session. Never creates a worktree.
     */
    rebind(request: WorkspaceWorktreeRebind): Promise<WorkspaceWorktree>;
  };
  /** Bounded changes against the worktree's base, plus untracked files. Overlay files never appear. */
  diff(path: string, bounds?: Partial<WorkspaceDiffBounds>): Promise<{ changes: readonly FileChange[]; truncated: boolean }>;
  /** Merges the worktree's branch into `into`, reporting conflicts instead of resolving them. */
  merge(path: string, request: WorkspaceMergeRequest): Promise<WorkspaceMergeResult>;
  /** Writes overlay files into the worktree and excludes them through one marked exclude block. */
  excludeOverlay(path: string, files: readonly WorkspaceOverlayFile[]): Promise<WorkspaceOverlay>;
}

export interface WorkspaceServiceOptions {
  /** The package root. Must be inside a git repository. */
  readonly root: string;
  /** Where worktrees are created. Default: a per-repository directory under the OS temp dir. */
  readonly worktreeRoot?: string;
  /** Maximum active worktrees this service creates. Default 4, hard cap 16. */
  readonly maxWorktrees?: number;
  /** `diff` bounds. Defaults 200 files and 1 MiB per file. */
  readonly diff?: Partial<WorkspaceDiffBounds>;
  /** Git executable path; default `/usr/bin/git`. */
  readonly gitPath?: string;
  /**
   * `true` when the package's tools run through a sandbox, so `create({ sessionId })` fails with
   * `workspace_sandbox_unsupported`: a routed worktree path is outside the sandbox root. `create`
   * without `sessionId` still works, for a human to inspect.
   */
  readonly sandboxed?: boolean;
  /**
   * Lifecycle sink. Emits `worktree_changed` (`action: "add"` on `worktree.create`, `"remove"` on
   * `dispose`) through the frozen coding-lifecycle emitter, so a host that maps coding events (the
   * ACP lifecycle mapper) sees worktree movement again after plan 189 removed the `git_worktree` tool.
   */
  readonly onEvent?: (event: CodingLifecycleEvent) => void;
  /** Test seam: a custom git runner. */
  readonly runner?: GitRunner;
  /** Sandbox-style execFile adapter. */
  readonly execFile?: CreateGitOperationsOptions["execFile"];
}

const LOCK_REASON_PREFIX = "prism-workspace:";

interface OverlayRecord {
  readonly written: readonly string[];
  readonly block: ExcludeBlock;
}

interface WorktreeRecord {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
  readonly base: string;
  readonly sessionId?: string;
  readonly overlays: OverlayRecord[];
  disposed: boolean;
}

export async function createWorkspaceService(options: WorkspaceServiceOptions): Promise<WorkspaceService> {
  const root = resolve(options.root);
  const runner = await createBoundGitRunner({
    gitPath: options.gitPath,
    runner: options.runner,
    execFile: options.execFile,
  });
  // The one setup probe: is `root` inside a git repository?
  const probe = await runner.exec({ args: ["rev-parse", "--git-dir"], cwd: root, maxOutputBytes: 64 * 1024 });
  if (probe.exitCode !== 0) {
    throw new WorkspaceServiceError("workspace_not_git", `not inside a git repository: ${root}`);
  }

  const worktreeRoot = resolve(options.worktreeRoot ?? defaultWorktreeRoot(root));
  const maxWorktrees = validateCodingLimit(
    "workspace.maxWorktrees",
    options.maxWorktrees ?? DEFAULT_MAX_GIT_WORKTREES,
    HARD_MAX_GIT_WORKTREES,
  );
  const diffBounds: WorkspaceDiffBounds = {
    maxFiles: validateCodingLimit(
      "workspace.diff.maxFiles",
      options.diff?.maxFiles ?? DEFAULT_MAX_WORKSPACE_DIFF_FILES,
      HARD_MAX_WORKSPACE_DIFF_FILES,
    ),
    maxBytes: validateCodingLimit(
      "workspace.diff.maxBytes",
      options.diff?.maxBytes ?? DEFAULT_MAX_WORKSPACE_DIFF_BYTES,
      HARD_MAX_WORKSPACE_DIFF_BYTES,
    ),
  };

  const emitter = createCodingLifecycleEmitter(options.onEvent === undefined ? {} : { onEvent: options.onEvent });
  const records = new Map<string, WorktreeRecord>();
  const ops = new Map<string, Promise<GitOperations>>();
  let identityPromise: Promise<{ name: string; email: string } | undefined> | undefined;
  let mainPath: string | undefined;

  /** The repository's configured commit identity; never invented. */
  async function configuredIdentity(): Promise<{ name: string; email: string } | undefined> {
    identityPromise ??= (async () => {
      const read = async (key: string): Promise<string | undefined> => {
        const result = await runner.exec({ args: ["config", "--get", key], cwd: root, maxOutputBytes: 64 * 1024 });
        if (result.exitCode !== 0) return undefined;
        const value = gitText(result).trim();
        return value.length > 0 && !value.includes("\n") ? value : undefined;
      };
      const name = await read("user.name");
      const email = await read("user.email");
      return name !== undefined && email !== undefined ? { name, email } : undefined;
    })();
    return await identityPromise;
  }

  function gitFor(path: string): Promise<GitOperations> {
    const key = resolve(path);
    let cached = ops.get(key);
    if (!cached) {
      cached = (async () =>
        await createGitOperations({
          cwd: key,
          gitPath: options.gitPath,
          runner: options.runner,
          execFile: options.execFile,
          commitIdentity: await configuredIdentity(),
          // The main tree is listed too, so the git layer's count must admit the service's own cap on top of it.
          maxWorktrees: Math.min(maxWorktrees + 1, HARD_MAX_GIT_WORKTREES),
        }))();
      ops.set(key, cached);
    }
    return cached;
  }

  /** The main worktree path, read once and only when a lookup misses. */
  async function mainWorktree(): Promise<string> {
    if (mainPath === undefined) {
      const listed = await (await gitFor(root)).worktree({ action: "list" });
      mainPath = await canonicalize(resolve(listed.worktrees[0]?.path ?? root));
    }
    return mainPath;
  }

  async function assertWorktree(path: string): Promise<WorktreeRecord> {
    const resolved = await canonicalize(resolve(path));
    const record = records.get(resolved);
    if (record) return record;
    const main = await mainWorktree();
    if (resolved === main || isInside(main, resolved)) {
      throw new WorkspaceServiceError("workspace_main_immutable", "the main worktree is never removed, locked, or reset");
    }
    throw new WorkspaceServiceError("workspace_unknown", `not a worktree this service created: ${path}`);
  }

  /** Canonicalize `candidate` without creating anything, resolving every existing ancestor. */
  async function canonicalize(candidate: string): Promise<string> {
    const missing: string[] = [];
    let existing = resolve(candidate);
    for (;;) {
      const real = await realpath(existing).catch(() => undefined);
      if (real !== undefined) return missing.length === 0 ? real : join(real, ...missing);
      const parent = dirname(existing);
      if (parent === existing) return resolve(candidate);
      missing.unshift(basename(existing));
      existing = parent;
    }
  }

  /** Canonicalize `candidate` and refuse anything outside `worktreeRoot`. */
  async function contained(candidate: string): Promise<string> {
    await mkdir(worktreeRoot, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(worktreeRoot);
    const resolved = await canonicalize(candidate);
    if (!isInside(canonicalRoot, resolved)) {
      throw new WorkspaceServiceError("workspace_path_escape", `path escapes the worktree root: ${candidate}`);
    }
    return resolved;
  }

  function handle(record: WorktreeRecord): WorkspaceWorktree {
    return {
      path: record.path,
      branch: record.branch,
      base: record.base,
      ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
      dispose: async (disposeOptions) => await disposeWorktree(record, disposeOptions?.force === true),
    };
  }

  async function create(request: WorkspaceWorktreeCreate = {}): Promise<WorkspaceWorktree> {
    if (request.sessionId !== undefined && options.sandboxed === true) {
      throw new WorkspaceServiceError(
        "workspace_sandbox_unsupported",
        "a sandboxed run cannot bind a worktree to a session: routed tool paths would leave the sandbox root",
      );
    }
    if (records.size >= maxWorktrees) {
      throw new WorkspaceServiceError("workspace_limit", `at most ${maxWorktrees} worktrees may be active at once`);
    }
    const id = `ws-${randomUUID().slice(0, 8)}`;
    const path = await contained(join(worktreeRoot, id));
    const branch = request.branch ?? `prism/${id}`;
    const base = request.base ?? "HEAD";

    const repo = await gitFor(root);
    await repo.worktree({ action: "add", path, branch, base });
    const listed = await repo.worktree({ action: "list" });
    const entry: GitWorktreeEntry | undefined = listed.worktrees.find((worktree) => resolve(worktree.path) === path);
    if (entry?.head === undefined) {
      throw new WorkspaceServiceError("workspace_unknown", `the new worktree ${path} is not registered with git`);
    }
    await repo.worktree({ action: "lock", path, reason: `${LOCK_REASON_PREFIX}${id}` });

    const record: WorktreeRecord = {
      id,
      path,
      branch,
      base: entry.head,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      overlays: [],
      disposed: false,
    };
    records.set(path, record);
    emitter.emit({ type: "worktree_changed", action: "add", path: record.path });
    return handle(record);
  }

  async function rebind(request: WorkspaceWorktreeRebind): Promise<WorkspaceWorktree> {
    if (options.sandboxed === true) {
      throw new WorkspaceServiceError(
        "workspace_sandbox_unsupported",
        "a sandboxed run cannot bind a worktree to a session: routed tool paths would leave the sandbox root",
      );
    }
    const path = await contained(request.path);
    const held = records.get(path);
    if (held) {
      if (held.sessionId === request.sessionId && !held.disposed) return handle(held);
      throw new WorkspaceServiceError("workspace_unknown", `worktree ${path} is already held for another session`);
    }
    const repo = await gitFor(root);
    const listed = await repo.worktree({ action: "list" });
    const entry = listed.worktrees.find((worktree) => resolve(worktree.path) === path);
    const lockReason = entry?.lockReason ?? "";
    if (entry === undefined || !entry.locked || !lockReason.startsWith(LOCK_REASON_PREFIX)) {
      throw new WorkspaceServiceError("workspace_unknown", `${request.path} is not a worktree this service created`);
    }
    const branch = entry.branch?.replace(/^refs\/heads\//, "");
    if (branch === undefined || (request.branch !== undefined && request.branch !== branch)) {
      throw new WorkspaceServiceError("workspace_unknown", `worktree ${path} is not on the recorded branch`);
    }
    if (records.size >= maxWorktrees) {
      throw new WorkspaceServiceError("workspace_limit", `at most ${maxWorktrees} worktrees may be active at once`);
    }
    let base = request.base;
    if (base === undefined) {
      const merged = await runner.exec({ args: ["merge-base", "HEAD", branch], cwd: root, maxOutputBytes: 64 * 1024 });
      base = merged.exitCode === 0 ? gitText(merged).trim() : entry.head;
    }
    if (base === undefined) {
      throw new WorkspaceServiceError("workspace_unknown", `cannot determine the base commit of ${path}`);
    }
    const record: WorktreeRecord = {
      id: lockReason.slice(LOCK_REASON_PREFIX.length),
      path,
      branch,
      base,
      sessionId: request.sessionId,
      overlays: [],
      disposed: false,
    };
    records.set(path, record);
    return handle(record);
  }

  function bound(sessionId: string): WorkspaceWorktree | undefined {
    for (const record of records.values()) {
      if (record.sessionId === sessionId && !record.disposed) return handle(record);
    }
    return undefined;
  }

  async function disposeWorktree(record: WorktreeRecord, force: boolean): Promise<void> {
    if (record.disposed) return;
    const repo = await gitFor(root);

    for (const overlay of [...record.overlays]) await removeOverlay(overlay);
    record.overlays.length = 0;

    if (!force) {
      const status = await (await gitFor(record.path)).status();
      const dirty = status.entries.filter((entry) => entry.kind !== "ignored");
      if (dirty.length > 0) {
        throw new WorkspaceServiceError(
          "workspace_dirty",
          `the worktree has ${dirty.length} uncommitted change(s); pass force to remove it`,
        );
      }
    }

    const listed = await repo.worktree({ action: "list" });
    const entry = listed.worktrees.find((worktree) => resolve(worktree.path) === record.path);
    if (entry === undefined) {
      if (await exists(record.path)) {
        throw new WorkspaceServiceError("workspace_unknown", `${record.path} is not a registered git worktree`);
      }
    } else {
      if (entry.locked) await repo.worktree({ action: "unlock", path: record.path });
      await repo.worktree({ action: "remove", path: record.path, force });
    }

    record.disposed = true;
    records.delete(record.path);
    ops.delete(record.path);
    // Delete the branch only when git considers it fully merged; otherwise keep it.
    await repo.branch({ action: "delete", name: record.branch }).catch(() => undefined);
    emitter.emit({ type: "worktree_changed", action: "remove", path: record.path });
  }

  async function removeOverlay(overlay: OverlayRecord): Promise<void> {
    for (const path of overlay.written) await rm(path, { force: true });
    await overlay.block.dispose();
  }

  async function excludeOverlay(path: string, files: readonly WorkspaceOverlayFile[]): Promise<WorkspaceOverlay> {
    const record = await assertWorktree(path);
    if (files.length === 0) return { dispose: async () => undefined };

    const written: string[] = [];
    const lines: string[] = [];
    for (const file of files) {
      const relativePath = overlayRelativePath(file.path);
      const target = await contained(join(record.path, relativePath));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.content, { encoding: "utf8", mode: 0o644 });
      written.push(target);
      lines.push(`/${relativePath}`);
    }
    const block = await writeExcludeBlock(record.path, `${record.id}-ov${record.overlays.length + 1}`, lines);
    const overlay: OverlayRecord = { written, block };
    const serviceOverlay: WorkspaceOverlay = {
      dispose: async () => {
        if (!record.overlays.includes(overlay)) return;
        await removeOverlay(overlay);
        record.overlays.splice(record.overlays.indexOf(overlay), 1);
      },
    };
    record.overlays.push(overlay);
    return serviceOverlay;
  }

  async function diff(
    path: string,
    bounds?: Partial<WorkspaceDiffBounds>,
  ): Promise<{ changes: readonly FileChange[]; truncated: boolean }> {
    const record = await assertWorktree(path);
    return await workspaceDiff(await gitFor(record.path), record.path, record.base, {
      maxFiles: bounds?.maxFiles ?? diffBounds.maxFiles,
      maxBytes: bounds?.maxBytes ?? diffBounds.maxBytes,
    });
  }

  async function merge(path: string, request: WorkspaceMergeRequest): Promise<WorkspaceMergeResult> {
    const record = await assertWorktree(path);
    const listed = await (await gitFor(root)).worktree({ action: "list" });
    return await mergeWorktree(
      {
        worktree: record.path,
        branch: record.branch,
        gitFor,
        worktrees: listed.worktrees,
        identity: await configuredIdentity(),
      },
      request,
    );
  }

  return { worktree: { create, bound, rebind }, diff, merge, excludeOverlay };
}

function defaultWorktreeRoot(root: string): string {
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return join(tmpdir(), "prism-worktrees", `${basename(root)}-${digest}`);
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function overlayRelativePath(path: string): string {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || isAbsolute(path)) {
    throw new WorkspaceServiceError("workspace_path_escape", `overlay path must be relative to the worktree: ${String(path)}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new WorkspaceServiceError("workspace_path_escape", `overlay path must not traverse: ${path}`);
  }
  return parts.join("/");
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}
