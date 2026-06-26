# prism Roadmap

Updated: 2026-06-25

`prism` is a TypeScript/Node.js agent harness package. Host apps and extension
packages bring providers, models, tools, resources, credentials, UI, storage,
permissions, and business integrations. Prism supplies the common contracts,
registries, event flow, agent/session orchestration, configuration hooks, and
replaceable default implementations.

## Non-negotiable boundaries

- **No built-in app tools.** Core must not ship shell, filesystem, browser, Synapta, desktop, or web-app tools.
- **Extensible before clever.** Any behavior that packages may reasonably need to change must be a contract, registry, middleware, strategy, or extension hook.
- **Defaults are replaceable.** Prism may include default prompt assembly, context ordering, compaction, config loading, stores, and adapters, but hosts/packages can replace them without editing Prism internals.
- **API first, CLI second.** CLI/RPC are adapters over the public API.
- **Host controlled.** No hidden globals for providers, credentials, stores, resources, permissions, or extension loading.
- **Secrets never enter history/events.** Credentials are resolved at the edge that needs them and redacted from errors/events/session entries.
- **Docs ship with APIs.** Every public API, extension point, event, config surface, package manifest field, or default strategy must be documented under `/docs` as it is implemented.

## Current implementation checkpoint

### Completed: repository baseline

Delivered:
- ESM TypeScript package with strict `tsconfig.json`.
- Placeholder CLI bin.
- Public root barrel.
- `node:test` test flow with no test framework dependency.

### Completed: public contracts

Delivered:
- `src/contracts.ts` contracts for messages/content, agents/sessions, provider events, tools, context, skills, extensions, session store, resource loader, settings, and credentials.
- Root type exports and compile-only host examples.
- Boundary tests against app/tool/domain leaks.

Compromises/follow-ups from `plans/001-public-contracts.md`:
- Contracts currently live in one file. Split by domain only when implementation phases make that useful.
- README has only concise API inventory; full `/docs` pages are still required.
- Provider/model registries were the first high-priority follow-up and are now implemented.
- Revisit contract organization after runtime modules exist.

### Completed: provider and model layer

Delivered:
- `createProviderRegistry()` and `createModelRegistry()` with explicit `Map`-backed O(1) lookup.
- Provider event helpers and `tool_call_delta` support.
- Credential resolution helper and redaction helper.
- `createMockProvider()` for tests/examples.
- `prism/providers/openai-compatible` subpath using native/injected `fetch`, SSE parsing, mocked tests, abort propagation, usage mapping, and secret redaction.

Compromises/follow-ups from `plans/002-provider-streaming-and-mock-provider.md`:
- OpenAI-compatible adapter targets Chat Completions streaming only; Responses API support waits for a real consumer.
- Tool-call fragments are emitted as `tool_call_delta` and reconstructed into final `tool_call`; provider edge cases need conformance tests if more adapters are added.
- Credential handling resolves per request and redacts known values, but credential storage/env/settings integration belongs to the security/settings phase.
- Phase 3 must build agent/session runtime on top of `AIProvider`, `ProviderEvent`, registries, and `createMockProvider`.
- Revisit OpenAI-compatible multimodal request mapping after image-capable runtime examples exist.

### Deferred work review from `plans/001-013.md`

The completed plans intentionally deferred these items; the new post-Phase-10 work pulls only the pieces that now have real demand:

- Real provider wiring stayed out of core: CLI uses only mock bootstrap, the built-in OpenAI-compatible adapter is Chat Completions-only, and adapter conformance was deferred until a second real adapter exists.
- Credential storage stayed in memory/explicit files; persistent encrypted keychains and automatic env/project discovery remain host/package concerns.
- Provider-specific retry and request quirks were deferred to adapter packages instead of expanding the generic retry classifier.
- Provider-backed compaction was explicitly left for optional packages; the current default compaction is local, conservative, and entry-count based.
- Observational/vector/semantic memory was not added to core; session stores already preserve raw entries and custom/compaction data that memory packages can build on.
- Package discovery, URI routing, schema generation, and trust prompts stayed out of core unless a host/runtime proves they are needed.
- System prompt support exists as `AgentConfig.instructions` and input-builder instructions, but package/app layered prompt contributions are not yet a documented configurable surface.
- Docs/export drift checks, compiled examples, network-free provider conformance, and release packaging remain hardening work.

Conclusion: add generic provider/auth/cache/system-prompt primitives only where current contracts are insufficient, then implement the requested providers and compaction strategies as separate packages.

## Target architecture

### 1. Kernel and extension bus

Prism's kernel owns only invariant mechanics:
- Session/run lifecycle.
- Ordered event emission.
- Registry lookup and fail-closed behavior.
- Middleware/strategy invocation order.
- Abort propagation and bounded loops.
- Secret redaction boundaries.

Everything else is contributed through explicit contracts:
- Providers and models.
- Agent definitions/factories.
- Input sources and prompt assemblers.
- Context providers and skills.
- Tools and tool middleware.
- Compaction strategies.
- Session stores and resource loaders.
- Commands, CLI/RPC handlers, and extension-defined capabilities.

### 2. Extension/package model

External packages must be able to add or replace behavior without touching Prism internals.

Expected extension capabilities:
- Register providers/models/tools/context providers/skills/commands/agents.
- Register or replace default strategies: input assembly, prompt composition, tool-call policy, compaction, retry, store selection, model selection.
- Subscribe to lifecycle events and optionally transform/stop behavior through middleware.
- Provide package manifests with contributions and package-local configuration schema/defaults.
- Bring their own agents while using only Prism fundamentals such as events, registries, stores, settings, resources, credentials, and provider streams.

### 3. Configuration and manifests

Configuration is layered and host-controlled:
1. Built-in Prism defaults.
2. Extension/package manifest defaults.
3. Host app config.
4. Optional user/global config, e.g. `~/.config/prism`, only through an explicit filesystem config loader.
5. Runtime/session/run overrides.

Core should define config contracts and merge/validation behavior. Filesystem discovery/loading is optional utility code for CLI/Node hosts, not hidden core behavior.

### 4. Input and prompt assembly pipeline

Agent input is not just a string. It is assembled from:
- Direct user input.
- Attachments such as text files/images/resources.
- System/developer instructions.
- Model/provider constraints.
- Enabled skills.
- Context provider output.
- Active tool definitions and tool results.
- Session history and summaries.
- Host metadata.

Prism should provide a default input/prompt pipeline, but every stage must be replaceable or interceptable by an extension/package.

### 5. Compaction and memory

Compaction is a strategy, not hard-coded behavior.
- Default strategy: simple threshold-driven summarization policy.
- Optional strategies: branch summaries, provider-backed summarization, host-specific memory stores.
- Hosts/extensions can replace strategy, summary format, thresholds, and persistence.
- Raw history should not be deleted by default; compaction adds entries/summaries.

### 6. Documentation/wiki

`/docs/index.md` is the navigational map for users and AI agents. It must group APIs by functionality and link every public surface to a detailed page.

Every API page must include:
- API name.
- What it does.
- When to use it.
- Inputs/request.
- Outputs/response/events.
- Request/response example.
- TypeScript implementation example.
- Extension/configuration notes.
- Security/performance notes.
- Related APIs.

The create-plan skill now requires a per-task `Documentation/Wiki Assessment` and references `.agents/skills/create-plan/references/prism-wiki.md`.

## Updated phases

### Phase 0 — Documentation governance and implemented API wiki catch-up

**Goal:** make docs mandatory before more runtime is built.

Deliver:
- Enforce create-plan wiki assessment and Prism wiki reference for future plans.
- Create `/docs/index.md` with functional API groups.
- Document already implemented APIs: public contracts, provider/model registries, provider events, mock provider, credential/redaction helpers, and OpenAI-compatible provider subpath.
- Add a lightweight docs consistency check if cheap.

Acceptance:
- Every future plan task includes a `Documentation/Wiki Assessment`.
- `/docs/index.md` links to implemented API docs.
- Implemented API docs follow the Prism wiki page structure.

### Phase 1 — Current implementation alignment

**Goal:** align the completed Phase 1/2 code with the extensible target before adding session runtime.

Deliver:
- Review whether `AgentConfig.provider`, `AgentConfig.credentials`, and registry usage should be adjusted for extension/config-driven provider selection.
- Decide whether registry interfaces belong in `contracts.ts` or runtime modules only.
- Review `ProviderEvent` final shape for `tool_call_delta`, usage, thinking, images, and provider errors.
- Add provider adapter conformance tests if useful now.
- Record whether `src/contracts.ts` remains one file or splits by domain.

Acceptance:
- No hidden provider/credential globals are introduced.
- Existing tests still pass.
- Any public contract changes are documented in `/docs`.

### Phase 2 — Extension kernel and contribution registries

**Goal:** establish the plugin surface before agent runtime hardens behavior.

Deliver:
- `Extension` setup lifecycle and explicit `ExtensionAPI` runtime implementation.
- Event bus with ordered lifecycle events and error isolation.
- Contribution registries for providers, models, tools, context providers, skills, commands, agents, prompt/input builders, compaction strategies, stores, resource loaders, settings providers, and credential resolvers.
- Middleware hooks for provider requests/responses, input assembly, context, tool calls/results, retry, compaction, and session lifecycle.

Acceptance:
- An extension can register provider/model/tool/context/skill/command/agent contributions.
- Extension errors become events and do not crash unless host policy says so.
- API users can skip extension loading entirely and use registries directly.

### Phase 3 — Configuration, manifests, and resource loading

**Goal:** let packages and hosts describe contributions/config without hard-coded Prism internals.

Deliver:
- Manifest schema/types for package contributions and config defaults.
- Config provider/loader contracts and deterministic merge order.
- Optional Node filesystem config loader for CLI/hosts, including user config location such as `~/.config/prism`.
- Resource loader contract integration for extension manifests, skills, prompts, and package resources.

Acceptance:
- Core can run fully in-memory with no filesystem access.
- Filesystem loading is explicit and host/CLI-controlled.
- Manifests can describe contributions without executing code until the host loads the package.

### Phase 4 — Host-owned tool harness

**Goal:** robust tool declaration/filtering/dispatch with zero built-in app tools.

Deliver:
- `createToolRegistry()` with O(1) lookup.
- Active allow/deny filtering per agent/session/run.
- JSON Schema-compatible `parameters` pass-through.
- Optional host validator and middleware before execution.
- Tool events for blocked calls, progress, result, and error.

Acceptance:
- Unregistered tool calls fail closed and are never executed.
- Tool args must be object-shaped.
- Extensions can add middleware but cannot bypass host permissions.

### Phase 5 — Input, prompt, context, and skills pipeline

**Goal:** make everything that becomes provider input visible and replaceable.

Deliver:
- Default input assembler for user text, attachments/resources, system prompt, active tools, context blocks, skills, tool results, history, summaries, and host metadata.
- Replaceable prompt composer strategy.
- Ordered `ContextProvider.resolve(ctx)` pipeline.
- `SkillRegistry` implementation with explicit host/extension registration and progressive disclosure support.
- Prompt template expansion for CLI/RPC use.

Acceptance:
- Default behavior works for common host input.
- Extensions can replace or intercept assembly/composition stages.
- Skills cannot register missing tools or grant permissions by themselves.

### Phase 6 — Minimal agent/session runtime

**Goal:** one shared extension-aware runtime used by SDK, CLI print/json, and RPC later.

Deliver:
- `createAgent(config)` and external-agent registration support.
- `agent.createSession(config)` and `createAgentSession(config)`.
- `session.run(input, options)` / `session.prompt(...)`.
- `session.subscribe()` as `AsyncIterable<AgentEvent>`.
- Bounded loop: assemble input → provider stream → optional tool calls → tool results → next provider turn.
- `abort()` and `maxToolRounds`.

Acceptance:
- Mock provider streams `Hello` to a subscriber.
- Mock provider can request one registered host tool, receive result, and continue.
- Abort stops current provider/tool path before next turn.
- Runtime uses extension/configured strategies rather than hard-coded prompt/context/compaction behavior.

### Phase 7 — Sessions, branching, and stores

**Goal:** durable memory with replaceable persistence.

Deliver:
- `MemorySessionStore` and async `SessionStore` implementation.
- JSONL session store adapter.
- Session entries with `id`, `parentId`, timestamps, messages, model changes, labels, custom entries, summaries, and compaction entries.
- Resume, fork, clone, branch navigation.

Acceptance:
- Session context can be rebuilt from the current leaf.
- Branching preserves old paths.
- Stores receive no provider credentials.

### Phase 8 — Compaction strategies and retry policy

**Goal:** memory reduction and transient-failure handling as replaceable policies.

Deliver:
- Compaction strategy contract and default implementation.
- Manual and auto-compaction APIs.
- Branch-summary entries without deleting raw history.
- Retry/backoff policy for transient provider errors.
- Extension hooks around compaction/retry.

Acceptance:
- Hosts/extensions can replace compaction and retry policies.
- Compaction records summaries and keeps recent context.
- Secrets are not serialized into summaries/events/stores.

### Phase 9 — CLI and RPC surfaces

**Goal:** terminals, desktop apps, and non-Node clients use the same public runtime.

Deliver:
- `prism -p "prompt"` print mode.
- `prism --mode json` event stream mode.
- `prism --mode rpc` strict LF-delimited JSONL protocol.
- CLI flags for provider/model/session/extensions/resources/tools/system prompt/context/compaction/config.
- RPC commands for prompt, steer, follow-up, abort, state/messages, set model, compact, session switch/fork/clone, commands.

Acceptance:
- CLI modes use the same `AgentSession` API.
- RPC clients correlate responses by id and receive async events.
- No full TUI in core v1.

### Phase 10 — Settings, auth, trust, and security controls

**Goal:** safe embedding defaults without pretending to sandbox host tools.

Deliver:
- Settings provider interface implementations and optional filesystem settings loader.
- Auth storage/resolution utilities as opt-in modules.
- Project/resource trust model for CLI filesystem loading.
- Host permission hooks for tools/extensions/resources.
- Secret redaction utilities for errors/events/prompts/sessions.

Acceptance:
- Host can run Prism fully in-memory.
- CLI does not load project-local executable resources without trust.
- Secrets are not serialized into events, prompts, compaction, or sessions.

### Phase 11 — Provider, auth, cache, and system-prompt primitives

**Goal:** add only generic surfaces needed by real provider packages and package/app prompts.

Deliver:
- Provider-package contract for registering models, providers, auth methods, request policies, and docs without hidden globals.
- OAuth/API-key credential contracts modeled after Pi's `OAuthLoginCallbacks`, refreshable credentials, and explicit API-key resolution order.
- Generic provider request/cache policy hook that can add headers, payload fields, session ids, cache retention, and model-specific compatibility data before `AIProvider.generate()`.
- Model metadata/compat extension for prompt caching, reasoning/thinking formats, OpenRouter routing passthrough, and provider-specific usage mapping without hard-coded provider names in core.
- Layered system prompt contributions for apps/packages/users/runs with explicit merge/replace order; keep `AgentConfig.instructions` as the simple direct path.
- Network-free provider conformance harness covering stream order, abort, tool-call reconstruction, usage/cache accounting, redaction, and request-policy payload checks.
- `/docs` updates for provider packages, OAuth/API keys, cache policy, model compat metadata, and system prompt layering.

Acceptance:
- Core can still run fully in memory with mock providers and no package loading.
- No OpenAI/OpenRouter/ZAI/Kimi/OpenCode literals are added to core behavior.
- A package can provide OAuth or API-key auth, cache policy, and model metadata through public contracts only.
- Apps can choose, replace, or disable system prompt layers and cache policy per run/model.

### Phase 12 — Real provider packages

**Goal:** ship the requested provider connections as separate packages that follow Pi's proven provider implementations.

Deliver:
- `@arnilo/prism-provider-openai`: OpenAI API-key Responses support plus ChatGPT Plus/Pro/Codex subscription OAuth using Pi's PKCE browser/device-code flow and Codex Responses request shape.
- `@arnilo/prism-provider-opencode-go`: OpenCode Go API-key provider using Pi's model metadata, OpenAI-compatible/Anthropic-compatible routes, and `x-opencode-session` cache/session headers.
- `@arnilo/prism-provider-openrouter`: OpenRouter API-key provider with app-controlled model catalog, routing passthrough, reasoning controls, and model-level cache policy overrides.
- `@arnilo/prism-provider-zai`: ZAI GLM API-key provider using Pi's OpenAI-compatible `thinkingFormat: "zai"`, developer-role fallback, and GLM tool-stream quirks.
- `@arnilo/prism-provider-kimi`: Kimi For Coding subscription/API-key provider using Pi's Anthropic-compatible Kimi endpoint and headers; keep Moonshot API-key models as optional model metadata, not core behavior.
- Provider cache policies copied/adapted from Pi where applicable: OpenAI `prompt_cache_key`/`prompt_cache_retention`, Codex session/request ids, Anthropic-style `cache_control`, OpenCode session headers, OpenRouter per-model cache control, and provider usage cache-read/write mapping.
- Unit tests use mocked `fetch`/streams/OAuth callbacks only; live integration tests are opt-in behind explicit env vars and skipped by default.
- Docs/examples for each package: OAuth login, API key, model selection, cache control, OpenRouter model override, and secret redaction.

Acceptance:
- Requested providers can be registered without modifying Prism core.
- Secrets never appear in events, summaries, docs fixtures, or stored session entries.
- Provider conformance tests pass for all packages without network.
- OpenRouter users/apps can control cache behavior per model instead of accepting a single hard-coded policy.

### Phase 13 — LLM compaction strategy package

**Goal:** provide provider-backed compaction as a replaceable strategy, based on Pi's compaction implementation.

Deliver:
- `@arnilo/prism-compaction-llm` with token-estimated cut points, `reserveTokens`, `keepRecentTokens`, previous-summary update prompts, split-turn prefix summaries, custom instructions, and structured markdown summary format.
- Conversation serialization that prevents continuation, truncates oversized tool results, preserves exact file paths/errors/decisions, and redacts known secrets.
- Optional file-operation tracking in compaction details, following Pi's read/modified file summary pattern but using Prism tool-result/message contracts.
- Strategy options for summary provider/model, thinking level, cache policy, max summary tokens, and host-supplied credential resolver.
- Manual and auto-compaction integration through existing `CompactionStrategy`, middleware, session store, and branch APIs; raw history remains append-only.
- Docs/examples showing how an app picks a cheap summarization model or reuses the active model.

Acceptance:
- LLM compaction is not the core default unless a host explicitly selects the package strategy.
- Failed/aborted summarization does not delete raw history or corrupt the session branch.
- Tests cover normal, repeated, split-turn, branch-summary, redaction, and provider-error paths with mock providers only.

### Phase 14 — Observational memory compaction package

**Goal:** provide observational memory as a replaceable package, based on `pi-observational-memory` V3.

Deliver:
- `@arnilo/prism-compaction-observational-memory` with observer, reflector, and dropper workers that run from session events and store append-only custom memory ledger entries.
- Observation/reflection/drop data model with 12-character source-backed ids, relevance levels, coverage tiers, active/full projections, and folded compaction details.
- Compaction strategy that renders prepared memory immediately instead of calling a model during compaction.
- Optional recall tool/command contributions that recover exact source entries for a known observation/reflection id; no semantic search.
- Settings namespace for thresholds, passive mode, worker model, thinking level, pool targets, and debug logging through explicit `SettingsProvider`/host config.
- Primitive review before implementation: use existing `SessionEntry.kind: "custom"` and `data` first; add only generic custom-entry typing if package evidence shows the current contract is insufficient.
- Docs/examples for passive mode, worker model selection, memory status/view, recall, and compaction handoff.

Acceptance:
- Observational memory can be installed/registered without changing Prism core or provider packages.
- Background workers never run without explicit host/package activation and credentials.
- Compaction remains fast because it renders existing memory; model work happens before compaction.
- Recall returns source evidence from the current branch and fails closed for invalid/missing ids.

### Phase 15 — Provider and runtime correctness hardening

**Goal:** fix behavior that can make an installed agent fail despite passing unit tests.

Deliver:
- Preserve provider round trips for text, thinking, `tool_call`, `tool_result`, and supported image blocks across core OpenAI-compatible support and all first-party provider packages; if a provider cannot support a block, fail or downgrade explicitly instead of silently dropping it.
- Add provider conformance coverage for request serialization, full tool-call/tool-result replay, malformed SSE/JSON/tool-argument recovery, usage/cache accounting, abort, and redaction.
- Fix RPC so `abort`, state, and follow-up/control requests can be processed while a prompt is running, with responses and streamed events still correlated by request id.
- Resolve the `provider_response` middleware mismatch by either invoking it in runtime or removing it from public hook docs/types.
- Bring manifest contribution kinds back in sync with current registries, including provider packages, auth methods, provider request policies, and system prompt contributions.
- Align advertised model capabilities with serializers: image-capable models must serialize images or not claim image input.

Acceptance:
- Mock end-to-end tests prove a provider tool call is executed, appended to history, replayed as a provider-native tool result, and followed by a final assistant response.
- RPC abort works during an active provider stream/tool wait.
- Provider conformance catches text-only serializers that drop required non-text blocks.
- Docs and exported types agree on every middleware hook and manifest contribution kind.

### Phase 16 — Auth, redaction, and session-data hardening

**Goal:** make security-sensitive and persistence boundaries boring before packaging.

Deliver:
- Fix OpenAI Codex OAuth using cryptographically secure PKCE/device-code behavior, redirect/scopes where required, and clear API-vs-Codex base URL options; otherwise remove/downgrade the OAuth surface from stable docs.
- Make redaction cycle-safe and JSON-shape preserving enough for events, errors, prompts, tool results, and session metadata.
- Harden JSONL session parsing so invalid `message`, `summary`, `parentId`, `model`, and custom `data` shapes are rejected or quarantined before runtime use.
- Return defensive copies from in-memory session-store reads so callers cannot mutate stored history accidentally.
- Review Node path trust against symlink/realpath escapes for filesystem resource loading; keep any deeper sandboxing out of core.
- Keep live provider/worker tests opt-in behind explicit environment variables and network-free by default.

Acceptance:
- Cyclic metadata/tool results do not crash redaction.
- Corrupt JSONL fixtures fail closed with useful errors and do not poison a session branch.
- Memory-store callers cannot mutate persisted entries by editing `list()` results.
- OAuth tests use mocked callbacks/fetch only and no credentials enter events, docs fixtures, or stored sessions.

### Phase 17 — Package boundaries, installability, and release mechanics

**Goal:** prove the published tarballs contain only what users need and install cleanly.

Deliver:
- Split build/test or packaging so `dist/__tests__` and accidental maps are not published unless intentionally retained.
- Include required release files and package metadata: `LICENSE`, `CHANGELOG.md`, repository, bugs, homepage, license, keywords, and `sideEffects` where appropriate.
- Include shipped API docs where packages claim docs ship with APIs; avoid publishing unrelated plans, tests, fixtures, or internal generated output.
- Make first-party packages' `prism` peer dependency non-optional unless a tested install story proves otherwise.
- Add tarball install/import smoke tests for `prism`, every exported subpath, and every first-party workspace package by package specifier, including `@arnilo/prism-compaction-observational-memory`.
- Make `npm ls --all --depth=0`, `npm pack --dry-run --json`, and package import smoke checks clean in a fresh install/workspace.
- Add a minimal release workflow/dry-run for core plus first-party packages.
- Reduce default no-network test time to the release target or explicitly adjust that target in this roadmap with rationale. Baseline measured on Node 20: `npm test` medians ~22s wall (build ~12.5s + tests ~9.5s, tests parallelized); budget pinned at < 30s — see `docs/release-and-install.md`.

Acceptance:
- Packed core and package tarballs contain README/LICENSE/CHANGELOG/docs plus public compiled output only.
- No published tarball includes built test artifacts.
- Fresh install smoke tests import every documented package/subpath without workspace-relative paths.
- Default tests remain network-free and meet the chosen time budget (< 30s for `npm test` on Node 20; baseline ~22s).

### Phase 18 — Documentation, examples, and fixtures catch-up

**Goal:** make the implemented package usable without reading source.

Deliver:
- Update `README.md` to describe the current Phase 14+ runtime instead of earlier placeholder scope.
- Complete provider-specific docs for OpenAI, OpenCode Go, OpenRouter, ZAI, and Kimi using the required API-page headings; extend docs tests so provider-specific pages are enforced, not only the generic OpenAI-compatible page.
- Complete `/docs` coverage and `/docs/index.md` links for provider package authoring, OAuth/API-key auth, cache policy, model compat metadata, system prompt layering, LLM compaction, observational memory, CLI/RPC, manifests, and release/install behavior.
- Add compile-checked typed examples for SDK basics, provider registration, API-key auth, OAuth login, OpenRouter model/cache override, tools, context, skills, extensions, manifests, config/settings, system prompts, JSONL stores/branching, compaction, observational-memory recall/status/view, CLI, and RPC.
- Add end-to-end mock demos for provider packages, LLM compaction, observational memory recall, CLI, and RPC.
- Add golden session JSONL fixtures covering branching, compaction, LLM summaries, observational-memory ledger entries, corrupt entries, and tool-result replay.
- Document optional live provider/worker smoke-test environment variables without making them part of default verification.

Acceptance:
- Every public API, extension point, event, config surface, package manifest field, default strategy, and first-party package has a linked docs page.
- Examples compile without network or real credentials.
- Golden fixtures are used by tests and avoid real-looking secrets.
- Docs tests fail when a provider-specific page lacks the standard API headings.

### Phase 19 — Final release validation

**Goal:** final publish gate after Phases 15–18 finish; this replaces the old broad Phase 15 implementation bucket.

Deliver:
- Run final network-free tests, typecheck, examples compile, audit, tarball dry-runs, fresh-install import smoke tests, docs checks, and public export contract tests for core plus first-party packages.
- Review package contents, release notes, changelog, versioning, and release workflow output before publishing.
- Confirm no built-in app tools, hidden provider/credential globals, automatic package discovery, or secret persistence slipped into core.

Acceptance:
- Tests run under the chosen release time budget without network by default.
- Examples compile.
- `npm pack --dry-run` includes only needed files for core and first-party packages.
- Fresh install users can follow README/docs examples without workspace paths.

## Suggested implementation-plan order

Completed:
1. `001-public-contracts.md`
2. `002-provider-streaming-and-mock-provider.md`
3. `003-documentation-governance-and-implemented-api-wiki.md`
4. `004-current-implementation-alignment.md`
5. `005-extension-kernel-and-contribution-registries.md`
6. `006-configuration-manifests-and-resource-loading.md`
7. `007-host-tool-harness.md`
8. `008-input-prompt-context-skills-pipeline.md`
9. `009-agent-session-runtime.md`
10. `010-session-store-jsonl-branching.md`
11. `011-compaction-strategies-and-retry.md`
12. `012-cli-json-rpc.md`
13. `013-settings-auth-trust-security.md`
14. `014-provider-auth-cache-and-system-prompt-primitives.md`
15. `015-real-provider-packages.md`
16. `016-llm-compaction-strategy.md`
17. `017-observational-memory-strategy.md`

Next:
18. `018-provider-runtime-correctness-hardening.md`
19. `019-auth-redaction-session-data-hardening.md`
20. `020-package-boundaries-installability-release-mechanics.md`
21. `021-documentation-examples-fixtures-catch-up.md`
22. `022-final-release-validation.md`
23. `023-publish-to-npm-0.0.1.md` (done — v0.0.1 published)

Synapta third-party-ergonomics track (post-v0.0.1):
24. `024-provider-resolver-seam-and-third-party-provider-packaging.md` (done)
25. `025-runtime-tool-validation-hook.md`
26. `026-skill-semantics-active-selection-context-toolnames.md`
27. `027-generic-agent-loop-strategy-single-shot-and-generate-validate-revise.md`
28. `028-validation-refinement-events-and-structured-output-contracts.md`
29. `029-workspace-and-global-package-discovery.md`
30. `030-package-context-and-instruction-injection.md`
31. `031-system-and-project-prompts-agents-and-system-md.md`
32. `032-synapta-facing-integration-example-and-boundary-lock.md`
33. `033-agent-definitions-declarative-requirements-and-resolver.md`

## Synapta integration feedback — third-party-ergonomics phase track

After v0.0.1 publishing (plan 023), Prism enters a second design track driven by
real third-party consumption (Synapta). The recurring theme across the gaps
below: Prism has the registries, hooks, and policy seams, but the agent runtime
and `AgentConfig`/`RunOptions` do not expose them, one declared field
(`Skill.context`) is inert, and the single-shot turn loop is the only loop
shape). Every gap is "plumb the existing seam through to config," not new
architecture — except the generic loop concept and the workspace/global
package-discovery + system-prompt surfaces, which are net-new but each a
single minimal seam.

Design principles enforced across this track:

- **First-party is opt-in, never mandatory.** A third party may ship its own
  providers, tools, and skills and use Prism with zero first-party packages.
  Prism's first-party provider packages, tool packs, and skills are
  individually installable and individually selectable; a third party picks
  none, some, or all.
- **Standard workspace/global discovery for contributions.** Skills discovered
  from `<workspace>/.agent/skills/<name>/` and `~/.prism/agent/skills/<name>/`;
  the same discovery applies to providers, tools, context providers, and
  instruction injectors contributed as packages. Discovery is host/CLI-driven
  (explicit filesystem loader), never a hidden global in core; apps using the
  SDK directly can skip discovery entirely.
- **Generic seams only; no Synapta types in core.** Loops, validators,
  parsers, repairers, events, and context injectors carry only Prism-native
  contracts. Domain vocabulary (workflow/node/step) stays in the third-party
  package that owns it. Boundary tests enforce this.
- **Single-shot stays the default loop.** The current single-turn strategy
  remains the default agent loop. Loop strategies are a generic
  `AgentLoopStrategy` concept; the generate-validate-revise loop is the first
  implementation, selectable per request/session/config. Additional loops can
  be added later without runtime forking.
- **Config over code.** Every new seam lives on `AgentConfig` and/or
  `RunOptions` (RunOptions overrides AgentConfig per run), mirroring how
  compaction, retry, `providerRequestPolicies`, `systemPrompt`, and
  `redactor` already work.

### Phase 24 — Provider resolver seam and third-party provider packaging

**Goal:** let a host hand Prism a provider resolver (or a registry/list) and
have the agent resolve its provider from `model.provider` per run, instead of
requiring every app to resolve and stuff a direct `AIProvider` into
`AgentConfig.provider`.

Deliver:
- `ProviderResolver` contract: `(model: ModelConfig) => AIProvider | undefined`.
- `createProviderResolver(source: ProviderRegistry | readonly AIProvider[]): ProviderResolver` generic helper (one-liner over `model.provider`; registries are one way to build one, not the only way).
- `AgentConfig.providerSource?: ProviderResolver` and `RunOptions.providerSource?: ProviderResolver` (RunOptions wins, mirroring `model`). The direct `AgentConfig.provider: AIProvider` path stays fully supported and takes precedence when set.
- `requireProvider()` becomes `provider = config.provider ?? providerSource?.(model)` then fail closed with the existing `Unknown provider: ${model.provider}` error.
- Third-party provider package authoring doc: a package can register provider contributions via `ExtensionAPI.registerProvider()` (already exists) and the host builds a resolver from either the kernel registries or its own list; first-party provider packages (`@arnilo/prism-provider-*`) are opt-in, individually installable, individually selectable.
- Workspace/global provider discovery is **not** added here (providers need credentials and are config/package-driven, not file-scanned); Phase 28 covers file-based discovery for skills/tools/context only.

Acceptance:
- An app passes a registry or a list of providers (mix of first-party and its own) and `createAgent({ model, providerSource })` resolves per run.
- Direct `provider: AIProvider` still works unchanged.
- No registry/contribution object is coupled into `AgentConfig`; only a resolver function is.
- No first-party provider package is required for core to run (mock provider only).
- Docs updated for `providerSource`, `createProviderResolver`, and third-party provider package authoring.

### Phase 25 — Runtime tool validation hook

**Goal:** expose the existing `dispatchToolCall({validate})` seam through the
agent runtime and `AgentConfig`/`RunOptions`, so an app can supply
app-level argument validation that emits the existing `tool_execution_blocked`
reason `validation_failed` event with redaction.

Deliver:
- `AgentConfig.validator?: ToolValidator` and `RunOptions.validate?: ToolValidator` (named to match `DispatchToolCallOptions.validate`; RunOptions wins).
- `RuntimeAgentSession.run()` passes `validate: options.validate ?? this.agent.config.validator` into `dispatchToolCall`.
- Compose-later: if both needed, accept arrays; for now, RunOptions override only (YAGNI).
- No new validator concept — `ToolValidator = (tool, args, context) => void | string | ErrorInfo` is already generic and Synapta-free.

Acceptance:
- A validator returning a string/`ErrorInfo` results in a `tool_execution_blocked` event with reason `validation_failed` and a redacted error, without executing the tool.
- `void` validator return executes normally.
- Existing tool dispatch tests still pass; new test covers runtime-supplied validator.
- Docs `tools.md` updated to show validator on `AgentConfig`/`RunOptions` (the `validate` field is already documented on `DispatchToolCallOptions`).

### Phase 26 — Skill semantics: active selection, Skill.context activation, toolNames enforcement

**Goal:** close the three Skill gaps where the runtime bypasses the skill
machinery: active-skill selection is not per-run, `Skill.context` is a dead
field, and `toolNames` is unenforced in the live loop.

Deliver:
- `RunOptions.activeSkills?: readonly string[]` (names). When set against a `SkillRegistry`, the runtime calls `resolveActiveSkills({registry, names, tools})` instead of `registry.list()`. When `AgentConfig.skills` is a plain `Skill[]` array (no registry), names are not resolvable — in that case an explicit `RunOptions.skills?: readonly Skill[]` override is accepted; names win when a registry exists.
- No `activeSkills` set → all configured skills active (current behavior preserved).
- Activate `Skill.context`: when building provider input, collect `activeSkills.flatMap(s => s.context ?? [])`, resolve via the existing `resolveContextProviders(...)`, and merge resulting `ContextBlock[]` into the request `context` after host `AgentConfig.context` blocks. `skillMessages()` still renders `skill.instructions`. Mark merge priority as a `ponytail:` comment (no per-skill token budgeting yet).
- `toolNames` enforcement becomes free once selection routes through `resolveActiveSkills()` (it already throws on missing tools). Add test: skill with `toolNames: ["missing"]` against a config missing that tool throws before the first provider turn. This also satisfies the docs' existing "skills cannot register missing tools" claim that the runtime currently contradicts.

Acceptance:
- Run A uses skill "summarize", run B uses "translate" via `activeSkills`, same agent config.
- A skill with `context: [schemaProvider]` injects schema context only when active.
- A skill demanding an inactive tool fails fast at activation, not at dispatch.
- `docs/context-and-skills.md` updated: describe `activeSkills`, `Skill.context` activation, and the now-enforced `toolNames`.

### Phase 27 — Generic agent loop strategy (single-shot default + generate-validate-revise)

**Goal:** make the agent's per-run control loop a replaceable strategy. The
current single-shot turn loop (assemble → provider → optional tool calls →
tool results → next turn) stays the **default**. A third party may opt a
particular request or session into a different loop, starting with
generate-validate-revise. Loops are a generic concept designed so more loops
can be added later without forking the runtime.

Deliver:
- `AgentLoopStrategy` contract: owns the per-run turn-control flow, receiving a loop context that exposes the shared primitives — `assembleProviderInput`, provider streaming, `dispatchToolCall`, abort signal, store append, event emit, and `RunOptions`. The loop does not re-implement provider calls, retry, abort, store, or events; it orchestrates them.
- `SingleShotLoop` (extracted from current `RuntimeAgentSession.run` behavior) registered as the default. Existing behavior bit-for-bit preserved when no loop is configured.
- `GenerateValidateReviseLoop` as the first alternative loop, parameterized by Prism-native callbacks only:
  - `parser?: ArtifactParser<T>` — parse model output to a typed value (`T` host-defined, Prism never instantiates it).
  - `validator: ArtifactValidator<T>` — returns `ArtifactValidation`.
  - `repairer?: ArtifactRepairer<T>` — builds the "fix this" follow-up input (default = stringify validation errors as a user message; host supplies richer one).
  - `maxRevisions?: number` (budget, mirrors `maxToolRounds`).
- Generic callback + result types in `contracts.ts`, all Synapta-free: `ArtifactValidation { ok: boolean; errors?: readonly { path?: string; message: string }[]; metadata?: ... }`, `ArtifactContext { sessionId, runId, turn, signal, metadata }`, `ArtifactParseResult<T>`, `ArtifactParser<T>`, `ArtifactValidator<T>`, `ArtifactRepairer<T>`. No `workflow`/`node`/`step` field names; `T` is host-defined.
- `AgentConfig.loop?: AgentLoopStrategy | AgentLoopOptions` and `RunOptions.loop?: AgentLoopStrategy | AgentLoopOptions` (RunOptions wins). Default: `SingleShotLoop`. A loop can be selected per request (Synapta opts a generation request into generate-validate-revise) or pinned per session/agent config.
- Naming: do **not** register generate-validate-revise as the only way to interact with agents. Single-shot remains default; the loop is opt-in.
- Boundary tests mirroring `phase*-boundaries.test.ts`: `src/` imports no `synapta*` package; `ArtifactValidation`/`ArtifactContext`/`ArtifactParseResult` carry no workflow vocabulary.

Acceptance:
- Default behavior unchanged when no `loop` is configured.
- A run with `RunOptions.loop = { strategy: "generate-validate-revise", validator, parser, maxRevisions: 3 }` loops generate→validate→revise until `ok` or budget exhausted, emitting the Phase-29 events, and appends revision turns as store entries.
- A third party (Synapta) supplies only `validator`/`parser`/`repairer` callbacks implementing its own schema; no Synapta type is imported by `src/`.
- `SingleShotLoop` and `GenerateValidateReviseLoop` are independently testable with the mock provider.
- The loop contract is generic enough that a future loop (e.g. plan-authoring, multi-agent) can be added without runtime changes.
- Docs: new `/docs/agent-loops.md` page, `docs/index.md` entry, `docs/agent-session-runtime.md` cross-reference.

### Phase 28 — Validation/refinement events and structured-output contracts

**Goal:** make artifact loops and structured output observable through the
existing `AgentEvent` stream, and lock the generic parse/validate/repair
callback contracts as the only structured-output seam (no Synapta workflow
types).

Deliver:
- `Artifact*` contract types pinned in `contracts.ts` (from Phase 27) and exported from `src/index.ts` with boundary tests passing.
- Add `AgentEvent` variants emitted by artifact loops (zero emitted when single-shot loop runs):
  - `artifact_validation_started` `{sessionId, runId, turn, attempt}`
  - `artifact_validation_finished` `{sessionId, runId, turn, attempt, result: ArtifactValidation}`
  - `artifact_revision_started` `{sessionId, runId, turn, attempt, failure: ArtifactValidation}`
  - `artifact_finished` `{sessionId, runId, turn, attempt, result: ArtifactValidation}` (loop ended successfully)
  - `artifact_failed` `{sessionId, runId, turn, attempt, result: ArtifactValidation}` (budget exhausted)
- Validation-failure-triggering-a-revision is **not** an `error` event (recoverable, like `tool_execution_blocked`); only terminal exhaustion emits `artifact_failed`. `error` channel reserved for real failures, matching existing convention.
- `attempt` numbering mirrors `retry_scheduled.attempt` and `tool_execution_*` block/finish pairing.
- `ArtifactValidation.errors.message` may echo model text — run through `redactAgentEvent`/`activeRedactor` like other payloads.
- Structured-output boundary: the only way to get typed output from a loop is `ArtifactParser<T>`. Prism never instantiates `T`; it threads host-supplied `T` through parser→validator→repairer. No `WorkflowStep`/`NodeSchema` types leak.

Acceptance:
- An artifact-loop run emits `validation_started` → `validation_finished` → (`revision_started`)* → `artifact_finished` or `artifact_failed`, correlated by `runId`/`turn`/`attempt`.
- Single-shot runs emit zero artifact events.
- `redactAgentEvent` handles `ArtifactValidation` payloads without crashing on nested/cyclic metadata.
- `src/` imports no `synapta*`; artifact contract field names contain no domain vocabulary (boundary test).
- Docs: `/docs/agent-events.md` updated with artifact events; `/docs/structured-output.md` (new) documents parser/validator/repairer contracts with a Synapta-style usage example that maps its own schema to `ArtifactValidation`.

### Phase 29 — Workspace and global package discovery (skills, tools, context, instruction injectors)

**Goal:** standard filesystem discovery for skills (and, where applicable,
tools, context providers, and instruction injectors) so that anything available
at `<workspace>/.agent/skills/<name>/` and `~/.prism/agent/skills/<name>/` is
loadable as a contribution, with first-party and third-party packages equally
discoverable. Provider discovery stays config/package-driven (needs
credentials); Phase 24's resolver handles provider wiring.

Deliver:
- Host/CLI filesystem contribution loader (Node, optional) scanning:
  - `<workspace>/.agent/skills/<name>/`
  - `~/.prism/agent/skills/<name>/`
  - and the analogous `.agent/tools/`, `.agent/context/`, `.agent/instructions/`, `.agent/agents/` (workspace) and `~/.prism/agent/{skills,tools,context,instructions,agents}/` (global) when those kinds are requested. Credentials-bearing providers are loaded as packages, not file-scanned.
- Each discovered skill loads its `SKILL.md` (name, description, instructions, optional `context`, `toolNames`) into the `skills` contribution registry; tools/context/instructions/agents analogously register into their registries. Agent bundles load `AGENT.md` (see Phase 33) including any colocated `skills/<name>/SKILL.md` and `tools/<name>` into an agent-scoped registry so a file-declared agent carries its own deps as a unit.
- Merge order: global first, workspace overrides same-name (or vice versa, documented and tested), explicit `AgentConfig` / `RunOptions` selections override discovered contributions (progressive disclosure preserved).
- Discovery is opt-in and loader-driven: SDK apps can skip it entirely and pass explicit registries; the CLI uses it. No hidden global state in core.
- First-party skills ship as installable packages (`@arnilo/prism-skill-*`), not bundled in core; discovered like any third-party skill. First-party tools (future) ship as `@arnilo/prism-tool-*` packages the same way. Hosts choose which discovered contributions to activate.

Acceptance:
- A workspace skill at `.agent/skills/my-skill/SKILL.md` is loadable, selectable via `activeSkills: ["my-skill"]`, and its `toolNames`/`context` honored.
- A global skill at `~/.prism/agent/skills/global-skill/SKILL.md` is loadable; workspace same-name overrides or merges per documented rule.
- Discovered skills are inert until the host/selecting run activates them; discovery registers contributions, it does not auto-activate.
- No filesystem access happens without the explicit host/CLI loader; in-memory SDK use is unaffected.
- Docs: `/docs/contribution-discovery.md` (new) with workspace/global layout, merge order, trust model, and CLI flags.

### Phase 30 — Package context and instruction injection

**Goal:** a package can modify how context is formulated — inject its own
instructions to modify agent behavior on the first turn, on every turn, or in
response to user input — without forking the input/prompt pipeline and without
hidden globals.

Deliver:
- Instruction injection contract (Prism-native): `InstructionInjector { name; apply(ctx: InstructionContext): InstructionContribution }` where `InstructionContribution { instructions?: string; contextBlocks?: readonly ContextBlock[]; when: "first_turn" | "every_turn" | "on_input"; predicate?: (ctx) => boolean }`.
- Injectors register via `ExtensionAPI.registerInstructionInjector(...)` and are otherwise inert until the host selects them on `AgentConfig.instructions?: readonly InstructionInjector[] | SystemPromptConfig` (extend the existing `instructions` surface) or `RunOptions.instructions`.
- The default input/prompt assembler runs selected injectors at the documented stage (after host `AgentConfig.context`, before skill contributions; `first_turn` runs only on turn 1, `every_turn` on all, `on_input` when the input predicate matches).
- An injector may also produce `ContextBlock[]` (e.g. project schema, env state) — routed through the existing `resolveContextProviders` merge, not a parallel pipeline.
- No injector can grant tool access, activate skills, or bypass permissions; it only adds text/context.

Acceptance:
- A package registers an injector that prepends "Always answer in JSON" on every turn, visible in the assembled provider request.
- A `first_turn` injector adds project context only on turn 1.
- Injectors cannot bypass `toolNames` enforcement or permission policies.
- Docs: `/docs/instruction-injection.md` (new) plus `docs/extensions.md` cross-reference; `docs/index.md` entry.

### Phase 31 — System and project prompts (AGENTS.md and SYSTEM.md)

**Goal:** implement system/project prompt capabilities with a documented
standard layout: `AGENTS.md` at the project root is the project prompt and
`~/.prism/agent/SYSTEM.md` is the user/global system prompt, layered into the
existing `SystemPromptContribution` system rather than a parallel mechanism.

Deliver:
- Project prompt: `<workspace>/AGENTS.md` → a `SystemPromptContribution` with `source: "app"` (project-scoped), loaded by the host/CLI filesystem loader. Loaded only with explicit trust (existing trust model from Phase 10/16).
- System prompt: `~/.prism/agent/SYSTEM.md` → a `SystemPromptContribution` with `source: "user"` (global), same loader.
- Layering order (matches the existing `SystemPromptSource` + merge/replace modes): user global (`SYSTEM.md`) → package contributions → app/project (`AGENTS.md`) → host `AgentConfig.systemPrompt` → `RunOptions.systemPrompt`. `AgentConfig.instructions` remains the simple direct base path; `RunOptions.systemPrompt: false` disables layers for that run as today.
- Standalone SDK use with no filesystem loads nothing; `AgentConfig.instructions` / `systemPrompt` work unchanged.
- Walk-up discoverability: the CLI loads `AGENTS.md` and `~/.prism/agent/SYSTEM.md` automatically when present and trusted; explicit flags override/disable each layer.
- No prompt content is ever stored in events/store beyond what `AgentConfig.instructions`/`systemPrompt` already emits; secret redaction unchanged.

Acceptance:
- A workspace with `AGENTS.md` (project) and a user with `~/.prism/agent/SYSTEM.md` (system) both contribute to the composed prompt in the documented order; disabling a layer via flag removes only it.
- Removing both files reverts to `AgentConfig.instructions` only — no hidden prompt.
- Trust model: untrusted workspace `AGENTS.md` is not loaded unless the user opts in (reuse Phase 10/16 trust).
- Docs: `/docs/system-prompts.md` updated with `AGENTS.md`/`SYSTEM.md` layout, layering order, trust, and CLI flags; `docs/index.md` entry.

### Phase 32 — Synapta-facing integration example and boundary lock

**Goal:** prove end-to-end that Synapta (or any third party) can use Prism with
its own providers/tools/skills + optional first-party ones, opt a run into the
generate-validate-revise loop with its own schema validator, observe
artifact/refinement events, and that no Synapta workflow types appear anywhere
in `src/`. This phase ships no new core surface; it exercises the seams.

Deliver:
- A compile-checked example (`examples/synapta-style-artifact-loop.ts`) that: builds a provider resolver mixing a first-party package and a third-party mock provider; registers a third-party tool + a first-party tool (mocked), selects a discovered skill; composes a system prompt from `AGENTS.md` + `SYSTEM.md`; runs `session.run(input, { loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 } })` with a Synapta-style schema mapped to `ArtifactValidation`; asserts artifact events stream and no Synapta types are imported.
- Boundary test hardened: grep/assert `src/**/*.ts` imports no `synapta*`; artifact contract field names contain no `workflow`/`node`/`step`; `ToolValidator`/`ArtifactValidator` are `(value, ctx)`-shaped, not domain-typed.
- `/docs/structured-output.md` example showing a third-party schema mapped to `ArtifactValidation` end to end.

Acceptance:
- Example compiles and runs network-free with the mock provider.
- All artifact events fire in order; `artifact_finished` carries `result.ok === true`.
- Boundary tests fail if any Synapta-domain type or import is introduced into `src/`.
- No new core exports required beyond what Phases 24–31 added.

### Phase 33 — Agent definitions: declarative requirements and resolver

**Goal:** let a third party ship an agent as a unit with declaratively referenced
tools, skills, context providers, model, system prompt, and loop, mixing
first-party and own dependencies by name — without hand-assembling `AgentConfig`
inside an imperative `create()` that re-implements registry lookup. Mirrors the
Prism pattern (declarative config + replaceable strategy; default + escape
hatch).

Deliver:
- Extend `AgentDefinition` (`src/contracts.ts`) with declarative requirement fields, all name-referenced so dependencies resolve from in-scope registries:
  - `model?: ModelConfig | string` — direct config or id resolved from `registries.models`.
  - `tools?: readonly string[]` — tool names to activate from the active tool registry / `registries.tools`.
  - `skills?: readonly string[]` — skill names, resolved through `resolveActiveSkills()` (Phase 26 gives free `toolNames` enforcement).
  - `context?: readonly string[]` — context provider names from `registries.contextProviders`.
  - `systemPrompt?: SystemPromptConfig`.
  - `instructions?: string`.
  - `loop?: AgentLoopStrategy | AgentLoopOptions` (Phase 27).
  - `create?(config?: AgentConfig): Promise<Agent> | Agent` becomes **optional**. When present, it overrides declarative resolution (escape hatch for agents needing custom logic: dynamic model pick, settings-driven tools, credential-gated setup).
- `resolveAgentDefinition(def, context)` generic helper (new, reuses existing seams):
  ```ts
  export interface AgentDefinitionResolutionContext {
    readonly registries?: ContributionRegistries; // tools, skills, models, contextProviders
    readonly providerSource?: ProviderResolver;   // Phase 24
    readonly tools?: ToolRegistry | readonly ToolDefinition[]; // host active tool superset/filter
    readonly skillsRegistry?: SkillRegistry;
    readonly overrides?: Partial<AgentConfig>;    // host/run overrides win
  }
  export function resolveAgentDefinition(def, context): Promise<Agent> | Agent
  ```
  Algorithm:
  1. If `def.create` exists → call it, merge `overrides`. Escape hatch.
  2. Else build declaratively: model (direct or from `registries.models`), provider via `providerSource(model)` (Phase 24), tools resolved by name against active registry / `registries.tools` (**fail closed on missing name**, mirrors skill `toolNames`), skills via `resolveActiveSkills({registry, names, tools})` (Phase 26), context providers from `registries.contextProviders`. Compose `AgentConfig`, merge `overrides`, `createAgent(config)`.
- Two equal delivery vehicles, same contract:
  - **Code package (Extension):** third-party `setup()` calls `api.registerTool()`/`registerSkill()` for own deps, then `api.registerAgent({name, tools:[...], skills:[...]})`. Names reference own + first-party contributions in the same registries.
  - **Filesystem bundle (`AGENT.md`):** discovered under `.agent/agents/<name>/` (Phase 29). `AGENT.md` frontmatter maps 1:1 to declarative `AgentDefinition` fields; colocated `skills/<name>/SKILL.md` and `tools/<name>` register into an agent-scoped registry, so a file-declared agent carries its own deps as a unit. Default `create()` for `AGENT.md` reads the file, registers colocated deps into a transient scoped registry, and delegates to `resolveAgentDefinition`. Resolution scope: (global + workspace discovered) ∪ (colocated) ∪ (first-party package registries).
- Composition and scope rules:
  - Names resolve against all in-scope registries: first-party packages + workspace discovery + global discovery + own extension.
  - Host controls scope by which registries it passes to `context.registries` — the "inert until host selects" principle is preserved; declaring `tools: ["read-file"]` does not force activation, host `overrides`/active tool superset is final.
  - Recommend package-qualified names (`@arnilo/read-file`, `synapta/validate`); resolver uses documented first-match order (global → workspace → extension → first-party), overridable. Mark merge order as `ponytail:` comment (per-namespace registry later if collisions bite).
  - Host always has final say: `overrides` can drop a tool, swap model, disable a skill.
  - No privilege grant: an agent declaration cannot grant permissions or bypass `toolNames`; Phase 26 enforcement still runs at activation, Phase 25 validator still runs at dispatch.
  - Mixed sourcing is the point: `tools: ["read-file", "synapta/validate", "my-grep"]` mixes first-party + third-party + own in one declaration; the declarative name list is what makes it possible.

Acceptance:
- A code-package agent and an `AGENT.md` agent both resolve through the same `resolveAgentDefinition` and produce equal runtime behavior.
- Declaring `tools: ["missing"]` with no in-scope tool of that name fails closed at resolution, before any provider turn.
- Declared skills honor `toolNames` enforcement (Phase 26) — agent-skill demanding an inactive tool fails fast.
- `overrides` drops a tool or swaps a model as final authority.
- No new architecture: `AgentDefinition`, `createAgent`, the contribution registries, Phase 24 resolver, Phase 26 `resolveActiveSkills`, and Phase 29 discovery are all reused; the only additions are the declaration fields and the resolver helper.
- Docs: `/docs/agent-definitions.md` (new) with both delivery vehicles, declarative fields, resolution scope/merge rules, and a mixed first-party + third-party example; `/docs/contribution-registries.md` agent section updated; `docs/index.md` entry.

## Defer until after this track

- Built-in app/tool packs. Ship them as separate packages only.
- MCP bridge. Build as an external extension package after extension APIs settle.
- Full TUI. Optional separate package if CLI/RPC is not enough.
- Additional loop strategies (plan-authoring, multi-agent, graph orchestration). Add as new `AgentLoopStrategy` implementations once a real consumer needs them; the generic loop contract is the only seam.
- Additional first-party provider adapters beyond OpenAI, OpenCode Go, OpenRouter, ZAI, and Kimi unless users ask.
- Encrypted/keychain credential storage. Keep persistent secret UX host-owned until a real app needs it.
