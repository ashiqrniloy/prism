# @arnilo/prism-policy

Optional policy-decision ledger and cursor-paginated audit export for Prism.

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

Ledger stores allow/deny/modify/approval with policy version, actor refs, target, reason, expiry, and evidence references. Unrestricted prompts/tool bodies are rejected. `createFilePolicyDecisionStore({ path })` and memory storage are single-process/reference adapters.

For cross-replica PostgreSQL persistence, use `createPostgresEnterpriseState({ pool }).policy` from `@arnilo/prism-enterprise-postgres`; it preserves this `PolicyDecisionStore` contract with exact owner-bound pages and checksummed migration.

See [Policy and audit](../../docs/policy-and-audit.md) and [Enterprise PostgreSQL state](../../docs/enterprise-postgres-state.md).
