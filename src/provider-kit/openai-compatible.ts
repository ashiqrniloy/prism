import type {
  JsonObject,
  Message,
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
  Usage,
} from "../contracts.js";
import type { CredentialValueSource } from "../credentials/index.js";
import { createRoutedProvider } from "./routed-provider.js";
import {
  type OpenAIChatCodecOptions,
  type OpenAIChatEventsOptions,
  buildOpenAIChatBody,
  openAIChatBody,
  openAIChatEvents,
} from "./codecs/openai-chat.js";

export { openAIChatEvents, openAIChatBody, buildOpenAIChatBody, type OpenAIChatEventsOptions };

export interface OpenAICompatibleProviderOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly apiKey?: CredentialValueSource;
  /** Resolves the key per request, from the request's `ModelSpec`. Wins over `apiKey`. */
  readonly resolveApiKey?: (request: ProviderRequest) => string | undefined | Promise<string | undefined>;
  readonly fetch?: typeof fetch;
  /** Override chat-completions URL (default `${baseUrl}/chat/completions`). */
  readonly chatCompletionsUrl?: string | ((request: ProviderRequest) => string);
  /** Default `bearer`. some resource-scoped keys use `api-key`; host-signed fetches may use `none`. */
  readonly authStyle?: "bearer" | "api-key" | "none";
  /** Extra provider-specific body fields (thinking/reasoning/cache); merged over the base body. */
  readonly buildBodyExtra?: (request: ProviderRequest) => JsonObject | undefined;
  /** Transform messages before serialization (e.g. cache-control markers). Defaults to `request.messages`. */
  readonly mapMessages?: (request: ProviderRequest) => readonly Message[];
  /** Custom message serializer (e.g. `reasoning_content` replay). Defaults to assert + `serializeOpenAIChatMessage`. */
  readonly serializeMessage?: (message: Message, request: ProviderRequest) => JsonObject;
  /** Custom usage mapping (e.g. provider cost fields). Defaults to `mapOpenAIChatUsage`. */
  readonly mapUsage?: (usage: unknown) => Usage | undefined;
  /** Extra request headers (merged over caller headers; provider auth/content-type still win). */
  readonly extraHeaders?: (request: ProviderRequest) => Record<string, string>;
  /** Final body transform applied last (token limits, compat stripping). Wins over everything. */
  readonly transformBody?: (body: JsonObject, request: ProviderRequest) => JsonObject;
  /** Require `[DONE]` and a `finish_reason` before emitting `done`; truncated streams yield an error. `done` then carries the final usage. Default `true` (fail-closed); set `false` explicitly to accept streams that end without completion evidence. */
  readonly strictCompletion?: boolean;
  /** Emit the final stream usage on the `done` event (without strict completion checks). */
  readonly doneUsage?: boolean;
  /** Prefix for HTTP error messages (default `OpenAI-compatible request failed`). */
  readonly requestFailedPrefix?: string;
  /** Custom HTTP error mapping (e.g. a provider's retry classification). Receives the response and redacted body text. */
  readonly mapHttpError?: (response: Response, bodyText: string, secrets: readonly (string | undefined)[]) => Error;
  /** Handle SSE comment lines in the stream (e.g. energy/cost telemetry). */
  readonly onComment?: (text: string) => ProviderEvent | undefined;
}

/** Subset of factory options that shape the request body. */
export type OpenAIChatBodyOptions = OpenAIChatCodecOptions;

/**
 * Creates an OpenAI-compatible provider as a single-route instance of `createRoutedProvider`.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): ModelProvider {
  const providerId = options.id ?? "openai-compatible";
  const auth = options.authStyle ?? "bearer";

  return createRoutedProvider({
    id: providerId,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    resolveApiKey: options.resolveApiKey,
    fetch: options.fetch,
    extraHeaders: options.extraHeaders,
    requestFailedPrefix: options.requestFailedPrefix,
    mapHttpError: options.mapHttpError,
    mapUsage: options.mapUsage,
    routes: {
      openai: {
        format: "openai-chat",
        path: "/chat/completions",
        auth,
        url: options.chatCompletionsUrl
          ? (req, baseUrl) =>
              typeof options.chatCompletionsUrl === "function"
                ? options.chatCompletionsUrl(req)
                : options.chatCompletionsUrl!
          : undefined,
        codec: {
          mapMessages: options.mapMessages,
          serializeMessage: options.serializeMessage,
          buildBodyExtra: options.buildBodyExtra,
          transformBody: options.transformBody,
          strictCompletion: options.strictCompletion,
          doneUsage: options.doneUsage,
          onComment: options.onComment,
        },
      },
    },
  });
}
