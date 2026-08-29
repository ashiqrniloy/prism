import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolDefinition } from "@arnilo/prism";
import type { WikiExtensionOptions } from "../types.js";

export const WIKI_READ_PAGE_TOOL_NAME = "wiki_read_page";

/** Separator-aware containment: rejects `..`, absolute results, and sibling prefixes like `..foo`. */
function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

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

      // Lexical containment first: blocks `..`, absolute paths, and sibling prefixes before any I/O.
      if (!isContained(absWikiRoot, fullPath)) {
        throw new Error(`Access denied: pagePath must reside within '${wikiRoot}'`);
      }

      let realRoot: string;
      try {
        realRoot = await realpath(absWikiRoot);
      } catch {
        // Wiki root itself missing/unreadable: fail closed, nothing can be contained.
        throw new Error(`Access denied: wiki root '${wikiRoot}' is unavailable`);
      }

      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
        throw error;
      }

      // Realpath containment: a successful read through a symlink pointing outside is still denied.
      const realPath = await realpath(fullPath);
      if (!isContained(realRoot, realPath)) {
        throw new Error(`Access denied: pagePath must reside within '${wikiRoot}'`);
      }

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
    },
  };
}
