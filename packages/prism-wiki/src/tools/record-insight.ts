import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolDefinition } from "@arnilo/prism";
import type { WikiExtensionOptions } from "../types.js";

export const WIKI_RECORD_INSIGHT_TOOL_NAME = "wiki_record_insight";

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
      const title = String(args.title ?? "").trim();
      const content = String(args.content ?? "").trim();
      const category = (args.category as "decision" | "concept" | "entity") ?? "decision";

      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-");
      const folderName = category === "decision" ? "decisions" : "concepts";
      const targetDir = join(absWikiRoot, folderName);
      await mkdir(targetDir, { recursive: true });

      const fileName = `${slug}.md`;
      const filePath = join(targetDir, fileName);
      const nowIso = new Date().toISOString();

      const pageContent = `---
title: ${JSON.stringify(title)}
category: ${category}
createdAt: ${JSON.stringify(nowIso)}
---

# ${title}

${content}
`;
      await writeFile(filePath, pageContent, "utf8");

      // Append to index.md
      const indexPath = join(absWikiRoot, "index.md");
      try {
        const existingIndex = await readFile(indexPath, "utf8");
        const relLink = `- [[${folderName}/${fileName}|${title}]]: User-recorded insight`;
        const updatedIndex = existingIndex + `\n${relLink}\n`;
        await writeFile(indexPath, updatedIndex, "utf8");
      } catch {
        // Index update best-effort
      }

      // Append to log.md
      const logPath = join(absWikiRoot, "log.md");
      const logTimestamp = nowIso.replace("T", " ").slice(0, 16);
      const logEntry = `\n## [${logTimestamp}] record | Recorded ${category}: "${title}"\n- Saved to \`${folderName}/${fileName}\`.\n`;
      try {
        const existingLog = await readFile(logPath, "utf8");
        await writeFile(logPath, existingLog + logEntry, "utf8");
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
