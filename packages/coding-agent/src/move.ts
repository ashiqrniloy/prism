import { access, constants } from "node:fs";
import { lstat, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { ExecutionPolicy, JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import type { MutationStat } from "./delete.js";
import { CODING_LOCAL_EFFECT } from "./effects.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import type { CodingLifecycleEvent } from "./lifecycle.js";
import { resolveContainedMutationPath } from "./mutation-path.js";

const accessAsync = promisify(access);

export interface MoveOperations {
  lstat: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<MutationStat>;
  rename: (from: string, to: string, options?: { signal?: AbortSignal }) => Promise<void>;
  unlink: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<void>;
  access: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface MoveToolOptions {
  executionPolicy?: ExecutionPolicy;
  operations?: MoveOperations;
  /** Optional consumer-gated lifecycle listener (file_changed / permission_denied). */
  onEvent?: (event: CodingLifecycleEvent) => void;
}

const defaultMoveOperations: MoveOperations = {
  lstat: async (path) => {
    const st = await lstat(path);
    return {
      isFile: () => st.isFile(),
      isDirectory: () => st.isDirectory(),
      isSymbolicLink: () => st.isSymbolicLink(),
      size: st.size,
    };
  },
  rename: (from, to) => rename(from, to).then(() => {}),
  unlink: (path) => unlink(path).then(() => {}),
  access: (path) => accessAsync(path, constants.F_OK),
};

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "move",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

async function withDualFileMutationQueue<T>(pathA: string, pathB: string, fn: () => Promise<T>): Promise<T> {
  const [first, second] = pathA <= pathB ? [pathA, pathB] : [pathB, pathA];
  return withFileMutationQueue(first, () => withFileMutationQueue(second, fn));
}

export function createMoveTool(cwd: string, options?: MoveToolOptions): ToolDefinition {
  const ops = options?.operations ?? defaultMoveOperations;

  return {
    name: "move",
    kind: "move",
    effect: CODING_LOCAL_EFFECT,
    description:
      "High-risk: move or rename a file within the workspace. Set overwrite=true to replace an existing destination file only (directories/non-empty dest rejected). Does not create parent directories. No trash — host undo is not automatic.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source path (relative or absolute)" },
        to: { type: "string", description: "Destination path (relative or absolute)" },
        overwrite: {
          type: "boolean",
          description: "Replace an existing destination file when true (default false).",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      const from = typeof args.from === "string" ? args.from : "";
      const to = typeof args.to === "string" ? args.to : "";
      const overwrite = args.overwrite === true;

      if (from.length === 0) return errorResult(toolCallId, "from is required and must be a non-empty string.");
      if (to.length === 0) return errorResult(toolCallId, "to is required and must be a non-empty string.");

      try {
        let fromPath: string;
        try {
          fromPath = await resolveContainedMutationPath(cwd, from);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT") return errorResult(toolCallId, `Source does not exist: ${from}`);
          throw error;
        }
        const toPath = await resolveContainedMutationPath(cwd, to, { allowMissing: true });

        const policyCheck = await enforceExecutionPolicy(
          options?.executionPolicy,
          {
            kind: "move",
            operation: "move",
            paths: [fromPath, toPath],
            risk: "high",
            metadata: { overwrite, sessionId: context.sessionId, runId: context.runId, signal: context.signal },
          },
          toolCallId,
          "move",
          (denied) => options?.onEvent?.({ type: "permission_denied", ...denied }),
        );
        if (!policyCheck.allowed) return policyCheck.result;
        const allowedFrom = policyCheck.action.paths?.[0] ?? fromPath;
        const allowedTo = policyCheck.action.paths?.[1] ?? toPath;

        return await withDualFileMutationQueue(allowedFrom, allowedTo, async () => {
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          let fromStat: MutationStat;
          try {
            fromStat = await ops.lstat(allowedFrom, { signal: context.signal });
          } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") return errorResult(toolCallId, `Source does not exist: ${from}`);
            const message = error instanceof Error ? error.message : String(error);
            return errorResult(toolCallId, message);
          }

          const destParent = dirname(allowedTo);
          try {
            await ops.access(destParent, { signal: context.signal });
          } catch {
            return errorResult(toolCallId, `Destination parent directory does not exist: ${destParent}`);
          }

          let destStat: MutationStat | undefined;
          try {
            destStat = await ops.lstat(allowedTo, { signal: context.signal });
          } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== "ENOENT") {
              const message = error instanceof Error ? error.message : String(error);
              return errorResult(toolCallId, message);
            }
          }

          if (destStat) {
            if (!overwrite) return errorResult(toolCallId, `Destination already exists: ${to}. Pass overwrite=true to replace.`);
            if (destStat.isDirectory()) return errorResult(toolCallId, `Destination is a directory: ${to}`);
            await ops.unlink(allowedTo, { signal: context.signal });
          }

          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
          await ops.rename(allowedFrom, allowedTo, { signal: context.signal });
          options?.onEvent?.({ type: "file_changed", path: allowedTo, op: "move", toolCallId });

          return {
            toolCallId,
            name: "move",
            content: [{ type: "text", text: `Successfully moved ${from} to ${allowedTo}` }],
            metadata: {
              from: allowedFrom,
              to: allowedTo,
              bytes: fromStat.isFile() ? fromStat.size : undefined,
              overwrite,
            },
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
