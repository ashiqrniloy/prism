import { relative, resolve } from "node:path";
import type { Middleware, SessionEntry, ToolResult } from "@arnilo/prism";

import { runGraftJson } from "./cli.js";
import { persistGraftPatch } from "./state.js";

/**
 * Actual mutating-tool names in this repo's coding-agent registry (`write`, `edit`, `move`;
 * there is no `multiedit`/`apply_patch`). Hosts can widen via options.editToolNames.
 */
export const DEFAULT_EDIT_TOOL_NAMES = ["write", "edit", "move"] as const;

/** graft's own ignore rule: never react to edits inside the graph directory itself. */
export function underGraft(projectDir: string, path: string): boolean {
  const abs = path.startsWith("/") ? resolve(path) : resolve(projectDir, path);
  const graftDir = resolve(projectDir, "graft");
  return abs === graftDir || abs.startsWith(`${graftDir}/`);
}

/** Repo-relative form for events/metadata. */
export function repoRelative(projectDir: string, path: string): string {
  const abs = path.startsWith("/") ? resolve(path) : resolve(projectDir, path);
  const rel = relative(resolve(projectDir), abs);
  return rel === "" ? path : rel;
}

function pathFromCandidate(candidate: unknown): string | undefined {
  // graft's editedFilePath lesson: hosts ship either a bare string or a nested object.
  if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  if (typeof candidate === "object" && candidate !== null) {
    const record = candidate as Record<string, unknown>;
    if (typeof record.path === "string" && record.path.trim() !== "") return record.path;
  }
  return undefined;
}

/** Pure: the touched file path from an edit-tool result across host shapes. */
export function editedPathFrom(result: ToolResult, editToolNames: readonly string[] = DEFAULT_EDIT_TOOL_NAMES): string | undefined {
  if (!editToolNames.includes(result.name)) return undefined;
  const metadata = result.metadata;
  if (!metadata) return undefined;
  for (const key of ["path", "filePath", "file_path"]) {
    const found = pathFromCandidate(metadata[key]);
    if (found) return found;
  }
  return undefined;
}

/** Pure: tolerant dependents count + sample titles from a `graft blast --json` payload. */
export function summarizeBlast(payload: unknown): { dependents: number; sample: string[] } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  let entries: Array<Record<string, unknown>> | undefined;
  for (const key of ["dependents", "nodes", "results", "matches", "hits", "affected"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      entries = value.filter((node) => typeof node === "object" && node !== null) as Array<Record<string, unknown>>;
      break;
    }
  }
  if (!entries) return undefined;
  const sample = entries.slice(0, 6).map((node) => {
    for (const key of ["title", "id", "symbol", "name", "path"]) {
      const value = node[key];
      if (typeof value === "string" && value !== "") return value;
    }
    return "?";
  });
  return { dependents: entries.length, sample };
}

/** Best-effort session id from the host result metadata (`edit`/`write` stamp it there). */
function sessionIdFrom(result: ToolResult): string | undefined {
  const value = result.metadata?.sessionId;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export interface GraftEditWatchDeps {
  /** Bounded `graft blast` lookup; null ⇒ absent/unbuildable graph (silent no-op). */
  runBlast(repoPath: string): Promise<unknown | null>;
  onDirty(repoPath: string, staleCountEstimate: number | undefined, sessionId?: string): void;
}

/** Pure-ish middleware core: extraction → graft/ filter → budgeted lookup → metadata augmentation. Never throws. */
export function createEditWatchMiddleware(
  deps: GraftEditWatchDeps,
  options: { projectDir: string; editToolNames?: readonly string[] },
): Middleware<ToolResult> {
  return async (result, next) => {
    try {
      const path = editedPathFrom(result, options.editToolNames);
      if (!path || underGraft(options.projectDir, path)) return next(result);

      const relPath = repoRelative(options.projectDir, path);
      const summary = summarizeBlast(await deps.runBlast(relPath));
      if (!summary) {
        // absent graph ⇒ silent no-op (graft's fail-soft rule); still mark dirty so status reflects edits
        // ponytail: dirty is recorded, never rebuilt here — background resync would need a worker + lock story (graft's own Stop-hook does this); /graft build covers it
        deps.onDirty(relPath, undefined, sessionIdFrom(result));
        return next(result);
      }

      deps.onDirty(relPath, summary.dependents, sessionIdFrom(result));
      return next({ ...result, metadata: { ...(result.metadata ?? {}), graftBlast: { path: relPath, ...summary } } });
    } catch {
      return next(result); // never block the tool-result pipeline on retrieval trouble
    }
  };
}

export interface EditWatchWiringOptions {
  cliCommand: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxResultBytes: number;
  env: Readonly<Record<string, string>>;
  projectDir: string;
  getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  appendEntry: (entry: SessionEntry, options?: { expectedParentId?: string }) => Promise<void>;
  emit(event: { type: string; extension: string; metadata?: Record<string, unknown> }): Promise<void>;
  editToolNames?: readonly string[];
}

/** Extension wiring: CLI-backed blast lookup + `graft:dirty` event + dirty persistence. */
export function wireEditWatch(api: { use<T>(hook: string, mw: Middleware<T>): void }, options: EditWatchWiringOptions): void {
  api.use<ToolResult>(
    "tool_result",
    createEditWatchMiddleware(
      {
        runBlast: async (relPath) =>
          (
            await runGraftJson(
              { kind: "explicit", command: options.cliCommand[0]!, args: options.cliCommand.slice(1) },
              ["blast", relPath, ".", "--json"],
              { cwd: options.cwd, timeoutMs: options.timeoutMs, maxResultBytes: options.maxResultBytes, env: options.env },
            )
          ).value,
        onDirty: (relPath, staleCountEstimate, sessionId) => {
          void (async () => {
            await persistGraftPatch({
              sessionId,
              patch: { dirty: true },
              getEntries: options.getEntries,
              appendEntry: (entry, appendOptions) => options.appendEntry(entry, { expectedParentId: appendOptions?.expectedParentId }),
            });
            await options.emit({
              type: "graft:dirty",
              extension: "@arnilo/prism-graft",
              metadata: { path: relPath, ...(staleCountEstimate !== undefined ? { staleCountEstimate } : {}) },
            });
          })().catch(() => {});
        },
      },
      { projectDir: options.projectDir, editToolNames: options.editToolNames },
    ),
  );
}
