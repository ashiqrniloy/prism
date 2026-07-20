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
- **First-party packages**: six provider adapters, two compaction strategies,
  coding tools/security, JSON Schema validation, MCP, workflows, OpenTelemetry,
  encrypted credentials, SQLite/PostgreSQL persistence, and manifest-only install profiles.
- **Tools, context, skills**: host-owned tool registry with allow/deny filtering
  and dispatch, context providers, and a skill registry with progressive
  disclosure.
- **Input/prompt/context**: default input and prompt builders, system-prompt
  layering, and provider-input assembly — every stage replaceable.
- **Sessions and memory**: in-memory and JSONL session stores, branching/fork/
  clone, default and LLM compaction strategies, retry policy,
  observational-memory recall/status/view, optional working/semantic memory
  (`@arnilo/prism-memory`), and bounded text/Markdown RAG (`@arnilo/prism-rag`).
- **Extensions and manifests**: extension kernel + event bus, contribution
  registries, middleware hooks, and data-only package manifests.
- **Config, settings, security**: layered config merge, settings providers,
  credential resolvers, trust/permission policies, and secret redaction.
- **CLI/RPC/server**: `prism --mode print|json|rpc`, `prism init`, optional framework-free authorized Web agent/workflow routes, and explicit MCP server exposure.

## Install

```bash
npm install @arnilo/prism
```

First-party code packages are separate imports and require `@arnilo/prism` as
a non-optional peer. Install atomic packages directly or choose a manifest-only
family/profile; profiles install packages but expose no alias exports and activate nothing:

```bash
npm install @arnilo/prism @arnilo/prism-provider-openai    # core + one provider
npm install @arnilo/prism-base                              # core + compaction + validation
npm install @arnilo/prism-code @arnilo/prism-provider-openai # coding-agent profile
npm install @arnilo/prism-sdk @arnilo/prism-provider-openai  # application profile
npm install @arnilo/prism-all                               # every first-party package
npm install @arnilo/prism-server @arnilo/prism-workflows    # optional Web API boundary
npm install @arnilo/prism-supervisor                         # optional local delegation + A2A 1.0
npm install @arnilo/prism-web-tools                          # optional bounded Brave/Exa/Firecrawl research
```

See [docs/release-and-install.md](docs/release-and-install.md) for install
specifiers, tarball contents, and the offline test budget.

## Quick start

Scaffold a tiny project (offline mock test included):

```bash
npx --package @arnilo/prism prism init my-agent
# or, with a real provider package selected:
npx --package @arnilo/prism prism init my-agent --provider openai
cd my-agent && npm install && npm test
```

Or embed Prism directly:

```ts
import { createAgent, createAgentSession, createMockProvider } from "@arnilo/prism";

// Host owns the provider. createMockProvider is for tests/demos only.
const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([{ type: "text", text: "Hello" }, { type: "done" }]),
});

const session = createAgentSession({ agent });

// Direct result: run/prompt return AgentRunResult (text, usage, status, ids).
const result = await session.run("Hi");
console.log(result.text, result.usage?.totalTokens);

// Integrated streaming: subscribe-before-run for one owned run.
for await (const event of session.stream("Hi again")) {
  // AgentEvent: agent_started, message_delta, turn_finished, ...
}

// Long-lived subscribe() still works when you need a subscriber across runs.
// `subscribe()` only emits while a run is in progress, so the loop and `run()`
// must run together; awaiting the loop before calling `run()` would deadlock.
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
  offline demos covering providers, auth, tools, stores, compaction, structured
  output, multimodality, workflows, CLI, and RPC.

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
| `@arnilo/prism-coding-agent` | bounded shell/read/write/edit tools |
| `@arnilo/prism-coding-security` | coding approval, containment, and sandbox adapters |
| `@arnilo/prism-tool-validator-json-schema` | bounded JSON Schema tool validation |
| `@arnilo/prism-mcp` | MCP client/tool bridge |
| `@arnilo/prism-workflows` | bounded DAG workflows, durable suspend/resume, schedules/background runs, composition/state/replay, and multi-process coordination |
| `@arnilo/prism-supervisor` | bounded local child delegation and A2A 1.0 interoperability |
| `@arnilo/prism-web-tools` | host-selected bounded Brave/Exa search and Firecrawl Markdown/schema extraction |
| `@arnilo/prism-observability-opentelemetry` | optional OpenTelemetry adapter |
| `@arnilo/prism-credentials-node` | encrypted-file and keychain credentials |
| `@arnilo/prism-session-store-sqlite` | SQLite persistence/checkpoints/leases/owned run feedback |
| `@arnilo/prism-session-store-postgres` | PostgreSQL persistence/checkpoints/leases/owned run feedback |
| `@arnilo/prism-providers` | family: all 7 provider adapters, including AI SDK interoperability |
| `@arnilo/prism-compaction` | family: both compaction strategies |
| `@arnilo/prism-base` | profile: core + compaction + JSON Schema validation |
| `@arnilo/prism-code` | profile: base + coding tools/security + MCP |
| `@arnilo/prism-sdk` | profile: base + workflows + MCP + credentials + OpenTelemetry |
| `@arnilo/prism-all` | every first-party package, including both persistence adapters and web tools |

## Scripts

| command | action |
|---------|--------|
| `npm run build` | Compile TypeScript to `dist/` (core + workspaces) |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Build + run network-free tests |
| `prism --help` | CLI help |

## Non-goals (v1)

- Privileged tools, MCP servers, telemetry, credentials, or databases activated by install — hosts explicitly configure and register every capability.
- Browser automation or interactive terminal UI — CLI/RPC and workflow control APIs only.
- Provider, credential, extension, or package auto-discovery.
- Core-owned database drivers, secret persistence, sandbox, or application policy — optional packages implement adapters over host-owned boundaries.
