# Wiki Schema & Operational Protocol

Profile: `codebase`

# Codebase Wiki Schema Rules
- Every claim regarding implementation logic must cite exact code line anchors: `symbol (file:///path/to/file#L10-L40)`.
- Group compiled entities by functional modules in `entities/module-<name>.md`.
- Keep architectural decision records in `decisions/ADR-<num>-<name>.md`.
- Do not repeat code verbatim; explain invariants, flow, and dependencies.


## Formatting Conventions
- **Entity Files**: `.wiki/entities/<id>.md` with YAML frontmatter (`id`, `title`, `category`, `tags`, `rawSources`).
- **Decision Records**: `.wiki/decisions/ADR-<num>-<title>.md`.
- **Linking**: Use `[[entity-id]]` for wiki page cross-references and `symbol (file:///path#Lxx-Lyy)` for code anchors.
- **Index**: Keep `.wiki/index.md` alphabetized and categorized.
- **Log**: Append every operation chronologically to `.wiki/log.md`.
