# Phase 50 — Clay integration findings + OKF adoption: capability matrix and primitive review

Evidence file for plan 050 Task 1. Reviewed 2026-08-29. Inputs pinned:

- Findings: `docs/_evidence/clay-integration-findings.md` — BUG-1, BUG-2,
  FEATURE-1..6, DOCS-1, each runtime-verified by the Clay review against
  `@arnilo/prism@0.3.0` (npm dist).
- OKF spec: `GoogleCloudPlatform/open-knowledge-format` `SPEC.md` **v0.2**
  — §3 bundle structure, §4 concept frontmatter, §5.1 `sources`, §5.2
  `generated`/`verified`, §5.3 trust tiers, §5.4 `status`, §6 links, §8
  `index.md`, §9 `log.md`, §12 `okf_version`. Reference bundle:
  `bundles/ga4/` (root/subdirectory `index.md`, concept frontmatter with
  `sources` + `generated`, footnote attribution via `sources[].id`).
- Repo baseline: `edb4fcf` (workspace `0.3.1`).

Every span below was re-verified against current source on 2026-08-29;
Clay's original 0.3.0-era line numbers are superseded where noted.

## 1. Verified change-site spans

| Item | Site(s) | Verified state |
| --- | --- | --- |
| BUG-1 | `packages/coding-agent/src/ask-user-decision.ts` | `toAskUserDecisionSuspendData` :578-596 copies `allowCustom` verbatim; `isAskUserDecisionSuspendData` :598-607 requires a boolean; `suspendAskUserDecision` :609-627 validates only option count; `createAskUserDecisionResumeValidator` :656-667 rejects with `suspension.data missing ask_user_decision request`. Tool path normalizes correctly: `parseAllowCustom` :241-245 (`undefined/null → false`, non-boolean → throw). |
| BUG-2 | `packages/supervisor/src/supervisor.ts` | Child factory result consumed unvalidated at the initial-run `createAgent` spread (~:137-152) and the resume path (~:315). `childAgent.config.permission` read directly; non-`Agent` result ⇒ `Cannot read properties of undefined (reading 'permission')`. |
| FEATURE-1 | `src/agent-definitions.ts` | No-`create()` path :31-33 builds `baseConfig` (→ `buildBaseConfig` :36 → `resolveModel` :54 throws `Agent "<name>" has no model`) **before** `applyConfigOverrides(baseConfig, context.overrides)` :143-146. `context.overrides` is `Partial<AgentConfig>` and already carries `model`. |
| FEATURE-3 | `src/contracts-core/agent.ts:154-170` | `CommandDefinition.execute(args, context: CommandExecutionContext)`; context carries `sessionId?/runId?/signal?/metadata?` only. First-party execution site constructing the context: `src/rpc.ts:235` (`command.execute(args, { sessionId })`). Registration seam: `src/extensions.ts:152-154` (`registerCommand` → `registries.commands`). |
| FEATURE-4 | `packages/supervisor/src/supervisor.ts` | Event stream is a plain multiplexer: `events.publish({ type: "delegation_started", ... })` :121, `delegation_finished` :215 (plus `rejected`/`error` sites); `subscribe: () => events.subscribe()` :360. Child session `run` is invoked at ~:150 with supervisor-owned `AbortController`. |
| FEATURE-5 | `packages/compaction-observational-memory/src/compose.ts` + docs | `attach()` (:84-99) requires host-supplied `appendEntry` bound to the session's owning store/branch; the separate `store` option was **removed** because mismatched pairs could append outside the active branch, and the runtime verifies each appended entry is visible at the session leaf and fails closed/restores checkout otherwise. `recallObservationalMemory()` / `recallObservationalMemoryBranchPage()` accept **host-supplied current-branch entries** (exact-id or cursor paging; no semantic search). |
| FEATURE-6 | `examples/` | Existing composition idioms to reuse: `durable-coding-workflow.ts`, `coding-goal-verify.ts`, `durable-loops-and-approvals.ts`, `agent-durable-approval.ts`. All runnable/mock-backed. |
| FEATURE-2 | `docs/workflows.md` | Suspend/resume mechanics at :77 (re-invocation with `ctx.resume`) and the resume-aware pattern snippet :182-183 exist but without the failure-mode warning; no iterate-until-done recipe. Bounded-loop node primitive is scoped (unchecked) in `plans/045-Bounded-Loop-Workflow-Node.md`. |
| DOCS-1 | `docs/workflows.md`, `docs/supervisors.md`, `docs/compaction-and-retry.md` | `workflows.md:77/:182` partial resume-aware coverage (no warning box); `supervisors.md` lacks the factory-returns-`Agent` statement; `compaction-and-retry.md:24` describes `session.compact()` without the fails-closed-during-active-run contract. |
| OKF | `packages/prism-wiki/src/` | Scaffolder `engine/scaffolder.ts` (SCHEMA.md/index.md/log.md templates, `[[wikilink]]` convention, `## [YYYY-MM-DD HH:MM] op | …` log form); compiler `engine/compiler.ts` `renderEntityMarkdown` :28-65 (legacy frontmatter `id/title/category/tags/rawSources/lastCompiledAt`) and `renderIndexCatalog` :67+ (`[[entities/<id>.md|…]]` links); linter `engine/linter.ts` (dead anchors, broken links, orphans, gaps); skills `src/skills.ts:109-124` + `skills/wiki-maintainer/SKILL.md` (four Karpathy principles); types `src/types.ts` `WikiEntityMetadata` :17-25 (no `description`); commands `commands/{init,refresh,lint}.ts` + `src/cli.ts` (init/refresh/lint/search — commands exist; no new commands needed). |

## 2. Per-item primitive review and smallest-gap decisions

### BUG-1 — `allowCustom` accept-time omission

- **Existing primitive that covers it:** `parseAllowCustom`
  (`ask-user-decision.ts:241-245`) — exactly the normalization needed
  (`undefined/null → false`, non-boolean → actionable throw). The tool path
  already uses it; only the suspend path bypasses it.
- **Smallest gap:** one normalization at `toAskUserDecisionSuspendData`
  (the single choke point both request union members route through), plus
  widening `allowCustom` to optional in the `Pick<>` request type.
  `isAskUserDecisionSuspendData` and the resume validator stay strict —
  persisted data becomes always-boolean.
- **Trust boundary:** normalization at accept time, **before** persistence;
  fail-closed preserved for non-boolean values (no silent coercion);
  `customText` still rejected when the effective `allowCustom` is `false`.

### BUG-2 — supervisor child factory validation

- **Existing primitives:** `SupervisorError` (typed, named) already exists
  for delegation failures; both consumption sites (~:137, ~:315) are the
  only places the factory result is dereferenced.
- **Smallest gap:** one private shape guard (`config` object +
  `createSession` function) invoked at both sites, throwing
  `SupervisorError: child "<id>" factory must return an Agent, got <type>`.
- **Trust boundary:** guard runs **before** `intersectPolicies` reads
  `childAgent.config.permission` — no partially-initialized delegation
  state, no policy intersection on garbage.

### FEATURE-1 — model from `context.overrides`

- **Existing primitive:** `context.overrides` is already
  `Partial<AgentConfig>` and already applied in the no-`create()` path
  (:33) — it just runs **after** `resolveModel` throws. No new seam needed;
  a `context.defaultModel` binding would be a redundant second surface.
- **Smallest gap:** `def.model ?? context.overrides?.model` fed into
  `resolveModel` from `buildBaseConfig`. Explicit `def.model` wins; both
  absent still fails closed with the existing message. `create()` path
  untouched.
- **Trust boundary:** no change to provider resolution
  (`resolveProviderOptions` still binds `providerSource`/registries);
  model-less definitions without overrides still fail closed.

### FEATURE-3 — command driver hooks

- **Existing primitives:** `CommandExecutionContext`
  (`src/contracts-core/agent.ts:162`) is the typed execution context;
  `src/rpc.ts:235` is the only first-party site constructing it;
  `registerCommand` (`src/extensions.ts:152`) keeps commands as data.
  Contributed-command precedent (args → typed result, `metadata.trust`
  labeling): `packages/prism-wiki/src/commands/*.ts`.
- **Smallest gap:** additive `drivers?: CommandDrivers` on the context
  (`startRun`, `startWorkflow`, `steer` — typed minimal handles returning
  what hosts already understand), forwarded by `src/rpc.ts:235` when the
  host supplies them. Core types and forwards only; **no host logic in
  core**, no generic `services` bag.
- **Trust boundary:** drivers are host-injected capabilities, never
  package-supplied; absent drivers ⇒ context shape byte-identical; command
  `metadata.trust` labeling unaffected. Docs mark host-opt-in.

### FEATURE-4 — supervisor child event passthrough

- **Existing primitives:** the supervisor event stream is already a
  publish/subscribe multiplexer (`events.publish` :121/:215, `subscribe`
  :360) with delegation tags (`childId`, `delegationId`, `depth`) already
  on lifecycle events; `options.redactor` wiring exists; supervisor
  limit-resolution precedent exists for caps. `AgentEvent` taxonomy
  (`docs/agent-events.md`) defines the milestone subset (tool calls, run
  start/finish).
- **Smallest gap:** supervisor-level opt-in flag; when enabled, wrap each
  child session's event stream with filter (milestone subset) → redactor
  pass → per-delegation cap counter → tagger, then publish onto the
  supervisor stream. Default off ⇒ stream unchanged.
- **Trust boundary:** redaction before emission; payload size/count capped
  (drop + one capped marker, never throw); children never receive
  supervisor internals or store/subscription access; full per-token
  streaming explicitly out of scope (milestone-level v1, per findings).

### FEATURE-5 — cross-session OM recall

- **Existing primitives:** OM deliberately constrains the store surface:
  `attach()` takes a host-bound `appendEntry`, verifies leaf visibility,
  and fails closed on session/store mismatch (the separate `store` option
  was removed for exactly that hazard). Recall APIs accept host-supplied
  entries (`recallObservationalMemory` exact-id, cursor paging) — the
  host already controls **which** entries recall sees.
- **Decision:** documented host-side pattern only (P3; findings accept the
  pattern as the minimum): a workspace `MemoryStore` holding parent and
  child branches; parent recall supplies merged parent+child branch
  entries to `recallObservationalMemory`. No package runtime change; exact
  id semantics stay branch-addressable because the pattern never widens
  `appendEntry` across sessions — it widens only the **read** side, which
  is already host-supplied. `appendEntry` stays bound per-session (the
  fail-closed leaf check stays intact). Demonstrated inside the Task 8
  composite example; documented on `docs/compaction-observational-memory.md`.
- **Trust boundary:** observations remain inside the ownership scope the
  underlying store enforces; no cross-tenant key surface; default
  single-session behavior untouched.

### FEATURE-6 — composite `autonomous-coding-loop` example

- **Existing primitives:** every component has a runnable example already
  (`durable-coding-workflow.ts`, `coding-goal-verify.ts`,
  `durable-loops-and-approvals.ts`, `agent-durable-approval.ts`); the
  composite is assembly, not new machinery. Examples are compile-checked
  and the runnable ones carry self-assert checks.
- **Smallest gap:** one new `examples/autonomous-coding-loop.ts`
  (mock provider, memory stores, simulated restart = drop handles,
  rebuild runtime, resume from the same checkpoint store). Host-side loop
  (one `runWorkflow` per iteration) so it doubles as the FEATURE-2 demo.
- **Trust boundary:** no credentials, no network, mock providers only;
  budgets explicit and fail-closed (typed error/terminal on exhaustion,
  never a hang).

### FEATURE-2 — bounded iterate-until-done pattern

- **Existing primitives:** `runWorkflow` per call, `replayWorkflow` for
  audit, suspend/resume with `ctx.resume`, workflow limits — all shipped.
  The in-graph `loop` node primitive is separately scoped (plan 045,
  unchecked) and is **not** pulled into this release.
- **Decision:** documented host-loop recipe (findings option 1, the
  accepted minimum): one `runWorkflow` per iteration, iteration state in
  workflow inputs, explicit termination predicate, explicit budgets
  (iterations/tool calls/tokens), `replayWorkflow` audit; demonstrated by
  the Task 8 example including mid-loop human gate and deterministic
  budget-exhaustion termination; cross-linked to plan 045 as the future
  primitive.
- **Trust boundary:** budget exhaustion is fail-closed and auditable;
  no runtime machinery added to `@arnilo/prism-workflows`.

### DOCS-1 — three behavioral contracts

- Verified as true runtime behavior (Clay review + current source):
  1. Resume-aware nodes — `workflows.md:77` mechanics confirmed; failure
     mode (unconditional re-suspend starves downstream nodes) verified by
     Clay; pattern `ctx.resume ? handle(ctx.resume) : suspend(...)` exists
     at `workflows.md:182-183` without the warning box.
  2. Supervisor factory returns — BUG-2 guard (Task 3) makes the failure
     signature actionable; durable store requirement for nested approval
     resume stands.
  3. `session.compact()` fails closed during an active run
     (`compaction-and-retry.md:24` describes usage, not the contract);
     task-boundary compaction is the intended model.
- **Decision:** three in-place warning boxes on the pages integrators
  already read (not a combined contracts page — findings require "where
  integrators will find them"), each linking the Task 8 example.

## 3. OKF v0.2 field mapping for `@arnilo/prism-wiki`

Wiki document → OKF concept document. The Karpathy compilation body
(anchors, symbol listings, synthesis sections) and the four maintainer
principles are **retained**; only the envelope (frontmatter, links,
index/log conventions) changes.

| Current wiki artifact | OKF v0.2 replacement | Spec |
| --- | --- | --- |
| frontmatter `id: <id>` | dropped — concept id is the file path minus `.md` (`.wiki/entities/<id>.md`) | §2 |
| frontmatter `category: module\|concept\|decision\|entity\|person\|tool` | `type: Module\|Concept\|Decision Record\|Entity\|Person\|Tool` (producer-chosen descriptive values; not centrally registered) | §4.1 |
| frontmatter `title` | `title` (unchanged) | §4.1 |
| — | `description`: one-line summary (new on `WikiEntityMetadata`; feeds `index.md` listings) | §4.1, §8 |
| frontmatter `tags` | `tags` (unchanged) | §4.1 |
| frontmatter `rawSources: [paths]` | `sources: [{ id: <symbol>, resource: file:///path#Lxx-Lyy, title: <path> }]` — `resource` REQUIRED per entry; `id` = symbol name for per-claim footnote attribution | §5.1 |
| frontmatter `lastCompiledAt` | `generated: { by: prism-wiki/<version>, at: <ISO 8601 UTC> }` — actor convention `<producer>/<version>` | §5.2, §7 |
| `.wiki/index.md` curated catalog, `[[entities/<id>.md\|Title]]` links | root `index.md` with **only** `okf_version: "0.2"` frontmatter, sectioned bullet listings (linked title + one-line description); per-directory `index.md` (entities/, decisions/, concepts/) for progressive disclosure; plain relative markdown links (no `[[wikilinks]]`) | §6, §8, §12 |
| `.wiki/log.md` `## [YYYY-MM-DD HH:MM] op \| …` (append, oldest-last) | `## YYYY-MM-DD` date headings, newest first, `* **Update**: …` / `* **Creation**: …` entries | §9 |
| `.wiki/SCHEMA.md` | kept (extra file — bundles may carry extra files); rewritten to state the OKF mapping + Karpathy protocol | §3 |
| `.wiki/.manifest.json` | kept as sidecar compilation ledger (source hashes, entities, delta tracking — not an OKF concern) | §3 |
| body anchors `symbol (file:///path#L10-L45)` | kept; dual-expressed in `sources[].resource` for machine queryability | §4.1, §5.1 |
| `[[wikilink]]` cross-references | plain relative markdown links (linter flags `[[...]]` as non-OKF) | §6 |

**Deferred OKF families (v1 scope decision):** `verified` (§5.2 — no
human-review workflow exists yet; absent `verified` ⇒ *unverified* tier,
which consumers MUST accept per §11), `status`/`stale_after` (§5.4),
`usage_window`/credibility signals beyond `author` (§5.1), attested
computations (§10). Emit `type` + recommended keys + `sources` +
`generated` only.

**Commands:** `wiki-init` / `wiki-refresh` / `wiki-lint` (+ CLI
`init`/`refresh`/`lint`/`search`) already exist — confirmed against
`src/commands/{init,refresh,lint}.ts` and `src/cli.ts`. No new commands;
their output becomes OKF. Migration: `wiki-refresh` upgrades pages it
touches; the wiki is regenerable from raw sources, so no migration tool.

**Parser impact (tentative, resolve in Task 11):** `src/tools.ts` page
reading and `src/search/*` hydration read frontmatter
(`title`/summary) — adjust to `title`/`description`/`type`; manifest
(`src/manifest.ts`) remains the machine ledger so tool behavior changes
are expected to be reading-side only.

## 4. Global rejections (enforced across Tasks 2-12)

- **No Clay-specific branches** in any shared runtime — every fix is at
  the shared choke point all callers route through.
- **No new runtime machinery** for FEATURE-2 and FEATURE-5 (docs +
  example only); the `loop` node stays in plan 045.
- **No generic `services` bag** on `CommandExecutionContext` — three
  named typed driver seams only.
- **No second model seam** (`context.defaultModel`) — `overrides.model`
  already exists.
- **No OKF trust-family emission** (`verified`/`status`) before a
  human-review workflow exists; no `[[wikilink]]` retention — plain
  markdown links per §6.
- **No per-caller guards** — BUG-1 normalized once in
  `toAskUserDecisionSuspendData`, BUG-2 guarded once per factory-result
  consumption site (two sites, one shared guard function).
- **No lockstep version cut** — independent changed-package patch bumps
  via `scripts/release.mjs changed --baseline <parent-of-first-plan-050-commit>`
  (expected `edb4fcf`; recompute at Task 12).

## 5. Performance and limit precedents to reuse

- Supervisor caps: reuse the supervisor's existing limit-resolution
  style; the closest precedent is `resolveMaxFanOut` in
  `packages/workflows/src/run/main.ts` (limit resolution pattern for the
  child-event cap).
- Workflow byte caps: `maxNodeOutputBytes` precedent for any bounded
  output introduced by the example's budgets.
- Wiki rendering: same page count and string-template cost; OKF adds only
  per-directory `index.md` generation (already implied by manifest
  entity counts).