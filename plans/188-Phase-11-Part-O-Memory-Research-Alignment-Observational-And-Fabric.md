# Phase 11 Part O — memory research alignment: observational memory and the memory fabric

## Objectives

- Fix the shipped defects in `@arnilo/prism-memory-observational` (OM) and `@arnilo/prism-memory-fabric` found in the 2026-10-17 memory review. Each defect was checked against source; `file:line` references are in each task.
- Align both layers with the agent-memory research that is measured on public benchmarks, not with untested design choices:
  - temporal grounding and knowledge-update handling (LongMemEval)
  - reflections that replace their evidence (Generative Agents, Mastra OM)
  - context that keeps the prompt prefix cacheable (Mastra OM; our own cache-parity goal, plan 184)
  - update decisions made by a model or the agent, never by cosine similarity alone (Mem0, Zep)
  - hybrid retrieval with an abstention floor (Zep, LongMemEval, Shi et al. 2023)
  - long-term memory that is actually durable (MemGPT/Letta, Anthropic memory tool)
- Keep context short as well as relevant (the 2026-10-17 context-rot review). Length alone lowers accuracy even when retrieval is perfect (Du et al., 2025, arXiv 2510.05381; Chroma "Context Rot", 2025), and selective injection beats always-on injection (Wu et al., 2026, arXiv 2607.08716). So:
  - memory enters the prompt only when it is likely to matter: passive semantic injection is off by default until the benchmark shows a gain, with a calibrated floor and a query built from the task state
  - progressive disclosure: a small, cache-stable memory directory says what exists, and tools fetch the detail (MemGPT core/archival, ReadAgent gist→lookup, Anthropic memory tool)
  - no duplicates across memory sources, and use is measured: injected items are logged and judged, and only recalled or cited items gain recency
  - promoted memories start as candidates, so stored errors are not replayed (Xiong et al., ACL 2026, arXiv 2505.16067)
- Measure memory quality the way the research does: a reproducible LongMemEval/LoCoMo/MemoryAgentBench harness with a full-context baseline, per-ability scores, injection precision, paired significance tests, and cost. Every default that changes in this plan is justified by that harness.
- The context-rot defenses outside memory (compaction that fires in the reference host, context-overflow recovery, cache-aware tool-result clearing, context accounting, and a measured rot curve) are plan 194, which runs after plan 193 and before plan 184.

## Expected Outcome

- `scripts/memory-bench/run.mjs` runs pinned, stratified LongMemEval-S, LoCoMo, and MemoryAgentBench (conflict-resolution) subsets through Prism. It reports:
  - accuracy per ability, input tokens, cache-read ratio, and memory-worker calls for four configurations: full context, OM, fabric, and OM+fabric
  - injection precision: injected memory tokens per turn, and the share of injected items the judge marks as used vs irrelevant
  - paired comparisons between configurations (McNemar on the same questions)
  
  `docs/_evidence/memory-bench-0.13.0.md` records the baseline (Task 2) and the final run with ablations (Task 14).
- OM:
  - Reflections replace the observations (and earlier reflections) they condense, so the ledger stays bounded.
  - Observations carry the source message time and render grouped by date.
  - The observer can supersede a fact.
  - The observer keeps one current task state (goal, open questions, next steps), rendered last in the block, and the block asks the model to cite the memory ids it relies on.
  - The ledger enters the prompt only at compaction boundaries, so an observation pass never invalidates the cached history.
- Fabric:
  - Memory survives a restart: a SQLite store by default whenever `tools.root` is set, and a Postgres working store when Postgres is configured.
  - The agent can write `fact`/`procedure` notes and edit memory in place.
  - Notes are never retired on similarity alone.
  - Passive recall is off by default (`inject: false`) until Task 14 measures a gain. When on, it:
    - uses the fabric's own validity and kind rules plus a similarity floor applied before fusion
    - builds its query from the task state and runs once per user turn
    - skips items already in the OM block or the verbatim history
    - renders ids, kinds, and dates
    - sits at the tail of the prompt instead of the cached prefix
  - A memory directory block (counts by kind, top tags, file names, block labels) sits in the prefix and changes only on writes, so the agent knows what to recall.
  - Retrieval is hybrid: lexical + vector, fused by RRF.
  - Opt-in background promotion turns OM reflections into durable facts as **candidates**. Candidates are never passively injected; they become verified when reused or confirmed, and are archived when unused.
- `@arnilo/prism-memory-core`:
  - a `./sqlite` vector and working store
  - neutral importance of 0.5 instead of 1
  - access-based recency, touched only by an explicit recall or a citation, never by passive injection
  - shared `fuseRankings` (RRF) and `withTailContext` helpers; the tail message carries block metadata so plan 194's context accounting can measure it

**0.13.0 release path — plan 188, step 4 of 21.** Owner decision 2026-10-17: these memory fixes ship in 0.13.0. Start this plan when plan 183 is complete; when it is complete, continue with plan 189 (step 5; plans 189–191 were added on 2026-10-17 and run before plan 184). Plan 188 runs **before** plan 184 on purpose:

- The reference host (`apps/prism-agent/src/host/coding.ts:31`, `research.ts:25`) installs OM, so OM's prompt placement is part of what plan 184 measures.
- Plan 185 freezes the public surface, and this plan changes memory-package exports.

The release-path table in `plans/README.md` lists the order; the step number replaces "number order" for this one plan.

**Amended 2026-10-17 (context-rot and progressive-disclosure review, owner decision: all findings ship in 0.13.0).** The memory-side findings are folded into Tasks 1, 2, 4, 9, 11, 13, and 14, plus a new Task 12 (memory directory); the old Tasks 12–13 are now 13–14. The findings outside the memory packages are plan 194:
- The reference host never auto-compacts: OM's abstaining `compaction.when` suppresses the kernel fallback (`src/agent-session/session.ts:1016-1034`), reproduced 2026-10-17 with 0 compactions in 8 turns.
- Context-overflow recovery.
- Cache-aware tool-result clearing.
- Context accounting and a block-share cap.
- A measured rot curve that sets the triggers.

Plan 188 does not depend on plan 194. Plan 194 Task 7 later replaces OM's absolute `compactAfterTokens` gate with a ratio of the model's window.

This plan changes **no kernel contract**. Every mechanism uses existing seams:

- the `context.build` draft (messages and blocks)
- the `compaction.when` decide hook and the `compaction` slot
- the `compaction.completed` and `turn.completed` observe hooks (`src/hooks/catalog.ts:25`)
- `session.background`
- `prism.state.log` and `prism.state.session`
- `prism.models.client`
- the `embeddings` service

So the plan has no formal phase review. **Task 1 is a read-only check** of the assumptions the later tasks make; a finding that needs a kernel addition stops the plan for re-cutting.

**Cost knobs:**
- The benchmark is opt-in and never part of `bun run test`; Task 2 states its token ceiling.
- The model update decider (Task 10) and OM→fabric promotion (Task 13) are opt-in, off by default; each states its per-write cost in its README.
- Passive semantic injection (Task 11) is off by default: no embedding call per turn unless `inject` is enabled. The memory directory (Task 12) makes no model or embedding call; it is recomputed only on writes.

**Datasets** are downloaded at run time to a cache directory and checked against pinned checksums; they are never vendored (LoCoMo's and MemoryAgentBench's licenses are checked in Task 1). No version bump or publish.

## Tasks

- [x] Task 1: Assumption check (read-only)
  - Acceptance Criteria:
    - Functional: The task note records a verdict on each assumption below, citing `file:line`. Any "no" stops the plan for re-cutting.
      - (a) **`context.build` draft messages.** A `context.build` handler can return `{ ...draft, messages }` with one extra message inserted before the final user input, and `applyDraft` sends it as is (`src/loop/run-controller.ts:133`). The draft is per-request and never persisted (the hook invariant: `context.build` never mutates the store). Also record:
        - what `@arnilo/prism-context-engineering`'s handler (`packages/context/engineering/src/handler.ts:59`) does with an inserted message
        - whether `context.build` fires once per model call within a turn, which decides whether the inserted message stays put across tool rounds
      - (b) **OM can observe `compaction.completed`** with a `HookContext.session` and payload carrying the compaction entry (or its `strategy`). If not, the fallback is `turn.completed` plus the compaction entry id from `session.entries()`, and the note records it.
      - (c) **When `compaction.when` is decided** (`src/agent-session/session.ts:992`, `:1000`, `:1018-1036`): at run start and per turn. Also how several `compaction.when` handlers combine (OM and `memory-compaction` both register one in `apps/prism-agent`), from the hook combination rule in `docs/hooks.md` (`any-compact`, `src/hooks/catalog.ts:61`).
        - Known finding, recorded here and fixed by plan 194 Task 2, not in this plan: while any handler is registered, an abstaining handler means "no compaction" and the kernel's `thresholdEntries` fallback never runs. OM is off by default, so installing it disables auto-compaction (0 compactions in 8 turns in the 2026-10-17 repro).
        - Task 5's tests must not depend on that behavior: they assert OM's own decisions while OM is on.
      - (d) **The memory benchmark can seed a session** with dated history: `createSessionEntry` or the store `append` accepts an arbitrary `timestamp`, and OM's coverage cursor and `session.entries()` read it back unchanged.
      - (e) **`bun:sqlite` availability:**
        - FTS5 is compiled into Bun ≥ 1.4.2's `bun:sqlite` (check with `CREATE VIRTUAL TABLE t USING fts5(x)`)
        - a lazy `require("bun:sqlite")` behind a subpath matches `packages/stores/sqlite/src/bun-runtime.ts:6`
      - (f) **Datasets.** LongMemEval-S (cleaned) and LoCoMo: download URLs, the license of each (LongMemEval: MIT; LoCoMo: verify CC BY-NC 4.0), file sizes, and SHA-256 checksums. Also LongMemEval's question-type field names (`single-session-user`, `single-session-assistant`, `single-session-preference`, `multi-session`, `temporal-reasoning`, `knowledge-update`, and the `_abs` abstention suffix), and LoCoMo's QA categories. Also MemoryAgentBench (Hu et al., ICLR 2026, arXiv 2507.05257): the conflict-resolution (selective forgetting) split's URL, license, size, checksum, and field names.
      - (g) **Docs home.** The kernel pages are already promoted into `/docs` (`docs/slots.md`, `docs/hooks.md` exist; `docs/next/` does not). Record which home this plan's docs edits use: package READMEs for package behavior; `/docs/packages.md` only if it lists memory package behavior. Fix `references/prism-wiki.md` in this task if it still says `docs/next/`.
      - (h) **Callers.** `graft callers <symbol> --depth all` for every symbol later tasks change; the lists go into the note:
        - `renderObservationalMemory`, `observationalMemoryBlock`, `createObservationalMemoryCompactor`, `runReflector`, `runDropper`, `runObserver`
        - `planMemoryConsolidation`, `createMemory`, `contextBlocks`
        - `NEUTRAL_IMPORTANCE`, `clampImportance`, `recencyOf`, `rerankRecallHits`
        - `probeLocomoRecall`
      - (i) **Candidate lifecycle.** Can the scoped policy's statuses (`candidate | verified | archived`, `fabric/src/scoped/lifecycle.ts:16`, archive at `:112`) be read from a plain fabric note's metadata, so Task 13 can mark promoted facts as candidates without the scoped layer? If not, record the minimal field Task 13 adds (`metadata.status`) and where `statusOf` is shared.
      - (j) **Task-state sources for the recall query (Task 11).** Where the latest plan lives in the provider view: the `todo_write` result that `memory-compaction`'s coding profile keeps (`packages/memory/compaction/src/index.ts`, `keepLatestPlanTurn`), and how a `context.build` handler finds it in `draft.messages`. Also how fabric reads OM's task state (Task 4) through `session.entries()`.
      - (k) **Turn identity in `context.build`.** Can a handler tell whether a call is the first model call of a user turn or a later tool round (`HookContext` turn/run ids, or a new user message at the tail)? Task 11 recalls once per user turn and reuses the block on later tool rounds.
    - Performance: n/a — read-only.
    - Code Quality: Every verdict cites source or a dated URL.
    - Security: n/a — read-only; no dataset content is quoted in the note beyond field names.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 8 (memory packages) and Phase 11
      - `docs/hooks.md`, `docs/slots.md`
      - `src/input.ts:85-135` (input groups) and `src/input.ts:361` (`contextMessages`)
      - `src/session-stores.ts:160-188` (compaction snapshot)
      - `packages/memory/*/README.md`
      - the LongMemEval paper (Wu et al., ICLR 2025, arXiv 2410.10813) and repo; the LoCoMo paper (Maharana et al., ACL 2024) and repo
    - Options Considered:
      - Skip the check and design against the review's reading. Rejected: plan 142's review found a wrong registry default that rewrote a later task; the cache-placement design here depends on (a)–(c).
    - Chosen Approach:
      - One read-only pass, verdicts in the note, stop on any kernel-addition finding.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers renderObservationalMemory --depth all
      timeout 30 bun -e 'const {Database}=require("bun:sqlite");new Database(":memory:").run("CREATE VIRTUAL TABLE t USING fts5(x)");console.log("fts5 ok")'
      ```
    - Files to Create/Edit:
      - this plan (task note)
      - `.agents/skills/create-plan/references/prism-wiki.md` (only if (g) finds it stale)
    - References:
      - the 2026-10-17 memory review (this plan's Objectives)
      - owner decisions 2026-10-16 (cache parity with pi) and 2026-10-17 (memory fixes in 0.13.0)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `references/prism-wiki.md` only if stale (skill reference, not product docs).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-18):
    - **Verdict: proceed with the package-level corrections below; no kernel addition is needed.** The fallback cases explicitly allowed in (b) and (i) apply. No implementation, export, baseline, or product-doc change was made. The review covers roadmap Phase 8 (`roadmap.md:1853`) and Phase 11 (`roadmap.md:2352`), `docs/hooks.md:68`, `docs/slots.md`, and the memory package READMEs. Task 1 is complete; Tasks 2–14 remain unchecked.
    - **(a) Yes, with composition and lifetime limits.** `draftFromRequest` builds a fresh request draft (`src/loop/run-controller.ts:115`); `applyDraft` preserves the message order supplied by a handler, while materializing `systemPrompt` and additional context blocks (`:133-159`). Only input, assistant output, and tool results enter history; the transformed draft does not (`:203-230`). `context.build` runs once per `RunController.turn`/provider attempt, including later tool rounds (`:180-205`), so an inserted message must be reinserted on each call. Engineering folds tool-result content, narrows tools, then applies attention or budget (`packages/context/engineering/src/handler.ts:56-125`). Attention retains ordinary text messages; a budget can drop a non-leading inserted system message as history (`budget.ts:135-176,185-225`). Run tail insertion after engineering using existing hook priority/order, and test the combined handlers. Anchor it before the latest real user message, even when assistant/tool messages follow; when there is no user message, append at the tail. Keep its bytes and anchor stable across tool rounds. `src/input.ts:114-135` defines the two assembly layouts, and `:361-365` renders block metadata into messages. Task 9 now states these limits explicitly.
    - **(b) Supported fallback required; payload assumption is false.** `compaction.completed` is observable with the package-bound session (`src/hooks/catalog.ts:25`, `src/hooks/bus.ts:210-222`, `src/agent-session/session.ts:880-889`). Its payload contains summary/count or error, **no entry/id/strategy** (`src/contracts-protocol.ts:345-353`). The entry has already been appended when success is emitted (`src/agent-session/session.ts:1100-1113`); read it through `session.entries()` and deduplicate by entry id. OM's entry data includes its strategy (`packages/memory/observational/src/strategy.ts:90-100`). Observe callbacks are fire-and-forget (`src/hooks/bus.ts:224-240`): an async log append alone does not guarantee pinning before the next request. Task 5 must capture a bounded ledger snapshot synchronously on success, keep the scan/pin promise in package memory, and await it in `context.build` before rendering. Failed compactions do not pin. On reopen, reconcile once from the last compaction entry. The originally suggested `turn.completed` scan is a recovery fallback only: it is too late for the first request immediately following run-start or mid-run compaction. No steady-state branch read is required.
    - **(c) Yes.** Run-start compaction happens after the new input entries are appended (`src/agent-session/session/assemble.ts:351-358`); subsequent provider turns check before assembly (`:414-419`). `resolveAutoCompact` dispatches the hook at both points (`src/agent-session/session.ts:989-1036`). Multiple handlers combine by the first `{ compact: true }`; abstentions and `{ compact: false }` do not veto another handler (`src/hooks/bus.ts:53-66`, catalog `:61`). While any handler exists, all-abstain returns no compaction and bypasses `thresholdEntries` (`session.ts:1025-1036`). OM registers even while disabled and abstains (`packages/memory/observational/src/index.ts:117-120`): the known suppression remains for plan 194 Task 2. The historical 8-turn reproduction was not rerun here. Task 5 tests must enable OM and assert its own decisions.
    - **(d) Yes.** `createSessionEntry` preserves a supplied timestamp (`src/session-stores.ts:61-68`); the in-memory store appends and clones entries without replacing it (`:271-279`). `SessionContext.entries` delegates to the full branch (`src/agent-session/session.ts:278-282,747-751`), not the compacted provider view. OM coverage is entry-id based and slices the original entries (`packages/memory/observational/src/coverage-helpers.ts:13-19`). A synthetic dated append/read/cursor check passed. Seed linked `parentId` entries, preserve original roles, and use `haystack_dates` for LongMemEval; message bodies have no timestamp field.
    - **(e) Yes on the installed minimum runtime.** `bun --version` returned **1.4.2**; the in-memory `CREATE VIRTUAL TABLE t USING fts5(x)` probe passed. `packages/stores/sqlite/src/bun-runtime.ts:1-18` uses a type-only import and guarded `createRequire` call; loading the runtime module initializes its constructor. Task 6 should isolate that module behind `./sqlite`, not import it from core's root. This proves the installed minimum, not every future Bun build.
    - **(f) Yes, with dataset protocol corrections.** Sources checked/downloaded **2026-10-18**, pinned to immutable revisions below. Sizes and SHA-256 were computed from the full response bytes in memory; no dataset text was printed or vendored.

      | Dataset / license | Pinned download | Bytes | SHA-256 |
      | --- | --- | ---: | --- |
      | LongMemEval-S cleaned / MIT ([dataset card](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/blob/98d7416c24c778c2fee6e6f3006e7a073259d48f/README.md)) | https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json | 277383467 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
      | LoCoMo / CC BY-NC 4.0 ([license](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt)) | https://raw.githubusercontent.com/snap-research/locomo/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/data/locomo10.json | 2805274 | `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4` |
      | MemoryAgentBench Conflict_Resolution / MIT ([dataset card](https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/blob/7ea066982b140a19337e17e60d45d4076e042faf/README.md)) | https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/resolve/7ea066982b140a19337e17e60d45d4076e042faf/data/Conflict_Resolution-00000-of-00001.parquet | 1491588 | `24d5c3f09ce0ce15625cb9f8a98f44f0d864ca6c94d7b4ad04eb697ca3a5ff45` |

      - LongMemEval has **500** questions. Fields: `question_id`, `question_type`, `question`, `question_date`, `answer`, `answer_session_ids`, `haystack_dates`, `haystack_session_ids`, `haystack_sessions`; session messages have `role`, `content`. Six type counts are `single-session-user: 70`, `single-session-assistant: 56`, `single-session-preference: 30`, `multi-session: 133`, `temporal-reasoning: 133`, `knowledge-update: 78`. **30 abstentions** are indicated by `question_id` ending `_abs`, not by a question-type suffix ([upstream protocol](https://github.com/xiaowu0162/LongMemEval/blob/main/README.md)). Task 2's six ordinary strata must exclude abstentions; the 30-question preference ablation includes all available preference questions.
      - LoCoMo has **10** conversations. Root fields: `qa`, `conversation`, `event_summary`, `observation`, `session_summary`, `sample_id`. QA fields: `question`, `answer` (optional for adversarial), `evidence`, `category`; adversarial QA uses `adversarial_answer`. Categories: **1 multi-hop (282), 2 temporal (321), 3 open-domain (96), 4 single-hop (841), 5 adversarial (446)**, **1986** QA total ([upstream scoring](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/task_eval/evaluation.py)). Preserve conversation session dates and dialogue ids; do not assume every QA has the same answer fields. The license is noncommercial; it must stay attached to the downloaded cache and benchmark documentation.
      - MemoryAgentBench's split is **`Conflict_Resolution`**, **8 context rows**, not 40 independent rows. Official card schema: `context: string`, `questions: string[]`, `answers: string[][]`, `metadata` with `demo`, `haystack_sessions`, `keypoints`, `previous_events`, `qa_pair_ids`, `question_dates`, `question_ids`, `question_types`, `source` (nullable per source). The card describes `fact_sh` and `fact_mh`; **Task 2 decode correction (2026-10-18):** the pinned Parquet actually stores `factconsolidation_sh_{6k,32k,64k,262k}` and `factconsolidation_mh_{6k,32k,64k,262k}`, 100 questions per row; upstream reports `substring_exact_match` accuracy ([runner protocol](https://github.com/HUST-AI-HYZ/MemoryAgentBench#evaluation)). Task 2 must draw 40 **(context-row, question-index)** pairs stratified by source, preserve ordered incremental context chunks, and accept alternative gold answers. These are fact streams, not dated conversation sessions; use deterministic synthetic ingestion times and label them synthetic. The pinned artifact is Parquet: Task 2 must explicitly select a benchmark-only decoder and document any development dependency; no memory package runtime dependency. The HF row-preview endpoint timed out; schema/row count came from the pinned dataset card/API rather than a decoded local Parquet scan.
    - **(g) Yes; no reference edit.** `docs/hooks.md` and `docs/slots.md` exist; `docs/next/` does not. `.agents/skills/create-plan/references/prism-wiki.md:7-15` already states the promoted layout. Use package READMEs. `docs/packages.md:117,180-188` describes generic package state and uses memory as an example; it is not a memory-behavior catalog and needs no edit for this plan.
    - **(h) Caller closures recorded below.** All 14 requested `graft callers <symbol> --depth all` queries ran. `NEUTRAL_IMPORTANCE` is a module-level constant the graph does not resolve as a symbol; exhaustive `graft grep NEUTRAL_IMPORTANCE` found only its declaration and `clampImportance` use (`packages/memory/core/src/scoring.ts:10,22`). The latter's closure is listed below. This is a graph snapshot; executors must refresh it when changing the symbols.
    - **(i) Fallback field required.** Plain `MemoryNote` and `MemoryNoteMetadata` do not expose lifecycle status (`packages/memory/fabric/src/types.ts:49-78,300-353`); scoped status/uses live in a separate file ledger (`scoped/ledger.ts:5-23`). Add validated **top-level vector `metadata.status`** (`candidate | verified | archived`) in Task 13, expose it on plain note/hit results, preserve it through rewrites/corrections, and treat absent status on existing plain notes as verified. Scoped missing status must keep meaning candidate. `statusOf` is currently duplicated, not shared (`scoped/lifecycle.ts:16-18`, `scoped/mirror.ts:14-16`); move normalization and the candidate age predicate into a small `fabric/src/lifecycle.ts` helper with explicit fallback. `runScopedGcPass` only proposes archive and returns `archived: 0` (`scoped/lifecycle.ts:93-129`); it cannot be called directly for plain notes. Reuse the age predicate while plain promotion applies `validTo` and `unused-candidate`. No kernel change is needed.
    - **(j) Yes, with provider-view availability limits.** The coding compactor wraps `keepLatestPlanTurn` (`packages/memory/compaction/src/index.ts:53`); the latest tool result with `metadata.todos` and its matching assistant call are pinned via `keepEntryIds` (`coding.ts:35-93`). Find the last tool message with array `metadata.todos` in `draft.messages`; the actual writer returns that metadata (`packages/tools/coding/src/agent/todo.ts:216`). Engineering may fold/drop that result, so query extraction must happen before that stage or fall back to stored entries. Fabric already reads the public OM fold from `session.entries()` (`fabric/src/create.ts:137-142,174-178`); Task 4 must extend OM's fold/export with the replaced task state (`observational/src/ledger.ts:16-35`) for Task 11 to use.
    - **(k) Yes via persisted user identity; not via draft hook ids.** `HookContext` has no turn counter (`src/hooks/types.ts:27-37`). More subtly, `draftFromRequest` has neither session nor run ids (`src/loop/run-controller.ts:115-123`), and the bus derives both from payload fields, so **`context.runId` and `context.sessionId` are empty for `context.build`** (`src/hooks/bus.ts:126-135,243-251`); `context.session.id` is available. The latest user message is not necessarily the last message after tools. Cache by `(context.session.id, latest persisted user-entry id)` found through `session.entries()` (which retains compacted history). Reuse a cached empty result too; invalidate on a new user entry/steer, never on assistant/tool rounds. Obtain this identity during the same branch read used for Task 11's OM task-state query. A `turn.before` handler can also capture the valid run id/counter if needed; assistant-count inference (`engineering/src/handler.ts:257-261`) is provider-round identity, not user-turn identity.
    - **Verification:** `timeout 30s bun -e '<FTS5 probe from the task>'` passed on Bun 1.4.2. An inline assert-based synthetic probe passed for arbitrary timestamp append/read, OM cursor slicing, draft immutability, and empty draft hook run id. `timeout 180s bun test src/__tests__/session-stores.test.ts src/__tests__/compaction-trigger.test.ts src/__tests__/mid-run-compaction.test.ts packages/memory/observational/src/__tests__/coverage.test.ts packages/memory/compaction/src/__tests__/coding.test.ts`: **60 passed, 0 failed**. `timeout 1200s bun run typecheck`: **passed** (kernel, workspaces, examples). `timeout 600s bun test --timeout=0 src/__tests__/docs.test.ts`: passed. No live model benchmark or whole-plan release gate was run for this read-only task.

    **Caller closures (2026-10-18).** Paths below are under `packages/memory/` unless an absolute repo-relative path is shown. Each list includes transitive graph consumers, not only direct calls.

    | Symbol / definition | Complete graph consumer list |
    | --- | --- |
    | `renderObservationalMemory` — `observational/src/render.ts:23` | `observational/src/__tests__/ledger.test.ts:17`; `commands.ts:156` (`viewCommand`) → `commands.ts:64` (`createObservationalMemoryCommands`); `context.ts:33` (`memoryBlocksFrom`) → `context.ts:21` (`observationalMemoryBlock`); `recent-messages.ts:55` (`buildObservationalMemoryContextBlocks`); `strategy.ts:44` (`compact`); `observational/src/index.ts:68` (`setup`); `observational/src/__tests__/recent-messages.test.ts:1`; `examples/revocation-propagation.ts:1`. |
    | `observationalMemoryBlock` — `observational/src/context.ts:21` | `observational/src/index.ts:68` (`setup`, call at `:102`). |
    | `createObservationalMemoryCompactor` — `observational/src/strategy.ts:40` | `observational/src/__tests__/strategy.test.ts:6`; `compactor.ts:21` (`createObservationalCompactor`) → `observational/src/index.ts:68` (`setup`). |
    | `runReflector` — `observational/src/workers/reflector.ts:23` | `observational/src/__tests__/workers.test.ts:6`; `flush.ts:90` (`pass`, call at `:134`) → `flush.ts:68` (`flush`). |
    | `runDropper` — `observational/src/workers/dropper.ts:44` | `observational/src/__tests__/workers.test.ts:6`; `flush.ts:90` (`pass`, call at `:158`) → `flush.ts:68` (`flush`). |
    | `runObserver` — `observational/src/workers/observer.ts:25` | `observational/src/__tests__/worker-split.test.ts:5`, `workers.test.ts:6`; `flush.ts:90` (`pass`, call at `:113`) → `flush.ts:68` (`flush`). |
    | `planMemoryConsolidation` — `fabric/src/consolidate.ts:42` | `fabric/src/create.ts:233` (`rememberIndexed`, call at `:257`) → `create.ts:360` (`remember`) and `create.ts:164` (`rememberReflection`). |
    | `createMemory` — `fabric/src/memory.ts:68` | See the expanded list immediately below. |
    | `contextBlocks` — `fabric/src/memory.ts:539` | `fabric/src/memory.ts:589` (`registerContextBuild`, call at `:590`). |
    | `NEUTRAL_IMPORTANCE` — `core/src/scoring.ts:10` | Graph symbol unsupported; exhaustive text sweep: `core/src/scoring.ts:22` (`clampImportance`), then that symbol's closure below. |
    | `clampImportance` — `core/src/scoring.ts:21` | `core/src/scoring.ts:27` (`normalizeImportance`), `:99` (`rerankRecallHits`), `:47` (`deriveEntryImportance`); `core/src/postgres/index.ts:452` (`upsert`); `core/src/vector-memory.ts:187` (`upsert`); `fabric/src/__tests__/public-surface.test.ts:15`; `fabric/src/memory.ts:208` (`recall`), `:150` (`indexEntries`), `:539` (`contextBlocks`), `:196` (`remember`), `:589` (`registerContextBuild`). |
    | `recencyOf` — `core/src/scoring.ts:88` | `core/src/scoring.ts:99` (`rerankRecallHits`); `fabric/src/__tests__/public-surface.test.ts:1`; `fabric/src/memory.ts:208` (`recall`) → `:539` (`contextBlocks`) → `:589` (`registerContextBuild`). |
    | `rerankRecallHits` — `core/src/scoring.ts:99` | `fabric/src/__tests__/public-surface.test.ts:20`; `fabric/src/memory.ts:208` (`recall`, call at `:261`) → `:539` (`contextBlocks`) → `:589` (`registerContextBuild`). |
    | `probeLocomoRecall` — `fabric/src/scoped/eval/recall-probe.ts:5` | `fabric/src/scoped/eval/runner.ts:61` (`runScopedMemoryEval`, call at `:121`) → `fabric/src/scoped/__tests__/eval.test.ts:1`. |

    - Expanded `createMemory` closure: `examples/scoped-memory.ts:5`, `examples/working-semantic-memory.ts:3`, `scripts/fixtures/e2e-070-host-completeness-journey.mjs:38`; `fabric/src/index.ts:45`; `fabric/src/conformance.ts:15`; `fabric/src/scoped/eval/runner.ts:28` (`bind`), `:51` (`runTask`), `:61` (`runScopedMemoryEval`); `fabric/src/__tests__/consolidate.test.ts:9` (`makeMemory`, plus module `:1`), `deletion-propagation.test.ts:23`, `eval-procedure.test.ts:4`, `eval-revocation.test.ts:4`, `host-wiring.test.ts:14`, `lineage.test.ts:15`, `memory.test.ts:15`, `notes.test.ts:17` (`makeMemory`, plus module `:1`), `observational-source.test.ts:23`, `postgres-memory.integration.test.ts:7`, `postgres-vector.integration.test.ts:14`, `public-surface.test.ts:23`, `recall.test.ts:10` (`makeMemory`, plus module `:1`), `repoint.test.ts:25,34` (`makeHarness`), `tools.test.ts:19` (`makeMemory`, plus module `:1`), `package.test.ts:1`; `fabric/src/scoped/__tests__/eval.test.ts:8`, `lifecycle.test.ts:12` (`bound`, plus module `:1`), `mirror.test.ts:14` (`bound`, plus module `:1`), `policy.test.ts:10,14` (`makeBound`), `read-policy.test.ts:37` (`boundPolicy`, plus module `:1`), `reviewer.test.ts:13` (`bound`, plus module `:1`), `trust.test.ts:14` (`bound`, plus module `:1`).

- [x] Task 2: Memory benchmark harness and baseline
  - Acceptance Criteria:
    - Functional:
      - `bun scripts/memory-bench/run.mjs --suite longmemeval-s|locomo|memoryagentbench-cr --config full|om|fabric|om+fabric --provider <id> --model <id> --judge <provider/model>`:
        - downloads the dataset to `${PRISM_CACHE_DIR:-~/.cache/prism}/memory-bench/` and refuses to run on a checksum mismatch (`MemoryBenchDatasetError`)
        - selects the pinned subset from `scripts/memory-bench/subsets.json`:
          - LongMemEval-S: 10 questions per question type plus 10 abstention questions, 70 in total
          - LoCoMo: all QA from 2 of the 10 conversations
          - MemoryAgentBench conflict resolution: 40 questions (the knowledge-update and supersession signal for Tasks 4, 10, and 11)
          - `--subset targeted --ability <name>`: 30 questions of one LongMemEval type, a superset of the 10 above. Task 14 ablations use it for the ability a change targets: at 10 questions an ability's standard error is about ±15 pp, too wide to see a regression.
          - ids are fixed by a seeded draw recorded in the file
        - replays conversation haystacks as dated session entries (Task 1 (d)); MemoryAgentBench fact streams retain incremental source order with explicitly synthetic ingestion times
        - uses Task 1 (f)'s immutable URLs, byte sizes, hashes, and license notices; decodes the pinned MemoryAgentBench Parquet with an explicitly documented benchmark-only decoder/development dependency
        - samples LongMemEval abstentions by `question_id` suffix `_abs`, excluding them from the six ordinary strata; selects MemoryAgentBench questions by `(context-row, question-index)` stratified over the decoded single-/multi-hop sources (`factconsolidation_sh_*` / `factconsolidation_mh_*`) and scores alternative answers with upstream `substring_exact_match`
        - asks the question in a final run
        - scores the answer with the judge model using LongMemEval's published judge prompts (and LoCoMo's F1 plus the same judge)
        - writes `docs/_evidence/memory-bench/<suite>-<config>-<provider>-<model>-<date>.{json,md}`
      - Reported per run:
        - accuracy per ability: LongMemEval information extraction, multi-session, temporal, knowledge update, and abstention; LoCoMo single-hop, multi-hop, temporal, open-domain, and adversarial
        - total input tokens, cache-read tokens, and cache-read ratio (from the plan 182 wire proxy's usage log)
        - observer, reflector, dropper, embedding, and decider call counts
        - **injection precision** (configs with memory):
          - every memory item that enters a request is logged by id, with source (`om`, `fabric-working`, `fabric-semantic`, `fabric-directory`), tokens, and placement
          - captured by a bench-only package that observes `model.request` and reads block metadata (`metadata.source`, `metadata.itemIds`). Every memory block sets these: OM in Task 4, the fabric tail message in Tasks 9 and 11, the directory in Task 12. Before those tasks land, the baseline logs block-level tokens only, and the note says so.
          - the judge labels each item `used` / `irrelevant` against the question and the gold answer
          - the report gives injected tokens per turn, the irrelevant-item rate, and the cited-id rate (ids the answer cites, from the Task 4/11 citation instruction)
          - item ids and labels only; no item text in evidence
        - **paired comparison:** `report.mjs --compare <a.json> <b.json>` prints, per ability, the McNemar exact p-value and the discordant counts for the same question ids; unpaired comparisons are refused
      - **`full`** (the whole haystack in context, truncated from the oldest end to the model's input cap and recorded as truncated) is the baseline every paper reports, and is always run.
      - `--offline` runs one synthetic three-session fixture (`scripts/memory-bench/fixtures/synthetic.json`, written for this plan, no dataset content) on the mock provider. It is the CI smoke.
      - The baseline (all four configs where they can run) is recorded in `docs/_evidence/memory-bench-0.13.0.md`. The `fabric` config is recorded as `n/a — no automatic write path` until Task 13.
      - **Retirement:** the fake "LoCoMo" probe is renamed to say what it is:
        - `packages/memory/fabric/src/scoped/eval/fixtures/locomo.json` → `recall-smoke.json`
        - `probeLocomoRecall` → `probeRecallSmoke`
        - Repo-wide grep for `locomo` / `Locomo` over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) returns only `scripts/memory-bench/`.
      - `bun scripts/release.mjs gate --update-baseline` rewrites `scripts/compat-baseline/arnilo__prism-memory-fabric.txt`. The note records the diff: one rename, attributed to this plan. `arnilo__prism-memory.txt` (0.12 family baseline) is left as recorded history if it is the frozen 0.12 surface; the note says which.
    - Performance:
      - The live cost ceiling is stated in `scripts/memory-bench/README.md` and enforced by `--max-input-tokens` (default 15M per suite×config run; the run aborts with a partial report when crossed).
      - LongMemEval-S is about 115k tokens per question, so `full` on 70 questions is about 8M input tokens.
      - The offline smoke finishes under 30 s.
    - Code Quality:
      - Scripts only: no package depends on the bench.
      - The judge prompt is copied verbatim with its source URL and commit.
      - Subsets are data, not code.
    - Security:
      - Provider keys come from `~/.config/prism/live.env` through the existing live loader; the runner never prints them.
      - Dataset text is never written into evidence files beyond question ids and scores.
      - A `release/memory-bench` row in `.github/workflows/live-matrix.yml` is opt-in (manual dispatch only).
  - Approach:
    - Documentation Reviewed:
      - LongMemEval (Wu et al., ICLR 2025): five abilities, the S/M haystacks, the GPT-4o judge prompts, and the findings that session decomposition, fact-augmented keys, and time-aware query expansion matter
      - LoCoMo (Maharana et al., ACL 2024): QA categories
      - MemoryAgentBench (Hu et al., ICLR 2026): accurate retrieval, test-time learning, long-range understanding, and selective forgetting (conflict resolution) on incremental multi-turn input
      - Joren et al., ICLR 2025 ("Sufficient Context"): judge whether the given context was sufficient, and score abstention separately
      - McNemar's test for paired classifiers (Dietterich, Neural Computation 1998)
      - the Mem0 paper (Chhikara et al., 2025, arXiv 2504.19413), which reports full context as a strong LoCoMo baseline
      - plan 184 (`scripts/cache-parity/` runner and wire-proxy usage)
      - `packages/memory/fabric/src/scoped/eval/runner.ts:1-60`
    - Options Considered:
      - Full LongMemEval-S (500 questions). Rejected for the release row: about 57M input tokens per config. The stratified subset keeps every ability measured; the full run stays a manual option (`--subset all`).
      - Vendor the datasets. Rejected: size and LoCoMo's non-commercial license.
      - Only exact-match scoring. Rejected: LongMemEval's own protocol uses a model judge; exact match under-counts paraphrased answers.
      - Accuracy only, no injection log. Rejected: the context-rot concern is what enters the prompt, and accuracy alone cannot tell "helped" from "added distractors the model ignored" (Chroma 2025; Wu et al. 2026).
      - Compare runs by the difference in mean accuracy. Rejected: on 10–30 paired items the noise dominates; McNemar uses the per-question pairing.
      - Keep the hash-embedder `locomo.json` probe as the "LoCoMo" signal. Rejected: one note and two questions, so its name claims a benchmark it does not run.
    - Chosen Approach:
      - Benchmark first, so every later default is decided by measurement, and the evidence names what was measured and what it is not comparable to (different judge model than the papers).
    - API Notes and Examples:
      ```bash
      timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --config om --provider hyper --model <id> --judge hyper/<id>
      timeout 60 bun scripts/memory-bench/run.mjs --offline
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{run.mjs,datasets.mjs,replay.mjs,judge.mjs,report.mjs,injection-log.mjs,stats.mjs,subsets.json,README.md}`: new
      - `scripts/memory-bench/fixtures/synthetic.json`: new
      - `scripts/memory-bench/{live.mjs,judge-prompts.json,judge-LICENSE.txt,locomo-f1.py,requirements.txt}`: benchmark-only entry point, pinned judge templates/license, upstream-compatible scoring, and isolated Python tooling
      - `scripts/memory-bench/run.test.mjs`: new (offline smoke and checksum refusal)
      - `scripts/run-all-tests.mjs`: include the offline harness tests in the existing gate stage
      - `packages/memory/fabric/src/scoped/eval/{recall-probe.ts,runner.ts}`, `fixtures/locomo.json` → `fixtures/recall-smoke.json`, `scoped/__tests__/eval.test.ts`: rename
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt`: regenerated
      - `scripts/budgets.json`: attributed shipped-doc byte growth and probe-name rationale
      - `packages/memory/fabric/src/__tests__/package.test.ts`: recognize the retained historical export-budget record
      - `.github/workflows/live-matrix.yml`, `scripts/live-matrix.json`: `release/memory-bench` row, manual only
      - `docs/live-testing.md`: the row and its cost
      - `docs/_evidence/memory-bench-0.13.0.md`: baseline section
      - `CHANGELOG.md`: `[Unreleased]` entry
    - References:
      - plan 184 (wire proxy and usage cross-check)
      - plan 182 Task 5 (`scripts/wire-proxy.mjs`)
  - Test Cases to Write:
    - `memory_bench_refuses_checksum_mismatch`: a tampered cache file fails with `MemoryBenchDatasetError` (breaks if verification is skipped).
    - `memory_bench_offline_smoke_reports_every_ability`: the synthetic run emits every ability key and token fields (breaks if a category is dropped).
    - `memory_bench_aborts_at_token_ceiling`: `--max-input-tokens 1` stops after the first question with a partial report.
    - `memory_bench_logs_injected_items_with_source_and_tokens`: the offline smoke's report has an injection log whose token sum equals the measured context-block tokens (breaks if a source is not logged).
    - `memory_bench_compare_is_paired_mcnemar`: a fixture pair gives the known exact p-value; mismatched question ids are refused.
    - `memory_bench_targeted_subset_contains_base_subset`: the 30-question draw includes the 10 base ids for that type.
    - `scoped_eval_recall_smoke_probe`: the renamed probe keeps its behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A renamed scoped-eval export, and a new opt-in live row.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`: usage, subsets, cost ceiling, comparability caveat
      - `docs/live-testing.md`: row
      - `packages/memory/fabric/README.md`: probe rename
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Added the opt-in, scripts-only harness for all three pinned suites and four configurations, verified runtime downloads, seeded base/targeted subsets, dated native-session replay, upstream judge templates and scoring, wire usage, worker counts, block/item injection logging, atomic checkpoints, and exact paired McNemar comparisons. Dataset/answer/memory text is excluded from evidence.
    - Decoded the actual pinned draws: LongMemEval 70, LoCoMo 386 QA across two conversations, MemoryAgentBench 40 stratified row/question pairs. Corrected Task 1's assumed source labels to the decoded `factconsolidation_sh_*` / `factconsolidation_mh_*`. Parquet uses isolated benchmark-only `pyarrow==23.0.1`; stemmed F1 uses pinned `nltk==3.9.2`. No package runtime dependency was added.
    - Recorded every suite/configuration outcome in `docs/_evidence/memory-bench-0.13.0.md` and linked JSON/Markdown artifacts. On OpenCode Go MiMo v2.5, full context completed LongMemEval 56/70 (80%) and conflict resolution 17/40 (42.5%; ten truncated questions). Fabric-only is unavailable until Task 13. OM and combined attempts ended with worker errors and retain their partial scores/usage; LoCoMo full context stopped on an invalid judge response in its retry. These are failed measurements, not successful full quality baselines. No live paired comparison is claimed for mismatched scored sets. Task 14 retains final measurement and ablations after the fixes.
    - Continued the full live execution at the user's explicit direction. Each attempt retained the 15M input-token ceiling. Increased harness worker waits, then individual-call/run deadlines, to ten minutes after observed timeouts; retained failed timeout attempts as diagnostics. Full-context retries were bounded and separately recorded; attempts were not merged. No memory defaults were tuned.
    - Renamed the synthetic scoped probe/fixture/result field to recall smoke, updating all callers without an alias. Regenerated the fabric compatibility baseline with `bun scripts/release.mjs gate --update-baseline`: `probeLocomoRecall` becomes `probeRecallSmoke`, attributed to this task. The frozen `arnilo__prism-memory.txt` 0.12-family baseline remains historical. The live-tree retirement sweep excludes the benchmark and frozen historical records and returns no remaining old probe names.
    - Added the manual-only `release/memory-bench` workflow row and the offline regression file to the existing default gate-test stage. Updated the benchmark/package READMEs, live-testing documentation and changelog. Kernel packed/unpacked byte ceilings were attributed to shipped documentation growth (1,070,298 / 3,501,307 bytes); no kernel runtime code/dependency growth.
    - Verification: 19 harness regressions plus 17 test-runner checks passed; fabric 153 passed / 19 external Postgres skips; OM 64 passed; live matrix/docs/workflow 28 passed. Full workspace typecheck and release gate passed. Verified pinned draws, decoder and upstream-compatible F1 self-checks. All four offline statuses and paired mock comparison were checked. Item precision/citation rates remain limited by metadata scheduled in Tasks 4, 9, 11 and 12.

- [x] Task 3: OM ledger correctness — reflections replace their evidence
  - Acceptance Criteria:
    - Functional:
      - **Tool schemas.** `record_reflection` and `drop_observations` declare full argument schemas: `content` and `supportingObservationIds` required; `observationIds` required. Today both are `{ type: "object" }` (`observational/src/workers/reflector.ts:29`, `workers/dropper.ts:53`), the defect `observer.ts` already documents for weaker models.
      - **Reflection replaces.** A reflection pass takes the active reflections plus the unreflected observations as input, and its output replaces both (Mastra OM: "each reflection rewrites the entire observation log").
        - `om.reflections.recorded` gains `consumedObservationIds` and `supersededReflectionIds`, both optional for old ledgers.
        - `foldObservationalMemoryLedger` marks consumed observations inactive (reason `reflected`) and superseded reflections inactive.
        - A pass that records zero reflections consumes nothing.
      - **Visibility.** A reflection is hidden only when one of its sources is **invalidated** (revocation or deletion lineage), never because an observation was dropped or consumed for budget. This fixes `observational/src/context.ts:28` and the same rule in `strategy.ts` `visibleProjection`. The `recall` tool still returns consumed or dropped evidence for a reflection id (`recall.ts`), marked `(reflected)` / `(dropped)`.
      - **Dropper as backstop.** The dropper runs after the reflection step whenever active observation tokens exceed `dropper.targetTokens`, not only when a reflection ran (`flush.ts:154`). Config validation rejects `dropper.targetTokens < reflector.observationTokens` with a config error naming both keys, so the dropper cannot cut the pool below the reflection trigger. The default `dropper.targetTokens` becomes `20000` (= `OBSERVATIONS_POOL_MAX_TOKENS`).
      - **Truncation keeps the newest.** `renderObservationalMemory` drops the *oldest* observations first when over `maxBytes` (today `truncateWorkerText` cuts the tail, the newest; `render.ts`). Reflections are never cut before observations.
    - Performance: The reflector prompt is bounded by `worker.maxMessageBytes` as today. Consuming observations shrinks the rendered block, so there are no added calls.
    - Code Quality:
      - Ledger records stay append-only; new fields are optional and folded by the existing `isReflectionsRecordedData` guard, extended.
      - No compatibility alias.
      - `reflectionBlockedByInvalidation` keeps its name but takes only the invalidated set; callers are updated per Task 1 (h).
    - Security: Revocation still wins over everything: a consumed observation whose source is revoked withholds the reflection (`recall.ts` revoked branch keeps its test).
  - Approach:
    - Documentation Reviewed:
      - `observational/src/{flush.ts,ledger.ts,context.ts,render.ts,strategy.ts,workers/*.ts,coverage-helpers.ts}`
      - Generative Agents (Park et al., UIST 2023): reflections are first-class memories that cite evidence and outlive it
      - Mastra OM docs (mastra.ai/docs/memory/observational-memory, fetched 2026-10-17): reflection rewrites the log; memory stays bounded near the reflection threshold
    - Options Considered:
      - Keep reflections additive and only fix the visibility rule. Rejected: reflections then grow without bound and duplicate their observations in context.
      - A separate "condense reflections" pass. Rejected: one pass that takes reflections plus new observations is the published design and needs no extra trigger.
    - Chosen Approach:
      - Replace-on-reflect with provenance kept in the ledger, so `recall` can still show evidence.
    - API Notes and Examples:
      ```ts
      interface ReflectionsRecordedData {
        readonly type: "om.reflections.recorded";
        readonly reflections: readonly unknown[];
        readonly coversUpToId?: string;
        readonly consumedObservationIds?: readonly string[];
        readonly supersededReflectionIds?: readonly string[];
      }
      ```
    - Files to Create/Edit:
      - `packages/memory/observational/src/{types.ts,ledger.ts,flush.ts,context.ts,render.ts,strategy.ts,projection.ts,recall.ts,config.ts,settings.ts,coverage-helpers.ts,commands.ts,exports.ts}`
      - `packages/memory/observational/src/workers/{reflector.ts,dropper.ts}`
      - tests under `src/__tests__/` (`reflection-replacement.test.ts` regressions and the empty-pass coverage expectation in `coverage.test.ts`)
      - `scripts/compat-baseline/arnilo__prism-memory-observational.txt`: regenerated if exported types change; the diff goes in the note
      - `packages/memory/observational/README.md`, `CHANGELOG.md`
    - References:
      - review findings OM-1, OM-2, OM-4, OM-8
  - Test Cases to Write:
    - `reflector_and_dropper_tools_declare_argument_schemas`: asserts `required` keys (breaks on a bare object schema).
    - `reflection_consumes_supporting_observations`: after a pass, consumed ids are inactive and the reflection renders.
    - `dropped_observation_does_not_hide_reflection`: budget drop leaves the reflection visible (the current bug).
    - `invalidated_source_withholds_reflection`: revocation still hides it.
    - `reflection_pass_supersedes_prior_reflections`: the second pass replaces the first; the rendered block holds only the new one.
    - `dropper_runs_without_reflection_when_over_target`.
    - `config_rejects_drop_target_below_reflection_trigger`.
    - `render_truncation_drops_oldest_observations_first`.
    - `recall_returns_consumed_evidence_marked_reflected`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Ledger record fields, reflection semantics, a dropper default.
    - Docs pages to create/edit: `packages/memory/observational/README.md`: the cost table, `dropper.targetTokens` default, a "Ledger" section describing replace-on-reflect and visibility.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Reflection passes now read active reflections plus unreflected observations and append replacement metadata only when they record valid reflections. Folding and merging preserve evidence history while active views exclude consumed observations and superseded reflections. Re-recording an identical reflection keeps it active.
    - Updated context, commands, compaction, projection, and recall together. Budget drops no longer suppress reflections; invalidation resolves source ids against the full evidence ledger, including consumed observations. Recall labels consumed evidence `(reflected)` and dropped evidence `(dropped)`.
    - Added full reflector/dropper argument schemas, independent post-reflection dropping, cross-key config validation, the 20,000-token dropper default, and oldest-first observation removal under the rendering byte cap. The library settings default also becomes 20,000; its explicit pool-target override remains supported.
    - Updated the OM README and root changelog. No dependencies or kernel source changes.
    - Checks passed: OM suite (73 tests), fabric suite (153 passed, 19 existing PostgreSQL skips), workspace `bun run typecheck`, offline `examples/observational-memory.ts`, docs suite, and `bun scripts/release.mjs gate --package @arnilo/prism-memory-observational --skip-tarball` after baseline regeneration.
    - Full `bun scripts/release.mjs gate --update-baseline` regenerated declarations but fails the existing kernel tarball budget: packed 1,070,403 > 1,070,298 bytes (+105), unpacked 3,501,628 > 3,501,307 (+321). Left those unrelated budgets unchanged. The full release gate still needs this resolved before release; task-local implementation and compatibility checks pass.
    - Semantic compatibility-baseline diff (also regenerated the formatted re-export declarations; no exports removed):
      ```diff
      -DEFAULT_DROPPER_TARGET_TOKENS = 10000
      +DEFAULT_DROPPER_TARGET_TOKENS = 20000
      +activeReflections(ledger: ObservationalMemoryLedger): readonly MemoryReflection[]
      -reflectionBlockedByInvalidation(..., droppedOrInvalidated: ReadonlySet<string>): boolean
      +reflectionBlockedByInvalidation(..., invalidated: ReadonlySet<string>): boolean
      ```
      The optional record/ledger metadata and reflector input are additive type fields; the baseline extractor records interface export declarations rather than their member bodies.
    - Later-task finding: Task 14 must measure replacement behavior and the new dropper default; this task supplies functional proof only. Whole-plan benchmarks and verification remain with their scheduled tasks.

- [x] Task 4: OM temporal grounding, supersession, and task state
  - Acceptance Criteria:
    - Functional:
      - **Event time.** `MemoryObservation` gains `observedAt` (ISO; the latest `timestamp` of its `sourceEntryIds`, from `SessionEntry.timestamp`, `src/contracts-core/session.ts:46`) and optional `referencedAt` (ISO date the content refers to, from the observer). `timestamp` keeps meaning "recorded at".
      - **Observer instructions** require relative time references to be converted to absolute dates using the message time.
      - **Observer input** prefixes each serialized message with its date and time, and inserts a `[gap: <duration>]` line when ≥ 10 minutes separate consecutive messages (Mastra's temporal markers).
      - **Render** groups observations under `### <YYYY-MM-DD>` headings in `observedAt` order, each line `- [id] HH:MM (relevance) content`, plus `(refers to <date>)` when `referencedAt` is set.
      - **Reflections** carry `observedFrom`/`observedTo` (min/max of their evidence) and render with that range.
      - **Supersession.** `record_observation` accepts optional `supersedes: <observation id>`. A valid id appends `om.observations.dropped` with `reason: "superseded"` and `supersededBy`. An unknown id is ignored and the observation is still recorded; the tool result says so.
      - **Task state.** The observer gets a second tool, `record_task_state { goal, openQuestions?, decisions?, nextSteps? }` (schema-declared, every field a bounded string or string array).
        - Each call appends `om.task_state.recorded` with `sourceEntryIds`. The fold keeps only the latest record, so task state never accumulates.
        - The observer instruction asks for it when the session's goal, open questions, or next steps changed in the supplied messages, and to list assumptions made without user confirmation under `openQuestions`. This guards against the premature-assumption failure in Laban et al. 2025.
        - The OM compactor's summary includes it (Task 5).
      - **Render order and citation.**
        - The block renders reflections, then dated observations (oldest to newest), then `## Current task` last, nearest the conversation tail. Lost in the Middle (Liu et al., TACL 2024) shows mid-context content is used least.
        - The header line becomes: `Use these source-backed memories when relevant and cite the ids you rely on as [id]. To inspect evidence, call recall with an id; do not guess ids.`
        - Citation is the cheap form of "recite the evidence first" (Du et al. 2025). It also feeds the cited-id signal (Task 2's injection log, Task 9's access touch).
      - **Block metadata.** The `observational-memory` block carries `metadata: { source: "om", itemIds: [...] }` (reflection, observation, and task-state ids in render order) for Task 2's injection log and plan 194's accounting.
    - Performance:
      - No extra model call. The date prefixes add about 6 tokens per message to observer input (stated in the README cost table).
      - Task state is one bounded section (cap `worker.maxTaskStateBytes`, default 2,048), replaced, never appended.
    - Code Quality: Fields are optional so older ledgers fold (`isMemoryObservation` accepts their absence); the render falls back to `timestamp`'s date.
    - Security: Timestamps come from stored entries, never from model output, except `referencedAt`, which is validated as an ISO date or dropped.
  - Approach:
    - Documentation Reviewed:
      - `observational/src/{types.ts,serialize.ts,render.ts,workers/observer.ts}`
      - LongMemEval: temporal reasoning and knowledge update are the weakest abilities; time-aware indexing and query expansion improve them
      - Mastra OM docs (2026-10-17): dated logs, relative→absolute conversion, temporal gap markers
      - Zep (Rasmussen et al., 2025, arXiv 2501.13956): bi-temporal validity and explicit invalidation of superseded facts
      - Laban et al., 2025 (arXiv 2505.06120): multi-turn performance drops about 39%, driven by early assumptions that are never revised
      - Liu et al., TACL 2024 ("Lost in the Middle"); Du et al., 2025 (arXiv 2510.05381): reciting evidence before answering recovers part of the length loss
      - Anthropic, "Effective context engineering for AI agents" (2025): compaction keeps goals and unresolved issues
    - Options Considered:
      - Render only `timestamp`. Rejected: that is when the observer ran, not when the event happened.
      - Model-only dates. Rejected: message time is known exactly from the store.
      - Task state as ordinary observations. Rejected: it changes every few turns, so as observations it would accumulate superseded versions; one replaced record keeps it bounded.
    - Chosen Approach:
      - Event time from the store, referenced time from the model with validation, supersession as an explicit drop record.
    - API Notes and Examples:
      ```text
      ### 2026-10-15
      - [a1b2c3d4e5f6] 09:12 (high) User moved the deploy to Friday (refers to 2026-10-17)
      ```
    - Files to Create/Edit:
      - `packages/memory/observational/src/{types.ts,serialize.ts,render.ts,ledger.ts,context.ts,limits.ts,config.ts,flush.ts,projection.ts,recent-messages.ts,recall.ts,commands.ts,index.ts,exports.ts,workers/observer.ts,workers/reflector.ts}`
      - `examples/observational-memory.ts` (scripted provider reads the entry id after the new timestamp prefix)
      - tests
      - baseline `scripts/compat-baseline/arnilo__prism-memory-observational.txt`
      - README
      - `CHANGELOG.md`
    - References:
      - review findings OM-5, OM-6; context-rot review 2026-10-17 (task state, citation, render order)
  - Test Cases to Write:
    - `observation_observed_at_is_latest_source_timestamp`.
    - `observer_input_has_dates_and_gap_markers`: a 2-day gap renders `[gap: 2d]`.
    - `render_groups_by_observed_date`.
    - `invalid_referenced_at_is_dropped`.
    - `observer_supersedes_marks_old_observation_dropped`.
    - `unknown_supersedes_id_is_ignored_and_reported`.
    - `legacy_observation_without_observed_at_renders_by_timestamp`.
    - `task_state_latest_record_wins`: two records fold to the second; the block has one `## Current task` section.
    - `task_state_renders_last_in_block`.
    - `task_state_tool_declares_schema_and_caps_bytes`: an oversized field is truncated to the cap (breaks if unbounded).
    - `block_header_asks_for_id_citation`.
    - `om_block_metadata_lists_item_ids_in_render_order`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Observation fields, tool argument, render format.
    - Docs pages to create/edit: `packages/memory/observational/README.md` (render example with `## Current task`, `record_observation` and `record_task_state` arguments, citation instruction, `worker.maxTaskStateBytes`).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Implemented source-derived `observedAt`, validated `referencedAt`, dated observer input and ≥10-minute gap markers, dated observation groups, and evidence-derived reflection ranges (including ranges inherited from prior reflections). Optional temporal fields preserve legacy ledgers.
    - Added explicit supersession drop records and an unknown-id warning without rejecting the new fact. `runObserver` keeps its observation-array return shape and exposes additional ledger records through `onRecord`; the flush persists them after the observation batch.
    - Added schema-declared `record_task_state`, shared UTF-8 text bounds (`worker.maxTaskStateBytes`, default 2,048; hard ceiling 65,536), latest-only folding, current-task prompt context, citation guidance, and rendered-item metadata in display order. Current task renders last and survives oversized reflection prefixes. `om:view`, branch context blocks, and source-backed task-id recall use the same state; revoked sources withhold task recall.
    - Updated the README, changelog, prior prompt/schema assertions, and scripted provider fixtures. No dependency, kernel code, or extra model call was added.
    - Checks passed: `bun run typecheck`; OM suite (84 pass); fabric suite (153 pass, 19 environment-gated skips); memory benchmark offline unit suite (19 pass); compatibility-baseline currentness check (1 pass); `bun examples/observational-memory.ts` (SQLite restart, recall, compaction, secret redaction, slot ownership); scoped `git diff --check`.
    - Release gate limitation: both `bun scripts/release.mjs gate --update-baseline` and the OM package-filtered gate regenerated the baseline but failed the kernel package-size budgets. The first run measured packed/unpacked overages of 105/321 bytes; after the example fixture adjustment the package-filtered run measured 193/548 bytes over. No budget was raised. This remains a release-wide verification blocker, rather than unfinished Task 4 behavior.
    - Baseline delta (`scripts/compat-baseline/arnilo__prism-memory-observational.txt`): additions `DEFAULT_MAX_TASK_STATE_BYTES`, `HARD_MAX_TASK_STATE_BYTES`, `MemoryTaskState`, `TaskStateRecordedData`, `TASK_STATE_RECORDED`, `isTaskStateRecordedData`, and the declaration scanner's `isIsoDate` entry; updated the observer instruction and grouped type re-export rows to include the new types. No exports removed. Existing signatures remain; new fields/options are optional except the resolved worker limit.
    - Later-task handoff: Task 5 still owns carrying task state into the compaction summary/folded snapshot and changing injection timing. The existing package log retains task-state records; this task does not claim compaction-summary support. Live provider/benchmark ablations remain Task 14. No retired API/config names required a retirement sweep.

- [x] Task 5: OM context that keeps the prompt cache
  - Acceptance Criteria:
    - Functional:
      - **No per-pass prefix churn.** OM's `context.build` (`observational/src/index.ts:99`) renders:
        - nothing before the session's first compaction (the history is verbatim)
        - nothing after a compaction made by OM's own compactor (its summary already is the ledger; this removes the duplicate injection via `src/session-stores.ts:177`)
        - after a compaction by another slot owner, the ledger **pinned** at that compaction: on a successful `compaction.completed`, capture the bounded ledger snapshot synchronously, then resolve the already-appended compaction entry/id/strategy through `session.entries()` (the event carries none). Serialize the `om.context.pinned { coversUpToId, compactionEntryId }` write and await its pending promise in `context.build` before rendering; observe hooks themselves are not awaited. Ignore failed/duplicate events and reconcile once on reopen. `turn.completed` is recovery only, not the first-request synchronization point. The block renders the captured ledger snapshot for that record.
        - The block therefore changes only when a compaction has already rewritten the prefix.
      - **Observation-driven compaction when OM owns the slot.** OM's compactor appends `om.compacted { coversUpToId }` when it runs.
        - Once a session has an `om.compacted` record, OM's `compaction.when` requests compaction whenever the observation coverage cursor is ahead of the last `om.compacted` cursor. Observed messages then leave the context in the same step that changes the prefix (Mastra: "observed messages are removed from the context window").
        - Before the first `om.compacted` (or when another package owns the slot), the existing `context.compactAfterTokens`/`trigger` gate applies unchanged. A foreign owner is never asked to compact more often than today.
      - **Bounded observer input.** The observer receives the most recent active observations within `dropper.targetTokens / 4` tokens, not the whole pool (`workers/observer.ts:79`).
      - `om:status` reports `contextMode: "none" | "own-compaction" | "pinned"`.
      - The OM compactor's summary renders the Task 4 block order, ending with `## Current task`, so the summary's last section is the task state.
    - Performance:
      - On a session where OM owns the slot, consecutive provider requests between compactions keep the system prompt, summaries, and history byte-identical. This is proved with `prefixStabilityConformance` from plan 184 if it has landed, else a local request-diff test.
      - Observer input is O(new messages + bounded pool).
      - The README cost table states: one compaction per observation pass when OM owns the slot (no model call; the summary is the ledger).
    - Code Quality:
      - No kernel change and no steady-state branch read in `context.build` (the log is in memory); await a pending compaction pin or one-time reopen reconciliation before rendering.
      - `compactAfterTokens` keeps its meaning as the gate before the first own compaction and for foreign owners.
    - Security: The pinned and compaction renders keep redaction (`redactSecrets`) and invalidation filtering.
  - Approach:
    - Documentation Reviewed:
      - `src/loop/run-controller.ts:133-159` (context blocks rendered at the prefix boundary)
      - `src/input.ts:85-135` (summaries before history)
      - `src/agent-session/session.ts:1010-1054` (`compaction.when` timing)
      - `apps/prism-agent/src/host/coding.ts:31` (OM installed, slot owned by `memory-compaction`)
      - Mastra OM docs and blog (2026-10-17): stable, append-only prefix; cache invalidated when observations activate or reflect
      - Anthropic and OpenAI prompt-caching behavior (prefix match), via plan 184 Task 1
    - Options Considered:
      - A kernel `slots.<name>.owns()` query. Rejected: the `om.compacted` log marker expresses ownership with existing seams (roadmap: no kernel addition when a seam exists).
      - Render the ledger at the tail every turn. Rejected: it re-bills the whole block each turn and still duplicates verbatim history.
      - Keep today's prefix block. Rejected: each pass (default every 10k tokens) invalidates up to 81k tokens of cached history and duplicates it.
    - Chosen Approach:
      - Couple every prefix change to a compaction, as Mastra does, with a pinned snapshot for foreign compactors.
    - API Notes and Examples:
      ```ts
      prism.hooks.on("compaction.completed", (event, context) => {
        if (event.error || !context.session) return;
        /* Capture the ledger now; retain the entry-scan/pin promise for context.build to await. */
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/observational/src/{index.ts,context-cache.ts,compactor.ts,strategy.ts,flush.ts,commands.ts}` (pin coordination is internal; observer input is bounded at the flush call site)
      - tests (observational, strategy)
      - `examples/observational-memory.ts`: shows the own-compaction mode; keep its assertions green
      - `apps/prism-agent` tests if they assert the OM block
      - README, `CHANGELOG.md`
      - `scripts/budgets.json`: measured root pack ceilings for the shipped CHANGELOG entries; no export moves or baseline regeneration
    - References:
      - review findings OM-3, OM-7, OM-9
      - plan 184
  - Test Cases to Write:
    - `om_context_block_empty_before_first_compaction`.
    - `foreign_compaction_pin_ready_before_next_model_request`: delayed entry scan/log append is awaited by context build, including run-start compaction.
    - `failed_compaction_does_not_pin_and_duplicate_event_does_not_repin`.
    - `reopened_session_reconciles_latest_compaction_once`.
    - `om_context_block_empty_after_own_compaction` (the duplicate-injection bug).
    - `om_context_block_pinned_after_foreign_compaction`: with `slots: { compaction: memory-compaction }`, the block equals the ledger at the pin and does not change after a later observation pass.
    - `om_requests_compaction_when_coverage_advances_after_own_compaction`.
    - `om_does_not_force_extra_compactions_for_foreign_owner`.
    - `observer_input_bounded_to_recent_pool`.
    - `om_prefix_stable_between_compactions`: the request diff of turns n and n+1 touches only the tail.
    - `om_compaction_summary_ends_with_current_task`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Context placement, compaction triggering, a status field.
    - Docs pages to create/edit: `packages/memory/observational/README.md`: "Context and caching" section with the three modes and the slot-owner interaction.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Implemented the three context modes in an internal `context-cache.ts`: no injection before compaction or after OM compaction; bounded captured ledger pins after foreign compaction. Entry scans and pin writes are serialized and awaited before context assembly. Failed events are ignored, duplicate events do not repin, and reopen reconciles the latest compaction once from its saved pin or preceding ledger records. Compaction while disabled clears the cached mode for subsequent reconciliation.
    - OM compaction records `om.compacted` with the coverage used by its summary; subsequent coverage advancement requests compaction only in own-compaction mode. The initial token/trigger gate and foreign-owner gate remain intact. Summaries render current task state last with existing redaction, and the observer receives only the newest active pool within `dropper.targetTokens / 4` at the flush boundary.
    - Added `contextMode` to status commands/events, documented context/cache behavior and costs, and asserted none/own-compaction modes in the durable SQLite restart example. No kernel change, dependency, moved/removed public export, or retired name; compatibility baselines are unchanged.
    - Proof: observational suite **96 passed**, including delayed entry scans/log writes, duplicate/failed events, reopen recovery, own/foreign gates, bounded observer input, task-state summary/redaction, request-prefix equality, and `runPrefixStabilityConformance` with cacheable continuity **1**. A final focused observational integration run passed **19 tests**. Fabric suite **153 passed / 19 skipped** (existing optional cases), reference-host suite **38 passed**, docs suite **64 passed**, root `bun run typecheck`, and `bun examples/observational-memory.ts` passed. `bun scripts/release.mjs gate` passed for **43 packages** with no compatibility baseline changes.
    - Release gate initially caught root pack growth from shipped CHANGELOG text. Re-measured `kernel.packedBytes` **1070298 → 1070590** (+292), `kernel.unpackedBytes` **3501307 → 3502167** (+860): **312 bytes** from this task's entry plus **548 inherited bytes** from Tasks 3–4 (227 temporal/task-state + 321 reflection replacement). Updated only these ceilings and their attribution comments; source/export/file-count budgets did not change.
    - Live-provider cache ratios and benchmark ablations remain Task 14; this task proves deterministic request-prefix behavior offline. Whole-plan verification/backlog handoff remains for completion of the remaining tasks.

- [x] Task 6: memory-core — SQLite vector and working store
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-memory-core/sqlite` exports `createSqliteMemoryStores({ path, dimensions? })` returning `{ vectorStore, workingStore, close() }`:
        - It implements the same `VectorStore` and `WorkingMemoryStore` contracts as the Postgres stores: scope isolation, invalidation, consent, `listByThread`, `getByThread`, and share grants (if Task 1 shows the conformance requires them).
        - A `lexicalQuery` (FTS5 BM25) is used by Task 11.
        - Vector search is exact cosine over the scope's rows.
      - It passes `runMemoryConformance` (`packages/memory/fabric/src/conformance.ts`).
      - An unknown or corrupt file fails with `MemoryValidationError`.
      - A path outside the host-provided root is the caller's concern (the fabric resolves it in Task 7).
    - Performance:
      - `bun:sqlite` is loaded lazily only under `./sqlite`, so the root entry never imports it (a "not loaded unless used" test, like `./postgres`).
      - Exact cosine scoring is O(rows in scope × dimensions), followed by deterministic sorting. The README states the trade-off (fine to about 50k notes per scope; Postgres+pgvector beyond).
    - Code Quality: Mirrors the `./postgres` layout and DDL builder style; no new runtime dependency.
    - Security:
      - Identifiers are validated with `validateIdentifier`.
      - Every SQL query is parameterized.
      - The file is created with mode 0600.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/core/src/postgres/index.ts:50-130`
      - `packages/stores/sqlite/src/bun-runtime.ts`
      - Bun `bun:sqlite` docs (find-docs; version pinned by `engines.bun >=1.4.2`)
      - SQLite FTS5 docs
    - Options Considered:
      - JSON files on disk. Rejected: no lexical index, no atomic writes.
      - `sqlite-vec`. Rejected: a native extension dependency; exact cosine is enough at agent scale.
      - Put the store in `packages/stores/sqlite`. Rejected: that package is the session store slot; memory stores are memory-core contracts (§2 table: memory-core owns the vector stores).
    - Chosen Approach:
      - A memory-core subpath, parallel to `./postgres`.
    - API Notes and Examples:
      ```ts
      const { createSqliteMemoryStores } = await import("@arnilo/prism-memory-core/sqlite");
      const stores = await createSqliteMemoryStores({ path: "./memory/.prism-memory.sqlite" });
      ```
    - Files to Create/Edit:
      - `packages/memory/core/src/sqlite/{index.ts,ddl.ts}`: new
      - `packages/memory/core/package.json`: `exports["./sqlite"]`
      - `packages/memory/core/tsconfig.json`: include the installed Bun SQLite type declarations
      - `scripts/budgets.json`: measured root pack ceilings for the required CHANGELOG entry
      - `packages/memory/core/src/__tests__/sqlite.test.ts`: new
      - `scripts/compat-baseline/arnilo__prism-memory-core.txt`: regenerated; the diff goes in the note
      - `packages/memory/core/README.md`, `CHANGELOG.md`
      - `scripts/e2e-coverage.json`: new test file listed if the coverage map requires it
    - References:
      - review finding FAB-1
  - Test Cases to Write:
    - `sqlite_store_passes_memory_conformance`.
    - `sqlite_store_survives_reopen`.
    - `sqlite_lexical_query_ranks_bm25`.
    - `memory_core_root_does_not_load_bun_sqlite`.
    - `sqlite_store_rejects_corrupt_file`.
    - `sqlite_file_mode_is_0600`.
    - `sqlite_isolates_scope_and_filters_before_ranking`: ACLs, invalidation, lineage, and allow-lists filter both retrieval legs before topK.
    - `sqlite_batches_rollback_and_working_cas_is_atomic`: failed vector batches leave no rows; two connections cannot both claim version zero.
    - `sqlite_pagination_generations_holds_and_aborts`: stable cursors, generation rollback in both query legs, sticky legal holds, scoped share grants, and cancelled writes.
    - `sqlite_dimensions_and_identifiers_fail_closed`: unsafe SQL identifiers and incompatible dimensions are rejected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new subpath.
    - Docs pages to create/edit: `packages/memory/core/README.md`: export table row and the scale trade-off.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Added the `@arnilo/prism-memory-core/sqlite` subpath with `createSqliteMemoryStores({ path, dimensions? })`, its store/options types, and a validated DDL builder. Bun SQLite loads dynamically only inside the factory; the root stays driver-free. No runtime dependency or kernel source change.
    - Vector records, consent metadata, scope generations (including bigint), ACL replace-sets, sticky invalidations/legal holds, and resource-isolated share grants persist in SQLite. Exact cosine and FTS5 BM25 both apply scope, generation, lineage, ACL, and id filters before topK. FTS triggers keep updates/deletes indexed; delete counts use `RETURNING` because SQLite's change count includes trigger writes. Vector batches and working-memory merge/replace/version checks use immediate synchronous transactions, including across two connections.
    - Unknown/corrupt/incompatible files fail with `MemoryValidationError`; new files use 0600. Persisted dimensions are checked on reopen. The README documents exact-scan sizing (about 50k notes per scope), sorting cost, literal-token FTS queries, existing-file permission preservation, and caller-owned path containment. Task 7 can consume this factory directly; it still owns root resolution, default selection, and lifecycle wiring.
    - Proof: memory-core **18 passed** (including **11 SQLite tests** and shared `runMemoryConformance`), fabric **153 passed / 19 skipped**, RAG **99 passed / 4 skipped**, docs **64 passed**, root `bun run typecheck`, final memory-core typecheck, and focused Biome checks passed. Skips are existing optional integration cases. `bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-memory-core` and the subsequent full `bun scripts/release.mjs gate` passed for **43 packages**. Registered the new suite and subpath in the coverage ledger.
    - Compatibility baseline diff in `scripts/compat-baseline/arnilo__prism-memory-core.txt`: two additive declaration signatures; no changed or removed signatures, and no retirement sweep needed:
      ```diff
      +buildSqliteMemoryDdl export declare function buildSqliteMemoryDdl(tableInput?: string): string
      +createSqliteMemoryStores export declare function createSqliteMemoryStores(options: SqliteMemoryStoresOptions): Promise<SqliteMemoryStores>
      ```
    - The restricted package type configuration now includes the already-installed `bun-types/sqlite.d.ts`. Release packing initially exceeded the exact kernel byte ceilings solely because the required root CHANGELOG entry adds **232 unpacked bytes / 125 packed bytes**. Updated and attributed only those ceilings: **1070590 → 1070715** packed, **3502167 → 3502399** unpacked; kernel source, export, file-count, and dependency budgets are unchanged.
    - Documentation verified against Bun **1.4.2** SQLite transactions/prepared statements (`https://github.com/oven-sh/bun/blob/bun-v1.4.2/docs/runtime/sqlite.mdx`) and SQLite FTS5 (`https://www.sqlite.org/fts5.html`). No live provider calls or large-scale benchmark were needed. Whole-plan verification and backlog handoff remain for completion of the remaining tasks.

- [x] Task 7: Fabric durability
  - Acceptance Criteria:
    - Functional:
      - Config `store` accepts `"memory"`, `{ sqlite: { path } }`, or `{ postgres: {...} }`.
        - **Default:** `{ sqlite: { path: "<tools.root>/.prism-memory.sqlite" } }` when `tools.root` is set.
        - Otherwise `"memory"`, with `prism.status.note("warn", "memory-fabric: no durable store configured; memory is lost when the process exits")`.
        - A relative sqlite `path` resolves against `tools.root` and must stay inside it; anything else fails config validation.
      - With Postgres, the package uses `createPostgresMemoryStores` (`core/src/postgres/index.ts:94`), so the working memory is durable too. Today it is always the in-process `Map` (`fabric/src/index.ts:99`).
      - **Startup reconcile:** on setup, files under `tools.root` whose content hash differs from their indexed `file` note (or that have none) are re-indexed in one bounded background pass (`rebuildBatchSize`, `rebuildMs`). Notes for deleted files are forgotten.
    - Performance:
      - Reconcile costs one embedding per changed file, never per unchanged file (hash stored in note metadata).
      - The README states the per-file cost and that `store: "memory"` avoids disk writes.
    - Code Quality: `resolveStore` returns stores as a pair; the config schema keeps `connection` ref-only.
    - Security:
      - The Postgres connection stays ref-only (`env:`/`keyring:`).
      - The SQLite path cannot escape `tools.root`.
      - The reconcile reads only inside `tools.root` through the existing files gate.
  - Approach:
    - Documentation Reviewed:
      - `fabric/src/index.ts:76-200`, `fabric/src/config.ts:84,119-125,222`, `fabric/src/files.ts`
      - `memory.ts:492` (`rebuildIndex`)
      - MemGPT (Packer et al., 2023, arXiv 2310.08560): persistent core, recall, and archival tiers
      - Anthropic memory tool docs (file-based durable memory)
    - Options Considered:
      - Keep the `"memory"` default and document it. Rejected: a package called long-term memory that forgets on exit by default contradicts its purpose.
      - Always require explicit config. Rejected: `tools.root` already names a durable directory the host chose.
    - Chosen Approach:
      - Durable by default wherever the host gave a directory; loud warning otherwise.
    - API Notes and Examples:
      ```ts
      memoryFabric({ tools: { root: "./memory" } }); // → SQLite at ./memory/.prism-memory.sqlite
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{index.ts,config.ts,files.ts}`
      - a new `packages/memory/fabric/src/reconcile.ts`
      - tests (package, host-wiring, a new reconcile test)
      - `examples/working-semantic-memory.ts`: restart demo or unchanged; the note says which
      - README, `CHANGELOG.md`
      - baseline regeneration for config types
      - `fabric/src/{create.ts,types.ts,tools.ts}`: file content hashes, `fabric/tsconfig.json`: SQLite types
      - `packages/stores/sqlite/src/bun-sqlite.d.ts`: shared ambient declaration needed by examples importing both SQLite packages
      - `scripts/budgets.json`: root CHANGELOG-only tarball growth
    - References:
      - review finding FAB-1
  - Test Cases to Write:
    - `fabric_defaults_to_sqlite_under_tools_root`.
    - `fabric_warns_without_durable_store`.
    - `fabric_sqlite_path_outside_root_fails_config`.
    - `fabric_working_memory_survives_restart_sqlite`.
    - `fabric_postgres_uses_durable_working_store` (integration, Postgres-gated like the existing integration tests).
    - `fabric_reconcile_reindexes_only_changed_files`.
    - `fabric_reconcile_forgets_deleted_files`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Store default and config shape.
    - Docs pages to create/edit: `packages/memory/fabric/README.md`: Config, cost of reconcile, durability.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Stores now resolve as a vector/working pair. `tools.root` defaults to SQLite at `.prism-memory.sqlite`; explicit in-process stores warn about loss on exit. SQLite paths are checked lexically and through the existing real-path jail before opening. Postgres uses `createPostgresMemoryStores`; custom vector tables still share its durable working store and pool. Disposal drains reconciliation before closing stores.
    - Startup defers one bounded pass until package services are available. File notes carry SHA-256 `contentHash`; file inserts stamp it too. Reconcile embeds changed/new files once, keeps unchanged files free of embedding calls, and forgets missing files. Database files/sidecars and symlinks are excluded; invalidated/held rows are not revived. The first context build waits for the pass, preventing startup races with tools.
    - Bounds: one index page and at most `limits.rebuildBatchSize` visited entries, with `limits.rebuildMs` cancellation; directory views stop at their existing 200-entry cap. Truncated listings never imply deletion. Empty/oversized files are skipped. Large directories/indexes need explicit rebuilding; this bounded startup pass is not a full filesystem watcher. Missing embeddings skip reconciliation. README records these limits and per-file cost.
    - Small prerequisite: examples import both SQLite packages, exposing the session store's older ambient `bun:sqlite` declaration. Added the `strict`, typed `query`, and transaction `immediate` members needed by memory-core. The SQLite store suite passes (43 tests).
    - Verification: fabric suite 158 passed, 20 Postgres-gated skips; core suite 18 passed; repository `bun run typecheck` passed; docs suite 64 passed (including executable examples); `examples/working-semantic-memory.ts` passed unchanged. Restart coverage lives in the package tests, so the existing example remains unchanged. Live Postgres execution was skipped without `PRISM_TEST_POSTGRES_URL`; the new package restart integration test is explicitly gated.
    - `bun scripts/release.mjs gate --update-baseline` and the subsequent ordinary `gate` passed (43 packages). Baseline regeneration has no exported-name additions/removals: the config union, rebuild limits, and hash fields extend existing exported types. Kernel tarball ceilings were remeasured at 1,070,793 packed / 3,502,593 unpacked bytes (+78/+194), solely the root CHANGELOG entry; no kernel source/export/dependency growth.

- [x] Task 8: Fabric write surface — typed notes and in-place edit
  - Acceptance Criteria:
    - Functional:
      - `memory.insert` accepts a third exclusive target, `kind: "fact" | "procedure"`, with optional `supersedes`, `tRef`, `validFrom`, `validTo`, `tags`, and `keywords`. It writes through `fabric.remember`, so the typed note kinds become reachable from tools. Today only working blocks and files are (`fabric/src/tools.ts:137-185`).
      - New `memory.replace { old, new, block | path | id }` replaces exactly one occurrence:
        - zero or more than one match fails with `not_found` / `ambiguous`
        - `new: ""` deletes the text
        - a file edit refreshes its file note
        - an `id` edit rewrites the note through `correct()` (`memory.ts:322`, which records the lineage)
      - `fact`/`procedure` content passes `scanScopedMemoryContent` (`fabric/src/scoped/trust.ts:13`). A refusal returns `refused: <class>` and writes nothing.
    - Performance: One embedding per typed write or note edit, as today for files. Block edits make no model or embedding call.
    - Code Quality:
      - Tool names follow the existing `memory.*` naming.
      - Effects: `memory.replace` is `edit`.
      - No speculative `rename`; file rename is listed in Further Actions if the bench shows a need.
    - Security:
      - The trust scan applies to agent-authored durable content (memory-poisoning defense).
      - File edits stay under `tools.root` through `gateFiles`.
      - Tools stay hidden when the session's fabric is off.
  - Approach:
    - Documentation Reviewed:
      - `fabric/src/{tools.ts,create.ts,blocks.ts,memory.ts:322}`
      - MemGPT `core_memory_append`/`core_memory_replace`
      - Anthropic memory tool commands (`view`, `create`, `str_replace`, `insert`, `delete`, `rename`) and the context-management announcement (memory tool plus context editing: +39% on an internal agentic-search eval, vendor-reported)
      - AgentPoison (Chen et al., NeurIPS 2024) and MINJA (Dong et al., 2025) on memory-poisoning attacks
    - Options Considered:
      - A separate `memory.remember` tool. Rejected: one insert tool with exclusive targets keeps the tool count small (tool-selection accuracy drops with more tools).
      - Free-form full-content overwrite. Rejected: exact-match replace is the pattern both reference designs chose because it fails visibly.
    - Chosen Approach:
      - Extend insert; add replace; trust-scan durable writes.
    - API Notes and Examples:
      ```json
      {"tool":"memory.insert","args":{"text":"Deploys go out on Fridays","kind":"fact","supersedes":"0a1b2c3d4e5f"}}
      {"tool":"memory.replace","args":{"block":"profile","old":"Prefers Python","new":"Prefers TypeScript"}}
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{tools.ts,files.ts,memory.ts}` and `packages/memory/core/src/types.ts` (scoped exact-id read for correction)
      - `packages/memory/fabric/src/__tests__/{tools,package}.test.ts`
      - README (Tools table)
      - `CHANGELOG.md`
      - baseline regeneration
    - References:
      - review findings FAB-2, FAB-3
  - Test Cases to Write:
    - `insert_kind_fact_writes_recallable_note`.
    - `insert_rejects_two_targets`.
    - `replace_block_exactly_once`.
    - `replace_ambiguous_fails`.
    - `replace_empty_new_deletes`.
    - `replace_file_refreshes_note`.
    - `replace_note_id_records_correction_lineage`.
    - `insert_fact_refuses_prompt_injection_content`.
    - `replace_hidden_when_fabric_off`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New tool and tool arguments.
    - Docs pages to create/edit: `packages/memory/fabric/README.md`: Tools table, trust scan.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - The requested title is Task 8 here; plan 158 Task 8 is already complete and concerns kernel context-engineering retirement. This task extends `memory.insert` with exclusive fact/procedure targets and all seven optional note fields, validated by `fabric.remember`. Durable typed inserts and id replacements scan the complete resulting content and return `refused: <class>` without writing.
    - Added `memory.replace` (`edit`) for exactly one block/path/id. Missing or duplicate matches fail visibly (overlapping matches count); empty replacements delete text. Block writes use the existing working-store version check and character cap. Files use the existing jail, refuse truncated reads, enforce the byte cap, and refresh their hash/index; empty files retain a path-only note. Every tool uses the existing session gate.
    - Small prerequisite: `Memory.getEntry` reads a redacted exact-id row in the current thread and excludes blocked/revoked rows, avoiding similarity search for edits. `correct()` now accepts an empty string for full-text deletion while preserving its caps, re-embedding, and correction invalidation lineage. No new exported names: baseline regeneration changes no memory-package name lists; the API additions extend existing interfaces.
    - Verification: core + fabric suites **181 pass / 20 Postgres-gated skips / 0 fail** (`--timeout 20000`; the initial five-second retired-family sweep timed out). Tests cover typed fact/procedure writes, exclusive targets, exact/ambiguous/missing replacement, full deletion, jailed file refresh, correction lineage, held-note exclusion, refusal, session visibility, and one embedding per typed write/id edit versus zero for block edits. Repository `bun run typecheck`, subsequent fabric typecheck, and kernel tools/docs suites (**100 pass**) passed.
    - README Tools/trust/cost details and root CHANGELOG updated. Regenerated release baseline and ordinary release gate both passed (`updated: true`, then `updated: false`), 43 packages; no exported-name additions/removals. The root CHANGELOG adds 67 packed / 175 unpacked bytes, so kernel tarball ceilings are remeasured at 1,070,860 / 3,502,768 with attribution in `scripts/budgets.json`; kernel source/exports/dependencies are unchanged.
    - Scope limits: no file rename or watcher added. Live Postgres checks remain gated without `PRISM_TEST_POSTGRES_URL`. File write and index refresh remain sequential operations, as with insert; a failed embedding can leave the file ahead of its index until reconciliation.

- [x] Task 9: memory-core — scoring fixes and shared helpers
  - Acceptance Criteria:
    - Functional:
      - `NEUTRAL_IMPORTANCE` becomes `0.5` (`core/src/scoring.ts:10`), so an unrated record no longer outranks every rated one.
      - `RecallScoringOptions.recencyBasis: "created" | "accessed"` (default `"accessed"` once `recencyWeight > 0`).
        - `"accessed"` decays from `lastAccessedAt`, falling back to `createdAt`.
        - `Memory.touch(ids)` updates `lastAccessedAt`, one batched upsert per call. Recall itself never touches. Task 11 calls `touch` only for:
          - hits returned by an explicit `memory.recall` tool call
          - ids the model cites as `[id]` in its answer (observed on `turn.completed`)
          
          Passive injection never touches, so an irrelevant hit that keeps being injected does not keep refreshing its own recency (rich-get-richer). Generative Agents counts retrieval as access; this plan counts use. The README says why.
      - New `fuseRankings(lists, { k = 60 })` (reciprocal rank fusion) is moved from `packages/memory/rag/src/fusion.ts`; rag imports it from core (no copy kept).
      - New `withTailContext(draft, blocks)` inserts one message holding the rendered blocks immediately before the draft's latest real user message, preserving that anchor when later assistant/tool messages follow; append when no user message exists (Task 1 (a)). Reinsert on every model call, after engineering's fold/budget handler through existing hook priority/order. The cached prefix is untouched.
        - The message carries `metadata.contextBlocks: [{ title, source, itemIds, tokens }]`, so a consumer that measures context (Task 2's injection log, plan 194's accounting) sees tail blocks exactly like `draft.context` blocks.
      - All existing scoring callers are updated (Task 1 (h)).
    - Performance:
      - The access touch is at most one batched write per tool recall, plus one per turn with citations, and only with `recencyBasis: "accessed"`; the README states it.
      - `withTailContext` is O(messages).
    - Code Quality:
      - The RRF move has no alias.
      - `scripts/compat-baseline/arnilo__prism-memory-core.txt` and `arnilo__prism-memory-rag.txt` are regenerated in this task; the diff goes in the note.
      - Repo-wide grep for the old rag fusion export name.
    - Security: The touch rewrites only `lastAccessedAt` and never content, consent, or importance (asserted).
  - Approach:
    - Documentation Reviewed:
      - `core/src/scoring.ts`
      - `packages/memory/rag/src/fusion.ts`
      - Generative Agents (recency is exponential decay since **last access**; importance is rated on a fixed scale)
      - MemoryBank (Zhong et al., AAAI 2024: recall strengthens memory)
      - Xiong et al., ACL 2026 (arXiv 2505.16067): retrieved-but-misaligned records degrade later runs, so reinforcement should follow use, not retrieval
      - Cormack et al., SIGIR 2009 (RRF, k = 60)
    - Options Considered:
      - Keep neutral = 1. Rejected: it inverts ranking for every host that rates importance.
      - `withTailContext` as a kernel `ContextBlock.placement`. Rejected: the draft-messages seam already expresses it (Task 1 (a)), and the kernel rule forbids additions an existing seam covers.
    - Chosen Approach:
      - Fix the constants and basis; share RRF and tail placement in the one library both memory packages already use.
    - API Notes and Examples:
      ```ts
      return withTailContext(draft, [{ title: "Recalled memory", content }]);
      ```
    - Files to Create/Edit:
      - `packages/memory/core/src/{scoring.ts,types.ts,vector-memory.ts,postgres/index.ts,sqlite/index.ts,index.ts}`
      - a new `packages/memory/core/src/{fusion.ts,tail-context.ts}`
      - `packages/memory/rag/src/{fusion.ts,retrieve.ts}` (import from core)
      - tests in core, fabric, rag, and context engineering (tail placement after budget)
      - baselines (core, rag); `scripts/budgets.json` for root CHANGELOG-only pack growth
      - READMEs (core Scoring, fabric "Recall scoring" section, which today documents neutral `1`)
      - `CHANGELOG.md`
    - References:
      - review finding FAB-7
  - Test Cases to Write:
    - `unrated_importance_is_neutral_half`.
    - `accessed_recency_decays_from_last_access`.
    - `recall_never_touches_by_itself`: a recall leaves `lastAccessedAt` unchanged (breaks if recall reintroduces the touch).
    - `touch_updates_last_accessed_in_one_batch`.
    - `touch_never_changes_content_or_consent`.
    - `fuse_rankings_matches_rrf_reference`.
    - `rag_uses_core_fusion`.
    - `with_tail_context_inserts_before_final_user_message`.
    - `with_tail_context_leaves_prefix_identical`.
    - `with_tail_context_message_carries_block_metadata`.
    - `with_tail_context_preserves_anchor_across_tool_rounds_and_appends_without_user`.
    - `with_tail_context_composes_after_engineering_budget`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Scoring default, new exports, rag internal move.
    - Docs pages to create/edit: `packages/memory/core/README.md`, `packages/memory/fabric/README.md` (Recall scoring), `packages/memory/rag/README.md` (if it names fusion).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Implemented neutral importance `0.5`, validated `recencyBasis` (`accessed` by default, `created` opt-in), and decay from `lastAccessedAt` with creation fallback. Updated existing scoring assertions and documented the defaults.
    - Added `Memory.touch(ids)` in fabric, which owns the `Memory` implementation: exact-thread lookup, deduplicated ids, one batched upsert, and no changes beyond `lastAccessedAt`. Missing, revoked, and invalidated entries are skipped; empty calls do not write. Recall remains read-only. Task 11 owns the explicit tool/citation wiring and must call touch only for access-based recency, never for passive injection.
    - Added optional `MemoryVectorRecord.lastAccessedAt`. In-memory and SQLite stores already spread/serialize the complete record, so neither needed implementation changes. PostgreSQL now reads/writes nullable `last_accessed_at`; idempotent DDL adds it to existing tables. Added gated PostgreSQL round-trip coverage and an offline DDL assertion.
    - Moved N-list RRF into core as `fuseRankings(lists, { k = 60 })`, preserving scope identity, deduplication, deterministic ties, and first-leg display scores. RAG calls core directly; deleted rag's fusion module and its old exports, with no alias. Core exports the fusion types. Added default-k, scope-isolation, and invalid-k coverage alongside the migrated reference tests.
    - Added `withTailContext`: one system message immediately before the latest user message, or appended with no user; existing prefix/message objects remain intact. Metadata carries each block's title/source/itemIds/tokens, with estimated tokens when absent. A real hook-bus composition test registers tail insertion before the budget handler but gives it priority below engineering's `-1000`, proving it runs after budgeting. Task 11 must reapply it to each fresh draft at that priority on every model call.
    - Validation: `bun test --timeout=0 packages/memory/core/src packages/memory/fabric/src packages/memory/rag/src packages/context/engineering/src/__tests__/tail-context.test.ts` passed **286**, skipped **24**, failed **0**. Skips are credential/endpoint-gated PostgreSQL, Drive, and live reranker cases; no live database/service claim is made. The first broad run caught old neutral/resolver expectations, which were updated; a later run under Bun's default 5-second timeout hit an existing hosted-reranker timeout test, and the prescribed timeout-free suite passed. `bun run typecheck` and `bun scripts/release.mjs gate` passed. Changed TypeScript files were formatted.
    - Regenerated core/rag compatibility baselines using `bun scripts/release.mjs gate --update-baseline`. Baseline delta (removals intentional, owned by the fusion move):
      ```diff
      core:
      - NEUTRAL_IMPORTANCE = 1
      + NEUTRAL_IMPORTANCE = 0.5
      + fuseRankings(lists, { k }?): readonly FusedCandidate[]
      + withTailContext(draft, blocks): ContextDraft
      rag:
      - fuseReciprocalRank(vectorHits, lexicalHits, rrfK)
      - FusedCandidate / RetrievalLeg re-exports from ./fusion.js
      ```
      The record/scoring/Memory interfaces also gain `lastAccessedAt`, `recencyBasis`, and `touch`; the baseline format does not expand interface fields. Root pack ceilings increased only for the required CHANGELOG entry (**+111 packed / +262 unpacked bytes**); the reason is recorded in `scripts/budgets.json`. No kernel source, export, file, or dependency growth.
    - Retirement sweep over `src/ packages/ apps/ scripts/ examples/ docs/`, excluding dist/history/evidence and archived compatibility snapshots: no executable use of `fuseReciprocalRank` or `fuseReciprocalRankLists` remains. The core README intentionally names the removed export to explain its replacement. No new dependency, version bump, or publish.

- [x] Task 10: Fabric consolidation — no silent supersession
  - Acceptance Criteria:
    - Functional:
      - `planMemoryConsolidation` (`fabric/src/consolidate.ts:44-58`) never returns `supersede` from similarity alone. The plan becomes:
        - `update` (same normalized text)
        - `insert` with a `similar` link to the candidate (similar subject, different text)
        - `insert`
      - Retirement (`validTo`) happens only through:
        - an explicit `supersedes` (agent or OM observer)
        - `correct()`
        - the opt-in decider
      - **Opt-in model decider:** `consolidate: { decider: "model", model?: "<provider/model>" }`.
        - For each write with candidates ≥ threshold, one model call with the new note and the top 5 candidates returns `ADD | UPDATE <id> | SUPERSEDE <id> | NOOP` through a schema-declared tool (Mem0's operation set).
        - A malformed or failed decision falls back to `insert` with a `similar` link, and records `status.note` once per session.
        - The fabric statically declares the `models` capability for this optional path (package capabilities are definition-level); the client is resolved lazily only for eligible writes, so a host that never enables it pays nothing.
      - `recall` explain rows expose `similar` links so the agent can see near-duplicates.
    - Performance:
      - Default: no model call (as today).
      - Decider: one model call per write that has a ≥ threshold candidate; the README cost table states it.
    - Code Quality:
      - The threshold stays configurable.
      - The `ponytail` note at `consolidate.ts:7` is replaced by the decided behavior.
      - No alias for the removed `supersede` action from similarity. Same-path file refresh remains an update, preserving Task 8’s file identity behavior.
    - Security:
      - Decider input is redacted (`redactJson`) and bounded by worker limits.
      - The decider's output can only reference candidate ids it was shown (others are ignored).
  - Approach:
    - Documentation Reviewed:
      - `fabric/src/{consolidate.ts,create.ts:243-340}`
      - Mem0 (Chhikara et al., 2025): LLM-decided ADD/UPDATE/DELETE/NOOP over the top-s similar memories
      - Zep/Graphiti: LLM-based edge invalidation on contradiction
      - LongMemEval: the knowledge-update ability
    - Options Considered:
      - Raise the threshold. Rejected: similarity cannot distinguish "same subject, new value" from "different subject, similar wording" at any threshold, and thresholds are embedder-specific.
      - Make the decider the default. Rejected: it adds a model call per write without a measured gain; Task 14 decides the default from the bench.
    - Chosen Approach:
      - Safe deterministic default (keep both and link them) plus the published decider as opt-in.
    - API Notes and Examples:
      ```ts
      memoryFabric({ consolidate: { threshold: 0.85, decider: "model", model: "hyper/<id>" } });
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{consolidate.ts,create.ts,config.ts,index.ts,links.ts,types.ts}`
      - a new `packages/memory/fabric/src/decider.ts`
      - `fabric/src/{workers.ts,recall.ts,tools.ts}` (validation, explain links, session identity)
      - tests (consolidate and package integration)
      - `scripts/budgets.json` for root CHANGELOG-only tarball growth
      - README
      - `CHANGELOG.md`
      - baseline regeneration
    - References:
      - review finding FAB-4
  - Test Cases to Write:
    - `similar_different_text_inserts_with_similar_link` (Alice/Bob flight fixture; the current data-loss bug).
    - `explicit_supersedes_retires_note`.
    - `decider_supersede_retires_candidate`.
    - `decider_noop_writes_nothing`.
    - `decider_invalid_id_ignored`.
    - `decider_failure_falls_back_to_insert`.
    - `decider_off_makes_no_model_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Consolidation semantics and a new config.
    - Docs pages to create/edit: `packages/memory/fabric/README.md`: Consolidation section and cost table.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - Default consolidation updates normalized-identical same-kind notes; different text inserts with a `similar` link and never retires the candidate. Same-path file refresh remains unchanged. Recall explain rows now expose stored links. Explicit `supersedes` resolves an accessible, distinct fabric row through `Memory.getEntry`, preserves host metadata, and sets `validTo`; explicit correction remains through `correct()`.
    - Added the opt-in model decider: one bounded worker turn, one schema-declared `decide_memory` call, at most five same-kind threshold candidates, and candidate-id validation before any mutation. ADD preserves both notes, UPDATE rewrites the selected candidate, SUPERSEDE retires it, and NOOP returns the nearest existing note without writing. Malformed/missing/multiple/oversized/failed decisions insert with a similar link; aborted writes still abort. Input uses `redactJson` with the direct fabric's supplied redactor/secrets. Direct callers supply `resolveModelClient`; package writes resolve `prism.models.client` lazily and pass tool session identity for once-per-session fallback warnings.
    - Implementation finding: `PackageDefinition.capabilities` is static (`src/packages/define.ts:123`), and `PackageAPI.models.client` requires `models` (`src/packages/api.ts:118`). Declared it solely to authorize the optional decider; no client/provider work occurs with the default. Acceptance wording above now records this existing boundary rather than implying per-config capability declarations. README documents the cost, fallback, direct-call redaction setup, and static declaration. No kernel change or dependency addition.
    - Verification passed: fabric suite **178 pass / 20 skip / 0 fail** (28 files); all workspace `bun run typecheck` checks; release gate baseline regeneration (`updated: true`) and ordinary release gate (`updated: false`), **43 packages**. Skips are the existing Postgres integration cases without a configured database. Regression coverage includes Alice/Bob flights, explicit retirement/host metadata preservation, all four model actions, invalid ids, failed/missing/multiple/oversized responses, input limits/redaction, a nonfirst candidate among the top five, default zero model calls, warning deduplication, and the real package/tool/model integration.
    - Fabric compatibility-baseline delta (no removals):
      ```diff
      +decideConsolidation  export declare function decideConsolidation(input:
      ```
      Existing exported option/explain types also gain the decider settings, lazy client/failure hooks, redactor/secrets, write session id, and explain links; the baseline format does not expand interface fields. The old similarity-driven `supersede` member is removed from `MemoryConsolidationPlan`; explicit/model retirement stays internal to the write path. Targeted graft sweep found no stale similarity-retirement or threshold-shortcut wording (only the valid linker exclusion comment).
    - Root tarball ceilings grew only for the required CHANGELOG entry: **+114 packed / +259 unpacked bytes**, now **1,071,085 / 3,503,289**, attributed in `scripts/budgets.json`. Kernel source, exports, dependencies, and file count are unchanged. Live decider accuracy/cost ablations remain Task 14; no paid model or benchmark run was needed for Task 10.

- [x] Task 11: Fabric recall — one path, selective injection, hybrid ranking, a floor, and tail placement
  - Acceptance Criteria:
    - Functional:
      - **One recall path.** The `context.build` block (`fabric/src/memory.ts:539`, wired at `index.ts:157`) recalls through the fabric recall (or the scoped policy when configured), not the core `memory.recall`. Passive injection therefore applies:
        - kinds (`fact`, `file` by default; never `procedure` unless configured)
        - the `asOf` validity filter (superseded notes are no longer injected)
        - consent
      - **Off by default.** Config `inject: false | { minSimilarity, topK = 3, budgetTokens = 600, query = "task" }`, default `false`. With `inject: false` the fabric makes no embedding call per turn; recall happens through `memory.recall` when the agent asks (just-in-time retrieval), guided by the Task 12 directory. Task 14 may change the default only with a paired benchmark gain; the README records the decision and its numbers.
      - **Floor and abstention.**
        - `minSimilarity` applies to each hit's **vector cosine before fusion**. RRF scores depend only on rank (≈ 1/(k+rank)), so a floor on the fused score would mean nothing.
        - A hit found only by the lexical query passes when it matches at least one query token that is not a stopword.
        - When no hit passes, no semantic block is injected, and nothing says "no memory". The working-memory block is unaffected.
        - The default `minSimilarity` comes per embedder from Task 14's calibration (the cosine at which the judge's `used` rate falls below 50% on the bench). A provisional `0.35` ships until then, with a README note. A host using an embedder that is not calibrated gets a one-time `status.note("info", …)` naming the provisional floor.
      - **Query from the task state** (`query: "task"`; `"user"` keeps the latest user text). The query joins, each bounded:
        - the latest user message
        - the OM task state when the fabric's `observational` source has one (Task 4, read through `session.entries()`, Task 1 (j))
        - the latest `todo_write` plan text in `draft.messages` (Task 1 (j))
        
        Time-aware expansion (LongMemEval): when the user message names a date or a relative period ("last week", "in March"), the period is resolved against the message time and passed to recall as an `asOf`/`tRef` window filter, not as query text.
      - **Once per user turn.** The semantic block is computed on the first model call of a user turn and reused byte-identical on that turn's later tool rounds (Task 1 (k)). Within a turn the tail does not change, and there is one recall per user turn, not one per model call. Cache even empty results by `context.session.id` plus the latest persisted user-entry id from `session.entries()`; `context.runId` is empty on current draft dispatch. A new user entry/steer changes the key. Extract `metadata.todos` before engineering can fold/drop the result, or use the persisted plan as fallback.
      - **No duplicates across sources.** Before rendering, drop a hit when:
        - its id is in the OM block's `itemIds`, or its `sourceEntryIds` are all still present verbatim in `draft.messages`
        - it is a `file` note whose path appears in a `read` tool result still visible in `draft.messages`
        
        Dropped duplicates do not count against `topK`; the next hit above the floor takes the slot.
      - **Citation and use.** The block header says `Cite the ids you use as [id].` On `turn.completed`, cited ids that were injected this turn are passed to `Memory.touch` (Task 9). `memory.recall` tool hits are touched when returned. The tool result marks each hit with its kind, date, and score components, and says `no confident match` when no hit passes the floor (an explicit abstention cue; Joren et al. 2025 find strong models answer instead of abstaining when context is insufficient).
      - **Render.** Each injected line is `- [id] (kind, YYYY-MM-DD) content`. `tRef` is shown when set.
      - **Tail placement.** The semantic block uses `withTailContext` (Task 9) with `metadata.contextBlocks` (`source: "fabric-semantic"`, `itemIds`), so a per-turn change never touches the cached prefix. The working-memory block stays in the prefix (it changes only on writes) and carries `metadata: { source: "fabric-working" }`.
      - **Hybrid ranking.** Fabric recall runs the vector query and the store's lexical query (in-memory `tokenizeLexical`, SQLite FTS5, Postgres full-text if Task 1 finds it present, otherwise vector-only with the README saying so), fused by `fuseRankings`, before recency/importance re-ranking.
      - **Fact-augmented keys.** The embedded text for a note is `content` plus `keywords`, `tags`, and `context`. The stored content is unchanged.
      - **Link expansion beyond the batch.** `Memory` gains `get(ids)` (vector store `getByIds`, all three stores). One-hop expansion fetches linked notes outside the candidate batch, bounded by `topK`. This replaces the batch-only path at `fabric/src/recall.ts` "ponytail".
    - Performance:
      - `inject: false` (default): no embedding call or store query per turn.
      - `inject` on: one embedding call and one recall per user turn (not per model call); lexical adds one store query per recall; link expansion adds at most one `get` per recall.
      - Dedup is O(hits × visible messages) over ids already in memory; no store read.
      - With tail placement, a turn's provider request differs from the previous one only after the previous turn's tail.
      - No added model call.
    - Code Quality:
      - The old `contextBlocks` core-recall path is deleted, not kept as an option.
      - `formatRecall` is replaced.
      - `Memory.get` is added to the core contract with all three stores implementing it; baselines (core, fabric) are regenerated in this task.
    - Security:
      - Invalidation, consent, and share-grant filters run on expanded links too (asserted).
      - Rendered text is redacted as today.
  - Approach:
    - Documentation Reviewed:
      - `fabric/src/{memory.ts:208-290,539-660,recall.ts,search.ts}`, `core/src/vector-memory.ts`
      - Zep (hybrid cosine + BM25 + graph search with reranking; ablations)
      - LongMemEval (fact-augmented key expansion improves recall; abstention is scored)
      - HippoRAG (Gutiérrez et al., NeurIPS 2024: multi-hop needs graph traversal)
      - Shi et al., ICML 2023 (irrelevant context distracts)
      - Mallen et al., ACL 2023 (retrieval can hurt when not needed)
      - Wu et al., 2026 (arXiv 2607.08716, "Remember When It Matters"): selective memory intervention beats always-on injection and plain retrieval (+8.3 pp Terminal-Bench 2.0, +6.8 pp τ²-Bench)
      - Chroma, "Context Rot" (2025): distractors close to the target topic hurt most, which is exactly what a near-miss memory hit is
      - Joren et al., ICLR 2025 ("Sufficient Context"): models rarely abstain on insufficient context
      - Anthropic, "Effective context engineering for AI agents" (2025): just-in-time retrieval through tools, a lightweight index up front
    - Options Considered:
      - Keep passive injection and only add a floor. Rejected: it still injects superseded notes and breaks the cache every turn.
      - Remove passive semantic injection entirely (tool-only recall). Rejected: Task 14 must be able to measure it, and some hosts (chat assistants without tool use) need it. It stays as an opt-in.
      - Passive injection on by default with a floor. Rejected: the floor depends on the embedder and is not calibrated yet, and the evidence above favors selective injection; a default that adds distractors is the failure this review targets.
      - A floor on the fused RRF score. Rejected: rank-based, so it does not measure relevance.
      - Recall on every model call. Rejected: tool rounds within a turn share the question, and a changing tail within a turn re-bills tokens for nothing.
      - A cross-encoder reranker. Deferred to Further Actions: the fabric has no rerank service dependency, and the bench must show RRF is insufficient first.
    - Chosen Approach:
      - One recall path with the published retrieval improvements that need no model call.
    - API Notes and Examples:
      ```ts
      memoryFabric({ tools: { root: "./memory" } });                                           // default: inject off, directory on
      memoryFabric({ tools: { root: "./memory" }, inject: { minSimilarity: 0.35, topK: 3 } });  // opt-in passive recall
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{memory.ts,recall.ts,context.ts,provider.ts,create.ts,index.ts,config.ts,types.ts,tools.ts,conformance.ts,scoped/read-policy.ts}`
      - `packages/memory/core/src/{types.ts,vector-memory.ts,postgres/index.ts,sqlite/index.ts}`
      - tests (recall, memory, postgres-vector integration, sqlite)
      - READMEs (fabric, core)
      - `CHANGELOG.md`
      - baselines (core, fabric)
      - `scripts/memory-bench/{injection-log.mjs,run.test.mjs}` (tail metadata accounting and offline OM fixture alignment)
      - `scripts/budgets.json` (required root CHANGELOG-only tarball growth)
    - References:
      - review findings FAB-5, FAB-6, FAB-9; context-rot review 2026-10-17 (default off, pre-fusion floor, task query, once per turn, dedup, citation)
  - Test Cases to Write:
    - `passive_injection_excludes_superseded_note`.
    - `passive_injection_excludes_procedure_by_default`.
    - `passive_injection_abstains_below_floor`: the floor uses pre-fusion cosine (a fixture where the RRF score is high but the cosine is below the floor injects nothing).
    - `inject_off_by_default_makes_no_embedding_call`.
    - `lexical_only_hit_needs_non_stopword_match`.
    - `task_query_includes_om_task_state_and_plan`.
    - `relative_date_becomes_validity_window`: "what did we decide last week" on 2026-10-17 filters 2026-10-05..2026-10-11.
    - `semantic_block_computed_once_per_user_turn`: two tool rounds, one recall, identical tail bytes; empty hits are cached too.
    - `recall_cache_changes_on_new_user_entry_with_empty_context_run_id`: includes a steer and a compacted user entry.
    - `task_query_survives_engineering_fold_of_plan_result`.
    - `hit_already_in_om_block_is_dropped`, `hit_with_visible_source_entries_is_dropped`, `file_note_for_visible_read_is_dropped`.
    - `cited_injected_ids_are_touched_uncited_are_not`.
    - `recall_tool_says_no_confident_match_below_floor`.
    - `passive_block_rendered_at_tail_prefix_unchanged`.
    - `hybrid_recall_finds_exact_identifier_vector_misses`.
    - `embedding_text_includes_keywords_tags_context`.
    - `link_expansion_fetches_outside_batch`.
    - `expanded_link_respects_invalidation_and_consent`.
    - `memory_get_conformance_all_stores`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Injection behavior, config, a new `Memory.get`.
    - Docs pages to create/edit: `packages/memory/fabric/README.md` (Recall; Injection: off by default and why, floor semantics and calibration, task query, once per turn, dedup, citation; caching note; cost per mode), `packages/memory/core/README.md` (contracts).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - **One recall path, default off.** Package injection, direct fabric registration, and the legacy `Memory.contextBlocks`/registration seam now use the fabric recall projection (or configured scoped policy). The old core-recall injection body and `formatRecall` are deleted. `inject` defaults to false; opting in defaults to a provisional 0.35 cosine floor, three hits, 600 rendered tokens, and a task query. `inject.kinds` permits explicit procedure inclusion. Working memory stays in a `fabric-working` prefix block; semantic memory uses `withTailContext` and `fabric-semantic` accounting metadata. The package warns once with the uncalibrated embedder id and selected floor.
    - **Retrieval and lookup.** Core recall's opt-in hybrid leg uses the existing in-memory lexical query, SQLite FTS5/BM25, and Postgres full-text. `fuseRankings` now exposes its RRF score separately from the original hit, and optional recency/importance re-ranking follows fusion. The cosine floor runs before fusion; lexical-only hits need a non-stopword token and never report an RRF score as cosine, including with composite scoring. Fabric recall defaults to this path and the provisional floor; consolidation retains its vector-only candidate path. Augmented keys include content/keywords/tags/context on writes, corrections, and rebuilds without changing stored content. `Memory.get` batches exact-scope ids through all three stores, bounds/deduplicates inputs, redacts, and checks invalidation/hold/consent. One-hop link expansion uses at most one lookup, reaches outside the candidate batch, and rechecks kinds, validity, and reference-time bounds; it never widens a parent share grant or reads another thread.
    - **Task state and prompt lifetime.** A single branch read supplies the persisted user-entry id, OM task state, and persisted todo fallback. Each query source is bounded to 2,000 characters. ISO dates, last week (UTC Monday–Sunday), and named months resolve from the user-entry timestamp into `asOf` and a half-open `tRef` interval; notes without `tRef` use ingestion time. Cache identity uses session id plus persisted user-entry id, including empty results, so empty hook run ids, tool rounds, steers, and compacted provider history behave correctly. No persisted user identity means no passive injection. Render-time dedup uses OM item ids, verbatim source contents, and visible read results/calls, then refills the requested slots within the bounded candidate window.
    - **Hook-order findings.** Fabric runs at priority **-1100**, after OM and engineering (-1000); todo extraction falls back to persisted metadata if engineering folded the plan. Integration coverage runs real fold/budget stages and checks identical tail bytes across rounds. `turn.completed` precedes persistence of the assistant output, so citation ids are accumulated from streamed text (including split citations) and touched through tracked background work at completion. Declared the existing `background` capability for this operation; default-off injection schedules none of this work. Recall-tool hits are touched when returned and empty results say `no confident match`. Passive scoped recall passes `recordUse: false`, so viewing an injected hit does not increase the scoped promotion ledger's reuse count.
    - **Benchmark follow-through.** The injection logger now reads `metadata.contextBlocks`, preserving tail placement, item ids, and token totals. Added a tail-accounting fixture. The earlier offline OM smoke assertion expected always-on injection, which Task 5 retired: its small un-compacted history correctly yields no duplicate injection. Updated that assertion rather than reintroducing redundant context. No live dataset or paid model evaluation was run; per-embedder calibration and default decisions remain Task 14.
    - **Verification passed:** `bun run typecheck` (kernel, workspaces, examples), followed by final fabric typechecks after the focused ranking/policy corrections; core **20 pass / 0 fail**, fabric **192 pass / 20 skip / 0 fail**, OM **96 pass / 0 fail**, RAG **100 pass / 4 skip / 0 fail**, benchmark tests **20 pass / 0 fail**, docs **64 pass / 0 fail**. Offline benchmark completed all **14** synthetic questions. The observational-memory and working-semantic-memory examples passed. The whole-plan verification named the removed `examples/long-term-memory.ts`; corrected it to the existing `examples/working-semantic-memory.ts`. Postgres integration and live-source skips remain environment-gated; the shared lookup conformance is wired into in-memory, SQLite, and Postgres suites, with the first two exercised locally. Release baseline regeneration (`updated: true`) and ordinary gate (`updated: false`) both passed for **43 packages**.
    - **Compatibility baselines regenerated (no symbol removals).** The declaration graph records:
      ```diff
      +createFabricContext  export declare function createFabricContext(memory: Memory, recall: MemoryFabric["recall"], inject?: false | MemoryFabricInjectConfig, semanticAvailable?: () => boolean, options?: MemoryContextProviderOptions)
      +recallPeriod         export declare function recallPeriod(text: string, timestamp: string)
      +type MemoryFabricInjectConfig
      -registerMemoryFabricContext(hooks: HookRegistrar, memory: Memory, options?: MemoryContextProviderOptions)
      +registerMemoryFabricContext(hooks: HookRegistrar, memory: Memory, options?: MemoryContextProviderOptions, recall?: MemoryFabric["recall"], inject?: false | MemoryFabricInjectConfig)
      ```
      The two helpers are module exports in the reachable declaration graph, not new root-barrel functions. Existing interfaces gain `Memory.get`, store `getByIds`, hybrid/floor/retrieval components, reference-time/use-recording options, and injection configuration. The baseline format does not expand interface fields, so memory-core's serialized surface remains unchanged despite regeneration. Repo-wide retirement sweep across `src/ packages/ apps/ scripts/ examples/ docs/` found no `formatRecall`, batch-only expansion, or obsolete id/get-shortcut references outside excluded history/evidence/baselines.
    - **Root tarball budget:** the required CHANGELOG entry adds **158 packed / 354 unpacked bytes**, attributed in `scripts/budgets.json`; ceilings are now **1,071,243 / 3,503,643**. No kernel source, export, dependency, or file-count growth. Task 12's directory and Task 13's candidate lifecycle remain unimplemented as planned; Task 14 still owns calibration. No new dependency, version bump, publish, or paid benchmark.

- [x] Task 12: Fabric memory directory — progressive disclosure for long-term memory
  - Acceptance Criteria:
    - Functional:
      - With passive injection off by default (Task 11), the agent needs to know what long-term memory holds before it can decide to recall. The fabric renders one `memory-directory` context block. It sits in the prefix next to the working-memory block, with `metadata: { source: "fabric-directory" }`:
        ```text
        # Long-term memory
        12 facts, 3 procedures, 7 files. Recall with memory.recall; read files with memory.read.
        Topics: deploy (5), billing (3), auth (2), onboarding (2)
        Files: notes/deploy.md, notes/billing.md, … (+2)
        Blocks: profile, project
        ```
      - Contents:
        - counts of active notes by kind, after the `asOf` validity, consent, and Task 13 candidate filters, so the counts match what recall can return
        - the top `directory.maxTopics` (default 8) tags/keywords by active-note count
        - up to `directory.maxFiles` (default 10) file paths under `tools.root`, most recently updated first, then `(+N)`
        - working-block labels
        - no note content
      - **Cache stability:**
        - The block is recomputed only after a write that changes it: `remember`, `correct`, `forget`, retention, file edits, a promotion pass, or a reconcile.
        - It is cached per scope in memory and keyed by a version counter the write path bumps.
        - A turn with no write sends identical bytes, and the text is deterministic (stable sort, no timestamps).
      - Config `directory: true | false | { maxTopics, maxFiles, maxTokens = 200 }`, default `true` when semantic memory or `tools.root` is available. The block is dropped silently when the fabric holds nothing.
      - `memory.view` with no path returns the same directory plus the full topic and file lists, paged by `offset`. This is the second disclosure level; `memory.recall`/`memory.read` are the third.
      - The OM block needs no separate directory: replace-on-reflect (Task 3) already keeps reflections as the gist level and `recall` as the lookup.
    - Performance:
      - No model or embedding call.
      - Recomputation runs one aggregate query per write batch (`countByKind`, `topTags` on all three stores; SQLite and Postgres via `GROUP BY`, in-memory by scan), debounced to once per turn.
      - The block is at most `maxTokens` (hard cap 500) tokens. The README states both.
    - Code Quality:
      - Aggregates are added to the `VectorStore` contract (`countByKind`, `topTags`) with all three stores and the memory conformance suite covering them.
      - The rendering lives in `fabric/src/directory.ts`.
      - No speculative per-topic summaries (a RAPTOR-style tree) — Further Actions if Task 14 shows recall misses that a topic gist would fix.
    - Security:
      - The directory lists only what the session's scope, consent, and share grants allow (asserted with a revoked note and an unshared scope).
      - Tags and paths are redacted like other rendered text.
      - File paths are relative to `tools.root`.
  - Approach:
    - Documentation Reviewed:
      - `fabric/src/{memory.ts,blocks.ts,files.ts,tools.ts,index.ts}`, `core/src/{types.ts,vector-memory.ts,postgres/index.ts}`, Task 6's SQLite store
      - MemGPT (Packer et al., 2023): core memory is always in context and carries counts of recall/archival memory, which the agent pages in by tool
      - ReadAgent (Lee et al., ICML 2024): gist memory up front and look up the original on demand
      - RAPTOR (Sarthi et al., ICLR 2024): hierarchical summaries for coarse-to-fine retrieval
      - Anthropic memory tool docs: the agent views the memory directory before reading files
      - Manus, "Context Engineering for AI Agents" (2025): keep the prefix stable and append-only; use the file system as externalized memory
    - Options Considered:
      - No directory; rely on the tool descriptions. Rejected: the agent cannot tell an empty memory from a full one, so it either never recalls or recalls every turn.
      - A directory recomputed every turn. Rejected: it would change prefix bytes whenever a recency-ordered list shifts; write-driven recomputation keeps the cache.
      - Put the directory at the tail. Rejected: it changes only on writes, so the prefix is the cheaper home (cached), like the working-memory block.
    - Chosen Approach:
      - A small, write-versioned index in the prefix, with deeper levels through the existing tools.
    - API Notes and Examples:
      ```ts
      memoryFabric({ tools: { root: "./memory" }, directory: { maxTopics: 6 } });
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{directory.ts (new),index.ts,memory.ts,tools.ts,config.ts,types.ts,conformance.ts}`
      - `packages/memory/core/src/{types.ts,vector-memory.ts,postgres/index.ts,sqlite/index.ts}`
      - tests: `fabric/src/__tests__/directory.test.ts` (new), conformance, tools
      - READMEs (fabric: Directory section and cost; core: store contract)
      - `CHANGELOG.md`
      - baselines (core, fabric) via `bun scripts/release.mjs gate --update-baseline`; the diff goes in the note
    - References:
      - context-rot review 2026-10-17 (progressive disclosure); Task 11 (injection off by default); Task 13 (candidate filter)
  - Test Cases to Write:
    - `directory_counts_match_recallable_notes`: a superseded, a revoked, and a candidate note are not counted.
    - `directory_bytes_stable_without_writes`: ten turns, identical bytes (breaks if it is recomputed per turn or has timestamps).
    - `directory_updates_after_remember_and_forget`.
    - `directory_respects_scope_and_share_grants`.
    - `directory_capped_at_max_tokens`.
    - `memory_view_without_path_pages_full_directory`.
    - `store_conformance_count_by_kind_and_top_tags` (all three stores).
    - `directory_off_renders_nothing`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new context block, config key, `memory.view` behavior, store contract members.
    - Docs pages to create/edit: `packages/memory/fabric/README.md` (Directory, the three disclosure levels, cost), `packages/memory/core/README.md` (store contract).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - **Store contract.** `VectorStore` gains optional `countByKind(scope, { asOf?, signal? })` and `topTags(scope, { asOf?, limit?, signal? })`; `Memory` gains the matching methods (a store without them makes the `Memory` method throw `MemoryScopeError`, and the directory then omits counts). One predicate defines "active": a `metadata.fabric.kind`, inside `validFrom`/`validTo` at `asOf`, `consent.visible !== false`, not invalidated (same lineage rule as `recordBlocked`), not `metadata.status: "candidate"`. The in-memory store scans through `core/src/directory.ts`; SQLite uses `json_extract`/`json_each` with `julianday()` (NULL for a malformed timestamp, so the row is excluded); Postgres uses `jsonb` plus the existing `invalidationPredicate`. `topTags` unions `tags` and `keywords`, counts once per note, orders count desc then tag ascending, limit default 20, hard cap 500. The shared memory conformance suite asserts the same fixture on every store (superseded/expired, future, candidate, revoked, forgotten, plain, other-thread rows, a past `asOf`, invalid `asOf`/`limit`).
    - **Directory.** `fabric/src/directory.ts` holds the snapshot, cache, renderer, and pager. A snapshot is `{ counts, topics (≤200), files, filesTruncated, blocks }`, cached per memory instance under a write counter that `fabric/src/memory.ts` bumps after every content write (`remember`/indexing, `updateWorking`, `deleteWorking`, `setConsent`, `correct`, `forget`, a retention sweep that deleted rows). The startup reconcile writes through the store directly, so the package calls `directory.invalidate()` when it finishes. Files come from a bounded walk of `tools.root` (1,000 files, six levels, hidden files and the SQLite store skipped, most recently modified first, relative paths). The block is `Long-term memory` with `metadata.source: "fabric-directory"` and `tokens`, in the prefix after the working block in one `withContextBlocks` call. It shrinks files then topics to fit `maxTokens` (default 200, hard cap 500; topics ≤50, files ≤100), and is dropped when empty or when the aggregate query fails (an abort still propagates). Config `directory: true | false | { maxTopics, maxFiles, maxTokens }` defaults on when `semantic` or `tools.root` is set; the schema and the resolver both enforce the caps. `memory.view` with no `path` returns the summary plus the full topic and file lists, 50 per page by `offset`; with `directory` off (or no directory wired) it keeps listing the root.
    - **Findings.**
      - The index is per own scope: a share grant widens recall, not the index (asserted).
      - Cache by version means a `validTo` that passes between writes stays counted until the next write, and writes from another process show after a restart. A host-supplied `Memory` not built by `createMemory` must call `directory.invalidate()` itself. All three limits are in the fabric README.
      - Task 13 only has to set `metadata.status: "candidate"` and call the same write path; the candidate exclusion is already in all three stores, so its directory assertion needs a fixture, not new code.
      - `createMemoryFabric` (library use) does not build a directory; only the package wires it, so `fabric.tools()` keeps the old path-less `memory.view` there.
    - **Verification passed:** `bun run typecheck` (kernel, workspaces, examples); core **20 pass / 0 fail** (SQLite runs the shared conformance including the new aggregates); fabric **201 pass / 20 skip / 0 fail** (new `directory.test.ts` has eight tests: seven of the listed ones plus a files/redaction/paging test, and the listed `store_conformance_count_by_kind_and_top_tags` lives in the shared conformance suite; one package test checks the block enters the prefix after a write and that the next two turns are byte-identical without listing the store file); OM **96**, RAG **100 pass / 4 skip**, engineering **78**, docs **64**, all 0 fail. `examples/working-semantic-memory.ts` runs. Baseline regeneration (`updated: true`) and ordinary gate (`updated: false`) both pass for **43 packages**.
    - **Not verified locally:** the Postgres aggregates. The conformance is wired into the Postgres integration suite, but pgvector is unavailable here (the local Postgres has no `vector` extension and Docker could not fork a new container: "Resource temporarily unavailable"), so those tests skipped. I reviewed the SQL by hand; run `integration-postgres` before the release cut.
    - **Compatibility baselines regenerated (no symbol removals).** Additions only: memory-core gains `HARD_DIRECTORY_TAGS`, `activeDirectoryNote`, `rankDirectoryTags`, `resolveDirectoryAsOf`, `resolveDirectoryLimit`, `scanDirectory` (and the `MemoryDirectoryQuery`, `MemoryTopTagsQuery`, `MemoryTagCount` types, from the `export *` barrel); memory-fabric gains `createFabricDirectory`, `renderFabricDirectory`, `DEFAULT_DIRECTORY_OPTIONS`, `HARD_DIRECTORY_FILES/TOKENS/TOPICS`, the directory types, and the reachable-graph helpers `noteMemoryWrite`, `pageFabricDirectory`, `isFabricDirectoryEmpty`, `resolveFabricDirectoryOptions`; `createFabricContext` takes a trailing optional `directory` handle. The baseline format does not expand interface members, so `Memory.countByKind`/`topTags` and the `VectorStore` members do not show.
    - **Root tarball budget:** the CHANGELOG entry adds **202 packed / 508 unpacked bytes**, attributed in `scripts/budgets.json`; ceilings are now **1,071,445 / 3,504,151**. No kernel source, export, dependency, or file-count growth. No new dependency, version bump, publish, or paid benchmark.

- [x] Task 13: OM → fabric background promotion
  - Acceptance Criteria:
    - Functional:
      - Fabric config `promote: { observational: true, verifyAfterUses?: 2, archiveAfterDays?: 30 }` (`observational` defaults to `false`).
      - The package passes the session as the `observational` source (`fabric/src/types.ts` `MemoryFabricObservationSource`) and, on `turn.completed`, starts `session.background("fabric.promote", …)` when the OM ledger has reflections newer than the session's promotion cursor (`prism.state.session`).
      - Each new reflection:
        - passes the trust scan, or is skipped and counted
        - is written as a `fact` note with `promotedFrom: { reflectionId }` and `sourceEntryIds` from its evidence, through the Task 10 consolidation path
        - is written with top-level vector `metadata.status: "candidate"`, validated and exposed on note/hit results; rewrites and corrections preserve status. Existing plain notes without status remain verified; scoped missing status remains candidate (Task 1 (i)). Share status normalization with an explicit fallback and the candidate age predicate via `fabric/src/lifecycle.ts`.
      - The cursor advances only after a successful write.
      - **Candidates are never injected passively.** Task 11's passive path and the Task 12 directory counts exclude `status: "candidate"`. `memory.recall` returns candidates marked `(candidate)` after verified hits of equal score.
      - **A candidate becomes `verified` when:**
        - it is cited or tool-recalled in `promote.verifyAfterUses` (default 2) distinct turns (Task 9's use signal), or
        - the agent writes it again through `memory.insert` with `kind`, or confirms it with `memory.replace`, or
        - a host calls `fabric.verify(id)`
      - **Retirement.**
        - A candidate superseded by a later explicit `supersedes`, a `correct()`, or the decider is retired like any note.
        - A candidate unused for `promote.archiveAfterDays` (default 30) is archived (`validTo` set, reason `unused-candidate`) by the next promotion pass, reusing the candidate age predicate extracted from `runScopedGcPass` (`scoped/lifecycle.ts:112`), not calling that file-ledger proposal pass directly (it returns `archived: 0`).
        - Archived candidates are not recalled. `memory:status` counts candidates, verified, archived, and refused.
      - The stale `om.scope.bound` requirement in the docs (`fabric/src/types.ts:91`; code at `create.ts:166-178` does not enforce it) is corrected to what the code does.
      - New example `examples/long-term-memory.ts` (mock provider, temp dir):
        - session one with OM and fabric
        - reflections promoted
        - a second process recalls the fact from SQLite
    - Performance:
      - One embedding per promoted reflection, plus one decider call when the decider is enabled.
      - Verification is a metadata update on use (no extra call); archiving runs inside the promotion pass.
      - No work when no new reflections exist.
      - The README states both.
    - Code Quality:
      - Fabric reads the OM ledger only through `session.entries()` (no import of OM internals beyond the exported fold).
      - A failed pass fails only its background task (`background.failed`).
    - Security:
      - Reflections derived from tool output are untrusted. The trust scan plus consolidation is the gate, and refusals are counted in `memory:status`.
      - Promotion is scoped to the fabric's configured `MemoryScope`.
  - Approach:
    - Documentation Reviewed:
      - `fabric/src/{create.ts:160-180,types.ts:85-95}`, `observational/src/ledger.ts`
      - Letta sleep-time compute (Lin et al., 2025, arXiv 2504.13171)
      - Mem0 and Zep (automatic extraction into long-term memory)
      - CoALA (Sumers et al., TMLR 2024: episodic → semantic consolidation)
      - Xiong et al., ACL 2026 (arXiv 2505.16067): agents follow retrieved past experience, so stored errors propagate. Selective addition plus deletion gave about +10% absolute; later use is a free quality label.
    - Options Considered:
      - Run promotion at session end. Rejected: no session-end hook, and long sessions would never promote.
      - Promote observations instead of reflections. Rejected: observations are raw and numerous; reflections are the condensed, evidence-backed form.
      - Promote straight to verified facts. Rejected: a wrong reflection would then be injected into every later session (error propagation); candidates must earn use first.
    - Chosen Approach:
      - Opt-in background promotion of reflections through the same safe write path the agent uses.
    - API Notes and Examples:
      ```ts
      packages: [memoryObservational(), memoryRag({ embeddings }), memoryFabric({ tools: { root: "./memory" }, promote: { observational: true } })]
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{index.ts,config.ts,types.ts}`
      - new `packages/memory/fabric/src/{promote.ts,lifecycle.ts}`; `src/scoped/{lifecycle.ts,mirror.ts}` consume the shared normalization/age rule
      - tests (a new promote test, observational-source)
      - `examples/long-term-memory.ts`: new
      - `examples/README.md` line and `scripts/e2e-coverage.json` entry (probe 11)
      - READMEs (fabric, observational "Related packages")
      - `CHANGELOG.md`
      - baseline regeneration
    - References:
      - review finding FAB-8
  - Test Cases to Write:
    - `promote_writes_new_reflections_as_facts`.
    - `promote_cursor_advances_only_on_success`.
    - `promote_skips_injection_flagged_reflection`.
    - `promote_off_does_nothing`.
    - `promote_failure_is_background_failed_only`.
    - `promoted_fact_is_candidate_and_not_passively_injected`.
    - `candidate_verified_after_uses_in_distinct_turns`.
    - `candidate_verified_by_agent_insert_or_replace`.
    - `unused_candidate_archived_after_days`.
    - `archived_candidate_not_recalled`.
    - `plain_legacy_note_is_verified_scoped_missing_status_is_candidate`.
    - `candidate_status_survives_rewrite_and_correction`.
    - `plain_and_scoped_gc_share_candidate_age_rule`.
    - Example gate: `examples_demos_run_to_completion_and_emit_no_secret` covers `long-term-memory.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New config, a background task, a new example.
    - Docs pages to create/edit: `packages/memory/fabric/README.md` (Promotion, candidate lifecycle, `promote.verifyAfterUses`/`archiveAfterDays`, cost), `examples/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-19):
    - **Lifecycle.** `fabric/src/lifecycle.ts` holds `normalizeNoteStatus(status, fallback)` and `isStaleCandidate(lastActivity, now, days)`. `scoped/{lifecycle,mirror}.ts` now call them (scoped fallback `candidate`; plain fallback `verified`), so the two GC paths share the age rule; `runScopedGcPass` still only proposes. `metadata.status` is a validated top-level vector field (a malformed value makes `parseMemoryNoteMetadata` return `undefined`, so the row is never injected), is exposed as `status` on note/hit results, and is preserved by rewrites, supersession, evolution patches, and `correct()` because every writer already spreads the host metadata. `encodeMemoryNoteMetadata` keeps it out of the `fabric` key.
    - **Write path.** `MemoryFabricWriteOptions.status: "candidate"` is the only way to write a candidate (the agent tools cannot). On a consolidation update, a verified note stays verified (a promotion never demotes), a candidate stays a candidate for a promotion write, and any non-promotion write (agent `memory.insert` with `kind`) makes it `verified`. `rememberReflection` now also carries the reflection's evidence (`sourceEntryIds` from its supporting observations that still resolve).
    - **Metadata-only updates.** Added `Memory.patchMetadata(id, mutate, { signal })` (core interface; implemented in `fabric/src/memory.ts`, bumps the directory write counter). Use counting, verification, and archiving go through it, so none of them re-embeds. Note the `Memory` interface gained a required member; no other implementer exists in the tree (typecheck clean).
    - **Promotion.** `fabric/src/promote.ts`: `runFabricPromotion` (new reflections → trust scan → `fabric.remember({ kind: "fact", reflectionId }, { status: "candidate" })` → cursor save per reflection → `archiveStale`), `createFabricLifecycle` (`verify`, `recordUse`, `archiveStale`, `census`), config resolution (`promote.{observational,verifyAfterUses,archiveAfterDays}`, caps 100 / 3,650). The package keeps a per-session `fabric.promote` state `{ done[≤1000 ids], refused }` as the cursor; reflections carry no timestamp, so "newer than the cursor" is "id not in `done`". `index.ts` registers `turn.completed` to precheck the ledger and only then calls `session.background("fabric.promote", …)` with a fabric bound to that session (`observational: { session }`); a failed write rejects only that background task. `memory:status` command reports candidate / verified / archived and the session's refused count.
    - **Candidate behavior.** Passive injection skips `status: "candidate"` hits (`context.ts`); the directory and stores already excluded them (Task 12). `memory.recall` labels them `(candidate)`, and `createFabricRecall` puts verified before candidate only inside runs of exactly equal score (hybrid RRF scores rarely tie, so ranking is otherwise unchanged). `memory.recall` counts a use per candidate hit per `runId` (a "turn" is a run; `lastUseKey` stops one run counting twice), `memory.replace` on a note id verifies it, `fabric.verify(id)` is the host path. An archived candidate has `validTo` set and `status: "archived"`.
    - **Findings that affect later tasks.**
      - A reflection lands in the background after a turn, so the promoting `turn.completed` is the one after it appears (documented; the example and package test run two turns).
      - There is no separate "reason" field for archival: the reason `unused-candidate` is implied by `status: "archived"` plus `validTo`; no extra column was added.
      - "Cited" candidates: the passive path never injects candidates, so citation never fires for them; only tool recall and explicit confirmation verify. Task 14's `fabric` bench config can now run (`promote.observational: true`); promotion needs two turns per reflection, which the replay harness should allow for.
      - The scoped layer is unchanged apart from the shared helpers; it still keeps its own file ledger.
      - Stale doc fixed: `reflectionId` no longer claims `om.scope.bound` (`types.ts`).
    - **Tests (`fabric/src/__tests__/promote.test.ts`, 15):** the listed names that map one to one are `promoted_fact_is_candidate_and_not_passively_injected`, `candidate_verified_after_uses_in_distinct_turns`, `candidate_status_survives_rewrite_and_correction`, `plain_legacy_note_is_verified_scoped_missing_status_is_candidate`, `plain_and_scoped_gc_share_candidate_age_rule`, `promote_cursor_advances_only_on_success`, `promote_skips_injection_flagged_reflection`, `promote_writes_new_reflections_as_facts`, `promote_off_does_nothing`; combined: `candidate_verified_by_agent_insert_or_replace_or_host` (insert and host paths; the replace tool hook is not exercised by a tool-level test), `unused_candidate_archived_after_days_and_not_recalled`. `promote_failure_is_background_failed_only` is covered at the function level (the pass rejects without advancing the cursor); no test observes the `background.failed` event itself. Extras: equal-score ordering, never-demote, malformed status fails closed, the package hook promotes in the background. `examples/long-term-memory.ts` runs (session one promotes 1 candidate; a second agent recalls it from SQLite); it is listed in `scripts/e2e-coverage.json` and `examples/README.md`.
    - **Verification passed:** `bun run typecheck` (kernel, workspaces, examples); fabric **216 pass / 20 skip / 0 fail**; core **20 pass**; OM **96**; RAG **100 pass / 4 skip**; engineering **78**; `bun scripts/release.mjs gate --update-baseline` (`updated: true`) then ordinary gate (`updated: false`), **43 packages**.
    - **Compatibility baselines regenerated (no symbol removals attributable to this task).** Additions only: memory-fabric gains `createFabricLifecycle`, `runFabricPromotion`, `readPromoteState`, `resolvePromoteConfig`, `memoryFabricPromoteSchema`, `INITIAL_PROMOTE_STATE`, `DEFAULT/HARD_PROMOTE_*`, `isMemoryNoteStatus`, `normalizeNoteStatus`, `isStaleCandidate`, and the `MemoryNoteStatus`, `MemoryFabricPromoteConfig`, `FabricPromotion*`, `FabricNoteCensus` types; `MemoryFabric` gains `verify`/`recordUse`, `MemoryNote` gains `status`/`uses`, `Memory` gains `patchMetadata` (interface members do not show in the baseline format).
    - **Root tarball budget:** the CHANGELOG entry adds **216 packed / 563 unpacked bytes**, attributed in `scripts/budgets.json`; ceilings are now **1,071,661 / 3,504,714**. No kernel source, export, dependency, or file-count growth.
    - **Not done / not verified:** Postgres `patchMetadata` path is the generic `upsert` and was not run against a live pgvector (unavailable locally, as in Task 12). `scripts/e2e-coverage-gate.mjs` fails on a missing `src/__tests__/oauth-device-code.test.ts` in the kernel entry, which this task does not touch (I did not confirm it failed before my change). Biome reports import-order errors across untouched files; none were fixed here. No new dependency, version bump, publish, or paid benchmark.

- [ ] Task 14: Benchmark rerun, ablations, calibration, defaults, and documentation truth
  - Dropped by plan 188.1 (2026-10-19): moved to plan 188.1 Task 10 (retrieval ablation re-cut for markdown + lexical). Re-homed the same day by the 188.1 amendment to plan 188.6 Task 6, which runs it after the memory lifecycle (plans 188.2–188.5) lands. Owner decision 2026-10-19: the fabric moves to OKF markdown files and lexical retrieval before this benchmark runs, so the vector-floor calibration and hybrid-vs-vector ablation below no longer describe the shipped design.
  - Acceptance Criteria:
    - Functional:
      - Task 2's harness is rerun on Hyper and OpenCode Go (one model each, the plan 183 matrix), all four configs. Ablations on LongMemEval-S:
        - OM: render dates on/off
        - OM: replace-on-reflect on/off
        - fabric: hybrid vs vector-only
        - fabric: injection floor on/off
        - fabric: decider on/off
        - OM: `dropper.targetTokens` at 5k / 10k / 20k (block size vs accuracy: length alone hurts, per Du et al. 2025, but short summaries drop useful detail, per ACE's brevity bias, Zhang et al., ICLR 2026)
        - OM: task-state section on/off
        - fabric: `inject` off vs on (with the calibrated floor)
        - fabric: `query: "task"` vs `"user"`
        - fabric: directory on/off with `inject` off (does the agent recall when the directory shows matching topics?)
        - fabric: cross-source dedup on/off
        - MemoryAgentBench conflict resolution for the supersession and decider changes (Tasks 4, 10)
      - **Floor calibration.** For each embedder the release hosts use (the `memoryRag` embedding model the reference host configures, plus the hash embedder used in tests):
        - from the `inject`-on runs' injection log, bin injected hits by pre-fusion cosine and plot the judge's `used` rate per bin
        - `minSimilarity` is the lowest cosine bin whose `used` rate is ≥ 50%
        - the table goes in the evidence file, and `fabric/src/config.ts` maps embedder ids to calibrated floors, with the provisional `0.35` for unknown ones
      - **Verdicts are statistical.**
        - Each ablation runs on `--subset targeted` (30 questions) for the ability it targets, plus the base subset for regressions.
        - A change is kept when the paired McNemar test on its target ability gives p < 0.05 in its favor, or cost (input tokens or worker calls) drops ≥ 10% with no ability's paired test showing a significant loss (p < 0.05).
        - Otherwise it is reverted or made opt-in, with the task reopened and noted.
        - Injection precision (irrelevant-item rate) is reported for every config and is a tie-breaker between configs with no significant accuracy difference: the lower rate wins.
      - Results are appended to `docs/_evidence/memory-bench-0.13.0.md` with the comparability caveat (judge model differs from the papers').
      - Defaults decided by evidence and recorded with the numbers that justify them:
        - `observer.messageTokens` (10k today; Mastra uses 30k)
        - `reflector.observationTokens`
        - `inject.minSimilarity` per embedder (calibration above)
        - `inject` on/off (stays `false` unless `inject` on beats off on paired tests without a significant loss on any ability)
        - `inject.query`
        - `dropper.targetTokens`
        - `directory` on/off
        - `consolidate.decider` default
      - The fabric README describes `linker`/`evolution` as deterministic neighbor linking and keyword propagation, not A-MEM's model-driven evolution (Xu et al., 2025), unless the bench shows they help; if they don't help, they are marked experimental.
    - Performance:
      - OM with its own compaction has a cache-read ratio ≥ the full-context config on the same run.
      - If not, plan 184's investigation order applies before release.
      - **Cost ceiling.**
        - Ablations run on one provider (Hyper) on the targeted 30-question subsets.
        - Only the base config and the chosen defaults run on both providers over the full stratified subsets.
        - At about 115k haystack tokens per LongMemEval question, that is about 35M input tokens for ablations plus about 30M for the final runs.
        - `scripts/memory-bench/README.md` states the 70M total ceiling. The per-run `--max-input-tokens` enforces it, and a crossed ceiling stops with a partial report.
    - Code Quality: Default changes land with their tests updated in the same commit; no dead config keys.
    - Security: Evidence holds ids and scores only.
  - Approach:
    - Documentation Reviewed:
      - Task 2 baseline evidence; LongMemEval, LoCoMo, and MemoryAgentBench protocols
      - Dietterich 1998 (McNemar for paired comparisons)
      - ACE (Zhang et al., ICLR 2026, arXiv 2510.04618): brevity bias and context collapse, the case against assuming smaller memory blocks are better
      - Mastra OM defaults (docs, 2026-10-17: observation 30k, reflection 40k, async buffering at 20% of `messageTokens`)
    - Options Considered:
      - Ship the defaults from the papers without measuring. Rejected: this plan exists to stop untested defaults.
      - Decide by mean-accuracy deltas against 2-repeat noise. Rejected: at 10 questions per ability the standard error is about ±15 pp, so real regressions are invisible; paired tests on targeted subsets are the cheapest way to see them.
    - Chosen Approach:
      - Measure, keep what wins, and record why.
    - API Notes and Examples:
      ```bash
      timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --config om+fabric --provider opencode-go --model <id> --judge opencode-go/<id> --ablate om.dates=off
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench-0.13.0.md`
      - `scripts/memory-bench/run.mjs` (`--ablate` flags), `scripts/memory-bench/calibrate.mjs` (new: the floor-calibration table)
      - `packages/memory/{observational,fabric}/src/config.ts` (defaults)
      - their tests and READMEs
      - `CHANGELOG.md`
    - References:
      - plan 184 (cache measurement), plan 186 (acceptance includes the memory row if green)
  - Test Cases to Write:
    - `config_defaults_match_evidence`: defaults asserted in the package tests, with a comment naming the evidence file.
    - `memory_bench_ablate_flag_toggles_feature` (offline smoke).
    - `memory_bench_calibrate_picks_lowest_bin_at_half_used_rate`: a fixture log gives the known floor.
    - `fabric_uses_calibrated_floor_for_known_embedder_and_notes_provisional_otherwise`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, if defaults change.
    - Docs pages to create/edit: package READMEs (defaults, cost tables, linker/evolution wording), `docs/live-testing.md` (row status).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/rag test`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 120 bun scripts/memory-bench/run.mjs --offline`
- `timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs`
- `timeout 900 bun examples/observational-memory.ts && timeout 900 bun examples/working-semantic-memory.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`

## Compromises Made

- Plan closed at Task 13 (2026-10-19). Task 14's measurement moved to plan 188.1 Task 10, and then to plan 188.6 Task 6; the fabric's store and retrieval defaults are re-cut there (OKF markdown source of truth, lexical retrieval first).

## Further Actions

- Open work continues through the 188.x sub-plans. [188.7 — Memory evaluation remediation and paid acceptance](188.7-Phase-11-Part-O7-Memory-Evaluation-Remediation-And-Paid-Acceptance.md) addresses findings from 188.6's partial campaign and a second review, then requires paid OpenCode Go before/after evaluations at the end of the memory sequence. This parent stays closed at Task 13; incomplete 188.6 criteria stay open.
