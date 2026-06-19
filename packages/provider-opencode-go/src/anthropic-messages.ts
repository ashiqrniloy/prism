import type { JsonObject, Message, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "prism";
import { providerDone, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, toolCallContent } from "prism";
import { readSseData } from "./sse.js";

interface PartialBlock { id?: string; name?: string; argumentsText: string }

export function anthropicMessagesBody(request: ProviderRequest): JsonObject {
  return clean({
    model: request.model.model,
    messages: request.messages.filter((m) => m.role !== "system").map(toMessage),
    system: request.messages.filter((m) => m.role === "system").map(text).join("\n\n") || undefined,
    tools: request.tools?.map(toTool),
    stream: true,
    max_tokens: request.model.limits?.maxOutputTokens ?? 4096,
    ...request.model.parameters,
    ...(request.options?.compat ?? {}),
    ...(request.options?.extra ?? {}),
  });
}

export async function* anthropicMessagesEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
  const blocks = new Map<number, PartialBlock>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data) as AnthropicEvent;
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      blocks.set(event.index ?? 0, { id: event.content_block.id, name: event.content_block.name, argumentsText: "" });
    }
    if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) yield providerTextDelta(delta.text);
      if (delta?.type === "thinking_delta" && delta.thinking) yield providerThinkingDelta(delta.thinking);
      if (delta?.type === "input_json_delta") {
        const index = event.index ?? 0;
        const current = blocks.get(index) ?? { argumentsText: "" };
        current.argumentsText += delta.partial_json ?? "";
        blocks.set(index, current);
        yield providerToolCallDelta({ index, id: current.id, name: current.name, argumentsText: delta.partial_json });
      }
    }
    usage = toUsage(event.message?.usage ?? event.usage) ?? usage;
    if (event.type === "message_delta" && usage) yield providerUsage(usage);
  }
  for (const call of blocks.values()) if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
  yield providerDone(usage);
}

function toMessage(message: Message): JsonObject {
  return { role: message.role === "assistant" ? "assistant" : "user", content: text(message) };
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ name: tool.name, description: tool.description, input_schema: tool.parameters ?? { type: "object" } });
}

function text(message: Message): string {
  return message.content.map((part) => part.type === "text" ? part.text : "").join("");
}

function toUsage(usage: AnthropicUsage | undefined): Usage | undefined {
  return usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens, cacheWriteTokens: usage.cache_creation_input_tokens } : undefined;
}

function parseArgs(text: string): JsonObject {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0))) as JsonObject;
}

interface AnthropicEvent {
  readonly type?: string;
  readonly index?: number;
  readonly content_block?: { readonly type?: string; readonly id?: string; readonly name?: string };
  readonly delta?: { readonly type?: string; readonly text?: string; readonly thinking?: string; readonly partial_json?: string };
  readonly message?: { readonly usage?: AnthropicUsage };
  readonly usage?: AnthropicUsage;
}
interface AnthropicUsage { readonly input_tokens?: number; readonly output_tokens?: number; readonly cache_read_input_tokens?: number; readonly cache_creation_input_tokens?: number }
