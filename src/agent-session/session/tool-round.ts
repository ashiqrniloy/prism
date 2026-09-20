/** Tool-round phase of runInternal (plan 059). */

import {
  AgentRunSuspended,
  decisionIdentityRef,
  decisionScopesEqual,
  nestedApprovalId,
  nestedOutcomeToolResult,
  pathsEqual,
} from "../../agent-approval.js";
import type { PendingToolCall } from "../../agent-run-state.js";
import { toolElicitationRequest } from "../../agent-tool-dispatch.js";
import type {
  AgentRunRef,
  GuardrailRecord,
  Guardrails,
  LoopContext,
  NestedRunRef,
  PendingDecision,
  ResumeNestedRun,
  RunDecision,
  StickyDecision,
  ToolCallContent,
  ToolRegistry,
  ToolResult,
  Usage,
} from "../../contracts.js";
import {
  AgentDecisionError,
  AgentDelegationSuspendedError,
  AgentRunStateError,
  DEFAULT_MAX_PENDING_DECISIONS,
  HARD_MAX_PENDING_DECISIONS,
  MAX_ATTRIBUTION_DEPTH,
} from "../../contracts.js";
import { toToolResultMessage } from "../../input.js";
import { runGuardrails } from "../../guardrails.js";
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
  const identityRef = decisionIdentityRef(session.activeIdentity);
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
  ask?: GuardrailRecord,
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
  const identityRef = decisionIdentityRef(session.activeIdentity);
  const elicitation = toolElicitationRequest(tool, call.arguments, {
    sessionId: session.id,
    runId,
    toolCallId: call.id,
    signal,
    metadata,
  });
  // Plan 104 T3: the pack `ask` rule that gated this call is named in the bounded reason and carried
  // machine-readably, so a host never parses the name to know which rule raised the approval.
  const pack = ask?.metadata?.pack;
  const rule = ask?.metadata?.rule;
  const guardrailRule: { pack: string; rule: string } | undefined =
    typeof pack === "string" && typeof rule === "string" ? { pack, rule } : undefined;
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
    reason: elicitation?.reason ?? (ask ? askDecisionReason(ask) : "Tool side effect requires approval"),
    ...(elicitation ? { elicitationSchema: elicitation.schema } : {}),
    ...(ask && guardrailRule ? { guardrail: ask.guardrail, guardrailRule } : {}),
  };
}

const MAX_ASK_DECISION_REASON_BYTES = 200;

/** `pack:<pack>/<rule>` plus the pack's own reason, bounded like every other decision field. */
function askDecisionReason(ask: GuardrailRecord): string {
  const pack = ask.metadata?.pack;
  const rule = ask.metadata?.rule;
  const defaultReason = typeof pack === "string" && typeof rule === "string" ? `guardrail pack rule ${pack}/${rule}` : undefined;
  const line = `Approval required by guardrail rule ${ask.guardrail}`;
  const text = ask.reason && ask.reason !== defaultReason ? `${line}: ${ask.reason}` : line;
  const bytes = new TextEncoder().encode(text);
  return bytes.length <= MAX_ASK_DECISION_REASON_BYTES
    ? text
    : new TextDecoder().decode(bytes.subarray(0, MAX_ASK_DECISION_REASON_BYTES));
}

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

export async function suspendGatedRound(ctx: RoundContext): Promise<void> {
  const gated = ctx.session.activeGatedRound;
  if (!gated?.size) return;
  const entries = [...gated.values()];
  const decisions = entries.map((gatedCall) => gatedCall.decision);
  const single = decisions.length === 1 ? decisions[0]! : undefined;
  const interruption: import("../../contracts.js").AgentRunInterruption = {
    kind: single?.kind === "elicitation" ? "elicitation" : "tool_approval",
    reason: single ? single.reason : `${decisions.length} tool side effects require approval`,
    ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
    ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
    ...(single?.guardrail ? { guardrail: single.guardrail } : {}),
    pendingDecisions: decisions,
  };
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
  const interruption: import("../../contracts.js").AgentRunInterruption = {
    kind: single?.kind ?? "tool_approval",
    reason: single ? single.reason : `${decisions.length} approval request(s) need a decision`,
    ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
    ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
    pendingDecisions: decisions,
  };
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
  await ctx.session.appendMessage(toToolResultMessage(result), ctx.runId);
}

export async function handleNestedSignal(ctx: RoundContext, error: AgentDelegationSuspendedError): Promise<void> {
  const durableOptions = ctx.session.activeDurable?.options;
  if (!durableOptions || !error.toolCall) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Nested-run suspension requires durable run state and a hosting tool call");
  }
  if (error.pendingDecisions.length === 0) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Nested-run suspension carried no pending decisions");
  }
  const applied = await applyNestedRun(ctx.session, {
    ref: error.ref,
    toolCall: error.toolCall,
    path: error.path ?? [],
    pending: error.pendingDecisions,
    hook: durableOptions.resumeNestedRun,
  });
  if ("toolResult" in applied) {
    await replayToolResult(ctx, applied.toolResult);
    return;
  }
  await suspendNested(ctx, { entry: applied.entry, toolCall: error.toolCall, pending: applied.pending });
}

export function bindChargeToolRound(ctx: RoundContext): LoopContext["chargeToolRound"] {
  return async (calls) => {
    if (calls.length > 0) ctx.limits.charge("maxToolRounds");
    const durable = ctx.session.activeDurable;
    // A run that cannot suspend never gates here: `activeGuardrails` already carries the pack `ask`
    // rules as plain blocks (assemble.ts), so the ordinary stage path refuses the call.
    if (!durable || calls.length === 0) return;
    if (!ctx.session.packAskGate && !durable.options.interruptBeforeTool) return;
    for (const call of calls) {
      if (matchStickyDecision(ctx.session, call, ctx.registry)) continue;
      const ask = await matchAskGate(ctx, call);
      if (!ask && !durable.options.interruptBeforeTool) continue;
      const approvalId = randomId("approval");
      ctx.session.activeGatedRound ??= new Map();
      ctx.session.activeGatedRound.set(call.id, {
        entry: { call, status: "ready", approvalId },
        decision: buildPendingDecision(
          ctx.session,
          call,
          approvalId,
          ctx.registry,
          ctx.runId,
          ctx.metadata,
          ctx.controller.signal,
          ask,
        ),
      });
    }
    if (ctx.session.activeGatedRound && ctx.session.activeGatedRound.size > DEFAULT_MAX_PENDING_DECISIONS) {
      throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Pending decisions exceed ${DEFAULT_MAX_PENDING_DECISIONS} per run`);
    }
  };
}

/**
 * Plan 104 T3: evaluate the pack `ask` rules for one call at charge time. The rules run through the
 * same compiler and stage runner as every other pack rule, so matching, bounds, and redaction are
 * shared; a match emits its `guardrail_decision` (`interrupt`: awaiting a decision) and gates the
 * call before it can dispatch.
 */
async function matchAskGate(ctx: RoundContext, call: ToolCallContent): Promise<GuardrailRecord | undefined> {
  const gate: Guardrails | undefined = ctx.session.packAskGate;
  if (!gate) return undefined;
  const result = await runGuardrails({
    stage: "tool_input",
    guardrails: gate,
    value: call,
    context: {
      sessionId: ctx.session.id,
      runId: ctx.runId,
      toolCallId: call.id,
      toolName: call.name,
      metadata: ctx.metadata,
      signal: ctx.controller.signal,
    },
    redactor: ctx.session.activeRedactor,
    emit: (event) => ctx.session.emit(event),
  });
  return result.terminal;
}

/** Last-N dispatched tool calls kept for `budget_exhausted` attribution (plan 087 T2); the hash
 *  is the same canonical arguments hash the effect store uses, so raw args never enter events. */
const RECENT_TOOL_CALL_LIMIT = 10;

function recordRecentToolCall(session: SessionHost, call: ToolCallContent): void {
  const recent = (session.activeRecentToolCalls ??= []);
  recent.push({ id: call.id, name: call.name, argHash: `sha256:${toolEffectArgumentsHash(call.arguments)}` });
  if (recent.length > RECENT_TOOL_CALL_LIMIT) recent.shift();
}

function dispatchFilter(ctx: RoundContext): { filter: { allow: readonly string[] } | { deny: readonly string[] } } | Record<string, never> {
  const hiddenOk = ctx.options.allowHiddenToolCalls ?? ctx.session.agent.config.allowHiddenToolCalls;
  if (hiddenOk || ctx.turnAllow === undefined) {
    return ctx.tools.length > 0 ? { filter: { allow: ctx.tools.map((tool) => tool.name) } } : {};
  }
  if (ctx.turnAllow.length > 0) return { filter: { allow: ctx.turnAllow } };
  return ctx.tools.length > 0 ? { filter: { deny: ctx.tools.map((tool) => tool.name) } } : {};
}

export function bindDispatchToolCall(ctx: RoundContext): LoopContext["dispatchToolCall"] {
  return async (call) => {
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
          metadata: {
            ...ctx.metadata,
            loadedSkills: ctx.session.loadedSkills,
            activeTools: ctx.tools,
            activeSkillNames: ctx.activeSkills.map((skill) => skill.name),
          },
          identity: ctx.session.activeIdentity,
        },
        middleware: ctx.session.agent.config.middleware,
        emit: (event) => ctx.session.emit(event),
        permission: ctx.session.agent.config.permission,
        trust: ctx.session.agent.config.trust,
        redactor: ctx.session.activeRedactor,
        ledger: ctx.session.activeLedger,
        effectStore: ctx.session.activeEffectStore,
        ownership: ctx.session.activeOwnership,
        identity: ctx.session.activeIdentity,
        guardrails: ctx.session.activeGuardrails,
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
          if (!durable.options.interruptBeforeTool) return;
          if (matchStickyDecision(ctx.session, mediatedCall, ctx.registry)?.outcome === "allow_for_run") return;
          const approvalId = randomId("approval");
          const decision = buildPendingDecision(
            ctx.session,
            mediatedCall,
            approvalId,
            ctx.registry,
            ctx.runId,
            ctx.metadata,
            ctx.controller.signal,
          );
          const interruption: import("../../contracts.js").AgentRunInterruption = {
            kind: "tool_approval",
            reason: decision.reason,
            toolCallId: mediatedCall.id,
            toolName: mediatedCall.name,
            pendingDecisions: [decision],
          };
          throw new AgentRunSuspended(
            await suspendDurable(ctx.session, {
              runId: ctx.runId,
              model: ctx.model,
              limits: ctx.limits,
              interruption,
              pending: { call: mediatedCall, status: "ready" },
              pendingCalls: [{ call: mediatedCall, status: "ready", approvalId }],
            }),
            interruption,
          );
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
    const hook = session.activeDurable?.options.resumeNestedRun;
    const oldPending = resumed.state.interruption?.pendingDecisions ?? [];
    const nestedApprovalIds = new Set(nestedRuns.flatMap((entry) => entry.approvals.map((approval) => approval.id)));
    const remainingNested: NestedRunRef[] = [];
    const surfacedPending: PendingDecision[] = [];
    const resolvedToolCallIds = new Set<string>();
    for (const entry of nestedRuns) {
      const grouped: RunDecision[] = [];
      for (const approval of entry.approvals) {
        const decision = entry.decisions?.[approval.id] ?? resumed.decisions?.get(approval.id);
        if (decision) grouped.push({ ...decision, approvalId: approval.childApprovalId });
      }
      if (grouped.length === 0) {
        remainingNested.push(entry);
        surfacedPending.push(...oldPending.filter((pending) => entry.approvals.some((approval) => approval.id === pending.approvalId)));
        continue;
      }
      if (!hook) {
        throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Nested-run decisions require a resumeNestedRun hook");
      }
      const toolCall = resumePendingCalls?.find((pending) => pending.call.id === entry.toolCallId)?.call;
      if (!toolCall) throw new AgentRunStateError("Nested run link is missing its tool call");
      const ref: AgentRunRef = { runId: entry.runId, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}) };
      const outcome = await hook({ ref, toolCallId: entry.toolCallId, path: entry.path }, grouped);
      if (outcome.status !== "suspended") {
        await replayToolResult(ctx, nestedOutcomeToolResult(outcome, entry.toolCallId, toolCall.name));
        resolvedToolCallIds.add(entry.toolCallId);
        continue;
      }
      const applied = await applyNestedRun(session, { ref, toolCall, path: entry.path, pending: outcome.pendingDecisions, hook });
      if ("toolResult" in applied) {
        await replayToolResult(ctx, applied.toolResult);
        resolvedToolCallIds.add(entry.toolCallId);
      } else {
        remainingNested.push(applied.entry);
        surfacedPending.push(...applied.pending);
      }
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
      const interruption: import("../../contracts.js").AgentRunInterruption = {
        kind: single?.kind ?? "tool_approval",
        reason: `${pendingDecisions.length} approval request(s) remain`,
        ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
        ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
        pendingDecisions,
      };
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
  if (resumePendingCalls?.length) {
    for (const entry of resumePendingCalls) {
      if (entry.status !== "ready") continue;
      const decision = entry.decision ?? resumed?.decisions?.get(entry.approvalId);
      if (decision && (decision.outcome === "reject_once" || decision.outcome === "reject_for_run")) {
        await replayToolResult(ctx, {
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
      const call = decision?.modifiedArguments ? { ...entry.call, arguments: decision.modifiedArguments } : entry.call;
      try {
        await replayToolResult(ctx, await ctx.loopCtx.dispatchToolCall(call));
      } catch (error) {
        if (!(error instanceof AgentDelegationSuspendedError)) throw error;
        await handleNestedSignal(ctx, error);
      }
    }
  } else if (resumed?.state?.pending?.status === "ready") {
    await replayToolResult(ctx, await ctx.loopCtx.dispatchToolCall(resumed.state.pending.call));
  }
}

export async function runLoopUntilSettled(ctx: RoundContext): Promise<Usage | undefined> {
  while (true) {
    try {
      const loopUsage = await ctx.loop.run(ctx.loopCtx);
      await suspendGatedRound(ctx);
      return loopUsage;
    } catch (error) {
      if (!(error instanceof AgentDelegationSuspendedError)) throw error;
      await handleNestedSignal(ctx, error);
    }
  }
}
