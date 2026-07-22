import type { SessionUpdate, ToolCallContent, ToolKind } from "@agentclientprotocol/sdk";
import type { AgentEvent, ErrorInfo, SecretRedactor, ToolCallContent as PrismToolCall, ToolResult, Usage } from "@arnilo/prism";
import { resolveAgUiLimits, type AgUiLimitOptions } from "../limits.js";
import type { AgUiProjection } from "../projection.js";

export interface AcpEventMapperOptions {
  readonly redactor?: SecretRedactor;
  /** Shared host allow-list; tool text is omitted unless explicitly projected. */
  readonly projection?: AgUiProjection;
  readonly limits?: AgUiLimitOptions;
}

export interface AcpEventMapper {
  map(event: AgentEvent): readonly SessionUpdate[];
}

/** Maps redacted Prism lifecycle events to stable ACP v1 session updates. */
export function createAcpEventMapper(options: AcpEventMapperOptions = {}): AcpEventMapper {
  const limits = resolveAgUiLimits(options.limits);
  let messageId: string | undefined;
  let messageHasDelta = false;

  const text = (value: string, maxBytes = limits.maxTextBytes) => truncate(options.redactor?.redact(value) ?? value, Math.min(maxBytes, limits.maxEventBytes));
  const tool = (call: PrismToolCall) => {
    const input = projected(() => options.projection?.toolArguments?.(call));
    return {
      toolCallId: text(call.id),
      title: text(call.name),
      kind: kind(call.name),
      status: "in_progress" as const,
      ...(input ? { content: [content(input)] } : {}),
    };
  };
  const finish = (id: string, name: string, status: "completed" | "failed", result?: ToolResult): SessionUpdate => {
    const output = result ? projected(() => options.projection?.toolResult?.(result)) : undefined;
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: text(id),
      title: text(name),
      status,
      ...(output ? { content: [content(output)] } : {}),
    };
  };
  const projected = (callback: () => string | undefined): string | undefined => {
    try {
      const value = callback();
      return typeof value === "string" ? text(value) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    map(input) {
      const event = options.redactor?.redact(input) ?? input;
      switch (event.type) {
        case "message_started":
          if (event.message.role !== "assistant") return [];
          messageId = text(event.message.id ?? `${event.runId}:message`);
          messageHasDelta = false;
          return [];
        case "message_delta":
          if (event.content.type !== "text") return [];
          messageId ??= `${text(event.runId)}:message`;
          messageHasDelta = true;
          return [message(messageId ?? `${text(event.runId)}:message`, text(event.content.text))];
        case "message_finished":
          if (event.message.role !== "assistant") return [];
          const id = messageId ?? text(event.message.id ?? `${event.runId}:message`);
          const updates = messageHasDelta ? [] : event.message.content.flatMap((block) => block.type === "text" ? [message(id, text(block.text))] : []);
          messageId = undefined;
          messageHasDelta = false;
          return updates;
        case "tool_execution_started":
          return [{ sessionUpdate: "tool_call", ...tool(event.call) }];
        case "tool_execution_progress":
          return [{ sessionUpdate: "tool_call_update", toolCallId: text(event.toolCallId), title: text(event.name), status: "in_progress" }];
        case "tool_execution_finished":
          return [finish(event.result.toolCallId, event.result.name, "completed", event.result)];
        case "tool_execution_error":
          return [finish(event.call.id, event.call.name, "failed")];
        case "tool_execution_blocked":
          return [finish(event.toolCallId, event.name, "failed")];
        case "provider_turn_finished":
          if (event.error) return [error(event.error, text)];
          return event.usage ? [usage(event.usage)] : [];
        case "agent_denied":
          return [message(`${text(event.runId)}:status`, "Run denied")];
        case "error":
          return [error(event.error, text)];
        default:
          return [];
      }
    },
  };
}

function message(messageId: string, text: string): SessionUpdate {
  return { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } };
}

function content(text: string): ToolCallContent {
  return { type: "content", content: { type: "text", text } };
}

function error(value: ErrorInfo, text: (value: string, maxBytes?: number) => string): SessionUpdate {
  return message("prism:error", `Agent error: ${text(value.message, 8 * 1024)}`);
}

function usage(value: Usage): SessionUpdate {
  const used = value.totalTokens ?? (value.inputTokens ?? 0) + (value.outputTokens ?? 0);
  return { sessionUpdate: "usage_update", used: Math.max(0, used), size: Math.max(1, used) };
}

function kind(name: string): ToolKind {
  if (name.includes("read")) return "read";
  if (name.includes("edit") || name.includes("write")) return "edit";
  if (name.includes("delete")) return "delete";
  if (name.includes("search") || name.includes("list")) return "search";
  if (name.includes("shell") || name.includes("exec") || name.includes("bash")) return "execute";
  if (name.includes("fetch")) return "fetch";
  return "other";
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let out = "";
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
