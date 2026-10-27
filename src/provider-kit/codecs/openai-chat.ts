import type {
  ContentBlock,
  JsonObject,
  JsonValue,
  Message,
  ModelCapabilities,
  ModelConfig,
  PromptCacheBreakpoint,
  ProviderEvent,
  ProviderRequest,
  StructuredOutputOptions,
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
import { type CacheControlValue, resolvePromptCachePlan } from "../cache-helpers.js";
import { assertStructuredOutputRequestSupported } from "../structured-output.js";
import { httpStatusError, ProviderTransportError, readSseEvents } from "../transport.js";
import {
  applyOpenAIChatStructuredOutput,
  assertOpenAIChatMessage,
  mapOpenAIChatUsage,
  serializeOpenAIChatStructuredOutput,
  serializeOpenAITool,
  OMITTED_TOOL_RESULT_IMAGE_NOTE,
  serializeToolResultText,
} from "../openai-primitives.js";
import {
  DEFAULT_OWNED_COMPAT_KEYS,
  preserveThinking,
  reasoningEffort,
  reasoningObject,
  resolvePreserveThinking,
  resolveReasoningEffort,
  resolveReasoningObject,
  resolveThinkingObject,
  stripOwnedCompat,
  thinkingObject,
} from "../thinking.js";

export {
  assertOpenAIChatMessage,
  serializeOpenAIChatStructuredOutput,
  applyOpenAIChatStructuredOutput,
  serializeOpenAITool,
  OMITTED_TOOL_RESULT_IMAGE_NOTE,
  serializeToolResultText,
  mapOpenAIChatUsage,
  DEFAULT_OWNED_COMPAT_KEYS,
  resolvePreserveThinking,
  preserveThinking,
  resolveReasoningEffort,
  reasoningEffort,
  resolveThinkingObject,
  thinkingObject,
  resolveReasoningObject,
  reasoningObject,
  stripOwnedCompat,
};

/** Codec options shaping OpenAI Chat Completions body serialization. */
export interface OpenAIChatCodecOptions {
  /**
   * How historical thinking blocks are replayed on the wire:
   * - "reasoning_content": emitted as top-level `reasoning_content` on assistant messages (needed for reasoning continuity on gateways)
   * - "reasoning_details": emitted as `assistant.reasoning_details` entries, unchanged and in order
   * - "fold": folded into `content` as text (default)
   * - "drop": dropped completely from the wire message
   */
  readonly reasoningReplay?: "reasoning_content" | "fold" | "drop" | "reasoning_details";

  /**
   * Anthropic-style `cache_control` blocks on the Chat wire (gateway pattern, pi's
   * `cacheControlFormat: "anthropic"`):
   * - "anthropic-blocks": stamp `{type: "ephemeral"}` at the `resolvePromptCachePlan` breakpoints
   *
   * Absent means no markers are emitted. Default breakpoints match pi's placement:
   * `system_prompt`, `tools`, `last_message`.
   */
  readonly cacheControl?: "anthropic-blocks";

  /** Mark the last tool definition too; only gateways that cache tool definitions accept it. */
  readonly cacheControlOnTools?: boolean;

  /**
   * How image input capability is enforced:
   * - "capability-gated": requires model capabilities to include "image" (default, fail closed)
   * - "always": forwards image blocks without checking model capability
   */
  readonly imageInput?: "capability-gated" | "always";

  /**
   * Wire field used for token ceilings:
   * - "max_tokens": Chat Completions standard (default)
   * - "max_completion_tokens": OpenAI o-series parameter
   */
  readonly maxTokensField?: "max_tokens" | "max_completion_tokens";

  /** Whether assistant thinking blocks are preserved on the wire. Defaults to `resolvePreserveThinking(request)`. */
  readonly preserveThinking?: (request: ProviderRequest) => boolean;

  /** Resolves `reasoning_effort` snapped to declared levels. Defaults to `resolveReasoningEffort(request)`. */
  readonly reasoningEffort?: (request: ProviderRequest) => string | undefined;

  /** Resolves `thinking` object (Kimi/GLM style). Defaults to `resolveThinkingObject(request)`. */
  readonly thinkingObject?: (request: ProviderRequest) => JsonObject | undefined;

  /** Resolves `reasoning` object (OpenAI o-series style). Defaults to `resolveReasoningObject(request)`. */
  readonly reasoningObject?: (request: ProviderRequest) => JsonObject | undefined;

  /** Strips provider-owned compat options before body merge. Defaults to `stripOwnedCompat()`. */
  readonly stripOwnedCompat?: (compat: JsonObject | undefined) => JsonObject | undefined;

  /** Transform messages before serialization (e.g. cache-control markers). Defaults to `request.messages`. */
  readonly mapMessages?: (request: ProviderRequest) => readonly Message[];

  /** Extra provider-specific body fields (merged over base body). */
  readonly buildBodyExtra?: (request: ProviderRequest) => JsonObject | undefined;

  /** Optional session/cache affinity headers injected for the route. */
  readonly affinity?: (request: ProviderRequest) => Record<string, string>;

  /** Final body transform applied last. */
  readonly transformBody?: (body: JsonObject, request: ProviderRequest) => JsonObject;

  /** Custom message serializer override. */
  readonly serializeMessage?: (message: Message, request: ProviderRequest) => JsonObject;

  /** Require `[DONE]` and `finish_reason` before emitting done. Default true. */
  readonly strictCompletion?: boolean;

  /** Emit final stream usage on done event. */
  readonly doneUsage?: boolean;

  /** Handle SSE comment lines (e.g. energy/cost telemetry). */
  readonly onComment?: (text: string) => ProviderEvent | undefined;
}

export interface OpenAIChatEventsOptions {
  readonly signal?: AbortSignal;
  /** Require `[DONE]` and a `finish_reason`; `done` then carries the final usage. Default `true` (fail-closed). */
  readonly strictCompletion?: boolean;
  /** Emit the final stream usage on the `done` event. */
  readonly doneUsage?: boolean;
  readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
  /** Handle an SSE comment line (text after `:`), e.g. `: energy` / `: cost` telemetry. */
  readonly onComment?: (text: string) => ProviderEvent | undefined;
  /** Secrets to redact from stream error messages. */
  readonly secrets?: readonly (string | undefined)[];
}

/**
 * Builds an OpenAI Chat Completions wire body according to provider-specific codec options.
 */
export function openAIChatBody(request: ProviderRequest, options: OpenAIChatCodecOptions = {}): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);

  const preserve = (options.preserveThinking ?? resolvePreserveThinking)(request);
  const reasoningReplay = options.reasoningReplay ?? "fold";
  const imageInput = options.imageInput ?? "capability-gated";
  const maxTokensField = options.maxTokensField ?? "max_tokens";

  const stripCompat = options.stripOwnedCompat ?? stripOwnedCompat();
  const strippedCompat = stripCompat(request.options?.compat);

  const resolvedThinking = (options.thinkingObject ?? resolveThinkingObject)(request);
  const resolvedEffort = (options.reasoningEffort ?? resolveReasoningEffort)(request);
  const resolvedReasoning = (options.reasoningObject ?? resolveReasoningObject)(request);

  const messages: JsonObject[] = [];
  const sourceMessages = options.mapMessages?.(request) ?? request.messages;
  const cachePlan = chatCachePlan(request, sourceMessages, options);
  /** Stamps the plan's `cache_control` marker on a serialized message's last non-empty text part. */
  const stampMessage = (message: JsonObject, index: number): JsonObject =>
    cachePlan.messageIndices.has(index) ? stampCacheControl(message, cachePlan.cacheControl) : message;

  // A `role: "tool"` message cannot carry an image, so images ride in one follow-up user message
  // placed after the whole round's tool replies (the vendor requires those to stay contiguous).
  const pendingImages: { readonly label: string; readonly parts: JsonObject[] }[] = [];
  const flushToolImages = () => {
    if (pendingImages.length === 0) return;
    messages.push({
      role: "user",
      content: pendingImages.flatMap((entry) => [{ type: "text", text: entry.label }, ...entry.parts]),
    });
    pendingImages.length = 0;
  };

  for (const [index, message] of sourceMessages.entries()) {
    if (message.role !== "tool") flushToolImages();
    if (options.serializeMessage) {
      messages.push(stampMessage(options.serializeMessage(message, request), index));
      continue;
    }
    assertOpenAIChatMessage(message, `messages[${index}]`);
    messages.push(
      stampMessage(
        serializeOpenAIChatMessageWithCodec(message, request.model, {
          preserveThinking: preserve,
          reasoningReplay,
          imageInput,
        }),
        index,
      ),
    );
    const images = toolResultImages(message, request.model, imageInput);
    if (images.length > 0) {
      const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
      pendingImages.push({ label: `Images returned by ${result?.name ?? "tool"} (${result?.toolCallId ?? ""}):`, parts: images });
    }
  }
  flushToolImages();

  const parameters = { ...(request.model.parameters ?? {}) };
  if (maxTokensField === "max_completion_tokens") {
    if (parameters.maxTokens !== undefined) {
      parameters.max_completion_tokens = parameters.maxTokens;
      delete parameters.maxTokens;
    }
    if (parameters.max_tokens !== undefined) {
      parameters.max_completion_tokens = parameters.max_tokens;
      delete parameters.max_tokens;
    }
  } else {
    // "max_tokens"
    if (parameters.maxTokens !== undefined) {
      if (parameters.max_tokens === undefined) {
        parameters.max_tokens = parameters.maxTokens;
      }
    }
    if (parameters.max_completion_tokens !== undefined) {
      if (parameters.max_tokens === undefined) {
        parameters.max_tokens = parameters.max_completion_tokens;
      }
      delete parameters.max_completion_tokens;
    }
  }

  const tools = request.tools?.map(serializeOpenAITool);
  if (cachePlan.markTools && options.cacheControlOnTools && tools?.length) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: cachePlan.cacheControl as unknown as JsonValue };
  }

  const body: Record<string, unknown> = {
    model: request.model.model,
    messages,
    tools,
    stream: true,
    stream_options: { include_usage: true },
    ...parameters,
    ...strippedCompat,
    // Resolved thinking / reasoning fields win over raw compat passthrough.
    ...(resolvedThinking !== undefined ? { thinking: resolvedThinking } : {}),
    ...(resolvedEffort !== undefined ? { reasoning_effort: resolvedEffort } : {}),
    ...(resolvedReasoning !== undefined ? { reasoning: resolvedReasoning } : {}),
    ...(request.options?.extra ?? {}),
    ...(options.buildBodyExtra?.(request) ?? {}),
  };

  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);

  const cleaned = cleanObject(body);
  const transformed = options.transformBody ? options.transformBody(cleaned, request) : cleaned;
  if ("maxTokens" in transformed) {
    const { maxTokens: _mt, ...rest } = transformed;
    return rest;
  }
  return transformed;
}

/** Base Chat Completions request body builder alias. */
export const buildOpenAIChatBody = openAIChatBody;

/**
 * Shared OpenAI Chat Completions message serializer supporting reasoning replay modes
 * and image input capability checks.
 */
export function serializeOpenAIChatMessage(
  message: Message,
  optionsOrCapabilities: OpenAIChatCodecOptions | ModelCapabilities = {},
  modelOrPreserve?: ModelConfig | boolean,
): JsonObject {
  // Support legacy signature: (message, capabilities)
  if (
    typeof modelOrPreserve !== "object" &&
    ("input" in optionsOrCapabilities || Object.keys(optionsOrCapabilities).every((k) => k === "input" || k === "output"))
  ) {
    const capabilities = optionsOrCapabilities as ModelCapabilities;
    const preserve = typeof modelOrPreserve === "boolean" ? modelOrPreserve : true;
    return serializeOpenAIChatMessageWithCodec(
      message,
      { provider: "openai", model: "model", capabilities },
      { preserveThinking: preserve, reasoningReplay: "fold", imageInput: "capability-gated" },
    );
  }

  const options = optionsOrCapabilities as OpenAIChatCodecOptions;
  const model = (typeof modelOrPreserve === "object" ? modelOrPreserve : undefined) ?? {
    provider: "openai",
    model: "model",
  };
  return serializeOpenAIChatMessageWithCodec(message, model, {
    preserveThinking: options.preserveThinking ? options.preserveThinking({ model, messages: [message] }) : true,
    reasoningReplay: options.reasoningReplay ?? "fold",
    imageInput: options.imageInput ?? "capability-gated",
  });
}

function acceptsImageInput(model: ModelConfig, imageInput: "capability-gated" | "always"): boolean {
  return imageInput === "always" || model.capabilities?.input?.includes("image") === true;
}

/** `image_url` parts for a tool message's image blocks; empty when the model takes no images. */
function toolResultImages(message: Message, model: ModelConfig, imageInput: "capability-gated" | "always"): JsonObject[] {
  if (message.role !== "tool" || !acceptsImageInput(model, imageInput)) return [];
  const parts: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type !== "image") continue;
    const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
    if (url) parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

function serializeOpenAIChatMessageWithCodec(
  message: Message,
  model: ModelConfig,
  codecOpts: {
    readonly preserveThinking: boolean;
    readonly reasoningReplay: "reasoning_content" | "fold" | "drop" | "reasoning_details";
    readonly imageInput: "capability-gated" | "always";
  },
): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const text = serializeToolResultText(message);
    const omitted = message.content.some((part) => part.type === "image") && !acceptsImageInput(model, codecOpts.imageInput);
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: omitted ? (text ? `${text}\n${OMITTED_TOOL_RESULT_IMAGE_NOTE}` : OMITTED_TOOL_RESULT_IMAGE_NOTE) : text,
    };
  }

  const thinkingParts = message.content.filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking");
  const reasoningContent =
    codecOpts.reasoningReplay === "reasoning_content" && codecOpts.preserveThinking && thinkingParts.length > 0
      ? thinkingParts.map((part) => part.text).join("")
      : undefined;
  const reasoningDetails =
    codecOpts.reasoningReplay === "reasoning_details" && codecOpts.preserveThinking ? replayReasoningDetails(thinkingParts) : undefined;

  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part): part is Extract<ContentBlock, { type: "text" | "thinking" }> => {
      if (part.type === "text") return true;
      if (part.type === "thinking") return codecOpts.reasoningReplay === "fold" && codecOpts.preserveThinking;
      return false;
    });

    if (toolCalls.length > 0) {
      return cleanObject({
        role: "assistant",
        content: textParts.map((part) => part.text).join("") || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
        reasoning_content: reasoningContent,
        reasoning_details: reasoningDetails,
      });
    }
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "thinking") {
      if (codecOpts.reasoningReplay === "fold" && codecOpts.preserveThinking) {
        content.push({ type: "text", text: part.text });
      }
      // "reasoning_content" is placed in reasoning_content field; "drop" ignores thinking.
    } else if (part.type === "image") {
      if (codecOpts.imageInput === "capability-gated" && !model.capabilities?.input?.includes("image")) {
        throw new Error(`Provider ${message.role} message includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Provider image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`OpenAI Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call") {
      throw new Error("Provider assistant tool_call blocks must be serialized with other assistant content");
    } else if (part.type === "tool_result") {
      throw new Error("Provider tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]?.type === "text") {
    return cleanObject({
      role: message.role,
      content: content[0]!.text,
      reasoning_content: reasoningContent,
      reasoning_details: reasoningDetails,
    });
  }

  return cleanObject({
    role: message.role,
    content: content.length > 0 ? content : reasoningContent ? null : "",
    reasoning_content: reasoningContent,
    reasoning_details: reasoningDetails,
  });
}

/**
 * Shared OpenAI Chat Completions SSE stream loop: maps `data:` frames to Prism
 * `ProviderEvent` values (text/thinking deltas, tool-call fragments, usage, done/error).
 */
export async function* openAIChatEvents(
  body: ReadableStream<Uint8Array>,
  options: OpenAIChatEventsOptions = {},
): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  let sawDoneMarker = false;
  let sawFinishReason = false;
  let finishReason: string | undefined;
  const secrets = options.secrets ?? [];
  const reasoningDetails: ReasoningDetail[] = [];
  let sawReasoningDetails = false;

  for await (const sseEvent of readSseEvents(body, { signal: options.signal })) {
    if (options.onComment && sseEvent.comments?.length) {
      for (const text of sseEvent.comments) {
        const commentEvent = options.onComment(text);
        if (commentEvent) yield commentEvent;
      }
    }
    const data = sseEvent.data.trim();
    if (!data) continue;
    if (data === "[DONE]") {
      sawDoneMarker = true;
      break;
    }
    let parsed: OpenAIStreamChunk;
    try {
      parsed = JSON.parse(data) as OpenAIStreamChunk;
    } catch (error) {
      // Malformed chunks are terminal: yield the error instead of crashing the generator.
      yield providerError(error, secrets);
      return;
    }
    const mapped = (options.mapUsage ?? mapOpenAIChatUsage)(parsed.usage, parsed as unknown as JsonObject);
    if (mapped) {
      usage = mapped;
      yield providerUsage(mapped);
    }

    // A top-level error frame (gateways answer 200 + an error body) is terminal: the run must fail,
    // never report a partial answer as done.
    if (parsed.error) {
      yield streamErrorEvent(parsed.error, secrets);
      return;
    }

    for (const choice of parsed.choices ?? []) {
      if (choice.finish_reason === "error") {
        yield streamErrorEvent(undefined, secrets);
        return;
      }
      if (choice.finish_reason) {
        sawFinishReason = true;
        finishReason = choice.finish_reason;
      }
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) yield providerTextDelta(delta.content);
      // Details arrive first: when a gateway sends both, the entries own the thinking text, so
      // `delta.reasoning` never duplicates it.
      let sawDetails = false;
      for (const detail of delta.reasoning_details ?? []) {
        if (!isReasoningDetail(detail)) continue;
        sawDetails = true;
        sawReasoningDetails = true;
        mergeReasoningDetail(reasoningDetails, detail);
      }
      const thinking = delta.reasoning ?? delta.reasoning_content;
      if (!sawDetails && !sawReasoningDetails && typeof thinking === "string" && thinking) {
        yield providerThinkingDelta(thinking);
      }
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

  const incomplete = [...tools.entries()].find(([, call]) => !call.id || !call.name);
  if (incomplete) {
    yield providerError(new ProviderTransportError("incomplete_delta", `Incomplete tool call delta at index ${incomplete[0]}`), secrets);
    return;
  }
  if ((options.strictCompletion ?? true) && (!sawDoneMarker || !sawFinishReason)) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(
      new Error(
        `Chat stream ended without completion evidence ` +
          `([DONE]: ${sawDoneMarker ? "received" : "missing"}, ` +
          `finish_reason: ${sawFinishReason ? "received" : "missing"})`,
      ),
      secrets,
    );
    return;
  }
  // Each merged entry becomes one discrete thinking block; `data` carries its replay JSON and
  // `signature` the ordered list, which survives session coalescing of adjacent blocks.
  const detailList = reasoningDetails.map((entry) => entry as unknown as JsonValue);
  for (const entry of reasoningDetails) {
    const type = entry.type;
    yield providerContentDelta({
      type: "thinking",
      text: type === "reasoning.summary" ? (entry.summary ?? "") : type === "reasoning.text" ? (entry.text ?? "") : "",
      ...(type === "reasoning.encrypted" ? { redacted: true } : {}),
      data: JSON.stringify(entry),
      signature: JSON.stringify(detailList),
    });
  }
  for (const call of tools.values()) {
    yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
  }
  yield providerDone(
    (options.strictCompletion ?? true) || options.doneUsage ? usage : undefined,
    finishReason === undefined ? undefined : mapProviderStopReason(finishReason),
  );
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

interface OpenAIStreamChunk {
  readonly error?: JsonObject;
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      /** Newer alias of `reasoning_content` used by some gateways. */
      readonly reasoning?: string;
      /** Gateway replay data: logical entries streamed as deltas. */
      readonly reasoning_details?: readonly unknown[];
      readonly tool_calls?: readonly {
        readonly index?: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
  }[];
  readonly usage?: unknown;
}

interface ReasoningDetail {
  type?: string;
  text?: string;
  summary?: string;
  data?: string;
  signature?: string;
  id?: string;
  index?: number;
  format?: string;
}

/** pi's entry validation: a malformed entry is skipped rather than replayed as garbage. */
function isReasoningDetail(value: unknown): value is ReasoningDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const detail = value as ReasoningDetail;
  if (detail.index !== undefined && typeof detail.index !== "number") return false;
  if (detail.id !== undefined && typeof detail.id !== "string") return false;
  if (detail.format !== undefined && typeof detail.format !== "string") return false;
  switch (detail.type) {
    case "reasoning.summary":
      return typeof detail.summary === "string";
    case "reasoning.encrypted":
      return typeof detail.data === "string";
    case "reasoning.text":
      return typeof detail.text === "string" && (detail.signature === undefined || typeof detail.signature === "string");
    default:
      return false;
  }
}

/** Consecutive text/summary deltas merge into one logical entry; encrypted entries stay discrete. */
function mergeReasoningDetail(details: ReasoningDetail[], detail: ReasoningDetail): void {
  const last = details[details.length - 1];
  if (detail.type === "reasoning.text" && last?.type === "reasoning.text") {
    last.text = `${last.text ?? ""}${detail.text ?? ""}`;
    last.signature ||= detail.signature;
    fillDetailFields(last, detail);
    return;
  }
  if (detail.type === "reasoning.summary" && last?.type === "reasoning.summary") {
    last.summary = `${last.summary ?? ""}${detail.summary ?? ""}`;
    fillDetailFields(last, detail);
    return;
  }
  details.push({ ...detail });
}

function fillDetailFields(target: ReasoningDetail, source: ReasoningDetail): void {
  target.id ??= source.id;
  target.format ||= source.format;
  target.index ??= source.index;
}

/** Replays stored entries in order; falls back to the coalesced block's `signature` list. */
function replayReasoningDetails(parts: readonly Extract<ContentBlock, { type: "thinking" }>[]): JsonObject[] | undefined {
  const details: JsonObject[] = [];
  for (const part of parts) {
    const parsed = part.data ? parseJson(part.data) : undefined;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details.push(parsed as JsonObject);
  }
  if (details.length > 0) return details;
  for (let index = parts.length - 1; index >= 0; index--) {
    const signature = parts[index]?.signature;
    const parsed = signature ? parseJson(signature) : undefined;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The Chat wire's 200-with-error-body frame: status `code`, redacted `metadata.error_type` and
 * message, and the classification both the retry policy and plan 194's overflow recovery read.
 */
function streamErrorEvent(error: JsonObject | undefined, secrets: readonly (string | undefined)[]): ProviderEvent {
  const metadata = (error?.metadata ?? {}) as JsonObject;
  const rawCode = error?.code;
  const status =
    typeof rawCode === "number" ? rawCode : typeof rawCode === "string" && /^\d{3}$/.test(rawCode) ? Number(rawCode) : undefined;
  const errorType = typeof metadata.error_type === "string" ? metadata.error_type : undefined;
  const detail = typeof error?.message === "string" ? error.message : "stream reported a terminal error";
  const failure = new Error(errorType ? `${errorType}: ${detail}` : detail) as Error & { code?: number };
  if (status !== undefined) failure.code = status;
  return providerError(failure, secrets);
}

/** pi's Chat-wire placement for Anthropic-style markers, used when the request names none. */
const DEFAULT_CHAT_CACHE_BREAKPOINTS: readonly PromptCacheBreakpoint[] = [
  { location: "system_prompt" },
  { location: "tools" },
  { location: "last_message" },
];

function chatCachePlan(
  request: ProviderRequest,
  messages: readonly Message[],
  options: OpenAIChatCodecOptions,
): { readonly messageIndices: ReadonlySet<number>; readonly markTools: boolean; readonly cacheControl: CacheControlValue } {
  const disabled: { messageIndices: ReadonlySet<number>; markTools: boolean; cacheControl: CacheControlValue } = {
    messageIndices: new Set<number>(),
    markTools: false,
    cacheControl: { type: "ephemeral" },
  };
  if (options.cacheControl !== "anthropic-blocks") return disabled;
  const retention = request.options?.cacheRetention ?? request.options?.cache?.retention;
  if (retention === "none" || request.model.cache?.kind === "none") return disabled;
  const ttl = retention === "long" && request.model.cache?.longRetention !== false ? "1h" : undefined;
  return resolvePromptCachePlan(messages, request.options?.cache?.breakpoints ?? DEFAULT_CHAT_CACHE_BREAKPOINTS, {
    ...(ttl ? { ttl } : {}),
    maxBreakpoints: request.model.cache?.maxBreakpoints ?? 4,
    hasTools: Boolean(request.tools?.length),
  });
}

/** Stamps a marker on the message's last non-empty text part, turning a string `content` into one part. */
function stampCacheControl(message: JsonObject, cacheControl: CacheControlValue): JsonObject {
  const content = message.content;
  if (typeof content === "string") {
    return content.trim()
      ? { ...message, content: [{ type: "text", text: content, cache_control: cacheControl as unknown as JsonValue }] }
      : message;
  }
  if (!Array.isArray(content)) return message;
  const parts = [...content];
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index] as JsonObject;
    if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
      parts[index] = { ...part, cache_control: cacheControl as unknown as JsonValue };
      return { ...message, content: parts };
    }
  }
  return message;
}

function cleanObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
