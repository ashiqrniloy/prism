import type { JsonObject, ModelConfig } from "prism";

export interface ZaiModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "zai";
  readonly compat?: JsonObject & {
    readonly thinking?: boolean | JsonObject;
    readonly reasoning_effort?: string;
    readonly tool_stream?: boolean;
  };
}

export function defineZaiModel(config: ZaiModelConfig): ModelConfig {
  return { ...config, provider: "zai", capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true, ...config.capabilities } };
}

export const zaiModels = [
  defineZaiModel({
    model: "glm-4.7",
    displayName: "GLM-4.7",
    limits: { contextWindow: 128_000, maxOutputTokens: 32_000 },
    compat: { thinking: true, reasoning_effort: "medium", tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-4.5",
    displayName: "GLM-4.5",
    limits: { contextWindow: 128_000, maxOutputTokens: 32_000 },
    compat: { thinking: true, reasoning_effort: "medium", tool_stream: true },
  }),
] as const satisfies readonly ModelConfig[];
