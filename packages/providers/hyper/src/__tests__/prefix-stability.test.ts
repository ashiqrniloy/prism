import { describe, it } from "bun:test";
import type { JsonObject, ModelConfig, ProviderRequest, Skill } from "@arnilo/prism";
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";
import { createHyperProvider } from "../index.js";

// Plan 215 Task 22: the real route encoder, thinking replay on, a skill load mid-session, ten requests.
// Segment equality (tools, system, earlier messages) is what the upstream prompt cache keys on.

const alpha: Skill = { name: "alpha", description: "Alpha catalog entry", instructions: "Alpha body: measure twice, cut once." };
const beta: Skill = { name: "beta", description: "Beta catalog entry", instructions: "Beta body: prefer deletion over addition." };

const openaiModel: ModelConfig = {
  provider: "hyper",
  model: "deepseek-v4-pro",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true },
  cache: { kind: "implicit" },
};

const anthropicModel: ModelConfig = {
  provider: "hyper",
  model: "qwen3.6-plus",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "anthropic", preserveThinking: true },
  cache: { kind: "cache_control", maxBreakpoints: 4 },
};

const provider = createHyperProvider({ apiKey: async () => "unused-offline" });

async function stable(model: ModelConfig): Promise<void> {
  const started = performance.now();
  const encode = (request: ProviderRequest): Promise<JsonObject> => provider.encode({ ...request, model });
  const result = await runPrefixStabilityConformance({
    host: {
      model: { provider: "mock", model: "demo", capabilities: { tools: true } },
      instructions: `Stable rules. ${"Keep the prefix byte-stable. ".repeat(120)}`,
    },
    skills: [alpha, beta],
    reasoningFixture: true,
    turns: 5,
    encode,
  });
  if (result.requests !== 10 || result.wirePairs !== 9) throw new Error(`expected 10 requests / 9 wire pairs, got ${result.requests} / ${result.wirePairs}`);
  if (performance.now() - started >= 500) throw new Error("wire run must stay under 500 ms offline");
}

describe("@arnilo/prism-provider-hyper wire prefix stability", () => {
  it("hyper_wire_prefix_stable_openai", () => stable(openaiModel));
  it("hyper_wire_prefix_stable_anthropic", () => stable(anthropicModel));
});
