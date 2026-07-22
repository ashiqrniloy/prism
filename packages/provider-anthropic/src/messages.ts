import type {
  CacheControlledMessage,
  ContentBlock,
  DocumentContent,
  FileContent,
  JsonObject,
  MediaContentBlock,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  ResolvedMediaContent,
  ToolDefinition,
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
  toolCallFromArgumentsText,
} from "@arnilo/prism";
import {
  bytesToBase64,
  isPdfMediaType,
  rejectProviderMediaBlock,
  resolveProviderMediaMessages,
  serializePdfDocumentWireBlock,
} from "@arnilo/prism/providers/media";
import { readSseData } from "@arnilo/prism/providers/transport";
import { applyAnthropicCacheControl } from "./cache.js";
import {
  anthropicEffort,
  anthropicPreserveThinking,
  anthropicThinking,
  stripAnthropicOwnedCompat,
} from "./thinking.js";

interface PartialBlock { id?: string; name?: string; argumentsText: string; complete?: boolean }

/** Serialize a Prism `ProviderRequest` to an Anthropic Messages body. */
export async function anthropicMessagesBody(request: ProviderRequest): Promise<JsonObject> {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const preserveThinking = anthropicPreserveThinking(request);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const messages = applyAnthropicCacheControl(request);
  const resolvedMedia = await resolveProviderMediaMessages(messages, request.model, { signal: request.signal });
  return clean({
    model: request.model.model,
    messages: await Promise.all(
      messages
        .filter((m) => m.role !== "system")
        .map((message) => toMessage(message, request.model, preserveThinking, resolvedMedia)),
    ),
    system: messages.filter((m) => m.role === "system").map((m) => text(m, preserveThinking)).join("\n\n") || undefined,
    tools: request.tools?.map(toTool),
    stream: true,
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens ?? 4096,
    ...stripAnthropicOwnedCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
    // Resolved official fields win over raw compat/extra escape hatches.
    thinking: anthropicThinking(request),
    effort: anthropicEffort(request),
  });
}

/** Map Anthropic Messages SSE events to Prism `ProviderEvent`s. */
export async function* anthropicMessagesEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const blocks = new Map<number, PartialBlock>();
  let usage: Usage | undefined;
  let sawMessageStop = false;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data) as AnthropicEvent;
    if (event.type === "message_stop") sawMessageStop = true;
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      blocks.set(event.index ?? 0, { id: event.content_block.id, name: event.content_block.name, argumentsText: "" });
    }
    if (event.type === "content_block_stop") {
      const current = blocks.get(event.index ?? 0);
      if (current) current.complete = true;
    }
    if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) yield providerTextDelta(delta.text);
      if (delta?.type === "thinking_delta" && delta.thinking) yield providerThinkingDelta(delta.thinking);
      if (delta?.type === "input_json_delta") {
        const index = event.index ?? 0;
        const current = blocks.get(index) ?? { argumentsText: "" };
        current.argumentsText += delta.partial_json ?? "";
        blocks.set(index, current);
        yield providerToolCallDelta({ index, id: current.id, name: current.name, argumentsText: delta.partial_json });
      }
    }
    usage = toUsage(event.message?.usage ?? event.usage) ?? usage;
    if (event.type === "message_delta" && usage) yield providerUsage(usage);
  }
  const danglingBlock = [...blocks.values()].some((call) => !call.id || !call.name || !call.complete);
  if (!sawMessageStop || danglingBlock) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(new Error(
      `Anthropic messages stream ended without completion evidence `
      + `(message_stop: ${sawMessageStop ? "received" : "missing"}, `
      + `content blocks complete: ${danglingBlock ? "no" : "yes"})`,
    ));
    return;
  }
  for (const call of blocks.values()) {
    yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
  }
  yield providerDone(usage);
}

async function toMessage(
  message: CacheControlledMessage,
  model: ModelConfig,
  preserveThinking: boolean,
  resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>,
): Promise<JsonObject> {
  const capabilities = model.capabilities ?? {};
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const last = message.content[message.content.length - 1];
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: result?.toolCallId ?? "",
        content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
        ...(last?.cache_control ? { cache_control: last.cache_control as unknown as JsonObject } : {}),
      }],
    };
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    const marker = (part.cache_control ?? undefined) as unknown as JsonObject | undefined;
    if (part.type === "text") {
      content.push(withMarker({ type: "text", text: part.text }, marker));
    } else if (part.type === "thinking") {
      if (preserveThinking) {
        content.push(withMarker(
          part.signature
            ? { type: "thinking", thinking: part.text, signature: part.signature }
            : { type: "thinking", thinking: part.text },
          marker,
        ));
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
      content.push(withMarker({ type: "tool_use", id: part.id, name: part.name, input: part.arguments }, marker));
    } else if (part.type === "tool_result") {
      throw new Error("Anthropic tool_result blocks must appear in role=tool messages");
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
    throw new Error(`Anthropic Messages only maps PDF file blocks; got ${resolved.mediaType}`);
  }
  return serializePdfDocumentWireBlock({
    mediaType: resolved.mediaType,
    data: bytesToBase64(resolved.bytes),
    title: resolved.name,
  });
}

function withMarker(item: JsonObject, marker: JsonObject | undefined): JsonObject {
  return marker ? { ...item, cache_control: marker } : item;
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ name: tool.name, description: tool.description, input_schema: tool.parameters ?? { type: "object" } });
}

function text(message: Message, preserveThinking = false): string {
  return message.content.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "thinking") return preserveThinking ? part.text : "";
    return "";
  }).join("");
}

function toUsage(usage: AnthropicUsage | undefined): Usage | undefined {
  return usage
    ? {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens,
    }
    : undefined;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

interface AnthropicEvent {
  readonly type?: string;
  readonly index?: number;
  readonly content_block?: { readonly type?: string; readonly id?: string; readonly name?: string };
  readonly delta?: { readonly type?: string; readonly text?: string; readonly thinking?: string; readonly partial_json?: string };
  readonly message?: { readonly usage?: AnthropicUsage };
  readonly usage?: AnthropicUsage;
}

interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}
