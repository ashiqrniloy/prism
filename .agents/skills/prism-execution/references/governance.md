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

## Today

- Kernel floor: `src/redaction.ts` (`redactSecrets`), `src/security.ts`, `src/pinned-fetch.ts`, `src/guardrails.ts` (the generic guardrail stage runner packages call), `src/credentials/` (the `env:` resolver), `src/node/trust.ts` (project trust). `principal` is opaque in `src/contracts-core/principal.ts`; ownership scopes are narrow-only (`SessionOptions.ownership`, `OwnershipScopeError`).
- `@arnilo/prism-governance` (`packages/policy/governance/src/`): `policy/` (engines, OPA), `identity/` and `identity-hooks.ts` (verified identity and principal enforcement), `field-policy.ts`, `field-evidence.ts`, `claim-grounding.ts`, `audit.ts`, `readiness.ts`.
- `@arnilo/prism-guardrail-packs` (`compile.ts`, `packs/`), `@arnilo/prism-model-router` (`router/`, `around.ts` on `model.call`), `@arnilo/prism-approval` (`decide.ts` over `tool.call` effects and `coding.targets` roots).
- Current docs: [`governance`](../../../../packages/policy/governance/README.md), [`guardrail-packs`](../../../../packages/policy/guardrail-packs/README.md), [`model-router`](../../../../packages/policy/model-router/README.md), [`approval`](../../../../packages/policy/approval/README.md), [credentials-and-redaction.md](../../../../docs/credentials-and-redaction.md), [settings-auth-trust-security.md](../../../../docs/settings-auth-trust-security.md), [host-security.md](../../../../docs/host-security.md).

## Graft queries

- `graft ask "approval grant consumption quorum" --source`
- `graft ask "verified identity principal enforcement ownership scope" --source`
- `graft callers redactSecrets`

## Tests

- Kernel: `src/__tests__/credentials-redaction.test.ts`, `runtime-redaction.test.ts`, `settings-security.test.ts`, `supply-chain-security.test.ts`, `pinned-fetch.test.ts`, `principal.test.ts`, `ownership-scope.test.ts`
- Packages: `packages/policy/{governance,guardrail-packs,model-router,approval}/src/__tests__/` (run from each package directory)

## Rules

- Never weaken fail-closed defaults (protected-field deny, SSRF denial, deny-by-default policy). Fix the boundary, not the test.
- Never resolve credentials before the provider edge, and never log them.
- Telemetry and audit payloads carry no unredacted content or ownership detail.
- A `tool.call` handler that throws is a deny. Never catch-and-allow.
- Governance adds no new policy language. It uses raw policy engines, OPA, and existing presets only.
