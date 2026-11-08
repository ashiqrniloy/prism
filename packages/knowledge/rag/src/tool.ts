/**
 * The `rag_search` tool (plan 158 Task 3): one model-driven retrieval call over the configured
 * sources. Read-only, so it declares `effects: ["read"]`; the retrieved text carries the same
 * `untrusted` / `inert` / `injectionCapable` trust metadata the retrieval seam stamps.
 *
 * Registered without a `when`, so it is always visible: the cost is one embedding call per call,
 * never per turn — a turn that does not call it makes no retrieval and no embedding request.
 */
import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";

import type { RagContextResult } from "./types.js";

export interface RagSearchToolOptions {
  readonly name?: string;
  /** Called with the query and the call signal; performs the lazy index and one retrieval. */
  readonly retrieve: (query: string, signal?: AbortSignal) => Promise<RagContextResult>;
}

export function createRagSearchTool(options: RagSearchToolOptions): ToolDefinition {
  const name = options.name ?? "rag_search";
  return {
    name,
    description: "Search the indexed knowledge sources and return the matching passages with citations.",
    effects: ["read"],
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
      },
      required: ["query"],
    } as JsonObject,
    async execute(args, context): Promise<ToolResult> {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          toolCallId: context.toolCallId,
          name,
          value: { query: "", text: "", citations: [], truncated: false, reason: "empty_query" },
          content: [{ type: "text", text: "Provide a non-empty query." }],
        };
      }
      const result = await options.retrieve(query, context.signal);
      return {
        toolCallId: context.toolCallId,
        name,
        value: {
          query: result.query,
          text: result.text,
          trust: result.trust,
          truncated: result.truncated,
          citations: result.citations,
          hits: result.hits.map((hit) => ({
            citationId: hit.citationId,
            sourceId: hit.sourceId,
            chunkId: hit.id,
            score: hit.score,
            text: hit.text,
          })),
        },
        content: [{ type: "text", text: result.text || "No indexed passage matched the query." }],
      };
    },
  };
}
