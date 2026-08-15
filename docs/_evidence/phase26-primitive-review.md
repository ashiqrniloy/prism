# Phase 26 (0.2.6) Primitive Review — Fully Featured Coding-Agent Readiness

Captured 2026-08-15 at the 0.2.5 release state (HEAD `496d021`, tag `v0.2.5`), before any 0.2.6 source edit. Scope gate for `plans/026-Release-0-2-6-Fully-Featured-Coding-Agent-Readiness.md`; machine-checked by `scripts/phase26-freeze.test.mjs` against `scripts/phase26-freeze-manifest.json` and `scripts/phase26-baseline.json`. Rule: every 0.2.6 capability must reuse an existing primitive before a new seam is approved; every new seam must have a concrete consumer in this milestone; everything optional stays off by default and fails closed when absent.

## 1. Primitive Inventory

### 1.1 Baseline and publish graph

- `@arnilo/prism` 0.2.5 exit evidence (scripts/phase25-baseline.json, green): `npm test` 3654 tests / 3654 pass / 33 named protected-live skips / 0 fail (45 segments); core coverage 91.39/84.78/91.60 lines/branches/functions (env-set run 91.43/84.80/91.60) against the 90.53/84.20/90.54 floor; `security:threat-suites` 50/50; `test:postgres` 91/91; pack dry-run twice byte-identical across 50 packages; release gate 0.2.5 / 50 packages / 0 errors / 0 breaking deltas; Node 20 packed imports 14/14; audit 0 at moderate; secret scan 1559 files 0 findings; `sdk:ready` exit 0.
- Publish graph: root + 49 workspace packages, no new runtime dependency, core dependency-free. 0.2.6 must hold 50 packages, additive compatibility, and the existing package ownership map.

### 1.2 Process sessions and PTY (Task 1 — reuse target)

- `createProcessSessions` (packages/coding-agent/src/process/): long-running process registry over native `spawn` in a detached process group (killed via `killProcessTree`) or an optional duck-typed sandbox backend (`startProcess`; absent → `ERR_PRISM_PROCESS_UNSUPPORTED` fail closed). Session states `starting|running|exited|killed|released|expired|unknown`; `cancelOwned`/`reconcile`/`markUnknown` never fabricate an exit code; SHA-256 command fingerprint metadata; `CodingProcessEvent` host sink; `ExecutionPolicy` checked before spawn and on mutate; cursor-paged output via `OutputAccumulator`; ownership + expiry rechecked on every access.
- Frozen caps (packages/coding-agent/src/limits.ts): sessions 8 default / 32 hard; input 64 KiB / 1 MiB; lifetime 4 h / 24 h; output chunk 50 KiB / 1 MiB; total output 64 MiB / 1 GiB; shell timeout 600 s / 3 600 s.
- PTY today: `ProcessStartRequest.pty: true` unconditionally throws `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before any process creation. Node 20 stdio `pipe` is not a pseudoterminal; `node:tty` only wraps existing TTY file descriptors (rows/columns/getWindowSize, `resize` event) and cannot allocate one. No bundled PTY engine exists or may be added.
- Gap: an explicit host PTY backend contract (capability + optional resize + terminal metadata) routed through the existing state machine, with the unsupported-host path unchanged.

### 1.3 Repository search (Task 2 — reuse target)

- `RepositoryOperations` (packages/coding-agent/src/repository/): bounded walk/list/glob/read with `createGitAwareRepositoryOperations` (ignore-aware enumeration via git `ls-files` with native fallback). `repo_search` is bounded literal match over enumerated files; `OutputAccumulator`-style paging; `glob` with brace expansion; read-before-write gating.
- Frozen caps (limits.ts): depth 32/128; entries 10 000/100 000; files 10 000/100 000; results 1 000/10 000; concurrency 8/32; search matches/context lines hard caps; text scan 64 MiB/1 GiB.
- Coding lifecycle `file_changed`/`worktree_changed` events already exist for index-update correlation.
- Gap: optional host-owned incremental index lifecycle (update/remove/search/status/dispose), explicit indexed-literal and semantic query modes, freshness/staleness policy, `untrusted_index` provenance labeling, and bounded resource semantics — all defaulting to literal search when absent.

### 1.4 Git, worktrees, checkpoints, leases (Task 3 — reuse target)

- `GitOperations` (packages/coding-agent/src/git.ts + git-tools.ts): fixed argv, safe git config, status/diff/branch/worktree/apply/commit/prHandoff; `apply` always `--check` first with checkpoint restore on failure; worktrees 4 default / 16 hard (limits.ts). `git worktree list --porcelain -z` is the stable enumeration contract.
- Core `CheckpointStore` (CAS load/save/fingerprint, body store) and `LeaseStore` (durable fencing) are dependency-free and Postgres/SQLite/memory-conformant (plan 022 conformance). `CodingCheckpointMetadata` v1 carries artifact refs (kind plan|workspace|patch|bundle|diff|other, uri + sha256 + bytes, URIs ≤ 2048 chars) and a forbidden-keys set (credentials, secrets, tokens, env, commandOutput, rawOutput, stdout, stderr, storageState, authorization).
- Gap: a durable coding workspace lifecycle that registers multiple host-approved repositories, manages linked worktrees, and correlates repository/worktree/task/session/run/artifact identity — built on CheckpointStore CAS + LeaseStore fencing, with main-worktree immutability and dirty/locked cleanup refusal.

### 1.5 Forge (Task 4 — reuse target, demand-gated)

- Generic `ForgeOperations` (packages/coding-agent/src/forge/types.ts) + reference `createGitHubForge` (forge/github.ts): issueContext, push via `BoundGitRunner` with `GIT_CONFIG_*` credential injection (never argv), createPullRequest/updatePullRequest/createReviewComment, checks, bounded `reconcileHandoff`; every mutation gated by `ExecutionPolicy` and recorded in `ToolEffectStore` so retries never duplicate PRs/comments; typed `ForgeError` codes (auth/API/stale/rate-limit/limit/ownership); frozen page/payload/comment/concurrency/timeout caps; no octokit.
- Gap: none until a named consumer demands GitLab or Bitbucket. Roadmap rule is "forge breadth on demand" — at most one adapter, only behind a recorded consumer.

### 1.6 ACP and session durability (Task 5 — reuse target)

- `AcpSessionStore` seam (packages/ag-ui/src/acp/session-store.ts): save/loadAll/evict of `PersistedAcpSession` {sessionId, ownership, modeId?, configValues, cwd, additionalDirectories, updatedAt}; byte caps (session id 128 B, cwd 4096 B, 16 dirs, modeId 128 B, 32 config keys at 128 B keys / 4096 B values); ownership key tenant|account|user. In-memory ACP registry cap 32 default / 128 hard.
- `AcpClientTerminals` maps ACP terminal/create|output|wait_for_exit|kill|release onto ProcessSession-flavored semantics (pull-based, no stdin, output capped by `process.outputChunkBytes`).
- Core `AgentRunLifecycle`: checkpoint CAS resume, decision validation (`assertValidAgentRunResume`), approval/deny four-outcome decisions, `ToolEffectStore` correlation, run-state contracts frozen in `contracts-run-state.ts`.
- Gap: bounded `activeRun` references in persisted ACP sessions; restart/replica recovery semantics (attach-if-attested else `unknown`); durable process metadata records; durable cancellation that never replays a pending/dispatched tool.

### 1.7 Lifecycle events (shared constraint)

- Shipped kinds: six `process_*` events plus `file_changed`, `worktree_changed`, `permission_denied`, `configuration_changed`. Deferred kinds (`check_started/finished`, `task_created/completed`, `compaction_started/finished`, `subagent_started/stopped`) must NOT be added until a consumer exists (scripts/phase10-freeze-manifest.json `lifecycle.deferredEvents`). 0.2.6 review/diagnostics mapping must reuse shipped kinds or record a consumer-backed amendment.

### 1.8 Language intelligence and diagnostics (Task 6 — reuse target)

- `createLanguageIntelligence` (packages/coding-agent/src/language/): in-package LSP 3.17 Content-Length JSON-RPC client; lazy per-server start; host allow-listed server commands; workspace symbols/definitions/references/diagnostics/hover/rename; rename gated by `assertExecutionAllowed` + `withFileMutationQueue` + `atomicWriteUtf8File`; restart budget `LSP_RESTARTS_PER_SERVER` = 3.
- Frozen caps: message 4 MiB/32 MiB; diagnostics/file 200/1 000; pending 32/128; results/query 500/5 000; timeout 30 s/120 s; servers 4/8; errors `ERR_PRISM_LSP_*`.
- LSP 3.17 semantics: publishDiagnostics replaces the full previous set (publish `[]` to clear); pull diagnostics (textDocument/diagnostic, workspace/diagnostic) are incremental via resultId with kind full|unchanged (never item deltas); workspace/diagnostic may be long-running with last-report-wins; didOpen/didChange/didClose must balance; document versions are monotonic per client.
- Gap: bounded `didChange` document synchronization after file edits (full-content change is protocol-valid; no diff engine needed), push/pull diagnostic refresh with version precedence, and normalized host-parsed check diagnostics with deterministic added/removed/unchanged deltas.

### 1.9 Artifacts and review (Task 6 — reuse target)

- Core `ArtifactBodyStore` contract + reference S3-compatible adapter; `@arnilo/prism-server` `createArtifactService`: durable co-work review — attach/revise/approve/reject/compare/lastValidated/deliveryLink, checkpoint-CAS concurrency, ownership-scoped not_found on cross-tenant, redacted records, approval state pending|approved|rejected.
- Coding checkpoint metadata artifact refs (section 1.4) correlate patch/plan/workspace/bundle artifacts to runs. `GitOperations.prHandoff` produces bounded patch/bundle artifacts with SHA-256 digests.
- Gap: a bounded patch-review manifest binding review decisions to exact repository/worktree/base/head + patch digest + artifact revision + diagnostics generation + check summaries, composed over ArtifactService — no second approval engine, no raw patch bodies persisted.

### 1.10 Browser, Docker, journey, evidence (Task 7 — reuse target)

- `@arnilo/prism-browser`: `createBrowserTools`/`createBrowserManager` — one non-persistent BrowserContext per run, `browser_close` closes only the run-owned context (never the host Browser), networkPolicy default `requireContainedProxy` with containedProxyAttestation, uploads/downloads quarantined with approval-gated release, host-supplied Playwright Browser.
- `@arnilo/prism-coding-security`: explicit `SandboxCapabilities` (workspaceCoherent/filesystemIsolated/networkIsolated/processIsolated/privilegeIsolated/egressRestricted, omission-false), disposable Docker/OCI sandbox reference, `createNativeSandbox` (fresh netns per command, ulimit caps), `DisposableSandbox.startProcess`/`SandboxProcessHandle`, allow-list egress with pinned-DNS proxy.
- Packed journey today (scripts/e2e-coding-journey.test.mjs + fixtures/e2e-coding-journey.mjs): packs 7 packages into a fresh consumer; covers ACP init/session new/load/resume, four-outcome approval, git-aware list/search, glob, read-before-write write, delete, move, sandboxed process session, forge handoff with idempotent PR create. Ceiling: phase12-freeze-manifest `capacity.e2eJourneyFixtureMsCeiling`.
- Release evidence (scripts/release-skip-manifest.mjs → scripts/release-evidence.json): every surface pass/skip/blocked/protected with reason + required env; 33 protected/live skips named; missing required evidence → blocked → release fails closed. Protected live canaries (provider/MCP/A2A/Brave) in live-canaries.yml; sandbox-browser.yml gates Docker/Playwright evidence.
- Gap: a protected real coding journey (Docker + browser + provider + forge + Postgres + PTY) covering edit, shell, approval, restart, recovery, review, cancellation, with idempotent cleanup and blocked-not-green accounting.

### 1.11 Precedents

- Freeze-gate pattern: phases 20–25 (scripts/phase20-25-freeze-manifest.json + baseline.json + freeze.test.mjs; byte-immutable-while-pending state machine; per-editor shared markers; threat→test mapping; protected policy; deviations log).
- Docs guards: docs.test.ts index/link/heading checks; `_evidence/` archived and tarball-excluded; roadmap/plan/changelog/version narrative tests; plan-025 Task 6 freeze test pattern.
- Process/state/capability evidence pattern: phases 12/20/22/23 conformance + security suites over built public entrypoints.

## 2. What Can Be Fixed + Approved Gaps + Rejected Approaches

Approved generic gaps (each with a concrete consumer in Tasks 1–7):

1. Host PTY backend contract + optional resize capability, routed through the existing ProcessSessions state machine (consumer: Task 1, protected leg Task 7).
2. Host index lifecycle/query contract with explicit modes, staleness, and trust labeling (consumer: Task 2 `repo_search`, benchmark).
3. Checkpoint/lease-backed coding workspace lifecycle over existing GitOperations (consumer: Task 3, recovery identity Task 5, review binding Task 6, journey Task 7).
4. At most one forge adapter (GitLab or Bitbucket) behind a recorded named consumer (consumer: Task 4; none today → deferral).
5. Bounded process/ACP recovery metadata + durable cancellation over CheckpointStore/LeaseStore/AgentRunLifecycle (consumer: Task 5, journey Task 7).
6. Bounded patch-review manifest helpers + LSP didChange/pull/delta + host check-diagnostic normalization (consumer: Task 6, journey Task 7).
7. Protected real coding journey + blocked-not-green release accounting (consumer: Task 7, exit gate Task 8).

Rejected approaches (with reason):

- Bundled `node-pty` or any PTY allocator dependency: native dependency/platform lifecycle becomes Prism's burden; Node stdio cannot allocate a PTY; host adapter keeps Prism dependency-free.
- Vector DB / embedding SDK / repository daemon / watcher service / semantic ranker in-tree: resource and trust expansion; hosts own index persistence and embedding.
- New persistence API or database schema: `CheckpointStore` CAS + `LeaseStore` fencing already provide durable, cross-store-conformant state; recovery records are versioned namespaces over them.
- Generic forge framework / adapter catalog: existing `ForgeOperations` is the contract; breadth is demand-gated, never speculative.
- Second agent runtime / job scheduler / control plane: existing runs/workflows/checkpoints/tools/artifacts compose the lifecycle.
- Auto-apply / auto-merge / auto-approve: review acceptance never mutates the workspace or forge.
- Serializing PTY fds, browser contexts, controllers, promises, raw terminal output, env, or credentials into durable state: unsafe and unsupported.
- Exact-process-survival claims: recovery is attach-if-attested, otherwise `unknown`; side effects stay at-least-once with idempotency and explicit reconciliation.
- Diagnostic diff-engine / ranged-LSP-edit synthesis: full-content `didChange` is protocol-valid and smaller; check parsers are host-supplied.
- Pretending the fake packed journey is protected evidence: the 0.2.6 journey requires real Docker/browser/provider/forge/Postgres legs and blocks release when infrastructure is absent.

## 3. Frozen Decisions (per task)

### D1 — PTY backend (Task 1)

- `createProcessSessions` gains an optional `ptyBackend` option; `ProcessStartRequest.pty: true` delegates only to it. Absent backend or unsupported host → `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before process creation (byte-compatible with 0.2.5). `pty` default stays false; non-PTY native/sandbox path untouched.
- PTY sessions support existing output paging/input/wait/signal/kill/release plus bounded `resize` when the backend exposes the capability; capability and metadata are explicit, never duck-typed.
- Terminal caps (frozen): columns 120 default / 500 hard; rows 40 default / 200 hard; TERM 64 B default / 256 B hard; resizes 60/min default / 600/min hard; attach timeout 30 s default / 120 s hard; backend metadata 4 KiB default / 16 KiB hard; input per write and total stay under existing process caps.
- Errors: existing `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`; new `ERR_PRISM_PROCESS_PTY_BACKEND` (backend throw/loss), `ERR_PRISM_PROCESS_PTY_LIMIT` (dimension/TERM/resize-rate/attach-timeout overflow).
- Terminal control sequences remain untrusted output; no terminal parser/emulator; secret redaction and `CodingProcessEvent` mapping match non-PTY sessions.

### D2 — Indexed search seam (Task 2)

- Host index contract: `update(changeBatch)`, `remove(refs)`, `search(query)`, `status()`, `dispose()`; states `empty|building|ready|stale|failed`; index never starts on import/construction — the host builds/updates it explicitly.
- `repo_search` stays bounded literal by default. Host-enabled modes: `indexed_literal`, `semantic`; mode selection is explicit per request and per host policy. Missing backend / unsupported mode / stale revision / failed index → stable repository error; no silent semantic-to-literal downgrade.
- Results carry source revision, indexed timestamp, score (bounded/validated), and `untrusted_index` provenance; rechecked for workspace containment; mutations still require fresh read/policy.
- Caps (frozen): update batch 1 000 files / 16 MiB default, 10 000 / 64 MiB hard; results 1 000 default / 10 000 hard (reuse repo results caps); snippet 4 KiB default / 16 KiB hard; stale max age 60 s default / 300 s hard; query timeout 30 s default / 120 s hard. Benchmark fixture: 100 000-file metadata; indexed query p95 ≤ 250 ms, 1 000-file batch update ≤ 1 s, peak heap +64 MiB (measured at Task 2; ceilings recorded in manifest).
- Errors: `ERR_PRISM_INDEX_*` (unsupported, stale, failed, limit, timeout, untrusted-scope).

### D3 — Coding workspace lifecycle (Task 3)

- `createCodingWorkspaceLifecycle({ checkpoints, leases, ownerId, ownership, repositories, worktreeRoots, policy })`: durable records in a versioned checkpoint namespace (not `CodingCheckpointMetadata` v1); states `active|cleaning|closed|unknown`; create/update/cleanup via CheckpointStore CAS + LeaseStore fencing; duplicate create idempotent; stale workers rejected.
- Record fields: stable repository id, canonical root, remote/default-branch fingerprint (no credential URL), worktree id/path/branch/base/head, owner, state, schema version, fencing token, timestamps, artifact refs. Main worktree immutable through the service.
- Cleanup refuses dirty/locked/unowned/missing/path-mismatched worktrees unless host policy explicitly authorizes the action; partial failure → `unknown`, reconcilable; `git worktree list --porcelain -z` enumeration.
- Caps (frozen): repositories/task 4 default / 16 hard; worktrees 4 default / 16 hard (reuse git caps); record 64 KiB default / 256 KiB hard; lease TTL 30 s default / 300 s hard; cleanup operations 100 default / 1 000 hard.
- Errors: `ERR_PRISM_WORKSPACE_*` (unknown, limit, ownership, fence, dirty, locked, main, path-escape, fingerprint).

### D4 — Forge breadth (Task 4)

- Demand registry in `scripts/phase26-freeze-manifest.json` (`demand.gitlab-forge`, `demand.bitbucket-forge`): status `deferred` unless a named host/consumer/date/use case is recorded; activation flips the entry and records the consumer before implementation. Both are `deferred` at Task 0 — no adapter source, no docs page, no exports.
- If activated: exactly one thin adapter over existing `ForgeOperations`; per-call credentials, `ToolEffectStore` idempotency, lookup-before-create, bounded pagination, rate-limit mapping, unknown-outcome reconciliation, `ExecutionPolicy` gating — matching GitHub adapter semantics; no SDK dependency.

### D5 — Recovery (Task 5)

- ProcessSessions persists bounded intent/metadata records (never handles/controllers/promises/raw output/env/credentials) via host CheckpointStore; ownership via LeaseStore fencing; transitions recorded with CAS: intent-before-spawn → dispatch → running → terminal; `recover()` bounded; `starting|running` records atomically become `unknown` when the backend cannot attest attach; two replicas can never both own/attach/mutate one process.
- ACP `PersistedAcpSession.activeRun` optional bounded reference (id/version/status, ≤ 512 B); on restart the registry re-resolves and queries `AgentRunLifecycle`: suspended runs preserve pending approval/effect ids and resume through existing CAS/decision validation; terminal runs report terminal; unprovable in-flight streams report unknown/unsupported (never re-prompt, never replay tools).
- Durable cancellation: ownership/version/fence checked, terminal, idempotent, never replays a pending/dispatched tool; post-recovery process cancellation reaches the attached backend or records unknown.
- Caps (frozen): recovery lease TTL 30 s default / 300 s hard; recovery records 32 default / 128 hard; attach timeout 30 s default / 120 s hard; record bytes within checkpoint hard limits.
- Errors: `ERR_PRISM_RECOVERY_*` (unknown, unsupported, ownership, fence, corrupt, limit, attach).

### D6 — Review and diagnostics (Task 6)

- `createCodingPatchReviewManifest` composes Git patch/bundle artifact refs + repository/worktree/base/head identity + SHA-256 digests + diffstat + check summaries + diagnostics generation; persisted through existing `ArtifactService` approval state (pending|approved|rejected) — no duplicate artifact storage.
- Review binding: decision applies only to exact artifact revision + patch digest + repository/worktree/base/head; any change → `superseded`; stale acceptance refused; rejection records bounded reviewer reason; acceptance never applies/commits/pushes/merges.
- `LanguageIntelligence` gains bounded `syncDocument` (didOpen + ordered didChange with monotonic versions; full-content change), push/pull diagnostic refresh per server capability, version precedence (stale-version diagnostics never overwrite newer), and normalized `diagnosticDelta` (deterministic added/removed/unchanged).
- Host-parsed check diagnostics normalize into the shared bounded shape (source, file/range, severity, message/code, generation/revision); no parser catalog.
- Caps (frozen): review revisions 8 default / 32 hard; manifest 64 KiB default / 256 KiB hard; diagnostics 500 default / 5 000 hard (reuse LSP); delta entries 2 000 default / 10 000 hard.
- Errors: `ERR_PRISM_REVIEW_*` (superseded, stale, ownership, digest, limit, diagnostics).

### D7 — Protected coding journey (Task 7)

- Packed-consumer protected journey using only published exports + real services: provider call, digest-pinned Docker sandbox, host Playwright browser, forge test repository, Postgres checkpoints/leases, host PTY adapter. Coverage: worktree allocation, provider-driven edit, read-before-write/policy approval, shell/check, incremental diagnostics, patch artifact, host restart/second replica, process/ACP recovery, accepted-or-rejected review, cancellation, push/PR/check reconciliation, browser inspection, cleanup.
- Every side effect carries a unique run suffix and idempotent cleanup; PR creation lookup-before-create; cleanup failure blocks publication and leaves identifiers in redacted operator evidence.
- Caps (frozen): journey wall 20 min default / 40 min hard; cleanup 5 min default / 15 min hard.
- Env-gated: `PRISM_CODING_JOURNEY=1` plus `PRISM_TEST_POSTGRES_URL`, `PRISM_TEST_DOCKER_BIN`, `PRISM_TEST_DOCKER_IMAGE`, `PRISM_LIVE_PLAYWRIGHT`, `PRISM_CODING_FORGE_REPOSITORY`, `PRISM_CODING_PROVIDER`, `PRISM_TEST_PTY_BACKEND`. Missing env/service/skipped substep → `blocked`, never pass/skip.

### D8 — Budget, docs, exit (Task 8)

- 50 packages; no new runtime dependency/subpath; additive-only compat (expected deltas: version literal 0.2.5 → 0.2.6 + additive exports; `removedOrChanged: 0`; no `--allow-break` without an amended, migration-backed decision).
- New docs pages: `docs/indexed-code-search.md`, `docs/coding-workspaces.md`, `docs/coding-review-and-diagnostics.md`; updates to process-sessions/coding-agent-tools/language-intelligence/work-artifacts-and-review/forge-integration/coding-security/browser-automation/acp/migration/release-and-install/index; each new public API gets a docs/index entry.
- Exit gate: full default + protected suites (Postgres conformance, PTY protected leg, indexed benchmark, demanded forge leg, real journey, live canaries), pack determinism, compat review, package truth, sdk:ready, audit/secret scan; `scripts/phase26-baseline.json.exitGate` green with `blocked: false`; signed `v0.2.6` + npm OIDC operator handoff.

## 4. Threat Model (T1–T8)

| id | threat | task | fail-closed behavior |
|----|--------|------|----------------------|
| T1 | Hostile terminal: escape/control sequences, oversized dimensions/TERM/input, resize flood, secret leakage into errors/events/metadata, backend loss or spoofing | Task 1 | PTY output stays untrusted data; caps enforced before backend calls; wrong owner/policy → no backend mutation; absent/unsupported backend → pre-spawn error; redaction on every surface |
| T2 | Malicious or stale index: cross-tenant/cross-root results, prompt-injection snippets, malformed scores/ids, silent semantic downgrade, unbounded query/update | Task 2 | Results validated/containment-checked and labeled `untrusted_index`; stale/failed/unsupported → stable error; no implicit fallback that changes query meaning; byte/result/timeout caps |
| T3 | Workspace lifecycle: cross-tenant repository/worktree path escape, symlink escape, main-worktree removal, dirty/locked force cleanup, identity/fingerprint collision, stale fence writes | Task 3 | Canonicalized roots; CAS + lease fencing; main worktree immutable; dirty/locked/unowned refuse unless host-authorized; partial → `unknown` reconcilable; credential URLs never stored |
| T4 | Forge: token leak into argv/logs/events/artifacts, duplicate mutation, wrong repository, rate-limit/stale-head races, redirect/SSRF, cross-tenant use | Task 4 | Per-call least-privilege credentials via env injection; `ToolEffectStore` idempotency; lookup-before-create; stale head refused; bounded transport; deferral when no demand |
| T5 | Recovery split-brain: duplicate attach/input/kill/cancel, stale fence, orphan process, fabricated exit, duplicate approval/effect, credential fields in records | Task 5 | Lease + fence single-winner; attach only when attested else atomic `unknown`; no PID probing; cancellation never replays tools; records redacted/versioned; cross-store conformance without timing sleeps |
| T6 | Patch review: TOCTOU between review and apply, stale acceptance after patch/identity change, diagnostic spoof/overflow, path escape, secret leakage | Task 6 | Decisions bind to digest + revision + repository/worktree/base/head; change → `superseded`; diagnostics versioned/bounded; raw patch/check bodies never persisted; projection allow-list gated |
| T7 | Journey: credential/artifact leak, failed cleanup (open PR/branch/worktree/container/context/unknown process), skipped-required-infra passes as green | Task 7 | Secrets late-bound and excluded from report/stdout/artifacts; cleanup idempotent and required; missing infra → `blocked` fails release; leak scan gates evidence |
| T8 | Implicit activation/resource abuse: any optional capability active by default, unbounded sessions/index/records/journey, import-time sweeper, package budget drift | Task 0–8 | All seams default unavailable/deny; caps frozen per task; freeze test locks pending files byte-identical; budget gate + protected accounting |

## 5. Owner / Migration / Budget / Protected Matrix

Owners (mirror plan 026):

- Release: `arn` (scope amendments, protected environment, compat review, signed `v0.2.6`, npm OIDC, rollback).
- Process/PTY: coding-agent maintainer (adapter contract, state machine, terminal bounds, conformance, unsupported refusal).
- Repository/index: coding-agent repository maintainer (index contract, bounds, stale semantics, trust labels, default parity, benchmark).
- Workspace lifecycle: coding-agent Git/checkpoint maintainer (identity, CAS/lease fencing, cleanup, artifact correlation, Git-version compatibility).
- Forge: coding-agent forge maintainer + named consumer (demand record, credentials, provider pin, idempotency, protected repo, cleanup).
- Recovery: core lifecycle + AG-UI ACP + coding-agent process maintainers (durable cancellation, active-run refs, process metadata, leases, attach/unknown, cross-replica conformance).
- Review/diagnostics: coding-agent language/Git maintainer + server artifact maintainer (digest binding, invalidation, LSP sync, normalization, bounded artifacts).
- Protected journey: release workflow maintainer (fixtures, secret isolation, evidence retention, cleanup, fail-loud blocking).

Migration impact (frozen):

- No PTY/index/recovery stores wired → byte-identical 0.2.5 behavior (`ERR_PRISM_PROCESS_PTY_UNSUPPORTED`, literal search, in-memory ACP/process). One-repository hosts need no workspace service.
- New APIs are additive exports from existing packages; no subpath; existing signatures unchanged.
- Durable records use separate versioned checkpoint namespaces (coding workspaces, process sessions, patch reviews); `CodingCheckpointMetadata` v1 untouched; unknown schema versions rejected; downgrade returns unsupported, never drops fields.
- ACP `activeRun` optional and bounded; 0.2.5 records stay readable; `docs/migration.md` records the 0.2.5 → 0.2.6 decision.
- Rollback: stop 0.2.6 workers, resolve/mark unknown active records, then restore 0.2.5 code; workspace/artifact records are host data, not deleted by downgrade.

Budget:

- 50 packages; runtime dependency names unchanged; core dependency-free; no node-pty/vector DB/embedding/Git SDK/forge SDK/watcher/test framework; protected host may supply a PTY module and Playwright/browser binary.
- All defaults/hard caps listed in D1–D7 plus existing limits; large-monorepo benchmark fixture frozen; journey wall/cleanup ceilings frozen; evidence bytes bounded (timings, states, ids/hashes only).

Protected surfaces (required, absent → blocked):

- test:postgres durable conformance (`PRISM_TEST_POSTGRES_URL`) — inherited.
- phase26 recovery/workspace cross-store conformance (`PRISM_TEST_POSTGRES_URL`).
- phase26 PTY protected leg (`PRISM_TEST_PTY_BACKEND`, real host PTY module).
- phase26 indexed benchmark leg (100k-file fixture).
- phase26 real coding journey (Docker + Playwright + provider + forge + Postgres).
- Demanded forge protected leg (disposable provider repository) — only if demand flips.
- Live canaries (OIDC/OPA, MCP, A2A, Brave) — inherited.

## 6. Test Mapping (threat → Task test)

| threat | primary tests |
|--------|---------------|
| T1 | `packages/coding-agent/src/__tests__/process-pty.test.ts` (fake backend conformance/adversarial), `scripts/phase26-pty-protected.test.mjs` (real adapter) |
| T2 | `packages/coding-agent/src/__tests__/indexed-search.test.ts`, `scripts/phase26-index-benchmark.test.mjs` |
| T3 | `packages/coding-agent/src/__tests__/workspace-lifecycle.test.ts`, `scripts/phase26-recovery-conformance.test.mjs` (Postgres multi-process) |
| T4 | deferral gate in `scripts/phase26-freeze.test.mjs`; if demanded, `packages/coding-agent/src/forge/{gitlab,bitbucket}.test.ts` + protected provider leg |
| T5 | `packages/coding-agent/src/process/__tests__/process-recovery.test.ts`, `packages/ag-ui/src/acp/__tests__/acp-recovery.test.ts`, `scripts/phase26-recovery-conformance.test.mjs` |
| T6 | `packages/coding-agent/src/__tests__/review.test.ts`, `packages/coding-agent/src/__tests__/language-diagnostics.test.ts` |
| T7 | `scripts/phase26-coding-journey.test.mjs` (happy path, required-env matrix, restart/replica, cancellation, leak scan, cleanup failure) |
| T8 | `scripts/phase26-freeze.test.mjs`, `scripts/budget-gate.test.mjs`, `scripts/release-skip-manifest.mjs` accounting |

## 7. Decisions Ratified

1. Freeze contracts, states, caps, demand, protected requirements, and baseline hashes before any Task 1–7 edit (this document + manifest + baseline + freeze test).
2. Reuse `CheckpointStore`/`LeaseStore`/`ToolEffectStore`/`AgentRunLifecycle`/`ArtifactService`/`LanguageIntelligence`/`ProcessSessions`/`GitOperations`/`RepositoryOperations`/browser/sandbox/journey harnesses; no new persistence API, runtime, package, or dependency.
3. Every capability defaults unavailable/deny; ownership/policy rechecked at use and recovery; sensitive values excluded/redacted; absent protected evidence blocks the release.
4. Forge stays deferred at Task 0; activation requires a named consumer recorded in the manifest.
5. Recovery never fabricates survival: attach-if-attested, else atomic `unknown`/`unsupported`; side effects at-least-once with idempotent reconciliation.
6. Review decisions bind to exact digest/revision/identity; later changes supersede; acceptance never auto-applies.
7. Deviations from any frozen item require a manifest `deviations` entry and plan amendment before implementation.
