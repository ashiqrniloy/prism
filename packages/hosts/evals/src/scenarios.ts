import { EvalError } from "./errors.js";
import { type FailureInjectionOptions, failingStore, failureInjection } from "./failure-injection.js";
import { HARD_MAX_TRIALS } from "./limits.js";
import type { ExperimentReport, EvalManifest, ExperimentTrials } from "./types.js";

export { type FailureInjectionOptions, failingStore, failureInjection };

// ─── Eval Manifest Validation (R-E12) ─────────────────────────────────────────

/**
 * Validates frozen eval manifest binding runtime and dataset revisions.
 * Fails closed on missing or corrupt required fields.
 */
export function validateEvalManifest(manifest: EvalManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new EvalError("eval manifest must be a non-null object", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.runtimeRevision !== "string" || !manifest.runtimeRevision.trim()) {
    throw new EvalError("eval manifest is missing required runtimeRevision", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.datasetVersion !== "string" || !manifest.datasetVersion.trim()) {
    throw new EvalError("eval manifest is missing required datasetVersion", "ERR_PRISM_EVAL_MANIFEST");
  }
}

/**
 * Additive release-evidence binding. Requires the two-field manifest plus
 * promptVersion (or promptId+promptVersion), toolFingerprint, model, and policyRevision.
 */
export function validateReleaseEvalManifest(manifest: EvalManifest, report?: ExperimentReport): void {
  validateEvalManifest(manifest);
  const promptVersion = typeof manifest.promptVersion === "string" ? manifest.promptVersion.trim() : "";
  if (!promptVersion) {
    throw new EvalError("release eval manifest is missing required promptVersion", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.toolFingerprint !== "string" || !manifest.toolFingerprint.trim()) {
    throw new EvalError("release eval manifest is missing required toolFingerprint", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.model !== "string" || !manifest.model.trim()) {
    throw new EvalError("release eval manifest is missing required model", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.policyRevision !== "string" || !manifest.policyRevision.trim()) {
    throw new EvalError("release eval manifest is missing required policyRevision", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.datasetContentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(manifest.datasetContentHash)) {
    throw new EvalError("release eval manifest requires datasetContentHash (sha256)", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (report && manifest.datasetContentHash !== report.datasetContentHash) {
    throw new EvalError("release eval manifest datasetContentHash does not match report", "ERR_PRISM_EVAL_MANIFEST");
  }
}

export type { AgentFactory, ScenarioDefinition, ScenarioTurn, RunScenarioOptions, ScenarioResult } from "./scenario-runner.js";
export { runScenario, collectWhileRunning, DEFAULT_MAX_SCENARIO_TURNS, HARD_MAX_SCENARIO_TURNS } from "./scenario-runner.js";

// ─── Trials Resolution (R-E12) ────────────────────────────────────────────────

/** Seeded RNG in [0, 1). Not a claim of LLM determinism. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveTrialsConfig(trials?: number, seed?: number): Omit<ExperimentTrials, "sampleCount"> {
  const count = trials ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > HARD_MAX_TRIALS) {
    throw new EvalError(`trials must be an integer in [1, ${HARD_MAX_TRIALS}]`, "ERR_PRISM_EVAL_TRIALS");
  }
  if (seed !== undefined && !Number.isInteger(seed)) {
    throw new EvalError("seed must be an integer", "ERR_PRISM_EVAL_TRIALS");
  }
  return {
    count,
    ...(seed !== undefined ? { seed } : {}),
  };
}
