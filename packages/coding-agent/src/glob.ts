/**
 * `glob` tool: bounded native pattern file finder.
 */
import type { ExecutionPolicy, JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { HARD_MAX_REPO_DEPTH, HARD_MAX_REPO_RESULTS, validateCodingLimit, validateCodingLimitAllowZero } from "./limits.js";
import {
  createLocalRepositoryOperations,
  RepositoryError,
  type RepositoryGlobResult,
  type RepositoryLimitOptions,
  type RepositoryOperations,
  resolveRepositoryLimits,
} from "./repository.js";

export interface GlobToolOptions {
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
    name: "glob",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function formatGlobText(result: RepositoryGlobResult): string {
  if (result.paths.length === 0) {
    return result.truncated ? `[truncated by ${result.truncatedBy ?? "limit"} before any matches]` : "(no matches)";
  }
  const lines = [...result.paths];
  if (result.truncated) {
    const next = result.nextOffset !== undefined ? ` Use offset=${result.nextOffset} to continue.` : "";
    lines.push(`[truncated by ${result.truncatedBy ?? "limit"}.${next}]`);
  }
  return lines.join("\n");
}

export function createGlobTool(cwd: string, options?: GlobToolOptions): ToolDefinition {
  const limits = resolveRepositoryLimits({
    ...options?.repository,
    maxDepth: options?.maxDepth ?? options?.repository?.maxDepth,
    maxResults: options?.maxResults ?? options?.repository?.maxResults,
    exclude: options?.exclude ?? options?.repository?.exclude,
  });
  const ops = options?.operations ?? createLocalRepositoryOperations(limits);

  return {
    name: "glob",
    description: `Find workspace files by glob pattern without shell find. Supports * (segment), ? (one char), and ** (directories). Brace expansion is rejected. Skips hidden names and excluded basenames (default: ${limits.exclude.join(", ")}) unless overridden. Does not follow symlinks. Results paginate with offset/maxResults (default ${limits.maxResults}). Depth default ${limits.maxDepth}. Prefer repo_list to enumerate directories and repo_search to find text inside files.`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern matched against workspace-relative file paths (required)",
        },
        path: {
          type: "string",
          description: "Workspace-relative directory or file to search under (default: workspace root)",
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
          description: `Maximum paths returned in this page (default ${limits.maxResults}, hard ${HARD_MAX_REPO_RESULTS})`,
        },
        offset: {
          type: "number",
          description: "Number of matching paths to skip before retaining results (default 0)",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (!pattern) return errorResult(toolCallId, "pattern must be a non-empty string");

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
          kind: "glob",
          operation: "glob",
          paths: [path ? path : cwd],
          risk: "low",
          metadata: {
            pattern,
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
        "glob",
      );
      if (!policyCheck.allowed) return policyCheck.result;

      try {
        const result = await ops.glob({
          root: cwd,
          pattern,
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
          name: "glob",
          content: [{ type: "text", text: formatGlobText(result) }],
          metadata: {
            truncated: result.truncated,
            truncatedBy: result.truncatedBy,
            offset: result.offset,
            nextOffset: result.nextOffset,
            returned: result.paths.length,
            scannedEntries: result.scannedEntries,
            scannedFiles: result.scannedFiles,
            paths: result.paths,
          },
        };
      } catch (error) {
        const message = error instanceof RepositoryError ? error.message : error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
