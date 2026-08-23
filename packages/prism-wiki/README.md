# @arnilo/prism-wiki

Karpathy LLM Wiki system with local `qmd` hybrid search and Context7-style line navigation for Prism.

Importing is inert: no tools, commands, skills, or timers are registered until the host loads the extension via `kernel.load([createWikiExtension(...)])`.

## Requirements

- Peer `@arnilo/prism@^0.3.0`.
- Optional: [`@tobilu/qmd`](https://github.com/tobi/qmd) CLI installed (`npm install -g @tobilu/qmd`) for on-device BM25, vector search, and LLM reranking. Falls back to index catalog lookup if not present.

## Quick Start

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, initWiki, refreshWiki, lintWiki } from "@arnilo/prism-wiki";

const kernel = createExtensionKernel();
await kernel.load([
  createWikiExtension({
    profile: "auto", // "codebase" | "pkm" | "hybrid" | "auto"
    wikiRoot: ".wiki",
  }),
]);
```

## CLI Usage

```bash
# Initialize wiki in project
npx prism-wiki init --profile codebase

# Refresh wiki after modifying source code
npx prism-wiki refresh

# Run health check for broken links and dead anchors
npx prism-wiki lint

# Search wiki from terminal
npx prism-wiki search "How is token revocation implemented?" --mode query
```

## Key Features

- **Automated Initiation (`wiki-init` / `/wiki-init`)**: Scaffolds `.wiki/`, instantiates `SCHEMA.md`, `index.md`, and `log.md`, deploys portable `wiki-maintainer` and `wiki-searcher` skills into `.agents/skills/`, and adds the `.wiki` collection to `qmd`.
- **Incremental Maintenance (`wiki-refresh` / `/wiki-refresh`)**: Fast SHA-256 Merkle diffing detects modified files and updates affected entity pages without re-scanning unchanged files.
- **Anti-Drift Health Checks (`wiki-lint` / `/wiki-lint`)**: Detects broken `[[links]]`, dead code line anchors (`file#Lxx-Lyy`), orphan entity pages, and flags contradictions in `log.md`.
- **Context7-Inspired Search (`wiki_search`)**: Queries on-device `qmd` hybrid search and hydrates results with section breadcrumbs (`# Module > ## Architecture`) and exact clickable source line anchors (`file:///path/to/file#L45-L90`), allowing agents to inspect code directly without blind `grep`/`rg`.
- **Compounding Knowledge (`wiki_record_insight`)**: Persists synthesized answers, ADRs, and decisions back into `.wiki/decisions/` to accumulate learnings across sessions.
