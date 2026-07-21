# prism examples

Compile-checked typed examples and runnable end-to-end mock demos. No network,
no real credentials — every demo uses the built-in `mock` provider or a fake key.

## Typecheck

Examples are part of `npm run typecheck` (separate `examples/tsconfig.json`,
`noEmit`, strict). They typecheck against package source, so no workspace
build is required to typecheck.

## Run a demo by hand

Node 24 strips TypeScript types natively, so after building the core package
once (`npm run build:core`) you can run any demo directly:

```bash
npm run build:core
node examples/compaction.ts
node examples/cli.ts
node examples/rpc.ts
node examples/provider-registration.ts
node examples/provider-resolver.ts
node examples/cache-aware-prompt-assembly.ts
node examples/neuralwatt-agent-run.ts
node examples/observational-memory-recall-status-view.ts
node examples/external-app-db-backed.ts
node examples/minimal-host-app.ts
node examples/custom-builders.ts
node examples/custom-session-store.ts
node examples/custom-tools-skills-context.ts
node examples/extension-package.ts
node examples/evals.ts
node examples/evaluation-gate.ts
node examples/coding-browser-evaluation.ts
node examples/web-research.ts
node examples/run-feedback.ts
node examples/supervisor-a2a.ts
node examples/ai-sdk-provider.ts
node examples/working-semantic-memory.ts
node examples/rag.ts
node examples/web-standard-server.ts
node examples/mcp-server.ts
node examples/workflow-research-and-review.ts
node examples/workflow-multimodal-document.ts
node examples/workflow-postgres-resume.ts # skips unless PRISM_TEST_POSTGRES_URL is set
node examples/workflow-distributed-coordinator.ts
node examples/workflow-schedules-replay.ts
node examples/durable-coding-workflow.ts
node examples/agent-durable-approval.ts
node examples/secure-agent.ts
```

Each demo prints a single JSON line with its result.

## Files

- `sdk-basics.ts` — createAgent / createAgentSession / mock provider.
- `secure-agent.ts` — opt-in fail-closed agent composition with validation, trust/permission, redaction, limits, ownership, and durable approval.
- `agent-durable-approval.ts` — suspend before a tool side effect, then resume once with durable CAS approval.
- `evals.ts` — deterministic scorers, dataset snapshot, and bounded `runExperiment` over mock agent results.
- `evaluation-gate.ts` — network-free experiment threshold that exits non-zero on regression.
- `coding-browser-evaluation.ts` — network-free coding/browser adversarial dataset + scorers + CI threshold (no Docker/Playwright binary).
- `web-research.ts` — network-free host-selected Brave search → Firecrawl Markdown route with fake fetch, stable citation, untrusted marker, and fixed host extraction schema.
- `run-feedback.ts` — immutable owned run feedback linked to an evaluation, bounded query, and safe low-cardinality OpenTelemetry projection.
- `supervisor-a2a.ts` — bounded allow-listed local child delegation plus an offline A2A 1.0 handler/client round trip.
- `ai-sdk-provider.ts` — optional AI SDK `LanguageModelV4` adapter demo with a fake in-memory model.
- `working-semantic-memory.ts` — optional working memory + semantic recall with hash embedder, context injection, and processor update.
- `rag.ts` — optional bounded Markdown chunk/index/retrieve/citation flow using Phase 7 in-memory vector primitives.
- `web-standard-server.ts` — optional framework-free authorized `Request -> Response` agent run using the offline mock provider.
- `mcp-server.ts` — explicit authorized Prism tool exposure through SDK `McpServer` and linked in-memory transport.
- `minimal-host-app.ts` — **demo**: canonical minimal host embed; stream events while a prompt runs via concurrent `Promise.all([drain, session.run])`.
- `custom-builders.ts` — **demo**: replace the default InputBuilder and PromptBuilder to control input wrapping and final message ordering.
- `custom-session-store.ts` — **demo**: implement the `SessionStore` contract (append + list) and pass it to `createAgentSession`; observe the entry kinds the runtime appends.
- `custom-tools-skills-context.ts` — **demo**: host-owned tool + skill + context provider in one agent, with a tool-call loop (no filesystem/shell/browser coding tools).
- `extension-package.ts` — **demo**: bundle a tool, skill, and context provider into one `Extension`, load it through the kernel, and build an agent from the inert registries.
- `provider-registration.ts` — **demo**: register a provider package via the
  extension kernel; resolve providers/models from host-owned registries.
- `provider-resolver.ts` — **demo**: resolve an agent's provider from a mix of
  first-party package providers and a third-party own provider via `providerSource`.
- `api-key-auth.ts` — env + memory credential resolvers in host-defined order.
- `oauth-login.ts` — PKCE OAuth login against a token endpoint (fake host).
- `openrouter-model-cache-override.ts` — per-model routing/cache overrides.
- `cache-aware-prompt-assembly.ts` — **demo**: cache-aware stable-prefix assembly and hit-rate reporting across OpenRouter explicit cache hints and NeuralWatt implicit prefix caching, using mocked SSE responses.
- `neuralwatt-agent-run.ts` — **demo**: NeuralWatt agent run with tools, reasoning controls, streamed usage cache tokens, and mocked energy/cost telemetry.
- `tools.ts` — host-owned tool registry: allow/deny filter + dispatch.
- `context.ts` — ordered context-provider pipeline.
- `skills.ts` — skill registry + progressive disclosure activation.
- `extensions.ts` — extension kernel + event bus.
- `manifests.ts` — data-only Prism manifest: define + parse.
- `config-settings.ts` — layered config merge + settings providers.
- `system-prompts.ts` — layered system-prompt composition; disabling layers.
- `system-project-prompts.ts` — **demo**: auto-load `AGENTS.md`/`SYSTEM.md` via
  `loadSystemPromptFiles` (trust-gated) and prove the composed prompt reaches the provider.
- `discover-skills.ts` — compile-checked opt-in contribution discovery and registration.
- `instruction-injection.ts` — compile-checked host-selected instruction injector wiring.
- `jsonl-stores-branching.ts` — in-memory store + branching; JSONL persistence.
- `compaction.ts` — **demo**: LLM compaction with a mock summarizer provider.
- `observational-memory-recall-status-view.ts` — **demo**: recall tool +
  status/view commands; recall fails closed on invalid ids.
- `synapta-style-artifact-loop.ts` — **demo**: third-party host mixing first-party
  and own providers/tools/skills, `AGENTS.md`/`SYSTEM.md` system prompts, and the
  `generate-validate-revise` artifact loop with host-owned schema validation.
- `external-app-db-backed.ts` — **demo**: end-to-end external app with a DB-backed
  adapter reference mock (`SessionStore` + `RunLedger` + `ProductionPersistenceStore`
  reads), `assertSessionStoreConforms(..., { exerciseReadBranchPath: true })`,
  explicit tools/skills, branch-handle checkout + fork, and prior-run timeline
  resume from the ledger — no real DB, no network.
- `cli.ts` — **demo**: spawn the `prism` bin in print and json modes.
- `rpc.ts` — **demo**: drive the `prism` bin in rpc mode with a JSONL request.
- `workflow-research-and-review.ts` — **demo**: three sequential agent nodes (research → draft → review) with in-memory checkpoints and redaction.
- `workflow-parallel-research.ts` — **demo**: bounded fan-out/join plus three concurrently scheduled research branches and downstream agent synthesis.
- `workflow-tool-approval.ts` — **demo**: offline MCP-mapped tool node with `ExecutionPolicy` approval carrying `workflowId`/`nodeId` metadata.
- `workflow-sqlite-resume.ts` — **demo**: durable SQLite checkpoint via `persistence.checkpoints`, fresh run, and resume on a temp database.
- `workflow-postgres-resume.ts` — **demo**: opt-in PostgreSQL failed-run resume through a new pool; safely skips unless `PRISM_TEST_POSTGRES_URL` is set.
- `workflow-multimodal-document.ts` — **demo**: bounded inline PDF workflow with caller-supplied credential resolver and secret redaction.
- `workflow-event-sink.ts` — **demo**: `onEvent` callback + `WorkflowEventBus` subscriber collecting events through a conditional-skip path.
- `workflow-rpc-cancel.ts` — **demo**: `cancelWorkflowRun` mid-flight then `resumeWorkflow` — the programmatic surface behind `createWorkflowCommands()`.
- `workflow-distributed-coordinator.ts` — **demo**: two coordinator instances over independent SQLite handles atomically claim one queued run using durable leases and fencing.
- `workflow-schedules-replay.ts` — **demo**: ownership-scoped one-time schedule → existing coordinator background run → nested shared-state workflow → immutable-lineage replay.
- `durable-coding-workflow.ts` — **demo**: durable coding plan/todos as workspace Markdown, workflow `state.coding` checkpoint metadata, approval suspend/resume with fingerprint/hash revalidation, background cancel, and host-owned PR handoff (no network).
- `tsconfig.json` — typecheck-only config.

**demo** = the file has a runnable `main()`; the others are compile-checked
illustrations only.
