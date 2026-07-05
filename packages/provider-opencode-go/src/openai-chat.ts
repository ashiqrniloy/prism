import type { ContentBlock, JsonObject, Message, ModelCapabilities, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "@arnilo/prism";
import { providerDone, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, toolCallContent } from "@arnilo/prism";
import { readSseData } from "./sse.js";

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function openAIChatBody(request: ProviderRequest): JsonObject {
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  return clean({
    model: request.model.model,
    messages: request.messages.map((message) => toMessage(message, request.model.capabilities ?? {})),
    tools: request.tools?.map(toTool),
    stream: true,
    stream_options: { include_usage: true },
    ...parameters,
    max_tokens: maxTokens,
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

function toMessage(message: Message, capabilities: ModelCapabilities = {}): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }
  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part) => part.type === "text" || part.type === "thinking");
    if (toolCalls.length > 0) {
      return {
        role: "assistant",
        content: textParts.map((part) => part.text).join("\n") || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text" || part.type === "thinking") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`OpenCode Go OpenAI route request includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("OpenCode Go OpenAI route image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "tool_call") {
      throw new Error("OpenCode Go OpenAI route assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("OpenCode Go OpenAI route tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text") {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
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
