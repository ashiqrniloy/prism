import type { JsonObject, Message, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "prism";
import { providerDone, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, toolCallContent } from "prism";
import { readSseData } from "./sse.js";

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function openAIChatBody(request: ProviderRequest): JsonObject {
  return clean({
    model: request.model.model,
    messages: request.messages.map(toMessage),
    tools: request.tools?.map(toTool),
    stream: true,
    stream_options: { include_usage: true },
    ...request.model.parameters,
    ...(request.options?.compat ?? {}),
    ...(request.options?.extra ?? {}),
  });
}

export async function* openAIChatEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as OpenAIChunk;
    usage = toUsage(chunk.usage) ?? usage;
    if (chunk.usage) yield providerUsage(toUsage(chunk.usage)!);
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (delta.content) yield providerTextDelta(delta.content);
      if (delta.reasoning_content) yield providerThinkingDelta(delta.reasoning_content);
      for (const tool of delta.tool_calls ?? []) {
        const index = tool.index ?? 0;
        const current = tools.get(index) ?? { argumentsText: "" };
        current.id = tool.id ?? current.id;
        current.name = tool.function?.name ?? current.name;
        current.argumentsText += tool.function?.arguments ?? "";
        tools.set(index, current);
        yield providerToolCallDelta({ index, id: tool.id, name: tool.function?.name, argumentsText: tool.function?.arguments });
      }
    }
  }
  for (const call of tools.values()) if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
  yield providerDone(usage);
}

function toMessage(message: Message): JsonObject {
  return { role: message.role === "tool" ? "tool" : message.role, content: message.content.map((part) => part.type === "text" ? part.text : "").join("") };
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object" } } });
}

function toUsage(usage: OpenAIUsage | undefined): Usage | undefined {
  return usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens, cacheReadTokens: usage.prompt_tokens_details?.cached_tokens, cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens } : undefined;
}

function parseArgs(text: string): JsonObject {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

interface OpenAIChunk {
  readonly choices?: readonly { readonly delta?: { readonly content?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: OpenAIUsage;
}
interface OpenAIUsage { readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly total_tokens?: number; readonly prompt_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number } }
