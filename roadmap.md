# prism Roadmap

Updated: 2026-06-21

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

## Defer until after v1

- Built-in app/tool packs. Ship them as separate packages only.
- MCP bridge. Build as an external extension package after extension APIs settle.
- Full TUI. Optional separate package if CLI/RPC is not enough.
- Workflow graph engine. Start with bounded agent loops; add graph orchestration only when real host apps need it.
- Additional first-party provider adapters beyond OpenAI, OpenCode Go, OpenRouter, ZAI, and Kimi unless users ask.
- Encrypted/keychain credential storage. Keep persistent secret UX host-owned until a real app needs it.
