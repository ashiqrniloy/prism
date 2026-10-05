import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { AgentRunStateError, createMemoryCheckpointStore, createSecretRedactor, createSecureAgent, createStaticTrustPolicy, providerDone, providerTextDelta, toolCallContent } from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { createMockProvider } from "../testing/index.js";

const validator = { validate: () => ({ ok: true }) };
const ownership = { tenantId: "tenant-1", userId: "user-1" };

function options(overrides: Record<string, unknown> = {}) {
  return {
    id: "secure-demo",
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("done"), providerDone()])])],
    tools: [{ name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "call", name: "read", value: "ok" }) }],
    toolArgumentValidator: validator,
    redactor: createSecretRedactor(["secret"]),
    trust: createStaticTrustPolicy(true),
    ownership,
    limits: { maxTurns: 2 },
    definitionRevision: "1",
    runState: { checkpoints: createMemoryCheckpointStore() },
    ...overrides,
  };
}

describe("secure agent composition", () => {
  it("secure_agent_still_verifies_identity_and_forwards_principal", async () => {
    const identity = {
      ...ownership,
      principal: { kind: "user" as const, id: "verified" },
      scopes: ["run"],
      verified: true as const,
      issuedAt: new Date().toISOString(),
    };
    const agent = await createSecureAgent(options({ identity }));
    assert.equal(agent.config.principal, identity.principal);
    assert.equal("identity" in agent.config, false);
    await agent.dispose();
    await assert.rejects(() => createSecureAgent(options({ identity: { ...identity, verified: false } }) as never), /not host-verified/);
    await assert.rejects(() => createSecureAgent(options({ identity: { ...identity, tenantId: "foreign" } })), /conflicts/);
  });
  it("rejects missing schemas, duplicate tools, and incomplete security inputs", async () => {
    await assert.rejects(
      async () =>
        await createSecureAgent(options({ tools: [{ name: "read", execute: () => ({ toolCallId: "call", name: "read" }) }] }) as never),
      /parameters schema/,
    );
    await assert.rejects(
      async () =>
        await createSecureAgent(
          options({
            tools: [
              { name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "one", name: "read" }) },
              { name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "two", name: "read" }) },
            ],
          }) as never,
        ),
      /Duplicate tool/,
    );
    await assert.rejects(async () => await createSecureAgent(options({ ownership: {} }) as never), /ownership/);
    await assert.rejects(async () => await createSecureAgent(options({ limits: {} }) as never), /limits/);
  });

  it("preserves secure defaults while allowing a narrower run limit", async () => {
    const agent = await createSecureAgent(options());
    await assert.rejects(async () => (await agent.session()).run("go", { redactor: createSecretRedactor(["other"]) }), AgentRunStateError);
    const result = await (await agent.session()).run("go", { limits: { maxTurns: 1 } });
    assert.equal(result.status, "completed");
    assert.equal(result.text, "done");
  });

  it("accepts explicit null (disabled) policy caps alongside process-hard byte caps", async () => {
    const agent = await createSecureAgent(options({ limits: { maxTurns: null, maxRequestBytes: 1024 } }));
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(result.text, "done");
  });

  it("requires durable approval before an allowed tool side effect", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = await createSecureAgent(
      options({
        packages: [providerPackage("test-provider", [createMockProvider([{ type: "tool_call", call: toolCallContent("call-1", "read", {}) }, providerDone()])])],
        tools: [
          {
            name: "read",
            parameters: { type: "object" },
            execute: () => {
              calls += 1;
              return { toolCallId: "call-1", name: "read", value: "ok" };
            },
          },
        ],
        runState: { checkpoints },
      }),
    );
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "suspended");
    assert.equal(calls, 0);
  });
});
