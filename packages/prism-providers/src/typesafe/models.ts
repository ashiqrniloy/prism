import type { JsonObject, ModelConfig } from "@arnilo/prism";

/** Production TypeSafe API root; `/v1/systemone` is appended per request. */
export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
/** Env var the TypeSafe clients read for the Bearer key; hosts wire it through `createEnvCredentialResolver`. */
export const TYPESAFE_API_KEY_ENV = "TYPESAFE_API_KEY";

/** Jev answers typed questions in one pass — it never generates free text, streams, or calls tools. */
const DECISION_CAPABILITIES = {
  input: ["text"],
  output: ["text"],
  tools: false,
  streaming: false,
  structuredOutput: "json_schema",
} as const;

const DECISION_LIMITS = { contextWindow: 32_000, maxOutputTokens: 0 } as const;
const DECISION_COST = { input: 0.04, output: 0, currency: "USD", unit: "per_million_tokens" } as const;

export interface TypeSafeModelConfig extends Omit<ModelConfig, "provider"> {
  readonly provider?: "typesafe";
  readonly compat?: JsonObject;
}

/** Declares a Jev model; versioned pins (`jev-1.13.0`) go through here too. */
export function defineTypeSafeModel(config: TypeSafeModelConfig): ModelConfig {
  return {
    ...config,
    provider: "typesafe",
    capabilities: { ...DECISION_CAPABILITIES, ...config.capabilities },
    limits: { ...DECISION_LIMITS, ...config.limits },
    cost: { ...DECISION_COST, ...config.cost },
  };
}

/** Curated Jev registry: the stable alias and the preview alias. */
export const typeSafeModels: readonly ModelConfig[] = [
  defineTypeSafeModel({ model: "jev-latest", displayName: "Jev (latest)" }),
  defineTypeSafeModel({ model: "jev-preview", displayName: "Jev (preview)" }),
];
