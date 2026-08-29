import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

export const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";

export interface XaiModelConfig extends Omit<ModelConfig, "provider"> {
  readonly provider?: "xai";
}

export interface ListXaiModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

export interface XaiModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface XaiModelsResponse {
  readonly object?: string;
  readonly data?: readonly XaiModelEntry[];
}

const FEATURED: Record<string, Pick<ModelConfig, "displayName" | "limits" | "cost">> = {
  "grok-4.6": {
    displayName: "Grok 4.6",
    limits: { contextWindow: 500_000, maxOutputTokens: 500_000 },
    cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  },
  "grok-4.3": {
    displayName: "Grok 4.3",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 30_000 },
    cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  },
  "grok-build-0.1": {
    displayName: "Grok Build 0.1",
    limits: { contextWindow: 256_000, maxOutputTokens: 256_000 },
    cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
  },
};

export function defineXaiModel(config: XaiModelConfig): ModelConfig {
  return {
    ...config,
    provider: "xai",
    capabilities: {
      input: ["text", "image"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
      ...config.capabilities,
    },
    cache: config.cache ?? { kind: "implicit" },
  };
}

/** Caller-gated `GET {base}/models`. Never invoked by `createXaiProviderPackage`. */
export async function listXaiModels(options: ListXaiModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "xai";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? XAI_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`xAI model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<XaiModelsResponse>(response);
  if (!Array.isArray(payload.data)) throw new Error("xAI model discovery response missing data array");
  return payload.data.map((entry) => mapXaiModel(entry, { provider }));
}

export function mapXaiModel(entry: XaiModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("xAI model entry missing id");
  }
  const known = FEATURED[entry.id];
  return defineXaiModel({
    provider: (options.provider as "xai" | undefined) ?? "xai",
    model: entry.id,
    displayName: known?.displayName ?? entry.id,
    limits: known?.limits ?? { contextWindow: 131_072, maxOutputTokens: 8_192 },
    cost: known?.cost,
    cache: { kind: "implicit" },
    compat: { xai: cleanJson({ owned_by: entry.owned_by, created: entry.created }) },
  });
}

export const xaiModels = (["grok-4.6", "grok-4.3", "grok-build-0.1"] as const).map((id) => defineXaiModel({ model: id, ...FEATURED[id]! }));

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
