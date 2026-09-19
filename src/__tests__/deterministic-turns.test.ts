import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type BeforeProviderTurnPayload,
  createAgent,
  createMemorySessionStore,
  createMiddlewareRegistry,
  createMockProvider,
  DeterministicTurnError,
  providerDone,
  providerTextDelta,
} from "../index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const DESK_ANSWERS = new Map([["what is the desk?", "The desk answers from local records."]]);

function deskMiddleware() {
  const middleware = createMiddlewareRegistry();
  middleware.use<BeforeProviderTurnPayload>("beforeProviderTurn", (payload) => {
    const text = DESK_ANSWERS.get(payload.userText);
    return text ? { ...payload, answer: { content: [{ type: "text", text }], provenance: { middleware: "desk" } } } : payload;
  });
  return middleware;
}

describe("deterministic no-model turns", () => {
  it("answers without a provider call, records the message, and reports no usage", async () => {
    const requests: unknown[] = [];
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("model answer"), providerDone()], {
        onRequest: (request) => requests.push(request),
      }),
      middleware: deskMiddleware(),
    });
    const session = agent.createSession({ id: "deterministic-answer" });
    const reader = collect(session.subscribe());

    const result = await session.run("what is the desk?");
    const events = await reader;

    assert.equal(requests.length, 0, "deterministic turn must not reach the provider adapter");
    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "The desk answers from local records.");
    assert.equal(result.message?.role, "assistant");
    assert.equal(result.usage, undefined, "usage is absent for a no-model turn, never zero");

    assert.deepEqual(
      events.map((event) => event.type),
      [
        "agent_started",
        "turn_started",
        "deterministic_turn",
        "message_started",
        "message_delta",
        "message_finished",
        "turn_finished",
        "agent_finished",
      ],
    );
    const turn = events.find((event) => event.type === "deterministic_turn");
    assert.equal(turn?.type === "deterministic_turn" ? turn.middleware : undefined, "desk");
    assert.equal(turn?.type === "deterministic_turn" ? turn.turn : undefined, 1);
    assert.ok(
      events.every((event) => !event.type.startsWith("provider_turn")),
      "no provider turn events for a deterministic turn",
    );

    // Provenance rides the assistant message (plan 096 Task 2), so the transcript itself proves no model ran.
    assert.deepEqual(result.message?.metadata, { deterministic: { middleware: "desk" } });
    const finished = events.find((event) => event.type === "message_finished");
    assert.deepEqual(finished?.type === "message_finished" ? finished.message.metadata : undefined, {
      deterministic: { middleware: "desk" },
    });
  });

  it("replays a deterministic turn from the store with provenance intact", async () => {
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerDone()]),
      middleware: deskMiddleware(),
      store,
    });

    await agent.createSession({ id: "deterministic-replay" }).run("what is the desk?");

    // Read back what the store kept: the transcript alone still names the answering middleware.
    const persisted = (await store.list("deterministic-replay")).filter((entry) => entry.kind === "message");
    const assistant = persisted.find((entry) => entry.message?.role === "assistant")?.message;
    assert.equal(assistant?.content[0]?.type === "text" ? assistant.content[0].text : undefined, "The desk answers from local records.");
    assert.deepEqual(assistant?.metadata, { deterministic: { middleware: "desk" } });
  });

  it("proceeds through the provider unchanged when middleware returns no answer", async () => {
    const providerEvents: AgentEvent[][] = [];
    const run = async (withMiddleware: boolean) => {
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
        ...(withMiddleware ? { middleware: deskMiddleware() } : {}),
      });
      const session = agent.createSession();
      const reader = collect(session.subscribe());
      const result = await session.run("unmatched question");
      providerEvents.push(await reader);
      return result;
    };

    const withMiddleware = await run(true);
    const withoutMiddleware = await run(false);

    assert.equal(withMiddleware.text, "Hello");
    assert.equal(withMiddleware.text, withoutMiddleware.text);
    assert.deepEqual(
      providerEvents[0].map((event) => event.type),
      providerEvents[1].map((event) => event.type),
      "undefined answer must leave the provider round byte-for-byte identical",
    );
  });

  it("runs deterministic content through output guardrails", async () => {
    const seen: string[] = [];
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerDone()]),
      middleware: deskMiddleware(),
      guardrails: {
        output: [
          {
            name: "capture",
            stage: "output",
            evaluate: (context) => {
              seen.push(context.value.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
              return { action: "allow" };
            },
          },
        ],
      },
    });

    const result = await agent.createSession({ id: "deterministic-guardrail" }).run("what is the desk?");
    assert.equal(result.text, "The desk answers from local records.");
    assert.deepEqual(seen, ["The desk answers from local records."]);
  });

  it("fails closed on a malformed answer instead of calling the provider", async () => {
    const requests: unknown[] = [];
    const middleware = createMiddlewareRegistry();
    middleware.use<BeforeProviderTurnPayload>("beforeProviderTurn", (payload) => ({
      ...payload,
      answer: { content: [], provenance: { middleware: "desk" } },
    }));
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("model answer"), providerDone()], {
        onRequest: (request) => requests.push(request),
      }),
      middleware,
    });

    await assert.rejects(
      () => agent.createSession({ id: "deterministic-malformed" }).run("what is the desk?"),
      (error) =>
        error instanceof Error && error.cause instanceof DeterministicTurnError && error.cause.code === "ERR_PRISM_DETERMINISTIC_TURN",
    );
    assert.equal(requests.length, 0);
  });
});
