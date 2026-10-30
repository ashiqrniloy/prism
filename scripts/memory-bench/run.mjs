#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgent, createDefaultRetryPolicy, resolveInputCap } from "@arnilo/prism";
import { providerPackage, readBoundedResponseText, THINKING_LEVELS } from "@arnilo/prism/provider-kit";
import { parseEnvFile } from "../live-matrix.mjs";
import { startWireProxy } from "../wire-proxy.mjs";
import { historicalVariants, memoryConfigs, resolvedMemoryConfigs, writeGeneration } from "./ablations.mjs";
import { fileFingerprint } from "./acceptance.mjs";
import {
  CODING_SUITES,
  codingAccess,
  codingHistory,
  codingMetadata,
  codingSchemaReport,
  prepareCoding,
  summarizeCoding,
} from "./coding.mjs";
import { BEAM_NORMALIZATION_VERSION, DATASETS, loadDataset, normalizeCodingItem, normalizeDataset, selectQuestions } from "./datasets.mjs";
import fixture from "./fixtures/synthetic.json" with { type: "json" };
import { createAdmission, requireAttemptReservation, stableHash } from "./journal.mjs";
import {
  applyJudgeAudit,
  combineVerdicts,
  createAnswerCache,
  createJudgeCache,
  GRADED_TEMPLATE_VERSION,
  isGradedQuestion,
  JUDGE_TEMPLATE_VERSION,
  judgeOutput,
  judgeProviderOptions,
  judgeTextOutput,
  labelInjections,
  resolveJudgePanel,
  scoreAnswer,
  scoreAnswerCached,
  scoreGradedPanel,
} from "./judge.mjs";
import ratesFile from "./rates.json" with { type: "json" };
import {
  BENCH_MAX_TURNS,
  BENCH_PROTOCOL_VERSION,
  BENCH_RETRY,
  causeChainText,
  isProductIngest,
  LEGACY_INGEST,
  mockProvider,
  PRODUCT_INGEST,
  replay,
  retryAfterMs,
  stageFromCounts,
} from "./replay.mjs";
import { summarize, writeReport } from "./report.mjs";
import { robustnessCriteriaHash } from "./robustness.mjs";
import { PAIRED_ANALYSIS_VERSION } from "./stats.mjs";
import { createGate, createTiming } from "./timing.mjs";
import { boundedWireUsage, missingUsageCount, resolveRate, roleUsage } from "./usage.mjs";
import { variantProvenance } from "./variants.mjs";

export { missingUsageCount };

const PROVIDERS = {
  hyper: { create: "createHyperProvider", list: "listHyperModels", secret: "HYPER_API_KEY", url: "https://hyper.charm.land/v1" },
  "opencode-go": {
    create: "createOpenCodeGoProvider",
    list: "listOpenCodeGoModels",
    secret: "OPENCODE_GO_API_KEY",
    url: "https://opencode.ai/zen/go/v1",
  },
  openrouter: {
    create: "createOpenRouterProvider",
    list: "listOpenRouterModels",
    secret: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1",
  },
  commandcode: {
    create: "createCommandCodeProvider",
    list: "listCommandCodeModels",
    secret: "COMMAND_CODE_API_KEY",
    url: "https://api.commandcode.ai/provider/v1",
  },
};
export function parseArgs(argv) {
  const options = {};
  const flags = new Set([
    "suite",
    "config",
    "provider",
    "model",
    "judge",
    "judges",
    "judge-audit",
    "repeats",
    "rates",
    "embeddings",
    "subset",
    "ability",
    "max-input-tokens",
    "max-output-tokens",
    "output",
    "answers-dir",
    "judge-cache-dir",
    "max-questions",
    "replay",
    "policy",
    "cache",
    "persona",
    "seed",
    "ablate",
    "journal",
    "attempt",
    "resume",
    "concurrency",
    "phase",
    "label-injections",
    "write-snapshot",
    "seed-snapshot",
    "reuse-from",
    "reuse-fallback",
    "write-output-tokens",
    "write-thinking",
  ]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--free-only") {
      options.freeOnly = true;
      continue;
    }
    if (argv[i] === "--free-product-only") {
      options.freeProductOnly = true;
      continue;
    }
    if (argv[i] === "--bounded-wire") {
      options.boundedWire = true;
      continue;
    }
    if (argv[i] === "--offline") {
      options.offline = true;
      continue;
    }
    if (argv[i] === "--judge-text") {
      options.judgeText = true;
      continue;
    }
    const name = argv[i].replace(/^--/, "");
    if (!flags.has(name) || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error("MemoryBenchArguments: unknown flag or missing value");
    const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[++i];
    if (key === "ablate") (options.ablate ??= []).push(value);
    else options[key] = value;
  }
  for (const key of ["maxInputTokens", "maxOutputTokens", "maxQuestions", "seed", "concurrency", "repeats"])
    if (options[key] !== undefined) {
      options[key] = Number(options[key]);
      if (!Number.isSafeInteger(options[key]) || options[key] < 1)
        throw new Error("MemoryBenchArguments: limits must be positive integers");
    }
  if (options.concurrency !== undefined && (options.concurrency < 1 || options.concurrency > 32))
    throw new Error("MemoryBenchArguments: concurrency must be 1-32");
  if (options.repeats !== undefined && (options.repeats < 1 || options.repeats > 8))
    throw new Error("MemoryBenchArguments: repeats must be 1-8");
  // Plan 188.10 Task 5: the extractor's own budget, never the answer's.
  if (options.writeOutputTokens !== undefined) {
    options.writeOutputTokens = Number(options.writeOutputTokens);
    if (!Number.isSafeInteger(options.writeOutputTokens) || options.writeOutputTokens < 256 || options.writeOutputTokens > 32_768)
      throw new Error("MemoryBenchArguments: write-output-tokens must be an integer in [256,32768]");
  }
  if (options.writeThinking !== undefined && !THINKING_LEVELS.includes(options.writeThinking))
    throw new Error(`MemoryBenchArguments: write-thinking must be one of ${THINKING_LEVELS.join(", ")}`);
  // "write" is the write-side job: build the store, snapshot it, answer nothing.
  if (options.phase !== undefined && !["answer", "judge", "all", "write"].includes(options.phase))
    throw new Error("MemoryBenchArguments: phase must be answer, judge, all or write");
  if (options.labelInjections !== undefined && !["on", "off"].includes(options.labelInjections))
    throw new Error("MemoryBenchArguments: label-injections must be on or off");
  if (options.writeSnapshot && options.seedSnapshot)
    throw new Error("MemoryBenchArguments: --write-snapshot and --seed-snapshot are exclusive");
  if (options.phase === "write" && !options.writeSnapshot)
    throw new Error("MemoryBenchArguments: --phase write must name where the store goes: --write-snapshot <dir>");
  if (options.phase === "write" && options.seedSnapshot)
    throw new Error("MemoryBenchArguments: --phase write builds a store, so it cannot seed one");
  if (options.reuseFallback !== undefined && !["run", "refuse"].includes(options.reuseFallback))
    throw new Error("MemoryBenchArguments: reuse-fallback must be run or refuse");
  return options;
}
export function loadEnv() {
  const path = process.env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (existsSync(path)) {
    for (const [name, value] of Object.entries(parseEnvFile(path))) if (process.env[name] === undefined) process.env[name] = value;
  } else if (process.env.PRISM_LIVE_ENV_FILE) throw new Error("MemoryBenchCredentials: explicit live env file missing");
}
export function benchmarkFetch({
  beforeAttempt = async () => {},
  onRetry = () => {},
  onOverload = () => {},
  fetch: transport = fetch,
} = {}) {
  const policy = createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 1000 });
  return async (input, init) => {
    for (let attempt = 1; ; attempt++) {
      await beforeAttempt(input, init);
      const response = await transport(input, init);
      let code = response.status;
      if (code === 400) {
        let body;
        try {
          body = await readBoundedResponseText(response.clone(), { maxResponseBodyBytes: 4096 });
        } catch {
          return response;
        }
        if (body.replaceAll("\r", "").trim() !== "event: error\ndata: {}") return response;
        code = 503;
      }
      const decision = policy.decide({ attempt, error: { code, message: response.statusText }, signal: init?.signal });
      // 429/overload: back off and let this arm shrink its own in-flight ceiling (never below 1).
      if (code === 429 || code === 503 || code === 529) onOverload();
      if (!decision.retry) return response;
      onRetry();
      await response.body?.cancel();
      await delay(decision.delayMs, undefined, { signal: init?.signal });
    }
  };
}
/** Free routing is explicit: unknown prices never become zero-cost authorization. */
export function isFreeBenchmarkModel(model) {
  if (model.provider === "openrouter") return model.model.endsWith(":free") && model.cost?.input === 0 && model.cost?.output === 0;
  return model.provider === "commandcode" && /(?::free|-free)$/.test(model.model);
}
export async function liveProviders(refs, temp, fetchOptions) {
  const providers = [],
    proxies = [],
    models = new Map();
  try {
    for (const id of new Set(refs.map((ref) => ref.provider))) {
      const spec = PROVIDERS[id];
      if (!spec) throw new Error("MemoryBenchProvider: supported providers are hyper, opencode-go, openrouter and commandcode");
      const key = process.env[spec.secret] ?? (id === "opencode-go" ? process.env.OPENCODE_API_KEY : undefined);
      if (!key) throw new Error("MemoryBenchCredentials: provider credential unavailable");
      const module = await import(`@arnilo/prism-provider-${id}`);
      const catalog = await module[spec.list]({ apiKey: () => key, signal: AbortSignal.timeout(30_000) });
      for (const ref of refs.filter((ref) => ref.provider === id)) {
        const model = catalog.find((model) => model.model === ref.model);
        if (!model) throw new Error("MemoryBenchModel: model not found in provider catalog");
        if (fetchOptions?.freeOnly && !isFreeBenchmarkModel(model)) throw new Error("MemoryBenchModel: free-only route refused");
        models.set(`${id}/${ref.model}`, {
          ...model,
          parameters: { ...model.parameters, maxTokens: fetchOptions?.maxOutputTokens ?? 4096, temperature: 0 },
        });
      }
      const usageLog = join(temp, `${id}-usage.jsonl`);
      const proxy = await startWireProxy({
        upstream: spec.url,
        listen: "127.0.0.1:0",
        usageLog,
        secretEnv: [spec.secret, "OPENCODE_API_KEY"],
      });
      proxies.push({ proxy, usageLog, provider: id });
      providers.push(module[spec.create]({ apiKey: () => key, baseUrl: proxy.url, fetch: benchmarkFetch(fetchOptions) }));
    }
    return { providers, proxies, models };
  } catch (error) {
    for (const { proxy } of proxies) proxy.stop();
    throw error;
  }
}
/** Audit file: { judges: { "<provider>/<model>": { n, kappa } } }; labels never reach this file. */
async function loadJudgeAudit(path) {
  const audit = JSON.parse(await readFile(path, "utf8"));
  if (!audit || typeof audit.judges !== "object" || Array.isArray(audit.judges))
    throw new Error("MemoryBenchJudgePanel: audit must hold { judges: { ref: { n, kappa } } }");
  for (const [ref, row] of Object.entries(audit.judges)) {
    if (typeof row?.kappa !== "number" || !Number.isFinite(row.kappa) || row.kappa < -1 || row.kappa > 1)
      throw new Error(`MemoryBenchJudgePanel: audit kappa invalid for ${ref}`);
  }
  return audit;
}

export const refOf = (ref) => {
  const slash = ref?.indexOf("/") ?? -1;
  if (slash < 1 || slash === ref.length - 1) throw new Error("MemoryBenchArguments: judge must be provider/model");
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
};
/**
 * Bounded question concurrency; an in-flight request may finish after the ceiling. With a `gate`,
 * its limit can shrink at runtime (provider overload) without losing the in-flight permits.
 */
export async function runQuestionPool(questions, concurrency, run, stopped, gate) {
  let cursor = 0;
  const workers = Math.min(concurrency, questions.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (!stopped() && cursor < questions.length) {
        const question = questions[cursor++];
        if (gate) {
          await gate.acquire();
          try {
            await run(question);
          } finally {
            gate.release();
          }
        } else await run(question);
      }
    }),
  );
}
function terminalRetryCause(error) {
  const cause = error?.cause;
  const failureClass = String(cause?.failureClass ?? "");
  const code = String(cause?.code ?? "");
  return (
    failureClass === "auth" ||
    failureClass === "permanent" ||
    code === "MemoryBenchTokenCeiling" ||
    code === "ERR_PRISM_RUN_LIMIT" ||
    /usage_missing/i.test(code) ||
    /RunLimit/i.test(String(cause?.name ?? ""))
  );
}

/**
 * One question that trips a product limit is a wrong answer, not the end of the arm
 * (plan 188.8 Task 5). A provider/transport failure always carries `cause` and still
 * ends the arm, and a systematic product break is capped so it cannot pass as a score.
 */
export const QUESTION_ERROR_MIN = 3;
export const QUESTION_ERROR_FRACTION = 0.05;
export function questionFailureDisposition({ error, budget = false, errored = 0, total = 0 } = {}) {
  if (budget || [error?.message, error?.cause?.message, error?.cause?.code].includes("MemoryBenchTokenCeiling")) return "token-ceiling";
  if (/^MemoryBench(IngestUnsupported|WriteSideMismatch|Archive:)/.test(error?.message ?? "")) return "failed";
  if (error?.cause) return "failed";
  if (errored >= Math.max(QUESTION_ERROR_MIN, Math.ceil(total * QUESTION_ERROR_FRACTION))) return "failed";
  return "scored";
}

/** A malformed or cut judge answer can be re-asked; auth, permanent, budget and run-limit cannot. */
export function isRetryableJudgeFailure(error) {
  const message = String(error?.message ?? "");
  const detail = `${message}\n${causeChainText(error)}`;
  if (terminalRetryCause(error)) return false;
  // Free-tier gateways enforce hourly request quotas; a retry after their reset is progress, not a
  // new arm, so honor it instead of burning the job's attempts on a 1-second backoff.
  if (/MemoryBenchJudgeError:\s*(429|500|502|503|504|529)\b|rate_limit|overloaded/i.test(detail)) return true;
  // A graded verdict that is not the requested JSON is a judge wobble, not a score.
  if (/MemoryBenchJudgeError: invalid graded/i.test(detail)) return true;
  // A dropped socket is a gateway wobble, not a verdict about the arm.
  if (/ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|EPIPE|ENOTFOUND|socket hang up|fetch failed/i.test(detail)) return true;
  // A one-word verdict that has not arrived in three minutes is a stalled gateway, not a verdict.
  if (/MemoryBenchJudgeError:23\b|TimeoutError|operation timed out|timed out/i.test(detail)) return true;
  // The gateway refused to route a request it routes for every other question: a gateway fault.
  if (/400 error:.*upstream (request failed|validation error)/i.test(detail)) return true;
  if (/without completion evidence/i.test(detail)) return true;
  return /^MemoryBenchJudgeError: (invalid verdict JSON|invalid verdict enum|invalid verdict text|judge must answer yes or no|invalid injection label)$/.test(
    message,
  );
}

export function safeFailureTrace(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return undefined;
  const tools = Array.isArray(diagnostics.tools)
    ? diagnostics.tools.slice(0, 64).map((name) =>
        String(name)
          .replace(/[^a-zA-Z0-9_.:-]/g, "")
          .slice(0, 80),
      )
    : [];
  return {
    turns: Number.isSafeInteger(diagnostics.turns) ? diagnostics.turns : null,
    toolCalls: Number.isSafeInteger(diagnostics.toolCalls) ? diagnostics.toolCalls : null,
    recallCalls: Number.isSafeInteger(diagnostics.recallCalls) ? diagnostics.recallCalls : null,
    answerRetries: Number.isSafeInteger(diagnostics.answerRetries) ? diagnostics.answerRetries : null,
    mutating: diagnostics.mutating === true,
    maxTurns: Number.isSafeInteger(diagnostics.maxTurns) ? diagnostics.maxTurns : null,
    tools,
  };
}

/** Judge answers are one word: three minutes is generous, ten minutes is a stall the arm cannot pay for. */
export const JUDGE_TIMEOUT_MS = 180_000;

/**
 * A gateway quota is a budget, not an error: space the calls so a burst cannot exhaust an hourly
 * window and spend it on 429s. `perHour = 0` disables pacing (tests and offline runs).
 */
export function createJudgePacer({ perHour, sleep = delay, now = () => performance.now() } = {}) {
  const intervalMs = perHour > 0 ? 3_600_000 / perHour : 0;
  let next = 0;
  return async () => {
    if (!intervalMs) return;
    const at = now();
    const wait = Math.max(0, next - at);
    next = Math.max(at, next) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}

/**
 * The shared pacer for free routes: OpenRouter allows 20 requests per minute per account across all
 * `:free` models, so solver and judges must space against one clock (Task 5.4.3). `null` disables
 * pacing for paid routes, tests and offline runs.
 */
export function createFreeRoutePace({ perMinute, freeOnly = false, sleep, now } = {}) {
  const raw = perMinute === undefined || perMinute === null || perMinute === "" ? (freeOnly ? "20" : "") : String(perMinute);
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (rate > 20) throw new Error(`MemoryBenchPacer: free routes allow at most 20 requests per minute (asked ${rate})`);
  return createJudgePacer({ perHour: rate * 60, sleep, now });
}

/** Wrap a provider so every call waits on the shared free-route pacer before it leaves the process. */
export function pacedProvider(provider, pace) {
  return {
    ...provider,
    async *generate(request) {
      await pace();
      yield* provider.generate(request);
    },
  };
}

/** One logical judge request; each attempt gets a fresh one-shot session and its own admission check. */
export async function askJudge({
  agent,
  prompt,
  labels,
  admission,
  account,
  ceilingReached,
  calls,
  timing,
  textMode = false,
  parse,
  instruction,
  backoffMs = (attempt) => 1000 * attempt,
  timeoutMs = JUDGE_TIMEOUT_MS,
  pace,
}) {
  calls.judge++;
  for (let attempt = 1; ; attempt += 1) {
    const bound = admission?.check();
    let session;
    try {
      await pace?.();
      await account();
      if (ceilingReached()) throw new Error("MemoryBenchTokenCeiling");
      session = await agent.session();
      calls.judgeAttempts++;
      const run = () =>
        session.run(
          parse
            ? `${prompt}\n${instruction}`
            : textMode
              ? `${prompt}\nAnswer with exactly one word: ${labels.join(" or ")}.`
              : `${prompt}\nReturn a JSON object with one field verdict containing the requested label.`,
          {
            ...(textMode || parse ? {} : { providerOptions: judgeProviderOptions(labels) }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      const result = timing ? await timing.measure("judge", run) : await run();
      if (!["completed", "stopped"].includes(result.status)) {
        throw new Error(`MemoryBenchJudgeError:${result.error?.code ?? result.status}`, { cause: result.error });
      }
      if (parse) return parse(result.text);
      return textMode ? judgeTextOutput(result.text, labels) : judgeOutput(result.text, labels);
    } catch (error) {
      if (attempt >= BENCH_RETRY.judgeAttempts || !isRetryableJudgeFailure(error)) throw error;
      await delay(backoffMs(attempt, error));
    } finally {
      await session?.close();
      admission?.release(bound);
    }
  }
}

function sourceRevision() {
  if (process.env.PRISM_MEMORY_BENCH_SOURCE) return process.env.PRISM_MEMORY_BENCH_SOURCE;
  try {
    const run = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    return run.success ? run.stdout.toString().trim() : "unknown";
  } catch {
    return "unknown";
  }
}

/** Everything that makes two reports comparable; a changed value refuses a resume. */
/**
 * Plan 188.9 Task 4 reuse identity: what the arm's answers would be, not the repo's git HEAD.
 * `sourceRevision` necessarily differs between plans, so it is replaced by content hashes of the
 * files that shape a run.
 */
export const RUN_PATH_PATHS = [
  "scripts/memory-bench/replay.mjs",
  "scripts/memory-bench/judge.mjs",
  "scripts/memory-bench/judge-prompts.json",
  "scripts/memory-bench/datasets.mjs",
  "scripts/memory-bench/stats.mjs",
  "scripts/memory-bench/ablations.mjs",
  "packages/memory/fabric/src/recall.ts",
  "packages/memory/fabric/src/create.ts",
  "packages/memory/fabric/src/index.ts",
];

let runPathSourceHashes;

export async function runPathFingerprint(report, { ids = [], inputCap, generation = report.generation } = {}) {
  runPathSourceHashes ??= await fileFingerprint(RUN_PATH_PATHS);
  return stableHash({
    kind: "run-path-v1",
    suite: report.suite,
    subset: report.subset ?? null,
    ability: report.ability ?? null,
    config: report.config,
    comparatorPolicyVersion: report.comparatorPolicyVersion ?? null,
    measurementVersion: report.measurementVersion ?? null,
    analysisVersion: report.analysisVersion ?? null,
    judgeTemplateVersion: report.judgeTemplateVersion ?? null,
    gradedTemplateVersion: report.gradedTemplateVersion ?? null,
    ids: stableHash([...ids].map(String).sort()),
    inputCap: inputCap ?? null,
    generation: generation ?? null,
    provider: report.provider,
    model: report.model,
    judge: report.judge,
    judges: report.judgePanel,
    repeats: report.repeats ?? 1,
    judgeProtocol: report.judgeProtocol,
    freeOnly: report.freeOnly ?? false,
    ...(report.boundedWire ? { boundedWire: true } : {}),
    ...(report.freeProductOnly ? { freeProductOnly: true } : {}),
    judgeTemplate: JUDGE_TEMPLATE_VERSION,
    dataset: report.dataset?.revision ?? report.dataset?.url ?? report.dataset?.license ?? null,
    seed: report.seed ?? null,
    ablations: report.ablations,
    sourceVariants: report.sourceVariants,
    memoryConfig: report.memoryConfig,
    protocolVersion: report.protocolVersion ?? 1,
    protocol: report.protocol ?? null,
    sourceHashes: runPathSourceHashes,
    ...(report.normalization ? { normalization: report.normalization } : {}),
  });
}

/**
 * Reuse a completed arm instead of paying for it again. The declared fingerprint may be omitted;
 * the comparison is always recomputed against the source report's recorded run-path hash.
 */
export async function reuseSource({ report, sourcePath, ids }) {
  const source = typeof sourcePath === "string" ? JSON.parse(await readFile(sourcePath, "utf8")) : sourcePath;
  const refuse = (reason) => {
    throw new Error(`MemoryBenchReuseMismatch: ${reason}`);
  };
  if (source?.status !== "completed") refuse(`source is ${source?.status ?? "unreadable"}`);
  if (source.usageComplete === false) refuse("source usage is incomplete");
  const sourceIds = (source.results ?? []).map((row) => String(row.id));
  if (sourceIds.length !== ids.length || new Set(sourceIds).size !== new Set(ids).size || sourceIds.some((id) => !ids.includes(id)))
    refuse("source ids differ");
  const expected = await runPathFingerprint(report, { ids, inputCap: report.inputCap });
  if (!source.runPathFingerprint) refuse("source has no run-path fingerprint");
  if (source.runPathFingerprint !== expected) refuse("run-path fingerprint differs");
  return {
    from: typeof sourcePath === "string" ? sourcePath : (source.generatedAt ?? "embedded report"),
    fingerprint: expected,
    results: source.results.map((row) => ({ ...row, reused: true })),
  };
}

export function protocolFingerprint(report) {
  return stableHash({
    suite: report.suite,
    subset: report.subset,
    ability: report.ability ?? null,
    config: report.config,
    comparatorPolicyVersion: report.comparatorPolicyVersion ?? null,
    measurementVersion: report.measurementVersion ?? null,
    analysisVersion: report.analysisVersion ?? null,
    judgeTemplateVersion: report.judgeTemplateVersion ?? null,
    gradedTemplateVersion: report.gradedTemplateVersion ?? null,
    provider: report.provider,
    model: report.model,
    judge: report.judge,
    judges: report.judgePanel,
    repeats: report.repeats ?? 1,
    judgeProtocol: report.judgeProtocol,
    generation: report.generation,
    freeOnly: report.freeOnly ?? false,
    ...(report.boundedWire ? { boundedWire: true } : {}),
    ...(report.freeProductOnly ? { freeProductOnly: true } : {}),
    dataset: report.dataset?.revision ?? report.dataset?.url ?? report.dataset?.license ?? null,
    seed: report.seed ?? null,
    ablations: report.ablations,
    sourceVariants: report.sourceVariants,
    memoryConfig: report.memoryConfig,
    protocolVersion: report.protocolVersion ?? 1,
    protocol: report.protocol ?? null,
    sourceRevision: report.sourceRevision,
    ...(report.normalization ? { normalization: report.normalization } : {}),
  });
}

export async function runBench(input = {}) {
  const coding = CODING_SUITES.includes(input.suite);
  if (input.suite === "lifecycle") {
    const { runLifecycle } = await import("./lifecycle/suite.mjs");
    return runLifecycle(input);
  }
  if (input.replay) {
    if (input.ablate?.length) throw new Error("MemoryBenchArguments: replay ablations use --policy");
    if (!input.policy) throw new Error("MemoryBenchArguments: replay requires policy");
    const { replayLedgers } = await import("./lifecycle/replay.mjs");
    return replayLedgers({
      ledgers: input.replay,
      policy: typeof input.policy === "string" ? JSON.parse(await readFile(input.policy, "utf8")) : input.policy,
      offline: input.offline,
      cache: input.cache,
      client: input.client,
      maxInputTokens: input.maxInputTokens,
    });
  }
  const options = { config: "full", subset: "base", maxInputTokens: 15_000_000, ...input };
  const phase = options.phase ?? "all";
  const labelInjectionsEnabled = (options.labelInjections ?? "on") !== "off";
  if (!["answer", "judge", "all", "write"].includes(phase)) throw new Error("MemoryBenchArguments: invalid phase");
  if (phase === "judge" && !options.resume)
    throw new Error("MemoryBenchArguments: --phase judge scores an answer checkpoint, so --resume is required");
  if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1)
    throw new Error("MemoryBenchArguments: positive token ceiling required");
  const validConfigs = [
    "full",
    "om",
    "fabric",
    "fabric-hybrid",
    "fabric-agentic",
    "om+fabric",
    "fabric-x",
    "fabric-xc",
    "fabric-xc-agentic",
    "fabric-x-tools",
    "fabric-xc-tools",
    // Comparators (plan 202 Task 3): no memory product, no memory tools, no OM.
    "lexical-topk",
    "full-truncated",
    "oracle",
  ];
  if (!validConfigs.includes(options.config)) throw new Error("MemoryBenchArguments: invalid config");
  if (options.config === "fabric-hybrid" && !options.embeddings) {
    throw new Error("MemoryBenchArguments: fabric-hybrid requires --embeddings provider/model");
  }
  if (
    ![
      "base",
      "confirmatory",
      "dev",
      "development",
      "heldout-a",
      "heldout-b",
      "heldout-v2",
      "heldout-v3",
      "screen-v1",
      "screen-ms-v1",
      "targeted",
      "all",
    ].includes(options.subset)
  )
    throw new Error("MemoryBenchArguments: invalid subset");
  const repeats = options.repeats ?? 1;
  const comparator = ["full", "lexical-topk", "full-truncated", "oracle"].includes(options.config);
  if (comparator && (options.ablate?.length || options.policy))
    throw new Error("MemoryBenchArguments: comparators take no ablations or policy");
  if (options.subset === "targeted" && (options.suite !== "longmemeval-s" || !options.ability))
    throw new Error("MemoryBenchArguments: targeted needs LongMemEval and ability");
  if (coding && phase !== "all")
    throw new Error("MemoryBenchArguments: coding suites grade with executable tests, so only --phase all applies");
  if (coding && (options.offline || !codingAccess(options.suite).available)) return codingSchemaReport(options);
  if (!options.offline && (!DATASETS[options.suite] || !options.provider || !options.model))
    throw new Error("MemoryBenchArguments: suite, provider, model and judge required");
  // Plan 202 Task 3: a scored live arm needs a two-family panel, never the answer model alone.
  let panel = null;
  if (!options.offline && !coding && phase !== "write") {
    const refs = options.judges ? options.judges.split(",") : options.judge ? [options.judge] : [];
    if (refs.length < 2) throw new Error("MemoryBenchArguments: a scored live report needs --judges with two model families");
    panel = resolveJudgePanel({ judges: refs, answerModel: `${options.provider}/${options.model}` });
    if (options.judgeAudit) panel = applyJudgeAudit({ panel, audit: await loadJudgeAudit(options.judgeAudit) });
  } else if (!options.offline && !coding && options.judge) panel = { refs: [options.judge], families: [] };
  if (options.judges && !panel) panel = resolveJudgePanel({ judges: options.judges.split(","), answerModel: null });
  options.memoryConfigs = memoryConfigs(options);
  // The write side of a non-promoting arm is local: no extractor call, so no live provider.
  const localWrite = phase === "write" && options.memoryConfigs.fabric !== null && options.memoryConfigs.fabric?.promote === undefined;
  if (localWrite && options.seedSnapshot) throw new Error("MemoryBenchArguments: a local write side builds a store, so it cannot seed one");
  const report = {
    schemaVersion: 1,
    protocolVersion: BENCH_PROTOCOL_VERSION,
    // Plan 202 Task 2: every later manifest/report pins the pre-registered criteria it is judged by.
    criteriaHash: robustnessCriteriaHash(),
    usageSource: options.offline ? "mock" : phase === "write" ? "local" : "wire-proxy",
    phase,
    labelInjections: labelInjectionsEnabled ? "on" : "off",
    // Offline stays serial unless a timing test asks otherwise; a live arm defaults to 4.
    concurrency: coding ? 1 : (options.concurrency ?? (options.offline ? 1 : 4)),
    generation: options.offline ? null : { temperature: 0, maxTokens: options.maxOutputTokens ?? 4096 },
    freeOnly: options.freeOnly ?? false,
    ...(options.boundedWire ? { boundedWire: true } : {}),
    ...(options.freeProductOnly ? { freeProductOnly: true } : {}),
    // The extractor's generation, recorded separately: two write-side budgets never share a snapshot.
    writeGeneration: writeGeneration(options),
    generatedAt: new Date().toISOString(),
    suite: options.offline ? "synthetic" : options.suite,
    subset: options.subset,
    ability: options.ability ?? null,
    seed: options.seed ?? null,
    config: options.config,
    ...(["full", "full-truncated"].includes(options.config) ? { comparatorPolicyVersion: 1 } : {}),
    // Which write path built the store (plan 188.9 Task 9): the product commands, or 188.8's
    // direct upsert kept only for the baseline arm.
    ingestion: options.config.includes("fabric")
      ? isProductIngest(options.config)
        ? options.suite === "memoryagentbench-cr"
          ? "product-source-facts-v1"
          : PRODUCT_INGEST
        : LEGACY_INGEST
      : "none",
    embeddings: options.embeddings ?? null,
    provider: options.offline ? "mock" : options.provider,
    model: options.offline ? "synthetic" : options.model,
    judge: options.offline ? "mock/synthetic-judge" : (panel?.refs[0] ?? options.judge),
    judgePanel: options.offline ? ["mock/synthetic-judge"] : (panel?.refs ?? (options.judge ? [options.judge] : [])),
    judgeCalibration: options.offline ? null : panel?.dropped ? { threshold: 0.8, dropped: panel.dropped } : null,
    repeats,
    judgeProtocol: options.offline ? "mock-enum-v1" : options.judgeText ? "plain-text-v1" : "enum-json-v1",
    dataset: options.offline ? { license: "original synthetic fixture" } : DATASETS[options.suite],
    ...(!options.offline && options.suite.startsWith("beam-")
      ? {
          normalization: { version: BEAM_NORMALIZATION_VERSION, sourceHash: await fileFingerprint(["scripts/memory-bench/datasets.mjs"]) },
        }
      : {}),
    maxInputTokens: options.maxInputTokens,
    ablations: options.ablate ?? [],
    sourceVariants: await variantProvenance(historicalVariants(options.ablate)),
    sourceRevision: sourceRevision(),
    protocol: {
      answerAttempts: BENCH_RETRY.answerAttempts,
      answerBackoffMs: BENCH_RETRY.answerBackoffMs,
      judgeAttempts: BENCH_RETRY.judgeAttempts,
      judgeBackoffMs: BENCH_RETRY.judgeBackoffMs,
      maxTurns: coding ? BENCH_MAX_TURNS.coding : BENCH_MAX_TURNS.standard,
    },
    memoryConfig: resolvedMemoryConfigs(options.memoryConfigs),
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    calls: {
      observer: 0,
      reflector: 0,
      dropper: 0,
      embedding: 0,
      decider: 0,
      consolidate: 0,
      judge: 0,
      judgeAttempts: 0,
      gatewayRetries: 0,
      judgeCacheHits: 0,
      judgeCacheMisses: 0,
      concurrencyHalvings: 0,
      overloads: 0,
    },
    turns: 0,
    injectedContextTokens: 0,
    injections: [],
    attemptId: null,
    measurementVersion: "product-phases-delivery-v3",
    analysisVersion: PAIRED_ANALYSIS_VERSION,
    judgeTemplateVersion: JUDGE_TEMPLATE_VERSION,
    gradedTemplateVersion: GRADED_TEMPLATE_VERSION,
    protocolHash: null,
    resumedResults: 0,
    results: [],
    status: "completed",
    limitations: [
      "Block-level injection accounting until item metadata lands in Tasks 4, 9, 11 and 12.",
      "Injection token allocations are character estimates, not billing usage.",
      "OpenCode Go and Hyper judges differ from the papers; scores are not directly comparable.",
    ],
  };
  const rates = options.ratesData ?? (options.rates ? JSON.parse(await readFile(options.rates, "utf8")) : ratesFile);
  report.rate = resolveRate(rates, `${report.provider}/${report.model}`);
  report.ratesAsOf = rates.asOf ?? null;
  report.ratesStatus = rates.status ?? null;
  const timing = createTiming();
  const startedAt = performance.now();
  const gate = createGate(report.concurrency);
  const answerCache = createAnswerCache({ root: options.answersDir ?? resolve(".cache/memory-bench/answers") });
  const judgeRefs = report.judgePanel ?? [report.judge];
  const judgeCaches = new Map(
    judgeRefs.map((ref) => [
      ref,
      createJudgeCache({
        root: options.judgeCacheDir ?? resolve(".cache/memory-bench/judge"),
        judge: ref,
        generation: report.generation,
      }),
    ]),
  );
  const gradedCaches = new Map(
    judgeRefs.map((ref) => [
      ref,
      createJudgeCache({
        root: options.judgeCacheDir ?? resolve(".cache/memory-bench/judge"),
        judge: ref,
        generation: report.generation,
        version: GRADED_TEMPLATE_VERSION,
        kind: "judge-graded-v1",
      }),
    ]),
  );
  if (coding) {
    report.coding = codingMetadata(options.suite);
    report.judge = "executable-tests";
    report.concurrency = 1;
    report.limitations = [
      report.coding.comparability,
      "Repository images run with no network; tests needing downloads fail closed. One in-flight model call may cross the token ceiling.",
    ];
  }
  if (options.config === "om+fabric")
    report.limitations.push(
      "Combined public-suite runs use the configured promotion policy (off unless requested); lifecycle runs enable gated promotion explicitly.",
    );
  let prior;
  if (options.resume) {
    prior = typeof options.resume === "string" ? JSON.parse(await readFile(options.resume, "utf8")) : options.resume;
    const fingerprint = protocolFingerprint(report);
    if (prior.protocolHash !== fingerprint) throw new Error("MemoryBenchResumeMismatch");
    report.protocolHash = fingerprint;
    report.resumedFrom = { protocolHash: fingerprint, results: prior.results.length, inputTokens: prior.inputTokens ?? 0 };
    // Injection rows carry the labels; the judge phase rehydrates their text from the answer cache.
    report.injections = prior.injections ?? [];
  }
  report.protocolHash ??= protocolFingerprint(report);
  const priorResults = new Map((prior?.results ?? []).map((row) => [row.id, row]));
  const base = {
    inputTokens: prior?.inputTokens ?? 0,
    cacheReadTokens: prior?.cacheReadTokens ?? 0,
    cacheWriteTokens: prior?.cacheWriteTokens ?? 0,
    outputTokens: prior?.outputTokens ?? 0,
    wireExchanges: prior?.wireExchanges ?? 0,
    usageMissingExchanges: prior?.usageMissingExchanges ?? 0,
  };
  let admission;
  const wireAllocations = [];
  // A local write side spends nothing, so it needs no paid-attempt reservation.
  if (!options.offline && !localWrite) {
    const reserved = await requireAttemptReservation({
      journalPath: options.journal ?? process.env.PRISM_MEMORY_BENCH_JOURNAL,
      attemptId: options.attempt ?? process.env.PRISM_MEMORY_BENCH_ATTEMPT,
      maxInputTokens: options.maxInputTokens,
    });
    if (options.output && reserved.attempt.output !== options.output)
      throw new Error("MemoryBenchArguments: --output does not match the reserved attempt");
    report.attemptId = reserved.attempt.attemptId;
    admission = createAdmission({
      reservedInputTokens: reserved.attempt.reservedInputTokens,
      spent: () => report.accountedInputTokens ?? report.inputTokens,
    });
  }
  // Plan 202 Task 5.4.3: `:free` routes share one account-wide quota, so the solver, the product's
  // workers and both judges draw from a single pacer instead of one pacer per role.
  const sharedFreePace = createFreeRoutePace({
    perMinute: process.env.PRISM_MEMORY_BENCH_FREE_PACE_PER_MINUTE,
    freeOnly: options.freeOnly === true,
  });
  const temp = await mkdtemp(join(tmpdir(), "prism-memory-bench-"));
  const state = {
    ...report,
    timing,
    mockLatencyMs: options.mockLatencyMs ?? 0,
    mockInputTokens: 0,
    injectionText: new Map(),
    phase: "ingest",
    // Every model call in the arm starts here, judges included, so one pacer covers all roles.
    // Pacing happens at the provider edge, so every solver, worker and extractor call is counted.
    pace: sharedFreePace,
    ceilingReached: () => (report.accountedInputTokens ?? report.inputTokens) >= options.maxInputTokens,
  };
  let live;
  const evaluationRoutes = [];
  const judgeAgents = new Map();
  // Paid routes keep one pacer per judge model (the gateway quota is per model); free routes are
  // one account-wide pool, so they share the single pacer created above.
  const judgeRate = Number(process.env.PRISM_MEMORY_BENCH_JUDGE_RATE ?? "450");
  const judgePace = new Map(
    judgeRefs.map((ref) => [ref, sharedFreePace ?? createJudgePacer({ perHour: Number.isFinite(judgeRate) ? judgeRate : 450 })]),
  );
  const questionStates = new Set([state]);
  const readUsage = async (strict = true) => {
    if (options.offline || localWrite)
      report.inputTokens = base.inputTokens + [...questionStates].reduce((n, item) => n + item.mockInputTokens, 0);
    else {
      const rows = [];
      for (const { proxy, usageLog, role, rate, provider } of live.proxies) {
        await proxy.drain();
        if (existsSync(usageLog))
          rows.push(
            ...(await readFile(usageLog, "utf8"))
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => ({
                ...JSON.parse(line),
                route: proxy.url,
                provider,
                role,
                rate,
                cachedPrefix: role === "product" && options.config === "full",
              })),
          );
      }
      report.roleUsage = roleUsage(
        rows,
        prior?.roleUsage ??
          (base.wireExchanges
            ? {
                unknown: { ...base, exchanges: base.wireExchanges, complete: false, measured: null, cold: null, warm: null },
              }
            : undefined),
      );
      const bounded = options.freeOnly || options.boundedWire ? boundedWireUsage(rows, wireAllocations) : null;
      const missing = bounded?.usageMissingExchanges ?? missingUsageCount(rows);
      if (bounded) report.accountedInputTokens = (prior?.accountedInputTokens ?? base.inputTokens) + bounded.accountedInputTokens;
      report.usageComplete = base.usageMissingExchanges === 0 && missing === 0;
      report.usageMissingExchanges = base.usageMissingExchanges + missing;
      report.inputTokens = base.inputTokens + rows.reduce((n, row) => n + row.inputTokens, 0);
      report.cacheReadTokens = base.cacheReadTokens + rows.reduce((n, row) => n + (row.cacheReadTokens ?? 0), 0);
      report.cacheWriteTokens = (base.cacheWriteTokens ?? 0) + rows.reduce((n, row) => n + (row.cacheWriteTokens ?? 0), 0);
      report.outputTokens = base.outputTokens + rows.reduce((n, row) => n + row.outputTokens, 0);
      report.wireExchanges = base.wireExchanges + rows.length;
      // Incomplete billing evidence must not discard an otherwise valid arm: flag it and keep scoring.
      // The campaign reservation then holds the full allocation instead of the undercount.
      if (missing && strict) console.warn(`usage missing on ${missing} exchange(s); arm continues with incomplete usage`);
    }
    report.turns = [...questionStates].reduce((n, item) => n + item.turns, 0);
    report.injectedContextTokens = [...questionStates].reduce((n, item) => n + item.injectedContextTokens, 0);
  };
  let accounting = Promise.resolve();
  const account = (strict = true) => {
    accounting = accounting.catch(() => {}).then(() => readUsage(strict));
    return accounting;
  };
  state.refreshUsage = account;
  state.admission = admission;
  const beforeWireAttempt = async (input, init) => {
    await account();
    if (state.ceilingReached()) throw new Error("MemoryBenchTokenCeiling");
    if (!options.freeOnly && !options.boundedWire) return;
    const body = JSON.parse(init?.body ?? "{}");
    const route = live.proxies.find((p) => new URL(p.proxy.url).origin === new URL(input).origin);
    const model = live.models.get(`${route?.provider}/${body.model}`);
    const inputBound = model?.limits?.contextWindow;
    const outputBound = body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens;
    if (!Number.isSafeInteger(inputBound) || inputBound < 1 || !Number.isSafeInteger(outputBound) || outputBound < 1)
      throw new Error("MemoryBenchRequestBoundsUnavailable");
    if ((report.accountedInputTokens ?? report.inputTokens) + inputBound > options.maxInputTokens)
      throw new Error("MemoryBenchTokenCeiling");
    wireAllocations.push({
      route: route.proxy.url,
      exchange: wireAllocations.filter((r) => r.route === route.proxy.url).length + 1,
      inputBound,
      outputBound,
    });
    report.accountedInputTokens = (report.accountedInputTokens ?? report.inputTokens) + inputBound;
  };
  try {
    let questions, providers;
    if (options.offline) {
      // Tests may replace the fixture mix; production always reads the fixture.
      questions = (options.questions ?? fixture.questions).map((question) => ({
        ...question,
        sessions: question.sessions ?? fixture.sessions,
        date: question.date ?? question.sessions?.at(-1)?.date ?? fixture.sessions.at(-1).date,
      }));
      options.modelConfig = { provider: "mock", model: "synthetic", limits: { contextWindow: 128_000, maxOutputTokens: 1024 } };
      providers = [mockProvider(state)];
    } else if (localWrite) {
      // A write-only arm with no extractor (fabric-x) makes no model call: it builds the product
      // store locally, so no provider, judge or paid-attempt guard is needed.
      const raw = await loadDataset(options.suite, { cache: options.cache });
      questions = selectQuestions(normalizeDataset(raw, options.suite), options.suite, options);
      options.modelConfig = { provider: "mock", model: "synthetic", limits: { contextWindow: 128_000, maxOutputTokens: 1024 } };
      providers = [];
    } else {
      loadEnv();
      const raw = await loadDataset(options.suite, { cache: options.cache });
      if (coding) {
        if (options.subset === "targeted") throw new Error("MemoryBenchArguments: coding suites support base or all");
        questions = (options.subset === "all" ? raw : raw.slice(0, 1)).map((row) => ({
          ...normalizeCodingItem(row, options.suite),
          oracle: row,
        }));
      } else questions = selectQuestions(normalizeDataset(raw, options.suite), options.suite, options);
      const liveRefs = [{ provider: options.provider, model: options.model }];
      if (options.embeddings) liveRefs.push(refOf(options.embeddings));
      live = await liveProviders(liveRefs, temp, {
        freeOnly: options.freeOnly || options.freeProductOnly,
        maxOutputTokens: options.maxOutputTokens,
        beforeAttempt: beforeWireAttempt,
        onRetry: () => report.calls.gatewayRetries++,
        onOverload: () => {
          // Count every overload signal, not only the ones that could halve the gate: a probe at
          // concurrency 1 still needs to know the provider pushed back.
          report.calls.overloads++;
          if (gate.halve()) report.calls.concurrencyHalvings++;
        },
      });
      for (const proxy of live.proxies) {
        proxy.role = "product";
        // Mixed embedding/answer routes lack per-model wire identity and remain unpriced.
        proxy.rate =
          liveRefs.filter((ref) => ref.provider === proxy.provider).length === 1
            ? resolveRate(rates, `${proxy.provider}/${liveRefs.find((ref) => ref.provider === proxy.provider).model}`)
            : null;
      }
      for (const ref of coding ? [] : judgeRefs) {
        const route = await liveProviders([refOf(ref)], join(temp, `judge-${evaluationRoutes.length}`), {
          freeOnly: options.freeOnly,
          beforeAttempt: beforeWireAttempt,
          onRetry: () => report.calls.gatewayRetries++,
          onOverload: () => {
            report.calls.overloads++;
            if (gate.halve()) report.calls.concurrencyHalvings++;
          },
        });
        evaluationRoutes.push(route);
        for (const proxy of route.proxies) {
          proxy.role = "evaluation";
          proxy.rate = resolveRate(rates, ref);
        }
        live.proxies.push(...route.proxies);
        for (const [key, model] of route.models) live.models.set(key, model);
      }
      // The solver, the product's workers and the extractor all reach the model through these
      // providers, so pacing here spends the one free-route budget for every role (Task 5.4.3).
      providers = sharedFreePace ? live.providers.map((provider) => pacedProvider(provider, sharedFreePace)) : live.providers;
      options.modelConfig = live.models.get(`${options.provider}/${options.model}`);
      for (const ref of coding ? [] : judgeRefs)
        judgeAgents.set(
          ref,
          await createAgent({
            model: { ...live.models.get(ref), parameters: { ...live.models.get(ref).parameters, maxTokens: 8192 } },
            compaction: false,
            retry: false,
            packages: [
              providerPackage(
                `memory-bench-judge-providers-${ref.replace(/[^a-z0-9._-]+/gi, "-")}`,
                evaluationRoutes[judgeRefs.indexOf(ref)].providers,
              ),
            ],
            limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxOutputTokens: 32_768, maxWallTimeMs: 600_000 },
          }),
        );
    }
    // A repeat is a fresh draw of the same question: its own answer checkpoint, its own row.
    if (repeats > 1)
      questions = questions.flatMap((question) =>
        Array.from({ length: repeats }, (_, r) => ({
          ...question,
          id: r === 0 ? question.id : `${question.id}#r${r}`,
          baseId: question.id,
        })),
      );
    options.inputCap = resolveInputCap(undefined, options.modelConfig);
    report.inputCap = options.inputCap;
    if (["full", "full-truncated"].includes(options.config)) {
      report.comparatorContext = {
        version: 1,
        policy: options.config === "full" ? "complete-history" : "oldest-complete-turns",
        effectiveInputCap: options.inputCap,
        requestHeadroomTokens: 1024,
        modelConfig: {
          provider: options.modelConfig.provider,
          model: options.modelConfig.model,
          limits: options.modelConfig.limits,
          parameters: options.modelConfig.parameters,
        },
        tokenMeasure: "estimated-json-chars-div-4",
      };
    }
    report.selectedQuestionIds = questions.map((question) => question.id);
    // Recorded on every arm so a later campaign can prove a reuse instead of trusting a filename.
    report.runPathFingerprint = await runPathFingerprint(report, {
      ids: report.selectedQuestionIds,
      inputCap: report.inputCap,
    });
    // Plan 188.9 Task 4: a matching completed arm is copied, marked, and costs nothing.
    if (options.reuseFrom) {
      const ids = report.selectedQuestionIds;
      try {
        const reused = await reuseSource({ report, sourcePath: options.reuseFrom, ids });
        report.results = reused.results;
        report.status = "completed";
        report.reusedFrom = { from: reused.from, fingerprint: reused.fingerprint };
        report.timing = timing.summary({
          wallMs: performance.now() - startedAt,
          concurrency: { initial: report.concurrency, active: gate.limit, floor: 1 },
          results: report.results,
        });
        return summarize(report);
      } catch (error) {
        if (options.reuseFallback !== "run") throw error;
        report.reuseRefusal = error.message;
      }
    }
    const generateFor =
      (ref) =>
      async (prompt, { labels, parse, instruction }) => {
        if (options.offline) {
          return timing.measure("judge", async () => {
            if (options.mockLatencyMs) await delay(options.mockLatencyMs);
            report.calls.judge++;
            state.mockInputTokens += Math.ceil(prompt.length / 4);
            return prompt.includes("Answer used or irrelevant") ? "used" : "yes";
          });
        }
        return askJudge({
          agent: judgeAgents.get(ref),
          pace: judgePace.get(ref),
          prompt,
          labels,
          parse,
          instruction,
          textMode: options.judgeText === true,
          admission: state.admission,
          account,
          ceilingReached: state.ceilingReached,
          calls: report.calls,
          timing,
          backoffMs: (attempt, error) => {
            const retryAfter = retryAfterMs(causeChainText(error));
            if (retryAfter !== undefined) return retryAfter + 2000;
            return BENCH_RETRY.judgeBackoffMs[Math.min(attempt - 1, BENCH_RETRY.judgeBackoffMs.length - 1)];
          },
        });
      };
    report.measurementPolicy = {
      version: "product-phases-v1",
      judgeCallsPerHour: Number.isFinite(judgeRate) ? judgeRate : 450,
      injectionAnnotation: labelInjectionsEnabled,
      retriesAndBackoffIncluded: true,
      queueWaitIncluded: false,
      seedSnapshot: Boolean(options.seedSnapshot),
    };
    const generate = generateFor(judgeRefs[0]);
    const selected = questions.slice(0, options.maxQuestions ?? questions.length);
    // A read-side arm refuses to run without its write side; it never re-ingests silently.
    if (options.seedSnapshot) {
      const missing = selected
        .map((question) => join(options.seedSnapshot, encodeURIComponent(question.id)))
        .filter((dir) => !existsSync(dir));
      if (missing.length)
        throw new Error(`MemoryBenchWriteSideMissing: ${missing.length} of ${selected.length} snapshots missing`, {
          cause: { path: options.seedSnapshot },
        });
    }
    const suiteFor = (question) =>
      options.offline
        ? question.ability.startsWith("conflict-resolution")
          ? "memoryagentbench-cr"
          : ["single-hop", "multi-hop", "temporal", "open-domain", "adversarial"].includes(question.ability)
            ? "locomo"
            : "longmemeval-s"
        : options.suite;
    // Plan 202 Task 4.5.1: BEAM summarization/event_ordering also carry a graded score, the mean over judges.
    const scoreGradedForQuestion = async (question, answer, suite) => {
      const { fields, hits, misses } = await scoreGradedPanel({
        question,
        answer,
        suite,
        refs: judgeRefs,
        generateFor,
        caches: gradedCaches,
      });
      report.calls.judgeCacheHits += hits;
      report.calls.judgeCacheMisses += misses;
      return fields;
    };
    const scoreCached = async (question, answer, suite) => {
      // MAB is scored deterministically; there is no verdict to panel and no judge call to cache.
      if (suite === "memoryagentbench-cr") return scoreAnswer(question, answer, suite, generate, { synthetic: options.offline });
      const verdicts = {};
      let score;
      for (const ref of judgeRefs) {
        const { score: judged, cached } = await scoreAnswerCached(question, answer, suite, generateFor(ref), judgeCaches.get(ref), {
          synthetic: options.offline,
        });
        // Every judge returns the same shape; f1 is deterministic and identical across judges.
        score = judged;
        verdicts[ref] = judged.correct ? "yes" : "no";
        if (cached) report.calls.judgeCacheHits++;
        else report.calls.judgeCacheMisses++;
      }
      const verdict = combineVerdicts(verdicts);
      const graded = options.offline || !isGradedQuestion(question, suite) ? {} : await scoreGradedForQuestion(question, answer, suite);
      return { ...score, correct: verdict === "yes", judgeVerdicts: verdicts, ...graded };
    };
    const judgeCheckpoint = async (question, done) => {
      if (done?.outcome === "comparator_ineligible") {
        report.results.push(done);
        return;
      }
      const entry = done?.answerKey ? await answerCache.read(done.answerKey) : null;
      if (typeof entry?.answer !== "string")
        throw new Error("MemoryBenchAnswers: answer checkpoint has no cached answer; rerun --phase answer for this protocol");
      const questionState = {
        ...state,
        questionId: question.id,
        turns: 0,
        injectedContextTokens: 0,
        injections: report.injections,
        injectionText: new Map(),
      };
      for (const [index, text] of entry.injections ?? [])
        if (report.injections[index] && typeof text === "string") questionState.injectionText.set(report.injections[index], text);
      const suite = suiteFor(question);
      const phaseTiming = { ...done.phaseTiming };
      const stopEvaluation = timing.startPhase(phaseTiming, "evaluation");
      const score =
        done.answerOutcome === "run_limit" ? { correct: false, outcome: "run_limit" } : await scoreCached(question, entry.answer, suite);
      if (labelInjectionsEnabled && done.answerOutcome !== "run_limit")
        await labelInjections(question, entry.answer, questionState, generate, { concurrency: report.concurrency, timing });
      stopEvaluation();
      const row = {
        ...done,
        outcome: "scored",
        ...score,
        phaseTiming,
        stage: stageFromCounts({
          ...(done.evidenceCounts ?? {}),
          correct: score.correct,
          outcome: score.outcome,
          ability: question.ability,
        }),
      };
      const at = report.results.indexOf(done);
      if (at === -1) report.results.push(row);
      else report.results[at] = row;
      await account();
      if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
    };
    const runQuestion = async (question) => {
      const stopQuestion = timing.startQuestion();
      try {
        await runOne(question);
      } finally {
        stopQuestion();
      }
    };
    const runOne = async (question) => {
      const done = priorResults.get(question.id);
      if (done && done.correct !== undefined) {
        // A validated same-protocol checkpoint: reuse the score, spend nothing.
        report.results.push({ ...done, resumed: true });
        report.resumedResults = (report.resumedResults ?? 0) + 1;
        return;
      }
      if (phase === "judge") {
        if (!done) throw new Error("MemoryBenchArguments: --phase judge needs an answer checkpoint row for every question");
        await judgeCheckpoint(question, done);
        return;
      }
      if (!coding && phase === "all" && done?.outcome === "answered" && done.answerKey) {
        await judgeCheckpoint(question, done);
        return;
      }
      const questionState = { ...state, turns: 0, injectedContextTokens: 0, injectionText: new Map(), phaseTiming: {}, mockInputTokens: 0 };
      questionStates.add(questionState);
      let workspace;
      try {
        if (coding) {
          await account();
          if (state.ceilingReached()) throw new Error("MemoryBenchTokenCeiling");
          question.sessions = await codingHistory(question.oracle, { cache: options.cache });
          if (question.sessions.length) question.date = new Date(Date.parse(question.sessions.at(-1).date) + 60000).toISOString();
          workspace = await prepareCoding(question.oracle, { cache: options.cache });
        }
        const response = await replay(
          question,
          workspace
            ? { ...options, codingTools: workspace.tools, writeOnly: phase === "write" }
            : { ...options, writeOnly: phase === "write" },
          providers,
          questionState,
        );
        const suite = suiteFor(question);
        if (response.outcome === "comparator_ineligible") {
          report.results.push({
            id: question.id,
            ability: question.ability,
            cluster: question.cluster ?? question.conversationId ?? question.id,
            outcome: response.outcome,
            phaseTiming: questionState.phaseTiming,
            truncated: response.truncated,
            contextEligibility: response.contextEligibility,
          });
          await account();
          if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
          return;
        }
        // A write-side job builds the store and stops: no answer, no judge, nothing read.
        if (phase === "write") {
          report.results.push({
            id: question.id,
            ability: question.ability,
            cluster: question.cluster ?? question.conversationId ?? question.id,
            outcome: "ingested",
            phaseTiming: questionState.phaseTiming,
            ingest: response.ingest ?? null,
            storage: response.storage,
          });
          await account();
          if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
          if (!options.offline) console.log(`${report.results.length}/${questions.length} ingested; input=${report.inputTokens}`);
          return;
        }
        // Persist before any judge: an evaluation failure must never require answer regeneration.
        {
          const answerKey = answerCache.key({ protocolHash: report.protocolHash, id: question.id });
          await answerCache.write(answerKey, {
            answer: response.answer,
            trace: response.trace,
            injections: questionState.injections
              .map((item, index) => [index, questionState.injectionText.get(item)])
              .filter(([, text]) => typeof text === "string"),
          });
          report.results.push({
            id: question.id,
            ability: question.ability,
            cluster: question.cluster ?? question.conversationId ?? question.id,
            outcome: "answered",
            answerOutcome: response.outcome ?? "completed",
            phaseTiming: questionState.phaseTiming,
            answerKey,
            truncated: response.truncated,
            ...(response.contextEligibility ? { contextEligibility: response.contextEligibility } : {}),
            syntheticDates: question.syntheticDates ?? false,
            toolCalls: response.toolCalls ?? 0,
            recallCalls: response.recallCalls ?? 0,
            explicitRecallCalls: response.explicitRecallCalls ?? 0,
            automaticRecallCalls: response.automaticRecallCalls ?? 0,
            recalledIds: response.recalledIds ?? [],
            answerRetries: response.answerRetries ?? 0,
            turns: response.turns ?? 0,
            turnTrace: safeFailureTrace({ tools: response.turnTrace })?.tools ?? [],
            writes: response.writes ?? [],
            visibleChannels: response.visibleChannels ?? [],
            storage: response.storage ?? { fabric: "none", sessions: "ephemeral" },
            retrievedSnippetTokens: response.retrievedSnippetTokens ?? 0,
            retrievalRecallAtK: response.retrievalRecallAtK ?? null,
            answerSessionHitAtK: response.answerSessionHitAtK ?? null,
            evidenceRoundCoverage: response.evidenceRoundCoverage ?? null,
            evidenceAllRequired: response.evidenceAllRequired ?? null,
            fineEvidenceRecall: response.fineEvidenceRecall ?? null,
            fineEvidencePrecision: response.fineEvidencePrecision ?? null,
            evidenceCounts: response.evidenceCounts ?? null,
            ingest: response.ingest ?? null,
          });
          await account();
          if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
          if (phase === "answer" && report.inputTokens >= options.maxInputTokens) {
            if (report.status === "completed") report.status = "token-ceiling";
            return;
          }
          if (phase === "answer") {
            if (!options.offline) console.log(`${report.results.length}/${questions.length} answered; input=${report.inputTokens}`);
            return;
          }
        }
        const answeredAt = report.results.findIndex((row) => row.id === question.id);
        const answered = report.results[answeredAt];
        const stopEvaluation = timing.startPhase(questionState.phaseTiming, "evaluation");
        const score =
          response.outcome === "run_limit"
            ? { correct: false, outcome: "run_limit" }
            : coding
              ? { correct: await workspace.grade() }
              : await scoreCached(question, response.answer, suite);
        if (!coding && response.outcome !== "run_limit" && labelInjectionsEnabled)
          await labelInjections(question, response.answer, questionState, generate, { concurrency: report.concurrency, timing });
        stopEvaluation();
        report.results[answeredAt] = {
          ...answered,
          outcome: "scored",
          id: question.id,
          ability: question.ability,
          cluster: question.cluster ?? question.conversationId ?? question.id,
          phaseTiming: questionState.phaseTiming,
          ...score,
          ...(coding ? { agentSteps: response.agentSteps, image: workspace.image } : {}),
          truncated: response.truncated,
          ...(response.contextEligibility ? { contextEligibility: response.contextEligibility } : {}),
          syntheticDates: question.syntheticDates ?? false,
          toolCalls: response.toolCalls ?? 0,
          recallCalls: response.recallCalls ?? 0,
          recalledIds: response.recalledIds ?? [],
          answerRetries: response.answerRetries ?? 0,
          turns: response.turns ?? 0,
          turnTrace: safeFailureTrace({ tools: response.turnTrace })?.tools ?? [],
          writes: response.writes ?? [],
          visibleChannels: response.visibleChannels ?? [],
          storage: response.storage ?? { fabric: "none", sessions: "ephemeral" },
          retrievedSnippetTokens: response.retrievedSnippetTokens ?? 0,
          retrievalRecallAtK: response.retrievalRecallAtK ?? null,
          answerSessionHitAtK: response.answerSessionHitAtK ?? null,
          evidenceRoundCoverage: response.evidenceRoundCoverage ?? null,
          evidenceAllRequired: response.evidenceAllRequired ?? null,
          fineEvidenceRecall: response.fineEvidenceRecall ?? null,
          fineEvidencePrecision: response.fineEvidencePrecision ?? null,
          evidenceCounts: response.evidenceCounts ?? null,
          attributionProvenance: response.evidenceCounts?.labelSource ?? "unknown",
          stage: stageFromCounts({
            ...(response.evidenceCounts ?? {}),
            correct: score.correct,
            outcome: score.outcome ?? response.outcome,
            ability: question.ability,
          }),
        };
        await account();
        if (coding) report.metrics = summarizeCoding(options.suite, report.results);
        if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
        if (report.inputTokens >= options.maxInputTokens) {
          if (report.status === "completed") report.status = "token-ceiling";
          return;
        }
        if (!options.offline) console.log(`${report.results.length}/${questions.length} scored; input=${report.inputTokens}`);
      } catch (error) {
        // Retain failed answer attempts too, without overwriting a completed answer awaiting a judge.
        let diagnosticKey;
        if (questionState.privateTrace && !report.results.some((row) => row.id === question.id && row.answerKey)) {
          diagnosticKey = answerCache.key({ protocolHash: report.protocolHash, id: question.id });
          await answerCache.write(diagnosticKey, { answer: null, trace: questionState.privateTrace });
        }
        const failure = {
          questionId: question.id,
          ...(diagnosticKey ? { diagnosticKey } : {}),
          code: error.message.startsWith("MemoryBench")
            ? error.message.replace(/[^a-zA-Z0-9_:-]/g, "").slice(0, 100)
            : "MemoryBenchReplayError",
          // A plain Error has no cause; keep a short safe reason so a paid arm is diagnosable.
          ...(error.message
            ? {
                message: String(error.message)
                  .replace(/[^a-zA-Z0-9_:.,'/ -]/g, "")
                  .slice(0, 160),
              }
            : {}),
          ...(error.cause
            ? {
                cause: {
                  name: String(error.cause.name ?? "Error")
                    .replace(/[^a-zA-Z0-9_:-]/g, "")
                    .slice(0, 80),
                  code: String(error.cause.code ?? "unknown")
                    .replace(/[^a-zA-Z0-9_:-]/g, "")
                    .slice(0, 80),
                  // The kernel already redacted this ErrorInfo; keep the reason so a failed arm is diagnosable.
                  message: String(error.cause.message ?? "")
                    .replace(/[^a-zA-Z0-9_:.,'/ -]/g, "")
                    .slice(0, 160),
                  ...(error.cause.failureClass
                    ? {
                        failureClass: String(error.cause.failureClass)
                          .replace(/[^a-zA-Z0-9_:-]/g, "")
                          .slice(0, 40),
                      }
                    : {}),
                },
              }
            : {}),
          ...(safeFailureTrace(error.diagnostics) ? { trace: safeFailureTrace(error.diagnostics) } : {}),
        };
        let disposition = questionFailureDisposition({
          error,
          budget: state.ceilingReached() || questionState.budgetExceeded || error.message === "MemoryBenchTokenCeiling",
          errored: report.results.filter((row) => row.outcome === "error").length,
          total: selected.length,
        });
        if (disposition === "scored" && report.results.some((row) => row.id === question.id && row.outcome === "answered"))
          disposition = "failed";
        // Bounded error evidence stays on the report either way.
        report.errors = [...(report.errors ?? []), failure].slice(-10);
        if (disposition === "scored") {
          report.results.push({
            id: question.id,
            ability: question.ability,
            cluster: question.cluster ?? question.conversationId ?? question.id,
            correct: false,
            outcome: "error",
            stage: "transport_setup_error",
            attributionProvenance: "outcome",
            errorCode: String(error.name ?? "Error")
              .replace(/[^a-zA-Z0-9_:-]/g, "")
              .slice(0, 60),
            truncated: false,
            syntheticDates: question.syntheticDates ?? false,
          });
          await account(false);
          if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
          if (!options.offline) console.log(`${report.results.length}/${questions.length} scored; input=${report.inputTokens}`);
          return;
        }
        report.status = disposition;
        report.failure = failure;
        await account(false);
      } finally {
        await workspace?.close();
      }
    };
    await runQuestionPool(
      selected,
      report.concurrency,
      runQuestion,
      () => report.status !== "completed",
      report.concurrency > 1 ? gate : undefined,
    );
    const order = new Map(questions.map((question, index) => [question.id, index]));
    report.results.sort((a, b) => order.get(a.id) - order.get(b.id));
    if (options.maxQuestions && options.maxQuestions < questions.length && report.status === "completed") report.status = "partial";
  } finally {
    for (const agent of judgeAgents.values()) await agent.dispose();
    if (live) for (const { proxy } of live.proxies) proxy.stop();
    await rm(temp, { recursive: true, force: true });
  }
  if (coding) report.metrics = summarizeCoding(options.suite, report.results);
  // An answer-only checkpoint is not a score; it exists to be judged in its own phase.
  if (phase === "answer" && report.status === "completed") report.status = "answers";
  report.timing = timing.summary({
    wallMs: performance.now() - startedAt,
    concurrency: { initial: report.concurrency, active: gate.limit, floor: 1 },
    results: report.results,
  });
  return summarize(report);
}
if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runBench(options);
    if (options.replay) {
      const text = `${JSON.stringify(report, null, 2)}\n`;
      if (options.output) {
        await mkdir(dirname(options.output), { recursive: true });
        await writeFile(options.output, text);
      } else console.log(text);
    } else {
      const clean = (value) => String(value).replace(/[^a-zA-Z0-9_.+-]/g, "_");
      const path =
        options.output ??
        resolve(
          "docs/_evidence/memory-bench",
          `${report.suite}-${report.config}-${report.provider}-${clean(report.model)}-${report.generatedAt.replace(/[:.]/g, "-")}.json`,
        );
      await writeReport(report, path);
      const count = report.suite === "lifecycle" ? `${report.sessions.length} sessions` : `${report.results.length} questions`;
      console.log(`${report.status}: ${count}, ${report.inputTokens} input tokens; ${path}`);
      if (!["completed", "unavailable", "schema-smoke"].includes(report.status)) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    if (process.env.PRISM_DEBUG) console.error(error.stack);
    console.error("memory benchmark setup failed; check arguments, credentials, dataset cache and README");
    process.exitCode = 1;
  }
}
