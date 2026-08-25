const identity = {
    tenantId: "tenant-1",
    userId: "user-7",
    principal: { kind: "agent", id: "agent-9" },
    scopes: ["enterprise:write"],
    verified: true,
    issuedAt: "2026-08-03T00:00:00.000Z",
};
/** Call after `createPostgresEnterpriseState({ pool, schema: "prism" })`. */
export async function recordEnterpriseState(state) {
    const now = new Date().toISOString();
    await state.policy.append({
        id: "policy-1",
        policyId: "mail",
        policyVersion: "2026-08-03",
        outcome: "approval",
        identity,
        target: { kind: "draft", id: "draft-1" },
        evidenceRefs: ["rule:external-recipient"],
        createdAt: now,
    });
    await state.evaluations.append({
        id: "eval-1",
        scorerId: "quality",
        status: "scored",
        score: 1,
        sampled: true,
        tenantId: identity.tenantId,
        userId: identity.userId,
        createdAt: now,
    });
    const claim = await state.workIdempotency.begin({ identity, key: "mail-send-1", op: "mail.send" });
    if (claim.outcome === "acquired") {
        await state.workIdempotency.complete({
            identity,
            key: "mail-send-1",
            op: "mail.send",
            claimToken: claim.record.claimToken,
            expectedVersion: claim.record.version,
            result: { draftId: "draft-1", resourceId: "message-1" },
        });
    }
    await state.modelRouter.addUsage({
        key: { tenantId: "tenant-1", userId: "user-7", principalId: "agent-9", provider: "openai", model: "gpt-4.1-mini" },
        tokens: 100,
        windowMs: 86_400_000,
        now: Date.now(),
    });
    return state.cleanup({ tenantId: "tenant-1", userId: "user-7", principalId: "agent-9" });
}
