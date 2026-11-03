# Changelog

## [Unreleased]

### Added

- Source ingest into the ontology (plan 207 Task 8): `wiki_ingest` and `wiki:ingest` stage the original and a UTF-8 extract under `<tools.root>/sources/<utc>-<slug>/` and index the extract as a fabric `file` note in the `project` scope, through the `memory.fabric` port's new `indexSource`. The note carries title and frequent-word keywords, so the fabric binds it to the one subject that fits (marking that concept for the next pass) and an unbound source clusters. An ingested source counts as `consolidate.minNotes` notes toward the accumulation trigger, so one source is due on its own. The result gains `noteId`, `scope`, `indexed`, `subject` and `refused`; claims cite `noteId`, and forgetting the note removes them. The staging rules are unchanged: `path` stays inside `workspaceRoot`, a `url` is SSRF-checked and needs `web.fetch`, the PDF parser, image stubs, the byte caps and the fail-closed format list. New: the tool fails closed without the fabric's `tools.root`, a text that trips the trust scan is staged but not indexed, and a symlinked `sources/` is refused. `ingestWikiSource` takes `stageRoot` (default `workspaceRoot`) in place of `ingestRoot`.
- Claim lint (plan 207 Task 7): `wiki:lint [scope]`, a read-only report per scope (`user`, `project`, `team`) over the ontology. It makes no model call and reads the `memory.fabric` port only. One table of rules in `src/lint.ts` reports unresolved citations and alias collisions (the only two that make the report `ok: false`), stale citations, uncited human claims, claims resting only on candidate notes, relations to subjects that are no longer live, concepts over `consolidate.maxClaimsPerConcept`, team concepts whose citations are shared without evidence, concepts a person edited since the curator last wrote them, bodies that no longer parse, and unbound notes older than three of this process's concept passes. About 0.1 s for 2,000 concepts on the in-memory store. New exports `WIKI_LINT_COMMAND_NAME` and the `WikiLint*` report types.
- The concept pass (plan 207 Task 6): a background pass, one model call per due subject or cluster, that turns the fabric's cited evidence into concept notes through closed, cited, incremental edits (`edit_concept`: `create_subject`, `bind`, `add_claim`, `update_claim`, `retire_claim`, `merge_claims`, `add_relation`, `add_open_question`, `note_contradiction`). Triggers are co-read (primary), accumulation and repair; the answer is validated whole and fails closed; a shape failure gets one repair call. Config `consolidate.minCoReads`, `consolidate.triggers`, `consolidate.minIntervalTurns` and `consolidate.workerLimits`. Command `wiki:consolidate`; `wiki:status` reports the last pass and its cost; one `wiki.consolidated` package event per pass that did work. Capabilities `background` and `session-state`.
- Dependency on `@arnilo/prism-memory-observational` for the worker loop and its limits.

### Changed

- **Breaking for a host that read the staged tree** (plan 207 Task 8): sources are staged under `<tools.root>/sources/<id>/`, not `raw/ingest/<id>/`, and `WikiIngestResult` paths are relative to `tools.root`. The tool name and inputs are unchanged; the brief no longer carries filing instructions.
- The pass protects a person's claims one by one (plan 207 Task 7). A claim marked `human` in the concept file, or with no citation, is read-only to the pass; the rest of that concept stays the curator's to maintain. Before, a concept whose last writer was a person was read-only as a whole, and the protection ended when the pass next wrote it. The fabric refuses an edit to such a claim as well.
- **Breaking for a host on the 0.12-era surface** (plan 207 Task 5): the package is now the ontology tier of the three-tier memory, built over the fabric. It requires the `memory.fabric` service and fails closed with `missing_service` without it (the fabric provides it only when `semantic` memory is on). Config is `consolidate` and `ingest` plus `workspaceRoot`; unknown fields are rejected.
- `wiki_ingest` keeps its name and inputs; the brief no longer asks the agent to file `.wiki/` pages. The commands are `wiki:status` (new: concept and dirty-subject counts per scope, no model call) and `wiki:ingest`.
- Peer dependency on `@arnilo/prism-memory-fabric` (the `memory.fabric` port types).

### Removed

- The 0.12 compiler, profiles, manifest, scaffolder, contradiction engine, linter, re-point and retire handlers, the `.wiki/` page store, the `qmd` client and the Context7 hydrator.
- The tools `wiki_search`, `wiki_read_page` and `wiki_record_insight`; the commands `wiki-init`, `wiki-refresh`, `wiki-lint` and `wiki-ingest`.
- The `wiki-searcher` and `wiki-maintainer` skills, `deployWikiSkills`, the `wiki-guidance` `context.build` hook, the `prism-wiki` bin and `runCli`.
- The config fields `wikiRoot`, `rawRoots`, `profile`, `qmdPath` and `autoDeploySkills`.
- `createWikiDeletionHandler`: the fabric's cascade covers concept notes, so deletion propagation registers no wiki leg.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.
