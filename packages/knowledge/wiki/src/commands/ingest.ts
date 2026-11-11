import { type PackageCommand, UNTRUSTED_EXTERNAL_TRUST } from "@arnilo/prism";
import { MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { ingestImageBlock, ingestSource, renderIngestBrief } from "../ingest.js";
import type { WikiExtensionOptions, WikiIngestInput } from "../types.js";

export const WIKI_INGEST_COMMAND_NAME = "wiki:ingest";

function ingestInput(args: Record<string, unknown>): WikiIngestInput {
  const input: WikiIngestInput = {
    ...(typeof args.text === "string" ? { text: args.text } : {}),
    ...(typeof args.path === "string" ? { path: args.path } : {}),
    ...(typeof args.url === "string" ? { url: args.url } : {}),
    ...(typeof args.title === "string" ? { title: args.title } : {}),
  };
  const sources = [input.text !== undefined, input.path !== undefined, input.url !== undefined].filter(Boolean).length;
  if (sources !== 1) {
    throw new MemoryValidationError("Invalid input: /wiki:ingest requires exactly one of text, path, or url");
  }
  return input;
}

export function createWikiIngestCommand(options: WikiExtensionOptions = {}): PackageCommand {
  return {
    name: WIKI_INGEST_COMMAND_NAME,
    description:
      "Ingest a text/file/image/PDF/URL source: stage the immutable original and a utf8 extract under the memory root's sources/ folder, index the extract as a file note and queue it for the next concept pass. URL sources need the web.fetch service.",
    args: {
      type: "object",
      properties: {
        text: { type: "string", description: "Inline text to ingest." },
        path: { type: "string", description: "Workspace-relative path of the file to ingest." },
        url: {
          type: "string",
          description: "URL to ingest via the web.fetch service (fails closed when no package provides it).",
        },
        title: { type: "string", description: "Display title for the staged source." },
      },
      additionalProperties: false,
      // Exactly one source, enforced by the kernel's argument validator so a bad call fails closed
      // with `command_args_invalid` before this command runs.
      oneOf: [
        { type: "object", required: ["text"], additionalProperties: true },
        { type: "object", required: ["path"], additionalProperties: true },
        { type: "object", required: ["url"], additionalProperties: true },
      ],
    },
    async run(args, _context) {
      const input = ingestInput(args as Record<string, unknown>);
      const staged = await ingestSource(input, options);
      const brief = renderIngestBrief(staged);

      const stageRoot = options.port?.()?.sourceRoot();
      const image = stageRoot === undefined ? undefined : await ingestImageBlock(staged, stageRoot);
      return {
        name: WIKI_INGEST_COMMAND_NAME,
        value: { ...staged },
        content: image ? [{ type: "text", text: brief }, image] : [{ type: "text", text: brief }],
        metadata: {
          trust: UNTRUSTED_EXTERNAL_TRUST,
          ...(staged.url ? { source: staged.url } : {}),
          id: staged.id,
          rawDir: staged.rawDir,
          sourcePath: staged.sourcePath,
          extractPath: staged.extractPath,
          indexed: staged.indexed,
          ...(staged.noteId === undefined ? {} : { noteId: staged.noteId }),
          ...(staged.subject === undefined ? {} : { subject: staged.subject }),
          ...(staged.mediaType ? { mediaType: staged.mediaType } : {}),
          ...(image ? { imageEmbedded: true } : { imageEmbedded: false }),
        },
      };
    },
  };
}
