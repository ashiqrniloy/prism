# Prism Docs

Prism is a TypeScript/Node.js agent harness. Host apps and extension packages own providers, tools, resources, credentials, storage, UI, and business behavior. Prism supplies contracts, registries, streaming events, and replaceable runtime primitives.

## Public contracts
- [Public contracts](public-contracts.md): type-only shapes for messages, content, agents, sessions, providers, tools, context, skills, extensions, stores, resources, settings, credentials, and events.

## Provider and model connection
- [Provider layer](provider-layer.md): register and resolve host-owned providers/models, create provider events, and use the mock provider for tests.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider subpath using native or injected `fetch` for Chat Completions streaming.

## Input, prompt, and context assembly
- [Input and prompt assembly](input-and-prompt-assembly.md): turn common host input, history, attachments, explicit resources, summaries, and tool results into messages with replaceable builders and provider-input assembly.
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

## Security and credentials
- [Credentials and redaction](credentials-and-redaction.md): resolve host-owned credentials at request time and redact known secret values from strings, objects, and errors.

## Testing and examples
- [Provider layer](provider-layer.md): use `createMockProvider()` and provider event helpers for deterministic tests without timers, credentials, or network.

## Future API areas
These groups are planned but not implemented yet. Add links when their public APIs exist.

- Agent/session runtime
- Compaction/session memory
- CLI/RPC
- Settings/auth/trust
