import type { ContentBlock, JsonObject, Message, StructuredOutputOptions, ToolDefinition, Usage } from "../contracts.js";
import { canonicalizeJsonSchema } from "./schema.js";
import { type ToolNameMap, wireToolName } from "./tool-names.js";
import { normalizeUsage } from "./usage.js";

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

export function applyOpenAIChatStructuredOutput(body: Record<string, unknown>, structuredOutput?: StructuredOutputOptions): void {
  if (!structuredOutput) return;
  body.response_format = serializeOpenAIChatStructuredOutput(structuredOutput);
}

export function serializeOpenAITool(tool: ToolDefinition, names?: ToolNameMap): JsonObject {
  return {
    type: "function",
    function: {
      name: wireToolName(tool.name, names),
      description: tool.description,
      parameters: canonicalizeJsonSchema(tool.parameters ?? { type: "object" }) as JsonObject,
    },
  } as JsonObject;
}

/**
 * Rendered in place of a tool-result image when the model declares no image input. Every route can
 * carry this note as text, so an image result never turns into a request the vendor rejects.
 */
export const OMITTED_TOOL_RESULT_IMAGE_NOTE = "[image omitted: the model does not accept images]";

/** Tool-result payload as the model should read it: text stays text, structured values stay JSON. */
export function serializeToolResultText(message: Message): string {
  const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
  if (!result) return "";
  // A text part after the tool_result is a provider-view insertion (a nested instruction file), not
  // part of the result; append it so every codec carries it outside the result envelope.
  const trailing = message.content
    .filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n");
  const prefix =
    result.result !== undefined
      ? typeof result.result === "string"
        ? result.result
        : JSON.stringify(result.result)
      : // An error is its message; JSON-escaping it only added backslashes the model had to read.
        result.error?.message;
  if (prefix === undefined) return trailing;
  return trailing ? `${prefix}\n${trailing}` : prefix;
}

export { serializeOpenAIChatMessage } from "./codecs/openai-chat.js";

export function mapOpenAIChatUsage(usage: unknown): Usage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const wire = usage as OpenAIWireUsage;
  return normalizeUsage({
    inputTokens: wire.prompt_tokens,
    outputTokens: wire.completion_tokens,
    totalTokens: wire.total_tokens,
    cacheReadTokens: wire.prompt_tokens_details?.cached_tokens ?? wire.prompt_cache_hit_tokens,
    // Some OpenAI-compatible vendors report cache writes as `cache_write_tokens`,
    // others as the `cache_creation_input_tokens` variant; accept both.
    // Command Code reports the write count at the top level of `usage`, beside `prompt_tokens`.
    cacheWriteTokens:
      wire.prompt_tokens_details?.cache_write_tokens ??
      wire.prompt_tokens_details?.cache_creation_input_tokens ??
      wire.cache_creation_input_tokens,
  });
}

interface OpenAIWireUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_cache_hit_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
    readonly cache_write_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}
