# Phase 11 Part O16 — Memory feature audit and acceptance: measure, diagnose, justify or remove, then accept once before the freeze

## Objectives

- After every memory plan of the 0.13.0 train is built and screened on development partitions (188.x, 202, 207, 208, 209), audit **every memory feature** and decide, from evidence, whether it stays in the API-level-1 surface that plan 185 freezes. The features are mechanisms, config fields, kinds, tools, commands, workers, delivery tiers and preset contents.
- For each feature with **no measured benefit, a neutral result, or a negative impact**:
  1. **detect mechanism errors**: does it fire, does its effect reach the agent's context or ranking, is the effect what the design says;
  2. **analyse conceptual gaps**: what would have to be true for it to help, and is there a minimal change that could make it useful;
  3. **measure** the fixed variant once where a credible fix exists;
  4. **remove** it when no justification is found: no benefit, no safety role, no cost role, and no credible gap fix.
- Freeze a smaller memory surface whose every remaining feature has a recorded justification. Unmeasured mechanisms do not become permanent API-level-1 obligations.
- Then, on that final product, run the **one held-out acceptance** for every memory claim (plan 202's robustness rows, plan 208's ontology rows, plan 209's work-outcome rows), and set the preset revision, the defaults and the published claims from its verdicts. These were plan 202 Tasks 18–19, plan 208 Tasks 6–7 and plan 209 Task 7 until the owner moved them here on 2026-10-31. *(Moved to plan 223 on 2026-11-08: the final product is now the rebuilt memory system.)*

## Expected Outcome

- `docs/_evidence/memory-bench/210/feature-ledger.json`: one row per feature with its owner package, default, preset membership, cost, the role it claims (accuracy, cost, safety, inspectability, compatibility), its evidence (file and hash) and its status (`benefit`, `neutral`, `negative`, `unmeasured`, `safety-proven`).
- Mechanism probes for every candidate (`scripts/memory-bench/mechanism-probes/`), offline and free, with verdicts `works`, `never-fires`, `no-effect` or `wrong-effect`.
- A gap analysis per candidate with a predicted, measurable effect for each proposed fix.
- `scripts/memory-bench/cleanup-criteria.json`: pre-registered decision rules, committed before the ablation campaign.
- One owner-gated ablation campaign (gate C-1): leave-one-out for preset members, add-one for opt-ins, and fixed variants, on development partitions of the robustness and work-outcome suites. Held-out partitions stay unread until Task 9.
- A decision record, approved by the owner. Removals land with deleted code, config fields, exports, docs and tests; regenerated baselines; a repo-wide sweep; and migration notes.
- A combined non-inferiority check and a product freeze (Task 8). *(Amended 2026-11-08: Task 8 dropped; its offline parts are in Task 7, and the combined check and freeze moved to plan 223 Task 1.)*
- One held-out acceptance under owner gate 3 (Task 9), with one verdict per criterion of `robustness-criteria.json`, `three-tier-criteria.json` and `work-outcome-criteria.json`, all on the frozen product. *(Moved to plan 223 Task 2, 2026-11-08.)*
- `conversational` revision 2 (or the last passing revision), the memory, ontology and working-agent defaults, `scripts/memory-bench/defaults.json`, and every README and `PRODUCT.md` memory claim, in one change (Task 10). The memory surface is handed to plan 184/185. *(Moved to plan 223 Tasks 3–4, 2026-11-08.)*

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 16). **Owner decision 2026-10-31:** an end-of-build audit inside 0.13.0 identifies memory features with no measured benefit or a negative impact, detects mechanism errors, analyses conceptual gaps, and removes what cannot be justified. It runs as release step **17f**, the last plan of a strictly sequential memory train (owner decision 2026-10-31): 202 → 207 → 208 → 209 → **210** → 184 → 185.

- It starts after plan 209 Task 6, when every memory plan has development evidence and has listed its unjustified features for the ledger.
- It ends before plan 184 (cache parity, which measures the final product) and plan 185 (surface freeze).
- **Amended 2026-10-31 by plans 211–212 (host adoption ships in 0.13.0).** When this plan is complete, continue with plan 211 (module skills; its memory skills are written on the surface this plan leaves), then plan 212, then plan 184.
- **Amended 2026-11-01 by plan 202 Task 5.4.6 (owner disposition).** Plan 202 Task 5 (agentic lexical navigation and write-time keyword enrichment) closes on a bounded development screen: `beam-100k`, `locomo`, `memoryagentbench-cr` and a 14-question `beam-1m` slice. The candidate-gap halving rule is the screen's gate and the ability guard is descriptive only. The rest of Task 5's frozen target is handed here: `longmemeval-m`, the full `beam-1m` development cohort and the ability non-regression veto. Tasks 1, 5 and 9 carry it, and none of it may be dropped from this plan without a new owner decision.
- **Plan 202 closure handoff (owner, 2026-11-02).** Plan 202 is closed by disposition with unmet targets preserved, not accepted as passing. Its [complete closure ledger](../docs/_evidence/memory-bench/202/closure.md) is mandatory input to Tasks 1–5. This includes Task 17 residual diagnosis/F4, whether or not a facts preset ships. Development diagnosis precedes the freeze and held-out acceptance; this is not permission to restart a historical campaign.
- **Amended 2026-11-03 (owner decision): hot-path performance fixes land first, as Tasks 0.1–0.3.** A compiled-language (Rust) evaluation on 2026-11-03 rejected a native port. The kernel adds 3–6 ms per run against seconds of model latency, most store CPU is already native (bun:sqlite, JSON, fs), and the measured costs are algorithmic. Two came out of it: the markdown store rewrites three whole files on every write, and the session snapshot re-reads and `structuredClone`s the whole branch on every provider turn. The owner wants both fixed, with a regression gate, before the memory evaluations. They are unrelated to the audit. They are numbered 0.x so every existing "plan 210 Task N" reference (plans 202, 208, 209, the plan index) stays valid. They add no kernel contract, hook, slot or export, so no review task is needed. Both change sources that plan 202's cache-stability pin fingerprints (`src`, `packages/memory/core/src`), so Task 0.3 ends by re-attesting the pin with byte-identical provider requests. Task 1 starts only after that. **Amended 2026-11-07 (Task 0.1 finding):** Task 0.4 was added for a third algorithmic cost, the SQLite (and possibly Postgres) branch read, which is O(depth × session size). It is a store-only change outside the pin's fingerprinted sources. Task 1 starts after Tasks 0.3 and 0.4.
- **Amended 2026-11-04 (owner decision, plan 215): post-0.13.0 memory track.** 0.13.0 no longer waits for this plan. Plan 215 publishes the five memory packages as an experimental prerelease line (`0.13.0-experimental.N`, dist-tag `experimental`) and freezes only the stable surface. This plan runs after plan 209, after 0.13.0 ships. Wherever it says "before plan 184/185", "the freeze", "plan 186" or "plan 187", read: plan 215's cache-parity runner, plan 215's experimental compat classification, and this plan's own graduation (Task 10). Task 11 (memory skills) moved here from plan 211 Task 6.
- **Amended 2026-11-05 (owner request, from plan 208 Task 5's accuracy investigation): recall-quality remediation, Task 3.1.** Plan 208's screen reported low accuracy, and the investigation (`docs/_evidence/memory-bench/208/accuracy-investigation-2026-11-04.json`, counts only) split it into harness defects (fixed in plan 208), small samples, a benchmark ceiling, and a modest memory gap. The memory gap is real and has named causes. They enter this plan as fixed variants the audit already knows how to handle: built behind opt-in tuning fields in Task 3.1, predicted in Task 3's `gap-predictions.json`, measured once in Task 5 (gate C-1), kept or removed in Task 6. No default changes before Task 6. The number 3.1 keeps every existing "plan 210 Task N" reference valid. **Sequencing exception (owner instruction, 2026-11-05):** Task 3.1 was started before plan 209 Task 6, against this plan's own start rule above, because the screen's evidence made the fixes the cheaper next step. Task 3.2 (panel calibration, from the same screen's O3 early read) is added the same day; both are development-only and change no default. *(2026-11-07: the 208 claim bundles were deleted before Task 3.2 ran, so its live calibration moved to the head of Task 5 by owner decision; Task 3.2 closed its offline half.)*
- **Amended 2026-11-08 (owner): observational memory becomes episodic memory, Tasks 7.1–7.6.** A review of the OM package on 2026-11-08 found pass and wiring defects, and the owner redefined the workers' roles:
  - the observer records everything that happens, with verbatim source chunks in a deletable local store, read back through `recall`;
  - the reflector reads a host-set natural-language episode scope and derives episode-relevant facts and retention verdicts;
  - the dropper drops observations by that scope mid-episode and against the whole project at `episode:end`. It converts dropped content to durable facts (promoting project facts to fabric) and is the only code that deletes chunks.
  The package is renamed `@arnilo/prism-memory-episodic`, after a check of Mastra's Observational Memory (Task 7.1). These tasks are the gap fix for the OM workers (Objectives step 3). They run after Task 7 and before the Task 8 freeze, and are measured against Task 5's `OM` rows.
- **Amended 2026-11-08, later the same day (owner): the memory model redesign narrows this plan.** The owner decided to rebuild memory as one system modelled on human memory, and to move the ontology out of memory into the wiki. The design record is [`docs/_evidence/memory-model/design.md`](../docs/_evidence/memory-model/design.md); plans 216–223 implement it after this plan.
  - **Supersedes Tasks 7.1–7.6.** They are dropped. Their requirements carry into plans 216–219 under the new taxonomy, and the "episodic" name now belongs to a long-term memory kind:
    - 7.1, 7.2 → plan 216 Task 4;
    - 7.3 → plan 217;
    - 7.4 → plan 218;
    - 7.5 → plan 219;
    - 7.6 → plans 217–219's fixtures and gates.
  - **This plan keeps** the decisions on what wave 1 measured: long-term memory retrieval and the write side (enrichment, navigation, timeline, grouping, tool affordances, supersession hint, directory) and the plan 202 Task 5 deferred rows. It also keeps the offline inert removals (Task 7).
  - **No further paid runs (owner, 2026-11-08).** Task 5 closes on wave 1, which finished: 64 jobs completed, about 676M input tokens. Waves 2 and 3 are cancelled, not deferred:
    - most of wave 2 measures features plans 220–221 rebuild (the delivery tiers become priming; lessons, standing rules and the work legs become procedural and conditioned memory; `maintain` and the archive exemption become Sleep's forgetting job);
    - the Task 3.1 recall variants in wave 2 stay opt-in and unmeasured (Task 6);
    - wave 3's oracle leg has nothing left to interpret.
  - **Moved out of Task 5.** The redesign replaces these mechanisms, or the ontology is leaving memory, so measuring them here would spend money on code that is about to change:
    - the panel calibration and the evasive-lure residual → plan 222 Task 2;
    - the ontology arms → plan 222 Task 3;
    - the F4 leg and the conditional plan 202 Task 17 arm → plan 219 Task 7;
    - the `OM` reference arm → plan 217 Task 6, where it is the "before" baseline;
    - `om-reflector-loo` and `om-dropper-deterministic` are not run: the workers they ablate are replaced, and plans 218–219 measure their replacements against `OM`.
  - **`transferred` verdicts.** Rows the redesign replaces, or gives the producer they lacked, are excluded from this plan's verdicts and receive the Task 6 verdict `transferred`, naming the plan that decides them (Task 6). The `inertRemoval` list loses the transferred rows (Task 7).
  - **The freeze and the acceptance move.** Task 8 is dropped. Its offline parts (the slimmed product's hash and the readiness cache-stability pin) move into Task 7. Plan 223 Task 1's combined check, with bisection over this plan's removals, replaces its paid check. Plan 223 owns:
    - the product freeze → Task 1;
    - the one held-out acceptance → Task 2;
    - the preset revision, defaults and claims → Task 3;
    - graduation → Task 4;
    - the memory skills → Task 5.

    Tasks 9–11 are dropped here.
  - **Order.** This plan → 216 → 217 → 218 → 219 → 219.1 → 220 → 221 → 222 → 223, strictly sequential.
  - **Retrieval (owner, 2026-11-08, after the retrieval review; design §5.11).** Plan 219.1 rebuilds LTM query recall and measures it at gate M-T.
    - The retrieval rows this plan holds or leaves unmeasured get their final disposition there: `retrieval.strength-priors`, `recall.multi-query`, `recall.unmatched-terms`, `recall.state-grouping`, `navigation.agentic-lexical`, `recall.gather`, `recall.expansion`, `decisions.P5`.
    - Task 7's removals of `timeline`, `write.keyword-enrichment` and `recall.supersession-hint` stand as decided. Plan 219.1's time cue and Rehearsal-written cues are separate mechanisms with their own leave-one-out arms, and reuse none of the removed config fields.
- **Audit before acceptance.** Removals happen on development evidence only, before any held-out item is read. The held-out acceptance then measures the product that ships, so no claim has to be re-pointed and no removal needs a second held-out read.

**Scope:** `memory-observational`, `memory-fabric`, `memory-wiki` and the parts of `memory-core` only they use. *(Amended 2026-11-08: OM, the session-consolidation path and the ontology are transferred to plans 216–222; see the header amendment.)* `memory-rag` (document retrieval, a separate capability the owner keeps outside memory) and `memory-compaction` (measured by plan 194's rot curve) are out of scope; the ledger lists them as excluded with that reason.

**No new kernel contract or package:** the audit primarily removes existing surface. The sole conditional addition authorized by the 2026-11-02 handoff is plan 202 Task 17's already-reviewed opt-in facts preset, only after its residual threshold is measured; its implementation must include the original tests, docs and compatibility-baseline updates. A removal is planned the way a retirement is: baseline regeneration, sweep, and migration note. The preset revision and defaults Task 10 sets are the ones plans 202, 208 and 209 reviewed and specified. **Paid work is owner-gated twice:** C-1 (ablations and the combined check) and gate 3 (held-out acceptance, plus a fresh approval for the one remediation round). *(Amended 2026-11-08: C-1 closed after wave 1; gate 3 moved to plan 223 gate A. This plan has no further paid work.)* Live runs stay on plan 202's providers, never `openrouter/free`. No version bump or publish: every package ships in plan 187's lockstep 0.13.0 publish.

**Release gating** (moved from plan 202 with its Task 18, unchanged):

- 0.13.0 does not wait for a passing verdict.
- One remediation round is allowed. On a miss, the levers and tuning-tier values of plans 202, 207 and 209 may be revised once on development partitions, then every plan's arms are measured once on `heldout-b`.
- A second miss is final. Task 10 ships the last passing revision with claims limited to the criteria that passed.

## Tasks

- [x] Task 0.1: Hot-path baselines — session turn-overhead scenario and markdown write amplification
  - Acceptance Criteria:
    - Functional: `bun scripts/benchmark.mjs --scenario session-turn-overhead` runs one session for 1,000 runs. Each run is 2 provider turns plus 1 tool call with a ~2 KB tool result and reply, on the mock provider. It runs once over `createMemorySessionStore` and once over the SQLite session store (`@arnilo/prism-store-sqlite`, temp file). Per variant it reports:
      - per-run p50/p95;
      - first-20 and last-20 window p50s;
      - `growthRatio` (last-window p50 / first-window p50);
      - `storeEntriesReadPerRun`: entries returned by `readBranchPath`, `list` and `get`, counted by a wrapping store after a 20-run warm-up. This is the deterministic O(history) signal.
    - Functional: `scripts/memory-bench/markdown-scale.mjs` also reports `derivedBytesRewrittenPerUpsert`: the bytes of `.index-files.json`, `log.md` and `index.md` (plus any sidecar Task 0.2 adds) written per single-note upsert, averaged over the 100 write samples. Its existing fields and assertions are unchanged.
    - Functional: The before-fix numbers are recorded in `docs/_evidence/210-task0-hot-paths.md`:
      - the scenario for both stores;
      - `markdown-scale.mjs --notes 1000,10000,50000`;
      - one CPU profile per workload (`bun --cpu-prof`), with the top self-time and inclusive rows.
      The rows to reproduce or refute are the 2026-11-03 measurements:
      - **Markdown 10k:** `writeFileMap` 11.7%, `appendLog` 12.7% (of which `parseLogFile` 4.2%), `regenerateIndex` 7.4%, `findFileById` 1.9%.
      - **Kernel at 1,000 runs:** `structuredClone` 61.6% under `readBranchPath` → `rebuildSessionContextFromReader` → `snapshot` → `buildTurnRequest`; `estimateTextTokensForFamily` 9.3%; `indexEntries` 8.0%.
      - **Kernel growth:** per-run p50 grew from 2.84 ms (first 20 runs) to 11.19 ms (last 20).
      If a profile contradicts the Task 0.2 or 0.3 premise, record the finding and stop before those tasks.
    - Performance: The scenario stays under 60 s on the reference machine. The new gate runs the scenario at a reduced 300 runs. *(Amended 2026-11-07 by the Task 0.1 finding: before the fixes, the 1,000-run memory variant takes 87 s, and the SQLite variant is capped at 150 runs (60 in the gate) by `fixture.sqliteRuns`/`sqliteGateRuns`, because its branch read is O(depth × session size). The 60 s budget is re-checked after Tasks 0.3 and 0.4.)* *(Re-checked 2026-11-07 after Task 0.4: both stores run 1,000 runs in ~12–13 s each, ~25 s in total, and the gate runs 300 runs per store.)*
    - Code Quality: The scenario is a module under `scripts/benchmark-scenarios/` that emits the shared report shape and is registered in `SCENARIOS` (`phase: 210`, `protected: false`). The counting wrapper lives in the scenario; it is not a kernel export.
    - Security: Network-free and credential-free. The report carries `environment.network: false` and `environment.credentials: false`, and no message text.
  - Approach:
    - Documentation Reviewed:
      - `scripts/benchmark.mjs:25` (`SCENARIOS`), `scripts/benchmark-redaction.test.mjs` (gate pattern), `scripts/budget-gates.mjs:26-46` (`checkUpperBound`, `checkCeiling`), `scripts/budgets.json` (`$comment` conventions);
      - `scripts/memory-bench/markdown-scale.mjs:33-92` and `docs/_evidence/memory-markdown-scale-0.13.0.md` (method and the 2026-11-02 numbers);
      - `examples/approval.ts` (mock-provider agent shape), `src/testing/index.ts` (`mockProvider`, `providerToolCall`, `providerTextDelta`, `providerDone`).
    - Options Considered:
      - Gate on absolute per-run milliseconds. Rejected: timing depends on the machine and its load (`budgets.json#startup` `$comment`). `growthRatio` is a same-process ratio, and `storeEntriesReadPerRun` is deterministic.
      - Measure only the memory session store. Rejected: hosts persist through SQLite, Postgres or JSONL, where each re-read entry is also a row decode, so the memory store alone understates the cost.
    - Chosen Approach:
      - Measurement only, with no product code changes. The gate's ceilings are set by the fix tasks once each fix lands, so the tree stays green.
    - API Notes and Examples:
      ```sh
      timeout 300 bun scripts/benchmark.mjs --scenario session-turn-overhead --out docs/_evidence/210-task0/session-turn-overhead.before.json
      timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
      ```
    - Files to Create/Edit:
      - `scripts/benchmark-scenarios/session-turn-overhead.mjs` (new);
      - `scripts/benchmark.mjs`: register the scenario;
      - `scripts/benchmark-session-turn.test.mjs` (new): registration, report schema, network-free, deterministic counter present;
      - `scripts/run-all-tests.mjs`: add the test to `GATE_FILES`;
      - `scripts/budgets.json`: `sessionTurnOverhead` fixture block (runs, gate runs, payload bytes), with no ceilings yet;
      - `scripts/memory-bench/markdown-scale.mjs` and `scripts/memory-bench/run.test.mjs`: the new field and its smoke assertion;
      - `docs/_evidence/210-task0-hot-paths.md` and `docs/_evidence/210-task0/` (new).
    - References:
      - The 2026-11-03 compiled-language evaluation (this plan's header amendment).
  - Test Cases to Write:
    - `session_turn_overhead_scenario_is_registered_and_network_free`.
    - `session_turn_overhead_reports_growth_and_store_reads_for_both_stores`: fails if a variant or field is missing.
    - `markdown_scale_smoke_reports_derived_bytes_rewritten`: extends `markdown_scale_smoke_reports_all_metrics`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — measurement.
    - Docs pages to create/edit:
      - `docs/performance.md`: a `## Session turn overhead (plan 210)` section with the command, fixture and gate file (ceilings added by Task 0.3).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `scripts/benchmark-scenarios/session-turn-overhead.mjs` (new): one session on a scripted network-free provider, with a counting `Proxy` over the store (scenario-local, not a kernel export).
        - The agent sets `limits: { maxInputTokens: null, maxTotalTokens: null }`, because the default 40k input-token cap stops the session at about run 17. The byte caps are untouched.
        - Env overrides: `PRISM_BENCH_RUNS`, `PRISM_BENCH_SQLITE_RUNS`, and `PRISM_BENCH_VARIANTS=memory|sqlite` (one store, for a CPU profile).
      - Registered in `scripts/benchmark.mjs` `SCENARIOS` (`phase: 210`, `protected: false`).
      - `scripts/benchmark-session-turn.test.mjs` (new; both named tests) was added to `GATE_FILES`. It runs about 8 s.
      - `scripts/budgets.json#sessionTurnOverhead.fixture`: `runs` 1000, `gateRuns` 300, `sqliteRuns` 150, `sqliteGateRuns` 60, `window` 20, `warmupRuns` 20, `payloadBytes` 2048. No ceilings yet.
      - `scripts/memory-bench/markdown-scale.mjs`: `derivedBytesRewrittenPerUpsert` added.
        - Each of the 100 writes is bracketed by stats of `.index-files.json`, `log.md`, `index.md` and the future `.index-files.journal.jsonl`.
        - A replaced file counts its whole size; an appended file counts its growth.
        - The existing fields and assertions are unchanged. Its pre-existing compact style was left as is: Biome already flags the file at HEAD.
      - The smoke assertion went into the existing `markdown_scale_smoke_reports_all_metrics` (`scripts/memory-bench/run.test.mjs`).
      - `scripts/cpu-profile-summary.mjs` (new, small): turns a `.cpuprofile` into top self and inclusive rows. Used for the evidence, and reusable by Tasks 0.2 and 0.3 for the after-fix profiles.
      - Evidence: `docs/_evidence/210-task0-hot-paths.md`, plus `docs/_evidence/210-task0/` (scenario JSON, markdown JSONL, three profiles with summaries).
      - Docs: `docs/performance.md` `## Session turn overhead (plan 210)`.
    - Results, before any fix:
      - **Memory store, 1,000 runs:** p50 2.52 ms (first 20) → 163.1 ms (last 20), `growthRatio` 64.8, `storeEntriesReadPerRun` 6,118. All reads are `readBranchPath`.
      - **SQLite, 150 runs:** 3.73 → 484.1 ms, `growthRatio` 129.7.
      - **Markdown:** `derivedBytesRewrittenPerUpsert` is 1.1 MB, 11.4 MB and 57.1 MB at 1k, 10k and 50k notes (≈1.14 KB per stored note per write). Write p95 is 5.2, 35.2 and 247.4 ms.
    - Profiles against the 2026-11-03 rows:
      - **Kernel:** reproduced. `structuredClone` is 57.1% self under `readBranchPath` → `rebuildSessionContextFromReader` → `snapshot` → `buildTurnRequest`/`rebuildHistory`. `estimateTextTokensForFamily` is 16.0%, `indexEntries` 7.1%.
      - **Markdown 10k:** reproduced. `writeFileMap` is 12.8%, `appendLog` 13.3% (`parseLogFile` 7.7%), `regenerateIndex` 7.9%, `findFileById` 1.2%.
      - **Growth:** reproduced in direction, much steeper. The first window matches (2.52 against 2.84 ms), but the last window is 163 ms, not 11.19 ms, because this fixture's 2 KB payloads make each clone heavier. The 2026-11-03 payload was unrecorded.
      - **Residual:** `stringify` (13%) is `jsonBytes` for `maxRequestBytes`, as Task 0.3 already keeps.
    - Findings for later tasks:
      - Neither the Task 0.2 nor the Task 0.3 premise is contradicted, so both proceed.
      - **New defect, so Task 0.4 was added:** the SQLite `readEntryBranch` recursive CTE (`packages/stores/sqlite/src/persistence.ts:536`) steps `current` through `prism_session_entries_session_id_idx` instead of the primary key (`EXPLAIN QUERY PLAN` in the evidence). Each branch read is O(depth × session size): 94.6% of the SQLite profile is `Statement.all`, and per-run time is quadratic (368 ms at run 125).
      - Task 0.3 hides it on a live session, but every cold rebuild still pays it. Postgres has the same CTE shape (`packages/stores/postgres/src/persistence.ts:461`).
      - Task 0.3's "memory store ~4" reference is ~65 on this fixture. Its `growthRatio ≤ 1.5` target stands.
      - Task 0.2's line references have moved: `findFileById` is now `index.ts:300`, `regenerateIndex` `:342`, `appendLog` `:354`, `writeFileMap` `state.ts:76`. Locate them with graft.
    - Checks:
      - `bun test scripts/benchmark-session-turn.test.mjs`: 2 pass.
      - `bun test scripts/memory-bench/run.test.mjs -t markdown_scale`: 1 pass.
      - `bun test scripts/run-all-tests.test.mjs`: pass.
      - `scripts/budget-gate.test.mjs` has 4 failures (export-surface counts, non-null-assertion allowlist, kernel unpacked +46 B). They come from concurrent uncommitted work in the tree, not from this task: no `src/` or package file changed.
      - No export moved, so no baseline diff. No sweep was needed.

- [x] Task 0.2: Markdown store — stop rewriting whole derived files on every write
  - Acceptance Criteria:
    - Functional: A single-note `upsert` or `delete` no longer re-serializes the whole file map. It appends the changed entries to a journal next to the snapshot (`.index-files.journal.jsonl` beside `.index-files.json`). Loading reads the snapshot and replays the journal. The journal is compacted into the snapshot when its op count exceeds `max(1024, map size)`, and on every `reconcile()`/`rebuild()`, so each write is O(1) amortized.
    - Functional: `findFileById` (`packages/memory/core/src/fabric/index.ts:271`) uses an id→path map kept in step with every `fileMap` mutation at `index.ts:360-441`, `:447-496` and `:546-561`. It no longer scans the map.
    - Functional: `appendLog` (`index.ts:325`) keeps the parsed entries in memory, keyed by `log.md`'s `(mtimeMs, size)` after its own write. If the file changed (an external edit or another process), it re-parses as it does today. Rendered `log.md` bytes are unchanged.
    - Functional: `regenerateIndex` (`index.ts:313`) caches each entry's rendered line (the `encodeURI` work). *(Amended 2026-11-07 by the execution finding: the plan also asked to sort with one shared `Intl.Collator` instead of per-call `localeCompare`. In Bun 1.4.4 the collator is ~50% slower, so the sort keeps `localeCompare`.)* `index.md` stays byte-identical to the current `renderIndexFile` (`okf.ts:~325`) for the same entries. The remaining O(n) join and write is recorded as the residual cost.
    - Functional: Fail closed. A torn or unparsable journal line drops the derived map, and the next open does the full reconcile it does today when the index is missing (`index.ts:194-205`). It never trusts a partial map. A journal from a newer format version gets the same treatment.
    - Functional: `packages/memory/fabric/src/okf-bundle.ts:72` `DERIVED_FILES` gains the journal name. Export, import and the OKF bundle never ship it.
    - Performance: Against the same-session Task 0.1 baseline:
      - write p95 at 10k and 50k notes is at most 50% of the baseline;
      - `derivedBytesRewrittenPerUpsert` no longer scales with the file map;
      - cold open, warm open and recall p95 stay within 10% (three-run median).
      `docs/_evidence/memory-markdown-scale-0.13.0.md` is refreshed. Its supported operating envelope changes only if the measurements support the change.
    - Code Quality: All changes stay in `packages/memory/core/src/fabric/{state,index}.ts` (plus `okf.ts` only if a pure render helper is extracted, and the journal file-name constant in `layout.ts` beside `FILE_MAP_FILE`). No new package export, config field or dependency.
    - Security: The journal is written with the same modes as the map (`0o600` file, `0o700` dir) under the existing write lock, through `assertInsideRoot`. It holds paths, ids, hashes and titles, as the map does today, and never note text.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/core/src/fabric/state.ts:44-78` (`atomicWriteFile`, `readFileMap`, `writeFileMap`);
      - `index.ts:185-330` (setup, `findFileById`, `regenerateIndex`, `appendLog`), `:444-566` (reconcile, upsert, delete);
      - `okf.ts:325-400` (index and log renderers);
      - `packages/memory/core/README.md:154-210` (markdown store, `.index-files.json` note at :205);
      - `graft callers writeFileMap` (three callers: `reconcileInternal`, `upsert`, `delete`; single reader at `index.ts:207`).
    - Options Considered:
      - Keep the file map in the SQLite index (`.index.sqlite`). Rejected: `SqliteMemoryStores` (`sqlite/index.ts:53`) exposes no table seam, so this widens memory-core's internal API for one caller. The journal stays inside `state.ts`.
      - Write compact JSON instead of pretty JSON. Rejected: a constant factor; still O(n) per write.
      - Debounce `index.md` and `log.md` to close or idle. Rejected: agents and people read them mid-session, and the files would go stale after a crash.
      - Append to `log.md` instead of rewriting it. Rejected: the format is newest-first with date groups (`okf.ts:355`). Changing it is an OKF output change, out of scope here.
    - Chosen Approach:
      - Journal plus snapshot for the derived map, an id index, a parse cache for the log and a render cache for the index. Every on-disk OKF file stays byte-identical, and only the hidden derived sidecar changes shape.
    - API Notes and Examples:
      ```jsonl
      {"v":1,"op":"set","path":"t/r/facts/x.md","entry":{...IndexedFile}}
      {"v":1,"op":"del","path":"t/r/facts/y.md"}
      ```
    - Files to Create/Edit:
      - `packages/memory/core/src/fabric/state.ts`: journal append, replay, compaction;
      - `packages/memory/core/src/fabric/index.ts`: id index, log cache, index render cache, journal calls;
      - `packages/memory/core/src/fabric/okf.ts`: tentative — only if a per-entry line renderer is extracted (output unchanged);
      - `packages/memory/fabric/src/okf-bundle.ts`: `DERIVED_FILES`;
      - `packages/memory/core/src/__tests__/` (the markdown store suite; locate with `graft grep "createMarkdownMemoryStores" --in packages/memory/core/`);
      - `scripts/budgets.json`: `markdownStore` block (write-amplification ceiling, plus a 2,000-vs-200-note write p50 ratio ceiling) and its gate assertion in `scripts/memory-bench/run.test.mjs`;
      - `packages/memory/core/README.md`, `docs/_evidence/memory-markdown-scale-0.13.0.md`, `docs/_evidence/210-task0-hot-paths.md`, `CHANGELOG.md`.
    - References:
      - Task 0.1 profile.
      - Plan 188.1 (OKF markdown store).
  - Test Cases to Write:
    - `file_map_journal_replays_to_the_same_map`: random upsert, delete and move sequences; journal replay deep-equals the in-memory map; compaction keeps it.
    - `torn_journal_tail_forces_full_reconcile`: truncate the last line; reopen; the map is rebuilt and nothing is mis-indexed.
    - `index_md_and_log_md_bytes_unchanged`: the old and new renderers give equal bytes on a 500-note fixture with Unicode titles and several dirs.
    - `external_log_edit_is_reparsed`: an edit to `log.md` between writes is preserved.
    - `find_file_by_id_tracks_moves_archive_and_delete`.
    - `derived_bytes_per_upsert_do_not_scale_with_notes`: the 200- and 2,000-note stores rewrite the same order of sidecar bytes per upsert; fails on a whole-map rewrite.
    - `okf_bundle_excludes_journal`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API change. On-disk derived sidecars change; canonical OKF files are unchanged.
    - Docs pages to create/edit:
      - `packages/memory/core/README.md`: the derived-files list and the `.index-files.json` sentence at :205;
      - `CHANGELOG.md` `## [Unreleased]`: a performance entry;
      - evidence files above.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `state.ts`: `readFileMap`/`writeFileMap` and the `FileMap` type are replaced by a `FileIndex` class (module-internal; not exported from any package entry).
        - It holds the path → entry `Map`, an id → paths index and a dirty set.
        - `flush()` appends one `{"v":1,"op":"set"|"del",...}` line per dirty path to `.index-files.journal.jsonl`, with `appendFile` at mode `0o600`.
        - `flush({ compact: true })`, or a journal past `max(1024, size)` ops, rewrites the snapshot atomically and then removes the journal. Ops are whole entries, so a crash between the two replays harmlessly.
        - `load()` returns `intact: false` for a torn tail (no final newline), an unparsable line, a bad op or `v ≠ 1`. The map is then empty and the open sets `force`, so it runs the full reconcile.
      - `layout.ts`: the `FILE_MAP_JOURNAL_FILE` constant.
      - `index.ts`:
        - Every `fileMap` mutation goes through `FileIndex`, and `findFileById` uses the id index.
        - Upsert and delete flush; reconcile and rebuild compact.
        - `assertInsideRoot` checks the snapshot and journal paths at open.
        - `appendLog` reuses its last-written entries while `log.md`'s `(mtimeMs, size)` matches its own write, and re-parses otherwise.
        - `regenerateIndex` caches each rendered line in a `WeakMap` keyed by the (immutable) entry object.
      - `okf.ts`: a `renderIndexLine` helper, plus an optional line renderer argument to `renderIndexFile`. The output is byte-identical (tested against the old renderer).
      - `packages/memory/fabric/src/okf-bundle.ts`: `DERIVED_FILES` gains the journal.
      - Measurement: `scripts/memory-bench/markdown-scale.mjs` gains `derivedBytesRewrittenPerUpsertByFile` (additive). `scripts/budgets.json#markdownStore` sets `maxFileMapBytesPerUpsert` 4096 at 2,000 notes and `maxWriteP50Ratio` 2.75 (2,000 vs 200 notes). It is enforced by the new `markdown_store_write_amplification_within_budget` in `scripts/memory-bench/run.test.mjs`, already in `GATE_FILES`.
      - Docs: `packages/memory/core/README.md` (markdown stores, derived files), `docs/performance.md`, `CHANGELOG.md`, `docs/_evidence/memory-markdown-scale-0.13.0.md` (refreshed), `docs/_evidence/210-task0-hot-paths.md` ("Task 0.2" section), and `docs/_evidence/210-task0/` (`markdown-scale.after.jsonl`, `task0.2-paired/`, the after-fix warm-open profile summary).
    - Tests: the seven planned tests, plus `archive_move_by_invalidate_survives_reopen`:
      - in `packages/memory/core/src/fabric/__tests__/markdown.test.ts`: `file_map_journal_replays_to_the_same_map`, `torn_journal_tail_forces_full_reconcile` (torn tail and `v: 2`), `index_md_and_log_md_bytes_unchanged`, `external_log_edit_is_reparsed`, `find_file_by_id_tracks_moves_archive_and_delete`, `derived_bytes_per_upsert_do_not_scale_with_notes`, `archive_move_by_invalidate_survives_reopen`;
      - in `packages/memory/fabric/src/__tests__/okf-bundle.test.ts`: `okf_bundle_excludes_journal`.
    - Results (paired medians, three runs each side, same session; details in the evidence):
      - **Write p95:** 0.46× the baseline at 10k (33.0 → 15.3 ms) and 0.39× at 50k (226 → 89 ms), so ≤ 50% is met. The single final-code run (load average 30) gave 0.42× at 10k and 0.56× at 50k.
      - **File-map bytes per upsert:** a constant 729 B at 1k, 10k and 50k (was ~1.14 KB per stored note), so they no longer scale with the map.
      - **`derivedBytesRewrittenPerUpsert`:** 0.31× in total. It still grows with note count through the whole `index.md` rewrite (~345 B per note), the planned residual. `log.md` stops growing at its 2,000-entry cap.
      - **Cold, warm and recall within 10%: not demonstrated.** The paired runs show warm open +17% at 10k, 50k cold +36% (2 extra passes against 1) and recall p95 +7–19%. Every after-fix run was on a machine at load average 14–30 (concurrent `tsc` and a QEMU VM), and recall does not touch the changed code. An interleaved A/B with HEAD and new sources side by side gave warm open at 1k of 88.5 against 91.3 ms (+3%). At 10k the within-side spread (479–899 ms) swamped any difference. The after-side warm-open profile puts all `FileIndex` work at ≤ 3% of samples. To settle it, re-run the paired command on an idle machine (see Further Actions).
    - Findings for later tasks:
      - **Collator:** `Intl.Collator.compare` is ~50% slower than argument-less `localeCompare` in Bun 1.4.4 (10k strings: 14–17 against 9–13 ms). The criterion is amended above.
      - **Bug fixed on the way:** `invalidate`/`clearInvalidation` moved note files without persisting the file map. A close and reopen after an archive move logged `removed-externally` and **deleted the moved note's index row** (HEAD: 0 rows after reopen; now 1). Both now journal the move, and `archive_move_by_invalidate_survives_reopen` covers it.
      - **Residual:** `regenerateIndex` (sort, join and write of `index.md`) is the main remaining per-write O(n) cost: 19% of the after-side profile. Avoiding it would need per-directory section caching or an OKF output change, which is out of scope here.
    - Checks:
      - `bun test` in `packages/memory/core` (71 pass) and `packages/memory/fabric` (688 pass).
      - `bun test scripts/memory-bench/run.test.mjs` (all pass, including the new gate).
      - `bun run typecheck` clean.
      - `markdown_store_passes_vector_and_working_conformance` hit bun's 5 s default timeout once (5,050 ms) at load average ~21. Alone it runs in 0.5–0.8 s on both HEAD and the fix (three runs each), and the next full-file run passed (31 pass).
      - Biome clean on every touched source and test file. `markdown-scale.mjs` was already flagged at HEAD and is left in its compact style.
      - `scripts/budget-gate.test.mjs` still has the same 4 pre-existing failures recorded in Task 0.1, from concurrent work: kernel packed size, export-surface counts, and `biome.json`/`budgets.json` non-null allowlist rows.
      - No package export moved, so no baseline diff. No retired public name, so no sweep. `readFileMap`/`writeFileMap` were internal, and graft shows no other callers.

- [x] Task 0.3: Session snapshot — extend on own append, revalidate in O(1); regression gate; cache-pin re-attestation
  - Acceptance Criteria:
    - Functional: In `RuntimeAgentSession.appendNow` (`src/agent-session/session.ts:1163`), when a live cache exists for the previous leaf and the store accepted the append with `expectedParentId` equal to that leaf, the cache is extended with one detached copy of the appended entry instead of being invalidated. The extended snapshot gets new `entries`, `messages` and `summaries` arrays, so earlier snapshot values are never mutated. It keeps the original `expiresAt`. *(Amended 2026-11-07 at execution: "live" means same leaf and generation, expired or not. A model turn outlasts the 1 s TTL, so extending only an unexpired cache would rebuild on every real turn. An expired, extended cache is revalidated by the next `snapshot()`, so the staleness bound is unchanged. The appended entry's own `parentId` must also equal that leaf, because the memory store's `expectedParentId` checks existence, not the tip.)*
      Every other path invalidates as today (`session.ts:771`, `:1178`, `assemble.ts:695`):
      - a `compaction` entry;
      - an append that is not on the tip;
      - an append conflict;
      - checkout, fork, resume, or a leaf change.
    - Functional: When the cache expires (TTL > 0) and the store implements `get`, `snapshot()` (`session.ts:1213`) revalidates with one `store.get(currentLeafId)`. If the entry exists, its id, sessionId and ownership metadata match the cached tip, and the session's `entriesInScope` check passes, the cache is renewed. Anything else does the full rebuild it does today. Stores are append-only with whole-session `deleteSession` (`src/contracts-core/session.ts:60-87`), so a branch under a fixed, still-present leaf cannot change.
      - The executor verifies this claim against every first-party store (memory, SQLite, Postgres, JSONL) and records it in the note. Any store that can rewrite an ancestor makes this task stop and re-cut.
      - Stores without `get` fall back to the full rebuild.
      - `snapshotCacheTtlMs: 0` keeps "every `snapshot()` reads the store" exactly.
    - Functional: `estimateTurnUsage` (`src/agent-session/session/provider-round.ts:168`) memoizes each message's family estimate in a `WeakMap` keyed by message object and family. It runs only when a provider reports no usage, and its results are unchanged.
    - Functional: Provider requests are byte-identical before and after this task. Plan 202's cache-stability pin is re-attested on this tree with every request identical, and the comparison base is the pre-Task-0.2 commit:
      - `prefix-probe.mjs --equivalence --base <pre-0.2 worktree>`;
      - then `audit/readiness.mjs --cache-stability`.
      If any request differs, the fix changed behavior: stop and fix it. Never re-pin over a difference.
    - Performance: On `session-turn-overhead`, for both stores:
      - `storeEntriesReadPerRun` after warm-up is ≤ 1 (one revalidation `get` at most per expired TTL);
      - `growthRatio` is ≤ 1.5, against the Task 0.1 baseline (memory store 64.8 on the 2 KB fixture; the "~4" written here before Task 0.1 came from an unrecorded smaller payload). *(Amended 2026-11-07 by the execution finding: not reachable on this fixture. After the fix, 83% of per-run time is `jsonBytes` serializing the whole provider request for `maxRequestBytes`, which this plan keeps as O(request), and the request grows ~4 KB per run. The frozen ceilings are `growthRatio` ≤ 10 (memory, 300 runs) and ≤ 5 (SQLite, 60 runs). Before: 20.2 / 7.6; after: 5.1 / 1.8. The full 1,000-run memory ratio fell from 64.8 to ~27.)*
      `scripts/budgets.json#sessionTurnOverhead` gains these ceilings and a non-flaky p95 sanity ceiling, enforced by `scripts/benchmark-session-turn.test.mjs`. The markdown ceilings come from Task 0.2. If the kernel's packed size crosses `budgets.json#kernel`, it is rebaselined per `docs/release.md:64-76` with a dated reason.
    - Code Quality: Kernel-only change in `src/agent-session/` (the cache is kernel session state, so no package can own it). No new hook, slot, export or config field. `snapshotCacheTtlMs` validation and constants are unchanged. `bun scripts/release.mjs gate` shows no compat-baseline diff.
    - Security: Ownership scoping is unchanged. The scope check at `session.ts:655` still sees a snapshot that was revalidated or rebuilt within the TTL. A deleted or foreign-scope session is detected at the first revalidation, as today within one TTL. `docs/host-security.md:152` is reworded to the new guarantee: "revalidated against the store at most every TTL; extended only by the session's own CAS-accepted appends".
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts:648-657, 776-779, 825-830, 1150-1240` (run entry, `messages`, `branchReader`, append, invalidation, `snapshot`, TTL resolution);
      - `src/session-stores.ts:86-175, 255-320, 559` (`readBranchFromReader`, `snapshotFromBranch` compaction handling, memory store `readBranchPath` clone, `indexEntries`);
      - `src/agent-session/session/assemble.ts:408-420, 695`; `provider-round.ts:123-180`; `src/models/estimate.ts:48`; `src/usage-estimation.ts:70`;
      - `src/testing/store-conformance.ts:69-170` (`expectedParentId` conflict rules);
      - `docs/host-security.md:152`, `docs/agent.md:354`, plan 070 Task 18 (TTL origin: default 1000, `0` = always rebuild, cap 30000);
      - `scripts/memory-bench/README.md` "Cache-stability pin" and `prefix-probe.mjs:459, 514` (fingerprints `src` and `packages/memory/core/src`).
    - Options Considered:
      - Make store reads cheaper, for example by dropping the clone in the memory store's `readBranchPath`. Rejected: SQLite, Postgres and JSONL still decode O(history) rows per turn, and the detachment is a documented safety property.
      - Extend the cache and also refresh `expiresAt` on each own append. Rejected: in a long run the cache would never expire, which weakens the host-security staleness bound against an external `deleteSession`.
      - Raise the default TTL. Rejected: model turns last longer than any reasonable TTL, so real runs would still rebuild every turn, and the staleness bound would get worse.
      - Skip `jsonBytes` (`helpers.ts:147`, 6.9%). Kept as is: it measures the provider request, which is O(request) by nature and is serialized for the wire anyway.
    - Chosen Approach:
      - Extend the cache on the session's own appends and revalidate with one `get` on expiry. Cost per turn becomes O(1) store reads, while the documented staleness bound and the `0` semantics are preserved.
    - API Notes and Examples:
      ```ts
      // no public change; internal shape
      this.snapshotCache = { leafId, generation, expiresAt, value: extendSnapshot(cached.value, detached) };
      ```
    - Files to Create/Edit:
      - `src/agent-session/session.ts`: extension, revalidation;
      - `src/session-stores.ts`: export-internal `extendSnapshot` helper next to `snapshotFromBranch` (not re-exported from `src/index.ts`);
      - `src/agent-session/session/provider-round.ts`: estimate memo;
      - `src/__tests__/` session suites (locate the TTL tests with `graft grep "snapshotCacheTtlMs" --in src/`);
      - `scripts/budgets.json`, `scripts/benchmark-session-turn.test.mjs`: ceilings;
      - `docs/host-security.md`, `docs/performance.md`, `CHANGELOG.md`;
      - `docs/_evidence/210-task0-hot-paths.md` (after numbers) and `docs/_evidence/memory-bench/202/cache-stability/{equivalence.json,record.json}` (re-attested).
    - References:
      - Task 0.1 profile; plan 070 Task 18; plan 202 Task 4.15.
  - Test Cases to Write:
    - `own_appends_extend_snapshot_without_store_reads`: a counting store reads zero entries across 50 turns within the TTL.
    - `incremental_snapshot_equals_full_rebuild`: randomized sequences of message, summary, tool, `suspended_run` and compaction entries, checkout, fork and resume; after every step the cached snapshot deep-equals a fresh `rebuildSessionContext`.
    - `earlier_snapshot_values_are_not_mutated_by_extension`.
    - `expired_cache_revalidates_with_one_get`: an injected clock or TTL of 1 ms; `get` is called once and `readBranchPath`/`list` are not.
    - `deleted_session_is_detected_at_revalidation`: another handle runs `deleteSession`; the next expired `snapshot()` rebuilds and fails as it does today.
    - `store_without_get_falls_back_to_full_rebuild`.
    - `ttl_zero_still_reads_every_snapshot`: the existing plan 070 assertion is kept.
    - `append_conflict_invalidates_snapshot`.
    - `estimate_turn_usage_memo_matches_uncached`.
    - `session_turn_overhead_within_frozen_ceilings`: the gate.
    - Plus the existing `storeConformance` suites and `apps/prism-agent` tests, unchanged and green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API change. Snapshot cache freshness semantics are reworded (security page).
    - Docs pages to create/edit:
      - `docs/host-security.md:152`: the new guarantee;
      - `docs/performance.md`: ceilings and recorded numbers;
      - `CHANGELOG.md` `## [Unreleased]`;
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `src/session-stores.ts`:
        - `extendSnapshot(snapshot, entry)` is a module export that `src/index.ts` does not re-export.
        - It returns a new snapshot with new arrays, or `undefined` when the result could differ from a rebuild: a `compaction` entry, a `parentId` other than the snapshot's leaf, or a snapshot whose tail is not past its newest compaction's `throughEntryId`. The caller then rebuilds.
        - `snapshotFromBranch` marks the snapshots that can be extended in a module `WeakSet`, so the check is O(1).
      - `src/agent-session/session.ts`:
        - `appendNow`: an append conflict, or any store throw, now invalidates the cache before rethrowing. After a successful append, it extends the cache with `structuredClone(redacted)` when the cache matches the previous leaf and generation, the TTL is > 0 and `extendSnapshot` accepts. It keeps `expiresAt` and bumps the generation, so the meter cache still sees a mutation. Every other append invalidates as before.
        - `snapshot()`: an expired cache for the same leaf and generation calls the new `revalidateSnapshot`. That makes one `store.get(tip)` and requires the same id, `sessionId`, `parentId` and ownership stamps, plus `entriesInScope` on the session scope. On success the cache is renewed for one TTL, unless an append or checkout replaced it during the `get`.
        - TTL `0`, a store without `get`, or any mismatch rebuilds as before.
      - `src/agent-session/session/provider-round.ts`: `estimateTurnUsage` uses `estimateMessagesMemoized`. It memoizes each message's integer share (per-message overhead plus its text estimate) in a `WeakMap` per model id. The sum is the same integer.
      - `src/contracts-core/agent.ts`: the `snapshotCacheTtlMs` TSDoc no longer says the cache is "always invalidated by a new leaf or a mutation". The type is unchanged.
      - Tests:
        - `src/__tests__/session-snapshot-cache.test.ts` (new): the nine planned unit tests.
          - `incremental_snapshot_equals_full_rebuild` runs 400 seeded steps over up to four sessions, mixing message, tool, summary, `suspended_run`, label and compaction entries with checkout, fork and resume.
          - It was mutation-checked: dropping summaries from the extension makes it fail.
        - `scripts/benchmark-session-turn.test.mjs` gains `session_turn_overhead_within_frozen_ceilings`. It shares one gate-sized scenario run with the schema test, whose `storeEntriesReadPerRun > 0` check became `>= 0`.
        - `src/__tests__/agents.test.ts` "caches one stable leaf snapshot…": the second run now reads 3, not 4. Own appends no longer re-read.
      - `scripts/budgets.json`:
        - `sessionTurnOverhead.ceilings`: `maxStoreEntriesReadPerRun` 1, `maxGrowthRatio` `{memory: 10, sqlite: 5}`, `maxP95Ms` 30 (scaled by `wallClockBudget`).
        - `kernel.packedBytes`/`unpackedBytes`/`sourceLines` rebaselined to 1217530 / 3960004 / 40523, +2867 / +8313 / +109 over plan 215 Task 15, with a dated reason.
      - `scripts/memory-bench/equivalence-preload.mjs`: `randomUUID` calls from memory-core's `atomicWriteFile` (temp-file names) get their own counter. See the finding below.
      - Docs:
        - `docs/host-security.md:152` gets the new guarantee.
        - `docs/performance.md` "Session turn overhead" gets the ceilings and after numbers.
        - `CHANGELOG.md` `[Unreleased]`.
      - Evidence:
        - `docs/_evidence/210-task0-hot-paths.md`, "Task 0.3" section.
        - `docs/_evidence/210-task0/session-turn-overhead.after.json`, `task0.3-gate-paired/` (three interleaved before/after runs at gate counts) and `profiles/kernel-memory.after.summary.json`.
        - `docs/_evidence/memory-bench/202/cache-stability/{equivalence.json,record.json}` (re-attested).
    - Append-only check (every first-party store): no first-party store rewrites an ancestor, so the task did not stop.
      - Memory: append-only `add`; `deleteSession` removes the whole session.
      - SQLite: the only `DELETE FROM prism_session_entries` statements are whole-session (`persistence.ts` `deleteSession`, `lifecycle.ts` purge), and no `UPDATE` touches entries.
      - Postgres: only `deleteSession`'s whole-session `DELETE`.
      - JSONL: `appendFile`; `deleteSession` unlinks the session file.
    - Results:
      - **Store reads:** `storeEntriesReadPerRun` is 0 for both stores (was 6,118 memory at 1,000 runs, and 1,918 / 478 at gate counts). Over 1,000 runs the store sees 1 `readBranchPath` and 12–13 revalidation `get`s.
      - **Full scenario:** the 1,000-run memory variant takes 12.5–13.6 s (was 87 s), inside the 60 s budget. Last-20 p50 is 26–29 ms (was 163 ms), and `growthRatio` is 25–28 (was 64.8).
      - **Gate counts** (interleaved medians, before → after): memory total 7.2 s → 0.97 s, p95 46 → 6.2 ms, `growthRatio` 20.2 → 5.1. SQLite `growthRatio` 7.6 → 1.8, p95 57 → 2.2 ms.
    - Findings:
      - **`growthRatio` ≤ 1.5 is not reachable** (the criterion is amended above). In the after-fix profile, `structuredClone` falls from 57.1% to 0.9%, and 82.9% inclusive is `jsonBytes` → `stringify` of the whole provider request. That is O(request), which this task keeps.
      - **Equivalence first reported every request different, but the cause was the harness.**
        - The kept request text showed only memory note ids and session ids differing (pinned counter `…1233` against `…1050`). The same result appeared with the Task 0.3 sources reverted, so Task 0.2 caused the shift.
        - Mechanism: the preload pins `randomUUID` to one global counter, and `atomicWriteFile` (`packages/memory/core/src/fabric/state.ts:44`) names temp files with it. Task 0.2 writes far fewer whole snapshot files, so every later id shifted.
        - Fix: the harness, not a re-pin. Temp-file names draw from a separate counter. Afterwards all 54 requests across `preset-r1` and `passive-only` were identical against `a4e09001`, the pre-Task-0.2 commit. `readiness.mjs --cache-stability` passed: 29 tests, equivalence identical.
        - The base worktree is kept at `.cache/memory-bench/202/cache-stability-base`.
      - **SQLite parity:** an extended snapshot and a SQLite `list()` rebuild are JSON-identical. They differ only in `undefined`-valued keys (SQLite drops some on messages and adds empty columns), already the case between stores and not read anywhere in the kernel.
      - For Task 0.4: a live session no longer reads its branch, so the quadratic SQLite CTE now shows only on a cold open or rebuild. The SQLite gate variant is already flat (`growthRatio` 1.8), so Task 0.4 needs its own cold-read test (`branch_read_cost_is_linear_in_depth`), as planned.
    - Checks:
      - `bun test src/__tests__/session-snapshot-cache.test.ts`: 9 pass.
      - `bun test scripts/benchmark-session-turn.test.mjs`: 3 pass.
      - `bun test src/__tests__/agents.test.ts`: 86 pass.
      - `bun test` in `packages/stores/{sqlite,jsonl,postgres}` (45, 43 and 12 pass; Postgres live tests gated) and `apps/prism-agent` (61 pass).
      - `bun test scripts/memory-bench/prefix-probe.test.mjs`: 5 pass.
      - `bun run typecheck` clean.
      - `bun test src/__tests__`: 12 failures, all in suites this task does not touch (packaging, browser tools, wiki retirement, network-free guard, host surface, codemod, field-policy microbenchmark under load). The same failures were present before the change.
      - `bun scripts/release.mjs gate`: no kernel compat-baseline diff. It still reports the pre-existing `rootExports` 1520 against 1519 (plan 215 Task 15 already records it) and Task 0.2's experimental memory-core note.
      - `scripts/budget-gate.test.mjs`: the same 4 pre-existing failures. After this task's rebaseline, its kernel row fails only on `rootExports`.
      - Biome: the new test file is clean. The touched kernel files carry the same format and import-order findings they had at HEAD, left as is.
      - No export moved and no name retired, so no baseline diff and no sweep.

- [x] Task 0.4: SQLite and Postgres branch read — walk ancestors by primary key (added 2026-11-07 from the Task 0.1 finding)
  - Acceptance Criteria:
    - Functional: The recursive CTE in `readEntryBranch` (`packages/stores/sqlite/src/persistence.ts:536`) looks each ancestor up by primary key. `EXPLAIN QUERY PLAN` shows `SEARCH ... USING INDEX sqlite_autoindex_prism_session_entries_1 (id=?)` (or the rowid equivalent) in the recursive step, and no full `SCAN` of `prism_session_entries` for the final select. Returned entries, order, paging (`limit`, `cursor`) and the ownership filter are unchanged.
    - Functional: The Postgres store's branch CTE (`packages/stores/postgres/src/persistence.ts:461`, and the `branchSql` at `:898`) is checked with `EXPLAIN` on a protected run and gets the same fix if its plan has the same shape. The result is recorded either way. *(Executed 2026-11-07: the SQLite `queryEntries({ leafId })` CTE (`persistence.ts:872`) had the same recursive step and got the same fix. Postgres was checked on a local PostgreSQL 18.6 instead of a protected CI run. Its plan does not have the shape, so it is unchanged; see the note.)*
    - Functional: `storeConformance` stays green for both stores.
    - Performance: On `session-turn-overhead`, the SQLite variant's per-run time is linear in history before Task 0.3, or flat after it. `budgets.json#sessionTurnOverhead.fixture.sqliteRuns`/`sqliteGateRuns` are removed, so SQLite runs the full `runs`/`gateRuns`, and the scenario's 60 s budget is re-checked. *(Amended 2026-11-07 at execution: at 300 gate runs, not 60, the SQLite `growthRatio` is 5.5–8.2, from the same `jsonBytes` request growth as memory (entries read per run 0). So `ceilings.maxGrowthRatio.sqlite` moves from 5 to memory's 10.)*
    - Code Quality: Store-only change. No schema migration unless an index is genuinely missing, in which case use the store's existing DDL upgrade path. No new export.
    - Security: The ownership clause still applies to the seed row. Fail-closed paging validation is unchanged.
  - Approach:
    - Documentation Reviewed: `docs/_evidence/210-task0-hot-paths.md` (query plan, quadratic per-run times), `packages/stores/sqlite/src/ddl.ts:70-90`.
    - Chosen Approach: make the recursive step join `prism_session_entries` by `id` first (for example by disqualifying the `session_id` index on `current` with `+current.session_id`, or by joining `parent` straight from `bp` via a `parent_id` carried in the CTE). Then filter the session on the primary-key row and select the final rows by `id` from the CTE. Pick the smallest variant that the planner provably honours.
    - Files to Create/Edit: the two `persistence.ts` files, their store test suites (a plan-shape test plus a 2,000-entry branch-read timing ratio test), `scripts/budgets.json`, `scripts/benchmark-scenarios/session-turn-overhead.mjs` (drop `SQLITE_RUNS`), `docs/performance.md`, `docs/_evidence/210-task0-hot-paths.md`, `CHANGELOG.md`.
  - Test Cases to Write:
    - `branch_read_query_plan_uses_primary_key`.
    - `branch_read_cost_is_linear_in_depth`: 200- against 2,000-entry sessions, read time ratio ≤ ~15, where quadratic is ~100.
    - `branch_read_results_unchanged`: paging, forks and ownership scope, against today's output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/performance.md`, the `CHANGELOG.md` `## [Unreleased]` performance entry, and the evidence file.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `packages/stores/sqlite/src/persistence.ts`:
        - `readEntryBranch`: the recursive CTE carries `parent_id` and joins `parent ON parent.id = bp.parent_id` with `WHERE +parent.session_id = ?`. The unary `+` keeps the planner off the `(session_id, id)` index. The final select is `branch_path bp CROSS JOIN prism_session_entries e`, so it is driven from the path.
        - The `queryEntries({ leafId })` branch CTE got the same recursive step. Its final select is keyset-paged by timestamp with the other filters, so it was left as is.
        - The old query required every ancestor to be in the requested session; `+parent.session_id = ?` keeps that. The seed still needs `session_id = ?` and the ownership `EXISTS`.
        - No schema, index, export or validation change.
      - Tests (`packages/stores/sqlite/src/__tests__/sqlite-persistence.test.ts`):
        - `branch_read_query_plan_uses_primary_key`: `EXPLAIN QUERY PLAN` of the SQL both reads actually prepare. The recursive step must `SEARCH parent USING INDEX sqlite_autoindex_prism_session_entries_1 (id=?)` and must not use the `session_id` index. The branch read's final select must `SEARCH e` by primary key, with no `SCAN e`.
        - `branch_read_cost_is_linear_in_depth`: median of 5 cold reads at 200 and 2,000 entries, ratio ≤ 15.
        - `branch_read_results_unchanged`: the pre-task SQL is kept verbatim as the reference. It covers a trunk with two forks, equal-timestamp id tiebreaks, a cross-session parent, a foreign session, a missing leaf, full reads and every page at limits 1/3/5, `queryEntries({ leafId })` membership, and the ownership scope on the seed (match, wrong tenant, wrong user).
        - Mutation check: with the old CTE restored, the plan test and the linear test fail (13.2 → 1,353.9 ms), and the results test passes.
      - `scripts/benchmark-scenarios/session-turn-overhead.mjs`: `SQLITE_RUNS`, `PRISM_BENCH_SQLITE_RUNS` and the report's `fixture.sqliteRuns` are removed. Both stores run `RUNS`.
      - `scripts/benchmark-session-turn.test.mjs`: no longer passes `PRISM_BENCH_SQLITE_RUNS`.
      - `scripts/budgets.json#sessionTurnOverhead`: `fixture.sqliteRuns`/`sqliteGateRuns` are removed, and `ceilings.maxGrowthRatio.sqlite` is 5 → 10, with a dated reason in `$comment`.
      - Docs: `docs/performance.md` "Session turn overhead", the `CHANGELOG.md` `[Unreleased]` entry, `docs/_evidence/210-task0-hot-paths.md` ("Task 0.4" section), plus `docs/_evidence/210-task0/session-turn-overhead.task0.4.json` and `task0.4-gate/run{1,2,3}.json`.
    - Results:
      - Cold full-branch read, one-session chain, mean of 5: 200 entries 9.86 → 0.55 ms; 2,000 entries 1,317.8 → 5.76 ms. The 2,000/200 ratio is ~134 (quadratic) before and ~10.5 (linear) after.
      - Full scenario, 1,000 runs per store, load average ~4: memory 12.9 s, SQLite 11.9 s (~25 s together, inside 60 s). SQLite `growthRatio` is 27.9 against memory's 26.2, and entries read per run are 0.01 for both.
      - Gate, 300 runs, three runs: SQLite `growthRatio` 5.5 / 8.2 / 6.1 (memory 5.0 / 5.9 / 3.4), p95 7.2–8.1 ms.
    - Findings:
      - **Postgres has no defect, so it is unchanged.** Checked with `EXPLAIN (ANALYZE)` on a throwaway local PostgreSQL 18.6, in two layouts: depth 2,000 alone in the table, and depth 1,000 beside 50,000 rows in 500 other sessions.
        - The old recursive step is already `Index Scan using prism_session_entries_session_id_idx` with `Index Cond: (session_id = $3 AND id = bp.id)`, 1 row per loop, plus a `pkey` lookup for the parent. That is a point lookup, not a session scan.
        - With other sessions present, the final select is a `pkey` nested loop.
        - Old 5.9 / 3.3 ms against the rewrite's 3.7 / 2.5 ms: linear either way. Not worth an untested-in-CI query change.
        - The protected Postgres CI run is not needed for this verdict. The live suites (42 skipped without `PRISM_TEST_POSTGRES_URL`) were not run, because the Postgres code did not change.
      - The SQLite growth ceiling of 5 came from 60 runs. At 300 runs the residual `jsonBytes` growth matches memory, hence the change.
    - Checks:
      - `bun test` in `packages/stores/sqlite`: 48 pass, including `storeConformance` and the three new tests. `packages/stores/postgres`: 12 pass, 42 live skipped.
      - `bun test scripts/benchmark-session-turn.test.mjs`: 3 pass.
      - `apps/prism-agent`: 62 pass.
      - `bun run typecheck` clean.
      - `scripts/budget-gate.test.mjs`: the same 4 pre-existing failures as Tasks 0.1–0.3.
      - Biome: the changed test file is clean. `persistence.ts` still has its pre-existing import-order finding, which is also present at HEAD.
      - No export moved and nothing was renamed or retired, so there is no baseline diff and no sweep. The `PRISM_BENCH_SQLITE_RUNS`/`sqliteRuns` grep over `src/ packages/ apps/ scripts/ docs/` (excluding `_evidence`) is empty.

- [x] Task 1: The feature ledger
  - Acceptance Criteria:
    - Functional: The ledger has one row per feature. The minimum list, to be completed from the code and the READMEs' config stability tables:
      - **fabric retrieval and ranking:** lexical retrieval; `retrieval: "hybrid"` (kept by 188.11 for compatibility only); scope priors; storage strength S and ACT-R retrieval strength R priors; per-kind decay; `similar` links; the `linker` and `evolution` workers; recall kind hints; multi-query `queries`; `unmatchedTerms`;
      - **write path:** default consolidation (same-text update, Dice similarity); `consolidate.decider: "model"`; session consolidation and its extractor; OM promotion; exchange archive; keyword enrichment (202 Task 5); timeline (202 Task 6); state grouping (202 Task 7); facts preset (202 Task 17, if shipped); `exchanges.steps` (209);
      - **lifecycle:** use-based verification; archive with revival; capacity budgets, merging and eviction; episode merge (model call); widening to `agent` and narrowing; `memory:maintain`;
      - **scopes:** `user`, `project`, `path`, `agent`, `team`; shadowing by key;
      - **delivery:** passive semantic tail; precision filter (202 Task 8); memory directory; pinned core or standing rules (209); path cues; team store and `memory:share`; decision-model points P1–P7 (202 Task 12);
      - **kinds:** `working`, `episode` view, `fact`, `preference`, `procedure`, `decision`, `file`, `exchange`, `concept`; lessons (209);
      - **ontology tier (207):** subject binding (deterministic and extractor), the curator pass and each trigger policy, concept prior, passive pointer, concept sharing, claim lint, source ingest;
      - **OM:** observer, reflector, dropper policies, task state, OM compaction, the `recall` tool, the pinned context mode;
      - **presets:** `conversational` (each component), `coding` (each component);
      - **inspectability and safety:** OKF markdown files, export and import, trust scan, redaction, deletion cascade, provenance, legal holds.
    - Functional: Each row records:
      - its default and preset membership;
      - its per-unit cost (calls, writes, tokens);
      - its claimed role, one or more of accuracy, cost, latency, safety, inspectability or compatibility;
      - its evidence: every evidence file under `docs/_evidence/memory-bench/` that measured it (development partitions; no held-out read exists yet), with the effect, CI and hash;
      - its status.
      A feature whose claimed role is safety or inspectability is `safety-proven` only when a named test proves the property. Otherwise it is `unmeasured`.
    - Functional: **Plan 202 Task 5 hand-off (2026-11-01).** The keyword-enrichment and agentic-navigation rows cite the Task 5 development-screen verdict (`docs/_evidence/memory-bench/202/task5/`, screen manifest and gate 15) as evidence for the screened suites only. On `longmemeval-m` and the full `beam-1m` cohort their status is `unmeasured`, whatever the screen returned, so both rows are always Task 2–5 candidates. Each row also records `deferredFrom: "202-task5.4.6"` and the full ten-cell manifest hash.
    - Functional: **Plan 202 closure inventory (2026-11-02).** Import every source-task row of `docs/_evidence/memory-bench/202/closure.md`, with evidence hashes, `deferredFrom`, development target, limitation and owning task. Preserve Task 4 `baselineComplete: false` and Task 5 screen `miss`; missing evidence is `unmeasured`, and a miss alone is not proof of a statistically negative feature. Tasks 6–12 and the live/model-answer limits of Tasks 14–16 are mandatory candidates where benefit is unmeasured. Record unbuilt Tasks 13/17 as deferred-lever dispositions, separate from installed-feature removal rows. Task 17/F4 must be present even when no facts preset exists.
    - Functional: **Candidates** are rows with status `neutral`, `negative` or `unmeasured`, including every feature plans 202, 208 and 209 listed at their plan end. The ledger is committed before Task 2.
    - Performance: Built offline from code, READMEs and evidence files.
    - Code Quality: `scripts/memory-bench/feature-ledger.mjs` builds it from the config schemas the stability tables are tested against (`stability.test.ts` sources, plus the wiki package's `config`) and a hand-maintained mechanism list (`feature-ledger-features.mjs`). A test fails if a config field, kind, tool or command is missing from the ledger. *(Amended at execution: tools and commands are covered too, read from source.)*
    - Security: No note text; evidence references only.
  - Approach:
    - Documentation Reviewed:
      - fabric README (`## Config`, `### Config stability`, `## Compatibility`, `### Known limitations`), OM README, wiki README;
      - `docs/_evidence/memory-bench/{188.*,202,207,208,209}/`;
      - `scripts/memory-bench/defaults.json`;
      - plans 188.4–188.6 (lifecycle claims), 188.7 findings F3–F12.
    - Options Considered:
      - Audit only features named as "experimental". Rejected: most of the lifecycle has never shown task benefit (the fabric README says so), whatever its label.
    - Chosen Approach:
      - An exhaustive, test-enforced ledger.
    - API Notes and Examples:
      ```sh
      timeout 120 bun scripts/memory-bench/feature-ledger.mjs --out docs/_evidence/memory-bench/210/feature-ledger.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/feature-ledger.mjs`, `feature-ledger-features.mjs` (the hand-maintained rows) and `feature-ledger.test.mjs` (new);
      - `docs/_evidence/memory-bench/210/{feature-ledger.json,README.md}` (new).
    - References:
      - Plans 188.11 Task 6, 202, 207–209.
  - Test Cases to Write:
    - `ledger_covers_every_config_field_kind_tool_and_command`.
    - `safety_proven_requires_a_named_passing_test`.
    - `ledger_carries_every_202_closure_row_and_unbuilt_facts`: fails if a source-task row, unresolved F4 or deferred Task 17 is omitted, or an unmeasured stage is treated as a measured zero.
    - `ledger_marks_202_task5_deferred_suites_unmeasured`: fails if the enrichment or navigation row is not a candidate, or claims a status on `longmemeval-m` or full `beam-1m` from the screen.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `scripts/memory-bench/feature-ledger.mjs` (new): the builder. It reads, rather than restates:
        - the fabric, OM and wiki config schemas (every property path, walking `anyOf`/`oneOf`);
        - the `MemoryNoteKind` union;
        - tool and command names from source;
        - preset membership from `presetFields()`;
        - defaults from `scripts/memory-bench/defaults.json`;
        - a sha256 for every evidence file.
      - Builder modes: `--out` (write the ledger), `--check` (the committed file equals a fresh build) and `--verify-tests` (runs each named test with `bun test ./<file> -t <name>$`).
      - `scripts/memory-bench/feature-ledger-features.mjs` (new): the hand-maintained rows, plus the plan 202 closure inventory, the plan 208/209 hand-offs, and the open 188.7 findings and 188.11 limitations, each mapped to its owning rows.
      - `scripts/memory-bench/feature-ledger.test.mjs` (new): the four named tests plus `every_open_handoff_finding_and_limitation_has_an_owning_row` and `ledger_is_text_free_and_committed_copy_is_current`. Each guard is proven by feeding the builder an altered row list, which must fail with a named problem.
      - `docs/_evidence/memory-bench/210/feature-ledger.json` and `README.md` (new).
    - Result:
      - The ledger has 108 features and covers 220 config paths (fabric, OM and wiki), 9 kinds, 8 tools and 18 commands.
      - Status counts:
        - `benefit` 4: exchange archive, `exchange` kind, `conversational` preset, agent read tools;
        - `neutral` 3: `recall.supersessionHint`, OM promotion, the wiki co-read trigger;
        - `negative` 0;
        - `unmeasured` 87;
        - `safety-proven` 14.
      - **90 candidates** in all. The ledger also lists:
        - the open live/model-answer measurements of 202 Tasks 14–16;
        - the deferred levers 202 Task 13 and Task 17. They are kept apart from the installed-feature rows.
      - `--verify-tests` ran all 37 named tests, and all 37 passed.
    - Findings that affect later tasks:
      - **Every `benefit` row rests on LongMemEval-S only.** The evidence is 188.9 held-out v2 (exchange archive, confounded with that plan's delivery change) and 188.10 held-out v3 (the read tools and the preset). These are earlier plans' partitions; no plan 210 held-out partition was read.
      - **No row is `negative`.**
        - The 202 Task 5 screen `miss` has no paired CI that excludes zero, so enrichment and navigation are `unmeasured` overall, `neutral` per screened suite, and `unmeasured` on LongMemEval-M, full BEAM-1M and MemoryAgentBench-CR. This follows the closure rule that a miss is not proof of a negative feature.
        - Plan 202 Task 5.7 had pre-labelled these rows `negative`/`miss`. The ledger keeps the `miss` as the preserved screen verdict instead.
      - **Leads for Task 2** (mechanisms that may never fire):
        - `lifecycle.verification`: verified share 0 in every offline lifecycle arm of 202 Task 16;
        - `delivery.weak-tool-caller`: the two-turn trigger cannot fire in one-question sessions.
      - **`om.commands` and `fabric.toggle-status` have no named test for their inspectability role,** so they are `unmeasured`. Task 2 should name or add one.
      - **Hash mismatch.** Plan 202 Task 5.7 cites the manifest hash prefix `a19a5ab7…`, which matches neither the manifest's `manifestHash` (`461167af…47fe`) nor its file sha256 (`2cbb2f82…22c9`). The ledger records the values read from the file (10 cells).
      - **Task 17 / F4 flags.** "All 14 Task 17 cell flags `measured: false`" is now computed: 10 decisions in the accepted screen's `summary.json` plus 4 in `failure-attribution.json`, all unmeasured.
      - **Rule for later edits.** The ledger is generated, so editing any cited evidence file makes `ledger_is_text_free_and_committed_copy_is_current` fail until `--out` is re-run. Tasks 2–6 should re-run `--out` whenever they change a row or an evidence file.
    - Prerequisite fix (test-only, noted per the plan-task loop):
      - `task5_development_screen_verdict_matches_criteria_schema_and_recorded_evidence` (`scripts/memory-bench/task5-screen.test.mjs`) rewrote the committed `202/task5/development-screen-verdict.{json,md}` with a fresh `generatedAt` on every suite run. This is why both files were already modified in the working tree, and it made the ledger's pinned hash order-dependent.
      - The test now restores both files' bytes in a `finally`. Its assertions are unchanged.
      - The first suite run of this task had restamped the files to `2026-11-07T07:54:20.296Z`. Both were restored to the pre-run `2026-11-06T19:24:46.364Z`, and the json sha256 matches the ledger (`257288b4…`).
    - Checks:
      - `bun test scripts/memory-bench/feature-ledger.test.mjs`: 6 pass.
      - `feature-ledger.mjs --check`: current, both before and after a full suite run.
      - `--verify-tests`: 37/37.
      - `bun test scripts/memory-bench`: 496 pass, 3 skip, 1 fail, 1 error.
        - The fail and the error are the pre-existing `Task5Manifest: the candidate product has uncommitted changes` refusal, which `202/closure-verification.json` already records and Task 2's prerequisites own.
        - `markdown_store_write_amplification_within_budget` failed once in an earlier run at load average ~12 and passed on the rerun.
      - `bun run typecheck`: clean.
      - Biome: clean on the new scripts and the changed test.
      - No export, config or runtime code changed, so there is no baseline diff and no sweep.
    - Not done: the Task 0.2 idle-machine markdown-scale re-run (Further Actions, "before Task 1"). The machine stayed at load average 11–21 throughout, so the item stays open.

- [x] Task 2: Mechanism verification — offline probes for every candidate
  - Acceptance Criteria:
    - Functional: For each candidate, a deterministic probe on the mock provider drives the real packages through a scripted scenario designed to trigger it, and records:
      - **fires:** the mechanism ran, with a count and the trigger rate on a realistic replay, using a development-partition history ingested offline;
      - **reaches:** its output changed something the agent receives, such as ranking, rendered context, a tool result, a stored note or a delivery decision. Measured by diffing the provider request and the tool results with the mechanism on and off;
      - **correct:** the effect matches the documented behavior. Examples: R rises after a use and orders the expected note first; widening needs two independent projects with the same normalized text; eviction respects pins; a decay rate changes rank as documented; the curator's trigger fires on co-read clusters.
      Verdicts: `works`, `never-fires`, `no-effect`, `wrong-effect`.
    - Functional: A mechanism error found here (`never-fires`, `no-effect`, `wrong-effect` against the documentation) is fixed in this task with a regression test, when the fix is local and does not change the feature's contract. Otherwise it is recorded for Task 3. Each fix is listed in the ledger and the task note.
    - Functional: Realistic trigger rates come from replaying development histories offline: one LongMemEval-M development history, one BEAM-100K, one coding lifecycle persona and one work-outcome persona, through the product path with scripted model replies. A mechanism that fires on fewer than 1% of eligible turns in realistic use is flagged `rare`.
    - Functional: **Plan 202 verification prerequisites.** Resolve the two memory check blockers recorded in `docs/_evidence/memory-bench/202/closure-verification.json`: make Task 5 manifest tests use an isolated pinned product fixture instead of requiring unrelated working-tree changes to be committed, while preserving the real campaign dirty-product refusal; verify the host's after-forget result from structured hits rather than mistaking the echoed query in `no matching memory` for leaked memory. Preserve deletion/isolation coverage. Re-run the affected benchmark/host checks before C-1; provider compatibility and kernel-budget blockers remain release-path obligations, not evidence of memory benefit.
    - Functional: **Task 1 leads (amended 2026-11-07).** Probe first:
      - `lifecycle.verification`: verified share 0 in every offline lifecycle arm;
      - `delivery.weak-tool-caller`: the two-turn trigger cannot fire in one-question sessions.
      
      Name or add an inspectability test for `om.commands` and `fabric.toggle-status`. Re-run `feature-ledger.mjs --out` after each row or status change.
    - Performance: All probes finish offline in ≤ 30 minutes, with no model or network call.
    - Code Quality: One probe file per feature group under `scripts/memory-bench/mechanism-probes/`, sharing the `prefix-probe.mjs` request-capture helpers. Probes report hashes, counts and verdicts only.
    - Security: Fixture text only; temporary roots are removed on exit.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/prefix-probe.mjs` (request capture);
      - fabric `lifecycle/*`, `scope/recall.ts`, `links.ts`, `workers.ts`, `delivery/*`;
      - the wiki consolidation triggers;
      - OM's observer, reflector and dropper.
    - Options Considered:
      - Go straight to paid ablations. Rejected: a feature that never fires shows "no benefit" for a reason no ablation reveals, and fixing it first is cheaper.
    - Chosen Approach:
      - Free mechanism verification first, so paid ablations measure features that work as designed.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --out docs/_evidence/memory-bench/210/mechanisms.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/mechanism-probes/*` and tests (new). *(Amended at execution: `harness.mjs`, one file per group, `replay.mjs` for the realistic rates, `report.mjs`, `fixes.mjs` (the found errors, read by the ledger), `deterministic-ids.mjs`, `run.mjs`, `probes.test.mjs`.)*
      - fixes in `packages/memory/{fabric,observational,wiki}/src/*` (as found), each with a test;
      - `scripts/memory-bench/task5-comparison.test.mjs` and `apps/prism-agent/src/__tests__/conversational-memory.test.ts`: the inherited closure-check fixture/assertion repairs above. *(Amended at execution: the host fix is in `apps/prism-agent/src/scenarios/conversational-memory.ts` too, which now returns the structured hit ids.)*
      - `docs/_evidence/memory-bench/210/mechanisms.json`;
      - `scripts/memory-bench/feature-ledger{,-features}.mjs`: the ledger carries each row's mechanism verdict and the `mechanismFixes` list;
      - `CHANGELOG.md` for each fix.
    - References:
      - Task 1.
  - Test Cases to Write:
    - `probe_detects_a_seeded_never_firing_mechanism`.
    - `probe_detects_a_seeded_no_effect_mechanism` (the mechanism runs but the request bytes are identical).
    - `probes_deterministic_and_text_free`.
    - One regression test per fixed mechanism error.
    - Existing Task 5 manifest tests pass with an unrelated dirty checkout via an isolated pinned fixture, while the real dirty-product guard still refuses execution; existing host after-forget scenario proves zero recalled hits despite echoed query terms.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: possibly — bug fixes.
    - Docs pages to create/edit:
      - the affected package README if documented behavior was wrong;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - **Probes.** `scripts/memory-bench/mechanism-probes/` probes all 90 Task 1 candidates, one file per group. Each
        probe drives the real packages on scripted providers and reports `fires` (a count), `reaches`, `correct` and a
        verdict:
        - `reaches` compares request bytes and tool results with the mechanism on vs off. Five mechanisms with no
          switch use a trigger-absent control instead.
        - The verdict is checked in order: never-fires, then no-effect, then wrong-effect, else works.
      - **Determinism.** The clock is fixed and network calls throw. `deterministic-ids.mjs` makes `randomUUID()` in
        the three id sources draw from a counter each probe resets (the prefix probe's loader pattern; no product
        API). Hashes are taken after run-local ids are tokenised.
      - **Realistic rates.** `replay.mjs` replays four development histories through the fabric package on their
        preset, with scripted replies (the model says the history's own assistant text):
        - LongMemEval-M: the first development row in file order, streamed from the 2.7 GB file, 60 of 470 sessions;
        - BEAM-100K: one development conversation;
        - the coding lifecycle persona (seed 7);
        - the first coding work-outcome persona.
        Per turn the replay reads what the agent received; at the end it reads the store and runs one
        `memory:maintain`. A rate under 1% is flagged `rare`.
      - **Prerequisites (plan 202 closure blockers).**
        - `task5-comparison.test.mjs` now builds its manifest in an isolated pinned fixture: a detached worktree of
          HEAD, removed after the run. A new `task5_manifest_still_refuses_a_dirty_product_checkout` proves the real
          dirty-product refusal still holds.
        - The host's after-forget check now reads structured hit ids: the scenario returns `forgottenId` and
          `afterForgetHitIds`, and the test asserts zero hits. The text assertions it had are kept.
        - `bun test scripts/memory-bench`: 515 pass, 3 skip, 0 fail. The Task 1 note's `Task5Manifest` fail and
          error are gone.
      - **Fixes, each with a regression test.**
        - **Package tool routing.** In `packages/memory/fabric/src/index.ts`, the package built its own tool set
          without three things the library's `createMemoryFabric().tools()` has:
          - `navigateNotes`, so `memory.read { around | session }` always answered `not_found` in the product path;
          - `noteMemory`;
          - `lifecycle.pin`, so `memory.replace { id, pin }` ignored `pin`.

          The navigator moved to `navigation.ts` (internal, not exported) and both tool sets use it. The package now
          passes `navigateNotes`, `noteMemory`, routed `pin`, and routed `verify` (`fabric.verify`).
          Test: `package_memory_read_navigates_and_replace_pins_across_scopes`, which fails without the fix.
        - **`recall.expansion`.** `recall.ts` now reports each hit's coverage over the caller's own terms, the scale
          the floor already used. Before, a match found only through an alternate fell under `memory.recall`'s 0.34
          no-match floor and the tool abstained. The variant is opt-in, so no default changes.
          Test: `expansion_match_reaches_the_recall_tool_instead_of_abstaining`, which fails without the fix.
        - **Rule capture without the archive (reported, not fixed).** `rules.capture: "confirm"` without `exchanges`
          captured nothing, silently. Setup now leaves a warning status note, and the fabric README states the
          dependency. Test: `rules_capture_without_the_exchange_archive_warns_at_setup`.
        - **Inspectability tests.** Named tests now cover the two Task 1 leads:
          - `om_commands_expose_session_state_for_inspection` for `om.commands`;
          - `memory_toggle_and_status_commands_are_inspectable` for `fabric.toggle-status`.

          Both rows are now `safety-proven`.
      - **Ledger.** Each row carries its `mechanism` verdict (and replay rate), and the ledger lists `mechanismFixes`.
        A fix whose named test is missing fails the build. Docs updated: CHANGELOG, the fabric README (capture
        dependency, expansion coverage) and the evidence README.
    - Result (`docs/_evidence/memory-bench/210/mechanisms.json`):
      - 90/90 candidates probed. **Every verdict is `works`** after the fixes. 0 problems; the run takes about 11 s
        and makes no model or network call.
      - Before the fixes, `navigation.agentic-lexical` and `recall.expansion` were `never-fires` through the product
        path.
      - **Rare** (under 1% of eligible units in the replays):
        - `lifecycle.verification`, `lifecycle.capacity-eviction`, `lifecycle.duplicate-merge`,
          `lifecycle.episode-merge`, `lifecycle.widen-narrow`;
        - `delivery.rule-capture`, `delivery.working-memory`, `kind.decision`, `lessons`, `write.exchange-steps`.
      - Ledger: 108 features, **88 candidates** (from 90), 16 `safety-proven`. `--verify-tests` ran 39/39 named
        tests, all passing.
    - Findings that affect later tasks (Task 3 inputs; `fixes.mjs` kind `task3` and the evidence README):
      - **Package lifecycle is project-only.** The package's per-turn lifecycle task runs on `createFabricLifecycle`
        of the project memory: uses, co-reads, retrievals, helpful and harmful evidence. So a cited user- or
        agent-scope note never gains a use, never verifies by use and builds no R or S. This weakens verification,
        the strength priors and widening for wider-scope notes. A run confirmed it: the cited project note reached
        `useSessions: 2`, and the cited user note recorded none. Routing it needs each scope's own clock for the use
        event, a contract question, so it is not fixed here.
      - **Verification under the presets.** Use-based verification needs `candidate` notes, and both presets leave
        promotion off, so under either preset no note is eligible. This explains the 202 Task 16 `verified share 0`.
        Scripted replies never cite either, so its replay rate is 0.
      - **Weak-tool-caller.** It works (the probe uses three cued turns). It fires on 207 of 420 replayed turns
        (49%), all in multi-turn haystack sessions, but cannot fire in a one-question benchmark session. So its
        benchmark "no benefit" is unexercised, not shown absent.
      - **Exchanges archived by maintenance.** One `memory:maintain` over the 60-session LongMemEval-M replay
        archived 29 of 293 raw exchanges (low R and S past the grace window). Archived exchanges are hidden from
        active recall unless the result is weak, so any campaign that runs maintenance must account for it.
      - **BEAM-100K archive count.** The replay archived 73 exchanges from 94 turns. The cause is not diagnosed here.
      - **Episodes.** `kind: "episode"` views are reachable only from a library host: the package passes no
        observational source. Episode rows come only from the consolidation extractor (promote on), so
        `lifecycle.episode-merge` cannot fire under either preset.
      - **Capture and the archive.** Rule capture depends on the exchange archive. Whether capture should run
        without it is a design question.
      - **One-scope priors.** A one-scope library fabric applies no recall prior (documented). The package's default
        scopes always fuse.
      - Documented preconditions the probes had to meet:
        - the team store opens only if its directory exists;
        - OM fails closed without a context window;
        - P2 runs only above the 0.85 Dice consolidation threshold.
    - Checks:
      - `bun test scripts/memory-bench/mechanism-probes/probes.test.mjs scripts/memory-bench/feature-ledger.test.mjs`:
        11 pass. This includes `probe_detects_a_seeded_never_firing_mechanism`,
        `probe_detects_a_seeded_no_effect_mechanism` and `probes_deterministic_and_text_free`.
      - Ledger `--check`: current.
      - Fabric suite: 721 tests, 0 fail (29 PostgreSQL skips). Observational suite: 102, 0 fail. Host: 61 pass.
      - `bun test scripts/memory-bench`: 515 pass, 3 skip, 0 fail.
      - `src/__tests__/docs.test.ts`: 67 pass.
      - `bun run typecheck`: clean. Biome: clean on the changed files.
      - Wiki suite: 75 pass and 2 fail, both outside this task:
        - `package_metadata_ships_one_entry_and_no_bin_or_skills`: plan 215's experimental peer range, already
          recorded in the Task 3.1 progress note;
        - `retired_wiki_names_absent_repo_wide`: hits `packages/hosts/host-builder/.../upgrading.md`, from plan 215
          work in the tree.
      - No export moved (`navigation.ts` is internal; the fabric root-exports and public-surface tests pass), so
        there is no baseline diff. The full release gate was not run: its unrelated failures are recorded in
        `202/closure-verification.json`.

- [x] Task 3: Conceptual gap analysis
  - Acceptance Criteria:
    - Functional: For each candidate that `works` but shows no benefit, or whose mechanism error needs a contract change, record:
      - **intended effect:** the problem it was meant to solve, with its source (plan, paper);
      - **why it did not show:** a classification, one of:
        - the measured suites cannot exercise it (for example capacity needs a long-horizon archive);
        - it is dominated by another feature (for example R and S priors under strong lexical matches);
        - its trigger is too rare;
        - its effect is too small at current budgets;
        - the design premise is wrong for an LLM agent;
      - **evidence for the classification:** failure-stage tables, trigger rates (Task 2), literature;
      - **minimal gap fix, if any:** a specific change with a **predicted, measurable effect** on a named metric and suite (for example "R prior weight 0.05 → 0.15 should lift knowledge-update by ≥ 3 points on LongMemEval-M dev"), or an **alternative measurement** for a feature whose benefit lies outside the suites (for example 202 Task 15's growth simulation for capacity and eviction);
      - **verdict:** `fix-and-measure`, `measure-elsewhere`, or `no-credible-path`.
    - Functional: **Deferred fact-extraction diagnosis (202 Task 17 / F4).** Apply the conditional procedure in `docs/_evidence/memory-bench/202/closure.md` on development partitions only. Specify the residual protocol and inspect available development traces after read-time fixes, requiring valid ingestion, actual delivered evidence, oracle/read-time controls, unique failure denominators and provenance. If new model evidence is needed, keep the Task 3 disposition `unmeasured`; Task 5 runs a diagnostic leg under C-1 and updates this analysis before any conditional implementation. Complete target attribution below 5% yields `not-needed`; ≥5% irrecoverable failures in a suite × model yields `fix-and-measure` for the original scoped Task 17 remedy; incomplete attribution stays `unmeasured` with no preset built. Existing extractor reliability is never inferred from the decision not to build a new preset. Existing Task 13's ≥5% shared-entity/not-in-query condition is retained separately; no graph store is authorized.
    - Functional: **Task 2 hand-offs (amended 2026-11-07).** Every candidate's mechanism `works` as documented (`210/mechanisms.json`), so no "no benefit" can be explained by a broken mechanism after Task 2's fixes. Classify these structural findings explicitly:
      - the package's per-turn lifecycle (uses, co-reads, retrievals, evidence) is project-only, so user- and agent-scope notes never build R, S or verification by use. Any fix needs per-scope clocks, a contract change: give it a verdict and, if `fix-and-measure`, a prediction;
      - use-based verification has no eligible notes under either preset (promotion off);
      - the weak-tool-caller switch cannot fire in one-question benchmark sessions (49% of replayed multi-turn turns);
      - one `memory:maintain` archived 29 of 293 raw exchanges in the LongMemEval-M replay. Decide whether the archive rule should apply to raw exchanges, and whether campaigns must run maintenance;
      - rule capture depends on the exchange archive;
      - episode views are unreachable from the package, and episode merge cannot fire under either preset;
      - the rare list in `mechanisms.json` (under 1% of eligible units).
    - Functional: The analysis is reviewed by a second pass with no access to the first pass's verdicts: a delegated reviewer, or the owner. Disagreements are recorded and resolved before Task 4's criteria are frozen.
    - Performance: Offline research.
    - Code Quality: One section per feature in `docs/_evidence/memory-bench/210/gap-analysis.md`; the predictions are machine-readable in `gap-predictions.json`, so Task 5 scores them. *(Amended at execution: both files are generated by `scripts/memory-bench/gap-analysis.mjs` from the hand-maintained `gap-analysis-rows.mjs`, the ledger's pattern; `--check` keeps the committed copies current.)*
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Task 1 ledger and Task 2 mechanisms;
      - failure-stage tables from 202, 208 and 209;
      - the literature behind each feature: ACT-R (Anderson & Schooler 1991), CLS, A-MEM, Mem0, Zep, ACE, MINJA, MemoryCode;
      - the 2026-10-31 first-principles assessment (features an agent would not build for itself).
    - Options Considered:
      - Remove every neutral feature without analysis. Rejected by the owner's rule: a neutral result may come from a mechanism error or a fixable gap.
    - Chosen Approach:
      - An explicit, falsifiable prediction for every proposed rescue.
    - API Notes and Examples:
      ```json
      { "feature": "lifecycle.retrievalStrength", "verdict": "fix-and-measure", "change": "prior weight 0.05→0.15", "metric": "knowledge-update", "suite": "longmemeval-m/dev", "predicted": ">= +3 points" }
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/210/{gap-analysis.md,gap-predictions.json}` (new). *(Amended at execution: generated from `scripts/memory-bench/gap-analysis-rows.mjs` by `gap-analysis.mjs`, tested by `gap-analysis.test.mjs`; `gap-predictions.json` moves to schema 2 and folds in Task 3.1's predictions under their ledger rows.)*
    - References:
      - Tasks 1–2.
  - Test Cases to Write:
    - `gap_predictions_schema_valid_and_reference_ledger_rows`.
    - *(Added at execution)* `gap_analysis_is_text_free_and_committed_copy_is_current`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `scripts/memory-bench/gap-analysis-rows.mjs` (new): one row per ledger candidate (88). Each row has its intended effect and source, the `why` class, evidence, gap, verdict, and either a prediction (change, metric, development suite, predicted effect, Task 5 arm) or a removal. It also holds the deferred levers (202 Task 17/F4, Task 13), the seven Task 2 structural decisions and the second-pass review record.
      - `scripts/memory-bench/gap-analysis.mjs` (new): validates the rows against the committed ledger and renders `210/gap-analysis.md` and `210/gap-predictions.json` (schema 2). Modes: `--out` and `--check`.
      - `scripts/memory-bench/gap-analysis.test.mjs` (new): `gap_predictions_schema_valid_and_reference_ledger_rows` checks:
        - every candidate has exactly one row;
        - every entry names a ledger candidate;
        - each verdict has its required fields;
        - every suite is a development suite or `offline:`, and no held-out partition is named;
        - Task 3.1's predictions survive;
        - both deferred levers are present.
        Each guard is proven by an altered input that must fail with a named problem. `gap_analysis_is_text_free_and_committed_copy_is_current` checks that the committed files match a fresh build.
      - `scripts/memory-bench/feature-ledger-features.mjs`: the `recall.gather` evidence text now carries the rescored prediction. The ledger was regenerated because `gap-predictions.json` is a pinned evidence file.
      - Evidence README: a Task 3 section.
    - Result (`210/gap-analysis.md`):
      - **fix-and-measure, 30 rows (29 distinct Task 5 arms).**
        - Plain leave-one-out or add-one with a stated prediction ("as-is"): lexical, multi-query, unmatched terms, enrichment, exchange steps, timeline, grouping, passive tail, precision filter, aggregation guidance, directory, standing rules, P3, P4, P5, lessons, the co-read and accumulation triggers, concept prior, passive pointer, the OM reflector, both dropper policies, and separate navigation.
        - Real fixes: strength-prior weight 0.05 → 0.15; the exchange exemption from strength-based archiving; the exchange hot tier unset in the presets.
        - The Task 3.1 variants: expansion, gather, keyed-only label, card excerpt.
      - **measure-elsewhere, 38 rows.** Measured by offline instruments, the growth stream, the work-outcome rows, the O-rows, the 202 Task 14 poisoning confirmation, or by following another row's fate.
      - **no-credible-path, 20 rows.** These are removal candidates for Task 6; nothing is removed here:
        - retrieval: `retrieval.hybrid`, `retrieval.decay-per-kind` (collapsed to one rate), `retrieval.similar-links`, `workers.linker`, `workers.evolution`;
        - write and recall: `write.consolidate-model-decider`, `write.om-promotion`, `recall.state-wrapper`;
        - lifecycle: `lifecycle.verification`, `lifecycle.duplicate-merge`, `lifecycle.episode-merge`, `lifecycle.widen-narrow`;
        - delivery and decisions: `delivery.working-memory`, `decisions.P1`, `decisions.P2`, `decisions.P6`;
        - kinds, ontology and legacy surface: `kind.episode`, `kind.procedure`, `ontology.binding-extractor`, `scoped.policy`.
      - **Deferred levers.** 202 Task 17/F4 stays `unmeasured`.
        - The 202 attribution covers 0–19% of failures per cell, all historical heuristics.
        - On 208 BEAM-100K, the oracle beats recall by a net 5 of 40 on aggregation and state abilities, so `not-needed` cannot be recorded.
        - Those questions are what the unmeasured read-time variants target.
        - The diagnostic-leg protocol and the ≥ 5% rule are written out for Task 4 to pre-register.
        - Task 13 stays closed unless the same leg shows ≥ 5% shared-entity / not-in-query failures.
      - **Second pass.** A delegated reviewer with no access to the first pass's files classified all 88 candidates. It agreed on 61 verdicts.
        - 16 disagreements were labels only: the same Task 5 arm, which the reviewer called `measure-elsewhere`.
        - 6 calls were adopted: `lifecycle.exchange-capacity`, `lifecycle.widen-narrow`, `scope.path`, `decisions.P7`, the grouping arm's keyed-only setting, and the `scope.agent` re-pointing.
        - 7 first-pass calls were kept, each with a recorded reason: strength priors, decay per kind, P5, `kind.procedure`, `kind.file`, the co-read trigger and source ingest.
        - All are resolved in the analysis's review table, before Task 4.
    - Findings that affect later tasks:
      - **The 202 Task 5 screen never measured navigation.** The harness drives the `fabric()` package (`replay.mjs:1406`), and the committed package at `74bf7598` has no `navigateNotes`. Every `memory.read { around | session }` in that screen returned `not_found`, so the screen's `miss` is evidence about enrichment alone. That evidence is a LoCoMo candidate-gap worsening of +14.6 points, CI [0, 29]. Task 5's mandatory separate leave-one-outs are the first real measurement of navigation. Both passes found this independently.
      - **Archiving hides raw evidence.**
        - `maintain.ts:514` applies the strength-based `shouldArchive` to raw exchanges.
        - In the 202 growth stream, month-1 active retrieval is 0.5625 against 1.0 with the archive included. The growth "pass" compared two archived months.
        - Tier demotion does the same: 0.625 against 1.0 in the stress run.
        - Benchmark runs never call `memory:maintain`, so all earlier scores describe an unmaintained product.
        - Decision: every Task 5 arm runs without maintenance, except one pre-registered maintain-then-answer arm that scores the exchange exemption.
      - **The project-only lifecycle is fixable inside the package.** Maintenance already keeps a clock per scope (`scopeClock`), so this is not a contract change. It is also a correctness bug: archiving is strength-based, so a user-scope preference cited every session can still be archived as unused. Verdict `fix-and-measure`, built before the strength-prior arm (Task 5 prerequisite below).
      - **Task 3.1's gather prediction was above the ceiling.** It predicted LoCoMo multi-hop "3 → ≥ 5 of 12", but the oracle scores 4 of 12. It is rescored on gold-evidence rounds recalled, with accuracy capped at 3 → 4.
      - **Capture without the archive** is to fail closed in config validation, replacing Task 2's warning, if capture survives Task 6. This belongs to Task 7.
      - **Not adopted, recorded for Task 4:** the reviewer's variant that returns weak hits instead of "no matching memory" below the 0.34 floor.
      - **Vocabulary amendment.** `why` gained `measured-while-broken` (navigation) and `never-measured`. `never-measured` is used only where no arm ever ran the feature and none of the five plan classes explains why. A plain ablation with a prediction is `fix-and-measure` with change "as-is"; `measure-elsewhere` is kept for instruments outside the QA and work arms.
    - Checks:
      - `bun test scripts/memory-bench/gap-analysis.test.mjs scripts/memory-bench/feature-ledger.test.mjs`: 8 pass.
      - `gap-analysis.mjs --check`: current.
      - `feature-ledger.mjs --check`: current. The ledger now has 85 `unmeasured` and 16 `safety-proven` rows, with 88 candidates.
      - `bun run typecheck`: clean. Biome: clean on the new files.
      - No product code, config or export changed, so there is no baseline diff and no sweep.

- [x] Task 3.1: Recall-quality remediation and the ceiling instruments (added 2026-11-05, owner; evidence from plan 208 Task 5)
  - Progress (2026-11-05): **all five variants and both instruments are built and tested; the task stays open for the three items below.** Instruments: `ceiling.mjs`, `power.mjs` (`ceiling_report_pairs_recall_and_oracle_per_question_and_carries_no_text`, `power_check_matches_the_closed_form_for_a_known_paired_design`); `ceiling.mjs` reproduces the investigation's hand-counted numbers (LoCoMo 38 vs 42, 9 lost to memory, 13 wrong both; BEAM-100K 13 vs 16, 9, 18). Variants, each opt-in and default off, placed where the existing sections already live: `directory.stopWords`; `recall.supersessionHint` (`\"keyed-only\"`); `inject.cardExcerpt` (`\"query\"`; it sits under `inject` beside `fullTextScore`, not under a new `delivery` section); `recall.expansion` (new `lexical-expansion.ts`, a fixed English table, relevance floor scaled by the caller's share of terms, because the store's coverage is matched over query terms and alternates dilute it); `recall.gather` (a `gather` argument on `memory.recall`, present in the schema only when enabled). Tests are in `recall-variants.test.ts` and `directory.test.ts` (fabric suite 660 pass, repo typecheck clean): per-variant behaviour, fail-closed config values, `every_variant_is_byte_identical_when_unset`, and for gather the schema-absent-when-off and forgotten-note-excluded cases. Baseline regenerated with `bun scripts/release.mjs gate --update-baseline`; the only diff is `scripts/compat-baseline/arnilo__prism-memory-fabric.txt`: `+expandLexicalQuery`, `fitInjection` gains `cardExcerpt?`, `groupRecallHits` gains `options?`, all this task's. Predictions are in `docs/_evidence/memory-bench/210/gap-predictions.json`. The early give-up count is in `docs/_evidence/memory-bench/208/accuracy-investigation-2026-11-04.json`: of 22 wrong LoCoMo recall answers, 5 say the information is missing and 3 of those had the gold evidence shown; BEAM-100K 1 and 0. Unrelated finding: `wiki: package_metadata_ships_one_entry_and_no_bin_or_skills` fails because the working tree's `packages/memory/wiki/package.json` peer range for the fabric is `0.13.0-experimental.0` while the test expects `^0.13.0` (plan 215's experimental staging; not this task).
  - Still open in this task *(closed 2026-11-07, see Notes)*: (a) the quarantined-note case for gather's scope test (the forgotten-note case is covered; a quarantined note shares the same eligibility path but has no test of its own); (b) the live measurement, which is Task 5's (gate C-1) and needs the judges' daily quota, so nothing here is scored yet; (c) the plan 208 cut left the unfixed variants unmeasured on any real model run, so every prediction above is a prediction.
  - Why this exists (all counts from `docs/_evidence/memory-bench/208/accuracy-investigation-2026-11-04.json`; one model, Muse 1.2 Contributor, full dev partitions, the screen's judges):
    - LoCoMo (60): recall 38, oracle (gold evidence handed over) 42. Nine questions were lost to memory; thirteen were wrong either way. Of 22 wrong recall answers, 14 had the evidence shown to the model, 4 never had it as a candidate, 4 had it as a candidate but not shown.
    - BEAM-100K (40): recall 13, oracle 16. Memory costs about 7 points on each suite; the rest is the benchmark's ceiling (BEAM's oracle scores 0/4 on contradiction resolution and instruction following).
    - Named causes in the nine LoCoMo losses and the BEAM misses: (a) no abbreviation or synonym expansion in lexical recall ("gf" never matches "girlfriend"; two never-candidate misses); (b) no gather-everything operation for list and multi-hop questions ("names of the dogs" missed one name, "areas of the U.S." missed one area; recall surfaced 2-3 of 4-12 gold rounds on BEAM event ordering and summarization); (c) injected pointer cards show the first 120 characters of the user half (`excerpt.ts` `POINTER_MAX_CHARS`), and one answer glossed over a detail the card cut; (d) models give up early ("no information available" with evidence delivered); (e) the long-term-memory topic list counts stop words ("i", "it", "thanks", "wow"); (f) the read-time grouping labels older conversation exchanges "superseded by" a newer similar one (27-43% of injected LoCoMo hits, 4% on BEAM; removing the label moved 38 to 39 of 60, so the effect is within noise).
    - Ruled out by test, so not planned here: who said the evidence (user role 21/32 right, assistant role 15/23), judge ties (1 of 60), and relative-date resolution (it resolves "next month" correctly; those misses were retrieval).
  - Acceptance Criteria:
    - Functional: **Ceiling instruments first.** `scripts/memory-bench/ceiling.mjs` reads the run reports of the recall arm and the oracle arm (one model, one partition, the same flags except `--config`) and writes a counts-only report: totals, per ability, wrong answers by stage (never a candidate, candidate not shown, shown to the model), judge ties, and the paired recall/oracle table. `scripts/memory-bench/power.mjs` takes a paired design (n, discordance) and returns the smallest difference seen with 80% power at the 95% interval. Both are offline-testable on the mock provider; neither prints dataset text. Every later measurement in this plan (Tasks 5, 8, 9) reports its score beside its ceiling.
    - Functional: **Candidate variants, each an opt-in tuning field in `memory-fabric`, default off, with an offline mechanism probe (Task 2 style, verdicts `works`, `never-fires`, `no-effect`, `wrong-effect`) and a predicted effect in `gap-predictions.json`:**
      - `recall.expansion`: a deterministic query-side expansion table (common abbreviations and informal forms, English first, no embeddings, no model call; same shape as `dates.ts`). Prediction: LoCoMo never-candidate wrong answers 4 to at most 2 of 60, with no loss on `memoryagentbench-cr` or BEAM.
      - `recall.gather`: a mode of `memory.recall` (not a new tool) that collects every exchange matching the entity and topic terms across all time, deduplicated and in time order, paged past the seven-hit page. Prediction: LoCoMo multi-hop 3 to at least 5 of 12 *(amended 2026-11-07 by Task 3: the oracle arm scores 4 of 12, so 5 was above the ceiling; the scored prediction is gold-evidence rounds recalled +1 per question and correct 3 → 4 of 12)*; BEAM event ordering and summarization evidence recall up by at least one round per question; cost stated per call.
      - `inject.cardExcerpt`: pointer cards use the existing query-centred excerpt (`queryExcerpt`) over both halves of the exchange instead of the first 120 characters of the user half. Prediction: at least +1 of 60 on LoCoMo, with the extra injected tokens per question reported.
      - `directory.stopWords`: the topic list drops stop words using the core `STOPWORDS` list. Prediction: no accuracy change; fewer wasted tokens in the long-term-memory block (hygiene, justified by cost only).
      - `recall.supersessionHint: "keyed-only"`: the "superseded by" label is shown only for hits joined by a key or an explicit `supersedes` edge, not for exchanges joined only by shared subject terms. Prediction: within one question on LoCoMo (measured +1 of 60 when stripped); the verdict is the ledger's to give, and a null result removes the label for similarity-only groups.
      - **Early give-up** is measured, not fixed: count the answers that say the information is missing while evidence was delivered, per suite, and classify them as model, card or gate causes. A fix is proposed in Task 3's analysis only if a product cause shows.
    - Functional: **Not in this task, recorded so they are not lost.** Standing instructions for BEAM's instruction and preference following belong to plan 209 (standing rules); this task adds a ledger row linking the two. *(Amended at execution: the link is an evidence entry on the existing `delivery.standing-rules` row rather than a new row, which would claim no surface and need its own probe.)* BEAM's contradiction-resolution behaviour needs the answer prompt to ask for the contradiction to be surfaced, which departs from BEAM's published prompt; that is an owner decision recorded in Task 6, not a product change.
    - Functional: Every variant is reachable only through its config field; with the fields unset the recall results, injected text and tool schemas are byte-identical to today's (a regression test per variant). No `memory.*` tool name changes.
    - Performance: `recall.expansion` adds one table lookup per query term; `recall.gather` is bounded by an explicit cap (default the hard top-K cap) and states its per-call cost; `cardExcerpt` raises injected tokens by a stated, measured amount; none runs when its field is unset.
    - Code Quality: Placement in `memory-fabric` (and the stop-word reuse from `memory-core`); no new package, no kernel contract, no embeddings. Tuning-tier fields follow `config.ts` conventions (JSON Schema with defaults, `tuning` stability tags). No compatibility alias.
    - Security: expansion and gather never widen scope or bypass trust labels: results keep their `level`, scope and `trust` fields and pass the same eligibility and secret scans; a test proves a gathered hit from another scope or a quarantined note is still excluded.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/memory-bench/208/accuracy-investigation-2026-11-04.json` and plan 208 Task 5's notes ("Second investigation", "What the low scores mean");
      - `packages/memory/core/src/lexical.ts` (`STOPWORDS`, `stemLexical`, `lexicalTerms`) and `packages/memory/fabric/src/dates.ts` (a deterministic table with no model call, the shape `expansion` copies);
      - `packages/memory/fabric/src/excerpt.ts` (`POINTER_MAX_CHARS = 120`, `queryExcerpt`, `injectionPointer`, `fitInjection`, `injectionHead`);
      - `packages/memory/fabric/src/recall.ts` (`groupRecallHits`, `topK`, `order: "time"`) and `tools.ts` (`memory.recall`, `RECALL_PAGE_SIZE`, `HARD_TOP_K_CAP`);
      - `packages/memory/fabric/src/directory.ts` (`maxTopics`) and `config.ts` (`fullTextScore`, `minScore`, tuning conventions).
    - Options Considered:
      - Add embeddings for paraphrase recall. Rejected: memory is not RAG (owner decision 2026-10-24).
      - Raise the card length globally. Rejected: it changes cost for every host; the query-centred excerpt shows the answer-bearing text for the same budget.
      - A new `memory.gather` tool. Rejected: a mode of the existing tool keeps the tool surface and the freeze small (plan 185's reduction aim).
      - Fix everything and change defaults now. Rejected by this plan's rule: a variant is measured once (Task 5) before it ships or is removed (Task 6).
    - Chosen Approach:
      - Build the ceiling and power instruments first (they are harness only), then one opt-in variant at a time with its probe and its byte-identical-when-off test, then write the predictions into Task 3's file so Task 5 scores them.
    - API Notes and Examples:
      ```json
      { "feature": "recall.expansion", "verdict": "fix-and-measure", "change": "query expansion table on", "metric": "never-candidate wrong answers", "suite": "locomo/dev", "predicted": "4 -> <= 2 of 60" }
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/ceiling.mjs`, `scripts/memory-bench/power.mjs` and their tests (new); `scripts/memory-bench/README.md`: usage.
      - `packages/memory/fabric/src/{lexical-expansion.ts (new), search.ts or recall.ts, tools.ts, excerpt.ts, directory.ts, config.ts}`: the variants and their fields (tentative file split; confirm with `graft callers` on the lexical query path before editing).
      - `packages/memory/fabric/src/__tests__/*`: probes, regression and scope tests.
      - `packages/memory/fabric/README.md` and `CHANGELOG.md`: fields, cost per unit, default off.
      - `docs/_evidence/memory-bench/210/gap-predictions.json`: the predictions above.
    - References:
      - plan 208 Task 5 notes; plan 202 Tasks 5-7 (lexical navigation, dates, grouping); plan 209 (standing rules); plan 185 (surface reduction).
  - Test Cases to Write:
    - `ceiling_report_pairs_recall_and_oracle_per_question_and_carries_no_text`: fails if a question, gold or answer string reaches the report, or if the paired table drops a row.
    - `power_check_matches_the_closed_form_for_a_known_paired_design`: fails if the minimum detectable difference drifts from the reference value.
    - `expansion_matches_informal_forms_and_leaves_unrelated_queries_unchanged`: "gf" reaches a note that says "girlfriend"; a query with no table term is byte-identical; fails if the table fires on a stop word.
    - `gather_returns_every_matching_exchange_in_time_order_past_the_seven_hit_page_and_respects_scope`: fails if a hit is dropped, duplicated or comes from another scope or a quarantined note. *(Amended at execution: the order and page half is `gather_returns_every_matching_exchange_in_time_order_past_the_five_hit_page_and_respects_scope` (the page is five hits); the scope and quarantine half is `gather_never_reaches_another_scope_or_a_quarantined_note`, plus `gather_never_widens_scope_a_forgotten_note_is_not_gathered`.)*
    - `card_excerpt_centres_on_query_terms_across_both_halves_and_defaults_to_the_old_card`: fails if the old 120-character card changes with the field unset.
    - `topic_list_drops_stop_words_and_keeps_content_words`: fails if "i" or "it" stays or a content word is lost.
    - `supersession_hint_keyed_only_shows_the_label_for_key_and_supersedes_groups_only`: fails if a similarity-only group still carries the label, or a keyed update loses it.
    - `every_variant_is_byte_identical_when_unset`: recall results, injection text and tool schemas, per variant.
    - `variant_fields_reject_unknown_values_fail_closed`: config validation names the field.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, additively: five opt-in `memory-fabric` tuning fields (default off) and one recall mode. Memory packages ship on the experimental line (plan 215), so the compat classification is experimental; regenerate the baseline with `bun scripts/release.mjs gate --update-baseline` and attribute the diff to this task.
    - Docs pages to create/edit:
      - `packages/memory/fabric/README.md`: the fields, each with its per-unit cost and the default that avoids it; `CHANGELOG.md` under `## [Unreleased]`; `scripts/memory-bench/README.md`: the two instruments.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07; built 2026-11-05, closed 2026-11-07):
    - What changed (closing work; the variants, instruments, predictions and baseline diff are in the Progress line above):
      - **Gather and quarantine.** Before this change, gather used the plain recall path, so a quarantined (flagged, candidate) note was returned marked `[flagged: …]`. The README already claimed it was excluded. `memory.recall` with `gather: true` now drops flagged hits before fusion (`packages/memory/fabric/src/tools.ts`). The default relevance page is unchanged and still shows a flagged note with its marker.
      - New test `gather_never_reaches_another_scope_or_a_quarantined_note`. Two memories share one vector store under different resources; a flagged candidate note sits in the caller's own scope. Gather shows neither the other-scope note nor the flagged note, while the plain page still shows the flagged one marked. The test fails without the fix (checked by reverting it), and the fix is restored.
      - **Probes for the two variants that had none.** These are `delivery.directory#directory.stopWords` and `delivery.passive-tail#inject.cardExcerpt` in `mechanism-probes/delivery.mjs`; both return `works`. Expansion, gather and keyed-only already had Task 2 probes.
      - `report.mjs`: a `<row>#<variant>` probe belongs to its row, so the coverage check reads the base id. `probes.test.mjs` asserts that a known-row variant passes and an unknown-row variant fails. `mechanisms.json` now has 92 probes (88 candidates, 2 safety-proven, 2 variants), all `works`.
      - **Ledger link.** The `delivery.standing-rules` row cites the 208 investigation as its conversational target: BEAM-100K instruction_following is 2/4 with recall and 0/4 with the oracle; preference_following is 3/4 and 1/4. The ledger and gap analysis were regenerated.
      - **Docs.** The fabric README gather paragraph states the quarantine rule precisely. CHANGELOG has a Task 3.1 entry; the Progress line above mentioned one, but none existed.
    - Already done before closing (2026-11-05 Progress): the five variants, the ceiling and power instruments, the predictions, the early give-up count, and the baseline diff for `arnilo__prism-memory-fabric.txt`. No export changed in the closing work, so no new baseline diff.
    - Findings that affect later tasks:
      - Task 3 rescored the gather prediction under the oracle ceiling (multi-hop 3 → 4 of 12, plus gold-evidence rounds recalled).
      - **Every prediction is still a prediction.** No variant has run on a real model; Task 5 measures them once under C-1.
      - The early give-up count needs no product fix of its own. It is 3 of 60 LoCoMo wrong answers that say "missing" with the evidence shown, and 0 of 40 on BEAM. Its card cause is scored by the `inject.cardExcerpt` arm (prediction 3 → ≤ 1).
      - BEAM contradiction resolution is 0/4 under both recall and oracle. It needs an answer prompt that departs from BEAM's published one; that is an owner decision recorded in Task 6, not a product change.
    - Checks:
      - Fabric suite: 693 pass, 29 PostgreSQL skips, 0 fail across three consecutive runs. One earlier run, at load average 26, had 1 intermittent failure that did not recur and was not identified.
      - `bun test scripts/memory-bench`: 517 pass, 3 skip, 0 fail.
      - Probe, ledger and gap-analysis tests pass. Ledger `--check` and gap `--check` are current. `--verify-tests`: 39/39.
      - `bun run typecheck`: clean. Biome: clean on the changed files.
      - Open item (a), the quarantine case, is closed. Item (b), the live measurement, is Task 5's. Item (c), "every prediction is a prediction", remains true by design.

- [x] Task 3.2: Calibrate the claim-support panel on a labelled set from an arm no judge curated (added 2026-11-05, owner; evidence from plan 208 Task 5's O3 early read)
  - **Amended 2026-11-07 (owner decision at execution): the live part moves to Task 5.** `.cache/memory-bench/208/` was deleted before this task ran. It held the only copy of the claim text. The ontology-store cache and the earlier small-arm labels in `.cache/scratch` are gone too; only the counts-only reports in `docs/_evidence/memory-bench/208/audit/` survive. Asked how to proceed, the owner chose to fold the labelled set, the blind labelling, the calibration run, the kappa branch and the evasive-lure residual into Task 5 as its first step ("Panel calibration first"). They run there on claims freshly curated on the post-remediation product, by a curator on no judge panel. This task keeps and closes the offline half: the two tests below, the curator-independence guard and the ledger record. The acceptance criteria below are kept as written for reference; Task 5 carries the binding version.
  - Why this exists:
    - Plan 208's O3 early read (gate amendment 18, 60 claims per group, paid judges) put supported share at 0.75 on both Nemotron route groups and 0.65 on the Muse default-policy arm, against the 0.95 criterion. The report carries `valid=false, pass=null`: the panel has no human calibration, so the number cannot yet be trusted as a verdict in either direction.
    - The only labelled set is 60 claims from the small arm (`P+O.small`), labelled by the assistant (88% supported). The harness refuses a judge that curated a bundle it judges, and Qwen and Muse 1.2 curated that arm, so no judge in the panel may score the set. The labels and the panel have never met.
    - The panel may be stricter than the labeller, or the arms may differ. A panel that rates "partially supported" (14, 12 and 21 of 60 in the three groups) for an added date or inference may be right under O3's definition or too harsh. Without a labelled set on claims the panel *can* judge, the two readings cannot be separated.
  - Acceptance Criteria:
    - Functional: **Labelled set.** Build a 60-claim set from the `P+O.large` bundles (curated by Nemotron, which is on no judge panel) with `bun scripts/memory-bench/ontology-audit.mjs --campaign .cache/memory-bench/208 --arm P+O.large --build-human-set <dir>`. Strata are drawn by the existing `selectHumanAuditClaims` (suite and subject size), so the set is not all MemoryAgentBench-CR (24 of 24 supported). Run this **before the 208 bundles are deleted**; the claim text exists only there and in the local scratch, never in a report.
    - Functional: **Who labels.** Plan 208 gate amendment 1 delegates the first labelling to the assistant, blind: labels are written before any panel verdict on these claims is read, and the label file is hashed and committed to the run record first. The owner may label instead (`review.html` supports it). Plan 210 Task 9 repeats O3 with a person's labels; a set labelled only by the assistant stays `development` evidence and never decides a published claim.
    - Functional: **Calibration run.** Run `ontology-audit.mjs --labels <labels.json> --judges <two judges from distinct families, neither the curator>` on the same 60 claims. The report gives the supported-versus-not kappa with its interval, the four-label kappa, and the confusion table (human label by panel verdict), counts only. Panel validity needs `panelHumanKappaAtLeast` (0.8) from `three-tier-criteria.json`. Judges: the free pair if their quota allows, otherwise the paid pair from plan 208 amendment 18 (Qwen 3.7 Flash and Muse Spark 1.2 Contributor, Muse 1.3 as the third model); the report names which.
    - Functional: **Branch on the result, recorded in the ledger.**
      - kappa at least 0.8: the panel is valid, the 0.65-0.75 figures stand as development evidence for plan 208's arms, and the full-size audit (200 claims per group) runs under gate C-1 on the post-remediation product.
      - kappa below 0.8: record where they differ (the confusion table by label), decide with the owner whether the rubric text or the labeller is the problem, and relabel or revise the judge instructions once. The audit stays `valid=false` and O3 cannot pass until it clears.
    - Functional: **Disagreement is a finding, not noise.** If the panel is stricter than the labels specifically on "partially supported" claims, the ledger row for `claim-support` records it as a *rubric* question (is an added date or an inference unsupported?) for the owner to decide in Task 6, not as a curator defect.
    - Performance: 60 claims by 2 judges is 120 judge calls plus a third-model tie-break where used; plan 208's 60-claim paid audit cost about USD 0.10 in total. State the spend in the run record.
    - Code Quality: existing `ontology-audit.mjs` flags and `selectHumanAuditClaims`; no new harness code unless the build step refuses the arm name, in which case fix that with a test.
    - Security: counts and ids only in the evidence (`docs/_evidence/memory-bench/210/audit/`); claim text, notes and labels with text stay in `.cache/scratch`. Keys as refs. Only the development partition is read.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/ontology-audit.mjs` (`selectHumanAuditClaims`, `renderClaimReviewPage`, `parseClaimLabels`, the `--build-human-set` and `--labels` flags; the calibration summary near line 307);
      - plan 208 Task 2 (the audit design and curator-independence rule) and Task 5 notes ("O3 early read with paid judges"); gate amendments 1 and 18 in `docs/_evidence/memory-bench/208/gates/owner-gate-1.json`;
      - plan 199 (the calibration report this reuses).
    - Options Considered:
      - Label claims from the small arm and let a third judge family score them. Rejected: both small-arm curators are already on the panel, and adding a third family still leaves two of the three conflicted.
      - Skip calibration and run the full-size audit. Rejected: a larger sample tightens the interval around a number that has no validity (`valid=false`).
      - Treat the panel as the truth and the 0.65-0.75 as the O3 result. Rejected: the criterion requires human calibration.
      - Fold the labelling into Task 9. Rejected: Task 9 reads held-out data and runs once; the panel's validity must be known on development data before then.
    - Chosen Approach:
      - One blind labelling pass on 60 claims from an unconflicted arm, one calibration run, then the branch above. It is the smallest step that makes O3 interpretable.
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/210/audit/claim-calibration.json` (counts, kappa, confusion table; no text);
      - `docs/_evidence/memory-bench/210/feature-ledger.json`: the `claim-support` row;
      - `scripts/memory-bench/ontology-audit.mjs` and its test, only if the build step needs a fix.
    - References:
      - plan 208 Task 5 notes; plan 199; `three-tier-criteria.json`.
  - Test Cases to Write:
    - `calibration_report_carries_ids_and_counts_only`: fails if a claim, note or label text reaches the report.
    - `live_audit_refuses_a_panel_judge_that_curated_any_bundle_of_the_arm`: fails if a curator-conflicted judge may score the set (`liveJudges` enforces the rule; add the test if `ontology-audit.test.mjs` has none).
    - Existing `ontology-audit.test.mjs` cases for kappa and `valid=false` without labels still pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence and harness only).
    - Docs pages to create/edit: `docs/_evidence/memory-bench/210/README.md` (the calibration record), if that README exists; otherwise none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - **Blocked input.** `.cache/memory-bench/208/` no longer exists, so `--build-human-set` has no `P+O.large` bundles to read. Plan 208's Further Action said to delete it only after this task (P4); it went early. No bundle or label file survives anywhere on the machine (searched `.cache`, the scratch dirs and the trash). The 208 audit reports carry ids and counts only, by design, so the set cannot be rebuilt from them. Rerunning the 208 `P+O.large` curation would be hours of free-quota curator passes on today's tree, which is not the 208 product. The owner chose to calibrate on fresh claims in Task 5 instead (amendment above).
    - **Curator-independence guard, fixed.** `liveJudges` compared exact refs (`panel.refs.includes(bundle.model)`), so the curating model reached through another route (`kilo/nvidia/nemotron-…:free` curating, `openrouter/nvidia/nemotron-…:free` judging) passed. The check is now `assertNoCuratorJudge({ refs, bundles })` in `scripts/memory-bench/ontology-audit.mjs`. It compares the route-free, lower-cased model id (provider segment and `:free` dropped) and throws before any judge call. `liveJudges` calls it after the gate check.
    - **Tests.** Both are in `ontology-audit.test.mjs`.
      - `live_audit_refuses_a_panel_judge_that_curated_any_bundle_of_the_arm`: covers the exact ref, the same model through another route, a case-only difference, and an unconflicted pair that passes. The route cases fail under the old exact-ref check.
      - `calibration_report_carries_ids_and_counts_only`: `calibratePanel` output holds no string at all, and no claim or note text reaches the report.
    - **Build step.** It needs no fix for the arm name: `safeName` keeps `+` and `.`, so `ontology-claims/P+O.large` is the directory the arm writes and `loadClaimBundles` reads.
    - **Ledger.** There is no separate `claim-support` row; O3 belongs to `ontology.tier`. That row now cites both 208 audit reports (0.75 per Nemotron group, 0.65 Muse, `valid=false`), and its `statusBasis` says calibration moved to Task 5. Status stays `unmeasured`. The ledger and gap analysis were regenerated; both `--check`s are current, and `gap-predictions.json` and `gap-analysis.md` are unchanged.
    - **Findings that affect later tasks.**
      - Task 5 now opens with the calibration (amended below). Until it clears, O3 stays `valid=false`, and the evasive-lure residual (plan 208 O4) still rests on the scripted check alone.
      - The calibration needs a gate O-1 record today: `liveJudges` accepts only plan 208's approved O-1. Task 5's C-1 gate must either be accepted there or replace that check, with a test, before the run.
      - Spend: nothing. No live call was made.
    - **Checks.**
      - `bun test scripts/memory-bench`: 519 pass, 3 skip, 0 fail.
      - `ontology-audit.test.mjs`: 11 pass. Probes: 5 pass. Ledger and gap-analysis tests: 8 pass.
      - `bun run typecheck`: clean. Biome: clean on the changed files.
      - No export moved, so no baseline diff. Nothing was retired, so no sweep.

- [x] Task 4: Pre-registered decision rules
  - Acceptance Criteria:
    - Functional: `scripts/memory-bench/cleanup-criteria.json` is committed and hashed before any Task 5 run. It defines per feature:
      - **keep:**
        - a benefit with CI lower bound > 0 on its target metric (from existing evidence or Task 5);
        - **or** `safety-proven`;
        - **or** a measured cost or latency role (≥ 10% cost or p95 reduction on its suite);
        - **or** it is a compatibility shim the owner names explicitly, with its reason;
      - **fix-kept:** the Task 3 fix measured once, meeting its own prediction's direction with CI lower bound > 0. A fix that misses its prediction does not get a second try;
      - **remove:**
        - status `negative` (CI upper bound < 0 on any ability, or a safety failure), whatever else;
        - or no keep reason, the fix (if any) failed, and removal is non-inferior on development partitions: with the feature removed, every suite stays within 2 points at the CI lower bound and the work-outcome rows W1–W6 stay non-inferior;
      - **owner-hold:** a remove verdict on a feature the owner wants to keep needs a written reason in the decision record, and the feature moves to the experimental tier (below) instead of the stable surface.
      - *(Added at execution)* **inconclusive:** not negative, no keep reason, no fix kept, and removal not shown non-inferior. The feature goes to the experimental tier, and Task 6 lists it for the owner to remove or hold. Precedence: negative, fix-kept, keep, remove, inconclusive. An owner hold never applies to a negative feature.
    - Functional: **Experimental tier.** A kept-by-owner feature without evidence is documented as experimental, outside the API-level-1 promise (fabric README `## Compatibility`), so it can change or go in a minor version. This is the only route to keep an unjustified feature.
    - Functional: **Task 3 inputs (amended 2026-11-07).**
      - **Removal of an inert feature.** Some `no-credible-path` rows are off in every shipped preset, or have no effect there: hybrid, linker, evolution, the model decider, the state wrapper, episode merge, P1, P2, P6, extractor binding, `scoped.policy`, OM promotion, decay per kind, verification, duplicate merge, working memory, `procedure` and `episode`. For these, the removal non-inferiority rule is met by a byte-identical-preset test (the presets' provider requests and tool schemas do not change when the feature's code is removed), not by a paid arm. Any of them that a preset turns on needs the arm.
      - **Pre-register the F4 diagnostic leg.** Use the protocol and ≥ 5% rule of `gap-analysis.md` § "202-task17", including the Task 13 shared-entity count from the same leg.
      - **Pre-register the maintain-then-answer arm.** This is the only Task 5 arm that runs `memory:maintain`.
      - **Record the weak-hits-below-floor variant.** The reviewer proposed it and it was not adopted. Record it as a candidate that may be built only if the guidance leave-one-out shows the 0.34 floor causes the abstention gap.
    - Functional: **Held-out protection.** Every rule here uses development partitions only. Held-out partitions stay unread until Task 9, so a removal needs no held-out confirmation: Task 9 accepts the product with the removals in it, and a removal that hurts shows up there as a miss.
    - Performance: n/a.
    - Code Quality: Same schema conventions as `robustness-criteria.json`.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `robustness-criteria.json`, `three-tier-criteria.json`, `work-outcome-criteria.json`;
      - the 188.11 compatibility tiers.
    - Options Considered:
      - Decide case by case after the data. Rejected: the 188.10 lesson is that only pre-registered rules survive scrutiny.
    - Chosen Approach:
      - Rules first, then data.
    - API Notes and Examples:
      ```sh
      timeout 60 bun scripts/memory-bench/robustness.mjs --verify-criteria cleanup-criteria.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/cleanup-criteria.json` (new), validator in `robustness.mjs`, tests.
    - References:
      - Task 3.
  - Test Cases to Write:
    - `cleanup_criteria_hash_pinned_by_manifests`.
    - `negative_feature_always_removed_by_rules`.
    - `owner_hold_routes_to_experimental_tier`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence README. *(Amended at execution: also the fabric README `## Compatibility` gains "Experimental features after graduation", the experimental-tier statement this task's criterion requires, and `scripts/memory-bench/README.md` documents the file.)*
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - What changed:
      - `scripts/memory-bench/cleanup-criteria.json` (new; hash `eea138eb71d58408d09c331e55da419ad8caf8bdcc0a1e44536dda0cc55a7a51`). It holds the owner decisions, the pins, the development-only partition rule, the statistics, the verdict vocabulary with tiers and precedence, the rules, `ownerNamedShims` (empty), the experimental tier, the inert-removal lists and the four pre-registered legs.
      - `scripts/memory-bench/robustness.mjs`, added next to the three-tier functions:
        - `cleanupCriteriaHash`, `verifyCleanupCriteria`, `cleanupManifestPin` and `assertCleanupCriteriaPin`;
        - `cleanupVerdict(evidence)`, the pure rule function Task 5's `acceptance-report.mjs --plan 210` must call;
        - `--verify-criteria` now also accepts `cleanup-criteria.json`.
        The validator reads the work-outcome criteria JSON directly; importing `work-outcome/metrics.mjs` would create an import cycle.
      - `scripts/memory-bench/cleanup-criteria.test.mjs` (new) holds the three named tests. Each guard is proven by an altered input that must fail with a named message.
      - Docs: a Task 4 section in the evidence README, a paragraph in `scripts/memory-bench/README.md`, and the experimental-tier statement in the fabric README.
    - What the validator pins and checks:
      - the robustness (`dd1add49…`), three-tier (`3d5a5c10…`) and work-outcome (`d30681ec…`) criteria hashes;
      - the canonical hash of `gap-predictions.json` `predictions` (`2c26bbb3…`). Only the array is hashed, so the `deferred` entries can record the F4 leg's disposition later. Their protocol and rule text must still equal `preRegistered`;
      - plan 202 Task 5's frozen criteria, read from `development-comparison-manifest.json`;
      - every inert or conditional feature is a ledger candidate, a `no-credible-path` row and no preset's member;
      - every `no-credible-path` row has a removal route;
      - the maintain-then-answer arm is a Task 3 prediction;
      - the weak-hits variant is `recorded-not-built`.
    - Decisions made at execution (recorded in the file and the evidence README):
      - **A fifth verdict, `inconclusive`, routed to the experimental tier.** Task 4's text left one case without a verdict: not negative, no keep reason, and a removal that was not shown non-inferior (missing arm, missing stratum, or a CI crossing the margin). The plan's objective forbids such a feature becoming an API-level-1 obligation, and the non-inferiority rule forbids removing it. Task 6 lists it, and the owner removes it or holds it with a reason.
      - **Precedence: negative, fix-kept, keep, remove, inconclusive.** A negative result overrides a keep reason, a passing fix and an owner hold; keeping a negative feature needs a new owner decision that changes the file. An owner hold applies to `remove` and `inconclusive` only, needs a written reason, and the function throws without one.
      - **Per-model rules.** Keep needs one answer model's CI lower bound above 0, with no model negative. Removal needs non-inferiority on every model. The work-outcome margins are the `work` row's: W1, W2, W3 and W6 within 2 points, W4 a relative increase of at most 10%, W5 a supported share of at least 0.95.
      - **Plan 202 Task 5 relation.** For `write.keyword-enrichment` and `navigation.agentic-lexical`, a benefit counts only with a pass of the pinned Task 5 rules. A miss bars `keep` on benefit and never blocks removal, so neither file overrides the other.
      - **Conditional inert rows.** `retrieval.similar-links` and `lifecycle.widen-narrow` are `no-credible-path` rows that Task 4's inert list left out, because they are active by default outside the presets. They take the byte-identical-preset test first and need a paid leave-one-out arm only if it is not byte-identical.
    - Findings that affect later tasks:
      - **Task 5.** Every manifest and report carries `cleanupManifestPin()`, and the per-feature verdict comes from `cleanupVerdict()` with no hand-set value. The 202 Task 5 deferred arms pin criteria `202-task5-candidate-gap-v2` (`07383989…`), not v1. v2 changed only the transport, at gate 16 on 2026-11-01. Task 5's text is amended.
      - **Task 7.** The 18 inert removals (and the 2 conditional ones) need the byte-identical-preset test, which compares provider requests and tool schemas on the offline replay fixtures with the code removed. It does not exist yet; Task 7 builds it per removal.
      - **Task 6.** The record lists five verdicts, `inconclusive` included. Task 6's text is amended.
      - **Commit before Task 5.** The file must be committed before any Task 5 run (acceptance criterion). It is in the working tree, uncommitted, with the rest of the 0.13.0 work.
    - Checks:
      - `robustness.mjs --verify-criteria cleanup-criteria.json`: hash `eea138eb…`. `--verify-criteria three-tier-criteria.json`: unchanged (`3d5a5c10…`).
      - `bun test scripts/memory-bench/cleanup-criteria.test.mjs scripts/memory-bench/robustness.test.mjs`: 19 pass, 1 skip.
      - `bun test scripts/memory-bench`: 522 pass, 3 skip, 0 fail. `bun run typecheck`: clean.
      - Biome: clean on the changed files.
      - No product code or export changed, so there is no baseline diff and no sweep.

- [x] Task 5: Ablation and re-measurement campaign (owner gate C-1, paid)
  - Acceptance Criteria:
    - Functional: **Amended 2026-11-08 (owner, memory model): scope narrowed to what this plan audits and the redesign keeps.**
      - **Gate C-1 amendment 7 (owner, 2026-11-08): the campaign closes after wave 1.** Wave 1 has finished. Waves 2 and 3 are cancelled; no job of theirs runs. The gate record states the closure, the spend so far and the budget left unused. The cancelled arms go as follows:

        | Cancelled arm | Disposition |
        |---|---|
        | wave 3: `P+O`, `trigger-co-read-loo`, `trigger-accumulation-loo`, `concept-prior-loo`, `concept-pointer-loo` | moved to plan 222 Task 3, re-expressed for the wiki outside memory |
        | wave 3: `f4-readtime` | moved to plan 219 Task 7 |
        | wave 3: `OM` | moved to plan 217 Task 6 as the "before" baseline |
        | wave 3: `om-reflector-loo`, `om-dropper-deterministic` | not run: plans 218–219 replace those workers |
        | wave 3: `oracle` | not run |
        | wave 2: `tools-only`, `rules-add`, `W.P`, `W.P+W`, `W.steps-loo`, `W.rules-loo`, `W.lessons-loo` | transferred with their features (Task 6) to plans 219–220 |
        | wave 2: `maintain`, `archive-exchange-exempt` | transferred to plan 221, which decides the archive exemption from the offline growth evidence (`210/offline/growth-*`: month-1 retrieval 0.5625 → 1.0 with the exemption) |
        | wave 2: `gather`, `expansion`, `card-excerpt`, `precision-filter`, `strength-0.15`, `aggregation-loo`, `decisions-p3`, `decisions-p5`, `W.decisions-p4` | not run: the features stay at their current defaults and are recorded `unmeasured` in Task 6 |

      - **Criteria amendment.** `cleanup-criteria.json` gains a `transferred` list: each excluded feature id with its destination plan (Task 6). The feature is removed from `inertRemoval`. The file is re-hashed, and the C-1 manifest pins the new `cleanupCriteriaHash`.
        - A test proves no rule, threshold or verdict precedence changed for any remaining feature. Only the membership of `transferred` and `inertRemoval` differs.
        - Results already recorded for wave 1 stay valid under the new hash.
      - **The panel calibration and the evasive-lure residual** (the first criterion below) move to plan 222 Task 2. They calibrate claim support for the wiki, which leaves memory.
      - **The conditional Task 17 arm and the F4 diagnosis** move to plan 219 Task 7: session fact extraction is Rehearsal's job in the new design.
      - **The plan 202 closure rows.** The "OM/promotion" row of "Remaining plan 202 development targets" moves to plan 219 Task 7. Rows wave 1 measured are scored here. Rows only waves 2–3 would have measured are recorded `unverified`, as this criterion already allows for unavailable measurements, and plan 223's held-out acceptance still scores `robustness-criteria.json` in full. Those rows are passive delivery, aggregation/abstention, P1–P7, weak-caller sessions and coding decisions.
      - **Report.** `acceptance-report.mjs --plan 210 --partition dev` reads wave 1 only. It reports cancelled arms as `cancelled` and transferred rows as `transferred`, never as a miss.
      - Test: `plan_210_c1_closed_after_wave_1_and_report_reads_wave_1_only`. It fails if any wave 2–3 job is scheduled, or if a cancelled arm is scored as a miss.
      - Test: `cleanup_criteria_transfer_changes_no_rule_for_remaining_features`.
    - Functional: *(Moved to plan 222 Task 2 on 2026-11-08; kept here as the record of the requirement.)* **Panel calibration first (moved from Task 3.2, owner, 2026-11-07).** The plan 208 claim bundles are gone, so the claims are fresh. Before any O3-bearing arm is scored:
      - **Labelled set.** One `P+O` run on the post-remediation product, development partitions only, curated by a model on no judge panel. `bun scripts/memory-bench/ontology-audit.mjs --campaign <campaign> --arm <arm> --build-human-set <dir>` draws 60 claims through `selectHumanAuditClaims`. Claim text stays in the cache and in `.cache/scratch`.
      - **Blind labels.** The assistant labels first (plan 208 gate amendment 1), or the owner does via `review.html`. The labels are written before any panel verdict on these claims is read, and the label file is hashed into the run record first. An assistant-only label set is `development` evidence; Task 9 repeats O3 with a person's labels.
      - **Calibration run.** `ontology-audit.mjs --labels <labels.json> --judges <two families, neither the curator>`. `assertNoCuratorJudge` refuses a curator through any route. Before the run, the gate check in `liveJudges` must accept the C-1 record (today it accepts only plan 208's O-1); change it with a test. Report the supported-versus-not kappa with its interval, the four-label kappa and the confusion table, counts only, in `docs/_evidence/memory-bench/210/audit/claim-calibration.json`. Name the judges and the spend.
      - **Branch.**
        - kappa ≥ `panelHumanKappaAtLeast` (0.8): the full-size audit (200 claims per group) runs in this campaign.
        - kappa < 0.8: record where the labels and the panel differ. Decide with the owner whether the rubric or the labeller is the problem, revise once, and leave O3 `valid=false` until it clears.
        - If the panel is stricter on "partially supported", that is a rubric question for Task 6, not a curator defect. Record it on the `ontology.tier` row.
      - **Evasive-lure residual (plan 208 O4).** The same panel judges the delivered claims of the 208 Task 4 `evasiveResidual` fixture.
    - Functional: Gate C-1 states the budget, the models (two answer models from two providers, one small; the curator and decision models as shipped), the arms and the partitions. Arms:
      - **leave-one-out:** for each candidate that is a member of a shipped preset or a reference-host default, that configuration with the feature off;
      - **add-one:** for each opt-in candidate, the base configuration plus the feature;
      - **fixed variants:** for each `fix-and-measure` verdict, the fix;
      - **alternative measurements:** for each `measure-elsewhere` verdict, its named measurement (for example 202's growth simulation, or the work-outcome long-horizon personas).
      Partitions: development partitions of the robustness suites and the work-outcome suite. Features with similar targets may share a factorial design (stated at the gate) to save cost. The gate also reserves the budget for Task 8's combined check.
    - Functional: **Plan 202 Task 5 deferred arms (hand-off 2026-11-01).** Gate C-1 includes, whatever Tasks 2–4 conclude:
      - a leave-one-out arm per feature, keyword enrichment off and agentic navigation (`memory.read` neighbour/session paging) off, each against the Task 8 candidate configuration;
      - on the **full** `longmemeval-m` and `beam-1m` development cohorts frozen in `docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json`, plus the screened suites so every applicable suite has a row;
      - scored with the plan 202 Task 5.2 rules **as frozen**: the candidate-gap halving per suite, and the ability guard as a **veto** (every suite × ability stratum `>= -0.03`, missing strata unverified and blocking). Pin the original `criteriaHash` (version `202-task5-candidate-gap-v1`); a criteria drift is refused. *(Amended 2026-11-07 by Task 4: the frozen manifest carries `202-task5-candidate-gap-v2`, hash `07383989…`. It is v1 with only the transport changed, at gate 16. `cleanup-criteria.json` pins v2, and so must the C-1 manifest.)*
      These rows are reported next to the `cleanup-criteria.json` verdict and feed it as evidence. They do not replace it, and the cleanup verdict does not override them. A Task 5.2 miss here is a plan 202 Task 5 miss: Task 6 records it, and the feature goes to fix-and-measure or removal under `cleanup-criteria.json`. The arms run on plan 202's providers per this plan's header; the model may differ from Task 5's free route, and the report names the change.
    - Functional: **Remaining plan 202 development targets.** C-1 lists a disposition and measurement for every row in the closure handoff, including timeline, state/wrapper calibration, passive delivery, aggregation/abstention, realistic weak-caller sessions, coding decisions, each P1–P7 gate, live safety, growth QA and OM/promotion. Applicable original targets remain named and scored separately from cleanup verdicts; unavailable suites or attribution stay unverified. Build fresh compatible paired bases as needed; do not combine pre-cache-change fabric cells with current cells or silently resume the incomplete broad baseline.
    - Functional: *(Moved to plan 219 Task 7 on 2026-11-08; kept here as the record of the requirement.)* **Conditional Task 17 arm.** Before calls, Task 4's criteria and C-1 pin the residual-diagnosis protocol, ≥5% trigger and the original Task 17 acceptance bars. If Task 3 lacks complete evidence, run the pre-registered diagnostic leg first under C-1 and update the gap analysis. Only a qualifying development diagnosis permits the minimal fabric extractor repair and opt-in `conversational-facts` add-one arm. Write its named regressions first; include exchange citations, scope/consent inheritance, unchanged `conversational`, ≤2% session failures, cheap-model per-session/per-1k-exchange write cost, `product-extract` cache-read/write tokens and costs with/without cache reads, target-ability benefit and no regression. Update changed exports/baselines and README/changelog in the same task. Otherwise no preset is added. Task 6 records `not-needed`, measured outcome, or `unmeasured`/F4 unresolved before Task 8's freeze; held-out data cannot trigger this implementation.
    - Functional: **Task 3 arms and prerequisites (amended 2026-11-07).**
      - The arms are the `arm` fields of `210/gap-predictions.json`: 29 distinct arms for 30 `fix-and-measure` rows. The `measure-elsewhere` entries name their instruments.
      - Two prerequisites are built before the arms. Each needs a regression test, and neither may change a preset default before Task 6:
        - **(a) Per-scope use routing.** Each use or citation is recorded on the lifecycle of the scope that owns the note. This is a correctness fix (`fixes.mjs` `package-lifecycle-project-only`). Offline check: a cited user note reaches ≥ 2 use sessions.
        - **(b) The exchange exemption.** Raw exchanges are exempt from strength-based archiving. It sits behind a switch for the `archive-exchange-exempt` arm.
      - Every arm except the maintain-then-answer arm runs without `memory:maintain`.
    - Functional: Every arm is paired against its base on the same items. The report gives the effect per target metric with clustered CIs (plan 198), cost and p95 latency deltas, and the Task 3 prediction scored as hit or miss.
    - Functional: The verdict per feature is computed by `acceptance-report.mjs --plan 210` from `cleanup-criteria.json`, with no hand-set value. *(Amended 2026-11-07 by Task 4: it calls `cleanupVerdict()` from `robustness.mjs`. Every C-1 manifest and report carries `cleanupManifestPin()`, and `assertCleanupCriteriaPin()` refuses drift.)*
    - Performance: Caps per arm stated and reported. The gate states the deferred arms' share separately: `longmemeval-m` ingest is hours per question, and Task 5.2 priced it at a 144 h wall cap per role.
    - Code Quality: Existing campaign machinery. Arms are expressed as config overrides; a feature without a toggle gets a test-only switch in `scripts/memory-bench`, never a new product config field.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/{ablations,campaign,paired-sizing,stats}.mjs`;
      - plan 198 statistics;
      - plan 188.6's ablation design;
      - plan 202 Task 5.2 frozen criteria and Task 5.4.6 disposition (`scripts/memory-bench/task5-comparison.mjs:93–134`).
    - Options Considered:
      - Ablate every feature, including measured ones. Rejected: cost; features with accepted evidence are not candidates.
      - Rescore 202 Task 5's deferred rows with `cleanup-criteria.json` only. Rejected: that would change Task 5's rules after its screen result was known; the frozen rules are carried as written.
    - Chosen Approach:
      - Targeted paired ablations on candidates, plus scored predictions.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 210 --manifest --partition dev
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 210
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{ablations,campaign,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/210/{gates,ablations}/*`;
      - conditionally, the original plan 202 Task 17 fabric consolidation/config/tests, README/changelog and compatibility baseline files, only after its measured trigger passes;
      - `docs/_evidence/memory-bench/202/task5/README.md`: link the deferred rows' verdict back to Task 5.
    - References:
      - Tasks 1–4; plan 202 Task 5.4.6.
  - Test Cases to Write:
    - `plan_210_arms_paired_on_identical_items`.
    - `verdicts_computed_from_cleanup_criteria_only`.
    - `prediction_scoring_marks_hit_or_miss`.
    - `facts_arm_requires_measured_residual_threshold_and_original_bars`: fails if missing attribution opens extraction, a ≥5% diagnosis is omitted, the arm lacks original reliability/cost/provenance/no-harm checks, or held-out evidence triggers a build.
    - `plan_210_gate_c1_carries_202_task5_deferred_arms`: fails if the C-1 manifest lacks the enrichment-off or navigation-off arm, or the full `longmemeval-m` / `beam-1m` development ids, or pins a criteria hash other than Task 5.2's.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: evidence by default; yes only if the measured Task 17 trigger authorizes the original opt-in preset and extractor repair.
    - Docs pages to create/edit:
      - evidence README; conditionally the fabric README and CHANGELOG.md for Task 17, with its per-session write-call/cost contract.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08; closed after wave 1 by gate C-1 amendment 7):
    - **Gate C-1** is `docs/_evidence/memory-bench/210/gates/owner-gate-c1.json`, bound to `ablations/c1-manifest.json` (163 jobs, development partition only). It has five amendments:
      - Approved free-only on 2026-11-07.
      - Amendment 3 replaced the judges after glyph-cluster's shared 1000-a-day allowance ran out.
      - Amendment 4 (owner, 2026-11-08) moved every route to paid Ollama Cloud, on the Pro plan ($60 a month included, 3 concurrent requests):
        - answer models: `beam` (large) and `nemotron-3-nano:30b` (small);
        - judges: `gpt-oss:120b` and `gemma4:31b`;
        - work-outcome simulator: `gpt-oss:20b`;
        - P3–P5 decider: `clef:27b`.
      - Amendment 5 brought P3–P5 back. They had been unmeasurable because no free route declared the `decisions` capability.
      - Amendment 6 (owner, 2026-11-08: "I would like to go with option 3. do the planning and ready the run. But do not start the run till I explicitly instruct you") splits the campaign into three waves of about a working day each:
        - wave 1: 2,600 questions — write sides, the plan 202 Task 5 rows, and the P-paired removal arms;
        - wave 2: 2,080 questions and 12 work-outcome jobs — the other recall and delivery arms, P3/P5 and the work leg;
        - wave 3: 2,040 questions — ontology arms with the panel calibration, the F4 leg and OM.
        No arm, question, model or criterion is dropped. Each wave starts only on the owner's word (`c1-supervise.sh <waves>`).
    - **Run state (2026-11-08):**
      - Wave 1 started at 11:09 on the owner's word ("Start wave 1"). It carried in 3 of 163 jobs (both beam-1m write sides and `large.P.beam-100k`) and the partial checkpoints.
      - About $58 of the $60 allowance was left at the start.
      - Two fixes landed during the wave, after the LongMemEval-M write sides failed at restart:
        - Commits during the run moved git HEAD, so `run.mjs` refused to resume their checkpoints (`MemoryBenchResumeMismatch`). `c1-supervise.sh` now pins `PRISM_MEMORY_BENCH_SOURCE` to `ab3606f3`, the revision the write sides and checkpoints were made at. Memory, provider and bench run-path code is unchanged from `ab3606f3` to HEAD (`git diff`). `campaign.mjs` drops a checkpoint stamped with another label and reruns that job fresh.
        - Interrupted attempts (the oomd kill and the owner's stop) had counted toward `maxAttempts`, so the write sides were reported attempts-exhausted. `retryUncounted` in `campaign.mjs` no longer counts them on retrying routes, per the owner's rule that interruptions cost only wall time. The supervisor's 200-run limit bounds a job that keeps killing its host.
        - Test: `interrupted_attempts_cost_only_wall_time_on_retrying_routes`.
    - **Built for this task:**
      - `scripts/memory-bench/cleanup-campaign.mjs` holds the arms, jobs, manifest, gate, preflight, allowance guard and report. Its 10 tests include the five named above, all passing.
      - Mode `--plan 210` in `campaign.mjs` and `acceptance-report.mjs`.
      - Nine leave-one-out switches in `variants.mjs` and new paths in `ablations.mjs`.
      - `run.mjs` gains `--maintain-before-answer`, `--strict-questions` and the `none` comparator.
      - The work-outcome runner gains a fabric overlay and `--judges-paid`.
      - The C-1 gate is accepted by `liveJudges`.
      - Prerequisite (a), per-scope use routing in `packages/memory/fabric/src/index.ts`, with its offline check: a cited user note reaches 2 use sessions.
      - Prerequisite (b), the exchange-exemption switch.
    - **Interruptions only cost wall time.** A failed report re-runs from its answer and judge checkpoints and never counts against the job's attempts. A setup or capability fault, or a job that makes no progress in 6 tries, stops that job. Before each job, `/api/balance` is read: a closed session or weekly window is waited out until `resets_at` (the owner's 5-hour limit), and an allowance below $1.50 halts the campaign so it can resume next period. OM jobs run last, capped at 100M input tokens each.
    - **Findings:**
      - Journal saves raced and produced "unknown attempt"; saves are now serialized per path, with a test.
      - The ollama-cloud package had no decision-model support. It now serves `decision`-capability models over System One at `/v1/systemone`, with a CHANGELOG entry, README section, `docs/decisions.md` entry and compat baseline update. `ollamaCloudBalance()` also reads the current plans' included credit.
      - The wire proxy now reads Ollama's native NDJSON usage, including cached prefix tokens.
      - Bounded-wire accounting (a whole context window charged per request) is off for these jobs, because Ollama reports usage on every reply.
      - Smoke cost: about 90% of input tokens were billed as cached prefix (about $0.033 per million effective).
      - The fabric `policy.reviewSession` reviewer test was already flaky (4 of 8 runs fail) before this task.
    - **Offline instruments, already measured:** `210/offline/growth-*`.
      - Archive exemption: month-1 retrieval goes from 0.5625 to 1.0.
      - Exchange tier off (stress configuration): month-12 retrieval goes from 0.625 to 1.0. The p95 half of that prediction is not measured.
    - **Remaining:**
      - waves 1–3 of the campaign, each on the owner's go-ahead;
      - panel calibration on `P+O.large` (60 claims, blind assistant labels hashed first), then the evasive-lure residual;
      - `acceptance-report.mjs --plan 210 --partition dev`, which produces verdicts, prediction hits and misses, the plan 202 Task 5 rows and the F4 disposition;
      - the conditional Task 17 arm, only if F4 qualifies;
      - the evidence README and the link from 202 Task 5.
    - **Remaining, as amended 2026-11-08 (memory model; no further spend):**
      - the gate C-1 amendment 7 record (the campaign closed after wave 1);
      - the `transferred` criteria amendment and its test;
      - `acceptance-report.mjs --plan 210 --partition dev` over wave 1;
      - the evidence README and the link from 202 Task 5.

      Waves 2–3, the panel calibration, the evasive-lure residual, the F4 leg and the conditional Task 17 arm are no longer this task's (plans 217, 219, 221 and 222, or not run).
    - **Closure (executed 2026-11-08, Task 6 session):**
      - **Wave 1 finished.** All 61 wave-1 jobs completed (journal `campaign-96c896b2afef`, status `finished`, run ended 14:38; 93.7M confirmed input tokens; 24 abandoned and 6 setup-failure attempts along the way). Waves 2 (54 jobs) and 3 (48 jobs) are cancelled. No campaign process or unit remains.
      - **Criteria amendment.** `cleanup-criteria.json` gained `transferred` (40 rows, each with its destination plan), `closure` (28 cancelled arms with dispositions) and `amendments`; `inertRemoval` dropped to 9 features (the 2 conditional ones stay). The hash moved from `eea138eb…` to `ee1a7b58…`. The Task 6 review added `ownerNegativeOverrides` (`retrieval.lexical`); that step is the second amendment and has its own `previousHash`. `verifyCleanupCriteria` checks the transferred list.
      - **Gate record.** Amendment 7 is in `gates/owner-gate-c1.json`; manifest hash re-bound to `d5e14094…` (job list, arms, models, routes and caps unchanged). The dollar spend is not recorded: this session had no `OLLAMA_API_KEY`, so `/api/balance` was not read. The last balance on file is $49.73 of $60 (06:03Z, shortly after wave 1 started). The unused allowance is the owner's to read.
      - **Code.** `C1_CLOSED_AFTER_WAVE`; `parseC1Waves` and `buildExecutableC1Manifest` refuse waves above it (`C1Closed`); `c1Deferred` defers them; `c1Scheduled` lists what may start; the manifest carries `closure`. `buildC1Report` reads wave-1 jobs only and reports `cancelled` arms, `transferred` rows, `unmeasured` features and `plan202Closure` rows.
      - **Tests.** `plan_210_c1_closed_after_wave_1_and_report_reads_wave_1_only`, `cleanup_criteria_transfer_changes_no_rule_for_remaining_features` (rebuilds the earlier file from each amendment and gets the earlier hash) and `owner_negative_override_waives_only_the_ability_ci_trigger`, all passing. Two existing wave tests were updated for the closure. The stale provider-list regex in `run.test.mjs` (`provider_list_includes_the_litellm_pool`, failing since ollama-cloud joined the refusal text) was fixed.
      - **Report.** `acceptance-report.mjs --plan 210 --partition dev` read 61 jobs. Verdicts: `retrieval.lexical` remove (negative; overridden in Task 6), `write.keyword-enrichment`, `timeline` and `recall.supersession-hint` remove (negative), five features inconclusive. Predictions: `memory-off` hit, five missed, the rest `cancelled` or `not-scored`. Plan 202 Task 5 rows: both deferred arms miss (halving 0 pass, 8 miss, 2 inconclusive per feature; ability veto in 8 and 7 cells). F4 reads `unmeasured`.
      - **Findings that affect later tasks.**
        - The negative rule fires on any ability stratum whose CI is wholly below 0, and strata hold 12 questions. Three of the four negatives rest on one such stratum. Task 6 recorded this and the owner overrode only `retrieval.lexical`.
        - The report scores accuracy only. It has no cost or p95 delta per arm, so the `costOrLatency` keep reason could not fire for any feature. Plan 223 Task 3 should not read that as "no cost role".
      - **Docs.** Evidence README (closure, wave-1 report, Task 6 sections), `scripts/memory-bench/README.md`, and the verdict link in `202/task5/README.md`. No product code, export or baseline changed, so no baseline diff and no sweep.

- [x] Task 6: Decision record and owner review
  - Acceptance Criteria:
    - Functional: **Task 3.1 hand-off (2026-11-05).** The owner decides whether BEAM's contradiction-resolution questions may use an answer prompt that asks the model to surface contradictions. That prompt departs from BEAM's published one. Contradiction resolution is 0/4 under both recall and oracle, so no product change can move it. The decision is recorded here, with any claim limited accordingly.
    - Functional: `docs/_evidence/memory-bench/210/decisions.md` lists each candidate with its verdict (keep, fix-kept, remove, owner-hold → experimental) and evidence, and the list of removals. The owner reviews it, and every owner-hold carries a written reason. *(Amended 2026-11-07 by Task 4: the record also lists `inconclusive` verdicts, which are experimental. For each, the owner removes the feature or holds it with a reason. The record pins `cleanupCriteriaHash`.)*
    - Functional: ~~**Amended 2026-11-08 by Tasks 7.3–7.6.** The OM worker rows (observer, reflector, dropper) read `fix-kept pending Task 7.6`, not removal; Task 7.6 writes their final verdict.~~ Superseded the same day by the memory-model amendment below.
    - Functional: **Amended 2026-11-08 (owner, memory model): `transferred` verdicts.** These rows are not kept, fixed or removed here. Each gets the verdict `transferred → plan NNN`, and that plan writes its final disposition.

      | Destination | Rows |
      |---|---|
      | plan 216 (retired by owner decision) | `delivery.working-memory`, `kind.episode`, `lifecycle.episode-merge` |
      | plan 216 (carried into the new package; still `safety-proven`) | `om.commands`, `om.worker-limits` |
      | plan 216 (extracted into the wiki; verdict in plan 222) | `kind.concept`, `ontology.tier`, `ontology.binding-deterministic`, `ontology.binding-extractor`, `ontology.curator-pass`, `ontology.trigger.co-read`, `ontology.trigger.accumulation`, `ontology.trigger.repair`, `ontology.concept-prior`, `ontology.passive-pointer`, `ontology.concept-sharing`, `ontology.source-ingest`, `ontology.coding-o6` |
      | plan 216 (moves with the wiki; stays `safety-proven`) | `ontology.claim-lint` |
      | plan 217 (STM) | `om.observer`, `om.task-state` |
      | plan 218 (WM) | `om.reflector`, `om.compaction`, `om.pinned-context` |
      | plan 219 (Rehearsal and declarative LTM) | `om.dropper-model`, `om.dropper-lowest-relevance`, `om.recall-tool`, `write.om-promotion`, `write.session-consolidation`, `lifecycle.verification`, `write.exchange-steps` |
      | plan 220 (non-declarative LTM and priming) | `kind.procedure`, `retrieval.decay-per-kind`, `delivery.passive-tail`, `delivery.standing-rules`, `delivery.rule-capture`, `lessons` |
      | plan 221 (Sleep) | `lifecycle.duplicate-merge`, `lifecycle.maintain`, `lifecycle.archive-revival` |

      `decisions.md` lists them in their own section, with the destination and the reason. The test `decision_record_lists_transferred_rows_with_destination` fails if a transferred row carries a keep or remove verdict, or lacks a destination.
    - Functional: **Amended 2026-11-08 (owner): rows waves 2–3 would have measured.** These rows are recorded `unmeasured — wave cancelled 2026-11-08`:
      - the Task 3.1 recall variants (`recall.gather`, `recall.expansion`, the card excerpt, `delivery.precision-filter`, `retrieval.strength-priors` at 0.15);
      - `delivery.aggregation-abstention`;
      - `decisions.P3`, `decisions.P4` and `decisions.P5`.

      They are not the `inconclusive` of Task 4's rules, because no removal is proposed, and they are not removed:
      - opt-in variants stay opt-in at their current defaults;
      - default-on features stay on.

      Plan 223 Task 3 lists them as unmeasured, with no claim. The test `cancelled_wave_rows_recorded_unmeasured_not_removed` covers this.
    - Performance: n/a.
    - Code Quality: The record is generated from the ledger and the Task 5 verdicts, plus the owner's notes.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Tasks 1–5.
    - Options Considered:
      - Remove without owner review. Rejected: removals change the product the owner publishes.
    - Chosen Approach:
      - An evidence-generated record and an owner decision.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/210/decisions.md`.
    - References:
      - Task 4.
  - Test Cases to Write:
    - `decision_record_matches_ledger_and_verdicts`.
    - `decision_record_lists_transferred_rows_with_destination`.
    - `cancelled_wave_rows_recorded_unmeasured_not_removed`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — decision record.
    - Docs pages to create/edit:
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **What changed.**
      - `scripts/memory-bench/decision-record.mjs` (new) builds `docs/_evidence/memory-bench/210/decisions.{json,md}` from the ledger, the gap predictions, the cleanup criteria, `c1-report.json` and `owner-decisions.json`. Every verdict is `cleanupVerdict()`'s. The owner file supplies holds and written reasons and cannot set a verdict; a hold on a negative verdict, or on a feature with no wave-1 verdict, throws. `assertDecisionRecord` checks the structure and `--check` compares the committed files with a fresh build.
      - `owner-decisions.json` (new) holds the five holds with reasons, the inert-removal approval, the unmeasured policy and the BEAM decision.
      - `scripts/memory-bench/decision-record.test.mjs` (new) holds the three named tests. Each guard is proven by an altered input that must fail with a named message.
    - **Owner decisions (2026-11-08; each the recommended option).**
      - **Negatives.** `write.keyword-enrichment`, `timeline` and `recall.supersession-hint` are removed as computed. `retrieval.lexical` is kept under a recorded override in `cleanup-criteria.json` `ownerNegativeOverrides`: its only evidence is the `memory-off` arm, which does not isolate lexical retrieval, and the rule fired on one 12-question `adversarial` stratum against an overall +26 to +60 points. The override waives only the per-ability CI trigger.
      - **Experimental tier.** `recall.multi-query`, `recall.unmatched-terms`, `recall.state-grouping`, `delivery.directory` and `navigation.agentic-lexical` are held, each with a written reason.
      - **Unmeasured rows.** The 31 candidates wave 1 did not measure (the cancelled-wave rows, the measure-elsewhere rows, and `lifecycle.exchange-capacity`, which only the offline growth stream measured) are `unmeasured`: not removed, not moved to the experimental tier. Plan 223 Task 3 lists them with no claim.
      - **Inert removals.** All 11 (the 9 inert features and the 2 conditional ones) are `remove`, on the condition that Task 7's byte-identical-preset test passes.
      - **BEAM contradiction resolution.** No modified answer prompt. BEAM's published prompt stays in force for every headline number, and the 0/4 is a stated limit with no claim.
    - **Result.** 108 ledger rows, each once: 9 measured (1 keep, 3 remove, 5 owner-hold), 11 inert removals, 40 transferred, 31 unmeasured, 17 accepted. The removals list for Task 7 has 14 features. Transferred rows carry their destination plan (216: 19 rows, 217: 2, 218: 3, 219: 7, 220: 6, 221: 3) and none carries a keep or remove verdict.
    - **Findings that affect later tasks.**
      - **Task 7.** It executes 14 removals, not 20: the 3 measured negatives and the 11 inert ones. `write.keyword-enrichment` and `timeline` are always on and `recall.supersession-hint` defaults to `all`; no preset sets any of them. Removing them changes default behaviour of the shipped presets, so each removal needs a measured-behaviour note in the Task 7 record, and a host config that sets `recall.supersessionHint` must fail with the named migration error (`docs/migrate-to-0.13.md`). `rules.capture` is transferred to plan 220, so Task 7's fail-closed capture validation does not apply here; it goes with that plan. Task 7's text is amended.
      - **Task 7.** Neither conditional feature has an open paid arm to fall back on (gate C-1 is closed). If one is not byte-identical, the owner decides then.
      - **Plan 223 Task 3.** The `unmeasured` list and the `inconclusive`-turned-hold list are its inputs. The cost and p95 role was not measured for any feature (see Task 5 notes).
    - **Checks.** `bun test scripts/memory-bench`: 542 pass, 3 skip, 0 fail after the `run.test.mjs` fix. `bun run typecheck` and `biome check` on the changed files are clean. No product code or export changed.

- [x] Task 7: Removal, experimental tier and sweep
  - Acceptance Criteria:
    - Functional: **Task 6 hand-off (2026-11-08).** The removals are the list in `docs/_evidence/memory-bench/210/decisions.json` `removals` (14): `write.keyword-enrichment`, `timeline` and `recall.supersession-hint` (negative in wave 1) and the 11 inert ones. `retrieval.lexical` is kept. The five owner-held features (`recall.multi-query`, `recall.unmatched-terms`, `recall.state-grouping`, `delivery.directory`, `navigation.agentic-lexical`) move to the experimental tier with the documentation below.
    - Functional: **Task 3 hand-off (amended 2026-11-07; superseded 2026-11-08).** `rules.capture` (`delivery.rule-capture`) is transferred to plan 220, so the capture validation (config rejects a capture mode other than `"off"` without `exchanges`, naming the field) moves with it and is not done here.
    - Functional: **Amended 2026-11-08 (owner, memory model).** The transferred rows (Task 6) are not removed here. `inertRemoval` keeps nine features: `retrieval.hybrid`, `workers.linker`, `workers.evolution`, `write.consolidate-model-decider`, `recall.state-wrapper`, `decisions.P1`, `decisions.P2`, `decisions.P6` and `scoped.policy`. The two conditional ones (`retrieval.similar-links`, `lifecycle.widen-narrow`) stay as written. Plan 216 retires the fabric working memory, the episode view and episode merge, and plan 216 Task 3 moves the ontology; this task touches neither.
    - Functional: **Amended 2026-11-08 (owner): Task 8's offline parts land here.** After the removals, this task:
      - records the slimmed product's hash in `docs/_evidence/memory-bench/210/slimmed/record.json`, generated by `readiness.mjs` and listing every removal of this task with its evidence. This is the `P` baseline plans 216–223 use;
      - re-attests the readiness cache-stability pin (plan 202 Tasks 4.11–4.15) for that hash with `prefix-probe.mjs --equivalence`.

      No paid check runs. The removals are either inert (byte-identical by test) or individually measured in wave 1. Plan 223 Task 1's combined check bisects over them if the final product misses.
      - Test: `slimmed_record_lists_every_removal_and_passes_cache_pin`.
    - Functional: **Task 4 hand-off (2026-11-07).** Each removal of a feature in `cleanup-criteria.json` `inertRemoval` (amended 2026-11-08: the 9 inert features and the 2 conditional ones) lands with its byte-identical-preset test. With the code removed, the `conversational` and `coding` presets' provider requests and tool schemas must be byte-identical on the offline replay fixtures. If a conditional feature's test is not byte-identical, its removal waits for a leave-one-out arm under C-1.
    - Functional: Each removal deletes, with no alias:
      - the code;
      - the config fields (and their rows in the config stability table and `stability.test.ts`);
      - the exports, kinds, tools, commands or tool parameters;
      - the docs sections, examples, tests and the `defaults.json` entries.
      Preset contents change through the candidate revision Task 10 publishes, with a test that a host config written for revision 1 still validates. A removed contract field in a host config fails validation with a named error and a migration hint, recorded in `docs/migrate-to-0.13.md`.
    - Functional: Owner-hold features move to the experimental tier: their README section is marked experimental, they are listed under "May change in a minor version" in `## Compatibility`, and `stability.test.ts` gains an `experimental` tier.
    - Functional: Repo-wide sweep for every removed name and string over `src/ packages/ apps/ scripts/ examples/ docs/ README.md PRODUCT.md`, excluding `dist/`, `plans/`, `docs/history/` and `docs/_evidence/`.
    - Functional: Baselines regenerated with `bun scripts/release.mjs gate --update-baseline` for every affected package (`scripts/compat-baseline/arnilo__prism-memory-{fabric,observational,wiki,core}.txt`), and the post-regeneration diff is attributed to this plan in the note.
    - Functional: Reference host updated in the same task. `bun run --filter @arnilo/prism-agent test` stays green.
    - Performance: Package load cost and the fabric's per-turn work are measured before and after (`scripts/budgets.json`), and the reduction is reported.
    - Code Quality: Removals are whole: no dead branches, no unused config plumbing, no "deprecated" comments.
    - Security: Removing a safety-adjacent mechanism is never allowed under this task without a `safety-proven` replacement. Task 4's rules already keep `safety-proven` features.
  - Approach:
    - Documentation Reviewed:
      - `references/prism.md` §3 probes 6–8 (retirement, public surface, callers);
      - Task 6 record.
    - Options Considered:
      - Deprecate instead of removing. Rejected: 0.13.0 is unpublished, and the roadmap forbids compatibility aliases.
    - Chosen Approach:
      - Clean deletion before the freeze.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/release.mjs gate --update-baseline
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/**` (all 14 removals landed in the fabric; `core`, `observational` and `wiki` needed no change);
      - `apps/prism-agent/**`, `examples/**`, `scripts/**` callers;
      - READMEs, `docs/migrate-to-0.13.md`, `CHANGELOG.md`;
      - `scripts/compat-baseline/*`, `scripts/budgets.json`.
    - References:
      - Task 6.
  - Test Cases to Write:
    - `removed_memory_names_absent_repo_wide`.
    - `previous_revision_host_config_still_validates_or_fails_with_named_migration_error`.
    - `experimental_tier_enforced_by_stability_test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed surface.
    - Docs pages to create/edit:
      - the affected READMEs;
      - `docs/migrate-to-0.13.md`;
      - `PRODUCT.md` if a described feature is removed;
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes, only if a package's scope sentence changes
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **What changed.** All 14 removals landed in `packages/memory/fabric`: fabric source 82 → 67 files and 22,582 → 19,805 lines (−15 files, −2,777 lines, −12.3%). By feature (the code, config field, exports, docs, tests, examples and bench harness each went in the same step):
      - `scoped.policy`: `src/scoped/` keeps only `trust.ts` (`scanScopedMemoryContent` and friends, used by nine other modules; the ledger-based `listScopedPending`/`approveScopedPending`/`rejectScopedPending` went with the policy). `examples/scoped-memory.ts` deleted.
      - `decisions.P1/P2/P6` and `write.consolidate-model-decider`: `decisions.ts` keeps P3, P4, P5, P7 (`DECISION_POINTS = ["P3","P4","P5","P7"]`); `decider.ts`, `consolidate.decider`/`consolidate.model`, `onDeciderFailure` and the `decide_memory` call deleted. `scripts/decision-bench.mjs` and its fixture drop the 300 P1/P2/P6 items.
      - `recall.state-wrapper`: `state.ts`, config `state`, the `state` field of the recall result, and the tool-deps `resolveModelClient` that only it used.
      - `workers.linker`, `workers.evolution`: `workers.ts` is now only the consolidation settings; `links.ts` keeps `mergeNoteLinks`. Config `linker`, `evolution`, `passive` gone.
      - `retrieval.hybrid`: config `retrieval` and `limits.maxVectorDimensions`, the `embeddings` service consumption, the provisional-floor status note, `createMemoryFabric({ retrieval })`. **Scoping decision:** `createMemory({ embedder })` and the Memory-level hybrid mode stay. They are the library `Memory`/vector-store contract that dozens of fabric and core tests and four examples build on, and the audited surface (ledger `config: fabric:retrieval, fabric:limits.maxVectorDimensions`) is the package. The owner can widen this to a core redesign in a later plan.
      - `recall.supersession-hint`: config `recall.supersessionHint`, `GroupRecallOptions`, `SupersessionHintMode`, the `keyed-only` branch. The default `all` marker is the behaviour that remains, so the presets are byte-identical.
      - `write.keyword-enrichment`: the exchange archive no longer writes `exchangeKeywords(content)`. The function stays because the ontology port derives keywords from it for evidence notes stored without any (plan 216 Task 3 moves the ontology; this task touches neither).
      - `timeline`: `dates.ts` (`resolveDates`), the archive's `dates`, and the `memory.recall` tool parameters `from`, `to`, `order`. The note-format field `dates`, `tRef` and the library `from`/`to`/`order` recall options stay (they are note-model features an import can carry; `gather` still lists oldest first).
      - `lifecycle.widen-narrow`: `lifecycle/widen.ts`, config `lifecycle.widen`, `widenedTo`, `openScope`, the `widened`/`superseded` report fields, `LifecycleNoteView.widen`. The model tools still cannot write `agent` (error code `agent_scope_not_writable`, was `agent_scope_requires_widening`), because allowing it would weaken the poisoning bound the widening rule enforced. `contradictedIn` is still written by the consolidation exception path (plan 219 owns it) and read only by `memory:lifecycle`.
      - `retrieval.similar-links`: consolidation no longer writes the `similar` link; the general link expansion (exchange `part` links, `evidence` links, explicit `links`) is unchanged.
    - **Byte-identical test.** `packages/memory/fabric/src/__tests__/removal-byte-identical.test.ts` replays 12 provider requests per preset (`conversational`, `coding`: inserts, near-duplicate and same-subject facts, two recalls, quiet turns, a second session) and compares each request, its tool schemas and its context blocks to `fixtures/removal-byte-identical.json`. The harness normalises temp paths, dates, UUIDs, the random note ids and the directory's file order (a real filesystem-order tie, left alone). The golden was first taken before any removal; the final check of the nine inert removals plus the default-preserving `supersession-hint` against a clean `HEAD` worktree matched on all 12 requests × 3 hashes × 2 presets. **Results:** 10 removals byte-identical (the nine inert ones and `supersession-hint`). Four changed what the model sees and the golden was re-pinned once per removal (recorded per row in `slimmed/record.json` `presets`): keyword enrichment (requests 11–12, recall results), timeline (all 12, the recall tool schema), `similar-links` (requests 10–12, the insert result lost `links`), `widen-narrow` (all 12, the `key` parameter description and the agent-scope error). Context blocks never moved.
    - **Owner decisions (2026-11-08).** Neither conditional feature was byte-identical, so the plan's rule ("the owner decides then") applied. Question 1, `retrieval.similar-links`: *remove, re-pin golden*. Question 2, `lifecycle.widen-narrow`: *remove, re-pin golden*. Both are the recommended options and are recorded in the migration page.
    - **Removed config fails closed.** The kernel schema rejects an unknown key with `Package @arnilo/prism-memory-fabric config is invalid: <path> unknown key "<field>"`; for `consolidate` (a boolean-or-object field) it names the path, and a removed decision point fails the enum. That is the named error. `docs/migrate-to-0.13.md` (`## Fabric: features removed by the plan 210 audit`) is the migration hint, one row per field. `removed-config.test.ts` (`previous_revision_host_config_still_validates_or_fails_with_named_migration_error`) loads each 0.12-era config, asserts the error, asserts the page lists the field, and loads both presets. No preset revision changed: the presets set none of the removed fields, so Task 10 owns any revision bump.
    - **Experimental tier.** The five holds are marked `> **Experimental.**` in their README sections, listed under "May change in a minor version" and in `### Experimental features after graduation` with the owner's written reason, and `directory` plus `directory.*` carry tier `experimental` in the README table. **The kernel schema vocabulary has two tiers** (`contract`, `tuning`; `src/packages/schema.ts` rejects a third), and the kernel stays package-blind, so those five fields are annotated `tuning` in the schema, exported as `EXPERIMENTAL_CONFIG_FIELDS`, and `stability.test.ts` carries the `experimental` tier (`experimental_tier_enforced_by_stability_test`). The other four holds have no config field.
    - **Sweep.** `removed-names.test.ts` (`removed_memory_names_absent_repo_wide`) scans `src packages apps scripts examples docs README.md PRODUCT.md` for ten groups of removed names and is green. It skips evidence, history, plans, changelogs, migration pages, `budgets.json` history strings, the generated `host-builder/data` mirrors (regenerated with `scripts/host-builder-index.mjs`; `--check` is fresh), the two tests that name removed fields on purpose, and `scripts/memory-bench/**`. The last is the frozen measurement harness: its arms patch the pre-removal product and run only against the commit in `c1-manifest.json` (stated in `scripts/memory-bench/README.md`). In the harness I removed only what would otherwise break live code: the `fabric-hybrid` arm (now refuses with a named error), the `fabric.enrichment=off` and `fabric.timeline=off` variants, the P1/P2/P6 bench items, the `consolidate.decider=model` campaign job, and the `defaults.json` rows for fields that no longer exist. `bun test scripts/memory-bench scripts/__tests__`: 543 pass, 3 skip, 0 fail (`split_phase_arm_is_faster_than_serial_on_delayed_mock` is a 5 s timing test that flakes under load).
    - **Baseline diff (`bun scripts/release.mjs gate --update-baseline`).** The gate run rewrote seven baselines plus `budgets.json`; the gate itself still fails on the kernel's `packedBytes`/`unpackedBytes`/`sourceLines` ceilings (+4,039 / +11,641 / +7 over), which this plan did not touch. I kept only `arnilo__prism-memory-fabric.txt` and restored the other six files and `budgets.json`, because their drift comes from earlier tasks (plan 210 Task 0.2's markdown index in `-memory-core`, plan 215 kernel work, the host-builder kit). Fabric diff, removals attributed to this plan: `DECISION_POINTS` narrows to P3/P4/P5/P7 and `SupersessionChoice` goes; `DEFAULT_LINKER_TOP_K`, `HARD_MAX_FABRIC_LINK_TOP_K`, `resolveNoteLinks`, `runFabricEvolutionWorker`, `MemoryFabricLinkerOptions`, `MemoryFabricEvolutionOptions` (linker/evolution); `decideConsolidation` (decider); `MemoryFabricStateConfig`, `ResolvedStateConfig`, `resolveStateConfig`, `buildStateTable`, `STATE_INPUT_TOKEN_CAP` (state wrapper); `createScopedMemoryPolicy`, `runScopedMemoryEval`, `runScopedGcPass`, the ledger, reviewer, mirror and health helpers, the `ScopedMemory*` types, `MemoryFabricScopedConfig` (scoped policy); `DEFAULT_WIDEN_CONFIG`, `MIN_/MAX_WIDEN_*` (6), `crossProjectGroups`, `siblingGroups`, `narrowingCandidates`, `mergedKeywords`, `normalizeWidenText`, `WidenConfig`/`WidenGroup`/`WidenNote`/`SiblingGroup`, `ResolvedWidenConfig`, `MemoryFabricScopeOpenInput` (widen-narrow); `resolveDates` (timeline); `groupRecallHits` loses its options argument (supersession hint). Additions: `EXPERIMENTAL_CONFIG_FIELDS` (this task), and `createNoteNavigator` (plan 210 Task 2, not yet in the baseline). The remaining churn is the generator re-sorting long re-export lines.
    - **Slimmed record and cache pin.** `docs/_evidence/memory-bench/210/slimmed/record.json` (written by `bun scripts/memory-bench/audit/readiness.mjs --slimmed`) pins product hash `867f82771643…` (fabric `src`, which includes its tests), lists all 14 removals with evidence and preset effect, the golden's sha256, and the cache-stability pin. `prefix-probe.mjs --equivalence --base <HEAD worktree>` compared 54 answer-path requests: `status: different` for `preset-r1` and `passive-only` (the enrichment and timeline removals change recall results), `mergeWithPreChangeCells: false`, so those arms' pre-removal cells can never be merged with new ones. `readiness.mjs --cache-stability`: 29 pass, 0 fail, and the 202 pin (`docs/_evidence/memory-bench/202/cache-stability/{equivalence,record}.json`) is re-attested to the new hash. `slimmed_record_lists_every_removal_and_passes_cache_pin` checks the record in `readiness.test.mjs`. No paid call ran.
    - **Performance (measured, offline).** Fabric source −15 files / −2,777 lines (−12.3%). Package load (module import plus `createAgent` with the `conversational` preset, mock provider, 11 runs per tree, `HEAD` worktree against this tree): 77–108 ms before, 83–135 ms after, medians 90 vs 95 ms, no measurable change. Per-turn work (200 turns, same setup): p50 8.1–11.8 ms before, 8.6–11.6 ms after, medians 9.9 vs 10.1 ms; p95 about 17–19 ms in both. The reduction is in source and surface, not in work: nothing removed ran in the shipped presets, and the three measured removals trim recall output size rather than time. `scripts/budgets.json` has no fabric row to ratchet, so it is unchanged.
    - **Findings that affect later tasks.**
      - **Plan 223 Task 3 / the held state-grouping feature.** `sameSubject` groups archived exchanges by their `keywords`, which the removed enrichment wrote. The archive now writes none, so exchange subject grouping fires only for exchanges that carry keywords (imports, `remember`). Keyed notes and `supersedes` still group. The two approved decisions interact: the owner held state grouping as experimental, and removing enrichment all but turns off its exchange branch. The README and migration page say so; plan 223 should read it as one finding, not two.
      - **Plan 216 Task 3.** `exchangeKeywords` (in `exchanges.ts`) is now used only by the ontology port; move it with the ontology. The removal of `openScope` also dropped the one place that attached an unbound project's `Memory` to the ontology cascade during maintenance.
      - **Plan 219.** Writes still cannot target `agent` (the rule held; the reason in the code is now "not writable", not "widening-only"). `contradictedIn` is written, never acted on.
      - **Pre-existing failures, not caused here.** `@arnilo/prism-memory-wiki` `package_metadata_ships_one_entry_and_no_bin_or_skills` and `retired_wiki_names_absent_repo_wide` fail identically on a clean `HEAD` worktree (peer range, and `packages/hosts/host-builder/skills/.../upgrading.md` names `wiki_search`). `bun scripts/release.mjs gate` is red on the kernel size ceilings before and after.
    - **Checks.** `packages/memory/fabric`: `tsc` clean, 606 pass, 0 fail (29 PostgreSQL integration tests skip without `PRISM_TEST_POSTGRES_URL`). `observational` 102, `core` 72, `rag` 100 pass. `bun run typecheck` (all workspaces) exit 0. `bun run --filter @arnilo/prism-agent test`: 63 pass. `scripts/memory-bench/audit/readiness.test.mjs` 11 pass; docs, host-builder and package-truth tests pass (`host_builder_index_is_fresh` needs `--timeout=0`, as the package scripts set).

- [ ] Task 7.1: Rename observational memory to episodic memory (added 2026-11-08, owner)
  - Notes: Dropped by plan 216 (2026-11-08, owner): Superseded by the memory model. The package becomes `@arnilo/prism-memory-system` (plan 216 Task 4), not `@arnilo/prism-memory-episodic`, because *episodic* is now a long-term memory kind (design §5.6). Design record: `docs/_evidence/memory-model/design.md`.
  - Owner direction (2026-11-08): "I also want to rename observational memory to working memory. Because I think it significantly deviates from Observational memory from Mastra. Validate this claim." After the validation below showed `working memory` is already a Prism and Mastra term for a different feature, the owner chose **Episodic memory**.
  - Validation of the claim (2026-11-08, Mastra docs via Context7 `/mastra-ai/mastra`: `docs/memory/observational-memory.mdx`, `docs/memory/overview.mdx`, `packages/memory/src/processors/observational-memory/ARCHITECTURE.md`):
    - **Shared today.** An observer model turns unobserved messages into dated, prioritised observations past a token threshold. A reflector condenses accumulated observations into reflections that replace the previous set (Mastra's "generation", Prism's superseded reflections). Older raw history is replaced while recent unobserved messages stay.
    - **Different today.** Prism's observations are tool-recorded with source entry ids and are recallable by id. Prism has a dropper, a task state and an append-only ledger. Prism injects memory at compaction, while Mastra replaces history continuously with a buffered observer.
    - **Different after Tasks 7.3–7.5.** The roles change. The observer becomes an event log with locally stored verbatim excerpts. The reflector derives episode-scoped facts from a host-supplied episode scope; Mastra's reflector compresses observations. The dropper deletes source chunks and promotes durable facts to fabric; Mastra has no dropper.
    - **Verdict:** the claim holds for the redesigned product, so the rename lands with it.
    - **Why not `working memory`.** Mastra's "Working memory" is a persistent per-thread or per-resource scratchpad updated by the agent. Prism already ships the same idea under that name: `WorkingMemoryStore` and `WorkingMemoryRecord` in `packages/memory/core/src/types.ts`, and `working/<thread>.md` in `packages/memory/core/src/fabric/okf.ts:288`.
  - Acceptance Criteria:
    - Functional: The package `@arnilo/prism-memory-observational` becomes `@arnilo/prism-memory-episodic` (directory `packages/memory/episodic`). Every public name moves with no alias:
      - exports (`createObservationalFlush` → `createEpisodicFlush`, `ObservationalMemory*` → `EpisodicMemory*`, `runObserver` and friends keep their role names);
      - commands (`om`, `om:model`, `om:status`, `om:view` → `episodic`, `episodic:model`, `episodic:status`, `episodic:view`);
      - the event (`om.status` → `episodic.status`);
      - state and ledger keys and record types (`om.*` → `episodic.*`);
      - the rendered heading (`# Observational Memory` → `# Episodic Memory`);
      - the context-block title and source tag;
      - config field names that say "observational".
      Role names (observer, reflector, dropper) and the observation and reflection vocabulary stay.
    - Functional: Callers move in the same task:
      - fabric and wiki imports and the `observational` option of `createMemoryFabric` (→ `episodic`);
      - presets and `defaults.json`;
      - the reference host (`apps/prism-agent`);
      - host-builder data (`packages/hosts/host-builder/data/examples/observational-memory.ts`, `autonomous-coding-loop.ts`, its indexes);
      - examples;
      - the memory-bench configs (`om`, `om+fabric` → `episodic`, `episodic+fabric`), `ablations.mjs`, `variants.mjs` path keys and `cleanup-campaign.mjs` arm ids for later waves.
      Task 5's finished evidence keeps its recorded names; it is history.
    - Functional: Repo-wide sweep over `src/ packages/ apps/ scripts/ examples/ docs/ README.md PRODUCT.md roadmap.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`). No `observational`, `Observational` or `om:` identifier remains except in the CHANGELOG's rename entry and the migration notes.
    - Functional: A host config that still names `@arnilo/prism-memory-observational`, or uses an `om` key, fails with a named error and a migration hint. `docs/migrate-to-0.13.md` gains the rename row.
    - Functional: npm. If the old name was published on the experimental line (plan 215), the publish plan records `npm deprecate @arnilo/prism-memory-observational "renamed to @arnilo/prism-memory-episodic"` as an owner action. Nothing is published by this task.
    - Performance: Rename only; budgets unchanged (`scripts/budgets.json` keys renamed).
    - Code Quality: `git mv` keeps history. Workspace, tsconfig references, `package.json` `exports`, release manifests and package lists are updated. The compat baseline is renamed and regenerated, with the diff attributed (all renames).
    - Security: Capability declarations are unchanged. The sweep includes the redaction and security docs that name the package.
  - Approach:
    - Documentation Reviewed:
      - the Mastra docs listed above;
      - `packages/memory/core/src/{types.ts,fabric/okf.ts}`;
      - `graft callers` over the package's exports;
      - the release and package-list scripts (`scripts/release.mjs`, `scripts/compat-baseline/`).
    - Options Considered:
      - `working memory`. Rejected: it collides with Prism's and Mastra's existing working memory.
      - `session memory`. Offered; the owner chose `episodic`, which matches the episode scope introduced in Task 7.4.
      - Keep the old name with a doc note. Rejected by the owner.
    - Chosen Approach:
      - One mechanical rename first, so Tasks 7.2–7.6 are written against the final names.
    - API Notes and Examples:
      ```ts
      import episodicMemory from "@arnilo/prism-memory-episodic";
      await agent.commands.run("episodic", {}, { session });
      ```
    - Files to Create/Edit:
      - `packages/memory/observational/**` → `packages/memory/episodic/**`;
      - fabric, wiki, core callers;
      - `apps/prism-agent/**`;
      - `packages/hosts/host-builder/**`;
      - `examples/**`;
      - `scripts/memory-bench/**`;
      - `scripts/compat-baseline/arnilo__prism-memory-episodic.txt` (from the old file);
      - root workspace and release lists;
      - `docs/**`, `PRODUCT.md`, `docs/migrate-to-0.13.md`;
      - CHANGELOGs.
    - References:
      - the owner decision above.
  - Test Cases to Write:
    - `observational_names_absent_repo_wide`
    - `old_package_name_in_host_config_fails_with_rename_hint`
    - `episodic_commands_and_status_event_registered`
    - The existing package suites pass under the new name.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package and command names.
    - Docs pages to create/edit:
      - the package README (title, scope sentence);
      - fabric, wiki and core READMEs;
      - `docs/index.md` package list;
      - `docs/migrate-to-0.13.md`;
      - `PRODUCT.md`;
      - CHANGELOGs.
    - `docs/index.md` update: yes — package name.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7.2: Episodic memory — package wiring and pass robustness (added 2026-11-08, owner; from the OM mechanism review)
  - Notes: Dropped by plan 216 (2026-11-08, owner): Its three fixes (worker settings forwarded, oversized tails batched with per-batch coverage, honest worker tool results) carry unchanged into plan 216 Task 4. Design record: `docs/_evidence/memory-model/design.md`.
  - Context: an owner-requested review of the package on 2026-11-08 found defects that do not depend on the role redesign in Tasks 7.3–7.5. They land first, so the redesign starts from a pass that cannot stall and a package that forwards its settings. No product change lands while Task 5 runs: the campaign pins its source revision (`c1-supervise.sh`), and Tasks 7.1–7.6 start only after Task 5's wave 3 OM arms finish.
  - Acceptance Criteria:
    - Functional: **The package forwards worker settings.** Today `index.ts` (`clientFor`, and the calls in `flush.ts:117`, `flush.ts:146` and `flush.ts:170`) passes no `instruction`, `secrets`, `thinkingLevel` or `providerOptions` to the workers. The library path accepts them (`settings.ts:8–80`), but a package user only ever runs the default prompts. After this task:
      - the package config accepts `observer.instruction`, `reflector.instruction` and `dropper.instruction` (appended to the default prompt);
      - it also accepts `observer.thinkingLevel`, `reflector.thinkingLevel` and `dropper.thinkingLevel`;
      - every worker call carries the session's secret set.
      A test fails if any worker request lacks the configured instruction, or if a secret appears in a worker request.
    - Functional: **A large unread tail no longer stalls observation.** Today the observer serializes the whole unread tail into one prompt (`observer.ts:166–169`). If the tail exceeds `worker.maxMessageBytes` (1 MB), `joinWorkerText` or `serializeSourceEntries` throws before the coverage cursor moves, and every later pass retries a larger tail. After this task:
      - the pass splits the eligible tail into ordered batches that each fit the budget, and advances `coversUpToId` after each recorded batch;
      - a single entry larger than the budget is sent truncated, with a marker naming the entry id and its full size;
      - a failed batch leaves coverage at the last recorded batch.
    - Functional: **Worker tools report rejection.** `record_reflection` (`reflector.ts:66`) and `drop_observations` (`dropper.ts:64`) answer `{ ok: true }` even when they stored nothing. Each worker tool returns `ok: false` with a named reason (`no_valid_ids`, `unknown_id`, `empty_content`, …) whenever the record was not stored, so the model can correct itself.
    - Performance: No added model call. Batching adds one ledger append per batch, only on a tail that previously failed. The `session-turn-overhead` budget row is unchanged.
    - Code Quality:
      - New config fields are typed, schema-validated and tagged `contract` (instructions) or `tuning` (thinking level).
      - `settings.ts` and the package config resolve through one helper.
      - Compat baseline regenerated.
    - Security: Secrets come from the kernel's secret set, never from config text. Instructions cannot widen the tool set. A truncation marker never includes the truncated bytes.
  - Approach:
    - Documentation Reviewed:
      - `src/{index,flush,worker-loop,limits,serialize,settings,config}.ts`;
      - `workers/*`;
      - `src/packages/api.ts:76–188`.
    - Options Considered:
      - Raise `maxMessageBytes`. Rejected: it moves the cliff.
      - Drop the oversized tail. Rejected: it loses evidence silently.
    - Chosen Approach:
      - Batch by bytes with per-batch coverage, forward settings through one resolver, and return honest tool results.
    - API Notes and Examples:
      ```ts
      episodicMemory({ observer: { thinkingLevel: "low" }, reflector: { instruction: "…" } });
      ```
    - Files to Create/Edit:
      - `packages/memory/episodic/src/{index,flush,config,settings,serialize}.ts`;
      - `workers/*`;
      - tests (`workers`, `coverage`, `settings`);
      - README (`## Configuration`, `## Cost, security, and failure behavior`);
      - CHANGELOG;
      - compat baseline.
    - References:
      - the 2026-11-08 review.
  - Test Cases to Write:
    - `package_workers_receive_configured_instruction_thinking_and_secrets`
    - `oversized_unread_tail_is_observed_in_batches_and_coverage_reaches_the_end`
    - `single_entry_larger_than_budget_is_truncated_with_marker_and_cited`
    - `failed_batch_leaves_coverage_at_last_recorded_batch`
    - `worker_tools_return_ok_false_with_reason_when_nothing_is_stored`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config fields; tool results.
    - Docs pages to create/edit:
      - the README sections above;
      - CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7.3: Episodic memory — the observer records what happened, with verbatim source chunks in a deletable local store (added 2026-11-08, owner)
  - Notes: Dropped by plan 216 (2026-11-08, owner): Carried into plan 217 (STM): events not facts, verbatim chunks in a deletable store, scope-blindness and outcome records; plus habituation and event boundaries. Design record: `docs/_evidence/memory-model/design.md`.
  - Owner direction (2026-11-08):
    - "the observer is not for facts. The observer is for recording everything that is happening. It then records observations with id and a description of what happened with enough information such that later a model can understand if this observation and its details are useful for a later task."
    - Each observation is "scoped with a chunk from the original text and saved locally so that recall can also for example look into the results of a particular tool call without actually running that tool or bash command again. It could be also a snippet of a code that the model read before."
    - For continuity, it records "what was changed and achieved in a particular task so that the next task, if it has a relevance to the previous task, can directly know this without grepping the codebase."
    - The observer does **not** see the episode scope (Task 7.4).
  - Acceptance Criteria:
    - Functional: **Role.** The observer records events, not facts. `DEFAULT_OBSERVER_INSTRUCTION` (`observer.ts:17`) is rewritten so that the observer records every meaningful thing that happened in the batch, in order:
      - user requests and statements;
      - actions the agent took (tool calls, commands, files read or edited);
      - results (tool output, test results, errors);
      - decisions and their reasons;
      - task outcomes.
      Each description is self-contained enough that a later model, seeing only the description, can judge whether the observation and its chunks are useful for a new task. The prompt no longer says "Find durable source-backed facts".
    - Functional: **The observer is scope-blind.** Its request never contains the episode scope (Task 7.4) or any fact. It sees only the batch, the task state, and an index of recent observations. A test fails if an episode-scope string appears in an observer request.
    - Functional: **Continuity of tasks.** When a task or sub-task completes or is abandoned, the observer records an `outcome` observation. It states:
      - what was asked;
      - what changed, naming the files, symbols, commands, config keys or ids touched;
      - what was achieved or left unfinished;
      - how it was verified (tests or commands run and their result).
      The offline continuity fixture (Task 7.6) asserts that task B, related to task A, is answered from episodic memory with no `grep`, `read` or `bash` call that re-derives what A changed.
    - Functional: **Observation shape.** `record_observation` takes:
      - `kind`: one of `request`, `action`, `result`, `change`, `decision`, `outcome`, `error`, `statement`;
      - `description`: one line, shown in context; renamed from `content`, no alias;
      - `sourceEntryIds` (required);
      - `chunks`: optional, up to `observer.maxChunksPerObservation`;
      - `referencedAt`, `relevance`, `supersedes`.
      `MemoryObservation` gains `kind` and `chunkRefs` (an id, the source entry id, a sha256 and the byte length of each stored chunk).
    - Functional: **Chunks are verbatim.** Each chunk is `{ sourceEntryId, text }`: the part of a tool result, command output, code read or message that the description refers to.
      - The package accepts a chunk only if `text`, after whitespace normalisation, is a substring of that source entry's serialized content; otherwise the tool returns `ok: false` with `chunk_not_verbatim`.
      - Each chunk is capped at `observer.maxChunkBytes` (default 4 KB, `tuning`) and redacted with the session's secrets before it is written.
    - Functional: **Chunks live in a deletable local store, never on the session branch.** The session branch is append-only, so a chunk written there could never be deleted. Owner decision 2026-11-08: only the dropper deletes, and only these chunks; the raw transcript is the kernel's record and is not touched.
      - Chunks go to an `EpisodicChunkStore` (`put`, `get`, `delete`, `list(sessionId)`) owned by this package. Its default implementation is a local SQLite file through memory-core's local store helpers, in the host's data directory. A host may supply another implementation.
      - The ledger carries only `chunkRefs`.
      - `delete` is a hard delete. The test reads the store file after the drop and finds no chunk bytes, and the store compacts or vacuums so deleted bytes are not left in free pages.
      - Fork and clone: a forked session reads its parent's chunks by reference. A chunk is deleted only when no live session that references it still holds the observation, using reference counting by session.
    - Functional: **Recall reads chunks without re-running anything.** `recall` with an observation id returns the description, kind, time, the stored chunks verbatim, and the source ids. A dropped chunk reads as `chunk dropped` with its drop reason. With `detail: "full"` it also returns the raw source entries. A test reads a tool result's chunk through `recall` after the original entry has left context, and asserts that no tool other than `recall` ran.
    - Functional: **Rendering.** The context block shows each observation as `- [id] HH:MM (kind, relevance) description`, with a `[chunk]` marker when chunks exist. It never shows chunk text; chunk text enters context only through `recall`.
    - Functional: **The observer's view for de-duplication.** Today it sees only the newest `dropper.targetTokens / 4` tokens of observations (`flush.ts:124`). It now sees an index of recent observations (id, kind, first 120 characters) within `observer.contextTokens` (default 4,000, `tuning`), and is told to use `supersedes` instead of re-recording an event.
    - Functional: **Consumers move in the same task.** Fabric and wiki read observations as facts today (`packages/memory/fabric/src/consolidation/gather.ts` takes high-relevance observations; `create.ts:369–378` builds `episode` from an observation; `packages/memory/wiki/src/consolidate/pass.ts`). They read the new shape:
      - episodes come from observations (description and kind);
      - fact candidates from reflections (completed in Task 7.4).
      The memory-bench ablation patches (`scripts/memory-bench/variants.mjs`) are updated, and their probes pass.
    - Performance:
      - The task reports, on the offline long-session fixture:
        - chunk bytes stored per 10,000 eligible tokens;
        - added observer output tokens;
        - one chunk-store transaction per pass.
      - Default caps keep stored chunks under 25% of the transcript bytes they cover. That trade-off and the knobs go in the README cost section.
      - `context.build` cost is unchanged.
    - Code Quality:
      - One module (`chunks.ts`) owns validation, the store contract and the default store; `recall.ts` reads through it.
      - `content` → `description` with no alias.
      - Compat baselines for episodic, fabric and wiki are regenerated.
    - Security:
      - Chunks are redacted before they are written; the verbatim check prevents invented evidence.
      - The default store file is created with mode 0600 under the host's data directory.
      - `recall` reads only chunks referenced by the executing session.
      - Chunks never enter the context block or fabric's shared stores.
  - Approach:
    - Documentation Reviewed:
      - `workers/observer.ts`, `recall.ts`, `recall-tool.ts`, `render.ts`, `ledger.ts`, `types.ts`;
      - `src/packages/api.ts:153–166` (`state.log` is append-only on the branch, which is why chunks cannot live there);
      - memory-core's SQLite store (`packages/memory/core/src/sqlite/index.ts`);
      - fabric `consolidation/gather.ts`, `create.ts:360–420`;
      - wiki `consolidate/pass.ts`.
    - Options Considered:
      - Store chunks in `state.log`. Rejected: package-state entries persist on the append-only branch, so the dropper could never delete them.
      - Store offsets into the raw entry. Rejected: no independent redaction or deletion, and offsets dangle if a host prunes large tool results.
      - Choose chunks heuristically. Rejected: only the model knows which part its description refers to.
    - Chosen Approach:
      - Model-chosen verbatim chunks, validated and redacted by the package, in a deletable local store referenced from the ledger.
    - API Notes and Examples:
      ```ts
      { kind: "outcome", description: "Campaign retries: interrupted attempts no longer count toward maxAttempts (campaign.mjs retryUncounted); 35 campaign tests pass.",
        sourceEntryIds: ["e41", "e47"], chunks: [{ sourceEntryId: "e47", text: "Ran 35 tests across 3 files. 0 fail" }], relevance: "high" }
      ```
    - Files to Create/Edit:
      - `packages/memory/episodic/src/{workers/observer,types,ledger,flush,render,context,recall,recall-tool,config,index}.ts`;
      - new `src/chunks.ts` and tests;
      - fabric `consolidation/{gather,extract}.ts`, `create.ts`, `context.ts`, `blocks.ts` and tests;
      - wiki `consolidate/pass.ts`, `extension.ts` and tests;
      - `scripts/memory-bench/{variants,ablations}.mjs`, `mechanism-probes/om.mjs`;
      - host-builder example;
      - READMEs and CHANGELOGs;
      - compat baselines.
    - References:
      - owner direction;
      - Tasks 7.1–7.2.
  - Test Cases to Write:
    - `observer_prompt_records_events_not_facts`
    - `observer_request_never_contains_episode_scope_or_facts`
    - `outcome_observation_names_changes_and_verification`
    - `chunk_must_be_verbatim_substring_of_cited_entry`
    - `chunk_is_redacted_capped_and_never_written_to_the_session_branch`
    - `chunk_store_delete_is_hard_and_respects_fork_references`
    - `recall_returns_tool_result_chunk_without_rerunning_any_tool`
    - `context_block_never_renders_chunk_text`
    - `observer_sees_recent_observation_index_within_budget`
    - `fabric_and_wiki_read_the_new_observation_shape`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — observation shape, tool schema, chunk store, recall output.
    - Docs pages to create/edit:
      - episodic README (`## Observations`, `## Ledger`, new `## Chunks`, `## Cost, security, and failure behavior`);
      - fabric and wiki READMEs;
      - `PRODUCT.md` where it describes this memory tier;
      - CHANGELOGs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7.4: Episodic memory — the episode scope, and a reflector that derives episode-relevant facts (added 2026-11-08, owner)
  - Notes: Dropped by plan 216 (2026-11-08, owner): Carried into plan 218 (episode scope and WM). The ratio is pressure, the STM surface is tombstoned rather than deleted, and edits are incremental only. Design record: `docs/_evidence/memory-model/design.md`.
  - Owner direction (2026-11-08):
    - "The reflector is actually supposed to gather facts from the observations."
    - "scope of episodic memory should be definable. Not programmatically. Rather it is telling the model what we are trying to achieve in this particular episode. For example: a host could deliver a plan document. The observer should not know this. The reflector should. So when it filters important information, it also takes what will be done in the future as part of this session till when the memory will live is known to it and it only retains observations that are relevant within that episode."
    - "The reflector also keeps the original content so that if the model wants, it can see it later." Owner decision 2026-11-08: a chunk cited by a live fact is protected from deletion until that fact is itself dropped or superseded.
  - Acceptance Criteria:
    - Functional: **Episode scope.** A host or user sets the episode scope as natural-language text, for example a plan document or a goal and its planned steps:
      - with the `episode:scope` command (text, or a file path the host resolves);
      - or with the package config's `episode.scope` at session start.
      Rules:
      - Replacing the scope appends an `episodic.scope.set` record (hash, byte length, time).
      - The text is bounded by `episode.maxScopeBytes` (default 32 KB, `tuning`) and redacted.
      - Scope text is stored in the session's package state; it is the host's input, not a chunk.
      - Only the reflector and the dropper receive the scope. The observer never does (Task 7.3 test).
      - With no scope set, the reflector and dropper are told the episode is the session's current work as shown by the task state.
    - Functional: **Reflector role.** `DEFAULT_REFLECTOR_INSTRUCTION` (`reflector.ts:8`) is rewritten. With the episode scope (including what is planned for the rest of the episode), the current facts and the new observations, the reflector:
      1. derives facts that hold beyond the event that produced them and matter within the episode, including future planned work;
      2. gives every new observation a retention verdict: `relevant` (needed for the episode's remaining work) or `not-relevant` (finished or outside the episode), with a one-line reason.
      The reflector deletes nothing. Its verdicts are the dropper's input (Task 7.5). It no longer "rewrites the entire memory log".
    - Functional: **Fact shape.** `record_reflection` takes `content`, `supportingObservationIds`, `scope` (`episode` or `project`), `relevance`, and `supersedes`. `MemoryReflection` gains these fields.
      - `episode` means useful for this episode's work.
      - `project` means durable beyond the episode: conventions, how the code or system now works, user preferences, decisions in force.
      `mark_observations` records the retention verdicts.
    - Functional: **The reflector keeps the original content.** Every fact's supporting observations, and their chunks, are protected while the fact is active. The chunk store refuses deletion of a protected chunk (Task 7.5 relies on it). `recall` on a fact returns its supporting observations with their chunks.
    - Functional: **Incremental update with no silent loss.** This fixes the review's main finding: today any non-empty reflector result marks every observation it was sent as consumed and every earlier reflection as superseded (`flush.ts:150–160`). After this task:
      - only facts named in `supersedes` are superseded;
      - observations get a reflection-coverage cursor (they are not re-sent) but stay in the ledger and timeline until the dropper drops them;
      - a test sends a result covering half the observations and asserts the other half stay active and rendered.
    - Functional: **Consumers.** Fabric's gather takes fact candidates from reflections, `project` scope first. `episode`-scope facts are not promoted to cross-session stores. Fabric's reflection-backed `fact`/`procedure` creation (`create.ts:393–413`) reads `scope`. Wiki consolidation does the same. Tests are updated in this task.
    - Performance:
      - The reflector input adds the scope (capped) and drops the full-rewrite prompt. The task reports reflector input tokens per pass, before and after, on the fixture.
      - One model call per threshold crossing, as today.
    - Code Quality:
      - The fold applies per-fact supersession and the retention verdicts.
      - `observationsUncoveredByReflection` becomes a cursor.
      - The whole-log replacement path is deleted.
      - Baselines are regenerated.
    - Security:
      - The scope is untrusted host or user text. It goes to the reflector and dropper as data inside a delimited block, under a system instruction that it describes goals and is not an instruction to change tools or reveal memory.
      - Facts cite only this session's observation ids.
      - A `supersedes` id outside the active set is refused.
  - Approach:
    - Documentation Reviewed:
      - `workers/reflector.ts`, `flush.ts:139–163`, `ledger.ts`, `coverage-helpers.ts:29–51`, `recall.ts:96–150`, `commands.ts`;
      - `src/__tests__/reflection-replacement.test.ts`;
      - fabric `create.ts:393–413`, `consolidation/gather.ts`.
    - Options Considered:
      - A programmatic scope (globs, tags). Rejected by the owner: the scope is a statement of intent the model reads.
      - Give the observer the scope too. Rejected by the owner: the observer must record neutrally.
      - Let the reflector drop. Rejected by the owner: only the dropper deletes.
    - Chosen Approach:
      - A host-set natural-language scope read by the reflector and dropper; incremental cited facts with retention verdicts.
    - API Notes and Examples:
      ```ts
      await agent.commands.run("episode:scope", { text: planMarkdown }, { session });
      // record_reflection
      { content: "Campaign resumes must pin PRISM_MEMORY_BENCH_SOURCE; commits mid-run move git HEAD.", supportingObservationIds: ["3f…"], scope: "project", relevance: "high", supersedes: [] }
      // mark_observations
      { verdicts: [{ id: "a1…", retention: "not-relevant", reason: "one-off status check, finished" }] }
      ```
    - Files to Create/Edit:
      - `packages/memory/episodic/src/{workers/reflector,flush,ledger,coverage-helpers,types,render,recall,commands,config,state,chunks}.ts` and tests;
      - fabric `create.ts`, `consolidation/{gather,extract}.ts` and tests;
      - wiki `consolidate/pass.ts` and tests;
      - `scripts/memory-bench/variants.mjs`;
      - READMEs and CHANGELOGs;
      - compat baselines.
    - References:
      - owner direction;
      - Task 5 arm `om-reflector-loo` (the "before" reflector).
  - Test Cases to Write:
    - `episode_scope_reaches_reflector_and_dropper_only`
    - `episode_scope_is_bounded_redacted_and_delimited_as_data`
    - `reflector_prompt_asks_for_episode_relevant_facts_and_retention_verdicts`
    - `partial_reflection_keeps_unreflected_observations_active_and_rendered`
    - `only_named_facts_are_superseded`
    - `chunks_cited_by_active_facts_are_protected`
    - `fact_scope_round_trips_through_fold_render_and_recall`
    - `fabric_promotes_project_facts_not_episode_facts`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new command and config, reflection shape and lifecycle.
    - Docs pages to create/edit:
      - episodic README (new `## Episode scope`, `## Reflections`, `## Commands`);
      - fabric README (promotion inputs);
      - CHANGELOGs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7.5: Episodic memory — the dropper deletes what the episode no longer needs and keeps durable facts (added 2026-11-08, owner)
  - Notes: Dropped by plan 216 (2026-11-08, owner): Carried into plan 219 (Rehearsal). Chunks are deleted by reference count across tiers, writes go to typed LTM candidates, and episode end is the main trigger. Design record: `docs/_evidence/memory-model/design.md`.
  - Owner direction (2026-11-08):
    - The dropper today "is just asked to follow a budget without any instructions on what to drop. This I think is concerning."
    - It "should be given the instructions to drop observations, mid-session based on the session scope from that particular session and at the end of the session, in the context of the whole project and codebase."
    - "even when an observation is dropped mid session because it is not relevant to the session anymore, it can decide that it is a durable fact and keep it separately. May be in the fabric somehow."
    - "only the dropper drops the original session content from local storage … when drops something, it should delete the chunk relevant to that observation and essentially convert everything it drops to durable facts if applicable and relevant to the session or the overall project."
    - Owner decisions 2026-11-08:
      - deletion covers the episodic chunk store only, never the raw transcript;
      - chunks cited by a live fact are protected;
      - the end-of-episode pass runs on an explicit signal.
  - Acceptance Criteria:
    - Functional: **Mid-episode pass.** It runs when active observations exceed `dropper.targetTokens`, or after a reflector pass that marked observations `not-relevant`. The dropper receives:
      - the episode scope;
      - the active facts;
      - the observations with their retention verdicts and chunk sizes.
      `DEFAULT_DROPPER_INSTRUCTION` (`dropper.ts:6`, today one sentence about the budget) is rewritten with explicit criteria.
      - **Drop:** observations the episode's remaining work does not need (finished one-off steps, intermediate output, superseded events, duplicates).
      - **Keep:** observations the remaining planned work needs, unresolved failures and open questions, and anything the task state or an active fact cites.
      - **Budget:** a target, not a reason to drop needed observations.
    - Functional: **Every drop decides on a durable fact first.** `drop_observations` takes `{ id, reason, fact? }` items:
      - `reason` is one of `episode-finished`, `out-of-scope`, `superseded`, `duplicate`;
      - `fact` is optional: `{ content, scope: "episode" | "project", relevance }`.
      The package then:
      1. records any `fact` as a reflection citing the dropped observation, which stays in the ledger without its chunk;
      2. marks the observation dropped;
      3. deletes its chunks from the chunk store, unless an active fact protects them (Task 7.4). Protected chunks are deleted when their last protecting fact is dropped or superseded.
      Dropped observations stay in the ledger with id and description, and `recall` reports `chunk dropped` and the reason.
    - Functional: **Project facts reach fabric.** When fabric is installed (resolved via `prism.services.consume`), a `project`-scope fact is offered to fabric's reflection-backed promotion (`create.ts:393–413`) under fabric's own promotion policy, and fabric records whether it accepted. Without fabric, the fact stays as an episodic `project` fact and `episodic:status` lists it as unpromoted.
    - Functional: **End-of-episode pass.** The `episode:end` command (or the equivalent host API) runs one final dropper pass in the context of the whole project and codebase, not the episode. It:
      - keeps or promotes `project` facts;
      - drops `episode` facts and the observations only they needed, deleting their chunks;
      - records an `episodic.episode.ended` record.
      If the session is disposed without `episode:end`, a bounded best-effort pass runs (one model call, time-limited); on failure it records that the pass was skipped. A new scope may then be set to start the next episode.
    - Functional: **Only the dropper deletes.** No other code path (observer, reflector, compaction, recall) calls the chunk store's `delete`. A test spies on the store across a full fixture run.
    - Functional: **Protections are enforced by the package, not the prompt.** Refused with `ok: false`, `protected`:
      - dropping an observation cited by the task state or an active fact;
      - dropping a `project` fact with relevance `high` or `critical` at episode end, unless the reason is `superseded` or `duplicate`.
      The deterministic policy (`lowest-relevance`) becomes: `not-relevant` verdicts first, then lowest relevance, then oldest. It honours the same protections and never writes facts.
    - Functional: **The dropper runs.** The review found it rarely fires (the reflector consumed observations before the active set crossed the target, and `config.ts` enforces `targetTokens >= observationTokens`). That validation rule is removed and the default is re-sized on the fixture. The offline fixture shows at least one mid-episode pass and one end-of-episode pass, with reasons, facts and deletions recorded.
    - Performance:
      - One dropper call per crossing, one per end-of-episode pass; the deterministic policy makes none.
      - Chunk deletion is one store transaction per pass.
      - The README cost section states the trade-off between the budget and the dropper's model calls.
    - Code Quality:
      - `dropObservationsToTarget`'s observation-only form and the old tool schema are replaced (no alias).
      - The `om.dropper.policy=lowest-relevance` ablation in `cleanup-campaign.mjs` and `variants.mjs` is updated.
      - Baselines are regenerated; repo-wide sweep for removed names.
    - Security:
      - Deletion is hard (Task 7.3 store test).
      - Promotion to fabric goes through fabric's existing gates and ACLs.
      - A dropper prompt cannot delete protected chunks.
      - The episode scope is data, not instructions (Task 7.4).
  - Approach:
    - Documentation Reviewed:
      - `workers/dropper.ts`, `flush.ts:165–190`, `memory-bounds.ts`, `strategy.ts:36–80`, `config.ts` validation;
      - fabric `create.ts:393–413` and its promotion policy;
      - Task 5 arm `om-dropper-deterministic`.
    - Options Considered:
      - Drop facts instead of observations. Superseded by the owner's 2026-11-08 clarification: the dropper drops observations, deletes their chunks, and turns what matters into facts.
      - Delete raw transcript entries too. Rejected by the owner (it needs a kernel contract for the append-only branch).
    - Chosen Approach:
      - A scope-guided dropper that converts before it deletes, with package-enforced protections, fabric promotion when present, and an explicit end-of-episode pass.
    - API Notes and Examples:
      ```ts
      { drops: [{ id: "a1…", reason: "episode-finished", fact: { content: "Bench retries live in campaign.mjs retryUncounted", scope: "project", relevance: "medium" } }] }
      await agent.commands.run("episode:end", {}, { session });
      ```
    - Files to Create/Edit:
      - `packages/memory/episodic/src/{workers/dropper,flush,config,render,context,strategy,memory-bounds,ledger,types,chunks,commands,index}.ts` and tests;
      - fabric promotion entry (if a service adapter is needed) and tests;
      - `scripts/memory-bench/{cleanup-campaign,variants}.mjs`;
      - READMEs and CHANGELOGs;
      - compat baselines.
    - References:
      - owner direction;
      - Tasks 7.3 and 7.4.
  - Test Cases to Write:
    - `dropper_prompt_states_drop_keep_and_fact_criteria_with_scope`
    - `drop_converts_to_fact_then_deletes_unprotected_chunks`
    - `protected_chunk_deleted_only_after_last_citing_fact_goes`
    - `project_fact_offered_to_fabric_under_its_promotion_policy`
    - `episode_end_pass_judges_against_project_and_records_end`
    - `dispose_without_episode_end_runs_bounded_best_effort_pass`
    - `only_the_dropper_calls_chunk_store_delete`
    - `deterministic_policy_order_and_protections`
    - `dropper_fires_mid_episode_and_at_end_on_fixture`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — dropper role, tool schema, `episode:end`, fabric promotion.
    - Docs pages to create/edit:
      - episodic README (`## Dropper`, `## Episode scope`, `## Cost…`);
      - fabric README (episodic promotion input);
      - CHANGELOGs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7.6: Episodic memory — long-session tests and paired measurement (added 2026-11-08, owner)
  - Notes: Dropped by plan 216 (2026-11-08, owner): Its offline probes are split across plans 217–219's fixtures. Its paired measurement becomes gates M-1 to M-3, against the `OM` arm moved from Task 5. Design record: `docs/_evidence/memory-model/design.md`.
  - Acceptance Criteria:
    - Functional: **Offline long-session fixture.** `scripts/memory-bench/mechanism-probes/om.mjs`, renamed `episodic.mjs` in Task 7.1, gains a replayed coding session of at least 6 tasks over at least 200 entries (offline and free). It has:
      - an episode scope (a plan document whose later steps depend on earlier ones);
      - related task pairs;
      - a large tool result;
      - a code read;
      - a user preference stated once;
      - a superseded fact;
      - an `episode:end`.
      Probes assert:
      1. every task ends with an `outcome` observation naming changes and verification;
      2. task B makes no `grep`, `read` or `bash` call that re-derives A's changes, and cites A's outcome id;
      3. `recall` returns the earlier tool output and code snippet verbatim from chunks, and no other tool runs;
      4. the observer never saw the scope;
      5. the reflector's retention verdicts follow the scope (steps planned later keep their inputs);
      6. the dropper converts before deleting, deletes only unprotected chunks, and protected chunks survive until their fact goes;
      7. the preference survives as a `project` fact through every pass and reaches fabric when installed;
      8. after `episode:end`, only project facts and their protected chunks remain, and the chunk store's bytes shrink accordingly;
      9. no pass throws on the oversized tail;
      10. nothing but the dropper deleted anything.
    - Functional: **Paid paired measurement under gate C-1.** The redesigned episodic memory runs against the pre-redesign OM on development partitions only:
      - QA: `beam-1m` and `longmemeval-m`, with the episode scope set to the suite's task framing;
      - work-outcome: plan 209's W legs.
      The "before" rows are Task 5's `OM` arm results, read from its evidence, not rerun. Pre-registered rules go into `cleanup-criteria.json` before any run:
      - non-inferior within 2 points on each QA suite;
      - non-inferior on W1–W6, with a gain on continuity (re-derivation calls per related task, lower is better).
      A miss goes to the owner, with per-task evidence, before Task 8. The spend is a C-1 amendment with its own budget, after the allowance resets.
    - Functional: **Task 6 record.** The OM worker rows in `decisions.md` read `fix-kept pending Task 7.6`; this task writes their final verdict.
    - Performance: The task reports, against Task 5's `OM` rows:
      - worker model calls and tokens per 10,000 eligible tokens;
      - chunk-store bytes at peak and after `episode:end`;
      - context-block bytes.
      A rise of more than 25% in worker tokens needs a written justification.
    - Code Quality: The arm runs through `cleanup-campaign.mjs` (a wave 4 `episodic-redesign` arm): same journal, source pin and retry machinery. No ad-hoc runner.
    - Security: Evidence carries counts, ids and hashes only, never chunk, scope, question, answer or claim text. Held-out partitions stay unread.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/mechanism-probes/{harness,run}.mjs`;
      - `cleanup-campaign.mjs` (waves, predictions);
      - `cleanup-criteria.json`;
      - plan 209's work-outcome runner.
    - Options Considered:
      - Offline only. Rejected: the owner's goal is long-session usefulness.
      - Rerun the before arm. Rejected: Task 5 already measured it.
    - Chosen Approach:
      - An offline fixture that proves each owner requirement mechanically, then one paired paid read.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only episodic
      scripts/memory-bench/c1-supervise.sh 4   # owner-started, after the C-1 amendment
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/mechanism-probes/episodic.mjs`, `probes.test.mjs`;
      - `scripts/memory-bench/fixtures/episodic-long-session/`;
      - `scripts/memory-bench/{cleanup-campaign.mjs,cleanup-criteria.json,README.md}`;
      - `docs/_evidence/memory-bench/210/{episodic-redesign/*,decisions.md,README.md}`;
      - `gates/owner-gate-c1.json` (amendment).
    - References:
      - Tasks 5, 6 and 7.1–7.5.
  - Test Cases to Write:
    - `episodic_long_session_probe_covers_every_owner_requirement`: fails if any of probes 1–10 is missing.
    - `episodic_redesign_before_rows_come_from_task5_evidence`
    - `episodic_redesign_rules_registered_before_first_attempt`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence and harness.
    - Docs pages to create/edit:
      - evidence README;
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Combined check and product freeze
  - Notes: Dropped (2026-11-08, owner): no further paid runs in this plan. The slimmed product's hash and cache-pin re-attestation moved to Task 7. The combined check moved to plan 223 Task 1, which bisects over this plan's removals on a miss. The freeze moved to plan 223 Task 1. The text below is kept as the record of the requirement.
  - Acceptance Criteria:
    - Functional: On the slimmed product:
      - every offline memory suite, the safety suite (offline, with plan 208's ontology probes), the prefix probe, the growth simulation (offline) and the mechanism probes pass;
      - a paired development run (inside gate C-1's reserved budget) shows the slimmed product non-inferior (2 points) to the pre-cleanup product on every suite and on W1–W6.
      A miss reverts the removal responsible, found by bisecting the removals.
    - Functional: ~~**Amended 2026-11-08 by Tasks 7.1–7.6.** The slimmed product includes episodic memory (the renamed and redesigned observational memory). The non-inferiority baseline stays the pre-cleanup product, and the freeze record lists Tasks 7.1–7.6 and the Task 7.6 verdict.~~ Superseded the same day.
    - Functional: **Amended 2026-11-08 (owner, memory model): development check only.**
      - The combined non-inferiority check covers this plan's removals: the fabric `conversational` and `coding` presets with Task 7's removals, against the pre-cleanup product, on development partitions and W1–W6.
      - OM and the ontology are outside the check: they are transferred.
      - The product hash freeze, the readiness record for held-out use and the "no product change before Task 9" rule move to plan 223 Task 1.
      - This task still records the slimmed product's hash and passes the readiness cache-stability pin for it, because plan 216 starts from that product and its behaviour-preservation checks compare against it.
    - Functional: The product is then frozen by product hash for Task 9:
      - the readiness cache-stability pin (plan 202 Tasks 4.11–4.15) passes for that hash;
      - `docs/_evidence/memory-bench/210/freeze/record.json` lists what the hash includes: every executed plan 202 lever, plan 207, plan 208 Task 5's tuning revision, plan 209 Task 6's tuning revision, and this plan's fixes and removals.
      No product change lands between the freeze and Task 9 except through the remediation round.
    - Performance: Load and per-turn cost deltas reported (Task 7).
    - Code Quality: The freeze record is generated by the existing readiness and manifest machinery; no hand-written hash.
    - Security: Safety suite green on the frozen product.
  - Approach:
    - Documentation Reviewed:
      - Tasks 5–7;
      - plan 202 Tasks 4.11–4.15 (cache-stable product, readiness pin);
      - plan 208 Task 5 and plan 209 Task 6 (their tuning revisions).
    - Options Considered:
      - Trust the per-feature ablations without a combined check. Rejected: removals can interact.
    - Chosen Approach:
      - One combined non-inferiority check, then one freeze that every held-out arm reads.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 210 --manifest --partition dev --arm slimmed-vs-pre
      timeout 600 bun scripts/memory-bench/readiness.mjs --freeze --out docs/_evidence/memory-bench/210/freeze/record.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,readiness}.mjs` (the `slimmed-vs-pre` arm and the freeze record) and tests;
      - `docs/_evidence/memory-bench/210/{final,freeze}/*`.
    - References:
      - Tasks 5–7; plan 202 Task 4.13.
  - Test Cases to Write:
    - `slimmed_product_non_inferior_report_rows`.
    - `freeze_record_lists_every_plan_revision_and_removal`.
    - `freeze_refuses_product_without_cache_stability_record`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Held-out acceptance of every memory claim on the final product (owner gate 3, paid)
  - Notes: Dropped by plan 223 (2026-11-08, owner): moved to plan 223 Task 2 (gate A). The final product is the rebuilt memory system plus the wiki. Every criterion here carries over in substance, with `memory-model-criteria.json` added to the one manifest. The text below is kept as the record of the requirement.
  - Moved here on 2026-10-31 from plan 202 Task 18, plan 208 Task 6 and the held-out part of plan 209 Task 7. Their criteria are unchanged in substance.
  - Acceptance Criteria:
    - Functional: The candidate is Task 8's frozen product. The arms are:
      - **robustness (plan 202):** the candidate (`conversational` revision 2) against `preset-r1`, `full` / `full-truncated` and `lexical-topk`; the `coding` preset (plan 202 Task 11, plus the plan 202 Task 12 points that shipped) against memory-off and `conversational` on the coding suites;
      - **ontology (plan 208):** `P+O` and `coding+O`, each paired against its own `P`;
      - **work outcome (plan 209):** memory-off, `P`, `P+W` and `P+W+O` on the work-outcome suite.
    - Functional: **Development handoff before acceptance.** Tasks 1–6 must account for every plan 202 closure row before Task 8 freezes the product. Task 9 does not supply missing development calibration or decide whether to build facts from its held-out results. Unmeasured or failed development rows remain explicit in Task 6's disposition and the final claim limits.
    - Functional: Every arm runs on:
      - every suite's `heldout-a` partition, read here for the first time;
      - every acceptance model (≥ 3 models, ≥ 2 providers, one small);
      - the judge panel, with repeats on the 100-item subset.
      Plan 202's safety gate (Task 14, including plan 208 Task 4's ontology probes) and growth criterion (Task 15) re-run on the frozen product.
    - Functional: **Plan 202 Task 5 hand-off (2026-11-01).** Plan 202 Task 5 closed on a development screen that excluded `longmemeval-m` and most of `beam-1m`, so the robustness arms must include `heldout-a` of both suites with no subsetting. A manifest that omits either one, or samples it, is refused even under budget pressure. The acceptance report names which plan 202 Task 5 deferral each of those rows discharges.
    - Functional: One manifest pins the product hash, `robustness-criteria.json`, `three-tier-criteria.json` and `work-outcome-criteria.json`, with every hash verified. Each verdict is one row per criterion, computed with no hand-set value:
      - `acceptance-report.mjs --plan 202`: `robust`, `better-than-full-context`, both, or neither, with the failing rows named;
      - `--plan 208`: O1–O8 and the outcome class;
      - `--plan 209`: the work-outcome rows, including `ontology-work` (O8).
      No verdict changes another verdict's rows.
    - Functional: A miss is reported as a miss. No post-hoc margin, partition or model swap; the manifest refuses criteria drift as 188.10's did.
    - Functional: **One remediation round** (release gating, header), under a fresh owner approval. It covers every plan's arms on `heldout-b` under the same manifest rules. There is never a second round.
    - Functional: **Cache-stable product (plan 202 Tasks 4.11–4.15).**
      - The frozen product hash includes Tasks 4.11–4.14, and the readiness cache-stability pin passes for it (Task 8).
      - The live multi-turn cache probe runs once per acceptance route under this gate, and its `cacheStability` row is reported next to the verdict.
      - The row is evidence for Task 10's cost wording only. It is never a criterion row, and BFC (iii) is computed exactly as `robustness-criteria.json` defines it.
    - Performance: Budget stated at the gate, with each plan's share of it. In-flight caps per arm; wall-time limit per suite stated and reported, with overruns recorded as deviations.
    - Code Quality: Existing campaign, journal and acceptance machinery, with the `--plan 202`, `--plan 208` and `--plan 209` profiles under one manifest.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - plan 202 Tasks 2–17 and its moved Task 18;
      - plan 208 Tasks 1–5 and its moved Task 6;
      - plan 209 Tasks 5–6 and its moved Task 7;
      - 188.10 Task 9 (manifest discipline).
    - Options Considered:
      - Accept on a subset of suites. Rejected: the definitions are the point.
      - One held-out run per plan. Rejected: it would spend held-out items several times and freeze several products.
      - Held-out acceptance before the audit (the order before 2026-10-31). Rejected by the owner: audit removals would then change an accepted product and need a second held-out read or dev-only claims.
    - Chosen Approach:
      - One frozen product, one held-out read, three criteria files.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 210 --manifest --partition heldout-a
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 202
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 208
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 209
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/{202,208,209}/acceptance/*`.
    - References:
      - Plan 202 Task 2; plan 208 Task 1; plan 209 Task 5; Task 8.
  - Test Cases to Write:
    - `acceptance_202_refuses_criteria_or_product_drift`.
    - `verdict_rows_match_criteria_file`.
    - `small_model_rows_present`.
    - `acceptance_208_rows_match_criteria_file`.
    - `acceptance_208_refuses_product_or_criteria_drift`.
    - `outcome_class_derived_without_hand_set_values`.
    - `acceptance_209_rows_match_criteria`.
    - `one_manifest_pins_all_three_criteria_hashes_and_the_freeze_hash`.
    - `acceptance_202_refuses_missing_or_sampled_longmemeval_m_or_beam_1m`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - `docs/_evidence/memory-bench/{202,208,209}/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 10: Preset revision 2, defaults, published claims and graduation from the experimental line
  - Notes: Dropped by plan 223 (2026-11-08, owner): moved to plan 223 Tasks 3 (preset, defaults, claims) and 4 (graduation). The packages that graduate are those plan 216 leaves: `memory-system`, `memory-core`, `memory-rag`, and the wiki outside memory. The text below is kept as the record of the requirement.
  - Moved here on 2026-10-31 from plan 202 Task 19, plan 208 Task 7 and the defaults part of plan 209 Task 7. Their criteria are unchanged in substance.
  - Acceptance Criteria:
    - Functional: **Preset revision (plan 202).**
      - If Task 9 passes **better-than-full-context** or **robust** (or both): `CONVERSATIONAL_PRESET_REVISION` becomes 2 and `conversational` resolves to the accepted candidate. Hosts on `preset: "conversational"` get it with **no config change**. A test asserts that a config written for revision 1 (the 188.11 README example) still validates and resolves to revision 2.
      - If it fails after the one remediation round, 0.13.0 ships the last passing revision. A lever that met its development target ships as a tuning-tier change only if Task 9 shows no regression for it. The README states the failing criteria.
      - `coding` ships in 0.13.0 if Task 9 passes its rows of robust (viii). Otherwise the owner decides here whether it ships as a documented, unaccepted opt-in or is withheld; either way the README states the failing rows.
    - Functional: **Memory default (plan 202).** Defaults change only if the safety gate **and** the robust verdict both pass. The candidate default is installing the fabric with `preset: "conversational"` on. Otherwise defaults stay off, and the failed criterion is named in `scripts/memory-bench/defaults.json` and the README.
    - Functional: **Ontology tier (plan 208).** The outcome class, together with the safety verdict, decides:
      - `beneficial` plus a passed safety gate: the reference host's coding and research agents set `ontology: true` by default. The wiki README, the fabric README `## Ontology tier` and `PRODUCT.md` state the measured benefit in the verdict's wording (models, judges, suites, cost, claim support).
      - `safe-neutral`: the tier ships opt-in. Docs say it was measured as neutral on accuracy, with its claim-support rate and cost, and no benefit is claimed.
      - `not-safe` or `harmful`: the tier ships opt-in with the failing rows named in the README's Known limitations. The reference host option stays off and is marked experimental.
      A tier that Task 6 moved to the experimental tier stays experimental whatever its class.
    - Functional: **Working-agent defaults (plan 209)**, only under the passed safety gate:
      - `rules.capture: "confirm"` joins `coding` (already there) and becomes the reference host default for both agents if W1 or W2 passes with no failing row;
      - `exchanges.steps` joins the `coding` preset as a new `presetRevision` if W1 passes;
      - `lessons.nudge` is on in the reference host only if W1 or W5 passes and W6 does not regress.
      Otherwise each stays opt-in, with the failing rows named. A feature Task 7 removed is not considered.
    - Functional: **Claims and positioning.**
      - Every README claim is a verdict's wording, with models, judges, suites, cost and latency. "Better than full context" may appear only if that row set passed.
      - The `coding` claim cites plan 209's work-outcome rows (repeated corrected mistakes, convention adherence, re-asked questions, orientation cost) beside plan 202's robust (viii) rows. "Memory improves work" appears only if `P` vs memory-off passes.
      - `PRODUCT.md`'s Memory subsection and the fabric README lead with standing rules, then search over the record, then the ontology tier.
      - Experimental-tier features are named as experimental and carry no claim.
    - Functional: `scripts/memory-bench/defaults.json` records every decision with its evidence hash. The preset revision, every default and every memory claim land in one change.
    - Functional: **Graduation from the experimental line (amended 2026-11-04, plan 215).**
      - The surviving memory packages leave the `experimental` list in `scripts/independent-packages.json` and take their first stable version on their independent line (the version is decided here; it sorts above `0.13.0-experimental.N`), published with dist-tag `latest`. Packages this plan removes entirely stay experimental or are deprecated, by owner decision recorded here.
      - Their compat baselines become strict (plan 215 Task 2's `experimental` classification no longer applies), and the experimental README notice (plan 215 Task 4) is replaced by the `## Compatibility` contract plan 188.11 wrote, now in force.
      - The live two-principal memory journey leg dropped from plan 215 Task 32 (ex-186 scenario 11) is added back as a live row and runs against the graduated revision; the cache-parity runner (plan 215 Task 23) measures the reference host with `memory` set.
      - The reference host's `memory` opt-in and the ontology default follow this task's verdicts; OM returns to the reference host's default path only if the verdicts support it.
      - The 188.11 limitations register (`docs/_evidence/memory-bench/188.11/limitations.json`) is closed: each entry is marked resolved with evidence, or carried into the README's Known limitations.
    - Functional: Plan end: Compromises, Further Actions and the backlog hand-off.
    - Performance: n/a.
    - Code Quality: Preset changes are object edits with a `presetRevision` bump. Reference host defaults are values in its config. No package default changes for the ontology: the tier is opt-in at package level by construction (installing `memory-wiki`). Compat baselines are regenerated with `bun scripts/release.mjs gate --update-baseline` if `CONVERSATIONAL_PRESET_REVISION`'s value or the preset table is in a baseline (`scripts/compat-baseline/arnilo__prism-memory-fabric.txt`), with the diff attributed in the note.
    - Security: A default that stores conversation content, or that adds background model calls over it, is enabled only under the passed safety gate. The READMEs state what is stored and what the curator sends to its model.
  - Approach:
    - Documentation Reviewed:
      - 188.11 Tasks 3 and 6 (preset contract, stability tiers);
      - Task 9 verdicts; plan 202 Task 14; plan 208 Task 1 outcome classes; plan 209 Task 5 criteria.
    - Options Considered:
      - Ship revision 2 as a new preset name. Rejected: that defeats the stable-API goal. The contract allows improvement within the name.
      - Turn the ontology tier on by default regardless, as the product's differentiator. Rejected: the 0.13.0 claims rule (188.11, 202) allows only measured claims, and an unmeasured default that sends conversation content to a curator model is a privacy cost too.
    - Chosen Approach:
      - The verdicts decide the revision, every default and the wording, in one change.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "conversational", tools: { root } }); // unchanged host line → revision 2
      await createCodingAgent({ ...config, memory: "coding" }); // ontology on only if the verdict allows
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/config.ts` (preset table) and tests;
      - `apps/prism-agent/src/host/config.ts` and its tests;
      - `scripts/memory-bench/defaults.json`;
      - `docs/_evidence/memory-bench/188.11/limitations.json`;
      - fabric, wiki and OM READMEs, `PRODUCT.md`, `apps/prism-agent/README.md`, `CHANGELOG.md`;
      - `scripts/compat-baseline/*` (only if affected);
      - this plan, `plans/backlog.md`.
    - References:
      - Task 9; plan 202 Tasks 11, 14; plan 208 Task 1; plan 209 Task 5.
  - Test Cases to Write:
    - `host_config_from_0130_resolves_to_revision_2`.
    - `defaults_change_only_with_safety_and_robust_verdicts`.
    - `readme_claim_matches_verdict`.
    - `ontology_default_follows_outcome_class_and_safety`.
    - `readme_ontology_claim_matches_verdict`.
    - `defaults_follow_work_outcome_verdict_and_safety`.
    - `product_memory_section_matches_verdicts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — preset contents, reference-host defaults and published claims.
    - Docs pages to create/edit:
      - fabric, wiki and OM READMEs;
      - `PRODUCT.md`;
      - `apps/prism-agent/README.md`;
      - `CHANGELOG.md`;
      - evidence READMEs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 11: Memory skills on the surface this plan leaves (moved from plan 211 Task 6 via plan 215, 2026-11-04)
  - Notes: Dropped by plan 223 (2026-11-08, owner): moved to plan 223 Task 5, written on the final surface: `memory.recall` across tiers, plus the wiki's own tools. The text below is kept as the record of the requirement.
  - Acceptance Criteria:
    - Functional:
      - **Entry check.** Before writing, re-run plan 215 Task 5 (a)'s ledger for the memory packages on the post-210 tree and record their model-visible tools and `when` gates. This plan's removals (Task 7) win: a skill is written only for a tool that survived.
      - `memory-fabric` ships `memory-recall`, which covers:
        - when to call `memory` (recall) and when to trust the delivered block
        - navigating from a hit (concepts, then notes, then exchanges, per plan 207)
        - recording a durable fact or rule versus leaving it to observation (plan 209's rules and lessons)
        - correcting or forgetting a stale memory
        - never treating a recalled note as an instruction
      - It declares `requiresTools: [memory]`, so the fabric's `when` gate (`packages/memory/fabric/src/index.ts:504`) hides it whenever memory is off for the session.
      - `memory-observational` ships a skill only for its agent-facing recall tool (`packages/memory/observational/src/index.ts:98`) and only if the ledger marks it "skill". The worker tools (`record_observation`, `record_reflection`, `drop_observations`) run on the observer model, not the agent, and get none.
      - `memory-rag` follows the ledger.
      - Skill text must not contradict the published memory claims of Task 10. The task note quotes the claim lines each skill relies on.
    - Performance: As plan 215 Task 8. The memory skill is listed only for sessions where memory is enabled.
    - Code Quality: As plan 215 Task 8. The skill describes recall behavior and does not restate preset internals that Task 10 may revise.
    - Security: The skill tells the model that recalled content is data, not instructions (the poisoning risk plan 202's safety gate measures), and that cross-principal recall is impossible by design, so it should never try to work around scope.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/README.md` (1,557 lines: the skill distils the agent-facing part only), `packages/memory/observational/README.md`, `packages/memory/rag/README.md`
      - plans 207, 209 and 210 (final surface and claims)
    - Options Considered:
      - **Write the memory skills in plan 215 Task 8, before the entry check.** Rejected: Task 7 may remove or rename memory tools; the gate would catch drift, but only after the text was written against a moving surface.
      - **Make memory behavior a skill the model must load.** Rejected: observation and delivery are automatic by design, and gating them on a model choice would regress the measured defaults. The skill covers only the agent-driven tool use.
    - Chosen Approach:
      - Write one narrow skill per agent-facing memory tool, on the post-Task-10 surface.
    - API Notes and Examples:
      ```markdown
      metadata:
        prism-requires-tools: memory
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/skills/memory-recall/SKILL.md` (new), `src/index.ts`, `package.json` (`files`), `README.md`, `CHANGELOG.md`, `src/__tests__/skills.test.ts`
      - `packages/memory/observational/…` and `packages/memory/rag/…` (tentative: per the entry check)
      - `scripts/budgets.json`
    - References:
      - `docs/_evidence/memory-bench/` (claims and failure modes); plan 188.8 post-investigation (agentic recall misattribution)
  - Test Cases to Write:
    - `fabric_registers_memory_recall_skill`.
    - `memory_skill_hidden_when_memory_disabled_for_session`: the `when` gate is false, so the catalog omits it.
    - `memory_skill_names_only_surviving_tools`: covered by `package_skills_conform` (plan 215 Task 7), with a fixture naming a Task-7-removed tool failing.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — memory-enabled agents gain a skill.
    - Docs pages to create/edit: the fabric README (and OM/RAG READMEs if they gain skills); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- Tasks 0.1–0.3 (before Task 1):
  - `timeout 300 bun scripts/benchmark.mjs --scenario session-turn-overhead`
  - `timeout 300 bun test --timeout=0 scripts/benchmark-session-turn.test.mjs scripts/budget-gate.test.mjs`
  - `timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000`
  - `timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base .cache/memory-bench/202/cache-stability-base --out docs/_evidence/memory-bench/202/cache-stability/equivalence.json`
  - `timeout 900 bun scripts/memory-bench/audit/readiness.mjs --cache-stability`
  - `timeout 900 bun run --cwd packages/stores/sqlite test` and `timeout 900 bun run --cwd packages/stores/jsonl test`
- Task 3.1 (before Task 4): `timeout 600 bun test --timeout=0 scripts/memory-bench/ceiling.test.mjs scripts/memory-bench/power.test.mjs`; `timeout 900 bun run --cwd packages/memory/fabric test` (each variant's probe, its byte-identical-when-unset test and its scope test); `timeout 1200 bun scripts/release.mjs gate --update-baseline` with the diff attributed to Task 3.1.
- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun run --cwd packages/memory/wiki test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs`
- ~~Tasks 7.1–7.6~~ (dropped 2026-11-08; plans 216–219 carry them)
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline --ontology`
- `timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (baseline diffs attributed)
- `timeout 300 bun test packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
- `timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/210/freeze/prefix-probe.json`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline`
- `timeout 900 bun examples/long-term-memory.ts`
- `timeout 300 bunx biome check <changed files>`
- Paid (amended 2026-11-08): none remaining. Wave 1 of Task 5 is complete; waves 2–3 are cancelled and Task 8 is dropped. Run `timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 210 --partition dev` (wave 1, no spend), then confirm no owned paid process remains. The episodic-memory read, the combined check, the held-out acceptance (gate 3) and the acceptance reports moved to plans 217–223.
- Task 7 (amended): `timeout 900 bun scripts/memory-bench/readiness.mjs --cache-stability` and `timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --out docs/_evidence/memory-bench/210/slimmed/equivalence.json`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
- (Recorded 2026-11-07 by Task 0.2; high priority, before Task 1.) Re-run the Task 0.2 paired markdown-scale comparison (HEAD fabric sources against the fix, three runs each, `--notes 1000,10000,50000`) on an idle machine. Task 0.2's "cold, warm and recall within 10%" criterion was not demonstrated, because every after-fix run was at load average 14–30. If a real open regression shows up, profile the cold 50k rebuild first: it is the largest observed gap.
- (Recorded 2026-11-07 by Task 3; medium priority, before Task 9.) The fabric README describes the exchange tier as "size-only demotion", but `memory:maintain` also archives raw exchanges by strength (`lifecycle/maintain.ts:514`). Task 5 measures the exemption. Whatever Task 6 decides, the README and the 202 growth evidence must state the actual rule. The growth "pass" compared two archived months: month-1 active retrieval is 0.5625 against 1.0 inclusive.
- (Recorded 2026-11-07 by Task 0.3; low priority, post-0.13.0.) The kernel's main per-turn cost on a long, uncompacted session is now `jsonBytes` (`src/agent-session/session/helpers.ts:147`): it stringifies the whole provider request to enforce `maxRequestBytes`, 83% of the 1,000-run profile. It is O(request) and the byte cap must stay. Measuring incrementally (bytes of the stable prefix carried between turns) could remove most of it. Real sessions compact long before this fixture's ~4 MB requests, so it matters only if a host profile shows it.
