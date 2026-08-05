import { type AGUIEvent, EventSchemas, EventType } from "@ag-ui/core";
import type { AgentEvent, ErrorInfo, SecretRedactor, ThinkingContent, ToolCallContent, ToolResult, Usage } from "@arnilo/prism";
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
  map(event: AgentEvent): readonly AGUIEvent[];
  /** Projects one co-work event to safe AG-UI CUSTOM events; malformed input yields none. */
  mapCoWork(event: CoWorkEvent): readonly AGUIEvent[];
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
  const startTool = (events: AGUIEvent[], call: ToolCallContent | Pick<ActiveTool, "id" | "name">): ActiveTool => {
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
      const args = projectedText(() => options.projection?.toolArguments?.(call), limits.maxTextBytes);
      if (args !== undefined) emit(events, { type: EventType.TOOL_CALL_ARGS, toolCallId: tool.id, delta: args });
    }
    return tool;
  };
  const finishTool = (events: AGUIEvent[], sourceId: string, name: string, status: string, result?: ToolResult): void => {
    const tool = startTool(events, { id: sourceId, name });
    const projectedResult = result ? projectedText(() => options.projection?.toolResult?.(result), limits.maxTextBytes) : undefined;
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
  const statusState = (events: AGUIEvent[], event: AgentEvent, status: string, version?: number): void => {
    const addition = projectedJson(() => options.projection?.state?.(event), limits.maxStateBytes, "state");
    emit(events, {
      type: EventType.STATE_SNAPSHOT,
      snapshot: {
        prism: { run: { status, ...(version === undefined ? {} : { version }), ...(addition === undefined ? {} : { state: addition }) } },
      },
    });
  };
  const custom = (events: AGUIEvent[], name: string, value: unknown): void => {
    if (!options.includeCustomEvents) return;
    const safe = projectedJson(() => value, limits.maxTextBytes, "custom");
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
  const projectedText = (callback: () => unknown, maxBytes: number): string | undefined => {
    try {
      const value = callback();
      return typeof value === "string" ? text(value, maxBytes) : undefined;
    } catch {
      return undefined;
    }
  };
  const projectedJson = (callback: () => unknown, maxBytes: number, name: string): unknown => {
    try {
      const value = callback();
      return projectAgUiJson(options.redactor?.redact(value) ?? value, maxBytes, limits, name);
    } catch {
      return undefined;
    }
  };
  const reasoning = (events: AGUIEvent[], content: ThinkingContent, event: AgentEvent): void => {
    let projected: ReturnType<NonNullable<AgUiProjection["reasoning"]>> | undefined;
    try {
      projected = options.projection?.reasoning?.(content, event);
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
  const extras = (events: AGUIEvent[], event: AgentEvent): void => {
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
    const snapshot = projectedJson(() => options.projection?.stateSnapshot?.(event), limits.maxStateBytes, "stateSnapshot");
    if (snapshot !== undefined) emit(events, { type: EventType.STATE_SNAPSHOT, snapshot });

    let delta: readonly unknown[] | undefined;
    try {
      delta = options.projection?.stateDelta?.(event);
    } catch {
      delta = undefined;
    }
    const statePatch = projectAgUiPatch(delta, limits.maxPatchOperations, limits.maxStateBytes, limits, "stateDelta");
    if (statePatch !== undefined) emit(events, { type: EventType.STATE_DELTA, delta: statePatch });

    const messages = projectedJson(() => options.projection?.messages?.(event), limits.maxStateBytes, "messages");
    if (Array.isArray(messages)) emit(events, { type: EventType.MESSAGES_SNAPSHOT, messages });

    let activity: ReturnType<NonNullable<AgUiProjection["activity"]>> | undefined;
    try {
      activity = options.projection?.activity?.(event);
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

    let raw: ReturnType<NonNullable<AgUiProjection["raw"]>> | undefined;
    try {
      raw = options.projection?.raw?.(event);
    } catch {
      raw = undefined;
    }
    if (raw) {
      const value = projectAgUiJson(raw.event, limits.maxRawEventBytes, limits, "raw");
      if (value !== undefined) emit(events, { type: EventType.RAW, event: value, ...(raw.source ? { source: text(raw.source) } : {}) });
    }

    let projectedCustom: ReturnType<NonNullable<AgUiProjection["custom"]>> | undefined;
    try {
      projectedCustom = options.projection?.custom?.(event);
    } catch {
      projectedCustom = undefined;
    }
    if (projectedCustom) {
      const value = projectAgUiJson(projectedCustom.value, limits.maxTextBytes, limits, "custom");
      if (value !== undefined) emit(events, { type: EventType.CUSTOM, name: text(projectedCustom.name), value });
    }
  };

  return {
    mapCoWork(input) {
      const events: AGUIEvent[] = [];
      const payload = projectCoWorkEvent(input, {
        redactor: options.redactor,
        projection: options.projection,
        maxBytes: limits.maxTextBytes,
      });
      if (payload === undefined) return events;
      emit(events, { type: EventType.CUSTOM, name: `prism.cowork.${input.kind}`, value: payload });
      return events;
    },
    map(input) {
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
          close(events);
          statusState(events, event, "suspended", event.version);
          break;
        case "agent_resumed":
          statusState(events, event, "running", event.version);
          break;
        case "agent_denied":
          statusState(events, event, "denied", event.version);
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
            reasoning(events, event.content, event);
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
              if (block.type === "thinking") reasoning(events, block, event);
            }
          }
          closeReasoning(events);
          emit(events, { type: EventType.TEXT_MESSAGE_END, messageId: activeMessage });
          activeMessage = undefined;
          messageHasDelta = false;
          break;
        case "tool_execution_started":
          startTool(events, event.call);
          break;
        case "tool_execution_progress":
          custom(events, "prism.tool_progress", {
            toolCallId: id(event.toolCallId, "tool"),
            name: text(event.name),
            status: "in_progress",
          });
          break;
        case "tool_execution_finished":
          finishTool(events, event.result.toolCallId, event.result.name, "completed", event.result);
          if (a2ui) {
            for (const painted of a2ui.onToolFinished(event.result)) emit(events, painted);
          }
          break;
        case "tool_execution_error":
          finishTool(events, event.call.id, event.call.name, "failed");
          break;
        case "tool_execution_blocked":
          finishTool(events, event.toolCallId, event.name, "blocked");
          break;
        case "provider_turn_finished":
          if (event.usage) custom(events, "prism.usage", usage(event.usage));
          if (event.error) error(events, event.error);
          break;
        case "compaction_started":
          custom(events, "prism.compaction", { status: "started" });
          break;
        case "compaction_finished":
          custom(events, "prism.compaction", { status: "finished" });
          break;
        case "error":
          error(events, event.error);
          break;
        default:
          break;
      }
      if (!terminal) extras(events, event);
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

function truncateUtf8(value: string, maxBytes: number): string {
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
