import { runProviderLiveScenarios } from "@arnilo/prism/testing";
import { commandcode } from "../index.js";

const chatModel = process.env.PRISM_LIVE_COMMANDCODE_CHAT_MODEL ?? "minimax/minimax-m3.1-flash";
const responsesModel = process.env.PRISM_LIVE_COMMANDCODE_RESPONSES_MODEL ?? "gpt-5.6-luna";
const messagesModel = process.env.PRISM_LIVE_COMMANDCODE_MESSAGES_MODEL ?? "claude-haiku-5-5";

runProviderLiveScenarios({
  provider: (opts) => commandcode({ apiKey: "env:COMMAND_CODE_API_KEY", fetch: opts?.fetch }),
  routes: {
    openai: { model: chatModel, structuredOutput: "json_schema" },
    responses: { model: responsesModel, structuredOutput: "json_schema" },
    anthropic: { model: messagesModel },
  },
  // The warm-prefix probe is omitted on purpose: the gateway caches upstream and this provider has
  // no control lever on Chat (measured 0 → 448 → 0 across identical turns) and only opportunistic
  // reads elsewhere. Plan 184/205 Task 3 measures the levers; a green live run must not claim a hit.
  scenarios: ["text", "tool-loop", "structured-output", "abort", "error"],
  secretEnv: ["COMMAND_CODE_API_KEY", "COMMANDCODE_API_KEY"],
  title: "@arnilo/prism-provider-commandcode live tests",
});
