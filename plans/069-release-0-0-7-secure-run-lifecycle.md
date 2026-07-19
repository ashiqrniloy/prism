# Release 0.0.7 — Secure Run Lifecycle, Guardrails, Budgets, and Durable Interruption

## Objectives

- Implement only Phase 2 from `roadmap.md`: typed guardrails, universal finite run limits, durable ordinary-agent interruption/resume, and secure opt-in composition.
- Put enforcement in shared runtime, provider, tool-dispatch, checkpoint, ownership, and policy boundaries so retries, revisions, delegation, MCP, workflows, and custom loop orchestration cannot bypass it.
- Reuse core `CheckpointStore`, CAS/fencing, session entries, run ledger, usage accounting, redaction, permission/trust policy, workflow suspension, and supervisor budget concepts without creating a second runtime.
- Preserve dependency-free core and backward-compatible explicit `createAgent()` behavior while making the secure path easy to select and hard to misconfigure.

## Expected Outcome

- Input, output, tool-input, and tool-output guardrails have typed inputs/results, deterministic stage ordering, bounded parallel evaluation, tripwires, redacted attributable decisions, and one shared enforcement path.
- Every ordinary run has validated finite ceilings for turns, provider attempts, tool rounds/calls, wall time, request/response bytes, input/output/total tokens, and optional cost; one typed terminal event/result identifies the first breached limit.
- Built-in ordinary agent runs can persist a versioned bounded state, suspend without holding a worker, survive process restart, and resume one time through ownership-aware checkpoint CAS after current policy and definition checks.
- `createSecureAgent()` composes required tool schemas, JSON Schema argument validation, finite limits, deny-by-default permission/trust, redaction, ownership, and durable approval defaults; `createAgent()` remains explicit and compatible.
- Authorized server and MCP status/resume exposure reuses core run lifecycle primitives and exposes no capability by default.
- All 30 package artifacts form a tested `0.0.7` release-candidate graph; no tag or publication occurs without explicit operator authorization.

## Tasks

- [x] Review existing primitives and freeze Phase 2 invariants before implementation
  - Acceptance Criteria:
    - Functional: every Phase 2 roadmap criterion maps to one current primitive, minimal gap, owning task, focused regression, documentation page, and release gate; Phase 3 telemetry/evaluation/protocol/web work and Phase 4 sandbox/persona work remain out of scope.
    - Performance: exact default/hard ceilings and cumulative-versus-per-operation semantics are recorded for every `RunLimits` field and serialized run state before production edits; each counter update is O(1), and each byte measurement has one bounded owner.
    - Code Quality: caller inventory covers `RuntimeAgentSession`, both built-in loops, custom-loop `LoopContext`, retry, provider stream reconstruction, `dispatchToolCall`, workflow tool nodes, supervisor delegation, MCP client/server dispatch, checkpoint stores, server routes, and exports; new generic primitives are introduced only where these callers demonstrably share a gap.
    - Security: stage ordering, output buffering, tripwire cancellation, ownership, definition identity, CAS claim, current-policy reauthorization, secret exclusion, malformed persisted state, and fail-closed cost/accounting behavior are frozen as invariants.
  - Approach:
    - Documentation Reviewed:
      - Phase 2 and Phase Planning Workflow in `roadmap.md`.
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/runs-and-usage.md`, `docs/workflows.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/server.md`, and `docs/mcp-tools.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/` directory exists.
      - OpenAI Agents JS guardrail/HITL guides and current source references: <https://openai.github.io/openai-agents-js/guides/guardrails/> and <https://openai.github.io/openai-agents-js/guides/human-in-the-loop/>. Context7 library `/openai/openai-agents-js` confirms typed input/output/tool guardrail stages, tripwire outcomes, approval ordering, and resumable state/interruption concepts.
      - LangGraph persistence overview: <https://docs.langchain.com/oss/javascript/langgraph/persistence>; checkpoints are thread-scoped state snapshots for interruption/fault recovery, distinct from cross-thread stores.
    - Options Considered:
      - Add middleware naming conventions and host recipes: cannot enforce order or prevent bypass; rejected.
      - Add a separate durable-agent service/worker protocol: duplicates session, workflow, checkpoint, lease, and run-ledger primitives; rejected.
      - Freeze one typed core guardrail pipeline, one run-limit tracker, and one checkpointed run-state contract reused by all adapters: chosen.
    - Chosen Approach:
      - Produce a traceability/caller table and a default/hard-cap matrix in this task's completion evidence before implementation.
      - Freeze stage order as input guardrails → bounded private provider collection → provider-output guardrails → assistant persistence/events → tool-input guardrails → current permission/validation/execution policy → tool side effect → tool-output guardrails → redacted tool persistence/events/result. Configured provider-output guardrails require buffering so rejected provider content is never emitted or stored first.
      - Freeze durable scope to built-in loops. Custom `AgentLoopStrategy` remains supported by `createAgent()` but is not resumable unless a future generic codec is justified; lifecycle APIs reject unsupported custom-loop persistence before execution.
      - Define a host-authored non-empty run-definition revision for durable runs; fingerprint stable revision/model/tool schema/guardrail/limit shape, never `Function.toString()` or secret-bearing config.
    - API Notes and Examples:
      ```text
      roadmap criterion → callers → shared primitive → invariant/cap → test → docs → release gate

      input → private provider → output → assistant expose → tool input → permission/policy → execute → tool output → expose
      ```
    - Files to Create/Edit:
      - `plans/069-release-0-0-7-secure-run-lifecycle.md`: append caller/primitive, limit, state-schema, and stage-order evidence before Task 2.
      - No production or public documentation files in this review task.
    - References:
      - Existing core contracts and implementations: `src/contracts.ts`, `src/agents.ts`, `src/agent-loops.ts`, `src/tools.ts`, `src/retry.ts`, `src/checkpoints.ts`, `src/redaction.ts`, `src/security.ts`, and `src/execution-policy.ts`.
      - Existing reusable package primitives: `packages/workflows/src/run.ts`, `checkpoint-core.ts`, `checkpoints.ts`; `packages/supervisor/src/limits.ts`, `supervisor.ts`; `packages/mcp/src/server.ts`, `bridge.ts`; `packages/server/src/handler.ts`.
  - Test Cases to Write:
    - Traceability check: each Phase 2 acceptance item has exactly one owning implementation task and no Phase 3+ feature is required.
    - Caller check: every provider/tool/run entry path either routes through the shared enforcement primitive or explicitly rejects unsupported lifecycle mode.
    - Limit matrix check: every count/byte/time/token/cost field has a finite default, finite hard cap (except omitted optional cost), unit, charging point, and stable breach code.
    - State matrix check: every persisted field is needed for deterministic continuation and no field can contain provider instances, credential resolvers, resolved credentials, raw secrets, abort controllers, callbacks, or unrestricted request payloads.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; review freezes boundaries only.
    - Docs pages to create/edit:
      - `none`: implementation tasks own public documentation.
    - `docs/index.md` update: no; no public surface changes in this task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Scope is frozen to roadmap Phase 2. This task adds no Phase 3 telemetry/evaluation/protocol/web capability and no Phase 4 sandbox/persona capability. `git status --short` confirms only this new plan file changed.
    - Primitive/caller inventory and owner map:

      | Roadmap criterion | Existing primitive and caller path | Minimal gap / owning task | Regression, docs, release gate |
      | --- | --- | --- | --- |
      | Typed guardrails | `RuntimeAgentSession.run()` builds `LoopContext`; `generateWithRetry()` owns provider attempts; `generateProviderTurn()` owns streamed events/reconstruction; `dispatchToolCall()` owns normal tool dispatch; `redactAgentEvent()`/ledger/session append own exposure. `singleShotLoop`, `generateValidateReviseLoop`, and custom loops reach provider/tool work only through `ctx.generate()`/`ctx.dispatchToolCall()`. | Add one typed stage runner at runtime and dispatch boundaries; route workflow tool nodes through `dispatchToolCall()` (Task 2). | Guardrail order/leak/bypass tests; `docs/guardrails.md`, runtime/loop/tool/workflow/MCP/security docs; lifecycle release matrix. |
      | Universal limits | Loop locals count tool rounds; `generateWithRetry()` counts attempts implicitly; `generateProviderTurn()` receives provider events/usage; `dispatchToolCall()` is shared side-effect gate; supervisor has independently validated limits and post-run token check. | Add one resolved run-scoped tracker and inject it into loop/provider/tool primitives; supervisor only narrows it (Task 3). | Boundary/accounting/race tests; runs/usage/runtime/loop/supervisor docs; lifecycle release matrix. |
      | Durable interruption/resume | Generic `CheckpointStore` clones JSON and enforces exact ownership, version CAS, and fencing. Workflows add bounded redacted state, definition hash, suspend-before-side-effect, current policy recheck, and expected-version resume. Session stores already preserve branch leaves. | Add a small agent-state adapter/cursor over generic checkpoints; do not import workflow graph vocabulary (Task 4). | Restart/CAS/ownership/state-safety tests; runtime/loop/persistence/security docs; SQLite/PostgreSQL conformance. |
      | Secure composition | `createAgent()` is a thin explicit wrapper; tool registry supports duplicate rejection; `createToolParameterValidator(..., { missingSchema: "reject" })`, redactor, permission/trust, checkpoint, and provider-policy seams already exist. | Add one validating composition function; preserve low-level `createAgent()` behavior and dependency-free core (Task 5). | Default-deny/override/compatibility tests; runtime/tool/security/migration docs; packed-import gate. |
      | Authorized remote lifecycle | Server already authorizes before lookup and has bounded workflow status/resume routes. MCP server already has explicit capability lists, per-call authorization, bounded JSON/timeouts, and dispatches registered tools through core. | Add one explicit core lifecycle capability supplied to server/MCP; no default routes, commands, in-memory cache, or adapter-local resume logic (Task 6). | No-exposure/auth/CAS/redaction tests; server/MCP/runtime/security docs; release matrix. |
      | Release graph | Existing `sdk:ready`, package pack, audit, release check/publish dry-run, docs/import, persistence, and provenance gates cover the 30-package graph. | Integrate Phase 2 tests/docs/versions only after Tasks 2–6 (Task 7). | Full offline, packed consumer, live checkpoint, provider-usage, tarball/secret, and graph gates. |

    - Caller disposition is frozen:

      | Caller | Phase 2 enforcement disposition |
      | --- | --- |
      | `RuntimeAgentSession` / `session.run()` | Owns input stage, resolved limits, timer, state lifecycle, provider collector, redacted exposure, and terminal result. |
      | Built-in loops | Use guarded `LoopContext`; tracker charges turn/tool-round/tool-call before work. |
      | Custom `AgentLoopStrategy` | Guarded only when it uses `ctx.generate()` / `ctx.dispatchToolCall()`; durable mode rejects custom loops before work because arbitrary closure state cannot serialize. A host that directly calls its own provider/tool remains outside Prism's enforceable runtime boundary. |
      | Retry / provider reconstruction | `generateWithRetry()` calls the same guarded provider-turn primitive for every attempt; private collector reconstructs deltas only after response-byte charging. |
      | Core tool dispatch | `dispatchToolCall()` is sole Prism tool-side-effect boundary and receives tool stages/tracker. Direct public `ToolDefinition.execute()` remains an intentional host escape hatch, documented as outside runtime enforcement. |
      | Workflow agent/tool nodes | Agent nodes call public sessions. Tool node's sole production direct `tool.execute()` call at `packages/workflows/src/run.ts:836` is the confirmed bypass; Task 2 replaces it with shared dispatch while retaining workflow `ExecutionPolicy` attribution. Function-node callbacks remain host code, not tools. |
      | Supervisor | Recreates child agent then calls `session.run()`; maps `maxSteps`, `maxToolCalls`, `maxTokens`, and timeout to narrower core limits while retaining depth/child/message/event ceilings. |
      | MCP client/server | Client bridge only creates `ToolDefinition`s; registered calls reach core dispatch. MCP server registered tools already call `dispatchToolCall()`; MCP commands are host command callbacks and must opt into lifecycle capability explicitly. |
      | HTTP server | Agent routes create a session and call `session.run()`; workflow routes retain package lifecycle. Task 6 adds agent status/resume only behind explicit capability/authorization. |
      | Checkpoints / exports | Core checkpoint CAS/fencing stays generic. New state/guardrail/limit/secure exports enter `src/contracts.ts` and `src/index.ts`; no new package or storage schema is needed. |

    - Frozen guardrail contract and ordering:

      | Order | Stage / boundary | Exposure rule |
      | ---: | --- | --- |
      | 1 | `input` on canonical input messages, before session append, compaction, provider request, or retry | `block`/`tripwire` exposes no input; `interrupt` needs durable state or fails closed. |
      | 2 | Provider attempt after request-byte charge, collected privately under response-byte cap | No `message_started`, delta, assistant entry, ledger record, parser, delegator, or tool dispatch sees provider content yet. |
      | 3 | `output` on completed assistant provider-turn content, before any assistant exposure | Allowed content is then appended/emitted in current order. This is intentionally before tool-input: a tool-call message is provider output too. |
      | 4 | `tool_input` for each complete call before lookup/filter, permission, schema validation, workflow execution policy, or side effect | A block returns a redacted blocked `ToolResult`; no side effect starts. |
      | 5 | `tool_output` on raw completed `ToolResult`, before redaction, event, ledger, transcript, MCP response, or next turn | Allowed result is redacted then exposed; blocked raw result is discarded. |

      Guardrail groups default to sequential (`maxConcurrency: 1`) and may use at most 16 workers. Parallel completion is reduced by declaration index. A malformed/throwing result fails closed. `tripwire` aborts sibling evaluation and the run, emits one redacted terminal decision, and releases no buffered subject. `block` is terminal for input/output and produces a blocked result for a tool stage. `interrupt` is legal only at input or pre-tool-side-effect safe points; absent durable configuration it fails with `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`. Guardrail reason/metadata is bounded to 4 KiB/16 KiB before redaction and persistence.

    - Frozen `RunLimits` matrix. All integer fields require a positive safe integer; values are cumulative per run, default when omitted, and can only narrow inherited/configured limits. `maxCost` is optional because a currency is host-specific.

      | Field | Default / hard cap | Charge point and semantics | Breach code |
      | --- | ---: | --- | --- |
      | `maxTurns` | 16 / 64 | Reserve before `assemble()` for each provider turn, including revisions. | `ERR_PRISM_RUN_LIMIT_TURNS` |
      | `maxProviderAttempts` | 24 / 256 | Reserve before every provider call, including retry attempts. | `ERR_PRISM_RUN_LIMIT_PROVIDER_ATTEMPTS` |
      | `maxToolRounds` | 8 / 64 | Reserve entire provider-returned call round before dispatching any call. | `ERR_PRISM_RUN_LIMIT_TOOL_ROUNDS` |
      | `maxToolCalls` | 32 / 256 | Reserve all calls in a round before concurrent dispatch; an over-limit round executes none. | `ERR_PRISM_RUN_LIMIT_TOOL_CALLS` |
      | `maxWallTimeMs` | 120,000 / 1,800,000 | One absolute deadline and one abort timer from run start; stored deadline never resets on resume. | `ERR_PRISM_RUN_LIMIT_WALL_TIME` |
      | `maxRequestBytes` | 8 MiB / 64 MiB | Charge UTF-8 canonical JSON of normalized provider request after policies/middleware and before send, excluding `signal` and headers. It is a logical payload budget, not a transport-wire measurement. | `ERR_PRISM_RUN_LIMIT_REQUEST_BYTES` |
      | `maxResponseBytes` | 8 MiB / 64 MiB | Charge each provider event's canonical JSON before retaining/reconstructing/emitting it. | `ERR_PRISM_RUN_LIMIT_RESPONSE_BYTES` |
      | `maxInputTokens` | 40,000 / 1,000,000 | Charge final normalized per-attempt usage before content exposure or next work. | `ERR_PRISM_RUN_LIMIT_INPUT_TOKENS` |
      | `maxOutputTokens` | 10,000 / 250,000 | Same normalized usage point. | `ERR_PRISM_RUN_LIMIT_OUTPUT_TOKENS` |
      | `maxTotalTokens` | 50,000 / 1,000,000 | Use reported `totalTokens`, else finite input + output; cache tokens are subsets, never added again. | `ERR_PRISM_RUN_LIMIT_TOTAL_TOKENS` |
      | `maxCost` | omitted / 10,000 currency units | When configured, require one uppercase three-letter currency and finite non-negative reported cost for every charged attempt; no missing, mixed, NaN, or infinity value is treated as zero. | `ERR_PRISM_RUN_LIMIT_COST` |

      A provider lacking complete finite usage when a default token limit applies fails before content exposure/next work with `ERR_PRISM_RUN_LIMIT_USAGE_UNAVAILABLE`; core has no dependency-free tokenizer and will not invent one. Provider-reported token/cost limits may exceed by one completed provider attempt, but cannot authorize a following tool, event replay, or provider call. The first breach aborts active work, prevents new work, and produces exactly one redacted `run_limit_exceeded` event, ledger row, and terminal result. Tracker operations are O(1); they never scan history or ledger rows.

    - Frozen durable state boundary:
      - State schema is `AgentRunState` version `1`; serialized state is 256 KiB default / 1 MiB hard, at most depth 32/64 and 256/1,024 object properties (default/hard). Identifiers and definition revision are non-empty bounded strings (128/256 bytes default/hard); interruption and resume input are included in the aggregate cap and redacted before save.
      - Persist only `{ agentId, definitionRevision, fingerprint, runId, sessionId, leafId, model identity, builtin loop cursor, pending safe-boundary descriptor, resolved-limit snapshot/counters/deadlineAt, checkpoint version/fence attribution, redacted resume record }`. Session history remains in `SessionStore`; provider output already persisted before a tool interruption is referenced by leaf/call id rather than copied.
      - Never serialize provider instances/resolvers, credentials or redactor secret lists, callbacks, custom loop objects, middleware, signals/controllers, timers, stacks, raw provider requests/responses, unredacted input/tool arguments, or arbitrary metadata. Load validates JSON shape/version/size before agent/session reconstruction.
      - Durable runs require a non-empty `agentId`, host-authored `definitionRevision`, and exact non-empty ownership (`tenantId` plus `accountId` or `userId`). Fingerprint canonical JSON of schema version, agent/revision, model identity, built-in loop shape, sorted tool names/parameter schemas/exclusivity, guardrail name/stage/revision/concurrency shape, and resolved limits. It never hashes function source, descriptions, credentials, or arbitrary metadata. Current permission/trust/execution policy is rechecked on resume instead of fingerprinted.
      - CAS gives exactly one resume claimant before resumed work. Arbitrary external tool effects cannot be made crash-exactly-once by a checkpoint: a crash after an effect and before checkpoint finalization is ambiguous. Persist a dispatched marker first; automatic recovery never repeats an ambiguous effect. A host tool that needs retryable exactly-once effects must honor the stable `runId/toolCallId` idempotency key; otherwise resume stops for explicit operator resolution.

    - Checks executed:
      - Read Phase 2 roadmap and all listed runtime, loop, usage, workflow, host-security, server, MCP, and supervisor documentation; reviewed core contracts/runtime/retry/provider-event/checkpoint/dispatch/export code plus workflow/supervisor/MCP/server paths.
      - `rg` caller inventory found one production direct workflow tool bypass (`packages/workflows/src/run.ts:836`); no other production direct `ToolDefinition.execute()` outside central dispatch. It also confirmed existing workflow CAS/fencing/definition-hash and server status/resume primitives.
      - `git diff --check --no-index /dev/null plans/069-release-0-0-7-secure-run-lifecycle.md` produced no whitespace diagnostics (the expected exit status is `1` for a new-file diff). No production behavior changed in this review task.

- [x] Add typed guardrail stages and enforce them at shared runtime/tool boundaries
  - Acceptance Criteria:
    - Functional: exported generic contracts cover `input`, `output`, `tool_input`, and `tool_output`; each decision is `allow`, `block`, `tripwire`, or `interrupt`, identifies guardrail/stage/run/tool attribution, and carries only bounded redacted public metadata.
    - Functional: stage ordering matches Task 1; configured guardrails may run in bounded parallel groups, but decisions and emitted records are normalized in declaration order; first terminal decision cancels remaining work and exactly one terminal guardrail event is emitted.
    - Functional: input guardrails run once before provider work; provider retries do not bypass them; tool-input runs before permission/policy and side effects on every dispatch; tool-output runs before transcript/persistence; output runs before provider content is emitted, stored, returned, revised, delegated, or forwarded.
    - Functional: both built-in loops, custom loops using `LoopContext`, direct core dispatch, MCP server dispatch, MCP client tools, supervisor children, workflow agent nodes, and workflow tool nodes use the same guarded primitives; no direct `tool.execute()` path remains in workflow execution.
    - Performance: guardrail concurrency is a validated positive safe integer with a finite hard cap; each stage retains bounded metadata/error text, aborts promptly on tripwire, and does not duplicate provider/tool payloads beyond the configured response/state byte cap.
    - Code Quality: guardrails are typed primitives and a small stage runner, not middleware event names, subclasses, or one adapter per stage; core remains runtime dependency-free.
    - Security: malformed guardrail results fail closed; blocked/tripwire content, stack traces, and raw guardrail output never reach events, ledgers, session entries, tool results, MCP responses, workflow checkpoints, or error messages before redaction/bounding.
  - Approach:
    - Documentation Reviewed:
      - OpenAI Agents JS guardrail contracts/tripwires and function-tool input/output ordering via Context7 `/openai/openai-agents-js` and <https://openai.github.io/openai-agents-js/guides/guardrails/>.
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/tools.md`, `docs/tool-execution-primitives.md`, `docs/workflows.md`, `docs/mcp-tools.md`, `docs/supervisors.md`, and `docs/host-security.md`.
      - Current `src/agents.ts`, `src/agent-loops.ts`, `src/tools.ts`, `packages/workflows/src/run.ts`, `packages/mcp/src/server.ts`, and `packages/supervisor/src/supervisor.ts` call paths.
    - Options Considered:
      - Reuse middleware hooks named `guardrail_*`: hooks can modify payloads and custom loops can bypass naming conventions; rejected.
      - Put tool guardrails only on `ToolDefinition`: workflow and remote adapters can still call execution directly; rejected.
      - Add one typed stage runner invoked by runtime input/provider-output and shared tool dispatch, then route workflow tools through dispatch: chosen.
      - Stream output before final guardrail completion: lower latency but leaks blocked content; rejected when output guardrails are configured.
    - Chosen Approach:
      - Add discriminated `Guardrail<Stage>`, stage-specific context/value maps, `GuardrailDecision`, `GuardrailRecord`, and typed errors/events in core.
      - Run blocking guardrails before work. For explicitly parallel guardrails, use one bounded worker pool and deterministic declaration-index result reduction; no speculative provider/tool execution starts until the guardrail group allows it.
      - Buffer provider deltas through the existing bounded provider-turn collector whenever output guardrails are active; replay allowed normalized events only after decision. Run tool-output guardrails before `tool_execution_finished`, ledger append, and transcript append.
      - Replace workflow's direct tool execution with `dispatchToolCall()` plus workflow attribution and existing `ExecutionPolicy`; do not duplicate dispatch checks in workflows.
    - API Notes and Examples:
      ```ts
      const piiGuard: Guardrail<"input"> = {
        name: "pii",
        stage: "input",
        async evaluate({ value }) {
          return containsBlockedPii(value)
            ? { action: "tripwire", reason: "blocked_pii" }
            : { action: "allow" };
        },
      };

      const guardrails: Guardrails = {
        input: [piiGuard],
        toolInput: [commandGuard],
        toolOutput: [secretOutputGuard],
        output: [responseGuard],
      };
      ```
    - Files to Create/Edit:
      - `src/guardrails.ts` (new): typed contracts, validation, bounded stage runner, errors, and record normalization.
      - `src/contracts.ts`, `src/index.ts`: public guardrail config/context/decision/event exports.
      - `src/agents.ts`, `src/agent-loops.ts`: input/output enforcement, buffered output release, loop-context guarded primitives, and terminal result mapping.
      - `src/tools.ts`: tool-input/tool-output enforcement before side effect/exposure.
      - `src/redaction.ts`: guardrail event/record redaction through existing generic redactor.
      - `packages/workflows/src/run.ts`, `types.ts`: route tool nodes through guarded core dispatch while retaining execution policy and workflow metadata.
      - `packages/mcp/src/server.ts`, `packages/supervisor/src/supervisor.ts`: propagate guardrail config only where current adapters construct dispatch/run options; avoid adapter-local evaluation.
      - `src/__tests__/guardrails.test.ts` (new), `src/__tests__/agents.test.ts`, `agent-loops.test.ts`, tool tests, workflow run tests, MCP server tests, and supervisor tests.
      - `docs/guardrails.md` (new), `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/tools.md`, `docs/workflows.md`, `docs/mcp-tools.md`, `docs/host-security.md`, package READMEs/changelogs, root `CHANGELOG.md`.
      - `docs/index.md`: add Guardrails under Agent/session runtime and Security/auth/trust.
    - References:
      - Current direct bypass: `packages/workflows/src/run.ts` calls `tool.execute()` instead of core `dispatchToolCall()`.
      - Existing dispatch order: tool lookup/filter → middleware → permission → validator → execute → middleware result → redaction/events/ledger in `src/tools.ts`.
  - Test Cases to Write:
    - Stage order: successful input/output/tool-input/tool-output records appear in documented order around provider, permission, validation, execution, persistence, and events.
    - Parallel matrix: ordered results despite completion races; thrown/rejected/malformed result fails closed; tripwire aborts siblings; concurrency and metadata caps reject invalid values.
    - Leakage matrix: blocked provider deltas/tool result/guardrail output/secret/error never appears in subscribers, session entries, run ledger, workflow checkpoint, MCP result, or terminal error.
    - Bypass matrix: provider retry, artifact revision, custom loop `ctx.generate`/`ctx.dispatchToolCall`, supervisor delegation, workflow agent/tool node, MCP client mapped tool, and MCP server call each trigger the expected stage exactly once per charged operation.
    - Compatibility: no configured guardrails preserves current event order and streaming behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new guardrail contracts/events and guarded output/tool behavior are public.
    - Docs pages to create/edit:
      - `docs/guardrails.md`: API structure, stage/value/result tables, ordering, buffering, tripwires, interruption, examples, extension, security, and performance notes.
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/tools.md`, `docs/workflows.md`, `docs/mcp-tools.md`, `docs/host-security.md`: integration and no-bypass behavior.
    - `docs/index.md` update: yes; add Guardrails and update Agent/session runtime, Tools, Workflows, MCP, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Added dependency-free `src/guardrails.ts` and public contracts: typed `Guardrail<"input" | "output" | "tool_input" | "tool_output">`, `Guardrails`, decisions/records, `GuardrailError`, bounded runner, and `guardrail_decision` event. Sequential is default; `maxConcurrency` validates 1–16; malformed/throwing callbacks tripwire without exposing callback details; reasons/metadata are redacted and bounded.
    - `RuntimeAgentSession` runs input guards before input append/compaction/provider work, merges agent and run guardrail lists, and privately buffers provider message events when output checks exist. Rejected provider content never reaches subscribers, session entries, ledger, artifact parsing, delegation, or tool dispatch. Retries do not retry a `GuardrailError`.
    - Shared `dispatchToolCall()` runs tool-input after middleware normalization but before lookup/filter/permission/validation/policy/side effect, and tool-output before redaction/event/ledger/transcript exposure. `block` returns a static blocked result; terminal non-block actions fail the enclosing run. Added minimal generic `beforeExecute` seam so workflow `ExecutionPolicy` stays immediately before the side effect without restoring direct execution.
    - Workflow tool nodes now use core dispatch; MCP server registrations pass optional shared guardrails. Agent nodes, built-in/custom `LoopContext` loops, supervisor-created agent configs, and MCP bridge tools already route through session/core dispatch and inherit the same configuration.
    - Added `src/__tests__/guardrails.test.ts` plus workflow coverage for input/output/tool-output buffering, malformed callbacks, bounded parallel cancellation, no raw output leakage, and workflow tool-input side-effect prevention. Updated root/package changelogs, package READMEs, `docs/guardrails.md`, runtime/loop/tool/workflow/MCP/security/event docs, docs navigation, and plan index.
    - Checks passed: `npm run build:core`; core guardrail/docs/tool/agent/export tests (318 passing); `npm run build --workspace @arnilo/prism-workflows && npm run test --workspace @arnilo/prism-workflows` (60 passing); `npm run build --workspace @arnilo/prism-mcp && npm run test --workspace @arnilo/prism-mcp` (33 passing); `git diff --check`.

- [x] Implement universal RunLimits validation, accounting, and terminal breach reporting
  - Acceptance Criteria:
    - Functional: `RunLimits` covers turns, provider attempts, tool rounds, tool calls, wall time, request bytes, response bytes, input tokens, output tokens, total tokens, and optional cost/currency; config/run overrides can only narrow secure inherited limits where delegation/workflow composition applies.
    - Functional: every built-in loop, retry attempt, tool dispatch, artifact revision, supervisor child, workflow agent node, MCP-backed tool, and resumed run charges the same run-scoped tracker; custom loops cannot call unmetered provider/tool primitives.
    - Functional: the first exceeded limit aborts active work, prevents new provider/tool work, emits exactly one redacted `run_limit_exceeded` event/ledger row, and returns or throws an `AgentRunResult` carrying limit name, configured maximum, observed value, and stable error code.
    - Functional: input/output/total tokens and cost use normalized provider `Usage`; missing totals derive from finite input/output values; max-cost mode requires one configured currency and fails closed on missing/non-finite/mixed-currency cost rather than assuming zero.
    - Performance: count/token/cost updates are O(1) per event or completed attempt; byte totals are charged incrementally while reading existing bounded streams; wall time uses one abort timer and no polling; timeout/abort races still produce one terminal result.
    - Code Quality: one `RunLimitTracker` and one validator replace package-local post-hoc checks where semantics overlap; supervisor-specific depth/child/message/event bounds remain package-local and narrow core run limits rather than copying counters.
    - Security: NaN, `Infinity`, unsafe integers, negatives, zero where invalid, hard-cap overflow, malformed usage, integer overflow, and cost currency mismatch fail closed before expensive work or immediately at the reporting boundary.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/runs-and-usage.md`, `docs/performance.md`, `docs/supervisors.md`, `docs/workflows.md`, and `docs/host-security.md`.
      - `src/agents.ts` run usage accumulator and retry flow; `src/agent-loops.ts` turn/tool counters; `packages/supervisor/src/limits.ts` and post-run token/tool budget logic; workflow finite-limit conventions.
      - Node 20 `AbortSignal.timeout()`/`AbortController` behavior and existing Prism abort composition patterns.
    - Options Considered:
      - Check totals only after completion: records usage but permits overshoot and side effects; rejected except unavoidable provider-reported token/cost reconciliation after a response.
      - Keep independent loop, supervisor, workflow, and server counters: conflicting semantics and bypass risk; rejected.
      - Use one run-scoped mutable O(1) tracker behind guarded loop/provider/tool methods and narrow it at composition boundaries: chosen.
    - Chosen Approach:
      - Add validated public limits plus internal resolved limits/tracker with `charge(kind, delta, attribution)` and `assertCanStart(kind)` operations.
      - Charge turns before assembly, attempts before provider call, request bytes before send, response bytes incrementally, tool rounds/calls before dispatch, and reported usage/cost before output exposure or another turn.
      - Preserve already finite package-specific graph/delegation/network limits; map supervisor `maxSteps`/`maxToolCalls`/`maxTokens` into narrower core `RunLimits` and remove only duplicate post-hoc counting.
      - Store tracker snapshots in durable run state so resume continues the original budget and wall deadline instead of resetting it.
    - API Notes and Examples:
      ```ts
      const limits: RunLimits = {
        maxTurns: 16,
        maxProviderAttempts: 24,
        maxToolRounds: 8,
        maxToolCalls: 32,
        maxWallTimeMs: 120_000,
        maxRequestBytes: 8 * 1024 * 1024,
        maxResponseBytes: 8 * 1024 * 1024,
        maxInputTokens: 40_000,
        maxOutputTokens: 10_000,
        maxTotalTokens: 50_000,
        maxCost: { amount: 0.25, currency: "USD" },
      };
      ```
    - Files to Create/Edit:
      - `src/run-limits.ts` (new): public limits, defaults/hard caps, narrowing, tracker, snapshot, and typed errors.
      - `src/contracts.ts`, `src/index.ts`: `RunLimits`, breach attribution, event/result fields, and config/run options.
      - `src/agents.ts`, `src/agent-loops.ts`, `src/retry.ts`, provider turn collection helpers, `src/tools.ts`: shared charging and abort.
      - `packages/supervisor/src/limits.ts`, `types.ts`, `supervisor.ts`: map overlapping limits into core and retain supervisor-only constraints.
      - `packages/workflows/src/types.ts`, `run.ts`: pass/narrow run limits for agent nodes and persisted resumes without a second tracker.
      - `packages/server/src/limits.ts`, `handler.ts`, `packages/mcp/src/limits.ts`, `server.ts`: narrow request-level ceilings into exposed run limits where applicable.
      - `src/__tests__/run-limits.test.ts` (new), agent-loop/retry/tool tests, supervisor/workflow/server/MCP integration tests.
      - `docs/runs-and-usage.md`, `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/workflows.md`, `docs/supervisors.md`, `docs/server.md`, `docs/mcp-tools.md`, `docs/host-security.md`, `docs/performance.md`, changelogs.
    - References:
      - Current counters are split between `RunOptions.maxToolRounds`, built-in loop locals, retry policy attempts, runtime usage aggregation, and supervisor post-run checks.
      - Existing workflow/supervisor limit validators provide finite safe-integer/hard-cap conventions to reuse, not duplicate.
  - Test Cases to Write:
    - Boundary matrix for every limit: default, exact max, max+1, zero, negative, fractional, NaN, Infinity, unsafe integer, and hard-cap+1.
    - Accounting matrix: retries, revisions, multiple calls per turn, concurrent tools, derived totals, cache tokens, cost with same/missing/mixed currency, and resumed counters.
    - Race matrix: wall timeout versus host abort/provider completion/tool completion produces one breach or abort terminal event and no subsequent work.
    - Integration matrix: supervisor narrowing, workflow agent node, MCP tool, server run, and custom loop cannot exceed inherited limits.
    - Complexity check: tracker operations do not scan transcript/event history and large streamed responses retain only existing bounded buffers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; run limits, terminal event/result/error shapes, and existing option validation change.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: limit semantics, accounting points, result/event shape, token/cost caveats.
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/workflows.md`, `docs/supervisors.md`, `docs/server.md`, `docs/mcp-tools.md`, `docs/host-security.md`, `docs/performance.md`: propagation and defaults/hard caps.
    - `docs/index.md` update: yes; update Runs/usage, Agent/session runtime, Workflows, Supervisor, Server, MCP, Performance, and Security descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Added dependency-free `src/run-limits.ts`: frozen default/hard-cap matrices, `RunLimits` resolution with narrowing-only agent/run inheritance, `RunLimitTracker`, snapshots, one-shot `RunLimitError`, and public breach/counter contracts. Invalid integer/cost values, unsupported/mixed cost currency, malformed provider usage, and counter overflow fail closed; cost is capped at 10,000 host currency units.
    - `RuntimeAgentSession` owns one tracker per run and charges turns before assembly (including custom-loop direct `generate()` fallback), provider attempts/request bytes before send, response bytes per provider event, tool rounds before a batch, tool calls before dispatch, and normalized/derived usage before another turn. A first breach emits exactly one redacted `run_limit_exceeded`, aborts the shared signal, stores the event through the existing ledger path, and returns `AgentRunError.result.limit` with stable `ERR_PRISM_RUN_LIMIT` attribution. Explicit output/total-token or cost budgets buffer provider output until reported usage passes; no explicit output budget preserves existing streaming.
    - Core tool dispatch accepts the shared tracker; built-in loops charge whole rounds before concurrency starts. Workflow agent nodes forward `RunWorkflowOptions.limits`; server exposures already forward `RunOptions`; supervisor narrows its steps/tool-calls/tokens/timeout into core limits and retains its established `SupervisorLimitError` facade; MCP server tool calls use the same per-call tracker.
    - Added `src/__tests__/run-limits.test.ts` for narrowing/validation, derived token totals, cost failure modes, terminal event cardinality, result attribution, and buffered token-breach output. Updated supervisor budget assertion for the intentional terminal behavior, export-contract freeze, `runs-and-usage.md`, runtime/loop docs, and root/workflow/MCP changelogs.
    - Checks passed: `npm run build:core`; core runtime/loop/tool/run-limit/docs/export tests (214 passing); `npm run build --workspace @arnilo/prism-workflows && npm run test --workspace @arnilo/prism-workflows` (60 passing); `npm run build --workspace @arnilo/prism-supervisor && npm run test --workspace @arnilo/prism-supervisor` (13 passing); `npm run build --workspace @arnilo/prism-mcp && npm run test --workspace @arnilo/prism-mcp` (33 passing); `git diff --check`.

- [x] Add versioned durable AgentRunState, interruption, and exactly-once resume
  - Acceptance Criteria:
    - Functional: built-in ordinary agent runs can return `suspended` with an attributable approval/input interruption, persist a versioned byte-bounded state through core `CheckpointStore`, release all timers/subscribers/workers, and resume after process restart from the pending safe boundary without repeating completed provider calls. An ambiguous crash after an external tool side effect never auto-repeats it; retryable exactly-once effects require the host tool to honor Prism's stable idempotency key.
    - Functional: resume requires exact ownership, current host-authored definition revision/fingerprint, current expected checkpoint version, current agent/session/store wiring, and valid resume input; one CAS claimant advances the checkpoint and duplicate/stale/wrong-owner attempts execute nothing.
    - Functional: approval denial becomes terminal and performs no side effect; approval allows only the pending call and still reruns current guardrails, permission, execution policy, tool schema validation, and run-limit checks before execution.
    - Functional: suspended/resumed/denied/succeeded/failed/aborted statuses and events are attributable; run ledger and status APIs identify checkpoint/version/interruption without exposing blocked payloads.
    - Performance: state has a finite default/hard byte cap and bounded JSON depth/properties; it references session history by session/leaf IDs instead of copying an unbounded transcript; suspension has no polling loop, open provider stream, held worker, or lease.
    - Code Quality: implementation adapts generic `CheckpointStore` CAS/fencing and workflow suspension invariants; workflows remain the graph scheduler and no parallel durable engine, queue, lease service, or database schema is introduced.
    - Security: serialized state excludes provider objects, credential/provider resolvers, resolved credentials, redactor secret lists, callbacks, signals, stacks, and raw secrets; checkpoint load validates schema/version/shape/size before use and redacts interruption/resume/error fields before save.
  - Approach:
    - Documentation Reviewed:
      - OpenAI Agents JS human-in-the-loop guide: <https://openai.github.io/openai-agents-js/guides/human-in-the-loop/>; resumable state carries interruptions and resumes after approval.
      - LangGraph persistence overview: <https://docs.langchain.com/oss/javascript/langgraph/persistence>; checkpointed thread state supports HITL/fault recovery while long-term stores remain separate.
      - `docs/workflows.md` suspend/resume, expected-version CAS, current-policy recheck, ownership/hash/fencing, and zero-worker suspension semantics.
      - `src/checkpoints.ts`, persistence adapters' generic checkpoint capability, session store branching, `packages/workflows/src/run.ts`, `checkpoint-core.ts`, and checkpoint conformance tests.
    - Options Considered:
      - Serialize `RuntimeAgentSession`, provider, callbacks, and full transcript: unsafe/non-portable and unbounded; rejected.
      - Re-run the original prompt after approval with an idempotency flag: duplicates provider/tool effects and is not exact continuation; rejected.
      - Persist a minimal provider-neutral cursor plus pending guarded operation, session leaf reference, counters, definition fingerprint, ownership, and CAS version: chosen.
      - Generalize workflow node state into core graph vocabulary: leaks optional DAG concepts into ordinary runs; rejected. Reuse only generic CAS/suspension invariants.
    - Chosen Approach:
      - Add `AgentRunState` schema version 1 and a small adapter namespace over `CheckpointStore`; validate and redact before save, clone/validate after load.
      - Add `interrupt()` sentinel/decision consumed only at explicit safe boundaries (input guardrail or before tool side effects). Runtime checkpoints after durable transcript writes and before returning a suspended result.
      - Add `resumeAgentRun(agent, ref, decision, options)` that loads state, validates exact ownership/version/fingerprint, validates resume data, CAS-claims state, reconstructs the named built-in loop cursor, and resumes with original counters/deadline.
      - Mark the CAS claim as running before any resumed provider/tool operation and a pending tool as dispatched before its side effect. Final checkpoint updates use strictly increasing versions; stale process writes fail through existing CAS/fencing. Never auto-replay a crash-ambiguous dispatched tool; hosts that need retryable exactly-once effects must honor stable `runId/toolCallId` idempotency.
    - API Notes and Examples:
      ```ts
      const result = await session.run("Publish draft", {
        runState: { checkpoints, definitionRevision: "2026-07-20.1" },
      });

      if (result.status === "suspended") {
        await resumeAgentRun(agent, {
          sessionId: result.sessionId,
          runId: result.runId,
        }, {
          decision: "approve",
          input: { reviewer: "Ada" },
          expectedVersion: result.runState!.version,
        }, {
          checkpoints,
          ownership,
          validateResume,
        });
      }
      ```
    - Files to Create/Edit:
      - `src/agent-run-state.ts` (new): schema, adapter, fingerprint, bounded serialization, load/save/CAS helpers, interruption types/errors.
      - `src/contracts.ts`, `src/index.ts`: `AgentRunStatus` extension, `AgentRunState`, interruption/resume/config/result/event contracts and exports.
      - `src/agents.ts`, `src/agent-loops.ts`, `src/tools.ts`: safe-point capture, suspend cleanup, built-in cursor continuation, resumed policy/guardrail validation.
      - `src/checkpoints.ts`: only generic bound/conformance additions proven reusable; no agent-specific fields in `CheckpointStore`.
      - `src/testing/agent-run-state-conformance.ts` (new) and package export if persistence adapters need one shared conformance suite.
      - SQLite/PostgreSQL checkpoint adapter tests only; no new table if generic checkpoint storage suffices.
      - `src/__tests__/agent-run-state.test.ts` (new), checkpoint tests, agent/tool/loop tests, SQLite/PostgreSQL checkpoint integration tests.
      - `examples/agent-durable-approval.ts` (new): network-free suspend, process-object recreation, and exactly-once resume.
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/runs-and-usage.md`, `docs/workflows.md`, persistence pages, `docs/host-security.md`, `docs/migration.md`, changelogs.
    - References:
      - Generic `CheckpointStore` already supplies ownership, `expectedVersion`, monotonically increasing version, and fencing token.
      - Workflow suspension already proves persisted-before-side-effect approval, expected-version CAS, current-policy recheck, definition hash, and no coordinator polling for suspended work.
  - Test Cases to Write:
    - Journey: suspend for tool approval, destroy all process objects, reconstruct agent/session/checkpoint adapter, approve, execute one idempotent side effect once, and finish with original transcript/budget.
    - CAS/security matrix: concurrent approvals, stale version, duplicate approval, deny-after-approve, wrong tenant/account/user, missing ownership, changed revision/fingerprint/model/tool schema/guardrail set, changed permission/execution policy.
    - State safety: known secrets in input/tool args/guardrail metadata/error are absent after redaction; provider/resolver/callback/signal objects cannot serialize; oversized/deep/wide/malformed/unknown-version state rejects before resume.
    - Cursor matrix: interruption before first provider call and before tool execution for both built-in loops; completed provider work is not repeated; crash-ambiguous dispatched tools are never auto-repeated; unsupported custom-loop persistence rejects before work.
    - Resource check: suspended run leaves no active timer, subscriber, provider iterator, tool promise, worker, lease, or polling slot.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; run statuses/results/events, run-state options, interruption, resume, and checkpoint behavior are new.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: durable run lifecycle API, state/result/event contract, restart example.
      - `docs/agent-loops.md`: supported built-in cursor states and custom-loop limitation.
      - `docs/runs-and-usage.md`, persistence pages, `docs/workflows.md`, `docs/host-security.md`, `docs/migration.md`: accounting continuity, storage, ownership/CAS, workflow boundary, secret exclusion, migration.
    - `docs/index.md` update: yes; update Agent/session runtime, Runs/usage, Persistence, Workflows, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Added `src/agent-run-state.ts` with schema-version-1 `AgentRunState`, dedicated `prism.agent-run` checkpoint namespace, SHA-256 agent-definition fingerprint, redacted JSON clone validation, 256 KiB default / 1 MiB hard state byte caps, depth/property caps, and no serialized provider/resolver/callback/signal objects. State references the existing session/leaf and retains cumulative `RunLimitTracker` counters plus original absolute deadline.
    - Added opt-in `AgentConfig`/`RunOptions.runState`, `resumeAgentRun()`, status/interruption contracts/events, and `suspended`/`denied` run statuses. Durable mode requires stable agent id/name and host revision; durable model, guardrail, and loop selection stays on `AgentConfig` so the stored fingerprint is meaningful. Custom `AgentLoopStrategy` rejects before provider work.
    - `interruptBeforeTool` checkpoints the mediated tool call only after current guardrail, permission, schema, policy, and limit checks and before side effects. Approval CAS-claims the exact expected version, rechecks the guarded dispatcher, records `dispatched` before tool execution, and continues from stored session history without repeating the completed provider turn. Denial is terminal; an ambiguous dispatched tool rejects for explicit operator resolution rather than replaying. Input-guardrail `interrupt` similarly suspends before any provider work.
    - Added `src/__tests__/agent-run-state.test.ts`: process-object recreation and one side effect after approval, stale/duplicate resume rejection, redacted checkpoint contents, denial without execution, and ambiguous dispatched-tool refusal. Updated run-limit restoration, public export freeze, lifecycle/loop/ledger/security/event docs, and root changelog.
    - Checks passed: `npm run build`; focused core suite (350 passing); workflow tests (60 passing); supervisor tests (13 passing); MCP tests (33 passing); `git diff --check`.

- [x] Add opt-in createSecureAgent composition with fail-closed defaults
  - Acceptance Criteria:
    - Functional: `createSecureAgent()` requires exact ownership, a non-empty definition revision for durable state, known-secret redaction input/redactor, finite limits, and a JSON Schema argument validator; every active tool has a non-empty parameters schema and duplicate names fail.
    - Functional: permission and trust are deny-by-default; hosts explicitly allow tool/resource actions; side-effecting tools require an approval decision or durable interruption policy; missing validator, schema, ownership, permission, trust, approval, or required checkpoint capability rejects during composition or before side effects.
    - Functional: helper wires guardrails, `RunLimits`, tool parameter validation, redaction, ownership, interruption/checkpoint defaults, and existing provider/request policy without hidden discovery, credential resolution, package loading, network, background work, or global state.
    - Functional: low-level `createAgent()` signatures/default behavior remain backward-compatible; existing apps opt in deliberately and migration guidance distinguishes explicit from secure composition.
    - Performance: helper adds no runtime dependency, registry scan beyond O(tools), worker, timer, or duplicate validation pass; selected secure defaults remain within frozen Phase 2 limits.
    - Code Quality: helper is one thin validating composition function over current primitives, not a builder, profile container, factory hierarchy, or second agent type.
    - Security: returned config cannot silently broaden permission/trust or limits at run time; run overrides may narrow limits and add guardrails but cannot remove secure defaults, disable redaction/validation, replace ownership, or bypass durable approval.
  - Approach:
    - Documentation Reviewed:
      - `docs/host-security.md`, `docs/settings-auth-trust-security.md`, `docs/tools.md`, `docs/tool-execution-primitives.md`, `docs/credential-storage.md`, and new guardrail/run-state docs from prior tasks.
      - Existing `createAgent()`, `createToolRegistry({ duplicate: "error" })`, `createToolParameterValidator({ missingSchema: "reject" })`, static permission/trust policies, `SecretRedactor`, provider request policies, and checkpoint contracts.
      - Core dependency boundary in root `package.json`; JSON Schema implementation remains supplied by optional `@arnilo/prism-tool-validator-json-schema` or another host adapter.
    - Options Considered:
      - Change `createAgent()` to deny everything by default: secure but breaks explicit low-level compatibility; rejected.
      - Import Ajv/JSON Schema package into core: violates dependency-free core; rejected.
      - Add a new secure profile package/container: unnecessary package/runtime abstraction; rejected.
      - Add one core helper requiring a `ToolArgumentValidator` and composing existing primitives: chosen.
    - Chosen Approach:
      - Validate helper input once, build duplicate-safe registry and missing-schema-rejecting validator, AND-compose host allow policies with deny-by-default secure baseline, and call `createAgent()`.
      - Capture immutable secure defaults in the returned agent config/session run wrapper so per-run options can only narrow limits and append guardrails; do not add hidden registries or credential access.
      - Use host-selected JSON Schema adapter. Document the first-party optional adapter example without adding it to core dependencies.
    - API Notes and Examples:
      ```ts
      const agent = createSecureAgent({
        model,
        provider,
        tools,
        toolArgumentValidator: jsonSchemaValidator,
        ownership: { tenantId: "t1", userId: "u1" },
        definitionRevision: "2026-07-20.1",
        permission: createStaticPermissionPolicy({
          allow: ["tool:notes/read:execute"],
        }),
        trust: createStaticTrustPolicy(false),
        redactor: createSecretRedactor([apiKey]),
        limits: { maxTurns: 16, maxToolCalls: 32, maxTotalTokens: 50_000 },
        guardrails: { input: [piiGuard], toolInput: [commandGuard] },
        runState: { checkpoints },
      });
      ```
    - Files to Create/Edit:
      - `src/secure-agent.ts` (new): minimal options validation and composition.
      - `src/contracts.ts`, `src/index.ts`: secure options/export and narrowing rules.
      - `src/agents.ts`: only shared immutable-default merge logic needed by both creation paths.
      - `src/__tests__/secure-agent.test.ts` (new), config type tests, agent/tool/run-state tests.
      - `examples/secure-agent.ts` (new): network-free secure baseline using installed validator package.
      - `docs/guardrails.md`, `docs/agent-session-runtime.md`, `docs/tools.md`, `docs/host-security.md`, `docs/migration.md`, root/package changelogs.
    - References:
      - Current `createAgent()` is intentionally a thin explicit wrapper and must remain so.
      - `createStaticPermissionPolicy({ allow: [] })` currently means allow-all, so secure composition must not mistake an empty allow list for deny-all; use an explicit deny policy/AND composition.
  - Test Cases to Write:
    - Construction rejection: missing/empty schema, duplicate tool, missing validator, ownership, revision, redactor/secret list, permission, trust, limits, or durable approval wiring.
    - Default deny: unknown/unlisted tool, resource, and side-effect action execute nothing; explicit allow permits only exact named action.
    - Override matrix: run cannot broaden limits, replace ownership, remove guardrails, disable validation/redaction, or replace deny policies; valid narrowing succeeds.
    - Compatibility: existing `createAgent()` type/runtime fixtures and packed imports remain unchanged when helper is unused.
    - Dependency check: core production imports and package graph add no runtime package.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new secure composition API and override semantics.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: `createSecureAgent()` inputs/outputs/example.
      - `docs/guardrails.md`, `docs/tools.md`, `docs/host-security.md`: secure defaults and validator/permission/trust/approval wiring.
      - `docs/migration.md`: opt-in migration from explicit `createAgent()`.
    - `docs/index.md` update: yes; update Agent/session runtime, Guardrails, Tools, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Added dependency-free `createSecureAgent()` in `src/secure-agent.ts`. It validates a stable ID/revision, non-empty exact ownership, known-secret `SecretRedactor`, host trust/permission policies, explicit finite limits, JSON-schema adapter, duplicate-error tool registry, non-empty tool schemas, and checkpoint state. It always configures durable pre-tool interruption and shared missing-schema rejection.
    - Added `AgentConfig.trust` and centralized trust checks before resource loads and tool permission/validation/side effects. Secure config freezes its default ownership, limits, guardrail arrays, and durable options. Runtime accepts only narrower run limits and appended guardrails; it rejects secure per-run redactor, ownership, validator, and checkpoint replacement. Low-level `createAgent()` behavior remains unchanged.
    - Added `src/__tests__/secure-agent.test.ts` covering malformed construction, duplicate/schema/ownership/limit rejection, immutable secure defaults with a valid narrowing, and pre-side-effect suspension. Added offline `examples/secure-agent.ts`, exported `SecureAgentOptions`, and updated agent/runtime, guardrail, tool, security, migration, index, examples, and changelog documentation.
    - Checks passed: `npm run typecheck`; `npm test` (all workspace tests; 25 documented live skips); focused core/docs/export suite (315 passing); `git diff --check`.

- [x] Expose authorized agent-run status and resume through server and MCP adapters
  - Acceptance Criteria:
    - Functional: server and MCP expose agent-run status/resume only when a host explicitly supplies an `AgentRunLifecycle` capability backed by durable checkpoints; empty/default configuration adds no routes/tools/commands.
    - Functional: each request authenticates/authorizes before checkpoint lookup, derives exact ownership only from host authorization, validates bounded identifiers/body/resume schema/expected version, and delegates CAS/definition/policy checks to core lifecycle primitives.
    - Functional: status returns bounded redacted state metadata, interruption descriptor, status, and version—not serialized internal cursor/payload; resume returns the ordinary terminal/suspended result and duplicate/stale decisions execute nothing.
    - Performance: existing request/body/result/concurrency/timeout caps apply; suspension consumes no server/MCP concurrency slot after response; adapters add no polling or in-memory result cache.
    - Code Quality: both adapters call the same host-supplied core lifecycle service; no adapter reimplements checkpoint parsing, ownership, fingerprint, policy, guardrails, or resume logic.
    - Security: unknown/foreign runs are non-enumerable under the adapter's 404/403 policy; credentials, raw checkpoint state, blocked content, and secret-bearing resume input never appear in errors/logs/results.
  - Approach:
    - Documentation Reviewed:
      - `docs/server.md`, `docs/mcp-tools.md`, `docs/host-security.md`, and lifecycle docs completed in prior tasks.
      - Existing workflow status/resume server routes and `createWorkflowCommands()` MCP exposure patterns.
      - Current server/MCP exact authorization, ownership derivation, bounded JSON, response caps, and explicit capability registration.
    - Options Considered:
      - Add routes automatically for every configured agent: broadens exposure and invents hidden persistence; rejected.
      - Store suspended run objects in server memory: fails restart/durability and leaks resources; rejected.
      - Accept one explicit lifecycle service/capability and reuse core status/resume: chosen.
    - Chosen Approach:
      - Add optional agent lifecycle exposure beside existing agent direct-run exposure; require host checkpoint/session/agent reconstruction callback and per-operation authorization.
      - Mirror workflow status/resume HTTP semantics only where shared: expected-version CAS and ownership. Keep agent-specific state private.
      - Add MCP commands/tools only from explicitly passed lifecycle definitions; preserve empty default and existing dispatch/authorization gates.
    - API Notes and Examples:
      ```ts
      const lifecycle = createAgentRunLifecycle({
        checkpoints,
        resolveAgent: ({ agentId, authorization }) => agents[agentId],
      });

      const handler = createPrismHandler({
        agents: { support: { agent, lifecycle } },
        authorize,
      });
      ```
    - Files to Create/Edit:
      - `packages/server/src/types.ts`, `handler.ts`, `limits.ts`, `index.ts`: optional status/resume routes and lifecycle exposure.
      - `packages/server/src/__tests__/server.test.ts`: authorization, ownership, body/response/race matrix.
      - `packages/mcp/src/types.ts`, `server.ts`, `index.ts`: explicitly selected agent lifecycle command/tool registration.
      - `packages/mcp/src/__tests__/server.test.ts`: lifecycle exposure and no-default tests.
      - `packages/server/README.md`, `packages/mcp/README.md`, package changelogs.
      - `docs/server.md`, `docs/mcp-tools.md`, `docs/agent-session-runtime.md`, `docs/host-security.md`, `docs/migration.md`.
    - References:
      - Existing workflow routes already implement authorized status/resume with bounded body and expected-version input.
      - Existing docs explicitly reject invented in-memory agent reconnect/status state; durable core lifecycle now supplies the missing primitive.
  - Test Cases to Write:
    - No exposure/default: no lifecycle config returns 404 and MCP capability list contains no agent status/resume entry.
    - Authorization matrix: missing/invalid auth, wrong tenant/account/user, unknown agent/run, request-body ownership spoof, and foreign-version probes reveal no state and execute nothing.
    - Resume matrix: approve, deny, malformed body, missing/stale/duplicate expected version, changed policy/fingerprint, oversized input/result, timeout, and concurrent claim.
    - Redaction: status/resume errors and MCP/HTTP payloads omit internal state, secrets, blocked content, and stacks.
    - Resource check: suspended HTTP/MCP call releases concurrency immediately and restart uses durable service rather than process memory.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; optional server routes and MCP capability definitions are new.
    - Docs pages to create/edit:
      - `docs/server.md`: opt-in routes, request/response, authorization, limits, deployment behavior.
      - `docs/mcp-tools.md`: explicit lifecycle commands/tools and authorization.
      - `docs/agent-session-runtime.md`, `docs/host-security.md`, `docs/migration.md`: remote lifecycle and security/migration guidance.
    - `docs/index.md` update: yes; update Server, MCP, Agent/session runtime, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Added dependency-free core `createAgentRunLifecycle()` capability. It owns durable checkpoint status/resume delegation, returns only public redacted state/version, resolves the current host agent/revision only for resume, and routes every approval through existing ownership, expected-version CAS, fingerprint, policy, guardrail, limit, and ambiguity checks. Adapter-selected agent IDs are compared to stored state so same-owner runs cannot cross a selected agent capability.
    - Added explicit `agentRuns` maps to `createPrismHandler()` and `createPrismMcpServer()`. Server exposes `GET /prism/agents/:id/runs/:runId` (`agent.status`) and `POST .../resume` (`agent.resume`) only for configured keys; MCP registers only `agent.<id>.status` and `agent.<id>.resume`. Neither adapter has default lifecycle exposure, polling, state cache, checkpoint parsing, or resume implementation. Lifecycle paths require host-derived exact tenant plus account/user ownership; server maps unknown/foreign lifecycle state to non-enumerable 404 and MCP uses bounded generic failure text.
    - Server resume accepts only bounded `{ decision, expectedVersion }`, holds normal execution concurrency only until its terminal/suspended response, and uses existing request/result/time caps. Status omits cursor, pending tool payload, counters, input, deadline, and secrets. Updated core/server/MCP exports, frozen export contract, package READMEs/changelogs, and runtime/server/MCP/security/migration/index documentation; docs state restart-safe remote resume requires both durable checkpoint and session stores.
    - Added server coverage for explicit-only route registration, redacted status, approval, stale duplicate rejection, and cross-capability non-enumeration; MCP coverage verifies explicit tool registration, status, denial with zero side effects, and absence from an ordinary capability list.
    - Checks passed: `npm test` (all workspace tests; documented live tests skipped); focused core durable/export suite (142 passing); server suite (9 passing); MCP suite (34 passing); `git diff --check`.

- [x] Integrate documentation, examples, package versions, and the 0.0.7 release-candidate gate
  - Acceptance Criteria:
    - Functional: all affected API docs, navigation, examples, package READMEs/changelogs, root changelog, exports/declarations, package manifests/internal ranges, lockfile, and release metadata describe and resolve as `0.0.7`; roadmap Phase 2 is marked complete only after every prior task and gate passes.
    - Performance: adversarial guardrail/limit/state/race suites complete within existing CI backstops or a measured documented revision; `npm run sdk:ready` stays within five minutes; packed/install size deltas and state/resume timing are recorded.
    - Code Quality: focused suites, full build/typecheck/offline tests, dry-run packing, Node 20/current compatibility, packed-consumer imports, docs checks, and package graph validation pass; no test is replaced by a source-text assertion where behavior can run.
    - Security: audit/tree, secret scan, tarball deny list, provenance dry run, persistence live suites, hostile-state/ownership/CAS tests, and relevant provider usage canaries pass where infrastructure exists; no blocker is waived to preserve version/date.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, `docs/migration.md`, `docs/index.md`, every page changed by prior tasks, package manifests/changelogs, `.github/workflows/release.yml`, and `scripts/release.mjs`.
      - Phase 2 release gate in `roadmap.md` and Phase 1 completion evidence in `plans/068-release-0-0-6-production-blockers.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure and navigation requirements.
    - Options Considered:
      - Add a new release framework or publish automatically: unnecessary and unsafe; rejected.
      - Reuse `sdk:ready`, current release scripts, Node 20 check, packed install, database/live gates, tarball and secret checks: chosen.
    - Chosen Approach:
      - Finish docs/examples/contracts first, then bump all 30 package manifests/internal ranges and lockfile together using existing release conventions.
      - Run focused suites after each implementation task, then one complete release-candidate matrix; do not commit, tag, or publish without explicit operator authorization.
      - Record actual deviations and deferred work in this plan, then update `roadmap.md` Phase 2 checkbox/evidence only after all gates pass.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      npm run release:check -- --version 0.0.7 --allow-untagged
      npm run release:publish -- --version 0.0.7 --dry-run --allow-dirty --allow-untagged
      git diff --check
      ```
    - Files to Create/Edit:
      - `docs/index.md`, `docs/release-and-install.md`, `docs/migration.md`, and every docs page assigned in prior tasks.
      - `examples/secure-agent.ts`, `examples/agent-durable-approval.ts`, existing examples affected by finite defaults/types.
      - Root and affected package `README.md`/`CHANGELOG.md` files.
      - Root `package.json`, all workspace `package.json` files, `package-lock.json`, version constants/fixtures, and release tests for the 30-package `0.0.7` graph.
      - `.github/workflows/*` and `scripts/release.mjs` only if current gates cannot exercise new lifecycle security checks.
      - `roadmap.md`: mark Phase 2 complete and append concise evidence only after passing gates.
      - `plans/069-release-0-0-7-secure-run-lifecycle.md`: mark completed tasks and fill final evidence, compromises, and actions.
    - References:
      - Existing `npm run sdk:ready`, `release:check`, `release:publish --dry-run`, package provenance ordering, Node 20 import, packed-consumer, PostgreSQL, and keychain gates.
      - 0.0.6 baseline: 1,767 tests, 30 dry-run packs, zero known audit vulnerabilities; live provider/database/keychain tests remain explicit infrastructure gates.
  - Test Cases to Write:
    - Full offline gate: `npm run sdk:ready`, docs suite, `npm audit --audit-level=high`, `npm ls --all`, and `git diff --check`.
    - Compatibility/package gate: Node 20 and current Node builds/public imports, all 30 dry-run packs, fresh offline packed consumer, public type/export checks, and exact `0.0.7` version/range graph.
    - Lifecycle release matrix: guardrail no-leak/order/tripwire, every limit boundary, restart/resume CAS/ownership/policy/fingerprint, secure-helper deny defaults, and server/MCP no-default exposure.
    - Live persistence matrix: SQLite and provisioned PostgreSQL generic checkpoint/state conformance including concurrent resume; provider usage/cost canary only where a configured provider reports normalized usage.
    - Negative release fixtures: stale `0.0.6` range, leaked secret, shipped source/test/map, malformed state schema, missing public export/docs navigation, or unexplained skipped required test fails the gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task integrates all Phase 2 APIs, defaults, migration notes, and release artifacts.
    - Docs pages to create/edit:
      - `docs/index.md`: final navigation for Guardrails and updated lifecycle/security pages.
      - `docs/release-and-install.md`: `0.0.7` package graph, commands, evidence, and operator handoff.
      - `docs/migration.md`: complete `0.0.6` → `0.0.7` opt-in/behavior changes.
      - All pages assigned by prior tasks: final link/API-shape/default consistency review.
    - `docs/index.md` update: yes; validate every changed/new page has one functional description and link in the appropriate group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Finalized all Phase 2 docs/API navigation, root and package changelogs, migration/release handoff, package READMEs, and an offline `agent-durable-approval.ts` example proving suspend-before-side-effect plus one CAS approval resume. Existing secure-agent example remains the fail-closed composition reference.
    - Bumped core plus 29 workspace manifests, exact internal dependency/peer ranges, lockfile workspace records, runtime MCP metadata, CLI/init/install/packaging/release fixtures, and release tests to exact `0.0.7`. Every published package now ships a `0.0.7` changelog entry; public export/type snapshots include lifecycle APIs.
    - `npm run sdk:ready` passed inside the existing five-minute backstop: 1,785 tests (1,760 pass, 25 intentional credential-gated skips, 0 fail), full typecheck/build, docs/export/tarball/secret guards, offline packed consumer, and all 30 dry-run packs. Core artifact: 241 files, 466.5 kB packed, 1.7 MB unpacked (+11 files/+21.0 kB packed from 0.0.6).
    - Docker Node 20.20.2 rebuilt all workspaces and imported every public core export. Disposable `pgvector/pgvector:pg16` passed 17 persistence and 14 memory checks; `PRISM_TEST_KEYCHAIN=1` passed 27 credential tests. `npm audit --audit-level=high` found 0 vulnerabilities; `npm ls --all --depth=0`, `git diff --check`, exact 30-package registry preflight, and dependency-ordered 30/30 public/latest/provenance publish dry-run passed. Provider/A2A live smoke tests remain intentionally skipped without credentials/endpoints.
    - No commit, tag, registry publication, or release artifact was created. `roadmap.md` marks Phase 2 complete only after this matrix passed.

## Compromises Made

- No runtime or release-gate compromise. Provider and external A2A live smokes remain explicit credential/endpoint-gated checks; they were not run because no credentials/endpoints were supplied.
- No commit, signed tag, or registry publication was performed; those irreversible operator actions remain outside this task.

## Further Actions

- P0: merge through protected CI, confirm provider/A2A credentials if policy requires their live smoke, create and verify signed `v0.0.7`, then let the provenance workflow publish/resume the exact graph.
- P1: retain CI pack/checksum/publish reports with the signed release tag; run post-publish registry/import/signature smoke from the documented handoff.
