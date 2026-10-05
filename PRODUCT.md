# Prism

This page is the target design for `@arnilo/prism` 0.13.0. **Nothing here is shipped yet.** What ships today is `@arnilo/prism` 0.12.1, documented in [docs/index.md](docs/index.md). [roadmap.md](roadmap.md) has the full architecture and the build order.

## What Prism is

Prism is a TypeScript SDK for running AI agents on Bun. It gives you the agent loop and a small set of extension points, and nothing else. Everything else is a package you choose to install: model vendors, coding tools, web search, memory, storage, and policy.

The SDK is `@arnilo/prism`. A host is any program that uses it, such as a CLI, a server, a TUI, or a bot. The host creates an agent, picks its packages, and talks to it.

```bash
bun add @arnilo/prism
```

## How it works

```
Host ──createAgent({ model, packages, host })──▶ SDK kernel ◀──setup(prism)── packages
```

The **SDK kernel** contains:

- **Agents and sessions.** You send a message to a session and get back a stream of events.
- **The loop.** It builds the context, calls the model, runs the tool calls, and repeats until the run ends.
- **Models.** Built-in streaming model access with an OpenAI-compatible client. Provider packages register other vendors.
- **Tools and skills.** A tool registry with schema validation, and skills with progressive disclosure through `load_skill`.
- **Hooks.** Typed points in the loop where code can observe, transform, decide, or wrap what happens.
- **Slots.** Single-owner services that can be replaced whole: the loop, compaction, the session store, and credentials.
- **Packages.** The loader, per-package config, and the manifest.
- **Host port.** One channel for asking a person something: confirm, select, input, secret, or open a URL.

A **package** is a plain TypeScript module that Bun runs as-is, with no build step. When it loads, it receives the SDK's API and changes the agent through it. A package can:

- add tools, skills, commands, or model providers
- hook into any point in the loop
- keep state for each session
- run background work
- call other models
- replace the whole loop with its own workflow

Once a package is loaded, it is active. The host does not have to wire anything else up.

Prism maintains a **manifest** at `.prism/packages.json` (project) and `~/.prism/packages.json` (user). It records which packages are installed, their versions and integrity hashes, their config, and which package owns each slot. `prism add <package>` installs a package and records it there.

The **host** stays in control:

- It decides which packages load, from code or from a manifest.
- Its config overrides package config.
- It can switch off any single tool, hook, or command.
- It picks slot owners when two packages claim the same slot.
- It answers the host-port requests.
- `agent.inspect()` shows everything that was loaded, and where each piece came from.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import coding from "@arnilo/prism-tools-coding";
import anthropic from "@arnilo/prism-provider-anthropic";
import observationalMemory from "@arnilo/prism-memory-observational";

const agent = await createAgent({
  model: "anthropic/claude-sonnet-4-5",
  packages: [
    anthropic(),
    coding({ root: process.cwd() }),
    observationalMemory({ observer: { model: "anthropic/claude-haiku-4-5" } }),
  ],
  host: { ui: myUi }, // answers approvals, questions, secrets
});

const session = await agent.session();
for await (const event of session.stream("Fix the failing test")) render(event);
await agent.dispose();
```

To load the installed packages from the manifest instead, use `packages: await loadManifest()`.

## Writing a package

```ts
import { definePackage } from "@arnilo/prism";

export default definePackage({
  name: "@acme/prism-audit",
  version: "1.0.0",
  requires: { prism: "^0.13" },
  setup(prism) {
    prism.hooks.on("tool.call", (call) => (call.name === "shell" && isDangerous(call.args) ? { deny: "blocked by audit policy" } : undefined));
    prism.hooks.on("tool.completed", (event) => audit.write(event));
  },
});
```

## Native packages

Prism's own packages are optional, just like third-party ones. None of them is installed by default.

| Area | Packages |
| --- | --- |
| Model providers | `@arnilo/prism-provider-{anthropic, openai, google, azure, bedrock, vertex, …}` |
| Tools | `@arnilo/prism-tools-{coding, web, browser, work, computer-use, openapi}` |
| Memory and context | `@arnilo/prism-memory-{compaction, observational, rag, wiki, fabric}`, `@arnilo/prism-context-{files, engineering}` |
| Session stores | `@arnilo/prism-store-{jsonl, sqlite, postgres}` |
| Policy | `@arnilo/prism-approval`, `@arnilo/prism-governance`, `@arnilo/prism-guardrail-packs`, `@arnilo/prism-model-router` |
| Integrations | `@arnilo/prism-mcp`, `@arnilo/prism-hooks-json`, `@arnilo/prism-observability`, `@arnilo/prism-workflows`, `@arnilo/prism-delegate` |
| Vendor coding agents | `@arnilo/prism-driver-{claude-code, codex, antigravity}`: run a custom agent (system prompt, tools, skills, sub-agents) on the user's installed `claude`, `codex`, or `agy` binary, under the user's own subscription where the vendor's terms allow it, with every message, thinking block, skill activation, and tool call captured as events |

**Surfaces** connect an agent to the outside world, so they are host libraries rather than packages. They take an `Agent` and serve it: `@arnilo/prism-acp`, `@arnilo/prism-ag-ui`, `@arnilo/prism-mcp-server`, `@arnilo/prism-channels`.

**Prism Code** is the reference host. It is a coding-agent TUI built only on `@arnilo/prism` and the manifest. It is not an embedding API.

## Principles

- **The kernel knows no package names.** Packages depend on the SDK; the SDK never depends on a package.
- **Installed means active.** Nothing loads unless the host lists it, and a loaded package needs no extra wiring.
- **Replacing the loop does not bypass the safety gates.** A tool can only run through the SDK's tool primitive, and the `tool.call` hook always fires there.
- **Fail closed.** A load stops with an error on any of these: unknown config, conflicting slot owners, a missing required service, a literal secret in config, a failed integrity check, or an untrusted project manifest. A deny from any gate stops the action.
- **Secrets stay at the edge.** Config and manifests hold references such as `env:NAME`, never raw keys. Secrets never appear in events.
- **Packages are trusted code.** They run in-process with full Bun privileges. Installing a package is the trust decision; Prism does not claim to sandbox them.
