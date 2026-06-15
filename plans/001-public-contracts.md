# Phase 1 — Public Contracts Before Runtime

## Objectives
- Freeze the TypeScript public contract surface before adding runtime behavior.
- Define host-owned provider, tool, context, skill, extension, session, resource, settings, and credential contracts without app-specific imports.
- Keep Phase 1 type-only and dependency-free: no provider SDKs, built-in tools, credentials, storage, or hidden globals.

## Expected Outcome
- `prism` exports stable TypeScript contracts for messages, agents, sessions, providers, tools, context, skills, extensions, stores, resources, settings, and credentials.
- Compile-only examples prove a host can configure an agent with a provider, context provider, skill, and tool using only public `prism` imports.
- Public exports and generated declarations do not mention safe/dangerous tools, Synapta, shell, filesystem, browser, or any business domain.

## Tasks

- [x] Primitive review: inventory existing public API and generic gaps
  - Acceptance Criteria:
    - Functional: Current exports, package metadata, test pattern, and missing Phase 1 contracts are recorded before source edits.
    - Performance: Review adds no runtime code and preserves the zero-runtime nature of type contracts.
    - Code Quality: Planned additions are generic reusable TypeScript primitives, not mode-specific or domain-specific abstractions.
    - Security: Review rejects hidden globals, built-in app tools, built-in credentials, and secret-bearing event/history types.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 and non-negotiable boundaries.
      - `README.md` current scope and non-goals.
      - `package.json` ESM, `exports`, scripts, Node `>=20`, TypeScript `^5.7.0`.
      - `tsconfig.json` strict `NodeNext`, declarations, source include.
      - `src/index.ts` and `src/__tests__/index.test.ts` baseline public surface and `node:test` style.
      - Context7 `/microsoft/typescript` docs query on 2026-06-15: type-only imports/re-exports and discriminated union narrowing examples.
    - Options Considered:
      - Start adding types immediately: fastest, but risks baking in accidental runtime or domain assumptions.
      - Do a short primitive review first: chosen because this phase creates reusable extension points and the review can live in this plan's execution notes.
    - Chosen Approach:
      - Record the inventory under this task during execution, then implement only generic type primitives needed by Phase 1.
    - API Notes and Examples:
      ```ts
      import type * as Prism from "prism";
      ```
    - Files to Create/Edit:
      - `plans/001-public-contracts.md`: add execution notes with the inventory before checking off this task.
    - References:
      - `roadmap.md` "Public contracts before runtime".
      - TypeScript type-only import/re-export docs from Context7 `/microsoft/typescript`.
  - Test Cases to Write:
    - `primitive_inventory_recorded`: manual check that execution notes list existing exports, missing contracts, and rejected domain/runtime assumptions.
  - Execution Notes:
    - Existing public API: `src/index.ts` exports only runtime constants `name`, `version`, and `description`.
    - Existing package surface: ESM package, root export points to `./dist/index.js`, CLI bin points to `./dist/cli.js`, published files are limited to `dist`, and Node `>=20` is required.
    - Existing build/test pattern: `tsc` only, strict `NodeNext`, declarations emitted to `dist`, tests use `node:test` plus `node:assert/strict` after build.
    - Missing Phase 1 contracts: messages/content, agent/session/run options, agent/provider events, provider/model/usage, tool registry/execution/result, context provider/block, skill registry, extension API/lifecycle, session store, resource loader, settings provider, and credential resolver.
    - Generic gaps to fill next: add a type-only `src/contracts.ts`, re-export with `export type`, add declaration metadata in `package.json`, and add compile-only host examples.
    - Rejected for Phase 1: hidden globals, runtime registries, provider SDKs, built-in tools, shell/filesystem/browser concepts, safe/dangerous tool categories, business-domain terms, stored credentials, and secret-bearing event/history shapes.

- [x] Define the Phase 1 public contract types
  - Acceptance Criteria:
    - Functional: Public types cover messages/content, `Agent`, `AgentConfig`, `AgentSession`, `AgentSessionConfig`, `RunOptions`, `AgentEvent`, `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ModelConfig`, `Usage`, `ToolDefinition`, `ToolRegistry`, `ToolExecutionContext`, `ToolResult`, `ContextProvider`, `ContextBlock`, `Skill`, `SkillRegistry`, `Extension`, `ExtensionAPI`, lifecycle event names, `SessionStore`, `ResourceLoader`, `SettingsProvider`, and `CredentialResolver`.
    - Performance: Contracts are interfaces/types only; importing them has no side effects and creates no registries, stores, clients, or network work.
    - Code Quality: Use discriminated unions for content/events, readonly-friendly shapes, `unknown` for host data, and minimal JSDoc on exported contracts.
    - Security: Credential types keep secrets host/provider-owned; events, messages, stores, and tool results do not require secret fields or built-in app permissions.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 deliverables and Pi reference event/resource points.
      - `README.md` statement that prism defines contracts, not apps.
      - Context7 `/microsoft/typescript` examples for discriminated unions and type-only exports.
    - Options Considered:
      - Split contracts into many files by domain: clearer later, but premature for a type-only phase.
      - Put all Phase 1 contracts in one module: chosen to keep the diff small and the public surface easy to audit.
    - Chosen Approach:
      - Create one `src/contracts.ts` with all Phase 1 type contracts and no runtime implementation.
    - API Notes and Examples:
      ```ts
      export type AgentEvent =
        | { type: "agent_started"; sessionId: string; runId: string }
        | { type: "message_delta"; sessionId: string; runId: string; content: ContentBlock }
        | { type: "tool_execution_finished"; sessionId: string; runId: string; result: ToolResult }
        | { type: "error"; sessionId?: string; runId?: string; error: ErrorInfo };
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: new type-only public contract module.
    - References:
      - `roadmap.md` Phase 1 type inventory.
      - TypeScript discriminated union docs from Context7 `/microsoft/typescript`.
  - Test Cases to Write:
    - `contracts_compile_under_strict_nodenext`: validates all exported contract types compile with the existing `tsconfig.json`.
    - `agent_event_narrows_by_type`: compile-only example narrows an `AgentEvent` by its discriminator.
  - Execution Notes:
    - Added `src/contracts.ts` as a type-only Phase 1 contract module.
    - Covered the planned contract inventory: content/messages, agent/session/run options, agent/provider events, provider/model/usage, tools, context, skills, extensions, session store, resource loader, settings, and credential resolver.
    - Kept contracts generic and host-owned: no runtime registry implementation, provider SDK, built-in tool, hidden global, storage implementation, or app-domain import.
    - Ran `npm run typecheck` successfully.

- [x] Export contracts through the public barrel and package metadata
  - Acceptance Criteria:
    - Functional: `src/index.ts` exports the Phase 1 contracts from `src/contracts.ts`, and package metadata exposes generated declarations to consumers.
    - Performance: Public type exports do not import runtime implementations or add startup work.
    - Code Quality: Use `export type` for type-only re-exports and keep existing `name`, `version`, and `description` value exports intact.
    - Security: Package metadata adds no dependency, postinstall hook, credential loader, or default provider/tool registration.
  - Approach:
    - Documentation Reviewed:
      - `package.json` current `main`, `exports`, `files`, and scripts.
      - `tsconfig.json` `declaration: true` and `outDir: dist`.
      - Context7 `/microsoft/typescript` type-only re-export examples.
    - Options Considered:
      - Rely on `main` declaration discovery only: may be brittle with `exports` under NodeNext.
      - Add explicit package declaration metadata: chosen so consumers see `dist/index.d.ts` through the package export.
    - Chosen Approach:
      - Add `types` metadata and an `exports["."].types` entry, while keeping the JavaScript entry at `./dist/index.js`.
    - API Notes and Examples:
      ```ts
      export type { AgentConfig, AIProvider, ToolDefinition } from "./contracts.js";
      ```
    - Files to Create/Edit:
      - `src/index.ts`: re-export public contract types.
      - `package.json`: add declaration metadata for the root export.
    - References:
      - Existing package ESM/NodeNext setup.
      - TypeScript type-only re-export docs from Context7 `/microsoft/typescript`.
  - Test Cases to Write:
    - `build_emits_root_declarations`: `npm run build` produces `dist/index.d.ts` containing the public type exports.
    - `package_root_export_points_at_declarations`: static package metadata check for `types` and `exports["."].types`.
  - Execution Notes:
    - Added `export type * from "./contracts.js"` to `src/index.ts` while keeping existing value exports.
    - Added root declaration metadata to `package.json`: `types` and `exports["."].types` point at `./dist/index.d.ts`.
    - Ran `npm run build` and checked `dist/index.d.ts` plus package declaration metadata successfully.

- [x] Add compile-only host configuration examples
  - Acceptance Criteria:
    - Functional: A test/example configures an agent with a mock provider, context provider, skill, and host tool using only public `prism` imports.
    - Performance: The example performs no network calls, no tool execution, and no session runtime work.
    - Code Quality: Keep examples inside the existing `node:test` setup; avoid a separate type-test framework or fixture harness.
    - Security: Examples use fake IDs and no API keys, secrets, shell commands, filesystem tools, browser tools, or business-domain objects.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/index.test.ts` existing `node:test` and `node:assert/strict` pattern.
      - `package.json` `test` script: build then `node --test dist/__tests__/index.test.js`.
      - `roadmap.md` Phase 1 compile-only acceptance.
    - Options Considered:
      - Add a dedicated type-test dependency: unnecessary for plain TypeScript compile checks.
      - Use `.ts` tests compiled by the existing build: chosen because `tsc` is already the type checker.
    - Chosen Approach:
      - Add one small test file whose value assertions are trivial but whose TypeScript annotations prove the public contracts are usable.
    - API Notes and Examples:
      ```ts
      import type { AgentConfig, AIProvider, ContextProvider, Skill, ToolDefinition } from "../index.js";

      const agentConfig: AgentConfig = {
        id: "demo-agent",
        model: { provider: "mock", model: "demo" },
        provider,
        tools: [tool],
        context: [context],
        skills: [skill]
      };
      ```
    - Files to Create/Edit:
      - `src/__tests__/public-contracts.test.ts`: compile-only host configuration examples and light assertions.
    - References:
      - `roadmap.md` Phase 1 acceptance: host can configure an agent with provider, context provider, skill, and tool.
  - Test Cases to Write:
    - `host_can_configure_agent_with_provider_context_skill_and_tool`: compile-only example for the core host path.
    - `host_can_type_extension_resource_settings_and_credentials`: compile-only example for extension/resource/settings/credential contracts.
  - Execution Notes:
    - Added `src/__tests__/public-contracts.test.ts` with typed host examples for `AgentConfig`, `AIProvider`, `ContextProvider`, `Skill`, `ToolDefinition`, `Extension`, `ResourceLoader`, `SettingsProvider`, `CredentialResolver`, and `AgentEvent` narrowing.
    - Updated `package.json` test script to run every compiled `dist/__tests__/*.test.js` file so new examples stay checked.
    - Ran `npm run typecheck` and `npm test` successfully.

- [x] Add public boundary checks for app-specific contract leaks
  - Acceptance Criteria:
    - Functional: Tests fail if public source/declaration text introduces safe/dangerous tool names or business-domain terms forbidden by the roadmap.
    - Performance: Boundary checks are simple local text scans and keep the full test suite under 10 seconds.
    - Code Quality: Use a short banned-term list in the test; do not add a parser or lint dependency.
    - Security: Public contracts do not imply built-in tool permissions, shell/filesystem/browser access, provider credentials, or Synapta-specific trust assumptions.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` non-negotiable boundaries and Phase 1 public-export acceptance.
      - `README.md` non-goals for built-in shell/filesystem/browser tools.
      - Existing `npm test` command.
    - Options Considered:
      - Rely on code review only: easy to miss regressions.
      - Add a tiny test scan: chosen because it is cheap and enforces the roadmap boundary.
    - Chosen Approach:
      - Scan `src/index.ts`, `src/contracts.ts`, and generated `dist/index.d.ts`/`dist/contracts.d.ts` for a small banned list.
    - API Notes and Examples:
      ```ts
      const banned = [/safeTool/i, /dangerous/i, /synapta/i, /shell/i, /filesystem/i, /browser/i];
      ```
    - Files to Create/Edit:
      - `src/__tests__/public-contracts.test.ts`: add boundary assertions to the same test file.
    - References:
      - `roadmap.md` "No built-in app tools" and Phase 1 acceptance.
  - Test Cases to Write:
    - `public_contracts_do_not_mention_safe_or_dangerous_tools`: validates the specific Phase 1 acceptance.
    - `public_contracts_do_not_mention_business_or_app_tools`: validates no Synapta/shell/filesystem/browser leak.
  - Execution Notes:
    - Added a boundary test in `src/__tests__/public-contracts.test.ts` that scans `src/index.ts`, `src/contracts.ts`, `dist/index.d.ts`, and `dist/contracts.d.ts`.
    - The banned public-contract terms are `safe.?tool`, `dangerous`, `synapta`, `shell`, `filesystem`, and `browser`.
    - Ran `npm run build && node --test dist/__tests__/*.test.js` successfully.

- [x] Verify Phase 1 and refresh README scope
  - Acceptance Criteria:
    - Functional: `npm run build`, `npm run typecheck`, and `npm test` pass; README reflects that Phase 1 public contracts exist but runtime remains minimal.
    - Performance: Build and tests stay dependency-free and under the existing lightweight toolchain.
    - Code Quality: README examples match actual exported names and do not promise runtime features from later phases.
    - Security: README repeats that hosts own tools, credentials, permissions, storage, and provider implementations.
  - Approach:
    - Documentation Reviewed:
      - `README.md` current scope table and non-goals.
      - `package.json` scripts.
      - `roadmap.md` Phase 1 and Phase 2/3 deferrals.
    - Options Considered:
      - Leave docs untouched until Phase 10: less work, but README would understate the new public API.
      - Add a minimal Phase 1 README note: chosen without writing a full API guide early.
    - Chosen Approach:
      - Update README only enough to show the contract inventory and boundaries, then run the existing checks.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      npm test
      ```
    - Files to Create/Edit:
      - `README.md`: add a concise public-contracts note/example.
      - `plans/001-public-contracts.md`: mark tasks complete only after checks pass and record actual compromises/follow-ups.
    - References:
      - Existing package scripts and roadmap phase boundaries.
  - Test Cases to Write:
    - `npm run build`: validates emitted JavaScript and declarations.
    - `npm run typecheck`: validates strict compile-only contracts.
    - `npm test`: validates baseline tests, host examples, and boundary checks.
  - Execution Notes:
    - Updated `README.md` to list the Phase 1 public contract surface and a type-only import example.
    - README now states runtime factories, registries, session loops, persistence adapters, and provider adapters are deferred to later phases.
    - README repeats that hosts own tools, provider implementations, credentials, permissions, storage, and UI.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test` successfully.

## Compromises Made
- Kept all Phase 1 contracts in one `src/contracts.ts` file. Split by domain only when implementation phases make that useful.
- README documents the contract inventory only; full API guide remains deferred to the docs/release phase.

## Further Actions
- Priority high: Phase 2 should implement provider/model registries and validate the current `AIProvider`/`ProviderEvent` shapes against the first mock provider.
- Priority medium: Revisit contract file organization after runtime modules exist.
