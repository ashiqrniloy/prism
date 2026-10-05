/**
 * `@arnilo/prism-provider-xai` — the xAI (Grok) provider package.
 *
 * ```ts
 * import xai from "@arnilo/prism-provider-xai";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "xai/grok-4.6",
 *   packages: [xai({ apiKey: "env:XAI_API_KEY" })],
 * });
 * ```
 *
 * Both the API key and the SuperGrok OAuth access token are refs (`env:`/`keyring:`), never values:
 * they resolve through the credentials slot on every request. A ref that resolves to nothing records
 * a `warn` status note and registers the provider anyway, so `agent.models` still lists the catalog;
 * a run then fails with `credential_unavailable`.
 *
 * SuperGrok OAuth ships as an `auth` descriptor. The descriptor wraps the legacy `OAuthProvider`:
 * `login` drives it through `ctx.host` (`open-url` for the device code) and persists the tokens
 * through `ctx.credentials.store`. Without a UI it throws {@link OAuthUnavailableError}; it never
 * spawns a process and never opens a browser itself.
 */
import { type HostPort, type JsonSchema, type ModelConfig, type OAuthLoginCallbacks, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  oauthCredentialsToSecret,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";

import { listXaiModels } from "./models.js";
import { createXaiOAuthProvider, type XaiOAuthOptions } from "./oauth.js";
import { createXaiProvider } from "./provider.js";

/** The `apiKey` ref used when config names none. */
export const XAI_DEFAULT_API_KEY_REF = "env:XAI_API_KEY";

/** The `accessToken` ref used when config names none. */
export const XAI_DEFAULT_ACCESS_TOKEN_REF = "keyring:xai";

/** Thrown when a login needs a host surface the host does not have (fail closed, never guess). */
export class OAuthUnavailableError extends Error {
  readonly code = "oauth_unavailable";
  constructor(readonly request: string) {
    super(`xAI SuperGrok login needs host ${request}, but the host answered unavailable`);
    this.name = "OAuthUnavailableError";
  }
}

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface XaiProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link XAI_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Ref holding the SuperGrok OAuth access token; the `auth` descriptor writes it. */
  readonly accessToken?: string;
  /** Official Chat Completions base; defaults to `https://api.x.ai/v1`. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface XaiProviderPackageOptions {
  /** Provider id; defaults to `xai`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  /** Test seam for the OAuth flow (`fetch`, `now`, `sleep`, endpoint overrides). */
  readonly oauth?: XaiOAuthOptions;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(XAI_DEFAULT_API_KEY_REF),
    accessToken: secretRefProperty(
      XAI_DEFAULT_ACCESS_TOKEN_REF,
      "Ref holding the SuperGrok OAuth access token; the `auth` descriptor writes it.",
    ),
    baseUrl: baseUrlProperty("Official Chat Completions base; defaults to https://api.x.ai/v1."),
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
      await require({ kind: "open-url", title: "Sign in to xAI", url });
    },
    async onDeviceCode(code) {
      await require({ kind: "open-url", title: `xAI device code ${code.userCode}`, url: code.verificationUri });
    },
    async onPrompt(message) {
      const answer = (await require({ kind: "input", title: message })) as { status: "answered" | "dismissed"; value?: unknown };
      return answer.status === "answered" ? String(answer.value ?? "") : undefined;
    },
  };
}

function definitionFor(options: XaiProviderPackageOptions) {
  return defineProviderPackage<XaiProviderConfig>({
    name: "@arnilo/prism-provider-xai",
    description: "xAI (Grok) provider package for Prism.",
    capabilities: ["credentials", "host-ui"],
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "xai";
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKeyRef = prism.config.apiKey ?? XAI_DEFAULT_API_KEY_REF;
      const accessTokenRef = prism.config.accessToken ?? XAI_DEFAULT_ACCESS_TOKEN_REF;
      const apiKey = refSource(resolve, apiKeyRef);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The notes are what a host shows the user.
      for (const [vendor, ref] of [
        ["xai", apiKeyRef],
        ["xai (OAuth)", accessTokenRef],
      ] as const) {
        if ((await resolve(ref)) === undefined) prism.status.note("warn", `${vendor}: no API key at ${ref}`);
      }

      // SuperGrok OAuth tokens are used the way an API key is; a resolved access token wins.
      const credential = async (): Promise<string> => {
        const token = await resolve(accessTokenRef);
        if (token !== undefined && token.value !== "") return token.value;
        return apiKey();
      };
      const baseUrl = prism.config.baseUrl;
      const provider = createXaiProvider({ id, baseUrl, apiKey: credential, fetch: options.fetch });
      const configured = prism.config.models;
      const oauth = createXaiOAuthProvider(options.oauth);
      prism.providers.register({
        ...provider,
        auth: [
          {
            kind: "oauth",
            id: "xai",
            async login(ctx) {
              const credentials = await oauth.login(hostCallbacks(ctx.host));
              await ctx.credentials.store(accessTokenRef, oauthCredentialsToSecret(credentials));
            },
          },
        ],
        async models() {
          if (configured !== undefined) return configured;
          return listXaiModels({ provider: id, baseUrl, apiKey: credential, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `xai({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function xai(options: XaiProviderPackageOptions & XaiProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch", "oauth"], options);
}

export { XAI_CONV_ID_MAX_LENGTH, xaiCacheEnabled, xGrokConvId } from "./cache.js";
export {
  defineXaiModel,
  type ListXaiModelsOptions,
  listXaiModels,
  mapXaiModel,
  XAI_DEFAULT_BASE_URL,
  XAI_THINKING_LEVELS,
  type XaiModelConfig,
  type XaiModelEntry,
  xaiModels,
  xaiThinkingLevels,
} from "./models.js";
export {
  createXaiOAuthProvider,
  parseXaiTokenCredentials,
  XAI_DEFAULT_CLIENT_ID,
  XAI_DEFAULT_DEVICE_CODE_URL,
  XAI_DEFAULT_REFERRER,
  XAI_DEFAULT_REVOKE_URL,
  XAI_DEFAULT_SCOPE,
  XAI_DEFAULT_TOKEN_URL,
  XAI_REFRESH_SKEW_MS,
  type XaiOAuthOptions,
} from "./oauth.js";
export { createXaiProvider, toXaiMessage, type XaiProviderOptions, xaiBody, xaiEvents } from "./provider.js";
export { xaiReasoningEffort, xaiReplayThinking } from "./thinking.js";
