# Workflow Orchestration

## Objectives

- Add optional workflow/DAG orchestration over existing agents, sessions, events, persistence, tools, and approvals.
- Make workflow orchestration feature-complete for single-process and multi-process hosts without requiring an interactive TUI.
- Keep workflow semantics outside core and built on generic primitives delivered by Plans 053–056.

## Expected Outcome

- Hosts can define typed bounded workflows with dependencies, retries, timeouts, conditionals, fan-out/join, checkpoints, resume, cancellation, events, and approval/permission propagation.
- Hosts can enqueue, exclusively claim, start, observe, list, cancel, recover, and resume workflow runs across processes through public package APIs (and optional RPC/`CommandDefinition` bindings) without building a terminal UI.
- `@arnilo/prism-workflows` remains optional, network-free in default tests, provider/tool agnostic, and supports SQLite/PostgreSQL-backed distributed leases with stale-worker fencing.
- Interactive TUI (review gap **C-012**) is explicitly out of scope for this plan and deferred indefinitely.

## Tasks

- [x] 0. Review orchestration, CLI/RPC, event, approval, and persistence primitives
  - Acceptance Criteria:
    - Functional: Inventory shows what existing sessions, loops, events, middleware, run ledgers, stores, CLI/RPC, tool approvals, multimodal resources, and abort signals already provide for workflows.
    - Performance: Design sets workflow node/concurrency/output/checkpoint/event-buffer limits.
    - Code Quality: Only reusable missing primitives are proposed; workflow semantics remain in an optional package, not core.
    - Security: Threat model covers untrusted workflow definitions, cycles/fan-out, resumed state tampering, secret persistence/display, shell/tool approval context, and tenant isolation.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/agent-loops.md`, `docs/session-stores-and-branching.md`, `docs/cli-rpc.md`, `docs/host-security.md`, and Plans 053–056 APIs.
    - Options Considered:
      - Add workflow state machine to core: rejected.
      - Optional package consuming stable runtime/event/persistence seams: chosen.
      - Ship interactive TUI in the same plan: rejected after Task 0 (user decision; C-012 deferred).
    - Chosen Approach:
      - Write primitive inventory and a minimal public `@arnilo/prism-workflows` design before package implementation; treat CLI/RPC as the host control seam instead of a TUI.
    - API Notes and Examples:
      ```ts
      const workflow = defineWorkflow({
        nodes: { research, draft, review },
        edges: [["research", "draft"], ["draft", "review"]],
      });
      ```
    - Files to Create/Edit:
      - `docs/workflow-orchestration-primitives.md` (from Task 0 inventory; TUI scope removed), `docs/review-coverage-2026-07-14.md`, `docs/index.md`.
    - References:
      - Review capability gap #9 (C-009). C-012 recorded as deferred, not implemented here.
  - Test Cases to Write:
    - Design matrix includes cycle, bounded fan-out, resume/version mismatch, abort, redaction/tenant isolation, approval metadata, and event overflow.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no implementation yet.
    - Docs pages to create/edit: `docs/workflow-orchestration-primitives.md`, review matrix.
    - `docs/index.md` update: yes — Workflow orchestration design entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Task 0 inventory originally landed as `docs/workflow-tui-primitives.md` with frozen `@arnilo/prism-workflows` design, performance limits, and threat model. Follow-up rework removes TUI from Plan 057 scope and retargets the inventory to `docs/workflow-orchestration-primitives.md`.

- [x] 1. Confirm checkpoint and event-multiplexing primitive decisions; lock package adapter contracts
  - Acceptance Criteria:
    - Functional: Existing APIs are reused wherever sufficient; any new core primitive supports both workflow and non-workflow hosts and has conformance tests. Default remains **no core change**.
    - Performance: Event fan-in is bounded/backpressured in the package; checkpoint serialization is deterministic and size-bounded (`maxCheckpointBytes`, `maxNodeOutputBytes`).
    - Code Quality: No workflow node type or package-specific state enters core; skip core code entirely if inventory remains sufficient.
    - Security: Checkpoints are redacted before persistence, versioned, validated, and tenant/session scoped; event streams cannot bypass redaction.
  - Approach:
    - Documentation Reviewed:
      - Task 0 inventory; session/run/event/store contracts; `ProductionPersistenceStore` custom-query patterns; SQLite/Postgres shared-handle options.
    - Options Considered:
      - Package-local `WorkflowCheckpointAdapter` + package `WorkflowEventBus` over `session.subscribe()`: originally chosen, superseded by Task 6 for reusable storage/fan-in mechanics.
      - Generic core checkpoint/event primitives: originally rejected, added in Task 6 after architecture review.
    - Chosen Approach:
      - Keep workflow-domain contracts package-local; Task 6 supplies generic core mechanics and persistence-owned storage.
    - API Notes and Examples:
      ```ts
      export interface WorkflowCheckpointAdapter {
        save(input: WorkflowCheckpointSaveInput): Promise<void>;
        load(input: WorkflowCheckpointLoadInput): Promise<WorkflowCheckpointRecord | null>;
        list?(input: WorkflowCheckpointListInput): Promise<WorkflowCheckpointListPage>;
      }

      const persistence = createSqlitePersistence({ filename: path });
      const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints });
      ```
    - Files to Create/Edit:
      - No core contracts/implementation/tests (confirmed unnecessary).
      - `docs/workflow-orchestration-primitives.md`, `docs/index.md`, `docs/review-coverage-2026-07-14.md`.
    - References:
      - Create-plan primitive-first requirement; Task 0 ADR table; Task 1 confirmation section.
  - Test Cases to Write:
    - Documented conformance matrix (resume/version conflict, size bound, redaction, tenant mismatch, abort during save/load, event overflow) — executed by Task 3 adapter tests against locked contracts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no core API change.
    - Docs pages to create/edit: `docs/workflow-orchestration-primitives.md` (locked contracts), `docs/index.md`.
    - `docs/index.md` update: yes — Task 1 lock noted.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Original Task 1 decision kept checkpoint/fan-in logic package-local; Task 6 supersedes that part after review by adding generic core `CheckpointStore` and `EventMultiplexer`. `ApprovalHandler`, DAG types, and workflow event payloads remain correctly outside core.

- [x] 2. Ship typed bounded workflow orchestration package
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-workflows` validates acyclic definitions; executes dependency-ready nodes; supports agent/function/tool nodes; typed input/output mapping; conditionals; bounded fan-out/join; per-node retries/timeouts; failure policy (fail-fast); package-local `WorkflowEvent` stream; cancellation via `AbortSignal`; in-memory checkpointing sufficient for single-process resume within a run.
    - Performance: Global/per-workflow concurrency and fan-out are finite; scheduler stores O(nodes + active outputs), not duplicate transcripts; ready-node lookup avoids repeated full scans at the 1,000-node target.
    - Code Quality: Kahn-style DAG/topological scheduling and existing agent/store/event contracts only; no DSL parser, external coordinator dependency, hidden provider abstraction, or TUI dependency; Task 7 later adds the package-local distributed coordinator.
    - Security: Definition/input validation, permission/`ExecutionPolicy` propagation with `workflowId`/`nodeId` metadata, tenant isolation hooks, redaction before checkpoint/event persistence, timeout/abort, and untrusted dynamic fan-out bounds are mandatory.
  - Approach:
    - Documentation Reviewed:
      - Task 0/1 primitive decisions; runtime, branching, compaction/retry, tools, persistence, observability docs.
    - Options Considered:
      - External general-purpose workflow engine dependency: rejected.
      - Bounded checkpointed DAG package: chosen; Task 7 adds database-backed multi-process ownership without changing DAG semantics.
    - Chosen Approach:
      - Kahn-style DAG scheduler with bounded worker pool, deterministic event/result ordering by `(sequence, nodeId)`, explicit checkpoint adapter seam, and ordinary async node functions. Agent nodes call public `AgentSession.run()` only.
    - API Notes and Examples:
      ```ts
      const result = await runWorkflow(workflow, input, {
        concurrency: 4,
        checkpoints,
        agentFactory,
        runLedger,
        ownership: { tenantId: "t1" },
        signal,
        onEvent: (event) => sink.push(event),
      });
      ```
    - Files to Create/Edit:
      - New `packages/workflows/{package.json,tsconfig,src/**,tests,README.md,CHANGELOG.md}`.
      - Root workspace/lock/build/export/install/pack files; umbrella package inclusion decision.
      - `docs/workflows.md`, `docs/agent-session-runtime.md`, `docs/session-stores-and-branching.md`, `docs/observability.md`, `docs/index.md`.
    - References:
      - Review capability gap #9 (C-009).
  - Test Cases to Write:
    - DAG validation/cycle, diamond join, condition skip, fan-out bound, retry/timeout, abort mid-node, deterministic events, redaction/tenant metadata on tool approvals, agent-node session exclusivity, maxNodes reject.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new workflow package/events/config.
    - Docs pages to create/edit: `docs/workflows.md`, runtime/branching/observability pages.
    - `docs/index.md` update: yes — Workflow orchestration → Workflows.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Shipped `@arnilo/prism-workflows` with Kahn DAG scheduler, six node factories, `WorkflowEventBus`, `createMemoryWorkflowCheckpoints`, `runWorkflow`/`resumeWorkflow`/`getWorkflowRun`/`listWorkflowRuns`. 22 package tests pass; packaging + docs gates green. Excluded from `@arnilo/prism-all`. Durable adapters + RPC commands remain Task 3.

- [x] 3. Ship durable run control, checkpoint adapters, and host control bindings
  - Acceptance Criteria:
    - Functional: Package exports memory plus generic-store `WorkflowCheckpointAdapter`s; first-party SQLite/PostgreSQL persistence supplies the durable core store; supports `resumeWorkflow` from persisted checkpoints; exposes run status query helpers (`getWorkflowRun` / `listWorkflowRuns` or equivalent over checkpoint + ledger metadata); optional `CommandDefinition`/RPC bindings for start/status/cancel/resume so non-TUI hosts can drive workflows through existing CLI/RPC seams.
    - Performance: Checkpoint blobs honor `maxCheckpointBytes`; list/status queries are paginated/bounded; resume does not reload full agent transcripts into the scheduler (session `leafId` reuse only).
    - Code Quality: Adapters and RPC/command bindings consume public persistence/RPC contracts only; no circular package deps; no terminal/readline code.
    - Security: Resume validates tenant/version/schema; tampered or cross-tenant checkpoints fail closed; cancel aborts in-flight node runs; approval prompts/metadata identify workflow/node/action; secrets never written unredacted.
  - Approach:
    - Documentation Reviewed:
      - Task 0/2 designs; `docs/database-persistence.md`, `docs/cli-rpc.md`, `docs/runs-and-usage.md`, coding-security approval pattern.
    - Options Considered:
      - Rely on examples-only checkpoint snippets: rejected (not feature-complete).
      - First-party adapters + public resume/list/cancel APIs + optional RPC commands: chosen (replaces former TUI control surface).
    - Chosen Approach:
      - Implement durable control in `@arnilo/prism-workflows` (generic store facade + run control). Expose optional host bindings via `createWorkflowCommands()` / documented RPC usage so Plan 058 integration can drive workflows without a TUI.
    - API Notes and Examples:
      ```ts
      const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints });
      await resumeWorkflow(workflow, { runId }, { checkpoints, signal });

      // Optional host binding (no TUI):
      runRpcServer({
        createSession,
        commands: createWorkflowCommands({ workflows: registry, checkpoints }),
      });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/**` store facade, run-control, optional commands module + tests; first-party persistence checkpoint implementations.
      - `docs/workflows.md`, `docs/cli-rpc.md`, `docs/database-persistence.md`, `docs/index.md`.
    - References:
      - Former Task 5 control requirements (start/list/cancel/resume/status) moved here as programmatic APIs.
  - Test Cases to Write:
    - Memory/generic-store/SQLite/Postgres checkpoint round-trip, resume after process restart (fake), version/tenant mismatch fail-closed, cancel during node, list/status pagination bounds, RPC/command start/status/cancel/resume, approval metadata includes workflow/node ids.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — checkpoint adapters, resume/list APIs, optional workflow commands.
    - Docs pages to create/edit: `docs/workflows.md`, `docs/cli-rpc.md`, persistence pages as needed.
    - `docs/index.md` update: yes — cross-link workflow control and CLI/RPC.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Initially shipped raw-handle workflow checkpoint factories; Task 6 replaced them with persistence-owned generic `CheckpointStore` implementations plus `createWorkflowCheckpoints({ store })`. Also shipped `cancelWorkflowRun` (active-run registry + orphaned durable abort), and `createWorkflowCommands()` (`workflow.start` / `status` / `list` / `cancel` / `resume`). Terminal checkpoint writes omit the abort signal so cancel always persists. Initial Task 3 gate passed 34 package tests; final Task 6 architecture is covered by its evidence below (Postgres live integration gated by `PRISM_TEST_POSTGRES_URL`). Docs updated: `workflows.md`, `cli-rpc.md`, `database-persistence.md`, `sqlite-persistence.md`, `postgres-persistence.md`, review matrix, package README/CHANGELOG.

- [x] 4. Add workflow examples and persistence/provider/tool integrations
  - Acceptance Criteria:
    - Functional: Examples cover sequential generate→validate, parallel research/join, tool/MCP node with approval, multimodal document workflow, SQLite resume, PostgreSQL resume, observability/event sink, and RPC/command-driven cancel or resume.
    - Performance: Examples use finite concurrency/timeouts and do not require network in automated smoke mode.
    - Code Quality: Examples import only public APIs and double as install-smoke tests; no private fixture shortcuts.
    - Security: Examples use environment/credential resolvers, safe coding policy, redacted telemetry, and no checked-in secrets.
  - Approach:
    - Documentation Reviewed:
      - All package docs from Plans 054–056 and project example conventions.
    - Options Considered:
      - One oversized demo: hard to verify.
      - Small focused examples plus one end-to-end composition: chosen.
    - Chosen Approach:
      - Add executable examples with deterministic fake providers and optional real-provider instructions; include at least one host-control example using workflow commands/RPC instead of any TUI.
    - API Notes and Examples:
      ```bash
      node examples/workflow-research-and-review.ts
      node examples/workflow-sqlite-resume.ts
      node examples/workflow-rpc-cancel.ts
      ```
    - Files to Create/Edit:
      - `examples/workflow-*.ts` (8 files), workflow package tests/README.
      - `docs/workflows.md`, `docs/release-and-install.md`, `docs/index.md`.
    - References:
      - Review requested complete capabilities; install-smoke conventions.
  - Test Cases to Write:
    - Every example runs offline in CI; opt-in integration validates real provider/Postgres separately where already patterned by Plan 056.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; examples document composition.
    - Docs pages to create/edit: `docs/workflows.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — link workflow examples.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Shipped 8 strict-typechecked examples: `workflow-research-and-review.ts` (sequential generate/review validation), `workflow-parallel-research.ts` (bounded fan-out/join plus three concurrent DAG research branches), `workflow-tool-approval.ts` (offline MCP mapping + ExecutionPolicy metadata), `workflow-multimodal-document.ts` (bounded PDF + caller-supplied credential resolver/redaction), `workflow-sqlite-resume.ts`, `workflow-postgres-resume.ts` (opt-in via `PRISM_TEST_POSTGRES_URL`; otherwise safe skip), `workflow-event-sink.ts`, and `workflow-rpc-cancel.ts`. All default runs are network-free and emit no secrets. Added to `examples_demos_run_to_completion_and_emit_no_secret` and `workflow_examples_cover_required_workflow_surfaces`; updated `examples/README.md`, `docs/workflows.md`, and `docs/index.md`.

- [x] 5. Verify workflow orchestration phase
  - Acceptance Criteria:
    - Functional: Workflow package, install/export/pack, examples, resume/control, and integration tests pass; review matrix marks **C-009** implemented/verified; **C-012** explicitly deferred/out of scope (not blocking 0.0.4 workflow completeness).
    - Performance: Scheduler stress tests meet bounds with 1,000 nodes and bounded event buffers; no unbounded checkpoint growth.
    - Code Quality: Public imports only; package exports/README/changelog/docs links pass; no TUI package or terminal dependency remains in Plan 057 deliverables.
    - Security: Definition/checkpoint/secret/approval/tenant tests and audit pass.
  - Approach:
    - Documentation Reviewed:
      - Tasks 0–4 docs and package/release gates.
    - Options Considered:
      - Manual-only verification: non-repeatable.
      - Automated package + example + stress suite with evidence recorded in review coverage: chosen.
    - Chosen Approach:
      - Run offline automated suites, package smoke, and record evidence for Plan 058.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-14.md`; plan completion evidence.
    - References:
      - Plan 058.
  - Test Cases to Write:
    - No new product cases; execute all 057 tests and record gate evidence.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: review coverage evidence.
    - `docs/index.md` update: no additional entry unless navigation drift found.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `npm run sdk:ready` passes: strict typecheck; 1,437 tests (1,412 pass, 25 explicit live skips, 0 failures); all workspace builds; 8 workflow examples; fresh offline install smoke; packaging guard; all dry-run packs. Workflow package includes the bounded 1,000-node DAG stress test. `npm audit --audit-level=high` reports 0 vulnerabilities; `npm ls --all --depth=0` is clean. Root/CI `test:postgres` covers session/run/query persistence plus generic checkpoints when `PRISM_TEST_POSTGRES_URL` is present. C-009 is verified; C-012 remains deferred. No TUI/readline package or dependency exists.

- [x] 6. Promote checkpoints and bounded event fan-in to reusable core primitives
  - Acceptance Criteria:
    - Functional: Core exports a database-neutral `CheckpointStore` and bounded `EventMultiplexer`; first-party SQLite/PostgreSQL persistence exposes checkpoint capability; workflows adapt these primitives without owning database tables or duplicate queue logic.
    - Performance: Checkpoint lists remain cursor-bounded; event queues preserve configured bounds/overflow behavior; 1,000-node workflow stress remains green.
    - Code Quality: Generic core types contain no workflow concepts; existing workflow factories remain compatible while delegating to shared primitives.
    - Security: Ownership/version checks fail closed, values stay byte-bounded/redacted at workflow boundary, SQL remains parameterized, and abort closes sources.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts`, `packages/session-store-{sqlite,postgres}`, `packages/workflows/src/{checkpoints,events}.ts`, `docs/database-persistence.md`, `docs/workflow-orchestration-primitives.md`.
    - Options Considered:
      - Keep shared raw DB handles: rejected; duplicates schema/queue ownership.
      - Require checkpoint methods directly on every `ProductionPersistenceStore`: rejected; breaks hosts that only need query persistence.
      - Add optional generic checkpoint capability plus reusable event multiplexer: chosen.
    - Chosen Approach:
      - Add core `CheckpointStore`/memory implementation and generic bounded multiplexer; first-party persistence returns the capability; workflow package exposes only generic and memory adapters.
    - API Notes and Examples:
      ```ts
      const persistence = createSqlitePersistence({ database });
      const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`, `src/checkpoints.ts`, `src/event-multiplexer.ts`, `src/index.ts`.
      - `packages/session-store-sqlite/src/persistence.ts`, `packages/session-store-postgres/src/persistence.ts`.
      - `packages/workflows/src/checkpoints*.ts`, `packages/workflows/src/events.ts`, exports/tests.
      - Persistence/workflow docs and review evidence.
    - References:
      - Task 1 primitive review; user-requested removal of the generic-primitive compromise.
  - Test Cases to Write:
    - Core memory checkpoint conformance: version, ownership, pagination, delete, abort.
    - Event multiplexer: source fan-in, bounds, overflow, deterministic close.
    - SQLite/PostgreSQL capability integration and workflow adapter compatibility.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new core contracts/functions and first-party persistence capability.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/public-contracts.md`, persistence package pages.
    - `docs/index.md` update: yes — describe generic checkpoint/event primitives.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Core now exports `CheckpointStore`, `createMemoryCheckpointStore()`, and `createEventMultiplexer<T>()`. `ProductionPersistenceStore.checkpoints` is an optional capability; SQLite/PostgreSQL persistence packages expose it using package-owned generic `prism_checkpoints` storage with parameterized SQL, optimistic versions, exact ownership checks, bounded pagination, and abort support. Workflows now export `createWorkflowCheckpoints({ store })`; `createMemoryWorkflowCheckpoints()` delegates to core, `WorkflowEventBus` delegates to the core multiplexer, and all raw-handle SQLite/PostgreSQL workflow adapters plus driver dependencies were removed. Gates: 4/4 focused core primitive tests, 30/30 workflow tests, 8/8 SQLite persistence tests, PostgreSQL offline tests plus credential-gated live checkpoint case, 71/71 docs tests, and full `sdk:ready` at 1,437 tests / 0 failures. Audit: 0 vulnerabilities; dependency tree clean.

- [x] 7. Add distributed leases and a multi-process workflow coordinator
  - Acceptance Criteria:
    - Functional: Core exports database-neutral `LeaseStore` contracts and a memory reference implementation; first-party SQLite/PostgreSQL persistence exposes atomic leases; workflows can enqueue runs and multiple coordinator processes can poll, claim, renew, execute, recover expired claims, cancel durably, and release claims without duplicate active ownership.
    - Performance: Polling, claimed-run concurrency, lease TTL, renewal cadence, and list page sizes are bounded/configurable; lease acquisition is one atomic database write; coordinator does not scan unbounded checkpoint history.
    - Code Quality: Lease mechanics remain generic core/persistence primitives; workflow scheduling stays in `@arnilo/prism-workflows`; checkpoint writes use compare-and-swap plus fencing tokens so expired workers cannot overwrite a newer owner; no external coordinator dependency.
    - Security: Lease/checkpoint operations preserve tenant/account/user ownership, opaque claim tokens are required for renew/release, stale fencing tokens fail closed, cancellation is durable, abort stops heartbeats/work, and SQL remains parameterized.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts`, `src/checkpoints.ts`, `packages/session-store-{sqlite,postgres}/src/checkpoints.ts`, `packages/workflows/src/{run,status,checkpoints,active-runs}.ts`, `docs/{database-persistence,workflows,workflow-orchestration-primitives}.md`.
    - Options Considered:
      - Process-local locks plus checkpoint polling: rejected; permits split-brain execution after lease expiry.
      - Workflow-specific lease tables: rejected; lease ownership/fencing is reusable persistence infrastructure.
      - Generic atomic lease capability + workflow coordinator + fenced checkpoint CAS: chosen.
    - Chosen Approach:
      - Add optional `ProductionPersistenceStore.leases`, memory/SQLite/PostgreSQL implementations, and a package coordinator that enqueues checkpoint-backed work, atomically claims each run, renews claims, aborts on lease loss, and passes monotonically increasing fencing tokens into serialized checkpoint CAS writes.
    - API Notes and Examples:
      ```ts
      const coordinator = createWorkflowCoordinator({
        coordinatorId: process.env.HOSTNAME!,
        workflows,
        checkpoints: createWorkflowCheckpoints({ store: persistence.checkpoints }),
        leases: persistence.leases,
        maxConcurrentRuns: 4,
      });
      await enqueueWorkflow(workflow, input, { checkpoints });
      await coordinator.run({ signal });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`, `src/leases.ts`, `src/checkpoints.ts`, `src/index.ts`, focused core tests.
      - `packages/session-store-sqlite/src/{leases,persistence}.ts` and tests.
      - `packages/session-store-postgres/src/{leases,persistence}.ts` and credential-gated tests.
      - `packages/workflows/src/{coordinator,run,status,types,checkpoints,index}.ts` and tests.
      - `docs/database-persistence.md`, `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/public-contracts.md`, persistence docs, `docs/index.md`, review evidence, package README/changelogs.
    - References:
      - User-requested removal of the in-process-only orchestration compromise; Task 6 generic checkpoint capability.
  - Test Cases to Write:
    - Lease conformance: exclusive acquire, opaque-token renew/release, expiry takeover increments fencing token, ownership mismatch, abort.
    - Persistence: SQLite reopen/multi-handle exclusion; PostgreSQL atomic takeover under credential-gated integration.
    - Coordinator: two coordinators claim one queued run once, bounded parallel claims, heartbeat renewal, expired-worker takeover, stale fenced checkpoint rejection, durable cross-process cancel, graceful abort/release.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new core lease contracts/capability and workflow enqueue/coordinator APIs.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/public-contracts.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`.
    - `docs/index.md` update: yes — workflow entry gains distributed coordinator semantics; persistence entries gain leases.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Core exports `LeaseStore`, `LeaseConflictError`, and `createMemoryLeaseStore()`; checkpoint stores now support exact-version CAS and monotonic fencing. SQLite/PostgreSQL persistence exposes `persistence.leases` using atomic database-clock `prism_leases` claims, opaque renew/release tokens, ownership checks, and retained fencing counters. `@arnilo/prism-workflows` exports `enqueueWorkflow()` / `createWorkflowCoordinator()` with bounded polling/concurrency, heartbeat renewal, expired-run takeover, durable remote cancellation requests, and stale-worker checkpoint guards. Tests cover two-coordinator exclusive claim, concurrency bound, cancellation, lease-loss takeover/fencing, SQLite independent-handle exclusion, PostgreSQL credential-gated lease/CAS integration, and the offline distributed coordinator example. Final `npm run sdk:ready`: 1,444 tests (1,419 pass, 25 explicit live skips, 0 failures); workflow 34/34; SQLite 9/9; docs 71/71; install smoke, packaging guard, and dry-run packs pass. `npm audit --audit-level=high`: 0 vulnerabilities; dependency tree clean.

## Compromises Made

- Interactive TUI (C-012) is deferred and removed from this plan; workflow start/status/cancel/resume is delivered via public APIs and optional RPC/`CommandDefinition` bindings instead.
- Live PostgreSQL execution remains explicit via `PRISM_TEST_POSTGRES_URL`; default local/example gates are network-free, while release CI covers session/run/query persistence plus generic checkpoint CAS/fencing and atomic lease capabilities.

## Further Actions

- Resolved by Plan 058 Tasks 1, 2, and 8: packed workflow composition, 1,000-node benchmark, SQLite resume, live PostgreSQL leases/checkpoints, clean artifacts, and release gates pass.
- Post-0.0.4 / low: revisit C-012 only if a terminal host is requested; keep it an optional package.
