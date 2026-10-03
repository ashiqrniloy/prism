import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentConfig,
  type AgentEvent,
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  type SessionStore,
  SessionNotFoundError,
} from "../index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

/** Counts every store call so "no store read" is observable. */
function countingStore(inner: SessionStore = createMemorySessionStore()) {
  const calls: string[] = [];
  const store = new Proxy(inner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        calls.push(key);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { store, calls, inner };
}

const READS = ["list", "readBranchPath", "get"];

describe("agent.session() over the store slot (plan 149 Task 2)", () => {
  it("session_without_id_opens_new_and_reads_nothing", async () => {
    const { store, calls } = countingStore();
    const agent = await createAgent({ model: MODEL, provider, slots: { store } });
    const first = await agent.session();
    const second = await agent.session();
    assert.ok(first.id && second.id && first.id !== second.id);
    assert.deepEqual(
      calls.filter((call) => READS.includes(call)),
      [],
    );
  });

  it("session_with_id_resumes_through_store_slot", async () => {
    // A direct slots.store assignment.
    const direct = createMemorySessionStore();
    const agent = await createAgent({ model: MODEL, provider, slots: { store: direct } });
    const opened = await agent.session();
    await opened.run("hello");
    const again = await agent.session({ id: opened.id });
    assert.equal(again.id, opened.id);
    assert.ok((await again.entries()).length >= 2, "the resumed session carries the stored branch");

    // A package-provided store: the agent has no direct assignment.
    const provided = createMemorySessionStore();
    const owner = definePackage<any>({
      name: "@acme/store",
      version: "1.0.0",
      capabilities: ["slot:store"],
      setup: ({ slots }: any) => slots.store.provide(provided),
    });
    const viaPackage = await createAgent({ model: MODEL, provider, packages: [owner] });
    const s = await viaPackage.session();
    await s.run("hello");
    assert.ok((await provided.list(s.id)).length >= 2, "the session wrote through the provided store");
    const resumed = await viaPackage.session({ id: s.id });
    assert.ok((await resumed.entries()).length >= 2);
  });

  it("unknown_session_id_fails_closed", async () => {
    const agent = await createAgent({ model: MODEL, provider });
    await assert.rejects(agent.session({ id: "never-created" }), (error: unknown) => {
      assert.ok(error instanceof SessionNotFoundError);
      assert.equal(error.sessionId, "never-created");
      return true;
    });
  });

  it("create_true_opens_a_new_session_under_the_id_then_resumes_it", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({ model: MODEL, provider, slots: { store } });
    const first = await agent.session({ id: "thread-1", create: true });
    assert.equal(first.id, "thread-1");
    await first.run("hello");
    const again = await agent.session({ id: "thread-1", create: true });
    assert.equal((await again.entries()).length, (await first.entries()).length, "an existing branch resumes, it is not replaced");
  });

  it("create_true_still_fails_closed_across_ownership_scope", async () => {
    const store = createMemorySessionStore();
    const mine = await createAgent({ model: MODEL, provider, slots: { store }, ownership: { tenantId: "tenant-a" } });
    await (await mine.session({ id: "shared-id", create: true })).run("private");
    const theirs = await createAgent({ model: MODEL, provider, slots: { store }, ownership: { tenantId: "tenant-b" } });
    await assert.rejects(theirs.session({ id: "shared-id", create: true }), SessionNotFoundError);
  });

  it("resume_across_ownership_scope_is_not_found", async () => {
    const store = createMemorySessionStore();
    const mine = await createAgent({
      model: MODEL,
      provider,
      slots: { store },
      ownership: { tenantId: "tenant-a" },
    });
    const session = await mine.session();
    await session.run("private");
    const theirs = await createAgent({
      model: MODEL,
      provider,
      slots: { store },
      ownership: { tenantId: "tenant-b" },
    });
    await assert.rejects(theirs.session({ id: session.id }), SessionNotFoundError);
    const owner = await mine.session({ id: session.id });
    assert.equal(owner.id, session.id);
  });

  it("session_opened_fires_once_session_resolves_and_reaches_agent_subscribers", async () => {
    const hooked: string[] = [];
    const agent = await createAgent({
      model: MODEL,
      provider,
      hooks: (hooks) => hooks.on("session.opened", (payload) => void hooked.push(`opened:${payload.restored}`)),
    });
    const seen: AgentEvent[] = [];
    const subscription = agent.subscribe!();
    const reader = (async () => {
      for await (const event of subscription) {
        seen.push(event);
        if (event.type === "session.opened") break;
      }
    })();
    const session = await agent.session();
    // Eager: the hook has already fired by the time session() resolves.
    assert.deepEqual(hooked, ["opened:false"]);
    await reader;
    assert.equal(seen.filter((event) => event.type === "session.opened").length, 1);
    await session.run("hi");
    assert.deepEqual(hooked, ["opened:false"], "runs do not re-fire session.opened");
  });

  it("agent_config_store_is_rejected_as_unknown_key", async () => {
    const store = createMemorySessionStore();
    // @ts-expect-error `store` is no longer an AgentConfig key.
    const legacy: AgentConfig = { model: MODEL, provider, store };
    await assert.rejects(createAgent(legacy), TypeError);
    const agent = await createAgent({ model: MODEL, provider });
    // @ts-expect-error `store` is no longer a SessionOptions key.
    await assert.rejects(agent.session({ store }), TypeError);
    assert.equal((agent as unknown as { createSession?: unknown }).createSession, undefined);
  });
});
