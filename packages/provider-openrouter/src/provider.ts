import type { AIProvider, CacheControlledMessage, ContentBlock, CredentialValueSource, JsonObject, Message, ModelCapabilities, ModelConfig, ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertStructuredOutputRequestSupported, providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput, serializeOpenAITool } from "@arnilo/prism/providers/openai";
import { rejectProviderMediaBlock } from "@arnilo/prism/providers/media";
import { parseJsonObjectArguments, readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";
import { applyOpenRouterCacheControl, openRouterSessionId, openRouterUsage, type OpenRouterUsage } from "./cache.js";

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
        const sessionId = openRouterSessionId(request.options);
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: cleanHeaders({
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(sessionId ? { "x-session-id": sessionId } : {}),
            ...(options.appUrl ? { "http-referer": options.appUrl } : {}),
            ...(options.appTitle ? { "x-title": options.appTitle } : {}),
          }),
          body: JSON.stringify(openRouterBody(request, sessionId)),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`OpenRouter request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("OpenRouter response had no body"), secrets);
        yield* openRouterEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function openRouterBody(request: ProviderRequest, sessionId = openRouterSessionId(request.options)): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const routing = request.model.compat?.openRouterRouting;
  const reasoning = request.options?.compat?.reasoning ?? request.model.compat?.reasoning;
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const messages = applyOpenRouterCacheControl(request);
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: messages.map((message) => toOpenRouterMessage(message, request.model)),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    provider: routing,
    reasoning,
    session_id: sessionId,
    ...parameters,
    max_tokens: maxTokens,
    ...request.options?.compat,
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

function toOpenRouterMessage(message: CacheControlledMessage, model: ModelConfig): JsonObject {
  const capabilities = model.capabilities ?? {};
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
      content.push(withMarker({ type: "text", text: part.text }, part.cache_control as JsonObject | undefined));
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`OpenRouter request includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("OpenRouter image block missing url or data");
      content.push(withMarker({ type: "image_url", image_url: { url } }, part.cache_control as JsonObject | undefined));
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      rejectProviderMediaBlock(part, capabilities, model);
    } else if (part.type === "tool_call") {
      throw new Error("OpenRouter assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("OpenRouter tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text" && !(content[0]! as { cache_control?: unknown }).cache_control) {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
}

function withMarker(item: JsonObject, marker: JsonObject | undefined): JsonObject {
  return marker ? { ...item, cache_control: marker } : item;
}

export async function* openRouterEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage;
  for await (const data of readSseData(body, { signal })) {
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
  for (const call of tools.values()) {
    if (call.id && call.name) {
      yield providerToolCall(toolCallContent(
        call.id,
        call.name,
        parseJsonObjectArguments(call.argumentsText, { toolName: call.name }),
      ));
    }
  }
  yield providerDone(usage);
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

function cleanHeaders(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Record<string, string>;
}

interface OpenRouterChunk {
  readonly choices?: readonly { readonly delta?: { readonly content?: string; readonly reasoning?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: OpenRouterUsage;
}
