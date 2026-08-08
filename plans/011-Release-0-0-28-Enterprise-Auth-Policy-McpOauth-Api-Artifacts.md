# Release 0.0.28 — Enterprise authentication, policy, MCP OAuth, API, and artifact adapters

Roadmap phase: Phase 11 (`roadmap.md`, lines 869–945).
Baseline: `@arnilo/prism` **0.0.27** (Phase 10 exit gate passed 2026-08-07).
Target: `@arnilo/prism` **0.0.28**.
Prerequisite: Phase 6 durable stores / events / approval / idempotency complete; `IdentityVerifier` (`src/identity.ts`), `@arnilo/prism-policy` evaluator+ledger, `@arnilo/prism-credentials-node` OAuth helpers, `@arnilo/prism-mcp` bridge/server on pinned `@modelcontextprotocol/sdk@1.30.0`, and `@arnilo/prism-server` `ArtifactService` already exist.

## Objectives

- Reduce repeated security-critical host plumbing while preserving host ownership of users, login UX, policy authorship, credentials, and storage topology.
- Provide one bounded reference adapter for each confirmed enterprise integration seam: OIDC/JWKS identity verification, external policy decisions (OPA), MCP OAuth client/server, host-selected OpenAPI operations, and artifact blob storage.
- Keep every adapter optional: hosts that wire nothing keep current behavior exactly.

## Non-goals

- Login UI, user directory, SAML, SCIM (host/product scope).
- Shipping OPA **and** Cedar; one external policy adapter (OPA) chosen from demand; Cedar deferred.
- Automatically exposing complete OpenAPI documents (model-driven discovery).
- Multiple object-store adapters; one reference blob adapter plus host contract.
- New persistence engines, new approval contracts, or core changes beyond reusable contracts proven missing by Task 0 primitive review.

## Expected Outcome

- `createOidcIdentityVerifier` (optional) validates pinned issuer/audience/signature/expiry/nbf/clock skew/algorithm/key against JWKS, handles rotation/revocation callback/tenant mapping, bounds claims, and yields verified `AgentIdentity`.
- `createOpaPolicyEvaluator` (optional) maps Prism identity/action/resource/context to OPA `POST /v1/data/<path>`, validates bounded decisions, preserves policy id/version/reason/evidence, applies timeout/failure policy, and records through existing durable policy ledger (`packages/enterprise-postgres/src/policy.ts` / `@arnilo/prism-policy` append flow).
- `@arnilo/prism-mcp` client bridge supports protected-resource metadata (RFC 9728), `WWW-Authenticate` challenges, authorization-server discovery (RFC 8414), PKCE, host-chosen client registration strategy (static / RFC 7591 DCR), scope challenges, refresh/revocation, audience binding (RFC 8707), and persisted bounded discovery state; server side can advertise protected-resource metadata. Tokens issued for another resource are never sent; SSRF/origin/redirect policy covers all discovery endpoints.
- `createOpenApiTools` (optional) exposes only host-listed operationIds with normalized JSON Schema, exact server origin, bounded body/pagination/retry, credential callbacks, approval/effect/idempotency metadata, and no arbitrary-request escape hatch.
- Artifact blob contract + one reference S3-compatible adapter stores/reads/deletes bodies by opaque reference with ownership, hash/size/MIME verification, optional encryption/KMS callback, signed-delivery integration with `ArtifactService`, retention/legal-hold interplay, and no local-path disclosure.
- Adapters compose with current credentials, identity, policy, event, approval, idempotency, redaction, retention, and audit contracts.
- JWKS/discovery/policy/schema caches bounded with expiry; all network requests/bodies/pages/retries finite; p95 targets published in `docs/performance.md`.
- Fake-server conformance suites (fake OIDC provider, fake OPA, fake authorization server, hostile OpenAPI origin, fake object store), `scripts/phase11-conformance.test.mjs`, package budgets, audit/SBOM/license, and full `release:gate` pass for **0.0.28**.

## Tasks

- [x] Task 0 — Primitive/package review, seam freeze, limits, dependency review, and public API freeze
  - Acceptance Criteria:
    - Functional: inventory maps existing primitives to every Phase 11 acceptance criterion: `IdentityVerifier`/`assertIdentityActive`/`narrowIdentity`/limits (`src/identity.ts`), `createPolicyEvaluator`/`evaluateAndAppend`/stores (`packages/policy`), durable policy ledger (`packages/enterprise-postgres/src/policy.ts`), `OAuthProvider`/`createOAuth2Provider`/PKCE helpers/`createOAuthCredentialStoreAdapter` (`packages/credentials-node`), MCP bridge/server/limits (`packages/mcp`), `ArtifactService`/`ArtifactRecord`/`ArtifactDeliveryToken`/retention+legal hold (`packages/server/src/artifacts.ts`, `src/persistence-lifecycle.ts`), `SsrfPolicy` (host security), `SecretRedactor`, credential resolver chain.
    - Functional: freeze records placement per adapter: identity verifier → `@arnilo/prism-credentials-node/oidc` subpath (Node-only, reuses limits/errors); policy adapter → `@arnilo/prism-policy/opa` subpath; MCP OAuth → extend `packages/mcp` (bridge option + server metadata + credential persistence via credentials-node adapter); OpenAPI → new minimal package `@arnilo/prism-openapi-tools` (work-tools is vendor-connector scope; confirm at freeze); artifact blob contract → core types beside `src/artifacts.ts`, reference adapter → `@arnilo/prism-server` subpath. Any deviation recorded in freeze with rationale.
    - Functional: freeze records object-store selection: one S3-compatible reference adapter; signing choice between `@aws-sdk/client-s3` and hand-rolled SigV4 over native `fetch`+WebCrypto decided by install-size budget (`scripts/budget-gate`); default hand-rolled SigV4 unless presign edge cases (chunked upload, accelerate endpoints) force the SDK.
    - Functional: freeze records default/hard caps for: JWKS keys/entry bytes/cache entries/TTL, claims count/bytes, discovery document bytes and cache TTL, policy request/response bytes and timeout, OpenAPI document bytes/operation count/schema depth/ref count/pagination page count/body bytes/retry count, artifact body bytes (per MIME class) and concurrent transfers, redirect hop count (0 for discovery/token endpoints).
    - Performance: freeze publishes p95 ceilings for verify (cache-hit vs miss), policy decision round trip, MCP auth handshake (fake server), OpenAPI tool call, artifact put/get presign; no regression in existing benchmark medians beyond tolerance.
    - Code Quality: adapter-over-primitives confirmed; core gains only contracts proven missing (expected: `ArtifactBodyStore` contract); no new dependency without budget+license+SBOM entry.
    - Security: freeze requires fail-closed defaults everywhere, credential exclusion from prompts/telemetry/persisted discovery/errors, and threat fixture list per adapter.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11; `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/agent-identity.md`, `docs/policy-and-audit.md`, `docs/mcp-tools.md`, `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/work-artifacts-and-review.md`, `docs/host-security.md`, `docs/enterprise-postgres-state.md`, `docs/performance.md`.
      - Plans 006 (enterprise state), 007 (tool effects/idempotency), 008 (approval), 010 (package-budget precedent).
    - Options Considered:
      - Everything in core subpaths: core must stay storage/network-free where possible; reject.
      - One mega enterprise package: couples unrelated seams; reject.
      - Per-seam placement above: matches existing package boundaries; chosen.
    - Chosen Approach:
      - One freeze record: this plan's Task 0 completion + `scripts/phase11-freeze-manifest.json` consumed by Tasks 1–6.
    - API Notes and Examples:
      ```jsonc
      // scripts/phase11-freeze-manifest.json (illustrative; exact values frozen in Task 0)
      { "jwks": { "maxKeys": 32, "cacheTtlMs": 600000 },
        "policy": { "timeoutMs": 2000, "maxResponseBytes": 65536 },
        "mcpOauth": { "maxRedirects": 0, "discoveryTtlMs": 600000 },
        "openapi": { "maxOperations": 256, "maxBodyBytes": 1048576 },
        "artifacts": { "maxBodyBytes": 104857600 } }
      ```
    - Files to Create/Edit:
      - `scripts/phase11-freeze-manifest.json` (new; machine-checkable source of truth per above), `scripts/phase11-freeze.test.mjs` (new; 8 schema-gate tests, wired into `npm test`), `package.json` test script (added `scripts/phase11-freeze.test.mjs`). `scripts/budgets.json` phase11 section deferred to Task 6 (needs built packages to measure).
    - References:
      - Plan 010 Task 0 freeze pattern; `docs/review-coverage-2026-07-26-phase-11.md` budget baseline (43 manifests, per-package packed bytes).
  - Test Cases to Write:
    - Manifest schema validation test (done: `scripts/phase11-freeze.test.mjs` — release pin, placement package existence + single new package, export/error-code surface, cap default/hard ordering incl. enum + zero-default caps, p95 positivity, security invariant + fixture coverage); budget gate entries for the new package land in Task 6 with measured packed bytes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal freeze only).
    - Docs pages to create/edit: none (per-task docs follow).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 0 freeze record (completed 2026-08-07)

  Frozen in `scripts/phase11-freeze-manifest.json` (validated by `scripts/phase11-freeze.test.mjs`, wired into `npm test`):

  - **Placement**: OIDC → `@arnilo/prism-credentials-node/oidc` (`createOidcIdentityVerifier`); OPA → `@arnilo/prism-policy/opa` (`createOpaPolicyEvaluator`, records via existing `evaluateAndAppend` durable ledger); MCP OAuth → extends `@arnilo/prism-mcp` only (reuses `@modelcontextprotocol/sdk@1.30.0` `client/auth.js` + `server/auth` `OAuthServerProvider`); OpenAPI → new zero-dependency package `@arnilo/prism-openapi-tools` (work-tools/web-tools confirmed vendor-connector scoped; package count 47 → 48); artifact blob contract → core `src/artifacts.ts` + `@arnilo/prism-server/artifact-bodies` subpath (`createS3ArtifactBodyStore`).
  - **Object store**: one S3-compatible reference adapter (AWS/MinIO/R2); hand-rolled SigV4 presigning over native `fetch` + WebCrypto with single-chunk PUT/GET (`Content-Length` + `x-amz-content-sha256` = verified hash; no chunked transfer, no accelerate); `@aws-sdk/client-s3` rejected at freeze; host encryption/KMS callback mirrors credentials-node `HostKms` envelope pattern; legal hold wins over retention on body delete.
  - **Dependency review**: zero new runtime dependencies across all five adapters (native `fetch` + WebCrypto for JWKS verify, SigV4, OPA/OpenAPI/object-store HTTP; MCP SDK already pinned 1.30.0). No budget-gate entries needed until Task 6 measures the new package.
  - **Caps (default/hard)**: oidc — jwks keys 32/128, jwk bytes 8/64 KiB, jwks TTL 10 min/1 h, fetch timeout 5/30 s, refetch-on-unknown-kid 1/1, token 16/256 KiB, claims 64/256 and 4/16 KiB, skew 30/300 s, algorithms RS256+ES256 (host may only narrow); policy — timeout 2/30 s, input 16/256 KiB, response 64/1 MiB, retries 0/2; mcpOauth — redirects 0/0, discovery 64/256 KiB, cache 16/64 entries, TTL 10 min/1 h, token record 16/64 KiB, state 4/16 KiB, handshake 60/300 s; openapi — doc 2/16 MiB, operations 256/1024, schema depth 32/128, refs 1024/8192, body/response 1/16 MiB, pages 20/100, pagination items 1k/10k, retries 0/3; artifacts — body 64/512 MiB, concurrent transfers 4/16, ref 256/1 KiB, presign TTL 10 min/24 h. Existing identity/policy/MCP/artifact limits reused (no duplicate knobs).
  - **p95 targets** (fake-server network-free ceilings, evidence recorded in Task 6): oidc verify hit/miss 5/100 ms, policy decision 100 ms, MCP discovery 250 ms, auth handshake 2000 ms, OpenAPI call 1000 ms, artifact put(1 MiB) 2000 ms, presign 100 ms; existing `benchmarkMedians` tolerance 0.25 unchanged.
  - **Security invariants**: fail-closed matrix per adapter frozen in manifest (oidc issuer/audience/alg/key; policy timeout/malformed/stale; MCP audience binding + zero redirects + SSRF; OpenAPI origin pin + no passthrough; artifact ownership/hash/hold). Credentials never in prompts, telemetry, persisted discovery, or errors.
  - **Test fixtures**: per-adapter case lists frozen in manifest (oidc/policy/mcpOauth/openapi/artifact suites, incl. cache poisoning, confused deputy, hostile docs, presign tamper).

- [x] Task 1 — OIDC/JWKS identity verifier adapter (`createOidcIdentityVerifier`)
  - Acceptance Criteria:
    - Functional: verifies pinned issuer (`iss` exact match), audience (contains configured value), signature against JWKS (allowlisted algorithms, default RS256/ES256 only), `exp`/`nbf` with configurable clock skew bound, `kid` selection, key rotation (refetch on unknown kid once, bounded), revocation callback (host `isRevoked(claims)` consulted, fail closed on callback error), tenant mapping (`mapClaims` → `AgentIdentity` with required `tenantId`), principal/scopes projection, bounded claims (count/bytes per freeze).
    - Functional: returns `IdentityVerifier` compatible with `RunOptions.identity` / server / MCP / A2A authorize seams; failures throw `IdentityError` variants without leaking token material.
    - Performance: JWKS cache bounded entries/TTL; cache-hit verify p95 per freeze; cache miss refetch serialized (no stampede), network timeout bounded.
    - Code Quality: native `fetch` + WebCrypto (`crypto.subtle.importKey({ format: "jwk" })`) only; no `jose`/`jsonwebtoken` dependency unless Task 0 freeze proves native insufficient; unit-testable with in-memory fetch stub.
    - Security: fail closed on unknown issuer/audience/algorithm/key, JWKS fetch failure after cache, oversized claims, `alg: none`, key confusion; tokens/claims never logged, redacted errors only; SSRF policy applied to JWKS URL (host pins it).
  - Approach:
    - Documentation Reviewed:
      - OpenID Connect Discovery 1.0 (`/.well-known/openid-configuration`, `jwks_uri`); RFC 7519 (JWT), RFC 7517 (JWK), RFC 7518 (JWA); RFC 9700 (OAuth 2.0 Security BCP).
      - `docs/agent-identity.md` (frozen caps: scopes 64/256, scope bytes 128/512, metadata 4/16 KiB).
    - Options Considered:
      - `jose` dependency: mature but adds ~50 kB+ and license/SBOM surface; native WebCrypto covers RS256/ES256 verify; reject unless freeze reverses.
      - Full OIDC discovery at runtime: host pins issuer + jwks_uri or discovery doc fetched once with SSRF checks; discovery optional, pinned-URL default.
    - Chosen Approach:
      - `createOidcIdentityVerifier({ issuer, audience, jwksUrl, mapClaims, algorithms?, clockSkewMs?, isRevoked?, limits?, fetch? })` returning core `IdentityVerifier`; exported from `@arnilo/prism-credentials-node/oidc`.
    - API Notes and Examples:
      ```ts
      import { createOidcIdentityVerifier } from "@arnilo/prism-credentials-node/oidc";
      const verify = createOidcIdentityVerifier({
        issuer: "https://id.example.com/tenant",
        audience: "prism-api",
        jwksUrl: "https://id.example.com/tenant/.well-known/jwks.json",
        mapClaims: (c) => ({ tenantId: c.tid, principal: { id: c.sub, kind: "user" }, scopes: c.scp }),
      });
      const identity = await verify({ token }); // -> AgentIdentity
      ```
    - Files to Create/Edit:
      - `packages/credentials-node/src/oidc.ts` (new; exports exactly the frozen set: `createOidcIdentityVerifier`, `OidcIdentityVerifierOptions`, `OidcIdentityVerifierResult`, `OidcAlgorithm`, `OidcClaims`), `packages/credentials-node/package.json` (new `./oidc` subpath in exports map; main entry untouched), `packages/credentials-node/src/__tests__/oidc.test.ts` (new; 28 tests), `packages/credentials-node/CHANGELOG.md` (0.0.28 entry), docs: `docs/agent-identity.md` (OIDC adapter section), `docs/credential-storage.md` (subpath), `docs/host-security.md` (checklist row), `docs/index.md` (Identity + Credential storage entries).
    - References:
      - `src/identity.ts` contracts; `packages/credentials-node/src/oauth2.ts` PKCE/fetch patterns.
  - Test Cases to Write:
    - All frozen fixture cases covered by `packages/credentials-node/src/__tests__/oidc.test.ts` (28 tests, passing; 73 total package tests green): valid RS256/ES256, `{ token }` input, expired/future-nbf/skew, missing exp, wrong issuer/audience (incl. array), alg:none/HS256/narrowed/widened, unknown-kid refetch-once, missing kid, JWKS outage cold+warm cache, cache poisoning, key count/bytes bounds, token/claim count/bytes bounds, revocation true/false/throw, missing tenantId, identity scope limits, algorithm/key mismatch, same-kid key confusion, tampered signature, malformed inputs, SSRF private-host denial (zero fetches), redirect never followed, cache hit + single-flight.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new package subpath and identity verification behavior.
    - Docs pages to create/edit: `docs/agent-identity.md` (add verifier section), `docs/credential-storage.md` (subpath entry), `docs/host-security.md` (checklist row).
    - `docs/index.md` update: yes; extend Identity/governance and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 1 completion record (2026-08-08)

  Implemented and green. Details beyond the manifest:

  - **Refetch semantics**: unknown `kid` triggers exactly one bounded refetch per `verify` call (per-call flag, not cache-state dependent); after refetch the missing key fails closed (`ERR_PRISM_OIDC_JWKS_KEY_MISSING`).
  - **Stale-cache refresh**: on refresh failure a transport error (`JWKS_FETCH`) keeps serving the last valid keys (rotation-friendly); a parse/bounds failure (`JWKS_PARSE`) fails closed (poisoning signal). Cache is single-entry per verifier (one pinned URL) with single-flight fetches; redirects never followed (`redirect: "manual"` + non-2xx rejection).
  - **Algorithm/key mismatch**: JWKS key with mismatched `alg`/kty for the token algorithm is treated as missing (RSA JWKS + ES256 token → `JWKS_KEY_MISSING`); genuine key confusion (same `kid`, different key material) fails at signature verify (`SIGNATURE`).
  - **Input shapes**: `verify` accepts `string` or `{ token: string }`; anything else fails closed (`SIGNATURE`).
  - **SSRF**: `assertSsrfAllowedUrl` runs before any fetch; denials surface the core `MediaContentError` (`ssrf_denied`) — documented in the module header and `docs/agent-identity.md`.
  - **Bounds**: all 12 frozen `ERR_PRISM_OIDC_*` reasons used, exactly matching `scripts/phase11-freeze-manifest.json`; caps enforced: jwks keys 32/128, jwk bytes 8/64 KiB, TTL 10 min/1 h, fetch timeout 5/30 s, refetch 1/1, token 16/256 KiB, claims 64/256 and 4/16 KiB, skew 30/300 s; core identity limits reused via `resolveIdentityLimits`.
  - No new dependency (`crypto.subtle` RSASSA-PKCS1-v1_5 + ECDSA P-256 with DER→P1363 conversion for JWS ES256).

- [x] Task 2 — OPA external policy adapter (`createOpaPolicyEvaluator`) with durable decision recording
  - Acceptance Criteria:
    - Functional: maps `PolicyEvaluateRequest` (verified identity, action, resource, bounded context) to OPA `POST /v1/data/<host-path>` body `{"input": {...}}`; maps response to bounded decision (allow/deny/modify/approval) preserving policy id/version, reason, evidence refs; `requirePolicyVersion` semantics retained.
    - Functional: timeout/failure policy host-chosen (`deny` default, `escalate` optional); malformed/oversized/stale-version responses fail closed; decisions recorded through `evaluateAndAppend` so durable Phase 6 stores (`packages/enterprise-postgres/src/policy.ts`) capture them unchanged.
    - Performance: request/response bytes and timeout per freeze; no unbounded retry (host retry policy or single bounded retry); p95 round trip published.
    - Code Quality: thin native-fetch adapter in `@arnilo/prism-policy/opa`; no OPA SDK dependency; input builder pure/testable; redaction applied before append via existing `SecretRedactor` seam.
    - Security: policy endpoint URL host-pinned (SSRF-checked); decision payloads never carry raw prompts/tool args/JWTs; credential values never in `input`; fail closed on network/parse/timeout.
  - Approach:
    - Documentation Reviewed:
      - OPA REST API: `POST /v1/data/<path>` with `{"input": <document>}` (OPA docs "Integrating with the REST API", verified via search); decision documents and provenance params.
      - `docs/policy-and-audit.md` (frozen caps: decision 8/64 KiB, reason/evidence ref 1/8 KiB).
    - Options Considered:
      - Cedar adapter too: breadth without demand; reject (non-goal).
      - OPA WASM in-process: policy authorship/host topology changes; reject.
      - OPA REST over native fetch: chosen.
    - Chosen Approach:
      - `createOpaPolicyEvaluator({ url, policyId, policyVersion, mapInput?, mapDecision?, timeoutMs?, onFailure? })` returning core evaluator consumed by `evaluateAndAppend`.
    - API Notes and Examples:
      ```ts
      import { createOpaPolicyEvaluator } from "@arnilo/prism-policy/opa";
      const evaluator = createOpaPolicyEvaluator({
        url: "https://opa.internal:8181/v1/data/prism/allow",
        policyId: "opa-prism", policyVersion: "2026-08-01",
      });
      await evaluateAndAppend({ evaluator, store, redactor, request });
      ```
    - Files to Create/Edit:
      - `packages/policy/src/opa.ts` (new; exports exactly the frozen set: `createOpaPolicyEvaluator`, `OpaPolicyEvaluatorOptions`, `OpaDecisionDocument`), `packages/policy/src/index.ts` (re-export), `packages/policy/package.json` (new `./opa` subpath; test script widened to `dist/__tests__/*.test.js`), `packages/policy/src/__tests__/opa.test.ts` (new; 18 tests), `packages/policy/CHANGELOG.md` (0.0.28 entry), docs: `docs/policy-and-audit.md` (OPA adapter section), `docs/enterprise-postgres-state.md` (cross-link), `docs/index.md` (Policy and audit entry).
    - References:
      - `packages/policy/src/evaluator.ts`, `record.ts`; `packages/enterprise-postgres/src/policy.ts`.
  - Test Cases to Write:
    - All frozen fixture cases covered by `packages/policy/src/__tests__/opa.test.ts` (18 tests, passing; 23 total package tests green): boolean/`{allow}`/`{outcome}` → allow/deny/modify/approval mappings; input shape (redacted actor refs, no prompt/JWT/credential/context keys, content-type, exact pinned URL); custom input with unrestricted payload keys rejected; input oversize; malformed JSON; missing `result`; oversized response (capped read); timeout (bounded, no retry) deny + escalate; transport error deny + escalate; retry policy (500×2 then success = 3 calls; 404 never retried); provenance query only when pinned; revision match/stale/missing; unmappable decision; redaction of reason/evidence refs; durable ledger row via `evaluateAndAppend` (ownership-scoped, deny rows recorded too, `requirePolicyVersion` pin retained); caller abort propagates; SSRF denial (zero calls, both onFailure modes); action/resource validation before any call; out-of-bounds caps rejected at construction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new policy package subpath.
    - Docs pages to create/edit: `docs/policy-and-audit.md` (OPA adapter section), `docs/enterprise-postgres-state.md` (cross-link).
    - `docs/index.md` update: yes; Identity/governance entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 2 completion record (2026-08-08)

  Implemented and green. Details beyond the manifest:

  - **Request/response**: `POST /v1/data/<path>` with `{"input": <doc>}`; `redirect: "manual"` (never followed); response body read through a capped stream reader (no unbounded buffering) → `ERR_PRISM_OPA_RESPONSE_BOUNDS`; missing/non-object `result` → `RESPONSE_PARSE`.
  - **Retry policy**: bounded loop (default 0, hard 2); retries only `TIMEOUT`, `TRANSPORT`, and HTTP ≥ 500 (transport errors carry `status`); 4xx/parse/bounds/version/mapping never retried.
  - **Failure policy**: `onFailure: "deny"` (default) converts OPA failures to a deny result with a short fixed reason — recorded as a ledger row by `evaluateAndAppend`, so fail-closed denials are auditable; `"escalate"` rethrows the `PolicyError` with the frozen code. Caller aborts always propagate (never converted to a policy outcome); SSRF denials surface `MediaContentError` (`ssrf_denied`) in both modes.
  - **Input hygiene**: default `mapInput` sends only redacted actor refs + action + resource (no `context`, no secrets); custom inputs pass through the existing `assertNoUnrestrictedPayload` guard (top-level `prompt`/`payload`/`token`/`jwt`/`credential`/… keys → `ERR_PRISM_POLICY_PAYLOAD`); input JSON bytes bounded by `maxInputBytes`; not-JSON-serializable inputs rejected before any network call.
  - **Version pinning**: `requirePolicyVersion` appends `provenance=true` to the pinned URL and requires ≥ 1 OPA bundle with a matching `revision`; absent bundles, missing revision, or mismatch → `ERR_PRISM_OPA_VERSION_MISMATCH` (fail closed). Ledger-side `requirePolicyVersion` semantics unchanged (`ERR_PRISM_POLICY_VERSION` on mismatch).
  - **Redaction**: optional `SecretRedactor` applied to OPA-provided `reason` and `evidenceRefs` before the result leaves the adapter (OPA responses are untrusted input to the ledger).
  - **Caps**: `timeoutMs` 2/30 s, `maxInputBytes` 16/256 KiB, `maxResponseBytes` 64 KiB/1 MiB, `maxRetries` 0/2 — validated at construction (`ERR_PRISM_POLICY_LIMITS`); construction also requires an absolute URL (`ERR_PRISM_POLICY_VALIDATION`).
  - **Durable recording**: decisions (and fail-closed denials) flow through the existing `evaluateAndAppend` → `preparePolicyDecision` path unchanged; memory store covered in tests, PostgreSQL store unchanged (`createPostgresPolicyDecisionStore`, exercised by existing phase7/phase11 conformance suites). All 6 frozen `ERR_PRISM_OPA_*` codes used.
  - No new dependency; OPA endpoint host-pinned via `SsrfPolicy` + `assertSsrfAllowedUrl` (same pattern as Task 1).

- [x] Task 3 — MCP OAuth client/server integration (RFC 9728 discovery, PKCE, registration strategy, refresh, audience binding)
  - Acceptance Criteria:
    - Functional (client): on 401, parse `WWW-Authenticate` and protected-resource metadata (RFC 9728), discover authorization server (RFC 8414), host-chosen client registration (static credentials or RFC 7591 DCR callback), authorization code + mandatory PKCE (S256), scope challenges (`insufficient_scope` re-auth), token refresh and revocation, RFC 8707 `resource` parameter / audience validation, RFC 9207 issuer identification; discovery state persisted bounded via credentials-node store adapter.
    - Functional (client): tokens are bound to the resource they were issued for; sending a token to a different origin/audience is refused (confused-deputy denial).
    - Functional (server): `@arnilo/prism-mcp` server can advertise protected-resource metadata and return spec-compliant `WWW-Authenticate` on unauthenticated Streamable HTTP requests; token verification stays host-owned (`IdentityVerifier`/Task 1 optional).
    - Performance: discovery cache bounded entries/TTL; zero redirects followed on metadata/token endpoints; handshake p95 per freeze against fake authorization server.
    - Code Quality: reuse `@modelcontextprotocol/sdk` client/auth helpers (`auth`, `discoverOAuthProtectedResourceMetadata`, `discoverAuthorizationServerMetadata`, `startAuthorization`, `OAuthClientProvider`) where compatible with Prism bounds; Prism wraps them with SSRF/origin/redirect policy and credential persistence rather than reimplementing.
    - Security: SSRF/origin/redirect policy on every discovery endpoint; https-only (loopback http exception per spec only if host opts in); tokens never enter prompts/telemetry/persisted discovery/errors; refresh tokens stored via encrypted/keychain store only.
  - Approach:
    - Documentation Reviewed:
      - MCP Authorization spec 2025-11-25 revision (`modelcontextprotocol.org/specification/2025-11-25/basic/authorization`): protected-resource metadata MUST, `authorization_servers`, third-party AS rules (verified via search 2026-08-07).
      - RFC 9728, RFC 8414, RFC 7591, RFC 9207, RFC 8707, RFC 9700, draft-ietf-oauth-v2-1; MCP SDK 1.30.0 `dist/esm/client/auth.d.ts` (export surface inspected).
      - `docs/mcp-tools.md`, `docs/credential-storage.md`.
    - Options Considered:
      - Reimplement OAuth client from scratch: duplicates SDK-tested crypto/state handling; reject.
      - Use SDK `auth()` with Prism `OAuthClientProvider` + policy wrapper: chosen.
      - Auto-follow discovery redirects: SSRF surface; reject (0 redirects, exact origin).
    - Chosen Approach:
      - `packages/mcp` gains bridge option `auth: { strategy, clientId?, clientSecret?, register?, scopes?, onRedirectRequired? }`, server option `protectedResource` metadata; credential/discovery persistence through `createOAuthCredentialStoreAdapter` from credentials-node.
    - API Notes and Examples:
      ```ts
      const bridge = createMcpBridge({
        url: "https://mcp.example.com/api",
        auth: { clientId: "prism", scopes: ["tools:read"],
                register: { redirectUris: ["http://localhost:33418/callback"] } },
        credentials: createOAuthCredentialStoreAdapter(store),
      });
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/auth.ts`, edits to `bridge.ts`/`server.ts`/`limits.ts`/`types.ts`/`index.ts`, `src/__tests__/auth-*.test.ts`, fake authorization server fixture, docs/changelog.
    - References:
      - MCP SDK `client/auth.d.ts` exports; `packages/mcp/src/transport.ts` HTTP handler.
  - Test Cases to Write:
    - Metadata discovery (well-known + `WWW-Authenticate`); PKCE/state round trip; scope challenge re-auth; refresh; revocation; token audience mismatch denial; confused-deputy passthrough denial; SSRF (private-IP metadata URL) denial; redirect policy; exact-origin enforcement; discovery cache TTL/poisoning; DCR success/denial; server metadata endpoint shape.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; MCP bridge/server options expand; credential storage gains MCP token/discovery records.
    - Docs pages to create/edit: `docs/mcp-tools.md` (authorization section), `docs/credential-storage.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; MCP and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 3 completion record (2026-08-08)

  Implemented and green (packages/mcp: 60 tests pass; root tsc clean; biome clean; freeze manifest schema gate 8/8). Files: `src/auth.ts` (new), `src/transport.ts`, `src/server.ts`, `src/types.ts`, `src/index.ts`, `src/__tests__/auth.test.ts` (15 OAuth tests), `src/__tests__/server.test.ts`, `CHANGELOG.md`; freeze manifest `@arnilo/prism-mcp` `newExports` updated with the actual surface (`createMcpClientAuth`, `createMcpOAuthFetch`, `createMcpOAuthTransport`, `McpOAuthError`, `McpOAuthLimitsInput`, `McpClientAuth`, `McpClientAuthOptions`, `McpClientAuthState`, `McpOAuthRegistrationStrategy`, `McpProtectedResource`).

  - **Client**: `createMcpClientAuth` wraps the SDK's `auth()` with a `PrismOAuthClientProvider` — `discoveryState()` single-entry cache gated by `discoveryCacheTtlMs` (first read loads persisted host state as fresh); `saveDiscoveryState` enforces RFC 8414 issuer-origin equality (`ERR_PRISM_MCP_OAUTH_ORIGIN`); `validateResourceURL` exact-origin RFC 8707 (`ERR_PRISM_MCP_OAUTH_AUDIENCE`); default `redirectToAuthorization` throws `STATE` (host supplies `onRedirectRequired` for interactive flows); bounded `saveTokens`/`saveCodeVerifier`/`saveDiscovery`/`saveClientInformation` (`tokenRecordBytes`/`stateBytes`). `McpClientAuthState` is a required persistence seam (no in-memory default; docs show backing it with credentials-node stores); refresh tokens live only in memory or host encrypted/keychain stores. `revoke()` posts RFC 7009 to `metadata.revocation_endpoint` with SDK client auth, then clears local state.
  - **Fetch policy**: `createMcpOAuthFetch` dispatches per origin — allow-listed server origins keep `createSecureMcpFetch` (exact-origin, bearer attached); every other origin (AS metadata/token/revocation) goes through `oauthDiscoveryFetch`: `assertSsrfAllowedUrl` (raw `ssrf_denied` propagation), https-only with loopback http opt-in, zero redirects (3xx → `ERR_PRISM_MCP_OAUTH_DISCOVERY`), DNS-pinned `requestPinned`, byte-bounded `boundResponse(discoveryBytes)`, handshake bound via `AbortSignal.any([caller, timeout])`. Authorization/`proxy-authorization` headers are stripped from discovery GETs only — POST token/revocation requests keep client authentication (Basic/secret_post).
  - **Server**: `createPrismMcpWebHandler` gains `protectedResource` — `resource` now REQUIRED (RFC 9728; the SDK PRM schema rejects a missing `resource`, which would silently degrade to legacy fallback discovery and lose RFC 8707 binding); serves `GET /.well-known/oauth-protected-resource` (405 otherwise, before identity resolution); `unauthorized()` 401s carry `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`. Token verification stays host-owned via `resolveIdentity`.
  - **Pre-existing bug fixed**: the web handler reused one `WebStandardStreamableHTTPServerTransport` across requests, so a second request threw "Stateless transport cannot be reused". Stateless mode now requires a server factory and creates a fresh SDK transport + McpServer per request (closed on response body completion/cancellation); stateful mode keeps the shared transport and no longer reconnects the already-connected shared server ("Already connected" crash). Existing `server.test.ts` was updated (factory for the bounded-handler test).
  - **Test matrix (15)**: interactive PKCE full loop against a real Prism server + fake AS (401 → discovery → redirect → `finishAuth` → reconnect with refresh), static client secret Basic auth on refresh, DCR registers once + secret reuse + DCR denial, scope-challenge re-auth (`insufficient_scope` → invalid_grant → tokens cleared → interactive with challenged scope), bounded upscoping circuit breaker (exactly one refresh + one retry then `StreamableHTTPError 403`), discovery TTL cache, SSRF private-IP denial, discovery redirect denial (302 → `DISCOVERY`), issuer drift (`ORIGIN`), confused-deputy foreign-origin resource (`AUDIENCE`), token-record bounds (`TOKEN_STORE`), RFC 7009 revoke, server well-known/401/405 shape, invalid protected-resource config.
  - **SDK quirks learned**: `OAuthProtectedResourceMetadataSchema` requires `resource`; `discoverOAuthServerInfo` silently falls back to the server URL as AS when PRM discovery throws, losing the resource param (fixed by requiring `resource` server-side and by the fetch policy never sending tokens cross-origin); JSON-RPC ids may be `0` (fakes must check `"id" in message`, not truthiness); the SDK's `auth()` without a refresh token always starts a new authorization flow, so the fake AS issues `refresh_token`s in the interactive flow.

- [x] Task 4 — OpenAPI tools adapter (`createOpenApiTools`) for host-selected operations
  - Acceptance Criteria:
    - Functional: compiles only explicitly listed operationIds from an OpenAPI 3.1 document into Prism `ToolDefinition`s at host setup; normalized JSON Schema from request bodies/parameters (refs resolved, cycles rejected, sizes bounded); exact server origin pinned (server overrides/`servers` drift rejected); bounded body/pagination/retry; credential callback (host resolver, never inline secrets); per-operation approval/effect/idempotency metadata wired to existing approval + idempotency contracts.
    - Functional: no generic arbitrary-request escape hatch (no raw method/path passthrough).
    - Performance: compile-time document/operation/schema caps per freeze; runtime body/page/retry caps; p95 tool-call overhead published.
    - Code Quality: pure compile step (document + operation list → tool defs) separated from runtime executor; zero new dependencies (native fetch); hostile-document fixtures in tests.
    - Security: responses untrusted (redaction + bounds before entering context); origin drift, schema abuse (huge `$ref` graphs, `additionalProperties` bombs), credential leakage into tool output, and side-effect execution without approval all fail closed.
  - Approach:
    - Documentation Reviewed:
      - OpenAPI 3.1.0 spec (JSON Schema alignment, `operationId`, `servers`, security schemes); `docs/tools.md`, `docs/tool-effects.md`, `docs/work-connectors.md` (credential callback precedent).
    - Options Considered:
      - Runtime model-driven discovery: roadmap rejects (excessive authority/context).
      - Full OpenAPI client library (openapi-fetch etc.): unneeded; compile-to-ToolDefinition is ~1 module; reject.
    - Chosen Approach:
      - `createOpenApiTools({ document, operations, server, credentials?, policy?, limits? })` returning `ToolDefinition[]`; placement per Task 0 freeze (default new minimal package `@arnilo/prism-openapi-tools`).
    - API Notes and Examples:
      ```ts
      const tools = createOpenApiTools({
        document, operations: ["getCustomer", "createCase"],
        server: "https://api.example.com", credentials, policy,
      });
      ```
    - Files to Create/Edit:
      - New package (or work-tools subpath per freeze): `src/compile.ts`, `src/execute.ts`, `src/limits.ts`, tests, manifest, docs/changelog.
    - References:
      - `src/tools.ts` / `ToolDefinition` contract; tool-effect + idempotency stores (plans 007/008).
  - Test Cases to Write:
    - Operation allow-list enforcement; server override denial; `$ref`/cycle/size hostile docs; pagination/retry bounds; side-effect approval + idempotency key reuse; credential/redaction in output; hostile response bodies.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new public package/subpath and tool surface.
    - Docs pages to create/edit: new `docs/openapi-tools.md`; `docs/tools.md` cross-link; `docs/index.md`.
    - `docs/index.md` update: yes; Tools group entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 4 completion record (2026-08-08)

  Implemented and green (new package `@arnilo/prism-openapi-tools`: 18 tests pass; root tsc clean; biome clean; freeze manifest gate 8/8; workspace registered in package-lock; `npm pack --dry-run` 10.0 kB). Files: `src/compile.ts`, `src/execute.ts`, `src/limits.ts`, `src/types.ts`, `src/errors.ts`, `src/tools.ts`, `src/index.ts`, `src/__tests__/openapi-tools.test.ts` (18 tests), `package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`; docs `openapi-tools.md` (new), `tools.md` cross-link, `index.md` Tools entry; freeze manifest `@arnilo/prism-openapi-tools` `newExports` updated with the actual surface (11 names).

  - **Compile** (`compileOpenApiDocument`): document byte-bounded (`maxDocumentBytes`), OpenAPI 3.1 only, duplicate operationIds rejected; allow-list only (`ERR_PRISM_OPENAPI_OPERATION_UNKNOWN`), `maxOperations` bound; pinned `server` must be absolute https (loopback http allowed) with no credentials/fragment; every document/path/operation `servers` entry must resolve to the pinned origin (relative URLs resolve against it) else `ERR_PRISM_OPENAPI_SERVER_DRIFT`; internal `$ref`s resolved into self-contained schemas with `maxSchemaDepth`/`maxRefs` bounds, external/unresolvable refs fail closed (`ERR_PRISM_OPENAPI_SCHEMA_BOUNDS`); cookie parameters, `content`-style parameters, non-JSON request bodies, duplicate argument names, and undeclared path params rejected; path params are required args in the compiled schema; tool names sanitized from operationIds (collisions rejected); descriptions truncated to 16 KiB.
  - **Effects**: GET/HEAD/OPTIONS/TRACE → `{kind:"none", idempotency:"none"}`; POST/PUT/PATCH/DELETE → `{kind:"external_mutation", idempotency:"required"}` — the core run loop gates approval and deduplicates via the effect store (mutating tools require verified identity + effect store at dispatch; retries never re-execute a completed effect). Optional `idempotencyKeyHeader: true` forwards the core `Idempotency-Key` on mutating requests only.
  - **Execute**: policy check before the request (throw to deny); path params URL-encoded, query/header params from args, JSON body byte-bounded (`maxBodyBytes`); host `credentials` resolver merged into headers/query per call, never echoed; `redirect: "manual"` (3xx returned as a response, never followed); retries only on transport errors/5xx bounded by `maxRetries` (default 0, hard 3), transport exhaustion → `ERR_PRISM_OPENAPI_RETRY_EXHAUSTED`, 4xx never retried; caller aborts propagate without retry; response stream-read with `maxResponseBytes` bound → `ERR_PRISM_OPENAPI_RESPONSE_BOUNDS`; optional `redactor` applied to response text before parsing/result; results carry the untrusted-content marker + `metadata.trust: "untrusted_external"`.
  - **Pagination**: optional `pagination` config (`pageParam` required; `pageSizeParam`/`pageSize`/`nextPath`/`itemsPath` optional, next token probes `next` then `nextPageToken`, items default `items`) applies only to operations whose compiled query params include `pageParam`; bounded by `maxPages` (20/100) and `maxPaginationItems` (1000/10000), exceeded → `ERR_PRISM_OPENAPI_RESPONSE_BOUNDS`.
  - **Limits**: `resolveOpenApiLimits` validates defaults ≤ hard caps (all frozen pairs); `maxRetries` allows 0; invalid limits → `ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS` (no dedicated limits code in the frozen surface).
  - **Test matrix (18)**: allow-list + unknown id; document/path/operation server drift + relative server acceptance; `$ref` cycle, depth 40, 1100-ref chain, external ref, unresolvable ref; document bytes/JSON/version/operation-count/limits bounds; duplicate operationId; name sanitization + collision; cookie/non-JSON-body/duplicate-arg/undeclared-path-param rejection; URL/headers/body construction; credential non-leak via redactor; response bounds; 5xx retry/4xx no-retry/transport exhaustion; pagination happy path + maxPages + maxPaginationItems; policy denial; abort propagation; idempotency-key header opt-in; non-JSON text bodies.

- [x] Task 5 — Artifact blob contract + reference S3-compatible adapter with signed delivery integration
  - Acceptance Criteria:
    - Functional: core `ArtifactBodyStore` contract (`put`/`get`/`delete`/`presign` by opaque reference, ownership-scoped) beside `src/artifacts.ts`; reference S3-compatible adapter implements it with hash (SHA-256)/size/MIME verification, optional host encryption/KMS callback (client-side), retention/legal-hold interplay (delete refused under hold; retention sweep deletes bodies with metadata), and `ArtifactService` delivery links resolve through the blob store (signed URL or streamed delivery) without disclosing local paths or bucket internals.
    - Functional: partial-failure semantics (metadata persisted without body rolls back cleanly); object-store outage surfaces typed errors, never silent success.
    - Performance: body size caps per MIME class per freeze; bounded concurrent transfers; streaming (no full-body buffering beyond cap); presign p95 published.
    - Code Quality: contract in core types only; adapter optional and dependency-free (native fetch + WebCrypto SigV4) unless Task 0 budget chose `@aws-sdk/client-s3`; conformance suite reusable for host adapters.
    - Security: ownership/tenant verified on every read/delete; hash mismatch on upload fail closed; wrong-tenant reference denial; credentials only via host resolver; no bucket/path/key disclosure in errors/telemetry/artifact records.
  - Approach:
    - Documentation Reviewed:
      - AWS SigV4 signing + S3 presigned URL docs; `docs/work-artifacts-and-review.md`, `docs/host-security.md`; retention/legal-hold contract in `src/persistence-lifecycle.ts`.
    - Options Considered:
      - Multiple object stores now: reject (one reference adapter + contract).
      - `@aws-sdk/client-s3`: full-featured but ~MB install size; keep as fallback per freeze.
      - Hand-rolled SigV4 (native fetch/WebCrypto): chosen default if presign edge cases unneeded.
    - Chosen Approach:
      - `createS3ArtifactBodyStore({ endpoint, bucket, credentials, kms?, limits? })` implementing `ArtifactBodyStore`; `ArtifactService` option `bodies` wires delivery.
    - API Notes and Examples:
      ```ts
      const bodies = createS3ArtifactBodyStore({ endpoint, bucket, credentials });
      const artifacts = createArtifactService(store, { redactor, linkSecret, bodies });
      ```
    - Files to Create/Edit:
      - `src/artifacts.ts` (contract types), `packages/server/src/artifact-bodies.ts` + `src/artifact-bodies-s3.ts`, exports map, tests incl. fake object store, docs/changelog.
    - References:
      - `packages/server/src/artifacts.ts` limits/delivery; `src/persistence-lifecycle.ts` holds/retention.
  - Test Cases to Write:
    - Upload/download/delete round trips; hash/size/MIME mismatch; wrong tenant; legal hold blocks delete; retention sweep deletes body; signed link expiry; encryption callback; partial-failure rollback; object-store outage; presign tamper.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new core contract + server subpath; delivery behavior extends.
    - Docs pages to create/edit: `docs/work-artifacts-and-review.md` (blob storage section), `docs/host-security.md`.
    - `docs/index.md` update: yes; Artifacts/Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 5 completion record (2026-08-08)

  Implemented and green (packages/server suite 77/77 incl. 22 new artifact-bodies tests; root gate 1409/1409 + 52/52; root tsc clean; biome clean; freeze manifest gate 8/8). Files: `src/artifacts.ts` (core contract), `packages/server/src/artifact-bodies.ts` (S3 adapter), `packages/server/src/artifact-bodies-s3.ts` (SigV4 internals), `packages/server/src/__tests__/artifact-bodies.test.ts` (22 tests), `packages/server/src/__tests__/artifacts.test.ts` (5 new service tests), `packages/server/package.json` (`./artifact-bodies` subpath), `src/index.ts` + `src/__tests__/public-export-contract.test.ts` (frozen surface), docs `work-artifacts-and-review.md` / `host-security.md` / `index.md`, `packages/server/CHANGELOG.md` 0.0.28 entry, freeze manifest `@arnilo/prism` + `@arnilo/prism-server/artifact-bodies` `newExports` updated with the actual surface.

  - **Core contract** (`src/artifacts.ts`, types only, storage-free): `ArtifactBodyRef` (ownership-scoped opaque ref: artifactId/threadId/version/mime/size/hash), `ArtifactBodyStore` (`put`/`get`/`delete`/`presign` with `ArtifactBodyTransferOptions`/`ArtifactBodyPresignOptions`), `ArtifactBodyStoreError` + `ARTIFACT_BODY_ERROR_CODES` (frozen OWNERSHIP/HASH_MISMATCH/SIZE_MISMATCH/MIME_MISMATCH/HELD/STORE). `ArtifactRevision` gains optional `size` (validated non-negative safe integer on attach/revise; recorded in the checkpoint).
  - **Service integration** (`packages/server/src/artifacts.ts`): `createArtifactService` gains optional `bodies: ArtifactBodyStore`; `deliveryLink` then resolves through `bodies.presign` and returns an additional `url` (bounded-TTL presigned) beside the signed link/token; a revision without a recorded `size` fails closed (`invalid_input`); presign failures propagate typed (never silent success). Handler attach/revise read optional `size`.
  - **S3 adapter** (`createS3ArtifactBodyStore`): hand-rolled SigV4 over native fetch + WebCrypto (validated against the official AWS sig-v4-test-suite get-vanilla vector), path-style addressing, single-chunk PUT with exact Content-Length and `x-amz-content-sha256` = verified SHA-256 hex (no chunked transfer), region default `us-east-1`, host-resolved credentials (`ERR_PRISM_S3_CREDENTIALS` on failure), optional host KMS callback (client-side encrypt/decrypt; ref hash/size always refer to plaintext), optional `isHeld` callback (delete refuses `ERR_PRISM_ARTIFACT_BODY_HELD`), idempotent delete (204/404 both success), bounded concurrent transfers (semaphore), presign TTL bounded by `presignTtlMs`, object key derived from the ref (`prism-artifacts/{tenant}/{thread}/{artifact}/{version}`) so bucket/path/key never enter records or errors. Limits: `maxBodyBytes` 64 MiB/512 MiB, `maxConcurrentTransfers` 4/16, `presignTtlMs` 10 min/24 h, `maxRefBytes` 256 B/1 KiB.
  - **Verification semantics**: put verifies size + SHA-256 before any upload (mismatch → no request reaches the store); get verifies Content-Length + Content-Type fast-fail, buffers bounded by `maxBodyBytes`, then verifies size + SHA-256 before returning bytes (caller never receives unverified data; with kms, size is verified on the decrypted plaintext).
  - **Test matrix (22)**: SigV4 known-answer vector; put/get round trip through a signature-verifying fake S3 server (node:http, verifies every SigV4 signature + payload checksum); stream body; hash/size mismatch fail-closed before upload; body over cap; download size/MIME/tamper mismatch; idempotent delete; legal hold; presign URL shape + TTL bounds; credential failures; outage (500) typed errors; kms round trip (stored ciphertext, verified plaintext); concurrency bound; ownership required; malformed refs; endpoint/bucket validation; no bucket/key disclosure in errors; contract conformance.
  - **Service tests (5)**: deliveryLink resolves through wired bodies (ref fields + ttlMs asserted); no url without bodies; presign failure propagates typed; missing size fails closed; size validation on attach/revise.

- [x] Task 6 — Composition verification, phase11 conformance, budgets, docs index, and release gate 0.0.28
  - Acceptance Criteria:
    - Functional: end-to-end composition fixture: OIDC-verified identity → OPA policy decision (durable ledger) → MCP OAuth-authorized bridge tool → OpenAPI side-effect tool with approval/idempotency → artifact body stored + signed delivery, all with redaction and audit records; adapters individually absent leave baseline behavior unchanged.
    - Functional: `scripts/phase11-conformance.test.mjs` (network-free, fake OIDC provider / fake OPA / fake authorization server / hostile OpenAPI origin / fake object store) added to `npm test`.
    - Performance: benchmark medians within tolerance; p95 targets for new seams recorded in `docs/performance.md`; cache budgets exercised under limit-ladder tests.
    - Code Quality: `npm run sdk:ready` green (typecheck/lint/format/test/coverage/pack/release gate); new package/subpath budgets and tarball allow-lists updated; changelogs per package.
    - Security: threat fixtures pass (credentials absent from prompts/telemetry/persisted state/errors; fail-closed matrix per Task 0); audit/SBOM/license entries for any new dependency; protected live-integration slots documented as blocked-not-skipped when credentials unavailable.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` gates; plan 010 Task 8 conformance pattern (`scripts/phase10-conformance.test.mjs`); `docs/release-and-install.md`, `docs/migration.md`, `docs/performance.md`.
    - Options Considered:
      - Live third-party endpoints in CI: flaky/credential-bound; reject for gate, keep protected-canary slot.
    - Chosen Approach:
      - Fake-server conformance as gate; live credentials = blocked release gate, not passing skip (Phase 12 rule).
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node --test scripts/phase11-conformance.test.mjs
      npm run release:check -- --version 0.0.28
      ```
    - Files to Create/Edit:
      - `scripts/phase11-conformance.test.mjs`, `package.json` test script, budgets, `docs/index.md`, `docs/performance.md`, `docs/migration.md`, changelogs, version bump to `0.0.28`.
    - References:
      - Plans 006–010 release-task patterns; roadmap Phase 11 Exit Gate.
  - Test Cases to Write:
    - Composition journey above; adapter-absent baseline regression; limit-ladder at/above frozen caps; redaction sweep across new seams.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release touches many public surfaces.
    - Docs pages to create/edit: `docs/index.md` (all Phase 11 entries), `docs/performance.md`, `docs/migration.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes; Identity/governance, Security/auth/trust, MCP, Tools, Credentials, Artifacts, Persistence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Fake-server conformance and protected OIDC/policy/MCP/object-store integration suites pass; security threat fixtures, cache/resource budgets, audit/SBOM/license, package compatibility, and full release gate pass for **0.0.28**.

  #### Task 6 completion record (2026-08-08)

  - **Composition conformance**: new `scripts/phase11-conformance.test.mjs` (5 network-free cases, wired into `npm test`) — (1) composed journey: in-process RS256 JWT → `createOidcIdentityVerifier` → OPA allow decision via `createOpaPolicyEvaluator`/`evaluateAndAppend` into the durable ledger → interactive PKCE MCP OAuth against a fake authorization server with RFC 8707 `resource` asserted on authorize + token requests → OpenAPI `createCustomer` side-effect tool dispatched through `dispatchToolCall` with effect store (idempotency-key header + `UNTRUSTED EXTERNAL API CONTENT`) → artifact body stored in a fake S3-compatible object store with presigned delivery link (bucket internals never in records); (2) adapter-absent baseline (no `url` on delivery links without a body store, no `WWW-Authenticate` without `protectedResource`, empty ledger); (3) hostile inputs + limit ladder at frozen caps (claims bounds, oversize OPA response fails closed to deny, oversize OpenAPI document, oversize artifact body rejected before upload, server drift, unknown operation); (4) redaction sweep across ledger records, tool results, and errors.
  - **Root-cause fix found while stabilizing the suite**: `boundResponse` in `packages/mcp/src/server.ts` buffered response bodies to EOF — unbounded `text/event-stream` (SSE) responses stalled the handler forever, leaking the 60 s ref'd per-request timeout and hanging `node --test`. SSE now relays unbuffered (also fixes real stateful SSE delivery); the stateless transport-reuse bug fix from Task 3 (server factory per request) is what exposed it. Test harnesses decline the standalone GET SSE stream with 405 (spec-expected "no SSE stream").
  - **Budgets**: new `scripts/benchmark-0.0.28.mjs` measures the eight freeze p95 seams against in-process fakes + loopback fixtures; checked evidence `scripts/benchmark-0.0.28.json` (20 warmups, 100 ops): oidc hit/miss 0.178/0.366 ms (≤ 5/100), policy 0.063 ms (≤ 100), MCP discovery 2.196 ms (≤ 250), handshake 6.359 ms (≤ 2000), OpenAPI call 0.023 ms (≤ 1000), artifact put 1 MiB 11.81 ms (≤ 2000), presign 0.63 ms (≤ 100). `scripts/budgets.json` gains the `phase11` section; `scripts/budget-gate.test.mjs` validates the evidence against it (10/10).
  - **Docs**: `docs/performance.md` 0.0.28 section + table; `docs/migration.md` `0.0.27 → 0.0.28` (7 points, additive); `docs/release-and-install.md` current-release strings + `### 0.0.28 publish handoff`; `docs/index.md` MCP entry gains OAuth note (Identity/policy/artifacts/OpenAPI/credentials entries landed in Tasks 1–5); `docs/0.1.0-readiness.md` live-suite matrix gains the Phase 11 enterprise-adapter canary row recorded as a **blocked release gate, not a passing skip**.
  - **Release gate 0.0.28**: version bumped to exact `0.0.28` across root + 48 workspace manifests + lockfile + `src/index.ts` literal; per-package test peer/pin assertions bumped (root tests + 12 package skeleton tests); all changelogs finalized `## [0.0.28] - 2026-08-08` (44 stubs + 5 detailed + root aggregation); compat baselines refreshed via `release.mjs gate --update-baseline` (additive surfaces + the documented `createPrismMcpWebHandler` factory change; new `arnilo__prism-openapi-tools.txt`); `release:gate` and `release:check --version 0.0.28 --allow-dirty --allow-untagged` pass (49 graph entries, registry names available); `npm run sdk:ready` fully green.
  - **Verification**: full `npm test` green (core 1409/1409; scripts gates incl. phase11-conformance 5/5 and phase11-freeze 8/8; all workspaces incl. mcp 60/60, server 77/77, openapi-tools 18/18); conformance file stable across repeated runs after the SSE fix; `npm run sdk:ready` exit 0.
  - Stale-test fix: `packages/server` delivery-link unit test now asserts the bare sha-256 hex ref hash (service strips the conventional `sha256:` revision prefix when addressing bodies; S3 adapter rejects non-hex fail closed).

## Compromises Made

- **Fake-server gate, live endpoints deferred.** Phase 11 conformance runs against network-free fakes and loopback fixtures; real IdP/OPA/authorization-server/object-store evidence remains a protected-canary slot, recorded as a blocked release gate in `docs/0.1.0-readiness.md` (Phase 12 rule: blocked, not a passing skip).
- **OPA only (no Cedar)** and **one object-store adapter (S3-compatible)** per the freeze — the contracts (`PolicyEvaluator`, `ArtifactBodyStore`) keep both seams swappable without core changes.
- **Hand-rolled SigV4 single-chunk presign/put/get** instead of `@aws-sdk/client-s3`: ~1 MB of dependency and SBOM surface avoided; multipart uploads, accelerate, and non-path-style addressing are out of scope (upgrade path: swap the adapter, contract unchanged).
- **OpenAPI mutation idempotency is core-managed (`idempotency: required` via the run loop effect store)**, not a per-adapter store like work-tools; the optional `idempotencyKeyHeader` only forwards the core key when the host opts in.
- **Test harnesses decline the standalone GET SSE stream (405)** rather than relaying a long-lived stream; production servers relay SSE correctly (that path is the fixed `boundResponse`), but no automated test holds an SSE stream open — flaky long-lived-connection teardown was rejected for CI.
- **Discovery cache is single-entry with TTL cap** (per provider instance), matching the freeze; multi-tenant discovery caching is host-side.

## Further Actions

- **Record the protected live-canary matrix** (real OIDC IdP + JWKS rotation, real OPA bundle pinning, real MCP OAuth AS incl. DCR + refresh/revoke, real S3-compatible store incl. KMS path) in the protected environment; unblock the Phase 11 live gate (priority: high, owner: operator).
- **MCP SSE coverage**: add a deterministic stateful SSE relay test (server-push through `createPrismMcpWebHandler`) now that SSE responses are relayed unbuffered (priority: medium).
- **Phase 12 candidates from the roadmap**: Cedar policy adapter beside OPA, second artifact body adapter only if a host demands it, OpenAPI pagination patterns beyond cursor (offset/Link headers) if hosts need them (priority: low until demand).
- **Revisit `docs/release-and-install.md` manifest-count narrative** (48 publishable vs 49 graph entries incl. root) when the next package joins the graph (priority: low).
