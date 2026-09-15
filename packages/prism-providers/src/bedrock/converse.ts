import type {
  CacheControlledContentBlock,
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
  applyCacheControl,
  assertStructuredOutputRequestSupported,
  canonicalizeJsonSchema,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  snapThinkingLevel,
  toolCallContent,
  toolCallFromArgumentsText,
} from "@arnilo/prism";
import { bytesToBase64, isPdfMediaType, rejectProviderMediaBlock, resolveProviderMediaMessages } from "@arnilo/prism/providers/media";
import { serializeToolResultJson } from "@arnilo/prism/providers/openai";
import { declaredThinkingLevelsFor } from "../shared/openai-compat.js";
import { eventStreamHeader, readAwsEventStream } from "./eventstream.js";

/** Default `budget_tokens` when a host enables Anthropic-family thinking without a budget. */
export const BEDROCK_THINKING_DEFAULT_BUDGET = 10_000;

const IMAGE_FORMATS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const DOCUMENT_FORMATS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/plain": "txt",
  "text/markdown": "md",
};

function isAnthropicFamily(modelId: string): boolean {
  return /anthropic|claude/.test(modelId.toLowerCase());
}

function imageFormat(mediaType: string): string {
  const format = IMAGE_FORMATS[mediaType.toLowerCase()];
  if (!format) throw new Error(`Bedrock Converse does not accept image media type ${mediaType}`);
  return format;
}

function documentFormat(mediaType: string): string {
  const format = DOCUMENT_FORMATS[mediaType.toLowerCase()];
  if (!format) throw new Error(`Bedrock Converse does not accept document media type ${mediaType}`);
  return format;
}

/** Converse `cachePoint` markers follow the same Prism breakpoints as cache-control providers. */
function bedrockCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

function cachePoint(request: ProviderRequest, marker: CacheControlledContentBlock | undefined): JsonObject {
  const ttl = marker?.cache_control?.ttl === "1h" && request.model.cache?.longRetention !== false ? "1h" : undefined;
  return { cachePoint: { type: "default", ...(ttl ? { ttl } : {}) } };
}

function cacheControlledMessages(request: ProviderRequest): readonly CacheControlledMessage[] {
  if (!bedrockCacheEnabled(request)) return request.messages as readonly CacheControlledMessage[];
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages as readonly CacheControlledMessage[];
  return applyCacheControl(request.messages, breakpoints, {
    ttl: request.options?.cacheRetention === "long" || request.options?.cache?.retention === "long" ? "1h" : undefined,
    maxBreakpoints: request.model.cache?.maxBreakpoints,
  });
}

/** Serialize a Prism `ProviderRequest` to a Bedrock `Converse`/`ConverseStream` body. */
export async function bedrockConverseBody(request: ProviderRequest): Promise<JsonObject> {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const messageBlocks = bedrockReasoningBlocks(request);
  const messages = cacheControlledMessages(request);
  const preserveThinking = bedrockPreserveThinking(request);
  const resolvedMedia = await resolveProviderMediaMessages(messages, request.model, { signal: request.signal });
  const { maxTokens, temperature, topP, stopSequences, ...modelParameters } = request.model.parameters ?? {};
  const structured = request.options?.structuredOutput;
  const additionalFields = clean({
    ...modelParameters,
    ...(messageBlocks.thinking ? { thinking: messageBlocks.thinking } : {}),
    ...(messageBlocks.reasoningEffort ? { reasoning_effort: messageBlocks.reasoningEffort } : {}),
    ...asJsonObject(request.options?.extra?.additionalModelRequestFields),
  });

  return clean({
    messages: await Promise.all(
      messages
        .filter((message) => message.role !== "system")
        .map((message) => toConverseMessage(message, request.model, preserveThinking, resolvedMedia, request)),
    ),
    system: systemBlocks(messages, preserveThinking, request),
    inferenceConfig: clean({
      maxTokens: maxTokens ?? request.model.limits?.maxOutputTokens,
      temperature,
      topP,
      stopSequences,
    }),
    toolConfig:
      request.tools && request.tools.length > 0
        ? clean({ tools: request.tools.map(toToolSpec), toolChoice: bedrockToolChoice(request) })
        : undefined,
    outputConfig: structured
      ? {
          textFormat: {
            type: "json_schema",
            structure: {
              jsonSchema: {
                schema: JSON.stringify(canonicalizeJsonSchema(structured.schema)),
                name: structured.name,
              },
            },
          },
        }
      : undefined,
    additionalModelRequestFields: Object.keys(additionalFields).length > 0 ? additionalFields : undefined,
  });
}

function systemBlocks(
  messages: readonly CacheControlledMessage[],
  preserveThinking: boolean,
  request: ProviderRequest,
): readonly JsonObject[] | undefined {
  const system = messages.filter((message) => message.role === "system");
  if (!system.length) return undefined;
  const blocks: JsonObject[] = [];
  for (const message of system) {
    blocks.push({ text: text(message, preserveThinking) });
    const marker = lastMarker(message);
    if (marker) blocks.push(cachePoint(request, marker));
  }
  return blocks;
}

async function toConverseMessage(
  message: CacheControlledMessage,
  model: ModelConfig,
  preserveThinking: boolean,
  resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>,
  request: ProviderRequest,
): Promise<JsonObject> {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const marker = lastMarker(message);
    return {
      role: "user",
      content: [
        {
          toolResult: {
            toolUseId: result?.toolCallId ?? "",
            content: [{ text: serializeToolResultJson(message) }],
            ...(result?.error ? { status: "error" } : {}),
          },
        },
        ...(marker ? [cachePoint(request, marker)] : []),
      ],
    };
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ text: part.text });
    } else if (part.type === "thinking") {
      content.push(preserveThinking ? { reasoningContent: { reasoningText: thinkingText(part) } } : { text: part.text });
    } else if (part.type === "image") {
      const resolved = resolvedMedia.get(part)!;
      content.push({ image: { format: imageFormat(resolved.mediaType), source: { bytes: bytesToBase64(resolved.bytes) } } });
    } else if (part.type === "document" || part.type === "file") {
      content.push(toDocument(part, resolvedMedia));
    } else if (part.type === "audio" || part.type === "video") {
      rejectProviderMediaBlock(part, model.capabilities ?? {}, model);
    } else if (part.type === "tool_call") {
      content.push({ toolUse: { toolUseId: part.id, name: part.name, input: part.arguments } });
    } else if (part.type === "tool_result") {
      throw new Error("Bedrock Converse tool results must appear in role=tool messages");
    }
  }

  const marker = lastMarker(message);
  if (marker) content.push(cachePoint(request, marker));
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: content.length > 0 ? content : [{ text: "" }],
  };
}

function thinkingText(part: Extract<ContentBlock, { type: "thinking" }>): JsonObject {
  return part.signature ? { text: part.text, signature: part.signature } : { text: part.text };
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function toDocument(part: DocumentContent | FileContent, resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>): JsonObject {
  const resolved = resolvedMedia.get(part)!;
  if (!isPdfMediaType(resolved.mediaType)) {
    throw new Error(`Bedrock Converse only maps PDF file/document blocks; got ${resolved.mediaType}`);
  }
  return {
    document: {
      format: documentFormat(resolved.mediaType),
      name: resolved.name ?? "document.pdf",
      source: { bytes: bytesToBase64(resolved.bytes) },
    },
  };
}

function toToolSpec(tool: ToolDefinition): JsonObject {
  return {
    toolSpec: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: { json: canonicalizeJsonSchema(tool.parameters ?? { type: "object" }) as JsonObject },
    },
  };
}

/** `toolChoice` is only forwarded from the sanitized `compat` allow-list (no opaque leak). */
function bedrockToolChoice(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.toolChoice ?? request.model.compat?.toolChoice;
  if (value === undefined) return undefined;
  if (value === "auto" || value === "any" || value === "required") return value === "required" ? { any: {} } : { [value]: {} };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tool = (value as JsonObject).tool;
    if (tool && typeof tool === "object" && typeof (tool as JsonObject).name === "string") {
      return { tool: { name: (tool as JsonObject).name } };
    }
  }
  throw new Error(`Bedrock Converse toolChoice must be "auto", "any", "required", or { tool: { name } }; got ${JSON.stringify(value)}`);
}

/** Native thinking/effort fields; refuses to emit them for a model that denies reasoning. */
export function bedrockReasoningBlocks(request: ProviderRequest): { thinking?: JsonObject; reasoningEffort?: string } {
  const compat = request.options?.compat;
  const modelCompat = request.model.compat;
  const rawThinking = compat?.thinking ?? modelCompat?.thinking;
  const rawEffort =
    compat?.reasoning_effort ?? compat?.effort ?? compat?.reasoningEffort ?? modelCompat?.reasoning_effort ?? modelCompat?.effort;
  const requested = rawThinking !== undefined || rawEffort !== undefined;
  if (requested && request.model.capabilities?.reasoning === false) {
    throw new Error(`Model ${request.model.provider}/${request.model.model} declares reasoning: false; refusing thinking/effort request`);
  }
  if (rawThinking === undefined && rawEffort === undefined) return {};
  if (isAnthropicFamily(request.model.model)) {
    if (rawThinking === undefined && typeof rawEffort === "string") {
      // Effort on an Anthropic-family model is an adaptive-thinking depth, which the
      // Converse route only accepts as an explicit model field. Without a documented
      // Converse field for it, fall back to enabling thinking with the default budget.
      return { thinking: { type: "enabled", budget_tokens: BEDROCK_THINKING_DEFAULT_BUDGET } };
    }
    return { thinking: anthropicThinkingValue(rawThinking) };
  }
  const effort = typeof rawEffort === "string" ? snapEffort(request, rawEffort) : undefined;
  return effort ? { reasoningEffort: effort } : {};
}

function anthropicThinkingValue(value: unknown): JsonObject {
  if (value === false) return { type: "disabled" };
  if (value === true) return { type: "enabled", budget_tokens: BEDROCK_THINKING_DEFAULT_BUDGET };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const thinking = value as JsonObject;
    const type = thinking.type;
    if (type !== "enabled" && type !== "disabled" && type !== "adaptive") {
      throw new Error(`Bedrock Converse thinking.type must be "enabled", "disabled", or "adaptive"; got ${JSON.stringify(type)}`);
    }
    if (type === "enabled") {
      const budget = thinking.budget_tokens;
      if (budget !== undefined && (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0)) {
        throw new Error("Bedrock Converse thinking.budget_tokens must be a positive number");
      }
      return budget === undefined ? { type, budget_tokens: BEDROCK_THINKING_DEFAULT_BUDGET } : { type, budget_tokens: budget };
    }
    return { type };
  }
  throw new Error(`Bedrock Converse thinking must be a boolean or object; got ${JSON.stringify(value)}`);
}

function snapEffort(request: ProviderRequest, value: string): string | undefined {
  const declared = request.model.capabilities?.thinkingLevels ?? declaredThinkingLevelsFor(request);
  if (!declared || declared.length === 0) return value;
  return String(
    snapThinkingLevel(
      {
        provider: request.model.provider,
        compat: request.model.compat,
        capabilities: { ...request.model.capabilities, thinkingLevels: declared },
      },
      value,
    ),
  );
}

/** Whether historical thinking blocks are replayed (signatures preserved). */
export function bedrockPreserveThinking(request: ProviderRequest): boolean {
  const value =
    request.options?.compat?.preserveThinking ?? request.options?.compat?.preserve_thinking ?? request.model.compat?.preserveThinking;
  if (value === false) return false;
  if (value === true) return true;
  return request.model.capabilities?.reasoning === true;
}

function lastMarker(message: CacheControlledMessage): CacheControlledContentBlock | undefined {
  const last = message.content[message.content.length - 1] as CacheControlledContentBlock | undefined;
  return last?.cache_control ? last : undefined;
}

function text(message: Message, preserveThinking: boolean): string {
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return preserveThinking ? part.text : "";
      return "";
    })
    .join("");
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

interface ConverseUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
}

interface ConverseContentBlock {
  readonly text?: string;
  readonly reasoningContent?: { readonly reasoningText?: { readonly text?: string; readonly signature?: string } };
  readonly toolUse?: { readonly toolUseId?: string; readonly name?: string; readonly input?: unknown };
}

function toUsage(usage: ConverseUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  return clean({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheWriteTokens: usage.cacheWriteInputTokens,
  }) as Usage;
}

/** Map a non-streaming `Converse` response to Prism events. */
export function bedrockConverseResponseEvents(response: unknown): readonly ProviderEvent[] {
  const body = response as {
    readonly output?: { readonly message?: { readonly content?: readonly ConverseContentBlock[] } };
    readonly usage?: ConverseUsage;
  };
  const usage = toUsage(body.usage);
  const events: ProviderEvent[] = [];
  for (const block of body.output?.message?.content ?? []) {
    if (typeof block.text === "string" && block.text.length > 0) events.push(providerTextDelta(block.text));
    const reasoning = block.reasoningContent?.reasoningText;
    if (reasoning?.text) events.push(providerThinkingDelta(reasoning.text, reasoning.signature));
    if (block.toolUse?.name) {
      events.push(
        providerToolCall(toolCallContent(block.toolUse.toolUseId ?? "", block.toolUse.name, (block.toolUse.input ?? {}) as JsonObject)),
      );
    }
  }
  if (usage) events.push(providerUsage(usage));
  events.push(providerDone(usage));
  return events;
}

interface PartialBlock {
  id?: string;
  name?: string;
  argumentsText: string;
  complete?: boolean;
}

/** Map a Bedrock `ConverseStream` event stream to Prism `ProviderEvent`s. */
export async function* bedrockConverseStreamEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const blocks = new Map<number, PartialBlock>();
  let usage: Usage | undefined;
  let sawMessageStop = false;

  for await (const message of readAwsEventStream(body, { signal })) {
    const messageType = eventStreamHeader(message, ":message-type");
    const payload = parseFramePayload(message.payload);
    if (messageType === "exception" || messageType === "error") {
      const name = eventStreamHeader(message, ":exception-type") ?? eventStreamHeader(message, ":error-code") ?? "BedrockStreamException";
      const detail =
        payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as JsonObject).message === "string"
          ? String((payload as JsonObject).message)
          : "";
      yield providerError(new Error(`${name}${detail ? `: ${detail}` : ""}`));
      return;
    }
    const eventType = eventStreamHeader(message, ":event-type");
    const view = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as ConverseStreamEvent) : undefined;
    if (!view) {
      yield providerError(new Error(`Bedrock Converse stream frame (${eventType ?? "unknown"}) was not a JSON object`));
      return;
    }

    if (eventType === "contentBlockStart" && view.start?.toolUse) {
      const index = view.contentBlockIndex ?? 0;
      blocks.set(index, { id: view.start.toolUse.toolUseId, name: view.start.toolUse.name, argumentsText: "" });
    }
    if (eventType === "contentBlockDelta") {
      const delta = view.delta;
      const index = view.contentBlockIndex ?? 0;
      if (typeof delta?.text === "string" && delta.text.length > 0) yield providerTextDelta(delta.text);
      if (delta?.reasoningContent?.text) yield providerThinkingDelta(delta.reasoningContent.text);
      if (delta?.reasoningContent?.signature) yield providerThinkingDelta("", delta.reasoningContent.signature);
      if (typeof delta?.toolUse?.input === "string") {
        const current = blocks.get(index) ?? { argumentsText: "" };
        current.argumentsText += delta.toolUse.input;
        blocks.set(index, current);
        yield providerToolCallDelta({ index, id: current.id, name: current.name, argumentsText: delta.toolUse.input });
      }
    }
    if (eventType === "contentBlockStop") {
      const current = blocks.get(view.contentBlockIndex ?? 0);
      if (current) current.complete = true;
    }
    if (eventType === "messageStop") sawMessageStop = true;
    // The metadata event payload IS the `ConverseStreamMetadataEvent` shape (Smithy event
    // streams serialize the union member's target); also tolerate a `{ metadata: ... }` wrapper.
    usage = toUsage(view.usage ?? view.metadata?.usage) ?? usage;
    if (usage && eventType === "metadata") yield providerUsage(usage);
  }

  const danglingBlock = [...blocks.values()].some((call) => !call.id || !call.name || !call.complete);
  if (!sawMessageStop || danglingBlock) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(
      new Error(
        `Bedrock Converse stream ended without completion evidence ` +
          `(messageStop: ${sawMessageStop ? "received" : "missing"}, content blocks complete: ${danglingBlock ? "no" : "yes"})`,
      ),
    );
    return;
  }
  for (const call of blocks.values()) {
    yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
  }
  yield providerDone(usage);
}

function parseFramePayload(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as unknown;
  } catch {
    return undefined;
  }
}

interface ConverseStreamEvent {
  readonly contentBlockIndex?: number;
  readonly start?: { readonly toolUse?: { readonly toolUseId?: string; readonly name?: string } };
  readonly delta?: {
    readonly text?: string;
    readonly reasoningContent?: { readonly text?: string; readonly signature?: string };
    readonly toolUse?: { readonly input?: string };
  };
  /** `metadata` event members; `metadata` is accepted for wrapped payloads. */
  readonly usage?: ConverseUsage;
  readonly metadata?: { readonly usage?: ConverseUsage };
}
