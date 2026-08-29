# Clay Integration Findings — Bug Reports and Feature Requests

Status: open change requests against `@arnilo/prism` 0.3.0 (npm dist) and the
`0.3.1` workspace source. Produced by the Clay coding-agent integration review
(see Clay `roadmap.md`, "Prism Capability Review"). Every runtime claim below
was verified by executing code, not by reading docs: a 37-assertion,
network-free smoke suite (mock providers, memory stores) covering agent loops,
observational memory, workflows with durable suspend/resume, supervisor
delegation, declarative agent resolution, and the coding tool set.

Proposed intake: turn BUG-1 into the next patch release (0.3.2); triage the
FEATURE/DOCS items into a capability-gaps release plan in the style of
`plans/004`. Clay is happy to contribute the smoke suite as regression tests
per fix.

Index:

- BUG-1 (blocker): `suspendAskUserDecision` accept-time omission of `allowCustom` breaks its own resume validator after checkpoint persistence
- BUG-2 (minor, DX): supervisor delegation crashes with a cryptic error when a child factory returns a session instead of an agent
- FEATURE-1 (P1): let `resolveAgentDefinition` resolve a missing definition model from `context.overrides`
- FEATURE-2 (P1): blessed bounded iterate-until-done orchestration pattern (or primitive) + example
- FEATURE-3 (P2): host driver hooks on `CommandExecutionContext` so contributed commands can act
- FEATURE-4 (P2): optional supervisor child event passthrough for nested-run UI streaming
- FEATURE-5 (P3): opt-in cross-session observational-memory scope
- FEATURE-6 (P1, docs/examples): composite `autonomous-coding-loop` example
- DOCS-1 (P2): document the three behavioral contracts that caused integration dead-ends

---

## BUG-1 (blocker): omitted `allowCustom` in `suspendAskUserDecision` breaks resume after checkpoint persistence

- **Package:** `@arnilo/prism-coding-agent`
- **Locations (0.3.1 source):**
  - `packages/coding-agent/src/ask-user-decision.ts:579` — `toAskUserDecisionSuspendData` copies `allowCustom: request.allowCustom` verbatim.
  - `packages/coding-agent/src/ask-user-decision.ts:599` — `isAskUserDecisionSuspendData` requires `typeof row.allowCustom === "boolean"`.
  - `packages/coding-agent/src/ask-user-decision.ts:614` — `suspendAskUserDecision` performs no runtime validation of `allowCustom` (only the options-count check).
  - `packages/coding-agent/src/ask-user-decision.ts:657` — `createAskUserDecisionResumeValidator` rejects the persisted suspension with a misleading error.
- **Reported against:** 0.3.0 npm dist (reproduced at runtime); confirmed still present in `0.3.1` workspace source.
- **Severity:** blocker for durable human-in-the-loop flows (Clay `st` `/start` suspend/resume). TypeScript marks `allowCustom` required, but that is not a runtime guarantee for JS hosts, generated/serialized data, or records persisted by older versions.

### Description

A host that omits `allowCustom` when building the suspend request gets
`allowCustom: undefined` in the suspend data. Workflow checkpoints persist the
suspension as JSON, which drops the key entirely. On resume, Prism's own
`isAskUserDecisionSuspendData` guard fails on the missing boolean and
`createAskUserDecisionResumeValidator` throws:

```
Error: suspension.data missing ask_user_decision request
```

The failure surfaces far from the cause (at resume time, against persisted
state) and the message wrongly suggests the suspend data was never written.
Notably, the sibling `ask_user_decision` **tool** path handles this correctly:
`createAskUserDecisionTool` normalizes via `parseAllowCustom` (defaults to
`false` when absent), so only the workflow suspend path is affected.

### Repro (verified)

```js
import { defineWorkflow, functionNode, runWorkflow, resumeWorkflow, createMemoryWorkflowCheckpoints } from "@arnilo/prism-workflows";
import { suspendAskUserDecision, createAskUserDecisionResumeValidator } from "@arnilo/prism-coding-agent";

const workflow = defineWorkflow({
  id: "repro", revision: "1",
  nodes: { start: functionNode({ execute: async () => suspendAskUserDecision({
    question: "Pick one",
    selectionMode: "single",
    // allowCustom omitted
    options: [
      { id: "a", label: "A", pros: ["1", "2", "3"], cons: ["1", "2", "3"] },
      { id: "b", label: "B", pros: ["1", "2", "3"], cons: ["1", "2", "3"] },
    ],
  }) }) },
  edges: [],
});
const checkpoints = createMemoryWorkflowCheckpoints();
const ownership = { tenantId: "t", userId: "u" };
const r1 = await runWorkflow(workflow, {}, { checkpoints, ownership });   // status: "suspended"
await resumeWorkflow(workflow, { runId: r1.runId }, {
  checkpoints, ownership,
  resume: { decision: "approve", input: { selectedId: "a" }, expectedVersion: r1.version },
  validateResume: createAskUserDecisionResumeValidator(),
}); // throws: suspension.data missing ask_user_decision request
```

Passing `allowCustom: false` explicitly makes the same flow succeed.

### Expected

Either (preferred) `toAskUserDecisionSuspendData` defaults `allowCustom` to
`false` exactly like the tool path, or `suspendAskUserDecision` throws at
accept time with an actionable message ("allowCustom must be a boolean"). The
current behavior — silent accept, then a confusing resume-time rejection from
persisted state — is the worst of the three.

### Acceptance criteria

- [ ] `suspendAskUserDecision` without explicit `allowCustom` resumes successfully after a JSON checkpoint round-trip (defaults to `false`), or fails at suspend time with a clear error — never at resume time with "missing ask_user_decision request".
- [ ] Regression test covers durable suspend → JSON persistence → resume with `allowCustom` omitted, for both `single` and `multiple` selection modes.
- [ ] Tool path (`createAskUserDecisionTool`) and workflow path agree on the default (`false`).

---

## BUG-2 (minor, DX): cryptic supervisor error when a child factory returns a session

- **Package:** `@arnilo/prism-supervisor`
- **Location:** `packages/supervisor/src/supervisor.ts:145` and `:316` — `childAgent.config.permission` is read without validating what the child factory returned.
- **Reported against:** 0.3.0 npm dist (reproduced at runtime).

### Description

If a `SupervisorChild.createAgent` factory returns an `AgentSession` instead
of an `Agent` (an easy mistake — sessions are what hosts otherwise handle),
delegation fails with:

```
SupervisorError: Cannot read properties of undefined (reading 'permission')
```

No hint that the factory's return type is the problem.

### Expected

Validate the factory result (agent shape: `config`, `createSession`) and fail
with an actionable message, e.g. `Supervisor child "test-writer" factory must
return an Agent, got <type>`.

### Acceptance criteria

- [ ] Non-`Agent` factory returns produce a named, actionable `SupervisorError` at `delegate()` time.
- [ ] Supervisor docs state explicitly that factories return `Agent`, not `AgentSession`.

---

## FEATURE-1 (P1): resolve a missing definition model from `context.overrides`

- **Package:** `@arnilo/prism` (core)
- **Location:** `src/agent-definitions.ts:54` — `resolveModel` throws `Agent "<name>" has no model` inside `buildBaseConfig`, which runs **before** `applyConfigOverrides(baseConfig, context.overrides)` in the no-`create()` path.
- **Reported against:** 0.3.0 npm dist (reproduced); confirmed in `0.3.1` source.

### Motivation

The `AgentDefinition` doc table marks `model` optional, but without a
`create()` escape hatch the resolution path throws before overrides apply, so
`context.overrides.model` cannot satisfy it. Verified repro:

```js
await resolveAgentDefinition({ name: "st", instructions: "You are st." }, {
  overrides: { model: { provider: "mock", model: "demo" }, provider: mockProvider },
});
// Error: Agent "st" has no model
```

Hosts that inject the user's currently selected model at resolution time
(Clay's case: a third-party package ships a declarative agent, the host
supplies the model) must mutate the definition before resolving, which breaks
the declarative model for package authors.

### Proposal

In the no-`create()` path, when `def.model` is absent, fall back to
`context.overrides.model` (and/or a `context.defaultModel` host binding)
before failing. Alternatively, keep the throw and correct the docs to state
that `model` (or `create()`) is mandatory.

### Acceptance criteria

- [ ] A definition without `model` resolves when `context.overrides.model` (or an equivalent context default) supplies one; overrides precedence is documented.
- [ ] Docs and type comments agree with runtime behavior.

---

## FEATURE-2 (P1): blessed bounded iterate-until-done orchestration pattern

- **Packages:** `@arnilo/prism-workflows` (docs, possibly a helper)

### Motivation

Workflows are deliberately acyclic and revision-fingerprinted — good durable
execution properties. But the most requested agentic shape, "loop until the
goal is achieved," is cyclic. Clay's autonomous agent needs to re-enter a
phase (implement → validate → revise) with updated state until exit criteria
pass, and today must invent its own host-side loop semantics (one workflow run
per iteration? state passed via workflow inputs? how to bound and audit?).

### Proposal

Either is acceptable; the documented pattern is the minimum:

1. **Docs + example (minimum):** a documented host-loop pattern — one
   `runWorkflow` per iteration, iteration state in workflow inputs, explicit
   termination predicate and budgets, `replayWorkflow` for auditing — plus a
   runnable example. No new runtime machinery.
2. **Primitive (nice-to-have):** a bounded `iterateUntil` helper (saga-style)
   with explicit state, max-iterations/tool-call/token budgets, a termination
   predicate, and durable checkpoints per iteration.

### Acceptance criteria

- [ ] The chosen pattern/primitive is documented with a runnable example demonstrating: N bounded iterations, mid-loop suspend/resume (human gate), and deterministic termination on budget exhaustion.

---

## FEATURE-3 (P2): host driver hooks on `CommandExecutionContext`

- **Package:** `@arnilo/prism` (core, commands)

### Motivation

`CommandExecutionContext` carries ids/signal/metadata only, so a contributed
command cannot start a run, steer a session, or launch a workflow. Clay's
`/start` command (launch an autonomous workflow) therefore has to be mapped
host-side, outside Prism's command registry, which splits the mental model:
the command is declared in a package but implemented in the host.

### Proposal

Optional, host-supplied driver hooks on the command context, e.g.
`context.drivers = { startRun, steer, startWorkflow }` — populated only when
the host opts in, so command contributions stay inert data in hosts that
don't. Keep the current context shape unchanged when drivers are absent.

### Acceptance criteria

- [ ] A command can, when the host supplies drivers, trigger a session run or workflow start; without drivers, behavior is unchanged.
- [ ] Docs mark the capability as host-opt-in.

---

## FEATURE-4 (P2): optional supervisor child event passthrough

- **Package:** `@arnilo/prism-supervisor`

### Motivation

`supervisor.subscribe()` emits delegation lifecycle metadata only
(`delegation_started/finished/rejected/error`). Host UIs rendering nested
autonomous runs (Clay's sub-agent validation loop) want per-turn child event
visibility — at least tool-call milestones — without giving children direct
store/subscription access.

### Proposal

Opt-in per-child `eventSink` (or supervisor-level `subscribe({ childEvents: true })`)
projecting a redacted, size-capped subset of child `AgentEvent`s onto the
supervisor event stream, tagged with `delegationId`/`childId`/`depth`.
Default off; caps configurable. Milestone-level events are an acceptable v1;
full per-token streaming is not requested.

### Acceptance criteria

- [ ] Opt-in child events appear on the supervisor stream with delegation tags and redaction/caps applied; default behavior unchanged.

---

## FEATURE-5 (P3): opt-in cross-session observational-memory scope

- **Package:** `@arnilo/prism-compaction-observational-memory`

### Motivation

OM is per session/branch, but delegated trees (supervisor children) produce
observations in child sessions the parent cannot recall. v1 is acceptable —
the parent records delegation outcomes, so parent OM naturally covers
milestones — but a workspace-scoped memory would let `recall` span a whole
build across parent and children.

### Proposal

An opt-in shared scope: either a host-provided `MemoryStore` composition
(documented pattern funneling child observations into a parent/workspace
branch), or a namespaced multi-tenant store key so `recall` can address
`sessions` within a scope. Exact-id semantics must remain branch-addressable
and unambiguous.

### Acceptance criteria

- [ ] A documented pattern or primitive allows recall across a parent/child delegation tree without weakening exact-id, branch-scoped semantics; default single-session behavior unchanged.

---

## FEATURE-6 (P1, docs/examples): composite `autonomous-coding-loop` example

- **Packages:** `examples/` (new), touching `@arnilo/prism-supervisor`,
  `@arnilo/prism-workflows`, `@arnilo/prism-coding-agent`,
  `@arnilo/prism-compaction-observational-memory`

### Motivation

Each primitive is individually documented, but the intended composition of an
autonomous build loop — goal → roadmap artifact → per-phase plan →
task-by-task execution with sub-agent validation and per-task observational
memory — has to be rediscovered by every host. Clay assembled this
composition from five packages and hit every contract listed under DOCS-1 on
the way.

### Proposal

One runnable example, mock-provider by default (network-free), demonstrating:
durable workflow with a human gate; supervisor children with per-child models;
`runCodingGoalVerify`-style validation feedback; OM attach + per-task manual
compaction + recall; budgets and termination. This becomes the conformance
reference for hosts and the seed for the FEATURE-2 documentation.

### Acceptance criteria

- [ ] Example runs green from a fresh clone with mock providers only and exercises suspend/resume across a simulated restart.

---

## DOCS-1 (P2): document the behavioral contracts that caused integration dead-ends

- **Packages:** docs for `@arnilo/prism-workflows`, `@arnilo/prism-supervisor`, `@arnilo/prism` (sessions)

Three contracts were discovered by runtime failure, not by docs. All three are
reasonable designs; they just need to be stated where integrators will find
them:

1. **Resume-aware workflow nodes.** A suspended node's `execute` is
   re-invoked with `ctx.resume` after an approved resume; a node that
   unconditionally returns its suspension re-suspends silently and downstream
   nodes never run. Document the pattern
   `execute: (ctx) => ctx.resume ? handle(ctx.resume) : suspend(...)` on the
   suspend/resume docs page with a warning box.
2. **Supervisor child factories return `Agent`, not `AgentSession`** (see
   BUG-2), and children need a stable config plus a durable store for nested
   approvals to resume.
3. **`session.compact()` fails closed during an active run.** Task-boundary
   compaction (one run per task) is the intended model; say so on the
   compaction docs page so hosts don't design mid-run compaction.

### Acceptance criteria

- [ ] All three contracts appear in the relevant docs pages with the failure mode each prevents.
- [ ] Each docs page links to the composite example (FEATURE-6) demonstrating the contract.

---

## Verification notes

- Repro environment: Node ≥ 20, `@arnilo/prism` 0.3.0 npm dist, mock
  providers, memory stores; no network, no external services.
- The full Clay smoke suite (37 assertions) is available to fold into
  `src/__tests__/` as regressions for BUG-1, FEATURE-1, and the supervisor
  validation — say the word and it will be contributed as a PR alongside the
  fixes.
