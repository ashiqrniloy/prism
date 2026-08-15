/** Contracts-core loop family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, ProviderTurnResult, ToolResult } from "../contracts-protocol.js";
import type { AgentInput } from "../input.js";
import type { JsonValue, Message, ToolCallContent, Usage } from "./content.js";
import type { ProviderRequest, StructuredOutputOptions } from "./provider.js";

export interface LoopContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly history: Message[];
  readonly input: AgentInput;
  readonly inputMessages: readonly Message[];
  readonly maxToolRounds: number;
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
