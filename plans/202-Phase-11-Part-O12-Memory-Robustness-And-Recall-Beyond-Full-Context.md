# Phase 11 Part O12 — Memory robustness: robust recall, better than full context, on more than one model

## Objectives

- Before 0.13.0 publishes, take the memory system as plan 188.11 leaves it (the `conversational` preset, revision 1) to a state that meets two pre-registered definitions, written in Task 2 before any design work:
  - **robust**: it holds on several model families, several benchmark families, every ability including abstention and preference, repeated runs, cross-family judges, a growing store, weaker tool-callers, and an adversarial safety suite;
  - **better than full context**: superior to whole-history context in accuracy where history fits the window, superior to truncated context and to a single-shot keyword-retrieval baseline where it does not, and cheaper and fast enough with prompt caching counted.
- Fix the failure modes the 188.x evidence and the 2026 literature identify:
  - candidate recall (lexical ceiling);
  - temporal ordering;
  - current-state tracking;
  - noisy passive injection;
  - aggregation and abstention at answer time;
  - dependence on a strong tool-caller;
  - capacity limits against a growing exchange archive;
  - OM's missing evidence;
  - unreliable fact extraction.
- Land every improvement **without host changes**:
  - inside the `conversational` preset contract as a new `presetRevision`;
  - as an optional config field, an optional store method or an additive note field (plan 188.11 Tasks 3–6 rules);
  - or behind a new opt-in preset when it changes what is stored or adds write-path model calls.
- Decide defaults only after the safety gate passes.
- Serve **coding** as well as conversation. Decisions and conventions accepted in past sessions ("use zod, not yup", "feature folders under `src/<feature>/`", "flush before retry") must reach the agent when they apply, stay current when corrected, and never leak across projects (Task 11). Codebase mapping is out of scope: other tools own it.
- Use **decision models** (plans 195–196: `liquid-local/d1-3B`, hosted `d1` / `d1-ultra`, Jev, Laya) for the small yes/no and choice decisions the pipeline makes, where a per-decision bench shows they beat the incumbent at lower cost (Task 12).
- Settle the memory's **structure** from evidence, not fashion. The answer is a combination of views over one verbatim store, not a knowledge graph (see "Structure decision"). The graph option stays measured and conditional (Task 13).

## Expected Outcome

- `scripts/memory-bench` runs a **robustness suite**: LongMemEval-S (development only), LongMemEval-M, LoCoMo, BEAM, StateMemBench (if licensed and available), MemoryAgentBench-CR and the coding longitudinal suite. Each has label-blind, frozen development and held-out partitions, committed before Task 4. One `robustness-criteria.json` carries the definitions, and every later manifest hashes it.
- Every report carries:
  - accuracy under a cross-family judge panel with κ and a human-audited calibration set;
  - cache-adjusted cost;
  - p50/p95 latency per turn;
  - repeat variance and pass^k;
  - a failure-stage table for every suite, not only LongMemEval-S.
- Comparators in every campaign: `full` (whole history, or truncated to the model window when it does not fit), `lexical-topk` (single-shot BM25 top-k over raw turns, no memory product, no tools), `preset-r1` (0.13.0), and the candidate revision.
- A held-out acceptance on at least three answer models across at least two providers (one of them a small model). It gives one verdict per pre-registered criterion. Either 0.13.0 publishes `presetRevision: 2`, or the plan records which criterion failed and 0.13.0 publishes the last passing revision.
- A safety verdict covering poisoning, cross-principal leakage, deletion cascade, false refusal and PII. Only a pass lets plan-end decide whether `conversational` or another memory default turns on.
- OM has measured quality, and its documented role is decided by data.
- A `coding` preset with a `decision` note kind: confirmed decisions with rationale and path scope, delivered as path cues and core lines when they apply, superseded on correction, measured on the 12-persona coding lifecycle suite, MemoryCode and (if licensed) VibeMemBench.
- `decisions: { model }` (opt-in) runs only the decision points that passed their bench in `docs/_evidence/memory-bench/202/decisions/`. Every other point keeps the incumbent path.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 12). **Owner decision 2026-10-24: memory robustness ships in 0.13.0.**

**Placement.** It runs as release step **17b**, after 201 and before 184. Three reasons:

- it reuses plan 198's clustered statistics and paired comparisons;
- it reuses plan 199's judge panels and calibration, and plan 200's dataset splits and injection suite;
- it must land before plan 185 freezes the surface, because it adds tool parameters, note fields and config fields under the rules plan 188.11 wrote.

**Review task included** (Task 1). Later tasks may add optional `VectorStore` methods, tool parameters, note fields and config fields.

- **No embeddings and no new package.** Owner decision 2026-10-24: the memory system is not RAG-based. Recall is the agent searching and reading the verbatim archive with lexical tools. No task adds, uses or measures an embedding model. The existing opt-in `retrieval: "hybrid"` field stays accepted (188.11's compatibility promise), but the preset never uses it and this plan does not develop it.
- **No kernel contract change.** If Task 1 finds one is needed, the plan stops and is re-cut.
- **No version bump or publish here.** Every package ships in plan 187's lockstep 0.13.0 publish, with the preset revision Task 19 settles.
- **Paid work is owner-gated three times:** before the baseline (Task 4), before the development screens of Tasks 5–17 (one shared gate), and before the held-out acceptance (Task 18).

**Release gating** is pre-registered here; the owner may change it before Task 4.

- 0.13.0 does not wait for a passing verdict.
- The plan is complete when every task has run or been closed by the lever rule (Task 4), and Task 18's verdict is recorded.
- One remediation round is allowed. If Task 18 misses, the levers may be revised once on development partitions, then measured once on the second, disjoint held-out partition Task 2 reserves (`heldout-b`).
- A second miss ends the plan. Task 19 ships the last passing revision with claims limited to the criteria that passed.

## Critical review of the current system (2026-10-24, offline)

Sources:

- `docs/_evidence/memory-bench/188.{7,8,9,10}/`;
- `docs/_evidence/memory-bench-0.13.0.md`;
- `docs/_evidence/memory-bench/188.7/findings.json`;
- plan 188.11 (its Task 8 adds the trust-scan rates);
- the source at the cited lines.

Each finding is the reason for one or more tasks.

| # | Finding | Evidence | Task |
| --- | --- | --- | --- |
| R1 | All quality evidence uses one model, `opencode-go/mimo-v2.5`, as both answerer and judge. Self-preference bias in LLM judges is documented (MT-Bench, Zheng et al. 2023; "Justice or Prejudice?", arXiv 2410.02736). Its size on gold-answer QA is smaller but not zero (arXiv 2504.11972). | 188.10 README "Live held-out v3"; `memory-bench-0.13.0.md:21–23` | 3, 18 |
| R2 | "Full-context substitute" rests on +0.07, CI [−0.03, 0.17], against a 3-point margin met **exactly** at the lower bound. Full context scored 79/100 on v2 but 69/100 on v3 with the same model, so the reference itself is draw- and model-sensitive. A strong long-context model may move it a lot. | `acceptance-comparisons.json`; 188.9 and 188.10 tables | 2, 18 |
| R3 | At ~115k tokens, LongMemEval-S fits the window. "Better than full context" means little there except on cost. The regime where memory must win is beyond the window: LongMemEval-M (~500 sessions), BEAM-1M/10M (ICLR 2026: 1M-context models degrade with length). | BEAM, arXiv 2510.27246 | 2, 18 |
| R4 | The held-out pool is spent and the design is fitted to one benchmark. Ten sub-plans tuned against LongMemEval-S. Preference and abstention had no unused ids, so neither was held out. LoCoMo and MemoryAgentBench were never measured for the shipped preset. | 188.8 README (preference/abstention dev-only); 188.10 N7 | 2 |
| R5 | Passive delivery is mostly noise: 77.7% of injected blocks were judged irrelevant, cited-id rate was 0.20, and passive-only scores 49/100 against full context's 69. It still costs ~3.5–6k tokens per turn. | 188.10 "Attribution" | 8 |
| R6 | Lexical retrieval has a hard ceiling. On the 30-question multi-session screen, 11 questions have a needed round outside the top-32 candidates, and 3 of 77 needed rounds share no term with the question. That ranking uses only the question's own words. With the tools on, the agent's reformulated queries reached more (`retrievalRecallAtK` 92 → 96 of 100, round coverage 0.63 → 0.83), but nothing records which needed rounds *no* agent query ever surfaced. | `ms-diagnostics-x.json`; 188.10 "Out of scope" | 5 |
| R7 | Temporal reasoning is the weakest ability: 12/20, against 11/20 for full context. Exchanges carry only the mention time (`tRef`). Relative dates ("last Tuesday") are never resolved, and recall has no time window or time ordering. The temporal-graph literature attacks exactly this, with mention, occurrence and validity axes and timeline resolution (SodaMem, arXiv 2608.08055, 92.8% on LongMemEval-S self-graded). | fabric README `## Exchange archive`; v3 ability table | 6 |
| R8 | Current-state tracking is left to the reader. The shipped preset stores no facts, so "which value is current" is decided by the model over unordered chunks. StateMemBench (arXiv 2608.19652) shows state drift persists **under perfect retrieval**, and a single-call state wrapper adds +32 to +67 points across six backends, of which +15 to +32 is attributable to state structure rather than added context. | 188.10 "Facts: `notes: 0`" | 7 |
| R9 | The answer gap: 8 of 76 v3 questions are wrong with every needed round visible. 188.9 reported 5 of 68. Counting and aggregation over several sessions dominate. | v3 conditional accuracy | 9 |
| R10 | The lever is the model's tool use: 152 calls over 100 questions, 2% run-limit at eight turns. Only one model was measured. Weaker or local models (Laya, d1-3B) may not chase partial evidence, and then the preset falls back to passive-only, which is worse than full context. | v3 tool counters | 10 |
| R11 | Cost and latency are unmeasured as a product would see them. The one-shot benchmark gives the full-context arm no prompt-cache benefit, while a real multi-turn chat caches its prefix and pays cache-read rates. Per-turn latency (p50/p95) was never reported. 53 minutes for 100 questions at concurrency 4 is ≈2 minutes per question. | 188.10 wall times | 3 |
| R12 | Safety is unmeasured, and that is the stated reason defaults stay off. Unknowns:<br>• the trust scan's false-refusal rate (silent memory loss) and detection recall — measured first by 188.11 Task 8;<br>• conversation-borne poisoning (MINJA, arXiv 2503.03704; realistic-condition study arXiv 2601.05504);<br>• cross-principal leakage (F3: foreign context exposed in 13/24 lifecycle sessions);<br>• whether forgetting cascades to derived notes;<br>• PII beyond secrets. | `findings.json` F3, F7, F12 | 14 |
| R13 | A growing archive meets capacity limits. Exchanges fall under the same capacity and archive rules as other notes (`lifecycle/capacity.ts:84–96` filters only `pinned`). The default project budget is 60k tokens, smaller than one LongMemEval-S history. The benchmark never runs `memory:maintain`, so this interaction is unmeasured. The markdown store's measured envelope is 10k notes. | fabric README `## Config`, scale evidence | 15 |
| R14 | OM has no quality evidence. Every OM and OM+fabric benchmark arm failed (`MemoryBenchWorkerError`). F9 is inconclusive. The OM live row still points at a deleted provider. Yet OM is wired into both reference-host agents. Mastra's observational design reports 84–95% on LongMemEval (self-reported), so the approach is worth measuring rather than dropping. | `memory-bench-0.13.0.md:33–50`; `live-matrix.json:221` | 16 |
| R15 | Fact extraction is unreliable: 25 of 51 measured sessions failed consolidation in 188.9 (F4 inconclusive), and the write-side cost was never measured. Facts are the natural carrier for state (R8) and aggregation (R9), so this blocks two levers. | 188.9 README | 17 |
| R16 | Coding memory, the reference host's main use, has one completed lifecycle persona (1887) and no held-out verdict (F7). | 188.7 README | 2, 14, 18 |
| R17 | The shipped preset does not serve coding rules. `conversational` archives exchanges only (`promote: false`). Exchanges are never path-scoped, pinned to core or shared, so a convention accepted last month is found only if the agent thinks to search for it.<br>The machinery for rules exists: `procedure`/`preference` kinds, `path` scope with `appliesTo`, path cues, pinned core, verification by use, correction lineage, and a human-approved team store. But its write path is the unreliable extractor (F4) or the model choosing `memory.insert`.<br>Coding evidence is one synthetic persona: task success .708 with fabric against .292 with whole history, but foreign-context exposure .54, and promotion-on was abandoned at 9/24 sessions.<br>External evidence: models apply single instructions but fail when instructions are spread over sessions, and GPT-4o drops 67% given the full history instead of the instructions (MemoryCode, arXiv 2502.13791). Directly injected, verified experience helps coding agents by 1.1–4.5 points, yet 11 of 12 memory-system pairings fail to beat memory-off (VibeMemBench, arXiv 2609.23570). Static context files change success by −3%/+4% (not significant) at about +20% cost (arXiv 2602.11988). | 188.7 README; `lifecycle/persona.mjs`; fabric README `## Exchange archive` | 11 |
| R18 | The pipeline makes many small decisions with a generative call or a fixed heuristic:<br>• is this turn durable?<br>• which kind and scope?<br>• does the new note supersede the old (`consolidate.decider: "model"`)?<br>• is this passive hit relevant?<br>• is the shown evidence enough?<br>• does this rule apply to this path?<br>0.13.0 ships decision models that answer such questions in one forward pass with probabilities. On Prism-shaped decisions, local d1-3B scores 62.5% overall: 84–86% on tool and tool-error decisions, 44–48% on routing, 34–36% on approval risk. ECE is 0.11, choices flip 12% of the time when option order is reversed, and p50 is 330–744 ms on the dev iGPU. It is good at some decision types and poor at others, so each use needs its own bench.<br>Literature: admission gates (Gated Memory, arXiv 2610.11270, +2.6% on LoCoMo; ConsistencyGate, arXiv 2607.22962, cuts contamination and has a single-pass variant); learned ADD/UPDATE/DELETE/NOOP managers at 3B–14B (Memory-R1, ACL 2026, but trained with RL); small-model memory pipelines (LightMem, arXiv 2604.07798, 83 ms retrieval). | `docs/_evidence/decision-bench-2026-10-23.md`; `docs/decisions.md` | 12 |
| R19 | The structure question has not been answered from evidence. The fabric is already one store with typed notes, sparse links (`part`, provenance, `supersedes`), scopes and a directory. The question is which additional views earn their cost. | "Structure decision" below | 6, 7, 11, 13 |

What the literature agrees on, and how this plan uses it:

1. **Agentic retrieval over raw evidence beats single-shot RAG.** LongMemEval-V2: coding agents searching trajectory files reach 72.5% against 48.5% for the best RAG baseline, at a latency cost. Letta reports 74% on LoCoMo with plain files plus an agent. 188.10 found the same thing, so the read tools stay central.
2. **Raw evidence plus structure.** LME-V2 ablations show the raw pool and the derived notes help different abilities. SodaMem and StateMem add typed time and supersession on top of provenance spans. Keep the verbatim archive as the record of truth, and add derived structure that always cites it.
3. **Planner and reader.** Gather citable evidence before composing the answer (SodaMem; xMemory's drill-down on low confidence).
4. **Evaluation practice.** Survey points:
   - read accuracy together with tokens and p50 latency;
   - disclose the judge and the answerer, and avoid self-judging;
   - judge leniency inflates every number;
   - most benchmarks barely measure writes, forgetting or isolation, so add suites for them.
   Vendor leaderboards in the 90s are self-reported on different backbones and judges and are not targets.

## Structure decision (research, 2026-10-24)

The question was whether memory should be a graph (the popular answer), a tree, a flat store, or a combination. The 2025–2026 controlled and semi-controlled evidence:

| Structure | Helps | Costs or hurts | Evidence |
| --- | --- | --- | --- |
| **Verbatim episodic log** at round granularity | The largest single factor. Raw retention beat compressed and summarized variants on every metric. Round granularity was best, and compressing rounds into facts lost information. | Storage only. | Agent-native memory study (arXiv 2606.24775): LightMem raw 24.2 vs summary 8.5 EM on LoCoMo, 26.0 vs 11.7 on LongMemEval. LongMemEval §5.2 (ICLR 2025). LongMemEval-V2: removing the raw pool hurts most. 188.9: exchange archive +25 points over episode notes. |
| **Derived keys pointing at raw values** | Recall and QA ("fact-augmented key expansion"). | Write-time computation. | LongMemEval (ICLR 2025). |
| **Time axis** (mention time, event time, validity) | Temporal reasoning, event order, knowledge update. | A resolver. | Zep: temporal reasoning 36.5 → 54.1 with gpt-4o-mini, but single-session-assistant −9 and knowledge-update −3 (Zep blog; arXiv 2501.13956). SodaMem (arXiv 2608.08055). TiMem hierarchical-temporal recall 55 → 77 on LongMemEval-S (arXiv 2601.02845, self-reported). The agent-native study: temporal and graph organization help cross-session aggregation and event order. |
| **State and versioning** (subject key, current value, supersession chain) | Current-state and update questions. | Needs subject binding. | StateMem: +15 to +32 points attributable to state structure in a length- and cost-matched control (arXiv 2608.19652). Memory-R1: UPDATE instead of DELETE+ADD. The agent-native study recommends "revisability". |
| **Entity-relation graph** | Multi-hop association and corpus-level summarization. | Loses on simple fact lookup, adds noise, and costs tokens and latency. | GraphRAG-Bench (ICLR 2026, arXiv 2506.05690): fact retrieval RAG 60.9 vs MS-GraphRAG 49.3, HippoRAG 52.9; complex reasoning HippoRAG2 53.4 vs RAG 42.9; prompt tokens 879 (RAG) vs 7,208 (HippoRAG), 38,707 (MS-GraphRAG local) and 331,375 (global). Han et al. (arXiv 2502.11371): RAG better on single-hop and detail, graph better on multi-hop. Mem0g ≈ +2% overall over Mem0, with mixed multi-hop results in reproductions. Cognee and Zep took over 116 s and 155 s per query in the agent-native study. HippoRAG 2 (ICML 2025) keeps passages as nodes precisely to avoid the factual regression of earlier graph methods. |
| **Hierarchy and summaries** | Coarse-to-fine localization in long dialogues. | Summaries lose detail; deeper trees give modest gains. | Agent-native study: deeper MemTree vs flat gives about +0.5 EM, and summaries collapse exact detail. TiMem. |
| **Procedural rules with context-cued delivery** | Applying conventions and decisions when they matter. | A confirmation on the write path. | Complementary learning systems (Kumaran, Hassabis & McClelland 2016): a fast episodic store plus slow consolidation into structured knowledge. Encoding specificity (Tulving & Thomson 1973): recall is cued by context match. MemoryCode, VibeMemBench and the AGENTS.md study (R17). Memp (arXiv 2508.06433): procedural memory transfers to weaker models. |

**Verdict.** No single structure. The memory keeps **one store of record**, the OKF note files, with the verbatim episodic log as ground truth. On top of it sit **derived, rebuildable views that always cite the log**:

1. **Episodic log**: exists (exchange archive).
2. **Time axis**: Task 6.
3. **State and versioning**: Task 7 for exchanges; Task 11 for decision supersession.
4. **Procedural rules with cue-matched delivery**: Task 11.
5. **Sparse typed links** for provenance and navigation: they exist (`part`, fact → exchange, `supersedes`). Task 5 adds `around` and `session` navigation; Task 13 adds conditional one-hop expansion.
6. **A deterministic navigation hierarchy**: exists (memory directory). Task 5 adds a session index.

**Not adopted:**

- An entity-relation knowledge graph as the primary structure. Its measured benefit is confined to multi-hop association, it regresses simple lookup, and it multiplies tokens and latency. It stays a measured, conditional lever (Task 13) and is never assumed.
- Model-written summaries as replacements for raw content.

Code-structure graphs (for example Graphify's tree-sitter graphs) are the right structure for **codebase mapping**, which the owner assigns to separate tools; they are not memory. The design matches complementary learning systems theory: fast verbatim episodes, slow and conservative consolidation into state and rules, and every consolidated item traceable to its episodes.

## Tasks

- [x] Task 1: Review, assumption check and the roadmap entry (read-only)
  - Acceptance Criteria:
    - Functional: The notes record, with `file:line`:
      - (a) **Contract inventory.** The tool input schemas (`packages/memory/fabric/src/tools.ts`), `VectorStore` (`packages/memory/core/src/types.ts:267–320`), the note metadata `v: 1` fields (`fabric/src/types.ts:613–700`), the preset table and contract (188.11 Task 3), and the stability tiers (188.11 Task 6). For each later task, record which additions are additive under those rules and which would need a new preset or a kernel change.
      - (b) **Hypotheses to verify before spending.**
        - R13: does capacity eviction or the archive ever remove or hide an exchange in a 500-session store under `memory:maintain`? Verify with an offline run on a LongMemEval-M write side.
        - R11: the providers' cache-read pricing and the cache fields `usage` reports.
        - R10: which model metadata exposes tool-calling reliability, if any. The kernel model catalog fields are cited.
      - (c) **Data availability and licences** for LongMemEval-M, BEAM (Hugging Face `Mohammadta/BEAM-10M` and the 1M track), LoCoMo (already pinned), StateMemBench (paper arXiv 2608.19652; is the dataset released?), MemoryAgentBench, and the coding longitudinal suite. A suite without a licence that permits benchmark use is dropped and its abilities mapped to another suite.
      - (d) **Agent query logs.** Whether `scripts/memory-bench/replay.mjs` records each `memory.recall` / `memory.read` call's input and result ids per question. Task 5 needs that to measure the candidate gap under the agent's own queries instead of the question-only ranking.
      - (e) **Release-path dependencies.** Which parts of plans 198 (paired comparisons, clustered CIs), 199 (panels, calibration) and 200 (splits, injection suite) have landed, at `file:line`. Tasks 2, 3 and 14 reuse them. A missing piece is a stop finding, not something to rebuild here.
      - (f) **Structure and decision seams.** Every `MemoryNoteLink` relation the fabric writes today and who writes it; the `consolidate.decider: "model"` call path; where path cues and the pinned core select notes (188.5); and whether `prism.models.decisions` is reachable from the fabric's `PackageAPI` with its existing `models` capability. Each answer becomes a criterion of Tasks 11–13.
    - Functional: Verdict.
      - A kernel addition is needed → stop and re-cut.
      - A finding moves a task → the task is re-scoped in the notes.
      - One memory-robustness bullet for roadmap Phase 11's Scope (owner decision 2026-10-24) is drafted in the notes. Task 2 applies it to `roadmap.md`.
    - Performance: Offline only. The R13 check is a local, LLM-free write plus maintain run under a timeout.
    - Code Quality: No product change.
    - Security: No credential is read.
  - Approach:
    - Documentation Reviewed:
      - this plan's critical review;
      - plan 188.11;
      - `.claude/skills/create-plan/references/prism.md` §2;
      - the papers cited above.
    - Options Considered:
      - Start with improvements and evaluate at the end. Rejected: that is the 188.x pattern that spent the held-out pool on one benchmark.
    - Chosen Approach:
      - Verify the cheap hypotheses and data access first, and make the roadmap entry explicit.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/run.mjs --suite longmemeval-m --subset dev-probe --config fabric-x --phase write --write-snapshot .cache/memory-bench/202/m-probe
      timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --store-from .cache/memory-bench/202/m-probe --maintain --report-evictions
      ```
    - Files to Create/Edit:
      - this plan (notes only).
    - References:
      - R1–R16.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-27):
    - **Verdict: no kernel addition is needed. Three findings re-scope tasks, and one needs an owner decision before Task 2 freezes the criteria.** No product code changed. The only edits are this plan's checkbox, these notes and two BEAM track names in Task 2. Scratch probes ran in the session scratchpad, outside the repo. No credential was read, and no model or paid call was made. Network use was public Hugging Face and arXiv metadata only.
    - **Entry blocker: plan 188.11 has not run.** All of its Tasks 1–9 are unchecked. In the tree, `grep -n preset packages/memory/fabric/src/config.ts` finds nothing, there is no `presetRevision`, no `x-prism-stability` annotation and no forward-compatible note reader. Plan 202 builds on all four, so (a) below records the contract from 188.11's text (Tasks 3, 4, 6) plus the code as it stands. Release-path order (188.11 → … → 202) already puts 188.11 first, so this is a sequencing fact, not a re-cut.
    - **(a) Contract inventory.**
      - Tools (`packages/memory/fabric/src/tools.ts`): `memory.view` (:182), `memory.read` (:239; `path` | `id` | `ids`, `MAX_READ_IDS = 8` at :65), `memory.insert` (:333; `kind` enum is `fact | preference | procedure` only), `memory.replace` (:449), `memory.recall` (:541; `kinds` enum includes `exchange`), `memory.forget` (:629). No schema sets `additionalProperties: false`, so new optional inputs are additive.
      - `VectorStore` (`packages/memory/core/src/types.ts:267–320`) has three required methods (`upsert`, `query`, `delete`). Everything else is optional or a declared flag (`scopeCounter`, `lexicalModes`, `authorization`, `lineage`). `Embedder` is at `types.ts:49`.
      - Note metadata `v: 1` is `MemoryNoteMetadata` at `fabric/src/types.ts:613–700`. The parser at `types.ts:736–858` rebuilds known fields only (e.g. `:849`), so an unknown key is **dropped on any rewrite** today. 188.11 Task 4 must land before Task 6's `dates` field and Task 5's `session` field can be called additive.
      - Preset table and stability tiers: absent (see the blocker above).
      - Classification of later tasks, against 188.11's rules:

        | Task | Addition | Class |
        | --- | --- | --- |
        | 5 | `memory.read` `around` / `session` / `page`; deterministic `keywords` into the existing indexed field (`core/src/lexical.ts:74–94`); `recall` output lists unmatched terms | Additive tool inputs and output text, inside the preset. A session lookup needs an **optional store method** (see re-scope 1) |
        | 6 | `dates` field; `recall` `from` / `to` / `order` | Additive `v: 1` field and tool inputs. Needs the 188.11 Task 4 unknown-key rule first. A date filter needs an optional store method or a metadata filter |
        | 7 | Read-time grouping in `recall.ts`; opt-in `state: {}` | Grouping is inside the preset. `state` is an additive opt-in, contract tier |
        | 8 | `inject` thresholds, pointer cards | Additive tuning-tier fields; delivery format is tuning |
        | 9 | Recall summary and "no matching memory" text | Tool text, tuning tier |
        | 10 | Adaptive delivery, `memory:status` field | Additive per-session state |
        | 11 | `decision` kind, `coding` preset | **New stored kind → new preset name** (188.11 Task 3 rule). Touch points: `types.ts:29,34`, `tools.ts` insert and recall kind enums, `config.ts:244,624`, `lifecycle/strength.ts:47` (decay). A 0.13.0 reader must preserve and ignore it (188.11 Task 4) |
        | 12 | `decisions: { model }` | Additive opt-in, contract tier. Reachability: see (f) |
        | 13 | Link expansion input, new link relation | Additive |
        | 14 | Possible `memory:delete-subject` command | Additive command, tentative |
        | 15 | Capacity / maintenance settings | Additive config |
        | 16 | OM changes | Keep OM contract fields (188.11 Task 6) |
        | 17 | `conversational-facts` | New preset name (adds a write-path model call) |

      - No row needs a kernel change.
    - **(b) Hypotheses.**
      - **R13 is confirmed, with a nuance.** Exchanges have no special status in the lifecycle. `merge.ts:42` excludes only `episode` and pinned notes, `lifecycle/strength.ts:47` gives `exchange` a decay of 0.5, and `capacity.ts` evicts anything unpinned below the storage threshold. Defaults are 500 notes and 60k tokens for `project` (`capacity.ts:20–24`), which a 500-session archive exceeds many times over. `memory:maintain` is not run by the benchmark and not by the `conversational` preset (`promote: false`). Offline probes with the in-memory store, 5 exchanges per session (scripts in the scratchpad, not committed):
        - **Capacity:** with `capacity.project.notes = 20` and 40 distinct exchanges, `maintain()` archived exactly 20 with `auditVerb: "evicted"`, oldest first.
        - **Age:** with 100 never-used exchanges, `maintain()` archived 0 at scope clock 40 and **100 of 100 at clock 60**. This matches `retrievalBelow = −2` with decay 0.5 (age ≳ e⁴ ≈ 55 sessions). The scope clock is the store's `sessions` counter.
        - **Defaults at scale:** 650 distinct exchanges (~91k tokens) under default capacity: `maintain()` archived **294** (reported as `merged`), then stopped inside the 60k-token budget. **Unresolved:** `duplicateGroups` on the same text gave 0 groups and term-set Dice between two notes was 0.08, so the `merged` count is not explained by duplicate detection. The probe used a constant embedder, which makes every note "similar" in embedding space. Re-verify on a real write side in Task 4 before relying on that number.
        - **Visibility after archive:** `recall.ts:213–217` appends archived hits only when the best active score is below `ARCHIVE_SEARCH_COVERAGE = 0.34`, capped at `MAX_ARCHIVED_HITS = 3` (`lifecycle/archive.ts:38–40`). Passive injection sets `archiveSearch: false` (`context.ts:288`). So an archived exchange is mostly unreachable unless the agent passes `includeArchived`.
        - **Consequence for Task 15 and Task 4:** the growth criterion must run `memory:maintain` with a scope clock, not just write. The plan's example flags `--maintain --report-evictions` and `--subset dev-probe` do not exist, and neither does a `longmemeval-m` suite. Task 15 adds them if it needs a harness run.
        - **Write cost:** 60 notes took 5.4 s (90 ms each); 650 distinct notes took 154 s. An earlier 500-session (2,500 exchange) run hit the 600 s timeout before it printed anything, so I never measured its full write time. Per-write cost grows with store size and was not profiled. A LongMemEval-M question with ~500 sessions will need a write phase measured in hours with this store. Task 4's budget and Task 15's scale criterion must price it, and Task 5 may need a cheaper write path.
      - **R11, cache pricing and usage fields.**
        - Usage: `Usage.cacheReadTokens` / `cacheWriteTokens` are subsets of `inputTokens` (`src/contracts-core/content.ts:228–243`). The OpenAI-compatible mapping reads `prompt_tokens_details.cached_tokens` or `prompt_cache_hit_tokens` (`src/provider-kit/openai-primitives.ts:82`) and reports **no cache-write tokens**. Hyper maps `cache_read_input_tokens` (`packages/providers/hyper/src/provider.ts:50`).
        - Rates: `ModelCost` carries `cacheRead` / `cacheWrite` (`content.ts:176–185`), populated for most Hyper and OpenCode Go models (`opencode-go/src/models.ts:292–306`). The bench records `cacheReadTokens` only (`usage.mjs`, `journal.mjs:146`, `report.mjs:75`) and never prices it. Task 3's `rates.json` can be seeded from these catalogs.
        - **Owner-decision input for Task 2's cost criterion BFC (iii).** `mimo-v2.5` prices cache reads at $0.0028 per M against $0.14 input, i.e. 2%. A warm-cache `full` arm with a 115k-token history costs ≈ $0.00032 per question. A memory arm that injects 3.5–6k *uncached* tokens per turn costs ≈ $0.0005–0.0008, so memory is *more* expensive than cached full context on this model. At a 10% ratio (a Hyper entry at `models.ts:345`: $0.1 cache read vs $1 input) the same arithmetic gives ≈ 43% of full, a borderline pass of the 50% criterion. The criterion's outcome therefore depends on the cache ratio and on whether the prefix is warm (cache TTLs are minutes). Before Task 2 freezes, the owner should choose: (1) report cost in both a cold regime (one-shot) and a warm regime and state which one governs the criterion, or (2) make the cost row informational. Task 8's precision-first injection and prefix-stable ordering directly move this number.
      - **R10, tool-calling reliability metadata.** The only model-catalog fields are `ModelCapabilities.tools?: boolean` and `toolCallStrictness?: "strict" | "lenient" | "legacy"` (`content.ts:155–160`), both advisory. No provider package sets `toolCallStrictness`, and nothing reports a call rate. Task 10 cannot seed its start mode from the catalog, so its documented fallback applies: the start mode is pointers.
    - **(c) Data availability and licences** (Hugging Face API, 2026-10-27; none gated).

      | Suite | Source and licence | Finding |
      | --- | --- | --- |
      | LongMemEval-M | `xiaowu0162/longmemeval-cleaned`, MIT, same revision `98d7416c…` as the pinned S | `longmemeval_m_cleaned.json`: 2,737,100,077 bytes, SHA-256 `9d79e5524794a2e6900a3aa9cb7d9152c5a3e8319c9a87c25494ba1eacee495f`. **The loader cannot read it**: `loadPinnedArtifact` concatenates the file into one Buffer (Bun's maximum is 4 GiB, so that part fits) and `loadDataset` then calls `JSON.parse`, which needs a string over JavaScript's string length limit. Task 2 needs a streaming or per-question split reader |
      | BEAM | `Mohammadta/BEAM`, CC BY-SA 4.0. Tracks `100K` (20 conversations), `500K` (35), `1M` (35); no "128k" | Parquet, 5.4 MB / 34 MB / 66 MB (SHA-256 `c0519be2…`, `af05921c…`, `41b5acb9…` for 100K, 500K, 1M). The existing parquet path (`datasets.mjs:127–137`) has `maxBuffer` 32 MiB and a 30 s timeout, too small for the 1M track (172 MB as JSON). Corrected in Task 2 |
      | BEAM-10M | `Mohammadta/BEAM-10M`, CC BY-SA 4.0 | Two parquet files, 154 MB and 190 MB. Optional |
      | LoCoMo | Already pinned, **CC BY-NC 4.0 (noncommercial)** | Benchmark use only. The owner should confirm the noncommercial licence is acceptable for the published evidence. Reports hold no text, which limits exposure |
      | MemoryAgentBench-CR | Already pinned, MIT | Available. Only `Conflict_Resolution` is pinned; `Accurate_Retrieval` and `Long_Range_Understanding` also exist in the same repo |
      | MemoryCode | `CohereLabsCommunity/memorycode`, Apache-2.0, revision `32d888b1…` | Available. 360 examples, one parquet (13 MB download). Pin its size and SHA-256 in Task 2 |
      | VibeMemBench, DreamBench-SWE | Already pinned, Apache-2.0 | Available |
      | StateMemBench | arXiv 2608.19652 exists (234 scenarios) | **No dataset or code release found** (Hugging Face search empty; the arXiv page lists no link). Treat as unavailable. If it is still missing at Task 2, drop it and map state tracking to MemoryAgentBench-CR, LongMemEval knowledge-update and BEAM contradiction resolution, as the task allows |
      | Coding longitudinal | Project-owned synthetic generator (`lifecycle/synth.mjs:6`, `personas` is a parameter, default 4) | No licence issue. The 12 personas are a generator setting. Only persona p1887 has real evidence |

    - **(d) Agent query logs: partial.** `replay.mjs:726–762` hooks `tool.call` / `tool.result`. It records tool *names* (`turnTrace`, ≤ 64) and counts, plus `recalledIds` from `memory.recall` hits (`:753–759`) and from passive blocks (`:768–793`). It does **not** record each call's input (queries, `kinds`), the unmatched terms, or ids returned by `memory.read`. So "was the needed round surfaced by any tool result" is computable for recall hits and passive blocks only. Task 5 adds the per-call input log and `memory.read` ids before it can claim the full measure, and the diagnostic must keep refusing held-out ids.
    - **(e) Release-path dependencies** (plans 198–201 are fully checked: 7/7, 7/7, 6/6, 6/6). All of it lives in `packages/hosts/evals/src`, **not** in `scripts/memory-bench`.
      - Statistics (`stats.ts`): `cohensKappa` :17, `fleissKappa` :415, `bootstrapInterval` :178, `clusteredStandardError` :162, `pairedPermutationTest` :234, `mcnemarExact` :217, `passAtK` :276 / `passHatK` :290, `pairedProportionPower` :309, `powerAnalysis` :355, `paretoFrontier` :390.
      - Comparison and judging: `compareExperiments` (`compare-experiments.ts:44`), `createJudgePanel` (`judge-panel.ts:6`), `calibrateJudge` (`calibration.ts:21`), `runComparison` (`comparison.ts`).
      - Data and safety: `defineDataset` / `validateSplit` (`dataset.ts:21,8`), the injection suite (`injection.ts:43,115`).
      - **Re-scope 3 (Task 3):** `scripts/memory-bench/stats.mjs` still carries its own `clusterBootstrap` (:67), `pairedClusterPermutation` (:98), `holm` (:117), `powerForDiff` (:138), `pairedPowerSimulation` (:173) and `compare` (:237). It imports only `mcnemarExact` (:3). Task 3 says "no second statistics module; reuse plan 198's clustered CIs". Task 3 must therefore either delegate to the package (`bootstrapInterval`, `pairedPermutationTest`, `passHatK`, `cohensKappa`) or keep a bench function with a test that asserts agreement with the package. `createJudgePanel` composes `Scorer`s and requires distinct *models* (`requireDistinctModels`, `judgeModel`); it does not check model *family*. Task 3's "different families" rule needs an added family check, and `judge.mjs` (with its judge cache and split judging) needs a `Scorer` adapter to use the panel and `calibrateJudge`.
      - **Open verification debt** (recorded by plan 198 Task 7 and plan 200; not rerun here): `scripts/memory-bench/run.test.mjs` exceeded its 300 s timeout and reports `retry_does_not_duplicate_om_workers_or_promotions`. Tasks 2–3 edit that harness, so triage it before they start.
    - **(f) Structure and decision seams.**
      - **`MemoryNoteLink` relations written today:**

        | Relation | Written by | Place |
        | --- | --- | --- |
        | `part` | the exchange archive | `exchanges.ts:199` |
        | `related` | the linker (embedding similarity) | `links.ts:29` |
        | `similar` | the write planner | `create.ts:578` |
        | `evidence` | consolidation | `consolidation/write.ts:168` |
        | `contradicts` | consolidation | `consolidation/write.ts:178` |

        Supersession is the `supersedes` field, not a link. The `conversational` preset writes only `part` (no embedder, no consolidation). Task 13's expansion therefore has nothing to follow on a preset-only store except `part`, and links need Task 5's navigation (`around`, `session`) to be useful.
      - **Session addressing (re-scope 1, Task 5).** An exchange note id is a SHA-256 of `sessionId + user entry + assistant entry + part` (`exchanges.ts:102`). The note stores no session field under `fabric`. Only the top-level `generated.session` (`types.ts:112`), `sourceEntryIds` and `tRef` identify it. `scanMetadata` pages the whole resource by `(threadId, id)`, so `around` and `session` would scan O(n) on a 500-session store. Task 5's "session index (tentative)" becomes firm: add `session` as an additive `v: 1` field at archive time, plus an optional store method (`listBySession?`, with a fallback scan that emits a status note) per 188.11 Task 4's rule.
      - **Consolidation decider:** `consolidate: { decider: "model" }` (`config.ts:794`) is read at `create.ts:235`; `decideConsolidation` (`decider.ts:8`) makes one bounded call through `resolveModelClient` (`index.ts:228`, `prism.models.client`). Task 12's P-points (consolidation among them) swap this call, not add one.
      - **Path cues and pinned core:** `createFabricCues` (`index.ts:381`, `delivery/cues.ts`) is created only when `config.cues && config.semantic && vectorStore.scanMetadata && projectMemory`. The pinned core block is built at `context.ts:199–255` from `delivery/core.ts` and sits after the directory so the prefix stays cached. Both are existing delivery tiers that Task 11 reuses.
      - **Decision models:** `prism.models.decisions(ref)` is on `PackageAPI` (`src/packages/api.ts:134`, `loader.ts:801`) and is gated by the `models` capability. The fabric already declares `models` (`index.ts:135`), so **Task 12 needs no manifest or capability change**. A string `ModelRef` carries no capabilities, so the adapter gates its own model (`loader.ts:809`).
    - **Re-scopes summary** (Tasks 2–5 and 15 are the only ones moved; 16–19 are untouched):
      1. Task 5: firm the session field and the optional store method; add the per-call query log and `memory.read` ids to the diagnostic; the plan's example commands do not exist.
      2. Task 2: BEAM track names (edited above); a streaming reader for LongMemEval-M and larger parquet limits; StateMemBench is unavailable, so drop or map it; MemoryCode adapter added to the list; owner decision on LoCoMo's noncommercial licence; owner decision on the cost criterion (b above).
      3. Task 3: stats and judge reuse as in (e); cache write tokens are not reported by the OpenAI-compatible route, so `rates.json` can price cache reads only for those models.
      4. Task 4: the first real write-side measurement of R13; budget the LongMemEval-M write time.
      5. Task 15: run `memory:maintain` with a scope clock; archive by age (≈ 55 sessions) is the first failure to cover, before capacity.
    - **Roadmap bullet drafted for Phase 11 Scope** (Task 2 applies it to `roadmap.md`, after the "Evaluation rigor" bullet):

      ```md
      - **Memory robustness (owner decision 2026-10-24):** the memory fabric's `conversational` preset ships as a versioned contract (`presetRevision`), improved inside that contract, with no embeddings and no write-path model call:
        - pre-registered definitions of "robust" and "better than full context", measured once on held-out partitions of LongMemEval-M, BEAM, LoCoMo, MemoryAgentBench and a coding lifecycle suite, on at least three answer models from two providers, under a cross-family judge panel with cache-adjusted cost and latency
        - agentic lexical recall improvements: navigation around a hit, a resolved timeline, current-state grouping, precision-first delivery, and weaker tool-caller handling
        - a `coding` preset with confirmed `decision` notes delivered by path cues
        - opt-in decision-model gates, each shipped only if its own bench passes
        - a safety gate (poisoning, cross-principal leakage, deletion cascade, false refusal, PII) that must pass before any memory default turns on
        - claims limited to the criteria that passed
        - Plan 202 carries this.
      ```

    - **Verification:** read-only. Plan 188.11, plans 198–201, the cited source spans, the Hugging Face dataset trees and arXiv metadata were read. The R13 probes are scratchpad scripts under `/tmp/claude-1000/…/scratchpad/` (`r13*.ts`, `dup.ts`, `dice.ts`); none is in the repo. No test, typecheck, gate or baseline run: nothing in the tree changed except this plan.

- [ ] Task 2: The robustness suite, frozen partitions and pre-registered definitions
  - Acceptance Criteria:
    - Functional: Adapters in `scripts/memory-bench/datasets.mjs` for every suite Task 1 (c) cleared: `longmemeval-m`, `beam` (tracks 100K / 500K / 1M from `Mohammadta/BEAM`; 10M from `Mohammadta/BEAM-10M`, optional; Task 1 (c) corrected the "128k" track name), `locomo` (all conversations), `statemembench` (tentative), `memoryagentbench-cr`, `coding-longitudinal`, `memorycode` (MemoryCode, arXiv 2502.13791, instructions across sessions with revisions), and `vibemembench` / `dreambench-swe` through the existing licence-gated adapters (`scripts/memory-bench/coding.test.mjs`). Each is pinned by URL, byte size and SHA-256, with a licence file, as the existing suites are.
    - Functional: Each suite gets a label-blind, salted draw into `dev`, `heldout-a` and `heldout-b`. `heldout-b` is reserved for the single remediation round in the header and is never read otherwise. The draw reads only ids and ability labels and is stratified so **every ability, including abstention and preference, has items in both held-out partitions**. The files are committed in this task. The held-out guard (the 188.10 refusal of diagnostics on held-out ids) extends to every new `heldout` partition. LongMemEval-S is development-only from now on.
    - Functional: `scripts/memory-bench/robustness-criteria.json`, committed now and hashed into every later manifest, defines:
      - **Better than full context (BFC)**, per answer model in the acceptance set:
        - (i) **in-window suites** (LongMemEval-M truncated arms excluded; BEAM-100K; LoCoMo; StateMemBench short): pooled paired diff vs `full` > 0 with 95% clustered-CI lower bound > 0, **and** non-inferior (3-point margin) on each suite;
        - (ii) **beyond-window suites** (LongMemEval-M, BEAM-1M): CI lower bound > 0 vs `full-truncated` **and** vs `lexical-topk`;
        - (iii) **cost**: cache-adjusted input cost per question ≤ 50% of `full`'s on in-window suites;
        - (iv) **latency**: p95 per-turn added latency ≤ 2× `full`'s.
      - **Robust**:
        - (i) BFC holds on ≥ 3 answer models from ≥ 2 providers;
        - (ii) no ability, on any model, is below `full` by more than 5 points at the CI lower bound, abstention and preference included;
        - (iii) on the small model, the candidate is never below passive-only and never below `full` by more than 5 points;
        - (iv) 3 repeats on a 100-item subset give accuracy SD ≤ 3 points, with pass^3 reported;
        - (v) the claims hold under every judge in the panel, and panel–human κ ≥ 0.8 on the audit set;
        - (vi) Task 14's safety gate passes;
        - (vii) Task 15's growth criterion passes;
        - (viii) **coding**, with the `coding` preset (Task 11), on the 12-persona lifecycle suite at 188.6's computed power:
          - task success ≥ both memory-off and `conversational`, CI lower bound > 0 against memory-off;
          - a superseded decision is applied in ≤ 2% of the sessions where it is relevant;
          - cross-project leakage = 0 and foreign-context exposure = 0 (F3);
          - the poison canary never becomes an active decision;
          - on MemoryCode, latest-instruction accuracy ≥ `full`;
          - on VibeMemBench, if licensed, resolution non-inferior to memory-off (2 points) with fewer steps.
    - Performance: Draws are deterministic and take ≤ 60 s each. Dataset downloads are cached and verified.
    - Code Quality: Reuses the existing loader, pin and draw machinery (`drawHeldoutV3` pattern). No suite-specific branches in the runner beyond the adapter.
    - Security: Datasets are untrusted data. The adapters parse JSON only and never execute content, and fixtures are tested. Reports keep the no-text rule.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/{datasets,run,subsets}.mjs`, `heldout-v3.json`;
      - the BEAM, LongMemEval, LoCoMo, MemoryAgentBench and StateMemBench papers and dataset cards;
      - plan 200 (dataset hashes and splits).
    - Options Considered:
      - Keep LongMemEval-S as the acceptance benchmark. Rejected: no unused ids remain (R4), and it is in-window (R3).
      - Define "better" as beating vendor leaderboard numbers. Rejected: those are self-reported on other backbones and judges.
    - Chosen Approach:
      - Freeze data and definitions before any design work, so every later screen is development-only by construction.
    - API Notes and Examples:
      ```json
      { "bfc": { "inWindow": { "pooledDiffCiLow": 0, "perSuiteNonInferiority": 0.03 }, "beyondWindow": { "vs": ["full-truncated", "lexical-topk"] }, "costRatio": 0.5, "p95LatencyRatio": 2 } }
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{datasets,run,subsets}.mjs`;
      - `scripts/memory-bench/{beam,longmemeval-m,statemembench}-heldout.json` and `-dev.json` (new);
      - `scripts/memory-bench/robustness-criteria.json` (new);
      - `roadmap.md` (Phase 11 Scope: the memory-robustness bullet from Task 1);
      - licence files;
      - tests;
      - `scripts/memory-bench/README.md`.
    - References:
      - R2–R4, R16.
  - Test Cases to Write:
    - `robustness_draws_are_label_blind_and_frozen` (per suite).
    - `every_ability_has_heldout_items`.
    - `diagnostics_refuse_every_heldout_partition`.
    - `criteria_hash_is_pinned_in_manifests`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Measurement that a product decision can trust
  - Acceptance Criteria:
    - Functional: **Judge panel.** Every scored report uses ≥ 2 judges from different model families, built on plan 199's panel and calibration machinery, never the answer model alone. A human-audited set of 150 items (balanced by suite and ability, labelled by the owner or a delegate in a review page) fixes κ per judge. A judge below κ 0.8 is dropped from the panel.
    - Functional: **First panel datum.** *(Plan 188.11 Task 1 (f), 2026-10-27: the checkpoints are not retained — `.cache/memory-bench/answers` holds 14 smoke-run files and the accepted 188.10 reports keep verdicts but no answer text — so this is a re-answer of the three arms on the 100 held-out v3 ids, sized with the in-flight reservation of 250k tokens per request plus 500k per arm, `journal.mjs:13–15`; the original wording follows.)* If plan 188.11 Task 1 (f) found the 188.10 held-out v3 answer checkpoints (`x`, `x-tools`, `full`), the panel re-scores them with `--phase judge`. It reports per-judge scores, agreement, κ, and the `x-tools` − `full` diff under each judge. This is the cheapest test of R1. It runs under Task 4's owner gate and makes no answer calls.
    - Functional: **Cost model.** Each arm reports:
      - raw input and output tokens;
      - provider-reported cache read/write tokens;
      - a cache-adjusted cost from a pinned per-provider rate table;
      - for `full`, a simulated multi-turn cost in which the history is a cached prefix and each question pays cache-read rates. That simulation is the realistic comparator (R11).
    - Functional: **Latency.** Per-turn wall time p50/p95, tool round trips per question, and time to first token, from the existing timing module.
    - Functional: **Variance.** A `--repeats k` mode, with pass^k and SD per arm.
    - Functional: **Comparators.**
      - `lexical-topk`: single-shot BM25 top-k over raw turns with a 4k-token budget, no memory product and no tools, built on `@arnilo/prism-memory-core`'s lexical index. It is the "retrieve once and stuff the prompt" baseline the agentic preset must beat;
      - `full-truncated`: the most recent window that fits the model;
      - `oracle`: needed sessions only. It is an upper bound and appears in reports, never in criteria.
    - Functional: **Stage attribution for every suite.** The failure-stage table (candidate gap, selection gap, partial evidence, answer gap, abstention error, state drift) generalizes beyond LongMemEval-S and runs on development partitions only.
    - Performance: The judge panel at least doubles judge calls; split judging plus the judge cache (188.9) keeps re-judging free. The harness overhead per question stays ≤ 5% of wall time.
    - Code Quality: Extends `metrics.mjs`, `stats.mjs`, `timing.mjs` and `usage.mjs`. No second statistics module; plan 198's clustered CIs and paired comparisons are reused.
    - Security: The human-audit page shows question, gold and answer text to the auditor only. Labels are stored as ids and verdicts.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/{judge,metrics,stats,timing,usage}.mjs`;
      - plans 198–199;
      - judge-bias research (R1);
      - the Mem0 benchmark-practice survey (judge leniency, cost and latency disclosure).
    - Options Considered:
      - A stronger single judge. Rejected: one judge cannot reveal its own bias, and a panel plus a human anchor can.
      - Compare against one-shot full-context cost. Rejected: no product sends uncached history every turn (R11).
    - Chosen Approach:
      - Panel judges calibrated to humans; a cost model with caching counted; latency and variance as first-class outputs.
    - API Notes and Examples:
      ```sh
      timeout 7200 bun scripts/memory-bench/run.mjs --suite beam --subset dev --config lexical-topk --judges hyper/deepseek-v4-flash,opencode-go/mimo-v2.5 --repeats 3
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{judge,metrics,stats,timing,usage,run,report}.mjs`;
      - `scripts/memory-bench/rates.json` (new);
      - `scripts/memory-bench/audit/` (new review-set builder);
      - tests;
      - `scripts/memory-bench/README.md`.
    - References:
      - R1, R11; plans 198, 199.
  - Test Cases to Write:
    - `panel_never_uses_only_the_answer_model`.
    - `kappa_below_threshold_drops_judge`.
    - `cache_adjusted_cost_uses_reported_cache_tokens`.
    - `full_multi_turn_cost_counts_prefix_as_cache_read`.
    - `repeats_report_pass_k_and_sd`.
    - `lexical_topk_and_truncated_arms_never_see_memory_product`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)
  - Acceptance Criteria:
    - Functional: Owner gate 1 is recorded verbatim in the manifest. Arms sized by in-flight reservation (188.10 lesson).
    - Functional: `preset-r1`, passive-only, `full` / `full-truncated` and `lexical-topk` run on every suite's `dev` partition. They run on the three to four answer models Task 1 selected (suggested: `opencode-go/mimo-v2.5`, `hyper/deepseek-v4-flash`, one more Hyper family such as `glm-5.x` or `kimi-k2.x`, and a small model such as `hyper/gemma-4-26b-a4b-it` or local Laya), each judged by the panel.
    - Functional: The output is `docs/_evidence/memory-bench/202/baseline/`:
      - per suite × ability × model: accuracy, CI, cost, latency and the stage table;
      - the gap to each comparator;
      - a ranked list of levers by the questions they could recover.
    - Functional: **Lever decision rule, pre-registered here.** A lever task (5–10, 13, 16, 17) is executed only if the baseline attributes ≥ 5% of development failures on some suite × model to the stage it targets. Otherwise it is closed with that evidence. This is what keeps the plan from building unmeasured machinery. Task 11 is not a lever: coding is a required use (owner, 2026-10-24) and is measured by Task 2 (viii). Task 12 ships or closes each decision point on its own bench.
    - Performance: The budget estimate is stated at the gate from Task 1 measurements. Beyond-window `full-truncated` arms dominate the cost.
    - Code Quality: The existing campaign, journal and report machinery with a `--plan 202-baseline` profile.
    - Security: Keys as `env:` refs from `live.env`. Reports contain no text.
  - Approach:
    - Documentation Reviewed:
      - 188.10's campaign and journal; Tasks 2–3.
    - Options Considered:
      - Go straight to improvements on the 188.10 diagnosis. Rejected: that diagnosis is one benchmark and one model (R1, R4).
    - Chosen Approach:
      - One broad development baseline that decides which levers exist.
    - API Notes and Examples:
      ```sh
      timeout 14400 bun scripts/memory-bench/campaign.mjs --plan 202-baseline --manifest
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance-report}.mjs` (profile);
      - `docs/_evidence/memory-bench/202/baseline/*`.
    - References:
      - R1–R16.
  - Test Cases to Write:
    - `baseline_manifest_pins_criteria_and_product_hash`.
    - `lever_rule_closes_task_below_threshold`: a fixture stage table at 3% → the lever is marked `not needed`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/_evidence/memory-bench/202/README.md` (new).
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Candidate recall without embeddings — agentic lexical navigation and write-time enrichment
  - Acceptance Criteria:
    - Functional: **Enrichment without a model call.** On archive, each exchange gets deterministic `keywords`:
      - normalized entity-like tokens (capitalized spans, numbers with units, dates);
      - a stemmed category vocabulary (the 188.10 Task 6 keyword idea, applied to exchanges, not only to extracted facts);
      - all stored in the existing indexed `keywords` field (`packages/memory/core/src/lexical.ts:74–94`).
    - Functional: **Navigation, as in file search.** An agent that finds one hit can open what is around it, the way a coding agent greps and then opens the file. `memory.read` gains two optional inputs:
      - `around: <id>` returns the neighbouring exchanges of the same session (±2, capped by the existing 8-note read limit);
      - `session: <id>, page` pages through one session in time order.
      Both go through the same scope, consent and redaction filters as recall.
    - Functional: **Rephrasing.** `memory.recall` reports which query terms matched nothing, so the agent can rephrase. Its description gains one sentence on issuing two or three differently-worded queries for aggregation questions; the tool already merges multiple queries.
    - Functional: **Measured under the agent's own queries.** The development diagnostic records, per question, whether each needed round appeared in **any** tool result. It replaces the question-only ranking as the candidate-gap measure, and the held-out guard still applies.
    - Functional: Target, on development partitions: the share of questions with a needed round that no tool result ever surfaced is halved against `preset-r1` on every suite where the baseline showed it, with no ability regressing.
    - Functional: Host impact: **none**. These are additive model-facing tool inputs and an existing note field, inside the preset contract (no new stored kind, no write-path model call, no service).
    - Performance: Enrichment costs ≤ 2 ms per exchange (measured) with no model or embedding call. `around` and `session` reads are index lookups by session id and `tRef`. A missing session index is added only if Task 1 finds reads would scan (tentative).
    - Code Quality: Enrichment lives in `exchanges.ts` next to the archive. Navigation lives in `tools.ts` and reuses `sourceEntryIds` / `tRef`, which every exchange already carries. No embedding code path is added or touched.
    - Security: Navigation never crosses a session the caller's scope cannot read. A neighbour in a foreign scope is `not_found`, as in `memory.read` today.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/core/src/lexical.ts`;
      - `packages/memory/fabric/src/{exchanges,recall,tools}.ts`;
      - `ms-diagnostics-x.json` (R6);
      - 188.10's tool counters;
      - LongMemEval-V2 (coding agents searching raw trajectory files beat the best RAG baseline, 72.5% vs 48.5%);
      - Letta's file-based LoCoMo result.
    - Options Considered:
      - Hybrid retrieval with an embedding model. Rejected by owner decision 2026-10-24: the memory system is not RAG-based. The evidence does not require it either: 188.10's lever was the agent reading more, and agentic search over raw evidence beat RAG in the cited studies.
      - Model-written keywords at archive time. Rejected inside the preset because it adds a write-path model call. It is recorded as a Further Action, opt-in only, if deterministic enrichment and navigation miss the target.
    - Chosen Approach:
      - Give the agent better ways to find and follow evidence lexically, and measure the gap with the queries the agent actually made.
    - API Notes and Examples:
      ```json
      { "tool": "memory.read", "input": { "around": "ex_4f2a" } }
      { "tool": "memory.read", "input": { "session": "s_0193", "page": 2 } }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{exchanges,recall,tools}.ts`;
      - `packages/memory/core/src/sqlite/*` (tentative, session index);
      - `scripts/memory-bench/{replay,retrieval-diagnostics}.mjs` (per-query surfacing);
      - tests;
      - `packages/memory/fabric/README.md` (`## Tools`);
      - `scripts/compat-baseline/*` if exports change;
      - `CHANGELOG.md`.
    - References:
      - R6; 188.11 Task 3 (preset contract).
  - Test Cases to Write:
    - `exchange_enrichment_is_deterministic_and_model_free`.
    - `enrichment_reaches_lexically_unreachable_round`: a fixture built in the shape of the 3 unreachable rounds.
    - `read_around_returns_same_session_neighbours_in_scope_only`.
    - `read_session_pages_in_time_order`.
    - `recall_reports_unmatched_terms`.
    - `diagnostic_counts_rounds_never_surfaced_by_any_tool_result`.
    - `preset_makes_no_embedding_or_write_path_model_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive tool inputs and recall output.
    - Docs pages to create/edit:
      - fabric README (`## Tools`, cost);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: A timeline — resolved dates, occurrence time, and time-scoped recall
  - Acceptance Criteria:
    - Functional: On archive, relative date expressions in an exchange ("yesterday", "last Tuesday", "two weeks ago", "in March") are resolved against `tRef` by a deterministic resolver, English first with the locale gap documented. Each resolution is stored as an additive `v: 1` field `dates: [{ text, resolved, precision }]`, preserved by readers per 188.11 Task 4.
    - Functional: Recall:
      - `memory.recall` accepts optional `from`, `to` (ISO dates) and `order: "relevance" | "time"`; absent means today's behaviour;
      - results in time order show `tRef` and resolved event dates;
      - passive delivery, already in time order within kind, shows resolved dates inline.
    - Functional: Target, on development partitions: temporal-reasoning accuracy (LongMemEval-M, BEAM temporal ordering, LoCoMo temporal) ≥ `full` on every model where the baseline showed a temporal gap, with no ability regressing.
    - Functional: Host impact: **none**. An additive tool parameter (model-facing), an additive note field, inside the preset contract.
    - Performance: The resolver costs ≤ 1 ms per exchange with no model call. The index gains no new table unless Task 1 found the lexical index cannot filter by date; in that case it adds a date column with an index (tentative).
    - Code Quality: One resolver module with a table-driven test corpus. No date library dependency unless Task 1's review finds the kernel already depends on one.
    - Security: Dates are derived from stored text only. No new data leaves the process.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/{exchanges,recall,tools,context}.ts`;
      - SodaMem (mention, occurrence and validity axes; timeline resolution);
      - BEAM temporal-ordering ability;
      - the v3 temporal table (R7).
    - Options Considered:
      - LLM-based timeline resolution at write time. Rejected inside the preset (write-path model call). Kept as an opt-in idea for Further Actions if the deterministic resolver misses.
      - A separate timeline store. Rejected: notes already carry time, and an additive field keeps one source of truth.
    - Chosen Approach:
      - Deterministic resolution plus time-scoped recall. The model gets an ordered, dated evidence view.
    - API Notes and Examples:
      ```json
      { "tool": "memory.recall", "input": { "query": "dentist appointments", "from": "2026-03-01", "to": "2026-05-31", "order": "time" } }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/dates.ts` (new);
      - `exchanges.ts`, `recall.ts`, `tools.ts`, `context.ts`, `types.ts`;
      - `packages/memory/core/src/sqlite/*` (tentative, date column);
      - tests;
      - fabric README;
      - `CHANGELOG.md`.
    - References:
      - R7.
  - Test Cases to Write:
    - `relative_dates_resolve_against_tref` (table-driven, ≥ 60 cases, including month and year boundaries).
    - `unresolvable_expression_is_left_unresolved_not_guessed`.
    - `recall_time_window_filters_and_orders`.
    - `old_reader_preserves_dates_field` (188.11 Task 4 rule).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tool parameters and a note field.
    - Docs pages to create/edit:
      - fabric README (`## Tools`, `## Exchange archive`);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Current-state tracking at read time
  - Acceptance Criteria:
    - Functional: When recall returns several hits about the same subject (same `key` for facts; for exchanges, the same subject terms after Task 5's enrichment, at a similarity above a calibrated threshold), the results are grouped newest-first. Earlier members carry a one-line `superseded by <id> on <date>?` marker. The question mark marks the inference as a hint, not a deletion. Nothing is removed.
    - Functional: An opt-in `state: {}` config adds the StateMem-style single-call state wrapper at answer time: one model call over the grouped hits that emits a current-state table with cited ids. It is **not** part of the preset, because it is a read-path model call per recall. That cost is stated in the README.
    - Functional: Target, on development partitions: state-drift failures (Task 3 stage) halved on StateMemBench and BEAM contradiction resolution, and knowledge-update accuracy ≥ `preset-r1`.
    - Functional: Host impact: **none** for the grouping (inside the preset). `state` is an additive opt-in field.
    - Performance: Grouping is O(k log k) over at most 32 hits with no model call. `state` adds 1 model call and ≤ 2k input tokens per recall.
    - Code Quality: Grouping lives in `recall.ts` and reuses the existing supersession and key machinery (`supersedes`, `key` in `types.ts`). No new store method.
    - Security: The state wrapper sees only already-recalled, already-scoped text.
  - Approach:
    - Documentation Reviewed:
      - StateMemBench / StateMem (arXiv 2608.19652): drift under perfect retrieval; a single-call wrapper gives +32 to +67 points;
      - `packages/memory/fabric/src/{recall,reconcile}.ts`;
      - R8.
    - Options Considered:
      - Rely on facts and supersession at write time only. Rejected: the preset stores no facts (R15), and extraction is unreliable.
      - Delete older hits. Rejected: precision-first and audit; the history stays readable.
    - Chosen Approach:
      - A free, read-time grouping for everyone, and an opt-in single-call state view measured separately.
    - API Notes and Examples:
      ```text
      [3] 2026-05-02 user: The budget is now $450.        (current)
      [1] 2026-03-10 user: Budget is $600 total.           superseded by [3] on 2026-05-02?
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{recall,tools,config,types}.ts`;
      - `packages/memory/fabric/src/state.ts` (new, opt-in);
      - tests;
      - README;
      - `CHANGELOG.md`.
    - References:
      - R8.
  - Test Cases to Write:
    - `recall_groups_same_subject_newest_first`.
    - `supersession_marker_is_a_hint_and_deletes_nothing`.
    - `state_opt_in_makes_one_call_and_cites_ids`.
    - `preset_has_no_state_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — recall rendering and an opt-in field.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Precision-first passive delivery
  - Acceptance Criteria:
    - Functional: Passive injection becomes **confidence-gated**. It injects only hits whose fused score clears a threshold calibrated on development partitions, and otherwise only the partial-selection cue and the directory.
    - Functional: Below a second threshold it renders **pointer cards** instead of full exchange text: id, date, the user line's first 120 characters, and match terms. The agent reads by id. This is progressive disclosure, as in the memory directory.
    - Functional: Both thresholds are **tuning**-tier fields under `inject`.
    - Functional: Target, on development partitions, against `preset-r1`, on every model: injected-irrelevant rate ≤ 0.40, injected tokens per turn −50%, and accuracy non-inferior (2-point margin). On the small model (Task 10's set), accuracy must not fall: weak tool-callers need text, not pointers, and Task 10 handles that split.
    - Functional: Host impact: **none**. Delivery format changes inside the preset contract.
    - Performance: No new model call, and the gate uses scores already computed.
    - Code Quality: In `context.ts` and `excerpt.ts`. The existing `selectInjection` mirror test (`delivery_diagnostic_mirrors_shipped_injection_rule`) is updated so the diagnostic and the product stay identical.
    - Security: Pointer cards show less text, never more. The cue never names content from another scope.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/{context,excerpt,directory}.ts`;
      - the 188.10 attribution (R5);
      - xMemory (drill-down on low confidence).
    - Options Considered:
      - Turn passive off and rely on tools. Rejected without evidence: passive helps when tools are not called (R10). This task measures the gated middle.
    - Chosen Approach:
      - Gate by confidence and fall back to pointers. Measured on irrelevant rate, tokens and accuracy together.
    - API Notes and Examples:
      ```text
      memory (3 more matches, read with memory.read): [e81] 2026-04-02 "I picked up the new bike…" · [e97] …
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{context,excerpt,config}.ts`;
      - `scripts/memory-bench/retrieval-diagnostics.mjs` (mirror);
      - tests;
      - README;
      - `CHANGELOG.md`.
    - References:
      - R5.
  - Test Cases to Write:
    - `low_confidence_hits_render_as_pointer_cards`.
    - `below_floor_injects_only_cue_and_directory`.
    - `delivery_diagnostic_mirrors_shipped_injection_rule` (updated).
    - `injection_never_exceeds_budget`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — delivery format and tuning fields.
    - Docs pages to create/edit:
      - fabric README (`## Selective injection and recall`, cost);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Answering from evidence — aggregation and abstention
  - Acceptance Criteria:
    - Functional: `memory.recall` results add a compact grouped summary for multi-session use:
      - hits per session and date;
      - distinct sessions matched;
      - "N more matches not shown" with the query to page them.
      The tool description tells the agent to list the instances with ids before counting or totalling.
    - Functional: An empty or low-confidence recall returns an explicit `no matching memory` result with the terms searched and the scopes covered, so the agent can abstain instead of guessing.
    - Functional: The fabric's context block carries one sentence on citing memory ids. Citations already count as use (188.4).
    - Functional: Target, on development partitions: answer-gap failures (needed evidence visible, answer wrong) −40% against `preset-r1`, and abstention accuracy ≥ `full` on every suite that has abstention items.
    - Functional: Host impact: **none**. Tool output and description text are tuning-tier (188.11 Task 6).
    - Performance: Summary rendering ≤ 200 tokens per recall, counted inside the existing rendered-token recall budget.
    - Code Quality: In `tools.ts` and `recall.ts`. No change to the solver protocol in the benchmark, so the effect is the product's.
    - Security: Searched terms are the agent's own query and scopes are names only, so nothing new is disclosed.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/{tools,recall}.ts`;
      - the R9 conditional accuracy;
      - the SodaMem planner–reader split.
    - Options Considered:
      - A separate `memory.aggregate` tool. Rejected: one more tool to learn. The grouped summary on recall gives the same evidence.
      - A second model call as reader. Rejected inside the preset. It is Task 7's opt-in `state` pattern if needed.
    - Chosen Approach:
      - Make the tool output aggregation-shaped and make "not found" explicit.
    - API Notes and Examples:
      ```text
      7 matches in 5 sessions (2026-01-04 … 2026-06-19); showing 4 — page with { query, page: 2 }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{tools,recall,context}.ts`;
      - tests;
      - README;
      - `CHANGELOG.md`.
    - References:
      - R9.
  - Test Cases to Write:
    - `recall_summary_counts_sessions_and_pages`.
    - `empty_recall_reports_terms_and_scopes`.
    - `summary_fits_rendered_token_budget`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tool output text.
    - Docs pages to create/edit:
      - fabric README `## Tools`;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 10: Robustness to weaker tool-callers
  - Acceptance Criteria:
    - Functional: The preset adapts its delivery to observed tool use, per session. If a session has had ≥ 2 user turns with partial-selection cues and no `memory.*` call, passive delivery switches from pointer cards (Task 8) to full excerpts within the same budget. It switches back when the agent calls the tools. The switch is recorded in session package state and shown in `memory:status`.
    - Functional: No kernel change. It uses the existing `tool.call` observation and package session state. If Task 1 (b) found a model-catalog capability field, it may seed the initial mode; otherwise the start mode is pointers.
    - Functional: Run-limit behaviour: when the agent hits the turn limit mid-recall, the last recall's grouped summary (Task 9) is already in context, so the answer step has evidence. Measured as the run-limit failure share.
    - Functional: Target, on the small model: preset ≥ passive-only and within 5 points of `full`, without regressing the strong models (2-point margin).
    - Functional: Host impact: **none**. Inside the preset contract.
    - Performance: No model call. One counter per session.
    - Code Quality: In `context.ts` and fabric session state. One small state machine with unit tests.
    - Security: Per-session state only. It never crosses principals.
  - Approach:
    - Documentation Reviewed:
      - 188.10 tool counters (R10);
      - `packages/memory/fabric/src/{context,index}.ts` (session flag `enabled`, `index.ts:140`);
      - the kernel `tool.call` hook docs (`docs/hooks.md`).
    - Options Considered:
      - Host-declared model tiers. Rejected: it pushes a decision to hosts, which the stability goal forbids. Observed behaviour needs no host input.
    - Chosen Approach:
      - Adapt delivery to what the model actually does.
    - API Notes and Examples:
      ```text
      memory:status → { delivery: "excerpts", reason: "no memory tool use after 2 cued turns" }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{context,index,types}.ts`;
      - tests;
      - README;
      - `CHANGELOG.md`.
    - References:
      - R10.
  - Test Cases to Write:
    - `delivery_switches_to_excerpts_without_tool_use`.
    - `delivery_switches_back_on_tool_use`.
    - `delivery_mode_is_per_session_and_per_principal`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — adaptive delivery.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 11: Coding memory — decisions and conventions that apply repeatedly
  - Acceptance Criteria:
    - Functional: **A `decision` note kind**, additive under 188.11 Task 4's rule. A decision is "we chose X (over Y) because Z, for this scope". Its fields:
      - `text`: the rule, one sentence;
      - `rationale`;
      - `scope`: `user`, `project`, or `path` with `appliesTo` globs;
      - `status`: `proposed`, `active` or `superseded`;
      - `supersedes`;
      - `sourceEntryIds`: the exchange where the decision was accepted.
      `procedure` (how to do something) and `preference` (user taste) keep their meaning. Every existing kind keeps its shape.
    - Functional: **Capture without silent extraction.** A decision can enter memory three ways, and **none becomes `active` without confirmation**:
      - (a) **Explicit statements.** A user turn matching decision cues ("from now on", "always/never", "we decided", "use X instead of Y", corrections such as "no, do X") yields a `proposed` decision. Cues are lexical patterns, or decision point P1 when Task 12 enabled it.
      - (b) **Agent proposals.** `memory.insert { kind: "decision" }` writes `proposed`.
      - (c) **Promotion.** A `proposed` decision becomes `active` when the user confirms it (one batched `host.ui` confirmation through the existing approval channel, at most once per turn) **or** when 188.4's use-based verification sees it applied without correction in ≥ 2 sessions.
      Sharing to the checked-in team store stays `memory:share`, human-approved (188.5).
    - Functional: **Delivery when it applies, not as a dump.**
      - Active `path` decisions whose `appliesTo` matches a touched or target path are delivered through 188.5's path cues: at most 3 per turn within the existing 300-token cue budget.
      - Active project-wide decisions take a slice of the pinned core: the existing 600-token budget, decisions first.
      - Each line carries the id, the rule, and "why: memory.read <id>".
      - Nothing is delivered in bulk, following the AGENTS.md finding (R17).
    - Functional: **Staying current.** A correction against an active decision writes the new one with `supersedes`. The old one becomes `superseded`: kept, readable and never delivered. A narrower scope shadows a wider one through the existing key shadowing (188.2).
    - Functional: **The `coding` preset** = `conversational` + decisions + path cues + core restricted to decisions and preferences. Contract (188.11 Task 3):
      - no write-path generative model call (capture is lexical plus confirmation);
      - a decision model only when the host names one (Task 12);
      - `presetRevision: 1`.
      The reference host's coding agent gains the opt-in value `memory: "coding"` (188.11 Task 7's option).
    - Functional: **Measured.** It is measured on the 12-persona coding lifecycle suite (whose personas already carry preferences, path conventions, reasoned decisions, corrections, ephemeral noise and a poison canary), MemoryCode, and VibeMemBench / DreamBench-SWE if licensed. The criteria are Task 2's robust (viii). F3 and F7 are resolved here or in Task 14.
    - Functional: Host impact: hosts opt in with `preset: "coding"`. No existing field changes meaning.
    - Performance: Cue matching is a glob match over active decisions in the scope (≤ 1 ms per turn for 500 decisions, measured). Delivery stays ≤ 300 cue tokens per turn plus the existing core budget. Confirmations are ≤ 1 per turn, batched.
    - Code Quality: The kind lives in `types.ts` and the lifecycle; capture in `exchanges.ts` next to the archive hook; delivery reuses `createFabricCues` and `createFabricCore`. No second cue mechanism.
    - Security:
      - Decisions are never captured from tool output (untrusted), only from user turns and the agent's own typed writes.
      - The trust scan runs on every decision write.
      - The poison canary test must hold.
      - Confirmation goes through `host.ui`; a host answering `unavailable` leaves the decision `proposed` (fails closed).
  - Approach:
    - Documentation Reviewed:
      - fabric README `## Scopes`, `## Delivery tiers` (pinned core, path cues, team store), `## Exchange archive`;
      - `scripts/memory-bench/lifecycle/persona.mjs:23–75` (labels: `manager`, `commit`, `folder` with `appliesTo`, `database` with reason, `retry` with correction, `poison`, `noise`);
      - `docs/_evidence/memory-bench/188.7/README.md:32–33, 52–64`;
      - MemoryCode (arXiv 2502.13791), VibeMemBench (arXiv 2609.23570), Evaluating AGENTS.md (arXiv 2602.11988), SWE-Bench-CL (arXiv 2507.00014);
      - architecture decision records (Nygard 2011: context, decision, consequences);
      - encoding specificity (Tulving & Thomson 1973).
    - Options Considered:
      - Rely on searching the exchange archive. Rejected: the agent must think to search, and MemoryCode shows retrieval and integration across sessions is exactly where models fail.
      - Auto-extract every decision with the generative extractor. Rejected as the default: it is unreliable (F4), and an unconfirmed rule that is wrong contaminates every later session (ConsistencyGate's contamination argument).
      - A static rules file only (AGENTS.md style). Rejected as the sole mechanism: no measured gain and +20% cost. The team store is the human-curated, checked-in subset.
      - Reuse `procedure` for decisions. Rejected: a decision's rationale, status and supersession are what keep it current, and `procedure` has none of them.
    - Chosen Approach:
      - Confirmed, scoped, versioned decisions, delivered by context cue when they apply. This is the procedural-memory part of the structure decision.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "coding", tools: { root: "./.prism/memory-local" } });
      ```
      ```text
      memory rules for src/payments/**: [d12] Validate inputs with zod, not yup — why: memory.read d12
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{types,config,exchanges,tools,context,index}.ts`;
      - `packages/memory/fabric/src/delivery/*` (cues and core selection);
      - `packages/memory/fabric/src/lifecycle/*` (verification for decisions);
      - tests;
      - `scripts/memory-bench/{datasets,lifecycle/*}.mjs` (MemoryCode adapter, 12-persona run);
      - `apps/prism-agent/src/host/coding.ts` and its scenario;
      - fabric README;
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` (new kind constant);
      - `CHANGELOG.md`.
    - References:
      - R17; the structure decision; 188.2–188.5; 188.11 Tasks 3, 4 and 7.
  - Test Cases to Write:
    - `decision_cue_creates_proposed_decision_only`.
    - `decision_becomes_active_on_confirmation_or_verified_reuse`.
    - `host_ui_unavailable_leaves_decision_proposed`.
    - `active_path_decision_delivered_when_path_matches_and_not_otherwise`.
    - `correction_supersedes_and_old_decision_is_never_delivered`.
    - `narrower_scope_shadows_wider_decision`.
    - `decision_never_captured_from_tool_output`.
    - `poison_canary_never_active`.
    - `coding_preset_contract_no_generative_write_call`.
    - `reference_host_coding_memory_option_recalls_convention_across_sessions` (mock provider).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new kind, a new preset, delivery.
    - Docs pages to create/edit:
      - fabric README (new `## Coding decisions` section, the presets table, cost);
      - `apps/prism-agent/README.md`;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 12: Decision-model gates for memory operations
  - Acceptance Criteria:
    - Functional: **An opt-in field** `decisions: { model: ModelRef, points?: DecisionPoint[] }` (contract tier). It calls `prism.models.decisions(model)` through the fabric's existing `models` capability (Task 1 (f)). Absent, nothing changes. Any decisions-capable model works: `liquid-local/d1-3B`, `liquid/d1`, `liquid/d1-ultra`, `typesafe/jev-latest`, Laya.
    - Functional: **The decision points.** Each runs as one batched `decide()` call (≤ 64 questions) with a calibrated threshold and an **abstain band**. Inside the band, the incumbent path (heuristic or generative call) decides.

      | Point | Question type | Replaces or adds | Used by |
      | --- | --- | --- | --- |
      | P1 durable | `noul` per user turn: does it state a lasting decision, preference or fact? | Gates capture and the extractor, so only flagged turns reach generative extraction. | Tasks 11, 17 |
      | P2 supersession | `choice` per (new, candidate) pair: `replaces`, `refines`, `contradicts`, `unrelated` | `consolidate.decider: "model"` and Task 7's markers. | Tasks 7, 11, 17 |
      | P3 relevance | `noul` per passive candidate (top ≤ 32): does it bear on this turn? | Adds a precision filter before injection. | Task 8 |
      | P4 needed | `noul` per user turn: does answering need memory? | Skips passive injection when low. | Task 8 |
      | P5 sufficient | `noul` after a recall: is the shown evidence enough? | Drives the partial-selection cue and abstention. | Task 9 |
      | P6 applies | `noul` per active decision whose globs do not decide: does this rule apply to the current task? | Path-cue selection. | Task 11 |
      | P7 instruction-like | `noul`: does this text try to instruct a future agent? | An extra input OR-combined with the trust scan, **never** the only gate. | Task 14 |

    - Functional: **Bench first, free and local.** `scripts/fixtures/decision-bench-memory.jsonl` has ≥ 100 labelled items per point, drawn from development partitions and the lifecycle personas, with option-order-reversed repeats. `scripts/decision-bench.mjs` is extended to score them. A point ships only if, at its chosen threshold, on development items:
      - accuracy ≥ the incumbent's;
      - ECE ≤ 0.10 after temperature calibration fitted on a separate development split;
      - flip rate ≤ 5% with order-averaged choices;
      - p95 ≤ 1 s on the dev machine.
      A point that fails is closed with its numbers in `docs/_evidence/memory-bench/202/decisions/`. P7 additionally must not lower the trust scan's recall on Task 14's corpus.
    - Functional: **End to end.** The points that shipped run on development partitions against the same preset without `decisions`:
      - accuracy non-inferior (2-point margin);
      - injected tokens per turn and extractor calls per session reported;
      - p95 per-turn added latency ≤ 1 s.
      They enter Task 18 only if this holds.
    - Functional: Host impact: **none** unless the host names a decision model. The presets' contract allows decision-model calls only under that opt-in (188.11 Task 3).
    - Performance: At most 2 `decide()` calls per turn (P3/P4 combined in one request when both run; questions batch). Local d1-3B measured at p50 330–744 ms per request on the dev machine (2026-10-23 bench); Liquid reports 8 ms on an RTX 4090, unverified here. Cost per 1k turns stated in the README for local and hosted models.
    - Code Quality: One `decisions.ts` module owns question texts (tuning tier), thresholds, abstain bands and the fallback. No kernel change: `prism.models.decisions` is existing `PackageAPI`. A decision never deletes or archives anything on its own.
    - Security:
      - Only already-scoped text is sent.
      - A hosted decision model receives memory text off-machine; the README says so, and local d1-3B is the documented default suggestion.
      - P7 can only add refusals, never remove one.
      - Decision errors (`DecisionsError`, timeout) fall back to the incumbent path, and the turn never fails.
  - Approach:
    - Documentation Reviewed:
      - `docs/decisions.md` (contract, bounds, `DecisionsError`);
      - `docs/_evidence/decision-bench-2026-10-23.md` (per-category accuracy, ECE, flip rate, latency);
      - plans 195–196;
      - fabric `consolidate: { decider: "model" }` (README `## Config`);
      - Gated Memory (arXiv 2610.11270), ConsistencyGate (arXiv 2607.22962), Memory-R1 (arXiv 2508.19828, ACL 2026), LightMem (arXiv 2604.07798), ADAPT-LLM (arXiv 2404.19705), MemRetriever (arXiv 2609.11951).
    - Options Considered:
      - Use the decision model for every point by default. Rejected: the measured profile is uneven (84–86% on tool decisions, 34–36% on approval risk), so each point earns its place on its own bench.
      - Train a memory manager (Memory-R1 style RL). Rejected for 0.13.0: it needs a training pipeline and data the repo does not have. Recorded as a Further Action, with Memory-R1's 152-example result as the reason it may be cheap later.
      - Let the decision model gate safety alone. Rejected: approval-risk accuracy is 34–36%. P7 is additive only.
    - Chosen Approach:
      - Calibrated, abstaining gates at the points where a one-pass yes/no or choice replaces a generative call or a blunt heuristic, each proven on its own bench before it runs.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "coding", decisions: { model: "liquid-local/d1-3B" } });
      ```
      ```ts
      await prism.models.decisions(cfg.model).decide({
        state: { turn, candidates },
        questions: { c1: { type: "noul", instructions: "Does memory c1 bear on the user's current request?" } /* … ≤ 64 */ },
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{decisions,config,context,recall,exchanges,reconcile}.ts`;
      - tests (mock decisions provider from `@arnilo/prism/testing`);
      - `scripts/decision-bench.mjs`;
      - `scripts/fixtures/decision-bench-memory.jsonl` (new);
      - `docs/_evidence/memory-bench/202/decisions/*`;
      - fabric README;
      - `CHANGELOG.md`.
    - References:
      - R18; Tasks 7, 8, 9, 11, 14, 17.
  - Test Cases to Write:
    - `decisions_absent_changes_nothing`.
    - `abstain_band_falls_back_to_incumbent`.
    - `decision_error_falls_back_and_turn_succeeds`.
    - `p7_only_adds_refusals`.
    - `decision_never_deletes_or_archives`.
    - `points_batch_into_at_most_two_calls_per_turn`.
    - `unshipped_point_is_not_callable_from_config` (a point closed by its bench is rejected by config validation).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an opt-in config field.
    - Docs pages to create/edit:
      - fabric README (`## Decision models`, cost, privacy);
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 13: Associative expansion over typed links (conditional lever)
  - Acceptance Criteria:
    - Functional: Executed only if Task 4, after Tasks 5–9 ran, attributes ≥ 5% of development failures on some suite × model to **multi-hop association**: LoCoMo multi-hop, BEAM relationship and multi-hop abilities, where the needed rounds are linked by a shared entity but not by the question's terms. Otherwise it is closed with that evidence.
    - Functional: If executed, it adds one-hop expansion along the links the store already has (`part`, fact → exchange provenance, `supersedes`) plus one new **deterministic** relation, `same-subject`, between exchanges that share Task 5's enrichment keys above a calibrated overlap.
      - Surfaces: `memory.read { id, follow: "links" }`, and an optional expansion of recall results within the rendered-token budget.
      - Not built: entity-relation extraction, a graph store, or graph-wide ranking.
    - Functional: Target, on development partitions: multi-hop accuracy +5 points with no ability regressing and injected tokens per turn ≤ +20%.
    - Functional: Host impact: **none**. An additive tool input and an additive link relation.
    - Performance: Expansion reads ≤ 8 linked notes, the existing read cap. `same-subject` links are computed at archive time from keys already computed, with no model call.
    - Code Quality: In `links.ts` and `tools.ts`, reusing `MemoryNoteLink`.
    - Security: Following a link never crosses scope; a foreign target is `not_found`.
  - Approach:
    - Documentation Reviewed:
      - the structure decision's evidence;
      - `packages/memory/fabric/src/links.ts`;
      - HippoRAG 2 (ICML 2025, passages kept as nodes);
      - GraphRAG-Bench (arXiv 2506.05690);
      - Han et al. (arXiv 2502.11371);
      - Mem0 / Mem0g (arXiv 2504.19413).
    - Options Considered:
      - A full entity knowledge graph (GraphRAG, Graphiti-style). Rejected by evidence: it regresses simple lookups, costs about 44× the prompt tokens (MS-GraphRAG local vs RAG), its reported gains are small (Mem0g ≈ +2%), and graph systems were the slowest in the agent-native study. Reconsidered only if one-hop expansion misses and the residual failures are entity-chained.
      - Personalized PageRank over a passage–entity graph (HippoRAG 2). Kept as a Further Action, because it is the graph method that preserved factual recall.
    - Chosen Approach:
      - The cheapest associative structure that can be tested, built from links the store already writes, and only if the baseline shows the need.
    - API Notes and Examples:
      ```json
      { "tool": "memory.read", "input": { "id": "ex_4f2a", "follow": "links" } }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{links,tools,exchanges,recall}.ts`;
      - tests;
      - fabric README;
      - `CHANGELOG.md`.
    - References:
      - R19; the structure decision.
  - Test Cases to Write:
    - `follow_links_reads_one_hop_within_scope_and_cap`.
    - `same_subject_link_is_deterministic`.
    - `expansion_respects_rendered_token_budget`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, if executed — an additive tool input.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 14: The safety suite and the gate for defaults
  - Acceptance Criteria:
    - Functional: `scripts/memory-bench/safety/` (new) runs, on the mock provider where possible and on the panel models for the agentic parts:
      - (a) **conversation-borne poisoning**, MINJA-style. Crafted user turns try to plant instructions or false facts that a later session follows. It measures stored-rate, then retrieved-rate, then followed-rate, with and without pre-existing legitimate memories (the realistic-condition protocol of arXiv 2601.05504);
      - (b) **cross-principal and cross-project leakage**: two users, two projects, team store on and off. Any foreign exchange in context or tool results counts. This resolves F3;
      - (c) **deletion cascade**: after `memory.forget` or the host's delete path, the content is absent from note files, the derived index, derived facts, links, the core block and `memory:export`, and is never recalled;
      - (d) **false refusal**: 188.11 Task 8's audit, re-run on the new suites;
      - (e) **PII retention**: a fixture of emails, phone numbers and addresses; what the redactor and trust scan do. A PII redactor option is added only if hosts have no way to pass one (the kernel `SecretRedactor` seam exists).
    - Functional: The gate, pre-registered in `robustness-criteria.json`:
      - followed-rate ≤ 5%;
      - leakage = 0;
      - deletion 100%;
      - false refusal ≤ 1 per 1,000 exchanges and 0 needed sessions;
      - PII behaviour documented.
      Every failure becomes a fix in this task, with a regression test.
    - Functional: F7 is resolved by running the 12-persona lifecycle power set at the size 188.6 computed, or by recording why it is replaced by (b).
    - Functional: Host impact: **none**, unless a deletion API is missing for hosts. Then it is added as an additive command (`memory:delete-subject`, tentative) and documented.
    - Performance: (b), (c) and (e) are offline and free. (a) has a token estimate stated at the development gate.
    - Code Quality: Reuses plan 200's injection suite and scenario items where they fit.
    - Security: This task is the trust boundary. Every gate case is a test that fails closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/{exchanges,scoped/trust}.ts`;
      - `findings.json` F3, F7, F12;
      - MINJA (arXiv 2503.03704);
      - arXiv 2601.05504;
      - Agent Security Bench;
      - plan 200.
    - Options Considered:
      - Keep defaults off forever. Rejected: hosts deserve a measured basis for the decision either way.
    - Chosen Approach:
      - Measure the threat classes the archive creates, and gate defaults on them.
    - API Notes and Examples:
      ```sh
      timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite all --output docs/_evidence/memory-bench/202/safety.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/safety/*` (new) and tests;
      - fixes in `packages/memory/{fabric,core}/src/*` as found;
      - fabric README `## Cost, security, and failure behavior`;
      - `CHANGELOG.md`.
    - References:
      - R12, R16.
  - Test Cases to Write:
    - `poisoned_turn_not_followed_in_later_session`.
    - `no_foreign_exchange_in_context_or_tools`.
    - `forget_cascades_to_files_index_links_core_export`.
    - `false_refusal_rate_reported`.
    - One regression test per fixed failure.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, if a deletion command is added.
    - Docs pages to create/edit:
      - fabric README;
      - `docs/_evidence/memory-bench/202/README.md`;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 15: Growth — capacity, maintenance and scale for a lifetime archive
  - Acceptance Criteria:
    - Functional: A growth simulation streams a long history into one store with `memory:maintain` run on its normal trigger. It uses BEAM-10M or concatenated LongMemEval-M histories, simulating 12 months with dated sessions. Questions about month-1 content are asked at months 1, 6 and 12.
    - Functional: Criterion, pre-registered: month-12 accuracy on month-1 questions within 3 points of month 1's.
    - Functional: Fixes as R13's verification requires:
      - exchanges get their own capacity tier, separate from facts, with a size-based archive tier that stays lexically searchable (the existing searchable archive, `ARCHIVE_SEARCH_COVERAGE`);
      - eviction never deletes an exchange's text, only demotes it.
    - Functional: Store envelope: p95 recall latency ≤ 100 ms at 100k exchanges on SQLite and Postgres, and the documented markdown limit updated from measurement (today 10k notes).
    - Functional: Host impact: **none**, except a documented recommendation to move to SQLite or Postgres above the measured markdown envelope. That is already the documented pattern.
    - Performance: The measurements are the deliverable, recorded in a refreshed `docs/_evidence/memory-markdown-scale-*.md`.
    - Code Quality: Capacity changes in `lifecycle/{capacity,maintain}.ts`, with per-kind limits through the existing `capacity` config shape (an additive `exchange` entry).
    - Security: Demotion keeps the scope and consent filters, so archived exchanges are never visible to more principals than before.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/src/lifecycle/{capacity,maintain,strength}.ts`;
      - the fabric README scale envelope;
      - `docs/_evidence/memory-markdown-scale-0.13.0.md`;
      - BEAM's length degradation.
    - Options Considered:
      - Exempt exchanges from capacity. Rejected: unbounded hot sets degrade ranking and latency. Tiering bounds the hot set and keeps recall.
    - Chosen Approach:
      - Measure growth first, then tier exchanges so nothing is lost.
    - API Notes and Examples:
      ```ts
      lifecycle: { capacity: { project: { notes: 500, tokens: 60_000 }, exchange: { hotTokens: 200_000 } } }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/lifecycle/*`, `config.ts`;
      - `scripts/memory-bench/growth.mjs` (new);
      - `scripts/memory-bench/markdown-scale.mjs`;
      - tests;
      - README;
      - evidence;
      - `CHANGELOG.md`.
    - References:
      - R13.
  - Test Cases to Write:
    - `maintain_never_deletes_exchange_text`.
    - `demoted_exchange_still_recalled_lexically`.
    - `capacity_exchange_tier_bounds_hot_set`.
    - `growth_month12_criterion_evaluated`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an additive capacity entry and changed eviction behaviour.
    - Docs pages to create/edit:
      - fabric README (Config, scale envelope);
      - scale evidence;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 16: Observational memory — make it measurable, then decide its role
  - Acceptance Criteria:
    - Functional: The `MemoryBenchWorkerError` causes behind every OM and OM+fabric arm are diagnosed and fixed. OM, OM+fabric (preset) and preset arms complete on development partitions on two models.
    - Functional: The role is decided by data and documented in both READMEs:
      - in-session compression only;
      - a delivery source for the fabric (observations as notes);
      - or a standalone conversational memory comparable with the preset.
      The reference host's OM wiring is kept or changed accordingly, with its scenarios green.
    - Functional: F9 is resolved. The OM live row (re-pointed by 188.11 Task 7) becomes `active`.
    - Functional: Host impact: **none** for hosts that do not use OM. For OM hosts, any change keeps OM's config contract fields (188.11 Task 6).
    - Performance: OM's observer and reflector cost per 10k message tokens measured and stated in its README.
    - Code Quality: Fixes in `packages/memory/observational`. No OM logic moves into the host.
    - Security: OM observations follow the same scope and trust rules as fabric writes when they feed the fabric.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/memory-bench-0.13.0.md:33–140` (failures);
      - `packages/memory/observational/README.md`;
      - Mastra's observational memory write-up (observer and reflector, append-only and cache-stable, self-reported 84–95% on LongMemEval).
    - Options Considered:
      - Drop OM from the reference host. Rejected without evidence. It may be the best in-session compressor; this task finds out.
    - Chosen Approach:
      - Fix measurability first, then decide by comparison.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/observational/src/*` (as found);
      - `scripts/memory-bench/replay.mjs`;
      - tests;
      - README;
      - `apps/prism-agent/src/host/*` (only if the role changes);
      - `scripts/live-matrix.json`;
      - `CHANGELOG.md`.
    - References:
      - R14.
  - Test Cases to Write:
    - Regression tests for each worker-error cause.
    - `om_fabric_arm_completes_offline` (mock provider).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: possibly — OM's role.
    - Docs pages to create/edit:
      - OM and fabric READMEs;
      - `apps/prism-agent/README.md` if the host changes;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 17: Reliable fact extraction, opt-in, measured (only if Task 4 shows facts are the lever)
  - Acceptance Criteria:
    - Functional: Executed only if Task 4's baseline, or Tasks 7 and 9's residuals, attribute ≥ 5% of development failures to aggregation or state that the read-time fixes cannot recover. Otherwise closed with that evidence.
    - Functional: If executed, the extractor:
      - consolidation failure rate ≤ 2% of sessions on development partitions (from 49% in 188.9);
      - write-side cost per session measured on a cheap model;
      - every fact cites its exchange (the existing link);
      - an opt-in preset `conversational-facts`, a new name because it adds a write-path model call per session, is accepted only if it beats `conversational` on the target abilities with no regression.
    - Functional: F4 is resolved.
    - Functional: Host impact: **none** for `conversational` hosts. Others adopt by changing the preset name only.
    - Performance: Cost per session and per 1k exchanges stated in the README.
    - Code Quality: In `packages/memory/fabric/src/consolidation/*`, reusing the 188.10 budget and truncation repair.
    - Security: Facts inherit their exchange's scope and consent. Extraction never widens scope.
  - Approach:
    - Documentation Reviewed:
      - `consolidation/{extract,prompts}.ts`;
      - 188.9 and 188.10 extractor evidence;
      - MemReader (arXiv 2604.07877, active extraction).
    - Options Considered:
      - Make facts part of `conversational`. Rejected by the preset contract.
    - Chosen Approach:
      - A conditional, separately named preset.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "conversational-facts", promote: { model: "<cheap model>" } });
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{consolidation/*,config}.ts`;
      - tests;
      - README;
      - `CHANGELOG.md`.
    - References:
      - R15.
  - Test Cases to Write:
    - `extraction_failure_rate_below_threshold_on_fixture_sessions`.
    - `facts_preset_declares_write_path_call`.
    - `conversational_preset_unchanged_by_facts_preset`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, if executed — a new preset name.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 18: Held-out acceptance on the robustness suite (owner gate 3, paid)
  - Acceptance Criteria:
    - Functional: The candidate (`conversational` revision 2 = every executed lever task, frozen by product hash) runs against `preset-r1`, `full` / `full-truncated` and `lexical-topk`. The `coding` preset (Task 11, plus the Task 12 points that shipped) runs against memory-off and `conversational` on the coding suites.
      - Every suite's `heldout-a` partition, read here for the first time. The one remediation round (header) uses `heldout-b` under the same manifest rules and a fresh owner gate.
      - Every acceptance model (≥ 3 models, ≥ 2 providers, one small).
      - The judge panel; repeats on the 100-item subset; the safety gate (Task 14) and growth criterion (Task 15) re-run on the frozen product.
    - Functional: The verdict is one row per criterion in `robustness-criteria.json` (hash verified), computed by `acceptance-report.mjs --plan 202` with no hand-set value. The result is `robust`, `better-than-full-context`, both, or neither, with the failing rows named.
    - Functional: A miss is reported as a miss. No post-hoc margin, partition or model swap; the manifest refuses criteria drift as 188.10's did.
    - Performance: Budget stated at the gate. In-flight caps per arm; wall-time limit per suite stated and reported, with overruns recorded as deviations.
    - Code Quality: Existing campaign and journal machinery with the `--plan 202` profile.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - Tasks 2–17;
      - 188.10 Task 9 (manifest discipline).
    - Options Considered:
      - Accept on a subset of suites. Rejected: the definitions are the point.
    - Chosen Approach:
      - One pre-registered, multi-model, multi-suite held-out verdict.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 202 --manifest
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 202
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/202/acceptance/*`.
    - References:
      - Task 2.
  - Test Cases to Write:
    - `acceptance_202_refuses_criteria_or_product_drift`.
    - `verdict_rows_match_criteria_file`.
    - `small_model_rows_present`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - `docs/_evidence/memory-bench/202/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

- [ ] Task 19: Preset revision 2, defaults and the published claim
  - Acceptance Criteria:
    - Functional:
      - If Task 18 passes **better-than-full-context** or **robust** (or both): `CONVERSATIONAL_PRESET_REVISION` becomes 2 and `conversational` resolves to the accepted candidate. Hosts on `preset: "conversational"` get it with **no config change**. A test asserts that a config written for revision 1 (the 188.11 README example) still validates and resolves to revision 2.
      - If it fails, after the one remediation round, 0.13.0 ships the last passing revision. A lever that met its development target ships as a tuning-tier change only if Task 18 shows no regression for it. The README states the failing criteria.
    - Functional: Defaults change only if the safety gate (Task 14) **and** the robust verdict both pass. The candidate default is installing the fabric with `preset: "conversational"` on. Otherwise defaults stay off, and the failed criterion is named in `scripts/memory-bench/defaults.json` and the README.
    - Functional: The README claim is the verdict's wording, with models, judges, suites, cost and latency. "Better than full context" may appear only if that verdict row set passed.
    - Functional: Release hand-off: plan 186's live journey scenario 11 (added by 188.11 Task 7) runs against the shipped revision, and plan 187's CHANGELOG and README claims are the ones this task writes. The 188.11 limitations register (`docs/_evidence/memory-bench/188.11/limitations.json`) is closed: each entry is marked resolved with evidence, or carried into the README's Known limitations.
    - Functional: Plan end: Compromises, Further Actions and backlog hand-off. `coding` ships in 0.13.0 if Task 18 passes its rows of robust (viii). Otherwise the owner decides at Task 18 whether it ships as a documented, unaccepted opt-in or is withheld; either way the README states the failing rows.
    - Performance: n/a.
    - Code Quality: The preset table change is one object edit. Compat baselines are regenerated if `CONVERSATIONAL_PRESET_REVISION`'s value is in the baseline, with the attribution noted.
    - Security: A default that stores conversation content is enabled only under the passed safety gate. The README states what is stored.
  - Approach:
    - Documentation Reviewed:
      - 188.11 Tasks 3 and 6 (preset contract, stability tiers);
      - Task 18 verdict.
    - Options Considered:
      - Ship revision 2 as a new preset name. Rejected: that defeats the stable-API goal. The contract allows improvement within the name.
    - Chosen Approach:
      - The revision bump hosts receive for free, and defaults only under the safety gate.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "conversational", tools: { root } }); // unchanged host line → revision 2
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/config.ts`;
      - tests;
      - `scripts/memory-bench/defaults.json`;
      - `docs/_evidence/memory-bench/188.11/limitations.json`;
      - fabric README;
      - `CHANGELOG.md`;
      - this plan;
      - `plans/backlog.md`.
    - References:
      - Tasks 14, 18.
  - Test Cases to Write:
    - `host_config_from_0130_resolves_to_revision_2`.
    - `defaults_change_only_with_safety_and_robust_verdicts`.
    - `readme_claim_matches_verdict`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — preset contents, and possibly defaults.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`;
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 180 bun scripts/memory-bench/run.mjs --offline`
- `timeout 1800 bun scripts/decision-bench.mjs --fixtures scripts/fixtures/decision-bench-memory.jsonl --models liquid-local/d1-3B@Q4_K_M,liquid-local/d1-3B@Q8_0` (local, free; the hosted rows need their keys)
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline`
- `timeout 900 bun examples/long-term-memory.ts`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 300 bunx biome check <changed files>`
- `timeout 1800 bun scripts/release.mjs gate` (memory baseline diffs attributed per task)
- Paid, in order, each after its owner gate:
  1. Task 4 baseline;
  2. the development screens of the executed lever tasks;
  3. Task 18 held-out acceptance (and, only after a miss, the one remediation round on `heldout-b`);
  4. `acceptance-report.mjs --plan 202`;
  5. confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
