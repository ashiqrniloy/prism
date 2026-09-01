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
   - `index.md`: OKF catalog (`okf_version: "0.2"` only) with sectioned bullet listings.
   - `log.md`: Date-grouped newest-first ledger (`## YYYY-MM-DD`, bold leading verbs).

## Maintenance Procedures

### Ingestion & Compilation (`wiki-init` / `wiki-refresh`)

1. Scan changed source files identified by the change-detection delta.
2. For each modified source:
   - Identify affected entity pages in `.wiki/entities/`.
   - Update summaries, relationships, and source line anchors.
   - If an entity is new, create `.wiki/entities/<name>.md` with OKF frontmatter (`type`, `title`, `description`, `tags`, `sources`, `generated`).
3. Update `.wiki/index.md` with new/modified entity entries (markdown links, not `[[wikilinks]]`).
4. Prepend an entry to `.wiki/log.md`:
   ```markdown
   ## 2026-08-24
   * **Compiled**: Updated auth entity anchors in `src/auth/jwt.ts`.
   ```
5. Trigger on-device index update via `qmd update`.

### Health Check & Anti-Drift Linting (`wiki-lint`)

Run periodically to verify wiki integrity:
- **Dead Anchors**: Check if referenced file lines shifted or symbols were renamed.
- **Broken Links**: Check unresolved relative markdown links; flag leftover `[[wikilinks]]` as non-OKF.
- **OKF frontmatter**: Concept pages need `type`; `generated.at` must be ISO 8601 UTC.
- **Orphan Pages**: Identify entity pages with no inbound links from other pages or `index.md`.
- **Gaps**: Identify frequently referenced symbols or concepts lacking dedicated entity pages.
