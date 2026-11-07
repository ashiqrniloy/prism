# Recipes

One entry per common change. Each names a CI-tested example to copy (`node_modules/@arnilo/prism-host-builder/data/examples/<file>`)
and the page that explains it. The example is the code; this file never restates it, so it cannot drift.
`data/examples.json` says whether an example needs credentials.

After you copy an example, change the model to the host's, swap the mock provider for the real provider package, and
keep the rest.

## Create an agent and run it

Copy `examples/sdk-basics.ts`, then `examples/minimal-host-app.ts` for streaming events.
Page: `node_modules/@arnilo/prism/docs/agent.md`.

## Add a tool the host owns

Copy `examples/tools.ts` for the registry and `examples/custom-tools-skills-context.ts` for a tool, a skill and a
context source in one agent. Declare the tool's `effects` so approval and governance can classify it.
Page: `node_modules/@arnilo/prism/docs/tools.md`.

## Write a package

Copy `examples/define-package.ts`. Declare `requires: { api: 1 }`, the capabilities you use, and a config schema
with `x-prism-secret` for any secret field. Test it with `packageConformance` (`references/verification.md`).
Page: `node_modules/@arnilo/prism/docs/packages.md`.

## Ship a skill with a package

Copy `examples/package-skills.ts` and `examples/skills.ts`. Register the directory in `setup` with `prism.skills.addDir`
and list the directory in `package.json` `files`. Keep the description at 300 bytes or less and declare `requiresTools`
for tools that are always present.
Page: `node_modules/@arnilo/prism/docs/packages.md` ("Writing a package skill").

## Add a hook (gate, transform, observe)

Copy `examples/host-hooks.ts` for a budget gate and `examples/custom-builders.ts` for a `run.input` hook. Use a hook,
not a wrapper around the loop. A deny must return a reason; a throwing gate fails closed.
Page: `node_modules/@arnilo/prism/docs/hooks.md`.

## Load AGENTS.md, SYSTEM.md and workspace skills

Copy `examples/system-project-prompts.ts` and `examples/discover-skills.ts`. Context files are trust-gated.
Page: `node_modules/@arnilo/prism-context-files/README.md`.

## Make runs durable and resumable

Copy `examples/sqlite-resume.ts`, then `examples/durable-approval.ts` for a run that suspends on an approval and
resumes after a restart.
Page: `node_modules/@arnilo/prism/docs/slots.md`.

## Gate tool calls with approval

Copy `examples/approval.ts`, then `examples/coding-approval.ts` for a coding agent.
Page: `node_modules/@arnilo/prism-approval/README.md`.

## Add a model provider

Copy `examples/custom-provider.ts`, then run the provider conformance helpers.
Page: `node_modules/@arnilo/prism/docs/provider-kit.md`.

## Resolve a model by name from registered providers

Copy `examples/provider-resolver.ts`.
Page: `node_modules/@arnilo/prism/docs/models.md`.

## Serve an agent

- ACP (editors): `examples/acp.ts`. Page: `node_modules/@arnilo/prism-acp/README.md`.
- AG-UI (browser): `examples/ag-ui-server.ts`. Page: `node_modules/@arnilo/prism-ag-ui/README.md`.
- MCP: `examples/mcp-server.ts`. Page: `node_modules/@arnilo/prism-mcp-server/README.md`.
- Remote: `examples/remote-agent-server.ts` and `examples/remote-agent.ts`.
  Page: `node_modules/@arnilo/prism-remote/README.md`.
- Chat: `examples/telegram-agent.ts`. Page: `node_modules/@arnilo/prism-channels/README.md`.

Every server needs authentication and an ownership mapping before it listens beyond loopback: read
`references/security.md` first.

## Use MCP servers as tools

Copy `examples/mcp-trust.ts` for the trust decision and `examples/connected-slack-mcp.ts` for a hosted server with
tokens kept out of model context.
Page: `node_modules/@arnilo/prism-mcp/README.md`.

## Orchestrate several agents

Copy `examples/workflow-research-and-review.ts`, then `examples/workflow-sqlite-resume.ts` for durable checkpoints.
For a model-facing sub-agent tool, copy `examples/delegate.ts`.
Pages: `node_modules/@arnilo/prism-workflows/README.md`, `node_modules/@arnilo/prism-delegate/README.md`.

## Drive a vendor coding agent

Copy `examples/external-agent.ts`, then `examples/custom-adapter.ts`.
Pages: `node_modules/@arnilo/prism/docs/drivers.md`, `node_modules/@arnilo/prism/docs/agent-adapters.md`.

## Compact long history

Copy `examples/compaction.ts`. If you also list observational memory, assign the `compaction` owner
(`references/choosing.md`).
Page: `node_modules/@arnilo/prism-memory-compaction/README.md`.

## Drive the host from a manifest

Copy `examples/manifest.ts`. The manifest records packages, ranges, integrity and capabilities; `prism add` installs
and `prism verify` re-checks.
Page: `node_modules/@arnilo/prism/docs/manifest.md`.

## Route across models with a budget

Copy `examples/model-router.ts`, then `examples/model-router-aggregate-budgets.ts`.
Page: `node_modules/@arnilo/prism-model-router/README.md`.

## Observe and evaluate

Copy `examples/observability.ts` for OpenTelemetry and `examples/evals.ts` for a dataset and scorers.
Pages: `node_modules/@arnilo/prism-observability/README.md`, `node_modules/@arnilo/prism-evals/README.md`.
