# Policy and audit

## What it does

`@arnilo/prism-policy` records redacted allow/deny/modify/approval decisions with policy version, actor refs from verified `AgentIdentity`, target, reason, expiry, and evidence references. Hosts export cursor-paginated pages to append-only/WORM sinks. The package does not embed a mandatory global policy engine, KMS, or cloud WORM SDK.

## When to use it

Use it when enterprise hosts need an attributable audit trail alongside existing guardrails, permission checks, and tool-approval interruptions. Skip it for single-tenant apps that only need `RunLedger` / guardrail events.

Do not store unrestricted prompts, tool argument bodies, JWTs, or credential secrets on decision records. Do not treat the reference memory/file adapters as production WORM.

## Inputs / request

| API / field | Meaning |
| --- | --- |
| `createPolicyEvaluator({ policyId, policyVersion, evaluate })` | Host rule callback stamped with immutable id/version |
| `PolicyEvaluateRequest` | Verified `identity`, `action`, `resource`, optional evaluator-only `context` (never persisted) |
| `AppendPolicyDecisionInput` | Decision fields + verified identity; ownership from identity or explicit scope |
| `createMemoryPolicyDecisionStore` / `createFilePolicyDecisionStore` | Append-only reference ledgers |
| `exportPolicyDecisions({ store, ownership, cursor, limit, sink? })` | Cursor pages; optional host WORM sink |
| `recordGuardrailDecision` / `recordPermissionDecision` / `recordToolApprovalDecision` | Optional bridges from existing decision points |

Frozen caps (default / hard): decision `8 KiB / 64 KiB`, reason or evidence ref `1 KiB / 8 KiB`, export page `100 / 500`.

## Outputs / response / events

- `PolicyDecisionRecord` — frozen redacted row (`actor` refs, `evidenceRefs`, no payload blob).
- `evaluateAndAppend` — evaluate then append in one call.
- Policy version mismatch (`requirePolicyVersion`) and unrestricted payload keys fail closed (`ERR_PRISM_POLICY_VERSION` / `ERR_PRISM_POLICY_PAYLOAD`).
- Missing/expired/unverified identity fails via core `assertIdentityActive` before append.

## Request/response example

```json
{
  "id": "dec-1",
  "policyId": "mail",
  "policyVersion": "2026-07-23",
  "outcome": "approval",
  "actor": {
    "tenantId": "tenant-1",
    "userId": "user-1",
    "principalId": "agent-42",
    "principalKind": "agent",
    "sponsorId": "sponsor-7"
  },
  "target": { "kind": "draft", "id": "d1" },
  "reason": "external send",
  "evidenceRefs": ["rule:external"],
  "createdAt": "2026-07-23T12:00:00.000Z",
  "tenantId": "tenant-1",
  "userId": "user-1"
}
```

## Implementation example

```ts
import { type AgentIdentity } from "@arnilo/prism";
import {
  createFilePolicyDecisionStore,
  createPolicyEvaluator,
  evaluateAndAppend,
  exportPolicyDecisions,
  recordToolApprovalDecision,
} from "@arnilo/prism-policy";

const evaluator = createPolicyEvaluator({
  policyId: "mail",
  policyVersion: "2026-07-23",
  evaluate: ({ action }) =>
    action === "mail.send"
      ? { outcome: "approval", reason: "external send", evidenceRefs: ["rule:external"] }
      : { outcome: "allow" },
});

const store = createFilePolicyDecisionStore({
  path: "/var/prism/policy-decisions.jsonl",
  requirePolicyVersion: "2026-07-23",
});

await evaluateAndAppend(
  { identity, action: "mail.send", resource: { kind: "draft", id: "d1" } },
  { store, evaluator, id: crypto.randomUUID() },
);

await recordToolApprovalDecision({
  store,
  evaluator,
  id: crypto.randomUUID(),
  identity,
  toolName: "mail.send",
  toolCallId: "call-1",
  evidenceRef: "run:abc/tool:call-1",
});

for await (const page of exportPolicyDecisions({
  store,
  tenantId: identity.tenantId,
  userId: identity.userId,
  sink: { async write(records) { await worm.append(records); } },
})) {
  void page;
}
```

## Extension and configuration notes

Policy is optional. Hosts wire `record*` helpers or `evaluateAndAppend` at permission/guardrail/tool-approval/router/connector boundaries. Model-router and work-connector packages (later Phase 8 tasks) may call the same store when configured. Replace file/memory adapters with host WORM/KMS without changing record shape.

## Security and performance notes

- Approvals require verified `AgentIdentity`; actor fields are refs only.
- Policy version pin fails closed on mismatch.
- Unrestricted payload field names (`prompt`, `body`, `toolArguments`, …) are rejected before append.
- Evaluate/append are O(fields) and network-free in-package; remote WORM I/O stays in the host sink/adapter.
- The OPA decision fetch (0.2.1) is DNS-pinned through the core `pinnedFetch` primitive: one resolve per request, every resolved address SSRF-checked before the connect (rebinding defense), redirects rejected outright, timeouts/retries unchanged, and private-answer denials surface `MediaContentError` (`ssrf_denied`) rather than a transport error.
- Export never full-scans: page size is capped; raise hard caps only with Phase 8 freeze + tests + docs updates.

## OPA external policy adapter (`@arnilo/prism-policy/opa`, 0.0.28)

Optional `createOpaPolicyEvaluator` evaluates `PolicyEvaluateRequest`s against a host-pinned OPA REST endpoint (`POST /v1/data/<path>` with `{"input": <document>}`) and returns a core `PolicyEvaluator` for `evaluateAndAppend`. Native `fetch` only; no OPA SDK dependency.

| Option | Meaning |
| --- | --- |
| `url` / `policyId` / `policyVersion` | Pinned decision URL + immutable ledger attribution |
| `mapInput` | Input builder (default: redacted actor refs — tenant/account/user/principal/sponsor/scopes + action + resource; never prompts, tool args, JWTs, or credentials; `context` omitted by design) |
| `mapDecision` | Decision mapper (default: boolean, `{allow}`, or `{outcome, reason?, evidenceRefs?, expiresAt?}`) |
| `onFailure` | `deny` (default) returns a recorded deny result on OPA failures; `escalate` rethrows the `PolicyError` |
| `requirePolicyVersion` | Sends `provenance=true` and requires a matching OPA bundle revision (stale/missing fails closed) |
| `timeoutMs` / `maxInputBytes` / `maxResponseBytes` / `maxRetries` | Bounded caps (2 s/30 s, 16/256 KiB, 64 KiB/1 MiB, 0/2 retries — only timeout/transport/5xx retried) |
| `redactor` | `SecretRedactor` applied to OPA-provided `reason`/`evidenceRefs` before they leave the adapter |
| `ssrf` | `SsrfPolicy` for the endpoint; denials surface `MediaContentError` (`ssrf_denied`) |

```ts
import { createOpaPolicyEvaluator } from "@arnilo/prism-policy/opa";
import { createPostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";
import { evaluateAndAppend } from "@arnilo/prism-policy";

const evaluator = createOpaPolicyEvaluator({
  url: "https://opa.internal:8181/v1/data/prism/allow",
  policyId: "opa-prism",
  policyVersion: "2026-08-01",
});
const state = await createPostgresEnterpriseState({ pool, schema: "prism" });
await evaluateAndAppend(request, { store: state.policy, evaluator, id: crypto.randomUUID() });
```

Fail-closed codes: `ERR_PRISM_OPA_TIMEOUT`, `ERR_PRISM_OPA_TRANSPORT`, `ERR_PRISM_OPA_RESPONSE_PARSE`, `ERR_PRISM_OPA_RESPONSE_BOUNDS`, `ERR_PRISM_OPA_DECISION_MAPPING`, `ERR_PRISM_OPA_VERSION_MISMATCH`. Redirects are never followed; response bodies are read with a hard cap; caller aborts propagate (never converted to a policy outcome); timeout/parse/bounds/version failures record a deny row through `evaluateAndAppend`, so the durable Phase 6 ledger captures them unchanged.

## PostgreSQL enterprise state (0.0.23)

For durable multi-replica policy decisions, construct [`createPostgresEnterpriseState`](enterprise-postgres-state.md) and pass its `policy` store to the existing helpers. PostgreSQL keeps the same append/query contract, requires tenant scope and verified identity at append, binds owner data into opaque cursors, validates record bounds on read, and rejects duplicate ids. Memory and JSONL remain development/reference adapters, not production WORM or cross-replica stores.

```ts
const state = await createPostgresEnterpriseState({ pool, schema: "prism" });
await evaluateAndAppend(request, { store: state.policy, evaluator, id: crypto.randomUUID() });
```

`state.close()` leaves a caller-owned pool open. Run `state.cleanup(...)` from an authorized host schedule only when expiration cleanup is needed; it does not run in the background.

## Related APIs

- [Model routing](model-routing.md)
- [Agent identity](agent-identity.md)
- [Guardrails](guardrails.md)
- [Runs and usage ledger](runs-and-usage.md)
- [Workflows](workflows.md): proactive schedule capability enable/revoke events bridge here via `onCapability`.
- [Host security](host-security.md)
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable policy/evaluation/work/router composition.
- Package README: [`@arnilo/prism-policy`](../packages/policy/README.md)
