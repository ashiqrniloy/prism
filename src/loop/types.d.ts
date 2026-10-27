import type { AgentFinishReason, EventOrigin, JsonValue, Message, ModelRef, Session, TextContent, ThinkingContent, ToolCallContent, ToolCapabilityKind, ToolResult, Usage } from "../contracts.js";
import type { AgentInput } from "../input.js";
import type { RunLimitTracker } from "../run-limits.js";
import type { ExternalStateHandle } from "../session/external-state.js";
/** Per-turn options passed to {@link RunController.turn}. */
export interface RunTurnOptions {
    /** `false` sends no tools; a name list narrows the run grant (clamped). Omit for the full set. */
    readonly tools?: false | readonly string[];
    /** Overrides the run's system prompt for this turn only. */
    readonly system?: string;
}
/** Result of one provider turn. `stopped` means the run must end; `toolCalls` are dispatchable. */
export interface RunTurnResult {
    readonly stopped: boolean;
    readonly toolCalls: readonly ToolCallContent[];
    /** A mid-turn soft interrupt was drained: the loop must re-enter with a fresh turn. */
    readonly steered?: boolean;
    readonly finishReason?: AgentFinishReason;
    readonly usage?: Usage;
}
/** Result of {@link RunController.end}: `continue: true` means the loop must re-enter, injecting `reason`. */
export type RunEndResult = {
    readonly continue: false;
} | {
    readonly continue: true;
    readonly reason: string;
};
/** Activity an external agent performed that a driver reports through {@link RunController.observe}. */
export type ExternalActivity = {
    readonly kind: "message.delta";
    readonly content: TextContent | ThinkingContent;
} | {
    readonly kind: "message";
    readonly message: Message;
} | {
    readonly kind: "tool.started";
    readonly call: {
        readonly id: string;
        readonly name: string;
        readonly args?: JsonValue;
    };
    readonly effects?: readonly ToolCapabilityKind[];
} | {
    readonly kind: "tool.progress";
    readonly toolCallId: string;
    readonly progress: JsonValue;
} | {
    readonly kind: "tool.completed";
    readonly toolCallId: string;
    readonly status: "finished" | "error" | "blocked";
    readonly result?: JsonValue;
    readonly error?: string;
} | {
    readonly kind: "skill";
    readonly name: string;
    readonly source: "native" | "tool" | "explicit" | "path";
    readonly resolved: boolean;
} | {
    readonly kind: "file";
    readonly path: string;
    readonly change: "created" | "modified" | "deleted" | "moved";
    readonly diff?: string;
    readonly source: "agent" | "diff";
} | {
    readonly kind: "plan";
    readonly entries: readonly {
        readonly title: string;
        readonly status: string;
    }[];
} | {
    readonly kind: "subagent";
    readonly phase: "started" | "completed";
    readonly id: string;
    readonly name?: string;
    readonly parentToolCallId?: string;
    readonly result?: string;
} | {
    readonly kind: "compaction";
    readonly phase: "started" | "completed";
    readonly summary?: string;
} | {
    readonly kind: "notice";
    readonly level: "info" | "warn" | "error";
    readonly code: string;
    readonly message: string;
} | {
    readonly kind: "usage";
    readonly usage: Usage;
} | {
    readonly kind: "raw";
    readonly vendor: string;
    readonly type: string;
    readonly data: JsonValue;
};
/** A tool call an external agent wants to make, put to the `tool.call` gate by {@link RunController.ask}. */
export interface ExternalToolRequest {
    readonly toolCallId: string;
    readonly name: string;
    readonly args: JsonValue;
    readonly effects: readonly ToolCapabilityKind[];
}
/**
 * The gate's answer. A deny carries a `reason`; the kernel's own reasons are `non_interactive`,
 * `approval_pending`, `rewrite_unsupported`, and `respond_unsupported`.
 */
export type ExternalToolDecision = {
    readonly allow: true;
    readonly args?: JsonValue;
} | {
    readonly allow: false;
    readonly reason: string;
} | {
    readonly respond: JsonValue;
};
/** What the driver's vendor can accept back from {@link RunController.ask}; both default to unsupported. */
export interface ExternalAskSupport {
    readonly rewrite?: boolean;
    readonly respond?: boolean;
}
/** The `package.event` names {@link RunController.observe} emits for non-catalog activity. */
export declare const EXTERNAL_ACTIVITY_EVENTS: {
    readonly skill: "agent.skill";
    readonly file: "agent.file";
    readonly plan: "agent.plan";
    readonly subagent: "agent.subagent";
    readonly compaction: "agent.compaction";
    readonly notice: "agent.notice";
    readonly raw: "agent.raw";
};
/**
 * The only handle a {@link LoopStrategy} gets (roadmap §2.5). It exposes the kernel primitives and
 * nothing else: no registry, no provider, no dispatch. A loop reaches a tool only through
 * {@link executeTools} and a model only through {@link turn}, so replacing the loop cannot bypass
 * the `tool.call`/`model.request`/`model.call` gates.
 */
export interface RunController {
    readonly session: Session;
    readonly input: AgentInput;
    readonly signal: AbortSignal;
    readonly limits: RunLimitTracker;
    /** The run's model: `RunOptions.model`, else the agent's. Absent on a model-less agent. */
    readonly model?: ModelRef;
    /** One provider turn: fires `turn.before`, `context.build`, `model.request`, `model.call`, `model.response`, `message.append`. */
    turn(options?: RunTurnOptions): Promise<RunTurnResult>;
    /**
     * Dispatch tool calls: fires `tool.call`, `tool.execute`, `tool.result`, `message.append` per call, and
     * returns the results in input order (denied and approval-pending calls included). Re-entrant: several
     * overlapping calls are independent. `origin` rides the `tool.call` payload and the call's `tool.*` events.
     */
    executeTools(calls: readonly ToolCallContent[], options?: {
        readonly concurrency?: number;
        readonly origin?: EventOrigin;
    }): Promise<readonly ToolResult[]>;
    /**
     * An append-only archive for what an external agent keeps outside Prism, persisted as bounded, redacted
     * `external_state` entries on the session's branch under this loop's name. Excluded from `session.messages()`,
     * copied by `fork()`, deleted with the session.
     */
    state(key: string): ExternalStateHandle;
    /** Append a transcript message; fires `message.append`. */
    append(message: Message): Promise<void>;
    /**
     * Natural loop end: fires `run.end`; `continue: true` carries the `reason` to inject and means re-enter
     * (capped by `limits.maxContinuations`). Callable from any async context during `run()`.
     */
    end(): Promise<RunEndResult>;
    /**
     * Record activity an external agent performed. Text and thinking go through `message.delta` /
     * `message.append`; `tool.*` emit the catalog events with `origin.executedBy: "external"` and charge
     * `maxToolCalls`; other kinds emit `agent.*` package events; usage folds into the run. Never fires `tool.call`.
     */
    observe(activity: ExternalActivity): Promise<void>;
    /**
     * Put an external agent's tool call to the `tool.call` gate before it runs. Resolves `ask` through
     * `host.ui`; with no answer it stages a suspension on a resumable loop (`approval_pending`) and
     * otherwise denies (`non_interactive`). A throwing gate is a deny.
     */
    ask(request: ExternalToolRequest, support?: ExternalAskSupport): Promise<ExternalToolDecision>;
    /** Input queued by `session.steer()`, after the `run.input` transform. Ends when the run aborts or the consumer stops. */
    steers(): AsyncIterable<Message>;
    /** Emit one `package.event` owned by the loop's slot owner. A catalog event name throws `emit_reserved_name`. */
    emit(name: string, data: JsonValue): void;
}
/** The loop contract (roadmap §2.5). `revision` joins the durable fingerprint. */
export interface LoopStrategy {
    readonly name: string;
    readonly revision?: string;
    /** `false`: the loop never calls `turn()`, so the agent may be created without a model. Any other loop requires one (`model_required`). */
    readonly usesModel?: false;
    /** `"none"`: a `RunOptions.model` fails the run with `run_model_unsupported`. `"passthrough"` (default) exposes it as `run.model`. */
    readonly runModel?: "passthrough" | "none";
    run(run: RunController): Promise<void>;
    snapshot?(): JsonValue;
    restore?(snapshot: JsonValue): void;
}
