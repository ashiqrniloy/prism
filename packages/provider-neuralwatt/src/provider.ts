import type {
  AIProvider,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  Message,
  ModelCapabilities,
  ProviderEvent,
  ProviderRequest,
  ToolDefinition,
  Usage,
} from "@arnilo/prism";
import {
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  resolveCredentialValue,
  redactSecrets,
  toolCallContent,
} from "@arnilo/prism";
import { readNeuralWattSseFrames, type NeuralWattSseFrame } from "./sse.js";
import { parseNeuralWattComment, type NeuralWattEvent } from "./telemetry.js";
import { classifyNeuralWattError, neuralWattHttpError } from "./retry.js";
import { neuralWattChatTemplateKwargs, neuralWattClearThinking, neuralWattPreserveThinking, neuralWattReasoningEffort, neuralWattThinkingTokenBudget, neuralWattToolChoice } from "./thinking.js";

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
          const bodyText = await safeText(response);
          const decision = classifyNeuralWattError({ status: response.status, headers: response.headers, body: safeJson(bodyText) });
          yield providerError(neuralWattHttpError(decision, bodyText, secrets), secrets);
          return;
        }
        if (!response.body) {
          yield providerError(new Error("NeuralWatt response had no body"), secrets);
          return;
        }
        yield* neuralWattEvents(response.body);
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
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  return clean({
    model: request.model.model,
    messages: request.messages.map((message) => toMessage(message, request.model.capabilities ?? {}, shouldPreserveReasoning(request), shouldClearReasoning(request))),
    tools: request.tools?.map(toTool),
    tool_choice: neuralWattToolChoice(request),
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: neuralWattReasoningEffort(request),
    thinking_token_budget: neuralWattThinkingTokenBudget(request),
    chat_template_kwargs: neuralWattChatTemplateKwargs(request),
    preserve_thinking: neuralWattPreserveThinking(request),
    clear_thinking: neuralWattClearThinking(request),
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...request.options?.compat,
    ...request.options?.extra,
  });
}

export async function* neuralWattEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
  for await (const event of neuralWattFramesToEvents(readNeuralWattSseFrames(body), false)) {
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
export async function* neuralWattEventsWithTelemetry(body: ReadableStream<Uint8Array>): AsyncIterable<NeuralWattEvent> {
  yield* neuralWattFramesToEvents(readNeuralWattSseFrames(body), true);
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
    if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
  }
  yield providerDone(usage);
}

function toMessage(message: Message, capabilities: ModelCapabilities = {}, preserveReasoning = false, clearReasoning = false): JsonObject {
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

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object" } } });
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

function parseArgs(text: string): JsonObject {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

async function safeText(response: Response): Promise<string> {
  try {
    return redactSecrets(await response.text(), []);
  } catch {
    return "";
  }
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
