import {
  AgentDelegationSuspendedError,
  type AgentEvent,
  AgentRunError,
  type AgentRunResult,
  type AgentSession,
  assertIdentityActive,
  assertIdentityMatchesOwnership,
  assertIdentityPropagation,
  type BudgetAxisUsage,
  type BudgetConsumedCounters,
  createAgent,
  createEventMultiplexer,
  type NestedRunOutcome,
  narrowIdentity,
  type PermissionPolicy,
  type PermissionRequest,
  type ResumeNestedRun,
  resumeAgentRun,
  type RunLimitBreach,
  type SecretRedactor,
  type ToolCallSummary,
  type Usage,
} from "@arnilo/prism";
import { SupervisorDeniedError, SupervisorError, SupervisorLimitError, SupervisorValidationError } from "./errors.js";
import {
  HARD_MILESTONE_EVERY_TURNS,
  narrowSupervisorLimits,
  type ResolvedSupervisorLimits,
  resolveSupervisorLimits,
  type SupervisorLimits,
} from "./limits.js";
import type {
  ChildReportPolicy,
  CreateSupervisorOptions,
  DelegationCompletion,
  DelegationHandle,
  DelegationRequest,
  DelegationWaitOptions,
  DelegationWaitResult,
  Supervisor,
  SupervisorChild,
  SupervisorChildOutcome,
  SupervisorEvent,
  SupervisorMilestonePolicy,
  SupervisorRunSummary,
} from "./types.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
interface ChainContext {
  readonly path: readonly string[];
  /** Ancestor delegation ids (oldest first); absent for a top-level delegation. */
  readonly parents?: readonly string[];
  readonly signal?: AbortSignal;
}

interface DelegationLaunch {
  readonly delegationId: string;
  readonly controller: AbortController;
  /** True only for `delegateAsync` launches; session-lifetime children require it. */
  readonly background?: boolean;
}

interface RunningDelegation {
  readonly controller: AbortController;
  readonly promise: Promise<AgentRunResult>;
  cancelled: boolean;
}

type CompletedDelegation =
  | { readonly result: AgentRunResult }
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly error: unknown };

/** Live delegation bookkeeping for `summary().failureRadius`; deleted on settle. */
interface LiveDelegation {
  readonly childId: string;
  /** Ancestor delegation ids plus this delegation's own id (oldest first). */
  readonly chain: readonly string[];
}

/** Mutable per-child counters behind `summary()`; frozen on read. */
interface ChildCounters {
  attempts: number;
  retries: number;
  failures: number;
  failureRadius: number;
  outcome: SupervisorChildOutcome;
}

/** Extra fields a `child_failed` event carries when the child produced a terminal result. */
type ChildFailureAttribution = {
  readonly reason: string;
  readonly status?: AgentRunResult["status"];
  readonly limit?: RunLimitBreach;
  readonly stopReason?: AgentRunResult["stopReason"];
  readonly usage?: Usage;
  /** Copied from `result.attribution` on a ceiling death (plan 108 T5); the breach stays in `limit`. */
  readonly consumed?: BudgetConsumedCounters;
  readonly closestOtherAxes?: readonly BudgetAxisUsage[];
  readonly recentToolCalls?: readonly ToolCallSummary[];
};

const DELEGATION_NAMESPACE = "prism.supervisor-delegation";

/**
 * BUG-2 guard (integration findings): a child factory returning a session
 * (or anything non-Agent) used to crash at `.config.permission` with a cryptic
 * TypeError. One shared shape check at both factory-result consumption sites;
 * constructor name ("AgentSession", "Object", ...) names the received type.
 */
function assertChildAgent(value: unknown, childId: string): void {
  const candidate = value as { config?: unknown; createSession?: unknown } | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !candidate.config ||
    typeof candidate.config !== "object" ||
    typeof candidate.createSession !== "function"
  ) {
    const name =
      value === null || value === undefined
        ? String(value)
        : typeof value === "object" || typeof value === "function"
          ? ((value as { constructor?: { name?: unknown } }).constructor?.name ?? typeof value)
          : typeof value;
    throw new SupervisorError(`child "${childId}" factory must return an Agent, got ${name}`);
  }
}

/** Milestone subset for v1 child-event passthrough (tool calls + run start/finish). */
const MILESTONE_CHILD_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "agent_started",
  "agent_finished",
  "agent_suspended",
  "agent_denied",
  "tool_execution_started",
  "tool_execution_finished",
  "tool_execution_error",
  "tool_execution_blocked",
]);

/** `report: "stream"` forwards the milestone subset plus per-turn provider/tool lifecycle (never per-token deltas). */
const PASSTHROUGH_CHILD_EVENT_TYPES: ReadonlySet<AgentEvent["type"]> = new Set([
  ...MILESTONE_CHILD_EVENT_TYPES,
  "turn_started",
  "turn_finished",
  "provider_turn_started",
  "provider_turn_finished",
]);

/** FEATURE-4: wrap a child session subscribe with filter + redact + cap + rate coalescing + tag. */
const REPORT_RANK: Readonly<Record<ChildReportPolicy, number>> = { "on-complete": 0, milestones: 1, stream: 2 };

interface ResolvedChildPolicy {
  readonly lifetime: "task" | "session";
  readonly report: ChildReportPolicy;
  readonly milestone: SupervisorMilestonePolicy;
  readonly budgetShare?: number;
}

/**
 * Host child policy is the ceiling; a request may only narrow it. Session lifetime is a
 * capability, not a verbosity knob: requesting it without host enablement fails closed.
 */
function resolveChildPolicy(child: SupervisorChild, request: DelegationRequest, childEvents: boolean): ResolvedChildPolicy {
  const host = child.policy ?? {};
  const fallback = childEvents ? "stream" : "on-complete";
  const requested = request.report ?? host.report ?? fallback;
  if (!(requested in REPORT_RANK)) throw new SupervisorValidationError("report must be on-complete, milestones, or stream");
  const ceiling = host.report ?? fallback;
  const report = REPORT_RANK[requested] > REPORT_RANK[ceiling] ? ceiling : requested;
  const lifetime = request.lifetime ?? "task";
  if (lifetime !== "task" && lifetime !== "session") throw new SupervisorValidationError("lifetime must be task or session");
  if (lifetime === "session" && host.lifetime !== "session") throw new SupervisorDeniedError("Child does not allow session lifetime");
  const hostEveryTurns = host.milestone?.everyTurns;
  const requestEveryTurns = request.milestone?.everyTurns;
  // Host cadence is a ceiling on chattiness: a request may only report less often.
  const everyTurns =
    hostEveryTurns === undefined
      ? requestEveryTurns
      : requestEveryTurns === undefined
        ? hostEveryTurns
        : Math.max(hostEveryTurns, requestEveryTurns);
  if (everyTurns !== undefined && (!Number.isSafeInteger(everyTurns) || everyTurns < 1 || everyTurns > HARD_MILESTONE_EVERY_TURNS)) {
    throw new SupervisorValidationError(`milestone.everyTurns must be a positive integer at most ${HARD_MILESTONE_EVERY_TURNS}`);
  }
  for (const share of [request.budgetShare, host.budgetShare]) {
    if (share !== undefined && (!Number.isFinite(share) || share <= 0 || share > 1)) {
      throw new SupervisorValidationError("budgetShare must be a number greater than 0 and at most 1");
    }
  }
  const budgetShare =
    host.budgetShare === undefined
      ? request.budgetShare
      : request.budgetShare === undefined
        ? host.budgetShare
        : Math.min(request.budgetShare, host.budgetShare);
  const predicate = request.milestone?.predicate ?? host.milestone?.predicate;
  return Object.freeze({
    lifetime,
    report,
    milestone: Object.freeze({ ...(everyTurns !== undefined ? { everyTurns } : {}), ...(predicate ? { predicate } : {}) }),
    ...(budgetShare !== undefined ? { budgetShare } : {}),
  });
}

/** Scale the budget axes a share applies to; `narrowSupervisorLimits` still clamps to the parent. */
function scaledLimits(parent: ResolvedSupervisorLimits, share: number): SupervisorLimits {
  return {
    maxSteps: Math.max(1, Math.floor(parent.maxSteps * share)),
    maxToolCalls: Math.max(1, Math.floor(parent.maxToolCalls * share)),
    maxTokens: Math.max(1, Math.floor(parent.maxTokens * share)),
    timeoutMs: Math.max(1, Math.floor(parent.timeoutMs * share)),
  };
}

function startChildEventPump(
  session: AgentSession,
  tags: { readonly childId: string; readonly delegationId: string; readonly depth: number },
  limits: ResolvedSupervisorLimits,
  policy: ResolvedChildPolicy,
  redactor: SecretRedactor | undefined,
  publish: (event: SupervisorEvent) => void,
  sink: ((event: AgentEvent) => void) | undefined,
): () => Promise<void> {
  const iterator = session.subscribe()[Symbol.asyncIterator]();
  const stream = policy.report === "stream";
  const { everyTurns, predicate } = policy.milestone;
  // `report: "milestones"` with no cadence still reports the milestone event subset.
  const defaultMilestones = !stream && everyTurns === undefined && predicate === undefined;
  let emitted = 0;
  let capped = false;
  let turn = 0;
  let windowStart = 0;
  let windowCount = 0;
  let coalesced = 0;

  const notifyCoalesced = () => {
    if (coalesced === 0) return;
    publish({
      type: "delegation_child_events_coalesced",
      ...tags,
      dropped: coalesced,
      maxChildEventsPerSecond: limits.maxChildEventsPerSecond,
    });
    coalesced = 0;
  };

  const emit = (event: AgentEvent): void => {
    const payload = redactor ? redactor.redact(event) : event;
    if (emitted >= limits.maxChildEventsPerDelegation || JSON.stringify(payload).length > limits.maxChildEventBytes) {
      capped = true;
      publish({ type: "delegation_child_events_capped", ...tags, maxChildEvents: limits.maxChildEventsPerDelegation });
      return;
    }
    const now = Date.now();
    if (now - windowStart >= 1_000) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= limits.maxChildEventsPerSecond) {
      coalesced += 1;
      return;
    }
    notifyCoalesced();
    windowCount += 1;
    emitted += 1;
    // Task 3: one tagged projection serves both the supervisor stream and the host's parent-stream sink.
    const tagged: AgentEvent = { ...payload, child: { childId: tags.childId, delegationId: tags.delegationId, depth: tags.depth } };
    publish(
      stream
        ? { type: "delegation_child_event", ...tags, childEvent: tagged }
        : { type: "child_milestone", ...tags, turn, childEvent: tagged },
    );
    if (!sink) return;
    try {
      sink(tagged);
    } catch {
      // Parent-stream routing is advisory and must not stop the pump.
    }
  };

  const pump = (async () => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        const event = next.value;
        if (capped) continue;
        if (event.type === "turn_started") turn = event.turn;
        if (stream) {
          if (PASSTHROUGH_CHILD_EVENT_TYPES.has(event.type)) emit(event);
          continue;
        }
        if (event.type === "turn_started" && everyTurns !== undefined && event.turn % everyTurns === 0) {
          emit(event);
          continue;
        }
        if (predicate?.(event) === true) {
          emit(event);
          continue;
        }
        if (defaultMilestones && MILESTONE_CHILD_EVENT_TYPES.has(event.type)) emit(event);
      }
    } catch {
      // subscriber closed with the delegation
    }
    if (!capped) notifyCoalesced();
  })();
  return async () => {
    await iterator.return?.();
    await pump;
  };
}

/** Durable mapping that lets `resumeNestedRun` rebuild a suspended child after a restart. */
interface DelegationMapping {
  readonly childId: string;
  readonly delegationId: string;
  readonly threadId: string;
  readonly path: readonly string[];
  /** Ancestor delegation ids (oldest first), so a resumed rebuild can rebuild the chain. */
  readonly parents?: readonly string[];
  readonly version: number;
  /** Redacted delegation input, needed to re-run the before-hook at resume. */
  readonly input: string;
  /** Effective spawn policy, replayed so a rebuild keeps the same reporting/budget share. */
  readonly report?: ChildReportPolicy;
  readonly everyTurns?: number;
  readonly budgetShare?: number;
}

export function createSupervisor(options: CreateSupervisorOptions): Supervisor {
  requireOwnership(options.ownership);
  if (options.checkpoints && !options.definitionRevision?.trim()) {
    throw new SupervisorValidationError("definitionRevision is required when checkpoints are configured");
  }
  if (options.identity) {
    assertIdentityActive(options.identity);
    assertIdentityMatchesOwnership(options.identity, options.ownership);
  }
  const id = options.id ?? "supervisor";
  if (!ID.test(id)) throw new SupervisorValidationError("Supervisor id is invalid");
  const children = Object.entries(options.children);
  if (children.length === 0) throw new SupervisorValidationError("At least one child is required");
  for (const [childId] of children) if (!ID.test(childId)) throw new SupervisorValidationError(`Invalid child id: ${childId}`);
  const baseLimits = resolveSupervisorLimits(options.limits);
  const events = createEventMultiplexer<SupervisorEvent>({
    maxQueuedEvents: baseLimits.maxQueuedEvents,
    overflow: "drop_oldest",
    // Session end closes the stream; each running controller is linked to the same signal below.
    signal: options.signal,
  });
  let activeChildren = 0;
  let sequence = 0;
  const runningDelegations = new Map<string, RunningDelegation>();
  const completedDelegations = new Map<string, CompletedDelegation>();
  const liveDelegations = new Map<string, LiveDelegation>();
  const childCounters = new Map<string, ChildCounters>(
    children.map(([childId]) => [childId, { attempts: 0, retries: 0, failures: 0, failureRadius: 0, outcome: "idle" }]),
  );

  function noteDelegationStart(childId: string, delegationId: string, parents?: readonly string[]): void {
    const counters = childCounters.get(childId);
    if (counters) {
      // A re-dispatch after failure/abort is a recovery attempt; resuming a suspended run is not.
      if (counters.outcome === "failed" || counters.outcome === "aborted") counters.retries += 1;
      counters.attempts += 1;
      counters.outcome = "running";
    }
    liveDelegations.set(delegationId, { childId, chain: Object.freeze([...(parents ?? []), delegationId]) });
  }

  /**
   * Live-delegation entry behind `failureRadius`/`hasLiveDelegation`: added when a delegation
   * starts — including a resume, so a fresh instance counts a delegation that was live across the
   * restart — and removed when it settles. A resumed id is re-based in `resumeNestedRun` before it
   * can collide, but if one still is taken the running delegation keeps its entry: displacing it
   * would lose a live delegation's ancestry, while the resumed one degrades to pre-resume behavior.
   */
  function noteLiveDelegation(childId: string, delegationId: string, parents?: readonly string[]): void {
    if (liveDelegations.has(delegationId)) return;
    liveDelegations.set(delegationId, { childId, chain: Object.freeze([...(parents ?? []), delegationId]) });
  }

  function hasLiveDelegation(childId: string): boolean {
    for (const live of liveDelegations.values()) if (live.childId === childId) return true;
    return false;
  }

  /**
   * Blast radius: task-lifetime descendants still live when this delegation failed. Nested
   * session lifetime is unreachable (`context.delegate` is synchronous), so every live
   * descendant is an affected one. Ancestry is the delegation-id chain, unique per delegation,
   * so concurrent delegations of the same child id stay distinct.
   */
  function countLiveDescendants(delegationId: string): number {
    let count = 0;
    // The settled delegation is already deleted, so a chain never matches itself.
    for (const live of liveDelegations.values()) if (live.chain.includes(delegationId)) count += 1;
    return count;
  }

  /**
   * Single terminal seam for per-child counters and `child_failed` attribution: terminal
   * status plus the plan-086/087 `RunLimitBreach` when the run reported one. Call before the
   * terminal `delegation_error` so consumers stopping at it still see why the child died.
   */
  function settleDelegation(
    childId: string,
    delegationId: string,
    depth: number,
    outcome: SupervisorChildOutcome,
    failure?: ChildFailureAttribution,
  ): void {
    liveDelegations.delete(delegationId);
    const counters = childCounters.get(childId);
    if (counters) {
      if (failure) {
        counters.failures += 1;
        counters.failureRadius += countLiveDescendants(delegationId);
      }
      counters.outcome = hasLiveDelegation(childId) ? "running" : outcome;
    }
    if (failure) {
      events.publish({
        type: "child_failed",
        childId,
        delegationId,
        depth,
        reason: failure.reason,
        ...(failure.status !== undefined ? { status: failure.status } : {}),
        ...(failure.limit !== undefined ? { limit: failure.limit } : {}),
        ...(failure.stopReason !== undefined ? { stopReason: failure.stopReason } : {}),
        ...(failure.usage !== undefined ? { usage: failure.usage } : {}),
        ...(failure.consumed !== undefined ? { consumed: failure.consumed } : {}),
        ...(failure.closestOtherAxes !== undefined ? { closestOtherAxes: failure.closestOtherAxes } : {}),
        ...(failure.recentToolCalls !== undefined ? { recentToolCalls: failure.recentToolCalls } : {}),
      });
    }
  }

  function childSummary(childId: string): SupervisorRunSummary["children"][number] {
    const counters = childCounters.get(childId);
    return Object.freeze({
      childId,
      attempts: counters?.attempts ?? 0,
      retries: counters?.retries ?? 0,
      failures: counters?.failures ?? 0,
      failureRadius: counters?.failureRadius ?? 0,
      outcome: counters?.outcome ?? ("idle" as const),
    });
  }

  async function delegate(
    request: DelegationRequest,
    chain: ChainContext = { path: [] },
    launch?: DelegationLaunch,
  ): Promise<AgentRunResult> {
    const child = options.children[request.childId];
    if (!child) throw new SupervisorDeniedError("Child is not allow-listed");
    if (chain.path.includes(request.childId)) throw new SupervisorLimitError("Delegation cycle detected");
    const depth = chain.path.length + 1;
    const policy = resolveChildPolicy(child, request, options.childEvents === true);
    if (policy.lifetime === "session" && launch?.background !== true) {
      throw new SupervisorValidationError('Session-lifetime children must be started with delegateAsync (mode: "async")');
    }
    let limits = narrowSupervisorLimits(narrowSupervisorLimits(baseLimits, child.limits), request.limits);
    if (policy.budgetShare !== undefined) limits = narrowSupervisorLimits(limits, scaledLimits(limits, policy.budgetShare));
    if (depth > limits.maxDepth) throw new SupervisorLimitError("Delegation depth exceeded");
    const childIdentity =
      options.identity && child.scopes !== undefined ? narrowIdentity(options.identity, { scopes: child.scopes }) : options.identity;
    if (options.identity && childIdentity) assertIdentityPropagation(options.identity, childIdentity);
    let input = options.redactor?.redact(request.input) ?? request.input;
    assertBytes(input, limits.maxMessageBytes, "Delegation input");
    let reserved = false;
    const reserve = () => {
      if (activeChildren >= limits.maxActiveChildren) throw new SupervisorLimitError("Active child limit exceeded");
      activeChildren += 1;
      reserved = true;
    };
    if (!options.hooks?.before) reserve();

    const delegationId = launch?.delegationId ?? `${id}-${++sequence}`;
    const path = Object.freeze([...chain.path, request.childId]);
    const controller = launch?.controller ?? new AbortController();
    // Session-lifetime children detach from the caller (and ancestor child) signal; only the
    // supervisor session signal ends them.
    const disposeSignals =
      policy.lifetime === "session"
        ? linkSignals(controller, options.signal)
        : linkSignals(controller, request.signal, chain.signal, options.signal);
    let timer = setTimeout(() => controller.abort(new SupervisorLimitError("Delegation timeout exceeded")), limits.timeoutMs);
    let completionSent = false;
    // Kept across the limit-to-SupervisorLimitError translation so the catch below can still
    // publish structured plan-087 attribution (the conversion drops `error.result`).
    let limitedResult: AgentRunResult | undefined;
    noteDelegationStart(request.childId, delegationId, chain.parents);

    try {
      let hookPermission: PermissionPolicy | undefined;
      if (options.hooks?.before) {
        const decision = await abortable(
          Promise.resolve(
            options.hooks.before(
              Object.freeze({
                childId: request.childId,
                delegationId,
                depth,
                path,
                input,
                limits,
                metadata: options.redactor?.redact(request.metadata) ?? request.metadata,
                signal: controller.signal,
              }),
            ),
          ),
          controller.signal,
        );
        if (decision.allowed === false) {
          const reason = safeError(decision.reason ?? "Delegation denied", options);
          events.publish({ type: "delegation_rejected", childId: request.childId, delegationId, depth, reason });
          await complete({ childId: request.childId, delegationId, depth, status: "rejected", text: "", error: reason });
          completionSent = true;
          settleDelegation(request.childId, delegationId, depth, "rejected");
          throw new SupervisorDeniedError(reason);
        }
        limits = narrowSupervisorLimits(limits, decision.limits);
        if (depth > limits.maxDepth) throw new SupervisorLimitError("Delegation depth exceeded");
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new SupervisorLimitError("Delegation timeout exceeded")), limits.timeoutMs);
        hookPermission = decision.permission;
        if (decision.input !== undefined) input = options.redactor?.redact(decision.input) ?? decision.input;
        assertBytes(input, limits.maxMessageBytes, "Delegation input");
      }

      if (!reserved) reserve();

      const resourceId = `${id}/${delegationId}/${request.childId}`;
      const threadId = `${resourceId}/${encodeURIComponent(request.threadId ?? "default")}`;
      const preliminaryPermission = intersectPolicies(
        options.permission,
        child.permission,
        hookPermission,
        toolBudgetPolicy(limits.maxToolCalls),
      );
      events.publish({ type: "delegation_started", childId: request.childId, delegationId, depth, resourceId, threadId });
      const childAgent = await abortable(
        Promise.resolve(
          child.createAgent(
            Object.freeze({
              childId: request.childId,
              delegationId,
              depth,
              path,
              ownership: options.ownership,
              identity: childIdentity,
              effectStore: options.effectStore,
              resourceId,
              threadId,
              permission: preliminaryPermission,
              signal: controller.signal,
              delegate: (nested: DelegationRequest) =>
                delegate(nested, {
                  path,
                  parents: [...(chain.parents ?? []), delegationId],
                  signal: controller.signal,
                }),
            }),
          ),
        ),
        controller.signal,
      );
      assertChildAgent(childAgent, request.childId);
      const agent = createAgent({
        ...childAgent.config,
        permission: intersectPolicies(preliminaryPermission, childAgent.config.permission),
        ownership: options.ownership,
        identity: childIdentity ?? childAgent.config.identity,
        effectStore: options.effectStore ?? childAgent.config.effectStore,
        redactor: options.redactor ?? childAgent.config.redactor,
      });
      const session = agent.createSession({
        id: `${delegationId}-session`,
        metadata: { supervisorId: id, delegationId, resourceId, threadId },
      });
      const stopChildEvents =
        policy.report === "on-complete"
          ? undefined
          : startChildEventPump(
              session,
              { childId: request.childId, delegationId, depth },
              limits,
              policy,
              options.redactor,
              (event) => events.publish(event),
              options.childEventSink,
            );
      let result: AgentRunResult;
      try {
        result = await abortable(
          session.run(input, {
            signal: controller.signal,
            limits: {
              maxToolRounds: limits.maxSteps,
              maxToolCalls: limits.maxToolCalls,
              maxTotalTokens: limits.maxTokens,
              maxWallTimeMs: limits.timeoutMs,
            },
            ownership: options.ownership,
            redactor: options.redactor,
            metadata: { ...request.metadata, supervisorId: id, delegationId, resourceId, threadId, depth },
            ...(options.checkpoints
              ? {
                  runState: {
                    checkpoints: options.checkpoints,
                    definitionRevision: options.definitionRevision!,
                    interruptBeforeTool: true,
                    resumeNestedRun,
                  },
                }
              : {}),
          }),
          controller.signal,
        );
      } catch (error) {
        if (error instanceof AgentRunError && error.result.limit) {
          limitedResult = error.result;
          const label =
            error.result.limit.limit === "maxTotalTokens"
              ? "token"
              : error.result.limit.limit === "maxToolCalls"
                ? "tool-call"
                : error.result.limit.limit === "maxWallTimeMs"
                  ? "timeout"
                  : "run";
          // The child's terminal result travels with the error: a host that catches it reads the
          // same `limit`/`attribution` the `child_failed` event carries, matching the plain-failure
          // path, which rethrows the child's `AgentRunError` (and its `result`) as-is.
          throw new SupervisorLimitError(`Delegation ${label} limit exceeded`, error.result);
        }
        throw error;
      } finally {
        await stopChildEvents?.();
      }
      if (result.status === "suspended") {
        // Child approvals surface on the hosting root run: persist the rebuild mapping, then
        // signal core with the child's pending decisions (core hashes/attributes the ids).
        const pending = result.interruption?.pendingDecisions;
        const version = result.runState?.version;
        if (!pending?.length || version === undefined) {
          throw new SupervisorError("Child run suspended without a pending-decision set");
        }
        await saveMapping(result.runId, {
          childId: request.childId,
          delegationId,
          threadId,
          path,
          ...(chain.parents?.length ? { parents: chain.parents } : {}),
          version,
          input,
          ...(policy.report !== "on-complete" ? { report: policy.report } : {}),
          ...(policy.milestone.everyTurns !== undefined ? { everyTurns: policy.milestone.everyTurns } : {}),
          ...(policy.budgetShare !== undefined ? { budgetShare: policy.budgetShare } : {}),
        });
        throw new AgentDelegationSuspendedError({ runId: result.runId, sessionId: result.sessionId }, pending, path);
      }
      const totalTokens = result.usage?.totalTokens ?? (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      settleDelegation(
        request.childId,
        delegationId,
        depth,
        result.status,
        result.status === "failed"
          ? failureAttribution(result, safeError(result.error?.message ?? "Delegated run failed", options))
          : undefined,
      );
      events.publish({ type: "delegation_finished", childId: request.childId, delegationId, depth, status: result.status, totalTokens });
      await complete(toCompletion(result, request.childId, delegationId, depth, options));
      completionSent = true;
      return result;
    } catch (error) {
      if (error instanceof AgentDelegationSuspendedError) throw error;
      if (!(error instanceof SupervisorDeniedError && completionSent)) {
        const result = error instanceof AgentRunError ? error.result : limitedResult;
        const message = safeError(error, options);
        // A failure died on an error or a limit. Host cancels/aborts and policy denials are not
        // failures; a supervisor-level timeout is (its abort reason is a SupervisorLimitError).
        const abortedByHost = controller.signal.aborted && !(controller.signal.reason instanceof SupervisorLimitError);
        const failed =
          !abortedByHost && !(error instanceof SupervisorDeniedError) && result?.status !== "denied" && result?.status !== "succeeded";
        settleDelegation(
          request.childId,
          delegationId,
          depth,
          failed ? "failed" : (result?.status ?? (controller.signal.aborted ? "aborted" : "rejected")),
          failed ? failureAttribution(result, message) : undefined,
        );
        events.publish({ type: "delegation_error", childId: request.childId, delegationId, depth, error: message });
        await complete(
          result
            ? toCompletion(result, request.childId, delegationId, depth, options)
            : {
                childId: request.childId,
                delegationId,
                depth,
                status: controller.signal.aborted ? "aborted" : "rejected",
                text: "",
                error: message,
              },
        );
      }
      if (error instanceof AgentRunError || error instanceof SupervisorError) throw error;
      throw new SupervisorError(safeError(error, options));
    } finally {
      clearTimeout(timer);
      disposeSignals();
      if (reserved) activeChildren -= 1;
    }
  }

  async function delegateAsync(request: DelegationRequest): Promise<DelegationHandle> {
    const child = options.children[request.childId];
    if (!child) throw new SupervisorDeniedError("Child is not allow-listed");
    // Fail closed on invalid policy before returning a handle the host cannot reason about.
    const policy = resolveChildPolicy(child, request, options.childEvents === true);
    // Avoid returning a misleading running handle for an immediately-full, no-hook supervisor.
    if (!options.hooks?.before) {
      let limits = narrowSupervisorLimits(narrowSupervisorLimits(baseLimits, child.limits), request.limits);
      if (policy.budgetShare !== undefined) limits = narrowSupervisorLimits(limits, scaledLimits(limits, policy.budgetShare));
      if (activeChildren >= limits.maxActiveChildren) throw new SupervisorLimitError("Active child limit exceeded");
    }
    const delegationId = `${id}-${++sequence}`;
    const controller = new AbortController();
    const promise = delegate(request, { path: [] }, { delegationId, controller, background: true });
    const running: RunningDelegation = { controller, promise, cancelled: false };
    runningDelegations.set(delegationId, running);
    void promise.then(
      (result) => finishAsyncDelegation(delegationId, { result }),
      (error) => finishAsyncDelegation(delegationId, running.cancelled ? { cancelled: true } : { cancelled: false, error }),
    );
    return { delegationId, status: "running" };
  }

  function finishAsyncDelegation(delegationId: string, terminal: CompletedDelegation): void {
    runningDelegations.delete(delegationId);
    completedDelegations.delete(delegationId);
    completedDelegations.set(delegationId, terminal);
    while (completedDelegations.size > baseLimits.maxQueuedEvents) {
      const oldest = completedDelegations.keys().next().value;
      if (oldest === undefined) break;
      completedDelegations.delete(oldest);
    }
  }

  async function wait(delegationId: string, waitOptions?: DelegationWaitOptions): Promise<DelegationWaitResult> {
    const terminal = completedDelegations.get(delegationId);
    if (terminal) return terminalResult(delegationId, terminal);
    const running = runningDelegations.get(delegationId);
    if (!running) throw new SupervisorDeniedError("Unknown async delegation");
    try {
      return await waitFor(running.promise, waitOptions?.signal, baseLimits.timeoutMs);
    } catch (error) {
      if (running.cancelled) return { delegationId, status: "cancelled" };
      throw error;
    }
  }

  function cancel(delegationId: string): boolean {
    const running = runningDelegations.get(delegationId);
    if (!running) {
      if (completedDelegations.has(delegationId)) return false;
      throw new SupervisorDeniedError("Unknown async delegation");
    }
    running.cancelled = true;
    running.controller.abort(new SupervisorError("Async delegation cancelled"));
    return true;
  }

  async function saveMapping(runId: string, mapping: DelegationMapping): Promise<void> {
    const existing = await options.checkpoints!.loadCheckpoint({ namespace: DELEGATION_NAMESPACE, key: runId });
    await options.checkpoints!.saveCheckpoint({
      namespace: DELEGATION_NAMESPACE,
      key: runId,
      version: (existing?.version ?? 0) + 1,
      expectedVersion: existing?.version,
      value: mapping,
    });
  }

  const resumeNestedRun: ResumeNestedRun = async (nested, decisions): Promise<NestedRunOutcome> => {
    const checkpoints = options.checkpoints;
    if (!checkpoints || !options.definitionRevision) {
      throw new SupervisorValidationError("Nested-run resume requires supervisor checkpoints and definitionRevision");
    }
    const record = await checkpoints.loadCheckpoint({ namespace: DELEGATION_NAMESPACE, key: nested.ref.runId });
    const mapping = record?.value as DelegationMapping | undefined;
    // Non-enumerating: unknown and foreign run ids share one error.
    if (!mapping || typeof mapping.childId !== "string" || typeof mapping.version !== "number") {
      throw new SupervisorDeniedError("Unknown delegated run");
    }
    const child = options.children[mapping.childId];
    if (!child) throw new SupervisorDeniedError("Unknown delegated run");
    // A fresh instance numbers delegations from `-1` again, so seed the counter from the resumed
    // id: a delegation started after this resume cannot take a suspended delegation's id.
    const resumedIndex = Number(mapping.delegationId.slice(id.length + 1));
    if (mapping.delegationId.startsWith(`${id}-`) && Number.isSafeInteger(resumedIndex)) {
      sequence = Math.max(sequence, resumedIndex);
    }
    const childIdentity =
      options.identity && child.scopes !== undefined ? narrowIdentity(options.identity, { scopes: child.scopes }) : options.identity;
    if (options.identity && childIdentity) assertIdentityPropagation(options.identity, childIdentity);
    const depth = mapping.path.length;
    const controller = new AbortController();
    const disposeResumeSignals = linkSignals(controller, options.signal);
    // Replay the persisted spawn policy; legacy mappings keep the supervisor-wide default.
    const resumePolicy: ResolvedChildPolicy = Object.freeze({
      lifetime: "task",
      report: mapping.report ?? (options.childEvents === true ? "stream" : "on-complete"),
      milestone: Object.freeze({
        ...(mapping.everyTurns !== undefined ? { everyTurns: mapping.everyTurns } : {}),
        ...(child.policy?.milestone?.predicate ? { predicate: child.policy.milestone.predicate } : {}),
      }),
      ...(mapping.budgetShare !== undefined ? { budgetShare: mapping.budgetShare } : {}),
    });
    let limits = narrowSupervisorLimits(baseLimits, child.limits);
    if (mapping.budgetShare !== undefined) limits = narrowSupervisorLimits(limits, scaledLimits(limits, mapping.budgetShare));
    let hookPermission: PermissionPolicy | undefined;
    let stopChildEvents: (() => Promise<void>) | undefined;
    // The before-hook re-runs at resume so its narrowing applies exactly as it did to the
    // original run; hooks must be idempotent (same contract as core resume guardrails).
    if (options.hooks?.before) {
      const decision = await options.hooks.before(
        Object.freeze({
          childId: mapping.childId,
          delegationId: mapping.delegationId,
          depth,
          path: mapping.path,
          input: mapping.input,
          limits,
          metadata: undefined,
          signal: controller.signal,
        }),
      );
      if (decision.allowed === false) {
        // Resume parity with live delegate(): a denied rebuild is a terminal rejection.
        const reason = safeError(decision.reason ?? "Delegation denied", options);
        events.publish({
          type: "delegation_rejected",
          childId: mapping.childId,
          delegationId: mapping.delegationId,
          depth,
          reason,
        });
        await complete({
          childId: mapping.childId,
          delegationId: mapping.delegationId,
          depth,
          status: "rejected",
          text: "",
          error: reason,
        });
        disposeResumeSignals();
        settleDelegation(mapping.childId, mapping.delegationId, depth, "rejected");
        return { status: "failed", code: "delegation_denied", message: reason };
      }
      limits = narrowSupervisorLimits(limits, decision.limits);
      hookPermission = decision.permission;
    }
    const resourceId = `${id}/${mapping.delegationId}/${mapping.childId}`;
    const permission = intersectPolicies(options.permission, child.permission, hookPermission, toolBudgetPolicy(limits.maxToolCalls));
    const childAgent = await child.createAgent(
      Object.freeze({
        childId: mapping.childId,
        delegationId: mapping.delegationId,
        depth,
        path: mapping.path,
        ownership: options.ownership,
        identity: childIdentity,
        effectStore: options.effectStore,
        resourceId,
        threadId: mapping.threadId,
        permission,
        signal: controller.signal,
        delegate: (nestedRequest: DelegationRequest) =>
          delegate(nestedRequest, {
            path: mapping.path,
            parents: [...(mapping.parents ?? []), mapping.delegationId],
            signal: controller.signal,
          }),
      }),
    );
    assertChildAgent(childAgent, mapping.childId);
    const agent = createAgent({
      ...childAgent.config,
      permission: intersectPolicies(permission, childAgent.config.permission),
      ownership: options.ownership,
      identity: childIdentity ?? childAgent.config.identity,
      effectStore: options.effectStore ?? childAgent.config.effectStore,
      redactor: options.redactor ?? childAgent.config.redactor,
    });
    let result: AgentRunResult;
    try {
      result = await resumeAgentRun(
        agent,
        { runId: nested.ref.runId, ...(nested.ref.sessionId ? { sessionId: nested.ref.sessionId } : {}) },
        { decisions, expectedVersion: mapping.version },
        {
          checkpoints,
          definitionRevision: options.definitionRevision,
          ownership: options.ownership,
          resumeNestedRun,
          // Plan 078 Task 7: the same pump as live `delegate()`, attached to the rebuilt session,
          // so a consumer that lost the stream across HITL still sees child milestones.
          onSession: (session) => {
            // The rebuilt delegation is live again from the moment its run starts: registered after
            // resumeAgentRun's guardrails, so a stale or foreign resume never registers a live entry.
            noteLiveDelegation(mapping.childId, mapping.delegationId, mapping.parents);
            if (resumePolicy.report === "on-complete") return;
            stopChildEvents = startChildEventPump(
              session,
              { childId: mapping.childId, delegationId: mapping.delegationId, depth },
              limits,
              resumePolicy,
              options.redactor,
              (event) => events.publish(event),
              options.childEventSink,
            );
          },
        },
      );
    } catch (error) {
      // Terminal symmetry with live `delegate()`: a resumed run that died settles its counters,
      // publishes the terminal error, and runs the terminal hook. A rebuild error thrown by
      // `resumeAgentRun` before the run starts (stale version, fingerprint drift) stays silent,
      // so a duplicate resume attempt can never clean up a live suspended child.
      if (!(error instanceof AgentRunError)) throw error;
      const failed = error.result;
      const message = safeError(error, options);
      const abortedByHost = controller.signal.aborted && !(controller.signal.reason instanceof SupervisorLimitError);
      const isFailure = !abortedByHost && failed.status !== "denied" && failed.status !== "succeeded";
      settleDelegation(
        mapping.childId,
        mapping.delegationId,
        depth,
        isFailure ? "failed" : failed.status,
        isFailure ? failureAttribution(failed, message) : undefined,
      );
      events.publish({ type: "delegation_error", childId: mapping.childId, delegationId: mapping.delegationId, depth, error: message });
      await complete(toCompletion(failed, mapping.childId, mapping.delegationId, depth, options));
      throw error;
    } finally {
      // Stops on every outcome, including a failed rebuild (stale version, fingerprint drift).
      await stopChildEvents?.();
      stopChildEvents = undefined;
      disposeResumeSignals();
    }
    if (result.status === "suspended") {
      await saveMapping(nested.ref.runId, { ...mapping, version: result.runState?.version ?? mapping.version });
      return { status: "suspended", pendingDecisions: result.interruption?.pendingDecisions ?? [] };
    }
    // Terminal symmetry with live `delegate()`: publish the finish and run the terminal hook.
    const totalTokens = result.usage?.totalTokens ?? (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
    settleDelegation(
      mapping.childId,
      mapping.delegationId,
      depth,
      result.status,
      result.status === "failed"
        ? failureAttribution(result, safeError(result.error?.message ?? "Delegated run failed", options))
        : undefined,
    );
    events.publish({
      type: "delegation_finished",
      childId: mapping.childId,
      delegationId: mapping.delegationId,
      depth,
      status: result.status,
      totalTokens,
    });
    await complete(toCompletion(result, mapping.childId, mapping.delegationId, depth, options));
    if (result.status === "succeeded") {
      return { status: "completed", value: options.redactor?.redact(result.text) ?? result.text };
    }
    return {
      status: "failed",
      code: result.status === "denied" ? "delegation_denied" : "delegation_failed",
      message: safeError(result.error?.message ?? `Delegated run ${result.status}`, options),
    };
  };

  async function complete(value: DelegationCompletion): Promise<void> {
    if (!options.hooks?.after) return;
    try {
      await options.hooks.after(Object.freeze(value));
    } catch (error) {
      events.publish({
        type: "delegation_error",
        childId: value.childId,
        delegationId: value.delegationId,
        depth: value.depth,
        error: safeError(error, options),
      });
    }
  }

  return {
    childIds: Object.freeze(children.map(([childId]) => childId)),
    redact: (value) => options.redactor?.redact(value) ?? value,
    delegate: (request) => delegate(request),
    delegateAsync,
    wait,
    cancel,
    resumeNestedRun,
    subscribe: () => events.subscribe(),
    summary: (options?: { readonly reset?: boolean }) => {
      if (options?.reset) {
        // New counting window: zero every counter and restate the present state, so a dispatch
        // after a pre-window failure counts `attempts: 1` without a `retries` bump. Live
        // delegations keep their own entries, so a settle after the reset still records.
        for (const [childId, counters] of childCounters) {
          counters.attempts = 0;
          counters.retries = 0;
          counters.failures = 0;
          counters.failureRadius = 0;
          counters.outcome = hasLiveDelegation(childId) ? "running" : "idle";
        }
      }
      return Object.freeze({ children: Object.freeze(children.map(([childId]) => childSummary(childId))) });
    },
    get activeChildren() {
      return activeChildren;
    },
  };
}

function terminalResult(delegationId: string, terminal: CompletedDelegation): DelegationWaitResult {
  if ("result" in terminal) return terminal.result;
  if (terminal.cancelled) return { delegationId, status: "cancelled" };
  throw terminal.error;
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => done(() => reject(new SupervisorLimitError("Async delegation wait timeout exceeded"))), timeoutMs);
    const abort = () => {
      // Registered only when a signal exists; the listener is removed by `done`.
      if (signal) done(() => reject(signal.reason));
    };
    const done = (settle: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      settle();
    };
    if (signal) signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => done(() => resolve(value)),
      (error) => done(() => reject(error)),
    );
  });
}

/**
 * `child_failed` attribution from a terminal result: the plan-087 finish vocabulary
 * (`status`/`stopReason`), the plan-086/087 breach when a configured ceiling fired, and the
 * plan-087 exhaustion attribution the result carries on that death (plan 108 T5).
 */
function failureAttribution(result: AgentRunResult | undefined, reason: string): ChildFailureAttribution {
  return {
    reason,
    ...(result?.status !== undefined ? { status: result.status } : {}),
    ...(result?.limit !== undefined ? { limit: result.limit } : {}),
    ...(result?.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
    ...(result?.usage !== undefined ? { usage: result.usage } : {}),
    ...(result?.attribution?.consumed !== undefined ? { consumed: result.attribution.consumed } : {}),
    ...(result?.attribution?.closestOtherAxes !== undefined ? { closestOtherAxes: result.attribution.closestOtherAxes } : {}),
    ...(result?.attribution?.recentToolCalls !== undefined ? { recentToolCalls: result.attribution.recentToolCalls } : {}),
  };
}

function toCompletion(
  result: AgentRunResult,
  childId: string,
  delegationId: string,
  depth: number,
  options: CreateSupervisorOptions,
): DelegationCompletion {
  return Object.freeze({
    childId,
    delegationId,
    depth,
    status: result.status,
    text: options.redactor?.redact(result.text) ?? result.text,
    usage: result.usage,
    error: result.error ? safeError(result.error.message, options) : undefined,
  });
}

function intersectPolicies(...policies: readonly (PermissionPolicy | undefined)[]): PermissionPolicy {
  const active = policies.filter((policy): policy is PermissionPolicy => policy !== undefined);
  return {
    async check(request: PermissionRequest) {
      for (const policy of active) {
        const decision = await policy.check(request);
        if (!decision.allowed) return decision;
      }
      return { allowed: true };
    },
  };
}

function toolBudgetPolicy(max: number): PermissionPolicy {
  let count = 0;
  return {
    check(request) {
      if (request.kind !== "tool" || request.action !== "execute") return { allowed: true };
      count += 1;
      return count <= max ? { allowed: true } : { allowed: false, reason: "Delegation tool-call limit exceeded" };
    },
  };
}

function linkSignals(controller: AbortController, ...signals: readonly (AbortSignal | undefined)[]): () => void {
  const removers: (() => void)[] = [];
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) controller.abort(signal.reason);
    else {
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      removers.push(() => signal.removeEventListener("abort", abort));
    }
  }
  return () => {
    for (const remove of removers) remove();
  };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // Observe the source promise anyway: an abort that races the call must not surface as an
    // unhandled rejection from the work it abandoned (the remaining result is unreachable).
    promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function assertBytes(value: string, max: number, label: string): void {
  if (new TextEncoder().encode(value).byteLength > max) throw new SupervisorLimitError(`${label} exceeds max bytes`);
}

function requireOwnership(ownership: CreateSupervisorOptions["ownership"]): void {
  if (
    !ownership.tenantId?.trim() ||
    (ownership.accountId !== undefined && !ownership.accountId.trim()) ||
    (ownership.userId !== undefined && !ownership.userId.trim()) ||
    (!ownership.accountId && !ownership.userId)
  )
    throw new SupervisorValidationError("tenantId and non-empty accountId or userId are required");
}

function safeError(error: unknown, options: CreateSupervisorOptions): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Delegation failed";
  return options.redactor?.redact(message) ?? message;
}
