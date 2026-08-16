# Prism Roadmap

Updated: 2026-08-12
Baseline: `@arnilo/prism` **0.1.7** (plans 001–019 implemented; 0.1.x is complete).
Scope: a forward-looking roadmap beginning at **0.2.0** with security, correctness, release-integrity, maintainability, coding-agent, and Enterprise ERP readiness work from the 2026-08-12 comprehensive review. **Resequencing (2026-08-12):** every item previously scheduled for 0.2.x moves unchanged to **0.3.x**; 0.2.x is reserved for review remediation and production-readiness work. Completed evidence remains in `plans/001`–`plans/019`, `CHANGELOG.md`, and `docs/review-coverage-*`.

## Objectives

- Close fail-open durable-resume, subprocess-secret, and sandbox-containment defects before expanding Prism's capability catalog.
- Make provider completion, outbound network access, response parsing, state updates, budgets, builds, and coverage measurement fail closed and concurrency-safe.
- Bring coding-agent and Enterprise ERP paths to production readiness with explicit durability, recovery, audit, approval, and release evidence.
- Reduce maintenance cost by consolidating repeated bounded transports/persistence codecs and splitting only proven god-modules along cohesive state-machine boundaries.
- Defer the former 0.2.x provider/delegated-agent/enterprise-adapter expansion to 0.3.x; do not grow catalog breadth before 0.2.x foundations pass.
- Preserve Prism as a dependency-light, host-owned harness: no hosted product, control plane, second runtime, or implicit activation.

## Expected Outcome

- 0.2.x removes all confirmed review blockers, records direct adversarial regressions, and makes every security-sensitive core function validate independently of HTTP/TypeScript adapters.
- Provider/network boundaries stream bounded bodies, pin approved network destinations, reject incomplete streams, and preserve credential/signature correctness.
- Durable conversations, budgets, approvals, registries, and ERP side effects have explicit atomicity, recovery, and multi-replica semantics.
- Coverage reports measure each package correctly; emit builds cannot expose partial `dist`; protected skips are visible release evidence rather than unexplained green runs.
- Coding-agent and ERP readiness gaps ship only behind host-owned seams with threat models and operational owners.
- Former 0.2.x catalog expansion begins at 0.3.0 after 0.2.x exit gates pass; Cursor and Antigravity remain delegated agents, never model providers.
- Core remains dependency-free; default and protected release gates, audit, secret scan, compatibility, package budgets, and clean packed-install journeys stay green.

## Previous Baseline and Review Findings (2026-08-09)

The codebase was reviewed end to end after the 0.1.0 cut. Findings below explain the completed 0.1.x work and historical deferrals; the 2026-08-12 evidence and 0.2.x milestones later in this document supersede their old routing.

### Existing strengths to preserve

- **Dependency-free core** with explicit activation: no provider, tool, credential, MCP server, LSP, process, network proxy, OIDC, policy, or object-store service starts by import or discovery.
- **Neutral seams** that make adapters cheap: `AIProvider.generate(): AsyncIterable<ProviderEvent>`, `RealtimeSession`, `AgentEventSource`, `ToolEffectStore`, `PolicyEvaluator`, `IdentityVerifier`, `ArtifactBodyStore`, `AgentLoopStrategy` snapshot/restore, pending-decision/approval contract, `SkillRegistry` + progressive disclosure.
- **OpenAI-compatible base reused** by alibaba, opencode-go, openrouter, zai, kimi, neuralwatt; **`@arnilo/prism-provider-ai-sdk`** wraps the Vercel AI SDK `LanguageModelV4` *model interface only* and ignores its agent harness — the proof that model-only adapters are possible when an SDK separates model from loop.
- **Conformance-helper packages** (`testing/*-conformance`) keep adapter tests dependency-free and runner-agnostic; per-package suites own their coverage.
- **Security posture**: deny-by-default sandbox/egress, atomic same-filesystem write/edit, literal-only repository search (no ReDoS), redaction at every boundary, audience-bound OAuth tokens with SSRF-checked discovery, hand-rolled SigV4 over native fetch (no `@aws-sdk/client-s3` bloat), supply-chain negative fixtures, `npm audit` clean (0 vulns, 317 locked deps at 0.1.0), CodeQL/SAST, npm provenance.
- **Deliberate minimalism** is disciplined: `ponytail:` comments consistently name the ceiling and upgrade path of each shortcut; no speculative abstractions or single-implementation interfaces were introduced.
- **Budget/benchmark gates** per release with frozen p95 ceilings and a single 0.1.0 envelope (`scripts/benchmark-0.1.0.mjs`/`.json`).
- 50-package publish graph at 0.1.7 (root + 49 workspaces), including 14 model-provider adapters and manifest-only profiles.

### Architectural problems needing fixing

1. **Umbrella membership and claims are inconsistent.** `@arnilo/prism-providers` ships 11 providers while Azure/Bedrock/Vertex are added separately by `prism-all`; `prism-all` also omits document-reader, OpenAPI tools, NATS, Caveman, and Ponytail despite “every package” wording. → 0.2.4: make docs truthful/generated; 0.3.0: decide and enforce actual membership.
2. **`src/agents.ts` (2,565 lines) and `src/contracts.ts` (2,541 lines, ~250 exports) are god-modules.** They are cohesive but hard to navigate and limit tree-shaking. → 0.1.4: split by concern (run lifecycle / approval / dispatch / fingerprint; contracts vs run-state vs protocol payloads) behind **barrel re-exports that preserve the public import surface** so the compat baseline stays green.
3. **Build clean race was only partially fixed.** 0.1.1 removed destructive `clean`, but the 2026-08-12 review reproduced import of partially emitted `dist` during concurrent compilers. → 0.2.3: lock emitters or atomically publish staged output.
4. **Workspace coverage summary has the wrong denominator.** 0.1.1 added reporting, but workspace rows include imported core `dist`, materially understating package coverage. → 0.2.3: package-local include filters, correct artifacts, and evidence-based thresholds.
5. **ACP sessions are not durable.** Modes/config report table defaults; the live task registry is in-memory (cap 512, FIFO), not persisted across restart (plans 010/012). → 0.1.6 (demand-gated): durable ACP session store behind a host-owned seam.
6. **Delegated-agent seams exist but are protocol-specific (A2A/ACP) with no generic "delegated coding host" contract.** Adding Cursor/Antigravity/Aider/Claude-Code-SDK as one-offs would duplicate the mapping. → deferred to 0.3.1: one generic delegated-agent contract + thin per-SDK adapters (see SDK evaluation).
7. **Observational-memory residual gaps.** Loaded-skill bodies and `ReadPathSet` are session-scoped in-memory only — checkpoint resume does not restore them (plans 003/004). `wrapResumeRun`/`attach` use a `sessionId` registry with no core lifecycle hook (plan 002). → 0.1.3/0.1.6: checkpoint persistence for loaded-skill names + read-path set (demand-gated).
8. **Live canary matrix is not recorded.** Real OIDC IdP + JWKS rotation, real OPA bundle pinning, real MCP OAuth AS (DCR + refresh/revoke), real S3-compatible store incl. KMS, and real NATS JetStream are documented as blocked protected gates, but CI runs only fakes (plans 009/011/012). → deferred to 0.3.0 as a named, env-gated, fail-loud gate.

### Elegance of implementation

- High. Discriminated-union events (`ProviderEvent`, `RealtimeEvent`, `CodingLifecycleEvent`), per-provider cache-control factoring, the `createOpenAICompatibleProvider` reuse pattern, and the model-only `provider-ai-sdk` are textbook clean seams.
- The `ponytail:` shortcut discipline (single-level scans, hand-rolled minimal glob, dependency-free conformance helpers, SigV4 over native fetch) is consistent and documented with ceilings — not accidental minimalism.
- Minor: a few providers hand-roll small `upstream.ts`/cache modules; plan 005 deliberately deferred a shared internal package until a third behavior package appears (YAGNI) — keep as-is.

### Performance opportunities

- The per-version benchmark runners (0.0.8–0.0.28) and the consolidated 0.1.0 runner are good; no regression risk identified at 0.1.0 budgets.
- Opportunities: (a) prompt-cache hit/miss telemetry surface per provider so hosts can tune `cache_aware` layout; (b) model-router cost/latency-aware routing and fallback chains (router state is durable since Phase 6 but selection policy is host-supplied); (c) tree-shaking gains from the `agents.ts`/`contracts.ts` split (0.1.4); (d) async `AgUiProjection` hooks so `messagesFromSession` can call `session.entries()` without a sync `getMessages` callback (plan 008, low priority). (a), (b), and (d) are 0.1.7.

### Setup and structure improvements

- **Prune superseded evidence runners.** `scripts/benchmark-0.0.{8,9,10,11,12,13,14,15,16}.mjs` and `scripts/benchmark-0.0.{23,24,25,26,27,28}.mjs` plus their `*.test.mjs` are mostly no longer wired into `npm test` (which runs only `benchmark-0.1.0.test.mjs` and the phase/e2e gates). Some are still referenced by `budget-gates.mjs`/`budgets.json`/`phase10-freeze-manifest.json`/`benchmark-0.1.0.mjs`. → 0.1.3: audit which are still imported, drop the rest, keep the checked-in `*.json` evidence; replace per-version runners with one parameterized runner + versioned evidence JSON.
- **Archive `docs/review-coverage-2026-07-*.md`** (12 phase-review files) into a single `docs/review-coverage-archive.md` or a `docs/_evidence/` folder; they are already excluded from the tarball but clutter `docs/`. → 0.1.3 (doc hygiene, low risk).
- **README/manifest-count narrative** still references "48 publishable vs 49 graph entries incl. root" in places; keep one canonical count in `docs/release-and-install.md` and have everything else link to it (plan 011 further action). → done in 0.1.1 (plan 013 Task 4).
- **DX: `prism providers add <name>` scaffold** that generates an OpenAI-compatible provider package from a template (manifest, `provider.ts`, `models.ts`, `cache.ts`, conformance test, `docs/providers/<name>.md`). → 0.1.7.

### Tools for coding agents and enterprise customers

- **Coding agent** (strong): repository ops, `repo_search` output modes, bounded `glob`, `delete`/`move`, optional `requireReadBeforeWrite`, `ProcessSession`, language intelligence (LSP), GitHub forge, allow-list egress, ACP interop.
- **0.1.6 coding closeouts shipped**: document reader, recursive delete, brace glob, native sandbox, durable ACP store, and checkpoint bodies/read paths. Current production gaps are PTY, scalable indexed search, multi-worktree/repository lifecycle, durable process/live-task recovery, patch-review workflow, and real protected coding journeys → 0.2.6.
- **Enterprise** (strong): OIDC/JWKS verifier, OPA policy adapter, MCP OAuth (RFC 9728/8414/7009, PKCE, audience-bound), OpenAPI tools, S3 artifact body store, durable `AgentEventSource` (Postgres LISTEN/NOTIFY + NATS JetStream), durable approvals, idempotency, retention/legal hold, audit.
- **Enterprise adapter breadth deferred**: Cedar policy adapter, second artifact body adapter, OpenAPI pagination beyond cursor, and the full live-canary matrix move to 0.3.x. MCP SSE relay coverage shipped in 0.1.1; ERP transaction/recovery readiness is new 0.2.7 work.

### Dead code and deprecations

- **Documented `@deprecated` surface** (candidates for the 0.1.5 breaking cut with migration notes): `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` (inert in first-party providers), `AgentConfig` `maxToolRounds` alias (use `limits.maxToolRounds`), `compaction-observational-memory` pre-0.0.19 flat keys, `read.ts` `transformImage` flag, `cli-init` `listInitProviders` (retained only for tests).
- **Orphaned benchmark runners** (see Setup): audit-and-prune in 0.1.3.
- **Unused-export sweep shipped in 0.1.3.** The 2026-08-12 run reports 30 unused-code diagnostics and 61 heuristic dead-export candidates; confirmed internals route to 0.2.5, while public removals require migration evidence.
- `ponytail:` comments are intentional shortcuts, not dead code; keep.

### Refactoring needs

- `agents.ts` and `contracts.ts` became compat-preserving barrels in 0.1.4; split remaining implementation god-modules in 0.2.5.
- Make umbrella docs truthful in 0.2.4; defer actual membership expansion to 0.3.0.
- Consolidate benchmark scripts to one parameterized runner (0.1.3).
- Remove inert deprecated provider options in the 0.1.5 breaking cut with `docs/migration.md`.
- Extract a shared delegated-agent adapter base only when ≥2 delegated adapters ship (0.3.1); do not pre-extract.

### Security review

- **No active vulnerabilities.** `npm audit --audit-level=moderate` = 0; tree locked at 317 deps; CodeQL/SAST, provenance, SBOM/license, secret scan, and supply-chain negative fixtures are wired into `release.yml`.
- **Residual controls to harden (not flaws, deferred gates)**:
  - Live canary matrix (real IdP/OPA/S3/MCP-AS/NATS) untested in CI — fakes only. → 0.3.0.
  - No real NATS JetStream server test suite (fake of the narrow seam only). → 0.3.0.
  - No automated test holds an MCP SSE stream open (long-lived teardown rejected for CI); production relays but the path is untested. → shipped in 0.1.1 (plan 013 Task 2, bounded relay asserted).
  - Hand-rolled SigV4 is single-chunk only (no multipart/accelerate) — upload size ceiling; upgrade path documented. → 0.3.2 (demand-gated).
  - ACP modes/config are not persisted by the agent — a naive host could leak cross-session/cross-tenant mode state if it persists without ownership scoping. → guidance note + ownership-scoped persistence example shipped in 0.1.1 (plan 013 Task 5); durable ACP session store → 0.1.6.
  - `requireReadBeforeWrite` state is session-scoped in-memory only — resume can overwrite unread files. Documented soft guard. → 0.1.3/0.1.6: checkpoint persistence.
- **Delegated-agent streams (Cursor/Antigravity) emit tool args/results that may contain secrets.** Any adapter MUST route through Prism's `SecretRedactor` and treat SDK tool payloads as untrusted. → 0.3.1 (with the adapters).

## SDK Evaluation: Models-Only vs. Full Harness

The user asked whether the Cursor and Antigravity SDKs can be used **for models only** (consuming their model/streaming interface) instead of also adopting their agent harness. The reference proof that model-only is possible in principle is `@arnilo/prism-provider-ai-sdk`, which wraps the Vercel AI SDK's `LanguageModelV4` (model interface) and maps its stream to `ProviderEvent`, ignoring the AI SDK's `Agent`/`tool`/`streamText` harness. That works **only because** the AI SDK cleanly separates the model interface from its agent loop.

### Cursor SDK (`@cursor/sdk`, TypeScript) — model-only: NOT possible

- Cursor's own docs state: *"The Cursor SDK is an agent SDK, not a standalone model-inference or chat-completions API. Router picks models for Cursor agent runs that can reason over a workspace, call tools, run commands, and edit files. Cursor does not currently document a raw Router endpoint for arbitrary model calls."*
- The only entry point is `Agent.create()` → `agent.send(prompt)` → `run.stream()` yielding `SDKMessage`/`InteractionUpdate` events (assistant text, `tool_call`, `thinking`, `usage`, `status`, `task`, `request`). That stream runs Cursor's full agent loop — tools, file edits, shell commands — either inline in Node (local) or in a Cursor-hosted VM (cloud).
- There is no `LanguageModelV4`-equivalent pluggable model seam and no raw model endpoint to wrap as a Prism `AIProvider`.
- **Integration path:** treat Cursor as a **delegated coding agent**, not a model provider. Wrap `Agent.create()`/`send()`/`stream()` in a 0.3.1 package that maps `SDKMessage`/`InteractionUpdate` → Prism `AgentEvent` through a generic delegated-agent contract, redacts tool payloads, and exposes it via the supervisor/delegated-agent seam (prompt in, structured events out). Use it for "let Cursor do this coding task and report back," never as the model behind Prism's own loop.

### Antigravity SDK (Python) — model-only: NOT possible

- Antigravity is a **Python** framework whose model layer is bound to **Gemini** (`GeminiAPIEndpoint` for the Gemini Developer API, `VertexEndpoint` for Vertex AI; default `gemini-3.6-flash`). There is no pluggable custom-language-model seam.
- The agent loop runs in a **Go `localharness` binary** the Python SDK talks to over WebSocket + protobuf. The `Connection.send(prompt)`/`receive_steps()` interface is the **agent loop**, not a model API.
- Prism **already ships** `@arnilo/prism-provider-google` (Gemini) and `@arnilo/prism-provider-vertex` — those *are* the models Antigravity uses. If the goal is only "use Antigravity's models in Prism," the SDK adds nothing; the providers already cover it.
- **Integration path:** use Antigravity as a **delegated coding agent** (0.3.1), mirroring the existing `provider-opencode-go` Go-binary-bridge pattern: spawn the Python sidecar (or the Go `localharness` directly), map `Step` events → Prism `AgentEvent`, expose via the delegated-agent seam. Do not adopt the Antigravity harness as Prism's runtime.

### Alibaba Cloud — already implemented; enrich, do not reimplement

- `@arnilo/prism-provider-alibaba` already exists and ships OpenAI-compatible Chat Completions against Model Studio / DashScope (pay-as-you-go regional, workspace-dedicated, and Coding Plan endpoints), with `enable_thinking`, cache-control markers, multimodal image, and structured output.
- **0.1.2 work** = gap-fill within the existing provider: Bailian (Model Studio) endpoints for embeddings/rerank/text-to-SQL where OpenAI-compatible, document/video input where supported, and conformance coverage. These stay provider-side, not new modules.
- **0.3.2** = broader Alibaba Cloud platform adapters (Bailian rerank/embeddings into `@arnilo/prism-rag`, OSS as a second `ArtifactBodyStore`) as optional, demand-gated packages.

### Conclusion

The model-only pattern is **available for SDKs that separate model from loop** (AI SDK ✓). It is **not available** for Cursor or Antigravity, whose only public surface is the bundled agent loop. The honest integration is delegated-agent adapters (0.3.1), not model providers. Alibaba is enrichment on the 0.1.x provider line.

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

1. 0.2.0 security blockers precede provider/network hardening, concurrency fixes, release tooling, package/docs cleanup, refactoring, and consumer-specific additions.
2. Each 0.2.x milestone gets a numbered plan with primitive review where public capabilities change, threat model, tests, measurable acceptance criteria, and operational owner.
3. Bug fixes live at the shared root-cause boundary and carry one direct runnable regression; protocol adapters are never the sole validator for core security invariants.
4. Deletion/consolidation beats new abstraction. Extract shared code only for repeated bounded transports, persistence codecs, or state machines already proven in multiple implementations.
5. No new provider/delegated-agent/enterprise-adapter catalog work starts before the 0.2.x release-integrity gate is green; former 0.2.x work is sequenced under 0.3.x.
6. Breaking 0.2.x changes require `docs/migration.md`, compatibility-baseline evidence, and fail-loud handling of removed or changed fields.
7. Every release records protected evidence (Postgres, NATS, identity/policy, providers, sandbox/browser, benchmarks) as blocked when required infrastructure is absent—never as an unexplained skip.

## Versioning Policy

- **0.1.x:** complete at 0.1.7. Historical tasks below remain as implementation record; no new work is added to this line.
- **0.2.x:** comprehensive-review remediation and production readiness. 0.2.0 may make documented security-motivated contract changes (notably sandbox capability metadata); later 0.2.x releases prefer additive fixes. Every breaking delta gets migration and refusal tests.
- **0.3.x:** all work formerly scheduled for 0.2.x: protected live-service matrix, provider catalog expansion, delegated coding-agent adapters, enterprise adapter breadth, and delegated-agent observability. These remain demand-gated and start only after 0.2.x foundations are green.
- **1.0:** operator-gated, not automatic; requires the full protected matrix (supported Node versions, multi-Postgres, NATS, live identity/policy/provider/object-store canaries, browser/sandbox, and protocol pins) plus stable 0.2/0.3 contracts through at least one patch cycle.

## Roadmap — 0.1.x Line

Historical implementation record: plans 013–019 completed releases 0.1.1–0.1.7. Checkboxes reflect implemented state; remaining expansion deferrals are routed to 0.3.x by the 2026-08-12 resequencing.

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

### 0.1.2 — Alibaba Cloud provider enrichment

- [x] **Alibaba provider gap-fill.** Extend `@arnilo/prism-provider-alibaba` with Bailian (Model Studio) endpoints where OpenAI-compatible (embeddings via `POST {base}/embeddings`; rerank only if a documented OpenAI-compatible route exists; text-to-SQL only if exposed via chat), document/video input where supported (compatible-mode `video_url`/document content parts), and expanded conformance. Native-only surfaces (async task polling via `X-DashScope-Async`, native rerank) are documented deferrals, not new runtime. Keep the OpenAI-compatible base; no new runtime deps.
  - Acceptance: new endpoints covered by conformance; `docs/providers/alibaba.md` updated; cache-control + `enable_thinking` regression green; budget gate green.
- [x] **Defer Alibaba Cloud platform adapters** (Bailian rerank/embeddings into RAG, OSS artifact store) to 0.3.2 as demand-gated optional packages.

### 0.1.3 — Dead-code and deprecation hygiene

- [x] **Prune superseded benchmark runners.** Audit `scripts/benchmark-0.0.*.mjs`/`*.test.mjs` references; drop the orphaned ones, keep the checked-in `*.json` evidence; introduce one parameterized benchmark runner + versioned evidence JSON (setup).
  - Acceptance: `npm test` references only current runners; removed files listed in the release changelog; benchmark evidence preserved.
- [x] **Archive phase-review docs.** Move `docs/review-coverage-2026-07-*.md` into `docs/_evidence/` (excluded from tarball, linked from `docs/0.1.0-readiness.md`).
  - Acceptance: `docs/` root cleaned; evidence links intact; docs tripwires green.
- [x] **Unused-export sweep (non-blocking).** Add a `tsc --noUnusedLocals`/`--noUnusedParameters` scan or an `knip`-style CI step that reports dead exports without failing the build.
  - Acceptance: report produced; obvious dead exports removed or marked `ponytail:` intentional.
- [x] **Checkpoint persistence for loaded-skill names + ReadPathSet** (plans 003/004 further actions, demand-gated). If a host needs resume-without-model-reload, persist loaded-skill names and the read-path set in the checkpoint; bodies reload on resume via `load_skill`.
  - Acceptance: resume restores loaded-skill catalog + read-before-write state; cross-branch non-leak test; opt-in to avoid size growth.

### 0.1.4 — God-module split (compat-preserving)

- [x] **Split `src/agents.ts`** into run-lifecycle, approval/pending-decisions, tool dispatch, and fingerprint modules behind barrel re-exports in `src/agents.ts` so public imports are unchanged. Split `src/contracts.ts` into core contracts, run-state, and protocol-payload modules behind `src/contracts.ts` barrel.
  - Acceptance: public import surface unchanged (compat baseline green); `agents.ts`/`contracts.ts` files become barrels; tree-shaking improves (measured); `sdk:ready` green.

### 0.1.5 — Deprecated-option removal (breaking, documented)

- [x] Remove inert `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs`, `AgentConfig.maxToolRounds` alias, `compaction-observational-memory` pre-0.0.19 flat keys, `read.ts` `transformImage` flag, `cli-init` `listInitProviders`. Add `docs/migration.md` 0.1.4 → 0.1.5 section with the removed symbols and replacements.
  - Acceptance: removed symbols absent from `.d.ts`; migration notes present; compat baseline updated (intentional breaks recorded); `sdk:ready` green.

### 0.1.6 — Coding-agent capability closeouts (demand-gated)

- [x] **Durable ACP session store** + **native sandbox backend** (network-free) — host-owned seams revisited on demand with a threat model (plan 012 further action).
- [x] **PDF/Office document reader** as a bounded host-selected parser adapter (plans 004/roadmap non-goals).
- [x] **Recursive `delete`** and **brace-expanding `glob`** if pattern/usage demand justifies it (plan 004 further actions).
- [x] **Checkpoint persistence** for `ReadPathSet` + loaded-skill bodies if 0.1.3's names-only persistence is insufficient.
  - Acceptance: each closeout behind its own plan with primitive review + threat model; budget/security gates green.

### 0.1.7 — Performance and DX

- [x] **Prompt-cache telemetry surface** per provider (hit/miss, cache tokens) so hosts tune `cache_aware` layout.
- [x] **Model-router cost/latency-aware routing + fallback chains** (router state is durable; selection policy becomes host-configurable with a reference policy).
- [x] **Async `AgUiProjection` hooks** so `messagesFromSession` can call `session.entries()` without a sync `getMessages` callback (plan 008, low priority).
- [x] **`prism providers add <name>` scaffold** (DX) generating an OpenAI-compatible provider package from a template with conformance + docs.
  - Acceptance: telemetry/redaction/budget gates green; DX scaffold produces a passing provider package; no core deps added.

## 2026-08-12 Review Evidence and Release Order

Clean sequential verification passed core and all workspace suites: **3,334 tests total, 3,301 passed, 33 protected/live skips, 0 failures**. Core coverage was **91.92% lines / 84.19% branches / 91.35% functions**; package-only recomputation exposed an incorrect workspace denominator in `scripts/coverage-summary.mjs`. Typecheck, format, audit, secret scan, and dependency checks passed. A concurrent build/coverage run reproduced partial `dist/` imports, and direct runtime probes confirmed the resume-decision and subprocess-environment defects.

Release order is mandatory: **security blockers → provider/network trust → state concurrency → build/test integrity → packaging/docs → maintainability → coding-agent readiness → ERP readiness**. New catalog breadth waits for 0.3.x.

## Roadmap — 0.2.x Review Remediation and Production Readiness

Each milestone requires its own numbered plan. Plans that add or change a public capability must begin with primitive review and include a threat model, operational owner, migration impact, package budget, task-specific documentation assessment, and measurable exit gate.

### 0.2.0 — Fail-closed runtime and sandbox security

- [x] **Reject unknown durable-resume decisions in core.** Validate single and batched decision discriminants inside `prepareAgentRunResume`/`resumeAgentRun` before state claim, transition, or tool execution; HTTP/server validation remains defense in depth, not the security boundary.
  - Acceptance: `decision: "sideways"`, malformed batches, and JavaScript/untyped callers fail with a stable Prism error; no CAS write or tool call occurs; approve/deny and legacy migration paths remain green.
- [x] **Isolate work-tool subprocess environments.** Replace `{...process.env}` in `packages/work-tools/src/cli.ts` with a minimal base (`PATH` plus required locale/platform keys), explicit host allow-list, fixed CLI controls, and late-bound per-identity credentials. Require absolute host-pinned executable and config paths; accumulate bounded stdout/stderr chunks without repeated `Buffer.concat`.
  - Acceptance: unrelated `process.env` canaries never reach `exec`; token stays out of argv/errors/output; NUL, path, abort, timeout, and byte limits stay fail closed.
- [x] **Replace ambiguous sandbox containment boolean with explicit capabilities.** Distinguish workspace wiring/coherence from filesystem, network, process, and privilege isolation. Native sandbox must report filesystem isolation false; unknown/custom adapters cannot claim capabilities they do not attest. Keep a deprecated compatibility projection only if migration evidence requires it.
  - Acceptance: native/custom composition cannot claim filesystem containment; Docker reports only verified controls; mixed wiring remains warned and uncontained; `docs/coding-security.md` and `docs/migration.md` define the threat model.
- [x] **Security regression and release gate.** Add direct public-API adversarial tests for all three blockers and a packed-JavaScript consumer test so TypeScript types cannot hide runtime validation gaps.
  - Acceptance: focused regressions, `security:threat-suites`, `sdk:ready`, packed install, compatibility baseline, audit, and secret scan pass; 0.2.0 does not ship while any blocker is skipped.

### 0.2.1 — Provider completion and outbound trust boundaries

- [x] **Require completion evidence for every streaming provider.** Make strict completion the shared default, or enable it explicitly for Azure, Bedrock, Vertex, OpenRouter, ZAI, NeuralWatt, and every other OpenAI-compatible adapter. EOF without required done marker/finish reason must emit provider error, never successful `providerDone`.
  - Acceptance: shared truncated-stream conformance covers every first-party streaming adapter; valid provider-specific terminal variants remain supported and documented.
- [x] **Bound all upstream success bodies while streaming.** Add/reuse one dependency-free bounded response reader for provider model discovery, OpenAI uploads, OAuth device/token flows, NeuralWatt quota, Alibaba embeddings, and other non-stream JSON endpoints. Replace unbounded `response.json()`/`response.text()`; enforce UTF-8 bytes, JSON depth/property/aggregate caps, schema checks, aborts, and redacted errors.
  - Acceptance: oversized chunked bodies terminate before full buffering; ten model-discovery implementations and all credential/upload paths pass shared bounds tests; normal payload behavior is unchanged.
- [x] **Pin outbound DNS/address decisions.** Reuse the strongest existing MCP transport resolution/pinning primitive for OIDC JWKS, OPA, content fetches, and equivalent SSRF-sensitive calls; redirects must be disabled or independently revalidated and repinned.
  - Acceptance: private resolution, mixed public/private answers, metadata targets, redirects, DNS rebinding, IPv4/IPv6 edge cases, and aborts fail closed.
- [x] **Consolidate duplicated OAuth and provider parsing.** Share bounded device-code/token polling and error mapping between core OpenAI OAuth and `credentials-node`; keep provider-specific fields at adapters. Do not create a generic transport framework beyond repeated behavior.
  - Acceptance: authorization-pending, slow-down, expiry, cancellation, malformed JSON, oversized body, secret redaction, and token-shape tests run once against both adapters.
- [x] **Fix credential, signing, upload, and cache edge cases.** Resolve Azure/Vertex credentials once per request; canonicalize Bedrock duplicate header casing and repeated query parameters; retain failed OpenAI upload cleanup IDs for retry; keep overflow cache telemetry from applying one model's cost to mixed-model tokens.
  - Acceptance: rotating/single-use credentials, SigV4 duplicate-case/query fixtures, cleanup retry, and mixed-model overflow produce deterministic correct results.

### 0.2.2 — Concurrent state and durability integrity

- [x] **Add atomic model-budget reservation.** Extend memory and durable router state stores with reserve/commit/release semantics so concurrent admissions cannot collectively exceed budget; define crash/lease expiry and unknown-usage reconciliation. Cap and evict rate/budget maps as well as circuit maps.
  - Acceptance: parallel admission cannot oversubscribe; abandoned reservations expire deterministically; PostgreSQL and memory conformance agree; diagnostics stay bounded/redacted.
- [x] **Make conversation metadata updates atomic.** Add version/CAS updates or append-only branch records for create, branch, archive, and delete metadata. Preserve ownership and branch caps without lost updates or stale archive resurrection.
  - Acceptance: concurrent branch+branch, branch+archive, duplicate create, and delete/retention/legal-hold races preserve all valid state or return an explicit conflict.
- [x] **Enforce single-consumer and resumable-registry semantics.** `createEventMultiplexer` must reject a second subscriber or deliberately support broadcast; NATS subscriptions must use restart-stable durable identity when durable recovery is claimed; in-process active-run registries need bounded lifecycle cleanup and explicit non-durable documentation.
  - Acceptance: duplicate subscribers, restart/resume, terminal cleanup, leaked registration, abort, cursor, and cross-tenant cases are deterministic.
- [x] **Add multi-process state conformance.** Run approval, cursor, checkpoint CAS, idempotency, router reservation, conversation metadata, and unknown-outcome recovery against memory and durable implementations.
  - Acceptance: stale versions/fences reject, ownership never crosses tenants, retries are idempotent, and no test relies on timing-only sleeps.

### 0.2.3 — Build, coverage, and release evidence integrity

- [x] **Prevent partial live `dist/` imports.** Serialize emit-producing commands with a portable lock or compile core/workspaces into staging directories and atomically publish outputs. Keep explicit clean for branch/deletion hygiene; do not assume concurrent `tsc` writes are transactional.
  - Acceptance: repeated concurrent build+test, two builds, typecheck+test, and coverage+test stress runs never produce missing exports or partial modules; stale outputs are detected.
- [x] **Correct workspace coverage denominators.** Add package-local `--test-coverage-include=dist/**` (or equivalent resolved package path), preserve core gate, and introduce evidence-based package thresholds with protected-integration exceptions shown separately.
  - Acceptance: reports exclude imported core files; known recomputed package percentages are reproduced; security/persistence branch gaps cannot silently regress; JSON artifact records skips and denominator.
- [x] **Make skipped protection visible.** Default local tests may skip unavailable infrastructure, but release summaries must name every skipped live/protected suite and mark required environments blocked. Keep full live-service expansion scheduled for 0.3.0.
  - Acceptance: clean release report accounts for all tests, including the current 33 protected/live skips; required release profiles cannot convert missing credentials/services into green.
- [x] **Stabilize quality gates.** Resolve current Biome warnings/infos, migrate deprecated Biome configuration, quarantine or replace load-sensitive timing assertions, and make lint/format/unused reports machine-readable.
  - Acceptance: zero unexplained lint diagnostics; document-reader performance checks use deterministic envelopes; quality artifacts are retained by CI.

### 0.2.4 — Package, documentation, and compatibility truth

^- [x] **Make package claims match manifests.** Correct README/profile wording for `prism-providers` and `prism-all`; explicitly list current omissions (`document-reader`, `openapi-tools`, `session-store-nats`, Caveman, Ponytail) without changing umbrella membership in 0.2.x. Actual catalog/membership expansion remains deferred to 0.3.0.
  - Acceptance: no page claims “every” or “all” unless dependency closure proves it; packed-install tests assert documented contents.
^- [x] **Generate package/version/profile tables.** Use manifests as the single source for package count, provider membership, version, profile closure, and release status. Refresh `docs/0.1.0-readiness.md`, `docs/index.md`, `docs/release-and-install.md`, root/package READMEs, roadmap completion status, and changelogs for the 0.1.7 baseline.
  - Acceptance: generated checks catch drift; stale 0.1.1/0.0.23 “current line” text and contradictory provider counts are gone.
^- [x] **Define peer-version policy.** Decide whether exact `@arnilo/prism: 0.1.7` peers remain required until compatibility stabilizes or move to a tested compatible range; document atomic-upgrade expectations and verify mixed supported patches in packed installs.
  - Acceptance: policy is explicit, third-party adapters have a supported range story, unsupported mixtures fail clearly, and release automation enforces internal consistency.
^- [x] **Keep docs semantic, not phrase-only.** Add structural tests for generated navigation/package data and remove stray/truncated roadmap text; do not add brittle prose snapshots.
  - Acceptance: docs tests fail on wrong package closure/version/navigation while permitting editorial changes.

### 0.2.5 — Maintainability and bounded performance

- [x] **Split remaining god-modules by cohesive state machine.** Prioritize `src/agent-session.ts` (run setup, provider turn, durable suspension, tool round, persistence/ledger), then `contracts-core`, workflow run, server handler, repository, and ACP agent. Preserve public barrels and avoid one-implementation interfaces/factories.
  - Acceptance: behavior/exports remain compatible or migrated; complexity and file-size reductions are measured; hot-path benchmarks and tree-shaking do not regress.
- [x] **Deduplicate PostgreSQL/SQLite persistence mechanics.** Move proven shared ownership filters, cursor codecs, schema/migration checks, lifecycle/checkpoint shapes, metadata parsing, and search clipping into `session-store-codecs`; leave SQL dialect/query execution in each adapter.
  - Acceptance: cross-store conformance proves identical semantics; no generic ORM/query builder or new runtime dependency is added.
- [x] **Remove quadratic bounded accumulation.** Replace repeated `Buffer.concat` in language framing, tar parsing, and CLI capture with chunk arrays or bounded ring/stream processing; retain byte caps and abort behavior.
  - Acceptance: near-limit benchmarks show linear copying and bounded peak memory; overflow remains fail closed.
- [x] **Finish dead-code cleanup.** Remove stale `agent-session` imports/constants, `cache-telemetry` locals, `skill-load` map/scans, and confirmed dead exports; preserve intentionally public exports and documented `ponytail:` ceilings.
  - Acceptance: unused sweep is clean or has explicit reviewed allow-list; no package API disappears without migration evidence.
- [x] **Close low-coverage core behavior.** Add focused tests for conversations, artifacts, approval, compaction, and weak conformance-helper branches; test behavior rather than line count.
  - Acceptance: every new branch/loop/parser/security path leaves one runnable regression; package and core thresholds stay above recorded baselines.

### 0.2.6 — Fully featured coding-agent readiness

- [ ] **Host-selected PTY/interactive terminal backend.** Add a process-session adapter only after primitive review; keep non-interactive execution as default and unsupported hosts fail closed.
- [ ] **Scalable indexed code-search seam.** Preserve bounded literal search as default; add an optional incremental index/semantic backend contract for large monorepos with explicit resource, trust, and stale-index semantics.
- [ ] **Multi-worktree and multi-repository lifecycle.** Define ownership, cleanup, branch isolation, checkpoint identity, and artifact correlation across repositories/worktrees.
- [ ] **Forge breadth on demand.** Add GitLab/Bitbucket only for named consumers, behind existing forge primitives; no broad catalog.
- [ ] **Durable coding-session recovery.** Make ACP/live tasks and managed process metadata recoverable across restart/replicas or explicitly return unknown/unsupported; preserve cancellation and approval/effect correlation.
- [ ] **Patch/review and diagnostics workflow.** Add bounded review artifacts, incremental LSP/check diagnostics, and clear accepted/rejected patch state without a second agent runtime.
- [ ] **Coding release journey.** Gate a real Docker/browser/provider/forge coding task covering edit, shell, approval, restart, recovery, review, and cancellation.
  - Acceptance: each capability has a threat model, limits, ownership tests, no implicit activation, package budget, docs/index entry, and protected end-to-end evidence; sandbox fixes from 0.2.0 are prerequisite.

### 0.2.7 — Enterprise ERP production readiness

State management and Eval framework. Subagents.

- [ ] **Transactional outbox/inbox.** Provide host-owned primitives for committing ERP mutation intent with application state and idempotently dispatching/consuming effects; retain at-least-once semantics and explicit unknown outcome.
- [ ] **Saga compensation and reconciliation.** Add durable compensation plans, forward/rollback status, retry policy, manual intervention, and immutable evidence for multi-step business workflows.
- [ ] **Multi-party and separation-of-duties approvals.** Support role/quorum rules, requester/approver separation, expiry, revocation, delegated authority, and complete audit provenance.
- [ ] **Tamper-evident audit export.** Add signed/hash-chained export with WORM/object-store and SIEM sink seams; preserve redaction, legal hold, retention, and tenant boundaries.
- [ ] **Secret-manager adapters.** Add Vault/AWS/Azure/GCP adapters only behind one credential-source contract and named deployment demand; never read ambient environment implicitly.
- [ ] **HA registries and recovery.** Remove process-local correctness dependencies from enterprise ACP/conversation/workflow paths; define lease, failover, cursor, and split-brain behavior.
- [ ] **Backup, restore, and migration rollback evidence.** Document and test PostgreSQL/session/artifact recovery, schema rollback/refusal, point-in-time objectives, and disaster-recovery drills.
- [ ] **Field-level data classification and redaction.** Apply policy-driven classification to prompts, tool args/results, artifacts, audit, telemetry, and exports with fail-closed defaults.
- [ ] **ERP release journey.** Exercise identity, policy, budget reservation, SoD approval, outbox mutation, compensation, audit export, legal hold, replica failover, and restore.
  - Acceptance: atomicity/recovery invariants are documented and tested; no exactly-once claim; security/performance/storage budgets pass. “ERP production ready” remains blocked until the 0.3.0 live-service matrix is recorded.
  
### 0.2.8 - Coding agent capabilities

- Background observer (Observational Memory, Recall, Tool use, Skill activation, Input token suppression)
- Vent
- Ponytail and Caveman
- Evaluate all of the coding tools to make sure it has all the capabilities required for coding agents to do the job in the most correct and efficient way.
- Computer use package: Linux

### 0.2.9 - Autonomous updates for packages other than core
- Setup docs and skills such that only packages with updates get released
- Not all packages are needed to be updated with the same version
- Deepseek API with stable cache prefix

### Mandatory 0.2.x regression matrix

Before 0.2.x closes, automated tests must prove:

1. Unknown durable-resume decisions fail before CAS/tool execution.
2. Work CLI receives no unrelated host environment variables.
3. Native/custom sandbox metadata cannot claim unverified filesystem isolation.
4. Concurrent emit builds plus an importer never observe partial `dist`.
5. Truncated streams fail for every first-party provider.
6. Oversized chunked JWKS/JSON responses stop while streaming.
7. Private DNS resolution, redirect repinning, and rebinding are rejected.
8. Concurrent conversation branch/archive/create operations preserve valid state.
9. Parallel router admissions cannot exceed reserved budget.
10. Cache overflow cannot report mixed-model savings under one model's cost.
11. Bedrock signing handles case-insensitive duplicate headers and repeated query keys.
12. Workspace coverage excludes imported core files and records protected skips.

## Roadmap — 0.3.x Deferred Expansion

Everything in this section was previously scheduled for 0.2.x and is intentionally deferred. No implementation starts until 0.2.x exit gates pass.

### 0.3.1 — Protected live matrix, provider catalog, and umbrella membership

- [ ] **Record the protected live-canary matrix** as a named, env-gated, fail-loud gate: real OIDC IdP + JWKS rotation, OPA bundle pinning, MCP OAuth AS including DCR/refresh/revoke, S3-compatible store with KMS, NATS JetStream, keychain, supported providers, Docker sandbox, and Playwright browser. Missing required credentials are blocked release evidence, not silent skips.
  - Acceptance: `npm run test:live` (or equivalent) emits `canary-report.json`; protected CI supplies environments and gates release publication.
- [ ] **Live NATS JetStream suite.** Add `test:nats` against a real server, covering append/subscribe/reconnect, dedupe window, restart-stable durable consumers/cursors, cleanup, and failover; retain fake-seam tests in default suite.
- [ ] **New OpenAI-compatible providers.** Add only demanded ecosystems (xAI, Mistral, DeepSeek, Groq, Together, Cohere, Fireworks, Cerebras, Friendli, NovitaAI candidates) as thin packages over existing compatible bases with model discovery, bounded transports, strict completion, cache support, conformance, docs, and package budgets.
- [ ] **Umbrella membership fix.** Make `prism-providers` the documented complete first-party model-provider family or define a stable narrower rule; make `prism-all` membership intentional, including decisions for document-reader, OpenAPI tools, NATS, Caveman, and Ponytail.
  - Acceptance: dependency closure matches claims; release/pack/installation tests pass; core gains no runtime dependency.

### 0.3.1 — Delegated coding-agent adapters (Cursor, Antigravity)

- [ ] **Generic delegated-agent contract** after primitive review: prompt in → `AgentEvent` stream out, with redaction, ownership, approval/effect mapping, durable correlation, and host cancellation. Extract only because both adapters are planned.
- [ ] **`@arnilo/prism-cursor`.** Wrap Cursor's full agent SDK as a delegated coding agent, never an `AIProvider`; support host-selected local/cloud runtime and fail closed when optional SDK/credentials are absent.
- [ ] **`@arnilo/prism-antigravity`.** Wrap Python sidecar or Go `localharness`, map steps to Prism events, and treat Gemini/Vertex model-only use as already covered by Prism providers.
- [ ] **Docs, conformance, and observability hooks.** Add redaction, ownership, approval, cancellation, restart, payload-bound, and package-budget tests plus `docs/delegated-agents.md` and navigation.
  - Acceptance: adapters run behind Prism identity/policy/approval/effect contracts; tool payloads are redacted; cross-tenant isolation and cancellation hold; no implicit activation.

### 0.3.2 — Enterprise adapter breadth (demand-gated)

- [ ] **Cedar policy adapter** behind `PolicyEvaluator` for a named integration.
- [ ] **Second `ArtifactBodyStore` adapter** such as Alibaba OSS or Azure Blob; add multipart SigV4 only when the current upload ceiling is demonstrated.
- [ ] **OpenAPI pagination beyond cursor** for demanded offset/Link-header APIs.
  - Acceptance: each adapter passes conformance, redaction, ownership, bounds, live-service, and budget gates; demand and operational owner are recorded.

### 0.3.3 — Delegated-agent observability

- [ ] Add OpenTelemetry spans for delegated runs/steps/tool calls through `observability-opentelemetry`, correlated by request/run IDs with redacted and bounded attributes.
  - Acceptance: spans and failure/cancellation status pass conformance without raw tool payload leakage.

## Consolidated Compromises (from plans 001–012)

These design ceilings are inherited from the 0.0.x phase plans and remain in force unless a 0.2.x remediation or 0.3.x expansion plan explicitly lifts them. Each lists the ceiling and the upgrade path.

- **001 (0.0.18):** `repo_search` is literal-only (regex removed, not worker-isolated) — hosts needing regex supply a bounded backend. Atomic write/edit is same-filesystem temp+`rename` only — custom ops hosts must match durability. Default `inputLayout` flip to `cache_aware` is breaking — `legacy` is the explicit opt-in. Readiness evidence table still carries the 0.0.16 historical floor; operator refreshes at 1.0.
- **002 (0.0.19):** Empty-pass coverage markers append only when the worker runs; the dropper runs only after a reflection records ≥1 fact. `wrapResumeRun`/`attach` use a `sessionId` registry — no core lifecycle hook added.
- **003 (0.0.20):** Loaded-skill name/read-path persistence shipped opt-in in 0.1.3 and body persistence in 0.1.6. Remaining ceilings: `toolResultFold` stays off by default; registry empty-default + progressive catalog still use explicit `activateAllSkills` / `skillsDisclosure: "eager"` migration.
- **004 (0.0.21):** PDF/Office reading, ProcessSession, LSP, recursive delete, brace glob, and read-path checkpoint persistence are closed through 0.1.6. Remaining ceilings: no trash daemon or PTY; fuzzy edit may silently accept one normalized match while multi-match fails closed; glob remains hand-rolled and bounded.
- **005 (0.0.22):** Each package duplicates a small `upstream.ts` (no shared internal package) — extract only if a third behavior package appears. `caveman-stats` dispatches skill metadata only (no Claude session-log hook). `caveman-init` returns guidance text (does not run `caveman-init.js`). `ponytail-subagent` hook is host metadata only (not wired). No TUI statusline shell scripts (Prism is a harness).
- **006 (0.0.23):** Release preflight used `--allow-dirty --allow-untagged` on an implementation checkout (not a tagged publish). Protected PostgreSQL evidence recorded on disposable `postgres:16-alpine` / Node v24.18.0 Linux x64.
- **007 (0.0.24):** Root tarball budget baselines remain +5% gated; protected PostgreSQL evidence remains authoritative. The destructive clean race closed in 0.1.1, but concurrent emitters can still expose partial live `dist` → 0.2.3.
- **008 (0.0.25):** A2UI remains in `docs/ag-ui.md`; hashed nested approval IDs stay under the 128-character cap. FR-3/FR-4/FR-5 shipped by 0.0.26; full release evidence follows the current checklist.
- **009 (0.0.26):** NATS tests are network-free over a fake of the narrow seam (no real server — see 0.3.0). NATS `append` idempotency is bounded by the stream dedupe window (not a permanent unique constraint); `cleanup` is O(limit) delete calls; `subscribe` resumes via cursors not durable-name reuse; stream provisioning is host-owned; `reconnectInitialMs`/`reconnectMaxMs` accepted but unused (the official client owns reconnection). A2A server-side exposure is non-generic: single in-memory stream consumer per live task; live task registry in-memory (cap 512, FIFO, no persistence); A2A parts `raw`/`data`/`url` disabled unless the host `parts` policy selects them.
- **010 (0.0.27):** Experimental ACP SDK fields remain excluded; elicitation remains client-consumed only; unsupported lifecycle events remain unshipped. Durable ownership-scoped ACP state shipped in 0.1.6. Lifecycle delivery is stream-scoped. Workspace coverage reporting shipped in 0.1.1 but its denominator needs correction in 0.2.3.
- **011 (0.0.28):** Fake-server gate; live endpoints deferred (see 0.3.0). OPA only (no Cedar) and one object-store adapter (S3-compatible) — seams stay swappable. Hand-rolled SigV4 single-chunk presign/put/get (no `@aws-sdk/client-s3`, ~1 MB saved); multipart/accelerate/non-path-style out of scope (see 0.3.2). OpenAPI mutation idempotency is core-managed, not a per-adapter store. Test harnesses 405 on standalone GET SSE rather than relaying a long-lived stream (see 0.1.1). Discovery cache is single-entry with a TTL cap per provider instance.
- **012 (0.1.0):** Signed `v0.1.0` tag is an operator action (no GPG key in the build env); dry-run + refusal paths are machine-verified, the signature is not. Clean-checkout `sdk:ready` verified against a local clone of HEAD + the working diff, not a pushed CI run. Compat baseline regenerated for the `0.1.0` version literal. `security:threat-suites` runs Phase 8–11 conformance as one named leg (Phase 7 tenant suite stays under `test:postgres`). Live canaries keep an env-gate silent-skip for local runs (protected workflows set the env — see 0.3.0).

## Consolidated Further Actions (from plans 001–012, status reconciled)

Closed items are marked **done**; open historical expansion items are routed to 0.3.x, while review remediation is routed to 0.2.x.

- **001:** Phase 2 plan created — **done**. Operator publish of `v0.0.18` — **done** (tag exists). Phase 4 coding gaps — **done** (Phase 4 shipped 0.0.21).
- **002:** Phase 3 execute — **done** (0.0.20).
- **003:** Phase 4 next — **done**. Phase 5 Caveman/Ponytail consuming Phase 3 — **done** (0.0.22). Future 0.0.x checkpoint persistence for loaded-skill names — **→ 0.1.3**. Release handoff 0.0.20 — **done**.
- **004:** Tag/publish 0.0.21 — **done**. Phase 5 next — **done**. Checkpoint persistence for `ReadPathSet`/loaded-skill names — **→ 0.1.3 / 0.1.6**. Recursive delete / brace glob if demand — **→ 0.1.6**.
- **005:** Tag/publish 0.0.22 — **done**.
- **006:** Commit, tag `v0.0.23`, clean preflight — **done**. Phase 7 next — **done** (0.0.24).
- **007:** Cut signed `v0.0.24` + protected Postgres + publish dry-run — **done**. Non-destructive workspace rebuild path (concurrent cleans) — **→ 0.1.1**. Public `deriveToolEffectKey` export if hosts need offline key derivation — **demand-gated (0.3.x)**. Phase 8 builds on frozen seams — **done** (0.0.25).
- **008:** Cut signed `v0.0.25` + `sdk:ready` + publish dry-run — **done**. FR-3 reasoning encrypted-value helper — **done** (0.0.26). FR-4 MCP Apps UI-initiated mutation retry — **done** (0.0.26). FR-5 NATS JetStream `AgentEventSource` — **done** (0.0.26, fake-seam; **live suite → 0.3.0**). Async `AgUiProjection` hooks — **→ 0.1.7**.
- **009:** Live NATS integration suite — **→ 0.3.0**. FR-3/4/5/6/7 shipped 0.0.26 — **done**. Tasks 13–15 (A2A server-side exposure, frontend renderer, async `AgUiProjection`) — **done** in 0.0.26. Phase 10 ACP mapping — **done** (0.0.27). Operator handoff (48 manifests) — **done**.
- **010:** (Plan left "to be filled after task completion.") Material deferred items recorded above: deferred lifecycle events, modes/config persistence, durable ACP session store — **→ 0.1.6**; MCP SSE relay test — **→ 0.1.1**; coverage summary — **→ 0.1.1**.
- **011:** Record protected live-canary matrix — **→ 0.3.0**. MCP SSE coverage — **→ 0.1.1**. Cedar, second artifact adapter, OpenAPI pagination — **→ 0.3.2 (demand-gated)**. Manifest-count narrative — **→ 0.1.1**.
- **012:** Operator publication of 0.1.0 (signed tag + npm OIDC) — **tag exists; npm publish remains operator action**. Phase 13 demand evidence — **this roadmap's 0.3.x demand gates**. Node 22 CI leg + multi-Postgres CI legs on-demand — **demand-gated**. Durable ACP session store + native sandbox backend — **→ 0.1.6 (demand-gated)**.

## Proposed New Features (summary)

- **0.1.x — complete:** Alibaba enrichment; hygiene; module split; breaking-option cleanup; coding closeouts; cache telemetry; cost/latency routing; async AG-UI projection; provider scaffold.
- **0.2.x — review remediation:** fail-closed resume/subprocess/sandbox behavior; provider/network bounds and completion; atomic budgets/conversations; build/coverage integrity; package/docs truth; focused refactors; production coding-agent capabilities; ERP transactions, recovery, approvals, audit, secrets, and DR.
- **0.3.x — deferred former 0.2.x work:** protected live-service/NATS matrix, provider catalog and umbrella membership, Cursor/Antigravity delegated-agent adapters, Cedar/object-store/OpenAPI adapter breadth, and delegated-agent telemetry.
- **Demand-gated beyond 0.3.x:** Studio/control plane and visual workflow editor; hosted cloud and managed observability; Slack/Teams/channel catalogs, voice/device, desktop OS control; remote-browser/sandbox vendors; further forges/queues/policy engines/object stores/databases/vector stores/providers; advanced GraphRAG/semantic chunking; cron/calendar/event triggers. Each needs a named user, operational owner, threat model, measurable acceptance, and numbered plan.

## Release Validation Checklist

Every 0.2.x and 0.3.x release must satisfy:

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
- A second agent runtime; all new capabilities extend the current sessions/ledgers/checkpoints/leases/workflows/tools/events.
