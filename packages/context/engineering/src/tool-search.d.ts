import { type Message, type ToolDefinition, type ToolFilterInput } from "@arnilo/prism";
/** Same shape as `AgentInput`; kept structural here so core's assembler and this module never form a runtime cycle. */
type ToolSearchInput = string | Message | readonly Message[];
export type ToolsDisclosure = "all" | "search";
export interface ToolsSearchOptions {
    /** Top-k tools disclosed per turn. Default 16; clamped to the hard cap. */
    readonly topK?: number;
}
export declare const SEARCH_TOOLS_TOOL_NAME = "search_tools";
export declare const DEFAULT_TOOLS_SEARCH_TOP_K = 16;
export declare const HARD_MAX_TOOLS_SEARCH_TOP_K = 64;
/** Frozen index cap; larger registries fail closed to full disclosure. */
export declare const HARD_MAX_TOOLS_INDEX = 1024;
export declare const DEFAULT_MAX_TOOLS_SEARCH_QUERY_BYTES = 4096;
export declare const HARD_MAX_TOOLS_SEARCH_QUERY_BYTES = 65536;
export declare const TOOL_DISCLOSURE_ERROR_CODE: "tool_disclosure_exceeded";
export declare class ToolDisclosureError extends Error {
    readonly code: "tool_disclosure_exceeded";
    constructor(message: string);
}
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export declare function isToolDisclosureError(error: unknown): error is ToolDisclosureError;
/** Run options win over agent config (mirrors resolveSkillsDisclosure); default "all".
 *  @deprecated No replacement: nothing reads it since the 0.13 split. Removed at the next breaking
 *  cut (docs/_evidence/dead-export-verification-2026-09-03.md). */
export declare function resolveToolsDisclosure(run?: ToolsDisclosure, agent?: ToolsDisclosure): ToolsDisclosure;
/** Activation set: same shape as LoadedSkillSet (names-only persistence, per-session instance). */
export interface ActiveToolSet {
    has(name: string): boolean;
    add(name: string): void;
    list(): readonly string[];
    clear(): void;
}
export declare function createActiveToolSet(): ActiveToolSet;
interface PostingEntry {
    readonly toolIndex: number;
    tf: number;
}
export interface ToolSearchIndex {
    readonly tools: readonly ToolDefinition[];
    readonly postings: ReadonlyMap<string, PostingEntry[]>;
}
/** ponytail: O(n·d) lexical index, rebuilt on registry change by the caller — embedder-backed
 *  scoring via the @arnilo/prism-memory-rag seam if accuracy fixtures fall short (plan 041). */
export declare function createToolSearchIndex(tools: readonly ToolDefinition[], skip?: (tool: ToolDefinition) => boolean): ToolSearchIndex;
export interface ToolSearchMatch {
    readonly name: string;
    readonly description?: string;
    /** Query terms present in name/description, most significant first. */
    readonly matched: readonly string[];
}
/** Bounded lexical scoring: BM25-lite (tf × IDF, registry-derived DF). Ties keep registry order. */
export declare function scoreTools(index: ToolSearchIndex, query: string, k: number, queryByteCap?: number): readonly ToolSearchMatch[];
export interface ToolSearchState {
    readonly index: ToolSearchIndex;
    readonly activated: ActiveToolSet;
    readonly topK: number;
}
export declare function createToolSearchState(options: {
    readonly tools: readonly ToolDefinition[];
    readonly activated: ActiveToolSet;
    readonly search?: ToolsSearchOptions;
}): ToolSearchState;
/** Provider-facing narrowing: activated tools ∪ top-k for the turn. Fails closed — any
 *  scoring/index error discloses the full input list (never zero, never wider than input). */
export declare function selectDisclosedTools(options: {
    readonly tools: readonly ToolDefinition[];
    readonly input: ToolSearchInput;
    readonly queryByteCap?: number;
    readonly search?: ToolsSearchOptions;
    readonly activated?: {
        has(name: string): boolean;
    };
}): readonly ToolDefinition[];
/** Model-facing activation tool, generated only in search mode. Results are inert
 *  name+description lines — no schemas or bodies — and activation re-checks allow/deny
 *  at dispatch time (blocked-reason matrix unchanged). */
export declare function createSearchToolsTool(state: ToolSearchState, queryByteCap?: number): ToolDefinition;
export interface ToolDisclosureConformanceOptions {
    /** Host-active tool definitions; may include schema-bearing and oversized-description tools. */
    readonly tools: readonly ToolDefinition[];
    /** Host allow/deny bounds applied before disclosure (same input the runtime narrows). */
    readonly filter?: ToolFilterInput;
    /** Search options under test (topK). */
    readonly search?: {
        readonly topK?: number;
    };
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
export declare function assertToolDisclosureConforms(options: ToolDisclosureConformanceOptions): void;
export {};
