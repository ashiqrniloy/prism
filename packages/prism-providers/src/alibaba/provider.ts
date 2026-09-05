import type {
  AIProvider,
  CacheControlledMessage,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  ModelCapabilities,
  ProviderEvent,
  ProviderRequest,
} from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { applyAlibabaCacheControl, withAlibabaCacheMarker } from "./cache.js";
import { type AlibabaBasePreset, alibabaBaseUrl } from "./models.js";

export interface AlibabaProviderOptions {
  readonly id?: string;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `singapore`. */
  readonly preset?: AlibabaBasePreset;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

/**
 * Alibaba Cloud Model Studio / DashScope Chat Completions provider
 * (`POST {base}/chat/completions`, OpenAI-compatible). Works against pay-as-you-go
 * regional endpoints, workspace-dedicated endpoints, and the Coding Plan base URL.
 * Auth is a region/plan-scoped `DASHSCOPE_API_KEY` sent only as `Authorization: Bearer`.
 * @see https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
 */
export function createAlibabaProvider(options: AlibabaProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "alibaba",
    baseUrl: alibabaBaseUrl(options),
    apiKey: options.apiKey,
    fetch: options.fetch,
    strictCompletion: true,
    requestFailedPrefix: "Alibaba request failed",
    mapMessages: (request) => applyAlibabaCacheControl(request),
    serializeMessage: (message, request) => serializeAlibabaMessage(message as CacheControlledMessage, request.model.capabilities ?? {}),
    transformBody: (body, request) => alibabaTransform(body, request),
  });
}

export function alibabaBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    mapMessages: (req) => applyAlibabaCacheControl(req),
    serializeMessage: (message, req) => serializeAlibabaMessage(message as CacheControlledMessage, req.model.capabilities ?? {}),
    transformBody: (body, req) => alibabaTransform(body, req),
  });
}

function alibabaTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    // Model `parameters.enable_thinking` wins over the compat-derived default (legacy order).
    enable_thinking: (rest.enable_thinking as boolean | undefined) ?? alibabaEnableThinking(request),
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripAlibabaCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function alibabaEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, strictCompletion: true });
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
    } else if (part.type === "video") {
      // Qwen-VL compatible-mode video input: `video_url` content part (public URL or
      // base64 data URL). Gated on the typed `video` input capability; `fps` defaults
      // upstream to 2.0. (Plan 061 Task 5 migrated video off the `file`-part workaround.)
      if (!capabilities.input?.includes("video")) {
        throw new Error(`Alibaba ${message.role} message includes video but model does not declare video input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mediaType ?? "video/mp4"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Alibaba video block missing url or data");
      content.push(withAlibabaCacheMarker({ type: "video_url", video_url: { url } }, marker));
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      // Document input has no OpenAI-compatible content part (Task 1 record: the
      // compatible path is the OpenAI Files API file-extract + fileid:// reference).
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
