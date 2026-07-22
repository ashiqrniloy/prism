# Migration guide

## What it does

Prism 0.0.6 preserves documented 0.0.3 agent construction except for two intentional Phase 3 public-API cleanups:

1. **`session.run()` / `session.prompt()` return `AgentRunResult`** and `session.stream()` starts one owned run after subscribing. Callers that ignored the previous `Promise<void>` keep working; failed/aborted runs reject with `AgentRunError` (`.result` attached).
2. **`AgentConfig.extensions` / `settings` / `credentials` are removed.** Wire extensions through `createExtensionKernel()`, read settings in the host, and pass credential resolvers to the provider edge.

## 0.0.10 → 0.0.11 coding harness fundamentals (additive)

Release **0.0.11** adds SessionIndex/search, assembler `contextBudget`, native Anthropic + Google provider packages, mid-run `steer`, coding-agent goal→verify + `ask_user_decision` (multi/free-text/suspend glue). Package count: **32 → 34** (adds `@arnilo/prism-provider-anthropic`, `@arnilo/prism-provider-google`). Version bump itself is Task 13 / release gate — treat this section as the behavioral migration map.

| Surface | Before (0.0.10) | After (0.0.11) |
| --- | --- | --- |
| Session search | No `searchSessions` / `SessionIndex` | Optional store search; SQLite/Postgres FTS migration `004_session_search` (schema **v4**); memory `sessionSearchMode: "linear" | "unsupported"` (default linear); JSONL throws `SessionSearchUnsupportedError` |
| Context budget | Assembler has no token/byte eviction | Opt-in `contextBudget` on `assembleProviderInput`; omission report via metadata helper |
| Providers | OpenCode Go Anthropic *route*; no first-party Google | `@arnilo/prism-provider-anthropic` (`createAnthropicProviderPackage`) + `@arnilo/prism-provider-google` (`createGoogleProviderPackage`); AI SDK remains escape hatch |
| Mid-run input | RPC `steer` unsupported / no queue | `AgentSession.steer` + RPC `steer` (queue 8 / 64 KiB; optional softInterrupt) |
| Coding helper | Compose manually from plan/checks/workflows | `runCodingGoalVerify` + `examples/coding-goal-verify.ts` |
| Ask user | n/a | Opt-in `createAskUserDecisionTool`; durable `suspendAskUserDecision` (no new agent interruption kinds) |
| Structured output + tools | Native schema attached every GVR provider turn | Opt-in `structuredOutputTiming: "final-turn-only"` (default `"every-turn"`): tool-eligible turns omit schema; artifact/revision turns schema-on / tools-off |

**Host actions:** reopen SQLite/Postgres stores so migration 004 applies; set `metadata.workspaceRoot` when filtering by workspace; wire Anthropic/Google packages explicitly; do not expect JSONL search. Benchmarks: `scripts/benchmark-0.0.11.mjs` (lands with release Task 13). See [Phase 6 evidence](review-coverage-2026-07-22-phase-6.md).

## 0.0.9 / 0.0.96 → 0.0.10 coding workspace modes (breaking composition)

`@arnilo/prism-coding-security` composition now requires explicit `workspaceMode: "host" | "sandbox"`. Missing mode throws at construction. The `0.0.9` default that wired sandbox shell while keeping read/write/edit/list/search on the host cwd is **superseded** and fail-closed.

| Before (0.0.9) | After (0.0.10) |
| --- | --- |
| `createSandboxCodingTools(cwd, { sandbox })` — shell in sandbox, FS on host | Must pass `workspaceMode`. Prefer `createSandboxCodingComposition(...)`. |
| Silent split-brain treated as normal | Throws unless `allowMixedWorkspaceWiring: true` (warnings; `containmentClaim: false`). |
| No containment metadata | `composition.containmentClaim` / `warnings` / optional `treeIdentity`. Host mode never claims containment. |

```ts
// Contained: one disposable tree
const { tools, composition } = createSandboxCodingComposition(sourceRoot, {
  workspaceMode: "sandbox",
  sandbox, // DisposableSandbox auto-wires FS backends
});

// Explicit host (non-contained)
createSandboxCodingTools(cwd, { workspaceMode: "host" });

// Escape hatch (documented split; no containment claim)
createSandboxCodingTools(cwd, {
  workspaceMode: "sandbox",
  sandbox,
  allowMixedWorkspaceWiring: true,
});

// Same-tree Git
createGitTools(composition.workspaceRoot, {
  execFile: sandbox.execFile.bind(sandbox),
  commitIdentity: { name: "bot", email: "bot@example.com" },
});
```

Docker defaults unchanged: digest-pinned image, non-root user, network none, absolute Docker CLI, no host-env inheritance. Unified mode adds no unbounded sync; caps stay in `sandbox-limits.ts` / coding-agent limits. Benchmark evidence: `scripts/benchmark-0.0.10.mjs`.

## 0.0.8 → 0.0.9 release overview

All 32 first-party manifests and exact internal ranges move together to `0.0.9`; mixed first-party versions are unsupported. Core remains dependency-free at runtime and existing low-level agent/session APIs remain compatible. New coding sandbox, repository/Git, durable coding-plan, and browser surfaces are opt-in. `@arnilo/prism-browser` is included by `@arnilo/prism-all` but not by `@arnilo/prism-code` — install it explicitly when interactive browser automation is required. Office execution remains outside Prism packaging (host-selected skills/instructions only). No tag or publication is automatic from this migration.

### Malformed streamed tool-call arguments (recoverable)

Malformed streamed tool-call JSON (id+name present) no longer terminates the run as `ProviderTransportError("invalid_json_arguments")`. First-party providers emit a tool call carrying `argumentsError`; dispatch blocks with `tool_execution_blocked` / `invalid_arguments` (`error.code: "invalid_json_arguments"`), never calls `execute()`, and the model can self-correct within existing turn/tool-round budgets. Prefer `toolCallFromArgumentsText` / `tryParseJsonObjectArguments` in custom providers.

### Incomplete tool-call deltas (typed failure)

Tool-call deltas missing `id` and/or `name` at stream end no longer throw a bare `Error("Incomplete tool call delta...")`. Core reconstruction and the openai-compatible finalizer surface `ProviderTransportError` / `ErrorInfo.code: "incomplete_delta"`, fail the provider turn (no tool execution), and keep OpenCode Go / Kimi dangling fail-closed behavior. Distinguish from Defect 1a: missing identity fails the turn; present identity with bad JSON recovers via failed tool results.

### Empty call-free artifact candidates (parse_error)

`generateValidateReviseLoop` treats empty/whitespace-only call-free assistant text (including thinking-only/reasoning-only turns) as `parse_error` before the host parser/identity default. Session runs succeed only after `artifact_finished`; terminal `artifact_failed` fails the run (`AgentRunError`, typically `error.code: "parse_error"`).

## 0.0.9 coding-security Docker sandbox (additive)

`@arnilo/prism-coding-security` adds `createDockerSandbox()` / `DisposableSandbox` while preserving `SandboxAdapter.exec` and `createSandboxBashOperations()`. Hosts opt in with an absolute Docker executable and digest-pinned image; default network is none, host env is never inherited, and workspace export is an explicit bounded host callback. Existing approval-policy callers need no changes.

## 0.0.9 coding-agent repository list/search (additive behavior change)

`@arnilo/prism-coding-agent` adds native `repo_list` / `repo_search` tools. `createCodingTools()` / `createAllTools()` now return six tools. **`createReadOnlyTools()` deliberately expands from `[read]` to `[read, repo_list, repo_search]`** — update hosts that asserted the previous read-only membership. Prefer `createSandboxCodingComposition(cwd, { workspaceMode, sandbox, repository })` (or the tools-only wrappers) from `@arnilo/prism-coding-security`. Pass required `workspaceMode`; sandbox mode keeps shell and FS/list/search on one disposable tree. The 0.0.9 split (sandbox shell + host FS) is superseded — see **0.0.9 / 0.0.96 → 0.0.10 coding workspace modes** above.

Opt-in structured Git/check tools are available via `createGitTools(cwd, { commitIdentity, checks? })` and are **not** added to `createCodingTools()`/`createAllTools()`. Commits require an explicit host `commitIdentity`; PR handoff returns bounded metadata/artifacts only and never pushes.

Durable coding-task composition uses existing workflows plus coding-agent helpers (`writeCodingPlanFile`, `buildCodingCheckpointMetadata`, `assertCodingResumeAllowed`). Plan/todos remain workspace Markdown; checkpoint state keeps only references/hashes/summaries/fingerprints under `state.coding`. No `CodingRun` or todo database is introduced. See `examples/durable-coding-workflow.ts`.

## 0.0.9 browser automation (additive)

Install `@arnilo/prism-browser` explicitly (or through `@arnilo/prism-all`) for interactive browser tools. Hosts supply a pinned Playwright `Browser` (`playwright-core@1.61.0` optional peer); package import launches and downloads nothing. `createBrowserTools()` returns exactly `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close` (all `exclusive: true`). Network policy defaults to require contained-proxy attestation; configure `uploads`/`downloads` for file transfer; `browser_act` adds `upload`/`screenshot`/`download_release`. Use `createBrowserManager().closeRun(runId)` / `close()` on terminal/abort. Align with a disposable sandbox via `createSharedSandboxBrowserOptions()` and `assertBrowserSandboxNetwork()`. CSS/XPath/evaluate/CDP/persistent profiles remain unsupported.

## 0.0.7 → 0.0.8 release overview

All 31 first-party manifests and exact internal ranges move together to `0.0.8`; mixed first-party versions are unsupported. Core remains dependency-free at runtime and existing low-level agent/session APIs remain compatible. New telemetry, evaluation, MCP, A2A, ledger batching, and web research surfaces are opt-in. Release CI now requires CodeQL, dependency/license/SBOM/secret checks, packed-artifact attestations, PostgreSQL integration, and protected live-canary prerequisites; no tag or publication is automatic from this migration.

## 0.0.7 → 0.0.8 evaluations and ledger operation

`@arnilo/prism-evals` adds owner-scoped trace resolution, optional host model judges, deterministic pairwise reports, and `assertEvaluationThreshold()` without changing stored evaluation schemas. Hosts select all judge/provider credentials and should version rubrics. Core adds optional `createBatchedRunLedger()`; direct ledgers remain write-through. Choose `flush_on_terminal` only after accepting bounded pre-flush crash loss, and call `dispose()` during shutdown. Runtime snapshot caching is session/leaf-local and requires no persistence migration.

## 0.0.7 → 0.0.8 web research tools

Install `@arnilo/prism-web-tools` explicitly (or through `@arnilo/prism-all`) to add web capability; core and existing profiles remain inert. Select Brave or Exa at construction, provide Firecrawl separately for Markdown/schema extraction, and register returned `web_search`/`web_fetch`/`web_extract` tools through normal permission/trust/validation dispatch. Provider selection, credentials, target DNS policy, and extraction schema are host-only. All returned content is marked untrusted; no browser or vendor SDK is added.

## 0.0.7 → 0.0.8 A2A durable tasks

Existing text `createA2AHandler({ exposure })`, `client.send()`, and `client.stream()` remain compatible. Add host `tasks` to enable `GetTask`/`ListTasks`/`CancelTask`/`SubscribeToTask`, rich parts, interrupted states, and replay cursors; no task store or migration is created. Add host `push` for push-config CRUD and matching card capability. Raw/data/URL parts are disabled until selected in `parts`; URL/push endpoints additionally require host URL policy and are never fetched by part parsing. Push delivery/retries/idempotency remain host-owned.

## 0.0.7 → 0.0.8 MCP capabilities and sessions

`@arnilo/prism-mcp` now pins official SDK 1.29.0. Existing `connectMcpTools()` and stateless web handlers remain compatible. Use `connectMcpCapabilities()` for bounded resources/prompts and explicit roots/sampling/elicitation callbacks. Server resources/prompts must be selected explicitly and authorize every operation. Stateful Streamable HTTP additionally requires `sessionIdGenerator`, exact `allowedOrigins`, and host `resolveIdentity`; omission preserves stateless mode. `Last-Event-ID` replay is not enabled. Missing capability calls fail with `ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY`.

## 0.0.7 → 0.0.8 OpenTelemetry adapter

The optional observability package now emits OTel GenAI names and units instead of independent `prism.agent.run` / `prism.provider.turn` / `prism.tool.execute` spans and millisecond metrics. Update dashboards to `invoke_agent prism`, `chat {model}`, `execute_tool {tool}`, `gen_ai.*.duration` (seconds), and `gen_ai.client.token.usage`. Pass `{ context, trace }` as third `wrapOpenTelemetryApi()` argument for native parent context, and use `onTraceReference` or `traceId(runId)` for evaluation linkage. Core APIs and persistence schemas are unchanged.

## 0.0.7 → 0.0.8 Kimi provider alignment

`@arnilo/prism-provider-kimi` now matches the official contracts: featured Coding `k3` defaults to `reasoning_effort: "high"` (Open Platform `kimi-k3` keeps `"max"`); featured context windows use the official `262_144` for 256K-class models; the featured Moonshot catalog adds `kimi-k2.7-code-highspeed`, `kimi-k2.6`, and `kimi-k2.5` (K2.5 intentionally without Preserved Thinking). Provider-owned compat keys (`route`, `preserveThinking`, `preserve_thinking`) are stripped before the opaque compat spread and no longer leak into request bodies. The Coding route additionally sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers per the official third-party setup. Streams emit `done` only on protocol completion evidence (`message_stop` on the Coding route, `[DONE]` + `finish_reason` on the Moonshot route); truncated streams now surface as run failures.

## 0.0.7 → 0.0.8 artifact-loop parse failures

`generateValidateReviseLoop` no longer returns silently on artifact parse failure. A parser returning `{ ok: false }` (or no `value`) now consumes revision budget exactly like a validation failure: the repairer receives `value: undefined` plus a synthetic failure (`metadata.reason: "parse_error"`), and exhaustion ends with terminal `artifact_failed`. Host repairers must already tolerate `value: undefined` per the `ArtifactRepairer` contract; runs that previously ended after one silent parse failure now spend up to `maxRevisions` repair turns first.

## 0.0.7 → 0.0.8 OpenCode Go provider fixes

`@arnilo/prism-provider-opencode-go` no longer infers `structuredOutput: "json_schema"` from OpenAI-compatible routing alone. Only verified models (`mimo-v2.5`, `mimo-v2.5-pro`) advertise it; other OpenAI-route models (for example `deepseek-v4-pro`) now use the artifact-loop parsing/validation path, and requests that still pass `options.structuredOutput` for an unverified model fail before dispatch with `unsupported_model`. Hosts with their own verification evidence can set the capability explicitly through `defineOpenCodeGoModel({ capabilities })`. The Anthropic route additionally sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers alongside Bearer, fixing HTTP 401 on MiniMax/Qwen models; caller headers cannot override them. Streams now emit `done` only on protocol completion evidence (`[DONE]` plus a terminal `finish_reason` on the OpenAI route, `message_stop` on the Anthropic route) with no dangling tool-call accumulators; truncated connections and incomplete tool calls terminate with an `error` event, so hosts may see previously silent truncations surface as run failures.

## 0.0.6 → 0.0.7 secure run lifecycle

`createAgent()` remains backward-compatible. Version 0.0.7 adds opt-in typed `Guardrails` (`input`, provider `output`, `toolInput`, `toolOutput`) and narrowing-only `RunLimits`. Output guardrails and configured output-token/total-token/cost limits buffer provider output before exposure; blocked content is neither emitted nor persisted. A breach emits one redacted `run_limit_exceeded` event and rejects with `AgentRunError.result.limit`.

Built-in agent loops can opt into durable `runState` with a checkpoint store and stable `definitionRevision`. `interruptBeforeTool: true` suspends before any tool side effect. Resume requires exact ownership, current fingerprint/revision, and checkpoint `expectedVersion`; a crash after dispatch is ambiguous and requires operator resolution rather than replaying the tool. Custom `AgentLoopStrategy` objects are not durable. Persisted state is bounded/redacted and excludes credentials, raw input, callbacks, providers, and pending tool arguments.

`createSecureAgent()` is new and opt-in. Adopt it when every active tool must have a host validator/schema, trust and permission policies, secret redaction, finite limits, exact ownership, and durable pre-tool approval. Run options may narrow its limits and append guardrails, but cannot replace its redactor, validator, ownership, or checkpoint policy. To expose durable agent status/resume remotely, explicitly create `createAgentRunLifecycle({ checkpoints, resolveAgent })` and pass it to selected server `agentRuns` or MCP `agentRuns`; no route/tool is added otherwise.

```ts
const suspended = await agent.createSession().run("send", {
  runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  limits: { maxToolCalls: 1, maxTotalTokens: 50_000 },
});
const result = await resumeAgentRun(agent, { runId: suspended.runId }, {
  decision: "approve", expectedVersion: suspended.runState!.version!,
}, { checkpoints, definitionRevision: "1" });
```

Phase 4 adds optional `@arnilo/prism-evals` for deterministic scorers/datasets/experiments. It is not a core dependency; install it directly or through `@arnilo/prism-all`.

Phase 5 adds `prism init <dir>` to the existing CLI. It scaffolds a tiny TypeScript project with one selected provider and an offline mock test. Optional `--with-workflows` / `--with-evals` flags add only those packages; storage and telemetry stay opt-in elsewhere.

Phase 6 adds optional `@arnilo/prism-provider-ai-sdk` for AI SDK `LanguageModelV4` interoperability. Install it with `@ai-sdk/provider@^4`, through `@arnilo/prism-providers`, or through `@arnilo/prism-all`; it is not a core dependency.

Phase 7 adds optional `@arnilo/prism-memory` for schema/template-backed working memory and embedding-based semantic recall. Install it directly or through `@arnilo/prism-all`; in-memory adapters are default, and PostgreSQL/pgvector is opt-in. It is not a core dependency.

Phase 8 extends `@arnilo/prism-workflows` compatibly. Nodes may return `suspend()`, and opted-in tool nodes may declare `approval`. Resuming a suspended run requires `{ decision, input?, expectedVersion }`; ordinary failed/aborted recovery resume remains unchanged. `WorkflowRunStatus` adds `suspended` and terminal `denied`. Suspension/resume records remain bounded checkpoint JSON, so SQLite/PostgreSQL require no migration.

Phase 9 adds optional `@arnilo/prism-rag` for bounded plain-text/Markdown chunking, Phase 7 vector indexing/retrieval, stable citations, and explicit context injection. Existing agents and memory stores are unchanged; install and attach its context provider explicitly. No database migration is required.

Phase 10 adds optional `@arnilo/prism-server` and extends `@arnilo/prism-mcp` with server-direction APIs. Existing agent/workflow/MCP client behavior is unchanged. Install the server package explicitly, pass selected capability maps plus required host authorization, and adapt its Web handler in the deployment host. MCP servers likewise register only passed tools/commands and require authorization. No listener, route, credential source, profile package, or database migration activates automatically.

Phase 11 compatibly extends `@arnilo/prism-workflows` with `workflowNode`, shared state fields/context updates, replay lineage, explicit background enqueue, and ownership-scoped schedules. Existing workflow definitions and direct runs remain valid; `WorkflowRunResult` now always includes `state`. State schemas require a host `validateState` callback. Schedules reuse generic checkpoint/lease stores, so SQLite/PostgreSQL need no migration and no scheduler starts automatically.

Prism 0.0.6 intentionally hardens workflow identity and resource limits:

- Every `defineWorkflow()` input requires a non-empty host-authored `revision`. Revision and nested workflow revisions enter `definitionHash`; bump revision whenever function/tool behavior changes. Existing checkpoints with a different hash fail resume/replay/cancel before mutation.
- `cancelWorkflowRun()` now requires `workflow` as well as IDs/checkpoints. Cancellation compares exact tenant/account/user ownership; tenant-only or missing ownership no longer matches a run stored with account/user identity.
- Active runs are keyed by workflow ID, run ID, and exact ownership. Duplicate exact registration throws `ERR_PRISM_WORKFLOW_ALREADY_ACTIVE`; same IDs under distinct exact owners remain isolated.
- All `WorkflowLimits`, runtime `concurrency`, node retries/timeouts, and checkpoint byte options reject non-finite, unsafe, zero/negative, or above-hard-cap values instead of accepting/clamping them.

```ts
// Before
const workflow = defineWorkflow({ id: "publish", nodes });
await cancelWorkflowRun({ workflowId: workflow.id, runId, checkpoints, ownership });

// 0.0.6
const workflow = defineWorkflow({ id: "publish", revision: "2026-07-19.1", nodes });
await cancelWorkflowRun({ workflowId: workflow.id, runId, workflow, checkpoints, ownership });
```

Checkpoint schema remains version 1; no table migration is required. Pre-0.0.6 checkpoint hashes do not include revision and therefore fail against 0.0.6 definitions. Complete them before upgrade, or perform an explicit host-owned checkpoint rewrite only after verifying the exact old/new definition; do not guess a revision to bypass evidence checks.

Prism 0.0.6 also makes coding-agent I/O finite:

- `shell` now defaults to 600 seconds and 64 MiB combined output; request/config timeout cannot exceed 3,600 seconds. Timeout, abort, overflow, and spill failure kill signal-aware operations and remove unpublished spills.
- `read` streams one text page with a 64 MiB scan ceiling instead of calling full-file `readFile()`. Custom `ReadOperations` must implement `readText(path, ReadTextOptions)` and `statFile()`; text results must stay within requested caps.
- `write` rejects UTF-8 input over `maxInputBytes` before policy/filesystem mutation.
- `edit` requires custom `EditOperations.statFile()`, caps the target, aggregate old/new input, and replacement count, and passes caps/signals into operation methods.

```ts
const tools = createCodingTools(root, {
  shell: { timeout: 600, maxTotalOutputBytes: 64 * 1024 * 1024 },
  read: { maxScanBytes: 64 * 1024 * 1024 },
  write: { maxInputBytes: 8 * 1024 * 1024 },
  edit: { maxFileBytes: 8 * 1024 * 1024, maxInputBytes: 2 * 1024 * 1024, maxEdits: 100 },
});
```

Custom shell/sandbox adapters must honor the composed `signal` and finite `timeout`; Prism cannot kill an opaque remote operation that ignores its host contract. Successful truncated local output remains at `metadata.fullOutputPath` for the host to consume and delete.

Prism 0.0.6 also bounds JSON Schema, vectors, and generated IDs:

- `@arnilo/prism-tool-validator-json-schema` now rejects invalid instance/schema/cache limits during construction, then rejects schemas over default 256 KiB, depth 64, 10,000 properties/keywords, or 128 refs before Ajv compilation. Only `#` fragment refs remain valid; the compiled cache is a finite 256-entry LRU. Configure an explicit lower cap where tools accept third-party schemas.
- `@arnilo/prism-memory` now fails before scoring/storage for empty, non-number, NaN, or infinite embeddings and for dimension mismatches in configured PostgreSQL/pgvector stores. Fix the host embedder/data rather than filtering invalid values after a query.
- Generated core/workflow/evaluation IDs are cryptographic UUIDs. No API shape changes, but tests or parsers that assumed timestamp/base36 IDs must treat IDs as opaque strings.

Prism 0.0.6 hardens `@arnilo/prism-credentials-node`:

- `encryptBytes()` and `decryptBytes()` now return Promises because scrypt runs asynchronously instead of blocking the JavaScript event loop.
- Encrypted files default to 4 MiB and decrypted vaults to 3 MiB (hard 16 MiB/12 MiB). Strict envelope parsing rejects unknown properties, non-canonical base64, invalid salt/IV/tag lengths, unsupported algorithms/version, and excessive KDF work before scrypt.
- scrypt requires power-of-two `N` from 16,384–262,144, `r≤32`, `p≤16`, exact 32-byte keys, `N*r*p≤2,097,152`, and `128*N*r≤256 MiB`.
- Existing Unix vault files with group/other permissions now fail on open/rotate before content read. Fix deliberately with `chmod 600 <vault>` after confirming ownership; Prism does not silently chmod an existing file.
- Keychain calls use abort-aware native async operations, a 5-second default/60-second hard timeout, and a 3 MiB default/12 MiB hard payload bound. Unknown native messages are no longer rethrown.

```ts
// Before
const envelope = encryptBytes(plaintext, passphrase);
const bytes = decryptBytes(envelope, passphrase);

// 0.0.6
const envelope = await encryptBytes(plaintext, passphrase);
const bytes = await decryptBytes(envelope, passphrase);

const store = await openEncryptedCredentialStore({
  path: "./credentials.vault",
  getPassphrase,
  limits: { maxFileBytes: 4 * 1024 * 1024, maxVaultBytes: 3 * 1024 * 1024 },
});
```

Version-1 AES-GCM envelopes written with documented 0.0.5 defaults remain compatible when canonical and within limits. Oversized, permissive-mode, malformed, or previously out-of-policy custom KDF files require explicit host review; no automatic rewrite bypass is provided.

Prism 0.0.6 makes MCP client discovery/results and Streamable HTTP fail closed:

- Every `streamable-http` config now requires `allowedOrigins` with exact HTTPS origins. URLs with credentials/fragments, redirects, public plaintext HTTP, private/mixed DNS, and origin changes fail. Every SDK POST/GET/DELETE/reconnect pins one validated address and defaults to a 16 MiB response cap (64 MiB hard).
- Local development plaintext requires `allowLoopbackHttp: true`; both hostname and every DNS answer must remain loopback. This does not enable arbitrary private-network endpoints.
- Discovery defaults to 20 pages, 500 tools, 4 KiB cursors, 256-byte names, 16 KiB descriptions, 256 KiB schema/tool, and 4 MiB aggregate schemas. Repeated cursors and failed refreshes reject without replacing the previous tools.
- `content`, `structuredContent`, and legacy SDK `toolResult` now share `maxResultBytes` plus JSON depth/property limits. `structuredContent` remains `ToolResult.value` but is no longer duplicated under metadata.
- `listAllMcpTools(client, signal?, limits?)` accepts an optional third finite-limits object. Bridge options expose the same discovery/result fields. Invalid, non-finite, unsafe, zero/negative, or above-hard-cap values reject at setup.

```ts
// Before: HTTP accepted without package-enforced origin/DNS policy.
transport: { type: "streamable-http", url: "http://mcp.example.test/mcp" }

// 0.0.6: exact HTTPS origin and finite discovery/result configuration.
const bridge = await connectMcpTools({
  serverId: "docs",
  transport: {
    type: "streamable-http",
    url: "https://mcp.example.test/mcp",
    allowedOrigins: ["https://mcp.example.test"],
  },
  maxListPages: 20,
  maxTools: 500,
  maxToolSchemaBytes: 256 * 1024,
  maxResultBytes: 2 * 1024 * 1024,
});
```

Stdio remains an explicit host-selected executable and does not gain network policy. MCP bridge calls should still pass through core dispatch with a host `SecretRedactor`, `PermissionPolicy`, and `ToolValidator`; package limits do not establish server trust or sandbox subprocesses.

Prism 0.0.6 makes first-party persistence startup fail closed on migration/schema drift:

- `@arnilo/prism-session-store-sqlite` and `@arnilo/prism-session-store-postgres` now write deterministic SHA-256 checksums for every new `prism_migrations` row and validate exact ordered name/version/checksum history before applying DDL or exposing runtime writes.
- Open also checks full schema version 3 metadata: required tables, columns/types/nullability/defaults, primary/unique/foreign keys, and named index definitions. SQLite uses bounded PRAGMAs/catalog reads; PostgreSQL uses bounded `information_schema`/system-catalog reads while its existing per-schema advisory transaction lock is held. Neither scans application rows.
- Existing complete 0.0.5 histories with all `checksum` values `NULL` are accepted exactly once: Prism verifies full current shape, backfills every checksum inside the migration transaction, and then opens. Unknown, duplicate, out-of-order, name/version/checksum-mismatched, mixed/partial legacy rows or shape drift now reject before runtime writes.

```ts
// No call-site API change. Open either verifies/backfills safely or fails.
const sqlite = createSqlitePersistence({ filename: "./prism.db" });
const postgres = await createPostgresPersistence({ pool, schema: "prism" });
```

Before upgrade, back up the database and complete any in-flight migration. On a drift error, restore a known schema or apply a reviewed DDL repair that matches version 3, then reopen. Do not update `prism_migrations.checksum` manually: that bypasses evidence rather than repairing the schema.

Prism 0.0.6 makes compaction workers and A2A stream decoding finite:

- LLM compaction now defaults `maxSummaryTokens` to 16,384 (131,072 hard), `reserveTokens` to 16,384 (131,072 hard), and `maxErrorBytes` to 1 KiB (8 KiB hard). `maxOutputTokens` remains an alias. Invalid values reject when the strategy is created. Every post-policy provider request must retain finite `model.parameters.maxTokens`; streamed text and even empty/non-text event counts terminate at derived finite bounds.
- Final summaries are capped at four UTF-16 code units per configured token without splitting a surrogate pair. Tiny caps may omit the human truncation marker to honor the actual ceiling. Provider error/factory/policy text is exact-known-secret redacted and UTF-8 bounded.
- Observational-memory runtime adds flat `maxWorkerTurns`, `maxWorkerToolCallsPerTurn`, `maxWorkerToolCalls`, `maxWorkerArgumentBytes`, `maxWorkerResultBytes`, `maxWorkerMessageBytes`, and `maxWorkerErrorBytes` options. Defaults are 16 turns, 32/128 calls, 64 KiB arguments/results, 1 MiB messages, and 1 KiB errors; hard caps are 64, 256/1,024, 1 MiB, 1 MiB, 8 MiB, and 8 KiB.
- Settings `agentMaxTurns` now rejects fractions, non-finite values, zero/negative values, and values above 64 instead of flooring or falling back. Runtime `maxWorkerTurns` overrides it. Direct worker calls retain required `maxTurns` and use the shorter corresponding option names.
- Unknown/excess worker calls and oversized/deep/cyclic/non-JSON arguments/results now reject. Replayed arguments/results and runtime status/debug errors are bounded/redacted; pass all known secrets explicitly.
- A2A public limit defaults/options do not change. Client streaming now correctly preserves split UTF-8, accepts LF/CRLF/mixed separators and multiline `data:`, and rejects malformed UTF-8, unterminated frames, missing terminal state, or events after completion.

```ts
const strategy = createLlmCompactionStrategy({
  provider: summaryProvider,
  model: summaryModel,
  maxSummaryTokens: 4_096,
  maxErrorBytes: 1_024,
});

const memory = createObservationalMemoryRuntime({
  session,
  appendEntry,
  workerProvider,
  sessionModel,
  maxWorkerTurns: 8,
  maxWorkerToolCalls: 64,
  maxWorkerResultBytes: 64 * 1024,
});
```

No background worker, provider call, or network connection activates at import/setup. Host-provided observational-memory tools remain trusted code: Prism can reject an oversized result after return but cannot undo tool side effects.

Prism 0.0.6 also adds opt-in bounded artifact-loop tools. Set `loop: { strategy: "generate-validate-revise", toolCalls: "bounded", validator }` with `maxToolRounds`; calls dispatch sequentially through normal permission, validation, redaction, ledger, and lifecycle paths. Tool-call turns do not consume artifact revisions or parse/validate an artifact. The shared round cap emits terminal `artifact_failed` metadata `{ reason: "tool_round_limit" }`; omitted or `"disabled"` preserves prior inert-call behavior.

This page also covers two optional adoption paths:

1. **In-memory / JSONL → database-backed persistence** — replace the single-process development `SessionStore` with `@arnilo/prism-session-store-sqlite`, `@arnilo/prism-session-store-postgres`, or a host implementation, and optionally attach its durable `RunLedger`.
2. **Legacy permissive capability configuration → explicit activation** — name tools/skills and keep omitted capabilities fail-closed.

It states before/after shapes and links detailed schema, redaction, branch, capability, and security guidance.

## When to use it

Read this page when:

- you are taking an app from the `createMemorySessionStore()` / `createJsonlSessionStore()` path to a multi-process, multi-tenant, or durable database backend;
- you are hardening an agent that previously relied on "every scoped tool/skill is active" and need to name capabilities explicitly;
- you are adopting 0.0.6 persistence, checkpoints/leases, workflows, structured output, multimodality, or explicit tool safety for the first time.

If you are new to Prism, start at [Session stores](session-stores.md) and [Agent/session runtime](agent-session-runtime.md) instead.

## Inputs / request

There is no runtime import for this page. The migrations below use these surfaces:

| Surface | Where | Migration role |
| --- | --- | --- |
| `SessionStore` | `@arnilo/prism` | Runtime seam swapped from memory/JSONL to DB. |
| `createSqlitePersistence` | `@arnilo/prism-session-store-sqlite` | Local durable session, ledger, query, checkpoint, and lease adapter. |
| `createPostgresPersistence` | `@arnilo/prism-session-store-postgres` | Multi-process pooled persistence with advisory-lock migrations. |
| `ProductionPersistenceStore` | `@arnilo/prism` | Adapter-facing contract for paginated, multi-tenant reads (`query*`, optional `readBranchPath`). |
| `RunLedger` / `RunLedgerRecord` | `@arnilo/prism` | Durable run/event/tool-call/usage ledger attached via `AgentConfig.runLedger` / `RunOptions.runLedger`. |
| `SessionAppendOptions` / `SessionAppendConflictError` / `SessionBranchHandle` | `@arnilo/prism` | Atomic append, retry dedup, durable branch handles. |
| `AgentDefinition.tools` / `skills` | `@arnilo/prism` | Named, fail-closed capability activation (Phase 38). |
| `activateAllCapabilities` | `@arnilo/prism` | Temporary all-tools/all-skills compatibility opt-in while migrating. |

## Outputs / response / events

These migrations are configuration swaps: they do not add `AgentEvent` variants or change runtime event order. The observable differences are:

- reads come from a database instead of an in-memory map / JSONL file;
- branches are addressable by a storable `(sessionId, leafId)` handle;
- a run leaves durable `RunRecord` / `AgentEventRecord` / `ToolCallRecord` / `UsageRecord` rows;
- an agent with omitted `tools`/`skills` activates **no** capabilities instead of every in-scope one.

## Request/response example

Persistence migration (before/after):

```json
// Before — development SessionStore, single process, no ledger.
{
  "store": "createMemorySessionStore() | createJsonlSessionStore(path)",
  "runLedger": null,
  "ownership": null
}
```

```json
// After — host-implemented database-backed adapter + durable ledger.
{
  "store": "createDbSessionStore({ pool })",
  "runLedger": "createDbRunLedger({ pool })",
  "ownership": { "tenantId": "t1", "accountId": "a1", "userId": "u1" }
}
```

Capability migration (before/after):

```json
// Before (pre-Phase 38) — omitted tools/skills could receive every scoped capability.
{ "name": "doc", "model": "openai/gpt-4o" }

// After — explicit names; omitted means none.
{ "name": "doc", "model": "openai/gpt-4o", "tools": ["read"], "skills": ["brief"] }
```

## Implementation example

### Migration 1 — in-memory / JSONL → database-backed persistence

Runnable references: [`examples/workflow-sqlite-resume.ts`](../examples/workflow-sqlite-resume.ts), credential-gated [`examples/workflow-postgres-resume.ts`](../examples/workflow-postgres-resume.ts), and the network-free custom-adapter example [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts).

Step 1: replace the development store with a first-party adapter. Use PostgreSQL instead when multiple processes or sustained concurrent writers matter.

```ts
// Before: development store, single process.
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
const oldStore = createJsonlSessionStore("./sessions.jsonl");

// After: local durable adapter. The same object implements SessionStore,
// RunLedger, ProductionPersistenceStore, checkpoints, and leases.
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
const store = createSqlitePersistence({ filename: "./prism.db" });
```

Custom adapters remain supported through `SessionStore` / `ProductionPersistenceStore`; implement indexed `readBranchPath()` rather than full-session scans.

Step 2: optionally attach a durable run/event/tool/usage ledger and ownership scope so a process exit leaves enough to resume and bill:

```ts
import { createAgent, type RunLedger } from "@arnilo/prism";

const runLedger: RunLedger = {
  // appendRun / appendEvent / appendToolCall / appendUsage — redact before storage, preserve per-run order
  async appendRun(record) { /* insert prism_runs */ },
  async appendEvent(record) { /* insert prism_agent_events with monotonic sequence per run_id */ },
  async appendToolCall(record) { /* insert prism_tool_calls */ },
  async appendUsage(record) { /* insert prism_usage */ },
};

const agent = createAgent({
  model,
  provider,
  store,
  runLedger,
  ownership: { tenantId: "t1", accountId: "a1", userId: "u1" },
});
```

Step 3: store branch handles `(sessionId, leafId)` in your app state and use checkout to move an existing session to a previous or sibling leaf. The runtime's branch helpers (`getSessionBranchEntries`, `rebuildSessionContext`) consume `readBranchPath` so large sessions never require a full `list(sessionId)` load.

What you leave behind and why:

- `createMemorySessionStore()` — process-local maps; lost on restart, no cross-process locking. Keep for tests.
- `createJsonlSessionStore()` — single-process file adapter; reads are linear in file size, no cross-process lock, no durable idempotency table, two writers to the same file can race. Keep for local/dev only.

Prism 0.0.5 persistence adapters automatically apply additive schema step `002_usage_scope`, then `003_run_feedback`. Migration 003 creates immutable owned run/trace feedback with a run FK, cascade deletion, JSON tag/scorer/evaluation ID lists, and owner/run/trace cursor indexes. Existing rows are unchanged. Custom adapters may omit optional `ProductionPersistenceStore.feedback`; adopters implement `RunFeedbackStore` append/query/delete semantics and must verify exact linked-run ownership before insert.

See [Database persistence](database-persistence.md) for the full reference schema, indexes, conditional-append transaction pattern, retention, and NoSQL mapping; [Session stores](session-stores.md) for the `SessionStore` contract and branch helpers; [Session stores and branching](session-stores-and-branching.md) for branch semantics; [Runs and usage ledger](runs-and-usage.md) for the `RunLedger` record shapes and ordering rules.

### Migration 2 — permissive capability defaults → explicit capability activation

Pre-Phase 38 behavior could treat an omitted `tools` list as "every scoped tool"; some hosts also expected all scoped skills to be available. Phase 38 changes the safe default: omitted `tools` and omitted `skills` mean no active capabilities.

```ts
import { resolveAgentDefinition } from "@arnilo/prism";

// Before: omitted tools could receive every scoped tool.
resolveAgentDefinition({ name: "doc", model: "openai/gpt-4o" }, context);

// After: list the capabilities this agent may use.
resolveAgentDefinition(
  { name: "doc", model: "openai/gpt-4o", tools: ["read"], skills: ["brief"] },
  context,
);
```

Temporary compatibility shim (use only while migrating old configs):

```ts
resolveAgentDefinition(
  { name: "legacy", model: "openai/gpt-4o" },
  { ...context, activateAllCapabilities: true },
);
```

`activateAllCapabilities: true` intentionally scans/list-activates every in-scope tool/skill. New configs should list names and use strict contribution registries so a third-party package cannot silently shadow a capability name:

```ts
import { createContributionRegistries } from "@arnilo/prism";

const registries = createContributionRegistries({ duplicate: "error" });
```

Runtime skill activation remains explicit: `RunOptions.activeSkills` narrows per run after an agent has a skill registry configured, and `Skill.toolNames` is enforced fail-closed before the first provider turn. See [Agent definitions](agent-definitions.md), [Context and skills](context-and-skills.md), and [Contribution registries](contribution-registries.md) for the full capability semantics.

## Extension and configuration notes

- **Persistence remains host-configured.** Optional SQLite/PostgreSQL packages ship adapters and versioned setup, but hosts choose connection paths/pools, TLS, credentials, retention, tenant policy, and lifecycle. Core only consumes `SessionStore`, `RunLedger`, feedback, checkpoint, and lease contracts.
- **`RunLedger` is not a `SessionStore` replacement.** Messages, branches, and session entries still flow through `SessionStore.append()`; the ledger records run/event/tool/usage facts. See [Runs and usage ledger](runs-and-usage.md).
- **Capability activation is config over code.** Every seam lives on `AgentDefinition` / `AgentDefinitionResolutionContext` / `RunOptions`; no auto-activation, no privilege grant. A declaration cannot grant permissions or bypass `toolNames`.
- **Migration order is decoupled.** You can adopt database persistence without changing capability activation, and vice versa. Both migrations are independent config swaps.
- **Strict duplicate mode for new registries.** `createContributionRegistries({ duplicate: "error" })` makes a third-party package fail loud instead of silently shadowing a capability name during migration.

## Security and performance notes

- **Never store provider credentials or secrets in the persistence contract.** `ProductionPersistenceStore`, `RunLedger`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`, and `AgentDefinitionRecord` never require API keys, resolvers, or provider instances. Redact `SessionEntry` / event / tool-call / usage payloads before storage; the runtime redacts `AgentEvent`s via `redactAgentEvent` and ledger records via `redactRunLedgerRecord` before calling the adapter.
- **JSONL is a development-only adapter.** No cross-process lock, no durable idempotency table, no tenant isolation, no retention enforcement, no migrations. Do not use it as a production multi-writer store.
- **Avoid full-session scans in production.** Implement `readBranchPath(query)` with a recursive CTE / ancestor query and cursor-paginate `query*` from indexed columns. `list(sessionId)` + in-memory parent walk is the development fallback only.
- **`activateAllCapabilities` widens blast radius.** It activates every in-scope tool/skill, so prefer named lists. Strict duplicate mode catches capability-name collisions early.
- **`toolNames` enforcement is fail-closed.** A skill demanding an inactive tool throws at activation, before any provider turn — for both the old and new migration paths.

## Related APIs

- [Evaluations](evaluations.md): optional `@arnilo/prism-evals` scorers/datasets/experiments over `AgentRunResult`.
- [AI SDK provider adapter](providers/ai-sdk.md): optional `@arnilo/prism-provider-ai-sdk` `LanguageModelV4` bridge.
- [Working and semantic memory](working-and-semantic-memory.md): optional `@arnilo/prism-memory` working/semantic recall primitives.
- [Retrieval-augmented generation](rag.md): optional text/Markdown chunk, index, retrieval, and citation helpers.
- [Web-standard server handler](server.md): optional authorized agent/workflow HTTP routes.
- [Supervisor delegation](supervisors.md) and [A2A interoperability](a2a.md): optional install only; core agent/workflow behavior is unchanged. Child factories now receive package-derived memory IDs and narrowing permission, while remote endpoints require exact HTTPS origin allow-lists.
- [MCP client/server exposure](mcp-tools.md): selected MCP tools/commands and bounded Web transport.
- [Database persistence](database-persistence.md): production contracts, reference schema, indexes, conditional append, retention, migrations, and custom adapters.
- [SQLite persistence](sqlite-persistence.md): local durable first-party adapter and writer ceiling.
- [PostgreSQL persistence](postgres-persistence.md): pooled multi-process adapter, TLS/pool ownership, and live gate.
- [Session stores](session-stores.md): `SessionStore` contract, `SessionAppendOptions`, `SessionAppendConflictError`, branch handles, `readBranchPath`.
- [Session stores and branching](session-stores-and-branching.md): detailed branch semantics and helper reference.
- [Runs and usage ledger](runs-and-usage.md): `RunLedger` record shapes, redaction, and event/usage ordering.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL adapter and its limits.
- [Agent definitions](agent-definitions.md): declarative `AgentDefinition`, `resolveAgentDefinition`, and the explicit-capability-activation migration.
- [Context and skills](context-and-skills.md): `RunOptions.activeSkills`, `Skill.context`, `toolNames` enforcement.
- [Contribution registries](contribution-registries.md): strict `duplicate: "error"` mode for capability shadowing prevention.
- [Release and install](release-and-install.md): packaged surfaces and the offline test budget that gate these migrations.
