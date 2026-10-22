import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lexicalTerms } from "@arnilo/prism-memory-core";
import { createMarkdownMemoryStores } from "@arnilo/prism-memory-core/fabric";
import { createMemory, createMemoryFabric, resolveMemoryFabricConfig } from "@arnilo/prism-memory-fabric";
import { recallPeriod } from "../../packages/memory/fabric/src/context.ts";
import { BENCH_SCOPE } from "./bench-scope.mjs";
import { DATASETS, loadDataset, normalizeDataset, selectQuestions } from "./datasets.mjs";
import { causalSessions, extractEvidence, ingestHaystackRounds, retrievalStage, sessionRounds } from "./replay.mjs";

const PROTOCOL = "delivery-stage-v1";
// Freeze the old harness wall-clock reference for reproducible pre-fix period resolution.
const REFERENCE_TIME = "2026-10-22T00:00:00.000Z";
const INJECT = Object.freeze({ budgetTokens: 600, topK: 3 });
const CANDIDATE_TOP_K = 32;

function parseArgs(argv) {
  const options = {
    suite: "longmemeval-s",
    subset: "base",
    output: "docs/_evidence/memory-bench/188.7/retrieval-diagnostics.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--suite", "--subset", "--failed-report", "--output"].includes(flag) || value === undefined)
      throw new Error(`retrieval diagnostics: unknown or incomplete argument ${flag}`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    i += 1;
  }
  return options;
}

function injectionLine(hit) {
  return `- [${hit.id}] ${hit.level ?? "project"} ${hit.kind} (${hit.ingestedAt.slice(0, 10)})${hit.tRef ? ` tRef=${hit.tRef}` : ""} ${hit.content}`;
}

/** Mirrors the passive-injection loop, including its first-hit exception, without retaining text. */
export function selectInjection(hits, budgetTokens = INJECT.budgetTokens, topK = INJECT.topK) {
  const selected = [];
  let used = Math.ceil("Cite the ids you use as [id].".length / 4);
  for (const hit of hits) {
    const cost = Math.ceil(injectionLine(hit).length / 4);
    if (used + cost > budgetTokens && selected.length > 0) continue;
    selected.push(hit.id);
    used += cost;
    if (selected.length >= topK) break;
  }
  return { ids: selected, tokens: selected.length ? used : 0 };
}

/** Gold is used only after recall; rendered text and message offsets never leave this grader. */
export function deliveryMetrics({ question, query, hits, rounds, fine }) {
  const selected = selectInjection(hits);
  const queryTerms = lexicalTerms(query);
  const questionTerms = lexicalTerms(question.question);
  const nonQuestionTerms = [...queryTerms].filter((term) => !questionTerms.has(term)).length;
  const ids = hits.map((hit) => hit.id);
  const allIn = (visible) => fine.size > 0 && [...fine].every((id) => visible.includes(id));
  const lines = hits.filter((hit) => selected.ids.includes(hit.id)).map(injectionLine);
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

export async function diagnoseRetrieval(options) {
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
    try {
      const stores = await createMarkdownMemoryStores({ root: join(root, "notes") });
      const rounds = causalSessions(question).flatMap((session, index) => sessionRounds(session, index));
      await ingestHaystackRounds(rounds, stores, null);
      const memory = createMemory({ ...BENCH_SCOPE, vectorStore: stores.vectorStore, workingStore: stores.workingStore });
      const config = resolveMemoryFabricConfig({ retrieval: "lexical", inject: { query: "task", kinds: ["episode", "fact", "file"] } });
      const { scopes: _scopes, tools: _tools, store: _store, ...fabricOptions } = config;
      const fabric = createMemoryFabric({ memory, vectorStore: stores.vectorStore, ...fabricOptions });
      const prompt = `Question date: ${question.date}\n${question.question}`;
      const period = recallPeriod(prompt.slice(0, 2000), REFERENCE_TIME);
      const query = period.text;
      const recallOptions = {
        kinds: ["episode", "fact", "file"],
        minSimilarity: 0.35,
        topK: CANDIDATE_TOP_K,
        archiveSearch: false,
      };
      const result = await fabric.recall(query, { ...recallOptions, ...period.options });
      // Isolate the investigation's date-text ablation; no wall-clock period filter here.
      const questionOnly = await fabric.recall(question.question, recallOptions);
      const questionOnlyRank = await fabric.recall(question.question, { ...recallOptions, minSimilarity: 0 });
      const evidence = extractEvidence(question, rounds);
      // Coarse stage: the labelled answer session. Fine message gold is reported separately so a
      // missing round inside a retrieved session is not confused with losing the whole session.
      const gold = evidence.answerSessionRounds.size
        ? evidence.answerSessionRounds
        : evidence.messageEvidenceRounds.size
          ? evidence.messageEvidenceRounds
          : evidence.answerTextRounds;
      const fine = evidence.messageEvidenceRounds;
      const selected = selectInjection(result.hits);
      const candidateIds = result.hits.map((hit) => hit.id);
      const selectedGold = selected.ids.filter((id) => gold.has(id));
      const selectedFine = selected.ids.filter((id) => fine.has(id));
      const bestGoldRank = result.hits.findIndex((hit) => gold.has(hit.id));
      const bestFineRank = result.hits.findIndex((hit) => fine.has(hit.id));
      const correct = answersById.get(question.id)?.correct;
      const delivery = deliveryMetrics({ question, query, hits: result.hits, rounds, fine });
      const clean = deliveryMetrics({ question, query: question.question, hits: questionOnly.hits, rounds, fine });
      const rankOnly = deliveryMetrics({ question, query: question.question, hits: questionOnlyRank.hits, rounds, fine });
      rows.push({
        id: question.id,
        ability: question.ability,
        answerCorrect: correct,
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
          goldRounds: gold,
          candidateRounds: candidateIds,
          selectedRounds: selected.ids,
          fineGoldRounds: [...fine],
          fineSelectedRounds: selectedFine,
          correct,
        }),
      });
      await stores.close();
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
    suite: options.suite,
    subset: options.subset,
    dataset: DATASETS[options.suite]?.sha256 ?? null,
    sourceReport,
    partition: ["confirmatory", "development"].includes(options.subset) ? "development" : options.subset,
    referenceTime: REFERENCE_TIME,
    questionOnlyAblation: "question text only; no recallPeriod; minSimilarity 0.35",
    questionOnlyRankAblation: "question text only; no recallPeriod; minSimilarity 0 (ranking without coverage floor)",
    visibility:
      "allNeeded requires nonempty fine message evidence; answerMessageVisible requires any complete has_answer message in a rendered line; no fine labels means allNeeded is false; dataset has_answer flags are retained even on abstention",
    query: "benchmark-prompt",
    injection: INJECT,
    candidateTopK: CANDIDATE_TOP_K,
    questions: rows.length,
    summary: stageSummary(rows),
    rows,
  };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const report = await diagnoseRetrieval(options);
  await mkdir(dirname(options.output), { recursive: true });
  const temp = `${options.output}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temp, options.output);
  console.log(`${report.questions} questions; stages ${JSON.stringify(report.summary.byStage)}; ${options.output}`);
}
