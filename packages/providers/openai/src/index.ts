/**
 * `@arnilo/prism-provider-openai` — the OpenAI Responses and Codex provider package.
 *
 * ```ts
 * import openai from "@arnilo/prism-provider-openai";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai/gpt-5.2",
 *   packages: [openai({ apiKey: "env:OPENAI_API_KEY" })],
 * });
 * ```
 *
 * Both keys are refs (`env:`/`keyring:`), never values: they resolve through the credentials slot on
 * every request. A ref that resolves to nothing records a `warn` status note and registers anyway, so
 * `agent.models` still lists the catalogs; a run then fails with `credential_unavailable`.
 *
 * Codex OAuth ships as an `auth` descriptor on the `openai-codex` provider. The descriptor wraps the
 * legacy `OAuthProvider`: `login` drives it through `ctx.host` (`open-url`, `input`) and persists the
 * tokens through `ctx.credentials.store`. Without a UI it throws {@link OAuthUnavailableError}; it
 * never spawns a process and never opens a browser itself.
 */
import { type HostPort, type JsonSchema, type ModelConfig, type OAuthLoginCallbacks, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  createOpenAIResponsesProvider,
  defineProviderPackage,
  modelsProperty,
  oauthCredentialsToSecret,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";

import { createOpenAICodexProvider } from "./codex.js";
import { listOpenAIModels, openAICodexModels } from "./models.js";
import { createOpenAICodexOAuthProvider, type OpenAICodexOAuthOptions } from "./oauth.js";

export {
  createOpenAIBatchJobsProvider,
  OPENAI_BATCH_COMPLETION_WINDOW,
  OPENAI_BATCH_MAX_REQUESTS,
  type OpenAIBatchJobsOptions,
} from "./batch.js";
export {
  applyPromptCacheBreakpoints,
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
  promptCacheKey,
  promptCacheOptions,
  promptCacheRetention,
} from "@arnilo/prism/provider-kit";
export { createOpenAICodexProvider, type OpenAICodexProviderOptions } from "./codex.js";
export {
  createOpenAIEmbeddingsProvider,
  OPENAI_EMBEDDINGS_MAX_BATCH_SIZE,
  type OpenAIEmbeddingsOptions,
} from "./embeddings.js";
export {
  createOpenAIImageGenerationProvider,
  DEFAULT_IMAGE_MAX_BYTES,
  OPENAI_IMAGE_MAX_COUNT,
  OPENAI_IMAGE_PROMPT_MAX_CHARS,
  type OpenAIImageGenerationOptions,
} from "./images.js";
export {
  defineOpenAIModel,
  type ListOpenAIModelsOptions,
  listOpenAIModels,
  mapOpenAIModel,
  type OpenAIModelConfig,
  type OpenAIModelEntry,
  openAICodexModels,
  openAIModels,
} from "./models.js";
export { openAIDefaultEffort, openAIThinkingLevels } from "@arnilo/prism/provider-kit";
export {
  createOpenAIModerationProvider,
  OPENAI_MODERATION_DEFAULT_MODEL,
  OPENAI_MODERATION_INPUT_MAX_CHARS,
  OPENAI_MODERATION_MAX_RESPONSE_BYTES,
  type OpenAIModerationOptions,
} from "./moderation.js";
export {
  computeS256Challenge,
  createOpenAICodexOAuthProvider,
  createPkceVerifier,
  type OpenAICodexOAuthOptions,
  openAICodexOAuthProvider,
} from "./oauth.js";
export {
  createOpenAIRealtimeSession,
  type OpenAIRealtimeSessionOptions,
  type OpenAIRealtimeTool,
  type RealtimeTransport,
  type RealtimeTransportOptions,
} from "./realtime.js";
export { createOpenAIResponsesProvider, type OpenAIResponsesProviderOptions, resolveOpenAIReasoning } from "@arnilo/prism/provider-kit";
export {
  createOpenAISpeechProvider,
  DEFAULT_SPEECH_MAX_AUDIO_BYTES,
  OPENAI_SPEECH_MAX_INPUT_CHARS,
  type OpenAISpeechOptions,
} from "./speech.js";
export {
  createOpenAITranscriptionProvider,
  OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES,
  type OpenAITranscriptionOptions,
} from "./transcription.js";

/** The `apiKey` ref used when config names none. */
export const OPENAI_DEFAULT_API_KEY_REF = "env:OPENAI_API_KEY";

/** The `codexAccessToken` ref used when config names none. */
export const OPENAI_CODEX_DEFAULT_ACCESS_TOKEN_REF = "keyring:openai-codex";

/** Thrown when a login needs a host surface the host does not have (fail closed, never guess). */
export class OAuthUnavailableError extends Error {
  readonly code = "oauth_unavailable";
  constructor(readonly request: string) {
    super(`OpenAI Codex login needs host ${request}, but the host answered unavailable`);
    this.name = "OAuthUnavailableError";
  }
}

export interface OpenAIProviderPackageOptions {
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  /** Overrides the Codex subscription base URL. */
  readonly codexBaseUrl?: string;
  /** Test seam for the OAuth flow (`fetch`, `now`, `sleep`, endpoint overrides). */
  readonly oauth?: OpenAICodexOAuthOptions;
}

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface OpenAIProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link OPENAI_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official Responses base; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  /** Ref holding the Codex OAuth access token; the OAuth login writes it. */
  readonly codexAccessToken?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(OPENAI_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official Responses base; defaults to https://api.openai.com/v1."),
    codexAccessToken: secretRefProperty(
      OPENAI_CODEX_DEFAULT_ACCESS_TOKEN_REF,
      "Ref holding the Codex OAuth access token; the OAuth login writes it.",
    ),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

/** The `HostUi` requests the OAuth flow needs, or `OAuthUnavailableError` when the host has no UI. */
function hostCallbacks(host: HostPort): OAuthLoginCallbacks {
  const ui = host.ui;
  const require = async (request: Parameters<NonNullable<HostPort["ui"]>["request"]>[0]): Promise<unknown> => {
    const answer = await ui?.request(request as never);
    if (answer === undefined || answer.status === "unavailable") throw new OAuthUnavailableError(request.kind);
    return answer;
  };
  return {
    async onAuth(url) {
      await require({ kind: "open-url", title: "Sign in to OpenAI", url });
    },
    async onDeviceCode(code) {
      await require({ kind: "open-url", title: `OpenAI device code ${code.userCode}`, url: code.verificationUri });
    },
    async onPrompt(message) {
      const answer = (await require({ kind: "input", title: message })) as { status: "answered" | "dismissed"; value?: unknown };
      return answer.status === "answered" ? String(answer.value ?? "") : undefined;
    },
  };
}

function definitionFor(options: OpenAIFactoryOptions) {
  return defineProviderPackage<OpenAIProviderConfig>({
    name: "@arnilo/prism-provider-openai",
    description: "OpenAI Responses and Codex provider package for Prism.",
    capabilities: ["credentials", "host-ui"],
    config: configSchema,
    setup: async (prism) => {
      const resolve = (ref: string) => prism.credentials.resolve(ref);
      const apiKeyRef = prism.config.apiKey ?? OPENAI_DEFAULT_API_KEY_REF;
      const codexRef = prism.config.codexAccessToken ?? OPENAI_CODEX_DEFAULT_ACCESS_TOKEN_REF;
      const apiKey = refSource(resolve, apiKeyRef);
      const codexAccessToken = refSource(resolve, codexRef);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalogs should still list. The note is what a host shows the user.
      for (const [vendor, ref] of [
        ["openai", apiKeyRef],
        ["openai-codex", codexRef],
      ] as const) {
        if ((await resolve(ref)) === undefined) prism.status.note("warn", `${vendor}: no API key at ${ref}`);
      }

      const baseUrl = prism.config.baseUrl;
      const responses = createOpenAIResponsesProvider({ apiKey, baseUrl, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...responses,
        async models() {
          if (configured !== undefined) return configured;
          return listOpenAIModels({ provider: responses.id, baseUrl, apiKey, fetch: options.fetch });
        },
      });

      const oauth = createOpenAICodexOAuthProvider(options.oauth);
      const codex = createOpenAICodexProvider({
        accessToken: codexAccessToken,
        baseUrl: options.codexBaseUrl,
        fetch: options.fetch,
      });
      prism.providers.register({
        ...codex,
        auth: [
          {
            kind: "oauth",
            id: "openai-codex",
            async login(ctx) {
              const credentials = await oauth.login(hostCallbacks(ctx.host));
              await ctx.credentials.store(codexRef, oauthCredentialsToSecret(credentials));
            },
          },
        ],
        async models() {
          return openAICodexModels;
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `openai({ ... })`. */
export default definition;

/** Factory-only options: `fetch`, `codexBaseUrl`, `oauth`. Credential config stays JSON. */
export type OpenAIFactoryOptions = Pick<OpenAIProviderPackageOptions, "fetch" | "codexBaseUrl" | "oauth">;

/** Instance with factory-only options; `apiKey`/`codexAccessToken`/`baseUrl`/`models` are validated config. */
export function openai(options: OpenAIProviderPackageOptions & OpenAIProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["fetch", "codexBaseUrl", "oauth"], options);
}
