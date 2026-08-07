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
      "High-risk: permanently delete a single file or empty directory in the workspace. Non-empty directories are rejected (no recursive delete). No trash/recycle — host undo is not automatic. Prefer edit/write when content can be fixed in place.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file or empty directory to delete (relative or absolute)" },
      },
      required: ["path"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      const path = typeof args.path === "string" ? args.path : "";
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
            if (entries.length > 0) {
              return errorResult(toolCallId, `Directory is not empty: ${path}. Recursive delete is not supported.`);
            }
            await ops.rmdir(allowedPath, { signal: context.signal });
            options?.onEvent?.({ type: "file_changed", path: allowedPath, op: "delete", toolCallId });
            return {
              toolCallId,
              name: "delete",
              content: [{ type: "text", text: `Successfully deleted empty directory ${allowedPath}` }],
              metadata: { path: allowedPath, kind: "directory" },
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
