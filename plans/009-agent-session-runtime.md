# Phase 6 — Minimal Agent/Session Runtime

## Objectives
- Add the smallest shared runtime for SDK, future CLI print/json, and future RPC adapters.
- Provide `createAgent(config)`, `agent.createSession(config)`, `createAgentSession(config)`, `session.run(input, options)`, `session.prompt(...)`, `session.subscribe()`, and `session.abort()`.
- Reuse provider, input/prompt/context/skill, middleware, and host-owned tool primitives instead of hard-coding agent behavior.
- Keep durable stores, branching, compaction, retries, CLI, RPC, and app tools out of Phase 6.
- Document every public runtime API and session event behavior under `/docs` as it lands.

## Expected Outcome
- Root exports include the minimal agent/session runtime helpers and any small option types required by implementation.
- A mock provider can stream `Hello` through `session.subscribe()` during `session.run()`.
- A mock provider can request one registered host tool, receive the result in the next provider turn, and continue until done.
- `abort()` and `RunOptions.signal` stop provider streaming/tool dispatch before the next turn, and `maxToolRounds` bounds tool loops.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing primitives and lock the minimal Phase 6 runtime surface
  - Acceptance Criteria:
    - Functional: Existing agent/session contracts, provider/model registries, provider events, mock provider, input assembly, prompt composer, context/skill helpers, tool dispatch, middleware hooks, contribution registries, extension APIs, docs, and Phase 6 roadmap requirements are inventoried; the task records what is reused and the smallest generic additions needed.
    - Performance: Inventory adds no runtime code, dependency, provider call, tool execution, filesystem discovery, network call, timer, watcher, retry loop, queue worker, or test slowdown.
    - Code Quality: The chosen surface rejects a CLI/RPC implementation, durable store/branching layer, compaction engine, retry framework, DI container, hidden global registries, app tools, and provider-specific prompt adapter.
    - Security: Design keeps providers/tools/resources/credentials host-owned, secrets out of runtime events/history by default, unknown providers/tools failing closed, and tool execution behind the existing host tool harness.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 6 and non-negotiable boundaries: no built-in app tools, host controlled, defaults replaceable, secrets never enter history/events, docs ship with APIs.
      - `src/contracts.ts` `AgentConfig`, `Agent`, `AgentSessionConfig`, `AgentSession`, `RunOptions`, `AgentEvent`, `ProviderRequest`, `ProviderEvent`, `ToolDefinition`, `ToolRegistry`, `ToolResult`, `InputBuilder`, `PromptBuilder`, `ContextProvider`, `SkillRegistry`, and `SessionStore`.
      - `src/input.ts` `assembleProviderInput()`, `createDefaultInputBuilder()`, `createDefaultPromptBuilder()`, and `resolveContextProviders()`.
      - `src/tools.ts` `createToolRegistry()`, `filterTools()`, and `dispatchToolCall()`.
      - `src/providers.ts`, `src/provider-events.ts`, and `src/mock-provider.ts` for provider resolution and deterministic tests.
      - `src/contributions.ts`, `src/extensions.ts`, and `src/middleware.ts` for extension-aware primitives.
      - `docs/provider-layer.md`, `docs/input-and-prompt-assembly.md`, `docs/context-and-skills.md`, `docs/tools.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/middleware-hooks.md`, `docs/public-contracts.md`, `docs/index.md`, and `docs/api-page-template.md`.
      - `package.json` scripts and `tsconfig.json` strict `NodeNext`/declaration settings.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
    - Options Considered:
      - Build a full orchestrator with stores, retries, compaction, branching, and RPC now: rejected; later phases own those surfaces.
      - Add one small `src/agents.ts` runtime module using existing primitives: preferred; it keeps the diff findable and avoids runtime duplication.
      - Add separate scheduler/event-queue/session-store packages: rejected; no demonstrated need for multiple implementations yet.
      - Execute provider `tool_call_delta` fragments directly: rejected; Phase 6 executes only complete `tool_call` events and leaves fragment reconstruction to provider adapters or a later generic helper.
    - Chosen Approach:
      - Add one runtime module, `src/agents.ts`, exporting `createAgent()` and `createAgentSession()`.
      - Reuse `assembleProviderInput()` for each provider turn and `dispatchToolCall()` for every complete tool call.
      - Use a tiny in-memory session event broadcaster implementing `AsyncIterable<AgentEvent>`; no worker, timer, replay log, or persistent queue.
      - Keep session history and tool results in memory only for the active session; `SessionStore`, branching, summaries, and compaction wait for Phase 7/8.
    - API Notes and Examples:
      ```ts
      import { createAgent, createMockProvider, providerDone, providerTextDelta } from "prism";

      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
      });
      const session = agent.createSession();
      const events = session.subscribe();
      await session.run("Hi");
      ```
    - Files to Create/Edit:
      - `plans/009-agent-session-runtime.md`: completed inventory and locked minimal surface.
      - Locked later files: `src/agents.ts`, `src/contracts.ts`, `src/index.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/docs.test.ts`, `docs/agent-session-runtime.md`, `docs/public-contracts.md`, `docs/provider-layer.md`, `docs/tools.md`, `docs/input-and-prompt-assembly.md`, `docs/middleware-hooks.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/context-and-skills.md`, `docs/credentials-and-redaction.md` if redaction behavior is documented, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 6 deliverables and acceptance.
      - `plans/008-input-prompt-context-skills-pipeline.md` closeout: Phase 6 should consume Phase 5 helpers instead of duplicating assembly, context, prompt, skill, or tool gating logic.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Inventory Result / Locked Surface:
      - Reuse as-is: `AgentConfig`, `Agent`, `AgentSessionConfig`, `AgentSession`, `RunOptions`, `AgentEvent`, `ProviderRequest`, `ProviderEvent`, `AIProvider`, `ToolRegistry`, `ToolResult`, `InputBuilder`, `PromptBuilder`, `ContextProvider`, `SkillRegistry`, and `SessionStore` contracts.
      - Reuse as-is: `assembleProviderInput()`, `createDefaultInputBuilder()`, `createDefaultPromptBuilder()`, `resolveContextProviders()`, `createToolRegistry()`, `filterTools()`, `dispatchToolCall()`, `createProviderRegistry()`, provider event helpers, `createMockProvider()`, contribution registries, extension kernel APIs, middleware registry, skill registry helpers, credential/error redaction helpers, and existing docs checks.
      - Add the smallest contract fields needed for configured strategies: optional `inputBuilder?: InputBuilder`, `promptBuilder?: PromptBuilder`, `middleware?: MiddlewareRegistry`, and `resourceLoader?: ResourceLoader` on `AgentConfig`; keep `provider` explicit and fail closed when absent.
      - Interpret `AgentConfig.skills` as the already host-selected active skill set when it is an array, or as `registry.list()` when a host passes a registry; do not add skill-selection policy in Phase 6.
      - Normalize `AgentConfig.tools` to an active `ToolRegistry` plus `registry.list()` for provider requests; do not add app tools, permission policies, schema validation, or package activation.
      - Runtime event mapping is minimal: provider `message_start`, `content_delta`, complete `tool_call`, `usage`, `done`, and `error` become `AgentEvent`s; `tool_call_delta` is not executed by the runtime and remains provider-adapter reconstruction territory unless a complete `tool_call` follows.
      - `RunOptions.model` overrides the request model only for the run; `RunOptions.metadata` merges with config/session metadata for assembly/provider/tool contexts; `RunOptions.maxToolRounds` defaults to `1`.
      - `session.prompt(input, options)` is only an alias for `session.run(input, options)`; no second prompt path.
      - `subscribe()` is live-only and in-memory; no event replay, queue API, durable event store, or cross-run scheduler.
      - `abort()` and `RunOptions.signal` use native `AbortController` bridging only; no dependency, timer, retry, or background worker.
      - Explicitly rejected for Phase 6: CLI/RPC adapters, durable stores, branching, compaction, retries/backoff, DI containers/service locators, hidden globals, provider-specific prompt adapters, built-in app tools, automatic extension loading, filesystem/config discovery, and credential resolution.
  - Test Cases to Write:
    - None for this inventory-only plan edit; no source or docs API files changed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document public APIs and runtime behavior they add.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add `createAgent()` and `createAgentSession()` with subscribe/run shell
  - Acceptance Criteria:
    - Functional: `createAgent(config)` returns an `Agent` with `config` and `createSession()`; `createAgentSession(config)` creates a standalone session; `session.subscribe()` returns an `AsyncIterable<AgentEvent>`; `session.run()` emits `agent_started`, `turn_started`, provider-derived message events, `turn_finished`, and `agent_finished` for a provider that streams text then done.
    - Performance: Runtime uses one in-memory subscriber buffer per subscriber, no timers, polling, worker, filesystem/network discovery, provider retries, or new dependency; provider events are forwarded in stream order.
    - Code Quality: Runtime reuses `assembleProviderInput()` and the configured/default builders; IDs are generated with `crypto.randomUUID()` or a tiny fallback only if needed; no CLI/RPC code or global registries are added.
    - Security: Provider comes from `AgentConfig.provider` or explicit config only; missing provider fails closed before streaming; runtime does not resolve credentials, log prompts, or serialize secrets.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` agent/session/event/provider contracts.
      - `src/input.ts` `assembleProviderInput()` options and return shape.
      - `src/mock-provider.ts` abort-aware scripted provider behavior.
      - `docs/provider-layer.md` mock provider and provider request examples.
      - `docs/input-and-prompt-assembly.md` provider-input assembly docs.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Require a provider registry in `AgentConfig`: rejected for Phase 6; the existing contract already allows `provider` directly, and registry integration can stay explicit/host-owned.
      - Emit only raw `ProviderEvent` values: rejected; public session subscribers expect `AgentEvent` values.
      - Make `run()` return the final text: rejected; existing contract returns `Promise<void>` and subscribers/events are the runtime surface.
    - Chosen Approach:
      - Implemented a small session class/object in `src/agents.ts` with local `history` and subscriber list; the later abort task owns active `AbortController` wiring.
      - Resolve the provider from `AgentConfig.provider`; throw and emit `error` if absent.
      - Convert provider `message_start`, `content_delta`, complete `tool_call`, `done`, `usage`, and `error` events to existing `AgentEvent` shapes.
      - Accumulate assistant content blocks for `message_finished` and in-memory history.
    - API Notes and Examples:
      ```ts
      const session = createAgentSession({
        agent: createAgent({ model, provider }),
      });
      const seen: AgentEvent[] = [];
      const reader = (async () => { for await (const event of session.subscribe()) seen.push(event); })();
      await session.run("Hello");
      session.abort();
      await reader;
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: added `createAgent()`, `createAgentSession()`, minimal one-turn session runtime, and live in-memory event broadcaster.
      - `src/contracts.ts`: added optional `inputBuilder`, `promptBuilder`, `middleware`, and `resourceLoader` strategy fields on `AgentConfig` for runtime assembly reuse.
      - `src/index.ts`: exported `createAgent()` and `createAgentSession()` from the root package.
      - `src/__tests__/agents.test.ts`: added text streaming, standalone session, prompt alias, and missing-provider tests.
      - `src/__tests__/public-contracts.test.ts`: added compile/runtime coverage for new root exports.
      - `docs/agent-session-runtime.md`: documented runtime APIs and one-turn event flow.
      - `docs/public-contracts.md`: linked contracts to implemented runtime helpers.
      - `docs/index.md`: moved Agent/session runtime from future API areas to active docs.
      - `src/__tests__/docs.test.ts`: added docs/export checks.
    - References:
      - `roadmap.md` Phase 6 acceptance: mock provider streams `Hello` to a subscriber.
      - `plans/008-input-prompt-context-skills-pipeline.md` Phase 5 helper decisions.
  - Test Cases to Write:
    - `agent_session_streams_mock_provider_text_to_subscriber`: validates `Hello` arrives as `message_delta` and the run finishes. Implemented in `src/__tests__/agents.test.ts`.
    - `create_agent_session_standalone_uses_agent_config`: validates both construction paths share behavior. Implemented in `src/__tests__/agents.test.ts`.
    - `session_prompt_delegates_to_run_for_string_input`: validates `prompt()` works without separate code paths. Implemented in `src/__tests__/agents.test.ts`.
    - `missing_provider_fails_closed_and_emits_error`: validates no hidden provider global exists. Implemented in `src/__tests__/agents.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds root runtime helpers and implemented session event behavior.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: create detailed API page for `createAgent()`, `createAgentSession()`, session methods, and event flow.
      - `docs/public-contracts.md`: update implemented status/examples for `Agent`, `AgentSession`, and `AgentEvent` contracts.
      - `docs/index.md`: add `Agent/session runtime - Create agents and sessions, run prompts, and subscribe to events` navigation entry.
    - `docs/index.md` update: Yes; move Agent/session runtime out of Future API areas into an active group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded tool-call loop using host-owned tools
  - Acceptance Criteria:
    - Functional: During `session.run()`, complete provider `tool_call` events are emitted, dispatched through the active `ToolRegistry`, added as tool result messages for the next provider turn, and the loop continues until provider `done` or no tool calls remain; `maxToolRounds` limits repeated tool turns.
    - Performance: Tool rounds are strictly bounded by `RunOptions.maxToolRounds` or a documented default; dispatch is sequential and deterministic; no parallel fan-out, retry, cache, timer, schema validator dependency, or tool execution outside requested calls.
    - Code Quality: Reuse `createToolRegistry()` for array tools, `dispatchToolCall()` for lookup/filter/validation/middleware/events, and `assembleProviderInput()` for the next turn; do not duplicate permission checks or JSON-object validation.
    - Security: Unregistered, denied, or malformed tool calls fail closed through `dispatchToolCall()`; skills cannot activate tools; middleware cannot add tools beyond the host-active set passed to provider requests.
  - Approach:
    - Documentation Reviewed:
      - `src/tools.ts` `dispatchToolCall()` event and failure behavior.
      - `src/contracts.ts` `ToolCallContent`, `ToolResult`, `ToolRegistry`, `RunOptions.maxToolRounds`, and tool-related `AgentEvent` variants.
      - `src/input.ts` tool result inclusion in default input assembly and `assembleProviderInput()` reapplying host tools after prompt middleware.
      - `docs/tools.md`, `docs/input-and-prompt-assembly.md`, `docs/context-and-skills.md`, and `docs/middleware-hooks.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Implement custom tool execution inside session runtime: rejected; the tool harness already owns fail-closed dispatch.
      - Run all tool calls in parallel: rejected for minimal deterministic behavior and simpler abort/event ordering.
      - Add a policy engine for max rounds and tool filters: rejected; `RunOptions.maxToolRounds` plus existing registry/filtering is enough.
    - Chosen Approach:
      - Normalized `AgentConfig.tools` into a per-run active `ToolRegistry`/tool list.
      - Collected complete `tool_call` events per provider turn, emitted assistant message events for them, dispatched each through `dispatchToolCall()`, appended returned `ToolResult`s to the next input assembly, then started the next provider turn.
      - Defaulted `maxToolRounds` to `1`, matching the inventory decision.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({ model, provider, tools: [echoTool] });
      await agent.createSession().run("Use echo", { maxToolRounds: 1 });
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: added bounded loop, tool registry normalization, and tool result handoff.
      - `src/__tests__/agents.test.ts`: added mock provider tool-round tests.
      - `docs/agent-session-runtime.md`: documented tool loop, `maxToolRounds`, and active tool boundary.
      - `docs/tools.md`: linked runtime use of `dispatchToolCall()`.
      - `docs/input-and-prompt-assembly.md`: linked tool result handoff from runtime.
      - `docs/middleware-hooks.md`: linked tool hooks used by runtime.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: no changes needed beyond prior runtime doc link/check.
    - References:
      - `roadmap.md` Phase 6 acceptance: mock provider can request one registered host tool, receive result, and continue.
      - `plans/007-host-tool-harness.md` no built-in tools and fail-closed dispatch decisions.
  - Test Cases to Write:
    - `agent_session_executes_one_registered_tool_and_continues`: validates provider sees tool result on second turn and then streams final text. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_blocks_unknown_tool_without_executing`: validates fail-closed behavior is preserved. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_stops_at_max_tool_rounds`: validates bounded loops cannot run forever. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_passes_only_host_active_tools_to_provider`: validates middleware/skills do not grant tools. Implemented in `src/__tests__/agents.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; implements session tool-call behavior and documents `maxToolRounds` semantics.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: add bounded tool loop and examples.
      - `docs/tools.md`: update related runtime dispatch notes.
      - `docs/input-and-prompt-assembly.md`: note runtime supplies tool results to the next provider turn.
      - `docs/middleware-hooks.md`: note runtime invokes tool hooks through `dispatchToolCall()`.
    - `docs/index.md` update: No new navigation entry if `docs/agent-session-runtime.md` was already added; ensure links remain valid.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add abort propagation, run exclusivity, and provider/tool error handling
  - Acceptance Criteria:
    - Functional: `session.abort(reason)` aborts the active provider/tool path; `RunOptions.signal` is combined with the session abort signal; abort prevents another provider turn; provider/tool errors emit redacted `error` events and finish the run cleanly or reject according to the documented behavior; concurrent `run()` calls fail fast.
    - Performance: Abort handling uses native `AbortController`/`AbortSignal` only, with no timers, polling, worker queue, retry/backoff, or dependency.
    - Code Quality: Error conversion reuses existing redaction helpers where needed; run state is local to the session; cleanup closes subscriber streams exactly once after run completion/abort/error.
    - Security: Known secret values from config are not emitted; error events use `ErrorInfo`; abort reasons are not used to bypass tool/provider checks.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentSession.abort()`, `RunOptions.signal`, `ProviderRequest.signal`, `ToolExecutionContext.signal`, and `AgentEvent.error`.
      - `src/mock-provider.ts` signal check behavior.
      - `src/redaction.ts` and `docs/credentials-and-redaction.md` error/redaction helpers.
      - `src/tools.ts` tool dispatch error behavior.
      - `docs/provider-layer.md`, `docs/tools.md`, and `docs/middleware-hooks.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add an abort-signal composition dependency: rejected; a tiny native helper is enough.
      - Queue concurrent runs: rejected; Phase 6 only needs one active run per session.
      - Swallow all errors: rejected; subscribers need `error` events and callers need documented failure behavior.
    - Chosen Approach:
      - Created a per-run `AbortController`, bridged `RunOptions.signal` into it, and passed the combined signal to input assembly, context providers, provider requests, and tool dispatch.
      - Guarded `run()` with a simple `activeRun` flag; concurrent calls emit/throw a clear error without queueing.
      - Emit `error` for provider/runtime failures, clear active run state, clean subscriber streams once, and keep tool exceptions on the existing `tool_execution_error`/error `ToolResult` path; no retry/backoff added.
    - API Notes and Examples:
      ```ts
      const controller = new AbortController();
      const run = session.run("Stop soon", { signal: controller.signal });
      controller.abort(new Error("cancelled"));
      await run.catch(() => undefined);
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: added abort bridge, run guard, error conversion/cleanup.
      - `src/__tests__/agents.test.ts`: added abort, external signal, provider error, tool error, and concurrent run tests.
      - `docs/agent-session-runtime.md`: documented abort/error/run concurrency behavior.
      - `docs/provider-layer.md`: linked provider abort/error behavior from runtime docs.
      - `docs/credentials-and-redaction.md`: no change; runtime reused existing error conversion without new redaction surface.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: no changes needed beyond existing runtime doc coverage.
    - References:
      - `roadmap.md` Phase 6 acceptance: abort stops current provider/tool path before next turn.
      - `plans/002-provider-streaming-and-mock-provider.md` abort propagation follow-up.
  - Test Cases to Write:
    - `agent_session_abort_stops_before_next_provider_turn`: validates aborted tool/provider loop does not continue. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_run_options_signal_aborts_provider_request`: validates external signal propagation. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_rejects_concurrent_runs`: validates no hidden queue/scheduler. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_emits_error_for_provider_error`: validates subscriber-visible failure. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_tool_errors_emit_tool_error_events_and_continue`: validates tool exceptions use `tool_execution_error` plus error `ToolResult`. Implemented in `src/__tests__/agents.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; implements and documents `abort()`, `RunOptions.signal`, error events, and concurrent run behavior.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: add abort/error/concurrency sections and examples.
      - `docs/provider-layer.md`: update related APIs if provider abort guidance changes.
      - `docs/credentials-and-redaction.md`: update only if runtime exposes new redaction guidance.
    - `docs/index.md` update: No new navigation entry if runtime docs are already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Wire extension/configured strategies without hidden globals
  - Acceptance Criteria:
    - Functional: Runtime uses configured input builder, prompt builder, context providers, skills, middleware, model override, metadata, and active tools when supplied; externally registered `AgentDefinition` values can create agents that use the same session runtime; no extension or contribution is activated unless host code passes it in.
    - Performance: Strategy lookup is in-memory and per-run/session only; no package loading, filesystem discovery, network discovery, model registry scan, or dependency is added.
    - Code Quality: Reuse existing contribution registries and extension API types; avoid adding mode-specific Rust/CLI/RPC logic, a service locator, or a second registry layer.
    - Security: Host remains in control of selected providers/tools/context/skills/resources/credentials; runtime does not read settings or credentials automatically, and secrets are not copied into events or session messages by Prism.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentConfig.extensions`, `AgentDefinition`, `ExtensionAPI.registerAgent()`, `InputBuilder`, `PromptBuilder`, `ContextProvider`, and `SkillRegistry`.
      - `src/contributions.ts` agent/input/prompt/context/skill/tool contribution registries.
      - `src/extensions.ts` extension loading and inert contribution behavior.
      - `src/input.ts` configured builder/provider options.
      - `src/skills.ts` active skill resolution behavior.
      - `docs/extensions.md`, `docs/contribution-registries.md`, `docs/context-and-skills.md`, and `docs/input-and-prompt-assembly.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Auto-load `AgentConfig.extensions` inside `createAgent()`: rejected unless inventory proves existing API requires it; hidden activation makes host control murky.
      - Add a new runtime registry object: rejected; existing contribution registries already store external agent definitions.
      - Let model override resolve providers by global registry: rejected; hosts must pass a provider or explicit lookup result.
    - Chosen Approach:
      - Kept `createAgent()` as a thin wrapper over explicit config; no extension loading, registry lookup, settings read, credential resolution, or filesystem/package discovery was added.
      - Documented that external packages register `AgentDefinition` through existing contribution registries; their `create()` can return a custom agent or call `createAgent()`.
      - Verified configured/default builders, context providers, selected skills, active tools, middleware, metadata, and `RunOptions.model` flow into `assembleProviderInput()` for each turn.
    - API Notes and Examples:
      ```ts
      contributions.agents.register("demo", {
        name: "demo",
        create: () => createAgent({ model, provider, context: [ctx], tools: [tool] }),
      });
      const agent = await contributions.agents.resolve("demo").create();
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: no source change needed; prior runtime plumbing already passed explicit config into assembly and provider requests.
      - `src/__tests__/agents.test.ts`: added configured strategy, external agent definition, and model override tests.
      - `src/__tests__/public-contracts.test.ts`: added compile coverage for `AgentDefinition` using `createAgent()`.
      - `docs/agent-session-runtime.md`: added strategy and external-agent registration examples.
      - `docs/extensions.md`: linked agent contribution usage to runtime helper.
      - `docs/contribution-registries.md`: documented agent definitions can call `createAgent()`.
      - `docs/input-and-prompt-assembly.md` and `docs/context-and-skills.md`: linked runtime usage of explicit configured strategies.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: no changes needed beyond existing runtime doc coverage.
    - References:
      - `roadmap.md` Phase 6 acceptance: runtime uses extension/configured strategies rather than hard-coded prompt/context/compaction behavior.
      - `plans/005-extension-kernel-and-contribution-registries.md` extension/contribution decisions.
      - `plans/008-input-prompt-context-skills-pipeline.md` replaceable builder/context/skill decisions.
  - Test Cases to Write:
    - `agent_session_uses_configured_input_and_prompt_builders`: validates strategy replacement. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_uses_context_providers_and_selected_skills`: validates configured context/skill path. Implemented in `src/__tests__/agents.test.ts`.
    - `external_agent_definition_can_create_runtime_agent`: validates contribution-registered agents can reuse `createAgent()`. Implemented in `src/__tests__/agents.test.ts`.
    - `run_model_override_changes_provider_request_model`: validates `RunOptions.model` flows into provider request without global lookup. Implemented in `src/__tests__/agents.test.ts`.
    - `host_can_create_minimal_phase_6_agent_sessions`: validates public `AgentDefinition` compile coverage with `createAgent()`. Updated in `src/__tests__/public-contracts.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; documents how runtime consumes configured strategies and external agent definitions.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: add configured strategy and external-agent registration sections.
      - `docs/extensions.md`: add related runtime usage for `ExtensionAPI.registerAgent()`.
      - `docs/contribution-registries.md`: add related runtime usage for agent definitions.
      - `docs/input-and-prompt-assembly.md`: update related runtime API links if needed.
      - `docs/context-and-skills.md`: update related runtime API links if needed.
    - `docs/index.md` update: No new navigation entry if runtime docs are already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification and runtime wiki consistency
  - Acceptance Criteria:
    - Functional: All Phase 6 acceptance scenarios pass; public root exports compile; docs link every new public runtime API, event behavior, and strategy boundary.
    - Performance: Full test suite remains under the roadmap target of 10 seconds locally, uses no network, and adds no dependency or long-running timer.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; tests cover the minimal runtime without fixtures/frameworks beyond `node:test`.
    - Security: Docs and tests confirm no built-in app tools, no hidden provider/tool globals, no automatic credential resolution, and fail-closed provider/tool behavior.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md` for required page structure.
      - `docs/index.md` navigation groups and Future API areas.
      - `docs/agent-session-runtime.md` once created.
      - `src/__tests__/docs.test.ts` documentation checks.
      - `package.json` `build`, `typecheck`, and `test` scripts.
    - Options Considered:
      - Add a docs generator: rejected; existing lightweight docs tests are enough.
      - Add end-to-end CLI/RPC tests: rejected; CLI/RPC is Phase 9.
      - Add broad store/branching fixtures: rejected; stores and branching are Phase 7.
    - Chosen Approach:
      - Ran the existing validation commands; existing docs checks covered runtime page/index links, documented exports, page headings, and secret-looking examples.
      - Reviewed public exports and examples through the docs/public-contract tests; `docs/agent-session-runtime.md` uses implemented APIs only.
      - Filled `Compromises Made` and `Further Actions` after implementation and tests passed.
    - API Notes and Examples:
      ```sh
      npm run build && npm run typecheck && command npm test
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: no change needed; existing checks already cover runtime docs/index links and documented exports.
      - `docs/agent-session-runtime.md`: no final correction needed during verification.
      - `docs/index.md`: no final correction needed during verification.
      - `plans/009-agent-session-runtime.md`: marked final verification complete and filled closeout sections.
    - References:
      - `roadmap.md` Phase 6 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: validates emitted JS/types and package exports. Passed.
    - `npm run typecheck`: validates strict TypeScript types. Passed.
    - `command npm test`: validates runtime tests and docs checks. Passed with 133 tests, 27 suites, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new API by verification alone; it validates docs for APIs added by earlier tasks.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: update only if verification finds missing/incorrect runtime documentation.
      - `docs/index.md`: update only if navigation is missing or stale.
    - `docs/index.md` update: No unless verification finds navigation missing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Kept Phase 6 intentionally in-memory and live-only: no durable store, replay, branching, compaction, queueing, retries, CLI/RPC adapter, hidden registry, extension auto-loading, settings read, or credential resolution.
- `maxToolRounds` defaults to `1`; hosts can opt into more rounds per run, but Phase 6 does not add policy engines or schedulers.
- Provider `tool_call_delta` fragments remain adapter responsibility; the runtime executes only complete `tool_call` events.

## Further Actions
- Phase 7/8 can add durable session storage, branching, compaction, and replay if product flows require them.
- Phase 9 can layer CLI/RPC adapters over this runtime without changing the core session loop.
- Add provider-specific adapters or extension packages outside this core, keeping host-selected providers/tools/credentials explicit.
