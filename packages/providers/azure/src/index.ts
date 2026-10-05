/**
 * `@arnilo/prism-provider-azure` — the Azure OpenAI / Foundry provider package.
 *
 * ```ts
 * import azure from "@arnilo/prism-provider-azure";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "azure/gpt-4o",
 *   packages: [azure({
 *     resourceName: "my-resource",
 *     deployment: "gpt-4o",
 *     credential: "env:AZURE_OPENAI_API_KEY",
 *   })],
 * });
 * ```
 *
 * The credential is a ref (`env:`/`keyring:`), never a value: it resolves through the credentials
 * slot on every request, so a rotated resource key or a late-bound Entra token is picked up without
 * rebuilding the provider. `authStyle` picks the header: `bearer` (Entra, the default) or `api-key`
 * (a resource key). A ref that resolves to nothing records a `warn` status note and registers the
 * provider anyway; a run then fails with `credential_unavailable`.
 *
 * The endpoint host is never rewritten: `resourceName` builds the public
 * `https://<resourceName>.openai.azure.com` host, while `endpoint` takes a custom subdomain, private
 * endpoint, or VNet FQDN verbatim (trailing slash stripped only).
 */
import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { defineProviderPackage, modelsProperty, providerPackageInstance, refSource, secretRefProperty } from "@arnilo/prism/provider-kit";

import { AZURE_OPENAI_DEFAULT_API_VERSION, type AzureAuthStyle, createAzureOpenAIProvider, requireAzureEndpoint } from "./provider.js";

export {
  AZURE_OPENAI_DEFAULT_API_VERSION,
  type AzureAuthStyle,
  type AzureOpenAIProviderOptions,
  azureChatCompletionsUrl,
  createAzureOpenAIProvider,
} from "./provider.js";

/** The `credential` ref used when config names none. */
export const AZURE_DEFAULT_CREDENTIAL_REF = "env:AZURE_OPENAI_API_KEY";

export interface AzureProviderPackageOptions {
  /** Provider id; defaults to `azure`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

/** The config a host (or a code instance) may set; `credential` is a ref, never a value. */
export interface AzureProviderConfig {
  /** Resource name; builds `https://<resourceName>.openai.azure.com`. Exactly one of `resourceName`/`endpoint`. */
  readonly resourceName?: string;
  /** Full resource endpoint (custom subdomain, private endpoint, VNet FQDN); https only. */
  readonly endpoint?: string;
  /** Deployment name. Defaults to `request.model.model` when omitted. */
  readonly deployment?: string;
  /** Azure API version; defaults to {@link AZURE_OPENAI_DEFAULT_API_VERSION}. */
  readonly apiVersion?: string;
  /** An `env:`/`keyring:` ref; defaults to {@link AZURE_DEFAULT_CREDENTIAL_REF}. */
  readonly credential?: string;
  /** `bearer` for Entra access tokens (default); `api-key` for Azure resource keys. */
  readonly authStyle?: AzureAuthStyle;
  /** Static catalog. Azure deployments are host-defined, so this is the listing. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    resourceName: { type: "string", minLength: 1, description: "Azure OpenAI resource name." },
    endpoint: { type: "string", description: "Full resource endpoint; must be https. Exactly one of resourceName/endpoint." },
    deployment: { type: "string", description: "Deployment name; defaults to the request model id." },
    apiVersion: { type: "string", description: `Azure API version; defaults to ${AZURE_OPENAI_DEFAULT_API_VERSION}.` },
    credential: secretRefProperty(AZURE_DEFAULT_CREDENTIAL_REF),
    authStyle: { type: "string", enum: ["bearer", "api-key"], description: "Entra bearer token (default) or Azure resource key." },
    models: modelsProperty("Static catalog; Azure deployments are host-defined."),
  },
  additionalProperties: false,
};

/** The endpoint from config: `endpoint` verbatim, else the public host for `resourceName`. */
export function azureEndpointFromConfig(config: Pick<AzureProviderConfig, "resourceName" | "endpoint">): string {
  if (config.endpoint !== undefined && config.resourceName !== undefined) {
    throw new Error("Azure config takes either endpoint or resourceName, not both");
  }
  if (config.endpoint !== undefined) return requireAzureEndpoint(config.endpoint);
  if (config.resourceName !== undefined) {
    if (!config.resourceName.trim()) throw new Error("Azure resourceName must be non-empty");
    return requireAzureEndpoint(`https://${config.resourceName.trim()}.openai.azure.com`);
  }
  throw new Error("Azure config needs resourceName or endpoint");
}

function definitionFor(options: AzureFactoryOptions) {
  return defineProviderPackage<AzureProviderConfig>({
    name: "@arnilo/prism-provider-azure",
    description: "Azure OpenAI / Foundry provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "azure";
      const endpoint = azureEndpointFromConfig(prism.config);
      const ref = prism.config.credential ?? AZURE_DEFAULT_CREDENTIAL_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const credential = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `azure: no credential at ${ref}`);
      const provider = createAzureOpenAIProvider({
        id,
        endpoint,
        deployment: prism.config.deployment,
        apiVersion: prism.config.apiVersion,
        authStyle: prism.config.authStyle,
        credential,
        fetch: options.fetch,
      });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          return configured ?? [];
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `azure({ ... })`. */
export default definition;

/** Factory-only options: `id`, `fetch`. Credential config stays JSON. */
export type AzureFactoryOptions = Pick<AzureProviderPackageOptions, "id" | "fetch">;

/** Instance with factory-only options; `resourceName`/`endpoint`/`deployment`/`apiVersion`/`credential` are validated config. */
export function azure(options: AzureProviderPackageOptions & AzureProviderConfig): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}
