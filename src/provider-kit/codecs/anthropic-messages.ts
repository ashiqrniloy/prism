import type { MediaContentBlock, ResolvedMediaContent } from "../../content.js";
import type {
  ContentBlock,
  DocumentContent,
  FileContent,
  JsonObject,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  ToolDefinition,
  Usage,
} from "../../contracts.js";
import {
  mapProviderStopReason,
  providerContentDelta,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallFromArgumentsText,
} from "../../models/events.js";
import {
  anthropicCacheEnabled,
  applyCacheControl,
  type CacheControlledMessage,
  type CacheControlValue,
  resolvePromptCachePlan,
  systemCacheControlField,
} from "../cache-helpers.js";
import {
  bytesToBase64,
  isPdfMediaType,
  rejectProviderMediaBlock,
  resolveProviderMediaMessages,
  serializePdfDocumentWireBlock,
} from "../media.js";
import { OMITTED_TOOL_RESULT_IMAGE_NOTE, serializeToolResultText } from "../openai-primitives.js";
import { canonicalizeJsonSchema } from "../schema.js";
import { assertStructuredOutputRequestSupported } from "../structured-output.js";
import { resolvePreserveThinking, resolveReasoningEffort, resolveThinkingObject, stripOwnedCompat } from "../thinking.js";
import { createToolNameMap, productToolName, type ToolNameMap, wireToolName } from "../tool-names.js";
import { readSseEvents } from "../transport.js";
import { normalizeUsage } from "../usage.js";

/**
 * Shared Anthropic Messages route serializer (body + SSE events) for the
 * dual-route gateway adapters (opencode-go, hyper).
 *
 * Provider-specific behavior is injected through {@link AnthropicMessagesRouteHooks}
 * so the serializer itself stays provider-agnostic. All hooks have sensible defaults.
 */
export interface AnthropicMessagesRouteHooks {
  /** Applies the provider's cache-control markers and returns the messages to serialize. Defaults to request.messages. */
  readonly applyCacheControl?: (request: ProviderRequest) => readonly CacheControlledMessage[];
  /** Whether assistant thinking blocks are preserved on the wire. Defaults to resolvePreserveThinking. */
  readonly preserveThinking?: (request: ProviderRequest) => boolean;
  /** Removes provider-owned compat options so they never reach the wire. Defaults to stripOwnedCompat. */
  readonly stripOwnedCompat?: (compat: JsonObject | undefined) => JsonObject | undefined;
  /** Resolved Anthropic Messages `thinking` object (generation-aware). Defaults to resolveThinkingObject. */
  readonly thinking?: (request: ProviderRequest) => JsonObject | undefined;
  /** Resolved `output_config.effort` value (official field, not top-level `effort`). Defaults to resolveReasoningEffort. */
  readonly effort?: (request: ProviderRequest) => string | undefined;
  /** Optional session/cache affinity headers injected for the route. */
  readonly affinity?: (request: ProviderRequest) => Record<string, string>;
  /** Per-request product ↔ wire tool-name map. */
  readonly toolNames?: ToolNameMap;
}

export interface AnthropicMessagesEventsOptions {
  readonly signal?: AbortSignal;
  readonly secrets?: readonly (string | undefined)[];
  readonly mapUsage?: (usage: unknown) => Usage | undefined;
  /** Must be the same map that serialized the request. */
  readonly toolNames?: ToolNameMap;
}

interface PartialBlock {
  type?: "tool_use" | "thinking" | "redacted_thinking";
  id?: string;
  name?: string;
  argumentsText: string;
  signature?: string;
  data?: string;
  complete?: boolean;
}

export async function anthropicMessagesBody(request: ProviderRequest, hooks: AnthropicMessagesRouteHooks = {}): Promise<JsonObject> {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const toolNames = hooks.toolNames ?? createToolNameMap(request.tools);
  const preserveThinking = (hooks.preserveThinking ?? resolvePreserveThinking)(request);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const cacheEnabled = anthropicCacheEnabled(request);
  const breakpoints = cacheEnabled ? (request.options?.cache?.breakpoints ?? []) : [];
  const maxBreakpoints = request.model.cache?.maxBreakpoints;
  const ttl =
    (request.options?.cacheRetention ?? request.options?.cache?.retention) === "long" && request.model.cache?.longRetention !== false
      ? "1h"
      : undefined;
  const hasTools = Boolean(request.tools && request.tools.length > 0);

  const plan = resolvePromptCachePlan(request.messages, breakpoints, {
    ttl,
    maxBreakpoints,
    hasTools,
  });

  const messages = hooks.applyCacheControl
    ? hooks.applyCacheControl(request)
    : cacheEnabled && breakpoints.length > 0
      ? applyCacheControl(request.messages, breakpoints, { ttl, maxBreakpoints, hasTools })
      : (request.messages as readonly CacheControlledMessage[]);

  const resolvedMedia = await resolveProviderMediaMessages(messages, request.model, { signal: request.signal });
  const strip = hooks.stripOwnedCompat ?? stripOwnedCompat();
  const compatRest = strip(request.options?.compat);
  const resolvedEffort = (hooks.effort ?? resolveReasoningEffort)(request);
  const resolvedThinking = (hooks.thinking ?? resolveThinkingObject)(request);
  return clean({
    model: request.model.model,
    messages: await Promise.all(
      messages
        .filter((m) => m.role !== "system")
        .map((message) => toMessage(message, request.model, preserveThinking, resolvedMedia, toolNames)),
    ),
    system: systemCacheControlField(messages, (m) => text(m, preserveThinking)),
    tools: request.tools?.map((tool, index, array) => {
      const isLast = index === array.length - 1;
      const marker = plan.markTools && isLast ? plan.cacheControl : undefined;
      return toTool(tool, marker, toolNames);
    }),
    stream: true,
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens ?? 4096,
    ...compatRest,
    ...(request.options?.extra ?? {}),
    // Resolved official fields win over raw compat/extra escape hatches.
    thinking: resolvedThinking,
    output_config: resolvedEffort ? { effort: resolvedEffort } : undefined,
  });
}

export async function* anthropicMessagesEvents(
  body: ReadableStream<Uint8Array>,
  signalOrOptions?: AbortSignal | AnthropicMessagesEventsOptions,
): AsyncIterable<ProviderEvent> {
  const options = signalOrOptions instanceof AbortSignal ? undefined : signalOrOptions;
  const signal =
    signalOrOptions instanceof AbortSignal || (signalOrOptions && "aborted" in signalOrOptions)
      ? (signalOrOptions as AbortSignal)
      : signalOrOptions?.signal;
  const secrets = signalOrOptions instanceof AbortSignal || !signalOrOptions ? [] : (signalOrOptions.secrets ?? []);

  const customMapUsage = signalOrOptions instanceof AbortSignal || !signalOrOptions ? undefined : signalOrOptions.mapUsage;

  const blocks = new Map<number, PartialBlock>();
  let rawUsage: AnthropicUsage | undefined;
  let usage: Usage | undefined;
  let sawMessageStop = false;
  let stopReason: string | undefined;

  function mergeAnthropicUsage(delta?: AnthropicUsage): void {
    if (!delta) return;
    rawUsage = {
      input_tokens: delta.input_tokens ?? rawUsage?.input_tokens,
      output_tokens: delta.output_tokens ?? rawUsage?.output_tokens,
      cache_read_input_tokens: delta.cache_read_input_tokens ?? rawUsage?.cache_read_input_tokens,
      cache_creation_input_tokens: delta.cache_creation_input_tokens ?? rawUsage?.cache_creation_input_tokens,
    };
  }

  function resolveUsage(): Usage | undefined {
    if (!rawUsage) return undefined;
    return customMapUsage ? customMapUsage(rawUsage) : toUsage(rawUsage);
  }

  for await (const sseEvent of readSseEvents(body, { signal })) {
    if (sseEvent.event === "ping") continue;
    const data = sseEvent.data.trim();
    if (!data) continue;
    if (data === "[DONE]") break;

    let event: AnthropicEvent;
    try {
      event = JSON.parse(data) as AnthropicEvent;
    } catch (parseError) {
      yield providerError(
        new Error(`Malformed Anthropic SSE frame: ${parseError instanceof Error ? parseError.message : String(parseError)}`),
        secrets,
      );
      return;
    }

    if (event.type === "ping") continue;

    if (event.type === "error" || sseEvent.event === "error") {
      const vendorError = event.error ?? {};
      const code = vendorError.type ?? "api_error";
      const isTransient = code === "overloaded_error" || code === "api_error";
      const err = new Error(vendorError.message ?? "Provider API error");
      err.name = "ProviderError";
      (err as any).code = code;
      (err as any).failureClass = isTransient ? "transient" : "permanent";
      yield providerError(err, secrets);
      return;
    }

    if (event.type === "message_start") {
      mergeAnthropicUsage(event.message?.usage);
      usage = resolveUsage() ?? usage;
    }

    if (event.type === "message_stop") {
      sawMessageStop = true;
    }

    if (event.type === "message_delta" || event.type === "message.delta" || sseEvent.event === "message_delta") {
      if (event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
      mergeAnthropicUsage(event.usage);
      usage = resolveUsage() ?? usage;
      if (usage) {
        yield providerUsage(usage);
      }
    }

    if (event.type === "content_block_start") {
      const index = event.index ?? 0;
      const blockType = event.content_block?.type;
      if (blockType === "tool_use") {
        blocks.set(index, {
          type: "tool_use",
          id: event.content_block?.id,
          name: productToolName(event.content_block?.name ?? "", options?.toolNames),
          argumentsText: "",
        });
      } else if (blockType === "thinking") {
        blocks.set(index, {
          type: "thinking",
          argumentsText: "",
          signature: "",
        });
      } else if (blockType === "redacted_thinking") {
        const data = event.content_block?.data ?? "";
        blocks.set(index, {
          type: "redacted_thinking",
          argumentsText: "",
          data,
          complete: true,
        });
        yield providerContentDelta({ type: "thinking", text: "", redacted: true, data });
      }
    }

    if (event.type === "content_block_stop") {
      const current = blocks.get(event.index ?? 0);
      if (current) current.complete = true;
    }

    if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) {
        yield providerTextDelta(delta.text);
      }
      if (delta?.type === "thinking_delta" && delta.thinking) {
        yield providerThinkingDelta(delta.thinking);
      }
      if (delta?.type === "signature_delta" && delta.signature) {
        const current = blocks.get(event.index ?? 0);
        if (current) {
          current.signature = (current.signature ?? "") + delta.signature;
        }
        yield providerThinkingDelta("", delta.signature);
      }
      if (delta?.type === "input_json_delta") {
        const index = event.index ?? 0;
        const current = blocks.get(index) ?? { type: "tool_use", argumentsText: "" };
        current.argumentsText += delta.partial_json ?? "";
        blocks.set(index, current);
        yield providerToolCallDelta({ index, id: current.id, name: current.name, argumentsText: delta.partial_json });
      }
    }
  }

  const danglingBlock = [...blocks.values()].some((call) => call.type === "tool_use" && (!call.id || !call.name || !call.complete));
  if (!sawMessageStop || danglingBlock) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(
      new Error(
        `Anthropic messages stream ended without completion evidence ` +
          `(message_stop: ${sawMessageStop ? "received" : "missing"}, ` +
          `content blocks complete: ${danglingBlock ? "no" : "yes"})`,
      ),
      secrets,
    );
    return;
  }
  for (const call of blocks.values()) {
    if (call.type === "tool_use") {
      yield providerToolCall(toolCallFromArgumentsText(call.id!, productToolName(call.name!, options?.toolNames), call.argumentsText));
    }
  }
  yield providerDone(usage, stopReason === undefined ? undefined : mapProviderStopReason(stopReason));
}

async function toMessage(
  message: CacheControlledMessage,
  model: ModelConfig,
  preserveThinking: boolean,
  resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>,
  toolNames?: ToolNameMap,
): Promise<JsonObject> {
  const capabilities = model.capabilities ?? {};
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const last = message.content[message.content.length - 1];
    const marker = (last?.cache_control ?? undefined) as unknown as JsonObject | undefined;
    const text = serializeToolResultText(message);
    const images = message.content.filter((part): part is Extract<ContentBlock, { type: "image" }> => part.type === "image");
    // `tool_result.content` takes text and image blocks; a model without image input gets the note
    // in place of the images instead of a request the vendor rejects.
    const takesImages = !capabilities.input?.length || capabilities.input.includes("image");
    let content: string | JsonObject[] = text;
    if (images.length > 0 && !takesImages) {
      content = text ? `${text}\n${OMITTED_TOOL_RESULT_IMAGE_NOTE}` : OMITTED_TOOL_RESULT_IMAGE_NOTE;
    } else if (images.length > 0) {
      content = [
        ...(text ? [{ type: "text", text }] : []),
        ...images.map((part) => {
          const resolved = resolvedMedia.get(part)!;
          return { type: "image", source: { type: "base64", media_type: resolved.mediaType, data: bytesToBase64(resolved.bytes) } };
        }),
      ];
    }
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: result?.toolCallId ?? "",
          ...(result?.error ? { is_error: true } : {}),
          content,
          ...(marker && text ? { cache_control: marker } : {}),
        },
      ],
    };
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    const marker = (part.cache_control ?? undefined) as unknown as JsonObject | undefined;
    if (part.type === "text") {
      content.push(withMarker({ type: "text", text: part.text }, marker));
    } else if (part.type === "thinking") {
      if (part.redacted) {
        content.push(withMarker({ type: "redacted_thinking", data: part.data ?? "" }, marker));
      } else if (preserveThinking && part.signature) {
        content.push(withMarker({ type: "thinking", thinking: part.text, signature: part.signature }, marker));
      } else {
        content.push(withMarker({ type: "text", text: part.text }, marker));
      }
    } else if (part.type === "image") {
      const resolved = resolvedMedia.get(part)!;
      const source: JsonObject = { type: "base64", media_type: resolved.mediaType, data: bytesToBase64(resolved.bytes) };
      content.push(withMarker({ type: "image", source }, marker));
    } else if (part.type === "document") {
      content.push(withMarker(toAnthropicDocument(part, resolvedMedia), marker));
    } else if (part.type === "file") {
      content.push(withMarker(toAnthropicFile(part, resolvedMedia), marker));
    } else if (part.type === "audio") {
      rejectProviderMediaBlock(part, capabilities, model);
    } else if (part.type === "tool_call") {
      content.push(withMarker({ type: "tool_use", id: part.id, name: wireToolName(part.name, toolNames), input: part.arguments }, marker));
    } else if (part.type === "tool_result") {
      throw new Error("Anthropic route tool_result blocks must appear in role=tool messages");
    }
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
  };
}

function toAnthropicDocument(part: DocumentContent, resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>): JsonObject {
  const resolved = resolvedMedia.get(part)!;
  return serializePdfDocumentWireBlock({
    mediaType: resolved.mediaType,
    data: bytesToBase64(resolved.bytes),
    title: resolved.name,
  });
}

function toAnthropicFile(part: FileContent, resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>): JsonObject {
  const resolved = resolvedMedia.get(part)!;
  if (!isPdfMediaType(resolved.mediaType)) {
    throw new Error(`Anthropic route only maps PDF file blocks; got ${resolved.mediaType}`);
  }
  return serializePdfDocumentWireBlock({
    mediaType: resolved.mediaType,
    data: bytesToBase64(resolved.bytes),
    title: resolved.name,
  });
}

function withMarker(item: JsonObject, marker: JsonObject | undefined): JsonObject {
  if (!marker) return item;
  if (item.type === "text" && (!item.text || typeof item.text !== "string" || !item.text.trim())) {
    return item;
  }
  if (item.type === "thinking" && (!item.thinking || typeof item.thinking !== "string" || !item.thinking.trim())) {
    return item;
  }
  if (item.type === "redacted_thinking" && (!item.data || typeof item.data !== "string" || !item.data.trim())) {
    return item;
  }
  return { ...item, cache_control: marker };
}

function toTool(tool: ToolDefinition, marker?: CacheControlValue, names?: ToolNameMap): JsonObject {
  return clean({
    name: wireToolName(tool.name, names),
    description: tool.description,
    input_schema: canonicalizeJsonSchema(tool.parameters ?? { type: "object" }) as JsonObject,
    ...(marker ? { cache_control: marker as unknown as JsonObject } : {}),
  });
}

function text(message: Message, preserveThinking = false): string {
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return preserveThinking && !part.redacted ? part.text : "";
      return "";
    })
    .join("");
}

function toUsage(usage: AnthropicUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  return normalizeUsage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    inputTokensInclusive: false,
  });
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

interface AnthropicEvent {
  readonly type?: string;
  readonly index?: number;
  readonly content_block?: {
    readonly type?: string;
    readonly id?: string;
    readonly name?: string;
    readonly data?: string;
  };
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly thinking?: string;
    readonly signature?: string;
    readonly partial_json?: string;
    readonly stop_reason?: string;
  };
  readonly message?: { readonly usage?: AnthropicUsage };
  readonly usage?: AnthropicUsage;
  readonly error?: {
    readonly type?: string;
    readonly message?: string;
  };
}

interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}
