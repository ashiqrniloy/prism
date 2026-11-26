/**
 * A child session on another agent (a delegate child backed by a host-supplied agent): `RunOptions.chargeTo` accepts
 * its linked parent's view only, and `RunOptions.approvals: "deny"` denies an unanswered ask instead of suspending.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  type SessionContext,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

function provider(withCall: boolean): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (withCall && turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("w1", "write", {}) };
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
        return;
      }
      yield providerTextDelta("done");
      yield providerDone({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
    },
  };
}

async function parentWithView(): Promise<{ agent: Agent; view: () => Promise<SessionContext>; sessionId: string }> {
  let captured: SessionContext | undefined;
  const agent = await createAgent({
    id: "parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("parent-provider", [provider(false)]),
      definePackage({
        name: "capture",
        version: "1.0.0",
        requires: { api: 2 },
        setup(prism) {
          prism.commands.register({ name: "capture", description: "test", run: (_a, ctx) => void (captured = ctx.session) });
        },
      }),
    ],
  });
  const session = await agent.session();
  return {
    agent,
    sessionId: session.id,
    view: async () => {
      await agent.commands.run("capture", {}, { session });
      assert.ok(captured);
      return captured;
    },
  };
}

async function childAgent(withCall: boolean): Promise<Agent> {
  return createAgent({
    id: "child",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    hooks: askEveryTool(),
    packages: [providerPackage(`child-provider-${withCall}`, [provider(withCall)])],
    tools: {
      add: [{ name: "write", parameters: {}, execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "write", value: "written" }) }],
    },
  });
}

describe("a child session on another agent", () => {
  it("charge_to_accepts_the_linked_parent_of_another_agent_only", async () => {
    const parent = await parentWithView();
    const child = await childAgent(false);
    const linked = await child.session({ parent: { sessionId: parent.sessionId } });
    const result = await linked.run("go", { chargeTo: await parent.view() });
    assert.equal(result.status, "completed");

    const unlinked = await child.session();
    await assert.rejects(unlinked.run("go", { chargeTo: await parent.view() }), /not this session's linked parent/);
    await child.dispose();
    await parent.agent.dispose();
  });

  it("approvals_deny_denies_an_unanswered_ask_instead_of_suspending", async () => {
    const child = await childAgent(true);
    const session = await child.session();
    const result = await session.run("go", { interactive: false, approvals: "deny" });
    assert.equal(result.status, "completed");
    const tool = (await session.messages()).find((message) => message.role === "tool");
    assert.match(JSON.stringify(tool?.content), /non_interactive/);

    const suspending = await (await childAgent(true)).session();
    assert.equal((await suspending.run("go", { interactive: false })).status, "suspended");
    await child.dispose();
  });
});
