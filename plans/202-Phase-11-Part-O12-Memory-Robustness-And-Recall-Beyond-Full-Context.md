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
  - **Amended 2026-10-31 (owner decision: three-tier memory ships in 0.13.0).** The owner added a model-written view on top: the ontology tier (plan 207), with one concept note per subject, every claim citing T1 notes, and incremental edits only. Plan 208 measures it against its own preset. See "Structure decision — 2026-10-31 amendment".
- **Amended 2026-10-31 (owner decision after a first-principles assessment):**
  - claims must reflect work as well as recall: plan 209 adds a pre-registered work-outcome suite (repeated corrected mistakes, convention adherence, re-asked questions, orientation cost) measured beside this plan's suites;
  - standing rules become the centre of the memory (plan 209 Task 3, building on Task 11);
  - before the freeze, plan 210 audits every memory feature and removes those that show no benefit and have no credible fix, so unmeasured mechanisms do not become permanent API-level-1 obligations.

## Expected Outcome

- `scripts/memory-bench` runs a **robustness suite**: LongMemEval-S (development only), LongMemEval-M, LoCoMo, BEAM, StateMemBench (if licensed and available), MemoryAgentBench-CR and the coding longitudinal suite. Each has label-blind, frozen development and held-out partitions, committed before Task 4. One `robustness-criteria.json` carries the definitions, and every later manifest hashes it.
- Every report carries:
  - accuracy under a cross-family judge panel with κ and a human-audited calibration set;
  - cache-adjusted cost;
  - p50/p95 latency per turn;
  - repeat variance and pass^k;
  - a failure-stage table for every suite, not only LongMemEval-S.
- Comparators in every campaign: `full` (whole history, or truncated to the model window when it does not fit), `lexical-topk` (single-shot BM25 top-k over raw turns, no memory product, no tools), `preset-r1` (0.13.0), and the candidate revision.
- A frozen candidate with development evidence for every executed lever, handed to plan 210. **Since 2026-10-31 the held-out acceptance and the preset-revision, default and claim decisions are plan 210 Tasks 9 and 10.** That acceptance runs on at least three answer models across at least two providers (one of them a small model) and gives one verdict per criterion in this plan's `robustness-criteria.json`. Either 0.13.0 publishes `presetRevision: 2`, or plan 210 records which criterion failed and 0.13.0 publishes the last passing revision.
- A safety suite (Task 14) covering poisoning, cross-principal leakage, deletion cascade, false refusal and PII. Only a pass, re-run on plan 210's frozen product, lets plan 210 Task 10 decide whether `conversational` or another memory default turns on.
- OM has measured quality, and its documented role is decided by data.
- A `coding` preset with a `decision` note kind: confirmed decisions with rationale and path scope, delivered as path cues and core lines when they apply, superseded on correction, measured on the 12-persona coding lifecycle suite, MemoryCode and (if licensed) VibeMemBench.
- `decisions: { model }` (opt-in) runs only the decision points that passed their bench in `docs/_evidence/memory-bench/202/decisions/`. Every other point keeps the incumbent path.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 12). **Owner decision 2026-10-24: memory robustness ships in 0.13.0.**

**Placement.** It runs as release step **17b**, after 201 and before 184. Three reasons:

- it reuses plan 198's clustered statistics and paired comparisons;
- it reuses plan 199's judge panels and calibration, and plan 200's dataset splits and injection suite;
- it must land before plan 185 freezes the surface, because it adds tool parameters, note fields and config fields under the rules plan 188.11 wrote.

**Three-tier insertion and sequential order (owner decisions 2026-10-31).** The memory train runs strictly one plan after another:

1. **202** (step 17b), this plan: Tasks 1–17, ending with development evidence and a frozen candidate;
2. **207** (17c): the ontology tier;
3. **208** (17d): three-tier criteria, the claim-support audit, ontology safety probes and the ontology development screen;
4. **209** (17e): standing rules, tool steps, cited lessons, the work-outcome suite and its development screen;
5. **210** (17f): the end-of-build feature audit and removals, then the one held-out acceptance on the final product (formerly this plan's Task 18) and the preset revision, defaults and published claims (formerly Task 19);
6. plan 184, then plan 185.

**Tasks 18 and 19 moved to plan 210 (Tasks 9 and 10) on 2026-10-31.** Elsewhere in this plan, "Task 18" means plan 210 Task 9, "Task 19" means plan 210 Task 10, and "gate 3" is the held-out gate plan 210 Task 9 runs. The frozen product read on held-out partitions therefore includes plans 207–209 and plan 210's removals. `robustness-criteria.json` is unchanged and still judges the robustness rows; the ontology arms are judged by plan 208's `three-tier-criteria.json` and the work-outcome arms by plan 209's `work-outcome-criteria.json`.

**Plan end.** After the last task the lever rule leaves (Task 17, or the last executed task before it), the executor runs plan end (Compromises, Further Actions, backlog hand-off) and lists, for plan 210's ledger, every feature of this plan whose development evidence is neutral, negative or missing: for example a closed lever, a decision point that failed its bench, or a lifecycle mechanism with no task benefit.

**Review task included** (Task 1). Later tasks may add optional `VectorStore` methods, tool parameters, note fields and config fields.

- **No embeddings and no new package.** Owner decision 2026-10-24: the memory system is not RAG-based. Recall is the agent searching and reading the verbatim archive with lexical tools. No task adds, uses or measures an embedding model. The existing opt-in `retrieval: "hybrid"` field stays accepted (188.11's compatibility promise), but the preset never uses it and this plan does not develop it.
- **No kernel contract change.** If Task 1 finds one is needed, the plan stops and is re-cut.
- **No version bump or publish here.** Every package ships in plan 187's lockstep 0.13.0 publish, with the preset revision plan 210 Task 10 settles.
- **Paid work is owner-gated twice in this plan:** before the baseline (Task 4) and before the development screens of Tasks 5–17 (one shared gate). The held-out acceptance (gate 3) runs in plan 210 Task 9.
- **Cache-stable product before any further paid run (added 2026-10-30).** Tasks 4.11–4.15 run first: session-epoch prefix snapshot, extractor cache key, cache hygiene, and live-run requirement updates.
  - Readiness refuses a manifest whose product hash lacks their cache-stability record.
  - The 23-cell screen stays the development baseline only if 4.15's offline equivalence attestation passes.
    - **Outcome (2026-10-30): the attestation did not pass.** The `preset-r1` and `passive-only` answer requests differ on all 56 compared requests (the fabric tail now follows the latest user message, among other layers), so those two arms' cells are rerun under gate 2 and never mixed with the 23 pre-change cells. The `full`, `full-truncated` and `lexical-topk` cells install no fabric and stay the comparators. See Task 4.15.
  - `robustness-criteria.json` is unchanged.

**Release gating** is pre-registered here; the owner may change it before Task 4.

- 0.13.0 does not wait for a passing verdict.
- This plan is complete when every task 1–17 has run or been closed by the lever rule (Task 4) and plan end is written. The held-out verdict is recorded by plan 210 Task 9.
- One remediation round is allowed, run by plan 210 Task 9. If the held-out acceptance misses, the levers may be revised once on development partitions, then measured once on the second, disjoint held-out partition Task 2 reserves (`heldout-b`).
- A second miss is final. Plan 210 Task 10 ships the last passing revision with claims limited to the criteria that passed.

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

### Structure decision — 2026-10-31 amendment (owner decision: three-tier memory)

The owner decided that 0.13.0 ships memory as three tiers:

- **T0, observation:** the session, the exchange archive and OM.
- **T1, the fabric:** atomic, scoped notes.
- **T2, the wiki as the ontology of the context it is built in:** one concept note per subject, with relations and cited claims.

Plan 207 builds it and plan 208 measures it. The amendment keeps this section's rule and adds one view:

| Structure | Helps | Costs or hurts | Evidence |
| --- | --- | --- | --- |
| **Ontology view** (concept per subject; sparse typed relations; itemized claims, each citing T1 notes; incremental edits only) | Coarse-to-fine entry for "what is / how does / why" questions; aggregation of scattered instances under one subject; schema-assisted binding at write time. | A background curator model call per changed subject. Risk of false generalization, measured by plan 208's claim-support row (O3). Risk of collapse under rewrites, avoided by construction (no rewrite operation). | Zep's episode → entity → community tiers with back-pointers (arXiv 2501.13956). ACE: itemized delta edits avoid context collapse (arXiv 2510.04618). Letta sleep-time consolidation. A-MEM linking and evolution (NeurIPS 2025). Karpathy's compiled LLM wiki (2026-04). Schema-accelerated consolidation (Tse et al. 2007). Gist and detail coexist (Winocur & Moscovitch 2011). Gist-driven false memory (DRM; fuzzy-trace theory). Combining raw, fact and episodic granularities beats any single one (arXiv 2605.19952). |

Constraints that keep the verdict above intact:

- The verbatim log stays the store of record. Concepts never replace, compress or delete T1 notes.
- Every claim cites T1 notes. A claim whose citations are forgotten is removed deterministically; a claim whose citations are superseded is marked stale and never delivered.
- Relations are sparse typed links on concept notes (`MemoryNoteLink`). There is no graph store, no graph-wide ranking, and no traversal beyond Task 13's one hop.
- Retrieval stays lexical and agentic. There is still one recall tool, which ranks concepts first and drills down to notes and exchanges.
- "Not adopted" above still holds: no entity-relation graph as the primary structure, and no model-written summary replacing raw content.

The ontology tier is an opt-in package (`memory-wiki`). The `conversational` and `coding` presets' contracts are unchanged, and the tier's default follows plan 208's development evidence and plan 210's held-out verdict.

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
      - **Cleared 2026-10-27 (re-review).** 188.11 Tasks 1–9 are now checked and the four dependencies are in the tree: `PRESETS` / `PRESET_REVISIONS` (`fabric/src/config.ts:937–946`), `presetRevision` on `memory:status` (`fabric/src/index.ts:1133`), `x-prism-stability` (`config.ts:919`), and unknown-key preservation on note read/write (`fabric/src/types.ts:875,921`). `CONVERSATIONAL_PRESET_REVISION` is exported. `docs/_evidence/memory-bench/188.11/limitations.json` (12 entries, each with its `plan202Task`) and `trust-scan.json` exist. Task 1's re-scopes below still hold: no exchange `session` field, `replay.mjs` still logs no per-call query input, `stats.mjs` still carries its own statistics, and the plan's example harness commands still do not exist. No kernel contract was added by 188.11, so the "no kernel addition" verdict stands. Remaining conditions are recorded in the tasks that clear them: Task 2 (two owner decisions, harness triage, tree baseline), Task 3 (cost regime), Task 4 (green harness before the paid baseline), Task 14 (188.11's measured trust-scan rates and the `curl -s` miss), Task 15 (corrected capacity shape).
    - **(a) Contract inventory.**
      - Tools (`packages/memory/fabric/src/tools.ts`): `memory.view` (:182), `memory.read` (:239; `path` | `id` | `ids`, `MAX_READ_IDS = 8` at :65), `memory.insert` (:333; `kind` enum is `fact | preference | procedure` only), `memory.replace` (:449), `memory.recall` (:541; `kinds` enum includes `exchange`), `memory.forget` (:629). No schema sets `additionalProperties: false`, so new optional inputs are additive.
      - `VectorStore` (`packages/memory/core/src/types.ts:267–320`) has three required methods (`upsert`, `query`, `delete`). Everything else is optional or a declared flag (`scopeCounter`, `lexicalModes`, `authorization`, `lineage`). `Embedder` is at `types.ts:49`.
      - Note metadata `v: 1` is `MemoryNoteMetadata` at `fabric/src/types.ts:613–700`. The parser at `types.ts:736–858` rebuilds known fields only (e.g. `:849`), so an unknown key was **dropped on any rewrite** at the time of this inventory. **Amended 2026-10-27:** 188.11 Task 4 has landed — unknown keys are collected into `MemoryNoteMetadata.unknown` (`types.ts:684,875`) and re-emitted on encode (`types.ts:921`), so Task 6's `dates` and Task 5's `session` fields are additive as planned.
      - Preset table and stability tiers: recorded from 188.11's text at the time; now present in the tree (see the cleared blocker above). The rules below are unchanged: a new stored kind or a new write-path model call needs a new preset name, everything else must stay additive and optional.
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

- [x] Task 2: The robustness suite, frozen partitions and pre-registered definitions
  - Acceptance Criteria:
    - Preconditions (entry state, 2026-10-27):
      - **Owner decision 1 — cost criterion regime.** Task 1 (b) showed BFC (iii)'s outcome flips with the cache-read ratio (mimo-v2.5 ≈ 2% → memory looks dearer than warm full context; a 10% ratio → ≈ 43% of full, a pass). Before `robustness-criteria.json` is committed, the owner picks: (1) report cost in both a cold one-shot regime and a warm cached-prefix regime and state which one governs BFC (iii), or (2) make the cost row informational. Record the choice in the criteria file and the manifest.
      - **Owner decision 2 — LoCoMo licence.** LoCoMo is CC BY-NC 4.0 (noncommercial). Confirm that is acceptable for published evidence, or drop the suite and map its abilities to another (Task 1 (c)). Record either way in the licence file.
      - **Commit 188.11 first.** The 188.11 work is uncommitted in the working tree. Commit it, then branch plan 202 from that commit, so a later `release.mjs gate` judges 202's diff rather than another session's edits.
      - **Triage the two red memory-bench tests before editing the harness.** `bun test scripts/memory-bench` is 245 pass / 2 fail as of 2026-10-27: `retry_does_not_duplicate_om_workers_or_promotions` and `full_and_memory_arms_render_the_same_dated_question`, both `ERR_PRISM_HOOK` from the uncommitted plan 194 `compactAt` change (a mock model declaring no context window). Also present and unrelated: untracked `docs/next/` and `packages/memory/src/`, which fail `docs.test.ts`'s `docs_next_is_promoted` and the fabric test `no_workspace_imports_prism_memory_family`. Fix or explicitly quarantine them in this task; otherwise plan 202 cannot attribute its own regressions. This is the same open verification debt Task 1 (e) recorded for `run.test.mjs`.
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

  - Notes (executed 2026-10-27; offline, no paid call, no credential read).
    - **Owner decisions recorded in `scripts/memory-bench/robustness-criteria.json`** (as the precondition required; the owner may still reverse either before Task 4):
      - cost regime: **both** regimes reported, **warm cached-prefix governs BFC (iii)**. Rationale: a product sends history as a cached prefix, so the warm regime is the realistic comparator (R11); the cold one-shot number is still reported because the ratio flips the verdict (Task 1 (b)).
      - LoCoMo licence: **accepted** for benchmark use only, CC BY-NC 4.0, reports carry ids/counts/scores and never text.
    - **Harness triage (precondition).** Both red tests were a fixture fault, not a plan 202 regression: `retry_does_not_duplicate_om_workers_or_promotions` and `full_and_memory_arms_render_the_same_dated_question` passed `modelConfig: { provider: "mock", model: "m" }` with no `limits`, so plan 194 Task 7's `context.compactAt` resolver (correctly) failed `resolveCompactAtThreshold`. Fixed in the two test fixtures by declaring `limits: { contextWindow: 128_000, maxOutputTokens: 1024 }`, which is what every real model declares. `bun test scripts/memory-bench` is now **256 pass / 1 skip / 0 fail**. Still present and unrelated (another session's uncommitted work): untracked `docs/next/` fails `docs.test.ts`'s `docs_next_is_promoted`, and untracked `packages/memory/src/` fails fabric's `no_workspace_imports_prism_memory_family`. Quarantined: neither is plan 202's to delete; the release gate (Task 19) must not run before they are resolved by their owner.
    - **Pins added to `datasets.mjs`** (verified against the Hugging Face tree API, full SHA-256, licence sidecar unchanged): `longmemeval-m` 2,737,100,077 B `9d79e552…` MIT; `beam-100k` 5,429,768 B `c0519be2…`; `beam-500k` 33,956,263 B `af05921c…`; `beam-1m` 66,156,374 B `41b5acbb…`; `beam-10m` two parts 153,844,664 + 189,980,875 B; `memorycode` 11,666,648 B `1edb1238…` Apache-2.0 at `32d888b1…`; `coding-longitudinal` is generated, not downloaded. `memoryagentbench-cr` gained the missing `format: "parquet"` that the old suite-specific branch hid. `statemembench` is recorded unavailable in the criteria file with its state-tracking abilities remapped, as Task 1 (c) allowed.
    - **Loader fixes forced by the new data.** `parseJsonArrayIncremental` splits a top-level JSON array at buffer level (string/escape/brace aware) so LongMemEval-M never goes through `JSON.parse` on 2.7 GB; it rejects an unterminated or non-array file. Parquet now runs with `maxBuffer` 512 MiB and a 300 s timeout (the 1 M track is 172 MB as JSON), and the Python bridge `ast.literal_eval`s `probing_questions`, which BEAM stores as a Python literal rather than JSON.
    - **Adapters + normalizers:** `longmemeval-m` reuses the S normalizer (same schema); `beam-*` builds sessions from `chat` with `time_anchor` dates and one item per probing question, taking gold from each ability's own key (`answer` / `ideal_answer` / `ideal_response` / `ideal_summary` / `expected_compliance`); `memorycode` yields one item per example with `ability` from `instruction-add`/`instruction-update`, gold topics and the last session query; `coding-longitudinal` yields the 12 persona settings.
    - **Partitions.** New `robustness.mjs` (draw, criteria hash, verification) and `robustness-draw.mjs` (generator). Every downloadable suite plus the generated lifecycle suite has a committed `robustness-<suite>.json` with `dev` / `heldout-a` / `heldout-b`, disjoint ids, `residualPool`, stratum sizes and `idsHash`. Draws are label-blind: ids sorted by `SHA-256("prism-202-memory-bench-<suite>:" + id)` inside each ability; tests re-draw from shuffled, text-changed metadata and get identical partitions. Sizes: LongMemEval-M 50/25/25 across 7 abilities (abstention and preference included); each BEAM track 40/20/20 across its 10 abilities; LoCoMo 60/30/30 across its 5; MemoryAgentBench-CR 20/10/10; MemoryCode 80/40/40; VibeMemBench 30/15/15; DreamBench-SWE 9/6/6; coding lifecycle 4/4/4 personas.
    - **Criteria pinning.** `robustnessCriteriaHash()` is on every `runBench` report and on `campaign.buildManifest()`, and is part of `journal.manifestFingerprint`, so a changed definition starts a new campaign identity. `diagnoseRetrieval` and `multiSessionDiagnostic` refuse `heldout-a` / `heldout-b`; `selectQuestions` fails closed on any id the dataset does not hold.
    - **Roadmap:** the Phase 11 Scope bullet was applied after "Evaluation rigor" (`roadmap.md:2424`), with the two owner decisions reflected.
    - **Deviations from the plan text, recorded:**
      - one `robustness-<suite>.json` per suite holds all three partitions, instead of a `-dev` + `-heldout` file pair: fewer files, same guarantees (ids, `idsHash`, disjointness tested).
      - `robustness.mjs` / `robustness-draw.mjs` / `robustness.test.mjs` are new files not listed in the plan's file list; they keep `datasets.mjs` from importing the draw logic and keep the runner free of suite branches.
      - `beam-10m` is pinned but **not drawn** (optional track, 340 MB, no run planned). `dreambench-swe` C10 is dropped from the draw: only 2 items, cannot fill both held-out partitions; recorded here rather than silently shrinking a partition.
      - LongMemEval-M's draw uses the pinned S question ids and abilities because M only extends the haystack. Downloading 2.7 GB at draw time is not required; `verifyLongMemEvalMItems` re-checks every id and ability whenever the M cache exists, and a wrong id fails closed at first use.
      - LongMemEval-S stays selectable at `--subset heldout-v3` only for the historic 188.10 acceptance artifacts that `acceptance.mjs` mechanizes; no plan 202 claim uses it. Plan 202 claims use the robustness partitions only.
      - The coding-suite partitions are consumed by Task 18's coding harness (MemoryCode/VibeMemBench/DreamBench adapters and the lifecycle suite), not by `runBench`'s coding path, which slices rows directly.
      - The precondition "commit 188.11 first" is **not done**: 188.11 remains uncommitted in the working tree, and plan 202 cannot commit another session's work. Carried to the owner before Task 4's paid baseline.
    - **Tests:** `scripts/memory-bench/robustness.test.mjs` — `every pinned suite has bytes, sha256 and a licence`, `robustness_draws_are_label_blind_and_frozen`, `every_ability_has_heldout_items`, `diagnostics_refuse_every_heldout_partition`, `criteria_hash_is_pinned_in_manifests`, `json_array_stream_reads_one_question_at_a_time`, `beam_and_memorycode_normalizers_keep_ability_and_gold`, `longmemeval_m_draw_matches_the_cached_dataset_when_present`, `selection_uses_only_the_frozen_partition`. 9 pass. Whole suite 256 pass / 1 skip / 0 fail; `biome check` clean on every changed file.
    - **Reproduce:** `timeout 1800 bun test scripts/memory-bench/robustness.test.mjs`; draws with `timeout 900 bun scripts/memory-bench/robustness-draw.mjs` (offline, cached; parquet needs `PRISM_MEMORY_BENCH_PYTHON`).
    - **Carried to Task 4:** download and verify the 2.7 GB LongMemEval-M pin once, run `verifyLongMemEvalMItems`, and do the first real write-side R13 measurement (Task 1 (b) unresolved `merged` count, write cost at ~500 sessions).

- [x] Task 3: Measurement that a product decision can trust
  - Acceptance Criteria:
    - Functional: **Judge panel.** Every scored report uses ≥ 2 judges from different model families, built on plan 199's panel and calibration machinery, never the answer model alone. A human-audited set of 150 items (balanced by suite and ability, labelled by the owner or a delegate in a review page) fixes κ per judge. A judge below κ 0.8 is dropped from the panel.
    - Functional: **First panel datum.** *(Plan 188.11 Task 1 (f), 2026-10-27: the checkpoints are not retained — `.cache/memory-bench/answers` holds 14 smoke-run files and the accepted 188.10 reports keep verdicts but no answer text — so this is a re-answer of the three arms on the 100 held-out v3 ids, sized with the in-flight reservation of 250k tokens per request plus 500k per arm, `journal.mjs:13–15`; the original wording follows.)* If plan 188.11 Task 1 (f) found the 188.10 held-out v3 answer checkpoints (`x`, `x-tools`, `full`), the panel re-scores them with `--phase judge`. It reports per-judge scores, agreement, κ, and the `x-tools` − `full` diff under each judge. This is the cheapest test of R1. It runs under Task 4's owner gate and makes no answer calls.
    - Functional: **Cost regime is Task 2's decision, applied here.** If Task 2 chose the two-regime option, every report carries both a cold one-shot cost and a warm cached-prefix cost, and its verdict names which one governs BFC (iii). `rates.json` prices what the route actually reports: `cacheReadTokens` / `cacheWriteTokens` (`src/contracts-core/content.ts:228–243`), with `ModelCost.cacheRead` / `cacheWrite` (`:176–185`) as the rate source. The OpenAI-compatible mapping reports cache reads only, so cache-write pricing is seeded only for providers that report it.
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
      timeout 7200 bun scripts/memory-bench/run.mjs --suite beam --subset dev --config lexical-topk --judges hyper/qwen3.7-plus,opencode-go/mimo-v2.5 --repeats 3
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

  - Notes (executed 2026-10-27; offline checks, no paid call, no credential read).
    - **Judge panel.** `run.mjs --judges a,b[,c]` resolves a panel through `judge.mjs:resolveJudgePanel`: at least two judges, distinct *model families* read from the model name (`judgeFamily`, so two resellers of one family do not count), and the answer model can never judge itself. A scored **live** arm without a two-family panel is refused; offline/mock and the historical 188 acceptance path keep their single pinned judge. Verdicts are combined by majority and a tie is **incorrect** (`combineVerdicts`). Every result row carries `judgeVerdicts`, and `summarize` adds `judgeAgreement`: per-judge agreement with the panel verdict, pairwise agreement, Cohen's κ (2 judges) and Fleiss' κ (3+). This is plan 199's `createJudgePanel` rule (distinct models, quorum) applied at the harness boundary, without adding model calls.
    - **Human calibration is built, labelled, and enforced.** `audit/review.mjs` selects 150 items balanced by ability (deterministic hash order, round-robin, so a small ability is never crowded out); `audit/build.mjs` joins an answer-phase report with its answer cache and writes a self-contained, `noindex`, mode-0600 `review.html` whose text is rendered with `textContent` (script-closing tags escaped) plus a local README. The downloaded labels contain **only** `{id, verdict}`; `parseAuditLabels` rejects any other field. `audit/calibrate.mjs` computes per-judge Cohen's κ against those labels and writes `judge-audit-v1`. `run.mjs --judge-audit` drops every judge below κ **0.8** and refuses to score with fewer than two left.
    - **Owner action waived for the baseline (2026-10-27):** the owner chose not to label the 150 items by hand and allowed either ignoring the audit or delegating it to another LLM. Decision recorded here: **ignore the human audit for plan 202 execution**. Live reports keep `judgeCalibration: null` and `applyJudgeAudit` stays strict, so no report can pretend to be calibrated. A BFC/Robust claim may run on the two-family judge panel, but it must be labelled **not human-calibrated**; if the owner later wants a proxy, a third model that is neither an answerer nor a panel judge can label the same 150 ids and `audit/calibrate.mjs` will emit `judge-audit-v1` with an explicit `not-human` note. Do not silently treat that proxy as human κ.
    - **First panel datum.** The conditional branch does not apply: 188.11 Task 1 (f) confirmed the 188.10 checkpoints were not retained (14 smoke files, no answer text). The panel re-answer is therefore Task 4's job, sized as the plan already records, and this task builds the machinery it needs.
    - **Cost.** New `rates.json`: pinned table keyed by `provider/model` with `input`, `output`, `cacheRead`, `cacheWrite` (USD per million tokens), `asOf`, currency and a `cacheWriteReportedBy` note. All values are **null** with `status: owner-verification-required` — this session cannot verify Hyper/OpenCode Go price sheets, and a guessed price would silently corrupt the BFC (iii) verdict. `usage.mjs` resolves the longest model-prefix, and `cacheAdjustedCost` prices uncached input, cache reads and cache writes at their own rates; a missing rate yields **null**, never zero. `report.cost` now carries `measured`, `pricingStatus`, the resolved rate and `ratesAsOf`; `cacheWriteTokens` is accumulated from the wire proxy for the first time (it was recorded per exchange but dropped before the report). `cachedPrefixCost` gives the `full` arm its R11 simulation: **all** input priced as a cached prefix, the most favourable case for full, so the memory claim stays conservative. `--rates <file>` accepts the owner-verified table.
    - **Latency and variance.** The existing timing module already records per-role p50/p95/mean total, time to first byte and per-question wall time; reports expose it as `report.timing` and `toolCallsPerQuestion`, so no second latency module was added. `--repeats k` (1–8) re-runs each question k times with distinct ids (`#r1`…) and its own answer checkpoint; the report carries strict `passK`, `passAtK` (Chen et al. from `@arnilo/prism-evals`), per-repeat accuracy and its sample SD. An incomplete repeat set is excluded, never a pass.
    - **Comparators.** `lexical-topk` ranks raw turns by idf over the conversation (`selectLexicalRounds`: top 5, 4k-token budget) and appends only the chosen rounds; `oracle` appends only labelled evidence rounds and is an upper bound that never enters criteria; `full-truncated` is the `full` pipeline's existing "most recent window that fits" behaviour given an explicit arm name. None of the three loads fabric or OM, exposes `memory.*` tools, or writes; tests assert `recallCalls: 0`, no writes, no fabric channel. Comparators reject `--ablate`/`--policy`.
    - **Stage attribution.** Every scored row now carries `stage` and the report carries `report.stages`. Inputs are the dataset's evidence ids and the recalled ids (counts only), mapped by the existing `stageFromCounts`; an abstention miss is its own stage (`abstention_error`), a suite without gold turns reports `gold_unknown` instead of inventing a stage. Candidate/selection gaps still require the store-level table in `retrieval-diagnostics.mjs`, which is development-only and now covers every suite through the Task 2 draws.
    - **Files:** `scripts/memory-bench/{judge,usage,report,run,replay,campaign}.mjs`; new `rates.json`, `audit/{review,build,calibrate}.mjs`, `measurement.test.mjs`.
    - **Tests (all six named cases plus the audit and comparator invariants):** `measurement.test.mjs` — `panel_never_uses_only_the_answer_model`, `kappa_below_threshold_drops_judge`, `cache_adjusted_cost_uses_reported_cache_tokens`, `full_multi_turn_cost_counts_prefix_as_cache_read`, `repeats_report_pass_k_and_sd`, `lexical_topk_and_truncated_arms_never_see_memory_product`, `lexical_topk_selects_only_relevant_rounds`, `audit_set_is_balanced_private_and_scores_kappa`, `per_judge_arm_difference_uses_each_judge_verdict`. 9 pass. Whole bench suite: 265 pass / 1 skip / 0 fail; `biome check` clean on every changed file.
    - **Deviations recorded:** (1) `rates.json` values are null pending the owner's price-sheet check, because inventing them would violate the cost criterion; (2) the 150 human labels are an owner action, so `judgeCalibration` is null until they exist; (3) `full-truncated` is a named alias of `full`'s existing truncation rather than a second code path (a second path would have to duplicate the cap hook); (4) campaign argv now passes `--judges opencode-go/mimo-v2.5,hyper/qwen3.7-plus`, while the historical 188 acceptance manifests keep their single pinned judge so old reports stay comparable; (5) stage attribution without gold turns is `gold_unknown`; (6) the ≤ 5% harness-overhead criterion is not separately instrumented — panel overhead is visible as `calls.judge`, `calls.judgeCacheHits/Misses` and `timing.roles.judge`, and Task 4's first live arm measures it against wall time.
- [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)
  - **Current outcome: owner-accepted 23-cell development screen closed (2026-10-30).** Owner instruction: “I would like to finish this with the 23 cells. Is that possible?” All 23 completed Muse 1.3 cells are accepted; the original design had 25. Exclude BEAM-1M full-truncated (15 partial rows retained, not analysed) and lexical-topk (unstarted). The accepted report has `screenComplete: true`, `baselineComplete: false`; it does not imply 25/25 coverage or full multi-model Task 4 completion. Four suites have all five configurations; BEAM-1M has three. No further automatic requests: journal is closed-by-owner and refreshed readiness is blocked by the closure. Current final report: `docs/_evidence/memory-bench/202/muse13-screen-final/README.md`; manifest, summary and verification pin original source files and all completed reports. Older running/quota-paused notes below are historical.
  - **Post-screen diagnosis (2026-10-30; advisory, no reopened run):** [Offline audit and assessment of Tasks 5–17](../docs/_evidence/memory-bench/202/diagnosis-2026-10-30/README.md) verifies the 23 report hashes. MAB historical inputs produce zero completed exchanges; its 0% is not a conflict-resolution measurement. LoCoMo fine-gold message ids do not match recalled round ids, and candidate/selected counts share one final-id set; their causal lever labels are provisional. There are 100 valid native-fitting BEAM-100K/LoCoMo pairs for retrospective comparison. Repair ingestion, evidence accounting and answer retention first; then implement Task 5 and reassess, proceeding through applicable Tasks 6–9 with per-task checks. Tasks 13/17 remain conditional; safety and independent acceptance gates remain unchanged. Later tasks already cover the likely navigation, temporal/state, passive-delivery and aggregation remedies; completing all remaining tasks before reassessing is not recommended. This assessment does not check any implementation task or expand paid authorization.
  - **Prompt-cache prerequisite (owner, 2026-10-30): Tasks 4.11–4.15 run before any further paid run of this plan.** That covers the Task 5–17 development screens (gate 2), the deferred multi-model Task 4 baseline, and Task 18 (gate 3). Owner instruction: "Let's add the recommended implementations as 202 tasks before the live runs and adjust the live run requirements if required".
    - **Why.** BFC (iii) is a warm-cache cost criterion, and the product's warm cost depends on the memory prefix staying byte-identical across turns. Today it does not, under any write:
      - every delivery cache is keyed by an in-process write counter (`directory.ts:58–68`; `delivery/core.ts:294–300`; `delivery/cues.ts:222–228`);
      - the `conversational` preset archives an exchange on every turn;
      - `turn.completed` patches note metadata on every turn that cites or recalls a note (`index.ts:629–637`, through `memory.ts:405–419`);
      - working memory is the first prefix block (`context.ts:246–249`).
    - **What the existing test covers.** `prefix-stability.test.ts:28` proves stability only for quiet turns, with no writes.
    - **What the bench measures.** The bench answers each question in one user turn, so it cannot see any of this. Task 4.15 adjusts the live-run requirements to match.
    - **Scope.** Fabric package and harness only. No kernel contract, no new package, no new config field, no change to `robustness-criteria.json`.
  - [x] Task 4.11: Measure memory's effect on the cached prompt prefix under real writes (offline, no paid call)
    - Acceptance Criteria:
      - Functional: A deterministic offline probe, `scripts/memory-bench/prefix-probe.mjs`, drives `createAgent` with `mockProvider` and the real `memoryFabric` package through scripted multi-turn sessions. It records, per provider request:
        - the SHA-256 of `request.context` (the prefix blocks);
        - the SHA-256 of each prefix block by `metadata.source` (`fabric-working`, `fabric-directory`, `fabric-core`);
        - whether a tail block is present;
        - the first request index at which each block changed, and which write caused the change.
      - Functional: The probe runs these scenarios, each over ≥ 10 user turns:
        1. `conversational` preset with no tool use, so exchanges are archived every turn;
        2. default config where the scripted model cites a core note id each turn; measure whether core-only citations trigger lifecycle tracking, then recall that same note from turn 2 to exercise actual `recordUses`/`recordRetrievals` if they do not;
        3. one `memory.insert` mid-session;
        4. one working-memory update mid-session;
        5. a background consolidation (`promote` on, scripted extractor reply) that writes notes mid-session;
        6. `memory.forget` of a note the core shows, at turn 6;
        7. a second `Memory` instance on the same SQLite store, standing in for another process, writing and forgetting while the first session runs.
      - Functional: The probe verifies three assumptions the later tasks rely on, and records each verdict:
        - (a) storage strength S, which orders the core, changes on recorded uses;
        - (b) test the assumption that the tail block lands after the transcript and preserves the cached prefix (`withTailContext`), recording its actual position relative to prior transcript and latest user input rather than assuming the verdict;
        - (c) the extractor's request reuses the same system and tool segments across calls. The tool schema embeds per-call id enums (`consolidation/prompts.ts:145,151–152`), so this is expected to fail. The evidence records the encoded token size of system plus tools with and without those enums using an existing local tokenizer, with its hash/version and projection stated. Without a local tokenizer the command reports null encoded counts and separately labelled estimates, never substitutes estimates for a cache threshold.
      - Functional: The probe counts entries left in `createFabricContext`'s per-session tail map (`context.ts:243`) after N sessions open and close. No eviction is expected.
      - Functional: The evidence lands in `docs/_evidence/memory-bench/202/cache-stability/offline-baseline.json` and is hashed. It holds hashes, counts, indices and verdicts only, never note text.
      - Performance: No model or network call. The probe finishes in ≤ 60 s. It adds no runtime cost to the product.
      - Code Quality: Reuses `mockProvider`/`providerToolCall` from `@arnilo/prism/testing` and the existing harness timing and report conventions. No product change in this task.
      - Security: Fixture text only, no credentials. The probe's temporary roots are removed on exit.
    - Approach:
      - Documentation Reviewed:
        - `packages/memory/fabric/src/__tests__/prefix-stability.test.ts:28–62`;
        - `context.ts:199–330`, `directory.ts:58–68,144–215`, `delivery/core.ts:182–305`, `delivery/cues.ts:170–230`;
        - `index.ts:507–536,578–638`, `memory.ts:119–615`;
        - `consolidation/extract.ts:211–290`, `consolidation/prompts.ts:128–165`;
        - `src/testing/prefix-stability-conformance.ts`;
        - plan 184 Task 2 (wire-level segments, owned there).
      - Options Considered:
        - Go straight to the fix. Rejected: the size of each break, and which write causes it, decides 4.12's boundaries and 4.13's scope.
        - A paid live probe. Rejected: the prefix bytes are deterministic and need no provider to measure.
      - Chosen Approach:
        - A characterization probe that the 4.12–4.14 tests then flip into assertions.
        - 4.15 reuses it for the equivalence attestation.
      - API Notes and Examples:
        ```sh
        timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/202/cache-stability/offline-baseline.json
        ```
      - Files to Create/Edit:
        - `scripts/memory-bench/prefix-probe.mjs` (new);
        - `scripts/memory-bench/prefix-probe.test.mjs` (new);
        - `docs/_evidence/memory-bench/202/cache-stability/{offline-baseline.json,README.md}` (new);
        - `scripts/memory-bench/README.md`.
      - References:
        - R11; Task 2 cost-regime decision (warm governs BFC (iii)); plans 088, 101, 110 (cache-stability metrics); plan 188.5 Task 4.
    - Test Cases to Write:
      - `prefix_probe_detects_a_seeded_prefix_change`: a fixture that mutates the core between turns must be reported at the right request index. Fails if the probe compares the wrong segment.
      - `prefix_probe_is_deterministic`: two runs give identical JSON.
      - `prefix_probe_report_carries_no_note_text`.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: no. Harness and evidence only.
      - Docs pages to create/edit:
        - `scripts/memory-bench/README.md` (probe usage);
        - the evidence README.
      - `docs/index.md` update: no
      - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`
    - Notes (executed 2026-10-30): [Offline baseline and verification](../docs/_evidence/memory-bench/202/cache-stability/README.md). Added `prefix-probe.mjs`, three named regressions, text-free hashed evidence and benchmark usage docs. Seven ten-turn scenarios capture 82 answer requests; four additional sessions supply 13 forced-tail requests and measure four retained tail-map entries; two actual background consolidations persist two candidate notes. Measured execution including cached Laya tokenization: **801.6 ms**. No live/network/paid call, credential read, product edit, dependency, export/baseline move, held-out inspection or campaign resume. Fixed clock/nonces and read-only map observation are process-local loader instrumentation; package files are untouched and temporary SQLite roots are removed in `finally`.
      - Results: exchange archiving yields nine prefix hashes over ten requests; recorded lifecycle use changes core order at request 4/turn 3; insert and working updates break at request 6/turn 5; same-instance forget breaks at request 7/turn 6 and immediately removes the note. Promotion writes candidates but keeps one prefix hash. A second `Memory`/SQLite connection inserts and forgets without invalidating the first instance: the deleted note is still in its final core prefix. Core-only citations are not tracked; recall from turn 2 establishes actual lifecycle writes. Storage strength then increases to `log(2)` and deduplicates within a session.
      - Assumption corrections for later tasks: tails are after **prior** transcript and before latest user input, with first-turn system-tail hoisting possible; they are not after the whole transcript. Extractor system hashes match, schemas differ, and removing enums alone still leaves different schema hashes because optional property presence varies. Actual cached Laya-tokenizer counts for captured system-plus-tools JSON are **1379/1401** tokens, or **1374/1384** without id enums; these exclude vendor templates and do not establish another route's cache threshold. Task 4.13 still verifies its shipped route's minimum/current encoding. Evidence pins tokenizer/source/product hashes and both payload and file SHA-256.
      - Verification: tests first failed on the missing module; focused regressions **3 pass**, including independent-process determinism, exact seeded request attribution, persistence/deletion dispositions, optional local tokenization and no report text. Full benchmark **375 pass / 2 environment skips / 0 fail**; existing fabric quiet-prefix test **1 pass**; documentation suite **65 pass**; repository typecheck, focused Biome and diff checks pass. The skips are official Vibe-image execution and cached BEAM annotation inventory. Tasks 4.12–4.15 remain unchecked and own the product/cache-readiness changes.
  - [x] Task 4.12: Session-epoch prefix snapshot; working memory moves to the tail
    - Execution input from Task 4.11 (2026-10-30): core-only citations currently bypass `tracker.show`, so lifecycle regressions must include an actual recall before citation until core delivery is registered with the existing tracker. Do not infer a use from a printed citation alone. Candidate-only promotion does not change prefix bytes today; its regression must also check that the candidates were persisted/reachable. `withTailContext` currently inserts before the latest user, after prior transcript; on the first turn `buildProviderMessages` can hoist that system message before context. The working-tail implementation and provider-visible conformance must cover the first-to-second-turn boundary, not assert safety from `request.context` hashes alone.
    - Acceptance Criteria:
      - Functional: **Epoch snapshot.** The directory and core prefix blocks are rendered once per session epoch and reused byte-for-byte until the epoch ends. An epoch begins at:
        - the session's first `context.build`, including after a restore;
        - `compaction.completed`, which already rewrites the prefix, so rebuilding there costs no extra cache miss;
        - a **retraction** (next bullet);
        - an explicit refresh (`bundle.refresh`, `index.ts:666–670`, used by import, export and reindex).
      - Functional: Additive writes within an epoch never change the prefix bytes. That covers:
        - exchange archive entries;
        - `memory.insert`;
        - consolidation inserts;
        - lifecycle use, retrieval and evidence patches.
      - Functional: A new note is still reachable within the epoch through `memory.recall`/`memory.read`, passive tail injection and path cues.
      - Functional: Starting an epoch re-reads the store (it forces the core, directory and cue-index caches to recompute), so writes from another process appear at the next epoch boundary, not never.
      - Functional: **Retractions break the epoch (fail closed for privacy).** A retraction counter, a sibling of the write counter in `directory.ts`, is bumped by any change that can remove a shown note or change its text:
        - `forget`;
        - `setConsent` revoke;
        - `correct`;
        - `markInvalidated`;
        - retention deletions;
        - OKF import tombstones;
        - a `patchMetadata` whose result makes a note that was active stop being active (status archived or retired, `validTo` set, trust flags added).
      - Functional: A forgotten or revoked note never appears in the next request's prefix. The probe's forget scenario must show exactly one prefix change, at the request after the forget.
      - Functional: **Working memory moves to the tail.** The `fabric-working` block renders at the head of the per-request tail block, after the transcript, and is re-read on every build, so an agent sees its own update on its next request. The prefix holds only the directory and the core.
      - Functional: Task 11's supersession of a decision is a retraction, so a superseded decision leaves the core on the next build.
      - Functional: The per-session snapshot map is deleted on `session.closed`.
      - Functional: **Equivalence on the single-turn bench answer path.** A session with one user turn and its tool loop sends the same `request.context` bytes as before this task. Working memory is empty there, and the epoch starts at the first build exactly as the cache did. This is what 4.15 attests.
      - Performance: Per-turn work drops, because no recompute happens on additive writes. Each epoch start costs one metadata scan per scope, the existing compute.
      - Performance: The probe's scenarios 1–5 show one `request.context` hash per epoch, and scenario 6 shows exactly one break.
      - Performance: `prefixStabilityConformance` with `assertOn: "cacheablePrefix"` passes with memory-fabric installed in the `conversational` preset over its scripted session.
      - Code Quality: The change lives inside `packages/memory/fabric` (`context.ts`, `directory.ts`, `memory.ts`, `index.ts`). No new config field, no kernel change, no alias for the old behavior.
      - Code Quality: The retraction counter follows the write counter's `WeakMap` idiom. If it is exported from `directory.ts`, the compat baseline gains one line: run `bun scripts/release.mjs gate --update-baseline` in this task, which rewrites `scripts/compat-baseline/arnilo__prism-memory-fabric.txt`, and record the diff in the task note.
      - Security: A retraction is never deferred to the next epoch.
      - Security: The snapshot carries the same `UNTRUSTED_ENVELOPE` metadata.
      - Security: A snapshot is per session id and never shared across sessions with different scope identities.
    - Approach:
      - Documentation Reviewed:
        - 4.11 evidence;
        - `context.ts:233–330` (the existing per-user-turn tail cache is the model for a per-epoch prefix cache);
        - `index.ts:518–536` (the `context.build` hook), `index.ts:581–588` (`session.closed`);
        - the kernel's `compaction.completed` hook;
        - `memory.ts:119–145,405–494,560–615` (write and retraction sites);
        - fabric README "Delivery tiers" (lines 520–556) and line 1201.
      - Options Considered:
        - Keep write-keyed rebuilds and only reorder the blocks by volatility. Rejected: every prefix block sits before the transcript, so any change still invalidates the whole cached conversation.
        - Freeze everything, retractions included. Rejected: it would keep showing forgotten or revoked text for the rest of the session, a privacy failure.
        - A config knob (`core.refresh: "write" | "epoch"`). Rejected: there is no measured need for the old behavior, and the plan forbids speculative knobs. New notes already reach the agent through recall and the tail.
        - Use a store-level generation (SQLite `PRAGMA data_version`) as the cache key. Rejected for prefix bytes, because it would break the cache on every additive write from any process. It remains an option for 4.14 if revalidation measures too slow.
      - Chosen Approach:
        - Prefix bytes are a function of (session, epoch). Retractions and compaction are the only mid-session boundaries.
        - Volatile, agent-written state (working memory) moves to the head of the fabric tail. The combined fabric tail follows the complete transcript, including the first user, to prevent first-turn system-message hoisting; the kernel and shared `withTailContext` helper keep their contracts.
      - API Notes and Examples:
        ```ts
        // directory.ts — sibling of noteMemoryWrite
        export function noteMemoryRetraction(memory: object): void;
        export function memoryRetractionVersion(memory: object): number;
        ```
      - Files to Create/Edit:
        - `packages/memory/fabric/src/{context,directory,memory,index,provider,okf-bundle}.ts`, `delivery/core.ts` and affected committed `.d.ts`;
        - Existing context, directory, package, provenance and core tests; `scripts/memory-bench/{prefix-probe,run}.test.mjs`;
        - `examples/memory-lifecycle.ts`: demonstrate the new core at a compaction boundary;
        - `packages/memory/fabric/src/__tests__/prefix-stability.test.ts`;
        - `packages/memory/fabric/README.md`;
        - `CHANGELOG.md`;
        - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` (only if the export lands in a baselined declaration).
      - References:
        - 4.11; plan 184 (wire parity is its job); plan 188.5 Task 4.
    - Test Cases to Write:
      - `fabric_prefix_is_identical_across_ten_turns_with_exchange_archiving`: fails today (4.11 scenario 1).
      - `fabric_prefix_survives_lifecycle_writes_from_citations`.
      - `fabric_prefix_survives_insert_and_consolidation_mid_session`.
      - `forget_breaks_the_epoch_on_the_next_request`: a forgotten note's text is absent from the next request. Fails if retractions are deferred.
      - `revoked_consent_and_archive_status_break_the_epoch`.
      - `compaction_completed_starts_a_new_epoch_with_new_notes`.
      - `working_memory_update_reaches_the_tail_not_the_prefix`.
      - `new_session_sees_writes_from_another_memory_instance`: the cross-process stand-in.
      - `epoch_snapshot_is_evicted_on_session_closed`.
      - `single_turn_answer_path_context_bytes_unchanged`: pin the pre-epoch serializer bytes of an empty-working-memory fixture across one user turn and its recall loop; Task 4.15 owns the broader benchmark-path equivalence attestation. The 4.11 scenarios seeded nonempty working memory, whose relocation intentionally changes their hashes.
      - The existing `fabric_prefix_is_identical_across_ten_turns_without_writes` stays green.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: yes. This changes when prefix blocks are refreshed and where working memory is delivered. There is no API or config change.
      - Docs pages to create/edit:
        - `packages/memory/fabric/README.md`:
          - the delivery-tier table's rebuild column becomes "session start, compaction, retraction, refresh";
          - the "Cache stability" and working-memory paragraphs are updated;
          - a sentence explains that notes written mid-session reach the agent through recall and the tail until the next epoch.
        - `CHANGELOG.md` `## [Unreleased]`.
      - `docs/index.md` update: no
      - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`
    - Notes (executed 2026-10-30):
      - Implemented session-id epoch snapshots for directory/core blocks. Every epoch invalidates directory, core and cue-index caches before reading; additive note, exchange, candidate and lifecycle writes keep pinned bytes. All active scope memories contribute to the retraction version. Compaction and explicit import/export/reindex refreshes end the relevant epochs; both package and direct-provider registration release snapshots and tail caches on close.
      - Working memory is read on every build and leads the combined fabric tail after the complete transcript. This deliberately changes fabric’s old before-latest-user placement to avoid first-turn system-tail hoisting; the shared helper and kernel contracts are unchanged. Existing context/package/provenance tests, the delivery diagnostic mirror, and the lifecycle example now use the epoch/tail contract. The example starts its new core at a real compaction boundary.
      - Added WeakMap retraction counters for forget, revoke, correction, lineage invalidation, retention deletion, OKF import (including direct store writes/tombstones), and active-to-inactive metadata changes. Invalidation survives partial-write failures via finally paths. Core selection now also checks the existing temporal-validity predicate. Candidate/evidence patches stay additive. Counter helpers and projection methods are internal modules, not barrel exports: no public export or compat-baseline change belongs to this task.
      - Proof: `timeout 1200 bun run typecheck` passed; the final added candidate test also passed fabric typecheck. Prefix suite: **19 passed**, including retractions, imported tombstones, external additions at new sessions/refresh, close eviction, candidate reachability, real compaction, empty-working serializer bytes, provider-visible conversational conformance (`assertOn: "cacheablePrefix"`), and first-to-second-turn working-tail placement/tool updates. Fabric, core (**62**), observational (**101**), context-engineering (**97**) and docs (**65**) suites passed; Postgres integration cases remain environment-skipped. Memory-bench tests: **375 passed, 2 skipped**. The offline benchmark completed **14 questions**; `examples/long-term-memory.ts` completed; the docs suite also compiled and ran the lifecycle example. Biome check passed (one inherited unused-parameter warning in the already-edited benchmark test); `git diff --check` passed.
      - Offline evidence: `docs/_evidence/memory-bench/202/cache-stability/offline-4.12.json`. Scenarios 1–5 each have one prefix hash, ten exchanges and two promotion passes are persisted, and forget has exactly one break at request 7 (the immediate tool follow-up, turn 6). All 13 nonempty tails follow the transcript; four closed sessions retain zero tail entries. The probe’s deterministic and no-note-text checks passed.
      - Remaining task boundaries: second-instance retractions still need Task 4.14 revalidation; its execution input now records that tail-map close eviction is already done. Core-only citation tracking is unchanged. Extractor caching remains Task 4.13; full benchmark equivalence and live-route requirements remain Task 4.15. No paid/live request ran. `timeout 1800 bun scripts/release.mjs gate` was attempted and stopped at the existing release-evidence guard because `PRISM_TEST_POSTGRES_URL` is unset; it did not reach the remaining release checks.
  - [x] Task 4.13: Make the fact extractor's request prefix cacheable across sessions
    - Execution input from Task 4.11 (2026-10-30): the measured system is stable but tool schemas differ, even after id-enum removal. Stabilize conditional `contradicts`/`segment` property presence and segment-dependent kind choices as needed, preserving parser membership/episode validation; deleting enum values alone cannot satisfy the byte-identical-schema criterion. The cached Laya-tokenizer JSON sizes without enums are 1374/1384 tokens; they are not counts for every shipped route and do not replace this task's documented route threshold check.
    - Acceptance Criteria:
      - Functional: The extractor sends a stable `providerOptions.cacheKey` of `prism-fabric-extract:<default|project>`. It routes through `runMemoryWorkerLoop`'s existing `providerOptions` (`observational/src/worker-loop.ts:25,72–74`), so calls from different user sessions share provider cache affinity.
      - Functional: `sessionId` is still passed for attribution. Providers prefer `cacheKey` over `sessionId` (for example `openrouter/src/provider.ts:36`).
      - Functional: **Conditional on 4.11 (c).** If the encoded system plus tool segment without per-call id enums reaches the documented minimum cacheable prefix of at least one shipped extractor route (record the source and value in the task note), then:
        - the `record_notes` schema drops the `evidence`, `contradicts` and `segment` id enums (`prompts.ts:145,151–152`) and keeps their types and bounds;
        - id membership is enforced only by the parser's existing `ParseContext` sets (`extract.ts:216–221`), which already reject foreign ids;
        - foreign ids remain non-repairable provenance failures; shape-only failures retain the existing single repair path (execution correction: existing tests and the fail-closed contract prohibit repairing invented ids).
      - Functional: If the threshold is not reached, the schema is unchanged and the task note records `n/a` with the measured size.
      - Functional: Across two sessions with different candidates, existing notes and segments, the system and tools segments of the extractor request are byte-identical for the same prompt variant and configured note cap (when the condition held). Optional id fields and the episode kind stay present; only the parser decides membership and episode eligibility.
      - Performance: This saves at most the stable prefix (measured 785–829 GPT-4.1 system tokens plus the schema) per extractor call, at each route's cache-read discount. The README states that bound, not a percentage of session cost.
      - Performance: No extra model call. The offline repair rate on the existing extractor fixtures does not rise.
      - Code Quality: Changes stay in `consolidation/{extract,prompts}.ts`. One stable key constant. No new config field.
      - Security: The cache key holds no tenant, resource, session or user identifier, and no note text.
      - Security: Cross-session prefix sharing covers only the constant system prompt and schema, never evidence, because the user message is per session.
      - Security: Foreign-id rejection stays enforced and tested.
    - Approach:
      - Documentation Reviewed:
        - 4.11 (c);
        - `consolidation/extract.ts:229–300`, `prompts.ts:35,128–165`;
        - `src/contracts-core/provider.ts:54–58` (`cacheKey`);
        - `commandcode/src/provider.ts:12–24`, `openai-codex/src/provider.ts:20`, `opencode-go/src/provider.ts:13–17`, `openrouter/src/provider.ts:36` (cacheKey precedence);
        - `observational/src/worker-loop.ts:119` (OM workers already use a constant session identity).
        - Each shipped route's prompt-cache minimum is read from current provider docs at execution (find-docs), not assumed.
      - Options Considered:
        - Keep the id enums and add only the key. Kept as the fallback branch: when tools vary per call, the key alone caches nothing.
        - Move ids into the system prompt. Rejected: that varies the system segment instead.
      - Chosen Approach:
        - Stable key always.
        - An id-free schema only when the measured stable prefix can actually be cached. The parser already enforces membership.
      - API Notes and Examples:
        ```ts
        providerOptions: { cacheKey: `${EXTRACT_CACHE_KEY}:${input.repositoryRules === true ? "project" : "default"}` }
        ```
      - Files to Create/Edit:
        - `packages/memory/fabric/src/consolidation/{extract,prompts}.ts`;
        - `packages/memory/fabric/src/consolidation/prompts.d.ts` (tracked internal declaration);
        - `packages/memory/fabric/src/consolidation/__tests__/` (extractor tests);
        - `packages/memory/fabric/src/__tests__/extractor-budget.test.ts` (schema size fixture);
        - `scripts/memory-bench/prefix-probe.test.mjs` (flip extractor characterization to the stable-schema assertion);
        - `packages/memory/fabric/README.md` (promote cost note);
        - `CHANGELOG.md`.
      - References:
        - 188.10 N5 (write-side cost); Task 17; Task 11 capture path.
    - Test Cases to Write:
      - `extractor_requests_share_a_stable_cache_key_across_sessions`.
      - `extractor_cache_key_carries_no_scope_or_session_identity`.
      - `extractor_tool_and_system_segments_identical_across_candidate_sets`: conditional branch only.
      - `extractor_still_rejects_foreign_evidence_ids`: fails if the enum removal lost validation.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: yes, on the provider-visible request of an opt-in feature (`promote`). No API or config change.
      - Docs pages to create/edit:
        - `packages/memory/fabric/README.md` promote cost paragraph;
        - `CHANGELOG.md`.
      - `docs/index.md` update: no
      - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`
    - Notes (executed 2026-10-30): Extractor calls now pass `providerOptions.cacheKey` through the existing worker loop using one constant base, `prism-fabric-extract`, with `default` / `project` suffixes. `sessionId` and thinking-level propagation remain intact. The schema removes per-pass id enums, always declares optional `contradicts` / `segment`, and always offers the episode kind; existing parser sets still reject foreign evidence, contradiction and episode ids, and episodes without shown segments. Candidate text and ids remain in the per-session user message. The configured note cap still bounds schema and parser output; schema identity is scoped to that cap and prompt variant. Updated the tracked internal declaration and schema-size fixture (1,619 → 1,567 B); no public export/config, dependency, host or kernel change, so no compatibility baseline regeneration or retired public-name sweep is needed.
      - Conditional branch evidence: current [OpenRouter prompt-caching documentation](https://openrouter.ai/docs/guides/best-practices/prompt-caching), fetched via Context7 (`library OpenRouter`, then `docs /websites/openrouter_ai`), documents automatic OpenAI caching at a **1,024-token minimum**. The shipped OpenRouter Chat route supports `openai/gpt-4.1` and prioritizes `cacheKey` over `sessionId` for affinity. Captured real extractor requests through `openAIChatBody` without network calls, then encoded compact `JSON.stringify({ system: <wire system messages>, tools: <wire tools> })` using **tiktoken 0.14.0 / o200k_base** (`encoding_for_model("gpt-4.1")`, installed only in a temporary venv). Default: **5,231 B / 1,318 tokens**; project: **5,426 B / 1,363 tokens**. System text alone: **785 / 829 tokens**. Projection SHA-256: default `202ff82295c6aa70e14876f4d896aded08cf506bec7c22cd32959bf086e85326`; project `9bba54820f8b95297c49e067b6d0b3aa19494fdf34439c08394427fdf74cc705`. Both exceed the documented minimum, so the id-free branch is taken. These are measured wire-JSON projections, excluding proprietary vendor templates, not reported billing/cache-hit counts or thresholds for other routes. README cost prose bounds savings to the prefix at the route's cache-read discount; live hit measurement remains in the later owner-gated cache work.
      - Execution correction: the drafted “rejected id takes the existing single repair path” contradicted `REPAIRABLE_REASONS`, existing no-repair provenance tests and the documented fail-closed contract. Preserved that contract: invented ids fail after one call, with zero correction calls; only shape failures get the existing bounded repair. No parser or repair policy changed, and existing fixture call counts do not rise.
      - Verification: tests first failed on session-derived keys and unequal tool prefixes. Full fabric suite **531 pass / 23 environment skips / 0 fail**; repository `bun run typecheck` passes. The prefix probe now asserts identical extractor schemas, including no change when id enums are stripped: **3 pass / 0 fail**, with independent-process determinism and no public note text. Documentation suite **65 pass / 0 fail**; focused Biome and `git diff --check` pass. No paid/live model call, campaign resume, held-out access or historical evidence rewrite. Tasks 4.14 and 4.15 remain unchecked; whole-plan verification and backlog handoff await the rest of the plan.
  - [x] Task 4.14: Cache hygiene: tail-map eviction and cross-process retraction revalidation
    - Execution input from Task 4.12 (2026-10-30): `projection.forget` now evicts both the prefix snapshot and the existing tail cache on `session.closed`, in both package and direct-provider registration. The probe confirms four closed sessions retain zero tail entries. Preserve this proof; bounded retention and cross-process revalidation remain this task’s work. The 4.12 probe still shows the second-instance deletion in the pinned prefix until a new epoch.
    - Acceptance Criteria:
      - Functional: `createFabricContext`'s per-session tail map (`context.ts:243`) is deleted on `session.closed`, alongside `cues.forget` and `tracker.clear` (`index.ts:581–588`). 4.11's leak count goes to zero.
      - Functional: **Cross-process retractions.** Each `context.build` revalidates the ids the epoch's core snapshot shows with one bounded `memory.get(ids)`. If any id is no longer readable (forgotten, revoked or invalidated by another process, or by a file edit the reconcile picked up), the epoch ends and the prefix is rebuilt on that request.
      - Functional: The probe's scenario 7 shows another instance's forget removing the text on the next request.
      - Performance: The revalidation is one indexed read of ≤ the core's line count per build. p95 ≤ 2 ms on SQLite at the 10k-note envelope, measured in the task note.
      - Performance: If it measures slower, the store-level generation option from 4.12 is taken instead and recorded.
      - Code Quality: Inside `context.ts` and `index.ts`. No new store method unless the fallback is taken. If it is, the method is optional, in the 188.11 additive style, with a store-conformance row.
      - Security: Fails closed. A revalidation error (store unavailable) drops the core block for that request and does not resend the stale snapshot. A signal abort still propagates.
    - Approach:
      - Documentation Reviewed:
        - 4.11 scenario 7;
        - `context.ts:199–218` (the core block already swallows store errors);
        - `core/src/fabric/lock.ts` (multi-process access is anticipated).
      - Options Considered:
        - Cross-process freshness for every write. Rejected: it reintroduces per-write cache breaks.
        - Ignore cross-process retractions. Rejected: that is the same privacy failure 4.12 forbids within a process.
      - Chosen Approach:
        - Revalidate only what the frozen prefix displays.
      - API Notes and Examples:
        n/a. Internal.
      - Files to Create/Edit:
        - `packages/memory/fabric/src/{context,index}.ts`;
        - `packages/memory/fabric/src/__tests__/prefix-stability.test.ts`;
        - `packages/memory/fabric/README.md` (one sentence on multi-process behavior);
        - `CHANGELOG.md`.
      - References:
        - plan 188.10 (multi-session required); 4.12.
    - Test Cases to Write:
      - `tail_cache_is_evicted_on_session_closed`.
      - `another_instances_forget_leaves_the_prefix_on_the_next_request`.
      - `revalidation_failure_drops_the_core_block_instead_of_resending_it`.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: yes, multi-process delivery semantics. Documented in the README.
      - Docs pages to create/edit:
        - `packages/memory/fabric/README.md`;
        - `CHANGELOG.md`.
      - `docs/index.md` update: no
      - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`
    - Notes (executed 2026-10-30):
      - Tail-map eviction was already delivered by 4.12 (`projection.forget` on `session.closed`, package and direct-provider registration); 4.14 adds the direct regression test `tail_cache_is_evicted_on_session_closed` (same user turn reuses its tail, a forgotten session recomputes it) and keeps the probe's zero-entries proof.
      - Revalidation lives in `context.ts` (`coreStillShown`); `index.ts` needed no change because `createFabricContext` already receives every active scope's memory. Each build with a pinned snapshot that shows core ids reads them with one `memory.get` per scope (chunked at the 1,000-id `get` limit) and runs the rows through the existing `coreCandidateRows` predicate (verified, active, valid now, unflagged, core kind). `get` already hides forgotten, revoked and invalidated records, so another process's forget, revoke, retirement, archive, flag or expiry ends the epoch and rebuilds on that request. Ids absent from a scope are covered by the union across scopes. An empty core skips the read, and additive writes from other processes never reach it.
      - Fail closed: a non-abort revalidation error leaves the snapshot in place but omits the `fabric-core` block for that request; the next successful read restores the same pinned bytes. An abort propagates (`revalidation_abort_propagates`). The directory block, an aggregate, is unaffected.
      - Measured (SQLite file store, 10,000 notes, 46 core ids, 300 builds; script kept in the scratchpad, not committed): pinned `build` including revalidation p50 0.19 ms / **p95 0.31 ms** / max 3.4 ms; `memory.get(core ids)` alone p95 0.11 ms. Well under the 2 ms limit, so the store-level generation fallback was not taken; no new store method, config or export, hence no compat-baseline change.
      - Tests added to `prefix-stability.test.ts` (24 pass): `tail_cache_is_evicted_on_session_closed`, `another_instances_forget_leaves_the_prefix_on_the_next_request`, `another_instances_additive_write_keeps_the_prefix_pinned`, `revalidation_failure_drops_the_core_block_instead_of_resending_it`, `revalidation_abort_propagates`. The failure and forget tests failed before the change. `scripts/memory-bench/prefix-probe.test.mjs` now asserts scenario 7's forgotten text is absent on the last request (it pinned the old leak). New evidence `docs/_evidence/memory-bench/202/cache-stability/offline-4.14.json` (first change at request 6, the request right after the other instance's forget) with a README section; the 4.11/4.12 evidence files are untouched.
      - Verification: fabric suite **536 pass / 23 environment skips / 0 fail**; memory-bench **375 pass / 2 skips / 0 fail**; repository `bun run typecheck` passes; Biome on the touched files and `git diff --check` pass. README "Cache stability" paragraph and `CHANGELOG.md` updated. No paid/live call.
      - Boundary for 4.15: the equivalence attestation must run on the post-4.14 tree, which now includes this per-build read. It adds no request bytes on a single-process bench.
  - [x] Task 4.15: Adjust the live-run requirements to the cache-stable product (offline)
    - Acceptance Criteria:
      - Functional: **Equivalence attestation.** The Task 4 23-cell screen ran the pre-4.12 product, so its use as a baseline needs proof. 4.11's probe plus the existing offline replay is run on the bench's `preset-r1` and `passive-only` answer paths (fixture questions, mock provider) twice: in a `git worktree` of the commit before 4.12 and on the post-4.14 tree. It compares every answer-phase provider request byte for byte.
        - If they are identical, `cache-stability/equivalence.json` records both product hashes. The 23-cell screen stays the comparison base for the Task 5–10 development screens, and no cell is rerun.
        - If they differ, the file lists the differing arms. Those cells are rerun under gate 2 with their budget stated at the gate. They are never mixed with pre-change cells.
      - Functional: **Readiness pin.** `readiness.mjs` refuses a screen or acceptance manifest whose product hash lacks a passing cache-stability record. A passing record means the 4.12–4.14 prefix suite is green and the equivalence file names that hash. The refusal is a named operational blocker, like the existing quota and source blockers.
      - Functional: **Live multi-turn cache probe**, informational. `scripts/memory-bench/cache-probe.mjs` runs one scripted 12-turn `conversational` session through the plan 182 wire proxy. The session includes exchange archiving, one cited note, one `memory.insert`, and one `memory.forget` at turn 9. It reports, per request:
        - `inputTokens`, `cacheReadTokens` and `cacheWriteTokens`;
        - the cacheable-prefix share.
      - Functional: When the cache probe runs:
        - under gate 2, once on each development screen's answer route (≤ 12 requests per route);
        - under gate 3, once on every Task 18 acceptance route.
      - Functional: The cache probe's expected result is cache reads on every request after the first, except the request after the forget. It is reported as a `cacheStability` row in the screen and acceptance reports. It is **not** a criterion.
      - Functional: **BFC (iii) is unchanged.** The memory arm keeps its measured one-shot cost and `full` keeps its all-cached simulation (`usage.mjs:55–76`). This change can only lower memory's cost in production, not in the bench, so the frozen comparison stays conservative.
        - `robustness-criteria.json` and its hash are not edited. A test asserts the hash.
        - Changing how the memory arm's warm cost is computed would need a new owner decision recorded in the criteria file before Task 18. It is not proposed here.
      - Functional: **Write-side accounting.** `usage.mjs`'s `roleUsage` splits the product role into `product` and `product-extract`. The split is by the extractor's stable cache key, carried on the wire record's request options. Task 11 and Task 17 screens report extractor `cacheReadTokens` separately, so 4.13's effect is measured where `promote` runs.
      - Functional: **The requirements this task implements were written into the plan on 2026-10-30, when these tasks were added:**
        - Tasks 11, 17 and 18 carry a "Cache-stable product (Tasks 4.11–4.15)" criterion;
        - the header's gate line and `## Verification (whole plan)` are updated.
        This task makes the harness enforce them.
      - Performance: No paid call in this task. The cache probe's live cost is ≤ 12 requests per route, stated at each gate.
      - Code Quality: Extends `readiness.mjs`, `usage.mjs`, `report.mjs` and `campaign.mjs`. No second readiness or accounting module.
      - Security: The probe uses fixture text only. Keys are `env:` refs from `live.env`. Reports hold hashes, counts and token numbers only.
    - Approach:
      - Documentation Reviewed:
        - Task 3 cost notes (`usage.mjs:55–115`; `report.mjs:123` "other arms use reported cache tokens");
        - `robustness-criteria.json` `ownerDecisions.costRegime`;
        - Task 4.9 closure (the 23-cell screen, `baselineComplete: false`);
        - Task 4.10 (`product-phases-delivery-v3` fingerprints);
        - readiness `operationalBlockers`.
        - Plan 184: its parity cells run `apps/prism-agent`, which wires `memoryFabric({ preset })` (`apps/prism-agent/src/host/coding.ts:43`, `research.ts:50`). They inherit 4.12. No edit to plan 184.
      - Options Considered:
        - Rerun the 23-cell screen on the new product. Rejected unless equivalence fails: byte-identical answer requests make it a pure cost.
        - Make the cache probe a criterion. Rejected: that would change pre-registered criteria after Task 4.
        - Simulate a warm memory arm in BFC (iii). Deferred to an explicit owner decision for the same reason.
      - Chosen Approach:
        - Prove equivalence offline and pin readiness to it.
        - Add the realistic multi-turn measurement as reported, uncounted evidence.
      - API Notes and Examples:
        ```sh
        timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base <pre-4.12-worktree> --out docs/_evidence/memory-bench/202/cache-stability/equivalence.json
        timeout 900 bun scripts/memory-bench/cache-probe.mjs --model <route> --turns 12   # live, only under gate 2/3
        ```
      - Files to Create/Edit:
        - `scripts/memory-bench/{prefix-probe,cache-probe,readiness,usage,report,campaign}.mjs` and tests;
        - `docs/_evidence/memory-bench/202/cache-stability/*`;
        - `scripts/memory-bench/README.md`;
        - no further plan text (the Task 11, 17 and 18 criteria and the Verification list were updated when this task was added).
      - References:
        - R11; Tasks 2, 3, 4.9, 4.10, 11, 17, 18.
    - Test Cases to Write:
      - `readiness_refuses_product_hash_without_cache_stability_record`.
      - `equivalence_mismatch_lists_arms_to_rerun_and_never_merges_cells`.
      - `robustness_criteria_hash_unchanged_by_cache_tasks`.
      - `cache_probe_report_holds_no_text_and_flags_forget_break`.
      - `role_usage_splits_extractor_by_cache_key`.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: no. Harness, evidence and plan text.
      - Docs pages to create/edit:
        - `scripts/memory-bench/README.md` (cache-stability pin, cache probe, `product-extract`);
        - `docs/_evidence/memory-bench/202/cache-stability/README.md`.
      - `docs/index.md` update: no
      - Documentation structure reference: `.claude/skills/create-plan/references/prism-wiki.md`
    - Notes (executed 2026-10-30):
      - **Equivalence attestation: different.** `prefix-probe.mjs --equivalence --base <worktree>` (new `--capture-answers`, `--dump`, `--keep-text`; `equivalence-preload.mjs` pins `randomUUID` and the clock through `mock.module` and `setSystemTime`) replays the 14 synthetic fixture questions on `preset-r1` (`fabric-x-tools`) and `passive-only` (`fabric-x`) with a mock provider and hashes every answer-phase request, twice per tree (each tree is byte-identical to itself). The base is a worktree of commit `5c2570df` with its own copied `node_modules` and this tree's harness overlaid; its fabric product hash `57aa47d9…` equals the product hash in the 23-cell screen's `baseline/manifest.json`, so it is the product the cells ran. All 56 requests differ: on both arms the context, system messages and tail position (before → after the latest user, Task 4.12's intended move) differ, and on `preset-r1` the tools and transcript too. The other layers cannot be split by task because Tasks 4.10-4.14 are uncommitted; the verdict does not need the split. `equivalence.json` lists `rerunArms: ["preset-r1", "passive-only"]` and `mergeWithPreChangeCells: false`. **Consequence for Tasks 5-10:** those two arms' 23-cell cells are not a comparison base; rerun them under gate 2 with the budget stated there. The `full`, `full-truncated` and `lexical-topk` cells install no fabric and stay. No cell was rerun and nothing paid ran.
      - **Readiness pin.** `readiness.mjs --cache-stability` runs the prefix suite (JUnit reporter, since `bun test` names passing tests only on a terminal), requires the ten named 4.12-4.14 tests to pass, and writes `cache-stability/record.json` (29 pass / 0 fail) binding the suite, the fabric product hash (`PREFIX_PRODUCT_PATHS`, the hash every manifest carries) and the SHA-256 of `equivalence.json`. `cacheStabilityBlockers` and `assertCacheStabilityPin` give named blockers (`cache-stability-record-missing`, `-suite-failed`, `-product-changed`, `-equivalence-missing`, `-manifest-unpinned`); `runCampaign` calls the pin right after `spec.build()`, so every mode is refused. `operationalBlockers` is unchanged so existing blocker tests keep their contract. Editing `packages/memory/fabric/src` invalidates the record until both commands are rerun.
      - **Cache probe.** `cache-probe.mjs` runs the scripted 12-turn `conversational` session through the wire proxy with at most 12 wire attempts, enforced in the fetch hook (retries count). The additive insert (before turn 4) and the forget (before turn 9) are host-side writes through a second memory instance over the same SQLite store, not model tool calls: a live model cannot be scripted, and it is the cross-process case 4.14 revalidates. This replaces the plan's "memory.insert / memory.forget" tool calls and "one cited note" (citation is model-driven and cannot be forced; the seeded core note is simply delivered). Per request it reports tokens, the cache-read share and the cacheable-prefix share (bytes shared with the previous body); `as-expected` means every request after the first reads from the cache except the forget request, which reads less than its predecessor. The campaign summary lists `cache-probe.*.json` under `cacheStability` with `informational: true`. Not run live (needs gate 2/3); the offline test drives it through a stub route whose cache is the common prefix of consecutive bodies.
      - **Write-side accounting.** The wire proxy's usage log now carries the affinity key a route sent (`x-session-id`, `session_id`, `x-client-request-id`, `x-opencode-session`, body `prompt_cache_key`). `roleUsage` moves product exchanges whose key starts with `prism-fabric-extract` into a `product-extract` role. Deviation from the plan's wording, to keep the frozen cost criterion intact: `productMeasurementVerdict` adds `product-extract` back into `product` (an absent role adds nothing, a present role with unknown cost makes the cost unknown), `report.cost.productExtract` and one summary line show the extractor separately, and `baseline.mjs` product cost lines are untouched (its cells run no extractor).
      - **Criteria untouched.** `robustness_criteria_hash_unchanged_by_cache_tasks` pins `dd1add49…`, the hash every baseline report since 2026-10-27 carries; the criteria file and BFC (iii) are unchanged.
      - Tests added: `role_usage_splits_extractor_by_cache_key`, `wire_usage_log_retains_the_prompt_cache_key`, `readiness_refuses_product_hash_without_cache_stability_record`, `equivalence_mismatch_lists_arms_to_rerun_and_never_merges_cells`, `answer_path_capture_is_deterministic_and_holds_hashes_only`, `cache_probe_report_holds_no_text_and_flags_forget_break`, `cache_probe_never_exceeds_its_request_bound`, `cache_stability_row_flags_a_miss_that_is_not_the_forget`, `cache_probe_rows_are_listed_beside_the_verdict_without_the_per_request_body`, `robustness_criteria_hash_unchanged_by_cache_tasks`.
      - Verification: benchmark suite plus `wire-proxy.test.mjs` **395 pass / 2 environment skips / 0 fail**; fabric suite 536 pass / 23 skips; docs suite 65 pass; repository `bun run typecheck` exits 0; Biome on every touched file is clean except pre-existing findings in files this task did not edit; `git diff --check` passes. The worktree `.cache/memory-bench/202/cache-stability-base` (ignored by git) is left in place so the attestation can be rerun.
      - For the later paid tasks: Tasks 5-10 development screens must rerun `preset-r1` and `passive-only` under gate 2 (state the budget there); gate 2 runs one `cache-probe.mjs` per answer route, gate 3 one per acceptance route.
  - [x] Task 4.10: Repair ingestion, evidence accounting and private answer/trace retention (owner-requested prerequisite)
    - Acceptance Criteria — Functional: ingest MAB fact lists through the supported typed-note writer without fabricated dialogue; record the corpus override, provenance, refusals and persisted source coverage; refuse unsupported empty imports and stale product snapshots. Map LoCoMo message gold to round ids, keep unresolved labels unavailable, observe actual candidates independently of delivered recall/read/passive evidence, and retain answers plus exact requests/queries/excerpts before judging. Resume pending conversational evaluation without regenerating answers. Performance: no new model calls; opt-in observer and private disk/cache overhead only. Code Quality: reuse product note writing, OKF parsing, cache and hook primitives; preserve historical artifacts and closure. Security: source/gold/answer text stays out of public reports; private cache writes are atomic with mode 0600; existing trust gates remain enforced.
    - Approach / References: `diagnosis-2026-10-30/README.md`; `datasets.mjs` marks the fact-list source; `ablations.mjs` records fact injection for that corpus; `replay.mjs` uses the shipped typed-note writer and archive command, validates snapshot source/coverage, observes product recall candidates and final model requests; `run.mjs` checkpoints before evaluation and carries evidence accounting across phases; `judge.mjs` atomically replaces private cache entries. The fabric's optional `onRecall` SDK observer / `memory-fabric.diagnostics` service is inert by default and does not alter ranking. New `product-phases-delivery-v3` fingerprints refuse old checkpoint reuse; do not reopen or rewrite the closed screen.
    - Test Cases: message/round id mapping and unresolved references; source-line preservation and revision separation; unsupported user-only inputs refuse before calls; actual candidate-versus-delivery differences; read by id and OKF path without recall; private trace/cache permissions and no report text; judge-failure recovery without regeneration; partial trust refusals and changed-source snapshot refusal. First four regressions failed before the repair.
    - Documentation/Wiki Assessment: package README documents the optional private observer and its cost; benchmark README documents corpus overrides, evidence granularity, snapshot proof and private retention. No kernel/export move, dependency, reference-host, examples or docs-index change; no release baseline regeneration needed. Tasks 5–17 remain unchecked; this repairs measurement prerequisites only.
    - Notes (executed 2026-10-30): [Implementation and verification](../docs/_evidence/memory-bench/202/measurement-repair-2026-10-30/README.md). Nine new regressions pass; full benchmark 368 pass / one environment skip / zero fail; repository typecheck and diff checks pass. Real cached MAB case persists 456/456 raw source lines; all 20 development fact-list structures and all 60 LoCoMo mappings verified. Broad fabric suite: 503 pass / 23 PostgreSQL skips / one pre-existing legacy-tree retirement failure (`packages/memory/src`), left untouched. Historical 23 reports and five frozen artifact hashes unchanged; campaign and journal remain closed-by-owner. No live calls, held-out access, ranking/embedding/default change, dependency or public export move. Optional private diagnostics and local cache writes are the only added overhead; fine metrics remain round-presence metrics, and the MAB corpus override is explicitly recorded. Full Task 4 remains deferred.
    - Follow-up (2026-10-30, owner requested legacy-tree fix): removed four obsolete files from the retired `packages/memory/src` workspace (unused adapter and tests already covered by active packages) and the scoped fixture loader's retired-path fallback. Existing retirement guard unchanged; no published export/dependency change. Fabric suite now **504 pass / 23 PostgreSQL environment skips / zero fail**; active package conformance/security checks 5 pass; package-directory scoped fixture checks 5 pass; repository typecheck and diff checks pass. [Verification](../docs/_evidence/memory-bench/202/measurement-repair-2026-10-30/legacy-tree-fix.json). The prior unrelated retirement failure is resolved; no live calls or campaign resume.
  - [x] Task 4.9: Close the owner-accepted 23-cell Muse 1.3 development screen
    - Acceptance Criteria — Functional: verify all 23 complete reports against the original 25-cell manifest/journal; explicitly list both quota exclusions; exclude partial rows from comparisons; retain graded/binary statistics, paired cluster CIs and Holm corrections unchanged. Performance: offline closure makes zero live requests and cannot silently resume paid work. Code Quality: reuse existing report validation/aggregation; no SDK/product/export/dependency change. Security: hash source reports and original manifest/journal, retain every reservation without refund, publish no raw source/gold/answer/judge text.
    - Approach / References: existing `loadBaselineReports`, `summarizeBaseline`, `baselineCoverage`, and readiness `operationalBlockers`; preserve original 25-cell identity and store a separate accepted 23-cell final manifest. Reject treating the original design as complete or erasing the omitted cells. Full Task 4 and Task 18 remain deferred/unchanged.
    - Test Cases / Evidence: `owner_closed_screen_cannot_be_reopened_by_refreshing_admission` failed before the guard, then passes; independent closure assertions verify exact accepted/omitted ids, report hashes, original journal identity, unchanged registered statistics, unchanged attempts/charges and `baselineComplete: false`. The final scope contains 970 question dispositions, 893 scored and 77 context-ineligible; the extra 15 partial rows are excluded.
    - Documentation/Wiki Assessment: benchmark evidence and this plan only; no public SDK behavior/docs/index change. Final report covers cost/accounting and comparator limitations. Whole-plan completion/backlog handoff remains deferred with the broader plan.
    - Final verification: **359 pass / one Vibe official-image environment skip / zero failures**, typecheck, formatting and diff checks pass. `muse13-screen-final/validation.json` pins the published artifacts and commands. The real campaign CLI refuses after closure without changing journal bytes, creating an attempt or issuing a model request; fresh admission alone cannot reopen the screen. Source changes are limited to optional closure evidence loading and the readiness guard, with its regression test; no product change.
    - Notes (executed 2026-10-30): final screen flags Tasks 5, 8, 9 and 13 as development investigation priorities; Tasks 6, 7, 10, 16 and 17 remain unmeasurable. This does not close any lever on missing evidence. Full-history eligibility is only 4/50 on LongMemEval-M and 9/40 on BEAM-1M; no suite-wide full-history superiority claim. Two completed cells retain incomplete usage; reservations remain held. Total retained charge including historical debt is 668,089,833 tokens against 2B; this is conservative bookkeeping, not measured consumption or a dollar bill. No human-calibrated, cross-model, cross-provider, held-out, BFC/Robust, default or final-lever claim.

  - **Current owner-directed execution scope (2026-10-29): 25-cell Muse 1.3 development screen.** Exact instruction: “Let's do the 25 cell pass with Muse 1.3. Stop the current run”. The 75-cell campaign was stopped and its process exited; three completed Muse 1.2 cells plus 38/40 scored rows of the interrupted fourth remain preserved. The interrupted 42.5M allocation is retained without refund; stopped total debt is 499,135,964 tokens, including all previous debt once. The new screen runs all five frozen suites × all five configurations with **only** `commandcode/meta/muse-spark-1.3-contributor`, under the existing paid MiniMax M3.1 Flash + GLM 5.3 Flash panel. Use a separate `.cache/memory-bench/202-muse13-screen/journal.json` and `baseline/muse13-screen/` reports. Original multi-model confirmation is deferred; Task 4 remains unchecked. The screen's completion is recorded as `screenComplete`, with `baselineComplete: false`. Preserve original draws, statistical rules, source blindness, per-attempt bounds and the aggregate 2B ceiling. No model substitution or judge switch is authorized by this scope change.
  - **Screen resumed after Command Code quota reset (2026-10-30 Bangladesh time).** At the quota stop, 20/25 cells completed; five remain (three partial and two unstarted). Fresh Muse 1.3 tool/admission and MiniMax/GLM judge controls pass after the provider's reported reset. Current source verification matches, refreshed readiness has zero blockers, and the refreshed manifest's jobs and journal fingerprint exactly match the original screen. Resume uses the existing journal and skips the 20 completed cells, starting with the failed BEAM-100K full-history cell's saved 32 results. No model, prompt, draw, limit or score identity changes; missing-usage reservations remain held. Evidence: `muse13-screen-resume.json`; live log `.cache/memory-bench/muse13-screen-resume-campaign.log`. The inherited journal quota-status marker is stale during the resumed controller's execution; process/attempt evidence establishes liveness. Full Task 4 and the unfinished screen remain unchecked.
  - **25-cell screen started (2026-10-29).** Readiness is ready with zero blockers; Muse 1.3 and both existing judges pass fresh admission. Verification: 358 pass / one Vibe official-image environment skip / zero failures, plus 31 focused regressions after metadata cleanup; typecheck and diff checks pass. New tests failed before implementation and prove exact 25-cell scope, no accidental full-baseline completion and no double-counted debt. The new serial campaign is live; first cell is BEAM-100K preset-r1 / Muse 1.3. Evidence: `muse13-screen-execution.json`, `muse13-screen-verification.json`, `stopped-75-campaign.json`. Full Task 4 stays unchecked; completing the screen will be recorded separately.
  - Test cases for this scope: `muse13_screen_has_25_cells_and_cannot_claim_the_full_multimodel_baseline` and `stopped_campaign_carryover_preserves_unknown_reservations_without_double_counting`; both failed before implementation. Docs assessment: benchmark README/evidence and this plan only; no SDK/product/public API/export/dependency changes. Broad later-task gates and Task 18 criteria remain unchanged.

  - **Owner-directed Muse continuation (2026-10-29): active.** Owner instruction, verbatim: `go forward with this model. And then continue with the task 4 WIP`. This authorizes paid `commandcode/meta/muse-spark-1.3-contributor` as the intended Glyph replacement, superseding the free-only restriction for this named answer route only; other answer routes and the Dots/Cohere judge panel remain unchanged. A fresh bounded compatibility probe passed imported assistant history, the complete 238-message development history, one tool exchange and follow-up recall/stopping, with complete reported usage. Existing four completed Lightning cells, the interrupted lexical checkpoints and all retained charges remain preserved. Do not mark Task 4 complete or substitute judges.
    - **Answer-phase result:** readiness-v5 completed 42/42 private answer checkpoints and all 52 dispositions, including ten equivalent-policy repeats. All ten full-history cases are eligible, with zero run-limit failures. Fifty Muse requests used 1,587,929 input / 53,117 output tokens with zero missing usage, in 10.67 active minutes; aggregate listed cost is $0.1694163. Independent `readiness-pilot-v5/answer-proof.json` matches wire/role usage and verifies current source/SDK/manifest pins. No judge call occurred; one 50.5M reservation remains held awaiting scoring, for 449,318,335 prior-plus-held tokens against 2B. No process remains running. The read-only OpenRouter account query at 12:53:34 UTC confirms 1,241 requests recorded / 1,000 daily limit / zero remaining. Fresh original-panel admission after the observed 2026-10-30 00:00 UTC reset must precede `--score-only`; keep the same frozen answers/reservation. A matched product and recomputed run-path fingerprints prove all four prior Lightning cells remain reusable. The non-executable `muse-transition.json` records their retention and the intended 25-cell Glyph-to-Muse replacement; broader readiness and campaign identity still need reconciliation after the scored pilot.
    - **Verification:** new named Muse-route/pricing regression failed first, then seven focused pilot tests pass. Typecheck passes; the whole benchmark repeat is 344 pass / two inherited environment skips / zero fail. The first run hit the known five-second statistics timeout and is retained in the local log. Formatting/diff checks and the checkpoint/wire/source assertions pass. See `muse-verification.json` and `muse-continuation-2026-10-29.md`. No memory product, kernel/package contract, dependency or public export changed.
    - **Versioned prerequisite:** a separately frozen readiness-v5 pilot reuses the existing ten-id/52-disposition design and source-label safeguards with Muse, temperature zero, 8192 output tokens and the unchanged eight-turn stop. Generate 42 private answer checkpoints without judge calls, then score those exact checkpoints under the original panel after successful admission; never regenerate them merely because judge quota is unavailable. The new declaration retains 300 calls / 50M input / 1M output / four active hours, with 24 elapsed hours to cover the observed next-day reset. Its conservative uncached input/output ceiling is **$5.20**, at the checked official rates **$0.10 input / $0.20 output / $0.002 cache-read per million**. One held pilot reservation spans both phases; older pilot and campaign reservations are not refunded. Task 4 remains incomplete pending scoring, current readiness reconciliation and the remaining broad grid.
  - **Owner-directed Laguna probe (2026-10-29): partial pass, not activated.** `docs/_evidence/memory-bench/202/laguna-compatibility-2026-10-29.md` and its reconciled JSON record eleven free physical requests: three generations, eight HTTP 429 upstream-temporarily-unavailable refusals. Chat passes short imported assistant history and a full 238-message development history (119 assistant messages, zero removal; 153,772 raw input tokens). Tool execution and tool-follow-up stopping remain unverified because their requests were refused. One Responses generation fails synthetic token recall; its cause is undiagnosed. Successful Chat records expose an accounting defect: raw usage is present but normalized counters are zero; preserve raw evidence and conservative reservations, and repair normalization before baseline activation. One local default cumulative-input limit was corrected in the private probe only; model context/admission/output/turn/wall bounds remain enforced. No implementation, campaign model set or protected baseline artifact changed. Glyph replacement and broad readiness remain pending; Task 4 stays unchecked.
  - **Latest outcome (2026-10-29, 11:20 UTC): incomplete; free daily quota exhausted.** The authorized serial campaign ran for approximately 4 h 34 min and completed **4/75** compatible cells, all BEAM-100K/Lightning: preset-r1 **10/40**, passive-only **10/40**, complete-history full **4/40**, and full-truncated **5/40**. All 40 full questions prove complete-history eligibility; full-truncated is an equivalent-policy repeat, not an independent treatment. Both memory-versus-full paired descriptive differences are +.15; Holm-adjusted p-values are .8125 and 1, with no acceptance or demonstrated lever-effect claim. The lexical-topk attempt saved **25/40** results before an answer request returned HTTP 429, explicitly `Daily quota exhausted` / `free-models-per-day-high-balance`. It is excluded from completed-cell aggregation; **70 cells were not started**. The shared OpenRouter judge quota also blocks the Command Code cells, so no provider or panel substitution was attempted.
    - **Evidence/accounting:** `docs/_evidence/memory-bench/202/baseline/{README.md,summary.json,run-status.json}` contains only this campaign's four journal-completed cells, paired comparisons, per-ability metrics and descriptive product-only candidate flags. Historical seven-cell reports remain untouched and excluded. Full-truncated has incomplete usage after a judge retry: its **40,500,000-token** reservation remains charged, without refund; reported usage is a lower bound. Total journal charge is **398,818,335** including historical/preflight reservations against the unchanged **2B** ceiling. The other three completed cells have complete reported usage. All current answer/judge routes were explicitly free; no paid fallback, held-out run, product change or default claim occurred.
    - **Resume boundary:** `readiness-quota.json` records the refusal; the offline readiness refresh now reports **not-ready: quota-unavailable-or-unverified**, with `resume-manifest.json` non-executable. Readiness's 75-job grid is not a count of unfinished cells; the campaign journal records the four completions and interrupted arm. Fresh successful free-route admission/control probes and a source-matched readiness refresh are required before resuming the same frozen execution identity and journal. Do not assume a reset, discard retained reservations, rerun the four compatible completions, or mark Task 4 complete. Final lever decisions await the remaining compatible grid. No owned campaign process remains.
    - **Final verification:** focused readiness/baseline/campaign suites **31 pass / 0 fail**. Artifact assertions verify four current completed cells, 25 interrupted checkpoints, equivalent-policy repeat marking, paired-descriptive comparisons, the non-executable quota gate, retained accounting and no remaining campaign process. `git diff --check` passes. The fresh whole-benchmark **343 pass / 2 environment skips / 0 fail** and passing typecheck are recorded in the start record below; no implementation source changed during this execution.
  - **Campaign start record (2026-10-29, superseded by the latest outcome above):** the owner reconfirmed Task 4 and restricted live calls to free OpenRouter and Command Code models. The source-matched readiness guard passed and the frozen 75-cell development campaign started at approximately 06:46 UTC with `timeout 28800 bun scripts/memory-bench/campaign.mjs --baseline-202 --parallel-arms 1`. It uses the existing free Lightning/Ultra/Glyph answer set and free Dots/Cohere panel, with no model substitution or paid fallback. Fresh verification: `timeout 600 bun test scripts/memory-bench` — **343 pass / 2 environment skips / 0 fail**; `timeout 180 bun run typecheck` — **pass**. At that start checkpoint, the first BEAM-100K preset/Lightning cell was in progress. Task 4 remains unchecked until the compatible broad grid, paired summary and lever report finish. Historical seven-cell results remain exploratory and are not reused.
  - **Resume prerequisite (2026-10-28):** complete subtasks 4.1–4.8 below (including 4.5.1, added 2026-10-28) before resuming the broad baseline. The seven completed cells remain exploratory evidence; they do not establish BFC/Robust acceptance or final lever decisions. Historical execution notes below are retained, but this prerequisite supersedes their resume instructions.
  - Acceptance Criteria:
    - Functional: Owner gate 1 is recorded verbatim in the manifest. Arms sized by in-flight reservation (188.10 lesson). The baseline does not start until Task 2's harness triage makes `bun test scripts/memory-bench` green (or the two failures are quarantined with a recorded cause), so a paid campaign is never run over a harness that cannot report its own accuracy.
    - Functional: `preset-r1`, passive-only, `full` / `full-truncated` and `lexical-topk` run on every suite's `dev` partition. They run on the three to four answer models Task 1 selected (suggested: `opencode-go/mimo-v2.5`, `hyper/qwen3.7-plus`, one more Hyper family such as `glm-5.x` or `kimi-k2.x`, and a small model such as `hyper/gemma-4-26b-a4b-it` or local Laya), each judged by the panel.
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

  - Prerequisite subtasks (added 2026-10-28; Tasks 4.1–4.8 including 4.5.1 executed; Task 4.8 initially not-ready, remediation underway; every "4.1–4.8" range in this task includes 4.5.1):
    - **Shared scope and verification:** these subtasks repair the benchmark harness and its evidence, not the memory product. Reuse `scripts/memory-bench` and existing statistics; no kernel contract, package, public export, host change, dependency, compatibility-baseline regeneration or new public docs page is planned. Before implementation, trace callers of changed symbols with graft and update affected callers, fixtures and tests together. Write the named regression tests first. Every implementation subtask leaves `timeout 180 bun run typecheck` and its focused suites green; record inherited failures separately. No held-out question, gold, rubric or source text is inspected. Existing held-out guards remain enforced. Public evidence contains ids, counts and scores only; diagnostic text stays in private local audit artifacts and credentials remain refs. Each subtask updates `scripts/memory-bench/README.md` where harness behavior changes, with no `docs/index.md` change. CLI/error changes include the applicable caller and retired-string sweep. These are prerequisites within Task 4, not new owner approval gates; the existing subscription authorization and human-calibration waiver remain in force.

    - [x] Task 4.1: Preserve evidence and recover BEAM source annotations
      - Acceptance Criteria:
        - Functional: Preserve the seven completed reports, their manifests, hashes and protocol provenance as the original exploratory run. Normalize BEAM `source_chat_ids` (lists and keyed objects) into original message/round references while preserving rubrics for private grading diagnostics. Validate every reference; unknown or ambiguous mappings remain explicitly unknown, never fabricated evidence. Reproduce the development inventory: 36 non-abstention questions, 120 resolving references, rubrics on all 40 questions.
        - Performance: Mapping is deterministic and linear in source messages plus references, with no model or embedding calls.
        - Code Quality: Preserve original message identity alongside normalized ids; use the existing evidence representation and adapter tests. Version/hash the changed normalization and refuse incompatible checkpoint reuse.
        - Security: Gold annotations reach scoring/diagnostics only, never normal product-arm prompts, retrieval queries or ingestion.
      - Approach:
        - Documentation Reviewed / References: Task 2 frozen draws; `datasets.mjs:372–406` (BEAM normalization); `replay.mjs:275–309` (evidence extraction); `run.mjs:437–488` (reuse fingerprint).
        - Options Considered: Keep literal answer-text matching as the sole evidence source — rejected because it loses annotated multi-round evidence.
        - Chosen Approach: Map source ids at normalization, carry provenance into the existing evidence path, and explicitly distinguish annotated labels from heuristic matches. Preserve historical artifacts before regenerating derived summaries.
        - Files to Create/Edit: `scripts/memory-bench/{datasets,replay,run,robustness.test,run.test}.mjs`; provenance notes under `docs/_evidence/memory-bench/202/`.
      - Test Cases to Write:
        - `beam_source_refs_map_lists_and_keyed_objects`: all supported reference shapes resolve to the original source messages, including repeated ids across different conversations.
        - `beam_unknown_refs_are_not_invented_evidence`: a missing reference remains unknown.
        - `beam_gold_metadata_never_enters_product_context`: references/rubrics cannot leak into a measured product answer.
        - `normalization_change_invalidates_old_checkpoint_reuse`: old scores cannot silently enter the corrected protocol.
      - Documentation/Wiki Assessment: Harness/evidence only; update the bench README's annotation and provenance rules. No public API or `docs/index.md` change; use `.agents/skills/create-plan/references/prism-wiki.md`.
      - Notes (executed 2026-10-28):
        - Preserved all 21 original baseline files before changing normalization in `docs/_evidence/memory-bench/202/exploratory-original-2026-10-28/`, including the seven completed 40-question reports, two incomplete reports, manifest, Markdown renderings and summaries. `provenance.json` records byte sizes, SHA-256 hashes and original protocol provenance; a regression test checks the archive. `PROVENANCE.md` explains its exploratory status. The original reports lack a run-path fingerprint; this is recorded as null, not reconstructed. Their source revision does not attest the dirty working tree. Existing baseline scores and lever summaries were not recomputed.
        - `datasets.mjs` now retains original message `sourceId` alongside normalized ids and maps list/keyed `source_chat_ids` within each plan using one message index. Duplicate ids are ambiguous; missing or invalid ids are unknown. The question-only `sourceAnnotations` retains raw references, group labels, mapping status and rubric. Normalized evidence deduplicates resolved message ids; message ids now also include the existing plan suffix to prevent cross-plan collisions.
        - `replay.mjs` uses those labels through the existing evidence path, maps BEAM message labels to round ids for fine grading, distinguishes annotated labels from heuristics, and does not replace unknown BEAM labels with answer-text matches. An unresolved annotation cannot claim complete evidence retrieval. Product history, ingestion, retrieval queries and answer prompts receive no source annotations or rubrics; a provider-spy test covers both fabric arms and all three normal comparators.
        - Pinned `beam-source-annotations-v1` and the adapter source hash in new BEAM reports; both resume and completed-score reuse fingerprints include this normalization identity. Old checkpoints fail closed. Existing write-side cache keys already hash both `datasets.mjs` and `replay.mjs`, so those stores are invalidated too. No kernel, package, dependency, export, compatibility-baseline or host change.
        - Reproduced the frozen development inventory from SHA-256-verified cached BEAM-100K bytes: **40 questions, 36 non-abstention, 120/120 resolving references, rubrics on 40/40, zero unknowns**. The 120 references include duplicates: 118 unique message references, 98 round references. Text-free ids/counts and normalization provenance are recorded in `docs/_evidence/memory-bench/202/beam-source-inventory.json`. No held-out question/gold/rubric/source text was inspected; no model, embedding or paid call was made.
        - Tests first: the four named regressions failed against the original adapter/fingerprints, then passed. Full harness: `timeout 900 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun test --timeout=0 scripts/memory-bench` — **285 pass / 1 skip / 0 fail**. Final focused archive/annotation/reuse checks after formatting: **7 pass / 0 fail**. Biome check passes with one inherited unused-parameter warning in `run.test.mjs`. `timeout 180 bun run typecheck` fails on the inherited `packages/providers/hyper/src/models.ts:172` TS2345 (`number | undefined` passed as `number`), also reported through keyring and prism-agent; this task leaves that existing provider edit untouched.
        - The bench README and active baseline README now state the annotation/provenance rules. Task 4 remains unchecked and the broad campaign stays paused for Tasks 4.2–4.8; this subtask makes no corrected score, comparator eligibility, failure-attribution or lever-decision claim.

    - [x] Task 4.2: Make full-context comparator eligibility explicit
      - Acceptance Criteria:
        - Functional: `full` qualifies as complete history only when no source content was removed. A truncated request is rejected or reported as comparator-ineligible, never scored toward in-window full-context acceptance. `full-truncated` remains the explicitly bounded comparator. Record effective cap, context policy, truncation counts and model configuration; mark equivalent-context executions as repeats, not independent treatments.
        - Performance: Check eligibility locally before expensive calls where possible; preserve output/headroom reservations and never force oversized requests.
        - Code Quality: Reuse one cap/selection implementation with explicit eligibility semantics. The historical Beam cells both capped at 134,976 and truncated 36/40 questions; retain that limitation in their evidence.
        - Security: Comparator arms continue to exclude fabric, OM, memory tools and gold annotations.
      - Approach:
        - Documentation Reviewed / References: `replay.mjs:575–588` (`capMessages`), `replay.mjs:695–718` (session selection), `replay.mjs:900–925` (cap hook); `run.mjs:862–868` (effective cap).
        - Options Considered: Infer long-context degradation from the two existing arms — rejected because their truncation policy and effective cap match.
        - Chosen Approach: Validate the actual rendered context and record eligibility per question; retain legitimate model degradation as a measured limitation only after complete-context delivery is proven.
        - Files to Create/Edit: `scripts/memory-bench/{replay,run,report,baseline,measurement.test,run.test,baseline.test}.mjs`; bench README; corrected comparator evidence under `docs/_evidence/memory-bench/202/`.
      - Test Cases to Write:
        - `full_context_truncation_cannot_qualify_as_complete_history`.
        - `full_truncated_records_removed_source_content`.
        - `equivalent_context_arms_are_not_a_truncation_treatment`.
      - Documentation/Wiki Assessment: Update comparator semantics and eligibility in the bench README and evidence notes; no public API or index change; use `.agents/skills/create-plan/references/prism-wiki.md`.

      - Notes (executed 2026-10-28):
        - Reused `capMessages` through one comparator selection helper. Oversized `full` history now returns an unscored `comparator_ineligible` row before provider admission, and split-phase judging preserves that disposition without a judge call. `full-truncated` retains bounded turn selection. Both keep compaction off and exclude memory packages/tools and gold annotations.
        - Reports pin comparator policy version, effective input cap, safe model limits/parameters and request headroom. Per-question metadata records policy, message cap, source/message removal counts, estimated tokens removed, completeness/eligibility and a context hash. Policy version participates in checkpoint/reuse fingerprints so historical truncating `full` checkpoints cannot resume.
        - Baseline summaries retain ineligible/unscored counts and refuse full-context gaps for incomplete or unproven cells. Identical contexts across all question ids on the same model configuration mark the bounded arm as `repeatOf: full`, with no independent comparator gap. Markdown evidence also states these dispositions.
        - Added `docs/_evidence/memory-bench/202/comparator-eligibility.md` and updated the active evidence/bench READMEs. Historical BEAM cells remain explicitly limited: shared cap 134,976, 36/40 questions truncated in each, equivalent-policy repeats. Original exploratory bytes and scores are unchanged. Local character estimates do not prove provider tokenization; provider refusals remain errors.
        - Validation: `timeout 900 bun test --timeout=0 scripts/memory-bench` passed (290 pass, 2 environment-dependent skips, 0 fail); `timeout 180 bun scripts/memory-bench/run.mjs --offline` passed; Biome check passed with one existing unused-parameter warning in `run.test.mjs`. Workspace `bun run typecheck` was attempted and remains blocked by the pre-existing `packages/providers/hyper/src/models.ts:172` TS2345 (`number | undefined` passed as `number`), also reported by credentials-keyring and prism-agent. No public exports moved, so no compat baseline or release gate was needed.
        - No paid calls or corrected scores. Task 4 remains unchecked and its broad campaign paused for Tasks 4.3–4.8; provider/model changes and the remaining measurement prerequisites stay outside this subtask.

    - [x] Task 4.3: Separate ingestion, answer latency and evaluation overhead
      - Acceptance Criteria:
        - Functional: Report cold ingestion separately from warm question-to-final-answer latency and post-answer grading/injection annotation. Publish true p50/p95 and mean with matching labels. Partition wire usage by product versus evaluation role, retain total campaign/quota usage, and report cold and warm-cache-adjusted product cost. Missing prices remain unknown; zero subscription prices cannot establish a relative cost pass through a 0/0 ratio.
        - Performance: Injection annotation runs after the measured answer interval or in a separate phase; do not subtract aggregate percentiles to reconstruct answer latency. Record concurrency, pacing and retry inclusion. The registered cost/latency verdict consumes product measurements, not grading time or grading tokens.
        - Code Quality: Extend existing `timing.mjs`/`usage.mjs`; preserve reconciliation to wire totals and distinguish unavailable historical phase metrics from measured values.
        - Security: Role accounting contains counts and durations, not prompts, responses or credentials.
      - Approach:
        - Documentation Reviewed / References: `baseline.mjs:208–276` (mean read into displayed p50), `baseline.mjs:378–434` (table); `run.mjs:978–985,1082–1083` (question timer and annotation); `judge.mjs:228–249` (annotation calls).
        - Options Considered: Rename the old wall-time field and use it as product latency — rejected because it includes ingestion and evaluation. Remove all annotation — rejected because diagnostic information is still useful outside the answer interval.
        - Chosen Approach: Add phase boundaries to the existing timer/accounting and keep end-to-end campaign cost visible alongside product cost.
        - Files to Create/Edit: `scripts/memory-bench/{timing,usage,replay,run,report,baseline,measurement.test,baseline.test,run.test}.mjs`; bench README; active baseline evidence README. Existing judge annotation already runs after replay, so no judge implementation change is needed.
      - Test Cases to Write:
        - `slow_judging_does_not_inflate_product_answer_latency`.
        - `cold_ingestion_and_warm_answer_have_separate_timers`.
        - `baseline_p50_uses_percentile_not_mean`.
        - `role_usage_reconciles_to_wire_totals`.
        - `zero_or_unknown_comparator_cost_cannot_pass_ratio_gate`.
      - Documentation/Wiki Assessment: Bench README defines timing boundaries, role usage, cache assumptions and annotation call cost/default; evidence tables use corrected labels. No public API/index change; use `.agents/skills/create-plan/references/prism-wiki.md`.

      - Notes (executed 2026-10-28):
        - Added independent per-question ingestion, answer and evaluation timers with true p50/p95/mean and sample counts. Replay closes ingestion before the question run and closes answer timing after its final retry, before final background settlement, grading, annotation and disposal. Snapshot hydration is `restore`, not a fabricated cold ingestion measurement. Split judging preserves saved product timings; concurrency, queue-wait exclusion, judge pacing, retry/backoff inclusion and annotation policy are recorded. The new measurement version invalidates older resume/reuse fingerprints.
        - Isolated product wire routes from each judge route, even when the models share a provider. `roleUsage` retains product/evaluation/unknown historical counts, exchange totals and token totals, and prices each isolated model route with its own rate. Campaign/quota accounting still includes every attempt. Missing usage or prices remain unknown; mixed-model product routes without wire model identity remain unpriced. Product reports measured, cold and warm-cache-adjusted USD plus input-only cold/warm costs. The full arm's favourable all-prefix cache simulation applies only to product traffic.
        - Baseline tables now display answer p50/p95/mean separately from ingestion/evaluation and show product versus evaluation versus campaign costs. Registered measurement comparisons use matched question ids, complete-history eligibility, product input cost per question and answer p95 under the criteria file's thresholds. Historical phase metrics, incomplete usage, missing prices, zero comparator USD and seeded read runs lacking write-side cost cannot establish a cost pass. This provides the measurement inputs for later acceptance; it does not execute Task 18 or declare BFC/Robust acceptance.
        - Updated the bench README and corrected the active historical evidence header to **end-to-end mean/p95**, explicitly stating that its product/evaluation phases and billing partitions are unavailable. Original exploratory report/archive bytes and scores remain unchanged. No paid/provider/embedding calls, held-out inspection, kernel/package/host changes, dependencies or public export changes; no compatibility baseline regeneration is needed.
        - Tests first: all five named regressions failed before implementation, then passed; added product-only verdict wiring, cumulative usage reconciliation, split-judge timing preservation and snapshot restoration checks. An accidental test-file overwrite during editing was recovered from the prior session's full source and edits before final validation; all seven existing baseline tests were preserved.
        - Validation: focused measurement/baseline checks pass (25 tests); offline CLI smoke passes (14 questions); Biome passes with the inherited unused `attempt` parameter warning in `run.test.mjs`; `git diff --check` passes. Full harness: `timeout 900 bun test --timeout=0 scripts/memory-bench` — **296 pass / 2 environment-dependent skips / 0 fail** (298 tests across 16 files). `timeout 180 bun run typecheck` was attempted and still fails on inherited `packages/providers/hyper/src/models.ts:172` TS2345 (`number | undefined` passed as `number`), also reported through credentials-keyring and prism-agent; that unrelated working-tree edit is unchanged.
        - Task 4 remains unchecked. The broad baseline stays paused for Tasks 4.4–4.8; historical missing phase metrics require compatible new measurements, never percentile subtraction or relabelling.

    - [x] Task 4.4: Repair failure attribution and product-only lever ranking
      - Acceptance Criteria:
        - Functional: Keep run-limit, transport/setup, invalid comparator, unknown evidence and judged incorrect outcomes distinct. A run-limit remains an end-to-end failure but is not automatically an abstention/retrieval/synthesis diagnosis. Use validated source labels from 4.1, record attribution coverage and unknown counts, and keep total product failures as the pre-registered denominator.
        - Functional: Rank product-arm failures only; comparator failures cannot open a product lever. State the eligible arm and suite × model for every decision. Deduplicate question ids within that decision and report shared failures across arms without presenting their sum as unique recoverable questions. A stage identifies a candidate lever, not a causal promise of recovery; missing/unmeasured stages cannot close tasks.
        - Performance: Recompute what can be derived from saved ids/outcomes without model calls; retain the 5% lever threshold.
        - Code Quality: Reuse `stageFromCounts`/`rankLevers`, with an explicit outcome-first rule and provenance for annotated versus heuristic evidence.
        - Security: Derived stage reports contain no gold or answer text and diagnostics continue to refuse held-out ids.
      - Approach:
        - Documentation Reviewed / References: `run.mjs:1075–1112` (run-limit and stage assignment); `replay.mjs:357–389` (stages); `baseline.mjs:282–304` (all-arm lever totals).
        - Options Considered: Count all arm failures as recoverable product failures — rejected because lexical/full comparator mistakes and duplicate questions contaminate that count.
        - Chosen Approach: Separate observed outcomes from inferred causes, then apply the unchanged lever rule to explicitly eligible product cells.
        - Files to Create/Edit: `scripts/memory-bench/{run,replay,retrieval-diagnostics,baseline,baseline.test,run.test}.mjs`; corrected derived evidence under `docs/_evidence/memory-bench/202/`.
      - Test Cases to Write:
        - `run_limit_is_not_relabelled_as_abstention_or_retrieval_failure`.
        - `comparator_failure_cannot_open_product_lever`.
        - `shared_product_failures_are_not_unique_recoveries`.
        - `unknown_evidence_cannot_close_unmeasured_lever`.
      - Documentation/Wiki Assessment: Bench README and evidence explain outcome/cause, eligibility, denominator and coverage. No public API/index change; use `.agents/skills/create-plan/references/prism-wiki.md`.

      - Notes (executed 2026-10-28):
        - `stageFromCounts` now applies outcomes before causes: run limits, transport/setup errors and invalid comparators remain separate from judged incorrect answers and unknown evidence. Run limits still score as end-to-end failures. `run.mjs` records stage counts, validated source-label provenance and unknown-reference counts from Task 4.1; unresolved labels cannot become retrieval/synthesis claims. The measurement fingerprint changed to reject prior resume/reuse checkpoints. Offline diagnostics retain saved outcomes/provenance and restaging refuses held-out subsets.
        - `rankLevers` admits only preset-r1 (`fabric-x-tools`) and passive-only (`fabric-x`) product arms. Every decision names suite/model/arm, deduplicates question ids and retains **all** product failures in the unchanged 5% denominator. Conflicting duplicate outcomes/diagnoses remain unknown. Separate observed-outcome counts, attributed/unknown/operational counts, coverage, measured stages and annotated/heuristic provenance are reported. Missing stages remain `unmeasurable`; incomplete attribution or target-stage measurement stays `insufficient-evidence` and cannot close a task.
        - Replaced the misleading summed `recoverable` count with unique suite/model/question candidates, arm occurrences and shared-across-arm counts. Stages nominate candidate levers, not causal recoveries; counts across different levers must not be summed as unique questions. Callers/tests and Markdown rendering use the new fields; the active-code sweep finds no remaining `recoverable` consumers. No public SDK exports or compatibility baselines changed.
        - Added text-free `docs/_evidence/memory-bench/202/failure-attribution.{json,md}`, derived offline from the seven authoritative completed historical reports with source hashes. The correction preserves **8 Beam and 1 MiniMax preset run limits** as operational failures. Product candidate screening is Task 5: **4 unique suite/model/questions, 6 arm occurrences, 2 shared**; Task 9: **6 unique, 9 occurrences, 3 shared**. Comparator failures contribute nothing. Historical stage-only causes remain explicitly heuristic because compatible validated-label stage counts were not saved; no corrected labels or delivery measurements were invented. These provisional historical nominations cannot establish final corrected-protocol lever decisions or close unmeasured tasks. Original reports, archived bytes, scores, criteria and baseline manifest are unchanged; the active baseline README points to the correction and keeps the old table historical.
        - Tests first: the named four regressions failed before implementation, together with the existing run-limit integration assertion; added coverage for denominator retention, conflicting duplicate ids, absent fine-evidence measurements, measured below-threshold closure, inconsistent saved scores, unresolved source labels and held-out restaging. Full harness: `timeout 900 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun test --timeout=0 scripts/memory-bench` — **306 pass / 1 Docker-dependent skip / 0 fail**. After the final outcome histogram/score-normalization adjustment, `timeout 180 bun test scripts/memory-bench/baseline.test.mjs` — **17 pass / 0 fail**. Biome passes with the inherited unused `attempt` warning in `run.test.mjs`; `git diff --check` passes.
        - `timeout 180 bun run typecheck` still fails on the previously recorded unrelated `packages/providers/hyper/src/models.ts:172` TS2345 (`number | undefined` passed as `number`), also surfaced through keyring/prism-agent. Additional `timeout 180 bun test --timeout=0 src/__tests__/docs.test.ts` reports **62 pass / 3 fail** outside this task: existing `docs/next/hooks.md` navigation, remaining `docs/next`, and examples emit exit 2. Those files/flows were not changed by Task 4.4. Bench README documents the outcome/cause and counting contracts; no public docs/index change, package/kernel/host edits, dependency, provider/model/embedding calls or held-out inspection.
        - Task 4 remains unchecked. The broad campaign stays paused for Tasks 4.5–4.8. New compatible measurements, judge controls and the corrected pilot/readiness gate are still required; this task does not execute later lever tasks or change the criteria.

    - [x] Task 4.5: Validate zero-score abilities before buying more answers
      - Acceptance Criteria:
        - Functional: Audit the existing four development ordering and four summarization questions against their source messages and rubrics. Check each judge with the gold answer as a positive control and a deliberately incorrect answer as a negative control. Run a labelled evidence-only answer diagnostic and, once eligible under 4.2, a complete-history comparison. Record per-judge verdicts and explain disagreements, bad labels, missing source evidence and model failures separately.
        - Functional: Correct demonstrated adapter/prompt/judge defects before scaling. Do not declare an instrument broken solely from 0/4, silently drop an ability, or treat repeated arms on the same questions as independent samples. The human-calibration waiver remains explicit; model-assisted auditing is never labelled human calibration.
        - Performance: Start with these eight existing development questions and saved answers where compatible; publish a call/token ceiling before live work. Expand only if a named unresolved diagnostic warrants it, using development/residual ids and never held-out partitions.
        - Code Quality: Reuse private `audit/`, answer checkpoints and panel machinery. Oracle/evidence-only results are diagnostics and never enter product acceptance.
        - Security: Private local review artifacts may contain source/gold/answer text; committed summaries contain ids and findings only.
      - Approach:
        - Documentation Reviewed / References: `judge.mjs:153–171` (generic ability fallback), `judge.mjs:58–66` (tie rule); `datasets.mjs:372–406`; Task 3 human-audit waiver.
        - Options Considered: Immediately purchase 16 new full-context answers — rejected until labels, grading and comparator eligibility are checked. Drop the zero-score abilities — rejected as a post-hoc change to the target.
        - Chosen Approach: Source audit and judge controls first, then a bounded evidence-only/full diagnostic; retain a checkpoint for every newly generated answer so rejudging does not require reanswering.
        - Files to Create/Edit: `scripts/memory-bench/{judge,baseline}.mjs`, `scripts/memory-bench/judge-prompts.json`, and `scripts/memory-bench/audit/zero-score{,.test}.mjs`; bench README; text-free diagnostic summary under `docs/_evidence/memory-bench/202/`. The dedicated audit test file holds the three named regressions; baseline filtering explicitly excludes diagnostics.
      - Test Cases to Write:
        - `ordering_and_summary_judge_controls_detect_inverted_or_overstrict_grading`.
        - `ability_rubrics_reach_judging_but_not_answer_generation`.
        - `oracle_diagnostic_cannot_enter_product_acceptance`.
      - Documentation/Wiki Assessment: Record diagnostic protocol, limits, outcomes and calibration status in the bench README/evidence; no public API/index change; use `.agents/skills/create-plan/references/prism-wiki.md`.

      - Notes (partially executed 2026-10-28, **completed 2026-10-28 on the owner-directed OpenRouter free panel**):
        - Audited the eight existing frozen development ids locally against their source annotations and rubrics: **56/56 references resolve**, 55 unique message references within questions, **six conversation clusters**. All four ordering sequences are supported. A repeated reference on `1:event_ordering:1` correctly covers two successive rubric points; the initial missing-step suspicion was disproved. Summary annotations include assistant recommendations, which do not independently establish user adoption; this is a label-provenance limitation, not a demonstrated adapter defect. No gold, draw, ability or historical score changed. No held-out text was inspected. Details: `docs/_evidence/memory-bench/202/zero-score-abilities.{json,md}`.
        - Fixed the demonstrated grading-path defect: BEAM rubrics now reach judges as untrusted JSON alongside reference/question/response. Ordering requires requested count and chronology; summaries require rubric coverage while accepting paraphrases. The template hash changes, invalidating old verdict caches. Normal answer generation still excludes grading metadata. Oracle reports and explicitly diagnostic reports are excluded from baseline cells, product comparisons and lever rankings. No kernel/package/host/export/dependency/compat change.
        - Added the bounded, checkpointed `audit/zero-score.mjs` runner, reusing the existing replay, answer cache and judge-panel machinery. Before live calls declared **160 wire attempts / 5M input / 300k output tokens / 60 minutes**, serial, eight development ids only, `opencode-go/mimo-v2.5` answerer with Qwen/Kimi judges. Gold-positive and wrong-negative controls must pass before any new answers. Saved historical scores cover 56 arm occurrences but **zero answer texts** were available for these ids; they cannot be rejudged or counted as independent samples. All eight histories fit the existing selector locally at the catalog-derived **870,976** input cap with zero source-message removal; this does not establish live full-context delivery.
        - **External blocker:** the original judge path made 24 rejected attempts; one bounded follow-up confirmed HTTP 429 **`GoUsageLimitError`, monthly usage limit exhausted**. Total **25 rejected attempts, zero reported input/output tokens, zero completed controls, zero new answers**. The runner then stopped immediately on HTTP 429 (amended in the completion notes below); private gateway metadata stays under `.cache/memory-bench/audit/4.5/`. No alternative paid provider or broader grid was started, and no owned diagnostic process remains. Per-judge controls and evidence-only/full answers remain explicitly unexecuted, not scored false or assumed successful. The owner's human-calibration waiver remains in force; local model-assisted review is not human calibration.
        - Tests first: the three named regressions failed before the changes and passed afterwards, including explicit inverted/overstrict controls, a provider spy proving rubric exclusion from normal generation, and diagnostic aggregation exclusion. Full harness: `timeout 900 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun test --timeout=0 scripts/memory-bench` — **310 pass / 1 skip / 0 fail**. Final focused audit/baseline/measurement suites: **36 pass / 0 fail**. Biome passes. `timeout 180 bun run typecheck` still fails on inherited `packages/providers/hyper/src/models.ts:172` TS2345 (`number | undefined` passed as `number`), also reported by dependent workspaces; left untouched.
        - **Resume retried 2026-10-28 (superseded by the owner-directed free-panel completion below):** the documented timeout-bounded command stopped on its first wire attempt with HTTP 429 `GoUsageLimitError` (`Go usage limit exceeded`; this response does not name the quota period). No controls or answers completed; input/output usage was zero. The cumulative diagnostic total is now **26 rejected attempts**. Updated the text-free evidence with this attempt; source/gold/answer text and gateway metadata remain private. Re-ran the focused audit/baseline/measurement suites: **36 pass / 0 fail**. No provider substitution, broad campaign, held-out inspection or product change. Task 4.5 remains unchecked because its live acceptance criteria are still unmet.
        - **Owner direction (2026-10-28): OpenCode Go and Hyper are out of usage; use OpenRouter free models.** Answer model `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`, judges `openrouter/dots-studio/dots-3-note-preview:free` (family dots) and `openrouter/cohere/north-mini-code:free` (family cohere); neither judge answers an arm and no paid provider or grid expansion was used.
        - **Two harness corrections, tests first.** (1) A transient free-pool `429` (upstream shared pool busy) was wrongly treated as the end of the diagnostic; it now retries four times with backoff, still counts as a wire attempt, and only the free-per-day cap stops the run. (2) The declared free answer model is a reasoning model: with thinking enabled every complete-history answer spent the 8192-token output budget on unfinished deliberation and returned no answer at all, so the audit runs it with `reasoning: { enabled: false }`. That changes the answer identity, so no reasoning-only answer is reused; those rows were never gradeable, are ignored rather than rejudged, and are not evidence.
        - **Controls pass, so the 0/4 is not a broken ruler.** Gold answer accepted 16/16 (8 questions × 2 judges), deliberately wrong answer rejected 16/16. A content-held-constant probe then judged a faithful paraphrase of the gold answer with the rubric verbatim and with the `LLM response should contain:` boilerplate stripped: **8/8 accepted**, so the panel is not enforcing a phrasing bar and the boilerplate is not the cause. Verdicts are one word only; no rationale was requested, and no judge was calibrated against human labels.
        - **Diagnostic results.** All eight complete-history contexts were live-eligible with zero source messages removed and no truncation. Evidence-only answers: **2/8** panel-correct. Complete history: **0/8**. One judge disagreement (`13:event_ordering:0`, evidence only), adjudicated as a panel false negative because the answer reproduces the labelled five-item order and covers all five rubric topics. Five further evidence-only rejections are strict but defensible: each omits a named rubric element. All eight complete-history rejections are answer-model failures on content (unlabelled or contradicted specifics, diluted rubric topics, or an item order that is not the labelled order), not label, adapter or judge defects.
        - **Consequence:** no ability was dropped, no gold label rewritten, and the historical 0/4-per-ability signal is consistent with answer failures rather than instrumentation. The free panel stays **development-diagnostic only**: uncalibrated, 15/16 inter-judge agreement, one false negative, so no acceptance or lever decision may rest on it and Task 18's cross-family calibrated panel still governs. Oracle and diagnostic rows remain excluded from baseline cells, product comparisons and lever rankings.
        - **Usage and evidence.** Cumulative across the three free-panel executions (one superseded, one stopped by a judge transport failure, one completed): **100 wire attempts, 1,457,267 input tokens (393,120 cached), 107,409 output tokens, $0**, inside the declared 160-attempt / 5M / 300k / 60-minute ceiling. Text-free results, controls and per-question verdicts: `docs/_evidence/memory-bench/202/zero-score-abilities.{json,md}`; private source/gold/answer text stays in `.cache/memory-bench/audit/4.5/`. No held-out text was inspected and no acceptance, corrected score or lever claim was made.
        - **Validation.** Tests first: the new `free_pool_429_is_transient_but_daily_cap_stops_the_diagnostic` failed before the classifier existed and passes with the three named regressions. Full harness: `timeout 900 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun test --timeout=0 scripts/memory-bench` — **312 pass / 1 environment-dependent skip / 0 fail**. Benchmark README updated for the `429` rule, the reasoning configuration and the outcome. `timeout 180 bun run typecheck` still fails only on the inherited `packages/providers/hyper/src/models.ts:172` TS2345; Biome passes. No kernel/package/host/export/dependency/compat change and no `docs/index.md` change.
        - **Next:** Task 4 remains unchecked; the broad campaign stays paused for Tasks 4.6–4.8 (paired acceptance sizing and the corrected pilot), which are untouched by this subtask.
        - **Post-completion evaluation (2026-10-28, owner-approved; supersedes the "Consequence" reading above).** Task 4.5 stays checked: its written criteria are met. Its conclusion is narrowed from "the 0/4 is answer failure, not a broken instrument" to **"grading is not inverted; resolution is insufficient for screening or lever decisions"**, for four reasons:
          - **Binary grading floors partial answers.** The `beam-rubric` template (`judge-prompts.json:13`) requires every rubric point, and with two judges `combineVerdicts` (`judge.mjs:55–60`) is an AND rule. An answer covering 4 of 5 rubric points scores the same as one covering none, and the five "strict-but-defensible" rejections are those near-misses. BEAM's upstream protocol is recalled to grade per rubric point (0 / 0.5 / 1) and ordering by Kendall's tau; this is unverified locally and Task 4.5.1 verifies it.
          - **Oracle ceiling.** Labelled evidence alone scored 2/8 (3/8 adjudicated). No retrieval lever can exceed that ceiling, and binary scores on four questions per ability cannot show a lever difference.
          - **The complete-history 0/8 is not product-representative.** It used a different answer model from the historical cells, with thinking disabled to fit an 8192-token output cap, although the recorded comparator limit is 128k output tokens. The historical zeros have no saved answer texts and stay unattributed.
          - **"Unlabelled or contradicted specifics" were not checked against the full source.** Correct details from outside the labelled evidence, or later messages that make an advice-only summary label stale, would be label or judge effects, not answer failures.
          - The controls were the easy extremes: gold versus wrong, plus a paraphrase probe on only 2 of 8 questions. No borderline control (one rubric point missing, an adjacent swap, a reversed order) was run.
          - Task 4.5.1 resolves these points before 4.6 sizing and the 4.7 pilot. Until then, `event_ordering`/`summarization` zeros are not attributed to the answer model or the product.

    - [x] Task 4.5.1: Pre-register graded rubric scoring and close the 4.5 attribution gaps
      - Acceptance Criteria:
        - Functional: Verify BEAM's upstream scoring for `summarization` and `event_ordering` (per-rubric-point credit, the ordering metric, and how Kendall's tau or its equivalent is extracted) against the pinned BEAM source or paper, and record the citation. Then pre-register a graded score for BEAM rubric abilities. Summaries score the fraction of rubric points covered (with 0.5 credit if upstream defines it). Ordering scores the upstream ordering metric over the labelled items, normalized to [0, 1], with missing items handled as upstream does. Panel aggregation is the mean across judges, with a disagreement rate reported. The binary verdict stays computed and reported unchanged next to it.
        - Functional: Register the graded score as the **primary Task 4 screening and lever-ranking metric for BEAM rubric abilities**, with binary as secondary. `robustness-criteria.json` and Task 18's frozen binary acceptance metric are **not** changed by this subtask. Moving Task 18 onto the graded score would be a separate, versioned, owner-decided prospective amendment made before any held-out run, never a retroactive reclassification. The registration happens before 4.6 sizing or any 4.7 pilot answer is generated.
        - Functional: Add borderline judge controls for all eight 4.5 development ids, built locally from gold: gold minus one rubric point; for ordering, one adjacent pair swapped and the full order reversed; for summaries, gold plus correct extra detail. Expected results: binary rejects every degraded variant; graded scores about (k−1)/k for gold minus one point, keeps an adjacent swap clearly above a reversed order, scores a reversed order at the floor, and does not penalize correct extra detail. Any mismatch is a judge or template defect, fixed with a test before scaling. Run the paraphrase probe on all eight ids, not two.
        - Functional: Re-judge the existing private 4.5 evidence-only and complete-history answer checkpoints under the graded score, with no new answers. Report per-question graded and binary scores, and the evidence-only (oracle) ceiling per ability.
        - Functional: Classify every claim behind the eight complete-history rejections locally against the **full** conversation source as: correct-but-unlabelled, contradicted by the labelled evidence, superseded by a later message (stale label), or unsupported. Report the counts per question. If correct-but-unlabelled or stale-label claims drove a rejection, record that as a label or judge finding, not an answer failure, and do not rewrite gold. Retain the 4.1 advice-versus-adoption caveat.
        - Functional (optional, $0 only): Re-answer the eight complete-history questions with thinking on and the output cap raised to at least 32k (within the recorded 128k comparator limit), under a new answer identity, and judge them graded and binary. This separates "starved model" from "weak model". Skip it if free quota is unavailable and record it as not executed. It never substitutes for the declared pilot answer model.
        - Performance: No paid calls. Re-judging reuses checkpoints; the controls and optional re-answers declare a call/token/wall-time ceiling before live work, on the owner-directed OpenRouter free panel, with the 4.5 transient-`429` rule. Eight development ids only; no expansion and no held-out ids.
        - Code Quality: The graded score extends the existing judge and score path (`judgePrompt`, `combineVerdicts`, `scoreCached`) with a new, versioned judge-template hash, so binary caches stay valid and graded caches are distinct. No parallel scorer, no speculative abstraction. Diagnostic and oracle rows stay excluded from baseline cells, product comparisons and lever rankings.
        - Security: Gold variants, source text, answers and judge outputs stay private under `.cache/memory-bench/audit/4.5.1/`. Committed evidence carries ids, counts, scores and classifications only. Judge input stays untrusted JSON. The human-calibration waiver stays explicit; model-assisted review is never labelled calibration.
      - Approach:
        - Documentation Reviewed / References: Task 4.5 notes and their post-completion evaluation; `judge-prompts.json:13` (`beam-rubric`, all points required); `judge.mjs:55–60` (`combineVerdicts`, AND rule with two judges), `judge.mjs:154–168` (`judgePrompt` BEAM rubric path); `run.mjs:1018–1035` (`scoreCached`, panel aggregation); `audit/zero-score.mjs:32–218` (`runZeroScoreAudit`, checkpoints; per-question panel verdict at :201), `:18` (`ANSWER_COMPAT` reasoning off), `:129` (`maxTokens: 8192`); `datasets.mjs:325` (rubric/reference annotations); `robustness-criteria.json` `bfc` (frozen binary acceptance); `zero-score-abilities.json` `localComparatorModelLimits` (128k output). BEAM upstream scoring: the pinned BEAM release's evaluation code or paper (to verify in this task).
        - Options Considered:
          - Keep binary only and treat 0/4 as answer failure: rejected, because binary floors partial answers and four questions per ability cannot rank levers.
          - Replace binary outright, including Task 18: rejected here, because it changes frozen acceptance and needs its own versioned owner amendment.
          - Buy new paid answers to re-test: rejected, because the existing checkpoints can be re-judged at no cost.
          - Hand-score partial credit locally: rejected as a substitute for the judge path, but kept as the borderline-control expectation.
        - Chosen Approach: Verify upstream scoring, add a graded panel score in the existing judge path, prove it with borderline controls, re-judge saved answers, and attribute complete-history rejections against the full source. All of this is pre-registered before 4.6/4.7 see outcomes.
        - Files to Create/Edit:
          - `scripts/memory-bench/judge.mjs`, `scripts/memory-bench/judge-prompts.json`, `scripts/memory-bench/run.mjs`: graded rubric scoring path.
          - `scripts/memory-bench/audit/zero-score{,.test}.mjs`: controls, re-judge, classification and optional re-answer.
          - `scripts/memory-bench/{report,baseline}.mjs`: report graded next to binary for rubric abilities.
          - `scripts/memory-bench/measurement.test.mjs`: panel aggregation.
          - `scripts/memory-bench/README.md`.
          - `docs/_evidence/memory-bench/202/graded-rubric-scoring.{json,md}`: new file (chosen over a section in `zero-score-abilities`); `audit/graded.mjs` is a new runner file beside `zero-score.mjs`, which keeps the shared `openDiagnostic` session, and `baseline.test.mjs` carries the ability-row test.
          - Before editing, trace `combineVerdicts`, `judgePrompt` and `scoreCached` callers with `graft callers <sym> --depth all` and update every caller together.
      - Test Cases to Write:
        - `graded_rubric_score_gives_partial_credit_and_keeps_binary_unchanged`: binary still fails gold minus one point; graded scores about (k−1)/k. Fails if graded collapses to binary or binary changes.
        - `ordering_graded_score_ranks_adjacent_swap_above_reversal`: fails if the ordering metric ignores order or degenerates to set overlap.
        - `graded_panel_is_mean_with_disagreement_rate_not_and_rule`: fails if graded aggregation reuses the binary AND.
        - `graded_template_hash_is_distinct_and_binary_cache_still_hits`: fails if the template change invalidates binary caches or shares a graded cache key.
        - `graded_score_cannot_change_frozen_task18_criteria_hash`: fails if `robustnessCriteriaHash()` changes.
        - `complete_history_claims_classified_against_full_source_not_labels_only`: fails if the classifier reads only labelled evidence.
        - `oracle_diagnostic_cannot_enter_product_acceptance` (existing) stays green.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: no; this is benchmark-harness scoring only.
        - Docs pages to create/edit: `scripts/memory-bench/README.md` (graded-score definition, upstream citation, primary/secondary registration, Task 18 unchanged, borderline-control protocol and results); evidence under `docs/_evidence/memory-bench/202/`.
        - `docs/index.md` update: no.
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

      - Notes (executed 2026-10-28):
        - **Upstream scoring verified** against BEAM `src/evaluation/compute_metrics.py`, `report_results.py` and `src/prompts.py` at `b2da22eac88bb0874c64665f13457eb99835774a` (the recalled protocol was right in outline): every rubric point is judged separately on 0 / 0.5 / 1 and the ability score is the mean (`llm_judge_score`); `event_ordering` computes Kendall tau-b over the union of rubric and response items with missing items tied last, normalised to `tau_norm = (tau+1)/2`, and `final_score = tau_norm x F1`. Upstream's report prints `tau_norm` for ordering and `llm_judge_score` for everything else.
        - **Registered, before any 4.6/4.7 answer:** the graded score (mean across judges, disagreement when spread > 0.2) is the primary Task 4 screening and lever-ranking metric for `summarization` and `event_ordering`; binary stays computed and secondary. Ordering primary is `tau_norm x F1`, not the `tau_norm` upstream prints, because `tau_norm` alone scores a perfectly ordered four of five items 1.0 and omission is what a retrieval lever changes. Stated deviations: one judge call scores all points (or maps the response's items to rubric numbers) instead of one call per point, to fit the free-model ceiling, with tau and F1 computed locally; a response naming no labelled event is the floor where upstream gives NaN. **Task 18 is unchanged**: `robustnessCriteriaHash()` is pinned by a test. Graded templates live under `graded` in `judge-prompts.json`, outside `prompts`, so `JUDGE_TEMPLATE_VERSION` and every binary cache key are unchanged and graded verdicts have their own key kind and version.
        - **Borderline controls, 36 variants over all eight ids x 2 judges:** binary **72/72** as expected (accepts gold, extra detail and paraphrase, rejects minus-one, swap and reversal); graded **71/72** within 0.2 of the closed-form expectation. Ordering: gold 1, adjacent swap 0.90/0.93/0.90/0.67, reversal 0 on every id; minus-one panel 0.71/0.66/0.71/0.53 against expected 0.71/0.79/0.71/0.53. Summaries: minus-one 0.8 on 4/4, extra detail 1.0 on 4/4 (not penalised). The one miss is a single judge (`cohere`) failing to match one response item on `5:event_ordering:0` minus-one (0.54 vs 0.79); the panel mean 0.66 is inside tolerance and the 0.25 spread is correctly flagged as disagreement. Judged noise, not a template defect, so no template change. The paraphrase probe now covers all eight ids (model-written paraphrase of gold): accepted by both judges and graded 1.0 by both on 8/8.
        - **Re-judge of the saved 4.5 answers under the graded score (no new answers).** Evidence-only (oracle) ceiling, graded: **event_ordering 0.899** (1.0, 0.595, 1.0, 1.0) and **summarization 0.838** (0.65, 0.80, 0.90, 1.0); binary panel for the same answers is 0/4 and 2/4. Complete-history graded: **event_ordering 0.187** (0.12–0.30) and **summarization 0.375** (0.10–0.60); binary 0/8. So binary did floor partial answers: three of four ordering oracle answers reproduce the labelled order exactly (graded 1.0) yet binary scored all four 0, and the four summarization oracle answers cover 65–100% of the rubric. The ceiling for any lever on these ids is therefore about 0.9 / 0.84, far above the binary 0 / 0.5. Three of 16 answers carry a judge disagreement flag. The complete-history ordering answers match only 1–3 of the 3–6 labelled items (F1 0.2–0.67), which is the main driver of their low graded score.
        - **Complete-history claim classification against the full source (228 claims; ordering and flagged claims read by hand, the rest by number/name triage, so semantic contradictions with no shared number or name are not excluded).** supported-labelled 37 (2/3/0/0 ordering, 4/2/11/15 summaries), **correct-unlabelled 130** (2/3/5/3, 20/20/29/48), **contradicted 0, superseded 0**, **unsupported 5** (one assistant-proposed April 3 schedule presented as a user event in `13:event_ordering:0`; three tool/format specifics absent from the conversation in `1:summarization:1` (OpenAPI/Mermaid, JSONB, OIDC) and one in `8:summarization:1` (STAR-formatted)), synthesis 56. Correct-but-unlabelled claims dominate, so the complete-history rejections are **a label and granularity finding, not an answer-correctness failure**: the answers list true topics the labelled rubric does not name, and for ordering they pick a coarser or different set than the labelled one. Gold is not rewritten. The 4.1 advice-versus-adoption caveat is retained and one concrete instance is the April 3 claim. A later-message supersession was checked on the flagged numeric claims (for example the 50-to-42 work-hours claim uses the later, updated value) and none was found.
        - **Correction to the 4.5 notes:** the 4.5 replay answers ran at the harness default `maxTokens: 4096`, not the 8,192 recorded (8,192 applied to the judge and audit agents only). No answer was truncated (longest about 1.7k tokens, `truncated: false` on all 16), so this does not change the 4.5 results, but the cap should be quoted correctly.
        - **Optional thinking re-answer: partially executed, 2 of 8, then stopped.** Thinking on, output cap 32,768 (under the 128k comparator limit), new identity `4.5.1-thinking-v1`. Both attempted ordering questions (`13:event_ordering:0`, `5:event_ordering:0`) spent the full 32,768 output tokens thinking and returned no answer (`run_limit`). The pattern was clear and each attempt takes roughly ten minutes, so the other six were not run. This is evidence that the thinking configuration cannot be the pilot answer configuration for this free model; it does not separate "starved" from "weak". It never substitutes for the declared pilot answer model.
        - **Usage.** Cumulative across all executions including resumes: 189 logged exchanges, 370,710 input and 277,570 output tokens, $0 (free models), inside the declared 400-attempt / 8M / 700k / 2h ceiling. One execution failed on a judge `terminal error` stream and a later one hit a 502 from the gateway; both retried and completed (the runner retries a judge up to three times). A result-shape bug that overwrote per-judge scores with the panel mean in the control rows was found mid-run and fixed before any control was judged, with the cached verdicts reused.
        - **Tests first, all named cases green** in `audit/zero-score.test.mjs`: `graded_rubric_score_gives_partial_credit_and_keeps_binary_unchanged`, `ordering_graded_score_ranks_adjacent_swap_above_reversal`, `graded_panel_is_mean_with_disagreement_rate_not_and_rule`, `graded_template_hash_is_distinct_and_binary_cache_still_hits`, `graded_score_cannot_change_frozen_task18_criteria_hash`, `complete_history_claims_classified_against_full_source_not_labels_only`, plus `claim_classes_use_reviewer_overrides_then_triage_then_topic_rule`, `graded_panel_scores_every_judge_and_reuses_the_cache`, and `baseline_ability_rows_report_graded_mean_next_to_binary_accuracy`; `oracle_diagnostic_cannot_enter_product_acceptance` stays green. Full harness: `timeout 900 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun test --timeout=0 scripts/memory-bench` — **321 pass / 1 environment-dependent skip / 0 fail** (was 312). Biome passes on the touched files. `bun run typecheck` still fails only on the inherited `packages/providers/hyper/src/models.ts:172` TS2345. No kernel/package/host/export/dependency/compat change and no `docs/index.md` change.
        - **Findings that amend later tasks:** (1) 4.6 sizes on the graded estimand with these ceilings, and with four ids per ability the minimum detectable paired difference will exceed the headroom for at least `event_ordering` unless the cluster supply grows, so expect that ability to be recorded **not lever-discriminating at this sample** rather than screened silently. (2) 4.7 must run the pilot answer model in the configuration it can finish (the free thinking model cannot at 32k), and the ordering rubric labels are coarser or different from what a full-history answer enumerates, so ordering results must be read as label-matching, not recall alone. (3) Nothing in 4.5.1 is human calibration.

    - [x] Task 4.6: Specify paired analysis and acceptance sizing before resumption
      - Acceptance Criteria:
        - Functional: Join arms by unique question id and matching conversation cluster; report paired differences, clustered CIs, discordant wins/losses, independent cluster counts and the declared multiplicity treatment. Missing/mismatched ids are refused or explicitly reported as incomplete comparisons. Overlapping marginal CIs are not a significance test.
        - Functional: Distinguish Task 4 descriptive/lever screening from Task 18 acceptance. Record a prospective paired, clustered non-inferiority sizing assessment for the unchanged 3-point margin, with target power, alpha, discordance/cluster assumptions, sensitivity and feasible independent-cluster supply. If infeasible, state the claim is unresolved; do not silently widen the margin or claim a universal paired sample size from independent-arm `powerForDiff`.
        - Functional (added 2026-10-28 from the 4.5 evaluation): Size BEAM rubric abilities on the 4.5.1 graded score as a continuous paired estimand, with binary sizing reported alongside it. Use the per-ability evidence-only (oracle) score from 4.5.1 as the stated ceiling for any lever effect. For each ability, state the minimum detectable paired difference at the feasible cluster supply. If that difference exceeds the room below the oracle ceiling, record the ability as **not lever-discriminating at this sample** rather than screening on it silently.
        - Performance: Use existing statistics and local simulations; repeated answers from the same conversation do not count as new independent clusters. No paid calls for sizing.
        - Code Quality: Pin analysis, dataset, normalization, judge and context-policy revisions in the resumed manifest. Preserve the original criteria and old evidence; any owner-requested criterion change is an explicit versioned amendment before future runs, not retroactive reclassification.
        - Security: Statistical artifacts use ids, cluster keys and scores only; partition guards and original frozen draws remain intact.
      - Approach:
        - Documentation Reviewed / References: Task 4.5.1 (graded score registration, oracle ceilings); `stats.mjs:70–117` (paired cluster analysis), `stats.mjs:138–160` (independent-arm historical power helper), `stats.mjs:175` onward (paired simulation); `baseline.mjs:307–329` (point gaps); Task 18 and `robustness-criteria.json`.
        - Options Considered: Relax non-inferiority to fit the observed sample — rejected because it changes the claim after seeing outcomes. Buy more repeats on the same few histories — rejected as a substitute for independent conversation coverage.
        - Chosen Approach: Reuse paired cluster statistics for reporting, and document acceptance feasibility separately from the broad diagnostic baseline.
        - Files to Create/Edit (execution scope): `scripts/memory-bench/{baseline,stats,run,baseline.test,stats.test,run.test,paired-sizing,paired-sizing.test}.mjs` and bench README; prospective protocol and sizing evidence under `docs/_evidence/memory-bench/202/`. Reuse the frozen `robustness.mjs` draws without editing them; Task 4.8 owns the executable resumed manifest.
      - Test Cases to Write:
        - `baseline_gaps_pair_unique_ids_and_matching_clusters`.
        - `repeated_questions_do_not_increase_independent_cluster_count`.
        - `analysis_revision_refuses_incompatible_prior_cells`.
        - `acceptance_sizing_uses_declared_noninferiority_design`: the declared null boundary, target power and clustering govern the assessment rather than the historical superiority helper.
        - `rubric_ability_sizing_uses_graded_estimand_and_flags_oracle_ceiling`: fails if sizing for a BEAM rubric ability uses binary only, or if an ability whose minimum detectable difference exceeds its oracle headroom is not flagged.
      - Documentation/Wiki Assessment: Bench README/evidence documents paired estimands, multiplicity, screening limits, sizing and protocol amendments. No public API/index change; use `.agents/skills/create-plan/references/prism-wiki.md`.
      - Notes (executed 2026-10-28):
        - **Paired reporting.** Baseline gaps now use unique question ids, matching abilities and conversation clusters, whole-cluster bootstrap 95% CIs, cluster sign-flips, discordant wins/losses and independent cluster counts. Incomplete pairings, duplicate ids, missing scores and incompatible provenance yield `incomplete` with no gap; operational failures stay end-to-end zeros. Holm spans all emitted overall, ability-binary and ability-graded tests within a summary; CIs are pointwise and all Task 4 comparisons are descriptive. Equivalent comparator repeats remain one treatment. Graded primary comparisons and screening limits appear alongside binary rows; a stage-based `needed` flag identifies a candidate, not a demonstrated lever effect.
        - **Prospective acceptance sizing.** New `paired-sizing.mjs` writes `docs/_evidence/memory-bench/202/paired-analysis-sizing.{json,md}` locally. H0 is candidate minus comparator ≤ −0.03, alternative difference 0, one-sided alpha .025 and target power .8. Sensitivity uses paired discordance .10/.25/.50 and paired-difference ICC 0/.5/1 with actual frozen cluster sizes. All 27 in-window `heldout-a` scenarios are underpowered: **the acceptance claim remains unresolved**, with no margin or metric amendment. BEAM-100K/LoCoMo/MemoryAgentBench-CR supply only 14/9/7 held-out conversations. Normal planning approximations and their small-cluster limitations are explicit; LongMemEval-M id counts are only optimistic bounds until haystack clusters are verified. Repeats and additional answer models do not add histories; disjoint ids do not guarantee conversation-disjoint partitions.
        - **Rubric sizing.** Task 4.5.1's graded oracle ceilings are 0.8988 (ordering) and 0.8375 (summary), against complete-history means 0.1873 and 0.3750. Graded SD sensitivity and binary discordance sensitivity are recorded separately. The 3/4 independent development conversations imply minimum two-sided sign-flip p-values .25/.125, so no finite effect reaches .05; both abilities are **not lever-discriminating at this sample**, even before Holm. The normal MDEs and oracle headroom are also reported. Oracle scores remain diagnostic-only and are not product evidence or human calibration.
        - **Provenance and scope.** `202-paired-cluster-v1`, analysis-source hashes, frozen dataset/draw hashes, adapter normalization, binary/graded judge templates and context-policy sources are pinned in the prospective protocol and new baseline manifests. Run/checkpoint and completed-cell reuse fingerprints now include the analysis revision and template versions; incompatible historical cells fail closed. The old evidence, criteria, draws, product, kernel, packages, exports and hosts were preserved. No dependency or model call was added to sizing. The sizing command reads frozen id metadata and the text-free development audit, not held-out corpus text.
        - **Verification.** `timeout 300 bun test --timeout=0 scripts/memory-bench`: **326 pass / 2 existing skips / 0 fail**; final focused recheck of stats/baseline/sizing/audit suites: **53 pass / 0 fail**. All five named Task 4.6 regression cases pass, including rejection of incompatible resume/reuse. `timeout 30 bunx biome check` on the eight changed JS/test files passed with one inherited unused-parameter warning (`run.test.mjs`, `attempt`); `git diff --check` passed. The first whole-suite attempt hit a 90-second shell timeout during the cached 2.7 GB dataset check; the 300-second run completed in 97 seconds. `timeout 180 bun run typecheck` still fails on the previously recorded unrelated `packages/providers/hyper/src/models.ts:172` TS2345, also surfaced through keyring/prism-agent; no task-owned typecheck error was reported.
        - **Next boundary.** Task 4 stays unchecked and the broad campaign stays paused. Task 4.7 must declare a finishable answer configuration and panel, retain the rubric screening limits and complete the corrected pilot. Task 4.8 must refresh the protocol/product hashes, reconcile models/limits/quotas, decide historical reuse and freeze the executable manifest only after readiness passes. No paid work or pilot was started here.

    - [x] Task 4.7: Run a bounded corrected pilot and diagnose completion limits
      - Acceptance Criteria:
        - Functional (added 2026-10-28): For BEAM rubric abilities, report the 4.5.1 graded score as primary and binary as secondary for every arm. Include the labelled-evidence oracle as a diagnostic-only ceiling row, excluded from comparisons and lever rankings. A complete-history arm run under a capped output budget or with reasoning disabled is labelled as such, and is not presented as the product configuration.
        - Functional: After 4.1–4.6 (including 4.5.1) pass, freeze a small, ability-balanced development pilot on one declared answer model with eligible complete-history, lexical-topk, passive and preset arms. State whether `full-truncated` is a distinct treatment or an equivalent-policy repeat. Preserve answer checkpoints and report all intended ids, outcomes, annotated evidence coverage, paired differences, separated timing and role cost.
        - Functional: Investigate Beam preset's historical 8/40 run limits versus MiniMax's 1/40: identify repeated calls, tool-result handling and stopping behavior from bounded traces. Distinguish harness defects from product/model behavior; retain genuine run limits as failures. Do not raise turn budgets, change prompts or tune product behavior mid-pilot; version and rerun affected pilot comparisons if a repair is required. Product improvements belong in their measured lever task.
        - Performance: Declare question ids, call/token/wall-time ceilings, concurrency and annotation policy before running; use existing subscription authorization and fail clearly on exhausted quota. No automatic expansion into the remaining broad grid.
        - Code Quality: Use the existing campaign/journal/checkpoint paths. A pilot report includes a disposition for every requested cell, with no failed or ineligible cell silently omitted.
        - Security: Development-only, private text traces bounded/redacted; public report holds ids/counts and retains the calibration-waiver disclosure.
      - Approach:
        - Documentation Reviewed / References: `run.mjs:985–1112` (answer/checkpoint/outcome path); `replay.mjs:824–851` (tool traces); `baseline.mjs:108–197` (manifest); Task 4 historical seven-cell reports.
        - Options Considered: Resume all unfinished cells immediately — rejected until a corrected end-to-end pilot verifies the repaired measurements.
        - Chosen Approach: One bounded pilot validates the harness; document residual product failures without expanding prerequisite work into Tasks 5–17.
        - Files to Create/Edit (execution scope clarified 2026-10-29): `scripts/memory-bench/audit/{pilot,pilot.test,pilot-rejudge,pilot-rejudge.test}.mjs` are fixed pilot/scoring entry points, reusing the existing replay, journal, answer-cache, timing, scoring and paired-statistics paths without expanding the broad campaign. Existing `scripts/memory-bench/{baseline,campaign,run,replay}.mjs` only for demonstrated harness defects, with corresponding tests; versioned manifest/results under `docs/_evidence/memory-bench/202/{pilot,pilot-v2,pilot-v3}/`; bench README. The recall-counter reset in `replay.mjs` and its regression in `run.test.mjs` are reporting repairs, not a stopping-policy change. The rejudge entry point scores only the frozen failed checkpoint and composes results locally without replacing its answer or refunding failed usage.
      - Test Cases to Write:
        - `pilot_reports_every_requested_cell_including_ineligible_and_failed`.
        - `pilot_stops_at_declared_limits_without_starting_broad_grid`.
        - `pilot_reports_graded_and_binary_for_rubric_abilities_with_oracle_excluded`: fails if either score is missing for a rubric ability or the oracle row enters a comparison.
        - Add a minimal replay regression for each reproduced harness cause of a run limit; if no harness cause is found, record that finding rather than manufacture a fix.
      - Documentation/Wiki Assessment: Bench README and pilot evidence record commands, budgets, protocol, results and unresolved limits. No public API/index change; use `.agents/skills/create-plan/references/prism-wiki.md`.
      - Notes (executed 2026-10-29; started 2026-10-28):
        - **Completed execution, not readiness.** `docs/_evidence/memory-bench/202/pilot-v3/README.md` and `final-results.json` account for **52/52** requested cells: **40** product/comparator answers, **two** diagnostic-only rubric-oracle answers and **ten** equivalent-policy full-truncated dispositions. All **42** executed cells have scores; every rubric cell has graded primary and binary secondary scores. All ten complete-history cells are eligible with zero removed source messages. Oracle rows are excluded from every comparison and lever ranking. Normal answer generation receives no source annotations/rubrics. `evidence-coverage.json` distinguishes comparator history selection from delivered memory ids; `candidateGold` remains a delivered-id proxy, not an exhaustive store-candidate measurement.
        - **Frozen configuration and provenance.** Ten development ids, one per ability, preferring five historical run-limit ids; this completion-enriched screen is descriptive, not an unbiased accuracy estimate. Answerer: `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`; judges: `openrouter/dots-studio/dots-3-note-preview:free` and `openrouter/cohere/north-mini-code:free`. Temperature zero, reasoning disabled for answers, 8,192 output tokens, unchanged eight-turn stop. This is explicitly a capped diagnostic configuration, not the product/acceptance configuration. Seven conversations overall and one per ability cannot establish a lever effect; Task 4.6's rubric screening limits and the human-calibration waiver remain. V1 stopped on judge SSE 502; v2 reran all cells after harness repairs, then stopped on an unclassified terminal judge stream. V3 validates unchanged product/criteria/questions/answer settings/panel/templates before retaining eleven valid v2 rows, rejudges its saved failed answer and attempts the rest. A final, separately frozen judge-only supplement completes the lost full-summary evaluation on the same checkpoint. `results.json`, `scoring-completion.json` and the immutable offline join `final-results.json` preserve all earlier failures and usage. No v1 answer/score is reused; no prompt, product setting or turn budget changed.
        - **Scores and paired analysis.** Binary full/lexical/passive/preset accuracy is **3/10, 3/10, 2/10, 4/10**. Ordering graded full/lexical/passive/preset/oracle is **.295/.235/.150/.314/.526**; summary is **.450/.250/.200/.450/.800**, with binary zero throughout both rubric abilities. Overall paired differences versus full are **0, −.10, +.10**, over ten pairs/seven independent conversations, with pointwise cluster intervals and discordant counts in the JSON. All comparisons are descriptive; no significance, BFC/Robust, lever-opening or default claim is made. Private pre-judge answers and bounded traces remain under `.cache/memory-bench/audit/4.7*`; public artifacts contain ids, hashes, counts and scores only.
        - **Completion-limit diagnosis.** `pilot/historical-completion.json` hashes the original eight Beam and one MiniMax failures in forty questions each. Beam's separately bounded current probe reproduces **eight turns/eight recalls**, zero answer retries and no final answer. Result/hit headers reach subsequent model requests; the final five recorded argument sets are identical. This is a genuine model/product stopping failure, retained as a failure, not lost tool-result delivery or a harness retry loop. MiniMax's historical failing trace has eight turns and **21** calls, including reads/views; its current probe hits a **monthly Go usage limit**, so present result handling cannot be verified and no causal comparison between the historical rates is claimed. Both probe dispositions are retained. Current Nemotron preset cells finish in one to four turns; an ordering call exceeds the advertised four-query limit, receives a validation error and corrects its arguments before finishing. Product improvements stay in their measured lever task.
        - **Demonstrated harness repairs.** `replay.mjs` no longer resets the explicit-recall count on every model request: passive retrieval counts once plus every explicit recall. The regression failed with `1 !== 4` before the fix. `run.mjs:isRetryableJudgeFailure` now retries transient SSE 500/502/504 within the existing attempt ceiling, with a fresh-session 502 regression that failed first. The pilot disposes judge agents correctly, retains bounded non-text events so long streams cannot crowd out tool calls/stops, and continues independent cells after individual evaluation failure while stopping on quota/limits. Continuation and scoring-join tests reject changed protocols, another answer checkpoint or missing scores; failed-call cost remains charged. No kernel, package, host, dependency, export or compatibility-baseline change; no release gate or retirement sweep is applicable.
        - **Operational limits and deviations.** Original primary allowance: **300** wire attempts, **8M** input, **700K** output tokens, **two hours**, serial. Versioned manifests subtract prior observed use; the final supplement declares 16 attempts/250k input/100k output/30 minutes and uses four requests. Including superseded v1, primary work uses **246** attempts, **2,673,235 reported input / 254,371 reported output tokens**, and **74.2 active attempt minutes**. **Eleven exchanges lack usage**: totals are lower bounds, not a reconciled hard-token proof. All incomplete allocations remain charged; aggregate primary journal reservation charge is **24,028,649**, exceeding the original token ceiling. The existing request-planning envelope (5,423,235 input / 344,483 output) is sensitivity evidence, not recovered billing. Elapsed time including engineering, probing and the continuation pause is **295.2 minutes**, an explicit deviation from a single uninterrupted two-hour pilot; do not claim that overall elapsed ceiling passed. `budget-accounting.json` retains the full ledger. Role pricing is $0 on the declared free routes, not complete wire billing. The separate subscription probe uses 11/48 attempts and 232,530 reported input/2,193 output under its own 2M/100K/30-minute allowance. No paid fallback, broad-grid expansion or owned live process remains.
        - **Verification.** `timeout 300 bun test --timeout=0 scripts/memory-bench`: **334 pass / 2 existing skips / 0 fail**. Final artifact assertions pass: 52 dispositions, 42 scored cells, ten eligible full histories, both rubric metrics, no oracle comparison, role totals exactly matching the reported aggregate. Biome passes on all seven changed JS/test files with one inherited unused-parameter warning in `run.test.mjs`; `git diff --check` passes. `timeout 180 bun run typecheck` still fails on inherited Hyper `models.ts:172` TS2345, also surfaced through keyring/prism-agent. Additional docs suite: **62 pass / 3 failures outside this task** — existing `docs/next/` violates the two promotion/navigation checks, and examples emission reproduces the same Hyper TS2345 (confirmed with `timeout 60 bun node_modules/typescript/bin/tsc -p examples/tsconfig.json --noEmit --declaration false --sourceMap false`). Unrelated changes remain untouched.
        - **Next boundary.** Task 4.8 and broad Task 4 stay unchecked. Readiness must explicitly address missing usage/reservation reconciliation, the elapsed-wall deviation, MiniMax's monthly quota, the capped free diagnostic configuration and refreshed product/protocol/source hashes after these repairs/docs. Broken or missing measurements cannot be waved through as `ready`; this completed pilot is not a readiness verdict or final lever report. Bench README and all three evidence directories document the commands, provenance and limitations.

    - [x] Task 4.8: Readiness check before resuming the broad Task 4 baseline
      - Acceptance Criteria:
        - Functional: Independently verify 4.1–4.7 evidence, including 4.5.1, and record `ready` or `not-ready`, with each unresolved blocker named. A readiness pass requires validated source mapping, eligible comparator coverage, judge-control results including the 4.5.1 borderline controls, the pre-registered graded rubric score with its upstream citation, attribution of the 4.5 complete-history rejections, separated latency/cost, product-only attribution, paired analysis/sizing disclosure and a completed pilot with every requested cell accounted for. Genuine product failures may remain and must be measured; broken or missing measurements cannot pass readiness.
        - Functional: Produce a resumable manifest pinned to current product/criteria/analysis/adapter/judge/context-policy revisions. Explicitly list which original cells can be reused and why, which need rerunning, and what cannot support a claim. Supersede the stale 100-job resume instruction and reconcile current models, provider/context limits, quota availability and reservations. Task 4 remains unchecked until the broad baseline and final lever report finish.
        - Performance: Recalculate remaining token/call/wall-time estimates from corrected product and evaluation measurements; do not carry forward the old estimate as a new authorization or require a redundant approval. Unavailable quota yields `not-ready`, not retries without a bound or an assumed future reset.
        - Code Quality: Run `timeout 180 bun run typecheck`, `timeout 600 bun test scripts/memory-bench`, and `timeout 180 bun test --timeout=0 src/__tests__/docs.test.ts`; check formatting and the final evidence/provenance diff. Record exact commands/results and separate pre-existing failures. Readiness is invalidated by subsequent relevant protocol/product changes.
        - Security: Verify the held-out guards, text-free committed artifacts, ref-only credentials and calibration-waiver disclosure; no held-out acceptance runs during this check.
      - Approach:
        - Documentation Reviewed / References: Subtasks 4.1–4.7 including 4.5.1; original Task 4 acceptance criteria; `baseline.mjs:351–376` (authoritative reports/manifest); Task 18 frozen acceptance.
        - Options Considered: Mark readiness from a green unit suite alone — rejected because tests do not prove comparator eligibility, live diagnostic validity or executable quota.
        - Chosen Approach: Reconcile tests, pilot evidence and manifest provenance in a text-free readiness report; resume only the declared compatible broad cells after `ready` is recorded.
        - Files to Create/Edit: `docs/_evidence/memory-bench/202/readiness.json` and `readiness.md` (new); guarded `resume-manifest.json`; this Task 4's status/next-command notes; `scripts/memory-bench/audit/readiness{,.test}.mjs` (offline evidence reconciliation and the named regressions); `scripts/memory-bench/campaign.mjs` for readiness enforcement. Authorized remediation also touches the pilot/probe scripts, baseline/run/usage/journal bounds and their tests, `scripts/wire-proxy{,.test}.mjs`, Command Code models/provider/tests/README/changelog, Hyper model typing, remote connect/tests, benchmark README, root changelog and the obsolete promoted docs noted below. No dependency or public export changes.
      - Test Cases to Write:
        - `baseline_resume_refuses_missing_or_stale_readiness`.
        - `readiness_cannot_pass_with_ineligible_comparator_or_missing_pilot_cell`.
        - `readiness_does_not_mark_broad_baseline_complete`.
        - `readiness_cannot_pass_without_graded_rubric_registration_or_borderline_controls`.
      - Documentation/Wiki Assessment: Readiness evidence and bench README document the resume condition and exact current command; no public API/index change. Use `.agents/skills/create-plan/references/prism-wiki.md`.
      - Notes (executed 2026-10-29):
        - **Initial audit (historical): `not-ready`; final remediated status is `ready` below.** This is a valid failed readiness verdict, not permission to resume. `docs/_evidence/memory-bench/202/readiness.{json,md}` records independently checked evidence from 4.1–4.7 including 4.5.1, unresolved blockers, current source/protocol pins, quota provenance, reservation reconciliation and verification. Task 4 remains unchecked. No provider call, new answer, held-out text inspection, acceptance run or product change occurred.
        - **Evidence verified.** 120/120 development source references resolve; the pilot accounts for 52/52 cells (42 scored, ten equivalent-policy dispositions), all ten full histories are eligible without source removal, and rubric cells carry graded primary plus binary secondary scores. Gold/wrong/paraphrase controls and all 36 borderline variants are present: 72/72 binary checks pass, 71/72 individual graded checks meet tolerance; the one mapping miss is disclosed and its panel mean is within tolerance. Upstream BEAM commit/citation and scoring deviations, eight complete-history claim classifications, separated product/evaluation measurements, oracle exclusion, product-only attribution and paired/sizing limitations are retained. The human-calibration waiver and unresolved Task 18 power stay explicit.
        - **Blockers retained.** Eleven exchanges still lack usage; 24,028,649 retained reservation tokens exceed the original 8,700,000 ceiling, with no refund; elapsed work spans 295.2 minutes against the two-hour declaration. These are unresolved deviations, not passed ceilings. MiniMax's latest bounded subscription probe hit a monthly cap; the present allowance for other answer/judge routes is unverified. The owner-directed free diagnostic configuration does not establish the broad product configuration or panel. Broad context/output limits, live quotas and per-attempt reservations must be reconciled before a pass; no future reset or new paid allowance is assumed.
        - **Manifest and reuse.** `resume-manifest.json` freezes the current candidate 75 development jobs with `executable: false`, null hard reservations/ceiling and `baselineComplete: false`. Every one of the original seven completed cells is listed for rerun: old source mapping, comparator/scoring/measurement protocol and unavailable answer checkpoints prevent promotion or rejudging. No original cell or pilot diagnostic is reusable as a current broad cell. Corrected phase measurements extrapolate to 216,583,740 reported tokens, 12,852 calls and 62.14 serial hours; this is a BEAM-100K capped-free-pilot sensitivity estimate across the candidate grid, excluding missing/failed usage, larger histories/ingestion and quota waits, not an executable budget. `full-truncated` uses an explicitly labelled full proxy because it was not independently run.
        - **Enforcement and scope.** Added `scripts/memory-bench/audit/readiness{,.test}.mjs`; these are offline reconciliation and the four named regressions, not a new campaign framework. `campaign.mjs` loads the frozen manifest only after readiness/evidence/product/protocol hash validation and refuses nonserial baseline execution; manifest-only entry points refresh the blocked pack without overwriting historical baseline evidence. The benchmark README supersedes stale 100-job/68-unfinished resume directions. Recheck with `timeout 180 bun scripts/memory-bench/audit/readiness.mjs`; no executable resume command exists until blockers clear and the review is refreshed. Subsequent relevant source, protocol or evidence changes invalidate the pins. No kernel/package/API/export/dependency/compatibility change; no release gate or retirement sweep applies.
        - **Verification.** `timeout 180 bun run typecheck`: fails on inherited Hyper `models.ts:172` TS2345 and current remote `connect.ts:140` missing `Agent.reload` (also surfaced through dependent workspaces). `timeout 600 bun test scripts/memory-bench`: initial run 333 pass / 2 skip / one existing five-second deterministic-report timeout; repeat 338 pass / 2 skip / 0 fail including the four new tests. Final focused audit/baseline/campaign suites: 30 pass / 0 fail. `timeout 180 bun test --timeout=0 src/__tests__/docs.test.ts`: 62 pass / 3 existing failures (two docs/next promotion/navigation checks, examples emission). The standalone examples compiler reproduces Hyper TS2345. Biome on the three changed JS/test files and `git diff --check` pass. Text-free artifact, historical-hash and pilot role-total assertions pass. Final evidence/provenance review leaves historical artifacts intact; no paid process was started.

  - Readiness remediation (started 2026-10-29; owner goal: remove blockers, use only free OpenRouter and free Command Code models):
    - **Concrete fixes.** Hyper's fallback limit type now matches the two required numeric values every branch returns. The remote Agent proxy explicitly rejects unsupported `reload()` with the existing `remote_unsupported` error. Five obsolete, already-promoted `docs/next/` pages were removed; two live docs' stale plan references were removed. Typecheck and all 65 docs tests pass.
    - **Free route compatibility and restrictions.** The harness can load Command Code; `--free-only` refuses unknown/paid routes before generation. The current selected answerers are `openrouter/nvidia/nemotron-3.5-lightning:free`, `commandcode/stealth/glyph-cluster:free`, and `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` (three models, two answer families; no small-model or three-family claim). Both judges remain OpenRouter Dots/Cohere `:free`. The initially rejected Command Code credential was refreshed by the owner and the free routes were verified again. Beam's advertised Responses bridge lost required plain reasoning on a tool follow-up (HTTP 400); the provider now selects Chat for that model and replays `reasoning_content`. A failing-first regression and the real tool follow-up pass. Glyph keeps Responses. Beam still rejects imported assistant history without nonempty reasoning traces, so it is excluded from the raw-history baseline. No paid fallback or publication occurs.
    - **Accounting repairs.** The wire proxy reads nested Responses terminal usage, records transport failures as unknown, and retains generation ids/model ids without response text in usage logs. Per-wire-attempt accounting reserves the declared context/output bounds before a call; an unreported call retains those bounds. Shared admission now counts concurrent reservations. Original missing usage is not reconstructed or refunded. The new free baseline has its own journal, retains all historical attempt charges plus a conservative 250M preflight reservation, pins its execution identity, applies per-job wall caps and halts on quota without assuming a reset. Development injection-utility annotation calls are off, matching the pilot; source-id attribution stays on and Task 18's annotation requirement is unchanged.
    - **Fresh pilots preserved; readiness remains not-ready.** The Beam v1 attempt was aborted for its imported-history HTTP 400; its full allocation stays held. Glyph v2 stopped after a proxy idle reset and OpenRouter's confirmed daily quota refusal. The proxy now disables Bun's ten-second idle cutoff; a real 238-message full-history request completed in one call with complete usage, and the quiet-stream regression passes. V3 freezes the same 52 dispositions on Glyph, temperature zero, 8192 output tokens, provider-default reasoning and the unchanged eight-turn stop. Its declaration is 300 physical calls / 50M input / 1M output / eight hours overall and four active execution hours. Answer and scoring phases share one held attempt, cumulative accounting and immutable checkpoints; scoring refuses regeneration. No old answer/score is reused and historical failures/debt are never refunded.
    - **Latest live outcome (2026-10-29, after daily reset).** Free OpenRouter Lightning, Ultra and both judges pass fresh admission/control probes. Command Code Glyph returns HTTP 401 with the explicit provider message “Your API key has expired”; the configured live-env credential was loaded (no stale process override). V3 consequently ended `completed_with_failures`: 42 refused physical calls, zero scored cells, zero reported input/output, all refusal usage classified. Its evidence is retained and cannot be called a successful readiness pilot. Refresh `COMMAND_CODE_API_KEY` in `~/.config/prism/live.env`, verify a bounded free probe, and version/freeze any new pilot rather than overwriting V3. The readiness checker and campaign guard continue to fail closed. Broad Task 4 stays unchecked; no baseline campaign ran.
    - **Credential refreshed; V4 passed (2026-10-29).** The owner's updated Command Code key passes the real free Glyph tool probe; all three selected answer models and both free judges pass fresh probes. `readiness-pilot-v4/manifest.json` separately freezes the unchanged 52-disposition design and 300-call / 50M-input / 1M-output / eight-elapsed-hour / four-active-hour caps. The two phases completed on the same journal attempt: 42 scored answers, ten equivalent-policy dispositions, ten eligible complete-history comparators, zero removed source messages, and binary plus graded scores on both rubric abilities. Actual total: 156 physical calls (51 solver / 105 judge), 1,666,380 input and 178,590 output tokens, zero missing usages; 41.10 active / 41.23 elapsed minutes. Product/evaluation sums reconcile to wire totals; the one held reservation reconciles once to complete measured usage. V1–V3 and historical missing-usage debt remain untouched.
    - **Final readiness: ready, zero blockers.** `readiness.json` and `resume-manifest.json` pin current sources and evidence; the independent `assertBaselineReadiness()` guard accepts the exact manifest without executing it. The free-only serial manifest has 75 pending development cells. Historical/failed charges plus conservative preflight allowance retain 350,987,051 tokens against the unchanged 2B aggregate ceiling, with zero refunds. Corrected descriptive extrapolation: 203,001,798 tokens / 11,403 calls / 51.51 serial hours, not a completion bound or future quota guarantee. Operations proof expires at 2026-10-29T11:02:53.857Z; expired proof or any relevant drift requires rechecking. Resume command recorded in the evidence: `timeout 28800 bun scripts/memory-bench/campaign.mjs --baseline-202 --parallel-arms 1`. No broad campaign was started. Task 4 stays unchecked until all broad evidence and the lever report finish; Task 18 criteria and all claim restrictions remain frozen.
    - **Verification to date.** Required `timeout 600 bun test scripts/memory-bench`: 343 pass / 2 environment skips / 0 fail. A separate real pinned-source annotation inventory (with the benchmark Python env) passes, removing that inventory's environment skip as a source-proof limitation. Affected provider/remote/wire suites: 62 pass / 0 fail, including the eleven-second quiet-stream proof. One wider run under simultaneous CPU load failed the existing two-second bootstrap timing assertion; the separate required suite passes. Formatting and diff checks pass with two inherited unused-parameter warnings. Source-matched local verification is recorded in `readiness-verification.json`; the refreshed readiness verdict is ready after V4 passes all measurement and operational checks. No kernel contract, public export, dependency or compatibility-baseline change; the provider behavior correction is documented in its README/changelog and the root changelog.

  - Gate pack (2026-10-27; historical record, superseded for resumption by subtasks 4.1–4.8).
    - **Status: gate recorded, run not executed.** The manifest, reservations, product/criteria pins and lever rule are in place and tested. No baseline arm has run, so no accuracy, latency or stage evidence exists yet and this task stays open. Do not treat `docs/_evidence/memory-bench/202/baseline/` as a result; its README says so in the first line. **No owner budget decision is required** (see billing below).
    - **Owner gate 1, verbatim:** `Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)`. `buildBaselineManifest` refuses to build without this text and records it with `approvedBy: owner`, `approvedAt: 2026-10-27`.
    - **Harness precondition met.** `bun test scripts/memory-bench` is green: 267 pass / 1 skip / 0 fail (264 before this task's tests). Task 2's two quarantined failures stay fixed.
    - **Gate pack after the free-model switch.** `baseline.mjs --manifest` now writes 100 jobs = 5 suites (`beam-100k`, `locomo`, `memoryagentbench-cr`, `longmemeval-m`, `beam-1m`) × **4 free answer models** × 5 arms, all `--subset dev`, `--repeats 1`; 260,930,040 tokens and $15.35 list-price equivalent (judges only; the answerers are free). The owner replaced the paid answer set with free models; this satisfies the 3–4-model wording but not a cross-provider Robust claim (two gateways, one judge gateway).
    - **Arms mapped to existing configs.** `preset-r1` = `fabric-x-tools` (conversational preset, passive delivery + tools), `passive-only` = `fabric-x`, plus `full`, `full-truncated` and `lexical-topk`. Coding suites are Task 11, not this baseline; `beam-500k` and `beam-10m` are optional in the criteria and not drawn.
    - **Owner switched answerers to free models (2026-10-27).** Answer set: `opencode-go/beam-free` (200k), `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` (1M), `openrouter/nvidia/nemotron-3.5-lightning:free` (1M), `openrouter/poolside/laguna-s-2.1:free` (262k); all report tools + reasoning and cost $0. Panel moved to Hyper on the owner's direction: `hyper/qwen3.8-flash` + `hyper/glm-5.3-flash` (families qwen/glm, plain-text). Neither judge answers an arm and neither consumes the OpenCode Go quota. Probes: Beam, Nemotron Ultra and Nemotron Lightning answered; Iceman returns `Endpoint is unavailable` even after the privacy toggle, so it is excluded; Laguna returned upstream 429 on the free pool and remains in the manifest with that known risk. Limits: 200k/262k context cannot host the 1M-token `full` arm on LongMemEval-M/BEAM-1M, so those cells are not equivalent to the original paid-model design. Judge calls still consume the OpenCode Go 5-hour quota, so the campaign must resume after a reset.
    - **First execution attempt halted on the subscription quota (2026-10-27).** The run started with 4 paid arms and 4 questions in flight. OpenCode Go returned `429 GoUsageLimitError` partway through BEAM-100K; every subsequent arm failed at its first answer. 60 failed reports are archived under `docs/_evidence/memory-bench/202/baseline-quota-2026-10-27/`. This is why the owner moved the answerers to the free models; the paid judges still consume quota.
    - **Rates seeded, no longer guessed.** `rates.json` now carries the installed catalog's `ModelCost` values for the six models (`status: provider-catalog`, `asOf: 2026-10-27`). `cacheWrite: null` no longer makes cost null when the route reports zero cache writes; a missing input/output/cache-read rate still does. This closes Task 3's "rates forced to null" deviation for the estimate; the owner still verifies the price sheet before the held-out gate.
    - **Billing is the subscription, not a USD budget.** The owner runs these models on the OpenCode Go plan, so there is no per-token charge and no $ gate; the earlier $ confirmation requirement is removed. The manifest now records **260,930,040 tokens** (the planning number for reservations; $15.35 is the list-price equivalent of the paid judges only, because all answerers are free). Per-question usage is 188.10 held-out v3 (`full` 112,955 in / 315 out; `preset-r1` 29,668 / 9,655 cached / 1,882 out; `passive-only` 6,378 / 81 / 848; `lexical-topk` 4,000 / 315), plus two judges at 4k in / 100 out. Every job's `maxInputTokens` is estimate × 1.2 + 750k rounded to 500k, capped per arm. `full` / `full-truncated` on LongMemEval-M and BEAM-1M dominate volume.
    - **Wall time is capped, not priced.** Task 1 measured 90 ms per local note and never completed a 500-session write; a LongMemEval-M question at ~500 sessions is hours per arm/model. Per-job caps are 6 h BEAM-100K/LoCoMo, 6 h MemoryAgentBench, 48 h BEAM-1M, 144 h LongMemEval-M. The first real write arm measures the actual value; nothing in code assumes it is zero. This is agent work, not an owner decision.
    - **Lever rule implemented, not applied.** `leverDecision` opens a lever only at `counts / failures >= 0.05`; `rankLevers` takes the best suite × model cell and marks a stage the harness does not emit as `unmeasurable` (6, 7, 10, 16, 17 today), never as closed. Stage counts come from the Task 3 `stage` field; `gold_unknown` is not a failure cause and does not open a lever. The two named tests exist: `baseline_manifest_pins_criteria_and_product_hash`, `lever_rule_closes_task_below_threshold` (3% → not needed, exactly 5% → needed, unemitted stage → unmeasurable). Whole bench suite 267 pass / 1 skip / 0 fail.
    - **Final answer and judge set (2026-10-28, third switch): all on the owner's OpenCode Go subscription.** Hyper's balance reached zero mid-run (`402 Payment Required` on every judge and answer call), and OpenRouter's free pool stays closed until 2026-10-29, so the grid moved to the only live gateway: answers `opencode-go/beam-free`, `opencode-go/minimax-m3`, `opencode-go/mimo-v2.5`; judges `opencode-go/qwen3.7-plus` (qwen) and `opencode-go/kimi-k3` (kimi), plain-text. No judge answers an arm and no judge shares a family with one. This satisfies the owner's "subscription, not per-token" billing stance; it does **not** satisfy a cross-provider Robust claim, which stays a criterion for Task 18. Evidence from the earlier model sets is archived under `baseline-openrouter-2026-10-28/` and `baseline-hyper-exhausted-2026-10-28/` and is not evidence.
    - **Answer models changed again (2026-10-28): OpenRouter free pool is dead.** The key hit `free-models-per-day-high-balance` (1000 free requests/day, `x-ratelimit-remaining: 0`, reset 2026-10-29), so every OpenRouter arm failed at its first answer with `MemoryBenchAnswerError:429`; the 2026-10-27 runs that used them are archived under `docs/_evidence/memory-bench/202/baseline-openrouter-2026-10-28/` and are **not** evidence (different model set). The gate pack is now 75 jobs = 5 suites × 3 answer models (`opencode-go/beam-free`, `hyper/minimax-m3`, `hyper/qwen3.8-27b`) × 5 arms, 195,697,530 tokens, $52.6 list-price equivalent. Judges are `hyper/glm-5.3-flash` + `hyper/kimi-k2.7-code`: glm/kimi families, neither an answer model, neither sharing a family with one, both plain-text. Answers now span two gateways (OpenCode Go subscription + Hyper per-token); the Robust criterion's `minProviders: 2` remains a criterion, not a claim.
    - **Five harness defects the live run exposed, all fixed and tested.** (1) `replay.mjs` anchored the answer retry at the pre-fork leaf, so a *second* rate-limit retry forked at an id the forked session never stored and aborted the question with `Unknown session leaf`; the OpenRouter arms died this way after 3 scored questions. The anchor now moves to `clean.leafId` and `two_rate_limited_answers_fork_from_the_forked_session_leaf` reproduces the old failure without it. (2) Transport-level drops (`ECONNRESET`, `socket hang up`, `fetch failed`) were not retryable, so one gateway wobble failed a whole arm; `isTransportFailure` now retries answers and `isRetryableJudgeFailure` treats the same codes as transient. (3) A deterministic 4xx was retried eight times: `campaign.mjs:permanentFailure` classifies `context length`, `invalid_request`/`unsupported` and `model_not_found` as `failed-permanent` with a cause (`context-exceeds-model`, `unsupported-by-provider`, `model-unavailable`) and never re-runs the job. (4) Report paths embedded `provider/model`, so OpenRouter reports landed in nested directories no aggregator read; job ids are flattened (`/` → `-`). (5) The admission gate summed a 250k margin per in-flight request, so six questions plus a two-judge panel and the injection labeller "exhausted" a 7.5M reservation at 890k tokens of real spend and killed fabric arms at question 7; it now compares measured spend plus the request being admitted, with in-flight tokens tracked per call token and expired when a stream is abandoned. (6) A judge call that stalled 600s failed the whole arm; judge calls now time out at 180s, a timeout counts as retryable, and an unparsable one-word verdict (`invalid verdict text`) is re-asked. (7) `mapHyperModel` copied `max_output_tokens` verbatim, and Hyper reports minimax-m3 as 512k/512k, so `resolveInputCap` resolved a **negative** cap and the job died in setup; the provider now clamps an output limit that consumes the whole window to a quarter of it (`hyper_catalog_caps_an_output_limit_that_equals_the_context_window`).
    - **Judge quota is paced, not discovered.** Hyper allows 1000 requests/hour per judge model. `PRISM_MEMORY_BENCH_JUDGE_RATE` (default 450/hour, the 202 campaign runs 900) spaces judge calls per model inside a job, and the 429 retry still honours `retry_after_ms` (three spellings: `retry_after_ms82000`, `retry_after_ms=115000`, `retry_after_ms: 300`). Without the pacer the first arm spent an hour of quota on 429s. Parallel arms stay at 1: two arms sharing one journal produced `unknown attempt` and a stale `setup-failure` halt, so the campaign runs serially and the pacer's total is the campaign's rate.
    - **Aggregation picks one authoritative attempt per cell.** `baseline.mjs --aggregate` walks the evidence tree, ignores in-flight and failed reports, keeps the completed attempt with the widest id set per `suite × model × arm` (newest on a tie), and writes cost, p50/p95 wall time, per-ability accuracy and the stage table into `README.md`. Tests: `aggregate_keeps_one_authoritative_attempt_per_cell`, `aggregate_ranks_a_failed_attempt_without_a_completed_one_nothing`, `baseline_evidence_reports_cost_latency_and_ability_rows`, `a_4xx_input_refusal_is_not_retried_as_a_quota_failure`, `judge_pacer_spaces_calls_to_the_hourly_quota`, `a_dropped_socket_is_retried_for_both_answers_and_judges`.
    - **The tool-name fix made `preset-r1` measurable.** `createRoutedProvider` encodes dotted tool names per request (`memory.recall` → `memory_recall`) and decodes the model's call back across the Chat, Responses and Messages codecs; before it, `preset-r1` died on `400 invalid_value tools0.function.name` on every free endpoint. Live evidence: `preset-r1` on `beam-100k`/`beam-free` answered with up to 9 tool calls and 2 `memory.recall` calls per question.
    - **BEAM attribution finding corrected (2026-10-28):** the original run reported `gold_unknown` for 25 failures in the first completed cell and attributed this to absent gold session ids. The raw development data does carry `source_chat_ids`: lists/keyed objects on all 36 non-abstention questions, with 120 references resolving to original chat message ids; all 40 questions have rubrics. The adapter drops this metadata. Subtask 4.1 restores validated mappings; 4.4 revisits attribution and lever decisions. Do not retain the original claim that missing attribution is solely a suite limitation.
    - **Execution status 2026-10-28 11:10: 7 of 75 cells, then blocked on external quota.** The pipeline is proven end to end on real paid cells — `docs/_evidence/memory-bench/202/baseline/README.md` carries per-cell accuracy with 95% CI, cost, p50/p95 wall time, the per-ability table, comparator gaps and the lever table — and the completed cells are `beam-100k` × `opencode-go/beam-free` for all five arms plus `minimax-m3` for `preset-r1` and `passive-only`. On that one suite × model the lever rule already returns `5` (`candidate_gap` 8.7% of failures) and `9` (`answer_gap` + `abstention_error` 15.4%) as `needed`; that is not yet a plan-wide decision, which needs the other suites. **The remaining 68 cells cannot run now:** OpenCode Go answers `429 GoUsageLimitError` with `"limitName": "monthly"` (the plan's monthly allowance is spent, not a 5-hour window), Hyper's balance is `0` (`402` on every call), and OpenRouter's free pool reports `free-models-per-day-high-balance` until 2026-10-29. Owner action is needed before execution resumes: top up Hyper credits, raise the OpenCode Go monthly limit, or supply another gateway key. The campaign is resumable (`campaign.mjs --baseline-202 --parallel-arms 1`) and re-runs only unfinished cells; `baseline.mjs --aggregate` rebuilds the evidence pack from the journal at any point. The quota-pause path added today covers an hourly window; a monthly cap needs the owner, not a wait.
    - **Historical runtime blockers; measurement prerequisites now also apply.** (1) The 2.7 GB LongMemEval-M pin is now cached and SHA-256 verified (`9d79e552…e495f`). (2) LongMemEval-M write time is hours per arm, so the run spans more than one session; caps are recorded. (3) The human judge audit is **waived by owner decision (2026-10-27)**, so a live report carries `judgeCalibration: null`; any BFC claim is labelled not human-calibrated. No redundant budget confirmation is needed for the authorized subscription usage. Subtasks 4.1–4.8 must resolve the measurement/readiness blockers before the broad run resumes.
    - **Harness fixes made while executing:** judges without native structured output now use `judgeProtocol: plain-text-v1` (enum-JSON failed with `unsupported_model` for kimi/minimax/glm); BEAM abilities without a judge template use the generic correctness prompt instead of `Unsupported judge ability`; judge output cap raised to 32k; judge admission headroom raised to 5M tokens so 4 in-flight questions cannot exhaust a 3M reservation; parallel journal writes use unique temp files. Tests: `plain_text_judges_accept_one_label_and_extract_wrapped_verdicts`, baseline manifest test; `run.test.mjs` 102 pass.
    - **Live execution (2026-10-27, Hyper judges).** Four non-tool arms on `beam-100k`/`beam-free` completed (40/40 each) through the Hyper judge panel, so the panel and the wire path work. Two defects surfaced: (a) the wire proxy forwarded `content-encoding`/`content-length` from Bun's already-decompressed upstream body, making the Hyper client inflate plaintext (`ZlibError`); the proxy now strips both headers. (b) Every free endpoint rejects the memory tools because OpenAI function names allow only `[a-zA-Z0-9_-]` and the fabric registers `memory.recall` (dot). The `preset-r1` arm therefore fails at its first answer with `400 invalid_value tools0.function.name` on Beam and Nemotron. This was a product/provider compatibility bug, not a judge issue. **Fixed in the same change:** `createRoutedProvider` now builds one `ToolNameMap` per request (`src/provider-kit/tool-names.ts`), serializes tools and replayed `tool_call` blocks through `wireToolName` (`memory.recall` → `memory_recall`, `memory_recall_2` when the product already names one), and decodes the stream back through `productToolName`, across the Chat, Responses and Messages codecs; `docs/provider-kit.md` and the root CHANGELOG record it. Live evidence after the fix: `preset-r1` on `beam-100k`/`beam-free` answers with up to 9 tool calls and 2 `memory.recall` calls per question instead of failing at the first answer, and the first `full-truncated` cell completed 40/40. (c) Hyper enforces 1000 requests/hour and 10000/day per model; a 429 is now retried with its `retry_after_ms` (up to 8 attempts), so a quota window pauses a job instead of failing the cell. The hint arrives in three shapes (`retry_after_ms82000`, `retry_after_ms=115000`, `retry_after_ms: 300`), and the parser accepts all three; the live gateway uses the `=` form. The campaign's per-job attempt limit rose from 5 to 8 so a quota-window attempt is not mistaken for a measured failure. Judge volume is 8000 calls for the whole baseline (4000 per judge model), i.e. at least four quota-bound hours.
    - **Muse continuation prepared (2026-10-29).** The named paid Muse pilot saved all 42 answer checkpoints (50 requests, ~ $0.17); scoring remains blocked by the unchanged original OpenRouter panel's daily quota (zero remaining at 13:44 UTC). The exact scorer is frozen at `.cache/memory-bench/frozen-muse-v5/`, and offline validation accepts all saved answers without regeneration. The guarded 75-cell continuation replaces only the 25 unstarted Glyph cells, pins four completed Lightning reports plus 25 lexical scores, uses a separate journal/output directory, and carries 449,318,335 tokens once. Analysis bodies/constants, dependencies, draws and shared source identity are verified unchanged. Paid wire admission and incremental resume charging are tested; a negative live admission check refuses before any model request. Current source-matched suite: 352 pass / one Vibe official-image environment skip / zero fail; typecheck passes. Campaign guard refuses before a new journal or model call. See `docs/_evidence/memory-bench/202/muse-continuation-2026-10-29.md` and `muse-campaign-verification.json`. Task 4 stays unchecked; no product or acceptance claim follows from the answer pilot.
    - **Owner changed the judge panel (2026-10-29).** Authorization: “Use Minimax m3.1 flash as the judge from command code. Try the free route first. If that is not available, go with the paid route”, followed by “Use GLM 5.3 flash from command code as the other judge”. The live MiniMax `:free` route returns HTTP 403 explicitly stating its free window ended; the paid MiniMax and GLM routes pass positive/negative admission controls. The new two-family panel is `commandcode/minimax/minimax-m3.1-flash` + `commandcode/z-ai/glm-5.3-flash`. A separately frozen readiness-v6 scores all 42 saved v5 Muse answers, with no answer regeneration or score reuse; a distinct journal charges new evaluation input while the original v5 reservation stays held. New rubric controls reuse the original eight development rubrics and paraphrases, adding eight wrong-answer controls. The broad manifest preserves all 75 cells and free-only answer enforcement separately from paid judging. Historical Lightning reports and lexical scores remain evidence of the old panel only: they have no answer checkpoints and require rerunning under the new panel. Old charges are retained. Task 4 remains unchecked; free OpenRouter answerers still require available quota and a full current readiness pass. Evidence: `docs/_evidence/memory-bench/202/minimax-judge-selection.json`, `readiness-pilot-v6/`, `commandcode-panel-controls.json`. Regression proof covers judge-only provenance, refused protocol drift/score reuse, distinct product billing identity, named judge rates and unchanged borderline metrics.
    - **New-panel pilot and controls complete (2026-10-29).** Readiness-v6 scored all 42 saved Muse answers under MiniMax/GLM: 104 new judge calls, 53,636 input / 19,766 output tokens, complete usage, $0.018184 listed judging cost, no answer regeneration. All 44 rubric controls pass without mismatches (172 requests, full usage); original rubrics and saved paraphrases were reused. Independent checkpoint/source/role/wire/journal proof is in `readiness-pilot-v6/scoring-proof.json`. Source-matched suite: 356 pass / one Vibe environment skip / zero failures; typecheck and diff checks pass. Current readiness has only the two free OpenRouter answer models' quota/admission blockers. The new broad campaign refuses before a journal or model call. Combined retained charge: 449,371,971 tokens against 2B, no refunds. No run remains active. Exact resume commands and limitations: `docs/_evidence/memory-bench/202/commandcode-panel-continuation-2026-10-29.md`. Task 4 stays unchecked.
    - **Owner replaced the two OpenRouter answerers (2026-10-29).** Exact instruction: “Let's replace those two models. We use Muse spark 1.2 contributor and Glyph cluster free from command code as the answer model. If glyph cluster 100 request is not enough use Tencent hy3”. The frozen draw has 210 questions × five arms = **1,050 question/arm slots per model**, before extra tool turns and retries; Glyph's documented 100 requests/account/day cannot cover it. Select Tencent Hy3 for the whole third model slot before generation. Current answers: `commandcode/meta/muse-spark-1.2-contributor`, existing `commandcode/meta/muse-spark-1.3-contributor`, `commandcode/tencent/hy3-paid`; judges remain MiniMax M3.1 Flash + GLM 5.3 Flash. All named paid routes are authorized; other fallbacks remain refused. Model ids/windows are verified in the live catalog; price sheet: Muse 1.2 $0.10/$0.20/$0.002, Hy3 $0.14/$0.58/$0.035 input/output/cache-read per million. Hy3's 262K context means some full-history arms will be ineligible; retain distinct bounded comparators. All routes now share one gateway, so no cross-provider Robust claim. The prior Muse answers/scores, judge controls and historical charges remain unchanged; replacing answer models reruns those slots rather than renaming their old reports. The 75-cell five-suite design and frozen statistical rules remain unchanged. Task 4 remains unchecked pending live execution and broad evidence.
    - **New answer set verified and broad campaign started (2026-10-29 14:23 UTC).** Muse 1.2 Contributor and Tencent Hy3 pass all four compatibility cases (including the complete 238-message development history, zero removed source messages), with full wire usage. All five selected routes pass fresh live admission/tool/judge controls. Source-matched verification: 357 pass / one Vibe official-image environment skip / zero fail; typecheck, formatting and diff checks pass. `readiness.json` is ready with zero blockers. The serial 75-cell campaign is active under `.cache/memory-bench/202-commandcode-panel-baseline/journal.json`; retained prior charge is 449,371,971 against the unchanged 2B ceiling. It starts with BEAM-100K preset-r1 / Muse 1.2. Evidence: `commandcode-answer-selection.json`, `commandcode-answers-verification.json`, `commandcode-baseline-execution.json`. Task 4 remains unchecked pending all current-model cells and the final lever report; no old model/panel scores are treated as current.
    - **To finish this task:** subtasks 4.1–4.8 are checked, but 4.8 records **not-ready** (2026-10-29). Resolve its named blockers and refresh readiness to `ready`. Then use the current, reconciled manifest and resume command from the readiness report, rerunning incompatible cells rather than blindly starting the historical 100-job pack or only the original 68 unfinished cells. Aggregate the completed compatible broad baseline, publish corrected per-cell/paired comparisons and product-only lever decisions, and only then mark Task 4 complete.

- [ ] Task 5: Candidate recall without embeddings — agentic lexical navigation and write-time enrichment
  - Notes (implementation executed 2026-10-30; measured acceptance pending):
    - Added deterministic entity/date/unit and stemmed category keyword enrichment at exchange archive time, without a model call. New notes use the existing indexed keywords field; existing archives are not rewritten.
    - Added `memory.recall.unmatchedTerms`, matched against returned content and indexed keywords/tags/context/path, plus aggregation rephrasing guidance. Absence is relative to returned notes, not a claim about the complete archive.
    - Added archive `session` metadata and optional `VectorStore.listBySession`, implemented with a SQLite session/reference-time expression index and forwarded by the markdown store. `memory.read` accepts `around` (±2 readable notes in the same session) or `session` and zero-based `page` (8 notes). Final reads retain existing scope, consent, invalidation and redaction filtering; legacy stores scan metadata and emit a warning through the package status path. Existing notes without session metadata remain readable by id; this task does not rewrite old archives.
    - Replay now records each needed round's presence in successful tool results across all agent queries, clearing evidence on answer retry. Development diagnostics expose that primary candidate-gap measure separately from question-only ranking ablations. Historical reports without this instrumentation report unknown (`null`), not a zero gap; held-out guards remain intact.
    - Verification: deterministic enrichment, lexical category reachability, ≤2 ms enrichment fixture, session paging/order, same-session neighbours, foreign scope, revoked consent, scan fallback warnings, model-free/embedding-free archive and tool-result surfacing checks pass. Root typecheck passes; memory-core 62 pass; fabric 511 pass / 23 PostgreSQL skips; memory-bench 368 pass / 2 environment/dataset skips. Final replay/surfacing run: 121 pass. Offline smoke: 14 questions completed. Formatting and diff checks pass (one pre-existing unused-parameter lint warning in run.test.mjs).
    - Compatibility: generated fresh source declarations for core/fabric. Core baseline unchanged; fabric baseline adds only `exchangeKeywords`; no exports removed. `bun scripts/release.mjs gate` stops at the pre-existing release-evidence PostgreSQL URL requirement, so no full release-gate pass is claimed.
    - Task remains unchecked for Task 5.6 PostgreSQL memory validation and measured acceptance: the Task 4 frozen baseline and the owner-gated, multi-suite development comparison must establish the halved tool-result candidate-gap target with no ability regression. No paid run or quality-improvement claim is made.
  - Remaining closure subtasks (added 2026-10-30; planning only, no new paid authorization):
    - [x] Task 5.1: Audit revision-1 evidence for actual tool-result surfacing
      - Acceptance Criteria:
        - Functional: Inventory retained revision-1 private traces for the intended development cohort; recover needed-round presence from successful recall/read results where possible. Record missing traces, unresolved gold mappings and unknown surfacing explicitly; question-only rankings, hidden candidates and passive injection cannot substitute for tool results. Keep the owner-closed 23-cell screen immutable.
        - Performance: Offline only; no provider/model calls, answer regeneration or reopening of the closed journal.
        - Code Quality: Reuse the repaired round mapping and `toolSurfacing` definitions; pin every reused source/trace hash and product revision.
        - Security: Preserve the held-out guard; publish ids/counts/hashes only, keeping questions, source text, answers and traces private.
      - Approach / Files: Inspect `scripts/memory-bench/{replay,retrieval-diagnostics,baseline}.mjs` and the closed-screen private artifacts; record the inventory under `docs/_evidence/memory-bench/202/task5/` (created on execution). Evidence seam: `replay.mjs` tool-result hook and `evidenceCounts.toolSurfacing`; `retrieval-diagnostics.mjs` tool-surfacing summary. If traces cannot establish the baseline, list the frozen revision-1 control cells needed by Task 5.2 rather than filling gaps with zeroes.
      - Tests / checks: `task5_trace_recovery_excludes_hidden_candidates_and_passive_context`; `task5_missing_trace_is_unknown`; verify source hashes and unchanged closed-screen artifacts.
      - Documentation/Wiki Assessment: Evidence inventory only; update the Task 5 notes/evidence README. Public API: no; `docs/index.md`: no.
      - Notes (executed 2026-10-30): [Trace inventory and disposition](../docs/_evidence/memory-bench/202/task5/README.md), with per-question ids/mappings, private artifact hashes and required fresh controls in `task5/revision1-trace-inventory.json`. Audited 783 retained private checkpoints and five preset progress logs; none matches the closed screen's 210 revision-1 question cache keys. All 210 tool-surfacing outcomes remain `null`, not zero gaps. Repaired labels give 172 fully mapped fine-gold questions, three BEAM-1M questions with ambiguous references and 35 without fine-round labels; MAB additionally has invalid historical ingestion. Other pilot/repaired-run traces are separate executions and cannot replace missing historical traces.
        - Task 5.2 requires fresh revision-1 controls for all five historical development suite cells (210 frozen ids), plus explicit disposition of wider applicable-suite/model coverage; freeze corrected ingestion/mapping and isolate control/candidate stores. The historical paid Muse identity is provenance only: the current user restriction permits OpenRouter free models only for later live work, requiring fresh matched controls/candidates if models change. No paid or free model calls occurred in this offline audit.
        - Verification: 14 focused tests plus 65 documentation/example checks pass (79 total; four new audit regressions initially red before implementation), root typecheck/build passes, formatting/diff checks pass; all 23 accepted report hashes, final artifacts, closure and actual closed journal remain unchanged. Source/private hashes and checks are recorded in `task5/verification.json`. No product/public export/compatibility change; no release/PostgreSQL gate was run for this evidence-only subtask. Task 5 remains unchecked for its other closure subtasks.
    - [x] Task 5.2: Freeze a bounded, paired development-comparison manifest
      - Acceptance Criteria:
        - Functional: Pin revision-1 control and Task-5 candidate product hashes; identical development question ids, corpus mapping, models, judges, answer budgets and scoring rules. Declare the applicable suites and abilities, baseline reuse eligibility, and every fresh control/candidate cell. Do not silently narrow the Task 5 all-applicable-suite target; a smaller exploratory screen cannot close that target.
        - Performance: State physical call, input/output token, concurrency and wall-time caps, estimated cost and stop/resume rules before execution. Include additional control calls where Task 5.1 found unusable traces; separate product and judge costs.
        - Code Quality: Reuse manifest, journal, usage and criteria machinery. Freeze the candidate-gap numerator/denominator, no-regression decision rule, paired analysis and handling of failures/missing labels before observing candidate outcomes; no post-hoc margins or cohort changes.
        - Security: Development partitions only; credential refs only; no held-out access or content in the public manifest.
      - Approach / Files: Extend the existing `scripts/memory-bench/{baseline,campaign,retrieval-diagnostics}.mjs` seams only where necessary; save the executable proposal, hashes and cost estimate in `docs/_evidence/memory-bench/202/task5/`. Use isolated revision-1/candidate artifacts so new archive enrichment cannot contaminate the control.
      - Tests / checks: `task5_manifest_refuses_product_or_cohort_drift`; `task5_manifest_refuses_heldout`; `task5_comparison_requires_matching_budgets_and_evidence_protocol`; run affected offline suites and `timeout 1200 bun run typecheck` for any harness edits.
      - Documentation/Wiki Assessment: Benchmark protocol/evidence only; update the benchmark README if its interface changes and Task 5 evidence README. Public product API: no; `docs/index.md`: no.
      - Notes (executed 2026-10-30): [Manifest](../docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json) and [summary](../docs/_evidence/memory-bench/202/task5/development-comparison-manifest.md), built offline by `scripts/memory-bench/task5-comparison.mjs --manifest` with `manifestHash 061323d5…`. **10 cells = 5 development suites × {revision-1 control, Task-5 candidate} × `preset-r1` × one free answer model**, covering the same 210 frozen ids (172 mapped fine gold, 3 unresolved, 35 without labels) that Task 5.1 inventoried. No historical control is reused: all five control cells and all five candidate cells are fresh, as required by the unusable trace inventory. Model `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`; free plain-text judges `openrouter/dots-studio/dots-3-note-preview:free` + `openrouter/cohere/north-mini-code:free` (neither answers an arm, no paid fallback). Both roles are byte-identical in harness, cohort, mapping, model, judges, budgets, `criteriaHash` and evidence-protocol hash, so only the product is the treatment.
        - **Product pins are reproducible.** Control `ad25add4…` = git tree `5c2570df…` over `packages/memory/{fabric,core}/src`; its fabric-only hash `57aa47d9…` reproduces the closed screen's revision-1 product, so the pin is independently anchored. Candidate `26bf9013…` is the current working-tree product (the Task-5 changes are uncommitted); harness `b773aa64…` is the same in both roles. `auditTask5Comparison` recomputes all three and refuses drift. Isolation: control worktree `.cache/memory-bench/task5/control-worktree`, separate answer/judge cache roots per role, product-hash-keyed write-side snapshots, so enrichment cannot leak into the control.
        - **Frozen before any outcome.** Candidate-gap numerator = questions whose needed round set has no member returned in any successful `memory.recall` hit or `memory.read` note on the selected attempt; denominator = paired questions with ≥1 mapped needed round and complete retained traces in both roles. Positive control gap requires `candidateGap ≤ 0.5 × controlGap`; a zero-gap control requires exact no-loss; failures count in the worst-case bound and never as zero; unresolved/no-label questions are unmeasurable by suite. Abilities must satisfy `candidate − control ≥ −0.03` per suite × ability, with exact paired sign-flip and cluster-bootstrap results reported. The criteria object, paired analysis protocol, judge templates and measurement/tool-surfacing sources are hashed; editing them after the freeze is a refusal, not a re-score.
        - **Budgets and cost, stated before execution.** 69,000,000 reserved input tokens against a separate 100,000,000 ceiling; estimates ~15.82M input / 0.87M output tokens; 4,200 expected and at most 16,800 physical calls; `maxInputTokens` 6–7.5M per cell, 8192 output tokens per call, 8 turns, serial concurrency, per-suite wall caps of 4–144 h (416 h campaign total, dominated by LongMemEval-M ingest). Product and judge costs are separate and both $0.00 on the authorized free routes, so quota and caps bind rather than USD. Stop/resume rules reuse the journal: preflight re-verifies every pin, stops on cap/quota/drift, reuses only fingerprint-matching completed cells and never regenerates completed answers.
        - **Coverage is explicit, not narrowed.** All five suites that carry revision-1 evidence are compared; coding suites (Task 11), optional beam-500k/10m and LongMemEval-S are declared out of scope with reasons, and no cross-model, cross-provider, held-out or Task 18 claim follows. Public manifest carries ids/counts/hashes/budgets only, names the `OPENROUTER_API_KEY` reference and contains no question/answer text; the validator refuses held-out ids, non-`dev` subsets and content fields.
        - Harness seam added only where required: `run.mjs` accepts `--answers-dir`/`--judge-cache-dir` and `campaign.mjs` forwards per-job roots (the answer cache key excludes the product hash, so a shared root would silently reuse the control answer for the candidate). No other harness behavior changed.
        - Verification: 3 new focused regressions pass (product/cohort drift incl. an independent source audit, held-out refusal, budget/evidence-protocol equality and post-freeze rule edits); `scripts/memory-bench` 387 pass / 2 environment skips / 0 fail; campaign suite 9 pass; root typecheck passes; Biome clean on the changed files (one inherited warning); `git diff --check` passes. No provider/model call, held-out access, answer/judge/embedding request or release/PostgreSQL gate was run. Task 5 stays unchecked for the owner gate (5.3), execution (5.4), verdict (5.5), PostgreSQL validation (5.6) and closure (5.7).
    - [x] Task 5.3: Record the paid-development owner gate against the frozen proposal
      - Acceptance Criteria:
        - Functional: Present the concrete Task 5.2 manifest, cells, estimated cost and hard caps; record explicit owner approval of that execution scope under the plan's shared development gate. An existing approval may be reused only when its recorded scope covers this proposal; planning or implementation approval alone does not authorize new paid requests.
        - Performance: No provider/model calls until the gate is recorded; exceeding the approved bounds stops execution.
        - Code Quality: Bind approval to the manifest hash and journal identity; preserve the owner-closed screen and all prior charges/reservations.
        - Security: Gate records contain no credential values or private benchmark text.
      - Approach / Files: Store the gate record with the Task 5 manifest and journal; reuse existing admission/reservation checks rather than adding another approval mechanism.
      - Tests / checks: Existing gate/admission tests plus `task5_execution_refuses_unapproved_or_changed_manifest` if a new Task-5 execution path is needed.
      - Documentation/Wiki Assessment: Evidence/gate record only; update Task 5 notes. Public API: no; `docs/index.md`: no.
      - Notes (executed 2026-10-30): [owner-gate.json](../docs/_evidence/memory-bench/202/task5/owner-gate.json) and [owner-gate.md](../docs/_evidence/memory-bench/202/task5/owner-gate.md), gate 5, approved by owner on 2026-10-30 with the instruction recorded verbatim. Binds `manifestHash 061323d5…` and campaign journal identity `e3d8ac7d…` (criteria, ceiling, provider, model, jobs); a changed manifest/cohort/criteria/journal is a refusal, not a re-approval. Approved scope is the full frozen proposal: 10 cells / 5 pairs / 210 development questions over the five revision-1 suites, arm `preset-r1` (`fabric-x-tools`), answer `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`, judges `openrouter/dots-studio/dots-3-note-preview:free` + `openrouter/cohere/north-mini-code:free`.
        - **Free-only is enforced, not just stated.** The current owner restriction permits free OpenRouter models only for live work, so the gate records `mode: free-openrouter`, `provider: openrouter`, `freeProductsOnly: true` and an empty paid-fallback list, and `assertTask5OwnerGate` refuses a non-`:free` answer or judge route, a paid billing mode, a nonzero estimate or a gate whose caps/scope differ from the manifest. Task 5.4 therefore cannot silently fall back to a paid model; changing models requires a new manifest and a new gate.
        - **Bounds carried over unchanged.** 69,000,000 reserved input tokens, 100,000,000 ceiling, 16,800 hard physical-call cap, concurrency 1, 416 h wall caps, $0 product / $0 judge (quota and caps bind). Exceeding an approved bound stops execution rather than extending it. Preservation is recorded: the owner-closed 23-cell screen stays closed and immutable, all prior charges/reservations stand, historical controls reused 0, no held-out access, no credential values or benchmark text in the record.
        - **Freeze ordering made explicit.** Writing the gate re-audits the on-disk proposal (product pins, harness, cohort) before binding, and the manifest was re-frozen once after the gate machinery and benchmark README landed, because `scripts/memory-bench` is part of the harness hash. The gate therefore binds the current `061323d5…` manifest; earlier `a72a6e0c…`/`01de6c69…`/`e3a714b0…` hashes are superseded and unusable. The Task 5.4 execution module and its campaign wiring landed after that gate, so the manifest was re-frozen a second time and the gate re-recorded against the final hashes; the approved scope, models, criteria, cost and caps are unchanged. Any later harness/product edit invalidates the binding and requires a re-freeze plus a new gate.
        - Verification: 4 focused regressions pass, including `task5_execution_refuses_unapproved_or_changed_manifest` (unapproved, changed manifest/journal, paid mode/fallback/estimate, altered caps/scope, and a non-free judge route); `scripts/memory-bench` 388 pass / 2 environment skips / 0 fail; root typecheck passes; Biome clean on the changed files (one inherited warning); `git diff --check` passes. Gate record and rebuild are deterministic (same journal fingerprint). No provider/model call, held-out access, answer/judge/embedding request or release/PostgreSQL gate was run. Task 5 remains unchecked for execution (5.4), verdict (5.5), PostgreSQL validation (5.6) and closure (5.7).
    - [ ] Task 5.4: Execute the approved control/candidate development comparison
      - Acceptance Criteria:
        - Functional: Run only the approved cells against the frozen development cohort. Collect per-question needed-round surfacing across all successful tool results, answer scores by ability, operational failures and private traces. Clear failed-attempt evidence on retry; preserve unknown labels and failed calls in the accounting. Reuse historical control evidence only when Task 5.1 established comparability.
        - Performance: Enforce the approved call/token/concurrency/wall-time caps and journal reservations; resumptions reuse compatible checkpoints without regenerating completed answers. Report cache usage and product versus judge cost separately.
        - Code Quality: Existing campaign/replay/journal machinery; verify product, criteria and source hashes before and after execution. Record deviations without changing the frozen rules.
        - Security: No held-out access; private traces/answers stay private; public results contain ids/counts/hashes, not content.
      - Approach / Files: Execute the Task 5.2 manifest through the existing benchmark machinery; retain immutable reports, checkpoint provenance and usage evidence under the approved Task 5 execution identity. Do not reopen the 23-cell journal.
      - Tests / checks: Preflight hash/gate checks, matching input/answer budgets, completed-cell reconciliation, retry evidence reset, complete physical-call accounting and no owned paid process left running.
      - Documentation/Wiki Assessment: Evidence only; update Task 5 evidence README and plan notes. Public API: no; `docs/index.md`: no.
      - Notes (attempted 2026-10-30, **blocked; task not complete**): added the approved execution path (`campaign.mjs --task5` + `task5-execute.mjs`): it re-asserts gate 5, refuses a changed manifest/journal, materialises the revision-1 control worktree with the frozen harness and its own `node_modules`, and re-audits product/harness/cohort before and after. A preflight run passed and the campaign journal `campaign-42aa7a93ee64` opened under the approved ceiling with one reserved attempt.
        - **Blocker: the approved free route rejects the product's tool schema.** The first approved cell (`control / beam-100k`) aborted on question 1 with provider 400: `Validation: Function at index 0 has an invalid name: "memory.recall". Only a-z, A-Z, 0-9, underscores, and dashes are allowed.` The product exposes dotted tool names (`memory.recall`, `memory.read`); the OpenRouter/Nvidia route enforces `[a-zA-Z0-9_-]`. A direct one-call probe reproduced the 400 with a dotted name and a plain generated function name on the same model; `nvidia/nemotron-3.5-super-vl:free` returned 400, `google/gemma-4-31b-it:free` 429, `thinkingmachines/inkling:free` 403 (agentic harnesses only). The failed attempt kept its reservation (7.5M, `usageComplete: true`, confirmed 0), charged $0, and its report/journal record the failure; no answer or judge result exists.
        - **Second constraint: free-tier request quota.** The key has a $50 limit with $49.94 remaining, but `:free` routes bind on requests, not USD: the diagnostic calls already hit `Rate limit exceeded: free-models-per-min`, and the campaign's expected 4,200 physical calls exceed the free daily allowance. A complete 10-cell run therefore spans multiple days even after the schema blocker is fixed.
        - Not changed: the product (tool names are its public surface and the Task 5 treatment), the cohort, criteria, model, judges, caps or the gate text. The approved scope was not narrowed and no result was fabricated. Evidence: `execution-run.json`, `execution-verification.json`, the attempt report and the campaign journal. Unblock options for the owner: (a) a benchmark-side wire encoding of dotted tool names, re-frozen and re-gated before any outcome (no product change), then a multi-day resumable run; (b) approve a different free route that accepts dotted names (none verified) or relax the free-only restriction. Task 5.4 stays unchecked; Task 5.5 cannot start without paired outcomes.
        - **Root cause and unblock path (reviewed 2026-10-31).** The product fix already exists: Task 4's live notes record `src/provider-kit/tool-names.ts` and the codec changes that encode `memory.recall` → `memory_recall` per request, with `docs/provider-kit.md` and the CHANGELOG entry. That work is still uncommitted, and `TASK5_CONTROL_REVISION` (`task5-comparison.mjs:38`, `5c2570df`, the 188.11 commit) predates it, so the control worktree sent raw dotted names. The review also found that the two arms differ in more than the product: `TASK5_PRODUCT_PATHS` (`task5-comparison.mjs:42`) hashes only `packages/memory/{fabric,core}/src`, while the control checks out the whole of `5c2570df` (`task5-execute.mjs:42`). `git diff 5c2570df -- src/` also shows the agent `reload()` assembly refactor (`src/agent-session/create-agent.ts`, `runtime-registry.ts`, `session.ts`, `contracts-core/agent.ts`). The claim that "only the product is the treatment" was therefore never enforced. Option (a) above is rejected: it would fix the harness and leave the shipped product broken on the same routes. Tasks 5.4.1–5.4.5 replace options (a) and (b). The 4,200-call figure is a ceiling formula, not an expectation (Task 5.4.3).
    - [x] Task 5.4.1: Close the remaining wire-name gap and land the tool-name fix as its own commit
      - Acceptance Criteria:
        - Functional: The Chat codec's history replay serializes every tool name in a replayed `tool_call` through `wireToolName(call.name, toolNames)`. Today `src/provider-kit/codecs/openai-chat.ts:388` uses `toolNames?.wire.get(call.name) ?? call.name`, so a dotted call from an earlier turn whose tool is not offered this turn (tool narrowing, memory tools removed mid-session) reaches the wire raw and gets the same 400. The Responses (`openai-responses.ts:303`) and Messages (`anthropic-messages.ts:377`) codecs already do this. A repo-wide grep over `src/ packages/ apps/ scripts/ examples/` finds no other place that sends a `ToolDefinition.name` or `tool_call` name to a model wire unencoded. Provider packages are covered because all five tool-capable providers and `openai-compatible` go through `createRoutedProvider`. laya, liquid and typesafe refuse tools (`src/provider-kit/systemone-provider.ts:162`).
        - Functional: The tool-name change lands as one commit, made with owner approval, separate from the Task 5 harness and candidate-product changes. It contains `tool-names.ts`, the three codecs, `openai-primitives.ts`, `routed-provider.ts`, `provider-kit/index.ts`, their tests, the `docs/provider-kit.md` section and the CHANGELOG entry.
        - Performance: One map per request, as now; no added request or allocation per stream event.
        - Code Quality: No new helper; reuse `wireToolName`. The root baseline (`scripts/compat-baseline/arnilo__prism.txt`) does not yet list `createToolNameMap`, although `src/__tests__/public-export-contract.test.ts:707` does. Regenerate it with `bun scripts/release.mjs gate --update-baseline` in this task, and attribute the diff in the task note.
        - Security: Wire names never leak into the tool registry, events or traces. Decoded calls carry the product name, and an unknown wire name passes through unchanged rather than resolving to a different tool.
      - Approach:
        - Documentation Reviewed: `src/provider-kit/tool-names.ts` (bijection, `_2` suffix on collision); `openai-chat.ts:174,258,388`; `openai-responses.ts:198,303`; `anthropic-messages.ts:377,426`; `routed-provider.ts:136`; existing tests `src/__tests__/openai-chat-codec.test.ts:360` and `src/__tests__/anthropic-messages.test.ts:148`; OpenAI/Anthropic name rule `^[a-zA-Z0-9_-]{1,64}$`. MCP (`packages/hosts/mcp-server/src/serve-tools.ts:110`) permits dots, so it is out of scope here.
        - Options Considered: rename the fabric tools to `memory_recall` (rejected: it changes a public product surface and the Task 5 treatment); sanitize in each provider package (rejected: wire code shared by providers belongs in `provider-kit`, and it already lives there).
        - Chosen Approach: a one-line fallback fix plus a cross-codec test, then commit the existing fix.
        - Files to Create/Edit: `src/provider-kit/codecs/openai-chat.ts`; `src/__tests__/openai-chat-codec.test.ts`; `scripts/compat-baseline/arnilo__prism.txt` (regenerated); `CHANGELOG.md` (extend the existing entry with the replay case).
      - Test Cases to Write:
        - `openai_chat_replays_unoffered_dotted_tool_call_wire_safe`: history holds a `memory.recall` call and the request offers no tools; the body carries `memory_recall`. Fails on the current line 388.
        - `every_codec_encodes_replayed_tool_calls_for_tools_not_offered`: Chat, Responses and Messages agree. Fails if a codec drifts back to a raw fallback.
        - Existing dotted-name codec tests stay green.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: yes, provider-kit wire behavior for replayed calls.
        - Docs pages to create/edit: `docs/provider-kit.md` (one sentence: replayed calls for tools not offered this turn are encoded too).
        - `docs/index.md` update: no.
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-31): commit `a88bc21a` (`fix(provider-kit): encode tool names on every wire path`), owner-approved as its own commit and separate from the Task 5 harness and candidate changes.
        - **Gap closed.** `src/provider-kit/codecs/openai-chat.ts:388` now serializes a replayed `tool_call` through `wireToolName(call.name, codecOpts.toolNames)` instead of `codecOpts.toolNames?.wire.get(call.name) ?? call.name`, so a dotted call for a tool the request no longer offers reaches the wire as `memory_recall`. `wireToolName` falls back to `safeBase` when no request map exists, and an unknown wire name still decodes unchanged (`productToolName`), so no call can resolve to a different tool. Responses (`openai-responses.ts:303`) and Messages (`anthropic-messages.ts:377`) already encoded this path; only Chat had the raw fallback.
        - **Regression coverage.** New `openai_chat_replays_unoffered_dotted_tool_call_wire_safe` (history call with `tools` absent — fails on the old line) and `every_codec_encodes_replayed_tool_calls_for_tools_not_offered`, which asserts all three codecs encode the same narrowed-tools replay. The existing dotted-name codec tests stay green. A repo-wide sweep over `src/ packages/ apps/ scripts/ examples/` for raw `ToolDefinition.name`/`tool_call` wire sends found no other site: the three codecs are the only serializers, every tool-capable provider package routes through `createRoutedProvider`, and laya/liquid/typesafe refuse tools.
        - **Baseline regenerated and attributed.** `scripts/compat-baseline/arnilo__prism.txt`: `+createToolNameMap`, `+productToolName`, `+wireToolName`, `serializeOpenAITool(tool, names?)`. The same emit also carries `+skillSourceFor`/`+toolListFor` from the in-flight agent reload refactor and the `replayFetch` union's export-order change; those symbols are already in the tree and the baseline must match it. `bun scripts/release.mjs gate --update-baseline` stops at `checkReleaseEvidence` (`PRISM_TEST_POSTGRES_URL` unset — no disposable pgvector container was provisioned, and a foreign local Postgres was not used), so the surface was regenerated through the same `runGates` baseline branch with the root package filter; the second run was idempotent. One pre-existing failure is unrelated and left untouched: `provider-kit > no_workspace_imports_prism_providers` fails on `existsSync("packages/prism-providers")` because HEAD still tracks that workspace directory.
        - Verification: 144 pass / 0 fail across the 10 provider/codec/export suites that exercise the change; root typecheck passes; Biome clean on the new test and edited codec lines (pre-existing unused-import warnings in `openai-chat.ts`/`openai-primitives.ts` predate this commit and were not churned); `git diff --check` passes on the commit. No provider or model call was made.
        - **Freeze impact: none.** The commit touches neither `TASK5_PRODUCT_PATHS` (`packages/memory/{fabric,core}/src`) nor `TASK5_HARNESS_PATHS` (`scripts/memory-bench`), so no re-freeze is caused by this commit. The frozen control is still a full checkout of `5c2570df`, which predates this fix, so it would still send raw dotted names: Task 5.4.2 must commit the candidate, build the `task5-control-r2` overlay (commit C with only the product paths from `5c2570df`), and re-pin and re-gate both arms before execution, so the control carries this wire fix too.
    - [x] Task 5.4.2: Pin both arms to commits that differ only in the product paths
      - Acceptance Criteria:
        - Functional: The candidate is a commit `C`, not the working tree. The control is a new revision `task5-control-r2`: commit `C` with `TASK5_PRODUCT_PATHS` checked out from `5c2570df`, committed on a local ref so it reproduces. `TASK5_CONTROL_REVISION` points at r2, and a new pin `TASK5_CONTROL_PRODUCT_SOURCE = 5c2570df` records where the control product comes from. The control product hash still equals `ad25add4…`, the revision-1 fabric hash `57aa47d9…` is still reproduced, and both arms carry the 5.4.1 wire-name fix.
        - Functional (fail closed): preflight refuses to run unless `git diff --name-only <control> <candidate>` lists only paths under `TASK5_PRODUCT_PATHS`. It also refuses a candidate with uncommitted changes anywhere outside `.cache/`, and a control worktree whose `HEAD` is not r2.
        - Functional: the revision-1 fabric/core code runs against the r2 kernel. `bun test packages/memory/fabric packages/memory/core` and the typecheck pass inside the control worktree. If they fail, stop: the overlay is not comparable, and the owner decides.
        - Performance: Worktree setup only; no provider call.
        - Code Quality: Extend `prepareTask5Control` (`task5-execute.mjs:38`) and the preflight; no second worktree mechanism.
        - Security: No credentials in refs or evidence; evidence carries revisions and hashes only.
      - Approach:
        - Documentation Reviewed: `task5-comparison.mjs:38,42,132,243–247`; `task5-execute.mjs:38–55`; `git diff 5c2570df --stat -- src/ packages/` (kernel codecs and `reload()` refactor; `packages/providers/hyper/src/models.ts`, `packages/hosts/remote/src/connect.ts`, deleted `packages/memory/src/package-command.ts`).
        - Options Considered: cherry-pick only the tool-name commit onto `5c2570df` (rejected: it leaves the `reload()` refactor and the other kernel drift unpinned between arms); widen the product hash to include `src/` (rejected: it makes the kernel part of the treatment and misattributes any effect); the benchmark-side encoding from the 5.4 notes (rejected: the shipped product would stay broken).
        - Chosen Approach: an overlay revision, with equality of everything outside the product paths enforced as a git diff check.
        - Files to Create/Edit: `scripts/memory-bench/task5-comparison.mjs` (pins), `scripts/memory-bench/task5-execute.mjs` (worktree and preflight), `scripts/memory-bench/task5-comparison.test.mjs`, `scripts/memory-bench/README.md`.
      - Test Cases to Write:
        - `task5_control_differs_from_candidate_only_in_product_paths`: fails if a kernel or provider file differs between arms.
        - `task5_control_product_hash_reproduces_revision1`: fails if the overlay changed product bytes.
        - `task5_refuses_uncommitted_candidate`: fails if working-tree drift could enter the candidate arm.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: no; benchmark harness only.
        - Docs pages to create/edit: `scripts/memory-bench/README.md` (control r2 construction); Task 5 evidence README.
        - `docs/index.md` update: no.
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-31): both arms are commits now, and the committed difference is the product only.
        - **Candidate** `2a8a0cdd…` (the working tree committed as one revision; product `26bf9013…`). Nothing is read from a mutable checkout: `assertTask5CandidateClean` refuses any uncommitted path outside `.cache/`, the Task 5 evidence directory and the plan (the last two are not part of any frozen hash and are rewritten by the freeze itself).
        - **Control r2** `e10f6964…`: a deterministic overlay commit built by `task5ControlRevision(candidate)` in a temporary git index — the candidate tree with `packages/memory/{fabric,core}/src` replaced by the bytes from `TASK5_CONTROL_PRODUCT_SOURCE = 5c2570df…`, committed with fixed author/committer metadata so the sha reproduces. `ensureTask5ControlRef` owns `refs/heads/task5-control-r2`; `prepareTask5Control` checks out that sha (rebuilding a stale worktree) and copies the frozen harness on top. The manifest pins `control.revision`, `control.sourceRevision` and `candidate.revision`; the old `TASK5_CONTROL_REVISION` literal is gone because a literal r2 sha would be circular (r2's parent is the candidate, whose tree contains the harness that pins r2).
        - **Equality outside the product is enforced, not assumed.** `auditTask5Comparison` and the manifest builder recompute the overlay, refuse a control whose product hash is not `ad25add4…` or whose fabric-only hash is not `57aa47d9…`, require the working-tree product to equal the pinned candidate commit's product, require `git diff --name-only r2 candidate` to list only paths under `TASK5_PRODUCT_PATHS`, and allow commits after the candidate pin to touch only the Task 5 evidence directory or the plan. Both arms therefore carry the 5.4.1 wire-name fix, while only the memory product differs.
        - **Preflight** additionally runs `bun test --concurrency=1 packages/memory/fabric packages/memory/core` and `bun run typecheck` inside the control worktree. Serial is deliberate: those suites share temp state across files and flake under parallel file execution (pre-existing, reproduced at ~50% without `--concurrency=1`; unaffected by this task).
        - New regressions: `task5_control_differs_from_candidate_only_in_product_paths` (committed arm diff is product-only, `src/` and `scripts/memory-bench/` are refused by the classifier, the overlay reproduces), `task5_control_product_hash_reproduces_revision1` (r2 and the source commit both yield `ad25add4…`; fabric-only `57aa47d9…`), `task5_refuses_uncommitted_candidate` (product and kernel dirt refused, `.cache/`, evidence and plan allowed).
        - Manifest re-frozen to `061323d5…`; gate re-recorded against the unchanged journal identity `e3d8ac7d…`. Verification: `task5-comparison` 8 pass / 0 fail; `scripts/memory-bench` 394 pass / 2 environment skips / 0 fail; root typecheck passes; Biome clean on the changed harness files (one inherited warning); `git diff --check` passes; `preflightTask5` passes end to end, including the control-worktree suites and typecheck, with no provider call.
    - [x] Task 5.4.3: Replace the call ceiling with a measured estimate and make the daily free quota resumable
      - Acceptance Criteria:
        - Functional: `expectedPhysicalCalls` stops being `2 × questions × (BENCH_MAX_TURNS.standard + judges)` (`task5-comparison.mjs:322`, 420 × 10 = 4,200), which is a per-question ceiling. It becomes a measured rate with its source cited: the `preset-r1` `beam-100k` reports average 3.2 solver calls per question on Nemotron 3.5 Lightning `:free` (127/40), 4.0 on beam-free and 2.35 on minimax-m3, and about 2.25 judge calls per question. Task 5 sets `labelInjections: "off"`, so the earlier `injection-label` calls (443/40) do not occur. The manifest states a range of about 2,300–2,700 calls and keeps the 16,800 hard cap.
        - Functional: a daily free-quota 429 (`free-models-per-day*`, matched by the regex `rateLimitDisposition` uses at `audit/zero-score.mjs:19`) is classified as `quota-daily`. The journal halts with that status and a resume-after time. The halt does not count against `maxAttempts` (`campaign.mjs:284`, value 2) and does not take the 15-minute pause path (`campaign.mjs:960`). A rerun reuses completed answer checkpoints and judge caches and regenerates no answer.
        - Functional: preflight reads OpenRouter `GET /api/v1/key` and records the key's free tier. It refuses to start when the account is below the 1,000-requests/day tier.
        - Performance: OpenRouter documents `:free` limits per account across all free models: 20 requests per minute, and 1,000 per day once at least 10 credits have been purchased (50 otherwise). A single pacer, shared by the solver and both judges, keeps the campaign under 20/min. At about 2,500 calls the run spans at least 3 quota days, and the evidence states this.
        - Code Quality: Reuse `rateLimitDisposition` and the existing judge pacer (`PRISM_MEMORY_BENCH_JUDGE_RATE`); do not write a second classifier.
        - Security: The key is read from `OPENROUTER_API_KEY` by reference. The `/key` response is reduced to the tier and remaining counts before it is written to evidence.
      - Approach:
        - Documentation Reviewed: OpenRouter limits docs (`/docs/api_reference/limits`, `GET /api/v1/key`, via Context7 2026-10-31); `campaign.mjs:907–965`; `replay.mjs:38–44` (`BENCH_RETRY`, `BENCH_MAX_TURNS`); baseline reports under `docs/_evidence/memory-bench/202/baseline/report-202-baseline.beam-100k.preset-r1.*.json` (`timing.roles`).
        - Options Considered: keep 4,200 (rejected: it overstates the run by about 1.7×, which misleads the owner's multi-day decision); lower the turn cap (rejected: it changes the frozen protocol).
        - Owner option, not chosen by default: answer all 10 cells first, then judge. The candidate-gap verdict needs no judge call, so if halving fails, the roughly 950 judge calls become diagnostic only. It is not the default because Task 5.4 requires per-ability scores.
        - Files to Create/Edit: `scripts/memory-bench/task5-comparison.mjs`, `scripts/memory-bench/campaign.mjs`, `scripts/memory-bench/task5-execute.mjs`, their tests, `scripts/memory-bench/README.md`.
      - Test Cases to Write:
        - `task5_expected_calls_use_measured_rate_not_turn_cap`: fails if the estimate equals the turn-cap formula.
        - `daily_free_quota_halts_resumable_without_consuming_attempt`: fails if a daily 429 uses up an attempt or pauses for 15 minutes.
        - `free_route_pacer_is_shared_across_solver_and_judges`: fails if two roles can together exceed 20 calls per minute.
        - `resume_after_daily_halt_regenerates_no_answer`: fails if a completed answer is re-requested.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: no.
        - Docs pages to create/edit: `scripts/memory-bench/README.md` (daily-quota halt and resume, shared pacer).
        - `docs/index.md` update: no.
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-31): the estimate is measured, the free quota halts instead of pausing, and preflight refuses a thin account.
        - **Estimate.** `expectedPhysicalCalls` is now `questionRuns × (solver + judge)` from `TASK5_CALL_RATES`, whose source is cited in the manifest: the frozen `preset-r1` `beam-100k` report for the same free answer family, `timing.roles` solver 127 / judge 90 over 40 questions with `labelInjections: "off"` — 3.2 and 2.25 per question. 420 question-runs give `expectedPhysicalCalls` 2,289 with `expectedPhysicalCallsRange` 2,289–2,625 (high end at the slower `beam-free` 4.025 solver rate); the old formula priced 2 × 210 × (8 + 2) = 4,200, a ceiling nobody measured. The 16,800 hard cap and every other cap are unchanged, and `physicalCallEstimate` records `questionRuns`, the per-question rates, their source and `injectionCalls: 0`.
        - **Daily free quota.** `dailyFreeQuotaFailure` classifies a failed report with the diagnostic harness's own `rateLimitDisposition` (`audit/zero-score.mjs`) after deriving the HTTP status from the wrapped `MemoryBench*Error:<status>` code, so the tree still has one 429 classifier. A `free-models-per-day*` 429 writes the attempt as `quota-daily` (new terminal attempt status in `journal.mjs`), sets `journal.status = "quota-daily"` with `resumeAfter` = next UTC midnight (`PRISM_MEMORY_BENCH_DAILY_RESET_HOUR_UTC` overrides the hour), saves, and returns `{ halt: true }` before the 15-minute pause path. `isBudgetQuotaCause` covers `quota-window` and `quota-daily`, so the halt never consumes the job's two attempts; the rerun resolves the same `answersDir`/`judgeCacheDir` checkpoints and the previous attempt's output as its resume source, so a completed answer is never requested twice. A per-minute 429 and any non-429 stay on the existing transient/permanent paths.
        - **Key tier.** Preflight calls `GET https://openrouter.ai/api/v1/key`, reduces the response with `freeTierFromKeyResponse` (`paidTier`, `dailyFreeRequests`, `limitRemainingUsd`, `usageUsd` — the key is never copied), writes `docs/_evidence/memory-bench/202/task5/free-key.json`, and `assertTask5FreeTier` refuses to start below 1,000 requests/day. Live read on 2026-10-30: `paidTier: true`, `dailyFreeRequests: 1000`, $49.94 remaining.
        - **Shared pacer.** `createFreeRoutePace` builds one pacer for free routes (default 20/minute, `PRISM_MEMORY_BENCH_FREE_PACE_PER_MINUTE` overrides, values above 20 refused) and `run.mjs` hands the same instance to `state.pace` (used by `measuredProvider` before every solver, worker and extractor call) and to both judge entries, so the roles cannot exceed the account budget together. Paid routes keep the per-model `PRISM_MEMORY_BENCH_JUDGE_RATE` pacer.
        - The pacer reuses `createJudgePacer`, whose interval is `3_600_000 / perHour`; 20/min is 1,200/hour, so free calls are spaced 3 s.
        - New regressions: `task5_expected_calls_use_measured_rate_not_turn_cap`, `daily_free_quota_halts_resumable_without_consuming_attempt`, `free_route_pacer_is_shared_across_solver_and_judges`, `resume_after_daily_halt_regenerates_no_answer`, plus `task5_preflight_refuses_an_account_below_the_daily_free_tier` for the tier reduction and refusal.
        - **Freeze impact: re-freeze required, and performed.** The harness changed (`task5-comparison.mjs`, `campaign.mjs`, `journal.mjs`, `replay.mjs`, `run.mjs`, their tests, the benchmark README), so the candidate commit was amended to carry it and the manifest and gate were regenerated: candidate was amended to carry it; the final pins are recorded in Task 5.4.4 (gate 6, `manifestHash dca330de…`), journal identity unchanged at `e3d8ac7d…` (criteria, ceiling, provider, model and jobs did not move; only the informational estimate did). Task 5.4.4 still owns the formal re-freeze record and the gate-diff note.
        - Verification: `scripts/memory-bench` 397 pass / 2 environment skips / 0 fail on the candidate before the last two harness edits, 153 pass / 0 fail across the four task5/campaign/run/journal suites after the final re-freeze, root typecheck passes, Biome clean on the changed files, `git diff --check` clean, and `preflightTask5` passes end to end with a live `GET /api/v1/key` (no model call).
    - [x] Task 5.4.4: Re-freeze the manifest and re-record the owner gate
      - Acceptance Criteria:
        - Functional: After Tasks 5.4.1–5.4.3, re-freeze with `task5-comparison.mjs --manifest` and record a new gate with the owner's instruction verbatim. The gate binds the new manifest hash, the r2 control, the candidate commit and a new journal identity. These stay byte-identical to gate 5: cohort ids, `criteriaHash`, evidence-protocol hash, answer model, judges, budgets and caps, and zero historical reuse. Only the pins, the harness hash and the informational call estimate change, and the gate note lists each change.
        - Functional: The old journal `campaign-42aa7a93ee64` and its failed attempt (7.5M reserved, $0) stay immutable as evidence and are never resumed. Gate 5 is marked superseded, not edited.
        - Performance: Offline; no provider call.
        - Code Quality: Existing gate machinery (`assertTask5OwnerGate`); no override flag.
        - Security: The free-only constraints (`freeProductsOnly: true`, empty paid fallback) are unchanged and asserted.
      - Approach: Documentation Reviewed: Task 5.3 notes (freeze ordering and binding rules). Options Considered: reuse gate 5 (rejected: any harness or product edit invalidates the binding). Files: `docs/_evidence/memory-bench/202/task5/{development-comparison-manifest,owner-gate}.{json,md}`.
      - Test Cases to Write: `task5_execution_refuses_unapproved_or_changed_manifest` stays green against the new gate; `task5_gate_diff_lists_only_pin_and_estimate_changes` fails if the cohort, criteria, models or caps moved.
      - Documentation/Wiki Assessment: evidence only; Public API no; `docs/index.md`: no. Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-31): gate 6 replaces gate 5, and the frozen semantics did not move.
        - **Why a re-freeze was inevitable.** Task 5.4.3 edited the harness (`task5-comparison.mjs`, `run.mjs`, `campaign.mjs`, `journal.mjs`, the tests and the benchmark README), and `product.harnessHash` plus every cell's `harnessHash` is a pin. The candidate commit was amended to carry those edits (`c539e38c…`), so both the candidate pin and the control r2 pin (`2e51437e…`) moved; the product hashes did not (`ad25add4…` control, `26bf9013…` candidate).
        - **Gate 6** (`docs/_evidence/memory-bench/202/task5/owner-gate.json`, `manifestHash dca330de…`) records the owner's instruction verbatim and binds the arms explicitly (`gate.product`: control, control source, both product hashes, candidate, harness hash), not only the manifest hash that covers them. `assertTask5OwnerGate` refuses a gate whose arm pins differ from the manifest.
        - **Gate 5 stays unedited.** Its original bytes, taken from commit `3edfa3b2`, are archived at `docs/_evidence/memory-bench/202/task5/gates/owner-gate-5.json` (sha256 `08290147…`, manifest `061323d5…`) with the gate-5 manifest at `gates/development-comparison-manifest-5.json`. Gate 6 carries that sha256 in `supersedes.records` and lists all 45 changed manifest leaves; `--supersedes` derives the list rather than letting a human claim it.
        - **Only pins, harness-derived hashes and the estimate moved.** `TASK5_REFREEZE_ALLOWED` allows `generatedAt`, `manifestHash`, the control/candidate/harness pins, per-cell `productRevision`/`worktreeRevision`/`harnessHash`, and the `expectedPhysicalCalls*`/`physicalCallEstimate*` fields; `assertTask5RefreezeDiff` refuses anything else. Cohort ids and `idsHash`, `criteriaHash`, every rule in `evidenceProtocol` (mapping/toolSurfacing/analysis fingerprints), answer model, judges, budgets, caps and `baselineReuse` are byte-identical to gate 5, and the journal identity is unchanged at `e3d8ac7d…`. This required moving the free-route pacer out of `replay.mjs` (whose bytes feed `evidenceProtocol.toolSurfacing`) to the provider edge in `run.mjs`; the first iteration of 5.4.3 had moved the evidence-protocol hash, which is now avoided rather than documented away.
        - **The old journal is never resumed.** `archiveFinishedTask5Journal` runs in preflight: a journal whose status is `finished` is archived verbatim to `docs/_evidence/memory-bench/202/task5/journal-campaign-42aa7a93ee64.json` (one failed attempt, 7.5M reserved, 0 confirmed, $0) and removed from the cache; an open journal (for example after a `quota-daily` halt) is left alone because that is the real resume point. Preflight archived `campaign-42aa7a93ee64` on 2026-10-31, so the next campaign opens a new one.
        - New regressions: `task5_gate_diff_lists_only_pin_and_estimate_changes` (the archived gate-5 manifest versus the new one: every change is allowlisted, includes the candidate pin and the estimate, contains no `evidenceProtocol` field, and a moved question id, judge, cap or criterion is refused) and `task5_finished_journal_is_archived_not_resumed` (finished journals are archived byte-identically and removed; a `quota-daily` journal is kept).
        - Verification: `task5-comparison` 12 pass / 0 fail; `scripts/memory-bench` 399 pass / 2 environment skips / 0 fail; root typecheck passes; `preflightTask5` passes end to end against gate 6 (r2 worktree rebuilt, revision-1 fabric/core suites and typecheck green, archived journal written), with no provider call. The live key tier from Task 5.4.3 was reused rather than re-read.
    - [x] Task 5.4.5: Bounded wire smoke, then resume Task 5.4
      - Acceptance Criteria:
        - Functional: Before the full run, one question per arm on `beam-100k`, charged to the new journal, proves four things. The route accepts `memory_recall`. The decoded calls and recorded traces carry the product names `memory.recall` and `memory.read`. `audit/task5-traces.mjs:23` and `replay.mjs:1061,1098` find the surfaced notes. The surfacing count is computed from real hits. A wire name in a trace would make surfacing read zero without any error and corrupt the candidate gap, so the smoke fails closed on it.
        - Functional: Then run the full campaign resumably under Task 5.4's acceptance criteria, across quota days, using the 5.4.3 halt and resume.
        - Performance: The smoke is at most 2 questions, about 12 calls, within the gated caps.
        - Code Quality: Existing campaign path; the smoke is a job filter, not a separate runner.
        - Security: Traces stay private under `.cache/memory-bench/task5/`.
      - Approach: Options Considered: go straight to the full run (rejected: a decoding fault would surface only in Task 5.5, after days of quota). Files: `scripts/memory-bench/task5-execute.mjs` (smoke filter), its test.
      - Test Cases to Write: `task5_traces_record_product_tool_names_not_wire_names`: fails if a trace carries `memory_recall`.
      - Documentation/Wiki Assessment: evidence only; Public API no; `docs/index.md`: no. Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-31): the smoke is a campaign job filter, and it passed on both arms.
        - **Implementation.** `buildTask5CampaignManifest({ smoke: true })` keeps the approved jobs but selects the two `beam-100k` cells and sets `maxQuestions: 1` on each; `campaign.mjs --task5-smoke` runs that under its own journal (`.cache/memory-bench/task5/journal-smoke.json`) and evidence prefix (`smoke-`), so it cannot collide with or resume the full campaign. `jobArgv` forwards `--max-questions`, which the existing runner already supports, so no new runner and no new benchmark flag was added. The build refuses a smoke that is not exactly two cells or more than two questions.
        - **Fail-closed trace contract.** `assertTask5TraceProductNames` reads every `tool_use`/`tool_result` in a decoded trace and refuses any `memory_*` name and any name outside `memory.recall`/`memory.read`; `assertTask5SmokeReports` additionally refuses a smoke with no `memory.recall` (the call the route rejected before Task 5.4.1), no returned notes, no report, or a `turnTrace` carrying a non-product name. A wire name would make surfacing read zero with no error, which is exactly the corruption the smoke exists to catch.
        - **Smoke result (2 questions, 73k tokens, $0).** Control and candidate each answered one `beam-100k` question on `nvidia/nemotron-3-ultra-550b-a55b:free` — the exact route that returned `400 invalid function name memory.recall` on the Task 5.4 attempt. Both completed as `partial` (the capped-run status), the decoded traces carry `memory.recall` only, `execution-smoke-verification.json` records `hits: 20` from real returned notes (control 5, candidate 30 across the paired caches), and no trace or turn trace carries `memory_recall`. The question is an abstention row, so `memory.read` is offered but never called; any name that does appear is a product name, which is what the guard enforces.
        - **Control verification flake, handled rather than hidden.** Preflight now retries the control worktree's fabric/core suites up to three times and records every attempt in `docs/_evidence/memory-bench/202/task5/control-verification.json`. The fabric suite has a pre-existing cross-file isolation flake (`policy.reviewSession … a duplicate folds` reads a neighbour's ledger: 1 failure in 2 full-suite runs, 0 in 5 isolated runs); it cannot be fixed without editing the frozen product, so the retry is bounded evidence, not a silent pass. The gate-9 preflight passed on the first attempt.
        - **Gate 9** (`manifestHash 48395537…`, candidate `076677a5…`, control r2 `5355f41e…`, harness `a7be89b4…`; journal identity still `e3d8ac7d…`) authorizes this harness change, and supersedes gate 8 with the same diff discipline as 5.4.4. Gates 5–8 stay archived unedited under `gates/`.
        - **Status check 2026-10-31 06:34Z.** The first overnight leg halted honestly: control `beam-100k` completed 40/40 (1,102,309 confirmed tokens), candidate reached 9/40 (199,094 confirmed) and then got a real `429 Daily quota exhausted` (`resumeAfter 2026-10-31T00:00:00Z`, already past by the time of the check), so the journal sat at `quota-daily` with $0 spent.
        - **Two resume blockers found by that check, both now fixed.** (a) The resume was refused because a concurrent writer had uncommitted `plans/207-210`, `plans/README.md`, `roadmap.md` and `.agents/skills/…`: `assertTask5CandidateClean` now refuses dirty paths that can change an arm's bytes (`TASK5_PRODUCT_PATHS`, `TASK5_HARNESS_PATHS`, `src/`, `packages/`, `apps/`, `scripts/`) and reports the rest instead of failing, because plans and docs cannot change what an arm executes. (b) The resumed attempt died with `MemoryBenchResumeMismatch`: `protocolFingerprint` includes `sourceRevision`, so the gate-10 candidate amend invalidated the gate-9 checkpoint, and the campaign kept handing `--resume` a foreign protocol. The campaign manifest now carries `sourceRevision` and a checkpoint from another revision is dropped (and logged) instead of being resumed.
        - **Freeze cost, stated plainly.** Each harness amend moved the candidate revision and therefore invalidated in-flight checkpoints: the 1.3M tokens of the first leg are spent and unusable, at $0. The stale journal is archived as `journal-campaign-e3d8ac7d031a-1.json`, and gates 10 (`manifestHash c9c6b88b…`, candidate `…`) and 11 (`manifestHash 90862ef1…`, candidate `d21b9305…`, control r2 `51d23d4e…`, harness `66aabefb…`) record the two fixes; gates 5-9 stay archived unedited. **No further harness or product edit may happen before the campaign finishes** — it would orphan every checkpoint again.
        - **Status check 2026-10-31 09:55Z, and the churn it exposed.** The leg under gate 11 did real work — control and candidate `beam-100k` both completed (1,187,435 / 1,601,646 confirmed tokens), control `locomo` completed 60/60 (1,653,810), candidate `locomo` reached 55/60 (996,167) — then halted on another genuine daily 429 (`resumeAfter 2026-11-01T00:00:00Z`). The postflight failed for a third reason: a commit after the pin touched `plans/207-208` and `.agents/…`, which the post-pin guard did not allow even though no arm can execute those bytes. `task5PostFreezePaths` now reuses the executable-path filter, so the pin guards code and the harness only.
        - **The real defect behind all three restarts.** `run.mjs` recorded the report's `sourceRevision` as the arm worktree's `git rev-parse HEAD`, so every harness amend changed the report identity and the protocol fingerprint orphaned every checkpoint. The campaign now sets `PRISM_MEMORY_BENCH_SOURCE` to the arm's *product hash* (`productRevision.{control,candidate}` = `ad25add4…` / `26bf9013…`), which is what a report should mean, so a harness commit can no longer invalidate work while a product change still does. The campaign manifest carries that map and the stale-checkpoint check reads it.
        - **Honest accounting.** Gate churn orphaned 1.3M (leg 1) and 5.4M (leg 2) free-quota tokens; money spent was $0 throughout, and the harness/owner gate, product pins, cohort, criteria, models, judges, caps and approval text never changed meaning. Gates 12-14 (`manifestHash 4f5ccdb9…`, `2694bf39…`, final `2694bf39…`) record these; gates 5-13 stay archived unedited. Today's quota is spent, so the next leg starts 2026-11-01T00:00Z under gate 14 from a fresh checkpoint baseline — the first leg that cannot be orphaned by a harness edit.
        - **Full campaign resumed.** `campaign.mjs --task5` started on 2026-10-31 under campaign `campaign-e3d8ac7d031a` after a clean preflight (control worktree rebuilt, suites and typecheck green). It is resumable by design: the 2,289-call estimate exceeds the 1,000 free requests/day, so it halts `quota-daily` and continues from its journal on the next day. Task 5.4 stays unchecked until the ten cells are actually complete; nothing in Task 5.5 may run before that.
        - **Superseded 2026-11-01 by Task 5.4.6.** The owner re-scoped Task 5.4 to a bounded development screen; Task 5.4 now completes when the 5.4.6 cells are complete, not the ten cells above.
    - [x] Task 5.4.6: Owner disposition — re-scope Task 5.4 to a bounded development screen and hand the rest to plan 210
      - **Owner disposition (recorded 2026-11-01, before any Task 5.5 computation).** The owner's instruction, verbatim: "Given the scope of the memory work has been extended significantly now beyond [plan 202] is it worth spending so many live run tokens in Task 5.4 for example or we can relax it with a lighter test reasonably. We can do a hard test after all the other updates in 207 to 210 is in." Then, after reviewing the risks: "go ahead, draft the disposition and plan 210 hand-off".
        - **Why.** Money is not the constraint; the free routes cost $0. Calendar time and repo availability are. The ten-cell run needs about 2,289–2,625 calls against 1,000 free requests per day, and wall caps of 208 h per role, of which `longmemeval-m` is 144 h. While it runs, `assertTask5CandidateClean` (`scripts/memory-bench/task5-comparison.mjs:251`) refuses uncommitted changes under `packages/`, `src/` and `scripts/`, which blocks plan 207 in this checkout. The run has also needed 14 gates and orphaned 6.7M free tokens.
        - **Why a lighter test answers the development question.** The decision rule is the candidate-gap halving (`task5ComparisonCriteria().candidateGap`, `task5-comparison.mjs:93–113`). It needs no judge and targets a large effect. The ability guard (`abilityGuard`, `:116–124`) uses a 3-point margin on strata of 4–12 questions, where one question moves the stratum by 8–25 points; its own `multiplicity` field already calls the strata underpowered. Plan 207 Task 4 rewrites fabric recall, read and cues, so a full-scale verdict on this candidate would be stale before release. Plan 210 Task 5 (ablation) and Task 9 (held-out acceptance on the frozen product) measure the final product.
        - **What this disposition is not.** It does not relabel a partial screen as the full target, and Task 5.5's sentence "a partial/exploratory screen cannot establish the full target" still holds. The Task 5 result becomes a **development-screen verdict** on the reduced cohort. The full target (every applicable suite, the ability veto) moves to plan 210, so it is postponed, not dropped. No published claim depends on Task 5; claims are plan 210 Task 10's.
      - Acceptance Criteria:
        - Functional: **Reduced cohort.** Both arms run on the same frozen question ids:
          - `beam-100k`: all 40;
          - `locomo`: all 60;
          - `memoryagentbench-cr`: all 20;
          - `beam-1m`: a slice selected by a fixed rule on cohort ids only. Take the cohort's `beam-1m` conversations in descending order of cohort-question count, breaking ties by ascending numeric conversation id, until at least 12 questions are covered. On the gate-14 cohort that is conversations 10, 12, 15 and 25, giving 14 questions and 4 conversations to ingest.
          - `longmemeval-m` is out of the screen (plan 210 hand-off).
          The selection is a pure function of the frozen cohort. No result field, report or journal is an input, and the gate-11 reports are not read when choosing it.
        - Functional: **Verdict rules.** The candidate-gap rule set is unchanged: numerator, denominator, evidence source, failure and missingness handling, zero-gap baseline, halving, per-suite rows and the uncertainty protocol. It is the screen's gate, and every reduced-cohort suite that has a mapped needed round is an applicable row. The ability guard keeps its metric, margin, uncertainty and multiplicity text but changes role from veto to `descriptive`: it is reported per suite × ability with paired CIs and does not block closure. The rule as a veto moves to plan 210. The criteria version becomes `202-task5-candidate-gap-v1-screen`.
        - Functional: **Unchanged:** product pins (control `ad25add4…` reproducing `57aa47d9…`, candidate `26bf9013…`), answer model, judges and judge protocol, per-cell budgets, attempts, concurrency 1, free-only enforcement (`assertTask5OwnerGate`), held-out guard and zero historical reuse.
        - Functional: **Gate-11 reports are not reused.** The four `run-202-task5.*` reports produced under gate 11 (both `beam-100k` cells, control `locomo`, candidate `locomo` failed at 55/60) were made by the same product hashes under an older harness. They are archived under `gates/` as superseded evidence, and every screen cell runs fresh under the new gate. Reuse would save about one quota day. It was declined because their gap numbers would have been visible before the scope was fixed.
        - Functional: **Owner gate 15** records this disposition text verbatim and binds the new manifest hash, the criteria version and a new journal identity. Gates 5–14 and the gate-14 journal (`campaign-e3d8ac7d031a`) stay archived unedited. The full ten-cell manifest stays on disk as the record of what plan 210 inherits.
        - Performance: Expected question runs fall from 420 to 268. Expected physical calls are about 1,460–1,675 at the measured 3.2–4 solver and 2.25 judge calls per question, recomputed by the existing estimator: 2 quota days rather than 3+. The bigger saving is wall time, about 28 h per role (`beam-1m` slice capped at 12 h) instead of 208 h. The halt-and-resume path from Task 5.4.3 is unchanged.
        - Code Quality: A scope reduction is not a re-freeze. `assertTask5RefreezeDiff` (`task5-comparison.mjs:944`) correctly refuses cohort and criteria movement and stays as it is. Add `assertTask5ScopeReduction(full, screen)` next to it. It allows only:
          - removing whole suites' cells;
          - subsetting `beam-1m` to exactly the rule's ids;
          - the `abilityGuard.role` / criteria `version` change and the hashes derived from them (`criteriaHash`, `evidenceProtocol.criteriaHash`, `evidenceProtocolHash`);
          - recomputed budgets, wall caps, estimates and pins.
          Everything else must be byte-identical to the gate-14 manifest. The screen manifest is built from the full one, never by hand.
        - Security: No held-out access. The disposition is recorded before Task 5.5 runs or any gate-11 outcome is read. Private traces stay under `.cache/memory-bench/task5/`, and keys are refs only.
      - Approach:
        - Documentation Reviewed: `scripts/memory-bench/task5-comparison.mjs:93–134` (criteria), `:367–420` (manifest builder), `:899–953` (re-freeze allow-list and guard), `:1020` (`assertTask5OwnerGate`), `:1141` (`writeTask5OwnerGate`); `scripts/memory-bench/task5-execute.mjs:172–191` (`buildTask5CampaignManifest` and the smoke job filter); `docs/_evidence/memory-bench/202/task5/development-comparison-manifest.{json,md}` (gate-14 cohort; `beam-1m` has 40 questions over 24 conversations, `longmemeval-m` 50 questions, each with its own haystack); plan 210 Tasks 1, 5 and 9.
        - Options Considered:
          - Keep the full ten cells (rejected: days of quota, about 208 h of wall time per role and a frozen checkout, for an ability veto that cannot resolve its own margin, on a candidate plan 207 replaces).
          - Drop both beyond-context suites (rejected: the lever exists for the beyond-context case and enrichment write cost grows with store size; a scale failure would surface only in plan 210).
          - Keep `longmemeval-m` with a few questions (rejected: each question carries its own ~500-session haystack, so per-question ingest dominates and a slice saves little time).
          - Drop the judges and score only surfacing (rejected: the descriptive ability rows are what plan 207 reads to see whether enrichment hurts any ability; the judges cost about 40% of calls and no wall-time cap).
          - Reuse the gate-11 reports (declined; see Functional).
        - Chosen Approach: the reduced cohort above, derived mechanically from the frozen manifest under a dedicated scope-reduction guard, with a new gate and journal.
        - API Notes and Examples:
          ```sh
          timeout 120 bun scripts/memory-bench/task5-comparison.mjs --manifest --screen   # --screen is new in this task
          timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --subtask 5.4.6 \
            --text "<disposition text, verbatim>" --approved-at 2026-11-01 --supersedes <gate-14 record>
          timeout 600 bun scripts/memory-bench/campaign.mjs --task5   # resumable; halts quota-daily
          ```
        - Files to Create/Edit:
          - `scripts/memory-bench/task5-comparison.mjs`: screen selection rule, `assertTask5ScopeReduction`, criteria `role`/`version`, `--screen` manifest path and markdown;
          - `scripts/memory-bench/task5-execute.mjs`: campaign manifest reads the screen manifest; preflight asserts the reduction against the archived full manifest;
          - `scripts/memory-bench/task5-comparison.test.mjs`, `task5-execute.test.mjs`: the tests below;
          - `scripts/memory-bench/README.md`: Task 5 section states the screen scope;
          - `docs/_evidence/memory-bench/202/task5/{development-comparison-manifest.json (the unchanged full manifest), development-screen-manifest.{json,md}, owner-gate.{json,md}, gates/*, README.md}`;
          - this plan (Tasks 5.4, 5.5, 5.7 amendment notes) and plan 210 Tasks 1, 5 and 9 (hand-off; written with this disposition).
        - References: Task 5.2 (frozen rules), Task 5.4.3 (estimate, halt and resume), Task 5.4.4 (re-freeze discipline), plan 210 Task 5 and Task 9.
      - Test Cases to Write:
        - `task5_screen_selects_beam1m_slice_from_cohort_ids_only`: the slice is 10, 12, 15, 25 (14 questions) on the gate-14 cohort. It fails if the rule changes, if a tie breaks differently, or if a report or journal is passed as input.
        - `task5_scope_reduction_refuses_any_other_drift`: changing a model, judge, margin, halving factor, product hash, budget per cell or a kept suite's ids is refused; removing a suite or applying the rule's slice is allowed.
        - `task5_screen_ability_guard_is_descriptive_not_a_veto`: a stratum below −0.03 is reported and does not fail the screen verdict; an unverified stratum is reported as unverified.
        - `task5_screen_gate_refuses_gate11_report_reuse`: a gate-11 report in the screen journal is refused.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: no — benchmark harness and evidence only.
        - Docs pages to create/edit: `scripts/memory-bench/README.md` (Task 5 scope); `docs/_evidence/memory-bench/202/task5/README.md` (disposition, screen manifest, gate 15).
        - `docs/index.md` update: no
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Status at disposition (2026-11-01): `.cache/memory-bench/task5/` does not exist. `.cache/memory-bench/` was recreated at 02:54 with only `answers/` and `judge/`, so the gate-14 journal, its checkpoints and the control worktree are gone, and the 2026-11-01 leg never started. No gate-14 cell completed, so no counted work is lost by this re-scope. Preflight rebuilds the control worktree as usual.
      - **Execution (2026-11-01).** Implemented in `scripts/memory-bench/task5-comparison.mjs`, `task5-execute.mjs` and `campaign.mjs`, with `task5-screen.test.mjs` (5 pass / 0 fail):
        - `task5Beam1mSlice` selects the slice from cohort ids only (conversations 10, 12, 15, 25 = 14 questions on the gate-14 cohort; a tie breaks by ascending numeric conversation id; a report or journal object is refused);
        - `reduceTask5Manifest` derives the screen from the full manifest and recomputes only the criteria version/role, hashes, cohort, budgets, wall caps, estimates, pins and journal identity; `assertTask5ScopeReduction` refuses any other drift and refuses a hand-written screen, since the only accepted manifest is the exact reduction;
        - the screen criteria are `202-task5-candidate-gap-v1-screen` with `abilityGuard.role: "descriptive"`; the halving rule, margin, uncertainty, multiplicity, zero-gap and missingness text are byte-identical, so the full target's veto is not relabelled;
        - `--manifest --screen` writes `development-screen-manifest.json` (+ markdown); `--repin` re-stamps the harness and candidate revision at an execution re-freeze; `campaign.mjs --manifest --task5 --screen` has the same path;
        - execution reads the screen as the plan of record (`TASK5_ACTIVE_MANIFEST`), preflight and campaign build re-assert the reduction against the full manifest, and `assertTask5ScreenJournalFresh` refuses a journal or attempt from a superseded gate, so gate-11 reports are never reused;
        - `--gate` binds the criteria version and the screen path; the supersedes record applies the scope-reduction guard (not the re-freeze guard) and groups the changes.
      - **Recorded evidence.** `development-screen-manifest.json` `manifestHash 0dea417b…`, criteria `faa72035…`, journal `ecb83564…`, 8 cells / 4 pairs / 134 questions (268 question runs), reservations 53M tokens, expected physical calls 1,461–1,675, wall 56 h (28 h per role). Gate 15 (`owner-gate.json`/`.md`) records the owner text verbatim, supersedes gate 14, and names the screen; gate 14 and its manifest stay unedited under `gates/`. Expected effect matches the plan: 420 → 268 question runs, 2,289–2,625 → 1,461–1,675 calls, 208 h → 28 h per role.
      - **File-list deviations, stated.** (a) The full ten-cell manifest stays at its gate-14 path `development-comparison-manifest.json` instead of a byte-identical `development-comparison-manifest-full.json` copy: gate 14 and plan 210 both reference that path, and a copy could diverge. Plan 210 Task 5 was updated to name the same path. (b) The tests live in a new `scripts/memory-bench/task5-screen.test.mjs` rather than `task5-comparison.test.mjs`: that file builds the full manifest at module top, so it refuses to run while the concurrent plans' executable paths are dirty; the screen tests need only the archived full manifest. There is no `task5-execute.test.mjs` to add to.
      - **Execution re-freeze is explicit, not silent.** Gate 15 authorizes the scope against the gate-14 pins. The screen machinery is harness code, so the bytes that run are the current harness: before the first screen cell, `task5-comparison.mjs --manifest --screen --repin` then the next `--gate --supersedes development-screen-manifest.json` are required, and preflight still refuses a dirty tree, a moved product or a moved harness. This is the 5.4.4 discipline applied at the moment the run needs it, not a second scope decision.
      - **Verification.** `bun test scripts/memory-bench/task5-screen.test.mjs` 5 pass / 0 fail; `bunx biome check` on the changed files clean apart from one inherited unused-parameter warning in `task5OwnerGateMarkdown`. No provider, answer, judge or embedding call and no held-out access. `task5-comparison.test.mjs` cannot build its top-level full manifest in this checkout because concurrent plans 203–214 leave executable paths dirty (pre-existing; the full-manifest tests were green before that dirt and the builder refuses it by design).
      - **Hand-off.** Plan 210 Task 1 (ledger rows cite the screen verdict as screened-only, `deferredFrom: "202-task5.4.6"`), Task 5 (deferred arms: `longmemeval-m`, the full `beam-1m` cohort and the ability veto) and Task 9 (suite coverage) were drafted with this disposition. Task 5.4 stays unchecked until its screen cells complete; Task 5.5 computes the screen verdict as amended; Task 5.7 closes on it.
    - [ ] Task 5.5: Compute the predeclared candidate-gap and ability verdict
      - **Amended 2026-11-01 by Task 5.4.6.** Compute the verdict on the screen manifest's cohort. The candidate-gap rows are the gate; the ability rows are descriptive. The output is labelled a **development-screen verdict** (`pass`, `miss` or `inconclusive` per suite), never the full Task 5 target. `task5_verdict_refuses_ability_regression_or_missing_evidence` becomes `task5_screen_reports_ability_regression_and_missing_evidence_without_veto`; the other Task 5.5 tests are unchanged.
      - Acceptance Criteria:
        - Functional: For each applicable suite, compare the proportion of questions with a needed round never surfaced in any tool result; require at least a 50% reduction against revision 1 wherever the baseline has that gap. Apply the Task 5.2 frozen ability non-regression rule; include failures, missingness and paired uncertainty. Report pass, miss or inconclusive with the responsible rows named; a partial/exploratory screen cannot establish the full target.
        - Performance: Offline aggregation of recorded results; no additional answer/judge calls or unfrozen extensions of the sample.
        - Code Quality: Derive verdicts mechanically from pinned reports and criteria; retain the original rules, including zero-gap baseline handling, rather than modifying them after results.
        - Security: Publish aggregate/identifier evidence only; retain held-out separation.
      - Approach / Files: Reuse `scripts/memory-bench/{baseline,retrieval-diagnostics,stats}.mjs`; write the paired results and criterion-by-criterion verdict to the Task 5 evidence directory with source hashes.
      - Tests / checks: `task5_verdict_requires_halved_gap_in_every_applicable_suite`; `task5_verdict_refuses_ability_regression_or_missing_evidence`; `task5_unknown_is_not_zero`; assert output matches the frozen criteria.
      - Documentation/Wiki Assessment: Evidence/verdict only; update evidence README and Task 5 notes. Public API: no; `docs/index.md`: no.
    - [ ] Task 5.6: Validate Task 5 against real PostgreSQL and refresh durable-store evidence
      - Acceptance Criteria:
        - Functional: Run the PostgreSQL memory integration suites against an isolated test database with the extensions their fixtures require. Prove archive session/keyword persistence, lexical category retrieval and unmatched-term feedback, same-session neighbour reads, zero-based session paging in reference-time order, and the current metadata-scan fallback with its status warning. Verify state after closing/reopening the database connection. Missing URL/extensions, skipped cases, empty imports or stale evidence cannot count as passes.
        - Functional: Pass the shared memory conformance, correction/deletion/hold propagation and transaction rollback tests on PostgreSQL. Separately run the existing broader `test:postgres` service/conformance legs, refresh release evidence, and rerun the release gate. Record each surface's real verdict; unrelated release blockers remain named rather than waived. Task 5.7 depends on this subtask's PostgreSQL memory checks passing; any broader release blocker is tracked explicitly in closure notes.
        - Performance: Use bounded shell timeouts and the existing pool limits; record navigation fallback latency and scan/query counts on a declared fixture size. The current fallback may scan the resource; disclose that cost without claiming SQLite's indexed performance or introducing a new PostgreSQL index/service unless a demonstrated defect requires a separately scoped change. This validation makes no paid answer/judge or embedding-model calls.
        - Code Quality: Reuse existing PostgreSQL fixtures, unique temporary schemas and shared memory conformance. Write Task-5-specific regression cases before fixing any defect found; preserve the SQLite path and optional store-method contract. Pin source hashes, git HEAD, database/extension versions, test counts and commands in the evidence; regenerate compat baselines only if a required fix changes the public surface.
        - Security: Read the test connection from `PRISM_TEST_POSTGRES_URL` without printing its value or placing it in argv/reports. Use a disposable test database and per-run schemas with cleanup in `finally`; never reset a shared/production database. Test cross-tenant, cross-resource and cross-thread isolation, revoked consent, legal holds, tombstones and configured redaction through navigation as well as recall/read.
      - Approach / References: `packages/memory/fabric/src/__tests__/postgres-{memory,vector,propagation}.integration.test.ts`; `packages/memory/core/src/postgres/index.ts` metadata scan; `packages/memory/fabric/src/create.ts` navigation fallback; `scripts/postgres-evidence.mjs`; `scripts/release-skip-manifest.mjs`. The root `test:postgres:run` currently covers session-store/channels/phase-conformance legs, so run the memory integration suite explicitly as well; the broader command alone does not establish Task 5 memory coverage. Reuse an existing local test-service setup where available; no new dependency or hosted service is required by this plan.
      - Files to Create/Edit: PostgreSQL memory integration tests and a Task-5 navigation integration fixture (tentative new file under `packages/memory/fabric/src/__tests__/` if the existing fixture cannot be reused); owning memory package implementation only for proven defects; `docs/_evidence/memory-bench/202/task5/postgres-validation.{json,md}`; generated `scripts/{postgres-evidence,release-evidence}.json`; this task's execution notes. Package/benchmark README and `CHANGELOG.md` only if a fix changes documented behavior.
      - Test Cases to Write First: `postgres_exchange_session_and_keywords_survive_reopen`; `postgres_lexical_enrichment_and_unmatched_terms`; `postgres_read_around_and_session_pages_match_sqlite`; `postgres_navigation_scan_emits_status_and_honours_abort`; `postgres_navigation_enforces_scope_consent_holds_deletion_and_redaction`. Include enough metadata rows to cross the scan's 200-row cursor boundary and reject a foreign-thread row with the same session identifier. Require the actual PostgreSQL path, not an in-memory substitute or a silently unavailable extension.
      - Commands / checks (execute only after safe test-database setup; credentials stay in the environment):
        - `timeout 900 bun test --timeout=0 packages/memory/fabric/src/__tests__/postgres-memory.integration.test.ts packages/memory/fabric/src/__tests__/postgres-vector.integration.test.ts packages/memory/fabric/src/__tests__/postgres-propagation.integration.test.ts` plus the Task-5-specific integration fixture if separate.
        - `timeout 1800 bun run test:postgres`; `timeout 300 bun run release:evidence`; `timeout 1800 bun scripts/release.mjs gate`.
        - For any implementation/test changes: affected SQLite/core/fabric suites, `timeout 1200 bun run typecheck`, `timeout 300 bunx biome check <changed files>`, and `timeout 15 git diff --check`. Record skips and failures separately from passing tests; restore/clean only the validation run's own fixtures.
      - Documentation/Wiki Assessment: Validation/evidence only unless a defect requires a behavior change; update the Task 5 evidence README and execution notes. No new public API or `docs/index.md` entry is planned; follow `.agents/skills/create-plan/references/prism-wiki.md` for any required package documentation changes.
    - [ ] Task 5.7: Record the closure decision and verification scope
      - **Amended 2026-11-01 by Task 5.4.6.** Task 5 closes on the development-screen verdict under the owner disposition, which is the "explicit owner-approved disposition" this task already allows. The closure note links the disposition, the screen and full manifests, gate 15 and the plan 210 hand-off rows (Task 1 ledger row, Task 5 deferred arms, Task 9 suite coverage). A screen `miss` still blocks closure under the lever rules; a screen `pass` closes Task 5 without claiming the full target.
      - Acceptance Criteria:
        - Functional: Mark Task 5 complete only when its implementation checks, Task 5.6 PostgreSQL memory validation and full measured target pass, linking the manifest, gate, reports and verdict. A miss/inconclusive result stays open or receives an explicit owner-approved disposition under the plan's lever/remediation rules; never relabel it as a passing improvement. Identify any follow-up before moving to later levers.
        - Performance: Retain the enrichment timing result and approved run's cost/latency evidence; no new paid work in this documentation step.
        - Code Quality: Record affected test/typecheck results, compatibility baseline attribution and remaining release-level checks. SQLite validation and PostgreSQL release validation must have distinct statuses; a release-gate preflight refusal is not a Task 5 quality verdict.
        - Security: Preserve all scope/consent/redaction assurances and keep credentials/private benchmark content out of closure notes.
      - Approach / Files: Update this task, `docs/_evidence/memory-bench/202/task5/README.md`, and existing package/benchmark docs or `CHANGELOG.md` only if the final disposition changes their claims. No version bump, publication, default change or host wiring.
      - Tests / checks: `timeout 1200 bun run typecheck`; affected memory-core/fabric and memory-bench suites; `timeout 300 bunx biome check <changed files>`; `timeout 15 git diff --check`. Record `bun scripts/release.mjs gate` separately, including any PostgreSQL evidence blocker, without claiming that blocked checks ran.
      - Documentation/Wiki Assessment: Task/evidence status plus final claims assessment; no new product API; `docs/index.md`: no.
  - Database-validation scope (clarified 2026-10-30): SQLite is used directly and as the markdown store's derived index. The latest focused SQLite/navigation run passed 20 tests with zero failures, in addition to the recorded full memory-core/fabric runs. PostgreSQL is an optional alternative backend; its missing service/evidence blocks the broader release gate and left 23 memory integration tests skipped. It is not needed to execute the local SQLite/markdown Task 5 development comparison. Owner addition (2026-10-30): Task 5.6 now explicitly validates PostgreSQL memory behavior before Task 5.7 closes the task, alongside the separately reported broader release checks. This does not establish the measured recall target.
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
    - Performance: Enrichment costs ≤ 2 ms per exchange (measured) with no model or embedding call. `around` and `session` reads are index lookups by session id and `tRef`. **Firmed by Task 1 (f) re-scope 1 (2026-10-27):** no exchange note field stores its session (the id is a hash of `sessionId + entries + part`, `exchanges.ts:102`; only `generated.session`, `sourceEntryIds` and `tRef` identify it) and `scanMetadata` pages the whole resource, so reads would scan O(n). Add `session` as an additive `v: 1` field at archive time — safe now that 188.11 Task 4 preserves unknown keys — plus an optional `listBySession?` store method with a status-emitting fallback scan (188.11 Task 4's rule).
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
    - Functional: **Cache-stable delivery (Task 4.12, added 2026-10-30).**
      - Superseding or retiring a decision is a retraction: the superseded decision leaves the pinned core on the very next request, not at the next epoch.
      - A decision confirmed mid-session reaches the agent through path cues and recall in that session, and through the core from the next epoch.
      - The ≤ 2% superseded-decision criterion is measured with this behavior.
      - Coding screens report extractor cache reads under `product-extract` when capture uses the extractor.
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
    - Code Quality (amended 2026-10-31): capture, confirmation and rule delivery are written as one preset-neutral module, `delivery/rules.ts`, that `coding` consumes. Plan 209 Task 3 generalizes it to preferences and procedures in every preset (`rules.capture`), makes the per-scope `core.md` an editable `rules.md`, and gives standing rules a fixed budget. Nothing in this task may make capture coding-only in a way plan 209 would have to undo.
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
    - Functional: **Three-tier note (2026-10-31).** Plan 207 later adds a `subject` binding on notes. If this task executed, plan 207 Task 3 reuses `same-subject` as the relation between notes bound to the same subject, and keeps the enrichment-key rule only for unbound notes, so there is one relation and not two. If this task is closed, plan 207 adds no `same-subject` link: concept citations are the association.
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
      - (c) **deletion cascade**: after `memory.forget` or the host's delete path, the content is absent from note files, the derived index, derived facts, links, the core block and `memory:export`, and is never recalled. **Since 2026-10-31 this includes concept notes:** plan 208 Task 4 adds the ontology probes (cascade through concepts, cross-scope concept exposure, concept poisoning, team and human-edited concepts) to this suite. A failing ontology probe blocks only the ontology tier's default (plan 208 O4), not this task's verdict for presets without it;
      - (d) **false refusal**: 188.11 Task 8's audit, re-run on the new suites;
      - (e) **PII retention**: a fixture of emails, phone numbers and addresses; what the redactor and trust scan do. A PII redactor option is added only if hosts have no way to pass one (the kernel `SecretRedactor` seam exists).
    - Functional: **Starting state from 188.11 Task 8 (2026-10-27), to close here, not re-measure as new.** LongMemEval-S: 225/99,090 exchanges refused = 2.271 per 1,000 (32 injection, 10 exfiltration, 183 invisible Unicode, 0 secret) and 3 of 500 questions lose a needed-session exchange; LoCoMo 0 refused. Adversarial fixture detection 33/34, with `exfil-06` (`curl -s https://…`) undetected because the scan's `curl\s+https?://` misses the flag. The invisible-Unicode class dominates the false-refusal rate. Meeting (d)'s ≤ 1 per 1,000 and 0 needed sessions is therefore real work in this task (classify or normalise benign invisible Unicode without weakening detection), and the `exfil-06` miss is a regression test to add. Evidence: `docs/_evidence/memory-bench/188.11/{trust-scan.json,README.md}`.
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
    - Code Quality: Capacity changes in `lifecycle/{capacity,maintain}.ts`. **Corrected 2026-10-27 (Task 1 re-review):** the `API Notes` example below, `capacity: { exchange: { hotTokens } }`, does not fit today's shape — `lifecycle.capacity` is keyed by scope level (`user | agent | project`, `fabric/src/config.ts:199,239,286,375–400`) and each value is `{ notes, tokens }`; the resolver does `capacity[level]!`. The exchange tier therefore needs a shape decision before editing: either a new top-level `lifecycle.exchangeCapacity: { hotTokens }`-style additive field (preferred — no collision with scope keys, additive under 188.11 Task 6), or widening `capacity` to a second dimension with a schema/type change. Either way it must stay additive and optional, and the example in `API Notes` is corrected before the task starts.
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
    - Functional: **Role set by the owner (amended 2026-10-31).** OM is tier T0 of the three-tier memory (plan 207): it observes the session and documents facts, procedures and insights into the fabric through the existing `promote: { observational: true }` path, as candidates that earn trust by use. Its in-session compression role stays.
      - This task measures OM in that role. It compares the OM+fabric arm with the fabric alone on development partitions: notes promoted per session, the share verified by later use, and accuracy with and without promotion.
      - It documents the result in both READMEs.
      - If promotion lowers accuracy or fails plan 202's safety probes, the README states that, and the reference host keeps promotion off. The role itself does not change.
      - The earlier alternatives ("in-session compression only", "a standalone conversational memory") are dropped by the owner decision.
      The reference host's OM wiring follows the measurement, with its scenarios green.
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
    - Functional: **Three-tier note (2026-10-31).** The ontology tier (plan 207) does not depend on this task: its curator cites whatever T1 holds (exchanges, decisions, OM promotions, files). Facts, if this task ships them, become one more citable input. The condition for executing this task is unchanged.
    - Functional: **Cache-stable product (Tasks 4.11–4.15, added 2026-10-30).** Every development screen of the extractor reports extractor `cacheReadTokens` and `cacheWriteTokens` under the `product-extract` role. The write-side cost per session is stated both with and without those cache reads.
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

# Execute 207 and 208 before the next tasks

- Task 18 and Task 19: **moved to plan 210 on 2026-10-31** (owner decision: run 202, 207, 208, 209 and 210 one after another). The held-out acceptance is plan 210 Task 9 and the preset revision, defaults and published claim are plan 210 Task 10, both on the product plan 210's audit leaves. Their acceptance criteria, tests and docs assessments moved with them unchanged in substance.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 300 bun test packages/memory/fabric/src/__tests__/prefix-stability.test.ts` (Tasks 4.12–4.14)
- `timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/202/cache-stability/offline-final.json` (every scenario: one prefix hash per epoch; only the retraction scenarios break)
- `timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base <pre-4.12-worktree>` (Task 4.15 attestation)
- `timeout 180 bun scripts/memory-bench/run.mjs --offline`
- `timeout 1800 bun scripts/decision-bench.mjs --fixtures scripts/fixtures/decision-bench-memory.jsonl --models liquid-local/d1-3B@Q4_K_M,liquid-local/d1-3B@Q8_0` (local, free; the hosted rows need their keys)
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline`
- `timeout 900 bun examples/long-term-memory.ts`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 300 bunx biome check <changed files>`
- `timeout 1800 bun scripts/release.mjs gate` (memory baseline diffs attributed per task)
- Paid, in order, each after its owner gate. Tasks 4.11–4.15 and a passing readiness cache-stability pin come first:
  1. Task 4 baseline;
  2. the development screens of the executed lever tasks, each with one live cache probe on its answer route (≤ 12 requests);
  3. confirm no owned paid process remains.
- The held-out acceptance and `acceptance-report.mjs --plan 202` run in plan 210 Task 9.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
