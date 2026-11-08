import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  isKnownAgentEventType,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  type SessionEntry,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

/** Plan 215 Task 29: the kernel follows its own forward-compatibility rules (docs/compatibility.md). */
describe("forward compatibility", () => {
  it("unknown_entry_never_reaches_provider", async () => {
    const MARKER = "FUTURE-ENTRY-MARKER";
    const seen: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(JSON.stringify(request));
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const store = createMemorySessionStore();
    const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    const rows: SessionEntry[] = [
      {
        id: "m1",
        sessionId: "s",
        timestamp: at(1),
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
      // A later minor's entry kind. It even carries `message` and `summary`: the kernel must still ignore it.
      {
        id: "f1",
        parentId: "m1",
        sessionId: "s",
        timestamp: at(2),
        kind: "future_kind",
        message: { role: "user", content: [{ type: "text", text: MARKER }] },
        summary: MARKER,
        data: { text: MARKER },
      },
      {
        id: "m2",
        parentId: "f1",
        sessionId: "s",
        timestamp: at(3),
        kind: "message",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
    ];
    for (const row of rows) await store.append(row);

    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("p", [provider])],
      slots: { store },
    });
    const session = await agent.session({ id: "s" });
    const messages = await session.messages();
    assert.equal(messages.length, 2, "the unknown entry is not a message");
    assert.ok(!JSON.stringify(messages).includes(MARKER));
    await session.run("next");
    assert.equal(seen.length, 1);
    assert.ok(!seen[0]!.includes(MARKER), "an unknown entry never reaches a provider request");
    assert.ok(seen[0]!.includes("hello") && seen[0]!.includes("next"));
    assert.ok(
      (await store.list("s")).some((row) => row.id === "f1"),
      "the store still holds the entry",
    );
    await agent.dispose();
  });

  it("is_known_agent_event_type", () => {
    const known: AgentEvent["type"][] = ["run.started", "message.delta", "tool.completed", "session.closed", "package.event"];
    for (const type of known) assert.equal(isKnownAgentEventType(type), true, type);
    for (const type of ["run.paused", "", "toString", "constructor", 1, undefined])
      assert.equal(isKnownAgentEventType(type), false, String(type));
  });
});
