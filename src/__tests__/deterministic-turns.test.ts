import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type AgentEvent, type ProviderEvent, type ProviderRequest, createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "../index.js";
import { mockProvider } from "../testing/index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const DESK_ANSWERS = new Map([["what is the desk?", "The desk answers from local records."]]);

/** A `model.call` around handler that skips `next`: no provider request, no usage. */
function deskModelCall() {
  return (hooks: import("../index.js").HookRegistrar) => {
    hooks.on("model.call", async (request, next, _context) => {
      const userText = request.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content)
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
      const text = DESK_ANSWERS.get(userText);
      if (!text) return next(request);
      return answerStream(text);
    });
  };
}

async function* answerStream(text: string): AsyncIterable<ProviderEvent> {
  yield { type: "message_start", messageId: "deterministic" };
  yield providerTextDelta(text);
  yield providerDone();
}

describe("host-answered turns that skip the provider", () => {
  it("answers without a provider call", async () => {
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("model answer"), providerDone()]], {
        onRequest: (request) => requests.push(request),
      })],
      hooks: deskModelCall(),
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    const result = await session.run("what is the desk?");
    const events = await reader;

    assert.equal(requests.length, 0, "deterministic turn must not reach the provider adapter");
    assert.equal(result.status, "completed");
    assert.equal(result.text, "The desk answers from local records.");
    assert.equal(result.message?.role, "assistant");
    // A `model.call` handler that skips `next` yields no `usage` event, so the turn reports the
    // session's estimated usage. The retired `beforeProviderTurn` middleware could suppress usage
    // entirely (`undefined`, never zero); a hook cannot, because estimation happens in the kernel.
    assert.equal(result.usage?.estimated, true);

    // The turn still runs through the provider-round machinery, so the kernel emits its turn events
    // around the host-supplied stream; what must stay absent is any call into the adapter.
    const types = events.map((event) => event.type);
    assert.equal(types.at(0), "run.started");
    assert.equal(types.at(-1), "run.completed");
  });

  it("records the answered message in the store", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerDone()]])],
      hooks: deskModelCall(),
      slots: { store },
    });

    await (await agent.session({ id: "deterministic-replay", create: true })).run("what is the desk?");

    const persisted = (await store.list("deterministic-replay")).filter((entry) => entry.kind === "message");
    const assistant = persisted.find((entry) => entry.message?.role === "assistant")?.message;
    assert.equal(assistant?.content[0]?.type === "text" ? assistant.content[0].text : undefined, "The desk answers from local records.");
  });

  it("proceeds through the provider unchanged when the handler calls next", async () => {
    const providerEvents: AgentEvent[][] = [];
    const run = async (withHook: boolean) => {
      const agent = await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
        ...(withHook ? { hooks: deskModelCall() } : {}),
      });
      const session = await agent.session();
      const reader = collect(session.subscribe());
      const result = await session.run("unmatched question");
      providerEvents.push(await reader);
      return result;
    };

    const withHook = await run(true);
    const withoutHook = await run(false);

    assert.equal(withHook.text, "Hello");
    assert.equal(withHook.text, withoutHook.text);
    assert.deepEqual(
      providerEvents[0].map((event) => event.type),
      providerEvents[1].map((event) => event.type),
      "a handler that calls next must leave the provider round byte-for-byte identical",
    );
  });

  it("a model.response handler still sees the deterministic answer", async () => {
    const seen: string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerDone()]])],
      hooks: (hooks) => {
        deskModelCall()(hooks);
        hooks.on("model.response", (message) => {
          seen.push(message.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
          return undefined;
        });
      },
    });

    const result = await (await agent.session()).run("what is the desk?");
    assert.equal(result.text, "The desk answers from local records.");
    assert.deepEqual(seen, ["The desk answers from local records."]);
  });
});
