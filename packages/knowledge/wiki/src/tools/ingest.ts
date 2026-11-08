import { type ToolDefinition, UNTRUSTED_EXTERNAL_TRUST } from "@arnilo/prism";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { ingestImageBlock, ingestSource, renderIngestBrief } from "../ingest.js";
import type { WikiExtensionOptions, WikiIngestInput } from "../types.js";

export const WIKI_INGEST_TOOL_NAME = "wiki_ingest";

export function createWikiIngestTool(options: WikiExtensionOptions = {}): ToolDefinition {
  return {
    name: WIKI_INGEST_TOOL_NAME,
    description:
      "Ingests a text/file/image/PDF/URL source into the wiki (pass exactly one of text, path or url): stages the immutable original and a utf8 extract under the wiki root's sources/ folder, records it in the wiki's own store, and queues it for the next concept pass. Returns the source id to cite and an extract preview. URL sources need the web.fetch service.",
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
          description: "URL to ingest via the web.fetch service (fails closed when no package provides it).",
        },
        title: {
          type: "string",
          description: "Display title for the staged source.",
        },
      },
      // No top-level oneOf/anyOf/allOf: strict OpenAI-style gateways (OpenCode Go) refuse a root combinator with 400
      // invalid_function_parameters. "Exactly one of text, path, url" is enforced in `execute`, before anything is staged.
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
        throw new MemoryValidationError("Invalid input: wiki_ingest requires exactly one of text, path, or url");
      }

      const staged = await ingestSource(input, options, context.signal);
      const brief = renderIngestBrief(staged);
      const stageRoot = options.port?.()?.sourceRoot();
      const image = stageRoot === undefined ? undefined : await ingestImageBlock(staged, stageRoot);

      return {
        toolCallId: context.toolCallId,
        name: WIKI_INGEST_TOOL_NAME,
        value: staged,
        content: image ? [{ type: "text", text: brief }, image] : [{ type: "text", text: brief }],
        metadata: {
          trust: UNTRUSTED_EXTERNAL_TRUST,
          ...(staged.url ? { source: staged.url } : {}),
          ...(staged.mediaType ? { mediaType: staged.mediaType } : {}),
        },
      };
    },
  };
}
