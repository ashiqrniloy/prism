/** Finalize/persist phase of runInternal (plan 059). */

import type { PendingToolCall, StoredAgentRunState } from "../../agent-run-state.js";
import {
  boundedLoopSnapshot,
  initialAgentRunState,
  publicState,
  resolveCheckpointMetadata,
  saveAgentRunState,
} from "../../agent-run-state.js";
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
  const withGrant = session.activeToolNames !== undefined ? { ...state, toolNames: session.activeToolNames } : state;
  const persistSessionState = durable.options.persistSessionState === true;
  // Plan 086 T3: durable folding owns its two keys. A run that opted into `durable` writes the
  // fold ledger and its frontier even when the broader session-state bag stays off; a run that
  // did not keeps exactly today's bytes, where the frontier rides `persistSessionState`.
  const attentionSticky = persistSessionState || session.attentionDurable ? session.serializedAttentionSticky() : undefined;
  const attentionFold = session.attentionDurable ? session.serializedAttentionFold() : undefined;
  const sessionState = {
    ...(persistSessionState
      ? {
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
        }
      : {}),
    ...(attentionSticky ? { attentionSticky } : {}),
    ...(attentionFold ? { attentionFold } : {}),
  };
  const persisted = Object.keys(sessionState).length > 0 ? { ...withGrant, sessionState } : withGrant;
  const metadata = resolveCheckpointMetadata(durable.options.checkpointMetadata) ?? durable.checkpointMetadata;
  const saved = await saveAgentRunState({
    checkpoints: durable.options.checkpoints,
    state: persisted,
    expectedVersion: durable.version,
    ownership: session.activeOwnership,
    fencingToken: durable.options.fencingToken,
    redactor: session.activeRedactor,
    maxStateBytes: durable.options.maxStateBytes,
    ...(metadata ? { metadata } : {}),
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

/**
 * Turn-boundary crash-recovery checkpoint (plan 084 Task 1). Called before each provider
 * request when `checkpointPolicy: "every-turn"`; a no-op otherwise, so default-policy runs keep
 * the 0.8.x checkpoint shape and write count unchanged. Pending-decision markers are dropped:
 * at a turn boundary every gated call has been resolved or the run already suspended, and a
 * stale marker must never replay. The recorded `checkpointPolicy` makes the cadence survive
 * into a resumed run, and loop-local state rides along exactly as it does at suspension.
 */
export async function checkpointDurableTurn(
  session: SessionHost,
  input: { readonly runId: string; readonly model: ModelConfig; readonly limits: RunLimitTracker },
): Promise<void> {
  if (session.activeDurable?.options.checkpointPolicy !== "every-turn") return;
  await writeRunningCheckpoint(session, input);
}

/**
 * Fold-boundary checkpoint (plan 086 T3). Called once per turn that added folded bodies — never
 * per turn — when the resolved compiler is durable, so a crash after a fold resumes with the
 * ledger and frontier already on disk. Independent of `checkpointPolicy`: the fold is the
 * durability point that matters for a long single run, not the turn boundary.
 */
export async function checkpointDurableFold(
  session: SessionHost,
  input: { readonly runId: string; readonly model: ModelConfig; readonly limits: RunLimitTracker },
): Promise<void> {
  if (!session.attentionDurable) return;
  await writeRunningCheckpoint(session, input);
}

/** Shared running-checkpoint write for the turn-boundary and fold-boundary triggers. */
async function writeRunningCheckpoint(
  session: SessionHost,
  input: { readonly runId: string; readonly model: ModelConfig; readonly limits: RunLimitTracker },
): Promise<void> {
  const durable = session.activeDurable;
  if (!durable) return;
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
      status: "running",
      interruptBeforeTool: durable.options.interruptBeforeTool,
    });
  await persistDurable(session, {
    ...state,
    leafId: session.currentLeafId,
    status: "running",
    interruption: undefined,
    // The input messages are already in the session store by the time a turn boundary is
    // reached; keeping them would re-append them on a later resume.
    input: undefined,
    pending: undefined,
    pendingCalls: undefined,
    ...(loopState ? { loopState } : {}),
    counters: input.limits.snapshot(),
  });
}

export async function persistSucceeded(ctx: RoundContext, loopUsage: Usage | undefined): Promise<AgentRunResult> {
  const { session, runId, runUsage } = ctx;
  const stop = ctx.runStop;
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
        // Plan 084 Task 2: a host-policy stop is terminal for the run but leaves the frontier
        // intact — the loop state is kept and the state is marked continuable.
        ...(stop ? { stopReason: "host_policy" as const, leafId: session.currentLeafId } : {}),
        pending: undefined,
        pendingCalls: undefined,
        nestedRuns: undefined,
        stickyDecisions: undefined,
        interruption: undefined,
        ...(stop ? {} : { loopState: undefined }),
      })
    : undefined;
  session.emit({
    type: "agent_finished",
    sessionId: session.id,
    runId,
    usage,
    ...(ctx.loopCtx.finishReason ? { finishReason: ctx.loopCtx.finishReason } : {}),
    ...(stop?.detail ? { stopDetail: stop.detail } : {}),
  });
  const stopReason = ctx.runStop?.reason ?? ctx.loopCtx.finishReason;
  return session.buildRunResult({
    runId,
    status: "succeeded",
    usage,
    runState,
    ...(stopReason ? { stopReason } : {}),
    ...(stop?.detail ? { stopDetail: stop.detail } : {}),
  });
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
  /** Clean stop taxonomy for the finish record; only written for a succeeded run (plan 084 Task 2). */
  stopReason?: import("../../contracts.js").AgentFinishReason;
  stopDetail?: string;
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
        ...(input.runStatus === "succeeded" && input.stopReason ? { stopReason: input.stopReason } : {}),
        ...(input.runStatus === "succeeded" && input.stopDetail ? { stopDetail: input.stopDetail } : {}),
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
    session.activeToolNames = undefined;
    session.activeLimits = undefined;
    session.activeRecentToolCalls = undefined;
    session.activeLimitOutputBuffer = false;
    session.activeRedactor = undefined;
    session.activeProvider = undefined;
    cleanupSignal();
    session.closeSubscribers();
  }
}
