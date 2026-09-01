# prism

`prism` is a TypeScript/Node.js agent harness. Host apps and extension packages
bring their tools, providers, credentials, storage, and UI; Prism supplies the
common contracts, registries, agent/session runtime, replaceable input/prompt
and compaction strategies, CLI/RPC adapters, and first-party provider/compaction
packages. The current 0.3.3 line contains 11 publishable manifests, including
optional Linux desktop control, a versioned prompt registry, and independent
package versioning after the final lockstep cut. Prism defines contracts, not apps.

## Current scope

- **Agent/session runtime**: `createAgent`/`createAgentSession`, run prompts,
  dispatch host tools, subscribe to normalized `AgentEvent` streams, abort runs,
  compact, and navigate branches.
- **Field-level classification (0.2.7)**: `applyFieldPolicy` + the fail-closed protected default walk JSON-like values across prompt/tool/artifact/audit/telemetry/persistence/export boundaries with `allow`/`redact`/`tokenize`/`deny` decisions, explicit per-boundary `labelFor` hints, bounded traversal, and sparse-copy allocation; seams at the egress redaction functions, the audit-export redactor hook, and the OpenTelemetry attribute policy. See [docs/data-classification.md](docs/data-classification.md).
- **Providers and models**: provider/model registries, provider event helpers,
  credential redaction helpers, mock provider, and an optional
  OpenAI-compatible provider subpath. Cache support is provider-specific:
  OpenAI/OpenRouter use best-effort explicit cache hints, NeuralWatt uses
  best-effort implicit prefix caching, and other providers have route/model-specific
  or no cache-control support; see [docs/provider-caching.md](docs/provider-caching.md).
- **First-party packages**: seventeen provider adapter subpaths, two compaction strategies,
  coding tools/security, JSON Schema validation, MCP, workflows, OpenTelemetry,
  encrypted credentials, SQLite/PostgreSQL persistence, Linux desktop control,
  and manifest-only install profiles.
- **Tools, context, skills**: host-owned tool registry with allow/deny filtering
  and dispatch, context providers, and a skill registry with progressive
  disclosure.
- **Input/prompt/context**: default input and prompt builders, system-prompt
  layering, and provider-input assembly — every stage replaceable.
- **Sessions and memory**: in-memory and JSONL session stores, branching/fork/
  clone, default and LLM compaction strategies, retry policy,
  observational-memory recall/status/view, and the `@arnilo/prism-memory` family
  (working/semantic memory plus `/rag`, `/compaction/*`, `/graft`, `/wiki` subpaths).
- **Extensions and manifests**: extension kernel + event bus, contribution
  registries, middleware hooks, and data-only package manifests.
- **Config, settings, security**: layered config merge, settings providers,
  credential resolvers, trust/permission policies, and secret redaction.
- **CLI/RPC/server**: `prism --mode print|json|rpc`, `prism init`, optional framework-free authorized Web agent/workflow routes, and explicit MCP server exposure.
- **Ecosystem parity (0.0.15)**: OpenAI hosted-tool attribution, bounded Responses
  continuation/Realtime, exact AI SDK V4 mapping, bounded RAG lifecycle/reranking/trust,
  and consent-bound memory export/rebuild; provider, RAG, and memory packages remain optional.
- **Co-work contracts (0.0.14)**: conversation/artifact review types, deny-by-default device
  contracts, and OAuth refresh/revoke helpers; services stay in optional packages.

## Install

```bash
npm install @arnilo/prism
```

First-party code packages are separate imports and require `@arnilo/prism` as
a non-optional peer. Install atomic packages directly or choose a manifest-only
family/profile; profiles install packages but expose no alias exports and activate nothing:

```bash
npm install @arnilo/prism @arnilo/prism-providers            # core + all 17 provider adapters
npm install @arnilo/prism @arnilo/prism-core @arnilo/prism-memory   # replaces prism-base
npm install @arnilo/prism @arnilo/prism-coding-tools @arnilo/prism-mcp @arnilo/prism-providers  # replaces prism-code
npm install @arnilo/prism @arnilo/prism-core @arnilo/prism-mcp @arnilo/prism-providers          # replaces prism-sdk
npm install @arnilo/prism @arnilo/prism-core @arnilo/prism-providers  # pick families explicitly (no umbrella)
npm install @arnilo/prism-server @arnilo/prism-workflows    # optional Web API boundary
npm install @arnilo/prism-supervisor                         # optional local delegation + A2A 1.0
npm install @arnilo/prism-web-tools                          # unified web tools family (root search + /browser + /obscura subpaths)
```

See [docs/release-and-install.md](docs/release-and-install.md) for install
specifiers, tarball contents, and the offline test budget.

## Quick start

Scaffold a project (offline mock test included):

```bash
npx --package @arnilo/prism prism init my-agent
# or, scaffold with a real provider package selected:
npx --package @arnilo/prism prism init my-agent --provider openai
# or, scaffold a full deep research agent from the template gallery:
npx --package @arnilo/prism prism init my-research --template deep-research
cd my-agent && npm install && npm test
```

List available template gallery starters:
```bash
prism init --list-templates
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
import { createOpenAIProviderPackage } from "@arnilo/prism-providers/openai";

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
| `@arnilo/prism-core` | runtime/sessions/governance/credentials/enterprise/work/validation family |
| `@arnilo/prism-providers` | all 17 first-party adapters as `/<adapter>` subpaths (openai, anthropic, google, azure, bedrock, vertex, deepseek, xai, zai, alibaba, kimi, clinepass, neuralwatt, ollama, opencode-go, openrouter, ai-sdk) |
| `@arnilo/prism-coding-tools` | `/agent`, `/security`, `/document-reader`, `/openapi`, `/computer-use-linux`, `/dev`, `/caveman`, `/ponytail`, `/impeccable` |
| `@arnilo/prism-web-tools` | Brave/Exa/Firecrawl plus peer-gated `/browser` and `/obscura` |
| `@arnilo/prism-memory` | memory plus `/rag`, `/compaction/{llm,observational-memory}`, `/graft`, `/wiki` |
| `@arnilo/prism-mcp` | MCP client/server/OAuth interop |
| `@arnilo/prism-acp-agent` | ACP adapter |
| `@arnilo/prism-ag-ui` | AG-UI/A2A/A2UI adapter |
| `@arnilo/prism-antigravity-agent` | Antigravity CLI adapter |
| `@arnilo/prism-office` | `/documents`, `/sheets`, `/diagrams` |

## Scripts

| command | action |
|---------|--------|
| `npm run build` | Compile TypeScript to `dist/` (core + workspaces) |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Build + run network-free tests |
| `prism --help` | CLI help |

## Non-goals (v1)

- Privileged tools, MCP servers, telemetry, credentials, or databases activated by install — hosts explicitly configure and register every capability.
- Browser automation or interactive terminal UI in core — hosts may opt into the `@arnilo/prism-web-tools/browser` subpath with their own Playwright lifecycle; Prism does not auto-start browsers or ship a TUI.
- Provider, credential, extension, or package auto-discovery.
- Core-owned database drivers, secret persistence, sandbox, or application policy — optional packages implement adapters over host-owned boundaries.
