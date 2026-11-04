# Phase 11 Part O16 — Memory feature audit and acceptance: measure, diagnose, justify or remove, then accept once before the freeze

## Objectives

- After every memory plan of the 0.13.0 train is built and screened on development partitions (188.x, 202, 207, 208, 209), audit **every memory feature** and decide, from evidence, whether it stays in the API-level-1 surface that plan 185 freezes. The features are mechanisms, config fields, kinds, tools, commands, workers, delivery tiers and preset contents.
- For each feature with **no measured benefit, a neutral result, or a negative impact**:
  1. **detect mechanism errors**: does it fire, does its effect reach the agent's context or ranking, is the effect what the design says;
  2. **analyse conceptual gaps**: what would have to be true for it to help, and is there a minimal change that could make it useful;
  3. **measure** the fixed variant once where a credible fix exists;
  4. **remove** it when no justification is found: no benefit, no safety role, no cost role, and no credible gap fix.
- Freeze a smaller memory surface whose every remaining feature has a recorded justification. Unmeasured mechanisms do not become permanent API-level-1 obligations.
- Then, on that final product, run the **one held-out acceptance** for every memory claim (plan 202's robustness rows, plan 208's ontology rows, plan 209's work-outcome rows), and set the preset revision, the defaults and the published claims from its verdicts. These were plan 202 Tasks 18–19, plan 208 Tasks 6–7 and plan 209 Task 7 until the owner moved them here on 2026-10-31.

## Expected Outcome

- `docs/_evidence/memory-bench/210/feature-ledger.json`: one row per feature with its owner package, default, preset membership, cost, the role it claims (accuracy, cost, safety, inspectability, compatibility), its evidence (file and hash) and its status (`benefit`, `neutral`, `negative`, `unmeasured`, `safety-proven`).
- Mechanism probes for every candidate (`scripts/memory-bench/mechanism-probes/`), offline and free, with verdicts `works`, `never-fires`, `no-effect` or `wrong-effect`.
- A gap analysis per candidate with a predicted, measurable effect for each proposed fix.
- `scripts/memory-bench/cleanup-criteria.json`: pre-registered decision rules, committed before the ablation campaign.
- One owner-gated ablation campaign (gate C-1): leave-one-out for preset members, add-one for opt-ins, and fixed variants, on development partitions of the robustness and work-outcome suites. Held-out partitions stay unread until Task 9.
- A decision record, approved by the owner. Removals land with deleted code, config fields, exports, docs and tests; regenerated baselines; a repo-wide sweep; and migration notes.
- A combined non-inferiority check and a product freeze (Task 8).
- One held-out acceptance under owner gate 3 (Task 9), with one verdict per criterion of `robustness-criteria.json`, `three-tier-criteria.json` and `work-outcome-criteria.json`, all on the frozen product.
- `conversational` revision 2 (or the last passing revision), the memory, ontology and working-agent defaults, `scripts/memory-bench/defaults.json`, and every README and `PRODUCT.md` memory claim, in one change (Task 10). The memory surface is handed to plan 184/185.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 16). **Owner decision 2026-10-31:** an end-of-build audit inside 0.13.0 identifies memory features with no measured benefit or a negative impact, detects mechanism errors, analyses conceptual gaps, and removes what cannot be justified. It runs as release step **17f**, the last plan of a strictly sequential memory train (owner decision 2026-10-31): 202 → 207 → 208 → 209 → **210** → 184 → 185.

- It starts after plan 209 Task 6, when every memory plan has development evidence and has listed its unjustified features for the ledger.
- It ends before plan 184 (cache parity, which measures the final product) and plan 185 (surface freeze).
- **Amended 2026-10-31 by plans 211–212 (host adoption ships in 0.13.0).** When this plan is complete, continue with plan 211 (module skills; its memory skills are written on the surface this plan leaves), then plan 212, then plan 184.
- **Amended 2026-11-01 by plan 202 Task 5.4.6 (owner disposition).** Plan 202 Task 5 (agentic lexical navigation and write-time keyword enrichment) closes on a bounded development screen: `beam-100k`, `locomo`, `memoryagentbench-cr` and a 14-question `beam-1m` slice. The candidate-gap halving rule is the screen's gate and the ability guard is descriptive only. The rest of Task 5's frozen target is handed here: `longmemeval-m`, the full `beam-1m` development cohort and the ability non-regression veto. Tasks 1, 5 and 9 carry it, and none of it may be dropped from this plan without a new owner decision.
- **Plan 202 closure handoff (owner, 2026-11-02).** Plan 202 is closed by disposition with unmet targets preserved, not accepted as passing. Its [complete closure ledger](../docs/_evidence/memory-bench/202/closure.md) is mandatory input to Tasks 1–5. This includes Task 17 residual diagnosis/F4, whether or not a facts preset ships. Development diagnosis precedes the freeze and held-out acceptance; this is not permission to restart a historical campaign.
- **Amended 2026-11-03 (owner decision): hot-path performance fixes land first, as Tasks 0.1–0.3.** A compiled-language (Rust) evaluation on 2026-11-03 rejected a native port. The kernel adds 3–6 ms per run against seconds of model latency, most store CPU is already native (bun:sqlite, JSON, fs), and the measured costs are algorithmic. Two came out of it: the markdown store rewrites three whole files on every write, and the session snapshot re-reads and `structuredClone`s the whole branch on every provider turn. The owner wants both fixed, with a regression gate, before the memory evaluations. They are unrelated to the audit. They are numbered 0.x so every existing "plan 210 Task N" reference (plans 202, 208, 209, the plan index) stays valid. They add no kernel contract, hook, slot or export, so no review task is needed. Both change sources that plan 202's cache-stability pin fingerprints (`src`, `packages/memory/core/src`), so Task 0.3 ends by re-attesting the pin with byte-identical provider requests. Task 1 starts only after that.
- **Amended 2026-11-04 (owner decision, plan 215): post-0.13.0 memory track.** 0.13.0 no longer waits for this plan. Plan 215 publishes the five memory packages as an experimental prerelease line (`0.13.0-experimental.N`, dist-tag `experimental`) and freezes only the stable surface. This plan runs after plan 209, after 0.13.0 ships. Wherever it says "before plan 184/185", "the freeze", "plan 186" or "plan 187", read: plan 215's cache-parity runner, plan 215's experimental compat classification, and this plan's own graduation (Task 10). Task 11 (memory skills) moved here from plan 211 Task 6.
- **Audit before acceptance.** Removals happen on development evidence only, before any held-out item is read. The held-out acceptance then measures the product that ships, so no claim has to be re-pointed and no removal needs a second held-out read.

**Scope:** `memory-observational`, `memory-fabric`, `memory-wiki` and the parts of `memory-core` only they use. `memory-rag` (document retrieval, a separate capability the owner keeps outside memory) and `memory-compaction` (measured by plan 194's rot curve) are out of scope; the ledger lists them as excluded with that reason.

**No new kernel contract or package:** the audit primarily removes existing surface. The sole conditional addition authorized by the 2026-11-02 handoff is plan 202 Task 17's already-reviewed opt-in facts preset, only after its residual threshold is measured; its implementation must include the original tests, docs and compatibility-baseline updates. A removal is planned the way a retirement is: baseline regeneration, sweep, and migration note. The preset revision and defaults Task 10 sets are the ones plans 202, 208 and 209 reviewed and specified. **Paid work is owner-gated twice:** C-1 (ablations and the combined check) and gate 3 (held-out acceptance, plus a fresh approval for the one remediation round). Live runs stay on plan 202's providers, never `openrouter/free`. No version bump or publish: every package ships in plan 187's lockstep 0.13.0 publish.

**Release gating** (moved from plan 202 with its Task 18, unchanged):

- 0.13.0 does not wait for a passing verdict.
- One remediation round is allowed. On a miss, the levers and tuning-tier values of plans 202, 207 and 209 may be revised once on development partitions, then every plan's arms are measured once on `heldout-b`.
- A second miss is final. Task 10 ships the last passing revision with claims limited to the criteria that passed.

## Tasks

- [ ] Task 0.1: Hot-path baselines — session turn-overhead scenario and markdown write amplification
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
    - Performance: The scenario stays under 60 s on the reference machine. The new gate runs the scenario at a reduced 300 runs.
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

- [ ] Task 0.2: Markdown store — stop rewriting whole derived files on every write
  - Acceptance Criteria:
    - Functional: A single-note `upsert` or `delete` no longer re-serializes the whole file map. It appends the changed entries to a journal next to the snapshot (`.index-files.journal.jsonl` beside `.index-files.json`). Loading reads the snapshot and replays the journal. The journal is compacted into the snapshot when its op count exceeds `max(1024, map size)`, and on every `reconcile()`/`rebuild()`, so each write is O(1) amortized.
    - Functional: `findFileById` (`packages/memory/core/src/fabric/index.ts:271`) uses an id→path map kept in step with every `fileMap` mutation at `index.ts:360-441`, `:447-496` and `:546-561`. It no longer scans the map.
    - Functional: `appendLog` (`index.ts:325`) keeps the parsed entries in memory, keyed by `log.md`'s `(mtimeMs, size)` after its own write. If the file changed (an external edit or another process), it re-parses as it does today. Rendered `log.md` bytes are unchanged.
    - Functional: `regenerateIndex` (`index.ts:313`) caches each entry's rendered line (the `encodeURI` work) and sorts with one shared `Intl.Collator` instead of per-call `localeCompare`. `index.md` stays byte-identical to the current `renderIndexFile` (`okf.ts:~325`) for the same entries. The remaining O(n) join and write is recorded as the residual cost.
    - Functional: Fail closed. A torn or unparsable journal line drops the derived map, and the next open does the full reconcile it does today when the index is missing (`index.ts:194-205`). It never trusts a partial map. A journal from a newer format version gets the same treatment.
    - Functional: `packages/memory/fabric/src/okf-bundle.ts:72` `DERIVED_FILES` gains the journal name. Export, import and the OKF bundle never ship it.
    - Performance: Against the same-session Task 0.1 baseline:
      - write p95 at 10k and 50k notes is at most 50% of the baseline;
      - `derivedBytesRewrittenPerUpsert` no longer scales with the file map;
      - cold open, warm open and recall p95 stay within 10% (three-run median).
      `docs/_evidence/memory-markdown-scale-0.13.0.md` is refreshed. Its supported operating envelope changes only if the measurements support the change.
    - Code Quality: All changes stay in `packages/memory/core/src/fabric/{state,index}.ts` (plus `okf.ts` only if a pure render helper is extracted). No new export, config field or dependency.
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

- [ ] Task 0.3: Session snapshot — extend on own append, revalidate in O(1); regression gate; cache-pin re-attestation
  - Acceptance Criteria:
    - Functional: In `RuntimeAgentSession.appendNow` (`src/agent-session/session.ts:1163`), when a live cache exists for the previous leaf and the store accepted the append with `expectedParentId` equal to that leaf, the cache is extended with one detached copy of the appended entry instead of being invalidated. The extended snapshot gets new `entries`, `messages` and `summaries` arrays, so earlier snapshot values are never mutated. It keeps the original `expiresAt`.
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
      - `growthRatio` is ≤ 1.5, against the Task 0.1 baseline (memory store ~4).
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

- [ ] Task 1: The feature ledger
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
    - Code Quality: `scripts/memory-bench/feature-ledger.mjs` builds it from the config stability tables (`stability.test.ts` sources) plus a hand-maintained mechanism list. A test fails if a config field or kind is missing from the ledger.
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
      - `scripts/memory-bench/feature-ledger.mjs` and test (new);
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

- [ ] Task 2: Mechanism verification — offline probes for every candidate
  - Acceptance Criteria:
    - Functional: For each candidate, a deterministic probe on the mock provider drives the real packages through a scripted scenario designed to trigger it, and records:
      - **fires:** the mechanism ran, with a count and the trigger rate on a realistic replay, using a development-partition history ingested offline;
      - **reaches:** its output changed something the agent receives, such as ranking, rendered context, a tool result, a stored note or a delivery decision. Measured by diffing the provider request and the tool results with the mechanism on and off;
      - **correct:** the effect matches the documented behavior. Examples: R rises after a use and orders the expected note first; widening needs two independent projects with the same normalized text; eviction respects pins; a decay rate changes rank as documented; the curator's trigger fires on co-read clusters.
      Verdicts: `works`, `never-fires`, `no-effect`, `wrong-effect`.
    - Functional: A mechanism error found here (`never-fires`, `no-effect`, `wrong-effect` against the documentation) is fixed in this task with a regression test, when the fix is local and does not change the feature's contract. Otherwise it is recorded for Task 3. Each fix is listed in the ledger and the task note.
    - Functional: Realistic trigger rates come from replaying development histories offline: one LongMemEval-M development history, one BEAM-100K, one coding lifecycle persona and one work-outcome persona, through the product path with scripted model replies. A mechanism that fires on fewer than 1% of eligible turns in realistic use is flagged `rare`.
    - Functional: **Plan 202 verification prerequisites.** Resolve the two memory check blockers recorded in `docs/_evidence/memory-bench/202/closure-verification.json`: make Task 5 manifest tests use an isolated pinned product fixture instead of requiring unrelated working-tree changes to be committed, while preserving the real campaign dirty-product refusal; verify the host's after-forget result from structured hits rather than mistaking the echoed query in `no matching memory` for leaked memory. Preserve deletion/isolation coverage. Re-run the affected benchmark/host checks before C-1; provider compatibility and kernel-budget blockers remain release-path obligations, not evidence of memory benefit.
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
      - `scripts/memory-bench/mechanism-probes/*` and tests (new);
      - fixes in `packages/memory/{fabric,observational,wiki}/src/*` (as found), each with a test;
      - `scripts/memory-bench/task5-comparison.test.mjs` and `apps/prism-agent/src/__tests__/conversational-memory.test.ts`: the inherited closure-check fixture/assertion repairs above;
      - `docs/_evidence/memory-bench/210/mechanisms.json`;
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

- [ ] Task 3: Conceptual gap analysis
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
    - Functional: The analysis is reviewed by a second pass with no access to the first pass's verdicts: a delegated reviewer, or the owner. Disagreements are recorded and resolved before Task 4's criteria are frozen.
    - Performance: Offline research.
    - Code Quality: One section per feature in `docs/_evidence/memory-bench/210/gap-analysis.md`; the predictions are machine-readable in `gap-predictions.json`, so Task 5 scores them.
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
      - `docs/_evidence/memory-bench/210/{gap-analysis.md,gap-predictions.json}` (new).
    - References:
      - Tasks 1–2.
  - Test Cases to Write:
    - `gap_predictions_schema_valid_and_reference_ledger_rows`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Pre-registered decision rules
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
    - Functional: **Experimental tier.** A kept-by-owner feature without evidence is documented as experimental, outside the API-level-1 promise (fabric README `## Compatibility`), so it can change or go in a minor version. This is the only route to keep an unjustified feature.
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
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Ablation and re-measurement campaign (owner gate C-1, paid)
  - Acceptance Criteria:
    - Functional: Gate C-1 states the budget, the models (two answer models from two providers, one small; the curator and decision models as shipped), the arms and the partitions. Arms:
      - **leave-one-out:** for each candidate that is a member of a shipped preset or a reference-host default, that configuration with the feature off;
      - **add-one:** for each opt-in candidate, the base configuration plus the feature;
      - **fixed variants:** for each `fix-and-measure` verdict, the fix;
      - **alternative measurements:** for each `measure-elsewhere` verdict, its named measurement (for example 202's growth simulation, or the work-outcome long-horizon personas).
      Partitions: development partitions of the robustness suites and the work-outcome suite. Features with similar targets may share a factorial design (stated at the gate) to save cost. The gate also reserves the budget for Task 8's combined check.
    - Functional: **Plan 202 Task 5 deferred arms (hand-off 2026-11-01).** Gate C-1 includes, whatever Tasks 2–4 conclude:
      - a leave-one-out arm per feature, keyword enrichment off and agentic navigation (`memory.read` neighbour/session paging) off, each against the Task 8 candidate configuration;
      - on the **full** `longmemeval-m` and `beam-1m` development cohorts frozen in `docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json`, plus the screened suites so every applicable suite has a row;
      - scored with the plan 202 Task 5.2 rules **as frozen**: the candidate-gap halving per suite, and the ability guard as a **veto** (every suite × ability stratum `>= -0.03`, missing strata unverified and blocking). Pin the original `criteriaHash` (version `202-task5-candidate-gap-v1`); a criteria drift is refused.
      These rows are reported next to the `cleanup-criteria.json` verdict and feed it as evidence. They do not replace it, and the cleanup verdict does not override them. A Task 5.2 miss here is a plan 202 Task 5 miss: Task 6 records it, and the feature goes to fix-and-measure or removal under `cleanup-criteria.json`. The arms run on plan 202's providers per this plan's header; the model may differ from Task 5's free route, and the report names the change.
    - Functional: **Remaining plan 202 development targets.** C-1 lists a disposition and measurement for every row in the closure handoff, including timeline, state/wrapper calibration, passive delivery, aggregation/abstention, realistic weak-caller sessions, coding decisions, each P1–P7 gate, live safety, growth QA and OM/promotion. Applicable original targets remain named and scored separately from cleanup verdicts; unavailable suites or attribution stay unverified. Build fresh compatible paired bases as needed; do not combine pre-cache-change fabric cells with current cells or silently resume the incomplete broad baseline.
    - Functional: **Conditional Task 17 arm.** Before calls, Task 4's criteria and C-1 pin the residual-diagnosis protocol, ≥5% trigger and the original Task 17 acceptance bars. If Task 3 lacks complete evidence, run the pre-registered diagnostic leg first under C-1 and update the gap analysis. Only a qualifying development diagnosis permits the minimal fabric extractor repair and opt-in `conversational-facts` add-one arm. Write its named regressions first; include exchange citations, scope/consent inheritance, unchanged `conversational`, ≤2% session failures, cheap-model per-session/per-1k-exchange write cost, `product-extract` cache-read/write tokens and costs with/without cache reads, target-ability benefit and no regression. Update changed exports/baselines and README/changelog in the same task. Otherwise no preset is added. Task 6 records `not-needed`, measured outcome, or `unmeasured`/F4 unresolved before Task 8's freeze; held-out data cannot trigger this implementation.
    - Functional: Every arm is paired against its base on the same items. The report gives the effect per target metric with clustered CIs (plan 198), cost and p95 latency deltas, and the Task 3 prediction scored as hit or miss.
    - Functional: The verdict per feature is computed by `acceptance-report.mjs --plan 210` from `cleanup-criteria.json`, with no hand-set value.
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

- [ ] Task 6: Decision record and owner review
  - Acceptance Criteria:
    - Functional: `docs/_evidence/memory-bench/210/decisions.md` lists each candidate with its verdict (keep, fix-kept, remove, owner-hold → experimental) and evidence, and the list of removals. The owner reviews it, and every owner-hold carries a written reason.
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — decision record.
    - Docs pages to create/edit:
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Removal, experimental tier and sweep
  - Acceptance Criteria:
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
      - `packages/memory/{fabric,observational,wiki,core}/**` (as decided);
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

- [ ] Task 8: Combined check and product freeze
  - Acceptance Criteria:
    - Functional: On the slimmed product:
      - every offline memory suite, the safety suite (offline, with plan 208's ontology probes), the prefix probe, the growth simulation (offline) and the mechanism probes pass;
      - a paired development run (inside gate C-1's reserved budget) shows the slimmed product non-inferior (2 points) to the pre-cleanup product on every suite and on W1–W6.
      A miss reverts the removal responsible, found by bisecting the removals.
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
- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun run --cwd packages/memory/wiki test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs`
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
- Paid, in order, after their gates:
  1. Task 5 ablations (gate C-1);
  2. Task 8 combined development check (gate C-1's reserved budget);
  3. Task 9 held-out acceptance (gate 3), with one live cache probe per acceptance route, and only after a miss the one remediation round on `heldout-b` (fresh approval);
  4. `acceptance-report.mjs --plan 202`, `--plan 208` and `--plan 209`;
  5. confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
