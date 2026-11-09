/**
 * Touched-path tracker (plan 188.2 Task 4).
 *
 * A session remembers which files its file tools read or wrote so a `path`-scoped note can earn its
 * prior only where it applies. Paths are stored workspace-relative and newest first, capped at 256.
 * The set lives in session state and is written once per turn, only when it changed.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_TOUCHED_PATHS = 256;

/** File tools whose `path` argument names a project file. Other tools contribute nothing. */
const FILE_TOOLS = new Set(["read", "edit", "write"]);

export interface TouchedPathState {
  get(): unknown;
  set(value: { readonly paths: readonly string[] }): Promise<void>;
}

export interface TouchedPathTracker {
  /** Newest first, workspace-relative with `/` separators. */
  paths(): readonly string[];
  /** Records a tool call; returns true when the set changed and needs a flush. */
  record(call: { readonly name: string; readonly arguments: Record<string, unknown> }): boolean;
  dirty(): boolean;
  /** Persists the set once; a no-op when nothing changed. */
  flush(): Promise<void>;
}

function normalize(root: string, path: string): string | undefined {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const relativePath = relative(root, absolute).split(sep).join("/");
  if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) return undefined;
  return relativePath;
}

export function createTouchedPathTracker(options: {
  readonly root: string;
  readonly store?: TouchedPathState;
  readonly max?: number;
}): TouchedPathTracker {
  const root = resolve(options.root);
  const max = options.max ?? MAX_TOUCHED_PATHS;
  let loaded = false;
  let changed = false;
  let paths: string[] = [];

  function load(): void {
    if (loaded) return;
    loaded = true;
    const stored = options.store?.get();
    if (stored !== null && typeof stored === "object" && Array.isArray((stored as { paths?: unknown }).paths)) {
      paths = (stored as { paths: unknown[] }).paths.filter((path): path is string => typeof path === "string").slice(0, max);
    }
  }

  return {
    paths() {
      load();
      return paths;
    },
    record(call) {
      if (!FILE_TOOLS.has(call.name)) return false;
      const value = call.arguments.path;
      if (typeof value !== "string" || value.length === 0) return false;
      const path = normalize(root, value);
      if (path === undefined) return false;
      load();
      const previous = paths.indexOf(path);
      if (previous === 0) return false;
      if (previous > 0) paths.splice(previous, 1);
      paths.unshift(path);
      if (paths.length > max) paths.length = max;
      changed = true;
      return true;
    },
    dirty() {
      return changed;
    },
    async flush() {
      if (!changed || options.store === undefined) return;
      changed = false;
      await options.store.set({ paths: [...paths] });
    },
  };
}
