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

- [x] Task 1: Review, assumption check and contract inventory (read-only)
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
  - Notes (executed 2026-11-03; read-only, no code or file outside this plan changed):
    - **(d) Verdict: proceed, with the amendments written into Tasks 2, 3 and 5.** Every objective is expressible with existing contracts; no kernel change. Two assumptions (2 and 4) failed as worded and changed Task 2's scope. The working tree has uncommitted edits in `types.ts` and elsewhere, so the line numbers below are those of 2026-11-03 and several differ from this plan's earlier citations.
    - **(a) Inventory** (`file:line`, 2026-11-03):
      - Kinds and codec: `MemoryNoteKind` `packages/memory/fabric/src/types.ts:30`, `MEMORY_NOTE_KINDS` `:35`, `DEFAULT_RECALL_KINDS` `:117` (a whitelist: `fact, preference, file, exchange`), `MemoryNoteLink` `:125` (`id`, `relation?`, `weight?`), `MEMORY_NOTE_METADATA_KEY` `:120`, `unreadableNoteReason` `:823`, `isMemoryNoteKind` `:831`, `parseMemoryNoteMetadata` `:903` (kind check `:914`; known-key list ends `:~815`; unknown keys are kept, `:1042`). "Notes written by a newer version": fabric README `:1228`. `Needs a new name or an explicit opt-in`: README `:1560` (a new stored kind is listed); `Config stability` README `:1567`, checked by `__tests__/stability.test.ts`.
      - Setup (`index.ts`): `definePackage` `:146` with capabilities `session-state, credentials, models, background, host-ui` (`:153`); one process-wide `createMemory` per active scope `:214–225`; tools `:540`; hooks `:558–666`; commands `:719–759`. Background jobs: `fabric.exchange` `:594`, `fabric.consolidate` `:664,685`, `fabric.touched-paths` `:690`, `fabric.lifecycle` `:706`. Lease: `createConsolidationLease` `consolidation/pass.ts:108` (one pass per session, a second trigger is dropped). The fabric currently provides no service; it consumes `embeddings` (`:184`) and `memory-fabric.diagnostics` (`:249`).
      - Recall and delivery: `scope/recall.ts` `resolveScopePriors :26`, `priorFor :77`, `createScopeRecall :114`, `selectWithScopeReserve :214`; recall kind parsing `recall.ts:67–82` (`["all"]` expands to `MEMORY_NOTE_KINDS`, `:74`); directory `DIRECTORY_NOTE_KINDS directory.ts:39`, `PLURAL :237`, write and retraction counters `:64,76`, snapshot `:223`; core `DEFAULT_CORE_KINDS delivery/core.ts:42`, `createFabricCore :198`; cues `createFabricCues delivery/cues.ts:178`; `memory:share` `createFabricTeam delivery/team.ts:126`, `share :205`, registered `index.ts:724` with `host.ui`; epoch snapshot `context.ts:349–392` (key: sum of retraction versions).
      - Extractor: `EXTRACT_NOTE_KINDS`/schema `consolidation/prompts.ts:129–175` (`aliases` already present), prompt builder `:108`, system constants `:42–60`; `extract.ts` `recallExisting :180`, `loadExisting :361`, request `:270–282` with `cacheKey :280`, parse `:490–518`.
      - Deletion: `DeletionPropagationHandler packages/memory/core/src/propagation.ts:48`, `createDeletionPropagator :82`, `register :100`; wiki handler `packages/memory/wiki/src/retire.ts:124` (`createWikiDeletionHandler`), `retireWikiSources :52`. Fabric `forget memory.ts:534` → `forgetEntries` → `markInvalidated :118` (fires `options.onInvalidate`, `:141`).
      - Markdown store: `KIND_DIRECTORIES packages/memory/core/src/fabric/layout.ts:13` (fact, preference, procedure, episode, exchange; `decision` and unmapped kinds land in `entries/`), `isNoteRelPath :150`, OKF render/parse `fabric/okf.ts:142–240`, SQLite index `sqlite/ddl.ts:34–44` (FTS5 over `lex_text` and `lex_keys`, keys weighted 3×, `sqlite/index.ts:331`).
      - Wiki surface: `scripts/compat-baseline/arnilo__prism-memory-wiki.txt`, 81 lines, confirmed. Callers outside the package: 42 files by grep (including frozen history and reports); the additions to Task 5's list are recorded in Task 5.
      - Kernel services: `docs/packages.md:55` (`requires.services`), `:85` (load step 7), `:121` (`services.provide/consume/require`); `src/packages/loader.ts:867–891` (the service registry), `:989–1000` (the post-setup check).
    - **(b) Classification.** Expressible with existing contracts: the `concept` kind and `subject` (fabric-owned, additive), the cascade (a fabric-internal listener, see assumption 4), `memory.fabric` (`services.provide`), the background pass (`session.background`, `models`), source ingest, claim lint and commands. **No kernel addition is needed.**
    - **(c) Assumption verdicts:**
      1. **Confirmed.** `requires.services` is checked after every `setup` (`loader.ts:989–1000`) and raises `missing_service` naming the package; `services.consume` sees a later package's service at call time (`docs/packages.md:121`; `package-loader.test.ts:278,673–707`). The check does not order setups, so the wiki consumes the service lazily, never in its own `setup`. Task 5 pins it against the real fabric.
      2. **Not true as written; Task 2 amended.** Recall is a whitelist, so an untyped `recall`, the directory (`:39`) and the core (`:42`) never see a new kind. But adding `concept` to `MEMORY_NOTE_KINDS` also (i) puts it in `kinds: ["all"]` (`recall.ts:74`), (ii) puts it in the recall tool's kind schema (`tools.ts:83`), (iii) makes `remember` accept it (`create.ts:718`), and (iv) leaves the lifecycle kind-agnostic: `merge.ts:43` treats any unpinned note with text as a merge candidate, and `archive.ts:63`, `capacity.ts:65` and `strength.ts:150` give an unknown kind the `fact` decay. A concept would be decayed, archived or merged by `memory:maintain` unless exempted. Task 2 lists the guards and tests each. The codec itself is safe: an older reader refuses a note with an unknown kind as `invalid-fabric` and keeps it byte for byte.
      3. **Confirmed with a one-line change.** `KIND_DIRECTORIES` has no `concept`; an unmapped kind lands in `entries/`. `concept: "concepts"` goes there. `isNoteRelPath` derives from the same map. The FTS index covers text and keywords for any kind. A `subject` field needs a frontmatter line in `okf.ts` (as `keywords` has at `:154,223`) and the known-key list in `types.ts`. Task 2 tests the round trip.
      4. **Not true as written; Task 2 amended.** There is no single place that carries ids. `noteMemoryRetraction` (`directory.ts:76`) is a counter, called at `memory.ts:134,139,454,477,527,541,697` and `okf-bundle.ts:183,251`. The id-carrying hook is `onInvalidate` (`memory.ts:141`), and it covers forget, correct, revoke and legal hold only. Archive, flag, `validTo` and status changes (`patchEntry`, `memory.ts:430–456`), retention (`:697`) and import-replace do not pass through it. Task 2 adds an `onRetract({ ids, reason })` fired at each of those four sites, awaited before the call returns, so the cascade stays synchronous. A read-time live check on delivery stays as the second line: a claim whose cited ids are not all readable is not delivered.
      5. **Holds, with a placement rule; Task 3 amended.** The cached segments are `system`, the tool and its schema; `existing` and the candidates are in the per-call `prompt` (`extract.ts:210–213`). A subject list placed in the `prompt` leaves the cached bytes unchanged. Caveats: the schema's `maxItems` follows `maxNotes` (`prompts.ts:155`), and today's pin test (`consolidation/__tests__/extract.test.ts:97`) compares only the `cacheKey`, not the encoded `system` + tool bytes. Task 3 adds that byte pin.
      6. **Holds for additive writes; one rule for the pass.** The epoch snapshot (`context.ts:349–392`) is keyed by the sum of `memoryRetractionVersion`, and plain writes (`noteMemoryWrite`) do not end it (`prefix-stability.test.ts:287`, `:370`). The concept pass must therefore edit a concept in place (an upsert, which does not retract) and must not archive or supersede one per edit, or every session's prefix would rebuild. Retiring a whole concept is a retraction and is allowed to end epochs. Task 6 inherits the rule; the pin test is `fabric_prefix_survives_concept_writes`.
      7. **Mostly landed; two substitutes.** 202 Task 5 (closed by owner disposition) shipped deterministic entity/date/unit keyword enrichment at archive time into the existing `keywords` field plus the extractor's `aliases`; there is no new note field, so deterministic binding (Task 3) matches slug, title and alias against `keywords`/`aliases`/text. 202 Task 7 shipped read-time state grouping (`state.ts`, `recall.ts`) over `key` and `supersedes`; reconsolidation reuses those. 202 Task 11 shipped the `decision` kind (`types.ts:30`, `MemoryDecisionStatus`). **202 Task 13 closed without implementation: there is no `same-subject` relation**, so Task 3 adds none and the existing `related`/`part`/`supersedes` links are all there is. The substitute for `same-subject` is the concept's own citations.
    - **Trust boundaries each later task relies on:** write-path content scan `scanScopedMemoryContent` (`scoped/trust.ts:37`) for every concept and claim write (Tasks 2, 6, 8); the fabric redactor (`redactJson`, applied on `memory.ts` reads and writes) for delivery (Task 4); scope readability and consent (`recordBlocked`, `consent.visible`, `memory.ts:430–440`) for the delivery-time citation check (Tasks 2, 4); `host.ui` approval in `memory:share` (`delivery/team.ts:205`, `index.ts:724`) for sharing concepts (Task 4, Task 7); `tools.root` as the only filesystem boundary for source ingest (Task 8).
    - **Documentation reviewed:** the code spans above, `docs/packages.md:50–124`, roadmap rows `:613,615,1878,2432` (they agree with this plan, including `services.provide("memory.fabric")`), the fabric README sections `Notes written by a newer version`, `Compatibility` and `Config stability`, plan 202's Task 5/7/11/13 notes and its Structure decision. The wiki README and the 2026-10-31 evaluation were not re-read: Task 5 retires that surface and needs only its export list, which the 81-line baseline gives.
    - **Baseline diff / sweep:** none (read-only). The Task 5 sweep list grew by five files (recorded there).

- [x] Task 2: The `concept` kind, the `subject` field, the deletion cascade and the `memory.fabric` service (fabric)
  - Acceptance Criteria:
    - Functional: **Amended by Task 1 (2026-11-03), kind guards.** A listing in `MEMORY_NOTE_KINDS` is not opt-in by itself. Task 2 also:
      - excludes `concept` from `kinds: ["all"]` (`recall.ts:74`), from `RECALL_TOOL_KINDS` (`tools.ts:83`) until the ontology option is on, and from `remember`'s kind check (`create.ts:718`);
      - adds `concept: "concepts"` to `KIND_DIRECTORIES` (`packages/memory/core/src/fabric/layout.ts:13`; today an unmapped kind lands in `entries/`);
      - exempts `concept` from `lifecycle/merge.ts:43` (merge candidates), the decay-based archive and eviction (`archive.ts:63`, `capacity.ts:65`, `strength.ts:150`, which fall back to the `fact` decay) and the `maintain.ts:523` regular-note set; the concept pass alone changes or retires a concept;
      - keeps `DIRECTORY_NOTE_KINDS` (`directory.ts:39`) and `DEFAULT_CORE_KINDS` (`delivery/core.ts:42`) unchanged; Task 4 decides what the directory says about concepts.
    - Functional: **Amended by Task 1, retraction hook.** `noteMemoryRetraction` (`directory.ts:76`) is a counter without ids, so it cannot carry the cascade. The cascade listens on a new id-carrying `onRetract({ ids, reason })` fired from `markInvalidated` (beside the existing `onInvalidate`, `memory.ts:141`: forget, correct, revoke, legal hold), from `patchEntry` when `retracts` is true (`memory.ts:454`: archive, flag, `validTo`, status change), from `applyRetention` (`memory.ts:697`) and from `okf-bundle.ts:183,251` (import with `mode: "replace"`). Tests pin each of the four sites.
    - Functional: **Amended by Task 1, service shape.** The fabric is built once per package setup (`index.ts:214–262`), so `memory.fabric` is provided during `setup` as one process-wide object. The consumer reads it at call time (`services.consume`), never during its own `setup`. Existing precedent for naming and consumption: `memory-fabric.diagnostics` (`index.ts:249`).
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
      - `packages/memory/core/src/fabric/{layout,okf}.ts`: `concept: "concepts"` and the `Concept` OKF type with `subject`, `concept_type`, `aliases` and cited `sources` frontmatter (executed: no store column; the citation index lives in the fabric, see the Notes);
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
  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Kind and codec* (`types.ts`): `concept` joins `MemoryNoteKind` and `MEMORY_NOTE_KINDS`. New fabric fields `subject` (any kind), and on a concept `title`, `conceptType`, `aliases` (≤ 16), `sources`, `stale`, `dirty`. A concept without `subject`, `title` and `conceptType`, a non-concept with a concept-only field, or a concept link outside `part-of`/`instance-of`/`uses`/`related` fails the parse (unreadable, kept byte for byte). New actor `consolidation` for `generated.by`. `MemoryFabricRememberInput.subject` binds a T1 note at write time.
      - *Body codec* (`ontology/codec.ts`): one line per item, `- [c1] text[^<noteId>]…`; `q<n>` open questions and `x<n>` contradictions sit under their `##` headings. A body outside this grammar is rejected. Render is deterministic and `parse(render(doc)) == doc`.
      - *Retraction event* (`ontology/retract.ts`): `emitMemoryRetract(memory, { ids, reason })`, awaited before the retracting call returns. Wired at five sites: `markInvalidated` (forget, correct, revoke, legal hold, with and without a lineage store), `patchEntry` when it retracts (archive, supersede, downgrade, flag), `applyRetention`, `importMemoryOkf` (replace deletions, imported tombstones, and an always-fired `import` that rebuilds the index), and the supersede branch of `rememberIndexed`. Reasons that remove claims: `forgotten`, `deleted`, `revoked`, `legal_hold`, `import`; the rest mark stale.
      - *Cascade* (`ontology/cascade.ts`): finds citing concepts in the per-scope index, rewrites with a direct store upsert that keeps the old embedding (no model and no embedding call), recomputes `sources`, drops stale ids of removed items, marks `dirty`, archives a concept with no claim left, and ends pinned epochs. A body a person broke is scrubbed line by line rather than skipped.
      - *Index* (`ontology/state.ts`): `cited id → concept ids`, built lazily from one `scanMetadata` pass (or `getByThread`), then kept current by the port and the cascade; an import invalidates it.
      - *Port* (`ontology/port.ts`): `FabricOntologyPort` with `scopes`, `subjects`, `pending`, `read`, `applyConceptEdits`, `bind`, `dirty`, exactly the plan's shape; the nine-operation edit vocabulary (`create_subject` … `note_contradiction`) is validated whole before anything is written. `createFabricOntology` also exposes `retract` and `attach`. Provided as `memory.fabric` in `setup` whenever `semantic` is on, and `createConceptDeletionHandler` as `memory.fabric.concept-deletion` for hosts that build a propagator. `attach` is also called for scopes opened later by `openScope`.
      - *Guards:* `kinds: ["all"]` skips `concept`; the recall tool schema omits it and the tool refuses a named `concept`; `remember` throws `ConceptRequiresOntologyError` (`code: "concept_requires_ontology"`); `memory.insert`, `memory.replace` and `memory.forget` answer `concept_requires_ontology`; `shouldArchive`, `mergeable`, `evictionOrder` and the `memory:maintain` scan skip concepts. `DIRECTORY_NOTE_KINDS` and `DEFAULT_CORE_KINDS` were left unchanged.
      - *Core* (`layout.ts`, `okf.ts`): `concept: "concepts"`; type `Concept`; frontmatter `subject`, `concept_type`, `aliases` and `sources` (cited ids) for a concept. Core exports are unchanged (gate passes for `@arnilo/prism-memory-core`).
    - **Findings that affect later tasks (amended where noted):**
      - *The citation index lives in the fabric, not in a store column.* No `VectorStore` method was added, so no store author has anything new to implement. A retraction lookup is a map read (0.0009 ms with 2,000 concepts, measured on the in-memory store; the one-time build is 17 ms). The 5 ms target is met by a wide margin, but **the build was not measured on SQLite or Postgres**; plan 208's scale run should record it. The index is in-process, so a second process editing concept files is invisible until `invalidate()`; Task 7's human-edit path must call it.
      - *`scanMetadata` returns only rows with `consent.visible === true`.* A concept written through the port gets the default consent from `memory.remember`; any other writer (Task 7 reconcile, `memory:import`, `memory:share`) must set it or the concept will not appear in `subjects()`.
      - *Task 3:* `pending()` pages by `createdAt|id`, so a note bound after it was first seen is not offered again. Binding therefore marks the concept `dirty: ["evidence"]`, and Task 6's accumulation trigger should read `dirty()` plus `pending()`, not `pending()` alone.
      - *Task 4:* `memory.recall { kinds: ["concept"] }` is refused with `concept_requires_ontology` until the ontology option exists; Task 4 replaces that refusal with the option check and adds `concept` back to the tool schema when it is on. The `(stale)` and `(uncited, human)` labels are exported from the codec as `describeItem` for Task 4's rendering.
      - *Task 7:* reconcile of a person's edit to a concept file is **not** in this task. The markdown store re-reads the file, but nothing yet re-derives `sources` from the body, stamps `generated.by: human`, or rescans the index. Task 7 owns it and the claim lint.
      - *`path`-scope concepts:* `create_subject { appliesTo }` stores the concept as a `path`-scope note in the project (the note codec ties `appliesTo` to `scope: "path"`), so Task 6's "path subjects live in `project`" holds.
      - *The supersede branch of `rememberIndexed` emits `superseded` but has no test of its own:* it is reached only through the P2 model decider, which has no offline fixture here. Supersession through `patchEntry` (lifecycle `supersede`, `archive`) is tested.
    - **Tests (all in `__tests__/ontology.test.ts`, 17 cases):** the plan's eleven names, plus `concept_is_invisible_to_every_path_that_does_not_name_the_kind`, `lifecycle_never_archives_merges_or_evicts_a_concept`, `edits_cover_create_update_merge_relation_contradiction_and_refuse_unsafe_text`, `bind_marks_the_note_and_the_concept_dirty` (with `pending`/`read` filtering), `retention_and_import_replace_carry_ids_into_the_cascade` and `rejects_free_text_outside_the_grammar`. `no_concepts_means_byte_identical_recall_and_prefix` compares recall bytes with and without the ontology attached; the prefix half is pinned by the existing `prefix-stability.test.ts`, which now runs with the cascade listener attached. `cascade_runs_without_the_wiki_package_installed` loads the real package, with no wiki package, and finds the service.
    - **Verification.** `bun run typecheck` clean across the workspace. Fabric suite 602 pass / 29 PostgreSQL skips; memory-core 63 pass; `src/__tests__/docs.test.ts` 65 pass; wiki 80 pass; `scripts/memory-bench` 416 pass. Failures seen that are **not** from this task: `scoped/__tests__/reviewer.test.ts` "a duplicate folds" is flaky (it compares ISO timestamps with `<` at `scoped/reviewer.ts:157`, so a same-millisecond write counts no duplicate; it passed alone three times and in two of three full runs); `apps/prism-agent` `conversational_memory_scenario_recalls_across_sessions_and_forgets` fails because `memory.recall`'s abstention line echoes the query term the test asserts is absent (plan 202 Task 9's output, in files already uncommitted before this task); `scripts/memory-bench` `Task5Manifest: the candidate product has uncommitted changes` needs a clean tree.
    - **Baseline diff** (`bun scripts/release.mjs gate --package @arnilo/prism-memory-fabric --update-baseline --skip-tarball`, fabric only; the full gate also fails on the kilo and ollama-cloud baselines and the kernel size budgets, none of them from this task, so those baselines were not regenerated). Attribution: every added line is this plan's ontology surface (`CONCEPT_RELATIONS`, `CONCEPT_TYPES`, `CONCEPT_DIRTY_REASONS`, `ConceptFormatError`, `ConceptRequiresOntologyError`, `MEMORY_FABRIC_SERVICE`, `MEMORY_FABRIC_CONCEPT_HANDLER_SERVICE`, `createFabricOntology`, `createConceptDeletionHandler`, `parseConceptBody`, `renderConceptBody`, `conceptSources`, the port, edit and result types, `MemoryRetractEvent`/`Reason`, and internal helpers the declaration scan also lists). The only removed lines are the barrel's re-export lines whose text changed because the new names joined them; no name was removed. The working-tree baseline already differed from the committed one (77 lines from plans 202); the update folds those in as well, which the diff against the pre-update file excludes.
    - **Sweep.** No retired name. `MemoryNoteDecay` now types `concept` as optional (`DEFAULT_DECAY` has no concept entry, so `config_defaults_match_evidence` stays green).

- [x] Task 3: The ontology index and schema-assisted subject binding (fabric)
  - Acceptance Criteria:
    - Functional: **Amended by Task 1 (2026-11-03), extractor cache.** The extractor's cached segments are the `system` text, the tool and its schema; `existing` and the candidates travel in the per-call `prompt` (`extract.ts:210–213,271–279`). The per-scope subject list therefore goes into the `prompt` beside `existing`, never into `system` or the schema, and the schema's `subject` property is a free string with no enum. A pin test compares the encoded `system` + tool bytes with and without an ontology. The schema already varies with `maxNotes` (`prompts.ts:155`); the pin holds that value constant. Plan 202 Task 13 closed without `same-subject`, so this task adds no such relation: concept citations are the association.
    - Functional: **Ontology index per scope**: subjects with their aliases, built from concept notes by one metadata scan, cached until a concept write, and **snapshotted per session epoch** for every prompt-visible use (the same epoch as plan 202 Task 4.12's prefix snapshot).
    - Functional: **Deterministic binding at write time**, with no model call. When a T1 note (`exchange`, `fact`, `preference`, `procedure`, `decision`, `file`) is written without a `subject`, the fabric tests its text and keys against the scope's index:
      - a match is a whole-token, case-folded hit on a subject slug, title or alias, also counting plan 202 Task 5's enrichment keys;
      - exactly one subject at or above `ontology.bindThreshold` (tuning, an integer in [1,8], default 2: ≥ 2 matched tokens of one name, or every token of one multi-token name, "an exact alias") binds the note;
      - zero or several candidates leave it unbound for the concept pass to decide.
    - Functional: **Extractor-assisted binding** when the fabric's consolidation extractor runs (`promote` on): the prompt carries the epoch's subject list (≤ 64 subjects per scope, title and up to 4 aliases each), and `record_notes` gains an optional `subject` field restricted to shown slugs or the literal `new`. A slug that was not shown is dropped, and the note stays unbound (it is not rejected).
    - Functional: **Directory line.** With at least one concept in a scope, the memory directory adds one line per scope: `<level> concepts: N; subjects: a, b, c (+k)`, ordered by use (recorded uses of the concept, then the notes it cites, then name). It stays inside the existing directory budget (default 200 tokens, hard 500) and is pinned for the epoch like the rest of the block.
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
      - ~~`scripts/memory-bench/prefix-probe.mjs` (an ontology scenario)~~ — **not edited (amended 2026-11-03)**: the probe is plan 202's frozen cache-stability evidence tool (its `probeSha256`, seven-scenario fixture and `readiness.mjs` pin are recorded in `docs/_evidence/memory-bench/202/cache-stability/`). Scenario 5 (`background-promote`, the one that runs the extractor against the real stack) was rerun unchanged instead, and the ontology byte pins live in the fabric tests (see the Notes);
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

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Matcher* (`ontology/bind.ts`, new): `createSubjectMatcher(subjects, threshold)` builds a token map once per index revision. Names are each subject's slug (`deploy-pipeline` answers to "deploy pipeline"), title and aliases, reduced by the lexical index's own `lexicalTerms` (lowercase, stopwords dropped, stemmed), so a binding agrees with what recall would match; no second tokenizer. A name qualifies at `threshold` distinct tokens in the note (text plus its keywords, text read to 16,000 characters) or when every token of a multi-token name is present; exactly one qualifying subject binds, otherwise `undefined`. The "exact multi-token alias" test is token containment, not phrase order, because `lexicalTerms` returns a set. `resolveBindThreshold` validates the integer in [1,8].
      - *Subject source* (`ontology/index.ts`, new): `createFabricSubjects` is the single object the write path, the extractor prompt and the directory share. `bindingFor(scope, text, keys)` is best effort (an index that cannot load, for example a store without `scanMetadata`, leaves the note unbound; only an abort propagates), caches the matcher by `ConceptIndex.version()` (new: bumped by every add, remove and invalidate), and never crosses scope (`ontologyLevel`: `path` reads `project`). `noteBound` marks the concept `dirty: ["evidence"]` through one shared `markEvidenceDirty` that `port.bind` now also uses. `listing(level)` is live, ordered by recorded uses, then cited notes, then name. `snapshot(sessionId)` pins every scope's top 64 subjects per session epoch, keyed by the sum of the scopes' retraction versions (the context's own pin key), with a 64-session cap. `subjectPromptBlock` renders the extractor block (`slug | title | alias; alias`, one line per subject, 6,000 characters shared across the scopes shown) and returns the exact slugs it named, which is what the parser accepts.
      - *Write path* (`create.ts`): in `rememberIndexed`, `input.subject` wins, a reconsolidating update keeps the subject the existing note had, and otherwise `options.subjects.bindingFor(level, content, keywords)` decides; a bound note then calls `noteBound`. New `CreateMemoryFabricOptions.subjects`; the package passes `createFabricOntology(...).subjects` whenever `semantic` is on. `mergeNoteMetadata` (`consolidate.ts`) dropped `subject` on a rewrite (a Task 2 gap, found while writing the update case) and now carries it.
      - *Extractor* (`consolidation/{prompts,extract,pass,write}.ts`, `create.ts`): the per-call prompt gains `subjects: { instruction, scopes: { <level>: [lines] } }` only when a scope has subjects. `record_notes` gains an optional `subject`, a free string capped at 64 characters with no enum, so the schema and the system text are byte-identical with and without an ontology. The parser keeps a slug shown for the note's own scope and the literal `new`, and drops everything else (an unshown slug, another scope's slug, a non-string, or any subject when no list was shown) without a repair call. `write.ts` stores a slug on the note only when the note landed in the scope it was validated for and never stores `new`. The consolidation pass takes the pinned snapshot once per pass.
      - *Directory* (`directory.ts`): a scope snapshot carries `concepts: { count, subjects }` (top 64, redacted); `renderFabricDirectory` writes `project concepts: 12; subjects: payments, deploy-pipeline, auth (+9)` after the counts and topics, naming at most eight. Under the token budget files shrink first, then topics, then the subjects named; the count stays. With no concepts the block is byte-identical to before. When concepts exist over kinds the counts do not name (exchanges only), the first concept line carries the `Recall with memory.recall.` pointer. The line rides in the snapshot the context already pins per epoch, so a concept written mid-session does not rebuild the prefix.
      - *Config*: `ontology: { bindThreshold }` (contract object, tuning field, default 2), `MemoryFabricOntologyConfig`, README stability rows. `scripts/memory-bench/defaults.json` records the new resolved default (`config_defaults_match_evidence`).
      - *Surface*: root barrel adds the types `FabricSubjects`, `SubjectListing`, `SubjectScopeListing` and `MemoryFabricOntologyConfig` (frozen by `root-exports.test.ts`, updated deliberately).
    - **Measured.**
      - Binding: 0.066 ms per note for 500 subjects (two aliases each, a 368-character text and two keys), 15× inside the 1 ms bound; building that matcher takes 2.9 ms once per concept change. The test asserts the bound.
      - Extractor prompt: the subject block is capped at 6,000 characters (about 1,500 tokens) however many scopes show it, and the test shows 100 long subjects cut to the cap with the accepted slugs equal to the shown ones. The tool schema grew by 43 bytes (about 11 tokens) for the optional `subject`; `extractor_prompt_size_breakdown_matches_fixture` was updated from 1567 to 1610, and the system text is unchanged at 3,464 bytes.
      - Cache: `prefix-probe.mjs` rerun unchanged: every additive scenario keeps one prefix (`exchange-archive`, `cited-core`, `insert`, `working-update`, `background-promote` all 1; `forget` and `second-instance` 2, as designed), and the two extractor calls of `background-promote` keep identical system and tool hashes (`toolsSha256` `6df1b86164…`, 5,463 encoded bytes), `prefix-probe.test.mjs` 5 pass. `subject_list_rides_in_the_prompt_and_extractor_segments_stay_stable` pins the system and tool bytes with and without subjects for both prompt variants.
    - **Findings that affect later tasks (amended where noted):**
      - *Task 4:* the directory orders subjects by the concept note's recorded `uses`, but the in-process concept index copies `uses` only when it builds or when the port or cascade upserts a row; a `recordUses` patch does not refresh it. Task 4, which starts recording uses on concept hits, must call `index.upsert` (or `invalidate`) from that path, or the ordering stays at cited-note count until the next process. Amended into Task 4 below.
      - *Task 6:* a write-time binding sets `dirty: ["evidence"]` once and the pass clears it, so the accumulation trigger reads `dirty()` for bound subjects and `pending()` for unbound notes; `pending()` does not filter by subject, so Task 6 filters on `OntologyNoteView.subject`. The extractor's `new` is validated but stored nowhere, by design (no speculative field): an unbound cluster is found from `pending()` exactly as before. The extractor sees the subject list pinned at the session's epoch, so a subject the concept pass creates mid-session is offered to the extractor only after the next retraction or session; bound-by-text covers the gap. Amended into Task 6 below.
      - *First write after startup scans the scope.* `ConceptIndex` builds lazily from one `scanMetadata` pass, and the first `remember` into a scope with the ontology attached triggers it (the extractor snapshot does the same for each scope). This is one pass per scope per process, off the model path; it was **not measured on SQLite or Postgres** with a large store, and plan 208's scale run should record it with the Task 2 cascade-index build.
      - *The wiki is the only writer of `new`-driven subjects.* Nothing else creates a subject, so a fabric without the wiki binds only to concepts a person or `memory:import` put there.
      - An `agent`-scope note binds only to an `agent`-level subject, and nothing writes one today (the port's write scopes are `user` and `project`; `agent` concepts would come from widening), so in practice only `user`, `project` and `path` notes bind.
    - **Tests.** `__tests__/ontology-binding.test.ts` (12 cases): `unambiguous_alias_binds_note_on_write` (text, exact alias, keys, five evidence kinds, explicit wins, concept marked dirty), `ambiguous_or_weak_match_leaves_note_unbound`, `bind_threshold_is_tuning_and_one_token_binds_at_one`, `no_concepts_means_no_binding_and_no_scan_failure`, `a_rewrite_keeps_the_subject_it_had`, `binding_never_crosses_scope` (user, project, path), `bind_under_1ms_for_500_subjects`, `matching_is_whole_token_and_case_folded`, `subject_list_is_epoch_snapshotted`, `prompt_block_caps_subjects_and_names_only_what_it_shows`, `directory_concepts_line_within_budget_and_pinned_for_epoch`, `concepts_line_is_pinned_for_the_session_epoch` (through `createFabricContext`: a concept written mid-epoch leaves the prefix unchanged, a retraction rebuilds it). `consolidation/__tests__/extract.test.ts` adds `extractor_unknown_subject_is_dropped_not_rejected` and `subject_list_rides_in_the_prompt_and_extractor_segments_stay_stable`; `write.test.ts` adds `shown_subject_is_stored_and_new_is_not` and `subject_is_not_carried_into_a_fallback_scope`. The plan's seven names are all covered (the two extractor and epoch ones under the names above).
    - **Verification.** `bun run typecheck` clean across the workspace. Fabric suite 618 pass / 0 fail (29 PostgreSQL skips); memory-core 63 pass; wiki 80 pass; `src/__tests__/docs.test.ts` 65 pass; `scripts/memory-bench` 416 pass with one failure that is not from this task (`Task5Manifest: the candidate product has uncommitted changes` needs a clean tree); `prefix-probe.test.mjs` 5 pass. `apps/prism-agent` `conversational_memory_scenario_recalls_across_sessions_and_forgets` still fails for the reason Task 2 recorded (plan 202 Task 9's abstention line echoes the query term; not from this task). `scoped/__tests__/reviewer.test.ts` "a duplicate folds" failed once in three full runs: the same-millisecond timestamp flake Task 2 recorded. `biome format` clean on every touched file (it also reflowed Task 2 lines in `exports.ts` and `types.ts`); `biome lint` reports one existing unused-import warning in `root-exports.test.ts`.
    - **Baseline diff** (`bun scripts/release.mjs gate --package @arnilo/prism-memory-fabric --update-baseline --skip-tarball`, fabric only; `git status` shows no other baseline touched). Attribution: every added line is this plan's Task 3 surface: `DEFAULT_BIND_THRESHOLD`, `MAX_BIND_THRESHOLD`, `resolveBindThreshold`, `createSubjectMatcher`, `createFabricSubjects`, `ontologyLevel`, `subjectPromptBlock`, `MAX_SHOWN_SUBJECTS`, `MAX_SHOWN_SUBJECT_ALIASES`, `MAX_SUBJECT_PROMPT_CHARS`, `EXTRACT_SUBJECT_NEW` (internal helpers the declaration scan also lists, not barrel exports) and the barrel types `FabricSubjects`, `SubjectListing`, `SubjectScopeListing`. The remaining changed lines are the barrel re-export statements whose text changed because `MemoryFabricOntologyConfig` joined them or `biome` reflowed them; no name was removed.
    - **Sweep.** No retired name. Recorded deviations: `prefix-probe.mjs` was rerun, not extended (reason in the Files list above); `new` is parsed but not persisted.

- [x] Task 4: Concepts first, then drill down — recall, read, cues and sharing (fabric)
  - Acceptance Criteria:
    - Functional: **The ontology option (decided 2026-11-03).** The option Tasks 2–3 referred to is "the fabric has an ontology": `semantic` is on, so `createFabricOntology` exists and the package passes `ontology: { conceptPrior, maxClaimsRendered }` to the fabric and the tool deps. Without it the recall tool refuses a named `concept`, omits it from the schema and leaves it out of `kinds: ["all"]`; the store-level `recall` is concept-first regardless, because a concept can exist only where something wrote one.
    - Functional: **One retrieval surface.** `concept` joins `DEFAULT_RECALL_KINDS`. Concept hits get a kind prior, `ontology.conceptPrior` (tuning, default 0.1, in [0, 0.5]), added after RRF fusion and the scope prior, so a matching concept outranks its own evidence but not a better-matching note.
    - Functional: **Rendering.** A concept hit renders as its header line (`[id] <level> concept <subject> <date>`), then its non-stale claims, each with its cited ids, up to `ontology.maxClaimsRendered` (tuning, default 8) chosen by term overlap with the query. Then one line: `drill down: memory.read { ids: [...] }`. Stale claims render `(stale)` only in `memory.read`, never in recall.
    - Functional: **Drill-down.** `memory.read { id: <concept> }` returns the whole concept with claim ids. `memory.read { ids }` on cited notes returns them through the existing filters, and an exchange reached that way can be expanded with the existing `around` navigation. A pattern that no concept covers is returned as a plain note in the same recall, with no extra call.
    - Functional: **Passive delivery.** Concepts are never in the pinned core. The passive tail may carry at most one concept per turn, and only when it is the top fused hit and its subject matches a touched path's concept `appliesTo` (path cue) or the turn's terms. It renders as one pointer line (`concept payments — memory.read <id>`) within the existing cue budget. Content is pulled by the agent, not pushed.
    - Functional: **Sharing.** `memory:share { id }` accepts a verified `concept` and writes it to the team store with the existing human confirmation. Its cited private notes are **not** copied: the shared concept keeps its claims and cites as provenance, so each citation is `shared-without-evidence` by derivation (a team concept's cited id is not in the team store), and lint (Task 7) reports it. No field stores it. The team concept is read-only to tools, quarantined by the trust scan like any team note, and shadowed by a private concept with the same subject (narrower scope wins).
    - Functional: **Co-read clusters (amended 2026-10-31; executed as a note field, 2026-11-03).** The fabric records, per turn, the set of notes the agent both received (recall results or `memory.read`) and then cited or used. This is the existing use log (`recordUses`) plus the turn's read set. A set of ≥ 2 notes read together in one answering turn is stored as one `coRead` event: ids and turn index only, no text. It is the selection signal for Task 6's primary trigger: the agent has already paid to gather that evidence, and the gathering shows the synthesis is needed. No model call and no extra store query; the event rides in the existing `fabric.lifecycle` background write. *Executed shape:* each evidence note that took part gets an additive `coRead` field, the last 16 events `{ s, t, with }` (scope-session ordinal, turn index, up to 8 other ids); the use log could not carry it because `recordUses` keeps one use per session per note.
    - Functional: **Amended by Task 3 (2026-11-03), concept uses.** The directory orders subjects by the concept's recorded `uses`, and the in-process concept index copies `uses` only when it builds or when the port or cascade upserts a row. Recording a use on a concept hit must refresh the index row (`index.upsert` from the `recordUses` path, or `invalidate`), and a test pins that the directory's next epoch reflects it.
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

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Recall* (`types.ts`, `recall.ts`, `scope/recall.ts`, `create.ts`, `index.ts`, `config.ts`): `concept` is in `DEFAULT_RECALL_KINDS` and in `kinds: ["all"]`. `createScopeRecall` takes `conceptPrior` and adds it to a concept's score after fusion and the scope prior, in the multi-scope path and in the single-scope path (which has no fusion, so it re-sorts stably only when a concept is present; with none, the candidates are returned untouched). A concept shadows by `concept:<subject>` instead of `key`, so a private concept hides a team concept about the same subject (`:` is outside the key alphabet). New tuning fields `ontology.conceptPrior` (0.1, [0, 0.5]) and `ontology.maxClaimsRendered` (8, [1, 32]), validated in `ontology/render.ts`, listed in the stability table and in `scripts/memory-bench/defaults.json`.
      - *Rendering* (`ontology/render.ts`, `tools.ts`): a concept hit renders as `[id] <level> concept <subject> <date>`, its current claims with `← cited ids`, and `drill down: memory.read { ids }` (at most 8 ids). Claims are chosen by term overlap and kept in document order; stale claims, claims with an unreadable citation and every claim of a flagged concept (`[flagged: class]`) are not rendered. The citation check is one batched `readNotes` for the union of the page's concept hits' cited ids (capped at 256), only when a concept hit is on the page. A team concept skips it and drills down to the concept itself (`evidence: false`). `memory.read` of a concept returns the whole body with `(stale)` / `(uncited, human)` labels and the `subject`. `memory.read` now also lets the model cite what it read (`tracker.received`), without counting a retrieval. The recall tool's kind enum names `concept` only with the option; P5's evidence and the state table see the rendered claims only (the state table skips concepts).
      - *Passive* (`ontology/pointer.ts`, `context.ts`, `excerpt.ts`, `delivery/cues.ts`): the passive path takes the top eligible hit; when it is a concept and a name (slug, title or alias, all tokens) is in the turn's terms or a touched path matches its `appliesTo`, one line `- [id] concept <subject> — memory.read <id>` joins the tail; every concept is then removed before `fitInjection`, which also skips one defensively. A path cue shows the same kind of pointer and never claims; a shared per-turn slot (`conceptTaken`) keeps it to one.
      - *Sharing* (`delivery/team.ts`): `memory:share` accepts a verified concept. It shares the current claims (stale items, open questions and contradictions are left out), keeps `sources` as provenance, drops `links`, `stale`, `dirty` and use counters, shows the number of citations travelling without their notes in the confirmation, and reuses the team store's existing concept id for the same subject, so there is one concept per subject.
      - *Co-read and uses* (`lifecycle/events.ts`, `lifecycle/index.ts`, `types.ts`, `context.ts`, `index.ts`, `ontology/port.ts`): see the amended bullet. The tracker's `takeCoRead` returns the ids cited in one answering turn (and clears the turn), `recordCoReads` keeps only evidence notes (a concept or working block takes no part) and needs two of them, and it runs in the existing `fabric.lifecycle` task. The same task now calls the new `ontology.refresh(ids)` after `recordUses`, which re-reads concept rows into the in-process index so the directory order follows use.
    - **Findings that affect later tasks (amended where noted):**
      - *Task 6:* the co-read trigger reads each note's `coRead` field, not a separate log. A note's events name the others it was read with, so a cluster is the connected set of notes sharing an event; `s` (scope-session ordinal) gives "since the last pass" if the pass records its own ordinal. Only evidence notes carry it, so a concept never starts a cluster. `pending()` does not return `coRead` today: the port's `OntologyNoteView` must gain it (ids and indexes only). Amended into Task 6 below.
      - *Task 6:* a concept the curator edits in place keeps its `uses`, but a concept's recorded uses come only from the model citing `[id]` after a recall that showed it; the pointer line and a bare `memory.read` do not count. That is deliberate (a use is a citation) and it means the directory order moves slowly. Plan 208 should not read it as a recall metric.
      - *Task 7:* lint's `shared-without-evidence` is derived (a team-scope concept's cited ids are not readable in the team store), not a stored field. A human edit to a team concept is a normal git change; reconcile still has to call `index.invalidate()` (Task 2 finding).
      - *Task 5/9 (reference host):* the package passes the `ontology` option whenever `semantic` is on, so a host that turns the wiki package on needs no further wiring, and a host that does not install it sees no concept unless a person writes one. With no concept, recall, the directory, the pinned prefix and the tail are byte-identical (the existing `no_concepts_means_byte_identical_recall_and_prefix` and `prefix-stability` tests pass unchanged).
      - *Not measured:* the citation check adds one `get` per recall that shows a concept; its latency on SQLite and Postgres was not measured and belongs to plan 208's scale run. The plan's "recall adds no store query" holds for the ranking itself, not for this second line.
    - **Tests.** `__tests__/ontology-recall.test.ts` (16 cases): the plan's nine names — `concept_outranks_its_evidence_but_not_a_better_note` (also pins the prior as exactly `conceptPrior` of lift), `recall_renders_claims_with_cited_ids_and_drill_down_line` (also `maxClaimsRendered` and `memory.read`), `uncovered_pattern_returns_as_note_in_same_call`, `co_read_event_records_ids_only_for_notes_read_and_used_together`, `stale_claims_never_in_recall_or_passive`, `concept_never_in_pinned_core_and_pointer_only_in_tail`, `share_concept_requires_confirmation_and_never_copies_evidence`, `private_concept_shadows_team_concept_by_subject`, `flagged_concept_never_delivered` — plus `an_unreadable_citation_drops_the_claim_even_when_the_cascade_did_not_run`, `without_the_ontology_option_a_named_concept_is_refused_and_all_leaves_it_out`, `a_path_cue_shows_one_concept_as_a_pointer_without_its_claims`, `recording_a_use_refreshes_the_concept_row_so_the_directory_order_follows`, `claims_pick_by_overlap_skip_stale_and_label_uncited`, `passive_pointer_needs_a_name_in_the_turn_or_a_touched_path` and `a_shared_team_note_still_refuses_other_kinds`. `ontology.test.ts` was updated: "concept is invisible to every path that does not name the kind" is now "…that has no ontology option" (the kind is in the default recall by design), and the stale-claim test no longer asserts that an untyped recall hides a concept.
    - **Verification.** `bun run typecheck` clean across the workspace. Fabric suite 634 pass / 0 fail (29 PostgreSQL skips); memory-core 63 pass; wiki 80 pass; `src/__tests__/docs.test.ts` 65 pass; `bun test scripts/memory-bench` (from the repo root) 416 pass with the one failure that needs a clean tree (`Task5Manifest: the candidate product has uncommitted changes`); `apps/prism-agent` 54 pass with the one failure Tasks 2–3 recorded (`conversational_memory_scenario_recalls_across_sessions_and_forgets`, plan 202 Task 9's abstention line). `biome format` clean on every touched file; `biome lint` reports four `useOptionalChain` warnings in the test files, in the style of the existing tests. The checked-in `*.d.ts` files beside `delivery/{core,cues,team}.ts` show whitespace-only diffs (indent 4 → 2) and lag the `.ts` sources; they were not edited by hand, and `core.d.ts` was already modified when the task began.
    - **Baseline diff** (`bun scripts/release.mjs gate --package @arnilo/prism-memory-fabric --update-baseline --skip-tarball`; only `arnilo__prism-memory-fabric.txt` changed). Attribution: every added line is this task's surface: `DEFAULT_CONCEPT_PRIOR`, `MAX_CONCEPT_PRIOR`, `DEFAULT_MAX_CLAIMS_RENDERED`, `MAX_CLAIMS_RENDERED_LIMIT`, `MAX_DRILL_DOWN_IDS`, `resolveConceptPrior`, `resolveMaxClaimsRendered`, `readConceptBody`, `citedByCurrentClaims`, `selectConceptClaims`, `renderConceptClaims`, `renderConceptRead`, `conceptInPlay`, `conceptPointerLine`, `PREAMBLE`, `MAX_CO_READ_EVENTS`, `MAX_CO_READ_WITH`, `readCoReadEvents`, `appendCoReadEvent` and the `MemoryNoteCoReadEvent` type. Those are the declaration scan's list of module exports, not barrel additions: `MemoryNoteCoReadEvent` is the only new name the barrel re-exports, and `root-exports.test.ts` passes unchanged. Nothing was removed.
    - **Sweep.** Repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` for the Task 2 wording ("`kinds: ["all"]` never includes `concept`", "refuses … `concept_requires_ontology`") found only the fabric README and CHANGELOG lines, both rewritten here. No retired name.

- [x] Task 5: Re-scope `@arnilo/prism-memory-wiki` as the ontology tier: requirements, retirements and the new surface
  - Acceptance Criteria:
    - Functional: **Amended by Task 1 (2026-11-03), sweep list.** A repo-wide grep on 2026-11-03 found these files beyond the list below: `docs/live-testing.md:93` (the `memory/wiki` hermetic-leg row), `packages/memory/fabric/CHANGELOG.md`, `scripts/document-ingestion-packed.test.mjs`, `scripts/unused-report.json`, `scripts/unused-sweep-report.txt`. `scripts/budgets.json` only names the wiki in historical `reason` prose and needs no edit. `scripts/phase13-baseline.json` and `docs/migrate-to-0.9.md` are frozen history. `examples/tool-narrowing-planes.ts` only uses `wiki.*` as mock tool names and is a false positive. No file under `apps/` references the wiki. The baseline `arnilo__prism-memory-wiki.txt` (81 lines) is the only one regenerated; `arnilo__prism-wiki.txt` and `arnilo__prism-memory.txt` stay.
    - Functional: **Manifest.** The package declares `services: ["memory.fabric"]`. Without the fabric, `createAgent` fails closed with `missing_service`, naming the service and this package. With the fabric present but `semantic: false`, the same `missing_service` applies. *Amended 2026-11-03 (Task 5 execution):* the loader checks `requires.services` after every `setup`, and the fabric provides `memory.fabric` only when `semantic` is on (Task 2), so a fabric with `semantic: false` is indistinguishable from no fabric and cannot reach a wiki `setup` that notes and registers nothing. Failing closed is the stricter outcome and needs no kernel or fabric change; the README states it.
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
    - `wiki_with_semantic_off_fails_closed_because_the_fabric_provides_no_port` (amended: see the manifest criterion).
    - `wiki_registers_the_ingest_tool_and_three_commands_and_nothing_else`, `wiki_listed_before_the_fabric_still_loads`, `wiki_config_rejects_the_retired_fields` (added).
    - `retired_wiki_names_absent_repo_wide` (a grep test over the swept paths, excluding the frozen-history set).
    - `wiki_package_conformance` (package conformance suite from `@arnilo/prism/testing`; the harness loads one package alone, so the test wraps the wiki with a `memory.fabric` stand-in and the real requirement is pinned by the fail-closed test).
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

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Package:* `packages/memory/wiki/src` is now `extension.ts`, `exports.ts`, `index.ts`, `types.ts`, `ingest.ts`, `tools/ingest.ts`, `commands/{ingest,status}.ts`. Deleted with no alias: `engine/*`, `profiles/*`, `search/*`, `manifest.ts`, `repoint.ts`, `retire.ts` (including `createWikiDeletionHandler`), `cli.ts`, `skills.ts`, `heading.ts`, `commands/{init,lint,refresh}.ts`, `tools/{search,read-page,record-insight}.ts`, the `skills/` directory, the tracked `.wiki/` fixture directory, and their eleven test files. `package.json` loses `bin` and `skills`; `@arnilo/prism-memory-fabric` is a peer and a `file:../fabric` dev dependency; `tsconfig.json` gains the `bun-types` the fabric import pulls in; the fabric's dev dependency on the wiki is removed (`bun.lock` regenerated).
      - *Manifest and config:* `requires: { api: 1, services: ["memory.fabric"] }`, `capabilities: ["models"]`, config `consolidate { model, minNotes, maxSubjectsPerPass, maxClaimsPerConcept, maxOutputTokens }`, `ingest { maxInputBytes, maxExtractBytes }` and `workspaceRoot`, all `additionalProperties: false`. The ingest caps can only be lowered (maximums are the 32 MiB and 2 MiB hard caps). `setup` does no I/O: it registers `wiki_ingest`, `wiki:status` and `wiki:ingest`, and notes the missing `web.fetch` service as before. The port is read per call, so listing order does not matter.
      - *`wiki:status`:* `wikiStatus(port)` counts `subjects()` and `dirty()` per readable scope, with dirty reasons. No model call and no note text. It has no last-pass field yet (Task 6).
      - *Ingest:* `ingest.ts` keeps its extraction matrix and still stages under `raw/ingest/` (Task 8 retargets it); the `.wiki/log.md` append, the `hashContent` import from the deleted manifest and the filing checklist in the brief are gone. `ingestWikiSource` is no longer a package export; scripts that need it import `src/ingest.ts` by path.
      - *Exports (baseline):* default, `definition`, `memoryWiki`, `WikiConfig` and its two nested config types, `WIKI_INGEST_TOOL_NAME`, `WIKI_INGEST_COMMAND_NAME`, `WIKI_STATUS_COMMAND_NAME`, and the types `WikiIngestResult`, `WikiStatusReport`, `WikiStatusScope`.
    - **Findings that affect later tasks (amended where noted):**
      - *Semantic off fails closed (criterion amended above).* No fabric or kernel change was made for it.
      - *Task 6:* the config schema is closed, so `consolidate.minCoReads` and `consolidate.triggers` must be added to it in Task 6, and Task 6 adds the `background` and `session-state` capabilities it needs (today only `models` is declared). The status report gains the last pass and its cost there.
      - *Task 7:* add `WIKI_LINT_COMMAND_NAME` to `exports.ts` beside the others; commands are named `wiki:<verb>`.
      - *Task 8:* `ingest.ts` is package-internal and `ingestRoot` is still a relative `raw/ingest`; the tool and command already pass `ingest.maxInputBytes` and `ingest.maxExtractBytes` through `ingestOptionsFrom`. `scripts/document-ingestion-packed.test.mjs` imports `src/ingest.ts` by path and must follow it if it moves.
      - *`packageConformance` cannot load a package with `requires.services` alone,* and it has no option to add companion packages. The wiki test wraps the definition instead; a kernel testing option would be an additive change for a later plan, not made here.
      - *The loader's post-setup `missing_service` check does not order packages,* so `wiki_listed_before_the_fabric_still_loads` is a real guard.
    - **Sweep.** The retired-name list in `src/__tests__/retired-names.test.ts` (29 names, including `.wiki/`) is clean over `src packages apps scripts examples docs README.md PRODUCT.md`. Recorded exceptions: the test itself, the config-rejection test, `CHANGELOG.md` files, `docs/migrate-to-*.md`, `scripts/phase*` freeze records, `scripts/budgets.json` prose, the frozen 0.12 baselines `arnilo__prism.txt`, `arnilo__prism-memory.txt` and `arnilo__prism-wiki.txt` (the regenerated `arnilo__prism-memory-wiki.txt` is clean), `src/__tests__/packaging.test.ts` and the fabric `package.test.ts` allowlist. Callers updated: `src/__tests__/packaging.test.ts`; fabric `deletion-propagation`, `host-wiring` and `source-repoint` tests (their wiki legs removed; the generic handler kind renamed `derived`); `scripts/{package-truth.mjs,post-publish-smoke.mjs,e2e-coverage.json,live-matrix.json,phase24-truth.test.mjs,phase38-codeql-regression.test.mjs,run-all-tests.mjs}`, `scripts/fixtures/e2e-full-surface-journey.mjs`; `scripts/wiki-scratch-isolation.test.mjs` is deleted (its root cause, the compiler scaffolding `.wiki/` into the working directory, is gone); `docs/{index,release,host-security,live-testing,migrate-to-0.13}.md`, `README.md`, root and wiki `CHANGELOG.md`, the wiki README (rewritten in the package page structure). `docs/live-testing.md` was regenerated from `live-matrix.json`, which also corrected one unrelated stale row (`memory/observational-live`). `scripts/unused-report.json` and `scripts/unused-sweep-report.txt` still list the wiki's old tsconfig diagnostics; they are generated reports for `bun run sweep:unused` and were not regenerated.
    - **Baseline diff** (`bun scripts/release.mjs gate --package @arnilo/prism-memory-wiki --update-baseline --skip-tarball`): 81 lines to 22. Every removal is this task's retirement (the compiler, profiles, manifest, linter, qmd, hydrator, skills, bin, retire/repoint and the three tools and four command constants). Additions: `WIKI_STATUS_COMMAND_NAME`, `createWikiStatusCommand`, `wikiStatus`, `renderWikiStatus`, `WikiStatusReport`, `WikiStatusScope`, `WikiConsolidateConfig`, `WikiIngestConfig`, and `WIKI_INGEST_COMMAND_NAME` changed value (`wiki-ingest` to `wiki:ingest`). The declaration scan also lists the ingest helpers (`ingestWikiSource` and friends) that are not package exports. Other packages' baselines are untouched.
    - **Verification.** `bun run typecheck` clean across the workspace. Wiki suite 33 pass (7 new/rewritten package tests, the ingest tool and command tests, the retired-name sweep). Fabric suite 631 pass / 29 PostgreSQL skips. `src/__tests__/docs.test.ts` 65 pass and `packaging.test.ts` green. Wiki coverage 98.78% lines / 93.25% functions against the recorded 90.12 / 89.06 thresholds. 29 failures in the `scripts/phase*`, `version-literal-gate`, `phase54`, `phase38 trimTrailingSlashes` and `phase24 peer policy` tests are **identical with and without this change** (checked by stashing the tree); the peer-policy test's actual map now contains `@arnilo/prism-memory-fabric` for the wiki as the updated expectation says, and fails on an unrelated `prism-evals` entry. `scripts/e2e-full-surface.test.mjs` fails in the context-engineering section (`Tool result lookup` fold text), unrelated; the wiki section's assertions were checked directly.

- [x] Task 6: The concept pass — background consolidation from T1 evidence into the ontology (wiki)
  - Acceptance Criteria:
    - Functional: **Triggers, per readable write scope** (`user`, `project`; `path` subjects live in `project`). Amended 2026-10-31: read-time selection is the primary trigger.
      - **Primary — co-read (read-time consolidation):** a set of notes co-read in ≥ `consolidate.minCoReads` (tuning, default 2) answering turns since the last pass (Task 4's `coRead` events: a `coRead` field on each evidence note, `{ s, t, with }`; the port's `OntologyNoteView` gains it, ids and indexes only). When the notes share a subject, that subject is dirty; when they are unbound, the cluster is a new-subject candidate. This mirrors reconsolidation: the memory that was just retrieved and used is the one updated.
      - **Secondary — accumulation:** a bound subject with ≥ `consolidate.minNotes` (tuning, default 5) T1 notes not yet consolidated, or an unbound cluster of ≥ `minNotes` notes sharing enrichment keys (plan 202 Task 5) with no subject. This catches subjects that will be needed but have not yet been asked about.
      - **Always — repair:** a concept marked dirty by the cascade (stale or removed claims).
      - *Amended by Task 3 (2026-11-03):* a note bound at write time sets its concept's `dirty: ["evidence"]` (once, until the pass clears it), so the accumulation trigger reads `dirty()` for bound subjects and `pending()` for unbound notes, filtering `pending()` on `OntologyNoteView.subject`. The extractor's `new` is not persisted. The extractor sees the subject list pinned at the session epoch, so a subject created mid-session reaches it only after the next retraction or session.
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
    - Functional: **Provenance.** Each written concept carries `generated: { by: consolidation, at }`. *Amended 2026-11-03 (Task 6 execution):* the `log.md` line is the markdown store's own, written on every note write with the provenance actor (`(consolidation)`), so a person reading `log.md` or `git diff` sees who wrote what. A line naming the pass and its edit counts would need a store-level note the port does not expose; the pass id, counts and cost live in `wiki:status` and the `wiki.consolidated` event instead. A human-authored claim (`generated.by: human`) is shown to the model as read-only: the pass may cite it in a contradiction but never update or retire it.
    - Functional: **Port surface this task needs (added 2026-11-03).** The Task 2 port lacked what a curator reads and one thing it must settle, so Task 6 adds, all additive: `pending` filters `subject`, `unbound` and `coRead` (evaluated in the same metadata scan); note views carry `keywords`, `links`, `coRead`, `generatedBy` and, for a concept, `stale`; `settle(scope, subject)` clears the `evidence` dirty reason when the curator had nothing to add (without it a declined subject would be offered forever); `screen(text)` names the trust class the fabric would refuse, so one edit is dropped instead of the batch (the scanner itself stays internal; `root-exports.test.ts` pins that).
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
      - `packages/memory/wiki/src/consolidate/{triggers,prompt,schema,pass}.ts` (new), plus `consolidate/curator.ts` (lease, declined attempts, turn pacing, last pass);
      - `packages/memory/wiki/src/{extension,types,exports}.ts`, `src/commands/{consolidate,status}.ts`;
      - `packages/memory/fabric/src/ontology/port.ts`, `exports.ts` (the port surface above), fabric README and `CHANGELOG.md`;
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

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Wiki package* (`packages/memory/wiki/src/consolidate/`):
        - `schema.ts`: the one source for the `edit_concept` tool and the parser. The tool schema is a constant (no ids, slugs or caps), so the tool segment is byte-stable. `parseAnswer` rejects an answer whole; codes are safe reason strings, and only shape codes (`answer_shape`, `edits_shape`, `edit_shape`, `edit_op`, `edit_field`, `text_shape`, `slug_shape`, `tool_call_*`, `output_truncated`) are repairable.
        - `prompt.ts`: `CONSOLIDATE_SYSTEM` (one constant, the prompt rules of the plan plus the untrusted-data rule) and the per-call payload (concept with claims, relations and open questions, up to 24 notes newest first inside an `evidence` key, up to 64 subject lines).
        - `triggers.ts`: `planScope` implements co-read (pair co-read in ≥ `minCoReads` distinct turns, connected sets), accumulation (a bound subject with `evidence` dirty and ≥ `minNotes` notes its concept does not cite; unbound notes sharing a keyword) and repair (stale or removed). "Not yet consolidated" is stateless: a note the concept cites is consolidated.
        - `pass.ts`: per scope under a lease, per item one call through `runMemoryWorkerLoop` (one turn, one tool call), one repair call at most, screening, `applyConceptEdits` then `bind` then `settle`. A failed item never fails the pass.
        - `curator.ts`: the lease, the in-process set of attempts answered with nothing, turn pacing, last pass.
      - *Package:* config `consolidate.{minCoReads, triggers, minIntervalTurns, workerLimits}` added to the closed schema; capabilities `models, background, session-state`; hooks `session.opened` and `turn.completed` (check) and `session.closed`; command `wiki:consolidate`; `wiki:status` reports the last pass and its cost; one `wiki.consolidated` package event per pass that did work. `consolidate.maxOutputTokens` re-resolves the client with `parameters.maxTokens`, capped by the model's limit (the fabric extractor's rule). New dependency: `@arnilo/prism-memory-observational` (a workspace package the fabric already depends on; not a third-party dependency); `bun.lock` regenerated.
      - *Fabric port:* see "Port surface" above. `OntologyPendingOptions` is exported; `scanScopedMemoryContent` is deliberately not.
    - **Findings that affect later tasks (amended where noted):**
      - *Task 7 (per-claim author).* Provenance is per concept, not per claim. The pass treats a concept whose last writer was `human` as read-only whole, and any claim with no citation as read-only. After the pass writes such a concept the stamp becomes `consolidation`, so earlier human claims that carry a citation are no longer protected. Task 7 must add a per-claim human marker to the body grammar (and `reconcile` must set it) before the claim is safe from a later pass. The README states the limit.
      - *Task 7 (lint and dirty reasons).* The pass repairs `stale` and `removed` only. `edited` (a human edit) is not a pass trigger; lint reports it. `view.generatedBy` is what lint reads for human authorship. `settle` leaves every reason but `evidence`.
      - *Task 7/8 (evidence kinds).* `pending` offers every non-concept, non-working, non-episode note, so `exchange` and (after Task 8) `file` notes cluster and bind like facts. Task 8's ingest should set `keywords` on the `file` note so an unbound source clusters.
      - *Task 8 (declined memory is in process).* A subject or cluster the curator answered with nothing is remembered in memory only; after a restart each such attempt is asked once more. Co-read events persist on the notes, so this is bounded by `maxSubjectsPerPass` per check. A durable "reviewed" marker would be a fabric field and is not added.
      - *Ordering at the cap.* When more than 24 uncited notes are due, the call shows the newest 24 and does not settle the subject, so the rest is offered next. A note the curator saw and left uncited is offered again ahead of older ones until it is cited or declined as a set. Plan 208 should count this as a cost, not a quality defect.
      - *Plan 208 (cost and scale).* Each check reads metadata with up to three scans per scope (co-read, unbound, plus one per bound subject with evidence dirty), each a full `scanMetadata` pass of that scope capped at three pages of 64 notes. This was **not measured on SQLite or Postgres**; the in-memory run is milliseconds. Cost per 1,000 archived exchanges is not stated in the README, by design: plan 208 measures it. Co-read is judged per pair of notes (the plan said per set), and an event names at most 8 other notes, so a very large co-read set is seen partially.
      - *Secrets.* The package, like the fabric's own package, has no secret list, so `rejected.secret` moves only when a host supplies a redactor to the pass (the library API takes one; the package does not). Events and logs are still redacted by the kernel. Not a regression, but the criterion "through the port and redactor" holds for the trust scan and not for host secrets.
      - *Plan 210.* `consolidate.triggers` can switch each policy off (repair stays), as the plan asked, so plan 208 Task 5 can compare `co-read + repair` against all three without code changes.
    - **Tests.**
      - *Wiki, `__tests__/consolidate.test.ts` (23 cases):* the plan's thirteen names (`co_read_cluster_marks_subject_dirty_before_accumulation_threshold`, `trigger_policy_config_never_drops_repair`, `pass_runs_only_on_trigger_and_never_on_quiet_turns`, `uncited_claim_or_unshown_id_rejects_whole_answer`, `shape_failure_repaired_once_then_left_dirty`, `truncation_repaired_with_fewer_edits`, `over_cap_accepts_only_merge_and_retire`, `merge_requires_union_of_citations`, `human_claim_is_read_only_to_the_pass`, `trust_hit_drops_edit_and_counts_it`, `pass_never_reads_wider_scope_to_write_narrower`, `system_and_tool_segments_byte_stable_across_calls`, `unbound_cluster_creates_subject_and_binds_notes`), plus `accumulation_fires_for_a_bound_subject_at_min_notes_and_for_unbound_keyword_clusters`, `a_valid_answer_edits_the_concept_with_cited_claims_and_stamps_consolidation`, two decline cases, `one_lease_per_scope_drops_a_second_pass`, `maxSubjectsPerPass_bounds_calls_per_pass`, `a_fabric_without_the_port_makes_the_curator_do_nothing`, the report renderers, and two package-wiring cases (`wiki:consolidate` on a real agent makes no call when nothing is due; the tuning fields validate and an unknown trigger fails with `config_invalid`). The scope test runs over a real fabric with `user`, `project` and `agent` memories and a port spy. Every model call is a scripted reply; the agent-level cases use the mock provider.
      - *Fabric, `ontology.test.ts` (+4):* the new `pending` filters and view fields, the concept view's writer, links and stale ids, `settle` clearing only the `evidence` reason, and `screen`.
    - **Verification.** `bun run typecheck` clean across the workspace. Wiki suite 56 pass. Fabric suite 635 pass / 29 PostgreSQL skips / 0 fail. `src/__tests__/docs.test.ts` and `packaging.test.ts` 344 pass. Wiki coverage 97.09% lines / 91.45% functions against the recorded 90.12 / 89.06 thresholds. `scripts/live-matrix.test.mjs` 15 pass after the matrix row's scope text and `docs/live-testing.md` were regenerated. `biome format` clean and `biome lint` clean on every touched file. The same 29 `scripts/phase*` failures and the stale `phase54` evidence file that Task 5 recorded are unchanged and were not touched. `biome.json` gains a `noNonNullAssertion: off` override for `packages/memory/wiki/src/__tests__/**` only, the same rule five other memory packages carry for their source; the wiki's source keeps the rule on and the three source assertions were rewritten.
    - **Baseline diff** (`bun scripts/release.mjs gate --package <pkg> --update-baseline --skip-tarball`, run for each; the gate without the flag then reports `updated: false`). *Wiki:* 22 lines to 52. Every addition is this task's: the real exports `WIKI_CONSOLIDATE_COMMAND_NAME`, `WikiPassReport` and `WikiTrigger`, and the declaration scan's list of module exports in the new files (`runWikiPass`, `planScope`, `parseAnswer`, `buildPrompt`, `createCurator`, `createWikiLease`, `createWikiConsolidateCommand`, `renderPass`, `resolveTriggers`, the schema, prompt and cache-key constants, `WikiAnswerError`, and the changed `wikiStatus`/`createWikiStatusCommand` signatures). Those helpers are not package exports, as with the ingest helpers in Task 5. *Fabric:* one added name, `OntologyPendingOptions`, and the barrel re-export lines whose text changed because it joined them; nothing removed. No other baseline changed.
    - **Sweep.** No retired name. The `log.md` criterion and the "two commands" test name were amended in this plan (the latter was renamed to `wiki_registers_the_ingest_tool_and_three_commands_and_nothing_else`).

- [x] Task 7: Claim lint, human curation and the team ontology (wiki and fabric)
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
    - Functional: **Human edits.** *Amended 2026-11-03 (Task 7 execution):* the fabric's `reconcile.ts` only walks the user's `file` notes and never sees a concept, because a concept file is a note of the markdown store. A person's edit is re-read by `@arnilo/prism-memory-core`'s markdown store, so the review hangs off a new optional `reviewEdit(record, previous)` hook there, and the fabric supplies it (`ontology/review.ts`), for the private store and the team store. Per-claim authorship needed a marker in the body grammar: `- [c1 human] text[^id]`. The review re-parses an edited concept file:
      - marks (`[cN human]`) every item whose text or citations changed, and every new item, and stamps `generated.by: human` on the concept; a marked item, or one with no citation, is read-only to every non-human writer in the port (`claim_human`), which closes Task 6's per-claim-author finding;
      - runs the trust scan (a hit quarantines the concept as `candidate` with `flags`, the existing rule);
      - rejects an edit that breaks the codec by keeping the last valid version and logging `invalid-concept` in `log.md` (the "Notes written by a newer version" rule keeps unknown keys).
    - Functional: **Team ontology.** Concepts shared with `memory:share` (Task 4) live in `.prism/memory/` and are reviewed like code. Lint runs on them. The pass never edits a team concept. *Amended 2026-11-03:* "it may note a contradiction between a private and a team concept" is **not built**: the pass reads only the scope it writes (Task 6 security), so it never sees a team concept, and widening that read would break the rule that keeps a private pass from learning from a wider scope. A shadowed or stale team concept shows up in `wiki:lint` instead. To let lint read `team`, the fabric port attaches the team store as a read-only scope (`OntologyScope.store`, listed by thread because a hand-written team note has no consent record).
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
      - `packages/memory/wiki/src/{lint,commands/lint}.ts` (new), `consolidate/{curator,pass}.ts`, `extension.ts`, `exports.ts`;
      - *Amended:* not `reconcile.ts`. `packages/memory/core/src/fabric/index.ts` (`reviewEdit`); `packages/memory/fabric/src/ontology/{review (new),codec,port,state}.ts`, `delivery/team.ts`, `index.ts`;
      - tests;
      - wiki, fabric and memory-core READMEs, `CHANGELOG.md` for the three and the root, `docs/migrate-to-0.13.md`, `docs/live-testing.md` and `scripts/live-matrix.json` (scope text), and the three baselines.
    - References:
      - Tasks 2, 4, 6; plan 188.5 Task 3.
  - Test Cases to Write:
    - `lint_reports_each_rule_and_fails_only_on_unresolved_or_collision`.
    - `human_edit_stamped_and_trust_scanned`.
    - `codec_breaking_edit_keeps_last_valid_and_logs`.
    - `pass_never_edits_team_concepts`.
    - `lint_under_2s_for_2000_concepts` (performance).
    - *Added:* `round_trips_the_human_marker_and_rejects_a_forged_one_in_text`, `an_edited_claim_clears_its_own_stale_mark_and_keeps_the_others`, `a_person_may_write_an_uncited_claim_but_a_note_that_is_not_a_concept_is_left_alone`, `team_concept_is_readable_reviewed_and_never_written_by_the_port`, `an_unresolved_citation_fails_the_run`, `an_alias_collision_fails_the_run`, `an_unparseable_body_is_reported_not_thrown`, `team_concepts_are_linted_and_report_shared_without_evidence`, `wiki_lint_command_is_read_only_and_makes_no_model_call`, `a_cited_human_claim_stays_read_only_after_a_curator_write_restamps_the_concept`, and memory-core's `markdown_review_edit_rewrites_the_file_or_rejects_and_keeps_the_last_valid_version`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a command and human-edit behavior for concepts.
    - Docs pages to create/edit:
      - wiki README (`wiki:lint`, curation);
      - fabric README (`### The team store`: concepts);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Memory-core (`reviewEdit`).* `createMarkdownMemoryStores({ reviewEdit })`: before an externally changed note file is indexed, the owning package may accept it as parsed, return a reviewed record (indexed and written back to the same file, logged `reviewed`), or reject it (the previous version stays indexed, the file is left as written, `malformed` counts it, and one log line names the verb and note against `human`; the file is not judged again until it changes). Never called for an unreadable note. Additive; the fabric is the only caller.
      - *Fabric (`ontology/review.ts`, no model call).* For a concept file: a body that breaks the codec is rejected as `invalid-concept`; items whose text or citations differ from the indexed version, and new items, get the `human` marker; `title` and `sources` are re-derived; a changed item's stale mark clears; the concept gets dirty `edited` and `generated: { by: human }`; the trust scan covers title, aliases and body (a hit sets `candidate` and `flags`, a clean edit lifts them). Wired into the private markdown store and the team store. `memory:reindex` invalidates the concept index.
      - *Codec and port.* `ConceptItem.human`, grammar `[c1 human]`, rendered and parsed deterministically (the marker is outside the claim text, so it cannot be forged by writing "human" in a claim). The port marks every item a `human` writer adds or updates, and refuses `update_claim`, `retire_claim` and `merge_claims` on a marked or uncited item for any other writer (`claim_human`). The team store is an attached read-only ontology scope: `OntologyScope.store`, listed by thread, `scopes()` now reflects attached scopes, and `applyConceptEdits` and `bind` on `team` fail with `MemoryScopeError`.
      - *Wiki.* `src/lint.ts` holds one table of eleven rules (`LINT_RULES`, two of them failing); `commands/lint.ts` registers `wiki:lint [scope]`; the curator records pass start times (`passStarts()`) for the ontology-gap rule. The pass now protects claims by their marker instead of treating a whole human-last concept as read-only.
    - **Findings that affect later tasks (amended where noted):**
      - *The plan's file was wrong, so the design moved (amended above).* `reconcile.ts` is the user-file walk; a concept edit is a markdown-store event. The reviewer rewrites the person's file once when it adds markers or a flag (frontmatter is re-rendered, the body keeps the person's text), because the file is canonical and a rebuild must read the markers back.
      - *Task 6's limit is closed for edits through the store, with one corner.* A concept file written from scratch over an index that never held it has no previous version to compare, so only the markers and missing citations it carries protect a claim. The README says so.
      - *Task 8:* an ingest `file` note is evidence like any other and needs no lint or review change. Lint's unbound-note rule counts `exchange` and `file` notes, so a source nobody has bound will show up there after three passes. Set `keywords` on the `file` note (Task 6 finding) so it clusters before that.
      - *The ontology-gap rule counts this process's passes.* After a restart it reports why it did not run until three passes have happened. A persisted pass counter would be a new stored field and was not added.
      - *Team lint reads provenance only.* A team concept's citations name private notes that are not in the team store, so lint cannot check them and reports `shared-without-evidence`, never `unresolved-citation`, for that scope. A hand-written team note with no consent record is listed by thread, but `memory.get` may still hide it; not tested, since `memory:share` always writes consent.
      - *Plan 208:* nothing here is measured beyond lint time. The review adds one `getByIds` per changed concept file on reindex.
    - **Performance (measured, in-memory store, this machine).** Lint over 2,000 concepts, each with one cited claim over 100 notes: 63 to 101 ms across runs, against the 2 s criterion. It is one concept read per 32 concepts plus one note read per 32 distinct citations, plus one batched scan for the gap rule. SQLite and Postgres are not measured.
    - **Tests.** Fabric `ontology-curation.test.ts` (6 cases, including the real team store round trip through `memory:share`, a teammate's edit and a restart); wiki `lint.test.ts` (9 cases) and the new pass-level case in `consolidate.test.ts`; memory-core `markdown.test.ts` (+1). The plan's five names are all present (`lint_reports_each_rule_and_fails_only_on_unresolved_or_collision`, `human_edit_stamped_and_trust_scanned`, `codec_breaking_edit_keeps_last_valid_and_logs`, `pass_never_edits_team_concepts`, `lint_under_2s_for_2000_concepts`). The package test `wiki_registers_the_ingest_tool_and_three_commands_and_nothing_else` became `…_and_four_commands_…`.
    - **Verification.** `bun run typecheck` clean across the workspace and the examples. Fabric suite 641 pass / 29 PostgreSQL skips / 0 fail; wiki 66 pass; memory-core 64 pass; observational 101 pass; `src/__tests__/docs.test.ts` and `packaging.test.ts` 344 pass; `scripts/live-matrix.test.mjs` 15 pass. Coverage: wiki 91.16% functions / 96.65% lines against the recorded 90.12 / 89.06; fabric 95.80 / 95.52. `biome check` is clean on every file this task touched (the remaining diagnostics in `packages/memory/core/src` are in files this task did not edit). Not re-run: the `scripts/phase*` tests Task 5 recorded as failing identically with and without the memory work, and `scripts/memory-bench`, neither of which reads these modules.
    - **Baseline diff** (`bun scripts/release.mjs gate --package <pkg> --update-baseline --skip-tarball`, each of the three). *Wiki:* 52 lines to 61. Additions are this task's: the real exports `WIKI_LINT_COMMAND_NAME`, `WikiLintFinding`, `WikiLintReport`, `WikiLintRuleId`, and the declaration scan's module exports in the new files (`LINT_RULES`, `lintOntology`, `renderLint`, `createWikiLintCommand`, plus `passStarts` on the curator). Those helpers are not package exports, as with the Task 5 and 6 helpers. *Fabric:* the declaration scan gains `INVALID_CONCEPT_VERB` and `reviewConceptEdit` (module exports of `ontology/review.ts`, not package exports) and the barrel re-export lines reordered because `OntologyPendingOptions` was already joined in Task 6; `ConceptItem.human` and `OntologyScope.store` are type-only additions and carry no baseline line. Nothing removed. *Memory-core:* unchanged (the `./fabric` subpath's option type is not a baseline line).
    - **Sweep.** No retired name introduced; the `wiki-lint` migration row now names `wiki:lint`.

- [x] Task 8: Source ingest into the ontology (wiki)
  - Acceptance Criteria:
    - Functional: `wiki_ingest { text | path | url, title? }` and `wiki:ingest` stage the original and a UTF-8 extract under `<tools.root>/sources/<utc>-<slug>/`. They keep today's rules (`ingest.ts`): workspace containment for `path`, SSRF check plus the `web.fetch` service for `url` (fail closed without it), the built-in PDF parser, image stubs, byte caps, and fail-closed unknown formats. The extract becomes a fabric `file` note in `project` scope through the existing file-note write path (`remember`, reached through a new `indexSource` on the `memory.fabric` port). *Amended 2026-11-03:* the tool fails closed, before anything is fetched or written, when the fabric has no `tools.root`.
    - Functional: The file note is bound by Task 3's deterministic binding when unambiguous. The ingest marks the bound or clustered subjects dirty, and the result tells the agent the source is queued for the next pass (or that `wiki:consolidate` files it now). *Amended 2026-11-03:* a source counts as `consolidate.minNotes` notes toward the accumulation trigger, so one source is due on its own; without that the "queued" claim would be false below five notes. The agent no longer files pages by hand; the old filing brief is deleted.
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
      - `packages/memory/wiki/src/{ingest,types,extension,tools/ingest,commands/ingest,consolidate/triggers}.ts`;
      - fabric (small, additive prerequisite): `ontology/port.ts` (`sourceRoot`, `indexSource`, `OntologyNoteView.path`), `index.ts` (wiring), `reconcile.ts` (skip staged originals), `exports.ts`;
      - tests;
      - wiki README, `CHANGELOG.md`; fabric `CHANGELOG.md`; `docs/{migrate-to-0.13,host-security}.md`.
    - References:
      - Tasks 2, 3, 6.
  - Test Cases to Write:
    - `ingest_stages_under_tools_root_and_indexes_file_note`.
    - `ingest_url_without_web_fetch_fails_closed`.
    - `ingest_marks_subject_dirty_and_pass_cites_file_note`.
    - `forgetting_source_removes_its_claims`.
    - `path_outside_workspace_rejected` (kept from today's suite).
    - Added: `ingest_without_tools_root_fails_closed_before_anything_is_staged_or_fetched`, `an_unbound_source_is_due_as_a_cluster_on_its_own`, `a_source_the_trust_scan_refuses_is_staged_but_not_indexed`, `ingest_stage_root_is_separate_from_the_workspace_and_a_symlinked_sources_dir_is_rejected`, `ingest_keywords_come_from_the_title_and_frequent_words_without_stop_words`; fabric `index_source_*` (3) and `fabric_reconcile_indexes_a_staged_extract_and_skips_its_original`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the ingest target and result.
    - Docs pages to create/edit:
      - wiki README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Fabric (additive prerequisite):* the `memory.fabric` port gains `sourceRoot()` (the fabric's `tools.root`) and `indexSource({ path, text, contentHash, keywords })`. It fails closed without a root, runs the trust scan (a flagged text returns `{ indexed: false, refused }` and writes nothing), then calls the ordinary `remember({ kind: "file", scope: "project" })` through a closure wired in `index.ts`, so binding (Task 3) and `evidence` dirty marking happen exactly as for any note. `OntologyNoteView` carries `path` for `file` notes. `reconcile.ts` skips `sources/<id>/source.<ext>`: the original may be binary and a text original would duplicate its extract as evidence; only `extract.md` is a note.
      - *Wiki:* `ingestWikiSource` takes `stageRoot` (default `workspaceRoot`) in place of `ingestRoot` and stages under `<stageRoot>/sources/<utc>-<slug>/`; it refuses a `sources/` that resolves outside the root. Paths in the result are relative to `tools.root`. New `ingestSource(input, options, signal)` is the one orchestration the tool and command share: check the port and root first (before any fetch), stage, then `indexSource` with `sourceKeywords(title, extract)` (title words, then frequent non-stop words, ≤ 8, no model call; image stubs use the title only). `WikiIngestResult` gains `scope`, `indexed`, `noteId`, `subject`, `refused`. The brief names the note id to cite, whether the source is bound or clustered, and `/wiki:consolidate`; the filing language is gone. Tool name, inputs, SSRF/`web.fetch`/PDF/image/cap/unknown-format rules are unchanged.
      - *Trigger:* `triggers.ts` weighs an ingested source (`kind: "file"`, path under `sources/`) as `minNotes` notes in both accumulation checks (bound subject, unbound keyword cluster). Without it a lone source would never reach the threshold of five and "queued for the next pass" would be false. `wiki:consolidate` (force) already took any bound subject with new evidence.
      - *Docs:* wiki README (tool section, writes, fails-closed lines), wiki and fabric `CHANGELOG.md`, `docs/migrate-to-0.13.md`, `docs/host-security.md`.
    - **Findings that affect later tasks.**
      - *Task 9:* `wiki_ingest` now needs the fabric's `tools.root`. The reference host's coding and research agents already set it (`join(dirname(storePath), "memory")`); the example must too if it ingests. `ingest.maxInputBytes`/`maxExtractBytes` are unchanged.
      - *Flagged source:* a source the trust scan refuses is staged but not indexed. The next startup reconcile still indexes its `extract.md` as a flagged `candidate` (existing behavior for any flagged file), and `pending` skips flagged notes, so it never reaches the pass.
      - *Reconcile cap:* the jail's `tools.maxFileBytes` (default 50 KiB) truncates a larger `extract.md` on read, so the startup reconcile skips it; the ingest indexes up to `maxEntryTextChars` directly and the note stays current (its hash is of the whole extract).
      - *Atomicity:* staging happens before indexing. If `indexSource` throws after staging, the files stay and the next startup reconcile indexes `extract.md` unbound; nothing is rolled back.
    - **Verification.** `bun run typecheck` clean across the workspace. Wiki 74 pass (8 new), coverage 92.61% functions / 97.01% lines against the recorded 90.12 / 89.06; fabric 645 pass / 29 PostgreSQL skips / 0 fail (4 new); memory-core 64 pass; observational 101 pass; `prefix-stability.test.ts` 24 pass; `src/__tests__/docs.test.ts` and `packaging.test.ts` 344 pass; `scripts/live-matrix.test.mjs` 15 pass; `scripts/document-ingestion-packed.test.mjs` pass. Mutation check: with the source weight disabled, the dirty/cite and cluster tests fail. `biome check` is clean on every file this task touched (`retired-names.test.ts` has an import-order diagnostic from Task 5, untouched). Not run: `prefix-probe.mjs` and the `scripts/phase*` tests (see Task 5 and 7), which this task does not touch.
    - **Baseline diff** (`bun scripts/release.mjs gate --package <pkg> --update-baseline --skip-tarball`, fabric and wiki). *Fabric:* adds the type exports `OntologySourceInput` and `OntologySourceResult`; `sourceRoot`, `indexSource` and `OntologyNoteView.path` are members, not baseline lines. *Wiki:* the declaration scan gains `ingestSource` and `sourceKeywords`, and `ingestOptionsFrom`/`ingestWikiSource`/`ingestImageBlock`/`renderIngestBrief` change signature (`stageRoot` for `ingestRoot`, `WikiStagedSource`, the result type); none is a package export. No export removed.
    - **Sweep.** `raw/ingest` and `ingestRoot` appear nowhere outside the root `CHANGELOG.md` history line; `scripts/document-ingestion-packed.test.mjs` needed no change because `ingestWikiSource` still defaults `stageRoot` to `workspaceRoot`.

- [x] Task 9: The three-tier stack end to end — OM as T0, example, reference host option and positioning docs
  - Acceptance Criteria:
    - Functional: **The stack.** The documented composition is OM + fabric + wiki:
      - OM observes (T0); the fabric archives exchanges and, with the ordinary `promote` object, reads OM observations and reflections and writes candidate notes that earn trust by use (existing behavior; **amended 2026-11-03:** the `promote.observational` flag was retired in plan 188.3);
      - the wiki consolidates T1 into concepts (T2).
      Plan 202 Task 16 measures OM's quality in this role; this task only composes and documents it.
    - Functional: **Example.** `examples/three-tier-memory.ts` runs on the mock provider, deterministically, and shows:
      1. three sessions of scripted turns;
      2. notes bound to a subject;
      3. a pass creating a concept with cited claims;
      4. a fourth session whose `memory.recall` returns the concept first and drills down to a cited note and a verbatim exchange;
      5. a `memory.forget` removing the dependent claim.
      **Amended 2026-11-03:** the pass binds the three notes as it creates the subject, and the fourth session writes a note that binds at write time (shown through `dirty`). The curator is scripted, so the exchange is reached by `memory.read` on the exchange hit that `memory.recall` lists after the concept; the claims cite the fact notes, because the pass shows the notes of the cluster it was asked about.
      It emits no secret and passes the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`).
    - Functional: **Reference host.** `apps/prism-agent` coding and research agents gain an opt-in `ontology: true` option (default off until plan 210's verdict). It adds `memoryWiki()` next to the existing fabric, using the agent's model unless `ontologyModel` is set. `ontology` without `memory` is an error, and so is `ontologyModel` without `ontology`. A deterministic scenario on the mock provider covers recall-through-concept across sessions. `bun run --filter @arnilo/prism-agent test` stays green.
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
      // The reference host's `HostConfig` (also `prism-agent.json`): the factories are createCodingWorker / createResearchWorker.
      await createCodingWorker({ ...config, memory: "coding", ontology: true, ontologyModel: "openai/gpt-5-mini" });
      ```
    - Files to Create/Edit:
      - `examples/three-tier-memory.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`;
      - `apps/prism-agent/src/host/{coding,research,config}.ts`, `apps/prism-agent/src/host/ontology.ts` (new: the one place the wiki package is listed), `apps/prism-agent/src/scenarios/ontology-memory.ts` (new), `apps/prism-agent/package.json` and `bun.lock` (the workspace dependency), `apps/prism-agent/README.md`;
      - `scripts/package-truth.mjs` (the package notes the README and docs tables are generated from), `src/__tests__/docs.test.ts` (the demo list);
      - `PRODUCT.md`, `README.md`, `docs/index.md`;
      - fabric, wiki and OM READMEs;
      - `CHANGELOG.md`.
    - References:
      - Tasks 2–8; plan 202 Task 16; plan 208.
  - Test Cases to Write:
    - `three_tier_example_runs_and_emits_no_secret` (execution gate).
    - `reference_host_ontology_option_recalls_concept_across_sessions` (mock provider).
    - `reference_host_ontology_off_by_default`.
    - `ontology_option_is_validated_in_the_config_file`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a host option and the documented memory architecture.
    - Docs pages to create/edit:
      - `PRODUCT.md`, `README.md`, `docs/index.md` (three memory rows);
      - fabric, wiki and OM READMEs;
      - `apps/prism-agent/README.md`, `examples/README.md`;
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes — the fabric, wiki and OM rows name their tier.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-03):
    - **What changed.**
      - *Example:* `examples/three-tier-memory.ts` (about 0.4 s, deterministic across three runs). One inline provider scripts `mock/main`, `mock/observer` and `mock/curator`; the agent lists OM (T0, turned on with `om`), `memoryFabric({ tools: { root }, exchanges: {} })` (T1) and `memoryWiki` (T2, `triggers: ["accumulation"]` with `minNotes: 50` so the automatic check stays quiet and only `wiki:consolidate` runs a pass). It prints and asserts: three sessions leave 3 facts and 3 exchanges, none bound; one pass writes a `payments` concept (create, three claims each citing a note, three binds); a fourth session's `memory.insert` binds at write time and marks `payments` dirty (`evidence`); `memory.recall` puts the concept first and `memory.read` reaches a cited note and a verbatim exchange; `memory.forget` on a cited note takes the concept from 3 claims to 2. The final line is JSON (`tiers`, `modelCalls`). Registered in the `docs.test.ts` demo list (with a check of that JSON and the forget line), in `examples/README.md` and in the wiki's `scripts/e2e-coverage.json` suites.
      - *Reference host:* `HostConfig.ontology?: boolean` and `ontologyModel?: ModelRef`, both accepted by `loadHostConfig` (unknown values rejected; `ontology` without `memory` and `ontologyModel` without `ontology` are errors). `host/ontology.ts` `ontologyPackages(config, workspace)` returns `[memoryWiki({ workspaceRoot, consolidate: { model } })]` or `[]`; `coding.ts` and `research.ts` spread it right after the fabric. The wiki's `workspaceRoot` is the worker's workspace; its sources stage under the fabric's `tools.root` (`<dirname(storePath)>/memory`). The host holds no ontology logic. `@arnilo/prism-memory-wiki` is now a workspace dependency of the app (`package.json`, `bun.lock`).
      - *Scenario:* `scenarios/ontology-memory.ts` runs the research worker (`memory: "conversational"`, `ontology: true`, `ontologyModel: "mock/curator"`) through three fact sessions, `wiki:consolidate`, a recall session and a forget; `runTurn` and `textOf` are now exported from `conversational-memory.ts` so the two scenarios share the approver loop (the research worker's policy asks for `memory.insert` and `memory.forget`).
      - *Docs:* `PRODUCT.md` gains "Memory" under "Native packages" as three short paragraphs in the order the 2026-10-31 amendment asks for (standing rules, the record, the ontology), with the cost and "unmeasured" stated and no quality claim. The fabric, OM and wiki READMEs each open with their tier's role and link the other two. The README, `docs/index.md` and `docs/release.md` package tables are generated from `PACKAGE_NOTES` in `scripts/package-truth.mjs`, so the three notes were edited there and the tables regenerated with `bun scripts/package-truth.mjs --emit-docs` (which also rewrote `scripts/package-truth.json` and `docs/_evidence/phase54-package-map.md`: a timestamp and the fabric/wiki/core baseline line counts). `docs/index.md` bullets and `apps/prism-agent/README.md` (a paragraph on `ontology`) were edited by hand; the root `CHANGELOG.md` has the entry.
    - **Findings that affect later tasks.**
      - *Plan 210:* the host option is the default-off switch to decide. Turning it on adds, per due subject, a model call on `ontologyModel` (or the worker's own model) in the background; with no `ontologyModel` the pass runs on the worker's model.
      - *Plan 208/209:* the example's fourth session shows binding without a model call only after a subject exists. Notes written before the first pass stay unbound until a cluster pass (needs `minNotes` unbound notes sharing a keyword, or `wiki:consolidate`, which lowers the cluster threshold to 2).
      - *Exchanges are not cited by a cluster pass:* exchanges carry no enrichment keywords, so a keyword cluster contains only the typed notes; a concept reaches an exchange through the recall hit that follows it, not through a citation. Whether the curator should cite exchanges is plan 208's question.
      - *Drive-by:* `biome check --write` run over `apps/prism-agent/src` reformatted 16 files this task did not touch (import order and line wraps only). The auto-mode classifier denied reverting them with `git checkout`, so they remain modified in the tree for the owner to keep or discard.
    - **Verification.** `bun run typecheck` clean across the workspace (`@arnilo/prism-agent` included); `examples` tsc clean; `apps/prism-agent` tests 57 pass / 1 fail, the failure being `conversational_memory_scenario_recalls_across_sessions_and_forgets` for the reason Tasks 2–4 recorded (the abstention line echoes the query term; not from this task) and the 3 new tests passing; `src/__tests__/docs.test.ts` and `packaging.test.ts` 344 pass (the example gate included); `reference-host-boundary.test.ts` 4 pass; `scripts/e2e-coverage.test.mjs` and `package-truth.test.mjs` 12 pass; `biome check` clean on every file this task wrote (`docs.test.ts` has a formatting diagnostic at its existing line 1298, untouched). Not run: the `scripts/phase*` tests and `prefix-probe.mjs`, which this task does not touch.
    - **Baseline diff.** None: no package export moved (the host and the example are not packages). The generated `phase54-package-map.md` shows baseline line counts for core, fabric and wiki, which come from earlier tasks.
    - **Sweep.** No name was retired. The plan's `promote: { observational: true }` is retired (plan 188.3) and is recorded above as an amendment, not reintroduced.

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

Results (executed 2026-11-03): build:core, typecheck, fabric 645 pass / 29 skip / 0 fail, wiki 74, memory-core 64, observational 101, `prefix-stability.test.ts` 24, `three-tier-memory.ts` exit 0, `docs.test.ts` 65 and `packaging.test.ts` 279 all pass; `prefix-probe.mjs` wrote `docs/_evidence/memory-bench/207/prefix-probe.json` (no ontology scenario; see Compromises Made). The host suite is 57 pass / 1 fail (the inherited after-forget test). `biome check` is clean on every plan-207 file (the four test files that still had import-order diagnostics were fixed); the remaining diagnostics are in files this plan did not own. `release.mjs gate`: fabric, wiki and core baselines clean; fails only on the Ollama Cloud and Kilo baselines and the kernel size ceilings, which belong to other plans.

## Compromises Made

- **No ontology scenario in `prefix-probe.mjs`.** The probe is plan 202's frozen cache-stability tool, so it was rerun unchanged (every additive scenario keeps one prefix hash; `forget` and `second-instance` show two, as designed) and the ontology's byte pins live in the fabric tests (`prefix-stability.test.ts` 24 pass). The probe therefore says nothing about a pass writing a concept mid-session; only the unit tests do. Implications: the cache claim for the ontology tier rests on tests, not on the probe artifact.
- **Ingested sources count as `minNotes` notes in the accumulation triggers (Task 8).** Without it a lone source never reached the threshold of five and "queued for the next pass" was false. Implications: one source is always due on its own, so ingesting many small files costs one background model call each.
- **Staging is not atomic with indexing (Task 8).** Files are staged first and nothing is rolled back if `indexSource` throws; the next startup reconcile indexes `extract.md` unbound. A flagged source is staged but not indexed, and the reconcile later indexes it as a flagged candidate that `pending` skips. Implications: a failed ingest can leave an orphan directory under `sources/`.
- **The jail's `tools.maxFileBytes` (default 50 KiB) hides a larger `extract.md` from the startup reconcile (Task 8).** The ingest itself indexes up to `maxEntryTextChars` directly. Implications: a large source is indexed at ingest time only, not rediscovered after a lost index.
- **A curator cluster cites typed notes, not exchanges (Task 9).** Exchanges carry no enrichment keywords, so a keyword cluster never contains one; a concept reaches an exchange through the recall hit that follows it. Implications: the "drill down to an exchange" path depends on recall listing exchanges, not on a citation.
- **The reference-host scenario and the example script the curator.** They prove wiring, binding, recall order and the deletion cascade; they say nothing about the quality of a real curator's claims. Implications: no quality claim ships from this plan.
- **16 unrelated `apps/prism-agent` files were reformatted by a `biome --write` run (Task 9)** and were left modified because the revert was denied; the diffs are import order and line wraps only.
- **Whole-plan gate was red for reasons outside this plan; cleared 2026-11-03 (see Further Actions).** `release.mjs gate` now exits 0. The fabric baseline was regenerated twice (identical export set; only the export-list order moved after Biome reformatted `exports.ts`).
- **The host after-forget test was stale, not the product (fixed 2026-11-03).** The recall abstention line echoes the searched terms by documented contract, so the test now asserts the abstention and the absence of the forgotten note's text.

Recorded in plans/backlog.md.

## Further Actions

- **Decide the `ontology` default (P1).** Plan 210 decides, on plan 208's criteria and the held-out run, whether `ontology: true` and the wiki package stay opt-in, become a preset, or are removed. Why: this plan ships the tier unmeasured and makes no quality claim.
- **Cache evidence for a concept written mid-session (P2).** Add an ontology scenario to a new (not the frozen) prefix probe, or extend the probe in a plan that is allowed to re-pin it. Why: the compromise above leaves the claim on unit tests.
- **Decide whether the curator may cite exchanges (P3).** Plan 208 should test giving exchanges keywords or showing the cluster's neighbouring exchanges. Why: today only typed notes become citations.
- **Clean up failed ingests (P4).** A `wiki:lint` check or an ingest rollback for an orphan `sources/<id>/` with no indexed `extract.md`. Why: staging is not atomic with indexing.
- **Clear the inherited gate blockers (P1) — done 2026-11-03.** (1) 199 stray `tsc`-emitted `src/**/*.d.ts` files had been committed beside their sources; they made the kernel pack 133 files / 7,872 "source" lines too large, were deleted and `.gitignore` now blocks them. (2) The remaining real kernel growth (provider-kit tool-name map, adaptive thinking, skill/tool list helpers, the Kilo and LiteLLM support, shipped docs) was rebaselined in `scripts/budgets.json` with attribution: 1202843 packed / 3916012 unpacked / 1516 root exports / 40301 source lines, file count unchanged at 363 of 366. (3) The Kilo baseline differed only in export-list order (same set) and was regenerated; the Ollama Cloud baseline was created after reviewing its surface. (4) The host after-forget test was fixed. Still open and not code-fixable: `scripts/memory-bench` `Task5Manifest: the candidate product has uncommitted changes` passes only on a clean checkout (416 pass / 1 fail now). Why: the gate could not pass without them.

Recorded in plans/backlog.md.
