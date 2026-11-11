/** Aggregate rot-curve results and write the per-model evidence + release summary. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { effectiveInputBudget, wilson } from "./grade.mjs";

export const CONFIGS = ["none", "fold"];

export function aggregate({ provider, model, mode, lengths, repeats, results, usage, generatedAt, modelWindow, cost }) {
  const arms = [];
  for (const length of lengths) {
    for (const fold of CONFIGS) {
      const rows = results.filter((row) => row.length === length && row.fold === fold);
      const correct = rows.reduce((sum, row) => sum + row.score, 0);
      const inputTokens = rows.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0);
      const cacheReadTokens = rows.reduce((sum, row) => sum + (row.usage?.cacheReadTokens ?? 0), 0);
      const outputTokens = rows.reduce((sum, row) => sum + (row.usage?.outputTokens ?? 0), 0);
      arms.push({
        length,
        fold,
        runs: rows.length,
        correct,
        accuracy: rows.length === 0 ? 0 : correct / rows.length,
        interval: wilson(correct, rows.length),
        inputTokens,
        cacheReadTokens,
        cacheReadRatio: inputTokens === 0 ? 0 : cacheReadTokens / inputTokens,
        outputTokens,
        calls: rows.reduce((sum, row) => sum + (row.usage?.calls ?? 0), 0),
      });
    }
  }
  const baseline = arms.filter((arm) => arm.fold === "none");
  const folded = arms.filter((arm) => arm.fold === "fold");
  const effectiveBudget = effectiveInputBudget(baseline);
  const foldEffectiveBudget = effectiveInputBudget(folded);
  const taskCount = new Set(results.map((row) => row.id)).size;
  return {
    schemaVersion: 1,
    generatedAt,
    provider,
    model,
    mode,
    modelWindow: modelWindow ?? null,
    lengths,
    repeats,
    taskCount,
    configs: CONFIGS,
    arms,
    effectiveInputBudget: effectiveBudget,
    foldEffectiveInputBudget: foldEffectiveBudget,
    usage,
    billedEstimate: billedEstimate(usage, cost),
    results,
    limitations: [
      "Deterministic self-graded tasks; no model judge.",
      "History is pinned public-repo tool output, not the task's own workspace.",
      "A task may be answered after the configured turn cap; failed tool use is scored zero.",
      ...(mode === "offline" ? ["Offline smoke uses the mock provider; scores verify plumbing, not capability."] : []),
      ...(mode === "live" && taskCount < 30
        ? [`Pilot run: ${taskCount} of 30 tasks. The release matrix uses all 30 at three repeats.`]
        : []),
    ],
  };
}

function billedEstimate(usage, cost) {
  if (!cost || !Number.isFinite(cost.input) || !Number.isFinite(cost.output)) return null;
  const divisor = /(?:1m|million)/i.test(cost.unit ?? "") ? 1_000_000 : 1;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0));
  const cacheRead = Number.isFinite(cost.cacheRead) ? cost.cacheRead : cost.input;
  const total = (uncached * cost.input + (usage.cacheReadTokens ?? 0) * cacheRead + (usage.outputTokens ?? 0) * cost.output) / divisor;
  return { amount: total, currency: cost.currency ?? "USD", estimate: true, unit: cost.unit ?? "token" };
}

export function evidenceMarkdown(report) {
  const lines = [
    `# Context-rot evidence: ${report.provider}/${report.model}`,
    "",
    `Generated: ${report.generatedAt}  `,
    `Mode: ${report.mode}  `,
    `Model window: ${report.modelWindow ?? "unknown"}  `,
    `Tasks: ${report.taskCount} · repeats: ${report.repeats} · configs: ${report.configs.join(", ")}`,
    "",
    "| Length | Config | Correct | Accuracy | Wilson 95% | Input tokens | Cache-read | Cache ratio |",
    "| ---: | --- | ---: | ---: | --- | ---: | ---: | ---: |",
  ];
  for (const arm of report.arms) {
    lines.push(
      `| ${arm.length} | ${arm.fold} | ${arm.correct}/${arm.runs} | ${formatPct(arm.accuracy)} | ${formatPct(arm.interval[0])}–${formatPct(arm.interval[1])} | ${arm.inputTokens.toLocaleString("en-US")} | ${arm.cacheReadTokens.toLocaleString("en-US")} | ${formatPct(arm.cacheReadRatio)} |`,
    );
  }
  lines.push(
    "",
    `**Effective input budget:** ${report.effectiveInputBudget.toLocaleString("en-US")} tokens (no fold, within 5 points of the 0-length baseline with overlapping intervals).`,
    `**Effective input budget with fold batch:** ${report.foldEffectiveInputBudget.toLocaleString("en-US")} tokens.`,
    "",
    `Usage: ${report.usage.inputTokens.toLocaleString("en-US")} input · ${report.usage.cacheReadTokens.toLocaleString("en-US")} cache-read · ${report.usage.outputTokens.toLocaleString("en-US")} output · ${report.usage.calls} calls; usage complete: ${report.usage.complete}.`,
    `Billed estimate: ${report.billedEstimate ? `${report.billedEstimate.amount.toFixed(4)} ${report.billedEstimate.currency} (provider list price, estimate)` : "unavailable (model has no published price)"}.`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((line) => `- ${line}`),
    "",
  );
  return lines.join("\n");
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export async function writeEvidence(report, directory) {
  const base = `${report.provider}-${sanitize(report.model)}-${report.generatedAt.slice(0, 10)}`;
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, `${base}.json`);
  const mdPath = join(directory, `${base}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, `${evidenceMarkdown(report)}\n`, "utf8");
  return { jsonPath, mdPath, base };
}

export function summaryRow(report, evidenceBase) {
  const baseline = report.arms.find((arm) => arm.length === 0 && arm.fold === "none");
  const budgetArm = report.arms.find((arm) => arm.length === report.effectiveInputBudget && arm.fold === "none");
  return `| ${report.provider}/${report.model} | ${report.modelWindow?.toLocaleString("en-US") ?? "unknown"} | ${report.effectiveInputBudget.toLocaleString("en-US")} | ${report.foldEffectiveInputBudget.toLocaleString("en-US")} | ${formatPct(baseline?.accuracy ?? 0)} / ${formatPct(budgetArm?.accuracy ?? 0)} | [\`${evidenceBase}\`](context-rot/${evidenceBase}.md) |`;
}

const SUMMARY_HEADER = [
  "# Context rot on 0.13.0",
  "",
  "One model each on Hyper and OpenCode Go (the plan 183 matrix). Full method: [`scripts/context-rot/README.md`](../../scripts/context-rot/README.md).",
  "",
  "| Model | Declared window | Effective input budget | With fold batch | Accuracy at 0 / budget | Evidence |",
  "| --- | ---: | ---: | ---: | --- | --- |",
];

/** Upsert one model row; a rerun on the same date replaces that row. */
export async function updateSummary(report, evidenceBase, path) {
  let lines;
  try {
    lines = (await readFile(path, "utf8")).trimEnd().split("\n");
  } catch {
    lines = [...SUMMARY_HEADER];
  }
  const key = `| ${report.provider}/${report.model} |`;
  const row = summaryRow(report, evidenceBase);
  const existing = lines.findIndex((line) => line.startsWith(key));
  if (existing === -1) lines.push(row);
  else lines[existing] = row;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
}
