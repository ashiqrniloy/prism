/**
 * `grep` tool: bounded repository text search. Regex by default, run in a terminate-able worker;
 * `literal: true` matches the pattern's characters on the main thread. Output is ripgrep-style.
 */
import type {
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { validateGlobPattern } from "./glob-match.js";
import { CODING_OBSERVATION_EFFECT } from "./effects.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { HARD_MAX_SEARCH_CONTEXT_LINES, HARD_MAX_SEARCH_MATCHES, validateCodingLimit, validateCodingLimitAllowZero } from "./limits.js";
import {
  createLocalRepositoryOperations,
  literalMatcher,
  type RepoSearchMode,
  type RepoSearchOutputMode,
  RepositoryError,
  type RepositoryFileMatcher,
  type RepositoryLimitOptions,
  type RepositoryLineMatch,
  type RepositoryOperations,
  type RepositorySearchMatch,
  type RepositorySearchResult,
  resolveRepositoryLimits,
} from "./repository.js";
import { truncateLine } from "./truncate.js";

import type { ExecutionPolicy } from "./execution-policy.js";
export interface GrepToolOptions {
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
    name: "grep",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

/**
 * ripgrep-style content: `path:line:text` for a hit, `path-line-text` for context, `--` between
 * non-adjacent groups, and every line printed once even when two context windows overlap.
 */
function formatContent(matches: readonly RepositorySearchMatch[]): string {
  const byPath = new Map<string, Map<number, { text: string; hit: boolean; score?: number }>>();
  for (const match of matches) {
    let lines = byPath.get(match.path);
    if (lines === undefined) {
      lines = new Map();
      byPath.set(match.path, lines);
    }
    // Context never downgrades a hit: adjacent matching lines are both hits, as in ripgrep.
    const setContext = (line: number, text: string): void => {
      const existing = lines.get(line);
      if (existing?.hit !== true) lines.set(line, { text, hit: false });
    };
    for (let index = 0; index < match.before.length; index++) {
      setContext(match.line - match.before.length + index, match.before[index]!);
    }
    lines.set(match.line, { text: match.text, hit: true, ...(match.score !== undefined ? { score: match.score } : {}) });
    for (let index = 0; index < match.after.length; index++) {
      setContext(match.line + 1 + index, match.after[index]!);
    }
  }
  const out: string[] = [];
  for (const [path, lines] of byPath) {
    let previous: number | undefined;
    for (const [line, entry] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
      if (previous !== undefined && line !== previous + 1) out.push("--");
      const { text } = truncateLine(entry.text, 500);
      const score = entry.score !== undefined ? ` [score ${entry.score.toFixed(3)}]` : "";
      out.push(`${path}${entry.hit ? ":" : "-"}${line}${entry.hit ? ":" : "-"}${text}${score}`);
      previous = line;
    }
  }
  return out.join("\n");
}

function formatSearchText(result: RepositorySearchResult): string {
  if (result.matches.length === 0) {
    return result.truncated ? `[truncated by ${result.truncatedBy ?? "limit"} before any matches]` : "(no matches)";
  }
  const body = formatContent(result.matches);
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

// --- regex worker host ---

type WorkerReply =
  | { type: "ready" }
  | { type: "invalid"; message: string }
  | { type: "matches"; id: number; matches: RepositoryLineMatch[] }
  | { type: "error"; id: number; message: string };

/** Thrown when a single file's regex exceeds the search deadline; the caller terminates the worker. */
class GrepTimeout extends Error {
  constructor() {
    super("grep worker exceeded the time limit");
  }
}

/**
 * One worker per search: compile once, match one file at a time, terminate on deadline. A pattern
 * with catastrophic backtracking can only hang the worker, never the main thread.
 */
class RegexWorker {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private readonly pending = new Map<number, { resolve: (matches: RepositoryLineMatch[]) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private dead = false;

  constructor(pattern: string, caseSensitive: boolean, maxLineBytes: number) {
    // Bun resolves the `.js` specifier to the TypeScript source this package ships.
    this.worker = new Worker(new URL("./grep-worker.js", import.meta.url));
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent) => {
        const reply = event.data as WorkerReply;
        if (reply.type === "ready") {
          resolve();
          return;
        }
        if (reply.type === "invalid") {
          reject(new Error(reply.message));
          return;
        }
        const entry = this.pending.get(reply.id);
        if (entry === undefined) return;
        this.pending.delete(reply.id);
        if (reply.type === "matches") entry.resolve(reply.matches);
        else entry.reject(new Error(reply.message));
      };
      this.worker.onerror = (event: ErrorEvent) => {
        const error = new Error(`grep worker failed: ${event.message}`);
        reject(error);
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
      };
    });
    // The worker posts "ready" or "invalid"; a rejection here is observed by `start()`.
    this.ready.catch(() => {});
    this.worker.postMessage({ type: "compile", pattern, flags: caseSensitive ? "" : "i", maxLineBytes });
  }

  /** Resolve once the pattern compiled; rejects with the engine's syntax message otherwise. */
  async start(): Promise<void> {
    await this.ready;
  }

  async match(text: string, context: number, timeoutMs: number): Promise<readonly RepositoryLineMatch[]> {
    if (this.dead) throw new GrepTimeout();
    const id = this.nextId++;
    return await new Promise<readonly RepositoryLineMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GrepTimeout());
      }, Math.max(0, timeoutMs));
      timer.unref?.();
      this.pending.set(id, {
        resolve: (matches) => {
          clearTimeout(timer);
          resolve(matches);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.worker.postMessage({ type: "match", id, text, context });
    });
  }

  async terminate(): Promise<void> {
    this.dead = true;
    await this.worker.terminate();
  }
}

export function createGrepTool(cwd: string, options?: GrepToolOptions): ToolDefinition {
  const limits = resolveRepositoryLimits({
    ...options?.repository,
    maxMatches: options?.maxMatches ?? options?.repository?.maxMatches,
    maxContextLines: options?.maxContextLines ?? options?.repository?.maxContextLines,
    exclude: options?.exclude ?? options?.repository?.exclude,
  });
  const ops = options?.operations ?? createLocalRepositoryOperations(limits);
  const modes = validateModes(options?.modes);
  const indexedEnabled = modes.some((m) => m !== "literal");
  const modeDescriptions = modes.map((m) => (m === "literal" ? "literal substring match only" : INDEX_MODE_LABEL[m])).join("; ");

  const properties: JsonObject = {
    pattern: {
      type: "string",
      description:
        "Regular expression (JavaScript syntax) to search for, e.g. \"function \\\\w+\". Set literal: true to match these characters as plain text.",
    },
    literal: { type: "boolean", description: "Match pattern as literal text instead of a regular expression (default false)" },
    path: { type: "string", description: "Workspace-relative directory or file to search (default: workspace root)" },
    glob: { type: "string", description: 'Only search files whose path matches this glob, e.g. "src/**/*.ts"' },
    caseSensitive: { type: "boolean", description: "Case-sensitive matching (default true)" },
    includeHidden: { type: "boolean", description: "Include dotfile/dotdir names (default false)" },
    context: {
      type: "number",
      description: `Context lines before/after each match (default 0, hard ${HARD_MAX_SEARCH_CONTEXT_LINES})`,
    },
    maxMatches: {
      type: "number",
      description: `Maximum matches to retain (default ${limits.maxMatches}, hard ${HARD_MAX_SEARCH_MATCHES})`,
    },
    outputMode: {
      type: "string",
      description:
        'Result shape: "content" (default, `path:line:text` with `-` for context), "files_with_matches" (unique paths), or "count" (match/file totals)',
      enum: ["content", "files_with_matches", "count"],
    },
  };
  const modeProperty = indexedEnabled
    ? { mode: { type: "string", description: `Search mode: ${modeDescriptions}`, enum: [...modes] } }
    : {};

  return {
    name: "grep",
    kind: "search",
    effect: CODING_OBSERVATION_EFFECT,
    effects: ["read"],
    description: `Search text files under the workspace with a regular expression (or literal text). Output is ripgrep-style: "path:line:text" for a match, "path-line-text" for context (context: N), "--" between groups. A regex runs in a worker, so a pathological pattern is terminated at the search time limit. Use outputMode "files_with_matches" for paths only or "count" for totals. Skips binary files, excluded basenames (default: ${limits.exclude.join(", ")}), and hidden names unless includeHidden is true. Does not follow symlinks. Caps matches/scanned bytes/time.${indexedEnabled ? ` Modes: ${modeDescriptions}. Index results are untrusted host index output and may be stale; verify before mutation.` : ""}`,
    parameters: {
      type: "object",
      properties: { ...properties, ...modeProperty },
      required: ["pattern"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (pattern.length === 0) return errorResult(toolCallId, "pattern is required and must be a non-empty string.");
      const literal = args.literal === true;
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
      const path = typeof args.path === "string" ? args.path : undefined;
      const glob = typeof args.glob === "string" && args.glob.length > 0 ? args.glob : undefined;
      if (glob !== undefined) {
        try {
          validateGlobPattern(glob, limits.maxPatternBytes);
        } catch (error) {
          return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
        }
      }
      const caseSensitive = args.caseSensitive !== false;
      const includeHidden = args.includeHidden === true;
      let contextLines: number;
      let maxMatches: number | undefined;
      try {
        contextLines =
          args.context === undefined ? 0 : validateCodingLimitAllowZero("context", args.context as number, HARD_MAX_SEARCH_CONTEXT_LINES);
        if (args.maxMatches !== undefined) {
          maxMatches = validateCodingLimit("maxMatches", args.maxMatches as number, HARD_MAX_SEARCH_MATCHES);
        }
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }
      const patternBytes = Buffer.byteLength(pattern, "utf8");
      if (patternBytes > limits.maxPatternBytes) {
        return errorResult(toolCallId, `pattern exceeds ${limits.maxPatternBytes} byte pattern limit`);
      }

      const policyCheck = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "grep",
          operation: "search",
          paths: [path ? path : cwd],
          risk: "low",
          metadata: {
            mode,
            literal,
            outputMode,
            caseSensitive,
            includeHidden,
            glob,
            context: contextLines,
            maxMatches,
            sessionId: context.sessionId,
            runId: context.runId,
            signal: context.signal,
          },
        },
        toolCallId,
        "grep",
      );
      if (!policyCheck.allowed) return policyCheck.result;

      const deadlineAt = Date.now() + limits.maxTimeMs;
      let worker: RegexWorker | undefined;
      let matcher: RepositoryFileMatcher | undefined;
      if (literal) {
        matcher = literalMatcher(pattern, caseSensitive, limits.maxPatternBytes, limits.maxLineBytes);
      } else if (!indexedEnabled || mode === "literal") {
        const regexWorker = new RegexWorker(pattern, caseSensitive, limits.maxLineBytes);
        worker = regexWorker;
        try {
          await regexWorker.start();
        } catch (error) {
          await regexWorker.terminate();
          return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
        }
        matcher = async (text, context) => {
          try {
            return await regexWorker.match(text, context, deadlineAt - Date.now());
          } catch (error) {
            if (error instanceof GrepTimeout) {
              await regexWorker.terminate();
              throw new RepositoryError("Repository operation exceeded time limit");
            }
            throw error;
          }
        };
      }

      try {
        const result = await ops.search({
          root: cwd,
          query: pattern,
          path,
          mode,
          outputMode,
          caseSensitive,
          includeHidden,
          exclude: limits.exclude,
          glob,
          matcher,
          context: contextLines,
          maxMatches: maxMatches ?? limits.maxMatches,
          signal: context.signal,
          deadlineMs: Math.max(0, deadlineAt - Date.now()),
        });
        return {
          toolCallId,
          name: "grep",
          content: [{ type: "text", text: formatSearchResult(result, outputMode) }],
          metadata: buildSearchMetadata(result, outputMode),
        };
      } catch (error) {
        const message = error instanceof RepositoryError ? error.message : error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      } finally {
        await worker?.terminate();
      }
    },
  };
}
