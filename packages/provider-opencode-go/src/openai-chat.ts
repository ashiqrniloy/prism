import type { ContentBlock, JsonObject, Message, ModelCapabilities, ProviderEvent, ProviderRequest, Usage } from "@arnilo/prism";
import { assertStructuredOutputRequestSupported } from "@arnilo/prism";
import { providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, toolCallContent } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput, mapOpenAIChatUsage, serializeOpenAITool } from "@arnilo/prism/providers/openai";
import { parseJsonObjectArguments, readSseData } from "@arnilo/prism/providers/transport";
import {
  openCodeGoPreserveThinking,
  openCodeGoReasoning,
  openCodeGoReasoningEffort,
  openCodeGoThinking,
  stripOpenCodeGoOwnedCompat,
} from "./thinking.js";

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function openAIChatBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const preserveThinking = openCodeGoPreserveThinking(request);
  const compatRest = stripOpenCodeGoOwnedCompat(request.options?.compat);
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => serializeOpenCodeGoChatMessage(message, request.model.capabilities ?? {}, preserveThinking)),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    ...parameters,
    max_tokens: maxTokens,
    ...compatRest,
    thinking: openCodeGoThinking(request),
    reasoning_effort: openCodeGoReasoningEffort(request),
    reasoning: openCodeGoReasoning(request),
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* openAIChatEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  let sawDoneMarker = false;
  let sawFinishReason = false;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") { sawDoneMarker = true; break; }
    const chunk = JSON.parse(data) as OpenAIChunk;
    usage = mapOpenAIChatUsage(chunk.usage) ?? usage;
    const mapped = mapOpenAIChatUsage(chunk.usage);
    if (mapped) yield providerUsage(mapped);
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason) sawFinishReason = true;
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
  const danglingToolCall = [...tools.values()].some((call) => !call.id || !call.name);
  if (!sawDoneMarker || !sawFinishReason || danglingToolCall) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(new Error(
      `OpenCode Go chat stream ended without completion evidence `
      + `([DONE]: ${sawDoneMarker ? "received" : "missing"}, `
      + `finish_reason: ${sawFinishReason ? "received" : "missing"}, `
      + `tool calls complete: ${danglingToolCall ? "no" : "yes"})`,
    ));
    return;
  }
  for (const call of tools.values()) {
    yield providerToolCall(toolCallContent(
      call.id!,
      call.name!,
      parseJsonObjectArguments(call.argumentsText, { toolName: call.name }),
    ));
  }
  yield providerDone(usage);
}

/**
 * Chat Completions serializer that preserves thinking as top-level
 * `reasoning_content` instead of folding it into text (needed for tool-call
 * continuity on reasoning models behind the Go gateway).
 */
export function serializeOpenCodeGoChatMessage(
  message: Message,
  capabilities: ModelCapabilities,
  preserveThinking: boolean,
): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }

  const thinkingParts = message.content.filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking");
  const reasoningContent = preserveThinking && thinkingParts.length > 0
    ? thinkingParts.map((part) => part.text).join("\n")
    : undefined;

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
      // Handled via reasoning_content when preserving; otherwise dropped (never folded into text).
      continue;
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`OpenCode Go OpenAI route includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("OpenCode Go image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`OpenCode Go OpenAI route does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call") {
      throw new Error("OpenCode Go assistant tool_call blocks must be serialized with other assistant content");
    } else if (part.type === "tool_result") {
      throw new Error("OpenCode Go tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]?.type === "text") {
    return clean({ role: message.role, content: content[0]!.text, reasoning_content: reasoningContent });
  }
  return clean({
    role: message.role,
    content: content.length > 0 ? content : (reasoningContent ? null : ""),
    reasoning_content: reasoningContent,
  });
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

interface OpenAIChunk {
  readonly choices?: readonly { readonly finish_reason?: string | null; readonly delta?: { readonly content?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: unknown;
}
