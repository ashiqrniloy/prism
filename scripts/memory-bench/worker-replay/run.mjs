/**
 * Plan 218.2 Task 1: the worker replay screen.
 *
 * Each frozen STM and WM request (`build.mjs`) goes through the product's own worker entry points, `runStm` and `runWm`,
 * with the package defaults (`resolveMemorySystemConfig({})`), protections and salience computed by the product, and
 * the flush's output-cap retry for WM. There is no main agent and no judge: `score.mjs` matches the outputs against the
 * annotations. Live, the workers are the gate record's models behind the bench wire proxy; offline, a scripted worker
 * answers every request and the report must equal `OFFLINE_EXPECTED` exactly.
 *
 *   timeout 300 bun scripts/memory-bench/worker-replay/run.mjs --offline [--out <file>]
 *   timeout 7200 bun scripts/memory-bench/worker-replay/run.mjs --gate <owner-gate-replay.json> --out <file> [--label baseline]
 *   timeout 60 bun scripts/memory-bench/worker-replay/run.mjs --pair <replay-after.json>   (Task 9: the paired reading)
 *
 * Evidence carries ids, counts, rates and hashes only; no transcript, record, scope or chunk text.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { resolveMemoryWorkerLimits } from "@arnilo/prism-memory-system/core";
import { resolveMemorySystemConfig } from "../../../packages/memory/system/src/session/config.ts";
import { protectedRecords } from "../../../packages/memory/system/src/session/protections.ts";
import { salienceSignals } from "../../../packages/memory/system/src/session/salience.ts";
import { serializeSourceEntries } from "../../../packages/memory/system/src/session/serialize.ts";
import { estimateTextTokens } from "../../../packages/memory/system/src/session/tokens.ts";
import { runStm } from "../../../packages/memory/system/src/session/workers/stm.ts";
import { runWm } from "../../../packages/memory/system/src/session/workers/wm.ts";
import { stableHash } from "../journal.mjs";
import { digest } from "../mechanism-probes/harness.mjs";
import { assertMemoryModelFixture, frozenMemoryModelHash, MEMORY_MODEL_CRITERIA } from "../robustness.mjs";
import { m2ProductFingerprint } from "../wm-gate.mjs";
import { loadWorkerReplayFixture, WORKER_REPLAY_DIR } from "./build.mjs";
import {
  aggregateStm,
  decideTask2,
  decideTask4,
  pairReplays,
  REPLAY_RULES,
  scoreStmRequest,
  scoreWmRequest,
  stmGroups,
  wmGroups,
} from "./score.mjs";

export const REPLAY_GATE = "docs/_evidence/memory-bench/218.2/gates/owner-gate-replay.json";
export const REPLAY_BASELINE = "docs/_evidence/memory-bench/218.2/replay-baseline.json";
export const REPLAY_FIXTURE_ID = "worker-replay";
export const REPLAY_REPORT_KIND = "worker-replay-report-v1";
export const OFFLINE_MODEL = "scripted/worker";
const STATE_ROOT = ".cache/memory-bench/218.2/replay";
/** The plan's all-in Muse rate (plan 218.1 Task 3's probe; OpenCode Go bills a subscription): an estimate, not an invoice. */
const ALL_IN_USD_PER_M_INPUT = 0.065;

export const rulesHash = (rules = REPLAY_RULES) => stableHash(rules);
const tokens = (value) => Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4);

// ---------------------------------------------------------------------------------------------------------------------
// The client a worker call runs on: counts turns, usage, the tool schema offered and the refused calls.

/** Wraps a `ModelClient` so one worker call's counters can be read after it ends. */
export function instrumentClient(base) {
  const stats = { turns: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, tools: undefined, messages: undefined };
  const client = {
    model: base.model,
    ...(base.resolve ? { resolve: base.resolve } : {}),
    async *generate(request) {
      stats.turns += 1;
      stats.tools ??= request.tools;
      // The worker loop appends to this array after each turn, so after the call it holds every tool result.
      stats.messages = request.messages;
      let usage;
      for await (const event of base.generate(request)) {
        if (event.type === "usage") usage = event.usage;
        if (event.type === "done" && event.usage) usage = event.usage;
        yield event;
      }
      stats.usage.inputTokens += usage?.inputTokens ?? 0;
      stats.usage.outputTokens += usage?.outputTokens ?? 0;
      stats.usage.cacheReadTokens += usage?.cacheReadTokens ?? 0;
    },
  };
  return { client, stats };
}

/** Refused calls by reason: an error result's code, or an `{ ok: false }` value's `reason`. */
export function refusedReasons(messages = []) {
  const counts = {};
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const block of message.content ?? []) {
      if (block.type !== "tool_result") continue;
      // Plan 218.2 Task 5: a `judge` result lists each refused entry; each counts as one refused call.
      if (Array.isArray(block.result?.refused)) {
        for (const entry of block.result.refused) counts[String(entry.reason)] = (counts[String(entry.reason)] ?? 0) + 1;
        continue;
      }
      const reason = block.error?.code ?? (block.result?.ok === false ? String(block.result.reason ?? "unknown") : undefined);
      if (reason) counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}

const schemaOf = (tools, name) => new Set(Object.keys(tools?.find((tool) => tool.name === name)?.parameters?.properties ?? {}));

// ---------------------------------------------------------------------------------------------------------------------
// One request through the product.

const CONFIG = resolveMemorySystemConfig({});
const LIMITS = resolveMemoryWorkerLimits(CONFIG.worker);

function failure(error) {
  // Names and codes only: a worker error message can quote the request.
  return { name: String(error?.name ?? "Error"), code: typeof error?.code === "string" ? error.code : undefined };
}

export async function replayStm({ request, annotation, makeClient, sessionId }) {
  const { client, stats } = instrumentClient(makeClient(request, "stm"));
  const chunks = new Map();
  const sourceText = serializeSourceEntries(request.entries, [], LIMITS.maxMessageBytes);
  let events = [];
  let failed;
  try {
    events = await runStm({
      client,
      entries: request.entries,
      sourceText,
      ...(request.taskState ? { taskState: request.taskState } : {}),
      recent: request.recent,
      contextTokens: CONFIG.stm.contextTokens,
      maxChunksPerEvent: CONFIG.stm.maxChunksPerEvent,
      maxChunkBytes: CONFIG.stm.maxChunkBytes,
      autoChunkBytes: CONFIG.stm.autoChunkBytes,
      habituation: CONFIG.stm.habituation,
      onChunks: (id, prepared) => chunks.set(id, prepared),
      ...LIMITS,
      thinkingLevel: CONFIG.stm.thinkingLevel,
      sessionId,
    });
  } catch (error) {
    failed = failure(error);
  }
  return scoreStmRequest({
    request,
    annotation,
    events,
    chunks,
    schema: schemaOf(stats.tools, "record_event"),
    run: {
      turns: stats.turns,
      usage: stats.usage,
      refused: refusedReasons(stats.messages),
      sourceTokens: estimateTextTokens(sourceText),
      failed,
    },
  });
}

export async function replayWm({ request, annotation, makeClient, sessionId }) {
  const ledger = {
    observations: request.records,
    wmItems: request.wmItems,
    droppedObservationIds: [],
    ...(request.taskState ? { taskState: request.taskState } : {}),
  };
  const batchTokens = request.records.reduce((sum, record) => sum + record.tokenCount, 0);
  if (batchTokens > CONFIG.wm.batchTokens) throw new Error(`WorkerReplay: ${request.id} is larger than the flush's WM batch`);
  const turns = { turns: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, refused: {}, capStops: 0 };
  let batch = request.records;
  let output;
  let failed;
  try {
    // The flush (plan 218 Task 6): a call that stopped on its output limit before any verdict retries once on the older half.
    for (let attempt = 0; ; attempt += 1) {
      const { client, stats } = instrumentClient(makeClient(request, "wm"));
      const salience = salienceSignals(batch, request.entries);
      output = await runWm({
        client,
        records: batch,
        ledger,
        salience,
        protections: protectedRecords(ledger, batch, { salience }),
        targetRatio: CONFIG.wm.targetRatio,
        ...(request.scope ? { scope: request.scope } : {}),
        ...(request.taskState ? { taskState: request.taskState } : {}),
        ...LIMITS,
        thinkingLevel: CONFIG.wm.thinkingLevel,
        sessionId,
      });
      turns.turns += stats.turns;
      for (const key of Object.keys(turns.usage)) turns.usage[key] += stats.usage[key];
      for (const [reason, n] of Object.entries(refusedReasons(stats.messages))) turns.refused[reason] = (turns.refused[reason] ?? 0) + n;
      if (output.endedAtOutputCap) turns.capStops += 1;
      if (attempt > 0 || !output.endedAtOutputCap || output.verdicts.size > 0 || batch.length < 2) break;
      batch = batch.slice(0, Math.ceil(batch.length / 2));
    }
  } catch (error) {
    failed = failure(error);
    output = undefined;
  }
  const row = scoreWmRequest({ request, annotation, output, run: { ...turns, failed } });
  return { ...row, capStop: turns.capStops };
}

// ---------------------------------------------------------------------------------------------------------------------
// The scripted worker (offline). Mechanical rules over the request, with planned faults so refused counts are exercised.

const textOf = (content) => (content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
const resultText = (entry) => {
  const block = entry.message?.content?.find((part) => part.type === "tool_result");
  return typeof block?.result === "string" ? block.result : "";
};
const isFailLine = (line) => /Error|失敗|ব্যর্থ|fallaron/.test(line);

/** The scripted STM recorder: one event per user turn, per check, per batch of reads and per closing reply. */
export function scriptedStmCalls(request, faultIndex, tools = []) {
  // Plan 218.2 Task 2: with the fields offered, a check result carries its status and the closing outcome carries the
  // last check's status and resolves the recent errors when that check passed. `corrects` and `durable` stay unset: a
  // mechanical recorder cannot read them in every language.
  const fields = new Set(Object.keys(tools.find((tool) => tool.name === "record_event")?.parameters?.properties ?? {}));
  let lastCheck;
  const calls = [];
  const entries = request.entries;
  const reads = [];
  entries.forEach((entry, index) => {
    const role = entry.message?.role;
    if (role === "user")
      calls.push({
        kind: index === 0 ? "request" : "statement",
        description: textOf(entry.message.content).slice(0, 200),
        sourceEntryIds: [entry.id],
      });
    if (role !== "tool") return;
    const name = entry.message.content[0].name;
    if (name === "read_file") reads.push(entry.id);
    if (name === "run_tests" || name === "run_check") {
      const output = resultText(entry);
      const failLine = output.split("\n").find(isFailLine);
      lastCheck = failLine ? "failed" : "passed";
      calls.push({
        kind: failLine ? "error" : "result",
        ...(fields.has("status") && !failLine ? { status: "passed" } : {}),
        description: `${name}: ${output
          .split("\n")
          .filter((line) => /pass|fail|\d/.test(line))
          .slice(-3)
          .join("; ")}`.slice(0, 200),
        sourceEntryIds: [entry.id],
        ...(failLine ? { chunks: [{ sourceEntryId: entry.id, text: failLine.trim() }] } : {}),
      });
    }
  });
  if (reads.length) calls.push({ kind: "result", description: `Read ${reads.length} files.`, sourceEntryIds: reads });
  const last = entries.findLast((entry) => entry.message?.role === "assistant" && entry.message.content[0]?.type === "text");
  if (last) {
    const status = lastCheck ?? "unknown";
    const resolves =
      fields.has("resolves") && status === "passed"
        ? (request.recent ?? []).filter((record) => record.kind === "error").map((record) => record.id)
        : [];
    calls.push({
      kind: "outcome",
      description: textOf(last.message.content).slice(0, 200),
      sourceEntryIds: [last.id],
      ...(fields.has("status") ? { status } : {}),
      ...(resolves.length ? { resolves } : {}),
    });
  }
  // A planned fault every fifth request: a call citing no entry of the batch (refused `no_valid_ids`).
  if (faultIndex % 5 === 0) calls.push({ kind: "result", description: "Unsupported claim.", sourceEntryIds: ["missing"] });
  return calls;
}

/**
 * The scripted WM (plan 218.2 Task 5: one `judge` call over ordinals): protected and non-low records kept, low results
 * and actions discarded, medium results summarised. Records the package settled first are not offered.
 */
export function scriptedJudgeCalls(request, prompt) {
  const offeredSection = prompt.split("## New STM records")[1]?.split("\n## ")[0] ?? "";
  const offered = [...offeredSection.matchAll(/^- \[r(\d+)\]([^\n]*)/gm)].map((match) => ({
    r: Number(match[1]),
    record: request.records[Number(match[1]) - 1],
    protected: / protected: \w+/.test(match[2]),
  }));
  const keep = [];
  const discard = { finished: [] };
  const summarise = [];
  // A planned fault: discard the first protected record before keeping it (refused `protected`).
  const firstProtected = offered.find((entry) => entry.protected);
  if (firstProtected) discard.finished.push(firstProtected.r);
  for (const { r, record, protected: isProtected } of offered) {
    if (isProtected || (record.relevance !== "low" && !["result", "action"].includes(record.kind)))
      keep.push({ r, reason: "later work reads it", ...(record.kind === "outcome" ? { neededLater: "step 3" } : {}) });
    else if (record.relevance === "low") discard.finished.push(r);
    else summarise.push({ r, record });
  }
  const summaries = summarise.length
    ? [
        {
          of: summarise.map((entry) => entry.r),
          text: summarise
            .map((entry) => entry.record.description)
            .join(" ")
            .slice(0, 600),
          relevance: "medium",
        },
      ]
    : [];
  return [{ name: "judge", args: { keep, discard, summaries } }];
}

/**
 * A scripted provider: the first turn plans every call and sends them all; each later turn re-sends the calls the
 * per-turn limit refused (the loop runs the first `maxToolCallsPerTurn` of a turn), as the refusal text asks. A turn
 * with none left answers with no call. Usage is a 4-chars estimate.
 */
function scriptedProvider(callsFor) {
  let queue;
  return {
    id: "scripted",
    async *generate(request) {
      const prompt = textOf(request.messages.find((message) => message.role === "user")?.content);
      queue ??= callsFor(prompt, request.tools);
      const calls = queue;
      queue = queue.slice(LIMITS.maxToolCallsPerTurn);
      let output = 0;
      for (const [index, call] of calls.entries()) {
        const name = call.name ?? "record_event";
        const args = call.args ?? call;
        output += tokens(args);
        yield providerToolCall(toolCallContent(`s${index}`, name, args));
      }
      yield { type: "usage", usage: { inputTokens: tokens(request.messages), outputTokens: output, cacheReadTokens: 0 } };
      yield providerDone();
    },
  };
}

const SCRIPTED_MODEL = { provider: "scripted", model: "worker", limits: { contextWindow: 200_000, maxOutputTokens: 8_192 } };

export function scriptedClients() {
  let stmIndex = 0;
  return (request, tier) => {
    const index = tier === "stm" ? stmIndex++ : 0;
    const provider = scriptedProvider((prompt, tools) =>
      tier === "stm" ? scriptedStmCalls(request, index, tools) : scriptedJudgeCalls(request, prompt),
    );
    return { model: SCRIPTED_MODEL, generate: (call) => provider.generate({ ...call, model: SCRIPTED_MODEL }) };
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The run.

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

/**
 * Replay the fixture through each model. `models` are `{ ref, makeClient, inputTokensNow? }`; `inputTokensNow` returns the
 * model's spent input tokens (the wire log, live) for the ceiling. `checkpoint` resumes a request already scored; a failed
 * request is never checkpointed, so `--resume` runs it again. `recover` (live) waits out a network outage after a failed
 * request and returns whether it had to wait: the request then runs again. Only failures with the network up count
 * toward `maxAttempts`, so an outage of any length costs no request; latency is the last attempt's.
 */
export async function runReplay({
  fixture,
  models,
  only,
  limit,
  maxInputTokensPerModel,
  checkpoint,
  recover,
  maxAttempts = 3,
  set,
  log = () => {},
  now = () => Date.now(),
}) {
  const stmRequests = only === "wm" ? [] : fixture.stm.requests.slice(0, limit || undefined);
  // `set` (plan 218.2 Task 6) replays one WM set alone, e.g. `long-scope`.
  const wmRequests =
    only === "stm" ? [] : fixture.wm.requests.filter((request) => !set || request.set === set).slice(0, limit || undefined);
  const results = {};
  await Promise.all(
    models.map(async ({ ref, makeClient, inputTokensNow }) => {
      const rows = { stm: [], wm: [] };
      const latency = [];
      let ceilingHit = false;
      const slug = ref.replace(/[^A-Za-z0-9_.-]/g, "_");
      for (const [tier, requests, replay] of [
        ["stm", stmRequests, replayStm],
        ["wm", wmRequests, replayWm],
      ]) {
        for (const request of requests) {
          const saved = await checkpoint?.load(slug, request.id);
          if (saved) {
            rows[tier].push(saved.row);
            latency.push(saved.ms);
            continue;
          }
          let row;
          let ms;
          for (let attempts = 0; ; ) {
            if (maxInputTokensPerModel && (await inputTokensNow?.()) >= maxInputTokensPerModel) {
              ceilingHit = true;
              break;
            }
            const started = now();
            row = await replay({
              request,
              annotation: fixture.annotations[tier][request.id],
              makeClient,
              sessionId: `memory.session:wr-${slug}-${request.id}`,
            });
            ms = now() - started;
            if (!row.failed || !recover) break;
            log(`${ref} ${request.id}: failed ${row.failed.name}, checking the network`);
            if (!(await recover())) attempts += 1;
            if (attempts >= maxAttempts) break;
          }
          if (ceilingHit) break;
          rows[tier].push(row);
          latency.push(ms);
          if (!row.failed) await checkpoint?.save(slug, request.id, { row, ms });
          log(
            `${ref} ${request.id}: ${row.failed ? `failed ${row.failed.name}` : "ok"} in=${row.inputTokens} out=${row.outputTokens} ${ms}ms`,
          );
        }
        if (ceilingHit) break;
      }
      results[ref] = { rows, latency, ceilingHit };
    }),
  );
  return results;
}

/** The evidence report: per model, the aggregates, usage, latency and the per-request rows (ids and counts only). */
export function replayReport({ results, fixture, label, productHash, gate, startedAt, finishedAt, wire, only, set }) {
  const models = {};
  for (const [ref, { rows, latency, ceilingHit }] of Object.entries(results)) {
    const all = [...rows.stm, ...rows.wm];
    const input = wire?.[ref]?.inputTokens ?? all.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
    models[ref] = {
      stm: stmGroups(rows.stm),
      wm: wmGroups(rows.wm),
      usage: {
        basis: wire ? "wire proxy usage log (every attempt)" : "provider stream usage",
        inputTokens: input,
        outputTokens: wire?.[ref]?.outputTokens ?? all.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
        cacheReadTokens: wire?.[ref]?.cacheReadTokens ?? all.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0),
        requests: all.length,
        failedRequests: all.filter((row) => row.failed).length,
      },
      latencyMs: { p50: percentile(latency, 50), p95: percentile(latency, 95) },
      costEstimateUsd: Math.round(input * ALL_IN_USD_PER_M_INPUT) / 1_000_000,
      ceilingHit,
      requests: rows,
    };
  }
  return {
    kind: REPLAY_REPORT_KIND,
    plan: "218.2",
    task: 1,
    label,
    // A one-tier run (plan 218.2 Task 2 reads the STM tier alone); absent on a full run.
    ...(only ? { only } : {}),
    ...(set ? { set } : {}),
    startedAt,
    finishedAt,
    fixture: { id: REPLAY_FIXTURE_ID, indexSha256: fixture.indexSha256, counts: fixture.index.counts },
    productHash,
    rulesHash: rulesHash(),
    ...(gate
      ? { gate: { path: REPLAY_GATE, rulesHash: gate.rulesHash, models: gate.models, maxOutputTokens: gate.maxOutputTokens } }
      : { offline: true }),
    costBasis: `input tokens x $${ALL_IN_USD_PER_M_INPUT} per 1M (the plan's all-in Muse rate, applied to every model; OpenCode Go bills a subscription)`,
    models,
  };
}

/** The offline report's exact counts (the scripted worker): a scorer or product change that moves them fails CI. */
export function offlineSummary(report) {
  const m = report.models[OFFLINE_MODEL];
  const s = m.stm.all;
  const w = m.wm.all;
  return {
    stm: {
      events: s.events,
      refused: s.refused,
      outcomesFound: s.outcomes.found,
      correction: [s.correction.annotated, s.correction.pattern.found, s.correction.pattern.tp, s.correction.pattern.fp],
      failure: [s.failure.annotated, s.failure.pattern.found, s.failure.pattern.tp, s.failure.pattern.fp],
      nonEnglishFailure: [m.stm["non-english"].failure.pattern.found, m.stm["non-english"].failure.pattern.fp],
      durable: [s.durable.annotated, s.durable.recorded],
      resolves: s.resolves.annotated,
      evidence: [s.evidence.annotated, s.evidence.covered],
      chunks: s.chunks,
      fieldsRead: s.correction.field !== null,
      // Plan 218.2 Task 2: the field readings, [found, tp, fp] each.
      fields:
        s.correction.field === null
          ? null
          : Object.fromEntries(
              ["correction", "failure", "durable", "resolves"].map((key) => [key, [s[key].field.found, s[key].field.tp, s[key].field.fp]]),
            ),
    },
    wm: {
      records: w.records,
      verdicts: w.verdicts,
      keep: w.keep,
      summarize: w.summarize,
      discard: w.discard,
      refused: w.refused,
      turns: w.turns,
      capStops: w.capStops,
      laterStep: [w.laterStep.annotated, w.laterStep.kept, w.laterStep.discarded],
      changedValues: [w.changedValues.annotated, w.changedValues.kept],
      durable: [w.durableAnnotated, w.durableDiscarded],
      finished: [w.finished.annotated, w.finished.discarded],
    },
  };
}

export const OFFLINE_EXPECTED = Object.freeze({
  stm: {
    events: 366,
    refused: { no_valid_ids: 12 },
    outcomesFound: 66,
    correction: [30, 12, 12, 6],
    failure: [30, 30, 30, 18],
    nonEnglishFailure: [18, 0],
    durable: [36, 36],
    resolves: 36,
    evidence: [42, 30],
    chunks: 30,
    fieldsRead: true,
    fields: { correction: [0, 0, 0], failure: [30, 30, 18], durable: [0, 0, 0], resolves: [6, 6, 12] },
  },
  wm: {
    records: 3504,
    verdicts: 3504,
    keep: 1224,
    summarize: 168,
    discard: 2112,
    // Plan 218.2 Task 5: one `judge` call per request; the protected records are settled by code, so the planned
    // protected discard finds no offered protected record (the refusal is covered by the unit tests).
    refused: {},
    turns: 48,
    capStops: 0,
    laterStep: [96, 96, 0],
    changedValues: [48, 48],
    durable: [48, 0],
    finished: [2112, 2112],
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// The gate record.

/** The gate record must carry the owner's approval of these models, ceiling and exactly these rules. */
export function assertReplayGate(gate, { fixture, rules = REPLAY_RULES, criteriaHash = frozenMemoryModelHash() } = {}) {
  if (gate?.gate !== "replay" || gate.plan !== "218.2") throw new Error("ReplayGate: not the plan 218.2 replay gate record");
  if (gate.approved !== true || gate.approvedBy !== "owner" || typeof gate.text !== "string" || !gate.text.trim())
    throw new Error("ReplayGate: the replay is not approved on the owner's word");
  if (gate.rulesHash !== rulesHash(rules) || JSON.stringify(gate.rules) !== JSON.stringify(rules))
    throw new Error("ReplayGate: the decision rules differ from the recorded ones");
  if (
    !Array.isArray(gate.models) ||
    !gate.models.length ||
    gate.models.some((ref) => typeof ref !== "string" || ref.startsWith("openrouter/") || ref.includes(":free"))
  )
    throw new Error("ReplayGate: the gate names no models, or a free route");
  if (!Number.isSafeInteger(gate.caps?.maxInputTokensPerModel) || gate.caps.maxInputTokensPerModel <= 0)
    throw new Error("ReplayGate: the gate names no input-token ceiling");
  if (gate.memoryModelCriteriaHash !== criteriaHash && !onlyFixtureAmendmentsSince(gate.memoryModelCriteriaHash))
    throw new Error("ReplayGate: the criteria hash differs from the frozen one");
  if (fixture && gate.fixture?.hash !== fixture.indexSha256) throw new Error("ReplayGate: the fixture differs from the approved one");
  return gate;
}

/**
 * Plan 218.2 Task 8: the gate keeps the criteria hash it was approved under when every later amendment changes no row
 * (none is an owner decision; amendment 9 only adds the long-horizon fixture's hash). An owner decision since refuses.
 */
export function onlyFixtureAmendmentsSince(pinned, amendments = MEMORY_MODEL_CRITERIA.amendments ?? []) {
  const from = amendments.findIndex((amendment) => amendment.previousHash === pinned);
  return from >= 0 && amendments.slice(from).every((amendment) => amendment.kind !== "owner-decision");
}

/** A rule changed after the baseline is refused: the baseline's rules hash must equal the gate's and the code's. */
export function assertRulesUnchanged(gate, baseline) {
  if (!baseline) return;
  if (baseline.rulesHash !== gate.rulesHash || baseline.rulesHash !== rulesHash())
    throw new Error("ReplayGate: a decision rule changed after the baseline; the baseline's rules hash is the one the plan reads");
}

/**
 * Waits until `probe` answers (any HTTP response counts as online), polling every `pollMs` for at most `maxWaitMs`.
 * Returns whether it had to wait: false means the network was up, so the failure was the request's own.
 */
export async function waitForNetwork({ probe, sleep = (ms) => delay(ms), pollMs = 30_000, maxWaitMs = 12 * 3_600_000, log = () => {} }) {
  let waited = 0;
  for (;;) {
    if (await probe()) {
      if (waited > 0) log(`network back after ${Math.round(waited / 1000)}s`);
      return waited > 0;
    }
    if (waited >= maxWaitMs) return false;
    if (waited === 0) log("network down: waiting");
    await sleep(pollMs);
    waited += pollMs;
  }
}

const reachable = (url) => async () => {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// CLI.

async function liveModels(gate, wireDir) {
  const { liveProviders, loadEnv, refOf, PROVIDERS } = await import("../run.mjs");
  loadEnv();
  const refs = gate.models.map(refOf);
  const live = await liveProviders(refs, wireDir, { maxOutputTokens: gate.maxOutputTokens });
  const providerIds = [...new Set(refs.map((ref) => ref.provider))];
  const readWire = async () => {
    const byModel = {};
    for (const { proxy, usageLog } of live.proxies) {
      await proxy.drain();
      if (!existsSync(usageLog)) continue;
      for (const line of (await readFile(usageLog, "utf8")).split("\n").filter(Boolean)) {
        const row = JSON.parse(line);
        const totals = (byModel[row.model] ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
        totals.inputTokens += row.inputTokens ?? 0;
        totals.outputTokens += row.outputTokens ?? 0;
        totals.cacheReadTokens += row.cacheReadTokens ?? 0;
      }
    }
    return byModel;
  };
  const models = gate.models.map((name, index) => {
    const ref = refs[index];
    const provider = live.providers[providerIds.indexOf(ref.provider)];
    const model = live.models.get(name);
    const base = { model, resolve: async () => model, generate: (request) => provider.generate({ ...request, model }) };
    return { ref: name, makeClient: () => base, inputTokensNow: async () => (await readWire())[ref.model]?.inputTokens ?? 0 };
  });
  const probes = providerIds.map((id) => reachable(new URL(PROVIDERS[id].url).origin));
  const probe = async () => (await Promise.all(probes.map((check) => check()))).every(Boolean);
  return { models, live, readWire, refs, probe };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const fixture = loadWorkerReplayFixture(WORKER_REPLAY_DIR);
  fixture.annotations = { stm: fixture.annotations.stm, wm: fixture.annotations.wm };
  const startedAt = new Date().toISOString();
  const productHash = await m2ProductFingerprint(".");
  const out = flag("--out");
  const only = flag("--only");
  const limit = Number(flag("--limit") ?? 0);
  const set = flag("--set");
  if (args.includes("--offline")) {
    const results = await runReplay({ fixture, models: [{ ref: OFFLINE_MODEL, makeClient: scriptedClients() }], only, limit, set });
    const report = replayReport({
      results,
      fixture,
      label: "offline",
      productHash,
      startedAt,
      finishedAt: new Date().toISOString(),
      only,
      set,
    });
    const summary = offlineSummary(report);
    if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!only && !limit && !set && OFFLINE_EXPECTED && digest(summary) !== digest(OFFLINE_EXPECTED)) {
      console.error("WorkerReplay: the offline counts differ from OFFLINE_EXPECTED");
      process.exit(1);
    }
  } else if (flag("--pair")) {
    // Plan 218.2 Task 9: pair a finished after-replay with the baseline and write the paired reading into it.
    const file = flag("--pair");
    const report = JSON.parse(readFileSync(file, "utf8"));
    report.paired = pairReplays(report, JSON.parse(readFileSync(REPLAY_BASELINE, "utf8")));
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report.paired.productHash)}\n`);
  } else {
    const gatePath = flag("--gate") ?? REPLAY_GATE;
    const gate = assertReplayGate(JSON.parse(readFileSync(gatePath, "utf8")), { fixture });
    assertMemoryModelFixture(REPLAY_FIXTURE_ID);
    const label = flag("--label") ?? "baseline";
    const baseline = existsSync(REPLAY_BASELINE) ? JSON.parse(readFileSync(REPLAY_BASELINE, "utf8")) : null;
    assertRulesUnchanged(gate, baseline);
    if (label === "baseline" && baseline && !args.includes("--resume")) throw new Error("WorkerReplay: the baseline is already recorded");
    if (!out) throw new Error("WorkerReplay: a live run needs --out");
    const key = stableHash({
      label,
      productHash,
      fixture: fixture.indexSha256,
      rules: gate.rulesHash,
      models: gate.models,
      ...(set ? { set } : {}),
    }).slice(0, 16);
    // `--state-key` resumes a named run's checkpoints and wire log, whatever the product fingerprint is now (plan 218.2
    // Task 6: kernel edits elsewhere in the tree moved the fingerprint mid-run). The report records the key it read.
    const stateKey = flag("--state-key");
    if (stateKey && !/^[0-9a-f]{16}$/.test(stateKey)) throw new Error("WorkerReplay: --state-key is 16 hex characters");
    const state = join(STATE_ROOT, stateKey ?? key);
    await mkdir(join(state, "rows"), { recursive: true, mode: 0o700 });
    const checkpoint = {
      async load(slug, id) {
        const file = join(state, "rows", `${slug}--${id}.json`);
        return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null;
      },
      save: (slug, id, value) => writeFile(join(state, "rows", `${slug}--${id}.json`), JSON.stringify(value)),
    };
    const { models, live, readWire, refs, probe } = await liveModels(gate, join(state, "wire"));
    try {
      const results = await runReplay({
        fixture,
        models,
        only,
        limit,
        maxInputTokensPerModel: gate.caps.maxInputTokensPerModel,
        checkpoint,
        set,
        recover: () => waitForNetwork({ probe, log: (line) => process.stderr.write(`${line}\n`) }),
        log: (line) => process.stderr.write(`${line}\n`),
      });
      const byModel = await readWire();
      const wire = Object.fromEntries(
        gate.models.map((name, index) => [name, byModel[refs[index].model] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }]),
      );
      const report = replayReport({
        results,
        fixture,
        label,
        productHash,
        gate,
        startedAt,
        finishedAt: new Date().toISOString(),
        wire,
        only,
        set,
      });
      if (stateKey) report.stateKey = { resumed: stateKey, current: key };
      if (label === "after" && baseline) report.paired = pairReplays(report, baseline);
      // A one-tier run writes its report too (plan 218.2 Task 2); a `--limit` smoke never does.
      if (!limit) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
      if (label === "task2" && baseline) process.stderr.write(`${JSON.stringify(decideTask2(report, baseline), null, 2)}\n`);
      if (label === "task4" && baseline) process.stderr.write(`${JSON.stringify(decideTask4(report, baseline), null, 2)}\n`);
      const brief = Object.fromEntries(
        Object.entries(report.models).map(([ref, m]) => [
          ref,
          {
            usage: m.usage,
            latencyMs: m.latencyMs,
            ceilingHit: m.ceilingHit,
            stm: aggregateStm(m.requests.stm).events,
            wmVerdictShare: m.wm.all.verdictShare,
          },
        ]),
      );
      process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
    } finally {
      for (const { proxy } of live.proxies) proxy.stop();
    }
  }
}
