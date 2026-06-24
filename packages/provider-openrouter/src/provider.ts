import type { AIProvider, ContentBlock, CredentialValueSource, JsonObject, Message, ModelCapabilities, ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent } from "@arnilo/prism";
import { openRouterSessionId, openRouterUsage, withOpenRouterCache, type OpenRouterUsage } from "./cache.js";
import { readSseData } from "./sse.js";

export interface OpenRouterProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly appUrl?: string;
  readonly appTitle?: string;
}

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): AIProvider {
  const id = options.id ?? "openrouter";
  const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const secrets = [token];
      try {
        const sessionId = openRouterSessionId(request);
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: cleanHeaders({
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(sessionId ? { "x-session-id": sessionId } : {}),
            ...(options.appUrl ? { "http-referer": options.appUrl } : {}),
            ...(options.appTitle ? { "x-title": options.appTitle } : {}),
            ...request.options?.headers,
          }),
          body: JSON.stringify(openRouterBody(request, sessionId)),
          signal: request.signal,
        });
        if (!response.ok) return yield providerError(new Error(`OpenRouter request failed: ${response.status} ${await safeText(response)}`), secrets);
        if (!response.body) return yield providerError(new Error("OpenRouter response had no body"), secrets);
        yield* openRouterEvents(response.body);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function openRouterBody(request: ProviderRequest, sessionId = openRouterSessionId(request)): JsonObject {
  const routing = request.model.compat?.openRouterRouting;
  const reasoning = request.options?.compat?.reasoning ?? request.model.compat?.reasoning;
  const cache = request.options?.cacheRetention !== "none" && request.model.compat?.openRouterCache === true;
  return clean({
    model: request.model.model,
    messages: request.messages.map((message) => withOpenRouterCache(toOpenRouterMessage(message, request.model.capabilities ?? {}), cache)),
    tools: request.tools?.map(toTool),
    stream: true,
    stream_options: { include_usage: true },
    provider: routing,
    reasoning,
    session_id: sessionId,
    ...request.model.parameters,
    ...request.options?.compat,
    ...request.options?.extra,
  });
}

function toOpenRouterMessage(message: Message, capabilities: ModelCapabilities = {}): JsonObject {
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
        throw new Error(`OpenRouter request includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("OpenRouter image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "tool_call") {
      throw new Error("OpenRouter assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("OpenRouter tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text") {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
}

export async function* openRouterEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage;
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as OpenRouterChunk;
    const mapped = openRouterUsage(chunk.usage);
    if (mapped) {
      usage = mapped;
      yield providerUsage(mapped);
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (delta.content) yield providerTextDelta(delta.content);
      const thinking = delta.reasoning ?? delta.reasoning_content;
      if (thinking) yield providerThinkingDelta(thinking);
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

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object" } } });
}

function parseArgs(text: string): JsonObject {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

function cleanHeaders(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Record<string, string>;
}

async function safeText(response: Response): Promise<string> {
  try { return await response.text(); } catch { return ""; }
}

interface OpenRouterChunk {
  readonly choices?: readonly { readonly delta?: { readonly content?: string; readonly reasoning?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: OpenRouterUsage;
}
