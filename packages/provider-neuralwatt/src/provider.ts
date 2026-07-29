import type {
  AIProvider,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  Usage,
} from "@arnilo/prism";
import { rejectProviderMediaBlock } from "@arnilo/prism/providers/media";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { classifyNeuralWattError, neuralWattHttpError } from "./retry.js";
import { type NeuralWattEvent, parseNeuralWattComment } from "./telemetry.js";
import {
  neuralWattChatTemplateKwargs,
  neuralWattClearThinking,
  neuralWattPreserveThinking,
  neuralWattReasoningEffort,
  neuralWattThinkingTokenBudget,
  neuralWattToolChoice,
  stripNeuralWattOwnedCompat,
} from "./thinking.js";

export interface NeuralWattProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createNeuralWattProvider(options: NeuralWattProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "neuralwatt",
    baseUrl: (options.baseUrl ?? "https://api.neuralwatt.com/v1").replace(/\/+$/, ""),
    apiKey: options.apiKey,
    fetch: options.fetch,
    doneUsage: true,
    mapUsage: (usage) => toUsage(usage as NeuralWattUsage | undefined),
    mapHttpError: (response, bodyText, secrets) =>
      neuralWattHttpError(
        classifyNeuralWattError({ status: response.status, headers: response.headers, body: safeJson(bodyText) }),
        bodyText,
        secrets,
      ),
    serializeMessage: (message, request) =>
      toMessage(message, request.model, shouldPreserveReasoning(request), shouldClearReasoning(request)),
    transformBody: (body, request) => neuralWattTransform(body, request),
  });
}

function shouldPreserveReasoning(request: ProviderRequest): boolean {
  // Preserve prior reasoning when the model declares reasoning capability or the
  // caller forces it via `compat.preserve_thinking`.
  return request.model.capabilities?.reasoning === true || neuralWattPreserveThinking(request) === true;
}

function shouldClearReasoning(request: ProviderRequest): boolean {
  return neuralWattClearThinking(request) === true;
}

export function neuralWattBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    serializeMessage: (message, req) => toMessage(message, req.model, shouldPreserveReasoning(req), shouldClearReasoning(req)),
    transformBody: (body, req) => neuralWattTransform(body, req),
  });
}

function neuralWattTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripNeuralWattOwnedCompat(request.options?.compat),
    ...request.options?.extra,
    // Resolved official fields win over raw compat/extra escape hatches (legacy order).
    tool_choice: neuralWattToolChoice(request),
    reasoning_effort: neuralWattReasoningEffort(request),
    thinking_token_budget: neuralWattThinkingTokenBudget(request),
    chat_template_kwargs: neuralWattChatTemplateKwargs(request),
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function neuralWattEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, {
    signal,
    doneUsage: true,
    mapUsage: (usage) => toUsage(usage as NeuralWattUsage | undefined),
  });
}

/**
 * Like {@link neuralWattEvents} but also yields `neuralwatt:telemetry` events
 * parsed from NeuralWatt `: energy` / `: cost` SSE comments, in stream order.
 * Use this when a host wants to observe energy/cost telemetry alongside the
 * standard provider event stream. `generate()` stays streaming-only and uses
 * {@link neuralWattEvents}, so telemetry is opt-in via this helper.
 */
export function neuralWattEventsWithTelemetry(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<NeuralWattEvent> {
  return openAIChatEvents(body, {
    signal,
    doneUsage: true,
    mapUsage: (usage) => toUsage(usage as NeuralWattUsage | undefined),
    onComment: (text) => parseNeuralWattComment(text) as unknown as ProviderEvent | undefined,
  }) as AsyncIterable<NeuralWattEvent>;
}

function toMessage(message: Message, model: ModelConfig, preserveReasoning = false, clearReasoning = false): JsonObject {
  const capabilities = model.capabilities ?? {};
  // Prior assistant reasoning (`thinking` content blocks) is preserved as a
  // NeuralWatt `reasoning_content` field only when the model is reasoning-capable
  // (or `compat.preserve_thinking` forces it) and `compat.clear_thinking` has not
  // reset the chain. It is never flattened into text content, so it does not leak
  // into providers/models that do not support reasoning. No reasoning is
  // synthesized; only caller-provided thinking blocks are echoed.
  const preserve = preserveReasoning && !clearReasoning;
  const thinkingParts = message.content.filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking");
  const reasoningContent = preserve && thinkingParts.length > 0 ? thinkingParts.map((part) => part.text).join("\n") : undefined;
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }
  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text");
    if (toolCalls.length > 0) {
      return clean({
        role: "assistant",
        content: textParts.map((part) => part.text).join("\n") || null,
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
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`NeuralWatt request includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("NeuralWatt image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      rejectProviderMediaBlock(part, capabilities, model);
    } else if (part.type === "tool_call") {
      throw new Error("NeuralWatt assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("NeuralWatt tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text") {
    return clean({ role: message.role, content: content[0]!.text, reasoning_content: reasoningContent });
  }
  return clean({ role: message.role, content, reasoning_content: reasoningContent });
}

export function toUsage(usage: NeuralWattUsage | undefined): Usage | undefined {
  // NeuralWatt maps prompt_tokens_details.cached_tokens -> cacheReadTokens.
  // No cache-write token is reported today; cacheWriteTokens stays undefined.
  return usage
    ? {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens,
      }
    : undefined;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

function safeJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface NeuralWattUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
  };
}
