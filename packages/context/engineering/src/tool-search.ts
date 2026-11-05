// Tool progressive disclosure (plan 041), ported into `@arnilo/prism-context-engineering`
// (plan 158 Task 7): lexical index + scoring + the generated `search_tools` activation tool.
// Same discipline as skill disclosure (frozen caps, fail-closed), but tools are a request array,
// not message text. The index is built from the `context.build` draft, so it can never see a tool
// the kernel hid with a `when` predicate or `disable.tools`.
import { filterTools, type Message, type ToolDefinition, type ToolExecutionContext, type ToolFilterInput, type ToolResult } from "@arnilo/prism";

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

/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export function isToolDisclosureError(error: unknown): error is ToolDisclosureError {
  return error instanceof Error && (error as { code?: unknown }).code === TOOL_DISCLOSURE_ERROR_CODE;
}

/** Run options win over agent config (mirrors resolveSkillsDisclosure); default "all".
 *  @deprecated No replacement: nothing reads it since the 0.13 split. Removed at the next breaking
 *  cut (docs/_evidence/dead-export-verification-2026-09-03.md). */
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
 *  scoring through a host-supplied embedder if accuracy fixtures fall short (plan 041). */
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
    effects: ["read"],
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

export interface ToolDisclosureConformanceOptions {
  /** Host-active tool definitions; may include schema-bearing and oversized-description tools. */
  readonly tools: readonly ToolDefinition[];
  /** Host allow/deny bounds applied before disclosure (same input the runtime narrows). */
  readonly filter?: ToolFilterInput;
  /** Search options under test (topK). */
  readonly search?: { readonly topK?: number };
  /** Turn text used for the relevance query. Defaults to a zero-match probe. */
  readonly input?: string;
  /** Secret values that must never appear in model-facing search output. */
  readonly secrets?: readonly (string | undefined)[];
}

/**
 * Assert the tool-disclosure contract (plan 041) against the same narrowing the
 * runtime applies: search mode only narrows (disclosed set is a subset of the
 * allow/deny-filtered input, never wider, never zero, deterministic order); a
 * denied tool is never described; the generated `search_tools` tool is always
 * kept and its output is inert — names plus byte-truncated descriptions only,
 * no JSON structure, no secret values — and activation stays disclosed beside
 * the turn top-k next turn. Fails closed: an index over the hard cap discloses
 * the full eligible list. Throws on the first violation.
 */
export function assertToolDisclosureConforms(options: ToolDisclosureConformanceOptions): void {
  const eligible = filterTools(options.tools, options.filter);
  if (eligible.length === 0) throw new Error("Disclosure conformance needs at least one eligible tool");
  const activated = createActiveToolSet();
  const topK = options.search?.topK ?? 16;
  const state = createToolSearchState({ tools: eligible, activated, search: options.search });
  const searchTool = createSearchToolsTool(state);
  const runTools = [...eligible, searchTool];
  const input = options.input ?? "zzzqqq unmatchable zero-match probe";

  // 1. Narrowing stays a subset of the eligible list and always keeps search_tools.
  const disclosed = selectDisclosedTools({ tools: runTools, input, search: options.search, activated });
  const eligibleNames = new Set(eligible.map((tool) => tool.name));
  eligibleNames.add(SEARCH_TOOLS_TOOL_NAME);
  for (const tool of disclosed) {
    if (!eligibleNames.has(tool.name)) {
      throw new Error(`Disclosed tool ${tool.name} is not in the eligible list; search must never widen`);
    }
  }
  if (!disclosed.some((tool) => tool.name === SEARCH_TOOLS_TOOL_NAME)) {
    throw new Error("Disclosed set dropped the generated search_tools tool");
  }
  if (disclosed.length === 0) throw new Error("Disclosure disclosed zero tools; fail closed to a bounded non-empty set");

  // 2. A deny-listed tool is never described to the provider.
  const deniedName = eligible[0]!.name;
  const deniedDisclosed = selectDisclosedTools({
    tools: filterTools(runTools, { deny: [deniedName] }),
    input,
    search: options.search,
    activated,
  });
  if (deniedDisclosed.some((tool) => tool.name === deniedName)) {
    throw new Error(`Denied tool ${deniedName} was described to the provider`);
  }

  // 3. Deterministic order for identical turns.
  const again = selectDisclosedTools({ tools: runTools, input, search: options.search, activated });
  if (JSON.stringify(again.map((tool) => tool.name)) !== JSON.stringify(disclosed.map((tool) => tool.name))) {
    throw new Error("Disclosure order is not deterministic for identical turns");
  }

  // 4. Fail closed past the index hard cap: full eligible list, never zero, never wider.
  const oversized = Array.from({ length: HARD_MAX_TOOLS_INDEX + 1 }, (_, index) => ({
    name: `cap_${index}`,
    description: "Fixture tool beyond the frozen index cap.",
    parameters: { type: "object", properties: {} },
    execute: (): ToolResult => ({ toolCallId: "x", name: "cap" }),
  }));
  const overflowed = selectDisclosedTools({ tools: oversized, input, search: options.search });
  if (overflowed.length !== oversized.length) {
    throw new Error(`Index overflow must disclose the full list; disclosed ${overflowed.length} of ${oversized.length}`);
  }

  // 5. search_tools output is inert: names + byte-truncated descriptions, no JSON
  //    structure, no secret values; activation bounded to the eligible set.
  const oversizedDescription = `${"padding ".repeat(160)}TAIL-MARKER-BEYOND-TRUNCATION`;
  const probeEligible = [
    ...eligible,
    {
      name: "oversized_desc_tool",
      description: oversizedDescription,
      parameters: { type: "object", properties: { untrusted: { type: "string" } } },
      execute: (): ToolResult => ({ toolCallId: "x", name: "oversized_desc_tool" }),
    },
  ];
  const probeState = createToolSearchState({ tools: probeEligible, activated, search: options.search });
  const probeTool = createSearchToolsTool(probeState);
  const probeResult = probeTool.execute({ query: "oversized_desc_tool" }, context("probe")) as ToolResult;
  if (probeResult.error) throw new Error(`search_tools rejected a valid bounded query: ${probeResult.error.message}`);
  const text = probeResult.content?.find((block) => block.type === "text");
  if (text?.type !== "text" || !text.text.startsWith("- ")) {
    throw new Error("search_tools returned no bounded name+description lines");
  }
  if (text.text.includes("TAIL-MARKER-BEYOND-TRUNCATION")) {
    throw new Error(
      "search_tools emitted an untruncated oversized description; descriptions are truncated, descriptions are never executed",
    );
  }
  if (/[{}]/.test(text.text)) {
    throw new Error("search_tools text carries JSON structure; output must be inert name+description lines only");
  }
  const activatedCount = activated.list().length;
  if (activatedCount === 0 || activatedCount > topK) throw new Error(`activation not bounded: ${activatedCount} names`);
  const probeNames = new Set(probeEligible.map((tool) => tool.name));
  for (const name of activated.list()) {
    if (!probeNames.has(name)) throw new Error(`activated ${name} is not in the eligible set`);
  }

  // 5b. Secret scan: query every eligible tool by name; configured secret values
  //     must never surface in model-facing search output even when a host
  //     description carries one.
  for (const tool of eligible) {
    const probe = probeTool.execute({ query: tool.name }, context("probe-secret")) as ToolResult;
    const probeBlob = JSON.stringify(probe);
    for (const secret of options.secrets ?? []) {
      if (secret && probeBlob.includes(secret)) {
        throw new Error("search output leaked a configured secret");
      }
    }
  }

  // 6. Activated tools stay disclosed on the next turn, beside the turn top-k.
  //    (Names outside the runtime list are inert by design — e.g. the probe's
  //    synthetic tool above — so only eligible names are asserted.)
  const nextTurn = selectDisclosedTools({
    tools: runTools,
    input: "zzzqqq unmatchable next-turn probe",
    search: options.search,
    activated,
  });
  for (const name of activated.list()) {
    if (eligibleNames.has(name) && !nextTurn.some((tool) => tool.name === name)) {
      throw new Error(`activated tool ${name} was dropped from the next turn's disclosed set`);
    }
  }
}

/** Minimal execution context for the disclosure conformance probes: no session, no store. */
function context(toolCallId: string): ToolExecutionContext {
  return { sessionId: "conformance", runId: "r", toolCallId };
}
