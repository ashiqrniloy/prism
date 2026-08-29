import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolDefinition } from "@arnilo/prism";
import { OKF_TYPE_BY_CATEGORY, prependLog, renderConceptFrontmatter, wikiActor, wikiDate } from "../engine/okf.js";
import type { WikiExtensionOptions } from "../types.js";

export const WIKI_RECORD_INSIGHT_TOOL_NAME = "wiki_record_insight";

const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_BYTES = 65_536;

/** Single display line: control chars and newlines become spaces so titles cannot inject headings/index/log entries. */
function toSingleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

export function createWikiRecordInsightTool(options: WikiExtensionOptions = {}): ToolDefinition {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const absWikiRoot = resolve(workspaceRoot, wikiRoot);

  return {
    name: WIKI_RECORD_INSIGHT_TOOL_NAME,
    description: "Appends a newly discovered insight, architectural decision, or synthesized answer back into the compiled wiki.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the insight or decision.",
        },
        content: {
          type: "string",
          description: "Markdown content to record.",
        },
        category: {
          type: "string",
          enum: ["decision", "concept", "entity"],
          description: "Category for filing the insight (defaults to 'decision').",
        },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const content = String(args.content ?? "").trim();
      const category = (args.category as "decision" | "concept" | "entity") ?? "decision";

      if (!content) {
        throw new Error("Invalid input: content must be a non-empty string");
      }
      if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
        throw new Error(`Invalid input: content exceeds ${MAX_CONTENT_BYTES} bytes`);
      }

      const title = toSingleLine(String(args.title ?? "").trim());
      if (!title) {
        throw new Error("Invalid input: title must be a non-empty string");
      }
      if (title.length > MAX_TITLE_CHARS) {
        throw new Error(`Invalid input: title exceeds ${MAX_TITLE_CHARS} characters`);
      }

      const slug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || "untitled";
      const folderName = category === "decision" ? "decisions" : "concepts";
      const targetDir = join(absWikiRoot, folderName);
      await mkdir(targetDir, { recursive: true });

      const fileName = `${slug}.md`;
      const filePath = join(targetDir, fileName);
      const nowIso = new Date().toISOString();

      const pageContent = `${renderConceptFrontmatter({
        type: OKF_TYPE_BY_CATEGORY[category],
        title,
        description: title,
        tags: [category],
        sources: [],
        generatedBy: wikiActor(),
        generatedAt: nowIso,
      })}

# ${title}

${content}
`;
      await writeFile(filePath, pageContent, "utf8");

      const indexPath = join(absWikiRoot, "index.md");
      try {
        const existingIndex = await readFile(indexPath, "utf8");
        const relLink = `* [${title}](${folderName}/${fileName}) - User-recorded insight`;
        await writeFile(indexPath, `${existingIndex.trimEnd()}\n${relLink}\n`, "utf8");
      } catch {
        // Index update best-effort
      }

      const logPath = join(absWikiRoot, "log.md");
      try {
        const existingLog = await readFile(logPath, "utf8");
        await writeFile(
          logPath,
          prependLog(existingLog, wikiDate(nowIso), [
            { verb: "Recorded", text: `Recorded ${category} "${title}" in \`${folderName}/${fileName}\`.` },
          ]),
          "utf8",
        );
      } catch {
        // Log update best-effort
      }

      return {
        toolCallId: context.toolCallId,
        name: WIKI_RECORD_INSIGHT_TOOL_NAME,
        value: {
          recorded: true,
          title,
          category,
          path: `${wikiRoot}/${folderName}/${fileName}`,
        },
        content: [
          {
            type: "text",
            text: `Successfully recorded ${category} "${title}" in \`${wikiRoot}/${folderName}/${fileName}\` and updated index.`,
          },
        ],
        metadata: { trust: "untrusted_external", path: `${folderName}/${fileName}` },
      };
    },
  };
}
