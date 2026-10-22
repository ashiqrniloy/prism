import { runProviderLiveScenarios } from "@arnilo/prism/testing";
import { opencodeGo } from "../index.js";

runProviderLiveScenarios({
  provider: (opts) => opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY", fetch: opts?.fetch }),
  routes: {
    openai: {
      model: process.env.PRISM_LIVE_OPENCODE_GO_CHAT_MODEL ?? process.env.PRISM_LIVE_OPENCODE_MODEL ?? "mimo-v2.5",
      structuredOutput: "json_schema",
    },
    anthropic: {
      model: process.env.PRISM_LIVE_OPENCODE_GO_MESSAGES_MODEL ?? "qwen3.6-plus",
      cacheModel: "minimax-m3",
    },
  },
  secretEnv: ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"],
  title: "@arnilo/prism-provider-opencode-go live tests",
});
