import type { CredentialValueSource, ModelConfig, ModelDiscovery } from "@arnilo/prism";
import {
  createCachedModelDiscovery,
  failDiscoveryOnStatus,
  type ModelDiscoveryAdapterOptions,
  ModelDiscoveryError,
  readBoundedResponseJson,
  resolveDiscoveryBearerToken,
} from "@arnilo/prism/provider-kit";
import { trimTrailingSlashes } from "@arnilo/prism";

/**
 * The Google `ModelDiscovery` adapter (plan 152 Task 6 moved it here from the retired
 * `@arnilo/prism/provider-kit` subpath). The OpenAI-compatible adapter, the TTL-cache
 * wrapper, the fake adapter, the conformance runner, and the `ModelDiscovery` result contract are
 * provider-neutral and live in `@arnilo/prism/provider-kit`; import them from there.
 *
 * This is a host-facing listing helper, not the registered provider's `models()`: `models()`
 * delegates to `listGoogleModels` (see `index.ts`), which returns the kernel's `ModelConfig[]`
 * instead of the separate `ModelDiscoveryResult` provenance envelope.
 */

/** Hard cap on Google pagination hops; each page is byte-bounded (ponytail: raise when a listing exceeds 10×1000 models). */
const MAX_DISCOVERY_PAGES = 10;

export interface CreateGoogleModelDiscoveryOptions extends Omit<ModelDiscoveryAdapterOptions, "baseUrl"> {
  readonly baseUrl?: string;
  /** Google requires an API key, sent as `x-goog-api-key`. */
  readonly apiKey: CredentialValueSource;
}

/** Google Gemini `GET <baseUrl>/v1beta/models` (`x-goog-api-key`) → `{models: [{name, …}]}`. */
export function createGoogleModelDiscovery(options: CreateGoogleModelDiscoveryOptions): ModelDiscovery {
  const label = "google";
  const adapterOptions: ModelDiscoveryAdapterOptions = {
    ...options,
    baseUrl: options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta",
  };
  const baseUrl = trimTrailingSlashes(adapterOptions.baseUrl);
  const fetchModels = async (provider: string, signal: AbortSignal | undefined): Promise<readonly ModelConfig[]> => {
    const token = await resolveDiscoveryBearerToken(adapterOptions, label);
    if (!token) throw new ModelDiscoveryError(label, "model discovery requires an apiKey");
    const models: ModelConfig[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
      const url = new URL(`${baseUrl}/models`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await (adapterOptions.fetch ?? fetch)(url, {
        method: "GET",
        headers: { ...adapterOptions.headers, "x-goog-api-key": token },
        signal,
      });
      await failDiscoveryOnStatus(response, label, [token]);
      const payload = await readBoundedResponseJson<{ models?: unknown; nextPageToken?: unknown }>(response, {
        secrets: [token],
        maxResponseBodyBytes: adapterOptions.maxResponseBytes,
        signal,
      });
      if (!Array.isArray(payload.models)) throw new ModelDiscoveryError(label, "model discovery response missing models array");
      for (const entry of payload.models) models.push(mapGoogleModel(entry, provider));
      if (typeof payload.nextPageToken !== "string" || !payload.nextPageToken) return models;
      pageToken = payload.nextPageToken;
    }
    throw new ModelDiscoveryError(label, `model discovery exceeded ${MAX_DISCOVERY_PAGES} pages`);
  };
  return createCachedModelDiscovery(label, adapterOptions, fetchModels);
}

function mapGoogleModel(entry: unknown, provider: string): ModelConfig {
  const record = (entry ?? {}) as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : undefined;
  if (!name?.startsWith("models/") || name.length <= "models/".length) {
    throw new ModelDiscoveryError(provider, "model discovery response contains an entry without a models/ name");
  }
  const methods = Array.isArray(record.supportedGenerationMethods)
    ? record.supportedGenerationMethods.filter((m): m is string => typeof m === "string")
    : [];
  return {
    provider,
    model: name.slice("models/".length),
    displayName: typeof record.displayName === "string" ? record.displayName : undefined,
    limits: {
      contextWindow: typeof record.inputTokenLimit === "number" ? record.inputTokenLimit : undefined,
      maxOutputTokens: typeof record.outputTokenLimit === "number" ? record.outputTokenLimit : undefined,
    },
    capabilities: {
      reasoning: typeof record.thinking === "boolean" ? record.thinking : undefined,
      embeddings: methods.includes("embedContent") ? true : undefined,
    },
  };
}
