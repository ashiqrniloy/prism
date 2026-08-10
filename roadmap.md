# Prism Roadmap

Updated: 2026-08-09
Baseline: `@arnilo/prism` **0.1.0** (Phase 12 release-candidate hardening; signed tag `v0.1.0` exists; npm OIDC publication remains an explicit operator action).
Scope: a forward-looking roadmap split into a **0.1.x** stabilization/provider line and a **0.2.0** new-module line. This document fully replaces the prior phase-by-phase roadmap; completed phase evidence is preserved in `plans/001`–`plans/012`, `CHANGELOG.md`, and `docs/review-coverage-*`.

## Objectives

- Stabilize and harden the 0.1.0 surface: close the residual correctness, lifecycle, and tooling defects found in the post-0.1.0 review without widening the public contract on the patch line.
- Grow the **provider** catalog on the 0.1.x patch line (model providers only) and keep the dependency-free core, explicit-activation, and additive-only patch promises intact.
- Land **new modules** in 0.2.0 only, each behind a numbered plan with primitive review, threat model, measurable acceptance criteria, and an operational owner.
- Make Cursor and Antigravity integrations honest: evaluate whether each can be used **for models only** vs. as a full delegated agent, and integrate accordingly.
- Convert every compromise and deferred further-action recorded across `plans/001`–`plans/012` into either a closed entry, a 0.1.x hardening task, or a 0.2.0 candidate with explicit demand gates.
- Preserve Prism as a host-owned harness: no hosted product, no control plane, no second runtime, no implicit activation.

## Expected Outcome

- 0.1.x releases ship only fixes, provider additions/enrichment, and doc/tooling hardening; every change is additive or non-breaking against the frozen `docs/public-contracts.md` 0.1.x surface, or carries a tested migration/refusal path.
- New model providers added in 0.1.x reuse `createOpenAICompatibleProvider` (or the equivalent Anthropic/Google base) so each is a thin package with conformance + budget gates, not a bespoke runtime.
- 0.2.0 ships new capability packages (delegated coding-agent adapters, Cedar/object-store/pagination adapters, durable ACP session store, native sandbox backend, document readers, build/CI hardening) only after primitive review and per-package plans.
- Cursor and Antigravity are integrated as **delegated coding-agent adapters** (not model providers), because neither SDK exposes a model-only seam; the model-only pattern (proven by `@arnilo/prism-provider-ai-sdk`) is documented as unavailable for them and not forced.
- Every deferred compromise from the 0.0.x phase plans is either closed with evidence, rolled into a 0.1.x task, or gated behind 0.2.0 demand.
- All default and protected release gates keep passing from a clean checkout; `npm audit --audit-level=moderate` stays at 0; the public API compat baseline stays green.

## Current Baseline and Review Findings (2026-08-09)

The codebase was reviewed end to end after the 0.1.0 cut. Findings below are the basis for the 0.1.x and 0.2.0 work. Strengths are preserved; defects and opportunities drive the milestones.

### Existing strengths to preserve

- **Dependency-free core** with explicit activation: no provider, tool, credential, MCP server, LSP, process, network proxy, OIDC, policy, or object-store service starts by import or discovery.
- **Neutral seams** that make adapters cheap: `AIProvider.generate(): AsyncIterable<ProviderEvent>`, `RealtimeSession`, `AgentEventSource`, `ToolEffectStore`, `PolicyEvaluator`, `IdentityVerifier`, `ArtifactBodyStore`, `AgentLoopStrategy` snapshot/restore, pending-decision/approval contract, `SkillRegistry` + progressive disclosure.
- **OpenAI-compatible base reused** by alibaba, opencode-go, openrouter, zai, kimi, neuralwatt; **`@arnilo/prism-provider-ai-sdk`** wraps the Vercel AI SDK `LanguageModelV4` *model interface only* and ignores its agent harness — the proof that model-only adapters are possible when an SDK separates model from loop.
- **Conformance-helper packages** (`testing/*-conformance`) keep adapter tests dependency-free and runner-agnostic; per-package suites own their coverage.
- **Security posture**: deny-by-default sandbox/egress, atomic same-filesystem write/edit, literal-only repository search (no ReDoS), redaction at every boundary, audience-bound OAuth tokens with SSRF-checked discovery, hand-rolled SigV4 over native fetch (no `@aws-sdk/client-s3` bloat), supply-chain negative fixtures, `npm audit` clean (0 vulns, 317 locked deps at 0.1.0), CodeQL/SAST, npm provenance.
- **Deliberate minimalism** is disciplined: `ponytail:` comments consistently name the ceiling and upgrade path of each shortcut; no speculative abstractions or single-implementation interfaces were introduced.
- **Budget/benchmark gates** per release with frozen p95 ceilings and a single 0.1.0 envelope (`scripts/benchmark-0.1.0.mjs`/`.json`).
- 48 publishable manifests (49 graph entries incl. root), four umbrella profiles (`prism-base`, `prism-code`, `prism-sdk`, `prism-all`, `prism-providers`).

### Architectural problems needing fixing

1. **Umbrella provider membership is inconsistent.** `@arnilo/prism-providers` ships 11 providers but omits `provider-azure`, `provider-bedrock`, `provider-vertex` (those live only in `@arnilo/prism-all`). `@arnilo/prism-all` omits `provider-opencode-go` from its provider set. The split is undocumented and surprises hosts. → 0.1.x: unify membership or document the split; prefer one rule (e.g., `prism-providers` = every first-party model provider; `prism-all` = providers + every capability package).
2. **`src/agents.ts` (2,565 lines) and `src/contracts.ts` (2,541 lines, ~250 exports) are god-modules.** They are cohesive but hard to navigate and limit tree-shaking. → 0.2.0: split by concern (run lifecycle / approval / dispatch / fingerprint; contracts vs run-state vs protocol payloads) behind **barrel re-exports that preserve the public import surface** so the compat baseline stays green.
3. **Build clean races itself.** `npm run build` runs `clean` then `build:core` then `build --workspaces`; concurrent `npm test`/`build` invocations can delete `dist/` mid-run (noted in plans 007/008 as "release verification must be single-flight"). This is a real footgun beyond release. → 0.1.x: remove `clean` from `build`, rely on `tsc --build` incrementality + a dedicated `clean` script; or gate builds with a single-flight lockfile.
4. **Headline coverage gate is core-only.** The aggregate coverage gate excludes `packages/**` and `examples/**` (plan 010 compromise). Per-package suites exist, but the headline number overstates total coverage. → 0.1.x: surface a combined coverage summary in `npm run test:coverage` without weakening the gate.
5. **ACP sessions are not durable.** Modes/config report table defaults; the live task registry is in-memory (cap 512, FIFO), not persisted across restart (plans 010/012). → 0.2.0: durable ACP session store behind a host-owned seam.
6. **Delegated-agent seams exist but are protocol-specific (A2A/ACP) with no generic "delegated coding host" contract.** Adding Cursor/Antigravity/Aider/Claude-Code-SDK as one-offs would duplicate the mapping. → 0.2.0: one generic delegated-agent contract + thin per-SDK adapters (see SDK evaluation).
7. **Observational-memory residual gaps.** Loaded-skill bodies and `ReadPathSet` are session-scoped in-memory only — checkpoint resume does not restore them (plans 003/004). `wrapResumeRun`/`attach` use a `sessionId` registry with no core lifecycle hook (plan 002). → 0.1.x/0.2.0: checkpoint persistence for loaded-skill names + read-path set (demand-gated).
8. **Live canary matrix is not recorded.** Real OIDC IdP + JWKS rotation, real OPA bundle pinning, real MCP OAuth AS (DCR + refresh/revoke), real S3-compatible store incl. KMS, and real NATS JetStream are documented as blocked protected gates, but CI runs only fakes (plans 009/011/012). → 0.1.x: record the protected live-canary matrix as a named, env-gated, fail-loud gate.

### Elegance of implementation

- High. Discriminated-union events (`ProviderEvent`, `RealtimeEvent`, `CodingLifecycleEvent`), per-provider cache-control factoring, the `createOpenAICompatibleProvider` reuse pattern, and the model-only `provider-ai-sdk` are textbook clean seams.
- The `ponytail:` shortcut discipline (single-level scans, hand-rolled minimal glob, dependency-free conformance helpers, SigV4 over native fetch) is consistent and documented with ceilings — not accidental minimalism.
- Minor: a few providers hand-roll small `upstream.ts`/cache modules; plan 005 deliberately deferred a shared internal package until a third behavior package appears (YAGNI) — keep as-is.

### Performance opportunities

- The per-version benchmark runners (0.0.8–0.0.28) and the consolidated 0.1.0 runner are good; no regression risk identified at 0.1.0 budgets.
- Opportunities: (a) prompt-cache hit/miss telemetry surface per provider so hosts can tune `cache_aware` layout; (b) model-router cost/latency-aware routing and fallback chains (router state is durable since Phase 6 but selection policy is host-supplied); (c) tree-shaking gains from the `agents.ts`/`contracts.ts` split; (d) async `AgUiProjection` hooks so `messagesFromSession` can call `session.entries()` without a sync `getMessages` callback (plan 008, low priority). All are 0.2.0.

### Setup and structure improvements

- **Prune superseded evidence runners.** `scripts/benchmark-0.0.{8,9,10,11,12,13,14,15,16}.mjs` and `scripts/benchmark-0.0.{23,24,25,26,27,28}.mjs` plus their `*.test.mjs` are mostly no longer wired into `npm test` (which runs only `benchmark-0.1.0.test.mjs` and the phase/e2e gates). Some are still referenced by `budget-gates.mjs`/`budgets.json`/`phase10-freeze-manifest.json`/`benchmark-0.1.0.mjs`. → 0.1.x: audit which are still imported, drop the rest, keep the checked-in `*.json` evidence; replace per-version runners with one parameterized runner + versioned evidence JSON.
- **Archive `docs/review-coverage-2026-07-*.md`** (12 phase-review files) into a single `docs/review-coverage-archive.md` or a `docs/_evidence/` folder; they are already excluded from the tarball but clutter `docs/`. → 0.1.x (doc hygiene, low risk).
- **README/manifest-count narrative** still references "48 publishable vs 49 graph entries incl. root" in places; keep one canonical count in `docs/release-and-install.md` and have everything else link to it (plan 011 further action). → 0.1.x.
- **DX: `prism providers add <name>` scaffold** that generates an OpenAI-compatible provider package from a template (manifest, `provider.ts`, `models.ts`, `cache.ts`, conformance test, `docs/providers/<name>.md`). → 0.1.x or 0.2.0.

### Tools for coding agents and enterprise customers

- **Coding agent** (strong): repository ops, `repo_search` output modes, bounded `glob`, `delete`/`move`, optional `requireReadBeforeWrite`, `ProcessSession`, language intelligence (LSP), GitHub forge, allow-list egress, ACP interop.
- **Coding gaps to close**: no PDF/Office document reader (demand-gated); no recursive `delete`; no brace-expanding `glob`; no network-free native sandbox backend (Docker reference only); no durable ACP session store. → 0.2.0.
- **Enterprise** (strong): OIDC/JWKS verifier, OPA policy adapter, MCP OAuth (RFC 9728/8414/7009, PKCE, audience-bound), OpenAPI tools, S3 artifact body store, durable `AgentEventSource` (Postgres LISTEN/NOTIFY + NATS JetStream), durable approvals, idempotency, retention/legal hold, audit.
- **Enterprise gaps to close**: Cedar policy adapter (OPA only today), second artifact body adapter, OpenAPI pagination beyond cursor, MCP SSE relay automated test, live canary matrix. → 0.2.0 (demand-gated) except MCP SSE test and live canary matrix which are 0.1.x hardening.

### Dead code and deprecations

- **Documented `@deprecated` surface** (candidates for a 0.2.0 breaking cut with migration notes): `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` (inert in first-party providers), `AgentConfig` `maxToolRounds` alias (use `limits.maxToolRounds`), `compaction-observational-memory` pre-0.0.19 flat keys, `read.ts` `transformImage` flag, `cli-init` `listInitProviders` (retained only for tests).
- **Orphaned benchmark runners** (see Setup): audit-and-prune in 0.1.x.
- **No unused-export sweep exists.** → 0.1.x: add `tsc --noUnusedLocals`/`--noUnusedParameters` (non-blocking) or an `knip`-style scan to CI to surface truly dead exports without breaking the build.
- `ponytail:` comments are intentional shortcuts, not dead code; keep.

### Refactoring needs

- Split `agents.ts` and `contracts.ts` by concern behind barrel re-exports (0.2.0, compat-preserving).
- Unify umbrella provider membership (0.1.x).
- Consolidate benchmark scripts to one parameterized runner (0.1.x).
- Remove inert deprecated provider options in a 0.2.0 breaking cut with `docs/migration.md`.
- Extract a shared delegated-agent adapter base only when ≥2 delegated adapters ship (0.2.0); do not pre-extract.

### Security review

- **No active vulnerabilities.** `npm audit --audit-level=moderate` = 0; tree locked at 317 deps; CodeQL/SAST, provenance, SBOM/license, secret scan, and supply-chain negative fixtures are wired into `release.yml`.
- **Residual controls to harden (not flaws, deferred gates)**:
  - Live canary matrix (real IdP/OPA/S3/MCP-AS/NATS) untested in CI — fakes only. → 0.1.x.
  - No real NATS JetStream server test suite (fake of the narrow seam only). → 0.1.x/0.2.0.
  - No automated test holds an MCP SSE stream open (long-lived teardown rejected for CI); production relays but the path is untested. → 0.1.x.
  - Hand-rolled SigV4 is single-chunk only (no multipart/accelerate) — upload size ceiling; upgrade path documented. → 0.2.0 (demand-gated).
  - ACP modes/config are not persisted by the agent — a naive host could leak cross-session/cross-tenant mode state if it persists without ownership scoping. → 0.1.x: add a guidance note + ownership-scoped persistence example; 0.2.0: durable ACP session store.
  - `requireReadBeforeWrite` state is session-scoped in-memory only — resume can overwrite unread files. Documented soft guard. → 0.2.0: checkpoint persistence.
- **Delegated-agent streams (Cursor/Antigravity) emit tool args/results that may contain secrets.** Any adapter MUST route through Prism's `SecretRedactor` and treat SDK tool payloads as untrusted. → 0.2.0 (with the adapters).

## SDK Evaluation: Models-Only vs. Full Harness

The user asked whether the Cursor and Antigravity SDKs can be used **for models only** (consuming their model/streaming interface) instead of also adopting their agent harness. The reference proof that model-only is possible in principle is `@arnilo/prism-provider-ai-sdk`, which wraps the Vercel AI SDK's `LanguageModelV4` (model interface) and maps its stream to `ProviderEvent`, ignoring the AI SDK's `Agent`/`tool`/`streamText` harness. That works **only because** the AI SDK cleanly separates the model interface from its agent loop.

### Cursor SDK (`@cursor/sdk`, TypeScript) — model-only: NOT possible

- Cursor's own docs state: *"The Cursor SDK is an agent SDK, not a standalone model-inference or chat-completions API. Router picks models for Cursor agent runs that can reason over a workspace, call tools, run commands, and edit files. Cursor does not currently document a raw Router endpoint for arbitrary model calls."*
- The only entry point is `Agent.create()` → `agent.send(prompt)` → `run.stream()` yielding `SDKMessage`/`InteractionUpdate` events (assistant text, `tool_call`, `thinking`, `usage`, `status`, `task`, `request`). That stream runs Cursor's full agent loop — tools, file edits, shell commands — either inline in Node (local) or in a Cursor-hosted VM (cloud).
- There is no `LanguageModelV4`-equivalent pluggable model seam and no raw model endpoint to wrap as a Prism `AIProvider`.
- **Integration path:** treat Cursor as a **delegated coding agent**, not a model provider. Wrap `Agent.create()`/`send()`/`stream()` in a 0.2.0 package that maps `SDKMessage`/`InteractionUpdate` → Prism `AgentEvent` through a generic delegated-agent contract, redacts tool payloads, and exposes it via the supervisor/delegated-agent seam (prompt in, structured events out). Use it for "let Cursor do this coding task and report back," never as the model behind Prism's own loop.

### Antigravity SDK (Python) — model-only: NOT possible

- Antigravity is a **Python** framework whose model layer is bound to **Gemini** (`GeminiAPIEndpoint` for the Gemini Developer API, `VertexEndpoint` for Vertex AI; default `gemini-3.6-flash`). There is no pluggable custom-language-model seam.
- The agent loop runs in a **Go `localharness` binary** the Python SDK talks to over WebSocket + protobuf. The `Connection.send(prompt)`/`receive_steps()` interface is the **agent loop**, not a model API.
- Prism **already ships** `@arnilo/prism-provider-google` (Gemini) and `@arnilo/prism-provider-vertex` — those *are* the models Antigravity uses. If the goal is only "use Antigravity's models in Prism," the SDK adds nothing; the providers already cover it.
- **Integration path:** use Antigravity as a **delegated coding agent** (0.2.0), mirroring the existing `provider-opencode-go` Go-binary-bridge pattern: spawn the Python sidecar (or the Go `localharness` directly), map `Step` events → Prism `AgentEvent`, expose via the delegated-agent seam. Do not adopt the Antigravity harness as Prism's runtime.

### Alibaba Cloud — already implemented; enrich, do not reimplement

- `@arnilo/prism-provider-alibaba` already exists and ships OpenAI-compatible Chat Completions against Model Studio / DashScope (pay-as-you-go regional, workspace-dedicated, and Coding Plan endpoints), with `enable_thinking`, cache-control markers, multimodal image, and structured output.
- **0.1.x work** = gap-fill within the existing provider: Bailian (Model Studio) endpoints for embeddings/rerank/text-to-SQL where OpenAI-compatible, async task polling, document/video input where supported, and conformance coverage. These stay provider-side (0.1.x), not new modules.
- **0.2.0** = broader Alibaba Cloud platform adapters (Bailian rerank/embeddings into `@arnilo/prism-rag`, OSS as a second `ArtifactBodyStore`) as optional, demand-gated packages.

### Conclusion

The model-only pattern is **available for SDKs that separate model from loop** (AI SDK ✓). It is **not available** for Cursor or Antigravity, whose only public surface is the bundled agent loop. The honest integration is delegated-agent adapters (0.2.0 new modules), not model providers. Alibaba is enrichment on the 0.1.x provider line.

## Product Boundaries

- **Harness, not hosted platform.** Hosts own UI, auth UX, user directory, deployment, provider selection, business policy, and storage topology.
- **One runtime.** New durability, events, approval, coding, protocol, and delegated-agent capabilities extend current sessions/ledgers/checkpoints/leases/workflows/tools/events — no second runtime.
- **Core stays dependency-free.** DB drivers, OIDC/JWT libs, policy engines, LSP clients, forge clients, PTY impls, proxies, object-store SDKs, and delegated-agent SDKs stay in optional packages.
- **One reference implementation first.** Postgres before Redis/Kafka; one forge before a catalog; one policy engine (OPA) before Cedar; one object store (S3) before a second; one delegated-agent base before a catalog.
- **Explicit activation.** No listener, worker, provider, credential resolver, indexer, LSP server, process session, network proxy, delegated agent, or remote service starts by import or discovery.
- **No exactly-once claim.** Side effects are at-least-once with idempotency and explicit unknown-outcome recovery.
- **No regex-as-containment.** Repository search stays literal-only; any regex support is host-supplied and terminable.
- **No automatic capability escalation.** ACP, MCP, OpenAPI, forge, network, policy, and delegated-agent integrations expose only host-selected capabilities and recheck identity/policy at execution.
- **No speculative product layer.** Studio, visual workflows, hosted cloud, managed observability, broad channels/devices, desktop control, and remote-browser vendors stay demand-gated.

## Priority and Dependency Rules

1. 0.1.x hardening (defects, lifecycle, tooling, security gates) precedes new 0.1.x providers precedes 0.2.0 modules.
2. New model providers on 0.1.x MUST reuse an existing OpenAI/Anthropic/Google-compatible base and ship conformance + budget gates; no bespoke runtime per provider.
3. New modules in 0.2.0 require a numbered plan with primitive review, threat model, measurable acceptance criteria, and an operational owner; do not scaffold their packages or APIs early.
4. Delegated-agent adapters (Cursor, Antigravity, future) share one generic delegated-agent contract extracted only after ≥2 adapters are planned; no premature abstraction.
5. Breaking changes (removing deprecated inert options, splitting god-modules) land in 0.2.0 behind barrel re-exports and `docs/migration.md`; the 0.1.x compat baseline stays green.
6. Demand-gated 0.2.0 candidates (Cedar, second object store, OpenAPI pagination, recursive delete, brace glob, PDF readers, native sandbox backend, multipart SigV4) need a named user before a plan.
7. Every release records protected evidence (Postgres, live canaries, benchmarks) as a blocked gate when credentials are absent — never a silent skip.

## Versioning Policy

- **0.1.x (patch line):** bug fixes, correctness/lifecycle/security/tooling hardening, doc hygiene, and **new model providers** / provider enrichment. Additive or non-breaking vs the frozen `docs/public-contracts.md` 0.1.x surface; any unavoidable breaking change carries a tested migration/refusal path and a `docs/migration.md` entry. Each 0.1.x cut runs the full release validation checklist.
- **0.2.0 (minor):** new modules and capability packages, plus the compat-preserving god-module split and the deprecated-option removal. Additive public exports where possible; breaking changes documented with migration. 0.2.0 ships only after 0.1.x hardening is green and each module's plan passes its exit gate.
- **1.0:** operator-gated, not automatic; requires the full protected matrix (Node 20+22+24, multi-Postgres, live canaries, all protocol pins) recorded and the 0.1.x contract stable through at least one patch cycle.

## Roadmap — 0.1.x Stabilization and Providers

Each item is a candidate for one 0.1.x release. Order within the line is recommended; actual sequencing follows the per-release plan. New providers and provider enrichment are explicitly 0.1.x per the versioning policy.

### 0.1.1 — Post-release hardening and tooling fixes

- [x] **Build single-flight / clean removal.** Remove `clean` from `npm run build`; rely on `tsc --build` incrementality + a dedicated `clean` script (or add a single-flight lockfile). Eliminates the concurrent-test/build `dist/` deletion race (plans 007/008).
  - Acceptance: concurrent `npm run build` + `npm test` cannot corrupt `dist/`; `npm run clean` still exists; `sdk:ready` green.
  - **Shipped (plan 013 Task 1).** `npm run build` drops the clean prefix (`build:core && build --workspaces --if-present`), `npm run clean` stays standalone; race reproduced pre-fix and re-probed post-fix; orphaned dist fails loud on next `node --test`; docs build notes added.
- [x] **MCP SSE relay automated test.** Add a deterministic stateful SSE relay test through `createPrismMcpWebHandler` now that SSE is relayed unbuffered (plan 011 further action, medium). No long-lived stream held open in CI; bounded relay asserted.
  - Acceptance: SSE relay path covered; no flaky teardown; `npm test` green.
  - **Shipped (plan 013 Task 2).** `relayStatelessBody` extracted (internal export, not in the package entry surface) + 4 tests (chunk order/done-close, cancel-close, null-body, E2E stateless POST close-on-completion); cancel path unit-only by SDK design.
- [x] **Combined coverage summary.** Surface a core+packages coverage summary in `npm run test:coverage` without weakening the core gate (plan 010 compromise).
  - Acceptance: summary reports core + per-package coverage; gate thresholds unchanged.
  - **Shipped (plan 013 Task 3).** `scripts/coverage-summary.mjs` (zero deps) — core gate (60/70/75) the only hard threshold + 41 workspace suites reported; ~25s workspace pass, ~70s total `test:coverage` on Node 24.
- [x] **Manifest-count narrative consolidation.** One canonical manifest count in `docs/release-and-install.md`; README/docs link to it (plan 011 further action).
  - Acceptance: no contradictory counts; docs tripwires green.
  - **Shipped (plan 013 Task 4).** Canonical "49 publishable manifests = root + 48 workspace (14 provider + 9 prism-* + 25 capability)" with regenerate note; all reconciliations (incl. 0.0.27 kept at 48 as historically correct); tripwire; stale tarball-diet baselines corrected to the published artifact sizes.
- [x] **ACP mode/config ownership guidance.** Add a `docs/acp.md` note + ownership-scoped persistence example so hosts do not leak cross-session/cross-tenant mode state when persisting (security review).
  - Acceptance: guidance + example present; ownership-scoping asserted in a test fixture.
  - **Shipped (plan 013 Task 5).** `docs/acp.md` "Persistence and ownership" subsection (agent never persists; host stores MUST key by `sessions.ownership`; cross-tenant restore rejects `ERR_PRISM_ACP_INPUT`); 3 new tests (host-store refusal, agent-stays-thin, authorize-seam refusal); host-security + index cross-links.

**0.1.1 shipped (plan 013 complete).** Docs freeze (tripwires 123/123), scripted bump to 0.1.1 (49 manifests + lockfile), compat baseline regenerated (version literal + one additive internal export, 0 breaking deltas), `npm test` 1418/1418 + 94/94 gates, audit 0 moderate, `sdk:ready` rc=0, publish dry-run 49/49 twice byte-identical; exit-gate evidence in `scripts/phase13-baseline.json` (`exitGate`). Publication (commit, `release:check`, `git tag -s v0.1.1`, npm OIDC) is the operator handoff documented in `docs/release-and-install.md` (plan 013 Task 6).

### 0.1.2 — Protected live-canary matrix (operator-gated)

- [ ] **Record the protected live-canary matrix** as a named, env-gated, fail-loud gate (plans 009/011/012 further actions, high priority): real OIDC IdP + JWKS rotation, real OPA bundle pinning, real MCP OAuth AS incl. DCR + refresh/revoke, real S3-compatible store incl. KMS, real NATS JetStream server. Missing credentials are a blocked release gate, not a silent skip.
  - Acceptance: `npm run test:live` (or equivalent) runs each canary; absent creds fail loud with `canary-report.json`; protected CI sets the env.
- [ ] **Live NATS JetStream suite.** `PRISM_TEST_NATS_URL` gating + `test:nats` script against a real server, mirroring `test:postgres` (plan 009 further action). The fake-seam tests remain in `npm test`.
  - Acceptance: real-server append/subscribe/reconnect/dedupe-window/durable-cursor covered; fake tests unchanged.

### 0.1.3 — Provider catalog expansion (new providers)

- [ ] **New OpenAI-compatible model providers.** Add providers for ecosystems with OpenAI-compatible endpoints (e.g., xAI Grok, Mistral, DeepSeek, Groq, Together, Cohere, Fireworks, Cerebras, Friendli, NovitaAI) as thin packages over `createOpenAICompatibleProvider`, each with `models.ts`, cache support where available, conformance + budget gates, and `docs/providers/<name>.md`. Reuse the alibaba/opencode-go/openrouter/zai pattern; no bespoke runtimes.
  - Acceptance: each provider passes `testing/provider-conformance`, `testing/provider-media` where multimodal, `budgets.json` package-size gate, and `docs/index.md` navigation; no new runtime dependencies in core.
- [ ] **`prism-providers` umbrella membership fix.** Either include azure/bedrock/vertex in `@arnilo/prism-providers` (making it the canonical "all first-party model providers" umbrella) or document the `prism-providers` vs `prism-all` split in `docs/provider-packages.md` (architectural problem #1).
  - Acceptance: membership is intentional and documented; `release.mjs check` + `pack:dry-run` green; no consumer breakage.

### 0.1.4 — Alibaba Cloud provider enrichment

- [ ] **Alibaba provider gap-fill.** Extend `@arnilo/prism-provider-alibaba` with Bailian endpoints where OpenAI-compatible (embeddings/rerank/text-to-SQL if exposed via chat), async task polling for long-running generation, document/video input where supported, and expanded conformance. Keep OpenAI-compatible base; no new runtime deps.
  - Acceptance: new endpoints covered by conformance; `docs/providers/alibaba.md` updated; cache-control + `enable_thinking` regression green; budget gate green.
- [ ] **Defer Alibaba Cloud platform adapters** (Bailian rerank/embeddings into RAG, OSS artifact store) to 0.2.0 as demand-gated optional packages.

### 0.1.5 — Dead-code and deprecation hygiene

- [ ] **Prune superseded benchmark runners.** Audit `scripts/benchmark-0.0.*.mjs`/`*.test.mjs` references; drop the orphaned ones, keep the checked-in `*.json` evidence; introduce one parameterized benchmark runner + versioned evidence JSON (setup).
  - Acceptance: `npm test` references only current runners; removed files listed in the release changelog; benchmark evidence preserved.
- [ ] **Archive phase-review docs.** Move `docs/review-coverage-2026-07-*.md` into `docs/_evidence/` (excluded from tarball, linked from `docs/0.1.0-readiness.md`).
  - Acceptance: `docs/` root cleaned; evidence links intact; docs tripwires green.
- [ ] **Unused-export sweep (non-blocking).** Add a `tsc --noUnusedLocals`/`--noUnusedParameters` scan or an `knip`-style CI step that reports dead exports without failing the build.
  - Acceptance: report produced; obvious dead exports removed or marked `ponytail:` intentional.
- [ ] **Checkpoint persistence for loaded-skill names + ReadPathSet** (plans 003/004 further actions, demand-gated). If a host needs resume-without-model-reload, persist loaded-skill names and the read-path set in the checkpoint; bodies reload on resume via `load_skill`.
  - Acceptance: resume restores loaded-skill catalog + read-before-write state; cross-branch non-leak test; opt-in to avoid size growth.

## Roadmap — 0.2.0 New Modules

Each 0.2.0 module requires a numbered plan (primitive review, threat model, measurable acceptance, operational owner) before implementation. Listed in recommended order; demand gates noted.

### 0.2.0 Module A — Delegated coding-agent adapters (Cursor, Antigravity)

- [ ] **Generic delegated-agent contract** (primitive review first). Extract a minimal, dependency-free "delegated coding host" seam: prompt in → `AgentEvent` stream out, with redaction, ownership, approval/effect mapping, durable run correlation, and a host-owned cancellation signal. Reuse the supervisor/A2A event mapping and the `provider-opencode-go` Go-binary-bridge pattern as references. Extract only because ≥2 adapters (Cursor, Antigravity) are planned.
- [ ] **`@arnilo/prism-cursor` adapter.** Wrap `@cursor/sdk` `Agent.create()`/`send()`/`stream()`; map `SDKMessage`/`InteractionUpdate` → Prism `AgentEvent`; redact tool args/results; honor `CURSOR_API_KEY` credential source; surface `requestId`/`runId` correlation; support local + cloud runtimes as host-selected options; never expose a model-only surface (none exists). Optional peer dependency on `@cursor/sdk`; fails closed if absent.
- [ ] **`@arnilo/prism-antigravity` adapter.** Spawn the Antigravity Python sidecar (or the Go `localharness` binary) over WebSocket+protobuf; map `Step` events → Prism `AgentEvent`; redact payloads; honor `GEMINI_API_KEY`/Vertex credential sources; expose it as a delegated agent, not a model provider (Prism already has `provider-google`/`provider-vertex` for the models). Optional peer dependency / sidecar binary resolution; fails closed if absent.
- [ ] **Docs + conformance.** `docs/delegated-agents.md`, `docs/providers/cursor.md`, `docs/providers/antigravity.md`; delegated-agent conformance helper in `testing/`; redaction + ownership + cancellation adversarial tests; budget gate.
- [ ] **Acceptance (all three):** delegated agents run behind Prism's approval/policy/identity/effect contracts; tool payloads redacted; cross-tenant isolation; cancellation honored; no implicit activation; `sdk:ready` + release gate green. Document the SDK-evaluation decision (model-only not available) in `docs/delegated-agents.md`.

### 0.2.0 Module B — God-module split (compat-preserving)

- [ ] **Split `src/agents.ts`** into run-lifecycle, approval/pending-decisions, tool dispatch, and fingerprint modules behind barrel re-exports in `src/agents.ts` so public imports are unchanged. Split `src/contracts.ts` into core contracts, run-state, and protocol-payload modules behind `src/contracts.ts` barrel.
  - Acceptance: public import surface unchanged (compat baseline green); `agents.ts`/`contracts.ts` files become barrels; tree-shaking improves (measured); `sdk:ready` green.

### 0.2.0 Module C — Deprecated-option removal (breaking, documented)

- [ ] Remove inert `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs`, `AgentConfig.maxToolRounds` alias, `compaction-observational-memory` pre-0.0.19 flat keys, `read.ts` `transformImage` flag, `cli-init` `listInitProviders`. Add `docs/migration.md` 0.1.x → 0.2.0 section with the removed symbols and replacements.
  - Acceptance: removed symbols absent from `.d.ts`; migration notes present; compat baseline updated (intentional breaks recorded); `sdk:ready` green.

### 0.2.0 Module D — Enterprise adapter breadth (demand-gated)

- [ ] **Cedar policy adapter** beside OPA, behind the existing `PolicyEvaluator` seam (plan 011 further action). Demand gate: a named user/integration.
- [ ] **Second `ArtifactBodyStore` adapter** (e.g., Alibaba OSS or Azure Blob) if a host demands it (plan 011 further action). Multipart SigV4 for the S3 adapter if upload-size ceiling is hit.
- [ ] **OpenAPI pagination beyond cursor** (offset, Link headers) if hosts need it (plan 011 further action).
  - Acceptance: each adapter passes its conformance + redaction + ownership tests; budget gate green; demand evidence recorded.

### 0.2.0 Module E — Coding-agent capability closeouts (demand-gated)

- [ ] **Durable ACP session store** + **native sandbox backend** (network-free) — host-owned seams revisited on demand with a threat model (plan 012 further action).
- [ ] **PDF/Office document reader** as a bounded host-selected parser adapter (plans 004/roadmap non-goals).
- [ ] **Recursive `delete`** and **brace-expanding `glob`** if pattern/usage demand justifies it (plan 004 further actions).
- [ ] **Checkpoint persistence** for `ReadPathSet` + loaded-skill bodies if 0.1.5's names-only persistence is insufficient.
  - Acceptance: each closeout behind its own plan with primitive review + threat model; budget/security gates green.

### 0.2.0 Module F — Performance and DX

- [ ] **Prompt-cache telemetry surface** per provider (hit/miss, cache tokens) so hosts tune `cache_aware` layout.
- [ ] **Model-router cost/latency-aware routing + fallback chains** (router state is durable; selection policy becomes host-configurable with a reference policy).
- [ ] **Async `AgUiProjection` hooks** so `messagesFromSession` can call `session.entries()` without a sync `getMessages` callback (plan 008, low priority).
- [ ] **`prism providers add <name>` scaffold** (DX) generating an OpenAI-compatible provider package from a template with conformance + docs.
  - Acceptance: telemetry/redaction/budget gates green; DX scaffold produces a passing provider package; no core deps added.

### 0.2.0 Module G — Observability for delegated agents

- [ ] OpenTelemetry spans for delegated-agent runs (Cursor/Antigravity) through the existing `observability-opentelemetry` package; redacted payloads; run/step/tool-call spans correlated by `requestId`/`runId`.
  - Acceptance: spans emitted; payloads redacted; conformance green.

## Consolidated Compromises (from plans 001–012)

These design ceilings are inherited from the 0.0.x phase plans and remain in force on the 0.1.x line unless a 0.2.0 module explicitly lifts them. Each lists the ceiling and the upgrade path.

- **001 (0.0.18):** `repo_search` is literal-only (regex removed, not worker-isolated) — hosts needing regex supply a bounded backend. Atomic write/edit is same-filesystem temp+`rename` only — custom ops hosts must match durability. Default `inputLayout` flip to `cache_aware` is breaking — `legacy` is the explicit opt-in. Readiness evidence table still carries the 0.0.16 historical floor; operator refreshes at 1.0.
- **002 (0.0.19):** Empty-pass coverage markers append only when the worker runs; the dropper runs only after a reflection records ≥1 fact. `wrapResumeRun`/`attach` use a `sessionId` registry — no core lifecycle hook added.
- **003 (0.0.20):** Loaded-skill bodies are session-scoped in-memory only — checkpoint resume does not restore bodies unless the host/model reloads. `toolResultFold` is off by default. Root tarball budget baselines bumped ~6% for Phase 3 modules. Breaking registry empty-default + progressive catalog default require `activateAllSkills` / `skillsDisclosure: "eager"` migration.
- **004 (0.0.21):** No PDF/Office reader, trash daemon, PTY/process sessions, LSP, recursive delete, or brace-expanding glob. Read-before-write is opt-in and session-scoped in-memory only. Fuzzy edit may succeed silently on a normalized match; multi-match fails closed (documented). Hand-rolled `*`/`?`/`**` glob matcher (no `fs.glob`, no picomatch).
- **005 (0.0.22):** Each package duplicates a small `upstream.ts` (no shared internal package) — extract only if a third behavior package appears. `caveman-stats` dispatches skill metadata only (no Claude session-log hook). `caveman-init` returns guidance text (does not run `caveman-init.js`). `ponytail-subagent` hook is host metadata only (not wired). No TUI statusline shell scripts (Prism is a harness).
- **006 (0.0.23):** Release preflight used `--allow-dirty --allow-untagged` on an implementation checkout (not a tagged publish). Protected PostgreSQL evidence recorded on disposable `postgres:16-alpine` / Node v24.18.0 Linux x64.
- **007 (0.0.24):** Root tarball budget baselines raised to measured 0.0.24 sizes (still +5% gated). Example uses in-memory event/effect stores; protected PostgreSQL evidence is the real gate. Concurrent `npm test`/`build` can race root `clean` (single-flight required — see 0.1.1).
- **008 (0.0.25):** A2UI stays a section in `docs/ag-ui.md` (not a standalone page). Hashed nested approval ids to stay under the 128-char id cap. FR-3/FR-4/FR-5 remained deferred P2 (FR-3/FR-4 shipped in 0.0.26; FR-5 NATS shipped in 0.0.26 fake-seam). Concurrent clean race (see 0.1.1). Full `sdk:ready` coverage/pack legs left for the operator clean-checkout cut.
- **009 (0.0.26):** NATS tests are network-free over a fake of the narrow seam (no real server — see 0.1.2). NATS `append` idempotency is bounded by the stream dedupe window (not a permanent unique constraint); `cleanup` is O(limit) delete calls; `subscribe` resumes via cursors not durable-name reuse; stream provisioning is host-owned; `reconnectInitialMs`/`reconnectMaxMs` accepted but unused (the official client owns reconnection). A2A server-side exposure is non-generic: single in-memory stream consumer per live task; live task registry in-memory (cap 512, FIFO, no persistence); A2A parts `raw`/`data`/`url` disabled unless the host `parts` policy selects them.
- **010 (0.0.27):** Experimental ACP SDK fields stay excluded (`providers`, `nes`, `positionEncoding`, `sessionCapabilities.fork`, `mcpCapabilities.acp`/`auth`); `elicitation` consumed client-side only, never advertised agent-side. Deferred lifecycle events (`check_*`, `task_*`, `compaction_*`, `subagent_*`) not shipped (no ACP update kind / consumer). Modes/config not persisted by the agent (table defaults). Lifecycle delivery is stream-scoped. Smoke is operator-gated and not in `npm test`. Coverage aggregate excludes `packages/**` and `examples/**` (see 0.1.1).
- **011 (0.0.28):** Fake-server gate; live endpoints deferred (see 0.1.2). OPA only (no Cedar) and one object-store adapter (S3-compatible) — seams stay swappable. Hand-rolled SigV4 single-chunk presign/put/get (no `@aws-sdk/client-s3`, ~1 MB saved); multipart/accelerate/non-path-style out of scope (see 0.2.0 Module D). OpenAPI mutation idempotency is core-managed, not a per-adapter store. Test harnesses 405 on standalone GET SSE rather than relaying a long-lived stream (see 0.1.1). Discovery cache is single-entry with a TTL cap per provider instance.
- **012 (0.1.0):** Signed `v0.1.0` tag is an operator action (no GPG key in the build env); dry-run + refusal paths are machine-verified, the signature is not. Clean-checkout `sdk:ready` verified against a local clone of HEAD + the working diff, not a pushed CI run. Compat baseline regenerated for the `0.1.0` version literal. `security:threat-suites` runs Phase 8–11 conformance as one named leg (Phase 7 tenant suite stays under `test:postgres`). Live canaries keep an env-gate silent-skip for local runs (protected workflows set the env — see 0.1.2).

## Consolidated Further Actions (from plans 001–012, status reconciled)

Closed items are marked **done**; open items are routed to a 0.1.x or 0.2.0 milestone.

- **001:** Phase 2 plan created — **done**. Operator publish of `v0.0.18` — **done** (tag exists). Phase 4 coding gaps — **done** (Phase 4 shipped 0.0.21).
- **002:** Phase 3 execute — **done** (0.0.20).
- **003:** Phase 4 next — **done**. Phase 5 Caveman/Ponytail consuming Phase 3 — **done** (0.0.22). Future 0.0.x checkpoint persistence for loaded-skill names — **→ 0.1.5**. Release handoff 0.0.20 — **done**.
- **004:** Tag/publish 0.0.21 — **done**. Phase 5 next — **done**. Checkpoint persistence for `ReadPathSet`/loaded-skill names — **→ 0.1.5 / 0.2.0 Module E**. Recursive delete / brace glob if demand — **→ 0.2.0 Module E**.
- **005:** Tag/publish 0.0.22 — **done**.
- **006:** Commit, tag `v0.0.23`, clean preflight — **done**. Phase 7 next — **done** (0.0.24).
- **007:** Cut signed `v0.0.24` + protected Postgres + publish dry-run — **done**. Non-destructive workspace rebuild path (concurrent cleans) — **→ 0.1.1**. Public `deriveToolEffectKey` export if hosts need offline key derivation — **demand-gated (0.2.0)**. Phase 8 builds on frozen seams — **done** (0.0.25).
- **008:** Cut signed `v0.0.25` + `sdk:ready` + publish dry-run — **done**. FR-3 reasoning encrypted-value helper — **done** (0.0.26). FR-4 MCP Apps UI-initiated mutation retry — **done** (0.0.26). FR-5 NATS JetStream `AgentEventSource` — **done** (0.0.26, fake-seam; **live suite → 0.1.2**). Async `AgUiProjection` hooks — **→ 0.2.0 Module F**.
- **009:** Live NATS integration suite — **→ 0.1.2**. FR-3/4/5/6/7 shipped 0.0.26 — **done**. Tasks 13–15 (A2A server-side exposure, frontend renderer, async `AgUiProjection`) — **done** in 0.0.26. Phase 10 ACP mapping — **done** (0.0.27). Operator handoff (48 manifests) — **done**.
- **010:** (Plan left "to be filled after task completion.") Material deferred items recorded above: deferred lifecycle events, modes/config persistence, durable ACP session store — **→ 0.2.0 Module E**; MCP SSE relay test — **→ 0.1.1**; coverage summary — **→ 0.1.1**.
- **011:** Record protected live-canary matrix — **→ 0.1.2**. MCP SSE coverage — **→ 0.1.1**. Cedar, second artifact adapter, OpenAPI pagination — **→ 0.2.0 Module D (demand-gated)**. Manifest-count narrative — **→ 0.1.1**.
- **012:** Operator publication of 0.1.0 (signed tag + npm OIDC) — **tag exists; npm publish remains operator action**. Phase 13 demand evidence — **this roadmap's 0.2.0 demand gates**. Node 22 CI leg + multi-Postgres CI legs on-demand — **demand-gated**. Durable ACP session store + native sandbox backend — **→ 0.2.0 Module E (demand-gated)**.

## Proposed New Features (summary)

- **0.1.x:** new OpenAI-compatible model providers; Alibaba provider enrichment; build single-flight; MCP SSE relay test; live-canary + live-NATS protected gates; coverage summary; checkpoint persistence for loaded-skill names + `ReadPathSet`; dead-code/deprecation hygiene; `prism providers add` DX scaffold (candidate).
- **0.2.0:** delegated coding-agent adapters (Cursor, Antigravity) behind a generic delegated-agent contract; god-module split; deprecated-option removal; Cedar/second-object-store/OpenAPI-pagination adapters; durable ACP session store + native sandbox backend; PDF/Office reader; recursive delete + brace glob; prompt-cache telemetry; cost/latency model routing + fallback chains; async `AgUiProjection` hooks; OTel spans for delegated agents.
- **Demand-gated beyond 0.2.0 (Phase 13):** Studio/control plane and visual workflow editor; hosted cloud and managed observability; Slack/Teams/channel catalogs, voice/device, desktop OS control; remote-browser/sandbox vendors; additional forges after GitHub adoption; additional queues/backplanes after Postgres capacity evidence; additional policy engines/object stores/databases/vector stores/providers; advanced GraphRAG/semantic chunking; cron-expression scheduling. Each needs a named user, integration, operational owner, threat model, measurable acceptance, and its own numbered plan.

## Release Validation Checklist

Every 0.1.x and 0.2.0 release must satisfy:

- [ ] Active milestone acceptance criteria and focused adversarial tests pass.
- [ ] `npm run sdk:ready` passes with zero unexplained failures/skips.
- [ ] Node 20 and a current-supported Node build and public packed imports pass.
- [ ] Relevant observational-memory, skills progressive-disclosure, coding-tool, PostgreSQL, keychain, provider, MCP, A2A, ACP, OIDC, policy, browser, sandbox, egress, forge, object-store, delegated-agent, and work-connector protected suites pass where affected.
- [ ] Multi-process restart, failover, cursor, approval, idempotency, and unknown-outcome tests pass where affected.
- [ ] `npm audit` policy, dependency tree, CodeQL/SAST, dependency review, secret scan, SBOM/license, provenance, and tarball-content checks pass.
- [ ] Performance, storage growth, package size, startup, and install-size changes are measured against frozen budgets.
- [ ] Public docs, examples, migration notes, package READMEs/changelogs, package counts, and `docs/index.md` match behavior.
- [ ] Public declarations/exports, internal versions/ranges, lockfile, migrations, and profile contents are consistent.
- [ ] Fresh packed-install and cross-package enterprise/coding journeys pass.
- [ ] Release dry-run is deterministic; clean protected CI, signed tag, and npm OIDC publication evidence are recorded.
- [ ] No blocker is converted into a skip or deferred only to preserve a release number/date.

## Non-Goals (carried forward)

- Prism Studio, visual workflow builder, hosted cloud, or managed telemetry backend.
- Built-in user database, login UI, SAML identity provider, or SCIM server.
- Mandatory Kubernetes, Helm, Terraform, Redis, Kafka, SQS, or vendor control plane.
- Automatic provider, credential, MCP server, OpenAPI operation, LSP server, forge, delegated agent, or network discovery.
- Broad Slack/Teams/channel, voice/device, desktop-control, remote-browser, vector-store, object-store, policy-engine, forge, or delegated-agent catalogs beyond the one-reference-first rule.
- Built-in Caveman or Ponytail prompt content, skill bodies, hook scripts, or rule text (integration packages only wire upstream).
- Exactly-once execution claims for arbitrary external side effects.
- Model-only usage of Cursor or Antigravity SDKs — neither exposes a model-only seam; they integrate as delegated agents, not providers.
- A second agent runtime; all new capabilities extend the current sessions/ledgers/checkpoints/leases/workflows/tools/events.I wan
