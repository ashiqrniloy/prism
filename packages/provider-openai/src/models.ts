import type { ModelConfig } from "@arnilo/prism";
import { OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH } from "./cache.js";

export const openAIModels = [
  {
    provider: "openai",
    model: "gpt-5.1",
    displayName: "GPT-5.1",
    capabilities: { input: ["text", "image", "audio", "file", "document"], output: ["text"], reasoning: true, tools: true, streaming: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    cache: { kind: "openai_key", longRetention: true, maxKeyLength: OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH },
    compat: { api: "openai-responses" },
  },
] as const satisfies readonly ModelConfig[];

export const openAICodexModels = [
  {
    provider: "openai-codex",
    model: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    compat: { api: "openai-codex-responses" },
  },
] as const satisfies readonly ModelConfig[];
