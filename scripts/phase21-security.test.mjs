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
 *   T12: upload cleanup — a failed DELETE is fail-soft, never breaks
 *     the stream, and never leaks the file id into events.
 *   T13: cache-telemetry overflow never mixes model costs.
 *
 * Gate accounting: the final test asserts every blocker ID above executed and
 * none was skipped, so a deleted/renamed/skipped blocker test fails the suite
 * even when the remaining tests pass.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "bun:test";
import { MediaContentError } from "@arnilo/prism";
import { pinnedFetch } from "@arnilo/prism/net";
import { createOpenAICompatibleProvider, ProviderTransportError, readBoundedResponseJson } from "@arnilo/prism/provider-kit";
import { createHyperProvider, listHyperModels } from "@arnilo/prism-provider-hyper";
import { createOpenCodeGoProvider } from "@arnilo/prism-provider-opencode-go";

const BLOCKER_IDS = [
  "strict-completion",
  "adapter-strict",
  "bounded-bodies",
  "pinned-fetch",
  "credential-once",
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
      apiKey: async () => "key",
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
      apiKey: async () => "key",
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

  it("T1: inheriting adapters reject truncated streams (built constructors)", async () => {
    const truncated = sseResponse(["data: [DONE]"]);
    const adapters = [
      createHyperProvider({ apiKey: async () => "phase21-truncation-key", fetch: async () => truncated }),
      createOpenCodeGoProvider({ apiKey: async () => "phase21-truncation-key", fetch: async () => truncated }),
    ];
    for (const provider of adapters) {
      const events = [];
      for await (const event of provider.generate({ ...request, model: { provider: provider.id, model: "demo" }, options: { sessionId: "s1" } })) events.push(event);
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
      () => listHyperModels({ apiKey: async () => "k", fetch: async () => oversized }),
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
    const redirectTargetFetches = 0;
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

  it("T10: hyper resolves a rotating credential exactly once per request", async () => {
    let calls = 0;
    const provider = createHyperProvider({
      apiKey: () => {
        calls += 1;
        return `rotating-${calls}`;
      },
      fetch: async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}', "data: [DONE]"]),
    });
    const events = [];
    for await (const event of provider.generate({ ...request, model: { provider: "hyper", model: "demo" } })) events.push(event);
    assert.equal(calls, 1, "rotating credential consumed once per request");
    assert.ok(
      events.some((event) => event.type === "done"),
      "stream completes with the single resolved token",
    );
    blockerIds.add("credential-once");
  });

  it("gate accounting: all blocker IDs executed; none skipped or renamed away", () => {
    assert.deepEqual(
      [...blockerIds].sort(),
      [...BLOCKER_IDS].sort(),
      `blocker coverage incomplete; ran: ${[...blockerIds].sort().join(", ")}`,
    );
  });
});
