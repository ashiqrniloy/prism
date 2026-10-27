import type { StoredAgentRunState } from "./agent-run-state.js";
import { Agent, AgentRunState, DecisionScope, Guardrail, NestedRunOutcome, PendingDecision, Decision, StickyDecision, ToolResult } from "./contracts.js";
import type { Principal } from "./contracts-core/principal.js";
import type { DurableRunStateOptions } from "./run-state-cell.js";
/** Pending decisions of a suspended state, synthesizing the legacy single-approval shape. */
export declare function pendingDecisionsOf(state: StoredAgentRunState): readonly PendingDecision[] | undefined;
interface ResolvedRunDecisions {
    readonly decisionsById: ReadonlyMap<string, Decision>;
    readonly stickyDecisions: readonly StickyDecision[];
    readonly remaining: readonly PendingDecision[];
}
/**
 * Validate one decision batch against the suspended state. Fail-closed and atomic: any
 * invalid entry rejects the whole batch before any CAS, leaving state and version untouched.
 * Unknown and foreign approval ids share one non-enumerating error.
 */
export declare function resolveRunDecisions(input: {
    readonly agent: Agent;
    readonly state: StoredAgentRunState;
    readonly decisions: readonly Decision[];
    readonly signal?: AbortSignal;
    /**
     * Plan 104 T6: extra `tool_input` pack rules for decision-time revalidation of modified arguments —
     * the resumed session's restored pack rules. Session-scoped on purpose: `agent.config.guardrails` is
     * never mutated, so no other session of that agent inherits the packs.
     */
    readonly toolInputGuardrails?: readonly Guardrail<"tool_input">[];
}): Promise<ResolvedRunDecisions>;
/**
 * Resolve a tool's declared elicitation contract for a gated call. A throwing hook falls back to
 * plain tool approval: malformed model args then surface as a tool error after approval, never
 * as a run failure at the gate. Output is bounded before it enters the pending-decision record.
 */
export declare class AgentRunSuspended extends Error {
    readonly state: AgentRunState;
    readonly interruption: import("./contracts.js").AgentRunInterruption;
    readonly code = "ERR_PRISM_AGENT_RUN_SUSPENDED";
    constructor(state: AgentRunState, interruption: import("./contracts.js").AgentRunInterruption);
}
/** Root-visible nested approval id: hashed so it stays bounded and non-enumerating at any depth. */
export declare function nestedApprovalId(runId: string, childApprovalId: string): string;
export declare function pathsEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean;
export declare function decisionScopesEqual(a: DecisionScope, b: DecisionScope): boolean;
export declare function nestedOutcomeToolResult(outcome: Exclude<NestedRunOutcome, {
    status: "suspended";
}>, toolCallId: string, name: string): ToolResult;
/** The run in flight for a session: its private run-state cell, the state so far, and a resume's decisions. */
export interface ActiveDurableRun {
    readonly options: DurableRunStateOptions;
    state?: StoredAgentRunState;
    /** Validated decisions driving the pending-call replay on a resumed run. */
    readonly decisions?: ReadonlyMap<string, Decision>;
}
/** Compact redacted principal reference used in decision scopes; never a credential. */
export declare function decisionPrincipalRef(principal: Principal | undefined): string | undefined;
export {};
