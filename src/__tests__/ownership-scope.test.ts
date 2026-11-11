import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type Decision,
  type ModelProvider,
  OwnershipScopeError,
  providerDone,
  providerTextDelta,
  type SessionStore,
  SessionNotFoundError,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const provider: ModelProvider = {
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
  return { store, calls };
}

const READS = ["list", "readBranchPath", "get"];

/** A model that calls `write` once then answers, so `askEveryTool` suspends the run. */
function suspendingAgent(ownership?: { tenantId?: string; accountId?: string; userId?: string }) {
  let turn = 0;
  const providerPackageForAgent = providerPackage("test-provider", [
    {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { path: "ok" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("finished");
        yield providerDone();
      },
    },
  ]);
  return createAgent({
    model: MODEL,
    ownership,
    slots: { store: createMemorySessionStore() },
    hooks: askEveryTool(),
    packages: [providerPackageForAgent],
    tools: {
      add: [
        {
          name: "write",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          execute: (args, context) => ({ toolCallId: context.toolCallId, name: "write", value: args }),
        },
      ],
    },
  });
}

describe("narrow-only ownership (plan 177 Task 4)", () => {
  it("run_ownership_cannot_widen", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("test-provider", [provider])],
      slots: { store },
      ownership: { tenantId: "a" },
    });
    const session = await agent.session({ id: "s", create: true });
    const before = (await store.list("s")).length;
    await assert.rejects(
      session.run("hi", { ownership: { tenantId: "b" } }),
      (error) => error instanceof OwnershipScopeError && error.code === "ERR_PRISM_OWNERSHIP_WIDEN",
    );
    assert.equal((await store.list("s")).length, before, "a refused run writes nothing");
  });

  it("shared_agent_two_users_isolated", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider])], slots: { store } });
    const a = await agent.session({ id: "shared", create: true, ownership: { userId: "a" } });
    await a.run("hi");
    // B cannot open A's branch by id, and cannot claim B's identity on A's session object.
    await assert.rejects(agent.session({ id: "shared", create: true, ownership: { userId: "b" } }), SessionNotFoundError);
    await assert.rejects(a.run("hi", { ownership: { userId: "b" } }), OwnershipScopeError);
    // A's own scope still opens the same branch.
    assert.equal((await agent.session({ id: "shared", ownership: { userId: "a" } })).id, "shared");
  });

  it("session_ownership_narrows_and_stamps", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("test-provider", [provider])],
      slots: { store },
      ownership: { tenantId: "t" },
    });
    const session = await agent.session({ id: "s", create: true, ownership: { accountId: "acct" } });
    await session.run("hi");
    const entries = await store.list("s");
    assert.ok(entries.length > 0);
    assert.ok(
      entries.every((entry) => entry.metadata?.tenantId === "t" && entry.metadata?.accountId === "acct"),
      "every entry carries the narrowed scope",
    );
  });

  it("resume_rechecks_scope", async () => {
    const agent = await suspendingAgent({ tenantId: "t" });
    const session = await agent.session({ id: "s", create: true });
    const suspended = await session.run("go");
    assert.equal(suspended.status, "suspended");
    const decisions: Decision[] = (suspended.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" }));
    const events: AgentEvent[] = [];
    await assert.rejects(async () => {
      for await (const event of session.resume(decisions, { ownership: { tenantId: "other" } })) events.push(event);
    }, OwnershipScopeError);
    assert.equal(
      events.some((event) => event.type === "decision.resolved"),
      false,
      "the scope check precedes decision.resolved",
    );
  });

  it("warm_snapshot_no_extra_read", async () => {
    const { store, calls } = countingStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("test-provider", [provider])],
      slots: { store },
      ownership: { tenantId: "t" },
    });
    const session = await agent.session({ id: "s", create: true });
    await session.run("hi");
    await session.messages(); // warm the branch cache
    calls.length = 0;
    // The branch carries only `tenantId`, so this run's added `userId` puts it out of scope and the
    // check fails closed — before any read or write.
    await assert.rejects(session.run("hi", { ownership: { userId: "u" } }), SessionNotFoundError);
    assert.deepEqual(
      calls.filter((call) => READS.includes(call)),
      [],
      "a warm snapshot means the scope check reads nothing",
    );
  });
});
