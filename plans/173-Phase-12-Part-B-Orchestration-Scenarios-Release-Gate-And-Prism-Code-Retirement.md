# Phase 12 Part B — orchestration scenarios, the release-gate leg, Prism Code retirement, and the Phase 12 Done record

## Objectives

- Add the remaining workers to Prism Agent: one external worker on a host-owned adapter over `prism-driver-process`, and one worker reached over `connectAgent` from a second process that runs `serveAgent`.
- Build the `prism-workflows` graph with deterministic gates, a `humanGate`, and a `fanOut` across the workers, and prove each worker's events carry the correct `origin`.
- Route `HostUi` through `routeHostUi` (scripted client, then scripted channel, then the policy default, then durable suspension), and fire a scheduled run through the Phase 17 scheduler across two processes.
- Run the reference host's scenarios offline in `release:gate`.
- Delete `packages/prism-code` and everything whose only input is its source, with a repo-wide sweep.
- Write `apps/prism-agent/README.md` as a walkthrough of how a host is built, link it from `docs/index.md` as a guide, close the gap log, and record the Phase 12 Done criteria.

## Expected Outcome

- `bun run --filter @arnilo/prism-agent test` passes offline and covers every Phase 12 Done scenario:
  - the orchestrated workflow runs end to end, and each worker's events carry the correct `origin`
  - the host's `approval` gates the coding worker's tools (from plan 172)
  - the external worker's events carry `executedBy: "external"`, and the remote worker's events carry `origin.remote`
  - a run suspends, a scripted channel answers, and the run resumes and completes
  - a scheduled run fires once per tick across two processes
  - the one-shot JSONL stream matches its golden file (from plan 172)
  - research citations resolve, and an unresolved citation fails the check (from plan 172)
- `release:gate` runs that suite, and `scripts/release-gate.test.mjs` pins it.
- `packages/prism-code` is gone; `rg "prism-code"` over the live tree hits only the released `docs/prism-code.md`, the Phase 11 deprecation entry, `CHANGELOG.md` history, and this train's roadmap/plans.
- The gap log in plan 172 has no `open` row, and the Phase 12 Done record lists each Done criterion with the test that proves it.

This plan implements roadmap **Phase 12 — Prism Agent, the reference host**, Part B. It **depends on plan 172** (Part A), whose Task 1 is the review for both parts. Task 1 here is an **entry check**, not a second review: it confirms Part A landed as recorded and applies plan 172 Task 1's decisions to Tasks 2–10. Where the review decided otherwise than the approaches below, Task 1 amends the affected task before it starts. This plan adds no kernel contract; a seam found missing is a gap-log row in plan 172, handled by its disposition. It does not bump versions, publish, or deprecate on npm (`@arnilo/prism-code` is deprecated in Phase 11). It leaves the released `docs/prism-code.md` untouched. Lab impact (probe 12): this plan deletes the lab outright.

## Tasks

- [x] Task 1: Entry check — Part A as landed, and the review's Part B decisions applied (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 172's Notes, citing `file:line`:
      - `apps/prism-agent` exists, is private, is in root `workspaces`, and is skipped by package truth
      - `reference-host-boundary.test.ts` passes and derives its allow-list as decided in plan 172 Task 1 (a)
      - the orchestrator, coding, and research agents and `HostConfig` exist; the one-shot, `resume`, and `acp` entry points and the exit-code table exist
      - `@arnilo/prism-tools-research` and its enforcement rows exist
    - Functional: Apply plan 172 Task 1 decisions (f) orchestrator-to-workflow, (h) release-gate leg, (i) Prism Code deletion scope, (j) docs index link, and (l) inherited instability to Tasks 2–10, amending in place.
    - Functional: List every open gap-log row and the task here that must close it.
    - Functional: Record the failing-test baseline (same commands as plan 172 Task 6) and compare with plan 172's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every confirmation cites its span.
    - Security: Confirm the remote worker's transport (stdio, parent-spawned) needs no network listener, and that the scripted channel route uses the channel library's pairing and `authorizeEvent` path rather than a host-side bypass.
  - Approach:
    - Documentation Reviewed:
      - plan 172 (all Notes and the gap log); roadmap Phase 12 Scope and Done
    - Options Considered:
      - A second full review. Rejected: plan 172 Task 1 covers both parts.
    - Chosen Approach:
      - Confirm, apply, amend.
    - API Notes and Examples:
      ```bash
      bun test --timeout=0 src/__tests__/reference-host-boundary.test.ts
      graft skeleton apps/prism-agent/src/host/orchestrator.ts
      ```
    - Files to Create/Edit:
      - this plan: Notes and amendments only.
    - References:
      - plan 171 Task 1 (entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Verdict: Part A landed as recorded. Plan 173 stands. No re-cut. Gap log has no open row. Baseline matches plan 172's close.**
    - **Scaffold.** `apps/prism-agent/package.json:2,4` names `@arnilo/prism-agent` with `"private": true`, no `exports`, and `"type": "module"`. Root `package.json:114` lists `apps/*` in `workspaces`. `publishableWorkspaceDirs` filters `private !== true` (`scripts/package-truth.mjs:60-61`); `computePackageTruth` uses it (`:110,145`); `measureExportCounts` uses the same helper (`scripts/budget-gates.mjs:6,191-198`). So the app is workspace-linked but skipped by package truth and budgets. `reference-host-boundary.test.ts` passes 4/4 and derives its allow-list from non-private `packages/<group>/<name>` manifests minus `REJECT` (`src/__tests__/reference-host-boundary.test.ts:16-17,24,44-59`), with a positive assertion that `@arnilo/prism-tools-research` is allowed without editing the test (`:153`) and each `REJECT` name stays rejected (`:155`). Decision (a) applied as written.
    - **Agents and entry points.** `HostConfig` is `apps/prism-agent/src/host/config.ts:13` (loaded by `loadHostConfig` `:63`). The three composition modules exist: `createOrchestrator` `src/host/orchestrator.ts:11`, `createCodingWorker` `src/host/coding.ts:22`, `createResearchWorker` `src/host/research.ts:17`; `startAgent` `src/host/start.ts:12` maps a `createAgent` rejection to exit 2. The bin dispatches `run`/`resume`/`acp` by literal dynamic import (`apps/prism-agent/bin/prism-agent.ts:16-18`) and exits 2 on `UsageError` (`:22-24`); the exit-code table is `src/cli/exit-codes.ts` (`2 > 3 > 1 > 4 > 0`). The `schedule` command is Task 6, not yet present — expected.
    - **Research pack.** `packages/tools/research` is `@arnilo/prism-tools-research@0.12.1`, public, `exports` = `{".": "./src/index.ts"}`. Enforcement rows present: `scripts/package-truth.mjs:260` (PACKAGE_NOTES), `src/__tests__/packaging.test.ts:65,300-301`, the lockstep comment in `scripts/independent-packages.json`, `scripts/compat-baseline/arnilo__prism-tools-research.txt`, `scripts/e2e-coverage.json:1087`. The root `workspaces` glob `packages/tools/*` already covers it.
    - **Decisions applied in place.** (f) Task 4 now states `delegate` is for ad-hoc sub-tasks and the host passes factories in code (never `loadManifest`), with the graph reached only through the host-registered `workflowCommand` and `agent.commands.run`. (h) Task 7 already appends `bun run --filter @arnilo/prism-agent test` to `release:gate`, pins it in `scripts/release-gate.test.mjs`, adds no CI job, and relies on `expandWorkspaceDirs` for `run-all-tests`. (i) Task 8 now keeps `install.sh`/`scripts/install-sh.test.mjs`, names the kept released pages explicitly, fixes only a broken link in root `README.md`, and deletes `scripts/lib/pty-harness.mjs` unconditionally (its only callers are the deleted e2e scripts and `prism-code-checks.mjs`). (j) Task 9 already links `../apps/prism-agent/README.md` from `docs/index.md`, forbids `definePackage`/`loadManifest` in the sentence, and adds the `prism-wiki.md` carve-out. (l) Task 3 now records that plan 170's de-flake row does not block it, and Task 6 already records that the headless scheduler timing rows do not block (fix only if the scenario flakes).
    - **Gap log.** Plan 172's `## Gap log` table is empty; its Task 6 note rechecked and added no row. No `open` row, so no task here is blocked and Task 10's "none is `open`" criterion is already satisfiable.
    - **Baseline** (same commands as plan 172 Task 6; compared with its close): `bun run typecheck` exit 0. `bun test --timeout=0 src/__tests__/reference-host-boundary.test.ts` 4 pass / 0 fail. `@arnilo/prism-tools-research` 12 pass / 0 fail. `@arnilo/prism-agent` 16 pass / 0 fail. `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/host-surface-gate.test.ts` 341 pass / 4 fail (host-surface MCP-server imports; phase48 neuralwatt; retired provider family; `npm ls` tree) — plan 172 Task 6's 345/4 packaging-only run has the same four subjects. `bun test --timeout=0 src/__tests__/docs.test.ts` 148 pass / 22 fail — identical counts to plan 172 Task 6. `bun scripts/release.mjs gate` exit 1 before gates: `PRISM_TEST_POSTGRES_URL` unset. No new failure. These inherited red gates are plan 172's `Compromises Made` (P3) and stay red here.
    - **Security.** The remote worker's transport is stdio, parent-spawned (`packages/hosts/remote/src/connect.ts:48`; Task 3), so no listener and no token. The channel route is `channelHostUi`, which resolves a consumed pairing (`packages/hosts/channels/src/host-ui.ts:150-166`) and requires `core.authorizeEvent(event, "approval")` before an answer applies (`:172-175,288`); an unpaired or foreign-scope reply is refused, not bypassed. Task 5's `unpaired_channel_reply_refused` and Task 3's `remote_worker_opens_no_port` pin both.
    - **Amendments made by this task:** Task 3 (decision (l) adapter-conformance caveat + `/testing` subpath note), Task 4 (decision (f) `delegate`/`loadManifest` statement), Task 8 (decision (i): `pty-harness` deletion unconditional, kept released pages named, README "broken link only"). No task text was invalidated; no later task re-cut.

- [x] Task 2: The external worker — a host-owned adapter on `prism-driver-process`
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/src/adapters/` holds the host's own adapter, adapted from the Phase 15 reference adapter `examples/adapters/stream-cli.ts:13` and its dialect (`examples/adapters/stream-cli.dialect.ts`). Vendor adapters are host code (§2.13.1); the host copies the reference adapter, it does not import from `examples/`.
    - Functional: `src/host/external.ts` creates the external worker the way `examples/build-workflow.ts:104-113` does (Task 1): `createProfiles` first (a missing lease throws `profile_invalid`, `packages/drivers/process/src/driver.ts:109`), then `createAgent({ packages: [sqliteStore({ path }), processDriver(adapter)], packageConfig })`. No `loop:` field and no `store:` field (`AgentConfig.store` throws). `adapterDriver` is the definition `processDriver` wraps (`driver.ts:33,66`). The host module takes a binary path from `HostConfig` and does not import `@arnilo/prism/testing`. Scenarios build that path with `createScriptedCli` (`src/testing/scripted-cli.ts:185`) under `src/scenarios/`.
    - Functional: The adapter passes `adapterConformance` from `@arnilo/prism-driver-process`'s testing export (`packages/drivers/process/src/testing.ts:66`) inside the app's tests. That export is a declared `exports` subpath (`packages/drivers/process/package.json`), so plan 172 Task 1 (a) allows it. Plan 172 Task 1 (l): plan 170's "De-flake the unknown_request_fails conformance leg" is the adapter conformance harness, not the two-process remote path, so it does not block this task unless the scenario runs that flaky leg.
    - Functional: Scenario `external-worker-attribution`: the scripted CLI reports a message, a thinking block, and a tool call; every resulting event carries `origin.executedBy: "external"`; no `tool.call` gate event claims the external tool call.
    - Functional: A requested control the adapter's capability descriptor does not offer makes `createAgent` fail and name the control (§1.4); the scenario asserts this with one unsupported control.
    - Performance: The driver spawns one process per run; the scenario's scripted CLI exits on `turn.done`. No process outlives the test (asserted).
    - Code Quality: The adapter file states in a header comment that it is host code copied from the Phase 15 reference adapter. No vendor name appears in the adapter (the repo's no-vendor-name check stays green).
    - Security: The adapter declares the auth policy of the reference adapter; no subscription credential passes through the host. The binary path is config, never a shell string.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.7–2.12.11, Phase 15; `docs/next/agent-adapters.md`, `docs/next/drivers.md`; `packages/drivers/process/README.md`; `examples/adapters/*`, `examples/build-workflow.ts:93-113`, `examples/custom-adapter.ts:138-266`
    - Options Considered:
      - Import the reference adapter from `examples/`. Rejected: `examples/` is not a published package, so the boundary gate rejects it, and adapters are host opinions.
      - Use `processDriver` with an inline config and no adapter. Rejected: the roadmap names "a Phase 15 reference adapter".
    - Chosen Approach:
      - Copy the stream-cli reference adapter into the host and drive it through `adapterDriver`.
    - API Notes and Examples:
      ```ts
      import { processDriver } from "@arnilo/prism-driver-process";
      import { hostStreamCli } from "../adapters/stream-cli.js";
      const external = await createAgent({
        name: "external",
        host,
        packages: [sqliteStore({ path: config.storePath }), processDriver(hostStreamCli)],
        packageConfig: { [hostStreamCli.name]: { /* binary path + profile, per examples/build-workflow.ts */ } },
      });
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/adapters/stream-cli.ts`: new (copied from the Phase 15 reference adapter and adapted).
      - `apps/prism-agent/src/scenarios/stream-cli.dialect.ts`: new (copied and adapted). Placed under `scenarios/`, not `adapters/`: it imports `@arnilo/prism/testing`, which the boundary gate allows only under `src/scenarios/` and `__tests__/` (plan 172 Task 1 (a)).
      - `apps/prism-agent/src/scenarios/fixtures/stream-cli.json`: new (the reference adapter's recorded fixture, so `adapterConformance`'s `fixture_replay` leg runs instead of skipping).
      - `apps/prism-agent/src/host/external.ts`: new.
      - `apps/prism-agent/src/host/config.ts`: `external` block and `HostDeps.hooks`.
      - `apps/prism-agent/src/host/index.ts`: export.
      - `apps/prism-agent/src/scenarios/external-worker-attribution.ts`: new.
      - `apps/prism-agent/src/__tests__/external.test.ts`: new.
      - `apps/prism-agent/package.json`: `@arnilo/prism-driver-process` dependency; `bun.lock`.
    - References:
      - plans 166–167 (driver and reference adapters)
  - Test Cases to Write:
    - `host_adapter_passes_adapter_conformance`.
    - `external_events_are_attributed_external`: fails if any external event lacks `executedBy: "external"` or a `tool.call` gate claims it.
    - `unsupported_control_fails_create_agent`: fails if `createAgent` succeeds or does not name the control.
    - `no_external_process_outlives_run`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — private host code.
    - Docs pages to create/edit: none in this task; covered by the Task 9 walkthrough.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** `@arnilo/prism-agent`'s external worker. `src/adapters/stream-cli.ts` is the Phase 15 reference adapter copied verbatim (export renamed `hostStreamCli`, package name `@prism-agent/adapter-stream-cli`, header comment). `src/scenarios/stream-cli.dialect.ts` is its dialect, moved under `scenarios/` because the boundary gate forbids `@arnilo/prism/testing` in `adapters/`. `src/scenarios/fixtures/stream-cli.json` is the reference's recorded fixture. `src/host/external.ts` creates the profile first, then `createAgent({ packages: [sqliteStore, ...deps.packages, processDriver(hostStreamCli)], packageConfig })` — no `loop:` or `store:`. `HostConfig` gained an optional `external: { binary, args?, profile?, profilesRoot? }` block (parsed and validated by `loadHostConfig`); `HostDeps` gained `hooks` so a scenario can probe the `tool.call` gate.
    - **Adaptation.** The only source change to the copy is `as unknown as ExternalActivity` → `as ExternalActivity` in `decodeStreamFrame`'s payload branch (it typechecks directly), so the plan 172 Task 6 workaround grep stays empty. Behavior is unchanged; the recorded fixture replays through it.
    - **Tests.** `external.test.ts` 4 pass: `host_adapter_passes_adapter_conformance` (the copied recorded fixture replays, no failed leg), `external_events_are_attributed_external` (tool and message events carry `origin.executedBy: "external"`; the host `tool.call` gate saw no claim), `no_external_process_outlives_run` (the scripted CLI's own `exit` record is present before the run returns), `unsupported_control_fails_create_agent` (a reduced descriptor plus `requires: { subagents: true }` rejects with `driver_capability_missing` naming `subagents`).
    - **Finding for later tasks.** The driver's callback broker builds a Unix socket under the profile run directory; a long temp prefix makes the run fail `broker_unavailable: the run directory path is too long for a Unix socket`. The test uses short prefixes (`pa-ext-`, `pa-unsup-`). Tasks 3, 4, and 6 also create drivers/processes under temp roots and must keep their temp paths short. This is a driver-side constraint (plan 166), not a host seam; no gap row.
    - **Baseline.** No export moved; no `runGates`/compat-baseline change. `bun run --filter @arnilo/prism-agent typecheck` exit 0. App suite 16 → 20 pass / 0 fail. Boundary gate 4/4. `driver_kit_names_no_vendor` 3/3. Workaround grep over `apps/prism-agent` empty. `bun install` wrote no duplicate lock keys (`duplicateLockKeys` = 0). The pre-existing `@arnilo/prism-evals` cache ENOENT remains.

- [x] Task 3: The remote worker — a second process running `serveAgent`, reached through `connectAgent`
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/bin/remote-worker.ts` creates a worker agent (a research-flavoured agent on the mock provider in scenarios, or the configured model in real use) with `remoteHostUi()` as its host UI and calls `serveAgent(agent, { transport: { kind: "stdio" }, hostUi })` (`packages/hosts/remote/src/serve.ts:40-96`).
    - Functional: `src/host/remote.ts` calls `connectAgent({ kind: "stdio", command: [...] }, { host: { ui }, mirror })` (`packages/hosts/remote/src/connect.ts:48`; `mirror` is optional at `:32`). `mirror` is `createSqlitePersistence({ filename })` from `@arnilo/prism-store-sqlite` (public root export), the same file the other agents open with `sqliteStore`. Not `AgentConfig.store` (removed). The host spawns the second process, answers its `HostUi` requests locally, and archives the remote session into that store with `parent` links.
    - Functional: Scenario `remote-worker-attribution`: the remote worker runs a tool; forwarded events keep their catalog types and carry `origin.remote` (the endpoint id); remote-gated tool events carry `executedBy: "external"` and never claim the host's `tool.call`; `createSessionIndex(store)` finds the mirrored session.
    - Functional: Scenario `remote-approval-through-local-host-ui`: the remote worker's approval request reaches the host's `HostUi` and the answer resumes the remote run.
    - Functional: Killing the remote process mid-run fails the host run with the remote library's error code, not a hang (bounded by the scenario timeout).
    - Performance: One extra Bun process per connected worker, spawned lazily on first use; it exits when the host closes the connection (asserted).
    - Code Quality: The remote worker bin is the only place in the app that calls `serveAgent`. No custom protocol code: all framing is `@arnilo/prism-remote`.
    - Security: stdio only, so no listener and no token. A test asserts no TCP port is opened by either process during the scenario. Secrets in the remote worker's config are refs resolved in the remote process and never appear in forwarded events or the mirror.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13.4, Phase 17; `packages/hosts/remote/README.md`; `examples/remote-agent.ts:32-121`; plan 170 Notes ("Preserve remote resume events during session-open registration" backlog row)
    - Options Considered:
      - An in-memory transport (`{ kind: "memory" }`). Rejected: the roadmap requires a second process.
      - WebSocket. Rejected for the scenario: stdio needs no port or token; WebSocket is covered by `remoteConformance` in plan 170.
    - Chosen Approach:
      - A host-owned remote worker bin over stdio, connected with mirroring.
    - API Notes and Examples:
      ```ts
      const remote = await connectAgent(
        { kind: "stdio", command: ["bun", fileURLToPath(new URL("../../bin/remote-worker.ts", import.meta.url))] },
        { host: { ui: deps.host.ui }, mirror: deps.store },
      );
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/bin/remote-worker.ts`: new.
      - `apps/prism-agent/src/host/remote.ts`: new.
      - `apps/prism-agent/src/bun-module.d.ts`: new. A minimal `bun` module shim (see Notes).
      - `apps/prism-agent/src/scenarios/{remote-worker-attribution.ts,remote-approval-through-local-host-ui.ts}`: new.
      - `apps/prism-agent/src/__tests__/remote.test.ts`: new.
      - `apps/prism-agent/src/host/index.ts`: export.
      - `apps/prism-agent/src/scenarios/mock-seam.ts`: the `remote-approve` script.
      - `apps/prism-agent/tsconfig.json`: the `bun` `paths` shim (see Notes).
      - `apps/prism-agent/package.json`: `@arnilo/prism-remote` dependency; `bun.lock`.
    - References:
      - plan 170 (remote library)
  - Test Cases to Write:
    - `remote_events_carry_origin_remote_and_external`: fails if `origin.remote` is missing or a remote tool event claims the local gate.
    - `remote_session_is_mirrored_and_indexed`.
    - `remote_approval_answered_locally_resumes`.
    - `remote_process_kill_fails_fast`.
    - `remote_worker_opens_no_port`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — private host code.
    - Docs pages to create/edit: none in this task; covered by the Task 9 walkthrough.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** the second-process remote worker. `bin/remote-worker.ts` reads `PRISM_AGENT_CONFIG` (and the scenario-only `PRISM_AGENT_MOCK` script through `src/scenarios/mock-seam.js`), builds a `remote-worker` agent on `models.research` with `remoteHostUi()` and an `approval({ mode: "ask" })` gate over one `save` tool, then `serveAgent(agent, { transport: { kind: "stdio" }, hostUi: ui, endpointId: REMOTE_ENDPOINT })`. `src/host/remote.ts` exposes `REMOTE_ENDPOINT`, `REMOTE_WORKER_BIN`, and `connectRemoteWorker({ configPath, ui, mirror, endpointId, env })`, which spawns `[process.execPath, REMOTE_WORKER_BIN]` with `PRISM_AGENT_CONFIG` in the child env and calls `connectAgent({ kind: "stdio", ... }, { host: { ui }, mirror, endpointId })`. No custom protocol code: every frame is `@arnilo/prism-remote`. `mock-seam.ts` gained the `remote-approve` script (gate `save`, then answer after approval).
    - **Tests.** `remote.test.ts` 5 pass: `remote_events_carry_origin_remote_and_external` (tool events carry `origin.remote === "prism-agent-remote"` and `executedBy: "external"`; a host-side `tool.call` hook saw nothing), `remote_session_is_mirrored_and_indexed` (`createSessionIndex(mirror).list()` finds the mirrored session), `remote_approval_answered_locally_resumes` (the remote's `confirm` request reached the host `HostUi` and the run completed), `remote_process_kill_fails_fast` (a blocked run rejects with `RemoteError("disconnected")` on dispose, not a hang; test timeout 15s), `remote_worker_opens_no_port` (no `net.Server.listen` during the scenario; the worker bin source declares no network transport).
    - **Finding — `@types/bun` globals vs `@arnilo/prism-mcp`/`@arnilo/prism-memory-rag`.** `@arnilo/prism-remote`'s network transport imports `"bun"`, which resolved `@types/bun` and its global `fetch.preconnect`. That conflicts with the `fetch` shapes in `@arnilo/prism-mcp` and `@arnilo/prism-memory-rag` (the same conflict `packages/hosts/devtools/src/bun.d.ts` documents), failing 20 typechecks in the app program. The reference host is stdio-only, so `tsconfig.json` maps `"bun"` to `src/bun-module.d.ts`, a minimal shim (`serve`, `secrets`) following the repo's local-declaration pattern (`packages/hosts/devtools/src/bun.d.ts`, `packages/stores/sqlite/src/bun-sqlite.d.ts`). The app's `paths` also restates the inherited `@arnilo/prism` mapping because `paths` replaces rather than merges. `bun run typecheck` (whole tree) is exit 0.
    - **Baseline.** App suite 20 → 25 pass / 0 fail. App typecheck and root `bun run typecheck` exit 0. Boundary gate 4/4. `driver_kit_names_no_vendor` 3/3. Workaround grep over `apps/prism-agent` empty. `bun install` left `@types/bun@1.4.2`/`bun-types@1.4.2` and nested `@types/node@26.6.4` (the pre-task baseline) and wrote no duplicate lock keys. `@arnilo/prism-evals`' cache ENOENT persists (pre-existing).
    - **Not separately asserted.** "The process exits when the host closes" is carried by `connectRemoteWorker` → `Agent.dispose()`, which closes the dispatcher and calls the transport's `kill()`; `remote_process_kill_fails_fast` is the assertion. A graceful-exit marker would race the SIGTERM, so none was added.

- [x] Task 4: The orchestrated workflow — deterministic gates, a `humanGate`, and a `fanOut` across the workers
  - Acceptance Criteria:
    - Functional: `src/host/workflow.ts` defines one graph with `defineWorkflow` (`packages/integrations/workflows/src/define.ts`):
      1. `agentNode` research brief (research worker)
      2. `fanOut` across the coding worker, the external worker, and the remote worker, each implementing one slice (`packages/integrations/workflows/src/nodes.ts:37`)
      3. a `gateNode` with a deterministic check (e.g. the workspace's test command exits `0`; a bounded back edge to the coding worker on failure) (`nodes.ts:59`)
      4. a `humanGate` asking for sign-off through `HostUi` (`nodes.ts:65`)
      5. an `agentNode` research report that cites the ledger (research worker, `tools-research`)
    - Functional: The orchestrator agent reaches the graph as decided in plan 172 Task 1 (f): a host package registers `workflowCommand(prism, "build", () => graph)` (`packages/integrations/workflows/src/command.ts:32`). The scenario starts it with `agent.commands.run`. Commands are not model-visible. `delegate` covers ad-hoc sub-tasks on the orchestrator's own packages; the host passes package factories in code, never `loadManifest`. No workflow-as-tool gap.
    - Functional: Scenario `orchestrated-workflow`: the workflow runs end to end on the mock provider and the scripted CLI; the merged stream's events carry the correct `origin` per worker (in-process agents by agent id, external by `executedBy: "external"`, remote by `origin.remote`); the gate fails once and the back edge re-runs the coding slice; the `humanGate` is answered by the scripted client; every worker session has a `parent` link to the workflow run, so `createSessionIndex(store).list({ workflowRunId })` lists them all.
    - Functional: A gate check that throws fails the workflow (gate throws count as deny, §1.4); asserted.
    - Performance: `fanOut` concurrency is bounded by `resolveMaxFanOut` defaults; the scenario uses three branches. Inherited backlog row "Cross-process profile pacing for fanOut" is noted, not addressed.
    - Code Quality: The graph is one file of declarations; no workflow engine logic in the host.
    - Security: The `humanGate` answer goes through `approval`/`HostUi`, never a host shortcut. The deterministic gate command is a fixed argv from `HostConfig`, never model output.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.13, Phase 16; `packages/integrations/workflows/README.md`; `examples/build-workflow.ts:75-332`; plan 169 Notes and its backlog rows ("Make workflowLoop resumable", "Expose the WorkflowRun from workflowCommand", "Validate gate back edges ...")
    - Options Considered:
      - Drive the graph from host code with `startWorkflow` only and no orchestrator agent. Rejected: the roadmap requires an orchestrator agent with `delegate` and `workflows`.
      - Use `delegate` children as the fan-out workers. Rejected: delegate children are not existing `Agent`s, so the external and remote workers cannot be children.
    - Chosen Approach:
      - A declarative graph over the four worker agents, started by the orchestrator through the decided entry.
    - API Notes and Examples:
      ```ts
      export const build = defineWorkflow({
        id: "prism-agent.build",
        nodes: {
          brief: agentNode({ agent: research }),
          slices: fanOut({ items: (s) => s.brief.slices, node: (slice) => agentNode({ agent: pick(slice) }) }),
          tests: gateNode({ check: runTests, onFail: "slices", maxRetries: 1 }),
          signoff: humanGate({ request: { kind: "confirm", title: "Ship the change?" } }),
          report: agentNode({ agent: research }),
        },
        edges: [["brief", "slices"], ["slices", "tests"], ["tests", "signoff"], ["signoff", "report"]],
      });
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/host/{workflow.ts,orchestrator.ts}`: new / edit.
      - `apps/prism-agent/src/host/config.ts`: optional `gate.command` argv.
      - `apps/prism-agent/src/scenarios/orchestrated-workflow.ts`: new.
      - `apps/prism-agent/src/__tests__/workflow.test.ts`: new.
    - References:
      - plans 168–169 (workflows)
  - Test Cases to Write:
    - `orchestrated_workflow_runs_end_to_end`.
    - `worker_events_carry_correct_origin`: fails if any worker's events carry another worker's origin or none.
    - `gate_failure_takes_back_edge_once`.
    - `gate_throw_fails_workflow`.
    - `worker_sessions_link_to_workflow_run`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — private host code.
    - Docs pages to create/edit: none in this task; covered by the Task 9 walkthrough.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** `buildWorkflow` (`src/host/workflow.ts`): research brief, `fanOut` of the coding / external / remote workers (fixed slice list, not model output), a `gateNode` that runs `HostConfig.gate.command` via `execFileSync` (no shell), a back edge to the `coding` node (`onFail`, `maxIterations: 2`, `activation: "any"`), a `humanGate` confirm, and a research report node. `fanOut` sets no `maxFanOut`, so `resolveMaxFanOut` stays at `DEFAULT_MAX_FAN_OUT` (64). The inherited backlog row "Cross-process profile pacing for fanOut" is not addressed.
    - **Entry.** `createOrchestrator` registers `workflowCommand(prism, "build", () => graph)`. The scenario starts it with `agent.commands.run`. No `loadManifest`. `delegate`'s `research-brief` child is unchanged and is not a worker. `build` fails closed when `OrchestratorDeps.workers` is omitted: the factory does not spawn the remote worker (that needs a config path it does not have). Task 6's workflow firing must pass the workers.
    - **Library finding.** A passing gate still calls `gateFailTargets` (to exclude the back edge). `signoff` therefore declares `onFail: "tests"` and the edge `signoff -> tests`. A check that throws is caught as `check_threw` and then fails the run when that gate has no back edge (`WorkflowRuntimeError`, status `failed`, not `denied`). `gate_throw_fails_workflow` asserts that path. A throw on the product gate would route back, then `maxIterations` would fail the run.
    - **Tests.** `workflow.test.ts` 5 pass. In-process worker events carry no foreign `origin` (absent origin is that agent; attributed by session `agentId`). External events carry `executedBy: "external"`. Remote events carry `origin.remote === "prism-agent-remote"`. The gate fails once, routes to `coding`, and the coding worker has two sessions. `createSessionIndex(store).list({ workflowRunId })` lists all four workers. The report session's `research.verify` is `passed` with a non-empty ledger. The scripted client answered the one `confirm`.
    - **Baseline.** App suite 25 → 30 pass / 0 fail. App typecheck exit 0. Boundary gate 4/4. Workaround grep over `apps/prism-agent` empty. No export moved.

- [x] Task 5: Routed `HostUi` — scripted client, scripted channel, policy default, durable suspension, and resume
  - Acceptance Criteria:
    - Functional: `src/host/host-ui.ts` builds the host's UI with `routeHostUi([client, channel, policyDefault()])` (`packages/hosts/headless/src/route.ts:33`), where `client` is the attached client (in scenarios `createScriptedHostUi`; in `acp` mode the ACP host), and `channel` is `channelHostUi(...)` (`packages/hosts/channels/src/host-ui.ts:32`) on a scripted channel transport, as `examples/headless-host.ts` does. Resume uses `createResumeAuthority(agent)` (`packages/hosts/headless/src/authority.ts:11`) and `router.resumeWhenAnswered`.
    - Functional: Scenario `headless-approval`: the coding worker requests approval; the scripted client is detached (answers `unavailable`); the scripted channel does not answer within its timeout; the policy default answers `unavailable`; the run suspends durably (one-shot exit `3`); later the scripted channel answers; `resumeWhenAnswered` resumes the run in a **fresh process** over the same store, and it completes. `router.answers()` records the route that answered.
    - Functional: Kind limits: a `secret` request never reaches the channel route; asserted.
    - Performance: The router is sequential with per-route timeouts from `HostConfig` (scenario uses short timeouts on a fake clock where the library allows).
    - Code Quality: No host-side routing logic beyond constructing routes.
    - Security: The channel route is paired and authorized through the channel library (plan 171 Task 4); a reply from an unpaired scripted sender is refused, asserted. The answer log holds no value.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13.4, Phase 17; `packages/hosts/headless/README.md`; `packages/hosts/channels/README.md`; `examples/headless-host.ts:29-242`; plan 171 Notes and backlog rows
    - Options Considered:
      - Answer the approval directly through `session.resume` in the scenario. Rejected: the roadmap requires the scripted channel to answer through the router.
    - Chosen Approach:
      - Compose the published router and channel route exactly as the Phase 17 example does, inside the host.
    - API Notes and Examples:
      ```ts
      const ui = routeHostUi([
        { name: "client", ui: client, kinds: ["confirm", "select", "input", "notify", "terminal"] },
        { name: "channel", ui: channelHostUi(channelOptions), kinds: ["confirm", "select", "input"], timeoutMs: config.channelTimeoutMs },
        policyDefault(),
      ]);
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/host/host-ui.ts`: new; `src/host/{coding.ts,orchestrator.ts}`: take the routed UI via `HostDeps.ui`.
      - `apps/prism-agent/src/host/{config.ts,index.ts}`: `HostDeps.ui` + `hostPortOf`; re-export `buildHostUi`.
      - `apps/prism-agent/src/scenarios/headless-approval.ts`: new (scripted channel transport fixture).
      - `apps/prism-agent/src/__tests__/headless-approval.test.ts`: new.
      - `apps/prism-agent/package.json`: `@arnilo/prism-headless`, `@arnilo/prism-channels` dependencies; `bun.lock`.
    - References:
      - plan 171 (router, channel route, resume authority)
  - Test Cases to Write:
    - `headless_approval_suspends_then_channel_resumes_in_fresh_process`.
    - `answer_log_records_channel_route_without_value`.
    - `secret_request_never_reaches_channel`.
    - `unpaired_channel_reply_refused`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — private host code.
    - Docs pages to create/edit: none in this task; covered by the Task 9 walkthrough.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** `buildHostUi` (`src/host/host-ui.ts`): `routeHostUi([{client}, {channel?}, policyDefault()])`. `CLIENT_KINDS` = confirm/select/input/notify/terminal; `CHANNEL_KINDS` = confirm/select/input. `secret` is in neither, so no route sees a secret (the credentials slot owns it). No routing logic in the host.
    - **Wiring.** `HostDeps.ui` + `hostPortOf(deps)` (`src/host/config.ts`); `createCodingWorker` and `createOrchestrator` now pass `deps.ui` as `host: { ui }`. `buildHostUi` is re-exported from `src/host/index.ts`. `acp` mode still builds no UI — a later task can pass the ACP host as the client.
    - **Scenario.** `headless-approval.ts` spawns **itself** as the one-shot child (`fileURLToPath(import.meta.url) === process.argv[1]`, mode `one-shot`), so no `PRISM_AGENT_MOCK` is needed: the child imports `mock-seam`'s `write-suspend` directly. The child builds the routed UI over a real paired `connectTelegram` with a scripted `fetch`, runs the coding worker, and exits the CLI's suspension code `3`. The host process reopens the same SQLite file, rebuilds the routed UI with `resumeAuthority: createResumeAuthority(coding)`, and `resumeWhenAnswered` resumes once the scripted channel answers.
    - **Library finding.** A **resume** offer ignores `route.timeoutMs` (`route.ts`: only `approvalId === undefined` arms the route timer), so the channel's timeout is exercised in the run phase (a plain `HostUi.request`), where client → channel(timeout) → policy are all offered and all `unavailable`. The resume offer is bounded by the channel answering instead.
    - **Durability.** The child's answer rows land in the shared SQLite answer log, so the host process reads the run phase's `client`, `channel`, `policy` rows back from the store (the `policy` row can only come from the child) alongside its own `client` + `channel answered` resume rows. `RoutedAnswer` has no `value` field, so `valuesLogged` is 0 by construction.
    - **Deviation.** The channel timeout is a `buildHostUi` option, not a `HostConfig` field: nothing in the product builds a routed UI yet, so a config field would be unused. Task 6+ must not assume `HostConfig` carries a route timeout.
    - **Tests.** 4 pass. App suite 30 → 34 pass / 0 fail. App and root typecheck exit 0. Boundary gate 4/4. Workaround grep over `apps/prism-agent` empty. Vendor-neutral 3/3. `bun install` kept `@types/bun`/`bun-types` at 1.4.2 and saved the lock; the 3 `@arnilo/prism-evals` ENOENT cache-copy failures are pre-existing.

- [x] Task 6: A scheduled run across two processes through the Phase 17 scheduler
  - Acceptance Criteria:
    - Functional: `src/host/schedule.ts` creates `createScheduler({ ... targets })` (`packages/hosts/headless/src/scheduler/index.ts:45`) over the SQLite store's checkpoint and lease services, with one schedule from `HostConfig` (a cron expression with explicit `tz`, default `"UTC"`, per plan 170 Task 1) targeting the research worker (a daily brief) and one targeting the workflow.
    - Functional: `bin/prism-agent.ts schedule` runs the scheduler loop until signalled (exit `0` on SIGTERM after in-flight firings settle).
    - Functional: Scenario `scheduled-run-two-processes`: two `prism-agent schedule` processes share one SQLite file and an injected clock source; across N ticks each firing runs exactly once (counted from sessions with the schedule session as `parent`); after both processes stop and one restarts past a missed tick, the configured missed-firing policy is honored.
    - Functional: The scenario's guarantee is stated as plan 171 defined it: exactly once for live contending workers, with the documented claim-to-start crash window (backlog "Revisit scheduler claim-to-start crash loss ...") not claimed.
    - Performance: Each tick is one lease claim plus one checkpoint write per due firing. The scenario bounds wall time and uses the fake clock. Plan 172 Task 1 (l): the scheduler timing rows do not block. Do not land that fix here unless this scenario flakes.
    - Code Quality: No scheduling logic in the host beyond schedule declarations and the signal handler.
    - Security: Schedule targets are fixed agent and workflow ids from config; a firing cannot select an agent from model output.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 17 scheduler bullets; `packages/hosts/headless/README.md`; `examples/headless-host.ts` (fake clock); plan 171 Task 6 Notes and backlog rows
    - Options Considered:
      - Two schedulers in one process. Rejected: the roadmap requires two processes.
    - Chosen Approach:
      - Two child processes on a shared SQLite file with an injected clock, counting firings from the store.
      - Task 4 finding: `createOrchestrator` registers `build` but does not spawn the four workers. A firing of the workflow must pass `OrchestratorDeps.workers` (the remote worker needs a config path). Without them `build` throws and does not guess.
    - API Notes and Examples:
      ```bash
      PRISM_AGENT_CLOCK=file:/tmp/clock bun apps/prism-agent/bin/prism-agent.ts schedule --config prism-agent.json
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/host/schedule.ts`, `apps/prism-agent/src/cli/schedule.ts`: new; `bin/prism-agent.ts`: `schedule` command.
      - `apps/prism-agent/src/scenarios/scheduled-run-two-processes.ts`: new.
      - `apps/prism-agent/src/__tests__/schedule.test.ts`: new.
      - Tentative: `packages/hosts/headless/src/scheduler/*` only if plan 172 Task 1 (l) requires the timing fix; then its test and README line too.
    - References:
      - plan 171 Task 6
  - Test Cases to Write:
    - `scheduled_run_fires_once_per_tick_across_two_processes`: fails on a double or a missed firing.
    - `missed_firing_policy_honored_after_restart`.
    - `schedule_command_exits_0_on_sigterm`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no, unless the tentative scheduler fix lands (then `packages/hosts/headless/README.md` and `CHANGELOG.md`).
    - Docs pages to create/edit: none otherwise; covered by the Task 9 walkthrough.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped.** `src/host/schedule.ts`: `createHostScheduler` builds `createScheduler` over `createSqlitePersistence({ filename }).checkpoints` and `.leases`, fixed targets (`brief` → research agent, `build` → orchestrator `build` command, only when `schedule.build` is configured), cron and `tz` (default `UTC`) and `missed` policy from the new optional `HostConfig.schedule` block (`tz`, `missed`, `brief: { cron, prompt }`, `build: { cron }`; parsed and key-checked by `loadHostConfig`). A `duplicate_schedule` from a second process is swallowed, so both processes share one schedule row. `fileClock`/`clockFromEnv` implement `PRISM_AGENT_CLOCK=file:<path>`, a shared fake clock for the scenario (same seam style as `PRISM_AGENT_MOCK`). `src/cli/schedule.ts` + `bin/prism-agent.ts schedule`: runs until SIGTERM/SIGINT, `scheduler.stop()` drains in-flight firings, disposes agents, exit `0`; a missing `schedule.brief`/`schedule.build` is exit `2`. `parseArgs` accepts `schedule` and only `--config`.
    - **Ownership.** The scheduler refuses a target whose agent ownership differs from its own, so `HostDeps.ownership` is new and `createResearchWorker`/`createOrchestrator` pass it to `createAgent`; the CLI passes `SCHEDULE_OWNERSHIP` (`prism-agent`/`prism-agent`, the coding worker's scope). Other callers pass none, so existing scenarios are unchanged.
    - **Scenario** `scheduled-run-two-processes`: two `prism-agent schedule` children share one SQLite file and one clock file (mock script `schedule-text` added to `mock-seam.ts`). The clock advances one minute at a time; firings are counted from sessions with `parentSessionId` = the schedule session. Both children are then SIGTERMed (exit `0` each), the clock jumps past `missedTicks` minutes, and one restarts.
    - **Tests.** `schedule.test.ts` 4 pass (stable over 3 runs): `scheduled_run_fires_once_per_tick_across_two_processes` (counts `[1,2,3]`, no double), `missed_firing_policy_honored_after_restart` (`skip` → 0 firings after restart over 5 missed minutes; `run-once` → exactly 1), `schedule_command_exits_0_on_sigterm`, plus an args test. App suite 34 → 38 pass / 0 fail. App and root typecheck exit 0. Boundary gate 4/4. No `as unknown as` in the app. Headless library untouched; the scheduler timing rows did not flake, so no fix landed.
    - **Guarantee stated.** Exactly once for live contending workers (lease + checkpoint version). The claim-to-start crash window (backlog "Revisit scheduler claim-to-start crash loss ...") is not claimed and not tested.
    - **Not covered (honest gap).** The `build` workflow target is declared and wired in the CLI (it builds the four workers, the remote one from the config path) but no test fires it across processes; the two-process count uses the research brief target. Task 9's README should describe `build` scheduling as declared, not scenario-proven.

- [x] Task 7: Run the reference host's scenarios offline in `release:gate` and CI
  - Acceptance Criteria:
    - Functional: Per plan 172 Task 1 (h), `release:gate` in root `package.json` runs `bun run --filter @arnilo/prism-agent test` (offline, no env beyond the defaults). `scripts/release-gate.test.mjs` asserts the leg is present and runs after `check-client-neutrality`.
    - Functional: After plan 172 Task 3, `scripts/run-all-tests.mjs` already includes the app via `expandWorkspaceDirs`. Confirm that; do not add a workflow job. `.github/workflows/release.yml` already runs `bun run test` and `release:gate` (Task 1 (h)).
    - Functional: The scenario suite fails, not skips, when a scenario's fixture is missing; a test asserts no `test.skip` in `apps/prism-agent/src/__tests__`.
    - Performance: The app suite's wall time is recorded in the task note and bounded in `scripts/budgets.json` if the repo budgets suites there.
    - Code Quality: No duplicate scenario runner; the gate calls the workspace `test` script.
    - Security: The gate leg sets no secret env; a test asserts the app's test script reads no `PRISM_*_KEY`/token env.
  - Approach:
    - Documentation Reviewed:
      - root `package.json` `release:gate`; `scripts/release-gates.mjs:257`; `scripts/run-all-tests.mjs`; `scripts/release-gate.test.mjs`; `docs/release-and-install.md` "Release checklist"
    - Options Considered:
      - A new leg inside `runGates`. Rejected: `runGates` checks surfaces and tarballs, not behavior; the npm script chain is where behavioral legs already run.
    - Chosen Approach:
      - Append the workspace test to `release:gate`, include it in `run-all-tests`, and pin both.
    - API Notes and Examples:
      ```jsonc
      "release:gate": "bun scripts/release-skip-manifest.mjs && bun scripts/check-client-neutrality.mjs && bun run --filter @arnilo/prism-agent test && bun scripts/release.mjs gate"
      ```
    - Files to Create/Edit:
      - `package.json`: `release:gate`.
      - `scripts/release-gate.test.mjs`: pin.
      - `scripts/run-all-tests.mjs`: include the app.
      - `scripts/budgets.json`: tentative, only if the app suite is a budgeted suite.
      - `docs/release-and-install.md`: not in this task. Released page; Task 1 (h) defers the checklist line to Phase 11.
    - References:
      - roadmap Phase 11 "`release:gate` runs the Prism Agent reference host's scenarios offline"
  - Test Cases to Write:
    - `release_gate_runs_reference_host_scenarios`: fails if the leg is removed or reordered.
    - `reference_host_suite_has_no_skips`.
    - `reference_host_suite_reads_no_secret_env`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — repo tooling.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: none — Task 1 (h) defers the checklist line to Phase 11.
      - `CHANGELOG.md`: `## [Unreleased]` line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped.** Root `package.json:139` `release:gate` is now `release-skip-manifest.mjs && check-client-neutrality.mjs && bun run --filter @arnilo/prism-agent test && bun scripts/release.mjs gate`. The app leg runs offline through the app's own `test` script (`bun ../../scripts/with-build-lock.mjs --shared bun test --parallel=4 --timeout=0 src`, `apps/prism-agent/package.json`), so the gate calls the workspace script, not a second runner.
    - **Pinned** in `scripts/release-gate.test.mjs` (21 → 24 pass): `release_gate_runs_reference_host_scenarios` asserts the leg is present, after `check-client-neutrality.mjs`, before `release.mjs gate`, that the app `test` script is the workspace script, and that `run-all-tests`'s `workspace suites` stage (`STAGES`, imported from `scripts/run-all-tests.mjs`) lists `apps/prism-agent`; `reference_host_suite_has_no_skips` walks `apps/prism-agent/src/__tests__` and fails on any `test|it|describe.skip(`; `reference_host_suite_reads_no_secret_env` asserts neither the `release:gate` string nor the app `test` script matches `PRISM_[A-Z0-9_]*(KEY|TOKEN|SECRET)|API_KEY`.
    - **CI and `run-all-tests` already covered it** (plan 172 Task 1 (h) / Task 3). `WORKSPACE_LEAVES` is `expandWorkspaceDirs(ROOT, workspaces)` (`scripts/run-all-tests.mjs:124`), and root `package.json:114` lists `apps/*`, so the app's `test` script runs in the workspace stage. `.github/workflows/release.yml` already runs `bun run test` and `release:gate`. No workflow job was added. `scripts/run-all-tests.mjs` was not edited.
    - **Fails, not skips.** No `test.skip` exists in the app's tests, and the one golden fixture is read with `readFileSync` (`apps/prism-agent/src/__tests__/golden.test.ts:32`), which throws when missing, so a lost fixture is a red test, not a skip.
    - **Wall time.** `bun run --filter @arnilo/prism-agent test`: 38 pass / 0 fail, 7.5–7.8 s (measured 7.54 s standalone, 7.78 s inside `release:gate`). `scripts/budgets.json` has no suite-duration section (keys: `root`, `exportCounts`, `aggregate`, `attentionCompiler`, `startup`, `benchmarkMedians`, `phase7Postgres`, `phase8LoopsHitl`, `workflowLoop`, `phase9`, `enterprisePostgres`, `phase10`, `phase11`, `multiAgentRuntime`, `toolSearch`, `redaction`, `nonNullAssertions`, `docReader`), so no budget row was added.
    - **End-to-end `release:gate`** ran the reference-host leg (38 pass) then stopped at `release.mjs gate` with exit 1: `test:postgres durable conformance: PRISM_TEST_POSTGRES_URL not set` — the same Postgres preflight Task 1 recorded, unchanged. The leg executes in the intended order before that preflight.
    - **Baseline.** `scripts/release-gate.test.mjs` 24 pass / 0 fail. `scripts/phase23-skip-manifest.test.mjs` 8 pass / 0 fail (its `release:gate` ordering pin still holds). App suite 38 pass / 0 fail. No source, export, or compat baseline moved, so no `--update-baseline`.
    - **Pre-existing red (not this task).** `scripts/run-all-tests.test.mjs` 16 pass / 2 fail: `the root stage glob must cover every root dist test file` (179 !== 189) and `every workspace test file runs exactly once`. Both read the stale/partial `dist/` tree and are unaffected by this task's three files; they are part of plan 172's inherited red set (Task 1 (l)).

- [x] Task 8: Delete `packages/prism-code` and everything whose only input is its source
  - Acceptance Criteria:
    - Functional: `packages/prism-code/` is deleted. Per plan 172 Task 1 (i), also deleted or edited in this task:
      - root `package.json`: `workspaces` entry and the `@arnilo/prism-code` step in `build`
      - `scripts/build-prism-code-binaries.mjs`, `scripts/build-prism-code-binaries.test.mjs`, `scripts/e2e-prism-code-{live,long-run,tui}.test.mjs`, `scripts/lib/prism-code-checks.mjs`, `scripts/lib/pty-harness.mjs`, `scripts/prism-code-install-smoke.mjs`
      - `.github/workflows/prism-code-binaries.yml`; the prism-code steps in `release.yml`, `coding-journey.yml`, and `live-matrix.yml`
      - `examples/prism-code-headless.ts`, its `examples/README.md` line, `examples/tsconfig.json` path, and `scripts/e2e-coverage.json` rows
      - `scripts/compat-baseline/arnilo__prism-code.txt`; rows in `scripts/{package-truth.mjs,package-truth.json,independent-packages.json,budgets.json,coverage-thresholds.json,live-matrix.json,live.env.example,phase24-freeze-manifest.json,phase54-package-map.mjs,post-publish-smoke.mjs,run-all-tests.mjs}`, `scripts/{phase24-truth,version-literal-gate,install-sh}.test.mjs`
      - `src/__tests__/{docs,packaging,release,install-smoke}.test.ts` assertions that read the deleted source; assertions about the released `docs/prism-code.md` page stay
      - the `prism-code` references in `packages/credentials/keyring` (`file-store.test.ts` service fixture) and `packages/tools/coding` tests (`docker-sandbox.test.ts`, `egress.test.ts` image fixtures): repoint the fixtures, keep behavior. The `packages/providers/openai` hits are the OAuth client id `prism-codex` (`src/oauth.ts`, `codex-oauth.test.ts`), not the lab; keep them (behavior)
      - `install.sh` and `scripts/install-sh.test.mjs`: keep (Task 1 (i); they download the published binary). Task 8 finding: the test imported `TARGETS`/`tarEntries` from the deleted `scripts/build-prism-code-binaries.mjs`; inline a local release-target list and the ustar writer instead. Do not edit `.github/codeql/codeql-config.yml` (name `prism-codeql` is a false hit). Frozen history stays: `scripts/phase54-package-map.mjs` (0.3.3 legacy registry, `retiredPackages` is asserted at 55) and `scripts/phase24-freeze-manifest.json` (0.2.3 deviation record)
      - `bun.lock`, `package-lock.json`
    - Functional: Kept: `docs/prism-code.md` (released 0.4.1 page; Phase 11 retires it) and its `docs/index.md` link, the `npm-deprecate.yml` entry for `@arnilo/prism-code` (Phase 11 runs it), `install.sh` and `scripts/install-sh.test.mjs` (published-binary download; Phase 11), `CHANGELOG.md` history, `roadmap.md`, and the released pages that only mention the name (`docs/coding-security.md`, `docs/agent-loops.md`, `docs/release-and-install.md`, `docs/live-testing.md`). `.github/codeql/codeql-config.yml` is not a prism-code input. The generated package-truth inventory blocks in `README.md`, `docs/index.md`, `docs/release-and-install.md`, and `docs/provider-packages.md` are regenerated (`bun scripts/package-truth.mjs --emit-docs`): only the deleted package's row leaves, the released prose stays.
    - Functional: **Retirement sweep** (probe 6): `rg -n "prism-code|prism_code|PRISM_CODE" src/ packages/ apps/ scripts/ examples/ docs/ .github/ install.sh package.json`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, returns only the kept items above. The note lists the command and the remaining hits. Plan-173 additions that must name the deleted package: the new `prism_code_package_is_gone` test and the `docs.test.ts` retired-name exemption.
    - Functional: **Baseline** (probe 7): `bun scripts/release.mjs gate --update-baseline` (or the `runGates` compatibility leg if the Postgres preflight still blocks); the note records the diff — the removed `arnilo__prism-code.txt` attributed to this plan, any other change attributed or explained.
    - Functional: Lab behavior in Further Actions of earlier plans that named a `packages/prism-code` module "deleted in Phase 12" (`rg -n "Phase 12" plans/backlog.md`) is resolved: each backlog entry that tracked the lab is removed or rewritten, and the titles are named in the task note (SKILL.md "Plan end").
    - Performance: Root `build` loses one workspace build; record the before/after `bun run build` time.
    - Code Quality: No stub, alias, or redirect package left in place.
    - Security: The deleted lab's MCP trust file, synthesized identity, and approval engine have no remaining caller (`graft callers` on each retired symbol, recorded).
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 12 Scope ("`packages/prism-code` is deleted"), Phase 11 (npm deprecation), Version targets; plan 172 Task 1 (i); `plans/backlog.md` lab rows ("Fix prism-code limits.test.ts session await", "Delete the lab's MCP trust file and synthesized identity", "Lab observationalMemory.credentialRef is parsed and unused", and others)
    - Options Considered:
      - Keep `packages/prism-code` until Phase 11 deprecates it on npm. Rejected: the roadmap makes its deletion a Phase 12 Done criterion, and the npm deprecation does not need the source.
      - Move it to `apps/prism-code`. Rejected: the roadmap says deleted, not ported.
    - Chosen Approach:
      - Delete the package and its exclusive tooling in one task, sweep, regenerate the baseline, and clean the backlog rows it owned.
    - API Notes and Examples:
      ```bash
      graft callers createPtyHarness --depth all   # keep pty-harness only if another script uses it
      rg -n "prism-code" src packages apps scripts examples docs .github install.sh package.json --glob '!**/dist/**' --glob '!docs/history/**' --glob '!docs/_evidence/**'
      ```
    - Files to Create/Edit:
      - the paths listed in the Functional criteria (complete list per the Task 1 (i) decision; any path Task 1 adds is listed in the note).
      - `plans/backlog.md`: lab rows removed or rewritten.
      - `CHANGELOG.md`: `## [Unreleased]` line ("`packages/prism-code` removed from the repository; `@arnilo/prism-code` 0.4.1 stays on npm until Phase 11 deprecates it").
    - References:
      - plan 140 (Prism Code distribution, `planned`): close it as `superseded by 173` in `plans/README.md`, with its unexecuted tasks marked `Dropped by plan 173 (<date>): Prism Code deleted in Phase 12`.
  - Test Cases to Write:
    - `prism_code_package_is_gone`: fails if `packages/prism-code` exists or any workspace or build script names it.
    - Updated `packaging.test.ts`, `release.test.ts`, `docs.test.ts`, and `scripts/*.test.mjs` assertions pass with the lab gone.
    - The existing `examples_demos_run_to_completion_and_emit_no_secret` passes without `examples/prism-code-headless.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a workspace package is removed from the repository (not from npm).
    - Docs pages to create/edit:
      - `CHANGELOG.md`: `## [Unreleased]` entry.
      - `docs/prism-code.md`: none — released page, retired in Phase 11.
      - `README.md`: fix a broken link only (plan 172 Task 1 (i)); released-install text stays until Phase 11.
    - `docs/index.md` update: no — the released page stays linked until Phase 11.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped.** Deleted `packages/prism-code/` (root `package.json` `workspaces` entry and the `build` filter), its exclusive tooling (`scripts/build-prism-code-binaries{,.test}.mjs`, `scripts/e2e-prism-code-{live,long-run,tui}.test.mjs`, `scripts/lib/{prism-code-checks,pty-harness}.mjs`, `scripts/prism-code-install-smoke.mjs`, `.github/workflows/prism-code-binaries.yml`), `examples/prism-code-headless.ts` (+ `examples/README.md`/`tsconfig.json`/`scripts/e2e-coverage.json` rows), `scripts/compat-baseline/arnilo__prism-code.txt`, and the prism-code rows/edits in `release.yml` (the whole `post-publish-smoke` job and the pre-publish smoke step), `coding-journey.yml` (the PTY TUI job), `live-matrix.yml`, `scripts/{package-truth.mjs,independent-packages.json,budgets.json,coverage-thresholds.json,live-matrix.json,live.env.example,phase24-freeze-manifest.json,post-publish-smoke.mjs,run-all-tests.mjs,version-literal-gate.test.mjs}`, `src/__tests__/{docs,packaging,release,install-smoke}.test.ts`, `packages/credentials/keyring` and `packages/tools/coding` fixtures, `bun.lock`, `package-lock.json`, and `plans/README.md`. Added `prism_code_package_is_gone` to `packaging.test.ts`.
    - **`install-sh.test.mjs` did import the deleted source.** Task 1 (i) recorded that it does not, but it imported `TARGETS`/`tarEntries` from `scripts/build-prism-code-binaries.mjs`. Inlined a local `RELEASE_TARGETS` list and the deterministic ustar `tarEntries` writer; `install.sh` and the rest of its test are untouched. `scripts/install-sh.test.mjs` 7 pass / 1 skip (docker leg).
    - **False positives and frozen history kept.** `packages/providers/openai/{src/oauth.ts,src/__tests__/codex-oauth.test.ts}` match only inside the OAuth client id `prism-codex`; kept (behavior). `scripts/phase54-package-map.mjs` (0.3.3 legacy registry; its suite asserts `retiredPackages === 55`) and `scripts/phase24-freeze-manifest.json` (0.2.3 deviation record) are frozen history; kept. `src/__tests__/reference-host-boundary.test.ts` keeps `@arnilo/prism-code` in its reject list and seeded violation — the plan 172 Task 3 boundary still rejects the npm-published name. `.github/codeql/codeql-config.yml` (`prism-codeql`) and `packages/tools/coding/CHANGELOG.md` history kept.
    - **Generated docs.** `bun scripts/package-truth.mjs --emit-docs` regenerated the inventory blocks in `README.md`, `docs/index.md`, `docs/release-and-install.md`, and `docs/provider-packages.md`, plus `docs/_evidence/phase54-package-map.md`; only the deleted package's row left. `package-truth.json` counts: publishable 65 → 64, workspace 64 → 63, capability 40 → 39, pureManifest 2 → 1 (codeWithPeer 62 unchanged; the app had no core peer).
    - **Test-count updates (pre-existing drift absorbed).** `phase24-truth.test.mjs` 62/61/37/59/2 → 64/63/39/62/1 (plans 170-172 added remote/headless/tools-research). `version-literal-gate.test.mjs` manifest count 63 → 64, `INDEPENDENT_LINES` drops the app, and the positive-control dependent fragment is removed (nothing depends on the SDK now). `release.test.ts` accepts an Unreleased-first changelog for packages added after the 0.1.0 anchor (driver-process, remote, headless, research). `docs.test.ts` exempts the published app from the retired-0.3-name sweep (still 34 names).
    - **Plan 140.** Every task in `plans/140-*.md` was already `[x]` (the work shipped), so there were no unexecuted tasks to mark dropped; `plans/README.md` status set to `superseded by 173 (Prism Code deleted in Phase 12)`.
    - **Backlog (SKILL "Plan end").** 21 lab-tracking `plans/backlog.md` entries removed: "Prism Code coverage floor at the measured minimum", "Prism Code bin has no post-publish smoke", "Add a prism-code bin smoke to post-publish verification", "Prism Code headless subpath without OpenTUI", "Raise Prism Code coverage with TUI component suites", "Re-export `formatMcpStatus` and footer counts from the prism-code barrel", "PTY journey streaming budget is throughput, not per-frame latency", "Prism Code synthesizes its own local durable-effect identity", "Extend the PTY TUI journeys to the remaining interactive paths", "Wire the Codex refresh-token live leg into CI", "Add a PTY-driven first-run TUI smoke", "Live `/logout` leg against the real keychain", "Live compaction leg for the observational-memory worker", "Isolate Prism Code's tests from the real home directory", "Delete the dead TUI approval prompt in Phase 12", "Fix the pre-existing prism-code AgentConfig.tools drift tests", "Phase 12 lab residue", "Delete or map the unused observationalMemory.credentialRef", "Fix prism-code limits.test.ts session await", "Lab observationalMemory.credentialRef is parsed and unused", "Delete the lab's MCP trust file and synthesized identity". Two rewritten to drop the lab reader: "Move the remaining readers of `agent.config.tools` / `skills` onto the merged view" (only `wrapTools` remains) and "Move the hosts onto `session.resume` and delete the checkpoint lifecycle".
    - **Baseline (probe 7).** `bun scripts/release.mjs gate --update-baseline` still runs `checkReleaseEvidence` first and stops at the Postgres preflight, so the compat leg ran via `runGates({ updateBaseline: true, skipTarball: true })`: `{"version":"0.12.1","updated":true,"packages":64}`. Diff: only the removed `scripts/compat-baseline/arnilo__prism-code.txt`; every remaining baseline was already current (`release-gate.test.mjs > compat baselines are current` still passes), so no other change is attributed to this task.
    - **Sweep (probe 6).** `rg -n "prism-code|prism_code|PRISM_CODE" src/ packages/ apps/ scripts/ examples/ docs/ .github/ install.sh package.json` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, `scripts/compat-baseline/`) returns: kept released pages `docs/prism-code.md` (38), `docs/release-and-install.md` (21), `docs/index.md` (2), `docs/live-testing.md`, `docs/coding-security.md`, `docs/agent-loops.md`; kept `install.sh` (21) and `scripts/install-sh.test.mjs` (14); kept `.github/workflows/npm-deprecate.yml` (3); frozen history `scripts/phase54-package-map.mjs` (2), `scripts/phase24-freeze-manifest.json` (1), `packages/tools/coding/CHANGELOG.md` (1), `scripts/budgets.json` (1, naming the kept `docs/prism-code.md`); false positives `packages/providers/openai` (2 = `prism-codex`) and `.github/codeql/codeql-config.yml` (1 = `prism-codeql`); the plan-172 boundary gate `src/__tests__/reference-host-boundary.test.ts` (2); and the plan-173 tests that must name the deleted package (`src/__tests__/packaging.test.ts` 8, `src/__tests__/docs.test.ts` 3). `apps/`, `examples/`, and the deleted package's exclusive tooling are clean.
    - **Security.** No live caller of the lab's retired symbols: `readMcpTrust`, `writeMcpTrustDecision`, `isMcpServerTrusted`, `mcpTrustPath`, `createMcpAuthState`, `assembleAppAgent`, `PromptApprovalAction`, and `loadPermissionRules` all return zero hits outside the deleted package; the MCP trust file, synthesized identity, and approval engine lived only in `packages/prism-code/src/{mcp,approval}.ts`.
    - **Performance.** Root `build` loop builds 3 packages instead of 4; incremental `bun run build` wall 2 s (core dist cached).
    - **Checks.** `bun run typecheck` exit 0 (after fixing a `readPkg(...).scripts` unknown-type error in the new test). `phase24-truth` 13/0, `version-literal-gate` 3/0, `release.test.ts` 8/0, `reference-host-boundary` 4/0, `release-gate.test.mjs` 24/0, `phase23-skip-manifest` 8/0, `install-sh.test.mjs` 7/0/1 skip, app suite 38/0. `packaging.test.ts` 334 pass / 3 fail, `docs.test.ts` 148 pass / 22 fail — both unchanged from the Task 1 baseline (same pre-existing failures).
    - **Pre-existing red (not this task).** `run-all-tests.test.mjs` 2 (stale `dist/` glob), `phase54-package-map.test.mjs` 2 (`@arnilo/prism-remote must be classified` — plans 170-172 drift), `package-truth.test.mjs` 3 (throwaway-manifest fixtures missing name/version), `packaging-current.test.mjs` 2 (install-smoke hand list omits driver-process/remote/headless/research; ACP `m.parseConfig`), `tooling-gate.test.mjs` 4 (the `git ls-files` sweep reads files already deleted in the working tree, e.g. `packages/web-tools/`), `truth-current.test.mjs` 1 (`package.json` still names the deleted `scripts/phase10-conformance.test.mjs`).

- [x] Task 9: `apps/prism-agent/README.md` walkthrough, the docs index link, and the docs-rule carve-out
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/README.md` is a walkthrough of how a host is built, not a product page:
      1. what Prism Agent is (a private reference host for testing and proof; not an API; copy, never depend)
      2. where things go (§2.13.1 table, applied to this host)
      3. each agent and why it has its packages, with links into `src/host/*`
      4. the workflow graph, gates, and how the orchestrator starts it
      5. external and remote workers, and attribution (`origin`, `executedBy`, `origin.remote`)
      6. `HostUi` routing, suspension, and resume
      7. scheduling
      8. entry points: `run`, `resume`, `acp` (with an ACP editor setup snippet), `schedule`, the JSONL format, and the exit-code table
      9. running the scenarios offline, and how the gap log works
    - Functional: `docs/index.md` gains one guide entry linking `../apps/prism-agent/README.md`, one sentence, no plan numbers, and no `definePackage` or `loadManifest` (the index is in the released-page token scan, Task 1 (j)). `.agents/skills/create-plan/references/prism-wiki.md` gains the carve-out: "The reference host walkthrough is linked from `docs/index.md` during the train, per roadmap Phase 12." `src/__tests__/docs.test.ts` gains a test that the link exists and resolves.
    - Functional: `CHANGELOG.md` `## [Unreleased]` names the reference host and the research pack (if Tasks 3 and 2 of plan 172 did not already).
    - Performance: n/a — docs.
    - Code Quality: Every code snippet in the README is taken from `src/host/*` and checked: a docs test asserts each fenced `ts` block's imports are allowed by the boundary gate's allow-list.
    - Security: The README shows credential refs only, never a literal key; a docs test scans it for key-shaped literals.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13, Phase 12 Docs; `.agents/skills/create-plan/references/prism-wiki.md`; `docs/index.md`; `src/__tests__/docs.test.ts` index tests
    - Options Considered:
      - Defer the index link to Phase 11. Rejected: the roadmap requires it in Phase 12, and the roadmap wins over the reference file (plan 172 Task 1 (j)).
    - Chosen Approach:
      - A walkthrough README, one index link, and the matching rule carve-out in the same task.
    - API Notes and Examples:
      ```markdown
      - [Prism Agent reference host](../apps/prism-agent/README.md): a walkthrough of a headless, multi-agent host built on the SDK.
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/README.md`: the walkthrough.
      - `docs/index.md`: one entry.
      - `.agents/skills/create-plan/references/prism-wiki.md`: carve-out.
      - `src/__tests__/docs.test.ts`: link, snippet-import, and literal-secret tests.
      - `src/__tests__/reference-host-allowlist.ts`: the allow-list (`referenceHostPackages`, `classify`, `REJECT`) moved out of the boundary test so the docs snippet check uses the same rules (Task 9 finding).
      - `src/__tests__/reference-host-boundary.test.ts`: imports the shared allow-list; behavior unchanged.
      - `CHANGELOG.md`.
    - References:
      - `packages/hosts/headless/README.md` (walkthrough tone for host libraries)
  - Test Cases to Write:
    - `docs_index_links_reference_host_walkthrough`.
    - `reference_host_readme_snippets_use_public_imports`.
    - `reference_host_readme_has_no_literal_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — docs for a private host.
    - Docs pages to create/edit: as listed above.
    - `docs/index.md` update: yes — one guide entry linking `apps/prism-agent/README.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped.** `apps/prism-agent/README.md` is a nine-section walkthrough: what Prism Agent is, the §2.13.1 layer table applied to this host, the five agents and why each has its packages (links into `src/host/*`), the workflow graph and its gates, external and remote workers with attribution, `HostUi` routing and resume, scheduling, the four entry points with the JSONL format and exit-code table (plus a Zed ACP `agent_servers` snippet), and the offline scenarios and gap log. `docs/index.md` gained one guide entry under Multi-agent and interoperability. `.agents/skills/create-plan/references/prism-wiki.md` records the carve-out. `CHANGELOG.md` gained one line; the reference host and `@arnilo/prism-tools-research` were already named by plan 172's tasks.
    - **Allow-list extraction.** The three docs tests import the real boundary gate rules, so `referenceHostPackages`, `classify`, and `REJECT` moved to `src/__tests__/reference-host-allowlist.ts`; `reference-host-boundary.test.ts` imports them and keeps its `describe` (4 pass / 0 fail, unchanged). The signature stayed `referenceHostPackages(repo?: string)` to keep the compat baseline byte-identical; `classify` and `REJECT` are added-only exports (`exportCounts` ceiling 1718, measured 1683).
    - **Generated docs.** `bun run typecheck` is `bun run build` plus the workspace typechecks, so it emits `dist/`. The two added root exports moved the Phase 54 evidence dist count 1239 → 1241, so `bun scripts/package-truth.mjs --emit-docs` regenerated `docs/_evidence/phase54-package-map.md` and the inventory blocks (`README.md`, `docs/index.md`, `docs/release-and-install.md`, `docs/provider-packages.md`). `scripts/truth-current.test.mjs` returned to 9 pass / 1 fail (the inherited missing `scripts/phase10-conformance.test.mjs` reference) and `scripts/release-gate.test.mjs` is 24 pass / 0 fail.
    - **Checks.** `bun run typecheck` exit 0. `src/__tests__/docs.test.ts` 151 pass / 22 fail (Task 1 baseline 148/22 plus the three new tests). `src/__tests__/reference-host-boundary.test.ts` 4 pass / 0 fail. `@arnilo/prism-agent` 38 pass / 0 fail. `scripts/phase54-package-map.test.mjs` 5 pass / 2 fail (unchanged). `scripts/release-gate.test.mjs` 24 pass / 0 fail.
    - **Flaky read.** One docs run reported 150/23; `all shipped markdown links resolve locally` failed on `docs/_evidence/phase72-primitive-review.md` → `packages/prism-core/src/runtime/workflows/types.ts`, a file plan 168 deleted in the uncommitted working tree. The next run was 151/22. The broken link is pre-existing working-tree drift, not Task 9.

- [x] Task 10: Close the gap log and record the Phase 12 Done criteria
  - Acceptance Criteria:
    - Functional: Every gap-log row in plan 172 has a disposition (`fixed in <file> (<test>)` or `backlog: <title> — <reason>`); none is `open`. Backlog rows are written to `plans/backlog.md` in the SKILL.md entry shape with `Source: plans/172-...` or `plans/173-...`.
    - Functional: The workaround grep from plan 172 Task 6 over `apps/prism-agent/` returns nothing.
    - Functional: A **Phase 12 Done record** in this task's note maps each roadmap Done criterion to the test that proves it:
      - boundary: `reference_host_imports_only_public_surface`
      - orchestrated workflow and origins: `orchestrated_workflow_runs_end_to_end`, `worker_events_carry_correct_origin`
      - approval gates coding: `approval_denies_coding_write`
      - external and remote attribution: `external_events_are_attributed_external`, `remote_events_carry_origin_remote_and_external`
      - headless approval: `headless_approval_suspends_then_channel_resumes_in_fresh_process`
      - scheduled run: `scheduled_run_fires_once_per_tick_across_two_processes`
      - golden JSONL: `one_shot_jsonl_matches_golden`
      - citations: `research_report_citations_resolve`, `research_unresolved_citation_fails_check`
      - gap log closed: this task
      - no TUI library: `reference_host_has_no_terminal_ui_dependency`
      - `packages/prism-code` gone: `prism_code_package_is_gone`
    - Functional: Run the whole-plan verification below; record results against Task 1's baseline. Set both plans' `plans/README.md` status to `complete (<date>)` only when every Done row is proven; otherwise record the blocker in the status as plans 170–171 did.
    - Performance: n/a — verification.
    - Code Quality: n/a — verification.
    - Security: The secret sweeps from both parts pass.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 12 Done; plan 171 Task 8 (Done record pattern)
    - Options Considered:
      - Record Done in plan 172. Rejected: Part B completes the phase.
    - Chosen Approach:
      - Close gaps, map Done to tests, verify, and index.
    - API Notes and Examples:
      ```bash
      bun run --filter @arnilo/prism-agent test
      ```
    - Files to Create/Edit:
      - plan 172: gap-log dispositions.
      - this plan: Done record, Notes.
      - `plans/README.md`: statuses for 172 and 173.
      - `plans/backlog.md`: gap rows moved to the backlog.
    - References:
      - roadmap Phase 11 (consumes this phase's Done)
  - Test Cases to Write:
    - n/a — runs the suites above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit: none — records only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Gap log closed.** Plan 172's `## Gap log` table has zero rows; Part B added none, so every disposition requirement is satisfied vacuously and no `plans/backlog.md` row is written. Plan 172's closing note records the Part B recheck.
    - **Workaround grep empty.** `rg -n "as any|as unknown as|@ts-ignore|@ts-expect-error|prism-[a-z-]+/src/" apps/prism-agent` returns nothing. The README's gap-log paragraph was reworded ("a type-erasing `any` cast") so the prose itself does not trip the sweep; the rule is unchanged.
    - **Phase 12 Done record.** Every roadmap Done criterion maps to a passing test:

      | Roadmap Phase 12 Done criterion | Proving test | Result |
      | --- | --- | --- |
      | boundary: only public surface | `reference_host_imports_only_public_surface` (`src/__tests__/reference-host-boundary.test.ts`) | 4/0 |
      | orchestrated workflow + origins | `orchestrated_workflow_runs_end_to_end`, `worker_events_carry_correct_origin` (`apps/prism-agent/src/__tests__/workflow.test.ts`) | 38/0 app suite |
      | approval gates coding | `approval_denies_coding_write` (`apps/prism-agent/src/__tests__/approval.test.ts`) | 38/0 |
      | external attribution | `external_events_are_attributed_external` (`apps/prism-agent/src/__tests__/external.test.ts`) | 38/0 |
      | remote attribution | `remote_events_carry_origin_remote_and_external` (`apps/prism-agent/src/__tests__/remote.test.ts`) | 38/0 |
      | headless suspend / channel resume | `headless_approval_suspends_then_channel_resumes_in_fresh_process` (`apps/prism-agent/src/__tests__/headless-approval.test.ts`) | 38/0 |
      | scheduled once per tick | `scheduled_run_fires_once_per_tick_across_two_processes` (`apps/prism-agent/src/__tests__/schedule.test.ts`) | 38/0 |
      | golden JSONL | `one_shot_jsonl_matches_golden` (`apps/prism-agent/src/__tests__/golden.test.ts`) | 38/0 |
      | citations resolve / unresolved fails | `research_report_citations_resolve`, `research_unresolved_citation_fails_check` (`apps/prism-agent/src/__tests__/research.test.ts`) | 38/0 |
      | no TUI library | `reference_host_has_no_terminal_ui_dependency` (`src/__tests__/reference-host-boundary.test.ts`) | 4/0 |
      | `packages/prism-code` gone | `prism_code_package_is_gone` (`src/__tests__/packaging.test.ts`) | pass |
      | gap log closed | this note; plan 172's table is empty | — |

    - **Whole-plan verification (vs Task 1 baseline).** `bun run build:core` exit 0. `bun run typecheck` exit 0. `@arnilo/prism-agent` 38 pass / 0 fail (stable over two runs, 6–7 s). `@arnilo/prism-tools-research` 12 pass / 0 fail. `@arnilo/prism-headless` 51 pass / 0 fail. `reference-host-boundary` + `packaging` + `release` 346 pass / 3 fail — the three inherited red: phase48 neuralwatt umbrella, retired provider family workspace, `npm ls` `workspace:*` tree. `release-gate` + `phase24-truth` + `version-literal-gate` 40 pass / 0 fail. `docs.test.ts` 151 pass / 22 fail (Task 1 baseline 148/22 plus Task 9's three new tests). `bun run release:gate` exit 1 at the Postgres preflight (`PRISM_TEST_POSTGRES_URL` unset) after the reference-host leg ran 38 pass / 0 fail; the skip-manifest and client-neutrality legs passed. Retirement sweep: only the documented keeps (released pages, `install.sh` + its test, the plan-173 tests that must name the package, `npm-deprecate.yml`, frozen phase54/phase24/budgets history, the `prism-codex` and `prism-codeql` false positives); `apps/` is clean.
    - **Flake fixed (scheduler).** `scheduled-run-two-processes` read `afterRestart` after a fixed 1.2 s wait; under load the restarted `schedule` process booted later than that, so the run-once catch-up was read as 0 (reproduced 4/4 in isolation). Replaced with a bounded `until("catch-up firing", …)` poll; the skip leg keeps the fixed wait to prove nothing fires. `schedule.test.ts` 4 pass / 0 fail, stable over three runs, ~6 s.
    - **Flake fixed (answer-log ordering).** `answer_log_records_channel_route_without_value` expected `["client","channel","policy"]` but sometimes got `["client","policy","channel"]`. Root cause in `packages/hosts/headless/src/answers.ts`: `answers()` sorted only by the millisecond `at`, and the channel route's abort resolution and the policy fallback were written in the same millisecond, so the tie ordered arbitrarily. The log now stores a monotonic `seq` per record and sorts by `(at, seq)`; the returned `RoutedAnswer` shape is unchanged (the sequence is stripped). `headless-approval.test.ts` 4/0 stable over three runs, `@arnilo/prism-headless` 51/0, `answers.test.ts` 3/0.
    - **Attributed, not fixed.** `host_adapter_passes_adapter_conformance` (`external.test.ts`) is load-sensitive: one heavily loaded parallel run failed its `abort` leg at 5389 ms over the 1000 ms grace bound; it passed in isolation and in the `release:gate` run (5700 ms wall, leg within bound). This is driver-process conformance timing under contention, not a host defect.
    - **Inherited whole-plan red (unchanged).** docs 22, packaging 3, host-surface 1, and `bun scripts/release.mjs gate` blocked on `PRISM_TEST_POSTGRES_URL` — plan 172's `Compromises Made` P3. No failure is new to plan 173.
    - **Statuses.** With every Done row proven, `plans/README.md` marks plan 172 and plan 173 `complete (2026-10-14)`, recording the inherited whole-plan blockers in the status as plans 170–171 did.

## Verification (whole plan)

- `bun run build:core`
- `bun run build`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-agent test`
- `bun run --filter @arnilo/prism-tools-research test`
- `bun run --filter @arnilo/prism-headless test` (only if Task 6 changed it)
- `bun test --timeout=0 src/__tests__/reference-host-boundary.test.ts src/__tests__/packaging.test.ts src/__tests__/release.test.ts`
- `bun test --timeout=0 scripts/release-gate.test.mjs scripts/phase24-truth.test.mjs scripts/version-literal-gate.test.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run release:gate` (record the Postgres preflight state if it still blocks; the reference-host leg runs before `release.mjs gate`)
- `rg -n "prism-code" src packages apps scripts examples docs .github install.sh package.json --glob '!**/dist/**' --glob '!docs/history/**' --glob '!docs/_evidence/**'`

## Compromises Made

- Inherited whole-plan red gates left red. `docs.test.ts` 151/22, packaging 346/3, host-surface 1/1, and `bun scripts/release.mjs gate` blocked on unset `PRISM_TEST_POSTGRES_URL`. No failure is new to this plan. Priority P3. The repair is plan 171's backlog row "Re-run headless release verification after gate repairs"; this plan does not open a second repair.
- `host_adapter_passes_adapter_conformance` is timing-sensitive under parallel load (one loaded run failed the 1000 ms `abort` grace bound at 5389 ms). Left as-is; it passes in isolation and in `release:gate`. Priority P3.
- The `build` workflow schedule target is declared and wired in the CLI but no test fires it across processes; the two-process count uses the research brief target (plan 173 Task 6).

## Further Actions

- Make `host_adapter_passes_adapter_conformance`'s `abort` grace bound tolerant of parallel-suite contention (or give the leg more headroom), so `release:gate` cannot flake on a loaded machine. Priority P3.
- Add a two-process scenario that fires the `build` workflow schedule target (currently declared-only). Priority P3.
