/**
 * Live guardrail arms (plan 237 Task 4), manual and opt-in:
 *
 *   PRISM_LIVE_GUARDRAIL_ARMS=1 bun test --timeout=0 evals/live-guardrails.test.ts
 *
 * Runs the research items of the host eval dataset twice on a live model: no pack, then
 * `injection-markers` plus `pii` at their default actions. The research worker's `web_fetch` runs
 * through the fixture obscura backend and marks results `untrusted_external`, so `injection-markers`
 * scans them as it would in the host. Prints catch and false-positive counts with Wilson intervals and
 * the paired comparison. It asserts only that both arms completed: a measured rate goes into
 * `docs/_evidence/guardrails-2026-11.md` by hand, with the model id and dataset hash printed here.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hyper } from "@arnilo/prism-ai/hyper";
import guardrailPacks from "@arnilo/prism-extensions/guardrail-packs";
import {
  compareExperiments,
  createGuardrailFlaggedScorer,
  defineDataset,
  type ExperimentReport,
  type InjectionSpec,
  wilsonInterval,
} from "@arnilo/prism-hosts/evals";
import { enforceLiveEvalTokenCeiling, LIVE_EVAL_MAX_INPUT_TOKENS, runHostEvalSuite } from "../src/evals/suite.js";
import { HOST_EVAL_ITEMS, type HostEvalItemExpected, type HostEvalItemInput } from "./dataset.js";

function hydrateLiveEnv(): void {
  const envFile = process.env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (!existsSync(envFile)) return;
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(raw.trim());
    if (!match?.[1] || match[2] === undefined || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

hydrateLiveEnv();

const enabled = process.env.PRISM_LIVE_GUARDRAIL_ARMS === "1" && Boolean(process.env.HYPER_API_KEY?.trim());
const PACKS = ["injection-markers", "pii"] as const;

function detection(report: ExperimentReport<HostEvalItemInput, HostEvalItemExpected>, pack: string) {
  const id = `guardrail_flagged:${pack}`;
  const tally = { attacked: { n: 0, caught: 0 }, benign: { n: 0, caught: 0 } };
  for (const item of report.items) {
    const attacked = (item.item.metadata?.injection as InjectionSpec | undefined)?.attackId != null;
    for (const row of item.evaluations) {
      if (row.scorerId !== id || row.status !== "scored") continue;
      const bucket = attacked ? tally.attacked : tally.benign;
      bucket.n += 1;
      if (row.score === 1) bucket.caught += 1;
    }
  }
  const rate = ({ n, caught }: { n: number; caught: number }) => ({ n, caught, ...(n ? { ci95: wilsonInterval(caught, n) } : {}) });
  return { caught: rate(tally.attacked), falsePositive: rate(tally.benign) };
}

(enabled ? test : test.skip)(
  "live_guardrail_arms_report_catch_and_false_positive_counts",
  async () => {
    const modelId = process.env.PRISM_LIVE_EVAL_GATE_MODEL?.trim() || "deepseek-v4-pro-0813";
    const trials = Number(process.env.PRISM_LIVE_GUARDRAIL_TRIALS ?? 2);
    const dataset = defineDataset<HostEvalItemInput, HostEvalItemExpected>({
      id: "prism-agent-guardrail-arms",
      version: "1",
      items: HOST_EVAL_ITEMS.filter((item) => item.input.worker === "research"),
    });
    const model = { provider: "hyper", model: modelId, limits: { contextWindow: 64_000, maxOutputTokens: 4_096 } };
    const extraScorers = PACKS.map((pack) => createGuardrailFlaggedScorer<HostEvalItemInput, HostEvalItemExpected>({ pack }));
    const arm = (withPacks: boolean) =>
      runHostEvalSuite({
        dataset,
        trials,
        experimentId: withPacks ? "guardrail-arms:packs" : "guardrail-arms:none",
        extraScorers,
        live: {
          model,
          packages: [hyper({ apiKey: "env:HYPER_API_KEY" }), ...(withPacks ? [guardrailPacks({ packs: [...PACKS] })] : [])],
        },
      });
    const none = await arm(false);
    const packs = await arm(true);
    for (const report of [none, packs]) {
      enforceLiveEvalTokenCeiling(report, LIVE_EVAL_MAX_INPUT_TOKENS);
      assert.equal(report.status, "succeeded");
    }
    console.log(
      JSON.stringify(
        {
          model: `hyper/${modelId}`,
          datasetContentHash: packs.datasetContentHash,
          trials,
          detection: Object.fromEntries(PACKS.map((pack) => [pack, detection(packs, pack)])),
          comparison: compareExperiments(none, packs, { seed: 7 }).scorers,
        },
        null,
        2,
      ),
    );
  },
  1_800_000,
);
