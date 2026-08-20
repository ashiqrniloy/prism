# @arnilo/prism-antigravity-agent

Delegated agent adapter around the official Google Antigravity CLI (`agy`) with per-run Prism MCP capability exposure, custom hybrid tool policies, and AG-UI timeline projection.

## Overview

`@arnilo/prism-antigravity-agent` enables Prism orchestrators and supervisors to delegate tasks to the official `agy` CLI using the host's authenticated Google AI Pro or AI Ultra subscription quota while exposing selected Prism tools via Model Context Protocol (MCP).

- **CLI-Owned Agent Loop**: `agy` owns planning, model selection, reasoning, subagents, and loop execution.
- **Prism Capabilities & Security**: State-changing workspace mutations (file edits, command execution, browser automation) route through authorized Prism MCP tools with secret redaction and policy enforcement.
- **Zero Credential Handling**: Prism never reads, stores, refreshes, or copies Antigravity OAuth tokens. Headless CLI runs use cached host credentials from interactive `agy login`.
- **Safe Timeline Projection**: Streams `init`, `step_update`, and `result` events into typed Prism `AgentEvent`s and AG-UI activity snapshots without exposing unreleased internal chain-of-thought transcripts.

## Installation

```bash
npm install @arnilo/prism-antigravity-agent
```

### Prerequisites

Ensure the official Antigravity CLI (`agy`) is installed and authenticated on the host system:

```bash
agy login
```

## Quick Start

### Basic CLI Delegation

```ts
import { createAntigravityCliAgent } from "@arnilo/prism-antigravity-agent";

const agent = createAntigravityCliAgent({
  toolPolicy: "prism-mutators", // default: route state changes to Prism MCP
});

const result = await agent.run({
  prompt: "Analyze repository test suite and fix failing cases",
  cwd: process.cwd(),
});

console.log("Agent status:", result.status);
console.log("Response:", result.response);
```

### Exposing Prism MCP Tools to Antigravity

```ts
import { createAntigravityCliAgent } from "@arnilo/prism-antigravity-agent";

const agent = createAntigravityCliAgent({
  tools: [
    {
      name: "run_build",
      description: "Runs npm run build",
      execute: async () => ({ toolCallId: "1", name: "run_build", content: [{ type: "text", text: "Build succeeded" }] }),
    },
  ],
  toolPolicy: "prism-mutators",
});

const result = await agent.run({
  prompt: "Run the build and verify clean output",
  cwd: "/path/to/workspace",
  onEvent: (event) => {
    console.log("Prism AgentEvent:", event.type);
  },
});
```

### Supervisor Delegation Tool

```ts
import { createAntigravityCliAgent, createAntigravityDelegationTool } from "@arnilo/prism-antigravity-agent";

const agent = createAntigravityCliAgent();
const delegationTool = createAntigravityDelegationTool({ agent });

// Register in Prism ToolRegistry
registry.register(delegationTool);
```

## Tool Policies

- `"prism-mutators"` *(default)*: Denies overlapping Antigravity built-in mutators (`run_command`, `write_to_file`, `replace_file_content`, `delete_file`, `rename_file`, `launch_browser`, `browser_action`) and routes state mutations to authorized Prism MCP tools.
- `"prism-only"`: Denies all mutator and read-only built-in tools, requiring all operations to execute through Prism MCP.
- `Custom`: Explicit `{ allowBuiltins: [...], denyBuiltins: [...] }`.

## License

MIT
