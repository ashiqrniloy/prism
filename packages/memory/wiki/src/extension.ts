import { definePackage, type PackageAPI, type PackageInstance } from "@arnilo/prism";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import type { WebFetchService } from "@arnilo/prism-tools-web";
import manifest from "../package.json" with { type: "json" };
import { createWikiIngestCommand, WIKI_INGEST_COMMAND_NAME } from "./commands/ingest.js";
import { createWikiInitCommand, initWiki } from "./commands/init.js";
import { createWikiLintCommand, lintWiki } from "./commands/lint.js";
import { createWikiRefreshCommand, refreshWiki } from "./commands/refresh.js";
import { deployWikiSkills, resolvePackageSkillsDir } from "./skills.js";
import { createWikiIngestTool, WIKI_INGEST_TOOL_NAME } from "./tools/ingest.js";
import { createWikiReadPageTool, WIKI_READ_PAGE_TOOL_NAME } from "./tools/read-page.js";
import { createWikiRecordInsightTool, WIKI_RECORD_INSIGHT_TOOL_NAME } from "./tools/record-insight.js";
import { createWikiSearchTool, WIKI_SEARCH_TOOL_NAME } from "./tools/search.js";
import type { WikiExtensionOptions, WikiIngestFetch, WikiIngestUrlHookInput, WikiProfileType } from "./types.js";

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

/** The `web.fetch` service the wiki consumes for `url` ingest. The wiki never fetches on its own. */
export const WEB_FETCH_SERVICE = "web.fetch";

/** JSON config for `@arnilo/prism-memory-wiki`; `setup` applies the defaults below. */
export interface WikiConfig {
  readonly wikiRoot?: string;
  readonly rawRoots?: readonly string[];
  readonly profile?: WikiProfileType;
  readonly qmdPath?: string;
  readonly workspaceRoot?: string;
  /** Keep the 0.12 workspace skill deploy into `.agents/skills/`. Writes files. Default `false`. */
  readonly autoDeploySkills?: boolean;
}

/** {@link WikiConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedWikiConfig {
  readonly wikiRoot: string;
  readonly rawRoots?: readonly string[];
  readonly profile: WikiProfileType;
  readonly qmdPath: string;
  readonly workspaceRoot: string;
  readonly autoDeploySkills: boolean;
}

export function resolveWikiConfig(config: WikiConfig | undefined, workspaceRoot: string): ResolvedWikiConfig {
  return {
    wikiRoot: config?.wikiRoot ?? ".wiki",
    ...(config?.rawRoots === undefined ? {} : { rawRoots: config.rawRoots }),
    profile: config?.profile ?? "auto",
    qmdPath: config?.qmdPath ?? "qmd",
    workspaceRoot: config?.workspaceRoot ?? workspaceRoot,
    autoDeploySkills: config?.autoDeploySkills === true,
  };
}

/**
 * Maps the `web.fetch` service onto the wiki's fetch seam.
 *
 * The service is resolved per call: a package that provides `web.fetch` may load after this one, so a
 * setup-time lookup would miss it. A missing service fails the `url` ingest closed with a named error.
 */
export function createWebFetchHook(prism: PackageAPI<WikiConfig>): (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null> {
  return async ({ url }) => {
    const service = prism.services.consume<WebFetchService>(WEB_FETCH_SERVICE);
    if (!service) {
      throw new MemoryValidationError(
        `ingest url requires the ${WEB_FETCH_SERVICE} service — no loaded package provides it, and the wiki package never fetches itself`,
      );
    }
    const document = await service.fetch(url);
    return { text: document.markdown, filename: filenameFromUrl(url) };
  };
}

/** Staged filename for a fetched URL: the pathname's extension wins (`doc.pdf`), else `source.md`. */
function filenameFromUrl(url: string): string | undefined {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return base && /\.[A-Za-z0-9]+$/.test(base) ? base.slice(0, 128) : undefined;
  } catch {
    return undefined;
  }
}

export const definition = definePackage<WikiConfig>({
  name: "@arnilo/prism-memory-wiki",
  version: manifest.version,
  description: "The LLM Wiki knowledge compiler: wiki tools, four commands, bundled skills, and the prism-wiki CLI.",
  requires: { api: 1 },
  config: {
    type: "object",
    properties: {
      wikiRoot: { type: "string", default: ".wiki" },
      rawRoots: { type: "array", items: { type: "string" } },
      profile: { type: "string", enum: ["codebase", "pkm", "hybrid", "auto"], default: "auto" },
      qmdPath: { type: "string", default: "qmd" },
      workspaceRoot: { type: "string" },
      autoDeploySkills: { type: "boolean", default: false },
    },
  },
  async setup(prism) {
    const config = resolveWikiConfig(prism.config, process.cwd());

    // The 0.12 workspace deploy stays opt-in: `addDir` ships the skills from the package, and only
    // `autoDeploySkills: true` writes into the workspace's `.agents/skills/`.
    if (config.autoDeploySkills) {
      await deployWikiSkills(config.workspaceRoot).catch(() => {
        // Non-blocking in restricted/virtual environments
      });
    }

    const bound: WikiExtensionOptions = {
      ...config,
      fetchUrl: createWebFetchHook(prism),
    };
    prism.tools.register(createWikiSearchTool(bound));
    prism.tools.register(createWikiReadPageTool(bound));
    prism.tools.register(createWikiRecordInsightTool(bound));
    prism.tools.register(createWikiIngestTool(bound));
    for (const command of [
      createWikiInitCommand(bound),
      createWikiRefreshCommand(bound),
      createWikiLintCommand(bound),
      createWikiIngestCommand(bound),
    ]) {
      prism.commands.register(command);
    }
    prism.skills.addDir(resolvePackageSkillsDir());
    if (prism.services.consume<WebFetchService>(WEB_FETCH_SERVICE) === undefined) {
      prism.status.note("warn", `wiki: no ${WEB_FETCH_SERVICE} service; wiki_ingest url inputs fail closed until one is provided`);
    }
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
});

/** The package with config baked in, for `packages: [memoryWiki({ wikiRoot })]`. */
export function memoryWiki(config?: WikiConfig): PackageInstance {
  return definition(config);
}
