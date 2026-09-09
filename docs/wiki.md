# LLM Wiki (@arnilo/prism-memory/wiki)

## What it does

The `@arnilo/prism-memory/wiki` subpath implements Andrej Karpathy's **LLM Wiki Pattern** for the Prism agent ecosystem. It acts as a knowledge compiler that transforms raw, immutable sources (source code, AST symbols, notes, markdown clips, transcripts, journal entries) into a persistent, compounding, cross-linked Markdown knowledge base (`.wiki/`).

It integrates Tobias Lütke's [`qmd`](https://github.com/tobi/qmd) on-device hybrid search engine (BM25, vector search, and LLM reranking) and hydrates search results with Context7-inspired hierarchical breadcrumbs (`# Category > ## Topic`) and live clickable source line anchors (`file:///path/to/file#Lxx-Lyy` format), enabling agents and humans to navigate code and notes directly without blind regex loops (`grep`/`rg`).

## When to use it

- **Codebase Knowledge Compilation**: Ingesting modules, architecture patterns, and decision records (ADRs) with exact AST and line anchors that track code drift.
- **Personal Knowledge Management (PKM)**: Ingesting research papers, meeting notes, book summaries, and journal entries into an interlinked knowledge graph.
- **Context7-Style Navigation**: Allowing agents to query concepts and immediately jump to exact file and line locations without broad repository scans.
- **Compounding Q&A**: Persisting valuable answers, analyses, and architectural comparisons back into the wiki for future sessions.

## Architecture

The Karpathy LLM Wiki pattern is structured into 3 distinct tiers:

1. **Raw Sources (Immutable)**: Source code files, design docs, transcripts, journals, and Markdown notes. Raw sources are strictly read-only and never mutated. New external material arrives through the ingest staging area (`raw/ingest/<utc>-<slug>/`): an immutable `source.*` original plus a UTF-8 `extract.md` the maintainer skill files into the wiki.
2. **Compiled Wiki (`.wiki/`)**: Persistent, cross-linked Markdown documents containing synthesized architecture models, entity descriptions, decision records, and line-anchored claims.
3. **Schema & Protocols (`SCHEMA.md`)**: Operational guidelines governing OKF v0.2 emission, entity categorization, citation rules (`file:///path#Lxx-Lyy`), catalog indexing (`index.md`), and chronological change logging (`log.md`).

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
- `wiki_ingest`: `{ text?: string, path?: string, url?: string, title?: string }` — stages one raw source and returns a filing brief for the `wiki-maintainer` skill (see `/wiki-ingest` below). Exactly one of `text`/`path`/`url` must be provided; `url` requires a host `fetchUrl` hook.

### Slash Commands

- `/wiki-init`: Scaffolds `.wiki/`, instantiates `SCHEMA.md`, `index.md`, and `log.md`, deploys skills, and adds the `qmd` collection.
- `/wiki-refresh`: Detects modified source files via SHA-256 Merkle diffing, compiles updates to affected entity pages, reconciles contradictions in `log.md`, and runs `qmd update`.
- `/wiki-lint`: Checks OKF frontmatter (`type`, ISO `generated.at`), leftover `[[wikilinks]]`, unresolved relative markdown links, dead line anchors, and orphan pages.
- `/wiki-ingest`: `{ text?, path?, url?, title? }` — stages one external source into `raw/ingest/<utc>-<slug>/` (`source.*` original + `extract.md`), then returns a brief (staged paths, extract preview, source URL when applicable, Karpathy filing checklist). When the host injects `drivers`, the command calls `drivers.startRun(brief, { activeSkills: ["wiki-maintainer"] })` so the maintainer skill files the source into the wiki; without drivers it stages only and reports `runStarted: false`. Results are labeled `metadata.trust: "untrusted_external"`.

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

# Stage an external source for the wiki
npx prism-wiki ingest --path notes/paper.pdf --title "Paper"

# `--url` is a usage error in the standalone CLI:
# the wiki package never fetches — URL ingest needs a host fetchUrl hook
npx prism-wiki ingest --url https://example.com/rfc.pdf   # → exit 1
```

## Outputs / response / events

- `wiki_search` returns a structured markdown payload containing section breadcrumbs, conceptual summaries, and clickable source line links (`file:///path#Lxx-Lyy`).
- Lifecycle commands return status objects (`{ status: "initialized" | "refreshed" | "clean", ok: boolean }`).
- `wiki_ingest` / `/wiki-ingest` return the staged paths, the (capped) extract preview, and a filing brief; `value.runStarted` reports whether a driver run was started.

### `ingestWikiSource(input, options)`

The staging primitive behind `/wiki-ingest`, `wiki_ingest`, and the CLI. Accepts `{ text?, path?, bytes?, url?, filename?, title? }` (precedence `path` > `bytes` > `url` > `text`) and returns `{ id, rawDir, sourcePath, extractPath, mediaType?, extract, truncated, url? }` (`url` present only for URL-staged sources).

| Input | Parse behavior |
| :--- | :--- |
| Text-like files and `text` | Decoded as UTF-8 (RAG text/markdown/html parsers) |
| Uncompressed PDF | Parsed by the RAG PDF parser (bounded pages/bytes) |
| Compressed PDF / DOCX | Throws a named error unless the host supplies `options.extractDocument` (e.g. wire `createDocumentReader()` from `@arnilo/prism-coding-tools/document-reader`) |
| `url` | `assertSsrfAllowedUrl` runs first (private/link-local hosts rejected before any fetch); then the host `fetchUrl` hook supplies the bytes/text — missing or empty hook output fails closed. Staged filename comes from the hook, the URL extension (`doc.pdf`), or `source.md` |
| Images | Staged as-is; stub extract points at the staged `source.*` — no OCR; view the file |
| Unknown binary | Fails closed unless `extractDocument` claims it |

Caps: 32 MiB per staged input, 2 MiB per extract. `path` must resolve inside the workspace root (realpath containment). `log.md` gains an `**Ingested**` entry only when the wiki root exists.

Wiring a `fetchUrl` hook (the wiki package ships no HTTP client — hosts bring their own, e.g. Obscura):

```ts
import { runObscuraCli, validateObscuraWebUrl } from "@arnilo/prism-web-tools/obscura";

const wiki = createWikiExtension({
  fetchUrl: async ({ url }) => {
    validateObscuraWebUrl(url); // host-side SSRF gate of its own
    const run = await runObscuraCli({ command: "obscura", args: ["fetch", url, "--dump", "markdown"] });
    return { text: run.stdout, filename: "source.md" };
  },
});
```

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
- **Wiki Page:** `entities/authentication.md`
- **Category:** Core Module
- **Freshness:** Current (Source hash matches manifest)

**Synthesized Summary:**
The authentication layer uses asymmetric Ed25519 JWT verification in middleware, backed by a persistent token-revocation denylist stored in PostgreSQL.

**Code & Source Anchors (Clickable):**
- Token verification: `verifyToken()` (`file:///src/auth/jwt.ts#L45-L89`)
- Revocation check: `assertNotRevoked()` (`file:///src/auth/session-store.ts#L112-L138`)
- Architecture Decision: `decisions/ADR-004-ed25519-migration.md`
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, initWiki, refreshWiki, lintWiki } from "@arnilo/prism-memory/wiki";

const kernel = createExtensionKernel();

const wiki = createWikiExtension({
  wikiRoot: ".wiki",
  profile: "codebase",
});

await kernel.load([wiki]);
```

## Skills and Auto-Deployment

The wiki subpath includes two specialized skills formatted according to `.agents/skills/skill-creator`:

1. **`wiki-maintainer`**: Ingestion, compilation, line-anchor validation, and contradiction reconciliation rules.
2. **`wiki-searcher`**: Context7 hierarchical breadcrumb query resolution, zero-grep instructions, and compounding insight recording.

When initialized (`wiki-init` or `createWikiExtension`), these skills are automatically deployed to the host workspace's `.agents/skills/` folder so any compatible agent can leverage them immediately.

## OKF v0.2 bundle format

Emitted `.wiki/` trees are [OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format) bundles. Karpathy compilation (synthesize, don't copy; precise `file:///` anchors; contradiction reconciliation; synchronized catalog/ledger) is unchanged.

| Artifact | OKF rule |
| --- | --- |
| Root `index.md` | Only `okf_version: "0.2"` frontmatter; sectioned bullet listings per OKF §8 |
| `entities/index.md`, `decisions/index.md`, `concepts/index.md` | No frontmatter (progressive disclosure) |
| Concept pages | `type` required (Module / Concept / Decision Record / Entity / Person / Tool), plus `title`, `description`, `tags`, `sources[].resource`, `generated: { by: prism-wiki/<version>, at: <ISO 8601 UTC> }` |
| `log.md` | `# Directory Update Log`, `## YYYY-MM-DD` newest first, `* **Verb**: …` |
| Links | Standard relative markdown. `[[wikilinks]]` are lint errors |

`.manifest.json` remains the compilation ledger (`id`, `category`, `rawSources`, `lastCompiledAt`). Those keys are not copied into page frontmatter. Trust families (`verified`, `status`) are omitted in v1 (unverified). `wiki-refresh` upgrades pages it touches; leftover legacy pages can be re-scaffolded — the format is regenerable from raw sources.

## Extension and configuration notes

- The wiki subpath registers tools (`wiki_search`, `wiki_read_page`, `wiki_record_insight`, `wiki_ingest`), commands (`wiki-init`, `wiki-refresh`, `wiki-lint`, `wiki-ingest`), skills (`wiki-maintainer`, `wiki-searcher`), and instruction injectors (`wiki-guidance`) into Prism registries.
- It operates with zero core modifications and can be used with any `@arnilo/prism` agent.
- `qmd` is optional but recommended. When `@tobilu/qmd` is not installed, the search engine falls back to catalog matching against `index.md`.

## Ingest filing rules (Karpathy/OKF)

After staging, the `wiki-maintainer` skill files the source: read `.wiki/SCHEMA.md` and `index.md` first, read the staged `extract.md` (and view `source.*` for images/PDFs), integrate claims into existing entity/concept/decision pages — create pages only for genuinely new concepts — then emit OKF v0.2 frontmatter (`type` required; `sources[].resource` pointing at the staged `source.*` — for URL-staged sources the original URL is also legitimate; `generated.by: prism-wiki/ingest`), add per-claim footnotes keyed to `sources[].id` for source-specific claims, update `index.md`, and prepend an `**Ingested**` entry to `log.md`. Never copy raw bodies into wiki pages; one source per ingest; contradictions update the existing page and are logged. The same rules ship in every scaffolded `SCHEMA.md` (`## Ingest Protocol`).

## Security and performance notes

- **Ingest boundaries**: the wiki package never fetches — `url` inputs require a host `fetchUrl` hook, and `assertSsrfAllowedUrl` rejects private/link-local hosts before the hook runs; the standalone CLI rejects `--url` with a usage error. `path` inputs are contained inside the workspace root via realpath; extracts are untrusted data (`trust: "untrusted_external"`), never instructions; the raw layer stays read-only for the LLM; images get a stub extract (no OCR).
- **Source Immutability**: Raw source files are read-only and never modified by wiki operations.
- **Subprocess Safety**: All `qmd` subprocess calls use argument arrays (`execFile`) to prevent shell injection.
- **Path Containment**: Wiki and raw source paths are confined to the workspace root; directory traversal (`../`) is rejected.
- **Bounded Token Consumption**: Incremental Merkle hashing ensures only modified files and 1-hop dependent wiki pages are processed during refresh passes.

## Related APIs

- [`@arnilo/prism-memory/rag`](rag.md): Bounded document chunking and vector context injection.
- [`@arnilo/prism-memory`](working-and-semantic-memory.md): Embedder and VectorStore primitives.
- [`@arnilo/prism-coding-tools/agent`](coding-agent-tools.md): Code manipulation and reading tools.
- [`Contribution registries`](contribution-registries.md): Extension contribution model.
