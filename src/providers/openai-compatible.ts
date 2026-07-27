import type { AIProvider, JsonObject, ProviderRequest } from "../contracts.js";
import { type CredentialValueSource, resolveCredentialValue } from "../credentials.js";
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
import { assertStructuredOutputRequestSupported } from "../structured-output.js";
import {
  applyOpenAIChatStructuredOutput,
  assertOpenAIChatMessage,
  mapOpenAIChatUsage,
  serializeOpenAIChatMessage,
  serializeOpenAITool,
} from "./openai-primitives.js";
import { ProviderTransportError, readBoundedResponseText, readSseData } from "./transport.js";

export interface OpenAICompatibleProviderOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Override chat-completions URL (default `${baseUrl}/chat/completions`). */
  readonly chatCompletionsUrl?: string | ((request: ProviderRequest) => string);
  /** Default `bearer`. Azure resource keys use `api-key`; host-signed fetches may use `none`. */
  readonly authStyle?: "bearer" | "api-key" | "none";
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
        const url =
          typeof options.chatCompletionsUrl === "function"
            ? options.chatCompletionsUrl(request)
            : (options.chatCompletionsUrl ?? `${options.baseUrl.replace(/\/$/, "")}/chat/completions`);
        const authStyle = options.authStyle ?? "bearer";
        const headers: Record<string, string> = {
          ...Object.fromEntries(
            Object.entries(request.options?.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          ),
          "content-type": "application/json",
        };
        if (apiKey && authStyle === "api-key") headers["api-key"] = apiKey;
        if (apiKey && authStyle === "bearer") headers.authorization = `Bearer ${apiKey}`;
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
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
