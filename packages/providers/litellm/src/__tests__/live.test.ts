import { runProviderLiveScenarios } from "@arnilo/prism/testing";
import { createLiteLLMProvider } from "../index.js";

const baseUrl = process.env.PRISM_LIVE_LITELLM_BASE_URL ?? "http://127.0.0.1:4000";
const modelId = process.env.PRISM_LIVE_LITELLM_MODEL ?? "prism-free/gpt-oss-20b@groq";

/** The proxy is host-run: no listener is a skip, never a failure (plan 214 Task 2). */
async function unreachableReason(): Promise<string | false> {
  if (!process.env.LITELLM_API_KEY) return "LITELLM_API_KEY is not set";
  try {
    const response = await fetch(`${baseUrl}/health/liveliness`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? false : `proxy at ${baseUrl} answered ${response.status}`;
  } catch {
    return `no LiteLLM proxy at ${baseUrl}`;
  }
}

const skip = await unreachableReason();

runProviderLiveScenarios({
  // A plain string here is a literal credential value, not a ref: the live suite reads the env itself.
  provider: (options) =>
    createLiteLLMProvider({
      baseUrl,
      apiKey: async () => process.env.LITELLM_API_KEY,
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    }),
  routes: { openai: { model: modelId } },
  // No structured-output leg: the pool's deployments report `supports_response_schema: null`, so the
  // capability stays unclaimed instead of being asserted on an unmeasured backend.
  scenarios: ["text", "tool-loop", "abort", "error"],
  secretEnv: ["LITELLM_API_KEY"],
  title: "@arnilo/prism-provider-litellm live",
  skipUnless: () => skip,
});
