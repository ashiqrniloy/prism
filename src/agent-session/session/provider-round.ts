/** Provider-round phase of runInternal (plan 059). */

import { resolveInputCap } from "../../attention-compiler.js";
import { cacheUsageReport } from "../../cache-helpers.js";
import { estimateMessageTokens } from "../../context-budget.js";
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
  RetryMiddlewarePayload,
  RunOptions,
  ToolCallContent,
  ToolResult,
  TurnBudgets,
  Usage,
  UsageRecord,
} from "../../contracts.js";
import { assertGuardrailsAllowed, GuardrailError, runGuardrails } from "../../guardrails.js";
import { type BeforeProviderTurnPayload, validateDeterministicTurnAnswer } from "../../middleware.js";
import { createProviderTurnMetadata, readProviderHttpStatus } from "../../observability.js";
import { providerError, providerToolCallDeltaContent } from "../../provider-events.js";
import { errorToErrorInfo, redactRunLedgerRecord, redactSecrets } from "../../redaction.js";
import { createDefaultRetryPolicy, waitForRetry } from "../../retry.js";
import { estimateTextTokensForFamily } from "../../usage-estimation.js";
import {
  bridgeAbort,
  errorFromInfo,
  isSteerSoftInterrupt,
  jsonBytes,
  mergeRetry,
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
  if (last?.type === "thinking" && block.type === "thinking") {
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
 *  derivable cap (or a bad attention setting on an unrelated run) omits the field instead of
 *  failing an emitting turn; the attention compiler, when enabled, is the cap authority. */
export function resolveTurnInputCap(session: SessionHost, model: ModelConfig): number | undefined {
  const setting = session.agent.config.attentionCompiler;
  const options = typeof setting === "object" && setting !== null ? setting : undefined;
  try {
    return resolveInputCap(options ? { maxInputTokens: options.maxInputTokens, reserveTokens: options.reserveTokens } : {}, model);
  } catch {
    return undefined;
  }
}

/** Effective budget snapshot at turn end (plan 087 T1): O(1) from the run limit tracker. */
function turnBudgets(session: SessionHost, model: ModelConfig, usage: Usage | undefined): TurnBudgets | undefined {
  const tracker = session.activeLimits;
  if (!tracker) return undefined;
  const snapshot = tracker.snapshot();
  const inputCap = resolveTurnInputCap(session, model);
  const runInputBudget = tracker.limits.maxInputTokens;
  return {
    ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
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
    const cost =
      ((usage.inputTokens ?? 0) * (quote.input ?? 0) +
        (usage.outputTokens ?? 0) * (quote.output ?? 0) +
        (usage.cacheReadTokens ?? 0) * (quote.cacheRead ?? 0) +
        (usage.cacheWriteTokens ?? 0) * (quote.cacheWrite ?? 0)) /
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
 * Plan 091 T2 missing-usage fallback: when the provider reported nothing and the
 * agent did not turn estimation off, label an estimate of the turn's own request
 * (messages + tool declarations + context blocks). Returns `undefined` when
 * estimation is off or the request is unavailable — absent stays absent.
 */
function estimateTurnUsage(session: SessionHost, model: ModelConfig, request: ProviderRequest | undefined): Usage | undefined {
  if (!request || session.agent.config.usageEstimation === "off") return undefined;
  const estimate = estimateMessageTokens(request.messages, model.model);
  const extras =
    request.tools?.length || request.context?.length ? JSON.stringify({ tools: request.tools, context: request.context }) : undefined;
  return {
    inputTokens: estimate.tokens + (extras === undefined ? 0 : estimateTextTokensForFamily(extras, model.model)),
    estimated: true,
    confidence: estimate.confidence,
  };
}

/** Latest user-role text in the assembled request; steered messages included. */
function lastUserText(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  }
  return "";
}

/**
 * Plan 096: host middleware may answer the turn deterministically at the `beforeProviderTurn` seam —
 * no provider request, no usage, mandatory provenance. `undefined` sends the turn to the provider
 * unchanged; a malformed answer fails the run closed instead of falling through to the provider.
 */
export async function resolveDeterministicTurn(
  session: SessionHost,
  request: ProviderRequest,
  runId: string,
  turn: number,
  signal: AbortSignal,
  toolResults: readonly ToolResult[] = [],
): Promise<ProviderTurnResult | undefined> {
  const middleware = session.agent.config.middleware;
  if (!middleware) return undefined;
  const payload = await middleware.run<BeforeProviderTurnPayload>("beforeProviderTurn", {
    sessionId: session.id,
    runId,
    turn,
    userText: lastUserText(request.messages),
  });
  const answer = payload?.answer;
  if (answer === undefined) return undefined;
  const validated = validateDeterministicTurnAnswer(answer);
  throwIfAborted(signal);
  const messageId = randomId("msg");
  // Same response-byte axis as provider output: a host answer must not bypass a run ceiling.
  session.activeLimits?.charge("maxResponseBytes", jsonBytes(validated.content));
  if (session.activeGuardrails?.output?.length) {
    assertGuardrailsAllowed(
      await runGuardrails({
        stage: "output",
        guardrails: session.activeGuardrails,
        value: { content: validated.content, calls: [], messageId, started: true, usage: undefined },
        context: {
          sessionId: session.id,
          runId,
          metadata: session.activeMetadata ?? {},
          signal,
          toolResults,
        },
        redactor: session.activeRedactor,
        emit: (event) => session.emit(event),
      }),
    );
  }
  session.emit({
    type: "deterministic_turn",
    sessionId: session.id,
    runId,
    turn,
    middleware: validated.provenance.middleware,
  });
  session.emit({
    type: "message_started",
    sessionId: session.id,
    runId,
    message: { id: messageId, role: "assistant", content: [] },
  });
  for (const block of validated.content) session.emit({ type: "message_delta", sessionId: session.id, runId, content: block });
  // Provenance rides the message into the store (plan 096 Task 2): the transcript alone proves no model ran.
  return {
    content: validated.content,
    calls: [],
    messageId,
    started: true,
    usage: undefined,
    metadata: { deterministic: validated.provenance },
  };
}

export async function generateWithRetry(
  session: SessionHost,
  request: ProviderRequest,
  runId: string,
  options: RunOptions,
  signal: AbortSignal,
  requestSecrets: readonly (string | undefined)[] = [],
  turn = 1,
  recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<Usage | undefined>,
  toolResults: readonly ToolResult[] = [],
): Promise<ProviderTurnResult> {
  const retry = mergeRetry(session.agent.config.retry, options.retry);
  const secrets = [...requestSecrets, ...(retry?.secrets ?? [])];
  const policy = retry?.policy ?? (retry ? createDefaultRetryPolicy(retry) : undefined);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await generateProviderTurn(session, request, runId, signal, secrets, turn, attempt, recordUsage, toolResults);
    } catch (error) {
      if (error instanceof GuardrailError || isSteerSoftInterrupt(error)) throw error;
      const failure = error instanceof ProviderTurnFailure ? error : undefined;
      const info = failure ? redactSecrets(failure.info, secrets) : errorToErrorInfo(error, secrets);
      if (!policy || failure?.observable) throw errorFromInfo(info);
      const context = { sessionId: session.id, runId, attempt, error: info, metadata: retry?.metadata, signal };
      let decision = await policy.decide(context);
      const payload: RetryMiddlewarePayload = (await session.agent.config.middleware?.run("retry", { context, decision })) ?? {
        context,
        decision,
      };
      decision = payload.decision;
      if (!decision.retry) throw errorFromInfo(info);
      const delayMs = decision.delayMs ?? 0;
      session.emit({ type: "retry_scheduled", sessionId: session.id, runId, attempt, delayMs, error: info });
      await waitForRetry(decision, signal);
    }
  }
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
  toolResults: readonly ToolResult[] = [],
): Promise<ProviderTurnResult> {
  session.activeLimits!.charge("maxProviderAttempts");
  session.activeLimits!.charge("maxRequestBytes", jsonBytes(request));
  const startedAt = performance.now();
  const providerId = session.activeProvider?.id ?? request.model.provider;
  const buildMetadata = (extra: Omit<ProviderTurnMetadata, "providerId" | "model"> = {}) =>
    createProviderTurnMetadata(request, providerId, { attempt, ...extra });
  session.emit({
    type: "provider_turn_started",
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
  const bufferOutput = Boolean(session.activeGuardrails?.output?.length || session.activeLimitOutputBuffer);
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
    for await (const event of session.activeProvider!.generate(turnRequest)) {
      throwIfAborted(turnAbort.signal);
      session.activeLimits!.charge("maxResponseBytes", jsonBytes(event));
      if (event.type === "error") throw new ProviderTurnFailure(event.error, started);
      if (event.type === "usage") usage = event.usage;
      if (event.type === "done") {
        usage = event.usage ?? usage;
        nativeStopReason = event.stopReason;
        break;
      }
      if (event.type === "message_start") {
        started = true;
        messageId = event.messageId;
        emitOutput({ type: "message_started", sessionId: session.id, runId, message: { id: messageId, role: "assistant", content: [] } });
        continue;
      }
      if (event.type === "content_delta" || event.type === "tool_call" || event.type === "tool_call_delta") {
        if (!started) {
          started = true;
          emitOutput({ type: "message_started", sessionId: session.id, runId, message: { role: "assistant", content: [] } });
        }
        if (event.type === "tool_call_delta") {
          toolDeltas.push(event);
          emitOutput({ type: "message_delta", sessionId: session.id, runId, content: providerToolCallDeltaContent(event) });
          continue;
        }
        const block = providerContent(event);
        pushCoalescedContent(content, block);
        if (block.type === "tool_call") calls.push(block);
        emitOutput({ type: "message_delta", sessionId: session.id, runId, content: block });
      }
    }
    for (const call of reconstructMissingToolCalls(toolDeltas, calls)) {
      content.push(call);
      calls.push(call);
      emitOutput({ type: "message_delta", sessionId: session.id, runId, content: call });
    }
    await recordTurnUsage();
    if (session.activeGuardrails?.output?.length) {
      assertGuardrailsAllowed(
        await runGuardrails({
          stage: "output",
          guardrails: session.activeGuardrails,
          value: { content, calls, messageId, started, usage },
          context: {
            sessionId: session.id,
            runId,
            metadata: session.activeMetadata ?? {},
            signal: turnAbort.signal,
            toolResults,
          },
          redactor: session.activeRedactor,
          emit: (event) => session.emit(event),
        }),
      );
    }
    if (bufferOutput) for (const event of bufferedOutput) session.emit(event);
    const latencyMs = Math.round(performance.now() - startedAt);
    session.emit({
      type: "provider_turn_finished",
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
        type: "provider_turn_finished",
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
    await recordTurnUsage();
    session.emit({
      type: "provider_turn_finished",
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
    if (error instanceof GuardrailError || error instanceof ProviderTurnFailure) throw error;
    throw new ProviderTurnFailure(info, started);
  } finally {
    cleanupTurn();
    if (session.activeProviderTurnAbort === turnAbort) session.activeProviderTurnAbort = undefined;
  }
}
