/** Finalize/persist phase of runInternal (plan 059). */
import type { PendingToolCall, StoredAgentRunState } from "../../agent-run-state.js";
import type { AgentRunState, AgentRunStatus, ErrorInfo, Message, ModelConfig, NestedRunRef, RunResult, Usage } from "../../contracts.js";
import type { RunLimitTracker } from "../../run-limits.js";
import type { RoundContext, SessionHost } from "./types.js";
/** Definition revision of a kernel suspension; the fingerprint binds to it on resume. */
export declare const KERNEL_SUSPENSION_REVISION = "kernel-suspension";
export declare function persistDurable(session: SessionHost, state: StoredAgentRunState): Promise<AgentRunState>;
/** Like {@link persistDurable}, but also returns the bounded stored state (for the store entry). */
export declare function persistDurableRaw(session: SessionHost, state: StoredAgentRunState): Promise<{
    readonly state: StoredAgentRunState;
    readonly publicValue: AgentRunState;
}>;
export declare function suspendDurable(session: SessionHost, input: {
    readonly runId: string;
    readonly model: ModelConfig | undefined;
    readonly limits: RunLimitTracker;
    readonly interruption: import("../../contracts.js").AgentRunInterruption;
    readonly messages?: readonly Message[];
    readonly pending?: StoredAgentRunState["pending"];
    readonly pendingCalls?: readonly PendingToolCall[];
    /** Full replacement when provided; otherwise the recorded nested runs are preserved. */
    readonly nestedRuns?: readonly NestedRunRef[];
}): Promise<AgentRunState>;
export declare function persistSucceeded(ctx: RoundContext, loopUsage: Usage | undefined): Promise<RunResult>;
export declare function cleanupRun(input: {
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
}): Promise<void>;
