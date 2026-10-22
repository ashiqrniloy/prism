#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgent, createDefaultRetryPolicy, resolveInputCap } from "@arnilo/prism";
import { providerPackage, readBoundedResponseText } from "@arnilo/prism/provider-kit";
import { parseEnvFile } from "../live-matrix.mjs";
import { startWireProxy } from "../wire-proxy.mjs";
import { historicalVariants, memoryConfigs, resolvedMemoryConfigs } from "./ablations.mjs";
import {
  CODING_SUITES,
  codingAccess,
  codingHistory,
  codingMetadata,
  codingSchemaReport,
  prepareCoding,
  summarizeCoding,
} from "./coding.mjs";
import { DATASETS, loadDataset, normalizeCodingItem, normalizeDataset, selectQuestions } from "./datasets.mjs";
import fixture from "./fixtures/synthetic.json" with { type: "json" };
import { createAdmission, requireAttemptReservation, stableHash } from "./journal.mjs";
import { judgeOutput, judgeProviderOptions, labelInjections, scoreAnswer } from "./judge.mjs";
import { BENCH_MAX_TURNS, BENCH_RETRY, mockProvider, replay } from "./replay.mjs";
import { summarize, writeReport } from "./report.mjs";
import { missingUsageCount } from "./usage.mjs";
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
};
export function parseArgs(argv) {
  const options = {};
  const flags = new Set([
    "suite",
    "config",
    "provider",
    "model",
    "judge",
    "embeddings",
    "subset",
    "ability",
    "max-input-tokens",
    "output",
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
  ]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--offline") {
      options.offline = true;
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
  for (const key of ["maxInputTokens", "maxQuestions", "seed"])
    if (options[key] !== undefined) {
      options[key] = Number(options[key]);
      if (!Number.isSafeInteger(options[key]) || options[key] < 1)
        throw new Error("MemoryBenchArguments: limits must be positive integers");
    }
  return options;
}
export function loadEnv() {
  const path = process.env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (existsSync(path)) {
    for (const [name, value] of Object.entries(parseEnvFile(path))) if (process.env[name] === undefined) process.env[name] = value;
  } else if (process.env.PRISM_LIVE_ENV_FILE) throw new Error("MemoryBenchCredentials: explicit live env file missing");
}
export function benchmarkFetch({ beforeAttempt = async () => {}, onRetry = () => {}, fetch: transport = fetch } = {}) {
  const policy = createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 1000 });
  return async (input, init) => {
    for (let attempt = 1; ; attempt++) {
      await beforeAttempt();
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
      if (!decision.retry) return response;
      onRetry();
      await response.body?.cancel();
      await delay(decision.delayMs, undefined, { signal: init?.signal });
    }
  };
}
export async function liveProviders(refs, temp, fetchOptions) {
  const providers = [],
    proxies = [],
    models = new Map();
  try {
    for (const id of new Set(refs.map((ref) => ref.provider))) {
      const spec = PROVIDERS[id];
      if (!spec) throw new Error("MemoryBenchProvider: supported providers are hyper and opencode-go");
      const key = process.env[spec.secret] ?? (id === "opencode-go" ? process.env.OPENCODE_API_KEY : undefined);
      if (!key) throw new Error("MemoryBenchCredentials: provider credential unavailable");
      const module = await import(`@arnilo/prism-provider-${id}`);
      const catalog = await module[spec.list]({ apiKey: () => key, signal: AbortSignal.timeout(30_000) });
      for (const ref of refs.filter((ref) => ref.provider === id)) {
        const model = catalog.find((model) => model.model === ref.model);
        if (!model) throw new Error("MemoryBenchModel: model not found in provider catalog");
        models.set(`${id}/${ref.model}`, { ...model, parameters: { ...model.parameters, maxTokens: 4096, temperature: 0 } });
      }
      const usageLog = join(temp, `${id}-usage.jsonl`);
      const proxy = await startWireProxy({
        upstream: spec.url,
        listen: "127.0.0.1:0",
        usageLog,
        secretEnv: [spec.secret, "OPENCODE_API_KEY"],
      });
      proxies.push({ proxy, usageLog });
      providers.push(module[spec.create]({ apiKey: () => key, baseUrl: proxy.url, fetch: benchmarkFetch(fetchOptions) }));
    }
    return { providers, proxies, models };
  } catch (error) {
    for (const { proxy } of proxies) proxy.stop();
    throw error;
  }
}
export const refOf = (ref) => {
  const slash = ref?.indexOf("/") ?? -1;
  if (slash < 1 || slash === ref.length - 1) throw new Error("MemoryBenchArguments: judge must be provider/model");
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
};
/** Bounded question concurrency; an in-flight request may finish after the ceiling. */
export async function runQuestionPool(questions, concurrency, run, stopped) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, questions.length) }, async () => {
      while (!stopped() && cursor < questions.length) {
        const question = questions[cursor++];
        await run(question);
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

/** A malformed or cut judge answer can be re-asked; auth, permanent, budget and run-limit cannot. */
export function isRetryableJudgeFailure(error) {
  const message = String(error?.message ?? "");
  const detail = `${message}\n${String(error?.cause?.message ?? "")}`;
  if (terminalRetryCause(error)) return false;
  if (/without completion evidence/i.test(detail)) return true;
  return /^MemoryBenchJudgeError: (invalid verdict JSON|invalid verdict enum|judge must answer yes or no|invalid injection label)$/.test(
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

/** One logical judge request; each attempt gets a fresh one-shot session and its own admission check. */
export async function askJudge({
  agent,
  prompt,
  labels,
  admission,
  account,
  ceilingReached,
  calls,
  backoffMs = (attempt) => 1000 * attempt,
  timeoutMs = 600_000,
}) {
  calls.judge++;
  for (let attempt = 1; ; attempt += 1) {
    admission?.check();
    let session;
    try {
      await account();
      if (ceilingReached()) throw new Error("MemoryBenchTokenCeiling");
      session = await agent.session();
      calls.judgeAttempts++;
      const result = await session.run(`${prompt}\nReturn a JSON object with one field verdict containing the requested label.`, {
        providerOptions: judgeProviderOptions(labels),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!["completed", "stopped"].includes(result.status)) {
        throw new Error(`MemoryBenchJudgeError:${result.error?.code ?? result.status}`, { cause: result.error });
      }
      return judgeOutput(result.text, labels);
    } catch (error) {
      if (attempt >= BENCH_RETRY.judgeAttempts || !isRetryableJudgeFailure(error)) throw error;
      await delay(backoffMs(attempt));
    } finally {
      await session?.close();
      admission?.release();
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
export function protocolFingerprint(report) {
  return stableHash({
    suite: report.suite,
    subset: report.subset,
    ability: report.ability ?? null,
    config: report.config,
    provider: report.provider,
    model: report.model,
    judge: report.judge,
    judgeProtocol: report.judgeProtocol,
    dataset: report.dataset?.revision ?? report.dataset?.url ?? report.dataset?.license ?? null,
    seed: report.seed ?? null,
    ablations: report.ablations,
    sourceVariants: report.sourceVariants,
    memoryConfig: report.memoryConfig,
    protocol: report.protocol ?? null,
    sourceRevision: report.sourceRevision,
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
  if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1)
    throw new Error("MemoryBenchArguments: positive token ceiling required");
  const validConfigs = ["full", "om", "fabric", "fabric-hybrid", "fabric-agentic", "om+fabric"];
  if (!validConfigs.includes(options.config)) throw new Error("MemoryBenchArguments: invalid config");
  if (options.config === "fabric-hybrid" && !options.embeddings) {
    throw new Error("MemoryBenchArguments: fabric-hybrid requires --embeddings provider/model");
  }
  if (!["base", "confirmatory", "targeted", "all"].includes(options.subset)) throw new Error("MemoryBenchArguments: invalid subset");
  if (options.subset === "targeted" && (options.suite !== "longmemeval-s" || !options.ability))
    throw new Error("MemoryBenchArguments: targeted needs LongMemEval and ability");
  if (coding && (options.offline || !codingAccess(options.suite).available)) return codingSchemaReport(options);
  if (!options.offline && (!DATASETS[options.suite] || !options.provider || !options.model || (!coding && !options.judge)))
    throw new Error("MemoryBenchArguments: suite, provider, model and judge required");
  options.memoryConfigs = memoryConfigs(options);
  const report = {
    schemaVersion: 1,
    usageSource: options.offline ? "mock" : "wire-proxy",
    concurrency: options.offline ? 1 : 4,
    generation: options.offline ? null : { temperature: 0, maxTokens: 4096 },
    generatedAt: new Date().toISOString(),
    suite: options.offline ? "synthetic" : options.suite,
    subset: options.subset,
    ability: options.ability ?? null,
    seed: options.seed ?? null,
    config: options.config,
    embeddings: options.embeddings ?? null,
    provider: options.offline ? "mock" : options.provider,
    model: options.offline ? "synthetic" : options.model,
    judge: options.offline ? "mock/synthetic-judge" : options.judge,
    judgeProtocol: options.offline ? "mock-enum-v1" : "enum-json-v1",
    dataset: options.offline ? { license: "original synthetic fixture" } : DATASETS[options.suite],
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
    outputTokens: 0,
    calls: { observer: 0, reflector: 0, dropper: 0, embedding: 0, decider: 0, judge: 0, judgeAttempts: 0, gatewayRetries: 0 },
    turns: 0,
    injectedContextTokens: 0,
    injections: [],
    attemptId: null,
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
  }
  report.protocolHash ??= protocolFingerprint(report);
  const priorResults = new Map((prior?.results ?? []).map((row) => [row.id, row]));
  const base = {
    inputTokens: prior?.inputTokens ?? 0,
    cacheReadTokens: prior?.cacheReadTokens ?? 0,
    outputTokens: prior?.outputTokens ?? 0,
    wireExchanges: prior?.wireExchanges ?? 0,
    usageMissingExchanges: prior?.usageMissingExchanges ?? 0,
  };
  let admission;
  if (!options.offline) {
    const reserved = await requireAttemptReservation({
      journalPath: options.journal ?? process.env.PRISM_MEMORY_BENCH_JOURNAL,
      attemptId: options.attempt ?? process.env.PRISM_MEMORY_BENCH_ATTEMPT,
      maxInputTokens: options.maxInputTokens,
    });
    if (options.output && reserved.attempt.output !== options.output)
      throw new Error("MemoryBenchArguments: --output does not match the reserved attempt");
    report.attemptId = reserved.attempt.attemptId;
    admission = createAdmission({ reservedInputTokens: reserved.attempt.reservedInputTokens, spent: () => report.inputTokens });
  }
  const temp = await mkdtemp(join(tmpdir(), "prism-memory-bench-"));
  const state = {
    ...report,
    mockInputTokens: 0,
    injectionText: new Map(),
    phase: "ingest",
    ceilingReached: () => report.inputTokens >= options.maxInputTokens,
  };
  let live, judgeAgent;
  const questionStates = new Set([state]);
  const readUsage = async (strict = true) => {
    if (options.offline) report.inputTokens = base.inputTokens + state.mockInputTokens;
    else {
      const rows = [];
      for (const { proxy, usageLog } of live.proxies) {
        await proxy.drain();
        if (existsSync(usageLog))
          rows.push(
            ...(await readFile(usageLog, "utf8"))
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          );
      }
      const missing = missingUsageCount(rows);
      report.usageComplete = base.usageMissingExchanges === 0 && missing === 0;
      report.usageMissingExchanges = base.usageMissingExchanges + missing;
      report.inputTokens = base.inputTokens + rows.reduce((n, row) => n + row.inputTokens, 0);
      report.cacheReadTokens = base.cacheReadTokens + rows.reduce((n, row) => n + row.cacheReadTokens, 0);
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
  try {
    let questions, providers;
    if (options.offline) {
      questions = fixture.questions.map((question) => ({ ...question, sessions: fixture.sessions, date: fixture.sessions.at(-1).date }));
      options.modelConfig = { provider: "mock", model: "synthetic", limits: { contextWindow: 128_000, maxOutputTokens: 1024 } };
      providers = [mockProvider(state)];
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
      const liveRefs = [{ provider: options.provider, model: options.model }, ...(!coding ? [refOf(options.judge)] : [])];
      if (options.embeddings) liveRefs.push(refOf(options.embeddings));
      live = await liveProviders(liveRefs, temp, {
        beforeAttempt: async () => {
          await account();
          if (state.ceilingReached()) throw new Error("MemoryBenchTokenCeiling");
        },
        onRetry: () => report.calls.gatewayRetries++,
      });
      providers = live.providers;
      options.modelConfig = live.models.get(`${options.provider}/${options.model}`);
      if (!coding)
        judgeAgent = await createAgent({
          model: live.models.get(options.judge),
          compaction: false,
          retry: false,
          packages: [providerPackage("memory-bench-judge-providers", providers)],
          limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 600_000 },
        });
    }
    options.inputCap = resolveInputCap(undefined, options.modelConfig);
    report.inputCap = options.inputCap;
    report.selectedQuestionIds = questions.map((question) => question.id);
    const generate = async (prompt, { labels }) => {
      if (options.offline) {
        report.calls.judge++;
        state.mockInputTokens += Math.ceil(prompt.length / 4);
        return prompt.includes("Answer used or irrelevant") ? "used" : "yes";
      }
      return askJudge({
        agent: judgeAgent,
        prompt,
        labels,
        admission: state.admission,
        account,
        ceilingReached: state.ceilingReached,
        calls: report.calls,
        backoffMs: (attempt) => BENCH_RETRY.judgeBackoffMs[Math.min(attempt - 1, BENCH_RETRY.judgeBackoffMs.length - 1)],
      });
    };
    const selected = questions.slice(0, options.maxQuestions ?? questions.length);
    const runQuestion = async (question) => {
      const done = priorResults.get(question.id);
      if (done) {
        // A validated same-protocol checkpoint: reuse the score, spend nothing.
        report.results.push({ ...done, resumed: true });
        report.resumedResults = (report.resumedResults ?? 0) + 1;
        return;
      }
      const questionState = options.offline ? state : { ...state, turns: 0, injectedContextTokens: 0, injectionText: new Map() };
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
          workspace ? { ...options, codingTools: workspace.tools } : options,
          providers,
          questionState,
        );
        const suite = options.offline
          ? question.ability.startsWith("conflict-resolution")
            ? "memoryagentbench-cr"
            : ["single-hop", "multi-hop", "temporal", "open-domain", "adversarial"].includes(question.ability)
              ? "locomo"
              : "longmemeval-s"
          : options.suite;
        const score = coding
          ? { correct: await workspace.grade() }
          : await scoreAnswer(question, response.answer, suite, generate, { synthetic: options.offline });
        if (!coding) await labelInjections(question, response.answer, questionState, generate);
        report.results.push({
          id: question.id,
          ability: question.ability,
          cluster: question.cluster ?? question.conversationId ?? question.id,
          ...score,
          ...(coding ? { agentSteps: response.agentSteps, image: workspace.image } : {}),
          truncated: response.truncated,
          syntheticDates: question.syntheticDates ?? false,
          toolCalls: response.toolCalls ?? 0,
          recallCalls: response.recallCalls ?? 0,
          recalledIds: response.recalledIds ?? [],
          answerRetries: response.answerRetries ?? 0,
          turns: response.turns ?? 0,
          turnTrace: response.turnTrace ?? [],
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
        });
        await account();
        if (coding) report.metrics = summarizeCoding(options.suite, report.results);
        if (options.output) await writeReport(summarize({ ...report, status: "running" }), options.output);
        if (report.inputTokens >= options.maxInputTokens) {
          if (report.status === "completed") report.status = "token-ceiling";
          return;
        }
        if (!options.offline) console.log(`${report.results.length}/${questions.length} scored; input=${report.inputTokens}`);
      } catch (error) {
        report.status =
          state.ceilingReached() || questionState.budgetExceeded || error.message === "MemoryBenchTokenCeiling"
            ? "token-ceiling"
            : "failed";
        report.failure = {
          questionId: question.id,
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
        await account(false);
      } finally {
        await workspace?.close();
      }
    };
    await runQuestionPool(selected, options.offline || coding ? 1 : 4, runQuestion, () => report.status !== "completed");
    const order = new Map(questions.map((question, index) => [question.id, index]));
    report.results.sort((a, b) => order.get(a.id) - order.get(b.id));
    if (options.maxQuestions && options.maxQuestions < questions.length && report.status === "completed") report.status = "partial";
  } finally {
    if (judgeAgent) await judgeAgent.dispose();
    if (live) for (const { proxy } of live.proxies) proxy.stop();
    await rm(temp, { recursive: true, force: true });
  }
  if (coding) report.metrics = summarizeCoding(options.suite, report.results);
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
    console.error(`${error.name}: memory benchmark setup failed; check arguments, credentials, dataset cache and README`);
    process.exitCode = 1;
  }
}
