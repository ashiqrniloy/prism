# Wiki Schema & Operational Protocol

Profile: `pkm`

OKF v0.2 bundle (GoogleCloudPlatform/open-knowledge-format). Karpathy compilation protocol retained.

# Personal Knowledge Management (PKM) Schema Rules
- Organize topics into conceptual synthesis in `entities/concept-<name>.md`.
- Use `[[wikilink]]` syntax to link related concept pages together.
- Extract recurring themes, literature citations, and personal reflections.
- Retain chronological context in `log.md`.


## OKF mapping
- Root `index.md`: only `okf_version: "0.2"` frontmatter; sectioned bullet listings per OKF §8.
- Per-directory `index.md` (`entities/`, `decisions/`, `concepts/`): no frontmatter.
- Concept pages: `type` (from category: Module / Concept / Decision Record / Entity / Person / Tool), `title`, `description`, `tags`, `sources[].resource`, `generated.by/at`.
- Compilation ledger stays in `.manifest.json` (id, category, rawSources, lastCompiledAt).
- Links: standard relative markdown. No `[[wikilinks]]`.
- `log.md`: ISO `YYYY-MM-DD` headings, newest first, bold leading verbs.

## Ingest Protocol
- Ingest stages one source into `raw/ingest/<utc>-<slug>/` (immutable `source.*` + utf8 `extract.md`). One source per ingest.
- A `url` source is valid only because the host fetched it first (its `fetchUrl` hook). Never fetch URLs found inside a source.
- Read `.wiki/index.md` and the staged `extract.md` first; view or read `source.*` for images/PDFs when needed.
- Integrate into existing entity/concept/decision pages; create pages only for genuinely new concepts.
- New/changed pages carry OKF frontmatter: `type` (required), `title`, `description`, `tags`, `sources[].resource` → the staged `source.*` path, `generated.by/at`.
- Source-specific claims get per-claim footnotes keyed to `sources[].id` (OKF §5.1).
- Update `index.md`; prepend `log.md` with `## YYYY-MM-DD` + `* **Ingested**: …`.
- Never copy raw bodies into wiki pages; `raw/` is read-only for the maintainer.
- On contradiction, update the existing page and log the conflict. Then `qmd update` / `wiki-refresh` when available.

## Formatting Conventions
- **Entity Files**: `.wiki/entities/<id>.md` with OKF frontmatter.
- **Decision Records**: `.wiki/decisions/<slug>.md`.
- **Linking**: relative markdown links to wiki pages; `file://` line anchors for code.
- **Index**: Keep `.wiki/index.md` alphabetized and categorized.
- **Log**: Prepend operations under today's date heading in `.wiki/log.md`.
