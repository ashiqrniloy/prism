# Agent identity

## What it does

Authenticated `Principal` / `AgentIdentity` contracts let hosts attach verified tenant, sponsor/owner, delegated actor, scopes, credential references, issued/expiry, and revocation metadata to runs and tools. Core helpers assert activity, narrow scopes for delegation, project onto `OwnershipScope`, refuse silent widening, and emit redacted telemetry attributes. Prism does not store identities or verify tokens itself — hosts supply an `IdentityVerifier`.

## When to use it

Use these APIs when embedding Prism in multi-tenant or enterprise hosts that already authenticate callers (for example Microsoft Entra Agent ID governance). Use them before tools, providers, MCP, A2A, workflows, or persistence that must carry attributable identity.

Do not treat optional `ownership` strings as identity provenance. Do not accept caller-asserted identity headers without a host verifier. Do not put JWTs or secret credential material on identity records.

## Inputs / request

| Field | Meaning |
| --- | --- |
| `Principal` | Actor id/kind (user, service, agent) plus optional display name |
| `AgentIdentity` | Verified context: required `tenantId`, optional account/user, principal, sponsor/owner, scopes, credential refs, issued/expiry/revocation, `verified: true` |
| `IdentityVerifier.verify(input)` | Host-owned authentication → `AgentIdentity` |
| `RunOptions.identity` / `AgentConfig.identity` | Optional verified identity for a run or agent default |
| Server/MCP/A2A `authorization.identity` | Optional verified identity on authorize results |

Frozen caps (defaults / hard): scopes `64 / 256`, scope bytes `128 / 512`, metadata `4 KiB / 16 KiB`, credential ref / principal id `256 B / 2 KiB`.

## Outputs / response / events

- `assertIdentityActive` — fail closed on unverified/expired/revoked/wrong-tenant/over-limit shapes (sync, no network).
- `narrowIdentity` — child scopes ⊆ parent; tenant and ownership ids immutable; expiry cannot extend.
- `ownershipFromIdentity` — projects tenant/account/user onto existing ownership seams.
- `assertIdentityMatchesOwnership` / `assertIdentityPropagation` — refuse widen across ownership or boundary hop.
- `identityTelemetryAttributes` — redacted refs for metadata/OTel (`prism.identity.*`); never includes credential secrets or raw tokens.
- Tool `ToolExecutionContext.identity` — set when a run carries verified identity.

## Request/response example

```json
{
  "tenantId": "tenant-1",
  "userId": "user-1",
  "principal": { "kind": "agent", "id": "agent-42" },
  "sponsor": { "kind": "user", "id": "sponsor-7" },
  "scopes": ["mail.read", "mail.draft"],
  "credentialRefs": ["m365:tenant-1:user-1"],
  "issuedAt": "2026-07-23T00:00:00.000Z",
  "expiresAt": "2026-07-23T01:00:00.000Z",
  "verified": true
}
```

## Implementation example

```ts
import {
  assertIdentityActive,
  createAgent,
  identityTelemetryAttributes,
  narrowIdentity,
  ownershipFromIdentity,
  type AgentIdentity,
  type IdentityVerifier,
} from "@arnilo/prism";

const verifier: IdentityVerifier = {
  async verify(request) {
    // Host validates JWT/session, then returns AgentIdentity with verified: true
    return hostVerifiedIdentityFrom(request);
  },
};

const identity = await verifier.verify(incomingRequest);
assertIdentityActive(identity);
const child = narrowIdentity(identity, { scopes: ["mail.read"] });

const agent = createAgent({
  model,
  provider,
  ownership: ownershipFromIdentity(identity),
  identity,
});

await agent.createSession().run("Summarize inbox", {
  identity: child,
  ownership: ownershipFromIdentity(child),
  metadata: identityTelemetryAttributes(child),
});
```

Server / MCP / A2A authorize callbacks may include the same `identity` beside `ownership`. Handlers assert activity and ownership match before admitting work.

## Extension and configuration notes

Identity is optional. Hosts that only set `ownership` keep prior behavior. When identity is present, run start and tool dispatch assert it before side effects. Workflows forward `RunWorkflowOptions.identity` into agent nodes. Credential values stay behind `CredentialResolver` keys listed in `credentialRefs`.

## Security and performance notes

- Caller-asserted identity without `IdentityVerifier` is unsupported at trust boundaries.
- Delegation only narrows scopes; tenant/account/user cannot widen on propagation.
- Credential refs never expand to secrets in events, ledgers, or telemetry attributes.
- Checks are O(fields) and network-free in core; remote auth stays in the host verifier.
- Raising hard caps requires updating `docs/review-coverage-2026-07-23-phase-8.md`, tests, and docs.

## Related APIs

- [Policy and audit](policy-and-audit.md)
- [Host security guide](host-security.md)
- [Public contracts](public-contracts.md)
- [Server](server.md)
- [Supervisors](supervisors.md) / [A2A](a2a.md)
- [MCP tools](mcp-tools.md)
- [Observability](observability.md)
- [Runs and usage ledger](runs-and-usage.md)
