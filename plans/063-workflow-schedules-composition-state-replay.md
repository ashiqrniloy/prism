# Workflow Schedules, Composition, State, and Replay

## Objectives
- Extend existing workflow package with durable schedules and reconnectable background execution without another queue or worker engine.
- Add nested workflow nodes, bounded schema-validated shared state, and lineage-preserving replay.
- Expose selected operations through existing command and Web handler seams, then update Phase 11 roadmap evidence.

## Expected Outcome
- Hosts explicitly create/pause/resume/trigger/delete one-time, interval, or host-calculated schedules backed by existing `CheckpointStore`/`LeaseStore`; due fires enqueue deterministic workflow run IDs for crash-safe idempotency.
- Nested workflows inherit parent ownership, tools, agents, execution policy, abort, redaction, and checkpoint seams; state and replay history remain byte/count/depth bounded.
- Background/replayed runs remain queryable through existing checkpoint status APIs after restart, and source replay evidence is never mutated.

## Tasks

- [x] Inventory reusable workflow, persistence, coordination, and server primitives
  - Acceptance Criteria:
    - Functional: identify exact existing primitives covering durable records, CAS, leases/fencing, queued/background execution, status, events, cancellation, suspension, and Web/RPC exposure.
    - Performance: document which existing bounded polling/page/concurrency/checkpoint paths can be reused without busy loops or duplicate stores.
    - Code Quality: add only generic missing workflow primitives; reject a second queue, scheduler, durable-run engine, cron parser, or framework.
    - Security: map ownership, redaction, execution policy, fencing, approval, and replay trust boundaries before implementation.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11; `docs/workflows.md`; `docs/workflow-orchestration-primitives.md`; `docs/database-persistence.md`; `docs/server.md`; `docs/cli-rpc.md`.
      - `packages/workflows/src/{types,run,coordinator,checkpoints,commands,status,events}.ts`; core `CheckpointStore` and `LeaseStore`; SQLite/PostgreSQL generic checkpoint/lease adapters.
    - Options Considered:
      - New schedule tables and worker engine: duplicates generic checkpoint/lease persistence and coordinator; rejected.
      - Generic checkpoint namespace plus lease/CAS and deterministic run IDs: smallest durable composition; chosen.
      - Cron parser dependency: excluded; one-time, interval, and host calculator IDs cover required behavior.
    - Chosen Approach:
      - Reuse generic checkpoint namespaces for schedules and workflow run checkpoints for queued/background/replay runs. Reuse `LeaseStore` only for due-fire exclusion and CAS for administrative updates.
    - API Notes and Examples:
      ```ts
      const schedules = createWorkflowSchedules({ store, leases, checkpoints, workflows, ownerId: "worker-1" });
      await schedules.pollOnce();
      ```
    - Files to Create/Edit:
      - `plans/063-workflow-schedules-composition-state-replay.md`: executable Phase 11 plan.
    - References:
      - `packages/workflows/src/coordinator.ts`, `packages/workflows/src/checkpoints.ts`, `src/contracts.ts`, `src/checkpoints.ts`, `src/leases.ts`.
  - Test Cases to Write:
    - Primitive inventory review: confirm generic SQLite/PostgreSQL adapters already persist arbitrary checkpoint namespaces and leases, requiring no migration.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit: none for inventory; implementation tasks own public docs.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded shared state, nested workflow nodes, and immutable replay lineage
  - Acceptance Criteria:
    - Functional: workflow nodes may run a child workflow; nodes read/update shared JSON state validated by a host callback; replay creates a new run from a succeeded node while retaining immutable source lineage and predecessor evidence.
    - Performance: nested depth, state bytes/history, replay depth, checkpoint bytes, and node count retain defaults and hard caps.
    - Code Quality: nested execution calls the same runner; replay constructs a new checkpoint consumed by `resumeWorkflow`; no duplicate scheduler.
    - Security: child workflows inherit parent seams and cannot supply broader tools/credentials; replay ownership must match; copied paths containing durable approvals are rejected so approval runs again.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md`; Phase 8 suspension/resume sections; `packages/workflows/src/run.ts`, `types.ts`, `define.ts`, `util.ts`.
    - Options Considered:
      - Copy/mutate source checkpoint: destroys evidence; rejected.
      - Event-only replay reconstruction: storage adapters do not guarantee a workflow event ledger; rejected.
      - New checkpoint with copied strict ancestors and lineage pointer: chosen.
    - Chosen Approach:
      - Add `workflowNode()`, state config/context update APIs, bounded state snapshots keyed by state version, and `replayWorkflow()` that restores the selected node's pre-state and queues only that node/downstream work.
    - API Notes and Examples:
      ```ts
      const nested = workflowNode({ workflow: child, input: ({ state }) => state });
      await ctx.updateState({ reviewed: true });
      const replay = await replayWorkflow(workflow, { sourceRunId, fromNodeId: "review" }, options);
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts`, `limits.ts`, `nodes.ts`, `define.ts`, `run.ts`, `util.ts`, `index.ts`.
      - `packages/workflows/src/replay.ts` and focused tests.
    - References:
      - Existing `runWorkflow`, `resumeWorkflow`, `WorkflowCheckpointValue`, Phase 8 expected-version CAS.
  - Test Cases to Write:
    - Nested success/failure/suspend/cancel and max depth.
    - Shared merge/replace state, async validation, byte/history bounds, redaction, and restart restoration.
    - Replay lineage/source immutability, selected downstream side effects only, ineligible node/ownership/depth rejection, and fresh approval requirement.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; node kind, context, checkpoint, result/event, and replay APIs change.
    - Docs pages to create/edit:
      - `docs/workflows.md`: composition/state/replay API and examples.
      - `docs/workflow-orchestration-primitives.md`: reuse and security decisions.
    - `docs/index.md` update: yes; workflow entry mentions composition/state/replay.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add durable schedules and explicit background execution over existing coordinator
  - Acceptance Criteria:
    - Functional: create/get/list/pause/resume/trigger/delete and due polling work for one-time, fixed interval, and registered host calculator schedules; fires enqueue deterministic background run IDs.
    - Performance: page size, claims per poll, interval, input/record bytes, schedule count page, and polling delay are bounded; idle operation waits on host polling or one timer.
    - Code Quality: schedule records use `CheckpointStore`, claims use `LeaseStore`, and execution uses `enqueueWorkflow`/`WorkflowCoordinator`.
    - Security: non-empty ownership is mandatory, persisted input is redacted/bounded, workflow IDs resolve from host registry, and cross-owner operations fail closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/workflows/src/coordinator.ts`; generic checkpoint/lease contracts and production implementations; `docs/database-persistence.md`.
    - Options Considered:
      - Persist callback functions/cron strings: non-portable and unsafe; rejected.
      - Persist calculator IDs resolved from explicit host map: chosen.
    - Chosen Approach:
      - Add `createWorkflowSchedules()` facade with schedule namespace records, per-fire leases, CAS updates, deterministic run IDs, manual idempotency keys, and abortable `run()` polling.
    - API Notes and Examples:
      ```ts
      await schedules.create({ id: "daily", workflowId: "cleanup", nextRunAt, intervalMs: 86_400_000, input });
      await schedules.trigger("daily", { idempotencyKey: "manual-2026-07-16" });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/schedules.ts`, `types.ts`, `limits.ts`, `index.ts`.
      - `packages/workflows/src/__tests__/schedules.test.ts`; checkpoint conformance/live adapter coverage if generic seams expose a defect.
    - References:
      - `CheckpointStore`, `LeaseStore`, `enqueueWorkflow`, `createWorkflowCoordinator`.
  - Test Cases to Write:
    - One-time/interval/calculator creation and firing; duplicate/concurrent poll; crash-equivalent duplicate enqueue; pause/resume/manual trigger/delete/restart.
    - Ownership, malformed timestamps/intervals/calculator IDs, size/page/claim caps, and abortable idle run.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; schedule and background APIs/events are new.
    - Docs pages to create/edit:
      - `docs/workflows.md`: schedules/background API.
      - `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`: generic namespace reuse and no migration.
    - `docs/index.md` update: yes; workflow entry mentions schedules/background runs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Expose selected enqueue/replay/schedule operations through commands and Web routes
  - Acceptance Criteria:
    - Functional: command hosts can opt into workflow enqueue/replay and schedule operations; Web hosts can explicitly register a schedule service and use ownership-authorized routes.
    - Performance: existing request/concurrency/body/result/time limits remain in force; command/page limits delegate to bounded workflow APIs.
    - Code Quality: bindings stay thin adapters over package APIs and remain absent unless explicitly configured.
    - Security: Web authorization ownership overrides request payload identity; MCP/RPC command exposure remains explicit; no schedule or replay capability auto-registers.
  - Approach:
    - Documentation Reviewed:
      - `packages/workflows/src/commands.ts`; `packages/server/src/{types,handler}.ts`; `docs/server.md`; `docs/cli-rpc.md`; `docs/mcp-tools.md`.
    - Options Considered:
      - Generic arbitrary command HTTP endpoint: broadens attack surface; rejected.
      - Small typed routes plus optional command additions: chosen.
    - Chosen Approach:
      - Extend `createWorkflowCommands()` conditionally when schedule service exists and add explicit enqueue/replay; extend `createPrismHandler()` only with registered workflow/schedule routes.
    - API Notes and Examples:
      ```ts
      createWorkflowCommands({ workflows, checkpoints, schedules });
      createPrismHandler({ workflows, schedules, authorize });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/commands.ts` and command tests.
      - `packages/server/src/types.ts`, `handler.ts`, server tests.
    - References:
      - Existing five workflow commands and Phase 10 seven Web operations.
  - Test Cases to Write:
    - Enqueue/replay command success/error/ownership; conditional schedule command registration.
    - Web create/list/pause/resume/trigger/delete plus enqueue/replay authorization, body limits, unknown IDs, and cross-owner denial.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; command names and server routes/operations change.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`, `docs/server.md`, `docs/mcp-tools.md`.
    - `docs/index.md` update: no new page; existing workflow/server entries update in final task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Document, package, benchmark, and complete Phase 11 validation
  - Acceptance Criteria:
    - Functional: public exports, docs, examples, migration/release/review coverage, roadmap evidence, and plan status match shipped behavior.
    - Performance: focused benchmarks verify bounded polling/nesting/replay/state paths and remain within existing test/package ceilings.
    - Code Quality: build/typecheck/examples/tests/packs pass with no `any` casts, ignores, empty catches, or source-text-only API tests added.
    - Security: audit is clean; redaction, ownership, approval replay, abort, lease/CAS, and no-hidden-activation tests pass.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; release/install, migration, performance, review coverage, examples index, package README/changelog.
    - Options Considered:
      - Add another package/profile dependency: unnecessary; rejected.
      - Extend existing workflows package only: chosen.
    - Chosen Approach:
      - Add one focused example, update existing API pages and release evidence, run `npm run sdk:ready`, audit, dry-run packs, and record measured results.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      ```
    - Files to Create/Edit:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, persistence/server/CLI/MCP/index/migration/performance/review/release docs.
      - `examples/workflow-schedules-replay.ts`, `examples/README.md`, package/root changelogs and READMEs, `roadmap.md`, this plan.
    - References:
      - Prism wiki page template and Phase 0 performance baseline.
  - Test Cases to Write:
    - Full `sdk:ready`, audit, diff check, direct example run, package tarball measurement, and no hidden schedule startup smoke.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; all Phase 11 APIs require discoverable docs.
    - Docs pages to create/edit:
      - Existing workflow, server, MCP, CLI, persistence, migration, performance, release, review coverage pages; no new API page because `docs/workflows.md` owns package API.
    - `docs/index.md` update: yes; workflow navigation description changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Schedules are generic checkpoint namespace records, not new SQLite/PostgreSQL tables. Existing production checkpoint/lease conformance and live tests cover storage/claims; Phase 11 adds deterministic in-memory end-to-end schedule tests and no duplicate adapter-specific suite or migration.
- One poll scans one bounded active-schedule page (default 100, hard 500). Hosts with more schedules shard ownership/services or raise `pageSize`; no unbounded scan or database-specific due-time query was added.
- Fixed intervals skip missed ticks instead of catch-up firing. This prevents restart storms; hosts needing calendar/catch-up semantics use an explicit calculator ID.
- State history is immutable and bounded; the next update fails at the configured history ceiling rather than silently dropping replay evidence. Aggregate checkpoint bytes remain the final limit.
- Replay supports succeeded source runs and reruns the selected node plus its full descendant closure. It is checkpoint replay, not event-by-event time travel or arbitrary mutation of old evidence.
- Nested workflows keep separate child checkpoints derived from parent run/node IDs. This makes restart/suspension durable with existing adapters, at the cost of additional bounded records.
- Schedule administration returns `ERR_PRISM_WORKFLOW_SCHEDULE_BUSY` during a concurrent fire instead of waiting/retrying inside the package. Host retry policy remains explicit and prevents hidden polling.

## Further Actions
- Priority medium: add an optional store-native due-schedule query seam only if production hosts exceed 500 active schedules per ownership shard; retain generic checkpoint fallback.
- Priority medium: add calendar/cron adapters as separate host packages only after a concrete timezone/DST requirement; do not add a cron parser to Prism.
- Priority medium: add a state-history compaction/checkpoint policy only if real workflows hit 32 snapshots and can define which replay points remain immutable.
- Priority low: add immutable workflow event-ledger replay if hosts need event-by-event diagnostics beyond checkpoint lineage.
- Priority low: add PostgreSQL multi-scheduler journey coverage to release CI if generic checkpoint/lease conformance stops adequately covering schedule namespace usage.
