import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { JsonObject, ModelConfig } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoFetches, assertNoForeignCacheFields } from "@arnilo/prism/testing/provider-conformance";
import { bedrockRuntimeEndpoint, createBedrockProvider, createBedrockProviderPackage, signAwsRequest } from "../index.js";

describe("@arnilo/prism-providers/bedrock", () => {
  it("preserves region/private endpoint and signs requests", async () => {
    const seen: { url?: string; auth?: string; body?: string } = {};
    const provider = createBedrockProvider({
      region: "eu-west-1",
      endpoint: "https://vpce-123.bedrock-runtime.eu-west-1.vpce.amazonaws.com",
      credential: {
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session",
      },
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.auth = new Headers(init?.headers).get("authorization") ?? undefined;
        seen.body = String(init?.body ?? "");
        assert.ok(new Headers(init?.headers).get("x-amz-security-token"));
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "bedrock", model: "anthropic.claude-3-haiku-20240307-v1:0" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(seen.url, "https://vpce-123.bedrock-runtime.eu-west-1.vpce.amazonaws.com/openai/v1/chat/completions");
    assert.match(seen.auth ?? "", /^AWS4-HMAC-SHA256 Credential=AKIATEST\/.+\/eu-west-1\/bedrock\/aws4_request/);
    assert.ok(seen.body?.includes('"stream":true'));
    assert.ok(events.some((event) => event.type === "done"));
  });

  it("fails closed without credentials and defaults public regional endpoint", async () => {
    assert.equal(bedrockRuntimeEndpoint("us-east-1"), "https://bedrock-runtime.us-east-1.amazonaws.com");
    const provider = createBedrockProvider({
      region: "us-east-1",
      credential: async () => ({ accessKeyId: "", secretAccessKey: "" }),
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "bedrock", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(events[0]?.type, "error");
  });

  it("setup stays inert with zero fetch and zero credential resolution", async () => {
    const calls: unknown[] = [];
    const pkg = createBedrockProviderPackage({
      region: "us-east-1",
      credential: () => {
        calls.push("credential");
        return { accessKeyId: "a", secretAccessKey: "b" };
      },
      models: [{ provider: "bedrock", model: "m" }],
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls.push(args[0]);
        throw new Error("should not fetch");
      }) as typeof fetch,
    });
    await pkg.setup({
      registerProvider: () => {},
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as any);
    assertNoFetches(calls);
  });

  it("observes an already-aborted signal", async () => {
    const provider = createBedrockProvider({
      region: "us-east-1",
      credential: { accessKeyId: "a", secretAccessKey: "b" },
      fetch: (async () => new Response("data: [DONE]\n\n", { status: 200 })) as typeof fetch,
    });
    await assertAbortIsObserved({
      provider,
      request: { model: { provider: "bedrock", model: "m" }, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
    });
  });

  it("truncated stream without done fails loudly", async () => {
    const provider = createBedrockProvider({
      region: "us-east-1",
      credential: { accessKeyId: "a", secretAccessKey: "b" },
      fetch: (async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { status: 200 })) as typeof fetch,
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "bedrock", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("native Bedrock cache (cachePoint) is unsupported and no cache hints reach the OpenAI-compatible body", async () => {
    let body: any;
    const provider = createBedrockProvider({
      region: "us-east-1",
      credential: { accessKeyId: "a", secretAccessKey: "b" },
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }) as typeof fetch,
    });
    for await (const _ of provider.generate({
      model: { provider: "bedrock", model: "m", cache: { kind: "none" } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { cacheKey: "session-1", cacheRetention: "long", cache: { breakpoints: [{ location: "system_prompt" }] } },
    })) {
      /* drain */
    }
    assertNoForeignCacheFields(body);
  });

  it("sigv4 is deterministic and package has no runtime deps", () => {
    const headers = signAwsRequest({
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions",
      headers: { "content-type": "application/json" },
      body: "{}",
      region: "us-east-1",
      service: "bedrock",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    assert.match(headers.authorization, /Signature=[a-f0-9]{64}/);
    const pkg = createBedrockProviderPackage({
      region: "us-east-1",
      credential: { accessKeyId: "a", secretAccessKey: "b" },
    });
    assert.equal(pkg.name, "@arnilo/prism-providers/bedrock");
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });

  it("forwards_sanitized_reasoning_compat_and_snaps_openai_family_levels", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createBedrockProvider({
      region: "eu-west-1",
      credential: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    const generate = async (model: ModelConfig, compat?: JsonObject) => {
      for await (const _event of provider.generate({
        model,
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        options: { compat },
      })) {
        /* drain */
      }
    };
    // Bedrock OpenAI-family model: xhigh snaps to high via the OpenAI table.
    await generate({ provider: "bedrock", model: "openai.gpt-5.1" }, { reasoning_effort: "xhigh" });
    assert.equal(body!.reasoning_effort, "high");
    // Non-OpenAI Bedrock model: no declared levels → passthrough.
    await generate({ provider: "bedrock", model: "anthropic.claude-3-haiku-20240307-v1:0" }, { reasoning_effort: "medium" });
    assert.equal(body!.reasoning_effort, "medium");
    await generate({ provider: "bedrock", model: "anthropic.claude-3-haiku-20240307-v1:0" });
    assert.equal(body!.reasoning_effort, undefined);
    // reasoning object sanitized; unknown keys dropped.
    await generate(
      { provider: "bedrock", model: "anthropic.claude-3-haiku-20240307-v1:0" },
      { reasoning: { effort: "high", summary: "auto", bogus: 1 }, thinkingFamily: "google" },
    );
    assert.deepEqual(body!.reasoning, { effort: "high", summary: "auto" });
    assert.equal(body!.thinkingFamily, undefined);
  });
});
