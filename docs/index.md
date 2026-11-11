# Prism Docs

Prism is a TypeScript agent SDK for the Bun runtime. `@arnilo/prism` is a small kernel (agent, session, loop, hooks, slots, and packages); every capability is a native package a host lists in `createAgent({ packages })`. Start with the [README](../README.md).

## Current line (0.13.0)

The kernel pages and package READMEs below describe the 0.13.0 contract. The current **0.13.0** line is the root `@arnilo/prism` kernel and every native package.

## Kernel

- [Agent](agent.md): `createAgent`, sessions, runs, `RunResult`, the principal contract, and the frozen agent surface.
- [Agent adapters](agent-adapters.md): Mapping a vendor coding agent onto the driver contract, with worked adapters and the terms-of-use caveats.
- [Compatibility](compatibility.md): What stays stable across releases and how hosts, packages, and stores stay compatible with later minors.
- [Decisions](decisions.md): Typed decision calls: `models.decisions()`, question and answer shapes, bounds, and provider adapters.
- [Driver kit](drivers.md): The driver kit: how an external-agent package fills the loop slot, gates vendor calls through `run.ask`, and bridges tools.
- [Events](events.md): The dotted `AgentEvent` catalog: every event name, its payload, and when it fires.
- [Hooks](hooks.md): The hook model: observe, transform, decide, and around hooks, the full catalog, ordering, and error policy.
- [Host port](host.md): `HostPort` and `HostUi`: how a host answers asks, secrets, and logs, and how a run suspends without one.
- [Loop](loop.md): The loop slot, `RunController` primitives, `defaultLoop`, suspend and resume, and writing a custom loop.
- [Manifest](manifest.md): `@arnilo/prism/manifest`: the package manifest format, scopes, merge, install, remove, integrity, and project trust.
- [Models](models.md): `ModelRef`, the provider registry, the built-in provider, model resolution, and credentials refs.
- [Packages](packages.md): `definePackage` and `PackageAPI`: loading, `requires`, config, contributions, state, services, and `disable`.
- [Provider kit](provider-kit.md): `@arnilo/prism/provider-kit`: building a provider, request policies, structured output, thinking, and conformance.
- [Release and provenance](release.md): The Bun-only release pipeline, gates, attestation, and how a consumer verifies a published package.
- [Slots](slots.md): The four slots (loop, compaction, store, credentials), their contracts, and the kernel defaults.
- [Testing](testing.md): `@arnilo/prism/testing`: the mock provider, scripted host, and package and loop conformance helpers.
- [Tools](tools.md): Tool registration, effects annotations, allow/deny filtering, per-run narrowing, and bounded results.

## Packages

Each native package documents itself in its README; the kernel pages above cover the contracts they build on.

### Providers

- [`@arnilo/prism-ai/commandcode`](../packages/providers/commandcode/README.md): Command Code Provider API (Chat, Responses, Messages) for Prism.
- [`@arnilo/prism-ai/kilo`](../packages/providers/kilo/README.md): Kilo AI Gateway (Chat, Responses, Messages) with API-key and device login.
- [`@arnilo/prism-ai/litellm`](../packages/providers/litellm/README.md): any model behind a LiteLLM Proxy, with per-call LiteLLM telemetry and spend-log reconciliation.
- [`@arnilo/prism-ai/hyper`](../packages/providers/hyper/README.md): Charm Hyper provider package for Prism.
- [`@arnilo/prism-ai/laya`](../packages/providers/laya/README.md): Laya provider package for Prism.
- [`@arnilo/prism-ai/liquid`](../packages/providers/liquid/README.md): Liquid provider package for Prism.
- [`@arnilo/prism-ai/openai-codex`](../packages/providers/openai-codex/README.md): OpenAI models on a ChatGPT plan via Sign in with ChatGPT.
- [`@arnilo/prism-ai/ollama-cloud`](../packages/providers/ollama-cloud/README.md): Ollama Cloud hosted models (native NDJSON and OpenAI-compatible routes) for Prism.
- [`@arnilo/prism-ai/opencode-go`](../packages/providers/opencode-go/README.md): OpenCode Go provider package for Prism.
- [`@arnilo/prism-ai/openrouter`](../packages/providers/openrouter/README.md): OpenRouter provider package for Prism.
- [`@arnilo/prism-ai/typesafe`](../packages/providers/typesafe/README.md): TypeSafe Jev provider package for Prism.

### Tools

- [`@arnilo/prism-tools`](../packages/tools/README.md): Coding, web, browser, research, OpenAPI, desktop and work subpaths.
- [`@arnilo/prism-tools/browser`](../packages/tools/browser/README.md): First-party browser automation tools for Prism.
- [`@arnilo/prism-tools/coding`](../packages/tools/coding/README.md): First-party coding tools for Prism.
- [`@arnilo/prism-tools/computer-use`](../packages/tools/computer-use/README.md): First-party Linux desktop tools for Prism.
- [`@arnilo/prism-tools/openapi`](../packages/tools/openapi/README.md): First-party OpenAPI tools for Prism.
- [`@arnilo/prism-tools/research`](../packages/tools/research/README.md): Research skills, a per-session source ledger, a read-only cite tool, and a bounded run.end citation check.
- [`@arnilo/prism-tools/web`](../packages/tools/web/README.md): First-party web search and fetch tools for Prism — keyless native fetch by default, plus Brave, Exa, Firecrawl, Obscura, SearXNG, Tavily, and Kagi backends.
- [`@arnilo/prism-tools/work`](../packages/tools/work/README.md): First-party work tools for Prism.

### Memory and context

- [`@arnilo/prism-extensions/compaction`](../packages/extensions/compaction/README.md): LLM summarization compaction for Prism.
- [Memory bundle](../packages/memory/README.md) and [knowledge bundle](../packages/knowledge/README.md): experimental entrypoints and installation.
- [`@arnilo/prism-memory-system/core`](../packages/memory/core/README.md) (experimental): Shared memory contracts, stores, lineage, propagation, and scoring used by the Prism memory packages.
- [`@arnilo/prism-memory-system`](../packages/memory/system/README.md) (experimental): the memory system (STM → WM → rehearsal → LTM, plus sleep): session tiers that observe the session, keep a source-backed ledger, and compact from it, and long-term memory (`ltm`), the store of record behind the `memory.*` tools.
- [`@arnilo/prism-knowledge`](../packages/knowledge/README.md) (experimental): Wiki and RAG subpaths, with an exact memory-system dependency.
- [`@arnilo/prism-knowledge/rag`](../packages/knowledge/rag/README.md) (experimental): Retrieval-augmented generation for Prism agents.
- [`@arnilo/prism-knowledge/wiki`](../packages/knowledge/wiki/README.md) (experimental): The wiki, knowledge outside memory, opt-in and unmeasured: concepts and sources in its own store, consolidated from cited evidence, reading memory read-only.
- [`@arnilo/prism-extensions/context-engineering`](../packages/extensions/context-engineering/README.md): Context engineering for Prism agents.
- [`@arnilo/prism-extensions/context-files`](../packages/extensions/context-files/README.md): AGENTS.md and SYSTEM.md context layers for Prism agents, trust-gated and cached per session.

### Stores

- [`@arnilo/prism-extensions/store-codecs`](../packages/extensions/store-codecs/README.md): Row codecs, cursors, ownership-scope helpers, and SQL query semantics shared by the Prism SQL session-store adapters.
- [`@arnilo/prism-extensions/store-jsonl`](../packages/extensions/store-jsonl/README.md): One JSONL file per session under a directory, as a durable single-process session store for Prism agents.
- [`@arnilo/prism-extensions/store-postgres`](../packages/extensions/store-postgres/README.md): The PostgreSQL session store (leases, lifecycle, event source, and schema migrations included) as the Prism store slot, over `pg`.
- [`@arnilo/prism-extensions/store-sqlite`](../packages/extensions/store-sqlite/README.md): The SQLite session store (leases, lifecycle, and schema migrations included) as the Prism store slot, over bun:sqlite.

### Policy and credentials

- [`@arnilo/prism-extensions/approval`](../packages/extensions/approval/README.md): Approval modes over tool effects and roots, as one tool.call gate.
- [`@arnilo/prism-extensions/governance`](../packages/extensions/governance/README.md): Policy engine, OPA adapter, approvals, and audit ledger as one tool.call/run.input/model.request gate.
- [`@arnilo/prism-extensions/guardrail-packs`](../packages/extensions/guardrail-packs/README.md): Built-in guardrail packs.
- [`@arnilo/prism-extensions/model-router`](../packages/extensions/model-router/README.md): Native model router package.
- [`@arnilo/prism-extensions/keyring`](../packages/extensions/keyring/README.md): Credentials slot package for Prism.

### Integrations

- [`@arnilo/prism-extensions/delegate`](../packages/extensions/delegate/README.md): Sub-agents as a tool.
- [`@arnilo/prism-extensions/advisor`](../packages/extensions/advisor/README.md): A second model's advice, and completion validation by a model or a delegate child.
- [`@arnilo/prism-extensions/hooks-json`](../packages/extensions/hooks-json/README.md): Claude/Codex hooks.json compiled onto Prism hooks.
- [`@arnilo/prism-extensions/mcp`](../packages/extensions/mcp/README.md): Bounded MCP tools, resources, prompts, client callbacks, and authorized Streamable HTTP sessions.
- [`@arnilo/prism-extensions/observability`](../packages/extensions/observability/README.md): OpenTelemetry spans and metrics over the Prism agent event catalog.
- [`@arnilo/prism-extensions/workflows`](../packages/extensions/workflows/README.md): Typed graph workflows (DAG and cyclic) that orchestrate any set of agents from outside their sessions.

### Drivers

- [`@arnilo/prism-hosts/driver-process`](../packages/hosts/driver-process/README.md): Generic process driver and adapter contract for external agents.

## Host libraries

Host libraries serve or drive an agent from outside; they are not loaded as packages.

- [`@arnilo/prism-hosts/acp`](../packages/hosts/acp/README.md): Host library serving one Prism agent over the Agent Client Protocol.
- [`@arnilo/prism-hosts/ag-ui`](../packages/hosts/ag-ui/README.md): Host library serving a Prism Agent over AG-UI SSE, with protocol adapters and a reference renderer.
- [`@arnilo/prism-hosts/channels`](../packages/hosts/channels/README.md): Host library serving one Prism agent over Telegram and Signal messaging channels.
- [`@arnilo/prism-hosts/devtools`](../packages/hosts/devtools/README.md): Host library serving a loopback developer inspector over a Prism agent.
- [`@arnilo/prism-hosts/evals`](../packages/hosts/evals/README.md): Host library providing evaluations, datasets, scorers, judges, and multi-turn scenarios for Prism agents.
- [`@arnilo/prism-hosts/headless`](../packages/hosts/headless/README.md): Host library for routed Prism HostUi requests and durable agent/workflow scheduling.
- [`@arnilo/prism-hosts/host-builder`](../packages/hosts/host-builder/README.md): Skill, MCP server, and installer that help coding agents build and change Prism hosts against the installed version.
- [`@arnilo/prism-hosts/mcp-server`](../packages/hosts/mcp-server/README.md): Host library serving a Prism agent over MCP stdio and Streamable HTTP transports.
- [`@arnilo/prism-hosts/remote`](../packages/hosts/remote/README.md): Host library serving a Prism agent to remote clients and connecting to remote agents over prism.remote/1.

## Guides

- [Prism Agent walkthrough](../apps/prism-agent/README.md): the reference host, built only on `@arnilo/prism` and the manifest.
- [Examples gallery](../examples/README.md): runnable examples of hosts, packages, and workflows.
- [Migrations](migration.md): the era index of migration notes with replacement tables and rollback notes.
- [Migrate 0.12 → 0.13](migrate-to-0.13.md): what moved where in the 0.13 kernel and packages — the `createAgent` and `defineAgent` maps, the family-package map, the removed root exports, and the upgrade steps.

## Reference

- [Optional peer dependencies](peer-dependencies.md): every third-party peer a package declares, the subpath it unlocks, its install line, pin rationale, and which peers touch the network.
- [Performance limits](performance.md): measured limits, hard caps, and sizing guidance.
- [Operations runbook](operations.md): high availability, failover, and fencing for durable state.
- [Disaster recovery](disaster-recovery.md): backup and restore operations.
- [Resource loading](resource-loading.md): trust-gated loading of skills, prompts, and other file resources.

## Security and credentials

- [Host security guide](host-security.md): fail-closed checklist across supply chain, boundaries, redaction, trust, persistence.
- [Security/auth/trust](settings-auth-trust-security.md): settings providers, trust/permission policies, host-owned wiring.
- [Credentials and redaction](credentials-and-redaction.md): resolver order, env/OAuth helpers, provider-edge resolution, secret redaction.
- [Coding security](coding-security.md): coding-tool security model and the package that owns it.

## Testing and contributing

- [Contribution quality budgets](contributing.md): the non-null assertion allowance, export-surface ceilings, and the rule that keeps them shrinking.
- [Live and end-to-end testing](live-testing.md): opt-in live matrix with skip-not-fail contract and credential scoping table.
- [Free models through LiteLLM](free-models.md): generated, dated list of the free models each configured provider's own catalogue offers, with the pool group that already reaches it.

## History

- [Migrate 0.11 → 0.12](history/migrate-to-0.12.0.md): Bun `>=1.4.2`, `bun:sqlite`, and optional local document extraction.
- [Migrate 0.10 → 0.11](migrate-to-0.11.md): idempotency window, in-memory lease fence reset, and the persona/graft subpath removals.
- [Migrate 0.8 → 0.9](migrate-to-0.9.md): the four behavior deltas inside existing surfaces (limit-death stream order, turn-trace metadata, cache-stable disclosure, labeled usage estimates), every new option with its sizing line, and 0.9.0 host migration steps.
- [Migrate 0.7 → 0.8](migrate-to-0.8.md): work-family import map, messaging channels, connected apps, durable runs, and 0.8.0 host migration steps.
- [Migrate 0.6 → 0.7](migrate-to-0.7.md): ACP MCP allow-list URL normalization, model router facade fail-closed governance, and 0.7.0 host migration steps.
- [Migrate 0.5 → 0.6](migrate-to-0.6.md): Node 22 floor, folded 0.5.7 host delta, third-party floors, and upgrade/rollback steps.
- [Migrate 0.5](migrate-to-0.5.md): 0.4 → 0.5 migration guide with per-release sections and rollback.
- [Documentation archive](history/README.md): frozen migration/history records — not read on the hot path.
- [Review coverage archive](_evidence/): per-phase evidence freezes — audit trail, excluded from tarballs.

## Package inventory

The generated inventory below derives from [`scripts/package-truth.json`](../scripts/package-truth.json) — regenerate with `bun scripts/package-truth.mjs --emit-docs`, never hand-edit.

- [Providers bundle](../packages/providers/README.md) — install `@arnilo/prism-ai`; import each provider through its subpath.

<!-- generated:package-truth:inventory begin -->
**7 publishable manifests** — root `@arnilo/prism` plus 6 workspace packages (0 `prism-*` family packages, 6 capability packages). Generated by `bun scripts/package-truth.mjs --emit-docs` — do not hand-edit.

| package | version | notes |
| --- | --- | --- |
| `@arnilo/prism` | 0.13.0 | core — runtime, CLI/RPC, templates, docs |
| `@arnilo/prism-ai` | 0.13.0 | capability |
| `@arnilo/prism-extensions` | 0.13.0 | capability |
| `@arnilo/prism-hosts` | 0.13.0 | library bundle — host protocols, channels, evaluations, devtools, headless routing, process driver and version-exact host-builder kit |
| `@arnilo/prism-knowledge` | 0.13.0-experimental.0 | capability — experimental knowledge bundle: wiki and RAG subpaths; exact memory-system pin |
| `@arnilo/prism-memory-system` | 0.13.0-experimental.0 | capability — the memory system: session tiers (STM, WM, rehearsal) that observe the session, keep a source-backed ledger, and compact from it, plus long-term memory (ltm), the store of record behind the memory.* tools |
| `@arnilo/prism-tools` | 0.13.0 | capability |
<!-- generated:package-truth:inventory end -->

- [Extensions bundle](../packages/extensions/README.md): context, credentials, integrations, policy and stores.

Host libraries ship together in [`@arnilo/prism-hosts`](../packages/hosts/README.md), in lockstep with the kernel.
