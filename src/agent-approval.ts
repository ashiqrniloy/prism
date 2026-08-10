// Approval / pending-decision helpers split from agents.ts at 0.1.4 (verbatim move; internal, not public API).
import { createHash } from "node:crypto";
import type { StoredAgentRunState } from "./agent-run-state.js";
import { activeTools, validateElicitationPayload } from "./agent-tool-dispatch.js";
import {
  Agent,
  AgentDecisionError,
  AgentRunState,
  AgentRunStateOptions,
  DecisionScope,
  DEFAULT_MAX_STICKY_DECISIONS,
  HARD_MAX_PENDING_DECISIONS,
  JsonObject,
  MAX_DECISION_REASON_BYTES,
  MAX_ELICITATION_BYTES,
  NestedRunOutcome,
  PendingDecision,
  RunDecision,
  StickyDecision,
  ToolCallContent,
  ToolRegistry,
  ToolResult,
} from "./contracts.js";
import { runGuardrails } from "./guardrails.js";
import type { AgentIdentity } from "./identity.js";
import { canonicalToolEffectJson } from "./tool-effects.js";

/** Pending decisions of a suspended state, synthesizing the legacy single-approval shape. */
export function pendingDecisionsOf(state: StoredAgentRunState): readonly PendingDecision[] | undefined {
  if (state.interruption?.pendingDecisions) return state.interruption.pendingDecisions;
  if (state.pending) {
    return [
      {
        approvalId: state.pending.call.id,
        kind: "tool_approval",
        toolCallId: state.pending.call.id,
        scope: { toolName: state.pending.call.name },
        reason: state.interruption?.reason ?? "Tool side effect requires approval",
      },
    ];
  }
  return undefined;
}

interface ResolvedRunDecisions {
  readonly decisionsById: ReadonlyMap<string, RunDecision>;
  readonly stickyDecisions: readonly StickyDecision[];
  readonly remaining: readonly PendingDecision[];
}

/**
 * Validate one decision batch against the suspended state. Fail-closed and atomic: any
 * invalid entry rejects the whole batch before any CAS, leaving state and version untouched.
 * Unknown and foreign approval ids share one non-enumerating error.
 */
export async function resolveRunDecisions(input: {
  readonly agent: Agent;
  readonly state: StoredAgentRunState;
  readonly decisions: readonly RunDecision[];
  readonly signal?: AbortSignal;
}): Promise<ResolvedRunDecisions> {
  const { agent, state, decisions } = input;
  if (decisions.length === 0) throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Decision batch must not be empty");
  if (decisions.length > HARD_MAX_PENDING_DECISIONS) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Decision batch exceeds ${HARD_MAX_PENDING_DECISIONS} entries`);
  }
  const pending = pendingDecisionsOf(state);
  if (!pending?.length) throw new AgentDecisionError("ERR_PRISM_DECISION_UNKNOWN", "No pending approval decisions for this run");
  const byId = new Map(pending.map((entry) => [entry.approvalId, entry]));
  const seen = new Set<string>();
  const decisionsById = new Map<string, RunDecision>();
  const stickies: StickyDecision[] = [];
  const decidedAt = new Date().toISOString();
  const { registry } = activeTools(agent.config.tools);
  for (const decision of decisions) {
    if (seen.has(decision.approvalId)) {
      throw new AgentDecisionError("ERR_PRISM_DECISION_DUPLICATE", "Duplicate approval decision in batch");
    }
    seen.add(decision.approvalId);
    const target = byId.get(decision.approvalId);
    if (!target) throw new AgentDecisionError("ERR_PRISM_DECISION_UNKNOWN", "Unknown approval decision");
    if (decision.reason !== undefined && Buffer.byteLength(decision.reason, "utf8") > MAX_DECISION_REASON_BYTES) {
      throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Decision reason exceeds ${MAX_DECISION_REASON_BYTES} bytes`);
    }
    if (
      decision.outcome !== "allow_once" &&
      decision.outcome !== "allow_for_run" &&
      decision.outcome !== "reject_once" &&
      decision.outcome !== "reject_for_run"
    ) {
      throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Unknown approval outcome");
    }
    if (decision.modifiedArguments !== undefined) {
      if (target.kind !== "tool_approval" || !target.toolCallId) {
        throw new AgentDecisionError("ERR_PRISM_DECISION_SCOPE", "Modified arguments apply only to tool approvals");
      }
      await validateModifiedArguments(agent, registry, state, target, decision.modifiedArguments, input.signal);
    }
    if (decision.elicitation !== undefined) {
      if (target.kind !== "elicitation") {
        throw new AgentDecisionError("ERR_PRISM_DECISION_SCOPE", "Elicitation payload applies only to elicitation decisions");
      }
      await validateElicitationPayload(agent, state, target, decision.elicitation, input.signal);
    }
    decisionsById.set(decision.approvalId, decision);
    if (decision.outcome === "allow_for_run" || decision.outcome === "reject_for_run") {
      stickies.push({
        // A decision with modified arguments must not stick to the original arguments hash:
        // the modification is one-off, so the sticky scope matches by name/effect/identity only.
        scope: decision.modifiedArguments !== undefined ? { ...target.scope, argumentsHash: undefined } : target.scope,
        outcome: decision.outcome,
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        // Root-owned sticky scope includes the delegation path for nested decisions.
        ...(target.attribution ? { attribution: target.attribution } : {}),
        decidedAt,
      });
    }
  }
  const stickyDecisions = [...(state.stickyDecisions ?? []), ...stickies];
  if (stickyDecisions.length > DEFAULT_MAX_STICKY_DECISIONS) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Sticky decisions exceed ${DEFAULT_MAX_STICKY_DECISIONS} per run`);
  }
  return {
    decisionsById,
    stickyDecisions,
    remaining: pending.filter((entry) => !seen.has(entry.approvalId)),
  };
}

/** Decision-time revalidation of modified arguments: schema, then input guardrails. Policy and trust re-run at dispatch. */
async function validateModifiedArguments(
  agent: Agent,
  registry: ToolRegistry,
  state: StoredAgentRunState,
  target: PendingDecision,
  modified: JsonObject,
  signal?: AbortSignal,
): Promise<void> {
  const invalid = (message: string, cause?: unknown) => new AgentDecisionError("ERR_PRISM_DECISION_INVALID", message, { cause });
  if (JSON.stringify(modified) === undefined || Buffer.byteLength(JSON.stringify(modified), "utf8") > MAX_ELICITATION_BYTES) {
    throw invalid("Modified arguments must be a bounded JSON object");
  }
  const call =
    state.pendingCalls?.find((entry) => entry.approvalId === target.approvalId)?.call ??
    (state.pending && state.pending.call.id === target.toolCallId ? state.pending.call : undefined);
  const toolName = target.scope.toolName ?? call?.name ?? "";
  const tool = registry.get(toolName);
  const context = { sessionId: state.sessionId, runId: state.runId, toolCallId: target.toolCallId ?? "", signal };
  if (agent.config.validator && tool) {
    const validation = await agent.config.validator(tool, modified, context);
    if (validation) throw invalid("Modified arguments failed schema validation");
  }
  const value: ToolCallContent = call
    ? { ...call, arguments: modified }
    : { type: "tool_call", id: target.toolCallId ?? "", name: toolName, arguments: modified };
  const guarded = await runGuardrails({
    stage: "tool_input",
    guardrails: agent.config.guardrails,
    value,
    context: {
      sessionId: state.sessionId,
      runId: state.runId,
      toolCallId: target.toolCallId,
      toolName,
      metadata: {},
      signal,
    },
    redactor: agent.config.redactor,
  });
  if (guarded.terminal) throw invalid("Modified arguments blocked by guardrail");
}

/**
 * Resolve a tool's declared elicitation contract for a gated call. A throwing hook falls back to
 * plain tool approval: malformed model args then surface as a tool error after approval, never
 * as a run failure at the gate. Output is bounded before it enters the pending-decision record.
 */
export class AgentRunSuspended extends Error {
  readonly code = "ERR_PRISM_AGENT_RUN_SUSPENDED";
  constructor(
    readonly state: AgentRunState,
    readonly interruption: import("./contracts.js").AgentRunInterruption,
  ) {
    super("Agent run suspended");
    this.name = "AgentRunSuspended";
  }
}

/** Root-visible nested approval id: hashed so it stays bounded and non-enumerating at any depth. */
export function nestedApprovalId(runId: string, childApprovalId: string): string {
  return `sub_${createHash("sha256").update(`${runId}:${childApprovalId}`).digest("hex")}`;
}

export function pathsEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function decisionScopesEqual(a: DecisionScope, b: DecisionScope): boolean {
  if (a.toolName !== b.toolName || a.argumentsHash !== b.argumentsHash || a.effectKind !== b.effectKind || a.identity !== b.identity)
    return false;
  if (a.actionConstraints === undefined || b.actionConstraints === undefined) return a.actionConstraints === b.actionConstraints;
  const keys = Object.keys(a.actionConstraints);
  return (
    keys.length === Object.keys(b.actionConstraints).length &&
    keys.every(
      (key) =>
        key in b.actionConstraints! &&
        canonicalToolEffectJson(a.actionConstraints![key]!) === canonicalToolEffectJson(b.actionConstraints![key]!),
    )
  );
}

export function nestedOutcomeToolResult(
  outcome: Exclude<NestedRunOutcome, { status: "suspended" }>,
  toolCallId: string,
  name: string,
): ToolResult {
  return outcome.status === "completed"
    ? { toolCallId, name, ...(outcome.value !== undefined ? { value: outcome.value } : {}) }
    : { toolCallId, name, error: { code: outcome.code, message: outcome.message } };
}

export interface ActiveDurableRun {
  readonly options: AgentRunStateOptions;
  state?: StoredAgentRunState;
  version: number;
  /** Validated decisions driving the pending-call replay on a resumed run. */
  readonly decisions?: ReadonlyMap<string, RunDecision>;
}

/** Compact redacted principal reference used in decision scopes; never a credential. */
export function decisionIdentityRef(identity: AgentIdentity | undefined): string | undefined {
  return identity ? `${identity.tenantId}:${identity.principal.kind}:${identity.principal.id}` : undefined;
}
