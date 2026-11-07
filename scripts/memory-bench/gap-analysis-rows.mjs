/**
 * Plan 210 Task 3: the conceptual gap analysis, one row per Task 1 candidate (first pass).
 *
 * Hand-maintained. `gap-analysis.mjs` renders `docs/_evidence/memory-bench/210/gap-analysis.md` and the
 * machine-readable `gap-predictions.json` from these rows; Task 5 scores the predictions. Rows carry ids,
 * counts and short statements only, never note, question or answer text.
 *
 * `why` vocabulary (plan 210 Task 3, plus two classes added at execution and recorded in the plan note):
 *   suites-cannot-exercise | dominated | trigger-too-rare | effect-too-small | premise-wrong
 *   measured-while-broken  (the only measurement ran on a mechanism Task 2 found broken)
 *   never-measured         (no arm ever ran it; used only where none of the five explains the absence)
 * `verdict`: fix-and-measure | measure-elsewhere | no-credible-path.
 * A fix-and-measure row with `change: "as-is …"` is a plain leave-one-out or add-one with a pre-stated
 * prediction; Task 5 runs it without a code change.
 */

export const WHY = Object.freeze([
  "suites-cannot-exercise",
  "dominated",
  "trigger-too-rare",
  "effect-too-small",
  "premise-wrong",
  "measured-while-broken",
  "never-measured",
]);
export const VERDICTS = Object.freeze(["fix-and-measure", "measure-elsewhere", "no-credible-path"]);
export const DEFERRED_VERDICTS = Object.freeze(["unmeasured", "not-needed", "fix-and-measure"]);

/** Development suites a prediction may name; `offline:` measurements are free and need no partition. */
export const DEV_SUITES = Object.freeze([
  "longmemeval-m",
  "locomo",
  "beam-100k",
  "beam-1m",
  "memoryagentbench-cr",
  "memorycode",
  "coding-longitudinal",
  "work-outcome-assistant",
  "work-outcome-coding",
  "ontology-o-rows",
]);

const fm = (change, metric, suite, predicted, arm) => ({ verdict: "fix-and-measure", change, metric, suite, predicted, arm });
const me = (change, metric, suite, predicted) => ({ verdict: "measure-elsewhere", change, metric, suite, predicted });
const ncp = (removal) => ({ verdict: "no-credible-path", removal });

const EXTRACTION_GATE =
  "Decided by the F4 diagnostic leg (deferred lever 202-task17); if it returns not-needed or stays unmeasured, this row becomes a Task 6 removal candidate with the extraction group.";

export const ROWS = Object.freeze([
  // ── Retrieval and ranking ─────────────────────────────────────────────────────────────────────
  {
    id: "retrieval.lexical",
    why: "suites-cannot-exercise",
    intended: "Find stored exchanges and notes for a query with no embeddings (owner decision 2026-10-24: memory is not RAG).",
    source: "plan 188.1 (lexical fabric); BM25",
    evidence:
      "It is the only retrieval leg any preset uses, so the only ablation is memory-off. 188.7 compares it with full context (a substitution, -0.27), not with no memory; 188.11 records an 11/30 candidate ceiling.",
    gap: "Nothing to fix in the leg itself: its known ceiling is what recall.expansion and recall.gather target. Its benefit is the memory row itself.",
    ...fm(
      "as-is: memory-off arm against the conversational preset",
      "correct answers",
      "locomo/dev + longmemeval-m/dev",
      "preset >= memory-off + 15 points on each suite (LoCoMo recall 38/60 today; memory-off can answer only adversarial items)",
      "memory-off",
    ),
  },
  {
    id: "retrieval.hybrid",
    why: "premise-wrong",
    intended: "Add an embeddings leg fused by RRF for paraphrase recall.",
    source: "plan 188.11 (kept for compatibility only)",
    evidence: "No development arm ever ran it; the owner decided 2026-10-24 that memory is not RAG and uses no embeddings.",
    gap: "A credible benefit needs embeddings, which the owner ruled out. Paraphrase misses are addressed lexically by recall.expansion.",
    ...ncp(
      'Remove `retrieval: "hybrid"` and the per-write embedding path from memory-fabric. The compatibility role is an owner call in Task 6; the experimental line (plan 215) carries no compatibility obligation.',
    ),
  },
  {
    id: "retrieval.scope-priors",
    why: "suites-cannot-exercise",
    intended: "Prefer the narrower scope (path > project > team > agent > user) when hits tie after fusion.",
    source: "plan 188.2 scope model",
    evidence: "Every benchmark ingests into one scope, so priors never reorder a hit there. The mechanism works (Task 2).",
    gap: "Its benefit needs two scopes holding competing notes, which only a multi-scope fixture has.",
    ...me(
      "offline multi-scope ranking fixture built from the coding lifecycle persona: same-topic notes in project and user scope, priors on vs all priors 0",
      "share of queries whose top hit is the scope the persona expects",
      "offline:coding-lifecycle-persona",
      "priors on raise the scope-correct top-1 share by >= 10 points; if not, remove the priors and keep shadowing for key conflicts",
    ),
  },
  {
    id: "retrieval.strength-priors",
    why: "dominated",
    intended: "Rank recently and repeatedly used notes higher (ACT-R base-level retrieval strength R, storage strength S).",
    source: "Anderson & Schooler 1991; plans 188.4-188.6",
    evidence:
      "Weight 0.05 against lexical scores; only a synthetic retention table exists. Benchmarks ingest without citations, so use-based R and S are flat and only the age term varies. Task 2: the per-turn lifecycle is project-only, so user- and agent-scope notes never build R or S.",
    gap: "At 0.05 the prior is dominated by lexical matches; the age term is a recency prior that could help knowledge-update. Raising its weight is the minimal change; per-scope routing is a separate structural item.",
    ...fm(
      "retrieval prior weight 0.05 -> 0.15",
      "knowledge-update correct answers",
      "longmemeval-m/dev",
      ">= +3 points on knowledge-update with no ability down by more than 2 points; a null result removes R and S as recall priors (archive keeps them)",
      "strength-0.15",
    ),
  },
  {
    id: "retrieval.decay-per-kind",
    why: "suites-cannot-exercise",
    intended: "Let preferences and decisions fade slower than working notes.",
    source: "plan 188.4 retention policy",
    evidence:
      "Eight hand-set rates backed by a provisional synthetic table. Both presets store exchanges only, so one rate is ever used in any arm.",
    gap: "Per-kind rates matter only when several kinds compete; no suite or preset has that, and no study supports the eight values.",
    ...ncp("Collapse the per-kind decay table to one decay rate (the exchange rate, 0.5); drop the per-kind config field."),
  },
  {
    id: "retrieval.similar-links",
    why: "never-measured",
    intended: "Reach notes associated with a hit but not matched by the query (A-MEM style links).",
    source: "A-MEM (Xu et al. 2025); plan 188.3",
    evidence:
      "Links exist only when the linker runs (off by default); 202 Task 13 closed typed-link association without implementation for lack of causal attribution.",
    gap: "Association beyond the query is now served by recall.gather (all matching history) and agentic navigation (around/session). No residual shows a not-in-query miss that links would fix (Task 13 rule: >= 5% shared-entity residual).",
    ...ncp("Remove the `similar` link read path together with the linker (workers.linker)."),
  },
  {
    id: "workers.linker",
    why: "dominated",
    intended: "Write `similar` links on each note write.",
    source: "A-MEM; plan 188.3",
    evidence: "Off by default; never on in a development arm; its read side is unmeasured and Task 13 is closed.",
    gap: "Dominated by recall.gather and navigation for the same association need, at zero write cost.",
    ...ncp("Remove the linker worker, its config (`linker`) and the links it writes."),
  },
  {
    id: "workers.evolution",
    why: "premise-wrong",
    intended: "Let a model patch neighbour notes when a new note arrives, so memory evolves.",
    source: "A-MEM memory evolution",
    evidence:
      "Off by default, never measured; one model call per write. Presets write verbatim exchanges, which must stay unedited evidence.",
    gap: "Rewriting stored evidence conflicts with citation to exchanges and provenance (safety rows); read-time state grouping handles change over time without mutating notes.",
    ...ncp("Remove the evolution worker and its config (`evolution`); `passive` (workers off) becomes the only mode."),
  },
  {
    id: "recall.kind-hints",
    why: "suites-cannot-exercise",
    intended: "Let the agent restrict recall to kinds (facts only, decisions only).",
    source: "plan 188.2 kinds",
    evidence: "Presets store one kind (exchange), so the argument never filters anything in any arm.",
    gap: "Useful only while several typed kinds survive; its fate follows the kind rows.",
    ...me(
      "tool-call trace on the coding work-outcome rows (typed notes present)",
      "share of memory.recall calls that pass `kinds`",
      "work-outcome-coding/dev",
      ">= 5% of recall calls use `kinds`; otherwise drop the argument (and it goes in any case if fewer than two typed kinds survive Task 6)",
    ),
  },
  {
    id: "recall.multi-query",
    why: "dominated",
    intended: "Fuse up to four phrasings in one recall call.",
    source: "plan 188.10 tools arm",
    evidence: "On in every tools arm; never ablated. The agent can issue several calls, and recall.gather now covers 'everything about X'.",
    gap: "Saves a tool turn; any accuracy effect is likely within noise.",
    ...fm(
      "as-is: tool-affordance leave-one-out (queries capped at 1)",
      "correct answers",
      "locomo/dev + beam-100k/dev",
      "within +-1 of 60 and +-1 of 40 (no benefit); confirmed null removes `queries`",
      "tool-affordances-loo",
    ),
  },
  {
    id: "recall.unmatched-terms",
    why: "effect-too-small",
    intended: "Tell the agent which query terms matched nothing, so it can rephrase.",
    source: "plan 188.10",
    evidence: "Always on in recall output; never ablated; zero cost.",
    gap: "The rephrase it invites is the same miss recall.expansion fixes automatically; with expansion on, the hint may carry no extra signal.",
    ...fm(
      "as-is: tool-affordance leave-one-out (field omitted)",
      "never-candidate wrong answers",
      "locomo/dev + beam-100k/dev",
      "no change in never-candidate wrong answers (within +-1); confirmed null removes the field",
      "tool-affordances-loo",
    ),
  },
  {
    id: "recall.supersession-hint",
    why: "effect-too-small",
    intended: "Mark an older hit as superseded by a newer one in the same group.",
    source: "plan 202 Task 7 (state grouping)",
    evidence:
      "Stripping the label moved LoCoMo 38 -> 39 of 60 (inside noise); the label covers 27-43% of injected LoCoMo hits, mostly similarity-only groups (208 investigation).",
    gap: "The label is right for keyed updates and wrong for exchanges joined only by shared subject terms. Task 3.1 built `keyed-only`.",
    ...fm(
      'recall.supersessionHint: "keyed-only"',
      "correct answers",
      "locomo/dev",
      "within +-1 of 60 (measured +1 of 60 when the label was stripped); a null result removes the label for similarity-only groups",
      "supersession-keyed-only",
    ),
  },
  {
    id: "recall.expansion",
    why: "never-measured",
    intended: "Match informal forms and abbreviations (gf -> girlfriend) without embeddings.",
    source: "plan 210 Task 3.1 from the 208 accuracy investigation (2 never-candidate LoCoMo misses)",
    evidence: "Opt-in, built in Task 3.1; Task 2 found and fixed its coverage scale (it abstained before).",
    gap: "Built; not yet measured.",
    ...fm(
      "recall.expansion: true",
      "never-candidate wrong answers",
      "locomo/dev",
      "4 -> <= 2 of 60, no loss on memoryagentbench-cr or beam-100k",
      "expansion",
    ),
  },
  {
    id: "recall.gather",
    why: "never-measured",
    intended: "Return every matching exchange in time order for list and multi-hop questions.",
    source: "plan 210 Task 3.1 (LoCoMo multi-hop 3/12; BEAM event ordering and summarization 0/4)",
    evidence: "Opt-in, built in Task 3.1; the probe shows 8 hits past the seven-hit page.",
    gap: "Built; not yet measured. It is also the read-time control the F4 diagnostic needs.",
    ...fm(
      "recall.gather: true",
      "multi-hop gold evidence rounds recalled; multi-hop correct answers",
      "locomo/dev",
      "multi-hop gold evidence rounds recalled up by >= 1 per question and multi-hop correct 3 -> 4 of 12 (the oracle ceiling is 4 of 12, so the Task 3.1 figure '>= 5' was above it); beam-100k event_ordering and summarization evidence rounds recalled up by >= 1 per question",
      "gather",
    ),
  },

  // ── Write path ─────────────────────────────────────────────────────────────────────────────────
  {
    id: "write.consolidate-default",
    why: "suites-cannot-exercise",
    intended: "Update an existing typed note instead of inserting a near-duplicate (same text, Dice >= 0.85).",
    source: "plan 188.1; Mem0 update-on-write",
    evidence: "Only a synthetic threshold table. Presets archive exchanges, which never consolidate, so no arm exercises it.",
    gap: "Its role is cost and store hygiene for agent-written typed notes; it can be measured offline on a history with explicit writes.",
    ...me(
      "offline replay of the coding lifecycle persona with scripted memory.insert calls, consolidation on vs off",
      "near-duplicate typed notes in the store after the replay",
      "offline:coding-lifecycle-persona",
      "consolidation off leaves >= 20% more near-duplicate typed notes; if not, remove write-time consolidation",
    ),
  },
  {
    id: "write.consolidate-model-decider",
    why: "dominated",
    intended: "Let a model decide replaces / contradicts / refines / unrelated per consolidation candidate.",
    source: "Mem0 LLM update decisions; plan 202 Task 12 point P2",
    evidence:
      "Opt-in, no arm; one model call per typed write with candidates; the extractor family it relies on failed 25 of 51 sessions (F4).",
    gap: "Read-time state grouping already orders same-subject notes newest first at zero cost, and a write-time model decision mutates memory irreversibly. Same mechanism as decisions.P2.",
    ...ncp('Remove `consolidate.decider: "model"` (and decision point P2); Dice consolidation stays the only write-time rule.'),
  },
  {
    id: "write.session-consolidation",
    why: "suites-cannot-exercise",
    intended: "Extract durable typed notes (facts, episodes) from each session.",
    source: "plan 188.1/188.5 (CLS-style consolidation); plan 202 Task 17 / F4",
    evidence:
      "Both presets set promote: false. The measured write side failed in 25 of 51 sessions (1.26 extractor calls, 8,185 input tokens per session). F4 is inconclusive.",
    gap: "Only worth keeping if aggregation or state failures exist that read-time fixes cannot recover; that is exactly the F4 diagnostic.",
    ...me(
      "F4 diagnostic leg under C-1 (see deferred lever 202-task17)",
      "share of development failures attributed to state or aggregation that read-time controls cannot recover",
      "beam-100k/dev + locomo/dev + longmemeval-m/dev",
      `>= 5% in a suite x model keeps it as the Task 17 remedy (repaired, <= 2% failed sessions); otherwise remove. ${EXTRACTION_GATE}`,
    ),
  },
  {
    id: "write.om-promotion",
    why: "effect-too-small",
    intended: "Feed OM observations and reflections into consolidation, so in-session notes become durable.",
    source: "plan 188.6; plan 202 Task 16",
    evidence:
      "om+fabric 0.732 -> 0.732 with promotion off -> on; fabric 0.375 -> 0.393; zero promoted notes later recalled and cited (202 closure: neutral/unjustified).",
    gap: "The Task 17 remedy, if it is built, cites exchanges, not OM records, so promotion has no role left either way.",
    ...ncp(
      "Remove OM promotion (OM as a consolidation source) from memory-fabric and memory-observational; promotion already stays off by default.",
    ),
  },
  {
    id: "write.keyword-enrichment",
    why: "effect-too-small",
    intended: "Add write-time keywords to each exchange so lexical recall finds it from other wordings.",
    source: "plan 202 Task 5",
    evidence:
      "The screen bundled enrichment with navigation and missed halving in every measurable suite with no significant difference; the bundle's navigation half was broken in the product path at the time (Task 2). LongMemEval-M and full BEAM-1M are unmeasured.",
    gap: "Its own effect has never been isolated. It overlaps recall.expansion (query side), which is cheaper to reason about.",
    ...fm(
      "as-is: separate enrichment leave-one-out (plan 202 Task 5.4.6 hand-off)",
      "candidate-gap failures",
      "longmemeval-m/dev + beam-1m/dev",
      "enrichment on cuts candidate-gap failures by >= 25% against enrichment off; a smaller effect (the screen suggests it) removes it, subject to the ability veto",
      "enrichment-loo",
    ),
  },
  {
    id: "write.exchange-steps",
    why: "trigger-too-rare",
    intended: "Archive tool steps with each exchange so the agent can recall how a past task was done.",
    source: "plan 209",
    evidence:
      "Rate 0 in the replays (scripted replies call no tools); only the +W bundle was measured (W1/W2/W6 the right way, no interval clears).",
    gap: "Its effect is only visible in tool-heavy work; it needs isolating from the +W bundle.",
    ...fm(
      "as-is: steps leave-one-out inside +W",
      "W1 corrected-mistake repeat rate",
      "work-outcome-coding/dev",
      "steps off raises W1 by >= 5 points; otherwise remove `exchanges.steps`",
      "w-steps-loo",
    ),
  },
  {
    id: "timeline",
    why: "never-measured",
    intended: "Resolve relative dates at write time and support from/to windows and time order.",
    source: "plan 202 Task 6",
    evidence:
      "fabric-x-tools 18/26 vs full context 6/26 on matched temporal questions (12 wins, 0 losses), but that compares the preset with full context, not timeline on/off. Fires on 10% of replayed turns.",
    gap: "Strong indirect evidence; it lacks its own ablation.",
    ...fm(
      "as-is: timeline leave-one-out (no resolved dates, no windows)",
      "temporal-reasoning correct answers",
      "longmemeval-m/dev + locomo/dev",
      "timeline off loses >= 5 points on longmemeval-m temporal and >= 2 of 12 on locomo temporal",
      "timeline-loo",
    ),
  },
  {
    id: "recall.state-grouping",
    why: "never-measured",
    intended: "Group same-subject hits newest first so the agent sees the current state.",
    source: "plan 202 Task 7",
    evidence: "Functional tests only; Dice floor 0.5 is provisional; StateMemBench was unavailable.",
    gap: "Its effect is on knowledge-update. Grouping keyed notes newest first is sound; grouping exchanges by the provisional Dice 0.5 subject floor is where the doubtful supersession labels come from, so the arm runs with supersessionHint keyed-only.",
    ...fm(
      'as-is: grouping leave-one-out, both arms with supersessionHint "keyed-only"',
      "knowledge-update correct answers",
      "longmemeval-m/dev + beam-100k/dev",
      "grouping off loses >= 3 points on longmemeval-m knowledge-update and >= 1 of 4 on beam-100k knowledge_update",
      "grouping-loo",
    ),
  },
  {
    id: "recall.state-wrapper",
    why: "dominated",
    intended: "Have a model build a current-state table on each explicit recall.",
    source: "plan 202 Task 7 wrapper",
    evidence: "Opt-in, no arm; one model call (<= 2,000 input tokens) per explicit recall.",
    gap: "The answering model already receives the grouped hits newest first; a second model tabulating them duplicates its work at a model call per recall.",
    ...ncp("Remove the `state` wrapper and its config; grouping stays."),
  },
  {
    id: "tools.explicit-writes",
    why: "suites-cannot-exercise",
    intended: "Let the agent store a note when asked to remember something, and correct it later.",
    source: "plan 188.2; every memory agent (MemGPT/Letta, ChatGPT memory)",
    evidence:
      "Benchmarks ingest history through the archive; no arm measures agent-authored notes. Task 2 fixed `replace { pin }` and cross-scope routing.",
    gap: "An agent would build this for itself; its benefit shows where users state durable preferences, which the work-outcome rows have.",
    ...me(
      "tool-removal arm (memory.insert and memory.replace hidden) on the assistant work-outcome rows",
      "W3 re-asked questions",
      "work-outcome-assistant/dev",
      "hiding the write tools raises W3 by >= 10 points",
    ),
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────
  {
    id: "lifecycle.verification",
    why: "trigger-too-rare",
    intended: "Promote a candidate note to verified after independent uses across sessions (a citation is a use).",
    source: "plans 188.4-188.6",
    evidence:
      "Verified share 0 in every offline lifecycle arm; rate 0 in the replays. Both presets leave promotion off, so no note is ever a candidate; uses are project-only (Task 2).",
    gap: "Its only subject is extractor-written candidate notes. Without extraction it has nothing to verify; with the Task 17 remedy it is a safety gate that belongs to that remedy's own tests.",
    ...ncp(
      `Remove use-based verification as a general lifecycle stage. ${EXTRACTION_GATE} If the Task 17 remedy is built, its preset re-specifies verification as part of its safety tests.`,
    ),
  },
  {
    id: "lifecycle.archive-revival",
    why: "premise-wrong",
    intended: "Hide notes that are both rarely used and weak, past a grace window; revive them on a strong match.",
    source: "plans 188.4-188.5; 202 Task 15 growth",
    evidence:
      "Growth stream: month-12/month-1 retrieval 0.5625 -> 0.6875, but both months are measured after archiving: month-1 active retrieval is 0.5625 against 1.0 when the archive is included (68 exchanges archived by age), so the criterion compared two depleted months. maintain.ts:514 applies the strength rule to raw exchanges, and one memory:maintain archived 29 of 293 raw exchanges in the LongMemEval-M replay and 73 of 94 in BEAM-100K: passive delivery records no use, so low R and S on a raw exchange means only 'old'. Benchmark runs never call maintain, so earlier scores describe an unmaintained product.",
    gap: "The strength rule is wrong for raw exchanges (the evidence base); exchanges already have their own size-only hot tier. Exempting the exchange kind is the minimal fix.",
    ...fm(
      "exempt kind `exchange` from strength-based archiving (lifecycle.exchange-capacity governs exchanges)",
      "correct answers after one memory:maintain per history",
      "longmemeval-m/dev + beam-100k/dev",
      "offline: archived raw exchanges 29/293 and 73/94 -> 0, and growth-stream month-1 active retrieval 0.5625 -> >= 0.9; live: maintain-then-answer arm with the exemption >= without it + 2 points on beam-100k/dev, and equal to the no-maintain arm within 1 point",
      "archive-exchange-exempt",
    ),
  },
  {
    id: "lifecycle.capacity-eviction",
    why: "trigger-too-rare",
    intended: "Bound each scope's typed-note store (notes and tokens) and evict the weakest unpinned notes.",
    source: "plan 188.4",
    evidence: "Rate 0 in the replays (no typed notes); 20k-token stress keeps month-12/month-1 retrieval at 0.625.",
    gap: "Its role is cost over long horizons, which no answer suite reaches.",
    ...me(
      "202 Task 15 growth stream with model answers (Task 9 owns the final-product confirmation)",
      "month-12 answer accuracy at the bounded store vs unbounded",
      "offline:growth-stream",
      "non-inferior within 2 points at a store bounded to the default budgets",
    ),
  },
  {
    id: "lifecycle.exchange-capacity",
    why: "premise-wrong",
    intended: "Demote old exchanges past a hot-token budget by size only, never deleting them.",
    source: "plan 202 Task 15",
    evidence:
      "Tier stress: month-1 and month-12 active retrieval 0.625 against 1.0 with the archive included (49 and 116 exchanges demoted by tier), so demotion hides findable evidence. Lexical recall is 1.06 ms p95 SQLite / 4.15 ms Postgres at 100k exchanges, and prompt cost is bounded by top-K, not store size.",
    gap: "The cost it saves is not real at the measured scale, and its demotions remove evidence from active recall. Leaving the hot tier unset in the presets is the minimal change; the field stays available for very large stores until measured there.",
    ...fm(
      "exchanges.hotTokens unset in the conversational and coding presets (no size demotion)",
      "month-12 active retrieval of month-1 exchanges; p95 recall latency at 100k exchanges",
      "offline:growth-stream",
      "active retrieval 0.625 -> >= 0.9 at month 12 with p95 recall still <= 10 ms SQLite at 100k exchanges; a model-answer leg (Task 9) confirms",
      "exchange-tier-off",
    ),
  },
  {
    id: "lifecycle.duplicate-merge",
    why: "dominated",
    intended: "Merge near-duplicate notes (Dice >= 0.8) during maintenance.",
    source: "plan 188.4",
    evidence: "Rate 0 in the replays; no row.",
    gap: "Write-time consolidation (same text, Dice) already prevents the duplicates this pass would merge.",
    ...ncp("Remove the duplicate-merge maintenance pass and its threshold; write-time consolidation stays."),
  },
  {
    id: "lifecycle.episode-merge",
    why: "trigger-too-rare",
    intended: "Merge clusters of episode notes with one model call.",
    source: "plan 188.5",
    evidence: "Cannot fire under either preset: episode rows come only from the extractor (promote off). Rate 0.",
    gap: "Depends entirely on extraction, and episodes have no measured reader.",
    ...ncp(`Remove episode merge. ${EXTRACTION_GATE}`),
  },
  {
    id: "lifecycle.widen-narrow",
    why: "trigger-too-rare",
    intended: "Widen a note to `agent` scope when two projects learn the same thing; narrow it on contradictions.",
    source: "plan 188.5",
    evidence:
      "Rate 0; never executed by a paid or development arm; uses are project-only (Task 2), so wider-scope notes cannot gather the evidence widening needs.",
    gap: "An agent that learns something true across projects can write it to user or agent scope directly with memory.insert; inferring it from identical text in two projects is a slow, rare proxy that also widens poisoned notes (MINJA).",
    ...ncp("Remove widening and narrowing (and their thresholds); explicit writes choose the scope."),
  },
  {
    id: "lifecycle.maintain",
    why: "suites-cannot-exercise",
    intended: "Run the lifecycle passes on demand and report them (memory:maintain, memory:lifecycle).",
    source: "plan 188.4",
    evidence: "Ran monthly in the growth stream; its report is inspectable (tested).",
    gap: "A host for the other passes; it survives exactly if one pass survives.",
    ...me(
      "follows the lifecycle rows' Task 6 decisions",
      "number of surviving lifecycle passes",
      "offline:growth-stream",
      "kept if at least one of archive, capacity or exchange-capacity survives; otherwise removed with them",
    ),
  },

  // ── Scopes ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: "scope.user",
    why: "suites-cannot-exercise",
    intended: "Keep the user's own preferences across projects.",
    source: "plan 188.2",
    evidence: "Isolation is proven (scope.isolation); its accuracy role has no row. Lifecycle uses never reach user notes (Task 2).",
    gap: "Every benchmark is one scope; the benefit is cross-project.",
    ...me(
      "two-project assistant persona: a preference stated in project A, asked in project B",
      "W3 re-asked questions in the second project",
      "work-outcome-assistant/dev",
      "user scope on lowers second-project W3 by >= 10 points against project-only memory",
    ),
  },
  {
    id: "scope.project",
    why: "suites-cannot-exercise",
    intended: "Keep project memory separate per project root.",
    source: "plan 188.2",
    evidence: "Visible/hidden checks pass; F3 (0.5417 foreign-context exposure on the paid promotion-off arm) is unexplained.",
    gap: "It is the default scope of every arm, so it cannot be ablated; F3 needs an offline diagnosis, not a paid arm.",
    ...me(
      "offline re-diagnosis of F3 from the 188.7 arm's stored report (which scope each foreign-context hit came from)",
      "foreign-context exposure explained by scope",
      "offline:188.7-arm-report",
      "F3 resolves to a measurement artefact or to a named scope; a real cross-project leak becomes a safety fix before Task 5",
    ),
  },
  {
    id: "scope.path",
    why: "suites-cannot-exercise",
    intended: "Apply a note only inside a subtree (`appliesTo`).",
    source: "plan 188.2; plan 202 Task 11",
    evidence:
      "No row. Path-scoped notes are what path cues deliver when a file tool touches a matching file, so the two are one mechanism (writer and reader).",
    gap: "Coding-only; it lives or dies with path cues.",
    ...me(
      "follows delivery.path-cues on the coding rows",
      "W2 convention adherence",
      "work-outcome-coding/dev + memorycode/dev",
      "kept if path cues survive; removed with them otherwise",
    ),
  },
  {
    id: "scope.agent",
    why: "trigger-too-rare",
    intended: "Share what one agent learned across all its projects.",
    source: "plan 188.5 (widening target)",
    evidence: "No accuracy row; widening never fires (and is a removal candidate), so only explicit writes can reach it.",
    gap: "With widening gone its only writer is memory.insert; it overlaps user scope for a single-agent host.",
    ...me(
      "tool-call trace on the coding and assistant work rows",
      "explicit writes that choose agent scope",
      "work-outcome-coding/dev + work-outcome-assistant/dev",
      ">= 5% of explicit writes choose agent scope and those notes are later cited; otherwise fold agent scope into user scope",
    ),
  },
  {
    id: "scope.team-store",
    why: "suites-cannot-exercise",
    intended: "Share vetted notes through a checked-in team store (memory:share).",
    source: "plan 188.2",
    evidence: "Trust probes pass; no benefit row; no suite has more than one user or agent.",
    gap: "A collaboration capability with no single-agent benchmark.",
    ...me(
      "offline two-agent hand-off fixture: agent A shares a decision, agent B recalls it",
      "hand-off notes recalled by the second agent",
      "offline:two-agent-handoff",
      "shared notes reach agent B in 100% of hand-offs with trust labels intact; benefit beyond that is an owner call in Task 6",
    ),
  },
  {
    id: "scope.shadowing",
    why: "suites-cannot-exercise",
    intended: "Let a narrower note hide a wider note with the same key.",
    source: "plan 188.2",
    evidence: "Functional test only; zero cost.",
    gap: "A consistency rule of multi-scope recall rather than an accuracy feature; it lives or dies with having more than one scope.",
    ...me(
      "named functional test (kept as an invariant of multi-scope recall)",
      "key conflicts resolved to the narrower scope",
      "offline:functional",
      "kept while two or more scopes survive; removed with them otherwise",
    ),
  },

  // ── Delivery ───────────────────────────────────────────────────────────────────────────────────
  {
    id: "delivery.passive-tail",
    why: "never-measured",
    intended: "Inject relevant past exchanges each user turn, so a model that never calls tools still benefits.",
    source: "plans 188.9-188.10",
    evidence:
      "Passive alone 28/60 vs passive plus tools 50/60 (screen-ms-v1), but no arm runs tools without passive; 78% of injected blocks were judged irrelevant.",
    gap: "Its marginal value over tools is unknown, and most of what it injects is noise. The query-centred card (Task 3.1) and the precision filter address the noise.",
    ...fm(
      "as-is: tools-only arm (passive off)",
      "correct answers and injected tokens per question",
      "locomo/dev + beam-100k/dev + longmemeval-m/dev",
      "passive on beats tools-only by >= 3 points on at least one suite, with no suite worse by more than 2",
      "tools-only",
    ),
    variants: [
      {
        variant: "inject.cardExcerpt",
        ...fm(
          'inject.cardExcerpt: "query"',
          "correct answers; answers that say the information is missing while the evidence was shown",
          "locomo/dev",
          ">= +1 of 60, with the injected token change per question reported; missing-while-shown wrong answers 3 -> <= 1",
          "card-excerpt",
        ),
      },
    ],
  },
  {
    id: "delivery.precision-filter",
    why: "never-measured",
    intended: "Drop weak passive candidates below similarity and score floors.",
    source: "plan 202 Task 8",
    evidence: "Functional tests only; the 0.2/0.35 floors have no development row.",
    gap: "Directly targets the 78% irrelevant-injection finding.",
    ...fm(
      "as-is: add-one with the 0.2 / 0.35 floors",
      "irrelevant injected share, injected tokens, correct answers",
      "locomo/dev + beam-100k/dev",
      "irrelevant share <= 0.40, injected tokens -50%, accuracy within 2 points (202 Task 8 targets)",
      "precision-filter",
    ),
  },
  {
    id: "delivery.weak-tool-caller",
    why: "suites-cannot-exercise",
    intended: "Switch from pointers to excerpts after two cued turns where the model never used memory tools.",
    source: "plan 202 Task 10",
    evidence: "Works; fires on 49% of replayed multi-turn turns; cannot fire in a one-question benchmark session.",
    gap: "Its 'no benefit' is unexercised, not shown absent. It needs a multi-turn suite and a weak tool caller.",
    ...me(
      "multi-turn small-model arm (202 Task 10 targets)",
      "correct answers; run-limit share",
      "work-outcome-assistant/dev",
      "small model with the switch >= passive-only and within 5 points of full context; strong model within 2 points (no harm)",
    ),
  },
  {
    id: "delivery.aggregation-abstention",
    why: "never-measured",
    intended: "Tell the model to aggregate across hits and to abstain when the evidence is below the floor.",
    source: "plan 202 Task 9",
    evidence:
      "Functional tests only. 208 investigation: BEAM-100K abstention 1/4 with recall vs 4/4 with the oracle; LoCoMo 3 wrong answers said 'missing' with the evidence shown.",
    gap: "The abstention gap is a product cause (a floor or guidance problem), not a model ceiling, so the guidance is worth measuring.",
    ...fm(
      "as-is: guidance leave-one-out",
      "abstention correct answers; answer-gap failures",
      "beam-100k/dev + locomo/dev",
      "abstention >= full context (>= 3 of 4 on beam-100k) and answer-gap failures -40% with the guidance on (202 Task 9 targets)",
      "aggregation-loo",
    ),
    variants: [
      {
        variant: "early-give-up",
        ...me(
          "count only (no fix): answers that say the information is missing while evidence was delivered, classified model / card / gate",
          "missing-while-shown wrong answers",
          "locomo/dev + beam-100k/dev",
          "3 of 60 and 0 of 40 today; the card cause is scored by inject.cardExcerpt, and no separate fix is proposed",
        ),
      },
    ],
  },
  {
    id: "delivery.directory",
    why: "effect-too-small",
    intended: "Show the agent what topics and files memory holds, so it knows what to recall.",
    source: "plan 188.10",
    evidence:
      "Present in every arm (30/30 tools-arm questions); never ablated; up to 200 tokens per request; topic list padded with stop words (208).",
    gap: "Likely small; its cost is paid every request. Task 3.1 built `stopWords`.",
    ...fm(
      "as-is: directory leave-one-out",
      "correct answers and tokens per request",
      "locomo/dev + longmemeval-m/dev",
      "directory off within +-1 of 60 on locomo and +-2 points on longmemeval-m (no benefit); a confirmed null removes the block",
      "directory-loo",
    ),
    variants: [
      {
        variant: "directory.stopWords",
        ...me(
          "topic list drops stop-word-only topics",
          "injected tokens in the directory block",
          "locomo/dev",
          "no accuracy change; fewer wasted tokens (hygiene, cost-justified only)",
        ),
      },
    ],
  },
  {
    id: "delivery.standing-rules",
    why: "never-measured",
    intended: "Pin the user's standing rules and preferences in a stable prefix block.",
    source: "plan 209 (pinned core); MemGPT/Letta core memory",
    evidence:
      "+W bundle only (20 rules, W5 0.82); coding preset member; BEAM instruction_following is 2/4 with recall, 0/4 with the oracle.",
    gap: "Needs isolating from +W. BEAM's instruction and preference following is the conversational test of the same idea.",
    ...fm(
      "as-is: rules leave-one-out inside +W; add-one on the conversational preset",
      "W2 convention adherence; beam-100k instruction_following + preference_following",
      "work-outcome-coding/dev + beam-100k/dev",
      "rules off lowers W2 by >= 5 points; add-one on conversational lifts beam instruction+preference following by >= 1 of 8",
      "rules-loo",
    ),
  },
  {
    id: "delivery.rule-capture",
    why: "trigger-too-rare",
    intended: "Capture 'always/never' cues as proposed standing rules, with confirmation.",
    source: "plan 209 Task 5",
    evidence: "0.24% of replayed turns; +W bundle only; silently a no-op without the exchange archive (Task 2, now a warning).",
    gap: "Rare by nature (users state rules seldom); its value is per captured rule, measurable only in the work rows.",
    ...me(
      "capture leave-one-out inside +W",
      "captured rules later applied (W5 support)",
      "work-outcome-coding/dev",
      "capture on yields >= 1 applied rule per persona with W5 >= 0.95 support; otherwise remove capture and keep explicit rules",
    ),
  },
  {
    id: "delivery.rules-md-reconcile",
    why: "suites-cannot-exercise",
    intended: "Keep an editable rules.md in sync with the rules block.",
    source: "plan 209",
    evidence: "+W bundle only; inspectability role has no named test.",
    gap: "Inspectability is proven by a test, not a benchmark.",
    ...me(
      "named inspectability test: an edit to rules.md reaches the next request's rules block",
      "edited rule present in the next request",
      "offline:functional",
      "test passes -> safety-proven (inspectability); its accuracy role follows delivery.standing-rules",
    ),
  },
  {
    id: "delivery.path-cues",
    why: "suites-cannot-exercise",
    intended: "Show a standing decision once when a file tool touches a matching path.",
    source: "plan 202 Task 11",
    evidence: "Functional tests and cue timing only; no model-run coding row.",
    gap: "Coding-only; it needs the coding work rows or MemoryCode.",
    ...me(
      "cues leave-one-out on the coding rows",
      "W2 convention adherence; superseded-rule exposure",
      "work-outcome-coding/dev + memorycode/dev",
      "cues off lowers W2 by >= 5 points with no rise in superseded-rule exposure",
    ),
  },
  {
    id: "delivery.working-memory",
    why: "dominated",
    intended: "Keep agent-editable working blocks in every request.",
    source: "MemGPT/Letta core memory blocks; 0.12 working memory",
    evidence: "Rate 0; no benchmark arm writes blocks.",
    gap: "Standing rules (durable) and OM task state (in-session) cover the two uses of a pinned block.",
    ...ncp(
      "Remove working-memory blocks, `memory.view`'s block edits and the `working` kind's block rendering; standing rules and OM task state remain.",
    ),
  },

  // ── Decision model (202 Task 12) ───────────────────────────────────────────────────────────────
  {
    id: "decisions.binding",
    why: "never-measured",
    intended: "Bind a cheap decision model that answers the P-points in one batched call per turn.",
    source: "plan 202 Task 12",
    evidence: "Synthetic fixture only; no point passed a live bench; about 2 calls and 1,000 input tokens per user turn.",
    gap: "Its value is the sum of the points that survive; it has no role of its own.",
    ...me(
      "follows P3, P4 and P5",
      "surviving decision points",
      "beam-100k/dev + locomo/dev",
      "kept only if at least one of P3, P4, P5 passes; otherwise removed with all points",
    ),
  },
  {
    id: "decisions.P1",
    why: "dominated",
    intended: "Decide whether a candidate is durable enough to capture (coding capture, extractor).",
    source: "plan 202 Task 12",
    evidence: "100 synthetic labelled items; no live screen.",
    gap: "Its inputs come from capture and extraction, which are rare or gated on F4; explicit confirmation already guards capture.",
    ...ncp(`Remove P1. ${EXTRACTION_GATE}`),
  },
  {
    id: "decisions.P2",
    why: "dominated",
    intended: "Decide supersession per consolidation candidate.",
    source: "plan 202 Task 12",
    evidence: '100 synthetic items; no live screen; same mechanism as consolidate.decider "model".',
    gap: "See write.consolidate-model-decider.",
    ...ncp("Remove P2 with the model decider."),
  },
  {
    id: "decisions.P3",
    why: "never-measured",
    intended: "Judge relevance of each passive candidate before injection.",
    source: "plan 202 Task 12",
    evidence: "100 synthetic items; 78% of injected blocks are irrelevant today.",
    gap: "The only point aimed at the largest measured delivery defect; it must beat the zero-cost precision filter to earn a model call.",
    ...fm(
      "as-is: add-one P3 on top of the precision filter (per-point accuracy, ECE and order-flip on its labelled items first)",
      "irrelevant injected share; correct answers",
      "beam-100k/dev + locomo/dev",
      "irrelevant share <= 0.25 (vs the filter's) with accuracy >= the filter arm + 1 point; otherwise remove",
      "decisions-p3",
    ),
  },
  {
    id: "decisions.P4",
    why: "never-measured",
    intended: "Skip passive injection on turns that need no memory.",
    source: "plan 202 Task 12",
    evidence: "100 synthetic items; no live screen.",
    gap: "Saves tokens on non-memory turns; one-question suites always need memory, so its effect is cost on multi-turn work.",
    ...fm(
      "as-is: add-one P4 (per-point accuracy, ECE and order-flip first)",
      "injected tokens per turn; task success",
      "work-outcome-assistant/dev",
      "injected tokens -30% with W6 within 2 points; otherwise remove",
      "decisions-p4",
    ),
  },
  {
    id: "decisions.P5",
    why: "never-measured",
    intended: "Add an abstention note when the shown evidence is not enough.",
    source: "plan 202 Task 12",
    evidence: "100 synthetic items; BEAM-100K abstention 1/4 with recall vs 4/4 oracle.",
    gap: "Targets the same abstention gap as the aggregation guidance; it must beat the zero-cost guidance.",
    ...fm(
      "as-is: add-one P5 on top of the aggregation guidance (per-point accuracy, ECE and order-flip first)",
      "abstention correct answers",
      "beam-100k/dev",
      ">= +1 of 4 on abstention over the guidance arm, with locomo/dev missing-while-shown answers not above the guidance arm's (LoCoMo shows over-abstention, 11 of 60 say 'missing' with evidence shown); otherwise remove",
      "decisions-p5",
    ),
  },
  {
    id: "decisions.P6",
    why: "dominated",
    intended: "Decide whether a path cue applies.",
    source: "plan 202 Task 12",
    evidence: "100 synthetic items; no live screen.",
    gap: "Glob matching already decides applicability deterministically; a model call adds cost for a rare cue.",
    ...ncp("Remove P6; path cues stay glob-matched."),
  },
  {
    id: "decisions.P7",
    why: "dominated",
    intended: "Refuse to capture instruction-like text as a rule (prompt-injection guard).",
    source: "plan 202 Task 12; MINJA",
    evidence: "100 synthetic items; the deterministic trust scan is safety-proven and capture needs confirmation.",
    gap: "Its role is safety, which a QA suite cannot show; the deterministic trust scan plus confirmation may already meet it.",
    ...me(
      "202 Task 14 real-model agentic-poisoning confirmation with capture on, P7 on vs off",
      "poisoned rules captured",
      "offline:202-task14-poisoning",
      "P7 on captures fewer poisoned rules than the trust scan plus confirm alone; otherwise remove it (and it goes with capture if capture is removed)",
    ),
  },

  // ── Kinds ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: "kind.episode",
    why: "trigger-too-rare",
    intended: "Expose OM-derived episodes as a read-only note view.",
    source: "plan 188.6",
    evidence: "Unreachable from the package (it passes no observational source); library hosts only; no arm reads it.",
    gap: "Wiring OM into the package would add a source with no measured reader; OM's own recall tool serves the session, and exchanges serve cross-session.",
    ...ncp("Remove the `episode` view and kind; do not wire an observational source into the package."),
  },
  {
    id: "kind.fact",
    why: "suites-cannot-exercise",
    intended: "Store durable facts as typed notes.",
    source: "plan 188.1; plan 202 Task 17",
    evidence: "Presets write no facts; fabric-x holds 0 fact notes. Agents can still insert them.",
    gap: "Its accuracy role is the F4 question; its explicit-write role follows tools.explicit-writes.",
    ...me(
      "F4 diagnostic leg and the explicit-write arm",
      "fact notes written and later cited",
      "work-outcome-assistant/dev",
      "kept if explicit writes survive (agents write facts) or the Task 17 remedy is built; otherwise merged into one typed `note` kind",
    ),
  },
  {
    id: "kind.preference",
    why: "suites-cannot-exercise",
    intended: "Store user preferences (user scope by default).",
    source: "plan 188.2",
    evidence: "No row.",
    gap: "Overlaps standing rules (pinned preferences); its separate value is the default user scope.",
    ...me(
      "explicit-write arm on the assistant rows",
      "preference notes written and later applied",
      "work-outcome-assistant/dev",
      "kept if >= 1 preference note per persona is written and applied; otherwise merged into standing rules",
    ),
  },
  {
    id: "kind.procedure",
    why: "dominated",
    intended: "Store how-to procedures, kept out of default recall.",
    source: "plan 188.2",
    evidence: "No row; excluded from default recall and passive injection, so nothing reads it unless asked.",
    gap: "Lessons (209) store cited how-to learning, and module skills (plan 211) carry procedures; a third channel adds surface without a reader.",
    ...ncp("Remove the `procedure` kind; lessons and skills carry procedures."),
  },
  {
    id: "kind.decision",
    why: "trigger-too-rare",
    intended: "Record coding decisions, proposed until confirmed or used twice.",
    source: "plan 202 Task 11",
    evidence: "Rate 0 in the replays; functional tests and cue timing only.",
    gap: "Coding-only, with path cues as its reader.",
    ...me(
      "follows delivery.path-cues on the coding rows",
      "W2 convention adherence",
      "work-outcome-coding/dev + memorycode/dev",
      "kept if path cues survive",
    ),
  },
  {
    id: "kind.file",
    why: "suites-cannot-exercise",
    intended: "Keep notes about files (and the startup reconcile), and the file notes source ingest writes.",
    source: "plan 188.2; plan 207 source ingest",
    evidence: "No row.",
    gap: "A coding agent reads the file itself; the note's value is orientation (W4) before reading.",
    ...me(
      "file-note leave-one-out on the coding rows",
      "W4 orientation cost",
      "work-outcome-coding/dev",
      "file notes off raise W4 by >= 10%; otherwise remove file notes and the startup reconcile (ingest keeps staging)",
    ),
  },
  {
    id: "kind.concept",
    why: "never-measured",
    intended: "Hold curated concept pages (the ontology tier).",
    source: "plan 207",
    evidence: "O1/O2/O5/O7 pending, O3 not run.",
    gap: "Follows ontology.tier.",
    ...me("follows ontology.tier", "plan 208 O-rows", "ontology-o-rows/dev", "kept if the tier survives"),
  },
  {
    id: "lessons",
    why: "trigger-too-rare",
    intended: "Store cited lessons from corrected mistakes, with an optional nudge and archive rule.",
    source: "plan 209 Task 4; ACE",
    evidence: "Rate 0 in the replays; +W bundle only (8 lessons, W5 0.82).",
    gap: "Its effect is the corrected-mistake repeat rate, which only the work rows measure.",
    ...fm(
      "as-is: lessons leave-one-out inside +W",
      "W1 corrected-mistake repeat rate",
      "work-outcome-coding/dev + work-outcome-assistant/dev",
      "lessons off raises W1 by >= 5 points; otherwise remove lessons and the nudge",
      "lessons-loo",
    ),
  },

  // ── Ontology tier (207/208) ────────────────────────────────────────────────────────────────────
  {
    id: "ontology.tier",
    why: "never-measured",
    intended: "Curate concept pages over the fabric so subjects are summarized once, with claims cited.",
    source: "plan 207; Karpathy LLM wiki",
    evidence: "O4 pass only; O1/O2/O5/O7 pending; O3 not run (Task 3.2 calibrates the panel); O8 P+W+O vs P+W no pass.",
    gap: "Unmeasured rather than shown neutral; the O-rows are the measurement.",
    ...me(
      "plan 208 O-rows on the post-remediation product (after Task 3.2's panel calibration)",
      "O1-O8",
      "ontology-o-rows/dev",
      "passes the three-tier criteria O1, O2 and O3; otherwise the tier leaves the default surface",
    ),
  },
  {
    id: "ontology.binding-deterministic",
    why: "never-measured",
    intended: "Bind notes to subjects by term overlap (bindThreshold 2).",
    source: "plan 207",
    evidence: "Concept stages counted; no ablation.",
    gap: "The tier's core input; follows the tier.",
    ...me("follows ontology.tier", "O-rows", "ontology-o-rows/dev", "kept if the tier survives"),
  },
  {
    id: "ontology.binding-extractor",
    why: "dominated",
    intended: "Bind subjects with the extractor's help.",
    source: "plan 207",
    evidence: "Not exercised by the development screen; costs extractor calls.",
    gap: "Deterministic binding is the tier's working path; the extractor family is unreliable (F4).",
    ...ncp("Remove extractor-assisted binding; deterministic binding stays."),
  },
  {
    id: "ontology.curator-pass",
    why: "never-measured",
    intended: "Edit concept pages through a validated vocabulary with one repair call.",
    source: "plan 207",
    evidence: "15 curator calls on Muse, 7 on Qwen on the dev screen.",
    gap: "The tier itself; follows the tier.",
    ...me("follows ontology.tier", "O-rows", "ontology-o-rows/dev", "kept if the tier survives"),
  },
  {
    id: "ontology.trigger.co-read",
    why: "effect-too-small",
    intended: "Curate a subject when its notes are read together.",
    source: "plan 207",
    evidence: "Read-time-only minus the three default policies: 0 points, n = 20, CI low -15.",
    gap: "The one comparison suggests read-time curation alone is as good; per-policy ablation decides.",
    ...fm(
      "as-is: co-read trigger leave-one-out",
      "O-row accuracy and curator calls",
      "ontology-o-rows/dev",
      "co-read off is non-inferior (CI low > -5 points) with fewer curator calls; that result removes the trigger",
      "trigger-co-read-loo",
    ),
  },
  {
    id: "ontology.trigger.accumulation",
    why: "effect-too-small",
    intended: "Curate a subject once enough new notes accumulate.",
    source: "plan 207",
    evidence: "Part of the default policies in the same 0-point comparison.",
    gap: "Same as co-read.",
    ...fm(
      "as-is: accumulation trigger leave-one-out",
      "O-row accuracy and curator calls",
      "ontology-o-rows/dev",
      "accumulation off is non-inferior (CI low > -5 points) with fewer curator calls; that result removes the trigger",
      "trigger-accumulation-loo",
    ),
  },
  {
    id: "ontology.trigger.repair",
    why: "suites-cannot-exercise",
    intended: "Re-curate a concept whose cited source was deleted.",
    source: "plan 207",
    evidence: "The deletion cascade probe passes; the repair call's own benefit is unmeasured.",
    gap: "A safety follow-up to the cascade; proven by a test, not a suite.",
    ...me(
      "named test: after a cited note is forgotten, the concept no longer cites it",
      "concepts citing deleted notes",
      "offline:functional",
      "0 after repair -> safety-proven; kept while the tier survives",
    ),
  },
  {
    id: "ontology.concept-prior",
    why: "never-measured",
    intended: "Boost concept pages in recall and render their claims.",
    source: "plan 207",
    evidence: "No ablation arm in the development screen.",
    gap: "Its value is whether concepts reach the answer.",
    ...fm(
      "as-is: concept prior 0 (leave-one-out)",
      "O-row accuracy",
      "ontology-o-rows/dev",
      "prior off loses >= 3 points on the O-rows; otherwise remove the prior",
      "concept-prior-loo",
    ),
  },
  {
    id: "ontology.passive-pointer",
    why: "never-measured",
    intended: "Point at a relevant concept page in passive delivery.",
    source: "plan 207",
    evidence: "No ablation arm.",
    gap: "One line per turn; its effect is concept reads that follow it.",
    ...fm(
      "as-is: pointer leave-one-out",
      "O-row accuracy; concept reads per question",
      "ontology-o-rows/dev",
      "pointer off loses >= 2 points or halves concept reads; otherwise remove the pointer",
      "concept-pointer-loo",
    ),
  },
  {
    id: "ontology.concept-sharing",
    why: "suites-cannot-exercise",
    intended: "Share concept pages to the team store.",
    source: "plan 207",
    evidence: "Not exercised by the development screen.",
    gap: "Follows scope.team-store and the tier.",
    ...me(
      "follows scope.team-store",
      "hand-off concepts recalled",
      "offline:two-agent-handoff",
      "kept if both the team store and the tier survive",
    ),
  },
  {
    id: "ontology.source-ingest",
    why: "premise-wrong",
    intended: "Ingest a document as a staged source and a file note for curation.",
    source: "plan 207",
    evidence: "Jail and SSRF are tested; no accuracy row.",
    gap: "Document ingestion overlaps memory-rag, which the owner keeps outside memory; inside the tier it only matters if curated sources beat RAG retrieval of the same document.",
    ...me(
      "owner call in Task 6 (memory vs memory-rag boundary), informed by one O-row arm with an ingested source",
      "O-row accuracy on source-backed subjects",
      "ontology-o-rows/dev",
      "ingest-backed concepts beat recall over the same source by >= 3 points; otherwise remove ingest from memory-wiki and point hosts to memory-rag",
    ),
  },
  {
    id: "ontology.coding-o6",
    why: "suites-cannot-exercise",
    intended: "Run the tier on the coding preset (O6).",
    source: "plan 208",
    evidence: "Not screened: no coding preset or sandbox on a free route.",
    gap: "Needs a paid coding sandbox route.",
    ...me(
      "coding+O arm under C-1",
      "O6 and W rows",
      "work-outcome-coding/dev",
      "passes O6; otherwise the tier is not offered on the coding preset",
    ),
  },

  // ── Observational memory ───────────────────────────────────────────────────────────────────────
  {
    id: "om.observer",
    why: "suites-cannot-exercise",
    intended: "Compress the running session into observations so long sessions keep their details.",
    source: "plan 188.6; Mastra observational memory",
    evidence: "Only a scripted mock: om+fabric 0.732 vs fabric 0.375; six live one-question arms prove completion only; F9 arm incomplete.",
    gap: "Its benefit is inside one long session, which cross-session QA suites do not stress.",
    ...me(
      "long single-conversation arm: OM vs memory-compaction at the same window (plan 194 rot-curve harness)",
      "correct answers",
      "beam-1m/dev",
      "OM >= memory-compaction + 3 points at equal or lower model-call cost; otherwise OM leaves the default surface",
    ),
  },
  {
    id: "om.reflector",
    why: "never-measured",
    intended: "Condense observations into reflections when they grow.",
    source: "plan 188.6",
    evidence: "1.29 reflector calls per arm (mock); never ablated.",
    gap: "Follows the observer; a leave-one-out inside the OM arm.",
    ...fm(
      "as-is: reflector off inside the OM arm",
      "correct answers and observer pool tokens",
      "beam-1m/dev",
      "reflector off loses >= 2 points or grows the pool past the dropper's target; otherwise remove the reflector",
      "om-reflector-loo",
    ),
  },
  {
    id: "om.dropper-model",
    why: "dominated",
    intended: "Drop observations under pool pressure by asking a model.",
    source: "plan 188.6",
    evidence: "No row; default policy; one model call per pressure pass.",
    gap: "The deterministic lowest-relevance policy does the same at zero calls.",
    ...fm(
      'om dropper.policy: "lowest-relevance" (switch the default)',
      "correct answers and dropper model calls",
      "beam-1m/dev",
      "lowest-relevance non-inferior within 2 points with 0 dropper calls; that result removes the model policy",
      "om-dropper-deterministic",
    ),
  },
  {
    id: "om.dropper-lowest-relevance",
    why: "never-measured",
    intended: "Drop the least relevant observations deterministically.",
    source: "plan 188.6",
    evidence: "No row.",
    gap: "Measured by the same arm as om.dropper-model.",
    ...fm(
      "as-is: same arm as om.dropper-model",
      "correct answers",
      "beam-1m/dev",
      "non-inferior within 2 points of the model policy",
      "om-dropper-deterministic",
    ),
  },
  {
    id: "om.task-state",
    why: "suites-cannot-exercise",
    intended: "Keep a current-task section through compaction.",
    source: "plan 188.6",
    evidence: "No row.",
    gap: "Its value is task continuity after compaction, a multi-turn work property.",
    ...me(
      "task-state leave-one-out in long work sessions",
      "W6 task success after a compaction",
      "work-outcome-coding/dev",
      "task state off lowers W6 by >= 5 points in sessions that compact; otherwise remove it",
    ),
  },
  {
    id: "om.compaction",
    why: "suites-cannot-exercise",
    intended: "Compact the transcript from the OM ledger instead of a fresh summary call.",
    source: "plan 188.6",
    evidence: "Plan 194's rot curve measured memory-compaction, not OM compaction.",
    gap: "Same harness, different compactor.",
    ...me(
      "plan 194 rot-curve harness with OM compaction",
      "accuracy at each fill level",
      "beam-1m/dev",
      "OM compaction >= memory-compaction at every fill level within 2 points, with 0 extra summary calls",
    ),
  },
  {
    id: "om.recall-tool",
    why: "suites-cannot-exercise",
    intended: "Page raw source of the current session after compaction.",
    source: "plan 188.6",
    evidence: "No row.",
    gap: "Only questions about compacted-away details exercise it.",
    ...me(
      "inside the OM compaction arm: questions whose evidence was compacted away",
      "correct answers on compacted-away evidence",
      "beam-1m/dev",
      "recall tool on >= off + 5 points on those questions; otherwise remove it",
    ),
  },
  {
    id: "om.pinned-context",
    why: "suites-cannot-exercise",
    intended: "Render only the pinned ledger so the prefix stays cacheable.",
    source: "plan 188.6; plan 184 cache parity",
    evidence: "The cache attestation covers fabric arms only.",
    gap: "A cost role measurable offline with the prefix probe.",
    ...me(
      "prefix-probe scenario for OM pinned mode (offline, free)",
      "distinct prefixes per epoch",
      "offline:prefix-probe",
      "one prefix per epoch -> cost role proven; otherwise remove the mode",
    ),
  },

  // ── Presets, stores, legacy surface, navigation ────────────────────────────────────────────────
  {
    id: "preset.coding",
    why: "suites-cannot-exercise",
    intended: "Bundle the coding defaults (rules, cues, decisions, exchanges).",
    source: "plans 202 Task 11, 209",
    evidence: "coding+W vs coding reported only; no row passes; O6 not screened.",
    gap: "Measured by the coding work rows once its members are decided.",
    ...me(
      "coding preset vs memory-off on the coding rows, after Task 6 settles its members",
      "W1, W2, W6",
      "work-outcome-coding/dev",
      "every W metric the right way with W2 >= +5 points; otherwise the preset is not offered",
    ),
  },
  {
    id: "stores.durable",
    why: "suites-cannot-exercise",
    intended: "Persist memory in SQLite or Postgres.",
    source: "plan 188.x stores",
    evidence: "100k exchanges: p95 lexical recall 1.06 ms SQLite / 4.15 ms Postgres; Task 0.4 fixed the branch read.",
    gap: "A store choice has no accuracy role; latency is already measured.",
    ...me(
      "existing exchange-scale envelope (rerun on the final product)",
      "p95 recall latency at 100k exchanges",
      "offline:exchange-scale",
      "p95 <= 10 ms SQLite and <= 25 ms Postgres -> kept for compatibility and latency",
    ),
  },
  {
    id: "scoped.policy",
    why: "dominated",
    intended: "The 0.12 scoped-memory policy layer: activation floor, approval, fact block, gcPass.",
    source: "0.12 library surface moved into memory-fabric",
    evidence: "No row; replaces plain recall when configured.",
    gap: "Its activation floor duplicates the precision filter, its gc duplicates the lifecycle, and its fact block duplicates standing rules.",
    ...ncp(
      "Remove the `scoped` policy layer and its config (`scoped.*`) from memory-fabric; precision filter, lifecycle and standing rules cover its parts.",
    ),
  },
  {
    id: "navigation.agentic-lexical",
    why: "measured-while-broken",
    intended: "Let the agent page around a hit or through a session (memory.read around / session).",
    source: "plan 202 Task 5",
    evidence:
      "The 202 Task 5 screen ran through the package, which until Task 2's fix answered every around/session read with not_found (committed package at 74bf7598 has no navigateNotes). The screen's miss is therefore not evidence about navigation.",
    gap: "The mechanism error is fixed; the feature has never been measured working.",
    ...fm(
      "as-is after the Task 2 routing fix: separate navigation leave-one-out (plan 202 Task 5.4.6 hand-off)",
      "candidate-gap failures; multi-session correct answers",
      "longmemeval-m/dev + beam-1m/dev",
      "navigation on cuts candidate-gap failures by >= 25% against navigation off, subject to the ability veto",
      "navigation-loo",
    ),
  },
]);

/** Deferred levers: unbuilt, so not removable rows; their disposition is recorded here. */
export const DEFERRED = Object.freeze([
  {
    id: "202-task17",
    title: "facts / F4 (conditional fact extraction)",
    disposition: "unmeasured",
    evidence: [
      "202 failure attribution: coverage 0-19% per cell, every stage a historical heuristic (protocol outcome-first-product-levers-v2); missing attribution never counts as zero.",
      "208 accuracy investigation (Muse 1.2, dev): BEAM-100K oracle beats recall by a net 5 of 40 on aggregation and state abilities (event ordering +2, multi-session +1, summarization +1, knowledge update +1), so the target share is not below 5% and not-needed cannot be recorded.",
      "Those questions are the read-time variants' targets (recall.gather, grouping, card excerpt), none of which has been measured, so the residual after read-time fixes is unknown.",
      "LoCoMo: recall-wrong / oracle-right 9 of 60, all with named read-time causes; multi-hop net 1 of 60.",
    ],
    protocol:
      "Task 5 diagnostic leg under C-1, pre-registered in Task 4: per suite x model (beam-100k/dev, locomo/dev, longmemeval-m/dev), run the best read-time arm (gather + expansion + card excerpt + grouping) and the oracle arm on the same questions with validated ingestion. A failure counts toward extraction only if the oracle answers it, the read-time arm does not, the report's evidenceCounts show the gold evidence was delivered or was a candidate, the ability is state or aggregation, and the failure id is unique (repeats collapsed). Source and protocol hashes are pinned.",
    rule: "complete attribution and < 5% -> not-needed (F4's remedy closed; the existing extractor is not thereby declared reliable); >= 5% irrecoverable in any suite x model -> fix-and-measure, the original scoped Task 17 remedy (opt-in `conversational-facts`); incomplete attribution -> stays unmeasured and no preset is built. Task 13's >= 5% shared-entity/not-in-query condition is kept separately; no graph store.",
  },
  {
    id: "202-task13",
    title: "typed-link association",
    disposition: "unmeasured",
    evidence: [
      "Closed without implementation for insufficient causal attribution; no residual shows a shared-entity or not-in-query failure share.",
    ],
    protocol:
      "Recorded from the same diagnostic leg: failures where the gold evidence shares an entity with a hit but no query term (counted from evidenceCounts and the term sets, no text).",
    rule: ">= 5% of a suite x model's failures -> reconsider typed links (owner gate); otherwise stays closed. No graph store is authorized.",
  },
]);

/**
 * The second pass (plan 210 Task 3 criterion): a delegated reviewer classified all 88 candidates blind to
 * the first pass's verdicts (2026-11-07). 61 of 88 verdicts agreed. Each disagreement is resolved here.
 * `kind`: "label" = same Task 5 arm and direction, the two passes named it differently; "adopted" = the
 * first pass changed to the reviewer's call; "kept" = the first pass's call stands, with the reason.
 */
export const REVIEW = Object.freeze({
  reviewer: "delegated general-purpose agent, no access to gap-analysis.md or gap-predictions.json",
  date: "2026-11-07",
  candidates: 88,
  agreedBeforeResolution: 61,
  labelRule:
    'A plain leave-one-out or add-one on the development suites, with a stated prediction, is fix-and-measure with change "as-is …" because Task 5 scores it in the C-1 campaign; measure-elsewhere is kept for measurements outside the QA and work suites\' arms (offline instruments, growth stream, safety confirmation, follows-another-row).',
  disagreements: [
    { id: "retrieval.lexical", kind: "label", resolution: "memory-off arm in Task 5 (fix-and-measure as-is)." },
    {
      id: "recall.multi-query",
      kind: "label",
      resolution: "tool-affordance leave-one-out; the reviewer's usage count from existing transcripts is added to Task 5's report.",
    },
    {
      id: "recall.unmatched-terms",
      kind: "label",
      resolution: "same arm; the reviewer's reformulation-rate trace metric is reported beside it.",
    },
    {
      id: "write.keyword-enrichment",
      kind: "label",
      resolution:
        "separate leave-one-out (mandatory hand-off). Reviewer's point adopted in the evidence: the screen measured enrichment effectively alone, with a LoCoMo candidate-gap worsening of +14.6 points (CI [0, 29]).",
    },
    { id: "write.exchange-steps", kind: "label", resolution: "isolated in the +W coding row." },
    { id: "timeline", kind: "label", resolution: "timeline-off arm." },
    {
      id: "recall.state-grouping",
      kind: "adopted",
      resolution:
        "reviewer's premise point adopted: the arm runs with supersessionHint keyed-only, so similarity-only grouping is judged without the doubtful label.",
    },
    { id: "delivery.passive-tail", kind: "label", resolution: "tools-only arm." },
    {
      id: "delivery.directory",
      kind: "label",
      resolution: "leave-one-out; recall-call rate with and without the block is reported beside accuracy.",
    },
    { id: "delivery.standing-rules", kind: "label", resolution: "isolated in +W and on the BEAM instruction/preference strata." },
    { id: "lessons", kind: "label", resolution: "isolated in +W." },
    { id: "ontology.trigger.accumulation", kind: "label", resolution: "per-policy leave-one-out." },
    { id: "ontology.concept-prior", kind: "label", resolution: "conceptPrior 0 inside the tier's O-rows." },
    { id: "ontology.passive-pointer", kind: "label", resolution: "pointer leave-one-out; concept-read rate reported." },
    { id: "om.reflector", kind: "label", resolution: "reflector off inside the OM arm." },
    { id: "om.dropper-lowest-relevance", kind: "label", resolution: "comparator in the dropper arm." },
    {
      id: "lifecycle.exchange-capacity",
      kind: "adopted",
      resolution:
        "reviewer's evidence verified (tier stress active 0.625 vs inclusive 1.0; recall cost bounded by top-K): fix-and-measure with the hot tier unset in the presets.",
    },
    {
      id: "lifecycle.widen-narrow",
      kind: "adopted",
      resolution: "no-credible-path: explicit writes choose the scope; scope.agent re-pointed to explicit-write usage.",
    },
    {
      id: "scope.path",
      kind: "adopted",
      resolution: "first pass was wrong: path cues are the reader of path-scoped notes, not a rival. Follows delivery.path-cues.",
    },
    {
      id: "decisions.P7",
      kind: "adopted",
      resolution: "safety role: measured in the 202 Task 14 real-model poisoning confirmation, not removed on QA grounds.",
    },
    {
      id: "retrieval.strength-priors",
      kind: "kept",
      resolution:
        "fix-and-measure (0.05 -> 0.15): the age term is a recency prior that may help knowledge-update and the arm is cheap; the prediction already removes the prior on a null, which is the reviewer's expected outcome. Per-scope routing (reviewer finding) is adopted as a structural fix.",
    },
    {
      id: "retrieval.decay-per-kind",
      kind: "kept",
      resolution:
        "no-credible-path: the reviewer's point that decay feeds archive timing is right, but with the exchange exemption decay only times typed-note archiving, and no preset writes typed notes; one rate suffices.",
    },
    {
      id: "decisions.P5",
      kind: "kept",
      resolution:
        "fix-and-measure: BEAM-100K abstention (1/4 vs oracle 4/4) is under-abstention, the gap P5 targets; the reviewer's over-abstention evidence (LoCoMo) is added as a no-harm condition in the prediction.",
    },
    {
      id: "kind.procedure",
      kind: "kept",
      resolution:
        "no-credible-path: excluded from default recall and injection, so it has no reader; lessons carry agent-learned procedures with citations.",
    },
    {
      id: "kind.file",
      kind: "kept",
      resolution:
        "measure-elsewhere (W4 orientation): source ingest writes file notes, so removing the kind decides ingest too; that boundary is the owner's call in Task 6 with ontology.source-ingest.",
    },
    {
      id: "ontology.trigger.co-read",
      kind: "kept",
      resolution:
        "fix-and-measure: n = 20 with CI low -15 shows neither difference nor non-inferiority; the leave-one-out runs inside the O-row arm at little cost, and its prediction removes the trigger on non-inferiority.",
    },
    {
      id: "ontology.source-ingest",
      kind: "kept",
      resolution:
        "measure-elsewhere with an owner call: both passes see the overlap with memory-rag; whether ingest belongs to memory is the owner's boundary decision (Task 6), not an analysis verdict.",
    },
  ],
  findingsAdopted: [
    "The 202 Task 5 screen ran navigation through the broken package path, so its miss is not navigation evidence (both passes found it independently).",
    "The Task 3.1 gather prediction (multi-hop >= 5 of 12) was above the oracle ceiling (4 of 12); it is rescored on evidence recall with accuracy capped at the ceiling.",
    "The growth criterion compared two archived months; month-1 active retrieval is 0.5625 against 1.0 inclusive, and maintain.ts applies the strength rule to raw exchanges.",
    "Per-scope clocks already exist, so the project-only lifecycle fix is internal; it matters for archiving correctness, not only ranking.",
  ],
  notAdopted: [
    "aggregation-abstention: the reviewer proposed returning weak hits instead of 'no matching memory' below the 0.34 floor. Recorded for Task 4 as a candidate variant; it is not built here because the guidance leave-one-out has to show the floor is the cause first.",
    "F4: the reviewer reads the evidence as leaning not-needed (oracle-recoverable failures are read-time by definition). The first pass keeps 'unmeasured' without a lean: a failure the oracle recovers is recoverable by delivery, but whether retrieval can deliver it is exactly the unmeasured read-time residual.",
  ],
});

/** Structural Task 2 hand-offs, decided explicitly (plan 210 Task 3 criterion). */
export const STRUCTURAL = Object.freeze([
  {
    id: "lifecycle-project-only",
    finding:
      "The package's per-turn lifecycle (uses, co-reads, retrievals, evidence) runs on the project lifecycle only; user- and agent-scope notes never build R, S or verification by use.",
    decision:
      "fix-and-measure, and not a contract change: maintenance already keeps a clock per scope (scopeClock per memory, maintain.ts), so routing each use to the lifecycle of the scope that owns the cited note is package-internal. It is a correctness fix, not only a ranking one: archiving is strength-based, so a user-scope preference cited every session still looks unused and can be archived. Prediction (offline, coding lifecycle persona with scripted citations): a cited user note goes from 0 to >= 2 use sessions, and age-archived cited user notes go to 0. No change on single-scope suites. Built in Task 5's preparation, before the strength-prior arm.",
    rows: ["retrieval.strength-priors", "lifecycle.widen-narrow", "lifecycle.verification", "scope.user", "scope.agent"],
  },
  {
    id: "verification-no-eligible-notes",
    finding: "Use-based verification needs candidate notes, and both presets leave promotion off.",
    decision: "no-credible-path as a general stage (see lifecycle.verification); it returns only inside a built Task 17 remedy.",
    rows: ["lifecycle.verification"],
  },
  {
    id: "weak-tool-caller-one-question",
    finding: "The switch cannot fire in one-question sessions (49% of replayed multi-turn turns).",
    decision: "measure-elsewhere on the multi-turn assistant rows with a small model; no one-question suite may score it.",
    rows: ["delivery.weak-tool-caller"],
  },
  {
    id: "maintenance-archives-raw-exchanges",
    finding: "One memory:maintain archived 29 of 293 raw exchanges (LongMemEval-M replay) and 73 of 94 (BEAM-100K).",
    decision:
      "The strength-based archive rule should not apply to raw exchanges: passive delivery records no use, so low R and S there mean only 'old'. fix-and-measure the exchange exemption (lifecycle.archive-revival). Campaigns: every Task 5 arm runs without maintenance, as all earlier evidence did, except the one maintain-then-answer arm that scores the exemption.",
    rows: ["lifecycle.archive-revival", "lifecycle.exchange-capacity", "lifecycle.maintain"],
  },
  {
    id: "capture-needs-archive",
    finding: "rules.capture depends on the exchange archive.",
    decision:
      "Keep the dependency (the archive is a `benefit` row in both presets) and make it fail closed: config validation rejects `rules.capture` other than \"off\" without `exchanges`, replacing Task 2's warning. Implemented with Task 7's changes if capture survives Task 6.",
    rows: ["delivery.rule-capture"],
  },
  {
    id: "episode-views-unreachable",
    finding: "Episode views are unreachable from the package; episode merge cannot fire under either preset.",
    decision: "no-credible-path: remove the view and episode merge rather than wire an observational source into the package.",
    rows: ["kind.episode", "lifecycle.episode-merge"],
  },
  {
    id: "rare-list",
    finding:
      "Rare (< 1% of eligible units): verification, capacity eviction, duplicate merge, episode merge, widen/narrow, rule capture, working memory, decision kind, lessons, exchange steps.",
    decision:
      "Rarity alone removes nothing. Three are rare because the scripted replays never call tools or cite (lessons, exchange steps, decision kind): they are measured on the work rows. Five are rare by design and dominated or unreachable (duplicate merge, episode merge, working memory, verification, widening): no-credible-path. Capacity eviction and capture are measured elsewhere.",
    rows: [
      "lifecycle.verification",
      "lifecycle.capacity-eviction",
      "lifecycle.duplicate-merge",
      "lifecycle.episode-merge",
      "lifecycle.widen-narrow",
      "delivery.rule-capture",
      "delivery.working-memory",
      "kind.decision",
      "lessons",
      "write.exchange-steps",
    ],
  },
]);
