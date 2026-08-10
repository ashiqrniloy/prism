# Changelog

## [0.1.3] - 2026-08-10

### Changed
- **Release 0.1.3 (plan 015)** is the dead-code and deprecation hygiene patch on the frozen 0.1.x line, additive-only vs 0.1.2 (freeze manifest `scripts/phase15-freeze-manifest.json`). (1) **Benchmark-runner consolidation** (Task 1): one parameterized runner `scripts/benchmark.mjs --scenario <name>` replaces the per-version runners; the six live legs moved to `scripts/benchmark-scenarios/` as named scenarios (`phase6-postgres`, `phase7-postgres`, `phase8-loops-hitl`, `phase9-coding`, `phase10-acp`, `phase11-auth`) and the 0.1.0 envelope orchestrator composes them through the runner; **removed files**: `scripts/benchmark-0.0.{8,9,10,11,12,13,14,15,16}.mjs` and `scripts/benchmark-0.0.{9,10,11,12,13,14,15}.test.mjs` (orphaned, unreferenced by `npm test`); all `benchmark-*.json` evidence files kept byte-identical; the CI benchmark-schema leg now runs `scripts/benchmark.test.mjs`. (2) **Review-coverage archive** (Task 2): the 12 `docs/review-coverage-2026-07-*.md` per-phase evidence files moved to `docs/_evidence/` (tarball-excluded via the `files` field; index/migration/performance links updated; archived evidence is not part of the shipped docs surface). (3) **Non-blocking unused-code sweep** (Task 3): `npm run sweep:unused` runs tsc `--noUnusedLocals`/`--noUnusedParameters` over core + every workspace tsconfig plus a zero-dep dead-export scan (`scripts/dead-exports.mjs`), writes the combined report to `scripts/unused-sweep-report.txt`, and always exits 0; CI runs it as a `continue-on-error` step with a retained artifact; 43 internal unused diagnostics (22 test files + 13 source files) removed in-tree, public-but-unused exports are report-only (removal is the 0.1.5 breaking cut). (4) **Opt-in checkpoint persistence** (Task 4): durable runs may set `persistSessionState: true` on the run and resume options — the loaded-skill **name catalog** (≤64 names, ≤256 chars each, validated fail-closed on every save and load) rides the run-state checkpoint and is restored into the resumed session's `LoadedSkillSet`; skill **bodies are never persisted** and re-resolve from the live registry; flag off keeps the checkpoint shape byte-identical to 0.1.2. `@arnilo/prism-coding-agent` adds `createReadPathSetPersistence({ checkpoints, key, ownership })` for the read-before-write path set (≤1024 paths / ≤1024 chars each, CAS read-modify-write, cross-ownership restore fails closed). Store compatibility with 0.1.2: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract.

## [0.1.2] - 2026-08-10

### Changed
- **Release 0.1.2 (plan 014)** is the Alibaba Cloud provider enrichment patch on the frozen 0.1.x line, additive-only vs 0.1.1 (freeze manifest `scripts/phase14-freeze-manifest.json`): (1) **embeddings** — `createAlibabaEmbedder` in `@arnilo/prism-provider-alibaba` over the OpenAI-compatible `POST {base}/embeddings` (text-embedding-v3/v4), a structural `Embedder` assignable to `@arnilo/prism-memory`'s without a dependency; inputs chunked at the DashScope cap (10/request), vectors in input order, dimensions 64–2048 (default 1024) + `encoding_format` passthrough, key resolved per call and redacted from errors; (2) **video input** — `file` blocks with `video/*` media types serialize to compatible-mode `video_url` content parts on Qwen-VL models, gated on the `file` input capability (`mapAlibabaModel` advertises `["text", "image", "file"]` for the qwen-vl family); (3) **documented deferrals** — document input (compatible path is the OpenAI Files API `file-extract` + `fileid://` reference, an upload/status lifecycle) and rerank (only workspace-dedicated `compatible-api/v1/reranks` exists, not on the public presets) are recorded in the verified decision table in [docs/providers/alibaba.md](docs/providers/alibaba.md) as demand-gated follow-ups; (4) **opt-in live probe** — `PRISM_LIVE_DASHSCOPE_KEY`-gated `test:live` script (skips when absent, never in CI). Store compatibility with 0.1.1: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract.

## [0.1.1] - 2026-08-10

### Changed
- **Release 0.1.1 (plan 013)** is the post-release hardening patch on the frozen 0.1.x line, five scoped fixes and no new public packages/exports (freeze manifest `scripts/phase13-freeze-manifest.json`): (1) **build single-flight** — `npm run clean` removed from `npm run build` (standalone `npm run clean`; concurrent tsc is idempotent, the destructive `rm -rf` race is gone); (2) **deterministic MCP SSE relay test** — `relayStatelessBody` extracted as an internal export in `@arnilo/prism-mcp` with unit + E2E coverage (`packages/mcp/src/__tests__/sse-relay.test.ts`), closing the plan 011 relay compromise for the stateless path; (3) **combined coverage summary** — `scripts/coverage-summary.mjs` runs the core gate + 41 workspace suites and prints one labeled table (appended to `test:coverage`); (4) **canonical manifest-count narrative** — 49 publishable manifests = root + 48 workspace (14 provider + 9 `prism-*` + 25 capability), one statement in [docs/release-and-install.md](docs/release-and-install.md) with a tripwire; (5) **ACP modes/config ownership-scoped persistence guidance** — the agent never persists `modeId`/`configValues`; host stores MUST key by `sessions.ownership` (cross-tenant restore rejects `ERR_PRISM_ACP_INPUT`), asserted in `acp-modes-config.test.ts`. Store compatibility with 0.1.0: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract (see [docs/migration.md](docs/migration.md) `0.1.0 → 0.1.1`).

## [0.1.0] - 2026-08-09

### Changed
- **Release 0.1.0 (Phase 12, plan 012)** is the release-candidate hardening cut of the 0.0.28 graph: no new packages, public exports, schema migrations, or runtime dependencies (frozen in `scripts/phase12-freeze-manifest.json`; deviations require a recorded plan 012 Task 0 entry). Store compatibility with 0.0.28: **compatible, no migration**; the `0.0.17 → 0.1.0` upgrade matrix in [docs/migration.md](docs/migration.md) documents every intermediate line (compatible / tested migration / tested refusal).
- **Compatibility matrix machine-checked** (plan 012 Task 1): [docs/release-and-install.md](docs/release-and-install.md) publishes the supported/measured matrix (Node 20+24, PostgreSQL 16, linux-x64, five protocol SDK pins, security-support boundary); release.yml CI legs match it, asserted by tripwires.
- **Upgrade/migration + release-integrity repair** (Task 2): per-release store-compatibility sections for 0.0.18–0.1.0; release-evidence matrix with tag presence + evidence pointers for every release (0.0.21 and 0.0.28 are the documented untagged lines); persistence schema contract reconciled to version 7 (7 checksummed migrations) across freeze manifest, docs, and tests; postgres upgrade-chain/refusal tests.
- **Packed-install e2e journeys** (Task 3): `scripts/e2e-enterprise-journey.test.mjs` + `scripts/e2e-coding-journey.test.mjs` install the exact packed manifest graph into fresh consumers (never workspace paths) and run the enterprise journey (OIDC → OPA ledger → durable events → batched approval → OpenAPI idempotent side effect → artifact signed delivery) and coding journey (ACP editor session → bounded coding tools → sandboxed process session → forge handoff) against public exports only.
- **Protected restart-recovery evidence** (Task 4): `scripts/phase12-restart-recovery.test.mjs` (in `npm run test:postgres`) proves multi-replica kill/resume with no event gap/duplicate, tool-effect unknown-outcome fail-closed replay, database-restart-during-streaming catch-up, and reconnect/contention p95 against frozen ceilings; missing `PRISM_TEST_POSTGRES_URL` is a named blocked gate.
- **Capacity envelopes frozen** (Task 5): `scripts/benchmark-0.1.0.mjs` composes the six phase benchmark scripts into one envelope report (`scripts/benchmark-0.1.0.json` — 24 network-free + 16 protected rows) gated on every `npm test` against the freeze-manifest ceilings; [docs/performance.md](docs/performance.md) publishes the full table with methodology and pass/fail thresholds. Budget baselines regenerated once via freeze deviation dev-001 (evidence scripts added ~35 kB to the root tarball; tolerance unchanged).
- **Security policy hardened** (Task 6): `npm audit --audit-level=moderate` enforced in `security.yml` and `release.yml` (0 vulnerabilities at every severity for the 0.1.0 tree, 317 locked deps); named threat-suites leg `npm run security:threat-suites` (Phase 8–11 conformance, 28/28); supply-chain negative fixtures (unexpected file types/credential material in tarballs, suppressed-provenance detection in dry-run args); live-canary blocked-gate semantics documented.
- **Docs freeze + version bump** (Task 7): `docs/0.1.0-readiness.md` current-line table at 0.1.0 with per-gate 0.1.0-tree evidence and the explicit remaining operator list for 1.0; `docs/public-contracts.md` publishes the frozen 0.1.x contract (declaration/exports surface, events, protocol payloads, migration checksums, additive-only patch promise); every public page, package README, and changelog verified consistent with 0.1.0 behavior (docs tripwires green); all 48 manifests + lockfile at exact 0.1.0 via scripted bump; publish dry-run verified deterministic (49/49 twice, byte-identical); signed-tag + npm OIDC publication documented as explicit operator steps with rollback notes ([docs/release-and-install.md](docs/release-and-install.md) `0.1.0 publish handoff`).

## [0.0.28] - 2026-08-08

### Added
- Phase 11 enterprise adapter seams (plan 011), all optional and fail-closed; hosts that wire none keep exact prior behavior.
- `@arnilo/prism-credentials-node/oidc`: `createOidcIdentityVerifier` — OIDC/JWKS identity verification over native WebCrypto (RS256/ES256), host-pinned SSRF-checked JWKS URL with bounded single-flight cache and exactly one refetch on unknown `kid`, bounded clock skew/claims, host revocation callback; fail-closed `IdentityError` reasons `ERR_PRISM_OIDC_*`.
- `@arnilo/prism-policy/opa`: `createOpaPolicyEvaluator` — OPA REST decision adapter for the durable Phase 6 policy ledger; default deny on timeout/transport failure (`onFailure`), bounded input/response/retries, redacted mapped reasons/evidence, optional bundle-revision pin (`requirePolicyVersion`); frozen codes `ERR_PRISM_OPA_*`.
- MCP OAuth (0.0.28) in `@arnilo/prism-mcp`: `createMcpOAuthTransport`/`createMcpOAuthFetch`/`createMcpClientAuth` reusing `@modelcontextprotocol/sdk` auth helpers — RFC 9728/8414 discovery with bounded SSRF-checked zero-redirect fetch, PKCE interactive flow, RFC 8707 resource-bound audience validation (confused-deputy defense), RFC 7009 revocation, host-owned `McpClientAuthState` persistence; server side gains `protectedResource` metadata route + `WWW-Authenticate` challenges. Frozen codes `ERR_PRISM_MCP_OAUTH_*`.
- New package `@arnilo/prism-openapi-tools`: `createOpenApiTools` compiles host-listed OpenAPI 3.1 `operationId`s at setup into bounded `ToolDefinition`s — pinned origin (drift fails closed), resolved/bounded schemas, mutation operations get `external_mutation` + `idempotency: required` (approval/idempotency via the core run loop), bounded body/response/retries/pagination, host credential resolver, untrusted redacted output. Frozen codes `ERR_PRISM_OPENAPI_*`.
- Artifact body contract + reference adapter: core `ArtifactBodyStore`/`ArtifactBodyRef`/`ArtifactBodyStoreError` (storage-free types, frozen `ERR_PRISM_ARTIFACT_BODY_*`), optional `size` on `ArtifactRevision`, `createArtifactService` `bodies` option with presigned `url` on delivery links (fail closed without recorded size); `@arnilo/prism-server/artifact-bodies` ships `createS3ArtifactBodyStore` — hand-rolled SigV4 over native fetch/WebCrypto, verified hash/size/mime on put/get, legal-hold-aware delete, bounded presign TTL, optional host KMS callback (`ERR_PRISM_S3_*`).
- Phase 11 evidence: network-free `scripts/phase11-conformance.test.mjs` (in `npm test`: composed OIDC → OPA ledger → MCP OAuth tool → OpenAPI side effect → artifact body + signed delivery; adapter-absent baseline; hostile origins and limit ladder; redaction sweep), `scripts/benchmark-0.0.28.mjs` + `scripts/benchmark-0.0.28.json` evidence, `scripts/budgets.json` `phase11` gate, `scripts/phase11-freeze-manifest.json` schema-gated by `scripts/phase11-freeze.test.mjs`.
- Docs: new [docs/openapi-tools.md](docs/openapi-tools.md); OIDC verifier section in [docs/agent-identity.md](docs/agent-identity.md); OPA section in [docs/policy-and-audit.md](docs/policy-and-audit.md); MCP OAuth section in [docs/mcp-tools.md](docs/mcp-tools.md); artifact body store section in [docs/work-artifacts-and-review.md](docs/work-artifacts-and-review.md); migration `0.0.27 → 0.0.28`; Phase 11 p95 evidence in [docs/performance.md](docs/performance.md); protected live-canary slot recorded as a blocked release gate in [docs/0.1.0-readiness.md](docs/0.1.0-readiness.md).

### Changed
- `createPrismMcpWebHandler` accepts `McpServer | (() => McpServer | Promise<McpServer>)`; stateless operation now requires a factory (a shared stateless transport threw on the second request). SSE (`text/event-stream`) responses are relayed instead of buffered, so streaming responses no longer stall the handler.
- Publishable graph stays **48** manifests (includes the new `@arnilo/prism-openapi-tools`); core remains dependency-free and every new seam is opt-in.
- Version bumped to exact `0.0.28` across the root, all workspace manifests, and the lockfile; compatibility baselines refreshed (additive surfaces only).

## [0.0.27] - 2026-08-07

### Added
- ACP coding-host interop (`@arnilo/prism-ag-ui/acp`, stable ACP v1 over `@agentclientprotocol/sdk@1.3.0`): capability advertisement is a pure function of host seams (`loadSession`/`sessionCapabilities.*`/`promptCapabilities.*`/`mcpCapabilities.*`; `close` always; UNSTABLE cells never advertised), session persistence (`session/load|resume|list|delete`, bounded registry), session modes and config options as host overlays (`set_mode`, `set_config_option`, `current_mode_update`, `config_option_update`), client fs/terminal adapters (`AcpClientFilesystem`/`AcpClientTerminals`), MCP servers only behind host `select`, rich prompt content (`projectAcpPrompt`: media + embedded resources under live policy), tool-call locations/diffs via projection allow-lists, `CodingLifecycleEvent` → ACP update mapping, four-outcome approvals with elicitation (`elicitation/create` when advertised), and `AcpError` codes `ERR_PRISM_ACP_INPUT/LIMIT/POLICY/CAPABILITY/MCP`. Frozen caps in `resolveAgUiLimits` (`caps.acp`/`caps.lifecycle` groups).
- Phase 10 evidence: network-free `scripts/phase10-conformance.test.mjs` (in `npm test`), operator-gated real-transport smoke (`scripts/acp-client-smoke.mjs` + fixture), `examples/acp-coding-host.ts`, `scripts/benchmark-0.0.27.mjs` + `scripts/benchmark-0.0.27.json` evidence, `scripts/budgets.json` `phase10` gate.
- Docs: new [docs/acp.md](docs/acp.md) ACP reference; migration `0.0.26 → 0.0.27`; `docs/ag-ui.md` ACP summary + link; ACP pointers across agent-events/coding-agent-tools/coding-security/mcp-tools/host-security; package README.

### Changed
- `@arnilo/prism-ag-ui` depends on `@arnilo/prism-coding-agent` (workspace) for Phase 9 output-chunk caps and lifecycle types; publishable graph stays **48** manifests.
- SBOM license policy allows `Unlicense` (tweetnacl via `@nats-io/nkeys`); readiness SBOM evidence refreshed (227 packages / 12 licenses).
- `@arnilo/prism-ag-ui/renderer` now exports the DOM-free A2UI core values (`A2UiSurfaceState`, `reduceA2UiOps`, `readA2UiBatch`, `resolvePointer`, `A2UI_VERSION`) — Synapta FR, hosts can drive the surface state machine without mounting; `createA2UiRenderer` behavior and frozen A2UI caps unchanged.

### Breaking (advertise/surface for ACP hosts only)
- `initialize` advertisement now reflects wired seams (previously minimal close-session); new session methods are registered only with their seams; `session/resume` of a live session rejects; `agentInfo.version` now comes from the package.json. Core, AG-UI, and coding-agent behavior unchanged. See [migration guide](docs/migration.md) `0.0.26 → 0.0.27`.

## [0.0.26] - 2026-08-06

### Added
- Git-aware repository enumeration (`createGitAwareRepositoryOperations`): fixed `git ls-files` with native fallback, host-only `includeIgnored`, frozen ls-files output caps.
- Language intelligence (`createLanguageIntelligence`): host-selected LSP 3.17 client over bounded JSON-RPC — symbols/definitions/references/diagnostics/hover/rename; lazy spawn; policy-gated atomic rename; `ERR_PRISM_LSP_*` codes.
- Managed process sessions (`createProcessSessions`): start/output/input/wait/signal/kill/release, ownership + expiry sweep, optional sandbox `startProcess` backend with sandbox-loss → `unknown` reconciliation; `OutputAccumulator.readRaw` cursor paging.
- Reference GitHub forge adapter (`createGitHubForge`): issue context, authenticated push (`GIT_CONFIG_*` credential injection, never argv), PR create/update, review comments, checks/status, bounded `reconcileHandoff`; `ToolEffectStore` idempotency (retry never duplicates); host-injectable `fetch` option.
- Allow-list egress (`@arnilo/prism-coding-security`): deny-all `createEgressPolicy` with frozen presets, `createAllowListEgressProxy` (CONNECT tunnel, pinned-DNS rebinding defense, private/metadata IP denial, redirect re-validation, byte/time caps, audit records), `composeEgressSandboxNetwork` attestation labels.
- Network-free Phase 9 conformance + `benchmark-0.0.26.json` evidence; composed example `phase9-coding-intelligence.ts`.
- AG-UI reasoning encrypted-value helper (`createReasoningEncryptedValue`, FR-3) and MCP Apps UI-initiated mutation retry through `ToolEffectStore` (`reconcileAppEffect`, FR-4).
- Durable `AgentEventSource` root export in `@arnilo/prism-session-store-postgres` (FR-6) and new NATS JetStream sibling adapter `@arnilo/prism-session-store-nats` (FR-5): per-run subjects, per-subject replay, durable pull consumers with explicit acks (at-least-once), idempotent append, resumable cursors, ownership-scoped page/subscribe/cleanup.
- A2A server-side exposure (Task 13): `createAgUiA2AServer` in `@arnilo/prism-ag-ui` fronts a local AG-UI agent as an A2A 1.0 server over supervisor's `createA2AHandler` — remote clients run and stream the agent through the AG-UI input allow-list and event mapper, with a bounded live task registry and optional durable replay.
- Reference frontend renderer (Task 14): new `@arnilo/prism-ag-ui/renderer` subpath export — `createA2UiRenderer` consumes an AG-UI event stream and renders A2UI v0.9 surfaces into DOM from a host component catalog; DOM-free core with the server-side A2UI caps enforced client-side, fail-closed drops, explicit placeholders for unknown components, and no remote HTML execution.
- Async `AgUiProjection` hooks (Task 15): all hook returns are `Awaitable<T>`; the AG-UI and ACP mappers await hooks in event order with per-event fail-closed, so projectors can call `session.entries()` directly — `createMessagesFromSessionProjection` now accepts an async `getMessages` transcript source. Sync-only hosts keep exact prior behavior.

### Changed
- Publishable graph grows to **48** manifests at **0.0.26** (new `@arnilo/prism-session-store-nats`).

### Breaking (none)
- All Phase 9 additions are opt-in factories; no existing export, event, or persisted shape changed. See [migration guide](docs/migration.md) `0.0.25 → 0.0.26`.

## [0.0.25] - 2026-08-06

### Added
- Durable custom `AgentLoopStrategy` hooks: optional `revision` / `snapshot` / `restore`; `AgentLoopStateError` fail-closed codes; fingerprint includes loop `{name,revision}`.
- Shared pending-decision model: parallel approvals, batch CAS `decisions`, sticky allow/reject for run, modified arguments, elicitation; nested supervisor attribution.
- Protocol mappings: AG-UI/ACP/server batch resume, MCP elicitation helpers, coding `ask_user_decision` elicitation hook.
- Opt-in A2UI painting middleware + standard AG-UI projectors (`messages`/`state`/`activity`).
- Network-free Phase 8 conformance + `benchmark-0.0.25.json` evidence; examples `durable-loops-and-approvals.ts`, `ag-ui-a2ui.ts`.

### Changed
- Publishable graph remains **47** manifests at **0.0.25**.
- Fingerprint loop entry shape `string` → `{name,revision}` (0.0.24 persisted durable runs fail closed on resume).

### Breaking (minor, pre-1.0)
- Custom loops on durable runs need snapshot/restore hooks or `ERR_PRISM_LOOP_NOT_DURABLE`.
- Resume prefers `decisions: RunDecision[]`; legacy binary `decision` remains but is exclusive with the batch path.
- ACP permission offers four outcomes; `reject_once` is blocked-continue (cancelled stays terminal deny).

See [docs/migration.md](docs/migration.md) for the 0.0.24 → 0.0.25 guide.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` with append/page/subscribe/resume and PostgreSQL LISTEN/NOTIFY wakeups (schema v6 streams + v7 retention index).
- Recoverable `ToolEffectStore` claim/CAS lifecycle; enterprise PostgreSQL `toolEffects`; coding/browser/work/MCP/supervisor effect classification.
- AG-UI 0.0.57 full input/event/interrupt compatibility plus MCP Apps and remote A2A adapters.
- Protected Phase 7 process conformance and `benchmark-0.0.24.json` evidence.
- Example `examples/distributed-events-and-tool-effects.ts`; docs `docs/tool-effects.md`.

### Changed
- Work mutations require core-derived idempotency keys; ambiguous outcomes stay `unknown` (not exactly-once).
- Publishable graph remains **47** manifests at **0.0.24**.

### Breaking (minor, pre-1.0)
- Hosts using approved work mutations must supply `effectStore` / core `idempotencyKey` (model keys ignored).
- Durable event reconnect uses `AgentEventSource` cursors / `Last-Event-ID`; sticky sessions are optional only.

See [docs/migration.md](docs/migration.md) for the 0.0.23 → 0.0.24 guide.

## [0.0.23] - 2026-08-03

### Added
- `@arnilo/prism-enterprise-postgres`: optional PostgreSQL composition for policy decisions, evaluation records, work-mutation idempotency, and model-router state.
- Checked enterprise PostgreSQL conformance/restart/contention, cleanup/index/storage performance evidence, and protected `PRISM_TEST_POSTGRES_URL` gate.

### Changed
- `@arnilo/prism-work-tools` idempotency uses claim/CAS lifecycle states; ambiguous connector outcomes are `unknown` and require reconciliation.
- `@arnilo/prism-model-router` accepts durable async state; `recordUsage`/`recordOutcome` are awaited and `providerSource` cannot bypass a supplied state store.
- Publishable graph: **47** manifests (was 46); `@arnilo/prism-all` includes enterprise PostgreSQL state.

### Breaking (minor, pre-1.0)
- Hosts implementing `IdempotencyStore` must migrate from `get`/`put` to `begin`/transition methods.
- Hosts using durable router state must await router methods with verified identity; synchronous `providerSource` is memory-state only.

See [docs/migration.md](docs/migration.md) for the 0.0.22 → 0.0.23 guide.

## [0.0.22] - 2026-07-31

### Added
- `@arnilo/prism-caveman` and `@arnilo/prism-ponytail`: optional third-party behavior integrations (Phase 5).
- Example `examples/caveman-ponytail.ts`.

### Changed
- Publishable manifest count: **46** (was 44).

See [docs/migration.md](docs/migration.md) for the full 0.0.21 → 0.0.22 notes.

## [0.0.21] - 2026-07-31

### Added
- `@arnilo/prism-coding-agent`: `repo_search` `outputMode`, bounded `glob`, optional `requireReadBeforeWrite`/`ReadPathSet`, bounded `delete`/`move`.
- Example `examples/coding-tools-capability-gaps.ts`.

### Changed
- Default coding aggregator: 9 tools (`createCodingTools`); read-only aggregator: 4 (includes `glob`).
- `@arnilo/prism-coding-security`: approval + sandbox wiring for `delete`/`move`.

### Breaking (minor, pre-1.0)
- Hosts asserting exact `createCodingTools().length === 6` or readonly length `3` must update (now 9 / 4).
- Custom sandbox `RepositoryOperations` must implement `glob`; full sandbox custom ops must supply `delete`/`move`.

See [docs/migration.md](docs/migration.md) for the full 0.0.20 → 0.0.21 notes.

## [0.0.20] - 2026-07-31

### Added
- Progressive skill disclosure: `skillsDisclosure` (`"progressive"` default, `"eager"` opt-in), session `LoadedSkillSet`, `createLoadSkillTool` / `resolveSkillLoad` (`load_skill`), catalog/body byte caps.
- Runtime `activateAllSkills` migration opt-in when `AgentConfig.skills` is a `SkillRegistry` without per-run activation.
- Context budget: `ContextBlock.priority` ordering; skill body demotion (`skill_body` omission) before full drop.
- Optional `toolResultFold` host-gated projection for aged large tool results (session store untouched).

### Changed
- Default runtime `SkillRegistry` activation is **empty** when neither `RunOptions.activeSkills` nor `RunOptions.skills` is set (was `SkillRegistry.list()`).
- Default skill prompt assembly is catalog-only (`name` + `description`); full `instructions` require eager mode or successful `load_skill`.

### Breaking (minor, pre-1.0)
- Hosts relying on implicit activate-all registry behavior must pass `activateAllSkills: true` or set `activeSkills` / `skills` explicitly.
- Hosts expecting full skill bodies every turn must set `skillsDisclosure: "eager"` or register and use `load_skill`.

See [docs/migration.md](docs/migration.md) for the full 0.0.19 → 0.0.20 notes.

## [0.0.19] - 2026-07-30

### Added
- `@arnilo/prism-compaction-observational-memory`: `createObservationalMemory()` + `attach()` lifecycle, four-layer provider context (recent exact messages, observation log, reflections, raw-source retrieval), `recallObservationalMemoryBranchPage()`, `wrapResumeRun` / `wrapResumeStream`, nested settings with legacy flat-key mapping.

### Changed
- Observational memory: separate observer/reflector/dropper workers, domain-neutral observer default, dual coverage/eligibility fixes, full-ledger reflection recall, hard fold/render byte caps, post-run `compactAfterTokens` compaction when attached.

See [docs/migration.md](docs/migration.md) for the full 0.0.18 → 0.0.19 observational memory notes.

## [0.0.18] - 2026-07-30

### Changed
- Default `inputLayout` is `cache_aware` (unset `AgentConfig` / `RunOptions` use cache-stable message order); set `inputLayout: "legacy"` to restore prior ordering.
- `applyContextBudget` evicts oldest history messages first under pressure (was newest-first).
- `@arnilo/prism-mcp` pins `@modelcontextprotocol/sdk` **1.30.0** (clears moderate `@hono/node-server` path-traversal advisory on the MCP HTTP stack).

### Breaking (minor, pre-1.0)
- `@arnilo/prism-coding-agent` `repo_search` is literal-only: `mode: "regex"` removed; `compileSearchPattern` drops the `mode` argument (ReDoS mitigation).
- Default local `write` / `edit` operations use same-directory temp + `rename` for crash-safe replacement.

See [docs/migration.md](docs/migration.md) for the full 0.0.17 → 0.0.18 notes.

## [0.0.17] - 2026-07-29

### Added
- Extension lifecycle: `ExtensionKernel.load()` returns `LoadedExtension[]` dispose handles; contribution/provider/model registries gain `unregister(...)`; a failed `setup` unwinds its partial registrations.
- `MemoryCredentialStoreOptions.allowProviderFallback` for strict provider-scoped credential resolution; `createMemoryCheckpointStore` `maxRecords`/`maxValueBytes` bounds; `ShellToolOptions.envAllowlist` (coding-agent); `ErrorInfo.retryAfterMs` plus `retryAfterMs`-aware `createDefaultRetryPolicy` with `jitter`/`random` options; guardrail `steer_rejected` event; `httpStatusError` provider transport helper wired into anthropic, google, kimi, openai, opencode-go, and the shared OpenAI-compatible transport.

### Changed
- Durable runs: run-state load now bounds against the 1 MiB hard cap (states saved with a raised `maxStateBytes` resume correctly); agent fingerprint also covers instructions, system-prompt contributions, and skills; resume-after-interrupt is explicit implicit-approval.
- Retry/backpressure: HTTP provider errors carry numeric codes and `Retry-After` hints; default retry policy applies ±25% jitter.
- `input_assembly` middleware runs unconditionally (both plain and context-budget paths, any `InputBuilder`); memory session store rejects cross-session `expectedParentId`; context-budget eviction is O(n) instead of O(n²).
- Guardrails: `interrupt` errors name the stage; `guardrail_failed` records carry the underlying error message in `metadata.error`; steer `block`/`tripwire` drops the message and emits `steer_rejected` instead of failing the run.
- Default prompt builder omits the `Available tools:` text for tool-capable models (`capabilities.tools === true`).
- Middleware registry throws on double `next()` and diagnoses conflicting `next(v)` + return; event multiplexer keeps sorted delivery while a consumer is parked; batched run-ledger dead counters removed.

### Breaking (minor, pre-1.0)
- CLI: `--config`, `--resource`, `--extension`, `--tool` are rejected (`<flag> is not supported in this build`); the dead `CliOptions.config/resources/extensions/tools` fields are removed.
- `ExtensionKernel.load()` resolves to `LoadedExtension[]` instead of `void`.

See [docs/migration.md](docs/migration.md) for the full 0.0.16 → 0.0.17 notes.

## [0.0.16] - 2026-07-26

### Added
- Phase 11 simplification/readiness: new public export `resolveRedactor` from `@arnilo/prism` (single survivor of four private copies across evals/memory/rag/workflows) and a new internal `@arnilo/prism-session-store-codecs` package (shared SQLite/Postgres row codecs, not enrolled in any profile family), bringing the exact graph to **44 publishable manifests**.
- Offline pre-publish release gates: `npm run release:gate` (API-surface `.d.ts` diff vs `scripts/compat-baseline/`, tarball deny-list, exact version ranges), wired into `npm run sdk:ready`.
- Performance budgets in `scripts/budgets.json`, enforced by `scripts/budget-gate.test.mjs` (in `npm test`) and `scripts/benchmark-0.0.16.mjs`.

### Changed
- Dropped historical `docs/review-coverage-*.md` from the root tarball (11 files, ~283 KB): packed size 659,478 → ≈575,680 bytes, 281 → 270 files.
- All six profiles (`prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, `prism-sdk`) retained on adoption evidence; zero retirements. No runtime behavior changes.

## [0.0.15] - 2026-07-26

### Added

- Phase 10 provider, memory, and RAG parity: OpenAI hosted-tool attribution, bounded Responses continuation and Realtime seam; exact AI SDK V4 mapping; bounded RAG source lifecycle, document adapters, reranking, citation provenance, content trust, and ingestion status; memory export/rebuild with production-store conformance.

### Changed

- Versioned all **43** publishable manifests, exact internal ranges, and lockfile entries to `0.0.15`; no package was added.
- Added network-free Phase 10 evidence: `scripts/benchmark-0.0.15.mjs`.

## [0.0.14] - 2026-07-26

### Added

- Phase 9 personal/work-agent surfaces: durable conversation service (`createConversationService`), durable artifact service with review/approval/authorized delivery (`createArtifactService`), memory consent + lifecycle (`setConsent`/`correct`/`forget`/`applyRetention`), AG-UI co-work events (`mapCoWork` + ACP parity), scoped M365/GWS OAuth connectors (`revokeOAuthCredential`, `createOAuthWorkTokenProvider`), a browser verified-state checkpoint ledger, and a deny-by-default device adapter contract (`resolveDevicePolicy`/`assertDeviceAdmit`).
- New optional provider packages `@arnilo/prism-provider-alibaba` (Model Studio / DashScope + Coding Plan) and `@arnilo/prism-provider-ollama` (cloud/local), both with dynamic model discovery; enrolled via `@arnilo/prism-providers`.

### Changed

- Versioned all **43** first-party manifests and exact internal ranges to `0.0.14` (41 → 43; only the two provider packages are new).
- Network-free Phase 9 evidence: `scripts/benchmark-0.0.14.mjs`.

## [0.0.13] - 2026-07-24

### Added

- Enterprise identity (`Principal` / `AgentIdentity`), optional `@arnilo/prism-policy`, `@arnilo/prism-model-router`, enterprise cloud providers (Azure/Bedrock/Vertex), server deployment seams, persistence schema v5 lifecycle hooks, and `@arnilo/prism-work-tools` (M365 + GWS).

### Changed

- Versioned all **41** first-party manifests and exact internal ranges to `0.0.13`; Phase 8 optional packages enroll in `@arnilo/prism-all` only.
- Network-free enterprise evidence: `scripts/benchmark-0.0.13.mjs`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

All notable changes to this project will be documented in this file.

## [0.0.12] - 2026-07-22

### Added

- Optional `@arnilo/prism-ag-ui` package with bounded AG-UI mapper/authorized handler/replay and stable `./acp` sibling, built over shared durable resume streams.
- `createCodingCompactionStrategy()` preset for bounded coding-session handoff.

### Changed

- Versioned all 35 first-party manifests and exact internal ranges to `0.0.12`; `@arnilo/prism-all` includes AG-UI while `@arnilo/prism-code` and `@arnilo/prism-sdk` remain free of UI protocol dependencies.
- Added network-free interoperability/compaction evidence: `scripts/benchmark-0.0.12.mjs`.

## [0.0.11] - 2026-07-22

### Added

- Coding harness fundamentals for 0.0.11 (Plan 074): bounded `SessionIndex`/`searchSessions` (SQLite/Postgres FTS migration 004; memory linear|unsupported; JSONL unsupported), assembler `contextBudget` + omission reports, `@arnilo/prism-provider-anthropic` + `@arnilo/prism-provider-google`, mid-run `AgentSession.steer` / RPC steer, coding-agent `runCodingGoalVerify` and opt-in `ask_user_decision` (multi/free-text/durable suspend glue).
- Opt-in `structuredOutputTiming: "final-turn-only"` on `generate-validate-revise` (default `"every-turn"`): tool-eligible turns omit native schema so models can call tools; artifact/revision turns attach schema and withdraw tools.

### Changed

- Versioned all 34 first-party manifests and exact internal ranges to `0.0.11` (adds `@arnilo/prism-provider-anthropic` + `@arnilo/prism-provider-google` to the publishable graph and `@arnilo/prism-providers` umbrella).
- Network-free search/budget evidence: `scripts/benchmark-0.0.11.mjs`.

## [0.0.10] - 2026-07-21

### Changed

- Coding harness workspace modes (Phase 5): required `workspaceMode` on `@arnilo/prism-coding-security` composition; sandbox mode unifies shell/FS on one disposable tree; host mode never claims containment; fail-closed mixed wiring + `allowMixedWorkspaceWiring` escape hatch; import/export tree identity; `scripts/benchmark-0.0.10.mjs` evidence.
- Versioned all 32 first-party manifests and exact internal ranges from the post-ship `0.0.96` graph to `0.0.10` for the roadmap Phase 5 release line.

## [0.0.96] - 2026-07-21

### Changed

- Package graph and runtime version pins bumped from 0.0.9 to 0.0.96 for a clean publish tag after the mistaken `v0.0.95` tag and TypeScript 7 / workspace-order CI fixes.

## [0.0.9] - 2026-07-21

### Added

- Production coding and browser execution for Release 0.0.9: disposable Docker sandbox, bounded native repository list/search, structured Git/named checks/PR handoff, durable coding-plan/checkpoint composition, and optional `@arnilo/prism-browser` with egress/side-effect/upload/download/screenshot policy.
- Versioned all 32 first-party manifests and exact internal ranges to 0.0.9 (adds `@arnilo/prism-browser` to the publishable graph; browser stays out of `@arnilo/prism-code` and activates only through explicit install or `@arnilo/prism-all`).
- Added network-free coding/browser adversarial evaluation fixtures, `scripts/benchmark-0.0.9.mjs`, and protected Docker/Playwright gates via `.github/workflows/sandbox-browser.yml`.
- Office execution remains outside Prism packaging by product decision (host-selected skills/instructions only).
- `tryParseJsonObjectArguments` and `toolCallFromArgumentsText` for recoverable streamed tool-call argument parsing.

### Fixed

- Malformed streamed tool-call arguments (id+name present) become failed/`tool_execution_blocked` tool results (`invalid_arguments` / `invalid_json_arguments`) instead of terminal `ProviderTransportError`, so models can self-correct within existing turn budgets.
- Incomplete tool-call deltas (missing id/name) fail with typed `ProviderTransportError` / `ErrorInfo.code: "incomplete_delta"` instead of a bare `Error("Incomplete tool call delta...")`; openai-compatible streams no longer emit `done` alongside leftover incomplete deltas.
- Empty/whitespace-only call-free artifact candidates (including thinking-only output) are `parse_error` through the revision budget; `generate-validate-revise` session runs no longer resolve `succeeded` without `artifact_finished`.

## [0.0.8] - 2026-07-20

### Added

- Added OpenTelemetry GenAI agent/provider/tool hierarchy, context propagation, delegation/guardrail spans, bounded trace references, and evaluation linkage.
- Added bounded evaluation trace resolution, host model judges, deterministic pairwise reports, serialized artifacts, and CI threshold assertions.
- Added MCP resources/prompts/roots/sampling/elicitation plus principal-bound Streamable HTTP sessions on pinned SDK 1.29.0, and full A2A 1.0 durable task/rich-part/reconnect/push interoperability.
- Added immutable-revision CodeQL/dependency/SBOM/license/secret/attestation release gates, weekly dependency updates, and protected bounded provider/MCP/A2A/web live canaries.
- Added optional `@arnilo/prism-web-tools` with bounded host-selected Brave/Exa search, Firecrawl Markdown/schema extraction, stable citations, late credentials, and explicit untrusted-content results.
- Added optional `createBatchedRunLedger()` with bounded FIFO/backpressure, explicit durability/flush status, terminal acknowledgement, and documented buffered crash-loss semantics.
- Added one-leaf, one-second runtime session snapshot caching with mutation/checkout/resume invalidation and reproducible network-free 0.0.8 performance evidence.
- Versioned all 31 first-party manifests and exact internal ranges to 0.0.8; no tag or publication was created.

### Fixed

- `generateValidateReviseLoop` routes artifact parse failures through the revision budget (`metadata.reason: "parse_error"`, repairer receives `value: undefined`) instead of returning silently after one provider turn.
- `@arnilo/prism-provider-opencode-go` Anthropic route sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers alongside Bearer, fixing HTTP 401 on MiniMax/Qwen models; `structuredOutput: "json_schema"` is no longer inferred from OpenAI routing alone (verified models only), fixing HTTP 400 on `deepseek-v4-pro`; both stream parsers require protocol completion evidence and fail truncated streams with a terminal `error` instead of a false `done`.
- `@arnilo/prism-provider-kimi` aligns with official contracts: featured Coding `k3` defaults `reasoning_effort: "high"`, 256K-class context windows use the exact `262_144`, the featured Moonshot catalog adds `kimi-k2.7-code-highspeed`/`kimi-k2.6`/`kimi-k2.5`, routing keys (`route`, `preserve_thinking`) no longer leak into wire bodies, the Coding route sends provider-owned `x-api-key`/`anthropic-version` headers, and both stream parsers fail truncated streams instead of emitting `done`.

## [0.0.7] - 2026-07-19

### Added

- Typed `Guardrails` for input, provider output, tool input, and tool output. Guardrail decisions are bounded/redacted `guardrail_decision` events; provider output is buffered before exposure when output checks are configured.
- Workflow tool nodes and MCP server tool registrations now route optional tool guardrails through shared `dispatchToolCall()`.
- `RunLimits` adds validated, narrowing-only budgets for turns, provider attempts, tool rounds/calls, wall time, request/response bytes, token usage, and optional single-currency cost. Breaches emit one `run_limit_exceeded` event and return `AgentRunError.result.limit`.
- Opt-in durable built-in agent runs can suspend before a tool side effect and resume through versioned, bounded, redacted checkpoint state with CAS approval, ownership/fingerprint checks, and no automatic replay of an ambiguous dispatched tool.
- `createSecureAgent()` composes strict tool schemas/validation, trust and permission gates, redaction, finite limits, exact ownership, and durable pre-tool approval without changing low-level `createAgent()` defaults.
- `createAgentRunLifecycle()` adds explicit, ownership-scoped durable agent status/resume capability for selected server and MCP exposures; no lifecycle route/tool is enabled by default.

## [0.0.6] - 2026-07-19

### Added

- Caller-gated model discovery: `listOpenAIModels`, `listKimiModels`, `listZaiModels`, `listOpenRouterModels`, and `listOpenCodeGoModels`. Provider setup remains network-free; hosts explicitly fetch and register current models.
- Shared `ThinkingLevel` helpers and use-case model bindings. Background compaction and observational-memory jobs can use an explicit provider/model or a supplied session-model fallback.
- Opt-in sequential artifact-loop tools: `loop: { strategy: "generate-validate-revise", toolCalls: "bounded" }`. Tool rounds use existing authorization/redaction/ledger paths, share `maxToolRounds` across candidates, and fail with `artifact_failed` metadata `{ reason: "tool_round_limit" }` after exhaustion.
- Checksummed SQLite/PostgreSQL migration histories and catalog-shape verification, bounded JSON Schema compilation LRU, and public `assertFiniteVector` validation.

### Changed

- Provider packages now document and implement current cache, reasoning, streaming, and discovery behavior. OpenAI Responses replay/function-call/SSE argument handling is corrected; Kimi adds optional Moonshot support; Z.AI and OpenCode Go catalogs/routes were refreshed; OpenRouter discovery/reasoning and NeuralWatt thinking controls are hardened. AI SDK remains host-model-owned.
- Workflow definitions now require a non-empty `revision`; cancellation requires exact ownership and the current workflow definition. All workflow limits have finite hard caps.
- Coding tools now enforce bounded streamed reads, write/edit inputs, shell wall time, total output, and spill-file lifecycle. Custom coding operation interfaces now receive bounded read/stat/write/edit options and abort signals.
- Encrypted credential helpers `encryptBytes`, `decryptBytes`, and envelope rotation are asynchronous. Existing credential files must meet restrictive Unix permission requirements. Linux Secret Service/GNOME Keyring byte-array reads are accepted by the keychain store.
- MCP Streamable HTTP requires HTTPS and explicit `allowedOrigins`; loopback HTTP requires explicit opt-in. Discovery, schemas, results, and response bodies are bounded.
- Compaction and observational-memory workers now have finite turn/call/transcript/error budgets. A2A streaming uses strict incremental UTF-8 and LF/CRLF SSE parsing.
- Generated Prism, workflow, and evaluation IDs use cryptographic UUIDs; non-finite embedding vectors now fail before scoring or persistence.

### Security

- Fixed cross-owner workflow cancellation and duplicate active-run overwrite risks.
- Added fail-closed limits and validation at file, process, credential, MCP, migration, schema, vector, provider-worker, and A2A trust boundaries.

### Upgrade notes

- Finish or deliberately migrate pre-0.0.6 workflow runs/checkpoints before upgrading: their definition hashes lack the required revision.
- Update workflow definitions with `revision`, cancellation callers with `workflow` plus exact ownership, MCP HTTP configs with `allowedOrigins`, and custom coding/credential integrations for the changed interfaces above.

## [0.0.5] - 2026-07-16

- `@arnilo/prism-providers` now installs all seven first-party adapters including AI SDK interoperability; `@arnilo/prism-all` now installs every first-party package while activating none automatically.

- Added optional `@arnilo/prism-supervisor` with bounded explicit child delegation, derived memory scope IDs, narrowing-only permissions, A2A 1.0 cards/ES256 signatures, authorized JSON-RPC/SSE serving, and an exact-origin remote client.

- Added bounded immutable run/trace feedback with exact ownership, evaluation linkage, memory/SQLite/PostgreSQL stores, schema migration 003, and safe OpenTelemetry projection.

- Phase 11 extends workflows with explicit durable schedules/background execution, nested composition, bounded validated state, immutable-lineage replay, and optional command/Web bindings over existing checkpoint/lease primitives.

- Optional `@arnilo/prism-server` package with authorized bounded Web-standard direct/SSE agent and durable workflow routes; `@arnilo/prism-mcp` now supports explicit authorized Prism tool/command server exposure and bounded Web-standard Streamable HTTP handling.
- Optional `@arnilo/prism-rag` package: bounded deterministic text/Markdown chunking, Phase 7 vector indexing/retrieval, stable citations, metadata filters, redaction, and explicit ContextProvider injection.
- Workflows now support durable human `suspend()`/approve/deny, expected-version exact-once resume, validated/redacted resume payloads, and opt-in tool approval with execution-policy recheck.

### Added

- Optional `@arnilo/prism-memory` package: schema/template-backed working memory, semantic recall, package-owned `Embedder`/`VectorStore` contracts, in-memory adapters, context provider, opt-in processor, shared conformance, and PostgreSQL/pgvector production path.

## [0.0.4] - 2026-07-14

### Added

- Shared bounded provider transport, OpenAI serialization/media helpers, native structured-output contracts, provider/tool timing metadata, and audio/file/document content capability checks.
- Generic checkpoint, atomic lease, and bounded event-multiplexer contracts plus persistence/run-ledger conformance helpers.
- Optional packages for JSON Schema tool validation, MCP, coding approval/sandboxing, OpenTelemetry, encrypted/keychain credentials, SQLite/PostgreSQL persistence, and bounded workflow orchestration.
- Manifest-only `base`, `code`, and `sdk` profiles; `prism-all` now transitively installs every first-party package.
- Workflow, multimodal, persistence/resume, provider telemetry, cache, and external-adapter examples.

### Changed

- Single-shot loops support ordered bounded parallel tools; `ToolDefinition.exclusive` serializes dangerous turns without reducing later concurrency.
- Provider requests, SSE/error bodies, media, schemas, event queues, checkpoints, and workflow fan-out/output use documented finite limits.
- Session/ledger writes preserve order and redact before persistence; revision-loop transcript ordering and OAuth abort polling are hardened.
- All first-party providers use shared bounded transport helpers and expose current structured-output, multimodal, caching, reasoning, telemetry, and retry behavior where supported.

### Security

- Added fail-closed schema/prototype-pollution, SSRF/media, SQL/tenant, path/shell approval, MCP result, credential-envelope, OAuth, redaction, and stale-worker fencing coverage.
- Optional privileged capabilities remain inactive until hosts explicitly register transports/tools, configure roots/credentials/databases, and approve execution.

## [0.0.3] - 2026-07-08

### Added

- New first-party workspace package `@arnilo/prism-coding-agent` providing optional host coding tools (`shell`, `read`, `write`, `edit`) as Prism `ToolDefinition` objects. The package is opt-in and is **not** included in `@arnilo/prism-all` because the tools perform host shell/filesystem operations.
- `createCodingTools`, `createReadOnlyTools`, and `createAllTools` aggregator factories for importing/registering coding tools.
- Documentation: `docs/coding-agent-tools.md`, updated `docs/index.md` and `docs/tools.md`, and expanded `packages/coding-agent/README.md`.

### Changed

- Bumped all package versions from `0.0.2` to `0.0.3` (core, first-party workspace packages, and umbrella packages).
- Updated `@arnilo/prism` peer dependency range in every first-party workspace package to `0.0.3`.
- Updated umbrella package dependency pins to `0.0.3`.
- `docs/release-and-install.md` now documents nine first-party workspace packages, thirteen total manifests, and the explicit install command for `@arnilo/prism-coding-agent`.

## [0.0.2] - 2026-07-05

### Added

- Added `LICENSE` (MIT) and `CHANGELOG.md` to the published `prism` package.
- Added npm package metadata: `license`, `repository`, `bugs`, `homepage`,
  `keywords`, and `sideEffects`.

### Changed

- `files` whitelist now explicitly excludes `dist/__tests__/` and
  `dist/**/*.map` from published tarballs; source maps remain emitted locally
  for debugging but are no longer shipped.
- Core tarball now ships the `/docs` hub.
- Made `prism` a required peer dependency for all first-party workspace packages; it is no longer optional. The peer range remains `0.0.2` and will widen to `^1.0.0` at the 1.x stable release.
- Pinned the no-network `npm test` budget at < 60s on Node 20 (measured baseline ~45s) after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests.

## [0.0.1] - 2026-06-22

### Added

- Initial release of Prism: a framework for building agentic LLM applications
  with configurable providers, sessions, tools, context providers, compaction,
  extensions, and trust boundaries.
