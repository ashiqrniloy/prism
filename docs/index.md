# Prism Docs

Prism is a TypeScript agent SDK for the Bun runtime. `@arnilo/prism` is a small kernel (agent, session, loop, hooks, slots, and packages); every capability is a native package a host lists in `createAgent({ packages })`. Start with the [README](../README.md).

## Current line (0.13.0)

The kernel pages and package READMEs below describe the 0.13.0 contract. The current **0.13.0** line is the root `@arnilo/prism` kernel and every native package.

## Kernel

- [Agent](agent.md): `createAgent`, sessions, runs, `RunResult`, the principal contract, and the frozen agent surface.
- [Agent adapters](agent-adapters.md): Mapping a vendor coding agent onto the driver contract, with worked adapters and the terms-of-use caveats.
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

- [`@arnilo/prism-provider-commandcode`](../packages/providers/commandcode/README.md): Command Code Provider API (Chat, Responses, Messages) for Prism.
- [`@arnilo/prism-provider-kilo`](../packages/providers/kilo/README.md): Kilo AI Gateway (Chat, Responses, Messages) with API-key and device login.
- [`@arnilo/prism-provider-litellm`](../packages/providers/litellm/README.md): any model behind a LiteLLM Proxy, with per-call LiteLLM telemetry and spend-log reconciliation.
- [`@arnilo/prism-provider-hyper`](../packages/providers/hyper/README.md): Charm Hyper provider package for Prism.
- [`@arnilo/prism-provider-laya`](../packages/providers/laya/README.md): Laya provider package for Prism.
- [`@arnilo/prism-provider-liquid`](../packages/providers/liquid/README.md): Liquid provider package for Prism.
- [`@arnilo/prism-provider-openai-codex`](../packages/providers/openai-codex/README.md): OpenAI models on a ChatGPT plan via Sign in with ChatGPT.
- [`@arnilo/prism-provider-opencode-go`](../packages/providers/opencode-go/README.md): OpenCode Go provider package for Prism.
- [`@arnilo/prism-provider-openrouter`](../packages/providers/openrouter/README.md): OpenRouter provider package for Prism.
- [`@arnilo/prism-provider-typesafe`](../packages/providers/typesafe/README.md): TypeSafe Jev provider package for Prism.

### Tools

- [`@arnilo/prism-tools-browser`](../packages/tools/browser/README.md): First-party browser automation tools for Prism.
- [`@arnilo/prism-tools-coding`](../packages/tools/coding/README.md): First-party coding tools for Prism.
- [`@arnilo/prism-tools-computer-use`](../packages/tools/computer-use/README.md): First-party Linux desktop tools for Prism.
- [`@arnilo/prism-tools-openapi`](../packages/tools/openapi/README.md): First-party OpenAPI tools for Prism.
- [`@arnilo/prism-tools-research`](../packages/tools/research/README.md): Research skills, a per-session source ledger, a read-only cite tool, and a bounded run.end citation check.
- [`@arnilo/prism-tools-web`](../packages/tools/web/README.md): First-party web search and fetch tools for Prism — keyless native fetch by default, plus Brave, Exa, Firecrawl, Obscura, SearXNG, Tavily, and Kagi backends.
- [`@arnilo/prism-tools-work`](../packages/tools/work/README.md): First-party work tools for Prism.

### Memory and context

- [`@arnilo/prism-memory-compaction`](../packages/memory/compaction/README.md): LLM summarization compaction for Prism.
- [`@arnilo/prism-memory-core`](../packages/memory/core/README.md): Shared memory contracts, stores, lineage, propagation, and scoring used by the Prism memory packages.
- [`@arnilo/prism-memory-fabric`](../packages/memory/fabric/README.md): Working, semantic, and scoped memory for Prism agents.
- [`@arnilo/prism-memory-observational`](../packages/memory/observational/README.md): Observational memory for Prism.
- [`@arnilo/prism-memory-rag`](../packages/memory/rag/README.md): Retrieval-augmented generation for Prism agents.
- [`@arnilo/prism-memory-wiki`](../packages/memory/wiki/README.md): The LLM Wiki knowledge compiler for Prism agents.
- [`@arnilo/prism-context-engineering`](../packages/context/engineering/README.md): Context engineering for Prism agents.
- [`@arnilo/prism-context-files`](../packages/context/files/README.md): AGENTS.md and SYSTEM.md context layers for Prism agents, trust-gated and cached per session.

### Stores

- [`@arnilo/prism-store-codecs`](../packages/stores/codecs/README.md): Row codecs, cursors, ownership-scope helpers, and SQL query semantics shared by the Prism SQL session-store adapters.
- [`@arnilo/prism-store-jsonl`](../packages/stores/jsonl/README.md): One JSONL file per session under a directory, as a durable single-process session store for Prism agents.
- [`@arnilo/prism-store-postgres`](../packages/stores/postgres/README.md): The PostgreSQL session store (leases, lifecycle, event source, and schema migrations included) as the Prism store slot, over `pg`.
- [`@arnilo/prism-store-sqlite`](../packages/stores/sqlite/README.md): The SQLite session store (leases, lifecycle, and schema migrations included) as the Prism store slot, over bun:sqlite.

### Policy and credentials

- [`@arnilo/prism-approval`](../packages/policy/approval/README.md): Approval modes over tool effects and roots, as one tool.call gate.
- [`@arnilo/prism-governance`](../packages/policy/governance/README.md): Policy engine, OPA adapter, approvals, and audit ledger as one tool.call/run.input/model.request gate.
- [`@arnilo/prism-guardrail-packs`](../packages/policy/guardrail-packs/README.md): Built-in guardrail packs.
- [`@arnilo/prism-model-router`](../packages/policy/model-router/README.md): Native model router package.
- [`@arnilo/prism-credentials-keyring`](../packages/credentials/keyring/README.md): Credentials slot package for Prism.

### Integrations

- [`@arnilo/prism-delegate`](../packages/integrations/delegate/README.md): Sub-agents as a tool.
- [`@arnilo/prism-advisor`](../packages/integrations/advisor/README.md): A second model's advice, and completion validation by a model or a delegate child.
- [`@arnilo/prism-hooks-json`](../packages/integrations/hooks-json/README.md): Claude/Codex hooks.json compiled onto Prism hooks.
- [`@arnilo/prism-mcp`](../packages/integrations/mcp/README.md): Bounded MCP tools, resources, prompts, client callbacks, and authorized Streamable HTTP sessions.
- [`@arnilo/prism-observability`](../packages/integrations/observability/README.md): OpenTelemetry spans and metrics over the Prism agent event catalog.
- [`@arnilo/prism-workflows`](../packages/integrations/workflows/README.md): Typed graph workflows (DAG and cyclic) that orchestrate any set of agents from outside their sessions.

### Drivers

- [`@arnilo/prism-driver-process`](../packages/drivers/process/README.md): Generic process driver and adapter contract for external agents.

## Host libraries

Host libraries serve or drive an agent from outside; they are not loaded as packages.

- [`@arnilo/prism-acp`](../packages/hosts/acp/README.md): Host library serving one Prism agent over the Agent Client Protocol.
- [`@arnilo/prism-ag-ui`](../packages/hosts/ag-ui/README.md): Host library serving a Prism Agent over AG-UI SSE, with protocol adapters and a reference renderer.
- [`@arnilo/prism-channels`](../packages/hosts/channels/README.md): Host library serving one Prism agent over Telegram and Signal messaging channels.
- [`@arnilo/prism-devtools`](../packages/hosts/devtools/README.md): Host library serving a loopback developer inspector over a Prism agent.
- [`@arnilo/prism-evals`](../packages/hosts/evals/README.md): Host library providing evaluations, datasets, scorers, judges, and multi-turn scenarios for Prism agents.
- [`@arnilo/prism-headless`](../packages/hosts/headless/README.md): Host library for routed Prism HostUi requests and durable agent/workflow scheduling.
- [`@arnilo/prism-mcp-server`](../packages/hosts/mcp-server/README.md): Host library serving a Prism agent over MCP stdio and Streamable HTTP transports.
- [`@arnilo/prism-remote`](../packages/hosts/remote/README.md): Host library serving a Prism agent to remote clients and connecting to remote agents over prism.remote/1.

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
- [Node filesystem config](node-filesystem-config.md): the Node filesystem config loader.
- [Run bundle](run-bundle.md): effective run bundle snapshots.

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

<!-- generated:package-truth:inventory begin -->
**50 publishable manifests** — root `@arnilo/prism` plus 49 workspace packages (1 `prism-*` family packages, 38 capability packages). Generated by `bun scripts/package-truth.mjs --emit-docs` — do not hand-edit.

| package | version | notes |
| --- | --- | --- |
| `@arnilo/prism` | 0.13.0 | core — runtime, CLI/RPC, templates, docs |
| `@arnilo/prism-channels` | 0.13.0 | family — transport-neutral messaging runtime, durable journal, pairing and one-use approvals; official /telegram (private DMs, opt-in granted groups/topics) and experimental pinned signal-cli /signal |
| `@arnilo/prism-acp` | 0.13.0 | capability |
| `@arnilo/prism-advisor` | 0.13.0 | capability — a second model's advice as one advise tool and opt-in review consults, plus completion validation by a model or a hidden delegate child |
| `@arnilo/prism-ag-ui` | 0.13.0 | capability — AG-UI/A2A/A2UI adapter |
| `@arnilo/prism-approval` | 0.13.0 | capability — approval modes deny/ask/edits/auto over tool effects and roots, as one tool.call gate |
| `@arnilo/prism-context-engineering` | 0.13.0 | capability — the input budget, tool-result folding, tool search, and the attention compiler as one fixed-order context.build handler |
| `@arnilo/prism-context-files` | 0.13.0 | capability — AGENTS.md / SYSTEM.md layers as one context.build handler, trust-gated and cached per session |
| `@arnilo/prism-credentials-keyring` | 0.13.0 | capability — credentials slot: OS keyring and encrypted-file backends, `keyring:` ref resolution, and secret/OAuth persistence |
| `@arnilo/prism-delegate` | 0.13.0 | capability — a delegate tool whose child agent inherits a chosen subset of the parent packages, reporting delegate.step package events |
| `@arnilo/prism-devtools` | 0.13.0 | capability |
| `@arnilo/prism-driver-process` | 0.13.0 | capability — generic external-agent process driver with a host-written adapter |
| `@arnilo/prism-evals` | 0.13.0 | capability |
| `@arnilo/prism-governance` | 0.13.0 | capability — deny-by-default policy engine (inline rules or OPA) plus approvals and an audit ledger, as one tool.call/run.input/model.request gate with a governance.policy/governance.audit service |
| `@arnilo/prism-guardrail-packs` | 0.13.0 | capability — built-in guardrail packs (coding-standard, destructive-commands, validation-respect, secrets-hygiene) as restrictive-only tool.call/tool.result rules with package session state |
| `@arnilo/prism-headless` | 0.13.0 | library — host library routing HostUi requests through ordered routes with a value-free answer log |
| `@arnilo/prism-hooks-json` | 0.13.0 | capability — Claude/Codex hooks.json compiled onto session.opened, context.build, run.input, tool.call, tool.result, and run.end |
| `@arnilo/prism-mcp` | 0.13.0 | capability — MCP client package: connects allowed servers, bridges their tools, and exposes mcp:status/reconnect/close |
| `@arnilo/prism-mcp-server` | 0.13.0 | library — host library serving Prism tools, resources, and prompts over MCP (stdio and Streamable HTTP transports) |
| `@arnilo/prism-memory-compaction` | 0.13.0 | capability |
| `@arnilo/prism-memory-core` | 0.13.0 | library — shared memory contracts, vector stores, lineage, propagation, and scoring; no slot and no capability |
| `@arnilo/prism-memory-fabric` | 0.13.0 | capability — working, semantic, and scoped memory with the memory.* tools, a context block, and per-session state |
| `@arnilo/prism-memory-observational` | 0.13.0 | capability |
| `@arnilo/prism-memory-rag` | 0.13.0 | capability — indexed retrieval with a rag_search tool, an opt-in context block, and the embeddings service |
| `@arnilo/prism-memory-wiki` | 0.13.0 | capability — the LLM Wiki knowledge compiler: four wiki tools, four commands, bundled skills, and the prism-wiki CLI |
| `@arnilo/prism-model-router` | 0.13.0 | capability — policy around hook routing turns across candidates with budget, circuit, and rate-limit controls |
| `@arnilo/prism-observability` | 0.13.0 | capability — OpenTelemetry spans and metrics over the agent event catalog as observe handlers; exports nothing itself |
| `@arnilo/prism-remote` | 0.13.0 | library — host library serving a Prism agent to remote clients and connecting to remote agents over prism.remote/1 |
| `@arnilo/prism-store-codecs` | 0.13.0 | capability |
| `@arnilo/prism-store-jsonl` | 0.13.0 | capability |
| `@arnilo/prism-store-postgres` | 0.13.0 | capability |
| `@arnilo/prism-store-sqlite` | 0.13.0 | capability |
| `@arnilo/prism-tools-browser` | 0.13.0 | capability — six exclusive Playwright browser tools with declared effects, fail-closed egress policy, and artifact quarantine |
| `@arnilo/prism-tools-coding` | 0.13.0 | capability — coding file/search/shell tools as a package: a small tool set with declared effects, in-tool path containment, and an optional shell |
| `@arnilo/prism-tools-computer-use` | 0.13.0 | capability — the host-owned computer-use-linux MCP binary as tools with declared external effects, in-tool device admission, and a bundled skill |
| `@arnilo/prism-tools-openapi` | 0.13.0 | capability — compile allow-listed OpenAPI 3.1 operations into bounded tools with pinned origins, per-method effects, and ref-only header credentials |
| `@arnilo/prism-tools-research` | 0.13.0 | capability — research skills, a per-session source ledger, cite, and a bounded run.end citation check |
| `@arnilo/prism-tools-web` | 0.13.0 | capability — keyless native fetch plus Brave/Exa/SearXNG/Tavily/Kagi search, Firecrawl fetch/extract, and host-installed Obscura, with a host domain policy, an optional per-session cache, and a web.fetch service |
| `@arnilo/prism-tools-work` | 0.13.0 | capability — /connectors, /documents, /sheets, /diagrams, /document-extraction, /document-reader, /sandbox, /skills, /tools subpaths |
| `@arnilo/prism-workflows` | 0.13.0 | library — typed graph workflows (DAG and cyclic) that orchestrate any set of agents from outside their sessions: checkpoints, suspend/resume, replay, graph export, and the `checkpoints`/`leases` service contracts |
<!-- generated:package-truth:inventory end -->
