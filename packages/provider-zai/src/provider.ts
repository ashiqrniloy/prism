import type { AIProvider, ContentBlock, JsonObject, Message, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { type CredentialValueSource, trimTrailingSlashes } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { zaiPreserveThinking, zaiReasoningEffort, zaiThinking, zaiToolStream } from "./thinking.js";

/** Official international Chat Completions base (China `open.bigmodel.cn` remains overridable). */
export const ZAI_DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";

export interface ZaiProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createZaiProvider(options: ZaiProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "zai",
    baseUrl: trimTrailingSlashes(options.baseUrl ?? ZAI_DEFAULT_BASE_URL),
    apiKey: options.apiKey,
    fetch: options.fetch,
    doneUsage: true,
    requestFailedPrefix: "Z.AI request failed",
    serializeMessage: (message, request) => toZaiMessage(message, request.model, zaiPreserveThinking(request)),
    transformBody: (body, request) => zaiTransform(body, request),
  });
}

export function zaiBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    serializeMessage: (message, req) => toZaiMessage(message, req.model, zaiPreserveThinking(req)),
    transformBody: (body, req) => zaiTransform(body, req),
  });
}

function zaiTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, stream_options: _streamOptions, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripZaiManagedCompat(request.options?.compat),
    ...request.options?.extra,
    // Resolved official fields win over raw compat/extra escape hatches.
    thinking: zaiThinking(request),
    reasoning_effort: zaiReasoningEffort(request),
    tool_stream: zaiToolStream(request),
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function zaiEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, doneUsage: true });
}

/**
 * Serialize Prism messages for Z.AI Chat Completions.
 * Prior thinking blocks become `reasoning_content` when Preserved Thinking is active;
 * otherwise they are dropped (never flattened into visible text).
 * @see https://docs.z.ai/guides/capabilities/thinking-mode
 */
export function toZaiMessage(message: Message, model: ModelConfig, preserveThinking = false): JsonObject {
  const capabilities = model.capabilities ?? {};
  const thinkingParts = message.content.filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking");
  const reasoningContent = preserveThinking && thinkingParts.length > 0 ? thinkingParts.map((part) => part.text).join("\n") : undefined;

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
        throw new Error("Z.AI request includes image but model does not declare image input capability");
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Z.AI image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`Z.AI Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call") {
      throw new Error("Z.AI assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("Z.AI tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text") {
    return clean({ role: message.role, content: content[0]!.text, reasoning_content: reasoningContent });
  }
  return clean({ role: message.role, content, reasoning_content: reasoningContent });
}

/** Drop Prism-managed compat keys so they are not double-emitted / overwrite resolved fields. */
function stripZaiManagedCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinking: _thinking,
    reasoning_effort: _reasoningEffort,
    reasoningEffort: _reasoningEffortCamel,
    tool_stream: _toolStream,
    clear_thinking: _clearThinking,
    clearThinking: _clearThinkingCamel,
    preserveThinking: _preserveThinking,
    preserve_thinking: _preserveThinkingSnake,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
