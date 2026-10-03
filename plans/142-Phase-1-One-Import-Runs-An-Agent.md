# Phase 1 — One import runs an agent

## Objectives

- A host can `defineAgent`, open a session, and stream a run importing only `@arnilo/prism-agent-sdk` (roadmap.md Phase 1).
- `identity` is required, with `"local-operator"` as an explicit opt-in profile; no silent verified identity.
- `store` accepts `"memory"`, `{ type: "jsonl", path }`, or a raw `SessionStore`; sqlite waits for Phase 6.
- `stopHooks` and progressive `load_skill` are SDK config, not host wrappers around `session.run`.
- `@arnilo/prism` becomes a dependency of the SDK, not a peer the host must declare.

## Expected Outcome

- `defineAgent` returns the host-facing `Agent` (renamed from `AgentSdkDefinition`): `session()`, `dispose()`, `mcp`, `commands`, `connectedMcpServerIds`, and the runtime `agent` escape hatch. No coordinator bag.
- The SDK re-exports the host-contract types (`Agent`, `AgentSession`, `AgentEvent`, `AgentRunResult`, `RunOptions`, `ToolDefinition`, `SessionStore`, `AIProvider`, `PermissionPolicy`, `ExecutionPolicy`) plus the mock-provider helpers, so the session example imports nothing else.
- `examples/agent-sdk-session.ts` runs on the mock provider in under 60 s with no second package import.
- Prism Code headless passes its todo stop hook through SDK config instead of wrapping `session.run`; the maxCost/`turnPolicy` wrap stays (not this phase).
- `docs/agent-sdk.md` documents the shipped Phase 1 contract; the `docs/index.md` entry becomes the host entry. `release:gate` is green after baseline regeneration.
- Seam verdict: 0.12.1 expresses all of Phase 1; **no 0.13.0 cut**. Task 1 proves this before any implementation.

This phase changes an existing JS package and its host-facing capability surface, so Task 1 is the primitive/seam review. `.agents/skills/project-wiki/` is absent, so no code-wiki task. No SDK version bump: 0.2.0 ships once after Phases 1–9 (roadmap version targets).

## Tasks

- [x] Task 1: Verify 0.12.1 expresses Phase 1 without a runtime seam
  - Acceptance Criteria:
    - Functional: Each of the following is confirmed by reading the cited source, and the verdict (expressible / needs seam) is recorded in this task's Notes after execution:
      - `AgentConfig.stopHooks?: readonly StopHook[]` exists and `RunOptions.stopHooks` appends to it — `src/contracts-core/agent.ts:146-147`. Programmatic stop hooks are SDK config with no runtime change.
      - `AgentIdentity` is a plain host-constructible object (`tenantId`, `principal`, non-empty `scopes`, `issuedAt`, `verified: true`) validated by `assertIdentityShape` / `assertIdentityActive` — `src/identity.ts`. The SDK can construct the `"local-operator"` profile itself; no runtime identity field is needed.
      - Nothing in `createAgent` / session assembly rejects a config that carries both `identity` and no `ownership` — `src/agent-session/session/assemble.ts`. Identity enforcement at run time (`assertIdentityActive`) passes for the constructed profile.
      - `AgentSession.run` and `AgentSession.stream(input)` already exist — `src/contracts-run-state.ts:442,455`. No session-method seam.
      - `createLoadSkillTool({ registry })` is exported from `@arnilo/prism` — `src/index.ts:709`, `src/skill-load.ts:183`. Progressive `load_skill` needs no runtime change.
      - Omitting `store` yields the runtime's in-memory session store — verify in `src/agent-session/session/assemble.ts`. `"memory"` shorthand maps to omission; no new store.
      - `createJsonlSessionStore` is exported via the `./node/session-store-jsonl` subpath of `@arnilo/prism` — root `package.json:94-97`, `src/node/session-store-jsonl.ts:45`.
      - `createToolRegistry`'s default duplicate policy fails closed on a name collision (so a host-added `load_skill` plus SDK-registered `load_skill` errors instead of silently shadowing) — `src/` tool registry source.
    - Functional: If any item needs a runtime field 0.12.1 lacks, stop and re-cut this plan with a 0.13.0 seam task before implementation. Do not improvise the seam inside a later task.
    - Performance: Read-only review. No code changes, no new files outside this plan's Notes.
    - Code Quality: Verdict cites file:line evidence per item. No speculative seam "for later phases" — Phases 2+ run their own checks.
    - Security: Confirm the constructed `"local-operator"` identity passes `assertIdentityActive` only because the host explicitly opted in; the SDK must never synthesize a verified identity from any other input.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 (`0.13.0` bullet: "Only if 0.12.1 cannot express `stopHooks` or the identity profile without a new runtime field. Verify before adding a seam.")
      - `src/identity.ts` (`AgentIdentity`, `assertIdentityShape`, `assertIdentityActive`), `src/contracts-core/agent.ts` (`AgentConfig.stopHooks`), `src/contracts-run-state.ts` (`AgentSession`), `src/skill-load.ts`, `src/node/session-store-jsonl.ts`.
    - Options Considered:
      - Skip the review and assume the roadmap's "not expected" verdict. Rejected: the roadmap orders verification first; plan 141 froze the offer as prose and this is the typed-seam check it deferred.
      - Cut 0.13.0 preemptively for the identity profile. Rejected: `AgentIdentity` is host-constructible data; a runtime field would be a speculative abstraction.
    - Chosen Approach:
      - One review task, verdict recorded before Task 2 starts. Every later task assumes "expressible".
    - API Notes and Examples:
      ```ts
      // Seam check shape: all fields host-constructible, no runtime change.
      const localOperator: AgentIdentity = {
        tenantId: "local",
        userId: "local-operator",
        principal: { kind: "user", id: "local-operator" },
        scopes: ["operator"],
        issuedAt: new Date().toISOString(),
        verified: true,
      };
      ```
    - Files to Create/Edit:
      - `plans/142-Phase-1-One-Import-Runs-An-Agent.md`: Notes on this task only.
    - References:
      - `src/identity.ts`, `src/contracts-core/agent.ts`, `src/contracts-run-state.ts`, `src/skill-load.ts`, `src/node/session-store-jsonl.ts`, root `package.json` exports
  - Test Cases to Write:
    - None. The Tasks 2–5 tests are the executable proof of this verdict; a wrong verdict fails those tests loudly.
  - Notes (executed 2026-09-30):
    - Verdict: **expressible — no 0.13.0 seam.** All items confirmed against source.
    - `AgentConfig.stopHooks?: readonly StopHook[]` exists; `RunOptions.stopHooks` appends (`src/contracts-core/agent.ts:146-147`). Programmatic stop hooks are config, no runtime change.
    - `AgentIdentity` is host-constructible data (`src/identity.ts:13-33`): required fields `tenantId`, `principal`, non-empty `scopes`, `issuedAt`, `verified: true`; validated by `assertIdentityShape` (`src/identity.ts:277`) and `assertIdentityActive` (`src/identity.ts:138`). The SDK can construct the `"local-operator"` profile itself.
    - No identity/ownership coupling rejects our case: `createAgent` stores config untouched (`src/agent-session/create-agent.ts:5-12`); run assembly calls `resolveRunIdentity(options.identity, agent.config.identity, session.activeOwnership)` (`src/agent-session/session/assemble.ts:760`), which returns `undefined` when no identity and falls back to `ownershipFromIdentity(identity)` when ownership is omitted (`src/identity.ts:264-275`). A valid constructed identity passes; no identity fails nothing at runtime — the SDK's required-field check is the enforcement point, as planned.
    - `AgentSession.run` / `stream` exist (`src/contracts-run-state.ts:442,455`). No session-method seam.
    - `createLoadSkillTool({ registry })` exported from `@arnilo/prism` (`src/index.ts:709`, `src/skill-load.ts:183`). No runtime change for progressive `load_skill`.
    - Store omitted → in-memory default confirmed: `this.store = config.store ?? config.agent.config.store ?? createMemorySessionStore()` (`src/agent-session/session.ts:302`). `"memory"` maps to omission.
    - `createJsonlSessionStore` at `src/node/session-store-jsonl.ts:45`, exported via `./node/session-store-jsonl` subpath (root `package.json:94-97`).
    - **Finding that changes Task 4:** `createToolRegistry`'s default duplicate policy is `"replace"`, not fail-closed (`src/registry-options.ts:7-15` — `assertCanRegister` throws only when `duplicate === "error"`; `src/tools.ts:110-136` passes `options.duplicate` through, and `define-agent.ts` forwards `config.duplicate`, default undefined → replace). A silent shadow, not an error. Task 4 amended: the SDK checks `toolRegistry.get("load_skill")` and throws `AgentSdkConfigError` before registering, instead of relying on the registry default.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. Review only.
    - Docs pages to create/edit:
      - `none`: no shipped surface changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2: Require `identity` and add the `"local-operator"` profile
  - Acceptance Criteria:
    - Functional: `AgentSdkConfig.identity` becomes `AgentIdentity | "local-operator"` and is required. `defineAgent` throws `AgentSdkConfigError` naming `identity` when it is missing.
    - Functional: `identity: "local-operator"` constructs exactly the Task 1 profile shape and passes it as `AgentConfig.identity`. A raw `AgentIdentity` passes through unmodified.
    - Functional: A `defineAgent` call with the profile reaches a runnable agent: `session().run()` on the mock provider succeeds (proved by the Task 2 tests, and end-to-end by Task 7).
    - Functional: No other string is accepted: `identity: "nobody"` throws `AgentSdkConfigError`. Fail closed.
    - Performance: Profile construction is O(1) object creation inside `defineAgent`; no I/O, no verifier call, no per-run cost.
    - Code Quality: Construction lives in one small helper next to `define-agent.ts` (or inline); no `IdentityVerifier` framework, no profile registry — one profile exists, a lookup table is speculative.
    - Security: The only path to a synthesized `verified: true` identity is the literal string `"local-operator"`. JSON config (`parseAgentSdkConfig`) does not gain an identity field in this phase — no caller-asserted identity from config files.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 (`identity` required, or `identity: "local-operator"`; "No silent verified identity … explicit opt-in, not the default").
      - `PRODUCT.md` Planes/identity bullet (frozen wording: do not design the profile object beyond this).
      - `src/identity.ts` shape and bounds (`assertIdentityShape`: non-empty `tenantId`, non-empty `scopes`).
      - `packages/agent-sdk/src/define-agent.ts` (current optional `identity?: AgentIdentity`, passed at `agentConfig.identity`).
      - `docs/agent-identity.md`: released identity is host-verifier output; the SDK profile is the documented single exception, host-typed as a string literal.
    - Options Considered:
      - Add a runtime `identity: "local-operator"` field (0.13.0 seam). Rejected per Task 1: the SDK constructs the object.
      - Accept any string as a profile name with a registry. Rejected: one profile exists; YAGNI.
      - Leave `identity` optional and warn. Rejected: roadmap says required; warnings are silent failure with extra steps.
    - Chosen Approach:
      - Narrow union on the existing field, throw early in `defineAgent` beside the existing `model` / `provider` checks.
    - API Notes and Examples:
      ```ts
      const agent = await defineAgent({
        model: { provider: "mock", model: "demo" },
        provider,
        identity: "local-operator", // explicit opt-in; raw AgentIdentity also accepted
      });
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/define-agent.ts`: required `identity`, union type, profile construction, pass-through.
      - `packages/agent-sdk/src/__tests__/define-agent.test.ts`: new cases.
    - References:
      - `src/identity.ts` (`AgentIdentity`, `assertIdentityActive`)
      - `packages/agent-sdk/src/errors.ts` (`AgentSdkConfigError`)
  - Test Cases to Write:
    - `defineAgent requires identity`: missing identity throws `AgentSdkConfigError` mentioning `identity`.
    - `local-operator profile constructs a verified identity`: resulting `agent.config.identity` matches the pinned shape and passes `assertIdentityActive`.
    - `raw identity passes through`: object identity is the same reference on `agent.config.identity`.
    - `unknown identity string fails closed`: `"nobody"` throws.
    - `local-operator agent runs`: `session().run("hi")` on the mock provider resolves.
  - Notes (executed 2026-09-30):
    - `AgentSdkConfig.identity` is now required: `AgentIdentity | "local-operator"`. `resolveIdentity` helper in `packages/agent-sdk/src/define-agent.ts` throws `AgentSdkConfigError` when missing or an unknown string; `"local-operator"` constructs the pinned profile (`tenantId: "local"`, `userId`/`principal.id: "local-operator"`, `scopes: ["operator"]`, `issuedAt`, `verified: true`). Raw identity passes through by reference.
    - `resolveJsonConfig` returns `Partial<AgentSdkConfig>`, so the required field did not force a JSON-config change; JSON gains no identity field, as planned.
    - Existing SDK test call sites updated mechanically (sed insert of `identity: "local-operator"` after `provider,`): 10 in `define-agent.test.ts`, 6 in `capabilities.test.ts`, 2 in `mcp-plane.test.ts`, 2 in `presets.test.ts`. No production behavior changed in those tests.
    - 5 new tests: missing identity throws, profile shape + `assertIdentityActive`, raw pass-through by reference, unknown string fails closed, end-to-end mock run. `bun run build && bun run test` in `packages/agent-sdk`: 77 pass, 0 fail.
    - Known red until Task 6: workspace callers (`packages/prism-code`, `packages/acp-agent`, `examples/agent-sdk-coding.ts`) still call `defineAgent` without `identity`; root `bun run typecheck` will fail there until Task 6 updates them. Task 2's listed suites are green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — required config field and a new accepted literal on the SDK's public config.
    - Docs pages to create/edit:
      - Deferred to Task 8, which rewrites the `defineAgent` inputs section once, after Tasks 2–5 settle the surface. Reason: one docs pass over a moving section, not four.
    - `docs/index.md` update: no (Task 8 owns it).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3: `store` shorthand — `"memory"` and `{ type: "jsonl", path }`
  - Acceptance Criteria:
    - Functional: `AgentSdkConfig.store` becomes `SessionStore | "memory" | { type: "jsonl"; path: string }`. Omitted or `"memory"` passes `undefined` to `AgentConfig.store` (runtime in-memory default, per Task 1).
    - Functional: `{ type: "jsonl", path }` constructs `createJsonlSessionStore(path)` from `@arnilo/prism/node/session-store-jsonl` and passes it through; a run then a second `defineAgent` with the same path resumes history (store round-trip in the task test).
    - Functional: Raw `SessionStore` passes through by reference. A malformed shorthand (`{ type: "sqlite" }`, `{ type: "jsonl" }` without `path`, a non-string `"store"` value) throws `AgentSdkConfigError`. Fail closed; sqlite is Phase 6, not a silent alias.
    - Performance: Store construction happens once in `defineAgent`; `"memory"` allocates nothing new. No `pg` or sqlite module is imported by any code path in this phase.
    - Code Quality: One `resolveStore` helper; static import of the `./node/session-store-jsonl` subpath (the SDK is a node host-side package; a dynamic import buys nothing here). No store interface wrapper.
    - Security: `path` is host-supplied and used verbatim — the SDK does not jail it under `workspaceRoot` (host's trust decision, same as a raw store). No path value is echoed into model-visible content by the SDK.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 (`store`: `"memory"` | `{ type: "jsonl", path }` | raw `SessionStore`. SQLite waits for Phase 6.)
      - `src/node/session-store-jsonl.ts` (`createJsonlSessionStore(pathOrOptions)`, `SessionStore` return, `searchSessions`).
      - `src/__tests__/node-session-store-jsonl.test.ts` for round-trip usage shape.
    - Options Considered:
      - Lazy `await import()` of the jsonl subpath only when chosen. Rejected: static subpath import is one line; the file is small and the SDK already runs on node. Revisit only if a non-node host appears.
      - Add `"sqlite"` now via bun:sqlite. Rejected: roadmap assigns sqlite to Phase 6.
    - Chosen Approach:
      - Narrow union + `resolveStore` returning `SessionStore | undefined`, wired into the existing `agentConfig.store` line.
    - API Notes and Examples:
      ```ts
      import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
      // resolveStore(config.store): "memory" | undefined → undefined
      //   { type: "jsonl", path } → createJsonlSessionStore(path)
      //   raw SessionStore → as-is
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/define-agent.ts`: `store` union + resolution.
      - `packages/agent-sdk/src/__tests__/define-agent.test.ts`: new cases (temp-dir jsonl round-trip).
    - References:
      - `src/node/session-store-jsonl.ts`
      - root `package.json` `./node/session-store-jsonl` export (lines 94–97)
  - Test Cases to Write:
    - `store omitted and "memory" use the in-memory default`: `agent.config.store` is undefined both ways; a run succeeds.
    - `jsonl shorthand persists`: run, dispose, new agent on same path, `entries()` non-empty.
    - `raw store passes through`: same reference on `agent.config.store`.
    - `unknown store type fails closed`: `{ type: "sqlite", path }` throws `AgentSdkConfigError` naming `store`.
  - Notes (executed 2026-09-30):
    - `AgentSdkConfig.store` is now `SessionStore | "memory" | { type: "jsonl"; path: string }`. `resolveStore` in `define-agent.ts`: omitted/`"memory"` → `undefined` (runtime default); jsonl shorthand → static `createJsonlSessionStore(path)` from `@arnilo/prism/node/session-store-jsonl` (NodeNext resolves the exports subpath; `SessionStore` has no `type` field, so `"type" in store` narrows cleanly); raw store passes through by reference; unknown strings/types throw `AgentSdkConfigError`.
    - 4 new tests in `define-agent.test.ts`: memory default (config.store undefined, run succeeds), jsonl round-trip (second agent on same path lists first session's entries), raw pass-through by reference, `{ type: "sqlite" }` fails closed. `bun run build && bun run test` in `packages/agent-sdk`: 81 pass, 0 fail.
    - Tests landed in the existing `define-agent.test.ts`, so no `scripts/e2e-coverage.json` suite-list change. Root typecheck still red on callers until Task 6, as recorded in Task 2 Notes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new accepted config shapes for `store`.
    - Docs pages to create/edit:
      - Deferred to Task 8 (same reason as Task 2).
    - `docs/index.md` update: no (Task 8 owns it).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4: `stopHooks` config and SDK-internal progressive `load_skill`
  - Acceptance Criteria:
    - Functional: `AgentSdkConfig.stopHooks?: readonly StopHook[]` is accepted and merged as `[...(hooksPlane.stopHooks ?? []), ...(config.stopHooks ?? [])]` into `AgentConfig.stopHooks`. A config stop hook fires at run end with no `session.run` wrapper (test proves it: hook observing a forced stop condition runs).
    - Functional: When `skills.disclosure === "progressive"` (including via preset/merged config) and the assembled skills registry exists, the SDK registers `createLoadSkillTool({ registry })` on the tool registry after local plane tools, matching the wiring Prism Code does today at `packages/prism-code/src/headless.ts:211`.
    - Functional: `disclosure: "eager"` or absent registers no `load_skill`. A host tool already named `load_skill` fails closed: the SDK checks `toolRegistry.get("load_skill")` before registering and throws `AgentSdkConfigError` on collision — the registry's default duplicate policy is `"replace"` (Task 1 finding), so an explicit check is the fail-closed path. No silent skip, no silent shadow.
    - Functional: `RunOptions.stopHooks` still appends per run (runtime behavior, unchanged).
    - Performance: One tool registration at define time; zero per-run overhead added. Eager/omitted disclosure keeps today's behavior exactly.
    - Code Quality: Reuse `createLoadSkillTool` from `@arnilo/prism`; no SDK-side reimplementation of skill loading. Merge order documented in one comment.
    - Security: Stop hooks are host code the host passed — no new trust boundary. `load_skill` loads only from the registry the skills plane already trust-gated.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 ("`stopHooks` and progressive `load_skill` are config, not a host wrapper around `session.run`").
      - `src/contracts-core/agent.ts:146-147` (`AgentConfig.stopHooks`; `RunOptions.stopHooks` appends).
      - `packages/agent-sdk/src/planes/hooks.ts` (`hooksPlane.stopHooks` source) and `packages/agent-sdk/src/planes/skills.ts` (`disclosure` field, assembled registry).
      - `packages/prism-code/src/headless.ts:196-211,331-337` (the two host wrappers this replaces).
      - `src/skill-load.ts:183` (`createLoadSkillTool`).
    - Options Considered:
      - Put `stopHooks` under `hooks:` config. Rejected: roadmap Phase 4 will add programmatic guardrails/middleware shapes; a flat `stopHooks` field now is the minimal seam and matches `AgentConfig` naming.
      - Always register `load_skill` when a registry exists. Rejected: eager disclosure must omit it (today's tested behavior in `packages/prism-code/src/__tests__/skills.test.ts:349-379`).
      - Rely on `createToolRegistry`'s duplicate policy for the collision case. Rejected per Task 1: the default is `"replace"` (`src/registry-options.ts:7-15`), which would silently shadow the host tool.
      - Change the SDK's registry default to `duplicate: "error"`. Rejected: changes collision behavior for every plane/add registration, beyond this task's scope; the explicit `get` check is one line and local to the new registration.
    - Chosen Approach:
      - Two small additions in `define-agent.ts`: merge into `agentConfig.stopHooks`; conditional `toolRegistry.register(createLoadSkillTool(...))` after local/MCP tools.
    - API Notes and Examples:
      ```ts
      await defineAgent({
        model, provider, identity: "local-operator",
        skills: { disclosure: "progressive" }, // SDK registers load_skill
        stopHooks: [myStopHook],               // no session.run wrapper
      });
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/define-agent.ts`: `stopHooks` field + merge; conditional `load_skill` registration.
      - `packages/agent-sdk/src/__tests__/define-agent.test.ts`: stop-hook firing and load_skill registration cases.
    - References:
      - `src/skill-load.ts`, `src/contracts-core/agent.ts`
      - `packages/prism-code/src/headless.ts` (wrapper being retired in Task 6)
  - Test Cases to Write:
    - `config stopHooks fire at run end`: hook appends to a probe array; after `session().run()`, probe non-empty, no run wrapper involved.
    - `hooks.json stopHooks and config stopHooks both run`: merge order hooks-plane first.
    - `progressive disclosure registers load_skill`: registry resolves `load_skill`; eager and omitted disclosure do not.
    - `host load_skill collision fails closed`: `tools.add` with a `load_skill` tool plus progressive disclosure throws `AgentSdkConfigError` naming `load_skill`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new config field; `load_skill` registration moves from host to SDK for progressive disclosure.
    - Docs pages to create/edit:
      - Deferred to Task 8 (same reason as Task 2).
    - `docs/index.md` update: no (Task 8 owns it).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-09-30):
    - `AgentSdkConfig.stopHooks?: readonly StopHook[]` added; `mergeStopHooks(hooksPlane.stopHooks, config.stopHooks)` keeps hooks.json first, config second, returns `undefined` when both empty (parity with old `stopHooks: hooksPlane.stopHooks`). No `session.run` wrapper anywhere in the SDK; runtime still appends `RunOptions.stopHooks` after config (`src/agent-session/session/assemble.ts:725`).
    - Progressive `load_skill`: after `createToolRegistry`, when `config.skills?.disclosure === "progressive"` and `skillsPlane.skills` exists, the SDK registers `createLoadSkillTool({ registry: skillsPlane.skills })` on the same registry instance the skills plane built (so Task 6's headless drop of its manual call uses the same registry and cannot double-register). Collision with a host tool named `load_skill` throws `AgentSdkConfigError` via the explicit `toolRegistry.get(...)` check (registry default is `"replace"`). Eager/absent disclosure registers nothing.
    - One literal reading note: "absent registers no `load_skill`" is implemented as disclosure strictly `=== "progressive"`; a `skills` config without `disclosure` registers none. Task 6's headless passes `disclosure: "progressive"` explicitly (it already defaults to that), so Prism Code behavior is unchanged.
    - 5 new tests: config stop hook fires at run end (no wrapper), hooks.json+config order (`…:Stop` then `config-probe`), progressive registers exactly one `load_skill`, eager/absent register none, host collision fails closed. `packages/agent-sdk`: 86 pass, 0 fail. Root typecheck still red on callers until Task 6.

- [x] Task 5: Host-facing return shape, type re-exports, dependency move, compat baseline
  - Acceptance Criteria:
    - Functional: `AgentSdkDefinition` is renamed to `Agent` and `createSession` renamed to `session(options?)`. Fields `agent` (runtime escape hatch), `mcp`, `commands`, `connectedMcpServerIds`, `dispose()` unchanged. No `createSession` or `AgentSdkDefinition` symbol remains in the SDK source.
    - Functional: `packages/agent-sdk/src/index.ts` additionally exports (type-only) `AgentSession`, `AgentEvent`, `AgentRunResult`, `RunOptions`, `ToolDefinition`, `SessionStore`, `AIProvider`, `PermissionPolicy`, `ExecutionPolicy`, and (value) `createMockProvider`, `providerTextDelta`, `providerDone`, `providerUsage`. The ten host-contract type names from `PRODUCT.md` are all importable from `@arnilo/prism-agent-sdk` (`Agent` is the SDK's own return type).
    - Functional: `@arnilo/prism` moves from `peerDependencies` to `dependencies` (`^0.12.0`) in `packages/agent-sdk/package.json`. `@arnilo/prism-coding-tools`, `@arnilo/prism-hooks`, `@arnilo/prism-mcp` stay peers; nothing about their loading changes in this phase.
    - Functional: Compat baseline regenerated: `node scripts/release.mjs gate --update-baseline` rewrites `scripts/compat-baseline/arnilo__prism-agent-sdk.txt`; a subsequent `node scripts/release.mjs gate` is green. The post-regeneration diff is included in the task note, and it states: removals from this plan are `AgentSdkDefinition` and `AgentSdkDefinition.createSession`; inherited removals: none.
    - Functional: Repo-wide retirement sweep: grep `scripts/`, `examples/`, and every workspace for `createSession` and `AgentSdkDefinition`; outside `@arnilo/prism`'s own runtime `Agent.createSession` (a different, unchanged API) and Task 6's updated callers, zero hits remain.
    - Performance: Type re-exports are erased at compile time; the four mock helpers are already in the `@arnilo/prism` bundle the SDK now depends on. No new runtime weight for hosts that never import them (`sideEffects: false` stays).
    - Code Quality: Re-exports are `export type { ... } from "@arnilo/prism"` one-liners, no local redeclaration. Runtime `Agent` type is not re-exported (the SDK's `Agent` owns the name); internal references alias it (`import type { Agent as RuntimeAgent }`).
    - Security: Mock providers emit only host-scripted content; re-exporting them adds no credential or network surface.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Host contract (type list), Phase 1 ("No host bag on the return value", "`@arnilo/prism` becomes a dependency of the SDK for this path, not a peer the host must declare").
      - `PRODUCT.md` Types section (frozen ten names).
      - `scripts/compat-baseline/arnilo__prism-agent-sdk.txt` (current baseline) and `scripts/release.mjs` gate command.
      - Plan 083/084 lesson in the create-plan skill: regenerate the baseline in the same plan that moves symbols.
    - Options Considered:
      - Keep `createSession` as a deprecated alias. Rejected: every caller is in this monorepo and Task 6 updates them; an alias is scaffolding for a migration with no external users yet (0.2.0 is unpublished).
      - Name the return type `Agent` and also re-export the runtime `Agent` as `RuntimeAgent`. Rejected: hosts never name the runtime type; the `agent` field is the escape hatch.
      - Example-local inline mock provider instead of re-exports. Rejected: the roadmap says the example runs on *the* mock provider; four re-export lines beat a duplicated fake.
    - Chosen Approach:
      - Rename in `define-agent.ts`, extend `index.ts` exports, move the dependency, regenerate baseline in the same task.
    - API Notes and Examples:
      ```ts
      import {
        defineAgent, createMockProvider, providerTextDelta, providerDone,
        type Agent, type AgentSession, type AgentEvent, type RunOptions,
      } from "@arnilo/prism-agent-sdk";

      const agent: Agent = await defineAgent({ model, provider, identity: "local-operator" });
      const session: AgentSession = agent.session();
      for await (const event of session.stream("hi")) { /* AgentEvent */ }
      await agent.dispose();
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/define-agent.ts`: rename type + method.
      - `packages/agent-sdk/src/index.ts`: re-exports; doc comment loses "assembly-only".
      - `packages/agent-sdk/package.json`: dependency move.
      - `packages/agent-sdk/src/__tests__/define-agent.test.ts`: update to `agent.session()`.
      - `scripts/compat-baseline/arnilo__prism-agent-sdk.txt`: regenerated via `node scripts/release.mjs gate --update-baseline`.
    - References:
      - `PRODUCT.md` Types section
      - `packages/agent-sdk/src/index.ts` (current export list)
  - Test Cases to Write:
    - `host contract names import from the SDK`: a type-level test importing all ten names plus the four mock helpers from the package root (compile is the assertion).
    - `session() creates and dispose() idempotent`: existing define-agent tests updated to the new names; disposed `session()` still throws `AgentSdkConfigError`.
    - Baseline gate: `node scripts/release.mjs gate` exit 0 (command check, not a unit test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — renamed public type/method, new exports, dependency contract change.
    - Docs pages to create/edit:
      - Deferred to Task 8 (same reason as Task 2).
    - `docs/index.md` update: no (Task 8 owns it).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-09-30):
    - Renames landed: `AgentSdkDefinition` → `Agent` (field `agent` now typed by runtime alias `Agent as RuntimeAgent`), `createSession()` → `session()`; the runtime delegation `agent.createSession(...)` is the unchanged runtime API. Zero `AgentSdkDefinition` hits remain in the repo (sweep over `scripts/ examples/ packages/ src/ docs/`, excluding `dist`).
    - `packages/agent-sdk/src/index.ts` re-exports the ten host-contract type names and the four mock helpers from `@arnilo/prism` (one-liners, no local redeclaration; runtime `Agent` type not re-exported). Doc header lost "assembly-only".
    - `packages/agent-sdk/package.json`: `@arnilo/prism` moved `peerDependencies` → `dependencies` at `^0.12.0`; coding-tools/hooks/mcp remain peers; description lost "Assembly-only".
    - Compat baseline regenerated (`node scripts/release.mjs gate --update-baseline`); follow-up `gate` green (14 packages). Baseline diff removals: `AgentSdkDefinition` and the `defineAgent` return type (`Promise<AgentSdkDefinition>` → `Promise<Agent>`); inherited removals: none. Additions: `Agent`, ten re-exports, four mock helpers. Diff pasted in the task report above.
    - Two new tests: host-contract type import from `../index.js` (compile-time assertion) and `session().stream()` emitting `AgentEvent`s. SDK suite: 88 pass, 0 fail. `createSession` sweep now hits only (a) runtime's own `Agent.createSession` API/tests and (b) Task 6's caller list (`packages/prism-code/src/acp.ts`, `tui/index.ts`, `tui/commands.ts`, `headless.ts` + prism-code tests; `packages/acp-agent/src/index.ts`; `examples/agent-sdk-coding.ts`). Root typecheck stays red until Task 6.

- [x] Task 6: Update in-repo callers; Prism Code headless drops the stop-hook and load_skill wrappers
  - Acceptance Criteria:
    - Functional: Every in-repo caller compiles against the new shape: `packages/prism-code/src/acp.ts`, `packages/prism-code/src/tui/index.ts`, `packages/prism-code/src/tui/commands.ts`, `packages/prism-code/src/headless.ts`, `packages/acp-agent/src/index.ts`, `examples/agent-sdk-coding.ts`, and the prism-code test files that reference `createSession`.
    - Functional: `packages/prism-code/src/headless.ts` no longer wraps `session.run` to append `todoStopHook`; the hook is passed as `stopHooks: [todoStopHook]` (when `continueOnOpenTodos`) in the `defineAgent` config. The maxCost/`turnPolicy` enrichment wrap stays — it is not stop-hook config and not this phase.
    - Functional: `headless.ts` no longer imports `createLoadSkillTool` or registers it (line ~211); the SDK registers it under progressive disclosure. The pre-`defineAgent` `assembleSkillsPlane` call stays — deleting it is Phase 4.
    - Functional: Headless and `acp-agent` pass `identity: "local-operator"` (they are the local operator host) so Task 2's required field is satisfied everywhere.
    - Functional: `bun run typecheck` passes; prism-code's `todo-continuation` and `skills` test suites pass against the config path (progressive disclosure still yields a resolvable `load_skill`; a run with open todos still continues).
    - Performance: No per-run change: the stop hook now rides `AgentConfig.stopHooks` (same runtime list `RunOptions.stopHooks` used to append into). One fewer closure per run, not one more.
    - Code Quality: Caller edits are mechanical renames plus the two wrapper deletions. No new abstraction in prism-code to "prepare" for Phase 4.
    - Security: No trust, credential, or approval path changes; the approval engine stays in the TUI.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 Lab bullet ("Prism Code headless stops wrapping `session.run` for stop hooks once this config exists. It may still import other packages.").
      - `packages/prism-code/src/headless.ts:196-340` (wrapper code and config assembly).
      - `packages/prism-code/src/__tests__/todo-continuation.test.ts`, `packages/prism-code/src/__tests__/skills.test.ts` (behavior pinned today; should pass with the registration point moved).
    - Options Considered:
      - Leave headless registering `load_skill` too and rely on duplicate policy. Rejected: the registry default is `"replace"` (Task 1 finding), so headless's tool would silently shadow the SDK's `load_skill`; the SDK's explicit `toolRegistry.get("load_skill")` check then throws `AgentSdkConfigError` on every progressive session.
      - Move the maxCost wrap into SDK config now. Rejected: unrequested; Phase 3/6 own policy and compaction surfaces.
    - Chosen Approach:
      - Mechanical rename everywhere; surgical deletion of exactly the two wrappers in headless.
    - API Notes and Examples:
      ```ts
      // headless.ts, before: session.run wrapped to append todoStopHook
      // after: one config field
      const definition = await defineAgent({
        ...config,
        identity: "local-operator",
        ...(todoStopHook ? { stopHooks: [todoStopHook] } : {}),
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/headless.ts`: config `stopHooks`; delete `createLoadSkillTool` import/registration; rename wrapped `createSession` → `session`.
      - `packages/prism-code/src/acp.ts`, `packages/prism-code/src/tui/index.ts`, `packages/prism-code/src/tui/commands.ts`: rename call sites; add identity where an agent is defined.
      - `packages/acp-agent/src/index.ts`: rename; add `identity: "local-operator"`.
      - `examples/agent-sdk-coding.ts`: `app.createSession()` → `app.session()`; add `identity: "local-operator"`.
      - `packages/prism-code/src/__tests__/`: update `createSession` references (`headless.test.ts`, `commands-utility.test.ts`, `flags.test.ts`, `skills.test.ts`, `todo-continuation.test.ts`).
      - `packages/agent-sdk/src/__tests__/`: any remaining `createSession` references.
    - References:
      - Task 5 grep sweep (shares its acceptance criterion)
  - Test Cases to Write:
    - No new test files. Update `todo-continuation.test.ts` to assert the hook arrives via config (agent `config.stopHooks` contains the todo hook) instead of via run wrapping, if it asserted the wrapper.
    - Existing suites must pass unchanged otherwise: `bun run typecheck`, prism-code build+test, agent-sdk build+test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new surface — callers tracking Task 5. Lab-internal only.
    - Docs pages to create/edit:
      - `none`: `docs/prism-code.md` describes the app, not its internal wiring; no behavior change a host can observe.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (2026-09-30):
    - Executed by plan 143 Task 1. Every named caller compiles against `Agent` / `session()`: `packages/prism-code/src/{acp.ts,tui/index.ts,tui/commands.ts,headless.ts}`, `packages/acp-agent/src/index.ts`, `examples/agent-sdk-coding.ts`, and the prism-code test files (`flags`, `headless`, `integration`, `limits`, `long-run`, `prompt`, `resume`, `skills`, `todo-continuation`, plus the `commands-utility`/`tui-commands` mock contexts).
    - Headless: `todoStopHook` now rides `AgentConfig.stopHooks` through `defineAgent` config; the `session.run` wrapper keeps only the maxCost/`turnPolicy` enrichment. The manual `createLoadSkillTool` registration and its now-unused `createSkillRegistry` import are deleted; the SDK registers `load_skill` under progressive disclosure on the same skills registry.
    - Amendment A (baseline): `node scripts/release.mjs gate --update-baseline` then `node scripts/release.mjs gate` exits 0 (14 packages). `arnilo__prism-code.txt` diff:
      ```diff
      -assembleAppAgent	export declare function assembleAppAgent(...): Promise<AgentSdkDefinition>
      +assembleAppAgent	export declare function assembleAppAgent(...): Promise<Agent>
      ```
      Removals: `Promise<AgentSdkDefinition>` → `Promise<Agent>` in `arnilo__prism-code.txt`. `arnilo__prism-acp-agent.txt`: no change. `arnilo__prism-agent-sdk.txt`: the Task 5 rename (`AgentSdkDefinition` removed; `Agent` + ten host types + four mock helpers added), regenerated in the same gate. Inherited removals: none.
    - Amendment B: corrected the Task 6 Options line above — the registry default is `"replace"`, and the SDK's explicit collision check is the fail-closed path.
    - Deviation (recorded in plan 143): headless and `@arnilo/prism-acp-agent` keep their synthesized verified local identity instead of the SDK literal `identity: "local-operator"`. Both build `ownership` from `config.userId`, and the runtime's `assertIdentityMatchesOwnership` (called per run via `resolveRunIdentity`) requires `identity.userId === ownership.userId`; the literal's fixed `userId: "local-operator"` conflicts with the default `"local"` and throws `IdentityError: Ownership user conflicts with identity` on every run. The constructed identity is the same verified local-operator identity and honors `config.userId`. `examples/agent-sdk-coding.ts` (no ownership scope) uses the literal.
    - Retirement sweep (`scripts/`, `examples/`, `src/`, workspaces, excluding `dist`): `AgentSdkDefinition` and SDK-`Agent` `.createSession(` are zero hits. Remaining `AgentSdkDefinition` strings are `/docs/agent-sdk.md` (the released 0.1.0 contract), `CHANGELOG.md`, and `packages/agent-sdk/CHANGELOG.md` (release history). Phase 0 forbids `/docs` API edits and history is immutable, so the sweep's "zero outside `plans/`" holds for code only. Runtime `Agent.createSession` call sites (`packages/prism-code/src/acp.ts`, `packages/acp-agent/src/index.ts`, runtime tests) are a different, unchanged API.
    - Tests: `packages/agent-sdk` 88 pass/0 fail; `packages/prism-code` 343 pass/0 fail (todo-continuation + skills green); `packages/acp-agent` 20 pass/0 fail; `bun run typecheck` green; `bun test --timeout=0 src/__tests__/docs.test.ts -t examples_demos` passes.

- [ ] Task 7: `examples/agent-sdk-session.ts` — one import, mock provider, streamed run
  - Acceptance Criteria:
    - Functional: New `examples/agent-sdk-session.ts` imports only `@arnilo/prism-agent-sdk` (asserted: no other `@arnilo/*` or relative package import in the file). It defines an agent with the SDK-re-exported mock provider, `identity: "local-operator"`, `store: "memory"`, streams one prompt via `session.stream()`, collects event types, disposes, and prints a JSON summary like the other examples.
    - Functional: The file exits 0 within 60 s under the execution gate (`scripts/examples-execution.test.mjs`); it is not added to `scripts/examples-manifest.json` (it needs no exemption).
    - Functional: `tsc -p examples --noEmit` passes (examples typecheck against package source).
    - Functional: `examples/agent-sdk-session.ts` is added to the `@arnilo/prism-agent-sdk` suites in `scripts/e2e-coverage.json` beside `examples/agent-sdk-coding.ts`, and `examples/README.md` gains one gallery line for it.
    - Performance: Single mock run, no network, no fs; well under the 60 s gate.
    - Code Quality: Follows the `agent-sdk-coding.ts` shape (`demo()` + `main()` + `import.meta.url` guard). No new helper module.
    - Security: No key, token, or env read; mock provider only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 Docs and examples ("`examples/agent-sdk-session.ts` runs on the mock provider with no second package import").
      - `examples/README.md` (typecheck and execution-gate rules).
      - `examples/agent-sdk-coding.ts` (shape to mirror, minus the coding preset and `@arnilo/prism` import).
    - Options Considered:
      - Extend `agent-sdk-coding.ts` instead of a new file. Rejected: that example exercises `codingPreset`; the phase wants the bare one-import session story as its own artifact.
    - Chosen Approach:
      - One new example file mirroring the existing one's skeleton.
    - API Notes and Examples:
      ```ts
      import { createMockProvider, defineAgent, providerDone, providerTextDelta, type AgentEvent } from "@arnilo/prism-agent-sdk";

      const provider = createMockProvider([providerTextDelta("hello"), providerDone()]);
      const agent = await defineAgent({
        model: { provider: "mock", model: "session-demo" },
        provider,
        identity: "local-operator",
        store: "memory",
      });
      const session = agent.session();
      const eventTypes: string[] = [];
      for await (const event of session.stream("Say hello")) eventTypes.push((event as AgentEvent).type);
      await agent.dispose();
      ```
    - Files to Create/Edit:
      - `examples/agent-sdk-session.ts`: new example.
      - `examples/README.md`: one gallery line.
      - `scripts/e2e-coverage.json`: add the file to the SDK suites list.
    - References:
      - `examples/agent-sdk-coding.ts`
      - `scripts/e2e-coverage.json` (`@arnilo/prism-agent-sdk` block, ~line 1186)
  - Test Cases to Write:
    - The example itself is the test (execution gate). No separate unit test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (demonstrates the shipped surface; changes none). The example is itself user-facing documentation of the host path.
    - Docs pages to create/edit:
      - `examples/README.md`: one gallery line (required by the gallery's completeness convention).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes: Dropped by plan 143 (2026-09-30): the roadmap withdrew the `defineAgent` host surface; the session example and `docs/agent-sdk.md` host contract are superseded by roadmap Phase 3.

- [ ] Task 8: `docs/agent-sdk.md` host contract + index entry + freeze-pin update
  - Acceptance Criteria:
    - Functional: `docs/agent-sdk.md` replaces the "assembly-only" framing for the APIs this phase ships: required `identity` with the `"local-operator"` opt-in, `store` shorthand, `stopHooks` config, SDK-registered `load_skill` under progressive disclosure, `agent.session()` / `session.run` / `session.stream` / `agent.dispose`, the ten re-exported host types plus mock helpers, and `@arnilo/prism` as a dependency the host does not declare. Presets, tool planes, MCP, hooks, and JSON config sections keep their current-contract wording.
    - Functional: The page follows the API page structure (What it does / When to use it / Inputs / Outputs / examples / Extension / Security) and carries no version narrative, no plan numbers, no "0.2.0 adds" phrasing — the page reads as the current contract.
    - Functional: `docs/index.md` line for Agent SDK becomes the host entry, one sentence: the SDK is the supported host path for defining an agent and streaming runs; family packages are the implementation.
    - Functional: `src/__tests__/docs.test.ts` freeze pin is updated: `docs/agent-sdk.md` may now contain `local-operator` (Phase 1 shipped it) but must still not contain `agent.serve` or `tools.use`; the `docs/index.md` assertions (`every plane optional or replaceable` present — update if the SDK entry rewording removes it from that line, no `PRODUCT.md` mention) still hold. PRODUCT.md and README pins untouched.
    - Functional: `bun test --timeout=0 src/__tests__/docs.test.ts` passes.
    - Performance: Docs and one test file only.
    - Code Quality: One docs pass covering Tasks 2–5 (per their deferred assessments). No duplication of adapter/runtime detail — link `docs/agent-identity.md` and the jsonl store contract instead of copying them.
    - Security: Security notes section states: identity is required and `"local-operator"` is the only synthesized verified identity; credential refs only, no secrets in config; store path is host-trusted.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 Docs and examples ("`docs/agent-sdk.md` replaces the 0.1.0 'assembly only' story for the APIs this phase ships. `docs/index.md` entry becomes the host entry.").
      - `.agents/skills/create-plan/references/prism-wiki.md` (API page structure; current-contract rule; one-sentence index entries).
      - `docs/agent-sdk.md` (current page), `docs/index.md:84` (current entry), `docs/index.md:291` (package-truth table row).
      - `src/__tests__/docs.test.ts:4939` (the freeze pin to amend).
    - Options Considered:
      - Leave docs untouched until the 0.2.0 publish phase. Rejected: the roadmap explicitly orders the Phase 1 docs update for shipped APIs; PRODUCT.md remains the file labeled "not shipped".
      - Rewrite the whole page to the final 0.2.0 shape (providers shorthand, tools.use, etc.). Rejected: those are Phases 2–3; the wiki rule forbids documenting unshipped API in `/docs`.
    - Chosen Approach:
      - Surgical rewrite of the framing paragraph, the `defineAgent` inputs table, and the API list; amend the freeze pin minimally.
    - API Notes and Examples:
      ```markdown
      - [Agent SDK](agent-sdk.md): the supported host path — one `defineAgent` import to define an agent, open a session, and stream runs, with family packages as the implementation behind it.
      ```
    - Files to Create/Edit:
      - `docs/agent-sdk.md`: Phase 1 contract sections.
      - `docs/index.md`: SDK entry sentence (line 84); package-truth row only if it is hand-written there (verify — do not hand-edit generated blocks).
      - `src/__tests__/docs.test.ts`: amend the phase-0 freeze test's `docs/agent-sdk.md` token list.
    - References:
      - `roadmap.md` Phase 1
      - `.agents/skills/create-plan/references/prism-wiki.md`
  - Test Cases to Write:
    - Amended freeze test passes; mutation check: adding `tools.use` to `docs/agent-sdk.md` still fails the pin.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task is the documentation of the Phase 1 surface.
    - Docs pages to create/edit:
      - `docs/agent-sdk.md`: contract update for shipped Phase 1 APIs.
      - `docs/index.md`: SDK entry becomes the host entry.
      - `src/__tests__/docs.test.ts`: freeze pin amendment.
    - `docs/index.md` update: yes — Agent SDK entry under its existing heading, one sentence as above.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes: Dropped by plan 143 (2026-09-30): the roadmap withdrew the `defineAgent` host surface; the session example and `docs/agent-sdk.md` host contract are superseded by roadmap Phase 3.

## Verification (whole plan)

- `bun run build:core`
- `cd packages/agent-sdk && bun run build && bun run test`
- `cd packages/prism-code && bun run build && bun run test` (todo-continuation + skills suites green)
- `bun run typecheck` (includes `tsc -p examples --noEmit`)
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `node scripts/release.mjs gate`
- `node examples/agent-sdk-session.ts` exits 0 (after `bun run build:core`)

## Compromises Made

- Plan 142 Tasks 7–8 (session example, `docs/agent-sdk.md` host contract) were dropped, not executed. Superseded by roadmap Phase 3: the roadmap withdrew the `defineAgent` host surface those tasks documented. No file they list was created or edited.
- Headless and `@arnilo/prism-acp-agent` keep their synthesized verified local identity instead of the SDK literal `identity: "local-operator"`. The runtime's `assertIdentityMatchesOwnership` (per run) requires `identity.userId === ownership.userId`; both hosts build `ownership` from `config.userId`, and the literal's fixed `userId: "local-operator"` conflicts with the default `"local"`. The literal is used only by `examples/agent-sdk-coding.ts`, which has no ownership scope.
- The tool registry's default duplicate policy remains `"replace"`. The SDK now checks for a host `load_skill` collision explicitly and fails closed, but any other duplicate registration still silently shadows.
- `/docs/agent-sdk.md`, `CHANGELOG.md`, and `packages/agent-sdk/CHANGELOG.md` still name `AgentSdkDefinition`. The rename is unshipped (SDK 0.2.0 unpublished) and Phase 0 forbids `/docs` API edits; changelogs are history.

Recorded in plans/backlog.md.

## Further Actions

- When SDK 0.2.0 ships, update `docs/agent-sdk.md` off `AgentSdkDefinition` and add the host entry to `docs/index.md`. Priority: P3.
- Let the SDK `"local-operator"` profile accept a host-supplied user id, or align Prism Code's `config.userId` with its `ownership` scope, so a host can use the literal and keep a configured user. Priority: P3.
- Consider making `createToolRegistry`'s default duplicate policy fail closed instead of `"replace"`. Priority: P4.

Recorded in plans/backlog.md.
