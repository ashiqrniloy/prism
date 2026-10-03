import type { SessionContext } from "../session-context.js";
import type {
  AgentEvent,
  AgentEventPayload,
  ContextBlock,
  JsonObject,
  Message,
  ProviderEvent,
  ProviderRequest,
  ToolCapabilityKind,
  ToolDefinition,
  ToolResult,
  Usage,
} from "../contracts.js";

/** The four dispatch shapes a hook can have. */
export type HookKind = "observe" | "transform" | "decide" | "around";

/** Marker returned by {@link HookContext.reject} to stop a transform chain. */
export interface HookRejection {
  readonly __prismHookRejection: string;
}

/** Per-dispatch context. `owner` is set by the kernel, never by a handler. */
export interface HookContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
  /** Emit an agent event (used by `RunController.emit`). */
  readonly emit: (event: AgentEvent) => void;
  /** Stop a transform chain with a reason; the bus throws `HookRejectedError`. */
  readonly reject: (reason: string) => HookRejection;
  /** The session, bound to the registering owner. Absent when the bus is not bound to a session. */
  readonly session?: SessionContext;
}

export type ObserveHook<P> = (payload: P, context: HookContext) => void | Promise<void>;

export type TransformHook<P, R> = (
  value: P,
  context: HookContext,
) => R | undefined | HookRejection | Promise<R | undefined | HookRejection>;

export type DecideHook<P, D> = (payload: P, context: HookContext) => D | undefined | Promise<D | undefined>;

export type AroundHook<P, R> = (payload: P, next: (value: P) => Promise<R>, context: HookContext) => Promise<R>;

export interface HookOptions {
  /** Higher runs first. Ties run in registration (load) order. */
  readonly priority?: number;
  /** Optional suffix for the registration id: `<owner>:<hook>[#<id>]`. */
  readonly id?: string;
  /** Transform hooks only: a throw emits `hook.error` and keeps the current value. */
  readonly onError?: "ignore";
}

export interface HookRegistrationInfo {
  readonly name: HookName;
  readonly kind: HookKind;
  readonly owner: string;
  /** Full registration id: `<owner>:<hook>[#<id>]`. */
  readonly id: string;
  readonly priority: number;
}

/** Decide payloads and results. */

export interface TurnBeforePayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  readonly usage?: Usage;
}

export interface TurnBeforeDecision {
  readonly stop: string;
}

export interface ContextDraft {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  /**
   * Context blocks a handler is ADDING this turn. The kernel renders them into `messages` at the
   * stable-prefix boundary, so a handler that wants its blocks as text can use either channel.
   */
  readonly context?: readonly ContextBlock[];
  /** When set, replaces the leading system message (or prepends one). */
  readonly systemPrompt?: string;
}

export interface ToolCallHookPayload {
  readonly name: string;
  readonly args: JsonObject;
  readonly effects: readonly ToolCapabilityKind[];
  readonly callId: string;
  readonly sessionId: string;
  readonly runId: string;
}

export type ToolCallDecision =
  | "allow"
  | { readonly deny: string }
  | { readonly ask: string }
  | { readonly rewrite: JsonObject }
  | { readonly respond: ToolResult };

export interface ToolExecuteHookPayload {
  readonly name: string;
  readonly args: JsonObject;
  readonly callId: string;
  readonly sessionId: string;
  readonly runId: string;
}

/**
 * `tool.result` transform payload. A `ToolResult` carries no session identity, so the controller
 * stamps the session/run onto it; handlers may return a plain {@link ToolResult}.
 */
export type ToolResultHookPayload = ToolResult & { readonly sessionId?: string; readonly runId?: string };

/**
 * `model.request` may return a plain request or this shape. `secrets` are values the transform
 * introduced into the request; the kernel keeps redacting provider errors with them, so a transform
 * cannot leak a credential it injected.
 */
export interface ModelRequestTransformResult {
  readonly request: ProviderRequest;
  readonly secrets?: readonly (string | undefined)[];
}

export interface RunEndPayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly finishReason?: string;
  readonly usage?: Usage;
  /** Live transcript at the natural loop end; handlers read it, never mutate it. */
  readonly history: readonly Message[];
  /** Provider turns assembled so far in this run; a resumed run continues the counter. */
  readonly turn: number;
  /** `run.end` continuations already taken in this run (0 on the first end). */
  readonly continuations: number;
}

export interface RunEndDecision {
  /**
   * Re-enter the loop: `reason` is queued as a user steer through the same path a host would use,
   * optionally followed by `steer` (a second message, or a fully-formed one). Capped by
   * `limits.maxContinuations`; the first continue wins.
   */
  readonly continue: { readonly reason: string; readonly steer?: string | Message };
}

export interface CompactionWhenPayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly messages: readonly Message[];
  /** Session entries behind `messages`, so a `threshold_entries` trigger can express itself. */
  readonly entryCount: number;
  /** Provider turns assembled so far in this run; undefined at run start (between turns, defined). */
  readonly turn?: number;
  readonly estimatedTokens?: number;
}

export interface CompactionWhenDecision {
  readonly compact: true;
}

/** Named catalog hooks (roadmap §2.4). Every `AgentEvent["type"]` is additionally an observe hook. */
export interface NamedHookCatalog {
  "run.input": TransformHook<readonly Message[], readonly Message[]>;
  "turn.before": DecideHook<TurnBeforePayload, TurnBeforeDecision>;
  "context.build": TransformHook<ContextDraft, ContextDraft>;
  "model.request": TransformHook<ProviderRequest, ProviderRequest | ModelRequestTransformResult>;
  "model.call": AroundHook<ProviderRequest, AsyncIterable<ProviderEvent>>;
  "model.response": TransformHook<Message, Message>;
  "tool.call": DecideHook<ToolCallHookPayload, ToolCallDecision>;
  "tool.execute": AroundHook<ToolExecuteHookPayload, ToolResult>;
  "tool.result": TransformHook<ToolResultHookPayload, ToolResult>;
  "message.append": TransformHook<Message, Message>;
  "run.end": DecideHook<RunEndPayload, RunEndDecision>;
  "compaction.when": DecideHook<CompactionWhenPayload, CompactionWhenDecision>;
}

/** One observe hook per agent event type. */
export type ObserveHookName = AgentEventPayload["type"];

type ObserveCatalog = { [K in ObserveHookName]: ObserveHook<Extract<AgentEventPayload, { readonly type: K }>> };

export type HookCatalog = NamedHookCatalog & ObserveCatalog;

export type NamedHookName = keyof NamedHookCatalog;

export type HookName = keyof HookCatalog;

/** Kind of a named hook, from the catalog table. */
export const HOOK_KINDS = {
  "run.input": "transform",
  "turn.before": "decide",
  "context.build": "transform",
  "model.request": "transform",
  "model.call": "around",
  "model.response": "transform",
  "tool.call": "decide",
  "tool.execute": "around",
  "tool.result": "transform",
  "message.append": "transform",
  "run.end": "decide",
  "compaction.when": "decide",
} as const satisfies Record<NamedHookName, HookKind>;

export type HookKindOf<N extends HookName> = N extends NamedHookName ? (typeof HOOK_KINDS)[N] : "observe";

export type TransformHookName = { [K in NamedHookName]: (typeof HOOK_KINDS)[K] extends "transform" ? K : never }[NamedHookName];
export type DecideHookName = { [K in NamedHookName]: (typeof HOOK_KINDS)[K] extends "decide" ? K : never }[NamedHookName];
export type AroundHookName = { [K in NamedHookName]: (typeof HOOK_KINDS)[K] extends "around" ? K : never }[NamedHookName];

export type HookHandler<N extends HookName> = HookCatalog[N];
export type HookPayload<N extends HookName> = Parameters<HookCatalog[N]>[0];
export type HookResult<N extends HookName> = Awaited<ReturnType<HookCatalog[N]>>;
export type HookDecision<N extends DecideHookName> = NonNullable<HookResult<N>>;
/** What a transform chain returns: its value, or nothing (`undefined` keeps the current value). */
export type HookTransformResult<N extends TransformHookName> = Exclude<HookResult<N>, undefined | HookRejection>;

export interface HookRegistrar {
  on<N extends HookName>(name: N, handler: HookCatalog[N], options?: HookOptions): void;
}

/**
 * Kernel-internal bus, one per agent. Registration goes through an owner-bound {@link HookRegistrar}
 * (`registrar(owner)`), so every registration id is `<owner>:<hook>[#id]` and the owner is never
 * caller-controlled. Hosts reach it through `AgentConfig.hooks`; packages through `PackageAPI.hooks`.
 */
export interface HookBus {
  /** The registrar for `owner`. Calling it twice with the same owner returns the same registrar. */
  registrar(owner: string): HookRegistrar;
  /**
   * Removes every registration with this id and returns whether any existed. Unnamed registrations
   * under one owner and hook share an id, so removing it removes them all.
   */
  remove(id: string): boolean;
  observe<N extends ObserveHookName>(name: N, payload: HookPayload<N>): void;
  transform<N extends TransformHookName>(name: N, value: HookPayload<N>): Promise<HookTransformResult<N>>;
  decide<N extends DecideHookName>(name: N, payload: HookPayload<N>): Promise<HookDecision<N> | undefined>;
  around<N extends AroundHookName>(
    name: N,
    payload: HookPayload<N>,
    terminal: (value: HookPayload<N>) => Promise<HookResult<N>>,
  ): Promise<HookResult<N>>;
  /** Removes every registration an owner holds and returns how many. Used to unwind and dispose a package. */
  removeOwner(owner: string): number;
  /**
   * A view of this bus whose handlers receive `context.session`, bound to the registering owner so a
   * package's `session.background(...)` is checked against that package's capabilities. It shares
   * registrations with this bus.
   */
  bound(sessionFor: (owner: string) => SessionContext): HookBus;
  registrations(): readonly HookRegistrationInfo[];
  /** Whether any handler is registered for `name`. Allocation-free, unlike {@link registrations}. */
  has(name: HookName): boolean;
}

export interface HookBusOptions {
  readonly secrets?: readonly (string | undefined)[];
  /** Sink for `hook.error` events (observe throws and `onError: "ignore"`). */
  readonly onEvent?: (event: AgentEvent) => void;
}
