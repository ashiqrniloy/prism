# Phase 4 — Release 0.0.9: Production Coding and Browser Execution

## Objectives

- Implement roadmap Phase 4 coding and browser execution only: one disposable containment boundary, bounded repository/Git tools, durable coding-task composition, and narrow Playwright browser tools.
- Reuse existing tool, execution-policy, guardrail, run-limit, checkpoint, workflow, file-mutation, image, event, resource, redaction, and evaluation primitives; add no second agent, workflow, approval, or browser-planning runtime.
- Remove Office execution from the 0.0.9 Prism package/release boundary. Office work may remain host-selected skill/instruction content, but Prism will not ship `@arnilo/prism-work-tools`, an OfficeCLI wrapper, an Office binary/SDK, generic Office CLI/MCP passthrough, or Office-specific runtime types.
- Keep core dependency-free, browser automation optional, sandbox/browser activation explicit, browser binaries and container images host-pinned, and default tests network-free.
- Before 0.0.9 publication, fix the high-severity Synapta defects in `bug-reports/prism-tool-call-stream-failures-and-empty-candidate.md`: terminal malformed/truncated tool-call stream failures and empty-candidate `generateValidateReviseLoop` success.

## Expected Outcome

- `@arnilo/prism-coding-security` includes one production-reference, host-invoked Docker/OCI sandbox adapter using a host-pinned image and Docker executable with read-only root, bounded writable workspace, deny-by-default network, non-root execution, finite CPU/memory/PID/disk/time limits, explicit secret allow-listing, and deterministic stop/kill/cleanup.
- `@arnilo/prism-coding-agent` adds bounded native repository list/search, structured Git operations, named checks, safe patch/worktree/rollback support, and host-owned PR handoff data without making raw shell the default research or Git path.
- Durable plans/todos, diagnostics, approvals, checkpoints, background branches, and restart/resume compose existing workspace files, agent/workflow checkpoints, leases, events, and host artifact storage; shell remains an explicit escape hatch.
- New optional `@arnilo/prism-browser` exposes only `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close` over a host-supplied/pinned Playwright browser. One non-persistent `BrowserContext` belongs to one run, actions serialize, accessibility refs/role/label targets precede selectors, side effects pass current policy/approval, and every page/action/artifact/resource is finite.
- Coding and browser execution can run in the same disposable boundary when the host selects the reference Docker adapter and a pinned Playwright image. Browser egress is denied unless the host supplies a real firewall/proxy policy; Playwright routing remains defense in depth, not a DNS-containment claim.
- Malformed streamed tool-call arguments become failed tool results (turn completes; model can self-correct within `maxToolRounds`/`maxTurns`). Incomplete tool-call deltas surface a typed catchable error (`invalid_arguments` | `incomplete_delta`), never a bare `Error`, and do not masquerade as hard transport failures.
- `generateValidateReviseLoop` never reports `succeeded` without a validated artifact: empty/thinking-only call-free candidates emit `artifact_failed` with `reason: "parse_error"` and consume revision budget.
- 0.0.9 package graph, docs, examples, benchmarks, adversarial tests, protected Docker/Playwright checks, Synapta defect regressions, and release evidence pass without any Office package, dependency, binary, test, docs page, or release prerequisite.

## Tasks

- [x] 0. Freeze revised Phase 4 scope, primitive ownership, external revisions, and finite limits
  - Acceptance Criteria:
    - Functional: map every retained Phase 4 coding/browser criterion to an existing primitive, minimum gap, owning task, test, docs page, and release gate; explicitly mark every Office/OfficeCLI criterion as removed by product decision rather than silently unimplemented.
    - Performance: freeze default/hard caps and charging points for sandbox startup/workspace/process/output/export, repository walk/search/Git, named checks, worktrees/background runs, browser contexts/pages/actions/snapshots/screenshots/uploads/downloads/popups/dialogs, and cleanup before implementation allocates or starts external work.
    - Code Quality: inventory all callers and contracts for `ToolDefinition`, `ExecutionPolicy`, `PermissionPolicy`, guardrails, `RunLimits`, `CheckpointStore`, workflow state/suspend/coordinator, coding operation backends, `withFileMutationQueue`, `ResourceLoader`, `ImageContent`, and event/eval APIs; add a generic primitive only when coding and browser or another existing package both need it.
    - Security: freeze the trust model for Docker daemon/image/executable, workspace import/export, secrets, egress proxy/firewall, Playwright control endpoint, browser storage state, uploads/downloads, and side-effect approval; no regex sandbox claim, inherited environment, implicit image pull, raw browser JavaScript, local profile, or Office executable is allowed.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 4, Product Boundaries, Release Order and Gates, Phase Planning Workflow, package table, missing-capability summary, and release checklist.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/tool-execution-primitives.md`, `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/guardrails.md`, `docs/evaluations.md`, `docs/performance.md`, `docs/host-security.md`, and `docs/release-and-install.md`.
      - Current implementation: `packages/coding-agent/src/{index,shell,read,write,edit,file-mutation-queue,execution-policy}.ts`, `packages/coding-security/src/{sandbox,approval,path-containment}.ts`, core durable run/checkpoint contracts, and workflow coordinator/state/checkpoint APIs.
      - Context7 resolved Playwright v1.61.0 as `/microsoft/playwright/v1.61.0`; official API sources: <https://playwright.dev/docs/api/class-browsercontext>, <https://playwright.dev/docs/api/class-locator>, <https://playwright.dev/docs/locators>, <https://playwright.dev/docs/aria-snapshots>, <https://playwright.dev/docs/network>, and <https://playwright.dev/mcp/snapshots>.
      - Docker CLI/run/security references: <https://docs.docker.com/reference/cli/docker/container/run/>, <https://docs.docker.com/engine/containers/run/>, and <https://docs.docker.com/engine/security/seccomp/>.
      - Git plumbing/porcelain references selected at implementation time from <https://git-scm.com/docs> for `status --porcelain=v2 -z`, `diff --no-ext-diff`, `check-ref-format`, `worktree`, `apply --check`, `commit`, `bundle`, and pathspec separation with `--`.
    - Options Considered:
      - Keep roadmap OfficeCLI package scope and merely omit implementation: leaves an impossible release criterion and contradicts the requested product boundary; rejected.
      - Treat command rules or Playwright request routing as containment: neither controls kernel/filesystem/process escape or DNS rebinding; rejected.
      - Add separate runtimes for coding tasks, browser plans, approvals, and artifacts: duplicates existing runs/workflows/checkpoints/policies; rejected.
      - Freeze one coding/browser scope and primitive matrix, revise roadmap Phase 4 during execution, and generalize only proven shared seams: chosen.
    - Chosen Approach:
      - Create a checked-in Phase 4 evidence matrix with exact repository revision, Playwright/package version, Docker/Git docs retrieval dates, primitive/caller inventory, retained/removed roadmap criteria, limit table, and threat owners.
      - Freeze non-goals: OfficeCLI/Office SDK/MCP/CLI integration; Office package or docs; browser `page.evaluate`/CDP/devtools/extensions/persistent profiles; arbitrary selector/JavaScript tools; Git shell-string assembly; model-created commands; automatic Docker image pull/build/update; bundled browser/image/proxy; GitHub/GitLab API client; hosted worker/control plane.
      - Require Task 1 to prove a real reference containment path before coding/browser packages can claim production readiness. Package-level policy checks remain mandatory but never substitute for containment.
    - API Notes and Examples:
      ```text
      roadmap criterion -> retained/removed decision -> current primitive -> minimum gap -> owner -> test -> docs -> release gate

      Office decision: host-selected skills/instructions only; no Prism executable, wrapper, package, protocol, or release gate.
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-20-phase-4.md` (new): retained/removed scope, primitive/caller, external revision, limit, threat, package, and release matrix.
      - `docs/index.md`: link Phase 4 review coverage under Release and install/maintenance.
      - `roadmap.md`: during task execution, remove OfficeCLI/package/release claims from Phase 4 and state the host-skill-only Office boundary without rewriting later unrelated phases.
      - `src/__tests__/docs.test.ts`: assert evidence structure/owners/limits and prevent removed Office implementation claims from returning.
      - `plans/072-release-0-0-9-production-coding-and-browser-execution.md`: append finalized evidence while executing this task.
    - References:
      - Current `SandboxAdapter` delegates shell only; read/write/edit already expose bounded operation seams but have no shared disposable-workspace lifecycle.
      - Current `createReadOnlyTools()` ships only `read`; repository listing/search and structured Git are absent.
      - Current workflow/checkpoint/coordinator primitives already provide durable state, approvals, leases, background runs, and exact-owner cancellation.
  - Test Cases to Write:
    - Traceability check: every retained coding/browser roadmap criterion has exactly one owner; every removed Office criterion maps to the explicit product decision and no implementation task.
    - Primitive check: every proposed core/shared primitive has at least two concrete consumers; otherwise it remains package-local or is deleted from the plan.
    - Limit/threat check: every external operation has finite count/byte/time/concurrency/disk bounds, authority owner, abort/cleanup behavior, redaction point, and unsupported/default-deny behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release scope changes by removing Office execution and freezing coding/browser package boundaries.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-20-phase-4.md`: scope and implementation evidence.
      - `roadmap.md`: authoritative Phase 4 boundary correction.
    - `docs/index.md` update: yes; add Phase 4 review coverage under Release and install/maintenance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Created `docs/review-coverage-2026-07-20-phase-4.md` and indexed it once under Release and install. Evidence freezes Prism `0d109989b4892e3fe4378ab782044ceadc460277`, Node `v24.18.0` reference with Node 20/current release support, `playwright-core@1.61.0` with npm integrity, Docker client/server `29.6.1`, Git `2.55.0`, official API URLs, retrieval date, compatibility decisions, and default network-free/protected-live split.
    - Revised `roadmap.md` Phase 4 to coding/browser execution only. Removed Office implementation from 0.0.9 acceptance, approach, files, tests, package ledger, persona outcomes, dependent artifact wording, and release checklist; retained one explicit product-decision statement: host-selected external skills/instructions only, with no Prism Office executable, SDK, wrapper, package, protocol, tests, docs page, binary, or release gate. Later Microsoft 365/Google Workspace connectors remain independent 0.0.10 decisions.
    - Mapped every retained criterion to Tasks 1–8, required proof, docs, and release gate; mapped Office to one removed product criterion with no implementation task. Froze supported/unsupported sandbox, coding, browser, network, artifact, and Office boundaries.
    - Inventoried actual contracts/callers for `ToolDefinition`/dispatch, `ExecutionPolicy`, `PermissionPolicy`, guardrails/redaction, `RunLimits`, `CheckpointStore`/leases, workflow state/suspend/coordinator, coding operation backends, `withFileMutationQueue`, `ResourceLoader`, `ImageContent`, events, evals, and `SandboxAdapter`. Decision: no new core primitive. Only minimal coding-security typed lifecycle/exec/export, coding-agent repository/Git/check seams, and optional browser-local manager types are authorized; promotion requires two concrete non-test consumers.
    - Froze defaults/hard caps and pre-charge/stream-charge/cleanup owners for sandbox startup/wall/idle, CPU/memory/PIDs/file descriptors/tmpfs, commands/output/env/import/export/cleanup; repository traversal/search/regex; Git/check/worktree/background/checkpoint/plan/handoff; and browser context/page/action/queue/snapshot/network/screenshot/upload/download/dialog/popup/cleanup resources. Threat matrix assigns host authority and fail-closed behavior for daemon/image, filesystem/artifacts, process/env/secrets, network/DNS, Playwright endpoint, side effects, storage state, resume, and Office exclusion.
    - Added `src/__tests__/docs.test.ts` regression coverage for required evidence sections, Tasks 1–8 ownership, finite-limit groups/default-hard columns, revised Phase 4 title, explicit Office removal, and absence of removed implementation claims.
    - Verification passed: core build; targeted 3/3 docs checks; complete docs suite 85/85; `git diff --check` clean. Task changes documentation/scope only—no public runtime API changed.

- [x] 1. Implement one disposable Docker/OCI sandbox reference with bounded workspace import/export and lifecycle
  - Acceptance Criteria:
    - Functional: a host explicitly creates a sandbox from an absolute Docker executable and digest-pinned existing image; adapter creates one disposable non-root container with read-only root, read-only source mount, size-bounded writable workspace/download/tmp mounts, explicit workdir, private PID/IPC namespaces, `--init`, no restart, and no Docker socket/device/host namespace/privileged access.
    - Functional: adapter supports typed `execFile(file, args)` plus the existing shell escape-hatch mapping, ordered stdout/stderr streaming, bounded workspace import/export, status, cooperative stop, forced kill, and idempotent cleanup; abort/timeout/output/disk/process failures terminate active work and retain only explicitly exported host artifacts.
    - Performance: CPU, memory+swap, PIDs, file descriptors, tmpfs/workspace bytes, command output, command count/concurrency, startup, idle, wall time, stop grace, export entries/bytes, and retained artifact count have validated defaults/hard caps; no polling/list/map grows without a cap.
    - Code Quality: use Node `spawn`/`execFile` argument arrays and Docker CLI commands; extend the existing `SandboxAdapter` minimally, reuse coding output/abort handling, and add no Docker SDK/client framework, image builder, scheduler, generic remote runtime, or core dependency.
    - Security: default `--network=none`, `--pull=never`, `--cap-drop=ALL`, `no-new-privileges`, built-in/default seccomp, no inherited host environment, exact secret-name allow-list with redaction, untrusted image/daemon rejection guidance, path/symlink-safe import/export, and cleanup-by-recorded-ID/label prevent command, container-name, path, and stale-resource injection.
  - Approach:
    - Documentation Reviewed:
      - Docker `container run` flags for `--read-only`, `--mount`, `--tmpfs`, `--network`, `--pids-limit`, `--memory`, `--memory-swap`, `--cpus`, `--cap-drop`, `--security-opt`, `--user`, `--init`, `--pull`, `--stop-timeout`, `--rm`, and `--storage-opt`: <https://docs.docker.com/reference/cli/docker/container/run/>.
      - Docker isolation/resource behavior and warning that containers have outbound network by default: <https://docs.docker.com/engine/containers/run/>.
      - Docker default seccomp deny list and privilege boundaries: <https://docs.docker.com/engine/security/seccomp/>.
      - Existing `packages/coding-security/src/sandbox.ts`, coding `BashOperations`, `OutputAccumulator`, path containment, and shell process-tree/abort behavior.
    - Options Considered:
      - Docker SDK dependency: unnecessary for a narrow host-installed CLI adapter and increases dependency/auth surface; rejected.
      - Bind the host working tree read-write: simplest, but failed/malicious runs can corrupt source and host disk before rollback; rejected as production default.
      - Size-bounded tmpfs workspace imported from a read-only source, then explicit bounded patch/bundle/artifact export: chosen; host may supply a stronger remote sandbox through the existing adapter seam.
    - Chosen Approach:
      - Add `createDockerSandbox()` in `@arnilo/prism-coding-security`. Start by ID, never interpolated shell text; inspect capabilities/version before use; use host-supplied image digest and `--pull=never`.
      - Mount source read-only and populate `/workspace` into finite tmpfs using trusted typed helper execution. Execute all untrusted processes in the container as configured non-root UID/GID. Keep base root read-only and provide only finite tmpfs paths required by tooling/browser.
      - Export a bounded patch/bundle/tar stream plus SHA-256/entry/byte metadata through a host callback; checkpoint records retain only host artifact references and hashes, never whole workspaces.
      - Network stays `none` unless a host selects a pre-created egress-controlled network and proxy. Adapter validates configuration but does not claim Docker routing alone proves origin/DNS policy.
    - API Notes and Examples:
      ```ts
      const sandbox = await createDockerSandbox({
        docker: "/usr/bin/docker",
        image: "registry.example/prism-code@sha256:<host-pinned-digest>",
        sourceRoot: "/srv/jobs/task-1/source",
        user: "10001:10001",
        network: { mode: "none" },
        limits: {
          cpus: 2,
          memoryBytes: 2 * 1024 ** 3,
          maxPids: 256,
          workspaceBytes: 1024 ** 3,
          wallTimeMs: 20 * 60_000,
        },
        env: { CI: "1" },
      });
      await sandbox.execFile({ file: "npm", args: ["test"], cwd: "/workspace", signal });
      await sandbox.close({ export: hostArtifacts.write });
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox.ts`, `index.ts`: minimal lifecycle/typed-exec/export contracts and backward-compatible shell mapping.
      - `packages/coding-security/src/docker-sandbox.ts`, `docker-cli.ts`, `sandbox-limits.ts` (new, exact split tentative after Task 0): argument construction, lifecycle, output, limits, import/export, cleanup.
      - `packages/coding-security/src/__tests__/docker-sandbox.test.ts` (new): fake-Docker argument/lifecycle tests; protected real-Docker tests remain separate.
      - `packages/coding-security/package.json`, `README.md`, `CHANGELOG.md`.
      - `docs/coding-security.md`, `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Existing `createSandboxBashOperations()` remains supported; new typed execution must not break custom adapters.
      - Docker daemon access is host-equivalent authority and remains outside model/tool arguments.
  - Test Cases to Write:
    - Fake-CLI matrix: exact argument arrays, pinned-image/pull denial, no inherited env, IDs/labels, startup failure, malformed inspect, timeout/abort, ordered output, stop→kill, duplicate close, orphan cleanup, and redacted errors.
    - Real protected matrix: read-only root/source, writable bounded workspace, non-root UID, no Docker socket/devices/host PID/IPC, dropped capabilities, seccomp/no-new-privileges, fork bomb/PID cap, memory pressure, disk fill, file-descriptor cap, timeout and forced cleanup.
    - Import/export matrix: symlink/hardlink/device/path traversal, sparse/large file, entry/byte overflow, source unchanged after failure, deterministic hash, aborted export, and no unpublished artifact retention.
    - Network/secret matrix: no network by default, missing egress policy fails closed, exact allowed env only, secret canary absent from command/errors/export metadata, and container cannot inspect host environment.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; production Docker sandbox/lifecycle/limits and extended adapter contracts are public optional-package APIs.
    - Docs pages to create/edit:
      - `docs/coding-security.md`: Docker adapter inputs/outputs, lifecycle, limits, daemon/image trust, workspace export, and network boundary.
      - `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`: production requirements, resource ceilings, and adapter migration.
    - `docs/index.md` update: yes; expand Coding execution approval and sandboxing, Security, Performance, and Migration descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-20):
    - Extended `@arnilo/prism-coding-security` with `createDockerSandbox()` / `DisposableSandbox` while preserving `SandboxAdapter.exec` and `createSandboxBashOperations()`. New modules: `sandbox-limits.ts`, `docker-cli.ts`, `sandbox-tar.ts`, `docker-sandbox.ts`.
    - Reference adapter requires an absolute Docker executable and digest-pinned image (`--pull=never`), creates a non-root container with read-only root, read-only source mount, size-bounded `/workspace`/`/tmp`/`/downloads` tmpfs, `--network=none` by default, `--cap-drop=ALL`, `no-new-privileges`, `--init`, `--ipc=private`, CPU/memory/PID/FD caps, and labeled recorded IDs. Host environment is never inherited; env is an exact allow-list with secret canary redaction.
    - Lifecycle covers typed `execFile(file, args)`, shell escape-hatch `exec`, status, cooperative stop → kill, idempotent close/cleanup, bounded workspace import (symlink/device/escape rejection), and two-pass tar export with SHA-256/entry/byte metadata through a host callback.
    - Network-free fake-CLI suite in `packages/coding-security/src/__tests__/docker-sandbox.test.ts` covers argument arrays, digest/root/relative-docker rejection, ordered output, secret redaction, command caps, startup-failure orphan cleanup, duplicate close, import symlink rejection, export metadata, and limit hard-cap validation. Protected real-Docker matrix is gated behind `PRISM_TEST_DOCKER_SANDBOX=1` + `PRISM_TEST_DOCKER_BIN` + digest-pinned `PRISM_TEST_DOCKER_IMAGE` and skips safely by default.
    - Docs/README/changelog/index/host-security/performance/migration updated for the Docker reference, finite caps, host trust boundaries, and additive migration note. Package description updated; version remains 0.0.8 until Task 8.
    - Verification: `npm run build -w @arnilo/prism-coding-security` and package tests 20 pass / 1 protected skip / 0 fail.

- [x] 2. Add bounded native repository listing/search and sandbox-backed coding operation composition
  - Acceptance Criteria:
    - Functional: read-only coding tools include repository list and text search with deterministic relative paths, include/exclude patterns, ignored/hidden/binary/symlink policy, pagination/result metadata, and explicit truncation; common research no longer requires shell `find`, `ls`, or `grep`.
    - Functional: one construction path wires shell/read/write/edit/list/search to the same sandbox workspace while preserving local/custom operation compatibility, execution policy, tool validation, abort, and existing tool result contracts.
    - Performance: repository depth/entries/files/scanned bytes/file bytes/matches/line bytes/pattern bytes/concurrency/wall time are finite and validated before traversal/retention; walking streams rather than materializing the repository and stops immediately on aggregate limits/abort.
    - Code Quality: use Node filesystem/stream/regex primitives and existing truncation/path/result helpers; no glob/search dependency, index database, watcher, language server, or speculative repository abstraction enters core.
    - Security: resolve every traversed path beneath the selected workspace, never follow symlink escapes by default, reject devices/FIFOs/sockets, treat filenames/content as untrusted, prevent regex resource abuse with bounded pattern/input/time policy, and run sandbox operations inside the disposable boundary.
  - Approach:
    - Documentation Reviewed:
      - Node 20/current `fs.promises.opendir`, `Dirent`, streams, `realpath`, `path.relative`, `AbortSignal`, and regular-expression behavior from <https://nodejs.org/api/fs.html>, <https://nodejs.org/api/path.html>, and <https://nodejs.org/api/globals.html>.
      - Existing bounded read, path resolution, truncation, operation-backend, execution-policy, and mutation-queue implementations in `packages/coding-agent/src`.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, and `docs/tool-execution-primitives.md`.
    - Options Considered:
      - Require ripgrep/find: fast but adds executable/version/install assumptions and routes baseline research through subprocesses; rejected for native defaults.
      - Build an index/watcher: unnecessary for one disposable task and adds stale state; rejected.
      - Streaming stdlib walk/search with optional host `RepositoryOperations` override: chosen.
    - Chosen Approach:
      - Add narrow `repo_list` and `repo_search` tools. Search uses literal mode by default; regex is explicit, length-bounded, and subject to per-file/aggregate wall limits. Binary detection uses bounded prefix bytes; ignored directories use a small host-configured set rather than implementing Git ignore syntax twice.
      - Add only the operation wiring needed to target an existing `SandboxAdapter`; keep current local defaults unchanged. If Task 0 proves no clean shared factory is needed, document per-tool wiring instead of adding one.
      - Extend `createReadOnlyTools()` with list/search only as a deliberate 0.0.9 behavior change, covered by migration docs; `createCodingTools()` includes them plus existing tools.
    - API Notes and Examples:
      ```ts
      const tools = createCodingTools("/workspace", {
        executionPolicy,
        sandbox,
        repository: {
          maxResults: 1_000,
          maxScannedBytes: 64 * 1024 * 1024,
          exclude: [".git", "node_modules", "dist"],
        },
      });
      // repo_search { query: "createAgent", path: "src", mode: "literal" }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/repository.ts`, `list.ts`, `search.ts` and focused tests (new; exact split tentative).
      - `packages/coding-agent/src/index.ts`, `limits.ts`, path/truncation helpers: exports, aggregators, finite caps.
      - `packages/coding-security/src/sandbox-coding-operations.ts` and tests (new only if Task 0 validates one shared wiring helper).
      - `packages/coding-agent/package.json`, `README.md`, `CHANGELOG.md`; coding-security README/changelog if its public wiring changes.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/performance.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Existing per-tool `ReadOperations`, `WriteOperations`, `EditOperations`, and `BashOperations` are the reuse seam; do not replace working public contracts without migration need.
  - Test Cases to Write:
    - Walk matrix: deterministic ordering/pagination, hidden/include/exclude, symlink loop/escape, device/FIFO/socket, unreadable path, Unicode/newline/control-character filenames, depth/count/byte/time/abort limits.
    - Search matrix: literal/regex, multiline/long line, binary/large/ignored files, result ordering/context, invalid/pathological pattern, aggregate overflow, abort, and no full-repository retention.
    - Composition matrix: all coding tools observe one sandbox workspace; local/custom operation backends remain compatible; read-only aggregator contains no mutating or shell tool.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new tool names/schemas/results/limits and read-only/full aggregator membership change.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: list/search APIs, schemas, results, bounds, composition, and examples.
      - `docs/coding-security.md`, `docs/performance.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Coding agent tools, Coding security, Security, and Performance descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-20):
    - Added `@arnilo/prism-coding-agent` `repo_list` / `repo_search` with streaming `opendir`/`lstat` walks, literal-default and bounded-regex search, deterministic relative paths, hidden/exclude basename policy (default `.git`/`node_modules`/`dist`), symlink non-follow + escape rejection, binary NUL sniff, pagination/`nextOffset`, and explicit truncation metadata. New modules: `repository.ts`, `list.ts`, `search.ts`; limits published in `limits.ts`.
    - Aggregators updated: `createCodingTools()`/`createAllTools()` return six tools; `createReadOnlyTools()` deliberately expands to `[read, repo_list, repo_search]` (migration note added). `ToolsOptions.repository` shares limits/backends; per-tool `list`/`search` overrides remain.
    - Sandbox composition helper `createSandboxCodingTools()` / `createSandboxReadOnlyTools()` in `@arnilo/prism-coding-security` wires shell via `createSandboxBashOperations(sandbox)` while FS/list/search keep the host `cwd` (Docker tmpfs mutations stay in-container until export unless custom operations are supplied).
    - Network-free tests: coding-agent repository/aggregator matrices (ordering, pagination, hidden/exclude, symlink escape, abort/policy, literal/regex/context, binary skip, match/scan truncation, custom operations); coding-security composition suite. Verification: coding-agent 152/152 pass; coding-security 23 pass / 1 protected Docker skip / 0 fail; docs suite below.
    - Docs/README/changelog/index/performance/host-security/migration updated for list/search APIs, finite caps, read-only membership change, and sandbox composition. Package versions remain 0.0.8 until Task 8.

- [x] 3. Add structured Git, named checks, safe rollback/worktree, and PR-handoff tools
  - Acceptance Criteria:
    - Functional: first-party typed tools cover status, bounded diff, branch validation/create/switch, worktree create/list/remove, patch check/apply/reverse, explicit-path commit, and host-defined named test/lint/typecheck/security commands; all executable invocations use file+argument arrays and structured results.
    - Functional: mutating Git operations reject a dirty/unrelated worktree unless the request explicitly establishes a bounded checkpoint; failed multi-file patch/check/commit restores the exact pre-operation tree/index or discards the disposable worktree; shell remains available but is not used internally by Git/check tools.
    - Functional: background branch completion emits a bounded host-owned PR handoff (`base`, `head`, commits, changed paths, diffstat, checks, patch/bundle artifact reference) and never pushes, authenticates to GitHub/GitLab, or creates a PR itself.
    - Performance: Git output/input/pathspec/ref/message bytes, changed files, diff lines, worktrees, named commands, concurrent jobs, command attempts, artifacts, and wall time are finite; large diffs return metadata plus host artifact reference rather than unbounded model content.
    - Code Quality: use Node `spawn`/sandbox `execFile`, Git porcelain/plumbing formats, existing output accumulation, execution policy, mutation queue, and artifact callback; no shell-string Git builder, Git library dependency, PR client, generic job queue, or repo-hook framework.
    - Security: prefix option-like values with `--` where applicable, validate refs with `git check-ref-format`, disable external diff/pager/credential prompts/untrusted hooks by default, scope paths to workspace, classify each mutation/command for approval, and prevent repo config/attributes/path names from executing host processes or leaking credentials.
  - Approach:
    - Documentation Reviewed:
      - Official Git docs at implementation time: <https://git-scm.com/docs/git-status>, <https://git-scm.com/docs/git-diff>, <https://git-scm.com/docs/git-check-ref-format>, <https://git-scm.com/docs/git-worktree>, <https://git-scm.com/docs/git-apply>, <https://git-scm.com/docs/git-commit>, and <https://git-scm.com/docs/git-bundle>.
      - Node `child_process.spawn`/`execFile` argument-array semantics: <https://nodejs.org/api/child_process.html>.
      - Existing coding shell output accumulator, execution policy, file mutation queue, workflow background coordinator, and host artifact/resource seams.
    - Options Considered:
      - Expose raw `git` command text: duplicates shell and defeats operation-level policy; rejected.
      - Add isomorphic-git/simple-git: dependency and behavior surface exceeds required local Git CLI semantics; rejected.
      - Small typed operation set over host-pinned Git executable inside sandbox: chosen.
    - Chosen Approach:
      - Parse `git status --porcelain=v2 -z`; request diffs with `--no-ext-diff --no-textconv --`; set noninteractive/pager-safe environment; use temporary bounded message/patch files rather than shell quoting.
      - Treat a disposable branch/worktree as primary transaction. For requested in-place patch batches, record index/worktree state, run `git apply --check`, apply once, verify, and restore on failure. Never destroy pre-existing dirty changes.
      - Named checks are host configuration (`name -> executable + fixed args + cwd/env allow-list + limits`). Model selects only a declared name, not executable/arguments, unless host declares bounded parameter slots.
      - Produce PR handoff data/artifact only; host verifies identity/policy and pushes/opens the PR outside Prism.
    - API Notes and Examples:
      ```ts
      const gitTools = createGitTools("/workspace", {
        execFile: sandbox.execFile,
        artifactStore: hostArtifacts,
        checks: {
          test: { file: "npm", args: ["test"] },
          typecheck: { file: "npm", args: ["run", "typecheck"] },
        },
      });
      // git_commit { paths: ["src/a.ts", "test/a.test.ts"], message: "Fix parser" }
      // coding_check { name: "test" }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/git.ts`, `git-status.ts`, `git-tools.ts`, `checks.ts`, `artifacts.ts` and focused tests (new; exact split tentative).
      - `packages/coding-agent/src/index.ts`, `limits.ts`, aggregators, package metadata/README/changelog.
      - `packages/coding-security` execution action/risk mapping tests only if existing string-extensible `ExecutionAction.kind` needs no type change (expected: no core change).
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - `ExecutionAction.kind` already accepts custom strings; Git/check policy does not need a core enum expansion.
      - Existing workflow background/coordinator owns durable execution; Git tools own repository operations only.
  - Test Cases to Write:
    - Git parse matrix: porcelain-v2 rename/copy/conflict/submodule/untracked/ignored/Unicode records, detached HEAD, unborn branch, bounded diff/binary output, malformed fake Git output.
    - Injection/security matrix: leading-dash path/ref/message, malicious repo config/external diff/filter/hooks/credential helper, pager/editor prompt, symlink escape, wrong root, secret canary, abort/timeout/output overflow.
    - Mutation matrix: clean/dirty protection, `apply --check`, partial-failure rollback, staged/unstaged preservation, explicit-path commit, branch/worktree collisions, concurrent same-worktree serialization, canceled worktree cleanup.
    - Check/handoff matrix: allow-listed command only, fixed args/env, failure/diagnostic truncation, artifact spill, bounded PR payload, no push/network/credential resolver, and deterministic changed-path/diffstat order.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; structured Git/check/artifact tool APIs and safety behavior are new.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: Git/check/PR handoff inputs, outputs, examples, unsupported operations, and limits.
      - `docs/coding-security.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Coding agent tools, Workflows, Security, and Performance descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-20):
    - Added opt-in `@arnilo/prism-coding-agent` structured Git surface: `git-exec.ts`, `git-status.ts`, `git.ts`, `git-tools.ts`, `checks.ts`, `artifacts.ts`. Tools: `git_status`, `git_diff`, `git_branch`, `git_worktree`, `git_apply`, `git_commit`, `git_pr_handoff`, plus optional `coding_check` when host declares named commands. `createGitTools()` is separate from `createCodingTools()`/`createAllTools()` so coding tools are not required to use Git.
    - Safety: argument arrays only; `SAFE_GIT_CONFIG_ARGS` disables hooks (`core.hooksPath=/dev/null`), credential helper, and pager; env sets `GIT_TERMINAL_PROMPT=0`; diffs use `--no-ext-diff --no-textconv`; refs via `git check-ref-format --branch`; paths after `--`; commits require host `commitIdentity` and `--no-verify` with temp message files; never pushes/authenticates/opens PRs.
    - Dirty-tree policy: mutating switch/apply refuse unrelated dirty state unless `createCheckpoint=true` (pathspec-scoped stash); commit allows dirty entries that are exactly the requested paths; apply always `--check` first and restores on failure; reverse does not require a clean tree.
    - Limits published for paths/refs/messages/output/diff lines/changed files/patch/worktrees/checks/handoff matching Phase 4 review-coverage. Sandbox composition via `execFile: sandbox.execFile`.
    - Verification: coding-agent 165/165 pass (13 new Git/check tests covering porcelain parse, dirty protection, leading-dash paths, apply/reverse, worktree, PR handoff, named checks, fake runner); docs suite below. Package versions remain 0.0.8 until Task 8.

- [x] 4. Compose durable coding plans, checkpoints, background branches, diagnostics, and restart/resume from existing workflow primitives
  - Acceptance Criteria:
    - Functional: reference coding workflow persists an executable plan/todo Markdown artifact in the workspace, current branch/worktree/artifact hashes, named-check summaries, approvals, and task status through existing workflow checkpoints; restart imports the exact bounded workspace artifact and resumes once under current ownership/policy/revision.
    - Functional: foreground and background runs use existing `runWorkflow`/`startWorkflowBackground`/coordinator/lease/cancel APIs; cancellation closes browser/sandbox/processes, stale workers cannot export/commit after lease loss, and completed work produces the Task 3 PR handoff for host action.
    - Performance: plan/todo file, checkpoint metadata, workspace exports, revisions, check summaries, retries, concurrent background runs/worktrees, and retained artifacts have finite caps; checkpoints store references/hashes/summaries rather than repository contents or command output.
    - Code Quality: no `CodingRun`, todo database, scheduler, approval engine, persistence schema, or persona runtime is added; use workflow state/checkpoints/events/leases and ordinary workspace files. Add a package helper only if Task 0 proves the same safe composition cannot be expressed once in the example/docs.
    - Security: resume revalidates exact ownership, workflow revision, image/tool/policy fingerprints, artifact hash/size, workspace root, branch base, and current approvals; persisted records exclude credentials/browser storage/raw command output and stale or foreign resumes fail before import/execution.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/agent-session-runtime.md`, `docs/guardrails.md`, `docs/runs-and-usage.md`, `docs/coding-security.md`, and existing workflow background/suspend/replay examples.
      - `packages/workflows/src/{run,coordinator,checkpoints,status,types}.ts`, core `agent-run-state.ts`, `CheckpointStore`, `LeaseStore`, and `ResourceLoader`/artifact references.
    - Options Considered:
      - New durable coding-task engine/store: duplicates workflows/checkpoints/leases; rejected.
      - Process-local plan/todo object: cannot survive restart and creates hidden state; rejected.
      - Plan/todos as bounded workspace files plus workflow checkpoint metadata and host-owned workspace artifacts: chosen.
    - Chosen Approach:
      - Add one compile-checked/runnable network-free example and evaluation fixture that defines plan → isolated branch/workspace → edit/check → review/approval → handoff nodes using existing public APIs.
      - Export workspace state after committed workflow transitions; checkpoint only immutable artifact URI/hash/bytes and summaries. On resume, verify before import and re-run current policy/checks.
      - Reuse workflow progress/events for diagnostics/hooks. Host middleware/event subscribers may observe stages; no package-specific hook registry.
      - If repeated glue exceeds a small example after implementation, add the minimum package-local helper for checkpoint metadata validation only; do not add a new runtime facade.
    - API Notes and Examples:
      ```ts
      const run = await startWorkflowBackground(codingWorkflow, { task, baseBranch }, {
        checkpoints,
        leases,
        ownership,
        state: { maxBytes: 64 * 1024 },
      });
      // Workspace plan lives at plans/<task>.md; checkpoint stores artifact URI + SHA-256 only.
      ```
    - Files to Create/Edit:
      - `examples/durable-coding-workflow.ts` (new), `examples/README.md`.
      - `packages/coding-agent/src/coding-checkpoint.ts` and tests only if Task 0/example proof requires a reusable bounded metadata validator; otherwise none.
      - Workflow/coding tests for lease-fenced export/cleanup only where existing public behavior needs a shared fix.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/workflows.md`, `docs/evaluations.md`, `docs/host-security.md`, `docs/performance.md`, `docs/index.md`.
    - References:
      - Workflow checkpoint values already support bounded shared state/history and exact-owner/revision/CAS resume.
      - `create-plan`-style plan documents are ordinary workspace artifacts; Prism runtime need not understand plan prose.
  - Test Cases to Write:
    - Restart matrix: stop after plan/edit/check/approval, reload checkpoint, verify artifact, resume exactly once, changed definition/image/policy/artifact/owner rejection, and no credential persistence.
    - Background matrix: two workers/lease takeover, stale export fence, concurrent branches/worktrees, cancel during command/browser/export, orphan cleanup, deterministic PR handoff.
    - Rollback matrix: failed patch/check/approval leaves source/base unchanged and either restores or discards disposable workspace; successful resume retains exact prior edits/todos.
    - Example/eval matrix: network-free mock coding task completes, updates plan/todos, runs named checks, emits bounded diagnostics, and produces handoff; curated regression threshold fails on unsafe shell/Git/browser choices.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; supported durable coding composition, artifacts, and operational lifecycle become documented behavior; a helper may be public only if primitive review proves it necessary.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/workflows.md`, `docs/evaluations.md`, `docs/host-security.md`, `docs/performance.md`.
    - `docs/index.md` update: yes; update Coding-agent workflow, Workflow, Evaluations, Security, and Performance navigation descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Added package-local bounded helpers in `packages/coding-agent/src/coding-checkpoint.ts` (no second runtime): `writeCodingPlanFile` / `readCodingPlanFile` / `createCodingPlanMarkdown` / `parseCodingPlanTodos`, `buildCodingCheckpointMetadata` / `validateCodingCheckpointMetadata` / `assertCodingResumeAllowed`, `fingerprintJson`, `CODING_STATE_KEY`. Checkpoint metadata stores only URI/hash/bytes, branch/worktree refs, check summaries, and fingerprints — credentials, storage state, and raw command output are rejected.
    - Finite plan/todo/artifact/checkpoint limits published (`DEFAULT_*` / `HARD_*`) matching Phase 4 review-coverage. Resume revalidates workspace root, base branch, plan/workspace artifact hash+size, and workflow/tool/policy/image fingerprints before import.
    - Network-free example `examples/durable-coding-workflow.ts`: plan → branch/worktree → edit → named-check summary → approval suspend → restart reload/verify → exact-once resume → host-owned PR handoff; background `startWorkflowBackground` + cancel + coordinator poll. Events reused for diagnostics; no CodingRun/todo DB/scheduler/approval engine.
    - Docs/README/changelog/index/migration/performance/host-security/evaluations/workflows updated; examples README + tsconfig path for coding-agent.
    - Verification: coding-agent 172/172 pass (7 new checkpoint tests); `node examples/durable-coding-workflow.ts` succeeded with `status=succeeded`, `planTodosDone=true`, background `cancelStatus=aborted`; docs suite 85/85; examples typecheck clean. Package versions remain 0.0.8 until Task 8.

- [x] 5. Create optional `@arnilo/prism-browser` with run-owned Playwright contexts, snapshots, ordered actions, and cleanup
  - Acceptance Criteria:
    - Functional: package exports exactly four model-facing tools—`browser_open`, `browser_snapshot`, `browser_act`, `browser_close`—over an explicitly supplied Playwright `Browser`; it creates one non-persistent `BrowserContext` per run, tracks finite pages, and closes context/pages/listeners/artifacts on close, abort, run terminal, adapter disposal, or browser crash.
    - Functional: snapshot returns URL/title plus bounded Playwright accessibility YAML using `ariaSnapshot({ mode: "ai" })`; refs are snapshot-scoped and stale after page change. Actions support navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog and page/popup selection through refs or role/label/test-id targets; raw CSS is absent from production defaults.
    - Functional: every browser tool is statically exclusive and an internal per-run queue preserves stateful order across direct/concurrent dispatch; wrong-run/page/ref, stale snapshot, ambiguous locator, and closed/crashed context fail with stable bounded errors and no fallback action.
    - Performance: contexts/pages/refs/snapshot depth+bytes/actions/action input/navigation+action timeout/queued actions/popups/listeners and total run wall time have finite defaults/hard caps; snapshots/actions retain no unbounded DOM, console, request, response, or trace history.
    - Code Quality: use documented Playwright Browser/BrowserContext/Page/Locator APIs, existing `ToolDefinition`, `ExecutionPolicy`, guardrails, `ImageContent`, and run identity; no browser planner, generic MCP proxy, custom DOM engine, test runner, persistent service, or browser API enters core.
    - Security: browser/package import is inert; browser installation/launch/version/endpoint is host-owned and pinned; no `page.evaluate`, init-script, CDP/devtools, extension, persistent profile, local browser data, arbitrary locator code, or model-supplied Playwright option is exposed.
  - Approach:
    - Documentation Reviewed:
      - Context7 `/microsoft/playwright/v1.61.0` and official `Browser.newContext()`/`BrowserContext.close()` isolation guidance: <https://playwright.dev/docs/api/class-browsercontext>.
      - Locator preference/strictness (`getByRole`, `getByLabel`, user-facing targets before CSS): <https://playwright.dev/docs/locators>.
      - `locator.ariaSnapshot({ mode: "ai", depth, boxes, timeout })` and ARIA snapshot format: <https://playwright.dev/docs/api/class-locator> and <https://playwright.dev/docs/aria-snapshots>.
      - Playwright agent snapshot ref lifecycle and interaction semantics used as behavior reference, not as an MCP dependency: <https://playwright.dev/mcp/snapshots> and <https://playwright.dev/mcp/tools/interaction>.
      - Current Prism tool dispatch/exclusive behavior, execution policy, guardrails, image content, and durable run IDs.
    - Options Considered:
      - Expose Playwright Page/Locator/evaluate or official generic MCP server: broad bypass of policy/schema and unsupported cleanup ownership; rejected.
      - Reimplement browser automation/protocol: rejected.
      - Four narrow tools over host-supplied Playwright with package-owned run/context/action lifecycle: chosen.
    - Chosen Approach:
      - Pin a tested Playwright compatibility range at implementation; use `playwright-core` as an optional peer/type/runtime boundary so no browser binary downloads through Prism package install. Fake API conformance remains default; protected test uses a host-pinned browser/image.
      - Use Playwright AI-mode ARIA snapshots. Task 0 must verify a documented way to resolve refs for direct API actions; if public ref resolution is unavailable, maintain a bounded package-owned ref→Locator table while producing the snapshot and invalidate it on every page mutation/navigation—never rely on undocumented selectors.
      - Model `browser_act` as a discriminated action union and map each action to one documented Locator/Page method. Observation/side-effect policy runs immediately before action.
      - Expose manager `closeRun(runId)`/`close()` host lifecycle helpers in addition to model-facing `browser_close`; no context survives terminal cleanup.
    - API Notes and Examples:
      ```ts
      const browserTools = createBrowserTools({
        browser,
        executionPolicy,
        limits: { maxPages: 4, maxActions: 100, maxSnapshotBytes: 256 * 1024 },
      });
      // browser_snapshot {}
      // browser_act { action: "click", target: { ref: "e12" }, snapshotId: "..." }
      ```
    - Files to Create/Edit:
      - `packages/browser/package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`, `LICENSE` (new optional package).
      - `packages/browser/src/{index,types,limits,manager,snapshot,targets,tools,errors}.ts` and `src/__tests__/*` (new; exact split tentative).
      - Root `package.json`, `package-lock.json`, `src/__tests__/packaging.test.ts`, `install-smoke.test.ts`, `docs.test.ts`, public/package/release tests, and selected profile manifests after footprint review.
      - `docs/browser-automation.md` (new), `docs/tools.md`, `docs/guardrails.md`, `docs/host-security.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Browser tools stay separate from `@arnilo/prism-web-tools`; search/fetch remains cheapest path and browser is selected only for interactive/authenticated/JavaScript-heavy work.
  - Test Cases to Write:
    - Lifecycle matrix: one context per run, two-run cookie/storage isolation, page/popup cap, ordered concurrent actions, terminal/abort/crash/close cleanup, duplicate close, no persistent profile/browser close ownership confusion.
    - Snapshot/target matrix: AI snapshot depth/byte/ref caps, snapshot ID/stale ref, role/label/test-id strictness, ambiguous/missing target, iframe/page selection, hostile accessible text/control characters, no raw CSS/evaluate fallback.
    - Action matrix: open/navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog, timeout/abort, popup creation, side-effect policy allow/deny/modify/approval, and guardrail coverage.
    - Packaging matrix: import causes no browser launch/download/network; missing/incompatible peer fails clearly only when constructed; no Playwright/browser binary enters core or unrelated profiles.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package, tool schemas, lifecycle helpers, target/ref semantics, limits, and errors.
    - Docs pages to create/edit:
      - `docs/browser-automation.md`: all four APIs using required API-page structure, compatibility, lifecycle, targets, limits, security, and examples.
      - `docs/tools.md`, `docs/guardrails.md`, `docs/host-security.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Tools → Browser automation and update Guardrails, Security, Performance, Release, and Migration descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - New optional package `@arnilo/prism-browser` (`packages/browser`) with `createBrowserTools()` / `createBrowserManager()` over a host-supplied Playwright `Browser`. Import is inert; `playwright-core@1.61.0` is an optional peer (structural types + host Browser instance; no binary download).
    - Exactly four exclusive model tools: `browser_open`, `browser_snapshot`, `browser_act`, `browser_close`. One non-persistent `BrowserContext` per run (`serviceWorkers: "block"`, `acceptDownloads: false`); host helpers `closeRun(runId)` / `close()` dispose contexts without closing the host Browser.
    - Snapshots use `ariaSnapshot({ mode: "ai" })` with bounded depth/bytes/refs; refs are snapshot-scoped and resolved via Playwright `aria-ref=` plus a package-owned staleness table. Targets: ref, role(+name), label, testId, text — CSS/XPath/evaluate rejected.
    - Actions: navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog/select_page with per-run serial queue, finite page/action/queue/popup/dialog/timeout caps matching Phase 4 review-coverage, http(s)-only navigation without userinfo, and `ExecutionPolicy` checks before side effects.
    - Workspace wiring: root workspaces + packaging/install-smoke lists (32 packages); `@arnilo/prism-all` hard-depends on browser; packaging peer guard allows optional non-core peers while keeping `@arnilo/prism` required.
    - Docs: `docs/browser-automation.md` (API page), index/tools/guardrails/host-security/performance/migration/release-and-install updates; package README/CHANGELOG/LICENSE.
    - Verification: browser 14/14 pass (1 protected Playwright skip gated by `PRISM_LIVE_PLAYWRIGHT=1`); packaging 164/164; docs 85/85; `git diff --check` clean. Network/upload/download/screenshot/shared-sandbox policy deferred to Task 6; real Playwright adversarial gate deferred to Task 7. Versions remain 0.0.8 until Task 8.

- [x] 6. Enforce browser egress, side-effect, upload/download, screenshot, popup, and shared-sandbox policy
  - Acceptance Criteria:
    - Functional: browser policy distinguishes observation from mutation/high-impact actions; navigation, click, form input/select/check, dialog acceptance, upload, download release, and popup switching invoke current `ExecutionPolicy`/approval with run/page/origin/action/resource metadata before side effects.
    - Functional: context routing checks every HTTP(S)/WebSocket request and redirect against host policy, blocks service workers when routing is required, rejects file/data/blob-local misuse/devtools/private/local destinations by default, and supports real browser use only through a host-controlled egress proxy/firewall; browser and coding processes can share the Task 1 sandbox lifecycle.
    - Functional: screenshots are bounded `ImageContent`; uploads are realpath-contained approved workspace files; downloads stream into a size/count-bounded quarantine, receive hash/MIME/name metadata, and require host approval before export. Popups/dialogs have finite deterministic handling and never freeze action queues.
    - Performance: network requests/redirects/WebSockets/pages/popups/dialogs/uploads/downloads/download bytes/screenshot pixels+bytes/action retries/timeouts/artifact retention and cleanup waits are finite; streams fail and abort before exceeding retained-byte limits.
    - Code Quality: use Playwright context routing, `serviceWorkers: "block"`, locator actions, download streams, screenshot buffers, existing path containment/image/resource/policy/redaction/sandbox artifacts; no in-package proxy/firewall, antivirus, OCR, visual planner, or coordinate-click subsystem.
    - Security: Playwright routing is documented as defense in depth; production DNS rebinding/host/private egress is enforced by isolated network/proxy/firewall. Secrets/storage state never enter snapshots/results/logs/checkpoints; credentials are host-injected at context/request edge only; upload/download/screenshot/prompt-injection/process escape tests fail closed.
  - Approach:
    - Documentation Reviewed:
      - Playwright context routing and service-worker interception caveat: <https://playwright.dev/docs/network> and <https://playwright.dev/docs/api/class-browsercontext#browser-context-route>.
      - Playwright downloads, uploads/input, screenshots, popups/context pages, dialogs, and context close APIs: <https://playwright.dev/docs/downloads>, <https://playwright.dev/docs/input>, and BrowserContext/Page/Download API pages at v1.61.0.
      - Docker network default/none and host-owned network boundary from Task 1 docs; Prism SSRF/media/web-tool policies, path containment, `ImageContent`, `ResourceLoader`, guardrails, execution policy, and redaction.
    - Options Considered:
      - Trust `BrowserContext.route()` for DNS containment: it sees URLs, not a complete kernel egress/DNS-rebinding boundary; rejected.
      - Bundle a proxy/firewall/antivirus/browser image: operational product scope and supply-chain burden; rejected.
      - Require host network containment, add package routing/policy as defense in depth, and keep artifacts quarantined: chosen.
    - Chosen Approach:
      - Default sandbox network to none. For enabled browsing require explicit proxy endpoint plus host attestation/callback for an isolated network; startup negative checks verify direct egress/private targets fail. Browser context routes still validate every visible request and block unsupported schemes.
      - Map browser actions to `ExecutionAction { kind: "browser", operation, paths?, risk, metadata }`; deny high-impact actions without host approval. Treat page text/snapshots as untrusted external content that cannot alter tools/policies.
      - Stream downloads with byte counting and SHA-256 into sandbox quarantine; expose metadata/reference, not arbitrary host path. Use existing bounded image content for screenshots and approved workspace paths for upload.
      - Start/connect the host-pinned Playwright browser inside the same Docker sandbox for the reference integration; loopback control endpoint is random, host-only, short-lived, never model-visible, and closed with sandbox. Stronger remote adapters remain host replaceable.
    - API Notes and Examples:
      ```ts
      const tools = createBrowserTools({
        browser,
        executionPolicy,
        networkPolicy: { validateUrl, requireContainedProxy: true },
        uploads: { roots: ["/workspace"], maxBytes: 16 * 1024 * 1024 },
        downloads: { quarantine: "/downloads", maxBytes: 32 * 1024 * 1024 },
      });
      ```
    - Files to Create/Edit:
      - `packages/browser/src/{network,policy,artifacts,downloads,uploads,screenshot,dialogs}.ts`, tools/manager/limits, and focused tests (new; exact split tentative).
      - `packages/coding-security/src/docker-sandbox.ts`: only minimal shared browser process/control-port lifecycle proven by Task 0; no Playwright dependency.
      - Local hostile browser fixture server under `packages/browser/src/__tests__/fixtures` or generated in test code; fixtures never ship.
      - `packages/browser/README.md`, `CHANGELOG.md`; coding-security docs/changelog if integration API changes.
      - `docs/browser-automation.md`, `docs/coding-security.md`, `docs/web-tools.md`, `docs/guardrails.md`, `docs/host-security.md`, `docs/performance.md`, `docs/index.md`.
    - References:
      - `@arnilo/prism-web-tools` marks remote content untrusted and remains preferred for noninteractive retrieval.
      - Browser storage state is credential material; host may inject it but Prism does not persist or return it.
  - Test Cases to Write:
    - Egress matrix: HTTP/HTTPS/WebSocket, redirects, private/loopback/link-local/file/devtools/data/blob, mixed/rebound DNS through protected proxy fixture, service worker, popup first request, iframe, and direct-socket bypass attempt.
    - Side-effect matrix: observation allowed, click/form/dialog/upload/download export approval denied/allowed/changed policy, prompt-injection text cannot grant approval or change origin/tool/credentials.
    - Artifact matrix: screenshot dimensions/bytes/abort, upload symlink/root/size/MIME, download traversal/name/control chars/stream overflow/hash/quarantine/approval/export/cleanup, secret and cookie canaries absent.
    - Shared-boundary matrix: browser and coding see only sandbox workspace; browser process cannot read source/host files or Docker socket, cannot outlive sandbox, and resource/process limits include browser children.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; browser policy, network, artifact, approval, and shared-sandbox configuration are public behavior.
    - Docs pages to create/edit:
      - `docs/browser-automation.md`: egress/approval/artifact inputs, outputs, examples, limits, unsupported schemes, and containment claims.
      - `docs/coding-security.md`, `docs/web-tools.md`, `docs/guardrails.md`, `docs/host-security.md`, `docs/performance.md`.
    - `docs/index.md` update: yes; update Browser automation, Coding security, Web tools, Guardrails, Security, and Performance descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Added `packages/browser/src/{network,policy,uploads,downloads,screenshot,shared-sandbox}.ts` and wired them into manager/tools/limits. Contexts always use `serviceWorkers: "block"` + `BrowserContext.route()`; external egress defaults to `requireContainedProxy: true` with host `containedProxyAttestation`; private/loopback/link-local and `file`/`data`/`blob`/`javascript`/`devtools` schemes fail closed. Playwright routing documented as defense in depth only.
    - Side-effect classification maps observation vs mutation/high-impact for `ExecutionPolicy` / `beforeSideEffect` with run/page/origin/action/resource metadata. New `browser_act` actions: `upload`, `screenshot`, `download_release`. Uploads are realpath-contained under `uploads.roots` (symlink escapes rejected). Downloads stream into bounded quarantine with SHA-256/MIME/name metadata and require host `approveRelease`. Screenshots return bounded `ImageContent` with megapixel/byte caps. Popups/dialogs retain finite caps and download quarantine never freezes the action queue.
    - Shared sandbox: `createSharedSandboxBrowserOptions()` aligns `/workspace` uploads and `/downloads` quarantine; `@arnilo/prism-coding-security` `assertBrowserSandboxNetwork()` / `DockerNetworkConfig.browserEgress` fails closed for custom networks without proxy attestation (no Playwright dependency in coding-security).
    - Docs/README/CHANGELOG updated (`browser-automation`, coding-security, web-tools, guardrails, host-security, performance, migration, index).
    - Verification: browser 27/27 pass (1 protected Playwright skip gated by `PRISM_LIVE_PLAYWRIGHT=1`); coding-security 24 pass / 1 protected Docker skip; docs 85/85; network-free live-gate guard pass; `git diff --check` clean. Real DNS-rebinding/proxy adversarial matrix deferred to Task 7. Versions remain 0.0.8 until Task 8.

- [x] 7. Add adversarial coding/browser evaluations, reproducible benchmarks, and protected Docker/Playwright gates
  - Acceptance Criteria:
    - Functional: deterministic datasets grade repository/Git/check/rollback/plan/handoff selection and browser snapshot/target/approval/artifact behavior; optional SWE-bench-compatible and live-browser harnesses remain explicit adapters/gates, not default dependencies or claims.
    - Functional: protected tests run the real Docker sandbox and pinned Playwright browser/image against disposable repositories and local hostile web fixtures; missing gate/image/browser/daemon skips safely and visibly, while enabled misconfiguration fails closed.
    - Performance: reproducible 0.0.9 benchmark emits repository list/search/Git, sandbox startup/exec/export/cleanup, browser open/snapshot/action/close, memory/disk/process counts, p50/p95/throughput, and backpressure/resource-limit fields; no hardware/provider timing becomes a flaky default CI threshold.
    - Code Quality: reuse `@arnilo/prism-evals`, fake executable/browser adapters, Node test runner, current security/live workflow patterns, and one benchmark script; no benchmark framework, browser test runner, SWE-bench checkout, Docker image build, or public internet enters `sdk:ready`.
    - Security: fixtures cover filesystem/process/network/browser/secret/prompt-injection escapes; protected jobs receive no provider/npm/OIDC secrets, use pinned images/digests and finite job/step/artifact limits, and upload only redacted aggregate evidence.
  - Approach:
    - Documentation Reviewed:
      - `docs/evaluations.md`, `docs/performance.md`, `docs/release-and-install.md`, `.github/workflows/{security,live-canaries,release}.yml`, `scripts/benchmark-0.0.8.mjs`, and current fake/live test guard patterns.
      - GitHub Actions service-container/job timeout and artifact guidance already frozen in Plan 070; Docker/Playwright docs pinned in Task 0.
    - Options Considered:
      - Put Docker/browser/public-network tests in default suite: nondeterministic and unavailable on many consumers/runners; rejected.
      - Claim SWE-bench quality from a small local fixture: misleading; rejected.
      - Network-free fake/adversarial correctness by default plus protected real containment/browser matrix and dated benchmarks: chosen.
    - Chosen Approach:
      - Add curated immutable eval datasets and deterministic scorers for safe tool routing, rollback integrity, check/handoff completeness, ref freshness, approval, and artifact quarantine.
      - Extend protected live workflow or add one narrowly permissioned sandbox-browser workflow only if separation clarifies runner prerequisites. Use a host-preloaded digest-pinned image; Prism never pulls/builds it during default tests.
      - Benchmark public shipped APIs with local fixtures. Publish actual environment and distinguish fake/in-process, real local Docker, and protected browser results.
    - API Notes and Examples:
      ```bash
      node scripts/benchmark-0.0.9.mjs
      PRISM_TEST_DOCKER_SANDBOX=1 PRISM_LIVE_PLAYWRIGHT=1 npm run test:live -w @arnilo/prism-browser
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/__tests__/eval-fixtures.test.ts`, `packages/browser/src/__tests__/eval-fixtures.test.ts` or package-local dataset files (new).
      - `examples/coding-browser-evaluation.ts` (new only if one example can cover both without duplication), `examples/README.md`.
      - `scripts/benchmark-0.0.9.mjs` (new) and focused schema/bounds tests.
      - `.github/workflows/live-canaries.yml` or `.github/workflows/sandbox-browser.yml` (new only if required): protected real Docker/Playwright gate.
      - `docs/evaluations.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/host-security.md`, `docs/index.md`.
    - References:
      - Existing eval thresholds and serialized reports are bounded; reuse them rather than adding a coding benchmark service.
  - Test Cases to Write:
    - Eval matrix: safe native tool vs shell, Git argument/path injection, dirty-tree rollback, failed check, stale handoff, browser stale ref, side-effect approval, private target, upload/download/screenshot policy, and prompt-injection fixture.
    - Benchmark schema matrix: every scenario emits required fields, iteration/cap inputs validate, failures are attributable, temporary repositories/containers/browser contexts/artifacts always clean up.
    - Protected matrix: gate disabled no Docker/browser/network; enabled missing prerequisites fails; pinned real run exercises containment, process/disk limits, browser isolation/egress/cleanup with redacted report.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; supported evaluation harness, performance evidence, and protected release prerequisites change.
    - Docs pages to create/edit:
      - `docs/evaluations.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; update Evaluations, Performance, Release, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Implementation notes:
    - Network-free coding eval fixtures in `packages/coding-agent/src/__tests__/eval-fixtures.test.ts` (6 scenarios via `@arnilo/prism-evals`).
    - Network-free browser eval fixtures in `packages/browser/src/__tests__/eval-fixtures.test.ts` (6 scenarios with FakeBrowser).
    - Protected Playwright matrix filled in `packages/browser/src/__tests__/live.test.ts` (loopback hostile HTML fixture; gate `PRISM_LIVE_PLAYWRIGHT` / `PRISM_TEST_PLAYWRIGHT`).
    - Protected Docker matrix expanded for non-root, workspace write, env non-inheritance, digest pin, idempotent close.
    - `scripts/benchmark-0.0.9.mjs` + `scripts/benchmark-0.0.9.test.mjs`; optional `PRISM_BENCH_DOCKER` / `PRISM_BENCH_PLAYWRIGHT`.
    - `.github/workflows/sandbox-browser.yml` scheduled/manual protected environment; no provider secrets; variable-gated Docker/Playwright; redacted aggregate artifact.
    - Example `examples/coding-browser-evaluation.ts`; docs updated across evaluations/performance/release/host-security/browser-automation/index.
  - Verification:
    - coding-agent 174/174; browser 29/29 default (live suite skipped); coding-security 24 pass / 1 Docker skip default.
    - `PRISM_LIVE_PLAYWRIGHT=1 npm run test:live -w @arnilo/prism-browser` → 3/3 pass.
    - `PRISM_TEST_DOCKER_SANDBOX=1` with digest-pinned local image → protected Docker pass.
    - `PRISM_BENCH_ITERATIONS=10 node --test scripts/benchmark-0.0.9.test.mjs` → 2/2 pass.
    - `node examples/coding-browser-evaluation.ts` → mean 1 / scored 3.
    - Versions remain 0.0.8 until Task 8.

- [x] 8. Finalize coding/browser docs, package graph, 0.0.9 versions, and release-candidate evidence
  - Acceptance Criteria:
    - Functional: docs/READMEs/changelogs/examples describe only implemented coding/browser behavior, exact limits, unsupported paths, host responsibilities, migration, and Office exclusion; every public export/tool/package/page is indexed and package/profile/install smoke resolves the exact 0.0.9 graph.
    - Functional: root and every publishable manifest/internal range/lock record/release test target 0.0.9; `@arnilo/prism-browser` membership follows Task 0 footprint decision, activation stays explicit, and no Office package/dependency/docs/release check exists.
    - Performance: dated benchmark evidence includes real retained local/protected results and preserves network-free/default CI budgets; package/tarball/install footprint and browser peer/image exclusions are measured.
    - Code Quality: `npm run sdk:ready`, Node 20/current compatibility, packed offline consumer, docs/export/package/install guards, coding/browser focused suites, audit/SBOM/license/secret/tarball checks, and `git diff --check` pass from release-candidate tree.
    - Security: protected Docker/Playwright adversarial gates pass with pinned host inputs or remain explicit P0 operator prerequisites; tarballs contain no tests/maps/source/secrets/browser binary/container image/Office binary; no commit/tag/publish occurs without operator authorization.
  - Approach:
    - Documentation Reviewed:
      - Every page/README/changelog/example changed by Tasks 0–7; `.agents/skills/create-plan/references/prism-wiki.md`; `docs/release-and-install.md`; current package/install/docs/release/supply-chain tests; roadmap global release gate.
    - Options Considered:
      - Publish after focused feature tests: misses profile, consumer, artifact, Node compatibility, supply-chain, and real containment evidence; rejected.
      - Add browser/Office capabilities to all profiles: unnecessary installation/capability expansion; Office rejected entirely and browser membership must follow measured profile review.
      - Deterministic offline gate plus separate protected real sandbox/browser gate and operator publication: chosen.
    - Chosen Approach:
      - Complete docs and migration from actual exports/results, update all package graph guards data-first, run focused then complete gates, and append exact command/result/skip evidence to this plan.
      - Mark roadmap Phase 4 complete only after retained coding/browser criteria and revised release gate pass; Office remains explicitly outside Prism packaging.
      - Version all publishable packages together to preserve current exact-range 0.x release policy, then stop before signed commit/tag/publication.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      npm run release:check -- --version 0.0.9
      npm run release:publish -- --version 0.0.9 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Root and every publishable `package.json`, `package-lock.json`, package `README.md`/`CHANGELOG.md`, selected profiles, release/package/install/export/docs/supply-chain tests, and release workflows/scripts required by Tasks 1–7.
      - `packages/browser/**`, coding-agent/security metadata/docs, examples, eval fixtures, benchmark, and protected workflow.
      - `docs/index.md`, `docs/browser-automation.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/tools.md`, `docs/workflows.md`, `docs/guardrails.md`, `docs/evaluations.md`, `docs/web-tools.md`, `docs/host-security.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/migration.md`, and Phase 4 review coverage.
      - `roadmap.md`: mark revised Phase 4 complete and record only actual evidence.
      - `plans/072-release-0-0-9-production-coding-and-browser-execution.md`: completion evidence, compromises, and further actions.
    - References:
      - Roadmap global release gate: SDK readiness, Node compatibility, packed install, audit, relevant live suites, secret scan, tarball review, and `git diff --check`.
      - Current package graph is 31 publishable packages at 0.0.8; Task 5 adds at most one package.
  - Test Cases to Write:
    - Full deterministic matrix: build/typecheck/default tests/docs/export/package/install smoke/all packs/benchmark schema/audit/SBOM/license/secret scan/`git diff --check`.
    - Node/consumer matrix: Node 20/current public imports, fresh offline tarball install, coding profile composition, optional browser import without launch/download, browser construction only with compatible host peer.
    - Real matrix: protected Docker sandbox and Playwright browser; local hostile fixture only unless host explicitly provisions egress; exact skips/prerequisites published when unavailable.
    - Release matrix: exact 0.0.9 graph/order/ranges, registry availability, provenance dry-run, tarball deny list/size/secret scan, no Office package/binary/dependency/page, no browser binary/image.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; complete 0.0.9 package graph, coding/browser APIs, production boundaries, release gates, and migration guidance are released behavior.
    - Docs pages to create/edit:
      - All Task 0–7 docs listed above; retain only implemented behavior and exact 0.0.9 compatibility/host requirements.
    - `docs/index.md` update: yes; verify exactly one functional navigation entry for every changed/new page under Tools, Agent/session runtime, Security, Evaluations, Performance, and Release.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-21):
    - Versioned root + all 31 workspaces (32 publishable manifests), exact internal peer/dependency ranges, lockfile records, runtime/MCP client+server version strings (`0.0.9`), release/package/install/docs guards, and every package changelog to `## [0.0.9] - 2026-07-21`.
    - Package graph: `@arnilo/prism-browser` remains in `@arnilo/prism-all` only (not `@arnilo/prism-code`); activation stays explicit via direct install or all-profile. No Office package/dependency/docs/release check exists.
    - Docs finalized: `docs/migration.md` 0.0.8→0.0.9 coding/browser sections, `docs/release-and-install.md` 0.0.9 publish handoff + RC verification, `docs/performance.md` dated benchmark table, `docs/index.md`/`docs/review-coverage-2026-07-20-phase-4.md`/`roadmap.md` Phase 4 marked complete.
    - `npm run sdk:ready` passed: 1,924 tests (1,895 pass, 29 explicit live skips, 0 fail) including docs/export/package/install smoke and 32 dry-run packs.
    - Supply chain: `npm audit --audit-level=high` 0 vulnerabilities; SPDX SBOM 185 packages / 8 licenses; source secret scan 2,402 files / 0 findings; unpacked tarball secret scan 847 files / 0 findings; `git diff --check` clean.
    - Artifacts: 969,334 packed bytes / 3,745,944 unpacked bytes / 847 files; core 516,734 / 1,811,153; browser 29,171 / 132,669; no Playwright binary/image and no Office binary in tarballs.
    - Dated benchmark evidence: Node v24.18.0 Linux x64, `PRISM_BENCH_ITERATIONS=100`, network-free fake/in-process rows for repo-list/repo-search/git-status/browser-open-snapshot-action-close published in `docs/performance.md`.
    - Registry: `release:check -- --version 0.0.9 --allow-dirty --allow-untagged` → all 32 available; `release:publish -- --version 0.0.9 --dry-run --allow-dirty --allow-untagged` → 32/32 dry-run public/latest/provenance. No commit/tag/publish created.
    - Protected Docker (`PRISM_TEST_DOCKER_SANDBOX=1`) and Playwright (`PRISM_LIVE_PLAYWRIGHT=1`) adversarial gates, Node 20 CI import, PostgreSQL/keychain, CodeQL/dependency-review, signed `v0.0.9`, OIDC attestations, and actual publication remain explicit P0 operator prerequisites.
    - **Superseded by Task 13:** coding/browser RC evidence above remains historical baseline; post–Synapta re-verify numbers and publication readiness live in Task 13 Completion Evidence / Release readiness.

- [x] 9. Freeze Synapta tool-call/empty-candidate defect evidence and shared-seam owners
  - Acceptance Criteria:
    - Functional: every acceptance criterion in `bug-reports/prism-tool-call-stream-failures-and-empty-candidate.md` Defects 1a, 1b, and 2 maps to exact source lines, one owning task, regression tests, and docs pages; the non-blocking `structuredOutput: "final_turn_only"` enhancement is explicitly deferred (not a 0.0.9 ship gate).
    - Performance: confirm fixes reuse existing turn/tool-round/revision/SSE byte caps and add no unbounded retry/buffer surface.
    - Code Quality: confirm each fix lands in the shared seam all callers route through (`parseJsonObjectArguments` / provider stream finalization, `reconstructToolCallDeltas` / agent generate reconstruction, `generateValidateReviseLoop` call-free candidate path), not per-provider one-offs except where a provider must stop throwing before the shared seam can recover.
    - Security: freeze that failed-tool-result recovery never executes the tool, never echoes raw malformed argument text beyond existing redaction bounds, and never promotes truncated streams to successful `done`.
  - Approach:
    - Documentation Reviewed:
      - `bug-reports/prism-tool-call-stream-failures-and-empty-candidate.md` (reported against `@arnilo/prism@0.0.8` / `@arnilo/prism-provider-opencode-go@0.0.8`; still applicable on the unpublished 0.0.9 tree).
      - Related fixed report pattern: plan 071 / prior OpenCode Go route+artifact fixes.
      - Current seams: `src/providers/transport.ts` (`parseJsonObjectArguments` → `ProviderTransportError("invalid_json_arguments")`), `src/provider-events.ts` (`reconstructToolCallDeltas` bare `Error("Incomplete tool call delta...")`), `src/agents.ts` (`reconstructMissingToolCalls` after provider stream), `src/agent-loops.ts` (`generateValidateReviseLoop` identity parser accepts `""`), provider callers of `parseJsonObjectArguments` (opencode-go openai/anthropic, openai-compatible, openai responses, kimi, neuralwatt, openrouter, zai, ai-sdk).
      - Docs: `docs/agent-loops.md`, `docs/structured-output.md`, `docs/agent-events.md`, `docs/tools.md`, `docs/migration.md`.
    - Options Considered:
      - Defer to 0.0.10: rejected; defects make otherwise-recoverable model behavior terminally fail or falsely succeed — high severity for any 0.0.9 consumer using tools/artifact loops (including coding/browser hosts).
      - Consumer-side try/catch around `session.run`: rejected; duplicates runtime recovery and cannot feed tool-result feedback into the turn.
      - Shared-seam recovery inside Prism + typed errors where recovery is impossible: chosen.
    - Chosen Approach:
      - Record defect → source → owner matrix as this task's completion evidence only; no behavior change here.
      - Confirmed source evidence (2026-07-21):
        - Defect 1a: provider stream finalizers call `parseJsonObjectArguments(...)` and throw `ProviderTransportError("invalid_json_arguments")` into the generate loop (`ProviderTurnFailure`), killing the run with no `ToolResult` feedback. Example: `packages/provider-opencode-go/src/anthropic-messages.ts` / `openai-chat.ts` final `providerToolCall(...)` assembly; same pattern in `src/providers/openai-compatible.ts` and other provider packages.
        - Defect 1b: `src/provider-events.ts reconstructToolCallDeltas` throws bare `Error("Incomplete tool call delta at index N")` when id/name are missing; reached from `src/agents.ts reconstructMissingToolCalls` after a stream that ended with deltas but no complete `tool_call` events. OpenCode Go already fails dangling calls via `providerError` before `done`, but core reconstruction and openai-compatible (which can `done` while skipping incomplete finals) still expose the bare-Error path.
        - Defect 2: `src/agent-loops.ts generateValidateReviseLoop` builds `text` from text blocks only (thinking ignored), then default-parses with `{ ok: true, value: text }` — empty/`""` is not a parse failure. `src/agents.ts` always returns `status: "succeeded"` when the loop returns without throwing, even if no `artifact_finished` event occurred. Thinking-only call-free candidates can therefore succeed with `result.text === ""` and zero artifact events when no custom parser rejects empty input.
        - Enhancement (deferred): structured output is applied per provider request whenever `options.structuredOutput` is set; no final-turn-only mode exists. Non-blocking for 0.0.9.
    - API Notes and Examples:
      ```text
      Defect 1a → Task 10 (failed ToolResult recovery at shared parse/reconstruct seam)
      Defect 1b → Task 11 (typed incomplete_delta + recovery/fail-closed policy)
      Defect 2  → Task 12 (empty candidate → parse_error + no success without artifact_finished)
      Enhancement → Further Actions P2 (final_turn_only structured output)
      Task 13 → re-verify 0.0.9 RC evidence
      ```
    - Files to Create/Edit:
      - `plans/072-release-0-0-9-production-coding-and-browser-execution.md`: append finalized evidence matrix.
    - References:
      - Plan 071 Task 0 evidence format; existing `tool_execution_blocked` / `invalid_arguments` blocked-result path in `src/tools.ts`.
  - Test Cases to Write:
    - Evidence check: every bug-report Defect 1a/1b/2 criterion maps to exactly one owning task; enhancement is marked deferred.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; evidence freeze only.
    - Docs pages to create/edit: none; later tasks own page changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Froze Prism revision `0d109989b4892e3fe4378ab782044ceadc460277` (unpublished 0.0.9 tree) against `bug-reports/prism-tool-call-stream-failures-and-empty-candidate.md` (reported on `@arnilo/prism@0.0.8` / `@arnilo/prism-provider-opencode-go@0.0.8`; defects still present).
    - Ownership matrix (every bug-report acceptance criterion → one owner):

      | Criterion | Exact source evidence | Owner | Planned regressions | Planned docs |
      | --- | --- | --- | --- | --- |
      | 1a — malformed streamed tool args become failed ToolResult (preferred) | `src/providers/transport.ts:268-298` `parseJsonObjectArguments` throws `ProviderTransportError("invalid_json_arguments")`; provider stream finalizers call it and kill the turn before any ToolResult: `src/providers/openai-compatible.ts:112-121`, `packages/provider-opencode-go/src/openai-chat.ts:76-83`, `packages/provider-opencode-go/src/anthropic-messages.ts:76-83`, `packages/provider-openai/src/responses.ts:150`, `packages/provider-kimi/src/provider.ts:136`, `packages/provider-kimi/src/moonshot.ts:168`, `packages/provider-openrouter/src/provider.ts:205`, `packages/provider-zai/src/provider.ts:149`, `packages/provider-neuralwatt/src/provider.ts:171`, `packages/provider-ai-sdk/src/stream.ts:119`. Delta-reconstruction path also throws bare `Error` via `src/provider-events.ts:74-82` `parseToolCallArguments`. Agent surface: `src/agents.ts:845` maps stream `error` → `ProviderTurnFailure`; `src/agents.ts:480` never returns a failed tool result for this path. Existing blocked mirror: `src/tools.ts:236` / `:240-250` (`invalid_arguments` / `tool_execution_blocked`). | Task 10 | `src/__tests__/provider-transport.test.ts`, `src/__tests__/provider-events.test.ts`, agent/loop mock-provider malformed-args cases; touched provider package stream tests | `docs/tools.md`, `docs/agent-loops.md`, `docs/migration.md` (+ provider page only if stream note required) |
      | 1a alt — typed catchable error if failed-result rejected | Same throw sites; `ProviderTransportError.code === "invalid_json_arguments"` already typed at transport, but becomes terminal run failure via `ProviderTurnFailure` / `AgentRunError` with no in-turn recovery. | Task 10 (failed ToolResult is primary; typed code retained underneath for logging/distinction) | same as 1a | same as 1a |
      | 1b — truncated tool-call deltas use typed channel, never bare `Error` | `src/provider-events.ts:41-54` `reconstructToolCallDeltas` throws `new Error("Incomplete tool call delta at index N")` when id/name missing; reached from `src/agents.ts:873` + `:1069-1073` `reconstructMissingToolCalls`. `src/providers/openai-compatible.ts:112-121` skips incomplete finals (`if (call.id && call.name)`) then still `yield providerDone()`, leaving deltas for bare-Error reconstruction. OpenCode Go defense-in-depth already fail-closes dangling calls: `openai-chat.ts:65-74`, `anthropic-messages.ts:66-74` (`providerError`, no `done`) — keep; core/openai-compatible still expose the bare-Error path. | Task 11 | `src/__tests__/provider-events.test.ts`, agent generate incomplete-delta cases, `src/testing/provider-conformance.ts`, openai-compatible + opencode-go dangling non-regression | `docs/migration.md`, `docs/provider-conformance.md`, provider stream notes as needed |
      | 2 — empty/thinking-only call-free candidate must not `succeeded` without artifact | `src/agent-loops.ts:142-148` builds candidate `text` from `type === "text"` only (thinking ignored); identity parser `{ ok: true, value: text }` accepts `""`; empty is not a parse failure (`:152-157` only trips on `!parsed.ok` or `parsed.value === undefined`). `src/agents.ts:461-480` always returns `status: "succeeded"` when `loop.run` returns without throwing — even with zero `artifact_finished` events. `src/agents.ts:1082-1096` `finalAssistantMessage` likewise joins text blocks only → `result.text === ""`. | Task 12 | `src/__tests__/agent-loops.test.ts` thinking-only / empty-candidate cases (extend existing parse_error coverage ~491/514) | `docs/agent-loops.md`, `docs/structured-output.md`, `docs/agent-events.md`, `docs/migration.md` |
      | Enhancement — `structuredOutput: "final_turn_only"` | `src/structured-output.ts:71-80` `resolveRunProviderOptions` attaches `structuredOutput` to every provider request whenever loop mode is not `artifact-loop`; `src/providers/openai-compatible.ts:142` / `openai-primitives.ts:48-59` apply `response_format` per request. No final-turn-only mode exists. | Deferred — Further Actions P2 (not a 0.0.9 ship gate) | none for 0.0.9 | none for 0.0.9 |
      | RC re-verify after fixes | Task 8 provisional coding/browser evidence retained | Task 13 | full `sdk:ready` + supply-chain + dry-run recheck | `docs/release-and-install.md`, `roadmap.md`, package CHANGELOGs |

    - Shared-seam owners (fixes land here, not per-provider one-offs except reachability):
      - Defect 1a shared seam: safe parse/reconstruct helper over `parseJsonObjectArguments` + `reconstructToolCallDeltas`/`parseToolCallArguments`, recovered in `RuntimeAgentSession` generate (`src/agents.ts`) into the existing `invalid_arguments` / failed-tool-result transcript path (`src/tools.ts`). Providers only stop throwing inside stream finalizers insofar as required to reach that seam.
      - Defect 1b shared seam: `reconstructToolCallDeltas` typed `incomplete_delta` (or reuse `incomplete_stream` when identity is missing); agent generate maps to `ProviderTurnFailure` with stable `ErrorInfo.code`. OpenCode Go dangling checks remain defense-in-depth; openai-compatible must not pair `done` with leftover incomplete deltas.
      - Defect 2 shared seam: `generateValidateReviseLoop` call-free candidate path — treat empty/`""` text as `parse_error` (same revision budget as other parse failures); never report run success without `artifact_finished` for this loop.
    - Performance freeze: fixes reuse existing caps only — `DEFAULT_MAX_ARGUMENT_BYTES` 262_144 / SSE `DEFAULT_MAX_EVENT_BYTES` 262_144 / `DEFAULT_MAX_BUFFER_BYTES` 524_288 (`src/providers/transport.ts:4-7`); run defaults/hard `maxTurns` 16/64, `maxToolRounds` 8/64 (`src/run-limits.ts:4-21`); artifact `maxRevisions` default 3 and provider-turn ceiling `1 + maxRevisions + maxToolRounds` (`src/agent-loops.ts`, docs). No new unbounded retry, buffer, or polling surface authorized.
    - Security freeze: failed-tool-result recovery must never call `tool.execute()`; error text stays on the existing redaction path (`SecretRedactor` / `errorToErrorInfo` / transport secrets); truncated streams must never be promoted to successful `done` (OpenCode Go already enforces; openai-compatible incomplete+`done` is a Task 11 correctness fix).
    - Explicitly deferred: Synapta `structuredOutput: "final_turn_only"` enhancement → Further Actions P2; not required for publication.
    - Evidence check passed: Defects 1a/1b/2 map 1:1 to Tasks 10/11/12; enhancement deferred; Task 13 owns RC re-verify. No runtime/public API change in this task.

- [x] 10. Convert malformed streamed tool-call arguments into failed tool results (Defect 1a)
  - Acceptance Criteria:
    - Functional: when a streamed tool call has id+name but arguments JSON is missing/invalid/non-object/oversize, the turn completes with a failed tool result (`error` set, tool not executed) for that call id/name; the model receives the result in-history and may continue within existing `maxToolRounds`/`maxTurns` budgets.
    - Functional: the failure is distinguishable from transport/HTTP failures (stable code such as `invalid_arguments` / `invalid_json_arguments`) and does not surface as an unhandled `ProviderTransportError` that fails the whole run.
    - Performance: recovery allocates at most one bounded error result per malformed call; no extra provider round-trip is invented by the runtime.
    - Code Quality: fix the shared parse/reconstruct → agent generate seam so every provider that ends a turn with tool calls benefits; avoid N divergent try/catch patches. Providers may stop throwing on parse only insofar as required to reach the shared recovery path.
    - Security: never execute the tool on malformed arguments; redact secrets from error text; do not re-emit unbounded raw argument payloads into events/history beyond existing tool-result redaction.
  - Approach:
    - Documentation Reviewed: bug report Defect 1a expected behavior; `docs/tools.md` blocked-result reasons; `src/tools.ts` `invalid_arguments` blocked path; provider `parseJsonObjectArguments` call sites listed in Task 9.
    - Options Considered:
      - Typed throw only (`ProviderToolCallError`): satisfies protocol purity but still kills the run unless every host catches/retries; rejected as primary fix (bug report preferred option 1).
      - Failed tool result mirroring execution errors: chosen; typed error remains available underneath for logging.
      - Per-provider catch at each `parseJsonObjectArguments` call site only: rejected as sole approach; easy to miss a provider and diverges behavior.
    - Chosen Approach:
      - Introduce a shared safe parse/reconstruct helper (or extend `reconstructToolCallDeltas` / transport parse) that yields either a complete `ToolCallContent` or a structured malformed-call record `{ id, name, code: "invalid_arguments", message }`.
      - In `RuntimeAgentSession` generate completion, convert malformed-call records into the same failed/`blocked` tool-result transcript path used for `invalid_arguments` (no `execute()`), then return them as calls/results so loops dispatch or append consistently without a second provider turn.
      - Update provider stream finalizers that currently throw inside the async generator so they emit deltas/finals the shared seam can recover, or catch parse failures and yield a recoverable signal — prefer one helper used by core openai-compatible + first-party providers.
    - API Notes and Examples:
      ```ts
      // malformed argumentsText "{invalid" with id+name present:
      // → tool_result { toolCallId, name, error: { message: "Invalid tool arguments JSON..." } }
      // → turn completes; generateValidateReviseLoop / singleShotLoop may continue within budget
      ```
    - Files to Create/Edit:
      - `src/providers/transport.ts`, `src/provider-events.ts`, `src/agents.ts`, optionally `src/tools.ts`: shared safe parse + failed-result recovery.
      - Provider stream finalizers as needed for shared-seam reachability: `src/providers/openai-compatible.ts`, `packages/provider-opencode-go/src/{openai-chat,anthropic-messages}.ts`, and other `parseJsonObjectArguments` callers if they still throw before recovery.
      - `src/__tests__/provider-transport.test.ts`, `src/__tests__/provider-events.test.ts`, agent/loop tests; provider package tests for non-throwing malformed-args paths.
      - `docs/tools.md`, `docs/agent-loops.md`, `docs/migration.md`, relevant provider docs if behavior is user-visible; package CHANGELOGs for core + touched providers.
    - References:
      - Existing `blocked(..., "invalid_arguments", ...)` in `src/tools.ts`; plan 071 artifact parse-repair precedent.
  - Test Cases to Write:
    - Mock provider emits tool_call_delta id+name then invalid argumentsText → run continues with failed tool result; tool `execute` never called; no run-level `ProviderTransportError`.
    - Oversize / non-object / empty-invalid JSON matrix produces stable bounded error text; secret canaries redacted.
    - `generateValidateReviseLoop` + `toolCalls: "bounded"` consumes a tool round (not a revision) and lets the model retry within `maxToolRounds`.
    - Valid tool-call JSON still executes normally (non-regression).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; malformed tool-call arguments become recoverable tool failures instead of terminal transport errors.
    - Docs pages to create/edit:
      - `docs/tools.md`, `docs/agent-loops.md`, `docs/migration.md`: recovery behavior and migration note from terminal failure → failed tool result.
      - Provider pages only if a provider-specific stream note is required.
    - `docs/index.md` update: no new page; verify Tools / Agent loops descriptions stay accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Shared seam: `tryParseJsonObjectArguments` (`src/providers/transport.ts`) + `toolCallFromArgumentsText` (`src/provider-events.ts`) build `ToolCallContent` with optional `argumentsError` (`src/contracts.ts`). `reconstructToolCallDeltas` uses the same helper for delta-only streams. `dispatchToolCall`/`checkCall` (`src/tools.ts`) blocks on `argumentsError` with reason `invalid_arguments` and never calls `execute()`.
    - All first-party stream finalizers switched off throwing `parseJsonObjectArguments`: `src/providers/openai-compatible.ts`, `packages/provider-opencode-go/src/{openai-chat,anthropic-messages}.ts`, `packages/provider-{openai,kimi,openrouter,zai,neuralwatt,ai-sdk}` (ai-sdk drops `invalid_tool_arguments` throw for client-executed calls).
    - Regressions: `malformed_streamed_tool_arguments_become_failed_tool_results` in `src/__tests__/agents.test.ts` (blocked result, `error.code === "invalid_json_arguments"`, `execute` never called, run `succeeded` after recovery); `toolCallFromArgumentsText` / reconstruct + `tryParseJsonObjectArguments` unit coverage; public export includes `toolCallFromArgumentsText`. Focused core + opencode-go + ai-sdk tests green.
    - Docs/changelogs: `docs/tools.md`, `docs/migration.md`; root + touched provider `CHANGELOG.md` Fixed notes. Typed-throw-only path kept underneath via `ProviderTransportError` / `argumentsError.code`.
    - Skipped at Task 10 time: incomplete id/name deltas (Task 11) — now Done.

- [x] 11. Type incomplete tool-call deltas and stop bare-Error termination (Defect 1b)
  - Acceptance Criteria:
    - Functional: incomplete tool-call deltas (missing id and/or name at stream end) never throw a bare `Error`; they surface a typed catchable error/info with stable code `incomplete_delta` (or reuse `incomplete_stream` where that already applies).
    - Functional: when enough identity exists to bind a tool result (id+name present but call otherwise incomplete), prefer the Task 10 failed-tool-result recovery path; when identity is missing, fail the provider turn with the typed code so hosts can distinguish model/gateway truncation from HTTP/transport breakage.
    - Functional: OpenCode Go dangling-tool/`providerError` behavior remains fail-closed (no successful `done` on truncation); core reconstruction must not regress that guarantee.
    - Performance: no added polling; reconstruction remains one linear pass over deltas.
    - Code Quality: replace `throw new Error("Incomplete tool call delta...")` in `reconstructToolCallDeltas` with the typed shared channel; update conformance helpers/tests.
    - Security: truncated streams still cannot produce a successful empty/partial tool execution; errors stay redacted/bounded.
  - Approach:
    - Documentation Reviewed: bug report Defect 1b; plan 071 incomplete-stream work; `src/provider-events.ts`, `src/agents.ts`, `src/testing/provider-conformance.ts`; OpenCode Go dangling checks in openai-chat/anthropic-messages.
    - Options Considered:
      - Always convert incomplete deltas into synthetic tool results with generated ids: rejected; forged ids break provider transcript correlation.
      - Typed terminal error only: acceptable when id/name absent; combine with Task 10 recovery when id+name exist: chosen.
    - Chosen Approach:
      - Extend transport/tool-call error typing (`ProviderTransportError` or a narrow `ProviderToolCallError`) with `incomplete_delta`.
      - `reconstructToolCallDeltas` returns complete calls + typed incomplete records, or throws only the typed error; agent generate maps typed incomplete to `ProviderTurnFailure` with stable `ErrorInfo.code`.
      - Keep provider-level completion evidence checks (OpenCode Go / Kimi) as defense in depth; fix openai-compatible so skipping incomplete finals cannot pair with `done` + leftover deltas that blow up reconstruction.
    - API Notes and Examples:
      ```ts
      // stream ends with tool_call_delta missing name:
      // → ProviderTurnFailure / ErrorInfo.code === "incomplete_delta" (or incomplete_stream)
      // → never Error("Incomplete tool call delta at index N")
      ```
    - Files to Create/Edit:
      - `src/provider-events.ts`, `src/providers/transport.ts`, `src/agents.ts`, `src/providers/openai-compatible.ts`.
      - `src/testing/provider-conformance.ts`, `src/__tests__/provider-events.test.ts`, agent generate tests.
      - `docs/agent-events.md` / provider transport notes as needed; `docs/migration.md`; CHANGELOGs.
    - References:
      - OpenCode Go dangling `providerError` paths; plan 071 Defect 3 incomplete-stream precedent.
  - Test Cases to Write:
    - Deltas missing id/name → typed `incomplete_delta` (or documented alias); assert `!(error instanceof Error && error.message.startsWith("Incomplete tool call delta"))` bare path is gone.
    - openai-compatible truncated tool stream does not yield successful run via reconstruct throw; stable code observed.
    - OpenCode Go dangling regression still ends on `error` without `done`.
    - Mixed complete+incomplete indexes: complete calls do not execute alongside an incomplete sibling that fails the turn (deterministic fail-closed ordering).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; error typing/codes and truncation failure shape change.
    - Docs pages to create/edit:
      - `docs/migration.md`: bare Error → typed incomplete code.
      - `docs/agent-loops.md` or provider docs: truncation vs malformed-args recovery distinction.
    - `docs/index.md` update: no new page unless a transport error-codes section is added.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Shared seam: `ProviderTransportErrorCode` adds `incomplete_delta`; `reconstructToolCallDeltas` throws `ProviderTransportError("incomplete_delta", ...)` instead of bare `Error`. `errorFromInfo` preserves `ErrorInfo.code` so run failures keep the stable code through retry rethrow.
    - openai-compatible finalizer fail-closed: incomplete id/name yields `providerError` with `incomplete_delta` and returns without `done` (`src/providers/openai-compatible.ts`). OpenCode Go dangling regressions still pass (error, no done).
    - Regressions: provider-events typed throw; agents `incomplete_tool_call_deltas_fail_turn_with_typed_incomplete_delta` + mixed complete/incomplete fail-closed (no execute); openai-compatible truncated incomplete stream test. Focused core + opencode-go + docs green.
    - Docs/changelogs: `docs/migration.md`, `docs/agent-events.md`, `docs/provider-primitives.md` code union; root `CHANGELOG.md` Fixed note.
    - Skipped (Task 12): empty thinking-only artifact success still open; other skip-then-done providers (openai responses / openrouter / zai / neuralwatt) rely on reconstruct typed throw (same as pre-fix delta leftover path).

- [x] 12. Reject empty call-free artifact candidates through the revision budget (Defect 2)
  - Acceptance Criteria:
    - Functional: for `generateValidateReviseLoop`, a call-free candidate whose assistant text is empty (including thinking-only / reasoning-only content with no text blocks, and whitespace-only text) is treated as artifact parse failure (`metadata.reason: "parse_error"`), emits `artifact_validation_*` then repair/fail events, and consumes revision budget exactly like any other parse failure.
    - Functional: a run using `generateValidateReviseLoop` must not resolve `AgentRunResult.status === "succeeded"` unless `artifact_finished` was emitted for that run (or the loop explicitly ended on terminal `artifact_failed` / throw paths that yield failed/aborted — never silent success with empty text).
    - Functional: non-empty text that fails the host parser still follows the existing 0.0.8 parse-repair path (non-regression).
    - Performance: empty rejection is O(1) before parser/validator; no extra provider call beyond existing repair turns.
    - Code Quality: enforce in `generateValidateReviseLoop` (and, if required, a narrow session-level assert when that loop was selected); do not add a second artifact runtime.
    - Security: repair messages stay bounded/redacted; empty/thinking content is never treated as a validated artifact.
  - Approach:
    - Documentation Reviewed: bug report Defect 2; `docs/agent-loops.md`, `docs/structured-output.md`, `docs/agent-events.md`; `src/agent-loops.ts` text extraction + identity parser; `src/agents.ts` success return after `loop.run`.
    - Options Considered:
      - Require every host to supply a parser that rejects `""`: rejected; default identity parser makes empty success too easy and contradicts artifact-loop semantics.
      - Treat empty/whitespace-only call-free text as synthetic parse failure + optional session guard requiring `artifact_finished` before success: chosen.
    - Chosen Approach:
      - Before invoking parser/validator, if call-free and `text.trim() === ""`, synthesize `{ ok: false, error: "artifact parse failed" | "no artifact text in model output" }` equivalent and route through the existing parse-failure budget path.
      - Track whether `artifact_finished` fired during the loop (loop-local flag or event observation) and refuse `status: "succeeded"` without it when the resolve loop is generate-validate-revise — map to failed run or ensure terminal `artifact_failed` already returned without success.
      - Add network-free regression: thinking-only mock provider + `maxRevisions >= 1` → `artifact_failed` reason `parse_error`, repairer invoked, no empty success.
    - API Notes and Examples:
      ```ts
      // provider turn: thinking delta only, then done
      // expected: artifact_validation_started → ... → artifact_revision_started* → artifact_failed
      //           (reason parse_error); status !== "succeeded" with text === ""
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`, possibly `src/agents.ts` success guard.
      - `src/__tests__/agent-loops.test.ts` (and session e2e coverage).
      - `docs/agent-loops.md`, `docs/structured-output.md`, `docs/agent-events.md`, `docs/migration.md`; core CHANGELOG.
    - References:
      - Plan 071 Defect 4 parse-repair fix; current `metadata.reason: "parse_error"` contract.
  - Test Cases to Write:
    - Thinking-only call-free candidate with default parser → parse_error budget consumption; terminal `artifact_failed` when revisions exhaust.
    - Whitespace-only text → same path.
    - Custom parser still consulted for non-empty text; empty short-circuits before accepting `""` as artifact value.
    - End-to-end `session.run` with `generateValidateReviseLoop` never returns `succeeded` with `text === ""` and zero artifact events.
    - Validator-only success path with non-empty text still succeeds (non-regression).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; empty artifact candidates become hard parse failures; success requires a validated artifact.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`, `docs/structured-output.md`, `docs/agent-events.md`, `docs/migration.md`.
    - `docs/index.md` update: no new page; keep Agent loops / Structured output descriptions accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Loop seam: `generateValidateReviseLoop` rejects `text.trim() === ""` before parser/identity default with synthetic `parse_error` (`no artifact text in model output`).
    - Session seam: `RuntimeAgentSession` tracks `artifact_finished`/`artifact_failed` during loop emit; `generate-validate-revise` throws `ArtifactFailed` (code from `metadata.reason`) when loop returns without `artifact_finished`, so runs fail instead of silent `succeeded`.
    - Regressions: empty/whitespace short-circuit unit test; thinking-only e2e (`AgentRunError`, `parse_error`, no `artifact_finished`/`agent_finished`); existing success + parse-repair paths green. agent-loops + docs 122/122.
    - Docs/changelogs: `docs/agent-loops.md`, `docs/structured-output.md`, `docs/agent-events.md`, `docs/migration.md`; root `CHANGELOG.md` Fixed note.
    - Skipped: changing direct `loop.run` to throw on `artifact_failed` (docs keep non-throw for stub/direct use; session guard covers product path).

- [x] 13. Re-verify 0.0.9 release-candidate evidence after Synapta defect fixes
  - Acceptance Criteria:
    - Functional: Tasks 9–12 complete with network-free regressions green; docs/changelogs mention the tool-call recovery and empty-candidate behavior; no Office surface reintroduced.
    - Functional: `npm run sdk:ready`, packaging/docs/export/install guards, audit/SBOM/secret/tarball checks, and `git diff --check` pass on the post-fix tree; `release:check` / `release:publish --dry-run` still target exact `0.0.9`.
    - Performance: no new default-CI live/network gates; existing coding/browser benchmark evidence remains valid or is re-recorded if public APIs changed.
    - Code Quality: amend 0.0.9 changelogs (do not invent 0.0.10); keep versions at 0.0.9; stop before signed commit/tag/publish without operator authorization.
    - Security: confirm malformed-args recovery cannot execute tools; truncated streams remain fail-closed; empty artifact success path is gone.
  - Approach:
    - Documentation Reviewed: Task 8 evidence block; `docs/release-and-install.md`; roadmap Phase 4 gate; this plan Tasks 9–12.
    - Options Considered:
      - Ship 0.0.9 without re-running RC gates: rejected.
      - Bump to 0.0.10 for these fixes: rejected; publication has not occurred and plan 071 already set the amend-in-version precedent.
      - Re-run focused then full RC gates and refresh evidence: chosen.
    - Chosen Approach:
      - Run focused transport/events/agent-loop/provider tests, then `npm run sdk:ready` and supply-chain/release dry-run commands from Task 8.
      - Update roadmap Phase 4 completion notes / Further Actions to state publication remains blocked only on operator gates after this task passes.
      - Append exact command/result evidence here.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      npm run release:check -- --version 0.0.9 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.9 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Package CHANGELOGs / `docs/migration.md` / `docs/release-and-install.md` as needed for fix notes.
      - `roadmap.md`: note Synapta pre-ship fixes landed before publication.
      - This plan: completion evidence, compromises, further actions, readiness verdict.
    - References:
      - Task 8 command matrix; plan 071 Task 6 release re-verification pattern.
  - Test Cases to Write:
    - Full deterministic RC matrix from Task 8 plus new Defect 1a/1b/2 regressions.
    - Release matrix: exact 0.0.9 graph, no version bump, dry-run publish still clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release evidence and migration notes for the fixes.
    - Docs pages to create/edit: `docs/release-and-install.md`, `docs/migration.md`, and any Task 10–12 pages still open.
    - `docs/index.md` update: only if descriptions drifted.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Focused Synapta regressions green before full gate: agents / provider-events / provider-transport / openai-compatible / agent-loops; opencode-go 37 pass (+7 skip); ai-sdk 10 pass. Conformance helper updated for Task 10 recovery + Task 11 `incomplete_delta` (was still expecting pre-0.0.9 throw on bad JSON).
    - `npm run sdk:ready`: 1,934 tests / 1,905 pass / 29 skip / 0 fail; typecheck + 32 pack dry-runs. Versions remain exact `0.0.9` (no 0.0.10 bump).
    - Supply chain: `npm audit --audit-level=high` → 0 vulnerabilities; SPDX SBOM 185 packages / 8 licenses; `node scripts/scan-secrets.mjs .` → 2,402 files / 0 findings; unpacked tarball scan 847 / 0; `git diff --check` clean.
    - Artifacts: 972,339 packed / 3,755,038 unpacked / 847 files; core 519,366 / 1,819,939; browser 29,171 / 132,669; no Playwright binary/image; no Office package/binary.
    - Registry: `release:check -- --version 0.0.9 --allow-dirty --allow-untagged` → 32/32 available; `release:publish -- --version 0.0.9 --dry-run --allow-dirty --allow-untagged` → 32/32 dry-run. No commit/tag/publish.
    - Docs/roadmap: `docs/release-and-install.md` RC table + handoff GO note Synapta fixes; `roadmap.md` Phase 4 evidence refreshed; coding/browser benchmark rows retained (APIs unchanged).
    - Security spot-check: malformed-args path never calls `execute`; incomplete streams fail-closed before `done`; empty artifact success path gone.
    - Skipped: operator Node 20 / Postgres / CodeQL / signed tag / OIDC / real Docker+Playwright / npm publish (handoff prerequisites).

## Compromises Made

- Office/OfficeCLI remains entirely outside Prism packaging for 0.0.9 by product decision; hosts may still select external skills/instructions.
- Browser is not part of `@arnilo/prism-code` to avoid forcing Playwright peers onto coding-only hosts; complete umbrella installs get it through `@arnilo/prism-all`.
- Protected real Docker/Playwright timing and containment evidence stay operator/CI prerequisites rather than default `sdk:ready` gates (network-free fakes remain the deterministic default).
- Node 20 compatibility, PostgreSQL/keychain live suites, CodeQL/dependency-review, signed tag, OIDC provenance, and actual npm publication were not executed from this dirty local tree and remain release-operator gates.
- Synapta enhancement `structuredOutput: "final_turn_only"` is explicitly deferred (non-blocking); 0.0.9 only fixes Defects 1a/1b/2.
- Direct `loop.run` still returns usage without throwing on terminal `artifact_failed`; session runs fail via `ArtifactFailed` when `artifact_finished` is missing (product path covered).
- Remaining skip-then-done providers beyond openai-compatible (responses / openrouter / zai / neuralwatt) rely on typed reconstruct `incomplete_delta` throw rather than per-provider dangling detection (same fail-closed outcome).

## Further Actions

- P0: Operator publication handoff only — merge through protected branch; require release verify, Node 20, PostgreSQL, CodeQL, dependency review, supply-chain, and environment approval; run protected Docker/Playwright gates with host-pinned image/browser when advertising containment; then create/verify/push signed `v0.0.9` exactly as `docs/release-and-install.md` specifies. Plan 072 Tasks 0–13 complete.
- P1: retain dated local/protected benchmark rows alongside future hardware changes; keep Office connectors as independent later decisions without reintroducing local Office runtimes.
- P2: consider opt-in `structuredOutput: "final_turn_only"` (apply JSON-schema constraint only once the model produces a call-free candidate) for tool-using artifact loops — requested in the Synapta bug report as non-blocking.
- P2: consider measuring whether coding hosts commonly want an optional browser subpath under a future profile without expanding `prism-code` defaults.
- P2: optionally add dangling incomplete-delta detection to remaining skip-then-done providers for earlier fail-closed (reconstruct already covers).

## Release readiness (2026-07-21 Task 13 recheck)

**Verdict: READY for operator publish of 0.0.9** (code/RC gates green; no commit/tag/publish created here).

| Gate | Status | Notes |
| --- | --- | --- |
| Phase 4 coding/browser Tasks 0–8 | Done | Sandbox, repo/Git, durable coding workflow, browser package/policy, evals/benchmarks, version graph 0.0.9 |
| Synapta Task 9 evidence freeze / shared-seam owners | Done | Defect→source→owner matrix frozen on revision `0d109989`; enhancement deferred P2 |
| Synapta Defect 1a (malformed tool-call JSON terminal) | Done — Task 10 | Failed tool result / `invalid_json_arguments`; model can self-correct |
| Synapta Defect 1b (incomplete tool-call delta bare Error) | Done — Task 11 | Typed `incomplete_delta`; openai-compatible fail-closed before `done` |
| Synapta Defect 2 (empty candidate succeeded) | Done — Task 12 | Empty → `parse_error`; no `succeeded` without `artifact_finished` |
| Synapta enhancement final_turn_only | Deferred P2 | Non-blocking; not a ship gate |
| `sdk:ready` / supply-chain / release dry-run | Done — Task 13 | 1,934 tests / 0 fail; audit 0; SBOM 185/8; secrets 0; 32/32 dry-run |
| Operator live/signing/publish gates | Pending | Unchanged from Task 8 handoff |

Publication may proceed once operator prerequisites in `docs/release-and-install.md` are satisfied. No further Plan 072 code tasks remain.

