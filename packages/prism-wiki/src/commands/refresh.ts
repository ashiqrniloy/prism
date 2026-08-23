import type { CommandDefinition } from "@arnilo/prism";
import { WikiCompiler } from "../engine/compiler.js";
import { QmdClient } from "../search/qmd-client.js";
import type { SourceDelta, WikiEntityMetadata, WikiExtensionOptions, WikiManifest } from "../types.js";

export interface RefreshWikiResult {
  readonly status: "refreshed";
  readonly wikiRoot: string;
  readonly delta: SourceDelta;
  readonly compiledEntities: readonly WikiEntityMetadata[];
  readonly manifest: WikiManifest;
}

export async function refreshWiki(options: WikiExtensionOptions = {}): Promise<RefreshWikiResult> {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  // 1. Run incremental compilation
  const compiler = new WikiCompiler();
  const compileResult = await compiler.compile({
    workspaceRoot,
    wikiRoot,
    rawRoots: options.rawRoots,
    profile: options.profile,
  });

  // 2. Trigger qmd update
  const qmdClient = new QmdClient({
    qmdPath: options.qmdPath,
    wikiRoot,
    workspaceRoot,
  });
  await qmdClient.update();

  return {
    status: "refreshed",
    wikiRoot,
    delta: compileResult.delta,
    compiledEntities: compileResult.compiledEntities,
    manifest: compileResult.manifest,
  };
}

export function createWikiRefreshCommand(options: WikiExtensionOptions = {}): CommandDefinition {
  return {
    name: "wiki-refresh",
    description: "Perform incremental compilation on modified source files and update the wiki index.",
    async execute(args, context) {
      const res = await refreshWiki(options);
      const delta = res.delta;

      return {
        name: "wiki-refresh",
        value: res,
        content: [
          {
            type: "text",
            text: `🔄 Refreshed LLM Wiki at \`${res.wikiRoot}\` (Added: ${delta.added.length}, Modified: ${delta.modified.length}, Deleted: ${delta.deleted.length}, Affected entities: ${delta.affectedEntities.length}).`,
          },
        ],
        metadata: { trust: "untrusted_external", wikiRoot: res.wikiRoot },
      };
    },
  };
}
