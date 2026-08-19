import type { JsonObject, ModelConfig } from "@arnilo/prism";
import { type ClinePassThinkingLevelMap, CLINEPASS_THINKING_MAPS } from "./thinking.js";

export const CLINEPASS_DEFAULT_BASE_URL = "https://api.cline.bot/api/v1";

export interface ClinePassModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "clinepass";
  readonly thinkingLevelMap: ClinePassThinkingLevelMap;
  readonly compat?: JsonObject;
}

export function defineClinePassModel(config: ClinePassModelConfig): ModelConfig {
  const { thinkingLevelMap, ...rest } = config;
  return {
    ...rest,
    provider: "clinepass",
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
    compat: {
      thinkingLevelMap,
      reasoning_effort: "high",
      ...config.compat,
    },
  };
}

const featured: readonly ClinePassModelConfig[] = [
  row("cline-pass/glm-5.2", "GLM-5.2 (ClinePass)", 200_000, 131_072, { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.glm),
  row("cline-pass/kimi-k3", "Kimi K3 (ClinePass)", 1_048_576, 131_072, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.kimiK3),
  row("cline-pass/kimi-k2.7-code", "Kimi K2.7 Code (ClinePass)", 262_144, 131_072, { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.kimi),
  row("cline-pass/kimi-k2.6", "Kimi K2.6 (ClinePass)", 262_144, 131_072, { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.kimi),
  row("cline-pass/deepseek-v4-pro", "DeepSeek V4 Pro (ClinePass)", 1_000_000, 384_000, { input: 1.74, output: 3.48, cacheRead: 0.0145, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.deepseek),
  row("cline-pass/deepseek-v4-flash", "DeepSeek V4 Flash (ClinePass)", 1_000_000, 384_000, { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.deepseek),
  row("cline-pass/mimo-v2.5", "MiMo-V2.5 (ClinePass)", 262_144, 131_072, { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.standard),
  row("cline-pass/mimo-v2.5-pro", "MiMo-V2.5-Pro (ClinePass)", 262_144, 131_072, { input: 1.74, output: 3.48, cacheRead: 0.0145, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.standard),
  row("cline-pass/minimax-m3", "MiniMax M3 (ClinePass)", 1_048_576, 131_072, { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, CLINEPASS_THINKING_MAPS.standard),
  row("cline-pass/qwen3.8-max", "Qwen3.8 Max (ClinePass)", 262_144, 131_072, { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 }, CLINEPASS_THINKING_MAPS.standard),
  row("cline-pass/qwen3.7-max", "Qwen3.7 Max (ClinePass)", 262_144, 131_072, { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 }, CLINEPASS_THINKING_MAPS.standard),
  row("cline-pass/qwen3.7-plus", "Qwen3.7 Plus (ClinePass)", 1_048_576, 131_072, { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 }, CLINEPASS_THINKING_MAPS.standard),
];

export const clinePassModels = featured.map(defineClinePassModel);

export const CLINEPASS_FEATURED_SLUGS = featured.map((model) => model.model);

function row(
  model: string,
  displayName: string,
  contextWindow: number,
  maxOutputTokens: number,
  cost: NonNullable<ModelConfig["cost"]>,
  thinkingLevelMap: ClinePassThinkingLevelMap,
): ClinePassModelConfig {
  return { model, displayName, limits: { contextWindow, maxOutputTokens }, cost, thinkingLevelMap };
}
