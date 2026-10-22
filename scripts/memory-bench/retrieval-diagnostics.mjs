import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createMarkdownMemoryStores } from "@arnilo/prism-memory-core/fabric";
import { createMemory, createMemoryFabric, resolveMemoryFabricConfig } from "@arnilo/prism-memory-fabric";
import { BENCH_SCOPE } from "./bench-scope.mjs";
import { DATASETS, loadDataset, normalizeDataset, selectQuestions } from "./datasets.mjs";
import { causalSessions, extractEvidence, ingestHaystackRounds, retrievalStage, sessionRounds } from "./replay.mjs";

const PROTOCOL = "retrieval-stage-v1";
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
  let used = 0;
  for (const hit of hits) {
    const cost = Math.ceil(injectionLine(hit).length / 4);
    if (used + cost > budgetTokens && selected.length > 0) continue;
    selected.push(hit.id);
    used += cost;
    if (selected.length >= topK) break;
  }
  return { ids: selected, tokens: used };
}

export function stageSummary(rows) {
  const byStage = {};
  const byAbility = {};
  for (const row of rows) {
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const ability = (byAbility[row.ability] ??= { n: 0, byStage: {} });
    ability.n += 1;
    ability.byStage[row.stage] = (ability.byStage[row.stage] ?? 0) + 1;
  }
  return { byStage, byAbility };
}

export async function diagnoseRetrieval(options) {
  const failed = options.failedReport
    ? JSON.parse(await readFile(options.failedReport, "utf8")).results.filter((row) => row.correct === false)
    : null;
  const failedById = new Map((failed ?? []).map((row) => [row.id, row]));
  const questions = selectQuestions(normalizeDataset(await loadDataset(options.suite, {}), options.suite), options.suite, {
    subset: options.subset,
  }).filter((question) => failedById.size === 0 || failedById.has(question.id));
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
      const query = `Question date: ${question.date}\n${question.question}`;
      const result = await fabric.recall(query, {
        kinds: ["episode", "fact", "file"],
        minSimilarity: 0.35,
        topK: CANDIDATE_TOP_K,
        archiveSearch: false,
      });
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
      const correct = failedById.get(question.id)?.correct;
      rows.push({
        id: question.id,
        ability: question.ability,
        answerCorrect: correct,
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
    schemaVersion: 1,
    protocol: PROTOCOL,
    suite: options.suite,
    subset: options.subset,
    dataset: DATASETS[options.suite]?.sha256 ?? null,
    sourceReport,
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
