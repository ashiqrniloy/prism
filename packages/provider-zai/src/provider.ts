import type { AIProvider, ContentBlock, CredentialValueSource, JsonObject, Message, ModelCapabilities, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "@arnilo/prism";
import { providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent } from "@arnilo/prism";
import { readSseData } from "./sse.js";
import { zaiReasoningEffort, zaiThinking, zaiToolStream } from "./thinking.js";

export interface ZaiProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function createZaiProvider(options: ZaiProviderOptions = {}): AIProvider {
  const id = options.id ?? "zai";
  const baseUrl = (options.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4").replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const secrets = [token];
      try {
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...request.options?.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(zaiBody(request)),
          signal: request.signal,
        });
        if (!response.ok) return yield providerError(new Error(`Z.AI request failed: ${response.status} ${await safeText(response)}`), secrets);
        if (!response.body) return yield providerError(new Error("Z.AI response had no body"), secrets);
        yield* zaiEvents(response.body);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function zaiBody(request: ProviderRequest): JsonObject {
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  return clean({
    model: request.model.model,
    messages: request.messages.map((message) => toMessage(message, request.model.capabilities ?? {})),
    tools: request.tools?.map(toTool),
    stream: true,
    tool_stream: zaiToolStream(request),
    thinking: zaiThinking(request),
    reasoning_effort: zaiReasoningEffort(request),
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...request.options?.compat,
    ...request.options?.extra,
  });
}

export async function* zaiEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as ZaiChunk;
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
        throw new Error(`Z.AI request includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Z.AI image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "tool_call") {
      throw new Error("Z.AI assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("Z.AI tool_result blocks must appear in role=tool messages");
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

function toUsage(usage: ZaiUsage | undefined): Usage | undefined {
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

async function safeText(response: Response): Promise<string> {
  try { return await response.text(); } catch { return ""; }
}

interface ZaiChunk {
  readonly choices?: readonly { readonly delta?: { readonly content?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: ZaiUsage;
}
interface ZaiUsage { readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly total_tokens?: number; readonly prompt_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number } }
