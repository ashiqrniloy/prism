import type { ToolDefinition } from "@arnilo/prism";
import { ingestImageBlock, ingestOptionsFrom, ingestWikiSource, renderIngestBrief } from "../ingest.js";
import type { WikiExtensionOptions, WikiIngestInput } from "../types.js";

export const WIKI_INGEST_TOOL_NAME = "wiki_ingest";

export function createWikiIngestTool(options: WikiExtensionOptions = {}): ToolDefinition {
  const ingestOptions = ingestOptionsFrom(options);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  return {
    name: WIKI_INGEST_TOOL_NAME,
    description:
      "Stages a text/file/image/PDF/URL source into the wiki raw layer (immutable original + utf8 extract) and returns a filing brief. URL sources need a host fetchUrl hook. Follow the brief to file the knowledge into `.wiki/` pages.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Inline text to ingest.",
        },
        path: {
          type: "string",
          description: "Workspace-relative path of the file to ingest.",
        },
        url: {
          type: "string",
          format: "uri",
          description: "URL to ingest via the host fetchUrl hook (fails closed when the host ships none).",
        },
        title: {
          type: "string",
          description: "Display title for the staged source.",
        },
      },
      additionalProperties: false,
    },
    async execute(args, context) {
      const record = args as Record<string, unknown>;
      const input: WikiIngestInput = {
        ...(typeof record.text === "string" ? { text: record.text } : {}),
        ...(typeof record.path === "string" ? { path: record.path } : {}),
        ...(typeof record.url === "string" ? { url: record.url } : {}),
        ...(typeof record.title === "string" ? { title: record.title } : {}),
      };
      const sources = [input.text !== undefined, input.path !== undefined, input.url !== undefined].filter(Boolean).length;
      if (sources !== 1) {
        throw new Error("Invalid input: wiki_ingest requires exactly one of text, path, or url");
      }

      const staged = await ingestWikiSource(input, ingestOptions);
      const brief = renderIngestBrief(staged);
      const image = await ingestImageBlock(staged, workspaceRoot);

      return {
        toolCallId: context.toolCallId,
        name: WIKI_INGEST_TOOL_NAME,
        value: staged,
        content: image ? [{ type: "text", text: brief }, image] : [{ type: "text", text: brief }],
        metadata: {
          trust: "untrusted_external",
          ...(staged.mediaType ? { mediaType: staged.mediaType } : {}),
        },
      };
    },
  };
}
