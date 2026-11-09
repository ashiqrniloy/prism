import { runProviderLiveScenarios, runSystemOneLiveScenarios } from "@arnilo/prism/testing";
import { ollamaCloud } from "../index.js";

runProviderLiveScenarios({
  provider: (options) => ollamaCloud({ apiKey: "env:OLLAMA_API_KEY", fetch: options?.fetch }),
  routes: {
    native: {
      model: process.env.PRISM_LIVE_OLLAMA_CLOUD_MODEL ?? "gemma4:31b",
      structuredOutput: "json_schema",
      cacheModel: process.env.PRISM_LIVE_OLLAMA_CLOUD_THINKING_MODEL ?? "gpt-oss:20b",
      // This cloud answers the shared schema-less prompt in prose, and accepts an empty
      // `messages` array, so the shared scenarios use their per-route hooks.
      structuredPrompt: "Return a JSON object with the single boolean key ok set to true.",
      errorModel: "prism-no-such-model:1b",
    },
    openai: {
      model: process.env.PRISM_LIVE_OLLAMA_CLOUD_MODEL ?? "gemma4:31b",
      structuredOutput: "json_schema",
      structuredPrompt: "Return a JSON object with the single boolean key ok set to true.",
      errorModel: "prism-no-such-model:1b",
    },
  },
  secretEnv: ["OLLAMA_API_KEY"],
  title: "@arnilo/prism-provider-ollama-cloud live tests",
});

// Decision models (`/api/show` capability `decision`) answer the System One wire at `/v1/systemone`.
await runSystemOneLiveScenarios({
  provider: (options) => ollamaCloud({ apiKey: "env:OLLAMA_API_KEY", fetch: options?.fetch }),
  model: process.env.PRISM_LIVE_OLLAMA_CLOUD_DECISION_MODEL ?? "clef:27b",
  secretEnv: "OLLAMA_API_KEY",
  decideTestName: "ollama_cloud_live_decide",
  title: "@arnilo/prism-provider-ollama-cloud decision live tests",
});
