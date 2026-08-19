import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  redactSecrets,
  resolveCredentialValue,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface DeepSeekModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "deepseek";
  readonly compat?: JsonObject & {
    readonly thinking?: boolean | JsonObject;
    readonly reasoning_effort?: string;
  };
}

export interface ListDeepSeekModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

export interface DeepSeekModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface DeepSeekModelsResponse {
  readonly object?: string;
  readonly data?: readonly DeepSeekModelEntry[];
}

const FLASH_COST = { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 } as const;
const PRO_COST = { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 } as const;
const DEFAULT_LIMITS = { contextWindow: 1_000_000, maxOutputTokens: 384_000 } as const;

export function defineDeepSeekModel(config: DeepSeekModelConfig): ModelConfig {
  return {
    ...config,
    provider: "deepseek",
    capabilities: {
      input: ["text"],
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

/**
 * Caller-gated OpenAI-compatible `GET {base}/models`.
 * Never invoked by `createDeepSeekProviderPackage`.
 */
export async function listDeepSeekModels(options: ListDeepSeekModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "deepseek";
  const baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`DeepSeek model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<DeepSeekModelsResponse>(response);
  if (!Array.isArray(payload.data)) throw new Error("DeepSeek model discovery response missing data array");
  return payload.data.map((entry) => mapDeepSeekModel(entry, { provider }));
}

export function mapDeepSeekModel(entry: DeepSeekModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("DeepSeek model entry missing id");
  }
  const id = entry.id;
  return defineDeepSeekModel({
    provider: (options.provider as "deepseek" | undefined) ?? "deepseek",
    model: id,
    displayName: id,
    limits: DEFAULT_LIMITS,
    cost: id.toLowerCase().includes("pro") ? PRO_COST : FLASH_COST,
    cache: { kind: "implicit" },
    compat: {
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      deepseek: cleanJson({ owned_by: entry.owned_by, created: entry.created }),
    },
  });
}

export const deepseekModels = [
  defineDeepSeekModel({
    model: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    limits: DEFAULT_LIMITS,
    cost: FLASH_COST,
    cache: { kind: "implicit" },
    compat: { thinking: { type: "enabled" }, reasoning_effort: "high" },
  }),
  defineDeepSeekModel({
    model: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    limits: DEFAULT_LIMITS,
    cost: PRO_COST,
    cache: { kind: "implicit" },
    compat: { thinking: { type: "enabled" }, reasoning_effort: "high" },
  }),
] as const satisfies readonly ModelConfig[];

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
