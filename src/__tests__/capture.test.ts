import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProviderCapture } from "../capture.js";
import type { AgentEvent, Message, ProviderRequest } from "../index.js";
import { createMiddlewareRegistry } from "../index.js";

const SECRETS = ["sk-super-secret", "hunter2"];

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: { provider: "demo", model: "demo-large" },
    messages: [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi back" }] },
    ] as unknown as readonly Message[],
    ...overrides,
  };
}

function turnFinished(overrides: Record<string, unknown> = {}): AgentEvent {
  return {
    type: "provider_turn_finished",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "demo", model: { provider: "demo", model: "demo-large" }, latencyMs: 42 },
    usage: { inputTokens: 10, outputTokens: 5 },
    ...overrides,
  } as unknown as AgentEvent;
}

describe("createProviderCapture", () => {
  it("captures requests through the provider_request middleware hook and passes them through untouched", async () => {
    const capture = createProviderCapture({ secrets: SECRETS });
    const registry = createMiddlewareRegistry();
    registry.use("provider_request", capture.middleware());
    const original = request();
    const out = await registry.run("provider_request", original);
    assert.equal(out, original); // observation-only: same reference flows through
    const events = capture.events();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "request");
    assert.equal(events[0]!.provider, "demo");
    assert.equal(events[0]!.model, "demo-large");
    assert.equal(events[0]!.messageCount, 2);
    assert.equal(events[0]!.redaction, "secrets");
  });

  it("drops message content by default and never captures options/headers", async () => {
    const capture = createProviderCapture({
      secrets: SECRETS,
      policy: {},
    });
    const registry = createMiddlewareRegistry();
    registry.use("provider_request", capture.middleware());
    await registry.run("provider_request", request({ options: { headers: { authorization: "Bearer sk-super-secret" } } }));
    const entry = capture.events()[0]!;
    assert.equal(entry.content, undefined);
    assert.ok(!JSON.stringify(entry).includes("sk-super-secret"));
    assert.ok(!("options" in entry));
  });

  it("retains content when the host opts in (redact: none) but still redacts secrets for replay safety", async () => {
    const capture = createProviderCapture({
      secrets: SECRETS,
      policy: { redact: "none" },
    });
    const registry = createMiddlewareRegistry();
    registry.use("provider_request", capture.middleware());
    await registry.run(
      "provider_request",
      request({
        messages: [{ role: "user", content: [{ type: "text", text: "key is sk-super-secret" }] }] as unknown as readonly Message[],
      }),
    );
    const entry = capture.events()[0]!;
    const serialized = JSON.stringify(entry.content);
    assert.match(serialized, /key is /); // content retained
    assert.ok(!serialized.includes("sk-super-secret")); // secrets still redacted
  });

  it("redact: all keeps structure only", async () => {
    const capture = createProviderCapture({ secrets: SECRETS, policy: { redact: "all" } });
    const registry = createMiddlewareRegistry();
    registry.use("provider_request", capture.middleware());
    await registry.run("provider_request", request({ tools: [{ name: "search", description: "", inputSchema: {} }] as never }));
    const entry = capture.events()[0]!;
    assert.deepEqual(entry.toolNames, ["search"]);
    assert.equal(entry.content, undefined);
  });

  it("records response entries from provider_turn_finished events with usage and redacted errors", () => {
    const capture = createProviderCapture({ secrets: SECRETS });
    capture.observeEvent({ type: "provider_turn_started" } as AgentEvent); // ignored
    capture.observeEvent(turnFinished());
    capture.observeEvent(turnFinished({ error: { message: "boom sk-super-secret", type: "provider_error" } }));
    const events = capture.events();
    assert.equal(events.length, 2);
    assert.equal(events[0]!.kind, "response");
    assert.equal(events[0]!.provider, "demo");
    assert.equal(events[0]!.model, "demo-large");
    assert.deepEqual(events[0]!.usage, { inputTokens: 10, outputTokens: 5 });
    assert.equal(events[0]!.latencyMs, 42);
    assert.ok(!JSON.stringify(events[1]!.error).includes("sk-super-secret")); // core already redacted; capture never widens it
  });

  it("evicts oldest entries at the buffer cap", async () => {
    const capture = createProviderCapture({ secrets: SECRETS, policy: { maxEvents: 3 } });
    const registry = createMiddlewareRegistry();
    registry.use("provider_request", capture.middleware());
    for (let round = 0; round < 5; round += 1) {
      await registry.run("provider_request", request());
      capture.observeEvent(turnFinished({ turn: round }));
    }
    assert.equal(capture.events().length, 3);
    // Oldest evicted first (FIFO): last request + last two responses remain.
    const kinds = capture.events().map((entry) => entry.kind);
    assert.deepEqual(kinds, ["response", "request", "response"]);
    capture.clear();
    assert.deepEqual(capture.events(), []);
  });

  it("is inert unless registered and validates maxEvents", () => {
    const capture = createProviderCapture({ secrets: SECRETS });
    assert.deepEqual(capture.events(), []); // zero overhead when never wired
    assert.throws(() => createProviderCapture({ policy: { maxEvents: 0 } }), /maxEvents/);
    assert.throws(() => createProviderCapture({ policy: { maxEvents: 1.5 } }), /maxEvents/);
  });
});
