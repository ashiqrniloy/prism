import type {
  AIProvider,
  JsonObject,
  ProviderRequest,
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
  toolCallFromArgumentsText,
} from "../provider-events.js";
import {
  assertOpenAIChatMessage,
  applyOpenAIChatStructuredOutput,
  mapOpenAIChatUsage,
  serializeOpenAIChatMessage,
  serializeOpenAITool,
} from "./openai-primitives.js";
import {
  ProviderTransportError,
  readBoundedResponseText,
  readSseData,
} from "./transport.js";
import { assertStructuredOutputRequestSupported } from "../structured-output.js";

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
            ...request.options?.headers,
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(toOpenAIRequest(request)),
          signal: request.signal,
        });

        if (!response.ok) {
          yield providerError(
            new Error(`OpenAI-compatible request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
          return;
        }

        if (!response.body) {
          yield providerError(new Error("OpenAI-compatible response had no body"), secrets);
          return;
        }

        for await (const data of readSseData(response.body, { signal: request.signal })) {
          if (data === "[DONE]") break;
          const parsed = JSON.parse(data) as OpenAIStreamChunk;
          const usage = mapOpenAIChatUsage(parsed.usage);
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

        const incomplete = [...tools.entries()].find(([, call]) => !call.id || !call.name);
        if (incomplete) {
          yield providerError(
            new ProviderTransportError("incomplete_delta", `Incomplete tool call delta at index ${incomplete[0]}`),
            secrets,
          );
          return;
        }
        for (const call of tools.values()) {
          yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
        }
        yield providerDone();
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

function toOpenAIRequest(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const body: JsonObject = {
    model: request.model.model,
    messages: request.messages.map((message, index) => {
      assertOpenAIChatMessage(message, `messages[${index}]`);
      return serializeOpenAIChatMessage(message, request.model.capabilities ?? {});
    }),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    ...request.model.parameters,
  } as JsonObject;
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return body;
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
  readonly usage?: unknown;
}
