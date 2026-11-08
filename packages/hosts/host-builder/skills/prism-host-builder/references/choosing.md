# Choosing what to use

Each section is a decision. Pick the first branch that fits, then read the README it names. Package names, config and
defaults live in the README, not here: they change, and the README is version-exact.

## Which host library

A host library serves or drives an agent from outside. It is imported by host code and is never listed in `packages`.
The index is `node_modules/@arnilo/prism/docs/index.md` under "Host libraries".

- No UI, jobs, cron, or answers arrive from chat or another process: `@arnilo/prism-headless` routes `HostUi`
  requests and schedules agent or workflow runs. Example: `examples/headless-host.ts`.
- An editor speaks the Agent Client Protocol: `@arnilo/prism-acp` (`serveAcp`). Example: `examples/acp.ts`.
- A browser UI speaks AG-UI over SSE: `@arnilo/prism-ag-ui`. Example: `examples/ag-ui-server.ts`.
- An MCP client should call the agent: `@arnilo/prism-mcp-server` (`serveMcp`). Example: `examples/mcp-server.ts`.
  To hand a vendor agent your tools instead, use `serveTools`; example: `examples/serve-tools.ts`.
- People talk to it in Telegram or Signal: `@arnilo/prism-channels`. Examples: `examples/telegram-agent.ts`,
  `examples/signal-agent.ts`.
- Another process or machine calls it: `@arnilo/prism-remote` serves and connects (`prism.remote/1`). Examples:
  `examples/remote-agent-server.ts`, `examples/remote-agent.ts`.
- You want to see events and state while developing: `@arnilo/prism-devtools` (a loopback inspector; do not expose it).
- You are scoring behavior: `@arnilo/prism-evals`. Example: `examples/evals.ts`.

Several can serve the same agent. Each needs the host to answer approvals, so settle the approval route first
(see "Approval" below).

## Which store

The `store` slot holds sessions. The kernel default is in memory and lost on exit.

- Single process, a file is enough: `@arnilo/prism-store-jsonl`.
- Single machine, queries, durable approvals and resume: `@arnilo/prism-store-sqlite`. Example:
  `examples/sqlite-resume.ts`.
- Several processes or machines, backups, enterprise state: `@arnilo/prism-store-postgres`. Read
  `node_modules/@arnilo/prism/docs/operations.md` before you rely on it.
- A product database of your own: implement `SessionStore` and run `storeConformance`. Example:
  `examples/custom-session-store.ts`. Details in `node_modules/@arnilo/prism/docs/slots.md`.

`@arnilo/prism-store-codecs` is a shared library, not a store. Do not list it.

## Slot owners and compaction

There are four slots: `loop`, `compaction`, `store`, `credentials`. Each holds one implementation. Two packages that
provide one slot with no assignment fail the load (`ERR_PRISM_SLOT_CONFLICT`). Assign the owner by package name in
`slots`, as `node_modules/@arnilo/prism/docs/slots.md` shows.

- Need summarised history: `@arnilo/prism-memory-compaction` (stable). Example: `examples/compaction.ts`.
- Need observational memory too: `@arnilo/prism-memory-observational` also claims `compaction`. List both and
  assign the owner you want. Example: `examples/observational-memory.ts`.
- Need a different loop (workflow, external agent): `slots.loop`, or a package that claims it
  (`@arnilo/prism-workflows`, `@arnilo/prism-driver-process`). Example: `examples/custom-loop.ts`.

## The experimental memory line

`@arnilo/prism-memory-core`, `-fabric`, `-observational`, `-wiki` and `-rag` ship as `0.13.0-experimental.N` on the npm
dist-tag `experimental`. They sit outside the compatibility promise: API, config and defaults may change in any release.
A `^0.13.0` range never matches a prerelease, so opt in by tag and keep the host able to run without them:

```bash
bun add @arnilo/prism-memory-fabric@experimental
```

Say in your report that the host depends on an experimental package. Use `@arnilo/prism-memory-compaction` unless
the product needs more. Examples: `examples/long-term-memory.ts`, `examples/memory-and-wiki.ts`.

## Approval and governance

- Ask a person before a write, a shell command or a delete: `@arnilo/prism-approval`, with a `mode` (`deny`, `ask`,
  `edits`, `auto`). Examples: `examples/approval.ts`, `examples/coding-approval.ts`. With no `host.ui`, an ask
  suspends the run durably instead of running the tool: `examples/durable-approval.ts`.
- Per-user policy, identity, an audit ledger: `@arnilo/prism-governance`. Examples: `examples/governance-deny.ts`,
  `examples/enterprise-policy-audit.ts`.
- Prompt-injection and PII checks on inputs, tool results and model output: `@arnilo/prism-guardrail-packs`.
  Example: `examples/guardrail-packs.ts`.
- Cost caps and failover across models: `@arnilo/prism-model-router`. Example: `examples/model-router.ts`.

Approval gates a call; it does not sandbox a tool. Isolation is the host's job (`references/security.md`).

## Which provider

There is no default. List exactly one provider package per vendor you call and name the model as
`provider/model` or a `ModelSpec`. Read the provider's README for credentials: they are `env:` or `keyring:` refs,
or a login flow that stores them for you through the `credentials` slot.

- A vendor package exists under "Providers" in `docs/index.md`: use it.
- It does not: write a provider on `@arnilo/prism/provider-kit`. Example: `examples/custom-provider.ts`.
- A gateway you operate (LiteLLM, OpenRouter, Kilo): use that gateway's package, and let the gateway pick the vendor.
- Offline tests: `mockProvider` from `@arnilo/prism/testing`.

```ts
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
});
const listed = agent.inspect();
await agent.dispose();
export { listed };
```
