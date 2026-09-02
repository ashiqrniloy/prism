import type { ContentBlock, JsonObject, Message, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, openAIChatEvents as sharedOpenAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { commandCodePreserveThinking, stripCommandCodeOwnedCompat } from "./thinking.js";

export function commandCodeChatBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    mapMessages: (req) => req.messages,
    serializeMessage: (message) => serializeCommandCodeChatMessage(message, commandCodePreserveThinking(request)),
    transformBody: (body, req) => commandCodeChatTransform(body, req),
  });
}

function commandCodeChatTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    max_tokens: maxTokens,
    ...stripCommandCodeOwnedCompat(request.options?.compat),
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function commandCodeChatEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return sharedOpenAIChatEvents(body, { signal, strictCompletion: true });
}

/**
 * Chat Completions serializer preserving thinking as top-level
 * `reasoning_content` instead of folding it into text — required for tool-call
 * continuity and cache-prefix stability on OSS reasoning models. Image blocks
 * map to `image_url` data URLs for vision models; media-only blocks
 * (audio/document/file) are rejected on this route.
 */
export function serializeCommandCodeChatMessage(message: Message, preserveThinking: boolean): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }

  const thinkingParts = message.content.filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking");
  const reasoningContent = preserveThinking && thinkingParts.length > 0 ? thinkingParts.map((part) => part.text).join("\n") : undefined;

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
      // folded into reasoning_content above
    } else if (part.type === "image") {
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Command Code image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`Command Code OpenAI route does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call") {
      throw new Error("Command Code assistant tool_call blocks must be serialized with other assistant content");
    } else if (part.type === "tool_result") {
      throw new Error("Command Code tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]?.type === "text") {
    return clean({ role: message.role, content: content[0]!.text, reasoning_content: reasoningContent });
  }
  return clean({
    role: message.role,
    content: content.length > 0 ? content : reasoningContent ? null : "",
    reasoning_content: reasoningContent,
  });
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}