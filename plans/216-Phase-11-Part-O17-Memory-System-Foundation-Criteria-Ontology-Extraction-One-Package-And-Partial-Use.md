# Phase 11 Part O17 — Memory system foundation: efficacy criteria, the ontology moved into the wiki, one memory package, partial use

## Objectives

- Start the memory model the owner decided on 2026-11-08 (`docs/_evidence/memory-model/design.md`): one memory system modelled on human memory (STM → WM → Rehearsal → LTM, plus Sleep). A host can use it partly or whole.
- Pre-register, before any code it measures, the efficacy rows every later plan of the track is judged by: `scripts/memory-bench/memory-model-criteria.json` and the gates M-1 … M-5, M-T (retrieval, plan 219.1), K-1 and A.
- Take the ontology out of memory and give it to the wiki, a separate knowledge package (owner, 2026-11-08: "It should be part of the wiki and not memory"). The wiki gets its own store, its own agent surface, and a read-only view of long-term memory with a deletion feed.
- Consolidate `@arnilo/prism-memory-observational` (session tiers) and `@arnilo/prism-memory-fabric` (LTM) into one package, `@arnilo/prism-memory-system`, with components a host turns on or off and fail-closed composition.
- Retire what the redesign removes outright: fabric working memory (it frees the WM name), the episode *view* and episode merge.

## Expected Outcome

- `scripts/memory-bench/memory-model-criteria.json` is frozen and hashed, with rows S1–S4, M1–M5, R1–R6, T1–T8, L1–L4, Z1–Z4 and their gates, plus the "before" baselines and the fixture index.
- `@arnilo/prism-wiki` owns concepts, subject binding, concept recall, the passive pointer, `wiki_ingest` sources and the curator pass. The memory packages hold no `concept` kind and no ontology code.
- `packages/memory/system` (`@arnilo/prism-memory-system`) contains the session tiers (still with today's worker behaviour) and the LTM (today's fabric, minus the ontology and working memory). `@arnilo/prism-memory-observational` and `@arnilo/prism-memory-fabric` are retired, with no alias and with named migration errors.
- The `stm`, `wm`, `rehearsal`, `ltm` and `sleep` components are configurable. Four profiles (`ltm`, `session`, `stm`, `full`) are tested, and one example demonstrates them.
- Behaviour is preserved: the presets' provider requests are byte-identical before and after each move (offline replays), and the plan 202 cache-stability pin passes.

This plan is the first of the memory-model track in roadmap Phase 11 ("Memory model (owner decision 2026-11-08)"). It runs after plan 210, which is narrowed to the audit of what this redesign keeps, and before plans 217–223 (with 219.1, the retrieval plan, between 219 and 220).

**Review task included** (Task 1): this plan moves and creates packages, adds a service (`memory.ltm`) and retires two. It adds **no kernel contract**: every seam used (`prism.services`, `prism.slots.compaction`, `prism.state.log`, `session.background`, commands, tools with `when`) already exists.

**Not in this plan:**

- No worker behaviour changes. Today's observer, reflector and dropper move unchanged except for plan 210 Task 7.2's three robustness fixes; plans 217–219 redesign them.
- No version bump and no publish. The memory packages stay on the experimental line (plan 215), and any `npm deprecate` of a retired name is recorded as an owner action only.
- No paid run. Every move here is measured offline as byte-identical (Task 8). Live efficacy is measured from plan 217 on, at the gates Task 2 registers.

## Tasks

- [x] Task 1: Phase review, owner name decisions and assumption check (read-only)
  - Acceptance Criteria:
    - Functional: **Inventory.** List every contract the plan touches, with `file:line`:
      - the services `memory.fabric` and `memory.fabric.concept-handler` (`packages/memory/fabric/src/index.ts:276-277`);
      - the `FabricOntologyPort` (`packages/memory/fabric/src/ontology/port.ts:198`);
      - OM's compaction slot claim (`packages/memory/observational/src/index.ts:151`) and its `recall` tool (`:98`);
      - the fabric's tool registration (`index.ts:670`) and commands (`index.ts:929-973`);
      - the wiki's registrations (`packages/memory/wiki/src/extension.ts:210-228`);
      - `WorkingMemoryStore` (`packages/memory/core/src/types.ts:348`);
      - the `episode` view (`packages/memory/fabric/src/create.ts:360-380`);
      - each package's state and ledger record names.
    - Functional: **Classification.** Classify each Objectives bullet as *expressible with what exists* or *needs a kernel addition*. The expected verdict is that none needs one. A finding otherwise stops the plan for a re-cut.
    - Functional: **Assumptions checked against source:**
      1. the fabric's concept handling is separable: list every non-ontology fabric file that names `concept` (about 20, including recall ranking, directory, lifecycle, OKF codec, team store, consolidation) and what each does with it;
      2. LTM deletion has a lineage record a consumer can read after the fact (`packages/memory/core/src/lineage.ts`);
      3. the wiki reaches fabric only through the port and services;
      4. no stable package or reference-host default imports a memory package (plan 215 gate);
      5. which memory packages have been published on the experimental line.
    - Functional: **Owner decisions recorded** in this task's notes before Task 3:
      - the memory package name (proposed `@arnilo/prism-memory-system`, `packages/memory/system`);
      - the wiki's name and directory (proposed `@arnilo/prism-wiki`, a new group `packages/knowledge/wiki`);
      - whether `@arnilo/prism-memory-rag` keeps its name.
    - Functional: **Backlog.** List the `plans/backlog.md` entries that track the withdrawn direction: wiring fabric tools to the observational session, the episode view, OM deletion-propagation legs, and the 208 ontology items. For each, say whether Task 3, 4 or 7 removes it or a later plan inherits it. The executor removes the obsolete ones in the task that obsoletes them, naming each title in that task's note.
    - Performance: n/a — read-only.
    - Code Quality: No code change.
    - Security: The inventory records which secrets and redaction paths each moved component uses (worker secret sets, chunk redaction to come, store connection refs).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/memory-model/design.md`;
      - roadmap Phase 11 "Memory model (owner decision 2026-11-08)";
      - `references/prism.md` §1–§3;
      - the three package READMEs;
      - `graft callers --depth all` for `MEMORY_FABRIC_SERVICE`, `FabricOntologyPort`, `createObservationalFlush`, `memoryFabric`, `memoryObservational`, `memoryWiki`.
    - Options Considered:
      - Skip the review because no kernel contract changes. Rejected: the plan moves three packages and creates two, which §2 requires a review for.
    - Chosen Approach:
      - Read-only review with a verdict in Notes.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - this plan (Notes only).
    - References:
      - plan 210 header amendment of 2026-11-08; plan 157 (the packages' origin).
  - Test Cases to Write:
    - none — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none (Notes in this plan).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Verdict: no kernel addition.** Every Objectives bullet is expressible with what exists (table below). One narrower finding re-cuts three acceptance lines, not the plan: `package_renamed` has no seam (finding F1). Tasks 3, 4, 5 and 7 are amended below.
    - **Owner decisions (2026-11-08):**
      1. Memory package: `@arnilo/prism-memory-system`, `packages/memory/system`.
      2. Wiki: `@arnilo/prism-wiki`, new group `packages/knowledge/wiki` (needs the workspace glob `packages/knowledge/*` in the root `package.json`, `scripts/package-truth.mjs` and `release.mjs` lists).
      3. RAG: **renamed** to `@arnilo/prism-rag` (not in the original plan; now in Task 3). Directory proposed `packages/knowledge/rag`, beside the wiki; **confirm at the start of Task 3**. About 40 files name the old package: `packages/{memory/{rag,core,fabric,wiki},integrations/observability,hosts/host-builder/data}`, `apps/prism-agent`, `examples`, `templates/deep-research`, `scripts` (11), `src/__tests__` (5), `docs`, `roadmap.md`, `bun.lock`, `scripts/compat-baseline`.
    - **Inventory (real `file:line`; the plan's line numbers were off by up to 360):**

      | Contract | Where |
      |---|---|
      | Services `memory.fabric`, `memory.fabric.concept-deletion` | provided at `fabric/src/index.ts:247-248`; names at `fabric/src/ontology/port.ts:50`, `ontology/handler.ts:5` |
      | `FabricOntologyPort` | `fabric/src/ontology/port.ts:198-234` (members: `scopes`, `sourceRoot`, `indexSource`, `subjects`, `pending`, `read`, `applyConceptEdits`, `bind`, `dirty`, `screen`, `settle`); `FabricOntology` (`retract`, `attach`, `refresh`, `index`) follows |
      | OM compaction slot claim; `recall` tool | `observational/src/index.ts:151`; `:98` (`when: enabled`) |
      | OM commands / event / background / state | `om`, `om:model`, `om:status`, `om:view` (`commands.ts:71,87,119,160`); event `om.status` (`index.ts:78`); background task `om.observe` (`:119`); session state `om`, log `ledger` (`state.ts:13-14`); ledger record types `om.observations.recorded`, `om.reflections.recorded`, `om.observations.dropped`, `om.compacted`, `om.context.pinned`, `om.folded` |
      | Fabric tool registration; commands | `fabric/src/index.ts:594-597` (`when: enabled`); commands registered `:834-877`, defined `:1023-1459` (`memory`, `memory:reindex/export/import/archive/consolidate/maintain/status/share/lifecycle`) |
      | Fabric session state | `fabric.enabled`, `fabric.touchedPaths`, `fabric.cues`, `fabric.promote`, `fabric.exchanges`, `fabric.clock`, `fabric.delivery` (`index.ts:136-142`) |
      | Wiki registrations | `wiki_ingest` tool `extension.ts:210`; commands `wiki:status/consolidate/lint/ingest` `:211-228`; state `wiki.last` (`:189`); event `wiki.consolidated` (`:206`); `requires.services: ["memory.fabric"]` (`:130`), consumed at `:180` |
      | `WorkingMemoryStore` | `core/src/types.ts:348-353`. Callers beyond the fabric: core's SQLite, Postgres and markdown drivers (`core/src/{sqlite,postgres,fabric}/index.ts`, `fabric/okf.ts`) and the `index.ts` export |
      | `episode` view | `fabric/src/create.ts:359-380` (`rememberEpisode`), option `observational` (`:275-280`); imports `foldObservationalMemoryLedger` from OM (`:14`) |
      | Note kinds | `fabric/src/types.ts:33` (`MemoryNoteKind`), `:38` (`MEMORY_NOTE_KINDS`), `:139` (`DEFAULT_RECALL_KINDS`) |

    - **Classification:**

      | Objective | Verdict |
      |---|---|
      | Memory model start, one system | expressible: `prism.services`, `state.session`/`state.log`, `session.background`, commands, `tools` with `when` |
      | Pre-registered criteria and gates | expressible: scripts and evidence only |
      | Ontology to the wiki | expressible: the wiki already uses `services.consume`; the new `memory.ltm` is a plain service |
      | One memory package, partial use | expressible: per-component registration inside `setup`, as `memoryObservational` does today |
      | Retire working memory, episode view and merge | expressible: removals |
      | Named migration errors | expressible for config, ledger, kind and store errors. **Not** for a retired *package name* (F1) |

    - **Findings:**
      - **F1 — `package_renamed` has no seam.** No such error code exists. A host config or manifest naming a package that is gone fails in the kernel manifest loader with `package_missing` or `import_failed`, which already name the package. A retired package cannot raise its own error, and a kernel table of retired names would break "the kernel never names a package". **Amendment (Tasks 3–5):** no new error code. The hint is the `docs/migrate-to-0.13.md` row; the test asserts the manifest loader fails closed with the existing code naming the old package, and the old name is absent from every workspace list. `src/__tests__/docs.test.ts:265-276` and `:630` hold the retired-name lists, so the retired names are added there.
      - **F2 — Deletion lineage is partial (assumption 2).** `forget`, revoke, legal hold and correction write id-only invalidation records with an `at` timestamp (`core/src/lineage.ts:97-130`, `fabric/src/memory.ts:113-143`), readable through `vectorStore.listInvalidated(exactScope)` on the in-memory, SQLite, Postgres and markdown stores. **Retention deletes, capacity eviction and import replace are hard deletes with no record** (`memory.ts:690-710`, `okf-bundle.ts:266`), yet the fabric's own cascade removes claims for them (`retract.ts` `deleted`, `import`). The in-process retract event is a `WeakMap` listener (one per memory instance), so it has no cursor. **Amendment (Task 3):** `deletions(since)` is `listInvalidated` filtered by `at`, and open-time reconciliation also checks that every id a claim cites is still readable (`read(scope, ids)`, bounded batches). A missing id retracts the claim. That covers hard deletes without a new LTM journal. Task 3 verifies `listInvalidated` needs an exact thread scope and that the port maps fabric scope levels onto it.
      - **F3 — The wiki is not port-only (assumption 3 is false).** Non-test wiki code imports values from `@arnilo/prism-memory-fabric` root: `parseConceptBody`, `conceptSources`, `CONCEPT_RELATIONS`, `MAX_CLAIM_CHARS`, plus types (`ConceptDoc`, `ConceptEdit`, `OntologyNoteView`, `OntologySubject`, `OntologySourceResult`, …). This is the ontology grammar that Task 3 moves into the wiki, so it resolves by the move. The wiki also imports `resolveMemoryWorkerLimits` and `MemoryWorkerLimitOptions` from `@arnilo/prism-memory-observational` (`limits.ts:19,52`; 3 files), which would make the wiki depend on the memory system although it must run without memory. **Amendment (Task 3):** that helper moves to `@arnilo/prism-memory-core` (shared library), the fabric and the session tiers import it from there, and the core compat baseline is regenerated.
      - **F4 — Concept handling is separable (assumption 1), with 22 non-ontology files.** All are ranking, filtering or exclusion branches, none stores data the ontology does not own:
        - *recall and rendering:* `scope/recall.ts` (concept shadow key), `excerpt.ts` (skip), `tools.ts` (24 refs: concept-first search and render), `directory.ts` (21: concept listing), `context.ts` (7: passive pointer), `delivery/cues.ts` (9: path cue suppression), `delivery/team.ts` (12: shareable kind);
        - *lifecycle:* `lifecycle/{index,archive,capacity,merge,strength,maintain}.ts` (a concept is never archived, merged, evicted or decayed);
        - *config and types:* `types.ts` (27), `config.ts` (decay table), `index.ts`, `create.ts` (binding at write);
        - *consolidation and bundle:* `consolidation/{extract,write}.ts` (subjects, the `new` slug), `okf-bundle.ts` (concept index refresh on import);
        - *core:* `core/src/fabric/okf.ts` (`concept: "Concept"` label), `layout.ts` (`concepts` directory).
        - Removing them deletes branches and leaves the others unchanged. The decay table's `Exclude<MemoryNoteKind, "concept">` becomes plain `MemoryNoteKind`.
      - **F5 — Working memory spans `memory-core`.** `WorkingMemoryStore` is a member of the store sets that core's SQLite, Postgres and markdown drivers return, with `blocks.ts`, `okf-bundle.ts` and `conformance.ts` in the fabric using it. Task 7 therefore edits core's three drivers and their conformance as well, and leaves any existing SQL table in place (no migration; it is unread). Added to Task 7.
      - **F6 — Publish state (assumption 5).** `npm view` returns 404 for `@arnilo/prism-memory-fabric` and `@arnilo/prism-memory-observational`: none of the five experimental packages has been published (all at `0.13.0-experimental.0`, plan 215 Task 39 pending). No `npm deprecate` is needed for the retired names; the release notes record the retired names for the first publish. `@arnilo/prism-memory-compaction` is stable at 0.13.0 and is not touched.
      - **F7 — Stable boundary holds (assumption 4).** `src/__tests__/experimental-boundary.test.ts` (`stable_packages_never_depend_on_experimental`) reads the `experimental` list in `scripts/independent-packages.json`. Importers outside `packages/memory` are examples, host-builder data, `apps/prism-agent` (opt-in `memory` and `ontology` only), scripts and tests; `@arnilo/prism-observability` and `@arnilo/prism-context-engineering` hold `memory-core`/`memory-rag` as `devDependencies` only. The `experimental` list must be rewritten in Tasks 3–5 to `memory-core`, `memory-system`, `wiki`, `rag`.
      - **F8 — Secrets and redaction paths each moved component uses.**
        - *Session tiers:* `redactSecrets` on every serialized entry (`observational/src/serialize.ts:17`) and on rendered blocks (`render.ts`), with the worker secret set passed through `context.ts` and `compactor.ts`. Plan 210 Task 7.2's first fix makes the package forward the session's set to every worker.
        - *LTM:* the trust scan and `rules.redact` on writes, exchange refusal counts (`index.ts:630,721`), and `store.postgres.connection` resolved through `prism.credentials.resolve` (`:975`, ref-only).
        - *Wiki:* the trust scan through `port.screen` (`consolidate/pass.ts:355-401`), which moves to the wiki unchanged; curator model calls use `prism.models.client`.
        - No component reads a secret from config text.
      - **F9 — Callers.** `graft callers createObservationalFlush --depth all`: one product caller (`setup`, `observational/src/index.ts:88`) and two tests. `FabricOntologyPort` and `WorkingMemoryStore` have no indexed call edges (interfaces); the grep sweep lists their uses (fabric ontology files, the wiki, `scripts/memory-bench/ontology-arm.mjs`, `mechanism-probes/ontology.mjs`, `apps/prism-agent/src/scenarios/ontology-memory.ts`, `examples/three-tier-memory.ts` and its host-builder copy, `scripts/fixtures/e2e-full-surface-journey.mjs:256`).

    - **Backlog hand-off** (the executor removes the entry in the task named; each title is named in that task's note):

      | `plans/backlog.md` entry | Disposition |
      |---|---|
      | "Fabric tools do not wire the observational session" (l.554) and "Wire fabric tools to the observational session" (l.626) | Task 7 removes both: the episode view they extend is deleted |
      | "Give deletion propagation an observational-memory leg" (l.610) and "Observational-memory deletion-propagation leg deleted" (l.642) | Inherited by plan 217: session chunks are reference-counted across tiers with the cross-tier deletion invariant (design principle 2, line 56, and §5.2). Task 4 re-points the entries to plan 217 |
      | "Clean up failed or flagged source ingests" (l.1263) | Task 3 re-scopes it to the wiki's own source store (it is a `wiki:lint` item there) |
      | "Revisit sources counted as minNotes notes" (l.1280) | Task 3 removes it: sources stop being LTM notes, and the wiki's accumulation trigger counts its own sources |
      | "Cache evidence for a concept written mid-session" (l.1246), "Decide whether the concept curator may cite exchanges" (l.1254) | Inherited by plan 222 (the wiki screen); Task 3 re-points them. Citing LTM exchange ids stays possible through the read-only port |
      | "Decide the ontology default and keep the tier honest" (l.1238), "Revisit closing the 208 screen on a partial run" (l.1288), "Treat the O3 early read as development evidence only" (l.1296) | Inherited by plans 222–223; Task 3 re-points them (the criteria file is unchanged) |
      | "Finish memory acceptance on the final product" (l.1221), "Restore inherited plan 202 closure checks before release" (l.1229) | Plan 223 (not obsoleted here) |

    - **Assumption results:** (1) separable: F4; (2) partly: F2; (3) false: F3, resolved by the move plus the limits relocation; (4) holds: F7; (5) none published: F6.

- [x] Task 2: Pre-register the memory-model efficacy criteria, fixtures and gates
  - Acceptance Criteria:
    - Functional: **`scripts/memory-bench/memory-model-criteria.json`** is written, frozen and hashed (the `hashRule` convention of `cleanup-criteria.json`) before any plan 217–222 code exists (plan 219.1 included).
      - **Pins:** statistics are plan 198's clustered CIs on paired items. Non-inferiority is within 2 points at the CI lower bound; a gain needs a CI lower bound > 0. Partitions are development partitions for gates M-1 … M-5, M-T and K-1, and `heldout-a` (then `heldout-b` once) for gate A.
      - **Rows**, each with metric, unit, direction, arms, suites or fixtures, threshold and gate:

        | Row | Gate | Metric | Arms / scope | Threshold |
        |---|---|---|---|---|
        | S1 | M-1 | re-derivation calls (`grep`/`read`/`bash` that re-derive an earlier task's changes) per related task | `STM` vs `OM-before`, live long-session coding suite | lower, CI low > 0 |
        | S2 | M-1 | verbatim chunk recall | offline | exact: 100% byte-equal, no other tool runs |
        | S3 | M-1 | QA | `beam-1m`, `longmemeval-m` dev, vs `OM-before` | non-inferior |
        | S4 | M-1 | worker tokens per 10k eligible tokens | vs `OM-before` | ≤ 1.25×, or a written justification |
        | M1 | M-2 | task success on tasks after a mid-episode re-plan | live re-plan family, `WM` vs `STM-only` | non-inferior; vs `OM-before`: gain |
        | M2 | M-2 | protected-item loss | offline | exact: 0 |
        | M3 | M-2 | median achieved surface ratio when the protected share is below the target | offline | ≤ `targetRatio` + 0.1 |
        | M4 | M-2 | prefix bytes between compactions | offline | byte-identical |
        | M5 | M-2 | QA, `WM` vs `STM-only` | dev | non-inferior |
        | R1 | M-3 | use-verified share of Rehearsal's LTM writes over a multi-session lifecycle | baseline 0 (plan 202 Task 16) | ≥ a threshold fixed here with `power.mjs`; the proposal is 0.2 |
        | R2 | M-3 | W1, W2, W3 | `full` vs `session` (no Rehearsal) on the work-outcome suite | at least one gains, none regress |
        | R3 | M-3 | claim support of LTM writes | the panel, once calibrated | ≥ 0.9 supported |
        | R4 | M-3 | plan 202's safety suite | offline + live | pass |
        | R5 | M-3 | multi-session QA (`longmemeval-m` multi-session ability) | vs `P` (fabric-only with exchanges) | non-inferior |
        | R6 | M-3 | temporal-reasoning ability strata | vs `P` | gain |
        | T1 | M-T | all-required evidence coverage of the shown result, per ability (offline; question as query; fine gold) | `RT` vs `full-r` and `P`; dev `longmemeval-m`, `beam-1m`, `locomo`; exchange ingest and plan 219's `full-r` store snapshots | gain pooled (CI low > 0); no ability below −2 points |
        | T2 | M-T | candidate recall@32 | same | non-inferior |
        | T3 | M-T | ranking invariants (I13): prior overtakes beyond the band; single- vs multi-scope disagreement | offline property suite | exact: 0 |
        | T4 | M-T | store parity (I14): ordered top-32 ids across SQLite, Postgres, markdown index, in-memory | parity fixture | exact: identical |
        | T5 | M-T | hit@5 on the paraphrase set; hit@5 on the non-English set | offline, `RT` vs `P` | paraphrase: gain; non-English: ≥ 0.8 |
        | T6 | M-T | confidence separates answerable from unanswerable (AUROC); false abstentions on answerable items at the frozen thresholds | offline abstention set, `RT` vs `P` | AUROC gain; false abstentions lower |
        | T7 | M-T | QA accuracy per ability, with all-required evidence coverage | live dev, `RT` vs `full-r`; leave-one-out per stage | gain on at least one of multi-session, temporal, event ordering, knowledge update; none regress |
        | T8 | M-T | recall p95 at 10k and 100k notes; Rehearsal cue tokens per episode | offline + live | p95 ≤ 1.5× `P`; cue tokens ≤ 15% of Rehearsal output tokens |
        | L1 | M-4 | W1 corrected-mistake repeats | with vs without procedural | lower |
        | L2 | M-4 | failure-signature recurrence after acquisition; false-trigger rate; extinction | live; false triggers and extinction offline | lower; ≤ 5%; extinction exact |
        | L3 | M-4 | W4 orientation cost; prefix stability | with vs without priming | lower; byte-identical prefix within an epoch |
        | L4 | M-4 | QA | dev | non-inferior |
        | Z1 | M-5 | cross-session W1–W4 and multi-session QA | `sleep` vs `no-sleep` over a multi-session lifecycle | gain on at least one, none regress |
        | Z2 | M-5 | semanticization precision | the panel | ≥ 0.9 supported |
        | Z3 | M-5 | month-12 growth: retrieval and store bytes | growth simulation | non-inferior |
        | Z4 | M-5 | model calls and tokens per sleep run | budget | within the stated budget |

      - **Evidence coverage beside accuracy.** Every QA row (S3, M5, R5, R6, T7, L4, Z1) reports all-required evidence coverage per ability next to accuracy, so a retrieval miss and an answering miss are told apart (owner, 2026-11-08, retrieval review).
      - **Retrieval set construction rules** (the sets are built and hashed by plan 219.1 Task 2, before its first product change):
        - *paraphrase:* development questions only; named entities kept; every other content term replaced, so the query shares no analyzed non-entity term with its gold evidence (checked by script);
        - *non-English:* Chinese, Japanese and accented-Latin notes and queries with gold ids;
        - *parity:* about 500 notes over three scopes with keys;
        - *abstention:* answerable and unanswerable development items from the abstention and adversarial strata;
        - the confidence thresholds are fitted on the abstention set by one stated rule (maximum F1, false abstention weighted ×2) and frozen before gate M-T.
      - **The wiki rows** are plan 208's `three-tier-criteria.json`, used unchanged and re-pointed by reference:
        - `P+O` becomes `ltm` + `@arnilo/prism-wiki` on the K-1 screen and at gate A;
        - this file records the mapping and pins that file's hash; it does not copy its rows.
      - **Acceptance (gate A)** pins the hashes of four criteria files: `robustness-criteria.json`, `three-tier-criteria.json`, `work-outcome-criteria.json` and this file.
    - Functional: **Baselines.**
      - `OM-before` is plan 210 Task 5's moved `OM` arm job definitions (dev cohort, models, caps), run in plan 217 from the last revision before Task 4 of this plan. That revision is pinned by `PRISM_MEMORY_BENCH_SOURCE` and recorded here as soon as Task 4 starts.
      - `P` is plan 210's slimmed product, the hash recorded by plan 210 Task 7 (`docs/_evidence/memory-bench/210/slimmed/record.json`).
    - Functional: **Fixture index.** Lists the fixtures later plans build, with their owner plan:
      - the offline long-session coding replay (≥ 6 tasks, ≥ 200 entries; plan 217), extended in plans 218–221 with a re-plan, protected items, a repeated benign event, a repeated failure, a preference stated once, a superseded fact and `episode:end`;
      - the live long-session coding family and the re-plan family (plans 217–218, added to the work-outcome runner);
      - the multi-session lifecycle (plans 219 and 221, built on plan 202 Task 16's offline lifecycle suite);
      - the retrieval sets: paraphrase, non-English, parity and abstention (plan 219.1 Task 2), and plan 219's `full-r` store snapshots (kept locally, hashes in evidence).
    - Functional: **Gates template.** `docs/_evidence/memory-bench/memory-model/gates/README.md` defines the M-1 … M-5, M-T, K-1 and A records:
      - budget, models (the providers of plan 210 gate C-1 unless the owner names others; never `openrouter/free`), arms, partitions and caps;
      - the rule that each gate starts only on the owner's word.
    - Performance: n/a.
    - Code Quality:
      - `robustness.mjs` gains `memoryModelVerdict()` and `assertMemoryModelPin()`, mirroring `cleanupVerdict()` and `assertCleanupCriteriaPin()`.
      - `acceptance-report.mjs` gains `--plan memory-model`.
      - No product code.
    - Security: The no-text rule: evidence carries counts, ids and hashes only.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/{cleanup-criteria.json,work-outcome-criteria.json,three-tier-criteria.json,robustness.mjs,acceptance-report.mjs,power.mjs}`;
      - plan 202 Task 16 (`docs/_evidence/memory-bench/202/observational/role.json`);
      - design §9.
    - Options Considered:
      - Let each plan pre-register its own rows. Rejected: rows written after earlier tiers' results are known invite tuning to the result; one file frozen first is the existing discipline (plans 202, 208, 209, 210).
      - Copy plan 208's rows. Rejected: a copy can drift; a reference with a pinned hash cannot.
    - Chosen Approach:
      - One frozen file referenced by every gate, written before the code it judges.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan memory-model --partition dev --gate M-1
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/memory-model-criteria.json` (new) and `memory-model-criteria.test.mjs` (new);
      - `scripts/memory-bench/{robustness,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/memory-model/{README.md,criteria.json,baselines.json,gates/README.md}` (new);
      - `scripts/memory-bench/README.md`.
    - References:
      - design §9; plan 210 Task 4 (pre-registration pattern).
  - Test Cases to Write:
    - `memory_model_criteria_hash_pinned_and_frozen`: fails if a row changes without a new hash.
    - `every_row_names_metric_direction_arms_threshold_and_gate`.
    - `wiki_rows_reference_three_tier_criteria_by_hash`.
    - `gate_a_manifest_pins_four_criteria_hashes`.
    - `baselines_om_before_and_p_resolve_to_recorded_revisions`.
    - `every_qa_row_reports_evidence_coverage_beside_accuracy`: fails if a QA row (S3, M5, R5, R6, T7, L4, Z1) lacks the coverage metric.
    - `retrieval_set_rules_pinned_before_sets_exist`: the four construction rules and the threshold-fit rule are in the frozen file; plan 219.1 Task 2 adds only the sets' hashes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evaluation harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`;
      - the evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Frozen.** `scripts/memory-bench/memory-model-criteria.json`, hash `2b50880bdc7ebee4f4a2a6c7dd574b6e2acdbb0bfbd58901d37e66f9d02ef9d5`, recorded in `docs/_evidence/memory-bench/memory-model/criteria.json`. No plan 217–222 code exists. It pins robustness `dd1add49…`, three-tier `3d5a5c10…` and work-outcome `d30681ec…`.
    - **Rows as typed tests.** Each of the 31 rows (S1–S4, M1–M5, R1–R6, T1–T8, L1–L4, Z1–Z4) holds metric, unit, direction, arms, scope, gate and one or more `tests` of a fixed kind: `gain`, `nonInferior`, `pooledGainNoAbilityBelow`, `anyGainNoneRegress`, `exact`, `atMost`, `atLeast`, `atMostOrJustified`, `atMostTargetPlus`, `withinBudget` or `pass`. So `memoryModelVerdict()` computes every row with no hand-set value. A missing measurement, a QA row without per-ability evidence coverage, a panel row before calibration, or R1 below its write count is `missing`, never a pass.
    - **R1 threshold (power.mjs).** The share is ≥ 0.2 with at least 32 writes. Against a baseline of 0, every verified write is discordant, so discordance equals the share. At α 0.05 and power 0.8, 32 is the smallest n with a minimum detectable difference ≤ 0.2 (0.1985; 31 gives 0.2010). Plan 202 Task 16's lifecycle wrote 42 notes (detectable 0.1775).
    - **Code.** `robustness.mjs` gains:
      - `MEMORY_MODEL_CRITERIA`, `memoryModelCriteriaHash()` and `verifyMemoryModelCriteria()`;
      - `frozenMemoryModelHash()`, which refuses a file that does not hash to the record;
      - `memoryModelManifestPin()` and `assertMemoryModelPin()`, which also check gate A's four hashes;
      - `verifyMemoryModelBaselines()`, `memoryModelVerdict()` and `memoryModelGateVerdict()`;
      - `--verify-criteria memory-model-criteria.json`.

      `acceptance-report.mjs` gains `--plan memory-model --gate <g> [--partition] [--evidence] [--write]` (`memoryModelReport()`). It reads `docs/_evidence/memory-bench/memory-model/<gate>/evidence.json` and refuses evidence that is unpinned, from another gate, or from a partition the gate may not read. With no evidence the gate is `pending`. K-1 is redirected to `--plan 208 --gate K-1`.
    - **Baselines.** `docs/_evidence/memory-bench/memory-model/baselines.json` records:
      - `P` = `867f8277…` (plan 210 slimmed record);
      - `OM-before` unpinned. The revision is the last one before Task 4, so it cannot exist yet. **Task 4 is amended** with a first step that records it, and the test refuses an unpinned `OM-before` once Task 4 is checked or annotated.
    - **Aligned with plans 217–222 before freezing:**
      - R rows use plan 219's `full-r`;
      - L rows use plan 220's add-one arms (`+procedural`, `+triggers`, `+priming`, `+all`) against `RT`;
      - Z rows use plan 221's `full` against `no-sleep`;
      - the fixture index adds plan 220's `recurring-failure` family;
      - gate records live where each plan names them (`docs/_evidence/memory-bench/<plan>/gates/owner-gate-<gate>.json`, checked by the verifier), not in one shared folder.
    - **Wiki.** K-1 references `three-tier-criteria.json` by hash. `P+O` and `conversational+O` map to `ltm+wiki`, and `coding+O` maps to `coding+wiki`. The verifier refuses copied O rows.
    - **Findings for later plans:**
      - Plan 219.1 Task 2's amendment adds an `amendments` entry (`previousHash`) to the criteria file **and** replaces the hash in `criteria.json` (appending to its `amendments`). The verifier refuses set hashes or thresholds without an amendment. Plan 219.1's file list is amended.
      - Plan 217 Task 6 reads the `OM-before` revision from `baselines.json` (pinned in Task 4, not in this task); its text is amended to say so.
      - Each gate's campaign writes its evidence as `{memoryModelCriteriaHash, gate, partition, rows: {<row>: {tests: {<test id>: …}, coverage}}}`.
    - **Checks:**
      - `memory-model-criteria.test.mjs`: 9 pass (the 7 named tests, plus verdict rules and report refusals);
      - the 12 suites importing `robustness.mjs` / `acceptance-report.mjs`: 148 pass, 1 skip (pre-existing);
      - `src/__tests__/docs.test.ts`: 67 pass;
      - `bun run typecheck`: green;
      - biome format and lint: clean.

      No product code, no export, no baseline change.

- [x] Task 3: Move the ontology out of the fabric into the wiki (`@arnilo/prism-wiki`)
  - Acceptance Criteria:
    - Functional: **Package.**
      - `packages/memory/wiki` moves (`git mv`) to `packages/knowledge/wiki`, named `@arnilo/prism-wiki` (owner, Task 1). The root `package.json` workspaces gain `packages/knowledge/*`.
      - `packages/memory/rag` moves (`git mv`) to `packages/knowledge/rag` (confirm the directory first), named `@arnilo/prism-rag` (owner, 2026-11-08, Task 1). Behaviour is unchanged; callers move in this task (about 40 files, listed in Task 1's notes).
      - The old names `@arnilo/prism-memory-wiki` and `@arnilo/prism-memory-rag` are gone with no alias. A manifest or host config naming one fails closed with the existing `package_missing` or `import_failed` code, which names the package (Task 1 finding F1; no new error code). `docs/migrate-to-0.13.md` gains both rows with the successor name, and the retired names are added to the retired-name lists in `src/__tests__/docs.test.ts`.
      - The `experimental` list in `scripts/independent-packages.json` is updated.
      - `resolveMemoryWorkerLimits` and `MemoryWorkerLimitOptions` (`observational/src/limits.ts`) move to `@arnilo/prism-memory-core`, so the wiki does not depend on the memory system (Task 1 finding F3). The core compat baseline is regenerated.
    - Functional: **The ontology leaves the fabric**, with no alias:
      - `packages/memory/fabric/src/ontology/**` (bind, cascade, codec, handler, pointer, port, render, retract, review, state) moves into the wiki.
      - The `concept` kind leaves `MemoryNoteKind` (`packages/memory/fabric/src/types.ts:33`), `MEMORY_NOTE_KINDS` and `DEFAULT_RECALL_KINDS`.
      - Concept handling leaves the fabric's recall ranking, the directory, the lifecycle (archive, capacity, merge, strength), the OKF codec (`packages/memory/core/src/fabric/okf.ts`, `layout.ts`), the team store, consolidation extract/write, cues and the passive pointer.
      - `MEMORY_FABRIC_CONCEPT_HANDLER_SERVICE` is deleted.
      - The fabric README sections `## Ontology tier` and concept-first recall go; the wiki README documents what replaced them.
    - Functional: **The wiki owns its knowledge.**
      - **Store.** Concepts, their claims, relations and open questions, and `wiki_ingest` *sources*, live in the wiki's own store: markdown by default under `wiki.root`, with the existing concept grammar, human-claim markers, `log.md` and the trust scan. `wiki_ingest` no longer writes LTM notes.
      - **Agent surface.** `wiki.search` and `wiki.read` (names confirmed in Task 1) return concepts first, then their cited claims and evidence ids, following the read-side contract plan 207 gave `memory.recall`.
      - **Passive pointer.** The wiki contributes its own passive concept pointer and path-scoped concept cue to `context.build`, cache-stable per epoch.
      - **Curator pass.** The pass and its co-read, accumulation and repair triggers stay. `wiki:consolidate` stays the host-schedulable entry point.
      - **Binding.** Subject binding happens at the wiki's write time and its curator pass. LTM writes no longer bind.
    - Functional: **The wiki reads memory through a read-only port.**
      - The fabric provides `memory.ltm`, replacing `memory.fabric`. Its read-only members are `scopes()`, `read(scope, ids)`, `scanMetadata`, and a page of `uses` and `coReads` events since a cursor, plus `deletions(since)`.
      - It has no write member. `applyConceptEdits`, `bind`, `settle`, `retract` and `indexSource` are deleted from LTM.
      - Claims may cite LTM note ids (`ltm:<scope>/<id>`) and wiki source ids.
      - Without memory installed, the wiki runs on its own sources, and `wiki:status` says so.
      - `missing_service` is no longer raised for an absent fabric.
    - Functional: **Deletion still cascades deterministically.**
      - When an LTM note is forgotten or revoked, every wiki claim citing it is retracted (or the concept marked for repair), as today, without a model call.
      - Deletions arrive two ways (Task 1 finding F2):
        - the `deletions(since)` feed, which is `listInvalidated` (forget, revoke, legal hold, correction; id, reason and `at` only) filtered by cursor, read on every context build after an LTM retraction epoch and on wiki open;
        - an open-time liveness check: every id a claim cites is read back through `read(scope, ids)` in bounded batches, and a missing id retracts the claim. This covers the hard deletes that leave no invalidation record (retention, capacity eviction, import replace).

        A wiki that was not loaded at delete time still catches up before it renders. No new LTM journal is added. The task first verifies how `listInvalidated`'s exact-scope requirement maps onto the fabric's scope levels.
      - A claim whose citation is unreadable is never rendered or returned.
      - Tests cover forget, revoke, scope revocation, a wiki loaded after the forget, and a wiki loaded after a retention or capacity delete.
    - Functional: **Callers move in the same task:**
      - presets that enabled the ontology;
      - `apps/prism-agent` (its ontology option);
      - `examples/three-tier-memory.ts`, renamed `examples/memory-and-wiki.ts`;
      - host-builder data and indexes;
      - `scripts/memory-bench/{ontology-arm,ontology-audit,ontology-screen,ontology-report,variants}.mjs` path keys;
      - the safety suite's ontology probes.

      Plan 208's finished evidence keeps its names.
    - Functional: **Retirement sweep** over `src/ packages/ apps/ scripts/ examples/ docs/ README.md PRODUCT.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`): no `kind: "concept"` in memory code, and no `memory.fabric`, `MEMORY_FABRIC_SERVICE`, `FabricOntologyPort` or `@arnilo/prism-memory-wiki`, except in the CHANGELOG and the migration notes.
    - Performance:
      - Memory recall loses the concept-first stage. Report `memory.recall` p95 before and after on the fabric recall bench.
      - The wiki adds one `deletions` page read per retraction epoch and one lineage reconcile on open, measured and stated in its README cost section.
    - Code Quality:
      - The compat baselines are regenerated with `bun scripts/release.mjs gate --update-baseline` for `arnilo__prism-memory-fabric.txt`, `arnilo__prism-memory-core.txt` and the wiki's file (renamed), with the diff attributed in the note.
      - Enforcement rows (references §3 probe 11) for the renamed package: workspaces, `package-truth.mjs`, `packaging.test.ts`, `independent-packages.json`, and the `docs/index.md` link.
    - Security:
      - The port is read-only, so the wiki cannot write memory.
      - Reads honour scope ACLs and consent.
      - The deletion feed carries ids only.
      - The trust scan and claim lint (`safety-proven`) run in the wiki unchanged.
      - The wiki's store file modes match the fabric's markdown store.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/ontology/port.ts:198-260`;
      - `packages/memory/fabric/src/index.ts:270-280`;
      - `packages/memory/wiki/src/extension.ts:120-260`;
      - `packages/memory/wiki/README.md`;
      - plan 207 (the ontology tier's contracts);
      - plan 208 Task 4 (ontology safety probes);
      - `packages/memory/core/src/lineage.ts`, `propagation.ts`.
    - Options Considered:
      - Keep concepts in the LTM store and only move the code. Rejected: the owner wants the ontology out of memory; concepts in the store of record would keep LTM recall, lifecycle and export concept-aware.
      - Have the wiki subscribe only to live events for deletions. Rejected: a wiki not loaded at forget time would render a stale claim; reconciliation against lineage closes that gap.
      - Fold the wiki into RAG. Rejected: the curator pass and claim grammar are a different capability, and the owner keeps RAG separate.
    - Chosen Approach:
      - A separate knowledge package with its own store and surface, a read-only LTM port, and deletion by feed plus lineage reconciliation.
    - API Notes and Examples:
      ```ts
      packages: [memorySystem({ ltm: { preset: "conversational" } }), wiki({ root: "./wiki", consolidate: { model: "provider/model" } })]
      await agent.commands.run("wiki:consolidate", {}, { session });
      ```
    - Files to Create/Edit:
      - `packages/memory/wiki/**` → `packages/knowledge/wiki/**` and `packages/memory/rag/**` → `packages/knowledge/rag/**` (packages, READMEs, CHANGELOGs, tests);
      - `packages/memory/{observational/src/limits.ts → core/src}` and the core root export;
      - `plans/backlog.md` (Task 1 hand-off): remove "Revisit sources counted as minNotes notes"; re-scope "Clean up failed or flagged source ingests" to the wiki's source store; re-point "Cache evidence for a concept written mid-session", "Decide whether the concept curator may cite exchanges", "Decide the ontology default and keep the tier honest", "Revisit closing the 208 screen on a partial run" and "Treat the O3 early read as development evidence only" to plans 222–223; name each title in this task's note;
      - `packages/memory/fabric/src/{types,create,index,exports,context,directory,excerpt,tools,okf-bundle,scope/recall,delivery/{cues,team},lifecycle/{index,archive,capacity,merge,strength,maintain},consolidation/{extract,write}}.ts` and tests;
      - `packages/memory/core/src/fabric/{okf,layout}.ts` and tests;
      - `apps/prism-agent/**`; `examples/**`; `packages/hosts/host-builder/data/**`;
      - `scripts/memory-bench/**` (ontology tools, safety probes);
      - `scripts/{independent-packages.json,package-truth.mjs}`; `src/__tests__/{packaging,docs}.test.ts`; root `package.json` workspaces (`packages/knowledge/*`); `bun.lock`; `templates/deep-research`;
      - `scripts/compat-baseline/*`;
      - `docs/index.md`, `docs/migrate-to-0.13.md`, `PRODUCT.md`, the READMEs, `CHANGELOG.md`.
    - References:
      - design §5.10; owner decision 2026-11-08.
  - Test Cases to Write:
    - `ltm_has_no_concept_kind_or_ontology_code`.
    - `wiki_store_holds_concepts_and_sources_and_never_writes_ltm`.
    - `ltm_port_is_read_only`: fails if any write member exists.
    - `forgetting_an_ltm_note_retracts_citing_wiki_claims_without_a_model_call`.
    - `wiki_loaded_after_forget_reconciles_from_lineage_before_rendering`.
    - `wiki_runs_without_memory_on_its_own_sources`.
    - `wiki_loaded_after_retention_delete_retracts_claims_on_open`.
    - `old_wiki_and_rag_names_absent_and_manifest_entry_fails_closed_naming_them`: the manifest loader fails with `package_missing` or `import_failed`, the migration rows exist, and no workspace names the old packages.
    - `worker_limits_resolve_from_memory_core_without_the_session_package`.
    - The ontology safety probes pass against the wiki.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package name, the wiki's tools and store, LTM recall loses concepts.
    - Docs pages to create/edit:
      - the wiki README (rewritten scope sentence, `## What it changes`, store, port, cost);
      - the fabric README (sections removed);
      - `docs/migrate-to-0.13.md`; `PRODUCT.md` (ontology paragraph); `CHANGELOG.md`.
    - `docs/index.md` update: yes — the wiki's link and scope sentence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-08):
    - **Directory confirmed** (Task 1 open item): RAG went to `packages/knowledge/rag`, beside the wiki, as proposed.
    - **What changed.**
      - *Renames.* `git mv` of `packages/memory/{wiki,rag}` to `packages/knowledge/{wiki,rag}`, named `@arnilo/prism-wiki` (factory `wiki()`, was `memoryWiki`) and `@arnilo/prism-rag`. The root workspaces gain `packages/knowledge/*`. About 170 callers were renamed, including `bun.lock`, `scripts/independent-packages.json` (`experimental`), `package-truth`, `biome.json`, templates, the host-builder data, examples and docs. New `src/__tests__/retired-knowledge-names.test.ts` (`old_wiki_and_rag_names_absent_and_manifest_entry_fails_closed_naming_them`): `importDefinition` fails with `import_failed` naming the package, the migration rows exist, and no workspace list or lockfile names an old package. `docs.test.ts` lists the retired names, and the count of still-retired 0.3 names drops from 49 to 47 (the two knowledge names reuse 0.3 legacy names; the phase-54 generator records a reused name with 0 symbols, the same rule `@arnilo/prism-code` gets).
      - *Shared library (F3).* The worker loop and its limits (`runMemoryWorkerLoop`, `resolveMemoryWorkerLimits`, `measureWorkerJson`, `joinWorkerText`, `truncateWorkerText`, the worker caps and types) moved from observational to `packages/memory/core/src/worker.ts`. `ObservationalMemoryError`/`ObservationalMemoryLimitError` became core's `MemoryWorkerError`/`MemoryWorkerLimitError` (same codes and messages). The trust scan (`scanScopedMemoryContent`, `normalizeScopedMemoryContent`, `gateScopedMemoryContent`) moved from `fabric/src/scoped/trust.ts` to `core/src/trust.ts`. Observational now depends on memory-core. The wiki depends on `memory-core` and `rag` only, with no memory package as a peer.
      - *Fabric (LTM).* `src/ontology/**` is deleted. The `concept` kind leaves `MemoryNoteKind`, `MEMORY_NOTE_KINDS` and `DEFAULT_RECALL_KINDS`, and so do the concept-only metadata fields. A stored concept reads as unreadable with the named reason `retired-concept`. Also removed: concept handling in recall (shadow key, kind prior), excerpt, tools (concept-first search, render, refusals), directory (the concepts line), context (the passive pointer), cues, team (concept sharing, the reviewer), lifecycle (archive/capacity/merge/strength/maintain/co-read exemptions), consolidation (the subject list and slug validation), write-time binding, the in-process retract events, `ontology.*` config, the `memory.fabric` and `memory.fabric.concept-deletion` services, and the README `## Ontology tier`. Core's OKF codec and layout drop the concept label, frontmatter and directory. New `src/ltm.ts`: `createMemoryLtmPort` and `MEMORY_LTM_SERVICE` (`memory.ltm`, provided when `semantic` is on), with members `scopes`, `scopeId`, `epoch`, `read` (32 ids through `Memory.get`, so scope ACLs, consent and invalidation apply), `scanMetadata`, `activity` and `deletions` (`Memory.listInvalidated` filtered by `at`). It has no write member. **F2 check:** `listInvalidated` needs the exact thread scope, and each fabric scope level is one `Memory` that already binds tenant, resource and thread, so the port calls it on that level's memory.
      - *Wiki.* The ontology code moved in: `ontology/{codec,bind,render,pointer,errors,types,review,ltm,port}.ts`, `store.ts`, `context.ts` and `tools/knowledge.ts`. The store is markdown under `wiki.root` (default `<workspace>/.prism/wiki`), with concepts as JSON-frontmatter files carrying the unchanged concept grammar, plus `bindings.json`, `.wiki-state.json` (owner, feed cursor, last written body), `sources/<id>/source.json` and `log.md`. Directories are 0700 and files 0600, the fabric store's modes. A `store: "memory"` option keeps everything in process. A person's edit is reviewed on load (codec, `human` markers, trust-scan quarantine as `candidate`, `log.md`). The agent surface is `wiki.search` (concepts first, claims with their cited ids, a drill-down line) and `wiki.read` (a concept, or up to 8 cited notes). Both are named after the `memory.*` convention, because `wiki_search` is a retired 0.12 name, and the exported constants are `WIKI_SEARCH_TOOL`/`WIKI_READ_TOOL` because `WIKI_SEARCH_TOOL_NAME` is retired too. There is a passive `context.build` pointer (hook id `wiki-pointer`, one per user turn, by name or by `appliesTo` × the touched paths of `read`/`edit`/`write`), and new config `root`, `store`, `search.maxClaimsRendered`, `bindThreshold` and `pointer`. `requires.services` is removed, and `wiki:status` reports `memory` and `sources`. Binding happens at ingest and at the start of `planScope`: a writer's topic key is adopted, otherwise the matcher binds, and only new evidence flags a concept. The curator pass, triggers, lint, commands and edit vocabulary are unchanged.
      - *Deletion.* `refresh()` runs on open (store reload, deletion feed, and liveness, reading back every cited LTM id 32 at a time) and after every LTM retraction epoch (feed only). Search, read, status, the pointer and the pass all call it first. The read side drops any claim whose citations are not all readable. Read-only scopes (`team`) do not cascade.
      - *Isolation (found in execution).* The store keyed concepts by level only, so two projects sharing a root would have shared project concepts. Each level of a root is now pinned to the `memory.ltm` `scopeId` it first read, and a different memory fails with `MemoryScopeError` (`a_wiki_root_never_serves_two_projects`). `scopeId` is an opaque hash of tenant and resource, never the ids.
      - *Callers.* The reference host's `ontology` option adds `wiki({ root: <workspace>/.prism/wiki })` and no longer needs `memory`. Its scenario uses `wiki.search` and reads the store. `examples/three-tier-memory.ts` became `examples/memory-and-wiki.ts` (`docs.test.ts` asserts `memory.forget: 4 claims -> 3`). The host-builder data was regenerated. In memory-bench, `ontology-arm.mjs` keeps a wiki root inside the cached history root and reads the store plus `memory.ltm`; `ontology-audit.mjs`, `work-outcome/run.mjs` (one wiki root per project), `replay.mjs`, `trust-scan-audit.mjs`, `variants.mjs` (`ontology.pointer=off` now patches the wiki context) and `mechanism-probes/{ontology,deterministic-ids}.mjs` (re-homed; `binding-extractor`, `concept-prior` and `concept-sharing` report `never-fires` with a finding) were updated, along with `feature-ledger-features.mjs` (the ontology rows now own `wiki:*` config) and `defaults.json` (`fabric.ontology` dropped). The 208 safety suite `safety/ontology.mjs` was rewritten onto the wiki, keeping its five probes and the verdict (12/12 pass). Plan 208's finished evidence keeps its names.
    - **Deviations from the task text** (owner may revisit):
      - Citations stay 12-hex ids, not `ltm:<scope>/<id>`. The scope is implicit (a citation must be readable in the concept's own scope), and wiki source ids are 12-hex too. This keeps the concept grammar, the curator prompts and lint unchanged.
      - `memory.ltm` has two extra read-only members: `epoch()` (it triggers the feed read) and `scopeId(level)` (the owner pin). `activity` pages by the store's scan cursor, not by time.
      - "Revisit sources counted as minNotes notes" is **kept**, re-pointed to plan 222, not removed: the wiki's own trigger still weighs a source as `minNotes` notes, because the move preserved behaviour.
      - The extractor's tool schema keeps an ignored free `subject` string so its cached bytes do not move (plan 217 redesigns the extractor).
    - **Performance.** `memory.recall` p95 over 1,000 notes, 200 calls, in-memory store, 3 runs each, with a clean HEAD worktree as the before (HEAD has the concept-first stage on, as `semantic` defaults on): before 5.13–5.93 ms, after 4.97–5.65 ms. No measurable change; there is no dedicated fabric recall bench, so the probe script is described here. Wiki (README cost section): the open reconcile took 16–22 ms for 200 concepts citing 400 notes and 147–176 ms for 2,000 citing 4,000; the feed read after an epoch took 1–2 ms and 8–9 ms; a quiet refresh about 0.1 ms.
    - **Behaviour change, measured and re-pinned.** The old fabric turned the ontology on whenever `semantic` was on, so both shipped presets' `memory.recall` enum named `concept` and its description said "concepts included". Rebuilding exactly that reproduces the old golden hash. The plan 210 golden `fixtures/removal-byte-identical.json` is re-pinned (`PRISM_UPDATE_REMOVAL_GOLDEN=1`): 12/12 tool and request hashes changed in each preset, and the context hashes are unchanged. `docs/_evidence/memory-bench/210/slimmed/record.json` `byteIdenticalTest` carries the new sha256 with a `repinned` entry. Task 8 is amended for this.
    - **Baselines** (`release.mjs gate --update-baseline`, exit 0 after the kernel docs budget below): fabric loses `CONCEPT_RELATIONS`, `Concept*`, `FabricOntology*`, `FabricSubjects`, `SubjectListing*`, `MEMORY_FABRIC_SERVICE`, `MEMORY_FABRIC_CONCEPT_HANDLER_SERVICE`, `createFabricOntology`, `createConceptDeletionHandler`, `parseConceptBody`, `renderConceptBody`, `conceptSources`, `MAX_CLAIM_CHARS`, `ConceptFormatError`, `ConceptRequiresOntologyError` and `MemoryFabricOntologyConfig`, and gains `createMemoryLtmPort`, `MEMORY_LTM_SERVICE`, `MAX_LTM_READ_IDS`, `MAX_LTM_PAGE` and the `Ltm*`/`MemoryLtmPort` types. Core gains the worker loop, limits and trust-scan names (26, listed in `root-exports.test.ts`). Observational loses the worker loop and limits exports. `arnilo__prism-memory-wiki.txt` became `arnilo__prism-wiki.txt` (loses `memoryWiki`; gains `wiki`, `WIKI_SEARCH_TOOL`, `WIKI_READ_TOOL`, `MEMORY_LTM_SERVICE`, `LtmPort`, the ontology codec, port, store and types). `arnilo__prism-memory-rag.txt` became `arnilo__prism-rag.txt` (no surface change). The two 0.3 legacy files with those names (`arnilo__prism-rag.txt`, `arnilo__prism-wiki.txt`) were replaced: the names are live again. `budgets.json` kernel `packedBytes` 1241079 → 1245802 and `unpackedBytes` 4028074 → 4042374, with the reason recorded (shipped docs only).
    - **Retirement sweep** over `src/ packages/ apps/ scripts/ examples/ docs/ README.md PRODUCT.md`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, CHANGELOGs and the migration notes: no `memory.fabric`, `MEMORY_FABRIC_SERVICE`, `FabricOntologyPort`, `@arnilo/prism-memory-wiki` or `@arnilo/prism-memory-rag` remains except in the tests that assert their absence. In memory code the only `concept` literal is the `retired-concept` migration line in `fabric/src/types.ts`.
    - **Tests run.** Wiki 85/85, fabric 575/575, core 74/74, observational 102/102, reference-host memory 9/9, memory-bench 549 (the only failure is the pre-existing feature ledger below), `safety.test.mjs` 12/12, ontology mechanism probes (no errors), `bun run typecheck` clean, `biome lint` clean on the touched trees, `release.mjs gate` exit 0, `host-builder-index --check` fresh, `docs.test.ts` and `packaging.test.ts` 355/355, `e2e-coverage.test.mjs` 8/8, and `examples/memory-and-wiki.ts` runs.
    - **Pre-existing failures, not caused here** (`bun run test` on this tree): `feature-ledger` (17 rows for features plan 210 Task 7 removed: `retrieval.*`, linker/evolution, supersession-hint, state-wrapper, widen-narrow, decider, `scoped.policy`; `defaults.json` lost their defaults at 20:20 and the ledger was not updated). Also: core provider literals, the live-test gating and `globalThis.fetch` guards, phase37 (11 provider adapters), the `node:test` imports, the codemod check, the adapter conformance leg, `host_libraries_import_only_allowlisted_kernel_names` (mcp-server `Skill`, host-builder computed import), peer policy (evals → observability), the advisor evidence row, phase54 host-builder classification, Bun.hash and npm ledgers, the timing-ceiling note, the dead-export table (10 unclassified), the non-null assertion budget table (it still lists the 0.12 layout), the packed-journey fold assertion, `biome lint .` diagnostics in untouched files, and the kernel/channel export-count ceilings. `host_builder_eval_criteria_preregistered`: the plan 215 Task 20 lock (11:28) was already stale after plan 210 regenerated the indexes, and this task's skill-reference edits (`choosing.md`, `upgrading.md`) also move its skill hash. The lock belongs to a closed task and was not re-registered. Two test counts that were stale before this task were corrected: `e2e-coverage.test.mjs` 85 → 87 (plan 215's `./net` and `./artifacts` surfaces) and the annotated suites that plan 210 deleted were pruned.
    - **Backlog hand-off (titles).** Re-scoped: "Clean up failed or flagged source ingests" (the wiki's source store, a `wiki:lint` item). Re-pointed to plans 222–223: "Decide the ontology default and keep the tier honest", "Cache evidence for a concept written mid-session", "Decide whether the concept curator may cite exchanges", "Revisit closing the 208 screen on a partial run", "Treat the O3 early read as development evidence only". Kept and re-pointed (deviation above): "Revisit sources counted as minNotes notes".
    - **Findings for later tasks.**
      - Task 4: the worker loop and limits already live in `memory-core`; the session tiers import them from there, and `ObservationalMemoryError` no longer exists.
      - Task 5: the `memory.ltm` port (`fabric/src/ltm.ts`, with `scopeId` and `epoch`) moves with the fabric unchanged. The `experimental` list now reads `memory-core`, `memory-observational`, `memory-fabric`, `wiki`, `rag`. The core markdown store still has the `reviewEdit` seam, which nothing in memory uses now (candidate for removal in Task 5 or 7). `exchangeKeywords` is used only by the LTM port's derived keywords.
      - Task 7: `memory.ltm` already hides `working` and `episode`.
      - Task 8: see its amendment (the Task 3 tool-schema re-pin is an attributed difference).
      - Plan 222: user-scope concepts live under the wiki root that wrote them, so separate project roots do not share user concepts. There is no command to share a concept into the team scope (concept sharing left with the fabric). A wiki root inside memory's `tools.root` is mirrored into memory as file notes (documented; the bench keeps roots apart).

- [x] Task 4: Create `@arnilo/prism-memory-system` and move the session tiers into it
  - Acceptance Criteria:
    - Amended (2026-11-08, Task 3): the worker loop, its limits and the trust scan already live in `@arnilo/prism-memory-core` (`worker.ts`, `trust.ts`); the session tiers import them from there, and `ObservationalMemoryError`/`ObservationalMemoryLimitError` no longer exist (core's `MemoryWorkerError`/`MemoryWorkerLimitError`).
    - Functional: **First step: pin `OM-before`** (Task 2, amended 2026-11-08). Before any file moves, commit the tree and record in `docs/_evidence/memory-bench/memory-model/baselines.json` `omBefore.revision` (`git rev-parse HEAD`) and `omBefore.productHash` (`sourceFingerprint(["packages/memory/observational/src"])` of `baseline.mjs`). `memory-model-criteria.test.mjs` (`baselines_om_before_and_p_resolve_to_recorded_revisions`) then requires a resolvable commit. Plan 217 Task 6 runs the arm with `PRISM_MEMORY_BENCH_SOURCE=<revision>`.
    - Functional: **Package.**
      - `packages/memory/observational/**` moves (`git mv`) to `packages/memory/system/src/session/**`, with the package root `packages/memory/system` and the name from Task 1.
      - `@arnilo/prism-memory-observational` is retired with no alias. A manifest or host config naming it fails closed with the existing `package_missing` or `import_failed` code (Task 1 finding F1), and `docs/migrate-to-0.13.md` gains the row. The name is added to the retired-name lists in `src/__tests__/docs.test.ts`.
      - The old name was never published (Task 1 finding F6), so no `npm deprecate` is needed; the release notes name the retired package for the first publish.
    - Functional: **Names move to the component names** (design §6), with no alias:

      | Before | After |
      |---|---|
      | `om` | `memory:session` |
      | `om:status` | `memory:session:status` |
      | `om:view` | `memory:session:view` |
      | `om:model` | `memory:session:model` |
      | `om.status` (event) | `memory.session.status` |
      | `om.*` state and ledger types | `memory.session.*` |
      | `observer.*` config | `stm.*` (`messageTokens` → `triggerTokens`) |
      | `reflector.*` config | `wm.*` |
      | `dropper.*` config | `rehearsal.*` |
      | `# Observational Memory` | `# Session Memory` |

      - Worker *behaviour* is unchanged. The config table documents that `wm` and `rehearsal` still run today's reflector and dropper until plans 218–219.
      - Ledgers written under the old type names are refused with a named error and an export hint. No reader for them is kept: the experimental line allows the break.
    - Functional: **Plan 210 Task 7.2's three fixes** carry in unchanged:
      1. the package forwards `instruction`, `thinkingLevel` and the session's secret set to every worker;
      2. an oversized unread tail is observed in byte-bounded batches, with coverage advanced per batch, a single oversized entry truncated with a marker, and a failed batch leaving coverage at the last recorded batch;
      3. the worker tools return `ok: false` with a named reason when nothing was stored.

      Their five named tests come too.
    - Functional: **Callers move in the same task:**
      - the fabric's imports from `@arnilo/prism-memory-observational` (types, `isMemoryId`, worker limits, recall paging; `packages/memory/fabric/src/types.ts:11-17`) are repointed to the new package's internal paths, or temporarily to its `./session` subpath export, until Task 5 makes them in-package (executed: repointed to the new package's **root**, which re-exports the same shared set; no `./session` subpath was created);
      - `apps/prism-agent`, examples, the host-builder data, `scripts/memory-bench` (`om` and `om+fabric` configs → `session` and `session+ltm`; Task 5 of plan 210's finished evidence keeps its names), and `scripts/budgets.json` keys.
    - Functional: **Sweep** for `prism-memory-observational`, `om:`, `om.status` and `Observational Memory` over the usual roots, excluding the CHANGELOG and migration notes.
    - Performance: Rename and move only. The offline replay of an `om` fixture produces byte-identical provider requests, except for the renamed heading and ids (attributed).
    - Code Quality:
      - The new package follows the native-package layout (`references/prism.md` §4), with its own conformance suite, compat baseline file (`scripts/compat-baseline/arnilo__prism-memory-system.txt`, from the old file with the diff attributed), and enforcement rows (workspaces, `package-truth.mjs`, `packaging.test.ts`, `independent-packages.json` `experimental`, `docs/index.md`).
      - `bun scripts/release.mjs gate --update-baseline` is run in this task.
    - Security: The capability declarations are unchanged (`models`, `session-state`, `background`, `slot:compaction`). Secrets reach workers only from the kernel's secret set, never from config text.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/observational/src/{index,flush,config,settings,limits,serialize}.ts`;
      - plan 210 Task 7.2 (carried);
      - `scripts/release.mjs`;
      - `scripts/compat-baseline/`.
    - Options Considered:
      - Rename to "episodic" first (plan 210 Task 7.1). Rejected: episodic is now an LTM kind.
      - Move the fabric first. Rejected: the session tiers are smaller; moving them first sets up the package and its enforcement rows on the easier move.
    - Chosen Approach:
      - One mechanical move under final names, so plans 217–219 are written against them.
    - API Notes and Examples:
      ```ts
      import memorySystem from "@arnilo/prism-memory-system";
      packages: [memorySystem({ stm: { triggerTokens: 10_000 } })];
      await agent.commands.run("memory:session", {}, { session });
      ```
    - Files to Create/Edit:
      - `packages/memory/system/**` (new; moved sources and tests);
      - `plans/backlog.md` (Task 1 hand-off): re-point "Give deletion propagation an observational-memory leg" and "Observational-memory deletion-propagation leg deleted" to plan 217, naming both titles in this task's note;
      - `packages/memory/fabric/src/**` imports;
      - `apps/prism-agent/**`, `examples/observational-memory.ts` → `examples/session-memory.ts`;
      - `packages/hosts/host-builder/data/**`;
      - `scripts/memory-bench/**`, `scripts/budgets.json`;
      - root workspace and release lists;
      - `scripts/compat-baseline/*`;
      - READMEs, `docs/index.md`, `docs/migrate-to-0.13.md`, `PRODUCT.md`, CHANGELOGs.
    - References:
      - plan 210 Tasks 7.1–7.2 (dropped; carried); design §6, §10.
  - Test Cases to Write:
    - `old_observational_name_absent_and_manifest_entry_fails_closed_naming_it`.
    - `session_commands_and_status_event_registered_under_new_names`.
    - `old_ledger_types_refused_with_export_hint`.
    - Carried from plan 210 Task 7.2:
      - `package_workers_receive_configured_instruction_thinking_and_secrets`;
      - `oversized_unread_tail_is_observed_in_batches_and_coverage_reaches_the_end`;
      - `single_entry_larger_than_budget_is_truncated_with_marker_and_cited`;
      - `failed_batch_leaves_coverage_at_last_recorded_batch`;
      - `worker_tools_return_ok_false_with_reason_when_nothing_is_stored`.
    - `observational_names_absent_repo_wide`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package, commands, event, config names.
    - Docs pages to create/edit:
      - `packages/memory/system/README.md` (new, package page structure; session section);
      - `docs/migrate-to-0.13.md`; `PRODUCT.md`; CHANGELOGs.
    - `docs/index.md` update: yes — the new package link replaces the observational one.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-08):
    - **`OM-before` pinned first.** The tree (Tasks 1–3) was committed as `37ee1a24f14c2e0e4a29a39fa1c71b3a83d52510` before any file moved; `docs/_evidence/memory-bench/memory-model/baselines.json` records it as `omBefore.revision`, with `omBefore.productHash` `e6a323c9ea6e1301409c56eca4cf68e5479117437313df68c0ba54c5bdf3a4dc` (`sourceFingerprint(["packages/memory/observational/src"])`) and `pinnedAt`. The pin was committed separately. `baselines_om_before_and_p_resolve_to_recorded_revisions` passes. Before that commit, a stray `packages/knowledge/wiki/.prism/` (a wiki test writing its default root) was deleted rather than committed (finding below).
    - **What changed.**
      - *Package.* `git mv packages/memory/observational packages/memory/system`; every source moved under `src/session/` (tests under `src/session/__tests__/`). The package root is `src/index.ts` (the definition, `@arnilo/prism-memory-system`), which re-exports `src/session/exports.ts`. Exports stay `"."` only: the fabric imports the shared helpers from the root, so **no `./session` subpath** exists (Task 5 amended).
      - *Names (design §6), no alias.* Config `observer`/`reflector`/`dropper` → `stm`/`wm`/`rehearsal` (`messageTokens` → `triggerTokens`); config validation rejects the old keys and `resolveMemorySystemConfig` throws naming the successor. `memoryObservationalConfigSchema`/`resolveMemoryObservationalConfig`/`MemoryObservational*` → `memorySystemConfigSchema`/`resolveMemorySystemConfig`/`MemorySystem*` (`MemoryObservationalDropperPolicy` → `MemorySystemRehearsalPolicy`). Commands `om`, `om:model`, `om:status`, `om:view` → `memory:session`, `memory:session:model` (args and result `stm`/`wm`), `memory:session:status` (`thresholds.triggerTokens`), `memory:session:view`. Event `om.status` → `memory.session.status`; background task `om.observe` → `memory.session.observe`; state `om` → `memory.session` (fields `stmModel`/`wmModel`); log `ledger` → `memory.session.ledger`; ledger and marker types `om.*` → `memory.session.*` (new `CONTEXT_PINNED`, `SESSION_COMPACTED` constants). Heading `# Observational Memory` → `# Session Memory`; context block title and compaction strategy `observational-memory` → `session-memory`; block metadata `source: "om"` → `"memory.session"` (the fabric's `context.ts` reads the new value). The workers' provider `sessionId`/`cacheKey` `om:<id>` → `memory.session:<id>`. Worker prompts and tool descriptions are unchanged.
      - *Old ledgers.* `foldObservationalMemoryLedger` (and `foldedMemoryFromEntry`) throw the new exported `MemorySessionLedgerError` (`code: "retired_ledger_type"`, the record type, and the hint "export the session with that package's om:view … or start a new session") on any `om.*` record or folded memory. No reader is kept. Because state is namespaced by package, a session written by the old package is simply not read by the new one; the error fires on SDK callers and branch entries that still carry old types.
      - *Plan 210 Task 7.2's three fixes, implemented here* (they had not been implemented under plan 210):
        1. Each worker section takes `instruction` (`contract`, appended to the default prompt, max 8 KiB) and `thinkingLevel` (`tuning`, the kernel's `THINKING_LEVELS`); the flush forwards both plus `secrets` to every observer, reflector and dropper call (`flush.ts` `workerPrompt`).
        2. The unread tail goes in ordered batches (`serialize.ts` `serializeSourceBatches`, linear; half of `worker.maxMessageBytes` per batch, `flush.ts` `sourceBudget`); coverage advances after each recorded batch (the last batch keeps `lastScannedId`); a failed batch throws after the earlier batches were appended; a single oversized entry is redacted, cut and ends with `[truncated: entry <id> is <n> bytes; the rest was not sent]`, and stays citable. A tail that fits is one batch whose text equals the old `serializeSourceEntries` output (tested).
        3. `record_observation`, `record_task_state`, `record_reflection` and `drop_observations` answer `{ ok: false, reason }` (`empty_content`, `no_valid_ids`, `unknown_id`, `invalid_observation`, `invalid_task_state`, `invalid_reflection`) when nothing was stored; a stored result is unchanged.
      - *Callers.* The fabric (imports, tests, `context.ts` block source, `stability.test.ts` table path), `apps/prism-agent` (`memorySystem(...)`, `sessionCompactAtFor`, READMEs), `examples/observational-memory.ts` → `examples/session-memory.ts` and the three other examples, the host-builder data (regenerated with `host-builder-index.mjs`), `scripts/fixtures/e2e-070-host-completeness-journey.mjs`, `scripts/{independent-packages.json,package-truth.mjs,package-truth.json,coverage-thresholds.json,e2e-coverage.json,live-matrix.json}`, `biome.json`, `bun.lock`, `docs/_evidence/phase54-package-map.md` (regenerated by `phase54-package-map.mjs`), generated README/docs inventories (`package-truth.mjs --emit-docs`), and memory-bench (below).
      - *Memory-bench.* `session` is the arm's current name (`ablations.mjs` `isSessionConfig`, `SESSION_ARM_KEYS`; new ablation paths `session.stm.triggerTokens`, `session.wm.observationTokens`, `session.rehearsal.{targetTokens,policy}`). **Deviation:** the `om` and `om+fabric` arm ids are **kept** and resolve to the same arm, with their `om.*` ablation paths translated onto the renamed fields, because the plan says plan 210's finished evidence keeps its names and the frozen `memory-model-criteria.json` (`omBefore.config: "om"`), `cleanup-criteria.json` and `cleanup-campaign.mjs` jobs name them. `session+ltm` is not introduced: the fabric arm is still `fabric` until Task 5 renames it (Task 5 amended). Feature-ledger ids (`om.observer` …) are plan 210 audit ids and stay. `variants.mjs` historical patches accept either the pre-move or the current anchor (`replaceEither`) so a pinned revision still patches. `injection-log.mjs` maps the `session-memory` block to source `om`. `defaults.json` and the feature-ledger rows use the new field names; the ledger's command scan reads `memory:session*`.
      - *Docs.* New package README (memory-system scope sentence, component table, `## Session memory`, the batching/settings/tool-result paragraphs, renamed config, commands, state and stability tables); `docs/migrate-to-0.13.md` section "Observational memory → `@arnilo/prism-memory-system`" (15 rows); `docs/index.md`, `PRODUCT.md`, `README.md`, `roadmap.md` (package table row), `docs/events.md`, `src/contracts-protocol.ts` comment, host-builder skill `choosing.md`, `.agents/skills/prism-execution/references/memory.md`, examples README; CHANGELOGs (root, system, fabric). Broken links to the old directory in `docs/migrate-to-0.{7,9}.md` were repointed (link targets only).
    - **Findings.**
      - **No package seam for the agent's secret set (F8 was optimistic).** `SessionContext` has no secret set and `prism.models.client` does not redact requests. Branch entries reach the package already redacted at append; the only set the kernel hands a package is `CompactionContext.secrets`. The package now keeps that set per session (bounded to 256 sessions) and forwards it to every later worker call, but a background pass before the session's first compaction redacts only what the kernel redacted at append. No kernel seam was added (the plan adds none); the backlog entry "Carry the out-of-run model-call seams" is updated with this.
      - **`packages/knowledge/wiki/src/__tests__/consolidate.test.ts` leaks its default wiki root** (`<cwd>/.prism/wiki`) into the package directory on every run (Task 3 leftover). Not fixed here; for Task 5 or plan 222.
      - The old `examples/observational-memory.ts` description and the fabric README's measured-evidence paragraphs keep the arm names `om`/`om+fabric` where they cite plan 202 evidence.
    - **Behaviour preservation (offline replay).** One scripted session (three turns with an observer pass each, `session.compact()`, one more turn; 12 provider requests: main and worker) run on `OM-before` (a temporary worktree of `37ee1a24`) and on the moved package. After normalizing per-run entry ids and timestamps, the requests are **identical except two attributed renames**: the compaction summary heading `# Observational Memory` → `# Session Memory` (1 request) and the worker `sessionId`/`cacheKey` `om:s` → `memory.session:s` (8 requests). Tool schemas, prompts and every other byte match. The kernel source is identical between the two revisions. The replay script is kept at the scratchpad, not committed; Task 8 records the result in `preservation.json`. The fabric's plan 210 golden (`removal-byte-identical.test.ts`) passes unchanged.
    - **Baseline diff** (`release.mjs gate --update-baseline`, then `gate` exit 0): `arnilo__prism-memory-observational.txt` → `arnilo__prism-memory-system.txt` (`git mv`). Removed: `MemoryObservationalCompactAt`, `MemoryObservationalConfig`, `MemoryObservationalDropperPolicy`, `MemoryObservationalWorkerConfig`, `ResolvedMemoryObservationalConfig`, `memoryObservationalConfigSchema`, `resolveMemoryObservationalConfig` (renames). Added: `MemorySessionLedgerError` (new), `MemorySystemCompactAt`, `MemorySystemConfig`, `MemorySystemRehearsalPolicy`, `MemorySystemWorkerConfig` (gains `instruction`, `thinkingLevel`), `ResolvedMemorySystemConfig`, `ResolvedWorkerSettings` (new), `memorySystemConfigSchema`, `resolveMemorySystemConfig`. Changed values: `OBSERVATIONS_RECORDED`, `REFLECTIONS_RECORDED`, `TASK_STATE_RECORDED` (`memory.session.*`), and `default`'s config type. `budgets.json` kernel `packedBytes` 1245802 → 1248830 and `unpackedBytes` 4042374 → 4051478, with the reason recorded (shipped docs only: the migration section, CHANGELOG entry and renamed index lines).
    - **Sweep** for `@arnilo/prism-memory-observational`, `run("om"`, `"om:model"`, `"om:status"`, `"om:view"`, `"om.status"`, `om.observe"` and `# Observational Memory` over `src packages apps scripts examples templates docs README.md PRODUCT.md`: clean except the allowlisted migration notes, CHANGELOGs, plans, history, evidence, frozen criteria JSON, retired 0.12 compat baselines, the retired-name tests, the package's own migration error (`session/types.ts`) and README migration lines — enforced by `observational_names_absent_repo_wide`.
    - **Tests run.** memory-system 112/112 (new `memory-system.test.ts`: `session_commands_and_status_event_registered_under_new_names`, `retired_config_keys_fail_closed_naming_the_successor`, `old_ledger_types_refused_with_export_hint`, `package_workers_receive_configured_instruction_thinking_and_secrets`, `instruction_cannot_widen_the_worker_tool_set`, `oversized_unread_tail_is_observed_in_batches_and_coverage_reaches_the_end`, `a_tail_that_fits_is_one_batch_with_the_unbatched_text`, `single_entry_larger_than_budget_is_truncated_with_marker_and_cited`, `failed_batch_leaves_coverage_at_last_recorded_batch`, `worker_tools_return_ok_false_with_reason_when_nothing_is_stored`), new `src/__tests__/retired-observational-names.test.ts` 2/2 (`old_observational_name_absent_and_manifest_entry_fails_closed_naming_it`, `observational_names_absent_repo_wide`), fabric 546/546, wiki 86/86, core 74/74, reference host 63/63, host-builder 78/78, memory-bench 545 (+1 pre-existing feature-ledger failure, back to its 17 pre-existing problems), `docs`/`packaging`/`public-export-contract`/`experimental-boundary`/retired-name tests 402/402, `install-smoke` 15/15, `memory-model-criteria.test.mjs` 9/9, the four examples (`session-memory`, `memory-and-wiki`, `autonomous-coding-loop`, `revocation-propagation`) run, `bun run typecheck` clean, `biome lint` clean on the touched trees, `host-builder-index --check` fresh, `release.mjs gate` exit 0.
    - **Pre-existing failures, not caused here** (each also fails at `37ee1a24` or was listed in Task 3): `release.test.ts` "0.3.0 release graph is independent, publishable, and documented" (fails on the pre-change tree too), the feature ledger's 17 problems, `benchmark-multi-agent` (advisor evidence row), `phase54-package-map.test.mjs` (host-builder classification), and the packed full-surface journey's fold assertion.
    - **Backlog hand-off (titles).** Re-pointed to plan 217: "Give deletion propagation an observational-memory leg" and "Observational-memory deletion-propagation leg deleted". Updated with the secret-set finding: "Carry the out-of-run model-call seams" (the `thinkingLevel` channel now exists for package workers; request redaction outside a compaction context still needs a kernel seam).
    - **Findings for later tasks.**
      - Task 5: there is no `./session` subpath to remove; the fabric imports `@arnilo/prism-memory-system`'s root (`dependencies` in `packages/memory/fabric/package.json`), which becomes in-package. The `experimental` list now reads `memory-core`, `memory-system`, `memory-fabric`, `wiki`, `rag`. The bench arm rename `om+fabric` → `session+ltm` and `fabric` → `ltm` belongs with the fabric move, keeping `om`/`fabric` ids for finished evidence. Fix the wiki `consolidate.test.ts` root leak if convenient.
      - Task 6: config is already per component (`stm`, `wm`, `rehearsal`, plus `context`, `worker`, `recall`, `enabled`); the `ltm` and `sleep` components and the on/off switches are what remains.
      - Task 8: the attributed differences for Task 4 are the heading and the worker session id above; `prefix-probe` fingerprints that named `packages/memory/observational/src` must read `packages/memory/system/src` (the frozen `memory-model-criteria.json` keeps the old path on purpose, as the OM-before product path).

- [x] Task 5: Move the fabric into the package as LTM
  - Acceptance Criteria:
    - Amended (2026-11-09, executed): the memory-bench arm rename is done as entry-point aliases (`ARM_ALIASES`, `canonicalArm`), not a rename of the internal and recorded ids; `ltm` is off by default through `default: null` on its schema node (the kernel would otherwise materialise it); the fabric's `MemoryFabric*` type names, `memoryFabricConfigSchema`/`resolveMemoryFabricConfig`, status-note prefix, hook id and diagnostics service name are kept (Notes).
    - Amended (2026-11-08, Task 4): no `./session` subpath was created; the fabric imports `@arnilo/prism-memory-system`'s root, so "remove the stopgap" means dropping that dependency and importing in-package. The `experimental` list is now `memory-core`, `memory-system`, `memory-fabric`, `wiki`, `rag`. Memory-bench: rename the `om+fabric` arm to `session+ltm` and `fabric*` arms to `ltm*` here (Task 4 kept `om`/`om+fabric` as finished-evidence ids and added `session`); keep the old ids resolving for plan 202/210 evidence the way Task 4 did. `packages/knowledge/wiki/src/__tests__/consolidate.test.ts` leaks `<cwd>/.prism/wiki` into the package directory (Task 4 finding).
    - Amended (2026-11-08, Task 3): `memory.ltm` exists already (`packages/memory/fabric/src/ltm.ts`, `createMemoryLtmPort`; members `scopes`, `scopeId`, `epoch`, `read`, `scanMetadata`, `activity`, `deletions`). It moves unchanged: the wiki pins its store to `scopeId`, so that hash must not change. The `experimental` list today is `memory-core`, `memory-observational`, `memory-fabric`, `wiki`, `rag`. Consider removing core's markdown `reviewEdit` seam, which nothing in memory uses since Task 3.
    - Functional: **Move.**
      - `packages/memory/fabric/src/**` moves to `packages/memory/system/src/ltm/**`.
      - `memoryFabric(config)` becomes the `ltm` component: `memorySystem({ ltm: config })` with the same fields.
      - The `memory.*` tools, `memory` commands, presets, stores, delivery tiers, lifecycle, scopes, team store, exchange archive, lessons and standing rules keep their names and behaviour.
      - `createMemoryFabric` becomes `createLongTermMemory` (direct SDK callers), with no alias.
    - Functional: **Retirement.**
      - `@arnilo/prism-memory-fabric` is retired with no alias: a manifest or host config naming it fails closed with the existing `package_missing` or `import_failed` code (Task 1 finding F1), the migration row exists, and the name joins the retired-name lists in `src/__tests__/docs.test.ts`.
      - The `memory.ltm` service (Task 3) is provided by the new package.
      - The Task 4 stopgap is removed: the fabric's dependency on `@arnilo/prism-memory-system`'s root (there is no `./session` subpath, Task 4 note) becomes in-package imports between `src/session` and `src/ltm`.
    - Functional: **Callers move:**
      - `apps/prism-agent` (its `memory` opt-in, `createCodingAgent` memory config);
      - examples (`long-term-memory.ts` and others);
      - the host-builder data;
      - `scripts/memory-bench` (`fabric-x-tools`, `P`, presets, `variants.mjs` path keys, `cleanup-campaign.mjs` arms for any later rerun);
      - the safety suite;
      - `scripts/budgets.json`;
      - the wiki (the `memory.ltm` consumer).

      Plan 210's finished evidence keeps its names.
    - Functional: **Sweep** for `prism-memory-fabric`, `memoryFabric(`, `createMemoryFabric` and `memory.fabric`, excluding the CHANGELOG and migration notes.
    - Performance: Behaviour preserved. On the offline replay fixtures, the `conversational` and `coding` presets' provider requests and tool schemas are byte-identical to plan 210's slimmed product (plan 210 Task 7's record), and `prefix-stability.test.ts` passes.
    - Code Quality: The fabric's compat baseline folds into `arnilo__prism-memory-system.txt`, regenerated, with the diff attributed (moves, the rename of `createMemoryFabric`). The fabric's `stability.test.ts` config table moves under `ltm.*`.
    - Security: Every `safety-proven` row stays green: trust scan, redaction, deletion cascade, provenance, legal holds, consent, file jail, resource limits, scope isolation, OKF forward compatibility. `store.postgres.connection` stays ref-only.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/index.ts` (setup, tools, commands);
      - `config.ts` (presets);
      - `stability.test.ts`;
      - `packages/memory/fabric/README.md` (2,122 lines; it becomes the LTM section of the package README, minus the ontology).
    - Options Considered:
      - Keep the fabric as a separate package that the system package depends on. Rejected: the owner wants one system. The cross-tier invariants (chunk reference counts across STM, WM and LTM; provenance chains; one recall surface) need one package.
    - Chosen Approach:
      - One mechanical move under final names, measured byte-identical.
    - API Notes and Examples:
      ```ts
      memorySystem({ ltm: { preset: "conversational", tools: { root: "./memory" } } }); // was memoryFabric({ preset: "conversational", … })
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/**` (moved) and tests;
      - `packages/memory/system/README.md` (LTM section);
      - the wiki's port import;
      - `apps/prism-agent/**`; `examples/**`; `packages/hosts/host-builder/data/**`;
      - `scripts/memory-bench/**`, `scripts/budgets.json`;
      - root workspace and release lists;
      - `scripts/compat-baseline/*`;
      - `docs/index.md`, `docs/migrate-to-0.13.md`, `PRODUCT.md`, CHANGELOGs.
    - References:
      - design §6; plan 188.11 (the stable-surface contract the README carries).
  - Test Cases to Write:
    - `old_fabric_name_absent_and_manifest_entry_fails_closed_naming_it`.
    - `ltm_presets_provider_requests_byte_identical_to_210_slimmed_product`.
    - `ltm_config_stability_table_matches_schema`.
    - `fabric_names_absent_repo_wide`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package and config path.
    - Docs pages to create/edit:
      - `packages/memory/system/README.md`; `docs/migrate-to-0.13.md`; `PRODUCT.md` (memory subsection); CHANGELOGs.
    - `docs/index.md` update: yes — remove the fabric link; the system package's scope sentence covers LTM.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-09):
    - **What changed.**
      - *Package.* `git mv packages/memory/fabric/src packages/memory/system/src/ltm`; the rest of `packages/memory/fabric` (manifest, tsconfig, bunfig, LICENSE) is deleted. The system manifest gains the fabric's optional `pg` peer, `@types/pg`/`pg`/`@arnilo/prism-rag` dev dependencies, the `test:postgres` script (paths under `src/ltm`) and `!src/**/fixtures`; its tsconfig takes the fabric's `bun-types/sqlite.d.ts`.
      - *One definition.* `ltm/index.ts` no longer calls `definePackage`: its setup body is `setupLongTermMemory(prism, ltmConfig)`, which the root definition calls **before** the session tiers' setup (the reference host listed the fabric first; the LTM `context.build` hook runs at its own priority `-1_100`, so block order does not depend on it). The library surface moved to `ltm/public.ts`, re-exported by the root. New `src/config.ts` composes the config: `MemorySystemConfig extends MemorySessionConfig { ltm?: MemoryFabricConfig | null }` (the session interface and schema are renamed `MemorySessionConfig`/`memorySessionConfigSchema` internally; `MemorySessionConfig` is exported as a type). Capabilities are the static union (`models`, `session-state`, `background`, `slot:compaction`, `credentials`, `host-ui`) until Task 6 computes them.
      - *`ltm` schema node.* **Finding:** the kernel materialises a nested object whenever a field below it has a default (`src/packages/schema.ts` `run`), so a plain `ltm` object node turned long-term memory on for every host. The node keeps the fabric schema's own `properties` (so a retired field still fails with its named `unknown key` error, at `/ltm/<field>`) and adds `anyOf: [{ const: null }, { type: "object", additionalProperties: true }]` with `default: null`; setup runs only for a non-null `ltm`. A first try with `anyOf: [fabricSchema]` lost the named errors (the kernel reports only "does not match any allowed shape") and was dropped.
      - *Names.* `memoryFabric` and `packageName` are removed; `createMemoryFabric` → `createLongTermMemory`; the internal `createMemoryFabricTools` → `createLongTermMemoryTools` (it matched the sweep pattern). Kept, deliberately: `MemoryFabricConfig`, `memoryFabricConfigSchema`, `resolveMemoryFabricConfig`, `CreateMemoryFabricOptions`, `MemoryFabric` and the other `MemoryFabric*` types, the status-note prefix `memory-fabric:`, the hook id `memory-fabric:context.build`, the optional `memory-fabric.diagnostics` service and the `fabric.*` session-state keys (none is in the sweep; renaming them is a Further Action).
      - *Stopgap removed.* The fabric's dependency on the system root is gone: `ltm` imports the session helpers from their modules (`session/{ids,ledger,types,limits,serialize,recall,coverage-helpers}.js`), and the root no longer exports the shared set that existed only for the separate fabric (`HARD_MAX_RECALL_PAGE_LIMIT`, `estimateMessageTokens`, `estimateTextTokens`, `foldedMemoryFromEntry`, `isEligibleObservationSourceEntry`, `isMemoryId`, `isMemoryObservation`, `isMemoryReflection`, `isObservationsRecordedData`, `isReflectionsRecordedData`, `isTaskStateRecordedData`, `recallObservationalMemoryBranchPage`, `recordData`, `resolveRecallPageLimit`, `serializeSessionEntry`; no other caller imported them).
      - *Callers.* `apps/prism-agent` (`coding.ts`/`research.ts` list one `memorySystem({ context, ltm })`; tests and package.json), the wiki (dev dependency, README, CHANGELOG, port-consumer tests; `consolidate.test.ts` now gives each package-level test a temp `workspaceRoot`, so `.prism/wiki` no longer leaks into the package directory), the four LTM examples and `memory-and-wiki.ts` (one `memorySystem({ stm, ltm })`), host-builder data (regenerated), `scripts/{independent-packages,coverage-thresholds,e2e-coverage,live-matrix,package-truth}.json`, `package-truth.mjs`, `postgres-evidence.mjs`, `post-publish-smoke.mjs`, the e2e fixtures, `biome.json`, `bun.lock`, `memory-core`'s two conformance tests (path import), the version-literal gate (51 manifests), and the kernel tests (`packaging`, `install-smoke`, `release`, `docs`). The root `tsconfig.json` gains `bun-types/sqlite.d.ts`: `src/__tests__/compaction-when-abstain.test.ts` imports the memory system, whose dynamic import of the core SQLite store `tsc` now type-checks (type-only, `noEmit`).
      - *Memory bench.* Every current-product path moves to `packages/memory/system/src/ltm` (imports, fingerprints, `RUN_PATH_PATHS`, `VARIANT_PATHS`, the Bun `onLoad` filters in `prefix-probe.mjs` and `mechanism-probes/deterministic-ids.mjs`, readiness, acceptance, feature ledger); imports of the old fabric root use the package root. `replay.mjs`, `lifecycle/suite.mjs` and `work-outcome/run.mjs` list one `memorySystem({ ...session, ltm })`; the probe harness calls `fabric.default({ ltm })`. The feature ledger walks the system schema without its `ltm` subtree (those rows are its `fabric:` rows). **Kept on old paths, on purpose:** `task5-*.mjs` (closed plan 202 Task 5, which fingerprints historical revisions), the frozen `cleanup-criteria.json`, and the README's description of the Task 5 control worktree. **Deviation (arm rename):** the arm ids are not renamed internally. `ablations.mjs` `ARM_ALIASES`/`canonicalArm` accept `session`, `session+ltm` and `ltm`, `ltm-agentic`, `ltm-x`, `ltm-xc`, `ltm-xc-agentic`, `ltm-x-tools`, `ltm-xc-tools` at the entry points (`runBench`, `runLifecycle`) and resolve them to the historical ids, which every report, resume fingerprint, criteria row and `cleanup-campaign.mjs` job keeps. A deep rename would touch about 40 files that branch on the strings, and every run-path fingerprint, for no comparability gain.
      - *Docs.* The fabric README became `## Long-term memory` in the system README (headings demoted; examples use `memorySystem({ ltm })`), with a new top-level `## Cost, security, and failure behavior` covering both components, one `## Compatibility` section and **one `### Config stability` table** (session fields plus `ltm` and `ltm.*`). The fabric CHANGELOG is appended to the system CHANGELOG under "History of `@arnilo/prism-memory-fabric`". `docs/migrate-to-0.13.md` gains "Fabric → long-term memory in `@arnilo/prism-memory-system`" (8 rows) and updates the package map and experimental list. Also `docs/index.md`, `PRODUCT.md`, `README.md`, `roadmap.md` (package table row folded into memory-system; layout line), `docs/{release,agent,peer-dependencies,performance}.md`, `examples/README.md`, the headless, rag, core and wiki READMEs, the reference host README, the host-builder skill `choosing.md`; generated tables via `package-truth.mjs --emit-docs`, `generate-live-docs.mjs --write`, `phase54-package-map.mjs`. Broken links to `packages/memory/fabric/README.md` in `docs/migration.md` and `docs/migrate-to-0.7.md` were repointed (link targets only).
    - **Behaviour preservation.** The plan 210 golden (`fixtures/removal-byte-identical.json`, byte-for-byte the Task 3 re-pin at HEAD) passes unchanged with the replay going through `memorySystem({ ltm: { preset, tools } })`: the `conversational` and `coding` presets' provider requests, tool schemas and context blocks are byte-identical with the session tiers loaded but off. New `ltm_presets_provider_requests_byte_identical_to_210_slimmed_product` shares that replay. `prefix-stability.test.ts` passes; `prefix-probe.mjs` runs on the new paths. No attributed difference for Task 8.
    - **Baseline diff** (`release.mjs gate --update-baseline`, then `gate` exit 0): `arnilo__prism-memory-fabric.txt` folded into `arnilo__prism-memory-system.txt` and deleted. Removed: `createMemoryFabric` (renamed `createLongTermMemory`), `memoryFabric`, `packageName` (the fabric's), and the 15 shared helpers above. Added: `createLongTermMemory`, `MemorySessionConfig`. Changed: `MemorySystemConfig` (extends `MemorySessionConfig`, gains `ltm?: MemoryFabricConfig | null`), `resolveMemorySystemConfig` (parameter type `MemorySessionConfig`). Every other fabric name moves unchanged. The frozen 0.12 `arnilo__prism-memory.txt` is unchanged (an over-broad rename touched it and was reverted). `budgets.json` kernel `packedBytes` 1248830 → 1251355, `unpackedBytes` 4051478 → 4059898, `sourceLines` 40795 → 40813, with the reason recorded: this task's share is shipped docs (root CHANGELOG entry, the migration section, the rewritten fabric lines); the +18 source lines and part of the bytes are a **concurrent session's uncommitted kernel edit** (plan 215 Task 32, `src/loop/run-controller.ts`), measured on the same tree.
    - **Sweep** for `@arnilo/prism-memory-fabric`, `memoryFabric(`, `createMemoryFabric` and `memory.fabric"` over `src packages apps scripts examples templates docs README.md PRODUCT.md`: clean except migration pages, CHANGELOGs, plans, history, evidence, the frozen 0.12 baseline, the dated rationale notes in `budgets.json`/`coverage-thresholds.json`/`independent-packages.json`, the system README's migration lines, the LTM port test's negative guard, the closed `task5-*` tooling and `cleanup-criteria.json`, and the retired-name tests — enforced by `fabric_names_absent_repo_wide`.
    - **Tests run.** memory-system 657/657 (session 112 + LTM 546, less the dropped `packageName` assertion, plus `ltm_presets_provider_requests_byte_identical_to_210_slimmed_product` and `ltm_config_stability_table_matches_schema`), core 74/74, wiki 86/86, host-builder 78/78, `src/__tests__` docs/packaging/release/public-export-contract/experimental-boundary/retired-name/compaction-abstain 424/424 (new `retired-fabric-names.test.ts`: `old_fabric_name_absent_and_manifest_entry_fails_closed_naming_it`, `fabric_names_absent_repo_wide`), `install-smoke` 15/15, `version-literal-gate` 5/5, memory-bench 545 + the pre-existing feature-ledger failure (its 17 problems; new `ltm_arm_aliases_resolve_to_historical_ids`), the five memory examples run, `bun run typecheck` clean, `biome lint` clean on the touched trees (three pre-existing fabric lint findings), `host-builder-index --check` fresh, `generate-live-docs --check` in sync, `release.mjs gate` exit 0. `safety/run.mjs --suite offline`: poisoning followed 0/10, leakage 0 foreign exposures, deletion rate 1, adversarial detection 34/34; its verdict reads `fail` only because the false-refusal leg is `not-run` offline. It overwrites `docs/_evidence/memory-bench/202/safety.json` by default; that file was restored.
    - **Failures not caused here.** Reference host 64 pass / 2 fail (`host_eval_suite_passes_invariants_and_pass_hat_k`, `host_eval_suite_does_not_regress_from_baseline`): `approval_before_effect` now scores the deny items 0 ("effect tool `write` executed … without prior approval") because the concurrent kernel edit emits `tool.completed { status: "blocked" }` for a denied call that never ran; these workers load no memory package. `release-gate.test.mjs` `reference_host_suite_has_no_skips` names the concurrent session's new untracked `live-provider-journey.test.ts`. Pre-existing at HEAD (checked on a clean worktree): `phase54-package-map` partitioning, the packed full-surface journey, the three `budget-gate.test.mjs` cases, `benchmark-multi-agent`. `run.test.mjs` `markdown_store_write_amplification_within_budget` is a timing ratio in memory-core that passed and failed on identical code.
    - **Findings for later tasks.**
      - Task 6: `ltm` is already a component (`null` = off). Its schema node is `anyOf: [{ const: null }, { type: "object" }]` plus the fabric's `properties`; add `{ const: false }` there and keep `properties` on the node so retired fields keep their named errors (do not wrap the fabric schema in an `anyOf` branch). Until `stm: false` exists, an LTM-only host still loads the session tiers (off, so provider bytes are unchanged) and **claims the compaction slot**, so it needs a slot assignment beside another compaction package. Capabilities are the static union.
      - Task 7: the files are at the paths Task 7 lists (`packages/memory/system/src/ltm/…`). `working-memory.ts` is also re-exported from `ltm/public.ts`.
      - Task 8: no attributed difference for Task 5. `RUN_PATH_PATHS` and every product fingerprint now name `packages/memory/system/src/ltm`, so a run-path fingerprint from before the move does not match (reuse of an older cached arm is refused, as intended). Pass an explicit output path to `safety/run.mjs`, or restore `docs/_evidence/memory-bench/202/safety.json` after a run.

- [x] Task 6: Components, partial-use profiles and fail-closed composition
  - Acceptance Criteria:
    - Amended (2026-11-09, executed): **owner decision 2026-11-09**: an omitted `rehearsal` is on only when `wm` and `ltm` are both on (the criteria below said "on by default", which with `ltm` off by default and "rehearsal without ltm fails" made `memorySystem({})` unloadable). Omitted components resolve: `stm` on, `wm` follows `stm`, `rehearsal` = `wm && ltm`, `ltm`/`sleep` off; only an explicitly configured component fails closed. `scope` is not added: it has no sub-fields until plan 218 and "no speculative fields" applies (`ltm.scopes` already exists). `createAgent` refuses with `PackageLoadError` `setup_failed` whose message carries `memory_system_component_missing` and both component names (`PackageLoadErrorCode` is a closed kernel union); `resolveMemorySystemComponents` throws `MemorySystemError` with that code. "Capabilities computed from the enabled components" needed a kernel seam: the optional `PackageDefinitionInput.capabilitiesFor(config)`, which can only narrow the declared set (prerequisite noted here). "Loads no LTM store driver" is measured as: no `src/ltm/index.ts` (LTM setup and store resolution), no core `postgres/index.ts`, no `pg` — memory-core's root still loads its SQLite/markdown store modules for the library surface, whose `bun:sqlite`/`pg` imports are already lazy.
    - Amended (2026-11-09, Task 5): `ltm` already exists as a component (`src/config.ts`; `null` default = off, `setupLongTermMemory` in `src/ltm/index.ts`). Add `false` as a third `anyOf` branch of the `ltm` node and keep the fabric's `properties` on the node itself (a retired field must keep its named `/ltm/<field> unknown key` error). An LTM-only host claims the compaction slot until `stm: false` lands here.
    - Functional: **Config.** `memorySystem({ stm, wm, rehearsal, ltm, sleep, scope, context })`, where each component is an object or `false`. The defaults are:
      - `stm`, `wm` and `rehearsal` are on but gated per session by `memory:session`, as OM is today;
      - `ltm` is on as configured;
      - `sleep` is a no-op until plan 221.
    - Functional: **Fail-closed composition.** `createAgent` refuses each of these with `memory_system_component_missing`, naming both components:
      - `wm` without `stm`;
      - `rehearsal` without `wm` or without `ltm`;
      - `sleep` without `ltm`.

      Each case has a test.
    - Functional: **A component that is `false` loads and registers nothing:** no hook, tool, command, slot claim, service or model call. With `stm: false`, the package does not claim the compaction slot. With `ltm: false`, no `memory.*` tool and no `memory.ltm` service is registered.
    - Functional: **The four profiles work end to end** on the mock provider: `ltm`, `session` (`stm` + `wm`), `stm`, and `full`.
    - Functional: **The `memory.system` service** exists with `status()` now. `setScope`, `rehearse`, `endEpisode` and `sleep` are declared and answer `not_available_yet` (named) until their plans land.
    - Functional: **Example.** `examples/memory-system.ts` runs the four profiles. It gets its `examples/README.md` line and an `scripts/e2e-coverage.json` row.
    - Functional: **Reference host.** `apps/prism-agent` selects a profile per agent: today's defaults map to `ltm` for the memory opt-in, with OM's opt-in mapped to `session`. `bun run --filter @arnilo/prism-agent test` passes.
    - Performance: A test asserts that with only `ltm`, the package loads no session code. With only `stm`, it loads no LTM store driver ("not loaded unless listed", references §3 probe 5).
    - Code Quality: One config schema with `contract` and `tuning` tags per field. The stability table is checked by `stability.test.ts`. No speculative fields: the `sleep` and `scope` sub-fields arrive in their plans.
    - Security: The capability declarations are computed from the enabled components; a disabled component declares nothing.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/api.ts:76-200` (`PackageAPI`);
      - `docs/packages.md` (capabilities, `when` gating);
      - design §6.
    - Options Considered:
      - Separate packages per tier on a shared core. Rejected by the owner ("consolidate everything into one memory system").
      - A `profile` string only. Rejected: hosts need per-component config. Profiles are documented recipes, not a config field.
    - Chosen Approach:
      - Per-component objects or `false`, with fail-closed dependencies.
    - API Notes and Examples:
      ```ts
      memorySystem({ stm: {}, wm: false, rehearsal: false, ltm: false }); // event log + recall only
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/{index,config,components,service}.ts` and tests;
      - `examples/memory-system.ts`, `examples/README.md`, `scripts/e2e-coverage.json`;
      - `apps/prism-agent/src/host/**` and tests;
      - the package README (`## Configuration`, profiles).
    - References:
      - design §6.
  - Test Cases to Write:
    - `component_dependencies_fail_closed_with_named_error` (one case each).
    - `disabled_component_registers_nothing`.
    - `four_profiles_run_end_to_end_on_mock_provider`.
    - `ltm_only_profile_loads_no_session_code`.
    - `service_methods_not_yet_available_answer_named_error`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config shape and profiles.
    - Docs pages to create/edit:
      - the package README (`## Configuration`, `## Profiles`, `## Cost, security, and failure behavior`); `examples/README.md`; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-09):
    - **What changed.**
      - *Components.* New `src/components.ts`: `MEMORY_SYSTEM_COMPONENTS`, `resolveMemorySystemComponents` (the resolution and the four fail-closed cases above), `MemorySystemError` (`memory_system_component_missing`, `not_available_yet`) and `memorySystemCapabilities` (`stm` → `models`, `session-state`, `background`, `slot:compaction`; `ltm` → `models`, `session-state`, `background`, `credentials`, `host-ui`). `src/config.ts` builds one schema: each component node keeps its object's `properties` without `type` (so `false` validates and an unknown or retired key keeps its named `/<component>/<key>` error), adds `anyOf: [null, false, object]` and `default: null` (the kernel would otherwise materialise `stm`/`wm`/`rehearsal` from their fields' defaults, making "omitted" indistinguishable from "configured"). `sleep` is `{}` or `false`, with no fields. `stability.test.ts`'s table gains `sleep`.
      - *Setup.* `src/index.ts` resolves the components first (a missing dependency fails before anything registers), provides `memory.system`, then `await import`s `./ltm/index.js` only when `ltm` is on and `./session/setup.js` only when `stm` is on (long-term memory first, as Task 5 ordered it). The session tiers' setup body moved unchanged into `src/session/setup.ts` (`setupSessionTiers`). `resolveMemorySystemConfig(input, components?)` accepts `false`/`null` sections; its result's `wm` and `rehearsal` carry `enabled` (default `true` for direct callers), and `flush.ts` skips the reflector and dropper passes when off.
      - *Service.* `src/service.ts`: `memory.system` (`MEMORY_SYSTEM_SERVICE`) with `status()` → `{ components }`; `setScope`/`endEpisode` (plan 218), `rehearse` (219) and `sleep` (221) reject with `MemorySystemError` `not_available_yet` naming the plan. It is provided whatever the components (it needs no capability).
      - *Kernel (prerequisite).* `PackageDefinitionInput.capabilitiesFor?(config)` (`src/packages/api.ts`); `definePackage` requires it to be a function and `capabilities` to be declared (`define.ts`); the loader's `instanceCapabilities` (`loader.ts`) calls it with the frozen validated config and keeps only a subset of the declared set — a capability outside it, a non-array or a throw is `definition_invalid` (the thrown text is not echoed). `inspect().packages[].capabilities` reports the narrowed set; manifests keep recording the declared set. The memory system's `capabilitiesFor` returns `[]` for a config with a missing dependency, so setup still fails with the named error. New kernel test `capabilities_for_narrows_per_instance_and_fails_closed_outside_declared`; `docs/packages.md` → Capabilities.
      - *Reference host.* New `apps/prism-agent/src/host/memory.ts` `memoryProfileFor(config, model)`: the memory opt-in is the `ltm` profile plus the `session` profile (`stm: {}`, `wm: {}`, still gated by `memory:session`, OM's opt-in); `rehearsal` resolves on, so behaviour is unchanged. `coding.ts`/`research.ts` list it; `conversational-memory.test.ts` asserts the tools, the toggle and the six capabilities.
      - *Example and docs.* `examples/memory-system.ts` runs the four profiles on an inline mock provider and asserts each profile's tools, commands, slot claim, capabilities, service status, observations/reflections/drops and the fact note (`--json` prints the report); `examples/README.md` line; `scripts/e2e-coverage.json` row (with `components.test.ts`); host-builder data regenerated. Package README: new top-level `## Configuration` (components table, fail-closed composition, "off registers nothing", capabilities, the service) and `## Profiles`; the session section's Capabilities and Slot ownership note `stm: false`. CHANGELOGs (root and package). Package dev dependency `@arnilo/prism-memory-compaction` (the slot test).
    - **Behaviour change (owner decision).** A host with the session tiers and no `ltm` no longer runs the dropper (rehearsal off); rendering stays bounded by `rehearsal.targetTokens`. No package or host test depended on it; the memory-bench `om`/`session` arm (no `ltm`) is affected only if its fixtures push the active pool past 20,000 tokens.
    - **Tests run.** New `src/__tests__/components.test.ts` (7): `component_dependencies_fail_closed_with_named_error`, `component_config_accepts_false_and_keeps_named_key_errors`, `disabled_component_registers_nothing`, `service_methods_not_yet_available_answer_named_error`, `four_profiles_run_end_to_end_on_mock_provider`, `ltm_only_profile_loads_no_session_code`, `stm_only_profile_loads_no_ltm_store_driver` (fresh processes reading `require.cache`, each with a positive control). memory-system 662 pass / 2 fail; kernel suites (docs, packaging, release, public-export-contract, experimental-boundary, package-loader, package-contributions, package-api-freeze, agent-surface, compaction-abstain) 490/490; `prefix-stability` + `removal-byte-identical` 26/26 (the plan 210 golden still byte-identical); memory-bench 546 pass + the pre-existing feature-ledger failure (back to its 17 problems after adding the `om.sleep` row); `e2e-coverage.test.mjs` 8/8; wiki 85 + 1; the reference host 64 pass / 2 fail; examples `memory-system`, `memory-and-wiki`, `session-memory`, `long-term-memory` exit 0; `bun run typecheck` clean; biome clean on the new files (`loader.ts` was unformatted at HEAD and is left so; `define.ts`/`package-loader.test.ts` import order is pre-existing); `host-builder-index --check` fresh; `release.mjs gate` exit 0.
    - **Failures not caused here.** memory-system `no_workspace_imports_prism_memory_family` and `removed_memory_names_absent_repo_wide`, and wiki `retired_wiki_names_absent_repo_wide`, all name `scripts/retired-names.json`, a concurrent session's new untracked file. Reference host `host_eval_suite_*` (2): the same concurrent `run-controller.ts` edit Task 5 recorded; those workers load no memory package. Fixed in passing: `e2e-coverage.test.mjs` expected 87 surfaces, but Task 5's fold of the fabric left 86.
    - **Memory-bench.** `variants.mjs` `om.reflector=off` gains the new `flush.ts` anchor first (the older anchors keep historical revisions building); `defaults.json` gains `wm.enabled`/`rehearsal.enabled` (the resolver's standalone defaults); `feature-ledger-features.mjs` gains `om.sleep` (unmeasured).
    - **Baseline diff** (`gate --update-baseline`, then `gate` exit 0). `@arnilo/prism`: `PackageDefinitionInput` gains `capabilitiesFor?` (additive). `@arnilo/prism-memory-system`: added `MEMORY_SYSTEM_COMPONENTS`, `MEMORY_SYSTEM_SERVICE`, `MemorySleepConfig`, `MemorySystemComponent`, `MemorySystemComponentConfig`, `MemorySystemComponents`, `MemorySystemError`, `MemorySystemErrorCode`, `MemorySystemService`, `MemorySystemStatus`, `resolveMemorySystemComponents`, and the types `MemorySessionComponents`, `MemorySessionConfigInput`; changed `MemorySystemConfig` (component fields take `false`/`null`, `sleep` added), `ResolvedMemorySystemConfig` (`wm.enabled`, `rehearsal.enabled`), `resolveMemorySystemConfig(input?, components?)`. No removal. `budgets.json` kernel 1251355 → 1252136 packed, 4059898 → 4062540 unpacked, 40813 → 40862 source lines: this task's +36 lines are `capabilitiesFor` in `api.ts`/`define.ts`/`loader.ts` plus the CHANGELOG and `docs/packages.md` bytes; +13 lines are a concurrent session's uncommitted `src/testing/provider-live-scenarios.ts` edit.
    - **Findings for later tasks.**
      - Task 7: unaffected; `ltm` code now loads through `await import("./ltm/index.js")`, so a removal there does not touch the root's static graph.
      - Task 8: record the dropper change above as an attributed difference if the `session`/`om` replay crosses `rehearsal.targetTokens` (otherwise none). `variants.mjs` and `defaults.json` changed (fingerprinted sources may move). The session tiers now load through `src/session/setup.ts` (dynamic import): any bench `onLoad` filter keyed on `src/index.ts` for session code must also match `session/setup.ts`.
      - Plans 218/219/221: `memory.system`'s `setScope`/`endEpisode`/`rehearse`/`sleep` and a `scope` component are waiting; `sleep`'s schema node has an empty `properties` to fill.

- [x] Task 7: Retire LTM working memory, the episode view and episode merge (owner decision 2026-11-08)
  - Acceptance Criteria:
    - Amended (2026-11-09, executed): **byte-identical presets** cannot hold for the tool schemas: `memory.insert`, `memory.replace` and `memory.forget` lose `block`, `memory.recall` loses the `working` kind, and four descriptions named working blocks, so the tool catalogue in the system message changes with them. Measured instead: the replay's context blocks are byte-identical (digest pinned in `presets_byte_identical_after_removal`), and with only the old tool-schema text restored the post-removal replay equals the pre-removal golden byte for byte (requests, tools, context and a new per-request `messages` hash). The golden was re-pinned as an attributed difference, as Task 3 did. **`observational` stays** on `createLongTermMemory`: `reflectionId` promotion and `searchConversation` use it; only the episode view over it is removed. **A config holding working notes** fails with the kernel's named `/ltm/<path> unknown key "<field>"` error (config validation runs before setup and `PackageLoadErrorCode` is a closed kernel union); `working_memory_retired` is the code of `remember({ kind: "working" })` and of a markdown store or OKF bundle that still holds a `working/` note. `MemoryValidationError` gains an optional `MemoryValidationCode` so the two migration codes are machine-readable.
    - Functional: **Working memory.** The `working` kind, the working-memory store use, the `_fabric` working key, labeled working blocks, `working/<thread>.md` (`packages/memory/core/src/fabric/okf.ts:288`) and the working-memory core block are removed from LTM. The name now belongs to the WM component.
      - `WorkingMemoryStore` and `WorkingMemoryRecord` are removed from `@arnilo/prism-memory-core` if no other caller remains (`graft callers --depth all`). Task 1 finding F5: core's SQLite, Postgres and markdown drivers (`core/src/{sqlite,postgres,fabric}/index.ts`, `fabric/okf.ts`) and their conformance return the store, so the task edits them and the fabric's `blocks.ts`, `okf-bundle.ts` and `conformance.ts` too. An existing SQL working-memory table is left in place and unread (no migration).
      - A config or store holding working notes fails with `working_memory_retired` and an export hint.
    - Functional: **Episode view and merge.** The `episode` view over OM ids (`create.ts:360-380`, the `observational` option of `createLongTermMemory`) and `lifecycle.episode-merge` (`lifecycle/merge.ts`, `lifecycle.merge.episodes`) are removed.
      - The `episode` kind name stays reserved, because plan 219 adds the stored immutable kind.
      - Until then, writing `kind: "episode"` fails with `episode_kind_not_available`.
    - Functional: **Byte-identical presets.** Plan 210's `inertRemoval` test applies: with the code removed, the `conversational` and `coding` presets' provider requests and tool schemas are byte-identical on the offline replays.
    - Functional: **Sweep** for the removed names; `docs/migrate-to-0.13.md` rows.
    - Performance: Reports the reduction in package load cost (`scripts/budgets.json`).
    - Code Quality: Whole removals (no dead branches). The compat baselines (`memory-system`, `memory-core`) are regenerated and attributed.
    - Security: The deletion cascade and lineage tests stay green. No safety-proven row is touched.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/working-memory.ts:10-80` (moved);
      - `packages/memory/core/src/types.ts:334-360`;
      - `gap-analysis.md` rows `delivery.working-memory`, `kind.episode`, `lifecycle.episode-merge`;
      - plan 210 Task 6 `transferred` verdicts.
    - Options Considered:
      - Keep `working` under another name. Rejected: unmeasured, rare, and WM replaces its purpose with a measured tier.
    - Chosen Approach:
      - Clean deletion with named migration errors.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{working-memory,types,create,context,lifecycle/merge,config}.ts` and tests;
      - `packages/memory/core/src/{types,fabric/okf,fabric/layout}.ts` and tests;
      - `scripts/compat-baseline/*`; `scripts/budgets.json`;
      - the README; `docs/migrate-to-0.13.md`; CHANGELOGs;
      - `docs/_evidence/memory-bench/210/decisions.md` (the transferred rows' final disposition: `removed by plan 216 Task 7`);
      - `plans/backlog.md`: remove "Fabric tools do not wire the observational session" and "Wire fabric tools to the observational session", naming both titles in this task's note (Task 1 hand-off).
    - References:
      - design §10, §12.
  - Test Cases to Write:
    - `working_kind_and_store_absent`.
    - `working_notes_in_store_fail_with_export_hint`.
    - `episode_view_and_merge_absent_and_kind_reserved`.
    - `presets_byte_identical_after_removal`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed kinds and config.
    - Docs pages to create/edit:
      - the package README; `docs/migrate-to-0.13.md`; CHANGELOGs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-09):
    - **What changed.**
      - *Core (`@arnilo/prism-memory-core`).* `WorkingMemoryStore`, `WorkingMemoryRecord`, `WorkingMemoryKey`, `WorkingMemoryUpdateMode`, `WorkingMemoryUpdateOptions`, `WorkingMemoryProcessorOptions` and `renderTemplate` (its only caller was the working template) are removed, with the working members of `Memory`, `CreateMemoryOptions` (`workingStore`, `schema`, `validateWorkingMemory`, `workingMemoryTemplate`), `MemoryContextProviderOptions.includeWorking` and `MemoryLimits.maxWorkingMemoryBytes`. `graft`/grep found no other caller. The SQLite, Postgres and markdown drivers no longer return a working store; new SQLite/Postgres stores do not create `working_memory`, and an existing table is left in place and unread (no migration, no open-time probe). The markdown store fails to open on a `<resource>/working/<thread>.md` note with `working_memory_retired`, naming the file and the export hint (`RETIRED_WORKING_DIRECTORY` in `layout.ts`); `okf.ts` loses `renderWorkingFile`/`parseWorkingFile` and the `Working` OKF type. Kept: `validateAgainstJsonSchema` (the bench lifecycle suite uses it), `cloneJsonObject`/`mergeJsonObjects` (generic, own tests). `MemoryValidationError(message, code?)` with the exported type `MemoryValidationCode`.
      - *Long-term memory (`packages/memory/system/src/ltm`).* Deleted `working-memory.ts` and `blocks.ts`. `working` left `MemoryNoteKind`/`MEMORY_NOTE_KINDS`, the decay table, the `inject.kinds` enum and the port's hidden kinds; `MEMORY_FABRIC_WORKING_KEY`, the `block` fields on notes, remember and forget inputs (`MemoryFabricForgetInput.id` is now required), the `fabric-working` tail block (`context.ts`), the directory's `Blocks:` line, the export's `working` flag and `MemoryOkfStores.workingStore` are gone. Tools: no `block` on insert/replace/forget, no `working` recall kind, the default recall kinds are every stored kind; with `semantic: false` only file paths remain writable. `remember({ kind: "working" })` → `working_memory_retired`; `remember({ kind: "episode" })` → `episode_kind_not_available` (the kind stays reserved and the store/port still hide it). Episode merge: `lifecycle/merge.ts` keeps duplicate folding only; `maintain.ts` loses the episode step, `episodesMerged` and the model-call deps (`remember`, `workerLimits`, `resolveModelClient`, `redactor`, `secrets`); `lifecycle.merge.episodes` left the schema, resolver and stability table. Config `workingMemoryTemplate` and `limits.maxWorkingMemoryBytes` removed.
      - *Tests.* New: `working_kind_and_store_absent` (`notes.test.ts`), `working_notes_in_store_fail_with_export_hint` (core `markdown.test.ts`), `episode_view_and_merge_absent_and_kind_reserved` (`notes.test.ts`), `presets_byte_identical_after_removal` (`removal-byte-identical.test.ts`), `working_block_targets_absent_from_tools` (`tools.test.ts`), `sqlite_legacy_working_memory_table_is_left_in_place_and_unread`, `stored_episode_rows_are_never_merged_and_fall_to_eviction`; `removed-config.test.ts` gains the four retired config fields. Working/episode-merge tests were deleted or rewritten to the durable kinds (package, prefix-stability, tools, memory, merge, provenance, standing-rules, directory, context-recall, observational-source, postgres integration, okf-bundle, conformance).
      - *Bench and tooling.* Mechanism probes `lifecycle.episode-merge`, `delivery.working-memory` and `kind.episode` and their replay counters are removed; `ledgerRows()` drops a candidate whose final disposition is a removal. New `docs/_evidence/memory-bench/210/dispositions.json` (destination plans record final dispositions) read by `decision-record.mjs`, which renders a **Final disposition** column; `decisions.{json,md}` regenerated (`--check` passes): the three transferred rows read `removed by plan 216 Task 7`. Feature ledger: rows `lifecycle.episode-merge` and `delivery.working-memory` removed, `kind.episode` renamed to the reserved kind, two safety rows re-pointed to renamed tests (the ledger is back to its 17 pre-existing problems). `prefix-probe.mjs` drops the `working-update` scenario and the always-null `fabric-working` source (6 scenarios). `readiness.mjs` `CACHE_STABILITY_TESTS` drops the deleted `working_memory_update_reaches_the_tail_not_the_prefix`. `variants.mjs` `lifecycle.merge=off` replaces the episode anchor only where a pinned revision still has it; `ablations.mjs` loses `fabric.lifecycle.merge.episodes`; `defaults.json` loses the `working` decay. Mechanical `workingStore` removals in `safety/{run,ontology}.mjs`, `replay.mjs`, `retrieval-diagnostics.mjs`, `run.test.mjs`, `measurement-repairs.test.mjs`, `mechanism-probes/lifecycle.mjs`, the e2e full-surface fixture and `install-smoke.test.ts`. Kept on purpose: `injection-log.mjs` still classifies `fabric-working` in recorded captures, and `gap-analysis-rows.mjs`/`cleanup-criteria.json` (plan 210's frozen inputs) keep the rows.
      - *Examples and docs.* `examples/working-semantic-memory.ts` → `examples/semantic-memory.ts` (semantic recall only; README line updated); `memory-lifecycle.ts` and `long-term-memory.ts` drop the working store; host-builder data regenerated (`--check` fresh). System README (cost section, config example, maintenance, tools table and rules, recall defaults, OKF export, directory sample, stability table, migration bullets), core README (contracts, SQLite, markdown store, errors row), `docs/migrate-to-0.13.md` section "Long-term working memory, the episode view and episode merge (removed)" (7 rows), CHANGELOGs (root, system, core), the execution skill's memory reference line.
    - **Byte identity.** Before any edit the golden gained a per-request `messages` hash, pinned on the pre-removal product (the four existing fields unchanged). After the removal: `context` 12/12 equal per preset; `tools`, `request` and `messages` 0/12 (the catalogue is part of the system message). Restoring only the old tool-schema text in `tools.ts` made the replay pass the pre-removal golden on every field, so the tool schemas are the whole difference; the code was then restored. Golden sha256 `6ee12dbd…` → `0a02d4e4…`; `docs/_evidence/memory-bench/210/slimmed/record.json` `byteIdenticalTest` carries the new sha and a `repinned` entry naming this task.
    - **Baseline diff** (`release.mjs gate --update-baseline`, then `gate` exit 0). `@arnilo/prism-memory-core`: removed `WorkingMemoryKey`, `WorkingMemoryProcessorOptions`, `WorkingMemoryRecord`, `WorkingMemoryStore`, `WorkingMemoryUpdateMode`, `WorkingMemoryUpdateOptions`, `renderTemplate`; added `MemoryValidationCode`; changed `MemoryValidationError` (optional `code`), `CreateMemoryOptions`, `Memory`, `MemoryContextProviderOptions`, `MemoryLimits`, `MemoryLimitsInput`, `./fabric MarkdownMemoryStores`, `./postgres PostgresMemoryStores`/`PostgresMemoryStoresOptions`, `./sqlite SqliteMemoryStores` (no `workingStore`). `@arnilo/prism-memory-system`: removed `createMemoryWorkingStore`, `MemoryWorkingStoreOptions`; changed `ExportMemoryOkfResult` (no `working`), `MemoryConformanceStores`, `MemoryFabricConfig`, `MemoryFabricForgetInput`/`Result` (`id` required, no `block`), `MemoryFabricLifecycleConfig`, `MemoryFabricMaintenanceReport` (no `episodesMerged`), `MemoryFabricRememberInput`, `MemoryNote` (no `block`), `MemoryNoteKind` (no `working`), `MemoryOkfStores`, `ResolvedMemoryFabricConfig`, `ResolvedMergeConfig`. Every removal is this task's. `budgets.json` kernel 1254428 → 1255985 packed, 4069240 → 4073642 unpacked (reason recorded: the migration section and the root CHANGELOG entry; no kernel source, export or file change).
    - **Load cost.** About 1,190 source lines removed and 155 added across `memory-core` and `ltm` (non-test files this task edited; the index-relative numstat also carries Tasks 5–6's unstaged edits to `ltm/index.ts`, consolidation and search, excluded here). Two modules fewer in the LTM graph (`blocks.ts`, `working-memory.ts`: 211 lines, 9.4 KB), maintenance no longer resolves worker limits on every pass, and the core's three drivers lose their working-store code (SQLite −62, Postgres −118, markdown −35 lines). No package tarball was measured before the edit (the tree had no clean pre-task snapshot), so the reduction is reported in source terms.
    - **Sweep.** `bun scripts/retired-names.mjs --generate` added 9 exports (`createMemoryWorkingStore`, `MemoryWorkingStoreOptions`, the six `WorkingMemory*` names, `renderTemplate`); `bun scripts/retired-names.mjs`: 0 hits in 2,065 files. A grep over `apps docs README.md PRODUCT.md roadmap.md .agents` and the package READMEs (excluding history, evidence and migration pages) finds no working block, `workingMemoryTemplate`, `fabric-working`, `merge.episodes`, episode view or working API. `docs/performance.md`'s 0.0.5 verification row still names `WorkingMemoryStore` (a dated record).
    - **Backlog hand-off (titles removed):** "Fabric tools do not wire the observational session" and "Wire fabric tools to the observational session" (the episode view they extend is gone; reflection promotion stays a library path, and plan 219's Rehearsal owns promotion).
    - **Tests run.** memory-system 656 pass / 29 skip / 2 fail; memory-core 75/75; wiki 85 + 1; rag 100/100; memory-bench 545 + the feature-ledger failure (its 17 pre-existing problems); `mechanism-probes/probes.test.mjs` 5/5; probes for `lifecycle`, `delivery`, `kinds` run with only plan 210's `decisions.P1/P2/P6` errors (pre-existing); `prefix-probe.test.mjs` 5/5; `decision-record.test.mjs` 3/3; kernel docs/packaging/release/public-export/experimental-boundary/install-smoke/compaction-abstain/retired-fabric-names 437 + 1 (the release-workflow test below); `e2e-coverage`, `retired-names`, `host-builder-index` tests pass (`host_builder_index_is_fresh` needs `--timeout=0`); the reference host 64 + 2; `bun run typecheck` clean; `biome lint` clean on the touched files except three pre-existing findings (`ltm/index.ts:529`, two delivery tests) and core `index.ts` `useExportType`; examples `semantic-memory`, `memory-lifecycle`, `long-term-memory`, `memory-system`, `memory-and-wiki`, `session-memory` exit 0; `safety/run.mjs --suite offline --ontology --output <scratch>`: poisoning followed 0, leakage 0, deletion rate 1, adversarial 34/34, ontology probes pass (the verdict reads `fail` only because the false-refusal leg is `not-run` offline; the committed safety evidence is untouched); `work-outcome/run.mjs --offline` exit 0.
    - **Failures not caused here.** `removed_memory_names_absent_repo_wide`, `no_workspace_imports_prism_memory_family` and the wiki's `retired_wiki_names_absent_repo_wide` name `scripts/retired-names.json` (Task 6 recorded them; the file is still untracked). Reference host `host_eval_suite_*` (2), as in Tasks 5–6. `release.test.ts` "release workflow publishes the lockstep cut once…" reads the concurrent plan 215 Task 36 workflow edit. Fixed in passing: `scripts/e2e-coverage.test.mjs` (Task 6's comment named the retired fabric package, failing `fabric_names_absent_repo_wide`).
    - **Findings for later tasks.**
      - Task 8: attributed differences for this task are (1) the tool-schema re-pin above (context unchanged), (2) the prefix-probe report shape (no `working-update` scenario and no `fabric-working` block hash, so `prefix-probe.mjs --equivalence` against `.cache/memory-bench/210/slimmed` differs there), (3) `CACHE_STABILITY_TESTS` lost one test name, and (4) the plan 210 mechanisms report no longer probes the three removed rows. `cleanup-campaign.mjs`'s dry run should still resolve: only the `lifecycle.merge=off` variant changed, and it keeps historical revisions building.
      - Plan 219: the consolidation extractor still emits `episode` notes, which `consolidation/write.ts` skips as `episode-view`; the stored episode kind replaces that skip. `remember({ kind: "episode" })` must stop throwing `episode_kind_not_available` there, and `ltm.ts` `HIDDEN_KINDS` must decide whether episodes are evidence.
      - Plan 210 follow-up: the plan 210 mechanisms report still errors on `decisions.P1/P2/P6` and the feature ledger still carries 17 rows for features plan 210 removed; `dispositions.json` plus `ledgerRows()` is the pattern for reconciling them.

- [x] Task 8: Behaviour-preservation record, cache-pin re-attestation and plan end
  - Acceptance Criteria:
    - Amended (2026-11-09, executed): the equivalence base is `.cache/memory-bench/216/om-before`, a worktree of `37ee1a24` (`OM-before`), not `.cache/memory-bench/210/slimmed`. Plan 210's slimmed product was never committed on its own, and `37ee1a24` is the first commit that holds it (plus Tasks 1–3, the Task 3 golden point). That base has no `@arnilo/prism-memory-system`, so this harness cannot import its product: `prefix-probe.mjs --equivalence` gained `--base-harness own`, which runs the base on its own committed, unmodified harness and install. Task 3 is covered by its in-tree golden re-pin. The session tiers, which the answer paths never load, get their own tree-agnostic replay (`session-replay.mjs`).
    - Amended (2026-11-09, Task 7): Task 7's attributed differences are the tool-schema re-pin (golden `0a02d4e4…`, context blocks unchanged, `record.json` `repinned` entry; the golden now also hashes each request's `messages`), the prefix-probe report shape (the `working-update` scenario and the `fabric-working` block hash are gone, 6 scenarios), `readiness.mjs` `CACHE_STABILITY_TESTS` (one deleted test name), and the plan 210 mechanisms coverage (three removed rows, excluded through `docs/_evidence/memory-bench/210/dispositions.json`). Record each in `preservation.json`; the equivalence run compares the remaining scenarios.
    - Amended (2026-11-09, Task 6): an omitted `rehearsal` now resolves on only with `wm` and `ltm` (owner decision), so a session-only replay runs no dropper; list it in `preservation.json` as an attributed difference for any fixture whose active pool exceeds `rehearsal.targetTokens`. The session tiers' setup moved to `src/session/setup.ts` (loaded by dynamic import) and `flush.ts` gained `config.wm.enabled`/`config.rehearsal.enabled` guards; `variants.mjs` and `defaults.json` changed accordingly.
    - Amended (2026-11-09, Task 5): Task 5 has no attributed difference (the plan 210 golden passes unchanged through `memorySystem({ ltm })`). Product fingerprints and `RUN_PATH_PATHS` now name `packages/memory/system/src/ltm`; `task5-*.mjs` and `cleanup-criteria.json` keep the historical fabric paths. Memory-bench arm ids stay historical; `session`, `session+ltm` and `ltm…` are entry-point aliases (`ablations.mjs` `ARM_ALIASES`). `safety/run.mjs --suite offline` overwrites `docs/_evidence/memory-bench/202/safety.json` unless given another output.
    - Amended (2026-11-08, Task 3): Task 3 changed both presets' `memory.recall` tool schema on purpose (the kinds enum and description no longer name `concept`; the old fabric had the ontology on whenever `semantic` was on). The plan 210 golden was re-pinned and `docs/_evidence/memory-bench/210/slimmed/record.json` carries a `repinned` entry; context blocks are unchanged. The preservation record lists it as an attributed difference, and "byte-identical" for Tasks 4, 5 and 7 is measured against the Task 3 golden.
    - Amended (2026-11-08, Task 4): Task 4's offline replay (one scripted session on `OM-before` `37ee1a24` and on the moved package, 12 provider requests) is identical except two attributed renames: the summary heading `# Session Memory` and the workers' `sessionId`/`cacheKey` `memory.session:<id>`. Record them in `preservation.json`. Fingerprint paths naming `packages/memory/observational/src` now read `packages/memory/system/src` (the frozen criteria keep the old path as the OM-before product path).
    - Functional: **Behaviour-preservation record.**
      - `docs/_evidence/memory-bench/216/preservation.json` lists, for each move (Tasks 3–5 and 7), the offline replay fixtures run, the byte-identity result, and every attributed difference (renamed headings, ids, removed concept stages).
      - `cleanup-campaign.mjs` can still build every plan 210 arm against the new paths (a dry-run manifest), so any later rerun compares like with like.
    - Functional: **Cache pin.** The plan 202 readiness cache-stability pin is re-attested on the new product with byte-identical provider requests where no attributed difference applies (`prefix-probe.mjs --equivalence`).
    - Functional: **Plan end.** Compromises Made, Further Actions, and the backlog hand-off per the create-plan skill.
    - Performance: `session-turn-overhead` and the markdown-scale budgets are unchanged within noise (`scripts/budgets.json` gate).
    - Code Quality: Records generated by the existing tools; no hand-written hashes.
    - Security: The safety suite is green offline (`safety/run.mjs --suite offline`), including the wiki probes.
  - Approach:
    - Documentation Reviewed:
      - plan 202 Tasks 4.11–4.15;
      - plan 210 Task 0.3 (pin re-attestation);
      - `scripts/memory-bench/{prefix-probe,readiness}.mjs`.
    - Options Considered:
      - Skip the re-attestation because nothing "should" change. Rejected: three package moves touch fingerprinted sources.
    - Chosen Approach:
      - Measured preservation, then hand off.
    - API Notes and Examples:
      ```sh
      git worktree add --detach .cache/memory-bench/216/om-before 37ee1a24
      (cd .cache/memory-bench/216/om-before && timeout 300 bun install --frozen-lockfile)
      timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base .cache/memory-bench/216/om-before --base-harness own --out docs/_evidence/memory-bench/216/equivalence.json
      timeout 900 bun scripts/memory-bench/preservation.mjs --base .cache/memory-bench/216/om-before --equivalence docs/_evidence/memory-bench/216/equivalence.json --out docs/_evidence/memory-bench/216/preservation.json
      cp docs/_evidence/memory-bench/216/equivalence.json docs/_evidence/memory-bench/202/cache-stability/equivalence.json
      timeout 900 bun scripts/memory-bench/audit/readiness.mjs --cache-stability
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/216/{preservation,equivalence}.json`, `README.md`;
      - `docs/_evidence/memory-bench/202/cache-stability/{equivalence,record}.json`, `README.md`;
      - new `scripts/memory-bench/{session-replay,preservation}.mjs`, `preservation.test.mjs`; `prefix-probe.mjs` (`--base-harness own`), `cleanup-campaign.mjs` (`dryRunC1Manifest`, `C1_RETIRED_ABLATIONS`) and its test, `audit/readiness.test.mjs`, `mechanism-probes/om.mjs`, `scripts/memory-bench/README.md`;
      - this plan; `plans/backlog.md`.
    - References:
      - Tasks 3–7.
  - Test Cases to Write:
    - `preservation_record_lists_every_move_and_attributed_difference`.
    - `cleanup_campaign_dry_run_resolves_new_paths`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-09):
    - **Base.** `.cache/memory-bench/216/om-before` is a worktree of `37ee1a24` with its own `bun install --frozen-lockfile`. Plan 210's slimmed product (`867f8277…`) was only ever working-tree state at `bc87e539`, so no commit holds it alone; `37ee1a24` adds Tasks 1–3 to it. The plan 210 golden at that commit is `6ee12dbd…`, the Task 3 re-pin.
    - **New tooling.**
      - `prefix-probe.mjs --equivalence --base-harness own`: the base runs its own committed harness (refused if `scripts/memory-bench` is locally edited or `node_modules` is missing). The report records `harness: "per-tree"`, both harness hashes and each tree's product and supporting paths. The default shared-harness mode is unchanged.
      - `session-replay.mjs`: one scripted session (three turns each followed by an observer pass, `session.compact()`, one more turn; 12 requests) on any tree's own kernel and session package. Run ids, 12-hex observation ids and timestamps are normalized. `--compare` applies only the named Task 4 renames.
      - `preservation.mjs`: builds `216/preservation.json` from both trees. It covers the session replay, the answer paths re-compared with the tool schemas and system tool catalogue removed (naming the tools that differ), the prefix-probe report on both trees, the golden re-pin chain, `CACHE_STABILITY_TESTS` on both trees, `210/dispositions.json` and the C-1 dry run. It exits 1 on any unattributed difference.
      - `cleanup-campaign.mjs` `dryRunC1Manifest`: every C-1 job's arm config resolves through the package schemas, and its historical variants patch their moved files. `C1_RETIRED_ABLATIONS` names the arms a removal retired; a plan 210 entry is checked against the slimmed record's removals.
    - **Results** (`docs/_evidence/memory-bench/216/README.md`). Verdict: *preserved: every difference is attributed*.
      - *Answer paths* (`equivalence.json`): 54 requests, deterministic on both trees, `different`. `preset-r1` differs in `system` and `tools`, `passive-only` in `system`; context, transcript and tail are identical. With tool schemas and the catalogue removed, 54/54 are byte-identical, and the differing tools are exactly `memory.{forget,insert,recall,replace,view}` (Task 7).
      - *Session tiers*: 12 requests, 3 identical and 9 identical after the two Task 4 renames (`# Observational Memory` → `# Session Memory`, `"om:s"` → `"memory.session:s"`), 0 unattributed.
      - *Task 6*: the replay pool is 52 tokens against a 20,000 target, so the omitted-`rehearsal` change cannot show and is listed as not applying.
      - *Task 7*: the prefix-probe report lost `working-update` and `fabric-working`; the six remaining scenarios render identical `fabric-directory`/`fabric-rules` hashes request by request. `CACHE_STABILITY_TESTS` lost `working_memory_update_reaches_the_tail_not_the_prefix`. Three mechanisms rows are excluded through `dispositions.json`.
      - *Dry run*: 160 jobs, 124 build, 36 retired, 0 errors. The retired arms are `supersessionHint`, `enrichment` and `timeline` (plan 210 Task 7) and `concept-prior-loo` (`fabric.ontology.conceptPrior`, Task 3: the concept kind prior left with the ontology).
    - **Cache pin re-attested.** `202/cache-stability/equivalence.json` is now the 216 file; `readiness.mjs --cache-stability` gives 27 pass / 0 fail on product `4fb60791…` (`packages/memory/system/src/ltm`), with every `CACHE_STABILITY_TESTS` name present. `preset-r1`/`passive-only` stay `rerunArms`, `mergeWithPreChangeCells: false`.
    - **Fixes found by the run.**
      - `readiness.test.mjs` `slimmed_record_lists_every_removal_and_passes_cache_pin` read the live 202 equivalence file, so re-attesting broke the historical plan 210 `P` record's binding. It now reads `210/slimmed/equivalence.json`, the byte copy plan 210 kept (`fe4124e8…`).
      - `mechanism-probes/om.mjs`: `om.reflector`, `om.dropper-model` and `om.dropper-lowest-relevance` still passed `reflector`/`dropper` (a Task 4 rename the probes missed). They now use `wm`/`rehearsal`, plus `ltm: {}`, because rehearsal needs `ltm` (Task 6). The reflector probe keeps its inert rehearsal (target 2,000,000) because `resolveMemorySystemConfig` checks `rehearsal.targetTokens >= wm.observationTokens` even when rehearsal is off (Further Actions). All nine `om.*` probes work.
    - **Tests run.** `preservation.test.mjs` 3/3 (`preservation_record_lists_every_move_and_attributed_difference`, `session_replay_normalizes_run_ids_and_applies_only_named_renames`, `answer_path_attribution_names_differing_tools_and_counts_residuals`). `cleanup-campaign.test.mjs` + `cleanup_campaign_dry_run_resolves_new_paths`, readiness 11/11, `prefix-probe.test.mjs`, and mechanism-probe tests 37/37 after the final regeneration. Whole-plan verification below.
    - **Whole-plan verification** (2026-11-09).
      - Green: `build:core`, `typecheck`, memory-core, the `prefix-stability` test, `work-outcome --offline`, both examples, `docs.test.ts`, `session-turn-overhead` ceilings (`benchmark-session-turn.test.mjs` 3/3), biome on the changed files.
      - Safety (`--suite offline --ontology`, written to a scratch path so `202/safety.json` is untouched): followed 0, leakage 0, deletion 1, and the five ontology probes pass. The verdict reads `fail` only because false-refusal is a live check (`not-run` offline); the base tree gives the identical offline verdict.
      - Not caused here: memory-system 656/29 skip/2 fail and wiki 85/1 fail (all three name the untracked `scripts/retired-names.json`, as in Tasks 6–7); memory-bench 548/3 skip/3 fail before the readiness fix (feature-ledger's 17 plan 210 rows, pre-existing; the readiness binding, fixed above; the markdown-scale write-p50 ratio, below); mechanism probes 7 errors, all plan 210 removals (`recall.supersession-hint`, `write.consolidate-model-decider`, `recall.state-wrapper`, `decisions.P1/P2/P6`, `scoped.policy`), the plan 210 follow-up Task 7 recorded; reference host 64/2 fail (`host_eval_suite_*`, the concurrent `run-controller.ts` edit, as in Tasks 5–7).
      - `release.mjs gate` fails on the kernel size budget: packed +1,238 bytes, unpacked +3,362, from uncommitted `src/` edits (`artifacts.ts`, `state-concurrency-conformance.ts`, `provider-live-scenarios.ts`, `run-controller.ts`) newer than Task 7's green gate. This task changed nothing under `src/`, so the budget was not rebaselined.
      - The markdown-scale `maxWriteP50Ratio` (2.75) is timing-noisy. It failed at 3.50 inside the parallel memory-bench suite and passed 5 of 6 isolated runs (one at 2.85); the base tree passed 4/4. Task 8 does not touch the markdown store (memory-core), so it is recorded as noise (Further Actions).
    - **Baseline diff / sweep.** None: no export moved and no name was retired.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/system test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 900 bun run --cwd <wiki directory from Task 1> test`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline --ontology`
- `timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline`
- `timeout 300 bun test packages/memory/system/src/ltm/__tests__/prefix-stability.test.ts`
- `timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base .cache/memory-bench/216/om-before --base-harness own --out docs/_evidence/memory-bench/216/equivalence.json` (amended in Task 8; base worktree of `37ee1a24`)
- `timeout 900 bun scripts/memory-bench/preservation.mjs --base .cache/memory-bench/216/om-before --equivalence docs/_evidence/memory-bench/216/equivalence.json --out docs/_evidence/memory-bench/216/preservation.json`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 900 bun examples/memory-system.ts` and `timeout 900 bun examples/memory-and-wiki.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (baseline diffs attributed)
- `timeout 300 bunx biome check <changed files>`

## Compromises Made

- **The equivalence base is `OM-before` (`37ee1a24`), not plan 210's slimmed product alone** (P2). That product was never committed by itself. Task 3's change is measured only by its in-tree golden re-pin, not by the cross-tree answer-path comparison.
- **The base runs its own harness** (`--base-harness own`, P2). The package move means the current harness cannot import the base product, so the two trees run different harness bytes. That port (import paths, arm aliases, command names) is assumed not to change requests. The session replay is the one fixture that runs the same script on both products.
- **The `om` and `om+fabric` arm ids and the `MemoryFabric*` type names were kept** (Tasks 4–5, P3), so later runs compare like with like against plan 202/210 evidence. The component names are entry-point aliases only.
- **The release gate was left red on the kernel size budget** (P1). The growth comes from uncommitted concurrent `src/` edits that are outside this plan; rebaselining them here would hide whose change it is.
- **Six C-1 arm families no longer build** (P3). They are retired by named removals (`C1_RETIRED_ABLATIONS`) rather than re-expressed, so plan 210's ablation matrix has 36 fewer jobs.

Recorded in plans/backlog.md.

## Further Actions

- **P1: Bring the release gate back to green.** Attribute the kernel `packedBytes`/`unpackedBytes` growth (+1,238/+3,362) to its plan and either shrink it or rebaseline `budgets.json` `kernel` with a reason.
- **P2: Reconcile the plan 210 leftovers.** The mechanism probes still error on seven removed features, and the feature ledger still has 17 rows for them. Retire them through `dispositions.json` and `ledgerRows()`, as plan 216 Task 7 did for its three.
- **P2: Check `rehearsal.targetTokens >= wm.observationTokens` only when rehearsal is on.** Today a session-only config with `wm.observationTokens` above 20,000 fails to load, although rehearsal is off.
- **P3: Make the markdown-scale write-p50 ratio budget robust.** Measure it in isolation or with more samples; it fails under the parallel memory-bench suite and occasionally alone.
- **P3: Track or remove the untracked `scripts/retired-names.json`.** Three package suites fail on it (`no_workspace_imports_prism_memory_family`, `removed_memory_names_absent_repo_wide`, `retired_wiki_names_absent_repo_wide`).
- **P3: Remove `.cache/memory-bench/216/om-before`** once plan 217 has run its `OM-before` arms. It is the base for every 216 re-attestation until then.

Recorded in plans/backlog.md.
