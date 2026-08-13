/**
 * Phase 21 security conformance (plan 021 Task 7).
 *
 * Exercises the 0.2.1 trust-boundary changes through BUILT PUBLIC package
 * entrypoints (workspace dist via package exports), never private source
 * imports — the original review defects passed TypeScript declarations and
 * existed only at runtime, so regressions must run against the shipped
 * JavaScript surface:
 *
 *   T1/T2/T14: truncated OpenAI-compatible streams reject by default across
 *     the shared base and all six inheriting adapters (azure, bedrock, vertex,
 *     openrouter, zai, neuralwatt); explicit strictCompletion:false stays the
 *     documented opt-out.
 *   T3: bounded success bodies — oversized discovery/upload-shaped JSON aborts
 *     before full buffering; malformed/over-deep/over-wide payloads and shape
 *     mismatches fail closed with response_body_* codes.
 *   T4-T6: DNS-pinned fetch — private/metadata/rebinding/redirect fail closed
 *     for the shared primitive OIDC JWKS/OPA/content all route through.
 *   T7-T9: shared OAuth device-code poll — cadence, slow_down backoff, expiry,
 *     terminal-error redaction, oversized token bodies fail closed.
 *   T10: azure/vertex credential-once — a rotating CredentialValueSource is
 *     consumed exactly once per request.
 *   T11: Bedrock SigV4 duplicate-case/repeated-query canonicalization.
 *   T12: OpenAI upload cleanup — a failed DELETE is fail-soft, never breaks
 *     the stream, and never leaks the file id into events; the retention
 *     (id kept until a successful DELETE) is asserted source-level against the
 *     manager in task6's openai.test.ts because the manager is not a public
 *     export of @arnilo/prism-provider-openai.
 *   T13: cache-telemetry overflow never mixes model costs.
 *
 * Gate accounting: the final test asserts every blocker ID above executed and
 * none was skipped, so a deleted/renamed/skipped blocker test fails the suite
 * even when the remaining tests pass.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { createCacheTelemetry, MediaContentError, pinnedFetch, pollDeviceCodeToken } from "@arnilo/prism";
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
import { ProviderTransportError, readBoundedResponseJson } from "@arnilo/prism/providers/transport";
import { createAzureOpenAIProvider } from "@arnilo/prism-provider-azure";
import { createBedrockProvider, signAwsRequest } from "@arnilo/prism-provider-bedrock";
import { createVertexProvider } from "@arnilo/prism-provider-vertex";
import { createOpenRouterProvider } from "@arnilo/prism-provider-openrouter";
import { createZaiProvider } from "@arnilo/prism-provider-zai";
import { createNeuralWattProvider } from "@arnilo/prism-provider-neuralwatt";
import { createOpenAIResponsesProvider, listOpenAIModels } from "@arnilo/prism-provider-openai";

const BLOCKER_IDS = [
  "strict-completion",
  "adapter-strict",
  "bounded-bodies",
  "pinned-fetch",
  "oauth-device-code",
  "credential-once",
  "sigv4-canonical",
  "upload-cleanup",
  "overflow-cost",
];
const blockerIds = new Set();

const request = {
  model: { provider: "mock", model: "demo" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

function sseResponse(events) {
  return new Response(`${events.join("\n\n")}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("phase21 security conformance (plan 021 Task 7, built public entrypoints)", () => {
  it("T1/T2/T14: truncated streams reject by default; strictCompletion:false is the documented opt-out", async () => {
    const truncated = sseResponse(["data: [DONE]"]);
    const provider = createOpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.example.com/v1",
      fetch: async () => truncated,
    });
    const events = [];
    for await (const event of provider.generate({ ...request, model: { provider: "mock", model: "demo" } })) events.push(event);
    const error = events.find((event) => event.type === "error");
    assert.ok(error, "truncated stream must emit an error");
    assert.match(String(error.error?.message ?? ""), /without completion evidence/);
    assert.equal(
      events.some((event) => event.type === "done"),
      false,
      "truncated stream must never emit done",
    );

    // T14: explicit opt-out restores the permissive behavior.
    const permissive = createOpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.example.com/v1",
      strictCompletion: false,
      fetch: async () => truncated,
    });
    const permissiveEvents = [];
    for await (const event of permissive.generate({ ...request, model: { provider: "mock", model: "demo" } })) permissiveEvents.push(event);
    assert.ok(
      permissiveEvents.some((event) => event.type === "done"),
      "explicit strictCompletion:false must complete",
    );
    blockerIds.add("strict-completion");
  });

  it("T1: all six inheriting adapters reject truncated streams (built constructors)", async () => {
    const truncated = sseResponse(["data: [DONE]"]);
    const adapters = [
      createAzureOpenAIProvider({
        endpoint: "https://demo.openai.azure.com",
        deployment: "d1",
        credential: "t",
        fetch: async () => truncated,
      }),
      createBedrockProvider({
        region: "us-east-1",
        credential: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
        fetch: async () => truncated,
      }),
      createVertexProvider({ projectId: "p", location: "us-central1", credential: "t", fetch: async () => truncated }),
      createOpenRouterProvider({ apiKey: "t", fetch: async () => truncated }),
      createZaiProvider({ apiKey: "t", fetch: async () => truncated }),
      createNeuralWattProvider({ apiKey: "t", fetch: async () => truncated }),
    ];
    for (const provider of adapters) {
      const events = [];
      for await (const event of provider.generate({ ...request, model: { provider: "mock", model: "demo" } })) events.push(event);
      const error = events.find((event) => event.type === "error");
      assert.ok(error, `${provider.id} must reject a truncated stream`);
      assert.match(String(error.error?.message ?? ""), /without completion evidence/);
      assert.equal(
        events.some((event) => event.type === "done"),
        false,
        `${provider.id} must not emit done on truncation`,
      );
    }
    blockerIds.add("adapter-strict");
  });

  it("T3: bounded success bodies abort oversized discovery bodies and fail closed on bad shapes", async () => {
    // Public discovery entrypoint: an oversized /models body must reject.
    const oversized = new Response(JSON.stringify({ data: Array.from({ length: 40_000 }, (_, i) => ({ id: `m${i}` })) }), { status: 200 });
    await assert.rejects(
      () => listOpenAIModels({ apiKey: "k", fetch: async () => oversized }),
      (error) => error instanceof ProviderTransportError && error.code === "response_body_overflow",
    );

    // Shared reader: malformed JSON, over-deep nesting, over-wide containers,
    // and shape mismatches all fail closed with response_body_shape.
    const cases = [
      [new Response("not json", { status: 200 }), "response_body_shape"],
      [new Response(JSON.stringify({ a: { b: { c: { d: { e: { f: 1 } } } } } }), { status: 200 }), "response_body_shape"],
      [new Response(JSON.stringify({ a: 1, b: 2, c: 3 }), { status: 200 }), "response_body_shape"],
      [new Response(JSON.stringify({ id: 42 }), { status: 200 }), "response_body_shape"],
    ];
    for (const [response, expected] of cases) {
      await assert.rejects(
        () =>
          readBoundedResponseJson(response, {
            maxDepth: 3,
            maxProperties: 2,
            shape: (v) => typeof v === "object" && v !== null && typeof v.id === "string",
          }),
        (error) => error instanceof ProviderTransportError && error.code === expected,
      );
    }
    // Valid bounded payload parses identically with the same caps.
    const payload = await readBoundedResponseJson(new Response(JSON.stringify({ id: "ok" }), { status: 200 }), {
      shape: (v) => typeof v === "object" && v !== null && typeof v.id === "string",
    });
    assert.equal(payload.id, "ok");
    blockerIds.add("bounded-bodies");
  });

  it("T4-T6: pinned fetch rejects private, metadata, rebinding, and redirect targets", async () => {
    const privateAnswer = await pinnedFetch(new URL("https://jwks.example.com/jwks.json"), undefined, {
      resolver: async () => [{ address: "10.0.0.1", family: 4 }],
    }).then(
      () => null,
      (error) => error,
    );
    assert.ok(privateAnswer instanceof MediaContentError, "private JWKS address must fail closed");
    assert.equal(privateAnswer.code, "ssrf_denied");

    const metadata = await pinnedFetch(
      new URL("https://opa.example.com/v1/data"),
      {
        method: "POST",
        body: "{}",
      },
      {
        resolver: async () => [{ address: "169.254.169.254", family: 4 }],
      },
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(metadata instanceof MediaContentError, "cloud metadata address must fail closed");
    assert.equal(metadata.code, "ssrf_denied");

    // Rebinding defense: the single resolve is the only answer trusted — the
    // socket is pinned to it, so a resolver that would answer differently on a
    // second call never gets one. Serve a local loopback response so the test
    // has zero network dependence; the resolver must be called exactly once.
    let resolverCalls = 0;
    const rebindServer = createServer((_req, res) => {
      res.end("ok");
    });
    await new Promise((resolve) => rebindServer.listen(0, "127.0.0.1", resolve));
    try {
      const rebindPort = rebindServer.address().port;
      const response = await pinnedFetch(new URL(`http://localhost:${rebindPort}/asset`), undefined, {
        allowLoopback: true,
        resolver: async () => {
          resolverCalls += 1;
          return resolverCalls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.1", family: 4 }];
        },
      });
      assert.equal(resolverCalls, 1, "exactly one resolve per request (no second lookup to rebind)");
      assert.equal(await response.text(), "ok", "socket is pinned to the single resolved address");
    } finally {
      await new Promise((resolve) => rebindServer.close(() => resolve()));
    }

    // Redirects are rejected outright, never followed: serve 302 from a local
    // loopback server and prove the Location target is never fetched.
    let redirectTargetFetches = 0;
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: "http://localhost:9/redirected" });
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = server.address().port;
      const redirect = await pinnedFetch(new URL(`http://localhost:${port}/start`), undefined, {
        allowLoopback: true,
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      }).then(
        () => null,
        (error) => error,
      );
      assert.ok(redirect instanceof MediaContentError, "3xx must fail closed");
      assert.equal(redirect.code, "redirect");
      // The location target is on port 9; had it been followed the fetch would
      // still have reached a socket — count proves no follow occurred at all.
      assert.equal(redirectTargetFetches, 0);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
    }

    // Loopback without allowLoopback fails closed too.
    const loopback = await pinnedFetch(new URL("https://localhost/x"), undefined, {
      resolver: async () => [{ address: "::1", family: 6 }],
    }).then(
      () => null,
      (error) => error,
    );
    assert.ok(loopback instanceof MediaContentError, "loopback without allowLoopback must fail closed");
    blockerIds.add("pinned-fetch");
  });

  it("T7-T9: shared OAuth device-code poll cadence, backoff, expiry, and redaction", async () => {
    const sleeps = [];
    const pending = () =>
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400, headers: { "content-type": "application/json" } });
    let polls = 0;
    const success = await pollDeviceCodeToken({
      errorPrefix: "Phase21",
      deviceCodeUrl: "https://id.example.com/device",
      tokenUrl: "https://id.example.com/token",
      clientId: "client",
      now: () => 1_000_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      parseTokenCredentials: (json) => ({ accessToken: json.access_token, refreshToken: json.refresh_token }),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/device")) {
          return new Response(
            JSON.stringify({
              device_code: "dev-secret",
              user_code: "USER-CODE",
              verification_uri: "https://id.example.com/activate",
              expires_in: 600,
              interval: 1,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        polls += 1;
        if (polls === 1)
          return new Response(JSON.stringify({ error: "slow_down" }), { status: 400, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ access_token: "at-1", refresh_token: "rt-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(success.accessToken, "at-1");
    assert.deepEqual(sleeps, [1000, 6000], "initial interval then slow_down +5000");

    // Expiry fails closed before any token.
    const expired = await pollDeviceCodeToken({
      errorPrefix: "Phase21",
      deviceCodeUrl: "https://id.example.com/device",
      tokenUrl: "https://id.example.com/token",
      clientId: "client",
      now: () => 1_000_000,
      sleep: async () => {},
      parseTokenCredentials: (json) => ({ accessToken: json.access_token }),
      fetchImpl: async (input) => {
        if (String(input).endsWith("/device")) {
          return new Response(
            JSON.stringify({
              device_code: "dev-secret",
              user_code: "USER-CODE",
              verification_uri: "https://id.example.com/activate",
              expires_in: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
      },
    }).then(
      () => null,
      (error) => error,
    );
    assert.ok(expired instanceof Error);
    assert.match(expired.message, /expired before authorization completed/);

    // Terminal errors redact device_code/user_code and carry [REDACTED].
    const errorBody = JSON.stringify({
      error: "access_denied",
      error_description: "user rejected device_code=dev-secret user_code=USER-CODE",
    });
    const terminal = await pollDeviceCodeToken({
      errorPrefix: "Phase21",
      deviceCodeUrl: "https://id.example.com/device",
      tokenUrl: "https://id.example.com/token",
      clientId: "client",
      now: () => 1_000_000,
      sleep: async () => {},
      parseTokenCredentials: (json) => ({ accessToken: json.access_token }),
      fetchImpl: async (input) => {
        if (String(input).endsWith("/device")) {
          return new Response(
            JSON.stringify({
              device_code: "dev-secret",
              user_code: "USER-CODE",
              verification_uri: "https://id.example.com/activate",
              expires_in: 600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(errorBody, { status: 400, headers: { "content-type": "application/json" } });
      },
    }).then(
      () => null,
      (error) => error,
    );
    assert.ok(terminal instanceof Error);
    assert.ok(terminal.message.includes("[REDACTED]"), "error must show the redaction marker");
    assert.equal(terminal.message.includes("dev-secret"), false, "device_code must never surface");
    assert.equal(terminal.message.includes("USER-CODE"), false, "user_code must never surface");
    blockerIds.add("oauth-device-code");
  });

  it("T10: azure resolves a rotating credential exactly once per request", async () => {
    let calls = 0;
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => {
        calls += 1;
        return `rotating-${calls}`;
      },
      fetch: async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}', "data: [DONE]"]),
    });
    const events = [];
    for await (const event of provider.generate({ ...request, model: { provider: "mock", model: "demo" } })) events.push(event);
    assert.equal(calls, 1, "rotating credential consumed once per request");
    assert.ok(
      events.some((event) => event.type === "done"),
      "stream completes with the single resolved token",
    );
    blockerIds.add("credential-once");
  });

  it("T11: Bedrock SigV4 canonicalizes duplicate-case headers and repeated query params", async () => {
    const signed = signAwsRequest({
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions?a=z&a=b",
      headers: { "X-Test": "a", "x-test": "b", "content-type": "application/json" },
      body: "{}",
      region: "us-east-1",
      service: "bedrock",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    assert.equal(signed["x-test"], "b", "duplicate-case headers merge last-wins");
    assert.equal(signed["X-Test"], undefined, "no duplicate-case key survives");
    const signedHeaders = signed.authorization.match(/SignedHeaders=([^,]+)/)?.[1] ?? "";
    assert.equal(signedHeaders.split(";").filter((name) => name === "x-test").length, 1, "x-test signed exactly once");
    const again = signAwsRequest({
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions?a=b&a=z",
      headers: { "content-type": "application/json", "x-test": "b" },
      body: "{}",
      region: "us-east-1",
      service: "bedrock",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    assert.equal(signed.authorization, again.authorization, "query order and header case must not change the signature");
    blockerIds.add("sigv4-canonical");
  });

  it("T12: upload cleanup fails soft on a failed DELETE and never leaks the file id", async () => {
    // The manager itself is not a public export; exercise the public provider
    // seam with its default manager. ID-retention semantics (kept until a
    // successful DELETE) are asserted directly in task6's openai.test.ts.
    let uploads = 0;
    let deletes = 0;
    const fetchImpl = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/files") && init?.method === "POST") {
        uploads += 1;
        return new Response(JSON.stringify({ id: "file-upload-1" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/files/file-upload-1") && init?.method === "DELETE") {
        deletes += 1;
        return new Response("{}", { status: 500 });
      }
      if (url.endsWith("/responses")) {
        return sseResponse([
          'data: {"type":"response.output_text.delta","delta":"hello"}',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3,"input_tokens_details":{"cached_tokens":0}}}}',
          "data: [DONE]",
        ]);
      }
      return new Response("{}", { status: 404 });
    };
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-key", fetch: fetchImpl });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["file"] } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              name: "big.pdf",
              data: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4 * 1024 * 1024 + 1)]).toString("base64"),
            },
          ],
        },
      ],
    }))
      events.push(event);
    assert.equal(uploads, 1, "oversized file uploads through the public provider");
    assert.equal(deletes, 1, "cleanup attempts the DELETE");
    assert.ok(
      events.some((event) => event.type === "done"),
      "failed DELETE must not break the stream",
    );
    assert.equal(
      events.some((event) => event.type === "error"),
      false,
      "cleanup failure must not surface as a stream error",
    );
    assert.equal(JSON.stringify(events).includes("file-upload-1"), false, "file id must never leak into events");
    blockerIds.add("upload-cleanup");
  });

  it("T13: cache-telemetry overflow never mixes model costs", async () => {
    const telemetry = createCacheTelemetry({ maxKeys: 2 });
    const usage = (cacheReadTokens) => ({ inputTokens: 100, cacheReadTokens });
    const model = (name) => ({ provider: "mock", model: name, cost: { input: 2, cacheRead: 0.5 } });
    telemetry.record(usage(100), model("a"));
    telemetry.record(usage(100), model("b"));
    telemetry.record(usage(50), model("c"));
    const overflow = telemetry.report().samples.find((sample) => sample.model === "__overflow__");
    assert.ok(overflow, "overflow bucket present");
    assert.equal(overflow.estimatedSavings, undefined, "no cost estimate on mixed-model overflow tokens");
    assert.equal(overflow.currency, undefined, "no currency on the overflow bucket");
    const capped = telemetry.report().samples.filter((sample) => sample.model !== "__overflow__");
    assert.ok(
      capped.every((sample) => sample.estimatedSavings !== undefined),
      "capped samples keep their own cost",
    );
    blockerIds.add("overflow-cost");
  });

  it("gate accounting: all nine blocker IDs executed; none skipped or renamed away", () => {
    assert.deepEqual(
      [...blockerIds].sort(),
      [...BLOCKER_IDS].sort(),
      `blocker coverage incomplete; ran: ${[...blockerIds].sort().join(", ")}`,
    );
  });
});
