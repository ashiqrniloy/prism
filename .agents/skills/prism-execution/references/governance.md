# Governance — principal, policy, guardrail packs, routing, redaction, trust

The governance package (policy engine, OPA, identity verification and principal enforcement, audit), `guardrail-packs`, `model-router`, and the kernel's security floor: redaction, secret refs, fail-closed rules, and the "packages are trusted code" stance.

## Target

- [roadmap.md](../../../../roadmap.md) §1.4 (rules), §2.4 (`tool.call`, `run.input`, `model.request`, `model.call`), §2.9 (governance, `guardrail-packs`, `model-router` rows). The packages are built in roadmap Phase 9.
- **Kernel:**
  - `principal` is **opaque and optional**; the kernel never synthesizes or verifies an identity
  - packages that need a verified identity enforce it themselves: `governance`, and durable effects in `tools-coding`
  - the kernel keeps redaction, the limits floor, and fail-closed loading
- **Packages are trusted in-process code.** Capabilities gate SDK-mediated APIs and are shown at install time. They are not a sandbox, and docs must not claim one.
- **Secrets:** config and manifest values are refs (`env:NAME`, `keyring:name`). A literal secret in config fails validation, and secrets never reach events, `inspect()`, errors, or stores.
- **Project scope:** project manifests and project MCP servers need the host's trust callback, or they stay unloaded.

## Today (0.12 code being replaced)

- Kernel parts:
  - `src/identity.ts` (`AgentIdentity`, `assertIdentityActive`), `src/secure-agent.ts`, `src/host-composition.ts`
  - `src/field-policy.ts`, `src/field-evidence.ts`, `src/evidence-grounding.ts`, `src/guardrail-packs/`
  - `src/redaction.ts`, `src/security.ts`, `src/pinned-fetch.ts` (moves with web tools)
- Packages: `packages/prism-core/src/governance/{policy,model-router,observability,evals,prompts}` (OPA in `policy/opa.ts`), `packages/prism-core/src/enterprise/`.
- In-flight: plan 142 made SDK `identity` required with a `"local-operator"` profile. The roadmap replaces that with the opaque `principal`.
- Current docs (released contract): [agent-identity.md](../../../../docs/agent-identity.md), [policy-and-audit.md](../../../../docs/policy-and-audit.md), [audit-export.md](../../../../docs/audit-export.md), [model-routing.md](../../../../docs/model-routing.md), [data-classification.md](../../../../docs/data-classification.md), [settings-auth-trust-security.md](../../../../docs/settings-auth-trust-security.md), [credentials-and-redaction.md](../../../../docs/credentials-and-redaction.md), [host-security.md](../../../../docs/host-security.md).

## Graft queries

- `graft ask "approval grant consumption quorum" --source`
- `graft ask "identity verified principal ownership resolveRunIdentity" --source`
- `graft callers redactSecrets`

## Tests

- `src/__tests__/identity.test.ts`, `guardrails.test.ts`, `credentials-redaction.test.ts`, `field-policy.test.ts`, `settings-security.test.ts`, `runtime-redaction.test.ts`, `supply-chain-security.test.ts`, `pinned-fetch.test.ts`
- `packages/prism-core` governance suites (run from the workspace directory)

## Rules

- Never weaken fail-closed defaults (protected-field deny, SSRF denial, deny-by-default policy). Fix the boundary, not the test.
- Never resolve credentials before the provider edge, and never log them.
- Telemetry and audit payloads carry no unredacted content or ownership detail.
- A `tool.call` handler that throws is a deny. Never catch-and-allow.
- Governance adds no new policy language. It uses raw policy engines, OPA, and existing presets only.
