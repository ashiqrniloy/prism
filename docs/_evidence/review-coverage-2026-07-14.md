# Review coverage — 2026-07-14

Traceability matrix for the 2026-07-14 code review, `prism-bug-report.md`, and Plans 053-058. Status is updated as implementation lands for release 0.0.4.

## Final 0.0.4 status — complete for publish handoff

All frozen findings and capabilities are implemented, documented, and verified. Task 8's clean RC matrix passed; Task 9's live registry preflight reports all 24 `0.0.4` versions available. Decision is **GO** after protected release commit/tag and npm authentication prerequisites in `docs/release-and-install.md`. No package was published during plan execution. C-012 remains the sole approved out-of-scope capability.

## Frozen 0.0.4 release scope

Plans 053-057 contain no unchecked tasks. Frozen review scope contains R-001-R-012 and C-001-C-011. C-012 (interactive TUI) is the sole approved exclusion: Plan 057 replaced terminal UI with public workflow APIs and RPC commands. Any row marked `release blocker` must close before publication; it is not deferred.

| Surface | Owner | Implementation / evidence | Tests / release check | Docs | Compatibility owner | Security owner / responsibility | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core correctness and storage hardening (R-001-R-007) | 053-1 through 053-6 | `src/agent-loops.ts`, `src/redaction.ts`, `src/agents.ts`, node stores/config | Plan 053 core suites; aggregate `sdk:ready` | `agent-loops.md`, `credentials-and-redaction.md`, `performance.md` | 058-1 | 058-2; host keeps production workloads off JSONL | verified |
| Provider transport, OAuth, structured output, telemetry (R-008-R-010, C-002/C-004/C-008) | 054-1 through 054-6 | `@arnilo/prism/providers/{transport,openai,media}`; provider packages; observability package | provider/conformance/OAuth/structured-output/observability suites | `provider-primitives.md`, `structured-output.md`, `observability.md` | 058-1 | 058-2; hosts own credentials, endpoints, exporter data policy | verified |
| Tool validation, MCP, parallel dispatch, coding policy/media bounds (C-001/C-003/C-006/C-007, R-011) | 055-1 through 055-6; 058-1/3 | core validator/concurrency/execution policy; validator/MCP/coding-security packages | Plan 055 342-test gate; 058 packed composition, hung MCP, and exclusive-turn/later-turn tests pass | `tool-execution-primitives.md`, `mcp-tools.md`, `coding-security.md`, `agent-loops.md` | 058-1 | 058-1/2/3; hosts trust transports and configure roots/approval | verified through 058-3 |
| Persistence, credentials, multimodality (C-005/C-010/C-011) | 056-1 through 056-7 | SQLite/PostgreSQL/credentials packages; content/provider media APIs | Plan 056 suites + PostgreSQL CI; 058 integration/performance audit | persistence, credential-storage, multimodal docs | 058-1 | 058-2; hosts own DB TLS, keychain availability, URL/path policy | verified through 058-2 |
| Workflow orchestration (C-009) | 057-0 through 057-7 | workflow package; checkpoint/event/lease core primitives; durable coordinators | 34 workflow tests, 1,000-node stress, Postgres lease/CAS CI | `workflows.md`, `workflow-orchestration-primitives.md` | 058-1 | 058-1/2; hosts own workflow definitions, tenant identity, approvals | verified |
| Release tag/version/provenance/resume (R-012) | 058-7/8/9 | Stdlib `scripts/release.mjs`; exact clean tag/version/lock/range validation; registry fingerprint preflight; topological resumable publisher | `release.test.ts`; clean tagged 24-package registry preflight, deterministic dry-run, and operator handoff guard | `release-and-install.md` | 058-7 | Existing `NPM_TOKEN` scoped to publish step; OIDC enabled; explicit public/provenance/latest args; retained artifacts/report | complete for handoff |
| Package/version graph: 24 publishable manifests | 058-5/7/8 | root + 23 workspace manifests; six family/profile metas; all manifests, internal dependencies/peers, lock entries, runtime metadata at 0.0.4 | exact graph + clean pack/install/import/bin + Node 20/24 checks | profile READMEs; `release-and-install.md` | 058-7 | 0-vulnerability audit, SBOM/license scan, checksums, tarball secret/deny scan | verified through 058-8 |
| Public API families: provider subpaths; structured output/telemetry; validation/concurrency/execution policy; multimodal content; persistence conformance; checkpoint/event/lease; optional package APIs and workflow RPC | 054-057; 058-6 | Root exports and eight new optional package entry points listed in Plans 054-057 | public-export, packaging, install, docs, and 0.0.3 compatibility fixtures | API pages linked exactly once from `docs/index.md`; all 24 changelogs finalized | 058-1/6 | 058-2; each API page records limits/trust boundaries | verified through 058-6 |
| Versioned formats/migrations: persistence/checkpoint/lease schema v1; credential envelope/vault v1 | 056/057 | migration contracts and adapter-owned migrations | reopen/migration/CAS/fencing/wrong-key/tamper suites | persistence and credential-storage docs | 058-1 | 058-2; migrations fail closed and values remain parameterized/encrypted | frozen |

### Performance and security release ownership

| Area | Frozen threshold / current evidence | Remaining release owner | Security test or host responsibility | Status |
| --- | --- | --- | --- | --- |
| Provider transport | 256 KiB event, 512 KiB buffer, 64 KiB error body; 16 MiB fixture at 380 MiB/s and +1.7 MiB heap | 058-2 regression comparison | Oversize/abort/header/redaction fixtures | recorded |
| Telemetry/events | realistic enabled overhead under 5%; measured within 1%; bounded subscriber/workflow buffers | 058-2/8 | Content off by default; exporters are host trust boundary | recorded |
| Media/MCP/workflows | 10 MB MCP result/image defaults; finite media totals/timeouts; workflow 1,000 nodes, concurrency 8, fan-out 64, event buffer 2,048 | 058-1/2/8 | SSRF/MIME/path/approval/tenant/fencing fixtures | recorded |
| Ledger/JSONL | 500 deltas: 1.19 ms with ledger, event append concurrency 1; 500 JSONL appends: 141.10 ms / 3,544 per second | closed 058-8 | Redaction canary; JSONL remains single-process development storage | verified 058-8 |
| Schema cache/parallel tools | warm validation 0.99 µs vs cold compile 2.50 ms; six 20 ms calls: 121.12 ms at concurrency 1 vs 60.92 ms at 2; exclusive turn clamps to 1 and later turn restores 2 | closed 058-8 | Invalid args never invoke handlers; coding shell definitions are exclusive | verified 058-8 |
| SQLite/PostgreSQL/KDF | SQLite 1,000 appends: 31.84 ms; scrypt/AES default: 48.09 ms; PostgreSQL fresh-container 15/15 integration pass | closed 058-8 | SQL isolation/injection, tamper/wrong-key/plaintext fixtures; DB TLS is host-owned | verified 058-8 |
| Dependency/artifact security | audit 0 vulnerabilities; clean graph; CycloneDX root + 173 components; 24 tarballs and 28 verified SHA-256 entries; 0 forbidden licenses/files/secret patterns | closed 058-8 | audit/license/provenance/secret/tarball scans | verified 058-8 |

### Plan 058 Task 1 integration and compatibility matrix — 2026-07-14

| Scenario | Public/packed boundary | Evidence | Result |
| --- | --- | --- | --- |
| 0.0.3 source compatibility + additive 0.0.4 structured-output/concurrency options | root public exports and TypeScript contracts | `src/__tests__/compatibility-0-0-3.test.ts`; root typecheck/runtime gate | pass |
| JSON Schema validator + `toolConcurrency: 3` + local and MCP-mapped tools + coding shell approval in one turn | fresh offline install of all 24 packed tarballs | generated consumer in `src/__tests__/install-smoke.test.ts`; ordered persisted results, exclusive-shell serialization, approval, invalid-arg block, read-only write denial; non-exclusive overlap covered by loop suite | pass |
| Hung MCP call | public `attachMcpToolBridge`, SDK linked in-memory transport | `packages/mcp/src/__tests__/bridge.test.ts`; 10 ms `callTimeoutMs`, attributable `mcp:hung:hang` error, returns under 150 ms | pass |
| Revision/redaction + native structured output and artifact fallback + provider telemetry | public core/provider APIs | root agent-loop, redaction, structured-output, observability, and provider conformance suites | pass |
| SQLite restart/resume + PostgreSQL checkpoint/lease resume | public persistence/workflow APIs | SQLite/workflow package suites and offline examples; Task 8 fresh `postgres:16` run passed all 15 live adapter tests | pass offline and live Postgres |
| Encrypted credentials + bounded multimodal provider mapping + workflow checkpoint/resume/cancel | public credentials/content/provider/workflow APIs | credential, content/provider-media, workflow package suites and nine offline workflow examples | pass |
| Secret containment | packed canary plus existing redaction/ledger/store/checkpoint/credential/provider fixtures | no canary in packed session store; aggregate threat suites green | pass |
| Node/package matrix | Node >=20 type/export contract plus Node 24 full gate | `npm run sdk:ready`: 1,475 tests, 1,450 pass, 25 explicit live skips, 0 failures; all 24 dry-run packs | pass |
| Live providers | six first-party provider smoke suites | `PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present`; skipped because no provider credentials were present | operator-gated, non-blocking offline |

### Plan 058 Task 2 release audit — 2026-07-14

| Audit | Evidence / decision | Result |
| --- | --- | --- |
| Dependencies | `npm audit --audit-level=high`; `npm ls --all`; lock integrity/provenance scan; `npm outdated --workspaces`; license and install-script inventories | 0 vulnerabilities; clean graph; `@types/node` patched to 22.20.1; runtime majors deferred with rationale in `release-and-install.md` |
| Maintainability | TODO/no-op scan, provider helper scan, hotspot/domain review, source-text-test scan, strict typecheck/export/package gates | no contradictory product TODO; shared bounded provider helpers used; no touched brittle source test; large core domains remain type-only/runtime-cohesive and are not churned for release |
| Performance | dated local benchmark matrix in `docs/performance.md`; existing SSE/telemetry/media/workflow stress evidence | all frozen thresholds pass; PostgreSQL wall-clock intentionally CI/environment-owned |
| Security | common-token/private-key scan plus SQL/SSRF/path/shell/schema/OAuth/credential/MCP/redaction suites; packed canary and deny-list guards | pass; host terminal ANSI/control rendering is explicitly host-owned because 0.0.4 ships RPC, not a TUI |
| Optional environments | packed imports/bin, failure fixtures, network-free guard, Node >=20 CI import job; PostgreSQL/provider/keychain gates retained | pass offline; credential/OS-backed gates remain explicit |

### Plan 058 Task 6 documentation release gate — 2026-07-14

| Surface | Evidence | Status |
| --- | --- | --- |
| API navigation and structure | 70 docs files; all non-template pages linked exactly once from `docs/index.md`; 59 API/provider pages enforce the wiki heading contract | pass |
| Imports/links/package graph | Local markdown links resolve; documented core subpaths and all 24 package names match manifests; packed export/import guards remain green | pass |
| Examples | All 39 TypeScript examples are listed and typechecked; runnable demos complete offline with secret-output scan | pass |
| READMEs/changelogs | Root + 23 workspace READMEs reviewed; every publishable package ships a finalized `0.0.4` changelog | pass |
| Compatibility/security/performance | Migration guide states additive 0.0.3 compatibility; API pages and release docs preserve finite limits, opt-in live gates, inactive-by-install behavior, and host trust/credential/transport/storage responsibilities | pass |
| Focused verification | `docs.test.ts`: 75 pass; `packaging.test.ts`: 124 pass; 0 failures | pass |

### Plan 058 Task 7 deterministic publication gate — 2026-07-15

| Surface | Evidence | Status |
| --- | --- | --- |
| Version graph | All 24 manifests, internal dependency/peer/dev ranges, lockfile workspace entries, root runtime version, and MCP client metadata are `0.0.4` | pass |
| Registry preflight | Live public-registry availability check reports all 24 `@arnilo/*@0.0.4` versions available; no publish performed | pass |
| Ordering/resume | One stdlib script derives graph once, emits stable topological order, skips only matching published manifests under `--resume`, and persists status after every package | pass |
| Publication security | Clean exact `v0.0.4` tag required; real publish cannot bypass checks; `--access public --provenance --tag latest`; OIDC `id-token: write` only in publish job; no long-lived token | pass |
| Dry run | Real npm CLI dry-run completed all 24 packages in graph order; report contains 24 `dry-run` statuses and 0 failures | pass |
| Automated regressions | Version/range mismatch, collision, matching/mismatched resume, interruption report, git state, publish args, and token canary tests | pass |

### Plan 058 Task 8 clean release-candidate gate — 2026-07-15

| Surface | Evidence | Status |
| --- | --- | --- |
| Clean build | Fresh 641-file committed snapshot; `npm ci` 1 s; `npm test` 28.209 s; `sdk:ready` 51.500 s; zero generated-file drift | pass |
| Test/runtime matrix | 1,475 tests: 1,450 pass, 25 explicit provider/keychain skips, 0 fail; Node 20.20.2 and Node 24.18.0 each import 20 root targets | pass |
| Optional database | Fresh `postgres:16`; all 15 PostgreSQL adapter integration tests pass, 0 skipped | pass |
| Exact packed consumer | 24 RC tarballs install offline; 24 packages, 37 imports, and `prism --help` pass | pass |
| Artifact inspection | 539,285 packed / 2,044,155 unpacked bytes; 24/24 reproducible shasums; no forbidden/unsafe files or metadata mismatch | pass |
| Supply chain | 0 audit vulnerabilities; clean dependency graph; CycloneDX 1.5 SBOM root + 173 components; no missing/prohibited license; 28 verified SHA-256 entries; 0 source/artifact token/private-key matches | pass |
| Publication boundary | Clean `v0.0.4` registry preflight and provenance-enabled npm dry-run pass 24/24; actual OIDC attestation awaits real publish by design | pass |
| Performance | `npm test` remains under 60 s; Task 2 ledger/JSONL/schema/parallel/SQLite/redaction/KDF/workflow benchmarks remain inside frozen ceilings | pass |

### Plan 058 Task 9 publish handoff — 2026-07-15

| Surface | Evidence | Status |
| --- | --- | --- |
| Registry state | Live preflight: 24/24 `0.0.4` versions available; 13 packages currently at `0.0.3`, 11 names unpublished | pass |
| Commit/tag dispatch | Protected signed commit/tag checklist; exact `v0.0.4` tag push dispatch; no local/manual publication | pass |
| Authentication | Existing GitHub `NPM_TOKEN` is scoped only to the publish step; OIDC/provenance remains enabled | operator prerequisite verified by owner |
| Order/resume | Exact 24-package topological order recorded; same-tag failed-job rerun skips only matching registry manifests | pass |
| Post-publish | Bounded metadata/integrity/checksum/import/bin/signature/provenance smoke documented | pass |
| Rollback | Immutable/non-transactional limitation, deprecation, dist-tag restoration/removal, and no-unpublish default documented | pass |
| Scope closure | Plans 053-057 follow-ups reconciled; no in-scope finding deferred; C-012 remains approved exclusion | complete |

## Core findings (Plan 053)

| ID | Priority | Finding | Plan task | Implementation | Tests | Docs | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | P0 | Revision request duplicated and corrupted by redaction | 053-1 | `src/agent-loops.ts`, `src/redaction.ts` | `src/__tests__/agent-loops.test.ts` (revision with redactor) | `docs/agent-loops.md`, `docs/credentials-and-redaction.md` | implemented |
| R-002 | P1 | Multi-round tool transcript chronologically invalid | 053-2 | `src/agent-loops.ts` | `src/__tests__/agent-loops.test.ts` (multi-round ordering) | `docs/agent-loops.md`, `docs/tools.md` | implemented |
| R-003 | P1 | Redactor leaks secrets in object/Map keys | 053-1 | `src/redaction.ts` | `src/__tests__/runtime-redaction.test.ts` | `docs/credentials-and-redaction.md` | implemented |
| R-004 | P1 | Event-ledger writes have no backpressure | 053-3 | `src/agents.ts` | `src/__tests__/run-ledger.test.ts` (serialized appends) | `docs/runs-and-usage.md`, `docs/performance.md` | implemented |
| R-005 | P2 | JSONL append silent on corrupt lines | 053-4 | `src/node/session-store-jsonl.ts` | `src/__tests__/node-session-store-jsonl.test.ts` | `docs/node-jsonl-session-store.md` | implemented |
| R-006 | P2 | Optional config ENOENT detected by message text | 053-5 | `src/node/config.ts`, `src/node/settings.ts` | `src/__tests__/node-config.test.ts` | `docs/node-filesystem-config.md` | implemented |
| R-007 | P2 | OpenAI-compatible malformed message `TypeError` | 053-1 | `src/providers/openai-compatible.ts` | `src/__tests__/openai-compatible.test.ts` | `docs/providers/openai-compatible.md` | implemented |

## Bug report fixes A–D

| Fix | Description | Covered by |
| --- | --- | --- |
| A+B | Repair input ownership / duplicate revision prompt | R-001 (`pendingHistory` + active-path redaction) |
| C | Diamond refs collapsed to `[Circular]` | R-001, R-003 |
| D | Provider assumes iterable `message.content` | R-007 |

## Provider findings (Plan 054)

| ID | Priority | Finding / capability | Plan task | Design / implementation | Tests | Docs | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-008 | P1 | Unbounded SSE/error bodies | 054-1, 054-2 | `src/providers/transport.ts`; migrated in all first-party providers | `src/__tests__/provider-transport.test.ts` + provider package suites | `docs/provider-primitives.md` | implemented |
| R-009 | P1 | OpenAI device-code OAuth polling | 054-3 | `packages/provider-openai/src/oauth.ts` | `packages/provider-openai/src/__tests__/codex-oauth.test.ts` | `docs/providers/openai.md`, `docs/credentials-and-redaction.md` | implemented |
| R-010 | P2 | Duplicated provider protocol helpers | 054-1, 054-2 | `src/providers/transport.ts`, `src/providers/openai-primitives.ts`; local `sse.ts` removed | `src/__tests__/openai-primitives.test.ts` + provider package suites | `docs/provider-primitives.md` | implemented |
| C-002 | — | Native structured output | 054-4 | `StructuredOutputOptions`, `validateStructuredOutputOptions`, provider mappers | `src/__tests__/structured-output.test.ts`, `openai-compatible.test.ts` | `docs/structured-output.md` | implemented |
| C-004 | — | Shared resilient transport | 054-1, 054-2 | `readSseEvents`, `readBoundedResponseText` in all first-party providers | Fixture matrix + provider suites | `docs/provider-primitives.md` | implemented |
| C-008 | — | Provider/tool observability | 054-5 | `ProviderTurnMetadata`, `@arnilo/prism-observability-opentelemetry` | `src/__tests__/observability.test.ts` + package suite | `docs/observability.md` | implemented |

## Tool execution findings (Plan 055)

| ID | Priority | Finding / capability | Plan task | Design / implementation | Tests | Docs | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-001 | — | Runtime JSON Schema tool validation | 055-1 | `src/tools.ts` (`ToolArgumentValidator`, `createToolParameterValidator`); `@arnilo/prism-tool-validator-json-schema` | `src/__tests__/tools.test.ts`, package suite | `docs/tools.md`, `docs/tool-execution-primitives.md` | implemented |
| C-003 | — | MCP client bridge | 055-3 | `@arnilo/prism-mcp`: `connectMcpTools`, stdio + Streamable HTTP, prefixed tools, bounded results | package suite (`packages/mcp`) | `docs/mcp-tools.md`, `docs/tool-execution-primitives.md` | implemented |
| C-006 | — | Approval/sandbox for coding tools | 055-4 | `src/execution-policy.ts`; `@arnilo/prism-coding-security`; coding-agent `executionPolicy` option | `src/__tests__/execution-policy.test.ts`, package suites | `docs/coding-security.md`, `docs/tool-execution-primitives.md` | implemented |
| C-007 | — | Parallel tool-call execution | 055-2 | `src/agent-loops.ts` (`dispatchToolCallsInOrder`, `resolveToolConcurrency`); `LoopContext.toolConcurrency` | `src/__tests__/agent-loops.test.ts` | `docs/agent-loops.md`, `docs/tools.md`, `docs/performance.md` | implemented |
| R-011 | P2 | Coding-agent image size / resize option | 055-5 | `maxImageBytes`, `transformImage`, `DEFAULT_MAX_IMAGE_BYTES`; deprecated `autoResizeImages` | `packages/coding-agent/src/__tests__/read.test.ts` | `docs/coding-agent-tools.md`, `docs/tool-execution-primitives.md` | implemented |

## Deferred to later plans (053–058)

| ID | Priority | Finding / capability | Owner plan | Status |
| --- | --- | --- | --- | --- |
| R-012 | P2 | Release workflow tag/version/resume | 058-7/9 | **implemented and verified** — deterministic graph, collision preflight, resumable publication, provenance, first-publication bootstrap, retained report, operator handoff |
| C-005 | — | Production database adapters | 056 | verified (sqlite offline + postgres CI live) |
| C-009 | — | Workflow orchestration | 057 | verified (distributed leases/coordinator + durable control + 9 examples + release gates) |
| C-010 | — | Audio/file/document multimodality | 056 | verified (core + provider mapping) |
| C-011 | — | Encrypted credential adapters | 056 | verified (`@arnilo/prism-credentials-node`) |
| C-012 | — | Interactive TUI | deferred | out of scope for 057 / 0.0.4 workflow completeness |

## Plan 056 — persistence, credentials, multimodality (Task 0)

| ID | Capability | Plan task | Design / implementation | Tests | Docs | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C-005 | Production database adapters | 056-0 / 056-1 / 056-2 / 056-3 / 056-7 | Task 0 matrix + Task 1 shared primitives + Task 2 `@arnilo/prism-session-store-sqlite` + Task 3 `@arnilo/prism-session-store-postgres` (`createPostgresPersistence`, advisory-lock migrations, pooled parameterized SQL, configurable schema); CI `postgres-integration` job | `packages/session-store-sqlite/src/__tests__/sqlite-persistence.test.ts`, `packages/session-store-postgres/src/__tests__/postgres-persistence.test.ts`, `postgres-integration.test.ts` (CI + `PRISM_TEST_POSTGRES_URL`), `persistence-schema.test.ts`, `conformance-helpers.test.ts` | `sqlite-persistence.md`, `postgres-persistence.md`, `database-persistence.md`, `session-store-conformance.md`, `run-ledger-conformance.md` | verified |
| C-010 | Audio/file/document multimodality | 056-0 / 056-5 / 056-6 / 056-7 | Core `audio`/`file`/`document` blocks + `resolveMediaContentBlock`; `@arnilo/prism/providers/media` wire helpers; OpenAI Responses maps `input_file`/`input_audio` with data-URL inline files, bounded upload cache + cleanup; Anthropic routes (OpenCode Go, Kimi) map PDF `document`/`file`; OpenRouter/NeuralWatt/Z.ai/OpenCode OpenAI route reject undeclared media | `src/__tests__/content.test.ts`, `src/__tests__/provider-media.test.ts`, `packages/provider-openai/src/__tests__/openai-media.test.ts`, provider package tests | `multimodal-content.md`, `provider-conformance.md`, `model-registry.md` | verified |
| C-011 | Encrypted credential adapters | 056-0 / 056-4 / 056-7 | `@arnilo/prism-credentials-node` — AES-256-GCM file envelope + scrypt + `@napi-rs/keyring@^1.3.0` keychain adapter; core stays storage-free | `packages/credentials-node/src/__tests__/credentials-node.test.ts` (opt-in keychain via `PRISM_TEST_KEYCHAIN=1`) | `credential-storage.md`, `credentials-and-redaction.md`, `settings-auth-trust-security.md` | verified |

## Verification evidence

### Plan 053 core gate

```bash
npm run typecheck
npm test
npm run build
```

All rows marked **implemented** in the core table pass their focused suites and aggregate core gates.

### Plan 054 provider gate — 2026-07-14

| Check | Result |
| --- | --- |
| `npm run sdk:ready` | pass; typecheck, 1,234 tests (1,209 pass, 25 opt-in live skips, 0 fail), workspace builds, export/install/package guards, and all dry-run packs |
| `npm audit --audit-level=high` | pass; 0 vulnerabilities |
| `npm ls --all --depth=0` | pass; clean workspace dependency tree |
| Duplicate-helper scan | pass; no provider-local `sse.ts`, `safeText`, `parseArgs`, or `toOpenAIMessage`; remaining Kimi/OpenCode Anthropic, OpenAI Responses, and NeuralWatt serializers are documented wire-format variants |
| Bounds/security fixtures | pass; SSE event/buffer/body/argument limits, abort, malformed schema, prototype-pollution keys, owned headers, and canonical secret-redaction tests |
| Benchmarks | 16 MiB SSE at 380 MiB/s with +1.7 MiB end heap delta; disabled telemetry within measurement noise; enabled realistic stream within 1%; details in `docs/performance.md` |

Plan 054 rows R-008 through R-010 and C-002/C-004/C-008 are verified **implemented**. Live provider tests remain explicit credential-gated smoke tests and account for the 25 aggregate skips.

### Plan 055 tool ecosystem / security gate — 2026-07-14

| Check | Result |
| --- | --- |
| `npm run sdk:ready` | pass; typecheck, 1,305 tests (1,280 pass, 25 opt-in live skips, 0 fail), workspace builds, export/install/package guards, and all dry-run packs |
| Focused 055 suites | pass; 342 focused tests across core tools/loops/execution-policy/export/install/packaging + tool-validator (12), mcp (11), coding-security (10), coding-agent read/shell/execution-policy |
| New package packs | pass; `@arnilo/prism-tool-validator-json-schema`, `@arnilo/prism-mcp`, `@arnilo/prism-coding-security` included in install-smoke + packaging + `pack:dry-run` |
| `npm audit --audit-level=high` | pass; 0 vulnerabilities |
| `npm ls --all --depth=0` | pass; clean workspace tree including Ajv 8 and MCP SDK 1.29 |
| Threat-model fixtures | pass; schema remote-ref/pollution/oversized args, parallel abort + ordered results, MCP name collision/list-changed/maxResultBytes, path/symlink/metacharacter/approval denial, image `maxImageBytes` stat-first reject |
| Secret scan (055 surfaces) | pass; no credential-like literals in new packages/core seams/docs |

Plan 055 rows C-001, C-003, C-006, C-007, and R-011 are verified **implemented**. Residual host responsibilities (MCP transport trust, `toolConcurrency` with dangerous shells, optional image transformers) are documented in `docs/tool-execution-primitives.md` and Plan 055 compromises.

### Plan 056 persistence / credentials / multimodality gate — 2026-07-14

| Check | Result |
| --- | --- |
| `npm run sdk:ready` | pass; typecheck, 1,396 tests (1,371 pass, 25 opt-in live skips, 0 fail), workspace builds, export/install/package guards, and all dry-run packs |
| Focused 056 suites | pass; persistence-schema + conformance helpers + content + provider-media (49), sqlite adapter (7), credentials-node (15), openai multimodal (3) + postgres offline identifiers/DDL |
| Live PostgreSQL matrix | pass; 9 integration tests via `PRISM_TEST_POSTGRES_URL` (session/run conformance, checkpoint CAS/fencing, atomic leases, migrations, pagination, tenant isolation, injection, advisory-lock race) |
| CI workflow | `.github/workflows/release.yml` adds `postgres-integration` job (`postgres:16` service + `npm run test:postgres`); publish waits on `verify`, `node20-compat`, and `postgres-integration` |
| New package packs | pass; `@arnilo/prism-session-store-sqlite`, `@arnilo/prism-session-store-postgres`, `@arnilo/prism-credentials-node` included in install-smoke + packaging + `pack:dry-run` |
| `npm audit --audit-level=high` | pass; 0 vulnerabilities |
| `npm ls --all --depth=0` | pass; clean tree including `better-sqlite3@12.11.1`, `pg@8.22.0`, `@napi-rs/keyring@1.3.0`; core remains dependency-free |
| Threat-model fixtures | pass; SQL injection/tenant isolation, encrypted-store wrong-key/tamper/plaintext scan/permissions/rotation, SSRF/MIME/bounds/unsupported modality, provider reject-undeclared media |
| Secret scan (056 surfaces) | pass; no credential-like literals in new packages/core media seams/docs |

Plan 056 rows C-005, C-010, and C-011 are verified. Residual host responsibilities (Postgres TLS/credential ownership, OS keychain availability, pre-resolving `resourceUri` before providers, provider upload retention) are documented in Plan 056 compromises and the persistence/credentials/multimodality docs.

## Plan 057 — workflow orchestration (Tasks 0–7)

| ID | Capability | Plan task | Design / implementation | Tests | Docs | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C-009 | Workflow/graph orchestration | 057-0 through 057-7 | Tasks 0–6 shipped bounded DAG orchestration and generic persistence/event primitives; Task 7 added core `LeaseStore`, persistence-owned atomic leases, fenced checkpoint CAS, and package-local multi-process enqueue/claim/renew/takeover/cancel coordination. | 34 workflow tests including distributed claim/concurrency/cancel/takeover and 1,000-node stress + 6 focused core primitive tests + SQLite/PostgreSQL persistence coverage; `npm run sdk:ready`: 1,444 tests (1,419 pass, 25 opt-in live skips, 0 fail), strict typecheck, 9 examples, install smoke, packaging guard, all dry-run packs | `workflows.md`, `workflow-orchestration-primitives.md`, `cli-rpc.md`, persistence docs, `examples/README.md` | **verified** |
| C-012 | Interactive TUI | — | Removed from Plan 057; deferred indefinitely. Workflow host control uses public APIs + optional RPC/`CommandDefinition` bindings instead of a terminal UI. | n/a | `workflow-orchestration-primitives.md` (deferral note); stub at `workflow-tui-primitives.md` | deferred |

### Plan 057 workflow gate — 2026-07-14

| Check | Result |
| --- | --- |
| `npm run sdk:ready` | pass; strict typecheck, 1,444 tests (1,419 pass, 25 explicit live skips, 0 fail), workspace builds, fresh offline install smoke, packaging guard, and all dry-run packs |
| Workflow/core primitives | workflow 34/34 + focused core 6/6 pass, including distributed exclusive claim, concurrency bounds, heartbeat cancellation, expiry takeover/fencing, checkpoint/lease/event primitives, and a bounded 1,000-node DAG |
| Examples | 9/9 default executions pass offline and emit no credential-shaped secrets; PostgreSQL safely skips without `PRISM_TEST_POSTGRES_URL` |
| Live PostgreSQL | root/CI `test:postgres` covers session/run/query persistence, checkpoint CAS/fencing, and atomic leases when `PRISM_TEST_POSTGRES_URL` is present; default network-free gate keeps it opt-in |
| Scope | no TUI/readline dependency; C-012 remains explicitly deferred and does not block C-009 verification |

### Task 0 primitive review summary (2026-07-14)

| Area | Shipped seams reused | Gaps closed in Task 0 design | Task 1 core primitive |
| --- | --- | --- | --- |
| Orchestration | `AgentSession`, `AgentLoopStrategy`, `LoopContext`, abort, `maxToolRounds`/`toolConcurrency` | Package DAG scheduler over multiple sessions | **Skip** (package-only) |
| CLI/RPC | `runRpcServer`, branch handles, concurrent abort, JSON events, `CommandDefinition` | Optional `createWorkflowCommands()` for start/status/cancel/resume (replaces TUI control surface) | **Skip** |
| Events | `AgentEvent`, bounded `subscribe()`, `RunLedger`, redaction | Package `WorkflowEvent` facade over generic bounded fan-in | **Added Task 6:** `EventMultiplexer<T>` |
| Approval | `PermissionPolicy`, `ExecutionPolicy`, `createCodingApprovalPolicy` | Host `approve` callback + `workflowId`/`nodeId` metadata | **Skip** |
| Persistence | `SessionStore`, `ProductionPersistenceStore`, SQLite/Postgres, `RunLedger` | `WorkflowCheckpointAdapter` over generic persistence capability | **Added Task 6:** `CheckpointStore` |

### Task 1 confirmation (2026-07-14)

| Decision | Outcome |
| --- | --- |
| Core `CheckpointStore` | **Added in Task 6.** Optional `ProductionPersistenceStore.checkpoints`; memory/SQLite/PostgreSQL implementations; workflows adapt via `createWorkflowCheckpoints({ store })`. |
| Core event multiplexer | **Added in Task 6.** `WorkflowEventBus` delegates source fan-in, queue bounds, overflow, abort, and close to `createEventMultiplexer<T>()`. |
| Core `ApprovalHandler` / workflow types | **Not added.** Host policies + package-local types only. |
| Locked contracts | `WorkflowCheckpointAdapter` (+ value/list shapes), `WorkflowEvent`/`WorkflowEventBus`, `runWorkflow`/`resumeWorkflow`/`getWorkflowRun`/`listWorkflowRuns`, `createWorkflowCommands` — documented in `docs/workflow-orchestration-primitives.md`. |
| Core code changed | Task 1: none. Task 6 review: generic primitives added without workflow vocabulary. |

Tasks 2–4 shipped `@arnilo/prism-workflows`, durable control, and 8 examples. Task 6 removed workflow-owned SQL/queue duplication: core now owns generic checkpoint/event primitives and first-party persistence owns durable checkpoint tables.
