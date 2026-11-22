/** Tool-round phase of runInternal (plan 059). */

import {
  AgentRunSuspended,
  decisionPrincipalRef,
  decisionScopesEqual,
  nestedApprovalId,
  nestedOutcomeToolResult,
  pathsEqual,
} from "../../agent-approval.js";
import { toolElicitationRequest } from "../../agent-tool-dispatch.js";
import type { SessionContext } from "../../session-context.js";
import { toolOwner } from "../runtime-registry.js";
import type {
  AgentRunInterruption,
  AgentRunRef,
  NestedRunOutcome,
  NestedRunRef,
  PendingDecision,
  ResumeNestedRun,
  EventOrigin,
  JsonObject,
  StickyDecision,
  ToolCallContent,
  ToolExecutionContext,
  ToolRegistry,
  ToolResult,
  Usage,
} from "../../contracts.js";
import { AgentDecisionError, AgentDelegationSuspendedError, MAX_ATTRIBUTION_DEPTH, MAX_NESTED_STICKY_RESUMES } from "../../contracts.js";
import { toToolResultMessage } from "../../input.js";
import { isRunControlError, settleOutstandingToolCalls } from "../../loop/index.js";
import { ceilingsOf } from "../../run-limits.js";
import { canonicalToolEffectJson, toolEffectArgumentsHash } from "../../tool-effects.js";
import { dispatchToolCall, resolveToolEffectDeclaration } from "../../tools.js";
import { randomId } from "../helpers.js";
import { persistDurable, suspendDurable } from "./persist.js";
import type { RoundContext, SessionHost } from "./types.js";

export function matchNestedSticky(session: SessionHost, decision: PendingDecision): StickyDecision | undefined {
  const stickies = session.activeDurable?.state?.stickyDecisions;
  return stickies?.find(
    (sticky) =>
      sticky.attribution !== undefined &&
      pathsEqual(sticky.attribution.path, decision.attribution?.path) &&
      decisionScopesEqual(sticky.scope, decision.scope),
  );
}

export function matchStickyDecision(session: SessionHost, call: ToolCallContent, registry: ToolRegistry): StickyDecision | undefined {
  const stickies = session.activeDurable?.state?.stickyDecisions;
  if (!stickies?.length) return undefined;
  const identityRef = decisionPrincipalRef(session.activePrincipal);
  let argumentsHash: string | undefined;
  let effectKind: import("../../contracts.js").ToolEffectKind | undefined;
  let effectResolved = false;
  return stickies.find((sticky) => {
    if (sticky.attribution !== undefined) return false;
    const scope = sticky.scope;
    if (scope.toolName !== undefined && scope.toolName !== call.name) return false;
    if (scope.identity !== undefined && scope.identity !== identityRef) return false;
    if (scope.argumentsHash !== undefined) {
      argumentsHash ??= toolEffectArgumentsHash(call.arguments);
      if (scope.argumentsHash !== argumentsHash) return false;
    }
    if (scope.effectKind !== undefined) {
      if (!effectResolved) {
        effectResolved = true;
        const tool = registry.get(call.name);
        effectKind = tool?.effect
          ? resolveToolEffectDeclaration(tool, call.arguments, { sessionId: session.id, runId: "", toolCallId: call.id })?.kind
          : undefined;
      }
      if (scope.effectKind !== effectKind) return false;
    }
    if (scope.actionConstraints) {
      for (const [key, value] of Object.entries(scope.actionConstraints)) {
        const actual = (call.arguments as Record<string, unknown>)[key];
        if (canonicalToolEffectJson(actual === undefined ? null : actual) !== canonicalToolEffectJson(value)) return false;
      }
    }
    return true;
  });
}

/**
 * The durable `dispatched` mark is a read-modify-write of `durable.state`; calls of one round that run
 * together (a custom loop passing `concurrency`) must not interleave it, or a later write would drop an
 * earlier call's mark. One promise chain per run serializes them.
 */
const durableMarkChains = new WeakMap<object, Promise<void>>();
export function serializeDurableMark(owner: object, mark: () => Promise<void>): Promise<void> {
  const previous = durableMarkChains.get(owner) ?? Promise.resolve();
  const next = previous.then(mark);
  durableMarkChains.set(
    owner,
    next.catch(() => undefined),
  );
  return next;
}

export function buildPendingDecision(
  session: SessionHost,
  call: ToolCallContent,
  approvalId: string,
  registry: ToolRegistry,
  runId: string,
  metadata: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): PendingDecision {
  const tool = registry.get(call.name);
  const declaration = tool?.effect
    ? resolveToolEffectDeclaration(tool, call.arguments, {
        sessionId: session.id,
        runId,
        toolCallId: call.id,
        signal,
        metadata,
      })
    : undefined;
  const identityRef = decisionPrincipalRef(session.activePrincipal);
  const elicitation = toolElicitationRequest(tool, call.arguments, {
    sessionId: session.id,
    runId,
    toolCallId: call.id,
    signal,
    metadata,
  });
  // Plan 104 T3: the pack `ask` rule that gated this call is named in the bounded reason, so a host
  // never parses the name to know which rule raised the approval.
  return {
    approvalId,
    kind: elicitation ? "elicitation" : "tool_approval",
    toolCallId: call.id,
    scope: {
      toolName: call.name,
      argumentsHash: toolEffectArgumentsHash(call.arguments),
      ...(declaration && declaration.kind !== "none" ? { effectKind: declaration.kind } : {}),
      ...(identityRef ? { identity: identityRef } : {}),
    },
    reason: elicitation?.reason ?? "Tool side effect requires approval",
    ...(elicitation ? { elicitationSchema: elicitation.schema } : {}),
  };
}

/** A tool call whose child run suspended: what the nested path needs to resume it through the tool. */
interface NestedSurface {
  readonly ref: AgentRunRef;
  readonly call: Pick<ToolCallContent, "id" | "name">;
  readonly resume: ResumeNestedRun;
  readonly context: ToolExecutionContext;
  readonly origin?: EventOrigin;
}

/** This level's attribution: the hosting call, then the child (its session id, else its run id). */
function nestedLevelPath(surface: NestedSurface): readonly string[] {
  return [surface.call.id, surface.ref.sessionId ?? surface.ref.runId];
}

/**
 * Re-key a child's pending decisions for the parent: root-visible ids hashed from the child's, and the
 * attribution path prefixed with this level, so a grandchild's decision names every hop root first.
 */
function attributeNested(
  surface: NestedSurface,
  pending: readonly PendingDecision[],
): { readonly entry: NestedRunRef; readonly decisions: readonly PendingDecision[] } {
  const level = nestedLevelPath(surface);
  const decisions = pending.map((decision) => ({
    ...decision,
    approvalId: nestedApprovalId(surface.ref.runId, decision.approvalId),
    attribution: { path: [...level, ...(decision.attribution?.path ?? [])] },
  }));
  if (decisions.some((decision) => decision.attribution.path.length > MAX_ATTRIBUTION_DEPTH)) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Attribution path exceeds ${MAX_ATTRIBUTION_DEPTH} entries`);
  }
  return {
    entry: {
      runId: surface.ref.runId,
      ...(surface.ref.sessionId ? { sessionId: surface.ref.sessionId } : {}),
      toolCallId: surface.call.id,
      toolName: surface.call.name,
      path: level,
      approvals: pending.map((decision, index) => ({ id: decisions[index]!.approvalId, childApprovalId: decision.approvalId })),
    },
    decisions,
  };
}

/**
 * Drive one nested outcome until it settles the call or must reach the host. A suspension whose every
 * ask a sticky `allow_for_run` / `reject_for_run` of this run already covers is resumed through the tool
 * without a prompt, at most {@link MAX_NESTED_STICKY_RESUMES} times in a row; anything else is staged
 * and the run suspends at the next turn boundary or loop end ({@link suspendGatedRound}).
 */
async function driveNested(ctx: RoundContext, surface: NestedSurface, first: NestedRunOutcome): Promise<ToolResult | undefined> {
  let outcome = first;
  for (let resumes = 0; ; resumes += 1) {
    if (outcome.status !== "suspended") return nestedOutcomeToolResult(outcome, surface.call.id, surface.call.name);
    if (outcome.pendingDecisions.length === 0) {
      throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Nested-run suspension carries no pending decisions");
    }
    const { entry, decisions } = attributeNested(surface, outcome.pendingDecisions);
    const stickies = decisions.map((decision) => matchNestedSticky(ctx.session, decision));
    if (resumes >= MAX_NESTED_STICKY_RESUMES || stickies.some((sticky) => sticky === undefined)) {
      ctx.session.activeNestedRound ??= new Map();
      ctx.session.activeNestedRound.set(surface.call.id, { entry, decisions });
      ctx.session.emit({ type: "decision.pending", sessionId: ctx.session.id, runId: ctx.runId, decisions });
      return undefined;
    }
    outcome = await surface.resume(
      { ref: surface.ref, toolCallId: surface.call.id, path: entry.path },
      entry.approvals.map((approval, index) => {
        const sticky = stickies[index]!;
        return {
          approvalId: approval.childApprovalId,
          outcome: sticky.outcome,
          ...(sticky.reason !== undefined ? { reason: sticky.reason } : {}),
        };
      }),
      surface.context,
    );
  }
}

/** A nested call settled outside the dispatch pipeline still settles as one `tool.completed`. */
function emitNestedCompleted(ctx: RoundContext, result: ToolResult, origin?: EventOrigin): void {
  const status = result.error ? "error" : "finished";
  ctx.session.emit({
    type: "tool.completed",
    sessionId: ctx.session.id,
    runId: ctx.runId,
    toolCallId: result.toolCallId,
    name: result.name,
    result,
    metadata: { durationMs: 0, status },
    status,
    ...(result.error ? { error: result.error } : {}),
    ...(origin ? { origin } : {}),
  });
}

/**
 * A tool's `execute` threw {@link AgentDelegationSuspendedError}: its child run suspended. Returns the
 * call's result when sticky decisions settle it, or `undefined` once it is staged for the suspension.
 * A tool without `resumeNested` cannot route decisions back to its child, so the call fails closed.
 */
async function surfaceNested(
  ctx: RoundContext,
  call: ToolCallContent,
  error: AgentDelegationSuspendedError,
  context: ToolExecutionContext,
  origin?: EventOrigin,
): Promise<ToolResult | undefined> {
  const resume = ctx.registry.get(call.name)?.resumeNested;
  if (!resume) {
    return {
      toolCallId: call.id,
      name: call.name,
      error: {
        code: "ERR_PRISM_DECISION_INVALID",
        message: `Tool "${call.name}" suspended a child run but defines no resumeNested`,
      },
    };
  }
  return driveNested(
    ctx,
    { ref: error.ref, call, resume, context, ...(origin ? { origin } : {}) },
    {
      status: "suspended",
      pendingDecisions: error.pendingDecisions,
    },
  );
}

/**
 * Resume one suspended nested call with the host's decisions for its child, routed by the approval
 * ids recorded at suspension (never by attribution text). The call settles with the tool's outcome
 * or is staged again.
 */
async function resumeNestedEntry(ctx: RoundContext, entry: NestedRunRef): Promise<void> {
  const resume = ctx.registry.get(entry.toolName)?.resumeNested;
  if (!resume) {
    throw new AgentDecisionError(
      "ERR_PRISM_DECISION_INVALID",
      `Nested-run decisions cannot be routed: tool "${entry.toolName}" defines no resumeNested`,
    );
  }
  const decisions = entry.approvals.map((approval) => {
    const decision = ctx.resumed?.decisions?.get(approval.id);
    if (!decision) throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Missing decision for a nested approval request");
    return { ...decision, approvalId: approval.childApprovalId };
  });
  const call = { id: entry.toolCallId, name: entry.toolName };
  const ref: AgentRunRef = { runId: entry.runId, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}) };
  const context = toolExecutionContext(ctx, call);
  const outcome = await resume({ ref, toolCallId: entry.toolCallId, path: entry.path }, decisions, context);
  const result = await driveNested(ctx, { ref, call, resume, context }, outcome);
  if (!result) return;
  ctx.toolResults.push(result);
  await replayToolResult(ctx, result);
  emitNestedCompleted(ctx, result);
}

function buildRunInterruption(input: {
  readonly decisions: readonly PendingDecision[];
  readonly reason: string;
  readonly kind: AgentRunInterruption["kind"];
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly guardrail?: string;
}): AgentRunInterruption {
  return {
    kind: input.kind,
    reason: input.reason,
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.guardrail ? { guardrail: input.guardrail } : {}),
    pendingDecisions: input.decisions,
  };
}

/**
 * Stage the `{ ask }` calls of one tool round as pending decisions on the session, exactly like
 * the charge-time gate. The round's allowed calls still run; {@link suspendGatedRound} throws at the
 * next turn boundary or loop end, so a loop body that runs after `executeTools` completes first.
 */
export function stageAskDecisions(
  ctx: RoundContext,
  requests: readonly { readonly call: ToolCallContent; readonly reason: string }[],
): void {
  for (const { call, reason } of requests) {
    const approvalId = randomId("approval");
    const base = buildPendingDecision(ctx.session, call, approvalId, ctx.registry, ctx.runId, ctx.metadata, ctx.controller.signal);
    ctx.session.activeGatedRound ??= new Map();
    ctx.session.activeGatedRound.set(call.id, {
      entry: { call, status: "ready", approvalId },
      decision: { ...base, reason: base.kind === "elicitation" ? base.reason : reason },
    });
  }
  // The staged decisions are the run's suspension cause; announce them redacted (PendingDecision
  // carries hashes and scopes, never raw arguments) so a host can hold the queue before resuming.
  ctx.session.emit({
    type: "decision.pending",
    sessionId: ctx.session.id,
    runId: ctx.runId,
    decisions: [...(ctx.session.activeGatedRound?.values() ?? [])].map((gatedCall) => gatedCall.decision),
  });
}

/**
 * Suspend the run on everything the round staged: gated asks and nested suspensions together, so
 * several children that suspend in one parallel round surface as one parent suspension.
 */
export async function suspendGatedRound(ctx: RoundContext): Promise<void> {
  const gated = ctx.session.activeGatedRound;
  const nested = ctx.session.activeNestedRound;
  if (!gated?.size && !nested?.size) return;
  const entries = [...(gated?.values() ?? [])];
  const nestedEntries = [...(nested?.values() ?? [])];
  const decisions = [...entries.map((gatedCall) => gatedCall.decision), ...nestedEntries.flatMap((staged) => staged.decisions)];
  const maxPending = ceilingsOf(ctx.session.agent).pendingDecisions;
  if (decisions.length > maxPending) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Pending decisions exceed ceilings.pendingDecisions (${maxPending}) per run`);
  }
  const single = decisions.length === 1 ? decisions[0]! : undefined;
  const interruption = buildRunInterruption({
    decisions,
    kind: single?.kind === "elicitation" ? "elicitation" : "tool_approval",
    reason: single
      ? single.reason
      : nestedEntries.length > 0
        ? `${decisions.length} approval request(s) need a decision`
        : `${decisions.length} tool side effects require approval`,
    toolCallId: single?.toolCallId,
    toolName: single?.scope.toolName,
    guardrail: single?.guardrail,
  });
  throw new AgentRunSuspended(
    await suspendDurable(ctx.session, {
      runId: ctx.runId,
      model: ctx.model,
      limits: ctx.limits,
      interruption,
      pendingCalls: entries.map((gatedCall) => gatedCall.entry),
      nestedRuns: nestedEntries.map((staged) => staged.entry),
    }),
    interruption,
  );
}

export async function replayToolResult(ctx: RoundContext, result: ToolResult): Promise<void> {
  const message = toToolResultMessage(result);
  // Keep the loop's history in step with the store: a replayed row must reach the next provider turn.
  ctx.session.history.push(message);
  await ctx.session.appendMessage(message, ctx.runId);
}

/**
 * Plan 177 Task 3: replay a resumed run's approved calls through the full tool pipeline. They go to
 * `RunController.executeTools`, so `tool.call` (two rounds), `tool.execute`, `tool.result`, and the
 * transcript append run exactly as for a fresh turn. `resolveAskDecisions` satisfies the `ask` with
 * the resumed decision, so an approved call is not re-prompted; a call a rewrite moved off the
 * approved arguments is staged again by the gate (`suspendGatedRound` after the batch).
 */
async function executeApproved(ctx: RoundContext, calls: readonly ToolCallContent[]): Promise<void> {
  if (calls.length === 0) return;
  // A resumed round stays serial: its durable `pendingCalls` are marked dispatched one call at a time.
  await ctx.runController.executeTools(calls, { concurrency: 1 });
}

/** Replay a `reject_*` decision: the call never runs, but it still settles as a blocked `tool.completed`. */
async function replayRejected(ctx: RoundContext, result: ToolResult): Promise<void> {
  await replayToolResult(ctx, result);
  ctx.session.emit({
    type: "tool.completed",
    sessionId: ctx.session.id,
    runId: ctx.runId,
    toolCallId: result.toolCallId,
    name: result.name,
    result,
    metadata: { durationMs: 0, status: "blocked" },
    status: "blocked",
    reason: typeof result.error?.code === "string" ? result.error.code : "approval_rejected",
    ...(result.error ? { error: result.error } : {}),
  });
}

export function bindChargeToolRound(ctx: RoundContext): (calls: readonly ToolCallContent[]) => void | Promise<void> {
  return async (calls) => {
    if (calls.length > 0) ctx.limits.charge("maxToolRounds");
  };
}

/**
 * `sha256:` hash of one tool result for the stall axis (plan 239 Task 9): its content, value, and error,
 * canonicalized by the same helper as `argHash`. The call id and metadata (durations) are left out, so the
 * same answer to the same call hashes alike across rounds. A result that is not JSON-representable even after
 * a JSON round trip has no hash, and its round never counts as repeated.
 */
export function toolResultHash(result: ToolResult): string | undefined {
  const payload: Record<string, unknown> = {};
  if (result.content !== undefined) payload.content = result.content;
  if (result.value !== undefined) payload.value = result.value;
  if (result.error !== undefined) payload.error = result.error;
  try {
    return `sha256:${toolEffectArgumentsHash(payload as JsonObject)}`;
  } catch {
    // Nested `undefined` or a class instance: retry on the JSON projection the transcript stores.
    try {
      const projected = JSON.parse(JSON.stringify(payload)) as JsonObject;
      return `sha256:${toolEffectArgumentsHash(projected)}`;
    } catch {
      return undefined;
    }
  }
}

/**
 * The stall axis (plan 239 Task 9): after a tool round settles, record its `resultHash` on the recent-call
 * ring and charge `maxRepeatedToolRounds` with the round's digest over its sorted `(name, argHash, resultHash)`
 * set. A round that staged an approval is not settled yet and is not charged; a round with an unhashable
 * result charges a digest no other round shares, which resets the count.
 */
export function bindChargeStallRound(ctx: RoundContext): (calls: readonly ToolCallContent[], results: readonly ToolResult[]) => void {
  return (calls, results) => {
    if (calls.length === 0) return;
    if (results.some((result) => (result.metadata as { approvalPending?: unknown } | undefined)?.approvalPending === true)) return;
    const byId = new Map(results.map((result) => [result.toolCallId, result]));
    const recent = ctx.session.activeRecentToolCalls;
    const parts: string[] = [];
    let unique = false;
    for (const call of calls) {
      const result = byId.get(call.id);
      const resultHash = result ? toolResultHash(result) : undefined;
      const index = recent?.findIndex((summary) => summary.id === call.id) ?? -1;
      const summary = index >= 0 ? recent![index]! : undefined;
      const argHash = summary?.argHash ?? `sha256:${toolEffectArgumentsHash(call.arguments)}`;
      if (summary && resultHash) recent![index] = { ...summary, resultHash };
      if (!resultHash) unique = true;
      parts.push(`${call.name}\u0000${argHash}\u0000${resultHash ?? ""}`);
    }
    // An unhashable result makes the round unlike any other: key it on its call ids, which never repeat.
    if (unique) parts.push(...calls.map((call) => `id\u0000${call.id}`));
    parts.sort();
    ctx.limits.recordToolRound(`sha256:${toolEffectArgumentsHash({ round: parts })}`);
  };
}

/** Last-N dispatched tool calls kept for `budget_exhausted` attribution (plan 087 T2); the hash
 *  is the same canonical arguments hash the effect store uses, so raw args never enter events. */
const RECENT_TOOL_CALL_LIMIT = 10;

function recordRecentToolCall(session: SessionHost, call: ToolCallContent): void {
  const recent = (session.activeRecentToolCalls ??= []);
  recent.push({ id: call.id, name: call.name, argHash: `sha256:${toolEffectArgumentsHash(call.arguments)}` });
  if (recent.length > RECENT_TOOL_CALL_LIMIT) recent.shift();
}

function toolSession(ctx: RoundContext, tool: string): { session?: SessionContext } {
  const owner = toolOwner(ctx.session.agent, tool);
  return owner === undefined ? {} : { session: ctx.session.sessionContextFor(owner) };
}

/** The context a tool sees for one call; `resumeNested` gets the hosting call's context too. */
function toolExecutionContext(ctx: RoundContext, call: Pick<ToolCallContent, "id" | "name">): ToolExecutionContext {
  return {
    sessionId: ctx.session.id,
    runId: ctx.runId,
    toolCallId: call.id,
    signal: ctx.controller.signal,
    // A package tool sees the session as its own package does, so `background` is capability-checked.
    ...toolSession(ctx, call.name),
    metadata: {
      ...ctx.metadata,
      loadedSkills: ctx.session.loadedSkills,
      activeTools: ctx.tools,
      activeSkillNames: ctx.activeSkills.map((skill) => skill.name),
      // What this turn advertised (`when`, per-turn clamps), so `load_skill` cannot load a skill whose tools are hidden.
      advertisedToolNames: ctx.turnAllow ?? ctx.tools.map((tool) => tool.name),
    },
    principal: ctx.session.activePrincipal,
    interactive: ctx.options.interactive ?? true,
  };
}

function dispatchFilter(ctx: RoundContext): { filter: { allow: readonly string[] } | { deny: readonly string[] } } | Record<string, never> {
  const hiddenOk = ctx.options.allowHiddenToolCalls ?? ctx.session.agent.config.allowHiddenToolCalls;
  if (hiddenOk || ctx.turnAllow === undefined) {
    return ctx.tools.length > 0 ? { filter: { allow: ctx.tools.map((tool) => tool.name) } } : {};
  }
  if (ctx.turnAllow.length > 0) return { filter: { allow: ctx.turnAllow } };
  return ctx.tools.length > 0 ? { filter: { deny: ctx.tools.map((tool) => tool.name) } } : {};
}

export function bindDispatchToolCall(ctx: RoundContext): (call: ToolCallContent, origin?: EventOrigin) => Promise<ToolResult> {
  return async (call, origin) => {
    const sticky = matchStickyDecision(ctx.session, call, ctx.registry);
    if (sticky?.outcome === "reject_for_run") {
      return {
        toolCallId: call.id,
        name: call.name,
        error: { code: "approval_rejected", message: sticky.reason ?? "Rejected for this run" },
      };
    }
    if (ctx.session.activeGatedRound?.has(call.id)) {
      return { toolCallId: call.id, name: call.name, metadata: { approvalPending: true } };
    }
    ctx.toolCalls += 1;
    recordRecentToolCall(ctx.session, call);
    const context = toolExecutionContext(ctx, call);
    try {
      const result = await dispatchToolCall({
        call,
        registry: ctx.registry,
        context,
        emit: (event) => ctx.session.emit(origin ? { ...event, origin } : event),
        trust: ctx.session.agent.config.trust,
        redactor: ctx.session.activeRedactor,
        ledger: ctx.session.activeLedger,
        effectStore: ctx.session.activeEffectStore,
        ownership: ctx.session.activeOwnership,
        principal: ctx.session.activePrincipal,
        ...dispatchFilter(ctx),
        limitTracker: ctx.limits,
        beforeExecute: (mediatedCall) =>
          serializeDurableMark(ctx.session, async () => {
            const durable = ctx.session.activeDurable;
            if (!durable) return;
            const pendingCalls = durable.state?.pendingCalls;
            const matched = pendingCalls?.find((entry) => entry.call.id === mediatedCall.id && entry.status === "ready");
            if (matched) {
              await persistDurable(ctx.session, {
                ...durable.state!,
                status: "running",
                pendingCalls: pendingCalls!.map((entry) => (entry === matched ? { ...entry, status: "dispatched" as const } : entry)),
                interruption: undefined,
              });
              return;
            }
            const pending = durable.state?.pending;
            if (pending?.call.id === mediatedCall.id && pending.status === "ready") {
              await persistDurable(ctx.session, {
                ...durable.state!,
                status: "running",
                pending: { ...pending, status: "dispatched" },
                interruption: undefined,
              });
              return;
            }
          }),
        validate: ctx.validate,
        validation: ctx.validation,
      });
      ctx.toolResults.push(result);
      return result;
    } catch (error) {
      if (!(error instanceof AgentDelegationSuspendedError)) throw error;
      error.toolCall ??= call;
      // The child's suspension is staged like a gated ask: the round's other calls still run.
      const settled = await surfaceNested(ctx, call, error, context, origin);
      if (!settled) return { toolCallId: call.id, name: call.name, metadata: { approvalPending: true } };
      ctx.toolResults.push(settled);
      emitNestedCompleted(ctx, settled, origin);
      return settled;
    }
  };
}

/**
 * Replay a resumed run's suspension: nested calls first (each routed to its child through the hosting
 * tool's `resumeNested`), then the run's own approved, rejected, and elicited calls. A nested call
 * that settles gets its result here; it has no pending call entry, so the generic replay never
 * re-executes the hosting tool.
 */
export async function replayDurableNestedAndPending(ctx: RoundContext): Promise<void> {
  const { session, resumed } = ctx;
  const resumePendingCalls = resumed?.state?.pendingCalls;
  const nestedRuns = resumed?.state?.nestedRuns ?? [];
  if (nestedRuns.length > 0) {
    if (session.activeDurable?.state) session.activeDurable.state = { ...session.activeDurable.state, nestedRuns: undefined };
    for (const entry of nestedRuns) await resumeNestedEntry(ctx, entry);
  }
  const approved: ToolCallContent[] = [];
  if (resumePendingCalls?.length) {
    for (const entry of resumePendingCalls) {
      if (entry.status !== "ready") continue;
      const decision = entry.decision ?? resumed?.decisions?.get(entry.approvalId);
      if (decision && (decision.outcome === "reject_once" || decision.outcome === "reject_for_run")) {
        await replayRejected(ctx, {
          toolCallId: entry.call.id,
          name: entry.call.name,
          error: { code: "approval_rejected", message: decision.reason ?? "Approval rejected" },
        });
        continue;
      }
      if (decision?.elicitation !== undefined) {
        await replayToolResult(ctx, { toolCallId: entry.call.id, name: entry.call.name, value: decision.elicitation });
        continue;
      }
      // `modifiedArguments` was schema/guardrail-validated at decision time; the full `tool.call`
      // gate still runs on it in `executeApproved`, exactly like a rewrite.
      approved.push(decision?.modifiedArguments ? { ...entry.call, arguments: decision.modifiedArguments } : entry.call);
    }
  } else if (resumed?.state?.pending?.status === "ready") {
    approved.push(resumed.state.pending.call);
  }
  await executeApproved(ctx, approved);
  // A call the resumed decision no longer covers (a rewrite moved it) was staged by the gate:
  // suspend before the loop takes a provider turn.
  await suspendGatedRound(ctx);
}

export async function runLoopUntilSettled(ctx: RoundContext): Promise<Usage | undefined> {
  try {
    await ctx.loop.run(ctx.runController);
    // A loop that dropped a round's calls must not end the run with them unanswered.
    await settleOutstandingToolCalls(ctx.runController);
    await suspendGatedRound(ctx);
    return undefined;
  } catch (error) {
    if (!isRunControlError(error)) await settleOutstandingToolCalls(ctx.runController);
    throw error;
  }
}
