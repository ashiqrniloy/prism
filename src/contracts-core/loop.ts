/** Contracts-core loop family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, AgentFinishReason, ProviderTurnResult, ToolResult } from "../contracts-protocol.js";
import type { AgentInput } from "../input.js";
import type { JsonValue, Message, ToolCallContent, Usage } from "./content.js";
import type { ProviderRequest, StructuredOutputOptions } from "./provider.js";

/**
 * Metadata-only view of a run at a provider-turn boundary (plan 084 Task 2). Hosts branch on
 * counters, never content: tool arguments, prompts, and tool results are not fields.
 */
export interface TurnBoundaryContext {
  readonly sessionId: string;
  readonly runId: string;
  /** 1-based index of the provider turn this boundary precedes. */
  readonly turn: number;
  /** Provider turns already completed in this run (`turn - 1`; 0 at the first boundary). */
  readonly turns: number;
  /** Host tool calls dispatched so far in this run. */
  readonly toolCalls: number;
  /** Run-total usage so far, when the provider reported any. */
  readonly usage?: Usage;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Synchronous decision at a turn boundary. `stop` ends the run cleanly; `continue` runs the turn. */
export type TurnStopDecision = { readonly action: "continue" } | { readonly action: "stop"; readonly reason: string };

/**
 * Host turn policy (plan 084 Task 2). Evaluated before every provider request, at the same
 * boundary a `checkpointPolicy: "every-turn"` checkpoint is written. Omit it and the run keeps
 * its exact 0.8.x turn structure (no callback, no reads).
 */
export interface TurnPolicyOptions {
  /**
   * Clean turn cap. Reaching it stops the run (`stopReason: "turn_limit"`) instead of failing it
   * with a limit breach. A run overlay may only narrow `limits.maxTurns`; widening throws.
   */
  readonly maxTurns?: number;
  /**
   * Consulted before every provider request. Returning `stop` ends the run cleanly with
   * `stopReason: "host_policy"` and a resumable checkpoint (`decision: "continue"` resumes it).
   * Must be synchronous and must not throw; a throw fails the run with `ERR_PRISM_TURN_POLICY`.
   */
  readonly stop?: (context: TurnBoundaryContext) => TurnStopDecision;
}

export interface LoopContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly history: Message[];
  readonly input: AgentInput;
  readonly inputMessages: readonly Message[];
  readonly maxToolRounds: number;
  /**
   * Why the loop stopped, when a limit/ceiling ends the run cleanly (F4). Strategies set
   * this at ceiling exits (e.g. `turn_limit`); the runtime copies it onto `agent_finished`.
   */
  finishReason?: AgentFinishReason;
  /** Maximum independent tool calls dispatched concurrently per provider turn. Default `1`. */
  readonly toolConcurrency: number;
  assemble(nextInput: AgentInput, toolResults?: readonly ToolResult[], turn?: number): Promise<ProviderRequest>;
  /**
   * Charges a complete tool round before any call in it can start. On durable interrupt
   * runs this is also the round-level approval gate: it collects every gated call of the
   * round into one suspension. Loops must await it; dispatch without it falls back to
   * per-call single-decision suspensions.
   */
  chargeToolRound?(calls: readonly ToolCallContent[]): void | Promise<void>;
  generate(request: ProviderRequest): Promise<ProviderTurnResult>;
  dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;
  isToolCallExclusive?(call: ToolCallContent): boolean;
  appendMessage(message: Message): Promise<void>;
  emit(event: AgentEvent): void;
  /** True when mid-run steers are queued for the next provider turn. */
  hasPendingSteers?(): boolean;
  /** Drain pending steers into history/session. Returns true when any were applied. */
  applyPendingSteers?(): Promise<boolean>;
  /** Snapshot captured at the last suspension when the strategy declared snapshot/restore. Present only on resume. */
  readonly restoredLoopState?: JsonValue;
}

export interface AgentLoopStrategy {
  readonly name: string;
  /** Host-authored loop revision. Joins the durable-run fingerprint when snapshot hooks are present. */
  readonly revision?: string;
  run(ctx: LoopContext): Promise<Usage | undefined>;
  /**
   * Capture loop-local resumable state at suspension. Must return a JSON-compatible value;
   * core bounds and redacts it inside the durable run-state envelope. Declare together with
   * `restore`; a custom strategy without both hooks is rejected before any provider call on
   * durable runs (`AgentLoopStateError` / `ERR_PRISM_LOOP_NOT_DURABLE`).
   */
  snapshot?(): JsonValue;
  /** Rehydrate from a previously captured snapshot; must throw on drift. Called before `run` on resume. */
  restore?(snapshot: JsonValue): void;
}

export type AgentLoopOptions =
  | {
      readonly strategy: "single-shot";
      /** Independent tool calls per turn run concurrently up to this limit. Default `1` (sequential). */
      readonly toolConcurrency?: number;
    }
  | {
      readonly strategy: "generate-validate-revise";
      readonly validator: ArtifactValidator<unknown>;
      readonly parser?: ArtifactParser<unknown>;
      readonly repairer?: ArtifactRepairer<unknown>;
      readonly maxRevisions?: number;
      /** Dispatch provider tool calls in artifact turns. Default `"disabled"`; `"bounded"` uses RunOptions.maxToolRounds sequentially. */
      readonly toolCalls?: "disabled" | "bounded";
      /** Native provider JSON-schema output. Ignored when `structuredOutputMode` is `artifact-loop`. */
      readonly structuredOutput?: StructuredOutputOptions;
      /** `native` maps schema to capable providers; `artifact-loop` keeps repair turns only. */
      readonly structuredOutputMode?: "native" | "artifact-loop";
      /**
       * When to attach native `structuredOutput` under `toolCalls: "bounded"`.
       * `every-turn` (default): schema on every provider request (legacy).
       * `final-turn-only`: tool-eligible turns omit schema; artifact/revision turns send schema and withdraw tools.
       */
      readonly structuredOutputTiming?: "every-turn" | "final-turn-only";
    };

export interface ArtifactValidation {
  readonly ok: boolean;
  readonly errors?: readonly { readonly path?: string; readonly message: string }[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ArtifactContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  readonly signal: AbortSignal;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ArtifactParseResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
}

export type ArtifactParser<T> = (text: string, ctx: ArtifactContext) => ArtifactParseResult<T> | Promise<ArtifactParseResult<T>>;

export type ArtifactValidator<T> = (value: T, ctx: ArtifactContext) => ArtifactValidation | Promise<ArtifactValidation>;

export type ArtifactRepairer<T> = (
  value: T | undefined,
  failure: ArtifactValidation,
  ctx: ArtifactContext,
) => AgentInput | Promise<AgentInput>;
