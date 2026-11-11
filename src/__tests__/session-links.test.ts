import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  createSessionIndex,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  UnsupportedStoreCapabilityError,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;

async function build(store = createMemorySessionStore(), ownership?: { tenantId: string }) {
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
  return createAgent({
    model: MODEL,
    packages: [providerPackage("test-provider", [provider])],
    slots: { store },
    ...(ownership ? { ownership } : {}),
  });
}

describe("session links (K4)", () => {
  it("persists parent and actor once when a session is created and lists them by filter", async () => {
    const store = createMemorySessionStore();
    const agent = await build(store);
    const parent = await agent.session();
    const child = await agent.session({
      parent: { sessionId: parent.id, workflowRunId: "wf-1", agentId: "a-1", delegationId: "d-1" },
      actor: { kind: "external", agent: "driver", vendor: "acme" },
    });
    const page = await agent.sessions.list({ workflowRunId: "wf-1" });
    assert.deepEqual(
      page.items.map((item) => item.sessionId),
      [child.id],
    );
    assert.equal(page.items[0]?.parentSessionId, parent.id);
    assert.equal(page.items[0]?.delegationId, "d-1");
    assert.deepEqual(page.items[0]?.actor, { kind: "external", agent: "driver", vendor: "acme" });
    assert.equal((await agent.sessions.list({ parentSessionId: parent.id })).items.length, 1);
    assert.equal((await agent.sessions.search({ actorAgent: "driver" })).items.length, 1);
    assert.equal((await agent.sessions.get(parent.id))?.parentSessionId, undefined);
  });

  it("parent_ignored_on_resume: reopening with a different parent does not rewrite the link", async () => {
    const store = createMemorySessionStore();
    const agent = await build(store);
    const child = await agent.session({ parent: { sessionId: "p1" } });
    const before = (await store.list(child.id)).length;
    await agent.session({ id: child.id, parent: { sessionId: "p2" }, actor: { kind: "prism", agent: "x" } });
    assert.equal((await store.list(child.id)).length, before);
    const summary = await agent.sessions.get(child.id);
    assert.equal(summary?.parentSessionId, "p1");
    assert.equal(summary?.actor, undefined);
  });

  it("fork keeps the links", async () => {
    const agent = await build();
    const child = await agent.session({ parent: { sessionId: "p1", workflowRunId: "wf-fork" } });
    const forked = await child.fork();
    const ids = (await agent.sessions.list({ workflowRunId: "wf-fork" })).items.map((item) => item.sessionId).sort();
    assert.deepEqual(ids, [child.id, forked.id].sort());
  });

  it("rejects an over-long or empty link id", async () => {
    const agent = await build();
    await assert.rejects(agent.session({ parent: { sessionId: "x".repeat(257) } }), TypeError);
    await assert.rejects(agent.session({ parent: { workflowRunId: "" } }), TypeError);
    await assert.rejects(agent.session({ actor: { kind: "alien" as "prism", agent: "a" } }), TypeError);
  });

  it("create_session_index_without_agent: list and search through a bare store honor ownership", async () => {
    const store = createMemorySessionStore();
    const a = await build(store, { tenantId: "t-a" });
    const b = await build(store, { tenantId: "t-b" });
    const mine = await a.session({ parent: { workflowRunId: "wf" } });
    await b.session({ parent: { workflowRunId: "wf" } });

    const index = createSessionIndex(store, { ownership: { tenantId: "t-a" } });
    assert.deepEqual(
      (await index.list({ workflowRunId: "wf" })).items.map((item) => item.sessionId),
      [mine.id],
    );
    assert.deepEqual(
      (await index.search({ workflowRunId: "wf" })).items.map((hit) => hit.sessionId),
      [mine.id],
    );
    // A caller-supplied scope can narrow but never widen the index's own.
    assert.equal((await index.list({ workflowRunId: "wf", tenantId: "t-b" })).items.length, 1);
    assert.equal((await index.list({ workflowRunId: "wf", tenantId: "t-b" })).items[0]?.sessionId, mine.id);

    const bare = createSessionIndex({ append: store.append.bind(store), list: store.list.bind(store) });
    await assert.rejects(bare.list(), UnsupportedStoreCapabilityError);
    await assert.rejects(bare.search(), UnsupportedStoreCapabilityError);
  });
});
