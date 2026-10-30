#!/usr/bin/env bun
/**
 * Turn human labels into a judge audit (plan 202 Task 3): per-judge kappa, the dropped judges, and
 * the active panel `run.mjs --judge-audit` consumes. Labels are ids and verdicts only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { auditKappas, parseAuditLabels } from "./review.mjs";

export async function calibrateAudit({ report, labels, output } = {}) {
  if (!report?.judgePanel?.length) throw new Error("MemoryBenchAudit: report has no judge panel");
  const result = auditKappas(report.results ?? [], parseAuditLabels(labels), report.judgePanel);
  const text = `${JSON.stringify({ kind: "judge-audit-v1", ...result }, null, 2)}\n`;
  if (output) await writeFile(output, text, { mode: 0o600 });
  else console.log(text);
  return result;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(["report", "labels", "output"].map((key) => [key, { type: "string" }])),
      strict: true,
    });
    if (!values.report || !values.labels) throw new Error("--report and --labels are required");
    const result = await calibrateAudit({
      report: JSON.parse(await readFile(values.report, "utf8")),
      labels: await readFile(values.labels, "utf8"),
      output: values.output,
    });
    for (const [ref, row] of Object.entries(result.judges))
      console.log(`${ref}: n=${row.n} kappa=${row.kappa ?? "n/a"}${result.dropped.includes(ref) ? " (dropped)" : ""}`);
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
