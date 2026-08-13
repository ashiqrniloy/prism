# Phase 21 (0.2.1) primitive review — provider completion and outbound trust boundaries

Evidence file for plan 021 Task 0 (`plans/021-Release-0-2-1-Provider-Completion-and-Outbound-Trust-Boundaries.md`).
Reviewed 2026-08-13 at HEAD `cb9369d` (Release 0.2.0 baseline). Scope: the five roadmap 0.2.1
items — strict stream completion, bounded success bodies, outbound DNS/address pinning, OAuth
consolidation, and four credential/signing/upload/cache edge fixes. Method: reuse-first inventory
of what already exists, then a written gap analysis per item; a new primitive is proposed only
where a real gap exists, and each new primitive ships with its concrete first consumers in the
same phase (no single-consumer extraction). This document is intentionally tarball-excluded
(`package.json` files excludes `docs/_evidence`) like its phase 18/19/20 predecessors; nothing
here changes public behavior.

Six decisions are approved by this review:

1. **Strict completion becomes the shared default** in the OpenAI-compatible base (`openAIChatEvents`
   and `createOpenAICompatibleProvider`). No new primitive — one default flip covers Azure, Bedrock,
   Vertex, OpenRouter, ZAI, and NeuralWatt (the six adapters that currently inherit the permissive
   default) while alibaba/kimi/ollama/opencode-go keep identical behavior (they already opt in).
   The existing `strictCompletion: false` option remains the documented opt-out.
2. **One additive bounded JSON reader** `readBoundedResponseJson` in `src/providers/transport.ts`,
   composed on the existing `readBoundedResponseText` byte ceiling. Consumers: the ten model-discovery
   implementations plus NeuralWatt quota, Alibaba embeddings, and OpenAI uploads (≥13 call sites).
3. **One shared pinned-fetch primitive** lifted from MCP's strongest transport pin
   (`resolvePinnedAddress` + `requestPinned`) into a new core module `src/pinned-fetch.ts`.
   Consumers: OIDC JWKS, OPA decision, content fetch, and MCP itself (behavior-preserving).
   `packages/coding-security/src/egress/dns-pin.ts` is **not converged** in 0.2.1 (decision 12).
4. **One shared bounded OAuth device/token poll + error-mapping helper** `pollDeviceCodeToken` in a
   new core module `src/oauth-device-code.ts`. Consumers: `packages/provider-openai/src/oauth.ts`
   and `packages/credentials-node/src/oauth2.ts` (both already import from core; neither depends on
   the other, and no provider package depends on `credentials-node` — verified).
5. **Azure/Vertex resolve the credential once per request** (single-site fixes, no new primitive);
   **Bedrock canonicalizes duplicate-case headers (last-wins) and sorts repeated query keys by key
   then value**; **OpenAI uploads retain failed-DELETE IDs for retry cleanup**; **cache telemetry
   overflow drops cost attribution** (tokens/requests only) instead of bleeding one model's cost
   into mixed-model tokens.
6. **Redirects are rejected, never followed and never revalidated-and-followed**, for JWKS/OPA/content
   pinned fetches (fail-closed "disabled" branch of the roadmap requirement; MCP already rejects 3xx).

---

## 1. Strict completion for every streaming provider (plan Task 2)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `strictCompletion?: boolean` option | `src/providers/openai-compatible.ts:45,59` | Public option on `OpenAIChatEventsOptions` and `OpenAICompatibleProviderOptions`. Currently `undefined` ⇒ permissive (EOF without done marker/finish reason still yields `providerDone`). |
| Strict-completion enforcement | `openai-compatible.ts:136` | `if (options.strictCompletion && (!sawDoneMarker || !sawFinishReason))` → `ProviderTransportError("incomplete_delta")`. Correct root-cause gate; simply never fires for the six adapters that do not pass `strictCompletion: true`. |
| `doneUsage?: boolean`, `mapUsage?` | `openai-compatible.ts:39,47,61,100,150` | Final usage handling: `providerDone(options.strictCompletion || options.doneUsage ? usage : undefined)`. Unchanged by the flip. |
| Existing opt-ins (become no-ops) | `packages/provider-{alibaba,kimi,ollama}/src/provider.ts`, `packages/provider-opencode-go/src/openai-chat.ts` | Four adapters already pass `strictCompletion: true`; the flip makes their explicit value redundant but behavior-identical. |
| Adapters relying on the permissive default | `packages/provider-{azure,bedrock,vertex,openrouter,zai,neuralwatt}/src/provider.ts` | All six call `createOpenAICompatibleProvider`/`openAIChatEvents` from `@arnilo/prism/providers/openai-compatible` without `strictCompletion` (verified by grep). |
| Native streaming adapters | `packages/provider-anthropic/src/messages.ts`, `packages/provider-google/src/generate-content.ts` | Not OpenAI-compatible; they already map provider-native completion (their streams end with `message_stop` / `content` rollups). Out of scope for this item; completion semantics unchanged. |
| Error family | `src/providers/transport.ts:22-31` | `ProviderTransportError` with codes `sse_buffer_overflow`, `sse_event_overflow`, `response_body_overflow`, `aborted`, `invalid_json_arguments`, `incomplete_delta`. The truncation path already uses `incomplete_delta`. |

### Confirmed defect walkthrough

Manual proof at 0.2.0: an OpenAI-compatible stream whose body ends after partial deltas with no
`[DONE]` and no `finish_reason` yields a successful `providerDone` for Azure, Bedrock, Vertex,
OpenRouter, ZAI, and NeuralWatt — all six stream through the shared base but never pass
`strictCompletion`. The same truncated body fails with `incomplete_delta` on alibaba/kimi/ollama/
opencode-go. The enforcement logic already exists and is correct; the defect is the default.

### Gap analysis

**Already achievable today:** per-adapter opt-in exists and works; the `incomplete_delta` error
path is implemented; terminal variants (`mapUsage`, `doneUsage`, `onComment`-style mapping) are
handled before the strict check.

**The gap:** the default is permissive, so any current or future OpenAI-compatible adapter that
omits the flag silently accepts truncated output as success. Six first-party adapters do exactly
that. Per-adapter opt-in proliferation leaves sibling adapters exposed and is more code, not less.

### Approved decision

Flip `strictCompletion` to default `true` in both `openAIChatEvents` options and
`createOpenAICompatibleProvider` option pass-through (`openai-compatible.ts:211`). The existing
`strictCompletion: false` remains honored and becomes the documented downgrade for hosts that
legitimately consume partial output; no new opt-out seam is added. The four existing opt-ins are
left in place (or dropped for clarity — behavior identical either way; Task 2 decides the diff
shape). Anthropic/Google native streaming is untouched.

---

## 2. One dependency-free bounded success-body reader (plan Task 3)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `readBoundedResponseText(response, { secrets, maxResponseBodyBytes })` | `src/providers/transport.ts:66` (impl. ~line 205+) | Hard byte ceiling (`DEFAULT_MAX_RESPONSE_BODY_BYTES` 65,536), secret redaction, kills over-limit streams before full buffering, `response_body_overflow` error. Already used on OpenAI upload/oauth error paths. |
| `readSseEvents` / `readSseData` | `transport.ts:62` | Incremental bounded SSE parser (`DEFAULT_MAX_EVENT_BYTES` 262,144 / `DEFAULT_MAX_BUFFER_BYTES` 524,288) with `sse_event_overflow` / `sse_buffer_overflow`. Streaming side already bounded. |
| `tryParseJsonObjectArguments` / `parseJsonObjectArguments` | `transport.ts:272,301` | Bounded JSON argument parse (`DEFAULT_MAX_ARGUMENT_BYTES` 262,144, depth/property checks, `__proto__`/`prototype`/`constructor` and non-finite rejection). The in-repo precedent for bounded JSON walking; tool-arguments-specific. |
| `httpStatusError` / `parseRetryAfterMs` | `transport.ts:45,54` | HTTP failure mapping with numeric status and `Retry-After`; unchanged. |
| 10 unbounded model-discovery sites | `packages/provider-{alibaba(106),anthropic(97),google(92),kimi(83),neuralwatt(91),ollama(102),openai(80),opencode-go(119),openrouter(83),zai(93)}/src/models.ts` | All `const payload = (await response.json()) as XModelsResponse;` — unbounded full-buffer reads. |
| Unbounded quota/embeddings/uploads sites | `packages/provider-neuralwatt/src/quota.ts:86`, `packages/provider-alibaba/src/embeddings.ts:88`, `packages/provider-openai/src/uploads.ts:79` | Same unbounded `response.json()` pattern. |
| Per-adapter post-parse validation | each `models.ts`, `quota.ts`, `embeddings.ts`, `uploads.ts` | Existing shape checks (e.g. `Array.isArray(data)`) run after parse; they fail closed on shape but cannot bound the body. Retained as defense in depth. |

### Confirmed defect walkthrough

All thirteen sites call `response.json()`, which buffers the entire body before parsing. A chunked
response with no `content-length` (or a lying one) is fully buffered regardless of size; the
existing per-adapter shape checks then run after the fact. `packages/credentials-node/src/oidc.ts`
and `packages/policy/src/opa.ts` already read bounded text; the gap is the JSON success path.

### Gap analysis

**Already achievable today:** byte-bounded text reading, secret redaction, abort propagation, and
bounded JSON walking (for tool arguments) all exist in one module.

**The gap:** there is no bounded *success-body JSON* read. The reader lacks JSON depth/property/
aggregate caps and a schema-shape check — exactly what the roadmap requires ("UTF-8 byte, JSON
depth/property/aggregate caps, schema checks, aborts, and redacted errors").

### Approved new primitive (one, additive)

`readBoundedResponseJson<T>(response, options)` in `src/providers/transport.ts`, composed on
`readBoundedResponseText`:

- UTF-8 byte cap: `maxResponseBodyBytes` default `DEFAULT_MAX_RESPONSE_BODY_BYTES` (65,536) —
  aborts before full buffering with `response_body_overflow`.
- JSON depth cap: `maxDepth` default **32**.
- Property/aggregate cap: `maxProperties` default **4096** (total object properties + array
  elements walked).
- Schema-shape check: caller-supplied `shape?: (value: unknown) => value is T`; malformed JSON or
  shape failure throws `ProviderTransportError("response_body_shape")` (new additive code) with a
  redacted message — never a downstream `undefined` access.
- Abort propagation and secret redaction identical to `readBoundedResponseText`.

No new dependency; `JSON.parse` plus one bounded walk. All thirteen success-body sites migrate to
it; per-adapter post-parse validation stays as defense in depth.

---

## 3. Pin outbound DNS/address decisions (plan Task 4)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `resolvePinnedAddress(url, resolver, signal, allowLoopback)` | `packages/mcp/src/transport.ts:220` | Resolves via `MediaHostnameResolver` (`defaultResolver` = `dnsLookup(hostname, { all: true, verbatim: true })`), enforces 1–32 answer count, family validity, loopback confinement, and per-candidate `assertSsrfAllowedUrl` — then pins the first validated address. |
| `requestPinned(url, address, init)` | `transport.ts:257` | Node `http`/`https` request with a `lookup` hook that returns **only** the pinned address — the rebinding defense: Node connects to exactly the address the resolver validated. Streams the response through a `ReadableStream`; cancels on abort. |
| `createSecureMcpFetch(config)` | `transport.ts:132` | Composes origin allow-list + `resolvePinnedAddress` + `requestPinned`; **rejects 3xx redirects outright** (`MCP HTTP redirects are not allowed`); bounds response bytes via `boundResponse` (transport.ts:337). |
| `boundResponse` | `transport.ts:337` | Streaming byte cap with `content-length` precheck and reader cancel on overflow. |
| `assertSsrfAllowedUrl(url, policy)` / `SsrfPolicy` / `MediaContentError` | `src/content.ts:218,69,135` | URL-string SSRF precheck (deny private/metadata/loopback ranges, allow-list policy). Shared by MCP, OIDC, OPA, content. |
| `MediaHostnameResolver` / `MediaHostAddress` types | `src/content.ts` (exported) | Resolver contract already shared with core — MCP imports them from `@arnilo/prism`. |
| egress `dns-pin.ts` | `packages/coding-security/src/egress/dns-pin.ts:7-84` | `normalizeAddress` / `isPrivateAddress` / `isMetadataAddress` / `resolvePinned` / `assertPinned(host, remoteAddress, pinned)` — post-connect assertion for the proxy/egress path (`EgressError ERR_PRISM_EGRESS_DNS`). Overlaps in intent, different mechanism (assert-after-connect on the proxy path vs lookup-hook pin-before-connect on the direct path). |
| OIDC JWKS fetch | `packages/credentials-node/src/oidc.ts` (`fetchJwks`, ~line 203) | Currently: `assertSsrfAllowedUrl` + `redirect: "manual"` + `response.text()` with post-hoc size bound (`maxJwksKeys * maxJwkBytes + slack`). No DNS pin; a rebinding attacker can swap the address between check and connect. |
| OPA decision fetch | `packages/policy/src/opa.ts` (`callOpa`, ~line 195) | Currently: `assertSsrfAllowedUrl` + `redirect: "manual"` + local `readBoundedBody` cap (`maxResponseBytes`). No DNS pin. |
| Content fetch | `src/content.ts` | Uses `assertSsrfAllowedUrl` + policy for media URL fetches; same pin gap. |

### Confirmed defect walkthrough

At 0.2.0, JWKS/OPA/content fetches verify the URL string (`assertSsrfAllowedUrl`) and refuse
redirects, but the actual connection is made by whatever address the system resolver returns at
connect time. A DNS-rebinding attacker (or a compromised/malicious endpoint with a short TTL) can
present a public answer to the precheck and a private/metadata answer to the connect, or have the
host resolve mixed public+private answers and take the private one. MCP already closes this hole
with the `lookup` hook + per-candidate validation; the three other fetch paths do not.

### Gap analysis

**Already achievable today:** MCP's `resolvePinnedAddress` + `requestPinned` is the strongest
existing primitive (resolve → validate every answer → connect only to the pinned address →
redirect-manual → bounded response). It is already composed on core's `assertSsrfAllowedUrl`/
`MediaHostnameResolver`/`MediaHostAddress`. egress `dns-pin.ts` covers the proxy path.

**The gap:** OIDC JWKS, OPA, and content fetches have URL-string-only protection. Roadmap item 3
mandates reuse of the strongest primitive for exactly these calls.

### Approved new primitive (one, lifted, plus a non-decision)

- New core module `src/pinned-fetch.ts` exporting `pinnedFetch(url, init, { resolver, allowLoopback, maxResponseBytes })`
  — the MCP algorithm lifted verbatim (1–32 answers, family check, loopback confinement,
  per-candidate `assertSsrfAllowedUrl`, lookup-hook connect to the pinned address, 3xx rejected,
  bounded response body), throwing `MediaContentError("ssrf_denied")` on address violations so
  existing error families map naturally (OPA already propagates `MediaContentError`; OIDC wraps
  into `IdentityError` as today's SSRF denials do; content uses `MediaContentError` directly).
  `packages/mcp/src/transport.ts` re-exports/calls the core primitive so MCP keeps byte-identical
  behavior; `createSecureMcpFetch` keeps its `McpBridgeError` wrapping.
- OIDC `fetchJwks`, OPA `callOpa`, and the content media fetch route through `pinnedFetch`:
  resolve once, connect pinned, reject 3xx (`redirect: "manual"` + status check — the roadmap's
  "disabled" branch; no revalidate-and-follow for these three fixed-endpoint callers), keep their
  existing size/key/bundle-revision caps.
- **Decision 12 (egress `dns-pin.ts` not converged):** the egress primitive serves the
  coding-security proxy path (post-connect assertion, `EgressError` family) while MCP's primitive
  serves direct connects (pre-connect pin via `lookup`). Merging them now would churn the egress
  path for zero defect. Both stay; convergence is revisited only if a third direct-connect consumer
  appears (0.3.x candidate, demand-gated).

---

## 4. Shared bounded OAuth device/token polling (plan Task 5)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| Device-code poll loop (OpenAI) | `packages/provider-openai/src/oauth.ts` (`deviceLogin`, ~line 160) | `authorization_pending` continue, `slow_down` → `intervalMs += SLOW_DOWN_INCREMENT_MS` (5,000), expiry deadline via `now()`, abort via `signal` + `sleep`, `redactOAuthError`, `readTokenErrorPayload`. |
| Device-code poll loop (`credentials-node`) | `packages/credentials-node/src/oauth2.ts` (same shape, ~line 107-160) | Near-identical logic with `${config.id}` error prefix and provider-specific `extraTokenParams`; same `SLOW_DOWN_INCREMENT_MS`, same `TokenSuccessPayload`/`TokenErrorPayload` shapes. |
| `exchangeToken` / `parseTokenCredentials` | both files | Duplicated token exchange + parse (OpenAI adds `accountId`; both parse `access_token`/`refresh_token`/`expires_in`). |
| Unbounded success reads | `oauth.ts:174` (`tokenResponse.json()`), `oauth.ts` `readTokenErrorPayload` (`response.json()`), `oauth2.ts` same | Success and error bodies read unbounded on the token path; error paths in both also use `readBoundedResponseText` where already wired. |
| Consumer packages | `packages/credentials-node/src/microsoft365-oauth.ts`, `google-workspace-oauth.ts` | Use `oauth2.ts`'s device flow with provider-specific fields — the helper signature must stay compatible. |
| Dependency topology (verified) | `packages/*/package.json` | No provider package depends on `credentials-node`; `credentials-node` imports only types from `@arnilo/prism` root; `provider-openai` imports runtime helpers from `@arnilo/prism/providers/transport`. A shared helper must live in core, not `credentials-node`. |

### Confirmed defect walkthrough

Two near-identical poll loops with identical constants and payload shapes have already drifted
(OpenAI's `readTokenErrorPayload` falls back to `readBoundedResponseText` on parse failure; the
`credentials-node` variant differs in error text and provider fields). Both read token success
bodies unbounded. Any hardening (bounded JSON, redaction change) must be applied twice today.

### Gap analysis

**Already achievable today:** both implementations already redact, handle pending/slow-down/expiry/
cancel, and (partially) bound error bodies. RFC 8628 semantics are correct in both.

**The gap:** duplication, not defect — the roadmap mandates one shared bounded device-code/token
poll + error mapping between the two, keeping provider-specific fields at the adapters, without a
generic transport framework.

### Approved new primitive (one, shared)

`pollDeviceCodeToken(options)` in new core module `src/oauth-device-code.ts`, exported from the
core root (both consumers already import from `@arnilo/prism`):

- Owns: device-code POST, poll loop, `authorization_pending` continue, `slow_down` backoff
  (`SLOW_DOWN_INCREMENT_MS` moved once), expiry deadline (`now`), abort (`signal`), success body
  via `readBoundedResponseJson`, error body via `readBoundedResponseText`, secret redaction
  (`device_code`/`user_code`/`access_token`/`refresh_token`), token-shape parse
  (`access_token` required, else fail closed).
- Adapter surface via options/callbacks: `fetchImpl`, URLs, `clientId`, `scope`,
  `extraTokenParams`, `errorPrefix`, `parseTokenCredentials`-extension for provider-specific
  fields (`accountId`), `onDeviceCode`, `sleep`, `now`.
- No class hierarchy, no strategy registry, no new package. `microsoft365-oauth.ts` /
  `google-workspace-oauth.ts` keep their provider fields through the same options shape.

---

## 5. Credential, signing, upload, and cache edge fixes (plan Task 6)

Four defects, four single-site fixes — no new primitive (the plan explicitly forbids a shared
helper for one consumer).

### 5a. Azure/Vertex credential resolved twice per request

**Inventory:** `packages/provider-azure/src/provider.ts:70` and
`packages/provider-vertex/src/provider.ts:50` pass `apiKey: options.credential` (the
`CredentialValueSource`) into `createOpenAICompatibleProvider`, and their outer `generate`
wrappers call `resolveCredentialValue(options.credential, …)` again at lines 84/58. The inner
provider resolves the source once more per request.

**Defect:** the same credential source is consumed twice per request. Rotating/single-use
credential sources are spent twice (or break: a one-shot source yields a fresh token on the second
resolution, or fails on replay).

**Decision:** resolve once at the top of the outer wrapper (keeping the early fail-closed
missing-credential error) and inject the resolved string as `apiKey` into the inner provider for
that request; remove the source-passing path. Rotating tokens are consumed exactly once per
request, fresh per request.

### 5b. Bedrock SigV4 duplicate-case headers and repeated query parameters

**Inventory:** `packages/provider-bedrock/src/sigv4.ts:52-60`.
`canonicalHeaders` = `Object.entries(headers).find(([key]) => key.toLowerCase() === name)` —
picks the **first** entry by insertion order while the object spread at lines 32-39 means
duplicate-case keys both survive into the header map; a `Content-Type` + `content-type` pair
produces two canonical-able entries and the signed value is the first-match one, not the value
the request actually sends with both headers. `canonicalQuery` sorts
`.sort(([a],[b]) => (a === b ? a.localeCompare(b) : a.localeCompare(b)))` — both branches
identical, so repeated query keys (`?a=2&a=1`) are never ordered by value as AWS SigV4 requires.

**Decision:** normalize input headers once: lowercase names, merge duplicate-case keys with
**last-wins** (deterministic; consistent with object-spread semantics callers already rely on),
filter reserved names, then build canonical headers from the merged map. Sort canonical query
entries by key, tie → value. Existing single-case/single-key fixtures stay byte-identical.

### 5c. OpenAI upload cleanup loses failed-DELETE IDs

**Inventory:** `packages/provider-openai/src/uploads.ts:86-107`. `cleanup()` copies
`uploadedIds` then **clears the set and the cache before** issuing the DELETEs; a DELETE that
fails (network/5xx) is swallowed as "best-effort" and its file ID is gone — the file leaks with
no way to retry.

**Decision:** remove a file ID from the set only after its DELETE succeeds; failed DELETEs retain
the ID so a later `cleanup()` call retries them. `cache.clear()` stays (dedup cache is
per-session). Retention is bounded by the same per-request upload flow as before (unchanged
growth semantics; upload count is request-bounded by the caller and the bounded cache cap). Also
migrate the success `response.json()` (line 79) to `readBoundedResponseJson` with the `id` shape
check (item 2).

### 5d. Cache telemetry overflow mixes model costs

**Inventory:** `src/cache-telemetry.ts:99-147`. `bucket()` collapses keys beyond
`CACHE_TELEMETRY_CAP` into one shared `overflowSample` (`__overflow__`/`__overflow__`), then
`record()` applies `if (model?.cost)` to that shared sample — the current record's model cost
lands on mixed-model overflow tokens (line 144), so one model's `estimatedSavings`/`currency` is
attributed to other models' tokens.

**Decision:** the overflow bucket never carries cost. Overflow records tokens/requests only
(`estimatedSavings`/`currency` absent); per-model samples before overflow keep their own cost.
This is the roadmap's "tokens only" semantics — deterministic and cannot misattribute. A
per-record cost flag on the overflow bucket is rejected (adds cardinality for no host-visible
benefit; hosts needing per-model overflow cost should raise the cap).

---

## 6. Cross-cutting decisions

### Operational ownership

| Item | Owner | Evidence gate |
| --- | --- | --- |
| Strict completion default | Core provider transport maintainer | Unit + built-entry conformance + packed consumer (no protected env) |
| Bounded success-body reader | Core provider transport maintainer + each provider adapter owner | Shared bounds conformance across 13 sites + built/packed (no protected env) |
| Pinned fetch (JWKS/OPA/content) | `@arnilo/prism-credentials-node`, `@arnilo/prism-policy`, core content maintainers + deploying host | Unit matrix + built/packed; **protected OIDC/OPA evidence** (missing → 0.2.1 blocked, not skipped) |
| OAuth consolidation | `@arnilo/prism-credentials-node` + `@arnilo/prism-provider-openai` maintainers | Shared conformance run against both call sites + built/packed |
| Azure/Vertex/Bedrock/OpenAI-upload edge fixes | respective provider maintainers + deploying host | Fixture regressions (rotating token, SigV4 duplicate-case/repeated-query, failed-DELETE retry) + built/packed |
| Cache telemetry overflow | Core cache maintainer | Mixed-model overflow fixture + built/packed |
| Release/security sign-off | Prism operator `arn` | Full phase-21 baseline exit evidence, signed tag, OIDC provenance |

### Migration decisions

- **Strict completion:** no type or wire change. Hosts consuming partial output after an unclean
  EOF now receive `providerError` (`incomplete_delta`); the documented opt-out is the existing
  `strictCompletion: false`. No persisted state change.
- **Bounded success bodies:** oversized upstream JSON/text aborts with `response_body_overflow`
  (bytes) or `response_body_shape` (malformed/shape). Hosts whose legitimate endpoints exceed the
  defaults raise the per-call `maxResponseBodyBytes`/`maxDepth`/`maxProperties` (additive options);
  defaults match existing `DEFAULT_MAX_RESPONSE_BODY_BYTES`.
- **Pinned fetch:** JWKS/OPA/content fetches now resolve once, connect only to a validated public
  address, and reject 3xx. Endpoints that resolve to private/metadata/loopback addresses or rely
  on redirect-following now fail closed; hosts must pin public endpoints explicitly. No persisted
  state change. MCP behavior unchanged.
- **OAuth consolidation:** no public OAuth API change; helper is additive and internal-facing.
  Error text and redaction remain equivalent; both adapters keep provider-specific fields.
- **Edge fixes:** no public type change. Azure/Vertex rotating tokens are consumed once per request
  (previously twice). Bedrock duplicate-case/repeated-query requests sign correctly (previously
  mismatched AWS). OpenAI uploads with failed DELETEs are retryable (previously leaked). Cache
  telemetry overflow reports tokens only (previously mixed cost).

### Rollback posture

Restoring 0.2.0 restores the five trust-boundary gaps and is **not** a production mitigation. If
code rollback is unavoidable, hosts should disable the affected provider/identity/policy paths at
their own boundary until 0.2.1 is restored. No data migration rollback is needed.

### Package and performance budget

- Publish graph stays **50 packages**; zero new runtime dependencies anywhere. New source is
  limited to `src/pinned-fetch.ts`, `src/oauth-device-code.ts`, `src/providers/transport.ts`
  (additive reader + one new error code), `src/providers/openai-compatible.ts` (default flip),
  `src/cache-telemetry.ts` (overflow cost removal), `src/index.ts` (additive exports for the two
  new modules), the four provider single-site fixes, their tests, `scripts/phase21-*`, and docs.
  Root/package size growth must stay within `scripts/budgets.json` tolerance.
- **Strict completion:** O(1) stream-state booleans already tracked; no I/O.
- **Bounded reader:** O(body bytes) single pass, hard byte ceiling, depth/property walks bounded
  by caps; peak memory ≤ cap + one chunk; no re-buffer.
- **Pinned fetch:** one `lookup` per request (already done by MCP) + socket address assertion via
  the `lookup` hook; O(1) per request, no extra round trip; abort propagates.
- **OAuth helper:** behavior-equivalent refactor; poll cadence/sleep/backoff unchanged.
- **Bedrock signing:** O(headers + query) with stable sort; no asymptotic change.
- **Upload cleanup:** set removal per DELETE; growth semantics unchanged (request-bounded).
- **Cache telemetry:** overflow cost removal is O(1) per record; no added cardinality.

### Security decisions (explicit)

1. Strict completion is fail-closed by default; `strictCompletion: false` is a documented
   downgrade whose risk the opting host owns.
2. Oversized success bodies abort before full buffering; defaults are the existing 65,536-byte
   ceiling; per-call raises are additive and documented.
3. DNS pin + redirect rejection is the trust boundary for JWKS/OPA/content — the URL-string
   `assertSsrfAllowedUrl` remains only as a precheck, never the sole boundary.
4. The shared OAuth helper redacts `device_code`/`user_code`/`access_token`/`refresh_token` at
   both call sites; malformed/oversized token responses fail closed; no token echoes in errors.
5. The cache overflow bucket never carries cost; cost attribution cannot cross models.
6. No item-5 fix weakens an existing control: credential-once is strictly stricter than
   twice-consumed; canonical signing fixes a signature mismatch (AWS previously rejected or
   mis-signed); upload retention is strictly better than leak; overflow cost removal is strictly
   more truthful.

### Code quality decisions (rejected approaches)

- **Generic schema/validation framework** (zod/ajv) for the bounded reader: rejected — core stays
  dependency-free; the reader is a bounded hand-rolled walk reusing existing constants/errors.
- **Generic HTTP/transport framework** for pinning or OAuth: rejected — roadmap explicitly forbids
  a generic transport framework beyond repeated behavior; two consumers each, function not class.
- **Second pinning primitive** (new dispatcher-based pin): rejected — MCP's stdlib `lookup`-hook
  primitive is the strongest and is lifted, not re-invented.
- **Egress `dns-pin.ts` convergence now:** rejected (decision 12) — different mechanism, different
  consumer path, zero defect; revisit only with a third direct-connect consumer.
- **OAuth strategy/factory hierarchy:** rejected — one function with adapter options, two callers.
- **Per-adapter `strictCompletion` flags:** rejected — one shared default covers all current and
  future adapters.
- **Shared helper for single-consumer edge fixes** (credential-once, signing, uploads, telemetry):
  rejected — each fix lives at its root-cause call site.
- **Background sweep for upload cleanup:** rejected — no background service in Prism; retry is
  caller-driven via the retained ID set.
- **Per-record cost flag on the overflow bucket:** rejected — tokens-only is simpler and
  deterministic; hosts needing per-model overflow cost raise the cap.
- **New workspace package for the OAuth helper:** rejected — core is already the shared import
  point for both consumers.

---

## 7. Threat-to-test traceability (tripwire inputs for Task 1)

| # | Threat | Mitigating task | Named tests |
| --- | --- | --- | --- |
| T1 | Truncated OpenAI-compatible stream succeeds as `providerDone` (azure/bedrock/vertex/openrouter/zai/neuralwatt) | Task 2 + Task 7 | `openai-compatible.test.ts` truncated-stream default-rejection; per-adapter conformance; `phase21-security.test.mjs` built public; packed plain-JS consumer |
| T2 | Valid terminal variants (`mapUsage`/`doneUsage`/`onComment`) break under strict default | Task 2 | existing valid-completion/usage/mapUsage cases stay green; terminal-variant case |
| T3 | Abort mid-stream misreported as truncation | Task 2 | abort case unchanged (abort error, not `incomplete_delta`) |
| T4 | Oversized chunked discovery/quota/embeddings/uploads body fully buffers | Task 3 + Task 7 | `provider-transport.test.ts` bounded-JSON conformance across all 13 shapes; near-cap chunked fixtures; built/packed oversized-body assertion |
| T5 | Malformed/shape-mismatched success JSON crashes downstream with raw TypeError | Task 3 | depth/property/aggregate cap cases; missing-`data`/missing-fields/missing-`id` shape cases fail closed with `response_body_shape` |
| T6 | JWKS/OPA/content DNS rebinding connects to private/metadata address | Task 4 + Task 7 | `pinned-fetch.test.ts` private/mixed-answers/metadata/rebinding matrix; oidc/opa/content regressions; built/packed private-fetch assertion |
| T7 | JWKS/OPA/content redirect rebinds to private target | Task 4 | 3xx-rejected tests at all three callers; MCP redirect rejection stays green |
| T8 | IPv4/IPv6 edge and abort mis-pinning | Task 4 | family matrix + abort propagation tests |
| T9 | OAuth poll drift / unbounded token body / secret leak | Task 5 + Task 7 | shared conformance (pending/slow-down/expiry/cancel/malformed/oversized/redaction/token-shape) run against both call sites; built/packed redaction assertion |
| T10 | Azure/Vertex rotating token consumed twice | Task 6 + Task 7 | rotating/single-use fixture: exactly one resolution per request; missing-token fail-closed unchanged |
| T11 | Bedrock duplicate-case header or repeated-query signature mismatch | Task 6 + Task 7 | SigV4 duplicate-case/repeated-query fixtures match AWS reference; existing single-key fixtures byte-identical |
| T12 | Failed upload DELETE leaks file permanently | Task 6 + Task 7 | failed-DELETE retains ID; retry cleanup deletes; success removes; set bounded |
| T13 | Overflow bucket attributes one model's cost to another's tokens | Task 6 + Task 7 | two-model mixed overflow fixture: per-model pre-overflow samples keep own cost; `__overflow__` has no cost fields |
| T14 | Opt-out/downgrade weakens the default silently | Task 2 + Task 8 | explicit `strictCompletion: false` honored and documented; migration doc semantic tripwire |
| T15 | New dependency/package sneaks in | Task 1 | freeze test: package/dependency count unchanged at 50 |
