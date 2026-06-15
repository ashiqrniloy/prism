# prism Roadmap

Updated: 2026-06-15

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

### Phase 11 — Hardening, docs, examples, and release

**Goal:** publishable v1 with extension-developer documentation.

Deliver:
- Complete `/docs` API set linked from `/docs/index.md`.
- Typed examples for SDK, provider, model, tool, context, skill, extension, manifest, config, compaction, CLI, and RPC.
- End-to-end mock demo.
- Contract tests for public exports and JSON/RPC events.
- Golden session JSONL fixtures.
- Provider adapter tests for streaming, abort, tool calls, usage, and redaction.
- Changelog and release workflow.

Acceptance:
- Tests run under 10 seconds without network.
- Examples compile.
- `npm pack --dry-run` includes only needed files.

## Suggested implementation-plan order

Completed:
1. `001-public-contracts.md`
2. `002-provider-streaming-and-mock-provider.md`

Next:
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
14. `014-docs-examples-release.md`

## Defer until after v1

- Built-in app/tool packs. Ship them as separate packages only.
- MCP bridge. Build as an external extension package after extension APIs settle.
- Full TUI. Optional separate package if CLI/RPC is not enough.
- Workflow graph engine. Start with bounded agent loops; add graph orchestration only when real host apps need it.
- Multiple first-party provider adapters beyond OpenAI-compatible unless users ask.
