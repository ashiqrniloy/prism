import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { Message, ProviderEvent, ProviderRequest } from "../contracts.js";
import { createRoutedProvider } from "../provider-kit/routed-provider.js";
import { createBuiltinProvider } from "../models/builtin.js";
import { ProviderRequirementError } from "../provider-kit/provider-request-policy.js";
import { assertNoSecretLeak, assertProviderOwnedHeadersWin } from "../provider-kit/conformance.js";

function sse(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      controller.close();
    },
  });
}

const STOP = JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] });

describe("routed-provider", () => {
  it("routed_provider_unknown_route_fails_closed", async () => {
    const provider = createRoutedProvider({
      id: "test-routed",
      baseUrl: "https://api.test.example/v1",
      routes: {
        openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer" },
      },
    });

    const request: ProviderRequest = {
      model: { provider: "test-routed", model: "model-a", compat: { route: "nonexistent" } },
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };

    await assert.rejects(
      async () => {
        for await (const _ of provider.generate(request)) {
          // drain
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequirementError);
        assert.equal(err.requirement, "route");
        assert.match(err.message, /Unknown route 'nonexistent'/);
        return true;
      },
    );
  });

  it("routed_provider_requires_session_before_fetch", async () => {
    let fetchCalled = false;
    const provider = createRoutedProvider({
      id: "session-required",
      baseUrl: "https://api.test.example/v1",
      fetch: (async () => {
        fetchCalled = true;
        return new Response(sse([STOP, "[DONE]"]), { status: 200 });
      }) as typeof fetch,
      require: { sessionId: true },
      routes: {
        openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer" },
      },
    });

    const requestWithoutSession: ProviderRequest = {
      model: { provider: "session-required", model: "model-a" },
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };

    await assert.rejects(
      async () => {
        for await (const _ of provider.generate(requestWithoutSession)) {
          // drain
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequirementError);
        assert.equal(err.requirement, "sessionId");
        assert.match(err.message, /requires session correlation/);
        return true;
      },
    );

    assert.equal(fetchCalled, false, "fetch must not be called when sessionId requirement fails");

    const requestWithSession: ProviderRequest = {
      ...requestWithoutSession,
      options: { sessionId: "sess-1234" },
    };

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(requestWithSession)) {
      events.push(event);
    }
    assert.equal(fetchCalled, true);
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("routed_provider_owned_headers_win", async () => {
    let capturedHeaders = new Headers();
    const provider = createRoutedProvider({
      id: "headers-test",
      baseUrl: "https://api.test.example/v1",
      apiKey: async () => "secret-key-12345",
      fetch: (async (_url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(sse([STOP, "[DONE]"]), { status: 200 });
      }) as typeof fetch,
      routes: {
        openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer" },
      },
    });

    const callerHeaders = {
      authorization: "Bearer attacker-injected-token",
      "content-type": "text/plain",
      "x-caller-header": "retained-value",
    };

    for await (const _ of provider.generate({
      model: { provider: "headers-test", model: "demo" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { headers: callerHeaders },
    })) {
      // drain
    }

    assertProviderOwnedHeadersWin(capturedHeaders, {
      owned: {
        authorization: "Bearer secret-key-12345",
        "content-type": "application/json",
      },
      caller: callerHeaders,
    });
  });

  it("routed_provider_resolves_key_once", async () => {
    let resolveCount = 0;
    let fetchCount = 0;

    const provider = createRoutedProvider({
      id: "key-counter",
      baseUrl: "https://api.test.example/v1",
      resolveApiKey: async () => {
        resolveCount += 1;
        return "resolved-token-999";
      },
      fetch: (async () => {
        fetchCount += 1;
        return new Response(sse([JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), STOP, "[DONE]"]), {
          status: 200,
        });
      }) as typeof fetch,
      routes: {
        openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer" },
      },
    });

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      model: { provider: "key-counter", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "run" }] }],
    })) {
      events.push(event);
    }

    assert.equal(resolveCount, 1, "resolveApiKey must be called exactly once per request");
    assert.equal(fetchCount, 1, "fetch must be called once per request");
    assert.ok(events.some((e) => e.type === "content_delta"));
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("routed_provider_redacts_error_body", async () => {
    const SECRET = "sk-super-secret-token-to-hide";
    const provider = createRoutedProvider({
      id: "redact-test",
      baseUrl: "https://api.test.example/v1",
      apiKey: async () => SECRET,
      fetch: (async () => {
        return new Response(`Error: Invalid key ${SECRET} supplied in authorization header`, { status: 401 });
      }) as typeof fetch,
      routes: {
        openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer" },
      },
    });

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      model: { provider: "redact-test", model: "demo" },
      messages: [{ role: "user", content: [{ type: "text", text: "trigger" }] }],
    })) {
      events.push(event);
    }

    assertNoSecretLeak(events, [SECRET]);
    const errorEvent = events.find((e) => e.type === "error");
    assert.ok(errorEvent && errorEvent.type === "error");
    assert.ok(errorEvent.error.message.includes("[REDACTED]"));
    assert.equal(errorEvent.error.message.includes(SECRET), false);
  });

  it("builtin_provider_on_routed_builder_unchanged", async () => {
    let capturedUrl = "";
    let capturedHeaders = new Headers();

    const builtin = createBuiltinProvider({
      resolveCredential: (ref) => (ref === "env:MY_KEY" ? { type: "api_key", value: "key-abc" } : undefined),
      fetch: (async (url, init) => {
        capturedUrl = String(url);
        capturedHeaders = new Headers(init?.headers);
        return new Response(
          sse([JSON.stringify({ choices: [{ delta: { content: "Builtin reply" } }] }), STOP, "[DONE]"]),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const events: ProviderEvent[] = [];
    for await (const event of builtin.generate({
      model: {
        provider: "openai-compatible",
        model: "gpt-4o",
        baseUrl: "https://endpoint.local/v1",
        credential: "env:MY_KEY",
      },
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
    })) {
      events.push(event);
    }

    assert.equal(capturedUrl, "https://endpoint.local/v1/chat/completions");
    assert.equal(capturedHeaders.get("authorization"), "Bearer key-abc");
    assert.deepEqual(events, [
      { type: "content_delta", content: { type: "text", text: "Builtin reply" } },
      { type: "done", usage: undefined, stopReason: "end_turn" },
    ]);
  });

  it("affinity_header_is_sanitized_cache_key", async () => {
    let capturedHeaders = new Headers();
    const provider = createRoutedProvider({
      id: "affinity-test",
      baseUrl: "https://api.test.example/v1",
      apiKey: async () => "test-key-xyz",
      fetch: (async (_url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(sse([STOP, "[DONE]"]), { status: 200 });
      }) as typeof fetch,
      routes: {
        openai: {
          format: "openai-chat",
          path: "/chat/completions",
          auth: "bearer",
          affinity: (req): Record<string, string> => {
            const key = req.options?.cacheKey ?? req.options?.sessionId;
            const sanitized = (key && key.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128)) || undefined;
            return sanitized ? { "x-opencode-session": sanitized } : {};
          },
        },
        anthropic: {
          format: "anthropic-messages",
          path: "/messages",
          auth: "x-api-key+bearer",
          affinity: (req): Record<string, string> => {
            const key = req.options?.cacheKey ?? req.options?.sessionId;
            const sanitized = (key && key.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128)) || undefined;
            return sanitized ? { "x-affinity-id": sanitized } : {};
          },
        },
      },
    });

    // 1. OpenAI route with unsanitized sessionId and caller header spoof attempt
    for await (const _ of provider.generate({
      model: { provider: "affinity-test", model: "model-1", compat: { route: "openai" } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: {
        sessionId: "session/dirty#with$forbidden!chars?",
        headers: { "x-opencode-session": "spoofed-session" },
      },
    })) {
      // drain
    }

    assert.equal(capturedHeaders.get("x-opencode-session"), "session-dirty-with-forbidden-chars");
    assert.equal(capturedHeaders.get("x-opencode-session")?.includes("$"), false);
    assert.equal(capturedHeaders.get("x-opencode-session")?.includes("#"), false);
    assert.equal(capturedHeaders.get("x-opencode-session")?.includes("!"), false);

    // 2. Anthropic route
    for await (const _ of provider.generate({
      model: { provider: "affinity-test", model: "model-2", compat: { route: "anthropic" } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: {
        sessionId: "anthropic/route#session!42",
      },
    })) {
      // drain
    }

    assert.equal(capturedHeaders.get("x-affinity-id"), "anthropic-route-session-42");
  });
});
