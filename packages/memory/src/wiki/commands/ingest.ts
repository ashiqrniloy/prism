import type { CommandDefinition } from "@arnilo/prism";
import { ingestImageBlock, ingestOptionsFrom, ingestWikiSource, renderIngestBrief } from "../ingest.js";
import type { WikiExtensionOptions, WikiIngestInput } from "../types.js";

export const WIKI_INGEST_COMMAND_NAME = "wiki-ingest";

function ingestInput(args: Record<string, unknown>): WikiIngestInput {
  const input: WikiIngestInput = {
    ...(typeof args.text === "string" ? { text: args.text } : {}),
    ...(typeof args.path === "string" ? { path: args.path } : {}),
    ...(typeof args.url === "string" ? { url: args.url } : {}),
    ...(typeof args.title === "string" ? { title: args.title } : {}),
  };
  const sources = [input.text !== undefined, input.path !== undefined, input.url !== undefined].filter(Boolean).length;
  if (sources !== 1) {
    throw new Error("Invalid input: /wiki-ingest requires exactly one of text, path, or url");
  }
  return input;
}

export function createWikiIngestCommand(options: WikiExtensionOptions = {}): CommandDefinition {
  const ingestOptions = ingestOptionsFrom(options);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  return {
    name: WIKI_INGEST_COMMAND_NAME,
    description:
      "Stage a text/file/image/PDF/URL source into the wiki raw layer (immutable original + utf8 extract) and produce a filing brief for the wiki-maintainer skill. URL sources need a host fetchUrl hook.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Inline text to ingest." },
        path: { type: "string", description: "Workspace-relative path of the file to ingest." },
        url: {
          type: "string",
          format: "uri",
          description: "URL to ingest via the host fetchUrl hook (fails closed when the host ships none).",
        },
        title: { type: "string", description: "Display title for the staged source." },
      },
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = ingestInput(args as Record<string, unknown>);
      const staged = await ingestWikiSource(input, ingestOptions);
      const brief = renderIngestBrief(staged);

      // Automatic filing = host agent following the wiki-maintainer skill. Drivers are
      // host-opt-in; without them the command is stage-only (never throws).
      let runStarted = false;
      if (context.drivers?.startRun) {
        await context.drivers.startRun(brief, { activeSkills: ["wiki-maintainer"] });
        runStarted = true;
      }

      const image = await ingestImageBlock(staged, workspaceRoot);
      return {
        name: WIKI_INGEST_COMMAND_NAME,
        value: { ...staged, runStarted },
        content: image ? [{ type: "text", text: brief }, image] : [{ type: "text", text: brief }],
        metadata: {
          trust: "untrusted_external",
          id: staged.id,
          rawDir: staged.rawDir,
          sourcePath: staged.sourcePath,
          extractPath: staged.extractPath,
          ...(staged.mediaType ? { mediaType: staged.mediaType } : {}),
          ...(image ? { imageEmbedded: true } : { imageEmbedded: false }),
        },
      };
    },
  };
}
