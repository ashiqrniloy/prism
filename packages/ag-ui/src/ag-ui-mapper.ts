import { type AGUIEvent, EventSchemas, EventType } from "@ag-ui/core";
import type {
  AgentEvent,
  DelegatedAgentStep,
  ErrorInfo,
  SecretRedactor,
  ThinkingContent,
  ToolCallContent,
  ToolResult,
  Usage,
} from "@arnilo/prism";
import { type AgUiA2UiOptions, createAgUiA2UiPainter } from "./a2ui.js";
import { AgUiError } from "./errors.js";
import { type AgUiLimitOptions, resolveAgUiLimits } from "./limits.js";
import { type AgUiActivitySnapshot, type AgUiProjection, projectAgUiJson, projectAgUiPatch, projectCoWorkEvent } from "./projection.js";
import type { CoWorkEvent } from "./types.js";

export interface AgUiEventMapperOptions {
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  /** Adapter-owned activity proven safe by a selected protocol bridge. */
  readonly activity?: (event: AgentEvent) => AgUiActivitySnapshot | undefined;
  /** Opt-in A2UI painting middleware. Absent = inert (0.0.24 behavior). */
  readonly a2ui?: AgUiA2UiOptions;
  readonly limits?: AgUiLimitOptions;
  /** Emits safe named CUSTOM lifecycle metadata; default false. */
  readonly includeCustomEvents?: boolean;
  /** Maps Prism session IDs to host AG-UI thread IDs. Defaults to the session ID. */
  readonly threadId?: (sessionId: string) => string | undefined;
  /** Maps Prism run IDs to host AG-UI run IDs. Defaults to the Prism run ID. */
  readonly runId?: (runId: string, sessionId: string) => string | undefined;
}

export interface AgUiEventMapper {
  map(event: AgentEvent): Promise<readonly AGUIEvent[]>;
  /** Projects one co-work event to safe AG-UI CUSTOM events; malformed input yields none. */
  mapCoWork(event: CoWorkEvent): Promise<readonly AGUIEvent[]>;
}

interface ActiveTool {
  readonly id: string;
  readonly name: string;
}

const TRUNCATION = "… [truncated]";

/** Maps one ordered Prism event stream to safe, schema-validated AG-UI events. */
export function createAgUiEventMapper(options: AgUiEventMapperOptions = {}): AgUiEventMapper {
  const limits = resolveAgUiLimits(options.limits);
  const a2ui = options.a2ui ? createAgUiA2UiPainter(options.a2ui, limits, options.redactor) : undefined;
  const activeTools = new Map<string, ActiveTool>();
  const activeSteps = new Set<string>();
  let activeMessage: string | undefined;
  let activeReasoning: string | undefined;
  let messageHasDelta = false;
  let messageSequence = 0;
  let reasoningSequence = 0;
  let terminal = false;

  const text = (value: string, maxBytes = limits.maxTextBytes): string => {
    const redacted = options.redactor?.redact(value) ?? value;
    return truncateUtf8(redacted, Math.min(maxBytes, limits.maxEventBytes - 512));
  };
  const id = (value: string | undefined, fallback: string): string => text(value ?? fallback, limits.maxTextBytes);
  const thread = (sessionId: string) => id(options.threadId?.(sessionId), sessionId);
  const run = (runId: string, sessionId: string) => id(options.runId?.(runId, sessionId), runId);
  const emit = (events: AGUIEvent[], value: unknown): void => {
    const parsed = EventSchemas.safeParse(value);
    if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "mapper produced invalid AG-UI event");
    if (measure(parsed.data) > limits.maxEventBytes) {
      throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "mapped AG-UI event exceeds maxEventBytes");
    }
    events.push(parsed.data);
  };
  const closeReasoning = (events: AGUIEvent[]): void => {
    if (!activeReasoning) return;
    emit(events, { type: EventType.REASONING_MESSAGE_END, messageId: activeReasoning });
    emit(events, { type: EventType.REASONING_END, messageId: activeReasoning });
    activeReasoning = undefined;
  };
  const close = (events: AGUIEvent[]): void => {
    closeReasoning(events);
    if (activeMessage) emit(events, { type: EventType.TEXT_MESSAGE_END, messageId: activeMessage });
    activeMessage = undefined;
    messageHasDelta = false;
    for (const tool of activeTools.values()) emit(events, { type: EventType.TOOL_CALL_END, toolCallId: tool.id });
    activeTools.clear();
    for (const stepName of activeSteps) emit(events, { type: EventType.STEP_FINISHED, stepName });
    activeSteps.clear();
  };
  const startTool = async (events: AGUIEvent[], call: ToolCallContent | Pick<ActiveTool, "id" | "name">): Promise<ActiveTool> => {
    const sourceId = call.id;
    const current = activeTools.get(sourceId);
    if (current) return current;
    const tool = { id: id(sourceId, `tool-${activeTools.size + 1}`), name: text(call.name) };
    activeTools.set(sourceId, tool);
    emit(events, {
      type: EventType.TOOL_CALL_START,
      toolCallId: tool.id,
      toolCallName: tool.name,
      parentMessageId: activeMessage,
    });
    if ("arguments" in call) {
      const args = await projectedText(() => options.projection?.toolArguments?.(call), limits.maxTextBytes);
      if (args !== undefined) emit(events, { type: EventType.TOOL_CALL_ARGS, toolCallId: tool.id, delta: args });
    }
    return tool;
  };
  const finishTool = async (events: AGUIEvent[], sourceId: string, name: string, status: string, result?: ToolResult): Promise<void> => {
    const tool = await startTool(events, { id: sourceId, name });
    const projectedResult = result ? await projectedText(() => options.projection?.toolResult?.(result), limits.maxTextBytes) : undefined;
    emit(events, {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: tool.id,
      messageId: `${tool.id}:result`,
      content: projectedResult ?? status,
      role: "tool",
    });
    emit(events, { type: EventType.TOOL_CALL_END, toolCallId: tool.id });
    activeTools.delete(sourceId);
  };
  const statusState = async (events: AGUIEvent[], event: AgentEvent, status: string, version?: number): Promise<void> => {
    const addition = await projectedJson(() => options.projection?.state?.(event), limits.maxStateBytes, "state");
    emit(events, {
      type: EventType.STATE_SNAPSHOT,
      snapshot: {
        prism: { run: { status, ...(version === undefined ? {} : { version }), ...(addition === undefined ? {} : { state: addition }) } },
      },
    });
  };
  const delegatedActivity = (event: DelegatedAgentStep): AgUiActivitySnapshot => {
    const durationMs = safeDelegatedNumber(event.durationMs);
    const usage = safeDelegatedUsage(event.usage);
    const detail = safeDelegatedDetail(event.detail);
    return {
      type: "snapshot",
      messageId: id(undefined, `${event.runId}:delegated`),
      activityType: "prism.delegated_agent_step",
      content: {
        adapterId: text(event.adapterId, 512),
        externalConversationId: text(event.externalConversationId, 512),
        stepIndex: Number.isSafeInteger(event.stepIndex) && event.stepIndex >= 0 ? event.stepIndex : 0,
        state: event.state === "active" || event.state === "done" || event.state === "error" ? event.state : "error",
        kind:
          event.kind === "assistant" || event.kind === "tool" || event.kind === "subagent" || event.kind === "checkpoint"
            ? event.kind
            : "unknown",
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(event.toolName === undefined ? {} : { toolName: text(event.toolName, 256) }),
        ...(event.subagentType === undefined ? {} : { subagentType: text(event.subagentType, 256) }),
        ...(usage === undefined ? {} : { usage }),
        ...(detail === undefined
          ? {}
          : {
              detail: {
                ...(detail.referenceId === undefined ? {} : { referenceId: text(detail.referenceId, 512) }),
                ...(detail.label === undefined ? {} : { label: text(detail.label, 256) }),
              },
            }),
      },
    };
  };
  const custom = async (events: AGUIEvent[], name: string, value: unknown): Promise<void> => {
    if (!options.includeCustomEvents) return;
    const safe = await projectedJson(() => value, limits.maxTextBytes, "custom");
    if (safe !== undefined) emit(events, { type: EventType.CUSTOM, name, value: safe });
  };
  const error = (events: AGUIEvent[], info: ErrorInfo, code = "PRISM_ERROR"): void => {
    close(events);
    emit(events, {
      type: EventType.RUN_ERROR,
      message: text(info.message, limits.maxErrorBytes),
      code: text(String(info.code ?? code), limits.maxErrorBytes),
    });
    terminal = true;
  };
  const projectedText = async (callback: () => unknown, maxBytes: number): Promise<string | undefined> => {
    try {
      const value = await callback();
      return typeof value === "string" ? text(value, maxBytes) : undefined;
    } catch {
      return undefined;
    }
  };
  const projectedJson = async (callback: () => unknown, maxBytes: number, name: string): Promise<unknown> => {
    try {
      const value = await callback();
      return projectAgUiJson(options.redactor?.redact(value) ?? value, maxBytes, limits, name);
    } catch {
      return undefined;
    }
  };
  const reasoning = async (events: AGUIEvent[], content: ThinkingContent, event: AgentEvent): Promise<void> => {
    let projected: Awaited<ReturnType<NonNullable<AgUiProjection["reasoning"]>>> | undefined;
    try {
      projected = await options.projection?.reasoning?.(content, event);
    } catch {
      return;
    }
    if (!projected) return;
    const visible = typeof projected.text === "string" ? text(projected.text, limits.maxReasoningBytes) : undefined;
    const encryptedValue =
      typeof projected.encryptedValue === "string" ? text(projected.encryptedValue, limits.maxReasoningBytes) : undefined;
    if (!visible && !encryptedValue) return;
    const messageId = activeReasoning ?? id(undefined, `${event.runId}:reasoning-${++reasoningSequence}`);
    if (!activeReasoning && visible) {
      activeReasoning = messageId;
      emit(events, { type: EventType.REASONING_START, messageId });
      emit(events, { type: EventType.REASONING_MESSAGE_START, messageId, role: "reasoning" });
    }
    if (visible) emit(events, { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta: visible });
    if (encryptedValue)
      emit(events, { type: EventType.REASONING_ENCRYPTED_VALUE, subtype: "message", entityId: messageId, encryptedValue });
  };
  const extras = async (events: AGUIEvent[], event: AgentEvent): Promise<void> => {
    let adapterActivity: AgUiActivitySnapshot | undefined;
    try {
      adapterActivity = options.activity?.(event);
    } catch {
      adapterActivity = undefined;
    }
    if (adapterActivity) {
      const content = projectAgUiJson(adapterActivity.content, limits.maxActivityBytes, limits, "adapter activity");
      if (content && typeof content === "object" && !Array.isArray(content)) {
        emit(events, {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: text(adapterActivity.messageId),
          activityType: text(adapterActivity.activityType),
          content,
          replace: adapterActivity.replace,
        });
      }
    }
    const snapshot = await projectedJson(() => options.projection?.stateSnapshot?.(event), limits.maxStateBytes, "stateSnapshot");
    if (snapshot !== undefined) emit(events, { type: EventType.STATE_SNAPSHOT, snapshot });

    let delta: readonly unknown[] | undefined;
    try {
      delta = await options.projection?.stateDelta?.(event);
    } catch {
      delta = undefined;
    }
    const statePatch = projectAgUiPatch(delta, limits.maxPatchOperations, limits.maxStateBytes, limits, "stateDelta");
    if (statePatch !== undefined) emit(events, { type: EventType.STATE_DELTA, delta: statePatch });

    const messages = await projectedJson(() => options.projection?.messages?.(event), limits.maxStateBytes, "messages");
    if (Array.isArray(messages)) emit(events, { type: EventType.MESSAGES_SNAPSHOT, messages });

    let activity: Awaited<ReturnType<NonNullable<AgUiProjection["activity"]>>> | undefined;
    try {
      activity = await options.projection?.activity?.(event);
    } catch {
      activity = undefined;
    }
    if (activity?.type === "snapshot") {
      const content = projectAgUiJson(activity.content, limits.maxActivityBytes, limits, "activity");
      if (content && typeof content === "object" && !Array.isArray(content)) {
        emit(events, {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: text(activity.messageId),
          activityType: text(activity.activityType),
          content,
          replace: activity.replace,
        });
      }
    } else if (activity?.type === "delta") {
      const patch = projectAgUiPatch(activity.patch, limits.maxPatchOperations, limits.maxActivityBytes, limits, "activityDelta");
      if (patch !== undefined) {
        emit(events, {
          type: EventType.ACTIVITY_DELTA,
          messageId: text(activity.messageId),
          activityType: text(activity.activityType),
          patch,
        });
      }
    }

    let raw: Awaited<ReturnType<NonNullable<AgUiProjection["raw"]>>> | undefined;
    try {
      raw = await options.projection?.raw?.(event);
    } catch {
      raw = undefined;
    }
    if (raw) {
      const value = projectAgUiJson(raw.event, limits.maxRawEventBytes, limits, "raw");
      if (value !== undefined) emit(events, { type: EventType.RAW, event: value, ...(raw.source ? { source: text(raw.source) } : {}) });
    }

    let projectedCustom: Awaited<ReturnType<NonNullable<AgUiProjection["custom"]>>> | undefined;
    try {
      projectedCustom = await options.projection?.custom?.(event);
    } catch {
      projectedCustom = undefined;
    }
    if (projectedCustom) {
      const value = projectAgUiJson(projectedCustom.value, limits.maxTextBytes, limits, "custom");
      if (value !== undefined) emit(events, { type: EventType.CUSTOM, name: text(projectedCustom.name), value });
    }
  };

  return {
    async mapCoWork(input) {
      const events: AGUIEvent[] = [];
      const payload = await projectCoWorkEvent(input, {
        redactor: options.redactor,
        projection: options.projection,
        maxBytes: limits.maxTextBytes,
      });
      if (payload === undefined) return events;
      emit(events, { type: EventType.CUSTOM, name: `prism.cowork.${input.kind}`, value: payload });
      return events;
    },
    async map(input) {
      if (terminal) return [];
      const event = options.redactor?.redact(input) ?? input;
      const events: AGUIEvent[] = [];
      switch (event.type) {
        case "agent_started":
          emit(events, { type: EventType.RUN_STARTED, threadId: thread(event.sessionId), runId: run(event.runId, event.sessionId) });
          break;
        case "agent_finished":
          close(events);
          emit(events, {
            type: EventType.RUN_FINISHED,
            threadId: thread(event.sessionId),
            runId: run(event.runId, event.sessionId),
            outcome: { type: "success" },
          });
          terminal = true;
          break;
        case "agent_suspended":
          await close(events);
          await statusState(events, event, "suspended", event.version);
          break;
        case "agent_resumed":
          await statusState(events, event, "running", event.version);
          break;
        case "agent_denied":
          await statusState(events, event, "denied", event.version);
          error(events, { message: "Run denied", code: "AGENT_DENIED" }, "AGENT_DENIED");
          break;
        case "turn_started": {
          const stepName = `turn:${event.turn}`;
          activeSteps.add(stepName);
          emit(events, { type: EventType.STEP_STARTED, stepName });
          break;
        }
        case "turn_finished": {
          const stepName = `turn:${event.turn}`;
          if (activeSteps.delete(stepName)) emit(events, { type: EventType.STEP_FINISHED, stepName });
          break;
        }
        case "message_started":
          if (event.message.role !== "assistant") break;
          if (activeMessage) close(events);
          activeMessage = id(event.message.id, `${event.runId}:message-${++messageSequence}`);
          emit(events, { type: EventType.TEXT_MESSAGE_START, messageId: activeMessage, role: "assistant" });
          break;
        case "message_delta":
          if (event.content.type === "thinking") {
            await reasoning(events, event.content, event);
            break;
          }
          if (event.content.type === "tool_call_delta") {
            if (a2ui) {
              for (const painted of a2ui.onToolCallDelta(event.content)) emit(events, painted);
            }
            break;
          }
          if (event.content.type !== "text") break;
          if (!activeMessage) {
            activeMessage = id(undefined, `${event.runId}:message-${++messageSequence}`);
            emit(events, { type: EventType.TEXT_MESSAGE_START, messageId: activeMessage, role: "assistant" });
          }
          messageHasDelta = true;
          emit(events, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: activeMessage, delta: text(event.content.text) });
          break;
        case "message_finished":
          if (event.message.role !== "assistant") break;
          if (!activeMessage) {
            activeMessage = id(event.message.id, `${event.runId}:message-${++messageSequence}`);
            emit(events, { type: EventType.TEXT_MESSAGE_START, messageId: activeMessage, role: "assistant" });
          }
          if (!messageHasDelta) {
            for (const block of event.message.content) {
              if (block.type === "text")
                emit(events, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: activeMessage, delta: text(block.text) });
              if (block.type === "thinking") await reasoning(events, block, event);
            }
          }
          closeReasoning(events);
          emit(events, { type: EventType.TEXT_MESSAGE_END, messageId: activeMessage });
          activeMessage = undefined;
          messageHasDelta = false;
          break;
        case "delegated_agent_step": {
          const activity = delegatedActivity(event);
          const content = projectAgUiJson(activity.content, limits.maxActivityBytes, limits, "delegated activity");
          if (content && typeof content === "object" && !Array.isArray(content)) {
            emit(events, {
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: activity.messageId,
              activityType: activity.activityType,
              content,
              replace: true,
            });
            await custom(events, "prism.delegated_agent_step", content);
          }
          break;
        }
        case "tool_execution_started":
          await startTool(events, event.call);
          break;
        case "tool_execution_progress":
          await custom(events, "prism.tool_progress", {
            toolCallId: id(event.toolCallId, "tool"),
            name: text(event.name),
            status: "in_progress",
          });
          break;
        case "tool_execution_finished":
          await finishTool(events, event.result.toolCallId, event.result.name, "completed", event.result);
          if (a2ui) {
            for (const painted of a2ui.onToolFinished(event.result)) emit(events, painted);
          }
          break;
        case "tool_execution_error":
          await finishTool(events, event.call.id, event.call.name, "failed");
          break;
        case "tool_execution_blocked":
          await finishTool(events, event.toolCallId, event.name, "blocked");
          break;
        case "provider_turn_finished":
          if (event.usage) await custom(events, "prism.usage", usage(event.usage));
          if (event.error) error(events, event.error);
          break;
        case "compaction_started":
          await custom(events, "prism.compaction", { status: "started" });
          break;
        case "compaction_finished":
          await custom(events, "prism.compaction", { status: "finished" });
          break;
        case "error":
          error(events, event.error);
          break;
        default:
          break;
      }
      if (!terminal) await extras(events, event);
      return events;
    },
  };
}

function usage(value: Usage): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter(([, amount]) => typeof amount === "number" && Number.isFinite(amount))) as Record<
    string,
    number
  >;
}

function safeDelegatedNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 24 * 60 * 60 * 1000 ? value : undefined;
}

function safeDelegatedUsage(value: DelegatedAgentStep["usage"]): Record<string, number> | undefined {
  if (!value) return undefined;
  const output: Record<string, number> = {};
  for (const key of ["inputTokens", "outputTokens", "thinkingTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"] as const) {
    const amount = value[key];
    if (amount !== undefined && Number.isSafeInteger(amount) && amount >= 0 && amount <= 1_000_000_000_000) output[key] = amount;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function safeDelegatedDetail(value: DelegatedAgentStep["detail"]): DelegatedAgentStep["detail"] | undefined {
  if (!value) return undefined;
  const referenceId = value.referenceId;
  const label = value.label;
  return {
    ...(typeof referenceId === "string" && safeOpaqueReference(referenceId, 512) ? { referenceId } : {}),
    ...(typeof label === "string" && safeOpaqueReference(label, 256) ? { label } : {}),
  };
}

function safeOpaqueReference(value: string, maxBytes: number): boolean {
  return value.length > 0 && !/[\\/\\:\\0\\r\\n]/.test(value) && Buffer.byteLength(value, "utf8") <= maxBytes;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const suffixBytes = Buffer.byteLength(TRUNCATION);
  const budget = Math.max(0, maxBytes - suffixBytes);
  let bytes = 0;
  let end = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > budget) break;
    bytes += size;
    end += char.length;
  }
  return value.slice(0, end) + TRUNCATION;
}

function measure(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "mapped AG-UI event is not serializable");
  }
}
