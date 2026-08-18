/** Repository walk family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */
import type { Dir, Dirent } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import { assertDeadline, assertNotAborted, isPathInsideRoot, kindFromDirent, shouldSkipName, toRepoRelative } from "./path.js";
import type { RepoListEntry } from "./types.js";
import { RepositoryError } from "./types.js";

export interface RepositoryWalkLimits {
  maxDepth: number;
  maxEntries: number;
  maxFiles: number;
  exclude: ReadonlySet<string>;
  includeHidden: boolean;
  signal?: AbortSignal;
  deadlineAt?: number;
}

export type RepositoryWalkEvent =
  | { type: "entry"; entry: RepoListEntry; absolutePath: string; depth: number }
  | { type: "limit"; truncatedBy: "entries" | "files" | "depth" };

/** Injectable enumerator for list/search/glob. Default is the native opendir walker. */
export type RepositoryWalk = (rootReal: string, startAbsolute: string, limits: RepositoryWalkLimits) => AsyncGenerator<RepositoryWalkEvent>;

export async function* walkRepository(
  rootReal: string,
  startAbsolute: string,
  limits: RepositoryWalkLimits,
): AsyncGenerator<RepositoryWalkEvent> {
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

    let dir: Dir;
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

      const relativePath = current.relative === "." ? dirent.name : `${current.relative}/${dirent.name}`;
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
