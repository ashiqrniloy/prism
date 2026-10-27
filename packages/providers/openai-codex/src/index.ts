/**
 * `@arnilo/prism-provider-openai-codex` — OpenAI models on a ChatGPT plan via Sign in with ChatGPT:
 * registers the `openai-codex` provider, keeps an OAuth grant in a `keyring:` ref, refreshes it per
 * request, and ships the stateless Responses wire plus the model catalog.
 *
 * ```ts
 * import openaiCodex from "@arnilo/prism-provider-openai-codex";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai-codex/gpt-6.1-sol",
 *   packages: [openaiCodex({ appName: "My Host" })],
 * });
 * ```
 *
 * The credential is a ref (`keyring:`), never a value: it resolves through the credentials slot on
 * every request, and a grant within five minutes of expiry is refreshed first. A missing or
 * unreadable record records a `warn` status note and still registers the provider, so the catalog
 * lists and a run fails with a sign-in error instead of `Unknown provider`. The host runs the
 * sign-in: this package declares the `oauth` `AuthMethod`, and nothing in the kernel runs it.
 */
import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";
import { listOpenAICodexModels } from "./models.js";
import { assertWritableCredentialRef, credentialRecordFromSecret, openAICodexApiKey, openAICodexAuth } from "./oauth.js";
import { createOpenAICodexProvider } from "./provider.js";

/** The ref a sign-in writes; overridable for a host that keeps its grants elsewhere. */
export const OPENAI_CODEX_DEFAULT_CREDENTIAL_REF = "keyring:openai-codex";

/** The config a host (or a code instance) may set. The credential is a ref, never a value. */
export interface OpenAICodexProviderConfig {
  /** A writable `keyring:` ref holding the grant; defaults to {@link OPENAI_CODEX_DEFAULT_CREDENTIAL_REF}. */
  readonly credential?: string;
  /** The host's name for this app, sent as `agent_name_hint` on first sign-in. Required to sign in. */
  readonly appName?: string;
  /** Defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks `GET /models` with the grant. */
  readonly models?: readonly ModelConfig[];
  /** Loopback port to try first; defaults to 1455, falling back to an ephemeral port. */
  readonly callbackPort?: number;
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface OpenAICodexProviderPackageOptions {
  /** Provider id; defaults to `openai-codex`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  /** `listen` (default) binds the loopback listener; `paste` waits for a pasted callback URL only. */
  readonly callback?: "listen" | "paste";
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    credential: secretRefProperty(
      OPENAI_CODEX_DEFAULT_CREDENTIAL_REF,
      "A writable `keyring:` ref holding the OAuth grant. An `env:` ref is refused.",
    ),
    appName: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "The host's name for this app, sent as `agent_name_hint` on first sign-in.",
    },
    baseUrl: baseUrlProperty("Defaults to `https://api.openai.com/v1`."),
    models: modelsProperty("Static catalog. When absent, `models()` asks `GET /models` with the grant."),
    callbackPort: { type: "integer", minimum: 0, maximum: 65535, description: "Loopback port to try first; defaults to 1455." },
  },
  additionalProperties: false,
};

function definitionFor(options: OpenAICodexProviderPackageOptions) {
  return defineProviderPackage<OpenAICodexProviderConfig>({
    name: "@arnilo/prism-provider-openai-codex",
    description: "OpenAI Codex provider package for Prism: ChatGPT plan models via Sign in with ChatGPT.",
    capabilities: ["credentials", "credentials:write"],
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "openai-codex";
      const credential = prism.config.credential ?? OPENAI_CODEX_DEFAULT_CREDENTIAL_REF;
      // A sign-in writes this ref, so an `env:` ref can never work: fail at load, not at login.
      assertWritableCredentialRef(credential);
      const slot = {
        resolve: (ref: string) => prism.credentials.resolve(ref),
        ...(prism.credentials.store
          ? {
              store: (ref: string, secret: Parameters<NonNullable<typeof prism.credentials.store>>[1]) =>
                prism.credentials.store!(ref, secret),
            }
          : {}),
        ...(prism.credentials.delete ? { delete: (ref: string) => prism.credentials.delete!(ref) } : {}),
      };
      const auth = openAICodexAuth({
        credential,
        ...(prism.config.appName !== undefined ? { appName: prism.config.appName } : {}),
        ...(prism.config.callbackPort !== undefined ? { callbackPort: prism.config.callbackPort } : {}),
        ...(options.callback !== undefined ? { callback: options.callback } : {}),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
        slot,
      });
      const apiKey = openAICodexApiKey({ credential, slot, ...(options.fetch !== undefined ? { fetch: options.fetch } : {}) });
      // Register regardless: a missing grant must not turn into `Unknown provider`, and the catalog
      // should still list. The note is what a host shows the user.
      if (credentialRecordFromSecret(await prism.credentials.resolve(credential)) === undefined)
        prism.status.note("warn", "openai-codex: not signed in");
      const baseUrl = prism.config.baseUrl;
      const provider = createOpenAICodexProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        auth: [auth],
        async models() {
          if (configured !== undefined) return configured;
          return listOpenAICodexModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `openaiCodex({ ... })`. */
export default definition;

/** Instance with factory-only options; the credential ref, `appName`, `baseUrl`, and catalog are validated config. */
export function openaiCodex(options: OpenAICodexProviderPackageOptions & OpenAICodexProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch", "callback"], options);
}

export { OPENAI_CODEX_ERROR_CLASSES, openAICodexErrorCode, openAICodexHttpError, USAGE_LIMIT_NOTE } from "./errors.js";
export {
  defineOpenAICodexModel,
  type ListOpenAICodexModelsOptions,
  listOpenAICodexModels,
  mapOpenAICodexModel,
  OPENAI_CODEX_DEFAULT_BASE_URL,
  OPENAI_CODEX_MODELS_MAX_BODY_BYTES,
  OPENAI_CODEX_ROUTE,
  type OpenAICodexModelConfig,
  type OpenAICodexModelEntry,
  openAICodexModels,
  openAICodexThinkingLevels,
} from "./models.js";
export {
  assertWritableCredentialRef,
  credentialRecordFromSecret,
  credentialRecordToSecret,
  credentialRegistrationFromSecret,
  credentialRegistrationToSecret,
  DYNAMIC_AGENT_CLIENT_ID,
  OPENAI_CODEX_AUTH_ID,
  OPENAI_CODEX_DEFAULT_CALLBACK_PORT,
  OPENAI_CODEX_DIRECT_TOKEN_SCOPE,
  OPENAI_CODEX_EXPIRY_MARGIN_MS,
  OPENAI_CODEX_REGISTRATION_MARKER,
  OPENAI_CODEX_SCOPE,
  OpenAICodexAuthError,
  type OpenAICodexAuthMethod,
  type OpenAICodexCredentialRecord,
  type OpenAICodexCredentialSlot,
  type OpenAICodexOAuthConfig,
  OpenAICodexPlanUsageNotGrantedError,
  OpenAICodexReauthorizeError,
  type OpenAICodexRegistration,
  OpenAICodexRegistrationError,
  openAICodexApiKey,
  openAICodexAuth,
  openAICodexImportCredentials,
  openAICodexLogout,
} from "./oauth.js";
export {
  createOpenAICodexProvider,
  OPENAI_CODEX_RESPONSES_ROUTE,
  OPENAI_CODEX_SESSION_ID_MAX_LENGTH,
  openAICodexAffinity,
} from "./provider.js";
