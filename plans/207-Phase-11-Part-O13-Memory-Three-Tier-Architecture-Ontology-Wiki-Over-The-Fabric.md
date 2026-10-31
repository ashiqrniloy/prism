# Phase 11 Part O13 — Three-tier memory: the wiki becomes the ontology tier over the fabric

## Objectives

- Ship Prism's memory as **three tiers over one store**, the owner's design (decision 2026-10-31):
  - **T0 — observation.** The session and observational memory (OM) see what happens: the verbatim exchange archive, OM observations, task state.
  - **T1 — the fabric.** Atomic, scoped, lifecycle-managed notes: exchanges, facts, preferences, procedures, decisions, files. They stay disconnected on purpose: each note is evidence with provenance.
  - **T2 — the wiki, as the ontology of the context it is built in.** One concept note per subject (an entity or a topic in this user's, project's or team's world). Each holds relations to other subjects and itemized claims, and **every claim cites the T1 notes or ingested sources it rests on**. A background consolidation pass maintains it with incremental edits.
- Agents **read concepts first and drill down**:
  - one `memory.recall` returns concept hits ahead of notes, each with its claims and cited ids;
  - `memory.read` follows a citation to the note, and the note's existing evidence links reach the exchange.
  - A pattern that has not yet become a concept still comes straight from T1, in the same call.
- The ontology **shapes writing as well as reading** (schema-assisted encoding):
  - a T1 note is bound to a subject when it is written (deterministically when an alias matches, by the extractor when one runs);
  - consolidation works on ready-made clusters instead of rediscovering structure.
- Consolidation **adds a layer and never replaces evidence**:
  - claims are edited incrementally (add, update, retire, merge), never rewritten wholesale;
  - a claim with no surviving citation is not delivered;
  - forgetting a note removes every claim that cited it, deterministically and without a model call.
- **Remove the overlap between the wiki and the fabric** found in the 2026-10-31 evaluation:
  - one store (fabric notes), one retrieval surface (`memory.recall`), one context block (the fabric directory), one deletion path;
  - retire the wiki's parallel page store, its regex code compiler, its `qmd` search and its record-insight tool.

## Expected Outcome

- `@arnilo/prism-memory-fabric` stores a new opt-in note kind, `concept`, and an additive `subject` field on notes. It owns the concept codec, the deletion cascade and concept-first recall, and it provides the `memory.fabric` service the wiki consumes.
- `@arnilo/prism-memory-wiki` is the ontology tier:
  - a background concept pass (one model call per changed subject);
  - subject proposals and binding;
  - source ingest into the fabric;
  - claim lint;
  - the `wiki:*` commands.
  It requires the `memory.fabric` service and fails closed without it. Its 0.12-era compiler, profiles, `.wiki/` page store, `qmd` client, hydrator, four tools minus `wiki_ingest`, two skills, guidance hook and `prism-wiki` bin are deleted.
- Concept notes are OKF markdown files in the fabric's markdown store (and in the checked-in team store when shared). People browse them, diff them in git and edit them; reconcile treats an edit as `generated.by: human`.
- An example (`examples/three-tier-memory.ts`) runs the whole stack on the mock provider: OM, the fabric and the wiki. The reference host gains an opt-in `ontology` option on its coding and research agents.
- The fabric, wiki and OM READMEs, `PRODUCT.md`, `README.md` and `docs/index.md` describe the three-tier contract, with its cost and the default that avoids it.
- **No quality claim ships from this plan.** Plan 208 measures the ontology tier on development partitions; plan 210 runs its held-out acceptance and decides its default. Until plan 210's verdict the tier is opt-in, its README says it is unmeasured, and `conversational` and `coding` presets are unchanged.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 13). **Owner decision 2026-10-31: the three-tier memory architecture ships in 0.13.0; it is how Prism's memory differs from other agent harnesses.** It runs as release step **17c**, after plan 202 (Tasks 1–17) and before plan 208 (17d). The memory train is strictly sequential (owner decision 2026-10-31): 202 → 207 → 208 → 209 → 210 → 184 → 185. The one held-out acceptance (plan 210 Task 9, formerly plan 202 Task 18) runs after every memory plan and plan 210's audit, so its frozen product hash includes the ontology tier and its arms run under the same gate. Plan 210 audits every feature this plan adds and removes what cannot be justified before plan 185's freeze. Placement reasons:

- it builds on 202's levers: Task 5's write-time enrichment keys feed subject binding, Task 7's state and supersession feed reconsolidation, Task 11's `decision` kind is a citable T1 note, and Task 13's link relations are reused;
- it adds a note kind, a note field, a service and config fields, so it must land before plan 185 freezes the surface.

**Review task included** (Task 1): the plan adds a package-to-package service contract (`memory.fabric`) and reshapes the wiki package. **No kernel contract change** is planned; `services.provide/consume`, `session.background`, `models` and the manifest's `services` requirement already exist (`docs/packages.md:55,85,121`). If Task 1 finds a kernel change is needed, the plan stops and is re-cut. **No paid model call** in this plan: every test runs on the mock provider, and paid measurement belongs to plan 208. No version bump or publish: both packages ship in plan 187's lockstep 0.13.0 publish.

**Relation to plan 202's structure decision.** 202 adopted "one store of record plus derived, rebuildable views that always cite the log" and rejected an entity-relation graph as the primary structure and model-written summaries as replacements for raw content. The ontology tier is built inside that rule:

- concepts are a derived view; every claim cites T1 notes, and a claim whose citations are gone is not delivered;
- relations are sparse typed links on concept notes (the existing `MemoryNoteLink`), not a graph store; there is no graph-wide ranking or traversal beyond one hop;
- notes and exchanges stay the record of truth for dates, counts and values; nothing is deleted or compressed because a concept covers it.

What is new against 202 is that the view is model-written. That carries a measured risk (false generalization, the DRM-gist effect; context collapse under rewrites, ACE arXiv 2510.04618) which this plan constrains by construction (incremental cited edits, deterministic cascade) and plan 208 measures with a claim-support metric. The 202 amendment is recorded in 202's "Structure decision" section.

## Tasks

- [ ] Task 1: Review, assumption check and contract inventory (read-only)
  - Acceptance Criteria:
    - Functional: **(a) Inventory.** Record, with `file:line`, every contract the plan touches:
      - `MemoryNoteKind` / `MEMORY_NOTE_KINDS` (`packages/memory/fabric/src/types.ts:29,34`), `DEFAULT_RECALL_KINDS` (`types.ts:85`), `MemoryNoteLink` (`types.ts:92–98`), the note codec (`types.ts:815–940`) and the "Notes written by a newer version" rule;
      - the fabric README's `### Needs a new name or an explicit opt-in` rule (a new stored kind needs an explicit opt-in) and `### Config stability` tiers;
      - fabric setup registrations (`index.ts:504–685`), background jobs (`fabric.exchange`, `fabric.consolidate`, `fabric.lifecycle`) and their leases (`consolidation/pass.ts:108`);
      - recall fusion and priors (`scope/recall.ts:27–71,116`), the directory (`directory.ts:31–247`), the core and cues (`delivery/core.ts`, `delivery/cues.ts`), `memory:share` (`delivery/team.ts`);
      - the extractor prompt and `recallExisting` (`consolidation/prompts.ts:49–53,135`, `consolidation/extract.ts:180,277,361–369`);
      - deletion propagation (`packages/memory/core/src/propagation.ts:48–82`) and the wiki's handler (`packages/memory/wiki/src/retire.ts:124–141`);
      - the wiki's current surface (`scripts/compat-baseline/arnilo__prism-memory-wiki.txt`, 81 lines) and every caller outside the package (the grep list in Task 5);
      - kernel services semantics (`docs/packages.md:55,85,121`).
    - Functional: **(b) Classify each objective** as expressible with existing contracts or needing a kernel addition. Expected: all expressible. A kernel need stops the plan.
    - Functional: **(c) Verify the assumptions later tasks make**, and record each verdict:
      1. a package declaring `services: ["memory.fabric"]` fails `createAgent` with `missing_service` when the fabric is absent, and a provider loaded after the consumer is visible at call time (`docs/packages.md:121`);
      2. a new kind can be added under an explicit opt-in without changing the meaning of any existing contract field (188.11's rule), and `concept` notes are invisible to every code path that does not name the kind;
      3. the markdown store places a new kind in its own directory and the derived index indexes its text and frontmatter keywords;
      4. a retraction (forget, supersede, flag, archive, revocation) has one place in the fabric where a listener can run synchronously before the write returns;
      5. the extractor's cached request segments (plan 202 Task 4.12) stay stable when a per-scope subject list is added, if the list is snapshotted per epoch;
      6. the directory and core prefix snapshots (202 Task 4.12) stay byte-identical within an epoch when the concept pass writes in the background;
      7. plan 202 Tasks 5, 7, 11 and 13 landed the enrichment keys, state markers, `decision` kind and link relations this plan cites; any task closed by 202's lever rule is recorded with the substitute this plan uses.
    - Functional: **(d) Verdict** in the Notes: proceed, or stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: No code change and no new file outside this plan.
    - Security: Records which existing trust boundary each later task relies on: the trust scan (`scanScopedMemoryContent`), the redactor, scope readability, `host.ui` for sharing.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.6 (packages, services), §2.9 rows for `memory-fabric` and `memory-wiki`, Phase 8, Phase 11 "Three-tier memory";
      - fabric README `## Compatibility`, `## Scopes`, `## Delivery tiers`, `## Consolidation`, `## Tools`;
      - wiki README and the 2026-10-31 evaluation findings (defects in the compiler, anchors, staleness flag, insight indexing);
      - plan 202 "Structure decision" and Tasks 4.12, 5, 7, 11, 13, 16, 17.
    - Options Considered:
      - Skip the review because no kernel contract changes. Rejected: the plan creates a package-to-package service and reshapes a package, which `references/prism.md` §2 lists as review triggers.
    - Chosen Approach:
      - A read-only inventory and assumption check before any code, as plan 142 Task 1 did.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - this plan (Notes only).
    - References:
      - `.claude/skills/create-plan/references/prism.md` §2.
  - Test Cases to Write:
    - n/a — read-only. Each assumption verdict names the test a later task writes to pin it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit:
      - none — the review records findings in this plan.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The `concept` kind, the `subject` field, the deletion cascade and the `memory.fabric` service (fabric)
  - Acceptance Criteria:
    - Functional: **`concept` kind**, added to `MemoryNoteKind` and `MEMORY_NOTE_KINDS` under the explicit-opt-in rule. A concept note carries:
      - `subject`: a stable slug, `[a-z0-9.-]{1,64}` (the same alphabet as `key`), unique per scope;
      - `title`, `aliases` (≤ 16), `conceptType`: `entity` or `topic`;
      - `links` with relations from a closed set — `part-of`, `instance-of`, `uses`, `related` — each targeting another subject's concept id in the same scope;
      - a body of itemized claims. Each claim is one markdown bullet with a stable claim id and one or more OKF §5.1 footnotes, each footnote naming a cited note id (`[^<noteId>]`). Frontmatter `sources[]` lists the cited ids;
      - optional `## Open questions` and `## Contradictions` sections, each item citing ids too;
      - optional `appliesTo` globs (reusing `validateAppliesTo`), for a subject bound to a part of the project.
      The codec parses and encodes this shape. A concept whose body has an uncited claim is accepted only when `generated.by` is `human`; the claim is then labelled `(uncited, human)` wherever it is rendered.
    - Functional: **`subject` on every other kind**: an additive optional field binding a T1 note to a subject in its own scope. Unknown subjects are allowed (a binding may precede its concept).
    - Functional: **Write path.** Model tools cannot create, edit or delete a `concept` note: `memory.insert { kind: "concept" }` fails with `concept_requires_ontology` (a new `MemoryValidationError` code), and `memory.replace` and `memory.forget` on a concept id fail with the same code. Only the service (below), reconcile of a human edit, `memory:import` and `memory:share` write concepts.
    - Functional: **Deletion cascade, deterministic, in the fabric.** It runs whether or not the wiki package is installed, in the same write that retracts the note:
      - `memory.forget`, a store delete by id, deletion propagation (`createDeletionPropagator`) and a legal-hold-respecting `memory:import` replace **remove every claim that cites the forgotten note**, together with that claim's other citations. The concept's `sources[]` is recomputed, and the concept is marked dirty for the next pass. A concept left with no claims is archived.
      - supersession, archival, a `candidate` downgrade and a trust-scan flag on a cited note mark each citing claim `stale`. A stale claim is never delivered passively, is rendered `(stale)` in recall, and marks the concept dirty.
      - The cascade never calls a model and never deletes a T1 note.
    - Functional: **`memory.fabric` service.** The fabric provides it whenever `semantic` is on. It is a narrow, typed port (`FabricOntologyPort`):
      - `scopes()`: readable scope levels;
      - `subjects(scope)`: the ontology index (subject, title, aliases, concept id, conceptType, dirty flag);
      - `pending(scope, { cursor, limit })`: T1 notes written or bound since the cursor, with id, kind, subject, keys, tRef and text capped at `limits.maxEntryTextChars`;
      - `read(scope, ids)`: up to 32 notes through the same scope, consent, invalidation and redaction filters as `memory.read`;
      - `applyConceptEdits(scope, edits, { generatedBy, signal })`: validates and writes a batch of edits (the shape in Task 6), or rejects the batch whole;
      - `bind(scope, noteId, subject)`;
      - `dirty(scope)`: subjects whose concept needs a pass, and why.
      The service lives in `packages/memory/fabric/src/ontology/port.ts`. The wiki is its only in-repo consumer.
    - Functional: Host impact: **none** unless a host installs the wiki package or writes concept files by hand. With no concept notes, every existing recall, delivery and lifecycle result is byte-identical (pinned by a test).
    - Performance:
      - The cascade costs one reverse-citation lookup per retracted id: an index on `(cited id → concept ids)` in the derived SQLite index (markdown and SQLite stores), or a metadata scan in the in-memory store.
      - Measured ≤ 5 ms per retraction for 2,000 concepts on the SQLite index.
      - No model or embedding call.
    - Code Quality:
      - Codec in `types.ts` next to the existing kinds; cascade in `lifecycle/` next to supersession; port under `ontology/`.
      - No alias for any name. No speculative fields: the relation set is closed and lives in one constant.
    - Security:
      - Every concept write and edit passes `scanScopedMemoryContent` and the redactor; a hit rejects the edit with `refused: <class>`.
      - A concept may cite only notes stored in its own scope; a foreign or unreadable id rejects the whole batch (`MemoryScopeError`).
      - The port never accepts `agent` or `team` as a write scope: `agent` concepts come only from widening and `team` concepts only from `memory:share`.
  - Approach:
    - Documentation Reviewed:
      - fabric `types.ts:20–98,750–960`, `create.ts:127–208,416,505` (supersedes and validity), `lifecycle/*`, `okf-bundle.ts:112,163`;
      - `packages/memory/core/src/propagation.ts:48–120`;
      - OKF v0.2 (concept frontmatter, `sources[]`, §5.1 per-claim footnotes) as the wiki already renders it (`packages/memory/wiki/src/engine/okf.ts:50–80`);
      - ACE (arXiv 2510.04618): itemized bullets with incremental deltas avoid context collapse;
      - Zep (arXiv 2501.13956): invalidate, do not delete, on supersession; the community tier points back to episodes;
      - reconsolidation (Nader 2000; Lee, Nader & Schiller 2017): retrieval and updating make a consolidated trace editable again.
    - Options Considered:
      - Keep concept pages in the wiki's own `.wiki/` store. Rejected: two stores of record, two deletion paths and two retrieval surfaces are the duplication the evaluation found.
      - Put the cascade in the wiki package. Rejected: uninstalling the wiki would leave forgotten content alive in concept files. The store owner must enforce it.
      - Store claims as structured frontmatter rows. Rejected: bullets with OKF footnotes are human-editable, diffable and already the OKF citation form; the codec parses them.
      - Let the model tools write concepts. Rejected: the working agent writes evidence; only the background curator or a person edits the ontology (ACE's generator/curator split).
    - Chosen Approach:
      - The fabric owns storage, validity and cascade for concepts. The wiki owns synthesis through a narrow service port.
    - API Notes and Examples:
      ```markdown
      ---
      type: Concept
      title: "Payments service"
      subject: payments
      conceptType: entity
      aliases: ["billing service", "payments api"]
      sources:
        - id: 3f1c9e2a4b70
        - id: 9c1e2a4b7d10
      generated: { by: consolidation, at: 2026-11-02T10:12:00Z }
      ---
      # Payments service

      - [c1] Retries use exponential backoff capped at 3 attempts.[^3f1c9e2a4b70]
      - [c2] Inputs are validated with zod, not yup.[^9c1e2a4b7d10]

      ## Open questions
      - [q1] Whether refunds share the retry budget.[^3f1c9e2a4b70]
      ```
      ```ts
      const port = prism.services.require<FabricOntologyPort>("memory.fabric");
      await port.applyConceptEdits("project", [{ op: "add_claim", subject: "payments", text: "…", cites: ["3f1c9e2a4b70"] }], { generatedBy: "consolidation" });
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/types.ts`: kind, `subject`, codec;
      - `packages/memory/fabric/src/ontology/{port,codec,cascade}.ts` (new);
      - `packages/memory/fabric/src/{create,memory,tools,index,config}.ts`: write-path refusal, cascade wiring, service provision;
      - `packages/memory/fabric/src/lifecycle/*`: stale marking on supersession, archival, flag;
      - `packages/memory/core/src/stores/*`: the citation index in the derived SQLite index (tentative: Task 1 (c) 3 decides whether core or fabric owns the index column);
      - tests under `packages/memory/fabric/src/__tests__/` and `packages/memory/core/src/__tests__/`;
      - `packages/memory/fabric/src/__tests__/root-exports.test.ts`: the deliberate freeze update for `FabricOntologyPort`, `MEMORY_FABRIC_SERVICE`, and the codec types;
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` (and `arnilo__prism-memory-core.txt` if core gains exports) regenerated with `bun scripts/release.mjs gate --update-baseline`; the diff, attributed to this plan, goes in the task note;
      - fabric README, `CHANGELOG.md`.
    - References:
      - 2026-10-31 evaluation; plan 188.11 Tasks 3–6 (compatibility rules); plan 202 structure decision.
  - Test Cases to Write:
    - `concept_codec_round_trips_claims_footnotes_and_relations`.
    - `uncited_claim_rejected_unless_generated_by_human`.
    - `model_tools_cannot_write_or_forget_concepts` (`concept_requires_ontology` for insert, replace and forget).
    - `forget_removes_every_citing_claim_and_archives_an_empty_concept`: fails if a forgotten note's text survives in any concept file.
    - `deletion_propagator_cascades_into_concepts` (extends `deletion-propagation.test.ts`).
    - `supersede_and_flag_mark_claims_stale_and_never_delivered`.
    - `cascade_runs_without_the_wiki_package_installed`.
    - `foreign_scope_citation_rejects_the_batch`.
    - `port_refuses_agent_and_team_write_scopes`.
    - `no_concepts_means_byte_identical_recall_and_prefix` (prefix-stability and recall snapshots).
    - `citation_index_lookup_under_5ms_for_2000_concepts` (performance, SQLite).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new opt-in kind, a note field, a service, an error code.
    - Docs pages to create/edit:
      - `packages/memory/fabric/README.md`: new `## Ontology tier` section (kind, subject, cascade, service), `## Compatibility` (the kind under explicit opt-in; the service and port types as stable exports), `## Tools` (the refusal);
      - `CHANGELOG.md` `## [Unreleased]`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The ontology index and schema-assisted subject binding (fabric)
  - Acceptance Criteria:
    - Functional: **Ontology index per scope**: subjects with their aliases, built from concept notes by one metadata scan, cached until a concept write, and **snapshotted per session epoch** for every prompt-visible use (the same epoch as plan 202 Task 4.12's prefix snapshot).
    - Functional: **Deterministic binding at write time**, with no model call. When a T1 note (`exchange`, `fact`, `preference`, `procedure`, `decision`, `file`) is written without a `subject`, the fabric tests its text and keys against the scope's index:
      - a match is a whole-token, case-folded hit on a subject slug, title or alias, also counting plan 202 Task 5's enrichment keys;
      - exactly one subject at or above `ontology.bindThreshold` (tuning, default: ≥ 2 matched alias tokens, or one exact multi-token alias) binds the note;
      - zero or several candidates leave it unbound for the concept pass to decide.
    - Functional: **Extractor-assisted binding** when the fabric's consolidation extractor runs (`promote` on): the prompt carries the epoch's subject list (≤ 64 subjects per scope, title and up to 4 aliases each), and `record_notes` gains an optional `subject` field restricted to shown slugs or the literal `new`. A slug that was not shown is dropped, and the note stays unbound (it is not rejected).
    - Functional: **Directory line.** With at least one concept in a scope, the memory directory adds one line per scope: `concepts: N; subjects: a, b, c (+k)`, ordered by use. It stays inside the existing directory budget (default 200 tokens, hard 500) and is pinned for the epoch like the rest of the block.
    - Functional: Host impact: **none** without concepts. With concepts, notes gain a `subject` and the directory gains one line.
    - Performance:
      - Binding is ≤ 1 ms per note for 500 subjects (measured): a token map, not a scan.
      - The extractor prompt grows by ≤ 1,500 tokens at the 64-subject cap. Its cached segments stay byte-stable within an epoch, recorded by plan 202's `prefix-probe.mjs` scenario 5 rerun.
    - Code Quality: In `ontology/index.ts` and `ontology/bind.ts`; the extractor change is one optional schema field and one prompt section in `consolidation/prompts.ts`, the single source for both. No second tokenizer: reuse the lexical index's normalizer.
    - Security:
      - Subject titles and aliases are scanned and redacted when the concept is written, so the list shown to the extractor is already clean.
      - Binding never crosses scope.
      - Binding text from tool output is impossible: tool output is never note text (the existing extractor rule).
  - Approach:
    - Documentation Reviewed:
      - fabric `directory.ts:31–247`, `consolidation/prompts.ts:49–53,128–165`, `consolidation/extract.ts:180–290,361–369`, plan 202 Task 5 (enrichment) and Task 4.12 (epoch snapshot);
      - Tse et al. 2007 (*Science* 316:76–82): information that fits an existing schema consolidates fast;
      - Zep entity resolution; A-MEM note linking on insert (NeurIPS 2025).
    - Options Considered:
      - Bind only in the background pass. Rejected: schema-assisted encoding is the point (Tse 2007), and deterministic binding is free.
      - Bind with a model call on every write. Rejected: it breaks the `conversational` preset's no-write-path-model-call contract.
      - Let the extractor invent subjects freely. Rejected: an ontology grown by unconstrained naming fragments. Only the concept pass creates subjects (Task 6), and the extractor may say `new`.
    - Chosen Approach:
      - Cheap deterministic binding when unambiguous, model binding only where a model already runs, and ambiguity left to the curator.
    - API Notes and Examples:
      ```text
      Long-term memory
      project: 214 exchanges, 9 decisions; topics: deploy (5), billing (3)
      project concepts: 12; subjects: payments, deploy-pipeline, auth (+9)
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/ontology/{index,bind}.ts` (new);
      - `packages/memory/fabric/src/{create,exchanges,directory,config}.ts`;
      - `packages/memory/fabric/src/consolidation/{prompts,extract,write}.ts`;
      - tests;
      - `scripts/memory-bench/prefix-probe.mjs` (an ontology scenario);
      - fabric README, `CHANGELOG.md`.
    - References:
      - Task 2; plan 202 Tasks 4.12 and 5.
  - Test Cases to Write:
    - `unambiguous_alias_binds_note_on_write`.
    - `ambiguous_or_weak_match_leaves_note_unbound`.
    - `extractor_unknown_subject_is_dropped_not_rejected`.
    - `subject_list_is_epoch_snapshotted_and_extractor_segments_stay_stable`.
    - `directory_concepts_line_within_budget_and_pinned_for_epoch`.
    - `binding_never_crosses_scope`.
    - `bind_under_1ms_for_500_subjects` (performance).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — note binding, one optional extractor field, a directory line, one tuning field.
    - Docs pages to create/edit:
      - fabric README (`## Ontology tier`: binding; `## Memory directory`; `## Config` and `### Config stability`: `ontology.bindThreshold` as tuning);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Concepts first, then drill down — recall, read, cues and sharing (fabric)
  - Acceptance Criteria:
    - Functional: **One retrieval surface.** `concept` joins `DEFAULT_RECALL_KINDS`. Concept hits get a kind prior, `ontology.conceptPrior` (tuning, default 0.1, in [0, 0.5]), added after RRF fusion and the scope prior, so a matching concept outranks its own evidence but not a better-matching note.
    - Functional: **Rendering.** A concept hit renders as its header line (`[id] <level> concept <subject> <date>`), then its non-stale claims, each with its cited ids, up to `ontology.maxClaimsRendered` (tuning, default 8) chosen by term overlap with the query. Then one line: `drill down: memory.read { ids: [...] }`. Stale claims render `(stale)` only in `memory.read`, never in recall.
    - Functional: **Drill-down.** `memory.read { id: <concept> }` returns the whole concept with claim ids. `memory.read { ids }` on cited notes returns them through the existing filters, and an exchange reached that way can be expanded with the existing `around` navigation. A pattern that no concept covers is returned as a plain note in the same recall, with no extra call.
    - Functional: **Passive delivery.** Concepts are never in the pinned core. The passive tail may carry at most one concept per turn, and only when it is the top fused hit and its subject matches a touched path's concept `appliesTo` (path cue) or the turn's terms. It renders as one pointer line (`concept payments — memory.read <id>`) within the existing cue budget. Content is pulled by the agent, not pushed.
    - Functional: **Sharing.** `memory:share { id }` accepts a verified `concept` and writes it to the team store with the existing human confirmation. Its cited private notes are **not** copied: the shared concept keeps its claims and records each citation as `shared-without-evidence`, and lint (Task 7) reports it. The team concept is read-only to tools, quarantined by the trust scan like any team note, and shadowed by a private concept with the same subject (narrower scope wins).
    - Functional: **Co-read clusters (amended 2026-10-31).** The fabric records, per turn, the set of notes the agent both received (recall results or `memory.read`) and then cited or used. This is the existing use log (`recordUses`) plus the turn's read set. A set of ≥ 2 notes read together in one answering turn is stored as one `coRead` event: ids and turn index only, no text. It is the selection signal for Task 6's primary trigger: the agent has already paid to gather that evidence, and the gathering shows the synthesis is needed. No model call and no extra store query; the event rides in the existing `fabric.lifecycle` background write.
    - Functional: Host impact: **none** without concepts.
    - Performance:
      - Recall adds no store query: concepts are in the same lexical index.
      - Rendered concept bytes count against the existing recall token budget, and the 202 Task 8 precision rules apply.
      - Passive pointer ≤ 1 line per turn.
    - Code Quality: Concept rendering lives with the other renderers (`recall.ts`, `excerpt.ts`); the prior lives in `scope/recall.ts` next to the scope priors. No second recall tool.
    - Security:
      - Every rendered concept is inside the untrusted envelope (`UNTRUSTED_ENVELOPE`), like every other memory block.
      - A flagged concept is never delivered and is rendered `[flagged: <class>]` in recall.
      - Sharing goes through `host.ui`; `unavailable` refuses (`host_unavailable`).
  - Approach:
    - Documentation Reviewed:
      - fabric `scope/recall.ts:27–71,116–246`, `recall.ts`, `excerpt.ts`, `tools.ts:165`, `delivery/{core,cues,team}.ts`, `context.ts:189–214,321,410`;
      - plan 202 Tasks 5, 8 and 9 (navigation, precision-first delivery, answering from evidence);
      - transformation hypothesis (Winocur & Moscovitch 2011): gist and detail coexist; retrieval reaches gist and recovers detail on demand;
      - fuzzy-trace theory (Brainerd & Reyna): verbatim and gist traces are retrieved in parallel.
    - Options Considered:
      - A separate `wiki_search` tool. Rejected: with two tools an agent calls one and stops, and the 188.8 investigation found missing evidence, not weak synthesis, to be the failure mode.
      - Inject concepts passively in bulk. Rejected: 77.7% of injected blocks were irrelevant in 188.10 (R5); content is pulled.
      - Copy cited evidence into the team store on share. Rejected: it would publish private notes; sharing evidence is a separate, explicit `memory:share` per note.
    - Chosen Approach:
      - Concept-first ranking in the existing recall, a drill-down line, and pointer-only passive delivery.
    - API Notes and Examples:
      ```text
      [7a21c0d4e9b1] project concept payments 2026-11-02
        [c1] Retries use exponential backoff capped at 3 attempts. ← 3f1c9e2a4b70
        [c2] Inputs are validated with zod, not yup. ← 9c1e2a4b7d10
        drill down: memory.read { ids: ["3f1c9e2a4b70", "9c1e2a4b7d10"] }
      [3f1c9e2a4b70] project exchange 2026-10-28 …
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{types,recall,excerpt,tools,context,config}.ts`;
      - `packages/memory/fabric/src/scope/recall.ts`;
      - `packages/memory/fabric/src/delivery/{cues,team}.ts`;
      - tests;
      - fabric README, `CHANGELOG.md`.
    - References:
      - Tasks 2–3; plan 188.5 (team store); plan 202 Task 8.
  - Test Cases to Write:
    - `concept_outranks_its_evidence_but_not_a_better_note`.
    - `recall_renders_claims_with_cited_ids_and_drill_down_line`.
    - `uncovered_pattern_returns_as_note_in_same_call`.
    - `co_read_event_records_ids_only_for_notes_read_and_used_together`.
    - `stale_claims_never_in_recall_or_passive`.
    - `concept_never_in_pinned_core_and_pointer_only_in_tail`.
    - `share_concept_requires_confirmation_and_never_copies_evidence`.
    - `private_concept_shadows_team_concept_by_subject`.
    - `flagged_concept_never_delivered`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default recall kinds, rendering, sharing.
    - Docs pages to create/edit:
      - fabric README (`## Selective injection and recall`, `## Delivery tiers`, `### The team store`, `## Ontology tier`, `## Config` tuning fields);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Re-scope `@arnilo/prism-memory-wiki` as the ontology tier: requirements, retirements and the new surface
  - Acceptance Criteria:
    - Functional: **Manifest.** The package declares `services: ["memory.fabric"]`. Without the fabric, `createAgent` fails closed with `missing_service`, naming the service and this package. With the fabric present but `semantic: false`, setup notes `wiki: the fabric has semantic memory off; the ontology tier is inactive` and registers nothing.
    - Functional: **Retire the 0.12-era wiki in this task.** Delete, with no alias:
      - the compiler, profiles, manifest, scaffolder, contradiction engine, old linter and repoint handler (`src/engine/*`, `src/profiles/*`, `src/manifest.ts`, `src/repoint.ts`, the 0.12 parts of `src/retire.ts`);
      - `src/search/{qmd-client,context7-hydrator}.ts`;
      - the tools `wiki_search`, `wiki_read_page`, `wiki_record_insight`;
      - the commands `wiki-init`, `wiki-refresh`, `wiki-lint`, `wiki-ingest` (replaced below);
      - the skills `wiki-searcher` and `wiki-maintainer`, `deployWikiSkills`, `autoDeploySkills`;
      - the `context.build` guidance hook (`WIKI_INJECTOR_NAME`);
      - the `prism-wiki` bin and `src/cli.ts`;
      - the config fields `wikiRoot`, `rawRoots`, `profile`, `qmdPath`, `autoDeploySkills`.
      `createWikiDeletionHandler` is deleted too: the fabric cascade (Task 2) covers concepts, so deletion propagation registers no wiki leg.
    - Functional: **Repo-wide sweep** for every retired name and string over `src/ packages/ apps/ scripts/ examples/ docs/ README.md PRODUCT.md`, excluding `dist/`, `plans/`, `docs/history/` and `docs/_evidence/`. Known callers to update in this task:
      - `src/__tests__/{packaging,install-smoke}.test.ts`;
      - `packages/memory/fabric/src/__tests__/{package,host-wiring,deletion-propagation,source-repoint}.test.ts` and `packages/memory/fabric/package.json` (dev dependency);
      - `packages/memory/core/README.md`;
      - `scripts/{package-truth.mjs,package-truth.json,post-publish-smoke.mjs,budgets.json,e2e-coverage.json,live-matrix.json,coverage-summary.json,coverage-thresholds.json,release-evidence.json,phase29-freeze-manifest.json,independent-packages.json}`;
      - `scripts/{phase54-package-map.mjs,phase54-package-map.test.mjs,phase16-freeze.test.mjs,phase20-freeze.test.mjs,phase21-freeze.test.mjs,phase24-truth.test.mjs,phase27-release.test.mjs,phase38-codeql-regression.test.mjs,benchmark-multi-agent.test.mjs,wiki-scratch-isolation.test.mjs,e2e-full-surface.test.mjs}`;
      - `scripts/fixtures/e2e-full-surface-journey.mjs`;
      - `docs/{index,release,host-security}.md`, `README.md`.
      Frozen-history baselines (`scripts/compat-baseline/arnilo__prism-wiki.txt`, `arnilo__prism-memory.txt`, `scripts/phase13-baseline.json`) are 0.12 records. Task 1 confirms they are not regenerated, and the gate's attribution names them inherited.
    - Functional: **The new surface:**
      - config: `consolidate: { model?, minNotes?, maxSubjectsPerPass?, maxClaimsPerConcept?, maxOutputTokens? }` (Task 6), `ingest: { maxInputBytes?, maxExtractBytes? }`;
      - tool: `wiki_ingest` (Task 8 changes its target);
      - commands: `wiki:status`, `wiki:consolidate` (Task 6), `wiki:lint` (Task 7), `wiki:ingest` (Task 8). `wiki:status` reports the subject count, dirty subjects, the last pass and its cost per scope, and runs no model call.
      Exports shrink to the package default, `definition`, the config type, `WIKI_INGEST_TOOL_NAME`, the command name constants and the report types.
    - Functional: Host impact: **breaking for a host using the 0.12-era wiki surface.** None exists in the repository besides tests, and 0.13.0 is unpublished. `docs/migrate-to-0.13.md` gains a "Wiki → ontology tier" entry mapping each retired name to its replacement (`wiki_search` → `memory.recall`, `wiki_read_page` → `memory.read`, `wiki_record_insight` → `memory.insert`, `.wiki/` pages → concept notes).
    - Performance: Setup does no I/O beyond service lookup. The package no longer spawns `qmd` or walks the workspace.
    - Code Quality: Package layout per the native-package checklist (`references/prism.md` §4): `definePackage` default export, JSON Schema config with defaults, `requires.api: 1`, minimal `capabilities` (`models` for the pass, `commands`, `tools`, `state`; no `fs` outside the fabric root).
    - Security:
      - The package writes nothing outside the fabric's store and the `tools.root` sources directory.
      - No literal secret in config: `consolidate.model` is a model ref.
      - `wiki_ingest` keeps its SSRF check and its `web.fetch` requirement for URLs (Task 8).
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/wiki/src/{extension,index,exports,types,ingest}.ts`;
      - `scripts/compat-baseline/arnilo__prism-memory-wiki.txt`;
      - the grep results above (2026-10-31);
      - `docs/packages.md:55,85,121` (services and `missing_service`);
      - roadmap §1.4 (no compatibility aliases).
    - Options Considered:
      - Keep `wiki_search` and `wiki_read_page` as thin wrappers over `memory.recall` and `memory.read`. Rejected: two names for one operation; the roadmap forbids aliases.
      - Keep the regex code compiler for codebases. Rejected: it groups by parent folder name (564 files became `module-src`), points every anchor at one file (`compiler.ts:163`), and marks every hit stale (`context7-hydrator.ts:75`). Codebase mapping belongs to code-intelligence tools (plan 202 objective).
      - Keep the package standalone without the fabric. Rejected: it would keep a second store of record.
    - Chosen Approach:
      - Delete the parallel store in one task, sweep every caller, and leave a minimal package the next tasks fill.
    - API Notes and Examples:
      ```ts
      packages: [
        memoryObservational({ observer: { model: "hyper/claude-haiku-4-5" } }),
        memoryFabric({ preset: "coding", tools: { root: "./.prism/memory-local" } }),
        memoryWiki({ consolidate: { model: "hyper/claude-haiku-4-5" } }),
      ]
      ```
    - Files to Create/Edit:
      - `packages/memory/wiki/src/**`: deletions above; `extension.ts`, `index.ts`, `exports.ts`, `types.ts` rewritten; `commands/status.ts` (new);
      - `packages/memory/wiki/{package.json,README.md,CHANGELOG.md,skills/}`: `bin` and `skills` removed from `package.json` and `files`;
      - every caller in the sweep list;
      - `scripts/compat-baseline/arnilo__prism-memory-wiki.txt` regenerated with `bun scripts/release.mjs gate --update-baseline`; diff attributed to this plan in the note;
      - `docs/migrate-to-0.13.md`, `docs/index.md` (the wiki row's sentence), `README.md` (package table row), `CHANGELOG.md`.
    - References:
      - 2026-10-31 evaluation; Task 2.
  - Test Cases to Write:
    - `wiki_without_fabric_fails_closed_missing_service`.
    - `wiki_with_semantic_off_notes_and_registers_nothing`.
    - `retired_wiki_names_absent_repo_wide` (a grep test over the swept paths, excluding the frozen-history set).
    - `wiki_package_conformance` (package conformance suite from `@arnilo/prism/testing`).
    - `wiki_status_reports_counts_without_model_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the package's whole surface.
    - Docs pages to create/edit:
      - `packages/memory/wiki/README.md`: rewritten in the package page structure as the ontology tier;
      - `docs/migrate-to-0.13.md`;
      - `docs/index.md`: the wiki row's sentence;
      - `README.md`: the wiki row in the package table;
      - `docs/{release,host-security}.md` where they name retired tools or the bin;
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes — the `@arnilo/prism-memory-wiki` entry becomes "The ontology tier for Prism memory: concept notes over the fabric, consolidated from cited evidence."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The concept pass — background consolidation from T1 evidence into the ontology (wiki)
  - Acceptance Criteria:
    - Functional: **Triggers, per readable write scope** (`user`, `project`; `path` subjects live in `project`). Amended 2026-10-31: read-time selection is the primary trigger.
      - **Primary — co-read (read-time consolidation):** a set of notes co-read in ≥ `consolidate.minCoReads` (tuning, default 2) answering turns since the last pass (Task 4's `coRead` events). When the notes share a subject, that subject is dirty; when they are unbound, the cluster is a new-subject candidate. This mirrors reconsolidation: the memory that was just retrieved and used is the one updated.
      - **Secondary — accumulation:** a bound subject with ≥ `consolidate.minNotes` (tuning, default 5) T1 notes not yet consolidated, or an unbound cluster of ≥ `minNotes` notes sharing enrichment keys (plan 202 Task 5) with no subject. This catches subjects that will be needed but have not yet been asked about.
      - **Always — repair:** a concept marked dirty by the cascade (stale or removed claims).
      - `consolidate.triggers` (contract field; default `["co-read", "accumulation", "repair"]`) selects the policies; `"repair"` cannot be removed. Plan 208 Task 5 compares `co-read + repair` against all three on development partitions, and plan 210 removes a policy that shows no benefit.
      Checked at `session.opened` and `turn.completed`; a pass runs in `session.background("wiki.consolidate")` under one lease per scope, at most once per `consolidate.minIntervalTurns` (tuning, default 5). `wiki:consolidate` runs one now. A turn with no trigger does no work.
    - Functional: **One model call per dirty subject**, batched up to `maxSubjectsPerPass` (tuning, default 8) per pass. The call goes through the shared worker loop with one schema-declared tool, `edit_concept`. Input:
      - the concept's current claims with ids, relations and open questions (or none for a new subject);
      - the new or changed T1 notes for the subject (≤ 24, each capped at `maxEntryTextChars`, oldest last), each with its id, kind, scope, tRef and its evidence-link ids;
      - the scope's subject index (≤ 64);
      - for an unbound cluster, the cluster's notes and the instruction to propose a subject or decline.
    - Functional: **Edit operations only. There is no full-rewrite operation:**
      - `create_subject { subject, title, aliases, conceptType }`;
      - `bind { noteId, subject }`;
      - `add_claim { text, cites }`, `update_claim { claimId, text, cites }`, `retire_claim { claimId, reason }`;
      - `merge_claims { claimIds, text, cites }`, where `cites` must be the union of the merged claims' citations;
      - `add_relation { relation, target }`;
      - `add_open_question { text, cites }`, `note_contradiction { claimIds | noteIds, text }`.
      Rules the parser enforces:
      - every id must have been shown in this call;
      - every claim and question cites ≥ 1 shown note;
      - a claim ≤ 280 characters;
      - ≤ `maxClaimsPerConcept` (tuning, default 40) claims after the edit; above the cap only `merge_claims` and `retire_claim` are accepted (grow-and-refine);
      - a subject slug matches `[a-z0-9.-]{1,64}` and is unused in the scope.
    - Functional: **Prompt rules** (prompt text, one constant):
      - state only what the cited notes say;
      - prefer specific values with their dates over generalizations;
      - keep instances as instances ("visited a dermatologist 2023-03") and let counts come from them;
      - record disagreement as a contradiction, never resolve it silently;
      - nothing derivable from `AGENTS.md`, `README.md`, `package.json` or general knowledge the model already has.
    - Functional: **Fail closed:**
      - an invalid answer (bad shape, unshown id, uncited claim, cap breach) is rejected whole;
      - a shape-only failure gets one repair call with a safe `reasonCode`, the extractor's rule (`consolidation/extract.ts`);
      - output truncation is repaired once with "fewer, shorter edits";
      - a second failure, a trust or secret hit on any text, an abort or a worker limit writes nothing for that subject and leaves it dirty for the next trigger;
      - the pass reports `{ subjects, edits, rejected, modelCalls, correctionCalls, inputTokens, outputTokens, cacheReadTokens }` in `wiki:status` and one `wiki.consolidated` status event.
    - Functional: **Provenance.** Each written concept carries `generated: { by: consolidation, at }` and a `log.md` line naming the pass and the edit counts. A human-authored claim (`generated.by: human`) is shown to the model as read-only: the pass may cite it in a contradiction but never update or retire it.
    - Functional: **Model.** `consolidate.model` (contract field), or the agent's configured model when omitted, resolved through the package's static `models` declaration. Hosts that want a cheap curator name one.
    - Functional: Host impact: **none** without the package. With it, background model calls as stated in Performance.
    - Performance:
      - Per pass: ≤ `maxSubjectsPerPass` calls plus ≤ 1 repair each.
      - Input ≤ ~6k tokens per call at the caps. The system prompt and tool schema are byte-stable across calls: no per-call ids in the schema (plan 202 Task 4.12's extractor lesson).
      - Zero calls on a turn with no trigger.
      - The README states the cost per 1k archived exchanges at defaults, from plan 208's measurement, and the default that avoids it (not installing the package).
    - Code Quality:
      - `src/consolidate/{triggers,prompt,schema,pass}.ts`; the schema is the single source for the tool definition and the parser.
      - Writes go only through `FabricOntologyPort.applyConceptEdits`.
      - Reuses the fabric's worker-loop limits (`workerLimits`) through config, not a copy.
    - Security:
      - Note text is untrusted data inside the prompt's evidence envelope; the model is told never to follow instructions in it.
      - Every output text, alias and title passes the trust scan and redactor through the port; a hit drops that edit and is counted (`rejected.trust`, `rejected.secret`).
      - The pass reads only the scope it writes; it never reads `agent` or `team` notes to write `user` or `project` concepts.
  - Approach:
    - Documentation Reviewed:
      - fabric `consolidation/{pass,extract,prompts,write}.ts` (the lease, repair, truncation and per-item rejection rules this pass mirrors);
      - ACE (arXiv 2510.04618): Generator/Reflector/Curator, delta edits, grow-and-refine, context collapse under monolithic rewrites;
      - Letta sleep-time compute (letta.com/blog/sleep-time-compute; docs "Sleep-time agents"): background consolidation into shared memory, every N steps;
      - Karpathy's LLM wiki pattern (2026-04): compiled pages with source attribution, disagreements and open questions;
      - DRM / fuzzy-trace theory: gist produces plausible false memories, so claims must cite;
      - Wilhelm et al. 2011 (*J Neurosci* 31:1563) on consolidating what is expected to be used, with the failed online replication noted, which is why use is one trigger among several and not the only one.
    - Options Considered:
      - Regenerate each page from all its notes. Rejected: context collapse and summarization drift (ACE), and it would overwrite human edits.
      - Consolidate on every write. Rejected: cost and noise; most notes never matter twice.
      - Run the pass inside the fabric. Rejected: the fabric would gain a second write-path model call under its presets' contracts. The ontology tier is the opt-in package.
      - One call for the whole scope. Rejected: unbounded input, and one bad subject would fail the batch.
    - Chosen Approach:
      - A curator pass per dirty subject with a closed set of cited, incremental edits, validated whole and written through the fabric's port.
    - API Notes and Examples:
      ```json
      { "edits": [
        { "op": "add_claim", "text": "Saw a dermatologist on 2023-03-14.", "cites": ["c2a9f0e1b3d4"] },
        { "op": "add_relation", "relation": "part-of", "target": "health" }
      ] }
      ```
      ```sh
      /wiki:consolidate          # one pass now, all dirty subjects in readable write scopes
      /wiki:status               # subjects, dirty, last pass, calls and tokens
      ```
    - Files to Create/Edit:
      - `packages/memory/wiki/src/consolidate/{triggers,prompt,schema,pass}.ts` (new);
      - `packages/memory/wiki/src/{extension,types}.ts`, `src/commands/consolidate.ts` (new);
      - tests (mock provider with scripted `edit_concept` replies);
      - wiki README, `CHANGELOG.md`.
    - References:
      - Tasks 2–5; plan 188.3 (extractor); plan 202 Task 4.12.
  - Test Cases to Write:
    - `co_read_cluster_marks_subject_dirty_before_accumulation_threshold`.
    - `trigger_policy_config_never_drops_repair`.
    - `pass_runs_only_on_trigger_and_never_on_quiet_turns`.
    - `uncited_claim_or_unshown_id_rejects_whole_answer`.
    - `shape_failure_repaired_once_then_left_dirty`.
    - `truncation_repaired_with_fewer_edits`.
    - `over_cap_accepts_only_merge_and_retire`.
    - `merge_requires_union_of_citations`.
    - `human_claim_is_read_only_to_the_pass`.
    - `trust_hit_drops_edit_and_counts_it`.
    - `pass_never_reads_wider_scope_to_write_narrower`.
    - `system_and_tool_segments_byte_stable_across_calls` (cache).
    - `unbound_cluster_creates_subject_and_binds_notes`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — background model calls, config fields, commands, an event.
    - Docs pages to create/edit:
      - wiki README (`## What it changes`, `## Cost, security, and failure behavior` with per-pass calls and the default that avoids them, `## Configuration` with tiers);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Claim lint, human curation and the team ontology (wiki and fabric)
  - Acceptance Criteria:
    - Functional: **`wiki:lint [scope]`** is read-only and makes no model call. It reports per concept:
      - claims whose citations no longer resolve or are stale;
      - uncited human claims;
      - claims citing only `candidate` notes;
      - relations to missing subjects;
      - subjects with more than `maxClaimsPerConcept` claims;
      - team concepts with `shared-without-evidence` citations;
      - duplicate subjects by alias collision;
      - unbound T1 notes older than N passes (an ontology gap).
      It exits `ok: false` only for unresolved citations and alias collisions. Everything else is maintainer work.
    - Functional: **Human edits.** Reconcile (the fabric's existing external-edit path) re-parses an edited concept file:
      - stamps `generated.by: human` on claims whose text changed;
      - runs the trust scan (a hit quarantines the concept as `candidate` with `flags`, the existing rule);
      - rejects an edit that breaks the codec by keeping the last valid version and logging `invalid-concept` in `log.md` (the "Notes written by a newer version" rule keeps unknown keys).
    - Functional: **Team ontology.** Concepts shared with `memory:share` (Task 4) live in `.prism/memory/` and are reviewed like code. Lint runs on them. The pass never edits a team concept; it may note a contradiction between a private concept and a team concept in the private concept.
    - Functional: Host impact: **none**.
    - Performance: Lint is one metadata scan plus one citation-index lookup per concept: ≤ 2 s for 2,000 concepts (measured).
    - Code Quality: The lint rules live in one table in `src/lint.ts`. Reconcile changes stay in the fabric's existing reconcile module, reusing the codec.
    - Security: A human edit never bypasses the trust scan. A quarantined concept is never delivered.
  - Approach:
    - Documentation Reviewed:
      - fabric `reconcile.ts`, `delivery/team.ts`, README `### The team store`, `## Notes written by a newer version`;
      - the old wiki linter's checks (dead anchors, broken links, orphans, pruned sources) as the starting list, re-cut for cited claims.
    - Options Considered:
      - Let the pass repair human edits. Rejected: a person's correction must outrank the curator.
    - Chosen Approach:
      - A deterministic health report and the fabric's existing human-edit and quarantine rules applied to concepts.
    - API Notes and Examples:
      ```sh
      /wiki:lint project
      ```
    - Files to Create/Edit:
      - `packages/memory/wiki/src/{lint,commands/lint}.ts` (new);
      - `packages/memory/fabric/src/reconcile.ts`;
      - tests;
      - wiki and fabric READMEs, `CHANGELOG.md`.
    - References:
      - Tasks 2, 4, 6; plan 188.5 Task 3.
  - Test Cases to Write:
    - `lint_reports_each_rule_and_fails_only_on_unresolved_or_collision`.
    - `human_edit_stamped_and_trust_scanned`.
    - `codec_breaking_edit_keeps_last_valid_and_logs`.
    - `pass_never_edits_team_concepts`.
    - `lint_under_2s_for_2000_concepts` (performance).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a command and human-edit behavior for concepts.
    - Docs pages to create/edit:
      - wiki README (`wiki:lint`, curation);
      - fabric README (`### The team store`: concepts);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Source ingest into the ontology (wiki)
  - Acceptance Criteria:
    - Functional: `wiki_ingest { text | path | url, title? }` and `wiki:ingest` stage the original and a UTF-8 extract under `<tools.root>/sources/<utc>-<slug>/`. They keep today's rules (`ingest.ts:143–289`): workspace containment for `path`, SSRF check plus the `web.fetch` service for `url` (fail closed without it), the built-in PDF parser, image stubs, byte caps, and fail-closed unknown formats. The extract becomes a fabric `file` note in `project` scope through the existing file-note indexing.
    - Functional: The file note is bound by Task 3's deterministic binding when unambiguous. The ingest marks the bound or clustered subjects dirty, and the result tells the agent the source is queued for the next pass (or that `wiki:consolidate` files it now). The agent no longer files pages by hand; the old filing brief is deleted.
    - Functional: Claims citing a source cite the file note id. Forgetting the file note cascades (Task 2), which is the "revoked source stays revoked" rule of the old linter, now enforced by the store.
    - Functional: Host impact: hosts that called `wiki_ingest` keep the tool name and inputs. The result shape changes (Task 5 migration entry).
    - Performance: One staged write and one file-note index per ingest. No model call at ingest time; the pass pays for consolidation.
    - Code Quality: `ingest.ts` keeps its extraction matrix; only the staging root and the follow-up change.
    - Security: The content is marked `untrusted_external` as today. The source's text is evidence, never instructions; the pass prompt's envelope applies. The trust scan runs when the file note is indexed.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/wiki/src/{ingest,tools/ingest}.ts`, `src/commands/ingest.ts`;
      - fabric `files.ts` (jail, caps) and file-note indexing;
      - Karpathy's raw/ layer (immutable sources) as the model.
    - Options Considered:
      - Keep a separate `raw/ingest` tree in the workspace. Rejected: a second root outside the fabric's jail and its cascade.
    - Chosen Approach:
      - Sources are T1 evidence like any other note; the ontology cites them.
    - API Notes and Examples:
      ```json
      { "tool": "wiki_ingest", "input": { "url": "https://example.com/runbook.pdf", "title": "Payments runbook" } }
      ```
    - Files to Create/Edit:
      - `packages/memory/wiki/src/{ingest,tools/ingest,commands/ingest}.ts`;
      - tests;
      - wiki README, `CHANGELOG.md`.
    - References:
      - Tasks 2, 3, 6.
  - Test Cases to Write:
    - `ingest_stages_under_tools_root_and_indexes_file_note`.
    - `ingest_url_without_web_fetch_fails_closed`.
    - `ingest_marks_subject_dirty_and_pass_cites_file_note`.
    - `forgetting_source_removes_its_claims`.
    - `path_outside_workspace_rejected` (kept from today's suite).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the ingest target and result.
    - Docs pages to create/edit:
      - wiki README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: The three-tier stack end to end — OM as T0, example, reference host option and positioning docs
  - Acceptance Criteria:
    - Functional: **The stack.** The documented composition is OM + fabric + wiki:
      - OM observes (T0); the fabric archives exchanges and, with `promote: { observational: true }`, receives OM reflections as candidate facts that earn trust by use (existing behavior);
      - the wiki consolidates T1 into concepts (T2).
      Plan 202 Task 16 measures OM's quality in this role; this task only composes and documents it.
    - Functional: **Example.** `examples/three-tier-memory.ts` runs on the mock provider, deterministically, and shows:
      1. three sessions of scripted turns;
      2. notes bound to a subject;
      3. a pass creating a concept with cited claims;
      4. a fourth session whose `memory.recall` returns the concept first and drills down to an exchange;
      5. a `memory.forget` removing the dependent claim.
      It emits no secret and passes the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`).
    - Functional: **Reference host.** `apps/prism-agent` coding and research agents gain an opt-in `ontology: true` option (default off until plan 210's verdict). It adds `memoryWiki()` next to the existing fabric, using the agent's model unless `ontologyModel` is set. A deterministic scenario on the mock provider covers recall-through-concept across sessions. `bun run --filter @arnilo/prism-agent test` stays green.
    - Functional: **Positioning docs**, written as the current contract with no plan narrative:
      - `PRODUCT.md` gains a short "Memory" subsection: three tiers over one store, what each tier holds, how an agent reads them (concepts first, drill down), what stays opt-in, and the cost;
      - the fabric, wiki and OM READMEs each open their tier's role in one paragraph and link the other two;
      - `README.md` and `docs/index.md` rows for the three packages describe their tier.
      Claims of quality wait for plan 210's held-out verdict.
      - **Amended 2026-10-31:** this task writes the three-tier description only. Plan 210 Task 10 (moved from plan 209 Task 7) reorders `PRODUCT.md`'s Memory subsection to lead with standing rules, then search over the record, then the ontology tier, following the 2026-10-31 assessment that standing rules are the layer users notice most. The ordering here must leave room for that: rules, record, ontology, as three short paragraphs.
    - Functional: Host impact: **none** by default.
    - Performance: The example finishes in ≤ 30 s. The host option adds the wiki's background cost only when on.
    - Code Quality: The reference host imports only public package surfaces (`reference_host_imports_only_public_surface`). No ontology logic in the host.
    - Security: The example and scenario use fixture text only. The host option names a model ref, never a key.
  - Approach:
    - Documentation Reviewed:
      - `apps/prism-agent/src/host/{coding,research}.ts:8–50`;
      - `examples/README.md`, `scripts/e2e-coverage.json`;
      - OM README "Related packages" (promotion);
      - complementary learning systems (McClelland, McNaughton & O'Reilly 1995; Kumaran, Hassabis & McClelland 2016) as the explanatory frame, without claiming a measured benefit.
    - Options Considered:
      - Make the ontology a fabric preset. Rejected for now: presets are fabric contracts, the ontology needs a second package, and its default is plan 210's decision on plan 208's criteria.
    - Chosen Approach:
      - Compose, demonstrate and document; leave defaults to the evidence.
    - API Notes and Examples:
      ```ts
      await createCodingAgent({ ...config, memory: "coding", ontology: true });
      ```
    - Files to Create/Edit:
      - `examples/three-tier-memory.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`;
      - `apps/prism-agent/src/host/{coding,research,config}.ts`, a scenario under `apps/prism-agent/src/scenarios/`, `apps/prism-agent/README.md`;
      - `PRODUCT.md`, `README.md`, `docs/index.md`;
      - fabric, wiki and OM READMEs;
      - `CHANGELOG.md`.
    - References:
      - Tasks 2–8; plan 202 Task 16; plan 208.
  - Test Cases to Write:
    - `three_tier_example_runs_and_emits_no_secret` (execution gate).
    - `reference_host_ontology_option_recalls_concept_across_sessions` (mock provider).
    - `reference_host_ontology_off_by_default`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a host option and the documented memory architecture.
    - Docs pages to create/edit:
      - `PRODUCT.md`, `README.md`, `docs/index.md` (three memory rows);
      - fabric, wiki and OM READMEs;
      - `apps/prism-agent/README.md`, `examples/README.md`;
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes — the fabric, wiki and OM rows name their tier.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/wiki test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 300 bun test packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
- `timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/207/prefix-probe.json` (the ontology scenario: one prefix hash per epoch)
- `timeout 120 bun examples/three-tier-memory.ts`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/packaging.test.ts`
- `timeout 300 bunx biome check <changed files>`
- `timeout 1800 bun scripts/release.mjs gate` (fabric, core and wiki baseline diffs attributed to this plan)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
