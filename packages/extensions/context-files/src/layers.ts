import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PermissionPolicy, SystemPromptContribution, TrustPolicy } from "@arnilo/prism";
import { assertPermission, isTrusted } from "@arnilo/prism";

/** Options for the layer reader. `workspaceRoot` gates the `AGENTS.md` files (project source);
 *  `SYSTEM.md` files inside `workspaceRoot` are gated the same way, while a `globalRoot` file is
 *  user-owned and its presence is the user's explicit choice. */
export interface ContextFileLayerOptions {
  readonly workspaceRoot?: string;
  readonly globalRoot?: string;
  /** Single `AGENTS.md` override path (still `source: "app"`, still trust-gated). */
  readonly agentsMdPath?: string;
  /** Multiple `AGENTS.md` override paths, applied in order. */
  readonly agentsMdPaths?: readonly string[];
  /** Optional per-index fallback for `agentsMdPaths`: used only when that `AGENTS.md` is absent. */
  readonly agentsMdFallbackPaths?: readonly (string | undefined)[];
  /** Single `SYSTEM.md` override path (still `source: "user"`). */
  readonly systemMdPath?: string;
  /** Multiple `SYSTEM.md` paths, applied in order. */
  readonly systemMdPaths?: readonly string[];
  /** Mode for the SYSTEM.md layers. Defaults to `"append"`. */
  readonly systemMdMode?: "append" | "replace";
  readonly trust?: TrustPolicy;
  readonly permission?: PermissionPolicy;
  /** Called for every file the trust gate skipped, so a host can report it. */
  readonly onSkip?: (path: string) => void;
}

/** The layers plus the mtimes of every candidate path (a missing file records `undefined`),
 *  which is what a caller needs to cache the result and re-check freshness without re-reading. */
export interface ContextFileLayersResult {
  readonly layers: readonly SystemPromptContribution[];
  readonly mtimes: ReadonlyMap<string, number | undefined>;
}

/**
 * Read the standard prompt files as {@link SystemPromptContribution} layers, `SYSTEM.md` first
 * (`source: "user"`) then every `AGENTS.md` / explicit file (`source: "app"`). The final order is
 * enforced by `composeSystemPrompt`'s source rank, so input order only breaks ties.
 *
 * No roots and no explicit paths returns `[]` without any filesystem access, so a standalone SDK
 * agent keeps working unchanged. Two reads per candidate path at most: no `readdir`, no scan, no
 * `import()`.
 */
export async function resolveContextFileLayers(options: ContextFileLayerOptions = {}): Promise<ContextFileLayersResult> {
  const mtimes = new Map<string, number | undefined>();
  const layers: SystemPromptContribution[] = [];
  const read = async (path: string, options2: ReadOptions, id: string): Promise<SystemPromptContribution | undefined> => {
    const layer = await readLayer(path, options2, id, mtimes);
    if (layer) layers.push(layer);
    return layer;
  };

  const systemPaths =
    options.systemMdPaths ??
    (options.systemMdPath !== undefined
      ? [options.systemMdPath]
      : options.globalRoot !== undefined
        ? [join(options.globalRoot, ".prism", "agent", "SYSTEM.md")]
        : []);
  for (const [index, path] of systemPaths.entries()) {
    await read(
      path,
      {
        workspaceRoot: options.workspaceRoot,
        trust: options.trust,
        permission: options.permission,
        mode: options.systemMdMode ?? "append",
        source: "user",
        onSkip: options.onSkip,
      },
      `system-md${index === 0 ? "" : `-${index}`}`,
    );
  }

  const agentsPaths =
    options.agentsMdPaths ??
    (options.agentsMdPath !== undefined
      ? [options.agentsMdPath]
      : options.workspaceRoot !== undefined
        ? [join(options.workspaceRoot, "AGENTS.md")]
        : []);
  for (const [index, path] of agentsPaths.entries()) {
    const fallback = options.agentsMdFallbackPaths?.[index];
    const chosen = fallback === undefined ? path : await chooseAgentPath(path, fallback, mtimes);
    await read(
      chosen,
      {
        workspaceRoot: options.workspaceRoot,
        trust: options.trust,
        permission: options.permission,
        mode: "append",
        source: "app",
        onSkip: options.onSkip,
      },
      `agents-md${index === 0 ? "" : `-${index}`}`,
    );
  }

  return { layers, mtimes };
}

/** The pair every candidate directory contributes: `AGENTS.md`, with `CLAUDE.md` as fallback. */
export function agentFileCandidates(directory: string): readonly [string, string] {
  return [join(directory, "AGENTS.md"), join(directory, "CLAUDE.md")];
}

/** Prefer `AGENTS.md`; use `CLAUDE.md` only when the primary file is absent. Both mtimes are
 *  recorded, so a later AGENTS.md creation or a CLAUDE.md edit still invalidates the cache. */
async function chooseAgentPath(primary: string, fallback: string, mtimes: Map<string, number | undefined>): Promise<string> {
  const primaryMtime = await mtime(primary);
  mtimes.set(primary, primaryMtime);
  if (primaryMtime !== undefined) return primary;
  mtimes.set(fallback, await mtime(fallback));
  return fallback;
}

/** The layers only — the shape a host library wants when it composes the prompt itself. */
export async function readContextFileLayers(options: ContextFileLayerOptions = {}): Promise<readonly SystemPromptContribution[]> {
  return (await resolveContextFileLayers(options)).layers;
}

interface ReadOptions {
  readonly workspaceRoot?: string;
  readonly trust?: TrustPolicy;
  readonly permission?: PermissionPolicy;
  readonly mode: "append" | "replace";
  readonly source: "user" | "app";
  readonly onSkip?: (path: string) => void;
}

async function readLayer(
  path: string,
  options: ReadOptions,
  id: string,
  mtimes: Map<string, number | undefined>,
): Promise<SystemPromptContribution | undefined> {
  // The gate applies to project files (inside workspaceRoot). A user-owned file outside it — the
  // global SYSTEM.md — is loaded without a project trust check.
  if (options.workspaceRoot === undefined || isInside(path, options.workspaceRoot)) {
    if (!(await isTrusted(options.trust, { kind: "project", target: path }))) {
      options.onSkip?.(path);
      return undefined;
    }
  }
  mtimes.set(path, await mtime(path));
  await assertPermission(options.permission, { kind: "resource", action: "load", target: path });
  const text = await readFileOrUndefined(path);
  if (text === undefined) return undefined;
  return { id, source: options.source, mode: options.mode, text };
}

function isInside(target: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(target));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function mtime(path: string): Promise<number | undefined> {
  try {
    // Millisecond precision: matches what a caller setting an mtime with `utimes` can express.
    return (await stat(path)).mtime.getTime();
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}

/** Current mtime of a candidate path (`undefined` when missing) — the cache freshness probe. */
export async function readFileMtime(path: string): Promise<number | undefined> {
  return await mtime(path);
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}
