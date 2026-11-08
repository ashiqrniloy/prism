# prism examples

Compile-checked typed examples and runnable end-to-end mock demos. No network,
no real credentials — every demo uses the built-in `mock` provider or a fake key.

## Typecheck

Examples are part of `bun run typecheck` (separate `examples/tsconfig.json`,
`noEmit`, strict). They typecheck against package source, so no workspace
build is required to typecheck.

## Start here

Host and package examples come first. Each runs offline on the mock provider.

- [`sdk-basics.ts`](sdk-basics.ts): `createAgent({ packages })`, `agent.session()`, the mock provider.
- [`define-package.ts`](define-package.ts): two `definePackage` packages on one agent.
- [`custom-loop.ts`](custom-loop.ts): a `LoopStrategy` through `slots.loop`.
- [`manifest.ts`](manifest.ts): install a package, `loadManifest`, disable and reload.
- [`headless-host.ts`](headless-host.ts): a headless host with approval suspend and resume.
- [`external-agent.ts`](external-agent.ts) and [`custom-adapter.ts`](custom-adapter.ts): drive an external agent through `@arnilo/prism/driver-kit`.
- [`build-workflow.ts`](build-workflow.ts): the `/build` orchestration over external agents, offline. The execution gate runs it.
- Host libraries: [`acp.ts`](acp.ts), [`ag-ui-server.ts`](ag-ui-server.ts), [`mcp-server.ts`](mcp-server.ts), [`remote-agent.ts`](remote-agent.ts).

Examples import only `@arnilo/prism`, its public subpaths, and published packages
(`examples/adapters/` is host code on `prism-driver-process`).

## Execution gate

`bun run test` runs `scripts/examples-execution.test.mjs`. It does not respawn an
example already executed by the `docs.test.ts` demo list or by a dedicated
`spawnSync(process.execPath, ["examples/<file>.ts"])` test. Every other
`examples/*.ts` must exit 0 within 60s, or be named in
`scripts/examples-manifest.json` with reason `env-gated`, `network`,
`interactive`, `long-running`, or `known-broken:<ref>`. A new file in none of
those buckets fails until triaged. The gate adds no credentials (`NODE_ENV=test`
at most). Exit 0 is the assertion; output is not parsed.

## Run a demo by hand

Node 24 strips TypeScript types natively, so after building the core package
once (`npm run build:core`) you can run any demo directly:

```bash
npm run build:core
node examples/compaction.ts
node examples/coding-compaction.ts
node examples/cli.ts
node examples/provider-registration.ts
node examples/provider-resolver.ts
node examples/cache-aware-prompt-assembly.ts
node examples/attention-compiler.ts
node examples/skills-progressive-disclosure.ts
node examples/package-skills.ts
node examples/caveman-ponytail.ts
node examples/hooks-json.ts
node examples/external-app-db-backed.ts
node examples/session-search.ts
node examples/minimal-host-app.ts
node examples/custom-builders.ts
node examples/custom-session-store.ts
node examples/custom-tools-skills-context.ts
node examples/define-package.ts
node examples/manifest.ts
node examples/evals.ts
node examples/evaluation-gate.ts
node examples/execution-timeline.ts
node examples/host-step-loop-timeline.ts
node examples/behavior-evaluation.ts
node examples/guardrail-packs.ts
node examples/governance-deny.ts
node examples/coding-browser-evaluation.ts
node examples/web-research.ts
node examples/run-feedback.ts
node examples/delegate.ts
node examples/advisor.ts
node examples/validator.ts
node examples/working-semantic-memory.ts
node examples/rag.ts
node examples/drive-rag-sync.ts
node examples/scanned-document-rag.ts
node examples/revocation-propagation.ts
node examples/mcp-server.ts
node examples/serve-tools.ts
node examples/acp.ts
node examples/connected-slack-mcp.ts
node examples/workflow-research-and-review.ts
node examples/workflow-multimodal-document.ts
node examples/workflow-postgres-resume.ts # skips unless PRISM_TEST_POSTGRES_URL is set
node examples/coding-goal-verify.ts
node examples/autonomous-coding-loop.ts
node examples/coding-tools-capability-gaps.ts
node examples/phase9-coding-intelligence.ts
node examples/agent-durable-approval.ts
node examples/durable-loops-and-approvals.ts
node examples/custom-loop.ts
node examples/define-package.ts
node examples/manifest.ts
node examples/session.ts
node examples/approval.ts
node examples/coding-approval.ts
node examples/sqlite-resume.ts
node examples/durable-approval.ts
node examples/host-hooks.ts
node examples/openai-compatible.ts # Bun-only (Bun.serve fake endpoint)
node examples/custom-provider.ts
node examples/side-call.ts
node examples/decision-models.ts
node examples/durable-investigation.ts
node examples/ag-ui-server.ts
node examples/ag-ui-a2ui.ts
node examples/ag-ui-mcp-apps.ts
node examples/secure-agent.ts
node examples/enterprise-identity.ts
node examples/enterprise-policy-audit.ts
node examples/enterprise-work-connectors.ts
node examples/docker-process-session.ts
node examples/hosted-sandbox.ts
```

Each demo prints a single JSON line with its result.

## Files

- `sdk-basics.ts` — createAgent / agent.session() / mock provider.
- `secure-agent.ts` — fail-closed agent composition with validation, trust, redaction, limits, ownership, and `@arnilo/prism-governance`'s `require: { principal, ownership }` (which replaced `createSecureAgent` in plan 159 Task 7).
- `enterprise-identity.ts` — **demo**: verified `AgentIdentity`, `narrowIdentity`, and propagation guards (network-free).
- `enterprise-policy-audit.ts` — **demo**: `@arnilo/prism-governance` evaluate → append → cursor export with fake identity.
- `enterprise-work-connectors.ts` — **demo**: fake M365/GWS CLI adapters, shared mail normalizers, and draft-gated work tools.
- `model-router.ts` — **demo**: `@arnilo/prism-model-router` native package over `model.call` with multi-candidate failover, `router.decision` package events, and `turn.completed` usage settlement (network-free).
- `model-router-aggregate-budgets.ts` — **demo**: one `taskId` aggregate token pool across three `session.run()` calls plus an auxiliary compaction call on a pinned model — atomic reservation, renewal fencing, and unknown-usage liability read via `router.readBudget` (network-free).
- `observability.ts` — **demo**: `@arnilo/prism-observability` over a host-registered `@opentelemetry/api` tracer provider; prints the `invoke_agent` > `chat` > `execute_tool` span tree for a mock run (network-free, the package exports nothing itself).
- `messaging-agent.ts` — **demo**: sqlite journal + mock agent through `createChannelRuntime`; admit → drain → persisted reply → opt-in `notify` notice to the bound pair, then stop (network-free).
- `telegram-agent.ts` — explicit host composition helper: polling via `startTelegramChannel`, webhook mount via `mountTelegramWebhook`; the caller supplies authorization, agent resolution, durable stores and Bot token source. `startTelegramChannel` wires the runtime's opt-in preview callback and media seam to the adapter, so `telegram.sendDrafts: true` is all a host needs for streaming drafts and `transcribe`/`extractDocumentText`/`maxAttachmentBytes` handle inbound voice and documents (override `runtime.onAssistantDelta`/`runtime.fetchAttachment` to compose your own).
- `signal-agent.ts` — explicit host composition helper for an externally supervised pinned signal-cli socket: the caller supplies authorization, agent resolution, durable stores, socket/account and the operator policy attestation; calling it subscribes.
- `docker-process-session.ts` — **demo**: long-running process management inside a Docker sandbox with durable recovery, attested reconnect, and fail-closed isolation.
- `hosted-sandbox.ts` — **demo**: fake E2B client through `createE2BSandbox` / `connectE2BSandbox` (filesystem-only pause, no auto-resume; network-free).
- `agent-durable-approval.ts` — suspend before a tool side effect, then resume once with durable CAS approval.
- `manifest.ts` — **demo**: `install` a `file:` fixture package, `loadManifest` it into an agent, `setEnabled(false)` and reload, then show a skipped untrusted project manifest, `configure` refusing a literal secret, and `integrity_mismatch` after one byte changes (`@arnilo/prism/manifest`, real `bun add`).
- `define-package.ts` — **demo**: two `definePackage` packages on one agent with no host wiring — a `tool.call` deny, an observer, a status note, a config schema with an `env:` secret ref, a per-session `when` tool, a command, `package_state` session state kept across a fork and a reopen, a tracked background task, then `agent.inspect()` (which shows the ref, never the value) and `dispose()` (network-free).
- `durable-loops-and-approvals.ts` — **demo**: durable custom-loop snapshot + parallel batch approvals (network-free).
- `session.ts` — **demo** (Phase 3): `agent.session()`, a streamed run, the `RunResult` status and the messages it appended, then the same session reopened by id through the `store` slot and listed through `agent.sessions` (imports only `@arnilo/prism` and `@arnilo/prism/testing`, network-free).
- `coding-approval.ts` — **demo**: `toolsCoding` + `approval` in `ask` mode + `contextFiles` on one agent (a scripted host answers, the file changes), then `disable: { tools: ["shell"] }` removes the shell and a scripted call is blocked as an unknown tool (network-free).
- `approval.ts` — **demo** (Phase 3): a tool gated by a host `tool.call` hook returning `{ ask }`, resolved inline by a scripted `HostUi`, then with no UI: the run suspends (`status: "suspended"`, `pending`) and a new agent over the same store finishes it with `agent.session({ id })` and `session.resume(decisions)` (network-free).
- `sqlite-resume.ts` — **demo** (Phase 6): a session survives a process restart on `sqliteStore({ path })` — process A runs two turns and bumps a counter kept in `prism.state.session`, then spawns process B, which reopens the session with `agent.session({ id })` and reads the same messages and counter; A asserts B's output (imports only `@arnilo/prism`, `@arnilo/prism/testing`, and `@arnilo/prism-store-sqlite`, network-free).
- `durable-approval.ts` — **demo** (Phase 6): a tool gated by an `ask` hook with no `host.ui` suspends into SQLite, process B reopens the session and calls `session.resume([{ approvalId, outcome: "allow_once" }])` (the id comes from `RunResult.pending` only), and the side effect happens only after the approval (network-free).
- `host-hooks.ts` — **demo** (Phase 3): host hooks as an inline package — a `tool.call` deny on `network` effects, a `turn.before` budget stop, a `disable` of one tool — and `agent.inspect().hooks` (network-free).
- `openai-compatible.ts` — **demo** (Phase 5): the kernel's built-in `openai-compatible` provider against a local `Bun.serve` fake endpoint that requires a bearer token; the `ModelSpec` object carries `baseUrl` and an `env:` credential ref, one streamed turn plus a second `RunResult`, and the endpoint asserting the token arrived (imports only `@arnilo/prism`, network-free).
- `custom-provider.ts` — **demo**: routed provider built with `createRoutedProvider` running offline against a recorded wire fixture via `replayFetch` (network-free).
- `side-call.ts` — **demo** (Phase 5): a `models`-capability package whose tool calls `prism.models.client("side/side")` mid-turn on two `mockProvider` packages, with the side provider called exactly once (imports only `@arnilo/prism` and `@arnilo/prism/testing`, network-free).
- `decision-models.ts` — **demo** (Phase 18): a `models`-capability package calls `prism.models.decisions()` from a `run.input` hook to route a ticket with `noul`/`choice`/`score` questions, prints the raw probabilities, and proves a model without `decisions` throws `DecisionsError("unsupported_model")` (imports only `@arnilo/prism` and `@arnilo/prism/testing`, network-free).
- `custom-loop.ts` — **demo**: plan-then-act `LoopStrategy` through `slots.loop` with a host `tool.call` gate denying a `network` tool, the denial reaching the model as a tool result (network-free).
- `durable-investigation.ts` — **demo**: `checkpointPolicy: "every-turn"` turn checkpoints, simulated worker death, and `decision: "continue"` crash recovery with no tool re-dispatch (network-free).
- `ag-ui-server.ts` — authorized Web `Request` → bounded AG-UI SSE run with a host-owned mock session.
- `ag-ui-a2ui.ts` — opt-in A2UI painting middleware: tool-result `a2ui_operations` → `a2ui-surface` ACTIVITY_SNAPSHOT.
- `ag-ui-mcp-apps.ts` — **demo**: authenticated single-bridge MCP Apps resource proxy plus separate-origin sandbox/CSP configuration (network-free).
- `evals.ts` — deterministic scorers, dataset snapshot, and bounded `runExperiment` over mock agent results.
- `eval-injection.ts` — **demo**: sandboxed prompt-injection suite with three rates and Wilson intervals; scripted model falls for one attack (network-free).
- `eval-judges.ts` — **demo**: reference rubric grading, distinct-model panel, five-item calibration, and position-swapped comparison with a Bradley–Terry ranking (mock providers, network-free).
- `evaluation-gate.ts` — network-free experiment threshold that exits non-zero on regression.
- `execution-timeline.ts` — **demo**: offline workflow execution timeline projection, cockpit summary, and Mermaid diagram export (network-free).
- `host-step-loop-timeline.ts` — **demo**: eight-step host loop correlating host action/attempt ids with Prism session/run ids, incremental per-step `ExecutionTimeline` projection, metadata-only NDJSON host ledger with `sha256:` tool-arg hashes, display-only legacy prose beside structural fields, and external host commit evidence kept out of Prism effects (network-free).
- `guardrail-packs.ts` — **demo**: guardrail packs end to end — two built-in packs refusing a `shell`/`write` call with the rule named, `createGuardrailPackScorer()` grading the denial, a durable `ask` rule suspending and being approved, and a `secrets-hygiene` refusal that never echoes the token (network-free).
- `external-agent.ts` — **demo** (Phase 13): an external agent driven through `@arnilo/prism/driver-kit` against the scripted `jsonl-stream` CLI, offline. An account profile signs in through a scripted `terminal` request; a run shows a replaced prompt, two bridged tools, a materialized skill, thinking and text deltas, a skill activation, a nested sub-agent, a steer, a write gated through `prism relay` (then a fail-closed write with the broker stopped), a suspension resumed with `allow_once`, a `createSessionIndex` search, and the `plan_login_not_permitted`, `profile_principal_mismatch`, and `profile_busy` refusals. `--conformance` runs `driverConformance` on the same driver for both dialects (network-free).
- `serve-tools.ts` — **demo** (Phase 14): serving a run's tools to an external agent's own loop, offline. Inside one `session.run` an inline `defineDriver` driver binds a `workspace` worktree for the run's session, materializes the vendor's MCP config into it with `excludeOverlay`, and serves `read`, `edit`, and the permission tool with `serveTools` over `loopback-http` and then `stdio-relay`, driving the scripted `jsonl-stream` CLI as the vendor binary. It shows an allowed `edit` that changes the file in the worktree, a declined `edit` under `@arnilo/prism-approval` in `ask` mode, permission-tool deny and allow, an unserved name as a JSON-RPC error, a call after `close()` refused, the served calls' `origin` on the run's events, the worktree diff with the overlay excluded, and a conflicting `merge` reported unresolved (network-free).
- `custom-adapter.ts` — **demo** (Phase 15 Part B): extending a reference adapter with `extendAdapter`. A host derives a new adapter from `adapters/rpc-server.ts` — one extra launch flag, one bound-worktree overlay, a decoder that turns the base's `agent.raw` frame into `agent.file`, and a policy narrowed to the base's api-key modes — then runs it through `processDriver` with `@arnilo/prism-tools-coding` and `@arnilo/prism-approval` (`ask`). The rpc-server dialect calls the served `edit` twice (one allowed, one declined by a scripted `HostUi`) and emits the custom frame, and the example prints the captured activity with its `origin`, both decisions, the worktree diff with the overlay excluded, the materialized skill, and `agent.inspect()` notes naming the base and the extension (network-free).
- `governance-deny.ts` — **demo**: deny-by-default `@arnilo/prism-governance` — the allow-listed `read_file` runs, the unlisted `write_file` is blocked with a `hook_denied` naming the policy, and the audit ledger holds both decisions (network-free).
- `behavior-evaluation.ts` — **demo**: host-journey packs that execute `trials: 3` (`sampleCount`, per-scorer statistics), a `write_record` call gated by a `tool.call` `ask` and approved inline (graded by `createApprovalBeforeEffectScorer({ tools })`), `runScenario` clarify/refuse, denyTools/unknownEffect/failStore injection, Task 8 stale draft revision, revoked-ACL citations, and `validateReleaseEvalManifest` (network-free).
- `coding-browser-evaluation.ts` — network-free coding/browser adversarial dataset + scorers + CI threshold, plus a test-oracle `toEnvironment` file-hash gate (no Docker/Playwright binary).
- `web-research.ts` — network-free host-selected Brave search → Firecrawl Markdown route with fake fetch, stable citation, untrusted marker, and fixed host extraction schema.
- `web-no-key.ts` — **demo**: a `toolsWeb` package whose `env:` key ref does not resolve registers no `web_*` tool and writes a `warn` status note naming the ref (the run still completes on the coding tools), and `toolsWeb({ backend: "native" })` registering `web_fetch` with no key and no status note; both halves are network-free.
- `run-feedback.ts` — immutable owned run feedback linked to an evaluation, bounded query, safe low-cardinality OpenTelemetry projection, and judge calibration against a human rating with mock providers.
- `delegate.ts` — **demo**: `@arnilo/prism-delegate` `delegate` tool; the `reviewer` child inherits only `@arnilo/prism-tools-coding` (its tool list proves the subset), the parent gets the child's answer as the tool result, and `delegate.step` events record start and finish. The second half runs a `coder` child with `isolation: "worktree"` in a throwaway repository: it writes in its own worktree and the delegate merges its commit into `main` (network-free, needs `git`).
- `advisor.ts` — **demo**: `@arnilo/prism-advisor` — the parent model calls `advise` once (one model call, no tools, over the branch slice) and gets the advice plus an `[advisor: …]` line; `triggers.beforeFinish` then reviews the final answer, says `revise`, and the run continues with that advice as a steer before a second review says `proceed`. The `advisor.consult` events are printed (network-free).
- `validator.ts` — **demo**: completion validation with `validate`: the run's task is captured and pinned, the first validator review answers `incomplete` with what is missing (the run continues with that list as a steer), the second answers `complete`, and the host reads `verified` from the last `validator.verdict` event (network-free; the child engine variant uses a hidden `delegate` child with its own tools).
- `working-semantic-memory.ts` — optional working memory + semantic recall with hash embedder, context injection, and processor update.
- `long-term-memory.ts` — **demo**: `memory:consolidate` turns an explicit statement into a typed, scored candidate note (`memoryFabric({ promote: {...} })`), a second agent over the same markdown store recalls it, and a third agent rooted in another project at that store sees the shared user preference but not the first project's fact (network-free).
- `memory-lifecycle.ts` — **demo** (plans 188.4, 188.5): one note's whole life in a single deterministic run — a user preference written in project A and cited in B, a procedure verified by use in both projects (the `agent` scope stays closed to model tools), a project exception that shadows the preference, an unused episode archived by the two strengths and revived through archive search, and a capacity budget that folds duplicates then evicts the weakest note; the scope clock is the store's session counter, so time is sessions, never calendar days. It then drives the three delivery tiers through a real agent: the standing rules in the prefix stay byte-identical across ten quiet turns, a `read` under a path note's glob injects that note in the tail exactly once, and `memory:share` writes a team note after a scripted `host.ui` confirm (network-free, no model call).
- `rag.ts` — optional bounded Markdown chunk/index/retrieve/citation flow using Phase 7 in-memory vector primitives.
- `drive-rag-sync.ts` — **demo**: fake Drive connector through `syncKnowledge` (checkpointed cursor, ACL grants, hash skip; network-free).
- `scanned-document-rag.ts` — **demo**: fake Mistral OCR `fetch` through `createMistralOcrParser` into `replaceDocument` (no default parser, usage hook; network-free).
- `memory-and-wiki.ts` — **demo** (plan 216 Task 3; plan 207 wrote its first form): memory and the wiki as separate packages in one deterministic run — `@arnilo/prism-memory-observational` observes, `@arnilo/prism-memory-fabric` keeps fact notes and verbatim exchanges (long-term memory, read by the wiki only through the read-only `memory.ltm` port), and `@arnilo/prism-wiki` keeps concepts in its own store. Three sessions write facts; `wiki:consolidate` creates a `payments` concept whose claims each cite an LTM note id, and memory gains no concept; a fourth session's note is bound by the wiki's next pass and cited; `wiki.search` returns the concept with the ids its claims cite and `wiki.read` drills down to cited memory notes; `memory.forget` on a cited note removes the claim that rested on it (the wiki reads memory's deletion feed). The main, observer and curator models are scripted in one inline provider (network-free, no credential).
- `revocation-propagation.ts` — **demo**: cross-layer revocation proof — grant loss vs. deletion, lineage-closed `createDeletionPropagator` with the RAG handler, the `listInvalidatedIds` read path (the same tombstones retire the observational-memory projection), a mid-rerank revoke withheld by the post-rerank gate, and a redacted fail-closed denial (network-free).
- `mcp-server.ts` — **demo**: serve a Prism agent over MCP as one `prompt` tool with `serveMcp` + `mcpHost`; runs over in-memory (default) or stdio (`--stdio`), with a commented modern HTTP wiring through `createPrismMcpWebHandler`.
- `host-builder-agent.ts` — **demo** (plan 215 Task 19): a Prism agent as the builder of a host. `prism-host-builder install --target prism` copies the skill into a temp project, then an agent with `tools-coding`, `contextFiles` (which discovers the skill under `.agents/skills`) and `@arnilo/prism-mcp` (stdio to `prism-host-builder mcp --root <project> --entry src/agent.ts#createInspectionAgent`, started by the host) runs a scripted turn: `load_skill`, `prism_api({ symbol: "createAgent" })` and `prism_inspect_host`. Mock provider, no credential, no network; one MCP server and one check child.
- `connected-slack-mcp.ts` — **demo**: network-free connected-app Slack MCP wrap with read/write effect classification and an exact allowlist.
- `mcp-trust.ts` — **demo**: an untrusted project stdio server never spawns (host.ui `confirm` denied) and a `env:` header ref is never echoed into events, `inspect()`, or command results (network-free).
- `open-connector-sidecar.ts` — **demo**: network-free Open Connector sidecar admission — loopback `streamable-http` transport, exact `allowTools`, unclassified `execute_action`, and a denied `select` (recipe in [`open-connector-sidecar/`](open-connector-sidecar/README.md)).
- `minimal-host-app.ts` — **demo**: canonical minimal host embed; stream events while a prompt runs via concurrent `Promise.all([drain, session.run])`.
- `custom-builders.ts` — **demo**: compose host context through a `context.build` hook and rewrite assembled input through a `run.input` hook.
- `custom-session-store.ts` — **demo**: implement the `SessionStore` contract (append + list) and assign it as the `store` slot; observe the entry kinds the runtime appends.
- `custom-tools-skills-context.ts` — **demo**: host-owned tool + skill + context provider in one agent, with a tool-call loop (no filesystem/shell/browser coding tools).
- `define-package.ts` — **demo**: two packages on one agent. Listing a package is the wiring.
- `manifest.ts` — **demo**: install a local fixture package, load it, run a turn with its tool, disable and reload, then an untrusted project manifest, a literal secret, and a tampered byte all fail closed (real `bun add`, Bun only).
- `provider-registration.ts` — **demo**: register a provider package via the
  extension kernel; resolve providers/models from host-owned registries.
- `provider-resolver.ts` — **demo**: resolve an agent's provider from a mix of
  first-party package providers and a third-party own provider via `providerPackage`.
- `api-key-auth.ts` — env + memory credential resolvers in host-defined order.
- `cache-aware-prompt-assembly.ts` — **demo**: cache-aware stable-prefix assembly and hit-rate reporting across Hyper explicit cache hints and OpenCode Go implicit prefix caching, using mocked SSE responses.
- `attention-compiler.ts` — **demo**: opt-in attention compiler (`@arnilo/prism-context-engineering`) — an under-ratio pass identical to a compiler-off one, then a stub plus the `attention.compiled` report once the request crosses the ratio (network-free).
- `tool-narrowing-planes.ts` — **demo**: plane-switched tool narrowing (knowledge/metric/scenario/objects) on one continuing session via a `context.build` handler plus a `tool.call` gate; `metadata.tools` count + `idsHash` (network-free).
- `tools.ts` — host-owned tool registry: allow/deny filter + dispatch.
- `context.ts` — ordered context-provider pipeline.
- `skills.ts` — skill registry + progressive disclosure activation.
- `skills-progressive-disclosure.ts` — **demo**: many-skill catalog under budget + `load_skill` body load (network-free).
- `package-skills.ts` — **demo** (plan 215 Task 12): package skills and availability. `@arnilo/prism-tools-web` ships `web-research`, which `requiresTools` `web_fetch`. `inspect().skills` shows its `package` and `requiresTools`; a run with `tools: { only: ["read"] }` drops it from the catalog and a scripted `load_skill("web-research")` returns `skill_unavailable` (network-free).
- `caveman-ponytail.ts` — **demo**: host-owned persona extensions built from a `SKILL.md` directory (`loadSkillDirectory`), progressive catalog, injector mode slices, session-entry mode persistence, `load_skill` (network-free).
- `hooks-json.ts` — **demo**: `@arnilo/prism-hooks-json` loads a Claude/Codex `hooks.json`. `SessionStart` is `session.opened`. `PreToolUse` denies a `.env` write. Commands are hash-pinned. The fixture spawns with no shell (network-free).
- `system-prompts.ts` — layered system-prompt composition; disabling layers.
- `system-project-prompts.ts` — **demo**: auto-load `AGENTS.md`/`SYSTEM.md` via
  `@arnilo/prism-context-files` (trust-gated) and prove the composed prompt reaches the provider.
- `discover-skills.ts` — **demo**: `@arnilo/prism-context-files` discovers and registers the project `SKILL.md` tree, then the discovered instructions reach a mock provider request (network-free).
- `instruction-injection.ts` — compile-checked host-selected instruction injector wiring.
- `jsonl-stores-branching.ts` — in-memory store + branching; JSONL persistence.
- `session-search.ts` — **demo**: workspace-scoped session search — SQLite FTS5 hit pointers (`entryId`/`runId`/`turn`/`score`/snippet), annotation search via `kind`, and the JSONL linear-scan fallback returning the same hits (network-free).
- `compaction.ts` — **demo**: LLM compaction with a mock summarizer provider.
- `observational-memory.ts` — **demo** (Phase 8): `@arnilo/prism-memory-observational` on a temp SQLite store — the observer on `mock/observer` while the turns run on `mock/main`, `session.compact()` summarizing from the ledger, the per-session `om` toggle, a second process resuming the session (toggle, worker model, ledger, `recall`), and the `compaction`-slot conflict failing closed (imports only `@arnilo/prism`, the two memory packages, and `@arnilo/prism-store-sqlite`, network-free).
- `coding-compaction.ts` — **demo**: coding-focused LLM compaction preset with a mock summarizer; raw history remains intact.
- `external-app-db-backed.ts` — **demo**: end-to-end external app with a DB-backed
  adapter reference mock (`SessionStore` + `RunLedger` + `ProductionPersistenceStore`
  reads), `storeConformance(createDbBackedReferenceStore)`,
  explicit tools/skills, branch-handle checkout + fork, and prior-run timeline
  resume from the ledger — no real DB, no network.
- `cli.ts` — **demo**: spawn the `prism` bin in print and json modes.
- `workflow-research-and-review.ts` — **demo**: three sequential agent nodes (research → draft → review) with in-memory checkpoints and redaction.
- `workflow-parallel-research.ts` — **demo**: bounded fan-out/join plus three concurrently scheduled research branches and downstream agent synthesis.
- `workflow-sqlite-resume.ts` — **demo**: durable SQLite checkpoint via `persistence.checkpoints`, fresh run, and resume on a temp database.
- `workflow-postgres-resume.ts` — **demo**: opt-in PostgreSQL failed-run resume through a new pool; safely skips unless `PRISM_TEST_POSTGRES_URL` is set.
- `workflow-multimodal-document.ts` — **demo**: bounded inline PDF workflow with caller-supplied credential resolver and secret redaction.
- `workflow-event-sink.ts` — **demo**: `WorkflowTransitionChannel` async subscribers collecting events through a conditional-skip path.
- `workflow-loop.ts` — **demo**: `workflowLoop` runs a generate-validate-revise `gateNode` loop in one agent session; its tool call is denied under `approval({ mode: "deny" })` and allowed once under `ask` with a scripted `HostUi`.
- `build-workflow.ts` — **demo**: the §2.11 `/build` orchestration offline: a mock host, `stream-cli` planner and UI engineer and an `rpc-server` validator over `createScriptedCli`, one SQLite file, and a temp git repo. A plan gate fails once and routes back, a `humanGate` confirms, a `fanOut` runs six tasks in worktrees under a profile cap of two, a merge gate runs `workspace.merge`, and the demo asserts the merged stream's origins, the cap, and a cross-agent session search.
- `coding-goal-verify.ts` — **demo**: `runCodingGoalVerify` thin goal→verify helper (failing check → suspend → approve → bounded handoff; no Goal table / network).
- `autonomous-coding-loop.ts` — **demo**: composite autonomous build loop (goal → roadmap → bounded one-shot child agents with their own models → `runCodingGoalVerify`-style validation → the observational-memory package (toggle, observer, ledger-backed compaction, `om:status`/`om:view`) → a `suspend`-based human gate with simulated restart → host-side bounded iterate-until-done and budget exhaustion). Mock providers only.
- `coding-tools-capability-gaps.ts` — **demo**: `outputMode`, `glob`, read-before-write, `delete`/`move` smoke (network-free).
- `phase9-coding-intelligence.ts` — **demo**: composed Phase 9 scenario (network-free): Git-aware enumeration, approved LSP rename, managed process session, idempotent forge PR (fake GitHub), and allow-list egress (github+registry presets).
- `acp.ts` — **demo**: one agent served over ACP with `@arnilo/prism-acp` (`serveAcp` + `acpHost`), an approval answered `allow_once` over in-memory streams (network-free).
- `obscura.ts` — Obscura composition illustration (compile-checked): one host-installed binary feeding web tools, managed CDP + Playwright browser tools, and the full MCP surface as one generic `ToolDefinition[]` across every Prism host.
- `tsconfig.json` — typecheck-only config.

**demo** = the file has a runnable `main()`; the others are compile-checked
illustrations only.

- [`adapters/stream-cli.ts`](adapters/stream-cli.ts): offline flag-configured stream adapter, with a scripted dialect and recorded fixture; verified by `packages/drivers/process/src/__tests__/stream-cli.test.ts`.
- [`adapters/rpc-server.ts`](adapters/rpc-server.ts): offline JSON-RPC app-server adapter, with a scripted dialect and recorded fixture; verified by `packages/drivers/process/src/__tests__/rpc-server.test.ts`.
- [`adapters/workspace-config.ts`](adapters/workspace-config.ts): offline workspace-file-configured stream adapter that writes its configuration as a bound-worktree overlay, with a scripted dialect and recorded fixture.
- [`adapters/conformance.ts`](adapters/conformance.ts): runs `adapterConformance` for all three reference adapters and prints one JSON leg summary per adapter; spawned by `packages/drivers/process/src/__tests__/reference-adapters.test.ts`.
- [`custom-adapter.ts`](custom-adapter.ts): a host extension of `adapters/rpc-server.ts` through `extendAdapter` — one extra flag, one decoded frame, and a narrowed policy — run through `processDriver` with the coding tools and the approval package; asserted by the demo gate in `src/__tests__/docs.test.ts`.

- [`remote-agent.ts`](remote-agent.ts): offline stdio remote worker and local workflow reviewer, scripted approval, attributed merged stream, and SQLite mirror search. Run `bun examples/remote-agent.ts`; its child is [`remote-agent-server.ts`](remote-agent-server.ts).

- [`headless-host.ts`](headless-host.ts): offline client → scripted paired channel → policy routing, SQLite approval suspension and later resume, then one cron workflow firing on a fake clock with an indexed child session. Run `bun examples/headless-host.ts`.
- [`research-ledger.ts`](research-ledger.ts): offline source ledger — two mock fetches, one resolved citation, one unknown id that fails the check. Run `bun examples/research-ledger.ts`.
