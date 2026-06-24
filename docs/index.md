# Prism Docs

Prism is a TypeScript/Node.js agent harness. Host apps and extension packages own providers, tools, resources, credentials, storage, UI, and business behavior. Prism supplies contracts, registries, streaming events, and replaceable runtime primitives.

## Public contracts
- [Public contracts](public-contracts.md): type shapes for messages, content, agents, sessions, providers, tools, context, skills, extensions, stores, resources, settings, credentials, and events.

## Agent/session runtime
- [Agent/session runtime](agent-session-runtime.md): create agents and sessions, run prompts, and subscribe to normalized session events.

## Compaction/session memory
- [Compaction and retry policies](compaction-and-retry.md): summarize branch history and retry transient provider failures with host-replaceable policies.
- [LLM compaction package](compaction-llm.md): optional provider-backed compaction strategy package.
- [Observational memory compaction package](compaction-observational-memory.md): optional source-backed memory, fast compaction, recall tool, and status/view command package.
- [Session stores and branching](session-stores-and-branching.md): store session entries, rebuild branch context, and navigate branch leaves.
- [Node JSONL session store](node-jsonl-session-store.md): persist session entries to caller-named JSONL files in Node hosts.

## Provider and model connection
- [Provider layer](provider-layer.md): register and resolve host-owned providers/models, create provider events, use generic provider request options, and test with the mock provider.
- [Provider packages](provider-packages.md): define explicit provider packages, model metadata, auth descriptors, and request/cache policies without package discovery or provider-specific core behavior.
  - Phase 12 package workspaces: [`@arnilo/prism-provider-openai`](providers/openai.md), [`@arnilo/prism-provider-opencode-go`](providers/opencode-go.md), [`@arnilo/prism-provider-openrouter`](providers/openrouter.md), [`@arnilo/prism-provider-zai`](providers/zai.md), and [`@arnilo/prism-provider-kimi`](providers/kimi.md).
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider subpath using native or injected `fetch` for Chat Completions streaming.

## Input, prompt, and context assembly
- [Input and prompt assembly](input-and-prompt-assembly.md): render tiny prompt templates and turn common host input, history, attachments, explicit resources, summaries, and tool results into messages with replaceable builders and provider-input assembly.
- [System prompts](system-prompts.md): compose explicit package/app/user/run system prompt layers without filesystem discovery or hidden globals.
- [Context and skills](context-and-skills.md): resolve ordered context providers and keep context/skill selection host-owned.

## Tools
- [Tools](tools.md): register host-owned active tools, apply exact allow/deny filtering, and dispatch tool calls.

## Extensions/plugins
- [Contribution registries](contribution-registries.md): explicit host-owned registries for extension/package contributions without hidden globals.
- [Extension kernel and event bus](extensions.md): load host-provided extensions in order, register contributions, emit lifecycle events, and isolate extension errors.
- [Middleware hooks](middleware-hooks.md): ordered hook registry for provider, input, context, tool, retry, compaction, and session lifecycle boundaries.

## Configuration/manifests
- [Configuration and manifests](configuration-and-manifests.md): merge in-memory JSON config layers and validate data-only package manifests.
- [Node filesystem config loader](node-filesystem-config.md): explicitly read caller-named JSON config files in Node hosts.
- [Resource loading](resource-loading.md): decode text, JSON, and manifest resources through caller-provided loaders.

## CLI/RPC
- [CLI/RPC](cli-rpc.md): Run print/json modes and LF-delimited RPC over the public AgentSession runtime.

## Security and credentials
- [Security/auth/trust](settings-auth-trust-security.md): settings providers, credential helpers, trust/permission policies, and redaction controls.
- [Credentials and redaction](credentials-and-redaction.md): compose explicit credential resolver order, use caller-supplied env objects/OAuth refresh helpers, and redact known secret values.

## Testing and examples
- [Provider layer](provider-layer.md): use `createMockProvider()` and provider event helpers for deterministic tests without timers, credentials, or network.
- [Provider conformance](provider-conformance.md): run network-free provider adapter assertions from `@arnilo/prism/testing/provider-conformance`.
- `examples/`: compile-checked typed examples and runnable mock demos (SDK basics, provider registration, auth, tools, stores/branching, compaction, observational-memory recall, CLI, RPC).

## Release and install
- [Release and install](release-and-install.md): package layout, install specifiers, required `@arnilo/prism` peer, tarball contents and exclusions, the map-retention knob, the release workflow, and the offline test budget.

