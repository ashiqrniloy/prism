import { runSystemOneLiveScenarios } from "@arnilo/prism/testing";
import { typesafe } from "../index.js";

await runSystemOneLiveScenarios({
  provider: (opts) => typesafe({ apiKey: "env:TYPESAFE_API_KEY", fetch: opts?.fetch }),
  model: process.env.PRISM_LIVE_TYPESAFE_MODEL ?? "jev-latest",
  secretEnv: "TYPESAFE_API_KEY",
  title: "@arnilo/prism-provider-typesafe live tests",
});
