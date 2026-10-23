import type { JsonObject, ModelConfig } from "@arnilo/prism";

/** Hosted Liquid API root; `/decisions/v1/systemone` is appended per request. */
export const LIQUID_DEFAULT_BASE_URL = "https://api.liquid.ai";
/** Hosted decision endpoint. The root `/v1/systemone` alias is undocumented, so the reviewed path is pinned. */
export const LIQUID_DEFAULT_PATH = "/decisions/v1/systemone";
/** `llama-server` default bind. `/v1/systemone` is appended per request. Loopback plaintext only. */
export const LIQUID_LOCAL_BASE_URL = "http://127.0.0.1:8080";
/** Env var the hosted API expects when a key is configured. */
export const LIQUID_API_KEY_ENV = "LIQUID_API_KEY";
/** The `apiKey` ref used when config names none. */
export const LIQUID_DEFAULT_API_KEY_REF = "env:LIQUID_API_KEY";

/** d1 answers typed questions in one pass — it never generates free text, streams, or calls tools. */
const DECISION_CAPABILITIES = {
  input: ["text", "image"],
  output: ["text"],
  tools: false,
  streaming: false,
  structuredOutput: "json_schema",
  decisions: true,
} as const;

const ZERO_COST = { input: 0, output: 0, currency: "USD", unit: "per_million_tokens" } as const;

export interface LiquidModelConfig extends Omit<ModelConfig, "provider"> {
  readonly provider?: "liquid" | "liquid-local";
  readonly compat?: JsonObject;
}

/** Declares a Liquid decision model for either provider; `d1` has no text output, so `maxOutputTokens` is 0. */
export function defineLiquidModel(config: LiquidModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "liquid",
    capabilities: { ...DECISION_CAPABILITIES, ...config.capabilities },
    limits: { maxOutputTokens: 0, ...config.limits },
    cost: { ...ZERO_COST, ...config.cost },
  };
}

/**
 * Hosted catalog. Input tokens are billed per question, including repeated image tokens, and cached
 * input costs the same; output is free. No hosted context window is documented, so it is omitted.
 * `d1.1` has no pricing row of its own and is charged at the `d1` row.
 */
export const liquidModels: readonly ModelConfig[] = [
  defineLiquidModel({
    model: "d1.1",
    displayName: "Liquid d1.1",
    cost: { input: 0.02, output: 0, currency: "USD", unit: "per_million_tokens" },
    metadata: { priceSource: "https://www.liquid.ai/pricing (2026-10-23; charged at the d1 row)" },
  }),
  defineLiquidModel({
    model: "d1-ultra",
    displayName: "Liquid d1-ultra",
    cost: { input: 0.042, output: 0, currency: "USD", unit: "per_million_tokens" },
    metadata: { priceSource: "https://www.liquid.ai/pricing (2026-10-23)" },
  }),
];

/** The local `llama-server` catalog: d1-3B, 32,768-token context, LFM Open License 1.0. */
export const liquidLocalModels: readonly ModelConfig[] = [
  defineLiquidModel({
    provider: "liquid-local",
    model: "d1-3B",
    displayName: "Liquid d1-3B (llama.cpp)",
    limits: { contextWindow: 32_768, maxOutputTokens: 0 },
    metadata: { recommendedQuant: "Q8_0", license: "lfm1.0" },
  }),
];
