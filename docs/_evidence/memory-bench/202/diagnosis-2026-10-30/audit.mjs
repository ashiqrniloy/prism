import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadDataset, normalizeDataset, selectQuestions } from "../../../../../scripts/memory-bench/datasets.mjs";
import { historicalSessionEntries, sessionRounds, extractEvidence } from "../../../../../scripts/memory-bench/replay.mjs";
import { exchangePairs, createExchangeArchive } from "../../../../../packages/memory/fabric/src/exchanges.ts";
import { pairedAnalysis } from "../../../../../scripts/memory-bench/stats.mjs";
const base = "docs/_evidence/memory-bench/202/";
const closurePath = base + "muse13-screen-closure.json";
const closureBefore = await readFile(closurePath, "utf8");
assert.equal(JSON.parse(closureBefore).status, "closed-by-owner");
const manifest = JSON.parse(await readFile(base + "muse13-screen-final/manifest.json", "utf8"));
const reports = [];
for (const rec of manifest.reports) {
  const bytes = await readFile(rec.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), rec.sha256);
  reports.push(JSON.parse(bytes));
}
const audit = {
  kind: "202-memory-efficacy-diagnosis",
  generatedAt: new Date().toISOString(),
  liveCalls: 0,
  sourceReportHashesVerified: 23,
  suites: [],
  fitComparisons: [],
  cohort: [],
  limitations: [
    "Retrospective development analysis; no new significance or acceptance claim",
    "Evidence ids do not prove the labelled facts survived excerpt rendering",
    "Candidate and selected pools are not separately instrumented",
    "All-phase final answers, recall query arguments and delivered excerpts were not saved; causal replay of those exact outputs is unavailable",
  ],
};
for (const suite of ["beam-100k", "locomo", "memoryagentbench-cr", "longmemeval-m", "beam-1m"]) {
  const memory = reports.find((r) => r.suite === suite && r.config === "fabric-x-tools");
  const full = reports.find((r) => r.suite === suite && r.config === "full");
  const passive = reports.find((r) => r.suite === suite && r.config === "fabric-x");
  const rows = memory.results;
  const stageCounts = {};
  for (const row of rows)
    stageCounts[row.stage ?? row.outcome ?? "unknown"] = (stageCounts[row.stage ?? row.outcome ?? "unknown"] ?? 0) + 1;
  const fit = full.results.filter(
    (r) =>
      r.contextEligibility?.eligible === true &&
      r.contextEligibility?.completeHistory === true &&
      r.contextEligibility?.removedSourceMessages === 0 &&
      typeof r.correct === "boolean",
  );
  const wanted = new Set(fit.map((r) => r.id));
  const a = rows.filter((r) => wanted.has(r.id));
  assert.equal(a.length, fit.length);
  assert(a.every((r) => typeof r.correct === "boolean"));
  const pairs = pairedAnalysis(fit, a);
  assert(Math.abs(pairs.diff - (a.filter((r) => r.correct).length / a.length - fit.filter((r) => r.correct).length / fit.length)) < 1e-9);
  audit.fitComparisons.push({
    suite,
    n: fit.length,
    memoryCorrect: a.filter((r) => r.correct).length,
    fullCorrect: fit.filter((r) => r.correct).length,
    memoryAccuracy: a.filter((r) => r.correct).length / a.length,
    fullAccuracy: fit.filter((r) => r.correct).length / fit.length,
    ...pairs,
    validMemoryIngest: suite !== "memoryagentbench-cr",
    interpretation:
      suite === "memoryagentbench-cr"
        ? "Invalid memory exposure: user-only source cannot form completed exchange pairs"
        : "Retrospective identical-id context-eligible subset only; not a whole-suite estimate when filtered",
  });
  audit.cohort.push({
    suite,
    questionIds: fit.map((r) => r.id),
    validForCurrentEfficacy: suite !== "memoryagentbench-cr",
    selection: "Full-history eligibility only; not answer correctness",
  });
  audit.suites.push({
    suite,
    questions: rows.length,
    memoryCorrect: rows.filter((r) => r.correct).length,
    passiveCorrect: passive.results.filter((r) => r.correct).length,
    stages: stageCounts,
    explicitRecallQuestions: rows.filter((r) => r.turnTrace?.includes("memory.recall")).length,
    automaticRecallCountedInRecallCalls: true,
    candidateCountsIdenticalToSelected: rows.every((r) => r.evidenceCounts?.candidateGold === r.evidenceCounts?.selectedGold),
    runLimits: rows.filter((r) => r.outcome === "run_limit").length,
    lexicalRetrieval: memory.memoryConfig.fabric.retrieval,
    promotionEnabled: memory.memoryConfig.fabric.promote.enabled,
  });
}
const mab = selectQuestions(normalizeDataset(await loadDataset("memoryagentbench-cr"), "memoryagentbench-cr"), "memoryagentbench-cr", {
  subset: "dev",
});
assert.equal(mab.length, 20);
let sessionCount = 0,
  pairs = 0,
  messages = 0,
  assistantMessages = 0;
for (const q of mab)
  for (const group of historicalSessionEntries(q.sessions, "audit")) {
    sessionCount++;
    messages += group.entries.length;
    assistantMessages += group.entries.filter((e) => e.message.role === "assistant").length;
    pairs += exchangePairs(group.entries).length;
  }
assert.equal(pairs, 0);
assert.equal(assistantMessages, 0);
let rememberCalls = 0;
const archive = createExchangeArchive({
  remember: async () => {
    rememberCalls++;
    throw new Error("Should not store a completed exchange");
  },
  maxTextChars: 16384,
  scope: "project",
});
const sample = historicalSessionEntries(mab[0].sessions, "audit")[0];
const archived = await archive.entries(sample.entries);
assert.equal(archived.archived, 0);
assert.equal(rememberCalls, 0);
audit.mabIngest = {
  questions: mab.length,
  sessionInstances: sessionCount,
  messages,
  assistantMessages,
  completedExchangePairs: pairs,
  archiveSample: archived,
  rememberCalls,
  diagnosis: "Confirmed adapter/archive contract mismatch; memory receives no historical exchange notes",
};
const locomo = selectQuestions(normalizeDataset(await loadDataset("locomo"), "locomo"), "locomo", { subset: "dev" });
const lm = reports.find((r) => r.suite === "locomo" && r.config === "fabric-x-tools");
let affected = 0;
const mapped = [];
for (const q of locomo) {
  const rounds = q.sessions.flatMap((s, i) => sessionRounds(s, i));
  const evidence = extractEvidence(q, rounds);
  const roundIds = new Set(rounds.map((r) => r.id));
  const row = lm.results.find((r) => r.id === q.id);
  if (evidence.fineGoldIds.size && [...evidence.fineGoldIds].every((id) => !roundIds.has(id))) {
    affected++;
    const recalled = new Set(row.recalledIds);
    const correctedGold = [...evidence.messageEvidenceRounds];
    mapped.push({
      id: q.id,
      correct: row.correct,
      reportedStage: row.stage,
      reportedFineRecall: row.fineEvidenceRecall,
      mappedRoundCoverage: correctedGold.filter((id) => recalled.has(id)).length / correctedGold.length,
      allLabelledRoundsRecalled: correctedGold.every((id) => recalled.has(id)),
    });
  }
}
assert.equal(affected, 60);
audit.locomoGranularity = {
  affectedQuestions: affected,
  incorrectFineSelectionLabels: mapped.filter((r) => !r.correct && r.reportedStage === "fine_selection_gap").length,
  failedLabelledFineGapWithAllMappedRoundsRecalled: mapped.filter(
    (r) => !r.correct && r.reportedStage === "fine_selection_gap" && r.allLabelledRoundsRecalled,
  ).length,
  rows: mapped,
  diagnosis: "Fine gold retains message ids while recall reports round ids; reported zero fine recall is not a valid fine-grained metric",
};
assert.equal(await readFile(closurePath, "utf8"), closureBefore);
audit.ownerClosurePreserved = true;
await writeFile(base + "diagnosis-2026-10-30/audit.json", JSON.stringify(audit, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      suites: audit.suites,
      mab: audit.mabIngest,
      locomo: {
        affected,
        mislabelled: audit.locomoGranularity.incorrectFineSelectionLabels,
        allMapped: audit.locomoGranularity.failedLabelledFineGapWithAllMappedRoundsRecalled,
      },
      fit: audit.fitComparisons.map(({ suite, n, memoryCorrect, fullCorrect, diff, ci95, clusters, validMemoryIngest }) => ({
        suite,
        n,
        memoryCorrect,
        fullCorrect,
        diff,
        ci95,
        clusters,
        validMemoryIngest,
      })),
    },
    null,
    2,
  ),
);
