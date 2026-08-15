# Release 0.2.6 — Fully Featured Coding-Agent Readiness

Roadmap phase: `roadmap.md` § **0.2.6 — Fully featured coding-agent readiness**.
Baseline: `@arnilo/prism` **0.2.5** (plan 025 complete; 50-package publish graph = root + 49 workspaces; 3,654 tests pass, 33 protected/live skips named, 0 failures; core coverage **91.39% lines / 84.78% branches / 91.60% functions**; `security:threat-suites` 50/50; `test:postgres` 91/91; Node 20 packed imports 14/14; audit and secret scan clean; `scripts/phase25-baseline.json.exitGate.green: true`).
Target: `@arnilo/prism` **0.2.6**, additive by default. Any necessary breaking contract delta requires a plan amendment, `docs/migration.md`, compatibility evidence, and fail-loud refusal by old/new readers.
Prerequisites: plans 020–025 complete, especially explicit sandbox capabilities (0.2.0), bounded outbound transports (0.2.1), concurrent state/lease semantics (0.2.2), protected-evidence accounting (0.2.3), package/docs truth (0.2.4), and maintainability/performance baseline (0.2.5).

Scope maps one-to-one to the seven roadmap bullets:

1. Host-selected PTY/interactive terminal backend over existing `ProcessSessions`.
2. Optional incremental indexed/semantic repository-search seam; bounded literal search remains default.
3. Ownership-scoped multi-repository/worktree lifecycle and cleanup.
4. GitLab or Bitbucket forge adapter only when a named consumer is recorded; otherwise explicit deferral.
5. Durable ACP/live-task and managed-process recovery across restart/replicas, with honest `unknown`/`unsupported` outcomes.
6. Bounded patch-review artifacts plus incremental LSP/check diagnostics and immutable accepted/rejected state.
7. Protected real coding journey using Docker, browser, provider, forge, approval, restart/recovery, review, and cancellation.

## Objectives

- Close the production coding-agent gaps without adding a second agent runtime, hosted service, control plane, default indexer, bundled PTY implementation, ambient credential path, or implicit process/network activation.
- Reuse existing primitives before adding seams: `ProcessSessions`, `OutputAccumulator`, `ExecutionPolicy`, `CheckpointStore`, `LeaseStore`, `ToolEffectStore`, `AgentRunLifecycle`, durable ACP registry, `RepositoryOperations`, `GitOperations`, coding checkpoints, `ArtifactService`, `LanguageIntelligence`, lifecycle events, Docker/browser containment, and protected release evidence.
- Keep non-interactive process execution and bounded literal repository search byte-compatible defaults. PTY, indexed/semantic search, durable recovery, additional repositories/worktrees, forge adapters, and live journeys activate only through explicit host configuration.
- Make recovery honest: a live stream or process that cannot be proved attachable becomes `unknown` or `unsupported`; no fabricated exit, replayed tool effect, duplicated approval, or duplicate forge mutation.
- Make review decisions bind to exact workspace/repository/worktree identity, patch digest, artifact revision, diagnostics generation, and check summaries so later changes invalidate stale approval.
- Preserve dependency-free core and the 50-package publish graph. Prefer existing packages and stdlib; no `node-pty`, search engine, ORM, Git SDK, forge SDK, or browser launcher becomes a runtime dependency.
- Produce direct adversarial regressions, package/performance budgets, public docs, migration/compat evidence, and protected end-to-end evidence for every shipped capability.

## Non-goals

- No default/bundled PTY engine. Node `child_process` exposes pipes/inherited TTYs but does not allocate a pseudoterminal; Prism defines a host adapter and fails closed when absent.
- No built-in vector database, embedding model, repository daemon, watcher service, or semantic ranking algorithm. Hosts supply an index backend; Prism owns contracts, bounds, freshness, trust labeling, and fallback/refusal semantics.
- No repository clone credential manager or remote source catalog. Hosts register repositories/checkouts; Prism manages owned worktree lifecycle and correlations after registration.
- No automatic worktree force-removal, branch deletion, auto-merge, review approval, patch application, or diagnostic fix.
- No GitLab/Bitbucket implementation without named demand in `scripts/phase26-freeze-manifest.json`; “forge breadth on demand” is not permission to build an adapter zoo.
- No serialized PTY file descriptor, browser context, process object, controller, pending promise, raw terminal output, environment, token, or credential in durable state.
- No exact-process-survival claim. Recovery is attach-if-attested, otherwise unknown; side effects remain at-least-once with idempotency and explicit reconciliation.
- No full 0.3.0 live-service matrix. This milestone adds the narrower protected coding journey required by 0.2.6; real IdP/OPA/MCP-AS/S3/NATS matrix expansion remains 0.3.0.
- No code-wiki task: `.agents/skills/project-wiki/` does not exist. Public docs still follow `.agents/skills/create-plan/references/prism-wiki.md`.

## Expected Outcome

- `createProcessSessions` accepts an optional host-selected PTY backend. `pty: true` supports interactive input, output paging, signals, bounded resize, wait/kill/release, policy/ownership checks, and existing lifetime/output caps when the backend is present; absent/unsupported hosts still return `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before spawn.
- Repository tools keep native/Git-aware bounded literal search as default. An explicitly wired index backend supports incremental updates and indexed-literal or semantic queries with bounded results, resource diagnostics, source revision, freshness/staleness, and `untrusted_index` labeling. Missing/stale backends fail closed according to host policy; no silent semantic-to-literal downgrade.
- One durable coding workspace record can correlate several registered repositories and linked worktrees to one ownership/task/run, using `CheckpointStore` CAS and `LeaseStore` fencing. Cleanup refuses dirty/locked/unowned worktrees unless host-authorized, records partial/unknown outcomes, and never removes the main worktree.
- Forge demand is machine-recorded. If demanded, exactly one GitLab or Bitbucket adapter implements the existing `ForgeOperations` surface with bounded transport, per-call credentials, approval, `ToolEffectStore`, pagination, rate-limit handling, and protected tests. If no demand exists, both remain deferred and 0.2.6 ships no adapter code.
- ACP persisted sessions carry only bounded active-run references, not streams/controllers. Restored sessions query `AgentRunLifecycle`; suspended runs resume through existing CAS/decision validation, active-unprovable runs report unknown, and durable cancellation transitions state without replaying tools. Managed-process metadata persists through host `CheckpointStore` + `LeaseStore`; an attested backend may reattach, otherwise recovery atomically marks unknown.
- Coding patch review composes existing Git patch/bundle artifacts, core artifact types, server `ArtifactService`, coding checkpoints, and LSP/check primitives. Review state binds to exact SHA-256/repository/worktree/base/head; patch mutation resets acceptance. LSP documents receive bounded `didChange`, diagnostics are refreshed incrementally, check diagnostics use a host parser, and snapshots carry deterministic added/removed/unchanged deltas.
- A protected packed-consumer journey performs a real provider-driven edit in a real Docker workspace, runs an approved shell/check, restarts the host, recovers durable state, reaches accepted/rejected review state, exercises cancellation, opens/reconciles a disposable forge PR, and inspects the result with a real host-supplied browser. Cleanup is idempotent; missing required infrastructure records `blocked`, never green/skip, in the release profile.
- 0.2.6 exits with 50 packages, no new core/runtime dependency, additive compatibility (or an explicitly amended migration), package budgets green, all default/protected gates accounted for, and operator-ready signed-tag/npm-OIDC handoff.

## Operational Ownership

- **Release owner:** Prism maintainer/operator `arn`; owns scope amendments, protected environment, compatibility review, signed `v0.2.6` tag, npm OIDC publication, and rollback.
- **Process/PTY owner:** `@arnilo/prism-coding-agent` maintainer; owns PTY adapter contract, ProcessSessions state machine, terminal bounds, backend conformance, and unsupported-host refusal.
- **Repository/index owner:** coding-agent repository maintainer; owns index contract, update/query bounds, stale semantics, trust labels, default literal parity, and large-monorepo benchmark.
- **Workspace lifecycle owner:** coding-agent Git/checkpoint maintainer; owns repository/worktree identity, CAS/lease fencing, cleanup, artifact correlation, and Git-version compatibility.
- **Forge owner:** coding-agent forge maintainer plus named consumer; owns demand record, least-privilege credentials, provider API pin, mutation idempotency, protected test repository, and cleanup.
- **Recovery owner:** core lifecycle + AG-UI ACP + coding-agent process maintainers; own durable run cancellation, ACP active-run references, process metadata, leases/fences, attach/unknown behavior, and cross-replica conformance.
- **Review/diagnostics owner:** coding-agent language/Git maintainer and server artifact maintainer; own patch digest binding, review invalidation, LSP synchronization, check diagnostic normalization, and bounded artifacts.
- **Protected journey owner:** release workflow maintainer; owns Docker/browser/provider/forge/Postgres/PTY test fixtures, secret isolation, evidence retention, cleanup, and fail-loud release blocking.

## Migration Impact

- **Defaults:** no PTY backend means `pty: true` still fails as in 0.2.5; no index backend means `repo_search` remains bounded literal; no recovery stores means ProcessSessions/ACP retain documented in-memory behavior; one-repository hosts need no workspace-lifecycle service.
- **Additive APIs:** new PTY/index/workspace/recovery/review types and factory options are additive exports from existing packages. No package subpath is planned. Existing `ProcessSession` consumers see only optional interactive methods/capabilities; existing method signatures remain valid.
- **Durable records:** new records use separate versioned checkpoint namespaces for coding workspaces, process sessions, and patch reviews. Existing `CodingCheckpointMetadata` schema v1 is not silently repurposed. Readers reject unknown schema versions; downgrade leaves namespaced records untouched and returns unsupported rather than dropping fields.
- **ACP:** `PersistedAcpSession.activeRun` is optional and bounded. 0.2.5 records remain readable. A 0.2.5 host reading a 0.2.6 record must not silently discard required recovery state; Task 5 chooses either an additive optional field safe to ignore or a separate recovery namespace and records the decision in `docs/migration.md`.
- **Lifecycle cancellation:** any additive `AgentRunLifecycle.cancel`/equivalent is ownership-, version-, and fence-checked. It does not change existing `status`/`resume` behavior.
- **Forge:** no migration when adapters remain deferred. A demanded adapter is additive and host-selected; GitHub behavior remains unchanged.
- **Rollback:** code rollback to 0.2.5 is safe only after stopping 0.2.6 workers and resolving/marking unknown active PTY/process/recovery records. Workspace/artifact records remain host data and are not deleted by downgrade.

## Package and Performance Budget

- Publish graph remains **50 packages**. Work lands in `@arnilo/prism-coding-agent`, `@arnilo/prism-ag-ui`, `@arnilo/prism-server`, and narrowly in core only if durable run cancellation requires it. No new package or export subpath.
- Runtime dependency names remain unchanged. Core stays dependency-free. No `node-pty`, vector DB, embedding SDK, Git SDK, Octokit/GitLab/Bitbucket SDK, file watcher, or test framework is added. A protected host may provide a PTY module and Playwright/browser binary; these are not Prism runtime dependencies.
- Root and affected package packed/unpacked/file-count changes remain within `scripts/budgets.json`. Any rebaseline needs measured evidence and a dated `$comment`; moving tests/scripts into tarballs is forbidden.
- PTY uses existing process defaults/hard caps (8/32 sessions, 64 KiB/1 MiB input, 4 h/24 h lifetime, 50 KiB/1 MiB output pages, 64 MiB/1 GiB total). Task 0 freezes terminal dimensions, TERM bytes, resize frequency, attach timeout, and backend metadata caps.
- Index queries retain repository pattern/result/scan/time bounds. Task 0 freezes update batch/file/metadata caps, stale-age policy, query timeout, and a large-monorepo benchmark; Prism memory remains O(result page + update batch), not O(repository), because backend storage is host-owned.
- Workspace lifecycle defaults/hard caps start from existing Git limits (4/16 worktrees per repository) and add bounded repositories/task, total worktrees, record bytes, cleanup operations, and lease TTL.
- Recovery records fit existing checkpoint hard limits; leases use durable database time. Recovery/cleanup is O(records owned by one task), capped and paged. No global scans or import-time sweeper.
- Review reuses existing patch (16/64 MiB), artifact (16/64 refs), diagnostics (500/5000 results), and check-summary caps. Task 0 freezes review revisions, diagnostics snapshots/delta entries, and manifest bytes.
- Protected coding journey wall time is capped (target ≤20 minutes, exact ceiling frozen in Task 0) and cleanup has its own bounded timeout. Credentials and raw outputs never enter retained artifacts.

## Tasks

- [x] Task 0 — Primitive review, capability freeze, demand registry, threat model, baseline, owners, migration, and budgets
  - Completed 2026-08-15: `docs/_evidence/phase26-primitive-review.md` (primitive inventory of ProcessSessions/OutputAccumulator/ExecutionPolicy/CheckpointStore/LeaseStore/ToolEffectStore/AgentRunLifecycle/AcpSessionStore/RepositoryOperations/GitOperations/coding checkpoints/ArtifactService/LanguageIntelligence/lifecycle events/browser/sandbox/journey harnesses; approved gaps D1–D8; threat model T1–T8 mapped to task tests; owner/migration/budget/protected matrix); `scripts/phase26-freeze-manifest.json` (9 items, per-task tokens, shared-file markers, demand registry — gitlab-forge and bitbucket-forge `deferred`, no adapter source — frozen state machines, caps, errors, compat policy additive-only, protected policy and env names); `scripts/phase26-baseline.json` (0.2.5 exit figures inherited from phase25-baseline.json + 50 seam SHA-256 hashes at HEAD `496d021`; `exitGate: null` until Task 8); `scripts/phase26-baseline.mjs` (regenerator); `scripts/phase26-freeze.test.mjs` wired into root `npm test` after the phase25 segment. No source edited; no deviation recorded.
  - Acceptance Criteria:
    - Functional: create `docs/_evidence/phase26-primitive-review.md` before runtime edits. Inventory existing primitives and current gaps: `ProcessSessions`/`ProcessSandboxBackend`/`SandboxProcessHandle`/`OutputAccumulator` (PTY currently unconditional unsupported); ACP client terminals and durable `AcpSessionStore`; `RepositoryOperations`, native/Git-aware walkers and literal-only `repo_search`; `GitOperations.worktree`, coding checkpoint metadata, artifact writers; generic `ForgeOperations` + GitHub adapter; core `CheckpointStore`, `LeaseStore`, `ToolEffectStore`, `AgentRunLifecycle`; server `ArtifactService`; `LanguageIntelligence` (didOpen + push diagnostics, no didChange/pull workflow); coding lifecycle events; Docker/browser/provider/forge packed journey and protected-evidence scripts.
    - Functional: document what existing primitives already cover and approve only generic reusable gaps: host PTY backend + optional resize capability; host index lifecycle/query contract; checkpoint/lease-backed coding workspace lifecycle; optional forge adapter behind named demand; process/ACP recovery metadata and durable cancellation; patch-review manifest helpers and diagnostics synchronization/delta helpers. Reject a bundled PTY, index engine, watcher daemon, vector store, second runtime, new persistence API when `CheckpointStore`/`LeaseStore` suffice, generic forge framework beyond existing `ForgeOperations`, and auto-merge/apply/fix behavior.
    - Functional: create `scripts/phase26-freeze-manifest.json` with one entry per roadmap bullet, allowed files, frozen public API/error/event/schema names, default/hard caps, demand status for `gitlab-forge` and `bitbucket-forge`, required protected environments, task evidence tokens, additive compatibility policy, and deviations. Initial forge status is `deferred` unless a named host/consumer/date/use case is recorded.
    - Functional: create `scripts/phase26-baseline.json` from the 0.2.5 exit evidence and declaration hashes for process, repository, Git/workspace, forge, ACP store, lifecycle, language, artifact, browser, and release-evidence seams. Add `scripts/phase26-freeze.test.mjs` to root `npm test`.
    - Functional: freeze exact state machines and failure semantics before implementation: PTY capability/resize/unsupported; index `empty|building|ready|stale|failed` and explicit query mode; workspace `active|cleaning|closed|unknown`; process recovery `starting|running|exited|killed|released|expired|unknown`; patch review `pending|accepted|rejected|superseded`; durable cancellation and stale/fence conflicts.
    - Functional: record threat model T1–T8 and map each threat to Tasks 1–7 tests: T1 hostile terminal/escape/input/output/secret leakage; T2 malicious or stale index and semantic prompt injection; T3 cross-tenant repository/worktree path escape, main-worktree deletion, dirty cleanup, identity collision; T4 forge token leak, duplicate mutation, wrong repository; T5 split-brain recovery, stale fence, orphan process, duplicate approval/effect, fabricated exit; T6 patch-review TOCTOU, stale acceptance, diagnostic spoof/overflow; T7 protected journey credential/artifact leak and failed cleanup; T8 implicit activation and unbounded resource use.
    - Performance: capture current package sizes, process/LSP/repository/forge p95s, coverage thresholds, test counts, and protected skips. Freeze measurable 0.2.6 ceilings and benchmark fixtures without weakening 0.2.5 floors.
    - Code Quality: every proposed seam has a concrete first consumer in this milestone; reuse core persistence and existing package barrels; no new runtime dependency/package/subpath; docs/API/test files are enumerated.
    - Security: every optional capability defaults unavailable/deny; ownership and policy are rechecked at use/recovery; durable transitions use CAS + leases/fencing; sensitive values are excluded/redacted; absent protected evidence is blocked.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.2.6, Product Boundaries, Priority/Dependency Rules, Versioning Policy, mandatory regression matrix.
      - `.agents/skills/create-plan/SKILL.md`; `.agents/skills/create-plan/references/prism-wiki.md`.
      - `plans/009`, `plans/010`, `plans/018`, `plans/020`, `plans/022`, `plans/023`, `plans/025` and their primitive-review/release-gate precedents.
      - `docs/{process-sessions,coding-agent-tools,coding-security,acp,language-intelligence,forge-integration,work-artifacts-and-review,browser-automation}.md`.
      - Node 20 `child_process` and `tty`: <https://nodejs.org/docs/latest-v20.x/api/child_process.html>, <https://nodejs.org/docs/latest-v20.x/api/tty.html> — pipes/detach/signals; no PTY allocator; TTY rows/columns/resize apply to existing TTY fds.
      - Git worktree: <https://git-scm.com/docs/git-worktree> — stable `list --porcelain -z`, add/remove/lock/prune/repair rules.
      - LSP 3.17: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/> — didOpen/didChange ordering, publish diagnostics replacement, pull diagnostics result IDs.
      - GitHub Pulls/Reviews/Checks: <https://docs.github.com/en/rest/pulls/pulls>, <https://docs.github.com/en/rest/pulls/reviews>, <https://docs.github.com/en/rest/checks/runs>.
      - Conditional forge references: <https://docs.gitlab.com/api/merge_requests/>, <https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/>.
      - Playwright Browser lifecycle: <https://playwright.dev/docs/api/class-browser>; npm pack: <https://docs.npmjs.com/cli/v11/commands/npm-pack>.
    - Options Considered:
      - One new “coding runtime” coordinating all features: rejected; existing runs/workflows/checkpoints/leases/tools/artifacts compose the lifecycle.
      - One primitive-review/freeze gate before seven capabilities: chosen; interfaces and cross-task identity must agree before implementation.
      - Separate package per capability: rejected; existing package ownership is clear and graph/budget cost is unjustified.
      - Implement GitLab and Bitbucket speculatively: rejected; demand registry chooses at most one or neither.
    - Chosen Approach:
      - Freeze additive contracts, states, limits, threat→test mapping, protected requirements, and demand decisions in machine-readable evidence before code. Later tasks may amend only with a recorded deviation and updated plan.
    - API Notes and Examples:
      ```bash
      node --test scripts/phase26-freeze.test.mjs
      node scripts/package-truth.mjs --out scripts/package-truth.json
      npm run release:evidence
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase26-primitive-review.md`: inventory, decisions, limits, threat model, ownership/migration/budget/protected matrix.
      - `scripts/phase26-freeze-manifest.json`: scope/API/demand/evidence gate.
      - `scripts/phase26-baseline.json`: 0.2.5 baseline and declaration hashes.
      - `scripts/phase26-freeze.test.mjs`: machine checks.
      - `package.json`: append phase-26 freeze test to `npm test`.
      - `plans/026-Release-0-2-6-Fully-Featured-Coding-Agent-Readiness.md`: update if frozen decisions change approach/files/tests.
  - Test Cases to Write:
    - primitive inventory completeness: every named existing seam and roadmap gap appears.
    - demand gate: a demanded forge without named evidence fails; deferred forge source diff fails.
    - threat traceability: T1–T8 each map to a named runnable test.
    - additive/default gate: bundled PTY/index/daemon/new package/runtime dependency is rejected.
    - protected profile schema: Docker/browser/provider/forge/Postgres/PTY requirements list env names only, never values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence/freeze task only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase26-primitive-review.md`: tarball-excluded evidence.
    - `docs/index.md` update: no.
    - Documentation structure reference: evidence only; public API docs land in Tasks 1–8.

- [x] Task 1 — Host-selected PTY and interactive ProcessSession backend
  - Completed 2026-08-15: optional `ptyBackend` on `createProcessSessions`; `pty: true` delegates only to it (absent/`startProcess`-less backend fails closed `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before spawn; non-PTY path byte-compatible). New `ProcessPtyBackend/ProcessPtyHandle/ProcessPtyStartRequest/ProcessTerminalRequest/ProcessTerminalResize` with explicit `capabilities.resize`, bounded geometry (columns 1–120 hard 500, rows 1–40 hard 200, TERM ≤ 64B hard 256), attach timeout 30 s/120 s, resize rate limit 60/min hard 600, backend metadata 4 KiB/16 KiB; new errors `ERR_PRISM_PROCESS_PTY_BACKEND` (generic message, never embeds backend error text) and `ERR_PRISM_PROCESS_PTY_LIMIT`; NUL rejected as policy error; terminal data stays untrusted output with no parser/emulator; kill/release/cancel/dispose parity with sandbox semantics; trailing host data after terminal state is ignored (finished accumulator guard). Docs updated (`docs/process-sessions.md` backend contract, `docs/coding-agent-tools.md`, `docs/index.md`, README/CHANGELOG). Evidence: `packages/coding-agent/src/__tests__/process-pty.test.ts` 17 fake-backend conformance/adversarial tests + existing process-sessions suite green; `scripts/phase26-pty-protected.test.mjs` 4/4 against a real PTY (util-linux `script` and python3 `pty.fork`+TIOCSWINSZ adapters) proving TTY detection, interactive I/O, strict `stty` resize, cleanup, non-PTY parity; blocked-gate without `PRISM_TEST_PTY_BACKEND`. No deviation recorded.
  - Acceptance Criteria:
    - Functional: add an optional host PTY backend to `createProcessSessions`; `ProcessStartRequest.pty: true` delegates only to that backend, while missing capability returns `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before process creation. Non-PTY native/sandbox behavior remains unchanged.
    - Functional: PTY sessions support existing output/input/wait/signal/kill/release plus bounded terminal size initialization and resize. Backend capability and metadata are explicit; no duck-typed assumption that pipes or `node:tty` allocate a PTY.
    - Functional: policy, cwd containment, owner checks, cancellation, expiry, output accumulator, command fingerprint, events, and secret redaction match non-PTY sessions. Terminal control sequences remain untrusted output; no terminal parser/emulator is introduced.
    - Performance: existing process limits apply; dimensions/TERM/resize rate and backend startup/close time satisfy Task 0 caps. Backpressure/overflow terminates or marks unknown per frozen semantics; no unbounded PTY buffer.
    - Code Quality: one small generic host adapter contract with fake conformance and a protected real-adapter leg; no `node-pty` runtime dependency, platform branching, shell emulation, or duplicate ProcessSession registry.
    - Security: executable/argv are host-policy checked; env follows the freeze’s minimal/allow-list decision; wrong owner, resize abuse, NUL/control input policy, backend loss, abort, and unsupported host fail closed. No credential in argv/events/metadata/output errors.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/process/{types,sessions}.ts`, `output-accumulator.ts`, `shell.ts`, `limits.ts`; `docs/process-sessions.md`.
      - `packages/coding-security/src/sandbox.ts` optional long-running handle; `packages/ag-ui/src/acp/terminal-client.ts`.
      - Node 20 child process/TTY docs above: stdio pipes are not PTYs; `node:tty` wraps existing TTY descriptors and reports rows/columns/resize.
    - Options Considered:
      - Add `node-pty`: rejected; native dependency/platform lifecycle becomes Prism’s burden.
      - Treat `stdio: inherit` as PTY: rejected; no attachable isolation/cursor output and no PTY allocation.
      - Host adapter returning a ProcessSession-compatible handle with optional resize: chosen.
    - Chosen Approach:
      - Add an explicit `ptyBackend` option and PTY handle capability; route it through the existing record/accumulator/policy/event state machine. Keep `pty` false/default path untouched.
    - API Notes and Examples:
      ```ts
      const sessions = createProcessSessions({ cwd, policy, ptyBackend: hostPty });
      const terminal = await sessions.start({
        command: "/usr/bin/bash",
        args: ["--noprofile", "--norc"],
        pty: true,
        terminal: { columns: 120, rows: 40, term: "xterm-256color" },
      });
      await terminal.input("npm test\n");
      await terminal.resize?.({ columns: 160, rows: 48 });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/process/types.ts`: PTY backend/handle, terminal options, optional resize capability, error semantics.
      - `packages/coding-agent/src/process/sessions.ts`: backend selection through existing state machine.
      - `packages/coding-agent/src/process/index.ts`, `packages/coding-agent/src/index.ts`: additive exports.
      - `packages/coding-agent/src/limits.ts`: frozen terminal caps.
      - `packages/coding-agent/src/__tests__/process-pty.test.ts`: fake-backend conformance/adversarial tests.
      - `scripts/phase26-pty-protected.test.mjs`: protected host adapter module test (tentative exact filename frozen in Task 0).
      - `docs/process-sessions.md`, `docs/coding-agent-tools.md`, `docs/index.md`, package README/CHANGELOG.
  - Test Cases to Write:
    - unsupported parity: `pty: true` without backend rejects before spawn; `pty: false` matches 0.2.5.
    - interactive lifecycle: prompt/output/input/resize/signal/wait/kill/release ordering and cursor paging.
    - ownership/policy: denied command/input/resize and wrong-owner access perform no backend mutation.
    - resource failure: oversized dimensions/TERM/input/output, resize flood, timeout, abort, and backend loss fail closed.
    - redaction: secret/control payloads do not enter errors/events/metadata.
    - protected real adapter: host-supplied module allocates a real PTY and proves TTY detection + resize + cleanup; absent required module is blocked in protected profile.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new optional PTY backend and interactive session capability.
    - Docs pages to create/edit:
      - `docs/process-sessions.md`: PTY inputs, outputs, backend contract, unsupported behavior, limits, security, recovery caveats.
      - `docs/coding-agent-tools.md`: interactive-process capability and default non-PTY behavior.
    - `docs/index.md` update: yes — Process sessions entry notes host-selected PTY.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Scalable incremental indexed and semantic repository-search seam
  - Completed 2026-08-15: `createIndexedRepositoryOperations` composes a host-owned `RepositoryIndexBackend` (`update/remove/search/status/dispose`, explicit `capabilities.semantic`, never duck-typed) with the literal fallback; `repo_search` gains explicit `indexed_literal`/`semantic` modes behind `createRepoSearchTool({ modes })` (default schema literal-only). Stale/failed/unsupported indexes fail closed with `ERR_PRISM_INDEX_*` — no silent fallback that changes query meaning; frozen state machine empty|building|ready|stale|failed; results containment-checked under root and path scope, scores validated finite [0,1], duplicates deduped, snippets capped 4096/16384 B, results capped 1000/10000, labeled `untrusted_index` with `indexed` provenance (mode/state/revision/updatedAt) and per-match scores in tool content; backend throws map to generic `ERR_PRISM_INDEX_FAILED` without backend text; timeout/abort → `ERR_PRISM_INDEX_TIMEOUT`; update caps 1000/10000 changes and 16/64 MiB per batch, rename→remove(old)+add(new), delete→remove; identity/revision bounds. Evidence: `packages/coding-agent/src/__tests__/indexed-search.test.ts` 11 conformance/adversarial tests (threat T2); `scripts/phase26-index-benchmark.test.mjs` wired into root `npm test` — 100000-file fixture, query p95 ≤ 250 ms, 1000-file update ≤ 1 s, heap +64 MiB, semantic bounded, literal baseline unchanged. Docs: new `docs/indexed-code-search.md`, `docs/coding-agent-tools.md` mode table, `docs/index.md` entry, README/CHANGELOG. No deviation recorded.
  - Acceptance Criteria:
    - Functional: define a host-owned incremental index contract with bounded `update/remove/search/status/dispose` (exact names frozen in Task 0), source revision, indexed timestamp, resource diagnostics, and explicit states. No index starts on import/construction; host explicitly builds/updates it.
    - Functional: `repo_search` remains literal/native by default. Host-enabled indexed-literal and semantic modes require the backend and expose bounded path/snippet/score/provenance/freshness metadata. Missing semantic backend, unsupported mode, stale revision, or failed index returns a stable repository error; no silent fallback that changes query meaning.
    - Functional: updates correlate with `file_changed`, worktree, repository, and revision identity; rename/delete invalidate old entries. Results are rechecked for workspace containment and marked `untrusted_index`; mutation still requires fresh read/policy.
    - Performance: Prism memory is O(update batch + result page); backend calls honor abort/deadline/result/byte caps. Large-monorepo fixture demonstrates bounded query p95 and incremental update cost; literal search baseline does not regress.
    - Code Quality: contract is engine/model independent; no embedding SDK, vector DB, watcher, parser, daemon, or cache framework. Existing `RepositoryOperations`/tool result shape is reused or additively extended.
    - Security: index output is untrusted, redacted, ownership/repository/worktree scoped, path-contained, and stale-aware. Cross-tenant results, out-of-root paths, NaN/out-of-range scores, oversized snippets, prompt-injection text, and backend throws fail closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/repository/{types,operations,search,walk}.ts`, `git-aware-repository.ts`, `search.ts`, `limits.ts`; `docs/coding-agent-tools.md`.
      - Existing Git `ls-files` enumeration and coding lifecycle `file_changed`/`worktree_changed` events.
      - Product boundary: literal-only default/no regex containment; semantic behavior host-supplied.
    - Options Considered:
      - Bundle ripgrep/vector DB/embedding provider: rejected; dependency/resource/trust expansion.
      - Replace literal search globally with index: rejected; stale index changes correctness and default behavior.
      - Optional backend plus explicit indexed/semantic modes and freshness policy: chosen.
    - Chosen Approach:
      - Add one generic index seam and a thin repository/tool adapter. Hosts own persistence/build/watch/embedding; Prism validates requests/results, scopes identity, and reports freshness.
    - API Notes and Examples:
      ```ts
      const operations = createIndexedRepositoryOperations(cwd, {
        index: hostIndex,
        fallback: createGitAwareRepositoryOperations(cwd),
        allowedModes: ["literal", "indexed_literal", "semantic"],
        stale: { maxAgeMs: 60_000, requireSourceRevision: true },
      });
      await operations.index?.update({ repositoryId, worktreeId, sourceRevision, changes });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/repository/indexed-search.ts`: contract/validation/composition (tentative name).
      - `packages/coding-agent/src/repository/{types,operations,search}.ts`, `repository.ts`: additive mode/result plumbing.
      - `packages/coding-agent/src/search.ts`, `index.ts`, `limits.ts`: tool schema/options/exports/caps.
      - `packages/coding-agent/src/__tests__/indexed-search.test.ts`: conformance/adversarial tests.
      - `scripts/phase26-index-benchmark.test.mjs`: large-monorepo bounded benchmark.
      - New `docs/indexed-code-search.md`; update coding-agent docs/index/package docs.
  - Test Cases to Write:
    - default parity: no backend means identical literal results/schema/limits.
    - update lifecycle: add/edit/delete/move/worktree revision produces expected index calls and invalidation.
    - stale semantics: age/revision mismatch returns stale error or explicit host-selected refusal; no semantic fallback.
    - hostile backend: cross-root/cross-owner paths, malformed scores, oversized snippets/results, duplicate ids, throw/timeout/abort rejected.
    - trust: results carry index provenance/freshness and `untrusted_index`; read-before-write still requires actual file read.
    - scale: 100k+ file metadata fixture updates/query stay within frozen p95/memory/result caps; literal benchmark unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional search backend, modes, result metadata, limits, and errors.
    - Docs pages to create/edit:
      - `docs/indexed-code-search.md`: full API page, activation, update lifecycle, stale/trust/resource semantics, examples.
      - `docs/coding-agent-tools.md`: `repo_search` mode/default/error additions.
    - `docs/index.md` update: yes — add Indexed code search under Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Ownership-scoped multi-repository and worktree lifecycle
  - Completed 2026-08-15: `createCodingWorkspaceLifecycle` over `CheckpointStore` CAS + `LeaseStore` fencing — durable `CodingWorkspaceRecord` (schemaVersion 1, namespace `prism.coding-agent.workspace.v1`) with stable workspace/task/owner ids, per-repository canonical roots, credential-free remote fingerprints (redacted remote URL + default branch sha256, never a URL), base/head shas, worktree id/path, frozen states active|cleaning|closed|unknown, artifact refs only, fencing token, timestamps. `create` is idempotent for identical active records (crash-leftover worktrees reused), duplicate/conflicting/stale workers fail `ERR_PRISM_WORKSPACE_FENCE`; `verify` revalidates root/worktree containment, head, and fingerprint before any reuse; `cleanup` refuses dirty/locked/unowned/missing/mismatched trees and always the main worktree unless host policy allows the documented action, persisting partial failure as unknown and reconcilable; `remove` deletes the record only. `GitOperations.worktree` gained lock/unlock plus porcelain `locked`/`lockReason`; new `fingerprint()` and `redactRemoteUrl`; caps 4/16 repositories and worktrees, 64 KiB/256 KiB records, 30 s/300 s lease TTL, 100/1000 cleanup operations (`MAX_WORKSPACE_*`). Evidence: `workspace-lifecycle.test.ts` 14 tests (threat T3: path escape, cleanup refusal matrix incl. main, held-lease/stale-fence/ownership, fingerprint mismatches) green; full coding-agent suite 348/348; biome lint 0. Docs: new `docs/coding-workspaces.md`, `docs/coding-agent-tools.md` git_worktree row, `docs/index.md` Coding workspaces entry, README/CHANGELOG. Deviation D-T3-1 recorded: T3 stale-fence mapping moved off the task5-owned conformance file (see manifest deviations).
  - Acceptance Criteria:
    - Functional: add a checkpoint/lease-backed coding workspace lifecycle that registers multiple host-approved repositories, creates/lists/locks/removes linked worktrees through existing bounded Git runners, and correlates repository/worktree/task/session/run/artifact identities.
    - Functional: records include stable repository id, canonical root, remote/default-branch fingerprint (no credential URL), worktree id/path/branch/base/head, owner, state, checkpoint version, fencing token, created/updated/cleanup timestamps, and artifact refs only. Main worktree is immutable through this service.
    - Functional: create/update/cleanup use `CheckpointStore` CAS and `LeaseStore` fencing. Duplicate create is idempotent; stale workers reject. Cleanup refuses dirty, locked, unowned, missing, or path-mismatched trees unless explicit host policy allows the documented action; partial failure records `unknown` and remains reconcilable.
    - Functional: checkpoint resume verifies repository/worktree identity and fingerprints before tools, processes, index results, patches, or artifacts are reused. Cross-repository artifacts retain source repository/worktree correlation.
    - Performance: operations are bounded by repository/worktree/record/page/cleanup caps and use stable `git worktree list --porcelain -z`; no per-file worktree scan or global timer. Cleanup/reconcile is O(worktrees owned by one task).
    - Code Quality: reuse `GitOperations`, `CheckpointStore`, `LeaseStore`, coding checkpoint/artifact helpers, and lifecycle emitter. No clone manager, Git library, new DB schema, or second task runtime.
    - Security: roots and worktree destinations are canonicalized under host-approved roots; credential-bearing remotes are fingerprinted/redacted; wrong tenant/repository/fence, symlink escape, main-worktree removal, dirty force, lock/prune race, and artifact mix-up fail closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/{git,git-tools,coding-checkpoint,artifacts,lifecycle}.ts`; process/index identity from Tasks 1–2.
      - Core `CheckpointStore`/`LeaseStore`; plan 022 state-concurrency conformance.
      - Git worktree docs: add/list `--porcelain -z`, remove, lock/unlock, prune/repair semantics.
    - Options Considered:
      - Extend one `GitOperations` instance with global repository discovery: rejected; one runner is intentionally cwd-bound.
      - Host registers repositories; lifecycle composes one bounded runner per registered root and persists task correlations: chosen.
      - Build clone/fetch credentials: rejected; host owns source provisioning and network policy.
    - Chosen Approach:
      - `createCodingWorkspaceLifecycle({ checkpoints, leases, ownerId, ownership, repositories, worktreeRoots, policy })` over existing primitives; records live in a versioned namespace, not `CodingCheckpointMetadata` v1.
    - API Notes and Examples:
      ```ts
      const workspaces = createCodingWorkspaceLifecycle({
        checkpoints,
        leases,
        ownerId: replicaId,
        ownership,
        repositories: {
          app: { root: "/src/app", git: appGit },
          api: { root: "/src/api", git: apiGit },
        },
        worktreeRoots: ["/work/prism"],
      });
      const workspace = await workspaces.create({ taskId, repositories: [{ repositoryId: "app", branch: "agent/task" }] });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/workspace-lifecycle.ts` (tentative): durable records/service/validation.
      - `packages/coding-agent/src/git.ts`, `git-tools.ts`, `coding-checkpoint.ts`, `lifecycle.ts`, `limits.ts`, `index.ts`: narrow integration/exports.
      - `packages/coding-agent/src/__tests__/workspace-lifecycle.test.ts`: memory/CAS/lease/Git fixtures.
      - Durable conformance leg using Postgres checkpoints/leases in `scripts/phase26-recovery-conformance.test.mjs` or package integration test.
      - New `docs/coding-workspaces.md`; update coding tools/process/index/package docs.
  - Test Cases to Write:
    - multi-repository happy path: two repos, isolated branches/worktrees, correlated artifacts/checkpoints.
    - duplicate/concurrent create: one result, stale CAS/fence rejects deterministically.
    - cleanup matrix: clean remove, dirty refusal, locked refusal, main-worktree refusal, missing/partial unknown, retry reconciliation.
    - containment/ownership: symlink/path escape, wrong tenant/repository/worktree id/fingerprint and credential URL leakage rejected.
    - resume: changed base/head/remote/worktree identity invalidates checkpoint/index/review reuse.
    - Postgres multi-process: two replicas race create/cleanup; one lease winner, loser no Git mutation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new workspace lifecycle, durable records, states, limits, and events.
    - Docs pages to create/edit:
      - `docs/coding-workspaces.md`: full API page for repository registration, worktree lifecycle, recovery, cleanup, security, and artifacts.
      - `docs/coding-agent-tools.md`: Git worktree tool vs durable workspace service.
    - `docs/index.md` update: yes — add Coding workspaces under Agent/session runtime or Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4 — Demand-gated forge breadth (GitLab or Bitbucket only)
  - Acceptance Criteria:
    - Functional: execute the Task 0 demand decision. With no named demand, keep both adapters deferred, touch no adapter source, and record gate/evidence in freeze manifest/changelog/further actions. With demand, implement exactly one thin adapter selected by the consumer against existing `ForgeOperations`; do not implement both.
    - Functional: a demanded adapter covers issue context equivalent, push, PR/MR create/update, review comment, checks/status, and handoff reconciliation where provider APIs support them. Unsupported operations fail with a stable typed error; no fake capability or auto-merge.
    - Functional: per-call host credentials, fixed repository binding, `ExecutionPolicy`, `ToolEffectStore`, ownership/session/run correlation, idempotent lookup-before-create, unknown-outcome reconciliation, and bounded pagination match GitHub semantics.
    - Performance: use the shared bounded response reader/fetch, provider page/payload/timeout/concurrency caps, and sequential bounded pagination; package budget remains green.
    - Code Quality: reuse generic `ForgeOperations`; extract only duplicated bounded request/idempotency code now proven by GitHub + demanded adapter. No SDK dependency, provider catalog/factory, or mode-specific core logic.
    - Security: least-privilege scopes documented; token never enters argv/logs/events/model/artifacts; wrong project/workspace, stale head, duplicate mutation, rate limit, redirect/SSRF, cross-tenant use, and cleanup failure fail closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/forge/{types,github}.ts`, `git-exec.ts`; `docs/forge-integration.md`; `ToolEffectStore` and bounded transport docs.
      - GitLab MR API: <https://docs.gitlab.com/api/merge_requests/> — project + IID identity, create/update/list, reviewers vs approvals, `detailed_merge_status`.
      - Bitbucket Cloud PR API: <https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/> — create/update/comments/status/approval scopes.
    - Options Considered:
      - Build both to “complete” forge breadth: rejected; roadmap explicitly says on demand.
      - Record deferral when no consumer: chosen default.
      - One demanded adapter in existing `forge/` directory: chosen if gate fires.
    - Chosen Approach:
      - Freeze demand first. Implement only provider mappings needed by the named consumer, preserving unsupported results rather than widening `ForgeOperations` speculatively.
    - API Notes and Examples:
      ```ts
      // Only when demanded; exact factory selected in Task 0.
      const forge: ForgeOperations = createGitLabForge({
        credentials,
        project: "group/project",
        cwd,
        git,
        effectStore,
        ownership,
        sessionId,
        runId,
      });
      ```
    - Files to Create/Edit:
      - Always: `scripts/phase26-freeze-manifest.json`, root/package changelog and plan completion record.
      - If demanded: `packages/coding-agent/src/forge/gitlab.ts` **or** `bitbucket.ts`, `forge/index.ts`, `index.ts`, tests, package README/CHANGELOG.
      - If demanded: `docs/forge-integration.md` or new provider-specific API page plus `docs/index.md`.
  - Test Cases to Write:
    - no-demand gate: adapter files/exports absent and freeze test green only with explicit deferral.
    - demanded conformance: normalized operations, lookup-before-create idempotency, completed replay, dispatched/unknown refusal, stale/rate-limit/auth mapping.
    - security: token absent from argv/errors/events/effect records; wrong repo/tenant and redirects rejected.
    - protected provider test: disposable project/repository operation and idempotent cleanup; absent credentials blocked in demanded profile.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: conditional. Deferred outcome changes no API; demanded outcome adds one optional factory.
    - Docs pages to create/edit:
      - Deferred: `CHANGELOG.md` only, naming demand gate.
      - Demanded: `docs/forge-integration.md` or provider page with full API structure, permissions, unsupported mappings, limits, examples.
    - `docs/index.md` update: only when adapter ships; add/update Forge integration entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` when demanded.

- [ ] Task 5 — Durable ACP/live-task and managed-process recovery across restarts and replicas
  - Acceptance Criteria:
    - Functional: persist only bounded process intent/metadata and ACP active-run references through host `CheckpointStore`; coordinate ownership with `LeaseStore` fencing. No child/PTY handle, controller, promise, raw output, env, or credential is serialized.
    - Functional: ProcessSessions writes intent before spawn, records dispatch/running/terminal transitions with CAS, and exposes bounded `recover`. An attested backend may reattach by opaque non-secret ref; otherwise `starting|running` records atomically become `unknown`. Two replicas cannot both own/attach/mutate a process.
    - Functional: ACP durable registry records active run id/version/status reference. On restart, it re-resolves session binding and queries `AgentRunLifecycle`; suspended runs preserve pending approval/effect ids, terminal runs report terminal, and unprovable in-flight streams report unknown/unsupported rather than restart the prompt.
    - Functional: add the minimum durable cancellation primitive required for recovered ACP runs. Cancellation is ownership/version/fence checked, terminal/idempotent, aborts no unrelated run, and never replays a pending/dispatched tool. Process cancellation after recovery either reaches the attached backend or records unknown.
    - Functional: workspace/repository/worktree identity from Task 3 and tool/policy/image fingerprints are revalidated before attach/resume/cancel. `ToolEffectStore` correlation survives and ambiguous dispatched effects remain operator-reconciled.
    - Performance: records are paged/capped; recover/cancel is O(owned records), lease TTL/renewal bounded, no global timer or scan. Memory/Postgres conformance agrees; no timing-only sleeps.
    - Code Quality: reuse `CheckpointStore`, `LeaseStore`, `AgentRunLifecycle`, `AcpSessionStore`, process state machine, and plan-022 conformance patterns. New namespaces/codecs are versioned and dependency-free; no scheduler/worker service.
    - Security: cross-tenant/session/run/workspace access, corrupt/oversize record, stale fence, double attach, backend-ref injection, credential fields, cancellation race, and unknown outcome fail closed with redacted errors.
  - Approach:
    - Documentation Reviewed:
      - `src/{agent-run-lifecycle,agent-run-state,leases,checkpoints,tool-effects}.ts`; core persistence contracts.
      - `packages/coding-agent/src/process/*`, coding checkpoint/workspace lifecycle; `docs/process-sessions.md`.
      - `packages/ag-ui/src/acp/{session-store,agent/*}.ts`; `docs/acp.md`; plans 018/022.
    - Options Considered:
      - Serialize live JS/process objects: rejected, unsafe/impossible.
      - Assume PID survival means ownership: rejected; PID reuse and replica split brain.
      - Persist metadata + lease/fence + backend-attested attach; otherwise unknown: chosen.
      - Build a new job scheduler: rejected; recovery remains a host-activated capability.
    - Chosen Approach:
      - Add separate versioned recovery records over existing stores, transition them around side effects, and make ACP/process adapters project honest lifecycle states. Reuse durable run CAS for approvals and `ToolEffectStore` for ambiguous effects.
    - API Notes and Examples:
      ```ts
      const processes = createProcessSessions({
        cwd,
        checkpoints,
        leases,
        ownerId: replicaId,
        recoveryBackend: hostAttachBackend,
        ownership,
      });
      const report = await processes.recover(); // attached | terminal | unknown; never fabricated running
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/process/{types,sessions,recovery}.ts` (exact split frozen in Task 0), index/limits/tests.
      - `packages/ag-ui/src/acp/session-store.ts`, `agent/types.ts`, `agent/core.ts`, registry/notify modules, ACP tests.
      - `src/agent-run-lifecycle.ts`, run-state contracts/state/tests only if durable cancel is not already expressible through existing primitives.
      - `packages/coding-agent/src/workspace-lifecycle.ts`: identity/fence integration.
      - `scripts/phase26-recovery-conformance.test.mjs`: memory/Postgres/two-replica conformance.
      - `docs/process-sessions.md`, `docs/acp.md`, `docs/coding-workspaces.md`, `docs/migration.md`, `docs/index.md`, changelogs.
  - Test Cases to Write:
    - process crash windows: before spawn, after spawn-before-running persist, running, terminal-before-persist; each converges to attach/terminal/unknown without duplicate spawn.
    - replica race: one lease/fence winner; stale owner cannot input/signal/kill/resize/cancel.
    - unsupported attach: restored running record becomes unknown; no PID probing or fabricated exit.
    - ACP restart: active reference restores; suspended approvals/effect ids preserved; terminal status preserved; in-flight unknown not re-prompted.
    - durable cancel: concurrent cancel/resume/tool decision yields one valid CAS outcome and no tool replay.
    - corruption/security: cross-tenant/workspace/fingerprint/backend-ref mismatch and forbidden secret/env fields rejected.
    - Postgres conformance: restart and split-brain tests without timing-only sleeps.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional recovery options/records, ACP active-run recovery, and possibly lifecycle cancellation.
    - Docs pages to create/edit:
      - `docs/process-sessions.md`: persistence, attach contract, unknown outcomes, leases, cancellation.
      - `docs/acp.md`: active-run references and restart/replica behavior.
      - `docs/coding-workspaces.md`: recovery identity/fencing.
      - `docs/migration.md`: 0.2.5 → 0.2.6 durable-record compatibility and downgrade instructions.
    - `docs/index.md` update: yes — extend ACP/process/workspace descriptions with recovery.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6 — Bounded patch review and incremental LSP/check diagnostics workflow
  - Acceptance Criteria:
    - Functional: produce a bounded patch-review manifest from existing Git diff/patch/bundle artifact refs, repository/worktree/base/head identity, SHA-256, changed paths/diffstat, checks, and diagnostic generation. Persist review through existing `ArtifactService`/artifact approval state or a thin structural bridge; do not duplicate artifact storage/review CAS.
    - Functional: review decisions are `pending|accepted|rejected|superseded` and bind to exact artifact revision + patch digest. Any patch/repository/worktree/base/head change supersedes prior acceptance. Rejection records bounded reviewer reason; acceptance never applies, commits, pushes, or merges automatically.
    - Functional: extend `LanguageIntelligence` with bounded document synchronization after file changes (`didChange` with monotonic versions; full-content change allowed, no diff engine) and push/pull diagnostic refresh according to server capabilities. Stale-version diagnostics do not overwrite newer results.
    - Functional: normalize LSP and host-parsed named-check diagnostics into one bounded shape with source, file/range, severity, message/code, generation/revision, and deterministic added/removed/unchanged delta. Check parsers are host-supplied; no language/tool-specific parser catalog.
    - Functional: review/diagnostics lifecycle updates are projected only through explicit host/ACP/AG-UI allow-lists and never expose raw patch bodies, commands, env, or secrets.
    - Performance: patch/manifest/diagnostic/revision/delta caps charge before retention; LSP refresh is limited to changed/visible files and bounded workspace pulls. Review comparison is hash/metadata based, not unbounded body diff.
    - Code Quality: reuse `GitOperations.prHandoff`, `ArtifactReference`, core artifact types/server service, coding checkpoint refs, `LanguageIntelligence`, named checks, and lifecycle events. No review database, TUI, parser framework, or second approval engine.
    - Security: patch TOCTOU, stale approval, out-of-workspace diagnostics, wrong artifact owner, hostile LSP/check payload, control characters, path escape, overflow, and secret leakage fail closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/{git,artifacts,coding-checkpoint,goal-verify,checks,lifecycle}.ts`; `edit.ts` patch metadata.
      - `src/artifacts.ts`; `packages/server/src/artifacts.ts`; `docs/work-artifacts-and-review.md`.
      - `packages/coding-agent/src/language/*`; LSP 3.17 didChange, publish diagnostics replacement, pull diagnostic result IDs and version precedence.
      - `docs/language-intelligence.md`, `docs/coding-agent-tools.md`, `docs/acp.md` projection behavior.
    - Options Considered:
      - New coding review store: rejected; `ArtifactService` already provides CAS revisions/accept/reject.
      - Persist raw patch/check output in checkpoint: rejected; store refs/hashes/summaries only.
      - Compute ranged LSP edits from patches: rejected initially; full-content `didChange` is protocol-valid and smaller/safer.
      - Host check parser + normalized diagnostic contract: chosen; avoids parser catalog.
    - Chosen Approach:
      - Add pure bounded manifest/assertion/delta helpers and a thin artifact-service composition path; enhance LSP synchronization and diagnostics with monotonic versions. Review state remains artifact-backed.
    - API Notes and Examples:
      ```ts
      const review = createCodingPatchReviewManifest({ workspace, handoff, patchArtifact, diagnostics });
      await artifacts.attach(review.artifactInput);
      assertCodingPatchAccepted({ review, artifact: approvedRecord }); // digest/revision/identity checked

      await language.syncDocument("src/app.ts");
      const delta = await language.diagnosticDelta({ files: ["src/app.ts"], previous });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/review.ts` (tentative): manifest, digest binding, accepted/rejected/superseded assertions.
      - `packages/coding-agent/src/language/{types,intelligence,client}.ts`: didChange/pull/version/delta support.
      - `packages/coding-agent/src/checks.ts` or new `diagnostics.ts`: host check normalization/delta.
      - `packages/coding-agent/src/lifecycle.ts`, `coding-checkpoint.ts`, `index.ts`, limits/tests: narrow integration.
      - `packages/server/src/artifacts.ts` only if a generic additive assertion/metadata field is required after primitive review.
      - `packages/ag-ui/src/{projection,acp/mapper}.ts` only for explicit projection-gated lifecycle mapping.
      - New `docs/coding-review-and-diagnostics.md`; update artifact/language/coding/ACP/index docs and changelogs.
  - Test Cases to Write:
    - review lifecycle: pending→accepted/rejected; new patch/revision/identity supersedes; stale acceptance refused.
    - artifact binding: wrong owner/version/hash/bytes/repository/worktree/base/head rejected; raw body never persisted.
    - LSP sync: didOpen then ordered didChange versions; push replacement/empty clear; pull full/unchanged/resultId; stale version loses.
    - check normalization: host parser output bounded/deterministic; malformed/range/path/control/overflow rejected.
    - diagnostic delta: stable added/removed/unchanged across generations, dedupe and caps.
    - projection/redaction: no raw patch/check command/env/secret; unconfigured projection emits nothing.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — review manifest/assertions, LSP sync/diagnostic APIs, normalized diagnostics/events.
    - Docs pages to create/edit:
      - `docs/coding-review-and-diagnostics.md`: full API page, states, artifact binding, LSP/check flow, limits, examples, security.
      - `docs/language-intelligence.md`: sync/pull/delta methods.
      - `docs/work-artifacts-and-review.md`: coding patch composition.
      - `docs/acp.md`: projection-gated review/diagnostic updates if shipped.
    - `docs/index.md` update: yes — add Coding review and diagnostics under Tools/Agent runtime.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 7 — Protected real coding-agent release journey
  - Acceptance Criteria:
    - Functional: add a packed-consumer protected journey using only published exports and real host services: supported provider call, digest-pinned Docker sandbox, host Playwright browser, GitHub forge test repository (or the demanded Task 4 forge), durable Postgres checkpoints/leases, and host PTY adapter when included by the frozen profile.
    - Functional: journey covers repository/worktree allocation, provider-driven edit, read-before-write/policy approval, shell/check, incremental diagnostics, patch artifact, host restart/second replica, process/ACP recovery, accepted or rejected review, cancellation, push/PR/check reconciliation, browser inspection, and terminal/worktree/PR cleanup.
    - Functional: every side effect has a unique run suffix and idempotent cleanup. PR creation uses lookup-before-create; cleanup closes PR and removes test branch/worktree/container/context. Unknown cleanup blocks publication and leaves identifiers in redacted operator evidence.
    - Functional: default local runs may skip the protected journey, but `release:evidence` names it. The 0.2.6 protected release profile requires every frozen env/service; missing credentials/binaries/services or skipped substeps produce `blocked`, not pass.
    - Performance: journey and each cleanup phase obey frozen wall/byte/action/page caps; retained evidence contains timings, states, ids/hashes only, no prompts/source bodies/terminal output/tokens/browser storage.
    - Code Quality: extend existing packed-consumer and release-evidence harnesses; no second E2E framework, Docker/browser launcher, or mock in the protected path. Network-free fake/unit journeys stay fast and unchanged.
    - Security: secrets are late-bound, never argv/artifacts/logs; Docker capability metadata is asserted; egress is allow-listed/attested; browser context is test-owned and closed before host browser; wrong ownership/approval/fence and cancellation races fail closed.
  - Approach:
    - Documentation Reviewed:
      - `scripts/e2e-coding-journey.test.mjs`, `scripts/fixtures/e2e-coding-journey.mjs`, `scripts/release-skip-manifest.mjs`, live/protected workflows.
      - `docs/coding-security.md`, `browser-automation.md`, `forge-integration.md`, `release-and-install.md`.
      - Playwright browser/context lifecycle and GitHub PR/review/check docs listed in Task 0; npm pack docs (`--dry-run` does not create installable tarballs).
    - Options Considered:
      - Promote fake packed journey as real evidence: rejected; it fakes sandbox/forge and launches no browser/provider.
      - Put all live services in default `npm test`: rejected; non-hermetic/flaky and leaks credentials.
      - Named protected profile with fail-loud requirements and retained report: chosen.
    - Chosen Approach:
      - Add a separate env-gated packed-consumer script and report generator. CI protected job provisions services and runs it; release evidence consumes report and blocks missing/stale/partial evidence.
    - API Notes and Examples:
      ```bash
      PRISM_CODING_JOURNEY=1 \
      PRISM_TEST_POSTGRES_URL=... \
      PRISM_TEST_DOCKER_BIN=/usr/bin/docker \
      PRISM_TEST_DOCKER_IMAGE=name@sha256:... \
      PRISM_LIVE_PLAYWRIGHT=1 \
      PRISM_CODING_FORGE_REPOSITORY=owner/repo \
      PRISM_CODING_PROVIDER=... \
      node --test scripts/phase26-coding-journey.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/phase26-coding-journey.test.mjs`: pack/install/orchestrate protected journey.
      - `scripts/fixtures/phase26-coding-journey.mjs`: packed public-export journey.
      - `scripts/release-skip-manifest.mjs`, `scripts/release-evidence.json` generation/tests: named blocked/pass surface.
      - `.github/workflows/release.yml` or dedicated protected coding workflow: service/env provisioning and artifact upload.
      - `scripts/phase26-coding-journey-report.json`: generated evidence (gitignored or retained per existing convention, frozen in Task 0).
      - `docs/release-and-install.md`, `docs/coding-security.md`, `docs/browser-automation.md`, `docs/forge-integration.md`.
  - Test Cases to Write:
    - packed resolution: every import resolves inside fresh consumer, exact 0.2.6 versions.
    - full happy path: all required real legs run and report pass with cleanup complete.
    - required-env matrix: remove each env/report/service in turn; release evidence becomes blocked.
    - restart/replica: first process terminates after durable state; second recovers without duplicate tool/process/PR.
    - cancellation: live provider/process cancellation leaves terminal durable state and cleans resources.
    - leak scan: report/stdout/stderr/artifacts contain no canary/token/prompt/source body.
    - cleanup failure: open PR/branch/worktree/container/browser context or unknown process blocks release.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new runtime API; protected release behavior changes and validates public APIs.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: protected coding profile, required env names, report, cleanup, operator runbook.
      - `docs/coding-security.md`, `docs/browser-automation.md`, `docs/forge-integration.md`: protected journey cross-links and boundaries.
    - `docs/index.md` update: yes — Release and install entry notes protected coding journey.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 8 — Documentation finalization, 0.2.6 bump, compatibility review, and exit gate
  - Acceptance Criteria:
    - Functional: finalize all public API pages and navigation; add root/affected package changelog entries; mark roadmap 0.2.6 bullets complete only when their gate is satisfied (forge may be explicitly deferred by demand policy); update `plans/README.md` to complete only after exit evidence is green.
    - Functional: run scripted `0.2.5 → 0.2.6` bump across 50 manifests + lockfile/exact peers, regenerate package truth, review plain compatibility deltas, update baselines without `--allow-break` unless this plan is amended with migration evidence, and verify no package/subpath/runtime dependency drift.
    - Functional: run focused tests, `npm test`, `test:coverage`, `security:threat-suites`, protected Postgres recovery/workspace conformance, protected PTY/index/forge legs as demanded, protected real coding journey, `sdk:ready`, audit, secret scan, Node 20 packed imports, and pack twice byte-identical. Missing required protected evidence blocks release.
    - Functional: complete `scripts/phase26-baseline.json.exitGate` with counts, coverage, compat deltas, package sizes, p95 measurements, demand outcome, protected report/cleanup status, blocked=false, green=true. Finalize freeze task tokens and deviations.
    - Functional: fill this plan’s `Compromises Made` and `Further Actions` with actual outcomes only. Publication remains signed `v0.2.6` + npm OIDC operator handoff.
    - Performance: package/startup/provider benchmarks do not regress; PTY/index/workspace/recovery/review/journey measurements satisfy Task 0 ceilings; coverage stays above recorded 0.2.5 floors unless an evidence-backed threshold change is approved (threshold weakening is not expected).
    - Code Quality: typecheck, Biome lint/format, unused sweep, docs structural tests, package truth, public exports, compatibility, and deterministic pack pass with zero unexplained diagnostics.
    - Security: threat T1–T8 regressions pass; protected report contains no secret canary; sandbox capabilities/egress attestation and ownership/fence checks are recorded; no silent skip or unresolved cleanup.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, `docs/index.md`, `docs/migration.md`, `docs/0.1.0-readiness.md`; root/package changelogs.
      - `scripts/release.mjs`, package truth, compat baseline, budgets, coverage thresholds, phase23 skip manifest, phase25 exit evidence.
      - `plans/023`–`025` final gate patterns and roadmap 0.2.6 acceptance.
    - Options Considered:
      - Ship after unit tests with live journey “protected later”: rejected; roadmap makes protected E2E evidence an acceptance requirement.
      - Change all package versions manually: rejected; scripted atomic exact-peer bump is repository policy.
      - Additive compatibility review + full protected evidence + operator publication: chosen.
    - Chosen Approach:
      - Finalize docs, bump once, review declarations/package truth, run every default/protected gate, retain immutable evidence, then hand off signed publication.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.2.5 --to 0.2.6
      node scripts/package-truth.mjs --out scripts/package-truth.json
      npm run security:threat-suites
      PRISM_TEST_POSTGRES_URL=... npm run test:postgres
      npm run sdk:ready
      npm audit --audit-level=moderate
      git ls-files -z | xargs -0 node scripts/scan-secrets.mjs
      node scripts/release.mjs gate --version 0.2.6
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md` and affected package changelogs: 0.2.6 outcomes and explicit forge demand result.
      - `docs/index.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/0.1.0-readiness.md`: release/navigation/migration/protected evidence.
      - `package.json`, workspace manifests, `package-lock.json`, version constants/tests: scripted bump.
      - `scripts/package-truth.json`, `scripts/compat-baseline/*`, `scripts/budgets.json`, `scripts/coverage-thresholds.json` only when measured/reviewed.
      - `scripts/phase26-baseline.json`, `scripts/phase26-freeze-manifest.json`: final evidence/tokens/deviations.
      - `roadmap.md`, `plans/README.md`, this plan: completion bookkeeping after green gate.
  - Test Cases to Write:
    - docs/navigation semantics: every new API indexed; roadmap/plan/changelog/version agree; forge deferred/demanded wording matches manifest.
    - package truth: 50 packages, exact 0.2.6 peers, no new runtime dependency/subpath, deterministic tarballs.
    - compatibility sequence: reviewed pre-refresh additive deltas; post-refresh 0 breaking; unexpected removal/change blocks.
    - release evidence: all protected surfaces and cleanup accounted for; malformed/missing phase26 report makes `green: false`.
    - exit manifest format: counts retain machine-readable `N tests / N pass / N skip / N fail` shape consumed by release evidence.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release finalizes all Task 1–6 public additions and Task 7 protected behavior.
    - Docs pages to create/edit:
      - All pages listed in Tasks 1–7, plus `docs/release-and-install.md`, `docs/migration.md`, `docs/0.1.0-readiness.md`, root/package changelogs.
    - `docs/index.md` update: yes — final navigation and current release line 0.2.6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
