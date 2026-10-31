/**
 * `@arnilo/prism-provider-kilo` — Kilo AI Gateway provider package for Prism: registers `kilo`,
 * resolves its key from `env:`/`keyring:` refs, and serves Chat Completions, Responses and
 * Anthropic Messages from one gateway, plus the model catalog.
 *
 * ```ts
 * import { kilo } from "@arnilo/prism-provider-kilo";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({ model: "kilo/anthropic/claude-haiku-5.5", packages: [kilo()] });
 * ```
 *
 * Configuration is ref-only: the key is `env:KILO_API_KEY` (or another ref), and a device login
 * writes `keyring:kilo`. With neither, the package still registers and a `warn` note says only
 * `:free` models are reachable; the gateway accepts anonymous free requests.
 */
import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";
import { KILO_DEFAULT_CREDENTIAL_REF, kiloAuth } from "./auth.js";
import { listKiloModels } from "./models.js";
import { createKiloProvider } from "./provider.js";

export const KILO_DEFAULT_API_KEY_REF = "env:KILO_API_KEY";

export interface KiloProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link KILO_DEFAULT_API_KEY_REF}. Wins over the login. */
  readonly apiKey?: string;
  /** Writable `keyring:` ref where a device login stores its token; defaults to `keyring:kilo`. */
  readonly credential?: string;
  /** Defaults to `https://ai-gateway.kilo.ai/api/v1`. */
  readonly baseUrl?: string;
  /** Sends `X-KILOCODE-ORGANIZATIONID` and switches discovery to `/organizations/{id}/models`. */
  readonly organizationId?: string;
  /** Body `provider.data_collection`, only when set. */
  readonly dataCollection?: "allow" | "deny";
  /** `x-kilocode-mode`, sent only on `kilo-auto/*` models. */
  readonly mode?: string;
  /** Static catalog. When absent, `models()` asks `GET /models`. */
  readonly models?: readonly ModelConfig[];
}

export interface KiloProviderPackageOptions {
  readonly id?: string;
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(KILO_DEFAULT_API_KEY_REF),
    credential: secretRefProperty(KILO_DEFAULT_CREDENTIAL_REF, "A writable `keyring:` ref where the device login stores its token."),
    baseUrl: baseUrlProperty("Defaults to `https://ai-gateway.kilo.ai/api/v1`."),
    organizationId: { type: "string", minLength: 1, description: "Organization id; also switches discovery to the org catalog." },
    dataCollection: {
      type: "string",
      enum: ["allow", "deny"],
      description: "Body `provider.data_collection`; omitted when unset.",
    },
    mode: { type: "string", minLength: 1, description: "`x-kilocode-mode`; sent only on `kilo-auto/*` models." },
    models: modelsProperty("Static catalog. When absent, `models()` asks `GET /models`."),
  },
  additionalProperties: false,
};

/** A stored bearer secret: its value is the token, its metadata may carry the login's organization. */
function bearerValue(
  secret: { readonly type?: string; readonly value?: unknown; readonly metadata?: unknown } | undefined,
): string | undefined {
  if (secret?.type !== "bearer" || typeof secret.value !== "string" || !secret.value) return undefined;
  return secret.value;
}

function storedOrganization(secret: { readonly metadata?: unknown } | undefined): string | undefined {
  const metadata = secret?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const organizationId = (metadata as Record<string, unknown>).organizationId;
  return typeof organizationId === "string" && organizationId ? organizationId : undefined;
}

function definitionFor(options: KiloProviderPackageOptions) {
  return defineProviderPackage<KiloProviderConfig>({
    name: "@arnilo/prism-provider-kilo",
    description: "Kilo AI Gateway provider package for Prism: Chat, Responses and Messages wires.",
    capabilities: ["credentials", "credentials:write"],
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "kilo";
      const apiKeyRef = prism.config.apiKey ?? KILO_DEFAULT_API_KEY_REF;
      const credentialRef = prism.config.credential ?? KILO_DEFAULT_CREDENTIAL_REF;
      if (!credentialRef.startsWith("keyring:"))
        throw new Error(`kilo: ${credentialRef.split(":")[0]}: refs are read-only; use ${KILO_DEFAULT_CREDENTIAL_REF}`);
      const resolve = (target: string) => prism.credentials.resolve(target);
      const keyValue = async () => (await resolve(apiKeyRef))?.value;
      const credential = await resolve(credentialRef);
      const loginValue = bearerValue(credential);
      if ((await keyValue()) === undefined && loginValue === undefined)
        prism.status.note("warn", `kilo: no API key at ${apiKeyRef} and no login at ${credentialRef}; only :free models are reachable`);
      // The key wins when both exist; the login is a fallback with no refresh (device tokens do not refresh).
      const resolveApiKey = async () => (await keyValue()) ?? bearerValue(await resolve(credentialRef));
      const organizationId = prism.config.organizationId ?? storedOrganization(credential);
      const baseUrl = prism.config.baseUrl;
      const auth = kiloAuth({
        credential: credentialRef,
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      });
      const provider = createKiloProvider({
        id,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        resolveApiKey: async () => {
          const value = await resolveApiKey();
          return typeof value === "string" ? value : undefined;
        },
        ...(organizationId !== undefined ? { organizationId } : {}),
        ...(prism.config.dataCollection !== undefined ? { dataCollection: prism.config.dataCollection } : {}),
        ...(prism.config.mode !== undefined ? { mode: prism.config.mode } : {}),
        fetch: options.fetch,
      });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        auth: [{ kind: "api-key", ref: apiKeyRef }, auth],
        async models() {
          if (configured !== undefined) return configured;
          return listKiloModels({
            provider: id,
            ...(baseUrl !== undefined ? { baseUrl } : {}),
            apiKey: async () => await resolveApiKey(),
            ...(organizationId !== undefined ? { organizationId } : {}),
            fetch: options.fetch,
          });
        },
      });
    },
  });
}

const definition = definitionFor({});

export default definition;

export function kilo(options: KiloProviderPackageOptions & KiloProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  assertKiloWritableCredentialRef,
  KILO_AUTH_BASE_URL,
  KILO_AUTH_FALLBACK_LIFETIME_MS,
  KILO_AUTH_ID,
  KILO_AUTH_POLL_INTERVAL_MS,
  KILO_DEFAULT_CREDENTIAL_REF,
  type KiloAuthConfig,
  KiloAuthError,
  type KiloAuthMethod,
  kiloAuth,
  kiloLogout,
} from "./auth.js";
export {
  defineKiloModel,
  KILO_DEFAULT_BASE_URL,
  KILO_PRICING_SOURCE,
  type KiloModelConfig,
  type KiloModelEntry,
  type KiloRoute,
  kiloModels,
  type ListKiloModelsOptions,
  listKiloModels,
  mapKiloModel,
  routeForKiloModel,
  routeFromAiSdkProvider,
} from "./models.js";
export {
  createKiloProvider,
  KILO_CHAT_ROUTE,
  KILO_MESSAGES_ROUTE,
  KILO_MODE_HEADER,
  KILO_ORGANIZATION_HEADER,
  KILO_RESPONSES_ROUTE,
  KILO_TASK_ID_HEADER,
  KILO_TASK_ID_MAX_LENGTH,
  type KiloProviderOptions,
  kiloHttpError,
  kiloMessagesCache,
  kiloSession,
  kiloTaskId,
  mapKiloChatUsage,
  mapKiloMessagesUsage,
  mapKiloResponsesUsage,
} from "./provider.js";
