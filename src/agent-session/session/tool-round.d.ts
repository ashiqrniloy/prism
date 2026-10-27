/** Tool-round phase of runInternal (plan 059). */
import type { AgentRunRef, NestedRunRef, PendingDecision, ResumeNestedRun, EventOrigin, StickyDecision, ToolCallContent, ToolRegistry, ToolResult, Usage } from "../../contracts.js";
import { AgentDelegationSuspendedError } from "../../contracts.js";
import type { RoundContext, SessionHost } from "./types.js";
export declare function matchNestedSticky(session: SessionHost, decision: PendingDecision): StickyDecision | undefined;
export declare function matchStickyDecision(session: SessionHost, call: ToolCallContent, registry: ToolRegistry): StickyDecision | undefined;
export declare function buildPendingDecision(session: SessionHost, call: ToolCallContent, approvalId: string, registry: ToolRegistry, runId: string, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): PendingDecision;
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export declare function applyNestedRun(session: SessionHost, input: {
    ref: AgentRunRef;
    toolCall: ToolCallContent;
    path: readonly string[];
    pending: readonly PendingDecision[];
    hook?: ResumeNestedRun;
}): Promise<{
    toolResult: ToolResult;
} | {
    entry: NestedRunRef;
    pending: PendingDecision[];
}>;
/**
 * Stage the `{ ask }` calls of one tool round as pending decisions on the session, exactly like
 * the charge-time gate. The round's allowed calls still run; {@link suspendGatedRound} throws at the
 * next turn boundary or loop end, so a loop body that runs after `executeTools` completes first.
 */
export declare function stageAskDecisions(ctx: RoundContext, requests: readonly {
    readonly call: ToolCallContent;
    readonly reason: string;
}[]): void;
export declare function suspendGatedRound(ctx: RoundContext): Promise<void>;
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export declare function suspendNested(ctx: RoundContext, nested: {
    entry: NestedRunRef;
    toolCall: ToolCallContent;
    pending: PendingDecision[];
}): Promise<never>;
export declare function replayToolResult(ctx: RoundContext, result: ToolResult): Promise<void>;
/**
 * A nested (delegated) child suspended on its own approval inside a root tool call. Routing the host's
 * decision back into the child needs the nested-resume hook that the retired run-state surface carried
 * (plan 168 Task 5), and a nested suspension whose decisions no host can route is a dead end — so this
 * fails closed at the boundary. In-process delegation surfaces a suspended child through its own package
 * (`delegate_wait` returns the pending decisions) instead of through the root run.
 */
export declare function handleNestedSignal(_ctx: RoundContext, _error: AgentDelegationSuspendedError): never;
export declare function bindChargeToolRound(ctx: RoundContext): (calls: readonly ToolCallContent[]) => void | Promise<void>;
export declare function bindDispatchToolCall(ctx: RoundContext): (call: ToolCallContent, origin?: EventOrigin) => Promise<ToolResult>;
export declare function replayDurableNestedAndPending(ctx: RoundContext): Promise<void>;
export declare function runLoopUntilSettled(ctx: RoundContext): Promise<Usage | undefined>;
