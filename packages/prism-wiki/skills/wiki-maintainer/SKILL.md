---
name: wiki-maintainer
description: Compiles, ingests, updates, reconciles contradictions, and lints the Karpathy LLM Wiki (.wiki/) for codebases and PKM vaults. Use when building a new wiki (wiki-init), incrementally updating changed sources (wiki-refresh), reconciling conflicting claims, or performing health checks (wiki-lint).
---

# Wiki Maintainer

Compile and maintain persistent, compounding Markdown wikis (`.wiki/`) from raw immutable sources.

## Core Principles

1. **Compilation over Duplication**:
   - The wiki is a compiled artifact, not a mirror of raw files.
   - Synthesize architectural intent, cross-module workflows, design decisions (ADRs), and entity relationships.
   - Never copy raw code bodies or entire articles into the wiki.

2. **Precise Source Anchors**:
   - Every factual claim about code must carry an exact line-range link:
     `symbolName (file:///path/to/file#L10-L45)`
   - Anchor links enable zero-grep navigation for consuming agents and allow the linter to detect code drift.

3. **Contradiction Reconciliation**:
   - When new source data contradicts an existing claim, update the existing entity page rather than creating a duplicate page.
   - Log the contradiction in `.wiki/log.md` with conflicting claims and the resolution rationale.

4. **Synchronized Catalogs and Ledgers**:
   - `index.md`: Content-oriented catalog listing every page, category, and 1-line summary.
   - `log.md`: Chronological append-only ledger of ingests, refreshes, and lint passes (`## [YYYY-MM-DD] op | Description`).

## Maintenance Procedures

### Ingestion & Compilation (`wiki-init` / `wiki-refresh`)

1. Scan changed source files identified by the change-detection delta.
2. For each modified source:
   - Identify affected entity pages in `.wiki/entities/`.
   - Update summaries, relationships, and source line anchors.
   - If an entity is new, create `.wiki/entities/<name>.md` with YAML frontmatter (title, category, tags, rawSources).
3. Update `.wiki/index.md` with new/modified entity entries.
4. Append an entry to `.wiki/log.md`:
   ```markdown
   ## [2026-08-24] refresh | Updated auth entity anchors
   - Reflected token verification changes in `src/auth/jwt.ts`.
   - Re-indexed 2 symbols.
   ```
5. Trigger on-device index update via `qmd update`.

### Health Check & Anti-Drift Linting (`wiki-lint`)

Run periodically to verify wiki integrity:
- **Dead Anchors**: Check if referenced file lines shifted or symbols were renamed.
- **Broken Links**: Check for unresolved `[[wikilinks]]`.
- **Orphan Pages**: Identify entity pages with no inbound links from other pages or `index.md`.
- **Gaps**: Identify frequently referenced symbols or concepts lacking dedicated entity pages.
