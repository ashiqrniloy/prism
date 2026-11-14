/**
 * Plan 225 Task 4: a branch that already holds unanswered tool calls (written by 0.13.0, or by a process
 * that died) reaches the provider with a synthetic result after each such call. The store is not rewritten.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { repairUnansweredToolCalls } from "../agent-session/history-repair.js";
import {
  type AgentEvent,
  type Message,
  type ModelProvider,
  type ProviderRequest,
  type SessionEntry,
  type SessionStore,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const model = { provider: "mock", model: "demo" } as const;

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistantCalls = (...ids: string[]): Message => ({
  role: "assistant",
  content: ids.map((id) => toolCallContent(id, "echo", {})),
});
const toolResult = (id: string, value = "ok"): Message => ({
  role: "tool",
  content: [{ type: "tool_result", toolCallId: id, name: "echo", result: value }],
});

/** Every request the provider saw, and a text answer for each turn. */
function recordingProvider(requests: ProviderRequest[], firstTurn?: readonly string[]): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate(request) {
      turn += 1;
      requests.push(request);
      if (firstTurn && turn === 1) {
        for (const id of firstTurn) yield { type: "tool_call" as const, call: toolCallContent(id, "echo", {}) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

const echo = {
  name: "echo",
  parameters: {},
  execute: (_args: unknown, context: { readonly toolCallId: string }) => ({ toolCallId: context.toolCallId, name: "echo", value: "done" }),
};

function toolRows(request: ProviderRequest | undefined): { readonly id: string; readonly code: string | number | undefined }[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.content.flatMap((block) => (block.type === "tool_result" ? [{ id: block.toolCallId, code: block.error?.code }] : [])),
  );
}

/** Seed `store` with a branch shaped like probe `p2-orphan`: three calls, one result, then more turns. */
async function seed(store: SessionStore, sessionId: string): Promise<readonly SessionEntry[]> {
  const messages: Message[] = [
    user("first"),
    assistantCalls("c1", "c2", "c3"),
    toolResult("c1"),
    user("second"),
    {
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
    },
  ];
  const entries: SessionEntry[] = [];
  let parentId: string | undefined;
  for (const message of messages) {
    const entry = createSessionEntry({ sessionId, parentId, kind: "message", message });
    entries.push(entry);
    parentId = entry.id;
    await store.append(entry);
  }
  return entries;
}

describe("history repair (plan 225 Task 4)", () => {
  it("legacy_unanswered_calls_are_repaired_in_provider_view", async () => {
    const store = createMemorySessionStore();
    const seeded = await seed(store, "s");
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model,
      packages: [providerPackage("p", [recordingProvider(requests)])],
      slots: { store },
      tools: { add: [echo] },
    });
    const session = await agent.session({ id: "s" });
    const before = (await store.list("s")).length;
    assert.equal(before, seeded.length);
    const result = await session.run("third");
    assert.equal(result.status, "completed");
    // The provider view answers c2 and c3 right after the call, after c1's real row.
    const messages = requests[0]!.messages;
    const callAt = messages.findIndex((message) => message.role === "assistant" && message.content.some((b) => b.type === "tool_call"));
    assert.deepEqual(
      messages.slice(callAt + 1, callAt + 4).map((message) => message.role),
      ["tool", "tool", "tool"],
    );
    assert.deepEqual(toolRows(requests[0]), [
      { id: "c1", code: undefined },
      { id: "c2", code: "tool_call_interrupted" },
      { id: "c3", code: "tool_call_interrupted" },
    ]);
    // The store gained the new run's entries only, and `messages()` keeps the stored branch.
    const stored = await store.list("s");
    assert.equal(JSON.stringify(stored.slice(0, before)), JSON.stringify(seeded));
    assert.equal(JSON.stringify(stored).includes("tool_call_interrupted"), false);
    assert.equal((await session.messages()).flatMap((m) => m.content).filter((b) => b.type === "tool_result").length, 1);
    await agent.dispose();
  });

  it("history_repaired_event_is_emitted_once_with_ids_only", async () => {
    const store = createMemorySessionStore();
    await seed(store, "s");
    const agent = await createAgent({
      model,
      packages: [providerPackage("p", [recordingProvider([])])],
      slots: { store },
      tools: { add: [echo] },
    });
    const session = await agent.session({ id: "s" });
    const events: AgentEvent[] = [];
    const stream = session.subscribe();
    const pump = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await session.run("third");
    await pump;
    const repaired = events.filter((event) => event.type === "package.event" && event.name === "history.repaired");
    assert.equal(repaired.length, 1);
    const [event] = repaired;
    assert.ok(event?.type === "package.event");
    assert.deepEqual(event.data, { count: 2, callIds: ["c2", "c3"] });
    assert.equal(event.package, "kernel");
    // `run.started` precedes it.
    assert.ok(events.findIndex((e) => e.type === "run.started") < events.indexOf(repaired[0]!));
    await agent.dispose();
  });

  it("repair_is_deterministic_and_prefix_stable", () => {
    const branch = [user("a"), assistantCalls("c1", "c2"), toolResult("c1"), user("b")];
    const first = repairUnansweredToolCalls(branch);
    const second = repairUnansweredToolCalls(branch);
    assert.equal(JSON.stringify(first.messages), JSON.stringify(second.messages));
    assert.deepEqual(first.repaired, ["c2"]);
    // A longer branch keeps the repaired prefix byte for byte.
    const longer = repairUnansweredToolCalls([...branch, { role: "assistant", content: [{ type: "text", text: "x" }] }, user("c")]);
    const prefix = JSON.stringify(first.messages);
    assert.equal(JSON.stringify(longer.messages).startsWith(prefix.slice(0, -1)), true);
  });

  it("answers_a_call_by_any_later_result_and_allocates_nothing_when_clean", () => {
    const clean = [user("a"), assistantCalls("c1"), user("note"), toolResult("c1")];
    const repaired = repairUnansweredToolCalls(clean);
    assert.equal(repaired.messages, clean, "the same array comes back when nothing needs repair");
    assert.deepEqual(repaired.repaired, []);
  });

  it("provider_hosted_calls_are_untouched", () => {
    const hosted: Message = {
      role: "assistant",
      content: [{ ...toolCallContent("h1", "web_search", {}), authority: "provider-hosted" }],
    };
    const branch = [user("a"), hosted, user("b")];
    const repaired = repairUnansweredToolCalls(branch);
    assert.equal(repaired.messages, branch);
    assert.deepEqual(repaired.repaired, []);
  });

  it("resume_does_not_repair_calls_a_suspension_owns", async () => {
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model,
      packages: [providerPackage("p", [recordingProvider(requests, ["call-1"])])],
      slots: { store: createMemorySessionStore() },
      hooks: askEveryTool(),
      tools: { add: [echo] },
    });
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("go");
    assert.equal(first.status, "suspended");
    for await (const _ of session.resume(first.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" as const })))) {
      // drain
    }
    // The only provider request after the resume carries the real result, never a synthetic one.
    assert.deepEqual(toolRows(requests.at(-1)), [{ id: "call-1", code: undefined }]);
    await agent.dispose();
  });

  it("fresh_run_repairs_calls_of_a_pending_suspension", async () => {
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model,
      packages: [providerPackage("p", [recordingProvider(requests, ["call-1"])])],
      slots: { store: createMemorySessionStore() },
      hooks: askEveryTool(),
      tools: { add: [echo] },
    });
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("go");
    assert.equal(first.status, "suspended");
    // Starting a fresh run abandons the suspension, so its call is answered in the provider view.
    const second = await session.run("never mind");
    assert.equal(second.status, "completed");
    assert.deepEqual(toolRows(requests.at(-1)), [{ id: "call-1", code: "tool_call_interrupted" }]);
    // The abandoned suspension can no longer be resumed.
    let stale: unknown;
    try {
      for await (const _ of session.resume(first.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" as const })))) {
        // drain
      }
    } catch (error) {
      stale = error;
    }
    assert.equal((stale as { code?: string } | undefined)?.code, "ERR_PRISM_DECISION_STALE");
    await agent.dispose();
  });
});
