/** Provider-round phase of runInternal (plan 059). */

import type {
  ContentBlock,
  CostCatalog,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  ProviderTurnMetadata,
  ProviderTurnResult,
  RetryMiddlewarePayload,
  RunOptions,
  ToolCallContent,
  Usage,
  UsageRecord,
} from "../../contracts.js";
import { assertGuardrailsAllowed, GuardrailError, runGuardrails } from "../../guardrails.js";
import { createProviderTurnMetadata, readProviderHttpStatus } from "../../observability.js";
import { providerToolCallDeltaContent } from "../../provider-events.js";
import { errorToErrorInfo, redactRunLedgerRecord, redactSecrets } from "../../redaction.js";
import { createDefaultRetryPolicy, waitForRetry } from "../../retry.js";
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

export async function recordProviderUsage(ctx: RoundContext, turnUsage: Usage | undefined, turn: number, attempt: number): Promise<void> {
  const { session, limits, runUsage, runId } = ctx;
  const usage = turnUsage ? await withCatalogCost(session.agent.config.costCatalog, ctx.model, turnUsage, ctx.controller.signal) : undefined;
  limits.recordUsage(usage);
  if (!usage) return;
  runUsage.add(usage);
  if (!session.activeLedger) return;
  const usageRecord: UsageRecord = {
    id: randomId("usage"),
    sessionId: session.id,
    runId,
    scope: "provider_turn",
    turn,
    attempt,
    usage,
    recordedAt: new Date().toISOString(),
    ...session.activeOwnership,
  };
  await session.activeLedger.appendUsage(redactRunLedgerRecord(usageRecord, session.activeRedactor));
}

export async function generateWithRetry(
  session: SessionHost,
  request: ProviderRequest,
  runId: string,
  options: RunOptions,
  signal: AbortSignal,
  requestSecrets: readonly (string | undefined)[] = [],
  turn = 1,
  recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<void>,
): Promise<ProviderTurnResult> {
  const retry = mergeRetry(session.agent.config.retry, options.retry);
  const secrets = [...requestSecrets, ...(retry?.secrets ?? [])];
  const policy = retry?.policy ?? (retry ? createDefaultRetryPolicy(retry) : undefined);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await generateProviderTurn(session, request, runId, signal, secrets, turn, attempt, recordUsage);
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
  recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<void>,
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
  let usageRecorded = false;
  const bufferedOutput: import("../../contracts.js").AgentEvent[] = [];
  const bufferOutput = Boolean(session.activeGuardrails?.output?.length || session.activeLimitOutputBuffer);
  const emitOutput = (event: import("../../contracts.js").AgentEvent) => {
    if (bufferOutput) bufferedOutput.push(event);
    else session.emit(event);
  };
  const recordTurnUsage = async () => {
    if (usageRecorded) return;
    usageRecorded = true;
    await recordUsage?.(usage, turn, attempt);
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
        content.push(block);
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
          context: { sessionId: session.id, runId, metadata: session.activeMetadata ?? {}, signal: turnAbort.signal },
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
      metadata: buildMetadata({ latencyMs }),
      usage,
    });
    return { content, calls, messageId, started, usage };
  } catch (error) {
    if (isSteerSoftInterrupt(error) || isSteerSoftInterrupt(turnAbort.signal.reason)) {
      await recordTurnUsage();
      const latencyMs = Math.round(performance.now() - startedAt);
      session.emit({
        type: "provider_turn_finished",
        sessionId: session.id,
        runId,
        turn,
        metadata: buildMetadata({ latencyMs }),
        usage,
      });
      throw new SteerSoftInterrupt();
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const info = error instanceof ProviderTurnFailure ? redactSecrets(error.info, secrets) : errorToErrorInfo(error, secrets);
    await recordTurnUsage();
    session.emit({
      type: "provider_turn_finished",
      sessionId: session.id,
      runId,
      turn,
      metadata: buildMetadata({ latencyMs, httpStatus: readProviderHttpStatus(info) }),
      usage,
      error: info,
    });
    if (error instanceof GuardrailError || error instanceof ProviderTurnFailure) throw error;
    throw new ProviderTurnFailure(info, started);
  } finally {
    cleanupTurn();
    if (session.activeProviderTurnAbort === turnAbort) session.activeProviderTurnAbort = undefined;
  }
}
