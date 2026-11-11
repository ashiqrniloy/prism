# Prism

This page describes `@arnilo/prism` 0.13.0. The contract is documented page by page in [docs/index.md](docs/index.md), and [roadmap.md](roadmap.md) has the architecture and the build order.

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

A **package** is one module specifier — an npm package, or one subpath its `exports` map lists — that Bun runs as-is, with no build step. When it loads, it receives the SDK's API and changes the agent through it. A package can:

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
import coding from "@arnilo/prism-tools/coding";
import hyper from "@arnilo/prism-ai/hyper";
import memorySystem from "@arnilo/prism-memory-system";

const agent = await createAgent({
  model: "hyper/claude-sonnet-4-5",
  packages: [
    hyper({ apiKey: "env:HYPER_API_KEY" }),
    coding({ root: process.cwd() }),
    memorySystem({ stm: { model: "hyper/claude-haiku-4-5" } }),
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
  requires: { api: 1 },
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
| Model providers | `@arnilo/prism-ai/{hyper, kilo, laya, liquid, litellm, openai-codex, opencode-go, openrouter, typesafe, commandcode, ollama-cloud}` |
| Tools | `@arnilo/prism-tools/{coding, web, browser, work, computer-use, openapi, research}` |
| Memory and context | `@arnilo/prism-extensions/{compaction, context-files, context-engineering}`; experimental: `@arnilo/prism-memory-system`, `@arnilo/prism-memory-system/core`, `@arnilo/prism-knowledge/{wiki, rag}` |
| Session stores | `@arnilo/prism-extensions/store-{jsonl, sqlite, postgres}` |
| Policy | `@arnilo/prism-extensions/{approval, governance, guardrail-packs, model-router}` |
| Integrations | `@arnilo/prism-extensions/{mcp, hooks-json, observability, workflows, delegate}` |
| Vendor coding agents | `@arnilo/prism-hosts/driver-process`: a generic driver that runs a host-written adapter for any coding-agent binary (system prompt, tools, skills, sub-agents), under the user's own subscription where the vendor's terms allow it, with every message, thinking block, skill activation, and tool call captured as events. No vendor adapter is shipped. |

Each row is a subpath of a bundle: npm installs the bundle once, and the host lists the subpaths it wants. Six bundles ship in 0.13.0 — `@arnilo/prism-ai`, `@arnilo/prism-extensions`, `@arnilo/prism-tools`, `@arnilo/prism-hosts` (stable) and `@arnilo/prism-memory-system`, `@arnilo/prism-knowledge` (experimental) — so a host adds seven npm packages in total, not one per package.

### Memory

Memory is two tiers over one store, and each tier is its own package subpath; the ontology is knowledge outside memory, in the wiki. Nothing is installed or on by default.

**Experimental in 0.13.0.** `@arnilo/prism-memory-system` (the session tiers and the fabric, which is its `ltm`) and `@arnilo/prism-memory-system/core` (the shared library), with the wiki (`@arnilo/prism-knowledge/wiki`) and retrieval (`@arnilo/prism-knowledge/rag`), ship on an experimental prerelease line (`0.13.0-experimental.N`, npm dist-tag `experimental`; install with `bun add @arnilo/prism-memory-system@experimental`). They sit outside the stability promise of the stable bundles, so their API, config and defaults may change or be removed in any release. They graduate to stable versions as the last step of the memory track, after 0.13.0, once each feature has been audited against measured evidence. `@arnilo/prism-extensions/compaction` is stable. The stable bundles and the reference host's default agents load no experimental package.

**Standing rules.** Long-term memory in `@arnilo/prism-memory-system` (`ltm`) keeps the preferences, procedures and decisions a person stated or confirmed as typed notes. A small pinned block of them sits in the prompt prefix and stays byte-identical between turns, and a rule that applies to one subtree arrives as a short cue when the agent touches matching files. A rule is proposed until the person confirms it or it is used in two sessions.

**The record.** The same fabric stores facts and, when `exchanges` is on, every completed turn verbatim. The agent searches it with `memory.recall` and reads what it needs in full with `memory.read`; retrieval is lexical and needs no embeddings. `@arnilo/prism-memory-system` holds the session tiers below it (short-term memory, working memory and rehearsal, modelled on human memory): they observe the session in the background, and the fabric's promotion pass can read its observations and write them as candidate notes that earn trust by use. Writing and recalling the record makes no model call unless the host opts in to one.

**The ontology.** `@arnilo/prism-knowledge/wiki` is knowledge outside memory: one concept per subject in its own store, with itemized claims, each citing the memory notes or ingested sources it rests on. An agent searches it with `wiki.search`, which returns concepts with the ids their claims cite, and drills down with `wiki.read`. The wiki reads memory only through a read-only port and never writes it; forgetting a cited memory note removes the claims that rested on it, with no model call. It also runs without memory, on its own sources. The cost is a background model call per due subject on the model the host names in `consolidate.model`; installing the package is what opts in. It is unmeasured, so nothing here claims it improves answers.

**Host libraries** connect an agent to the outside world or to a person, so they are libraries rather than packages — subpaths of `@arnilo/prism-hosts` that register nothing. They take an `Agent` and serve it, or route its requests: `@arnilo/prism-hosts/acp`, `@arnilo/prism-hosts/ag-ui`, `@arnilo/prism-hosts/mcp-server`, `@arnilo/prism-hosts/channels`, `@arnilo/prism-hosts/remote` (serve an agent to remote clients, or connect to one), and `@arnilo/prism-hosts/headless` (answer host-port requests without a person).

**Prism Agent** is the reference host. It is a coding agent built only on `@arnilo/prism` and the manifest, and it is not published. Its [walkthrough](apps/prism-agent/README.md) shows how a host assembles the pieces above.

## Principles

- **The kernel knows no package names.** Packages depend on the SDK; the SDK never depends on a package.
- **Installed means active.** Nothing loads unless the host lists it, and a loaded package needs no extra wiring.
- **Replacing the loop does not bypass the safety gates.** A tool can only run through the SDK's tool primitive, and the `tool.call` hook always fires there.
- **Fail closed.** A load stops with an error on any of these: unknown config, conflicting slot owners, a missing required service, a literal secret in config, a failed integrity check, or an untrusted project manifest. A deny from any gate stops the action.
- **Secrets stay at the edge.** Config and manifests hold references such as `env:NAME`, never raw keys. Secrets never appear in events.
- **Packages are trusted code.** They run in-process with full Bun privileges. Installing a bundle is the trust decision, and it covers every subpath you then list — a bundle's subpaths ship from one verified tarball, so listing one of them runs code you already trusted at install time. Prism does not claim to sandbox them.
