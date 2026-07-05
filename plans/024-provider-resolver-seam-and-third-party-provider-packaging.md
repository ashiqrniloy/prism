# Phase 24 — Provider resolver seam and third-party provider packaging

## Objectives
- Let a host hand Prism a provider resolver (or a registry / list of providers) so the agent resolves its provider from `model.provider` per run, instead of requiring every app to resolve an `AIProvider` and stuff it into `AgentConfig.provider`.
- Keep the direct `AgentConfig.provider: AIProvider` path fully supported and first-precedence; the resolver is an opt-in alternative.
- Make first-party provider packages (`@arnilo/prism-provider-*`) opt-in, individually installable, individually selectable; core still runs mock-only with zero first-party packages required.
- Surface the seam on both `AgentConfig` and `RunOptions` (RunOptions overrides AgentConfig per run), mirroring how `model`, `providerRequestPolicies`, `systemPrompt`, `redactor`, `compaction`, and `retry` already work.
- Introduce no registry/contribution object on `AgentConfig`; only a resolver function. A registry is one way to build a resolver, not the only way.

## Expected Outcome
- `createAgent({ model, providerSource })` resolves the provider from `model.provider` on each run; no `provider` object is passed.
- A host can build the resolver from a `ProviderRegistry`, a plain `AIProvider[]`, or its own function (mixing first-party + third-party providers).
- Direct `provider: AIProvider` still works bit-for-bit; when both are set, direct wins.
- Missing provider fails closed with the existing `Unknown provider: ${model.provider}` error, before any provider turn.
- No first-party provider package is required for core to run (mock provider only); `npm test` stays network-free and under budget.
- `ProviderResolver` and `createProviderResolver` exported from the public barrel; docs page + index entry + compile-checked example shipped.

## Tasks

- [x] Task 1 — Add `ProviderResolver` contract and `createProviderResolver` helper
  - Acceptance Criteria:
    - Functional: `src/contracts.ts` exports `export type ProviderResolver = (model: ModelConfig) => AIProvider | undefined;`. A new `src/providers.ts` exports `createProviderResolver(source: ProviderRegistry | readonly AIProvider[]): ProviderResolver`. Behavior: registry source → `(model) => registry.get(model.provider)`; array source → builds an id-keyed `Map` once and returns `(model) => map.get(model.provider)`. Returns `undefined` when no provider matches (fail-closed handling is the caller's job, mirroring `ProviderRegistry.get`). Both sources are O(1) lookup.
    - Performance: O(1) per resolution for both sources; array source builds the lookup map once at construction, not per call. No allocation per resolution.
    - Code Quality: `ProviderResolver` is a single function type with no Synapta/domain vocabulary. `createProviderResolver` reuses `ProviderRegistry.get` for the registry branch (no re-implemented lookup). Type-only import of `AIProvider`/`ModelConfig`; no runtime side effects. Placed next to existing provider code in `src/providers.ts`.
    - Security: No credential handling, no network, no globals; the resolver only returns a previously-registered provider object.
  - Approach:
    - Documentation Reviewed:
      - `src/providers.ts` (lines 1–34): `ProviderRegistry` already has `get(id: string): AIProvider | undefined` and `resolve(model): AIProvider` that throws `Unknown provider: ${id}`. The resolver's fail-closed semantics therefore already exist at the registry level; `ProviderResolver` reuses `get` rather than `resolve` so the caller (`requireProvider`) owns the single fail-closed throw.
      - `src/contracts.ts` `ModelConfig.provider: string` — the registry key.
      - `src/agents.ts` `requireProvider()`: currently throws `Unknown provider: ${this.agent.config.model.provider}` — identical string to `ProviderRegistry.resolve`, so call-site behavior stays consistent when the resolver returns `undefined`.
      - `.agents/skills/create-plan/references/prism-wiki.md` — API page structure for the new docs page.
    - Options Considered:
      - Resolver function on config (`providerSource?: ProviderResolver`): minimal contract, no registry object coupled into `AgentConfig`, decouples runtime from the contribution-registry system. Chosen.
      - Accept a `ProviderRegistry | AIProvider[]` directly on `AgentConfig`: couples config to a concrete container type and forces a runtime type-narrow; worse for hosts with their own provider map. Rejected.
      - Accept a `ContributionRegistries` blob on config: explicitly rejected in the roadmap — couples runtime to the contribution system. Rejected.
    - Chosen Approach:
      - A single `ProviderResolver` function type is the contract. `createProviderResolver` is a generic helper that builds one from either a registry or a list. Hosts with custom provider maps (e.g. dynamic per-request routing, lazy provider construction) implement the two-line function directly.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export type ProviderResolver = (model: ModelConfig) => AIProvider | undefined;
      ```
      ```ts
      // src/providers.ts
      export function createProviderResolver(
        source: ProviderRegistry | readonly AIProvider[],
      ): ProviderResolver {
        const get = (provider: string): AIProvider | undefined =>
          Array.isArray(source)
            ? lookup.get(provider)
            : source.get(provider);
        const lookup = Array.isArray(source)
          ? new Map(source.map((p) => [p.id, p]))
          : null;
        return (model) => get(model.provider);
      }
      ```
      ```ts
      // usage — registry source
      const providerSource = createProviderResolver(providerRegistry);
      // usage — list source (mix first-party + own providers)
      const providerSource = createProviderResolver([firstPartyProvider, ownProvider]);
      // usage — custom resolver (e.g. lazy)
      const providerSource: ProviderResolver = (model) => myMap.get(model.provider);
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `ProviderResolver` type export.
      - `src/providers.ts`: add `createProviderResolver` implementation; re-export `ProviderResolver` type is not needed here (consumers import the type from the barrel).
      - `src/index.ts`: `export { createProviderRegistry, createProviderResolver } from "./providers.js";` and `export type { ProviderRegistry, ProviderResolver } from "./providers.js";` plus `export type { ProviderResolver } from "./contracts.js";` only if the type originates in `contracts.ts` (pick one source of truth — `contracts.ts` — and re-export through `providers.ts` re-export line).
    - References:
      - `src/providers.ts`: existing `ProviderRegistry` reused.
      - `src/agents.ts` `requireProvider()`: fail-closed throw call site (Task 2 wires the resolver here).
      - Roadmap Phase 24 (non-negotiable: no registry/contribution object on `AgentConfig`).
  - Test Cases to Write:
    - `src/__tests__/providers.test.ts` (new or extend if exists): `createProviderResolver(registry)` returns the provider whose `id === model.provider`; returns `undefined` for an unknown `model.provider` (does not throw). Array source resolves by `provider.id`; array with duplicate ids keeps the last (documented). Custom function resolver is callable and returns `undefined` for misses. All assertions use `createMockProvider` + `providerDone()`; no network.
    - Boundary: resolver returns `AIProvider | undefined` only — no credential/secret leakage, no extra fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public `ProviderResolver` type and `createProviderResolver` helper.
    - Docs pages to create/edit:
      - `docs/provider-layer.md`: add a "Provider resolver" section (What it does / When to use it / Inputs / Outputs / Example / Extension notes / Security / Related APIs) per the prism-wiki API page structure. Explain registry source vs list source vs custom function, fail-closed ownership, and that direct `AgentConfig.provider` still takes precedence.
    - `docs/index.md` update: yes — add a "Provider resolver" entry under the "Provider and model connection" group linking to `docs/provider-layer.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Wire `providerSource` into `AgentConfig` / `RunOptions` and the runtime
  - Acceptance Criteria:
    - Functional: `AgentConfig.providerSource?: ProviderResolver` and `RunOptions.providerSource?: ProviderResolver` added to `src/contracts.ts`. `RuntimeAgentSession` resolves the per-run provider as: `provider = options.providerSource ?? this.agent.config.providerSource` (RunOptions wins), then `resolved = provider?.(model ?? config.model)`; if `undefined`, fall back to `this.agent.config.provider` (direct precedence). `requireProvider()` (or its replacement) throws the existing `Unknown provider: ${model.provider}` when no provider resolves. The resolved provider is used for the provider streaming turn. `RunOptions.model` override is respected: the resolver receives `options.model ?? config.model`.
    - Performance: resolver called once per run (not per turn); O(1) lookup. No allocation beyond the resolver return.
    - Code Quality: Direct `provider: AIProvider` path unchanged and first-precedence; resolver is purely additive. Resolution logic is a single small function, no duplicated `Unknown provider` strings (reuse the existing constant/message). RunOptions-wins convention matches `providerRequestPolicies`/`systemPrompt`/`compaction`/`retry`.
    - Security: No hidden globals; the resolver is host-supplied. Missing providers fail closed before any provider call, before `agent_started`? — preserve existing ordering (`requireProvider` runs after `agent_started` emit today; keep that ordering to avoid behavior change).
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` `run()`: currently calls `this.requireProvider()` early (after `agent_started` emit) which checks `this.agent.config.provider` and throws `Unknown provider: ${model.provider}`. `generateProviderTurn` uses `this.agent.config.provider!.generate(request)`.
      - `src/agents.ts` `requireProvider()`: single fail-closed site — this is the root-cause location for the guard (ponytail: one guard in the shared function, not per caller).
      - `src/contracts.ts` `AgentConfig` / `RunOptions`: existing override pattern (`providerRequestPolicies`, `systemPrompt`, `compaction`, `retry`, `redactor`) — `RunOptions` fields mirror `AgentConfig` fields and win when set.
      - `docs/agent-session-runtime.md`: documents `AgentConfig.provider` must contain the host-selected provider and missing providers fail closed — must be updated for `providerSource`.
    - Options Considered:
      - RunOptions wins, direct `provider` first-precedence: matches every existing override seam; preserves current behavior when `providerSource` is absent. Chosen.
      - Resolver wins over direct `provider`: would break the existing direct-provider path and force migration. Rejected.
      - Per-turn re-resolution: unnecessary; provider does not change mid-run. Rejected (resolve once per run).
    - Chosen Approach:
      - Resolve once at the top of `run()` after `requireProvider()` semantics: compute `const provider = options.providerSource?.(model) ?? this.agent.config.providerSource?.(model) ?? this.agent.config.provider;` where `model = options.model ?? this.agent.config.model`. If `!provider` throw the existing `Unknown provider: ${model.provider}`. Store on a local and use it in `generateProviderTurn` instead of `this.agent.config.provider!`. Keep `requireProvider()` semantics intact when neither source nor direct provider is set.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export interface AgentConfig {
        // ...existing...
        readonly providerSource?: ProviderResolver;
      }
      export interface RunOptions {
        // ...existing...
        readonly providerSource?: ProviderResolver;
      }
      ```
      ```ts
      // src/agents.ts — inside run(), after agent_started emit, before rebuildHistory
      const model = options.model ?? this.agent.config.model;
      const provider =
        options.providerSource?.(model) ??
        this.agent.config.providerSource?.(model) ??
        this.agent.config.provider;
      if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
      // pass `provider` to generateProviderTurn instead of this.agent.config.provider
      ```
      ```ts
      // host usage — registry resolver on config, override per run
      const agent = createAgent({ model, providerSource: createProviderResolver(registry) });
      await session.run(input, { providerSource: createProviderResolver([...]) });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `providerSource?: ProviderResolver` to `AgentConfig` and `RunOptions`.
      - `src/agents.ts`: resolve provider once per `run()`, use the resolved provider in `generateProviderTurn`; preserve existing `requireProvider` ordering and error message.
    - References:
      - `src/agents.ts` `run()` / `requireProvider()` / `generateProviderTurn()`.
      - Task 1 `ProviderResolver` type.
  - Test Cases to Write:
    - Extend `src/__tests__/agents.test.ts`: (a) agent with `providerSource` (registry resolver) and no direct `provider` streams a mock turn to a subscriber. (b) `providerSource` returning `undefined` for the model's provider fails closed with `Unknown provider: <id>` before any provider call. (c) `RunOptions.providerSource` overrides `AgentConfig.providerSource` per run. (d) direct `provider` is used when `providerSource` is absent (existing tests already cover this — keep green). (e) direct `provider` takes precedence when both `provider` and `providerSource` are set on config. All tests use `createMockProvider` + `providerDone()`/`providerTextDelta`; no network.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `AgentConfig.providerSource`, `RunOptions.providerSource`, and runtime resolution semantics.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: document `providerSource` on `AgentConfig`/`RunOptions`, resolution order (RunOptions wins; direct `provider` first-precedence when set), and that missing providers still fail closed with `Unknown provider: ${model.provider}`.
      - `docs/provider-layer.md`: cross-link the resolver helper to the runtime config surface.
    - `docs/index.md` update: yes — ensure the "Agent/session runtime" entry notes `providerSource` resolution, or add a one-line note under "Provider and model connection".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Example and provider-packaging authoring docs
  - Acceptance Criteria:
    - Functional: A new compile-checked example `examples/provider-resolver.ts` builds a resolver from a mix of a first-party provider package (mocked) and a third-party mock provider, creates an agent with `providerSource` (no direct `provider`), runs a session, and asserts the streamed text. Third-party provider packaging authoring doc section added under `docs/provider-packages.md` (or `docs/extensions.md` if more appropriate) explaining: register providers via `ExtensionAPI.registerProvider()`; build a resolver from kernel registries (`createProviderResolver(kernel.registries.providers)`) or from an explicit list mixing first-party + own; first-party packages are opt-in and individually installable; core runs without any first-party package.
    - Performance: example runs network-free with `createMockProvider`; compiles under `npm run typecheck`.
    - Code Quality: example follows `examples/provider-registration.ts` conventions (runnable via `node examples/provider-resolver.ts` on Node 24 native type-stripping, `demo()` + `main()` pattern).
    - Security: No real credentials; mock providers only.
  - Approach:
    - Documentation Reviewed:
      - `examples/provider-registration.ts`: the working pattern for loading a first-party provider package through the extension kernel.
      - `docs/extensions.md` lines 75 / 110 / 132: `registerAgent`/`registerProvider` contribution pattern and inert-until-host-resolves semantics.
      - `docs/provider-packages.md`: provider package contract; the right home for "third-party provider packaging" guidance.
      - `docs/contribution-registries.md`: provider contributions are inert until the host resolves/selects (the resolver is the selection mechanism here).
    - Options Considered:
      - Example + a "Third-party provider packaging" section in `docs/provider-packages.md`: reuses the existing provider-package doc and the existing example conventions. Chosen.
      - New standalone `docs/third-party-providers.md`: fragments the provider docs; the prism-wiki groups provider connection under one page. Rejected.
    - Chosen Approach:
      - One example file + one docs section. The example shows the two resolver sources (registry built from kernel contributions, and explicit list mixing first-party + own) and the `createAgent({ providerSource })` → `session.run()` path.
    - API Notes and Examples:
      ```ts
      // examples/provider-resolver.ts
      import { createAgent, createProviderResolver, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
      import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

      export async function demo() {
        // third-party own provider + a first-party package's provider (mocked key)
        const own = createMockProvider([providerTextDelta("from-own"), providerDone()]);
        // build a resolver from an explicit list mixing own + first-party-resolved providers
        const providerSource = createProviderResolver([own]);
        const agent = createAgent({ model: { provider: own.id, model: "demo" }, providerSource });
        const session = agent.createSession();
        const events: string[] = [];
        for await (const e of session.subscribe()) events.push(e.type);
        await session.run("hi");
        return { streamed: events.includes("message_delta") };
      }
      export async function main() { console.log(JSON.stringify(await demo())); }
      if (import.meta.url === `file://${process.argv[1]}`) await main();
      ```
    - Files to Create/Edit:
      - `examples/provider-resolver.ts`: new runnable example.
      - `docs/provider-packages.md`: add "Third-party provider packaging" section (register via `ExtensionAPI.registerProvider`; build resolver from `kernel.registries.providers` or an explicit list; first-party opt-in; core needs none).
      - `examples/README.md` or equivalent index if examples are listed (verify and update if present).
    - References:
      - `examples/provider-registration.ts` (conventions).
      - Task 1 / Task 2 exports.
  - Test Cases to Write:
    - Extend `src/__tests__/docs.test.ts`: assert `examples/provider-resolver.ts` exists and that `docs/provider-packages.md` contains a "Third-party provider packaging" heading. The example itself is compile-checked by `examples/tsconfig.json` (no runtime test needed beyond the existing typecheck gate).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented third-party provider packaging + resolver example.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: "Third-party provider packaging" section.
      - `examples/provider-resolver.ts`: new example.
    - `docs/index.md` update: yes — add the example to the examples list if `docs/index.md` lists examples, otherwise add a "Provider resolver" cross-link under "Provider and model connection".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Final verification and boundary checks
  - Acceptance Criteria:
    - Functional: `npm test` green (existing tests + new providers/agents/docs tests). `npm run typecheck` green (includes `examples/tsconfig.json` compile of `examples/provider-resolver.ts`). `src/` imports no `synapta*` package and no domain vocabulary (`workflow`/`node`/`step`) appears in `ProviderResolver`/`createProviderResolver`. No first-party provider package is a runtime dependency of `@arnilo/prism` (core still runs mock-only).
    - Performance: `npm test` under the < 30s offline budget (baseline ~22s on Node 20); new tests add negligible time.
    - Code Quality: Public barrel exports `ProviderResolver` and `createProviderResolver`; no unused exports.
    - Security: No credentials, no network, no globals introduced; resolver only returns previously-registered provider objects.
  - Approach:
    - Documentation Reviewed:
      - `package.json` `scripts.test` / `scripts.typecheck` — the verification gates.
      - Existing `src/__tests__/phase*-boundaries.test.ts` pattern for the no-domain-vocabulary assertion (extend or mirror).
    - Options Considered:
      - Extend an existing boundary test file with the `synapta*` import deny-check and the `ProviderResolver` field-name check: consistent with existing boundary-test patterns. Chosen.
      - New standalone boundary test: fragments the boundary checks. Rejected.
    - Chosen Approach:
      - Run the full local gate (`npm test` + `npm run typecheck`); extend a boundary test (or the providers test) to assert `src/` has no `synapta*` import and `ProviderResolver`'s signature carries no domain vocabulary. Verify `package.json` `dependencies` does not list any `@arnilo/prism-provider-*` package.
    - API Notes and Examples:
      ```bash
      npm test && npm run typecheck
      ```
    - Files to Create/Edit:
      - `src/__tests__/providers.test.ts` or an existing `phase*-boundaries.test.ts`: add the boundary assertions described above.
    - References:
      - Existing boundary tests in `src/__tests__/`.
      - `docs/release-and-install.md` (offline budget and gate definitions).
  - Test Cases to Write:
    - Boundary assertion: `grep -R "synapta" src/` returns nothing (assert via a test that reads `src/` files or extends the existing deny-import check).
    - Boundary assertion: `ProviderResolver` type signature contains none of `workflow` / `node` / `step`.
    - `package.json` `dependencies` contains no `@arnilo/prism-provider-*` entry (core has no runtime first-party provider dependency).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable (verification task).

## Compromises Made
- `createProviderResolver` uses a small private `isProviderRegistry` type-predicate helper rather than inline `Array.isArray` narrowing. TypeScript could not narrow `readonly AIProvider[]` out of the else branch with `Array.isArray`/`!Array.isArray` (the `readonly` array defeats the built-in narrowing), so an explicit `source is ProviderRegistry` predicate was required. Functionally identical to the planned inline branch; one extra 3-line helper in `src/providers.ts`.
- The `ProviderResolver` type lives in `src/contracts.ts` (single source of truth, as planned) and is re-exported from the public barrel directly from `./contracts.js`; `src/providers.ts` imports it as a type rather than re-exporting, to avoid duplicate export warnings. No behavior change for consumers.
- Test file placed at `src/__tests__/providers.test.ts` (new file). No prior `providers.test.ts` existed, so this is additive; the `mock-provider.test.ts` and `provider-events.test.ts` files are unchanged.
- The runtime stores the resolved provider on a new `private activeProvider?: AIProvider` field for the duration of a run, mirroring the existing `activeRedactor` per-run field pattern (same set-in-`run()`/clear-in-`finally` lifecycle). This was chosen over threading the provider through `generateWithRetry` → `generateProviderTurn` parameters to minimize signature churn and stay consistent with the existing per-run-field convention. The field is cleared in `finally` so it never leaks across runs.
- `requireProvider()` was renamed to `resolveRunProvider(options: RunOptions)` because the resolution now needs the per-run `options.model` (a `RunOptions` field, not previously consulted at this point). The old throw message `Unknown provider: ${config.model.provider}` is preserved using `options.model ?? config.model`, keeping the error contract stable.
- **Deviation from plan ordering note:** the plan's Task 2 stated `requireProvider` runs *after* `agent_started` emit; in the actual codebase it runs *before* `agent_started` (line 89, before line 95 emit). The implementation preserves the *actual* existing ordering (resolve before `agent_started`), not the plan's misstated one. Raise an error before emitting `agent_started` so a missing provider fails fast without a misleading start event. No behavior change vs. pre-change.
- Example `examples/provider-resolver.ts` loads the real `@arnilo/prism-provider-openai` package (fake key) to make the first-party + third-party mix realistic, then routes to a mock `own` provider so the demo stays network-free. The plan suggested a mocked first-party package; the real package is a stronger demonstration and still emits no network calls (registration is inert). The example's `providers` output `["openai","openai-codex","own"]` confirms the mix.
- Docs section in `docs/provider-packages.md` named `## Third-party provider packaging` (an `##` heading, not `###`) to match the page's existing top-level section style (`## What it does`, `## When to use it`, etc.). The docs test keys on the exact string `## Third-party provider packaging`.
- Resolver section added to `docs/provider-layer.md` as `### Provider resolver` (sub-heading under `## Inputs / request`) to match that page's existing `### Provider registry` / `### Model registry` / `### Mock provider` sub-structure. The docs test keys on `### Provider resolver`.
- Boundary tests placed in a dedicated `src/__tests__/phase24-boundaries.test.ts` (mirroring the `phase1X-boundaries.test.ts` pattern) rather than extending `providers.test.ts`, to keep boundary concerns separable from functional tests and consistent with the existing phase-boundaries convention. The plan's "extend an existing boundary test file or the providers test" left this open; the dedicated file is the clearer choice given the phase-numbered convention.
- The domain-vocabulary boundary check scans `src/providers.ts` and `src/contracts.ts` for `workflow`/`node`/`step` rather than just the resolver's signature lines. The narrower signature-only regex was brittle across multi-line type declarations; the file-level scan is stricter and still cheap. The aligned-regex attempt was dropped as YAGNI — the two-file scan is sufficient and readable.

## Further Actions
- Phase 24 complete. All four tasks done; `npm test` (467 core + all workspaces, 0 fail) and `npm run typecheck` green.
- Consider exporting `ProviderResolver` from `src/providers.ts` as well for symmetry with `ProviderRegistry`, but it's already public via the barrel from `contracts.ts` — defer unless a consumer asks. Priority: low.
- Verify the LLM compaction strategy package (`@arnilo/prism-compaction-llm`) does not rely on `AgentConfig.provider` to fetch its own provider; quick check confirmed default compaction (`createDefaultCompactionStrategy`) does not touch the provider field at all (strategy is self-contained). No action needed unless LLM compaction is later wired to reuse `activeProvider`. Priority: low.
- `generateWithRetry` / `generateProviderTurn` still read `this.activeProvider!`; if a future compaction-during-run path needs the provider for summarization it can read `this.activeProvider` directly. Noted for Phase 27 loop work.
- `docs/index.md` already links `provider-layer.md` and `provider-packages.md` under "Provider and model connection"; no new navigation entry needed for the resolver since it lives within those existing pages. Priority: low.
- The example `examples/provider-resolver.ts` depends on `@arnilo/prism-provider-openai` at typecheck time (already a workspace dependency of `examples/tsconfig.json` paths); confirmed by `npm run typecheck` passing.
- Next phase: Phase 25 (runtime tool validation hook) — `dispatchToolCall` already has a `validate` option the runtime never passes; wire `AgentConfig`/`RunOptions` validator through `dispatchToolCall`'s `validate`. The resolver seam from this phase is reused by Phase 33 (`resolveAgentDefinition`) for model → provider resolution.
