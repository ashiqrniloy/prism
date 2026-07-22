import type {
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
  providerUsage,
  toolCallContent,
} from "@arnilo/prism";
import {
  bytesToBase64,
  resolveProviderMediaMessages,
} from "@arnilo/prism/providers/media";
import { readSseData } from "@arnilo/prism/providers/transport";
import {
  googlePreserveThinking,
  googleThinkingConfig,
  stripGoogleOwnedCompat,
} from "./thinking.js";

/** Serialize a Prism `ProviderRequest` to a Gemini `generateContent` body. */
export async function googleGenerateContentBody(request: ProviderRequest): Promise<JsonObject> {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const preserveThinking = googlePreserveThinking(request);
  const { maxTokens, temperature, topP, topK, stopSequences, ...parameters } = request.model.parameters ?? {};
  const resolvedMedia = await resolveProviderMediaMessages(request.messages, request.model, { signal: request.signal });
  const systemText = request.messages
    .filter((m) => m.role === "system")
    .map((m) => text(m, preserveThinking))
    .filter(Boolean)
    .join("\n\n");

  const thinkingConfig = googleThinkingConfig(request);
  const generationConfig = clean({
    ...parameters,
    temperature,
    topP,
    topK,
    stopSequences,
    maxOutputTokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...(thinkingConfig ? { thinkingConfig } : {}),
    ...stripGoogleOwnedCompat(request.options?.compat as JsonObject | undefined),
    ...(request.options?.extra?.generationConfig as JsonObject | undefined),
  });

  const { generationConfig: _ignored, ...extraRest } = (request.options?.extra ?? {}) as Record<string, unknown>;

  return clean({
    contents: await Promise.all(
      request.messages
        .filter((m) => m.role !== "system")
        .map((message) => toContent(message, request.model, preserveThinking, resolvedMedia)),
    ),
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    tools: request.tools?.length ? [{ functionDeclarations: request.tools.map(toTool) }] : undefined,
    generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    ...extraRest,
  });
}

/** Map Gemini `streamGenerateContent?alt=sse` chunks to Prism `ProviderEvent`s. */
export async function* googleGenerateContentEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  let usage: Usage | undefined;
  let sawFinishReason = false;
  let toolIndex = 0;
  const emittedToolIds = new Set<string>();

  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as GeminiStreamChunk;
    if (chunk.error) {
      yield providerError(new Error(chunk.error.message ?? JSON.stringify(chunk.error)));
      return;
    }
    if (chunk.promptFeedback?.blockReason) {
      yield providerError(new Error(`Google prompt blocked: ${chunk.promptFeedback.blockReason}`));
      return;
    }

    usage = toUsage(chunk.usageMetadata) ?? usage;

    for (const candidate of chunk.candidates ?? []) {
      if (candidate.finishReason) sawFinishReason = true;
      for (const part of candidate.content?.parts ?? []) {
        if (part.functionCall?.name) {
          const id = part.functionCall.id ?? `google_tool_${toolIndex}`;
          if (!emittedToolIds.has(id)) {
            emittedToolIds.add(id);
            yield providerToolCall(toolCallContent(
              id,
              part.functionCall.name,
              (part.functionCall.args ?? {}) as JsonObject,
            ));
            toolIndex += 1;
          }
          continue;
        }
        if (typeof part.text === "string" && part.text.length > 0) {
          if (part.thought) yield providerThinkingDelta(part.text, part.thoughtSignature);
          else yield providerTextDelta(part.text);
        }
      }
    }

    if (usage) yield providerUsage(usage);
  }

  if (!sawFinishReason) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(new Error(
      "Google generateContent stream ended without completion evidence (finishReason missing)",
    ));
    return;
  }
  yield providerDone(usage);
}

async function toContent(
  message: Message,
  model: ModelConfig,
  preserveThinking: boolean,
  resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>,
): Promise<JsonObject> {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const responsePayload: JsonObject = result?.error !== undefined
      ? {
        error: clean({
          message: result.error.message,
          code: result.error.code,
          name: result.error.name,
        }),
      }
      : { result: jsonResult(result?.result) };
    return {
      role: "user",
      parts: [{
        functionResponse: {
          name: result?.name ?? "",
          response: responsePayload,
        },
      }],
    };
  }

  const parts: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      parts.push({ text: part.text });
    } else if (part.type === "thinking") {
      if (preserveThinking) {
        parts.push(clean({
          text: part.text,
          thought: true,
          thoughtSignature: part.signature,
        }));
      } else if (part.text) {
        parts.push({ text: part.text });
      }
    } else if (part.type === "image" || part.type === "audio") {
      const resolved = resolvedMedia.get(part)!;
      parts.push({
        inlineData: {
          mimeType: resolved.mediaType,
          data: bytesToBase64(resolved.bytes),
        },
      });
    } else if (part.type === "document") {
      parts.push(toInlineData(part, resolvedMedia));
    } else if (part.type === "file") {
      parts.push(toInlineData(part, resolvedMedia));
    } else if (part.type === "tool_call") {
      parts.push({
        functionCall: clean({
          id: part.id,
          name: part.name,
          args: part.arguments ?? {},
        }),
      });
    } else if (part.type === "tool_result") {
      throw new Error("Google tool_result blocks must appear in role=tool messages");
    }
    // tool_call_delta is stream-only; ignore if somehow present in history.
  }

  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: parts.length > 0 ? parts : [{ text: "" }],
  };
}

function toInlineData(
  part: DocumentContent | FileContent,
  resolvedMedia: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>,
): JsonObject {
  const resolved = resolvedMedia.get(part)!;
  return {
    inlineData: {
      mimeType: resolved.mediaType,
      data: bytesToBase64(resolved.bytes),
    },
  };
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? { type: "object" },
  });
}

function text(message: Message, preserveThinking = false): string {
  return message.content.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "thinking") return preserveThinking ? part.text : "";
    return "";
  }).join("");
}

function toUsage(usage: GeminiUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  // thoughtsTokenCount is billed separately on wire; fold into total when present.
  const total =
    usage.totalTokenCount
    ?? ((usage.promptTokenCount ?? 0)
      + (usage.candidatesTokenCount ?? 0)
      + (usage.thoughtsTokenCount ?? 0)
      || undefined);
  return {
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    cacheReadTokens: usage.cachedContentTokenCount,
    totalTokens: total,
  };
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

function jsonResult(value: unknown): JsonObject | string | number | boolean | null {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") return value as JsonObject;
  return String(value);
}

interface GeminiStreamChunk {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly GeminiPart[] };
    readonly finishReason?: string;
  }[];
  readonly usageMetadata?: GeminiUsage;
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly message?: string; readonly code?: number; readonly status?: string };
}

interface GeminiPart {
  readonly text?: string;
  readonly thought?: boolean;
  readonly thoughtSignature?: string;
  readonly functionCall?: {
    readonly id?: string;
    readonly name?: string;
    readonly args?: JsonObject;
  };
}

interface GeminiUsage {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly totalTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly thoughtsTokenCount?: number;
}
