# Phase 32 — Synapta-facing integration example and boundary lock

## Objectives

- Prove end-to-end that a third party (Synapta-style host) can use Prism with its own providers, tools, and skills plus optional first-party ones, without any Synapta types leaking into `src/`.
- Exercise the existing seams added in Phases 24–31: `providerSource`/`createProviderResolver`, `AgentConfig.validator`/`RunOptions.validate`, `Skill.context` + `activeSkills`, `generate-validate-revise` loop, artifact events, workspace/global discovery, instruction injection, and `AGENTS.md`/`SYSTEM.md` system prompts. (Declarative agent resolution is Phase 33 and not exercised here.)
- Harden boundary tests so `src/` never imports `synapta*`, artifact contracts stay free of workflow/node/step vocabulary, and generic validator/parser shapes remain domain-agnostic.
- Add a compile-checked `examples/synapta-style-artifact-loop.ts` demo and extend `/docs/structured-output.md` with an end-to-end third-party schema example.

## Expected Outcome

- `examples/synapta-style-artifact-loop.ts` compiles under `examples/tsconfig.json`, runs network-free with the mock provider, emits the full artifact event sequence, and ends with `artifact_finished.result.ok === true`.
- The example imports only Prism public exports and host-owned types; no `synapta*` import appears in `examples/` or `src/`.
- `src/__tests__/phase32-boundaries.test.ts` fails if any `src/**/*.ts` file imports `synapta*`, if artifact contract fields contain `workflow`/`node`/`step`, or if validator/parser types are narrowed to domain types.
- `docs/structured-output.md` contains an end-to-end example showing a third-party schema mapped to `ArtifactValidation` across provider resolver, tools, skills, system prompts, and the artifact loop.
- `docs/index.md` and `examples/README.md` reference the new example.
- No new core surface is added: `src/contracts.ts`, `src/index.ts`, and `package.json` exports remain unchanged.

## Tasks

- [x] Task 1 — Primitive review: confirm no new core surface is required
  - Acceptance Criteria:
    - Functional: A `Primitive Review` subsection is appended under this task documenting, for each Phase 32 concern (provider resolver mix, tool registration/dispatch, skill activation + `Skill.context`, system-prompt file loading, generate-validate-revise loop, artifact events, redaction, boundary assertions), which existing primitive covers it and why no new core code is needed.
    - Performance: Review performs no I/O; read + write of analysis text only.
    - Code Quality: Every proposed new file is justified against an existing seam; no new contract type, no new registry, no new runtime module.
    - Security: Review explicitly states the example must keep secrets out of events/store/docs and must use the active redactor.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ProviderResolver`/`RunOptions.providerSource`, `AIProvider`, `AgentConfig.provider`/`providerSource` — Phase 24 seam.
      - `src/contracts.ts` `ToolValidator`, `DispatchToolCallOptions.validate`, `AgentConfig.validator`, `RunOptions.validate` — Phase 25 seam.
      - `src/contracts.ts` `Skill.context`, `Skill.toolNames`, `RunOptions.activeSkills`, `RunOptions.skills` — Phase 26 seam.
      - `src/contracts.ts` `AgentLoopStrategy`, `AgentLoopOptions`, `ArtifactParser`/`ArtifactValidator`/`ArtifactRepairer`/`ArtifactValidation`, plus `AgentEvent` artifact variants — Phases 27–28 seams.
      - `src/node/system-project-prompts.ts` `loadSystemPromptFiles` — Phase 31 seam.
      - `src/node/contribution-discovery.ts` `discoverContributions`/`DiscoveredContribution` and `src/node/instruction-injectors.ts` — Phase 29–30 seams.
      - `src/agents.ts` `RuntimeAgentSession.run` / `src/loops.ts` `generateValidateReviseLoop` — runtime wiring that already consumes the above seams.
      - `src/redaction.ts` `createSecretRedactor`/`redactAgentEvent` — secret handling.
      - `src/__tests__/phase29-boundaries.test.ts`, `phase30-boundaries.test.ts`, `phase31-boundaries.test.ts` — boundary-test precedent.
      - Roadmap Phase 32 and non-negotiable boundaries: no built-in app tools, no hidden globals, generic seams only.
    - Options Considered:
      - Add a new `synapta` example package or workspace: rejected — a single compile-checked example file exercises the seams without new packaging.
      - Add new core types for "third-party integration": rejected — Phase 32 explicitly ships no new core surface; all needed seams exist.
      - Extend existing boundary test files instead of a phase-specific file: rejected — per-phase boundary files keep failures greppable and independent.
    - Chosen Approach:
      - Document reuse of Phases 24–31 primitives.
      - Create only `examples/synapta-style-artifact-loop.ts`, `src/__tests__/phase32-boundaries.test.ts`, and docs/example-list updates.
    - API Notes and Examples:
      ```ts
      // Existing seams exercised by the example (no new exports)
      const resolver = createProviderResolver([
        setupOpenAICompatiblePackage(registries), // first-party package
        createMockProvider(...),                  // third-party/own
      ]);
      await session.run(input, {
        providerSource: resolver,
        activeSkills: ["schema-skill"],
        loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 },
      });
      ```
    - Files to Create/Edit:
      - `plans/032-synapta-facing-integration-example-and-boundary-lock.md` (this file): append `Primitive Review` subsection once complete.
    - References:
      - `src/contracts.ts`, `src/loops.ts`, `src/agents.ts`, `src/node/system-project-prompts.ts`, `src/node/contribution-discovery.ts`, `src/redaction.ts`.
      - Plans 024–031.
  - Test Cases to Write:
    - (No code; Task 2–3 cover verification.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — Phase 32 adds no public API.
    - Docs pages to create/edit: `docs/structured-output.md` (Task 4) and `docs/index.md`/`examples/README.md` navigation only; no API page changes.
    - `docs/index.md` update: yes — add/update the Structured output entry to mention the end-to-end example and `examples/synapta-style-artifact-loop.ts` (Task 4).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Primitive Review** (Task 1 output — no code; read + write of analysis only):
    - **Provider resolver mix (first-party + third-party/own):** Covered. `ProviderResolver = (model: ModelConfig) => AIProvider | undefined` (`src/contracts.ts`) plus `createProviderResolver(source: ProviderRegistry | readonly AIProvider[]): ProviderResolver` (`src/providers.ts`) lets a host hand Prism a resolver built from any mixture of first-party package providers, its own mock providers, or a registry. `RuntimeAgentSession.run` resolves per run via `options.providerSource ?? config.providerSource ?? config.provider` (`src/agents.ts:resolveRunProvider`). → **No new core code.** The example will pass an array containing an inline "first-party" mock provider and a third-party mock provider to `createProviderResolver`, exactly as `examples/provider-resolver.ts` already demonstrates.
    - **Tool registration/dispatch and runtime validation:** Covered. `createToolRegistry(tools)` and `dispatchToolCall({call, registry, validate, ...})` (`src/tools.ts`) provide host-owned tool lookup, active filtering, argument-shape checks, middleware, permission checks, and the `ToolValidator` hook. `AgentConfig.validator` and `RunOptions.validate` are already threaded into `dispatchToolCall` (`src/agents.ts`). A validator returning a string/`ErrorInfo` produces a `tool_execution_blocked` event with reason `validation_failed`. → **No new core code.** The example registers one third-party tool and one first-party tool in a single `ToolRegistry` and optionally demonstrates `RunOptions.validate`.
    - **Skill activation + `Skill.context` + `toolNames` enforcement:** Covered. `Skill` carries `instructions`, optional `context: readonly ContextProvider[]`, and `toolNames` (`src/contracts.ts`). `createSkillRegistry`/`resolveActiveSkills({registry, names, tools})` (`src/skills.ts`) selects skills by name and throws if a demanded tool is missing from the active tool set. `RuntimeAgentSession.run` merges `activeSkills.flatMap(s => s.context ?? [])` after host `AgentConfig.context` and passes them through `assembleProviderInput` (`src/agents.ts`). `RunOptions.activeSkills` selects names when `AgentConfig.skills` is a registry; `RunOptions.skills` provides a direct override for plain arrays. → **No new core code.** The example selects a discovered/inlined skill via `activeSkills` and shows its `context` provider contributing a context block.
    - **Workspace/global skill discovery:** Covered. `discoverContributions({kinds:["skill"], workspaceRoot, globalRoot})` (`src/node/contribution-discovery.ts`) returns inert `DiscoveredContribution` envelopes; the host registers the realized `Skill` objects into a `SkillRegistry`. The example can either use this loader against a temp workspace or, for simplicity, inline a `SkillRegistry` — both exercise the same `Skill`/`resolveActiveSkills` seam. → **No new core code.**
    - **System-prompt file loading (`AGENTS.md`/`SYSTEM.md`):** Covered. `loadSystemPromptFiles({workspaceRoot, globalRoot})` (`src/node/system-project-prompts.ts`) reads the standard files as `SystemPromptContribution[]` (`source:"user"` for `SYSTEM.md`, `source:"app"` for `AGENTS.md`), trust-gated for the workspace file. `composeSystemPrompt`/`mergeSystemPromptConfig` (`src/system-prompts.ts`) layer them with `AgentConfig.instructions` and `RunOptions.systemPrompt`. → **No new core code.** The example writes the two files to a temp directory and loads them via the existing Node subpath `@arnilo/prism/node/system-prompts`.
    - **Instruction injection (Phase 30 seam):** Covered but optional. `InstructionInjector`/`resolveInstructionInjectors`/`runInstructionInjectors` (`src/instruction-injection.ts`) lets a package contribute instructions/context blocks per turn. The Phase 32 example does not need to demonstrate this seam; it is mentioned only because the Synapta track includes Phase 30. If the example chooses to show it, it uses existing public exports only. → **No new core code; no required example coverage.**
    - **Generate-validate-revise loop + artifact events:** Covered. `AgentLoopStrategy`/`AgentLoopOptions`, `ArtifactParser`/`ArtifactValidator`/`ArtifactRepairer`/`ArtifactValidation`, and the five `artifact_*` `AgentEvent` variants are all in `src/contracts.ts`. `singleShotLoop` and `generateValidateReviseLoop(...)` are implemented in `src/agent-loops.ts`; `resolveLoop(options, config)` selects the loop (`RunOptions.loop` wins, default `singleShotLoop`). `RuntimeAgentSession.run` builds a `LoopContext` exposing `assemble`, `generate`, `dispatchToolCall`, `appendMessage`, and `emit`, and delegates to `loop.run(ctx)`. → **No new core code.** The example supplies host-defined `parser`/`validator`/`repairer` callbacks mapping a Synapta-style schema to `ArtifactValidation` and asserts the emitted event sequence.
    - **Redaction of secrets in events/prompts:** Covered. `createSecretRedactor(secrets)` returns a `SecretRedactor` whose `redact` method walks objects/arrays/cycles (`src/redaction.ts`). `RuntimeAgentSession.run` applies it to messages, provider requests, and events via `redactAgentEvent`/`redactProviderRequest`. `ArtifactValidation.errors[].message` and `metadata` are redacted before subscribers see them. → **No new core code.** The example registers an obviously fake secret token with `createSecretRedactor` to prove redaction.
    - **Boundary assertions (no Synapta types in `src/`):** Covered by precedent. `phase29-boundaries.test.ts`, `phase30-boundaries.test.ts`, and `phase31-boundaries.test.ts` scan `src/**/*.ts` for forbidden imports/vocabulary. Phase 32 adds `phase32-boundaries.test.ts` using the same helpers. → **No new core code; only a new test file.**
    - **Declarative agent resolution (`AgentDefinition` resolver):** **Not covered and not in scope for Phase 32.** Phase 33 will add declarative requirement fields to `AgentConfig`/`AgentDefinition` and a `resolveAgentDefinition()` helper. No such primitive exists today (`AgentDefinition.create` is the only resolution path). The Phase 32 example therefore uses `createAgent` directly; it does not exercise declarative agent resolution. → **Out of scope; no new core code needed for Phase 32.**
    - **Conclusion:** Every Phase 32 deliverable can be satisfied with existing public seams. The only files to create are the example, the boundary test, and docs/example-list updates. `src/contracts.ts`, `src/index.ts`, and `package.json` exports remain unchanged.
  - **Outcome / deviation:** Primitive Review completed. Verified by `grep -R synapta src/ examples/` that no source or example file currently imports or mentions `synapta` outside existing boundary tests. One plan correction applied: removed "declarative agent resolution" from the Objectives exercise list because `AgentDefinition` declarative resolution is Phase 33; no such primitive exists yet, so the Phase 32 example will use `createAgent` directly.

- [x] Task 2 — Create `examples/synapta-style-artifact-loop.ts`
  - Acceptance Criteria:
    - Functional: The file is a compile-checked, runnable demo that:
      1. Builds a `ProviderResolver` mixing a first-party provider package (mocked) and a third-party mock provider via `createProviderResolver`.
      2. Registers at least one third-party tool and one first-party tool into a host-owned `ToolRegistry` and demonstrates tool dispatch inside the loop.
      3. Selects a discovered skill (workspace or inline `SkillRegistry`) using `RunOptions.activeSkills`, honoring `Skill.context` and `toolNames`.
      4. Composes a system prompt from `AGENTS.md` + `SYSTEM.md` via `loadSystemPromptFiles` (or equivalent inline contributions) layered with `AgentConfig.instructions`.
      5. Runs `session.run(input, { loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 } })`.
      6. Collects `AgentEvent` artifact variants and asserts the order: `artifact_validation_started` → `artifact_validation_finished` → (optional `artifact_revision_started`)* → `artifact_finished` with `result.ok === true`.
      7. Uses a Synapta-style host-defined schema mapped to `ArtifactValidation`; no `synapta*` import.
      8. Runs network-free with `createMockProvider` and a deterministic sequence (e.g., first generation invalid, second valid after repair).
    - Performance: Demo completes in <1 s; no network, no real credentials, no timers.
    - Code Quality: Imports only from `@arnilo/prism` public exports and host-local types; comments mark `ponytail:` where shortcuts are taken (e.g., temp workspace, deterministic mock responses); no new helper modules.
    - Security: Any fake secret token is registered with `createSecretRedactor` and redacted from the captured provider request/events; no real-looking credentials; prompt text does not claim sandboxing.
  - Approach:
    - Documentation Reviewed:
      - `src/mock-provider.ts` `createMockProvider`/`providerTextDelta`/`providerToolCall`/`providerDone` — deterministic provider sequences.
      - `src/provider-resolver.ts` `createProviderResolver` — building a resolver from a list.
      - `src/tools.ts` `createToolRegistry`/`dispatchToolCall` — tool registration and dispatch.
      - `src/skills.ts` `createSkillRegistry`/`resolveActiveSkills` — skill selection.
      - `src/node/system-project-prompts.ts` `loadSystemPromptFiles` — prompt file loader.
      - `src/loops.ts` `generateValidateReviseLoop`/`singleShotLoop`/`resolveLoop` — loop strategy factory.
      - `src/agents.ts` `createAgent`/`createAgentSession` — agent/session creation.
      - `src/redaction.ts` `createSecretRedactor` — secret redaction.
      - `examples/provider-resolver.ts`, `examples/system-project-prompts.ts`, `examples/skills.ts` — existing mix-and-match examples to mirror.
    - Options Considered:
      - Make the example a full workspace with `.agents/skills/` and `AGENTS.md` files on disk: rejected — complicates the repo layout; use `node:fs/promises` to create a temp workspace inside `main()` so the demo is self-contained and deletable.
      - Use a real first-party provider package import: rejected — would require network or real credentials; mock the first-party package by including a provider in the resolver list, which is sufficient to demonstrate the seam.
      - Emit only `console.log` without assertions: rejected — the demo must assert the artifact event sequence so it fails if the loop/event contract breaks.
      - Dispatch tools inside the `generate-validate-revise` loop: rejected — `generateValidateReviseLoop` intentionally does not dispatch tools (Phase 27 scope); tool dispatch is demonstrated in a separate single-shot run using the same shared tool/skill registries.
    - Chosen Approach:
      - Self-contained `main()` that creates a temp dir, writes `AGENTS.md`/`SYSTEM.md`, loads them via the existing Node loader, builds shared tool/skill registries and a `ProviderResolver`, then runs two network-free sessions:
        1. Single-shot run with a tool-calling mock provider to demonstrate first-party + third-party tool dispatch and redaction.
        2. `generate-validate-revise` run with a custom third-party provider that returns invalid JSON on the first turn and valid JSON on the repair turn, asserting the full artifact event sequence.
    - API Notes and Examples:
      ```ts
      // examples/synapta-style-artifact-loop.ts (shape)
      import {
        createAgent, createMockProvider, createProviderResolver, createSecretRedactor,
        createSkillRegistry, createToolRegistry, providerDone, providerTextDelta, providerToolCall,
        type AgentEvent, type AIProvider, type ArtifactParser, type ArtifactRepairer, type ArtifactValidator,
        type ContextProvider, type Skill, type ToolDefinition, type ToolResult,
      } from "@arnilo/prism";
      import { loadSystemPromptFiles } from "@arnilo/prism/node/system-prompts";

      interface ReleaseNote { readonly title: string; readonly body: string }

      // Callbacks are typed as Artifact*<unknown> to satisfy the loop options contract;
      // the host schema is cast inside the callbacks.
      const parser: ArtifactParser<unknown> = (text) => {
        try { return { ok: true, value: JSON.parse(text) as ReleaseNote }; }
        catch (error) { return { ok: false, error: error instanceof Error ? error.message : "parse failed" }; }
      };

      const validator: ArtifactValidator<unknown> = (value) => {
        const note = value as ReleaseNote;
        const errors = [];
        if (!note.title) errors.push({ path: "title", message: "missing title" });
        if (!note.body) errors.push({ path: "body", message: "missing body" });
        return errors.length === 0 ? { ok: true } : { ok: false, errors };
      };

      const repairer: ArtifactRepairer<unknown> = (_value, failure) => ({
        role: "user",
        content: [{ type: "text", text: `Fix: ${failure.errors?.map(e => e.message).join("; ")}` }],
      });

      // 1. Build resolver, tool registry, skill registry, load AGENTS.md/SYSTEM.md.
      // 2. Single-shot run demonstrates tool dispatch.
      await toolSession.run("Call the tools.", { activeSkills: ["schema-skill"] });

      // 3. generate-validate-revise run demonstrates artifact events.
      await artifactSession.run("Write a release note as JSON.", {
        activeSkills: ["schema-skill"],
        loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 },
      });
      ```
    - Files to Create/Edit:
      - `examples/synapta-style-artifact-loop.ts` (new): the compile-checked demo.
      - `examples/README.md`: list the new demo file.
    - References:
      - `src/mock-provider.ts`, `src/provider-resolver.ts`, `src/tools.ts`, `src/skills.ts`, `src/node/system-project-prompts.ts`, `src/loops.ts`, `src/agents.ts`, `src/redaction.ts`.
  - Test Cases to Write:
    - Example compiles under `examples/tsconfig.json` via `npm run typecheck`.
    - Running `node examples/synapta-style-artifact-loop.ts` after `npm run build:core` prints a JSON result with `redacted: true` and `finishedOk: true`, and the artifact event sequence matches the expected order.
  - **Outcome / deviation:** Example created as `examples/synapta-style-artifact-loop.ts`. Verified: `npx tsc -p examples --noEmit` passes; `node examples/synapta-style-artifact-loop.ts` after `npm run build:core` prints `{"toolResults":["hello","schema: title and body strings"],"redacted":true,"artifactSequence":["artifact_validation_started","artifact_validation_finished","artifact_revision_started","artifact_validation_started","artifact_validation_finished","artifact_finished"],"finishedOk":true}`. Tool dispatch is demonstrated in a separate single-shot run because the `generate-validate-revise` loop does not dispatch tools by design. Callbacks are typed as `ArtifactParser<unknown>`/`ArtifactValidator<unknown>`/`ArtifactRepairer<unknown>` to satisfy the loop options contract under strict function types; the host schema (`ReleaseNote`) is cast inside the callbacks. `examples/README.md` updated to list the new demo.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — the example exercises existing public APIs only.
    - Docs pages to create/edit: `docs/structured-output.md` (Task 4), `docs/index.md` (Task 4), `examples/README.md` (this task).
    - `docs/index.md` update: yes — mention the new example in the Structured output entry (Task 4).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Harden boundary tests in `src/__tests__/phase32-boundaries.test.ts`
  - Acceptance Criteria:
    - Functional: New boundary test asserts:
      1. `src/**/*.ts` (excluding `__tests__`) imports no package whose name starts with `synapta` and contains no `\bsynapta\b` literal.
      2. The `Artifact*` contract block in `src/contracts.ts` contains none of the literals `workflow`, `node`, or `step`.
      3. `ToolValidator` and `ArtifactValidator` type declarations in `src/contracts.ts` are `(value, ctx)`-shaped and accept a generic host-defined `T`; they are not narrowed to any domain type.
      4. `AgentLoopOptions` and `AgentLoopStrategy` declarations contain no workflow/node/step vocabulary.
      5. The example file `examples/synapta-style-artifact-loop.ts` imports no `synapta*` package (belt-and-braces).
    - Performance: Static text scans only; no runtime cost.
    - Code Quality: Mirrors `phase31-boundaries.test.ts` `files(dir, predicate)` + anchored-contract-block pattern; one assertion per boundary.
    - Security: Boundary asserts the example does not import or reference external Synapta packages, keeping domain logic host-owned.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/phase31-boundaries.test.ts`, `phase30-boundaries.test.ts`, `phase29-boundaries.test.ts` — boundary scan helpers and style.
      - `src/contracts.ts` artifact/loop/validator type blocks — exact source to anchor.
    - Options Considered:
      - Add assertions to an existing boundary file: rejected — per-phase boundary files keep Phase 32 independently greppable and prevent unrelated phase churn.
      - Scan `node_modules` or lockfile for `synapta`: rejected — Prism must not depend on any Synapta package; the source/import scan is the boundary that matters.
    - Chosen Approach:
      - New `src/__tests__/phase32-boundaries.test.ts` reusing `files`/`srcText` helpers and anchored extraction of the artifact/loop/validator contract blocks.
    - API Notes and Examples:
      ```ts
      // src/__tests__/phase32-boundaries.test.ts (shape)
      const srcFiles = files("src", (p) => p.endsWith(".ts") && !p.includes("src/__tests__"));
      const srcText = srcFiles.map((p) => readFileSync(p, "utf8")).join("\n");
      assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
      assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");

      const contractsText = readFileSync("src/contracts.ts", "utf8");
      const artifactBlockStart = contractsText.indexOf("export interface ArtifactValidation");
      const artifactBlockEnd = contractsText.indexOf("export ", artifactBlockStart + 1);
      const artifactBlock = contractsText.slice(artifactBlockStart, artifactBlockEnd);
      for (const term of ["workflow", "node", "step"]) {
        assert.equal(new RegExp(`\\b${term}\\b`, "i").test(artifactBlock), false, `artifact contract mentions ${term}`);
      }

      const artifactValidatorDecl = /export type ArtifactValidator<T> = \([\s\S]*?;/ .exec(contractsText)?.[0] ?? "";
      assert.ok(/<T>/.test(artifactValidatorDecl), "ArtifactValidator is not generic");
      assert.ok(/value:\s*T\b/.test(artifactValidatorDecl), "ArtifactValidator does not take value: T");
      assert.ok(/ctx:\s*ArtifactContext/.test(artifactValidatorDecl), "ArtifactValidator does not take ctx: ArtifactContext");

      const toolsText = readFileSync("src/tools.ts", "utf8");
      const toolValidatorDecl = /export type ToolValidator = \([\s\S]*?;/ .exec(toolsText)?.[0] ?? "";
      assert.ok(/tool:\s*ToolDefinition/.test(toolValidatorDecl), "ToolValidator does not take tool: ToolDefinition");
      assert.ok(/args:\s*JsonObject/.test(toolValidatorDecl), "ToolValidator does not take args: JsonObject");
      assert.ok(/context:\s*ToolExecutionContext/.test(toolValidatorDecl), "ToolValidator does not take context: ToolExecutionContext");

      const loopBlockStart = contractsText.indexOf("export interface AgentLoopStrategy");
      const loopBlockEnd = contractsText.indexOf("export interface ArtifactValidation", loopBlockStart + 1);
      const loopBlock = contractsText.slice(loopBlockStart, loopBlockEnd);
      for (const term of ["workflow", "node", "step"]) {
        assert.equal(new RegExp(`\\b${term}\\b`, "i").test(loopBlock), false, `loop contract mentions ${term}`);
      }

      const exampleText = readFileSync("examples/synapta-style-artifact-loop.ts", "utf8");
      assert.equal(/from ["']synapta/.test(exampleText), false, "example imports a synapta* package");
      ```
    - Files to Create/Edit:
      - `src/__tests__/phase32-boundaries.test.ts` (new).
    - References:
      - `src/__tests__/phase31-boundaries.test.ts`, `src/contracts.ts`.
  - Test Cases to Write:
    - Boundary test passes before any Phase 32 code is added and continues to pass after the example/docs are added.
  - **Outcome / deviation:** Boundary test created as `src/__tests__/phase32-boundaries.test.ts` with 5 assertions: (1) no `synapta*` imports/mentions in `src/` (excluding `__tests__`), (2) no `workflow`/`node`/`step` in the `Artifact*` contract block, (3) `ArtifactValidator<T>` is generic `(value: T, ctx: ArtifactContext)` and `ToolValidator` uses core types only, (4) no domain vocabulary in `AgentLoopStrategy`/`AgentLoopOptions`, (5) the example file imports no `synapta*` package. Verified: `node --test dist/__tests__/phase32-boundaries.test.js` passes; `node --test dist/__tests__/*.test.js` reports 630 pass / 0 fail; `npm run typecheck` passes. `ToolValidator` is declared in `src/tools.ts` (not `src/contracts.ts`); the test checks the actual declaration there and asserts `contracts.ts` only imports it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tests do not change public API.
    - Docs pages to create/edit: none; boundary tests are not user-facing docs.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (not applicable, recorded for compliance).

- [x] Task 4 — Extend `docs/structured-output.md` with end-to-end third-party schema example
  - Acceptance Criteria:
    - Functional: `docs/structured-output.md` gains a new "End-to-end third-party integration" section (or equivalent) that shows a host mapping its own schema to `ArtifactValidation` while mixing first-party + third-party providers, registering tools, selecting skills, loading `AGENTS.md`/`SYSTEM.md`, and running `generate-validate-revise`. The example imports no `synapta*` types and uses only Prism public exports.
    - Performance: Docs changes have no runtime effect; the embedded code must compile under `examples/tsconfig.json` or be a clearly excerpted snippet.
    - Code Quality: Follows the Prism wiki API-page structure; the new section links to related docs (`agent-loops.md`, `agent-events.md`, `tools.md`, `context-and-skills.md`, `system-prompts.md`, `provider-packages.md`); no copy-paste of the full example file, just the relevant cross-seam shape.
    - Security: The docs example registers a fake secret with `createSecretRedactor` and notes that `ArtifactValidation.errors[].message` is redacted before subscribers see it.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` — required API-page headings.
      - `docs/structured-output.md` current content and existing Synapta-style example.
      - `docs/index.md` current Structured output entry.
      - `examples/README.md` listing format.
    - Options Considered:
      - Create a new `docs/synapta-integration.md` page: rejected — Phase 32 ships no new core surface, so no new API page is warranted; extending the existing `structured-output.md` page keeps the seam story in one place.
      - Inline the entire `examples/synapta-style-artifact-loop.ts` into docs: rejected — duplicating the file invites drift; docs should show the cross-seam shape and link to the full example.
    - Chosen Approach:
      - Add an "End-to-end third-party integration" subsection after the existing implementation example, using excerpts that highlight the provider resolver, tool registry, active skill selection, system-prompt files, and artifact callbacks, then link to `examples/synapta-style-artifact-loop.ts`.
      - Update `docs/index.md` Structured output entry to mention the end-to-end example.
      - Update `examples/README.md` to list the new demo.
    - API Notes and Examples:
      ```markdown
      ## End-to-end third-party integration

      A third-party host mixes first-party and own providers, tools, and skills, then opts a run into the artifact loop:

      ```ts
      const resolver = createProviderResolver([
        setupFirstPartyMock(registries),
        createOwnMockProvider(),
      ]);
      const agent = createAgent({
        model: { provider: "own", model: "artifact-v1" },
        providerSource: resolver,
        tools: registry,
        skills: skillRegistry,
        instructions: "You are a release-note writer.",
        systemPrompt: await loadSystemPromptFiles({ workspaceRoot, globalRoot: homedir() }),
        redactor: createSecretRedactor([FAKE_SECRET]),
      });
      await agent.createSession().run("Write the release note.", {
        activeSkills: ["schema-skill"],
        loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 },
      });
      ```
      ```
    - Files to Create/Edit:
      - `docs/structured-output.md`: add the end-to-end section and cross-references.
      - `docs/index.md`: update the Structured output entry description.
      - `examples/README.md`: list `synapta-style-artifact-loop.ts` as a demo.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`, `docs/structured-output.md`, `docs/index.md`, `examples/README.md`.
  - Test Cases to Write:
    - Docs example code snippets compile or are clearly excerpted (not required to run standalone); `npm run typecheck` covers `examples/synapta-style-artifact-loop.ts`.
  - **Outcome / deviation:** Added an "End-to-end third-party integration" section to `docs/structured-output.md` after the implementation example, with excerpted code showing a host mixing first-party and own providers via `createProviderResolver`, registering tools/skills, loading `AGENTS.md`/`SYSTEM.md` via `loadSystemPromptFiles`, and running `generate-validate-revise` with `Artifact*<unknown>` callbacks. Updated `docs/index.md` to mention the walkthrough in the Structured output entry and to list the new demo in the examples summary. The snippet is clearly excerpted (undefined identifiers and `as` casts are marked) and does not duplicate the full runnable example; related docs links added.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — docs only.
    - Docs pages to create/edit: `docs/structured-output.md`, `docs/index.md`, `examples/README.md`.
    - `docs/index.md` update: yes — add `examples/synapta-style-artifact-loop.ts` to the Structured output entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Final verification
  - Acceptance Criteria:
    - Functional: `npm run typecheck` passes, including the new example; `npm test` passes network-free; `node examples/synapta-style-artifact-loop.ts` after `npm run build:core` prints the expected result.
    - Performance: `npm test` stays under the documented `<30 s` budget on Node 20.
    - Code Quality: No new core exports; no `synapta*` import in `src/` or `examples/`; no workflow/node/step vocabulary in artifact contracts.
    - Security: Example redacts fake secrets; boundary tests fail closed on any leak.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts — typecheck/test/build commands.
      - `docs/release-and-install.md` test-time budget.
    - Options Considered:
      - Skip running the demo in CI: rejected — the example must be runnable network-free; a manual verification step is required.
    - Chosen Approach:
      - Run `npm run typecheck`, `npm test`, `npm run build:core`, and `node examples/synapta-style-artifact-loop.ts`; record results.
    - API Notes and Examples:
      ```bash
      npm run typecheck
      npm test
      npm run build:core
      node examples/synapta-style-artifact-loop.ts
      ```
    - Files to Create/Edit:
      - `plans/032-synapta-facing-integration-example-and-boundary-lock.md`: fill `Compromises Made` and `Further Actions` after verification.
    - References:
      - `package.json`, `docs/release-and-install.md`.
  - Test Cases to Write:
    - (Verification only; tests are written in Tasks 2–3.)
  - **Outcome / deviation:** Verification completed. `npm run typecheck` passed in ~17 s. `npm test` passed network-free in ~30 s real time (just under the documented `<30 s` budget; 630 core tests pass / 0 fail, plus workspace tests pass / 0 fail). `npm run build:core` succeeded and `node examples/synapta-style-artifact-loop.ts` printed the expected JSON result with `redacted: true`, the full artifact event sequence, and `finishedOk: true`. `git diff` shows no changes to `src/index.ts` or `package.json`, confirming no new core exports. Boundary tests confirm no `synapta*` imports/mentions in `src/` and no `workflow`/`node`/`step` vocabulary in artifact/loop contracts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (not applicable, recorded for compliance).

## Compromises Made

- Tool dispatch is demonstrated in a separate single-shot run rather than inside the `generate-validate-revise` loop, because `generateValidateReviseLoop` intentionally does not dispatch tools (Phase 27 scope). This keeps the example honest about current loop semantics.
- The docs walkthrough in `docs/structured-output.md` is an excerpted snippet rather than a second full runnable file, to avoid drift with `examples/synapta-style-artifact-loop.ts`.
- The full `npm test` run is ~30 s, near the documented budget. No tests were skipped or removed; the budget is still met on current hardware.

## Further Actions

- Add `node examples/synapta-style-artifact-loop.ts` to CI/verification script so the demo stays runnable automatically. Priority: medium — the example already runs network-free and takes <1 s.
- Monitor total `npm test` duration as the suite grows; if it consistently exceeds the 30 s budget, split slow integration tests into a separate `test:slow` script or parallelize workspace test runs. Priority: low/medium.
- When Phase 33 (declarative agent definitions/resolver) lands, consider revising the example to show declarative agent selection if it simplifies the host wiring. Priority: low (example works without it).
