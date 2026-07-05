# Phase 26 — Skill semantics: active selection, Skill.context activation, toolNames enforcement

## Objectives
- Close the three Skill gaps where the runtime bypasses the skill machinery: active-skill selection is not per-run, `Skill.context` is a dead field, and `toolNames` is unenforced in the live loop.
- Add `RunOptions.activeSkills?: readonly string[]` (names). When set against a `SkillRegistry`, the runtime calls `resolveActiveSkills({ registry, names, tools })` instead of `registry.list()`. Preserve current behavior when `activeSkills` is unset (all configured skills active).
- Accept an explicit `RunOptions.skills?: readonly Skill[]` override for the case where `AgentConfig.skills` is a plain `Skill[]` array (no registry) — name resolution is impossible without a registry. Names win when a registry exists.
- Activate `Skill.context`: when building provider input, collect `activeSkills.flatMap(s => s.context ?? [])`, resolve via the existing `resolveContextProviders(...)`, and merge resulting `ContextBlock[]` into the request `context` *after* host `AgentConfig.context` blocks. `skillMessages()` still renders `skill.instructions`. Merge priority marked with a `ponytail:` comment.
- `toolNames` enforcement becomes free once selection routes through `resolveActiveSkills()` (it already throws on missing tools). Add a test: a skill with `toolNames: ["missing"]` against a config missing that tool throws before the first provider turn. This satisfies the docs' existing "skills cannot register missing tools" claim that the runtime currently contradicts.
- No new concepts, no new events, no new dependencies. Reuse `resolveActiveSkills`, `resolveContextProviders`, `skillMessages`. `src/` imports no `synapta*`.

## Expected Outcome
- `session.run(input, { activeSkills: ["summarize"] })` against a `SkillRegistry` activates only that skill for the run; `RunOptions.activeSkills: ["translate"]` on the next run activates a different skill — same agent config.
- A skill with `context: [schemaProvider]` injects schema context only when active; inactive skills contribute neither instructions nor context.
- A skill demanding an inactive tool (`toolNames: ["missing"]`) fails fast at activation, before the first provider turn, with the existing `Skill ${name} requires inactive tool: ${missing}` error.
- When `AgentConfig.skills` is a plain `Skill[]` (no registry), `RunOptions.skills: readonly Skill[]` overrides the array for that run. When both `activeSkills` (names) and a registry exist, names win.
- No `RunOptions.activeSkills`/`RunOptions.skills` set → all configured skills active (current behavior bit-for-bit, including `Skill.context` now contributing).
- `npm test` stays network-free and under budget; no new dependencies; `src/` imports no `synapta*` package; boundary tests pass.

## Tasks

- [x] Task 1 — Add `RunOptions.activeSkills` and `RunOptions.skills` contracts
  - Acceptance Criteria:
    - Functional: `RunOptions.activeSkills?: readonly string[]` and `RunOptions.skills?: readonly Skill[]` exist on `RunOptions` in `src/contracts.ts`. Name-resolution (`activeSkills`) and array-override (`skills`) are distinct fields per the roadmap escape hatch. Both optional; both unset preserves current behavior.
    - Performance: Type-only additions; no runtime cost.
    - Code Quality: Fields mirror the existing optional-overrides pattern (`redactor`, `permission`, `validate`). Type-only import of `Skill` from `./contracts.js` already available in-scope (no new import). Names match the roadmap exactly (`activeSkills`, `skills`).
    - Security: No new trust surface; skill selection does not grant permissions or bypass `toolNames` — `resolveActiveSkills` enforces `toolNames` against the active tool set regardless of how skills were selected.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `RunOptions` (lines 150–162): pattern for optional per-run overrides; mirror for the two new fields.
      - `src/contracts.ts` `Skill` (360–366): `context?: readonly ContextProvider[]` is the field this phase activates; `toolNames?: readonly string[]` is the field this phase enforces at the live loop.
      - `src/skills.ts` `ResolveActiveSkillsOptions` (3–7) and `resolveActiveSkills` (33–40): already throws `Skill ${name} requires inactive tool: ${missing}` — enforcement is free once selection routes through it.
      - roadmap Phase 26: `activeSkills?: readonly string[]` (names); explicit `RunOptions.skills?: readonly Skill[]` override for the no-registry case; names win when a registry exists.
    - Options Considered:
      - `activeSkills?: readonly string[]` on `RunOptions` + `skills?: readonly Skill[]` override: matches roadmap exactly, handles both registry and plain-array `AgentConfig.skills`. Chosen.
      - `activeSkills` accepting either names or `Skill[]`: forces a runtime type-narrow at the call site; rejected for being ambiguous and adding branches.
      - `RunOptions.skills` only: cannot resolve by name against a registry, so a host with a registry cannot opt into a subset by name. Rejected.
    - Chosen Approach:
      - Add both fields as distinct optional overrides. The runtime (Task 2) decides precedence: registry + `activeSkills` names → `resolveActiveSkills`; plain-array config + `RunOptions.skills` → array override; neither → `registry.list()` / config array (current behavior).
    - API Notes and Examples:
      ```ts
      // src/contracts.ts — RunOptions additions
      export interface RunOptions {
        // ...existing fields...
        readonly activeSkills?: readonly string[];
        readonly skills?: readonly Skill[];
      }
      ```
      ```ts
      // usage — name-select against a registry
      await session.run(input, { activeSkills: ["summarize"] });
      // usage — plain-array override when AgentConfig.skills is Skill[]
      await session.run(input, { skills: [{ name: "translate", instructions: "..." }] });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `activeSkills?: readonly string[]` and `skills?: readonly Skill[]` to `RunOptions`.
    - References:
      - `src/contracts.ts` (`RunOptions`, `Skill`, `SkillRegistry`), `src/skills.ts` (`resolveActiveSkills`), roadmap Phase 26.
  - Test Cases to Write:
    - Type-level only in this task; behavior covered by Task 3. Confirm `tsc --noEmit` passes with the two new fields accepted on `RunOptions`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — two new `RunOptions` fields on the public run surface.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: document `activeSkills` and `RunOptions.skills` (owned by Task 4).
    - `docs/index.md` update: no — `context-and-skills.md` already indexed; no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Runtime: route skill selection through `resolveActiveSkills`, activate `Skill.context`, enforce `toolNames`
  - Acceptance Criteria:
    - Functional: `RuntimeAgentSession.run()` resolves active skills per run. Precedence: (a) `AgentConfig.skills` is a `SkillRegistry` and `RunOptions.activeSkills` set → `resolveActiveSkills({ registry, names: activeSkills, tools })`; (b) `RunOptions.skills` set (plain array override) → use it directly; names win when a registry exists; (c) neither → current behavior: `AgentConfig.skills` registry → `registry.list()`, plain array → as-is. Every active skill's `context: ContextProvider[]` is collected (`activeSkills.flatMap(s => s.context ?? [])`) and resolved via `resolveContextProviders(...)`, merged into the request `context` *after* host `AgentConfig.context` blocks, before skill instruction messages. `skillMessages()` still renders `skill.instructions` for the active set only. A skill with `toolNames: ["missing"]` against a config missing that tool throws before the first provider turn (via `resolveActiveSkills`).
    - Performance: Selection is O(activeSkills) — no change to hot path; `resolveActiveSkills` is already O(activeSkills · toolNames). `Skill.context` resolution reuses `resolveContextProviders` (already O(providers)).
    - Code Quality: Reuse `resolveActiveSkills` and `resolveContextProviders`; no new selector/context pipeline. Skill-context merge priority marked with a `// ponytail:` comment noting no per-skill token budgeting yet. Host `AgentConfig.context` blocks precede skill-context blocks (documented order). No `synapta*` imports.
    - Security: `toolNames` enforcement is now live in the runtime loop, not just the standalone `resolveActiveSkills` export — satisfies the docs' existing claim. Skill context runs through the same `resolveContextProviders`/redaction path as host context; no bypass.
  - Approach:
    - Documentation Reviewed:
      - `src/skills.ts` `resolveActiveSkills` (33–40): already throws on missing `toolNames` against the provided `tools` set; runtime passes the active `tools` list. This is the enforcement seam.
      - `src/agents.ts` call site (lines 122–127): currently `skills: this.agent.config.skills ? ("list" in this.agent.config.skills ? this.agent.config.skills.list() : this.agent.config.skills) : undefined`. Replace with per-run resolution honoring `RunOptions.activeSkills`/`RunOptions.skills`.
      - `src/input.ts` `assembleProviderInput` (142–172) and `resolveContextProviders` (103–109): already accepts `contextProviders` and resolves them into `ContextBlock[]`. Skill context must be added to the `contextProviders` list (after host `AgentConfig.context`) so the existing resolver handles it.
      - `src/input.ts` `skillMessages` (263–267): already filters to skills with `instructions` and renders system messages; unchanged — just operate on the active set.
      - `src/contracts.ts` `Skill.context` (362): `readonly ContextProvider[]` — already typed, just never wired into the runtime provider-input assembly.
    - Options Considered:
      - Precedence: registry + `activeSkills` names win; `RunOptions.skills` plain-array override only when names are not usable; neither → current behavior. Matches roadmap: "names win when a registry exists". Chosen.
      - Merge `Skill.context` into `contextProviders` before `resolveContextProviders`: reuses the existing resolver and merge; avoids a parallel skill-context pipeline. Chosen.
      - Re-implement skill selection inside `assembleProviderInput`: rejected — runtime owns per-run resolution (it has `RunOptions`); input assembly stays a pure function of its options.
    - Chosen Approach:
      - In `RuntimeAgentSession.run`, near the existing `assembleProviderInput` call site, compute `activeSkills` for the run via a small private helper (`resolveRunSkills(options, tools)`). Pass `skills: activeSkills` into `assembleProviderInput` (already accepted). Pass `contextProviders: [...(this.agent.config.context ?? []), ...activeSkills.flatMap(s => s.context ?? [])]` so skill context resolves through the existing pipeline after host context.
    - API Notes and Examples:
      ```ts
      // src/agents.ts — near the assembleProviderInput call
      const tools = await ...; // existing active tool list
      const activeSkills = this.resolveRunSkills(options, tools);
      const request = await assembleProviderInput({
        // ...existing fields...
        contextProviders: [
          ...(this.agent.config.context ?? []),
          // ponytail: skill context after host context; no per-skill token budget yet.
          ...activeSkills.flatMap((skill) => skill.context ?? []),
        ],
        skills: activeSkills,
        tools,
        // ...
      });
      ```
      ```ts
      // src/agents.ts — private helper
      private resolveRunSkills(options: RunOptions, tools: readonly ToolDefinition[]): readonly Skill[] {
        const configured = this.agent.config.skills;
        if (configured && "list" in configured) {
          if (options.activeSkills) return resolveActiveSkills({ registry: configured, names: options.activeSkills, tools });
          return configured.list();
        }
        // names need a registry; if only a plain array is configured, RunOptions.skills overrides.
        const arr = options.skills ?? (Array.isArray(configured) ? configured : []);
        return arr;
      }
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: add `resolveRunSkills` private helper near other private helpers; replace the existing inline skill-list expression (line ~124) with `activeSkills` from the helper; pass merged `contextProviders` (host + active-skill context) into `assembleProviderInput`. Import `resolveActiveSkills` from `./skills.js`.
    - References:
      - `src/agents.ts` (provider-input assembly call site), `src/skills.ts` (`resolveActiveSkills`), `src/input.ts` (`assembleProviderInput`, `resolveContextProviders`, `skillMessages`), `src/contracts.ts` (`Skill.context`, `SkillRegistry`), roadmap Phase 26.
  - Test Cases to Write:
    - `activeSkills: ["summarize"]` against a registry with `[summarize, translate]` → only `summarize` instructions render; `translate` does not.
    - Two runs on the same session/config with different `activeSkills` activate different skill sets.
    - A skill with `context: [schemaProvider]` injects schema context only when in the active set; removing it from `activeSkills` drops the context.
    - Skill context blocks appear after host `AgentConfig.context` blocks in the assembled request.
    - A skill with `toolNames: ["missing"]` against a config without that tool throws before the first provider turn (assert on the throw).
    - `RunOptions.skills` plain-array override replaces the `AgentConfig.skills` plain array for the run.
    - No `activeSkills`/`RunOptions.skills` → all configured skills active (existing behavior; existing skills tests pass).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — runtime now honors per-run skill selection, `Skill.context`, and `toolNames` enforcement (previously dead/contradicted).
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: document `activeSkills`, `Skill.context` activation, enforced `toolNames` (owned by Task 4).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Runtime skill-selection tests (mock provider, network-free)
  - Acceptance Criteria:
    - Functional: New cases in `src/__tests__/agents.test.ts` (or a focused `skills.test.ts` extension) cover: (a) per-run `activeSkills` selects a subset and only that skill's instructions/context render; (b) two runs with different `activeSkills` on the same config; (c) `Skill.context` provider contributes context only when the skill is active; (d) skill-context blocks come after host context blocks; (e) a skill demanding an inactive tool (`toolNames: ["missing"]`) throws before the first provider turn; (f) `RunOptions.skills` plain-array override; (g) no overrides → all configured skills active.
    - Performance: Tests run in-process against the mock provider; no network; fit within the existing test time budget.
    - Code Quality: Reuse the existing mock-provider + context-assertion patterns from `agents.test.ts`; assert on provider request `messages`/`context`, not internal state.
    - Security: The `toolNames` enforcement test asserts the throw happens before any provider turn — proving no partial side effects (no store writes, no provider calls).
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/agents.test.ts` "uses context providers and selected skills" case: existing pattern for asserting context/skill content in the assembled provider request. Mirror for the new cases.
      - `src/__tests__/skills.test.ts` line 17 (`toolNames: ["echo"]`): existing pattern for `toolNames` in test skills; extend with a runtime-level missing-tool case.
      - `src/input.ts` `contextMessages`/`skillMessages` output: assert against the assembled `request.context` and `request.messages` to prove activation/merge ordering.
    - Options Considered:
      - Extend `agents.test.ts`: colocated with runtime behavior; minimal. Chosen.
      - New `runtime-skills.test.ts`: isolated but adds a file. Only warranted if it grows past ~7 cases. Rejected for now.
    - Chosen Approach:
      - Add cases to `agents.test.ts`. Use a `SkillRegistry` built with two skills (`summarize`, `translate`) — one with a `context` provider — and a mock provider that captures the request. For the `toolNames` enforcement case, register a skill with `toolNames: ["missing"]` and assert `assert.rejects(session.run(...), /requires inactive tool: missing/)`.
    - API Notes and Examples:
      ```ts
      const provider: AIProvider = { id: "mock", async *generate(request) { yield providerDone(); } };
      const schema: ContextProvider = { name: "schema", resolve: () => [{ title: "Schema", content: "selected schema" }] };
      const registry = createSkillRegistry([
        { name: "summarize", instructions: "Summarize.", context: [schema] },
        { name: "translate", instructions: "Translate." },
      ]);
      const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, skills: registry });
      // run A: only summarize active → its context + instructions present, translate absent
      // run B: only translate active → translate's instructions present, schema absent
      ```
    - Files to Create/Edit:
      - `src/__tests__/agents.test.ts`: add the 7 cases above.
    - References:
      - `src/__tests__/agents.test.ts` (context/skill assertion patterns), `src/__tests__/skills.test.ts` (`toolNames` pattern), `src/input.ts` (output shape).
  - Test Cases to Write:
    - Covered by the acceptance criteria above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No — tests only; behavior covered by Task 2 docs.
    - Docs pages to create/edit:
      - `none`: no docs change for test code.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 4 — Docs: `docs/context-and-skills.md` per-run selection, `Skill.context` activation, enforced `toolNames`
  - Acceptance Criteria:
    - Functional: `docs/context-and-skills.md` gains a section documenting (a) `RunOptions.activeSkills` (names) against a `SkillRegistry` and `RunOptions.skills` plain-array override with the "names win when a registry exists" precedence; (b) `Skill.context` activating only for active skills and merging after host `AgentConfig.context`; (c) enforced `toolNames` failing fast at activation. Runnable TypeScript example for `activeSkills`. Page cross-references `resolveActiveSkills`, `resolveContextProviders`, and the `tool_execution_blocked`/skill activation failure path.
    - Performance: N/A (docs only).
    - Code Quality: Example compiles against the current public API; mirror existing `context-and-skills.md` example style.
    - Security: Docs state `toolNames` enforcement is fail-fast at activation (before any provider turn) and that skill selection cannot grant tool access or bypass permissions.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md` (existing `resolveContextProviders`, `createSkillRegistry`, `resolveActiveSkills` examples): extend with the runtime-selection subsection rather than duplicating the standalone helper docs.
      - `.agents/skills/create-plan/references/prism-wiki.md`: API page structure for the extended section.
      - `src/contracts.ts` `RunOptions.activeSkills`/`RunOptions.skills` (added in Task 1) and `Skill.context`/`Skill.toolNames` (existing).
    - Options Considered:
      - Extend `context-and-skills.md` with a "Runtime skill selection" subsection: keeps everything on the existing skills page that already documents `resolveActiveSkills`. Chosen.
      - New `docs/skill-selection.md` page: rejected — too small to warrant its own page; selection is already a `context-and-skills.md` concept.
    - Chosen Approach:
      - Add a "Runtime skill selection and activation" subsection to `context-and-skills.md` with a `createAgent({ skills: registry })` + `session.run(input, { activeSkills: [...] })` example; describe `Skill.context` activation, merge order, `RunOptions.skills` override, and fail-fast `toolNames` enforcement. Cross-link to existing `resolveActiveSkills`/`resolveContextProviders` sections.
    - API Notes and Examples:
      ```ts
      // docs/context-and-skills.md example
      const skills = createSkillRegistry([
        { name: "summarize", instructions: "Summarize.", context: [schemaProvider] },
        { name: "translate", instructions: "Translate." },
      ]);
      const agent = createAgent({ model, provider, skills });
      const session = agent.createSession();
      // only summarize this run; its context provider activates,
      // translate stays inactive
      await session.run(input, { activeSkills: ["summarize"] });
      ```
    - Files to Create/Edit:
      - `docs/context-and-skills.md`: add "Runtime skill selection and activation" subsection + example + security note (fail-fast `toolNames`, no privilege grant).
      - `src/__tests__/docs.test.ts`: extend docs checks to assert the new subsection surfaces `activeSkills`, `Skill.context`, `toolNames`, `RunOptions.skills`, and the fail-fast phrase.
    - References:
      - `docs/context-and-skills.md`, `src/__tests__/docs.test.ts`, `prism-wiki.md` API page structure.
  - Test Cases to Write:
    - `docs.test.ts` asserts `context-and-skills.md` contains `RunOptions.activeSkills`, `Skill.context`, `toolNames`, and a fail-fast phrase.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — documents new `RunOptions` skill fields and now-live `Skill.context`/`toolNames` enforcement.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: runtime selection subsection + example + security note.
    - `docs/index.md` update: no — `context-and-skills.md` already indexed; no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Per-skill token budgeting deferred. Merge order (host `AgentConfig.context`, then skill context) is the only priority knob; there is no per-skill or per-context-block token cap. Marked inline with a `// ponytail:` comment at the assembly call site. Upgrade path: a `ContextBlock.priority`/budget field exists already — wire a budget applier in `assembleProviderInput` if real demand appears.
- `RunOptions.activeSkills` (names) only resolves against a `SkillRegistry`. When `AgentConfig.skills` is a plain `Skill[]` (no registry), names are unusable — the host must use `RunOptions.skills` (plain-array override) instead. This is the roadmap-designated escape hatch; no implicit registry construction from a plain array.
- Naming precedence ("names win when a registry exists") applies only when a registry is configured. With a plain array, `RunOptions.skills` wins outright because there is nothing to resolve names against. Documented in `docs/context-and-skills.md`.
- `Skill.context` is resolved through the existing `resolveContextProviders` pipeline rather than a dedicated skill-context resolver. Reuses the seam (no parallel pipeline) but means skill context blocks are indistinguishable from host context blocks in the assembled request — no provenance tag. Acceptable; provenance would be YAGNI until a debugger/host needs it.
- `toolNames` enforcement is fail-fast at activation only (before the first provider turn). It is not re-checked if the active tool set changes mid-run (it cannot today — tools are resolved once per run), so no extra guard. If tools ever become mutable mid-run, enforcement must move to `dispatchToolCall`.
- No new `skill-selection.md` docs page — runtime selection is a `context-and-skills.md` concept; a subsection reuses it rather than fragmenting. Split out only if the section grows.
- Skill selection runs once per run (before the turn loop), not per turn. A run cannot switch its active skill set mid-loop. Matches roadmap ("per-run" selection); per-turn switching is YAGNI.

## Further Actions
- **Low**: If a host needs per-skill or per-context-block token budgeting, extend `ContextBlock.priority` handling in `assembleProviderInput` rather than adding a skill-path-specific applier. Defer until a real consumer asks.
- **Low**: Consider provenance tagging on resolved `ContextBlock[]` (host vs skill vs extension) if a debugger/host needs to attribute context. No change unless a use case appears; would be a field on `ContextBlock`, not a new pipeline.
- **Low**: Phase 27 (`AgentLoopStrategy`) builds on this per-run resolution pattern — when threading `RunOptions` into the loop context, also expose the resolved `activeSkills` so alternative loops (e.g. generate-validate-revise) see the same skill activation the single-shot loop does.
- **Low**: Phase 29 (filesystem contribution discovery) will produce `SkillRegistry` instances from discovered skills — those registries flow through the same `activeSkills`/`resolveActiveSkills` seam added here, so no runtime change expected. Verify during Phase 29.
- **Low**: If tools ever become mutable mid-run (not currently possible), `toolNames` enforcement must move from activation-time to `dispatchToolCall`-time. Today's guard is sufficient because tools are resolved once per run.
- **None**: No new events, no new primitives, no new dependencies. Phase 26 closes the three skill gaps the roadmap named by reusing `resolveActiveSkills` + `resolveContextProviders` + `skillMessages`.
