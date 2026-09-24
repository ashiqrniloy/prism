import { assertValidAgentRunResume, pendingDecisionsOf, resolveRunDecisions } from "./agent-approval.js";
import type { StoredAgentRunState } from "./agent-run-state.js";
import { agentFingerprint, loadAgentRunState, publicState, resolveCheckpointMetadata, saveAgentRunState } from "./agent-run-state.js";
import { RuntimeAgentSession, throwIfAbortedSignal } from "./agent-session.js";
import { parseAttentionStickyFrontier, restoreAttentionFoldLedger } from "./attention-compiler.js";
import type { CheckpointRestoreAudit } from "./checkpoint-restore.js";
import { runCheckpointRestoreHooks } from "./checkpoint-restore.js";
import type {
  Agent,
  AgentCheckpointRestoreHook,
  AgentEvent,
  AgentRunCheckpointMetadata,
  AgentRunCheckpointMetadataSource,
  AgentRunRef,
  AgentRunResult,
  AgentRunResume,
  AgentRunResumeOptions,
  AgentRunResumeStreamOptions,
  AgentRunStateOptions,
  AgentRunStatusResult,
  CheckpointStore,
  OwnershipScope,
  RunDecision,
  SubscribeOptions,
} from "./contracts.js";
import { AgentRunStateError } from "./contracts.js";

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
  /**
   * Plan 094 Task 3: external-state restore hooks, run on every claiming resume before the
   * checkpoint is claimed. Registered once here because a resume builds its session from the
   * stored state (there is no live session to register against beforehand). Plan 109 Task 2: an
   * entry may be `{ id?, restore, compensate? }` so a failed resume rolls the applied layers back.
   */
  readonly restoreHooks?: readonly AgentCheckpointRestoreHook[];
  /** Per-hook restore ceiling in ms; defaults to `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`. */
  readonly restoreHookTimeoutMs?: number;
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
  /** Checkpoint sidecar metadata applied on resume (and to the resumed run's later checkpoints). */
  readonly checkpointMetadata?: AgentRunCheckpointMetadataSource;
  /** Plan 094 Task 3: restore hooks for this resume; the lifecycle's own hooks are used when omitted. */
  readonly restoreHooks?: readonly AgentCheckpointRestoreHook[];
  /** Per-hook restore ceiling in ms; defaults to `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`. */
  readonly restoreHookTimeoutMs?: number;
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

/** Lifecycle-registered hooks run first, then per-request ones; either timeout setting wins for both. */
function restoreHookOptions(
  lifecycle: AgentRunLifecycleOptions,
  request: AgentRunLifecycleRequest,
): Pick<AgentRunResumeOptions, "restoreHooks" | "restoreHookTimeoutMs"> {
  const hooks = [...(lifecycle.restoreHooks ?? []), ...(request.restoreHooks ?? [])];
  const timeoutMs = request.restoreHookTimeoutMs ?? lifecycle.restoreHookTimeoutMs;
  return {
    ...(hooks.length > 0 ? { restoreHooks: hooks } : {}),
    ...(timeoutMs === undefined ? {} : { restoreHookTimeoutMs: timeoutMs }),
  };
}

/** Host capability for durable agent status/resume. Adapters supply authorized ownership only. */
export function createAgentRunLifecycle(options: AgentRunLifecycleOptions): AgentRunLifecycle {
  return {
    async status(ref, request = {}) {
      request.signal?.throwIfAborted();
      const { state, record, metadata } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      request.signal?.throwIfAborted();
      return { state: publicState({ ...state, version: record.version }), version: record.version, ...(metadata ? { metadata } : {}) };
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
        signal: request.signal,
        persistSessionState: request.persistSessionState,
        includeSkillBodies: request.includeSkillBodies,
        ...(request.checkpointMetadata === undefined ? {} : { checkpointMetadata: request.checkpointMetadata }),
        ...restoreHookOptions(options, request),
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
        ...(request.checkpointMetadata === undefined ? {} : { checkpointMetadata: request.checkpointMetadata }),
        ...restoreHookOptions(options, request),
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
  throwIfAbortedSignal(options.signal);
  return executePreparedAgentRunResume(await prepareAgentRunResume(agent, ref, resume, options, options.signal), options.signal);
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
      readonly kind: "claim";
      readonly session: RuntimeAgentSession;
      readonly state: StoredAgentRunState;
      readonly runState: AgentRunStateOptions;
      readonly decisions?: ReadonlyMap<string, RunDecision>;
      readonly ownership?: OwnershipScope;
      /** Sidecar seed for writes after the claim when the run options configure no provider. */
      readonly checkpointMetadata?: AgentRunCheckpointMetadata;
      /** Audit of the restore hooks that ran before this claim; emitted on `agent_resumed`. */
      readonly restore?: CheckpointRestoreAudit;
    };

/**
 * A `continue` resume needs a run whose frontier is intact: a crash-recovery checkpoint
 * (`status: "running"`) or a clean run-end stop — a turn-policy stop or a stop-hook continuation
 * cap — which writes a terminal state that still carries the frontier (plan 084 Task 2, plan 106 R1).
 * Every other terminal state is final — a naturally finished run must never be resurrected.
 */
function isContinuableState(state: StoredAgentRunState): boolean {
  return (
    state.status === "running" ||
    (state.status === "succeeded" && (state.stopReason === "host_policy" || state.stopReason === "hook_limit"))
  );
}

async function prepareAgentRunResume(
  agent: Agent,
  ref: AgentRunRef,
  resume: AgentRunResume,
  options: AgentRunResumeOptions,
  signal?: AbortSignal,
): Promise<PreparedAgentRunResume> {
  throwIfAbortedSignal(signal);
  // Plan 020 Task 2: one shared shape assertion before any checkpoint read/write, agent
  // resolution, subscription, or tool execution. Unknown legacy decisions (e.g. "sideways")
  // and malformed untyped batches fail closed here instead of falling through to approval.
  assertValidAgentRunResume(resume);
  const continuing = resume.decision === "continue";
  const { record, state, metadata: recordMetadata } = await loadAgentRunState(options.checkpoints, ref, options.ownership);
  // Sidecar metadata: a resume-time source wins; otherwise the record's existing map is
  // preserved on every write below, so a non-durable resume cannot wipe it.
  const checkpointMetadata = resolveCheckpointMetadata(options.checkpointMetadata) ?? recordMetadata;
  if (
    state.definitionRevision !== options.definitionRevision ||
    state.agentId !== (agent.config.id ?? agent.config.name) ||
    state.fingerprint !== agentFingerprint(agent, options.definitionRevision)
  ) {
    throw new AgentRunStateError("Agent definition revision or fingerprint mismatch on resume");
  }
  if (record.version !== resume.expectedVersion || !(continuing ? isContinuableState(state) : state.status === "suspended")) {
    throw new AgentRunStateError(continuing ? "Stale or non-running agent run resume" : "Stale or non-suspended agent run resume");
  }
  // Crash recovery never bypasses a gate: only a running checkpoint with no unresolved work may
  // continue. A suspended state (tool approval, elicitation, input guardrail) requires a decision.
  if (continuing) {
    const pending = pendingDecisionsOf(state);
    const awaitingDispatch = state.pending?.status === "ready" || state.pendingCalls?.some((entry) => entry.status === "ready") === true;
    if (state.interruption !== undefined || (pending?.length ?? 0) > 0 || awaitingDispatch) {
      throw new AgentRunStateError("Continue resume requires a running checkpoint with no pending decisions");
    }
  }
  const session = new RuntimeAgentSession({ agent, id: state.sessionId, leafId: state.leafId });
  // Plan 078 Task 7: hand the reconstructed session to an observer (supervisor child-event pump)
  // before any event flows. Called for every resume outcome; a throw fails closed.
  options.onSession?.(session);
  // Plan 104 T2: pack enforcement rides the checkpoint. A run without `persistSessionState` never
  // writes the key, so its presence is the host's opt-in — restore before any turn (and before the
  // pending-decision block, which may re-run input guardrails) or fail closed on a pack mismatch.
  if (state.sessionState?.guardrailPacks) {
    session.restoreGuardrailPacks(state.sessionState.guardrailPacks.packs, state.sessionState.guardrailPacks.state);
  }
  // Opt-in session-state restore (plan 015 Task 4): names only; bodies re-resolve from
  // the live registry the next time the model (re)loads them via load_skill.
  if (options.persistSessionState && state.sessionState?.loadedSkillNames) {
    session.restoreLoadedSkills(state.sessionState.loadedSkillNames);
  }
  // Plan 041: re-add search-activated tool names (names only; absent tools stay inert until re-searched).
  if (options.persistSessionState && state.sessionState?.activatedToolNames) {
    session.restoreActivatedTools(state.sessionState.activatedToolNames);
  }
  // Plan 074 P3: restore sticky attention mutations (already validated at load) so the first
  // turn after a resume keeps its stubs instead of re-deciding them from the ratio.
  if (options.persistSessionState && state.sessionState?.attentionSticky) {
    const frontier = parseAttentionStickyFrontier(state.sessionState.attentionSticky);
    if (frontier) session.restoreAttentionSticky(frontier);
  }
  // Plan 086 T3: durable folding writes its own ledger (with the frontier it belongs to), so it
  // is restored whenever the checkpoint carries one — the `durable` opt-in was the host's
  // consent, and a run without it never has this key. Without the frontier the ledger's rows
  // would not be re-applied on an under-ratio turn, so the two ride together.
  if (state.sessionState?.attentionFold) {
    const ledger = restoreAttentionFoldLedger(state.sessionState.attentionFold);
    if (ledger) {
      session.restoreAttentionFold(ledger);
      if (!options.persistSessionState && state.sessionState.attentionSticky) {
        const frontier = parseAttentionStickyFrontier(state.sessionState.attentionSticky);
        if (frontier) session.restoreAttentionSticky(frontier);
      }
    }
  }
  // Plan 018 Task 6 (closeout `checkpoint-bodies`): restore exact instructions so the
  // resumed session renders them registry-independently (no load_skill round-trip).
  if (options.persistSessionState && options.includeSkillBodies && state.sessionState?.loadedSkillBodies) {
    session.restoreLoadedSkillBodies(state.sessionState.loadedSkillBodies);
  }
  const pendingDecisions = pendingDecisionsOf(state);
  // Plan 104 T6: pack rules revalidate modified arguments at decision time. The set is the session's
  // restored deny/tripwire rules plus its `ask` rules compiled as blocks — an approval that edits
  // arguments into *any* pack-violating state is refused instead of becoming a run-wide allowance.
  // Passed explicitly (never read from agent config), so a checkpoint that carried packs fails closed.
  const sessionGuardrails = { toolInput: [...(session.packGuardrails?.toolInput ?? []), ...(session.packAskBlocks?.toolInput ?? [])] };
  const decisionGuardrails = sessionGuardrails.toolInput.length > 0 ? sessionGuardrails : undefined;
  // Legacy approve maps to allow-once on every pending decision; legacy deny keeps its
  // terminal-denied behavior. Batch decisions are validated and applied atomically below.
  const resolved =
    resume.decisions !== undefined
      ? await resolveRunDecisions({ agent, state, decisions: resume.decisions, signal, guardrails: decisionGuardrails })
      : resume.decision === "approve" && pendingDecisions
        ? await resolveRunDecisions({
            agent,
            state,
            decisions: pendingDecisions.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
            signal,
            guardrails: decisionGuardrails,
          })
        : undefined;
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
      ...(checkpointMetadata ? { metadata: checkpointMetadata } : {}),
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
  // Plan 094 Task 3: restore external state (git commit, document versions) before the claim
  // write. Every hook must succeed — a throw here leaves the checkpoint exactly as it was, and
  // the conversation restore below never runs, so no half-restored world is claimed as resumed.
  const restoreHooks = options.restoreHooks ?? [];
  const restore = restoreHooks.length
    ? await runCheckpointRestoreHooks(
        restoreHooks,
        {
          runId: state.runId,
          sessionId: state.sessionId,
          version: record.version,
          status: state.status,
          ...(recordMetadata ? { metadata: recordMetadata } : {}),
          checkpoint: record,
        },
        { timeoutMs: options.restoreHookTimeoutMs, signal, redactor: agent.config.redactor },
      )
    : undefined;
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
    ...(checkpointMetadata ? { metadata: checkpointMetadata } : {}),
  });
  return {
    kind: "claim",
    session,
    state: claimed.state,
    decisions: resolved?.decisionsById,
    ownership: options.ownership,
    // The configured object must be passed by identity (agent-session assemble rejects a
    // replaced config); its own `checkpointMetadata` provider wins, and the resolved map rides
    // the session as a seed so later writes preserve a record's existing sidecar.
    runState: configured ?? {
      checkpoints: options.checkpoints,
      definitionRevision: options.definitionRevision,
      interruptBeforeTool: state.interruptBeforeTool,
      fencingToken: options.fencingToken,
      resumeNestedRun: options.resumeNestedRun,
      // The checkpoint records its own cadence (plan 084 Task 1), so a continued run keeps writing
      // turn checkpoints without the host repeating the option on resume.
      ...(state.checkpointPolicy ? { checkpointPolicy: state.checkpointPolicy } : {}),
    },
    ...(checkpointMetadata ? { checkpointMetadata } : {}),
    ...(restore ? { restore } : {}),
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
  return prepared.session.resumeDurable(prepared.state, prepared.runState, prepared.ownership, signal, prepared.decisions, {
    ...(prepared.checkpointMetadata ? { checkpointMetadata: prepared.checkpointMetadata } : {}),
    ...(prepared.restore ? { restore: prepared.restore } : {}),
  });
}
