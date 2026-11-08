import type { ModelProvider, ProviderRequest } from "@arnilo/prism";
import {
  createRoutedProvider,
  OPENAI_RESPONSES_UNSUPPORTED_FIELDS,
  type RoutedProviderRoute,
  sanitizeCacheKey,
  type SecretSource,
} from "@arnilo/prism/provider-kit";
import { openAICodexHttpError } from "./errors.js";
import { OPENAI_CODEX_DEFAULT_BASE_URL, OPENAI_CODEX_ROUTE } from "./models.js";
import { type OpenAICodexCredentialSlot, openAICodexApiKey } from "./oauth.js";

/** `session_id` / `x-client-request-id` accepted length cap (pi parity, `openai-responses.js:224-232`). */
export const OPENAI_CODEX_SESSION_ID_MAX_LENGTH = 128;

/**
 * Cache and routing affinity: both headers carry the sanitized session key, so a request from the
 * same session lands on the same backend and reuses the same prompt cache. An absent key sends none.
 */
export function openAICodexAffinity(request: ProviderRequest): Record<string, string> {
  const session = sanitizeCacheKey(request.options?.cacheKey ?? request.options?.sessionId, OPENAI_CODEX_SESSION_ID_MAX_LENGTH);
  return session ? { session_id: session, "x-client-request-id": session } : {};
}

/** The one route: a stateless `POST /responses` with the grant's bearer token. */
export const OPENAI_CODEX_RESPONSES_ROUTE: RoutedProviderRoute<"openai-responses"> = {
  format: "openai-responses",
  path: "/responses",
  auth: "bearer",
  affinity: openAICodexAffinity,
  codec: {
    // Nothing is stored server-side, so reasoning travels as an encrypted item the next turn replays.
    store: false,
    include: ["reasoning.encrypted_content"],
    reasoningSummary: "auto",
    imageInput: "capability-gated",
    // A field the route refuses is deleted after the body is built, so model `parameters` and caller
    // `extra` cannot re-add it.
    omitFields: OPENAI_RESPONSES_UNSUPPORTED_FIELDS,
  },
  mapHttpError: openAICodexHttpError,
};

export interface OpenAICodexProviderOptions {
  readonly id?: string;
  /** Defaults to {@link OPENAI_CODEX_DEFAULT_BASE_URL}. */
  readonly baseUrl?: string;
  /** The grant's access token, refreshed by the caller's source. */
  readonly apiKey?: SecretSource;
  /**
   * A writable `keyring:` ref holding the grant. With {@link credentialSource} the provider refreshes
   * and persists it itself, so a caller outside a package setup (a probe, a script) needs no host.
   */
  readonly credential?: string;
  /** The slot {@link credential} is read from and rotated into. */
  readonly credentialSource?: OpenAICodexCredentialSlot;
  readonly fetch?: typeof fetch;
}

export function createOpenAICodexProvider(options: OpenAICodexProviderOptions = {}): ModelProvider {
  const apiKey =
    options.apiKey ??
    (options.credential
      ? openAICodexApiKey({
          credential: options.credential,
          ...(options.credentialSource ? { slot: options.credentialSource } : {}),
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        })
      : undefined);
  return createRoutedProvider({
    id: options.id ?? "openai-codex",
    baseUrl: options.baseUrl ?? OPENAI_CODEX_DEFAULT_BASE_URL,
    apiKey,
    fetch: options.fetch,
    requestFailedPrefix: "openai-codex",
    routes: { [OPENAI_CODEX_ROUTE]: OPENAI_CODEX_RESPONSES_ROUTE },
  });
}
