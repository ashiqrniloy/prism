import { runProviderLiveScenarios } from "@arnilo/prism/testing";
import { kilo } from "../index.js";

const chatModel = process.env.PRISM_LIVE_KILO_CHAT_MODEL ?? "google/gemma-4-26b-a4b-it";
const responsesModel = process.env.PRISM_LIVE_KILO_RESPONSES_MODEL ?? "openai/gpt-6-luna";
const messagesModel = process.env.PRISM_LIVE_KILO_MESSAGES_MODEL ?? "anthropic/claude-haiku-5.5";

runProviderLiveScenarios({
  provider: (opts) => kilo({ apiKey: "env:KILO_API_KEY", fetch: opts?.fetch }),
  routes: {
    openai: { model: chatModel, structuredOutput: "json_schema" },
    responses: { model: responsesModel, structuredOutput: "json_schema" },
    anthropic: {
      // The Messages wire has no structured-output field; an explicit model without the capability
      // makes the shared scenario prove the local rejection instead of a silent text answer.
      provider: "kilo",
      model: messagesModel,
      capabilities: { input: ["text", "image"], output: ["text"], tools: true },
      compat: { route: "messages" },
    },
  },
  // No warm-prefix assertion: the gateway places its own breakpoints (plan 213 Task 1b), so
  // a green run must not claim Prism's markers caused a hit.
  scenarios: ["text", "tool-loop", "structured-output", "abort", "error"],
  secretEnv: ["KILO_API_KEY"],
  title: "@arnilo/prism-ai/kilo live tests",
});
