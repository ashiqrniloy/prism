# @arnilo/prism-policy

Optional policy-decision ledger, cursor-paginated audit export, and multi-party approval records for Prism.

Install explicitly. Not in `prism-code` / `prism-sdk` profiles (Task 10 enrolls `prism-all` only).

## Install

```bash
npm install @arnilo/prism-policy @arnilo/prism
```

## Usage

```ts
import { assertIdentityActive, type AgentIdentity } from "@arnilo/prism";
import {
  createMemoryPolicyDecisionStore,
  createPolicyEvaluator,
  evaluateAndAppend,
  exportPolicyDecisions,
} from "@arnilo/prism-policy";

const evaluator = createPolicyEvaluator({
  policyId: "mail",
  policyVersion: "2026-07-23",
  evaluate: ({ action }) =>
    action === "mail.send"
      ? { outcome: "approval", reason: "external send", evidenceRefs: ["rule:external"] }
      : { outcome: "allow" },
});

const ledger = createMemoryPolicyDecisionStore({ requirePolicyVersion: "2026-07-23" });
assertIdentityActive(identity);
await evaluateAndAppend(
  { identity, action: "mail.send", resource: { kind: "draft", id: "d1" } },
  { store: ledger, evaluator, id: crypto.randomUUID() },
);

for await (const page of exportPolicyDecisions({
  store: ledger,
  tenantId: identity.tenantId,
  userId: identity.userId,
  sink: { async write(records) { /* host WORM / SIEM */ } },
})) {
  // page.items are redacted refs only
}
```

## Multi-party approvals

Approval requests carry immutable action/requirement data; verified host identities vote through an explicit `ApprovalAuthority` that resolves roles. Requester/approver separation, distinct-principal quorums, expiry, revocation, bounded delegation, rejection, and policy-revision pins fail closed before any release. Decisions persist the accepted role grant and full delegation chain; model/tool/subagent claims never become principals.

```ts
import { createMemoryApprovalStore, type ApprovalAuthority } from "@arnilo/prism-policy";

const authority: ApprovalAuthority = {
  policyRevision: "2026-07-23",
  async resolveRoles(actor, request) {
    // Host-owned role source keyed on verified identity; return [] to deny.
    return [{ role: "finance-approver" }];
  },
};
const approvals = createMemoryApprovalStore({ authority });

const request = await approvals.create({
  tenantId,
  requester: verifiedRequester,
  action: { kind: "invoice.release", digest },
  requirements: [{ role: "finance-approver", quorum: 2 }],
  separateFromRequester: true,
  expiresAt,
});
await approvals.decide({
  tenantId,
  requestId: request.id,
  expectedRevision: request.revision,
  role: "finance-approver",
  actor: verifiedApprover,
  decision: "approve",
  auditRef,
});

const granted = await approvals.get({ tenantId, requestId: request.id });
if (granted?.status === "approved") {
  // Host may release the protected action; consume joins the transaction.
  await approvals.consume({
    tenantId, requestId: granted.id, expectedRevision: granted.revision,
    action: granted.action, authorizedBy: releaser, auditRef: releaseRef,
  });
}
```

`createMemoryApprovalStore` is a single-process/reference adapter. For cross-replica PostgreSQL durability use `createPostgresApprovalStore({ pool, schema, authority })` from `@arnilo/prism-enterprise-postgres` (migration `005_erp_approvals`); consume accepts a caller-owned `client` so grant consumption and action release commit (or roll back) together.

Ledger stores allow/deny/modify/approval with policy version, actor refs, target, reason, expiry, and evidence references. Unrestricted prompts/tool bodies are rejected. `createFilePolicyDecisionStore({ path })` and memory storage are single-process/reference adapters.

For cross-replica PostgreSQL persistence, use `createPostgresEnterpriseState({ pool }).policy` from `@arnilo/prism-enterprise-postgres`; it preserves this `PolicyDecisionStore` contract with exact owner-bound pages and checksummed migration.

See [Policy and audit](../../docs/policy-and-audit.md) and [Enterprise PostgreSQL state](../../docs/enterprise-postgres-state.md).

## Signed, hash-chained audit export

`createAuditExporter` exports tenant-scoped audit records as signed, hash-chained batches: canonical RFC 8785 record envelopes, SHA-256 record chain, host-signed manifest, required WORM acknowledgement (`{batchId, digest}` must match) before the CAS cursor advances, optional SIEM mirror with replayable pending status, and pre-hash redaction with `{path, reason}` provenance. Powers: `createAuditExporter`, `verifyAuditBatch`, `AuditSigner`, `AuditWormSink`, `AuditSiemSink`, `AuditCursorStore`, `createMemoryAuditCursorStore`, `canonicalJson`.

```ts
import {
  createAuditExporter,
  createMemoryAuditCursorStore,
  verifyAuditBatch,
} from "@arnilo/prism-policy";

const exporter = createAuditExporter({
  source,                  // tenant-scoped stable-order pages
  cursorStore: createMemoryAuditCursorStore(),
  signer,                  // host: sign(bytes) -> Uint8Array; never raw keys
  wormSink,                // immutable sink; ack must name batchId + digest
  siemSink,                // optional mirror
});
const result = await exporter.exportNext({ tenantId: "acme", maxRecords: 1000 });
const verified = verifyAuditBatch({
  artifactBytes: result.artifactBytes,
  publicKey: "...",      // host verification key
  expectedTenantId: "acme",
});
```

- Failed exports replay the same page and batch id; the cursor moves only after the WORM acknowledgement matches. SIEM failure records a pending status; `retryPendingSiem` replays it with host-supplied artifact bytes.
- Verification is stateless: `verifyAuditBatch` re-derives the chain from the artifact bytes plus the public key. Keys never enter records or logs.
- Caps are frozen: 1,000 records / 10 MiB per batch, at most 8 pending SIEM batches. See `docs/audit-export.md` for the manifest format and the CLI verifier (`scripts/verify-audit-export.mjs`).
