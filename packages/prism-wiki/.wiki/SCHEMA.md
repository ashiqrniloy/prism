# Wiki Schema & Operational Protocol

Profile: `pkm`

# Personal Knowledge Management (PKM) Schema Rules
- Organize topics into conceptual synthesis in `entities/concept-<name>.md`.
- Use `[[wikilink]]` syntax to link related concept pages together.
- Extract recurring themes, literature citations, and personal reflections.
- Retain chronological context in `log.md`.


## Formatting Conventions
- **Entity Files**: `.wiki/entities/<id>.md` with YAML frontmatter (`id`, `title`, `category`, `tags`, `rawSources`).
- **Decision Records**: `.wiki/decisions/ADR-<num>-<title>.md`.
- **Linking**: Use `[[entity-id]]` for wiki page cross-references and `symbol (file:///path#Lxx-Lyy)` for code anchors.
- **Index**: Keep `.wiki/index.md` alphabetized and categorized.
- **Log**: Append every operation chronologically to `.wiki/log.md`.
