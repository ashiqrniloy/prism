#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { historicalVariants } from "./ablations.mjs";
import {
  ACCEPTANCE_1888_EVIDENCE,
  ACCEPTANCE_1888_JOURNAL,
  ACCEPTANCE_1888_LOGS,
  ACCEPTANCE_1888_MANIFEST,
  ACCEPTANCE_1888_SUMMARY,
  ACCEPTANCE_1889_EVIDENCE,
  ACCEPTANCE_1889_FULL_REPORT,
  ACCEPTANCE_1889_JOURNAL,
  ACCEPTANCE_1889_LOGS,
  ACCEPTANCE_1889_MANIFEST,
  ACCEPTANCE_1889_PROBE_JOURNAL,
  ACCEPTANCE_1889_PROBE_MANIFEST,
  ACCEPTANCE_1889_PROBE_REPORT,
  ACCEPTANCE_1889_SCREEN_EVIDENCE,
  ACCEPTANCE_1889_SCREEN_JOURNAL,
  ACCEPTANCE_1889_SCREEN_MANIFEST,
  ACCEPTANCE_1889_SCREEN_SUMMARY,
  ACCEPTANCE_1889_SCREEN_VERDICT,
  ACCEPTANCE_1889_SUMMARY,
  ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE,
  ACCEPTANCE_18810_JOURNAL,
  ACCEPTANCE_18810_LOGS,
  ACCEPTANCE_18810_MANIFEST,
  ACCEPTANCE_18810_SUMMARY,
  ACCEPTANCE_EVIDENCE,
  ACCEPTANCE_JOURNAL,
  ACCEPTANCE_MANIFEST,
  ACCEPTANCE_SUMMARY,
  assertAcceptance1888Manifest,
  assertAcceptance1889Manifest,
  assertAcceptance1889ProbeManifest,
  assertAcceptance1889ScreenManifest,
  assertAcceptance18810Manifest,
  assertAcceptanceManifest,
  assertJobDependencies,
  assertScreenAManifest,
  assertScreenProfile,
  buildAcceptance1888Manifest,
  buildAcceptance1889Manifest,
  buildAcceptance1889ProbeManifest,
  buildAcceptance1889ScreenManifest,
  buildAcceptance18810Manifest,
  buildAcceptanceManifest,
  buildScreenAManifest,
  chooseConcurrency,
  frozenProduct,
  fullReferenceReuse1889,
  HARNESS_PATHS,
  heldout1888,
  PREFIX_PRODUCT_PATHS,
  PREFIX_WORKTREE,
  prefixArmAudit,
  SCREEN_1889_ARM_IDS,
  SCREEN_A_ARM_IDS,
  SCREEN_A_CEILING,
  SCREEN_A_EVIDENCE,
  SCREEN_A_JOURNAL,
  SCREEN_A_LOGS,
  SCREEN_A_MANIFEST,
  SCREEN_A_SUMMARY,
  SCREEN_A_VERDICT,
  screenAVerdict,
  screenVerdict,
  sourceFingerprint,
  stageASelection,
  WRITE_SIDE_CACHE,
  WRITE_SIDE_PATHS,
  writeSideCacheDir,
} from "./acceptance.mjs";
import {
  assertBaselineContinuation,
  assertBaselineReadiness,
  assertCacheStabilityPin,
  ontologyManifestPins,
  recordBaselineQuota,
  writeReadiness,
} from "./audit/readiness.mjs";
import { rateLimitDisposition } from "./audit/zero-score.mjs";
import { BASELINE_EVIDENCE, BASELINE_JOURNAL, BASELINE_LOGS, BASELINE_SUMMARY } from "./baseline.mjs";
import {
  abandonUnfinished,
  acquireCampaignLock,
  attemptCharge,
  availableTokens,
  campaignLockPath,
  journalSpend,
  latestAttempt,
  MAX_ATTEMPTS_PER_JOB,
  openJournal,
  reconcileAttempt,
  releaseCampaignLock,
  reserveAttempt,
  saveJournal,
} from "./journal.mjs";
import { robustnessCriteriaHash } from "./robustness.mjs";
import { assertComparableServedDeployments } from "./served-model.mjs";
import subsets from "./subsets.json" with { type: "json" };
import { TASK5_EVIDENCE, TASK5_JOURNAL, writeTask5ComparisonManifest, writeTask5ScreenManifest } from "./task5-comparison.mjs";
import {
  buildTask5CampaignManifest,
  postflightTask5,
  preflightTask5,
  TASK5_LOGS,
  TASK5_SMOKE_JOURNAL,
  TASK5_SMOKE_SUMMARY,
  TASK5_SUMMARY,
} from "./task5-execute.mjs";
import { variantProvenance } from "./variants.mjs";
import { screen209WorkArgv as workOutcomeArgv } from "./work-outcome/argv.mjs";

const evidence = "docs/_evidence/memory-bench/task6";
const logs = ".cache/memory-bench/task6-resume";
const ACCEPTANCE_LOGS = ".cache/memory-bench/188.7";

/**
 * A closed subscription window is not an arm failure: the gateway says the plan is spent and will
 * reopen. The campaign pauses and re-runs the cell afterwards, and the attempt does not count
 * against the job's attempt budget.
 */
export function quotaWindowFailure(report) {
  if (!report || report.status === "completed") return false;
  const text = `${report.failure?.message ?? ""}\n${report.failure?.cause?.message ?? ""}\n${(report.errors ?? []).map((error) => error.message).join("\n")}`;
  return /GoUsageLimit|usage limit|quota|402|payment required|credit balance|insufficient/i.test(text);
}

/** Every message a failed report carries, in the order a provider put it. */
function failureText(report) {
  return [
    report?.failure?.message,
    report?.failure?.cause?.message,
    ...(report?.errors ?? []).map((error) => error?.cause?.message ?? error?.message),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The HTTP status a failed report carries; provider errors are wrapped with `...:<status>`. */
export function failureHttpStatus(report) {
  const text = String(report?.failure?.code ?? report?.failure?.cause?.code ?? "");
  const match = text.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Plan 202 Task 5.4.3: the free-model daily cap (`free-models-per-day*`) is an account budget that
 * reopens, not an arm failure. It is classified with the same `rateLimitDisposition` the diagnostic
 * harness uses, so there is one 429 classifier in the tree.
 */
export function dailyFreeQuotaFailure(report) {
  if (!report || report.status === "completed" || report.status === "token-ceiling") return null;
  const status = failureHttpStatus(report);
  if (status === null) return null;
  return rateLimitDisposition(status, failureText(report)) === "stop" ? { status, body: failureText(report) } : null;
}

/** When the daily free quota reopens: the next UTC midnight, or an owner-set reset hour. */
export function nextDailyReset(now = new Date()) {
  const hour = Number(process.env.PRISM_MEMORY_BENCH_DAILY_RESET_HOUR_UTC ?? "0");
  const at = new Date(now);
  at.setUTCHours(Number.isFinite(hour) ? hour : 0, 0, 0, 0);
  if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

/** Attempts that spent no arm budget: a spent quota window, a spent daily cap, or a transient provider fault. */
export function isBudgetQuotaCause(cause) {
  return cause === "quota-window" || cause === "quota-daily" || cause === "transient";
}

/**
 * A provider or transport fault that says nothing about the arm (plan 208 Task 5, 2026-11-04): an hourly 429, a 5xx,
 * a dropped socket, a gateway timeout, or a gateway 400 that names its upstream. The campaign waits a cooldown and
 * re-runs the job from its checkpoint; the attempt does not count against the job's attempt budget.
 */
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_TEXT =
  /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|EPIPE|ENOTFOUND|socket hang up|fetch failed|connection was closed|timed out|TimeoutError|overloaded|rate.?limit|MemoryBenchWorkerTimeout/i;
export function transientFailure(report) {
  if (!report || report.status === "completed" || report.status === "token-ceiling") return false;
  if (permanentFailure(report) || dailyFreeQuotaFailure(report)) return false;
  const status = failureHttpStatus(report);
  const text = failureText(report);
  // An upstream content filter that fires on some attempts and not others (Command Code's Qwen route, plan 208 Task 5,
  // 2026-11-04: the same question passed on both reruns) is not a deterministic refusal of the input.
  if (/DataInspectionFailed|may contain inappropriate content/i.test(text)) return true;
  if (status !== null && TRANSIENT_STATUSES.has(status)) return true;
  // A 400 the gateway attributes to the request itself (`invalid_request_error`, a validation message, a failure the
  // provider classed `permanent`) fails the same way on every re-run, so it is never transient.
  if (status === 400 && /invalid_request_error|invalid_value|Validation:|"failureClass":"permanent"/i.test(text)) return false;
  if (status === 400 && /Provider returned error|upstream (request failed|error|validation error)/i.test(text)) return true;
  return TRANSIENT_TEXT.test(text);
}

/** Cooldown before the n-th transient re-run of one job (1-based), and how many re-runs a job gets. */
export const TRANSIENT_COOLDOWN_MS = Object.freeze([300_000, 600_000, 1_200_000, 1_800_000]);
export function transientCooldownMs(count) {
  const override = Number(process.env.PRISM_MEMORY_BENCH_TRANSIENT_COOLDOWN_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  return TRANSIENT_COOLDOWN_MS[Math.min(Math.max(count, 1), TRANSIENT_COOLDOWN_MS.length) - 1];
}
export function transientRetryLimit() {
  const value = Number(process.env.PRISM_MEMORY_BENCH_TRANSIENT_RETRIES ?? 24);
  return Number.isSafeInteger(value) && value >= 0 ? value : 24;
}

/** A 4xx that names an input problem is deterministic: the same arm on the same question will be
 * refused again, so the campaign records it once and stops. `429` and transport errors stay retryable.
 */
export function permanentFailure(report) {
  if (!report || report.status === "completed" || report.status === "token-ceiling") return null;
  const message = String(report.failure?.message ?? "");
  if (/context (length|window)|too many tokens|maximum context/i.test(message)) return "context-exceeds-model";
  if (/unsupported|invalid_request|not supported|does not support/i.test(message)) return "unsupported-by-provider";
  if (/model_not_found|does not exist|unknown model/i.test(message)) return "model-unavailable";
  return null;
}

/**
 * Plan 202 Task 4.15: informational `cacheStability` rows. A live cache probe written as
 * `cache-probe.<route>.json` beside a campaign's evidence is listed next to its verdict, never counted in it.
 */
export async function cacheProbeRows(evidence) {
  const names = (await readdir(evidence).catch(() => [])).filter((name) => /^cache-probe\..+\.json$/.test(name)).sort();
  return Promise.all(
    names.map(async (file) => {
      const probe = JSON.parse(await readFile(join(evidence, file), "utf8"));
      return {
        file,
        route: probe.route,
        status: probe.status,
        requests: probe.requests,
        requestsReadingCache: probe.requestsReadingCache,
        expectedBreakRequest: probe.expectedBreakRequest,
        breakReadsLess: probe.breakReadsLess,
        unexpectedMisses: probe.unexpectedMisses,
        informational: true,
      };
    }),
  );
}

/** A resumed report includes prior usage already charged to a previous held attempt/campaign. */
export function incrementalAttemptUsage(report, prior) {
  const usageComplete = report.usageComplete === true && (!prior || prior.usageComplete === true);
  const result = { usageComplete };
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens"]) {
    const value = report[key] ?? 0;
    const previous = prior?.[key] ?? 0;
    if (usageComplete && (!Number.isSafeInteger(value) || !Number.isSafeInteger(previous) || previous < 0 || value < previous))
      throw new Error("Invalid cumulative usage in resumed report");
    result[key] = usageComplete ? value - previous : value;
  }
  return result;
}

/** Per-mode evidence, journal, manifest and gate rules. 188.8 reuses 188.7's journal machinery. */
/** The owner-gated development screens: free routes plus named paid models, re-run from checkpoint on transient faults. */
const SCREEN_MODES = new Set(["screen208", "screen209"]);

function runSpec(mode) {
  // Plan 209 Task 6: the work-outcome development screen (gate W-1). Loaded lazily, like plan 208's.
  if (mode === "screen209") {
    let built;
    const screen = () => import("./work-outcome/screen.mjs");
    return {
      evidence: "docs/_evidence/memory-bench/209/screen",
      logs: ".cache/memory-bench/209/logs",
      outputPrefix: process.env.PRISM_MEMORY_BENCH_209_SMOKE === "1" ? "smoke-209-task6" : "run-209-task6",
      summaryPath: "docs/_evidence/memory-bench/209/screen/execution-run.json",
      journalPath: ".cache/memory-bench/209/journal.json",
      summaryKind: "209-development-screen-run",
      timeout: "86400s",
      maxAttempts: 2,
      // The gate is verified here, before any evidence file or journal is written.
      build: async () => {
        built = await (await screen()).buildExecutableScreen209Manifest();
        return built;
      },
      write: async () => {
        const { SCREEN209_EXECUTION_MANIFEST } = await screen();
        await mkdir("docs/_evidence/memory-bench/209/screen", { recursive: true });
        await writeFile(
          built.executionManifestPath ?? SCREEN209_EXECUTION_MANIFEST,
          `${JSON.stringify({ generatedAt: new Date().toISOString(), ...built, results: [] }, null, 2)}\n`,
        );
      },
    };
  }
  // Plan 208 Task 5: the ontology development screen. Loaded lazily, since the module builds on this one.
  if (mode === "screen208") {
    let built;
    return {
      evidence: "docs/_evidence/memory-bench/208/screen",
      logs: ".cache/memory-bench/208/logs",
      outputPrefix: process.env.PRISM_MEMORY_BENCH_208_SMOKE
        ? "smoke-208-task5"
        : process.env.PRISM_MEMORY_BENCH_208_QUICK === "1"
          ? "quick-208-task5"
          : "run-208-task5",
      summaryPath: process.env.PRISM_MEMORY_BENCH_208_SMOKE
        ? "docs/_evidence/memory-bench/208/screen/execution-smoke.json"
        : "docs/_evidence/memory-bench/208/screen/execution-run.json",
      journalPath: process.env.PRISM_MEMORY_BENCH_208_SMOKE
        ? ".cache/memory-bench/208/journal-smoke.json"
        : ".cache/memory-bench/208/journal.json",
      summaryKind: "208-development-screen-run",
      timeout: "172800s",
      maxAttempts: 2,
      // The gate is verified here, before any evidence file or journal is written.
      build: async () => {
        built = await (await import("./ontology-screen.mjs")).buildExecutableScreen208Manifest();
        return built;
      },
      // The Kilo catalog is checked at $0 before the first job; a stale row is refused.
      preflight: async (manifest) => {
        const screen = await import("./ontology-screen.mjs");
        const tier = await screen.preflightScreen208(manifest);
        await mkdir(manifest.summaryPath ? dirname(manifest.summaryPath) : "docs/_evidence/memory-bench/208/screen", { recursive: true });
        await writeFile(
          `docs/_evidence/memory-bench/208/screen/free-panel${manifest.worker ? `-worker-${manifest.worker}` : ""}.json`,
          `${JSON.stringify(tier, null, 2)}\n`,
        );
      },
      // The executable record: the proposal plus the verified gate binding.
      write: async () => {
        await mkdir("docs/_evidence/memory-bench/208/screen", { recursive: true });
        await writeFile(
          built.executionManifestPath ?? "docs/_evidence/memory-bench/208/screen/execution-manifest.json",
          `${JSON.stringify({ generatedAt: new Date().toISOString(), ...built, results: [] }, null, 2)}\n`,
        );
      },
    };
  }
  if (mode === "baseline202")
    return {
      evidence: `${BASELINE_EVIDENCE}/muse13-screen`,
      logs: BASELINE_LOGS,
      outputPrefix: "report",
      summaryPath: BASELINE_SUMMARY,
      journalPath: BASELINE_JOURNAL,
      summaryKind: "202-baseline-run",
      timeout: "518400s",
      // One bounded infrastructure retry; quota exhaustion stops this free campaign.
      maxAttempts: 2,
      build: () => assertBaselineReadiness(),
      write: async (manifest) => writeFile(`${BASELINE_EVIDENCE}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`),
    };
  if (mode === "probe1889")
    return {
      evidence: ACCEPTANCE_1889_SCREEN_EVIDENCE,
      logs: ".cache/memory-bench/188.9/probe",
      outputPrefix: "probe",
      summaryPath: null,
      journalPath: ACCEPTANCE_1889_PROBE_JOURNAL,
      summaryKind: null,
      timeout: "1200s",
      maxAttempts: 2,
      build: async () => assertAcceptance1889ProbeManifest(buildAcceptance1889ProbeManifest()),
      write: () => writeProbeManifest1889(),
    };
  if (mode === "acceptance18810")
    return {
      evidence: ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE,
      logs: ACCEPTANCE_18810_LOGS,
      summaryPath: ACCEPTANCE_18810_SUMMARY,
      journalPath: ACCEPTANCE_18810_JOURNAL,
      summaryKind: "188.10-heldout-acceptance-run",
      timeout: "14400s",
      maxAttempts: 3,
      build: () => buildAcceptance18810(),
      write: () => writeAcceptance18810Manifest(),
    };
  if (mode === "screenA18810")
    return {
      evidence: SCREEN_A_EVIDENCE,
      logs: SCREEN_A_LOGS,
      outputPrefix: "screen-a",
      summaryPath: SCREEN_A_SUMMARY,
      journalPath: SCREEN_A_JOURNAL,
      summaryKind: "188.10-stage-a-run",
      timeout: "7200s",
      maxAttempts: 2,
      build: () => buildScreenA(),
      write: () => writeScreenAManifest(),
    };
  if (mode === "screen1889")
    return {
      evidence: ACCEPTANCE_1889_SCREEN_EVIDENCE,
      logs: ".cache/memory-bench/188.9/screen",
      outputPrefix: "screen",
      summaryPath: ACCEPTANCE_1889_SCREEN_SUMMARY,
      journalPath: ACCEPTANCE_1889_SCREEN_JOURNAL,
      summaryKind: "188.9-development-screen-run",
      timeout: "14400s",
      maxAttempts: 2,
      build: () => buildScreen1889(),
      write: () => writeScreenManifest1889(),
    };
  if (mode === "acceptance1889")
    return {
      evidence: ACCEPTANCE_1889_EVIDENCE,
      logs: ACCEPTANCE_1889_LOGS,
      summaryPath: ACCEPTANCE_1889_SUMMARY,
      journalPath: ACCEPTANCE_1889_JOURNAL,
      summaryKind: "188.9-heldout-acceptance-run",
      timeout: "14400s",
      maxAttempts: 3,
      build: () => buildAcceptance1889(),
      write: () => writeAcceptance1889Manifest(),
    };
  if (mode === "acceptance1888")
    return {
      evidence: ACCEPTANCE_1888_EVIDENCE,
      logs: ACCEPTANCE_1888_LOGS,
      summaryPath: ACCEPTANCE_1888_SUMMARY,
      journalPath: ACCEPTANCE_1888_JOURNAL,
      summaryKind: "188.8-heldout-acceptance-run",
      timeout: "14400s",
      maxAttempts: 3,
      build: () => buildAcceptance1888(),
      write: () => writeAcceptance1888Manifest(),
      preflight: (manifest) => prefixArmAudit(manifest),
    };
  if (mode === "acceptance")
    return {
      evidence: ACCEPTANCE_EVIDENCE,
      logs: ACCEPTANCE_LOGS,
      summaryPath: ACCEPTANCE_SUMMARY,
      journalPath: ACCEPTANCE_JOURNAL,
      summaryKind: "188.7-final-acceptance-run",
      timeout: "10800s",
      maxAttempts: 3,
      build: async () => assertAcceptanceManifest(buildAcceptanceManifest()),
      write: () => writeAcceptanceManifest(),
    };
  if (mode === "task5" || mode === "task5-smoke") {
    const smoke = mode === "task5-smoke";
    return {
      evidence: TASK5_EVIDENCE,
      logs: TASK5_LOGS,
      outputPrefix: smoke ? "smoke" : "run",
      summaryPath: smoke ? TASK5_SMOKE_SUMMARY : TASK5_SUMMARY,
      journalPath: smoke ? TASK5_SMOKE_JOURNAL : TASK5_JOURNAL,
      summaryKind: smoke ? "202-task5-smoke-run" : "202-task5-execution-run",
      timeout: "518400s",
      maxAttempts: 2,
      build: () => buildTask5CampaignManifest({ smoke }),
      write: async () => {},
      preflight: (manifest) => preflightTask5(manifest),
      postflight: (manifest, journal) => postflightTask5(manifest, journal),
    };
  }
  return {
    evidence,
    logs,
    manifestPath: `${evidence}/campaign-v2.json`,
    journalPath: JOURNAL_PATH,
    summaryKind: null,
    timeout: "7200s",
    maxAttempts: MAX_ATTEMPTS_PER_JOB,
    build: async () => buildManifest(),
    write: () => writeManifest(),
  };
}

export const JOURNAL_PATH = `${evidence}/campaign-journal.json`;
export const TOKEN_CEILING = 90_000_000;
// Reserve the entire failed first full-context allocation: its wire usage was incomplete.
export const PRIOR_RESERVATION = 10_358_372;
export function campaignJobs() {
  const jobs = [];
  const add = (family, suite, config, ablate = [], ability) => {
    const id = [family, suite, config, ability, ...ablate]
      .filter(Boolean)
      .join("-")
      .replace(/[^\w.=-]/g, "_");
    jobs.push({ id, family, suite, config, ablate, ...(ability ? { ability, subset: "targeted" } : {}) });
  };
  // LoCoMo is comparison-only: one full-context arm is enough to report a comparison.
  for (const config of ["full", "fabric", "fabric-agentic", "om", "om+fabric"])
    for (const suite of ["longmemeval-s", "locomo", "memoryagentbench-cr", "lifecycle"])
      if (suite !== "locomo" || config === "full") add("rerun", suite, config);
  for (const ability of Object.keys(subsets.longmemeval.targeted)) {
    for (const config of ["fabric", "fabric-agentic"]) add("retrieval", "longmemeval-s", config, [], ability);
    for (const spec of ["fabric.stem=off", "fabric.keyWeight=off", "fabric.multiQuery=off"])
      add("retrieval", "longmemeval-s", "fabric-agentic", [spec], ability);
    for (const budget of [600, 1200, 2400])
      add("retrieval", "longmemeval-s", "fabric-agentic", [`fabric.snippetBudget=${budget}`], ability);
  }
  for (const spec of ["om.dates=off", "om.replaceOnReflect=off", "om.taskState=off"]) add("om", "longmemeval-s", "om", [spec]);
  for (const budget of [5000, 10000, 20000])
    add("om", "longmemeval-s", "om", [`om.reflector.observationTokens=${budget}`, `om.dropper.targetTokens=${budget}`]);
  for (const specs of [
    ["fabric.inject=off"],
    ["fabric.inject.query=user"],
    ["fabric.inject=off", "fabric.directory=off"],
    ["fabric.inject=off", "fabric.directory={}"],
    ["fabric.crossSourceDedup=off"],
    ["fabric.consolidate.decider=model"],
  ])
    add("fabric", "memoryagentbench-cr", "fabric", specs);
  for (const specs of [
    ["fabric.promote=off"],
    ["lifecycle.clock=calendar"],
    ["lifecycle.decayMode=exponential"],
    ["lifecycle.capacity=off"],
    ["lifecycle.merge=off"],
    ["fabric.cues=off"],
    ["fabric.rules=off"],
    ...["explicit", "correction", "outcome", "recurrence", "generality", "ephemerality", "derivability"].map((signal) => [
      `promote.signal.${signal}=off`,
    ]),
  ])
    add("lifecycle", "lifecycle", "om+fabric", specs);
  for (const notes of [2, 5, 10, 20, 50, 100, 200, 500])
    add(
      "capacity",
      "lifecycle",
      "om+fabric",
      ["user", "agent", "project"].map((scope) => `fabric.lifecycle.capacity.${scope}.notes=${notes}`),
    );
  return jobs;
}
export { reservation } from "./journal.mjs";

export function buildManifest() {
  return {
    criteriaHash: robustnessCriteriaHash(),
    ceiling: TOKEN_CEILING,
    priorReservation: PRIOR_RESERVATION,
    provider: "opencode-go",
    model: "mimo-v2.5",
    results: [],
    jobs: campaignJobs(),
    unavailable: [{ arm: "fabric-hybrid", reason: "No live embeddings model configured; hash embeddings are not a substitute." }],
    limitations: [
      "OM 5k/10k dropper arms jointly lower the reflector to satisfy the shipped invariant; these are coupled arms.",
      "LoCoMo is comparison-only; only the full-context arm is measured.",
    ],
  };
}

/** Dry run: write the manifest only. It never creates, rewrites or spends from the journal. */
export async function writeManifest(path = `${evidence}/campaign-v2.json`) {
  await mkdir(evidence, { recursive: true });
  const manifest = buildManifest();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Screening jobs may skip injection labels to save judge calls; an acceptance manifest may not,
 * because `injectionPrecision` is part of its evidence (plan 188.9 Task 3).
 */
export function labelInjectionsArg(job, { acceptance = false } = {}) {
  if (job?.labelInjections === undefined) return [];
  if (!["on", "off"].includes(job.labelInjections)) throw new Error("MemoryBenchArguments: labelInjections must be on or off");
  if (job.labelInjections === "off" && acceptance)
    throw new Error("MemoryBenchArguments: --label-injections off is refused in an acceptance manifest");
  return ["--label-injections", job.labelInjections];
}

/**
 * Plan 208 Task 3: the CLI flags an ontology job adds. The job carries `ontology: true` and the arm label
 * (`conversational+O`); claim bundles go to `<claimsDir>/<arm>/`, which `ontology-audit.mjs --campaign` reads as
 * `<campaign>/ontology-claims/<arm>`. An ontology arm builds its concepts on the product path, so it can neither seed
 * from a write-side snapshot nor reuse another arm's answers.
 */
export function ontologyJobArgs(job, { claimsDir = ".cache/memory-bench/ontology-claims" } = {}) {
  if (!job?.ontology) return [];
  if (job.writeSide || job.reuse)
    throw new Error("MemoryBenchArguments: an ontology job takes no write-side snapshot or reuse; it ingests on the product path");
  if (typeof job.ontologyArm !== "string" || !job.ontologyArm)
    throw new Error("MemoryBenchArguments: an ontology job names its arm (for example conversational+O)");
  return [
    "--ontology",
    "--ontology-arm",
    job.ontologyArm,
    "--ontology-claims-dir",
    resolve(job.ontologyClaimsDir ?? claimsDir),
    // Series mode (plan 208 Task 5): the unscored warm-up questions per cluster.
    ...(job.warmup ? ["--warmup", String(job.warmup)] : []),
    // A slow model's per-model settle bound (plan 208 gate amendment 12); absent keeps the pre-registered default.
    ...(job.ontologySettleMs ? ["--ontology-settle-ms", String(job.ontologySettleMs)] : []),
  ];
}

/**
 * The `+O` twin of a base job: the same suite, config, models, judges and subset, with the ontology tier installed.
 * Its answers and judge verdicts live apart from the base arm's, since the pair is compared and must not share them.
 */
export function ontologyTwin(job, { arm }) {
  const { writeSide: _writeSide, reuse: _reuse, ...rest } = job;
  const root = `.cache/memory-bench/ontology/${arm}`;
  return {
    ...rest,
    id: `${job.id}+O`,
    family: `${job.family}+O`,
    ontology: true,
    ontologyArm: arm,
    answersDir: `${root}/answers`,
    judgeCacheDir: `${root}/judge`,
  };
}

/**
 * Plan 208 Task 3: an ontology manifest pins Task 1's criteria hash, the ontology product (fabric plus wiki) and plan
 * 207's prefix-probe record. `assertOntologyManifestPin` refuses one that does not; Task 5 builds its screen with this.
 */
export async function buildOntologyManifest({ jobs, root = ".", ...rest } = {}) {
  const pins = await ontologyManifestPins({ root });
  const twins = jobs.filter((job) => job.ontology);
  if (twins.length === 0) throw new Error("MemoryBenchArguments: an ontology manifest needs at least one ontology job");
  for (const job of twins) ontologyJobArgs(job);
  return { kind: "208-ontology-manifest", ...pins, ...rest, jobs };
}

/** Frozen owner-approved 106M acceptance manifest; dry-run only on --manifest. */
export async function writeAcceptanceManifest(path = ACCEPTANCE_MANIFEST) {
  await mkdir(ACCEPTANCE_EVIDENCE, { recursive: true });
  const manifest = assertAcceptanceManifest(buildAcceptanceManifest());
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Hash the harness and both product trees. The pre-fix worktree must exist for a campaign;
 * a missing worktree leaves its hash null so the validator refuses the manifest.
 */
async function buildAcceptance1888() {
  const prefixProductHash = await sourceFingerprint(PREFIX_PRODUCT_PATHS, PREFIX_WORKTREE).catch(() => null);
  return assertAcceptance1888Manifest(
    buildAcceptance1888Manifest({
      harnessHash: await sourceFingerprint(HARNESS_PATHS),
      productHash: prefixProductHash,
      postfixProductHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS),
    }),
  );
}

/** Plan 188.9 Task 11: held-out acceptance for the screened-in arms, `fabric-xc` out of scope. */
async function buildAcceptance1889() {
  const fullReference = await fullReferenceReuse1889(JSON.parse(await readFile(ACCEPTANCE_1889_FULL_REPORT, "utf8")), heldout1888());
  return assertAcceptance1889Manifest(
    buildAcceptance1889Manifest({
      harnessHash: await sourceFingerprint(HARNESS_PATHS),
      productHash: await sourceFingerprint(WRITE_SIDE_PATHS),
      writeSideKey: await writeSideCacheDir({ config: "fabric-x" }),
      fullReference,
    }),
  );
}

/** Frozen owner-approved 188.9 held-out manifest; dry-run only on --manifest. */
export async function writeAcceptance1889Manifest(path = ACCEPTANCE_1889_MANIFEST) {
  await mkdir(ACCEPTANCE_1889_EVIDENCE, { recursive: true });
  const manifest = await buildAcceptance1889();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Frozen owner-approved 188.8 held-out acceptance manifest; dry-run only on --manifest. */
export async function writeAcceptance1888Manifest(path = ACCEPTANCE_1888_MANIFEST) {
  await mkdir(ACCEPTANCE_1888_EVIDENCE, { recursive: true });
  const manifest = await buildAcceptance1888();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** The probe's own verdict: the concurrency the screen must use, or null before it ran. */
async function probedConcurrency() {
  if (!existsSync(ACCEPTANCE_1889_PROBE_REPORT)) return null;
  const report = JSON.parse(await readFile(ACCEPTANCE_1889_PROBE_REPORT, "utf8"));
  return chooseConcurrency(report.steps);
}

/** Plan 188.9 Task 10 screen: four development arms plus the paid `xc` write side they reuse. */
async function buildScreen1889() {
  return assertAcceptance1889ScreenManifest(
    buildAcceptance1889ScreenManifest({
      harnessHash: await sourceFingerprint(HARNESS_PATHS),
      productHash: await sourceFingerprint(WRITE_SIDE_PATHS),
      writeSideKeys: {
        x: await writeSideCacheDir({ config: "fabric-x" }),
        xc: await writeSideCacheDir({ config: "fabric-xc" }),
      },
      concurrency: await probedConcurrency(),
    }),
  );
}

/** Frozen owner-approved screen manifest; dry-run only on --manifest. */
export async function writeScreenManifest1889(path = ACCEPTANCE_1889_SCREEN_MANIFEST) {
  await mkdir(ACCEPTANCE_1889_SCREEN_EVIDENCE, { recursive: true });
  const manifest = await buildScreen1889();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Plan 188.10 Task 7: the gate-1 Stage A manifest; refused until the owner approves the cap. */
async function buildScreenA() {
  return assertScreenAManifest(
    buildScreenAManifest({
      harnessHash: await sourceFingerprint(HARNESS_PATHS),
      productHash: await sourceFingerprint(WRITE_SIDE_PATHS),
      writeSideKeys: { "write-x": await writeSideCacheDir({ config: "fabric-x" }) },
    }),
  );
}

/** Stage A dry run: write the manifest only. It never creates, rewrites or spends from the journal. */
export async function writeScreenAManifest(path = SCREEN_A_MANIFEST) {
  await mkdir(SCREEN_A_EVIDENCE, { recursive: true });
  const manifest = await buildScreenA();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Task 7's verdict, computed from the pre-registered `T_dev` and the two reports. Task 3's text-free
 * multi-session diagnostic over the reference snapshot runs separately, so Task 8 starts from stages.
 */
export async function writeScreenAVerdict(journal, manifest, path = SCREEN_A_VERDICT) {
  const reports = {};
  const sources = {};
  for (const [arm, id] of Object.entries(SCREEN_A_ARM_IDS)) {
    const attempt = latestAttempt(journal, id);
    if (!attempt?.output || !existsSync(attempt.output)) continue;
    reports[arm] = JSON.parse(await readFile(attempt.output, "utf8"));
    sources[arm] = { jobId: id, attemptId: attempt.attemptId };
  }
  // Plan 214 Task 5b: two arms that a gateway served from different deployments are not a pair.
  if (reports.x && reports["x-tools"]) assertComparableServedDeployments(reports["x-tools"], reports.x, { label: "stage-a" });
  const verdict = reports.x
    ? screenAVerdict({ reference: reports.x, arms: reports["x-tools"] ? { "x-tools": reports["x-tools"] } : {} })
    : { kind: "188.10-stage-a-verdict", incomplete: ["x"], arms: {}, selected: null, next: "stage-b" };
  const payload = { ...verdict, sources, ceiling: manifest?.ceiling ?? SCREEN_A_CEILING };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Task 9: held-out v3 for Stage A's selected arm. The selection comes from the committed verdict and
 * the product must still hash to Stage A's value, so neither can drift into this run.
 */
async function buildAcceptance18810() {
  const verdictBytes = await readFile(SCREEN_A_VERDICT, "utf8");
  const stageAManifest = JSON.parse(await readFile(SCREEN_A_MANIFEST, "utf8"));
  return assertAcceptance18810Manifest(
    buildAcceptance18810Manifest({
      harnessHash: await sourceFingerprint(HARNESS_PATHS),
      product: frozenProduct({ productHash: await sourceFingerprint(WRITE_SIDE_PATHS), stageAManifest }),
      selection: stageASelection(JSON.parse(verdictBytes), {
        fileHash: createHash("sha256").update(verdictBytes).digest("hex"),
      }),
      writeSideKey: await writeSideCacheDir({ config: "fabric-x" }),
    }),
  );
}

/** Held-out dry run: write the manifest only. It never creates, rewrites or spends from the journal. */
export async function writeAcceptance18810Manifest(path = ACCEPTANCE_18810_MANIFEST) {
  await mkdir(ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE, { recursive: true });
  const manifest = await buildAcceptance18810();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Frozen probe manifest; dry-run only on --manifest. */
export async function writeProbeManifest1889(path = ACCEPTANCE_1889_PROBE_MANIFEST) {
  await mkdir(ACCEPTANCE_1889_SCREEN_EVIDENCE, { recursive: true });
  const manifest = assertAcceptance1889ProbeManifest(buildAcceptance1889ProbeManifest());
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Plan 188.9 Task 10 probe evidence: latency and overloads per step, and the step chosen for the
 * screen. Only numbers and statuses: no prompt, answer or note text.
 */
export async function writeProbeReport1889(journal, manifest) {
  const steps = [];
  for (const job of manifest?.jobs ?? []) {
    // Use the run that measured something: a later rerun that hits the answer cache charges
    // nothing and reports sub-millisecond latency, which would make the probe meaningless.
    const attempts = (journal.attempts ?? []).filter((attempt) => attempt.jobId === job.id);
    const rows = [];
    for (const attempt of attempts) {
      if (!attempt.output || !existsSync(attempt.output)) continue;
      const report = JSON.parse(await readFile(attempt.output, "utf8"));
      rows.push({
        concurrency: job.concurrency,
        jobId: job.id,
        attemptId: attempt.attemptId,
        status: report.status ?? attempt.status,
        inputTokens: attemptCharge(attempt),
        p50Ms: report.timing?.questions?.wallMs?.p50 ?? null,
        p95Ms: report.timing?.questions?.wallMs?.p95 ?? null,
        wallMs: report.timing?.wallMs ?? null,
        answers: report.results?.length ?? 0,
        overloads: report.calls?.overloads ?? 0,
        concurrencyHalvings: report.calls?.concurrencyHalvings ?? 0,
      });
    }
    const measured = rows.filter((item) => item.inputTokens > 0 && item.answers > 0).at(-1);
    const row = measured ??
      rows.at(-1) ?? { concurrency: job.concurrency, jobId: job.id, attemptId: null, status: "missing", inputTokens: 0 };
    steps.push(row);
  }
  const chosen = chooseConcurrency(steps);
  await writeFile(ACCEPTANCE_1889_PROBE_REPORT, `${JSON.stringify({ kind: "188.9-concurrency-probe", steps, chosen }, null, 2)}\n`);
  return { steps, chosen };
}

/**
 * Plan 188.9 Task 10 verdict: apply the pre-registered rule to the screen reports and record what
 * proceeds. A failed arm is dropped here, never tuned.
 */
export async function writeScreenVerdict1889(journal, manifest, path = ACCEPTANCE_1889_SCREEN_VERDICT) {
  const reports = {};
  const sources = {};
  for (const [arm, id] of Object.entries(SCREEN_1889_ARM_IDS)) {
    const attempt = latestAttempt(journal, id);
    if (!attempt?.output || !existsSync(attempt.output)) continue;
    reports[arm] = JSON.parse(await readFile(attempt.output, "utf8"));
    sources[arm] = { jobId: id, attemptId: attempt.attemptId };
  }
  const excluded = (manifest?.excluded ?? []).map((item) => item.arm);
  const scored = Object.fromEntries(
    Object.entries({ x: reports.x, xc: reports.xc, "xc-agentic": reports["xc-agentic"] }).filter(([, report]) => report),
  );
  const verdict = reports.baseline
    ? screenVerdict({ baseline: reports.baseline, arms: scored })
    : { incomplete: ["baseline"], arms: {}, proceed: [] };
  // An excluded arm is not a failed arm: it was never measured, and the reason is on the record.
  for (const arm of excluded) {
    const reason = manifest.excluded.find((item) => item.arm === arm)?.reason;
    if (arm.startsWith("write-") || verdict.arms[arm]) continue;
    verdict.arms[arm] = { proceed: false, missing: true, reason: `excluded: ${reason}` };
  }
  const payload = { kind: "188.9-screen-verdict", screen: manifest?.screen ?? null, ...verdict, sources };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Run up to `limit` jobs at once. A failing job stops new launches but never cancels a sibling:
 * each sibling still reconciles its own reservation before the pool drains (plan 188.9 Task 4).
 */
export async function runArmPool(jobs, limit, run) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("MemoryBenchArguments: parallel-arms must be positive");
  const queue = [...jobs];
  const running = new Map();
  let halted = false;
  while (queue.length || running.size) {
    while (!halted && queue.length && running.size < limit) {
      const job = queue.shift();
      running.set(
        job.id,
        Promise.resolve()
          .then(() => run(job))
          .then(
            (outcome) => ({ job, outcome: outcome ?? {} }),
            (error) => ({ job, outcome: { error } }),
          ),
      );
    }
    if (!running.size) break;
    const settled = await Promise.race(running.values());
    running.delete(settled.job.id);
    if (settled.outcome.error) {
      console.error(`job ${settled.job.id} failed: ${settled.outcome.error.message}`);
      halted = true;
    }
    if (settled.outcome.halt) halted = true;
  }
  return { halted };
}

/** A read-side arm runs only when its producer finished and its snapshot is cached locally. */
export function writeSideUnavailable(job, { producer, snapshotPresent }) {
  if (!job.writeSide) return false;
  return producer?.status !== "completed" || !snapshotPresent;
}

/** Write side before read side; everything else keeps manifest order. */
export function orderJobs(jobs) {
  const producers = new Set(jobs.map((job) => job.writeSide).filter(Boolean));
  return [...jobs.filter((job) => producers.has(job.id)), ...jobs.filter((job) => !producers.has(job.id))];
}

function maxInputFor(job, available) {
  const suiteCap =
    job.maxInputTokens ?? (job.suite === "lifecycle" ? 2_000_000 : job.suite === "longmemeval-s" && !job.ability ? 10_000_000 : 5_000_000);
  return Math.floor(Math.min(available, suiteCap));
}

export async function runCampaign(mode = "task6", { parallelArms = 1, screen = false } = {}) {
  if (!Number.isSafeInteger(parallelArms) || parallelArms < 1 || parallelArms > 8)
    throw new Error("MemoryBenchArguments: --parallel-arms must be 1-8");
  if (mode === "baseline202" && parallelArms !== 1) throw new Error("BaselineReadiness: serial arms required");
  const spec = runSpec(mode);
  await mkdir(spec.logs, { recursive: true });
  await mkdir(spec.evidence, { recursive: true });
  const manifest = await spec.build();
  // Plan 202 Task 4.15: no paid campaign runs a product without a passing cache-stability record.
  // The ontology screen runs on the $0 Kilo gateway and is advisory: its cost rows are not the cache-adjusted ones plan
  // 202 pins. Plan 210 Task 9 pins the cache-stability record again before the paid held-out read.
  // Plan 209's screen is advisory on the same terms (free routes plus one cheap named paid model, gate W-1).
  if (!SCREEN_MODES.has(mode)) await assertCacheStabilityPin(manifest);
  const frozenBaseline = mode === "baseline202" ? structuredClone(manifest) : undefined;
  const jobLimit = Number(process.env.PRISM_MEMORY_BENCH_MAX_JOBS ?? 0);
  if (Number.isSafeInteger(jobLimit) && jobLimit > 0) manifest.jobs = manifest.jobs.slice(0, jobLimit);
  manifest.results ??= [];
  if (spec.preflight) await spec.preflight(manifest);
  // Validate the screen profile and the declared dependencies before any evidence file is written.
  const profile = screen ? assertScreenProfile(mode, manifest) : null;
  assertJobDependencies(manifest.jobs);
  await spec.write(frozenBaseline);
  // Absolute: a worktree child inherits this and would otherwise resolve it against its own cwd.
  const journalPath = resolve(process.env.PRISM_MEMORY_BENCH_JOURNAL ?? manifest.journalPath ?? spec.journalPath);
  const lockPath = campaignLockPath(journalPath);
  await mkdir(dirname(journalPath), { recursive: true });
  await acquireCampaignLock(lockPath);
  const children = new Set();
  const stopChildren = () => {
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // The owned child already exited.
      }
    }
    children.clear();
  };
  const onSignal = () => {
    stopChildren();
    void releaseCampaignLock(lockPath).finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const journal = await openJournal({
      path: journalPath,
      manifest,
      legacyDirectory: mode === "task6" ? evidence : undefined,
    });
    abandonUnfinished(journal);
    await saveJournal(journalPath, journal);
    // Plan 188.9 Task 4: parallel arms and the paid-write-side dependency.
    const producers = new Set(manifest.jobs.map((job) => job.writeSide).filter(Boolean));
    // Absolute: a worktree child would otherwise resolve the cache path against its own cwd. The
    // directory is keyed by the producer's config, because `fabric-x` and `fabric-xc` store
    // different notes for the same ids.
    const writeSideDirs = new Map();
    for (const job of manifest.jobs)
      if (producers.has(job.id))
        writeSideDirs.set(job.id, resolve(`${WRITE_SIDE_CACHE}/${await writeSideCacheDir({ config: job.config })}`));
    const writeSideDir = (jobId) => writeSideDirs.get(jobId) ?? null;
    const pushResult = (row) => manifest.results.push(row);
    const jobArgv = (job, attempt, maxInput) => {
      // Plan 209 Task 6: a work-outcome job is its own child (`work-outcome/live.mjs`), under the same journal.
      if (job.kind === "work-outcome")
        return [
          "timeout",
          job.wallTimeCapHours ? `${Math.ceil(job.wallTimeCapHours * 3600)}s` : spec.timeout,
          "bun",
          ...workOutcomeArgv(job, { output: attempt.output, maxInput }),
        ];
      const argv = [
        "timeout",
        job.wallTimeCapHours ? `${Math.ceil(job.wallTimeCapHours * 3600)}s` : spec.timeout,
        "bun",
        "--preload",
        "./scripts/memory-bench/variants.mjs",
        "scripts/memory-bench/run.mjs",
        "--suite",
        job.suite,
        "--config",
        job.config,
        "--provider",
        job.provider ?? "opencode-go",
        "--model",
        job.model ?? "mimo-v2.5",
        "--judges",
        job.judges ?? "opencode-go/mimo-v2.5,hyper/deepseek-v4-flash",
        "--max-input-tokens",
        String(maxInput),
        "--output",
        attempt.output,
      ];
      // A paired comparison must never share answer/judge checkpoints between its arms.
      if (job.answersDir) argv.push("--answers-dir", resolve(job.answersDir));
      if (job.judgeCacheDir) argv.push("--judge-cache-dir", resolve(job.judgeCacheDir));
      if (job.judgeText) argv.push("--judge-text");
      if (job.interleaveAbilities) argv.push("--interleave-abilities");
      if (job.finalTurnAnswer) argv.push("--final-turn-answer");
      const writeOnly = producers.has(job.id);
      if (profile && !writeOnly) {
        argv.push(
          "--subset",
          profile.subset,
          "--phase",
          profile.phase,
          "--label-injections",
          profile.labelInjections,
          "--concurrency",
          String(manifest.concurrency?.concurrency ?? profile.concurrency),
        );
      } else {
        argv.push(...labelInjectionsArg(job, { acceptance: mode.startsWith("acceptance") }));
        if (job.subset) argv.push("--subset", job.subset);
      }
      // A `writeSide` producer builds the store and stops: its answers are never scored, and the
      // read arm that names it pays for the answers once (plan 188.9 Task 9).
      if (writeOnly) argv.push("--phase", "write");
      if (job.freeOnly) argv.push("--free-only");
      // A bounded smoke is a question filter on the approved job, not a different job.
      if (job.maxQuestions) argv.push("--max-questions", String(job.maxQuestions));
      if (job.boundedWire) argv.push("--bounded-wire");
      if (job.freeProductOnly) argv.push("--free-product-only");
      if (job.maxOutputTokens) argv.push("--max-output-tokens", String(job.maxOutputTokens));
      if (job.maxQuestions) argv.push("--max-questions", String(job.maxQuestions));
      if (job.concurrency) argv.push("--concurrency", String(job.concurrency));
      if (job.ability) argv.push("--ability", job.ability);
      if (job.seed) argv.push("--seed", String(job.seed));
      for (const spec of job.ablate ?? []) argv.push("--ablate", spec);
      argv.push(...ontologyJobArgs(job));
      if (job.reuse) {
        argv.push("--reuse-from", job.reuse.from);
        if (job.reuse.fallback === "run") argv.push("--reuse-fallback", "run");
      }
      if (producers.has(job.id)) argv.push("--write-snapshot", writeSideDir(job.id));
      if (job.writeSide) argv.push("--seed-snapshot", writeSideDir(job.writeSide));
      return argv;
    };
    const runJob = async (job) => {
      const retained = mode === "baseline202" ? await assertBaselineContinuation(job) : null;
      if (job.retainedCompletion) {
        pushResult({
          id: job.id,
          status: "completed",
          reused: true,
          source: job.retainedCompletion.path,
          usageComplete: retained.usageComplete !== false,
          charged: 0,
          chargedInPriorCampaign: true,
        });
        return;
      }
      const latest = latestAttempt(journal, job.id);
      if (latest && latest.status === "completed") {
        pushResult({
          id: job.id,
          attemptId: latest.attemptId,
          status: "completed",
          usageComplete: latest.usageComplete !== false,
          reused: true,
          charged: attemptCharge(latest),
        });
        return;
      }
      if (mode !== "task6" && latest?.status === "token-ceiling") {
        pushResult({ id: job.id, attemptId: latest.attemptId, status: "token-ceiling", reused: true });
        return;
      }
      if (latest?.status === "failed-permanent") {
        // The refusal is in the attempt's report; rerunning it would only spend quota again.
        pushResult({ id: job.id, attemptId: latest.attemptId, status: "unsupported", cause: latest.cause ?? null, reused: true });
        return;
      }
      // A spent quota window says nothing about the arm; those attempts are re-run, not counted.
      if (journal.attempts.filter((attempt) => attempt.jobId === job.id && !isBudgetQuotaCause(attempt.cause)).length >= spec.maxAttempts) {
        pushResult({ id: job.id, status: "attempts-exhausted" });
        return;
      }
      // A read-side arm never runs without its write side; the snapshot is never rebuilt silently.
      if (job.writeSide) {
        const producer = latestAttempt(journal, job.writeSide);
        const directory = writeSideDir(job.writeSide);
        const snapshotPresent = Boolean(directory) && existsSync(directory) && (await readdir(directory)).length > 0;
        if (writeSideUnavailable(job, { producer, snapshotPresent })) {
          pushResult({ id: job.id, status: "write-side-missing", writeSide: job.writeSide });
          console.error(`skip ${job.id}: write side ${job.writeSide} is not completed or not cached`);
          return;
        }
      }
      const available = availableTokens(journal);
      const maxInput = maxInputFor(job, available);
      if (maxInput < 100_000) {
        journal.status = "token-ceiling";
        await saveJournal(journalPath, journal);
        return { halt: true };
      }
      const previous = latest;
      const candidateSource = previous?.output && existsSync(previous.output) ? previous.output : job.resumeCheckpoint?.path;
      const candidateReport = candidateSource
        ? candidateSource === job.resumeCheckpoint?.path
          ? retained
          : JSON.parse(await readFile(candidateSource, "utf8"))
        : null;
      // A changed product revision changes the protocol hash, so its checkpoints must not be resumed.
      const armRevision = manifest.productRevision?.[job.role];
      const staleResume = Boolean(candidateReport) && armRevision && candidateReport.sourceRevision !== armRevision;
      if (staleResume)
        console.log(
          `drop ${job.id}: checkpoint is from ${candidateReport.sourceRevision?.slice(0, 8)}, arm runs ${armRevision.slice(0, 8)}`,
        );
      const resumeSource = staleResume ? null : candidateSource;
      const resumeReport = staleResume ? null : candidateReport;
      const attemptNumber = journal.attempts.filter((item) => item.jobId === job.id).length;
      const attempt = reserveAttempt(journal, {
        jobId: job.id,
        // Absolute, so a worktree child writes into this repo's evidence and the child's
        // --output matches the reservation byte for byte.
        // A job id carries `provider/model`, so it must be flattened or the report lands in a
        // directory the aggregator never reads.
        output: resolve(
          `${spec.evidence}/${spec.outputPrefix ?? (mode === "task6" ? "v2" : "final")}-${job.id.replace(/[\\/]/g, "-")}${attemptNumber > 0 ? `-${attemptNumber + 1}` : ""}.json`,
        ),
        maxInputTokens: maxInput,
      });
      await saveJournal(journalPath, journal);
      const variants = historicalVariants(job.ablate ?? []);
      // Provenance is local work: resolve it before the reservation so a network error cannot
      // strand a reserved attempt.
      await variantProvenance(variants);
      const argv = jobArgv(job, attempt, maxInput);
      // Continue only a same-protocol checkpoint; the child validates the hash and refuses mismatches.
      if (resumeSource) argv.push("--resume", resumeSource);
      const log = openSync(`${spec.logs}/${attempt.attemptId.replace(/[^\w.-]/g, "_")}.log`, "w");
      const child = Bun.spawn(argv, {
        cwd: job.cwd ?? process.cwd(),
        env: {
          ...process.env,
          PRISM_MEMORY_BENCH_VARIANTS: JSON.stringify(variants),
          // The report's revision is the product bytes, so a harness commit cannot orphan a checkpoint.
          ...(armRevision ? { PRISM_MEMORY_BENCH_SOURCE: armRevision } : {}),
          PRISM_MEMORY_BENCH_PYTHON: resolve(process.env.PRISM_MEMORY_BENCH_PYTHON ?? ".cache/memory-bench/python/bin/python3"),
          PRISM_MEMORY_BENCH_JOURNAL: journalPath,
          PRISM_MEMORY_BENCH_ATTEMPT: attempt.attemptId,
        },
        stdout: log,
        stderr: log,
      });
      children.add(child);
      console.log(`start ${attempt.attemptId}; cap=${maxInput}; remaining=${availableTokens(journal)}`);
      const exit = await child.exited;
      children.delete(child);
      closeSync(log);
      if (existsSync(attempt.output)) {
        const report = JSON.parse(await readFile(attempt.output, "utf8"));
        const permanent = permanentFailure(report);
        const dailyQuota = dailyFreeQuotaFailure(report);
        const quotaWindow =
          !dailyQuota &&
          (quotaWindowFailure(report) ||
            (mode === "baseline202" && /429|402|quota|free.models.per.day/i.test(report.failure?.message ?? "")));
        const transient = SCREEN_MODES.has(mode) && !dailyQuota && !quotaWindow && transientFailure(report);
        reconcileAttempt(journal, attempt.attemptId, {
          status: dailyQuota
            ? "quota-daily"
            : quotaWindow || transient
              ? "abandoned"
              : permanent
                ? "failed-permanent"
                : report.status === "completed" ||
                    (mode === "probe1889" && report.status === "partial") ||
                    // The quick first read stops at its slice on purpose: a slice answered in full is done.
                    (mode === "screen208" && process.env.PRISM_MEMORY_BENCH_208_QUICK === "1" && report.status === "partial")
                  ? "completed"
                  : report.status === "token-ceiling"
                    ? "token-ceiling"
                    : "failed",
          cause: dailyQuota ? "quota-daily" : quotaWindow ? "quota-window" : transient ? "transient" : (permanent ?? undefined),
          ...(mode === "baseline202"
            ? incrementalAttemptUsage(report, resumeReport)
            : {
                inputTokens: report.inputTokens,
                usageComplete: report.usageComplete !== false,
                cacheReadTokens: report.cacheReadTokens,
                outputTokens: report.outputTokens,
              }),
        });
        pushResult({
          id: job.id,
          attemptId: attempt.attemptId,
          answersDir: job.answersDir,
          status: dailyQuota
            ? "quota-daily"
            : quotaWindow
              ? "quota-pause"
              : transient
                ? "transient-retry"
                : permanent
                  ? "unsupported"
                  : report.status,
          cause: dailyQuota
            ? "quota-daily"
            : quotaWindow
              ? "quota-window"
              : transient
                ? "transient"
                : (permanent ?? report.failure?.message ?? null),
          usageComplete: report.usageComplete !== false,
          charged: attemptCharge(journal.attempts.at(-1)),
        });
      } else {
        // Reserve, do not refund: a child can spend before it writes any report.
        reconcileAttempt(journal, attempt.attemptId, {
          status: "setup-failure",
          inputTokens: attempt.reservedInputTokens,
          usageComplete: false,
        });
        pushResult({ id: job.id, attemptId: attempt.attemptId, status: "setup-failure", exit });
        console.error(`failed ${attempt.attemptId}; no report (exit ${exit}); reserved ${attempt.reservedInputTokens}`);
        // No report means the harness or arguments are broken, not the arm: stop launching new
        // arms, but let the running siblings reconcile. A rerun resumes from the journal.
        journal.status = "setup-failure";
        await saveJournal(journalPath, journal);
        return { halt: true };
      }
      if (journal.attempts.at(-1)?.cause === "quota-daily") {
        // A daily cap reopens once: halt, keep the attempt out of the attempt budget, and let a
        // rerun continue from the answers/judge checkpoints the finished questions already wrote.
        journal.status = "quota-daily";
        journal.resumeAfter = nextDailyReset().toISOString();
        await saveJournal(journalPath, journal);
        console.error(`halt ${attempt.attemptId}: daily free-model cap reached; resume after ${journal.resumeAfter}`);
        return { halt: true };
      }
      if (journal.attempts.at(-1)?.cause === "quota-window") {
        if (mode === "baseline202") {
          journal.status = "quota-unavailable";
          await recordBaselineQuota(attempt.attemptId);
          await saveJournal(journalPath, journal);
          return { halt: true };
        }
        const pauseMs = Number(process.env.PRISM_MEMORY_BENCH_QUOTA_PAUSE_MS ?? 900_000);
        journal.status = "quota-pause";
        await saveJournal(journalPath, journal);
        console.error(`pause ${attempt.attemptId}: quota window closed; waiting ${Math.round(pauseMs / 60000)} min`);
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
        // The plan 208 and 209 screens re-run the same job from its checkpoint instead of leaving it for a later campaign.
        if (SCREEN_MODES.has(mode)) {
          journal.status = "active";
          await saveJournal(journalPath, journal);
          return runJob(job);
        }
        return;
      }
      if (journal.attempts.at(-1)?.cause === "transient") {
        const count = journal.attempts.filter((item) => item.jobId === job.id && item.cause === "transient").length;
        if (count > transientRetryLimit()) {
          console.error(`give up ${attempt.attemptId}: ${count} transient failures`);
          pushResult({ id: job.id, attemptId: attempt.attemptId, status: "transient-exhausted" });
          await saveJournal(journalPath, journal);
          return;
        }
        const waitMs = transientCooldownMs(count);
        console.error(
          `retry ${attempt.attemptId}: transient provider fault (${count}); re-running from checkpoint in ${Math.round(waitMs / 60000)} min`,
        );
        await saveJournal(journalPath, journal);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return runJob(job);
      }
      console.log(`end ${attempt.attemptId}; charged=${attemptCharge(journal.attempts.at(-1))}; remaining=${availableTokens(journal)}`);
      await saveJournal(journalPath, journal);
    };
    await runArmPool(orderJobs(manifest.jobs), parallelArms, runJob);
    if (mode === "probe1889") await writeProbeReport1889(journal, manifest);
    if (mode === "screen1889") await writeScreenVerdict1889(journal, manifest);
    if (mode === "screenA18810") await writeScreenAVerdict(journal, manifest);
    if (journal.status === "active") journal.status = "finished";
    await saveJournal(journalPath, journal);
    if (spec.postflight) await spec.postflight(manifest, journal);
    if (spec.summaryKind) {
      const cacheStability = await cacheProbeRows(spec.evidence);
      const summary = {
        kind: spec.summaryKind,
        journal: {
          campaignId: journal.campaignId,
          status: journal.status,
          ceiling: journal.ceiling,
          spend: journalSpend(journal),
          attempts: journal.attempts.map(({ attemptId, jobId, status, usageComplete, reservedInputTokens, confirmedInputTokens }) => ({
            attemptId,
            jobId,
            status,
            usageComplete: usageComplete !== false,
            reservedInputTokens,
            confirmedInputTokens: confirmedInputTokens ?? null,
          })),
        },
        ...(cacheStability.length ? { cacheStability } : {}),
        results: manifest.results,
      };
      await writeFile(manifest.summaryPath ?? spec.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    }
  } finally {
    stopChildren();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await releaseCampaignLock(lockPath);
  }
}

if (import.meta.main) {
  const planArg = process.argv.includes("--plan") ? process.argv[process.argv.indexOf("--plan") + 1] : undefined;
  const mode =
    planArg === "208"
      ? "screen208"
      : planArg === "209"
        ? "screen209"
        : process.argv.includes("--baseline-202")
          ? "baseline202"
          : process.argv.includes("--task5")
            ? "task5"
            : process.argv.includes("--task5-smoke")
              ? "task5-smoke"
              : process.argv.includes("--acceptance-188.10-screen-a")
                ? "screenA18810"
                : process.argv.includes("--acceptance-188.10")
                  ? "acceptance18810"
                  : process.argv.includes("--acceptance-188.9-probe")
                    ? "probe1889"
                    : process.argv.includes("--acceptance-188.9-screen")
                      ? "screen1889"
                      : process.argv.includes("--acceptance-188.9")
                        ? "acceptance1889"
                        : process.argv.includes("--acceptance-188.8")
                          ? "acceptance1888"
                          : process.argv.includes("--acceptance")
                            ? "acceptance"
                            : "task6";
  if (mode === "screen208") {
    // Plan 208 reads the development partition only; held-out reads belong to plan 210 Task 9's manifest.
    const { assertScreen208Partition, writeScreen208Manifest } = await import("./ontology-screen.mjs");
    const partition = process.argv.includes("--partition") ? process.argv[process.argv.indexOf("--partition") + 1] : undefined;
    try {
      assertScreen208Partition(partition);
    } catch (error) {
      console.error(`${error.name}: ${error.message}`);
      process.exit(1);
    }
    if (process.argv.includes("--manifest")) {
      const manifest = await writeScreen208Manifest();
      console.log(
        `manifest ${manifest.manifestHash}; ${manifest.jobs.length} jobs; docs/_evidence/memory-bench/208/screen/development-screen-manifest.json`,
      );
      process.exit(0);
    }
  }
  if (mode === "screen209") {
    // Plan 209 reads the work-outcome and plan 202 development partitions only; held-out reads are plan 210 Task 9's.
    const { assertScreen209Partition, writeScreen209Manifest, SCREEN209_MANIFEST } = await import("./work-outcome/screen.mjs");
    const partition = process.argv.includes("--partition") ? process.argv[process.argv.indexOf("--partition") + 1] : undefined;
    try {
      assertScreen209Partition(partition);
    } catch (error) {
      console.error(`${error.name}: ${error.message}`);
      process.exit(1);
    }
    if (process.argv.includes("--manifest")) {
      const manifest = await writeScreen209Manifest();
      console.log(`manifest ${manifest.manifestHash}; ${manifest.jobs.length} jobs; ${SCREEN209_MANIFEST}`);
      process.exit(0);
    }
  }
  if (process.argv.includes("--manifest") && process.argv.includes("--plan")) {
    const plan = process.argv[process.argv.indexOf("--plan") + 1];
    if (plan !== "202-baseline") throw new Error(`CampaignPlan: unsupported plan ${plan}`);
    await writeReadiness();
    process.exit(0);
  }
  if (process.argv.includes("--manifest")) {
    if (mode === "baseline202") await writeReadiness();
    else if (mode === "screenA18810") await writeScreenAManifest();
    else if (mode === "acceptance18810") await writeAcceptance18810Manifest();
    else if (mode === "probe1889") await writeProbeManifest1889();
    else if (mode === "screen1889") await writeScreenManifest1889();
    else if (mode === "acceptance1889") await writeAcceptance1889Manifest();
    else if (mode === "acceptance1888") await writeAcceptance1888Manifest();
    else if (mode === "acceptance") await writeAcceptanceManifest();
    else if (mode === "task5") await (process.argv.includes("--screen") ? writeTask5ScreenManifest() : writeTask5ComparisonManifest());
    else await writeManifest();
    process.exit(0);
  }
  try {
    const parallelArms = process.argv.includes("--parallel-arms")
      ? Number(process.argv[process.argv.indexOf("--parallel-arms") + 1] ?? NaN)
      : 1;
    await runCampaign(mode, { parallelArms, screen: process.argv.includes("--screen") });
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
