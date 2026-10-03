import type { AgentEvent, AgentFinishReason, Session, JsonValue, Message, ToolCallContent, Usage } from "../contracts.js";
import type { AgentInput } from "../input.js";
import type { RunLimitTracker } from "../run-limits.js";

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

/** Result of {@link RunController.end}: `continue: true` means the loop must re-enter. */
export interface RunEndResult {
  readonly continue: boolean;
}

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
  /** One provider turn: fires `turn.before`, `context.build`, `model.request`, `model.call`, `model.response`, `message.append`. */
  turn(options?: RunTurnOptions): Promise<RunTurnResult>;
  /** Dispatch tool calls: fires `tool.call`, `tool.execute`, `tool.result`, `message.append` per call. */
  executeTools(calls: readonly ToolCallContent[], options?: { readonly concurrency?: number }): Promise<void>;
  /** Append a transcript message; fires `message.append`. */
  append(message: Message): Promise<void>;
  /** Natural loop end: fires `run.end`; `continue: true` means re-enter (capped by `limits.maxContinuations`). */
  end(): Promise<RunEndResult>;
  /** Emit a `package.event`-shaped event with the given package owner. */
  emit(event: AgentEvent): void;
}

/** The loop contract (roadmap §2.5). `revision` joins the durable fingerprint. */
export interface LoopStrategy {
  readonly name: string;
  readonly revision?: string;
  run(run: RunController): Promise<void>;
  snapshot?(): JsonValue;
  restore?(snapshot: JsonValue): void;
}
