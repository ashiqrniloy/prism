import { EventSchemas, EventType, type AGUIEvent } from "@ag-ui/core";
import type { AgentEvent, ErrorInfo, SecretRedactor, ToolCallContent, ToolResult, Usage } from "@arnilo/prism";
import { AgUiError } from "./errors.js";
import { resolveAgUiLimits, type AgUiLimitOptions, type ResolvedAgUiLimits } from "./limits.js";
import type { AgUiProjection } from "./projection.js";

export interface AgUiEventMapperOptions {
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
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
}

interface ActiveTool {
  readonly id: string;
  readonly name: string;
}

const TRUNCATION = "… [truncated]";

/** Maps one ordered Prism event stream to safe, schema-validated AG-UI events. */
export function createAgUiEventMapper(options: AgUiEventMapperOptions = {}): AgUiEventMapper {
  const limits = resolveAgUiLimits(options.limits);
  const activeTools = new Map<string, ActiveTool>();
  let activeMessage: string | undefined;
  let messageHasDelta = false;
  let messageSequence = 0;
  let terminal = false;

  const text = (value: string, maxBytes = limits.maxTextBytes): string => {
    const redacted = options.redactor?.redact(value) ?? value;
    return truncateUtf8(redacted, Math.min(maxBytes, limits.maxEventBytes - 512));
  };
  const id = (value: string | undefined, fallback: string): string => text(value ?? fallback, limits.maxTextBytes);
  const thread = (sessionId: string) => id(options.threadId?.(sessionId), sessionId);
  const run = (runId: string, sessionId: string) => id(options.runId?.(runId, sessionId), runId);
  const emit = (events: AGUIEvent[], event: unknown): void => {
    const parsed = EventSchemas.safeParse(event);
    if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "mapper produced invalid AG-UI event");
    if (measure(parsed.data) > limits.maxEventBytes) {
      throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "mapped AG-UI event exceeds maxEventBytes");
    }
    events.push(parsed.data);
  };
  const close = (events: AGUIEvent[]): void => {
    if (activeMessage) emit(events, { type: EventType.TEXT_MESSAGE_END, messageId: activeMessage });
    activeMessage = undefined;
    messageHasDelta = false;
    for (const tool of activeTools.values()) emit(events, { type: EventType.TOOL_CALL_END, toolCallId: tool.id });
    activeTools.clear();
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
      const args = projected(() => options.projection?.toolArguments?.(call), limits.maxTextBytes);
      if (args !== undefined) emit(events, { type: EventType.TOOL_CALL_ARGS, toolCallId: tool.id, delta: args });
    }
    return tool;
  };
  const finishTool = (events: AGUIEvent[], sourceId: string, name: string, status: string, result?: ToolResult): void => {
    const tool = startTool(events, { id: sourceId, name });
    const projectedResult = result ? projected(() => options.projection?.toolResult?.(result), limits.maxTextBytes) : undefined;
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
  const state = (events: AGUIEvent[], event: AgentEvent, status: string, version?: number): void => {
    const addition = projectedJson(() => options.projection?.state?.(event), limits.maxTextBytes);
    const snapshot = {
      prism: {
        run: {
          status,
          ...(version === undefined ? {} : { version }),
          ...(addition === undefined ? {} : { state: addition }),
        },
      },
    };
    emit(events, { type: EventType.STATE_SNAPSHOT, snapshot });
  };
  const custom = (events: AGUIEvent[], name: string, value: unknown): void => {
    if (!options.includeCustomEvents) return;
    const safe = projectedJson(() => value, limits.maxTextBytes);
    if (safe !== undefined) emit(events, { type: EventType.CUSTOM, name, value: safe });
  };
  const error = (events: AGUIEvent[], info: ErrorInfo, code = "PRISM_ERROR"): void => {
    close(events);
    emit(events, { type: EventType.RUN_ERROR, message: text(info.message, limits.maxErrorBytes), code: text(String(info.code ?? code), limits.maxErrorBytes) });
    terminal = true;
  };
  const projected = (callback: () => unknown, maxBytes: number): string | undefined => {
    try {
      const value = callback();
      return typeof value === "string" ? text(value, maxBytes) : undefined;
    } catch {
      return undefined;
    }
  };
  const projectedJson = (callback: () => unknown, maxBytes: number): unknown => {
    try {
      const raw = callback();
      const value = options.redactor?.redact(raw) ?? raw;
      const serialized = JSON.stringify(value);
      if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) return undefined;
      return JSON.parse(serialized) as unknown;
    } catch {
      return undefined;
    }
  };

  return {
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
          emit(events, { type: EventType.RUN_FINISHED, threadId: thread(event.sessionId), runId: run(event.runId, event.sessionId), outcome: { type: "success" } });
          terminal = true;
          break;
        case "agent_suspended":
          close(events);
          state(events, event, "suspended", event.version);
          break;
        case "agent_resumed":
          state(events, event, "running", event.version);
          break;
        case "agent_denied":
          state(events, event, "denied", event.version);
          error(events, { message: "Run denied", code: "AGENT_DENIED" }, "AGENT_DENIED");
          break;
        case "message_started":
          if (event.message.role !== "assistant") break;
          if (activeMessage) close(events);
          activeMessage = id(event.message.id, `${event.runId}:message-${++messageSequence}`);
          emit(events, { type: EventType.TEXT_MESSAGE_START, messageId: activeMessage, role: "assistant" });
          break;
        case "message_delta":
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
              if (block.type === "text") emit(events, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: activeMessage, delta: text(block.text) });
            }
          }
          emit(events, { type: EventType.TEXT_MESSAGE_END, messageId: activeMessage });
          activeMessage = undefined;
          messageHasDelta = false;
          break;
        case "tool_execution_started":
          startTool(events, event.call);
          break;
        case "tool_execution_progress":
          custom(events, "prism.tool_progress", { toolCallId: id(event.toolCallId, "tool"), name: text(event.name), status: "in_progress" });
          break;
        case "tool_execution_finished":
          finishTool(events, event.result.toolCallId, event.result.name, "completed", event.result);
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
      return events;
    },
  };
}

function usage(value: Usage): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, amount]) => typeof amount === "number" && Number.isFinite(amount)),
  ) as Record<string, number>;
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
