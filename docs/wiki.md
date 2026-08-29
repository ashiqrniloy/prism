# LLM Wiki (@arnilo/prism-wiki)

## What it does

`@arnilo/prism-wiki` implements Andrej Karpathy's **LLM Wiki Pattern** for the Prism agent ecosystem. It acts as a knowledge compiler that transforms raw, immutable sources (source code, AST symbols, notes, markdown clips, transcripts, journal entries) into a persistent, compounding, cross-linked Markdown knowledge base (`.wiki/`).

It integrates Tobias Lütke's [`qmd`](https://github.com/tobi/qmd) on-device hybrid search engine (BM25, vector search, and LLM reranking) and hydrates search results with Context7-inspired hierarchical breadcrumbs (`# Category > ## Topic`) and live clickable source line anchors (`file:///path/to/file#Lxx-Lyy` format), enabling agents and humans to navigate code and notes directly without blind regex loops (`grep`/`rg`).

## When to use it

- **Codebase Knowledge Compilation**: Ingesting modules, architecture patterns, and decision records (ADRs) with exact AST and line anchors that track code drift.
- **Personal Knowledge Management (PKM)**: Ingesting research papers, meeting notes, book summaries, and journal entries into an interlinked knowledge graph.
- **Context7-Style Navigation**: Allowing agents to query concepts and immediately jump to exact file and line locations without broad repository scans.
- **Compounding Q&A**: Persisting valuable answers, analyses, and architectural comparisons back into the wiki for future sessions.

## Architecture

The Karpathy LLM Wiki pattern is structured into 3 distinct tiers:

1. **Raw Sources (Immutable)**: Source code files, design docs, transcripts, journals, and Markdown notes. Raw sources are strictly read-only and never mutated.
2. **Compiled Wiki (`.wiki/`)**: Persistent, cross-linked Markdown documents containing synthesized architecture models, entity descriptions, decision records, and line-anchored claims.
3. **Schema & Protocols (`SCHEMA.md`)**: Operational guidelines governing entity categorization, link formatting (`[[wikilink]]`), citation rules (`file:///path#Lxx-Lyy`), catalog indexing (`index.md`), and chronological change logging (`log.md`).

## Inputs / request

### `createWikiExtension(options)`

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `wikiRoot` | `string` | No | `".wiki"` | Path to the compiled wiki directory. |
| `rawRoots` | `readonly string[]` | No | `["."]` | Directories containing raw source files (code, notes, docs). |
| `profile` | `"codebase" \| "pkm" \| "hybrid" \| "auto"` | No | `"auto"` | Operating strategy for parsing and symbol indexing. |
| `qmdPath` | `string` | No | `"qmd"` | Path or executable name for the `qmd` CLI binary. |
| `workspaceRoot` | `string` | No | `process.cwd()` | Workspace root for resolving relative paths and `.agents/skills/`. |
| `autoDeploySkills` | `boolean` | No | `true` | Auto-deploys `wiki-maintainer` and `wiki-searcher` skills to `.agents/skills/` on init. |

### Tools

- `wiki_search`: `{ query: string, mode?: "search" | "vsearch" | "query", maxResults?: number }`
- `wiki_read_page`: `{ pagePath: string }` — `pagePath` must resolve inside the wiki root (lexical + `fs.realpath` containment). Traversal (sibling-prefix, `..`, absolute paths) and symlinks pointing outside the wiki throw an access-denied error; a missing contained page returns `found: false`.
- `wiki_record_insight`: `{ title: string, content: string, category?: "decision" | "concept" | "entity" }` — title and content must be non-empty; titles are capped at 200 characters, content at 65,536 bytes, and control characters/newlines in titles are collapsed to spaces so titles cannot inject Markdown headings, index entries, or log entries.

### Slash Commands

- `/wiki-init`: Scaffolds `.wiki/`, instantiates `SCHEMA.md`, `index.md`, and `log.md`, deploys skills, and adds the `qmd` collection.
- `/wiki-refresh`: Detects modified source files via SHA-256 Merkle diffing, compiles updates to affected entity pages, reconciles contradictions in `log.md`, and runs `qmd update`.
- `/wiki-lint`: Checks for broken `[[wikilinks]]`, dead line anchors, orphan pages, and unindexed symbols.

### Standalone CLI Commands

```bash
# Initialize wiki in project
npx prism-wiki init --profile codebase

# Refresh wiki after code edits
npx prism-wiki refresh

# Check wiki health and dead anchors
npx prism-wiki lint

# Search wiki from terminal
npx prism-wiki search "How does authentication work?" --mode query
```

## Outputs / response / events

- `wiki_search` returns a structured markdown payload containing section breadcrumbs, conceptual summaries, and clickable source line links (`file:///path#Lxx-Lyy`).
- Lifecycle commands return status objects (`{ status: "initialized" | "refreshed" | "clean", ok: boolean }`).

## Request/response example

### `wiki_search` Query:
```json
{
  "query": "How is authentication handled?",
  "mode": "query",
  "maxResults": 2
}
```

### Response Content:
```markdown
### Match 1: Authentication Architecture > Token Verification
- **Wiki Page:** [[entities/authentication.md]]
- **Category:** Core Module
- **Freshness:** Current (Source hash matches manifest)

**Synthesized Summary:**
The authentication layer uses asymmetric Ed25519 JWT verification in middleware, backed by a persistent token-revocation denylist stored in PostgreSQL.

**Code & Source Anchors (Clickable):**
- Token verification: `verifyToken()` (`file:///src/auth/jwt.ts#L45-L89`)
- Revocation check: `assertNotRevoked()` (`file:///src/auth/session-store.ts#L112-L138`)
- Architecture Decision: [[decisions/ADR-004-ed25519-migration.md]]
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, initWiki, refreshWiki, lintWiki } from "@arnilo/prism-wiki";

const kernel = createExtensionKernel();

const wiki = createWikiExtension({
  wikiRoot: ".wiki",
  profile: "codebase",
});

await kernel.load([wiki]);
```

## Skills and Auto-Deployment

`@arnilo/prism-wiki` includes two specialized skills formatted according to `.agents/skills/skill-creator`:

1. **`wiki-maintainer`**: Ingestion, compilation, line-anchor validation, and contradiction reconciliation rules.
2. **`wiki-searcher`**: Context7 hierarchical breadcrumb query resolution, zero-grep instructions, and compounding insight recording.

When initialized (`wiki-init` or `createWikiExtension`), these skills are automatically deployed to the host workspace's `.agents/skills/` folder so any compatible agent can leverage them immediately.

## Extension and configuration notes

- `@arnilo/prism-wiki` registers tools (`wiki_search`, `wiki_read_page`, `wiki_record_insight`), commands (`wiki-init`, `wiki-refresh`, `wiki-lint`), skills (`wiki-maintainer`, `wiki-searcher`), and instruction injectors (`wiki-guidance`) into Prism registries.
- It operates with zero core modifications and can be used with any `@arnilo/prism` agent.
- `qmd` is optional but recommended. When `@tobilu/qmd` is not installed, the search engine falls back to catalog matching against `index.md`.

## Security and performance notes

- **Source Immutability**: Raw source files are read-only and never modified by wiki operations.
- **Subprocess Safety**: All `qmd` subprocess calls use argument arrays (`execFile`) to prevent shell injection.
- **Path Containment**: Wiki and raw source paths are confined to the workspace root; directory traversal (`../`) is rejected.
- **Bounded Token Consumption**: Incremental Merkle hashing ensures only modified files and 1-hop dependent wiki pages are processed during refresh passes.

## Related APIs

- [`@arnilo/prism-rag`](rag.md): Bounded document chunking and vector context injection.
- [`@arnilo/prism-memory`](working-and-semantic-memory.md): Embedder and VectorStore primitives.
- [`@arnilo/prism-coding-agent`](coding-agent-tools.md): Code manipulation and reading tools.
- [`Contribution registries`](contribution-registries.md): Extension contribution model.
