import { resolve } from "node:path";
import type { ToolDefinition } from "@arnilo/prism";
import { loadManifest } from "../manifest.js";
import { Context7Hydrator } from "../search/context7-hydrator.js";
import { QmdClient } from "../search/qmd-client.js";
import type { SearchMode, WikiExtensionOptions } from "../types.js";

export const WIKI_SEARCH_TOOL_NAME = "wiki_search";

export function createWikiSearchTool(options: WikiExtensionOptions = {}): ToolDefinition {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const qmdClient = new QmdClient({
    qmdPath: options.qmdPath,
    wikiRoot,
    workspaceRoot,
  });
  const hydrator = new Context7Hydrator(workspaceRoot);

  return {
    name: WIKI_SEARCH_TOOL_NAME,
    description:
      "Searches the compiled LLM Wiki for pre-synthesized concepts, architecture designs, entity relationships, and decisions. " +
      "Returns structured sections with hierarchical breadcrumbs and clickable source file/line anchors, eliminating blind grep/rg.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The conceptual, architectural, or domain question to search in the wiki.",
        },
        mode: {
          type: "string",
          enum: ["search", "vsearch", "query"],
          description:
            "Search mode: 'search' (fast BM25), 'vsearch' (semantic vector), or 'query' (hybrid + LLM reranking). Defaults to 'search'.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of sections to return (default: 4).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const query = String(args.query ?? "");
      const mode = (args.mode as SearchMode) ?? "search";
      const maxResults = typeof args.maxResults === "number" ? args.maxResults : 4;

      const absWikiRoot = resolve(workspaceRoot, wikiRoot);
      const rawHits = await qmdClient.search(query, { mode, maxResults });
      const manifest = await loadManifest(absWikiRoot);
      const hydratedHits = await hydrator.hydrate(rawHits, manifest);
      const formatted = hydrator.formatResponse(query, mode, hydratedHits);

      return {
        toolCallId: context.toolCallId,
        name: WIKI_SEARCH_TOOL_NAME,
        value: {
          query,
          mode,
          hitCount: hydratedHits.length,
          hits: hydratedHits,
        },
        content: [
          {
            type: "text",
            text: formatted.formattedMarkdown,
          },
        ],
        metadata: {
          trust: "untrusted_external",
          wikiRoot,
          mode,
          isQmdBacked: true,
        },
      };
    },
  };
}
