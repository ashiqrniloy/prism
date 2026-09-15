# Migrate Prism 0.6 to 0.7

> **Status: 0.7.0** (Host Completeness, Evidence, and Capability Boundaries).

This document details migration steps, security tightenings, and compatibility notes for upgrading from Prism 0.6.0 to 0.7.0.

---

## Security Tightenings and Breaking Behavioral Changes

### 1. ACP MCP Destination Matching (Trap A)

In Prism 0.6.0 and earlier, `@arnilo/prism-acp-agent` matched candidate MCP server URLs against `mcp.allow` using string prefix matching (`server.url.startsWith(entry)`). This permitted:
- **Origin lookalikes**: An allow entry for `https://mcp.example.com` inadvertently matched `https://mcp.example.com.attacker.invalid/mcp`.
- **Path prefix bleeding**: An allow entry for `https://mcp.example.com/mcp` matched sibling paths like `https://mcp.example.com/mcp-other`.

In Prism 0.7.0, destination matching strictly adheres to WHATWG URL origin and path-segment subtree standards:

- **Origin matching**: Normalizes scheme (`http:` / `https:`), hostname (case-insensitive, punycode IDN, IPv6 brackets), and effective port (default ports 80/443 normalized). Lookalike hosts are rejected.
- **Path-segment subtree matching**:
  - Origin-level entries (e.g. `https://mcp.example.com` or `https://mcp.example.com/`) match any path under that exact origin.
  - Path-scoped entries (e.g. `https://mcp.example.com/mcp` or `https://mcp.example.com/mcp/`) match `/mcp`, `/mcp/`, and `/mcp/sub`, but reject sibling prefixes such as `/mcp-other` or `/mcpextra`.
- **Configuration validation**:
  - Every `mcp.allow` entry in `prism-acp-agent.json` must be `"stdio"` or a valid absolute `http:` or `https:` URL.
  - Entries containing userinfo (`user:pass@`), query parameters (`?query`), fragment identifiers (`#hash`), or ambiguous encoded path characters (`%2e%2e`, `%2f`, `%5c`, `..`, backslashes) throw `ConfigError` during config parsing.
- **Candidate URL validation**: Candidate server URLs with embedded credentials or ambiguous encoded path forms fail closed at selection time.
- **Transports**: Unstable `acp` transport remains rejected. `stdio` servers require the explicit `"stdio"` marker in `mcp.allow`.

#### Migration Actions
- Review `mcp.allow` in `prism-acp-agent.json`: remove any query strings, hashes, or credentials from allow entries.
- If previously relying on prefix matching across sibling paths (e.g. relying on `/mcp` to match `/mcp-internal`), explicitly list both entries or use an origin-level entry.

### 2. Model Router Facade Fail-Closed Governance (Trap B)

In Prism 0.6.0 and earlier, the synchronous `router.providerSource(model)` facade only checked allow-lists, residencies, and durable state presence. When configured with in-memory budgets (such as `maxCostUsd: 0` or positive limits), rate limits, circuit breakers, fallbacks, or selection policies, `router.providerSource(model)` returned an unwrapped provider and bypassed these governance controls without enforcement.

In Prism 0.7.0, `router.providerSource(model)` enforces fail-closed boundary safety:
- **Refuses unenforced governance**: If the router is configured with `budgets`, `rateLimit`, `circuit`, `fallbacks`, or `selection`, calling `providerSource(model)` throws `ModelRouterError` with stable code `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED`.
- **Refuses durable state**: If configured with `stateStore`, calling `providerSource(model)` throws `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE`.
- **Runtime validation**: Untyped JavaScript callers passing malformed model arguments fail closed before resolver invocation with `ERR_PRISM_MODEL_ROUTER_VALIDATION`.
- **Resolver isolation**: The underlying `resolver` function is never called when `providerSource` refuses or denies a request.
- **Synchronous allow-list / residency support**: Simple allow-list-only and residency-only routers without async state or governance caps remain fully supported via `router.providerSource(model)`.

#### Migration Actions

Do not use `router.providerSource(model)` when governance (budgets, rate limits, circuit breaker, fallbacks, selection policies, or durable state) is configured. Replace calls with the asynchronous admission method `await router.resolve(...)`:

```ts
// ❌ Bypasses governance in 0.6.0 / Refused in 0.7.0 (throws ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED)
const provider = router.providerSource(model);

// ✅ Governed admission in 0.7.0
const { provider, model: selectedModel, providerRequestPolicy, budgetReservation } = await router.resolve({
  model,
  identity,
  maxCostUsd: 0.25,
});

// Pass to agent
const agent = createAgent({
  model: selectedModel,
  provider,
  providerRequestPolicies: [providerRequestPolicy],
});

// Commit actual usage after run
await router.recordUsage({
  identity,
  provider: provider.id,
  model: selectedModel.model,
  tokens: runTokens,
  budgetReservation,
});
```

To test whether a router configuration supports `providerSource` before calling it, use `isProviderSourceEligible(options)` or `assertProviderSourceEligible(options)` exported from `@arnilo/prism-core/governance/model-router`.

### 3. ACP Real-Provider Launcher and Explicit Mock Mode (Trap C / R05)

In Prism 0.6.0 and earlier, `@arnilo/prism-acp-agent` silently defaulted to `createMockProvider()` when no provider was passed and no model was configured. Hosts deploying the ACP binary without explicit provider wiring ran mock sessions without warning or token generation (Trap C).

In Prism 0.7.0, `createSpawnableAgent` enforces fail-closed startup validation:

- **Explicit model required**: Config must specify a valid `model` (`{ "provider": "<name>", "model": "<id>" }`) unless a provider instance is passed via API options.
- **Credential reference required**: Real providers require `credentialRef` in the configuration. The secret value is resolved from `process.env[ref]` or an optional host `credentialResolver`. If missing or unresolvable, startup fails immediately with `ConfigError` (code `PRISM_ACP_AGENT_CONFIG`).
- **Provider matching & allow-list**: Only allow-listed first-party providers are supported (`openai`, `anthropic`, `google`, `deepseek`, `openrouter`, `ollama`, `xai`, `zai`, `alibaba`, `kimi`, `clinepass`, `commandcode`, `neuralwatt`, `opencode-go`, `hyper`, and `mock`). Unknown providers or mismatches between configured models and injected providers fail before startup.
- **Explicit mock mode**: Mock mode requires explicit configuration: `{ "model": { "provider": "mock", "model": "mock" } }` (or injected `provider.id === "mock"`). It stays 100% offline and requires no credentials.
- **Lazy provider loading**: First-party provider adapters are dynamically imported on demand on the first generation call; `@arnilo/prism-providers` is never loaded at root import or during mock runs.
- **Credential safety**: Secret values never enter config persistence, argv flags, stdout protocol streams, events, or model context. Identity records only the non-secret `credentialRef`.
- **Durable session reconstruction**: With SQLite persistence, per-session agents (including editor-backed filesystem sessions) are reconstructed across process restarts with their selected model and provider intact.

#### Migration Actions

- **For real-provider deployments**: Add `model` and `credentialRef` to `prism-acp-agent.json`:
  ```json
  {
    "userId": "local",
    "cwd": ".",
    "model": { "provider": "openai", "model": "gpt-4o" },
    "credentialRef": "OPENAI_API_KEY",
    "sessionStore": { "type": "sqlite", "path": ".prism/sessions.db" }
  }
  ```
- **For offline testing / mock journeys**: Explicitly declare mock mode:
  ```json
  {
    "userId": "local",
    "cwd": ".",
    "model": { "provider": "mock", "model": "mock" }
  }
  ```

### 4. Aggregate Task/Tenant Accounting Across All Paid Work (R01)

In Prism 0.6.0, model-router budgets were strictly per-model and per-provider (`(provider, model)`). When complex tasks involved retries, model switches, delegated child tasks, embeddings, compactions, or paid tools, each model bucket maintained separate counters, allowing budget resets through model hopping or child delegation.

In Prism 0.7.0, router state introduces unified task-level aggregate accounting:

- **Task-scoped reservations & accounting**: Supplying `taskId` and `kind` (`"generation" | "embedding" | "compaction" | "tool"`) groups all paid work for a given task under a single shared atomic budget ceiling.
- **Attribution breakdown**: Calling `router.readBudget({ identity, taskId })` decomposes total utilization into typed attributions (`byModel`, `byKind`, `attributions`).
- **Strict hard-budget mode (`budgets.strict = true`)**: In strict hard-budget mode, requests lacking enforceable bounds or candidates lacking cost pricing are denied fail-closed with `ERR_PRISM_MODEL_ROUTER_BUDGET`.
- **Hold renewal (`renewBudget`)**: Long-running holds can be renewed via `router.renewBudget()` or `governedProvider.renewBudget()` before expiry; the hold's fencing token advances and previous fencing tokens are invalidated. Expired holds fail closed with `ERR_PRISM_MODEL_ROUTER_STATE`.
- **PostgreSQL schema migration `006_aggregate_budgets`**: Adds `task_id` and `attributions` columns to `prism_model_router_budgets` with partial index `prism_model_router_budgets_task_idx`.

#### Migration Actions

- **Durable PostgreSQL deployments**: Apply migration `006_aggregate_budgets` on startup via `createPostgresEnterpriseState()`. Existing rows automatically default `task_id` to empty string and `attributions` to `{}`.
- **Task/Job workflows**: Pass `taskId` to `router.resolve()`, `recordUsage()`, and `createGovernedProvider()` to prevent budget oversubscription across retries and child agents.
- **Budget enforcement**: Set `budgets.strict: true` when hard cost/token ceilings must be guaranteed against unmetered or unpriced providers.

### 5. Durable Business-Action Draft Persistence and Resumption (R02)

In Prism 0.6.0, Microsoft 365 and Google Workspace connector mutation drafts were kept ephemerally in adapter memory. If an agent process restarted or if an asynchronous human approval took minutes or hours, drafts were lost, forcing re-creation of drafts from scratch without revision guarantees. Furthermore, modifying a draft did not systematically invalidate existing approvals.

In Prism 0.7.0, business-action drafts feature durable lifecycle tracking:

- **Checkpoint-backed draft store**: Adapters accept `checkpoints: CheckpointStore` (e.g. `createPostgresEnterpriseState({ pool }).checkpoints` or `createMemoryCheckpointStore()`) or a dedicated `draftStore: WorkDraftStore`. Drafts persist under namespace `prism.work.draft` and survive process restart.
- **Exact revision binding & payload digest**: Drafts start at `revision: 1` with a canonical SHA-256 `payloadDigest`. Approvals bind strictly to `{ draftId, revision, payloadDigest, identityKey, approvedAt, expiresAt, policyRevision }`.
- **Edits invalidate approval**: Updating draft payload or recipients increments `revision`, clears `approval`, and resets `status` to `pending_approval`.
- **Resuming approved revisions**: Tools (`m365_mail_draft_send`, `gws_mail_draft_send`, `m365_calendar_draft_add`, `gws_calendar_draft_add`) accept `{ draftId, revision }` without repeating the payload; the tool resumes the stored payload and executes after approval validation.
- **Fail-closed ambiguous failure handling**: Connector failures after dispatch mark both the idempotency record and the draft `unknown`. Automatic replays are rejected with `ERR_PRISM_WORK_IDEMPOTENCY_UNKNOWN` until operator reconciliation.

#### Migration Actions

- **For persistent workloads**: Pass `checkpoints` (and optionally `bodies: ArtifactBodyStore`) to `createMicrosoft365CliAdapter` and `createGoogleWorkspaceCliAdapter` so drafts survive process restart.
- **Approval systems**: Ensure approval decisions provide or verify `{ draftId, revision, payloadDigest }`.

### 6. RAG document authorization (R04)

`retrieveContext` without `authorization` is unchanged. Passing `authorization` injects host-verified principal/group constraints into both vector and lexical legs **before** ranking, then rechecks before rerank and injection.

- `filter` is metadata equality only. It is not document ACL.
- Stores that do not declare `authorization: "acl"` throw rather than claim protection. In-memory and PostgreSQL adapters declare it (`setSourceAccess` / `checkSourceAccess`).
- Missing grants and unresolved `accessVersion` deny. Revoking a grant (empty principal+group lists, bumped version) hides the source on the next query without re-embedding.
- `authorization.tenantId` must match every retrieve scope.

#### Migration Actions

- Hosts that need per-document ACL pass `authorization` and call `setSourceAccess` for each source. Hosts that do not pass `authorization` keep today's retrieve behavior.
- Custom `VectorStore` implementations must implement query-time ACL and `checkSourceAccess` before advertising `authorization: "acl"`.

### 7. Drive knowledge synchronization (R04)

Opt-in. `syncKnowledge` + `createGoogleDriveConnector` page Drive `files.list` / `changes.list` into existing `replaceSource` / `setSourceAccess`. Cursors live on the host `CheckpointStore` and advance only after a page commits. `changes.watch` payloads are not authorization.

#### Migration Actions

- Hosts that want incremental Drive RAG import wire a token provider (`drive.readonly`), `resolveAccess` for permissions, and a durable checkpoint key. Hosts that do not call `syncKnowledge` are unchanged.

### 8. Hosted E2B sandbox (R03)

Opt-in. `createE2BSandbox` / `connectE2BSandbox` implement `DisposableSandbox` plus `pause`/`resume`. Docker and native adapters are unchanged. E2B `Sandbox.connect` auto-resumes paused VMs; Prism reconnects paused sandboxes **without** calling it unless the host calls `resume()` or passes `resume: true`. `lifecycle.autoResume` is always false. `pause({ keepMemory: false })` is filesystem-only: processes do not survive resume. A 503 pause refusal leaves the sandbox running. `close({ export })` is unsupported (pause is the snapshot).

Default capabilities do **not** claim Docker `network: none` / egress parity.

#### Migration Actions

- Hosts that want E2B install optional peer `e2b@2.49.1` (or inject `client`) and pass `apiKey` at the edge. Hosts that keep Docker/native are unchanged.

### 9. Fair worker admission and operator routes (R06)

Opt-in. Existing `createWorkflowCoordinator` and `createPrismDrainController` stay the composition entry points. Optional `admission` adds cursor wrap, per-tenant/per-class claim caps, queue deadlines, and drain-aware claiming. `createPrismOperatorHandler` is a separate authorized handler for queue/suspended/failed/unknown inspect plus cancel/reconcile. Reconcile cannot mark unknown effects retryable. No new job broker.

#### Migration Actions

- Hosts that want fair multi-tenant workers set `admission` and mount `/ops`. Hosts that keep a single-tenant coordinator with default FIFO first-page polling are unchanged.

### 10. Behavioral eval inspector wiring (R07)

Opt-in. Trajectory scorers, scenario runner, manifests, and `summarizeTimeline` stay in `@arnilo/prism-core/governance/evals` and `@arnilo/prism-core/governance/observability`. The dev inspector adds `GET /runs/:id/summary` and `POST /compare` that render those artifacts. Host-journey fixtures live in `examples/behavior-evaluation.ts`.

#### Migration Actions

- Hosts that want inspector quality/cost/latency compare wire `eventSource` + `resolveRun` and call `compareInspectorRuns` / `POST /compare`. Hosts that keep the previous inspector timeline-only UI are unchanged.

### 11. Cross-layer memory lineage (R08)

Opt-in. `remember({ lineage: { sourceIds } })` stamps `metadata._lineage` (schema v1). `forget` / `setConsent(visible: false)` / `correct` write invalidation rows **before** body delete. Query/lexical legs exclude forgotten/revoked/held ids and any record listing them in `_lineage.sourceIds`. `correct` keeps the source (`reason: corrected`). `forget({ hold: true })` skips body delete. Missing `_lineage` is self-only. Parent-child `shareWith` is an explicit allow-list; siblings and expired grants fail closed. Observational projection/recall take `invalidatedIds`. `revokedIdsAbsent` is the 072 invariant body.

Custom `VectorStore` implementations that omit `lineage: "invalidation"` keep pre-0.7 forget-as-delete (dependents may leak). In-memory and PostgreSQL adapters declare it.

#### Migration Actions

- Hosts that want derived-context exclusion stamp `lineage` on writes and pass `authorization`/invalidation through recall. Hosts that do not stamp lineage keep self-only delete. Do not edit frozen `docs/migrate-to-0.6.md`.
- `setConsent(entryId, { visible: false })` marks `revoked` (not `legal_hold`), so recall excludes the record but a later `forget` still purges it; re-granting clears only a revoked mark and never resurrects a `corrected`/`forgotten` one. Use `forget({ ids, hold: true })` when you actually need retention.
- Observational recall keeps a reflection whose supporting observation was dropped by compaction and annotates it `(dropped)`; invalidation still wins, so a revoked observation id (or a revoked source of one) withholds the reflection with `reason: "revoked"`.

### 12. Evidence-backed citations and document diffs (R10)

Additive. `ArtifactCitation` may include `sourceId` / `revision` / `contentHash` / `retrievedAt` / `excerpt` / `span` / `tenantId` / `support`. Approvals stamp `evidenceDigest`. `checkCitationIntegrity` fails closed on missing source, hash/span mismatch, revoked ACL, or tenant mismatch; `support` is ignored. `diffDocument` walks Document Model nodes with op/node caps (`truncated` instead of unbounded diff). `createCitationIntegrityScorer` is a 072 invariant: score 0 cannot be averaged away by a semantic judge.

#### Migration Actions

- Legacy uri/title/kind citations still attach. Evidence fields are optional until the host starts integrity checks.
- Structural Office review uses `diffDocument`; artifact `compare` remains hash+metadata.

### 13. Import fidelity and optional OCR (R10)

Additive. `importDocument` returns `{ model, fidelity }` — ZIP-name report of dropped OOXML structures (macros, comments, media, …). `parseDocument` still returns the model only.

`createMistralOcrParser({ apiKey })` is a host-selected `DocumentParser`. Default `createDocumentReader()` still uses `pdf-parse` / `mammoth` only and does not call OCR. Inline data URLs; no Files API. `documentUrl` is SSRF-checked. `recordUsage` admits pages/bytes into Task 7 accounting.

#### Migration Actions

- Existing `parseDocument` callers are unchanged. Switch to `importDocument` when review UI must show lost structures.
- OCR is opt-in. Do not add the OCR parser to default `parsers`.

### 14. Per-run tool narrowing (R11)

Additive. `RunOptions.toolNames` allow-lists registered tool names for one run. Omitted = full registry (0.6 behavior). Empty = no tools. Unknown names throw. Resume persists the grant and will not widen it. MCP `execute` fails closed when a refresh changes schema/effect or revokes the tool.

Still no `RunOptions.tools` or `RunOptions.toolFilter`.

#### Migration Actions

- Existing `session.run(input)` callers are unchanged.
- Pass `{ toolNames: ["web_search"] }` when a continuing session should see a subset.

### 15. Governed realtime voice (R14)

Additive. `createRealtimeVoiceBridge` (`@arnilo/prism-core/runtime/realtime`) admits a voice device, dispatches host `function_call` items through the ordinary execute path, cancels queued calls on barge-in, and skips `seenCallIds` on reconnect. Transcripts are off by default; audio is never retained. `RealtimeEvent` may include `usage`. `RealtimeSession.completeTool` is optional. OpenAI Realtime advertises host tools via `session.update` and completes them with `function_call_output`.

#### Migration Actions

- Existing `createOpenAIRealtimeSession` callers that only send audio are unchanged.
- Wire `execute` through `dispatchToolCall` / durable approval. Session microphone consent is not tool approval.

### 16. Eval primitives match their contracts (R07)

Additive. `runExperiment({ trials: N, seed })` re-runs each item N times (cap 16) and reports `sampleCount` / `standard_error`. `wrapAgentWithFailureInjection` honors `failStore` (fails on `run`), `denyTools`, and `unknownEffect`. Timeline collection no longer uses a 10ms drain. `validateEvalManifest` stays two-field; `validateReleaseEvalManifest` adds prompt/tools/model/policy binding.

#### Migration Actions

- Existing `validateEvalManifest({ runtimeRevision, datasetVersion })` callers are unchanged.
- Call `validateReleaseEvalManifest` when packing release evidence. Do not pass `expectedBehavior`, `failStoreAfterTurns`, `denyToolCalls`, or `uncertaintyMethod: "bootstrap"` — those were docs drift, not APIs.




### 17. Native Bedrock Converse route (R12)

Additive. `@arnilo/prism-providers/bedrock` now ships a native route next to the OpenAI-compatible one: `createBedrockConverseProvider({ region, credential, stream })` runs `ConverseStream` (default) or one `Converse` call, and `createBedrockProviderPackage({ region, credential, api: "converse" })` registers it under the same `id`/model bindings. Prism messages map to `messages`/`system`/`inferenceConfig`/`toolConfig`, Prism media blocks map to `image`/`document` blocks, cache breakpoints map to `cachePoint` blocks, `options.structuredOutput` maps to `outputConfig.textFormat`, and Anthropic/OpenAI-family reasoning maps to `additionalModelRequestFields.thinking` / `.reasoning_effort`. Responses are decoded from the `application/vnd.amazon.eventstream` framing with bounded frame sizes and CRC validation, still with no AWS SDK dependency.

#### Migration Actions

- Nothing changes for existing `createBedrockProvider` / `createBedrockProviderPackage` hosts: the default route stays `compatible`.
- To move a provider id to Converse, set `api: "converse"` (and keep `stream: false` only if the deployment must avoid `InvokeModelWithResponseStream`). One provider id serves one route; register a second `id` if you need both.
- Model bindings that relied on OpenAI image parts must declare `capabilities.input` with `image`/`document` and use Prism media blocks; unsupported media types now refuse before the request instead of being dropped.
- Do not pass `cachePoint`, `toolConfig`, `outputConfig`, or `additionalModelRequestFields` through `compat`; use Prism cache breakpoints, `tools`, `structuredOutput`, and `compat.thinking`/`compat.reasoning_effort` (or `options.extra.additionalModelRequestFields` for model-specific fields).

---

## Opt-in additions (no behavior change until enabled)

### 18. Attention compiler (R17, opt-in)

`createAttentionCompiler(options?, context?)` is a per-turn gate that measures the assembled input against a host ratio of the model input cap and rewrites nothing until that ratio is reached; over the ratio it mutates a **history clone** monotonically (oldest `thinking` blocks first, then oldest fold-eligible tool results), so prompt-cache prefixes survive and the session store, observational-memory ledger, and input history array are untouched. Still over after every eligible row → `AttentionBudgetError` instead of silent eviction.

#### Migration Actions

- Nothing changes by default: with `attentionCompiler` omitted, request bytes and the store are byte-identical to 0.6.0.
- Turn it on per agent (`AgentConfig.attentionCompiler`) or per run (`RunOptions.attentionCompiler`, which narrows, never widens: `false` disables for that run).
- Hosts that compact on overflow can drive compaction from the gate instead of guessing a token threshold with the host-programmable compaction trigger.
- Do not use it as a replacement for compaction or `applyContextBudget` eviction: compaction is the boundary operation that writes a summary.

`AgentDefinition.attentionCompiler` and the direct `assembleProviderInput` seam carry the same option shape; a definition sets it for every resolved config.

### 19. Memory Fabric subpath (opt-in)

`@arnilo/prism-memory/fabric` adds typed notes over the stores a host already configured: `createMemoryFabric({ memory, observational?, linker?, ... })` writes `fact`, `procedure`, `file`, `working`, and `episode` notes through the existing working/vector stores, with links, validity windows, and time/tool recall.

#### Migration Actions

- Add the subpath import; no new package, provider, database, or mandatory dependency is introduced.
- The fabric is inert until `fabric.attach(session)`: importing the subpath starts no worker, no timer, and no process, and an unattached fabric enriches nothing.
- Episode notes (`kind: "episode"`) and `searchConversation` require an attached observational-memory session; without one they fail closed.
- Reserved keys: `metadata.fabric` on vector records and `_fabric.blocks` inside the working value. A host schema that validates working values must allow them; the host schema remains the last word on block content.
- Existing `createMemory` hosts keep working unchanged — the fabric writes through the same store, consent, redaction, and lineage paths.

### 20. Work-scope memory index (R16, opt-in)

`createWorkScopeController({ session, appendEntry, secrets? })` appends `om.scope.*` entries to one observational-memory ledger and folds them with `foldWorkScopeMap()`; `projectWorkMemory(ledger, map, query)` filters observations/reflections to a host-selected working set and `withWorkScope(controller, spec, fn)` opens/enters/leaves around a callback.

#### Migration Actions

- Nothing changes without `om.scope.*` entries: the map has only its implicit `session` root, context renders the existing active pool, and the dropper keeps its 0.6.0 behavior.
- While any host scope exists, the runtime skips the observation dropper — the working set is now the projection, and the folded-payload byte cap stays a storage safety cap, not garbage collection.
- Bindings are exact ids (`om:<12-hex>` / `reflection:<12-hex>`); a reflection bound on a **closed** scope can graduate into durable semantic memory through the fabric's `remember({ kind: "fact" | "procedure", reflectionId })`.
- Caps fail closed: 256 scopes, depth/stack 8, 4,096 binds per scope, 512-character labels/kinds, ids `[A-Za-z0-9._:/-]{1,128}` without `..`.
- `recallObservationalMemory()` still reads the complete current branch by exact id — the projection never hides memory from exact-id recall.

### 21. Host-owned subagent spawn (opt-in)

`createSupervisor({ ownership, children })` gains model-facing tools: `createSpawnAgentTool({ supervisor, name?, mode? })` returns a non-exclusive `spawn_agent` whose closed schema exposes only the host's allow-listed child IDs, `input`, an optional `threadId`, and `mode: "sync" | "async"`; `createWaitAgentTool` / `createCancelAgentTool` return `wait_agent` / `cancel_agent` for host-owned async handles. `delegateAsync()` returns `{ delegationId, status: "running" }` without waiting.

#### Migration Actions

- Nothing changes for existing `delegate()` callers; the tools are additive and opt-in.
- Advertised children come from the supervisor's own list — a model cannot name a child the host did not construct, cannot supply child tools, identity, scopes, or higher limits, and sees redacted results and error text only.
- Child identity narrows from the parent (`narrowIdentity` + `assertIdentityPropagation`): a delegated scope set must be non-empty, must not widen the parent's scopes, and must not extend the parent expiry.
- Async handles are **in-process**: ownership-scoped, bounded, cached terminal records retained only up to `limits.maxQueuedEvents`, and they do not survive a host restart. Parent-run abort propagates to running children.
- Install `createWorktreeChildFactory` (`@arnilo/prism-coding-tools/agent`) and pass its `after` as the supervisor terminal hook when parallel children would otherwise collide in one working tree; the child context then carries `cwd` pointing at its own linked worktree, and cleanup runs on every terminal outcome — including a child that suspended for approval and later resumes.
- `observeSupervisorLifecycle` (coding tools) bridges supervisor `delegation_*` events to redacted coding `subagent_started` / `subagent_stopped` lifecycle events (and AG-UI/ACP projections).

## Upgrade steps

1. Bump every `@arnilo/*` dependency and peer to `^0.7.0` (all ten manifests cut together; a range that only *satisfies* 0.7.0 is refused by the release gate). The published predecessor is 0.6.0.
2. Read §1–§3 if you run the ACP agent (`mcp.allow` entries may need tightening) or call `router.providerSource()` with governance configured — those are the only hard refusals for an existing host.
3. Re-check each §4–§17 item your host touches: they are behavioral tightenings inside existing surfaces (accounting, drafts, authorization, narrowing, fidelity), not new opt-ins.
4. Adopt the opt-in additions only where they matter: §18 attention compiler, §19 memory fabric, §20 work scopes, §21 spawn tools.
5. Build and run your suite. No persisted-data migration exists or is needed: the 0.7.0 additions write through existing stores (working/vector records, checkpoints, observational-memory entries) under the same schema, and stores still fail closed on unknown or newer schema versions rather than rewriting data.
6. Optional: re-run `npm run release:gate` locally to reproduce the release evidence matrix.

## Rollback

Pin the previous published line: `@arnilo/prism@0.6.0` (exact pins per package, plus each package's `0.6.0`). Nothing persisted under 0.7 is rewritten in place: the new subpaths and options are additive, and the fabric/scopes/spawn features write only new records through existing stores — a rolled-back 0.6.0 host keeps reading its data and simply stops seeing entries it never wrote. The refusal changes in §1–§3 are the only deltas a 0.6.0 host regains by rolling back (and it regains the unsafe prefix matching and facade bypass with them, so re-check anything relying on those).

Back up the session/checkpoint store before a rollback if the 0.7 host wrote fabric notes or scope entries you intend to keep: 0.6.0 code paths ignore them rather than deleting them, but only the 0.7 docs describe them.

## Related APIs

- [Migration guide](migration.md): the era index of migration cuts with replacement tables and rollback notes.
- [Migrate Prism 0.5 to 0.6](migrate-to-0.6.md): Node 22 floor, folded 0.5.7 delta, third-party floors.
- [Release and install](release-and-install.md): packed surfaces, install rules, support matrix, and the offline test budget.
- [Memory fabric](memory-fabric.md), [Observational memory compaction](compaction-observational-memory.md), [Attention compiler](attention-compiler.md), [Supervisors](supervisors.md): owning pages for the opt-in additions above.
