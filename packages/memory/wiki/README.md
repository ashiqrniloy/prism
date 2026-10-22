# @arnilo/prism-memory-wiki

The LLM Wiki knowledge compiler for Prism agents: `wiki_search`, `wiki_read_page`,
`wiki_record_insight`, and `wiki_ingest` tools, the `wiki-init` / `wiki-refresh` / `wiki-lint` /
`wiki-ingest` commands, the bundled `wiki-searcher` and `wiki-maintainer` skills, a
`context.build` guidance injector, and the `prism-wiki` CLI. It is the native-package successor to
the 0.12 `@arnilo/prism-memory/wiki` subpath.

Install explicitly. This package is not included in profile bundles until a size/use review.

```bash
bun add @arnilo/prism-memory-wiki
```

## Usage

```ts
import toolsWeb from "@arnilo/prism-tools-web";
import memoryWiki from "@arnilo/prism-memory-wiki";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openai/gpt-5",
  packages: [toolsWeb({ backend: "obscura" }), memoryWiki({ wikiRoot: ".wiki", profile: "codebase" })],
});
```

`toolsWeb` is optional: it is what supplies the `web.fetch` service the wiki consumes for `url`
ingest. Without it the package notes a warning at setup and `wiki_ingest url=...` fails closed,
while text and file ingest keep working.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `wikiRoot` | string | `".wiki"` | Directory the compiled wiki lives in. |
| `rawRoots` | string[] | workspace root | Directories holding the raw sources. |
| `profile` | `"codebase" \| "pkm" \| "hybrid" \| "auto"` | `"auto"` | Compilation profile. |
| `qmdPath` | string | `"qmd"` | `qmd` binary used by `wiki_search`. |
| `workspaceRoot` | string | `process.cwd()` | Workspace the wiki and raw layers are resolved against. |
| `autoDeploySkills` | boolean | `false` | **Writes** the bundled skills into `<workspaceRoot>/.agents/skills/` when `true`. |

## What it changes

- **Tools.** `wiki_search`, `wiki_read_page`, `wiki_record_insight`, `wiki_ingest`.
- **Commands.** `wiki-init`, `wiki-refresh`, `wiki-lint`, `wiki-ingest` as package commands.
- **Skills.** `wiki-searcher` and `wiki-maintainer`, read from the package's `skills/` directory with
  `prism.skills.addDir`.
- **Hook.** One `context.build` handler under the id `wiki-guidance` that appends a system message
  naming the `.wiki/` search entry point.
- **Bin.** `prism-wiki` (`init`, `refresh`, `lint`, `ingest`, `search`, `help`).
- **Service.** Consumes `web.fetch` for `url` ingest. Provides nothing.

## Cost, security, and failure behavior

- **No model call.** `qmd` runs only when `wiki_search` is called, and the Context7 hydrator reads
  local `.wiki/` files only. No request happens on setup or per turn.
- **Writes only on request.** Setup writes nothing unless `autoDeploySkills: true`; ingest and
  `wiki_record_insight` write inside the wiki and raw layers, never outside the workspace root.
- **Fails closed.** `url` ingest SSRF-checks the URL first and then needs the `web.fetch` service; a
  missing service is a named tool error, not a silent skip. `wiki_read_page` enforces lexical and
  `realpath` containment. `extractDocument` and `ocrImages` are gone: compressed-PDF, CSV-via-host,
  and image-OCR extraction leave the wiki, and an unsupported format is a named error.
- **Untrusted content.** Ingested and searched content is labeled untrusted external data.

## Related APIs

- `@arnilo/prism-memory-rag`: the PDF parser and document byte cap the wiki's built-in PDF path uses.
- `@arnilo/prism-tools-web`: provides the `web.fetch` service.
