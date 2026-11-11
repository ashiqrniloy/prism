import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lexicalMatches, lexicalTerms } from "@arnilo/prism-memory-system/core";
import { createMarkdownMemoryStores } from "@arnilo/prism-memory-system/core/fabric";
import { createMemory, createLongTermMemory, parseMemoryNoteMetadata, resolveMemoryFabricConfig } from "@arnilo/prism-memory-system";
import { recallPeriod } from "../../packages/memory/system/src/ltm/context.ts";
import { fitInjection } from "../../packages/memory/system/src/ltm/excerpt.ts";
import { BENCH_SCOPE } from "./bench-scope.mjs";
import { DATASETS, loadDataset, MemoryBenchDatasetError, normalizeDataset, selectQuestions } from "./datasets.mjs";
import {
  BENCH_PROTOCOL_VERSION,
  causalSessions,
  EXCHANGE_ROUNDS_FILE,
  extractEvidence,
  ingestHaystackRounds,
  retrievalStage,
  sessionRounds,
  stageFromCounts,
} from "./replay.mjs";

const PROTOCOL = "delivery-stage-v2";
const CEILING_PROTOCOL = "ceiling-v2";
const RESTAGE_PROTOCOL = "stage-correction-v2";
const MULTI_SESSION_PROTOCOL = "multi-session-recall-v1";
/** Ranks at which a multi-session diagnostic reports "all needed rounds inside the top k". */
export const MULTI_SESSION_TOP_K = Object.freeze([10, 20]);
/** The shipped passive-injection defaults (plan 188.9 Task 5); diagnostics mirror the product. */
export const INJECT_DEFAULTS = Object.freeze({
  budgetTokens: 4000,
  topK: 12,
  minSimilarity: 0.2,
  minScore: 0.2,
  fullTextScore: 0.35,
});
const INJECT = INJECT_DEFAULTS;
const CANDIDATE_TOP_K = 32;

/**
 * The pre-declared Task 2 grid. It is frozen here, before any paid run, and `--ceiling` refuses the
 * held-out partition: every cell is measured on development only.
 */
export const CEILING_GRID = Object.freeze({
  budgetTokens: Object.freeze([600, 1500, 2000, 3000, 4000, 6000]),
  topK: Object.freeze([3, 6, 8, 12, 16]),
  minSimilarity: Object.freeze([0, 0.2, 0.35]),
  renderer: Object.freeze(["excerpt", "whole"]),
});

/** Budgets the M2 reproduction block reports, in tokens. */
const CEILING_EVIDENCE_BUDGETS = Object.freeze([600, 1500, 3000, 6000]);

/** Abilities the Task 5 rule sums evidence visibility over. */
const DELIVERY_ABILITIES = Object.freeze([
  "knowledge-update",
  "multi-session",
  "temporal-reasoning",
  "single-session-user",
  "single-session-assistant",
]);

/**
 * The opt-in injection defaults, derived from the committed ceiling evidence by the plan 188.9 Task 5
 * rule. The literal rule (cheapest cell with `S >= S* - 2` and abstention at or under the median) selects
 * no cell: abstention cost tracks the budget while `S* - 2` needs the largest budgets. The recorded
 * fallback anchors the per-turn cost at the acceptance criterion's ~4,000 tokens, takes the best
 * `S` at that cost whose per-ability answer visibility does not fall below the 600/3/0.35 control,
 * and then the cheapest cell in that band. `S` is the sum of all-needed-visible over five abilities.
 */
export function chooseDeliveryDefaults(report) {
  const cells = (report?.cells ?? []).filter((cell) => cell.renderer === "excerpt");
  const control = cells.find((cell) => cell.budgetTokens === 600 && cell.topK === 3 && cell.minSimilarity === 0.35);
  if (!control) throw new Error("delivery defaults: the 600/3/0.35 control cell is missing from the evidence");
  const s = (cell) => DELIVERY_ABILITIES.reduce((sum, ability) => sum + (cell.byAbility?.[ability]?.allNeededVisible ?? 0), 0);
  const guard = (cell) =>
    DELIVERY_ABILITIES.every(
      (ability) => (cell.byAbility?.[ability]?.answerMessageVisible ?? 0) >= (control.byAbility?.[ability]?.answerMessageVisible ?? 0),
    );
  const anchored = cells.filter((cell) => cell.budgetTokens === 4000 && guard(cell));
  if (anchored.length === 0) throw new Error("delivery defaults: no 4,000-token cell passes the visibility guard");
  const best = Math.max(...anchored.map(s));
  const [chosen] = anchored
    .filter((cell) => s(cell) === best)
    .sort((a, b) => a.tokensMean - b.tokensMean || a.minSimilarity - b.minSimilarity);
  if (!chosen) throw new Error("delivery defaults: the evidence does not select a cell");
  return Object.freeze({ budgetTokens: chosen.budgetTokens, topK: chosen.topK, minSimilarity: chosen.minSimilarity });
}

export function ceilingCells(grid = CEILING_GRID) {
  const cells = [];
  for (const budgetTokens of grid.budgetTokens)
    for (const topK of grid.topK)
      for (const minSimilarity of grid.minSimilarity)
        for (const renderer of grid.renderer) cells.push({ budgetTokens, topK, minSimilarity, renderer });
  return cells;
}

function parseArgs(argv) {
  const options = {
    suite: "longmemeval-s",
    subset: "base",
    output: "docs/_evidence/memory-bench/188.7/retrieval-diagnostics.json",
  };
  const stringFlags = new Set(["--suite", "--subset", "--failed-report", "--output", "--renderer", "--restage", "--store-from"]);
  const booleanFlags = new Set(["--ceiling", "--multi-session"]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (booleanFlags.has(flag)) {
      options[flag.slice(2)] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!stringFlags.has(flag) || value === undefined) throw new Error(`retrieval diagnostics: unknown or incomplete argument ${flag}`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    i += 1;
  }
  return options;
}

/** One rendered whole-note line; only its length is ever published. */
function wholeNoteLine(hit) {
  return `- [${hit.id}] ${hit.level ?? "project"} ${hit.kind} (${hit.ingestedAt.slice(0, 10)})${hit.tRef ? ` tRef=${hit.tRef}` : ""} ${hit.content}`;
}

/**
 * Pre-fix whole-note delivery, mirrored from 1400917's context.ts, so the before arm's delivery
 * stage is measured with the renderer it actually shipped. Rendered lines never leave this grader.
 */
export function wholeNoteInjection(hits, budgetTokens = INJECT.budgetTokens, topK = INJECT.topK) {
  const lines = ["Cite the ids you use as [id]."];
  const shown = [];
  let chars = lines[0].length;
  for (const hit of hits) {
    if (shown.length >= topK) break;
    const line = wholeNoteLine(hit);
    // Pre-fix rule: the best hit is always shown; later hits must fit the snippet budget.
    if (chars + 1 + line.length > budgetTokens * 4 && shown.length > 0) continue;
    shown.push(hit);
    lines.push(line);
    chars += 1 + line.length;
  }
  return { ids: shown.map((hit) => hit.id), lines: lines.slice(1), tokens: shown.length ? Math.ceil(chars / 4) : 0 };
}

/** The shipped passive-injection rendering decision itself; rendered lines never leave this grader. */
export function selectInjection(
  hits,
  query,
  budgetTokens = INJECT.budgetTokens,
  topK = INJECT.topK,
  renderer = "excerpt",
  eligibleCount = Array.isArray(hits) ? hits.length : 0,
  minScore = INJECT.minScore,
  fullTextScore = INJECT.fullTextScore,
) {
  if (renderer === "whole") return wholeNoteInjection(hits, budgetTokens, topK);
  // The product passes the count left after its active/duplicate filters; the mirror passes the
  // ranking it was given, so both agree on whether the block was cut and on the cue text.
  const fitted = fitInjection(hits, lexicalTerms(query), budgetTokens, topK, eligibleCount, minScore, fullTextScore);
  return { ids: fitted.hits.map((hit) => hit.id), lines: fitted.lines.slice(1), tokens: fitted.tokens };
}

/** Gold is used only after recall; rendered text and message offsets never leave this grader. */
export function deliveryMetrics({
  question,
  query,
  hits,
  rounds,
  fine,
  renderer = "excerpt",
  budgetTokens = INJECT.budgetTokens,
  topK = INJECT.topK,
}) {
  const selected = selectInjection(hits, query, budgetTokens, topK, renderer);
  const queryTerms = lexicalTerms(query);
  const questionTerms = lexicalTerms(question.question);
  const nonQuestionTerms = [...queryTerms].filter((term) => !questionTerms.has(term)).length;
  const ids = hits.map((hit) => hit.id);
  const allIn = (visible) => fine.size > 0 && [...fine].every((id) => visible.includes(id));
  const { lines } = selected;
  const messages = rounds.flatMap((round) => round.messages.filter((message) => message.hasAnswer));
  return {
    queryTermCount: queryTerms.size,
    nonQuestionTerms,
    nonQuestionTermShare: queryTerms.size ? nonQuestionTerms / queryTerms.size : 0,
    fineEvidenceRanks: [...fine].map((id) => ({ id, rank: ids.includes(id) ? ids.indexOf(id) + 1 : null })),
    allNeededAt: Object.fromEntries([1, 3, 5, 10, 20].map((k) => [k, allIn(ids.slice(0, k))])),
    allNeededVisible: allIn(selected.ids),
    // A coarse round hit is insufficient: require a whole labelled message in a rendered line.
    answerMessageVisible: messages.some((message) => {
      const text = message.text.trim();
      return text.length > 0 && lines.some((line) => line.indexOf(text) >= 0);
    }),
    answerMessages: messages.length,
    tokens: selected.tokens,
  };
}

export function stageSummary(rows) {
  const byStage = {};
  const byAbility = {};
  for (const row of rows) {
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const ability = (byAbility[row.ability] ??= {
      n: 0,
      byStage: {},
      allNeededVisible: 0,
      answerMessageVisible: 0,
      allNeededAt: {},
      questionOnlyAllNeededAt: {},
      questionOnlyRankAllNeededAt: {},
      queryTerms: 0,
      nonQuestionTerms: 0,
      selectedRounds: 0,
    });
    ability.n += 1;
    ability.allNeededVisible += Number(row.allNeededVisible);
    ability.answerMessageVisible += Number(row.answerMessageVisible);
    ability.queryTerms += row.queryTermCount;
    ability.nonQuestionTerms += row.nonQuestionTerms;
    ability.selectedRounds += row.selectedRounds;
    for (const k of [1, 3, 5, 10, 20]) {
      ability.allNeededAt[k] = (ability.allNeededAt[k] ?? 0) + Number(row.allNeededAt[k]);
      ability.questionOnlyAllNeededAt[k] = (ability.questionOnlyAllNeededAt[k] ?? 0) + Number(row.questionOnlyAllNeededAt[k]);
      ability.questionOnlyRankAllNeededAt[k] = (ability.questionOnlyRankAllNeededAt[k] ?? 0) + Number(row.questionOnlyRankAllNeededAt[k]);
    }
    ability.byStage[row.stage] = (ability.byStage[row.stage] ?? 0) + 1;
  }
  return { byStage, byAbility };
}

/**
 * Plan 188.9 Task 9: diagnose a store the product write path built (`--store-from <snapshot dir>`),
 * offline, instead of re-ingesting rounds directly. The snapshot carries the producer's exchange
 * note id → round id map, because an exchange note id embeds a per-run session id. Exchange hits are
 * folded back to their round before evidence matching, so stage attribution stays round-grained.
 */
async function openProductStore(questionId, storeFrom, root, options) {
  const snapshot = join(storeFrom, encodeURIComponent(questionId));
  if (!existsSync(snapshot)) throw new MemoryBenchDatasetError(`no product store snapshot for ${questionId}`);
  await cp(snapshot, root, { recursive: true, force: true });
  const indexFile = join(root, EXCHANGE_ROUNDS_FILE);
  const exchangeRounds = existsSync(indexFile) ? new Map(Object.entries(JSON.parse(await readFile(indexFile, "utf8")))) : new Map();
  const stores = await createMarkdownMemoryStores({ root: join(root, "notes") });
  const kinds = ["fact", "exchange"];
  const config = resolveMemoryFabricConfig({ retrieval: "lexical", inject: { query: "task", kinds } });
  const { scopes: _scopes, tools: _tools, store: _store, ...fabricOptions } = config;
  const memory = createMemory({ ...BENCH_SCOPE, vectorStore: stores.vectorStore });
  const fabric = createLongTermMemory({ memory, vectorStore: stores.vectorStore, ...fabricOptions });
  const toRound = (hits) => hits.map((hit) => (exchangeRounds.has(hit.id) ? { ...hit, id: exchangeRounds.get(hit.id) } : hit));
  // Fact notes link their evidence with relation "evidence" to exchange-note ids, not round ids.
  const factRound = (noteId) => exchangeRounds.get(noteId);
  return { stores, fabric, kinds, toRound, factRound, product: true, renderer: options.renderer };
}

export async function diagnoseRetrieval(options) {
  // A diagnostic reads gold evidence, so it can never run against the live held-out draw.
  if (options.subset?.startsWith("heldout"))
    throw new MemoryBenchDatasetError("diagnostics read gold evidence, so they refuse the held-out v3 draw");
  const answers = options.failedReport ? JSON.parse(await readFile(options.failedReport, "utf8")).results : null;
  const answersById = new Map((answers ?? []).map((row) => [row.id, row]));
  const questions = selectQuestions(
    normalizeDataset(
      await loadDataset(options.suite, {
        fetch() {
          throw new Error("Offline diagnostic requires the cached pinned dataset");
        },
      }),
      options.suite,
    ),
    options.suite,
    {
      subset: options.subset,
    },
  );
  const rows = [];
  for (const question of questions) {
    const root = await mkdtemp(join(tmpdir(), "prism-retrieval-diagnostics-"));
    const rounds = causalSessions(question).flatMap((session, index) => sessionRounds(session, index));
    const evidence = extractEvidence(question, rounds);
    // Coarse stage: the labelled answer session. Fine message gold is reported separately so a
    // missing round inside a retrieved session is not confused with losing the whole session.
    const gold = evidence.answerSessionRounds.size
      ? evidence.answerSessionRounds
      : evidence.messageEvidenceRounds.size
        ? evidence.messageEvidenceRounds
        : evidence.answerTextRounds;
    const fine = evidence.messageEvidenceRounds;
    const correct = answersById.get(question.id)?.correct;
    const period = recallPeriod(question.question.slice(0, 2000), question.date);
    const query = period.text;
    try {
      const product = options.storeFrom ? await openProductStore(question.id, options.storeFrom, root, options) : null;
      const stores = product?.stores ?? (await createMarkdownMemoryStores({ root: join(root, "notes") }));
      if (product === null) await ingestHaystackRounds(rounds, stores, null);
      const memory = createMemory({ ...BENCH_SCOPE, vectorStore: stores.vectorStore });
      const kinds = product?.kinds ?? ["episode", "fact", "file"];
      const config = resolveMemoryFabricConfig({ retrieval: "lexical", inject: { query: "task", kinds } });
      const { scopes: _scopes, tools: _tools, store: _store, ...fabricOptions } = config;
      const fabric = product?.fabric ?? createLongTermMemory({ memory, vectorStore: stores.vectorStore, ...fabricOptions });
      const recallOptions = {
        kinds,
        minSimilarity: 0.35,
        topK: CANDIDATE_TOP_K,
        archiveSearch: false,
      };
      const toRound = product?.toRound ?? ((hits) => hits);
      const result = { ...(await fabric.recall(query, { ...recallOptions, ...period.options })) };
      result.hits = toRound(result.hits);
      // Retain the baseline ranking ablations without period filtering.
      const questionOnly = { ...(await fabric.recall(question.question, recallOptions)) };
      questionOnly.hits = toRound(questionOnly.hits);
      const questionOnlyRank = { ...(await fabric.recall(question.question, { ...recallOptions, minSimilarity: 0 })) };
      questionOnlyRank.hits = toRound(questionOnlyRank.hits);
      const selected = selectInjection(result.hits, query, INJECT.budgetTokens, INJECT.topK, options.renderer);
      const candidateIds = result.hits.map((hit) => hit.id);
      const selectedGold = selected.ids.filter((id) => gold.has(id));
      const selectedFine = selected.ids.filter((id) => fine.has(id));
      const bestGoldRank = result.hits.findIndex((hit) => gold.has(hit.id));
      const bestFineRank = result.hits.findIndex((hit) => fine.has(hit.id));
      const delivery = deliveryMetrics({ question, query, hits: result.hits, rounds, fine, renderer: options.renderer });
      const clean = deliveryMetrics({
        question,
        query: question.question,
        hits: questionOnly.hits,
        rounds,
        fine,
        renderer: options.renderer,
      });
      const rankOnly = deliveryMetrics({
        question,
        query: question.question,
        hits: questionOnlyRank.hits,
        rounds,
        fine,
        renderer: options.renderer,
      });
      rows.push({
        id: question.id,
        ability: question.ability,
        candidateGapMeasure: "needed-rounds-never-returned-by-any-tool",
        toolSurfacing: answersById.get(question.id)?.evidenceCounts?.toolSurfacing ?? null,
        answerCorrect: correct,
        outcome: answersById.get(question.id)?.outcome,
        labelSource: evidence.labelSource,
        unknownSourceReferences: evidence.unknownSourceReferences.length,
        ...delivery,
        questionOnlyAllNeededAt: clean.allNeededAt,
        questionOnlyRankAllNeededAt: rankOnly.allNeededAt,
        periodFiltered: period.options.tRef !== undefined,
        goldRounds: gold.size,
        candidateRounds: candidateIds.length,
        candidateGold: candidateIds.filter((id) => gold.has(id)).length,
        bestGoldRank,
        fineRounds: fine.size,
        bestFineRank,
        selectedGold: selectedGold.length,
        selectedFine: selectedFine.length,
        selectedRounds: selected.ids.length,
        selectedTokens: selected.tokens,
        stage: retrievalStage({
          outcome: answersById.get(question.id)?.outcome,
          ability: question.ability,
          unknownSourceReferences: evidence.unknownSourceReferences.length,
          goldRounds: gold,
          candidateRounds: candidateIds,
          selectedRounds: selected.ids,
          fineGoldRounds: [...fine],
          fineSelectedRounds: selectedFine,
          correct,
        }),
      });
      await stores.close();
    } catch (error) {
      // A round the product cannot store cannot be delivered either: record the question as
      // stored-nothing instead of aborting the whole diagnostic.
      const empty = deliveryMetrics({
        question,
        query,
        hits: [],
        rounds,
        fine,
        renderer: options.renderer,
      });
      rows.push({
        id: question.id,
        ability: question.ability,
        answerCorrect: correct,
        outcome: answersById.get(question.id)?.outcome,
        labelSource: evidence.labelSource,
        unknownSourceReferences: evidence.unknownSourceReferences.length,
        ...empty,
        questionOnlyAllNeededAt: empty.allNeededAt,
        questionOnlyRankAllNeededAt: empty.allNeededAt,
        periodFiltered: period.options.tRef !== undefined,
        goldRounds: gold.size,
        candidateRounds: 0,
        candidateGold: 0,
        bestGoldRank: -1,
        fineRounds: fine.size,
        bestFineRank: -1,
        selectedGold: 0,
        selectedFine: 0,
        selectedRounds: 0,
        selectedTokens: 0,
        storeError: String(error.name ?? "Error")
          .replace(/[^A-Za-z0-9_:-]/g, "")
          .slice(0, 60),
        stage: answersById.get(question.id)?.outcome === "run_limit" ? "run_limit" : "store_error",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const sourceReport = options.failedReport
    ? createHash("sha256")
        .update(await readFile(options.failedReport))
        .digest("hex")
    : null;
  return {
    schemaVersion: 2,
    protocol: PROTOCOL,
    candidateGapMeasure: "needed-rounds-never-returned-by-any-tool",
    toolSurfacingSummary: {
      observedQuestions: rows.filter((row) => row.toolSurfacing != null).length,
      questionsWithCandidateGap: rows.filter((row) => row.toolSurfacing?.candidateGap === true).length,
      neverSurfacedRounds: rows.reduce((total, row) => total + (row.toolSurfacing?.neverSurfaced ?? 0), 0),
    },
    protocolVersion: BENCH_PROTOCOL_VERSION,
    suite: options.suite,
    subset: options.subset,
    dataset: DATASETS[options.suite]?.sha256 ?? null,
    sourceReport,
    partition: ["confirmatory", "development"].includes(options.subset) ? "development" : options.subset,
    referenceTime: "question.date",
    questionOnlyAblation: "question text only; no recallPeriod; minSimilarity 0.35",
    questionOnlyRankAblation: "question text only; no recallPeriod; minSimilarity 0 (ranking without coverage floor)",
    visibility:
      "allNeeded requires nonempty fine message evidence; answerMessageVisible requires any complete has_answer message in a rendered line; no fine labels means allNeeded is false; dataset has_answer flags are retained even on abstention",
    query: "question-only",
    injection: INJECT,
    injectionRenderer: options.renderer ?? "excerpt",
    storeSource: options.storeFrom === undefined ? "direct-ingest" : "product-snapshot",
    candidateTopK: CANDIDATE_TOP_K,
    questions: rows.length,
    summary: stageSummary(rows),
    rows,
  };
}

/**
 * Plan 188.10 Task 3: which lever a multi-session failure needs. Reachability separates "the round
 * shares no word with the question" (write-time category terms) from "it is reachable but ranked
 * below the delivered window" (read-time phrasings), and the fact view separates "no fact covers the
 * round" from "the covering fact was superseded or retired" (instance-safe keys). Ids, ranks, counts
 * and booleans only: no question, gold, note or round text can leave here.
 */
export async function multiSessionDiagnostic(options) {
  if (options.subset?.startsWith("heldout"))
    throw new MemoryBenchDatasetError("diagnostics read gold evidence, so they refuse the held-out v3 draw");
  if (options.storeFrom === undefined)
    throw new MemoryBenchDatasetError("--multi-session needs --store-from <snapshot dir>: the indicted store is the product one");
  if (!existsSync(options.storeFrom)) throw new MemoryBenchDatasetError(`no product store snapshot at ${options.storeFrom}`);
  // Tests pass a fixture; the CLI reads the frozen draw's multi-session ids.
  const selected =
    options.questions ??
    selectQuestions(
      normalizeDataset(
        await loadDataset(options.suite, {
          fetch() {
            throw new Error("Offline diagnostic requires the cached pinned dataset");
          },
        }),
        options.suite,
      ),
      options.suite,
      { subset: options.subset },
    );
  const questions = selected.filter((question) => question.ability === "multi-session");
  if (questions.length === 0) throw new MemoryBenchDatasetError(`subset ${options.subset} holds no multi-session id`);
  const rows = [];
  let factNotes = 0;
  for (const question of questions) {
    const root = await mkdtemp(join(tmpdir(), "prism-multi-session-diagnostics-"));
    try {
      const rounds = causalSessions(question).flatMap((session, index) => sessionRounds(session, index));
      const roundById = new Map(rounds.map((round) => [round.id, round]));
      const evidence = extractEvidence(question, rounds);
      const needed = [...evidence.messageEvidenceRounds].filter((id) => roundById.has(id)).sort();
      const period = recallPeriod(question.question.slice(0, 2000), question.date);
      const query = period.text;
      // A missing per-question snapshot throws here: a partial store would silently look like a loss.
      const product = await openProductStore(question.id, options.storeFrom, root, options);
      const scanned = await scanNotes(product.stores.vectorStore);
      factNotes += scanned.filter((row) => parseMemoryNoteMetadata(row.metadata)?.kind === "fact").length;
      const factsByRound = factCoverage(scanned, product.factRound, new Set(needed));
      const recallOptions = { kinds: product.kinds, topK: CANDIDATE_TOP_K, archiveSearch: false };
      const shipped = await product.fabric.recall(query, { ...recallOptions, minSimilarity: 0.35, ...period.options });
      const delivered = selectInjection(product.toRound(shipped.hits), query, INJECT.budgetTokens, INJECT.topK, options.renderer);
      // The uncapped question-only ranking: no period filter, no similarity floor, no delivery window.
      const ranked = await product.fabric.recall(question.question, { ...recallOptions, minSimilarity: 0 });
      const rankedIds = product.toRound(ranked.hits).map((hit) => hit.id);
      const rankById = new Map(rankedIds.map((id, index) => [id, index + 1]));
      const questionTerms = lexicalTerms(question.question);
      const deliveredIds = new Set(delivered.ids);
      const detail = needed.map((id) => {
        const facts = factsByRound.get(id) ?? { active: 0, superseded: 0 };
        return {
          id,
          rank: rankById.get(id) ?? null,
          reachable: lexicalMatches(questionTerms, lexicalTerms(roundById.get(id).text)).length > 0,
          activeFacts: facts.active,
          supersededFacts: facts.superseded,
        };
      });
      const allAt = (k) => detail.length > 0 && detail.every((round) => round.rank !== null && round.rank <= k);
      rows.push({
        id: question.id,
        neededRounds: detail.length,
        sessionsSpanned: new Set(needed.map((id) => roundById.get(id).sessionId)).size,
        reachableRounds: detail.filter((round) => round.reachable).length,
        allNeededAt: Object.fromEntries(
          [...MULTI_SESSION_TOP_K, "uncapped"].map((k) => [k, k === "uncapped" ? allAt(Infinity) : allAt(k)]),
        ),
        allNeededVisible: detail.length > 0 && detail.every((round) => deliveredIds.has(round.id)),
        rounds: detail,
        stage: retrievalStage({
          goldRounds: needed,
          candidateRounds: rankedIds,
          selectedRounds: delivered.ids,
          fineGoldRounds: needed,
          fineSelectedRounds: detail.filter((round) => deliveredIds.has(round.id)).map((round) => round.id),
        }),
      });
      await product.stores.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const byStage = {};
  for (const row of rows) byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
  const allRounds = rows.flatMap((row) => row.rounds);
  const stageQuestions = rows.filter((row) => row.stage === "partial_evidence").length;
  return {
    schemaVersion: 1,
    protocol: MULTI_SESSION_PROTOCOL,
    protocolVersion: BENCH_PROTOCOL_VERSION,
    suite: options.suite,
    subset: options.subset,
    dataset: DATASETS[options.suite]?.sha256 ?? null,
    partition: options.subset,
    referenceTime: "question.date",
    query: "question-only, recallPeriod applied; rank uses the question text with minSimilarity 0",
    injection: INJECT,
    injectionRenderer: options.renderer ?? "excerpt",
    storeSource: "product-snapshot",
    candidateTopK: CANDIDATE_TOP_K,
    reachableDefinition: "the needed round shares at least one stemmed non-stopword term with the question",
    rankDefinition: `1-based rank in the uncapped question-only lexical ranking (top ${CANDIDATE_TOP_K} candidates, minSimilarity 0); null = outside it`,
    activeFactDefinition:
      "a fact note linked to the round with relation evidence, status verified (or absent), not retired, archived or candidate, and not named by another note's supersedes",
    questions: rows.length,
    summary: {
      questions: rows.length,
      neededRounds: allRounds.length,
      sessionsSpanned: rows.reduce((sum, row) => sum + row.sessionsSpanned, 0),
      reachableRounds: allRounds.filter((round) => round.reachable).length,
      unreachableRounds: allRounds.filter((round) => !round.reachable).length,
      questionsAllReachable: rows.filter((row) => row.rounds.length > 0 && row.rounds.every((round) => round.reachable)).length,
      allNeededAt: Object.fromEntries(
        [...MULTI_SESSION_TOP_K, "uncapped"].map((k) => [k, rows.filter((row) => row.allNeededAt[k]).length]),
      ),
      passiveVisible: rows.filter((row) => row.allNeededVisible).length,
      partialEvidence: stageQuestions,
      byStage,
      facts: {
        notes: factNotes,
        linkedRounds: allRounds.filter((round) => round.activeFacts + round.supersededFacts > 0).length,
        activeRounds: allRounds.filter((round) => round.activeFacts > 0).length,
        supersessionLostRounds: allRounds.filter((round) => round.activeFacts === 0 && round.supersededFacts > 0).length,
        factsPerNeededRound: allRounds.length === 0 ? 0 : mean(allRounds.map((round) => round.activeFacts + round.supersededFacts)),
      },
    },
    rows,
  };
}

/** Metadata-only pages over one store root; a store without the capability reports no facts. */
async function scanNotes(vectorStore) {
  if (typeof vectorStore.scanMetadata !== "function") return [];
  const rows = [];
  let cursor;
  do {
    const page = await vectorStore.scanMetadata({
      scope: { tenantId: BENCH_SCOPE.tenantId, resourceId: BENCH_SCOPE.resourceId },
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return rows;
}

/**
 * Fact notes per needed round, split into still-active and superseded-or-retired. A fact is
 * superseded when another note names it in `supersedes`, so a keyed rewrite is visible even before
 * the lifecycle retires the old row.
 */
function factCoverage(scanned, factRound, needed) {
  const superseded = new Set();
  for (const row of scanned) {
    const metadata = parseMemoryNoteMetadata(row.metadata);
    if (metadata?.supersedes !== undefined) superseded.add(metadata.supersedes);
  }
  const byRound = new Map();
  for (const row of scanned) {
    const metadata = parseMemoryNoteMetadata(row.metadata);
    if (metadata?.kind !== "fact") continue;
    const status = metadata.status;
    const active = status !== "candidate" && status !== "archived" && status !== "retired" && !superseded.has(row.id);
    for (const link of metadata.links ?? []) {
      if (link.relation !== "evidence") continue;
      const round = factRound(link.id);
      if (round === undefined || !needed.has(round)) continue;
      const entry = byRound.get(round) ?? { active: 0, superseded: 0 };
      if (active) entry.active += 1;
      else entry.superseded += 1;
      byRound.set(round, entry);
    }
  }
  return byRound;
}

function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function histogram(rows, pick) {
  const counts = {};
  for (const row of rows) counts[pick(row)] = (counts[pick(row)] ?? 0) + 1;
  return counts;
}

/**
 * Re-bucket a committed diagnostic with the current classifier. Only ids, stages, counts and flags
 * are written: no question, answer, note or gold text can reach the correction.
 */
export function restageReport(sourceReport, { sourceSha256 = null } = {}) {
  if (sourceReport.subset?.startsWith("heldout")) throw new MemoryBenchDatasetError("stage correction refuses held-out evidence");
  const rows = sourceReport.rows.map((row) => ({
    id: row.id,
    ability: row.ability,
    correct: row.answerCorrect,
    outcome: row.outcome,
    labelSource: row.labelSource ?? "historical_heuristic",
    unknownSourceReferences: row.unknownSourceReferences ?? null,
    allNeededVisible: row.allNeededVisible === true,
    answerMessageVisible: row.answerMessageVisible === true,
    goldRounds: row.goldRounds,
    candidateGold: row.candidateGold,
    selectedGold: row.selectedGold,
    fineRounds: row.fineRounds,
    selectedFine: row.selectedFine,
    selectedRounds: row.selectedRounds,
    stageBefore: row.stage,
    // A stored round the product could not store is not a retrieval stage; keep it as recorded.
    stage:
      row.stage === "store_error" && !row.outcome
        ? "store_error"
        : stageFromCounts({
            outcome: row.outcome,
            ability: row.ability,
            unknownSourceReferences: row.unknownSourceReferences,
            goldRounds: row.goldRounds,
            candidateGold: row.candidateGold,
            selectedGold: row.selectedGold,
            fineRounds: row.fineRounds,
            fineSelected: row.selectedFine,
            correct: row.answerCorrect,
          }),
  }));
  return {
    schemaVersion: 1,
    kind: "stage-correction",
    protocol: RESTAGE_PROTOCOL,
    classifier: "partial_evidence when some but not all fine rounds are visible",
    sourceProtocol: sourceReport.protocol,
    sourceSha256,
    suite: sourceReport.suite,
    subset: sourceReport.subset,
    renderer: sourceReport.injectionRenderer ?? null,
    questions: rows.length,
    stagesBefore: histogram(rows, (row) => row.stageBefore),
    stagesAfter: histogram(rows, (row) => row.stage),
    rows,
  };
}

/**
 * The Task 2 ceiling grid on the development partition: one ingestion per question, one recall per
 * similarity floor, every cell rendered from those rankings. Held-out ids are refused before any
 * dataset read, so no cell can be chosen on held-out evidence.
 */
export async function ceilingScan(options) {
  if (options.storeFrom !== undefined)
    throw new MemoryBenchDatasetError("--ceiling measures the ingest baseline, so it cannot read a product store");
  if (options.subset !== "development")
    throw new MemoryBenchDatasetError(`--ceiling reads the development partition only, not ${options.subset}`);
  const questions = selectQuestions(
    normalizeDataset(
      await loadDataset(options.suite, {
        fetch() {
          throw new Error("Offline ceiling requires the cached pinned dataset");
        },
      }),
      options.suite,
    ),
    options.suite,
    { subset: options.subset },
  );
  const cells = ceilingCells().map((cell) => ({
    cell,
    tokens: [],
    abstentionTokens: [],
    allNeededVisible: 0,
    answerMessageVisible: 0,
    byAbility: {},
  }));
  const evidenceTokens = {};
  const candidateCoverage = {};
  let storeErrors = 0;
  for (const question of questions) {
    const root = await mkdtemp(join(tmpdir(), "prism-ceiling-"));
    const rounds = causalSessions(question).flatMap((session, index) => sessionRounds(session, index));
    const evidence = extractEvidence(question, rounds);
    const fine = evidence.messageEvidenceRounds;
    const period = recallPeriod(question.question.slice(0, 2000), question.date);
    const query = period.text;
    const abstention = question.ability === "abstention";
    try {
      const stores = await createMarkdownMemoryStores({ root: join(root, "notes") });
      await ingestHaystackRounds(rounds, stores, null);
      const memory = createMemory({ ...BENCH_SCOPE, vectorStore: stores.vectorStore });
      const config = resolveMemoryFabricConfig({ retrieval: "lexical", inject: { query: "task", kinds: ["episode", "fact", "file"] } });
      const { scopes: _scopes, tools: _tools, store: _store, ...fabricOptions } = config;
      const fabric = createLongTermMemory({ memory, vectorStore: stores.vectorStore, ...fabricOptions });
      const recallOptions = { kinds: ["episode", "fact", "file"], topK: CANDIDATE_TOP_K, archiveSearch: false };
      const rankings = new Map();
      for (const minSimilarity of CEILING_GRID.minSimilarity)
        rankings.set(minSimilarity, await fabric.recall(query, { ...recallOptions, minSimilarity, ...period.options }));
      const reference = rankings.get(0.35).hits;
      const needed = reference.filter((hit) => fine.has(hit.id));
      // M2 reproduction block, explicit definition: the whole-note tokens of ranks 1..deepest needed
      // round, reachable only when every fine round is inside the top-32 candidate ranking.
      const abilityTokens = (evidenceTokens[question.ability] ??= { n: 0, reachable: 0, tokens: [], visible: {} });
      abilityTokens.n += 1;
      if (fine.size > 0 && needed.length === fine.size) {
        const deepest = Math.max(...reference.map((hit, index) => (fine.has(hit.id) ? index : -1)));
        const tokens = reference.slice(0, deepest + 1).reduce((sum, hit) => sum + Math.ceil((wholeNoteLine(hit).length + 1) / 4), 0);
        abilityTokens.reachable += 1;
        abilityTokens.tokens.push(tokens);
        for (const budget of CEILING_EVIDENCE_BUDGETS)
          if (tokens <= budget) abilityTokens.visible[budget] = (abilityTokens.visible[budget] ?? 0) + 1;
      }
      // M3 reproduction block: every fine round inside the top-32 ranking, per similarity floor.
      const coverage = (candidateCoverage[question.ability] ??= { n: 0, visible: {} });
      coverage.n += 1;
      for (const [floor, ranking] of rankings) {
        const ids = new Set(ranking.hits.map((hit) => hit.id));
        if (fine.size > 0 && [...fine].every((id) => ids.has(id))) coverage.visible[floor] = (coverage.visible[floor] ?? 0) + 1;
      }
      for (const target of cells) {
        const { budgetTokens, topK, minSimilarity, renderer } = target.cell;
        const metrics = deliveryMetrics({
          question,
          query,
          hits: rankings.get(minSimilarity).hits,
          rounds,
          fine,
          renderer,
          budgetTokens,
          topK,
        });
        target.tokens.push(metrics.tokens);
        if (abstention) target.abstentionTokens.push(metrics.tokens);
        target.allNeededVisible += Number(metrics.allNeededVisible);
        target.answerMessageVisible += Number(metrics.answerMessageVisible);
        const ability = (target.byAbility[question.ability] ??= {
          n: 0,
          allNeededVisible: 0,
          answerMessageVisible: 0,
          tokens: [],
        });
        ability.n += 1;
        ability.allNeededVisible += Number(metrics.allNeededVisible);
        ability.answerMessageVisible += Number(metrics.answerMessageVisible);
        ability.tokens.push(metrics.tokens);
      }
      await stores.close();
    } catch (error) {
      storeErrors += 1;
      void error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return {
    schemaVersion: 1,
    protocol: CEILING_PROTOCOL,
    protocolVersion: BENCH_PROTOCOL_VERSION,
    suite: options.suite,
    subset: options.subset,
    dataset: DATASETS[options.suite]?.sha256 ?? null,
    partition: "development",
    questions: questions.length,
    grid: CEILING_GRID,
    cells: cells.map((target) => ({
      ...target.cell,
      n: target.tokens.length,
      allNeededVisible: target.allNeededVisible,
      answerMessageVisible: target.answerMessageVisible,
      tokensMean: mean(target.tokens),
      tokensP95: p95(target.tokens),
      abstentionTokensMean: abstentionMean(target.abstentionTokens),
      byAbility: Object.fromEntries(
        Object.entries(target.byAbility).map(([ability, value]) => [
          ability,
          {
            n: value.n,
            allNeededVisible: value.allNeededVisible,
            answerMessageVisible: value.answerMessageVisible,
            tokensMedian: median(value.tokens),
          },
        ]),
      ),
    })),
    evidenceBudget: Object.fromEntries(
      Object.entries(evidenceTokens).map(([ability, value]) => [
        ability,
        { n: value.n, reachable: value.reachable, tokensMedian: median(value.tokens), visible: value.visible },
      ]),
    ),
    evidenceBudgetDefinition:
      "all needed rounds inside the top-32 candidate ranking (floor 0.35) and the whole-note tokens of ranks 1..deepest needed round at most the budget",
    candidateCoverage: {
      definition: "all needed rounds inside the top-32 candidate ranking, per similarity floor",
      topK: CANDIDATE_TOP_K,
      byAbility: candidateCoverage,
    },
    storeErrors,
  };
}

function abstentionMean(values) {
  return values.length === 0 ? null : mean(values);
}

if (import.meta.main) {
  if (process.argv.slice(2).includes("--multi-session")) {
    const options = parseArgs(process.argv.slice(2));
    const report = await multiSessionDiagnostic(options);
    await mkdir(dirname(options.output), { recursive: true });
    const temp = `${options.output}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temp, options.output);
    console.log(`${report.questions} questions; stages ${JSON.stringify(report.summary.byStage)}; ${options.output}`);
  } else if (process.argv.slice(2).includes("--ceiling")) {
    const options = parseArgs(process.argv.slice(2));
    const report = await ceilingScan(options);
    await mkdir(dirname(options.output), { recursive: true });
    const temp = `${options.output}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temp, options.output);
    console.log(`${report.questions ?? report.cells[0]?.n} questions; ${report.cells.length} cells; ${options.output}`);
  } else if (process.argv.slice(2).includes("--restage")) {
    const options = parseArgs(process.argv.slice(2));
    // One committed diagnostic per arm; a comma-separated list re-buckets a whole campaign.
    const reports = [];
    for (const path of options.restage.split(",")) {
      const raw = await readFile(path);
      reports.push({
        source: path.replace(/^docs\/_evidence\/memory-bench\//, ""),
        ...restageReport(JSON.parse(raw), { sourceSha256: createHash("sha256").update(raw).digest("hex") }),
      });
    }
    const report = {
      schemaVersion: 1,
      kind: "stage-correction-set",
      protocol: RESTAGE_PROTOCOL,
      classifier: "partial_evidence when some but not all fine rounds are visible",
      dataset: DATASETS[options.suite]?.sha256 ?? null,
      reports,
    };
    await mkdir(dirname(options.output), { recursive: true });
    const temp = `${options.output}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temp, options.output);
    console.log(
      `${reports.length} diagnostics re-bucketed; ${reports.map((entry) => `${entry.source} ${JSON.stringify(entry.stagesAfter)}`).join("; ")}; ${options.output}`,
    );
  } else {
    const options = parseArgs(process.argv.slice(2));
    const report = await diagnoseRetrieval(options);
    await mkdir(dirname(options.output), { recursive: true });
    const temp = `${options.output}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temp, options.output);
    console.log(`${report.questions} questions; stages ${JSON.stringify(report.summary.byStage)}; ${options.output}`);
  }
}
