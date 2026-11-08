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

- [ ] Task 4: Create `@arnilo/prism-memory-system` and move the session tiers into it
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
      - the fabric's imports from `@arnilo/prism-memory-observational` (types, `isMemoryId`, worker limits, recall paging; `packages/memory/fabric/src/types.ts:11-17`) are repointed to the new package's internal paths, or temporarily to its `./session` subpath export, until Task 5 makes them in-package;
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

- [ ] Task 5: Move the fabric into the package as LTM
  - Acceptance Criteria:
    - Amended (2026-11-08, Task 3): `memory.ltm` exists already (`packages/memory/fabric/src/ltm.ts`, `createMemoryLtmPort`; members `scopes`, `scopeId`, `epoch`, `read`, `scanMetadata`, `activity`, `deletions`). It moves unchanged: the wiki pins its store to `scopeId`, so that hash must not change. The `experimental` list today is `memory-core`, `memory-observational`, `memory-fabric`, `wiki`, `rag`. Consider removing core's markdown `reviewEdit` seam, which nothing in memory uses since Task 3.
    - Functional: **Move.**
      - `packages/memory/fabric/src/**` moves to `packages/memory/system/src/ltm/**`.
      - `memoryFabric(config)` becomes the `ltm` component: `memorySystem({ ltm: config })` with the same fields.
      - The `memory.*` tools, `memory` commands, presets, stores, delivery tiers, lifecycle, scopes, team store, exchange archive, lessons and standing rules keep their names and behaviour.
      - `createMemoryFabric` becomes `createLongTermMemory` (direct SDK callers), with no alias.
    - Functional: **Retirement.**
      - `@arnilo/prism-memory-fabric` is retired with no alias: a manifest or host config naming it fails closed with the existing `package_missing` or `import_failed` code (Task 1 finding F1), the migration row exists, and the name joins the retired-name lists in `src/__tests__/docs.test.ts`.
      - The `memory.ltm` service (Task 3) is provided by the new package.
      - The `./session` subpath stopgap from Task 4 is removed: the session and LTM code import each other in-package.
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

- [ ] Task 6: Components, partial-use profiles and fail-closed composition
  - Acceptance Criteria:
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

- [ ] Task 7: Retire LTM working memory, the episode view and episode merge (owner decision 2026-11-08)
  - Acceptance Criteria:
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

- [ ] Task 8: Behaviour-preservation record, cache-pin re-attestation and plan end
  - Acceptance Criteria:
    - Amended (2026-11-08, Task 3): Task 3 changed both presets' `memory.recall` tool schema on purpose (the kinds enum and description no longer name `concept`; the old fabric had the ontology on whenever `semantic` was on). The plan 210 golden was re-pinned and `docs/_evidence/memory-bench/210/slimmed/record.json` carries a `repinned` entry; context blocks are unchanged. The preservation record lists it as an attributed difference, and "byte-identical" for Tasks 4, 5 and 7 is measured against the Task 3 golden.
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
      timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base .cache/memory-bench/210/slimmed --out docs/_evidence/memory-bench/216/equivalence.json
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/216/{preservation,equivalence}.json`, `README.md`;
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
- `timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base .cache/memory-bench/210/slimmed --out docs/_evidence/memory-bench/216/equivalence.json`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 900 bun examples/memory-system.ts` and `timeout 900 bun examples/memory-and-wiki.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (baseline diffs attributed)
- `timeout 300 bunx biome check <changed files>`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
