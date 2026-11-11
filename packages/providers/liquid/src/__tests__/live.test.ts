import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { runSystemOneLiveScenarios } from "@arnilo/prism/testing";
import { createLiquidLocalProvider, createLiquidProvider, LIQUID_LOCAL_BASE_URL, liquid } from "../index.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE = `data:image/png;base64,${PNG}`;

/** `llama-server` answers `/health` with 200 once the model is loaded. */
async function llamaServerReachable(baseUrl: string): Promise<{ reachable: boolean; reason?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { reachable: false, reason: `llama-server answered ${response.status} at ${baseUrl}` };
    return { reachable: true };
  } catch (error) {
    return {
      reachable: false,
      reason: `llama-server is not running at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const hostedModels = (process.env.PRISM_LIVE_LIQUID_MODELS ?? "d1.1,d1-ultra")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

for (const model of hostedModels) {
  await runSystemOneLiveScenarios({
    provider: (opts) => liquid({ apiKey: "env:LIQUID_API_KEY", fetch: opts?.fetch }),
    model,
    secretEnv: "LIQUID_API_KEY",
    decideTestName: "liquid_live_decide",
    title: `@arnilo/prism-ai/liquid hosted live tests (${model})`,
  });
}

const localBaseUrl = process.env.PRISM_LIVE_LLAMA_SERVER_URL ?? LIQUID_LOCAL_BASE_URL;

await runSystemOneLiveScenarios({
  provider: (opts) => liquid({ hosted: false, localBaseUrl, fetch: opts?.fetch }),
  model: process.env.PRISM_LIVE_LIQUID_LOCAL_MODEL ?? "d1-3B",
  baseUrl: localBaseUrl,
  reachabilityCheck: llamaServerReachable,
  skipUnless: () =>
    process.env.PRISM_LIVE_LLAMA_SERVER_URL === undefined
      ? "set PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_LLAMA_SERVER_URL to run the local d1-3B live tests"
      : false,
  decideTestName: "liquid_live_decide",
  title: "@arnilo/prism-ai/liquid local d1-3B live tests",
});

// One image request per provider: the hosted rows also prove which model id answers and what `model` it echoes.
const hostedSkip = !process.env.LIQUID_API_KEY ? "set LIQUID_API_KEY to run the hosted image probe" : false;
const localSkip =
  process.env.PRISM_LIVE_LLAMA_SERVER_URL === undefined ? "set PRISM_LIVE_LLAMA_SERVER_URL to run the local image probe" : false;

describe("@arnilo/prism-ai/liquid live image probes", () => {
  it.skipIf(hostedSkip !== false)("liquid_live_hosted_decide_with_image", async () => {
    const provider = createLiquidProvider({ apiKey: async () => process.env.LIQUID_API_KEY });
    const result = await provider.decisions!().decide({
      model: "d1.1",
      state: "screenshot",
      images: [IMAGE],
      questions: { urgent: { type: "noul", instructions: "Is the customer blocked right now?" } },
    });
    assert.equal(result.answers.urgent.type, "noul");
    console.log(`[liquid live] hosted image: model=${result.model} usage=${JSON.stringify(result.usage)}`);
  });

  it.skipIf(localSkip !== false)("liquid_live_local_decide_with_image", async () => {
    const provider = createLiquidLocalProvider({ baseUrl: localBaseUrl, apiKey: undefined });
    const result = await provider.decisions!().decide({
      model: "d1-3B",
      state: "screenshot",
      images: [IMAGE],
      questions: { urgent: { type: "noul", instructions: "Is the customer blocked right now?" } },
    });
    assert.equal(result.answers.urgent.type, "noul");
    console.log(`[liquid live] local image: model=${result.model} usage=${JSON.stringify(result.usage)}`);
  });
});

describe("@arnilo/prism-ai/liquid live skip probe", () => {
  it("liquid_local_live_skips_cleanly_when_server_absent", async () => {
    const check = await llamaServerReachable("http://127.0.0.1:59999");
    assert.equal(check.reachable, false);
    assert.match(check.reason ?? "", /llama-server is not running/);
  });
});
