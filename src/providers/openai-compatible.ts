import type {
  AIProvider,
  JsonObject,
  Message,
  ProviderEvent,
  ProviderRequest,
  ToolDefinition,
  Usage,
} from "../contracts.js";
import { resolveCredentialValue, type CredentialValueSource } from "../credentials.js";
import {
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
} from "../provider-events.js";
import { redactSecrets } from "../redaction.js";

export interface OpenAICompatibleProviderOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): AIProvider {
  const providerId = options.id ?? "openai-compatible";

  return {
    id: providerId,
    async *generate(request) {
      const apiKey = await resolveCredentialValue(options.apiKey, {
        name: "apiKey",
        provider: providerId,
      });
      const fetchImpl = options.fetch ?? fetch;
      const secrets = [apiKey];
      const tools = new Map<number, ToolAccumulator>();

      try {
        const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(toOpenAIRequest(request)),
          signal: request.signal,
        });

        if (!response.ok) {
          yield providerError(new Error(`OpenAI-compatible request failed: ${response.status} ${await safeText(response)}`), secrets);
          return;
        }

        if (!response.body) {
          yield providerError(new Error("OpenAI-compatible response had no body"), secrets);
          return;
        }

        for await (const data of readSseData(response.body)) {
          if (data === "[DONE]") break;
          const parsed = JSON.parse(data) as OpenAIStreamChunk;
          const usage = toUsage(parsed.usage);
          if (usage) yield providerUsage(usage);

          for (const choice of parsed.choices ?? []) {
            const delta = choice.delta ?? {};
            if (typeof delta.content === "string" && delta.content) yield providerTextDelta(delta.content);
            if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
              yield providerThinkingDelta(delta.reasoning_content);
            }
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
          if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
        }
        yield providerDone();
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

function toOpenAIRequest(request: ProviderRequest): JsonObject {
  return {
    model: request.model.model,
    messages: request.messages.map(toOpenAIMessage),
    tools: request.tools?.map(toOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    ...request.model.parameters,
  } as JsonObject;
}

function toOpenAIMessage(message: Message): JsonObject {
  return {
    role: message.role === "tool" ? "tool" : message.role,
    content: message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
  };
}

function toOpenAITool(tool: ToolDefinition): JsonObject {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object" },
    },
  } as JsonObject;
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) yield line.slice(6).trim();
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    if (line.startsWith("data: ")) yield line.slice(6).trim();
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return redactSecrets(await response.text(), []);
  } catch {
    return "";
  }
}

function parseArgs(text: string): JsonObject {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
}

function toUsage(usage: OpenAIUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

interface OpenAIStreamChunk {
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
  readonly usage?: OpenAIUsage;
}

interface OpenAIUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}
