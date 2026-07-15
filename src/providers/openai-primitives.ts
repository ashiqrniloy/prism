import type {
  ContentBlock,
  JsonObject,
  Message,
  ModelCapabilities,
  StructuredOutputOptions,
  ToolDefinition,
  Usage,
} from "../contracts.js";

export function assertOpenAIChatMessage(message: unknown, path: string): asserts message is Message {
  if (!message || typeof message !== "object") {
    throw new Error(`Invalid provider message at ${path}: expected object`);
  }
  const candidate = message as { role?: unknown; content?: unknown };
  if (typeof candidate.role !== "string") {
    throw new Error(`Invalid provider message at ${path}: expected role`);
  }
  if (!Array.isArray(candidate.content)) {
    throw new Error(`Invalid provider message at ${path}: expected content array`);
  }
}

export function serializeOpenAIChatStructuredOutput(options: StructuredOutputOptions): JsonObject {
  return {
    type: "json_schema",
    json_schema: {
      name: options.name,
      schema: options.schema,
      ...(options.strict === undefined ? {} : { strict: options.strict }),
    },
  };
}

export function serializeOpenAIResponsesStructuredOutput(options: StructuredOutputOptions): JsonObject {
  return {
    format: {
      type: "json_schema",
      name: options.name,
      schema: options.schema,
      ...(options.strict === undefined ? {} : { strict: options.strict }),
    },
  };
}

export function applyOpenAIChatStructuredOutput(
  body: Record<string, unknown>,
  structuredOutput?: StructuredOutputOptions,
): void {
  if (!structuredOutput) return;
  body.response_format = serializeOpenAIChatStructuredOutput(structuredOutput);
}

export function applyOpenAIResponsesStructuredOutput(
  body: Record<string, unknown>,
  structuredOutput?: StructuredOutputOptions,
): void {
  if (!structuredOutput) return;
  body.text = serializeOpenAIResponsesStructuredOutput(structuredOutput);
}

export function serializeOpenAITool(tool: ToolDefinition): JsonObject {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object" },
    },
  } as JsonObject;
}

export function serializeOpenAIChatMessage(message: Message, capabilities: ModelCapabilities = {}): JsonObject {
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
    const textParts = message.content.filter((part) => part.type === "text" || part.type === "thinking");
    if (toolCalls.length > 0) {
      return {
        role: "assistant",
        content: textParts.map((part) => part.text).join("\n") || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text" || part.type === "thinking") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`Provider ${message.role} message includes image but model does not declare image input capability`);
      }
      content.push(serializeOpenAIImage(part));
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`OpenAI Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call") {
      throw new Error("Provider assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("Provider tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text") {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
}

function serializeOpenAIImage(part: Extract<ContentBlock, { type: "image" }>): JsonObject {
  const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
  if (!url) throw new Error("Provider image block missing url or data");
  return { type: "image_url", image_url: { url } };
}

export function mapOpenAIChatUsage(usage: unknown): Usage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const wire = usage as OpenAIWireUsage;
  if (
    wire.prompt_tokens === undefined
    && wire.completion_tokens === undefined
    && wire.total_tokens === undefined
    && wire.prompt_cache_hit_tokens === undefined
    && wire.prompt_tokens_details?.cached_tokens === undefined
    && wire.prompt_tokens_details?.cache_write_tokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens: wire.prompt_tokens,
    outputTokens: wire.completion_tokens,
    totalTokens: wire.total_tokens,
    cacheReadTokens: wire.prompt_tokens_details?.cached_tokens ?? wire.prompt_cache_hit_tokens,
    cacheWriteTokens: wire.prompt_tokens_details?.cache_write_tokens,
  };
}

interface OpenAIWireUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_cache_hit_tokens?: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
    readonly cache_write_tokens?: number;
  };
}
