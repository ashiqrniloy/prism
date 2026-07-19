/**
 * Write tool: create or overwrite a file on the host filesystem.
 *
 * Behavioral port of pi's core/tools/write for @arnilo/prism-coding-agent, adapted to Prism's
 * `ToolDefinition` contract. Faithfully ports the create-parent-dirs → write → serialize-per-path
 * flow. Drops pi's TUI (`renderCall`/`renderResult`, the incremental syntax-highlight cache, key hints).
 *
 * Deviations from pi (documented):
 *  - **Confirmation message carries the absolute path + real byte count + line count** (pi returns the
 *    caller-supplied path and `content.length`, which is a UTF-16 *code-unit* count mislabeled "bytes").
 *    The plan's acceptance criteria call for absolute path + byte/line counts; this is strictly more
 *    informative and the byte count is now UTF-8-correct.
 *  - Abort + all fs failures return a Prism `error` result (pi throws/rejects). Abort is checked before
 *    each filesystem operation (mkdir, writeFile); if the write completes it is reported as success
 *    (pi would throw "Operation aborted" even after a successful write — misleading, so dropped).
 */
import { Buffer } from "node:buffer";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { resolveToCwd } from "./path-utils.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import {
  DEFAULT_MAX_WRITE_BYTES,
  HARD_MAX_WRITE_BYTES,
  validateCodingLimit,
} from "./limits.js";

/**
 * Pluggable operations for the write tool. Override to delegate file writing to remote systems
 * (e.g. SSH) while keeping the tool's directory-creation + per-path serialization behavior.
 */
export interface WriteOperations {
  /** Write content to a file (creating or overwriting). */
  writeFile: (
    absolutePath: string,
    content: string,
    options?: { maxBytes: number; signal?: AbortSignal },
  ) => Promise<void>;
  /** Create a directory recursively. */
  mkdir: (dir: string, options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface WriteToolOptions {
  /** Structured pre-execution policy checked before filesystem writes. */
  executionPolicy?: ExecutionPolicy;
  /** Custom operations backend (default: local filesystem). */
  operations?: WriteOperations;
  /** Maximum UTF-8 input bytes accepted before any filesystem mutation (default 8 MiB). */
  maxInputBytes?: number;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content, options) => fsWriteFile(path, content, { encoding: "utf-8", signal: options?.signal }),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "write",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): ToolDefinition {
  const ops = options?.operations ?? defaultWriteOperations;
  const maxInputBytes = validateCodingLimit(
    "maxInputBytes",
    options?.maxInputBytes ?? DEFAULT_MAX_WRITE_BYTES,
    HARD_MAX_WRITE_BYTES,
  );

  return {
    name: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write (relative or absolute)" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;

      const path = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : undefined;

      if (path.length === 0) {
        return errorResult(toolCallId, "path is required and must be a non-empty string.");
      }
      if (content === undefined) {
        return errorResult(toolCallId, "content is required and must be a string.");
      }
      const bytes = Buffer.byteLength(content, "utf-8");
      if (bytes > maxInputBytes) {
        return errorResult(toolCallId, `Write input is ${bytes} bytes, exceeds ${maxInputBytes} byte limit.`);
      }

      try {
        const absolutePath = resolveToCwd(path, cwd);

        const policyCheck = await enforceExecutionPolicy(
          options?.executionPolicy,
          {
            kind: "write",
            operation: "write",
            paths: [absolutePath],
            risk: "medium",
            metadata: { bytes, sessionId: context.sessionId, runId: context.runId, signal: context.signal },
          },
          toolCallId,
          "write",
        );
        if (!policyCheck.allowed) return policyCheck.result;
        const allowedPath = policyCheck.action.paths?.[0] ?? absolutePath;
        const dir = dirname(allowedPath);

        return await withFileMutationQueue(allowedPath, async () => {
          // Check abort before each fs op — do not start a new operation once aborted. We intentionally
          // do NOT throw from an abort listener: that could release the mutation queue mid-operation.
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
          await ops.mkdir(dir, { signal: context.signal });
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
          await ops.writeFile(allowedPath, content, { maxBytes: maxInputBytes, signal: context.signal });


          const lines = countLines(content);
          return {
            toolCallId,
            name: "write",
            content: [
              {
                type: "text",
                text: `Successfully wrote ${bytes} bytes (${lines} lines) to ${allowedPath}`,
              },
            ],
            metadata: { bytes, lines, path: allowedPath },
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
