import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AgentRunStateError,
  createMemoryCheckpointStore,
  createMockProvider,
  createSecureAgent,
  createSecretRedactor,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";

const validator = { validate: () => ({ ok: true }) };
const ownership = { tenantId: "tenant-1", userId: "user-1" };

function options(overrides: Record<string, unknown> = {}) {
  return {
    id: "secure-demo",
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("done"), providerDone()]),
    tools: [{ name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "call", name: "read", value: "ok" }) }],
    toolArgumentValidator: validator,
    redactor: createSecretRedactor(["secret"]),
    permission: createStaticPermissionPolicy({ allow: ["tool:read:execute"] }),
    trust: createStaticTrustPolicy(true),
    ownership,
    limits: { maxTurns: 2 },
    definitionRevision: "1",
    runState: { checkpoints: createMemoryCheckpointStore() },
    ...overrides,
  };
}

describe("secure agent composition", () => {
  it("rejects missing schemas, duplicate tools, and incomplete security inputs", () => {
    assert.throws(() => createSecureAgent(options({ tools: [{ name: "read", execute: () => ({ toolCallId: "call", name: "read" }) }] }) as never), /parameters schema/);
    assert.throws(() => createSecureAgent(options({ tools: [
      { name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "one", name: "read" }) },
      { name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "two", name: "read" }) },
    ] }) as never), /Duplicate tool/);
    assert.throws(() => createSecureAgent(options({ ownership: {} }) as never), /ownership/);
    assert.throws(() => createSecureAgent(options({ limits: {} }) as never), /limits/);
  });

  it("preserves secure defaults while allowing a narrower run limit", async () => {
    const agent = createSecureAgent(options());
    await assert.rejects(
      () => agent.createSession().run("go", { redactor: createSecretRedactor(["other"]) }),
      AgentRunStateError,
    );
    const result = await agent.createSession().run("go", { limits: { maxTurns: 1 } });
    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "done");
  });

  it("requires durable approval before an allowed tool side effect", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = createSecureAgent(options({
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-1", "read", {}) }, providerDone()]),
      tools: [{ name: "read", parameters: { type: "object" }, execute: () => { calls += 1; return { toolCallId: "call-1", name: "read", value: "ok" }; } }],
      runState: { checkpoints },
    }));
    const result = await agent.createSession().run("go");
    assert.equal(result.status, "suspended");
    assert.equal(calls, 0);
  });
});
