import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import type { ExecutionPolicy, JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { CODING_LOCAL_EFFECT } from "./effects.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import type { CodingLifecycleEvent } from "./lifecycle.js";
import { resolveContainedMutationPath } from "./mutation-path.js";

export interface MutationStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
}

export interface DeleteOperations {
  lstat: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<MutationStat>;
  unlink: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<void>;
  rmdir: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<void>;
  readdir: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<readonly string[]>;
}

export interface DeleteToolOptions {
  executionPolicy?: ExecutionPolicy;
  operations?: DeleteOperations;
  /** Optional consumer-gated lifecycle listener (file_changed / permission_denied). */
  onEvent?: (event: CodingLifecycleEvent) => void;
}

// Per-call recursive-delete fan-out cap: default 10,000 entries, hard 100,000.
// ponytail: single global constants (not tunable options) — the recursive flag is
// per-call opt-in; hosts that need a different ceiling can deny via executionPolicy.
const DEFAULT_MAX_RECURSIVE_DELETE_ENTRIES = 10_000;
const HARD_MAX_RECURSIVE_DELETE_ENTRIES = 100_000;

const defaultDeleteOperations: DeleteOperations = {
  lstat: async (path) => {
    const st = await lstat(path);
    return {
      isFile: () => st.isFile(),
      isDirectory: () => st.isDirectory(),
      isSymbolicLink: () => st.isSymbolicLink(),
      size: st.size,
    };
  },
  unlink: (path) => unlink(path).then(() => {}),
  rmdir: (path) => rmdir(path).then(() => {}),
  readdir: (path) => readdir(path),
};

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "delete",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

export function createDeleteTool(cwd: string, options?: DeleteToolOptions): ToolDefinition {
  const ops = options?.operations ?? defaultDeleteOperations;

  return {
    name: "delete",
    effect: CODING_LOCAL_EFFECT,
    description:
      "High-risk: permanently delete a single file or empty directory in the workspace. Non-empty directories are rejected unless recursive: true (opt-in per call; recursive refuses symlinked-directory traversal and enforces a per-call fan-out cap, default 10,000 entries). No trash/recycle — host undo is not automatic. Prefer edit/write when content can be fixed in place.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, empty directory, or (with recursive: true) directory tree to delete (relative or absolute)",
        },
        recursive: {
          type: "boolean",
          description:
            "Opt-in per-call recursive directory delete (default false). Symlink children are unlinked as links, never followed; fan-out capped.",
        },
        maxEntries: {
          type: "number",
          description: `Per-call recursive fan-out cap (default ${DEFAULT_MAX_RECURSIVE_DELETE_ENTRIES}, hard ${HARD_MAX_RECURSIVE_DELETE_ENTRIES})`,
        },
      },
      required: ["path"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      const path = typeof args.path === "string" ? args.path : "";
      const recursive = args.recursive === true;
      let maxEntries = DEFAULT_MAX_RECURSIVE_DELETE_ENTRIES;
      if (args.maxEntries !== undefined) {
        const raw = args.maxEntries as number;
        if (!Number.isInteger(raw) || raw < 1 || raw > HARD_MAX_RECURSIVE_DELETE_ENTRIES) {
          return errorResult(toolCallId, `maxEntries must be an integer between 1 and ${HARD_MAX_RECURSIVE_DELETE_ENTRIES}`);
        }
        maxEntries = raw;
      }
      if (path.length === 0) {
        return errorResult(toolCallId, "path is required and must be a non-empty string.");
      }

      try {
        let absolutePath: string;
        try {
          absolutePath = await resolveContainedMutationPath(cwd, path);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT") return errorResult(toolCallId, `No such file or directory: ${path}`);
          throw error;
        }

        const policyCheck = await enforceExecutionPolicy(
          options?.executionPolicy,
          {
            kind: "delete",
            operation: "delete",
            paths: [absolutePath],
            risk: "high",
            metadata: { sessionId: context.sessionId, runId: context.runId, signal: context.signal },
          },
          toolCallId,
          "delete",
          (denied) => options?.onEvent?.({ type: "permission_denied", ...denied }),
        );
        if (!policyCheck.allowed) return policyCheck.result;
        const allowedPath = policyCheck.action.paths?.[0] ?? absolutePath;

        return await withFileMutationQueue(allowedPath, async () => {
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          let st: MutationStat;
          try {
            st = await ops.lstat(allowedPath, { signal: context.signal });
          } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") return errorResult(toolCallId, `No such file or directory: ${path}`);
            const message = error instanceof Error ? error.message : String(error);
            return errorResult(toolCallId, message);
          }

          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          if (st.isFile() || st.isSymbolicLink()) {
            await ops.unlink(allowedPath, { signal: context.signal });
            options?.onEvent?.({ type: "file_changed", path: allowedPath, op: "delete", toolCallId });
            return {
              toolCallId,
              name: "delete",
              content: [{ type: "text", text: `Successfully deleted ${allowedPath}` }],
              metadata: { path: allowedPath, kind: st.isSymbolicLink() ? "symlink" : "file", bytes: st.size },
            };
          }

          if (st.isDirectory()) {
            const entries = await ops.readdir(allowedPath, { signal: context.signal });
            if (entries.length > 0 && !recursive) {
              return errorResult(
                toolCallId,
                `Directory is not empty: ${path}. Recursive delete is not supported (set recursive: true to opt in per call).`,
              );
            }
            if (entries.length === 0) {
              await ops.rmdir(allowedPath, { signal: context.signal });
              options?.onEvent?.({ type: "file_changed", path: allowedPath, op: "delete", toolCallId });
              return {
                toolCallId,
                name: "delete",
                content: [{ type: "text", text: `Successfully deleted empty directory ${allowedPath}` }],
                metadata: { path: allowedPath, kind: "directory" },
              };
            }

            // Recursive delete: iterative post-order walk. Symlink children are
            // UNLINKED as links and never followed — a symlinked directory can
            // never drag the deletion outside the workspace root. The walk counts
            // every entry against the per-call fan-out cap and checks the abort
            // signal per entry; exceeding the cap stops with an error naming it.
            const stack: Array<{ dir: string }> = [{ dir: allowedPath }];
            const dirs: string[] = [allowedPath];
            let count = 0;
            while (stack.length > 0) {
              if (context.signal?.aborted) {
                return errorResult(toolCallId, `Operation aborted after deleting ${count} entries`);
              }
              const { dir } = stack.pop()!;
              const children = await ops.readdir(dir, { signal: context.signal });
              for (const child of children) {
                count++;
                if (count > maxEntries) {
                  return errorResult(
                    toolCallId,
                    `Recursive delete exceeded the per-call fan-out cap of ${maxEntries} entries after deleting ${count - 1} entries; nothing beyond the cap was touched.`,
                  );
                }
                const childPath = `${dir}/${child}`;
                const childStat = await ops.lstat(childPath, { signal: context.signal });
                if (childStat.isDirectory()) {
                  dirs.push(childPath);
                  stack.push({ dir: childPath });
                } else {
                  await ops.unlink(childPath, { signal: context.signal });
                  options?.onEvent?.({ type: "file_changed", path: childPath, op: "delete", toolCallId });
                }
              }
            }
            // Remove directories deepest-first, then the root directory itself.
            for (let i = dirs.length - 1; i >= 0; i--) {
              if (context.signal?.aborted) {
                return errorResult(toolCallId, `Operation aborted after deleting ${count} entries`);
              }
              await ops.rmdir(dirs[i]!, { signal: context.signal });
              options?.onEvent?.({ type: "file_changed", path: dirs[i]!, op: "delete", toolCallId });
            }
            return {
              toolCallId,
              name: "delete",
              content: [{ type: "text", text: `Successfully deleted ${allowedPath} (${count} entries)` }],
              metadata: { path: allowedPath, kind: "directory", recursive: true, entriesDeleted: count },
            };
          }

          return errorResult(toolCallId, `Unsupported file type: ${path}`);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
