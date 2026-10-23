import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { systemOneConformance } from "@arnilo/prism/provider-kit";
import {
  createLiquidLocalProvider,
  createLiquidProvider,
  defineLiquidModel,
  LIQUID_API_KEY_ENV,
  LIQUID_DEFAULT_API_KEY_REF,
  LIQUID_DEFAULT_BASE_URL,
  LIQUID_DEFAULT_PATH,
  LIQUID_LOCAL_BASE_URL,
  liquidLocalModels,
  liquidModels,
} from "../index.js";

describe("@arnilo/prism-provider-liquid", () => {
  it("liquid_passes_systemone_conformance_hosted", async () => {
    const recordings = new URL("wire/systemone", import.meta.url);
    const result = await systemOneConformance({
      factory: (fetchImpl, options) =>
        createLiquidProvider({
          fetch: fetchImpl,
          apiKey: options?.apiKey as any,
          path: options?.path,
        }),
      recordings,
      keyRequired: true,
    });
    assert.equal(result.ok, true);
    assert.ok(result.scenarios.length > 0);
  });

  it("liquid_passes_systemone_conformance_local", async () => {
    const result = await systemOneConformance({
      factory: (fetchImpl, options) =>
        createLiquidLocalProvider({
          fetch: fetchImpl,
          apiKey: options?.apiKey as any,
          path: options?.path,
        }),
      keyRequired: false,
    });
    assert.equal(result.ok, true);
    assert.ok(result.scenarios.some((scenario) => scenario.name === "keyless-sends-no-auth"));
  });

  it("liquid_hosted_uses_reviewed_path", async () => {
    let url = "";
    const fetchImpl = (async (input: unknown) => {
      url = String(input);
      return new Response(
        JSON.stringify({
          model: "d1.1",
          answers: { verdict: { type: "choice", choice: "reject" } },
          usage: { input_tokens: 4, output_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    await createLiquidProvider({ apiKey: () => "reviewed-path-key", fetch: fetchImpl }).decisions!().decide({
      model: "d1.1",
      state: "ticket",
      questions: { verdict: { type: "choice", instructions: "How?", criteria: { run: null, reject: null } } },
    });
    assert.equal(url, `${LIQUID_DEFAULT_BASE_URL}${LIQUID_DEFAULT_PATH}`);
    assert.equal(LIQUID_DEFAULT_PATH, "/decisions/v1/systemone");
  });

  it("liquid_models_declare_decision_capabilities_limits_and_cost", () => {
    assert.equal(LIQUID_DEFAULT_BASE_URL, "https://api.liquid.ai");
    assert.equal(LIQUID_DEFAULT_PATH, "/decisions/v1/systemone");
    assert.equal(LIQUID_LOCAL_BASE_URL, "http://127.0.0.1:8080");
    assert.equal(LIQUID_API_KEY_ENV, "LIQUID_API_KEY");
    assert.equal(LIQUID_DEFAULT_API_KEY_REF, "env:LIQUID_API_KEY");

    assert.deepEqual(
      liquidModels.map((entry) => entry.model),
      ["d1.1", "d1-ultra"],
    );
    for (const entry of liquidModels) {
      assert.equal(entry.provider, "liquid");
      assert.deepEqual(entry.capabilities, {
        input: ["text", "image"],
        output: ["text"],
        tools: false,
        streaming: false,
        structuredOutput: "json_schema",
        decisions: true,
      });
      assert.equal(entry.limits?.maxOutputTokens, 0);
      assert.equal(entry.limits?.contextWindow, undefined, "no hosted context window is documented");
      assert.equal(entry.cost?.output, 0);
      assert.equal(entry.cost?.unit, "per_million_tokens");
      assert.match(String(entry.metadata?.priceSource), /liquid\.ai\/pricing/);
    }
    assert.deepEqual(
      liquidModels.map((entry) => entry.cost?.input),
      [0.02, 0.042],
    );

    const local = liquidLocalModels[0]!;
    assert.equal(local.provider, "liquid-local");
    assert.equal(local.model, "d1-3B");
    assert.deepEqual(local.capabilities?.input, ["text", "image"]);
    assert.equal(local.limits?.contextWindow, 32_768);
    assert.equal(local.metadata?.recommendedQuant, "Q8_0");
    assert.equal(local.cost?.input, 0);

    const custom = defineLiquidModel({ model: "d1-custom", displayName: "Custom" });
    assert.equal(custom.provider, "liquid");
    assert.equal(custom.limits?.maxOutputTokens, 0);
  });
});
