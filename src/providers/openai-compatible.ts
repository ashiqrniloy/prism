import type { AIProvider, JsonObject, Message, ProviderEvent, ProviderRequest, Usage } from "../contracts.js";
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
import { httpStatusError, ProviderTransportError, readBoundedResponseText, readSseEvents } from "./transport.js";

export interface OpenAICompatibleProviderOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Override chat-completions URL (default `${baseUrl}/chat/completions`). */
  readonly chatCompletionsUrl?: string | ((request: ProviderRequest) => string);
  /** Default `bearer`. Azure resource keys use `api-key`; host-signed fetches may use `none`. */
  readonly authStyle?: "bearer" | "api-key" | "none";
  /** Extra provider-specific body fields (thinking/reasoning/cache); merged over the base body. */
  readonly buildBodyExtra?: (request: ProviderRequest) => JsonObject | undefined;
  /** Transform messages before serialization (e.g. cache-control markers). Defaults to `request.messages`. */
  readonly mapMessages?: (request: ProviderRequest) => readonly Message[];
  /** Custom message serializer (e.g. Z.AI `reasoning_content` replay). Defaults to assert + `serializeOpenAIChatMessage`. */
  readonly serializeMessage?: (message: Message, request: ProviderRequest) => JsonObject;
  /** Custom usage mapping (e.g. OpenRouter cost fields). Defaults to `mapOpenAIChatUsage`. */
  readonly mapUsage?: (usage: unknown) => Usage | undefined;
  /** Extra request headers (merged over caller headers; provider auth/content-type still win). */
  readonly extraHeaders?: (request: ProviderRequest) => Record<string, string>;
  /** Final body transform applied last (token limits, compat stripping). Wins over everything. */
  readonly transformBody?: (body: JsonObject, request: ProviderRequest) => JsonObject;
  /** Require `[DONE]` and a `finish_reason` before emitting `done`; truncated streams yield an error. `done` then carries the final usage. */
  readonly strictCompletion?: boolean;
  /** Emit the final stream usage on the `done` event (without strict completion checks). */
  readonly doneUsage?: boolean;
  /** Prefix for HTTP error messages (default `OpenAI-compatible request failed`). */
  readonly requestFailedPrefix?: string;
  /** Custom HTTP error mapping (e.g. NeuralWatt retry classification). Receives the response and redacted body text. */
  readonly mapHttpError?: (response: Response, bodyText: string, secrets: readonly (string | undefined)[]) => Error;
  /** Handle SSE comment lines in the stream (e.g. NeuralWatt energy/cost telemetry). */
  readonly onComment?: (text: string) => ProviderEvent | undefined;
}

export interface OpenAIChatEventsOptions {
  readonly signal?: AbortSignal;
  /** Require `[DONE]` and a `finish_reason`; `done` then carries the final usage. */
  readonly strictCompletion?: boolean;
  /** Emit the final stream usage on the `done` event. */
  readonly doneUsage?: boolean;
  readonly mapUsage?: (usage: unknown) => Usage | undefined;
  /** Handle an SSE comment line (text after `:`), e.g. NeuralWatt `: energy` / `: cost` telemetry. Returned events are yielded in stream order before the data of the same SSE event. */
  readonly onComment?: (text: string) => ProviderEvent | undefined;
}

/**
 * Shared OpenAI Chat Completions SSE stream loop: maps `data:` frames to Prism
 * `ProviderEvent` values (text/thinking deltas, tool-call fragments, usage, done/error).
 */
export async function* openAIChatEvents(
  body: ReadableStream<Uint8Array>,
  options: OpenAIChatEventsOptions = {},
): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  let sawDoneMarker = false;
  let sawFinishReason = false;
  for await (const sseEvent of readSseEvents(body, { signal: options.signal })) {
    if (options.onComment && sseEvent.comments?.length) {
      for (const text of sseEvent.comments) {
        const commentEvent = options.onComment(text);
        if (commentEvent) yield commentEvent;
      }
    }
    const data = sseEvent.data.trim();
    if (!data) continue;
    if (data === "[DONE]") {
      sawDoneMarker = true;
      break;
    }
    let parsed: OpenAIStreamChunk;
    try {
      parsed = JSON.parse(data) as OpenAIStreamChunk;
    } catch (error) {
      // Malformed chunks are terminal: yield the error instead of crashing the generator.
      yield providerError(error, []);
      return;
    }
    const mapped = (options.mapUsage ?? mapOpenAIChatUsage)(parsed.usage);
    if (mapped) {
      usage = mapped;
      yield providerUsage(mapped);
    }

    for (const choice of parsed.choices ?? []) {
      if (choice.finish_reason) sawFinishReason = true;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) yield providerTextDelta(delta.content);
      const thinking = delta.reasoning ?? delta.reasoning_content;
      if (typeof thinking === "string" && thinking) {
        yield providerThinkingDelta(thinking);
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
    yield providerError(new ProviderTransportError("incomplete_delta", `Incomplete tool call delta at index ${incomplete[0]}`));
    return;
  }
  if (options.strictCompletion && (!sawDoneMarker || !sawFinishReason)) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(
      new Error(
        `Chat stream ended without completion evidence ` +
          `([DONE]: ${sawDoneMarker ? "received" : "missing"}, ` +
          `finish_reason: ${sawFinishReason ? "received" : "missing"})`,
      ),
    );
    return;
  }
  for (const call of tools.values()) {
    yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
  }
  yield providerDone(options.strictCompletion || options.doneUsage ? usage : undefined);
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
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const apiKey = await resolveCredentialValue(options.apiKey, {
        name: "apiKey",
        provider: providerId,
      });
      const fetchImpl = options.fetch ?? fetch;
      const secrets = [apiKey];

      try {
        const url =
          typeof options.chatCompletionsUrl === "function"
            ? options.chatCompletionsUrl(request)
            : (options.chatCompletionsUrl ?? `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`);
        const authStyle = options.authStyle ?? "bearer";
        const headers: Record<string, string> = {
          ...Object.fromEntries(
            Object.entries(request.options?.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          ),
          ...options.extraHeaders?.(request),
          "content-type": "application/json",
        };
        if (apiKey && authStyle === "api-key") headers["api-key"] = apiKey;
        if (apiKey && authStyle === "bearer") headers.authorization = `Bearer ${apiKey}`;
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(toOpenAIRequest(request, options)),
          signal: request.signal,
        });

        if (!response.ok) {
          const bodyText = await readBoundedResponseText(response, { secrets });
          const error = options.mapHttpError
            ? options.mapHttpError(response, bodyText, secrets)
            : httpStatusError(options.requestFailedPrefix ?? "OpenAI-compatible request failed", response, bodyText);
          yield providerError(error, secrets);
          return;
        }

        if (!response.body) {
          yield providerError(new Error("OpenAI-compatible response had no body"), secrets);
          return;
        }

        yield* openAIChatEvents(response.body, {
          signal: request.signal,
          strictCompletion: options.strictCompletion,
          doneUsage: options.doneUsage,
          mapUsage: options.mapUsage,
          onComment: options.onComment,
        });
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

/** Subset of factory options that shape the request body. */
export type OpenAIChatBodyOptions = Pick<
  OpenAICompatibleProviderOptions,
  "mapMessages" | "serializeMessage" | "buildBodyExtra" | "transformBody"
>;

function toOpenAIRequest(request: ProviderRequest, options: OpenAIChatBodyOptions): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const body: JsonObject = {
    model: request.model.model,
    messages: (options.mapMessages?.(request) ?? request.messages).map((message, index) => {
      if (options.serializeMessage) return options.serializeMessage(message, request);
      assertOpenAIChatMessage(message, `messages[${index}]`);
      return serializeOpenAIChatMessage(message, request.model.capabilities ?? {});
    }),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    ...request.model.parameters,
  } as JsonObject;
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  const merged = { ...body, ...options.buildBodyExtra?.(request) };
  return options.transformBody ? options.transformBody(merged, request) : merged;
}

/** Base Chat Completions request body builder, exported for provider packages keeping public body helpers. */
export function buildOpenAIChatBody(request: ProviderRequest, options: OpenAIChatBodyOptions = {}): JsonObject {
  return toOpenAIRequest(request, options);
}

interface OpenAIStreamChunk {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      /** OpenRouter reasoning field (newer alias of `reasoning_content`). */
      readonly reasoning?: string;
      readonly tool_calls?: readonly {
        readonly index?: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
  }[];
  readonly usage?: unknown;
}
