# Governance — identity, policy, credentials, redaction, trust

Identity verification, policy decisions and approvals, credentials, redaction,
host security posture.

## Docs (current contracts)

- [agent-identity.md](../../../../docs/agent-identity.md): `Principal`/`AgentIdentity`, delegation narrowing, OIDC verifier.
- [policy-and-audit.md](../../../../docs/policy-and-audit.md): decision ledger, multi-party approvals, OPA evaluator.
- [audit-export.md](../../../../docs/audit-export.md): signed hash-chained audit batches, independent verification.
- [model-routing.md](../../../../docs/model-routing.md): allow-list/budget/rate governance, atomic reservation.
- [settings-auth-trust-security.md](../../../../docs/settings-auth-trust-security.md): settings providers, trust/permission policies.
- [credentials-and-redaction.md](../../../../docs/credentials-and-redaction.md): resolver order, OAuth helpers, secret redaction.
- [credential-storage.md](../../../../docs/credential-storage.md): AES-GCM envelopes, keychain, KMS wrap, work/OIDC subpaths.
- [host-security.md](../../../../docs/host-security.md): fail-closed checklist across all boundaries.

## Graft queries

- `graft ask "approval grant consumption quorum" --source`
- `graft ask "pinned fetch DNS redirect fail closed" --source`
- `graft callers redactSecrets`

## Tests

- `src/__tests__/identity.test.ts`, `guardrails.test.ts`, `credentials-redaction.test.ts`, `field-policy.test.ts`
- `src/__tests__/settings-security.test.ts`, `runtime-redaction.test.ts`, `supply-chain-security.test.ts`, `pinned-fetch.test.ts`

## Don't do

- Don't weaken fail-closed defaults (protected-field deny, SSRF denial, fail-closed deny) — fix the boundary, not the test.
- Don't store or log secrets; don't resolve credentials before the provider edge.
- Don't add telemetry/audit payloads that carry unredacted content or ownership detail.

Adjacent: `data-classification.md` (`applyFieldPolicy`), `operations.md`/`disaster-recovery.md` (HA runbooks), `evaluations.md` (scoring).
