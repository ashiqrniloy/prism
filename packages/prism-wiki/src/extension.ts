import type { Extension, InstructionInjector } from "@arnilo/prism";
import { createWikiInitCommand, initWiki } from "./commands/init.js";
import { createWikiLintCommand, lintWiki } from "./commands/lint.js";
import { createWikiRefreshCommand, refreshWiki } from "./commands/refresh.js";
import { deployWikiSkills, wikiMaintainerSkill, wikiSearcherSkill } from "./skills.js";
import { createWikiReadPageTool, WIKI_READ_PAGE_TOOL_NAME } from "./tools/read-page.js";
import { createWikiRecordInsightTool, WIKI_RECORD_INSIGHT_TOOL_NAME } from "./tools/record-insight.js";
import { createWikiSearchTool, WIKI_SEARCH_TOOL_NAME } from "./tools/search.js";
import type { WikiExtensionOptions } from "./types.js";

export { initWiki, lintWiki, refreshWiki, WIKI_READ_PAGE_TOOL_NAME, WIKI_RECORD_INSIGHT_TOOL_NAME, WIKI_SEARCH_TOOL_NAME };
export const WIKI_INJECTOR_NAME = "wiki-guidance";

export function createWikiExtension(options: WikiExtensionOptions = {}): Extension {
  return {
    name: "@arnilo/prism-wiki",
    async setup(api) {
      const workspaceRoot = options.workspaceRoot ?? process.cwd();

      // Auto-deploy skills to .agents/skills/ if requested
      if (options.autoDeploySkills !== false) {
        try {
          await deployWikiSkills(workspaceRoot);
        } catch {
          // Non-blocking in restricted/virtual environments
        }
      }

      // Register Tools
      const searchTool = createWikiSearchTool(options);
      const readPageTool = createWikiReadPageTool(options);
      const recordInsightTool = createWikiRecordInsightTool(options);

      api.registerTool(searchTool);
      api.registerTool(readPageTool);
      api.registerTool(recordInsightTool);

      // Register Commands: /wiki-init, /wiki-refresh, /wiki-lint
      const initCommand = createWikiInitCommand(options);
      const refreshCommand = createWikiRefreshCommand(options);
      const lintCommand = createWikiLintCommand(options);

      api.registerCommand(initCommand);
      api.registerCommand(refreshCommand);
      api.registerCommand(lintCommand);

      // Register Skills
      api.registerSkill(wikiSearcherSkill);
      api.registerSkill(wikiMaintainerSkill);

      // Register Instruction Injector for progressive context guidance
      const wikiInjector: InstructionInjector = {
        name: WIKI_INJECTOR_NAME,
        description: "Injects wiki awareness instructions when wiki is active in the workspace.",
        apply(_ctx) {
          return {
            when: "every_turn",
            instructions:
              "A compiled LLM Wiki is available in `.wiki/`. Use `wiki_search` to find conceptual models, architecture flows, and clickable code line references before running broad regex searches.",
          };
        },
      };

      api.registerInstructionInjector(wikiInjector);
    },
  };
}
