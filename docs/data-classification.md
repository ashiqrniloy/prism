# Data classification and field-level redaction

## What it does

Field-level classification and fail-closed redaction at data boundaries (plan 027 Task 8). An explicit host policy classifies every field of a JSON-like value that crosses a boundary — provider prompt egress, tool dispatch/result persistence, artifact write/read/export, audit hashing, telemetry attributes/events, and export — and returns one of four decisions per field: `allow`, `redact`, `tokenize`, or `deny`. Unknown fields fail closed under the protected default; tenant and legal-hold context is carried through the walk. The policy walk is bounded (depth/keys/string budget, cycle detection, wall-clock budget when configured), rejects unsupported values instead of stringifying guesses, and preserves shape when redaction is required (only touched paths are allocated — untouched subtrees share the input reference).

Classification is explicit: labels come from a `labelFor` hint function supplied by the boundary owner. There is no automatic sensitive-data discovery, no global registry, no decorator framework, and no second policy language. Existing hardcoded secret redaction (`createSecretRedactor`) remains in place as defense in depth and runs before the policy pass at egress seams.

## When to use it

- When a boundary must guarantee that classified fields (secrets, financial data, personal data) never reach a sink unchanged, and unknown fields must be blocked rather than guessed at.
- When different destinations need different handling of the same payload — e.g. allow a field in the prompt but redact it in telemetry — the destination is part of every decision input.
- When the protected profile must run fail-closed: the provided `createProtectedFieldPolicy()` denies unknown labels on outbound/persisted boundaries by default.
- When deep-copy cost at a boundary matters: the sparse-copy walker avoids duplicate serialization and shares pristine subtrees.

Compatibility note: existing callers that do not supply a policy are untouched (identity fast path); the protected profile is what enables fail-closed behavior, and protected deployments should supply it at every boundary.

## Inputs / request

- `applyFieldPolicy(value, policy, options)` — `value` is any JSON-like structure (plain objects, arrays, primitives, `Date`/`RegExp`/buffers pass through; `Map`/`Set` normalize to object/array shapes; functions, bigints, symbols, class instances, and cycles are rejected).
- `policy` — `(input: FieldPolicyInput) => FieldPolicyDecision`, where the input carries `{path, destination, label?, kind, tenantId?, direction, purpose?}`.
- `options` — `destination` (required), `direction` (default `"outbound"`), `tenantId`, `purpose`, `labelFor` (explicit key→label hints; no auto-discovery), `onRedact` (provenance hook used by the audit adapter), `maxDepth` (32), `maxKeys` (10,000), `maxChars` (1,000,000), `maxPolicyMs` (only when set), `tokenPrefix` (`tok_`).
- The protected default is `createProtectedFieldPolicy({ publicLabels, deniedLabels, redactedLabels, tokenizedLabels })`: `public`/structural labels pass, `secret` and `financial` deny, `personal` redacts, `token` tokenizes, and anything unlabeled denies on outbound destinations (`prompt`, `tool`, `artifact`, `audit`, `telemetry`, `export`, `persistence`) while passing inbound.

## Outputs / response / events

- A tree of the same shape with decisions applied: `deny` replaces the value with `[DENIED]`, `redact` replaces string leaves with `[REDACTED]` while preserving containers, `tokenize` replaces string leaves with a deterministic `tok_<hash>` (stable across runs for the same path+value, safe for audit chains), `allow` keeps the value. Untouched branches share the input reference (sparse copy); the input is never mutated.
- `onRedact` fires once per transformed field with `{path, reason}`; values are never included.
- `FieldPolicyError` (code `ERR_PRISM_FIELD_POLICY`) on: policy throw, invalid decision, cyclic reference, unsupported value type, or depth/key/byte/time budget breach. Error messages contain the path and the policy error class — never the value.

## Request/response example

```ts
import { applyFieldPolicy, createProtectedFieldPolicy } from "@arnilo/prism";

const fieldPolicy = createProtectedFieldPolicy();
const labelFor = (key: string) =>
  key === "apiKey" ? "secret" : key === "email" ? "personal" : key === "score" ? "public" : undefined;

const out = applyFieldPolicy(
  { score: 1, apiKey: "demo-secret-value", email: "ops@example.test", extra: "unknown" },
  fieldPolicy,
  { destination: "prompt", direction: "outbound", labelFor },
);
// { score: 1, apiKey: "[DENIED]", email: "[REDACTED]", extra: "[DENIED]" }

// Audit seam: transformation precedes canonical hashing; only {path, reason} survives.
const redactor = createAuditFieldRedactor(fieldPolicy, { labelFor });
// pass redactor as the exporter's `redact` option: createAuditExporter({ redact: redactor, ... })
```

## Implementation example

- Root ownership: the contract lives in `src/field-policy.ts` of `@arnilo/prism` and is exported from the package index (`applyFieldPolicy`, `createProtectedFieldPolicy`, `hookFieldPolicy`-style adapter `createAuditFieldRedactor`, `ALLOW_FIELD_POLICY`, `FieldPolicyError`, `FIELD_POLICY_LIMITS`).
- Egress seams: `redactMessage`, `redactProviderRequest`, `redactAgentEvent`, `redactSessionEntry`, and `redactRunLedgerRecord` (from `./redaction.js`) take an optional `(fieldPolicy, destination, labelFor)` — secret redaction runs first, then the policy pass. Without a policy the functions are unchanged (identity).
- Audit export: `createAuditFieldRedactor(fieldPolicy, { tenantId, labelFor, purpose })` produces the structural `AuditRedactionPolicy` the exporter already applies before canonical hashing; the record's denied/redacted/tokenized bytes are exactly what gets hashed and verified.
- Telemetry: `createOpenTelemetryInstrumentation({ fieldPolicy })` filters or masks exported span attributes and events — `allow` keeps, `redact` masks with `[REDACTED]`, `deny` drops, `tokenize` hashes — and policy errors drop the attribute without ever echoing the value.
- Postgres persistence: stores persist exactly what the caller-appointed policy authorizes; the protected profile is a caller-supplied boundary control, not a store default (outbox payloads keep their canonical-collision semantics unchanged).

## Extension and configuration notes

- Label vocabulary is bounded by the boundary owner: `public`, `personal`, `secret`, `financial`, `token` in the protected default; custom profiles override `deniedLabels`/`redactedLabels`/`tokenizedLabels` maps with their own reasons.
- Legal hold does not broaden view/export permissions: holds are store-level (deletion prevention), and export-boundary policy denies classified/unknown fields regardless of hold flags.
- The `labelFor` hint function is the only discovery mechanism; it must be supplied per boundary by the owner who knows the shape. The walker never guesses labels from key names.
- Tokens are deterministic per (path, value) for a given run; they are not reversible by design and are not a pseudonymization system (no k-anonymity or re-identification risk model).
- Migration guidance: for existing callers, add the policy at the outermost seam (the redaction functions or the audit/telemetry options) and verify on canaries first; there is no global config key that enables classification, so adoption is per-boundary and explicit.

## Security and performance notes

- Fail-closed guarantees: unknown fields never cross outbound/persisted boundaries under the protected default; policy exceptions, invalid decisions, and budget breaches throw without echoing values; cycles and unsupported types throw instead of stringifying guesses; tenant mismatch can be enforced inside host policy via `tenantId` on every decision input.
- Secret canaries: the ERP-T9 matrix proves secret/personal/financial canaries never reach prompt, tool, artifact, audit, telemetry, persistence, or export sinks (denied = `[DENIED]`, redacted = `[REDACTED]`, tokenized = `tok_…`, and the canary string appears nowhere in transformed output or provenance lists).
- Bounds (frozen): depth 32, keys 10,000, string budget 1,000,000 chars, optional wall-clock budget; the walk is recursive with an active-path set — cycles terminate, diamond references are re-walked per branch.
- Overhead (frozen cap `classificationMaxOverheadPercent = 10`): measured against the pre-existing boundary walk (the secret-redaction walk boundaries already ran before classification existed) on the frozen representative payload sizes, interleaved A/B — prompt 4,164 B → 99.0%, toolArgs 2,114 B → 95.8%, toolResult 9,095 B → 97.1%, artifactMetadata 3,692 B → 99.0%, auditRecord 4,243 B → 99.8%, telemetry 1,760 B → 97.7%, exportPage 10,726 B → 98.0% of the redactor-walk baseline (peak 99.8%, all ≤ 110%). The raw ratio vs native `JSON.stringify` is recorded in the Task 8 evidence (≈1.0–1.3× across fixtures); a JS policy gateway cannot beat a native serializer, so the frozen cap is defined against the walk work the boundary already performed, and this stays the benchmark contract.
- The telemetry seam drops attributes on policy error rather than failing the whole span; the audit seam maintains redaction provenance `{path, reason}` only — values never enter the hash chain.

## Related APIs

- `redactMessage` / `redactProviderRequest` / `redactAgentEvent` / `redactSessionEntry` / `redactRunLedgerRecord` — the egress seams that take the optional policy (secret redaction first, then classification).
- `createAuditFieldRedactor` → the audit-export `redact` hook; see [Signed, hash-chained audit export](audit-export.md).
- `createOpenTelemetryInstrumentation` in `@arnilo/prism-core/governance/observability` — the telemetry `fieldPolicy` option.
- `createProtectedFieldPolicy`, `ALLOW_FIELD_POLICY`, `FieldPolicyError`, `FIELD_POLICY_LIMITS` — the protected default and limits.
- The ERP-T9 threat matrix (`src/__tests__/field-policy.test.ts`) and the boundary-drill scripts cover the enforcement evidence.