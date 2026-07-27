import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { bedrockRuntimeEndpoint, createBedrockProvider, createBedrockProviderPackage, signAwsRequest } from "../index.js";

describe("@arnilo/prism-provider-bedrock", () => {
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
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
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
    assert.equal(pkg.name, "@arnilo/prism-provider-bedrock");
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });
});
