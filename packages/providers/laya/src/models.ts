import type { JsonObject, ModelConfig } from "@arnilo/prism";

/** `laya-serve` default bind. `/v1/systemone` is appended per request. Loopback plaintext only. */
export const LAYA_DEFAULT_BASE_URL = "http://localhost:8000";
/** Env var a remote `laya-serve` expects when `LAYA_API_KEY` is set server-side. */
export const LAYA_API_KEY_ENV = "LAYA_API_KEY";
/** The `apiKey` ref used when config names none. */
export const LAYA_DEFAULT_API_KEY_REF = "env:LAYA_API_KEY";


/** Laya answers typed questions in one pass — it never generates free text, streams, or calls tools. */
const DECISION_CAPABILITIES = {
  input: ["text"],
  output: ["text"],
  tools: false,
  streaming: false,
  structuredOutput: "json_schema",
} as const;

const ZERO_COST = { input: 0, output: 0, currency: "USD", unit: "per_million_tokens" } as const;

export interface LayaModelConfig extends Omit<ModelConfig, "provider"> {
  readonly provider?: "laya";
  readonly compat?: JsonObject;
}

/** Declares a Laya checkpoint id. The server's Router still picks the checkpoint; `model` is advisory. */
export function defineLayaModel(config: LayaModelConfig): ModelConfig {
  return {
    ...config,
    provider: "laya",
    capabilities: { ...DECISION_CAPABILITIES, ...config.capabilities },
    limits: { maxOutputTokens: 0, ...config.limits },
    cost: { ...ZERO_COST, ...config.cost },
  };
}

/** Curated checkpoints. Context is the encoder window; multilingual may be extended server-side. */
export const layaModels: readonly ModelConfig[] = [
  defineLayaModel({ model: "laya", displayName: "Laya", limits: { contextWindow: 512, maxOutputTokens: 0 } }),
  defineLayaModel({
    model: "laya-multilingual",
    displayName: "Laya Multilingual",
    limits: { contextWindow: 1024, maxOutputTokens: 0 },
    metadata: { extendedContextWindow: 8192 },
  }),
  defineLayaModel({
    model: "laya-typed-decisions",
    displayName: "Laya Typed Decisions",
    limits: { contextWindow: 1024, maxOutputTokens: 0 },
  }),
];
