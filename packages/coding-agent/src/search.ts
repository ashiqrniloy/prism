/**
 * `repo_search` tool: bounded native literal repository text search.
 */
import type { ExecutionPolicy, JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { CODING_OBSERVATION_EFFECT } from "./effects.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { HARD_MAX_SEARCH_CONTEXT_LINES, HARD_MAX_SEARCH_MATCHES, validateCodingLimit, validateCodingLimitAllowZero } from "./limits.js";
import {
  createLocalRepositoryOperations,
  RepositoryError,
  type RepoSearchMode,
  type RepositoryLimitOptions,
  type RepositoryOperations,
  type RepoSearchOutputMode,
  type RepositorySearchMatch,
  type RepositorySearchResult,
  resolveRepositoryLimits,
} from "./repository.js";
import { truncateLine } from "./truncate.js";

export interface SearchToolOptions {
  executionPolicy?: ExecutionPolicy;
  operations?: RepositoryOperations;
  repository?: RepositoryLimitOptions;
  maxMatches?: number;
  maxContextLines?: number;
  exclude?: readonly string[];
  /** Modes the tool exposes (default `["literal"]`); indexed modes require a host index via `operations`. */
  modes?: readonly RepoSearchMode[];
}

const ALL_MODES: readonly RepoSearchMode[] = ["literal", "indexed_literal", "semantic"];
const INDEX_MODE_LABEL: Record<"indexed_literal" | "semantic", string> = {
  indexed_literal: "host-indexed literal match with relevance scores",
  semantic: "host semantic search (requires a semantic-capable index backend)",
};

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
  const score = match.score !== undefined ? ` [score ${match.score.toFixed(3)}]` : "";
  lines.push(`${match.path}:${match.line}:${match.column}:${text}${score}`);
  for (const after of match.after) {
    const truncated = truncateLine(after, 500);
    lines.push(`${match.path}+${truncated.text}`);
  }
  return lines.join("\n");
}

function formatSearchText(result: RepositorySearchResult): string {
  if (result.matches.length === 0) {
    return result.truncated ? `[truncated by ${result.truncatedBy ?? "limit"} before any matches]` : "(no matches)";
  }
  const body = result.matches.map(formatMatch).join("\n");
  if (!result.truncated) return body;
  return `${body}\n[truncated by ${result.truncatedBy ?? "limit"}]`;
}

function uniqueMatchPaths(matches: readonly RepositorySearchMatch[]): string[] {
  return [...new Set(matches.map((m) => m.path))].sort();
}

function formatFilesWithMatches(result: RepositorySearchResult): string {
  if (result.matches.length === 0) {
    return result.truncated ? `[truncated by ${result.truncatedBy ?? "limit"} before any matches]` : "(no matches)";
  }
  const body = uniqueMatchPaths(result.matches).join("\n");
  if (!result.truncated) return body;
  return `${body}\n[truncated by ${result.truncatedBy ?? "limit"}]`;
}

function formatCount(result: RepositorySearchResult): string {
  const matchCount = result.matches.length;
  const fileCount = uniqueMatchPaths(result.matches).length;
  if (matchCount === 0) {
    return result.truncated ? `[truncated by ${result.truncatedBy ?? "limit"} before any matches]` : "0 matches in 0 files";
  }
  const noun = fileCount === 1 ? "file" : "files";
  const body = `${matchCount} matches in ${fileCount} ${noun}`;
  if (!result.truncated) return body;
  return `${body}\n[truncated by ${result.truncatedBy ?? "limit"}]`;
}

function formatSearchResult(result: RepositorySearchResult, outputMode: RepoSearchOutputMode): string {
  switch (outputMode) {
    case "files_with_matches":
      return formatFilesWithMatches(result);
    case "count":
      return formatCount(result);
    default:
      return formatSearchText(result);
  }
}

function parseOutputMode(value: unknown): RepoSearchOutputMode {
  if (value === undefined || value === "content") return "content";
  if (value === "files_with_matches" || value === "count") return value;
  throw new Error(`unsupported outputMode: ${String(value)}`);
}

function buildSearchMetadata(result: RepositorySearchResult, outputMode: RepoSearchOutputMode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    outputMode,
    truncated: result.truncated,
    truncatedBy: result.truncatedBy,
    matchCount: result.matches.length,
    scannedBytes: result.scannedBytes,
    scannedFiles: result.scannedFiles,
    scannedEntries: result.scannedEntries,
    filesSkippedBinary: result.filesSkippedBinary,
    filesSkippedOversize: result.filesSkippedOversize,
  };
  if (result.indexed !== undefined) {
    base.untrusted_index = result.untrusted_index === true;
    base.indexMode = result.indexed.mode;
    base.indexState = result.indexed.state;
    if (result.indexed.sourceRevision !== undefined) base.indexRevision = result.indexed.sourceRevision;
    if (result.indexed.updatedAt !== undefined) base.indexUpdatedAt = result.indexed.updatedAt;
  }
  if (outputMode === "content") {
    return { ...base, matches: result.matches };
  }
  return { ...base, fileCount: uniqueMatchPaths(result.matches).length };
}

function validateModes(modes: readonly RepoSearchMode[] | undefined): readonly RepoSearchMode[] {
  if (modes === undefined) return ["literal"];
  if (!Array.isArray(modes) || modes.length === 0) return ["literal"];
  const seen = new Set<RepoSearchMode>();
  for (const mode of modes) {
    if (!ALL_MODES.includes(mode)) {
      throw new Error(`unsupported search mode in options.modes: ${String(mode)}`);
    }
    seen.add(mode);
  }
  seen.add("literal"); // literal always stays available
  return [...seen].sort((a, b) => ALL_MODES.indexOf(a) - ALL_MODES.indexOf(b));
}

export function createRepoSearchTool(cwd: string, options?: SearchToolOptions): ToolDefinition {
  const limits = resolveRepositoryLimits({
    ...options?.repository,
    maxMatches: options?.maxMatches ?? options?.repository?.maxMatches,
    maxContextLines: options?.maxContextLines ?? options?.repository?.maxContextLines,
    exclude: options?.exclude ?? options?.repository?.exclude,
  });
  const ops = options?.operations ?? createLocalRepositoryOperations(limits);
  const modes = validateModes(options?.modes);
  const modeDescriptions = modes.map((m) => (m === "literal" ? "literal substring match only" : INDEX_MODE_LABEL[m])).join("; ");
  const indexedEnabled = modes.some((m) => m !== "literal");

  return {
    name: "repo_search",
    effect: CODING_OBSERVATION_EFFECT,
    description: indexedEnabled
      ? `Search text files under the workspace. Modes: ${modeDescriptions}. Index results are untrusted host index output and may be stale; verify before mutation. Skips binary files and excluded basenames (default: ${limits.exclude.join(", ")}). Caps matches/scanned bytes/time.`
      : `Search text files under the workspace using literal substring match. Use outputMode "files_with_matches" for paths only or "count" for totals without line bodies. Skips binary files, excluded basenames (default: ${limits.exclude.join(", ")}), and hidden names unless includeHidden is true. Does not follow symlinks. Caps matches/scanned bytes/time.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text to search for (required)" },
        path: {
          type: "string",
          description: "Workspace-relative directory or file to search (default: workspace root)",
        },
        mode: {
          type: "string",
          description: `Search mode: ${modeDescriptions}`,
          enum: [...modes],
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
        outputMode: {
          type: "string",
          description:
            'Result shape: "content" (default, line bodies), "files_with_matches" (unique paths), or "count" (match/file totals)',
          enum: ["content", "files_with_matches", "count"],
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
      if (args.mode === "regex") {
        return errorResult(toolCallId, 'repo_search no longer supports mode "regex"; use literal substring search.');
      }
      if (args.mode !== undefined && !modes.includes(args.mode as RepoSearchMode)) {
        return errorResult(toolCallId, `unsupported search mode: ${String(args.mode)} (enabled: ${modes.join(", ")})`);
      }
      const mode = (args.mode ?? "literal") as RepoSearchMode;
      let outputMode: RepoSearchOutputMode;
      try {
        outputMode = parseOutputMode(args.outputMode);
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }
      const caseSensitive = args.caseSensitive === true;
      const includeHidden = args.includeHidden === true;
      let contextLines: number | undefined;
      let maxMatches: number | undefined;
      try {
        if (args.context !== undefined) {
          contextLines = validateCodingLimitAllowZero("context", args.context as number, HARD_MAX_SEARCH_CONTEXT_LINES);
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
            outputMode,
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
          outputMode,
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
          content: [{ type: "text", text: formatSearchResult(result, outputMode) }],
          metadata: buildSearchMetadata(result, outputMode),
        };
      } catch (error) {
        const message = error instanceof RepositoryError ? error.message : error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
