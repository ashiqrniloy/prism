import { definePackage } from "@arnilo/prism";
import { asPackageCommand } from "../package-command.js";
import { createWikiIngestCommand, WIKI_INGEST_COMMAND_NAME } from "./commands/ingest.js";
import { createWikiInitCommand, initWiki } from "./commands/init.js";
import { createWikiLintCommand, lintWiki } from "./commands/lint.js";
import { createWikiRefreshCommand, refreshWiki } from "./commands/refresh.js";
import { deployWikiSkills, wikiMaintainerSkill, wikiSearcherSkill } from "./skills.js";
import { createWikiIngestTool, WIKI_INGEST_TOOL_NAME } from "./tools/ingest.js";
import { createWikiReadPageTool, WIKI_READ_PAGE_TOOL_NAME } from "./tools/read-page.js";
import { createWikiRecordInsightTool, WIKI_RECORD_INSIGHT_TOOL_NAME } from "./tools/record-insight.js";
import { createWikiSearchTool, WIKI_SEARCH_TOOL_NAME } from "./tools/search.js";
import type { WikiExtensionOptions } from "./types.js";

export {
  initWiki,
  lintWiki,
  refreshWiki,
  WIKI_INGEST_COMMAND_NAME,
  WIKI_INGEST_TOOL_NAME,
  WIKI_READ_PAGE_TOOL_NAME,
  WIKI_RECORD_INSIGHT_TOOL_NAME,
  WIKI_SEARCH_TOOL_NAME,
};
export const WIKI_INJECTOR_NAME = "wiki-guidance";

export interface WikiConfig {
  readonly wikiRoot: string;
  readonly rawRoots?: readonly string[];
  readonly profile: "codebase" | "pkm" | "hybrid" | "auto";
  readonly qmdPath: string;
  readonly workspaceRoot?: string;
  readonly autoDeploySkills: boolean;
  readonly ocrImages: boolean;
}

const CONFIG_KEYS = ["wikiRoot", "rawRoots", "profile", "qmdPath", "workspaceRoot", "autoDeploySkills", "ocrImages"] as const;

function jsonConfig(options: WikiExtensionOptions): Partial<WikiConfig> {
  const config: Partial<WikiConfig> = {};
  for (const key of CONFIG_KEYS) {
    if (options[key] !== undefined) (config as Record<string, unknown>)[key] = options[key];
  }
  return config;
}

/**
 * `extractDocument` and `fetchUrl` stay factory arguments. JSON options are the package config.
 * `wiki({ fetchUrl })` binds the hook; `packageConfig` or the same call's JSON fields fill the schema.
 */
export function wiki(options: WikiExtensionOptions = {}) {
  const code = {
    ...(options.extractDocument ? { extractDocument: options.extractDocument } : {}),
    ...(options.fetchUrl ? { fetchUrl: options.fetchUrl } : {}),
  };
  return definePackage<WikiConfig>({
    name: "@arnilo/prism-memory.wiki",
    version: "0.12.1",
    requires: { prism: "^0.12.1 || ^0.13.0-0" },
    config: {
      type: "object",
      properties: {
        wikiRoot: { type: "string", default: ".wiki" },
        rawRoots: { type: "array", items: { type: "string" } },
        profile: { type: "string", enum: ["codebase", "pkm", "hybrid", "auto"], default: "auto" },
        qmdPath: { type: "string", default: "qmd" },
        workspaceRoot: { type: "string" },
        autoDeploySkills: { type: "boolean", default: true },
        ocrImages: { type: "boolean", default: false },
      },
    },
    async setup(prism) {
      const bound: WikiExtensionOptions = { ...prism.config, ...code };
      const workspaceRoot = bound.workspaceRoot ?? process.cwd();
      if (bound.autoDeploySkills !== false) {
        try {
          await deployWikiSkills(workspaceRoot);
        } catch {
          // Non-blocking in restricted/virtual environments
        }
      }
      const tools = bound;
      prism.tools.register(createWikiSearchTool(tools));
      prism.tools.register(createWikiReadPageTool(tools));
      prism.tools.register(createWikiRecordInsightTool(tools));
      prism.tools.register(createWikiIngestTool(tools));
      for (const command of [
        createWikiInitCommand(tools),
        createWikiRefreshCommand(tools),
        createWikiLintCommand(tools),
        createWikiIngestCommand(tools),
      ]) {
        prism.commands.register(asPackageCommand(command));
      }
      prism.skills.register(wikiSearcherSkill);
      prism.skills.register(wikiMaintainerSkill);
      prism.hooks.on(
        "context.build",
        (draft) => ({
          ...draft,
          messages: [
            ...draft.messages,
            {
              id: `${WIKI_INJECTOR_NAME}:guidance`,
              role: "system" as const,
              content: [
                {
                  type: "text" as const,
                  text: "A compiled LLM Wiki is available in `.wiki/`. Use `wiki_search` to find conceptual models, architecture flows, and clickable code line references before running broad regex searches.",
                },
              ],
            },
          ],
        }),
        { id: WIKI_INJECTOR_NAME },
      );
    },
  })(jsonConfig(options));
}
