# Durable Workflow Suspend and Resume

## Objectives
- Add durable human-in-the-loop suspension to existing workflow checkpoints and scheduler.
- Resume suspended nodes exactly once with ownership, version, validation, redaction, cancellation, and policy checks.
- Support opted-in durable approval before workflow tool side effects without adding another durable-run engine.

## Expected Outcome
- `runWorkflow()` can return `status: "suspended"` with a persisted suspension descriptor while consuming no worker or polling loop.
- `resumeWorkflow()` can approve or deny the suspended run after restart; CAS claims one resume and rejects stale/duplicate attempts.
- Existing in-memory, SQLite, and PostgreSQL generic checkpoint adapters require no schema migration because suspension remains inside bounded checkpoint JSON.

## Tasks

- [x] Inventory durable coordination and approval primitives
  - Acceptance Criteria:
    - Functional: identify reusable workflow checkpoint, resume, command, coordinator, execution-policy, ownership, cancellation, and fencing paths.
    - Performance: preserve current O(nodes + edges) scheduler and bounded checkpoint/list behavior.
    - Code Quality: document only generic missing primitives; reject a second run engine or approval store.
    - Security: identify resume authorization, stale version, redaction, and permission-recheck boundaries before edits.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 8; `docs/workflows.md`; `docs/workflow-orchestration-primitives.md`; `docs/coding-security.md`; `docs/cli-rpc.md`; persistence docs.
      - `packages/workflows/src/{types,run,checkpoints,checkpoint-core,commands,status,coordinator}.ts`; `packages/coding-security/src/approval.ts`.
    - Options Considered:
      - Callback-only approval: cannot survive restart; rejected.
      - Separate approval queue/store: duplicates checkpoint/CAS/ownership machinery; rejected.
      - Add suspension state inside existing versioned checkpoint JSON: chosen.
    - Chosen Approach:
      - Reuse checkpoint ownership, expected-version CAS, fencing, list category, cancellation, redaction, and existing resume command.
      - Add one generic suspension descriptor/resume payload plus an opt-in tool approval declaration.
    - API Notes and Examples:
      ```ts
      const result = await runWorkflow(workflow, input, { checkpoints });
      if (result.status === "suspended") await resumeWorkflow(workflow, { runId: result.runId }, {
        checkpoints,
        resume: { decision: "approve", input: { reviewer: "ada" }, expectedVersion: result.version },
      });
      ```
    - Files to Create/Edit:
      - `plans/060-durable-workflow-suspend-resume.md`: primitive inventory and execution ledger.
    - References:
      - Core `CheckpointStore` CAS and `LeaseStore` fencing; workflow `resumeWorkflow`, `cancelWorkflowRun`, and `ExecutionPolicy` integration.
  - Test Cases to Write:
    - None; inventory is verified by source/docs inspection.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit: none for inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add suspended state, descriptor, helper, validation, and exact-once resume claim
  - Acceptance Criteria:
    - Functional: function nodes can return `suspend(...)`; checkpoint/result expose descriptor; approved resume continues the suspended node; denial is terminal and attributable.
    - Performance: suspension returns after active sibling work settles and starts no polling loop; resume claims checkpoint before executing nodes.
    - Code Quality: extend workflow types/state machine/checkpoint JSON at schema version 1 compatibly; strict TypeScript, no casts to `any`.
    - Security: require matching ownership and expected checkpoint version; validate resume input before claim; redact persisted suspend/resume data; reject duplicate/stale resume.
  - Approach:
    - Documentation Reviewed:
      - `packages/workflows/src/types.ts`, `run.ts`, `checkpoint-core.ts`, `checkpoints.ts`, `errors.ts`, `events.ts`.
    - Options Considered:
      - New suspend node kind: less flexible and duplicates function-node execution; rejected.
      - Exception-based suspension: easy to misclassify as failure/retry; rejected.
      - Branded `suspend()` result recognized by scheduler: chosen.
    - Chosen Approach:
      - Add `suspended`/`denied` statuses, persisted `WorkflowSuspensionDescriptor`, resume context, events, and `WorkflowResumeOptions`.
      - Use current first checkpoint write on resume as expected-version CAS claim before node execution.
      - Accept a host validator callback for persisted JSON Schema-compatible resume schema; fail closed when schema exists without validator.
    - API Notes and Examples:
      ```ts
      return ctx.resume
        ? publish(ctx.resume.input)
        : suspend({ reason: "publish", data: { artifactId }, resumeSchema });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts`, `run.ts`, `errors.ts`, `index.ts`, focused workflow tests.
    - References:
      - `WORKFLOW_CHECKPOINT_SCHEMA_VERSION`, `prepareCheckpointRecord`, `persistCheckpoint`.
  - Test Cases to Write:
    - Suspend/restart/approve; stale and duplicate expectedVersion; denial; invalid resume payload; ownership mismatch; secret redaction; cancellation while suspended.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; statuses, result/checkpoint fields, helper, resume options, and events.
    - Docs pages to create/edit: `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, persistence docs.
    - `docs/index.md` update: yes; workflow entry mentions durable human approval.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add opted-in durable workflow tool approval and command resume payload
  - Acceptance Criteria:
    - Functional: opted-in tool nodes suspend before side effects, resume on approval, terminate on denial, and re-run execution policy immediately before execution.
    - Performance: no approval polling/cache; command payload remains bounded by checkpoint limits.
    - Code Quality: use structural workflow tool config; do not couple coding-security back to workflows.
    - Security: approval never bypasses execution policy; command requires ownership and expectedVersion; forged decisions/inputs fail validation.
  - Approach:
    - Documentation Reviewed:
      - `packages/workflows/src/nodes.ts`, `commands.ts`, tool execution path; `packages/coding-security/src/approval.ts`.
    - Options Considered:
      - Add coding-security dependency on workflows: creates reverse coupling; rejected.
      - Reuse stale callback approval result: violates permission recheck; rejected.
      - Add optional approval declaration to workflow tool node, then run normal policy after durable approval: chosen.
    - Chosen Approach:
      - Tool approval produces the same suspension primitive before `assertExecutionAllowed`; approved resume recomputes args/action and then invokes current policy.
      - Extend `workflow.resume` command with decision/input/expectedVersion.
    - API Notes and Examples:
      ```ts
      toolNode({ tool: publishTool, args, approval: { reason: "publish release" } });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts`, `run.ts`, `commands.ts`, command/tool approval tests.
    - References:
      - `ExecutionPolicy`, run/session metadata, workflow command ownership parsing.
  - Test Cases to Write:
    - No side effect before approval; approval executes once; denial never executes; resumed policy denial wins; command rejects missing/stale version.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; tool-node config and RPC command payload.
    - Docs pages to create/edit: `docs/workflows.md`, `docs/coding-security.md`, `docs/cli-rpc.md`.
    - `docs/index.md` update: covered by prior workflow navigation update.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify checkpoint adapters, coordinator behavior, docs, and release boundaries
  - Acceptance Criteria:
    - Functional: memory adapter and generic SQLite/PostgreSQL-backed adapter conformance support suspended listing/resume/cancel; coordinator ignores suspended runs until explicit resume.
    - Performance: full benchmarks stay within roadmap ceilings; no package or DB migration added.
    - Code Quality: exports/docs/examples/review matrix/roadmap agree; brittle source tests updated only where required.
    - Security: tests cover ownership, CAS/fencing, redaction, cancellation, and policy recheck.
  - Approach:
    - Documentation Reviewed:
      - Workflow/persistence/release/index/review-coverage/performance docs and package README/changelog.
    - Options Considered:
      - Add suspension columns/migrations: redundant because category + checkpoint JSON already persist/query status; rejected.
      - Reuse generic adapter unchanged and add behavior/conformance tests: chosen.
    - Chosen Approach:
      - Run focused workflow tests, all workspace tests, `sdk:ready`, and live PostgreSQL only when `PRISM_TEST_POSTGRES_URL` is present.
    - API Notes and Examples:
      ```bash
      npm test -w @arnilo/prism-workflows
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - Workflow tests; `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/coding-security.md`, `docs/cli-rpc.md`, persistence docs, `docs/index.md`, `docs/review-coverage-2026-07-15.md`, `docs/performance.md`, package README/changelog, `roadmap.md`, this plan.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`; Phase 8 roadmap acceptance criteria.
  - Test Cases to Write:
    - Adapter list filter `suspended`; cancellation; coordinator does not claim suspended; full network-free suite and pack/install gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; complete API/security/operations documentation required.
    - Docs pages to create/edit: workflow, security, CLI/RPC, persistence, release/review/performance pages listed above.
    - `docs/index.md` update: yes; durable suspend/resume wording under workflows.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- One workflow exposes one active durable review cursor. Concurrent node suspension requests are returned to the ready queue and presented sequentially after the current review; this keeps checkpoint/resume API and CAS ownership singular.
- Resume-schema execution stays a host callback (`validateResume`) rather than adding Ajv or coupling workflows to `@arnilo/prism-tool-validator-json-schema`. A declared schema without a validator fails closed.
- Suspension remains additive schema-version-1 checkpoint JSON/category data. No SQLite/PostgreSQL migration or new approval table was added.
- PostgreSQL live coverage remains environment-gated; this run validated generic adapter/CAS behavior and the full network-free suite because `PRISM_TEST_POSTGRES_URL` was not supplied.

## Further Actions
- Priority medium: add a tiny documented `validateResume` adapter in the JSON Schema validator package if repeated host boilerplate appears during Phase 10 server work.
- Priority low: add multi-review batch UI semantics only if hosts need parallel reviewer queues; current sequential cursor is deterministic and bounded.
- Priority low: preserve immutable suspension history (instead of latest suspension + latest resume) when Phase 11 adds workflow replay lineage.
