import assert from "node:assert/strict";
import type { CredentialValueSource, ModelConfig, ModelDiscovery, ModelDiscoveryOptions, ModelDiscoveryResult } from "@arnilo/prism";
import { redactSecrets, resolveCredentialValue, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/**
 * Model-list/capability discovery adapters over the existing `ModelConfig`
 * contract (plan 062, review §7 P1): passthrough normalization of provider
 * listings — no new model shape, no hard-coded catalog. Hosts merge their own
 * catalog overrides (`catalog`) on top of the normalized entries by model id.
 *
 * - `createOpenAiCompatibleModelDiscovery` adapts the OpenAI-compatible
 *   `GET <baseUrl>/models` route (`{data: [{id, …}]}`).
 * - `createGoogleModelDiscovery` adapts the Google Gemini
 *   `GET <baseUrl>/v1beta/models` route (`{models: [{name, …}]}`) as the
 *   independent provider, including `nextPageToken` pagination.
 * - Results cache per discovery instance within the configured TTL
 *   (default 3,600,000 ms) — `listModels()` in loops performs no network
 *   until the TTL expires; `ttlMs: 0` forces a refresh.
 * - Requests use the existing credential seam (`CredentialValueSource` +
 *   `resolveCredentialValue`) and bounded-response transport; secrets are
 *   redacted from every error message.
 */

export const DEFAULT_MODEL_DISCOVERY_TTL_MS = 3_600_000;
/** Hard cap on Google pagination hops; each page is byte-bounded (ponytail: raise when a listing exceeds 10×1000 models). */
const MAX_DISCOVERY_PAGES = 10;

/** Typed discovery failure: provider-labeled, with the HTTP status when known. */
export class ModelDiscoveryError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(provider: string, message: string, status?: number) {
    super(message);
    this.name = "ModelDiscoveryError";
    this.provider = provider;
    this.status = status;
  }
}

export interface ModelDiscoveryAdapterOptions {
  /** Provenance label; defaults to the adapter's provider family name. */
  readonly provider?: string;
  readonly baseUrl: string;
  /** Credential resolved through the existing credential seam and sent per provider convention. */
  readonly apiKey?: CredentialValueSource;
  /** Host-owned catalog overrides merged by model id (capability/limits/cost fields win). */
  readonly catalog?: readonly ModelConfig[];
  /** Default cache window in ms; `listModels({ ttlMs })` overrides per call. */
  readonly ttlMs?: number;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
}

export interface CreateOpenAiCompatibleModelDiscoveryOptions extends ModelDiscoveryAdapterOptions {}

export interface CreateGoogleModelDiscoveryOptions extends Omit<ModelDiscoveryAdapterOptions, "baseUrl"> {
  readonly baseUrl?: string;
  /** Google requires an API key, sent as `x-goog-api-key`. */
  readonly apiKey: CredentialValueSource;
}

function resolveTtlMs(options: ModelDiscoveryAdapterOptions): number {
  const ttl = options.ttlMs ?? DEFAULT_MODEL_DISCOVERY_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 0)
    throw new ModelDiscoveryError(options.provider ?? "model-discovery", "ttlMs must be a non-negative integer");
  return ttl;
}

/** Merge host catalog overrides over normalized entries by model id; catalog fields win. */
export function mergeModelCatalog(models: readonly ModelConfig[], catalog: readonly ModelConfig[] | undefined): readonly ModelConfig[] {
  if (!catalog?.length) return models;
  const byId = new Map(catalog.map((entry) => [entry.model, entry]));
  return models.map((model) => {
    const override = byId.get(model.model);
    return override ? { ...model, ...override } : model;
  });
}

function result(models: readonly ModelConfig[], provider: string, fetchedAtMs: number, ttlMs: number): ModelDiscoveryResult {
  return Object.freeze({
    models: Object.freeze(models),
    provenance: Object.freeze({ provider, fetchedAt: new Date(fetchedAtMs).toISOString(), source: "api", ttlMs }),
  });
}

/** Shared cache + merge wrapper: fetch via the adapter's raw listing, then normalize. */
function createModelDiscovery(
  label: string,
  options: ModelDiscoveryAdapterOptions,
  fetchModels: (provider: string, signal: AbortSignal | undefined) => Promise<readonly ModelConfig[]>,
): ModelDiscovery {
  const provider = options.provider ?? label;
  const defaultTtlMs = resolveTtlMs(options);
  let cache: { readonly result: ModelDiscoveryResult; readonly fetchedAtMs: number } | undefined;
  return {
    async listModels(listOptions: ModelDiscoveryOptions = {}): Promise<ModelDiscoveryResult> {
      const ttlMs = listOptions.ttlMs ?? defaultTtlMs;
      if (cache && ttlMs > 0 && Date.now() - cache.fetchedAtMs < ttlMs) return cache.result;
      const fetchedAtMs = Date.now();
      const result_ = result(
        mergeModelCatalog(await fetchModels(provider, listOptions.signal), options.catalog),
        provider,
        fetchedAtMs,
        ttlMs,
      );
      cache = { result: result_, fetchedAtMs };
      return result_;
    },
  };
}

async function resolveBearerToken(options: ModelDiscoveryAdapterOptions, label: string): Promise<string | undefined> {
  const token = await resolveCredentialValue(options.apiKey, { provider: label, name: "apiKey" });
  return token || undefined;
}

function discoveryFetch(options: ModelDiscoveryAdapterOptions) {
  return options.fetch ?? fetch;
}

async function failOnStatus(response: Response, label: string, secrets: readonly (string | undefined)[]): Promise<void> {
  if (response.ok) return;
  const body = await readBoundedResponseText(response, { secrets }).catch(() => "");
  throw new ModelDiscoveryError(
    label,
    `${label} model discovery failed: HTTP ${response.status} ${redactSecrets(body.slice(0, 256), secrets)}`.trimEnd(),
    response.status,
  );
}

/** OpenAI-compatible `GET <baseUrl>/models` → `{data: [{id, …}]}`, normalized to `ModelConfig`. */
export function createOpenAiCompatibleModelDiscovery(options: CreateOpenAiCompatibleModelDiscoveryOptions): ModelDiscovery {
  const label = "openai-compatible";
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  const fetchModels = async (provider: string, signal: AbortSignal | undefined): Promise<readonly ModelConfig[]> => {
    const token = await resolveBearerToken(options, label);
    const response = await discoveryFetch(options)(`${baseUrl}/models`, {
      method: "GET",
      headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal,
    });
    await failOnStatus(response, label, [token]);
    const payload = await readBoundedResponseJson<{ data?: unknown }>(response, {
      secrets: [token],
      maxResponseBodyBytes: options.maxResponseBytes,
      signal,
    });
    if (!Array.isArray(payload.data)) throw new ModelDiscoveryError(label, "model discovery response missing data array");
    return payload.data.map((entry: unknown) => {
      const id = typeof (entry as { id?: unknown } | null)?.id === "string" ? (entry as { id: string }).id : undefined;
      if (!id) throw new ModelDiscoveryError(label, "model discovery response contains an entry without an id");
      return { provider, model: id } as ModelConfig;
    });
  };
  return createModelDiscovery(label, options, fetchModels);
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
    const token = await resolveBearerToken(adapterOptions, label);
    if (!token) throw new ModelDiscoveryError(label, "model discovery requires an apiKey");
    const models: ModelConfig[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
      const url = new URL(`${baseUrl}/models`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await discoveryFetch(adapterOptions)(url, {
        method: "GET",
        headers: { ...adapterOptions.headers, "x-goog-api-key": token },
        signal,
      });
      await failOnStatus(response, label, [token]);
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
  return createModelDiscovery(label, adapterOptions, fetchModels);
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

export interface CreateFakeModelDiscoveryOptions {
  readonly provider?: string;
  readonly models?: readonly ModelConfig[];
  readonly ttlMs?: number;
}

/**
 * Network-free deterministic `ModelDiscovery` for tests and conformance
 * (plan 062): serves a fixed catalog snapshot (`source: "catalog"`) with a
 * fixed `fetchedAt` and honors the same TTL semantics as the HTTP adapters.
 */
export function createFakeModelDiscovery(options: CreateFakeModelDiscoveryOptions = {}): ModelDiscovery {
  const provider = options.provider ?? "fake";
  const models = options.models ?? [
    {
      provider,
      model: "fake-mini",
      limits: { contextWindow: 8_192 },
      capabilities: { input: ["text"], output: ["text"], tools: true, streaming: true },
    },
  ];
  const result: ModelDiscoveryResult = Object.freeze({
    models: Object.freeze(models),
    provenance: Object.freeze({ provider, fetchedAt: "2026-01-01T00:00:00.000Z", source: "catalog", ttlMs: options.ttlMs }),
  });
  return {
    async listModels(): Promise<ModelDiscoveryResult> {
      return result;
    },
  };
}

/**
 * Network-free conformance for `ModelDiscovery` implementations (plan 062):
 * result shape, provenance fields, model ids, and TTL caching (a second call
 * within the TTL returns the identical cached result — no refetch).
 */
export async function runModelDiscoveryConformance(createDiscovery: () => ModelDiscovery): Promise<void> {
  const discovery = createDiscovery();
  const first = await discovery.listModels();
  assert.ok(Array.isArray(first.models) && first.models.length >= 1, "discovery result must include models");
  const { provider, fetchedAt, source } = first.provenance;
  assert.equal(typeof provider, "string");
  assert.ok(provider.length > 0, "provenance provider must be non-empty");
  assert.ok(!Number.isNaN(Date.parse(fetchedAt)), "provenance fetchedAt must be an ISO timestamp");
  assert.ok(source === "api" || source === "catalog", "provenance source must be api or catalog");
  for (const model of first.models) {
    assert.ok(typeof model.model === "string" && model.model.length > 0, "each model needs a non-empty id");
    assert.equal(typeof model.provider, "string");
  }
  const second = await discovery.listModels();
  assert.deepEqual(
    second.models.map((m) => m.model),
    first.models.map((m) => m.model),
    "discovery must be deterministic within the cache TTL",
  );
  assert.equal(second.provenance.fetchedAt, first.provenance.fetchedAt, "second call within TTL must serve the cached fetch timestamp");
}
