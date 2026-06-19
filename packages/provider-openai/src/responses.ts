import type { AIProvider, CredentialValueSource, JsonObject, Message, ProviderRequest, ToolDefinition, Usage } from "prism";
import { providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent } from "prism";
import { promptCacheKey, promptCacheRetention } from "./cache.js";
import { readSseData } from "./sse.js";

export interface OpenAIResponsesProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions = {}): AIProvider {
  const id = options.id ?? "openai";
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const secrets = [token];
      const tools = new Map<number, ToolAccumulator>();
      let usage: Usage | undefined;
      try {
        const response = await (options.fetch ?? fetch)(`${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...request.options?.headers,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(request.options?.sessionId ? { "x-client-request-id": request.options.sessionId } : {}),
          },
          body: JSON.stringify(toResponsesRequest(request)),
          signal: request.signal,
        });
        if (!response.ok) return yield providerError(new Error(`OpenAI request failed: ${response.status} ${await safeText(response)}`), secrets);
        if (!response.body) return yield providerError(new Error("OpenAI response had no body"), secrets);

        for await (const data of readSseData(response.body)) {
          if (data === "[DONE]") break;
          const event = JSON.parse(data) as OpenAIResponseEvent;
          if (typeof event.delta === "string" && event.type?.includes("output_text")) yield providerTextDelta(event.delta);
          if (typeof event.delta === "string" && event.type?.includes("reasoning")) yield providerThinkingDelta(event.delta);
          const tool = event.item ?? event.delta;
          if (isToolDelta(tool)) {
            const index = tool.index ?? 0;
            const current = tools.get(index) ?? { argumentsText: "" };
            current.id = tool.id ?? current.id;
            current.name = tool.name ?? current.name;
            current.argumentsText += tool.arguments ?? tool.arguments_delta ?? "";
            tools.set(index, current);
            yield providerToolCallDelta({ index, id: tool.id, name: tool.name, argumentsText: tool.arguments ?? tool.arguments_delta });
          }
          usage = toUsage(event.response?.usage ?? event.usage) ?? usage;
          if (event.type?.endsWith("completed") && usage) yield providerUsage(usage);
        }
        for (const call of tools.values()) if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
        yield providerDone(usage);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

function toResponsesRequest(request: ProviderRequest): JsonObject {
  const payload: Record<string, unknown> = {
    model: request.model.model,
    input: request.messages.map(toInputMessage),
    tools: request.tools?.map(toTool),
    stream: true,
    store: false,
    prompt_cache_key: promptCacheKey(request.options),
    prompt_cache_retention: promptCacheRetention(request.options),
    ...request.model.parameters,
    ...(request.options?.compat ?? {}),
    ...(request.options?.extra ?? {}),
  };
  return clean(payload);
}

function toInputMessage(message: Message): JsonObject {
  return clean({ role: message.role === "tool" ? "user" : message.role, content: message.content.map((part) => part.type === "text" ? part.text : "").join("") });
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object" } });
}

function toUsage(usage: OpenAIUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.input_tokens_details?.cached_tokens,
  };
}

function isToolDelta(value: unknown): value is { index?: number; id?: string; name?: string; arguments?: string; arguments_delta?: string } {
  return !!value && typeof value === "object" && ("arguments" in value || "arguments_delta" in value) && ("name" in value || "id" in value);
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

interface OpenAIResponseEvent {
  readonly type?: string;
  readonly delta?: unknown;
  readonly item?: unknown;
  readonly response?: { readonly usage?: OpenAIUsage };
  readonly usage?: OpenAIUsage;
}

interface OpenAIUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens_details?: { readonly cached_tokens?: number };
}
