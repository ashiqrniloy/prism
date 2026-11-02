import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelConfig, ProviderEvent, ProviderRequest } from "../contracts.js";
import { replayFetch } from "../provider-kit/wire-replay.js";
import {
  executeProviderLiveScenarios,
  liveScenarioAbort,
  liveScenarioCacheProbe,
  liveScenarioErrorResponse,
  liveScenarioStructuredOutput,
  liveScenarioTextStream,
  liveScenarioToolLoop,
  runProviderLiveScenarios,
  runSystemOneLiveScenarios,
  systemOneScenarioAbort,
  systemOneScenarioDecision,
  systemOneScenarioErrorResponse,
  systemOneScenarioToolsRejected,
} from "../testing/provider-live-scenarios.js";

const rootDir = process.cwd();

function readJson(relPath: string) {
  return JSON.parse(readFileSync(join(rootDir, relPath), "utf8"));
}

describe("provider live scenarios", () => {
  it("live_scenarios_run_hermetically_on_recordings", async () => {
    // 1. Routed provider scenarios over replayFetch (using Hyper OpenAI Chat wire recordings)
    const textFixture = readJson("packages/providers/hyper/src/__tests__/wire/openai/text.json");
    const toolLoopFixture = readJson("packages/providers/hyper/src/__tests__/wire/openai/tool-loop.json");
    const structuredFixture = readJson("packages/providers/hyper/src/__tests__/wire/openai/structured-output.json");
    const errorFixture = readJson("packages/providers/hyper/src/__tests__/wire/openai/error.json");
    const cacheFixture = readJson("packages/providers/hyper/src/__tests__/wire/openai/cache.json");

    const hyperPath = "../../packages/providers/hyper/src/index.js";
    const hyperMod: any = await import(hyperPath);
    const { createHyperProvider, hyperModels } = hyperMod;
    const model = hyperModels.find((m: ModelConfig) => m.model === "deepseek-v4-pro")!;

    // Scenario 1: text stream
    const textProvider = createHyperProvider({ apiKey: "fake-key", fetch: replayFetch(textFixture) });
    const textRes = await liveScenarioTextStream({
      provider: textProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
    });
    assert.ok(textRes.text.length > 0);

    // Scenario 2: tool loop with thinking replay
    const toolLoopProvider = createHyperProvider({ apiKey: "fake-key", fetch: replayFetch(toolLoopFixture) });
    const toolRes = await liveScenarioToolLoop({
      provider: toolLoopProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
    });
    assert.equal(toolRes.toolCalls.length, 1);
    assert.equal(toolRes.toolCalls[0]!.name, "get_weather");

    // Scenario 3: structured output
    const structProvider = createHyperProvider({ apiKey: "fake-key", fetch: replayFetch(structuredFixture) });
    const structRes = await liveScenarioStructuredOutput({
      provider: structProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
      structuredOutput: "json_schema",
    });
    assert.equal(structRes.ok, true);
    assert.equal(typeof structRes.value, "object");

    // Scenario 4: abort before first request
    const abortProvider = createHyperProvider({
      apiKey: "fake-key",
      fetch: () => {
        throw new Error("should not fetch");
      },
    });
    await liveScenarioAbort({ provider: abortProvider, model, route: "openai" });

    // Scenario 5: error leaking no secret
    const errProvider = createHyperProvider({ apiKey: "fake-key", fetch: replayFetch(errorFixture) });
    await liveScenarioErrorResponse({
      provider: errProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
    });

    // Scenario 6: warm-prefix cache probe
    const cacheProvider = createHyperProvider({ apiKey: "fake-key", fetch: replayFetch(cacheFixture) });
    const cacheRes = await liveScenarioCacheProbe({
      provider: cacheProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
      isHermetic: true,
    });
    assert.ok((cacheRes.turn2Usage?.cacheReadTokens ?? 0) > 0);

    // 2. System One provider scenarios over replayFetch (using TypeSafe wire recordings)
    const typesafePath = "../../packages/providers/typesafe/src/index.js";
    const typesafeMod: any = await import(typesafePath);
    const { createTypeSafeProvider, typeSafeModels } = typesafeMod;
    const jModel = typeSafeModels.find((m: ModelConfig) => m.model === "jev-latest")!;

    const decisionFixture = readJson("packages/providers/typesafe/src/__tests__/wire/systemone/decision.json");
    const sysOneErrorFixture = readJson("packages/providers/typesafe/src/__tests__/wire/systemone/error.json");

    // System One: decision
    const decisionProvider = createTypeSafeProvider({ apiKey: "fake-key", fetch: replayFetch(decisionFixture) });
    const decRes = await systemOneScenarioDecision({
      provider: decisionProvider,
      model: jModel,
      secrets: ["fake-key"],
      schema: decisionFixture.request.options.structuredOutput.schema,
    });
    assert.equal(typeof (decRes.decision as { irreversible: boolean }).irreversible, "boolean");

    // System One: tools rejected before fetch
    const toolRejProvider = createTypeSafeProvider({
      apiKey: "fake-key",
      fetch: () => {
        throw new Error("should not fetch");
      },
    });
    await systemOneScenarioToolsRejected({ provider: toolRejProvider, model: jModel, secrets: ["fake-key"] });

    // System One: abort
    await systemOneScenarioAbort({ provider: toolRejProvider, model: jModel });

    // System One: error leaking no secret
    const sysErrProvider = createTypeSafeProvider({ apiKey: "fake-key", fetch: replayFetch(sysOneErrorFixture) });
    await systemOneScenarioErrorResponse({ provider: sysErrProvider, model: jModel, secrets: ["fake-key"] });

    // 3. Multi-scenario programmatic runner
    const multiExchanges = [textFixture, toolLoopFixture[0], toolLoopFixture[1], structuredFixture, errorFixture, cacheFixture];
    const multiProvider = createHyperProvider({ apiKey: "fake-key", fetch: replayFetch(multiExchanges) });
    const multiExecResult = await executeProviderLiveScenarios({
      provider: multiProvider,
      routes: {
        openai: {
          model: "deepseek-v4-pro",
          structuredOutput: "json_schema",
        },
      },
      secrets: ["fake-key"],
      isHermetic: true,
    });
    assert.equal(multiExecResult.ok, true);
    assert.equal(multiExecResult.scenarios.length, 6);
  });

  it("live_scenarios_use_per_route_structured_prompt_and_error_model", async () => {
    const requests: ProviderRequest[] = [];
    const provider = {
      id: "fake-cloud",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        requests.push(request);
        const unknown = request.model.model === "prism-no-such-model:1b";
        if (unknown) {
          yield { type: "error", error: { message: "model not found", failureClass: "permanent" } };
          return;
        }
        yield { type: "content_delta", content: { type: "text", text: '{"ok":true}' } };
        yield { type: "done", stopReason: "end_turn" };
      },
    };
    const result = await executeProviderLiveScenarios({
      provider,
      routes: {
        openai: {
          model: "some-model",
          structuredOutput: "json_schema",
          structuredPrompt: 'Return {"ok":true}',
          errorModel: "prism-no-such-model:1b",
        },
      },
      scenarios: ["structured-output", "error"],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.scenarios.map((entry) => entry.scenario),
      ["structured-output", "error"],
    );
    const firstBlock = requests[0]!.messages[0]!.content[0]!;
    assert.equal(firstBlock.type === "text" ? firstBlock.text : undefined, 'Return {"ok":true}');
    assert.equal(requests[1]?.model.model, "prism-no-such-model:1b", "error scenario must use the hook model");
    assert.ok(requests[1]!.messages.length > 0, "error scenario with a hook model sends a normal message");
  });

  it("live_scenarios_skip_without_credentials", async () => {
    // Assert that when PRISM_LIVE_PROVIDER_TESTS is not 1, no provider creation or network fetch happens
    const prevLive = process.env.PRISM_LIVE_PROVIDER_TESTS;
    try {
      delete process.env.PRISM_LIVE_PROVIDER_TESTS;

      let providerCalled = false;
      const providerRes = runProviderLiveScenarios({
        provider: () => {
          providerCalled = true;
          throw new Error("should not be called");
        },
        routes: { openai: "deepseek-v4-pro" },
        secretEnv: "HYPER_API_KEY",
      });
      assert.equal(providerCalled, false, "runProviderLiveScenarios must not invoke provider factory when skipped");
      assert.equal(providerRes.skipped, true);
      assert.match(providerRes.reason ?? "", /PRISM_LIVE_PROVIDER_TESTS/);

      let sysOneCalled = false;
      const sysOneRes = await runSystemOneLiveScenarios({
        provider: () => {
          sysOneCalled = true;
          throw new Error("should not be called");
        },
        model: "jev-latest",
        secretEnv: "TYPESAFE_API_KEY",
      });
      assert.equal(sysOneCalled, false, "runSystemOneLiveScenarios must not invoke provider factory when skipped");
      assert.equal(sysOneRes.skipped, true);
      assert.match(sysOneRes.reason ?? "", /PRISM_LIVE_PROVIDER_TESTS/);
    } finally {
      if (prevLive !== undefined) process.env.PRISM_LIVE_PROVIDER_TESTS = prevLive;
    }
  });
});
