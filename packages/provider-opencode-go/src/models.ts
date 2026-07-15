import type { ModelConfig } from "@arnilo/prism";

export const openCodeGoModels = [
  {
    provider: "opencode-go",
    model: "gpt-5.1-go",
    displayName: "GPT-5.1 via OpenCode Go",
    capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    compat: { route: "openai" },
  },
  {
    provider: "opencode-go",
    model: "claude-sonnet-4.5-go",
    displayName: "Claude Sonnet 4.5 via OpenCode Go",
    capabilities: { input: ["text", "document", "file"], output: ["text"], reasoning: true, tools: true, streaming: true },
    limits: { contextWindow: 200_000, maxOutputTokens: 64_000 },
    compat: { route: "anthropic" },
  },
] as const satisfies readonly ModelConfig[];
