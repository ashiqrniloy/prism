/** Finalize/persist phase of runInternal (plan 059). */

import type { PendingToolCall, StoredAgentRunState } from "../../agent-run-state.js";
import { boundedLoopSnapshot, initialAgentRunState, publicState, saveAgentRunState } from "../../agent-run-state.js";
import { createMemoryRunStateCell } from "../../run-state-cell.js";
import type {
  AgentRunState,
  AgentRunStatus,
  ErrorInfo,
  Message,
  ModelConfig,
  NestedRunRef,
  RunResult,
  Usage,
  UsageRecord,
} from "../../contracts.js";
import { AgentLoopStateError, AgentRunStateError } from "../../contracts.js";
import { redactRunLedgerRecord } from "../../redaction.js";
import { isFlushableRunLedger } from "../../run-ledger.js";
import type { RunLimitTracker } from "../../run-limits.js";
import { snapshotLoadedSkillBodies } from "../../skill-load.js";
import { createSuspendedRunEntry } from "../../suspended-run.js";
import { isDurableLoop, randomId } from "../helpers.js";
import { isSessionScopedHookId } from "../runtime-registry.js";
import type { RoundContext, SessionHost } from "./types.js";

/** Definition revision of a kernel suspension; the fingerprint binds to it on resume. */
export const KERNEL_SUSPENSION_REVISION = "kernel-suspension";

export async function persistDurable(session: SessionHost, state: StoredAgentRunState): Promise<AgentRunState> {
  return (await persistDurableRaw(session, state)).publicValue;
}

/** Like {@link persistDurable}, but also returns the bounded stored state (for the store entry). */
export async function persistDurableRaw(
  session: SessionHost,
  state: StoredAgentRunState,
): Promise<{ readonly state: StoredAgentRunState; readonly publicValue: AgentRunState }> {
  const durable = session.activeDurable;
  if (!durable) throw new AgentRunStateError("Durable run state is not configured");
  const withGrant = session.activeToolNames !== undefined ? { ...state, toolNames: session.activeToolNames } : state;
  const persistSessionState = durable.options.persistSessionState === true;
  const sessionState = {
    ...(persistSessionState
      ? {
          loadedSkillNames: session.loadedSkills.list(),
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
  };
  const persisted = Object.keys(sessionState).length > 0 ? { ...withGrant, sessionState } : withGrant;
  const saved = await saveAgentRunState({
    cell: durable.options.cell,
    state: persisted,
    redactor: session.activeRedactor,
    maxStateBytes: durable.options.maxStateBytes,
  });
  durable.state = saved.state;
  return { state: saved.state, publicValue: publicState(saved.state) };
}

export async function suspendDurable(
  session: SessionHost,
  input: {
    readonly runId: string;
    readonly model: ModelConfig | undefined;
    readonly limits: RunLimitTracker;
    readonly interruption: import("../../contracts.js").AgentRunInterruption;
    readonly messages?: readonly Message[];
    readonly pending?: StoredAgentRunState["pending"];
    readonly pendingCalls?: readonly PendingToolCall[];
    /** Full replacement when provided; otherwise the recorded nested runs are preserved. */
    readonly nestedRuns?: readonly NestedRunRef[];
  },
): Promise<AgentRunState> {
  const loop = session.activeLoop;
  // Suspension needs no store: the `suspended_run` entry below is the durable anchor and carries the
  // whole redacted state. The run gets a private in-memory cell for the bounded, versioned value, and a
  // custom loop must be snapshot/restore capable to suspend.
  if (!session.activeDurable) {
    if (loop && !isDurableLoop(loop)) {
      throw new AgentLoopStateError(
        "ERR_PRISM_LOOP_NOT_DURABLE",
        "Custom LoopStrategy on a suspendable run requires snapshot and restore hooks",
      );
    }
    session.activeDurable = {
      options: { cell: createMemoryRunStateCell(), definitionRevision: KERNEL_SUSPENSION_REVISION, persistSessionState: true },
    };
  }
  const durable = session.activeDurable;
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
      fallbackAgentId: "agent",
    });
  const saved = await persistDurableRaw(session, {
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
  // Store-slot anchor (roadmap §2.4 ask path): one self-contained entry so a new process over the
  // same session store can find and resume the suspension with no other read.
  await session.appendEntry(
    createSuspendedRunEntry({
      id: randomId("entry"),
      sessionId: session.id,
      parentId: session.currentLeafId,
      runId: input.runId,
      loop: { name: loop?.name ?? "default", revision: loop?.revision ?? "1", ...(loopState ? { snapshot: loopState.snapshot } : {}) },
      hookIds: session
        .hooks()
        .registrations()
        .filter((registration) => !isSessionScopedHookId(registration.id))
        .map((registration) => registration.id),
      state: saved.state,
    }),
  );
  return saved.publicValue;
}

export async function persistSucceeded(ctx: RoundContext, loopUsage: Usage | undefined): Promise<RunResult> {
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
  // A clean run-end stop keeps the frontier and marks the state continuable — a `turn.before`
  // stop (`hook_stop`) or a `run.end` continuation cap (`hook_limit`). Every other succeeded
  // state drops its loop state and is final.
  const continuableStop = ctx.loopFinishReason === "hook_stop" || ctx.loopFinishReason === "hook_limit" ? ctx.loopFinishReason : undefined;
  const runState = session.activeDurable?.state
    ? await persistDurable(session, {
        ...session.activeDurable.state,
        status: "succeeded",
        ...(continuableStop ? { stopReason: continuableStop, leafId: session.currentLeafId } : {}),
        pending: undefined,
        pendingCalls: undefined,
        nestedRuns: undefined,
        stickyDecisions: undefined,
        interruption: undefined,
        ...(continuableStop ? {} : { loopState: undefined }),
      })
    : undefined;
  session.emit({
    type: "run.completed",
    sessionId: session.id,
    runId,
    status: ctx.loopFinishReason ? "stopped" : "completed",
    usage,
    ...(ctx.loopFinishReason ? { stopReason: ctx.loopFinishReason } : {}),
    ...(ctx.loopStopDetail ? { stopDetail: ctx.loopStopDetail } : {}),
  });
  const stopReason = ctx.loopFinishReason;
  return session.buildRunResult({
    runId,
    status: "succeeded",
    usage,
    runState,
    ...(stopReason ? { stopReason } : {}),
    ...(ctx.loopStopDetail ? { stopDetail: ctx.loopStopDetail } : {}),
  });
}

export async function cleanupRun(input: {
  session: SessionHost;
  controller: AbortController;
  cleanupSignal: () => void;
  runId: string;
  model: ModelConfig | undefined;
  startedAt: string;
  runStatus: AgentRunStatus;
  runError: ErrorInfo | undefined;
  /** Clean stop taxonomy for the finish record; only written for a succeeded run (plan 084 Task 2). */
  stopReason?: import("../../contracts.js").AgentFinishReason;
  stopDetail?: string;
}): Promise<void> {
  const { session, controller, cleanupSignal, runId, model, startedAt, runStatus, runError } = input;
  if (session.activeRun === controller) session.activeRun = undefined;
  session.activeRunId = undefined;
  session.activeLoop = undefined;
  session.activeLoopHistory = undefined;
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
        ...(model ? { provider: model.provider } : {}),
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
    session.activePrincipal = undefined;
    session.activeIdempotencyKey = undefined;
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
    session.closeRunSubscribers();
  }
}
