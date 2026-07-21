import type {
  AIProvider,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  Message,
  ModelCapabilities,
  ProviderEvent,
  ProviderRequest,
  Usage } from "@arnilo/prism";
import {
  assertStructuredOutputRequestSupported,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  resolveCredentialValue,
  toolCallFromArgumentsText } from "@arnilo/prism";
import {
  applyOpenAIChatStructuredOutput,
  mapOpenAIChatUsage,
  serializeOpenAITool } from "@arnilo/prism/providers/openai";
import { readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";
import {
  kimiPreserveThinking,
  kimiReasoningEffort,
  kimiThinking,
  stripKimiThinkingCompat } from "./thinking.js";

export interface MoonshotProviderOptions {
  readonly id?: string;
  /** Defaults to Open Platform `https://api.moonshot.ai/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

/**
 * Moonshot / Kimi Open Platform Chat Completions provider (`POST /chat/completions`).
 * Official base: `https://api.moonshot.ai/v1` (or `api.moonshot.cn/v1`).
 * Distinct from Kimi For Coding Anthropic `/messages` (`createKimiCodingProvider`).
 * @see https://platform.kimi.ai/docs/api/overview
 */
export function createMoonshotProvider(options: MoonshotProviderOptions = {}): AIProvider {
  const id = options.id ?? "moonshot";
  const baseUrl = (options.baseUrl ?? "https://api.moonshot.ai/v1").replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const body = moonshotBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {})},
          body: JSON.stringify(body),
          signal: request.signal});
        if (!response.ok) {
          return yield providerError(
            new Error(`Moonshot request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Moonshot response had no body"), secrets);
        yield* moonshotEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    }};
}

export function moonshotBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const preserveThinking = kimiPreserveThinking(request);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => serializeMoonshotMessage(message, request.model.capabilities ?? {}, preserveThinking)),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    thinking: kimiThinking(request),
    reasoning_effort: kimiReasoningEffort(request),
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripKimiThinkingCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra};
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* moonshotEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  let sawDoneMarker = false;
  let sawFinishReason = false;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") { sawDoneMarker = true; break; }
    const chunk = JSON.parse(data) as MoonshotChunk;
    usage = mapOpenAIChatUsage(chunk.usage) ?? usage;
    if (chunk.usage) {
      const mapped = mapOpenAIChatUsage(chunk.usage);
      if (mapped) yield providerUsage(mapped);
    }
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason) sawFinishReason = true;
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
        yield providerToolCallDelta({
          index,
          id: tool.id,
          name: tool.function?.name,
          argumentsText: tool.function?.arguments});
      }
    }
  }
  const danglingToolCall = [...tools.values()].some((call) => !call.id || !call.name);
  if (!sawDoneMarker || !sawFinishReason || danglingToolCall) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(new Error(
      `Moonshot chat stream ended without completion evidence `
      + `([DONE]: ${sawDoneMarker ? "received" : "missing"}, `
      + `finish_reason: ${sawFinishReason ? "received" : "missing"}, `
      + `tool calls complete: ${danglingToolCall ? "no" : "yes"})`,
    ));
    return;
  }
  for (const call of tools.values()) {
    yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
  }
  yield providerDone(usage);
}

/**
 * Open Platform message serialization. When `preserveThinking`, historical thinking
 * blocks become top-level `reasoning_content` (official Preserved Thinking contract).
 * Anthropic `cache_control` is never emitted on this route.
 */
export function serializeMoonshotMessage(
  message: Message,
  capabilities: ModelCapabilities = {},
  preserveThinking = false,
): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : ""};
  }

  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part) => part.type === "text");
    const thinkingParts = message.content.filter((part) => part.type === "thinking");
    const text = textParts.map((part) => part.text).join("\n");
    const reasoning = thinkingParts.map((part) => part.text).join("\n");
    const base: Record<string, unknown> = {
      role: "assistant",
      content: text || (toolCalls.length > 0 ? null : "")};
    if (preserveThinking && reasoning) base.reasoning_content = reasoning;
    if (toolCalls.length > 0) {
      base.tool_calls = toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }}));
    }
    return base as JsonObject;
  }

  // user / system — fold thinking into text (should not normally appear)
  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text" || part.type === "thinking") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`Moonshot ${message.role} message includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Moonshot image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`Moonshot Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call" || part.type === "tool_result") {
      throw new Error(`Moonshot ${part.type} blocks must use assistant/tool roles`);
    }
  }
  if (content.length === 1 && content[0]!.type === "text") {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

interface MoonshotChunk {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly {
        readonly index?: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
  }[];
  readonly usage?: unknown;
}

