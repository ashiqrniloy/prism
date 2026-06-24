import type { ModelConfig } from "@arnilo/prism";

export const openAIModels = [
  {
    provider: "openai",
    model: "gpt-5.1",
    displayName: "GPT-5.1",
    capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    compat: { api: "openai-responses" },
  },
] as const satisfies readonly ModelConfig[];

export const openAICodexModels = [
  {
    provider: "openai-codex",
    model: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    compat: { api: "openai-codex-responses" },
  },
] as const satisfies readonly ModelConfig[];
