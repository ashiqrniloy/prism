#!/usr/bin/env node
import { initWiki } from "./commands/init.js";
import { lintWiki } from "./commands/lint.js";
import { refreshWiki } from "./commands/refresh.js";
import { Context7Hydrator } from "./search/context7-hydrator.js";
import { QmdClient } from "./search/qmd-client.js";
import type { SearchMode, WikiProfileType } from "./types.js";

function printHelp(): void {
  console.log(`
prism-wiki - Karpathy LLM Wiki CLI for Codebases and PKM

Usage:
  prism-wiki init [--wiki-root <dir>] [--profile <codebase|pkm|hybrid|auto>]
  prism-wiki refresh [--wiki-root <dir>]
  prism-wiki lint [--wiki-root <dir>]
  prism-wiki search "<query>" [--mode <search|vsearch|query>] [--wiki-root <dir>]
  prism-wiki help

Options:
  --wiki-root <dir>    Path to wiki directory (default: .wiki)
  --profile <profile>  Domain profile (codebase, pkm, hybrid, auto; default: auto)
  --mode <mode>        Search mode (search, vsearch, query; default: search)
  --help, -h           Show this help message
`);
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  let wikiRoot = ".wiki";
  let workspaceRoot = process.cwd();
  let profile: WikiProfileType = "auto";
  let mode: SearchMode = "search";
  let query = "";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--wiki-root" && args[i + 1]) {
      wikiRoot = args[i + 1];
      i++;
    } else if (args[i] === "--workspace-root" && args[i + 1]) {
      workspaceRoot = args[i + 1];
      i++;
    } else if (args[i] === "--profile" && args[i + 1]) {
      profile = args[i + 1] as WikiProfileType;
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[i + 1] as SearchMode;
      i++;
    } else if (!args[i].startsWith("-") && !query) {
      query = args[i];
    }
  }

  // If wikiRoot is absolute, default workspaceRoot to its parent directory if not set
  if (wikiRoot.startsWith("/") && workspaceRoot === process.cwd()) {
    workspaceRoot = wikiRoot.replace(/[/\\][^/\\]+$/, "") || "/";
  }

  try {
    switch (command) {
      case "init": {
        console.log(`Initializing LLM Wiki at ${wikiRoot}...`);
        const res = await initWiki({ wikiRoot, workspaceRoot, profile });
        console.log(`✅ Initialized LLM Wiki at '${res.wikiRoot}' (Profile: ${res.profile}). Compiled ${res.compiledEntities} entities.`);
        return 0;
      }
      case "refresh": {
        console.log(`Refreshing LLM Wiki at ${wikiRoot}...`);
        const res = await refreshWiki({ wikiRoot, workspaceRoot, profile });
        console.log(
          `🔄 Refreshed LLM Wiki. Added: ${res.delta.added.length}, Modified: ${res.delta.modified.length}, Deleted: ${res.delta.deleted.length}.`,
        );
        return 0;
      }
      case "lint": {
        console.log(`Linting LLM Wiki at ${wikiRoot}...`);
        const report = await lintWiki({ wikiRoot, workspaceRoot });
        if (report.ok) {
          console.log("✅ Wiki health check passed. No broken links or dead anchors found.");
          return 0;
        }
        console.log(
          `⚠️ Found ${report.deadAnchors.length} dead anchor(s), ${report.brokenLinks.length} broken link(s), ${report.orphans.length} orphan(s).`,
        );
        for (const da of report.deadAnchors) {
          console.log(`  - Dead anchor in ${da.entityId}: ${da.anchor.filePath}:${da.anchor.startLine} (${da.reason})`);
        }
        for (const bl of report.brokenLinks) {
          console.log(`  - Broken link in ${bl.sourceFile}: [[${bl.target}]]`);
        }
        return 1;
      }
      case "search": {
        if (!query) {
          console.error('Error: Search query required. Usage: prism-wiki search "<query>"');
          return 1;
        }
        const client = new QmdClient({ wikiRoot });
        const hydrator = new Context7Hydrator();
        const hits = await client.search(query, { mode });
        const formatted = hydrator.formatResponse(query, mode, await hydrator.hydrate(hits));
        console.log(formatted.formattedMarkdown);
        return 0;
      }
      default: {
        console.error(`Unknown command: ${command}`);
        printHelp();
        return 1;
      }
    }
  } catch (err) {
    console.error("Error executing prism-wiki command:", err);
    return 1;
  }
}

// If invoked directly from terminal
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).then((code) => {
    process.exit(code);
  });
}
