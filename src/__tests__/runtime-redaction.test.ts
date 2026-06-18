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
});
