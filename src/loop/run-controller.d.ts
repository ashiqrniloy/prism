import type { AgentEvent, AgentFinishReason, EventOrigin, JsonValue, ModelRef, Message, ProviderRequest, ProviderTurnResult, Session, ToolCallContent, ToolCapabilityKind, ToolResult, Usage } from "../contracts.js";
import type { HookBus } from "../hooks/index.js";
import type { AgentInput } from "../input.js";
import type { RunLimitTracker } from "../run-limits.js";
import type { ExternalStateHandle } from "../session/external-state.js";
import { type RunController, type RunTurnOptions } from "./types.js";
/** How an `ask` decision resolved: execute, refuse, or (no UI) suspend the round. */
export type AskResolution = {
    readonly kind: "allow";
} | {
    readonly kind: "deny";
    readonly reason: string;
} | {
    readonly kind: "suspend";
};
/** One call whose `tool.call` decision combined to `{ ask }`. */
export interface AskRequest {
    readonly call: ToolCallContent;
    readonly reason: string;
}
/** Internal seams the kernel assembles a {@link RunController} from. Not public. */
export interface RunControllerInternals {
    readonly session: Session;
    readonly input: AgentInput;
    readonly signal: AbortSignal;
    readonly limits: RunLimitTracker;
    /** The run's model: `RunOptions.model`, else the agent's. Absent on a model-less agent. */
    readonly model?: ModelRef;
    readonly hooks: HookBus;
    readonly sessionId: string;
    readonly runId: string;
    /** Owner of the loop slot (`"kernel"` for the default loop); owns the loop's `package.event`s. */
    readonly loopOwner: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly history: Message[];
    readonly inputMessages: readonly Message[];
    readonly maxToolRounds: number;
    readonly maxContinuations: number | null;
    readonly restoredLoopState?: JsonValue;
    /** Provider turns already completed in this run (resume). */
    readonly startTurn?: number;
    emit(event: AgentEvent): void;
    /** The loop's own turn counter advanced; the provider attempt emits the catalog's `turn.started`. */
    onTurnStart?(turn: number): void;
    assemble(nextInput: AgentInput, turn: number, options: RunTurnOptions): Promise<ProviderRequest>;
    generate(request: ProviderRequest, requestSecrets?: readonly (string | undefined)[]): Promise<ProviderTurnResult>;
    chargeToolRound?(calls: readonly ToolCallContent[]): void | Promise<void>;
    dispatchToolCall(call: ToolCallContent, origin?: EventOrigin): Promise<ToolResult>;
    isToolCallExclusive?(call: ToolCallContent): boolean;
    /** Capabilities reported to `tool.call` for a call's tool. */
    effectsFor(call: ToolCallContent): readonly ToolCapabilityKind[];
    /**
     * Resolve the `{ ask }` calls of one tool round: inline `host.ui` confirms, or a `suspend`
     * resolution for each call that no UI answered. The kernel owns this so a loop cannot skip it.
     */
    ask?(requests: readonly AskRequest[], options?: {
        readonly suspend?: boolean;
    }): Promise<ReadonlyMap<string, AskResolution>>;
    /** Whether the loop can resume a suspended run (`snapshot` and `restore`, or the default loop). */
    readonly resumable?: boolean;
    /** Fold externally reported usage into the run's usage and limits. */
    addUsage?(usage: Usage): void;
    /** Whether `session.steer()` input is waiting. */
    hasPendingSteers?(): boolean;
    /** Drain the steer queue through the `run.input` gate; resolves the messages that survived it. */
    drainSteers?(): Promise<readonly Message[]>;
    /** Register a listener for `session.steer()`; returns its unsubscribe. */
    onSteer?(listener: () => void): () => void;
    appendMessage(message: Message): Promise<void>;
    /** The `external_state` log for `key`, under the running loop's `name`. */
    externalState(key: string): ExternalStateHandle;
    applyPendingSteers?(): Promise<boolean>;
    /** Queue a `run.end` continuation through the steer path. */
    queueContinuation(decision: {
        readonly reason: string;
        readonly steer?: string | Message;
    }): void;
    setFinishReason(reason: AgentFinishReason | undefined, detail?: string): void;
    finishReason(): AgentFinishReason | undefined;
    usage(): Usage | undefined;
}
/**
 * Build the public {@link RunController} from the kernel's internal seams. The returned object's
 * own keys are exactly the primitives — no registry, provider, or dispatch handle leaks — while
 * kernel code reaches the loop's own bookkeeping through {@link RUN_CONTROLLER_INTERNALS}.
 */
export declare function createRunController(internals: RunControllerInternals): RunController;
