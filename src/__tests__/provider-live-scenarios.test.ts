import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelConfig, ProviderEvent, ProviderRequest } from "../contracts.js";
import { toolCallContent } from "../index.js";
import { replayFetch } from "../provider-kit/wire-replay.js";
import {
  executeProviderLiveScenarios,
  liveScenarioAbort,
  liveScenarioCacheProbe,
  liveScenarioErrorResponse,
  liveScenarioStructuredOutput,
  liveScenarioStructuredToolLoop,
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
  it("live_scenarios_name_the_provider_error_instead_of_an_empty_answer", async () => {
    // A billing/quota/retired-model refusal ends the stream with an `error` event; the failed
    // assertion must carry its message (masked) rather than report "empty".
    const secret = "sk-live-fake-0123456789";
    const provider = {
      id: "fake",
      async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
        yield { type: "error", error: new Error(`fake request failed: 402 no credits for ${secret}`) } as ProviderEvent;
      },
    } as any;
    const model: ModelConfig = { provider: "fake", model: "m" };
    for (const run of [
      () => liveScenarioTextStream({ provider, model, route: "openai", secrets: [secret] }),
      () => liveScenarioToolLoop({ provider, model, route: "openai", secrets: [secret] }),
    ]) {
      await assert.rejects(run, (error: Error) => {
        assert.match(error.message, /provider error: fake request failed: 402 no credits/);
        assert.ok(!error.message.includes(secret), "the credential must be masked");
        return true;
      });
    }
  });

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
    const textProvider = createHyperProvider({ apiKey: async () => "fake-key", fetch: replayFetch(textFixture) });
    const textRes = await liveScenarioTextStream({
      provider: textProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
    });
    assert.ok(textRes.text.length > 0);

    // Scenario 2: tool loop with thinking replay
    const toolLoopProvider = createHyperProvider({ apiKey: async () => "fake-key", fetch: replayFetch(toolLoopFixture) });
    const toolRes = await liveScenarioToolLoop({
      provider: toolLoopProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
    });
    assert.equal(toolRes.toolCalls.length, 1);
    assert.equal(toolRes.toolCalls[0]!.name, "get_weather");

    // Scenario 3: structured output
    const structProvider = createHyperProvider({ apiKey: async () => "fake-key", fetch: replayFetch(structuredFixture) });
    const structRes = await liveScenarioStructuredOutput({
      provider: structProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
      structuredOutput: "json_schema",
      schema: structuredFixture.requestBody.response_format.json_schema.schema,
    });
    assert.equal(structRes.ok, true);
    assert.equal(typeof structRes.value, "object");

    // Scenario 4: abort before first request
    const abortProvider = createHyperProvider({
      apiKey: async () => "fake-key",
      fetch: () => {
        throw new Error("should not fetch");
      },
    });
    await liveScenarioAbort({ provider: abortProvider, model, route: "openai" });

    // Scenario 5: error leaking no secret
    const errProvider = createHyperProvider({ apiKey: async () => "fake-key", fetch: replayFetch(errorFixture) });
    await liveScenarioErrorResponse({
      provider: errProvider,
      model,
      route: "openai",
      secrets: ["fake-key"],
    });

    // Scenario 6: warm-prefix cache probe
    const cacheProvider = createHyperProvider({ apiKey: async () => "fake-key", fetch: replayFetch(cacheFixture) });
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
    const decisionProvider = createTypeSafeProvider({ apiKey: async () => "fake-key", fetch: replayFetch(decisionFixture) });
    const decRes = await systemOneScenarioDecision({
      provider: decisionProvider,
      model: jModel,
      secrets: ["fake-key"],
      schema: decisionFixture.request.options.structuredOutput.schema,
    });
    assert.equal(typeof (decRes.decision as { irreversible: boolean }).irreversible, "boolean");

    // System One: tools rejected before fetch
    const toolRejProvider = createTypeSafeProvider({
      apiKey: async () => "fake-key",
      fetch: () => {
        throw new Error("should not fetch");
      },
    });
    await systemOneScenarioToolsRejected({ provider: toolRejProvider, model: jModel, secrets: ["fake-key"] });

    // System One: abort
    await systemOneScenarioAbort({ provider: toolRejProvider, model: jModel });

    // System One: error leaking no secret
    const sysErrProvider = createTypeSafeProvider({ apiKey: async () => "fake-key", fetch: replayFetch(sysOneErrorFixture) });
    await systemOneScenarioErrorResponse({ provider: sysErrProvider, model: jModel, secrets: ["fake-key"] });

    // 3. Multi-scenario programmatic runner
    const multiExchanges = [textFixture, toolLoopFixture[0], toolLoopFixture[1], structuredFixture, errorFixture, cacheFixture];
    const multiProvider = createHyperProvider({ apiKey: async () => "fake-key", fetch: replayFetch(multiExchanges) });
    const multiExecResult = await executeProviderLiveScenarios({
      provider: multiProvider,
      routes: {
        openai: {
          model: "deepseek-v4-pro",
          structuredOutput: "json_schema",
          structuredSchema: structuredFixture.requestBody.response_format.json_schema.schema,
        },
      },
      // The structured tool loop is a session run; it has its own hermetic test below.
      scenarios: ["text", "tool-loop", "structured-output", "abort", "error", "cache"],
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

  it("live_structured_output_validates_the_reply_against_the_schema", async () => {
    const reply = '{"nope":"reply-content-marker"}';
    const provider = {
      id: "fake",
      async *generate(): AsyncIterable<ProviderEvent> {
        yield { type: "content_delta", content: { type: "text", text: reply } };
        yield { type: "done", stopReason: "end_turn" };
      },
    };
    const model: ModelConfig = { provider: "fake", model: "m" };
    await assert.rejects(
      () => liveScenarioStructuredOutput({ provider, model, route: "openai", secrets: [], structuredOutput: "json_schema" }),
      (error: Error) => {
        assert.match(error.message, /schema_mismatch/);
        assert.ok(!error.message.includes("reply-content-marker"), "the failure must not quote the reply");
        return true;
      },
    );
  });

  function structuredToolLoopProvider(finalReply: string) {
    const requests: ProviderRequest[] = [];
    const provider = {
      id: "fake",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        requests.push(request);
        if (!request.messages.some((message) => message.role === "tool")) {
          yield { type: "tool_call", call: toolCallContent("call-1", "get_weather", { location: "Tokyo" }) };
          yield { type: "done", stopReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", content: { type: "text", text: finalReply } };
        yield { type: "done", stopReason: "end_turn" };
      },
    };
    return { provider, requests };
  }

  it("live_structured_tool_loop_sends_the_native_schema_next_to_tools_on_every_turn", async () => {
    const { provider, requests } = structuredToolLoopProvider('{"location":"Tokyo","temperature":"18C"}');
    const result = await executeProviderLiveScenarios({
      provider,
      routes: { openai: { model: "m", structuredOutput: "json_schema" } },
      scenarios: ["structured-tool-loop"],
    });
    const details = result.scenarios[0]!.details as { mode: string; requests: number; toolCalls: number; value: unknown };
    assert.equal(details.mode, "native");
    assert.equal(details.requests, 2);
    assert.equal(details.toolCalls, 1);
    assert.deepEqual(details.value, { location: "Tokyo", temperature: "18C" });
    for (const request of requests) {
      assert.equal(request.options?.structuredOutput?.repair, 0, "native mode proves the schema without a repair");
      assert.ok(request.tools?.some((tool) => tool.name === "get_weather"));
    }
  });

  it("live_structured_tool_loop_uses_prompted_mode_without_the_capability", async () => {
    const { provider, requests } = structuredToolLoopProvider('```json\n{"location":"Tokyo","temperature":"18C"}\n```');
    const res = await liveScenarioStructuredToolLoop({
      provider,
      model: { provider: "fake", model: "m" },
      route: "anthropic",
      secrets: [],
    });
    assert.equal(res.mode, "prompted");
    assert.equal(res.requests, 2);
    for (const request of requests) assert.equal(request.options?.structuredOutput, undefined);
  });

  it("live_structured_tool_loop_fails_on_an_invalid_native_reply_without_quoting_it", async () => {
    const { provider, requests } = structuredToolLoopProvider('{"location":"reply-content-marker"}');
    await assert.rejects(
      () =>
        liveScenarioStructuredToolLoop({
          provider,
          model: { provider: "fake", model: "m" },
          route: "openai",
          secrets: [],
          structuredOutput: "json_schema",
        }),
      (error: Error) => {
        assert.match(error.message, /schema_mismatch/);
        assert.ok(!error.message.includes("reply-content-marker"), "the failure must not quote the reply");
        return true;
      },
    );
    assert.equal(requests.length, 2, "native mode runs with repair: 0");
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
