import type {
  AIProvider,
  CacheControlledMessage,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  ModelCapabilities,
  ProviderEvent,
  ProviderRequest,
  Usage,
} from "@arnilo/prism";
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
  toolCallFromArgumentsText,
} from "@arnilo/prism";
import {
  applyOpenAIChatStructuredOutput,
  mapOpenAIChatUsage,
  serializeOpenAITool,
} from "@arnilo/prism/providers/openai";
import { readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";
import { alibabaBaseUrl, type AlibabaBasePreset } from "./models.js";
import { applyAlibabaCacheControl, withAlibabaCacheMarker } from "./cache.js";

export interface AlibabaProviderOptions {
  readonly id?: string;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `singapore`. */
  readonly preset?: AlibabaBasePreset;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

/**
 * Alibaba Cloud Model Studio / DashScope Chat Completions provider
 * (`POST {base}/chat/completions`, OpenAI-compatible). Works against pay-as-you-go
 * regional endpoints, workspace-dedicated endpoints, and the Coding Plan base URL.
 * Auth is a region/plan-scoped `DASHSCOPE_API_KEY` sent only as `Authorization: Bearer`.
 * @see https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
 */
export function createAlibabaProvider(options: AlibabaProviderOptions = {}): AIProvider {
  const id = options.id ?? "alibaba";
  const baseUrl = alibabaBaseUrl(options);
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const body = alibabaBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`Alibaba request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Alibaba response had no body"), secrets);
        yield* alibabaEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function alibabaBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const messages = applyAlibabaCacheControl(request);
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: messages.map((message) => serializeAlibabaMessage(message, request.model.capabilities ?? {})),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    enable_thinking: alibabaEnableThinking(request),
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripAlibabaCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* alibabaEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  let sawDoneMarker = false;
  let sawFinishReason = false;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") { sawDoneMarker = true; break; }
    const chunk = JSON.parse(data) as AlibabaChunk;
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
          argumentsText: tool.function?.arguments,
        });
      }
    }
  }
  const danglingToolCall = [...tools.values()].some((call) => !call.id || !call.name);
  if (!sawDoneMarker || !sawFinishReason || danglingToolCall) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(new Error(
      `Alibaba chat stream ended without completion evidence `
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
 * Qwen `enable_thinking` top-level toggle. Request `options.compat.enable_thinking`
 * wins over the model default; omitted on the wire unless explicitly boolean.
 */
export function alibabaEnableThinking(request: ProviderRequest): boolean | undefined {
  const value = request.options?.compat?.enable_thinking ?? request.model.compat?.enable_thinking;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * DashScope message serialization. Preserves explicit `cache_control` markers set by
 * `applyAlibabaCacheControl` on the last content block of breakpoint-selected messages.
 * Implicit prefix caching needs no marker and is always active upstream.
 */
export function serializeAlibabaMessage(message: CacheControlledMessage, capabilities: ModelCapabilities = {}): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const last = message.content[message.content.length - 1];
    const marker = (last?.cache_control ?? undefined) as unknown as JsonObject | undefined;
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
      ...(marker ? { cache_control: marker } : {}),
    };
  }

  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part) => part.type === "text");
    const thinkingParts = message.content.filter((part) => part.type === "thinking");
    const text = textParts.map((part) => part.text).join("\n");
    const reasoning = thinkingParts.map((part) => part.text).join("\n");
    const base: Record<string, unknown> = {
      role: "assistant",
      content: text || (toolCalls.length > 0 ? null : ""),
    };
    if (reasoning) base.reasoning_content = reasoning;
    if (toolCalls.length > 0) {
      base.tool_calls = toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }));
    }
    return base as JsonObject;
  }

  // user / system — array form so cache_control markers can land on the last block.
  const content: JsonObject[] = [];
  for (const part of message.content) {
    const marker = (part.cache_control ?? undefined) as unknown as JsonObject | undefined;
    if (part.type === "text" || part.type === "thinking") {
      content.push(withAlibabaCacheMarker({ type: "text", text: part.text }, marker));
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`Alibaba ${message.role} message includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Alibaba image block missing url or data");
      content.push(withAlibabaCacheMarker({ type: "image_url", image_url: { url } }, marker));
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`Alibaba Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call" || part.type === "tool_result") {
      throw new Error(`Alibaba ${part.type} blocks must use assistant/tool roles`);
    }
  }
  if (content.length === 1 && content[0]!.type === "text" && !content[0]!.cache_control) {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
}

/** Strip provider-owned compat keys so the opaque spread cannot leak routing directives. */
function stripAlibabaCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const { enable_thinking: _thinking, route: _route, alibaba: _meta, ...rest } = compat as Record<string, unknown>;
  return rest as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

interface AlibabaChunk {
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
