import type {
  ContentBlock,
  JsonObject,
  Message,
  ModelCapabilities,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  StructuredOutputOptions,
  ToolDefinition,
  Usage,
} from "../../contracts.js";
import {
  mapProviderStopReason,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallFromArgumentsText,
} from "../../models/events.js";
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
   * - "fold": folded into `content` as text (default)
   * - "drop": dropped completely from the wire message
   */
  readonly reasoningReplay?: "reasoning_content" | "fold" | "drop";

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
  readonly mapUsage?: (usage: unknown) => Usage | undefined;
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

  for (const [index, message] of (options.mapMessages?.(request) ?? request.messages).entries()) {
    if (message.role !== "tool") flushToolImages();
    if (options.serializeMessage) {
      messages.push(options.serializeMessage(message, request));
      continue;
    }
    assertOpenAIChatMessage(message, `messages[${index}]`);
    messages.push(
      serializeOpenAIChatMessageWithCodec(message, request.model, {
        preserveThinking: preserve,
        reasoningReplay,
        imageInput,
      }),
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

  const body: Record<string, unknown> = {
    model: request.model.model,
    messages,
    tools: request.tools?.map(serializeOpenAITool),
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
    readonly reasoningReplay: "reasoning_content" | "fold" | "drop";
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
    });
  }

  return cleanObject({
    role: message.role,
    content: content.length > 0 ? content : reasoningContent ? null : "",
    reasoning_content: reasoningContent,
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
    const mapped = (options.mapUsage ?? mapOpenAIChatUsage)(parsed.usage);
    if (mapped) {
      usage = mapped;
      yield providerUsage(mapped);
    }

    for (const choice of parsed.choices ?? []) {
      if (choice.finish_reason) {
        sawFinishReason = true;
        finishReason = choice.finish_reason;
      }
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) yield providerTextDelta(delta.content);
      const thinking = delta.reasoning ?? delta.reasoning_content;
      if (typeof thinking === "string" && thinking) {
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
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      /** Newer alias of `reasoning_content` used by some gateways. */
      readonly reasoning?: string;
      readonly tool_calls?: readonly {
        readonly index?: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
  }[];
  readonly usage?: unknown;
}

function cleanObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
