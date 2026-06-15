# prism

Agent harness for AI providers, agents, sessions, and tools. A TypeScript/Node.js
package that host apps use to build AI-powered features — not an app itself.

## Current scope

- ESM TypeScript package with strict mode.
- CLI entry point (`prism` bin, placeholder).
- Public barrel (`prism` package import).
- Public TypeScript contracts for host-owned agents, sessions, providers, tools, context, skills, extensions, stores, resources, settings, and credentials.
- Provider/model registries, provider event helpers, credential redaction helpers, and mock provider.
- Optional OpenAI-compatible provider subpath using native `fetch`.
- Compile-only host examples for provider/context/skill/tool wiring.
- `node:test`-based test (no test framework dependency).
- TypeScript build-only toolchain (no bundler).

**prism defines contracts, not apps.** No built-in tools, no provider SDKs,
no default credentials, no app-specific integrations. Host apps own their
tools, provider implementations, credentials, permissions, storage, and UI layer.

## Public contracts

```ts
import type { AgentConfig, AIProvider, ContextProvider, Skill, ToolDefinition } from "prism";
```

The current runtime covers provider/model lookup and provider streaming helpers only.
Agent/session loops, tool dispatch, persistence adapters, and CLI/RPC runtime arrive in later phases.

## Provider layer

```ts
import { createModelRegistry, createMockProvider, createProviderRegistry } from "prism";

const provider = createMockProvider([{ type: "done" }]);
const providers = createProviderRegistry([provider]);
const models = createModelRegistry([{ provider: "mock", model: "demo" }]);

providers.resolve("mock");
models.resolve("mock", "demo");
```

Optional OpenAI-compatible adapter:

```ts
import { createOpenAICompatibleProvider } from "prism/providers/openai-compatible";

const provider = createOpenAICompatibleProvider({
  baseUrl: "https://api.openai.com/v1",
  apiKey: () => process.env.OPENAI_API_KEY,
});
```

Hosts own credentials. Do not put secrets in prompts, messages, events, stores, or logs.

## Scripts

| command | action |
|---------|--------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Build + run tests |
| `prism --help` | CLI placeholder |

## Non-goals (v1)

- Built-in shell/filesystem/browser tools
- MCP bridge
- TUI or interactive terminal
- Workflow/graph orchestration
- First-party provider adapters beyond OpenAI-compatible
