// Tool progressive disclosure (plan 041): lexical index + scoring + the generated
// `search_tools` activation tool. Same discipline as skill-disclosure (frozen caps,
// fail-closed, run-wins resolution), but tools are a request array, not message text.
import type { Message, ToolDefinition, ToolExecutionContext, ToolResult } from "./contracts.js";

/** Same shape as `AgentInput`; kept structural here so core's assembler and this module never form a runtime cycle. */
type ToolSearchInput = string | Message | readonly Message[];

export type ToolsDisclosure = "all" | "search";

export interface ToolsSearchOptions {
  /** Top-k tools disclosed per turn. Default 16; clamped to the hard cap. */
  readonly topK?: number;
}

export const SEARCH_TOOLS_TOOL_NAME = "search_tools";
export const DEFAULT_TOOLS_SEARCH_TOP_K = 16;
export const HARD_MAX_TOOLS_SEARCH_TOP_K = 64;
/** Frozen index cap; larger registries fail closed to full disclosure. */
export const HARD_MAX_TOOLS_INDEX = 1024;
export const DEFAULT_MAX_TOOLS_SEARCH_QUERY_BYTES = 4_096;
export const HARD_MAX_TOOLS_SEARCH_QUERY_BYTES = 65_536;

export const TOOL_DISCLOSURE_ERROR_CODE = "tool_disclosure_exceeded" as const;

export class ToolDisclosureError extends Error {
  readonly code = TOOL_DISCLOSURE_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = "ToolDisclosureError";
  }
}

export function isToolDisclosureError(error: unknown): error is ToolDisclosureError {
  return error instanceof Error && (error as { code?: unknown }).code === TOOL_DISCLOSURE_ERROR_CODE;
}

/** Run options win over agent config (mirrors resolveSkillsDisclosure); default "all". */
export function resolveToolsDisclosure(run?: ToolsDisclosure, agent?: ToolsDisclosure): ToolsDisclosure {
  return run ?? agent ?? "all";
}

/** Activation set: same shape as LoadedSkillSet (names-only persistence, per-session instance). */
export interface ActiveToolSet {
  has(name: string): boolean;
  add(name: string): void;
  list(): readonly string[];
  clear(): void;
}

export function createActiveToolSet(): ActiveToolSet {
  const names = new Set<string>();
  return {
    has(name) {
      return names.has(name);
    },
    add(name) {
      names.add(name);
    },
    list() {
      return [...names];
    },
    clear() {
      names.clear();
    },
  };
}

interface PostingEntry {
  readonly toolIndex: number;
  tf: number;
}

export interface ToolSearchIndex {
  readonly tools: readonly ToolDefinition[];
  readonly postings: ReadonlyMap<string, PostingEntry[]>;
}

/** Fixed tokenization: lowercase alphanumeric runs. No user-controlled regex anywhere. */
const WORD_SPLIT = /[^a-z0-9]+/;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((token) => token.length > 0);
}

/** ponytail: O(n·d) lexical index, rebuilt on registry change by the caller — embedder-backed
 *  scoring via the @arnilo/prism-memory/rag seam if accuracy fixtures fall short (plan 041). */
export function createToolSearchIndex(tools: readonly ToolDefinition[], skip?: (tool: ToolDefinition) => boolean): ToolSearchIndex {
  if (tools.length > HARD_MAX_TOOLS_INDEX) {
    throw new ToolDisclosureError(`Tool index exceeds hard cap (${HARD_MAX_TOOLS_INDEX} tools)`);
  }
  const postings = new Map<string, PostingEntry[]>();
  for (const [toolIndex, tool] of tools.entries()) {
    if (skip?.(tool)) continue;
    // Name tokens weigh ×3 so an exact name match outranks description-only matches.
    const seen = new Map<string, number>();
    for (const term of [...tokenize(tool.name), ...tokenize(tool.name), ...tokenize(tool.name), ...tokenize(tool.description ?? "")]) {
      seen.set(term, (seen.get(term) ?? 0) + 1);
    }
    for (const [term, tf] of seen) {
      const list = postings.get(term) ?? [];
      list.push({ toolIndex, tf });
      postings.set(term, list);
    }
  }
  return { tools, postings };
}

export interface ToolSearchMatch {
  readonly name: string;
  readonly description?: string;
  /** Query terms present in name/description, most significant first. */
  readonly matched: readonly string[];
}

/** Bounded lexical scoring: BM25-lite (tf × IDF, registry-derived DF). Ties keep registry order. */
export function scoreTools(
  index: ToolSearchIndex,
  query: string,
  k: number,
  queryByteCap = DEFAULT_MAX_TOOLS_SEARCH_QUERY_BYTES,
): readonly ToolSearchMatch[] {
  const bounded = query.slice(0, Math.trunc(queryByteCap));
  const terms = tokenize(bounded);
  if (terms.length === 0 || k <= 0 || index.tools.length === 0) return [];
  const limit = Math.min(Math.trunc(k), index.tools.length);
  const total = index.tools.filter((tool) => tool.name !== SEARCH_TOOLS_TOOL_NAME).length;
  const scores = new Array<number>(index.tools.length).fill(0);
  const matchedTerms = new Map<number, string[]>();
  for (const term of new Set(terms)) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = 1 + Math.log(total / list.length);
    for (const entry of list) {
      scores[entry.toolIndex] += entry.tf * idf;
      const names = matchedTerms.get(entry.toolIndex) ?? [];
      if (names.length < 8) names.push(term);
      matchedTerms.set(entry.toolIndex, names);
    }
  }
  const ranked = scores
    .map((score, toolIndex) => ({ score, toolIndex }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.toolIndex - b.toolIndex)
    .slice(0, limit);
  return ranked.map(({ toolIndex }) => ({
    name: index.tools[toolIndex]!.name,
    description: index.tools[toolIndex]!.description,
    matched: matchedTerms.get(toolIndex) ?? [],
  }));
}

export interface ToolSearchState {
  readonly index: ToolSearchIndex;
  readonly activated: ActiveToolSet;
  readonly topK: number;
}

export function createToolSearchState(options: {
  readonly tools: readonly ToolDefinition[];
  readonly activated: ActiveToolSet;
  readonly search?: ToolsSearchOptions;
}): ToolSearchState {
  const requested = options.search?.topK;
  const topK =
    requested === undefined ? DEFAULT_TOOLS_SEARCH_TOP_K : Math.min(Math.max(1, Math.trunc(requested)), HARD_MAX_TOOLS_SEARCH_TOP_K);
  // ponytail: index built once per run; mid-run registry mutation is not observed — rebuild by starting a new run.
  const index = createToolSearchIndex(options.tools, (tool) => tool.name === SEARCH_TOOLS_TOOL_NAME);
  return { index, activated: options.activated, topK };
}

/** Provider-facing narrowing: activated tools ∪ top-k for the turn. Fails closed — any
 *  scoring/index error discloses the full input list (never zero, never wider than input). */
export function selectDisclosedTools(options: {
  readonly tools: readonly ToolDefinition[];
  readonly input: ToolSearchInput;
  readonly queryByteCap?: number;
  readonly search?: ToolsSearchOptions;
  readonly activated?: { has(name: string): boolean };
}): readonly ToolDefinition[] {
  if (options.tools.length === 0) return options.tools;
  try {
    const keep = new Set<string>();
    for (const tool of options.tools)
      if (tool.name === SEARCH_TOOLS_TOOL_NAME || options.activated?.has(tool.name) === true) keep.add(tool.name);
    const index = createToolSearchIndex(options.tools, (tool) => tool.name === SEARCH_TOOLS_TOOL_NAME);
    const topK = Math.min(Math.max(1, Math.trunc(options.search?.topK ?? DEFAULT_TOOLS_SEARCH_TOP_K)), HARD_MAX_TOOLS_SEARCH_TOP_K);
    for (const match of scoreTools(index, inputText(options.input), topK, options.queryByteCap ?? DEFAULT_MAX_TOOLS_SEARCH_QUERY_BYTES))
      keep.add(match.name);
    const disclosed = options.tools.filter((tool) => keep.has(tool.name));
    if (disclosed.length > 0) return disclosed;
    // Nothing scored or activated and no always-on tools in the list: bounded deterministic
    // prefix instead of zero tools (the wired session always keeps `search_tools`, so the
    // un-wired caller is the only one that reaches this).
    return options.tools.slice(
      0,
      Math.min(Math.max(1, Math.trunc(options.search?.topK ?? DEFAULT_TOOLS_SEARCH_TOP_K)) + 1, options.tools.length),
    );
  } catch {
    return options.tools;
  }
}

function inputText(input: ToolSearchInput): string {
  if (typeof input === "string") return input;
  const messages =
    input === null || input === undefined || Array.isArray(input) === false ? [input as Message] : (input as readonly Message[]);
  let text = "";
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "text") {
        text += `${block.text}\n`;
        if (text.length > HARD_MAX_TOOLS_SEARCH_QUERY_BYTES) return text;
      }
    }
  }
  return text;
}

/** Model-facing activation tool, generated only in search mode. Results are inert
 *  name+description lines — no schemas or bodies — and activation re-checks allow/deny
 *  at dispatch time (blocked-reason matrix unchanged). */
export function createSearchToolsTool(state: ToolSearchState, queryByteCap = DEFAULT_MAX_TOOLS_SEARCH_QUERY_BYTES): ToolDefinition {
  return {
    name: SEARCH_TOOLS_TOOL_NAME,
    description: `Search available tools by relevance. Returns up to k tool names with short descriptions and marks them active so their full definitions appear on the next turn. Try queries made of tool keywords.`,
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, k: { type: "integer", minimum: 1 } },
      required: ["query"],
    },
    execute(args: { query?: unknown; k?: unknown }, context: ToolExecutionContext): ToolResult {
      const fail = (message: string): ToolResult => ({
        toolCallId: context.toolCallId,
        name: SEARCH_TOOLS_TOOL_NAME,
        error: { code: "ERR_PRISM_TOOL_SEARCH_INVALID", message },
      });
      if (typeof args.query !== "string" || args.query.trim().length === 0) return fail("query must be a non-empty string");
      if (Buffer.byteLength(args.query, "utf8") > HARD_MAX_TOOLS_SEARCH_QUERY_BYTES)
        return fail(`query exceeds ${HARD_MAX_TOOLS_SEARCH_QUERY_BYTES} bytes`);
      const k = args.k === undefined ? state.topK : typeof args.k === "number" && Number.isInteger(args.k) ? args.k : NaN;
      if (Number.isNaN(k) || k < 1) return fail("k must be an integer >= 1");
      const matches = scoreTools(state.index, args.query, k, queryByteCap);
      for (const match of matches) state.activated.add(match.name);
      return {
        toolCallId: context.toolCallId,
        name: SEARCH_TOOLS_TOOL_NAME,
        content: [
          {
            type: "text",
            text:
              matches.length === 0
                ? `No tools matched ${JSON.stringify(args.query.slice(0, 64))}. Try different keywords.`
                : matches
                    .map(
                      (match) =>
                        `- ${match.name}${match.description ? `: ${match.description.slice(0, 512)}` : ""} [matched: ${match.matched.join(", ")}]`,
                    )
                    .join("\n"),
          },
        ],
      };
    },
  };
}
