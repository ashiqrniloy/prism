# Release 0.2.1 — Provider Completion and Outbound Trust Boundaries

Roadmap phase: `roadmap.md` § **0.2.1 — Provider completion and outbound trust boundaries**.
Baseline: `@arnilo/prism` **0.2.0** (plan 020 complete; 50-package publish graph; zero audited vulnerabilities; sequential suite 44 suites / 3,372 tests / 3,339 pass / 33 protected or live skips / 0 failures; `exitGate.green: true` in `scripts/phase20-baseline.json`).
Target: `@arnilo/prism` **0.2.1**. Behavior changes are fail-closed hardening of existing trust boundaries; public contract additions are additive only (bounded-reader helpers, pinned-fetch helper, OAuth parsing helper). No removal is planned.

Scope items (mapped one-to-one to the five roadmap 0.2.1 bullets):

1. Require completion evidence for every streaming provider: truncated streams must fail, never succeed as `providerDone`.
2. Bound all upstream success bodies while streaming: one dependency-free bounded response reader for model discovery, uploads, OAuth, quota, embeddings, and other non-stream JSON endpoints.
3. Pin outbound DNS/address decisions: reuse the strongest existing pinning primitive for OIDC JWKS, OPA, and content fetches; redirects disabled or revalidated and repinned.
4. Consolidate duplicated OAuth and provider parsing: share bounded device-code/token polling and error mapping between core OpenAI OAuth and `credentials-node`.
5. Fix credential, signing, upload, and cache edge cases: Azure/Vertex credentials once per request; Bedrock SigV4 duplicate header casing and repeated query parameters; retain failed OpenAI upload cleanup IDs for retry; keep overflow cache telemetry from applying one model's cost to mixed-model tokens.

## Objectives

- Close the five confirmed provider/network trust-boundary gaps without adding a runtime dependency, a package, a background service, an alternate runtime, or a generic transport framework beyond repeated bounded behavior.
- Make TypeScript declarations and JavaScript runtime behavior agree at every affected upstream boundary; packed plain-JavaScript consumers must not be able to bypass the new bounds.
- Preserve all normal provider streaming, model discovery, credential refresh, OAuth login, upload dedup, and cache telemetry behavior; only the named failure and edge paths change.
- Keep every upstream success-body read, DNS pin, OAuth poll, signature, upload cleanup, and cache aggregation bounded, redacted, and fail closed before the side effect they protect.
- Publish explicit migration guidance for strict-completion defaulting, bounded success bodies, DNS-pinned fetch, shared OAuth parsing, and the four item-5 edge fixes.
- Record machine-checkable baseline, threat-model, compatibility, package-budget, protected-matrix, and release evidence; satisfy the mandatory 0.2.x regression matrix items 5–7 and 10–11 for this release.

## Non-goals

- No concurrent-state work from 0.2.2 (budget reservation, conversation CAS, single-consumer registry), no build/coverage repair from 0.2.3, no package/docs truth from 0.2.4, no refactoring from 0.2.5.
- No new model provider, delegated agent, enterprise adapter, forge, object store, policy engine, or live-canary work; all catalog breadth stays deferred to 0.3.x.
- No generic HTTP transport framework, retry framework, or ORM. Shared helpers are extracted only for the bounded response reader, the pinned fetch, and the OAuth poll — each already duplicated across two or more implementations.
- No change to provider streaming wire format, SSE event semantics, `ProviderEvent` shape, `AIProvider.generate()` contract, or the OpenAI-compatible request body builder. `strictCompletion` becoming the shared default is a behavior tightening, not a contract change.
- No removal of `strictCompletion`, `doneUsage`, `mapUsage`, `readBoundedResponseText`, `assertSsrfAllowedUrl`, `SsrfPolicy`, or any existing OAuth/credential option; additions are additive.
- No assumption that native `fetch` connects to a pinned address. DNS pinning requires an explicit connect-to-IP mechanism; Task 0 records the exact one MCP already uses and lifts it without inventing a second.
- No live OIDC IdP, OPA server, or S3 canary in default CI; those remain 0.3.0 protected gates. 0.2.1 proves pinning, bounds, and parsing with network-free fakes plus the existing protected matrix.
- No new code-wiki task: `.agents/skills/project-wiki/` does not exist.

## Expected Outcome

- `openAIChatEvents`/`createOpenAICompatibleProvider` treat strict completion as the shared default; Azure, Bedrock, Vertex, OpenRouter, ZAI, NeuralWatt, and every other OpenAI-compatible adapter reject EOF without the required done marker/finish reason as a `ProviderTransportError` (`incomplete_delta`/truncation) rather than emitting a successful `providerDone`. Adapters that already opt in (alibaba, kimi, ollama, opencode-go) keep identical behavior; valid provider-specific terminal variants remain supported and documented.
- One dependency-free bounded success-body reader in `src/providers/transport.ts` (`readBoundedResponseText` plus an additive `readBoundedResponseJson` with UTF-8 byte, JSON depth, property-count, and aggregate caps, schema shape check, abort, and redacted error) replaces unbounded `response.json()`/`response.text()` in the ten model-discovery implementations, OpenAI uploads, OAuth device/token success paths, NeuralWatt quota, and Alibaba embeddings. Oversized chunked bodies terminate before full buffering; normal payloads are byte-for-byte unchanged.
- OIDC JWKS, OPA decision, and content fetches route through a shared pinned-fetch primitive lifted from the strongest existing MCP transport resolution/pinning mechanism (`resolvePinnedAddress` + `requestPinned` + `assertSsrfAllowedUrl` in `packages/mcp/src/transport.ts`, already composing `assertSsrfAllowedUrl`/`MediaHostnameResolver`/`MediaHostAddress` from core). Private resolution, mixed public/private answers, metadata targets, redirects, DNS rebinding, IPv4/IPv6 edges, and aborts fail closed; redirects are disabled or independently revalidated and repinned.
- One bounded OAuth device-code/token polling and error-mapping helper is shared between `packages/provider-openai/src/oauth.ts` and `packages/credentials-node/src/oauth2.ts`; provider-specific fields stay at the adapters. authorization-pending, slow-down, expiry, cancellation, malformed JSON, oversized body, secret redaction, and token-shape tests run once against both call sites.
- Azure and Vertex resolve their credential exactly once per request (not twice via the outer wrapper plus the inner `apiKey` source); rotating and single-use tokens get a fresh value each request without double consumption. Bedrock `signAwsRequest` canonicalizes duplicate-case headers (lowercase, single value) and sorts repeated query parameters by key then value; signatures match AWS for those inputs. OpenAI upload cleanup retains IDs whose DELETE failed so a retry can clean them; successful DELETEs remove the ID. Cache telemetry overflow never applies one model's `cost` to another model's tokens in the `__overflow__` bucket.
- Direct source tests, built public-import tests, and a fresh packed plain-JavaScript consumer prove the fixes without relying on TypeScript.
- 0.2.1 exits with 50 packages, zero new runtime dependencies, standard budgets green, no skipped trust-boundary blocker, and an operator-ready signed-tag/OIDC handoff.

## Operational Ownership

- **Release and trust-boundary owner:** Prism maintainer/operator `arn`; owns scope amendments, threat acceptance, compatibility review, protected evidence, signed `v0.2.1` tag, and npm OIDC publication.
- **Provider transport owner:** Prism core maintainer; owns `src/providers/transport.ts` bounded reader/SSE primitives, the OpenAI-compatible base strict-completion default, and the shared pinned-fetch primitive placement.
- **Provider adapter owners:** each `@arnilo/prism-provider-*` maintainer plus deploying host; packages own adapter-specific terminal variants, model-discovery bounds, and per-adapter credential/signing/upload behavior; hosts own truthful endpoint URLs and credential sources.
- **Identity/policy/content owners:** `@arnilo/prism-credentials-node` (OIDC/JWKS, OAuth2), `@arnilo/prism-policy` (OPA), and core `src/content.ts` (content fetch SSRF) maintainers; each owns routing their fetch through the shared pinned primitive while keeping existing limits/redirect posture.
- **CI evidence owner:** release workflow maintainer; missing protected provider/identity/policy evidence blocks the 0.2.1 gate rather than becoming a passing skip.

## Migration Impact

- **Strict completion default:** no type or wire change. Adapters that previously streamed truncated output as a successful `providerDone` now emit `providerError` with a `ProviderTransportError` truncation code. Hosts relying on partial output after an unclean EOF must handle the error or set an explicit opt-out only if Task 0 approves one; the default is fail-closed. No persisted state or checkpoint shape changes.
- **Bounded success bodies:** oversized upstream JSON/text that previously fully buffered now aborts with `response_body_overflow`. Hosts whose discovery/quota/upload/oauth endpoints legitimately exceed the documented byte/depth/property caps must raise the per-call limit (additive option); defaults match existing `DEFAULT_MAX_RESPONSE_BODY_BYTES`.
- **Pinned fetch:** OIDC/OPA/content fetches that previously relied on `assertSsrfAllowedUrl` (URL-string check) plus `redirect: "manual"` now also pin DNS answers and verify the connected address. Endpoints that resolve to private/metadata/loopback addresses or that depend on redirect-following now fail closed; hosts must pin public endpoints explicitly. No persisted state change.
- **OAuth consolidation:** no public OAuth API change; the shared helper is internal. Error messages and redaction behavior remain equivalent; the two adapters keep their provider-specific token fields and error prefixes.
- **Credential/signing/upload/cache edge fixes:** no public type change. Azure/Vertex rotating tokens are consumed once per request (previously twice). Bedrock requests with duplicate-case headers or repeated query keys now sign correctly (previously mismatched AWS). OpenAI uploads that fail DELETE during cleanup are retryable (previously leaked). Cache telemetry overflow reports per-model costs only (previously mixed).
- **Rollback:** restoring 0.2.0 restores the five trust-boundary gaps and must not be used as a production mitigation. If code rollback is unavoidable, hosts should disable the affected provider/identity paths at their own boundary until 0.2.1 is restored. No data migration rollback is needed.

## Package and Performance Budget

- Publish graph remains **50 packages**; no package or export subpath is added except the additive core transport helpers (`readBoundedResponseJson`, the shared pinned-fetch primitive name Task 0 approves) and the shared OAuth helper (internal or a narrow additive export Task 0 approves).
- Runtime dependencies remain unchanged: core stays dependency-free; every affected provider and `credentials-node`/`policy` gains no dependency. The pinned-fetch primitive uses only Node stdlib (`node:dns/promises`, `node:http`, `node:https`, `node:net`) exactly as MCP already does.
- Root and affected package packed/unpacked/file-count growth must remain within `scripts/budgets.json` tolerance unless measured evidence justifies a reviewed baseline change.
- Strict-completion check is O(1) state per stream, no extra I/O.
- Bounded success-body read is O(body bytes) with one pass and a hard byte ceiling; JSON depth/property checks are O(depth) bounded by the cap; no full re-buffer beyond the cap.
- Pinned fetch adds one DNS `lookup` per request (already done by MCP) plus a socket address assertion; O(1) per request, no extra round trip.
- OAuth consolidation is a behavior-equivalent refactor; poll cadence, sleep, and redaction are unchanged.
- Bedrock signing stays O(headers + query params) with a stable sort; canonicalization adds no asymptotic cost.
- Upload cleanup retains a bounded `Set<string>` of failed-DELETE IDs (bounded by existing upload cache cap); no unbounded growth.
- Cache telemetry overflow cost attribution is O(1) per record with a per-model cost flag on the overflow bucket; no extra cardinality.

## Tasks

- [x] Task 0 — Primitive review, threat model, ownership, migration, and budget decisions
  - Acceptance Criteria:
    - Functional: create `docs/_evidence/phase21-primitive-review.md` before any source edit, inventorying existing primitives: `readBoundedResponseText`, `readSseEvents`, `readSseData`, `tryParseJsonObjectArguments`, `ProviderTransportError`, `DEFAULT_MAX_RESPONSE_BODY_BYTES` and the `BoundedStreamLimits` family in `src/providers/transport.ts`; `openAIChatEvents`/`createOpenAICompatibleProvider` `strictCompletion`/`doneUsage`/`mapUsage` in `src/providers/openai-compatible.ts`; the per-adapter `openAIChatEvents`/`sharedOpenAIChatEvents` call sites across azure/bedrock/vertex/openrouter/zai/neuralwatt/alibaba/kimi/ollama/opencode-go; the ten `response.json()` model-discovery sites and the quota/embeddings/uploads/oauth sites; `resolvePinnedAddress`/`requestPinned`/`assertSsrfAllowedUrl`/`MediaHostnameResolver`/`MediaHostAddress`/`createSecureMcpFetch` in `packages/mcp/src/transport.ts`; `resolvePinned`/`assertPinned`/`isPrivateAddress`/`isMetadataAddress` in `packages/coding-security/src/egress/dns-pin.ts`; `assertSsrfAllowedUrl`/`SsrfPolicy`/`MediaContentError` in `src/content.ts`; the OAuth device/token/exchange code in `packages/provider-openai/src/oauth.ts` and `packages/credentials-node/src/oauth2.ts`; `signAwsRequest` in `packages/provider-bedrock/src/sigv4.ts`; Azure/Vertex `resolveCredentialValue` in their provider wrappers; OpenAI `uploads.ts` cleanup; `cache-telemetry.ts` `bucket`/`sampleFor`/`record`.
    - Functional: document what can be fixed with those primitives and approve only the minimum reusable gaps: one additive `readBoundedResponseJson` (or equivalent bounded JSON helper) in `src/providers/transport.ts` (approved because ≥10 model-discovery sites plus quota/embeddings/uploads/oauth all need bounded JSON), one shared pinned-fetch primitive lifted from MCP's `resolvePinnedAddress`+`requestPinned` to a core location Task 0 names (approved because OIDC/OPA/content plus MCP already duplicate resolve-then-pin-then-assert; egress `dns-pin.ts` is a candidate to converge but convergence is optional and decided here), one shared bounded OAuth device/token poll+error helper (approved because two implementations already duplicate it), and the four item-5 fixes at their existing single call sites (no new abstraction). Reject a generic transport/HTTP framework, a retry framework, a second bounded reader, or a per-adapter strict-completion flag proliferation.
    - Functional: decide the strict-completion approach: flip `strictCompletion` to the shared default in the OpenAI-compatible base (root-cause, one change covers all first-party OpenAI-compatible adapters) versus per-adapter opt-in. Record the chosen approach and any approved opt-out seam. Verify which adapters already opt in (alibaba, kimi, ollama, opencode-go) so the flip is a no-op there and a tightening for azure/bedrock/vertex/openrouter/zai/neuralwatt.
    - Functional: record threat actors, assets, entry points, trust boundaries, and mitigations for at least: truncated stream accepted as done, oversized discovery/quota/upload/oauth body, JWKS/OPA/content SSRF via rebinding or redirect, duplicate-case/repeated-query signing mismatch, double credential consumption, leaked upload ID on failed DELETE, mixed-model cost in overflow bucket, and downgrade via an opt-out.
    - Functional: map every threat to a concrete test in Tasks 2–7 and record the operational owner, migration decision, rollback posture, package budget, and protected environment for each item.
    - Performance: record baseline complexity/memory for the bounded reader, pinned fetch, OAuth poll, Bedrock signing, upload cleanup, and cache telemetry; proposed changes stay within the Package and Performance Budget above.
    - Code Quality: reject a generic schema/transport framework, a second pinning primitive, a factory for one OAuth adapter, or new interfaces with a single consumer; retain existing package boundaries and the deny-by-default posture.
    - Security: explicitly decide that strict completion is fail-closed by default, oversized success bodies abort before full buffering, DNS pin + redirect-manual is the trust boundary (not the URL-string check alone), OAuth parsing redacts secrets at both call sites, and no item-5 fix weakens an existing control. Record all decisions in the evidence document.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.2.1, mandatory 0.2.x regression matrix items 5–7 and 10–11, release validation checklist, release order.
      - `.agents/skills/create-plan/SKILL.md` primitive-review requirement and `references/prism-wiki.md` documentation requirements.
      - `docs/provider-primitives.md`; `docs/providers/openai-compatible.md`; `docs/provider-transport` references in `src/__tests__/provider-transport.test.ts`.
      - `docs/credential-storage.md` (OIDC/JWKS, OAuth2); `docs/credentials-and-redaction.md`; `docs/settings-auth-trust-security.md`.
      - `docs/policy-and-audit.md` (OPA); `docs/multimodal-content.md` (content fetch SSRF); `docs/mcp-tools.md` (DNS-pinned transport).
      - `docs/providers/{azure,bedrock,vertex,openrouter,zai,neuralwatt,alibaba,kimi,ollama,opencode-go}.md`.
      - `docs/provider-caching.md` (cache telemetry); `docs/migration.md` 0.1.7 → 0.2.0 migration structure.
      - Node.js v20.20.2 docs: `node:dns/promises` `lookup`, `node:http`/`node:https` `request` with custom `lookup`, `node:net` `isIP`, `URLSearchParams`, `FormData`/`Blob`, `Response.json()`/`Response.text()`.
      - `plans/020` primitive-review/threat-model/exit-gate precedent.
    - Options Considered:
      - Per-adapter strict-completion opt-in: rejected as the primary fix; caller-specific flags leave sibling adapters exposed and is more code than flipping the shared default.
      - A new bounded-HTTP package: rejected; the reader belongs in the existing core transport module already imported by every adapter.
      - A second DNS-pin primitive: rejected; MCP already has the strongest one and egress already has one; lift/reuse, do not duplicate.
      - Reuse-first review with one threat table and explicit decisions: chosen.
    - Chosen Approach:
      - Write one tarball-excluded evidence document before freeze or source edits; freeze exact decisions and test names in Task 1.
      - **Decisions recorded** in `docs/_evidence/phase21-primitive-review.md` (created 2026-08-13 at HEAD `cb9369d`, Release 0.2.0 baseline): JSON-shape error code is new additive `response_body_shape`; pinned-fetch primitive lands in new core module `src/pinned-fetch.ts`; shared OAuth helper lands in new core module `src/oauth-device-code.ts` exported from the core root (provider-openai and credentials-node both already import from core; no provider package depends on credentials-node — verified); egress `dns-pin.ts` is **not** converged in 0.2.1 (different mechanism/consumer path, revisit only with a third direct-connect consumer); the existing `strictCompletion: false` option is the documented opt-out (no new seam); cache-telemetry overflow is tokens-only (cost dropped on the `__overflow__` bucket); Bedrock duplicate-case header merge is last-wins; JWKS/OPA/content pinned fetches reject 3xx redirects outright (roadmap "disabled" branch).
    - API Notes and Examples:
      ```ts
      import { readBoundedResponseText, readBoundedResponseJson } from "@arnilo/prism/providers/transport";
      import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
      import { resolvePinnedAddress, requestPinned } from "@arnilo/prism"; // placement decided in Task 0
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase21-primitive-review.md`: primitive inventory, gap decisions, threat model, owner/migration/budget matrix, and test mapping.
      - `plans/021-Release-0-2-1-Provider-Completion-and-Outbound-Trust-Boundaries.md`: update only if review changes planned approach/files/tests.
    - References:
      - `src/providers/transport.ts`; `src/providers/openai-compatible.ts`; `src/content.ts`.
      - `packages/mcp/src/transport.ts`; `packages/coding-security/src/egress/dns-pin.ts`.
      - `packages/provider-openai/src/{oauth,uploads,models}.ts`; `packages/credentials-node/src/{oauth2,oidc}.ts`; `packages/policy/src/opa.ts`.
      - `packages/provider-{azure,bedrock,vertex,openrouter,zai,neuralwatt,alibaba,kimi,ollama,opencode-go,anthropic,google}/src/*.ts`.
      - `packages/provider-bedrock/src/sigv4.ts`; `src/cache-telemetry.ts`.
  - Test Cases to Write:
    - review traceability tripwire: every threat ID maps to at least one named automated test and one owning task.
    - primitive constraint tripwire: evidence rejects new dependencies/packages and records why each new helper has multiple call sites.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence and decisions only; source behavior changes in Tasks 2–6.
    - Docs pages to create/edit:
      - `docs/_evidence/phase21-primitive-review.md`: internal, tarball-excluded trust-boundary evidence — primitive inventory, approved gaps, threat-to-test traceability, owners, migration/rollback, budget, and baseline complexity figures.
    - `docs/index.md` update: no — `_evidence` is intentionally not public navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence exception; public docs follow in implementation tasks).

- [x] Task 1 — Freeze 0.2.0 baseline and machine-check 0.2.1 scope
  - Acceptance Criteria:
    - Functional: create `scripts/phase21-freeze-manifest.json` with target/baseline, five item scopes (disjoint `allowedFiles` per item), done-phase content markers, negative markers, threat-to-test mapping, a `sharedFiles` registry with per-editor markers, a `preservedSurface` naming the reused primitives (`readBoundedResponseText`, `readSseEvents`, `ProviderTransportError`, `assertSsrfAllowedUrl`, `SsrfPolicy`, `resolvePinnedAddress`, `signAwsRequest` shape), allowed/forbidden lists, compat policy additive-only with documented behavior tightenings and deviation-gated `--allow-break`, migration tokens, per-task evidence tokens, and protected-gate policy (provider/identity/policy protected evidence blocks the gate, never a passing skip).
    - Functional: create `scripts/phase21-baseline.json` captured at 0.2.0 after plan 020's exit gate, recording clean 0.2.0 test/typecheck/lint/format/coverage/audit/secret/pack/release-gate evidence, the 50-package graph, affected declaration/file hashes (transport, openai-compatible, content, the ten model-discovery files, oauth2/oidc/opa, sigv4, uploads, cache-telemetry, the azure/vertex/bedrock/openrouter/zai/neuralwatt provider files), current `strictCompletion` opt-in inventory, current unbounded `response.json()`/`response.text()` site inventory, current OIDC/OPA/content fetch posture, current OAuth duplication inventory, current Bedrock canonicalization behavior, current upload cleanup behavior, current cache-telemetry overflow behavior, and `exitGate: null`.
    - Functional: create `scripts/phase21-freeze.test.mjs` (stdlib-only, deterministic, mirrors phase 17–20 shapes), append it after `scripts/phase20-freeze.test.mjs` in root `npm test`, and validate pending-task immutability, done-task assertions, docs/migration tokens, package/dependency count, no unreviewed compatibility removal, and final exit evidence.
    - Performance: freeze test is stdlib-only, deterministic, and completes under five seconds excluding commands whose results are read from baseline evidence.
    - Code Quality: mirror established phase 17–20 manifest/baseline/test shapes; do not add a second release-gate system.
    - Security: source edits outside the five reviewed scopes fail loud; blocker tasks cannot become done while their mapped adversarial tests/docs are absent; protected trust-boundary skips cannot satisfy the exit gate.
  - Approach:
    - Documentation Reviewed:
      - `scripts/phase20-freeze-manifest.json`, `scripts/phase20-baseline.json`, `scripts/phase20-freeze.test.mjs`.
      - `scripts/budgets.json`; `docs/release-and-install.md`; `scripts/compat-baseline/` current state.
    - Options Considered:
      - Rely on plan prose and git review: rejected; phase 17–20 already provide a small machine-checked scope pattern.
      - One phase-21 manifest with five item scopes and one baseline: chosen.
    - Chosen Approach:
      - Capture clean pre-change truth after Task 0; allow implementation only after standalone freeze test passes.
    - API Notes and Examples:
      ```bash
      node --test scripts/phase21-freeze.test.mjs
      node scripts/release.mjs gate --version 0.2.0
      npm audit --audit-level=moderate
      ```
    - Files to Create/Edit:
      - `scripts/phase21-freeze-manifest.json`: scope/security/release gate.
      - `scripts/phase21-baseline.json`: pre-change and exit evidence.
      - `scripts/phase21-freeze.test.mjs`: machine checks.
      - `package.json`: append phase-21 freeze test to `npm test` after `scripts/phase20-freeze.test.mjs`.
      - `plans/README.md`: add plan 021 row as in progress.
    - References:
      - `plans/020-Release-0-2-0-Fail-Closed-Runtime-and-Sandbox-Security.md` Tasks 0 and 1.
  - Test Cases to Write:
    - pending-scope mutation: changing any item-owned file before its task is done fails.
    - unreviewed break: removed declaration or changed package/dependency count fails.
    - missing trust-boundary evidence: a done item with absent test/docs/threat token fails.
    - exit gate discipline: 0.2.1 cannot close with an item skipped or `exitGate.green !== true`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling only.
    - Docs pages to create/edit:
      - `none`: baseline/freeze files are internal release evidence.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; no public docs trigger.

- [x] Task 2 — Make strict completion the shared default for every streaming provider
  - Evidence (Task 2 complete): default flipped in `src/providers/openai-compatible.ts` — both the truncation check and the done-usage carry now use `(options.strictCompletion ?? true)`; the existing explicit `false` stays honored as the documented opt-out (Task 0 decision 1). `src/__tests__/openai-compatible.test.ts` gained the shared-default conformance (default-truncated stream → `error` with "without completion evidence", never `done`; `finish_reason` without `[DONE]` still incomplete; fully terminated stream succeeds with usage on `done`; explicit `false` restores permissive). Docs updated (`docs/providers/openai-compatible.md` option row + outputs row + security note; `docs/index.md` entry). All six inheriting adapters (azure/bedrock/vertex/openrouter/zai/neuralwatt) tighten with zero adapter source edits; the four opt-in adapter files stay untouched (preserved surface). Fixture corrections: simplified `[DONE]`-only mock streams in the azure/bedrock/vertex/neuralwatt package tests and the two docs-gate examples gained `finish_reason` + `[DONE]` terminal chunks (harness-only; deviations 1-2 in `scripts/phase21-freeze-manifest.json` record the example fix and the scope amendment moving those four test files into this task with edge-fix regressions rehomed to new files at Task 6). Full `npm test` green at the flipped default.
  - Acceptance Criteria:
    - Functional: flip `strictCompletion` to default `true` in `openAIChatEvents` and `createOpenAICompatibleProvider` (`src/providers/openai-compatible.ts`) so EOF without the required done marker/finish reason emits a `ProviderTransportError` truncation error and never a successful `providerDone`; the existing `strictCompletion` opt-in on alibaba/kimi/ollama/opencode-go becomes a no-op (still `true`) and azure/bedrock/vertex/openrouter/zai/neuralwatt get the tightening automatically via the shared base.
    - Functional: preserve all valid provider-specific terminal variants — adapters that map a non-OpenAI done marker or compute `finish_reason` via `mapUsage`/`onComment` continue to complete normally; the strict check only rejects absence of both the done marker and a finish reason after stream end.
    - Functional: `doneUsage` continues to control whether final usage rides on `done`; the truncation error path still emits `providerError` with redacted secrets and releases the stream reader.
    - Functional: every first-party streaming adapter's conformance test asserts a truncated stream (EOF before `[DONE]` and before any `finish_reason`) yields `providerError`, zero successful `providerDone`, and no partial output promoted to success; the existing valid-completion, abort, tool-call reconstruction, and cache-usage conformance cases remain green.
    - Performance: the strict check is O(1) stream-state booleans already tracked (`sawDoneMarker`/`sawFinishReason`); no extra I/O, buffering, or parsing.
    - Code Quality: one default change in the shared base; no per-adapter flag proliferation; no new type; `strictCompletion` remains readable for hosts that need to inspect it. If Task 0 approves an explicit opt-out seam, it is a single additive boolean, not a per-adapter config tree.
    - Security: truncated streams cannot be mistaken for complete output; the truncation error carries no tool arguments, prompt content, or credentials; redaction is unchanged.
  - Approach:
    - Documentation Reviewed:
      - `src/providers/openai-compatible.ts` `openAIChatEvents` strict-completion block (lines ~107–150) and `createOpenAICompatibleProvider` options pass-through (line ~211).
      - Per-adapter `strictCompletion: true` sites: `packages/provider-{alibaba,kimi,ollama}/src/provider.ts`, `packages/provider-opencode-go/src/openai-chat.ts`.
      - Per-adapter `openAIChatEvents`/`createOpenAICompatibleProvider` sites without explicit `strictCompletion`: `packages/provider-{azure,bedrock,vertex,openrouter,zai,neuralwatt}/src/provider.ts`.
      - `packages/provider-anthropic/src/messages.ts` and `packages/provider-google/src/generate-content.ts` native streaming completion behavior (these are not OpenAI-compatible and keep their own completion semantics; Task 0 records whether they already enforce completion).
      - `src/__tests__/openai-compatible.test.ts`; `src/__tests__/provider-transport.test.ts`; per-package conformance under `testing/provider-conformance`.
    - Options Considered:
      - Add `strictCompletion: true` to each of azure/bedrock/vertex/openrouter/zai/neuralwatt: rejected; six edits at sibling call sites leave any future OpenAI-compatible adapter exposed by default.
      - Flip the shared default to `true`: chosen; one root-cause change covers all current and future OpenAI-compatible adapters; existing opt-ins become no-ops.
    - Chosen Approach:
      - Make strict completion the shared default; document the truncation error and any approved opt-out in the OpenAI-compatible provider doc.
    - API Notes and Examples:
      ```ts
      // Truncated stream now fails by default:
      const stream = openAIChatEvents(truncatedBody, { signal });
      const events = [];
      for await (const e of stream) events.push(e);
      // last event is providerError(ProviderTransportError) — never providerDone
      ```
    - Files to Create/Edit:
      - `src/providers/openai-compatible.ts`: flip `strictCompletion` default in `openAIChatEvents` and `createOpenAICompatibleProvider`; keep explicit `false` honored if Task 0 approves an opt-out.
      - `packages/provider-{alibaba,kimi,ollama}/src/provider.ts`, `packages/provider-opencode-go/src/openai-chat.ts`: leave the now-redundant `strictCompletion: true` or drop it for clarity (Task 0 decides; behavior identical either way).
      - `src/__tests__/openai-compatible.test.ts`: truncated-stream default-rejection regression.
      - Per-adapter conformance tests under `packages/provider-*/src/__tests__/`: truncated-stream assertion for azure/bedrock/vertex/openrouter/zai/neuralwatt.
      - `docs/providers/openai-compatible.md`: strict-completion default, truncation error, terminal-variant note, security/performance notes.
      - `docs/index.md`: update OpenAI-compatible provider navigation description.
    - References:
      - `roadmap.md` §0.2.1 item 1 and mandatory regression matrix item 5.
      - `src/providers/openai-compatible.ts` strict-completion block.
  - Test Cases to Write:
    - truncated stream (EOF before `[DONE]` and before `finish_reason`): `providerError` with truncation code, zero `providerDone`, no partial text promoted to success.
    - valid completion with `[DONE]` + `finish_reason`: `providerDone` with usage as before.
    - valid completion via `mapUsage`/`onComment` terminal variant: `providerDone` preserved.
    - abort mid-stream: existing abort behavior unchanged (abort error, not truncation error).
    - every first-party OpenAI-compatible adapter conformance: truncated-stream rejection added; valid matrix unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — existing OpenAI-compatible streaming now fails closed on truncation by default.
    - Docs pages to create/edit:
      - `docs/providers/openai-compatible.md`: strict-completion default, truncation error, terminal variants, security/performance notes using the API-page structure.
    - `docs/index.md` update: yes — update the OpenAI-compatible provider entry description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — One dependency-free bounded success-body reader for all non-stream JSON/text endpoints
  - Evidence (Task 3 complete): additive `readBoundedResponseJson<T>(response, options)` added to `src/providers/transport.ts` next to `readBoundedResponseText` — same 65_536-byte ceiling via composition (cancels before full buffering), `maxDepth` default 32, `maxProperties` default 4_096 per object/array, caller-supplied `shape` gate, abort checks, and malformed/over-limit/shape failures throwing `ProviderTransportError` code `response_body_shape` with static text (never body content or secrets). Twelve success-body sites migrated from unbounded `response.json()`: all ten model-discovery implementations, NeuralWatt quota, Alibaba embeddings; per-adapter post-parse validation retained as defense in depth (OpenAI uploads migrates in Task 6 per the manifest scope split). Conformance: `provider-transport.test.ts` bounded success-body reader suite covering all thirteen shapes (ten discovery + quota + embeddings + uploads) with identical-parse and oversized-chunked termination-before-full-buffering (pull-count proof) cases, malformed/empty JSON, depth cap, property/element caps, shape gate pass/fail, abort, and secret-free errors. Docs: `docs/provider-primitives.md` bounded success-body reader API section (signature, performance, security) and `docs/index.md` entry updated. Full `npm test` green (1,488 core tests, up from 1,457). No dependency added; core stays dependency-free.
  - Acceptance Criteria:
    - Functional: add one additive `readBoundedResponseJson` (or equivalent bounded JSON helper) to `src/providers/transport.ts` built on the existing `readBoundedResponseText` byte ceiling plus UTF-8 byte enforcement, JSON depth cap, property-count cap, aggregate-byte cap, a caller-supplied schema-shape check, abort handling, and a redacted `ProviderTransportError` (`response_body_overflow` / `invalid_json_arguments` / a Task-0-approved JSON-shape code). No new dependency; `JSON.parse` with a depth/property walk bounded by the caps.
    - Functional: replace the unbounded `response.json()` in the ten model-discovery implementations (`packages/provider-{alibaba,anthropic,google,kimi,neuralwatt,ollama,openai,opencode-go,openrouter,zai}/src/models.ts`), NeuralWatt quota (`packages/provider-neuralwatt/src/quota.ts`), Alibaba embeddings (`packages/provider-alibaba/src/embeddings.ts`), and OpenAI uploads (`packages/provider-openai/src/uploads.ts`) with the bounded reader; replace the remaining unbounded `response.text()`/`response.json()` OAuth success paths in Task 5.
    - Functional: oversized chunked success bodies terminate before full buffering; the reader cancels the body and throws `response_body_overflow`; normal payloads are byte-for-byte identical to the previous `response.json()` result (same parsed shape, same values).
    - Functional: schema-shape failures (e.g., a model-discovery response without `data` array, a quota response without the expected fields, an uploads response without `id`) fail closed with the JSON-shape error rather than a downstream `undefined` access; existing per-adapter post-parse validation stays as defense in depth.
    - Functional: abort propagation, secret redaction, and the existing `readBoundedResponseText` behavior are unchanged; the new helper composes the existing redact + reader-release logic.
    - Functional: a shared bounds-conformance test exercises the reader against oversized chunked bodies (ten model-discovery shapes + quota + embeddings + uploads) and proves termination before full buffering and identical normal-payload behavior.
    - Performance: the reader is one O(body bytes) pass with a hard byte ceiling; depth/property walks are bounded by caps; near-cap chunked fixtures complete within the existing transport test envelope; peak memory never exceeds the cap plus one chunk.
    - Code Quality: one helper reused by ≥13 call sites; no per-adapter bounded reader; no JSON schema library; the helper is additive and does not change `readBoundedResponseText` callers.
    - Security: oversized upstream bodies cannot exhaust memory or mask a malformed response; errors carry no secret values; aborts are honored.
  - Approach:
    - Documentation Reviewed:
      - `src/providers/transport.ts` `readBoundedResponseText`, `resolveLimits`, `BoundedStreamLimits`, `ProviderTransportError`.
      - The ten model-discovery files and `quota.ts`/`embeddings.ts`/`uploads.ts` `response.json()` sites.
      - `src/__tests__/provider-transport.test.ts` existing bounded-text tests.
      - Node.js `Response.json()`/`Response.text()` streaming semantics and `ReadableStream` reader cancellation.
    - Options Considered:
      - Per-adapter `response.json()` + a size pre-check via `content-length`: rejected; chunked bodies have no `content-length` and per-adapter fixes duplicate the reader 13 times.
      - A new bounded-HTTP package: rejected; the reader belongs in the core transport module every adapter already imports.
      - One additive `readBoundedResponseJson` in the existing transport module: chosen.
    - Chosen Approach:
      - Add the bounded JSON helper next to `readBoundedResponseText`; migrate the 13 success-body sites; keep per-adapter post-parse validation as defense in depth.
    - API Notes and Examples:
      ```ts
      const payload = await readBoundedResponseJson<OpenAIModelsResponse>(response, {
        secrets,
        maxResponseBodyBytes: DEFAULT_MAX_RESPONSE_BODY_BYTES,
        maxDepth: 32,
        maxProperties: 4096,
        shape: (v): v is OpenAIModelsResponse => v && Array.isArray((v as { data?: unknown }).data),
      });
      ```
    - Files to Create/Edit:
      - `src/providers/transport.ts`: additive `readBoundedResponseJson` + JSON depth/property/aggregate caps + shape-check error path.
      - `packages/provider-{alibaba,anthropic,google,kimi,neuralwatt,ollama,openai,opencode-go,openrouter,zai}/src/models.ts`: replace `response.json()` with the bounded reader + shape check.
      - `packages/provider-neuralwatt/src/quota.ts`: replace `response.json()` for quota.
      - `packages/provider-alibaba/src/embeddings.ts`: replace `response.json()` for embeddings.
      - `packages/provider-openai/src/uploads.ts`: replace the success `response.json()` (the error path already uses `readBoundedResponseText`).
      - `src/__tests__/provider-transport.test.ts`: bounded-JSON reader conformance.
      - Per-adapter model-discovery tests: oversized-body and shape-failure regressions.
      - `docs/provider-primitives.md`: bounded success-body reader API, caps, shape check, security/performance notes.
      - `docs/index.md`: update Provider primitives navigation description.
    - References:
      - `roadmap.md` §0.2.1 item 2 ("ten model-discovery implementations and all credential/upload paths pass shared bounds tests").
      - `src/providers/transport.ts` existing bounded-text reader.
  - Test Cases to Write:
    - oversized chunked body: reader cancels and throws `response_body_overflow` before full buffering, for each of the ten model-discovery shapes plus quota/embeddings/uploads.
    - depth/property/aggregate cap: a too-deep / too-wide / too-large JSON fails with the JSON-shape error.
    - shape failure: a model-discovery response missing `data`, a quota response missing fields, an uploads response missing `id` fail closed.
    - normal payload: identical parsed shape and values to the prior `response.json()` result across the 13 sites.
    - abort and redaction: abort propagates; secrets redacted in error messages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive bounded success-body reader used by model discovery, quota, embeddings, and uploads.
    - Docs pages to create/edit:
      - `docs/provider-primitives.md`: bounded success-body reader API page section using the required API-page structure (inputs/outputs/example/security/performance).
    - `docs/index.md` update: yes — update the Provider primitives entry description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Pin outbound DNS/address decisions for OIDC JWKS, OPA, and content fetches
  - Evidence (Task 4 complete): new core module `src/pinned-fetch.ts` lifts MCP's `resolvePinnedAddress` + `requestPinned` + `raceAbort` + `boundResponse` into one `pinnedFetch(url, init, options)` primitive — one resolve per request, 1..32 address bound, family verification, per-candidate `assertSsrfAllowedUrl` before the connect (DNS-rebinding defense; allow-listed hostnames still get private-answer checks — fail closed), a pinned-lookup connect, 3xx rejected outright (new `MediaContentError` code `redirect` + `ErrorOptions` cause support), byte-bounded responses, and abort propagation. Messages are parameterized by `errorPrefix`/`hostnameErrorPrefix` so each caller keeps its taxonomy. Callers re-routed: OIDC JWKS default path (IdentityError taxonomy preserved; oversized JWKS still fails closed as `jwksParse`; redirects surface `jwksFetch` as before), OPA decision fetch (MediaContentError rethrown before `OpaFetchError` wrapping; timeout/retry semantics and `readBoundedBody` gate unchanged), content media fetches (host `fetch`/`resolveHostname`/`requestUrl` seams unchanged; `ssrf_denied`/`fetch_failed` codes preserved), and MCP `createSecureMcpFetch` + `oauthDiscoveryFetch` (byte-identical `McpBridgeError`/`McpOAuthError` wrapping; local copies deleted, helpers re-exported from the `@arnilo/prism` root). `src/index.ts` root exports `pinnedFetch` + the lifted helpers. Tests: new `pinned-fetch.test.ts` covering rebinding (public-then-private resolver rejected), single/mixed private answers, metadata targets, loopback confinement, 3xx rejection without following `Location`, address-count/family bounds, IPv4/IPv6 literals without resolver round trips, in-flight aborts, and content-length/chunked byte bounds; default-path pinning regressions added to oidc/opa tests. Docs updated on all four pages (credential-storage, policy-and-audit, multimodal-content, mcp-tools) plus `docs/index.md`. Deviation 3 records the deliberate `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` update for the 9 new value + 1 type root exports (frozen-surface gate). `egress/dns-pin.ts` untouched (decision 12). Full `npm test` green at the re-routed 0.2.0.
  - Acceptance Criteria:
    - Functional: lift (or expose for reuse) the strongest existing MCP transport resolution/pinning primitive — `resolvePinnedAddress` + `requestPinned` + the `assertSsrfAllowedUrl`/`MediaHostnameResolver`/`MediaHostAddress` composition in `packages/mcp/src/transport.ts` — to a core location Task 0 names (candidate: a small `src/pinned-fetch.ts` or an additive export from the existing `src/content.ts`/`src/providers/transport.ts`), without duplicating the `node:dns/promises`/`node:http`/`node:https`/`node:net` machinery. egress `dns-pin.ts` (`resolvePinned`/`assertPinned`/`isPrivateAddress`/`isMetadataAddress`) is a convergence candidate Task 0 decides; if not converged, it is documented as the proxy-path primitive and left untouched.
    - Functional: route the OIDC JWKS fetch (`packages/credentials-node/src/oidc.ts` `fetchJwks`), the OPA decision fetch (`packages/policy/src/opa.ts` `callOpa`), and the content fetch (`src/content.ts` complete-request media URL fetch) through the shared pinned-fetch primitive so each does: resolve once, connect to a pinned answer, assert the connected socket address belongs to the pinned set, reject private/metadata/loopback (loopback only when the caller allows it), and disable redirects (`redirect: "manual"`) or independently revalidate + repin on any redirect response.
    - Functional: private resolution, mixed public/private answers, metadata targets (`169.254.169.254`, `fe80::/10`), redirects, DNS rebinding (pinned answer swapped at connect), IPv4/IPv6 edge cases, and aborts fail closed with the existing `MediaContentError`/`IdentityError`/`PolicyError`/`EgressError` families (no new error class).
    - Functional: preserve existing OIDC JWKS size/key caps, OPA bundle-revision pinning and retry posture, and content-fetch MIME/aggregation policy; the pin is additive defense, not a replacement for those checks.
    - Functional: MCP transport continues to use the same primitive (now shared) with byte-identical behavior; the MCP conformance suite stays green.
    - Performance: one DNS `lookup` per request (already done by MCP) plus a socket address assertion; O(1) per request, no extra round trip; no change to OIDC/OPA/content latency envelopes beyond the existing `lookup`.
    - Code Quality: one shared pinned-fetch primitive reused by OIDC/OPA/content/MCP; no second pinning primitive; no HTTP framework; the primitive is a function, not a class hierarchy.
    - Security: a URL-string SSRF check alone is no longer the trust boundary; the connected address is verified against pinned answers; redirects cannot rebind to a private target.
  - Approach:
    - Documentation Reviewed:
      - `packages/mcp/src/transport.ts` `resolvePinnedAddress`, `requestPinned` (uses `node:http`/`node:https` `request` with a custom `lookup` that returns the pinned address and a socket address assertion), `createSecureMcpFetch`, `assertSsrfAllowedUrl`, `MediaHostnameResolver`/`MediaHostAddress` (imported from core).
      - `packages/coding-security/src/egress/dns-pin.ts` `resolvePinned`/`assertPinned`/`isPrivateAddress`/`isMetadataAddress`.
      - `src/content.ts` `assertSsrfAllowedUrl`/`SsrfPolicy`/`MediaContentError` and the content fetch path.
      - `packages/credentials-node/src/oidc.ts` `fetchJwks` (already `redirect: "manual"` + `assertSsrfAllowedUrl` + size caps).
      - `packages/policy/src/opa.ts` `callOpa` (already `redirect: "manual"` + `assertSsrfAllowedUrl` + body cap + bundle-revision pin).
      - Node.js v20.20.2 `node:http`/`node:https` `request` `lookup` option and socket `remoteAddress`; `node:net` `isIP`.
    - Options Considered:
      - Leave OIDC/OPA/content on `assertSsrfAllowedUrl` + `redirect: "manual"` only: rejected; a URL-string check cannot defend DNS rebinding or a redirect to a private target that resolves public at check time.
      - Build a new undici-dispatcher-based pin: rejected; MCP already has a stdlib `lookup`-hook pin; lift it.
      - Lift MCP's `resolvePinnedAddress`+`requestPinned` to a shared core primitive and route OIDC/OPA/content/MCP through it: chosen.
    - Chosen Approach:
      - One shared pinned-fetch primitive (stdlib `lookup` hook + socket `remoteAddress` assertion + redirect-manual/revalidate); OIDC/OPA/content adopt it; MCP keeps behavior via the same primitive.
    - API Notes and Examples:
      ```ts
      const response = await pinnedFetch(url, { signal, redirect: "manual", allowLoopback: false, resolver }, ssrfPolicy);
      // throws MediaContentError/IdentityError/PolicyError on private/metadata/rebinding/redirect
      ```
    - Files to Create/Edit:
      - `src/pinned-fetch.ts` (or the Task-0-approved core location): shared pinned-fetch primitive lifted from MCP.
      - `src/content.ts`: route the content fetch through the shared primitive; keep `assertSsrfAllowedUrl` as the URL-string precheck.
      - `packages/credentials-node/src/oidc.ts`: route `fetchJwks` through the shared primitive; keep size/key caps.
      - `packages/policy/src/opa.ts`: route `callOpa` through the shared primitive; keep body cap + bundle-revision pin.
      - `packages/mcp/src/transport.ts`: use the shared primitive (re-export or call) with byte-identical behavior.
      - `src/__tests__/pinned-fetch.test.ts` (or co-located): private/mixed/metadata/redirect/rebinding/IPv4-IPv6/abort matrix.
      - `packages/credentials-node/src/__tests__/oidc.test.ts`, `packages/policy/src/__tests__/opa.test.ts`, content-fetch tests: pinning regressions.
      - `docs/credential-storage.md` (OIDC), `docs/policy-and-audit.md` (OPA), `docs/multimodal-content.md` (content), `docs/mcp-tools.md` (MCP): DNS-pinned fetch behavior, threat model, security/performance notes.
      - `docs/index.md`: update Identity/policy/content/MCP navigation descriptions.
    - References:
      - `roadmap.md` §0.2.1 item 3 and mandatory regression matrix item 7.
      - `packages/mcp/src/transport.ts` `resolvePinnedAddress`/`requestPinned`.
  - Test Cases to Write:
    - private resolution: a hostname resolving to a private IP fails closed before connect.
    - mixed public/private answers: any private answer in the pinned set fails closed (or is filtered per Task 0 decision, recorded).
    - metadata target: `169.254.169.254` and `fe80::` fail closed.
    - redirect: a 3xx response is not followed; revalidation+repin rejects a private Location.
    - DNS rebinding: the socket `remoteAddress` not in the pinned set fails closed.
    - IPv4/IPv6: both families pin and assert correctly.
    - abort: abort propagates and cancels the in-flight request.
    - OIDC/OPA/content/MCP parity: each caller's existing suite stays green with the pin added.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — OIDC JWKS, OPA, and content fetches now DNS-pin and verify the connected address; additive pinned-fetch primitive.
    - Docs pages to create/edit:
      - `docs/credential-storage.md`: OIDC JWKS pinned-fetch section.
      - `docs/policy-and-audit.md`: OPA pinned-fetch section.
      - `docs/multimodal-content.md`: content fetch pinned-fetch section.
      - `docs/mcp-tools.md`: note the now-shared primitive (behavior unchanged).
    - `docs/index.md` update: yes — update Identity and governance, Policy and audit, Multimodal content, and MCP entries to mention DNS-pinned fetch.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Consolidate duplicated OAuth device/token polling and provider parsing
  - Evidence (Task 5 complete): shared core helper `src/oauth-device-code.ts` — `pollDeviceCodeToken` owns the RFC 8628 device-code request, poll loop (`authorization_pending` continue, `slow_down` +5s backoff, expiry deadline), cancellation, bounded success reads (`readBoundedResponseJson` with a fail-closed shape gate: device payload requires `device_code`/`user_code`/`verification_uri` strings, token success requires an `access_token` string), bounded error reads (`readBoundedResponseText` with secret redaction, JSON parse with redacted-text fallback), and token-shape parsing via a caller `parseTokenCredentials` callback (codex: direct `account_id`; oauth2: `account_id ?? config.accountId`). Adapter-specific fields are plain options (`errorPrefix`, `extraTokenParams`, `scope`, `now`/`sleep` seams) — no class hierarchy, no registry. Both callers migrated: provider-openai `oauth.ts` and credentials-node `oauth2.ts` route device flows through the helper and share `throwIfAborted`/`abortableSleep`/`redactOAuthError` re-exported from the core root; each caller's `exchangeToken` (authorization-code/refresh) also migrated from unbounded `response.json()` to `readBoundedResponseJson` + shape gate + bounded redacted error reads, eliminating all six baseline OAuth unbounded sites. `oauth2.ts` keeps revoke/refresh accountId preservation/metadata and its exported PKCE helpers; microsoft365/google-workspace consumers untouched (preserved surface). Tests: both suites cover pending-then-success, slow_down backoff, expiry, abort, terminal-error redaction, and oversized device/token bodies failing closed at the 65,536-byte ceiling (T9), asserting the shared helper directly. Docs: `docs/credentials-and-redaction.md` documents the shared bounded device/token flow; `docs/index.md` entry updated. Deviation 4: `scripts/budgets.json` root fileCount re-baselined 310 → 326 (two new core modules cross the 5% ceiling; packed/unpacked bytes unchanged). Full `npm test` green.
  - Acceptance Criteria:
    - Functional: extract one bounded OAuth device-code/token polling and error-mapping helper shared by `packages/provider-openai/src/oauth.ts` and `packages/credentials-node/src/oauth2.ts`; the helper owns the device-code fetch, the poll loop, `authorization_pending`/`slow_down` interval backoff, expiry, cancellation (abort), bounded success/error body reads (via the Task 3 reader), secret redaction, and token-shape parsing. Provider-specific fields (error prefix, `accountId`, `extraTokenParams`, `config.id` branding) stay at the adapters via a small config/callbacks argument.
    - Functional: do not create a generic transport framework beyond this repeated behavior; the helper is one function (or a small pair), not a class hierarchy or a plugin registry.
    - Functional: authorization-pending, slow-down, expiry, cancellation, malformed JSON, oversized body, secret redaction, and token-shape tests run once against both the OpenAI and `credentials-node` call sites in a shared conformance test; both adapters' existing OAuth suites stay green.
    - Functional: the shared helper uses the Task 3 bounded success-body reader for device-code and token success/error responses, replacing the remaining unbounded `response.json()`/`response.text()` in both OAuth files; `readBoundedResponseText` (already used on error paths) is reused for error bodies.
    - Functional: abort propagation, sleep cancellation, and the existing `redactOAuthError` behavior are preserved; error messages keep provider-specific prefixes.
    - Performance: poll cadence, sleep, and backoff are behavior-equivalent; the shared helper adds no round trip and no extra allocation beyond the existing flow.
    - Code Quality: one helper reused by two call sites; no duplicated poll loop; provider-specific concerns are parameters, not subclasses.
    - Security: secrets (`device_code`, `user_code`, `access_token`, `refresh_token`) are redacted at both call sites via the shared helper; malformed/oversized token responses fail closed; no token is echoed in errors.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-openai/src/oauth.ts` device-code flow, `exchangeToken`, `readTokenErrorPayload`, `parseTokenCredentials`, `redactOAuthError`.
      - `packages/credentials-node/src/oauth2.ts` device-code flow, `exchangeToken`, `readTokenErrorPayload`, `parseTokenCredentials`.
      - `packages/credentials-node/src/microsoft365-oauth.ts`/`google-workspace-oauth.ts` consumers of `oauth2.ts` (ensure the helper signature stays compatible).
      - Task 3 bounded reader API.
      - RFC 8628 device-code grant (`authorization_pending`, `slow_down`, `expired_token`, `access_denied`).
    - Options Considered:
      - Leave the two implementations duplicated: rejected; they already diverge subtly (error-prefix, `extraTokenParams`, `accountId`) and a shared helper removes the drift risk.
      - A generic OAuth framework with strategy objects: rejected; two call sites do not justify a framework.
      - One bounded device/token poll+error helper with adapter-supplied config/callbacks: chosen.
    - Chosen Approach:
      - Extract the shared poll helper into `packages/credentials-node/src/oauth2.ts` (or a Task-0-approved shared internal location importable by `provider-openai` without a new package) and have both adapters call it; keep provider-specific fields as parameters.
    - API Notes and Examples:
      ```ts
      const creds = await pollDeviceCodeToken({
        fetchImpl, deviceCodeUrl, tokenUrl, clientId, extraTokenParams,
        callbacks: { signal, onDeviceCode, sleep, now },
        redactOAuthError, parseTokenCredentials, errorPrefix: "OpenAI device code",
      });
      ```
    - Files to Create/Edit:
      - `packages/credentials-node/src/oauth2.ts`: extract the shared poll/exchange/error helper; keep `OAuth2ProviderConfig` and provider-specific parsing.
      - `packages/provider-openai/src/oauth.ts`: call the shared helper; keep OpenAI-specific error prefix and token fields.
      - Shared conformance test (Task 0 decides location, e.g., a `testing/oauth-conformance` helper or a co-located test): authorization-pending, slow-down, expiry, cancellation, malformed JSON, oversized body, redaction, token-shape — run against both call sites.
      - `packages/credentials-node/src/__tests__/oauth2.test.ts`, `packages/provider-openai/src/__tests__/oauth.test.ts`: adapter parity regressions.
      - `docs/credential-storage.md`: shared OAuth device/token flow, provider-specific fields, security/performance notes.
      - `docs/credentials-and-redaction.md`: cross-link the shared helper.
      - `docs/index.md`: update Credentials navigation description.
    - References:
      - `roadmap.md` §0.2.1 item 4.
      - `packages/provider-openai/src/oauth.ts`; `packages/credentials-node/src/oauth2.ts`.
  - Test Cases to Write:
    - authorization_pending: poll continues until success.
    - slow_down: interval backoff applied, poll continues.
    - expiry: login expired error after `expires_in`.
    - cancellation: abort rejects the poll promptly.
    - malformed JSON: device-code/token error response fails closed with redacted error.
    - oversized body: device-code/token response aborts via the bounded reader.
    - secret redaction: `device_code`/`user_code`/`access_token`/`refresh_token` never appear in errors.
    - token shape: missing `access_token` fails closed; both adapters parse their provider-specific fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no public API change (shared helper is internal); behavior equivalent. Documentation updates describe the shared flow for hosts.
    - Docs pages to create/edit:
      - `docs/credential-storage.md`: shared OAuth device/token flow section using the API-page structure where it documents the public OAuth connector behavior.
      - `docs/credentials-and-redaction.md`: cross-link note.
    - `docs/index.md` update: yes — update the Credentials and redaction / Credential storage entries to mention the shared bounded device/token flow.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Fix credential, signing, upload, and cache edge cases
  - Evidence (Task 6 complete): four single-site root-cause fixes, no public type change. (1) Credential-once — azure/vertex wrappers resolve the `CredentialValueSource` exactly once per request (`resolveCredentialValue as resolveOnce`) and inject the resolved token as a fixed string into a per-request `createOpenAICompatibleProvider` instance; rotating/single-use tokens are never consumed twice, missing-credential fail-closed behavior and messages preserved, each request re-resolves. (2) Bedrock `sigv4.ts` — caller headers normalized once (lowercase names, duplicate-case keys merged last-wins) before reserved-name filtering and canonicalization, removing the old duplicate-lowercase-key `.find` ambiguity; `canonicalQuery` sorts by encoded key then encoded value per AWS; single-case/single-key inputs stay byte-identical (existing fixtures green). (3) OpenAI `uploads.ts` — unbounded `response.json()` replaced by `readBoundedResponseJson` with a fail-closed id shape gate; cleanup retains file IDs until the DELETE succeeds (id removed only after a successful DELETE, so a failed/skipped DELETE leaves it registered and a retried cleanup still removes the remote file). (4) `cache-telemetry.ts` — the `__overflow__` bucket never carries cost: `estimatedSavings`/`currency` unset there (one model's cost never applied to mixed-model tokens); capped per-model samples keep their own cost. Regressions (T10–T13): new `credential-once.test.ts` (azure + vertex; rotating source resolved exactly once per request, re-resolved per request), `sigv4-canonical.test.ts` (duplicate-case last-wins merge with a single `x-test` in SignedHeaders, repeated-query key-then-value determinism, single-case byte-identical), `openai.test.ts` failed-DELETE retention (500 → retried cleanup 200 → no third attempt), `cache-telemetry.test.ts` mixed-model overflow cost absence. Docs: `providers/azure.md`/`providers/vertex.md` credential-once notes, `providers/bedrock.md` duplicate-case canonicalization, `provider-caching.md` overflow tokens-only, `docs/index.md` entries (marker 'credential once'). Env fix: `pinned-fetch.test.ts` IPv6-literal case now serves a local response instead of asserting connect-refused (the host has a `:8080` listener). Full `npm test` green (core 1,497, script gates 255/255).
  - Acceptance Criteria:
    - Functional: Azure (`packages/provider-azure/src/provider.ts`) and Vertex (`packages/provider-vertex/src/provider.ts`) resolve `options.credential` exactly once per request. The current double resolution (outer wrapper `resolveCredentialValue` plus the inner `createOpenAICompatibleProvider` `apiKey` source) becomes a single resolution whose result is injected as a fixed string into the inner provider for that request; rotating and single-use tokens get a fresh value per request without double consumption. Missing-credential fail-closed behavior and error messages are preserved.
    - Functional: Bedrock `signAwsRequest` (`packages/provider-bedrock/src/sigv4.ts`) canonicalizes duplicate-case headers (lowercase the signed header names, merge duplicate-case keys to a single value with a documented last-wins/first-wins rule Task 0 picks, so `Content-Type` and `content-type` cannot produce two canonical entries or a first-match `.find` mismatch) and sorts repeated query parameters by key then value (so `?a=2&a=1` canonicalizes deterministically and matches AWS). Existing single-key query and single-case header fixtures remain byte-identical in signature.
    - Functional: OpenAI upload cleanup (`packages/provider-openai/src/uploads.ts`) retains a file ID whose DELETE fails (network/non-2xx) so a subsequent cleanup retry can delete it; an ID is removed from the retention set only after a successful DELETE. The retention set is bounded by the existing upload cache cap; a best-effort retention list is exposed for retry without leaking IDs into logs/errors.
    - Functional: cache telemetry overflow (`src/cache-telemetry.ts`) never applies one model's `cost` to another model's tokens in the `__overflow__` bucket. Per Task 0's decision, either the overflow bucket records no cost (cost stays on the distinct per-model samples before they overflow) or it carries a per-record cost flag that cannot bleed across models; the `__overflow__` aggregate reports token totals only, with cost attribution documented as not-mixed.
    - Functional: rotating/single-use credential fixtures, SigV4 duplicate-case/repeated-query fixtures, upload failed-DELETE retry fixtures, and mixed-model overflow fixtures produce deterministic correct results; all existing Azure/Vertex/Bedrock/OpenAI-upload/cache-telemetry tests stay green.
    - Performance: each fix is O(1) or O(existing) with no new allocation pattern; the cache-telemetry fix adds no cardinality; the upload retention set is bounded by the existing cap.
    - Code Quality: each fix is at its single root-cause call site; no new abstraction, no shared helper for one consumer; no public type change.
    - Security: no credential is consumed twice; no signature mismatch enables a bypass; no uploaded file leaks permanently on a failed DELETE; no cost misattribution misleads a host budget decision.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-azure/src/provider.ts` and `packages/provider-vertex/src/provider.ts` credential wrapper + `createOpenAICompatibleProvider` `apiKey` source resolution.
      - `packages/provider-bedrock/src/sigv4.ts` header merge, `.find` canonical-headers, and `url.searchParams` sort.
      - `packages/provider-openai/src/uploads.ts` `uploadedIds`/`cleanup` clear-before-delete.
      - `src/cache-telemetry.ts` `bucket`/`sampleFor`/`record` overflow + `model?.cost` application.
      - AWS SigV4 canonical request spec (canonical headers lowercase trimmed; canonical query sorted by name then value).
    - Options Considered:
      - Azure/Vertex: resolve in the outer wrapper and pass a fixed-key inner — chosen; versus remove the outer resolution — rejected (loses the early fail-closed missing-credential error).
      - Bedrock headers: lowercase-and-merge before signing — chosen; versus reject duplicate-case input — rejected (callers may pass mixed case legitimately).
      - Upload cleanup: retain-on-failed-DELETE — chosen; versus a background sweep — rejected (no background service in Prism).
      - Cache overflow: drop cost on the overflow bucket — chosen (simplest, matches "tokens only"); Task 0 may pick a per-record flag if a host needs per-model overflow cost.
    - Chosen Approach:
      - Four single-site root-cause fixes; each preserves existing behavior on the non-edge path.
    - API Notes and Examples:
      ```ts
      // Azure/Vertex: resolve once, inject fixed token for the request
      const token = await resolveCredentialValue(options.credential, { provider: id, name: "credential" });
      if (!token?.trim()) { yield providerError(new Error("… credential missing"), []); return; }
      yield* inner.generate({ ...request, options: { ...request.options, apiKey: token } }); // or equivalent single-resolve injection
      ```
    - Files to Create/Edit:
      - `packages/provider-azure/src/provider.ts`: single credential resolution per request.
      - `packages/provider-vertex/src/provider.ts`: single credential resolution per request.
      - `packages/provider-bedrock/src/sigv4.ts`: lowercase/merge duplicate-case headers; sort repeated query by key then value.
      - `packages/provider-openai/src/uploads.ts`: retain failed-DELETE IDs; remove only on success; bounded retention set; retry hook.
      - `src/cache-telemetry.ts`: overflow bucket no longer mixes model costs (drop cost or per-record flag per Task 0).
      - `packages/provider-azure/src/__tests__/azure.test.ts`, `packages/provider-vertex/src/__tests__/vertex.test.ts`, `packages/provider-bedrock/src/__tests__/{sigv4,bedrock}.test.ts`, `packages/provider-openai/src/__tests__/uploads.test.ts`, `src/__tests__/cache-telemetry.test.ts`: edge-case regressions.
      - `docs/providers/{azure,bedrock,vertex}.md`, `docs/provider-caching.md`: credential-once, signing canonicalization, upload-retry, overflow-cost notes.
      - `docs/index.md`: update affected provider and caching navigation descriptions.
    - References:
      - `roadmap.md` §0.2.1 item 5 and mandatory regression matrix items 10–11.
      - `packages/provider-bedrock/src/sigv4.ts`; `src/cache-telemetry.ts`.
  - Test Cases to Write:
    - Azure/Vertex rotating token: a per-call rotating token is consumed exactly once per request; a single-use token is not spent twice; missing token fails closed.
    - Bedrock duplicate-case headers: `Content-Type` + `content-type` produce one canonical header and a signature matching AWS.
    - Bedrock repeated query: `?a=2&a=1` canonicalizes sorted by key then value; signature matches AWS.
    - Bedrock existing fixtures: single-key query and single-case header signatures remain byte-identical.
    - OpenAI upload failed DELETE: a failed DELETE retains the ID; a retry cleanup deletes it; a successful DELETE removes it; retention set stays bounded.
    - Cache telemetry overflow: two models with different costs overflowing into `__overflow__` report correct per-model cost on their distinct pre-overflow samples and no mixed cost on the overflow bucket.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — credential-once, signing canonicalization, upload-retry, and overflow-cost behavior change (no public type change).
    - Docs pages to create/edit:
      - `docs/providers/azure.md`, `docs/providers/vertex.md`: credential resolved once per request.
      - `docs/providers/bedrock.md`: duplicate-case/repeated-query signing canonicalization.
      - `docs/provider-caching.md`: overflow cost attribution is not mixed.
    - `docs/index.md` update: yes — update Azure/Vertex/Bedrock provider entries and the Provider caching entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Public-JavaScript, packed-consumer, and named threat-suite regressions
  - Evidence (Task 7 complete): `scripts/phase21-security.test.mjs` — 10 conformance tests through built public package entrypoints only (workspace dist via package exports, no private source imports): T1/T2/T14 truncated-stream rejection under the strictCompletion shared default (direct `createOpenAICompatibleProvider` + explicit `strictCompletion: false` opt-out + all six inheriting adapters via their public constructors); T3 bounded success bodies (`listOpenAIModels` oversized body → `response_body_overflow`; over-deep/over-wide/shape-gate → `response_body_shape`; bounded payload parses); T4–T6 pinned fetch (private/metadata answers → `ssrf_denied`, single-resolve rebinding defense proven with a local loopback server and `resolverCalls === 1`, 3xx rejected as code `redirect` with the Location target never fetched, loopback without `allowLoopback` fails closed); T7–T9 `pollDeviceCodeToken` (slow_down +5000 backoff sleeps [1000, 6000], expiry fails closed, terminal error redacts `device_code`/`user_code` with `[REDACTED]`); T10 azure rotating credential consumed exactly once per request; T11 `signAwsRequest` duplicate-case last-wins with `x-test` signed exactly once and query-order-independent signature; T12 upload cleanup fail-soft through the public provider seam (4MiB+1 file uploads, failed DELETE never breaks the stream and the file id never leaks into events; ID-retention semantics stay source-level in Task 6's `openai.test.ts` since the manager is not a public export); T13 overflow cost not mixed; gate accounting asserts all 9 blocker IDs ran (none skipped). Wired into `security:threat-suites` (42/42 across phase8–11 + phase20 + phase21). `src/__tests__/install-smoke.test.ts` gains the packed plain-JS `security21.mjs` consumer (marker `phase21`): truncated stream rejects, oversized discovery-shaped body aborts with `response_body_overflow`, pinned fetch private-answer `ssrf_denied`, device-code poll redacts secrets, overflow cost not mixed — all against freshly installed tarballs with no TS compiler; install-smoke suite 8/8. Full `npm test` green (core 1,498/1,498, script gates 255/255, freeze 24/24).
  - Acceptance Criteria:
    - Functional: add a named phase-21 trust-boundary conformance test using built public package entrypoints (not private source imports) covering all five items: truncated-stream rejection across OpenAI-compatible adapters, bounded success-body termination on oversized discovery/quota/upload/oauth bodies, DNS-pinned fetch rejection of private/metadata/rebinding/redirect for OIDC/OPA/content, shared OAuth poll error/redaction behavior, and the four item-5 edge fixes (credential-once, Bedrock duplicate-case/repeated-query signing, upload failed-DELETE retry, overflow cost non-mixing).
    - Functional: extend the fresh packed-install smoke (`src/__tests__/install-smoke.test.ts`) with a plain `.mjs` consumer that proves: a truncated OpenAI-compatible stream rejects without TypeScript, an oversized discovery body aborts, a private-address JWKS/OPA/content fetch fails closed, a device-code poll redacts secrets, and an overflow cache-telemetry report does not mix model costs — all against installed tarballs without a TS compiler.
    - Functional: wire phase-21 conformance into `security:threat-suites` (append `scripts/phase21-security.test.mjs`); verify the standalone build prerequisite (npm test builds before phase scripts; release.yml runs `security:threat-suites` after `npm test`).
    - Functional: preserve the existing install-smoke all-package imports/composition journey and package tarball checks; no network fetch beyond the current local-tarball install fallback.
    - Performance: focused conformance stays under fifteen seconds after build; the packed test adds one consumer execution without repacking; no duplicated full install fixture.
    - Code Quality: reuse the existing install-smoke staging/consumer harness and Node `node:test`; do not create a second pack/install framework.
    - Security: tests assert absence and fail-closed behavior, not redacted placeholders; secret canaries never print into logs/artifacts; any item failure is a hard failure, never a skip.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/install-smoke.test.ts` pack/install/public-import harness.
      - `scripts/phase8-conformance.test.mjs` … `phase11-conformance.test.mjs` and `scripts/phase20-security.test.mjs`; root `security:threat-suites`.
      - `.github/workflows/release.yml`, `security.yml`, `sandbox-browser.yml`.
      - `docs/release-and-install.md` packed consumer and protected evidence expectations.
    - Options Considered:
      - Type-only fixtures: rejected; the original trust-boundary gaps are runtime-only.
      - A new standalone pack harness: rejected; would double release time and drift.
      - Extend the existing packed consumer and add one focused built conformance suite: chosen.
    - Chosen Approach:
      - Test source-level details in Tasks 2–6, public built entrypoints here, and all packed exports in the existing install-smoke lifecycle.
    - API Notes and Examples:
      ```bash
      npm run build
      node --test scripts/phase21-security.test.mjs
      npm run security:threat-suites
      node --test dist/__tests__/install-smoke.test.js
      ```
    - Files to Create/Edit:
      - `scripts/phase21-security.test.mjs`: focused public-entry trust-boundary conformance.
      - `src/__tests__/install-smoke.test.ts`: packed plain-JavaScript regression inside the existing consumer.
      - `package.json`: append phase-21 conformance to `security:threat-suites`.
      - `scripts/phase21-baseline.json`: reserve final evidence fields; values recorded only in Task 8.
    - References:
      - Mandatory regression matrix items 5–7 and 10–11 in `roadmap.md`.
      - `src/__tests__/install-smoke.test.ts` fresh offline tarball consumer.
  - Test Cases to Write:
    - built public core: truncated OpenAI-compatible stream rejects with no `providerDone`.
    - built bounded reader: oversized discovery/quota/upload/oauth body aborts before buffering.
    - built pinned fetch: private/metadata/rebinding/redirect OIDC/OPA/content fetch fails closed.
    - built OAuth: device-code poll redacts secrets and handles pending/slow-down/expiry.
    - built edge fixes: credential-once, Bedrock duplicate-case/repeated-query signing, upload failed-DELETE retry, overflow cost non-mixing.
    - packed plain JS: same five assertions after local tarball install with no TS compiler.
    - gate accounting: phase-21 tests cannot be skipped and report all five item IDs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior — executable verification of Tasks 2–6.
    - Docs pages to create/edit:
      - `none`: public behavior docs belong to Tasks 2–6; release evidence is recorded in Task 8.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; verification-only task.

- [x] Task 8 — Migration/docs finalization, 0.2.1 bump, and fail-loud exit gate
  - Evidence (Task 8 complete): version bumped 0.2.0 → 0.2.1 across all 50 manifests + lockfile (`node scripts/release.mjs bump --from 0.2.0 --to 0.2.1`) with version-sensitive tests updated (cli-provider-add, docs, index, packaging, install-smoke tarball names, 16 package peer-pin tests) and `src/index.ts` version const; plain compat gate at 0.2.1 reviewed — the only deltas were the version literal and `@arnilo/prism-mcp` transport helpers becoming re-exports of the lifted core primitives (same names/signatures, no removal) — then `--update-baseline` refresh and plain gate green with zero breaking deltas, no `--allow-break`; `docs/migration.md` `0.2.0 → 0.2.1` section (all five tightenings with before/after semantics, plain-JS examples, store compatibility, rollout order, rollback-risk warning); root CHANGELOG + 17 affected package changelogs; `docs/index.md` current-release line (0.2.1); `docs/release-and-install.md` `0.2.1 publish handoff` with protected-evidence procedure; roadmap five 0.2.1 items marked [x]; plans/README 021 row `complete`. Full gates: `npm test` exit 0 (core 1,498/1,498, script gates 255/255 incl. phase21-freeze 24/24), `security:threat-suites` 42/42, `sdk:ready` exit 0, audit 0 vulnerabilities at moderate, secret scans zero findings, pack dry-run 50/50 twice byte-identical, budget gates green, Node 20 (v20.20.2) packed imports pass, release gate at 0.2.1 clean (50 packages, 0 errors). Protected OIDC/OPA evidence (never a skip): live `createOidcIdentityVerifier` against real Microsoft AAD JWKS (`login.microsoftonline.com/common/discovery/v2.0/keys`, real DNS/TLS, 200 fetch + parse, key-lookup miss `ERR_PRISM_OIDC_JWKS_KEY_MISSING` after the pinned fetch) and live OPA in docker (`openpolicyagent/opa` decision endpoint 200 + policy pushed) proving the default pinned path fails closed `ssrf_denied` against a real server. Exit gate recorded green in `scripts/phase21-baseline.json.exitGate` with command/version/platform/counts/hashes/compatibility deltas/protected evidence; phase-21 freeze done-state passes 24/24. Cross-phase accommodation: `scripts/phase20-freeze.test.mjs`'s shared-file state machine now accepts version-literal markers at the phase release version OR the current root version (the 0.2.1 bump legitimately advanced package.json/index.ts/lockfile/docs away from the phase-20 `0.2.0` literal; the phase-20 manifest record stays untouched at `0.2.0` — phases 17–19 had no version-literal markers and needed no amendment).
  - Acceptance Criteria:
    - Functional: add a `docs/migration.md` section for 0.2.0 → 0.2.1 covering strict-completion defaulting and the truncation error, bounded success bodies and the caps, DNS-pinned OIDC/OPA/content fetch and the redirect posture, shared OAuth parsing (no public change), and the four item-5 edge fixes (credential-once, Bedrock signing canonicalization, upload failed-DELETE retry, overflow cost non-mixing) with before/after semantics, plain-JavaScript examples, store-compatibility statement, rollout order, and rollback-risk warning.
    - Functional: update root and affected package changelogs/READMEs, `docs/index.md`, `docs/release-and-install.md`, and roadmap 0.2.1 checkboxes only after Tasks 0–7 pass. Documentation must not claim a second DNS-pin primitive, a generic transport framework, or any 0.3.x capability.
    - Functional: run `node scripts/release.mjs bump --from 0.2.0 --to 0.2.1` across all 50 manifests/lockfile and update version-sensitive tests, exact internal peer pins, tarball names, and release docs.
    - Functional: run a plain pre-refresh compatibility gate and review every delta. Additive exports (`readBoundedResponseJson`, the shared pinned-fetch primitive name, the shared OAuth helper if exported) and the version literal are the only expected deltas; no removal is planned. Any unexpected breaking declaration halts release and requires a recorded plan/manifest amendment before `--allow-break`. Refresh affected baselines only after review, then require the normal gate green.
    - Functional: run focused tests, `npm run security:threat-suites`, protected provider/identity/policy matrix, `npm run sdk:ready`, full audit, tracked/unpacked secret scans, pack dry-run twice byte-identical, budget/benchmark gates, Node 20 packed imports, and the release gate. No trust-boundary item may be skipped; missing protected environment records 0.2.1 as blocked.
    - Functional: record command, version, platform, counts, hashes, skips/blocks, compatibility deltas, package/dependency graph, protected evidence, and `green` in `scripts/phase21-baseline.json.exitGate`; the phase-21 freeze done-state passes.
    - Performance: root and affected package sizes remain in budget; the bounded reader and pinned fetch add no measurable benchmark regression.
    - Code Quality: typecheck, Biome lint/format, unused sweep review, docs semantic tests, public export tests, and diff checks pass; plan checkboxes, files, tests, compromises, and further actions reflect actual implementation.
    - Security: audit reports zero policy violations; secret scans report zero findings; packed JS and threat suites pass; provider/identity/policy protected evidence is present; signed tag/provenance remain operator-gated after clean protected CI.
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` 0.1.7 → 0.2.0 structure.
      - `docs/release-and-install.md`; `docs/index.md`; root/package changelogs.
      - `roadmap.md` release validation checklist and 0.2.1 mandatory regressions.
      - `plans/020` Task 6 compatibility review and exit-gate pattern.
      - `.github/workflows/{release,security,sandbox-browser}.yml`.
    - Options Considered:
      - Release after unit tests with protected provider/identity/policy evidence optional: rejected; trust-boundary items are release blockers and cannot close on a skip.
      - Skip the additive export baselines: rejected; additive exports still need a reviewed compat-baseline refresh.
      - Scripted bump, reviewed normal compatibility gate, complete protected evidence, operator publication: chosen.
    - Chosen Approach:
      - Finalize migration first, bump once, review declarations, run all gates, record immutable evidence, then hand off signed tag/publication.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.2.0 --to 0.2.1
      npm run security:threat-suites
      npm run sdk:ready
      npm audit --audit-level=moderate
      git ls-files -z | xargs -0 node scripts/scan-secrets.mjs
      node scripts/release.mjs gate --version 0.2.1
      ```
    - Files to Create/Edit:
      - `docs/migration.md`: 0.2.0 → 0.2.1 trust-boundary migration.
      - `docs/release-and-install.md`: 0.2.1 protected evidence and publish handoff.
      - `docs/index.md`: current release and final navigation verification.
      - `CHANGELOG.md`: 0.2.1 trust-boundary release.
      - Affected package READMEs/CHANGELOGs (provider-*, credentials-node, policy, coding-security if converged): shipped behavior.
      - `package.json`, all workspace manifests, `package-lock.json`: scripted 0.2.1 bump.
      - `src/index.ts`, release/install/packaging/docs/public-export tests, package pin tests: version-sensitive updates.
      - `scripts/compat-baseline/*`: reviewed additive/version baseline refresh only.
      - `scripts/phase21-baseline.json`: complete exit evidence.
      - `scripts/phase21-freeze-manifest.json`: final task/evidence tokens; deviations only if actually required.
      - `roadmap.md`: mark the five 0.2.1 items complete after all gates pass.
      - `plans/021-...md`: close tasks and fill actual compromises/further actions.
      - `plans/README.md`: status complete only after exit gate.
    - References:
      - `plans/020-Release-0-2-0-Fail-Closed-Runtime-and-Sandbox-Security.md` Task 6.
      - `plans/019-Release-0-1-7-Performance-and-DX.md` Task 6.
  - Test Cases to Write:
    - migration semantic tripwire: docs contain old/new strict-completion, bounded-body, pinned-fetch, OAuth, and item-5 examples.
    - compatibility sequence: plain pre-refresh delta reviewed; plain post-refresh gate green; unexpected removal blocks.
    - release accounting: all tests/skips/protected environments named; any missing phase-21 item evidence makes `green: false`.
    - package truth: 50 manifests, versions/peers/lockfile consistent, zero new dependency names, deterministic tarballs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — publishes migration and release truth for all five changed boundaries.
    - Docs pages to create/edit:
      - `docs/migration.md`: mandatory 0.2.1 migration.
      - `docs/release-and-install.md`: protected gate and operator handoff.
      - `CHANGELOG.md` and affected package changelogs: shipped behavior.
      - Task 2–6 docs: final semantic verification and corrections only.
    - `docs/index.md` update: yes — current release plus final Provider primitives, OpenAI-compatible, Identity/policy/content/MCP, Credentials, and Caching navigation descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Strict `strictCompletion` semantics are enforced at the shared `openai-compatible.ts` level; per-adapter truncated-stream conformance runs at Task 7's built public-entrypoint suite rather than inside each adapter's unit tests, and the four pre-existing adapter opt-ins (alibaba/kimi/ollama/opencode-go) stay byte-identical no-ops (no per-adapter flags added; explicit `strictCompletion: false` is the single documented opt-out).
- The pinned-fetch trust boundary is DNS pinning plus outright 3xx rejection; the roadmap's "independently revalidated and repinned" redirect branch was not built (Task 0 decision 6) — a redirected fetch is never followed, so there is nothing to revalidate. The egress `dns-pin.ts` proxy-path primitive is deliberately NOT converged (Task 0 decision 12); convergence stays a 0.3.x candidate until a third direct-connect egress consumer appears.
- OPA protected evidence is live-server fail-closed proof (real `openpolicyagent/opa` in docker; the default pinned path refuses its private address with `ssrf_denied`): no public-address OPA endpoint exists from this host, so a live decision-success run through the default path is impossible by design; decision-success behavior is covered by the built public conformance suite. This is recorded as protected evidence, not a skip, and the evidence block in `docs/release-and-install.md` names the exact procedure.
- `@arnilo/prism-mcp` keeps its transport helpers as re-exports of the lifted core primitives (same names/signatures) rather than re-declaring local wrappers, which shows as a changed-signature compat delta (extractor sees re-export statements) — reviewed, recorded, and refreshed into the 0.2.1 compat baselines; no declaration was removed.
- Upload failed-DELETE retention is asserted source-level in task6's `openai.test.ts` and behaviorally via the public seam (fail-soft, no file-id leak) in the built/packed suites; `createOpenAIFileUploadManager` is not a public export, so strict retention semantics cannot be asserted through a packed consumer without widening the public surface.
- The cache `__overflow__` bucket reports requests and token totals only; per-model overflow cost attribution was rejected (cardinality concerns, no host demand) and remains out of scope.

## Further Actions

- (0.3.0) Protected live-canary matrix: real OIDC IdP + OPA + S3 endpoints in a named protected CI profile so the OIDC/OPA protected evidence gate can run decision-success paths against public endpoints without an operator-side docker/localhost workaround. Priority high — it removes the only manual step from the 0.2.1 exit gate.
- (0.2.3) Make skipped protection visible: release summaries must name every skipped live/protected suite and mark required environments blocked, so the 33 protected/live skips (incl. provider live tests needing API keys) are auditable at a glance.
- (0.3.x) Egress `dns-pin.ts` convergence onto the shared pinned-fetch primitive if a third direct-connect egress consumer appears (Task 0 decision 12).
- (0.3.x) Per-model `__overflow__` cost attribution if a deployment reports a need for overflow cost estimates; requires a documented cardinality strategy first.
- (Demand-gated) A public upload-manager seam on `@arnilo/prism-provider-openai` so cleanup-retention semantics become packed-consumer assertable; not needed until a host asks for it.