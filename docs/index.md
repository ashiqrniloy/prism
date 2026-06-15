# Prism Docs

Prism is a TypeScript/Node.js agent harness. Host apps and extension packages own providers, tools, resources, credentials, storage, UI, and business behavior. Prism supplies contracts, registries, streaming events, and replaceable runtime primitives.

## Public contracts
- [Public contracts](public-contracts.md): type-only shapes for messages, content, agents, sessions, providers, tools, context, skills, extensions, stores, resources, settings, credentials, and events.

## Provider and model connection
- [Provider layer](provider-layer.md): register and resolve host-owned providers/models, create provider events, and use the mock provider for tests.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider subpath using native or injected `fetch` for Chat Completions streaming.

## Security and credentials
- [Credentials and redaction](credentials-and-redaction.md): resolve host-owned credentials at request time and redact known secret values from strings, objects, and errors.

## Testing and examples
- [Provider layer](provider-layer.md): use `createMockProvider()` and provider event helpers for deterministic tests without timers, credentials, or network.

## Future API areas
These groups are planned but not implemented yet. Add links when their public APIs exist.

- Agent/session runtime
- Input and prompt assembly
- Tools and tool dispatch
- Context and skills runtime
- Extensions/plugins
- Configuration/manifests
- Compaction/session memory
- CLI/RPC
- Settings/auth/trust
