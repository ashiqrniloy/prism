import { skillCatalogDraft } from "../skills-catalog.js";
import type {
  AgentEvent,
  AgentFinishReason,
  Session,
  JsonValue,
  Message,
  ProviderRequest,
  ProviderTurnResult,
  ToolCallContent,
  ToolCapabilityKind,
  ToolResult,
  Usage,
} from "../contracts.js";
import type { ContextBlock, ToolDefinition } from "../contracts.js";
import { contextMessages } from "../input.js";
import type { ContextDraft, HookBus, RunEndDecision, ToolCallDecision, TurnBeforeDecision } from "../hooks/index.js";
import { createId } from "../ids.js";
import type { AgentInput } from "../input.js";
import type { RunLimitTracker } from "../run-limits.js";
import { dispatchableToolCalls, dispatchToolCallsInOrder, throwIfAborted } from "./dispatch.js";
import type { RunController, RunEndResult, RunTurnOptions, RunTurnResult } from "./types.js";

/** How an `ask` decision resolved: execute, refuse, or (no UI) suspend the round. */
export type AskResolution = { readonly kind: "allow" } | { readonly kind: "deny"; readonly reason: string } | { readonly kind: "suspend" };

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
  readonly hooks: HookBus;
  readonly sessionId: string;
  readonly runId: string;
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
  dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;
  isToolCallExclusive?(call: ToolCallContent): boolean;
  /** Capabilities reported to `tool.call` for a call's tool. */
  effectsFor(call: ToolCallContent): readonly ToolCapabilityKind[];
  /**
   * Resolve the `{ ask }` calls of one tool round: inline `host.ui` confirms, or a `suspend`
   * resolution for each call that no UI answered. The kernel owns this so a loop cannot skip it.
   */
  ask?(requests: readonly AskRequest[]): Promise<ReadonlyMap<string, AskResolution>>;
  appendMessage(message: Message): Promise<void>;
  applyPendingSteers?(): Promise<boolean>;
  /** Queue a `run.end` continuation through the steer path. */
  queueContinuation(decision: { readonly reason: string; readonly steer?: string | Message }): void;
  setFinishReason(reason: AgentFinishReason | undefined, detail?: string): void;
  finishReason(): AgentFinishReason | undefined;
  usage(): Usage | undefined;
}

/** Symbol-keyed internals handle. `Object.keys(controller)` never shows it. */
function draftFromRequest(request: ProviderRequest): ContextDraft {
  // `context` is an addition channel, not a mirror: the assembler has already rendered any context
  // it had into `messages`, so mirroring it here would render the same blocks twice.
  return {
    messages: request.messages,
    ...skillCatalogDraft(request),
    ...(request.tools ? { tools: request.tools } : {}),
  };
}

function withSystem(messages: readonly Message[], systemPrompt: string): readonly Message[] {
  const index = messages.findIndex((message) => message.role === "system");
  if (index === -1) return [{ id: createId("msg"), role: "system", content: [{ type: "text", text: systemPrompt }] }, ...messages];
  const next = [...messages];
  next[index] = { ...next[index]!, content: [{ type: "text", text: systemPrompt }] };
  return next;
}

function applyDraft(request: ProviderRequest, draft: ContextDraft): ProviderRequest {
  let messages = draft.systemPrompt !== undefined ? withSystem(draft.messages, draft.systemPrompt) : draft.messages;
  if (draft.context?.length) messages = withContextMessages(messages, draft.context);
  return {
    ...request,
    messages,
    // Restrictive-only, exactly like the retired `toolNarrowing`: a handler may drop tools from the
    // turn but never introduce one the request did not already carry, so a context source cannot
    // advertise a capability the tool registry never granted.
    tools: draft.tools === undefined || request.tools === undefined ? request.tools : narrowTo(request.tools, draft.tools),
    context: draft.context ? [...(request.context ?? []), ...draft.context] : request.context,
  };
}

function narrowTo(listed: readonly ToolDefinition[], requested: readonly ToolDefinition[]): readonly ToolDefinition[] {
  const names = new Set(requested.map((entry) => entry.name));
  return listed.filter((entry) => names.has(entry.name));
}

/** Render context blocks into the transcript at the stable-prefix boundary, ahead of the dynamic tail. */
function withContextMessages(messages: readonly Message[], blocks: readonly ContextBlock[]): readonly Message[] {
  const rendered = contextMessages(blocks);
  if (rendered.length === 0) return messages;
  const boundary = messages.findIndex((message) => message.role !== "system");
  const at = boundary === -1 ? messages.length : boundary;
  return [...messages.slice(0, at), ...rendered, ...messages.slice(at)];
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
    const transformed = await internals.hooks.transform("message.append", message);
    internals.history.push(transformed);
    await internals.appendMessage(transformed);
    return transformed;
  };

  const turn = async (options: RunTurnOptions = {}): Promise<RunTurnResult> => {
    turnCount += 1;
    const currentTurn = turnCount;
    throwIfAborted(internals.signal);
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

    let request = await internals.assemble(nextInput, currentTurn, options);
    throwIfAborted(internals.signal);
    const draft = draftFromRequest(request);
    const built = await internals.hooks.transform("context.build", draft);
    if (built !== draft) request = applyDraft(request, built);
    const transformedRequest = await internals.hooks.transform("model.request", request);
    // A transform may declare secrets it injected; they join the provider error-redaction set.
    const requestSecrets: (string | undefined)[] = [];
    let outgoing: ProviderRequest = request;
    if (transformedRequest && "request" in transformedRequest) {
      requestSecrets.push(...(transformedRequest.secrets ?? []));
      outgoing = transformedRequest.request;
    } else if (transformedRequest) {
      outgoing = transformedRequest;
    }

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
      const transformed = await internals.hooks.transform("model.response", message);
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

  const executeTools = async (calls: readonly ToolCallContent[], options?: { readonly concurrency?: number }): Promise<void> => {
    if (calls.length === 0) return;
    toolRounds += 1;
    // Evaluate `tool.call` for the whole round before dispatching, so several asks collect into
    // one suspension instead of stopping at the first one.
    const decisions = new Map<string, ToolCallDecision | undefined>();
    const asks: AskRequest[] = [];
    for (const call of calls) {
      const decision = (await internals.hooks.decide("tool.call", {
        name: call.name,
        args: call.arguments,
        effects: internals.effectsFor(call),
        callId: call.id,
        sessionId: internals.sessionId,
        runId: internals.runId,
      })) as ToolCallDecision | undefined;
      decisions.set(call.id, decision);
      if (decision !== undefined && typeof decision === "object" && "ask" in decision) asks.push({ call, reason: decision.ask });
    }
    const askResolutions =
      asks.length > 0 && internals.ask
        ? await internals.ask(asks)
        : new Map<string, AskResolution>(asks.map((entry) => [entry.call.id, { kind: "deny" as const, reason: entry.reason }]));
    await dispatchToolCallsInOrder(calls, {
      signal: internals.signal,
      toolConcurrency: options?.concurrency ?? 1,
      ...(internals.chargeToolRound ? { chargeToolRound: internals.chargeToolRound } : {}),
      dispatchToolCall: (call) => {
        // An unresolved ask is not dispatched: it is staged as a pending decision and the run
        // suspends at the next turn boundary / loop end, after the round's allowed calls run.
        if (askResolutions.get(call.id)?.kind === "suspend") {
          return Promise.resolve({ toolCallId: call.id, name: call.name, metadata: { approvalPending: true } });
        }
        return dispatchOne(call, decisions.get(call.id), askResolutions);
      },
      ...(internals.isToolCallExclusive ? { isToolCallExclusive: internals.isToolCallExclusive } : {}),
      appendMessage: async (message) => {
        await append(message);
      },
    });
  };

  const dispatchOne = async (
    call: ToolCallContent,
    decision: ToolCallDecision | undefined,
    askResolutions: ReadonlyMap<string, AskResolution>,
  ): Promise<ToolResult> => {
    let effective = call;
    if (decision !== undefined && decision !== "allow") {
      if (typeof decision === "object" && "deny" in decision) {
        return { toolCallId: call.id, name: call.name, error: { code: "hook_denied", message: decision.deny } };
      }
      if (typeof decision === "object" && "ask" in decision) {
        const resolution = askResolutions.get(call.id) ?? { kind: "deny" as const, reason: decision.ask };
        if (resolution.kind === "deny") {
          return { toolCallId: call.id, name: call.name, error: { code: "hook_denied", message: resolution.reason } };
        }
      }
      if (typeof decision === "object" && "respond" in decision) return decision.respond;
      if (typeof decision === "object" && "rewrite" in decision) effective = { ...call, arguments: decision.rewrite };
    }
    const executed = await internals.hooks.around(
      "tool.execute",
      { name: effective.name, args: effective.arguments, callId: effective.id, sessionId: internals.sessionId, runId: internals.runId },
      async (payload) => internals.dispatchToolCall({ ...effective, name: payload.name, arguments: payload.args }),
    );
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
    return { continue: true };
  };

  const controller: RunController = {
    session: internals.session,
    input: internals.input,
    signal: internals.signal,
    limits: internals.limits,
    turn,
    executeTools,
    append: async (message) => {
      await append(message);
    },
    end,
    emit: (event) => internals.emit(event),
  };
  return controller;
}
