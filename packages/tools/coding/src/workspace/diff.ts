/**
 * Bounded worktree diff: tracked changes against the worktree's base, plus untracked files.
 *
 * `FileActivity` is the driver kit's file-activity type, so a workspace diff and a vendor diff
 * normalize to the same shape. Overlay files never appear: they are listed in the common
 * `.git/info/exclude`, so `ls-files --others --exclude-standard` skips them.
 */
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { type FileActivity, mapDiff } from "@arnilo/prism/driver-kit";

import type { GitOperations } from "../agent/git.js";

/** One changed file, in the driver kit's file-activity shape. */
export type FileChange = FileActivity;

export interface WorkspaceDiffBounds {
  /** Maximum files listed. Default 200. */
  readonly maxFiles: number;
  /** Maximum bytes of one file's `diff` text. A larger file is listed with no `diff`. Default 1 MiB. */
  readonly maxBytes: number;
}

export interface WorkspaceDiff {
  readonly changes: readonly FileChange[];
  /** True when a file's `diff` was withheld (over `maxBytes`) or the list was cut at `maxFiles`. */
  readonly truncated: boolean;
}

/**
 * `git diff <base>` for tracked files (committed and uncommitted), then one `created` entry per
 * untracked, non-ignored file. Paths are worktree-relative. A file whose diff exceeds `maxBytes`
 * is listed without `diff` and marks the result truncated.
 */
export async function workspaceDiff(
  git: GitOperations,
  worktree: string,
  base: string,
  bounds: WorkspaceDiffBounds,
  signal?: AbortSignal,
): Promise<WorkspaceDiff> {
  const tracked = await git.diff({ base, signal });
  const untracked = await git.untrackedFiles({ signal });

  let truncated = tracked.truncated;
  const changes: FileChange[] = [];
  for (const change of mapDiff(tracked.text)) {
    if (Buffer.byteLength(change.diff ?? "", "utf8") > bounds.maxBytes) {
      truncated = true;
      const { diff: _dropped, ...rest } = change;
      changes.push(rest);
    } else {
      changes.push(change);
    }
  }

  const listed = new Set(changes.map((change) => change.path));
  for (const path of untracked) {
    if (listed.has(path)) continue;
    const size = await fileSize(join(worktree, path));
    if (size !== undefined && size > bounds.maxBytes) truncated = true;
    changes.push({ kind: "file", path, change: "created", source: "diff" });
  }

  if (changes.length > bounds.maxFiles) {
    return { changes: changes.slice(0, bounds.maxFiles), truncated: true };
  }
  return { changes, truncated };
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const stats = await lstat(path);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}
