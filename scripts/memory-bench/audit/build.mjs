#!/usr/bin/env bun
/**
 * Build the human judge-audit set (plan 202 Task 3). Reads an answer-phase report plus its local
 * answer cache, writes a self-contained review page under a local, gitignored directory. The page and
 * the answer cache carry text; the report, labels and audit key never do.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadDataset, normalizeDataset } from "../datasets.mjs";
import fixture from "../fixtures/synthetic.json" with { type: "json" };
import { createAnswerCache } from "../judge.mjs";
import { renderReviewPage, selectAuditItems } from "./review.mjs";

async function questionIndex(report, cacheDir) {
  const rows =
    report.suite === "synthetic"
      ? fixture.questions.map((question) => ({ ...question, sessions: question.sessions ?? fixture.sessions }))
      : normalizeDataset(await loadDataset(report.suite, { cache: cacheDir }), report.suite);
  return new Map(rows.map((question) => [String(question.id), question]));
}

export async function buildAudit({ report, answersDir, out, n = 150, seed, cacheDir } = {}) {
  if (!report?.protocolHash) throw new Error("MemoryBenchAudit: report has no protocol hash");
  const questions = await questionIndex(report, cacheDir);
  const cache = createAnswerCache({ root: answersDir ?? resolve(".cache/memory-bench/answers") });
  const rows = [];
  for (const row of report.results ?? []) {
    if (typeof row.correct !== "boolean" || row.outcome === "error" || row.outcome === "run_limit") continue;
    const key = row.answerKey ?? cache.key({ protocolHash: report.protocolHash, id: row.id });
    const entry = await cache.read(key);
    if (!entry?.answer) continue;
    const question = questions.get(String(row.baseId ?? row.id));
    rows.push({
      id: String(row.id),
      ability: row.ability,
      question: question?.question ?? "",
      gold: Array.isArray(question?.answers) ? question.answers.join(" OR ") : "",
      answer: entry.answer,
      correct: row.correct,
    });
  }
  const selected = selectAuditItems(rows, { n, seed });
  if (!selected.length) throw new Error("MemoryBenchAudit: no answered rows with text; run --phase answer first");
  await mkdir(out, { recursive: true, mode: 0o700 });
  await writeFile(join(out, "review.html"), renderReviewPage(selected), { mode: 0o600 });
  await writeFile(
    join(out, "README.txt"),
    "Open review.html in a browser, label every item, and download judge-audit-labels.json.\n" +
      "The labels file holds ids and verdicts only. Next: bun scripts/memory-bench/audit/calibrate.mjs --report <scored report> --labels <labels file>\n",
    { mode: 0o600 },
  );
  return { items: selected.length, out, abilities: [...new Set(selected.map((item) => item.ability))] };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(["report", "answers", "out", "n", "seed", "cache"].map((key) => [key, { type: "string" }])),
      strict: true,
    });
    if (!values.report) throw new Error("--report is required");
    const out =
      values.out ??
      join(
        process.env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"),
        "memory-bench/audit",
        new Date().toISOString().replace(/[:.]/g, "-"),
      );
    const result = await buildAudit({
      report: JSON.parse(await readFile(values.report, "utf8")),
      answersDir: values.answers,
      cacheDir: values.cache,
      out,
      n: values.n ? Number(values.n) : 150,
      seed: values.seed,
    });
    console.log(`audit set: ${result.items} items across ${result.abilities.length} abilities; ${join(result.out, "review.html")}`);
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
