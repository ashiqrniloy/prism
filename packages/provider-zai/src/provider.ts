import type { AIProvider, JsonObject, Message, ModelCapabilities, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "@arnilo/prism";
import { assertStructuredOutputRequestSupported, providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent, type CredentialValueSource } from "@arnilo/prism";
import {
  applyOpenAIChatStructuredOutput,
  mapOpenAIChatUsage,
  serializeOpenAIChatMessage,
  serializeOpenAITool,
} from "@arnilo/prism/providers/openai";
import {
  parseJsonObjectArguments,
  readBoundedResponseText,
  readSseData,
} from "@arnilo/prism/providers/transport";
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
          headers: { ...request.options?.headers, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(zaiBody(request)),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`Z.AI request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Z.AI response had no body"), secrets);
        yield* zaiEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function zaiBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => serializeOpenAIChatMessage(message, request.model.capabilities ?? {})),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    tool_stream: zaiToolStream(request),
    thinking: zaiThinking(request),
    reasoning_effort: zaiReasoningEffort(request),
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...request.options?.compat,
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* zaiEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as ZaiChunk;
    usage = mapOpenAIChatUsage(chunk.usage) ?? usage;
    if (chunk.usage) {
      const mapped = mapOpenAIChatUsage(chunk.usage);
      if (mapped) yield providerUsage(mapped);
    }
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

interface ZaiChunk {
  readonly choices?: readonly { readonly delta?: { readonly content?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: unknown;
}
