import type { CommandDefinition } from "@arnilo/prism";
import { WikiCompiler } from "../engine/compiler.js";
import { scaffoldWiki } from "../engine/scaffolder.js";
import { QmdClient } from "../search/qmd-client.js";
import { deployWikiSkills } from "../skills.js";
import type { WikiExtensionOptions, WikiManifest } from "../types.js";

export interface InitWikiResult {
  readonly status: "initialized";
  readonly wikiRoot: string;
  readonly profile: string;
  readonly createdFiles: readonly string[];
  readonly compiledEntities: number;
  readonly manifest: WikiManifest;
}

export async function initWiki(options: WikiExtensionOptions = {}): Promise<InitWikiResult> {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const profile = options.profile ?? "auto";

  // 1. Deploy skills to .agents/skills/ if requested
  if (options.autoDeploySkills !== false) {
    try {
      await deployWikiSkills(workspaceRoot);
    } catch {
      // Non-blocking
    }
  }

  // 2. Scaffold .wiki structure
  const scaffoldResult = await scaffoldWiki({
    wikiRoot,
    rawRoots: options.rawRoots,
    profile,
  });

  // 3. Add collection to qmd if available
  const qmdClient = new QmdClient({
    qmdPath: options.qmdPath,
    wikiRoot,
    workspaceRoot,
  });
  await qmdClient.collectionAdd(wikiRoot, "prism-wiki");

  // 4. Run initial compilation
  const compiler = new WikiCompiler();
  const compileResult = await compiler.compile({
    workspaceRoot,
    wikiRoot,
    rawRoots: options.rawRoots,
    profile: scaffoldResult.profile,
  });

  return {
    status: "initialized",
    wikiRoot,
    profile: scaffoldResult.profile,
    createdFiles: scaffoldResult.createdFiles,
    compiledEntities: compileResult.compiledEntities.length,
    manifest: compileResult.manifest,
  };
}

export function createWikiInitCommand(options: WikiExtensionOptions = {}): CommandDefinition {
  return {
    name: "wiki-init",
    description: "Scaffold and initialize the compiled LLM Wiki knowledge base in the workspace.",
    parameters: {
      type: "object",
      properties: {
        profile: {
          type: "string",
          enum: ["codebase", "pkm", "hybrid", "auto"],
          description: "Operating profile (defaults to 'auto').",
        },
      },
      additionalProperties: false,
    },
    async execute(args, _context) {
      const profile = (args.profile as WikiExtensionOptions["profile"]) ?? options.profile ?? "auto";
      const res = await initWiki({ ...options, profile });

      return {
        name: "wiki-init",
        value: res,
        content: [
          {
            type: "text",
            text: `✅ Initialized LLM Wiki at \`${res.wikiRoot}\` (Profile: \`${res.profile}\`, Compiled entities: ${res.compiledEntities}). Skills deployed to \`.agents/skills/\`.`,
          },
        ],
        metadata: { trust: "untrusted_external", wikiRoot: res.wikiRoot },
      };
    },
  };
}
