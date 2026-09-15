import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity } from "../identity.js";
import {
  assertHostCompositionReadiness,
  createAgent,
  createMemoryCheckpointStore,
  createMockProvider,
  createSecretRedactor,
  createSecureAgent,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  HostCompositionError,
  inspectHostComposition,
  providerDone,
  providerTextDelta,
} from "../index.js";
import type { ToolArgumentValidator } from "../tools.js";

const mockValidator: ToolArgumentValidator = {
  validate: () => ({ ok: true }),
};

function validPersonalAgent(options: { redactorCanary?: string } = {}) {
  const redactor = createSecretRedactor(options.redactorCanary ? [options.redactorCanary] : ["test-secret"]);
  return createSecureAgent({
    id: "personal-agent",
    definitionRevision: "1",
    ownership: { userId: "alice" },
    redactor,
    permission: createStaticPermissionPolicy(true),
    trust: createStaticTrustPolicy(true),
    toolArgumentValidator: mockValidator,
    limits: { maxToolRounds: 5 },
    runState: { checkpoints: createMemoryCheckpointStore() },
    tools: [
      {
        name: "test_tool",
        description: "Test tool description",
        parameters: { type: "object", properties: { text: { type: "string" } } },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "test_tool", value: { ok: true } }),
      },
    ],
    provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
    model: { provider: "mock", model: "test" },
  });
}

function validBusinessAgent(options: { tenantId?: string; redactorCanary?: string } = {}) {
  const tenantId = options.tenantId ?? "tenant-acme";
  const redactor = createSecretRedactor(options.redactorCanary ? [options.redactorCanary] : ["corp-secret"]);
  const identity: AgentIdentity = {
    tenantId,
    userId: "worker-1",
    principal: { kind: "user", id: "worker-1" },
    scopes: ["worker:run"],
    verified: true,
    issuedAt: "2026-09-01T00:00:00.000Z",
  };

  return createSecureAgent({
    id: "business-worker",
    definitionRevision: "1",
    ownership: { tenantId, userId: "worker-1" },
    identity,
    redactor,
    permission: createStaticPermissionPolicy(true),
    trust: createStaticTrustPolicy(true),
    toolArgumentValidator: mockValidator,
    limits: { maxToolRounds: 5 },
    runState: { checkpoints: createMemoryCheckpointStore() },
    tools: [
      {
        name: "biz_task",
        description: "Executes business task",
        parameters: { type: "object", properties: { id: { type: "string" } } },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "biz_task", value: { ok: true } }),
      },
    ],
    provider: createMockProvider([providerTextDelta("task done"), providerDone()]),
    model: { provider: "mock", model: "corp-model" },
  });
}

describe("host composition inspection and readiness (plan 073 Task 5)", () => {
  it("inspects personal composition and reports effective tools, ownership, and non-durable memory store", () => {
    const agent = validPersonalAgent();
    const report = inspectHostComposition({
      profile: "personal",
      agent,
      store: createMemoryCheckpointStore(),
      workspaceRoot: "/home/user/project",
      sandboxRoots: ["/home/user/project/src", "/home/user/project/tests"],
      credentialRefs: ["OPENAI_API_KEY", "LOCAL_KEY"],
    });

    assert.equal(report.profile, "personal");
    assert.equal(report.ownership.userId, "alice");
    assert.equal(report.ownership.tenantId, undefined);
    assert.equal(report.storage.durable, false, "in-memory store must not be reported durable");
    assert.equal(report.storage.kind, "memory");
    assert.equal(report.sandbox.isolated, true);
    assert.equal(report.governance.secure, true);
    assert.equal(report.governance.redactor, true);
    assert.equal(report.effectiveTools.length, 1);
    assert.equal(report.effectiveTools[0]?.name, "test_tool");
    assert.deepEqual(report.credentialReferences, ["OPENAI_API_KEY", "LOCAL_KEY"]);
    assert.equal(report.readiness.ok, true);
    assert.deepEqual(report.readiness.errors, []);
  });

  it("inspects business composition and validates durable storage, tenant ownership, and verified identity", () => {
    const agent = validBusinessAgent({ tenantId: "tenant-globex" });
    const durableStore = { kind: "postgres", durable: true };

    const report = inspectHostComposition({
      profile: "business",
      agent,
      store: durableStore,
      workspaceRoot: "/var/workers/tenant-globex",
      sandboxRoots: ["/var/workers/tenant-globex/work"],
      credentialRefs: ["BUSINESS_SERVICE_KEY"],
    });

    assert.equal(report.profile, "business");
    assert.equal(report.ownership.tenantId, "tenant-globex");
    assert.equal(report.storage.durable, true);
    assert.equal(report.storage.kind, "postgres");
    assert.equal(report.sandbox.isolated, true);
    assert.equal(report.governance.secure, true);
    assert.equal(report.readiness.ok, true);
    assert.deepEqual(report.readiness.errors, []);
  });

  it("wrong owner: personal composition rejects missing userId", () => {
    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "personal",
          agent: createAgent({
            model: { provider: "mock", model: "m" },
            provider: createMockProvider([providerDone()]),
            redactor: createSecretRedactor([]),
            ownership: { tenantId: "some-tenant" }, // no userId
          }),
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("Personal composition requires userId"),
    );
  });

  it("wrong owner: business composition rejects missing tenantId", () => {
    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "business",
          agent: createAgent({
            model: { provider: "mock", model: "m" },
            provider: createMockProvider([providerDone()]),
            redactor: createSecretRedactor([]),
            ownership: { userId: "alice" }, // no tenantId
          }),
          store: { kind: "postgres", durable: true },
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("tenantId in ownership"),
    );
  });

  it("wrong owner: business composition rejects identity mismatch with tenant ownership", () => {
    const redactor = createSecretRedactor([]);
    const agent = createAgent({
      model: { provider: "mock", model: "m" },
      provider: createMockProvider([providerDone()]),
      redactor,
      ownership: { tenantId: "tenant-A" },
      identity: {
        tenantId: "tenant-B-DIFFERENT",
        principal: { kind: "service", id: "svc-1" },
        scopes: ["run"],
        verified: true,
        issuedAt: "2026-09-01T00:00:00.000Z",
      },
      permission: createStaticPermissionPolicy(true),
      trust: createStaticTrustPolicy(true),
      validator: () => undefined,
    });

    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "business",
          agent,
          store: { kind: "postgres", durable: true },
        });
      },
      (error) => error instanceof HostCompositionError && (error.message.includes("tenant") || error.message.includes("identity")),
    );
  });

  it("memory-only business store: business composition rejects in-memory store", () => {
    const agent = validBusinessAgent();
    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "business",
          agent,
          store: createMemoryCheckpointStore(), // in-memory
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("durable storage"),
    );
  });

  it("missing redactor rejects readiness", () => {
    const agent = createAgent({
      model: { provider: "mock", model: "m" },
      provider: createMockProvider([providerDone()]),
      ownership: { userId: "alice" },
    });

    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "personal",
          agent,
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("secret redactor"),
    );
  });

  it("missing provider/model rejects readiness", () => {
    const agent = {
      ownership: { userId: "alice" },
      redactor: createSecretRedactor([]),
    };

    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "personal",
          agent,
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("provider or model"),
    );
  });

  it("mixed sandbox workspace rejects readiness", () => {
    const agent = validPersonalAgent();
    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "personal",
          agent,
          workspaceRoot: "/home/user/project",
          sandboxRoots: ["/home/user/project/src", "/etc/shadow", "/home/other"],
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("Sandbox roots must be contained"),
    );
  });

  it("unsupported governance rejects readiness", () => {
    const agent = validBusinessAgent();
    assert.throws(
      () => {
        assertHostCompositionReadiness({
          profile: "business",
          agent,
          store: { kind: "postgres", durable: true },
          governance: { supported: false },
        });
      },
      (error) => error instanceof HostCompositionError && error.message.includes("Unsupported governance"),
    );
  });

  it("inspect performs zero network calls", () => {
    // Verify inspection runs synchronously without touching global fetch or network
    const g = globalThis as Record<string, unknown>;
    const originalFetch = g.fetch;
    let fetchCalled = false;
    g.fetch = () => {
      fetchCalled = true;
      throw new Error("Network call prohibited during inspection");
    };

    try {
      const agent = validPersonalAgent();
      const report = inspectHostComposition({
        profile: "personal",
        agent,
        store: createMemoryCheckpointStore(),
      });
      assert.equal(report.readiness.ok, true);
      assert.equal(fetchCalled, false, "inspect must make zero network calls");
    } finally {
      g.fetch = originalFetch;
    }
  });

  it("secret canaries are absent from inspection output", () => {
    const canary = "SECRET_CANARY_VALUE_XYZ_98765";
    const agent = validPersonalAgent({ redactorCanary: canary });

    const report = inspectHostComposition({
      profile: "personal",
      agent,
      store: createMemoryCheckpointStore(),
      credentialRefs: [
        "OPENAI_API_KEY",
        `sk-${canary}`, // raw secret format
        canary, // raw secret value
      ],
    });

    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(canary), false, "secret canary must not appear in inspection report");
    assert.equal(serialized.includes("[REDACTED"), true, "secret values must be redacted");
  });
});
