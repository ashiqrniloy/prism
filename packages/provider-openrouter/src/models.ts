import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  type ModelCost,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { defineOpenRouterModel } from "./model.js";

export interface ListOpenRouterModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to `https://openrouter.ai/api/v1`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/**
 * Official OpenRouter `GET /api/v1/models` entry (subset of documented fields).
 * @see https://openrouter.ai/docs/api/api-reference/models/get-models
 * @see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */
export interface OpenRouterModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly created?: number;
  readonly description?: string;
  readonly context_length?: number;
  readonly architecture?: {
    readonly modality?: string;
    readonly input_modalities?: readonly string[];
    readonly output_modalities?: readonly string[];
  };
  readonly pricing?: {
    readonly prompt?: string;
    readonly completion?: string;
    readonly input_cache_read?: string;
    readonly input_cache_write?: string;
    readonly input_cache_write_1h?: string;
  };
  readonly top_provider?: {
    readonly context_length?: number | null;
    readonly max_completion_tokens?: number | null;
  };
  readonly supported_parameters?: readonly string[];
  readonly reasoning?: {
    readonly mandatory?: boolean;
    readonly default_enabled?: boolean;
    readonly supported_efforts?: readonly string[] | null;
    readonly default_effort?: string;
    readonly supports_max_tokens?: boolean;
  };
}

interface OpenRouterModelsResponse {
  readonly data?: readonly OpenRouterModelEntry[];
}

/**
 * Caller-gated OpenRouter model discovery via official `GET /api/v1/models`.
 * Never invoked by `createOpenRouterProviderPackage` — hosts call this and pass
 * filtered results via `models:` (app-controlled registration remains the default).
 * Auth is optional for the public catalog; when supplied, Authorization is forwarded.
 * @see https://openrouter.ai/docs/api/api-reference/models/get-models
 */
export async function listOpenRouterModels(options: ListOpenRouterModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "openrouter";
  const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`OpenRouter model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as OpenRouterModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("OpenRouter model discovery response missing data array");
  return payload.data.map((entry) => mapOpenRouterModel(entry, { provider }));
}

/**
 * Map an official OpenRouter `/models` entry to Prism `ModelConfig`.
 * Pricing is converted from per-token USD strings to `per_million_tokens`.
 * Cache kind is best-effort: Anthropic/Qwen/Gemini families that document explicit
 * `cache_control` map to `cache_control`; others with cache-read pricing map to `implicit`.
 */
export function mapOpenRouterModel(
  entry: OpenRouterModelEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("OpenRouter model entry missing id");
  }
  const id = entry.id;
  const params = new Set(entry.supported_parameters ?? []);
  const reasoningMeta = entry.reasoning;
  const reasoning =
    reasoningMeta != null
    || params.has("reasoning")
    || params.has("reasoning_effort")
    || params.has("include_reasoning");
  const input = mapModalities(entry.architecture?.input_modalities, ["text"]);
  const output = mapModalities(entry.architecture?.output_modalities, ["text"]);
  const cache = inferOpenRouterCache(id, entry.pricing);
  const defaultEffort = reasoningMeta?.default_effort;
  const contextWindow =
    typeof entry.context_length === "number"
      ? entry.context_length
      : typeof entry.top_provider?.context_length === "number"
        ? entry.top_provider.context_length
        : undefined;
  const maxOutputTokens =
    typeof entry.top_provider?.max_completion_tokens === "number"
      ? entry.top_provider.max_completion_tokens
      : undefined;

  const mapped = defineOpenRouterModel({
    model: id,
    displayName: entry.name ?? id,
    capabilities: {
      input,
      output,
      reasoning,
      tools: params.has("tools") || params.has("tool_choice"),
      streaming: true,
      structuredOutput: params.has("structured_outputs") || params.has("response_format") ? "json_schema" : undefined,
    },
    limits: cleanLimits({ contextWindow, maxOutputTokens }),
    cost: toModelCost(entry.pricing),
    cache,
    compat: cleanJson({
      preserveThinking: reasoning || undefined,
      reasoning: defaultEffort && defaultEffort !== "none" ? { effort: defaultEffort } : undefined,
      openRouter: cleanJson({
        created: entry.created,
        description: entry.description,
        supported_parameters: entry.supported_parameters,
        reasoning: reasoningMeta as JsonObject | undefined,
        modality: entry.architecture?.modality,
      }),
    }),
  });
  return options.provider && options.provider !== "openrouter"
    ? { ...mapped, provider: options.provider }
    : mapped;
}

function inferOpenRouterCache(
  id: string,
  pricing: OpenRouterModelEntry["pricing"],
): ModelConfig["cache"] | undefined {
  const hasCacheRead = pricing?.input_cache_read != null && Number(pricing.input_cache_read) >= 0;
  const hasCacheWrite = pricing?.input_cache_write != null && Number(pricing.input_cache_write) >= 0;
  if (!hasCacheRead && !hasCacheWrite) return undefined;
  const longRetention = pricing?.input_cache_write_1h != null && Number(pricing.input_cache_write_1h) >= 0;
  // Official prompt-caching docs: Anthropic, Alibaba/Qwen, and Gemini need explicit
  // cache_control (top-level automatic or per-block). Others are typically implicit.
  const explicit = /^(anthropic|qwen|google)\//.test(id) || id.includes("alibaba");
  return {
    kind: explicit ? "cache_control" : "implicit",
    longRetention: longRetention || undefined,
  };
}

function toModelCost(pricing: OpenRouterModelEntry["pricing"]): ModelCost | undefined {
  if (!pricing) return undefined;
  const cost: ModelCost = cleanJson({
    input: perMillion(pricing.prompt),
    output: perMillion(pricing.completion),
    cacheRead: perMillion(pricing.input_cache_read),
    cacheWrite: perMillion(pricing.input_cache_write),
    currency: "USD",
    unit: "per_million_tokens",
  }) as ModelCost;
  return Object.keys(cost).some((key) => key !== "unit" && key !== "currency") ? cost : undefined;
}

/** OpenRouter pricing strings are USD per token; convert to per-million. Skip sentinel `-1`. */
function perMillion(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  // Round out IEEE dust from `token_price * 1e6` (e.g. 2e-7 → 0.2).
  return Number((n * 1_000_000).toPrecision(12));
}

function mapModalities(values: readonly string[] | undefined, fallback: string[]): string[] {
  if (!values?.length) return fallback;
  const allowed = new Set(["text", "image", "audio", "file", "document", "video"]);
  const mapped = values.filter((value) => allowed.has(value));
  return mapped.length > 0 ? mapped : fallback;
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as JsonObject;
}

function cleanLimits(value: NonNullable<ModelConfig["limits"]>): ModelConfig["limits"] {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as ModelConfig["limits"];
}
