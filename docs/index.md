# Prism Docs

Prism is a TypeScript/Node.js agent harness. Host apps and extension packages own providers, tools, resources, credentials, storage, UI, and business behavior. Prism supplies contracts, registries, streaming events, and replaceable runtime primitives.

## Public contracts
- [Public contracts](public-contracts.md): type shapes for messages, content, agents, sessions, providers, tools, context, skills, extensions, stores, resources, settings, credentials, and events.

## Agent/session runtime
- [Agent/session runtime](agent-session-runtime.md): create agents and sessions, run prompts, subscribe to normalized events, and see which `AgentConfig` fields are runtime-consumed vs host-owned metadata. Covers tool-call loop transcript shape and prior-reasoning preservation across turns.
- [Agent definitions](agent-definitions.md): resolve declarative `AgentDefinition` values via `resolveAgentDefinition`, and turn app-config `<configRoot>/agents/<name>/AGENT.md` bundles into runnable agents via `discoverAgentBundles` / `resolveAgentBundle` (explicit tool/skill activation by name, fail-closed omitted capabilities, migration-only `activateAllCapabilities`, strict duplicate scope checks, configurable prompt layers, no auto-discovery).
- [Agent loops](agent-loops.md): replaceable per-run control loops — `singleShotLoop` default and `generate-validate-revise` with host-supplied `validator`/`parser`/`repairer` callbacks.
- [Agent events](agent-events.md): the `AgentEvent` stream — agent/turn/message (including live `tool_call_delta` fragments), tool execution, queue/subscriber overflow, compaction/retry, artifact validation/refinement, and error variants, redacted via `redactAgentEvent`.
- [Runs and usage ledger](runs-and-usage.md): `RunLedger` adapter for durable run, event, tool-call, usage persistence, cache diagnostics, ownership/idempotency, and redaction guidance.
- [Performance limits](performance.md): bounded live subscriber queues, branch-read pagination expectations, JSONL/dev-store limits, and production sizing assumptions.
- [Structured output](structured-output.md): the `Artifact*` seam (parser/validator/repairer, host-defined `T`) — the only typed-output path from a loop, with a Synapta-style schema→`ArtifactValidation` mapping example and an end-to-end third-party integration walkthrough.

## Compaction/session memory
- [Compaction and retry policies](compaction-and-retry.md): summarize branch history and retry transient provider failures with host-replaceable policies.
- [LLM compaction package](compaction-llm.md): optional provider-backed compaction strategy package with max-output budgets mapped through `model.parameters.maxTokens` to provider wire fields.
- [Observational memory compaction package](compaction-observational-memory.md): optional source-backed memory, owned runtime append callback, provider-valid worker transcripts, fast compaction, recall tool, and status/view command package.
- [Session stores](session-stores.md): `SessionStore` contract, `SessionAppendOptions`, `SessionAppendConflictError`, branch handles, `readBranchPath`, and dev-vs-production branch reads — start here for session persistence.
- [Session stores and branching](session-stores-and-branching.md): detailed branch semantics and helper reference (kept for compatibility; links back to the canonical atomic append / branch-handle sections).
- [Database persistence](database-persistence.md): production persistence contracts, conditional append transaction pattern, idempotency indexes, `readBranchPath`, reference relational schema, retention, migrations, and NoSQL mapping.
- [Migration guide](migration.md): the two cross-cutting app migrations in one place — in-memory/JSONL → database-backed `ProductionPersistenceStore` persistence (+ `RunLedger`) and permissive capability defaults → Phase 38 explicit `tools`/`skills` activation, with before/after shapes and links to the detailed pages.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL file adapter for single-process Node hosts; no cross-process safety.

## Provider and model connection
- [Provider layer](provider-layer.md): register and resolve host-owned providers/models, choose replace-or-error duplicate policy, create provider events, stream/reconstruct tool-call deltas, use generic provider request options, and test with the mock provider; deprecated provider-level timeout/retry hints point to runtime abort/retry.
- [Model registry](model-registry.md): register and resolve `ModelConfig` records with capabilities, limits, cost, cache support metadata, compat data, and duplicate policy.
- [Provider caching](provider-caching.md): use `PromptCacheHints`, `PromptCacheBreakpoint`, `ModelCacheCapabilities`, cache-aware stable-prefix guidance, and shared cache diagnostics helpers; includes a per-provider explicit/implicit cache matrix for OpenAI, OpenRouter, OpenCode Go, Z.AI, Kimi, and NeuralWatt; cache hints are best-effort and cache keys are never secrets.
- [Provider request policies](provider-request-policies.md): chain `ProviderRequestPolicy` hooks, use `createSessionCachePolicy`, and merge legacy/structured cache options safely.
- [Provider packages](provider-packages.md): define explicit provider packages, model metadata, auth descriptors, request/cache policies, and provider-owned header precedence without package discovery or provider-specific core behavior; includes a first-party cache behavior summary.
  - Phase 12 package workspaces: [`@arnilo/prism-provider-openai`](providers/openai.md), [`@arnilo/prism-provider-opencode-go`](providers/opencode-go.md), [`@arnilo/prism-provider-openrouter`](providers/openrouter.md), [`@arnilo/prism-provider-zai`](providers/zai.md), [`@arnilo/prism-provider-kimi`](providers/kimi.md), and [`@arnilo/prism-provider-neuralwatt`](providers/neuralwatt.md) with implicit vLLM prefix caching, reasoning controls (`reasoning_effort`/`thinking_token_budget`/`enable_thinking`/`preserve_thinking`/`clear_thinking`), reasoning preservation, OpenAI-style tool-call loop, quota, telemetry, and retry classification helpers.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider subpath using native or injected `fetch` for Chat Completions streaming.

## Input, prompt, and context assembly
- [SDK customization guide](customization.md): map provider resolution, middleware, context, builders, injectors, loops, compaction, retry, stores, and skills to explicit host-wired APIs.
- [Input and prompt assembly](input-and-prompt-assembly.md): render tiny prompt templates and turn common host input, history, attachments, explicit resources, summaries, and tool results into messages with replaceable builders, provider-input assembly, legacy default order, and opt-in cache-aware ordering.
- [System prompts](system-prompts.md): compose explicit user/package/app/run system prompt layers, auto-load the standard `AGENTS.md` (workspace) / `SYSTEM.md` prompt files via the Node `loadSystemPromptFiles` loader (trust-gated for `AGENTS.md`), and append `SYSTEM.md` → per-agent `AGENT.md` body → repo `AGENTS.md` layers from a discovered agent bundle via `resolveAgentBundle`.
- [Instruction injection](instruction-injection.md): register package injectors that layer redacted instructions/context blocks without granting tools, permissions, or resource escapes.
- [Context and skills](context-and-skills.md): resolve ordered context providers and keep context/skill selection host-owned; omitted declarative skills stay inactive by default, `toolNames` fail closed before provider turns, and strict skill registries prevent silent shadowing.

## Tools
- [Tools](tools.md): register host-owned active tools with replace-or-error duplicate policy, apply exact allow/deny filtering, and dispatch tool calls.

## Extensions/plugins
- [Contribution discovery (workspace)](contribution-discovery.md): opt-in, realpath-contained directory scanner turning `SKILL.md`/`manifest.json` into inert `DiscoveredContribution` envelopes the host registers — no `import()`, no auto-activate, no provider scanning. (Per-agent `AGENT.md` bundles live under an app-controlled `configRoot`; see [Agent definitions](agent-definitions.md).)
- [Contribution registries](contribution-registries.md): explicit host-owned registries for extension/package contributions without hidden globals, with `duplicate: "error"` strict mode for provider/model/tool/skill shadowing prevention.
- [Extension kernel and event bus](extensions.md): load host-provided extensions in order, register contributions, emit lifecycle events, and isolate extension errors.
- [Extension authoring guide](extension-authoring.md): publish third-party extension packages that register inert contributions and show host-owned activation, trust, permissions, redaction, and no-sandbox boundaries.
- [Middleware hooks](middleware-hooks.md): ordered hook registry for provider, input, context, tool, retry, compaction, and session lifecycle boundaries.

## Configuration/manifests
- [Configuration and manifests](configuration-and-manifests.md): merge in-memory JSON config layers and validate data-only package manifests with prototype-pollution key rejection.
- [Node filesystem config loader](node-filesystem-config.md): explicitly read caller-named JSON config files in Node hosts.
- [Resource loading](resource-loading.md): decode text, JSON, and manifest resources through caller-provided loaders.

## CLI/RPC
- [CLI/RPC](cli-rpc.md): Run print/json modes and LF-delimited RPC over the public AgentSession runtime, including branch-handle results, fixed `forkSession`, and `checkout`.

## Security and credentials
- [Host security guide](host-security.md): fail-closed checklist for credentials, settings, redaction, trust roots, permission policies, persistence, extension loading, and tool validation.
- [Security/auth/trust](settings-auth-trust-security.md): settings providers, credential helpers, trust/permission policies, redaction controls, host-owned `AgentConfig.settings`/`credentials`, and security-boundary hardening summary.
- [Credentials and redaction](credentials-and-redaction.md): compose explicit credential resolver order, use caller-supplied env objects/OAuth refresh helpers, avoid eager `AgentConfig.credentials` resolution, and redact known secret values.

## Testing and examples
- [Provider layer](provider-layer.md): use `createMockProvider()` and provider event helpers for deterministic tests without timers, credentials, or network.
- [Provider conformance](provider-conformance.md): run network-free provider adapter assertions (stream order, abort, tool-call reconstruction, cache usage, content coverage, protected header ownership, secret leak) from `@arnilo/prism/testing/provider-conformance`.
- [Session store conformance](session-store-conformance.md): assert any `SessionStore` adapter satisfies append/idempotency/conflict/branch invariants from `@arnilo/prism/testing/session-store-conformance`.
- [Compaction conformance](compaction-conformance.md): assert any `CompactionStrategy` returns a non-empty redacted summary and observes abort from `@arnilo/prism/testing/compaction-conformance`.
- [Tool conformance](tool-conformance.md): assert the tool-dispatch blocked-reason matrix (unknown/denied/invalid/permission/validator) and success path from `@arnilo/prism/testing/tool-conformance`.
- [Extension conformance](extension-conformance.md): assert an `Extension` setup runs, contributions stay inert, and setup errors are redacted or rethrown from `@arnilo/prism/testing/extension-conformance`.
- `examples/`: compile-checked typed examples and runnable mock demos (SDK basics, provider registration, auth, tools, cache-aware prompt assembly, NeuralWatt agent run, stores/branching, compaction, observational-memory recall, structured-output/artifact-loop, CLI, RPC).

## Release and install
- [Release and install](release-and-install.md): package layout, install specifiers, required `@arnilo/prism` peer, tarball contents and exclusions, the map-retention knob, the release workflow, and the offline test budget.

