import type { CredentialValueSource, ModelProvider, ProviderRequest } from "@arnilo/prism";
import {
  createRoutedProvider,
  sanitizeCacheKey,
  type RoutedProviderRoute,
} from "@arnilo/prism/provider-kit";
import { OPENCODE_GO_DEFAULT_BASE_URL, type OpenCodeGoRoute, routeForOpenCodeGoModel } from "./models.js";

/** `x-opencode-session` accepted length cap (OpenCode server session id). */
export const OPENCODE_SESSION_ID_MAX_LENGTH = 128;

/**
 * Derives the `x-opencode-session` affinity header from the request's sanitized cacheKey or sessionId.
 */
export function opencodeSession(request: ProviderRequest): Record<string, string> {
  const session = sanitizeCacheKey(
    request.options?.cacheKey ?? request.options?.sessionId,
    OPENCODE_SESSION_ID_MAX_LENGTH,
  );
  return session ? { "x-opencode-session": session } : {};
}

export const OPENCODE_GO_CHAT_ROUTE: RoutedProviderRoute<"openai-chat"> = {
  format: "openai-chat",
  path: "/chat/completions",
  auth: "bearer",
  affinity: opencodeSession,
  codec: {
    reasoningReplay: "reasoning_content",
    imageInput: "capability-gated",
  },
};

export const OPENCODE_GO_MESSAGES_ROUTE: RoutedProviderRoute<"anthropic-messages"> = {
  format: "anthropic-messages",
  path: "/messages",
  auth: "x-api-key+bearer",
  affinity: opencodeSession,
};

export interface OpenCodeGoProviderOptions {
  readonly id?: string;
  /** Defaults to official `https://opencode.ai/zen/go/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createOpenCodeGoProvider(options: OpenCodeGoProviderOptions = {}): ModelProvider {
  return createRoutedProvider({
    id: options.id ?? "opencode-go",
    baseUrl: options.baseUrl ?? OPENCODE_GO_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    fetch: options.fetch,
    require: { sessionId: true },
    routeFor: (r) => (r.model.compat?.route as OpenCodeGoRoute | undefined) ?? routeForOpenCodeGoModel(r.model.model),
    routes: {
      openai: OPENCODE_GO_CHAT_ROUTE,
      anthropic: OPENCODE_GO_MESSAGES_ROUTE,
    },
  });
}
