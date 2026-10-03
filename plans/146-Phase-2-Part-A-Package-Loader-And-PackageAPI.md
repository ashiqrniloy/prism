# Phase 2 Part A — Package loader and `PackageAPI`

## Objectives

- Ship `definePackage`, the callable `PackageDefinition` / `PackageInstance`, and the whole `PackageAPI` from roadmap §2.6. A listed package is an active package, with no host wiring.
- Validate package config with the kernel's own JSON Schema validator. Apply defaults, merge config as defaults → manifest layer → `packageConfig`, and accept only refs in secret fields.
- Check `requires` — the kernel semver range and required packages before any `setup` runs, required services after `setup` (services are provided during `setup`, Task 1 A5). Order packages topologically, and enforce declared capabilities on the SDK-mediated APIs.
- Give packages the runtime services they need: a service registry, a commands registry with dispatch, namespaced `package.event`, `status.note`, session state, and background tasks.
- Extend `createAgent` with `packages`, `packageConfig`, and `disable`. Host hooks become an inline package that loads last. Add `agent.inspect()` and `agent.dispose()`.

## Expected Outcome

- `createAgent(config)` returns `Promise<Agent>`. Every in-repo caller awaits it, in every workspace and in `examples/`.
- `createAgent` loads packages in this order:
  1. Resolve inputs.
  2. Merge and validate config.
  3. Order packages topologically.
  4. Check `requires` (kernel range and packages).
  5. Run `setup` in order.
  6. Check required services, then resolve slots.
  7. Apply `disable`.
  8. Build the agent.
- The load fails closed with a `PackageLoadError` and a stable `code` on each of these, and every code has a test:
  - unknown config key
  - schema violation
  - literal secret
  - kernel range mismatch
  - missing package
  - missing service
  - dependency cycle
  - duplicate package
  - missing capability
  - `setup` throw
  - tool or command name collision
  - unknown `disable` id
  - slot conflict, which stays `SlotConflictError`
- If an `optional` instance fails in `setup`, the load skips it, unwinds its partial contributions, and records a status note.
- `agent.dispose()` disposes packages in reverse load order. It is idempotent, and no contribution survives it.
- A package's session state is written as `package_state` entries. It is restored when a session reopens from the store and copied on `fork()` / `clone()`.
- `session.close()` settles background tasks within a bounded timeout, then aborts the rest.
- `agent.inspect()` lists:
  - packages and versions
  - config sources, with secret values masked
  - tools and skills
  - hooks in execution order
  - slot owners
  - status notes
  - declared capabilities
- `docs/next/packages.md` documents the whole contract in the API page structure. `examples/define-package.ts` runs under the execution gate.

This plan is Part A of roadmap **Phase 2 — Package system**. Phase 1 (plans 144 and 145) is complete, and its hook catalog and slot contracts are frozen. Task 1 is the phase review, required because this plan adds kernel contracts: `PackageAPI`, a manifest-facing config merge, new events, a new store entry kind, and new `AgentConfig` fields.

[Part B (plan 147)](147-Phase-2-Part-B-Retire-Extensions-And-Hooks-Json.md) retires the 0.12 extension surface and moves the family packages onto `definePackage`. It also ships `@arnilo/prism/testing` package conformance and the first native package, `@arnilo/prism-hooks-json`. Part A leaves the 0.12 `Extension` surface in place and does not import it. Both systems coexist only until Part B Task 6 deletes the old one.

Making `createAgent` async is pulled forward from Phase 3. `setup` may return a promise, and a `setup` failure must fail `createAgent` closed (§2.6), so a synchronous signature cannot satisfy Phase 2. Phase 3 then reshapes `Agent` / `Session` without a second signature sweep.

This plan does not ship a version bump, a publish, a `/docs` change, the manifest file format or loader (Phase 4, which only feeds this plan's manifest config layer), or the final `Agent` / `Session` shape (Phase 3).

## Tasks

- [x] Task 1: Phase 2 review — package contracts against the code (read-only)
  - Acceptance Criteria:
    - Functional: The Notes inventory every contract this phase touches, citing `roadmap.md` and the current code at `file:line`:
      - `definePackage` and every `PackageAPI` member (§2.6)
      - `AgentConfig.packages` / `packageConfig` / `disable` (§2.3)
      - `agent.inspect()`
      - the events `session.opened`, `session.closed`, `package.status`, and `background.started` / `completed` / `failed` (§2.3 Events)
      - the `package_state` store entry (§2.1 Store)
      - capabilities (§2.6)
      - the hook bus registration-owner seam (`src/hooks/bus.ts:146`)
      - the slot registry (`src/slots/registry.ts:13`)
    - Functional: Classify each Phase 2 Scope bullet, for both Part A and Part B, as *expressible with what exists* or *needs a kernel addition*. For each addition, record its kind, payload, result, error policy, and the primitive or lifecycle step that fires it.
    - Functional: Confirm or refute each of these assumptions:
      - (a) `createAgent` is synchronous (`src/agent-session/create-agent.ts:10`). Making it return `Promise<Agent>` is the smallest change that lets an async `setup` fail it closed. Count the call sites per workspace (the survey found about 570 `createAgent(` occurrences across about 200 files) and confirm that a mechanical `await` codemod covers them, listing every call site in a synchronous context.
      - (b) The hook bus fixes `owner` at `createHookBus` (`src/hooks/bus.ts:146`, `src/agent-session/create-agent.ts:19`). A per-registrar owner (`bus.registrar(owner)`) is the narrowest seam that gives package registrations the id `<package>:<hook>[#id]`, with no second bus. Record whether the kernel skills catalog should become a named `kernel:context.build` registration in this phase (backlog "Decide the kernel skills catalog's owner") or stay out of scope because `disable.skills` covers hiding skills.
      - (c) The kernel has no JSON Schema validator (tool argument validation is pluggable through `ToolArgumentValidator` at `src/tools.ts:52`) and no semver matcher. Name the JSON Schema keyword subset that package config needs, by checking the config shapes of the Part B conversions (hooks-json, LLM compaction, observational memory, wiki, impeccable, the provider factories). Name the range forms that `requires.prism` needs (`^`, `~`, exact, `>=`, `<`, and `||`?).
      - (d) The session entry kinds (`src/contracts-core/session.ts:7`) have no `package_state` kind. Decide between a new kind and `custom` with a typed `data`. Base the decision on whether the family stores (prism-core SQLite and Postgres, memory JSONL) and `src/testing/persistence-schema.ts` reject unknown kinds. Name every store that must accept the new kind in Task 7.
      - (e) `session.close()` (`src/agent-session/session.ts:611`) closes only subscribers, with no background tracking. `fork()` (`:712`) and `clone()` (`:723`) copy the branch. Reopening a session by id rebuilds history from the store. Name the restore point that Task 7 hooks for package state.
      - (f) `CommandDefinition` (`src/contracts-core/agent.ts`) differs from §2.6's `{ name, description, args?, run(args, ctx) }`. List its current fields and callers (`src/rpc.ts`, `packages/memory`, `packages/prism-coding-tools/impeccable`, `packages/prism-core/runtime/workflows`, `packages/agent-sdk`, `packages/prism-code/tui`). Decide whether Task 6 reshapes it in place (callers migrate in Part B Task 3) or introduces it under the same name with a field-compatible shape.
      - (g) `models.client` and `credentials.resolve` (§2.6) depend on the Phase 5 model layer. Confirm that a thin `ModelClient` over today's per-agent provider resolution (`AgentConfig.provider` / `providerSource`) and a resolver over the `credentials` slot (`src/slots/defaults.ts`) can ship now behind the final member names, so that Phase 5 replaces the implementation and not the API.
      - (h) The tool registry's duplicate default is `"replace"` (plan 142 Task 1 finding). Confirm that `PackageAPI.tools.register` and `commands.register` must fail closed on collision, while the existing `ToolRegistry` keeps its option for its own direct callers.
      - (i) `skills.addDir` can reuse `loadSkillDirectory` (`src/node/contribution-discovery.ts:167`) without importing `node:` modules into the kernel root barrel. Record which entry point owns the fs read.
      - (j) Adding the `session.*`, `package.status`, and `background.*` events changes the frozen catalog (`src/__tests__/hook-catalog-freeze.test.ts`). Record that Task 7 edits the freeze test and `docs/next/hooks.md` together.
    - Functional: Record a verdict in the Notes. If a finding invalidates a later task, stop and re-cut the plan. Never improvise a seam inside a later task.
    - Performance: n/a — read-only.
    - Code Quality: Every finding cites `file:line`. Every classification cites the roadmap section.
    - Security: List every place a package-supplied value crosses into the host or a store: config, inspect output, events, `package_state` entries, and errors. For each, name the redaction or ref-only check that Tasks 4–8 must test.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, §2.1–§2.7, §2.11, and Phase 2
      - `PRODUCT.md`
      - plan 144 Task 1 Notes, plan 145 Task 6 Notes, and the `plans/backlog.md` items that name Phase 2
    - Options Considered:
      - Skip the review because Phase 1 froze the catalog. Rejected: the survey already found three blocking facts (sync `createAgent`, a fixed bus owner, and no kernel validator) that reshape later tasks.
    - Chosen Approach:
      - Run graft (`graft ask`, `graft callers --depth all`) per contract, then write the classification table and verdict into this task's Notes.
    - API Notes and Examples:
      ```bash
      graft callers createAgent --depth all
      graft callers createHookBus --depth all
      graft grep "kind: \"custom\""
      ```
    - Files to Create/Edit:
      - `plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md`: Notes only.
    - References:
      - `src/agent-session/create-agent.ts`, `src/hooks/bus.ts`, `src/slots/registry.ts`, `src/contracts-core/session.ts`, `src/agent-session/session.ts`
  - Test Cases to Write:
    - n/a — read-only. The review defines the tests that later tasks write.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — the review only records findings.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Verdict: the plan stands. Eight amendments (A1–A8) are applied to the objectives and to Tasks 2–9 below, and none needs a re-cut.** No finding invalidates a task. Four findings add scope that the plan did not list: the `SessionContext` seam (A1), the runtime-merged tool/skill view (A2), the redactor lifetime (A3), and the package-state hydration point (A4). The read-only rule held: nothing under `src/`, `packages/`, `examples/`, or `scripts/` changed, and the scratch AST scan lives in the session scratchpad.
    - **Contract inventory** (roadmap section → current code → state):

      | Contract | Roadmap | Current code | State |
      | --- | --- | --- | --- |
      | `definePackage`, `PackageDefinition`/`PackageInstance` | §2.6 | none (`src/packages/` absent) | addition |
      | `PackageAPI.name`, `config` | §2.6 | none | addition (Task 4 merge, Task 5 delivery) |
      | `PackageAPI.hooks` | §2.6, §2.4 | `HookRegistrar` `src/hooks/types.ts:221`; bus owner fixed at `src/hooks/bus.ts:90`; id built `:146`; `create-agent.ts:19` | addition (Task 3 registrar) |
      | `PackageAPI.slots` | §2.6, §2.5 | `SlotRegistry.provide(name, owner, impl)` `src/slots/registry.ts:17`; `providers()` `:27`; `resolve()` `:31`; **no remove, and `resolve` does not report the winning owner** | addition (`remove(owner)`, owner query) |
      | `PackageAPI.tools` | §2.6 | `ToolRegistry` `src/contracts-protocol.ts:518` (`unregister?` is optional); `createToolRegistry` `src/tools.ts:151`; duplicate default `"replace"` `src/registry-options.ts:12` | addition (runtime registry, fail-closed) |
      | `PackageAPI.skills` | §2.6 | `SkillRegistry` `src/contracts-core/agent.ts:282` and `createSkillRegistry` `src/skills.ts:12-35`: **no `unregister`** | addition |
      | `PackageAPI.providers` | §2.6 | provider resolved at `src/agent-session/session.ts:760` (`config.provider ?? run.providerSource ?? config.providerSource`) | addition (runtime provider list consulted at `:760`) |
      | `PackageAPI.commands` | §2.6 | `CommandDefinition` `src/contracts-core/agent.ts:208` (`execute(args, ctx)`), dispatch `src/rpc.ts:233` | reshape (finding f) |
      | `PackageAPI.models.client` | §2.6 | no `ModelClient` or `ModelRef` type exists | addition (finding g) |
      | `PackageAPI.credentials.resolve` | §2.6 | `CredentialResolver` `src/contracts-core/resources.ts:42`; `credentials` slot default `src/slots/defaults.ts:9,24`; **no kernel code consults the slot today**; no `Secret` type | addition (finding g) |
      | `PackageAPI.state` | §2.6, §2.1 | none | addition (Task 7) |
      | `PackageAPI.services` | §2.6 | none | addition |
      | `PackageAPI.host` | §2.6, §2.3 | `HostPort` `src/host/types.ts:86` (`ui?` only; **no `log`**); `HostUiRequestBase.package` exists and is "kernel-set" `:4-7` | expressible, plus the capability wrapper and a `package` stamp |
      | `PackageAPI.events.emit` | §2.3, §2.6 | `package.event` is in `AgentEventPayload` (`src/contracts-protocol.ts:443-452`) and the catalog (`src/hooks/catalog.ts:47`); `RunController.emit` `src/loop/types.ts:48` | expressible (loader stamps `package`); needs an agent-scoped emit for non-run callers (A3) |
      | `PackageAPI.status.note`, `package.status` | §2.3, §2.6 | none | addition (new event) |
      | `PackageAPI.log`, `Logger` | §2.6, §2.3 | no `Logger` type; `HostPort` has no `log` | addition (A6) |
      | `PackageAPI.onDispose`, `Agent.dispose` | §2.3, §2.6 | `Agent` is `{ config, createSession }` `src/contracts-core/agent.ts:153` | addition |
      | `AgentConfig.packages/packageConfig/disable` | §2.3 | absent (`AgentConfig` `src/contracts-core/agent.ts:53`) | addition |
      | `AgentConfig.hooks` (host = inline package last) | §2.3, §2.4 | `hooks` `:121`; called once at `src/agent-session/create-agent.ts:26` | expressible: owner `host` and load-last already hold; Task 3 only moves the owner source |
      | `AgentConfig.slots` | §2.3 | `SlotAssignments` `src/slots/types.ts:24` (direct implementation wins) | exists |
      | `agent.inspect()`, `agent.commands` | §2.3 | absent; `HookBus.registrations()` exists `src/hooks/bus.ts:249` | addition |
      | Events `session.opened/closed`, `package.status`, `background.started/completed/failed` | §2.3 | none; `session_started`/`session_closed` exist only on **`RealtimeEvent`** (`src/contracts-protocol.ts:54,60`), not on any agent or session event | addition (see "Plan 144 correction") |
      | `package_state` store entry | §2.1 | `SessionEntryKind` `src/contracts-core/session.ts:7-16`, array `:18-28`, guard `:34` | addition (finding d) |
      | Capabilities | §2.6 | none | addition |
      | Hook bus owner seam | §2.4 | `src/hooks/bus.ts:90,146` | addition (finding b) |
      | Slot registry | §2.5 | `src/slots/registry.ts:13` | addition (`remove`, owner query) |

    - **Plan 144 correction.** Plan 144 Task 1(h) says `session.opened`/`session.closed` map to `session_started`/`session_closed` "on `AgentSessionEvent`". That is wrong: those two names exist only on `RealtimeEvent` (a voice-host stream, `src/contracts-protocol.ts:53-61`) and are unrelated to the session lifecycle. Task 7 adds `session.opened`/`session.closed` as new `AgentEventPayload` members, with no collision. **Naming rule for every new event:** use the final roadmap §2.3 dotted names (`session.opened`, `session.closed`, `package.status`, `background.started`, `background.completed`, `background.failed`). Plan 144 froze the 0.12 snake_case names for the existing 35 observe hooks and left their rename to Phase 3. Dotted names for the new events never need a second rename, and `hook.error` / `package.event` already set that precedent (`src/hooks/catalog.ts:46-47`).
    - **Classification of every Phase 2 Scope bullet** (roadmap Phase 2, `roadmap.md:808-832`):

      | Scope bullet | Part | Class | Where it lands |
      | --- | --- | --- | --- |
      | `definePackage`, callable definition/instance, `PackageAPI` | A | needs addition (new `src/packages/`) | Task 5 |
      | JSON Schema validation with defaults | A | needs addition (kernel has only `canonicalizeJsonSchema`, `src/providers/schema.ts:9`, and the pluggable `ToolArgumentValidator`, `src/tools.ts:52`; zero runtime deps in `package.json`) | Task 4 |
      | Config merge order | A | needs addition | Task 4 |
      | Secret-field refs only | A | needs addition (only the `env:` parse in `src/slots/defaults.ts:9` exists) | Task 4 |
      | `requires` kernel semver | A | needs addition (no semver matcher in `src/`; no kernel version constant; see (c)) | Task 5 |
      | `requires` packages/services, topological order | A | needs addition | Task 5 |
      | Capability declaration and enforcement | A | needs addition | Task 5 |
      | Service registry | A | needs addition | Task 6 |
      | Commands registry and dispatch | A | needs addition (`CommandDefinition` exists; the 0.12 registry is `ContributionRegistries.commands`, which Part B deletes) | Task 6 |
      | Namespaced `package.event` | A | expressible (type and hook exist) plus the loader stamp | Task 5 |
      | `status.note` | A | needs addition (`package.status`) | Tasks 5 and 7 |
      | Session state, `package_state` | A | needs addition | Task 7 |
      | Background tasks and bounded settle | A | needs addition (`close()` only closes subscribers, `src/agent-session/session.ts:611`) | Task 7 |
      | Reverse-order dispose, `setup` fail closed, `optional` skip | A | needs addition (the unwind pattern at `src/extensions.ts:198-210` is reusable as a pattern only) | Task 5 |
      | `createAgent({ packages, packageConfig, hooks, slots, disable })` | A | needs addition (`hooks`, `slots` exist) | Tasks 2, 5, 6 |
      | Host hooks as an inline package loaded last | A | expressible once the owner comes from a registrar | Tasks 3 and 5 |
      | `disable` | A | needs addition (hook `remove`, skill `unregister`, command registry) | Tasks 3 and 6 |
      | `agent.inspect()` | A | needs addition (`registrations()` exists; slot winner owner does not) | Task 8 |
      | Remove `Extension`, `ExtensionAPI`, `ExtensionKernel`, `activateKernel`, `forwardAgentEvents`, `ContributionRegistries`, `PrismManifest`, `ProviderPackage`, descriptors | B | expressible: deletion plus caller moves (Part B Task 1 re-walks the callers) | Part B Task 6 |
      | Package conformance suite in `@arnilo/prism/testing` | B | needs addition: `package.json` `exports` has only `./testing/<name>` subpaths and no `./testing` root | Part B Task 2 |
      | First native package `@arnilo/prism-hooks-json` | B | expressible with `PackageAPI` plus `session.opened` (replaces the first-`context.build` piggyback recorded in plan 145 and in backlog `plans/backlog.md:306-311`) | Part B Task 5 |
      | Family extensions and provider factories onto `definePackage` | B | expressible, with code-only options bound by a factory closure (see (c)) | Part B Tasks 3-4 |

    - **Kernel additions: kind, payload, result, error policy, firing step.**

      | Addition | Kind | Payload | Result | Error policy | Fired by |
      | --- | --- | --- | --- | --- | --- |
      | `session.opened` | observe event | `{ sessionId, restored: boolean }` | none | a throw becomes `hook.error`; the run continues | the session, once its package state has hydrated (A4). Not at construction, which is synchronous. |
      | `session.closed` | observe event | `{ sessionId, reason?: string }` | none | same | end of `close()`, after background settle |
      | `package.status` | observe event | `{ package, level: "info" \| "warn", message, at, sessionId? }` | none | same | `status.note`; agent-scoped, so `sessionId` is absent during setup (A3) |
      | `background.started` | observe event | `{ sessionId, package?, name, taskId }` | none | same | `SessionContext.background` |
      | `background.completed` | observe event | `{ sessionId, name, taskId, durationMs }` | none | same | tracker on resolve |
      | `background.failed` | observe event | `{ sessionId, name, taskId, reason: "error" \| "aborted", error?: ErrorInfo }` (redacted) | none | same | tracker on reject, or `close()` abort |
      | `package_state` entry | `SessionEntry` kind | `data: { package, key, value }` (JSON only, `schemaVersion: 1`) | none | non-JSON gives `state_not_json`; oversize gives `state_too_large` (A5) | `SessionState.set` |
      | `PackageLoadError` | error | `{ code, package?, path?, message }` | none | fail closed | loader, registrars, state |
      | Bound hook view / `SessionContext` | seam, not an event | see A1 | none | n/a | session dispatch |

    - **Assumption checks:**
      - **(a) Confirmed, with corrected counts.** `createAgent` is synchronous (`src/agent-session/create-agent.ts:10`) and an async `setup` cannot fail a sync call closed, so `Promise<Agent>` is the smallest change. An AST scan (scratch TypeScript 5 parser, since the repo's TypeScript 7 has no JS API) found **567 call sites in 196 git-tracked files**. This matches the survey's ~570/~200. The 117 untracked `examples/*.js` are gitignored build output (`.gitignore:4`) and are excluded. Per workspace (calls / files / sync-scope): `src` 293/67/64, `packages/prism-core` 74/20/37, `examples` 64/55/5 (+18 top-level), `scripts` 36/14/8 (+10 top-level), `packages/memory` 22/14/2, `packages/ag-ui` 20/7/4, `packages/prism-coding-tools` 18/7/3, `packages/prism-code` 16/3/1, `packages/prism-channels` 11/5/5, `packages/hooks` 8/1/1, `packages/acp-agent` 3/1/2, `packages/agent-sdk` 1/1/0, `packages/mcp` 1/1/0. `packages/prism-work`, `web-tools`, and `prism-providers` have none, so Task 2's workspace list shrinks. Of the 567, 13 are property-access calls that are not the kernel `createAgent` (below), so **554 are kernel calls: 394 in async scope, 28 at module top level (legal under `module: NodeNext` / ES2022, `tsconfig.packages.json:3-4`), and 132 in synchronous scope**.
        - **The mechanical `await` codemod covers 422 kernel sites (394 + 28). 132 sites need a hand edit** because they sit in a synchronous function: 50 are anonymous callbacks (`it(...)`, `.map(...)`, resolver closures) that become `async`, and 82 are inside 65 named helpers. The named helpers have about 300 in-file callers, all in tests, `examples/`, and `scripts/`. Those helpers become `async` and their callers `await`.
        - **Production wrappers that change their public signature**, each needing a baseline regeneration: `createSecureAgent` `src/secure-agent.ts:31,75` (kernel), `createSpawnableAgent` `packages/acp-agent/src/index.ts:234` (exported; sole sync caller is `packages/acp-agent/bin/prism-acp-agent.ts:22`, inside a `try`, so it needs top-level `await`), and `wrapAgentWithFailureInjection` `packages/prism-core/src/governance/evals/scenarios.ts:283` (public; callers: `packages/prism-coding-tools/src/dev/__tests__/eval-compare.test.ts:298,395,431`, `examples/behavior-evaluation.ts:165-182`, `scripts/fixtures/e2e-070-host-completeness-journey.mjs:334,360`).
        - **Production wrappers that stay `Promise | Agent` or already await:** `resolveAgentDefinition` `src/agent-definitions.ts:26`, `applyAgentOverrides` `:144`, `defaultCreateSession` `src/cli-runner.ts:473` (already `async`; its `agentSession`/`mockSession` helpers at `:505-510` become `async` with two in-file callers), `createPrismCodeAcpAgent` `packages/prism-code/src/acp.ts:256`, and `sessionFactory` closures.
        - **Sync closures that Task 2 must make `async`:** `resolveAgent` at `packages/acp-agent/src/index.ts:314-319` and `packages/prism-code/src/acp.ts:298-303`. Their consumer type already allows `Promise` (`src/agent-run-lifecycle.ts:36-40`, awaited at `:110,128`).
        - **The plan's tentative file list was wrong in places.** `src/rpc.ts` and `src/delegated-agent-step.ts` contain **no** `createAgent` call, and `src/node/agent-definitions.ts` only calls `resolveAgentDefinition`. The real kernel production sites are `src/agent-definitions.ts`, `src/cli-runner.ts`, `src/secure-agent.ts`, and `src/testing/prefix-stability-conformance.ts:173` (already async). See amendment A7.
        - **Callers that are not the kernel `createAgent`:** 13 property-access calls named `createAgent`, most in `packages/prism-core/src/runtime/supervisor/supervisor.ts:547,875` (the `DelegationChild.createAgent` factory option, already `Agent | Promise<Agent>` at `types.ts:100`, already awaited), plus `packages/prism-coding-tools/src/agent/__tests__/spawn-worktree.test.ts` (7) and `examples/host-composition-compat.ts`. They are unaffected.
        - **Markdown:** 103 occurrences in 54 released `docs/*.md` files stay (released 0.12.1 contract). Only `docs/next/loop.md:114`, `docs/next/hooks.md:79`, and `docs/next/tools.md:84` change (A7). `docs/next/slots.md:73` has a prose mention only, and it has **no** `createAgent(` example, so the plan's `slots.md` entry is replaced by `tools.md`. No test type-checks docs snippets, so a missed page fails nothing automatically, and the Task 2 sweep must be an explicit `rg`.
      - **(b) Confirmed.** The bus fixes `owner` at `src/hooks/bus.ts:90`, builds the id at `:146`, formats the duplicate-id error at `:151`, and reads `owner` for the deny text at `:208` and for `HookError.owner` at `:192,210,243`. `Registration.owner` (`:32`) is already per-registration, so a per-registrar owner changes only where the value comes from. `HookBus.registrations()` already exists (`:249-258`, `src/hooks/types.ts:235`) and already lists registrations in execution order per hook; `has()` exists (`:260`). **Task 3's real delta is `registrar(owner)`, `remove(id)`, dropping `HookBusOptions.owner` (`types.ts:240-247`), and nothing else for `registrations`.** `createHookBus` callers to migrate: `src/agent-session/create-agent.ts:19`, `src/agent-session/session.ts:411` (fallback bus for hand-rolled agents), `src/__tests__/run-controller.test.ts:16`, `src/__tests__/hook-bus.test.ts:8`, and `src/__tests__/helpers/hook-harness.ts`.
        - **Two consequences the plan missed.** (1) Every `AgentSession` registers two hooks on the shared per-agent bus (`src/agent-session/session.ts:299-316`, ids carrying `#session-<n>`) and never removes them, so they accumulate per session and would appear in `inspect()`. Task 3 gives them a `kernel` registrar and Task 7 removes them on `close()` (A8). `agentHookIds` (`src/agent-session/runtime-registry.ts:55-63`) already filters the `#session-` marker for the durable fingerprint. (2) `agentHookIds` feeds the `suspended_run` fingerprint. When ids change from `host:<hook>` to `<package>:<hook>`, a suspended run resumes only against the same package set. That is the intended fail-closed behaviour and needs one test in Task 3.
        - **Kernel skills catalog: stays out of Part A.** `disable.skills` removes a skill by name, which covers hiding skills. Making the catalog a named `kernel:context.build` registration would move where it lands relative to host `context.build` handlers. That shifts prompt bytes the prefix-stability conformance pins (`src/testing/prefix-stability-conformance.ts`), and the catalog also depends on run-state `loaded`/demotion sets (`src/skill-disclosure.ts:78-105`). The owner seam is built, so the move is cheap later. Record it in the backlog item "Decide the kernel skills catalog's owner" (`plans/backlog.md:320-325`) as: seam delivered in plan 146 Task 3, move deferred to Phase 3, where `skills.disclosure` reshapes the config.
      - **(c) Confirmed: no kernel JSON Schema validator and no semver matcher.** The only schema code is `canonicalizeJsonSchema` (`src/providers/schema.ts:9`, "does not enforce schema bounds") and the pluggable `ToolArgumentValidator` (`src/tools.ts:52`); `package.json` has no `dependencies`; nothing in `src/` parses a semver range.
        - **Keyword subset, derived from the Part B conversions.** hooks-json: `HooksConfig` is an object of arrays of definitions, with a discriminated handler union (`type: "command"` vs `"mcp_tool"`), `timeout` / `additionalContextLimit` numbers, `args` string arrays, a free-form `input` object, and an unknown-event fail-closed rule (`packages/hooks/src/schema.ts:20-70,186-212`). LLM compaction: integer budgets (`reserveTokens`, `maxOutputTokens`, `maxSummaryTokens`, `maxErrorBytes`), booleans, strings, and a `model` that is an object (`packages/memory/src/compaction/llm/strategy.ts:37-60`). Wiki: strings, a `rawRoots` string array, a `profile` enum, booleans (`packages/memory/src/wiki/types.ts:99-120`). Impeccable: two strings (`upstreamPath`, `expectedSnapshotDigest`, `packages/prism-coding-tools/src/impeccable/extension.ts:9-12`). Provider factories: `baseUrl`, `id`, `userAgent` strings, a `models` array of `ModelConfig` objects, and a secret `apiKey` (`packages/prism-providers/src/anthropic/index.ts:4-12`).
          - **Supported (Task 4):** `type` as a single value (`string`, `number`, `integer`, `boolean`, `object`, `array`, `null`), `properties`, `required`, `additionalProperties` as a boolean **or a schema** (default `false`), `items` as a single schema, `minItems`/`maxItems`, `enum`, `const`, `default`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern`, `oneOf`/`anyOf`, the annotations `description`/`title`, and `x-prism-secret`. The plan's list lacked `integer`, `minItems`/`maxItems`, schema-valued `additionalProperties`, and `title` (A5).
          - **Rejected as `config_schema_unsupported`:** `$ref`/`$defs`, `patternProperties`, `allOf`, `not`, `if`/`then`/`else`, `format`, `uniqueItems`, `multipleOf`, `exclusiveMinimum`/`exclusiveMaximum`, `minProperties`/`maxProperties`, `dependencies*`, array-valued `type`, tuple-form `items`, and any other `x-*` key.
          - **`pattern` safety:** bound the pattern length (256) and the tested string length so a package schema cannot become a ReDoS vector.
        - **Function-valued options are not config.** Wiki `extractDocument`/`fetchUrl` (`wiki/types.ts:114,119`), LLM compactor `provider`/`summaryProvider`/`requestTransforms`/`credential` (`strategy.ts:39-51`), and provider `apiKey` functions and `fetch` (`anthropic/index.ts:5-6`) cannot be JSON. Part B Task 3 already binds them through a factory closure (`wiki({ fetch })`), which needs no kernel addition. Part A therefore makes `PackageInstance` config JSON-only. A function value fails `config_invalid` instead of being passed through, and a test pins it (A5).
        - **Range forms for `requires.prism` and `requires.packages`:** `^`, `~`, exact, `>=`, `>`, `<=`, `<`, space-joined comparators (AND), `||` (OR), and `*`. Evidence: `^0.13.0-0` (Task 5 example, roadmap §2.6) and `^1.0.0` (manifest examples, roadmap §2.7). `||` is cheap and is what a package spanning two kernel lines writes. **Prerelease rule:** follow node-semver (a prerelease satisfies a range only if a comparator in the same set names the same `major.minor.patch` with a prerelease), so `^0.13.0-0` admits `0.13.0-rc.1`. **Rejected with `definition_invalid`:** hyphen ranges, `x`-ranges, bare partials (`1.2`), and dist-tags.
        - **Blocking detail for Task 5 and Task 9.** The kernel is `0.12.1` (`package.json:3`) and no `src/version.ts` exists. `requires: { prism: "^0.13.0-0" }` therefore fails `kernel_range` against the real kernel. So (1) `examples/define-package.ts` and every in-tree native package written before the 0.13.0 cut must declare a range that admits 0.12.1, for example `^0.12.1 || ^0.13.0-0`; (2) loader tests inject the kernel version; and (3) Task 5 adds `src/version.ts` as a plain constant, with a test pinning it to `package.json` and a line in the lockstep bump in `scripts/release.mjs` (version rewrite near `:122`) so it cannot drift. Reading `package.json` at runtime is rejected: `resolveJsonModule` is unset and the kernel root imports only `node:crypto`/`node:readline`. See A5.
      - **(d) New kind `package_state`; not `custom`.**
        - `SessionStore` implementations in the repo: the memory store `src/session-stores.ts:235`, the JSONL store `src/node/session-store-jsonl.ts` (kernel `./node/session-store-jsonl` export, **not** `packages/memory`), and prism-core SQLite and Postgres (`packages/prism-core/src/sessions/{sqlite,postgres}/persistence.ts`). `packages/memory` has no session store, so the plan's "memory JSONL store" is the kernel's JSONL store.
        - **None of the stores reject an unknown kind in SQL.** The `kind` column is plain `text` (`src/testing/persistence-schema.ts:210`) with no `CHECK`, and the row codec casts it (`packages/prism-core/src/sessions/codecs/index.ts:163,182`). Only the JSONL reader gates on `isSessionEntryKind` (`src/node/session-store-jsonl.ts:206`), and its per-kind `switch` has no `suspended_run` case, so a new kind passes after one array edit. `rebuildSessionContext` ignores kinds it does not read (`src/session-stores.ts:152-173`), so a `package_state` entry never reaches the model view.
        - **Why not `custom`:** observational memory already writes `custom` entries (`packages/memory/src/compaction/observational-memory/append-custom.ts:15`), and `custom` search would mix package state into that. The JSONL reader requires an object `data` for `custom`, which is no benefit over a dedicated kind. The roadmap names "package-state entries" (§2.1, §2.6). Plan 144 Task 5 set the `suspended_run` precedent.
        - **Edits Task 7 makes:** `SessionEntryKind` and `SESSION_ENTRY_KINDS` (`src/contracts-core/session.ts:7-28`); the pin at `src/__tests__/node-session-store-jsonl.test.ts:317`; `src/__tests__/public-export-contract.test.ts` only if the exported array is pinned (it lists `SESSION_ENTRY_KINDS` at `:142`, by name); and one new `package_state` round-trip step in `src/testing/session-store-conformance.ts` after step 7 (`:112-129`). That single conformance step covers memory, JSONL, SQLite, and Postgres, so no per-store change is needed.
        - **Entry counts:** every `set` is one entry, and compaction thresholds count entries (`session.ts` compaction index math uses `entries.length`), so heavy state writes pull compaction earlier. Task 7's docs cost note says so, and one test pins that `package_state` does not enter the message view.
      - **(e) Confirmed, and the restore point is not where the plan assumed.**
        - `close()` (`src/agent-session/session.ts:611-615`) only sets `closed` and calls `closeSubscribers()`. `fork()` (`:712`) is **synchronous**, builds a new `AgentSession` with the **same session id** and a different `leafId`, and shares the store. `clone()` (`:723-742`) copies every branch entry verbatim with new ids, so `package_state` entries ride along with no clone change.
        - **There is no reopen step.** `createSession({ id })` constructs the session (`:407-429`) and reads nothing from the store. History is loaded lazily at run start (`src/agent-session/session/assemble.ts:266`), in `checkout()` (`:706-710`), and after compaction (`:990`). The plan's `readBranchPath` is the store method (`src/contracts-core/session.ts:64`); the session reads it through `branchReader()` (`:747`) and `entries()` (`:699-704`).
        - **Restore point for Task 7 (A4).** `SessionState.get(session)` is synchronous in the roadmap sketch, but hydration needs an async branch read and `createSession` is synchronous. Task 7 therefore adds a memoised `session.ready` promise that reads the branch once, plus these rules: hydration is awaited at run start (next to `assemble.ts:266`), at `checkout`, at resume, and in `agent.commands.run`; `session.opened` fires after hydration; and a synchronous `get` before hydration **throws** `state_not_ready` instead of returning `initial`, so a package can never act on a silent wrong value. A `fork()` hydrates from its own `leafId`, so each branch sees its own value, which is exactly the `session_state_survives_fork_and_resume` test.
      - **(f) `CommandDefinition` needs a reshape; callers migrate in Part B.**
        - **Current shape** (`src/contracts-core/agent.ts:208-214`): `{ name, description?, parameters?: JsonObject, execute(args: JsonObject, context: CommandExecutionContext): Promise<CommandResult> | CommandResult, metadata? }`. `CommandExecutionContext` (`:216-`) is `{ sessionId?, runId?, signal?, metadata?, drivers? }`, and the result is `CommandResult` (`{ name, content?, value?, error?, metadata? }`).
        - **§2.6 shape:** `{ name, description, args?: JsonSchema, run(args, ctx: { session, host, agent }) }`. They differ in the field names (`execute`/`run`, `parameters`/`args`), the context (id vs live `SessionContext`, `host`, `agent`), and the required `description`.
        - **Callers:** `src/rpc.ts:6,38,54,233` (dispatch), `src/extensions.ts:154,320` and `src/contributions.ts:64` and `src/contracts-core/extensions.ts:152` (0.12, deleted in Part B), `packages/agent-sdk/src/define-agent.ts:112,146,301`, `packages/mcp/src/types.ts:151`, `packages/prism-code/src/wiki.ts:22`, `packages/prism-code/src/skills.ts:233`, `packages/prism-code/src/tui/commands.ts:389-399`, `packages/memory/src/wiki/commands/{init,ingest,lint,refresh}.ts`, `packages/memory/src/compaction/observational-memory/commands.ts:26,66,118`, `packages/memory/src/scoped/eval/runner.ts:140`, `packages/prism-coding-tools/src/impeccable/commands.ts:5`, and `packages/prism-core/src/runtime/workflows/commands.ts:115`. That is about 20 production files plus tests.
        - **Decision: introduce the §2.6 shape under a new name path, not in place.** Task 6 adds `PackageCommand` (`{ name, description, args?, run(args, ctx) }`) for `PackageAPI.commands.register` and `agent.commands`, and leaves `CommandDefinition` as it is until Part B Task 3 moves its users onto packages. Reshaping `CommandDefinition` in place would break about 20 files in Part A for no Part A benefit, and the 0.12 `rpc.ts` dispatch keeps working until Part B deletes it. Whether `CommandDefinition` is then deleted, or `PackageCommand` is renamed onto it in one baseline diff, is Part B's call once `src/rpc.ts` has a decision. This replaces Task 6's "reshape in place or same-name" choice (A7).
      - **(g) Confirmed, with two type-name gaps.** Neither `ModelClient`, `ModelRef`, nor `Secret` exists in `src/`. `AgentConfig.model` is `ModelConfig` (`{ provider, model, … }`), and the only string form is parsed inside `agent-definitions.ts` (`resolveModel`). A thin client ships behind the final member names:
        - `models.client(ref?: ModelConfig)` resolves a provider through the runtime provider list, then `config.provider`, then `config.providerSource` (the precedence at `session.ts:760`, with a direct `config.provider` still winning) and defaults `ref` to `config.model`. It exposes `generate(request)` returning `AsyncIterable<ProviderEvent>`, matching `AIProvider.generate` (`src/contracts-core/provider.ts:76`). That is exactly the side call the LLM compactor makes today (`packages/memory/src/compaction/llm/strategy.ts`).
        - `credentials.resolve(ref)` resolves through `slots.resolve("credentials", assigned)` (`src/slots/registry.ts:31`; default `createEnvRefCredentialResolver` `src/slots/defaults.ts:9`) and returns the existing `Credential` (`src/contracts-core/resources.ts:36`). **Deviation from §2.6:** the roadmap says `Secret`; Part A returns `Credential` and leaves the rename to Phase 5, so the model-layer plan owns the one baseline change. Today no kernel code consults the `credentials` slot, so the member is also the first consumer.
        - Phase 5 then replaces the resolver and client internals, not the member names.
      - **(h) Confirmed.** The registry default is `"replace"` (`src/registry-options.ts:12`, enforced `:14`); `createToolRegistry` takes `{ duplicate }` (`src/tools.ts:151,156`) and `createSecureAgent` already uses `"error"`. `ToolRegistry.unregister` is **optional** (`src/contracts-protocol.ts:524`) because hosts supply their own registries, so `disable.tools` must never mutate a host registry. Task 6 builds an agent-owned merged registry (A2). **Correction:** the kernel does **not** register `load_skill`. `createLoadSkillTool` (`src/skill-load.ts:183`) is a factory the host calls; no kernel code adds it (`rg` finds only the factory and a conformance harness). So "collision with a kernel tool (`load_skill`)" has nothing to collide with in Part A. Task 6 instead reserves the kernel-generated names (`load_skill`, and `search_tools` from `assemble.ts`) so a package cannot shadow them, and tests package-vs-package, package-vs-host, and package-vs-reserved.
      - **(i) Confirmed.** `loadSkillDirectory` is `async` and lives at `src/node/contribution-discovery.ts:167`, in the `./node/contribution-discovery` export. The kernel root barrel imports no `node:fs`, and the root already has `node:crypto` only. `skills.addDir(path)` is declared `void` in §2.6 and the read is async, so `addDir` **records the path** and the loader reads all recorded directories after `setup` returns. **Entry point that owns the fs read: `src/node/contribution-discovery.ts` (`loadSkillDirectory`), reached through an injected `readSkillDir` option on the loader.** `createAgent` passes the node implementation through a dynamic `import("../node/contribution-discovery.js")` made only when a package called `addDir`. The root's static import graph stays fs-free and `kernel-imports-no-package` is unaffected. A read failure is `setup_failed` for that package, and the loader unwinds as for any setup throw.
      - **(j) Confirmed.** `OBSERVE_HOOKS` is `Record<AgentEventPayload["type"], true>` (`src/hooks/catalog.ts:8`), so each new event fails to compile until listed. The runtime list derives from it. `src/__tests__/hook-catalog-freeze.test.ts:34-69` pins `FROZEN_PHASE_1_OBSERVE_CATALOG` as an ordered array (insertion order is part of the pin, `:97`), so the six new names go at the end in one deliberate edit. `docs/next/hooks.md` is edited in the same task (the freeze message names it). Other event consumers use `switch`/`if` chains with fall-through, not exhaustive checks: `packages/ag-ui/src/ag-ui-mapper.ts:318`, `packages/prism-core/src/runtime/supervisor/supervisor.ts:133,145`. Phase 1 added `hook.error` and `package.event` the same way without breaking them.
    - **Amendments applied to later tasks:**
      - **A1 — `SessionContext` seam (Task 5, used by 6 and 7).** §2.6 says hook payloads, tool contexts, and `when` predicates see a `SessionContext` with `background`. None exists: hook payloads carry only `sessionId`/`runId` (`src/hooks/types.ts:62-135`), `HookContext` is `{ sessionId, runId, signal?, emit, reject }` (`:25-33`), and `ToolExecutionContext` is `{ sessionId, runId, toolCallId, … }` (`src/contracts-protocol.ts:527-538`). A package cannot call `om.get(session)` or `session.background(...)` without one. Narrowest seam: add `SessionContext { id, metadata?, model, background(name, task) }` and a **per-owner bound view** carried as `HookContext.session` and `ToolExecutionContext.session`, also passed to `when(s)` and command contexts. The session's `hooks()` returns `bus.bound(sessionContext)`, so all 12 dispatch sites (`src/loop/run-controller.ts:130-285`, `session.ts:848,906`, `provider-round.ts:310`, `assemble.ts:303`) need no edit. The bound view is cached per owner per session so the `message_delta` hot path allocates nothing. The per-owner binding is also what lets `capability_missing` fire for `background` "from a package's own handler". `principal` is left to Phase 3: `AgentConfig` has `identity` (`src/identity.ts:4`) but no `principal` yet.
      - **A2 — Agent-owned merged views (Task 6).** `agent.config.tools` / `skills` are read directly in six files: `src/agent-session/session/assemble.ts:267`, `src/agent-tool-dispatch.ts:72`, `src/agent-approval.ts:165`, `src/run-bundle.ts:93-94`, `src/agent-run-state.ts:173-174`, and `src/agent-session/session.ts:766`. Package tools and skills must reach all of them. Decision: **keep `agent.config` as the host's original input** and add merged `tools` / `skills` / `commands` / `providers` accessors to `AgentRuntime` (`src/agent-session/runtime-registry.ts:11-21`); route those reads through them. Rewriting `config.tools` instead would break the ten "clone the config and call `createAgent` again" sites (`packages/acp-agent/src/index.ts:319,346`, `packages/prism-code/src/acp.ts:303,340,409`, `src/agent-definitions.ts:142-144`, `packages/prism-core/src/governance/evals/scenarios.ts:280-283`, `supervisor.ts:573,898`): the clone would carry the already-merged registry plus the `packages` list and fail `tool_conflict` against itself. With the original config kept, each re-creation reloads its packages afresh and independently. That is the documented semantics ("every `createAgent` call loads its packages again; a `PackageInstance` is reusable across agents"), and Task 5 adds `package_instance_loads_independently_per_agent`.
      - **A3 — Redactor lifetime (Tasks 5, 6, 7, 8).** `activeRedactor` is `agent.config.redactor` only **during** a run (`session.ts:574,581,594,601`) and `undefined` otherwise. `emit` (`:778`) and `appendEntry` (`:995`) read it. So any agent-scoped event outside a run (`package.status` at setup, `background.*` after a run ends, `session.closed`) and any `package_state` write between runs would be **unredacted**. The loader and the state module therefore redact with `agent.config.redactor` directly, not through `activeRedactor`. Agent-scoped events also have no session sink (`AgentRuntime.setEventSink` is one sink per agent, last session wins, `runtime-registry.ts:18-22`); the loader dispatches them straight to `bus.observe` with an empty `sessionId`. A resolved `credentials.resolve` value is added to a runtime secret set passed to `createHookBus({ secrets })`, which `create-agent.ts:19` does not do today.
      - **A4 — Package-state hydration (Task 7).** See finding (e): memoised `session.ready`, hydrate-before-use, `state_not_ready` on a premature synchronous read, `session.opened` after hydration.
      - **A5 — Task 4 and Task 5 details.** Task 4's keyword subset gains `integer`, `minItems`/`maxItems`, schema-valued `additionalProperties`, and `title`, plus the `pattern` length bound; a function value in config fails `config_invalid`. Task 5 adds `src/version.ts` with a drift test and a `scripts/release.mjs` lockstep line; its example range becomes `^0.12.1 || ^0.13.0-0`; `missing_service` is checked **after** setup (services are provided during setup), so a missing service unwinds every setup that already ran. `optional` covers a `setup` throw only in Part A; whether a failed `requires` check should also skip an `optional` package is a Phase 4 manifest decision, and it fails closed until then. Task 7 adds a `state_too_large` bound (64 KiB per value) so a package cannot grow a store without limit, consistent with the hard-cap rule.
      - **A6 — `Logger` and `HostPort.log` (Task 5).** `PackageAPI.log` needs a `Logger` type and `HostPort.log?` (roadmap §2.3), and neither exists (`src/host/types.ts:86-88`). Task 5 adds them; `PackageAPI.log` is the host log or a no-op, and every call is redacted. `PackageAPI.host.ui.request` stamps `package` and `sessionId` itself, because `HostUiRequestBase` documents both as kernel-set (`src/host/types.ts:3-7`), so a package cannot spoof either.
      - **A7 — Task 2 and Task 6 text.** Task 2's file list and docs list are corrected to the measured sites above, the workspace list drops `prism-work`, `web-tools`, and `prism-providers`, and `docs/next/tools.md` replaces `slots.md`. Task 6 introduces `PackageCommand` (finding f), builds the merged-view routing (A2), reserves kernel tool names (finding h), puts the `when` filter at `src/agent-session/session/assemble.ts:411-426` (the per-turn narrowing that already feeds `ctx.turnAllow` and `dispatchFilter`, `tool-round.ts:362-369`, so a hidden tool is uncallable unless `allowHiddenToolCalls` is set; `run-controller.ts` is not the seam), adds tests for the codes the plan had none for, and covers `skills.unregister`.
      - **A8 — Task 3 and Task 8 details.** Task 3 moves the session-pack hooks to a `kernel` registrar and tests the durable-fingerprint behaviour; Task 7 removes them on `close()`; Task 8's `hooks` list excludes `#session-` ids and its `slots` owner uses a new `SlotRegistry` owner query, because `resolve()` returns only the implementation (`src/slots/registry.ts:31-44`).
    - **Security: every place a package-supplied value crosses into the host or a store, and the check Tasks 4–8 must test.**

      | Crossing | Path | Required check | Task |
      | --- | --- | --- | --- |
      | Config values | `packageConfig` / manifest layer → merged config → `inspect().packages[].config` | `x-prism-secret` fields hold refs only (`secret_literal` otherwise); `inspect()` shows the ref string, never a resolved value; a configured secret appearing in a **non-secret** field is masked by `agent.config.redactor` | 4, 8 |
      | Errors | `PackageLoadError` message, `path`, `cause` | message holds the path and rule only, never the value; `setup_failed` redacts the third-party `cause` (`errorToErrorInfo`, `src/redaction.ts:205`) and does not retain the raw cause object; `JSON.stringify(error)` contains no secret | 4, 5 |
      | `status.note` / `package.status` | loader → event → `inspect().statusNotes` | redacted with `agent.config.redactor` even outside a run (A3) | 5, 7, 8 |
      | `events.emit` / `package.event` | package `data` → event → hooks and subscribers | `package` stamped by the loader, never caller-set; data redacted outside a run too | 5 |
      | `package_state` entries | `SessionState.set` → `appendEntry` → store | JSON-only, size-capped, redacted with `agent.config.redactor` **before** persistence, including a `set` between runs (A3) | 7 |
      | `background.*` events | task error → event | error redacted; `reason: "aborted"` carries no task data | 7 |
      | `credentials.resolve` | slot → package | the resolved value joins the runtime secret set and never appears in events, `inspect()`, errors, or logs | 6 |
      | `host.ui.request` | package → host | `package` and `sessionId` stamped by the kernel; `host-ui` capability enforced; `unavailable` fails closed | 5 |
      | `log` | package → host logger | every call redacted | 5 |
      | Hook ids / `inspect().hooks` | registrar → listing | owner bound by the loader, not caller-controlled; ids are `<package>:<hook>[#id]` | 3, 8 |
      | Tool registration / `when` | package → tool list | name collisions and reserved names fail closed; `when` predicates are synchronous and a throwing predicate hides the tool (fail closed) | 6 |
      | Command args | host → package `run` | args validated against the command's schema before `run`; `ctx.host` carries the same capability check | 6 |
    - **Evidence not run:** this task is read-only, so no tests, typecheck, or gate ran. The scan scripts and their JSON output are in the session scratchpad (`scan.cjs`, `scan2.json`) and are not committed.

- [x] Task 2: `createAgent` returns `Promise<Agent>`
  - Acceptance Criteria:
    - Functional: `createAgent(config): Promise<Agent>`. Host hook registration still runs once, and a throwing registrar rejects the promise.
    - Functional: Every caller awaits the promise in the same task: the kernel (`src/`), every workspace package that calls it (`agent-sdk`, `acp-agent`, `ag-ui`, `mcp`, `memory`, `prism-core`, `prism-coding-tools`, `prism-channels`, `hooks`, and `prism-code`; Task 1(a) found no call in `prism-work`, `web-tools`, or `prism-providers`), `examples/`, and `scripts/`. 554 kernel call sites in 196 git-tracked files: 422 take a mechanical `await`, and 132 sit in a synchronous function. `resolveAgentDefinition` already returns `Promise<Agent> | Agent` and keeps that type.
    - Functional: A synchronous wrapper becomes async only where that is unavoidable. Task 1(a) lists them: `createSecureAgent` (`src/secure-agent.ts:31`), `createSpawnableAgent` (`packages/acp-agent/src/index.ts:234`, plus its bin at `packages/acp-agent/bin/prism-acp-agent.ts:22`), `wrapAgentWithFailureInjection` (`packages/prism-core/src/governance/evals/scenarios.ts:283`), the CLI's `agentSession` / `mockSession` (`src/cli-runner.ts:505-510`), and the two sync `resolveAgent` closures (`packages/acp-agent/src/index.ts:314`, `packages/prism-code/src/acp.ts:298`). Each wrapper's callers are updated in this task, and their baselines are regenerated.
    - Performance: No measurable change. Assembly does the same work and only adds one microtask.
    - Code Quality: There is no sync overload and no `createAgentSync` alias. `Agent`'s shape does not change in this task.
    - Security: A rejected `createAgent` leaves no registered runtime: `registerAgentRuntime` runs only after hook registration succeeds.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (`createAgent(config: AgentConfig): Promise<Agent>`) and §2.6 Lifecycle
      - Task 1 finding (a)
      - `src/agent-session/create-agent.ts:10-29`
    - Options Considered:
      - Keep `createAgent` sync and load packages lazily on the first `createSession`. Rejected: a `setup` failure would surface on the first session instead of failing `createAgent` closed (§2.6), and `inspect()` would be incomplete before the first session.
      - Add a separate `loadPackages()` step. Rejected: it reintroduces the host wiring that the "installed = active" rule removes, and it is a second construction path (§1.4).
    - Chosen Approach:
      - Make the signature async now, with a mechanical codemod (`createAgent(` → `await createAgent(` in async scope). Then hand-fix the synchronous-context sites Task 1 listed. Phase 3 reshapes the returned `Agent` without another sweep.
    - API Notes and Examples:
      ```ts
      const agent = await createAgent({ model, hooks: (h) => h.on("tool.call", gate) });
      const session = agent.createSession();
      ```
    - Files to Create/Edit:
      - `src/agent-session/create-agent.ts`: async signature.
      - `src/secure-agent.ts` and `src/cli-runner.ts`: the kernel's sync production wrappers (Task 1(a)). `src/agent-definitions.ts` needs no edit (its return type is already `Promise<Agent> | Agent`). `src/rpc.ts`, `src/delegated-agent-step.ts`, and `src/node/agent-definitions.ts` contain no `createAgent` call and are not touched.
      - `packages/acp-agent/src/index.ts`, `packages/acp-agent/bin/prism-acp-agent.ts`, `packages/prism-code/src/acp.ts`, and `packages/prism-core/src/governance/evals/scenarios.ts`: the production wrappers above.
      - Every `src/__tests__/*.test.ts`, `packages/*/src/**`, `examples/*.ts`, and `scripts/*.mjs` call site from Task 1(a). The `.mjs` scripts import `dist/`, so run `bun run build:core` first. `examples/*.js` is gitignored build output and is not edited.
      - `scripts/compat-baseline/arnilo__prism.txt` and every workspace baseline whose re-exported signature changes: regenerate with `node scripts/release.mjs gate --update-baseline`.
      - `src/__tests__/public-export-contract.test.ts`: signature pin, if one exists.
      - `templates/{init,deep-research,personal-assistant,business-worker}/src/**/*.tmpl`, the embedded consumer scripts in `src/__tests__/install-smoke.test.ts`, `scripts/post-publish-smoke.mjs`, `scripts/phase16-freeze.test.mjs`, `packages/prism-coding-tools/src/dev/cli.ts`, and the untracked plan 144/145 test files: text-level `createAgent(` sites that the AST sweep cannot see (added during execution; see Notes).
      - `src/__tests__/create-agent-async.test.ts`: the two new tests.
      - `CHANGELOG.md`: `## [Unreleased]` entry (under a new `### Changed`).
    - References:
      - plan 142 Task 6, the precedent for a whole-tree caller sweep that kept typecheck green.
  - Test Cases to Write:
    - `create_agent_returns_a_promise`: the result is a thenable that resolves to an `Agent` with `createSession`. It fails if the signature reverts to sync.
    - `create_agent_rejects_when_host_hooks_throw`: a throwing `hooks` registrar rejects with the registrar's own error (never a synchronous throw), the registrar runs exactly once, and the same config then creates a healthy agent. The plan's `tryAgentRuntime` assertion is not observable, because a rejected `createAgent` never hands out the would-be `Agent` that keys the `WeakMap`. The ordering guarantee (`registerAgentRuntime` after hook registration) therefore stays a code-review property of `src/agent-session/create-agent.ts`; Task 5 revisits it when the loader owns the load order. (Both tests live in `src/__tests__/create-agent-async.test.ts`; `agent-hooks.test.ts` `host_hooks_throw_fails_create_agent` already covered the rejection.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the `createAgent` signature.
    - Docs pages to create/edit:
      - `docs/next/loop.md:114`, `docs/next/hooks.md:79`, `docs/next/tools.md:84`: update each `createAgent(` example to `await createAgent(`. `docs/next/slots.md` has only a prose mention (`:73`) and no example. No test checks docs snippets, so finish with `rg 'createAgent\(' docs/next` and confirm that every hit is awaited.
      - `CHANGELOG.md`: Unreleased entry.
      - Released `/docs` stays on 0.12.1.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.** `createAgent` is `async function createAgent(config): Promise<Agent>` (`src/agent-session/create-agent.ts:10`), with no sync overload and no alias. Every caller awaits it. The body is unchanged, so the host registrar still runs once, before `registerAgentRuntime`, and a registrar throw is now a rejection.
    - **How it was done.** An AST codemod (TypeScript 5 parser from the session scratchpad, since the repo's TypeScript 7 has no JS API) added `await` at the 422 call sites in async or top-level scope. A fixpoint pass then made the enclosing function `async`, wrapped its return annotation in `Promise<>`, and awaited its same-file callers for the 132 synchronous-scope sites. `tsc` found the rest. The scratch scripts are not committed.
    - **Final shape.** The AST sweep leaves no un-awaited kernel `createAgent(` call except the three in `src/agent-definitions.ts` (return type stays `Promise<Agent> | Agent`) and the two deliberate un-awaited calls in the new test.
    - **Findings the Task 1 survey missed (they affect later tasks):**
      - **Untracked files are call sites too.** The survey counted `git ls-files` only. Plans 144 and 145 left untracked tests that call `createAgent` (`src/__tests__/{agent-hooks,ask-resolution,context-build,hook-invariants,hook-bus}.test.ts`, `src/__tests__/helpers/hook-harness.ts`, and others): 13 more sites, 4 in synchronous scope. Count untracked files in any later sweep.
      - **Property-access kernel calls exist.** Task 1 called the 13 property-access `createAgent` calls non-kernel. Two are kernel calls through a dynamic-import namespace: `prism.createAgent(` in `examples/host-composition-compat.ts` and `scripts/fixtures/e2e-full-surface-journey.mjs`. The `.mjs` one is invisible to `tsc`.
      - **`createAgent(` also lives in strings, and no AST pass sees it.** Fixed here: the four embedded consumer scripts in `src/__tests__/install-smoke.test.ts` (including a `servedAgent().createSession()` call that returned a 500 from the packed A2A handler until fixed), `scripts/post-publish-smoke.mjs`, and the four scaffold templates under `templates/` (`init`, `deep-research`, `personal-assistant`, `business-worker`: `createAppAgent`, `createPlannerAgent`, and `createSynthesizerAgent` are now `async`, their callers and tests await, and `prism dev` accepts `Agent | Promise<Agent>` from `createAppAgent`). Also `scripts/phase16-freeze.test.mjs`, whose two regexes pinned `export function createAgent(`. Left alone on purpose: the 0.12.1-line READMEs and `docs/*.md` (and `src/__tests__/docs.test.ts`, which pins `createAgent({ model, provider })` in released docs).
      - **`resolveAgentDefinition` keeps its type but not its behaviour.** The non-`create` path used to return an `Agent` synchronously and now returns a `Promise`. Two tests read `.config` synchronously through `as unknown as` casts that `tsc` cannot see (`attention-compiler-wiring.test.ts`, `agent-definitions.test.ts`); both now `await`. The synchronous validation throws (`has no model`, `Unknown tool`, …) still throw synchronously, so their `assert.throws` tests are unchanged.
      - **Wrapper validation errors became rejections.** `createSecureAgent`'s `TypeError`s now reject, so `assert.throws(() => createSecureAgent(...))` became `await assert.rejects(...)` (11 `assert.throws(async …)` sites were converted across `src/`, `packages/`, and `scripts/`). A silent `assert.throws(async …)` never fails when nothing throws synchronously, so every such site was checked by grep, not only by `tsc`.
      - **Type-position uses need `Awaited<>`.** `ReturnType<typeof createAgent>["createSession"]` and `{ agent: ReturnType<typeof createAgent> }` became `Awaited<ReturnType<typeof createAgent>>`. The bare `ReturnType<typeof createAgent>` as an `async` function's return annotation is already correct.
      - **Later tasks.** Tasks 5–9 tests and `examples/define-package.ts` write `await createAgent(...)` from the start. Task 6 can rely on `DelegationChild.createAgent`, `sessionFactory`, and `resolveAgent` already accepting promises (verified by `tsc` after this task).
    - **Wrappers whose public signature changed (baseline regenerated).** `node scripts/release.mjs gate --update-baseline` rewrote exactly four lines, and nothing was added or removed:
      - `scripts/compat-baseline/arnilo__prism.txt`: `createAgent(config: AgentConfig): Agent` → `Promise<Agent>`; `createSecureAgent(options: SecureAgentOptions): Agent` → `Promise<Agent>`.
      - `scripts/compat-baseline/arnilo__prism-acp-agent.txt`: `createSpawnableAgent(options): AgentApp` → `Promise<AgentApp>`.
      - `scripts/compat-baseline/arnilo__prism-core.txt`: `wrapAgentWithFailureInjection(agent, injection): Agent` → `Promise<Agent>`.
    - **Sweep result.** `rg 'createAgent\(' docs/next` shows all three examples awaited. The final AST scan over 1,983 tracked and untracked `ts/tsx/mjs/js/cjs` files is clean (above).
    - **Evidence.**
      - `bun run typecheck` exits 0 (root, all 13 workspaces, and `tsc -p examples`).
      - The two new tests pass, and `agent-definitions`, `attention-compiler-wiring`, `install-smoke` (14 of 15), `e2e-full-surface` (5 of 5), `phase16-freeze`, `phase40-security`, `phase8-conformance`, `obscura-host-conformance`, and the `multi-agent-runtime` benchmark scenario pass. The `workspace suites` and `examples execution` stages of `bun run test` pass.
      - **`bun run test` is not green, and not because of this task.** I did not run a before/after comparison (the tree holds uncommitted plan 144/145 work), so this is attribution by cause, per failure:
        - Stale `dist/__tests__/*.test.js` with no source after the plan 145 deletions: `stop-hooks`, `agent-loops`, `turn-policy-stops`, `instruction-injection-assembler`, `cli-instruction-injectors`, `rpc-instruction-injectors`. **Plan 147 or a `dist` clean should remove them; `tsc` never deletes output.**
        - `install-smoke` "every documented core subpath … imports": the script checks `compaction.createCodingCompactionStrategy`, which no longer exists in `@arnilo/prism-memory`.
        - `host-composition-compat`: `CHECK_NAMES` still lists `policy-chain-snapshot`, which plan 145 renamed `hook-chain-snapshot`.
        - `e2e-prism-code-long-run`: the script calls `definition.createSession()`, and the Prism Code definition exposes `session()`.
        - `attention-measurements` budgets, the non-null-assertion budget (`define-agent.ts`, `tui/index.ts`; `examples` 30 vs 29), `biome lint` (2 errors, 40 warnings, none in lines this task wrote), `docs/options-index`, package-truth, peer policy, `tooling-gate` (`ENOENT` on files deleted in the working tree), `packaging` (`agent-sdk` peer), and `phase12`/lockfile (no Postgres URL, no `package-lock.json`).
        - `cli-init`: the generated project typechecks and its test passes (`1 pass 0 fail`); the assertion fails only because Bun 1.4.2 prints no per-test `(pass)` line in a non-TTY run.

- [x] Task 3: Per-owner hook registrars and registration ids
  - Acceptance Criteria:
    - Functional: The bus exposes `registrar(owner): HookRegistrar`. Every registration carries its owner and the id `<owner>:<hook>[#<id>]`.
    - Functional: `AgentConfig.hooks` registers under the owner `host`. `HookError.owner` and the `tool.call` deny text name the registering owner, not the bus owner.
    - Functional: A duplicate explicit id within one owner and hook fails closed, as it does today. The same explicit id under two owners is allowed.
    - Functional: Ordering is unchanged: priority descending, then registration sequence. Because packages register in load order and host hooks last, "ties run in package load order, host hooks last" (§2.4) holds once Task 5 lands.
    - Functional: `bus.registrations()` already returns `{ id, owner, name, kind, priority }` in execution order per hook (`src/hooks/bus.ts:249`). It keeps that shape, and the delta is that `owner` comes from the registrar (Task 1(b)).
    - Functional: `bus.remove(id)` removes one registration and returns whether it existed, for `disable.hooks` and dispose.
    - Functional: The two hooks each `AgentSession` registers on the shared bus (`src/agent-session/session.ts:299-316`, ids carrying `#session-<n>`) move to a `kernel` registrar. They keep the `#session-` marker, which `agentHookIds` filters from the durable fingerprint (`src/agent-session/runtime-registry.ts:55-63`).
    - Functional: A suspended run resumes only against the same registration ids. Because ids change from `host:<hook>` to `<package>:<hook>`, a resume against a different package set fails closed on the fingerprint (Task 1(b)).
    - Performance: Dispatch cost is unchanged: lists stay pre-sorted at registration time, so `registrations()` sorts nothing.
    - Code Quality: There is still one bus per agent. `createHookBus({ owner })` loses its `owner` option, with no alias. All callers (`create-agent.ts`, the hook harness, and tests) migrate in this task.
    - Security: A package cannot register under another owner's name. `PackageAPI.hooks` is a registrar bound by the loader, and a test asserts that the owner is not caller-controlled.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (ordering, ids, `disable.hooks`)
      - `src/hooks/bus.ts:28-160`, `src/hooks/types.ts`
      - backlog "Decide the kernel skills catalog's owner"
      - Task 1 finding (b)
    - Options Considered:
      - One bus per package, merged at dispatch. Rejected: it duplicates the ordering logic, and cross-package priority becomes a merge problem.
      - An `owner` field in `HookOptions`. Rejected: any caller could then claim any owner, which defeats id-based `disable` and error attribution.
    - Chosen Approach:
      - Make the owner a property of a registrar the loader hands out, not of a registration option. The existing `Registration.owner` field (`bus.ts:33`) already carries it, so only the source of `owner` changes.
    - API Notes and Examples:
      ```ts
      const bus = createHookBus({ onEvent });
      bus.registrar("host").on("tool.call", gate, { id: "net" });  // id "host:tool.call#net"
      bus.registrations("tool.call"); // [{ id, owner, name, kind, priority }]
      bus.remove("host:tool.call#net"); // true
      ```
    - Files to Create/Edit:
      - `src/hooks/bus.ts`, `src/hooks/types.ts`, `src/hooks/index.ts`: `registrar(owner)` and `remove`, and `HookBusOptions.owner` dropped.
      - `src/agent-session/create-agent.ts:19`: host registrar. `src/agent-session/session.ts:299-316,411`: the session-pack hooks and the fallback bus.
      - `src/__tests__/helpers/hook-harness.ts`, `src/__tests__/run-controller.test.ts:16`, and `src/__tests__/hook-bus.test.ts:8`: the callers that construct a bus.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate (`HookBus` / `HookBusOptions` change).
      - `docs/next/hooks.md`: ids, owners, `registrations`.
      - `CHANGELOG.md`
    - References:
      - plan 145 Task 2 Notes on why `HookOptions` carries no owner
  - Test Cases to Write:
    - `registration_ids_are_owner_scoped`: the same explicit id under two owners succeeds, and under one owner it fails. It fails if ids stop including the owner.
    - `hook_error_names_registering_owner`: a transform throw under owner `pkg-a` produces a `HookError` whose owner is `pkg-a`. It fails if the owner comes from the bus.
    - `registrations_listed_in_execution_order`: mixed priorities and owners list in exactly the order dispatch calls them. It fails if `registrations()` and dispatch disagree.
    - `remove_unregisters_one_id`: after `remove`, the handler no longer fires and `remove` returns `false` on the second call.
    - `agent_hook_ids_are_owner_scoped_and_skip_session_hooks`: `agentHookIds` lists `<owner>:<hook>` ids for host and registrar registrations and omits the `#session-` ones. A suspended run resumed on an agent with a different id set fails closed. It fails if the durable fingerprint stops covering owner-scoped ids.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `HookBus` and registration ids.
    - Docs pages to create/edit:
      - `docs/next/hooks.md`: "Registration ids and owners" section.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.**
      - `HookBus` no longer extends `HookRegistrar`. It exposes `registrar(owner): HookRegistrar` and `remove(id): boolean` (`src/hooks/types.ts`, `src/hooks/bus.ts`). `HookBusOptions.owner` is gone and `createHookBus(options?)` takes optional options. The bus keeps one registrar per owner, and an empty or non-string owner throws `ERR_PRISM_HOOK_OPTION`.
      - The bus's private `register(owner, …)` takes the owner from the registrar, so option errors, the duplicate-id error, `HookError.owner`, `HookRejectedError`, the `tool.call` deny text, and `hook.error` already read `registration.owner` and needed no further edit. The duplicate check compares the full id (`<owner>:<hook>#<id>`), which is per owner and hook and drops the `explicitId` field.
      - `createAgent` registers `AgentConfig.hooks` through `registrar("host")` (`src/agent-session/create-agent.ts`). `RuntimeAgentSession` registers its two pack hooks through `registrar("kernel")`, and the fallback bus for hand-rolled agents is `createHookBus()` (`src/agent-session/session.ts`). Pack-hook ids are now `kernel:tool.call#session-<n>`; they were `host:…`.
      - Test callers migrated: `hook-bus.test.ts` and `run-controller.test.ts` wrap `registrar(owner).on` over the bus. `src/__tests__/helpers/hook-harness.ts` needed no edit, since it registers through `AgentConfig.hooks`.
    - **Decision: `remove(id)` removes every registration that carries the id.** The plan said "one registration", but unnamed registrations under one owner and hook share an id (`host:tool.call`), so a single-registration `remove` would be ambiguous and `disable.hooks: ["pkg:tool.call"]` would need a loop. Task 6's `disable.hooks` and Task 5's dispose call `remove` once per id. `hooks.md` documents it.
    - **Findings that affect later tasks.**
      - `createHookBus` **is** exported from the root (`scripts/compat-baseline/arnilo__prism.txt:746`), although its doc comment said otherwise. The comment is corrected. It stays exported, since the hook-bus tests and the future conformance suite use it.
      - Session pack hooks still accumulate on the shared bus until Task 7 removes them on `close()`. The `ponytail:` comment in `registerGuardrailPackHooks` now points at plan 146 Task 7. Task 8's `inspect().hooks` must skip `kernel:*#session-` ids (A8).
      - **The compat baseline is generated from `dist/`, not from `src/`.** A `--update-baseline` run before `bun run build:core` rewrites nothing for the new code. Run `bun run build:core` first in every later task that moves an export.
    - **Baseline diff** (`node scripts/release.mjs gate --update-baseline` after `bun run build:core`): exactly one line changed, in `arnilo__prism.txt`: `createHookBus(options: HookBusOptions)` → `createHookBus(options?: HookBusOptions)`. `HookBus` and `HookBusOptions` are exported as type names only, so their member changes do not show.
    - **Tests written** (all in `src/__tests__/`, 48 pass across `hook-bus`, `ask-resolution`, `run-controller`, and `agent-hooks`):
      - `hook-bus.test.ts`: `registration_ids_are_owner_scoped` (also covers an `owner` smuggled through options and an empty owner), `hook_error_names_registering_owner` (transform, `tool.call` deny, and `hook.error`), `registrations_listed_in_execution_order` (it asserts that dispatch order and `registrations()` agree across three owners), and `remove_unregisters_one_id` (it covers the second call, a freed id, and `has`).
      - `ask-resolution.test.ts`: `agent_hook_ids_are_owner_scoped_and_skip_session_hooks`. A session's `kernel:*#session-` hooks are present in `registrations()` and absent from `agentHookIds`. A suspended run resumed on an agent with the same hook name under a different owner (`pkg-b:tool.call` against `host:tool.call`) fails with `fingerprint mismatch`.
    - **Sweep.** `rg 'createHookBus\(|HookBusOptions|owner: "host"' src packages scripts examples docs/next` finds no `owner:` option left. No other workspace constructs a bus.
    - **Docs.** `docs/next/hooks.md` gains "Registration ids and owners". `CHANGELOG.md` has an Added entry and a Changed (breaking) entry. The backlog item "Decide the kernel skills catalog's owner" now records that the seam shipped here and the move is deferred to Phase 3.
    - **Evidence.**
      - `bun run typecheck` exits 0 (root, all workspaces, and `tsc -p examples`).
      - `bun test src` leaves only failures that are not about hooks: `prism init`, `host-composition-compat`, and the agent-sdk peer check, all already recorded in Task 2's Notes. The `field policy microbenchmark` is a timing assertion on an untouched code path. The three ACP/bin spawn tests fail because `packages/acp-agent/src/__tests__/agent.test.ts:625` spawns `<repo>/dist/bin/prism-acp-agent.js`, which does not exist (the bin builds to `packages/acp-agent/dist/bin/`). I did not run a before/after comparison, as in Task 2.

- [x] Task 4: Package config — kernel JSON Schema validation, defaults, merge, and secret refs
  - Acceptance Criteria:
    - Functional: `validateJsonSchema(schema, value)` supports the keyword subset recorded in Task 1(c):
      - `type` (a single value: `string`, `number`, `integer`, `boolean`, `object`, `array`, or `null`), `properties`, `required`, `additionalProperties` (a boolean or a schema; default `false` for package config), `items` (a single schema), `minItems` / `maxItems`, `enum`, `const`, `default`, `minimum` / `maximum`, `minLength` / `maxLength`, `pattern` (pattern and tested string are length-bounded), `oneOf` / `anyOf`, and the annotations `description` and `title`
      - the Prism annotation `"x-prism-secret": true`
      - Task 1(c) derives this list from the Part B conversions. Anything else, including any other `x-*` key, gives `config_schema_unsupported`.
      - It returns `{ ok, value, errors: [{ path, message }] }`.
    - Functional: `resolvePackageConfig(definition, layers)` behaves as follows:
      - It applies schema defaults, then the manifest layer, then `packageConfig[name]`, deep-merging objects and replacing arrays.
      - It validates the merged value and records each top-level key's source (`default | manifest | host`) for `inspect()`.
    - Functional: These cases fail closed:
      - An unknown key gives `PackageLoadError` `config_unknown_key`.
      - A type, enum, or range violation gives `config_invalid`.
      - A literal in an `x-prism-secret` field gives `secret_literal`. Accepted refs match `^(env|keyring):[A-Za-z0-9_.\-/]+$`.
      - A schema keyword outside the subset gives `config_schema_unsupported`. Unsupported keywords are rejected, never silently ignored.
    - Functional: A package without a `config` schema gets `{}`. Any supplied config for it fails `config_unknown_key`.
    - Functional: Package config is JSON-only. A function or other non-JSON value fails `config_invalid`. Code-only options (fetchers, hooks, credential functions) are bound by the package's own factory closure, as Part B Task 3 does with `wiki({ fetch })` (Task 1(c)).
    - Performance: Validation is linear in the size of the config and runs once per `createAgent`. Each `definePackage` compiles its schema at most once (cached on the definition).
    - Code Quality: The validator lives in `src/packages/schema.ts` with no runtime dependency (§1.4 "Minimal kernel"). `PackageLoadError` lives in `src/packages/errors.ts`.
    - Security:
      - Error messages show the path and rule, never the offending value, so a literal secret is never echoed.
      - The config source map records only key names and sources.
      - A test asserts that a literal secret appears in no error message, no `cause`, and no `inspect()` field.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 (`config: JsonSchema` "validated before setup; defaults applied; secret fields must be refs") and Phase 2 Config
      - §2.7 (merge order, ref forms)
      - JSON Schema 2020-12 core and validation vocabularies, for keyword semantics only
      - Task 1(c)
    - Options Considered:
      - Depend on `ajv`. Rejected: the kernel has no runtime dependencies (§1.4), and the roadmap names "the kernel's own validator".
      - Reuse `@arnilo/prism-tool-validator-json-schema`. Rejected: the kernel cannot import a package (§1.4).
      - Use a TypeScript-only config shape with no runtime schema. Rejected: Phase 4 validates config at `configure` time without running `setup`, which needs a runtime schema.
    - Chosen Approach:
      - Ship a small, explicit-subset validator that rejects keywords it does not implement, so a schema can never pass validation it did not get. It is reused by Phase 4 `configure` and later by kernel tool-argument validation (§2.1).
    - API Notes and Examples:
      ```ts
      config: {
        type: "object",
        properties: {
          backend: { type: "string", enum: ["brave", "exa"], default: "brave" },
          apiKey: { type: "string", "x-prism-secret": true },
        },
        required: ["apiKey"],
      }
      // packageConfig: { "@acme/web": { apiKey: "sk-live…" } } → PackageLoadError { code: "secret_literal", path: "/apiKey" }
      ```
    - Files to Create/Edit:
      - `src/packages/schema.ts`: validator.
      - `src/packages/config.ts`: merge and source map.
      - `src/packages/errors.ts`: `PackageLoadError` and its code union.
      - `src/packages/index.ts`: barrel.
      - `src/index.ts`: export `PackageLoadError`, `PackageLoadErrorCode`, and `JsonSchema`. Keep `validateJsonSchema` internal unless Task 1 finds a host need.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate.
      - `docs/next/packages.md`: create, with the "Configuration" section.
      - `CHANGELOG.md`
    - References:
      - `src/config.ts` (`assertJsonObject`), the existing JSON-object guard to reuse
  - Test Cases to Write:
    - `schema_subset_validates_types_enums_ranges`: a table of valid and invalid cases per keyword. It fails if any keyword is skipped.
    - `unsupported_schema_keyword_fails_closed`: `$ref`, `patternProperties`, `allOf`, `format`, an array-valued `type`, and an unknown `x-*` key give `config_schema_unsupported`. It fails if any is ignored.
    - `function_valued_config_is_rejected`: a function in a config value gives `config_invalid`. It fails if a non-JSON value reaches `setup`.
    - `pattern_is_length_bounded`: an over-long pattern or input fails closed instead of running. It fails if the bound is removed.
    - `config_merges_defaults_manifest_host_in_order`: the host value beats the manifest, and the manifest beats the default. The source map is correct. It fails on any order swap.
    - `unknown_config_key_fails_closed`
    - `literal_secret_rejected_and_never_echoed`: the error message and `JSON.stringify(error)` do not contain the literal. It fails if the value leaks.
    - `secret_refs_accept_env_and_keyring_only`: `env:X` and `keyring:y` pass, while `file:/x` and `sk-…` fail.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package config contract.
    - Docs pages to create/edit:
      - `docs/next/packages.md`: new page, using the API page structure (Configuration section first).
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.** New `src/packages/` with `errors.ts`, `schema.ts`, `config.ts`, and an `index.ts` barrel. No runtime dependency was added.
      - `PackageLoadError` (`code`, `package?`, `path?`, no retained `cause`) with the Task 4 codes only: `config_unknown_key`, `config_invalid`, `secret_literal`, `config_schema_unsupported`. Tasks 5–7 extend `PackageLoadErrorCode` with their own codes, so the union carries no unused names.
      - `validateJsonSchema(schema, value)` returns `{ ok, value, errors: [{ path, message, rule }] }`. `rule` is an addition to the planned `{ path, message }` shape: `resolvePackageConfig` maps it to the error code (`unknown_key` → `config_unknown_key`, `secret` → `secret_literal`, everything else → `config_invalid`), so no message is parsed. A schema is checked and compiled once into a node tree cached in a `WeakMap` keyed by the schema object, which covers "compile at most once per definition" without a cache field on the definition.
      - `resolvePackageConfig(definition, { manifest?, host? })` takes `{ name, config? }`, so Task 5 passes its `PackageDefinition` as is. It merges defaults → manifest → host (objects deep-merge, arrays and scalars replace), validates, and returns `{ config, sources }`, where `sources` maps each top-level key to `default | manifest | host`.
      - Root exports: `PackageLoadError`, `PackageLoadErrorCode`, and `JsonSchema`. `validateJsonSchema` and `resolvePackageConfig` stay internal, as planned. `SECRET_REF` is exported from the barrel for later tasks.
    - **Decisions inside the plan's choices.**
      - **Keyword subset** is exactly Task 1(c)'s (with A5's additions): `integer`, `minItems`/`maxItems`, schema-valued `additionalProperties`, `title`. A malformed supported keyword (`"minLength": -1`, a bad `pattern`, a secret field that is not a string, an empty `enum`) also gives `config_schema_unsupported`, and so does a `default` that fails its own schema. That catches a literal secret default at compile time.
      - **`additionalProperties` defaults to `false` for every object value at any depth**, including an object compared in `enum` or `const`. A free-form object field must say `additionalProperties: true`. Keywords apply only to their own value kind (`minimum` on a string is ignored), as in JSON Schema.
      - **Defaults:** `schemaDefaults(schema)` builds the default layer, so a parent object's `default` deep-merges with a partial manifest or host object, as the plan states. Validation then fills any remaining nested defaults. A nested object appears only when a default exists below it.
      - **Non-JSON:** `toJsonValue` normalises each layer before merging. It rejects a function, symbol, bigint, non-finite number, class instance (including `Date`), cycle (depth over 64), and `__proto__`/`constructor`/`prototype` keys. An `undefined` object property counts as absent, like `JSON.stringify`, so `{ x: opts.x }` with an unset option does not fail. An `undefined` array element does fail.
      - **ReDoS bound:** a pattern is at most 256 characters, and a string over 4,096 characters is refused without running the pattern. This bounds the input but does not make an arbitrary pattern safe. Package schemas are code the host chose to load, so the residual risk is accepted and recorded in `docs/next/packages.md`.
      - **No-schema packages** validate against one shared empty-object schema, so any supplied key is `config_unknown_key`. A non-object root schema (`type: "string"`) is `config_schema_unsupported`.
    - **Findings that affect later tasks.**
      - **Task 5** can call `resolvePackageConfig(definition, { manifest, host: agentConfig.packageConfig?.[name] })` directly. Its errors already carry `package` and a JSON-pointer `path`, and it throws `PackageLoadError` for a bad schema before any `setup` runs. Task 5 must still redact: these messages are value-free by construction, but `setup_failed` wraps third-party errors and needs `errorToErrorInfo`.
      - **Task 8** gets `sources` for `inspect().packages[].config`. It records only key names and sources. `inspect()` does not exist yet, so the plan's "no secret in any `inspect()` field" assertion belongs to Task 8's `inspect_never_contains_secret_values`. Task 4 pins the error, `cause`, stack, and source-map side.
      - **The compat baseline lists every exported declaration under `dist/`, not only the root barrel.** The new internal helpers (`toJsonValue`, `schemaDefaults`, `resolvePackageConfig`, and others) therefore appear even though `src/index.ts` does not export them. Only `src/__tests__/public-export-contract.test.ts` pins the real root surface, and it needed `PackageLoadError`, `JsonSchema`, and `PackageLoadErrorCode` added. Later tasks that export from `src/index.ts` update both.
    - **Baseline diff** (`bun run build:core`, then `node scripts/release.mjs gate --update-baseline`): 18 additions to `arnilo__prism.txt` and no removals. They are `PackageLoadError`, `PackageLoadErrorCode`, `JsonSchema`, `SECRET_REF`, `validateJsonSchema`, `resolvePackageConfig`, `schemaDefaults`, `toJsonValue`, and the `type …` re-export lines for `PackageConfigDefinition`, `PackageConfigLayers`, `PackageConfigSource`, `PackageLoadErrorOptions`, `ResolvedPackageConfig`, `SchemaError`, `SchemaErrorRule`, and `SchemaResult`.
    - **Tests written** (`src/__tests__/package-config.test.ts`, 9 pass): `schema_subset_validates_types_enums_ranges` (every keyword has a valid and an invalid case), `applies defaults, including nested ones, without mutating the schema`, `unsupported_schema_keyword_fails_closed` (17 schemas, including `$ref`, `patternProperties`, `allOf`, `format`, an array-valued `type`, an unknown `x-*` key, a literal secret default, and a `__proto__` property), `function_valued_config_is_rejected` (functions, a `Date`, `NaN`, bigint, symbol, a cycle, and a `__proto__` key), `pattern_is_length_bounded`, `config_merges_defaults_manifest_host_in_order` (the host beats the manifest, which beats the default, and the source map and the inputs' immutability are checked), `unknown_config_key_fails_closed` (also a schema-less package and a missing `required`), `literal_secret_rejected_and_never_echoed` (the message, `path`, `JSON.stringify(error)`, `stack`, own properties, and `cause`), and `secret_refs_accept_env_and_keyring_only` (10 rejected forms and secrets inside an array).
    - **Docs.** `docs/next/packages.md` is created with a Configuration section in the API page structure. It says that `definePackage`, the loader, and `PackageAPI` land in later tasks, so it describes nothing that does not exist yet. `CHANGELOG.md` has an Added entry.
    - **Sweep.** No retired name. `rg 'from "@arnilo/prism-' src/packages` finds no package import (the kernel names no package).
    - **Evidence.**
      - `bun run typecheck` exits 0.
      - `bun test src/__tests__/package-config.test.ts src/__tests__/public-export-contract.test.ts` pass (243 tests), and `biome lint` is clean on the new files.
      - `bun test src` leaves the same failures as Task 3: `prism init`, `host-composition-compat`, the agent-sdk peer check, the `field policy` timing benchmark, and the three ACP/bin spawn tests (they spawn `<repo>/dist/bin/prism-acp-agent.js`). None touches `src/packages`. I did not run a before/after comparison.

- [x] Task 5: `definePackage`, the loader, `requires`, capabilities, lifecycle, and inline host hooks
  - Acceptance Criteria:
    - Functional: `definePackage(def)` returns a callable `PackageDefinition<C>`:
      - `def(config?)` returns a `PackageInstance`. `def(config, { optional: true })` marks the instance optional (the manifest's `optional` maps here in Phase 4).
      - Passing the bare definition means defaults.
      - The definition is validated eagerly: `name` must be a non-empty npm name, `version` must be semver, `requires.prism` must parse, and every capability must be known. Otherwise it throws `PackageLoadError` `definition_invalid`.
    - Functional: `createAgent({ packages, packageConfig })` runs the §2.6 lifecycle:
      - It resolves inputs, and a duplicate package name gives `duplicate_package`.
      - It merges and validates config (Task 4).
      - It orders packages topologically by `requires.packages`, keeping stable input order. A cycle gives `dependency_cycle`, naming the cycle.
      - It checks `requires`. A kernel range mismatch gives `kernel_range`, a missing required package or one whose version fails its range gives `missing_package`, and a missing required service gives `missing_service` (checked after all setups, against `services.provide` calls).
      - It runs `setup` in order.
      - It resolves slots, so a conflict gives `SlotConflictError` unless `AgentConfig.slots` names the owner or supplies an implementation.
    - Functional: A `setup` throw gives `setup_failed`, naming the package. Every package already set up is disposed in reverse order, and no partial contribution survives. An `optional` instance's throw instead unwinds only that package and records the status note `skipped: <message>`. `optional` covers a `setup` throw only: a failed `requires` check stays fatal until Phase 4 decides otherwise (Task 1 A5).
    - Functional: `missing_service` is detected after all `setup` calls have run, so it unwinds every package set up so far in reverse order, exactly like `setup_failed`.
    - Functional: The kernel version comes from `src/version.ts`, a plain constant pinned to `package.json` by a test and updated by the lockstep bump in `scripts/release.mjs`. The loader takes an internal override so tests can inject a version. The kernel is `0.12.1` until Phase 11, so an in-tree package or example must declare a range that admits it (for example `^0.12.1 || ^0.13.0-0`), not `^0.13.0-0` alone.
    - Functional: `SessionContext` is delivered here (Task 1 A1): `{ id, metadata?, model, background(name, task) }`. A per-owner bound view of it is `HookContext.session` and `ToolExecutionContext.session`, the argument to `when(s)`, and part of the command context. The session's `hooks()` returns a bound bus view, so no dispatch site changes, and the view is cached per owner per session so `message_delta` allocates nothing. `background` throws `capability_missing` for a package without `"background"`. Task 7 supplies the tracker behind it.
    - Functional: `Logger` and `HostPort.log?` are added. `PackageAPI.log` is the host's logger or a no-op, and every call is redacted. `PackageAPI.host.ui.request` stamps `package` and `sessionId` itself (they are kernel-set, `src/host/types.ts:3-7`), so a package cannot spoof either.
    - Functional: Events raised outside a run (`package.status` and `package.event` from `setup`, `background.*` after a run ends) are dispatched straight to the bus with an empty `sessionId`, and are redacted with `agent.config.redactor`, because `activeRedactor` is undefined between runs (Task 1 A3).
    - Functional: Part A enforces capabilities on these `PackageAPI` members. A call without the capability throws `capability_missing` from the call, naming the member and the capability:
      - `slots.<slot>.provide` needs `slot:<slot>`.
      - `models.client` needs `models`.
      - `credentials.resolve` needs `credentials`.
      - `state.session` needs `session-state`.
      - `SessionContext.background` from a package's own handler needs `background`.
      - Any `host.ui` request needs `host-ui`.
    - Functional: `AgentConfig.hooks` becomes an inline, unnamed package with owner `host` that loads last, so its hooks tie-break after every package. `AgentConfig.slots` keeps direct-implementation precedence.
    - Functional: `PackageAPI` members delivered here: `name`, `config`, `hooks` (the owner-bound registrar from Task 3), `slots`, `host`, `events.emit` (as `package.event` with `package` set by the loader), `status.note`, `log`, and `onDispose`.
    - Functional: `agent.dispose()` runs `onDispose` callbacks in reverse load order and removes every hook and slot registration. A throwing callback is reported and does not stop the rest. A second call is a no-op.
    - Performance: Loading is sequential by design (the setup order is the contract). The loader adds no I/O. Package module import is the host's or Phase 4's job.
    - Code Quality: The loader lives in `src/packages/{define,loader,capabilities,semver}.ts`. `semver.ts` implements exactly the range forms from Task 1(c) (`^`, `~`, exact, `>=`, `>`, `<=`, `<`, space-AND, `||`, `*`, node-semver prerelease rule), and unsupported forms throw `definition_invalid`.
    - Security:
      - Capability checks sit inside the SDK-mediated members, so a package cannot bypass them by holding a reference.
      - `status.note` and `events.emit` data pass through `agent.config.redactor` before any event or inspect record is written, including outside a run.
      - `setup_failed` carries a redacted message and does not retain the raw third-party `cause`.
      - A test proves a loaded package never sees another package's `config` object.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 (definition, `PackageAPI`, Lifecycle, Capabilities) and §2.11 (OM package, loop-owning package, host hooks)
      - `src/slots/registry.ts:13-44`
      - `src/agent-session/create-agent.ts`
      - Task 1 findings (a), (b), and (c)
    - Options Considered:
      - Validate capabilities statically, by scanning setup code. Rejected: that is not possible for arbitrary code, and §2.6 says enforcement is on the SDK-mediated APIs.
      - Run `setup` in parallel. Rejected: the order is part of the contract (hook tie-breaks, `requires.packages`).
      - Keep host hooks on the bus's host owner without the inline-package model. Rejected: §2.3 defines host hooks as "an inline, unnamed package loaded last", and `inspect()` must list them like packages.
    - Chosen Approach:
      - Build one loader that produces a `LoadedPackages` record (ordered entries, the owner-bound APIs, and per-package undo lists, mirroring the unwind pattern at `src/extensions.ts:200-221`). `createAgent` builds the runtime from that record.
    - API Notes and Examples:
      ```ts
      export default definePackage({
        name: "@acme/plan-execute-verify",
        version: "1.0.0",
        requires: { prism: "^0.12.1 || ^0.13.0-0" },
        capabilities: ["slot:loop"],
        setup(prism) { prism.slots.loop.provide(planExecuteVerify); },
      });
      const agent = await createAgent({ model, packages: [pev(), audit({ level: "warn" })] });
      ```
    - Files to Create/Edit:
      - `src/packages/define.ts`, `loader.ts`, `capabilities.ts`, `semver.ts`, `api.ts`: new.
      - `src/agent-session/create-agent.ts`: lifecycle, `dispose`.
      - `src/contracts-core/agent.ts`: `AgentConfig.packages` and `packageConfig`, and `Agent.dispose`.
      - `src/slots/registry.ts`: `remove(owner)` for unwind, and an owner query (`resolve` returns only the implementation, which `inspect()` cannot use).
      - `src/hooks/bus.ts`, `src/hooks/types.ts`: the bound bus view and `HookContext.session`. `src/contracts-protocol.ts`: `ToolExecutionContext.session`. `src/host/types.ts`: `Logger` and `HostPort.log`.
      - `src/index.ts`: export `definePackage`, `PackageDefinition`, `PackageInstance`, `PackageInput`, `PackageAPI`, `Capability`, `PackageRequires`, `SessionContext`, and `Logger`.
      - `src/version.ts` (new; Task 1 found none): the kernel version constant. A test pins it to `package.json`, and `scripts/release.mjs` rewrites it in the lockstep bump.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate.
      - `src/__tests__/public-export-contract.test.ts`: deliberately add the new exports to the root-export freeze.
      - `docs/next/packages.md`: definition, lifecycle, capabilities, and errors.
      - `CHANGELOG.md`
    - References:
      - `src/extensions.ts:126-223`, the 0.12 unwind pattern. It is retired in Part B, and the semantics carry over.
  - Test Cases to Write:
    - `listed_package_is_active_without_wiring`: a package registering a `tool.call` deny blocks a tool on the mock provider with no other host code.
    - `requires_checks_fail_closed`: one case each for `kernel_range`, `missing_package`, `missing_service`, `dependency_cycle`, and `duplicate_package`.
    - `topological_order_is_stable`: B requires A while the input is listed `[B, C, A]`, so the result is `[A, B, C]`.
    - `setup_failure_unwinds_all_prior_packages`: after a throw in package 3, packages 1–2 are disposed and no hook or slot registration remains.
    - `optional_setup_failure_skips_with_status_note`
    - `capability_missing_fails_on_call`: one case per gated member.
    - `two_slot_claimants_fail_closed_until_assigned`: two packages providing `compaction` give `SlotConflictError`, and `slots: { compaction: "@a/x" }` resolves it. This is a roadmap Done criterion.
    - `loop_slot_package_runs_end_to_end`: a package owning `loop` runs a two-phase loop on the mock provider, and `tool.call` still fires (via `hook-harness`). This is a roadmap Done criterion.
    - `host_hooks_load_last`: a host hook and a package hook with equal priority run package first.
    - `dispose_is_reverse_order_and_idempotent`
    - `package_config_is_isolated`
    - `package_instance_loads_independently_per_agent`: one `PackageInstance` passed to two `createAgent` calls runs `setup` twice with no shared state, and an agent re-created from `{ ...agent.config }` reloads its packages without a `tool_conflict` against itself (Task 1 A2).
    - `missing_service_unwinds_prior_setups`: packages 1–2 set up, the service check fails, and both are disposed in reverse order.
    - `kernel_version_matches_package_json`: `src/version.ts` equals `package.json` `version`. It fails on drift.
    - `setup_failure_redacts_cause`: a `setup` that throws an error containing a configured secret yields a `PackageLoadError` whose message and `JSON.stringify` contain no secret.
    - `session_context_is_owner_bound`: a hook registered by package A and one by package B each receive a `ctx.session` bound to their own owner, so only the package without `"background"` gets `capability_missing`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `definePackage`, the `AgentConfig` fields, and `Agent.dispose`.
    - Docs pages to create/edit:
      - `docs/next/packages.md`: definition, lifecycle, requires, capabilities, error codes, and the loop-owning example.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.**
      - **New `src/packages/`:** `semver.ts` (the range forms from Task 1(c), node-semver prerelease rule, `^x.y.z` upper bounds are `<next-0` so `2.0.0-alpha` is excluded), `capabilities.ts` (`Capability`, `isCapability`, `requireCapability`), `api.ts` (`PackageAPI`, `PackageDefinition`, `PackageInstance`, `PackageInput`, `PackageRequires`, `SlotRegistrar`), `define.ts` (`definePackage`, `normalizePackageInput`), `loader.ts` (`loadPackages`). `src/session-context.ts` holds `SessionContext`, and `src/version.ts` holds `KERNEL_VERSION`.
      - **`createAgent`** now builds the bus and slot registry, awaits `loadPackages`, then builds the agent and its runtime. `createAgentWith(config, { kernelVersion })` is the test seam, not exported from the root. `AgentConfig.packages` and `packageConfig` are new, and `Agent.dispose()` is required. Three hand-built `Agent` literals in tests needed `dispose`.
      - **Hook bus:** `removeOwner(owner)` and `bound(sessionFor)` are new. A bound bus shares registrations and gives each handler `context.session`, a view for the registering owner. The dispatchers moved into a `dispatchers(sessionFor?)` factory, so there is one implementation. A dispatch with no handler now returns before building a context. `RuntimeAgentSession.hooks()` returns the bound bus, so none of the 12 dispatch sites changed. Observed events also go through it.
      - **Slots:** `SlotAssignments` values may be an implementation or a package name. `SlotRegistry` gains `ownerOf` and `remove(owner)`, `resolve` accepts a name and throws `UnknownSlotOwnerError` for a name that did not provide the slot, and `SLOT_NAMES` is exported from `src/slots`. `createAgent` resolves every slot while loading, so a conflict fails the load.
      - **Loop identity:** three sites read `config.slots.loop` directly (`agent-run-state.ts` fingerprint, `assemble.ts` durable-loop check, `run-bundle.ts`). Each now calls `assignedLoop(agent)` (`runtime-registry.ts`), which also finds a loop a package provided. Without it a package's loop would not have been in the durable fingerprint.
      - **`HostPort.log?` and `Logger`** are new (A6).
      - **Release:** `scripts/release.mjs` rewrites `src/version.ts` in `bumpRelease` and `bumpPackage` when the root package is bumped.
    - **Decisions inside the plan's choices.**
      - **Instance config is the manifest layer.** `def(config)` feeds `resolvePackageConfig`'s `manifest` position and `packageConfig[name]` is the host layer on top. A code instance and a Phase 4 manifest entry therefore take the same path.
      - **`packageConfig` for a package that is not listed fails `config_unknown_key`.** A typo in a package name must not be silently ignored.
      - **A `PackageLoadError` thrown inside `setup` keeps its own code** (`capability_missing`, `service_conflict`, `missing_service`). Only other throws become `setup_failed`. An `optional` instance is skipped for any throw.
      - **`host.ui.request` rejects with `capability_missing`** (it is async), and answers `{ status: "unavailable" }` when the host has no UI. The loader stamps `package` over whatever the caller passed. `sessionId` is not stamped at setup because there is no session yet. Task 6's command and tool contexts build the same wrapper with a session id.
      - **Out-of-run events go straight to the bus** (`bus.observe`), as A3 says. `package.event` data and status notes are redacted with `AgentConfig.redactor`. A dispose failure is reported as a `hook.error` through `bus.observe`, so a package's own `hook.error` handler hears it, but event subscribers on a session do not.
      - **Services** were delivered here, not in Task 6 (see the amended Task 6 line), since the missing-service tests need `provide`.
      - **`session.background`:** the owner-bound view and the `capability_missing` check are final. The runner behind it is minimal (it runs the task, swallows its rejection, and aborts on `close()`) and is marked `ponytail:` for Task 7.
    - **Deviations from the plan text.**
      - **`ToolExecutionContext.session` is a type field only.** Nothing populates it yet, because a tool's owning package is unknown until Task 6's `tools.register`, and populating it with the `host` view would skip the `background` check for package tools. Task 6 binds it per tool owner, together with `when(s)` and the command context.
      - **`package.status` is not emitted.** `status.note` records the note (redacted, capped at 200) and Task 7 adds the event type and the dispatch. `loaded.statusNotes()` feeds Task 8.
      - **Capability enforcement covers the members that exist.** `slot:*`, `host-ui`, and `background` are gated and tested here. `models`, `credentials`, and `session-state` are accepted by `definePackage` and enforced in Tasks 6 and 7, when those members land. Task 6's and Task 7's capability tests extend `capability_missing_fails_on_call`.
    - **Findings that affect later tasks.**
      - **Task 6:** use `bus.removeOwner(name)` and `slots.remove(name)` as the model for unwinding tools, skills, providers, and commands. The loader's `State.disposers` list is where each registration's undo belongs. `LoadedPackages` is on `AgentRuntime.packages`, so the merged-view accessors sit beside it.
      - **Task 7:** `SessionContext` views are cached per owner in `RuntimeAgentSession.sessionViews`. `close()` already aborts `backgroundAbort`.
      - **Task 8:** `AgentRuntime.packages.packages` gives name, version, description, capabilities, redacted-by-construction config, and `configSources`. `statusNotes()` gives the notes. `slots.ownerOf(slot, assigned)` gives slot owners. `inspect().hooks` must skip `kernel:*#session-` ids.
      - **A hook registered by a package that throws in `setup`** is removed by `removeOwner`, but a `hook.error` emitted during `setup` has no session sink. It reaches hook handlers only.
      - **Real packages need a kernel range that admits 0.12.1** (for example `^0.12.1 || ^0.13.0-0`), as A5 records.
    - **Baseline diff** (`bun run build:core`, then `node scripts/release.mjs gate --update-baseline`): additions only. They are the new root exports (`definePackage`, `UnknownSlotOwnerError`, and the type names `Capability`, `Logger`, `PackageAPI`, `PackageDefinition`, `PackageDefinitionInput`, `PackageInput`, `PackageInstance`, `PackageInstanceOptions`, `PackageRequires`, `SessionContext`, `SlotRegistrar`, `SlotRegistrarEntry`), plus the internal declarations the baseline also lists (`loadPackages`, `parseRange`, `satisfies`, `parseVersion`, `isValidVersion`, `compareVersions`, `normalizePackageInput`, `requireCapability`, `isCapability`, `CAPABILITIES`, `assertJsonSchemaSupported`, `assignedLoop`, `createAgentWith`, `SLOT_NAMES`, and `KERNEL_VERSION`). Eight pre-existing re-export lines changed text only, because `UnknownSlotOwnerError` joined the slots re-export and the package types joined the packages barrel. Nothing was removed. `src/__tests__/public-export-contract.test.ts` adds the 14 root names.
    - **Tests written** (`src/__tests__/package-loader.test.ts`, 23 pass): every case in the plan list except those that depend on later members, plus `definePackage` validation (14 bad definitions), a 30-row semver table, rejected range forms, `src/version.ts` against `package.json`, and the release bump rewriting `src/version.ts`. `listed_package_is_active_without_wiring` runs the mock provider end to end. `loop_slot_package_runs_end_to_end` runs a package-owned two-phase loop and checks that `tool.call` fired for both calls and the deny blocked one. `session_context_is_owner_bound` runs through a real session. The leak checks cover `setup_failed` (message, `JSON.stringify`, stack, and no `cause`), status notes, events, and logs.
    - **Sweep.** `rg 'slots\?*\.(loop|compaction|credentials)' src` shows no other direct reader of `AgentConfig.slots`. `rg 'from "@arnilo/prism-' src/packages` finds nothing.
    - **Evidence.**
      - `bun run typecheck` exits 0 (root, all workspaces, and `tsc -p examples`), and `node scripts/release.mjs gate` reports `updated: false` after the baseline update.
      - `bun test src` leaves the failures Task 3 and Task 4 recorded (`prism init`, `host-composition-compat`, the agent-sdk peer check, the field-policy timing benchmark, and the three ACP/bin spawn tests). No hook, run-state, slot, or session test regressed. I did not run a before/after comparison.
      - `biome lint` has no errors on the new files, and 10 warnings, nine of them `noCommaOperator` in test arrow functions.

- [x] Task 6: Contribution registrars, services, commands, and `disable`
  - Acceptance Criteria:
    - Functional: `tools.register(tool, { when? })`:
      - A name collision with another package, the host's `AgentConfig.tools`, or a reserved kernel-generated name (`load_skill`, `search_tools`) gives `tool_conflict`. The kernel registers no tool itself (Task 1(h)), so the reservation is what stops a package from shadowing one.
      - `when(session)` is evaluated per turn at the per-turn narrowing in `src/agent-session/session/assemble.ts:411-426`, which already feeds `ctx.turnAllow` and `dispatchFilter` (`tool-round.ts:362-369`). That is a single path for the default and custom loops. A hidden tool is not callable unless `allowHiddenToolCalls` is set. A throwing predicate hides the tool (fail closed).
      - Package tools merge with `AgentConfig.tools` into an agent-owned registry on `AgentRuntime`. Every direct read of `agent.config.tools` / `skills` goes through it (Task 1 A2): `assemble.ts:267`, `src/agent-tool-dispatch.ts:72`, `src/agent-approval.ts:165`, `src/run-bundle.ts:93-94`, `src/agent-run-state.ts:173-174`, and `src/agent-session/session.ts:766`. `agent.config` stays the host's original input. A host-supplied registry is never mutated, because its `unregister` is optional (`src/contracts-protocol.ts:524`).
    - Functional: `skills.register(skill)` adds a skill, and a name collision gives `skill_conflict`. `SkillRegistry` gains `unregister` for `disable.skills` and unwind (`src/skills.ts:12-35` has none). `skills.addDir(path)` records the path, and the loader reads it after `setup` through `loadSkillDirectory` (`src/node/contribution-discovery.ts:167`) via an injected reader and a dynamic import made only when a package called `addDir` (Task 1(i)).
    - Functional: `providers.register(provider)` adds an `AIProvider` that the agent's model resolution can select by `provider` id. The runtime list is consulted at `src/agent-session/session.ts:760`, after a direct `AgentConfig.provider` and the run's and agent's `providerSource`. A duplicate id gives `provider_conflict`.
    - Functional: Commands work as follows:
      - `commands.register({ name, description, args?, run(args, ctx) })` takes the new `PackageCommand` type (below) and fails closed on a name collision with `command_conflict`.
      - `agent.commands.list()` returns `{ name, description, package }`.
      - `agent.commands.run(name, args, { session })` validates `args` against the command's schema (Task 4 validator) and passes `ctx = { session, host, agent }`.
      - An unknown command throws `PackageLoadError` `unknown_command`.
    - Functional: Services work as follows (**delivered in Task 5**, because `requires.services` and `missing_service` cannot be tested without `provide`; Task 6 only adds the tests for the registry's own cases that Task 5 did not pin):
      - `services.provide(name, impl)`: a duplicate gives `service_conflict`.
      - `services.consume(name)` returns `undefined` when absent.
      - `services.require(name)` throws `missing_service`.
      - Services are visible to packages that load later, and to earlier packages at call time, not at setup.
    - Functional: `models.client(ref?)` and `credentials.resolve(ref)` ship behind the Task 5 capability checks, implemented per Task 1(g). `credentials.resolve` returns the existing `Credential` (the roadmap's `Secret` name is deferred to Phase 5), and each resolved value joins the runtime secret set that redacts events, errors, and `inspect()`.
    - Functional: `disable: { tools, hooks, commands, skills }` removes contributions by id after all setups and before the agent is built. An unknown id gives `unknown_disable_id`. A disabled hook never fires, and a disabled tool is neither advertised nor callable.
    - Functional: Task 1(f) decided that `PackageCommand` (`{ name, description, args?: JsonSchema, run(args, ctx: { session, host, agent }) }`) is a new type. `CommandDefinition` (`src/contracts-core/agent.ts:208`) is left as it is: its ~20 production callers, `src/rpc.ts:233` dispatch included, migrate in Part B Task 3, and Part B Task 1 decides whether `rpc.ts` moves onto `agent.commands` or keeps `CommandDefinition` for now. Reshaping it in place here would break those callers for no Part A benefit.
    - Performance: `when` predicates run once per turn per registered tool. A docs note says predicates must be synchronous and cheap.
    - Code Quality: There is one registry per contribution kind, owned by the agent runtime. Packages never receive the registry objects, only owner-bound registrars.
    - Security:
      - `disable` runs after `setup`, so a package cannot re-add a disabled contribution.
      - A command's `ctx.host` carries the same `host-ui` capability check as `PackageAPI.host`.
      - A `credentials.resolve` result never appears in events, inspect output, or logs, and a test asserts this.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 (`PackageAPI`, Commands, Tools), §2.3 (`disable`, `agent.commands`), §2.11 (host hooks example with `disable`)
      - `src/tools.ts:151` (`createToolRegistry`) and `src/loop/run-controller.ts` (turn tool list)
      - Task 1 findings (f) through (i)
    - Options Considered:
      - Implement `disable` as a filter at dispatch. Rejected: that leaves disabled hooks registered and visible in `inspect()` as active, and adds per-dispatch cost.
      - Reuse `ContributionRegistries`. Rejected: Part B deletes it, and its duplicate default is `"replace"`, not fail-closed.
    - Chosen Approach:
      - Give each owner-bound registrar an undo list (for dispose) and a post-setup `disable` pass that calls the same removal path.
    - API Notes and Examples:
      ```ts
      prism.tools.register(recallTool, { when: (s) => om.get(s).enabled });
      prism.commands.register({ name: "om", description: "Toggle observational memory", run: (_, ctx) => toggle(ctx.session) });
      prism.services.provide("web.fetch", fetcher);
      await createAgent({ model, packages, disable: { tools: ["shell"], hooks: ["@acme/audit:tool.completed"] } });
      ```
    - Files to Create/Edit:
      - `src/packages/api.ts`, `src/packages/registrars.ts`: new.
      - `src/agent-session/session/assemble.ts`: `when` evaluation at the per-turn narrowing (`:411-426`) and the merged tool read (`:267`).
      - `src/agent-session/runtime-registry.ts`: merged tools, skills, commands, and providers on `AgentRuntime`. `src/agent-tool-dispatch.ts`, `src/agent-approval.ts`, `src/run-bundle.ts`, `src/agent-run-state.ts`, `src/agent-session/session.ts`: route their reads through it.
      - `src/skills.ts`: `unregister`. `src/contracts-core/agent.ts`: `SkillRegistry.unregister`, `PackageCommand`, `AgentConfig.disable`, and `Agent.commands`.
      - `src/agent-session/create-agent.ts`
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate. `CommandDefinition` is unchanged, so no workspace baseline moves for it.
      - `src/__tests__/public-export-contract.test.ts`
      - `docs/next/packages.md`: registrars, services, commands, `disable`, and the cost note for `when`.
      - `CHANGELOG.md`
    - References:
      - `src/extensions.ts:139-195`, the 0.12 registrar set being replaced
  - Test Cases to Write:
    - `tool_collision_fails_closed`: package vs. package, package vs. host, and package vs. each reserved name (`load_skill`, `search_tools`).
    - `skill_and_provider_conflicts_fail_closed`: `skill_conflict` and `provider_conflict` each fail on a duplicate. `disable.skills` removes a package skill through `unregister`.
    - `package_tools_reach_every_reader`: a package tool is visible to dispatch, approval, run-bundle, and the run-state fingerprint, not only to the turn tool list. It fails if one of the six direct `config.tools` reads is missed.
    - `when_hides_tool_per_session`: the tool is advertised in session A and absent and uncallable in session B. It is checked from the default loop and from a custom loop.
    - `command_args_validated_and_ctx_wired`: invalid args fail before `run`, an unknown name gives `unknown_command`, and `ctx.host` enforces `host-ui`.
    - `services_require_and_conflict`
    - `disable_removes_by_id_and_rejects_unknown_ids`: one case per kind.
    - `credentials_never_surface`: a resolved secret is absent from events, `inspect()`, and errors.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes
    - Docs pages to create/edit:
      - `docs/next/packages.md`: the sections above.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.**
      - **Registrars (`src/packages/loader.ts`, `api.ts`).** `PackageAPI` gains `tools.register(tool, { when? })`, `skills.register` / `addDir`, `providers.register`, `commands.register`, `models.client`, and `credentials.resolve`. The loader keeps one contribution map per kind (`createToolRegistry` and `createSkillRegistry` with `duplicate: "error"` for tools and skills, plain maps for providers and commands). Each package's `teardown` removes its tools, skills, providers, and commands, so a failed load, an `optional` skip, and `dispose` all unwind them. Packages never see a registry object.
      - **New codes** on `PackageLoadErrorCode`: `tool_conflict`, `skill_conflict`, `provider_conflict`, `command_conflict`, `unknown_command`, `command_args_invalid`, and `unknown_disable_id`. A malformed command (a name with whitespace, no `run`) is a plain `TypeError`, so it surfaces as `setup_failed`. A command `args` schema outside the subset fails at registration with `config_schema_unsupported`.
      - **Merged views (A2).** `agentToolList`, `agentSkillSource`, `packagesAffectTools`, and `toolOwner` live in `src/agent-session/runtime-registry.ts`. `activeTools` now takes the `Agent`. All six reads moved: `assemble.ts`, `agent-tool-dispatch.ts`, `agent-approval.ts`, `run-bundle.ts`, `agent-run-state.ts`, and `session.ts` (`resolveRunSkills`). `agent.config` is untouched. When nothing merges, `activeTools` hands back the host's own registry, so every existing run is byte-identical.
      - **`when` and the tool context.** `hiddenPackageTools` in `assemble.ts` runs at the per-turn narrowing, before the `RunOptions.tools` clamp, and sets `ctx.turnAllow`, which `dispatchFilter` already enforces. `bindDispatchToolCall` adds `context.session` bound to the tool's owning package (this closes the Task 5 deviation).
      - **Providers.** `resolveRunProvider` consults the package provider list after `config.provider`, the run's `providerSource`, and the agent's `providerSource`.
      - **Commands.** `Agent.commands` (`list`, `run`) is built in `createAgent`; `LoadedPackages.runCommand` validates args with `validateJsonSchema` (no schema means `{ type: "object" }`, so no arguments) and builds `ctx = { session, host, agent }`. `PackageCommand` is a new type, and `CommandDefinition` is unchanged (finding f).
      - **`disable`.** `applyDisable` runs after slot resolution and before the agent is built. Tool and skill ids may name a package's or the host's; a host tool is filtered from every view and its registry is never mutated. Hook ids go through `bus.remove`. Anything unknown fails the load with `unknown_disable_id` and unwinds. A non-array or empty-string id is a `TypeError` (`setup`-independent, raised at load).
      - **Credentials.** `credentials.resolve` resolves through `slots.resolve("credentials", assignments.credentials)`. The value joins a `secrets` array shared with the hook bus and the loader's `redact`, and `AgentSession.runRedactor()` wraps the host redactor with it for any agent where a loaded package declares `credentials` (`LoadedPackages.redactor`).
      - **`skills.addDir`.** The loader reads the recorded paths right after that package's `setup` returns, through an injected `readSkillDir`. `createAgent` passes a function that does `await import("../node/contribution-discovery.js")` only when a package called `addDir`, so the root's static import graph is unchanged. A read failure is `setup_failed`, redacted, and an `optional` package is skipped.
      - **`SkillRegistry.unregister` is optional** (`unregister?`), like `ToolRegistry.unregister`, so host-supplied registries still type-check. `createSkillRegistry` implements it.
      - **`Agent.commands` is required.** Three hand-built `Agent` literals in tests needed it (`contributions`, `extensions`, `public-contracts`).
    - **Decisions inside the plan's choices.**
      - **Skill shape follows the host.** An array of host skills stays an array and so package skills are active, while a host `SkillRegistry` stays a registry and skills activate on demand. With no host skills the result is an array. The plan did not say; this keeps `resolveRunSkills` unchanged in meaning for each existing shape.
      - **`hostFor` also fixes a Task 5 gap.** Task 5's `host.ui.request` stamped `package` but not `sessionId`, so a package could pass its own `sessionId`. The new `hostFor(owner, sessionId?)` always overrides it (with `undefined` at setup), and a command's `ctx.host` stamps the real session id. `command_args_validated_and_ctx_wired` pins both.
      - **A host registry that grows a colliding name after load** fails closed at the merge (`tool_conflict` / `skill_conflict` from `agentToolList` / `agentSkillSource`) instead of letting one replace the other.
      - **A falsy `when` result hides the tool**, not only a throw. Docs say predicates return a boolean.
    - **Deviations from the plan text.**
      - **Services were already delivered in Task 5**; Task 6 added `services_require_and_conflict` for the registry's own cases (including `requires.services` and a call-time `require` from an earlier package).
      - **`credentials.resolve` takes `string | CredentialRequest`**, since a bare ref string is the common call. It returns `Credential | undefined`.
      - **`models.client`'s `generate` takes a request without `model`** (`Omit<ProviderRequest, "model">`); the model comes from `ref` or `AgentConfig.model`. It resolves the provider on first `generate`, so a package provider loaded later is visible.
      - **The `inspect()` leg of `credentials_never_surface` belongs to Task 8.** The test covers events, status notes, logs, a hook error, load errors, and the `packages` listing that Task 8 builds on (`runtime.packages.packages`).
    - **Findings that affect later tasks.**
      - **Task 7:** the `background.*`, `session.*`, and `package.status` events can reuse `LoadedPackages.redactor` and the loader's `redact` for agent-scoped dispatch (A3). `AgentSession.runRedactor()` is the one place that composes the redactor for a run. State writes between runs should use `agent.config.redactor` wrapped the same way.
      - **Task 8:** `inspect()` reads `packages.tools()` (owner and tool), `packages.skills()`, `packages.commands()`, `packages.disabled`, and the existing `packages.packages` / `statusNotes()`. Host tools are not tracked per owner; list them from `agent.config.tools` minus `packages.disabled.tools`. Hook listing must still skip `kernel:*#session-`.
      - **Consumers that still read `agent.config.tools` / `skills` directly** are 0.12 host code that Part B moves: `packages/prism-code/src/tui/index.ts:545`, `tui/commands.ts:338,908` (display only), and `packages/prism-core/src/governance/evals/scenarios.ts:281` (`wrapTools`, which would not wrap a package tool). Record both in Part B Task 1's caller walk.
      - **`search_tools` and `when` (not tested).** The `search_tools` index is built once per run from the run's tool list, which `when` does not narrow, so with `toolsDisclosure: "search"` a hidden tool can still be found by search. `dispatchFilter` still refuses to run it. Phase 3's `tools.disclosure` can close the gap; no test pins it.
      - **Run-time failures differ from load-time ones.** A tool/skill collision created after load by a growing host registry throws `PackageLoadError` from inside a run (`activeTools`), not at `createAgent`.
    - **Baseline diff** (`bun run build:core`, then `node scripts/release.mjs gate --update-baseline`; the tree is uncommitted, so the file diff against `HEAD` also holds plans 144, 145, and Tasks 2-5, and only the lines below are Task 6's). Additions: `RESERVED_TOOL_NAMES`, `agentToolList`, `agentSkillSource`, `packagesAffectTools`, `toolOwner`, and the re-export line that now lists `ModelClient`, `PackageCommand`, `PackageCommandContext`, `PackageCommandInfo`, and `PackageToolOptions` (plus the `Agent`/`SkillRegistry` interface members, which the baseline does not list). The one change: `activeTools(tools: AgentConfig["tools"])` → `activeTools(agent: Agent)` (internal, not on the root barrel). `node scripts/release.mjs gate` then reports `updated: false`.
    - **Tests written** (`src/__tests__/package-contributions.test.ts`, 16 pass): `tool_collision_fails_closed` (package vs package, host array, host registry, both reserved names, and the unwind of an earlier package), `package_tools_reach_every_reader` (`activeTools`, the run bundle, the fingerprint, a real dispatch, and `agent.config` untouched), `package_tool_unwinds_with_its_package`, `when_hides_tool_per_session` (default loop, a custom loop, and a throwing predicate), `package_tool_context_carries_an_owner_bound_session`, `skill_and_provider_conflicts_fail_closed`, `disable_skills_removes_package_and_host_skills` (a host registry's `unregister` is never called), `skills_addDir_reads_after_setup_through_the_injected_reader` (including the redacted failure and the `optional` skip), `package_provider_serves_runs_and_models_client` (a direct provider still wins, and `models` is enforced), `command_args_validated_and_ctx_wired`, `command_collision_fails_closed`, `services_require_and_conflict`, `disable_removes_by_id_and_rejects_unknown_ids` (all four kinds, a bounded message, and the unwind), `disable_runs_after_setup_so_a_package_cannot_re_add`, `credentials_never_surface`, and `credentials_resolve_needs_the_capability`.
    - **Sweep.** `rg 'config\.(tools|skills)\b' src packages` leaves only the readers recorded above (0.12 host code) and the merged-view helpers themselves. `rg 'from "@arnilo/prism-' src/packages src/agent-session/runtime-registry.ts` finds no package import.
    - **Evidence.**
      - `bun run typecheck` exits 0 (root, all workspaces, and `tsc -p examples`), and `node scripts/release.mjs gate` reports `updated: false`.
      - `bun test src/__tests__/package-contributions.test.ts src/__tests__/package-loader.test.ts src/__tests__/public-export-contract.test.ts` pass (273 tests).
      - `bun test src` leaves only the failures that earlier Notes recorded (`prism init`, the field-policy timing benchmark, `host-composition-compat`, the agent-sdk peer check, and the ACP/bin spawn tests). `bun test packages/agent-sdk packages/prism-core/src/governance packages/prism-core/src/runtime/supervisor packages/hooks` passes (536 tests). I did not run a before/after comparison on the full suite.
      - `biome lint` reports no new errors on the files this task changed; the remaining warnings in `assemble.ts`, `provider-round.ts`, and `session.ts` were there before.

- [x] Task 7: Session state, background tasks, and session lifecycle events
  - Acceptance Criteria:
    - Functional: `state.session(key, initial)` returns `SessionState<T>` with `get(session)` and `set(session, value)`:
      - Each `set` appends one `package_state` entry (`{ package, key, value }`, JSON-only) on the current branch, using the kind that Task 1(d) decided.
      - Reopening a session by id restores the latest value per `(package, key)` on the branch.
      - `fork()` and `clone()` carry the branch, so the state comes with them.
      - A non-JSON value throws `PackageLoadError` `state_not_json`.
    - Functional: `state.agent(key, initial)` is process memory for the agent's lifetime and is cleared on `dispose`.
    - Functional: `SessionContext.background(name, task)` behaves as follows (Task 5 delivered the owner-bound view, the capability check, and a minimal runner that tracks the task and aborts it on `close()`; Task 7 replaces the runner with the tracker below):
      - It tracks the promise and emits `background.started`, then `background.completed` or `background.failed`, with an error redacted.
      - `session.close()` awaits tracked tasks up to `limits.backgroundSettleMs` (default 5,000), then aborts the rest through the task's `AbortSignal` and emits `background.failed` with reason `aborted`.
    - Functional: `session.opened` fires once the session has read its branch (a session is constructed synchronously and reads nothing, so "created or reopened" means: before its first run, command, or `close()`), and `session.closed` fires at the end of `close()`. Both are `AgentEvent` types, and therefore observe hooks. They are delivered to hooks only, not to session subscribers, so an existing `stream()` still starts with `agent_started`. A session that no package or `session.opened` handler cares about reads nothing and fires nothing (executed: this keeps every existing session at zero extra store reads).
    - Functional: `package.status` fires on every `status.note`.
    - Functional: The hook catalog freeze test and `docs/next/hooks.md` are updated deliberately in this task, along with every `Record<AgentEventPayload["type"], …>` table (`src/hooks/catalog.ts:8`, and the event-source conformance if it enumerates types).
    - Functional: Every store accepts the new entry kind: the memory store, the kernel JSONL store (`src/node/session-store-jsonl.ts`, which gates on `SESSION_ENTRY_KINDS`), and prism-core SQLite and Postgres. No SQL `CHECK` exists on `kind` (`src/testing/persistence-schema.ts:210`), so no DDL changes. One new step in `src/testing/session-store-conformance.ts` (after step 7, `:112-129`) round-trips a `package_state` entry and so covers all four. `packages/memory` has no session store.
    - Functional: Package state is hydrated by a memoised `session.ready` (Task 1(e), A4). It reads the branch once through `entries()`. It is awaited at run start (beside `assemble.ts:266`), at `checkout` (`session.ts:706`), at resume, and in `agent.commands.run`. `session.opened` fires after it. A synchronous `get` before hydration throws `state_not_ready` rather than returning `initial`.
    - Functional: `set` rejects a value over 64 KiB with `state_too_large`, so a package cannot grow a store without bound.
    - Functional: The session serializes its appends (executed addition, see Notes). A `set` from a hook or background task can overlap a run's own append, `expectedParentId` is existence-validation and not a tip check (`src/testing/session-store-conformance.ts:78`), and two appends from one tip silently orphan one entry.
    - Functional: The two session-pack hooks registered on the shared bus (`session.ts:299-316`) are removed on `close()` through `bus.remove` (Task 3).
    - Performance:
      - Each `set` costs one store append. The docs state this, and the default is no state, so a package that never calls `set` adds no writes.
      - `close()` waits at most `backgroundSettleMs`.
    - Code Quality: State and background live in `src/session/` (new kernel module, §2.2). The session class gains only the hook points.
    - Security:
      - `package_state` values are redacted with `agent.config.redactor` before persistence. They cannot use `activeRedactor`, which is undefined between runs (`session.ts:574-601,995`), so a `set` from a command between runs would otherwise persist unredacted.
      - A test stores a value containing a configured secret, both during a run and between runs, and asserts that the persisted entry is redacted.
      - Background errors are redacted, and agent-scoped `background.*` and `session.closed` events use the same direct redactor.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 (`state`, `SessionContext.background`), §2.1 (Store entry types), Phase 2 "Session state and background work", and §2.3 Events
      - `src/agent-session/session.ts:611` (`close`), `:712` (`fork`), `:723` (`clone`)
      - `src/contracts-core/session.ts:7-30`
      - backlog "Add session-lifecycle hooks if Phase 2 needs them"
      - Task 1 findings (d), (e), and (j)
    - Options Considered:
      - Keep state in agent memory only and snapshot it on close. Rejected: it does not survive a crash or a new process, and §2.6 says "persisted as package-state entries".
      - Use one entry per session holding all package state. Rejected: it rewrites unrelated packages' state on every `set`, and fork semantics need per-branch history.
      - An unbounded `close()` wait. Rejected: Phase 2 scope names "a bounded timeout, then aborted".
    - Chosen Approach:
      - Make state append-only per branch, read from the branch walk the session already does (`readBranchPath`). Background tracking hangs off the session with a `Set<Promise>` plus `AbortController`s.
    - API Notes and Examples:
      ```ts
      const om = prism.state.session("om", { enabled: false });
      prism.hooks.on("turn_finished", (e) => e.session.background("om.observe", (signal) => observe(signal)));
      ```
    - Files to Create/Edit:
      - `src/session/state.ts`, `src/session/background.ts`: new.
      - `src/agent-session/session.ts`: open, close, and fork hook points.
      - `src/contracts-core/session.ts:7-28`: new entry kind in the type and `SESSION_ENTRY_KINDS`.
      - `src/contracts-protocol.ts` (`AgentEventPayload`, `:433-452`): the six new events.
      - `src/contracts-core/run-limits.ts` and `src/run-limits.ts`: `backgroundSettleMs`, agent-wide, resolved by `resolveBackgroundSettleMs` and kept out of `RunLimitName` and `ResolvedRunLimits` (it is not a counter axis or a per-run axis).
      - `src/hooks/catalog.ts:8`, `src/__tests__/hook-catalog-freeze.test.ts:34-69,97` (append the six names, in order)
      - `src/testing/session-store-conformance.ts`: the `package_state` step. `src/__tests__/node-session-store-jsonl.test.ts:317`: the pinned kind array.
      - No store implementation changes (Task 1(d)): `src/session-stores.ts`, `src/node/session-store-jsonl.ts`, and `packages/prism-core/src/sessions/**` already round-trip an unknown-to-them kind once it is in `SESSION_ENTRY_KINDS`.
      - `scripts/compat-baseline/arnilo__prism.txt` and affected workspace baselines: regenerate.
      - `docs/next/hooks.md`: new observe hooks. `docs/next/packages.md`: state, background, and the cost note.
      - `CHANGELOG.md`
    - References:
      - plan 144 Task 5 (suspension persisted through the store slot), the precedent for a new kernel entry kind
  - Test Cases to Write:
    - `session_state_survives_fork_and_resume`: set state, fork, set a different value on the fork, then reopen the original by id from a fresh agent on the same store. Each branch sees its own value. This is a roadmap Done criterion.
    - `state_rejects_non_json`
    - `state_is_redacted_before_persistence`
    - `close_settles_background_within_bound_then_aborts`: one fast task completes, and one hanging task is aborted after `backgroundSettleMs`, emitting `background.failed` with reason `aborted`.
    - `session_opened_and_closed_fire_as_observe_hooks`: fired from the default loop and from a custom loop.
    - `stores_round_trip_package_state`: the new conformance step runs against the memory store, the kernel JSONL store, and prism-core SQLite. Postgres is covered under the existing Postgres gate.
    - `state_requires_hydration_and_rejects_oversize`: a synchronous `get` before `ready` throws `state_not_ready`, and a value over 64 KiB throws `state_too_large`. It fails if `get` returns `initial` early.
    - `state_write_racing_a_run_append_keeps_one_branch` (added): a slow store keeps appends in flight while an observer writes state, and no entry may end up with two children. It fails if `appendEntry` is not serialized.
    - `package_status_fires_on_every_note`, `session_state_needs_its_capability`, `agent_state_is_process_memory_and_reset_on_dispose`, and `close_returns_at_once_when_nothing_runs_and_a_zero_bound_aborts_immediately` (added).
    - `package_state_does_not_enter_the_message_view`: `rebuildSessionContext` returns the same messages with and without `package_state` entries. The docs cost note states that each entry counts toward compaction entry thresholds.
    - `session_pack_hooks_removed_on_close`: after `close()`, the session's `#session-` registrations are gone from `bus.registrations()`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new events, entry kind, `SessionContext.background`, and `limits.backgroundSettleMs`.
    - Docs pages to create/edit:
      - `docs/next/hooks.md`: catalog rows.
      - `docs/next/packages.md`: "Session state and background work", with the write-cost note.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.**
      - **Entry kind.** `package_state` joins `SessionEntryKind` and `SESSION_ENTRY_KINDS` (`src/contracts-core/session.ts`). `data` is `{ schemaVersion: 1, package, key, value }`. The kernel JSONL reader validates it as an object, like `custom` (`src/node/session-store-jsonl.ts`). No other store changed, as Task 1(d) predicted: the memory store and the prism-core SQLite and Postgres stores round-trip it, and the SQLite conformance run in `packages/prism-core` passes with the new step.
      - **Events.** `AgentEventPayload` gains `session.opened`, `session.closed`, `package.status`, `background.started`, `background.completed`, and `background.failed` (`src/contracts-protocol.ts`). Each carries `runId: ""` (not run-scoped), the same convention as an agent-scoped `package.event`. `OBSERVE_HOOKS` lists them, the freeze test appends them in order, and the exhaustive `Record<AgentEventType, boolean>` in `agent-event-source.test.ts` classifies them non-terminal.
      - **`src/session/state.ts`.** `SessionStateStore` is the per-session store: `hydrate(branch)` keeps the latest value per `(package, key)` (a malformed entry is skipped), `read` throws `state_not_ready` before hydration, and `write` validates JSON (`toJsonValue`, which also clones), redacts, bounds to 64 KiB, awaits `ready`, appends, and only then updates the held value. `createSessionState` / `createAgentState` build the package-facing handles. A `WeakMap<SessionContext, SessionStateStore>` (`bindSessionState`) lets a handle find its session's store from the view the kernel passed, so `SessionContext` gained no public member. Values are deep-frozen.
      - **`src/session/background.ts`.** `createBackgroundTracker`: per-task `AbortController`, `background.started`, then exactly one `completed` or `failed` per task (a `done` flag stops an aborted task that later rejects from being reported twice). `settle(ms)` races the pending tasks against a timer, then aborts and reports `aborted` for whatever is left, so a task that ignores its signal cannot hold `close()`. `start` throws once `settle` has begun.
      - **Loader.** `PackageAPI.state.session` / `state.agent`; `session` needs `session-state` (the capability is now enforced, completing the Task 5 deviation) and a key is declared once per kind. `LoadedPackages.usesSessionState` records whether any package declared session state. `status.note` now also fires `package.status` through `bus.observe` (redacted, agent-scoped).
      - **Session.** `ready()` (memoised; cleared on failure so a transient store error is retryable) reads the branch via `entries()`, hydrates, and fires `session.opened`. It is awaited at run start (which covers `resumeDurable`, since both go through `runInternal`), in `agent.commands.run`, by `set`, and by `close()`. `checkout()` re-hydrates. `close()` is memoised and does: `ready` (errors swallowed), `settle(backgroundSettleMs)`, removal of the two session-pack hooks (`packHookIds`, full ids), `session.closed`, then `closeSubscribers()`, in a `finally`.
      - **`limits.backgroundSettleMs`.** Added to `RunLimits` and validated (non-negative safe integer) by `resolveBackgroundSettleMs`, which `validateLimits` also calls. It is excluded from `RunLimitName`, so no counter table changed.
      - **Conformance.** `assertSessionStoreConforms` gains step 8, a `package_state` round-trip (kind, `package`, `key`, and a nested value). The pinned kind array in `node-session-store-jsonl.test.ts` is updated.
    - **Deviations from the plan text, and why.**
      - **`session.opened` fires lazily, not at construction.** `createSession` is synchronous and reading the branch is async (Task 1(e)), so "created or reopened" became "before the first run, command, or `close()`". An eager read at construction would also change store traffic for every existing session.
      - **A session that needs nothing reads nothing.** `ready()` returns without a store read unless some loaded package declared session state or a `session.opened` handler is registered (`needsOpening`). `runInternal` also skips the `await` in that case. My first version awaited unconditionally, and `agent-run-state.test.ts` "aborts before claiming and closes an overflowing resume subscriber" failed because the run started one microtask later than that test's overflow timing assumed. The conditional await restores the original timing for every session that does not use these features.
      - **`session.opened` and `session.closed` reach hooks only, not subscribers.** Delivering them to subscribers would put `session.opened` in front of `agent_started` on every `stream()`. The other four events do reach subscribers.
      - **`appendEntry` is now serialized, which the plan did not list.** A test with a slow store showed that a state `set` racing the run's own append orphans one entry (no CAS failure, because `expectedParentId` only checks existence). All appends now run through one promise chain, and an entry created for the tip it saw is rebased onto the tip it lands on. A mutation check confirmed the new test fails without it. This touches the central append path for every entry kind, so it is the part of this task most worth a second look.
      - **The stored state value is the redacted one.** `set` redacts before persisting and keeps the redacted value in memory, so a value reads the same before and after a reopen.
      - **`session.close()` is no longer instant.** It awaits `ready()` and `settle()`. For a session with no tasks and nothing to open both resolve at once.
    - **Findings that affect later tasks.**
      - **Task 8:** `inspect().hooks` must still skip `#session-` ids, and after `close()` those ids no longer linger on the bus, so the count of listed hooks no longer grows with sessions. `LoadedPackages.usesSessionState` and the new `package.status` events are available, and the status-note list is unchanged (the event is fired in addition to recording it).
      - **Task 9:** `examples/define-package.ts` can show `state.session` plus `session.background` on the mock provider with no new seam. It must await `session.close()` before the process exits if it starts a task.
      - **Part B Task 5 (`hooks-json`):** `session.opened` fires only when some handler is registered, so a package that registers one gets the branch read for free. Its handler runs after hydration and before the first run.
      - **Package state outside a session view.** `SessionState.get` / `set` accept only a `SessionContext` the kernel handed out (hook context, tool context, `when`, or a command), and a forged object throws `TypeError`. A package cannot read another package's state without holding its `SessionState` handle, since state is namespaced by the declaring package.
      - **A `set` during a run racing a hook that is mid-append** is now ordered, but `SessionState.get` in a background task returns the in-memory value, which is updated only after the append succeeds. A failed append leaves the old value.
      - **Not covered here:** the Postgres leg of `stores_round_trip_package_state` needs a Postgres URL (`bun run test:postgres`) and was not run. The SQLite and memory legs and the JSONL store are covered (the SQLite one through the existing `runSessionStoreConformance` call).
    - **Baseline diff** (`bun run build:core`, then `node scripts/release.mjs gate --update-baseline`; the tree is uncommitted, so the file diff against `HEAD` also holds earlier tasks, and only these lines are Task 7's). All additions to `arnilo__prism.txt`: `AgentState` and `SessionState` (type re-exports), `SessionStateStore`, `bindSessionState`, `createSessionState`, `createAgentState`, `MAX_STATE_VALUE_BYTES`, `createBackgroundTracker`, `DEFAULT_BACKGROUND_SETTLE_MS`, and `resolveBackgroundSettleMs`. Nothing removed. The `AgentEventPayload` union and `SESSION_ENTRY_KINDS` are not listed in the baseline's declaration form. `node scripts/release.mjs gate` then reports `updated: false`. `src/__tests__/public-export-contract.test.ts` adds `SessionState` and `AgentState`.
    - **Sweep.** `rg 'maxContinuations' src` shows no other exhaustive limit table that needed `backgroundSettleMs`. `rg 'Record<AgentEventPayload|Record<AgentEventType' src packages` found exactly two tables (the catalog and `agent-event-source.test.ts`). The one structural consumer that broke on the new `package.status.message: string` was `messageOf` in `packages/prism-core/src/governance/evals/curate.ts` (it declared an ad-hoc `{ message?: Message }` shape). It now takes `AgentEventRecord`, which narrows by `type`. Any other package with an ad-hoc event shape that reads `.message` would break the same way; `bun run typecheck` found no other.
    - **Tests written** (`src/__tests__/session-state-background.test.ts`, 14 pass): `session_state_survives_fork_and_resume` (also `clone()` and `checkout()`), `state_rejects_non_json` (five bad values and a bad initial value, nothing persisted), `state_requires_hydration_and_rejects_oversize`, `state_is_redacted_before_persistence` (during a run and between runs), `package_state_does_not_enter_the_message_view` (also asserts the branch stays linear), `state_write_racing_a_run_append_keeps_one_branch`, `session_state_needs_its_capability`, `agent_state_is_process_memory_and_reset_on_dispose`, `session_opened_and_closed_fire_as_observe_hooks` (default and custom loop, `restored` true and false, and `agent_started` still first on the stream), `package_status_fires_on_every_note`, `session_pack_hooks_removed_on_close`, `close_settles_background_within_bound_then_aborts` (fast, hanging, signal-ignoring, and throwing tasks; error redaction; the `package` field; a closed session refuses new tasks), `close_returns_at_once_when_nothing_runs_and_a_zero_bound_aborts_immediately`, and `stores_round_trip_package_state` (memory and kernel JSONL).
    - **Docs.** `docs/next/hooks.md` gains "Session, status, and background events". `docs/next/packages.md` gains "Session state and background work", the `session-state` capability row, and the three new error codes. `CHANGELOG.md` has an Added entry. The backlog item "Add session-lifecycle hooks if Phase 2 needs them" is marked delivered.
    - **Evidence.**
      - `bun run typecheck` exits 0 (root, all workspaces, and `tsc -p examples`), and `node scripts/release.mjs gate` reports `updated: false`.
      - `bun test src` leaves only the failures that earlier Notes recorded (`prism init`, the field-policy timing benchmark, `host-composition-compat`, the agent-sdk peer check, and the ACP/bin spawn tests). `bun test packages/agent-sdk packages/prism-core packages/memory packages/hooks packages/ag-ui packages/prism-channels` has one failure, `names the Bun runtime when the sqlite modules are imported under node`, an import-error-message assertion under Node that does not touch this change (I did not run a before/after comparison). 3,405 pass.
      - `biome lint` on the files this task changed reports no new warning (the two left in `session.ts` were there before).
      - **An accidental `git stash` ran once while I was linting** and I popped it at once. The tree, the untracked files, and the previously staged files came back unchanged, and the tests above ran after the pop.

- [x] Task 8: `agent.inspect()`
  - Acceptance Criteria:
    - Functional: `agent.inspect(): AgentInspection` returns:
      - `packages`: `[{ name, version, capabilities, optional, status: "loaded" | "skipped", configSources: { [key]: "default" | "manifest" | "host" }, config }]`. Values of `x-prism-secret` fields are replaced with their ref string, never a resolved value. A literal secret cannot reach this point because Task 4 rejects it.
      - `tools`, `skills`, and `commands`, each with `{ name, package }` (`package` is `host` for the host's own). A top-level `disabled: { tools, skills, commands, hooks }` lists the ids from `AgentConfig.disable`. A `skipped` optional package appears in `packages` with `status: "skipped"` (executed: the loader now records skipped instances).
      - `hooks`: per hook name, registrations in execution order from Task 3's `registrations()`, excluding the per-session `#session-` registrations (`isSessionScopedHookId`, `src/agent-session/runtime-registry.ts:43`).
      - `slots`: per slot, its owner (`kernel` | package name | `host`), from the `SlotRegistry` owner query Task 5 adds. `resolve()` returns only the implementation (`src/slots/registry.ts:31`), so inspect cannot derive the owner from it.
      - `statusNotes`: `[{ package, level, message, at }]`.
    - Functional: The result is a deep-frozen plain JSON object, so `JSON.stringify` round-trips it.
    - Performance: `inspect()` builds from loader records and does no I/O.
    - Code Quality: `src/agent/inspect.ts` (new kernel module per §2.2) holds the `AgentInspection` type, exported from the root.
    - Security: A test configures a package with `apiKey: "env:TEST_KEY"` while `TEST_KEY` is set. The stringified inspection contains the ref and not the env value. Status-note text is redacted, and a configured secret that appears in a non-secret config field is masked by `agent.config.redactor`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (`inspect()` comment), Phase 2 "`agent.inspect()`", and §2.11 (Prism Code shows `inspect()` as `doctor`)
    - Options Considered:
      - A live, mutable view. Rejected: hosts render it, and Phase 12's `doctor` serializes it.
    - Chosen Approach:
      - Build a snapshot from loader records at call time.
    - API Notes and Examples:
      ```ts
      const view = agent.inspect();
      view.hooks["tool.call"]; // [{ id: "@acme/audit:tool.call", owner: "@acme/audit", priority: 0 }, { id: "host:tool.call", … }]
      ```
    - Files to Create/Edit:
      - `src/agent/inspect.ts`: new.
      - `src/agent-session/create-agent.ts`
      - `src/contracts-core/agent.ts`: `Agent.inspect`.
      - `src/index.ts`, `src/__tests__/public-export-contract.test.ts`
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate.
      - `docs/next/packages.md`: "Inspecting an agent".
      - `CHANGELOG.md`
    - References:
      - Tasks 3–7 records
  - Test Cases to Write:
    - `inspect_lists_everything_in_execution_order`: two packages plus host hooks plus `disable`. Every field matches.
    - `inspect_never_contains_secret_values`
    - `inspect_is_json_and_frozen`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes
    - Docs pages to create/edit:
      - `docs/next/packages.md`
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.**
      - **`src/agent/inspect.ts`** (new): `AgentInspection`, `InspectedPackage`, `InspectedContribution`, `InspectedHook`, and `inspectAgent(agent, { config, packages, hooks, slots })`. `createAgent` wires `Agent.inspect` to it, and `Agent.inspect()` is required (three hand-built `Agent` literals in `contributions`, `extensions`, and `public-contracts` tests needed it). The four types are exported from the root.
      - **Loader records.** `LoadedPackage` gains `optional` and `status`, and `LoadedPackages` gains `skippedPackages` (an `optional` instance that failed `setup`) and `skillEntries()` (a skill with the package that registered it, from the existing `skillOwners` map). `LoadedPackages.packages` still lists loaded packages only, so no earlier consumer changed.
      - **Build.** Hooks come from `bus.registrations()` grouped by name, which is already in execution order, minus `isSessionScopedHookId`. Slot owners come from `SlotRegistry.ownerOf(slot, config.slots[slot])` (`kernel`, a package, or `host`). Host tool and skill names come from `agent.config`, minus the `disable` ids. The listing is cloned through `JSON.parse(JSON.stringify(...))`, redacted with `packages.redactor(config.redactor)` (the agent's redactor plus every `credentials.resolve` value), and deep-frozen.
    - **Decisions inside the plan's choices.**
      - **`disabled` lists the ids from `AgentConfig.disable`**, not a computed set. A package-owned tool that was disabled is deleted at load, so only the config still knows it, and an unknown id fails the load (`unknown_disable_id`), so every listed id took effect.
      - **Redaction is the last step, over the whole snapshot.** Config secret fields already hold refs (Task 4 rejects literals), so the redactor is what masks a secret that sits in a non-secret config field or a status note. A mutation check (redaction removed) fails `inspect_never_contains_secret_values`.
      - **The snapshot is not live.** Each call builds a new object, and dispose does not alter an earlier snapshot. After `dispose()` a new call lists no hooks.
    - **Findings that affect later tasks.**
      - **Task 9:** `examples/define-package.ts` can print `agent.inspect()` as its proof that both packages loaded, in execution order, and the example's own check must use the observe hook names the kernel uses today (`tool_execution_finished`, not `tool.completed`). `agent.inspect().hooks` shows them by those names.
      - **Phase 3 / Part B:** `inspect().hooks` keys are today's catalog names, so Phase 3's renames of the 0.12 observe hooks change this output, and Phase 12's `doctor` should read the field names from the type rather than copy them.
      - **Not listed:** the host's own tool and skill names come from `agent.config` at call time, so a registry that grows after `createAgent` shows the new names, while a package's contributions are as loaded.
    - **Baseline diff** (`bun run build:core`, then `node scripts/release.mjs gate --update-baseline`; only these lines are Task 8's): additions only, `AgentInspection`, `InspectedContribution`, `InspectedHook`, and `InspectedPackage` (type re-exports) and `inspectAgent`. `node scripts/release.mjs gate` then reports `updated: false`. `src/__tests__/public-export-contract.test.ts` adds the four type names.
    - **Tests written** (`src/__tests__/agent-inspect.test.ts`, 3 pass): `inspect_lists_everything_in_execution_order` (two packages, a skipped optional one, host hooks, host tools and skills, `disable` for tools and hooks, a package-owned slot and a host-assigned one, status notes, and the absence of `#session-` ids with a live session), `inspect_never_contains_secret_values` (the `env:` ref shown and the env value absent, a secret in a non-secret field masked, and a `credentials.resolve` value masked, which also completes the `inspect()` leg of `credentials_never_surface` that Task 6 left to this task), and `inspect_is_json_and_frozen`.
    - **Sweep.** `rg 'packages\.packages' src packages` shows only tests and `inspect.ts`. `rg 'inspect\(' src/agent-session` finds only the new wiring.
    - **Evidence.**
      - `bun run typecheck` exits 0 (root, all workspaces, and `tsc -p examples`), and `node scripts/release.mjs gate` reports `updated: false`.
      - `bun test src` leaves only the failures that earlier Notes recorded (`prism init`, the field-policy timing benchmark, `host-composition-compat`, the agent-sdk peer check, and the ACP/bin spawn tests). The workspace run (`agent-sdk`, `prism-core`, `memory`, `hooks`, `ag-ui`, `prism-channels`) has the one failure Task 7 recorded (`names the Bun runtime when the sqlite modules are imported under node`) and 3,405 pass. I did not run a before/after comparison.
      - `biome lint` reports nothing on the files this task changed.

- [x] Task 9: Package example and the Part A close
  - Acceptance Criteria:
    - Functional: Both packages declare `requires: { prism: "^0.12.1 || ^0.13.0-0" }`, so they load under the real kernel (`0.12.1`, `package.json:3`; Task 1(c)). `^0.13.0-0` alone would fail `kernel_range`.
    - Functional: `examples/define-package.ts` defines and loads two packages on the mock provider:
      - an audit package: a `tool.call` deny, a `tool_execution_finished` observer, and a `status.note`
      - a counter package: a tool with `when`, a command, session state, and a background task
    - Functional: The example forks a session, reopens it, prints `agent.inspect()`, and disposes. It exits 0 under `examples_demos_run_to_completion_and_emit_no_secret`.
    - Functional: `docs/next/packages.md` is complete in the API page structure, with no transitional wording.
    - Performance: The example finishes in under 2 seconds on the mock provider.
    - Code Quality: The example imports only `@arnilo/prism`. It does not use `@arnilo/prism/testing`, which Part B creates; the mock provider comes from the root as today.
    - Security: The example sets a fake `env:` ref and asserts that the printed inspection does not contain the env value.
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md`, `scripts/e2e-coverage.json`
      - `roadmap.md` §1.4 ("A phase is done when its API has its staged page …, an example")
    - Options Considered:
      - One example per member. Rejected: one runnable story is easier to keep green, and the tests cover each member.
    - Chosen Approach:
      - A single example that exercises every Part A surface.
    - API Notes and Examples:
      ```bash
      bun examples/define-package.ts
      ```
    - Files to Create/Edit:
      - `examples/define-package.ts`: new.
      - `examples/README.md`: line.
      - `scripts/e2e-coverage.json`: entry.
      - `docs/next/packages.md`: final pass.
      - `CHANGELOG.md`
      - `plans/README.md`: status.
    - References:
      - `examples/hooks-json.ts` (style)
  - Test Cases to Write:
    - Covered by the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`) and the e2e coverage check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API.
    - Docs pages to create/edit:
      - `docs/next/packages.md`
      - `examples/README.md`
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **What changed.**
      - **`examples/define-package.ts`** (new, imports only `@arnilo/prism`). `@acme/audit` has a `tool.call` deny for `shell`, a `tool_execution_finished` observer, a `background.completed` observer, and a `status.note`. `@acme/counter` has a config schema (`apiKey` with `x-prism-secret`, `step` integer with a default), a `count` tool with `when` (visible only in the session named `main`), `bump` and `total` commands, `state.session("total", …)`, and a background task started from a `tool_execution_finished` hook that emits a namespaced `package.event`. Both declare `requires.prism: "^0.12.1 || ^0.13.0-0"` and load under the real kernel.
      - **The story.** One run on `main` (the model calls `shell`, which is denied and reaches the model as a `hook_denied` tool result, and `count`, which writes state), one run on `other` (the tool is not advertised there), commands that bump and read the total, a `fork()` that bumps its own copy, a session reopened from the store at the fork's leaf, `close()` (settles the background task), `agent.inspect()`, and `dispose()`. Output: totals `afterTool 1, mainTotal 2, forkTotal 3, reopenedTotal 3`, one `background.completed`, and the loaded packages, tools, hooks, slot owners, and notes from `inspect()`.
      - **Checks inside the demo** (they throw, so the execution gate fails on a regression): the shell denial reached the model, the printed inspection contains `env:DEMO_COUNTER_KEY`, and it does not contain the env value it resolves to.
      - **Registered** in the `examples_demos_run_to_completion_and_emit_no_secret` list (`src/__tests__/docs.test.ts`), `examples/README.md` (run line and description), and `scripts/e2e-coverage.json` (next to `examples/custom-loop.ts`). `node scripts/e2e-coverage-gate.mjs` reports 113/113 surfaces covered.
      - **Docs final pass.** `docs/next/packages.md`: the banner no longer lists parts as "landing with later tasks", the `PackageAPI` table gains the `state` row, "Session context" no longer says "with the tools task", and "Related APIs" links hooks, `agent.commands` / `inspect()` / `dispose()`, and the example. `CHANGELOG.md` has an Added entry. `plans/README.md` marks plan 146 complete.
    - **Decisions inside the plan's choices.** The example's fake env value (`demo-only-env-value-1234`) deliberately does not match the gate's secret regex, so the "no secret" scan stays meaningful for the rest of the output. Hooks are registered by the observe names the kernel uses today (`tool_execution_finished`, `background.completed`).
    - **Evidence.**
      - The demo runs in well under 2 seconds under `bun examples/define-package.ts` and under the compiled-JS path the execution gate uses.
      - Whole-plan verification (below): `bun run build:core` and `bun run typecheck` exit clean; `hook-catalog-freeze`, `kernel-imports-no-package`, and `public-export-contract` pass (238); `docs.test.ts` passes (163, including the examples gate); `node scripts/release.mjs gate` reports `updated: false`. The workspace suites pass except one timing test in `prism-code` (`TUI input editing > filters 50k paths inside a frame budget`), which passed in an earlier run of the same code and is unrelated to this change.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 src/__tests__/hook-catalog-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts`
- `bun examples/define-package.ts`
- `node scripts/release.mjs gate`

## Compromises Made

- **`createAgent` is async now, ahead of Phase 3.** About 567 call sites changed in 196 files, plus the four wrappers that call it. It was the smallest change that lets an async `setup` fail the load closed (Task 2).
- **`PackageCommand` is a new type and `CommandDefinition` is unchanged.** About 20 production files keep the 0.12 shape until Part B moves them, so two command shapes coexist until then (Tasks 1(f) and 6).
- **`credentials.resolve` returns `Credential`, not the roadmap's `Secret`, and `models.client` is a thin client** over today's provider resolution. Phase 5 replaces the internals and owns the rename (Task 6).
- **`ToolExecutionContext.session` was a type only until Task 6**, and `package.status` was not emitted until Task 7. Each landed with the task that owned its seam, so Task 5's tests did not cover them.
- **`session.opened` is lazy and hooks-only; a session needing nothing reads nothing.** "Created or reopened" became "before the first run, command, `set`, or `close()`", and `session.opened` / `session.closed` do not reach subscribers (Task 7).
- **Every session append is serialized**, an unplanned change to the central append path, forced by the store's existence-only `expectedParentId` (Task 7).
- **`optional` covers a `setup` throw only.** A failed `requires` check stays fatal until Phase 4 decides (Task 1 A5).
- **The kernel skills catalog did not move onto a named `kernel:context.build` registration.** The seam shipped; the move is deferred to Phase 3 (Task 3).
- **A package gets no `search_tools` narrowing by `when`**, and the 0.12 consumers of `agent.config.tools` / `skills` still do not see package tools (Task 6).
- **The suite is not green.** Every task's Evidence records the same pre-existing failures, attributed by cause rather than by a before/after run, because the tree holds uncommitted plan 144-146 work. The Postgres leg of the `package_state` conformance step was not run.
- **One accidental `git stash` / `git stash pop`** during Task 7 restored the tree unchanged.

## Further Actions

Each item is also in `plans/backlog.md` with its source.

- **P2: Decide whether a failed `requires` check skips an `optional` package** (Phase 4 manifest). A kernel-range mismatch is the most common reason an optional package cannot load.
- **P2: Move the remaining readers of `agent.config.tools` / `skills` onto the merged view** (plan 147 Task 1's caller walk), so failure injection wraps package tools.
- **P2: Clear the red baseline of `bun run test`.** Delete stale `dist` tests, then fix or retire the recorded failures, so a regression is visible.
- **P3: Close the `search_tools` gap for `when`-hidden tools.**
- **P3: Review the serialized `appendEntry` path** and decide where append ordering belongs.
- **P3: Settle when `session.opened` fires and who receives it** in the Phase 3 reshape.
- **P3: Rename `Credential` to `Secret`** in the Phase 5 model-layer plan.
- **P3: Re-key `inspect().hooks`** when Phase 3 renames the 0.12 observe hooks.
- **P3: Run the `package_state` conformance step against Postgres.**
- Existing item updated, not duplicated: "Add session-lifecycle hooks if Phase 2 needs them" is marked delivered, and "Decide the kernel skills catalog's owner" records that the seam shipped here.
