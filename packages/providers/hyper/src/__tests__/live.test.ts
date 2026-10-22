import { runProviderLiveScenarios } from "@arnilo/prism/testing";
import { hyper } from "../index.js";

runProviderLiveScenarios({
  provider: (opts) => hyper({ apiKey: "env:HYPER_API_KEY", fetch: opts?.fetch }),
  routes: {
    openai: process.env.PRISM_LIVE_HYPER_CHAT_MODEL ?? "deepseek-v4-pro",
    anthropic: process.env.PRISM_LIVE_HYPER_MESSAGES_MODEL ?? "qwen3.6-plus",
  },
  secretEnv: "HYPER_API_KEY",
  title: "@arnilo/prism-provider-hyper live probes",
});
