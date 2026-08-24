import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition } from "@arnilo/prism";
import type { WikiExtensionOptions } from "../types.js";

export const WIKI_READ_PAGE_TOOL_NAME = "wiki_read_page";

export function createWikiReadPageTool(options: WikiExtensionOptions = {}): ToolDefinition {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const absWikiRoot = resolve(workspaceRoot, wikiRoot);

  return {
    name: WIKI_READ_PAGE_TOOL_NAME,
    description: "Reads the content of a specific compiled wiki entity or decision page.",
    parameters: {
      type: "object",
      properties: {
        pagePath: {
          type: "string",
          description: "Relative path inside the wiki, e.g. 'entities/module-auth.md' or 'decisions/ADR-001.md'.",
        },
      },
      required: ["pagePath"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const pagePath = String(args.pagePath ?? "").trim();
      const sanitizedRelPath = pagePath.replace(/^[/\\]+/, "");
      const fullPath = resolve(absWikiRoot, sanitizedRelPath);

      // Verify path containment within wikiRoot
      if (!fullPath.startsWith(absWikiRoot)) {
        throw new Error(`Access denied: pagePath must reside within '${wikiRoot}'`);
      }

      try {
        const content = await readFile(fullPath, "utf8");
        return {
          toolCallId: context.toolCallId,
          name: WIKI_READ_PAGE_TOOL_NAME,
          value: {
            pagePath: sanitizedRelPath,
            found: true,
            length: content.length,
          },
          content: [
            {
              type: "text",
              text: content,
            },
          ],
          metadata: { trust: "untrusted_external", pagePath: sanitizedRelPath },
        };
      } catch {
        return {
          toolCallId: context.toolCallId,
          name: WIKI_READ_PAGE_TOOL_NAME,
          value: { pagePath: sanitizedRelPath, found: false },
          content: [
            {
              type: "text",
              text: `Page not found: ${sanitizedRelPath}`,
            },
          ],
          metadata: { trust: "untrusted_external", pagePath: sanitizedRelPath, found: false },
        };
      }
    },
  };
}
