import type { AIProvider, ContentBlock, CredentialValueSource, JsonObject, Message, ModelCapabilities, ModelConfig, ProviderEvent, ProviderRequest, Usage } from "@arnilo/prism";
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
  toolCallContent,
} from "@arnilo/prism";
import { serializeOpenAITool, applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { rejectProviderMediaBlock } from "@arnilo/prism/providers/media";
import { parseJsonObjectArguments, readBoundedResponseText, readSseEvents } from "@arnilo/prism/providers/transport";
import { parseNeuralWattComment, type NeuralWattEvent } from "./telemetry.js";
import { classifyNeuralWattError, neuralWattHttpError } from "./retry.js";
import { neuralWattChatTemplateKwargs, neuralWattClearThinking, neuralWattPreserveThinking, neuralWattReasoningEffort, neuralWattThinkingTokenBudget, neuralWattToolChoice, stripNeuralWattOwnedCompat } from "./thinking.js";

export interface NeuralWattProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

type NeuralWattSseFrame =
  | { readonly kind: "data"; readonly data: string }
  | { readonly kind: "comment"; readonly text: string };

export function createNeuralWattProvider(options: NeuralWattProviderOptions = {}): AIProvider {
  const id = options.id ?? "neuralwatt";
  const baseUrl = (options.baseUrl ?? "https://api.neuralwatt.com/v1").replace(/\/$/, "");

  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const secrets = [token];
      try {
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(neuralWattBody(request)),
          signal: request.signal,
        });
        if (!response.ok) {
          const bodyText = await readBoundedResponseText(response, { secrets });
          const decision = classifyNeuralWattError({ status: response.status, headers: response.headers, body: safeJson(bodyText) });
          yield providerError(neuralWattHttpError(decision, bodyText, secrets), secrets);
          return;
        }
        if (!response.body) {
          yield providerError(new Error("NeuralWatt response had no body"), secrets);
          return;
        }
        yield* neuralWattEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
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
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => toMessage(message, request.model, shouldPreserveReasoning(request), shouldClearReasoning(request))),
    tools: request.tools?.map((tool) => clean(serializeOpenAITool(tool) as Record<string, unknown>)),
    stream: true,
    stream_options: { include_usage: true },
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripNeuralWattOwnedCompat(request.options?.compat),
    ...request.options?.extra,
    tool_choice: neuralWattToolChoice(request),
    reasoning_effort: neuralWattReasoningEffort(request),
    thinking_token_budget: neuralWattThinkingTokenBudget(request),
    chat_template_kwargs: neuralWattChatTemplateKwargs(request),
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* neuralWattEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  for await (const event of neuralWattFramesToEvents(readNeuralWattSseFrames(body, signal), false)) {
    // With emitTelemetry=false the shared generator yields only ProviderEvent.
    yield event as ProviderEvent;
  }
}

/**
 * Like {@link neuralWattEvents} but also yields `neuralwatt:telemetry` events
 * parsed from NeuralWatt `: energy` / `: cost` SSE comments, in stream order.
 * Use this when a host wants to observe energy/cost telemetry alongside the
 * standard provider event stream. `generate()` stays streaming-only and uses
 * {@link neuralWattEvents}, so telemetry is opt-in via this helper.
 */
export async function* neuralWattEventsWithTelemetry(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<NeuralWattEvent> {
  yield* neuralWattFramesToEvents(readNeuralWattSseFrames(body, signal), true);
}

async function* neuralWattFramesToEvents(frames: AsyncIterable<NeuralWattSseFrame>, emitTelemetry: boolean): AsyncIterable<NeuralWattEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  for await (const frame of frames) {
    if (frame.kind === "comment") {
      if (emitTelemetry) {
        const telemetry = parseNeuralWattComment(frame.text);
        if (telemetry) yield telemetry;
      }
      continue;
    }
    const data = frame.data;
    if (data === "[DONE]") break;
    let chunk: NeuralWattChunk;
    try {
      chunk = JSON.parse(data) as NeuralWattChunk;
    } catch (error) {
      yield providerError(error, []);
      return;
    }
    if (chunk.usage) {
      usage = toUsage(chunk.usage) ?? usage;
      if (toUsage(chunk.usage)) yield providerUsage(toUsage(chunk.usage)!);
    }
    for (const choice of chunk.choices ?? []) {
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
        yield providerToolCallDelta({ index, id: tool.id, name: tool.function?.name, argumentsText: tool.function?.arguments });
      }
    }
  }
  for (const call of tools.values()) {
    if (call.id && call.name) {
      yield providerToolCall(toolCallContent(
        call.id,
        call.name,
        parseJsonObjectArguments(call.argumentsText, { toolName: call.name }),
      ));
    }
  }
  yield providerDone(usage);
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
      // Handled via `reasoning_content` above when preserving; otherwise dropped
      // so prior reasoning never leaks into text content for non-reasoning models.
      continue;
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

async function* readNeuralWattSseFrames(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<NeuralWattSseFrame> {
  for await (const event of readSseEvents(body, { signal })) {
    if (event.comments?.length) {
      for (const text of event.comments) yield { kind: "comment", text };
    }
    if (event.data.length > 0) yield { kind: "data", data: event.data };
  }
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

interface NeuralWattChunk {
  readonly choices?: readonly {
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
  readonly usage?: NeuralWattUsage;
}

export interface NeuralWattUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
  };
}
