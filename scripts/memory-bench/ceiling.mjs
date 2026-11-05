#!/usr/bin/env bun
/**
 * Ceiling report (plan 210 Task 3.1). A score is only readable beside its ceiling: the same model, partition, judges
 * and rules with the gold evidence handed over (`--config oracle`). This reads the two run reports of one partition,
 * the recall arm and the oracle arm, and writes a counts-only report: totals, per ability, the wrong recall answers
 * by retrieval stage, judge ties, and the paired recall/oracle table. No question, reference or answer text enters it.
 *
 *   bun scripts/memory-bench/ceiling.mjs --recall recall.json --oracle oracle.json [--output ceiling.json]
 *
 * Produce the two reports with the same flags except `--config` (`fabric-x-tools` and `oracle`) on one model.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const scoredRows = (report) => (report?.results ?? []).filter((row) => typeof row.correct === "boolean");
const ties = (row) => new Set(Object.values(row.judgeVerdicts ?? {})).size > 1;

/** Where a wrong recall answer lost the evidence: never a candidate, a candidate not shown, or shown and still wrong. */
export function retrievalStage(row) {
  const counts = row.evidenceCounts ?? {};
  if ((counts.candidateGold ?? 0) === 0) return "neverCandidate";
  return (counts.selectedGold ?? 0) === 0 ? "candidateNotShown" : "shownToModel";
}

function byAbility(rows) {
  const out = {};
  for (const row of rows) {
    const cell = (out[row.ability ?? "unknown"] ??= { n: 0, correct: 0 });
    cell.n += 1;
    cell.correct += row.correct ? 1 : 0;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** The ceiling report of one recall run and one oracle run on the same questions. Pure; counts only. */
export function ceilingReport({ recall, oracle }) {
  const recallRows = scoredRows(recall);
  const oracleById = new Map(scoredRows(oracle).map((row) => [row.id, row]));
  const paired = recallRows.filter((row) => oracleById.has(row.id));
  if (!paired.length) throw new Error("MemoryBenchCeiling: the two reports share no scored question");
  const table = { recallRightOracleRight: 0, recallWrongOracleRight: 0, recallRightOracleWrong: 0, bothWrong: 0 };
  for (const row of paired) {
    const oracleRight = oracleById.get(row.id).correct;
    if (row.correct) table[oracleRight ? "recallRightOracleRight" : "recallRightOracleWrong"] += 1;
    else table[oracleRight ? "recallWrongOracleRight" : "bothWrong"] += 1;
  }
  const wrongByStage = {};
  for (const row of paired.filter((item) => !item.correct)) wrongByStage[retrievalStage(row)] = (wrongByStage[retrievalStage(row)] ?? 0) + 1;
  const recallCorrect = paired.filter((row) => row.correct).length;
  const oracleCorrect = paired.filter((row) => oracleById.get(row.id).correct).length;
  return {
    schemaVersion: 1,
    kind: "memory-ceiling-report",
    suite: recall.suite ?? null,
    model: recall.model ?? null,
    n: paired.length,
    unpairedDropped: recallRows.length - paired.length,
    recall: { correct: recallCorrect, share: recallCorrect / paired.length, byAbility: byAbility(paired) },
    oracle: {
      correct: oracleCorrect,
      share: oracleCorrect / paired.length,
      byAbility: byAbility(paired.map((row) => oracleById.get(row.id))),
    },
    gapPoints: Math.round(((oracleCorrect - recallCorrect) / paired.length) * 1000) / 10,
    paired: table,
    recallWrongByStage: wrongByStage,
    judgeTies: { recall: paired.filter(ties).length, oracle: paired.map((row) => oracleById.get(row.id)).filter(ties).length },
  };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { recall: { type: "string" }, oracle: { type: "string" }, output: { type: "string" } }, strict: true });
    if (!values.recall || !values.oracle) throw new Error("MemoryBenchArguments: --recall and --oracle are required");
    const report = ceilingReport({
      recall: JSON.parse(await readFile(values.recall, "utf8")),
      oracle: JSON.parse(await readFile(values.oracle, "utf8")),
    });
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (values.output) {
      await mkdir(dirname(values.output), { recursive: true });
      await writeFile(values.output, text);
    }
    console.log(
      `n=${report.n} recall=${report.recall.correct} oracle=${report.oracle.correct} gap=${report.gapPoints} points; ` +
        `memory-lost=${report.paired.recallWrongOracleRight} wrong-both=${report.paired.bothWrong}`,
    );
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
