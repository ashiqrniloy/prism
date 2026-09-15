#!/usr/bin/env node
/**
 * Attention-compiler scenario (plan 074, Further Actions P1): *measure before extending*.
 *
 * Builds a synthetic but realistic multi-turn session (assistant turns with tool calls, 8 KB
 * tool results, an optional volatile context provider) and assembles every turn through
 * `assembleProviderInput` in two modes:
 *   - compiler off: today's requests, append-only prefix
 *   - compiler on: the ratio gate, sticky thinking strip, deterministic tool stubs
 *
 * Reports the four numbers the plan asks for:
 *   1. tokens saved by the stub stages (per turn and total) and what they cost the cache,
 *   2. prompt-cache prefix behaviour (busts = turns whose stable prefix shrank),
 *   3. the re-stub churn a restored sticky frontier avoids after a process restart,
 *   4. the truncated-turn → compaction decision (plan 074 P4) on the same fixture.
 *
 * Network-free and credential-free by construction; exits 1 on envelope breach.
 */
import { cpus, totalmem } from "node:os";
import {
  assembleProviderInput,
  createAttentionTruncationTrigger,
  estimateAssemblyTokens,
  estimateTextTokens,
  resolveInputCap,
  resolveShouldCompact,
} from "../../dist/index.js";

const TURNS = 8;
const PAYLOAD_BYTES = 8_192;
const INPUT_CAP = 6_000;
const TRIGGER_RATIO = 0.5;
const VOLATILE_BLOCK_BYTES = 1_024;
const MIN_TOKEN_REDUCTION = 0.3;
const MAX_ON_BUSTS = 2;
const MIN_CHURN_AVOIDED_BYTES = 4_000;

const WARM_TURNS = 3;
const WARM_PAYLOAD_BYTES = 256;
/** Warm turns stay under the gate (small rows); later turns carry the big rows that trip it. */
const defaultPayloadFor = (turn) => (turn <= WARM_TURNS ? WARM_PAYLOAD_BYTES : PAYLOAD_BYTES);
const payloadFor = (turn, bytesFor) => `payload ${"p".repeat((bytesFor ?? defaultPayloadFor)(turn))}`;
const echoTool = { name: "echo", description: "Return the payload back.", parameters: { type: "object", properties: {} } };

/** Longest common prefix length, in UTF-16 units, of two serialized requests. */
function commonPrefix(a, b) {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function toolCallMessage(turn) {
  return {
    role: "assistant",
    content: [
      { type: "text", text: `turn ${turn}` },
      { type: "tool_call", toolCallId: `tc-${turn}`, name: "echo", arguments: {} },
    ],
  };
}

function toolResultMessage(turn, value) {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: `tc-${turn}`, name: "echo", result: value }],
    metadata: { turn },
  };
}

/** History through turn `turn - 1` plus turn `turn`'s in-flight result, as the assembler sees it. */
function fixtureFor(turn, bytesFor) {
  const history = [{ role: "user", content: [{ type: "text", text: "keep going" }] }];
  for (let index = 1; index < turn; index += 1) {
    history.push(toolCallMessage(index), toolResultMessage(index, payloadFor(index, bytesFor)));
  }
  return { history, toolResults: [toolResultMessage(turn, payloadFor(turn, bytesFor))] };
}

function requestTokens(request) {
  return estimateAssemblyTokens(request.messages) + estimateTextTokens(JSON.stringify(request.tools ?? []));
}

/** One fixture run: assemble every turn in one mode and collect its per-turn numbers. */
async function runMode({ mode, volatileProvider, pinnedProvider, frontier, triggerRatio = TRIGGER_RATIO, inputCap = INPUT_CAP, bytesFor }) {
  const rows = [];
  let previous;
  let busts = 0;
  let previousHit = 0;
  let uncachedTail = 0;
  for (let turn = 1; turn <= TURNS; turn += 1) {
    const { history, toolResults } = fixtureFor(turn, bytesFor);
    const reports = [];
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "keep going",
      history,
      toolResults,
      tools: [echoTool],
      ...(volatileProvider ? { contextProviders: [pinnedProvider ? pinnedProvider(turn, volatileProvider) : volatileProvider(turn)] } : {}),
      ...(mode === "on"
        ? {
            attentionCompiler: {
              maxInputTokens: inputCap,
              triggerRatio,
              compactRatio: Math.min(0.995, triggerRatio + 0.005),
              keepLast: 0,
            },
          }
        : {}),
      ...(mode === "on" && frontier ? { attentionSticky: frontier } : {}),
      onAttentionReport: (report) => reports.push(report),
    });
    const serialized = JSON.stringify({ messages: request.messages, tools: request.tools ?? [], context: request.context ?? [] });
    const serializeBytes = Buffer.byteLength(serialized, "utf8");
    const hit = previous === undefined ? 0 : commonPrefix(previous, serialized);
    if (previous !== undefined && previousHit > 0 && hit < previousHit) busts += 1;
    previous = serialized;
    previousHit = hit;
    uncachedTail += serializeBytes - hit;
    rows.push({
      turn,
      tokens: requestTokens(request),
      bytes: serializeBytes,
      prefixHitBytes: hit,
      mutated: reports.length > 0,
      stubbed: reports.reduce((sum, report) => sum + report.stubbedToolResults, 0),
      stubbedBytes: reports.reduce((sum, report) => sum + report.stubbedBytes, 0),
      usedAfter: reports.at(-1)?.usedAfter,
      truncated: reports.some((report) => report.truncated),
    });
  }
  return { rows, busts, uncachedTail };
}

async function runScenario() {
  const off = await runMode({ mode: "off" });
  const on = await runMode({ mode: "on", frontier: { thinking: new Set(), toolCallIds: new Set() } });
  // Volatility is measured on small append-only turns, so the uncached tail is the block plus
  // everything behind it, not the new turn's own payload.
  const smallTurns = () => WARM_PAYLOAD_BYTES;
  const volatileOff = await runMode({
    mode: "off",
    bytesFor: smallTurns,
    volatileProvider: (turn) => ({
      name: "volatile-om",
      resolve: () => [{ id: "om", content: `turn ${turn} ${"v".repeat(VOLATILE_BLOCK_BYTES)}` }],
    }),
  });
  const pinned = new Map();
  const volatilePinned = await runMode({
    mode: "off",
    bytesFor: smallTurns,
    volatileProvider: (turn) => ({
      name: "volatile-om",
      resolve: () => [{ id: "om", content: `turn ${turn} ${"v".repeat(VOLATILE_BLOCK_BYTES)}` }],
    }),
    // The documented host recipe: resolve once per session, return the same bytes afterwards.
    pinnedProvider: (turn, make) => ({
      name: "volatile-om-pinned",
      resolve: (context) => {
        const key = context?.sessionId ?? "session";
        if (!pinned.has(key)) pinned.set(key, make(turn).resolve());
        return pinned.get(key);
      },
    }),
  });

  // Restart churn: with the gate relaxed, only a restored frontier keeps the stub — measure the
  // payload bytes a resume would otherwise re-send (plan 074 P3).
  const resumeFrontier = { thinking: new Set(), toolCallIds: new Set() };
  await runMode({ mode: "on", frontier: resumeFrontier });
  const relaxed = { mode: "on", triggerRatio: 0.99, inputCap: 64_000 };
  const restored = (await runMode({ ...relaxed, frontier: resumeFrontier })).rows.at(-1);
  const cleared = (await runMode({ ...relaxed, frontier: { thinking: new Set(), toolCallIds: new Set() } })).rows.at(-1);

  // Truncated-turn follow-up (plan 074 P4): a fixture that cannot get back under the ratio
  // because every eligible row is excluded must drive the host's compact-once policy.
  const policy = createAttentionTruncationTrigger({ threshold: 1 });
  const excludedRun = await runMode({ mode: "on", frontier: { thinking: new Set(), toolCallIds: new Set() } });
  for (const row of excludedRun.rows) {
    if (row.mutated) policy.observe({ truncated: row.truncated });
  }
  const compactDecision = await resolveShouldCompact(
    { trigger: policy.trigger },
    {
      sessionId: "benchmark",
      entryCount: excludedRun.rows.length,
      estimateInputTokens: () => on.rows.at(-1)?.tokens ?? 0,
      resolveInputCapTokens: () => resolveInputCap(undefined, { limits: { contextWindow: INPUT_CAP } }),
    },
  );

  const tokensOff = off.rows.reduce((sum, row) => sum + row.tokens, 0);
  const tokensOn = on.rows.reduce((sum, row) => sum + row.tokens, 0);
  const tokenReduction = tokensOff === 0 ? 0 : 1 - tokensOn / tokensOff;
  const stubBytes = on.rows.reduce((sum, row) => sum + row.stubbedBytes, 0);
  const churnAvoided = (cleared?.bytes ?? 0) - (restored?.bytes ?? 0);

  const report = {
    version: "0.7.0",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryBytes: totalmem(),
      network: false,
      credentials: false,
    },
    fixture: {
      turns: TURNS,
      payloadBytes: PAYLOAD_BYTES,
      inputCap: INPUT_CAP,
      triggerRatio: TRIGGER_RATIO,
      volatileBlockBytes: VOLATILE_BLOCK_BYTES,
    },
    results: [
      { name: "input_tokens_off", value: tokensOff, unit: "tokens" },
      { name: "input_tokens_on", value: tokensOn, unit: "tokens" },
      { name: "token_reduction", value: Number(tokenReduction.toFixed(4)), unit: "ratio" },
      { name: "stub_bytes_total", value: stubBytes, unit: "bytes" },
      { name: "mutated_turns", value: on.rows.filter((row) => row.mutated).length, unit: "turns" },
      { name: "prefix_busts_off", value: off.busts, unit: "turns" },
      { name: "prefix_busts_on", value: on.busts, unit: "turns" },
      { name: "prefix_min_hit_bytes_on", value: Math.min(...on.rows.slice(1).map((row) => row.prefixHitBytes)), unit: "bytes" },
      { name: "uncached_tail_bytes_off", value: off.uncachedTail, unit: "bytes" },
      { name: "uncached_tail_bytes_on", value: on.uncachedTail, unit: "bytes" },
      { name: "volatile_uncached_tail_bytes", value: volatileOff.uncachedTail, unit: "bytes" },
      { name: "pinned_uncached_tail_bytes", value: volatilePinned.uncachedTail, unit: "bytes" },
      { name: "volatile_block_resend_bytes", value: volatileOff.uncachedTail - volatilePinned.uncachedTail, unit: "bytes" },
      { name: "resume_churn_avoided_bytes", value: Math.max(0, churnAvoided), unit: "bytes" },
      { name: "compact_decision_after_truncated_turns", value: compactDecision, unit: "boolean" },
    ],
    checks: [
      { name: "off_prefix_is_append_only", pass: off.busts === 0 },
      { name: "on_prefix_busts_bounded", pass: on.busts <= MAX_ON_BUSTS },
      { name: "token_reduction_ge_min", pass: tokenReduction >= MIN_TOKEN_REDUCTION },
      { name: "stub_bytes_positive", pass: stubBytes > 0 },
      // A volatile provider does not *rewrite* the prefix, it truncates it: the block sits before
      // the history, so every turn re-sends the block and everything behind it. Pinning (the
      // documented host recipe) keeps it — and everything behind it — cached.
      {
        name: "volatile_block_resent_every_turn",
        pass: volatileOff.uncachedTail - volatilePinned.uncachedTail >= VOLATILE_BLOCK_BYTES * (TURNS - 1),
      },
      { name: "pinning_shrinks_uncached_tail", pass: volatilePinned.uncachedTail < volatileOff.uncachedTail },
      { name: "resume_churn_avoided_ge_min", pass: churnAvoided >= MIN_CHURN_AVOIDED_BYTES },
      { name: "truncated_turns_drive_compact", pass: compactDecision === true },
    ],
  };
  return report;
}

if (process.argv[1] && new URL(import.meta.url).href.endsWith(process.argv[1].split("/").pop())) {
  const report = await runScenario();
  for (const check of report.checks) {
    if (!check.pass) console.error(`BUDGET FAIL: ${check.name}`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some((check) => !check.pass)) process.exitCode = 1;
}

export { runScenario };
