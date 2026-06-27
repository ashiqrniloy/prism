# Phase 30 — Package context and instruction injection

## Objectives
- Let a package modify how context is formulated — inject its own instructions and context blocks on the first turn, every turn, or in response to user input — through a Prism-native contract, without forking the input/prompt pipeline and without hidden globals.
- Wire injection through the existing `ExtensionAPI`/`ContributionRegistries` registration seam and the existing default input/prompt assembler + `resolveContextProviders` merge, so injectors are additive contributions, not a parallel pipeline.
- Keep injection strictly inert until the host selects it on `AgentConfig`/`RunOptions`, and incapable of granting tool access, activating skills, or bypassing permissions, redaction, or `toolNames` enforcement.
- Document the injector contract, lifecycle (`first_turn`/`every_turn`/`on_input`), selection, ordering, trust boundary, and the connected discovery from Phase 29 (`.agent/instructions/<name>/`).

## Expected Outcome
- A package registers an `InstructionInjector` via `ExtensionAPI.registerInstructionInjector(...)`; the host selects one or more on `AgentConfig.instructionInjectors` (or `RunOptions.instructionInjectors`, which wins) and they run inside the default input assembler at the documented stage.
- A registered `every_turn` injector that returns `{ instructions: "Always answer in JSON" }` is visible in the assembled provider request on every turn; a `first_turn` injector that returns `{ contextBlocks }` adds project context only on turn 1 of a run.
- An `on_input` injector with a `predicate` runs only on turns whose assembled input matches the predicate; non-matching turns contribute nothing.
- Injectors cannot bypass `toolNames`, permission policies, the `Phase 25` validator, or secret redaction. Injector-produced `instructions`/`contextBlocks` payloads pass through `redactAgentEvent`/`activeRedactor` like any other payload.
- Discovered instruction contributions from Phase 29's `.agent/instructions/<name>/` (and `~/.prism/agent/instructions/<name>/`) register injectors by name and are selectable like any package-provided injector.
- A `docs/instruction-injection.md` page ships with API-page structure, plus a `docs/index.md` entry, a `docs/extensions.md` cross-reference, and a compile-checked example. Boundary tests prove no `synapta*` import, no privilege grant, and no bypass.
- `npm test` stays network-free and under the documented `<30s` budget.

## Tasks

- [x] Task 1 — Primitive review: inventory existing instruction/context primitives before adding code
  - Acceptance Criteria:
    - Functional: A `Primitive Review` subsection is appended under this task documenting, for each Phase 30 concern (instruction contribution, context-block contribution, `when` lifecycle, selection, registration, discovery, redaction), which existing primitive already covers it and which gap requires new code. Reuses the identified primitive where it covers the need; only generic new primitives are proposed.
    - Performance: Review performs no I/O; read + write of analysis text only.
    - Code Quality: Every proposed new file/function is justified against an existing one; no duplicate instruction pipeline, no parallel context merge that re-implements `resolveContextProviders`.
    - Security: Review explicitly states injectors cannot grant tools/skills/permissions and that produced payloads are subject to redaction.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentConfig.instructions: string` (base path, feeds `composeSystemPrompt({base})`), `AgentConfig.systemPrompt: SystemPromptConfig`, `SystemPromptContribution`/`SystemPromptConfig`/`SystemPromptSource`/`SystemPromptMode`, `ContextBlock`, `ContextProvider`, `InputBuilder`/`PromptBuilder`, `ExtensionAPI` (has `registerSystemPromptContribution`, `registerContextProvider`, no `registerInstructionInjector`), `RunOptions` (has no `instructions`).
      - `src/system-prompts.ts` `composeSystemPrompt`/`mergeSystemPromptConfig`/`asContributions` — the layered prompt primitive; injector instructions should layer through this, not beside it.
      - `src/input.ts` `assembleProviderInput`/`resolveContextProviders`/`createDefaultInputBuilder`/`createDefaultPromptBuilder` — the default pipeline injectors must run inside.
      - `src/agents.ts` `RuntimeAgentSession.run`: builds `contextProviders = [...config.context, ...activeSkills.flatMap(s => s.context)]`, `systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(config.systemPrompt, options.systemPrompt), { base: config.instructions })`, then calls `ctx.assemble(...)`. The seam for `turn` is the loop's `for (let turn = 1; ...)` in `src/agent-loops.ts`.
      - `src/agent-loops.ts` `singleShotLoop`/`generateValidateReviseLoop` own `turn` and call `ctx.assemble(nextInput, toolResults)` — `turn` must be plumbed into `assemble`.
      - `src/contributions.ts` `ContributionRegistry<T>` and `ContributionRegistries` (has `systemPromptContributions`, `contextProviders`, `skills`, `tools`, `agents` — no `instructionInjectors`).
      - `src/extensions.ts` `ExtensionKernel` dispatch table for `registerX(...)` calls.
      - `src/node/contribution-discovery.ts` (Phase 29) `readManifestContribution` for `kind: "instructions"` — already produces a manifest-referenced declaration; Phase 30 turns declarations into live `InstructionInjector` objects (host-owned execution, same as tools/context). First-party skill-package precedent (plan 029): no auto `import()` of untrusted modules in core.
      - `src/resources.ts` `loadTextResource`/`assertPermission` — gated read pattern for any filesystem-backed injector.
      - `src/security.ts` `redactAgentEvent`/`activeRedactor` and `redactProviderRequest` — payloads pass through here.
    - Options Considered:
      - Overload `AgentConfig.instructions: string | readonly InstructionInjector[] | SystemPromptConfig` (literal roadmap phrasing): rejected — `SystemPromptConfig` duplicates the existing `AgentConfig.systemPrompt` field, and overloading `instructions` conflates the documented string *base* path with additive injections, inviting type-branch bugs. Use a dedicated `instructionInjectors` field instead (ponytail: shorter, non-breaking, clearer). `AgentConfig.instructions: string` stays the documented base path, bit-for-bit.
      - Make injectors a `MiddlewareHook` (`input_assembly`) reuse: rejected — middleware runs against already-built messages and cannot cleanly express `first_turn`/`every_turn`/`on_input` lifecycle or produce `ContextBlock[]` through the existing context merge. Injectors are a first-class contribution kind.
      - Run injectors inside a custom `InputBuilder` only: rejected — host-supplied custom builders would silently skip injectors; injectors must run in the default assembler path so selection is honored regardless of which default builder is in use.
    - Chosen Approach:
      - Add `InstructionInjector`/`InstructionContribution`/`InstructionContext` to `contracts.ts`; a new `instructionInjectors` `ContributionRegistry`; `ExtensionAPI.registerInstructionInjector`; a dedicated `AgentConfig.instructionInjectors`/`RunOptions.instructionInjectors` selection field; default-assembler integration in `assembleProviderInput` (run, filter by `when`/`predicate`, merge instructions text via `composeSystemPrompt` and contextBlocks through `resolveContextProviders`'s `injectedBlocks` seam); `turn` plumbed through `LoopContext.assemble`.
    - Files to Create/Edit:
      - `plans/030-package-context-and-instruction-injection.md` (this file): append `Primitive Review` subsection once complete.
    - References:
      - `src/contracts.ts`, `src/system-prompts.ts`, `src/input.ts`, `src/agents.ts`, `src/agent-loops.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/node/contribution-discovery.ts`.
      - Roadmap Phase 30; non-negotiable boundaries "Extensible before clever" and "Host controlled. No hidden globals."
      - Plan 029 discovery of `.agent/instructions/<name>/`.
  - **Primitive Review** (Task 1 output — no code; read + analysis only):
    - **Instruction contribution (lifecycle/`when`/`predicate`):** No existing primitive. `SystemPromptContribution` is a static `{id, source, mode, text}` record with no `apply(ctx)`, no `first_turn`/`every_turn`/`on_input`, and no `predicate`. `ContextProvider.resolve(context)` is async and produces only `ContextBlock[]` — no instructions text, no lifecycle. → **Gap, new code:** `InstructionInjector`/`InstructionContribution`/`InstructionContext`/`InstructionTiming` (Task 2). Synapta-free by construction (field names already match the contract review).
    - **Instructions text layering:** Covered. `composeSystemPrompt(contributions, {base})` already ranks contributions by `source` (`package`=0, `app`=1, `user`=2, `run`=3) and supports `append`/`prepend`/`replace`/`disable`. Injector-produced `instructions` route through here as a `source: "package"`, `mode: "append"` contribution (`{ id: "injector:<name>", source: "package", mode: "append", text }`) — no new layering code, no parallel prompt builder. Reuses `mergeSystemPromptConfig` so `RunOptions.systemPrompt: false` still disables everything for the run.
    - **Context-block merge:** Covered by `resolveContextProviders(options)` (iterates `providers`, runs the `context` middleware hook). The runtime already builds `contextProviders = [...config.context, ...activeSkills.flatMap(s => s.context ?? [])]` (host then skill ordering, documented `ponytail:` comment). → **Gap, small new code:** widen `resolveContextProviders`/`assembleProviderInput` to accept `injectedBlocks?: readonly ContextBlock[]` merged at the host-context end (documented index); injector blocks are ready `ContextBlock[]`, not `ContextProvider`s, so they skip per-provider async resolve (injectors are sync per Task 2's `apply()` contract). This is the only merge-order `ponytail:` simplification graded in Task 6.
    - **Selection + name resolution:** Covered by precedent, needs a sibling. `resolveActiveSkills({registry, names, tools})` is the fail-closed name→object resolver (`throw new Error("Unknown skill: ...")`). → **Gap, new code (mirrors existing):** `resolveInstructionInjectors({configured, registry, names})` (Task 5), same fail-closed shape, minus the `toolNames` enforcement (injectors grant no tools).
    - **Run-vs-config override:** Covered. `RuntimeAgentSession.run` resolves per-run overrides with the `options.X ?? this.agent.config.X` idiom (`validate`, `loop`, `providerSource`, `systemPrompt`). → **No gap:** `instructionInjectors` follows the same idiom; `RunOptions.instructionInjectors` wins over `AgentConfig.instructionInjectors`.
    - **Turn scope (for `first_turn`/`every_turn`/`on_input`):** Covered in the loops, **not** in the assembler. Both `singleShotLoop` and `generateValidateReviseLoop` track `for (let turn = 1; ...)` and call `ctx.assemble(nextInput, toolResults)`. `LoopContext.assemble` and `AssembleProviderInputOptions` have no `turn` today. → **Gap, small new code (Task 4):** widen `assemble` with an optional non-breaking `turn?: number` (default `1`); both loops pass their existing `turn`. `InstructionContext` mirrors `LoopContext`'s already-redacted `input`/`history`/`metadata`/`signal` so injectors see the same scope as the loop without new privileges.
    - **Registration:** Covered by `ContributionRegistry<T>` + the `ExtensionAPI` dispatch object pattern. Each `registerX(provider)` in `src/extensions.ts` is a one-line `registries.X.register(key, value)`. → **Gap, new code (mirror):** one `instructionInjectors: ContributionRegistry<InstructionInjector>` on `ContributionRegistries`, one `registerInstructionInjector` dispatch line. No bespoke registry class.
    - **Discovery (`.agent/instructions/<name>/`):** Partially covered — **migration decision required.** Phase 29's `registerDiscoveredContributions` currently routes `kind: "instructions"` into `registries.systemPromptContributions` via `descriptorInstructions(contribution)`, which returns `{id, source: "package", mode: "append", text: "", metadata}` — the existing `ponytail:` comment says "text is empty until the host lifts the resource into actual prompt text (Phase 30 instruction injection)." → **Gap, migration:** Phase 30's live `InstructionInjector` supersedes this. Discovered *markdown-only* instructions (no `module`, no predicate, no lifecycle need) stay loadable as static `SystemPromptContribution`s (text filled by the host loader from `declaration.resource`); discovered *code/module* instructions (need `on_input` + `predicate`, or contextual `ContextBlock[]`) load as live `InstructionInjector` instances via a host-owned `loadInstructionInjector` adapter (Task 7) — no core auto-`import()`, consistent with Phase 29's tool/context stance. The `case "instructions"` branch in `registerDiscoveredContributions` is updated to decide markdown-vs-module; the empty-text `descriptorInstructions` stub is removed or repurposed. Same-name workspace-overrides-global merge order is already handled by Phase 29's scanner; the migration preserves it.
    - **Redaction:** Covered. `redactProviderRequest(request, redactor)` runs on the assembled `ProviderRequest` (via `this.redactProviderRequest(...)` in the `generate` adapter) and `redactAgentEvent(event, activeRedactor)` runs on every `emit`. Runtime redacts `input`/`history` before assemble (`inputToMessages(input).map(m => this.redact(m))` + `this.rebuildHistory()` on redacted store). → **No gap:** injector-produced `instructions`/`contextBlocks` payloads pass through `redactProviderRequest` automatically because they are merged into the `ProviderRequest` the adapter already redacts. `InstructionContext.input`/`history` are already-redacted copies; predicates cannot recover secrets. No new redaction code.
    - **No-privilege enforcement:** Covered by architecture. Injectors only return `{instructions?, contextBlocks?, when, predicate?}`; the assembler ignores any other field. Tool dispatch still flows through `dispatchToolCall({registry, validate, permission, redactor})` — an injector cannot add to `registry` or pre-empt `validate`/`permission`. Skill `toolNames` enforcement runs at activation (`resolveActiveSkills`), independent of injectors. → **No gap:** the contract shape is the enforcement; Task 9's boundary tests assert it explicitly.
    - **Provider discovery:** Explicitly out of scope (credentials), per roadmap and Phase 24's resolver. → **No action.**

- [x] Task 2 — Add injector contract types (core, no Node import)
  - Acceptance Criteria:
    - Functional: `src/contracts.ts` exports `InstructionTiming = "first_turn" | "every_turn" | "on_input";`, `InstructionContext { readonly sessionId: string; readonly runId: string; readonly turn: number; readonly input: readonly Message[]; readonly history: readonly Message[]; readonly metadata: Readonly<Record<string, unknown>>; readonly signal: AbortSignal; }`, `InstructionContribution { readonly instructions?: string; readonly contextBlocks?: readonly ContextBlock[]; readonly when: InstructionTiming; readonly predicate?: (ctx: InstructionContext) => boolean; }`, and `InstructionInjector { readonly name: string; readonly description?: string; apply(ctx: InstructionContext): InstructionContribution; }`. The types are runtime-side-effect-free and the only public surface new to core this task.
    - Performance: Type-only — zero runtime cost.
    - Code Quality: Types live next to `ContextBlock`/`SystemPromptContribution` and reference them, not re-declare fields. No Synapta/domain (`workflow`/`node`/`step`) vocabulary. Exported from `src/index.ts`.
    - Security: Declares no executable, no credential, no tool; injector predicates receive already-redacted context (the runtime passes redacted `input`/`history`).
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ContextBlock`, `Message`, `SystemPromptContribution`, `AgentLoopStrategy` precedents for `name`/description-bearing contribution contracts.
      - `src/contracts.ts` `LoopContext` `turn`/`sessionId`/`runId`/`metadata`/`signal`/`history`/`input` — the fields `InstructionContext` mirrors so an injector sees the same scope as the loop without new privileges.
      - `.agents/skills/create-plan/references/prism-wiki.md` — API page structure (Task 8).
      - Plan 026 precedent (`Skill.context`, `toolNames`) for an additive contribution kind that activates only when selected.
    - Options Considered:
      - One `InstructionContribution` that already embeds resolved `ContextBlock[]` (chosen) vs. a `ContextProvider`-returning shape: chosen — injectors run synchronously per turn and may produce ready blocks; providers are async-resolved and already have their own pipeline. An injector needing async resolution can implement a `ContextProvider` separately and reference it; the injector itself stays sync (ponytail: simplest seam that satisfies the three lifecycle modes).
      - Fold `predicate` into `when` by introducing a fourth timing: rejected — `on_input` + `predicate` is clearer and matches the roadmap wording.
    - Chosen Approach:
      - `InstructionContext` mirrors the runtime turn scope; `InstructionContribution` carries optional `instructions` text and optional `contextBlocks`, plus `when` and an optional `predicate` used only when `when === "on_input"`.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export type InstructionTiming = "first_turn" | "every_turn" | "on_input";

      export interface InstructionContext {
        readonly sessionId: string;
        readonly runId: string;
        readonly turn: number;
        readonly input: readonly Message[];
        readonly history: readonly Message[];
        readonly metadata: Readonly<Record<string, unknown>>;
        readonly signal: AbortSignal;
      }

      export interface InstructionContribution {
        readonly instructions?: string;
        readonly contextBlocks?: readonly ContextBlock[];
        readonly when: InstructionTiming;
        readonly predicate?: (ctx: InstructionContext) => boolean;
      }

      export interface InstructionInjector {
        readonly name: string;
        readonly description?: string;
        apply(ctx: InstructionContext): InstructionContribution;
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `InstructionTiming`, `InstructionContext`, `InstructionContribution`, `InstructionInjector`.
      - `src/index.ts`: re-export via existing `export type * from "./contracts.js"` — **no edit required** (the line already re-exports every contract type, new ones included).
    - References:
      - `src/contracts.ts` existing `ContextBlock`, `Message`, `AbortSignal` usage.
      - Plan 024/026 precedents for contract-first barrel export.

  - Test Cases to Write:
    - `src/__tests__/instruction-injection.types.test.ts` (compile-only): type-imports the four types from the barrel; assignment of a minimal injector and contribution type-checks; a contribution with `when: "on_input"` and a `predicate` type-checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public types `InstructionTiming`, `InstructionContext`, `InstructionContribution`, `InstructionInjector`.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (created in Task 8): document the four types as the injector API.
    - `docs/index.md` update: yes — "Input and prompt assembly" group entry → `docs/instruction-injection.md` (added in Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Add `instructionInjectors` contribution registry + `ExtensionAPI.registerInstructionInjector`
  - Acceptance Criteria:
    - Functional: `ContributionRegistries` gains `readonly instructionInjectors: ContributionRegistry<InstructionInjector>`. `ExtensionAPI` gains `registerInstructionInjector(injector: InstructionInjector): void`. The default `ExtensionKernel` (or equivalent) implementation dispatches the call into the registry. Contributions are lookups-by-name via the existing `ContributionRegistry` `register`/`get`/`resolve`/`list`. An injector with a duplicate `name` overwrites (same semantics as other registries) or fails closed per existing registry behavior — match the existing precedent and test it.
    - Performance: O(1) register/lookup via `Map` (existing `ContributionRegistry` behavior); no per-turn cost from mere registration.
    - Code Quality: Reuses `ContributionRegistry<InstructionInjector>` precisely; no bespoke registry class. Lives beside `systemPromptContributions` in code order. No domain vocabulary.
    - Security: Registration alone is inert; an injector is never invoked until the host selects it on `AgentConfig`/`RunOptions` (Task 5). Registration cannot grant tools, skills, or permissions.
  - Approach:
    - Documentation Reviewed:
      - `src/contributions.ts` `ContributionRegistry<T>` and `ContributionRegistries` (the `skills`/`tools`/`contextProviders`/`systemPromptContributions` pattern to mirror).
      - `src/extensions.ts` `ExtensionAPI.registerSystemPromptContribution`/`registerContextProvider` and the kernel dispatch table — the exact pattern to mirror for `registerInstructionInjector`.
      - `src/provider-packages.ts` `systemPromptContributionKey` — precedent for stable keyed lookup if needed.
    - Options Considered:
      - Reuse the `systemPromptContributions` registry with a discriminator: rejected — `SystemPromptContribution` is a static `{id,source,mode,text}` record, not an invokable `apply(ctx)` injector with lifecycle; conflating them breaks redaction ordering and `when` semantics. A dedicated registry is one `Map` and one dispatch entry.
      - Injectors as `ContextProvider` instances: rejected — providers are async and have no `first_turn`/`instructions` surface.
    - Chosen Approach:
      - One `ContributionRegistry<InstructionInjector>` named `instructionInjectors`, one `registerInstructionInjector` on `ExtensionAPI`, dispatched by the existing kernel mechanism. Namespacing is host-resolved (`@scope/name`); name-collision policy matches the existing registry (documented + tested in Task 6).
    - API Notes and Examples:
      ```ts
      // src/extensions.ts (extension to ExtensionAPI surface)
      registerInstructionInjector(injector: InstructionInjector): void;

      // src/contributions.ts
      export interface ContributionRegistries {
        // ...existing registries...
        readonly instructionInjectors: ContributionRegistry<InstructionInjector>;
      }
      ```
    - Files to Create/Edit:
      - `src/contributions.ts`: add `instructionInjectors` to `ContributionRegistries` and to `createContributionRegistries()`.
      - `src/contracts.ts`: add `registerInstructionInjector(injector: InstructionInjector): void;` to `ExtensionAPI`.
      - `src/extensions.ts`: implement `registerInstructionInjector` in the kernel, delegating to `registries.instructionInjectors.register(...)`.
      - `src/index.ts`: export `ContributionRegistry`/`ContributionRegistries` re-export unchanged (already exported); ensure types flow.
      - **Cascade (realized):** `src/manifests.ts` `ManifestContributionKind` is referenced as `Record<keyof ContributionRegistries, ManifestContributionKind>` in `config-manifests.test.ts`, so the new registry key required adding `"instructionInjector"` to the `ManifestContributionKind` union and the parser `kinds` set. `docs/configuration-and-manifests.md` row + example + phrasing updated to keep the docs.test.ts `manifest_kinds_include_current_provider_primitives` assertion green. These are mechanical cascades of adding the registry, not new design.
    - References:
      - `src/contributions.ts`, `src/extensions.ts`, `src/contracts.ts` `ExtensionAPI`.
      - Plan 005 (extension kernel) and plan 014 (system prompt contribution precedent).

  - Test Cases to Write:
    - Extend `src/__tests__/extensions.test.ts` (or a new `instruction-injection.test.ts`): registering an injector makes it retrievable via `registries.instructionInjectors.get(name)` and listed via `.list()`; registering again with the same name follows the documented duplicate policy.
    - Registering an injector does not add tools, skills, or context providers to their registries (isolation test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `ExtensionAPI.registerInstructionInjector` and `ContributionRegistries.instructionInjectors` are new public surfaces.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (created in Task 8): registration subsection.
      - `docs/extensions.md`: cross-reference to `docs/instruction-injection.md` from the contribution-kinds list (Task 8).
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Plumb `turn` through `LoopContext.assemble` and `AssembleProviderInputOptions`
  - Acceptance Criteria:
    - Functional: `LoopContext.assemble` signature widens to `assemble(nextInput: AgentInput, toolResults?: readonly ToolResult[], turn?: number): Promise<ProviderRequest>` (non-breaking optional param). `singleShotLoop` and `generateValidateReviseLoop` pass their existing per-iteration `turn` into `ctx.assemble(...)`. `AssembleProviderInputOptions` gains `readonly turn?: number`. `assembleProviderInput` forwards `turn` into the `InstructionContext` it builds (Task 5). Default `turn` is `1` when omitted (preserves any external caller's behavior).
    - Performance: Passing an integer is zero-cost; no new I/O.
    - Code Quality: The widening is backward compatible (optional last parameter). Loops pass an already-computed `turn` they already track — no new counters. `ponytail:` comment noting that custom `AgentLoopStrategy` implementations may omit `turn` and injectors will conservatively treat it as turn 1.
    - Security: `turn` is a number, not user content; no payload, no redaction concern.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `LoopContext.assemble` current signature `(nextInput, toolResults?)`.
      - `src/agent-loops.ts` both loops' `for (let turn = 1; ...)` — `turn` is already in scope at the `ctx.assemble(...)` call site.
      - `src/input.ts` `AssembleProviderInputOptions` and `assembleProviderInput`.
    - Options Considered:
      - Store `turn` on `LoopContext` as a mutable field updated by the loop: rejected — `LoopContext` is built once per run and `assemble` is stateless plumbing; passing `turn` as an argument is shorter and avoids mutable shared state.
      - Track turn inside `assembleProviderInput` via a closure counter: rejected — `assembleProviderInput` is a pure function called fresh each turn; it cannot know turn order without the caller telling it.
    - Chosen Approach:
      - Widen `assemble` with an optional `turn` parameter; both loops pass `turn`; default `1`.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export interface LoopContext {
        // ...existing...
        assemble(nextInput: AgentInput, toolResults?: readonly ToolResult[], turn?: number): Promise<ProviderRequest>;
      }

      // src/agent-loops.ts (single-shot, inside the turn loop)
      const request = await ctx.assemble(nextInput, toolResults, turn);
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: widen `LoopContext.assemble`.
      - `src/agent-loops.ts`: pass `turn` at both `ctx.assemble(...)` call sites (single-shot tool-result round and generate-validate-revise revision turn).
      - `src/input.ts`: add `turn?: number` to `AssembleProviderInputOptions` and store it for injector use in Task 5.
      - `src/agents.ts`: forward `turn` from the `ctx.assemble` adapter into `assembleProviderInput({ ... turn })`. `// ponytail: turn threaded from loop; injectors treat undefined as turn 1.`
    - References:
      - `src/agent-loops.ts`, `src/agents.ts`, `src/input.ts`, `src/contracts.ts` `LoopContext`.

  - Test Cases to Write:
    - Existing `src/__tests__/agent-loops.test.ts` still passes (behavior bit-for-bit unchanged when no injectors are configured — `turn` is additive).
    - A unit test asserting `singleShotLoop` passes `turn === 1` on the first assemble and `turn === 2` after one tool round (assert via a spy `assemble` capturing the `turn` arg).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `LoopContext.assemble` signature widened (optional param, backward compatible).
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: note the optional `turn` argument on `LoopContext.assemble`.
    - `docs/index.md` update: no (cross-reference only, page already indexed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Add `AgentConfig.instructionInjectors` / `RunOptions.instructionInjectors` selection and resolution helper
  - Acceptance Criteria:
    - Functional: `AgentConfig` gains `readonly instructionInjectors?: readonly InstructionInjector[];` and `RunOptions` gains `readonly instructionInjectors?: readonly InstructionInjector[];`. `RunOptions.instructionInjectors` overrides `AgentConfig.instructionInjectors` for the run (mirrors `systemPrompt`/`validate`/`loop`). The list may also contain name-referenced contributions from `registries.instructionInjectors` resolved through a new `resolveInstructionInjectors({ configured?: readonly InstructionInjector[]; registry?: ContributionRegistry<InstructionInjector>; names?: readonly string[] })` helper; names that fail to resolve fail closed with an `Unknown instruction injector: <name>` error (mirrors `resolveActiveSkills` from Phase 26). When the runtime selects injectors, it computes the effective list once per run before the loop starts.
    - Performance: Resolution is O(N) over the selected injector list; injectors themselves run per-turn inside the assembler (Task 6).
    - Code Quality: `RunOptions` wins over `AgentConfig`, mirroring existing overrides. `AgentConfig.instructions: string` stays the documented base path (unchanged, bit-for-bit); the new `instructionInjectors` field is strictly additive — a deliberate `ponytail:` simplification from the roadmap's literal "extend the `instructions` surface" union, avoiding conflation with the string base and the separate `systemPrompt` field.
    - Security: Selection cannot reference a missing-since-unregistered injector silently — fail closed. Selection grants nothing beyond instruction/context text.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentConfig` (`systemPrompt`, `validator`, `loop` — the override-on-RunOptions precedent) and `RunOptions` (`systemPrompt`, `validate`, `loop` — RunOptions wins).
      - `src/skills.ts` `resolveActiveSkills({ registry, names, tools })` — the exact fail-closed name-resolution pattern to mirror for `resolveInstructionInjectors`.
      - `src/contracts.ts` `ContributionRegistry<T>` `get`/`list`.
    - Options Considered:
      - Accept only an `InstructionInjector[]` (no name resolution): rejected — Phase 29 discovers injectors by name (`.agent/instructions/<name>/`) and the host/CLI must select them by name like skills (`activeSkills`). Name resolution is required.
      - Overload `AgentConfig.instructions` to a union including `readonly InstructionInjector[]`: rejected (see Task 1) — dedicated `instructionInjectors` field is clearer and non-breaking.
    - Chosen Approach:
      - Dedicated `instructionInjectors` field on both `AgentConfig` and `RunOptions`; `resolveInstructionInjectors` mirrors `resolveActiveSkills` for name → injector resolution with fail-closed semantics.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export interface AgentConfig {
        // ...existing...
        readonly instructionInjectors?: readonly InstructionInjector[];
      }
      export interface RunOptions {
        // ...existing...
        readonly instructionInjectors?: readonly InstructionInjector[];
      }

      // src/instruction-injection.ts (new helper module)
      export interface ResolveInstructionInjectorsOptions {
        readonly configured?: readonly InstructionInjector[];
        readonly registry?: ContributionRegistry<InstructionInjector>;
        readonly names?: readonly string[];
      }
      export function resolveInstructionInjectors(
        options: ResolveInstructionInjectorsOptions,
      ): readonly InstructionInjector[] {
        const fromNames = (options.names ?? []).map((name) => {
          const injector = options.registry?.get(name);
          if (!injector) throw new Error(`Unknown instruction injector: ${name}`);
          return injector;
        });
        return options.configured ?? fromNames;
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `instructionInjectors?` to `AgentConfig` and `RunOptions`.
      - `src/instruction-injection.ts` (new): `resolveInstructionInjectors` (Task 6 will add the assembler-integration `runInstructionInjectors` helper here).
      - `src/index.ts`: export `resolveInstructionInjectors`.
      - `src/agents.ts`: resolve effective injectors once per run (`options.instructionInjectors ?? this.agent.config.instructionInjectors ?? []`) and pass into the `assemble` adapter / `assembleProviderInput` options.
      - `src/input.ts` (cascade, realized): `AssembleProviderInputOptions` also needs `instructionInjectors?: readonly InstructionInjector[]` so the runtime adapter can forward the list into `assembleProviderInput` (Task 6 consumes it). Added alongside the `turn?` field added in Task 4. Required importing `InstructionInjector` into `input.ts`.
    - References:
      - `src/contracts.ts`, `src/skills.ts` (`resolveActiveSkills`), `src/agents.ts` `resolveRunSkills` precedents.

  - Test Cases to Write:
    - `RunOptions.instructionInjectors` overrides `AgentConfig.instructionInjectors` for the run (resolve via the helper, assert the RunOptions list wins).
    - Selecting by name against a `ContributionRegistry<InstructionInjector>` resolves each; a missing name throws `Unknown instruction injector: <name>`.
    - `AgentConfig.instructions: string` base path still feeds `composeSystemPrompt({base})` unchanged when `instructionInjectors` is also set (no regression).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `AgentConfig.instructionInjectors`, `RunOptions.instructionInjectors`, and `resolveInstructionInjectors` are new public surfaces.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (created in Task 8): selection + override semantics, fail-closed name resolution.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Integrate injectors into the default input/prompt assembler
  - Acceptance Criteria:
    - Functional: `assembleProviderInput` accepts `instructionInjectors?: readonly InstructionInjector[]` (already added in Task 5) and `turn`. For each selected injector it builds an `InstructionContext` (sessionId, runId, turn, redacted `input`, redacted `history`, metadata, signal), calls `injector.apply(ctx)`, and applies the contribution iff: `when === "first_turn"` and `turn === 1`; OR `when === "every_turn"`; OR `when === "on_input"` and (no `predicate`, or `predicate(ctx)` returns `true`). Matching contributions' `instructions` text is layered into the assembled request through `composeSystemPrompt` as a `SystemPromptContribution` with `source: "package"` (so redaction/merge/replace modes apply uniformly); contributions' `contextBlocks` are merged into the resolved `context` array after host `AgentConfig.context` blocks and before skill-context blocks, via an `injectedBlocks?: readonly ContextBlock[]` seam added to `resolveContextProviders` (or equivalent documented merge point). Non-matching injectors contribute nothing. A custom `InputBuilder` supplied by the host still receives `instructionInjectors`/`turn` in its context so it can opt to run them (documented requirement); the default builder runs them by default.
    - Performance: Injector `apply` runs once per injector per turn — O(I) per turn, I = selected count. Injectors are expected to be cheap (synchronous text/blocks); document that async work belongs in a `ContextProvider`, not an injector.
    - Code Quality: Instructions text routes through the existing `composeSystemPrompt` path — no parallel prompt-composition code. `contextBlocks` route through the existing `resolveContextProviders` — no parallel context pipeline. `ponytail:` comment on the host-vs-skill block split ordering: if precise "before skill contributions" ordering ever needs per-block granularity, split `contextProviders` by origin at that point; for now host providers resolve before skill providers because the runtime builds `[...config.context, ...skillContext]` in that order, and injector blocks insert at the documented index.
    - Security: `input`/`history` passed to predicates are already-redacted copies (runtime redacts before assemble). Injector-produced `instructions`/`contextBlocks` are subject to `redactProviderRequest`/`activeRedactor` like any other payload. Injectors cannot register tools, activate skills, or set permissions — the assembler ignores anything but `instructions`/`contextBlocks` text.
  - Approach:
    - Documentation Reviewed:
      - `src/input.ts` `assembleProviderInput` (`systemInstructions`, `contextProviders`, `resolveContextProviders`, `createDefaultPromptBuilder`).
      - `src/system-prompts.ts` `composeSystemPrompt`/`asContributions` — instructions text becomes a `SystemPromptContribution { id: `injector:<name>`, source: "package", mode: "append", text }` so existing merge/replace and redaction apply.
      - `src/agents.ts` `RuntimeAgentSession.run` — where `systemInstructions` and `contextProviders` are constructed; the assembler hook lives inside `assembleProviderInput`, which the `ctx.assemble` adapter wraps, so injectors run at the documented stage without runtime changes beyond passing the list + turn.
      - `src/resources.ts`/`src/security.ts` redaction entry points.
    - Options Considered:
      - Run injectors in `RuntimeAgentSession.run` and pre-build instructions/context before calling `assemble`: rejected — that bypasses `turn` discrimination inside the loop (turn is loop-local) and re-implements assembly ordering in two places. Run inside `assembleProviderInput`.
      - Build a separate `ContextBlock[]` array for injector blocks and prepend to the prompt builder output: rejected — bypasses `resolveContextProviders` middleware (`context`) hooks; route through the existing merge so middleware still runs.
    - Chosen Approach:
      - `assembleProviderInput` runs the injectors, filters by `when`/`predicate`, and merges: instructions → a `package`-source `SystemPromptContribution` fed to `composeSystemPrompt`; contextBlocks → appended into `resolveContextProviders`'s output at the documented split index (host-context end = `options.contextProviders?.length - <skill-context count>`; since the runtime passes host+skill providers as one list, the split is computed from the caller-provided `hostContextLength` option, or injector blocks are appended after skill blocks as a documented `ponytail:` simplification — see test).
    - API Notes and Examples:
      ```ts
      // src/instruction-injection.ts
      export function runInstructionInjectors(
        injectors: readonly InstructionInjector[],
        ctx: InstructionContext,
      ): { readonly instructions: readonly SystemPromptContribution[]; readonly contextBlocks: readonly ContextBlock[] } {
        const instructions: SystemPromptContribution[] = [];
        const contextBlocks: ContextBlock[] = [];
        for (const injector of injectors) {
          if (isAborted(ctx.signal)) break;
          const contribution = injector.apply(ctx);
          if (!shouldApply(contribution, ctx)) continue;
          if (contribution.instructions) {
            instructions.push({ id: `injector:${injector.name}`, source: "package", mode: "append", text: contribution.instructions });
          }
          if (contribution.contextBlocks) contextBlocks.push(...contribution.contextBlocks);
        }
        return { instructions, contextBlocks };
      }

      function shouldApply(contribution: InstructionContribution, ctx: InstructionContext): boolean {
        if (contribution.when === "first_turn") return ctx.turn === 1;
        if (contribution.when === "every_turn") return true;
        return contribution.predicate ? contribution.predicate(ctx) : true; // on_input, no predicate = always
      }
      ```
    - Files to Create/Edit:
      - `src/instruction-injection.ts`: `runInstructionInjectors` + `shouldApply`.
      - `src/input.ts`: accept `instructionInjectors?` + `turn` in `AssembleProviderInputOptions`; build `InstructionContext` from redacted input/history; call `runInstructionInjectors`; merge instructions into `systemInstructions` (via `composeSystemPrompt`) and `contextBlocks` into the resolved `context` array; widen `resolveContextProviders` to accept `injectedBlocks?` or append at the documented merge point.
      - `src/agents.ts`: in the `ctx.assemble` adapter, pass `instructionInjectors: resolvedInjectors` and `turn` into `assembleProviderInput` (alongside existing `systemInstructions`, `contextProviders`, etc.).
    - References:
      - `src/input.ts`, `src/system-prompts.ts`, `src/agents.ts`, `src/security.ts`.

  - Test Cases to Write:
    - An `every_turn` injector returning `{ instructions: "Always answer in JSON" }` produces a system message present in the assembled provider request on turn 1 and turn 2 (tool-result round).
    - A `first_turn` injector returning `{ contextBlocks: [...] }` contributes blocks only when `turn === 1`; turn 2 contributes nothing.
    - An `on_input` injector with a `predicate` matching only user input containing `"schema"` contributes on matching turns, not on others; `on_input` without a `predicate` contributes every turn (documented default).
    - A host-supplied custom `InputBuilder` still receives the injector list and `turn` in its `DefaultInputBuildContext` (it may run them via `runInstructionInjectors` or ignore them).
    - Injector-produced `instructions`/`contextBlocks` payloads are passed through `redactProviderRequest` (a known secret token in the injected text is redacted in the outgoing request).
    - An injector that returns a contribution referencing a tool/skill/permission field is ignored — only `instructions`/`contextBlocks`/`when`/`predicate` are honored.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default assembler behavior gains injector execution; `runInstructionInjectors` is exported.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (Task 8): lifecycle table, filtering rules, ordering, redaction, custom-builder note.
      - `docs/context-and-skills.md`: cross-reference that injectors add context blocks through the same merge.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Wire Phase 29 discovered instruction contributions to live injector instances (host-owned execution)
  - Acceptance Criteria:
    - Functional: A contribution discovered by Phase 29 at `<workspace>/.agent/instructions/<name>/` (or `~/.prism/agent/instructions/<name>/`) with a manifest declaration is loadable into `registries.instructionInjectors`. Execution of any declared `module`/`exportName` remains host-owned (no core auto-`import()`); the host/CLI loader resolves the module and registers the resulting `InstructionInjector`. A pure-markdown injector (`SKILL.md`-style, no `module`) loads as a static text injector ({ instructions, when: "every_turn" }) — mirrors how Phase 29 loads pure-text skills. Same-named workspace injector overrides global (Phase 29 merge order).
    - Performance: Load is O(N) over discovered instructions dirs; runs only at explicit loader invocation, never on plain SDK in-memory use.
    - Code Quality: Reuses Phase 29's scanner; adds only an "instructions" adapter that produces an `InstructionInjector` (static for markdown, module-referenced for code). `ponytail:` comment that module execution is host-owned (consistent with tools/context in Phase 29).
    - Security: No filesystem access without the explicit host/CLI loader (in-memory SDK path unchanged). Untrusted workspace declarations reuse the Phase 10/16 `TrustPolicy`; a module-referenced injector is not auto-imported.
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts` `readManifestContribution` for `kind: "instructions"` — already produces a declaration; Phase 30 adds the adapter that turns it into a registered `InstructionInjector`.
      - `src/contributions.ts` `descriptorInstructions` — existing extraction of instruction text from discovered contributions (the static-text path).
      - `src/skills.ts` `createSkillRegistry` for the pure-markdown → contribution precedent.
      - Roadmap Phase 29 layout for `.agent/instructions/<name>/`.
    - Options Considered:
      - Auto-`import()` declared modules inside core: rejected (host-controlled only, matches Phase 29's tools/context stance).
      - Only support pure-markdown injectors: rejected — code injectors (with predicates) are needed for `on_input`; host-owned module resolution covers them.
    - Chosen Approach:
      - A small `loadInstructionInjector(contribution: DiscoveredContribution): InstructionInjector` adapter: markdown → static `{ name, apply: () => ({ instructions, when: "every_turn" }) }`; module-referenced → the host imports the module and the adapter wraps the exported `InstructionInjector`. Core supplies the adapter; the host/CLI loader performs the import.
    - Files to Create/Edit:
      - `src/node/contribution-injectors.ts` (new): `loadInstructionInjector` adapter + loader wiring into `registries.instructionInjectors`.
      - `src/cli-runner.ts` (or the Phase 29 CLI loader entry): invoke the loader so discovered injectors register.
      - `src/index.ts`: export `loadInstructionInjector` (Node entry, gated) if appropriate, or keep Node-only via `src/node` barrel.
      - **Cascade (realized):** Phase 29's scanner built the kind dir as `${kind}s`, producing `instructionss`/`contexts`, but the documented layout (docs + plan) is `.agent/{skills,tools,context,instructions,agents}/`. No Phase 29 test exercised the on-disk `instructions`/`context` kinds (only synthetic in-memory `DiscoveredContribution`s were tested), so the bug was latent. Fixed in `src/node/contribution-discovery.ts` with an explicit `kindDirName(kind)` map (`instructions`→`instructions`, `context`→`context`, `skill`→`skills`, `tool`→`tools`, `agent`→`agents`). Added a `ponytail:` comment naming it as a Phase 29 fix. Backward compatible for skill/tool/agent (unchanged dir names).
    - References:
      - `src/node/contribution-discovery.ts`, `src/contributions.ts`, plan 029.

  - Test Cases to Write:
    - A discovered markdown instructions file at `.agent/instructions/json-always/` loads as a static `every_turn` injector selectable by name `"json-always"`.
    - A workspace same-name injector overrides a global one (Phase 29 merge order preserved for the instructions kind).
    - In-memory SDK use (no loader) registers zero injectors; `resolveInstructionInjectors({ names: ["x"] })` against an empty registry throws `Unknown instruction injector: x` — proving no hidden discovery.
    - A module-referenced declaration is not auto-imported by core; the test registers the injector manually via the host-owned step and asserts it runs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — discovered instruction contributions become live injectors; `loadInstructionInjector` is a Node public helper.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (Task 8): discovery + loading subsection.
      - `docs/contribution-discovery.md`: cross-reference to `docs/instruction-injection.md` for the instructions kind.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — Add CLI/RPC selection of injectors
  - Acceptance Criteria:
    - Functional: The CLI accepts `--instruction <name>` (repeatable) and/or `--injector-file <path>` to select injectors for a print/json/rpc run, mapping to `RunOptions.instructionInjectors` (resolved by name against the registered + discovered injectors). The RPC `prompt`/`run` command accepts an `instructionInjectors?: readonly string[]` (names) field in its request payload. Omitting the flag behaves as today (no injectors). `--instruction false` disables injectors for the run even if `AgentConfig` had them.
    - Performance: Name resolution is O(N); negligible.
    - Code Quality: Mirrors the existing `--skill`/`activeSkills` and `--system-prompt` CLI patterns. No new discovery in core; the CLI uses the Phase 29 loader if enabled.
    - Security: The CLI does not auto-load untrusted module injectors; module-referenced injectors require explicit trust (reuse Phase 10/16 trust flow). Discovered markdown injectors follow the workspace trust model.
  - Approach:
    - Documentation Reviewed:
      - `src/cli-runner.ts` existing flag handling (`--skill`, `--system-prompt`, `--active-skills` precedents).
      - `src/contracts.ts` `RunOptions.instructionInjectors`.
    - Options Considered:
      - Only support name selection (no file override): chosen for the CLI flag; `--injector-file` is a thin convenience that reads a markdown file into a static injector. Keep minimal.
    - Chosen Approach:
      - `--instruction <name>` repeatable → `RunOptions.instructionInjectors` resolved via `resolveInstructionInjectors({ registry, names })`. `--instruction false` → empty list.
    - Files to Create/Edit:
      - `src/cli-runner.ts`: parse `--instruction`/`--injector-file`; resolve names; pass `RunOptions.instructionInjectors`.
      - RPC handler (in `src/cli-runner.ts` or the RPC module): accept `instructionInjectors` names in prompt/run payloads, resolve, forward.
      - **Cascade (realized):** `src/rpc.ts` had a latent hang on fail-closed `runOptions` errors — `runOptions` was called inside the async promise after `pumpEvents` opened the event subscription, so a synchronous throw (e.g. `Unknown instruction injector`) stranded the `for await (const event of session.subscribe())` loop forever (no run ever started, so the subscription never ended). Fixed by resolving `runOptions(state, request.params)` BEFORE opening `pumpEvents`; a resolution error now throws into `handleRequest`'s outer try/catch and writes a clean error response. `ponytail:` comment added. This also hardens pre-existing RPC behavior for any future `runOptions` failure.
    - References:
      - `src/cli-runner.ts`, plan 012 (CLI/RPC).

  - Test Cases to Write:
    - `prism -p "hi" --instruction json-always` with a registered `json-always` injector produces a request whose system messages include the injector's instructions; without the flag they do not.
    - `--instruction false` yields zero injectors.
    - RPC `prompt` with `instructionInjectors: ["missing"]` returns an error correlation (fail closed), not a silent run.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new CLI flags and an RPC request field.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: document `--instruction`/`--injector-file` and the RPC `instructionInjectors` field.
      - `docs/instruction-injection.md` (Task 8 run): CLI/RPC usage example.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — Boundary, redaction, and privilege tests; docs.test enforcement
  - Acceptance Criteria:
    - Functional: A new `src/__tests__/phase30-boundaries.test.ts` asserts: (a) `src/` (non-`node/`) imports no `synapta*`; (b) `InstructionContext`/`InstructionContribution`/`InstructionInjector` field names contain no `workflow`/`node`/`step`; (c) registering + selecting an injector does not add entries to `tools`/`skills`/`contextProviders`/`systemPromptContributions` registries beyond the injector registry itself; (d) an injector cannot cause a `tool_call` to dispatch against a tool not in the active registry (still fail-closed via Phase 4/26); (e) an injector cannot bypass the Phase 25 `validator` (a validator that blocks still blocks an `instructionInjectors`-selected run); (f) secrets present in injector-produced `instructions`/`contextBlocks` are redacted in the outgoing `ProviderRequest` and in emitted events. The `docs.test.ts` suite enforces the new `docs/instruction-injection.md` page present in `docs/index.md` and following the prism-wiki API page structure.
    - Performance: Boundary tests are static/import checks; sub-second.
    - Code Quality: Boundary test mirrors `phase27-boundaries.test.ts`/`phase28-boundaries.test.ts` style. No new framework.
    - Security: This task is the security gate — every assertion above is a non-regression for the non-negotiable "Secrets never enter history/events" and "no built-in app tools / no privilege grant" boundaries.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/phase27-boundaries.test.ts`, `phase28-boundaries.test.ts` — the boundary-test pattern (grep `src/**/*.ts` import lines, assert field-name vocabulary).
      - `src/__tests__/docs.test.ts` — drivers that enforce docs pages exist and follow the wiki structure.
      - `src/security.ts` `redactProviderRequest`/`redactAgentEvent`.
    - Options Considered:
      - Reuse an existing boundary test file: rejected — Phase 30 introduces a new contribution kind; a dedicated `phase30-boundaries.test.ts` keeps the audit trail clear and matches the phase-numbered convention.
    - Chosen Approach:
      - One new boundary file + extend `docs.test.ts` with the `instruction-injection.md` page assertion following the existing provider/compaction page checks.
    - Files to Create/Edit:
      - `src/__tests__/phase30-boundaries.test.ts` (new).
      - `src/__tests__/docs.test.ts`: add `instruction-injection.md` to the enforced-pages list.
      - **Cascade (realized):** `docs/instruction-injection.md` and the `docs/index.md` entry were created here (minimal API-page skeleton with required headings) rather than Task 8, because Task 9's `docs.test` enforcement requires the page + headings to exist and to be linked from the index. Task 10 will expand the skeleton into the full content (lifecycle table, ordering, redaction, discovery, CLI/RPC) without touching the headings the test now pins. Added `instruction-injection.md` to `apiPages` so the `api_pages_include_required_headings` loop enforces every prism-wiki heading, plus a dedicated `instruction_injection_page_is_linked_from_index_and_follows_api_structure` test asserting index linkage + Phase 30 contract vocabulary (`InstructionInjector`/`InstructionContribution`/`InstructionContext`/`registerInstructionInjector`/`resolveInstructionInjectors`/`first_turn`/`every_turn`/`on_input`/`AgentConfig.instructionInjectors`/`RunOptions.instructionInjectors`).
    - References:
      - `src/__tests__/phase27-boundaries.test.ts`, `src/__tests__/docs.test.ts`, `src/security.ts`.

  - Test Cases to Write:
    - Listed in the Acceptance Criteria above (a–f) plus the `docs.test.ts` page-presence assertion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new public surface — test-only. Tests enforce the docs page.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (created in Task 10) is asserted present here.
    - `docs/index.md` update: enforced here (must contain the entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 10 — Docs page, index entry, extensions cross-reference, and compile-checked example
  - Acceptance Criteria:
    - Functional: `docs/instruction-injection.md` created following the prism-wiki API-page structure (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs), covering: `InstructionInjector`/`InstructionContribution`/`InstructionContext`/`InstructionTiming` contracts; registration via `ExtensionAPI.registerInstructionInjector`; selection on `AgentConfig.instructionInjectors`/`RunOptions.instructionInjectors` and `resolveInstructionInjectors` fail-closed name resolution; lifecycle table (`first_turn`/`every_turn`/`on_input` + `predicate`); ordering (instructions via `composeSystemPrompt` `source: "package"`; contextBlocks via `resolveContextProviders` merge, after host context, before skill contributions — with the documented `ponytail:` simplification); redaction; the no-privilege-grant boundary; Phase 29 discovery loading; CLI `--instruction`/`--injector-file` and RPC `instructionInjectors`. `docs/index.md` gets an "Input and prompt assembly" group entry → `docs/instruction-injection.md`. `docs/extensions.md` cross-references `InstructionInjector` in its contribution-kinds list. A compile-checked `examples/instruction-injection.ts` demonstrates an `every_turn` JSON-format injector, a `first_turn` project-context injector, an `on_input` predicate injector, discovery via `.agent/instructions/<name>/`, and CLI selection.
    - Performance: Docs/example compile only; example runs network-free with the mock provider.
    - Code Quality: Example compiles under `tsc --noEmit` as part of the examples compile check. No real secrets in fixtures.
    - Security: Example uses the mock provider; no credentials in fixtures; demonstrates redaction of an injected secret token.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` — API page structure enforced for the new page.
      - `docs/index.md` functional group layout.
      - `docs/extensions.md` contribution-kinds list (where to add the cross-reference).
      - Existing compile-checked examples under `examples/` (e.g. plan 018/021 examples).
    - Options Considered:
      - Split into multiple pages (injector contract vs. discovery vs. CLI): rejected — one page with clear sections is shorter and matches the wiki reference; sub-topics are cross-referenced from `contribution-discovery.md`/`cli-rpc.md`.
    - Chosen Approach:
      - One `docs/instruction-injection.md` page; index + extensions cross-refs; one compile-checked example covering all three lifecycle modes and discovery.
    - Files to Create/Edit:
      - `docs/instruction-injection.md` (new).
      - `docs/index.md`: add entry under "Input and prompt assembly".
      - `docs/extensions.md`: add `InstructionInjector` to the contribution-kinds list with a link.
      - `docs/context-and-skills.md`: one-line cross-reference to instruction injection for context-block contributions.
      - `examples/instruction-injection.ts` (new, compile-checked).
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`, `docs/index.md`, `docs/extensions.md`.
    - **Cascade (realized):** the index entry (`docs/index.md` under "Input, prompt, and context assembly") and the minimal `docs/instruction-injection.md` skeleton were created in Task 9 to satisfy Task 9's `docs.test` enforcement; Task 10 expanded the skeleton into the full content (lifecycle table, ordering, redaction, discovery, CLI/RPC, no-privilege boundary) without touching the required headings the test pins. `examples/instruction-injection.ts` was wired into both `exampleFiles` (existence) and the runnable `demos` list in `docs.test.ts` so `examples_demos_run_to_completion_and_emit_no_secret` both compiles and executes it network-free. Example workspace fixtures committed under `examples/instruction-injection-workspace/.agent/instructions/json-always/` (manifest + INSTRUCTIONS.md).

  - Test Cases to Write:
    - `src/__tests__/docs.test.ts` (extended in Task 9) asserts `docs/instruction-injection.md` exists and contains each required prism-wiki heading.
    - The examples compile check (`tsc --noEmit` on `examples/`) includes `examples/instruction-injection.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task IS the documentation deliverable for the Phase 30 public surface.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md` (new), `docs/index.md`, `docs/extensions.md`, `docs/context-and-skills.md`.
    - `docs/index.md` update: yes — "Input and prompt assembly" group entry → `docs/instruction-injection.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- (Task 2 realized) `src/index.ts` needed no edit: the existing `export type * from "./contracts.js"` line re-exports every contract type including the new injector types. `plan/030-...md` Task 2 had listed an explicit named re-export; collapsed to the existing wildcard. Functionally identical, one fewer file touched.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority. Anticipated: per-skill/per-injector token budgeting for context blocks (currently none — `ponytail:` comment in `agents.ts`); a `compose-later` array-merge for `RunOptions.instructionInjectors` + `AgentConfig.instructionInjectors` if a real consumer needs both rather than override; a richer default `on_input` repairer analog if injectors ever need to react to model output (currently react only to input/history).
