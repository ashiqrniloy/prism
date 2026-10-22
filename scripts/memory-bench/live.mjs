#!/usr/bin/env bun
import { resolve } from "node:path";
import { writeReport } from "./report.mjs";
import { runBench } from "./run.mjs";

if (process.env.PRISM_LIVE_MEMORY_BENCH_MANUAL !== "1") throw new Error("Memory benchmark requires explicit manual opt-in");
const suite = process.env.PRISM_MEMORY_BENCH_SUITE ?? "longmemeval-s";
const model = process.env.PRISM_LIVE_MEMORY_BENCH_MODEL ?? "mimo-v2.5";
for (const config of ["full", "om", "fabric", "om+fabric"]) {
  const report = await runBench({ suite, config, provider: "opencode-go", model, judge: `opencode-go/${model}` });
  const file = `${suite}-${config}-opencode-go-${model.replace(/[^a-zA-Z0-9_.-]/g, "_")}-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
  await writeReport(report, resolve("docs/_evidence/memory-bench", file));
  console.log(`${suite}/${config}: ${report.status}; ${report.results.length} scored; ${report.inputTokens} input tokens`);
  if (!["completed", "unavailable"].includes(report.status)) process.exitCode = 1;
}
