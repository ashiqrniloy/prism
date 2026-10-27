import type { JsonObject, ModelProvider, ProviderRequest, Usage } from "../contracts.js";
import { type CredentialValueSource } from "../credentials/index.js";
import { type AnthropicMessagesRouteHooks } from "./codecs/anthropic-messages.js";
import { type OpenAIChatCodecOptions } from "./codecs/openai-chat.js";
import { type OpenAIResponsesCodecOptions } from "./codecs/openai-responses.js";
/** Route definition for a multi-route or single-route provider. */
export type RoutedProviderFormat = "openai-chat" | "anthropic-messages" | "openai-responses";
export interface RoutedProviderRoute<TFormat extends RoutedProviderFormat = RoutedProviderFormat> {
    readonly format: TFormat;
    readonly path: string;
    readonly auth?: "bearer" | "x-api-key+bearer" | "api-key" | "none";
    readonly headers?: (request: ProviderRequest) => Record<string, string>;
    readonly affinity?: (request: ProviderRequest) => Record<string, string>;
    readonly codec?: TFormat extends "openai-chat" ? OpenAIChatCodecOptions : TFormat extends "openai-responses" ? OpenAIResponsesCodecOptions : AnthropicMessagesRouteHooks;
    readonly mapHttpError?: (response: Response, bodyText: string, secrets: readonly (string | undefined)[]) => Error;
    readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
    /** Custom URL builder overriding `${baseUrl}${path}`. */
    readonly url?: (request: ProviderRequest, baseUrl: string) => string;
}
/** Options for configuring a routed provider. */
export interface RoutedProviderOptions {
    readonly id?: string;
    readonly baseUrl: string;
    readonly apiKey?: CredentialValueSource;
    /** Resolves the credential per request. Takes precedence over `apiKey`. */
    readonly resolveApiKey?: (request: ProviderRequest) => string | undefined | Promise<string | undefined>;
    readonly fetch?: typeof fetch;
    readonly routes: Record<string, RoutedProviderRoute>;
    /** Selects route key for request. Defaults to `request.model.compat.route` falling back to first route. */
    readonly routeFor?: (request: ProviderRequest) => string;
    readonly require?: {
        /** Fail closed before any fetch if `request.options?.sessionId` is missing or empty. */
        readonly sessionId?: boolean;
    };
    readonly extraHeaders?: (request: ProviderRequest) => Record<string, string>;
    readonly requestFailedPrefix?: string;
    readonly mapHttpError?: (response: Response, bodyText: string, secrets: readonly (string | undefined)[]) => Error;
    readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
    readonly secrets?: (request: ProviderRequest) => readonly (string | undefined)[];
}
/** Pre-flight check asserting that an abort signal is not aborted. */
export declare function assertNotAborted(signal?: AbortSignal): void;
/** Resolves an API key from custom resolver or credential source. */
export declare function resolveProviderApiKey(source: CredentialValueSource | undefined, providerId: string, resolveCustom?: (request: ProviderRequest) => string | undefined | Promise<string | undefined>, request?: ProviderRequest): Promise<string | undefined>;
/**
 * Creates a ModelProvider that dispatches across protocol routes (OpenAI Chat,
 * Anthropic Messages, OpenAI Responses) based on model/request configuration.
 */
export declare function createRoutedProvider(options: RoutedProviderOptions): ModelProvider;
