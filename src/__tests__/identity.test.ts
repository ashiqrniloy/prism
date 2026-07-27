import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentIdentity,
  assertIdentityActive,
  assertIdentityMatchesOwnership,
  assertIdentityPropagation,
  createAgent,
  createToolRegistry,
  DEFAULT_IDENTITY_LIMITS,
  dispatchToolCall,
  HARD_IDENTITY_LIMITS,
  IdentityError,
  type IdentityVerifier,
  identityTelemetryAttributes,
  narrowIdentity,
  ownershipFromIdentity,
  providerDone,
  providerTextDelta,
  resolveIdentityLimits,
  resolveRunIdentity,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";

function verifiedIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-1",
    accountId: "acct-1",
    userId: "user-1",
    principal: { kind: "agent", id: "agent-1" },
    sponsor: { kind: "user", id: "sponsor-1" },
    scopes: ["mail.read", "mail.draft", "calendar.read"],
    credentialRefs: ["m365:tenant-1:user-1"],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    verified: true,
    ...overrides,
  };
}

describe("identity contracts", () => {
  it("assertIdentityActive rejects expired, revoked, wrong-tenant, and unverified identities", () => {
    assert.throws(
      () => assertIdentityActive(verifiedIdentity({ expiresAt: new Date(Date.now() - 1_000).toISOString() })),
      (error: unknown) => error instanceof IdentityError && error.reason === "expired",
    );
    assert.throws(
      () => assertIdentityActive(verifiedIdentity({ revokedAt: new Date(Date.now() - 1_000).toISOString() })),
      (error: unknown) => error instanceof IdentityError && error.reason === "revoked",
    );
    assert.throws(
      () => assertIdentityActive(verifiedIdentity(), { expectedTenantId: "other" }),
      (error: unknown) => error instanceof IdentityError && error.reason === "wrong_tenant",
    );
    assert.throws(
      () => assertIdentityActive({ ...verifiedIdentity(), verified: false as unknown as true }),
      (error: unknown) => error instanceof IdentityError && error.reason === "unverified",
    );
    assertIdentityActive(verifiedIdentity());
  });

  it("narrowIdentity only narrows scopes and keeps tenant immutable", () => {
    const parent = verifiedIdentity();
    const child = narrowIdentity(parent, { scopes: ["mail.read"] });
    assert.deepEqual([...child.scopes], ["mail.read"]);
    assert.equal(child.tenantId, parent.tenantId);
    assert.equal(child.delegatedFrom?.id, parent.principal.id);
    assert.throws(
      () => narrowIdentity(parent, { scopes: ["mail.read", "mail.send"] }),
      (error: unknown) => error instanceof IdentityError && error.reason === "scope_widen",
    );
    assert.throws(
      () =>
        narrowIdentity(parent, {
          scopes: ["mail.read"],
          expiresAt: new Date(Date.parse(parent.expiresAt!) + 60_000).toISOString(),
        }),
      (error: unknown) => error instanceof IdentityError && error.reason === "expiry_widen",
    );
  });

  it("assertIdentityMatchesOwnership and propagation refuse widening", () => {
    const identity = verifiedIdentity();
    assertIdentityMatchesOwnership(identity, ownershipFromIdentity(identity));
    assert.throws(
      () => assertIdentityMatchesOwnership(identity, { tenantId: "other" }),
      (error: unknown) => error instanceof IdentityError && error.reason === "ownership_tenant",
    );
    const child = narrowIdentity(identity, { scopes: ["mail.read"] });
    assertIdentityPropagation(identity, child);
    assert.throws(
      () => assertIdentityPropagation(child, identity),
      (error: unknown) => error instanceof IdentityError && error.reason === "scope_widen",
    );
  });

  it("identityTelemetryAttributes expose refs without credential secret material", () => {
    const attrs = identityTelemetryAttributes(
      verifiedIdentity({
        credentialRefs: ["resolver:key"],
        metadata: { token: "should-not-leak" },
      }),
    );
    assert.equal(attrs["prism.identity.tenant_id"], "tenant-1");
    assert.equal(attrs["prism.identity.credential_ref_count"], "1");
    assert.equal(attrs["prism.identity.principal_id"], "agent-1");
    assert.ok(!JSON.stringify(attrs).includes("should-not-leak"));
    assert.ok(!JSON.stringify(attrs).includes("resolver:key"));
  });

  it("enforces frozen identity byte/field caps", () => {
    assert.equal(resolveIdentityLimits().maxScopes, DEFAULT_IDENTITY_LIMITS.maxScopes);
    assert.throws(() => resolveIdentityLimits({ maxScopes: HARD_IDENTITY_LIMITS.maxScopes + 1 }), RangeError);
    assert.throws(
      () =>
        assertIdentityActive(
          verifiedIdentity({ scopes: Array.from({ length: DEFAULT_IDENTITY_LIMITS.maxScopes + 1 }, (_, i) => `s${i}`) }),
        ),
      (error: unknown) => error instanceof IdentityError && error.reason === "too_many_scopes",
    );
    assert.throws(
      () => assertIdentityActive(verifiedIdentity({ scopes: ["x".repeat(DEFAULT_IDENTITY_LIMITS.maxScopeBytes + 1)] })),
      (error: unknown) => error instanceof IdentityError && error.reason === "scope_too_large",
    );
  });

  it("IdentityVerifier host seam and resolveRunIdentity reject ownership conflicts; tools see identity", async () => {
    const verifier: IdentityVerifier = {
      async verify(input) {
        const claim = input as { tenantId?: string };
        if (claim.tenantId !== "tenant-1") throw new IdentityError("bad tenant", "wrong_tenant");
        return verifiedIdentity({ tenantId: claim.tenantId });
      },
    };
    const identity = await verifier.verify({ tenantId: "tenant-1" });
    assert.equal(resolveRunIdentity(identity, undefined, ownershipFromIdentity(identity))?.tenantId, "tenant-1");
    assert.throws(
      () => resolveRunIdentity(identity, undefined, { tenantId: "other" }),
      (error: unknown) => error instanceof IdentityError && error.reason === "ownership_tenant",
    );

    let sawIdentity = false;
    const tool: ToolDefinition = {
      name: "ping",
      description: "ping",
      parameters: { type: "object", properties: {} },
      execute(_args, context) {
        sawIdentity = context.identity?.principal.id === "agent-1";
        return { toolCallId: context.toolCallId, name: "ping", content: [{ type: "text", text: "ok" }] };
      },
    };
    const result = await dispatchToolCall({
      call: toolCallContent("call-1", "ping", {}),
      registry: createToolRegistry([tool]),
      context: { sessionId: "s", runId: "r", toolCallId: "call-1", identity },
      ownership: ownershipFromIdentity(identity),
      identity,
    });
    assert.equal(result.error, undefined);
    assert.equal(sawIdentity, true);

    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      identity: verifiedIdentity(),
      ownership: ownershipFromIdentity(verifiedIdentity()),
    });
    await assert.rejects(
      () =>
        agent.createSession().run("go", {
          identity: verifiedIdentity({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
        }),
      (error: unknown) => error instanceof IdentityError && error.reason === "expired",
    );
  });
});
