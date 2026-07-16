import type {
  JSONSchema7,
  LanguageModelV4CallOptions,
  LanguageModelV4FilePart,
  LanguageModelV4FunctionTool,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ReasoningPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolChoice,
  LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";
import type {
  ContentBlock,
  JsonObject,
  JsonValue,
  Message,
  ModelConfig,
  ProviderRequest,
  ProviderRequestOptions,
  ToolDefinition,
} from "@arnilo/prism";
import { AiSdkProviderError } from "./errors.js";

type UserPart = LanguageModelV4TextPart | LanguageModelV4FilePart;
type AssistantPart =
  | LanguageModelV4TextPart
  | LanguageModelV4FilePart
  | LanguageModelV4ReasoningPart
  | LanguageModelV4ToolCallPart;

export function toAiSdkCallOptions(request: ProviderRequest): LanguageModelV4CallOptions {
  const parameters = request.model.parameters ?? {};
  const options: LanguageModelV4CallOptions = {
    prompt: toAiSdkPrompt(request.messages, request.model),
    abortSignal: request.signal,
    tools: request.tools?.map(toAiSdkTool),
    toolChoice: request.tools?.length ? ({ type: "auto" } satisfies LanguageModelV4ToolChoice) : undefined,
    responseFormat: toResponseFormat(request.options),
    headers: sanitizeHeaders(request.options?.headers),
    maxOutputTokens: asFiniteNumber(parameters.maxTokens ?? parameters.maxOutputTokens),
    temperature: asFiniteNumber(parameters.temperature),
    topP: asFiniteNumber(parameters.topP),
    topK: asFiniteNumber(parameters.topK),
    presencePenalty: asFiniteNumber(parameters.presencePenalty),
    frequencyPenalty: asFiniteNumber(parameters.frequencyPenalty),
    stopSequences: asStringArray(parameters.stopSequences ?? parameters.stop),
    seed: asFiniteNumber(parameters.seed),
    providerOptions: toProviderOptions(request.options),
  };
  return stripUndefined(options);
}

export function toAiSdkPrompt(messages: readonly Message[], model: ModelConfig): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Message[] = [];
  for (const message of messages) {
    prompt.push(toAiSdkMessage(message, model));
  }
  return prompt;
}

function toAiSdkMessage(message: Message, model: ModelConfig): LanguageModelV4Message {
  if (message.role === "system") {
    return { role: "system", content: textOnlyContent(message.content, "system") };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content.map((part) => toToolResultPart(part)) };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content.map((part) => toAssistantPart(part, model)),
    };
  }
  return {
    role: "user",
    content: message.content.map((part) => toUserPart(part, model)),
  };
}

function toUserPart(part: ContentBlock, model: ModelConfig): UserPart {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image" || part.type === "file" || part.type === "document" || part.type === "audio") {
    return toFilePart(part, model);
  }
  throw unsupported(part.type, "user");
}

function toAssistantPart(part: ContentBlock, model: ModelConfig): AssistantPart {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "thinking") return { type: "reasoning", text: part.text };
  if (part.type === "tool_call") {
    return {
      type: "tool-call",
      toolCallId: part.id,
      toolName: part.name,
      input: part.arguments,
    };
  }
  if (part.type === "image" || part.type === "file" || part.type === "document") {
    return toFilePart(part, model);
  }
  throw unsupported(part.type, "assistant");
}

function toToolResultPart(part: ContentBlock): LanguageModelV4ToolResultPart {
  if (part.type !== "tool_result") {
    throw unsupported(part.type, "tool");
  }
  if (part.error) {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.name,
      output: {
        type: "error-text",
        value: part.error.message,
      },
    };
  }
  const value = part.result;
  if (isJsonValue(value)) {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.name,
      output: { type: "json", value },
    };
  }
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.name,
    output: {
      type: "text",
      value: value === undefined ? "" : String(value),
    },
  };
}

function toFilePart(
  part: Extract<ContentBlock, { type: "image" | "file" | "document" | "audio" }>,
  model: ModelConfig,
): LanguageModelV4FilePart {
  const capability =
    part.type === "image" ? "image"
      : part.type === "audio" ? "audio"
        : part.type === "document" ? "document"
          : "file";
  if (!model.capabilities?.input?.includes(capability) && !model.capabilities?.input?.includes("file")) {
    throw new AiSdkProviderError(
      "unsupported_content",
      `AI SDK adapter cannot send ${part.type} because model ${model.provider}/${model.model} does not declare ${capability} or file input capability`,
    );
  }
  if (part.resourceUri) {
    throw new AiSdkProviderError(
      "unsupported_content",
      `AI SDK adapter does not resolve resourceUri media; resolve ${part.type} content before provider invocation`,
    );
  }
  const mediaType = resolveMediaType(part);
  const filename = part.name;
  if (part.url) {
    return {
      type: "file",
      mediaType,
      filename,
      data: { type: "url", url: new URL(part.url) },
    };
  }
  if (part.data) {
    return {
      type: "file",
      mediaType,
      filename,
      data: { type: "data", data: part.data },
    };
  }
  throw new AiSdkProviderError(
    "unsupported_content",
    `AI SDK adapter ${part.type} block requires url or data`,
  );
}

function resolveMediaType(
  part: Extract<ContentBlock, { type: "image" | "file" | "document" | "audio" }>,
): string {
  if (part.type === "image") return part.mimeType ?? "image/png";
  return part.mediaType || (part.type === "audio" ? "audio/wav" : "application/octet-stream");
}

export function toAiSdkTool(tool: ToolDefinition): LanguageModelV4FunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.parameters ?? { type: "object", properties: {} }) as JSONSchema7,
  };
}

function toResponseFormat(options: ProviderRequestOptions | undefined): LanguageModelV4CallOptions["responseFormat"] {
  const structured = options?.structuredOutput;
  if (!structured) return undefined;
  return {
    type: "json",
    name: structured.name,
    schema: structured.schema as JSONSchema7,
  };
}

function toProviderOptions(options: ProviderRequestOptions | undefined): LanguageModelV4CallOptions["providerOptions"] {
  const compat = options?.compat;
  const extra = options?.extra;
  if (!compat && !extra) return undefined;
  const prism: Record<string, unknown> = {};
  if (compat) prism.compat = compat;
  if (extra) prism.extra = extra;
  return { prism: prism as JsonObject };
}

function textOnlyContent(content: readonly ContentBlock[], role: string): string {
  const texts: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      texts.push(part.text);
      continue;
    }
    throw unsupported(part.type, role);
  }
  return texts.join("\n");
}

function unsupported(type: string, role: string): never {
  throw new AiSdkProviderError(
    "unsupported_content",
    `AI SDK adapter does not support content type "${type}" on ${role} messages`,
  );
}

function sanitizeHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string | undefined> | undefined {
  if (!headers) return undefined;
  // Adapter-level headers are extension headers only. Host-owned AI SDK models
  // still own auth; callers cannot use this path to inject credentials into Prism.
  return { ...headers };
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === "string")) return undefined;
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (kind === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => item === undefined || isJsonValue(item));
  }
  return false;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
