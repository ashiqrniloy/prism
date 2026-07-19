import type {
  AIProvider,
  ContentBlock,
  JsonObject,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  Usage,
} from "@arnilo/prism";
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
  type CredentialValueSource,
} from "@arnilo/prism";
import {
  applyOpenAIChatStructuredOutput,
  mapOpenAIChatUsage,
  serializeOpenAITool,
} from "@arnilo/prism/providers/openai";
import {
  parseJsonObjectArguments,
  readBoundedResponseText,
  readSseData,
} from "@arnilo/prism/providers/transport";
import {
  zaiPreserveThinking,
  zaiReasoningEffort,
  zaiThinking,
  zaiToolStream,
} from "./thinking.js";

/** Official international Chat Completions base (China `open.bigmodel.cn` remains overridable). */
export const ZAI_DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";

export interface ZaiProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function createZaiProvider(options: ZaiProviderOptions = {}): AIProvider {
  const id = options.id ?? "zai";
  const baseUrl = (options.baseUrl ?? ZAI_DEFAULT_BASE_URL).replace(/\/$/, "");
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
          body: JSON.stringify(zaiBody(request)),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`Z.AI request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Z.AI response had no body"), secrets);
        yield* zaiEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function zaiBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const compatRest = stripZaiManagedCompat(request.options?.compat);
  const preserveThinking = zaiPreserveThinking(request);
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => toZaiMessage(message, request.model, preserveThinking)),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...compatRest,
    ...request.options?.extra,
    // Resolved official fields win over raw compat/extra escape hatches.
    thinking: zaiThinking(request),
    reasoning_effort: zaiReasoningEffort(request),
    tool_stream: zaiToolStream(request),
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* zaiEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as ZaiChunk;
    if (chunk.usage) {
      const mapped = mapOpenAIChatUsage(chunk.usage);
      if (mapped) {
        usage = mapped;
        yield providerUsage(mapped);
      }
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
        yield providerToolCallDelta({
          index,
          id: tool.id,
          name: tool.function?.name,
          argumentsText: tool.function?.arguments,
        });
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

/**
 * Serialize Prism messages for Z.AI Chat Completions.
 * Prior thinking blocks become `reasoning_content` when Preserved Thinking is active;
 * otherwise they are dropped (never flattened into visible text).
 * @see https://docs.z.ai/guides/capabilities/thinking-mode
 */
export function toZaiMessage(
  message: Message,
  model: ModelConfig,
  preserveThinking = false,
): JsonObject {
  const capabilities = model.capabilities ?? {};
  const thinkingParts = message.content.filter(
    (part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking",
  );
  const reasoningContent =
    preserveThinking && thinkingParts.length > 0
      ? thinkingParts.map((part) => part.text).join("\n")
      : undefined;

  if (message.role === "tool") {
    const result = message.content.find(
      (part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result",
    );
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }

  if (message.role === "assistant") {
    const toolCalls = message.content.filter(
      (part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call",
    );
    const textParts = message.content.filter(
      (part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text",
    );
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
      // Handled via reasoning_content when preserving; otherwise dropped.
      continue;
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

interface ZaiChunk {
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
  readonly usage?: unknown;
}
