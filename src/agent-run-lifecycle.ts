import { agentFingerprint, loadAgentRunState, publicState, saveAgentRunState } from "./agent-run-state.js";
import type { StoredAgentRunState } from "./agent-run-state.js";
import type {
  Agent,
  AgentEvent,
  AgentRunRef,
  AgentRunResult,
  AgentRunResume,
  AgentRunResumeOptions,
  AgentRunResumeStreamOptions,
  AgentRunStateOptions,
  AgentRunStatusResult,
  RunDecision,
  CheckpointStore,
  OwnershipScope,
  SubscribeOptions,
} from "./contracts.js";
import { AgentDecisionError, AgentRunStateError } from "./contracts.js";
import { pendingDecisionsOf, resolveRunDecisions } from "./agent-approval.js";
import { RuntimeAgentSession, throwIfAbortedSignal } from "./agent-session.js";

export interface AgentRunLifecycleAgent {
  readonly agent: Agent;
  /** Current host-authored revision; it must match the stored revision. */
  readonly definitionRevision: string;
}

export interface AgentRunLifecycleOptions {
  readonly checkpoints: CheckpointStore;
  readonly resolveAgent: (input: {
    readonly agentId: string;
    readonly ownership?: OwnershipScope;
    readonly signal?: AbortSignal;
  }) => AgentRunLifecycleAgent | Promise<AgentRunLifecycleAgent>;
  readonly fencingToken?: number;
}

export interface AgentRunLifecycleRequest {
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
  /** Adapter-selected capability; stored runs for another agent are non-enumerable. */
  readonly agentId?: string;
  /** Opt-in (plan 015 Task 4): restore persisted loaded-skill names on resume. */
  readonly persistSessionState?: boolean;
  /** Opt-in (plan 018 Task 6): restore persisted loaded-skill bodies on resume (requires `persistSessionState` too). */
  readonly includeSkillBodies?: boolean;
}

/** Bounded live-event options for a durable lifecycle resume. */
export interface AgentRunLifecycleStreamRequest extends AgentRunLifecycleRequest, SubscribeOptions {}

export interface AgentRunLifecycle {
  status(ref: AgentRunRef, options?: AgentRunLifecycleRequest): Promise<AgentRunStatusResult>;
  resume(ref: AgentRunRef, resume: AgentRunResume, options?: AgentRunLifecycleRequest): Promise<AgentRunResult>;
  resumeStream(ref: AgentRunRef, resume: AgentRunResume, options?: AgentRunLifecycleStreamRequest): AsyncIterable<AgentEvent>;
}

function assertAgentId(actual: string, expected: string | undefined): void {
  if (expected !== undefined && actual !== expected) throw new AgentRunStateError("Agent run capability mismatch");
}

/** Host capability for durable agent status/resume. Adapters supply authorized ownership only. */
export function createAgentRunLifecycle(options: AgentRunLifecycleOptions): AgentRunLifecycle {
  return {
    async status(ref, request = {}) {
      request.signal?.throwIfAborted();
      const { state, record } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      request.signal?.throwIfAborted();
      return { state: publicState({ ...state, version: record.version }), version: record.version };
    },
    async resume(ref, resume, request = {}) {
      request.signal?.throwIfAborted();
      const { state } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      const resolved = await options.resolveAgent({ agentId: state.agentId, ownership: request.ownership, signal: request.signal });
      request.signal?.throwIfAborted();
      return resumeAgentRun(resolved.agent, ref, resume, {
        checkpoints: options.checkpoints,
        ownership: request.ownership,
        fencingToken: options.fencingToken,
        definitionRevision: resolved.definitionRevision,
        persistSessionState: request.persistSessionState,
        includeSkillBodies: request.includeSkillBodies,
      });
    },
    async *resumeStream(ref, resume, request = {}) {
      request.signal?.throwIfAborted();
      const { state } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      const resolved = await options.resolveAgent({ agentId: state.agentId, ownership: request.ownership, signal: request.signal });
      request.signal?.throwIfAborted();
      yield* resumeAgentRunStream(resolved.agent, ref, resume, {
        checkpoints: options.checkpoints,
        ownership: request.ownership,
        fencingToken: options.fencingToken,
        definitionRevision: resolved.definitionRevision,
        signal: request.signal,
        maxQueuedEvents: request.maxQueuedEvents,
        overflow: request.overflow,
        persistSessionState: request.persistSessionState,
        includeSkillBodies: request.includeSkillBodies,
      });
    },
  };
}

// Resume free functions moved from agents.ts at 0.1.4 (verbatim; the barrel re-exports the two public ones).
/** Resume a persisted built-in run. A claimed/dispatched tool is never replayed automatically. */
export async function resumeAgentRun(
  agent: Agent,
  ref: AgentRunRef,
  resume: AgentRunResume,
  options: AgentRunResumeOptions,
): Promise<AgentRunResult> {
  return executePreparedAgentRunResume(await prepareAgentRunResume(agent, ref, resume, options));
}

/** Subscribe before resuming one durable run. Early consumer return aborts that resumed execution. */
export async function* resumeAgentRunStream(
  agent: Agent,
  ref: AgentRunRef,
  resume: AgentRunResume,
  options: AgentRunResumeStreamOptions,
): AsyncGenerator<AgentEvent> {
  throwIfAbortedSignal(options.signal);
  const prepared = await prepareAgentRunResume(agent, ref, resume, options, options.signal);
  const subscription = prepared.session.subscribe(options);
  let settled = false;
  const runPromise = executePreparedAgentRunResume(prepared, options.signal).finally(() => {
    settled = true;
  });
  try {
    for await (const event of subscription) {
      if ("runId" in event && event.runId !== ref.runId) continue;
      yield event;
    }
    await runPromise;
  } finally {
    if (!settled) {
      prepared.session.abort(new Error("resume stream consumer closed"));
      await runPromise.catch(() => undefined);
    }
  }
}

type PreparedAgentRunResume =
  | {
      readonly kind: "deny";
      readonly session: RuntimeAgentSession;
      readonly result: AgentRunResult;
      readonly interruption: import("./contracts.js").AgentRunInterruption;
      readonly version: number;
      readonly ownership?: OwnershipScope;
    }
  | {
      readonly kind: "resuspend";
      readonly session: RuntimeAgentSession;
      readonly result: AgentRunResult;
      readonly interruption: import("./contracts.js").AgentRunInterruption;
      readonly version: number;
      readonly ownership?: OwnershipScope;
    }
  | {
      readonly kind: "approve";
      readonly session: RuntimeAgentSession;
      readonly state: StoredAgentRunState;
      readonly runState: AgentRunStateOptions;
      readonly decisions?: ReadonlyMap<string, RunDecision>;
      readonly ownership?: OwnershipScope;
    };

async function prepareAgentRunResume(
  agent: Agent,
  ref: AgentRunRef,
  resume: AgentRunResume,
  options: AgentRunResumeOptions,
  signal?: AbortSignal,
): Promise<PreparedAgentRunResume> {
  throwIfAbortedSignal(signal);
  const { record, state } = await loadAgentRunState(options.checkpoints, ref, options.ownership);
  if (
    state.definitionRevision !== options.definitionRevision ||
    state.agentId !== (agent.config.id ?? agent.config.name) ||
    state.fingerprint !== agentFingerprint(agent, options.definitionRevision)
  ) {
    throw new AgentRunStateError("Agent definition revision or fingerprint mismatch on resume");
  }
  if (record.version !== resume.expectedVersion || state.status !== "suspended") {
    throw new AgentRunStateError("Stale or non-suspended agent run resume");
  }
  const session = new RuntimeAgentSession({ agent, id: state.sessionId, leafId: state.leafId });
  // Opt-in session-state restore (plan 015 Task 4): names only; bodies re-resolve from
  // the live registry the next time the model (re)loads them via load_skill.
  if (options.persistSessionState && state.sessionState?.loadedSkillNames) {
    session.restoreLoadedSkills(state.sessionState.loadedSkillNames);
  }
  // Plan 018 Task 6 (closeout `checkpoint-bodies`): restore exact instructions so the
  // resumed session renders them registry-independently (no load_skill round-trip).
  if (options.persistSessionState && options.includeSkillBodies && state.sessionState?.loadedSkillBodies) {
    session.restoreLoadedSkillBodies(state.sessionState.loadedSkillBodies);
  }
  if (resume.decision !== undefined && resume.decisions !== undefined) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Resume accepts exactly one of decision or decisions");
  }
  const pendingDecisions = pendingDecisionsOf(state);
  // Legacy approve maps to allow-once on every pending decision; legacy deny keeps its
  // terminal-denied behavior. Batch decisions are validated and applied atomically below.
  const resolved =
    resume.decisions !== undefined
      ? await resolveRunDecisions({ agent, state, decisions: resume.decisions, signal })
      : resume.decision === "approve" && pendingDecisions
        ? await resolveRunDecisions({
            agent,
            state,
            decisions: pendingDecisions.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
            signal,
          })
        : undefined;
  if (resume.decision === undefined && resume.decisions === undefined) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Resume requires a decision or decisions");
  }
  if (resolved && resolved.remaining.length > 0) {
    throwIfAbortedSignal(signal);
    const single = resolved.remaining.length === 1 ? resolved.remaining[0]! : undefined;
    const interruption: import("./contracts.js").AgentRunInterruption = {
      kind: state.interruption?.kind ?? "tool_approval",
      reason: `${resolved.remaining.length} approval request(s) remain`,
      ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
      ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
      pendingDecisions: resolved.remaining,
    };
    const resuspended = await saveAgentRunState({
      checkpoints: options.checkpoints,
      state: {
        ...state,
        status: "suspended",
        interruption,
        pending: undefined,
        // Decided approvals persist on their entries so a partial batch never loses them;
        // they dispatch (or synthesize their result) when the run finally resumes.
        pendingCalls: state.pendingCalls?.map((entry) => {
          const decision = resolved.decisionsById.get(entry.approvalId);
          return decision ? { ...entry, decision } : entry;
        }),
        // Decided nested approvals persist on their nested-run entries, keyed by
        // root-visible approval id, so a partial batch never loses them either.
        nestedRuns: state.nestedRuns?.map((entry) => {
          const decided = entry.approvals.filter((approval) => resolved.decisionsById.has(approval.id));
          if (decided.length === 0) return entry;
          return {
            ...entry,
            decisions: {
              ...entry.decisions,
              ...Object.fromEntries(decided.map((approval) => [approval.id, resolved.decisionsById.get(approval.id)!])),
            },
          };
        }),
        stickyDecisions: resolved.stickyDecisions,
      },
      expectedVersion: record.version,
      ownership: options.ownership,
      fencingToken: options.fencingToken,
    });
    return {
      kind: "resuspend",
      session,
      interruption,
      version: resuspended.record.version,
      ownership: options.ownership,
      result: {
        sessionId: state.sessionId,
        runId: state.runId,
        status: "suspended",
        leafId: state.leafId,
        text: "",
        content: [],
        runState: publicState(resuspended.state),
        interruption,
      },
    };
  }
  if (resume.decision === "deny") {
    throwIfAbortedSignal(signal);
    const denied = await saveAgentRunState({
      checkpoints: options.checkpoints,
      state: {
        ...state,
        status: "denied",
        loopState: undefined,
        pendingCalls: undefined,
        nestedRuns: undefined,
        stickyDecisions: undefined,
      },
      expectedVersion: record.version,
      ownership: options.ownership,
      fencingToken: options.fencingToken,
    });
    return {
      kind: "deny",
      session,
      interruption: state.interruption!,
      version: denied.record.version,
      ownership: options.ownership,
      result: {
        sessionId: state.sessionId,
        runId: state.runId,
        status: "denied",
        leafId: state.leafId,
        text: "",
        content: [],
        runState: publicState(denied.state),
        interruption: state.interruption,
      },
    };
  }
  if (state.pending?.status === "dispatched" || state.pendingCalls?.some((entry) => entry.status === "dispatched")) {
    throw new AgentRunStateError("Ambiguous dispatched tool requires operator resolution");
  }
  const configured = agent.config.runState;
  if (configured && (configured.checkpoints !== options.checkpoints || configured.definitionRevision !== options.definitionRevision)) {
    throw new AgentRunStateError("Agent durable run-state configuration mismatch on resume");
  }
  throwIfAbortedSignal(signal);
  const claimed = await saveAgentRunState({
    checkpoints: options.checkpoints,
    state: {
      ...state,
      status: "running",
      interruption: undefined,
      stickyDecisions: resolved?.stickyDecisions ?? state.stickyDecisions,
    },
    expectedVersion: record.version,
    ownership: options.ownership,
    fencingToken: options.fencingToken,
  });
  return {
    kind: "approve",
    session,
    state: claimed.state,
    decisions: resolved?.decisionsById,
    ownership: options.ownership,
    runState: configured ?? {
      checkpoints: options.checkpoints,
      definitionRevision: options.definitionRevision,
      interruptBeforeTool: state.interruptBeforeTool,
      fencingToken: options.fencingToken,
      resumeNestedRun: options.resumeNestedRun,
    },
  };
}

/** Pending decisions of a suspended state, synthesizing the legacy single-approval shape. */
async function executePreparedAgentRunResume(prepared: PreparedAgentRunResume, signal?: AbortSignal): Promise<AgentRunResult> {
  if (prepared.kind === "deny") {
    await prepared.session.recordDurableDenial(prepared.result.runId, prepared.interruption, prepared.version, prepared.ownership);
    return prepared.result;
  }
  if (prepared.kind === "resuspend") {
    await prepared.session.recordDurableResumption(prepared.result.runId, prepared.interruption, prepared.version, prepared.ownership);
    return prepared.result;
  }
  return prepared.session.resumeDurable(prepared.state, prepared.runState, prepared.ownership, signal, prepared.decisions);
}
