import type { JsonObject, ModelConfig } from "@arnilo/prism";

export interface KimiModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "kimi-coding" | "moonshot";
  readonly compat?: JsonObject & { readonly route?: "anthropic" | "openai"; readonly preserveThinking?: boolean };
}

export function defineKimiModel(config: KimiModelConfig): ModelConfig {
  return { ...config, provider: config.provider ?? "kimi-coding", capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true, ...config.capabilities } };
}

export const kimiCodingModels = [
  defineKimiModel({
    provider: "kimi-coding",
    model: "kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    capabilities: { input: ["text", "document", "file"] },
    limits: { contextWindow: 256_000, maxOutputTokens: 64_000 },
    compat: { route: "anthropic", preserveThinking: true },
  }),
] as const satisfies readonly ModelConfig[];

export const moonshotKimiModels = [
  defineKimiModel({
    provider: "moonshot",
    model: "kimi-k2.7-code-preview",
    displayName: "Kimi K2.7 Code Preview",
    limits: { contextWindow: 256_000, maxOutputTokens: 64_000 },
    compat: { route: "openai", preserveThinking: true },
  }),
] as const satisfies readonly ModelConfig[];
