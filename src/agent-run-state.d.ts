import type { Agent, AgentRunInterruption, AgentRunState, Decision, JsonValue, Message, ModelConfig, NestedRunRef, RunLimitCounters, StickyDecision, ToolCallContent } from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";
import type { DurableRunStateOptions, RunStateCell, RunStateCellRecord } from "./run-state-cell.js";
import { type LoadedSkillBodiesEntry } from "./skill-load.js";
export declare const AGENT_RUN_STATE_SCHEMA_VERSION: 1;
export declare const DEFAULT_MAX_AGENT_RUN_STATE_BYTES: number;
export declare const HARD_MAX_AGENT_RUN_STATE_BYTES: number;
/** One gated tool call awaiting or holding a decision inside a suspended durable run. */
export interface PendingToolCall {
    readonly call: ToolCallContent;
    readonly status: "ready" | "dispatched";
    readonly approvalId: string;
    /** Decision persisted by a partial batch; applied when the run finally resumes. */
    readonly decision?: Decision;
}
export interface StoredAgentRunState extends AgentRunState {
    readonly input?: readonly Message[];
    /** Legacy single gated call (pre-0.0.25 checkpoints). New states write `pendingCalls`. */
    readonly pending?: {
        readonly call: ToolCallContent;
        readonly status: "ready" | "dispatched";
    };
    /** Gated calls of the current suspension, in provider-turn order. */
    readonly pendingCalls?: readonly PendingToolCall[];
    /** Suspended nested runs (supervisor children) whose pending decisions surface at this root. */
    readonly nestedRuns?: readonly NestedRunRef[];
    /** Run-scoped sticky decisions; exact scope match, dropped at any terminal status. */
    readonly stickyDecisions?: readonly StickyDecision[];
    readonly counters: RunLimitCounters;
    /** Wall deadline; absent when the run has no wall limit. Old snapshots with a deadline still parse. */
    readonly deadlineAt?: string;
    /** Loop-local durable state captured by the strategy's snapshot hook at suspension. */
    readonly loopState?: {
        readonly name: string;
        readonly revision: string;
        readonly snapshot: JsonValue;
    };
    /**
     * Opt-in session-level state (plan 015 Task 4): loaded-skill names only; bodies are
     * never persisted and reload on demand from the live registry via `load_skill`.
     * Absent by default (0.1.x checkpoints parse unchanged).
     */
    readonly sessionState?: {
        readonly loadedSkillNames?: readonly string[];
        readonly loadedSkillBodies?: readonly LoadedSkillBodiesEntry[];
    };
    /** Per-run allow-list (Task 21). Absent = full registered set (legacy checkpoints). */
    readonly toolNames?: readonly string[];
    /**
     * Set when a terminal state was written by a clean run-end stop that leaves the frontier intact:
     * a `turn.before` stop (`hook_stop`, plan 145 Task 4) or a `run.end` continuation cap
     * (`hook_limit`). Absent on every other state — a naturally finished run is never continuable.
     */
    readonly stopReason?: "hook_stop" | "hook_limit";
}
/** Session-state caps (plan 015 Task 4): bounded names charged against the run-state byte budget. */
export declare const MAX_PERSISTED_SKILL_NAMES = 64;
export declare const MAX_PERSISTED_SKILL_NAME_CHARS = 256;
/** Revision stamps of the built-in loop; custom strategies declare their own `revision`. */
export declare const BUILT_IN_LOOP_REVISIONS: Readonly<Record<string, string>>;
/** Validate a strategy snapshot as JSON-compatible and package it for the durable envelope. */
export declare function boundedLoopSnapshot(name: string, revision: string, snapshot: JsonValue): StoredAgentRunState["loopState"];
export declare function agentFingerprint(agent: Agent, revision: string): string;
export declare function agentId(agent: Agent): string;
export declare function validateRunStateOptions(options: DurableRunStateOptions): void;
export declare function saveAgentRunState(input: {
    readonly cell: RunStateCell;
    readonly state: StoredAgentRunState;
    readonly redactor?: SecretRedactor;
    readonly maxStateBytes?: number;
}): Promise<{
    readonly record: RunStateCellRecord;
    readonly state: StoredAgentRunState;
}>;
export declare function publicState(state: StoredAgentRunState): AgentRunState;
export declare function initialAgentRunState(input: {
    readonly agent: Agent;
    readonly options: DurableRunStateOptions;
    readonly runId: string;
    readonly sessionId: string;
    readonly leafId?: string;
    readonly model: ModelConfig | undefined;
    readonly counters: RunLimitCounters;
    readonly deadlineAt?: string;
    readonly status: "suspended" | "running";
    readonly interruption?: AgentRunInterruption;
    readonly messages?: readonly Message[];
    readonly pending?: StoredAgentRunState["pending"];
    readonly pendingCalls?: StoredAgentRunState["pendingCalls"];
    /** Label for an agent with no id or name: a suspension still persists one full state. */
    readonly fallbackAgentId?: string;
}): StoredAgentRunState;
export declare function parseAgentRunState(value: unknown, version?: number): StoredAgentRunState;
