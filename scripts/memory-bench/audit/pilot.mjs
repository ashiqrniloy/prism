#!/usr/bin/env bun
/** Task 4.7: a fixed development pilot, never a broad-campaign entry point. */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgent, resolveInputCap } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { HARNESS_PATHS, PREFIX_PRODUCT_PATHS, sourceFingerprint } from "../acceptance.mjs";
import { loadDataset, normalizeDataset, selectQuestions } from "../datasets.mjs";
import {
  acquireCampaignLock,
  campaignLockPath,
  openJournal,
  reconcileAttempt,
  releaseCampaignLock,
  reserveAttempt,
  saveJournal,
  stableHash,
} from "../journal.mjs";
import {
  combineGraded,
  combineVerdicts,
  createAnswerCache,
  GRADED_TEMPLATE_VERSION,
  JUDGE_TEMPLATE_VERSION,
  resolveJudgePanel,
  scoreAnswer,
  scoreGraded,
} from "../judge.mjs";
import { BENCH_MAX_TURNS, replay } from "../replay.mjs";
import { robustnessCriteriaHash } from "../robustness.mjs";
import { askJudge, missingUsageCount, refOf } from "../run.mjs";
import { pairedAnalysis } from "../stats.mjs";
import { createTiming } from "../timing.mjs";
import { cacheAdjustedCost } from "../usage.mjs";
import { ANSWER_COMPAT, ANSWER as ORIGINAL_ANSWER, JUDGES as ORIGINAL_JUDGES, openDiagnostic } from "./zero-score.mjs";

const READINESS_REVISION = process.argv.includes("--readiness-v6")
  ? 6
  : process.argv.includes("--readiness-v5")
    ? 5
    : process.argv.includes("--readiness-v4")
      ? 4
      : process.argv.includes("--readiness-v3")
        ? 3
        : process.argv.includes("--readiness-v2")
          ? 2
          : process.argv.includes("--readiness")
            ? 1
            : 0;
const PANEL_TRANSITION = READINESS_REVISION === 6;
const JUDGES = PANEL_TRANSITION ? ["commandcode/minimax/minimax-m3.1-flash", "commandcode/z-ai/glm-5.3-flash"] : ORIGINAL_JUDGES;
const PANEL_RATES = {
  "commandcode/minimax/minimax-m3.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: null },
  "commandcode/z-ai/glm-5.3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: null },
};
const SOURCE_ROOT = ".cache/memory-bench/audit/4.8-pilot-v5";
const SOURCE_EVIDENCE = "docs/_evidence/memory-bench/202/readiness-pilot-v5";
const READINESS_V2 = READINESS_REVISION >= 2;
const READINESS = READINESS_REVISION > 0;
export function readinessAnswerProfile(revision) {
  if (![1, 2, 3, 4, 5, 6].includes(revision)) throw new Error("Unknown readiness revision");
  return revision >= 5
    ? {
        ref: "commandcode/meta/muse-spark-1.3-contributor",
        freeOnly: false,
        rate: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: null },
      }
    : {
        ref: revision === 1 ? "commandcode/reflection/beam:free" : "commandcode/stealth/glyph-cluster:free",
        freeOnly: true,
        rate: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
}
export function pilotProductCost(usage, profile) {
  return cacheAdjustedCost(usage, profile.rate);
}
const ANSWER_PROFILE = READINESS
  ? readinessAnswerProfile(READINESS_REVISION)
  : { ref: ORIGINAL_ANSWER, freeOnly: false, rate: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const ANSWER = ANSWER_PROFILE.ref;
export const ROOT = READINESS
  ? `.cache/memory-bench/audit/4.8-pilot${READINESS_V2 ? `-v${READINESS_REVISION}` : ""}`
  : ".cache/memory-bench/audit/4.7-v3";
export const EVIDENCE = READINESS
  ? `docs/_evidence/memory-bench/202/readiness-pilot${READINESS_V2 ? `-v${READINESS_REVISION}` : ""}`
  : "docs/_evidence/memory-bench/202/pilot-v3";
const PRIOR_EVIDENCE = "docs/_evidence/memory-bench/202/pilot-v2";
const PRIOR_ROOT = ".cache/memory-bench/audit/4.7-v2";
// The two prior attempts remain charged; this is only the original allowance's remainder.
export const LIMITS = READINESS
  ? {
      wireAttempts: 300,
      inputTokens: 50_000_000,
      outputTokens: 1_000_000,
      wallMs: READINESS_REVISION >= 5 ? 86_400_000 : READINESS_REVISION >= 3 ? 28_800_000 : 14_400_000,
      activeWallMs: 14_400_000,
      retries429: 4,
    }
  : { wireAttempts: 175, inputTokens: 6_636_891, outputTokens: 556_447, wallMs: 5_126_636, retries429: 4 };
const COMPLETION_LIMITS = { wireAttempts: 48, inputTokens: 2_000_000, outputTokens: 100_000, wallMs: 1_800_000, retries429: 0 };
const CONFIGS = ["full", "lexical-topk", "fabric-x", "fabric-x-tools"];
const RUBRIC = new Set(["event_ordering", "summarization"]);
const PREFERRED = new Set([
  "5:abstention:1",
  "5:event_ordering:0",
  "10:preference_following:1",
  "10:summarization:0",
  "19:temporal_reasoning:1",
]);
const json = async (path, data, privateFile = false) =>
  writeFile(path, `${JSON.stringify(data, null, 2)}\n`, privateFile ? { mode: 0o600 } : {});

export function validateContinuation(prior, current) {
  if (prior.kind !== "202-corrected-pilot-v2") throw new Error("Pilot continuation requires the preserved v2 protocol");
  for (const key of [
    "productHash",
    "criteriaHash",
    "answerModel",
    "judges",
    "generation",
    "jobs",
    "judgeTemplateVersion",
    "gradedTemplateVersion",
    "annotationPolicy",
  ])
    if (stableHash(prior[key]) !== stableHash(current[key])) throw new Error(`Pilot continuation changed ${key}`);
}

/** Judge-only owner transition: answers and their original protocol stay immutable. */
export function validateJudgeTransition(original, answers, current) {
  if (
    original.kind !== "202-readiness-pilot-v5" ||
    answers.status !== "answers_completed" ||
    answers.manifestHash !== stableHash(original) ||
    answers.accounting?.usageComplete !== true
  )
    throw new Error("Judge transition requires complete proven v5 answers");
  for (const key of [
    "answerModel",
    "generation",
    "jobs",
    "criteriaHash",
    "productHash",
    "sdkHash",
    "judgeTemplateVersion",
    "gradedTemplateVersion",
    "annotationPolicy",
  ])
    if (stableHash(original[key]) !== stableHash(current[key])) throw new Error(`Judge transition changed ${key}`);
  if (
    answers.cells.length !== original.jobs.length ||
    original.jobs.some(
      (job) =>
        !answers.cells.some(
          (row) =>
            row.jobId === job.id &&
            (job.config === "full-truncated" || (row.answerKey && row.outcome === "completed" && row.correct === undefined)),
        ),
    )
  )
    throw new Error("Judge transition source is missing answers or contains scores");
}

export function pilotMayStart(usage, elapsed, limits = LIMITS) {
  return (
    (usage.wireAttempts ?? 0) < limits.wireAttempts &&
    (usage.inputTokens ?? 0) < limits.inputTokens &&
    (usage.outputTokens ?? 0) < limits.outputTokens &&
    elapsed < limits.wallMs
  );
}

export function pilotDisposition(jobs, rows) {
  return jobs.map((job) => ({ ...job, ...(rows.find((row) => row.jobId === job.id) ?? { outcome: "not_started" }) }));
}

/** Missing/ineligible/evaluation-failed rows never become a zero or an available-case comparison. */
export function pilotComparisons(rows, ids) {
  const out = [];
  for (const config of CONFIGS.slice(1).filter((config) => rows.some((row) => row.config === config))) {
    for (const ability of [null, ...new Set(rows.map((row) => row.ability))]) {
      const expected = ids.filter((id) => ability === null || rows.some((row) => row.id === id && row.ability === ability));
      const a = rows.filter((row) => row.config === "full" && expected.includes(row.id));
      const b = rows.filter((row) => row.config === config && expected.includes(row.id));
      const row = { comparator: "full", config, ability, intended: expected.length, descriptiveOnly: true };
      if (
        !expected.length ||
        a.length !== expected.length ||
        b.length !== expected.length ||
        [...a, ...b].some((r) => typeof r.correct !== "boolean")
      ) {
        out.push({ ...row, status: "incomplete" });
        continue;
      }
      const graded = RUBRIC.has(ability);
      if (graded && [...a, ...b].some((r) => !Number.isFinite(r.graded))) throw new Error("Pilot missing graded score");
      out.push({
        ...row,
        status: "complete",
        primary: graded ? "graded" : "binary",
        binary: pairedAnalysis(a, b),
        ...(graded ? { graded: pairedAnalysis(a, b, { metric: (r) => r.graded }) } : {}),
      });
    }
  }
  return out;
}

async function questions() {
  const dev = selectQuestions(normalizeDataset(await loadDataset("beam-100k"), "beam-100k"), "beam-100k", { subset: "dev" });
  return [...new Set(dev.map((q) => q.ability))].sort().map((ability) => {
    const candidates = dev.filter((q) => q.ability === ability).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return candidates.find((q) => PREFERRED.has(q.id)) ?? candidates[0];
  });
}

async function manifest(selected) {
  const jobs = selected.flatMap((q) =>
    [...CONFIGS, "full-truncated", ...(RUBRIC.has(q.ability) ? ["oracle"] : [])].map((config) => ({
      id: `${config}.${q.id}`,
      questionId: q.id,
      suite: "beam-100k",
      subset: "dev",
      ability: q.ability,
      config,
    })),
  );
  const result = {
    kind: "202-corrected-pilot-v3",
    supersedes: `${PRIOR_EVIDENCE}/manifest.json`,
    priorUsage: { wireAttempts: 125, inputTokens: 1_363_109, outputTokens: 143_553, wallMs: 2_073_364 },
    totalLimits: { wireAttempts: 300, inputTokens: 8_000_000, outputTokens: 700_000, wallMs: 7_200_000 },
    repair:
      "Continue independent cells after an evaluation failure; stop on quota or declared limits. Preserve validated v2 scores, rejudge its saved failed answer, and attempt all remaining cells. No v1 answer/score is reused. Answer, grading, prompts, model parameters and turn budgets unchanged from v2.",
    task: "4.7",
    subset: "dev",
    answerModel: ANSWER,
    judges: JUDGES,
    limits: LIMITS,
    concurrency: 1,
    generation: { temperature: 0, maxTokens: 8192, reasoning: false, maxTurns: BENCH_MAX_TURNS.standard },
    configurationLabel: "bounded diagnostic configuration, reasoning disabled and output capped; not the acceptance/product configuration",
    annotationPolicy:
      "binary plus graded rubric evaluation only; no injection-utility annotation calls; source labels/rubrics excluded from normal answer prompts",
    selectionPolicy:
      "one id per ability, preferring five historical run-limit ids; completion-enriched descriptive screen, not an accuracy estimate of the full dev draw",
    fullTruncated:
      "equivalent policy when history fits; no duplicate request; ineligible full cells retain a distinct bounded comparator disposition",
    oracle: "two rubric ceiling cells, diagnostic-only; excluded from all paired comparisons and lever rankings",
    calibration: "owner-waived; model-assisted, not human calibrated; free panel development-only",
    billing: "OpenRouter :free only, $0; no automatic paid fallback",
    criteriaHash: robustnessCriteriaHash(),
    productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS),
    harnessHash: await sourceFingerprint(HARNESS_PATHS),
    completionProbe: {
      models: ["opencode-go/beam-free", "opencode-go/minimax-m3"],
      ids: ["19:temporal_reasoning:1"],
      config: "fabric-x-tools",
      maxTokens: 4096,
      maxTurns: BENCH_MAX_TURNS.standard,
      limits: COMPLETION_LIMITS,
      billing: "existing subscription only; no paid fallback; stop each route on quota error",
    },
    judgeTemplateVersion: JUDGE_TEMPLATE_VERSION,
    gradedTemplateVersion: GRADED_TEMPLATE_VERSION,
    provider: "openrouter",
    model: refOf(ANSWER).model,
    ceiling: LIMITS.inputTokens + 500_000,
    jobs,
  };
  if (READINESS) {
    result.kind = `202-readiness-pilot-v${READINESS_REVISION}`;
    result.wallPolicy =
      READINESS_REVISION >= 5
        ? "24 hours overall to cover the observed OpenRouter daily reset; four active execution hours; one shared reservation across answers and scoring."
        : READINESS_REVISION >= 3
          ? "Eight hours overall including the declared quota wait; four active execution hours; one shared reservation across answers and scoring."
          : "Four hours from execution start; pre-execution quota wait is separate.";
    result.sdkHash = await sourceFingerprint(["src", "packages/providers"]);
    if (READINESS_REVISION >= 3)
      result.executionPhases = {
        answers: "42 frozen checkpoints, no judge calls",
        judging: "same checkpoints only, one shared attempt and cumulative budgets; regeneration refused",
      };
    result.task = "4.8";
    result.supersedes =
      READINESS_REVISION >= 5
        ? "Owner selected paid Muse Spark 1.3 Contributor; preserve v4 and broad Lightning results; fresh model answers, unchanged panel and scoring protocol"
        : READINESS_REVISION === 4
          ? "v3 refused all answer calls with expired Command Code API key; zero token usage retained; no answer or score reused"
          : READINESS_REVISION >= 3
            ? "v2 stopped on local proxy idle reset and confirmed OpenRouter daily quota; prior charges retained; no answer or score reused"
            : READINESS_V2
              ? "readiness-pilot v1 aborted on Beam imported-history 400; full allocation retained; no answers or scores reused"
              : "pilot-v3 is retained as historical diagnosis; no answers or scores reused";
    result.priorUsage = { wireAttempts: 0, inputTokens: 0, outputTokens: 0, wallMs: 0 };
    result.totalLimits = LIMITS;
    result.repair =
      "Fresh 52-cell pilot with per-wire-attempt context/output bounds and complete Responses usage parsing. The selected model and billing are frozen; historical debt is not refunded.";
    result.provider = "commandcode";
    result.generation.reasoning = "provider default; no override";
    result.configurationLabel =
      "frozen baseline model configuration, 8192 output cap, eight-turn stop, provider-default reasoning; no acceptance claim";
    result.billing =
      READINESS_REVISION >= 5
        ? "Owner authorized commandcode/meta/muse-spark-1.3-contributor; $0.10 input/$0.20 output/$0.002 cache-read per million tokens (official pricing 2026-10-29). Existing OpenRouter free judges; no other paid route or fallback."
        : "Explicitly free Command Code answer route and OpenRouter free judges only; no fallback";
    if (READINESS_REVISION >= 5)
      result.paidAuthorization = {
        text: "go forward with this model. And then continue with the task 4 WIP",
        model: ANSWER,
        rates: ANSWER_PROFILE.rate,
        pricingSource: "https://commandcode.ai/docs/resources/pricing-limits",
        conservativeInputOutputCostUsd: 5.2,
      };
    delete result.completionProbe;
  }
  if (PANEL_TRANSITION) {
    const original = JSON.parse(await readFile(join(SOURCE_EVIDENCE, "manifest.json"), "utf8"));
    const answers = JSON.parse(await readFile(join(SOURCE_EVIDENCE, "answer-phase-results.json"), "utf8"));
    validateJudgeTransition(original, answers, result);
    result.answerSource = { manifestHash: stableHash(original), resultsHash: stableHash(answers), checkpoints: {} };
    for (const row of answers.cells.filter((row) => row.answerKey))
      result.answerSource.checkpoints[row.answerKey] = stableHash(
        JSON.parse(await readFile(join(SOURCE_ROOT, "checkpoints", `${row.answerKey}.json`), "utf8")),
      );
    result.supersedes = "Owner replaced only the evaluation panel; reuse all 42 v5 answers without regeneration or score reuse";
    result.billing =
      "Owner authorized MiniMax M3.1 Flash (free first; free window ended HTTP 403, paid selected) and GLM 5.3 Flash from Command Code as judges. Muse answers already paid and preserved. No other paid route.";
    result.judgeAuthorization = {
      minimax:
        "Use Minimax m3.1 flash as the judge from command code. Try the free route first. If that is not available, go with the paid route",
      glm: "Use GLM 5.3 flash from command code as the other judge",
    };
    result.calibration = "owner-waived; model-assisted, not human calibrated; two distinct model families, development-only";
    result.judgeRates = PANEL_RATES;
    result.executionPhases.judging =
      "42 immutable v5 answers only; separate scoring journal charges new evaluation usage, original v5 reservation retained; no answer calls";
    result.reservationPolicy =
      "Original v5 50.5M reservation retained without refund. New scoring attempt charges only newly measured evaluation input, or retains its full reservation if usage incomplete.";
  }
  return result;
}

/** Bounded private provider trace; no changes to requests, tools or stopping. */
export function tracedProviders(providers, trace) {
  return providers.map((provider) => ({
    ...provider,
    async *generate(request) {
      const turn = {
        messageCount: request.messages.length,
        messages: request.messages.slice(-16).map((m) => ({ role: m.role, content: JSON.stringify(m.content).slice(0, 4096) })),
        events: [],
      };
      if (trace.length < 16) trace.push(turn);
      for await (const event of provider.generate(request)) {
        if (!["content_delta", "tool_call_delta", "reasoning_delta"].includes(event.type) && turn.events.length < 64)
          turn.events.push(JSON.stringify(event).slice(0, 4096));
        yield event;
      }
    },
  }));
}

export function combinePilotUsage(prior, current) {
  const keys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "wireAttempts",
    "accountedInputTokens",
    "accountedOutputTokens",
    "usageMissingExchanges",
  ];
  return {
    ...Object.fromEntries(keys.map((key) => [key, (prior?.[key] ?? 0) + (current?.[key] ?? 0)])),
    usageComplete: prior?.usageComplete !== false && current?.usageComplete === true,
  };
}

export function pilotPhaseLimits(prior, elapsedOverall, elapsedActive, limits = LIMITS) {
  if (prior?.usageComplete !== true) throw new Error("Pilot prior usage is incomplete");
  const result = {
    ...limits,
    wireAttempts: limits.wireAttempts - prior.wireAttempts,
    inputTokens: limits.inputTokens - prior.accountedInputTokens,
    outputTokens: limits.outputTokens - prior.accountedOutputTokens,
    wallMs: Math.min(limits.wallMs - elapsedOverall, (limits.activeWallMs ?? limits.wallMs) - elapsedActive),
  };
  if ([result.wireAttempts, result.inputTokens, result.outputTokens, result.wallMs].some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("Pilot budgets exhausted");
  return result;
}

export async function runPilot({ freeze = false, answersOnly = false, scoreOnly = false } = {}) {
  if (PANEL_TRANSITION && !scoreOnly) throw new Error("Judge transition is score-only; answer regeneration refused");
  if ((answersOnly || scoreOnly) && READINESS_REVISION < 3) throw new Error("Phased execution requires readiness v3 or later");
  if (answersOnly && scoreOnly) throw new Error("Choose one pilot phase");
  const selected = await questions();
  if (selected.length !== 10) throw new Error("Pilot requires exactly ten development abilities");
  const frozen = await manifest(selected);
  const prior = scoreOnly
    ? JSON.parse(await readFile(join(PANEL_TRANSITION ? SOURCE_EVIDENCE : EVIDENCE, "answer-phase-results.json"), "utf8"))
    : READINESS
      ? {
          cells: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            wireAttempts: 0,
            accountedInputTokens: 0,
            accountedOutputTokens: 0,
            usageMissingExchanges: 0,
          },
          timing: { wallMs: 0 },
        }
      : JSON.parse(await readFile(join(PRIOR_EVIDENCE, "results.json"), "utf8"));
  if (
    scoreOnly &&
    (prior.status !== "answers_completed" ||
      (!PANEL_TRANSITION && prior.manifestHash !== stableHash(frozen)) ||
      prior.accounting?.usageComplete !== true)
  )
    throw new Error("Pilot scoring requires complete, accounted answers from this frozen manifest");
  if (
    scoreOnly &&
    frozen.jobs.some(
      (job) =>
        job.config !== "full-truncated" &&
        !prior.cells.some(
          (row) =>
            row.jobId === job.id &&
            row.answerKey &&
            existsSync(join(PANEL_TRANSITION ? SOURCE_ROOT : ROOT, "checkpoints", `${row.answerKey}.json`)),
        ),
    )
  )
    throw new Error("Pilot scoring checkpoint missing; regeneration refused");
  if (!READINESS) {
    const priorManifest = JSON.parse(await readFile(join(PRIOR_EVIDENCE, "manifest.json"), "utf8"));
    validateContinuation(priorManifest, frozen);
    if (prior.manifestHash !== stableHash(priorManifest)) throw new Error("Pilot continuation provenance mismatch");
    frozen.continuation = {
      manifestHash: stableHash(priorManifest),
      resultsHash: stableHash(prior),
      policy: "valid v2 scores retained; failed v2 answer rejudged; no v1 score/answer reused",
    };
  }
  await mkdir(EVIDENCE, { recursive: true });
  if (freeze) {
    if (existsSync(join(EVIDENCE, "manifest.json"))) throw new Error("Pilot manifest already frozen");
    await json(join(EVIDENCE, "manifest.json"), frozen);
    return;
  }
  const pinned = JSON.parse(await readFile(join(EVIDENCE, "manifest.json"), "utf8"));
  if (stableHash(frozen) !== stableHash(pinned)) throw new Error("Pilot protocol drift; version and freeze a new pilot");
  resolveJudgePanel({ judges: JUDGES, answerModel: ANSWER });
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  const journalPath = join(ROOT, "journal.json");
  const lock = campaignLockPath(journalPath);
  await acquireCampaignLock(lock);
  const journal = await openJournal({ path: journalPath, manifest: frozen });
  if (journal.attempts.length && !scoreOnly) {
    await releaseCampaignLock(lock);
    throw new Error("Pilot already attempted; inspect checkpoints and version any retry");
  }
  if (
    scoreOnly &&
    !PANEL_TRANSITION &&
    (journal.attempts.length !== 1 || journal.attempts[0].phase !== "awaiting-evaluation" || journal.attempts[0].status !== "running")
  ) {
    await releaseCampaignLock(lock);
    throw new Error("Pilot scoring requires the existing held reservation");
  }
  if (PANEL_TRANSITION && journal.attempts.length) {
    await releaseCampaignLock(lock);
    throw new Error("Judge transition already attempted; inspect saved scores before a versioned retry");
  }
  const attempt =
    scoreOnly && !PANEL_TRANSITION
      ? journal.attempts[0]
      : reserveAttempt(journal, {
          jobId: "bounded-pilot",
          output: join(EVIDENCE, "results.json"),
          maxInputTokens: LIMITS.inputTokens,
        });
  attempt.status = "running";
  attempt.phase = scoreOnly ? "evaluating" : "answers";
  journal.status = "active";
  await saveJournal(journalPath, journal);
  const started = READINESS ? Date.parse(attempt.startedAt) : Date.now();
  const phaseStarted = Date.now();
  const phaseLimits = scoreOnly
    ? pilotPhaseLimits(prior.accounting, phaseStarted - started, prior.activeWallMs ?? prior.timing.wallMs)
    : READINESS
      ? { ...LIMITS, wallMs: Math.min(LIMITS.wallMs, LIMITS.activeWallMs ?? LIMITS.wallMs) }
      : LIMITS;
  const timing = createTiming();
  const summary = {
    kind: frozen.kind,
    manifestHash: stableHash(frozen),
    status: "running",
    startedAt: attempt.startedAt,
    phase: answersOnly ? "answers" : scoreOnly ? "judging" : "all",
    continuation: scoreOnly ? { answerPhaseHash: stableHash(prior), policy: "same answers, one held reservation; no regeneration" } : null,
    calibration: frozen.calibration,
    checkpointRoot: ROOT,
    priorUsage: prior.usage,
    priorTiming: prior.timing,
    cells: [],
    comparisons: [],
  };
  const rows = [];
  let session;
  const agents = new Map();
  const cache = createAnswerCache({ root: join(ROOT, "checkpoints") });
  const calls = { judge: 0, judgeAttempts: 0 };
  const save = async () => {
    await session?.account();
    summary.usage = READINESS
      ? (session?.usage() ?? prior.usage)
      : Object.fromEntries(Object.keys(prior.usage).map((key) => [key, prior.usage[key] + (session?.usage()?.[key] ?? 0)]));
    summary.cells = pilotDisposition(frozen.jobs, rows);
    summary.comparisons = pilotComparisons(
      rows,
      selected.map((q) => q.id),
    );
    summary.timing = timing.summary({
      wallMs: (READINESS ? 0 : prior.timing.wallMs) + Date.now() - started,
      concurrency: 1,
      results: rows,
    });
    if (scoreOnly) {
      summary.timing.roles = { ...prior.timing.roles, ...summary.timing.roles };
      summary.timing.calls += prior.timing.calls ?? 0;
    }
    summary.activeWallMs = (scoreOnly ? prior.activeWallMs : 0) + Date.now() - phaseStarted;
    await json(join(EVIDENCE, "results.json"), summary);
  };
  const delta = (after, before) =>
    Object.fromEntries(
      ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "wireAttempts"].map((key) => [
        key,
        (after[key] ?? 0) - (before[key] ?? 0),
      ]),
    );
  try {
    session = await openDiagnostic({
      root: ROOT,
      refs: PANEL_TRANSITION ? JUDGES : [ANSWER, ...JUDGES],
      limits: phaseLimits,
      freeOnly: ANSWER_PROFILE.freeOnly,
    });
    if (scoreOnly) {
      const usage = session.usage;
      session.usage = () => combinePilotUsage(prior.accounting, usage());
    }
    const { live, account, ceilingReached } = session;
    const baseModel = PANEL_TRANSITION ? prior.modelConfiguration : live.models.get(ANSWER);
    const modelConfig = {
      ...baseModel,
      compat: { ...baseModel.compat, ...(!READINESS ? ANSWER_COMPAT : {}) },
      parameters: { temperature: 0, maxTokens: 8192 },
    };
    summary.modelConfiguration = modelConfig;
    summary.inputCap = resolveInputCap(undefined, modelConfig);
    summary.judgeConfigurations = Object.fromEntries(JUDGES.map((ref) => [ref, live.models.get(ref)]));
    if (
      (!READINESS || scoreOnly) &&
      (stableHash(modelConfig) !== stableHash(prior.modelConfiguration) || summary.inputCap !== prior.inputCap)
    )
      throw new Error("Pilot continuation model configuration changed");
    for (const ref of JUDGES)
      agents.set(
        ref,
        await createAgent({
          model: { ...live.models.get(ref), parameters: { temperature: 0, maxTokens: 8192 } },
          packages: [providerPackage(`pilot-${agents.size}`, live.providers)],
          retry: false,
          compaction: false,
          limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 300_000 },
        }),
      );
    const generate = (ref) => (prompt, options) =>
      askJudge({ agent: agents.get(ref), prompt, ...options, textMode: true, account, ceilingReached, calls, timing, timeoutMs: 300_000 });
    for (const job of frozen.jobs) {
      const old = prior.cells.find((row) => row.jobId === job.id);
      const saved = old?.answerKey
        ? JSON.parse(
            await readFile(
              join(PANEL_TRANSITION ? SOURCE_ROOT : scoreOnly ? ROOT : PRIOR_ROOT, "checkpoints", `${old.answerKey}.json`),
              "utf8",
            ),
          )
        : null;
      if (old?.outcome === "completed" && typeof old.correct === "boolean") {
        if (!saved) throw new Error("Pilot continuation missing checkpoint");
        await cache.write(old.answerKey, saved);
        rows.push({ ...old, reused: true, sourceManifestHash: prior.manifestHash });
        await save();
        continue;
      }
      await account();
      if (!pilotMayStart(session.usage(), Date.now() - started)) {
        summary.status = "ceiling";
        break;
      }
      const q = selected.find((q) => q.id === job.questionId);
      const row = {
        jobId: job.id,
        config: job.config,
        id: q.id,
        cluster: q.cluster ?? q.conversationId ?? q.id,
        ability: q.ability,
        diagnosticOnly: job.config === "oracle",
      };
      if (job.config === "full-truncated") {
        const full = rows.find((r) => r.id === q.id && r.config === "full");
        rows.push({
          ...row,
          outcome: full?.contextEligibility?.eligible ? "equivalent_policy_repeat_not_run" : "distinct_bounded_comparator_not_run",
          equivalentTo: full?.contextEligibility?.eligible ? full.jobId : null,
        });
        await save();
        continue;
      }
      const stopQuestion = timing.startQuestion();
      const trace = [];
      const before = session.usage();
      const state = {
        phase: "ingest",
        calls: { observer: 0, reflector: 0, dropper: 0, embedding: 0, decider: 0 },
        turns: 0,
        injections: [],
        injectionText: new Map(),
        injectedContextTokens: 0,
        mockInputTokens: 0,
        ceilingReached,
        refreshUsage: account,
        timing,
      };
      try {
        if (scoreOnly && !saved) throw new Error("Pilot scoring checkpoint missing; regeneration refused");
        const response =
          saved?.response ??
          (await replay(
            q,
            { config: job.config, suite: "beam-100k", modelConfig, inputCap: summary.inputCap },
            tracedProviders(live.providers, trace),
            state,
          ));
        await account();
        row.productUsage = saved ? old.productUsage : delta(session.usage(), before);
        row.productCostUsd = pilotProductCost(row.productUsage, ANSWER_PROFILE);
        row.phaseTiming = saved ? { ...old.phaseTiming } : state.phaseTiming;
        row.outcome = response.outcome ?? "completed";
        row.answerKey = stableHash({ manifest: summary.manifestHash, job: job.id });
        await cache.write(row.answerKey, { response, trace: saved?.trace ?? trace });
        Object.assign(
          row,
          Object.fromEntries(
            ["contextEligibility", "evidenceCounts", "agentSteps", "toolCalls", "recallCalls", "answerRetries", "turnTrace", "truncated"]
              .filter((k) => response[k] !== undefined)
              .map((k) => [k, response[k]]),
          ),
        );
        if (!answersOnly && row.outcome !== "comparator_ineligible") {
          const stopEvaluation = timing.startPhase(row.phaseTiming, "evaluation");
          const evalBefore = session.usage();
          try {
            if (row.outcome === "run_limit") {
              row.correct = false;
              if (RUBRIC.has(q.ability)) row.graded = 0;
            } else {
              row.judgeVerdicts = {};
              row.gradedJudges = {};
              row.judgeUsage = {};
              for (const ref of JUDGES) {
                const judgeBefore = session.usage();
                row.judgeVerdicts[ref] = (await scoreAnswer(q, response.answer, "beam-100k", generate(ref))).correct ? "yes" : "no";
                if (RUBRIC.has(q.ability)) row.gradedJudges[ref] = (await scoreGraded(q, response.answer, generate(ref))).graded;
                await account();
                row.judgeUsage[ref] = delta(session.usage(), judgeBefore);
              }
              row.correct = combineVerdicts(row.judgeVerdicts) === "yes";
              if (RUBRIC.has(q.ability)) Object.assign(row, combineGraded(row.gradedJudges));
            }
          } finally {
            stopEvaluation();
            await account();
            const extra = delta(session.usage(), evalBefore);
            row.evaluationUsage = Object.fromEntries(
              Object.entries(extra).map(([key, value]) => [key, value + (saved ? (old.evaluationUsage?.[key] ?? 0) : 0)]),
            );
            row.evaluationCostUsd = PANEL_TRANSITION
              ? Object.entries(row.judgeUsage ?? {}).reduce((sum, [ref, usage]) => sum + cacheAdjustedCost(usage, PANEL_RATES[ref]), 0)
              : 0;
          }
        }
      } catch (error) {
        await json(join(ROOT, `${encodeURIComponent(job.id)}.error.json`), { message: error.message, cause: error.cause, trace }, true);
        row.outcome = row.answerKey ? "evaluation_error" : "error";
        delete row.correct;
        row.failureCode = /Quota|daily|per.day/i.test(JSON.stringify(error, Object.getOwnPropertyNames(error)))
          ? "quota_unavailable"
          : "execution_error";
        if (row.failureCode === "quota_unavailable") summary.status = "quota_unavailable";
      } finally {
        stopQuestion();
        rows.push(row);
        await save();
        console.log(
          `${job.id}: ${row.outcome}${row.correct !== undefined ? ` binary=${Number(row.correct)}` : ""}${row.graded !== undefined ? ` graded=${row.graded.toFixed(3)}` : ""}`,
        );
      }
      if (summary.status !== "running") break;
    }
    if (summary.status === "running")
      summary.status = rows.some((row) => ["error", "evaluation_error"].includes(row.outcome))
        ? "completed_with_failures"
        : answersOnly
          ? "answers_completed"
          : "completed";
  } catch (error) {
    summary.status = "setup_error";
    await json(join(ROOT, "setup-error.json"), { message: error.message }, true);
  } finally {
    await save();
    if (READINESS && session) {
      summary.accounting = session.usage();
      summary.allocations = [
        ...(scoreOnly ? prior.allocations : []),
        ...session.allocations().map((row) => ({ ...row, phase: scoreOnly ? "judging" : "answers" })),
      ];
      summary.finishedAt = new Date().toISOString();
      await json(join(EVIDENCE, "results.json"), summary);
    }
    let complete = false;
    if (session) {
      const usageRows = [];
      for (const { usageLog } of session.live.proxies)
        if (existsSync(usageLog)) usageRows.push(...(await readFile(usageLog, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse));
      complete = READINESS ? session.usage().usageComplete : missingUsageCount(usageRows) === 0;
    }
    if (answersOnly && summary.status === "answers_completed" && complete) {
      attempt.status = "running";
      attempt.phase = "awaiting-evaluation";
      journal.status = "awaiting-judges";
      await json(join(EVIDENCE, "answer-phase-results.json"), summary);
    } else
      reconcileAttempt(journal, attempt.attemptId, {
        status: summary.status === "completed" ? "completed" : "failed",
        inputTokens: session ? session.usage().inputTokens - (PANEL_TRANSITION ? prior.accounting.inputTokens : 0) : undefined,
        outputTokens: session ? session.usage().outputTokens - (PANEL_TRANSITION ? prior.accounting.outputTokens : 0) : undefined,
        usageComplete: complete,
      });
    await saveJournal(journalPath, journal);
    for (const agent of agents.values()) await agent.dispose();
    session?.close();
    await releaseCampaignLock(lock);
  }
}

async function completionProbe() {
  if (existsSync("docs/_evidence/memory-bench/202/pilot/completion.json"))
    throw new Error("Completion probe already attempted; see docs/_evidence/memory-bench/202/pilot/completion.json");
  const selected = await questions();
  const frozen = JSON.parse(await readFile(join(EVIDENCE, "manifest.json"), "utf8"));
  if (stableHash(frozen) !== stableHash(await manifest(selected))) throw new Error("Pilot protocol drift");
  const root = join(ROOT, "completion");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const output = join(EVIDENCE, "completion.json");
  if (existsSync(output)) throw new Error("Completion probe already attempted");
  const started = Date.now();
  const total = { wireAttempts: 0, inputTokens: 0, outputTokens: 0 };
  const results = [];
  const journalPath = join(root, "journal.json");
  const journal = await openJournal({ path: journalPath, manifest: { ...frozen, ceiling: COMPLETION_LIMITS.inputTokens + 5_000_000 } });
  const lock = campaignLockPath(journalPath);
  await acquireCampaignLock(lock);
  try {
    for (const ref of frozen.completionProbe.models) {
      if (!pilotMayStart(total, Date.now() - started, COMPLETION_LIMITS)) break;
      const attempt = reserveAttempt(journal, { jobId: ref, output, maxInputTokens: COMPLETION_LIMITS.inputTokens - total.inputTokens });
      await saveJournal(journalPath, journal);
      let session;
      const row = { model: ref, id: frozen.completionProbe.ids[0] };
      const trace = [];
      try {
        const remaining = Object.fromEntries(
          Object.entries(COMPLETION_LIMITS).map(([key, value]) => [
            key,
            value - (key === "wallMs" ? Date.now() - started : (total[key] ?? 0)),
          ]),
        );
        session = await openDiagnostic({ root: join(root, refOf(ref).model), refs: [ref], limits: remaining });
        const q = selected.find((q) => q.id === row.id);
        const modelConfig = session.live.models.get(ref);
        const state = {
          phase: "ingest",
          calls: { observer: 0, reflector: 0, dropper: 0, embedding: 0, decider: 0 },
          turns: 0,
          injections: [],
          injectionText: new Map(),
          injectedContextTokens: 0,
          mockInputTokens: 0,
          ceilingReached: session.ceilingReached,
          refreshUsage: session.account,
        };
        const response = await replay(
          q,
          { config: "fabric-x-tools", suite: "beam-100k", modelConfig, inputCap: resolveInputCap(undefined, modelConfig) },
          tracedProviders(session.live.providers, trace),
          state,
        );
        await json(join(root, `${refOf(ref).model}.json`), { response, trace }, true);
        Object.assign(
          row,
          Object.fromEntries(
            ["outcome", "turns", "toolCalls", "recallCalls", "turnTrace", "answerRetries"]
              .filter((k) => response[k] !== undefined)
              .map((k) => [k, response[k]]),
          ),
        );
        row.outcome ??= "completed";
      } catch (error) {
        await json(join(root, `${refOf(ref).model}.error.json`), { message: error.message, cause: error.cause, trace }, true);
        row.outcome = session ? "execution_error" : "setup_error";
      } finally {
        await session?.account();
        row.usage = session?.usage() ?? null;
        for (const key of Object.keys(total)) total[key] += row.usage?.[key] ?? 0;
        session?.close();
        reconcileAttempt(journal, attempt.attemptId, {
          status: ["completed", "run_limit"].includes(row.outcome) ? "completed" : "failed",
          inputTokens: row.usage?.inputTokens,
          usageComplete: false,
        });
        await saveJournal(journalPath, journal);
        results.push(row);
        await json(output, { manifestHash: stableHash(frozen), limits: COMPLETION_LIMITS, usage: total, results });
        console.log(`${ref}: ${row.outcome}`);
      }
    }
  } finally {
    await releaseCampaignLock(lock);
  }
}

if (import.meta.main) {
  if (process.argv.includes("--completion")) await completionProbe();
  else
    await runPilot({
      freeze: process.argv.includes("--freeze"),
      answersOnly: process.argv.includes("--answers-only"),
      scoreOnly: process.argv.includes("--score-only"),
    });
}
