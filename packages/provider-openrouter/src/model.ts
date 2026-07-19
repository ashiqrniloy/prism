import type { JsonObject, ModelConfig } from "@arnilo/prism";

export interface OpenRouterModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "openrouter";
  readonly compat?: JsonObject & {
    readonly openRouterRouting?: JsonObject;
    readonly openRouterCache?: boolean;
    /** Official OpenRouter `reasoning` object (`effort`, `max_tokens`, `exclude`, …). */
    readonly reasoning?: JsonObject;
    /** Replay assistant thinking as body `reasoning` (tool-call continuity). */
    readonly preserveThinking?: boolean;
  };
}

export function defineOpenRouterModel(config: OpenRouterModelConfig): ModelConfig {
  return {
    ...config,
    provider: "openrouter",
    capabilities: { streaming: true, tools: true, structuredOutput: "json_schema", ...config.capabilities },
  };
}
