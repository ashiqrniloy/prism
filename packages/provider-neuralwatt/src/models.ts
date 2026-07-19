import { resolveCredentialValue, redactSecrets, type CredentialValueSource, type JsonObject, type ModelConfig, type ModelCost } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface ListNeuralWattModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface NeuralWattModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "neuralwatt";
  readonly compat?: JsonObject & {
    /** NeuralWatt reasoning effort: "low" | "medium" | "high". */
    readonly reasoning_effort?: string;
    /** NeuralWatt per-request thinking-token budget. */
    readonly thinking_token_budget?: number;
    /** NeuralWatt chat-template kwargs forwarded verbatim. */
    readonly chat_template_kwargs?: JsonObject;
    /** NeuralWatt tool_choice passthrough ("auto" | "none" | "required" | object). */
    readonly tool_choice?: string | JsonObject;
    /** Whether the model supports `delta.reasoning_content` streaming. */
    readonly reasoning?: boolean;
    /** Whether tool-call deltas arrive over the stream. */
    readonly tool_stream?: boolean;
    /** Whether NeuralWatt advertises JSON mode for this model. */
    readonly json_mode?: boolean;
    /** Whether NeuralWatt pricing is documented elsewhere via `/v1/models`. */
    readonly pricing_source?: string;
  };
}

export function defineNeuralWattModel(config: NeuralWattModelConfig): ModelConfig {
  return {
    ...config,
    provider: "neuralwatt",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
      ...config.capabilities,
    },
  };
}

const implicitCache = { kind: "implicit" } as const;
const reasoningCompat = {
  reasoning_effort: "max",
  thinking_token_budget: 8_192,
  tool_stream: true,
  reasoning: true,
  pricing_source: "/v1/models",
} as const;
const fastCompat = { tool_stream: true, reasoning: false, pricing_source: "/v1/models" } as const;
const jsonMode = { json_mode: true } as const;

function featuredModel(config: NeuralWattModelConfig): ModelConfig {
  return defineNeuralWattModel({ cache: implicitCache, ...config });
}

/**
 * Curated NeuralWatt model registry. Featured aliases and limits come from
 * the NeuralWatt `/v1/models` documentation. Pricing is intentionally absent
 * from the static catalog until exact per-alias numbers are returned by
 * `listNeuralWattModels()`; the docs only guarantee the pricing fields and
 * cache-read policy, not fixed rates for every featured alias.
 */
export async function listNeuralWattModels(options: ListNeuralWattModelsOptions = {}): Promise<ModelConfig[]> {
  const baseUrl = (options.baseUrl ?? "https://api.neuralwatt.com/v1").replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider: "neuralwatt", name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`NeuralWatt model discovery failed: ${response.status} ${redactSecrets(await readBoundedResponseText(response, { secrets: [token] }), [token])}`);
  const payload = (await response.json()) as NeuralWattModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("NeuralWatt model discovery response missing data array");
  return payload.data.map(mapNeuralWattModel);
}

export function mapNeuralWattModel(entry: NeuralWattModelEntry): ModelConfig {
  if (!entry || typeof entry.id !== "string") throw new Error("NeuralWatt model entry missing id");
  const metadata = entry.metadata ?? {};
  const capabilities = metadata.capabilities ?? {};
  const limits = metadata.limits ?? {};
  return defineNeuralWattModel({
    model: entry.id,
    displayName: stringOrUndefined(metadata.display_name),
    capabilities: cleanModelCapabilities({
      input: capabilities.vision ? ["text", "image"] : ["text"],
      output: ["text"],
      tools: booleanOrUndefined(capabilities.tools),
      reasoning: booleanOrUndefined(capabilities.reasoning),
      streaming: booleanOrUndefined(capabilities.streaming),
    }),
    limits: cleanLimits({
      contextWindow: numberOrUndefined(limits.max_context_length ?? entry.max_model_len),
      maxOutputTokens: numberOrUndefined(limits.max_output_tokens),
    }),
    cost: toModelCost(metadata.pricing),
    cache: implicitCache,
    compat: cleanJson({
      reasoning: capabilities.reasoning,
      reasoning_effort: capabilities.reasoning_effort ? "max" : undefined,
      tool_stream: capabilities.tools,
      json_mode: capabilities.json_mode,
      neuralwatt: cleanJson({
        owned_by: entry.owned_by,
        provider: metadata.provider,
        huggingface_id: metadata.huggingface_id,
        description: metadata.description,
        deprecated: metadata.deprecated,
        deprecated_message: metadata.deprecated_message,
        max_images: limits.max_images,
        system_role: capabilities.system_role,
        developer_role: capabilities.developer_role,
        pricing_tbd: metadata.pricing?.pricing_tbd,
      }),
    }),
  });
}

export const neuralWattModels = [
  featuredModel({
    model: "glm-5.2",
    displayName: "GLM-5.2",
    limits: { contextWindow: 1_024_000 },
    compat: reasoningCompat,
  }),
  featuredModel({
    model: "glm-5.2-fast",
    displayName: "GLM-5.2 Fast",
    limits: { contextWindow: 1_024_000 },
    capabilities: { reasoning: false },
    compat: fastCompat,
  }),
  featuredModel({
    model: "glm-5.2-short",
    displayName: "GLM-5.2 Short",
    limits: { contextWindow: 195_000 },
    compat: reasoningCompat,
  }),
  featuredModel({
    model: "glm-5.2-short-fast",
    displayName: "GLM-5.2 Short Fast",
    limits: { contextWindow: 195_000 },
    capabilities: { reasoning: false },
    compat: fastCompat,
  }),
  featuredModel({
    model: "gemma-4-31b",
    displayName: "Gemma 4 31B",
    limits: { contextWindow: 256_000 },
    capabilities: { input: ["text", "image"], reasoning: false },
    compat: { ...fastCompat, ...jsonMode },
  }),
  featuredModel({
    model: "kimi-k2.6",
    displayName: "Kimi K2.6",
    limits: { contextWindow: 256_000 },
    capabilities: { input: ["text", "image"] },
    compat: { ...reasoningCompat, ...jsonMode },
  }),
  featuredModel({
    model: "kimi-k2.6-fast",
    displayName: "Kimi K2.6 Fast",
    limits: { contextWindow: 256_000 },
    capabilities: { input: ["text", "image"], reasoning: false },
    compat: { ...fastCompat, ...jsonMode },
  }),
  featuredModel({
    model: "kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    limits: { contextWindow: 256_000 },
    capabilities: { input: ["text", "image"] },
    compat: { ...reasoningCompat, ...jsonMode },
  }),
  featuredModel({
    model: "qwen3.5-397b",
    displayName: "Qwen3.5 397B",
    limits: { contextWindow: 256_000 },
    compat: { ...reasoningCompat, ...jsonMode },
  }),
  featuredModel({
    model: "qwen3.5-397b-fast",
    displayName: "Qwen3.5 397B Fast",
    limits: { contextWindow: 256_000 },
    capabilities: { reasoning: false },
    compat: { ...fastCompat, ...jsonMode },
  }),
  featuredModel({
    model: "qwen3.6-35b",
    displayName: "Qwen3.6 35B",
    limits: { contextWindow: 128_000 },
    capabilities: { input: ["text", "image"] },
    compat: { ...reasoningCompat, ...jsonMode },
  }),
  featuredModel({
    model: "qwen3.6-35b-fast",
    displayName: "Qwen3.6 35B Fast",
    limits: { contextWindow: 128_000 },
    capabilities: { input: ["text", "image"], reasoning: false },
    compat: { ...fastCompat, ...jsonMode },
  }),
] as const satisfies readonly ModelConfig[];

interface NeuralWattModelsResponse {
  readonly data?: readonly NeuralWattModelEntry[];
}

export interface NeuralWattModelEntry {
  readonly id?: string;
  readonly owned_by?: string;
  readonly max_model_len?: number | null;
  readonly metadata?: {
    readonly display_name?: string | null;
    readonly description?: string | null;
    readonly provider?: string | null;
    readonly huggingface_id?: string | null;
    readonly pricing?: {
      readonly input_per_million?: number | null;
      readonly output_per_million?: number | null;
      readonly cached_input_per_million?: number | null;
      readonly cached_output_per_million?: number | null;
      readonly currency?: string | null;
      readonly pricing_tbd?: boolean;
    };
    readonly capabilities?: {
      readonly tools?: boolean;
      readonly json_mode?: boolean;
      readonly vision?: boolean;
      readonly reasoning?: boolean;
      readonly reasoning_effort?: boolean;
      readonly streaming?: boolean;
      readonly system_role?: boolean;
      readonly developer_role?: boolean;
    };
    readonly limits?: {
      readonly max_context_length?: number | null;
      readonly max_output_tokens?: number | null;
      readonly max_images?: number | null;
    };
    readonly deprecated?: boolean;
    readonly deprecated_message?: string | null;
  };
}

type NeuralWattPricing = NonNullable<NonNullable<NeuralWattModelEntry["metadata"]>["pricing"]>;

function toModelCost(pricing: NeuralWattPricing | undefined): ModelCost | undefined {
  if (!pricing || pricing.pricing_tbd) return undefined;
  const cost: ModelCost = cleanJson({
    input: numberOrUndefined(pricing.input_per_million),
    output: numberOrUndefined(pricing.output_per_million),
    cacheRead: numberOrUndefined(pricing.cached_input_per_million),
    cacheWrite: numberOrUndefined(pricing.cached_output_per_million),
    currency: stringOrUndefined(pricing.currency),
    unit: "per_million_tokens",
  }) as ModelCost;
  return Object.keys(cost).some((key) => key !== "unit") ? cost : undefined;
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as JsonObject;
}

function cleanModelCapabilities(value: NonNullable<ModelConfig["capabilities"]>): ModelConfig["capabilities"] {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as ModelConfig["capabilities"];
}

function cleanLimits(value: NonNullable<ModelConfig["limits"]>): ModelConfig["limits"] {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as ModelConfig["limits"];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
