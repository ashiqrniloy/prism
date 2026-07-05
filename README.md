# prism

`prism` is a TypeScript/Node.js agent harness. Host apps and extension packages
bring their tools, providers, credentials, storage, and UI; Prism supplies the
common contracts, registries, agent/session runtime, replaceable input/prompt
and compaction strategies, CLI/RPC adapters, and first-party provider/compaction
packages. Prism defines contracts, not apps.

## Current scope

- **Agent/session runtime**: `createAgent`/`createAgentSession`, run prompts,
  dispatch host tools, subscribe to normalized `AgentEvent` streams, abort runs,
  compact, and navigate branches.
- **Providers and models**: provider/model registries, provider event helpers,
  credential redaction helpers, mock provider, and an optional
  OpenAI-compatible provider subpath. Cache support is provider-specific:
  OpenAI/OpenRouter use best-effort explicit cache hints, NeuralWatt uses
  best-effort implicit prefix caching, and other providers have route/model-specific
  or no cache-control support; see [docs/provider-caching.md](docs/provider-caching.md).
- **First-party packages**: `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-opencode-go`,
  `@arnilo/prism-provider-openrouter`, `@arnilo/prism-provider-zai`, `@arnilo/prism-provider-kimi`,
  `@arnilo/prism-provider-neuralwatt`, `@arnilo/prism-compaction-llm`, and
  `@arnilo/prism-compaction-observational-memory`.
- **Tools, context, skills**: host-owned tool registry with allow/deny filtering
  and dispatch, context providers, and a skill registry with progressive
  disclosure.
- **Input/prompt/context**: default input and prompt builders, system-prompt
  layering, and provider-input assembly — every stage replaceable.
- **Sessions and memory**: in-memory and JSONL session stores, branching/fork/
  clone, default and LLM compaction strategies, retry policy, and
  observational-memory recall/status/view.
- **Extensions and manifests**: extension kernel + event bus, contribution
  registries, middleware hooks, and data-only package manifests.
- **Config, settings, security**: layered config merge, settings providers,
  credential resolvers, trust/permission policies, and secret redaction.
- **CLI/RPC**: `prism --mode print|json|rpc` over the same `AgentSession` API.

## Install

```bash
npm install @arnilo/prism
```

First-party provider/compaction packages are separate installs and require
`@arnilo/prism` as a non-optional peer. Install a single package, or use an
umbrella to grab a whole family in one line:

```bash
npm install @arnilo/prism @arnilo/prism-provider-openai   # core + one provider
npm install @arnilo/prism @arnilo/prism-providers          # core + all providers
npm install @arnilo/prism-all                               # everything
```

See [docs/release-and-install.md](docs/release-and-install.md) for install
specifiers, tarball contents, and the offline test budget.

## Quick start

```ts
import { createAgent, createAgentSession, createMockProvider } from "@arnilo/prism";

// Host owns the provider. createMockProvider is for tests/demos only.
const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([{ type: "text", text: "Hello" }, { type: "done" }]),
});

const session = createAgentSession({ agent });

// Consume the event stream concurrently with the run. `subscribe()` only
// emits while a run is in progress, so the loop and `run()` must run together;
// awaiting the loop before calling `run()` would deadlock.
(async () => {
  const consumer = (async () => {
    for await (const event of session.subscribe()) {
      // AgentEvent: agent_started, message_delta, turn_finished, ...
    }
  })();
  await Promise.all([consumer, session.run("Hi")]);
})();
```

Register a first-party provider package through the extension kernel:

```ts
import { createExtensionKernel, createEnvCredentialResolver } from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

const kernel = createExtensionKernel();
await kernel.load([
  createOpenAIProviderPackage({
    apiKey: createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" }),
  }),
]);
```

Hosts own credentials. Do not put secrets in prompts, messages, events, stores,
or logs. Prism never reads `process.env` on its own; credential resolvers are
caller-supplied.

## CLI

```bash
prism --provider mock --model demo -p "Hi"          # print mode (default)
prism --provider mock --mode json -p "Hi"            # one event envelope per line
printf '{"id":"1","command":"prompt","params":{"input":"Hi"}}\n' \
  | prism --provider mock --mode rpc                 # LF-delimited JSONL RPC
```

## Docs

- [docs/index.md](docs/index.md) — navigational map of every public surface.
- The `examples/` directory holds compile-checked typed examples and runnable
  mock demos (provider registration, auth, tools, stores/branching, compaction,
  observational-memory recall, CLI, RPC).

## Packages

| package | purpose |
|---------|---------|
| `@arnilo/prism` | core contracts, runtime, registries, CLI/RPC |
| `@arnilo/prism-provider-openai` | OpenAI Responses + Codex OAuth provider |
| `@arnilo/prism-provider-opencode-go` | OpenCode Go provider |
| `@arnilo/prism-provider-openrouter` | OpenRouter provider with per-model cache control |
| `@arnilo/prism-provider-zai` | ZAI GLM provider |
| `@arnilo/prism-provider-kimi` | Kimi For Coding provider |
| `@arnilo/prism-provider-neuralwatt` | NeuralWatt provider with implicit vLLM prefix caching |
| `@arnilo/prism-compaction-llm` | provider-backed compaction strategy |
| `@arnilo/prism-compaction-observational-memory` | source-backed memory + recall tool |
| `@arnilo/prism-providers` | umbrella: all 6 provider adapters |
| `@arnilo/prism-compaction` | umbrella: both compaction strategies |
| `@arnilo/prism-all` | umbrella: core + providers + compaction |

## Scripts

| command | action |
|---------|--------|
| `npm run build` | Compile TypeScript to `dist/` (core + workspaces) |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Build + run network-free tests |
| `prism --help` | CLI help |

## Non-goals (v1)

- Built-in shell/filesystem/browser tools — ship as separate packages only.
- MCP bridge — external extension package after extension APIs settle.
- TUI or interactive terminal — CLI/RPC only in core.
- Workflow/graph orchestration — bounded agent loops first.
- Encrypted/keychain credential storage — host-owned until a real app needs it.
