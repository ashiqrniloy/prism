import { appendFile, mkdir, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { MemoryValidationError } from "../errors.js";

/** File notes live in a host-owned directory; reads are bounded the way coding-tool reads are. */
export const DEFAULT_FABRIC_MAX_FILE_BYTES = 50 * 1024;
export const HARD_FABRIC_MAX_FILE_BYTES = 1024 * 1024;

/** One `view` call lists at most this many entries, so a wide directory cannot flood a turn. */
export const HARD_FABRIC_VIEW_ENTRIES = 200;

export interface FabricFileEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly bytes?: number;
}

export interface FabricFileListing {
  readonly path: string;
  readonly entries: readonly FabricFileEntry[];
  readonly truncated: boolean;
}

export interface FabricFileContent {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface CreateFabricFileJailOptions {
  /** Read/append ceiling for one file; default 50 KiB, hard cap 1 MiB. */
  readonly maxFileBytes?: number;
}

/**
 * A fail-closed view of one host directory. Every operation resolves inside `root`, refuses
 * `..` segments, and re-checks the real path so a symlink cannot point out of the jail.
 */
export interface FabricFileJail {
  readonly root: string;
  readonly maxFileBytes: number;
  /** Absolute path when `requested` stays inside the jail; throws otherwise. */
  resolve(requested: string): Promise<string>;
  view(requested?: string): Promise<FabricFileListing>;
  read(requested: string): Promise<FabricFileContent>;
  /** Append text, creating the file and its parent directories; throws when the cap would be crossed. */
  append(requested: string, text: string): Promise<{ readonly path: string; readonly bytes: number }>;
}

function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** Real path of the longest existing ancestor of `target`, with the missing tail re-joined. */
async function realPathNearest(target: string): Promise<string> {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      tail.push(basename(current));
      current = parent;
    }
  }
}

export function createFabricFileJail(root: string, options: CreateFabricFileJailOptions = {}): FabricFileJail {
  if (typeof root !== "string" || root.trim().length === 0) throw new MemoryValidationError("root must be a non-empty directory path");
  const requestedMax = options.maxFileBytes ?? DEFAULT_FABRIC_MAX_FILE_BYTES;
  if (!Number.isInteger(requestedMax) || requestedMax <= 0) throw new MemoryValidationError("maxFileBytes must be a positive integer");
  if (requestedMax > HARD_FABRIC_MAX_FILE_BYTES) {
    throw new MemoryValidationError(`maxFileBytes exceeds hard cap ${HARD_FABRIC_MAX_FILE_BYTES}`);
  }
  const maxFileBytes = requestedMax;
  const rootAbs = resolve(root);
  let rootReal: Promise<string> | undefined;
  const resolveRoot = (): Promise<string> => (rootReal ??= realPathNearest(rootAbs));

  async function resolveInside(requested: string): Promise<string> {
    if (typeof requested !== "string" || requested.trim().length === 0) {
      throw new MemoryValidationError("path must be a non-empty string");
    }
    const absolute = resolve(rootAbs, requested);
    if (!isInside(rootAbs, absolute)) throw new MemoryValidationError(`path escapes the fabric root: ${requested}`);
    const realRoot = await resolveRoot();
    const real = await realPathNearest(absolute);
    if (!isInside(realRoot, real)) throw new MemoryValidationError(`path escapes the fabric root through a symlink: ${requested}`);
    return absolute;
  }

  return {
    root: rootAbs,
    maxFileBytes,
    resolve: resolveInside,
    async view(requested = ".") {
      const absolute = await resolveInside(requested);
      const dirents = await readdir(absolute, { withFileTypes: true });
      const entries: FabricFileEntry[] = [];
      for (const dirent of dirents) {
        if (dirent.isDirectory()) entries.push({ name: dirent.name, kind: "directory" });
        else if (dirent.isFile()) {
          const handle = await open(join(absolute, dirent.name), "r");
          try {
            entries.push({ name: dirent.name, kind: "file", bytes: (await handle.stat()).size });
          } finally {
            await handle.close();
          }
        }
      }
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      return { path: requested, entries: entries.slice(0, HARD_FABRIC_VIEW_ENTRIES), truncated: entries.length > HARD_FABRIC_VIEW_ENTRIES };
    },
    async read(requested) {
      const absolute = await resolveInside(requested);
      const handle = await open(absolute, "r");
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, maxFileBytes);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return { path: requested, text: buffer.subarray(0, bytesRead).toString("utf8"), bytes: size, truncated: size > bytesRead };
      } finally {
        await handle.close();
      }
    },
    async append(requested, text) {
      if (typeof text !== "string" || text.length === 0) throw new MemoryValidationError("text must be a non-empty string");
      const absolute = await resolveInside(requested);
      await mkdir(dirname(absolute), { recursive: true });
      const existing = await stat(absolute)
        .then((stats) => stats.size)
        .catch(() => 0);
      // Appends are line-oriented: a non-empty file gets a newline unless the caller supplied one.
      const payload = existing > 0 && !text.startsWith("\n") ? `\n${text}` : text;
      const written = Buffer.byteLength(payload, "utf8");
      if (existing + written > maxFileBytes) throw new MemoryValidationError(`file would exceed ${maxFileBytes} bytes`);
      await appendFile(absolute, payload, "utf8");
      return { path: requested, bytes: existing + written };
    },
  };
}
