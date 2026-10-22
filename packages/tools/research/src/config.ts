import type { JsonSchema } from "@arnilo/prism";

/** Tools whose results are ledger sources. A name that is never registered is noted, not rejected. */
export const DEFAULT_SOURCE_TOOLS = ["web_fetch", "web_search", "web_extract", "browser_observe", "rag_search"] as const;

/** Query parameter names stripped before a URL is stored. */
export const DEFAULT_REDACT_QUERY = ["key", "token", "api_key", "access_token", "sig", "signature"] as const;

export const DEFAULT_MAX_REPAIRS = 1;
export const HARD_MAX_REPAIRS = 3;
export const DEFAULT_MAX_SOURCES = 500;
export const HARD_MAX_SOURCES = 5_000;

export interface ToolsResearchConfig {
  readonly sourceTools?: readonly string[];
  /** Extra model turns spent repairing unresolved citations. `0` spends none. */
  readonly maxRepairs?: number;
  /** Ledger size at which recording stops. */
  readonly maxSources?: number;
  /** A report with no `[[cite:<id>]]` markers counts as unresolved. Default false. */
  readonly requireCitations?: boolean;
  readonly redactQuery?: readonly string[];
}

const stringList = (maxItems: number): JsonSchema => ({
  type: "array",
  maxItems,
  items: { type: "string", minLength: 1, maxLength: 64 },
});

export const toolsResearchConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceTools: { ...stringList(32), default: [...DEFAULT_SOURCE_TOOLS] },
    maxRepairs: { type: "integer", minimum: 0, maximum: HARD_MAX_REPAIRS, default: DEFAULT_MAX_REPAIRS },
    maxSources: { type: "integer", minimum: 1, maximum: HARD_MAX_SOURCES, default: DEFAULT_MAX_SOURCES },
    requireCitations: { type: "boolean", default: false },
    redactQuery: { ...stringList(32), default: [...DEFAULT_REDACT_QUERY] },
  },
};
