import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { systemOneConformance } from "@arnilo/prism/provider-kit";
import {
  createLayaProvider,
  defineLayaModel,
  LAYA_API_KEY_ENV,
  LAYA_DEFAULT_API_KEY_REF,
  LAYA_DEFAULT_BASE_URL,
  layaModels,
} from "../index.js";

describe("@arnilo/prism-ai/laya", () => {
  it("laya_passes_systemone_conformance", async () => {
    const recordings = new URL("wire/systemone", import.meta.url);
    const result = await systemOneConformance({
      factory: (fetchImpl, options) =>
        createLayaProvider({
          fetch: fetchImpl,
          apiKey: options?.apiKey as any,
          path: options?.path,
        }),
      recordings,
      keyRequired: false,
    });
    assert.equal(result.ok, true);
    assert.ok(result.scenarios.length > 0);
  });

  it("laya_models_declare_decision_capabilities_limits_and_cost", () => {
    assert.equal(LAYA_DEFAULT_BASE_URL, "http://localhost:8000");
    assert.equal(LAYA_API_KEY_ENV, "LAYA_API_KEY");
    assert.equal(LAYA_DEFAULT_API_KEY_REF, "env:LAYA_API_KEY");
    assert.deepEqual(
      layaModels.map((entry) => entry.model),
      ["laya", "laya-multilingual", "laya-typed-decisions"],
    );
    assert.deepEqual(
      layaModels.map((entry) => entry.limits?.contextWindow),
      [512, 1024, 1024],
    );
    assert.ok(layaModels.every((entry) => entry.limits?.maxOutputTokens === 0));
    assert.ok(
      layaModels.every(
        (entry) =>
          entry.capabilities?.structuredOutput === "json_schema" &&
          entry.capabilities.tools === false &&
          entry.capabilities.decisions === true,
      ),
    );
    assert.equal(layaModels[1]?.metadata?.extendedContextWindow, 8192);
    assert.ok(layaModels.every((entry) => entry.cost?.input === 0 && entry.cost.output === 0));

    const custom = defineLayaModel({ model: "laya-custom", displayName: "Custom" });
    assert.equal(custom.provider, "laya");
  });

  it("laya_without_key_sends_no_auth_and_notes_nothing", async () => {
    let capturedAuth: string | null = "initial";
    const fakeFetch = (async (_input: unknown, init?: RequestInit) => {
      capturedAuth = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({
          model: "laya-router",
          answers: { verdict: { type: "choice", choice: "reject" } },
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createLayaProvider({ fetch: fakeFetch });
    for await (const _event of provider.generate({
      model: layaModels[0]!,
      messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      options: {
        structuredOutput: {
          name: "decision",
          schema: { type: "object", properties: { verdict: { type: "string", enum: ["run", "reject"] } } },
        },
      },
    })) {
      void _event;
    }
    assert.equal(capturedAuth, null, "no authorization header without key");
  });

  it("plaintext_remote_endpoint_warns_for_both_vendors", () => {
    const seen: string[] = [];
    const warn = (msg: string) => seen.push(msg);

    createLayaProvider({ baseUrl: "http://10.0.0.5:8443", warn });
    assert.equal(seen.length, 1);
    assert.match(seen[0]!, /Laya/);
    assert.match(seen[0]!, /plaintext/);
    assert.match(seen[0]!, /http:\/\/10\.0\.0\.5:8443/);
  });

  it("plaintext_warning_prints_origin_only", () => {
    const seen: string[] = [];
    const warn = (msg: string) => seen.push(msg);

    createLayaProvider({ baseUrl: "http://user:s3cret@10.1.2.3:8000", warn });
    assert.equal(seen.length, 1);
    assert.match(seen[0]!, /http:\/\/10\.1\.2\.3:8000/);
    assert.doesNotMatch(seen[0]!, /s3cret/);
    assert.doesNotMatch(seen[0]!, /user/);
  });
});
