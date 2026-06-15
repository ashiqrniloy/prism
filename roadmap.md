# prism Roadmap

`prism` is a TypeScript/Node.js agent harness package. It gives host apps the structure for AI providers, agents, sessions, context, tools, skills, extensions, and CLI/RPC operation. Host apps own the actual app tools, permissions, credentials, UI, storage, and business integrations.

## Non-negotiable boundaries

- **No built-in app tools.** No shell, filesystem, browser, Synapta, desktop, or web-app tools in core. Prism only defines the tool contract, registry, filtering, dispatch, and events.
- **API first, CLI second.** The CLI must be a thin adapter over the public API, not a separate runtime.
- **Host controlled.** No hidden globals for providers, credentials, stores, resources, or permissions. Defaults may exist, but every default must be replaceable.
- **Extensible by packages/programs.** Providers, tools, context providers, skills, commands, middleware, session stores, and resource loaders must be externally pluggable.
- **Pi-inspired, not Pi-specific.** Follow pi's proven agent/session/event/resource architecture, but do not copy its coding-tool assumptions.

## Pi reference points to mirror

- One shared `AgentSession` runtime used by SDK, print mode, JSON mode, and RPC mode.
- Streaming event model: `agent_*`, `turn_*`, `message_*`, `tool_execution_*`, `queue_*`, `compaction_*`, `retry_*`.
- JSONL session persistence with `id`/`parentId` tree entries for branching, fork, clone, resume, and labels.
- Provider/model registry with normalized streaming events, usage, cost, thinking/reasoning, images, tool calls, abort, retries.
- Extension API with lifecycle hooks, event middleware, tool/provider/command registration, and resource discovery.
- Skills and prompt templates as progressive-disclosure resources.
- Context compaction and branch summarization as core harness features.
- RPC mode over strict LF-delimited JSONL for desktop/web/non-Node clients.

Do **not** mirror pi's built-in coding tools, TUI-first features, or project-specific assumptions in core.

## Phase 0 — Repository baseline

**Goal:** a tiny package skeleton that can build and test.

Deliver:
- `package.json` for ESM TypeScript package and CLI bin.
- `tsconfig.json` with strict mode.
- `src/index.ts` public barrel.
- `src/cli.ts` placeholder CLI.
- `README.md` with current scope.
- `node:test` script; no test framework dependency.

Acceptance:
- `npm run build`, `npm run typecheck`, and `npm test` run.
- No bundler, no provider SDK, no app tool dependency.

## Phase 1 — Public contracts before runtime

**Goal:** freeze the shape host apps will build against.

Deliver types for:
- Messages/content: text, image, thinking, tool call, tool result.
- `Agent`, `AgentConfig`, `AgentSession`, `AgentSessionConfig`, `RunOptions`.
- `AgentEvent` discriminated union.
- `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ModelConfig`, `Usage`.
- `ToolDefinition`, `ToolRegistry`, `ToolExecutionContext`, `ToolResult`.
- `ContextProvider`, `ContextBlock`.
- `Skill`, `SkillRegistry`.
- `Extension`, `ExtensionAPI`, lifecycle event names.
- `SessionStore`, `ResourceLoader`, `SettingsProvider`, `CredentialResolver`.

Acceptance:
- Compile-only examples prove a host can configure an agent with a provider, context provider, skill, and tool without any app-specific import.
- Public exports do not mention safe/dangerous tools or any business domain.

## Phase 2 — Provider and model layer

**Goal:** normalized provider streaming with host-owned credentials.

Deliver:
- `createProviderRegistry()` and `createModelRegistry()`.
- Credential resolver contract; providers receive resolved auth but secrets never enter history/events.
- Normalized async event stream for text, thinking, tool-call deltas, done, error, usage.
- Mock provider for tests/examples.
- Optional OpenAI-compatible adapter as a subpath export, using native `fetch`.

Acceptance:
- Unknown provider/model fails before network calls.
- AbortSignal reaches providers.
- Mock provider can stream text and tool calls.
- OpenAI-compatible adapter has mocked-fetch tests; no real network in tests.

## Phase 3 — Minimal agent/session runtime

**Goal:** one end-to-end agent run without extensions or persistence complexity.

Deliver:
- `createAgent(config)`.
- `agent.createSession(config)` and `createAgentSession(config)` convenience API.
- `session.run(input, options)` / `session.prompt(...)`.
- `session.subscribe()` as `AsyncIterable<AgentEvent>`.
- Bounded run loop: provider turn → optional tool calls → tool results → next provider turn.
- `abort()` and `maxToolRounds`.
- In-memory message history.

Acceptance:
- A mock provider can stream `Hello` to a subscriber.
- A mock provider can request one registered host tool, receive the result, and continue.
- Abort stops the current provider/tool path before the next turn.

## Phase 4 — Host-owned tool harness

**Goal:** robust tool declaration and dispatch with zero built-in tools.

Deliver:
- `createToolRegistry()` with O(1) lookup.
- Active tool allowlist/denylist per agent/session/run.
- JSON Schema-compatible `parameters` pass-through.
- Optional host validator hook before execution.
- Tool middleware events: before call, blocked call, progress update, result, error.
- Tool result threading into transcript.

Acceptance:
- Unregistered tool call emits an error and is never executed.
- Tool args must be object-shaped.
- Host can block/modify a call through middleware.
- Package exports no app tools.

## Phase 5 — Context, prompt, and skills pipeline

**Goal:** make context engineering explicit and replaceable.

Deliver:
- System prompt builder from base instructions, active tools, context blocks, enabled skills, and host metadata.
- Ordered `ContextProvider.resolve(ctx)` pipeline.
- `SkillRegistry` with explicit host registration.
- Agent Skills-style skill metadata and progressive disclosure support.
- Prompt template expansion for CLI/RPC use.

Acceptance:
- Context providers run in deterministic order.
- Skill instructions can add prompt content and restrict/request tool names, but cannot register missing tools.
- Context and skills are data/functions supplied by host or packages; core does not scan files unless a resource loader is explicitly used.

## Phase 6 — Sessions, branching, compaction

**Goal:** durable agent memory matching pi's session model.

Deliver:
- `MemorySessionStore` and async `SessionStore` interface.
- JSONL session store adapter.
- Session entries with `id`, `parentId`, timestamps, messages, model changes, labels, custom entries.
- Resume, fork, clone, branch navigation.
- Compaction entries and branch-summary entries.
- Auto-compaction on threshold/overflow and manual compaction API.

Acceptance:
- Session context can be rebuilt from the current leaf.
- Branching preserves old paths in the same session file.
- Compaction keeps recent context and records a summary without deleting raw history.
- Store receives no provider credentials.

## Phase 7 — Extension runtime

**Goal:** external packages can change behavior without forking prism.

Deliver:
- `ExtensionAPI` with: `on`, `registerTool`, `registerProvider`, `registerContextProvider`, `registerSkill`, `registerCommand`, `setActiveTools`, `sendMessage`, `appendEntry`.
- Lifecycle events: resource discovery, session start/shutdown, before agent start, turn, context, provider request/response, tool call/result, compaction, retry.
- Event bus for extension-to-extension communication.
- Resource loader contract plus filesystem loader for CLI use.
- Package manifest support for extension/skill/prompt resources.

Acceptance:
- An extension can register a provider, a tool, a context provider, and a command.
- Extension errors become events and do not crash the agent unless host policy says so.
- API users can skip filesystem/resource loading entirely.

## Phase 8 — CLI surfaces

**Goal:** usable from terminals, desktop apps, and non-Node processes.

Deliver:
- `prism -p "prompt"` print mode.
- `prism --mode json` event stream mode.
- `prism --mode rpc` strict JSONL stdin/stdout protocol.
- CLI flags for provider/model, session, extension/resource loading, tools allow/deny, system prompt, context files, auto-compaction.
- RPC commands for prompt, steer, follow-up, abort, get state/messages, set model, compact, session switch/fork/clone, get commands.

Acceptance:
- CLI modes all use the same `AgentSession` API.
- RPC clients can correlate command responses by id and receive events asynchronously.
- No full TUI in core v1; desktop/web apps should use SDK or RPC.

## Phase 9 — Settings, auth, trust, and security controls

**Goal:** safe embedding defaults without pretending to sandbox tools.

Deliver:
- Settings provider interface and optional filesystem settings loader.
- Auth storage/resolution interfaces; env/file/runtime resolvers as opt-in utilities.
- Project/resource trust model for CLI filesystem loading.
- Host permission hooks for tools and extensions.
- Secret redaction utilities for errors/events.
- Retry/backoff policy for transient provider errors.

Acceptance:
- Host can run prism fully in-memory with no filesystem writes.
- CLI does not load project-local executable resources without trust.
- Secrets are not serialized into events, prompts, compaction, or sessions.

## Phase 10 — Hardening, docs, release

**Goal:** publishable v1.

Deliver:
- API README and typed examples: SDK, provider, tool, context, skill, extension, CLI, RPC.
- End-to-end mock demo.
- Contract tests for public exports and JSON/RPC events.
- Golden session JSONL fixtures.
- Provider adapter tests for streaming, abort, tool calls, usage, redaction.
- Changelog and release workflow.

Acceptance:
- Tests run under 10 seconds without network.
- Examples compile.
- `npm pack --dry-run` includes only needed files.

## Suggested implementation-plan order

Create detailed plans in this order:

1. `001-scaffold-package-and-cli.md`
2. `002-public-contracts.md`
3. `003-provider-streaming-and-mock-provider.md`
4. `004-agent-session-run-loop.md`
5. `005-host-tool-harness.md`
6. `006-context-skills-prompts.md`
7. `007-session-store-jsonl-branching.md`
8. `008-compaction-and-retry.md`
9. `009-extension-runtime-and-resource-loader.md`
10. `010-cli-json-rpc.md`
11. `011-settings-auth-trust-security.md`
12. `012-docs-examples-release.md`

## Defer until after v1

- Built-in app/tool packs. Ship them as separate packages only.
- MCP bridge. Build as an external extension package after extension APIs settle.
- TUI. Optional separate package if CLI/RPC is not enough.
- Workflow graph engine. Start with bounded agent loops; add graph orchestration only when real host apps need it.
- Multiple first-party provider adapters beyond OpenAI-compatible unless users ask.
