import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { agentRuntime } from "../agent-session/create-agent.js";
import { type AgentConfig, createAgent, providerDone, providerTextDelta } from "../index.js";
import { createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

const base: AgentConfig = {
  model: { provider: "mock", model: "demo" },
  packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("ok"), providerDone()])])],
};

describe("createAgent is async (plan 146 Task 2)", () => {
  it("create_agent_returns_a_promise", async () => {
    const pending = createAgent(base);
    assert.ok(pending instanceof Promise, "createAgent returns a thenable, not an Agent");
    const agent = await pending;
    assert.equal(typeof agent.session, "function");
    assert.equal((agent as unknown as { createSession?: unknown }).createSession, undefined);
    assert.equal(agent.config, base, "agent.config stays the host's original input");
    assert.ok(agentRuntime(agent).hooks, "the resolved agent has its runtime registered");
  });

  it("create_agent_rejects_when_host_hooks_throw", async () => {
    const boom = new Error("registrar failed");
    let registrations = 0;
    const pending = createAgent({
      ...base,
      hooks: () => {
        registrations += 1;
        throw boom;
      },
    });
    // A registrar throw is a rejection, never a synchronous throw out of createAgent.
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, (error) => error === boom);
    assert.equal(registrations, 1, "host hook registration runs exactly once");
    // The failed load leaves nothing behind: the same config creates a healthy agent afterwards.
    const healthy = await createAgent({ ...base, hooks: () => undefined });
    // Only the kernel's own skill-catalog hook is registered: the failed host registrar left nothing.
    assert.deepEqual(
      agentRuntime(healthy)
        .hooks.registrations()
        .filter((entry) => entry.owner !== "kernel"),
      [],
    );
  });
});
