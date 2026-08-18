import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity } from "@arnilo/prism";
import {
  APPROVAL_HARD_LIMITS,
  type ApprovalActorRef,
  type ApprovalAuthority,
  type ApprovalRecord,
  type ApprovalRoleGrant,
  type ApprovalStore,
  createMemoryApprovalStore,
  evaluateApproval,
  PolicyError,
  prepareApprovalDecision,
} from "../index.js";

const NOW = Date.parse("2026-08-17T00:00:00.000Z");

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    principal: { kind: "user", id: "alice" },
    sponsor: { kind: "user", id: "sponsor-1" },
    scopes: ["erp:invoice:release"],
    issuedAt: "2026-08-17T00:00:00.000Z",
    verified: true,
    ...overrides,
  };
}

function authority(roles: Record<string, string | ApprovalRoleGrant>, revision = "v1"): ApprovalAuthority {
  return {
    policyRevision: revision,
    resolveRoles(actor) {
      const entry = roles[actor.principal.id];
      if (entry === undefined) return [];
      return [typeof entry === "string" ? { role: entry } : entry];
    },
  };
}

function requestInput(overrides: Partial<Parameters<ApprovalStore["create"]>[0]> = {}) {
  return {
    tenantId: "tenant-1",
    requester: identity({ userId: "requester-1", principal: { kind: "user", id: "requester-1" } }),
    action: { kind: "invoice.release", digest: "d-1" },
    requirements: [{ role: "finance-approver", quorum: 2 }],
    separateFromRequester: true,
    expiresAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  } as Parameters<ApprovalStore["create"]>[0];
}

function decidedInput(record: ApprovalRecord, overrides: Partial<Parameters<ApprovalStore["decide"]>[0]> = {}) {
  return {
    tenantId: record.tenantId,
    requestId: record.id,
    expectedRevision: record.revision,
    role: "finance-approver",
    actor: identity(),
    decision: "approve" as const,
    auditRef: "audit:decide-1",
    ...overrides,
  } as Parameters<ApprovalStore["decide"]>[0];
}

describe("@arnilo/prism-policy approvals", () => {
  it("denies the requester from deciding their own request (separation of duties)", async () => {
    const store = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver" }), now: NOW });
    const requester = identity({ principal: { kind: "user", id: "alice" } });
    const record = await store.create(requestInput({ requester }));
    await assert.rejects(
      () => store.decide(decidedInput(record, { actor: requester })),
      (error: unknown) => error instanceof PolicyError && /separation of duties/i.test(error.message),
    );
    const after = await store.get({ tenantId: record.tenantId, requestId: record.id });
    assert.equal(after?.status, "pending");
  });

  it("counts distinct verified principals per role; duplicate votes are idempotent", async () => {
    const store = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver", bob: "finance-approver" }), now: NOW });
    const record = await store.create(requestInput());
    const first = await store.decide(decidedInput(record, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    assert.equal(first.revision, 2);
    assert.equal(first.status, "pending");
    // Idempotent duplicate: same actor/role/decision, no revision change.
    const duplicate = await store.decide(decidedInput(first, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    assert.equal(duplicate.revision, 2);
    assert.equal(duplicate.decisions.length, 1);
    // Changed vote is a conflict, never a mutation.
    await assert.rejects(
      () => store.decide(decidedInput(first, { actor: identity({ principal: { kind: "user", id: "alice" } }), decision: "reject" })),
      /cannot be changed/i,
    );
    const second = await store.decide(
      decidedInput(first, { actor: identity({ principal: { kind: "user", id: "bob" } }), auditRef: "audit:decide-2" }),
    );
    assert.equal(second.status, "approved");
    assert.equal(second.revision, 3);
    assert.equal(second.decisions.length, 2);
    // Same principal cannot double count for a second requirement.
    const double = await store.create(requestInput({ requirements: [{ role: "finance-approver", quorum: 2 }] }));
    await store.decide(decidedInput(double, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    const secondRequirement = await store.decide(
      decidedInput((await store.get({ tenantId: double.tenantId, requestId: double.id }))!, {
        actor: identity({ principal: { kind: "user", id: "alice" } }),
      }),
    );
    assert.equal(secondRequirement.revision, 2);
    assert.equal(secondRequirement.status, "pending");
  });

  it("denies release on wrong role, tenant, digest, policy revision, stale revision, expiry, rejection, and revocation", async () => {
    const store = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver" }), now: NOW });
    const record = await store.create(requestInput());

    // Wrong role
    await assert.rejects(
      () => store.decide(decidedInput(record, { actor: identity({ principal: { kind: "user", id: "mallory" } }) })),
      /does not hold required role/i,
    );
    // Wrong tenant
    await assert.rejects(() => store.decide(decidedInput(record, { tenantId: "other-tenant" })), /not found|OWNERSHIP/i);
    // Stale revision
    await assert.rejects(() => store.decide(decidedInput(record, { expectedRevision: 99 })), /stale/i);
    // Expired: create under one clock, decide after expiry.
    let clock = NOW;
    const clocked = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver" }), now: () => clock });
    const expiring = await clocked.create(requestInput({ expiresAt: "2026-08-17T01:00:00.000Z" }));
    clock = NOW + 2 * 60 * 60_000;
    await assert.rejects(() => clocked.decide(decidedInput(expiring)), /expired/i);

    // Rejection is terminal and denies release.
    const rejected = await store.create(requestInput());
    await store.decide(decidedInput(rejected, { decision: "reject", auditRef: "audit:reject-1" }));
    assert.equal((await store.get({ tenantId: rejected.tenantId, requestId: rejected.id }))?.status, "rejected");
    await assert.rejects(
      () =>
        store.consume({
          tenantId: rejected.tenantId,
          requestId: rejected.id,
          expectedRevision: 2,
          action: rejected.action,
          authorizedBy: identity({ principal: { kind: "service", id: "releaser" } }),
          auditRef: "audit:consume-1",
        }),
      /not approved/i,
    );

    // Revocation invalidates the grant.
    const revokedApproved = await store.create(requestInput());
    await store.decide(decidedInput(revokedApproved, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    await store.revoke({
      tenantId: revokedApproved.tenantId,
      requestId: revokedApproved.id,
      expectedRevision: 2,
      authorizedBy: identity({ principal: { kind: "user", id: "admin" } }),
      auditRef: "audit:revoke-1",
    });
    const revoked = (await store.get({ tenantId: revokedApproved.tenantId, requestId: revokedApproved.id }))!;
    assert.equal(revoked.status, "revoked");
    await assert.rejects(
      () =>
        store.consume({
          tenantId: revoked.tenantId,
          requestId: revoked.id,
          expectedRevision: revoked.revision,
          action: revoked.action,
          authorizedBy: identity({ principal: { kind: "service", id: "releaser" } }),
          auditRef: "audit:consume-2",
        }),
      /not approved/i,
    );

    // Wrong action digest denies release.
    const approved = await store.create(requestInput({ requirements: [{ role: "finance-approver", quorum: 1 }] }));
    await store.decide(decidedInput(approved, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    await assert.rejects(
      () =>
        store.consume({
          tenantId: approved.tenantId,
          requestId: approved.id,
          expectedRevision: 2,
          action: { kind: "invoice.release", digest: "wrong-digest" },
          authorizedBy: identity({ principal: { kind: "service", id: "releaser" } }),
          auditRef: "audit:consume-3",
        }),
      /does not match/i,
    );

    // Policy revision mismatch denies (pure guard, memory stores are per-instance).
    const storeV2 = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver" }, "v2"), now: NOW });
    const crossStore = await storeV2.create(requestInput());
    const storeV1 = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver" }, "v1"), now: NOW });
    await assert.rejects(() => storeV1.decide(decidedInput(crossStore)), /not found/i);
    await assert.rejects(
      () =>
        prepareApprovalDecision(crossStore, decidedInput(crossStore, { actor: identity({ principal: { kind: "user", id: "alice" } }) }), {
          authority: authority({ alice: "finance-approver" }, "v1"),
          now: NOW,
        }),
      /revision mismatch/i,
    );
  });

  it("applies bounded delegation that preserves the full chain and never widens tenant/expiry", async () => {
    const delegate = identity({ principal: { kind: "user", id: "dave" }, userId: "user-2" });
    const chain = authority({
      carol: "finance-approver",
      dave: {
        role: "finance-approver",
        expiresAt: "2026-08-18T00:00:00.000Z",
        delegatedFrom: [delegatorPrincipalRef()],
      },
    });
    const store = createMemoryApprovalStore({ authority: chain, now: NOW });
    const record = await store.create(requestInput({ delegationMaxDepth: 1, requirements: [{ role: "finance-approver", quorum: 1 }] }));
    const decided = await store.decide(decidedInput(record, { actor: delegate, auditRef: "audit:delegate-1" }));
    assert.equal(decided.status, "approved");
    const grant = decided.decisions[0]?.grant;
    assert.equal(grant?.delegatedFrom?.length, 1);
    assert.equal(grant?.delegatedFrom?.[0]?.principalId, "carol");
    assert.equal(grant?.delegatedFrom?.[0]?.tenantId, "tenant-1");

    // Depth 0 rejects any delegation chain.
    const noDelegation = await store.create(requestInput());
    await assert.rejects(() => store.decide(decidedInput(noDelegation, { actor: delegate })), /delegation chain exceeds/i);

    // Deeper chain than requested is rejected (record created by the strict authority's store).
    const deepAuthority = authority({
      dave: { role: "finance-approver", delegatedFrom: [delegatorPrincipalRef(), delegatorPrincipalRef2()] },
    });
    const deepStore = createMemoryApprovalStore({ authority: deepAuthority, now: NOW });
    const shallow = await deepStore.create(
      requestInput({ delegationMaxDepth: 1, requirements: [{ role: "finance-approver", quorum: 1 }] }),
    );
    await assert.rejects(() => deepStore.decide(decidedInput(shallow, { actor: delegate })), /delegation chain exceeds/i);

    // Grant expiry cannot outlive the request (request expires earlier).
    const nearExpiry = await store.create(requestInput({ expiresAt: "2026-08-17T12:00:00.000Z" }));
    await assert.rejects(() => store.decide(decidedInput(nearExpiry, { actor: delegate })), /cannot outlive/i);

    // Foreign-tenant chain hop is denied (record created by the strict authority's store).
    const foreignChain = authority({
      dave: { role: "finance-approver", delegatedFrom: [delegatorPrincipalRef({ tenantId: "other-tenant" })] },
    });
    const foreignStore = createMemoryApprovalStore({ authority: foreignChain, now: NOW });
    const foreignRecord = await foreignStore.create(
      requestInput({ delegationMaxDepth: 1, requirements: [{ role: "finance-approver", quorum: 1 }] }),
    );
    await assert.rejects(() => foreignStore.decide(decidedInput(foreignRecord, { actor: delegate })), /tenant mismatch/i);
  });

  it("fails closed when a subagent/model-supplied identity is passed as an approver", async () => {
    const store = createMemoryApprovalStore({ authority: authority({}), now: NOW });
    const record = await store.create(requestInput());
    // Unverified claim can never become an actor ref.
    await assert.rejects(
      () =>
        store.decide(
          decidedInput(record, {
            actor: identity({
              principal: { kind: "agent", id: "subagent" },
              verified: false,
            } as unknown as AgentIdentity),
          }),
        ),
      /verified|Identity/i,
    );
    // Even a verified agent principal gets no approver role from a compliant host authority.
    await assert.rejects(
      () => store.decide(decidedInput(record, { actor: identity({ principal: { kind: "agent", id: "subagent" } }) })),
      /does not hold required role/i,
    );
  });

  it("binds requirement, quorum, decision, and delegation caps", async () => {
    assert.equal(APPROVAL_HARD_LIMITS.maxRequirements, 100);
    assert.equal(APPROVAL_HARD_LIMITS.maxDecisions, 100);
    assert.equal(APPROVAL_HARD_LIMITS.maxDelegationDepth, 8);
    const store = createMemoryApprovalStore({ authority: authority({ a: "r" }), now: NOW });
    await assert.rejects(
      () =>
        store.create(
          requestInput({
            requirements: Array.from({ length: 101 }, (_, index) => ({ role: `r${index}`, quorum: 1 })),
          }),
        ),
      /exceed/i,
    );
    await assert.rejects(() => store.create(requestInput({ requirements: [{ role: "r", quorum: 0 }] })), /out of range/i);
    await assert.rejects(() => store.create(requestInput({ delegationMaxDepth: 9 })), /out of range/i);
  });

  it("evaluates pure quorum without a store", () => {
    const requirements = [{ role: "finance-approver", quorum: 2 }];
    const decision = (name: string, value: "approve" | "reject") =>
      ({
        id: name,
        actor: { tenantId: "t", principalId: name, principalKind: "user" },
        role: "finance-approver",
        decision: value,
        grant: { role: "finance-approver" },
        auditRef: `audit:${name}`,
        createdAt: "2026-08-17T00:00:00.000Z",
      }) as const;
    assert.equal(evaluateApproval(requirements, []), "pending");
    assert.equal(evaluateApproval(requirements, [decision("a1", "approve")]), "pending");
    assert.equal(evaluateApproval(requirements, [decision("a1", "approve"), decision("a2", "approve")]), "approved");
    assert.equal(evaluateApproval(requirements, [decision("a1", "reject")]), "rejected");
  });

  it("queries by tenant and status with cursor pages", async () => {
    const store = createMemoryApprovalStore({ authority: authority({ alice: "finance-approver" }), now: NOW });
    await store.create(requestInput());
    await store.create(requestInput());
    const released = await store.create(requestInput({ requirements: [{ role: "finance-approver", quorum: 1 }] }));
    await store.decide(decidedInput(released, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    const page1 = await store.query({ tenantId: "tenant-1", status: "pending", limit: 1 });
    assert.equal(page1.items.length, 1);
    assert.ok(page1.nextCursor);
    const page2 = await store.query({ tenantId: "tenant-1", status: "pending", cursor: page1.nextCursor, limit: 1 });
    assert.equal(page2.items.length, 1);
    assert.notEqual(page1.items[0]?.id, page2.items[0]?.id);
    const approved = await store.query({ tenantId: "tenant-1", status: "approved" });
    assert.equal(approved.items.length, 1);
    assert.equal(approved.items[0]?.id, released.id);
    const foreign = await store.query({ tenantId: "other-tenant" });
    assert.equal(foreign.items.length, 0);
  });

  function delegatorPrincipalRef(overrides: { tenantId?: string } = {}): ApprovalActorRef {
    return { tenantId: overrides.tenantId ?? "tenant-1", principalId: "carol", principalKind: "user" };
  }

  function delegatorPrincipalRef2(): ApprovalActorRef {
    return { tenantId: "tenant-1", principalId: "erin", principalKind: "user" };
  }
});
