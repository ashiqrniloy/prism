import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertEvaluationThreshold,
  toExperimentReportRecord,
} from "@arnilo/prism-evals";
import { hyper } from "@arnilo/prism-provider-hyper";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import {
  enforceLiveEvalTokenCeiling,
  HOST_EVAL_TRIALS,
  LIVE_EVAL_MAX_INPUT_TOKENS,
  reconstructReportFromRecord,
  runHostEvalSuite,
} from "../src/evals/suite.js";
import { HOST_EVAL_DATASET } from "./dataset.js";

function parseLiveEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function hydrateLiveEnv(): void {
  const envFile = process.env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (!existsSync(envFile)) return;
  const parsed = parseLiveEnvFile(envFile);
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

hydrateLiveEnv();

const enabled =
  process.env.PRISM_LIVE_EVAL_GATE_MANUAL === "1" &&
  typeof process.env.HYPER_API_KEY === "string" &&
  process.env.HYPER_API_KEY.trim().length > 0;

const runOrSkip = enabled ? test : test.skip;

runOrSkip(
  "live_eval_gate_row_enforces_token_ceiling",
  async () => {
    const modelId = process.env.PRISM_LIVE_EVAL_GATE_MODEL?.trim() || "deepseek-v4-pro-0813";
    const storePath =
      process.env.PRISM_LIVE_EVAL_GATE_STORE?.trim() ||
      join(homedir(), ".cache/prism/live-eval-gate.db");
    mkdirSync(dirname(storePath), { recursive: true });

    const persistence = createSqlitePersistence({ filename: storePath });
    try {
      const priorPage = await persistence.experiments.query({
        datasetId: HOST_EVAL_DATASET.id,
        limit: 1,
      });
      const priorRecord = priorPage.items[0];

      const report = await runHostEvalSuite({
        split: "heldout",
        trials: HOST_EVAL_TRIALS,
        live: {
          model: {
            provider: "hyper",
            model: modelId,
            limits: { contextWindow: 64_000, maxOutputTokens: 4_096 },
          },
          packages: [hyper({ apiKey: "env:HYPER_API_KEY" })],
        },
      });

      enforceLiveEvalTokenCeiling(report, LIVE_EVAL_MAX_INPUT_TOKENS);
      assert.equal(report.status, "succeeded");

      const previousMatched =
        priorRecord && priorRecord.datasetContentHash === report.datasetContentHash
          ? reconstructReportFromRecord(priorRecord, HOST_EVAL_DATASET, HOST_EVAL_TRIALS)
          : undefined;

      assertEvaluationThreshold(report, {
        requireInvariants: true,
        minimumPassHatK: {
          task_success: { k: 4, minimum: 0.75 },
          state_match: { k: 4, minimum: 0.75 },
        },
        ...(previousMatched
          ? {
              maximumRegression: {
                baseline: previousMatched,
                delta: 0.1,
              },
            }
          : {}),
      });

      await persistence.experiments.append(toExperimentReportRecord(report));
    } finally {
      await persistence.close();
    }
  },
  300_000,
);
