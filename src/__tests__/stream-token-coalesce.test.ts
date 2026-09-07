import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerThinkingDelta,
  toolCallContent,
} from "../index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("stream token coalesce", () => {
  it("merges adjacent text/thinking deltas on persist and serializes without interstitial newlines", async () => {
    const thinkingTokens = ["the", " user", " asked"];
    const textTokens = ["hello", " world"];
    let turn = 0;
    let replay: ProviderRequest | undefined;
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        turn += 1;
        if (turn === 1) {
          for (const token of thinkingTokens) yield providerThinkingDelta(token);
          for (const token of textTokens) yield providerTextDelta(token);
          yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
          yield providerDone();
          return;
        }
        replay = request;
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };

    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      store: createMemorySessionStore(),
      tools: [{ name: "echo", parameters: {}, execute: () => ({ toolCallId: "c1", name: "echo", value: "ok" }) }],
    }).createSession({ id: "coalesce" });
    const pending = collect(session.subscribe());
    await session.run("Hi");
    const events = await pending;

    const liveThinking = events
      .filter((event) => event.type === "message_delta" && event.content.type === "thinking")
      .map((event) => (event.type === "message_delta" && event.content.type === "thinking" ? event.content.text : ""));
    const liveText = events
      .filter((event) => event.type === "message_delta" && event.content.type === "text")
      .map((event) => (event.type === "message_delta" && event.content.type === "text" ? event.content.text : ""));
    assert.deepEqual(liveThinking, thinkingTokens);
    assert.deepEqual(liveText, [...textTokens, "ok"]);

    const first = (await session.entries()).find((entry) => entry.message?.role === "assistant");
    const persisted = first?.message?.content ?? [];
    assert.deepEqual(
      persisted.filter((block) => block.type === "thinking").map((block) => (block.type === "thinking" ? block.text : "")),
      ["the user asked"],
    );
    assert.deepEqual(
      persisted.filter((block) => block.type === "text").map((block) => (block.type === "text" ? block.text : "")),
      ["hello world"],
    );
    assert.equal(persisted.filter((block) => (block.type === "text" || block.type === "thinking") && /^\n+$/.test(block.text)).length, 0);

    const history = replay?.messages.find((message) => message.role === "assistant");
    assert.ok(history);
    assert.equal(
      history.content
        .filter((block) => block.type === "text")
        .map((block) => (block.type === "text" ? block.text : ""))
        .join(""),
      "hello world",
    );
    assert.equal(
      history.content
        .filter((block) => block.type === "thinking")
        .map((block) => (block.type === "thinking" ? block.text : ""))
        .join(""),
      "the user asked",
    );
    assert.equal(history.content.filter((block) => block.type === "text").length, 1);
    assert.equal(history.content.filter((block) => block.type === "thinking").length, 1);
  });
});
