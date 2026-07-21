/**
 * `repo_search` tool: bounded native literal/regex repository text search.
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
  HARD_MAX_SEARCH_CONTEXT_LINES,
  HARD_MAX_SEARCH_MATCHES,
  validateCodingLimit,
  validateCodingLimitAllowZero,
} from "./limits.js";
import {
  createLocalRepositoryOperations,
  resolveRepositoryLimits,
  RepositoryError,
  type RepositoryLimitOptions,
  type RepositoryOperations,
  type RepositorySearchMatch,
  type RepositorySearchResult,
} from "./repository.js";
import { truncateLine } from "./truncate.js";

export interface SearchToolOptions {
  executionPolicy?: ExecutionPolicy;
  operations?: RepositoryOperations;
  repository?: RepositoryLimitOptions;
  maxMatches?: number;
  maxContextLines?: number;
  exclude?: readonly string[];
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "repo_search",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function formatMatch(match: RepositorySearchMatch): string {
  const lines: string[] = [];
  for (const before of match.before) {
    const { text } = truncateLine(before, 500);
    lines.push(`${match.path}-${text}`);
  }
  const { text } = truncateLine(match.text, 500);
  lines.push(`${match.path}:${match.line}:${match.column}:${text}`);
  for (const after of match.after) {
    const truncated = truncateLine(after, 500);
    lines.push(`${match.path}+${truncated.text}`);
  }
  return lines.join("\n");
}

function formatSearchText(result: RepositorySearchResult): string {
  if (result.matches.length === 0) {
    return result.truncated
      ? `[truncated by ${result.truncatedBy ?? "limit"} before any matches]`
      : "(no matches)";
  }
  const body = result.matches.map(formatMatch).join("\n");
  if (!result.truncated) return body;
  return `${body}\n[truncated by ${result.truncatedBy ?? "limit"}]`;
}

export function createRepoSearchTool(cwd: string, options?: SearchToolOptions): ToolDefinition {
  const limits = resolveRepositoryLimits({
    ...options?.repository,
    maxMatches: options?.maxMatches ?? options?.repository?.maxMatches,
    maxContextLines: options?.maxContextLines ?? options?.repository?.maxContextLines,
    exclude: options?.exclude ?? options?.repository?.exclude,
  });
  const ops = options?.operations ?? createLocalRepositoryOperations(limits);

  return {
    name: "repo_search",
    description: `Search text files under the workspace. Default mode is literal substring match; set mode=regex for bounded regular expressions. Skips binary files, excluded basenames (default: ${limits.exclude.join(", ")}), and hidden names unless includeHidden is true. Does not follow symlinks. Caps matches/scanned bytes/time.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text or regular expression to search for (required)" },
        path: {
          type: "string",
          description: "Workspace-relative directory or file to search (default: workspace root)",
        },
        mode: {
          type: "string",
          description: 'Search mode: "literal" (default) or "regex"',
          enum: ["literal", "regex"],
        },
        caseSensitive: {
          type: "boolean",
          description: "Case-sensitive matching (default false)",
        },
        includeHidden: {
          type: "boolean",
          description: "Include dotfile/dotdir names (default false)",
        },
        context: {
          type: "number",
          description: `Context lines before/after each match (default ${limits.maxContextLines}, hard ${HARD_MAX_SEARCH_CONTEXT_LINES})`,
        },
        maxMatches: {
          type: "number",
          description: `Maximum matches to retain (default ${limits.maxMatches}, hard ${HARD_MAX_SEARCH_MATCHES})`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

      const query = typeof args.query === "string" ? args.query : "";
      if (query.length === 0) return errorResult(toolCallId, "query is required and must be a non-empty string.");

      const path = typeof args.path === "string" ? args.path : undefined;
      const mode = args.mode === "regex" ? "regex" : "literal";
      const caseSensitive = args.caseSensitive === true;
      const includeHidden = args.includeHidden === true;
      let contextLines: number | undefined;
      let maxMatches: number | undefined;
      try {
        if (args.context !== undefined) {
          contextLines = validateCodingLimitAllowZero(
            "context",
            args.context as number,
            HARD_MAX_SEARCH_CONTEXT_LINES,
          );
        }
        if (args.maxMatches !== undefined) {
          maxMatches = validateCodingLimit("maxMatches", args.maxMatches as number, HARD_MAX_SEARCH_MATCHES);
        }
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }

      const policyCheck = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "repo_search",
          operation: "search",
          paths: [path ? path : cwd],
          risk: "low",
          metadata: {
            mode,
            caseSensitive,
            includeHidden,
            context: contextLines,
            maxMatches,
            sessionId: context.sessionId,
            runId: context.runId,
            signal: context.signal,
          },
        },
        toolCallId,
        "repo_search",
      );
      if (!policyCheck.allowed) return policyCheck.result;

      try {
        const result = await ops.search({
          root: cwd,
          query,
          path,
          mode,
          caseSensitive,
          includeHidden,
          exclude: limits.exclude,
          context: contextLines ?? limits.maxContextLines,
          maxMatches: maxMatches ?? limits.maxMatches,
          signal: context.signal,
          deadlineMs: limits.maxTimeMs,
        });
        return {
          toolCallId,
          name: "repo_search",
          content: [{ type: "text", text: formatSearchText(result) }],
          metadata: {
            truncated: result.truncated,
            truncatedBy: result.truncatedBy,
            matchCount: result.matches.length,
            scannedBytes: result.scannedBytes,
            scannedFiles: result.scannedFiles,
            scannedEntries: result.scannedEntries,
            filesSkippedBinary: result.filesSkippedBinary,
            filesSkippedOversize: result.filesSkippedOversize,
            matches: result.matches,
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
