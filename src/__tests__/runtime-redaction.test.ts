import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMemorySessionStore, createSecretRedactor } from "../index.js";
import type { ProviderRequest } from "../index.js";

describe("runtime redaction", () => {
  it("redacts provider requests events and stored entries when configured", async () => {
    let request: ProviderRequest | undefined;
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      store,
      redactor: createSecretRedactor(["token-value"]),
      provider: {
        id: "mock",
        async *generate(req) {
          request = req;
          yield { type: "message_start", messageId: "m1" };
          yield { type: "content_delta", content: { type: "text", text: "echo token-value" } };
          yield { type: "done" };
        },
      },
    });

    const session = agent.createSession({ id: "s1" });
    const events: unknown[] = [];
    (async () => { for await (const event of session.subscribe()) events.push(event); })();
    await session.run("token-value");

    assert.equal(JSON.stringify(request).includes("token-value"), false);
    assert.equal(JSON.stringify(events).includes("token-value"), false);
    assert.equal(JSON.stringify(await store.list("s1")).includes("token-value"), false);
  });

  it("createSecretRedactor does not throw on cyclic graphs", () => {
    const redactor = createSecretRedactor(["token-value"]);
    const payload: { token: string; self?: unknown } = { token: "token-value" };
    payload.self = payload;

    const redacted = redactor.redact(payload) as { token: string; self: string };

    assert.equal(redacted.token, "[REDACTED]");
    assert.equal(redacted.self, "[Circular]");
  });

  it("preserves shared references without collapsing diamonds to [Circular]", () => {
    const redactor = createSecretRedactor(["secret"]);
    const shared = { role: "user", content: [{ type: "text", text: "repair me" }] };
    const payload = { history: [shared], input: [shared] };
    const redacted = redactor.redact(payload) as { history: unknown[]; input: unknown[] };
    assert.notEqual(redacted.history[0], "[Circular]");
    assert.notEqual(redacted.input[0], "[Circular]");
    assert.deepEqual(redacted.history[0], redacted.input[0]);
  });

  it("redacts object and map keys that contain secrets", () => {
    const secret = "leak-key";
    const redactor = createSecretRedactor([secret]);
    const objectRedacted = redactor.redact({ [secret]: true, safe: secret }) as Record<string, unknown>;
    assert.equal(JSON.stringify(objectRedacted).includes(secret), false);
    assert.equal(objectRedacted["[REDACTED]"], true);

    const mapRedacted = redactor.redact(new Map([[secret, secret], ["safe", "ok"]])) as unknown as Record<string, unknown>;
    assert.equal(JSON.stringify(mapRedacted).includes(secret), false);
    assert.equal(mapRedacted["[REDACTED]"], "[REDACTED]");
    assert.equal(mapRedacted.safe, "ok");
  });

});
