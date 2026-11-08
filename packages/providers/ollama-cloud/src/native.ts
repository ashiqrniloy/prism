import type { ContentBlock, JsonObject, Message, ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import {
  mapProviderStopReason,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerUsage,
  toolCallContent,
  toolCallFromArgumentsText,
} from "@arnilo/prism";
import {
  assertNotAborted,
  assertStructuredOutputRequestSupported,
  bytesToBase64,
  createToolNameMap,
  DEFAULT_MAX_BUFFER_BYTES,
  normalizeUsage,
  productToolName,
  providerHttpError,
  readBoundedResponseText,
  readRetryAfterMs,
  resolvePreserveThinking,
  resolveProviderApiKey,
  resolveProviderMediaMessages,
  serializeOpenAITool,
  serializeToolResultText,
  stripOwnedCompat,
  type ToolNameMap,
  wireToolName,
} from "@arnilo/prism/provider-kit";
import { ollamaCloudThink } from "./models.js";

/** A single NDJSON line over 1 MiB is not a chat frame; fail before buffering it. */
export const OLLAMA_CLOUD_MAX_LINE_BYTES = 1_048_576;

export interface OllamaCloudNativePreparedRequest {
  readonly body: JsonObject;
  readonly toolNames: ToolNameMap;
}

/**
 * Serializes a Prism request to the native `/api/chat` body. Text, thinking, tool
 * calls/results, images, structured output, and `num_predict` are the fields measured in Task 1.
 */
export async function ollamaCloudNativeBody(request: ProviderRequest): Promise<OllamaCloudNativePreparedRequest> {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const toolNames = createToolNameMap(request.tools);
  const media = await resolveProviderMediaMessages(request.messages, request.model, { signal: request.signal });
  const preserveThinking = resolvePreserveThinking(request);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const options: Record<string, unknown> = { ...(parameters as Record<string, unknown>) };
  const outputLimit =
    typeof maxTokens === "number"
      ? maxTokens
      : typeof request.model.limits?.maxOutputTokens === "number"
        ? request.model.limits.maxOutputTokens
        : undefined;
  if (outputLimit !== undefined) options.num_predict = outputLimit;

  const think = ollamaCloudThink(request);
  const format = request.options?.structuredOutput?.schema;
  const tools = request.tools?.map((tool: ToolDefinition) => serializeOpenAITool(tool, toolNames));

  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => serializeNativeMessage(message, media, preserveThinking, toolNames)),
    stream: true,
    ...(stripOwnedCompat(request.options?.compat, ["thinkingValues", "thinkingDefault"]) ?? {}),
    ...(request.options?.extra ?? {}),
    ...(think !== undefined ? { think } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
  return { body: clean(body) as JsonObject, toolNames };
}

function serializeNativeMessage(
  message: Message,
  media: ReadonlyMap<unknown, { readonly mediaType: string; readonly bytes: Uint8Array }>,
  preserveThinking: boolean,
  toolNames: ToolNameMap,
): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const image = message.content.find((part) => part.type === "image");
    if (image) throw new Error("Ollama Cloud native does not support images in tool results");
    return clean({
      role: "tool",
      tool_name: result?.name ? wireToolName(result.name, toolNames) : undefined,
      content: serializeToolResultText(message),
    });
  }

  const images: string[] = [];
  const text: string[] = [];
  const thinking: string[] = [];
  const toolCalls: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") text.push(part.text);
    else if (part.type === "thinking") {
      if (preserveThinking && part.text) thinking.push(part.text);
    } else if (part.type === "image") {
      if (message.role !== "user") throw new Error("Ollama Cloud native image blocks are supported on user messages only");
      const resolved = media.get(part);
      if (!resolved) throw new Error("Ollama Cloud native image block was not resolved");
      if (!resolved.mediaType.startsWith("image/")) throw new Error(`Ollama Cloud native does not support ${resolved.mediaType} media`);
      images.push(bytesToBase64(resolved.bytes));
    } else if (part.type === "tool_call") {
      toolCalls.push({ function: { name: wireToolName(part.name, toolNames), arguments: part.arguments } });
    } else if (part.type === "tool_result") {
      throw new Error("Provider tool_result blocks must appear in role=tool messages");
    } else {
      throw new Error(`Ollama Cloud native does not support ${part.type} content blocks`);
    }
  }

  return clean({
    role: message.role,
    content: text.join(""),
    ...(thinking.length > 0 ? { thinking: thinking.join("") } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  });
}

/** Native NDJSON stream: `message.content`, `message.thinking`, `message.tool_calls`, then `done`. */
export async function* ollamaCloudNativeEvents(
  request: ProviderRequest,
  options: {
    readonly id: string;
    readonly baseUrl: string;
    readonly apiKey?: Parameters<typeof resolveProviderApiKey>[0];
    readonly fetch?: typeof fetch;
  },
): AsyncIterable<ProviderEvent> {
  assertNotAborted(request.signal);
  const secrets: (string | undefined)[] = [];
  let apiKey: string | undefined;
  try {
    apiKey = await resolveProviderApiKey(options.apiKey, undefined, request);
    secrets.push(apiKey);
    const prepared = await ollamaCloudNativeBody(request);
    const headers = nativeHeaders(request, apiKey);
    const response = await (options.fetch ?? fetch)(`${options.baseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(prepared.body),
      signal: request.signal,
    });

    if (!response.ok) {
      const bodyText = await readBoundedResponseText(response, { secrets });
      yield providerError(ollamaCloudHttpError(response, bodyText, secrets), secrets);
      return;
    }
    if (!response.body) {
      yield providerError(new Error(`${options.id} response had no body`), secrets);
      return;
    }

    const structured = request.options?.structuredOutput !== undefined;
    let structuredText = "";
    let sawDone = false;
    for await (const line of readNdjsonLines(response.body, request.signal)) {
      let frame: NativeChatFrame;
      try {
        frame = JSON.parse(line) as NativeChatFrame;
      } catch (error) {
        yield providerError(error, secrets);
        return;
      }
      if (frame.error !== undefined) {
        yield providerError(nativeStreamError(frame.error), secrets);
        return;
      }

      const message = frame.message;
      if (message?.thinking) yield providerThinkingDelta(message.thinking);
      if (message?.content) {
        if (structured) {
          structuredText += message.content;
          if (new TextEncoder().encode(structuredText).byteLength > DEFAULT_MAX_BUFFER_BYTES) {
            throw new Error(`Ollama Cloud native structured output exceeded ${DEFAULT_MAX_BUFFER_BYTES} bytes`);
          }
        } else yield providerTextDelta(message.content);
      }
      for (const [index, call] of (message?.tool_calls ?? []).entries()) {
        yield providerToolCall(nativeToolCall(call, index, prepared.toolNames));
      }

      if (frame.done) {
        sawDone = true;
        if (structured && structuredText) yield providerTextDelta(stripJsonFence(structuredText));
        const usage = nativeUsage(frame);
        if (usage) yield providerUsage(usage);
        yield providerDone(usage, mapProviderStopReason(frame.done_reason));
        return;
      }
    }

    if (!sawDone) {
      yield providerError(new Error("Ollama Cloud native stream ended without a done frame"), secrets);
    }
  } catch (error) {
    yield providerError(error, secrets);
  }
}

function nativeHeaders(request: ProviderRequest, apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.options?.headers ?? {})) {
    if (typeof value === "string") headers[key] = value;
  }
  for (const owned of ["content-type", "authorization"]) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === owned) delete headers[key];
    }
  }
  headers["content-type"] = "application/json";
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

interface NativeChatFrame {
  readonly message?: {
    readonly content?: string;
    readonly thinking?: string;
    readonly tool_calls?: readonly {
      readonly id?: string;
      readonly function?: { readonly index?: number; readonly name?: string; readonly arguments?: unknown };
    }[];
  };
  readonly done?: boolean;
  readonly done_reason?: string;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_cached_count?: number;
  readonly eval_count?: number;
  readonly total_duration?: number;
  readonly error?: unknown;
}

function nativeToolCall(
  call: NonNullable<NonNullable<NativeChatFrame["message"]>["tool_calls"]>[number],
  index: number,
  toolNames: ToolNameMap,
) {
  const name = productToolName(call.function?.name ?? "", toolNames);
  const id = call.id ?? `call_${index}_1`;
  const args = call.function?.arguments;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return toolCallContent(id, name, args as JsonObject);
  }
  return toolCallFromArgumentsText(id, name, typeof args === "string" ? args : JSON.stringify(args ?? {}));
}

function nativeUsage(frame: NativeChatFrame) {
  return normalizeUsage({
    inputTokens: frame.prompt_eval_count,
    outputTokens: frame.eval_count,
    cacheReadTokens: frame.prompt_eval_cached_count,
    ...(typeof frame.total_duration === "number" ? { metadata: { ollama: { totalDurationNs: frame.total_duration } } } : {}),
  });
}

function nativeStreamError(error: unknown): Error {
  const message = typeof error === "string" ? error : JSON.stringify(error);
  const failure = new Error(`Ollama Cloud stream error: ${message}`) as Error & { code?: number };
  // A mid-stream overflow has no HTTP status; give the classifier the status the body implies.
  if (/context length|prompt too long/i.test(message)) failure.code = 400;
  return failure;
}

/** Response errors share the classifier; unknown model and auth carry the vendor's own next step. */
export function ollamaCloudHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  let hint = "";
  if (response.status === 401 || response.status === 403) hint = "Check the OLLAMA_API_KEY ref and that the key is active. ";
  else if (response.status === 404) hint = "Unknown model; list models with GET /api/tags. ";
  return providerHttpError(
    "Ollama Cloud",
    { status: response.status, code: response.status, retryAfterMs: readRetryAfterMs(response.headers) },
    `${hint}${bodyText}`,
    secrets,
  );
}

/** Trims a whole-response Markdown fence around JSON (the measured `format` reply from gemma4:31b). */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return match?.[1] !== undefined ? match[1].trim() : trimmed;
}

async function* readNdjsonLines(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        assertLineBound(line);
        if (line.trim()) yield line;
        newline = buffer.indexOf("\n");
      }
      assertLineBound(buffer);
    }
    buffer += decoder.decode();
    const line = buffer.replace(/\r$/, "");
    assertLineBound(line);
    if (line.trim()) yield line;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream already closed
    } finally {
      reader.releaseLock();
    }
  }
}

function assertLineBound(line: string): void {
  if (new TextEncoder().encode(line).byteLength > OLLAMA_CLOUD_MAX_LINE_BYTES) {
    throw new Error(`Ollama Cloud native NDJSON line exceeded ${OLLAMA_CLOUD_MAX_LINE_BYTES} bytes`);
  }
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
