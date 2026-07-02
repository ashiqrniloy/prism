import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest } from "@arnilo/prism";
import { createNeuralWattProvider, getNeuralWattQuota } from "../index.js";

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockJsonFetch(status: number, body: object): typeof fetch {
  return (async () => json(status, body)) as typeof fetch;
}

function mockTextFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

function quotaFixture(): object {
  return {
    balance: { balance_usd: 12.34, currency: "USD" },
    usage: {
      lifetime: { cost_usd: 5.55, requests: 100, tokens: 12_000, energy_kwh: 0.4 },
      current_month: { cost_usd: 1.23, requests: 20, tokens: 3_000, energy_kwh: 0.11 },
    },
    limits: { overage_limit_usd: 50, rate_limit_tier: "standard" },
    subscription: { plan: "basic", status: "active", kwh_included: 10, kwh_used: 3.2, kwh_remaining: 6.8 },
    key: { allowance_usd: 100, allowance_used_usd: 40, allowance_remaining_usd: 60 },
  };
}

describe("@arnilo/prism-provider-neuralwatt (quota)", () => {
  it("get_neuralwatt_quota_maps_response", async () => {
    let capturedUrl = "";
    const quota = await getNeuralWattQuota({
      apiKey: "fake-neuralwatt-key",
      baseUrl: "https://proxy.example.test/neuralwatt/v1/",
      fetch: (async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return json(200, quotaFixture());
      }) as typeof fetch,
    });
    assert.equal(capturedUrl, "https://proxy.example.test/neuralwatt/v1/quota");
    assert.equal(quota.balance?.balance_usd, 12.34);
    assert.equal(quota.usage?.current_month?.energy_kwh, 0.11);
    assert.equal(quota.usage?.lifetime?.tokens, 12_000);
    assert.equal(quota.limits?.rate_limit_tier, "standard");
    assert.equal(quota.subscription?.kwh_remaining, 6.8);
    assert.equal(quota.key?.allowance_remaining_usd, 60);
  });

  it("get_neuralwatt_quota_requires_or_uses_api_key", async () => {
    let headers = new Headers();
    const quota = await getNeuralWattQuota({
      apiKey: "fake-neuralwatt-key",
      headers: { authorization: "Bearer attacker", "x-caller": "kept" },
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return json(200, quotaFixture());
      }) as typeof fetch,
    });
    // Provider-owned authorization wins over caller header.
    assert.equal(headers.get("authorization"), "Bearer fake-neuralwatt-key");
    assert.equal(headers.get("x-caller"), "kept");
    assert.ok(quota.balance);
    // No API key -> throws before fetch.
    let called = false;
    await assert.rejects(
      () => getNeuralWattQuota({ apiKey: () => undefined, fetch: (async () => { called = true; return json(200, quotaFixture()); }) as typeof fetch }),
      /requires an API key/,
    );
    assert.equal(called, false, "no fetch when api key absent");
  });

  it("get_neuralwatt_quota_redacts_token_on_error", async () => {
    await assert.rejects(
      () => getNeuralWattQuota({ apiKey: "secret-neuralwatt-token", fetch: mockTextFetch(429, "rate limited secret-neuralwatt-token") }),
      (error: unknown) => error instanceof Error && /\[REDACTED\]/.test(error.message) && !error.message.includes("secret-neuralwatt-token"),
    );
  });

  it("get_neuralwatt_quota_forwards_abort_signal", async () => {
    const controller = new AbortController();
    let captured: AbortSignal | null | undefined;
    await getNeuralWattQuota({
      apiKey: "fake-neuralwatt-key",
      signal: controller.signal,
      fetch: (async (_input, init) => {
        captured = init?.signal;
        return json(200, quotaFixture());
      }) as typeof fetch,
    });
    assert.equal(captured, controller.signal);
  });

  it("provider_generate_does_not_call_quota", async () => {
    let capturedUrl = "";
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      }) as typeof fetch,
    });
    const request: ProviderRequest = {
      model: { provider: "neuralwatt", model: "glm-5.2", capabilities: { input: ["text"], output: ["text"], streaming: true }, limits: { contextWindow: 1024 } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    for await (const _event of provider.generate(request)) void _event;
    assert.equal(capturedUrl, "https://api.neuralwatt.com/v1/chat/completions", "generation hits chat/completions only, never /quota");
  });
});
