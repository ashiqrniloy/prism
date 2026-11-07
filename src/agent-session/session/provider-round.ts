/** Provider-round phase of runInternal (plan 059). */

import { cacheUsageReport } from "../../provider-kit/cache-helpers.js";
import { estimateMessageTokens, estimateRequestExtrasTokens, resolveInputCap } from "../../models/estimate.js";
import type {
  ContentBlock,
  CostCatalog,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  ProviderStopReason,
  ProviderTurnMetadata,
  ProviderTurnResult,
  ResolvedRunOptions,
  ToolCallContent,
  ToolResult,
  TurnBudgets,
  Usage,
  UsageRecord,
} from "../../contracts.js";
import { createProviderTurnMetadata, readProviderHttpStatus } from "../../observability.js";
import { ContextOverflowError, contextOverflowMessage, ProviderOverflowRecovery } from "../context-overflow.js";
import { normalizeStopReason, providerError, providerToolCallDeltaContent } from "../../models/events.js";
import { errorToErrorInfo, redactRunLedgerRecord, redactSecrets } from "../../redaction.js";
import { mergeRetry, retryLoop } from "../../models/retry.js";
import { estimateTextTokensForFamily } from "../../usage-estimation.js";
import {
  bridgeAbort,
  isSteerSoftInterrupt,
  jsonBytes,
  ProviderTurnFailure,
  providerContent,
  randomId,
  reconstructMissingToolCalls,
  SteerSoftInterrupt,
  throwIfAborted,
} from "../helpers.js";
import type { RoundContext, SessionHost } from "./types.js";

function pushCoalescedContent(content: ContentBlock[], block: ContentBlock): void {
  const last = content.at(-1);
  if (last?.type === "text" && block.type === "text") {
    content[content.length - 1] = { type: "text", text: last.text + block.text };
    return;
  }
  if (last?.type === "thinking" && block.type === "thinking" && !last.redacted && !block.redacted) {
    content[content.length - 1] = {
      type: "thinking",
      text: last.text + block.text,
      ...((block.signature ?? last.signature) ? { signature: block.signature ?? last.signature } : {}),
    };
    return;
  }
  content.push(block);
}

/** Resolve the per-request input cap for turn-budget metadata (plan 087 T1). A model without a
 *  derivable cap omits the field instead of failing an emitting turn. */
export function resolveTurnInputCap(model: ModelConfig): number | undefined {
  try {
    return resolveInputCap({}, model);
  } catch {
    return undefined;
  }
}

/** Effective budget snapshot at turn end (plan 087 T1): O(1) from the run limit tracker. */
function turnBudgets(session: SessionHost, model: ModelConfig, usage: Usage | undefined): TurnBudgets | undefined {
  const tracker = session.activeLimits;
  if (!tracker) return undefined;
  const snapshot = tracker.snapshot();
  const inputCap = resolveTurnInputCap(model);
  const runInputBudget = tracker.limits.maxInputTokens;
  return {
    ...(usage?.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens, inputTokensSource: usage.estimated === true ? "estimated" : "reported" }),
    ...(inputCap === undefined ? {} : { inputCap }),
    ...(runInputBudget === null ? {} : { runInputBudget }),
    runInputUsed: snapshot.inputTokens,
    turns: snapshot.turns,
    maxTurns: tracker.limits.maxTurns,
  };
}

function cacheMetadata(usage: Usage | undefined) {
  const cache = cacheUsageReport(usage);
  return cache === undefined ? {} : { cache };
}

/** Native reason wins, except a generic `end_turn` on a turn that produced tool calls: protocols
 *  with one generic completion value (Google `STOP`) are tool-call turns by content (plan 087 T1). */
function normalizeTurnStopReason(native: ProviderStopReason | undefined, calls: readonly ToolCallContent[]): ProviderStopReason {
  if (native === undefined) return calls.length > 0 ? "tool_calls" : "end_turn";
  if (native === "end_turn" && calls.length > 0) return "tool_calls";
  return native;
}

/**
 * Plan 062: price usage through the host's {@link CostCatalog} when the provider
 * did not report a cost itself. Stale/unknown quotes, catalog failures, or
 * non-`per_million_tokens` units degrade to usage-only (cost untouched).
 */
async function withCatalogCost(catalog: CostCatalog | undefined, model: ModelConfig, usage: Usage, signal: AbortSignal): Promise<Usage> {
  if (!catalog || usage.cost !== undefined) return usage;
  try {
    const quote = await catalog.get(model.model, { signal });
    if (!quote || (quote.unit !== undefined && quote.unit !== "per_million_tokens")) return usage;
    const uncachedInput = Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0));
    const cost =
      (uncachedInput * (quote.input ?? 0) +
        (usage.cacheReadTokens ?? 0) * (quote.cacheRead ?? 0) +
        (usage.cacheWriteTokens ?? 0) * (quote.cacheWrite ?? 0) +
        (usage.outputTokens ?? 0) * (quote.output ?? 0)) /
      1_000_000;
    if (!Number.isFinite(cost) || cost <= 0) return usage;
    return { ...usage, cost, ...(quote.currency !== undefined ? { currency: quote.currency } : {}) };
  } catch {
    return usage; // catalog failure degrades to usage-only
  }
}

export async function recordProviderUsage(
  ctx: RoundContext,
  turnUsage: Usage | undefined,
  turn: number,
  attempt: number,
  request?: ProviderRequest,
): Promise<Usage | undefined> {
  const { session, limits, runUsage, runId } = ctx;
  const usage = turnUsage ?? estimateTurnUsage(session, ctx.model, request);
  // An estimate is never priced: a catalog quote on estimated tokens would invent billing.
  const effective =
    usage && usage.estimated !== true
      ? await withCatalogCost(session.agent.config.costCatalog, ctx.model, usage, ctx.controller.signal)
      : usage;
  limits.recordUsage(effective);
  if (!effective) return undefined;
  if (effective.inputTokens !== undefined) {
    session.activeInputMeter = { tokens: effective.inputTokens, source: effective.estimated === true ? "estimated" : "reported" };
  }
  runUsage.add(effective);
  if (!session.activeLedger) return effective;
  const usageRecord: UsageRecord = {
    id: randomId("usage"),
    sessionId: session.id,
    runId,
    scope: "provider_turn",
    turn,
    attempt,
    usage: effective,
    recordedAt: new Date().toISOString(),
    ...session.activeOwnership,
  };
  await session.activeLedger.appendUsage(redactRunLedgerRecord(usageRecord, session.activeRedactor));
  return effective;
}

/**
 * Plan 091 T2 missing-usage fallback: when the provider reported nothing and the agent did not
 * turn estimation off, label one estimate of the turn's own request — the plan-091 family
 * heuristic for messages plus the assembler's own text shapes for tools and context (no
 * `JSON.stringify` of the schemas, so no drift from what the assembler measured). The count is
 * always an estimate (`Usage.estimated`, never `"reported"`), and its confidence is the family
 * table's. Returns `undefined` when estimation is not the fallback (`"off"` / `"strict"`) or the
 * request is unavailable — absent stays absent.
 */
function estimateTurnUsage(session: SessionHost, model: ModelConfig, request: ProviderRequest | undefined): Usage | undefined {
  // Omitted is the documented default (`"fallback"`), not a reason to skip estimation.
  const mode = session.agent.config.usageEstimation ?? "fallback";
  if (!request || mode !== "fallback") return undefined;
  const estimate = estimateMessagesMemoized(request.messages, model.model);
  const extras = estimateRequestExtrasTokens(request.tools, request.context, (text) => estimateTextTokensForFamily(text, model.model));
  return { inputTokens: estimate.tokens + extras, estimated: true, confidence: estimate.confidence };
}

/**
 * Plan 210 Task 0.3: `estimateMessageTokens(messages, family)` with each message's share
 * (per-message overhead plus its text estimate, all integers) memoized by message object and
 * model, so a turn re-estimates only the messages it has not seen. The sum is the same value.
 */
const messageEstimateMemo = new Map<string, WeakMap<Message, number>>();

function estimateMessagesMemoized(messages: readonly Message[], family: string): ReturnType<typeof estimateMessageTokens> {
  const empty = estimateMessageTokens([], family);
  let memo = messageEstimateMemo.get(family);
  if (!memo) {
    memo = new WeakMap();
    messageEstimateMemo.set(family, memo);
  }
  let tokens = 0;
  for (const message of messages) {
    let share = memo.get(message);
    if (share === undefined) {
      share = estimateMessageTokens([message], family).tokens;
      memo.set(message, share);
    }
    tokens += share;
  }
  return { ...empty, tokens };
}

/**
 * Plan 103 T5: the refusal `usageEstimation: "strict"` gives a completed turn that reported no
 * usage. It rides the existing observable-failure path (one attempt, terminal `error` event) and
 * stamps no `failureClass` — a harness refusal is not a provider failure, so `name`/`code` are
 * what a host matches on. The info carries the turn number and mode only, never request content.
 */
function usageMissingFailure(turn: number): ProviderTurnFailure {
  return new ProviderTurnFailure(
    {
      name: "UsageMissingError",
      code: "usage_missing",
      message: `provider reported no usage on turn ${turn} and usageEstimation is "strict"`,
    },
    true,
  );
}

/** Statuses a provider may answer when the request is bigger than the model's window. */
const OVERFLOW_STATUSES = new Set([400, 413, 422]);

/**
 * Overflow evidence for one failed attempt: the route's body already classified it, or (for a route
 * whose body is not distinguishable, plan 194 Task 1) a 400/413/422 while our own estimate exceeds
 * the model's declared window. Estimates are advisory, exactly like usage estimates.
 */
function contextOverflowEvidence(
  request: ProviderRequest,
  info: import("../../contracts.js").ErrorInfo,
): { estimatedTokens: number; windowTokens?: number } | undefined {
  const estimate = () => {
    const tokens = estimateMessageTokens(request.messages, request.model.model);
    const extras = estimateRequestExtrasTokens(request.tools, request.context, (text) =>
      estimateTextTokensForFamily(text, request.model.model),
    );
    return tokens.tokens + extras;
  };
  const windowTokens = resolveTurnInputCap(request.model);
  if (info.failureClass === "context_overflow") return { estimatedTokens: estimate(), ...(windowTokens === undefined ? {} : { windowTokens }) };
  const status = readProviderHttpStatus(info);
  if (windowTokens === undefined || status === undefined || !OVERFLOW_STATUSES.has(status)) return undefined;
  const estimatedTokens = estimate();
  return estimatedTokens > windowTokens ? { estimatedTokens, windowTokens } : undefined;
}

export async function generateWithRetry(
  session: SessionHost,
  request: ProviderRequest,
  runId: string,
  options: ResolvedRunOptions,
  signal: AbortSignal,
  requestSecrets: readonly (string | undefined)[] = [],
  turn = 1,
  recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<Usage | undefined>,
  toolResults: readonly ToolResult[] = [],
): Promise<ProviderTurnResult> {
  const retry = mergeRetry(session.agent.config.retry, options.retry);
  const secrets = [...requestSecrets, ...(retry?.secrets ?? [])];
  return retryLoop((attempt) => generateProviderTurn(session, request, runId, signal, secrets, turn, attempt, recordUsage, toolResults), {
    retry,
    sessionId: session.id,
    runId,
    signal,
    passthrough: (error) => isSteerSoftInterrupt(error) || error instanceof ProviderOverflowRecovery || error instanceof ContextOverflowError,
    classify(error) {
      const failure = error instanceof ProviderTurnFailure ? error : undefined;
      return {
        info: failure ? redactSecrets(failure.info, secrets) : errorToErrorInfo(error, secrets),
        final: failure?.observable,
      };
    },
    // A retry re-opens the turn: `turn.started` again, with the attempt and the redacted cause.
    onRetry: (info, delayMs, attempt) =>
      session.emit({
        type: "turn.started",
        sessionId: session.id,
        runId,
        turn,
        attempt,
        metadata: createProviderTurnMetadata(request, session.activeProvider?.id ?? request.model.provider, { attempt }),
        retry: { delayMs, error: info },
      }),
  });
}

export async function generateProviderTurn(
  session: SessionHost,
  request: ProviderRequest,
  runId: string,
  signal: AbortSignal,
  secrets: readonly (string | undefined)[] = [],
  turn = 1,
  attempt = 1,
  recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<Usage | undefined>,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: the name is part of the published declaration surface (scripts/compat-baseline/arnilo__prism.txt).
  toolResults: readonly ToolResult[] = [],
): Promise<ProviderTurnResult> {
  session.activeLimits!.charge("maxProviderAttempts");
  session.activeLimits!.charge("maxRequestBytes", jsonBytes(request));
  const startedAt = performance.now();
  const providerId = session.activeProvider?.id ?? request.model.provider;
  const buildMetadata = (extra: Omit<ProviderTurnMetadata, "providerId" | "model"> = {}) =>
    createProviderTurnMetadata(request, providerId, { attempt, ...extra });
  session.emit({
    type: "turn.started",
    sessionId: session.id,
    runId,
    turn,
    metadata: buildMetadata(),
  });
  const content: ContentBlock[] = [];
  const calls: ToolCallContent[] = [];
  const toolDeltas: ProviderEvent[] = [];
  let messageId: string | undefined;
  let started = false;
  let usage: Usage | undefined;
  let nativeStopReason: ProviderStopReason | undefined;
  let usageRecorded = false;
  let effectiveUsage: Usage | undefined;
  const bufferedOutput: import("../../contracts.js").AgentEvent[] = [];
  const bufferOutput = Boolean(session.activeLimitOutputBuffer);
  const emitOutput = (event: import("../../contracts.js").AgentEvent) => {
    if (bufferOutput) bufferedOutput.push(event);
    else session.emit(event);
  };
  const recordTurnUsage = async (): Promise<Usage | undefined> => {
    if (usageRecorded) return effectiveUsage;
    usageRecorded = true;
    // The seam may return a labeled estimate (plan 091 T2); without a callback the reported value stands.
    effectiveUsage = (await recordUsage?.(usage, turn, attempt)) ?? usage;
    return effectiveUsage;
  };
  const turnAbort = new AbortController();
  const cleanupTurn = bridgeAbort(signal, turnAbort);
  session.activeProviderTurnAbort = turnAbort;
  if (session.pendingSoftInterrupt) {
    session.pendingSoftInterrupt = false;
    turnAbort.abort(new SteerSoftInterrupt());
  }
  const turnRequest = { ...request, signal: turnAbort.signal };
  try {
    throwIfAborted(turnAbort.signal);
    const provider = session.activeProvider!;
    const stream = await session.hooks().around("model.call", turnRequest, (request) => Promise.resolve(provider.generate(request)));
    for await (const event of stream) {
      throwIfAborted(turnAbort.signal);
      session.activeLimits!.charge("maxResponseBytes", jsonBytes(event));
      if (event.type === "error") throw new ProviderTurnFailure(event.error, started);
      if (event.type === "usage") usage = event.usage;
      if (event.type === "done") {
        usage = event.usage ?? usage;
        nativeStopReason = normalizeStopReason(event.stopReason);
        break;
      }
      if (event.type === "message_start") {
        started = true;
        messageId = event.messageId;
        continue;
      }
      if (event.type === "content_delta" || event.type === "tool_call" || event.type === "tool_call_delta") {
        if (!started) {
          started = true;
        }
        if (event.type === "tool_call_delta") {
          toolDeltas.push(event);
          emitOutput({ type: "message.delta", sessionId: session.id, runId, content: providerToolCallDeltaContent(event) });
          continue;
        }
        const block = providerContent(event);
        pushCoalescedContent(content, block);
        if (block.type === "tool_call") calls.push(block);
        emitOutput({ type: "message.delta", sessionId: session.id, runId, content: block });
      }
    }
    for (const call of reconstructMissingToolCalls(toolDeltas, calls)) {
      content.push(call);
      calls.push(call);
      emitOutput({ type: "message.delta", sessionId: session.id, runId, content: call });
    }
    // Plan 103 T5: strict refuses a completed turn that reported no usage *before* the usage seam
    // runs, so no estimate is projected, the cost catalog is not consulted, and the fail-closed
    // `recordUsage(undefined)` maxCost breach cannot preempt the refusal. Marking the seam
    // consulted keeps the catch below from re-entering it with the same missing usage.
    if (usage === undefined && session.agent.config.usageEstimation === "strict") {
      usageRecorded = true;
      throw usageMissingFailure(turn);
    }
    await recordTurnUsage();
    if (bufferOutput) for (const event of bufferedOutput) session.emit(event);
    const latencyMs = Math.round(performance.now() - startedAt);
    session.emit({
      type: "turn.completed",
      sessionId: session.id,
      runId,
      turn,
      metadata: buildMetadata({
        latencyMs,
        stopReason: normalizeTurnStopReason(nativeStopReason, calls),
        budgets: turnBudgets(session, request.model, effectiveUsage),
        ...cacheMetadata(effectiveUsage),
      }),
      usage: effectiveUsage,
    });
    return { content, calls, messageId, started, usage: effectiveUsage };
  } catch (error) {
    if (isSteerSoftInterrupt(error) || isSteerSoftInterrupt(turnAbort.signal.reason)) {
      await recordTurnUsage();
      const latencyMs = Math.round(performance.now() - startedAt);
      session.emit({
        type: "turn.completed",
        sessionId: session.id,
        runId,
        turn,
        metadata: buildMetadata({
          latencyMs,
          stopReason: "abort",
          budgets: turnBudgets(session, request.model, effectiveUsage),
          ...cacheMetadata(effectiveUsage),
        }),
        usage: effectiveUsage,
      });
      throw new SteerSoftInterrupt();
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const info = error instanceof ProviderTurnFailure ? redactSecrets(error.info, secrets) : providerError(error, secrets).error;
    const overflow = contextOverflowEvidence(request, info);
    // A rejected request was never processed: do not project (or bill) an estimate for it. The retry
    // records the call that actually ran; a provider that did report usage keeps it.
    if (overflow && usage === undefined) usageRecorded = true;
    await recordTurnUsage();
    session.emit({
      type: "turn.completed",
      sessionId: session.id,
      runId,
      turn,
      metadata: buildMetadata({
        latencyMs,
        httpStatus: readProviderHttpStatus(info),
        stopReason: signal.aborted || turnAbort.signal.aborted ? "abort" : "provider_error",
        budgets: turnBudgets(session, request.model, effectiveUsage),
        ...cacheMetadata(effectiveUsage),
      }),
      usage: effectiveUsage,
      error: info,
    });
    if (overflow) {
      const counts = { ...overflow, ...(started ? { started: true } : {}) };
      if (started) throw new ContextOverflowError(contextOverflowMessage(counts), counts, info);
      throw new ProviderOverflowRecovery(info, counts);
    }
    if (error instanceof ProviderTurnFailure) throw error;
    throw new ProviderTurnFailure(info, started);
  } finally {
    cleanupTurn();
    if (session.activeProviderTurnAbort === turnAbort) session.activeProviderTurnAbort = undefined;
  }
}
