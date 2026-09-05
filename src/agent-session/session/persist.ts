/** Finalize/persist phase of runInternal (plan 059). */

import type { PendingToolCall, StoredAgentRunState } from "../../agent-run-state.js";
import { boundedLoopSnapshot, initialAgentRunState, publicState, saveAgentRunState } from "../../agent-run-state.js";
import type { AgentRunResult, AgentRunState, ErrorInfo, Message, ModelConfig, NestedRunRef, Usage, UsageRecord } from "../../contracts.js";
import { AgentRunStateError } from "../../contracts.js";
import { redactRunLedgerRecord } from "../../redaction.js";
import { isFlushableRunLedger } from "../../run-ledger.js";
import type { RunLimitTracker } from "../../run-limits.js";
import { snapshotLoadedSkillBodies } from "../../skill-load.js";
import { randomId } from "../helpers.js";
import type { RoundContext, SessionHost } from "./types.js";

export async function persistDurable(session: SessionHost, state: StoredAgentRunState): Promise<AgentRunState> {
  const durable = session.activeDurable;
  if (!durable) throw new AgentRunStateError("Durable run state is not configured");
  const persisted = durable.options.persistSessionState
    ? {
        ...state,
        sessionState: {
          loadedSkillNames: session.loadedSkills.list(),
          ...(session.activatedTools.list().length ? { activatedToolNames: session.activatedTools.list() } : {}),
          ...(durable.options.includeSkillBodies
            ? {
                loadedSkillBodies: snapshotLoadedSkillBodies(
                  session.activeRunSkills,
                  session.loadedSkills,
                  session.restoredSkillBodies.length
                    ? new Map(session.restoredSkillBodies.map((e) => [e.name, e.instructions]))
                    : undefined,
                ),
              }
            : {}),
        },
      }
    : state;
  const saved = await saveAgentRunState({
    checkpoints: durable.options.checkpoints,
    state: persisted,
    expectedVersion: durable.version,
    ownership: session.activeOwnership,
    fencingToken: durable.options.fencingToken,
    redactor: session.activeRedactor,
    maxStateBytes: durable.options.maxStateBytes,
  });
  durable.state = saved.state;
  durable.version = saved.record.version;
  return publicState(saved.state);
}

export async function suspendDurable(
  session: SessionHost,
  input: {
    readonly runId: string;
    readonly model: ModelConfig;
    readonly limits: RunLimitTracker;
    readonly interruption: import("../../contracts.js").AgentRunInterruption;
    readonly messages?: readonly Message[];
    readonly pending?: StoredAgentRunState["pending"];
    readonly pendingCalls?: readonly PendingToolCall[];
    /** Full replacement when provided; otherwise the recorded nested runs are preserved. */
    readonly nestedRuns?: readonly NestedRunRef[];
  },
): Promise<AgentRunState> {
  const durable = session.activeDurable;
  if (!durable) throw new AgentRunStateError("Durable interruption is not configured");
  const loop = session.activeLoop;
  const loopState = loop?.snapshot ? boundedLoopSnapshot(loop.name, loop.revision ?? "1", loop.snapshot()) : undefined;
  const state =
    durable.state ??
    initialAgentRunState({
      agent: session.agent,
      options: durable.options,
      runId: input.runId,
      sessionId: session.id,
      leafId: session.currentLeafId,
      model: input.model,
      counters: input.limits.snapshot(),
      deadlineAt: input.limits.deadlineAt,
      status: "suspended",
      interruption: input.interruption,
      messages: input.messages,
      pending: input.pending,
      pendingCalls: input.pendingCalls,
      interruptBeforeTool: durable.options.interruptBeforeTool,
    });
  return persistDurable(session, {
    ...state,
    leafId: session.currentLeafId,
    status: "suspended",
    interruption: input.interruption,
    ...(input.messages ? { input: input.messages } : {}),
    ...(input.pending ? { pending: input.pending } : {}),
    ...(input.pendingCalls ? { pendingCalls: input.pendingCalls } : {}),
    nestedRuns: input.nestedRuns ?? state.nestedRuns,
    ...(loopState ? { loopState } : {}),
    counters: input.limits.snapshot(),
  });
}

export async function persistSucceeded(ctx: RoundContext, loopUsage: Usage | undefined): Promise<AgentRunResult> {
  const { session, runId, runUsage } = ctx;
  const usage = runUsage.value() ?? loopUsage;
  if (usage && session.activeLedger) {
    const usageRecord: UsageRecord = {
      id: randomId("usage"),
      sessionId: session.id,
      runId,
      scope: "run_total",
      usage,
      recordedAt: new Date().toISOString(),
      ...session.activeOwnership,
    };
    await session.activeLedger.appendUsage(redactRunLedgerRecord(usageRecord, session.activeRedactor));
  }
  await session.drainLedger();
  const runState = session.activeDurable?.state
    ? await persistDurable(session, {
        ...session.activeDurable.state,
        status: "succeeded",
        pending: undefined,
        pendingCalls: undefined,
        nestedRuns: undefined,
        stickyDecisions: undefined,
        interruption: undefined,
        loopState: undefined,
      })
    : undefined;
  session.emit({
    type: "agent_finished",
    sessionId: session.id,
    runId,
    usage,
    ...(ctx.loopCtx.finishReason ? { finishReason: ctx.loopCtx.finishReason } : {}),
  });
  return session.buildRunResult({ runId, status: "succeeded", usage, runState });
}

export async function cleanupRun(input: {
  session: SessionHost;
  controller: AbortController;
  cleanupSignal: () => void;
  runId: string;
  model: ModelConfig;
  startedAt: string;
  runStatus: AgentRunResult["status"];
  runError: ErrorInfo | undefined;
}): Promise<void> {
  const { session, controller, cleanupSignal, runId, model, startedAt, runStatus, runError } = input;
  if (session.activeRun === controller) session.activeRun = undefined;
  session.activeRunId = undefined;
  session.activeLoop = undefined;
  session.activeGatedRound = undefined;
  session.activeProviderTurnAbort = undefined;
  session.pendingSoftInterrupt = false;
  session.pendingSteers = [];
  session.pendingSteerBytes = 0;
  try {
    await session.drainLedger();
    if (session.activeLedger) {
      const finishRecord = {
        id: runId,
        sessionId: session.id,
        branchId: session.currentLeafId,
        model,
        provider: model.provider,
        idempotencyKey: session.activeIdempotencyKey,
        status: runStatus,
        startedAt,
        finishedAt: new Date().toISOString(),
        abortReason: controller.signal.aborted ? String(controller.signal.reason) : undefined,
        error: runError,
        ...(session.activePromptVersion ? { promptVersion: session.activePromptVersion } : {}),
        ...session.activeOwnership,
      };
      await session.activeLedger.appendRun(redactRunLedgerRecord(finishRecord, session.activeRedactor));
      if (isFlushableRunLedger(session.activeLedger) && session.activeLedger.durability === "flush_on_terminal")
        await session.activeLedger.flush();
    }
  } finally {
    session.activeLedger = undefined;
    session.activeEffectStore = undefined;
    session.activeOwnership = undefined;
    session.activeIdentity = undefined;
    session.activeIdempotencyKey = undefined;
    session.activeGuardrails = undefined;
    session.activeMetadata = undefined;
    session.activePromptVersion = undefined;
    session.activeLimits?.dispose();
    session.activeLimits = undefined;
    session.activeLimitOutputBuffer = false;
    session.activeRedactor = undefined;
    session.activeProvider = undefined;
    cleanupSignal();
    session.closeSubscribers();
  }
}
