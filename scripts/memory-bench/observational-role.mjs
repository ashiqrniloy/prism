#!/usr/bin/env bun
/**
 * Plan 202 Task 16: measure observational memory in its assigned tier-T0 role.
 *
 * Four offline lifecycle arms: fabric / om+fabric, each with promotion off and on. The lifecycle
 * suite's scripted provider writes notes through the real fabric consolidation path, recalls them in
 * later sessions, and cites the ids it saw, so use-based verification is measured rather than assumed.
 * No model call, no network, no held-out data.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runLifecycle } from "./lifecycle/suite.mjs";

const ARMS = [
  { name: "fabric", config: "fabric", promote: false },
  { name: "fabric+promotion", config: "fabric", promote: true },
  { name: "om+fabric", config: "om+fabric", promote: false },
  { name: "om+fabric+promotion", config: "om+fabric", promote: true },
];

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value) => (value === null ? null : Math.round(value * 1e6) / 1e6);

export function summarizeRole(rows) {
  const byArm = new Map();
  for (const row of rows) {
    const list = byArm.get(row.arm) ?? [];
    list.push(row);
    byArm.set(row.arm, list);
  }
  const arms = {};
  for (const { name } of ARMS) {
    const list = byArm.get(name) ?? [];
    arms[name] = {
      seeds: list.length,
      status: list.every((row) => row.status === "completed") ? "completed" : "failed",
      taskSuccess: round(mean(list.map((row) => row.taskSuccess ?? 0))),
      rightTimeRecall: round(mean(list.map((row) => row.rightTimeRecall ?? 0))),
      promoted: round(mean(list.map((row) => row.promotion?.promoted ?? 0))),
      notesPerSession: round(mean(list.map((row) => row.promotion?.notesPerSession ?? 0))),
      verifiedShare: round(mean(list.map((row) => row.promotion?.verifiedShare ?? 0))),
      usedShare: round(mean(list.map((row) => row.promotion?.usedShare ?? 0))),
      observerCalls: round(mean(list.map((row) => row.workerUsage?.observer?.calls ?? 0))),
      observerInputTokens: round(mean(list.map((row) => row.workerUsage?.observer?.inputTokens ?? 0))),
      reflectorCalls: round(mean(list.map((row) => row.workerUsage?.reflector?.calls ?? 0))),
      reflectorInputTokens: round(mean(list.map((row) => row.workerUsage?.reflector?.inputTokens ?? 0))),
    };
  }
  const delta = (a, b) => (a === null || b === null ? null : round(a - b));
  return {
    arms,
    comparisons: {
      fabricPromotionMinusOff: delta(arms["fabric+promotion"].taskSuccess, arms.fabric.taskSuccess),
      omFabricPromotionMinusOff: delta(arms["om+fabric+promotion"].taskSuccess, arms["om+fabric"].taskSuccess),
      omFabricMinusFabric: delta(arms["om+fabric"].taskSuccess, arms.fabric.taskSuccess),
      omFabricPromotionMinusFabricPromotion: delta(arms["om+fabric+promotion"].taskSuccess, arms["fabric+promotion"].taskSuccess),
    },
  };
}

export async function runObservationalRole({ seeds = [7, 11, 19] } = {}) {
  const rows = [];
  for (const seed of seeds) {
    for (const arm of ARMS) {
      const report = await runLifecycle({
        suite: "lifecycle",
        offline: true,
        config: arm.config,
        seed,
        policy: arm.promote ? {} : { promote: false },
      });
      rows.push({
        arm: arm.name,
        config: arm.config,
        seed,
        status: report.status,
        taskSuccess: report.metrics?.taskSuccess ?? null,
        rightTimeRecall: report.metrics?.rightTimeRecall ?? null,
        crossProjectLeakage: report.metrics?.crossProjectLeakage ?? null,
        poisonPersistence: report.metrics?.poisonPersistence ?? null,
        promotion: report.promotion ?? null,
        workerUsage: report.workerUsage ?? null,
        inputTokens: report.inputTokens,
        calls: report.calls,
      });
    }
  }
  return {
    schemaVersion: 1,
    metric: "offline lifecycle taskSuccess with and without observational-memory promotion",
    generatedAt: new Date().toISOString(),
    seeds,
    modelCalls: 0,
    rows,
    ...summarizeRole(rows),
    limitations: [
      "Synthetic one-persona lifecycle suite (3 projects x 8 sessions), not the powered 12-persona safety gate.",
      "Promotion is the real fabric consolidation path over OM observations/reflections; the mock provider writes and cites notes deterministically.",
      "Zero model calls: this measures the role and the mechanics, not live answer quality.",
    ],
  };
}

function markdown(result) {
  const rows = Object.entries(result.arms)
    .map(
      ([name, arm]) =>
        `| ${name} | ${arm.taskSuccess} | ${arm.promoted} | ${arm.notesPerSession} | ${arm.verifiedShare} | ${arm.usedShare} | ${arm.observerCalls} | ${arm.observerInputTokens} | ${arm.reflectorCalls} |`,
    )
    .join("\n");
  return `# Observational memory role measurement — plan 202 Task 16

Offline \`lifecycle\` suite, seeds ${result.seeds.join(", ")}, zero model calls. The scripted provider
writes notes through the real fabric consolidation path, recalls them in later sessions, and cites the
ids it saw, so use-based verification is measured rather than assumed.

| Arm | Task success | Promoted | Notes/session | Verified share | Used share | Observer calls | Observer input tokens | Reflector calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

Comparisons: ${JSON.stringify(result.comparisons, null, 2)}

**Decision:** ${decisionText(result)}

Limitations:
${result.limitations.map((line) => `- ${line}`).join("\n")}
`;
}

function decisionText(result) {
  const om = result.comparisons.omFabricPromotionMinusOff;
  const fabric = result.comparisons.fabricPromotionMinusOff;
  if (om !== null && om < 0)
    return `OM+fabric promotion lowered task success by ${Math.abs(om).toFixed(1)} points at the chosen seeds (fabric alone moved ${fabric >= 0 ? "+" : ""}${fabric.toFixed(3)}). There is no positive role evidence for the reference host, so it keeps promotion off and both READMEs state the negative result.`;
  return "promotion did not lower task success in this offline suite; it stays opt-in pending live confirmation because there is no positive accuracy claim.";
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index < 0 ? fallback : argv[index + 1];
  };
  const seeds = String(value("seeds", "7,11,19")).split(",").map(Number);
  if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 1)) throw new Error("--seeds must be positive integers");
  const output = resolve(value("output", "docs/_evidence/memory-bench/202/observational/role.json"));
  const result = await runObservationalRole({ seeds });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(output.replace(/\.json$/, ".md"), markdown(result));
  console.log(`${output}; ${JSON.stringify(result.comparisons)}`);
}
