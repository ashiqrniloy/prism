## [0.3.0] - 2026-08-20

### Added
- **Release 0.3.0 (plans 030, 031)** is the final lockstep cut and first independent-versioning line. The graph contains 57 publishable manifests; internal first-party ranges use `^0.3.0`, Decision B permits changed packages to patch/minor independently inside `<0.4.0`, and later publication uses `@arnilo/<package>@<version>` tags.
- Optional `@arnilo/prism-antigravity-agent` delegates autonomous coding sessions to the official Google Antigravity CLI (`agy`) with per-run loopback HTTP MCP capability exposure, AG-UI timeline projection, secret redaction, and `--conversation` continuation. Host owns the official binary and `agy login` authentication state.
- Optional `@arnilo/prism-computer-use-linux` wraps a host-owned Linux `computer-use-linux` MCP binary. DeviceAdapter admission is deny-by-default, setup tools are opt-in, mutating calls require approval/ExecutionPolicy, results are bounded and untrusted, input is serialized, and the package is omitted from umbrellas.
- Coding/ACP closeouts: `read.findText`, visible fuzzy edit outcomes and nearby miss context, ACP editor-buffer filesystem operations, spawnable per-session coding registries, and delete/move result locations.

### Changed
- Release automation keeps explicit `--lockstep --version 0.3.0` for the final cut, then defaults to changed-package validation/publication and package tags. No Changesets or new core runtime dependency.
- No persisted store migration. Live-service canaries and delegated Cursor adapter remain later demand-gated 0.3.x work.

## [0.2.9] - 2026-08-19

### Changed
- **Release 0.2.9 (plan 029)** is the provider-adoption and behavior-packages cut. **Additive-only.** New packages: `@arnilo/prism-provider-deepseek`, `@arnilo/prism-provider-xai` (API key + SuperGrok RFC 8628 device-code), `@arnilo/prism-provider-clinepass`, `@arnilo/prism-impeccable`. `pollDeviceCodeToken` accepts `bodyEncoding: "form"` and `extraDeviceParams`. Ponytail peer `^4.9.0` (empty `/ponytail` reports status). Caveman registers extra `SKILL.md`. Graph **55** publishable manifests at exact **0.2.9**. Store-compatible with 0.2.8; no migration. **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.9 publish handoff` — signed `v0.2.9` tag + npm OIDC).

## [0.2.8] - 2026-08-18

### Changed
- **Release 0.2.8 (plan 028)** is the ACP adoption-fixes cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.8: expected deltas are the version literal plus the plan 028 additive exports — `ToolKind`/`ToolDefinition.kind`, `AgentFinishReason`/`agent_finished.finishReason`, `AgUiProjectedImage`/`AgUiProjectedToolResult`/`createCodingToolProjection`, `AcpCommand`/`AcpCommandsSeam`, `ERR_PRISM_ACP_RUN`, `acpImageBytes`/`acpCommandsPerUpdate`, and the new `@arnilo/prism-acp-agent` package; zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`). Client names are scrubbed from the tree and `scripts/check-client-neutrality.mjs` is wired into `npm run release:gate`. ACP bugs B1–B5: truthful `usage_update` via a host `contextWindow` seam (omit when unknown); run-level `error` rejects `session/prompt` with `ERR_PRISM_ACP_RUN` (no fake transcript chunks); only boolean config options are advertised/`set_config_option` (select fails `ERR_PRISM_ACP_CAPABILITY`); `tool_call.kind` prefers registry `ToolDefinition.kind`; permission docs match SDK wire kinds (`allow_always`/`reject_always`). Features F1–F10: thinking → `agent_thought_chunk`; bounded redacted transcript replay on `session/load`/`resume`; spawnable `@arnilo/prism-acp-agent` over stdio; `session/prompt` `StopReason` fidelity; UNSTABLE-gated `plan_update`/`plan_removed` from coding plan lifecycle; host-owned `session_info_update` titles; opt-in `createCodingToolProjection()` for first-party edit/write diffs+locations; projected `toolResult` images as ACP content/image blocks (`acpImageBytes`); host slash commands as `available_commands_update` (`acpCommandsPerUpdate`); Windows sandbox policy documented (native backend stays Linux-only, fail-closed). Release graph is **51** publishable manifests at exact **0.2.8** (root + 50 workspace; `+1` `@arnilo/prism-acp-agent`). Store compatibility with 0.2.7: **compatible, no migration**. Exit gate green (`sdk:ready`, `release:check` including the client-neutrality guard, audit 0 moderate, scan-secrets 0, SBOM regenerated). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.8 publish handoff` — signed `v0.2.8` tag + npm OIDC).

## [0.2.7] - 2026-08-17

### Changed
- **Release 0.2.7 (plan 027)** is the enterprise ERP production-readiness cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.7: expected deltas are the version literal plus the plan 027 additive exports — ERP outbox/inbox stores + bounded dispatcher, saga compensation/reconciliation engine, multi-party SoD approvals, signed hash-chained audit export with WORM/SIEM seams, field-level classification + fail-closed redaction, deterministic ERP invariant evals; zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase27-freeze-manifest.json` records per-task evidence tokens, state machines, caps, the demand registry, measured HA/DR/classification/journey numbers, and the 0.3.0 blocker). Nine roadmap items with threat model ERP-T1–ERP-T10, ownership/tenant tests, no exactly-once claim, no implicit credential discovery, package budget, docs entries, and protected end-to-end evidence: (1) **transactional outbox/inbox** (`erp-messaging`, Task 1) — `ErpOutboxStore`/`ErpInboxStore` + bounded `ErpOutboxDispatcher` with claim-token CAS, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT DO NOTHING` idempotent append, at-least-once delivery with explicit unknown-outcome, dead-letter/replay requiring verified tenant `AgentIdentity`; migrations 004 (`prism_erp_outbox`/`prism_erp_inbox`). (2) **saga compensation and reconciliation** (`saga`, Task 2) — `defineSaga`/`runSaga`/`resumeSaga` over existing CheckpointStore + LeaseStore with reverse-order compensation, unknown-outcome detection, manual resolution requiring verified identity + bounded reason + audit ref, stable tenant-scoped operation keys, redacted snapshots, `MAX_SAGA_STEPS=100`. (3) **multi-party SoD approvals** (`approvals`, Task 3) — `ApprovalStore` with role/quorum rules, requester/approver separation, any-party-veto rejection, delegated authority (max depth 8), expiry checked at every protected transition, atomic grant consumption in the host transaction, `policyRevision` pin denying on mismatch; migration 005 (`prism_erp_approvals`). (4) **tamper-evident audit export** (`audit-export`, Task 4) — `createAuditExporter` with WORM-then-SIEM ordering, hash-chained record envelopes (genesis 0x64 zeros), `verifyAuditBatch` independent verification, `AuditCursorStore` CAS, SIEM best-effort pending replay (8-entry cap), legal-hold flag preservation, RFC 8785 canonical JSON for digests. (5) **secret-manager adapters** (Task 5) — Vault/AWS/Azure/GCP stay **deferred** behind the demand gate (no named consumer; no adapter ships; `scripts/phase27-demand-gate.mjs` enforces zero ambient discovery). (6) **HA registries and recovery** (`ha-dr`, Task 6) — two-replica drill on real Postgres proves failover within lease TTL+5s (measured 4100 ms vs 9000 ms ceiling), idempotent outbox re-append on uncertain-commit replay, stale fence/revision write rejection, exactly-one lease owner, tenant isolation fail-closed. (7) **backup/restore/migration rollback evidence** (Task 7) — `pg_dump`/`pg_restore` custom-format backup (108,291 B / 122 ms / 382 ms restore), 0.2.6→0.2.7 migration forward+rollback rehearsed (5 migrations), PITR RPO 0 s / RTO 1 s (recovery 1163 ms); production rollback is roll-forward repair only (no down migrations). (8) **field-level classification and fail-closed redaction** (`field-policy`, Task 8) — `applyFieldPolicy`/`FieldPolicy`/`createProtectedFieldPolicy` at the redaction, audit-export, and OpenTelemetry seams; unknown-label deny-on-outbound fail-closed default, sparse-copy walker, measured overhead peak 99.8% of the redactor-walk baseline (cap 110%). (9) **ERP release journey** (`erp-evals`, Task 9) — `erpInvariantDataset` + `createErpInvariantScorers` (8 hard 0/1 gates consuming structured facts only) + `scripts/phase27-erp-journey.test.mjs` exercising identity/policy/budget/SoD-approval/outbox/saga-compensation/audit-export/legal-hold/classification/failover/restore end-to-end (4815 ms, all 8 invariants pass). Release graph stays **50** publishable manifests at exact **0.2.7**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.6: **compatible, additive** (two new ERP migrations 004/005 + outbox/inbox/approvals tables; rollback = stop 0.2.7 workers, restore the 0.2.6 manifests/tag — see `docs/migration.md` `0.2.6 → 0.2.7`). Exit gate green (core + script gates incl. `phase27-freeze` 9, `phase27-release` 12, `phase27-ha`/`phase27-dr`/`phase27-erp-journey` protected legs, coverage gate, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.7 — version literal + additive exports only, release-evidence manifest with zero blocked surfaces, evidence in `scripts/phase27-release-evidence.json`). **"ERP production ready" remains blocked until the 0.3.0 live-service matrix is recorded** — passing 0.2.7 gates unblocks the release cut, not the 0.3.0 live-service matrix. **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.7 publish handoff` — signed `v0.2.7` tag + npm OIDC).

## [0.2.6] - 2026-08-16

### Changed
- **Release 0.2.6 (plan 026)** is the fully-featured coding-agent-readiness cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.6: expected deltas are the version literal plus the Task 1-6 additive exports — PTY backend/handle types, the indexed-search seam, the workspace lifecycle, process/ACP recovery, the review manifest + diagnostics; zero removals; no `--allow-break`; freeze manifest `scripts/phase26-freeze-manifest.json` records per-task evidence tokens, state machines, caps, and the demand registry). Seven roadmap items with threat model T1-T8, ownership tests, no implicit activation, package budget, docs entry, and protected end-to-end evidence: (1) **host-selected PTY/interactive terminal backend** (`pty-backend`, plan 026 Task 1) — `createProcessSessions` gains an optional `ptyBackend` seam with explicit `capabilities.resize` (never duck-typed); `pty: true` without a backend fails byte-compatibly with `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before spawn; bounded terminal geometry/TERM/attach-timeout/resize-rate/metadata caps (`ERR_PRISM_PROCESS_PTY_LIMIT`), generic `ERR_PRISM_PROCESS_PTY_BACKEND` errors that never leak backend text, NUL rejected in PTY input as a policy error, terminal output stays untrusted with no parser/emulator, backend loss surfaces as `unknown` with `exitCode: null`. (2) **scalable indexed code-search seam** (`indexed-search`, Task 2) — `createIndexedRepositoryOperations` composes a host-owned incremental index backend (`update/remove/search/status/dispose`, `capabilities.semantic` explicit) with the bounded literal search as the unchanged default; `indexed_literal`/`semantic` modes fail closed on stale/failed/unsupported/untrusted indexes (`ERR_PRISM_INDEX_*`), no silent semantic-to-literal downgrade, results labeled `untrusted_index`, containment/score/snippet caps enforced, 100k-entry benchmark p95 <= 250 ms. (3) **ownership-scoped multi-repository and worktree lifecycle** (`workspace-lifecycle`, Task 3) — `createCodingWorkspaceLifecycle` over CheckpointStore CAS + LeaseStore fencing (`prism.coding-agent.workspace.v1` records, schemaVersion 1): deterministic `ws-` ids, locked worktrees with `prism-workspace:` reasons, credential-free remote fingerprints (sha256 of redacted URL + default branch, never the URL), idempotent create, verify revalidating repository/worktree identity, and a cleanup refusal matrix (dirty/locked/unowned/missing/mismatched/main) with `ERR_PRISM_WORKSPACE_*` codes; `GitOperations` gains worktree `lock`/`unlock` and `fingerprint()`. (4) **forge breadth demand-gated** (Task 4) — GitLab/Bitbucket adapters stay **deferred** in the demand registry (no named consumer/date/use case recorded), so no adapter source ships and the forge barrel contains no provider name; activation requires a recorded named consumer. (5) **durable ACP/live-task and managed-process recovery** (`durable-recovery`, Task 5) — `ProcessSessions` persists bounded intent/metadata before spawn in `prism.coding-agent.process.v1` records (never handles/env/tokens/raw output), serializes per-record transition CAS writes, and `recover()` is attach-if-attested reporting `attached|terminal|unknown` with no fabricated exit code and no PID probing; per-record leases (30 s/300 s) fence two replicas (split-brain conformance green on real Postgres); `PersistedAcpSession` gains an additive optional `activeRun` ref (0.2.5 records stay readable) and `createAcpRunRecovery` re-resolves status against `AgentRunLifecycle` (suspended keeps pending approval ids, unprovable in-flight -> unknown, never a restarted prompt) with durable ownership/version/fence-checked cancellation in `prism.coding-agent.cancel.v1` markers that never replays a pending/dispatched tool; `ERR_PRISM_RECOVERY_*` codes. (6) **bounded patch review and incremental diagnostics** (`review-diagnostics`, Task 6) — `createCodingPatchReviewManifest` builds a digest-bound manifest (patch sha256 + repository/worktree/base/head identity + changed paths/diffstat + checks + diagnostic summaries, never a raw patch body) composed over the server `ArtifactService`; `assertCodingPatchAccepted` derives `pending|accepted|rejected|superseded` bound to the exact artifact revision and digest, refuses stale acceptance, and never applies/commits/pushes/merges; `LanguageIntelligence` gains opt-in full-content `syncDocument` (monotonic versions) and `diagnosticDelta` (push/pull with resultId reuse, stale-version guards) plus `normalizeDiagnostics` with deterministic added/removed/unchanged deltas and host-supplied check parsers; LSP stays strictly opt-in (nothing spawns from tool factories or agent assembly). (7) **protected real coding journey** (`coding-journey`, Task 7) — `scripts/phase26-coding-journey.test.mjs` runs a packed consumer through real host services only (provider call, digest-pinned Docker sandbox, Postgres worktree lifecycle, provider-driven ACP edit with policy approval, named check + `diagnosticDelta`, patch review over the server artifact store, cross-replica process recovery, durable cancellation, real GitHub push/lookup-before-create PR/reconcile/cleanup, host Playwright inspection, host PTY adapter in the frozen profile) under the frozen wall/cleanup ceilings with run-suffix side effects and per-step idempotent cleanup; missing credentials/services or skipped substeps record `blocked`, never a passing skip; the retained `scripts/phase26-coding-journey-report.json` carries timings/states/ids only and gates release evidence (pass/blocked/protected). Release graph stays **50** publishable manifests at exact **0.2.6**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.5: **compatible, additive** (three new versioned record namespaces + the optional ACP `activeRun` field; rollback = stop 0.2.6 workers, mark active PTY/process/recovery records unknown, restore the 0.2.5 manifests/tag — see `docs/migration.md` `0.2.5 → 0.2.6`). Exit gate green (core + script gates incl. `phase26-freeze` 11, `phase26-index-benchmark`, coding-agent 348 + ag-ui 203 workspace suites, coverage gate, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.6 — version literal + additive exports only, protected Postgres recovery/workspace conformance 8/8, protected PTY leg 4/4, protected real coding journey per the retained report, release-evidence manifest with zero blocked surfaces, evidence in `scripts/phase26-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.6 publish handoff` — signed `v0.2.6` tag + npm OIDC).

## [0.2.5] - 2026-08-15

### Changed
- **Release 0.2.5 (plan 025)** is the maintainability-and-bounded-performance cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.5: expected deltas are the version literal plus 105 additive internal-helper exports — 84 Task 1 cross-family helpers across core/coding-agent/workflows/server/ag-ui and 21 `prism-session-store-codecs` helpers; zero removals; no `--allow-break`). Five roadmap items, no runtime contract change and no migration: (1) **god-module splits** (`god-module-split`, 0.1.4 precedent) — the six remaining implementation god-modules split along cohesive boundaries into internal family files behind preserved barrels: `src/contracts-core.ts` (1,719 L → 10 families, max 403 L), `src/agent-session.ts` (2,049 L → 4 modules; the 1,686-L `RuntimeAgentSession` class kept intact — a single TS class cannot span files without exporting private methods, recorded reason), `packages/workflows/src/run.ts` (1,227 L → 6 families, max 417 L), `packages/server/src/handler.ts` (1,005 L → 8 families, max 444 L), `packages/coding-agent/src/repository.ts` (974 L → 7 families, max 299 L), `packages/ag-ui/src/acp/agent.ts` (836 L → 8 families, max 386 L); no `exports`-map subpath added; `ponytail:` comments preserved; zero breaking compat deltas (`scripts/phase25-compat-diff.mjs`). (2) **persistence-mechanics dedup** (`session-store-codecs`) — 21 pure helpers (ownership scope/assertion, checkpoint stale/encode/decode, branch cursors, lifecycle quota/reason/page-limit, search metadata/clipping, deepFreeze/string-array/throwIfAborted, feedback row mapping) moved into the dependency-free codecs package (426 → 624 L, stdlib only); the postgres/sqlite adapters shrank 273 lines total; SQL dialect/DDL/query execution stay per-adapter; no persisted-shape change; cross-store conformance green before/after. (3) **quadratic accumulation removed** (`bounded-accumulation`) — the per-push `Buffer.concat` loops in `LspFrameReader` (language framing) and `summarizeTarStream` (tar parsing) became chunk-array readers (two-phase header parse, offset-advance drop, take/drop sliding window); caps + fail-closed overflow byte-identical; framing ~100–200× faster at 4,000 chunks (1,298.4 ms → 11.2 ms), tar linear at 8 MiB; CLI `collectOutput` audited and kept (already linear, plan 020); the 10-test near-limit probe `scripts/phase25-bounded-accumulation.test.mjs` is wired into the npm test gate segment and asserts linear copying by byte-count instrumentation. (4) **dead-code cleanup, internal-only** (`dead-code`) — the 62 `dead-exports.mjs` candidates triaged in `docs/_evidence/phase25-dead-exports-triage.md`: 2 internal removals (`PostgresPersistenceCloseOptions`, `SqlitePersistenceCloseOptions` — never re-exported from their adapter indexes), 37 test-used false positives, 20 dead-but-compat-tracked + 3 public type aliases deferred to the 0.3.0 breaking cut; the named-internal audit (`agent-session`/`cache-telemetry`/`skill-load`) recorded clean at 0.2.4; no public export removed. (5) **coverage close, behavior-backed** (`coverage`) — 76 focused regressions (approval 43, conversations 22, artifacts 6, tool-effect-store conformance 5; compaction via its 17 existing package suites); core coverage 90.53/84.20/90.54 → **91.43/84.80/91.60** lines/branches/functions (gate 60/70/75; all 39 non-protected packages above their evidence thresholds). Release graph stays **50** publishable manifests at exact **0.2.5**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.4: **compatible, no migration** (no persisted-shape change; rollback = restore the 0.2.4 manifests/tag — downgrade is store-safe and code-safe, the added exports simply disappear). Exit gate green (core + script gates incl. `phase24-truth` 12 + `phase25-bounded-accumulation` 10, coverage gate, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.5 — version literal + additive exports only, protected Postgres durable + cross-store conformance evidence per the release skip manifest, release-evidence manifest with zero blocked surfaces, evidence in `scripts/phase25-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.5 publish handoff` — signed `v0.2.5` tag + npm OIDC).

## [0.2.4] - 2026-08-14

### Changed
- **Release 0.2.4 (plan 024)** is the package-documentation-and-compatibility-truth cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.4: delta is the version literal only). Truth remediation, no runtime contract change: (1) **umbrella wording matches manifests** — `@arnilo/prism-providers` states 11 of 14 first-party provider adapters (Azure/Bedrock/Vertex are added separately by `@arnilo/prism-all`; its install list was corrected from 9 to the full 11 — alibaba and ollama were missing) and `@arnilo/prism-all` states 20 direct / 43 transitive packages with the complete omission set (document-reader, OpenAPI tools, NATS, Caveman, Ponytail); membership unchanged in 0.2.x (§0.3.0 owns expansion). (2) **manifest-derived package truth** — dependency-free `scripts/package-truth.mjs` → `scripts/package-truth.json` becomes the single source for counts (50/49/14/9/26), provider membership, umbrella closures, and profile closures; the count/tarball/current-line docs literals were regenerated from it; `scripts/phase24-truth.test.mjs` asserts generator reproducibility, committed-artifact equality, count/closure correctness, and fail-closed behavior on malformed manifests and unmatched workspace globs. (3) **peer-version policy Decision A** — exact `@arnilo/prism: <current>` pins remain through 0.2.x with the atomic-upgrade rule (all `@arnilo/prism-*` packages move at the same version; partial upgrades are unsupported and fail clearly with npm ERESOLVE); the range widens to `^1.0.0` at the 1.x stable release; documented in `docs/release-and-install.md` + `docs/migration.md`. (4) **current-line truth** — `docs/0.1.0-readiness.md` and `docs/index.md` current-line blocks refreshed to the 0.2.x line, with 0.1.7 recorded as the terminal 0.1.x baseline and the 0.1.1/0.1.0 tables demoted to historical record. Release graph stays **50** publishable manifests at exact **0.2.4**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.3: **compatible, no migration** (no persisted-shape change). Exit gate green (core + script gates incl. `phase24-truth` 12 tests, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.4 — version literal only, protected Postgres durable conformance evidence per the release skip manifest, release-evidence manifest with zero blocked surfaces, evidence in `scripts/phase24-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.4 publish handoff` — signed `v0.2.4` tag + npm OIDC).

## [0.2.3] - 2026-08-14

### Changed
- **Release 0.2.3 (plan 023)** is the build-coverage-and-release-evidence-integrity cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.3: delta is the version literal only — no export changes; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase23-freeze-manifest.json` records per-task evidence tokens). Four tooling/evidence fixes, no runtime contract change: (1) **build serialization** (`build-serialization`, core tooling) — dependency-free `scripts/with-build-lock.mjs` holds one O_EXCL lockfile at `node_modules/.prism-build.lock` (pid + startedAt, read-back verified, stale-PID reclaim via `process.kill(pid, 0)`, 100 ms backoff to env-overridable `PRISM_BUILD_LOCK_TIMEOUT_MS` default 120 s, fail-closed exit 1) around every emit/test leaf (root `build:core`, both `node --test` segments, `test:coverage` leaves, coverage summary, all 43 workspace build/test/`test:postgres` scripts) so concurrent compilers and importers can never observe a partially emitted `dist/` — the 2026-08-12 review defect that 0.1.1's destructive-clean removal did not close; the lock is never held by orchestrator scripts, `PRISM_BUILD_LOCK_HELD=1` prevents accidental nesting, and the direct-`tsc` caveat is documented in `docs/release-and-install.md`. (2) **corrected workspace coverage denominators** (`coverage-denominators`, `scripts/coverage-summary.mjs`) — workspace coverage runs now pass package-local `--test-coverage-include=dist/**` so imported core `dist/` no longer pollutes package rows (`mcp` 45.47→90.25, `rag` 19.70→94.82, `memory` 20.37→72.00, `session-store-nats` 16.04→93.69, `enterprise-postgres` 21.93→43.26; `session-store-postgres` stays 22.89 as the protected durable-leg proof); the 60/70/75 core gate is unchanged; evidence-based per-package line thresholds in `scripts/coverage-thresholds.json` (freeze-run percentages minus 3 pp) with `protectedException` entries for the env-gated durable-leg packages (`session-store-postgres`, `enterprise-postgres`, `memory`, `session-store-nats`) shown separately; the machine-readable `scripts/coverage-summary.json` artifact records per-package lines/branches/functions/denominator files/threshold/pass-fail and the gate exits 1 on any non-protected below-threshold package. (3) **machine-auditable release skip manifest** (`skip-manifest`, `scripts/release-skip-manifest.mjs` → `scripts/release-evidence.json`) — every release surface (core `npm test`, each workspace suite, threat suites, `test:postgres` durable conformance, provider live legs, NATS real legs, the four live canaries) records `pass`/`skip`/`blocked`/`protected` with reason and required env names only (never secrets); the 33 protected/live skips are named; a required surface with absent evidence records `blocked` and `scripts/release.mjs` gate fails closed (`checkReleaseEvidence`) — missing credentials/services can never convert into a green release; the artifact is CI-retained and gitignored. (4) **stabilized quality gates** (`quality-gates`) — `biome.json` migrated to the 2.x canonical `linter.rules.preset: "recommended"` (deprecated key removed) and all 97 lint diagnostics resolved to zero (safe + reviewed `--unsafe` fixes across 108 files, 10 hand-removed dead `_`-renamed variables, 5 justified `biome-ignore` comments for shell-interpolation probes/verbatim fixtures/grep targets); the racy 150 ms MCP bridge timing assertion became a deterministic awaited-outcome barrier with a test-level timeout, and kept load-sensitive guards carry documented `ponytail:` ceilings; `npm run lint` writes machine-readable `scripts/lint-report.sarif` and `npm run sweep:unused` writes `scripts/unused-report.json`, both retained by the release workflow. New regression surface: `scripts/phase23-build-race.test.mjs` (8 lock/stress tests incl. synthetic partial-`dist` sensitivity, stale-lock reclaim, live-lock fail-closed), `scripts/phase23-coverage.test.mjs` (4 tests: include-filter + core-gate greps, thresholds JSON validation, real-artifact denominator proof, sabotaged fail-closed run), `scripts/phase23-skip-manifest.test.mjs` (6 tests: blocked-not-skip, protected-named with the frozen 33-skip floor, live-canary-not-pass, unexplained-skip-rejected, no-secret, wiring), `scripts/phase23-quality-gates.test.mjs` (5 tests: lint clean, preset config, timing quarantine, biome-ignore reasons, machine-readable reports), and `scripts/phase23-security.test.mjs` (3 tests: matrix item 4 concurrent emit+public-entry importer, matrix item 12 coverage denominator + protected rows, gate accounting — built public entrypoints, wired into `security:threat-suites`) plus the packed plain-JS `security23.mjs` consumer in install-smoke. Release graph stays **50** publishable manifests at exact **0.2.3**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.2: **compatible, no migration** (no persisted-shape change). Exit gate green (core + script gates incl. phase21-freeze done-phase + all phase23 suites, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.3, protected Postgres durable conformance evidence, release-evidence manifest with zero blocked surfaces, evidence in `scripts/phase23-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.3 publish handoff` — signed `v0.2.3` tag + npm OIDC).

## [0.2.2] - 2026-08-13

### Changed
- **Release 0.2.2 (plan 022)** is the concurrent-state-and-durability-integrity cut on the 0.2.x review-remediation line. API surface **additive-only** vs 0.2.1 (plain reviewed compat gate at 0.2.2: deltas are the version literal plus `ModelRouterStateStore.reserveBudget`/`commitBudget`/`releaseBudget`, `ModelRouterReservation`, `ModelRouterBudgets.reservationTtlMs`, `ModelRouterLimits.maxRateKeys`/`maxBudgetKeys`, `SessionRecord.version` with `appendSession` `expectedVersion`, `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`, and the `@arnilo/prism/testing/state-concurrency-conformance` subpath; no removal; no `--allow-break`), four behavior tightenings documented in `docs/migration.md` `0.2.1 → 0.2.2`: (1) **atomic model-budget reservation** (`budget-reservation`, `@arnilo/prism-model-router` + `@arnilo/prism-enterprise-postgres`) — admission now runs `reserveBudget` (used + reserved + requested <= window max, `{reservationId, fencingToken, admitted, retryAfterMs?}`) and outcomes run `commitBudget` (actuals; a TTL-expired late commit charges the reserved amount with `unknownUsage: true`) or `releaseBudget`; reservations expire after `reservationTtlMs` (default 60 s, bounded to 31 days) so a crashed request never holds capacity forever; 0.2.1 `readBudget`/`addUsage` remain for cap-less requests and retrospective accounting, no longer admission authority; rate/budget key maps are capped (`maxRateKeys`/`maxBudgetKeys` 4,096 default / 65,536 hard; circuits unchanged) with LRU eviction that never drops a held-reservation row (capacity-exhausted fail-closed otherwise); durable store keeps reservations in a `reservations` JSONB column (enterprise migration 003, forward-only, checksummed). (2) **atomic conversation metadata** (`conversation-metadata-cas`, `@arnilo/prism-session-store-postgres` + `@arnilo/prism-session-store-sqlite`) — `SessionRecord.version` (fresh rows start at 1; migration 008 backfills legacy rows) and `appendSession` `expectedVersion` (`0` create-only, `N>0` exact-CAS update-only, omitted = 0.2.1 last-write-wins); stale writes throw `SessionMetadataConflictError` `metadata_conflict` carrying only `{id, expectedVersion, currentVersion}` (never metadata content), HTTP 409; concurrent create/branch/archive are single-statement with branch caps enforced inside the CAS write, archive wins over stale writers, retention-deleted rows are never resurrected. (3) **single-consumer EventMultiplexer** (`single-consumer`, core) — a second concurrent `subscribe()` throws `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER` instead of silently sharing one queue and losing events; slot frees on completion/return-at-yield/close; in-repo consumers (workflow bus, supervisor) already single-subscriber. (4) **restart-stable NATS durable identity + bounded non-durable active-run registries** (`nats-durable`, `@arnilo/prism-session-store-nats`; `active-runs`, `@arnilo/prism-workflows`) — the durable consumer name is exactly `prism_<hmac16 of tenantId|sessionId|runId>` (random suffix removed) so a crash-resumed subscribe continues from the last ack; clean stops delete the consumer (cursor resume), orphaned 0.2.1 `prism_<digest>_<random>` consumers are reclaimed by the existing cleanup; the workflow active-run registry sweeps aborted/leaked entries on register and fails closed at the 512 cap (`ERR_PRISM_WORKFLOW_RUN_REGISTRY_OVERFLOW`), documented non-durable. New regression surface: `scripts/phase22-security.test.mjs` (5 tests: 4 blockers + gate accounting, built public entrypoints, wired into `security:threat-suites`), the packed plain-JS `security22.mjs` consumer in install-smoke, the `@arnilo/prism/testing/state-concurrency-conformance` harness (7 probes — approval, cursor, checkpoint CAS, idempotency, router reservation, conversation metadata, unknown-outcome — memory leg in npm test, durable legs in `test:postgres`/NATS seam, zero timing-only sleeps), and the `scripts/phase22-conformance.test.mjs` gate in the `test:postgres` chain; phase-22 evidence in `scripts/phase22-baseline.json` + `scripts/phase22-freeze-manifest.json`. Release graph stays **50** publishable manifests at exact **0.2.2**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.1: **forward-only migrations** (`prism_sessions.version` migration 008, `prism_model_router_budgets.reservations` enterprise migration 003; 0.2.1 databases migrate in place, 0.2.1 binaries read 0.2.2 databases but ignore the new columns — see `docs/migration.md` rollback-risk). Exit gate green (core + script gates incl. phase21-freeze + phase22 conformance, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.2, protected OIDC/OPA + durable state-concurrency evidence, evidence in `scripts/phase22-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.2 publish handoff` — signed `v0.2.2` tag + npm OIDC).

## [0.2.1] - 2026-08-13

### Changed
- **Release 0.2.1 (plan 021)** is the provider-completion and outbound-trust-boundaries cut on the 0.2.x review-remediation line. API surface **additive-only** vs 0.2.0 (plain reviewed compat gate at 0.2.1: deltas are the version literal plus `@arnilo/prism-mcp` transport helpers re-exported from the lifted core primitives — same names/signatures, no removal; no `--allow-break`), five documented security-motivated behavior tightenings in `docs/migration.md` `0.2.0 → 0.2.1`: (1) **strict stream completion is the shared default** (`strict-completion`, core `createOpenAICompatibleProvider`) — `strictCompletion` defaults to `true` (explicit `false` stays the documented opt-out): a stream ending without `[DONE]` plus a choice-level `finish_reason` now fails with `ProviderTransportError` `incomplete_delta` instead of a successful `providerDone`, and done events carry usage only with completion evidence; applies to Azure, Bedrock, Vertex, OpenRouter, ZAI, NeuralWatt (Alibaba/Kimi/Ollama/OpenCode-go had already opted in). (2) **bounded success bodies** (`bounded-bodies`, core `@arnilo/prism/providers/transport`) — additive `readBoundedResponseJson` (65,536-byte UTF-8 ceiling, max JSON depth 32, max properties 4096, caller shape gate, abort, redacted errors, new `ProviderTransportError` code `response_body_shape`) replaces unbounded `response.json()` at all ten model-discovery sites plus NeuralWatt quota, Alibaba embeddings, OpenAI uploads, and both OAuth success paths. (3) **DNS-pinned OIDC/OPA/content fetch, redirects rejected** (`dns-pinning`, core `src/pinned-fetch.ts` + `@arnilo/prism-credentials-node`, `@arnilo/prism-policy`, `@arnilo/prism-mcp`) — `pinnedFetch`/`resolvePinnedAddress`/`requestPinned` lift the MCP pinning algorithm (one resolve, 1–32 bound, family check, loopback confinement, per-candidate `assertSsrfAllowedUrl`, pinned-lookup socket) into core; default JWKS, OPA decision, and content/media fetches route through it and **reject 3xx redirects outright** (`MediaContentError` code `redirect`); private/metadata/loopback answers fail closed `ssrf_denied`; MCP re-exports the lifted helpers with byte-identical behavior; egress `dns-pin.ts` deliberately NOT converged (0.3.x candidate). (4) **shared bounded OAuth device/token polling** (`oauth-consolidation`, core `src/oauth-device-code.ts`) — `pollDeviceCodeToken` serves both `@arnilo/prism-provider-openai` and `@arnilo/prism-credentials-node` device flows (RFC 8628 poll, `slow_down` +5 s, expiry deadline, cancellation, bounded reads, fail-closed token shape, `[REDACTED]` redaction); adapter fields stay plain options; behavior equivalent. (5) **edge fixes** (`edge-fixes`) — Azure/Vertex resolve rotating credentials **once per request** (inner provider re-created with the resolved token; never consumed twice); Bedrock SigV4 merges duplicate-case headers last-wins and sorts query params by encoded key then value (malformed duplicate-case signatures eliminated, single-case byte-identical); OpenAI upload cleanup retains file ids until their `DELETE` succeeds (no remote-file leak on failed cleanup); cache-telemetry `__overflow__` never carries cost (requests + token totals only). New regression surface: `scripts/phase21-security.test.mjs` (10 conformance tests over built public entrypoints covering all five items, wired into `security:threat-suites`) plus a packed plain-JS `security21.mjs` consumer in install-smoke; phase-21 freeze manifest `scripts/phase21-freeze-manifest.json` machine-checks each task's diff (preserved surface: egress dns-pin primitives, OAuth connector consumers, strictCompletion opt-in adapters, native streaming adapters). Release graph stays **50** publishable manifests (root + 49 workspace packages) at exact **0.2.1**; zero new runtime dependency names (core remains dependency-free). Store compatibility with 0.2.0: **compatible, no migration** (no persisted-shape change). Exit gate green (core + script gates incl. phase21-freeze done-phase, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.1, live OIDC JWKS protected evidence + live OPA fail-closed evidence, evidence in `scripts/phase21-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.1 publish handoff` — signed `v0.2.1` tag + npm OIDC).

## [0.2.0] - 2026-08-13

### Changed
- **Release 0.2.0 (plan 020)** is the first cut of the 0.2.x review-remediation line — fail-closed runtime and sandbox security, closing the three blockers from the 2026-08-12 comprehensive review. API surface **additive-only** vs 0.1.7 (plain compat gate at 0.2.0: 0 breaking deltas; no `--allow-break`), three documented security-motivated behavior tightenings in `docs/migration.md` `0.1.7 → 0.2.0`: (1) **durable-resume input validation** (`resume-validation`, core) — `assertValidAgentRunResume` runs once at the top of `prepareAgentRunResume` before any state claim/checkpoint write/tool execution, covering all four public resume entrypoints; unknown legacy decisions (`"sideways"`), malformed batches, oversized reasons/elicitation, and duplicate approval ids fail closed with stable `ERR_PRISM_DECISION_*` codes, version untouched, zero tool calls; the server parser stays defense in depth. (2) **work-tool environment isolation** (`work-tools-env`, `@arnilo/prism-work-tools`) — `createCliRunner` children no longer inherit ambient host env: fixed base allow-list (PATH/LANG/LC_ALL/TZ + Windows system keys), explicit validated `env`, forced HOME/telemetry controls, late-bound per-identity tokens, 64-name/64-KiB caps (`ERR_PRISM_WORK_ENV`), absolute `binary`/`configDir` required, linear output capture (single final `Buffer.concat`). (3) **explicit sandbox capabilities** (`sandbox-capabilities`, `@arnilo/prism-coding-security`) — `SandboxAdapter.capabilities` (`workspaceCoherent`/`filesystemIsolated`/`networkIsolated`/`processIsolated`/`privilegeIsolated`/`egressRestricted`); omission/malformed metadata resolves all isolation `false`; `SandboxCodingComposition.capabilities` resolved from real wiring + validated adapter metadata; `containmentClaim` retained as `@deprecated` conservative projection (`workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated`); Docker reports only verified controls, native reports filesystem/process/privilege `false`; authorization reads individual capabilities (docs/coding-security.md capability table + docs/host-security.md). New regression surface: `scripts/phase20-security.test.mjs` (public built entrypoints, all three blockers + gate accounting, wired into `security:threat-suites`), packed plain-JS consumer regressions in install-smoke, and the sandbox-browser workflow now records Docker/native capability evidence with a fail-loud 0.2.0 blocker gate (never a passing skip). Release graph stays **50** publishable manifests (root + 49 workspace packages) at exact **0.2.0**; zero new runtime dependency names (dependency fingerprint unchanged). Store compatibility with 0.1.7: **compatible, no migration** (no persisted-shape change). Exit gate green (core + script gates incl. phase20-freeze done-phase, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.0, Docker daemon + native netns protected evidence, evidence in `scripts/phase20-baseline.json`). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.2.0 publish handoff` — signed `v0.2.0` tag + npm OIDC).

## [0.1.7] - 2026-08-12

### Changed
- **Release 0.1.7 (plan 019)** is the performance-and-DX patch on the frozen 0.1.x line — additive-only vs 0.1.6 (freeze manifest `scripts/phase19-freeze-manifest.json`; every task's diff stayed inside its allowed files, enforced by the phase19 freeze machine; the async `AgUiProjection` item is a verification closeout, not new code). (1) **Prompt-cache telemetry surface** (`cache-telemetry`): dependency-free `createCacheTelemetry()` aggregator in core — host-activated (nothing subscribes by import), consumes `Usage` + `ModelConfig` pairs from the usage `ProviderEvent` or run-ledger records, and reports per-provider/model request counts, aggregate hit rate via the existing `cacheHitRate` math, cache-read/write token totals, and estimated savings via `cacheSavings` when cost metadata exists; bounded cardinality (default cap 256 distinct provider/model keys, overflow collapses into the `CACHE_TELEMETRY_OVERFLOW_KEY` `__overflow__` bucket with an `overflowed` flag, ponytail ceiling named — host-configurable caps or LRU eviction only if a real deployment exceeds it); reports carry token counters/rates only — never prompt content, cache keys, or identity; `record()` is O(1) with validated finite non-negative inputs; no OTel metric emission (demand-gated follow-up). (2) **Model-router selection policies** (`router-selection`): additive `selection` hook on `CreateModelRouterOptions` — `ModelRouterSelectionPolicy` (`name`/`rank`/`observe`); default ordered behavior byte-identical (regression test); reference `createCostLatencySelection` ranks candidates by `ModelCost` (input/output/cacheRead with per-million normalization) then in-memory EMA latency fed from `recordOutcome`'s new optional `latencyMs` (`latencyWeight` 0–1, default 0.5; pure-cost order on cold start); the policy is a permutation-only reorder of already-allowed candidates so it cannot widen allow-list/residency/budget decisions, and any drop/add/duplicate misbehavior fails closed with `ERR_PRISM_MODEL_ROUTER_POLICY`; policy name rides the still-redacted diagnostics; durable latency stats are a demand-gated follow-up requiring a `ModelRouterStateStore` contract change. (3) **Async AgUiProjection closeout** (`async-hooks`): plan 009 Task 15 surface verified with evidence — hooks are typed `Awaitable<T>` (17 hooks), `getMessages` accepts `() => readonly AgUiMessage[] | Promise<...>` so `messagesFromSession` can call async host APIs like `session.entries()`, snapshots are awaited strictly in event order (never `Promise.all`), rejection fails closed per event with sibling hooks still projected, caps apply to awaited values; evidence in `scripts/phase19-baseline.json` `asyncHooks` (`verified: true`, `gapFound: false`). (4) **`prism providers add <name>` scaffold** (`provider-scaffold`): new CLI subcommand (stdlib-only, mirrors `prism init`) scaffolds an OpenAI-compatible provider package into `./<name>` — `package.json` (peer dep `@arnilo/prism`, `sideEffects: false`, publish metadata), `tsconfig.json`, `README.md`, `CHANGELOG.md`, `src/index.ts` (`defineProviderPackage` + `api_key` auth-method registration), `src/provider.ts` (built on `createOpenAICompatibleProvider`), `src/models.ts` (starter `ModelConfig` list), `src/cache.ts` (cache-hint mapping via the shared core helpers), `src/__tests__/provider.test.ts` (offline conformance: stream shape + usage, header ownership, tool-call delta reconstruction, serialized-content coverage, secret-leak redaction), and `docs/providers/<name>.md` stub; flags `--base-url` (http(s) validated), `--env-key` (shell-safe identifier), `--model`, `--force`; npm package-name validation, path-traversal and symlink-escape refusal (nothing can land outside the destination), usage errors exit 2 with nothing written, generated code contains placeholders only — never secrets; scaffold output is host-chosen and never auto-registered into repo workspaces or resolvers; a fixture test proves the generated package typechecks and passes its conformance test offline against the repo build. Release graph stays **50** publishable manifests (root + 49 workspace packages — 14 provider adapters, 9 `prism-*` family/profile, 26 capability incl. `@arnilo/prism-document-reader`) at exact **0.1.7**. Exit gate green (core tests + script gates incl. phase19-freeze done-phase, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain compat gate at 0.1.7 with 0 breaking deltas then version-literal baseline refresh — no `--allow-break` anywhere, evidence in `scripts/phase19-baseline.json`). Store compatibility with 0.1.6: **compatible, no migration** (additive-only; no persisted-shape change; `docs/migration.md` gains no entries). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.1.7 publish handoff` — signed `v0.1.7` tag + npm OIDC). **CI hardening after the exit gate** (same day): the release `verify` job now runs the sdk:ready legs phase-by-phase (explicit rc per leg so a silent failure still names the failing phase) and uploads `sdk-ready.log` as an artifact on failure; the examples demo test compiles the demos in place with the repo tsc before spawning them, so the spawned children are plain JS instead of loading the amaro type-stripping WASM module (whose large per-process virtual reservation fails with `WebAssembly.Instance(): Out of memory` on memory-constrained CI runners); emitted .js files are removed in a finally block.

## [0.1.6] - 2026-08-11

### Changed
- **Release 0.1.6 (plan 018)** is the coding-agent capability-closeouts patch on the frozen 0.1.x line — five demand-gated closeouts, all shipped, additive-only vs 0.1.5 (freeze manifest `scripts/phase18-freeze-manifest.json`; every closeout flipped to `demanded` by named demand evidence before its task landed, then the demand-gate registry validated demanded ⇒ implemented, deferred ⇒ untouched). (1) **Durable ACP session store** (`acp-session-store`): `@arnilo/prism-ag-ui` gains the host-owned `AcpSessionStore` seam on `CreatePrismAcpAgentOptions` — `save` (upsert on session/new, set_mode, set_config_option, never on cancel/prompt-end), `loadAll` (lazy, once per agent instance, after authorization, cross-tenant entries refused `ERR_PRISM_ACP_INPUT`), `evict` (on close/delete); the persisted entry shape `{sessionId, ownership, modeId, configValues, cwd, additionalDirectories, updatedAt}` deliberately excludes client/controller/budget/pending state; fail-closed restore drops corrupt/oversized entries, re-validates modes/config options, keeps the in-memory registry caps (32 default / 128 hard), and re-resolves the live session binding; absent seam = byte-identical 0.1.5 in-memory behavior; the whole persisted entry rides the optional `SecretRedactor` at the save boundary. (2) **Network-free native sandbox backend** (`native-sandbox`): `@arnilo/prism-coding-security` gains `createNativeSandbox` — spawn + POSIX rlimits + existing path containment, zero new dependencies; every command runs in a fresh network namespace via the OS `unshare` binary (plain or `--map-root-user` preflighted once at creation, fail-closed on macOS/Windows and where netns cannot be created), ulimit chains (`-v`/`-t`/`-n`) with `|| exit 126`, argv-only `exec` (never shell-interpolated), cwd containment via `assertPathInsideRoots`, process-group kill on timeout/abort, env allow-list (host env never inherited), output cap, `close({export})` tar parity, and a documented honest boundary (runs as the invoking OS user; egress denial + rlimits + cwd containment only). (3) **Bounded PDF/Office document reader** (`doc-reader`): new optional package `@arnilo/prism-document-reader` (the 50th publishable manifest) — `createDocumentReader({ maxBytes, maxPages, maxTextBytes, parsers })` behind optional peer parsers `pdf-parse`/`mammoth` (dynamic-import, fail-closed at creation with an install hint when absent), magic-byte format gating (never extension sniffing), null fall-through to the 0.1.5 text path, refuse-over-truncate for over-page PDFs, byte-safe text truncation, optional `SecretRedactor` at the adapter boundary, no embedded-content execution, no external resource fetch (egress tripwire test), extraction envelope recorded in `scripts/budgets.json`; `createReadTool` gains the additive `documentReader` slot with input/page/text caps re-checked in the read flow. (4) **Recursive delete + brace-expanding glob** (`delete-glob`): `delete` gains the per-call opt-in `recursive: true` (symlink children unlinked never followed, iterative post-order walk, per-call fan-out cap 10,000 default / 100,000 hard, partial deletion reported never silent, `maxEntries` bound); `glob` gains host-selected + per-call `braceExpansion` (`{a,b}` textual expansion, max 128 alternatives / 4096 expanded bytes, unbalanced/nested/empty braces and overflow fail closed, default matcher semantics unchanged). (5) **Checkpoint persistence for loaded-skill bodies** (`checkpoint-bodies`): durable runs may set `includeSkillBodies: true` on BOTH run and resume options (alongside `persistSessionState`) — the exact loaded-skill instructions ride the checkpoint (`{name, instructions}` pairs, ≤64 bodies / ≤256-char names / ≤262144-byte bodies / ≤1 MiB total, validated fail-closed on save and load, redacted at rest) so resume re-renders them registry-independently with no `load_skill` round-trip; names-only stays the default and 0.1.3/0.1.2 checkpoint shapes are byte-identical; `maxStateBytes` refuses oversize bodies with a recorded error, never truncates. Release graph **50** publishable manifests (root + 49 workspace packages — 14 provider adapters, 9 `prism-*` family/profile, 26 capability incl. `@arnilo/prism-document-reader`) at exact **0.1.6**. Exit gate green (core 1,433/1,433 + 190 script gates incl. phase18-freeze done-phase, `sdk:ready`, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain compat gate at 0.1.6 with 0 breaking deltas then version-literal baseline refresh, evidence in `scripts/phase18-baseline.json`). Store compatibility with 0.1.5: **compatible, no migration** (additive-only; no persisted-shape change). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.1.6 publish handoff` — signed `v0.1.6` tag + npm OIDC).

## [0.1.5] - 2026-08-11

### Changed
- **Release 0.1.5 (plan 017)** is the **documented breaking cut** on the frozen 0.1.x line — deprecated-option removal with the full removed-symbols list, replacements, before/after examples, dynamic-config refusal behavior, store compatibility, and rollback in the top `docs/migration.md` `0.1.4 → 0.1.5` section (three stale roadmap labels corrected there: `RunOptions.maxToolRounds` not `AgentConfig.maxToolRounds`, `autoResizeImages` removed with `transformImage` retained, `INIT_PROVIDERS` removed with `listInitProviders()` retained). (1) **Provider run-option aliases** (Task 1): `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` (inert in first-party providers; host-side abort/retry is the replacement — `RunOptions.signal`, `AgentConfig.retry`/`RunOptions.retry`) and `RunOptions.maxToolRounds` (→ `limits.maxToolRounds`, defaults/caps unchanged) removed; untyped legacy run input is refused at the `runInternal` choke point before the agent starts; CLI `--max-tool-rounds` maps to the nested limit. (2) **Observational-memory compatibility surface** (Task 2): the 10 pre-0.0.19 flat settings keys and top-level `workerProvider`/`workerModel` aliases removed — settings resolution is nested-only with `assertNoRemovedFlatKeys` failing closed (settings-provider JSON or untyped overrides throw naming the key + nested replacement before any worker/provider call, compaction, or session append); `fallbackWorker`/`assertWorkerModelCompatibility`/`conflict()` deleted; workers resolve only from `observation`/`reflection`/`dropper` configs plus `sessionModel` fallback. (3) **Read alias + CLI constant** (Task 3): `ReadToolOptions.autoResizeImages` removed (`transformImage` is the only resize path; untyped callers fail closed at `createReadTool` before filesystem access) and `INIT_PROVIDERS` removed (`listInitProviders()` is the single provider-list API). Compat baselines regenerated after the reviewed `--allow-break` break report (root `arnilo__prism.txt` drops the `INIT_PROVIDERS` line; interface-member removals are verified by the phase-17 direct declaration scanner, not baseline text). Exit gate green (core tests + script gates incl. phase17-freeze 20/20, `sdk:ready`, audit 0, pack dry-run 49/49 twice byte-identical, evidence in `scripts/phase17-baseline.json`). Store compatibility with 0.1.4: **compatible, no migration** (removed options were inert aliases; rollback = restore the 0.1.4 manifests/tag). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.1.5 publish handoff` — signed `v0.1.5` tag + npm OIDC).

## [0.1.4] - 2026-08-10

### Changed
- **Release 0.1.4 (plan 016)** is the internal god-module split, compat-preserving on the frozen 0.1.x line. (1) **Contracts split** (Task 1): `src/contracts.ts` (2,549 lines) split by concern into `src/contracts-core.ts`, `src/contracts-run-state.ts`, and `src/contracts-protocol.ts` behind a pure `export *` barrel — the 295-name public surface is unchanged (0 added/0 removed/0 changed vs the 0.1.3 baseline, 702 = 702 at the entry). (2) **Agents split** (Task 2): `src/agents.ts` (2,576 lines) split into `src/agent-session.ts` (`RuntimeAgentSession` + factories + shared helpers), `src/agent-run-lifecycle.ts` (resume lifecycle), `src/agent-approval.ts`, `src/agent-tool-dispatch.ts`, with `agent-run-state.ts`/`agent-loops.ts`/`compaction.ts` reused — `agents.ts` is now a barrel of the four public functions; 14 internal cross-module helper exports joined the union `.d.ts` surface but are not consumer-importable (documented deviation #1, `scripts/phase16-freeze-manifest.json`). (3) **Tree-shake verification** (Task 3): measured in `scripts/phase16-baseline.json` — `dist/agents.js` 111,049 → 982 B, `dist/contracts.js` 9,420 → 418 B, `dist/contracts.d.ts` 98,825 → 1,029 B, dist module count 64 → 70 (static-import reachability reported, not gated). (4) **`@arnilo/prism-browser` CDP capabilities** (Tasks 4-5): additive Chrome DevTools Protocol surface riding playwright-core's existing transport — `browser_evaluate` (bounded `Runtime.evaluate`, policy-gated), `browser_observe` (console/network rings, bodies never captured), `block_urls`/`unblock_urls`/`throttle`/`emulate` act actions, and raw `{ css }`/`{ xpath }` targets; capability-gated via `BrowserCdpOptions.mode` with `ERR_PRISM_BROWSER_CDP_UNAVAILABLE`; documented additive deltas vs the 0.1.3 prism-browser baseline (41 added / 0 removed / 18 changed — 15 statement-text artifacts + 3 optional-member/signature-widening, deviation #2), root `@arnilo/prism` zero deltas. Zero new dependencies across the milestone; exit gate green (npm test core 1,425/1,425 + 151 script gates, `sdk:ready`, audit 0, pack dry-run 49/49 twice byte-identical, tree-shake + benchmark evidence in `scripts/phase16-baseline.json`). Store compatibility with 0.1.3: **compatible, no migration** (rollback = restore the 0.1.3 manifests/tag). **Publication remains the operator handoff** (`docs/release-and-install.md` `0.1.4 publish handoff` — signed `v0.1.4` tag + npm OIDC).

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
- `@arnilo/prism-ag-ui/renderer` now exports the DOM-free A2UI core values (`A2UiSurfaceState`, `reduceA2UiOps`, `readA2UiBatch`, `resolvePointer`, `A2UI_VERSION`) — host FR, hosts can drive the surface state machine without mounting; `createA2UiRenderer` behavior and frozen A2UI caps unchanged.

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
