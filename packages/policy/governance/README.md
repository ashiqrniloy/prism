# @arnilo/prism-governance

Deny-by-default policy, OPA, approvals, and an audit ledger, as one `tool.call` gate and opt-in `run.input` / `model.request` gates. The moved `packages/prism-core/src/governance/policy` surface (evaluator, OPA adapter, ledger stores, approvals, audit export, canonical JSON) stays available as library exports.

## Install

```bash
prism add @arnilo/prism-governance
```

```ts
import governance from "@arnilo/prism-governance";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    codingTools({ root }),
    governance({
      default: "deny",
      rules: [{ tools: ["read_file"], outcome: "allow" }],
      audit: { store: "memory" },
    }),
  ],
});
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `"allow" \| "deny"` | `"deny"` | Outcome when no inline rule matches and OPA is not configured. |
| `rules[]` | `{ tools?, effects?, principalKinds?, principalIds?, scopes?, outcome, reason? }[]` | `[]` | First matching rule wins. All present fields must match. `outcome` is `allow` / `deny` / `approval`. `scopes` is enforced against the verified identity even when OPA supplies the outcome. |
| `identity` | `{ verifier: "oidc" \| "service", service? }` | — | When set, a `run.input` handler verifies the session principal before each run. `verifier` selects the service name (`identity.verifier.oidc` or `identity.verifier`); `service` overrides. |
| `opa` | `{ url, path?, headers?, timeoutMs?, policyId?, policyVersion? }` | — | When set, every decision goes through the OPA REST adapter instead of inline rules. |
| `opa.headers` | `{ [name]: { ref, prefix? } }` | — | Ref-only headers, resolved through `prism.credentials.resolve`. A literal value fails validation. |
| `audit` | `{ store: "memory" \| "file", path?, required?, export? }` | — | Appends every decision to a `PolicyDecisionStore`. `required` defaults to `true`. |
| `hooks.runInput` | `boolean` | `false` | Opt in to a `run.input` gate. |
| `hooks.modelRequest` | `boolean` | `false` | Opt in to a `model.request` gate. |
| `require.principal` | `boolean` | `false` | Fail the run when the session has no principal. |
| `require.ownership` | `boolean` | `false` | Fail the run when the session has no identified principal. |

Unknown config keys, a literal OPA header value, and `audit.store: "file"` without `audit.path` all fail `createAgent`.

### `identity`

Plan 159 Task 8 moved the identity module here. The host installs an `IdentityVerifier` service and names it in config; governance does not build a verifier and does not fetch JWKS. `run.input` verifies `{ principal, metadata }` once per run and caches the result in `state.agent` until `expiresAt` (one verifier call per run when uncached; an OIDC verifier adds one JWKS fetch per key rotation). A `tool.call` handler re-checks expiry, revocation, and principal continuity, and denies when the matching rule's `scopes` are missing. The verified identity is the `governance.identity` service (`get(sessionId)`), used as the audit actor. Without `identity` configured, none of this is registered. A missing verifier service is `missing_service` at `createAgent`. Denial text carries the frozen `IdentityError.reason` only.

### `require`

Plan 159 Task 7 deleted `createSecureAgent`; its guarantees are explicit `AgentConfig` fields (redactor, trust, validator, limits, ownership, `principal`) plus this config. A package cannot read `AgentConfig`, so the check runs at the run boundary and fails closed with `ERR_PRISM_GOVERNANCE_REQUIREMENT`: a `run.input` transform rejects the run and a `tool.call` decide handler denies. `require.ownership` asserts an identified principal (the session view carries no ownership scope); the full scope check is the readiness report's.

## What it changes

- `describeStorage` classifies a store by declared kind. It reads no contents and no connection strings.
- One `tool.call` decide handler. `deny` becomes `{ deny }` with the policy reason, `approval` becomes `{ ask }` (host confirm or suspension), `allow` registers nothing. No matching rule applies `default`. A throwing handler is a deny.
- Opt-in `run.input` / `model.request` transforms that reject the run or the outgoing request with the policy reason.
- Every decision is recorded through `evaluateAndAppend` into the configured `PolicyDecisionStore`. An observe handler on `decision.resolved` (and a blocked `tool.completed`) closes an `approval` record with its resolved outcome.
- Services `governance.policy` (the evaluator), `governance.identity` when `identity` is set (`{ get(sessionId) }`), and, when `audit` is set, `governance.audit` (`{ store, export }`).

The audit record holds redacted actor refs, the policy id/version, the target, the reason, and evidence refs only. The prepare path rejects payload-like keys, so raw tool arguments never enter the ledger.

## Library exports (plan 159 Task 7)

The governance-adjacent kernel modules moved here and stay available as library exports:

- **Readiness report** — `inspectHostComposition` / `assertHostCompositionReadiness` / `HostCompositionError`, plus `describeStorage` (local; it left the kernel). An inert, bounded, secret-redacting report over an `Agent`/`AgentConfig`: effective tools, credential refs, ownership, storage durability, sandbox containment, governance coverage, and profile readiness (`personal` / `business`). Zero network calls; `assertHostCompositionReadiness` throws on any readiness error.
- **Field policy** — `applyFieldPolicy`, `createProtectedFieldPolicy`, `ALLOW_FIELD_POLICY`, `FIELD_POLICY_LIMITS`, `FieldPolicyError`, and `createAuditFieldRedactor`. The kernel redaction seam no longer takes a field policy (secret redaction stays a separate kernel pass), so the boundary owner applies it: `applyFieldPolicy(value, policy, { destination, direction, labelFor })`. Denied/redacted/tokenized fields fail closed; unsupported values and over-budget walks throw instead of stringifying guesses.
- **Field evidence** — `createFieldEvidenceGuardrail`: a `Guardrail<"tool_input">` verifying that each required argument path carries a typed source reference whose revision and normalized value match host evidence. Wire it through `tool.call` with the kernel's `runGuardrailList`:

  ```ts
  const guardrail = createFieldEvidenceGuardrail({ toolName: "submit_invoice", required: ["amount"], evidence });
  hooks.on("tool.call", async (payload, context) => {
    const { terminal } = await runGuardrailList({
      stage: "tool_input",
      guards: [guardrail],
      value: { type: "tool_call", id: payload.callId, name: payload.name, arguments: payload.args },
      context: { sessionId: payload.sessionId, runId: payload.runId, toolName: payload.name, metadata: {}, signal: context.signal },
      emit: (event) => context.emit(event),
      package: "@arnilo/prism-governance",
    });
    return terminal ? { deny: `field evidence ${String(terminal.metadata?.violation)} for ${payload.name}` } : undefined;
  });
  ```

- **Identity** — `AgentIdentity`, `IdentityVerifier`, `IdentityError`, `assertIdentityActive`, `narrowIdentity`, `assertIdentityMatchesOwnership`, `assertIdentityPropagation`, `ownershipFromIdentity`, and the limit helpers. `Principal` stays a kernel type and is re-exported here.
- **Claim grounding** — `createClaimGroundingGuardrail`: a `model.response` gate for numeric figures that must match a same-run tool result or a host-governed figure (optionally with an `[evidence:<ref>]` citation). `onViolation: "block"` (default) rejects the run; `"flag"` emits a `guardrail.decision` package event. The evidence source and tool-results supplier are host functions, so both are library exports rather than config switches.

## Fail closed

An unreachable OPA endpoint, a timeout, a malformed decision document, or a failed required audit append is a deny, never an allow. SSRF denials surface the kernel `MediaContentError` and are caught as a deny. `modify` is not a supported config outcome and fails closed. A field-evidence or claim-grounding denial never echoes the checked value.

## Performance

Inline rules cost one in-process match per call. OPA costs one HTTP request per decision, bounded by `timeoutMs` (default 2000, hard 30000). The package keeps no decision cache — a stale allow is the failure it avoids. With `audit` unset, no store write is made; with `audit` set, one append per decision. Identity verification is one verifier call per run unless the cached identity is still inside `expiresAt`; an OIDC-backed verifier adds one JWKS fetch per key rotation. With `identity` unset, no verifier call is made.

## Capabilities

`credentials`.

## Example

`examples/governance-deny.ts` runs one network-free demo: `default: "deny"` with a `read_file` allow rule lets `read_file` run, blocks `write_file` with a `hook_denied` result naming the policy, completes the run, and leaves both decisions in the audit ledger.
