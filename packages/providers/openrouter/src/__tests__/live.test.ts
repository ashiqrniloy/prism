import { runProviderLiveScenarios } from "@arnilo/prism/testing";
import { listOpenRouterModels, openrouter } from "../index.js";

const freeModel = process.env.PRISM_LIVE_OPENROUTER_MODEL ?? "recursive/flint-v1.0:free";
const cacheModel = process.env.PRISM_LIVE_OPENROUTER_CACHE_MODEL ?? "anthropic/claude-haiku-4.5";
function provider(modelId: string, maxTokens = 768) {
  return async (opts?: { fetch?: typeof fetch }) => {
    const models = await listOpenRouterModels({ fetch: opts?.fetch });
    const model = models.find((entry) => entry.model === modelId);
    if (!model)
      throw new Error(
        `OpenRouter model retired or unavailable: ${modelId}; override the corresponding PRISM_LIVE_OPENROUTER_*_MODEL variable.`,
      );
    // 768 tokens: the pinned free model is a reasoning model, and a 128-token cap truncates JSON/structured answers.
    return openrouter({ apiKey: "env:OPENROUTER_API_KEY", fetch: opts?.fetch, models: [{ ...model, parameters: { maxTokens } }] });
  };
}
runProviderLiveScenarios({
  provider: provider(freeModel),
  routes: { openai: { model: freeModel, structuredOutput: "json_schema" } },
  scenarios: ["text", "tool-loop", "structured-output", "abort", "error"],
  secretEnv: "OPENROUTER_API_KEY",
  title: "@arnilo/prism-provider-openrouter pinned free live",
  skipUnless: () => (freeModel.endsWith(":free") ? false : "PRISM_LIVE_OPENROUTER_MODEL must pin a :free model, not a random router"),
});
runProviderLiveScenarios({
  provider: provider(cacheModel, 128),
  routes: {
    openai: {
      model: cacheModel,
      sessionId: `prism-openrouter-cache-${Date.now()}`,
      cachePrefix: "Stable reference facts for prefix reuse. Each numbered fact stays unchanged across turns.\n".repeat(600),
    },
  },
  scenarios: ["cache"],
  secretEnv: "OPENROUTER_API_KEY",
  title: "@arnilo/prism-provider-openrouter paid cache live",
  skipUnless: () =>
    process.env.PRISM_LIVE_OPENROUTER_PAID !== "1"
      ? "paid cache disabled; set PRISM_LIVE_OPENROUTER_PAID=1 with spend approval"
      : cacheModel.startsWith("anthropic/")
        ? false
        : "paid cache model must be anthropic/*",
});
