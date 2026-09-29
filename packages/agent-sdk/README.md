# @arnilo/prism-agent-sdk

Systematically assemble a configurable agentic runtime from Prism seams.

The SDK packages tool planes, skills discovery, instructions/`AGENTS.md`, MCP client bridges,
hooks, and session stores into a coherent runtime agent and session factory. Every capability
plane is optional and replaceable — disabling every plane reduces to the bare, unopinionated
Prism loop.

```bash
bun add @arnilo/prism @arnilo/prism-agent-sdk
```

## Quick Start

```ts
import { createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { codingPreset, defineAgent, mergeAgentConfig } from "@arnilo/prism-agent-sdk";

// Define an agent with the coding preset (canonical file, search, and execution tools)
const app = await defineAgent(
  mergeAgentConfig(codingPreset({ cwd: process.cwd() }), {
    model: { provider: "anthropic", model: "claude-3-7-sonnet" },
    provider: myProvider,
    instructions: "You are an expert software engineer.",
  }),
);

// Create a session and run a prompt
const session = app.createSession();
const result = await session.run("Review the repository structure");

// Clean up resources (closes all connected MCP server bridges)
await app.dispose();
```

## Features

- **Tool Planes**: Resolve tool lists via declarative `planes`, `exclude`, `replace`, and `add` pipeline with guaranteed deterministic ordering.
- **Skills Discovery**: Discovers skills from `.agents/skills` with fail-closed path-trust checks.
- **Instructions Plane**: Auto-loads `AGENTS.md` and custom system prompt layers.
- **MCP Client Bridges**: Eagerly connects STDIO and SSE/HTTP MCP servers with fail-closed allow-rule validation and disposal tracking.
- **Hooks Integration**: Compiles declarative `hooks.json` onto middleware, guardrail, injector, and stop-hook seams.
- **Presets**: Ready-to-use configurations (`codingPreset`, `barePreset`) that merge cleanly with host overrides.
- **JSON Configuration**: Parse and validate configuration objects or JSON files with comprehensive key-path validation.
- **Host Commands**: Register host-only commands (`commands`) distinct from model-visible tools, with fail-closed duplicate rejection.
