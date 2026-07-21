/**
 * `repo_list` tool: bounded native repository listing.
 */
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { enforceExecutionPolicy } from "./execution-policy.js";
import {
  createLocalRepositoryOperations,
  resolveRepositoryLimits,
  RepositoryError,
  type RepositoryLimitOptions,
  type RepositoryListResult,
  type RepositoryOperations,
} from "./repository.js";
import { HARD_MAX_REPO_DEPTH, HARD_MAX_REPO_RESULTS, validateCodingLimit, validateCodingLimitAllowZero } from "./limits.js";

export interface ListToolOptions {
  executionPolicy?: ExecutionPolicy;
  operations?: RepositoryOperations;
  repository?: RepositoryLimitOptions;
  maxDepth?: number;
  maxResults?: number;
  exclude?: readonly string[];
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "repo_list",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function formatListText(result: RepositoryListResult): string {
  if (result.entries.length === 0) {
    return result.truncated
      ? `[truncated by ${result.truncatedBy ?? "limit"} before any entries]`
      : "(no entries)";
  }
  const lines = result.entries.map((entry) => {
    const size = entry.size !== undefined ? `\t${entry.size}` : "";
    return `${entry.kind}\t${entry.path}${size}`;
  });
  if (result.truncated) {
    const next =
      result.nextOffset !== undefined ? ` Use offset=${result.nextOffset} to continue.` : "";
    lines.push(`[truncated by ${result.truncatedBy ?? "limit"}.${next}]`);
  }
  return lines.join("\n");
}

export function createRepoListTool(cwd: string, options?: ListToolOptions): ToolDefinition {
  const limits = resolveRepositoryLimits({
    ...options?.repository,
    maxDepth: options?.maxDepth ?? options?.repository?.maxDepth,
    maxResults: options?.maxResults ?? options?.repository?.maxResults,
    exclude: options?.exclude ?? options?.repository?.exclude,
  });
  const ops = options?.operations ?? createLocalRepositoryOperations(limits);

  return {
    name: "repo_list",
    description: `List repository entries under the workspace with deterministic relative paths. Skips hidden names and excluded basenames (default: ${limits.exclude.join(", ")}) unless overridden. Does not follow symlinks. Results paginate with offset/maxResults (default ${limits.maxResults}). Depth default ${limits.maxDepth}.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative directory or file to list (default: workspace root)",
        },
        includeHidden: {
          type: "boolean",
          description: "Include dotfile/dotdir names (default false). Excluded basenames still apply.",
        },
        maxDepth: {
          type: "number",
          description: `Maximum directory depth to descend (default ${limits.maxDepth}, hard ${HARD_MAX_REPO_DEPTH})`,
        },
        maxResults: {
          type: "number",
          description: `Maximum entries returned in this page (default ${limits.maxResults}, hard ${HARD_MAX_REPO_RESULTS})`,
        },
        offset: {
          type: "number",
          description: "Number of entries to skip before retaining results (default 0)",
        },
      },
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

      const path = typeof args.path === "string" ? args.path : undefined;
      const includeHidden = args.includeHidden === true;
      let maxDepth: number | undefined;
      let maxResults: number | undefined;
      let offset = 0;
      try {
        if (args.maxDepth !== undefined) {
          maxDepth = validateCodingLimit("maxDepth", args.maxDepth as number, HARD_MAX_REPO_DEPTH);
        }
        if (args.maxResults !== undefined) {
          maxResults = validateCodingLimit("maxResults", args.maxResults as number, HARD_MAX_REPO_RESULTS);
        }
        if (args.offset !== undefined) {
          offset = validateCodingLimitAllowZero("offset", args.offset as number, limits.maxEntries);
        }
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }

      const policyCheck = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "repo_list",
          operation: "list",
          paths: [path ? path : cwd],
          risk: "low",
          metadata: {
            includeHidden,
            maxDepth,
            maxResults,
            offset,
            sessionId: context.sessionId,
            runId: context.runId,
            signal: context.signal,
          },
        },
        toolCallId,
        "repo_list",
      );
      if (!policyCheck.allowed) return policyCheck.result;

      try {
        const result = await ops.list({
          root: cwd,
          path,
          includeHidden,
          exclude: limits.exclude,
          maxDepth: maxDepth ?? limits.maxDepth,
          maxResults: maxResults ?? limits.maxResults,
          offset,
          signal: context.signal,
          deadlineMs: limits.maxTimeMs,
        });
        return {
          toolCallId,
          name: "repo_list",
          content: [{ type: "text", text: formatListText(result) }],
          metadata: {
            truncated: result.truncated,
            truncatedBy: result.truncatedBy,
            offset: result.offset,
            nextOffset: result.nextOffset,
            returned: result.entries.length,
            scannedEntries: result.scannedEntries,
            scannedFiles: result.scannedFiles,
            entries: result.entries,
          },
        };
      } catch (error) {
        const message =
          error instanceof RepositoryError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
