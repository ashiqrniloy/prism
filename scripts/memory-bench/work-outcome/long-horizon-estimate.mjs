/**
 * Plan 218.2 Task 8: the long-horizon family's manifest with its live estimate, written by
 * `run.mjs --family long-horizon --estimate` before any gate record names the family.
 *
 * The estimate is offline and spends nothing:
 * - the dev sessions run on the scripted agent and worker, every arm, with the offline model's window set to the
 *   window the gate is expected to run at (`--context-window`; compaction at the defaults follows it);
 * - the long-session family's dev personas run offline on memory-off and STM, and gate M-1's live long-session
 *   reports on the large model (the family meter of the run that produced each row) give a live-to-offline factor for
 *   input and for output tokens: memory-off's factor scales memory-off, fold and llm-summary; STM's scales STM-only and
 *   WM;
 * - the precondition reading (WM passes with an item per session at the defaults) comes from the same offline run.
 *
 * The manifest carries ids, counts and hashes only.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { M2_ANSWER_MODELS, m2ProductFingerprint } from "../wm-gate.mjs";
import { LONG_HORIZON_ARMS, LONG_HORIZON_FAMILY, LONG_HORIZON_PROJECTS, longHorizonEngagement } from "./long-horizon.mjs";
import { runLongSession } from "./long-session.mjs";

export const LONG_HORIZON_MANIFEST = "docs/_evidence/memory-bench/218.2/long-horizon-manifest.json";
export const LONG_HORIZON_MANIFEST_KIND = "218.2-long-horizon-manifest";
export const LONG_HORIZON_PARTITION_FILE = "scripts/memory-bench/work-outcome-long-horizon.json";
/** The window the estimate assumes until a gate record names the models' catalog windows. */
export const LONG_HORIZON_ESTIMATE_WINDOW = 128_000;
/** Gate M-1's live long-session runs on the large model: the calibration source (family meter rows). */
export const LONG_HORIZON_CALIBRATION = Object.freeze({
  "memory-off": "docs/_evidence/memory-bench/217/runs/run-217-m1-217-m1.large.memory-off.long-session.json",
  STM: "docs/_evidence/memory-bench/217/runs/run-217-m1-217-m1.large.STM.long-session.json",
});
/** Which calibrated arm each long-horizon arm scales by. */
const CALIBRATED_BY = Object.freeze({
  "memory-off": "memory-off",
  fold: "memory-off",
  "llm-summary": "memory-off",
  "STM-only": "STM",
  WM: "STM",
});

const sumOf = (rows, pick) => rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
const input = (row) => (row.main?.inputTokens ?? 0) + (row.worker?.inputTokens ?? 0);
const output = (row) => (row.main?.outputTokens ?? 0) + (row.worker?.outputTokens ?? 0);
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** Live-to-offline factors per calibrated arm, per persona-arm on the same family (long-session, dev). */
export function longHorizonCalibration(liveReports, offlineReport) {
  return Object.fromEntries(
    Object.entries(liveReports).map(([arm, report]) => {
      const live = (report?.report?.usage ?? []).filter((row) => row.arm === arm);
      const offline = (offlineReport?.usage ?? []).filter((row) => row.arm === arm);
      if (!live.length || !offline.length) throw new Error(`LongHorizonEstimate: no ${arm} rows to calibrate on`);
      const perPersona = (rows, pick) => sumOf(rows, pick) / rows.length;
      return [
        arm,
        {
          livePersonas: live.length,
          offlinePersonas: offline.length,
          input: round(perPersona(live, input) / perPersona(offline, input)),
          output: round(perPersona(live, output) / perPersona(offline, output)),
          source: LONG_HORIZON_CALIBRATION[arm],
        },
      ];
    }),
  );
}

/** Estimated live tokens per arm (each model alike: the scripted run does not know a model). */
export function longHorizonEstimate(offlineReport, calibration, models = M2_ANSWER_MODELS) {
  const perArm = Object.fromEntries(
    LONG_HORIZON_ARMS.map((arm) => {
      const rows = (offlineReport?.usage ?? []).filter((row) => row.arm === arm);
      const factor = calibration[CALIBRATED_BY[arm]];
      return [
        arm,
        {
          sessions: rows.length,
          offlineInputTokens: sumOf(rows, input),
          offlineOutputTokens: sumOf(rows, output),
          calibratedBy: CALIBRATED_BY[arm],
          inputTokens: Math.round(sumOf(rows, input) * factor.input),
          outputTokens: Math.round(sumOf(rows, output) * factor.output),
        },
      ];
    }),
  );
  const models_ = models.map((model) => ({ provider: model.provider, model: model.model, arms: perArm }));
  const perModel = sumOf(Object.values(perArm), (row) => row.inputTokens);
  return {
    perArm,
    models: models_,
    totals: { inputTokensPerModel: perModel, models: models.length, inputTokens: perModel * models.length },
  };
}

export async function buildLongHorizonManifest({ root = ".", contextWindow = LONG_HORIZON_ESTIMATE_WINDOW, models } = {}) {
  const started = performance.now();
  const horizon = await runLongSession({
    family: LONG_HORIZON_FAMILY,
    partition: "dev",
    offline: true,
    offlineContextWindow: contextWindow,
  });
  const session = await runLongSession({ family: "long-session", partition: "dev", arms: ["memory-off", "STM"], offline: true });
  const live = {};
  for (const [arm, path] of Object.entries(LONG_HORIZON_CALIBRATION)) live[arm] = JSON.parse(await readFile(`${root}/${path}`, "utf8"));
  const calibration = longHorizonCalibration(live, session);
  return {
    kind: LONG_HORIZON_MANIFEST_KIND,
    plan: "218.2",
    task: 8,
    family: LONG_HORIZON_FAMILY,
    partition: "dev",
    arms: [...LONG_HORIZON_ARMS],
    projectsPerSession: LONG_HORIZON_PROJECTS,
    fixture: {
      path: LONG_HORIZON_PARTITION_FILE,
      sha256: createHash("sha256")
        .update(await readFile(`${root}/${LONG_HORIZON_PARTITION_FILE}`))
        .digest("hex"),
    },
    partitionIdsHash: horizon.partitionIdsHash,
    productHash: await m2ProductFingerprint(root),
    contextWindow,
    precondition: longHorizonEngagement(horizon),
    eligibleTokens: Object.fromEntries(
      LONG_HORIZON_ARMS.map((arm) => [arm, horizon.usage.filter((row) => row.arm === arm).map((row) => row.eligibleTokens)]),
    ),
    calibration,
    estimate: longHorizonEstimate(horizon, calibration, models),
    offlineCost: horizon.cost,
    basis:
      "offline scripted run of the dev sessions at contextWindow, scaled by gate M-1's live/offline token ratio on the long-session family (large model, family meter); an estimate, not a cap",
    wallMs: Math.round(performance.now() - started),
  };
}

export async function writeLongHorizonManifest({ root = ".", path = LONG_HORIZON_MANIFEST, ...options } = {}) {
  const manifest = await buildLongHorizonManifest({ root, ...options });
  await writeFile(`${root}/${path}`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
