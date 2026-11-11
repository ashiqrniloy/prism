/** Tool-round phase of runInternal (plan 059). */

import {
  AgentRunSuspended,
  decisionPrincipalRef,
  decisionScopesEqual,
  nestedApprovalId,
  nestedOutcomeToolResult,
  pathsEqual,
} from "../../agent-approval.js";
import type { PendingToolCall } from "../../agent-run-state.js";
import { toolElicitationRequest } from "../../agent-tool-dispatch.js";
import type { SessionContext } from "../../session-context.js";
import { toolOwner } from "../runtime-registry.js";
import type {
  AgentRunInterruption,
  AgentRunRef,
  NestedRunRef,
  PendingDecision,
  ResumeNestedRun,
  Decision,
  EventOrigin,
  StickyDecision,
  ToolCallContent,
  ToolRegistry,
  ToolResult,
  Usage,
} from "../../contracts.js";
import { AgentDecisionError, AgentDelegationSuspendedError, HARD_MAX_PENDING_DECISIONS, MAX_ATTRIBUTION_DEPTH } from "../../contracts.js";
import { toToolResultMessage } from "../../input.js";
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

/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export async function applyNestedRun(
  session: SessionHost,
  input: {
    ref: AgentRunRef;
    toolCall: ToolCallContent;
    path: readonly string[];
    pending: readonly PendingDecision[];
    hook?: ResumeNestedRun;
  },
): Promise<{ toolResult: ToolResult } | { entry: NestedRunRef; pending: PendingDecision[] }> {
  let current = input.pending;
  for (let depth = 0; ; depth += 1) {
    const attributed = current.map((decision) => {
      const id = nestedApprovalId(input.ref.runId, decision.approvalId);
      return {
        id,
        childApprovalId: decision.approvalId,
        decision: { ...decision, approvalId: id, attribution: decision.attribution ?? { path: input.path } },
      };
    });
    if (attributed.some(({ decision }) => (decision.attribution?.path.length ?? 0) > MAX_ATTRIBUTION_DEPTH)) {
      throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Attribution path exceeds ${MAX_ATTRIBUTION_DEPTH} entries`);
    }
    const allSticky = attributed.length > 0 && attributed.every(({ decision }) => matchNestedSticky(session, decision) !== undefined);
    if (!input.hook || !allSticky || depth >= 4) {
      return {
        entry: {
          runId: input.ref.runId,
          ...(input.ref.sessionId ? { sessionId: input.ref.sessionId } : {}),
          toolCallId: input.toolCall.id,
          path: attributed[0]?.decision.attribution?.path ?? input.path,
          approvals: attributed.map(({ id, childApprovalId }) => ({ id, childApprovalId })),
        },
        pending: attributed.map(({ decision }) => decision),
      };
    }
    const outcome = await input.hook(
      { ref: input.ref, toolCallId: input.toolCall.id, path: input.path },
      attributed.map(({ childApprovalId, decision }) => {
        const sticky = matchNestedSticky(session, decision)!;
        return {
          approvalId: childApprovalId,
          outcome: sticky.outcome,
          ...(sticky.reason !== undefined ? { reason: sticky.reason } : {}),
        };
      }),
    );
    if (outcome.status === "suspended") {
      current = outcome.pendingDecisions;
      continue;
    }
    return { toolResult: nestedOutcomeToolResult(outcome, input.toolCall.id, input.toolCall.name) };
  }
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

export async function suspendGatedRound(ctx: RoundContext): Promise<void> {
  const gated = ctx.session.activeGatedRound;
  if (!gated?.size) return;
  const entries = [...gated.values()];
  const decisions = entries.map((gatedCall) => gatedCall.decision);
  const single = decisions.length === 1 ? decisions[0]! : undefined;
  const interruption = buildRunInterruption({
    decisions,
    kind: single?.kind === "elicitation" ? "elicitation" : "tool_approval",
    reason: single ? single.reason : `${decisions.length} tool side effects require approval`,
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
    }),
    interruption,
  );
}

/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export async function suspendNested(
  ctx: RoundContext,
  nested: { entry: NestedRunRef; toolCall: ToolCallContent; pending: PendingDecision[] },
): Promise<never> {
  const state = ctx.session.activeDurable?.state;
  const kept = (state?.pendingCalls ?? [])
    .filter((entry) => entry.status === "ready")
    .map((entry) => {
      const decision = entry.decision ?? ctx.resumed?.decisions?.get(entry.approvalId);
      return decision ? { ...entry, decision } : entry;
    });
  const gated = [...(ctx.session.activeGatedRound?.values() ?? [])];
  const pendingCalls: PendingToolCall[] = [
    ...kept,
    ...gated.map((gatedCall) => gatedCall.entry),
    { call: nested.toolCall, status: "ready", approvalId: `nr_${nested.entry.runId}` },
  ];
  const keptIds = new Set(kept.map((entry) => entry.approvalId));
  const decisions: PendingDecision[] = [
    ...(state?.interruption?.pendingDecisions ?? []).filter((pending) => keptIds.has(pending.approvalId)),
    ...gated.map((gatedCall) => gatedCall.decision),
    ...nested.pending,
  ];
  if (decisions.length > HARD_MAX_PENDING_DECISIONS) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Pending decisions exceed ${HARD_MAX_PENDING_DECISIONS} per run`);
  }
  const single = decisions.length === 1 ? decisions[0]! : undefined;
  const interruption = buildRunInterruption({
    decisions,
    kind: single?.kind ?? "tool_approval",
    reason: single ? single.reason : `${decisions.length} approval request(s) need a decision`,
    toolCallId: single?.toolCallId,
    toolName: single?.scope.toolName,
  });
  throw new AgentRunSuspended(
    await suspendDurable(ctx.session, {
      runId: ctx.runId,
      model: ctx.model,
      limits: ctx.limits,
      interruption,
      pendingCalls,
      nestedRuns: [...(state?.nestedRuns ?? []), nested.entry],
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
  await ctx.runController.executeTools(calls);
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

/**
 * A nested (delegated) child suspended on its own approval inside a root tool call. Routing the host's
 * decision back into the child needs the nested-resume hook that the retired run-state surface carried
 * (plan 168 Task 5), and a nested suspension whose decisions no host can route is a dead end — so this
 * fails closed at the boundary. In-process delegation surfaces a suspended child through its own package
 * (`delegate_wait` returns the pending decisions) instead of through the root run.
 */
export function handleNestedSignal(_ctx: RoundContext, _error: AgentDelegationSuspendedError): never {
  throw new AgentDecisionError(
    "ERR_PRISM_DECISION_INVALID",
    "Nested-run suspension cannot be routed to the host: this kernel has no nested-run resume hook",
  );
}

export function bindChargeToolRound(ctx: RoundContext): (calls: readonly ToolCallContent[]) => void | Promise<void> {
  return async (calls) => {
    if (calls.length > 0) ctx.limits.charge("maxToolRounds");
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
    try {
      const result = await dispatchToolCall({
        call,
        registry: ctx.registry,
        context: {
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
        },
        emit: (event) => ctx.session.emit(origin ? { ...event, origin } : event),
        trust: ctx.session.agent.config.trust,
        redactor: ctx.session.activeRedactor,
        ledger: ctx.session.activeLedger,
        effectStore: ctx.session.activeEffectStore,
        ownership: ctx.session.activeOwnership,
        principal: ctx.session.activePrincipal,
        ...dispatchFilter(ctx),
        limitTracker: ctx.limits,
        beforeExecute: async (mediatedCall) => {
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
        },
        validate: ctx.validate,
      });
      ctx.toolResults.push(result);
      return result;
    } catch (error) {
      if (error instanceof AgentDelegationSuspendedError && !error.toolCall) error.toolCall = call;
      throw error;
    }
  };
}

export async function replayDurableNestedAndPending(ctx: RoundContext): Promise<void> {
  const { session, resumed } = ctx;
  let resumePendingCalls = resumed?.state?.pendingCalls;
  if (resumed?.state?.nestedRuns?.length) {
    const nestedRuns = resumed.state.nestedRuns;
    const oldPending = resumed.state.interruption?.pendingDecisions ?? [];
    const nestedApprovalIds = new Set(nestedRuns.flatMap((entry) => entry.approvals.map((approval) => approval.id)));
    const remainingNested: NestedRunRef[] = [];
    const surfacedPending: PendingDecision[] = [];
    const resolvedToolCallIds = new Set<string>();
    for (const entry of nestedRuns) {
      const grouped: Decision[] = [];
      for (const approval of entry.approvals) {
        const decision = entry.decisions?.[approval.id] ?? resumed.decisions?.get(approval.id);
        if (decision) grouped.push({ ...decision, approvalId: approval.childApprovalId });
      }
      if (grouped.length === 0) {
        remainingNested.push(entry);
        surfacedPending.push(...oldPending.filter((pending) => entry.approvals.some((approval) => approval.id === pending.approvalId)));
        continue;
      }
      // Routing a host decision back into a nested child needs the nested-resume hook, which had no
      // 0.13 carrier once the run-state surface was retired (plan 168 Task 5). Fail closed instead of
      // dropping the decision; the child's own package resumes it (delegate surfaces them as a tool result).
      throw new AgentDecisionError(
        "ERR_PRISM_DECISION_INVALID",
        "Nested-run decisions cannot be routed: this kernel has no nested-run resume hook",
      );
    }
    resumePendingCalls = resumePendingCalls
      ?.filter((entry) => !resolvedToolCallIds.has(entry.call.id))
      .map((entry) => {
        const decision = resumed.decisions?.get(entry.approvalId);
        return decision && !entry.decision ? { ...entry, decision } : entry;
      });
    if (session.activeDurable?.state) {
      session.activeDurable.state = {
        ...session.activeDurable.state,
        pendingCalls: resumePendingCalls?.length ? resumePendingCalls : undefined,
        nestedRuns: remainingNested.length ? remainingNested : undefined,
      };
    }
    const remainingOwn = oldPending.filter(
      (pending) =>
        !nestedApprovalIds.has(pending.approvalId) &&
        !resumed.decisions?.has(pending.approvalId) &&
        !resumePendingCalls?.some((entry) => entry.approvalId === pending.approvalId && entry.decision !== undefined),
    );
    if (remainingOwn.length > 0 || surfacedPending.length > 0) {
      const pendingDecisions = [...remainingOwn, ...surfacedPending];
      const single = pendingDecisions.length === 1 ? pendingDecisions[0]! : undefined;
      const interruption = buildRunInterruption({
        decisions: pendingDecisions,
        kind: single?.kind ?? "tool_approval",
        reason: `${pendingDecisions.length} approval request(s) remain`,
        toolCallId: single?.toolCallId,
        toolName: single?.scope.toolName,
      });
      throw new AgentRunSuspended(
        await suspendDurable(session, {
          runId: ctx.runId,
          model: ctx.model,
          limits: ctx.limits,
          interruption,
          pendingCalls: resumePendingCalls,
          nestedRuns: remainingNested,
        }),
        interruption,
      );
    }
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
  if (approved.length > 0) {
    try {
      await executeApproved(ctx, approved);
    } catch (error) {
      if (!(error instanceof AgentDelegationSuspendedError)) throw error;
      await handleNestedSignal(ctx, error);
    }
  }
  // A call the resumed decision no longer covers (a rewrite moved it) was staged by the gate:
  // suspend before the loop takes a provider turn.
  await suspendGatedRound(ctx);
}

export async function runLoopUntilSettled(ctx: RoundContext): Promise<Usage | undefined> {
  while (true) {
    try {
      await ctx.loop.run(ctx.runController);
      await suspendGatedRound(ctx);
      return undefined;
    } catch (error) {
      if (!(error instanceof AgentDelegationSuspendedError)) throw error;
      await handleNestedSignal(ctx, error);
    }
  }
}
