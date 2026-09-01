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

## Formatting Conventions
- **Entity Files**: `.wiki/entities/<id>.md` with OKF frontmatter.
- **Decision Records**: `.wiki/decisions/<slug>.md`.
- **Linking**: relative markdown links to wiki pages; `file://` line anchors for code.
- **Index**: Keep `.wiki/index.md` alphabetized and categorized.
- **Log**: Prepend operations under today's date heading in `.wiki/log.md`.
