import type {
  AgentEvent,
  AgentFinishReason,
  EventOrigin,
  JsonObject,
  JsonValue,
  ModelRef,
  Message,
  ProviderRequest,
  ProviderTurnResult,
  Session,
  ToolCallContent,
  ToolCapabilityKind,
  ToolResult,
  Usage,
} from "../contracts.js";
import { ModelError } from "../agent-session/model-errors.js";
import { packageEventFor } from "../hooks/emit.js";
import { HOOK_EXECUTE_REWRITE, HookError } from "../hooks/errors.js";
import { frozenCopy, jsonEqual } from "../hooks/json.js";
import type { HookBus, RunEndDecision, ToolCallDecision, TurnBeforeDecision } from "../hooks/index.js";
import type { AgentInput } from "../input.js";
import type { RunLimitTracker } from "../run-limits.js";
import type { ExternalStateHandle } from "../session/external-state.js";
import { dispatchableToolCalls, dispatchToolCallsInOrder, throwIfAborted } from "./dispatch.js";
import { applyRequestTransforms } from "./request-draft.js";
import {
  EXTERNAL_ACTIVITY_EVENTS,
  type ExternalActivity,
  type ExternalAskSupport,
  type ExternalToolDecision,
  type ExternalToolRequest,
  type RunController,
  type RunEndResult,
  type RunTurnOptions,
  type RunTurnResult,
} from "./types.js";

/** How an `ask` decision resolved: execute, refuse, or (no UI) suspend the round. */
export type AskResolution = { readonly kind: "allow" } | { readonly kind: "deny"; readonly reason: string } | { readonly kind: "suspend" };

/** A `tool.call` decision that carries replacement arguments. */
function isRewrite(decision: ToolCallDecision | undefined): decision is { readonly rewrite: JsonObject } {
  return typeof decision === "object" && decision !== null && "rewrite" in decision;
}

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
  ask?(requests: readonly AskRequest[], options?: { readonly suspend?: boolean }): Promise<ReadonlyMap<string, AskResolution>>;
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
  queueContinuation(decision: { readonly reason: string; readonly steer?: string | Message }): void;
  setFinishReason(reason: AgentFinishReason | undefined, detail?: string): void;
  finishReason(): AgentFinishReason | undefined;
  usage(): Usage | undefined;
}

/**
 * Build the public {@link RunController} from the kernel's internal seams. The returned object's
 * own keys are exactly the primitives — no registry, provider, or dispatch handle leaks — while
 * kernel code reaches the loop's own bookkeeping through {@link RUN_CONTROLLER_INTERNALS}.
 */
export function createRunController(internals: RunControllerInternals): RunController {
  let turnCount = internals.startTurn ?? 0;
  let nextInput = internals.input;
  let toolRounds = 0;
  let continuations = 0;
  let pushedInput = false;

  const append = async (message: Message): Promise<Message> => {
    const transformed = await internals.hooks.transform("message.append", message, {
      sessionId: internals.sessionId,
      runId: internals.runId,
    });
    internals.history.push(transformed);
    await internals.appendMessage(transformed);
    return transformed;
  };

  const turn = async (options: RunTurnOptions = {}): Promise<RunTurnResult> => {
    turnCount += 1;
    const currentTurn = turnCount;
    throwIfAborted(internals.signal);
    if (!internals.model) throw new ModelError("no_model", "run.turn() needs a model, and this agent was created without one");
    internals.onTurnStart?.(currentTurn);
    await internals.applyPendingSteers?.();
    const usage = internals.usage();
    const before = (await internals.hooks.decide("turn.before", {
      sessionId: internals.sessionId,
      runId: internals.runId,
      turn: currentTurn,
      ...(usage ? { usage } : {}),
    })) as TurnBeforeDecision | undefined;
    if (before && typeof before.stop === "string") {
      // The host's reason rides `stopDetail` on the run result; the session redacts and
      // byte-caps it there, since only it can redact.
      internals.setFinishReason("hook_stop", before.stop);
      return { stopped: true, toolCalls: [], finishReason: "hook_stop" };
    }

    const request = await internals.assemble(nextInput, currentTurn, options);
    throwIfAborted(internals.signal);
    const { request: outgoing, secrets: requestSecrets } = await applyRequestTransforms(
      internals.hooks,
      { sessionId: internals.sessionId, runId: internals.runId },
      request,
    );

    const result = await internals.generate(outgoing, requestSecrets);
    nextInput = [];
    if (!pushedInput) {
      pushedInput = true;
      internals.history.push(...internals.inputMessages);
    }
    if (result.started) {
      const message: Message = {
        id: result.messageId,
        role: "assistant",
        content: result.content,
        ...(result.metadata ? { metadata: result.metadata } : {}),
      };
      const transformed = await internals.hooks.transform("model.response", message, {
        sessionId: internals.sessionId,
        runId: internals.runId,
      });
      await append(transformed);
      internals.emit({ type: "message.completed", sessionId: internals.sessionId, runId: internals.runId, message: transformed });
    }

    const dispatchable = dispatchableToolCalls(result.calls);
    if (dispatchable.length > 0 && toolRounds >= internals.maxToolRounds) {
      internals.setFinishReason("turn_limit");
      return { stopped: true, toolCalls: dispatchable, finishReason: "turn_limit", ...(result.usage ? { usage: result.usage } : {}) };
    }
    // Soft-interrupt / late steer: a call-free turn keeps the run going when the queue has text.
    if (dispatchable.length === 0) {
      const steered = (await internals.applyPendingSteers?.()) ?? false;
      if (steered) return { stopped: false, toolCalls: [], steered: true, ...(result.usage ? { usage: result.usage } : {}) };
    }
    return { stopped: false, toolCalls: dispatchable, ...(result.usage ? { usage: result.usage } : {}) };
  };

  /**
   * The `tool.call` payload for one round. Args are a deep-frozen copy, so an in-place mutation by a
   * handler throws in strict mode and never reaches execution.
   */
  const gatePayload = (
    call: ToolCallContent,
    args: JsonObject,
    effects: readonly ToolCapabilityKind[],
    origin: EventOrigin | undefined,
  ) => ({
    name: call.name,
    args: frozenCopy(args),
    effects: Object.freeze([...effects]),
    callId: call.id,
    sessionId: internals.sessionId,
    runId: internals.runId,
    ...(origin ? { origin } : {}),
  });

  /**
   * Two-round `tool.call` gate (plan 177 Task 2): a rewrite becomes the call's arguments and the gate
   * then runs again on the arguments that will execute. A round-2 rewrite that changes them again is
   * `rewrite_unstable` (fail closed, no third round); a round-2 rewrite equal to its input is dropped
   * by `combine`, so the round's `ask`/`respond` applies to the rewritten call. A handler may
   * therefore run twice for a rewritten call.
   */
  const gateCall = async (
    call: ToolCallContent,
    effects: readonly ToolCapabilityKind[],
    origin: EventOrigin | undefined,
  ): Promise<{ readonly decision: ToolCallDecision | undefined; readonly call: ToolCallContent }> => {
    const first = (await internals.hooks.decide("tool.call", gatePayload(call, call.arguments, effects, origin))) as
      | ToolCallDecision
      | undefined;
    if (!isRewrite(first)) return { decision: first, call };
    const rewritten: ToolCallContent = { ...call, arguments: first.rewrite };
    const second = (await internals.hooks.decide("tool.call", gatePayload(call, rewritten.arguments, effects, origin))) as
      | ToolCallDecision
      | undefined;
    if (isRewrite(second)) return { decision: { deny: "rewrite_unstable" }, call: rewritten };
    return { decision: second, call: rewritten };
  };

  /**
   * Plan 177 Task 5: whether `dispose()` aborted this run (its abort reason carries `agent_disposed`).
   * Only that abort denies here: a plain `session.abort()` keeps its existing behaviour, and the
   * deny exists so a loop that ignores the dispose signal cannot execute a tool after `dispose()`.
   */
  const disposedAbort = (): boolean => {
    const reason: unknown = internals.signal.reason;
    return internals.signal.aborted && reason instanceof Error && (reason as { code?: unknown }).code === "agent_disposed";
  };
  const disposedResult = (call: ToolCallContent): ToolResult => ({
    toolCallId: call.id,
    name: call.name,
    error: { code: "agent_disposed", message: (internals.signal.reason as Error).message },
  });

  const executeTools = async (
    calls: readonly ToolCallContent[],
    options?: { readonly concurrency?: number; readonly origin?: EventOrigin },
  ): Promise<readonly ToolResult[]> => {
    if (calls.length === 0) return [];
    // Plan 177 Task 5: a loop that ignores the dispose signal must not execute tools after `dispose()`.
    if (disposedAbort()) return calls.map(disposedResult);
    const origin = options?.origin;
    toolRounds += 1;
    // Evaluate `tool.call` for the whole round before dispatching, so several asks collect into
    // one suspension instead of stopping at the first one.
    const decisions = new Map<string, ToolCallDecision | undefined>();
    const gatedCalls = new Map<string, ToolCallContent>();
    const asks: AskRequest[] = [];
    for (const call of calls) {
      const gated = await gateCall(call, internals.effectsFor(call), origin);
      decisions.set(call.id, gated.decision);
      gatedCalls.set(call.id, gated.call);
      // An `ask` carries the call that will execute (the rewritten one), so its pending hash matches.
      if (gated.decision !== undefined && typeof gated.decision === "object" && "ask" in gated.decision) {
        asks.push({ call: gated.call, reason: gated.decision.ask });
      }
    }
    const askResolutions =
      asks.length > 0 && internals.ask
        ? await internals.ask(asks)
        : new Map<string, AskResolution>(asks.map((entry) => [entry.call.id, { kind: "deny" as const, reason: entry.reason }]));
    return dispatchToolCallsInOrder(calls, {
      signal: internals.signal,
      toolConcurrency: options?.concurrency ?? 1,
      ...(internals.chargeToolRound ? { chargeToolRound: internals.chargeToolRound } : {}),
      dispatchToolCall: (call) => {
        // An unresolved ask is not dispatched: it is staged as a pending decision and the run
        // suspends at the next turn boundary / loop end, after the round's allowed calls run.
        if (askResolutions.get(call.id)?.kind === "suspend") {
          return Promise.resolve({ toolCallId: call.id, name: call.name, metadata: { approvalPending: true } });
        }
        return dispatchOne(call, gatedCalls.get(call.id) ?? call, decisions.get(call.id), askResolutions, origin);
      },
      ...(internals.isToolCallExclusive ? { isToolCallExclusive: internals.isToolCallExclusive } : {}),
      appendMessage: async (message) => {
        await append(message);
      },
    });
  };

  /**
   * A `tool.call` deny (or an ask the host refused) never runs the tool, but it still settles as one
   * `tool.completed { status: "blocked" }` (docs/events.md), on a fresh run and on a resumed one alike.
   * Found by the plan 215 Task 32 live journey: the result reached the transcript with no event.
   */
  const blocked = (call: ToolCallContent, reason: string): ToolResult => {
    const result: ToolResult = { toolCallId: call.id, name: call.name, error: { code: "hook_denied", message: reason } };
    internals.emit({
      type: "tool.completed",
      sessionId: internals.sessionId,
      runId: internals.runId,
      toolCallId: call.id,
      name: call.name,
      result,
      metadata: { durationMs: 0, status: "blocked" },
      status: "blocked",
      reason,
      error: result.error!,
    });
    return result;
  };

  const dispatchOne = async (
    call: ToolCallContent,
    effective: ToolCallContent,
    decision: ToolCallDecision | undefined,
    askResolutions: ReadonlyMap<string, AskResolution>,
    origin: EventOrigin | undefined,
  ): Promise<ToolResult> => {
    // A dispose can land while the round is gated: the check runs again per call, before execution.
    if (disposedAbort()) return disposedResult(call);
    if (decision !== undefined && decision !== "allow") {
      if (typeof decision === "object" && "deny" in decision) return blocked(call, decision.deny);
      if (typeof decision === "object" && "ask" in decision) {
        const resolution = askResolutions.get(call.id) ?? { kind: "deny" as const, reason: decision.ask };
        if (resolution.kind === "deny") return blocked(call, resolution.reason);
      }
      if (typeof decision === "object" && "respond" in decision) return decision.respond;
    }
    let executed: ToolResult;
    try {
      executed = await internals.hooks.around(
        "tool.execute",
        {
          name: effective.name,
          args: frozenCopy(effective.arguments),
          callId: effective.id,
          sessionId: internals.sessionId,
          runId: internals.runId,
        },
        async (payload) => {
          // Wrap-only: a handler may observe or wrap the call, never replace its name or arguments.
          if (payload.name !== effective.name || !jsonEqual(payload.args, effective.arguments)) {
            throw new HookError("tool.execute may not replace the call's name or arguments", {
              owner: internals.loopOwner,
              hook: "tool.execute",
              code: HOOK_EXECUTE_REWRITE,
            });
          }
          return internals.dispatchToolCall(effective, origin);
        },
      );
    } catch (error) {
      if (error instanceof HookError && error.code === HOOK_EXECUTE_REWRITE) {
        return { toolCallId: call.id, name: call.name, error: { code: "hook_execute_rewrite", message: error.message } };
      }
      throw error;
    }
    const transformed = await internals.hooks.transform("tool.result", {
      ...executed,
      sessionId: internals.sessionId,
      runId: internals.runId,
    });
    // The stamp is dispatch context only: never leak it into the stored result.
    const {
      sessionId: _sessionId,
      runId: _runId,
      ...result
    } = transformed as typeof transformed & {
      readonly sessionId?: string;
      readonly runId?: string;
    };
    return result;
  };

  const end = async (): Promise<RunEndResult> => {
    const usage = internals.usage();
    const decision = await internals.hooks.decide("run.end", {
      sessionId: internals.sessionId,
      runId: internals.runId,
      ...(internals.finishReason() ? { finishReason: internals.finishReason()! } : {}),
      ...(usage ? { usage } : {}),
      history: internals.history,
      turn: turnCount,
      continuations,
    });
    const asked = (decision as RunEndDecision | undefined)?.continue;
    if (!asked || typeof asked.reason !== "string" || asked.reason.length === 0) return { continue: false };
    if (internals.maxContinuations !== null && continuations >= internals.maxContinuations) {
      internals.setFinishReason("hook_limit");
      return { continue: false };
    }
    continuations += 1;
    internals.queueContinuation(asked);
    nextInput = [];
    return { continue: true, reason: asked.reason };
  };

  // --- driver primitives (external agents) -------------------------------------------------
  const baseOrigin: EventOrigin = {
    kind: "external",
    agent: internals.loopOwner,
    agentId: internals.loopOwner,
    depth: 0,
    executedBy: "external",
  };
  // `subagent` activity opens a nested scope that later activity inherits until it completes.
  const scopes: EventOrigin[] = [];
  const currentOrigin = (): EventOrigin => scopes.at(-1) ?? baseOrigin;
  const startedTools = new Map<string, { readonly name: string; readonly at: number }>();

  const stamped = (event: AgentEvent): AgentEvent => ({ ...event, origin: currentOrigin() });

  const observe = async (activity: ExternalActivity): Promise<void> => {
    throwIfAborted(internals.signal);
    const { sessionId, runId } = internals;
    switch (activity.kind) {
      case "message.delta":
        internals.emit(stamped({ type: "message.delta", sessionId, runId, content: activity.content }));
        return;
      case "message": {
        const message: Message = { ...activity.message, metadata: { ...activity.message.metadata, origin: currentOrigin() } };
        const transformed = await append(message);
        internals.emit(stamped({ type: "message.completed", sessionId, runId, message: transformed }));
        return;
      }
      case "tool.started": {
        internals.limits.charge("maxToolCalls");
        startedTools.set(activity.call.id, { name: activity.call.name, at: Date.now() });
        const call: ToolCallContent = {
          type: "tool_call",
          id: activity.call.id,
          name: activity.call.name,
          arguments: (activity.call.args !== null && typeof activity.call.args === "object" && !Array.isArray(activity.call.args)
            ? activity.call.args
            : {}) as ToolCallContent["arguments"],
        };
        internals.emit(stamped({ type: "tool.started", sessionId, runId, call }));
        return;
      }
      case "tool.progress": {
        const name = startedTools.get(activity.toolCallId)?.name ?? "";
        internals.emit(
          stamped({ type: "tool.progress", sessionId, runId, toolCallId: activity.toolCallId, name, progress: activity.progress }),
        );
        return;
      }
      case "tool.completed": {
        const started = startedTools.get(activity.toolCallId);
        startedTools.delete(activity.toolCallId);
        const name = started?.name ?? "";
        const failed = activity.status !== "finished";
        const result: ToolResult = {
          toolCallId: activity.toolCallId,
          name,
          ...(activity.result !== undefined ? { value: activity.result } : {}),
          ...(failed ? { error: { message: activity.error ?? activity.status } } : {}),
        };
        internals.emit(
          stamped({
            type: "tool.completed",
            sessionId,
            runId,
            toolCallId: activity.toolCallId,
            name,
            result,
            metadata: { durationMs: started ? Date.now() - started.at : 0, status: activity.status },
            status: activity.status,
            ...(activity.status === "error" ? { error: { message: activity.error ?? "error" } } : {}),
            ...(activity.status === "blocked" ? { reason: activity.error ?? "blocked" } : {}),
          }),
        );
        return;
      }
      case "usage":
        internals.addUsage?.(activity.usage);
        return;
      default: {
        const { kind, ...data } = activity;
        if (kind === "subagent") {
          const parent = currentOrigin();
          if (activity.phase === "started") {
            scopes.push({
              ...parent,
              depth: parent.depth + 1,
              subagentId: activity.id,
              ...(activity.parentToolCallId ? { parentToolCallId: activity.parentToolCallId } : {}),
            });
          }
        }
        // The event describes the subagent from the scope it was reported in; popping happens after.
        const event = stamped(
          packageEventFor(internals.loopOwner, sessionId, runId, EXTERNAL_ACTIVITY_EVENTS[kind], data as unknown as JsonValue),
        );
        internals.emit(event);
        if (kind === "subagent" && activity.kind === "subagent" && activity.phase === "completed") {
          const at = scopes.map((scope) => scope.subagentId).lastIndexOf(activity.id);
          if (at !== -1) scopes.length = at;
        }
      }
    }
  };

  const denied = (reason: string): ExternalToolDecision => ({ allow: false, reason });

  const ask = async (request: ExternalToolRequest, support: ExternalAskSupport = {}): Promise<ExternalToolDecision> => {
    const args =
      request.args !== null && typeof request.args === "object" && !Array.isArray(request.args)
        ? (request.args as ToolCallContent["arguments"])
        : ({} as ToolCallContent["arguments"]);
    const call: ToolCallContent = { type: "tool_call", id: request.toolCallId, name: request.name, arguments: args };
    // The driver-kit gate shares the two-round rule, so an external loop cannot bypass the fix.
    let gated: { readonly decision: ToolCallDecision | undefined; readonly call: ToolCallContent };
    try {
      gated = await gateCall(call, request.effects, currentOrigin());
    } catch {
      return denied("tool_call_gate_failed");
    }
    const decision = gated.decision;
    if (decision === undefined || decision === "allow") {
      // A rewrite is already applied: report the effective args so a driver loop that supports rewrite
      // dispatches what the gate saw.
      if (jsonEqual(gated.call.arguments, call.arguments)) return { allow: true };
      return support.rewrite ? { allow: true, args: gated.call.arguments } : denied("rewrite_unsupported");
    }
    if ("deny" in decision) return denied(decision.deny);
    if ("respond" in decision) {
      if (!support.respond) return denied("respond_unsupported");
      return { respond: (decision.respond.value ?? null) as JsonValue };
    }
    const reason = (decision as { readonly ask: string }).ask;
    const resumable = internals.resumable === true;
    if (!internals.ask) return denied("non_interactive");
    let resolution: AskResolution | undefined;
    try {
      resolution = (await internals.ask([{ call: gated.call, reason }], { suspend: resumable })).get(call.id);
    } catch {
      return denied("tool_call_gate_failed");
    }
    if (resolution?.kind === "allow") return { allow: true };
    if (resolution?.kind === "suspend") return denied(resumable ? "approval_pending" : "non_interactive");
    return denied(resolution?.reason ?? "non_interactive");
  };

  const steers = (): AsyncIterable<Message> => ({
    [Symbol.asyncIterator](): AsyncIterator<Message> {
      const buffer: Message[] = [];
      let finished = false;
      let wake: (() => void) | undefined;
      const unsubscribe = internals.onSteer?.(() => wake?.());
      const onAbort = (): void => wake?.();
      internals.signal.addEventListener("abort", onAbort, { once: true });
      const finish = (): void => {
        finished = true;
        unsubscribe?.();
        internals.signal.removeEventListener("abort", onAbort);
        wake?.();
      };
      return {
        async next(): Promise<IteratorResult<Message>> {
          while (!finished) {
            if (buffer.length > 0) return { done: false, value: buffer.shift()! };
            if (internals.signal.aborted) break;
            if (internals.hasPendingSteers?.()) {
              buffer.push(...((await internals.drainSteers?.()) ?? []));
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
          }
          finish();
          return { done: true, value: undefined };
        },
        async return(): Promise<IteratorResult<Message>> {
          finish();
          return { done: true, value: undefined };
        },
      };
    },
  });

  const controller: RunController = {
    session: internals.session,
    input: internals.input,
    signal: internals.signal,
    limits: internals.limits,
    model: internals.model,
    turn,
    executeTools,
    append: async (message) => {
      await append(message);
    },
    state: (key) => internals.externalState(key),
    end,
    observe,
    ask,
    steers,
    emit: (name, data) => internals.emit(packageEventFor(internals.loopOwner, internals.sessionId, internals.runId, name, data)),
  };
  return controller;
}
