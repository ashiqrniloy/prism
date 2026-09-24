# Runs and usage ledger

## What it does

`RunLedger` is the host-implemented, write-only seam Prism uses to durably persist run metadata, agent events, tool calls, and usage during a `session.run()`. `createBatchedRunLedger()` is an explicit optional wrapper; direct ledger writes remain default. `RunFeedbackStore` is the separate post-run seam for immutable ratings, comments, tags, and evaluation links. The runtime calls the adapter as each record becomes available; the adapter decides how to write it (SQL insert, NoSQL put, JSONL append, time-series batch, etc.).

APIs:

- `RunLedger`
- `RunLedgerRecord`
- `RunRecord` / `RunStatus`
- `AgentEventRecord`
- `ToolCallRecord` / `ToolCallStatus`
- `UsageRecord`
- `redactRunLedgerRecord()`
- `RunFeedbackRecord` / `RunFeedbackStore` / `createMemoryRunFeedbackStore()`

## When to use it

Configure `AgentConfig.runLedger` when you want every run of an agent to be persisted. Override it per run with `RunOptions.runLedger` if a single run needs a different adapter or no adapter at all. Use `runLedger` whenever you need durable observability, billing, audit replay, or run-scoped analytics.

Do not use `RunLedger` as a replacement for `SessionStore` — messages, branches, and session entries continue to go through `SessionStore.append()`. Do not use it for live streaming; subscribers still receive `AgentEvent` through `session.subscribe()`. Realtime voice tokens settle through `ModelRouter.recordUsage` with `kind: "generation"` (see [Realtime voice](realtime-voice.md)); missing usage stays unknown, never zero.

## Inputs / request

Set the ledger and optional ownership scope/idempotency key on the agent or the run:

| Field | Where | Purpose |
| --- | --- | --- |
| `runLedger` | `AgentConfig` / `RunOptions` | `RunLedger` adapter. `RunOptions.runLedger` wins. |
| `ownership` | `AgentConfig` / `RunOptions` | `{ tenantId?, accountId?, userId? }` copied into every record. `RunOptions.ownership` wins. |
| `idempotencyKey` | `AgentConfig` / `RunOptions` | Optional key for run deduplication. `RunOptions.idempotencyKey` wins. |

`RunLedger` methods:

| Method | Record | When called |
| --- | --- | --- |
| `appendRun` | `RunRecord` | After run starts (`running`) and again at finish (`suspended`/`denied`/`succeeded`/`failed`/`aborted`). |
| `appendEvent` | `AgentEventRecord` | After every emitted `AgentEvent`, after redaction. |
| `appendToolCall` | `ToolCallRecord` | For each tool-call `started`, `progress`, `finished`, `error`, and `blocked` transition. |
| `appendUsage` | `UsageRecord` | Once per terminal provider turn (`scope: "provider_turn"`) and once for the O(turns) aggregate (`scope: "run_total"`). |

All methods may be sync or async (`void | Promise<void>`). The runtime awaits them at safe boundaries, so a slow adapter blocks the run.

## Run limits

`RunLimits` bounds one `session.run()` across turns, provider attempts, tool rounds/calls, elapsed wall time, request/response bytes, token usage, optional cost, and stop-hook continuations (`maxStopContinuations`, default 3). Configure defaults on `AgentConfig.limits`; `RunOptions.limits` can only narrow an agent-configured value.

```ts
await session.run("Summarize", {
  limits: {
    maxTurns: 4,
    maxProviderAttempts: 6,
    maxToolCalls: 8,
    maxWallTimeMs: 30_000,
    maxTotalTokens: 12_000,
    maxCost: { amount: 0.25, currency: "USD" },
  },
});
```

Defaults are the unconfigured fence (OWASP LLM10): turns 16, provider attempts 24, tool rounds 8, tool calls 32, wall time 120 seconds, request and response bytes 8 MiB each, input tokens 40,000, output tokens 10,000, total tokens 50,000. Hard process ceilings exist only for request/response bytes (64 MiB each), so a bug cannot OOM the host through a giant provider frame; those two axes reject `null` and are charged **per frame** (request payload, provider event), not as a run-lifetime sum — a 2 MiB prompt sent forty times is 2 MiB frames, not an 80 MiB parse. Snapshots still report the cumulative `requestBytes`/`responseBytes` counters for telemetry. Every other axis is host policy (0.5.4): omit a key for the default, set a positive safe integer sized to the workload, or set `null` to disable the axis — overnight sessions raise turns/wall/tokens, and a disabled wall still honors `RunOptions.signal`. Resolution stays narrowing-only: `RunOptions.limits` may lower `AgentConfig.limits`, `null` acts as +Infinity (agent 16 + run `null` → 16), and a raised/disabled `maxTurns` lifts an omitted `maxProviderAttempts` (default 24) to at least `maxTurns` so attempts cannot undercut turns; explicitly set attempts values are lifted only when both are finite. Cumulative token counters are billed usage across the whole run, not the context window (`contextBudget` governs window compaction). For production, prefer an explicit `maxCost`: cost needs a finite non-negative amount plus one currency, and when cost is limited, absent, non-finite, or mixed-currency provider cost fails closed. Vendors that omit usage charge their
labeled estimate (or zero with `usageEstimation: "off"`) to the token counters and never a
price, so a configured `maxCost` stays the fail-closed envelope for usage-less vendors.

Prism charges turns before assembly, provider attempts before generation, request bytes per request payload, response bytes per provider event (each frame must fit the byte cap on its own), tool rounds before a batch, tool calls before dispatch, and usage before another turn. A breach stops new work, aborts active work through the run signal, emits exactly one redacted `run_limit_exceeded` event/ledger row, and throws `AgentRunError` with `result.limit` (`limit`, `maximum`, `observed`, optional `currency`) plus `result.attribution` (`consumed`, `closestOtherAxes`, `recentToolCalls`). Just before the terminal `error`, the run also emits one `budget_exhausted` attribution event carrying that same payload — the axis that fired, run counters at exhaustion, the three closest other axes, and hashes of the last ten dispatched tool calls ([Agent events § Run limit events](agent-events.md#run-limit-events)). Provider-reported token/cost totals arrive after generation, so that completed provider turn can be the unavoidable overshoot boundary.

`createRunLimitTracker()` and `resolveRunLimits()` are public for adapters that need the same validation and accounting semantics. Workflow agent nodes forward `RunWorkflowOptions.limits`; supervisor delegation narrows its step/tool/token/timeout budget into core limits; MCP tool calls use a per-call tracker.

## Token estimation (provider reports no usage)

When a provider reports no usage, `estimateMessageTokens(messages, modelFamily)` returns a labeled `TokenEstimate` instead of a silent zero. An estimate is never provider truth: reported usage always wins and is never overwritten. The array form reuses the same message flattening as budget accounting and adds the family's per-message chat-template overhead; the single-message form `estimateMessageTokens(message)` remains the numeric budget heuristic used by `contextBudget`.

```ts
import { estimateMessageTokens, MODEL_FAMILY_TOKENS, resolveModelFamily } from "@arnilo/prism";

const estimate = estimateMessageTokens(messages, "claude-sonnet-4.5"); // model id, provider id, or family name
// { tokens: 41_200, confidence: "medium", lowConfidence: false }
```

`MODEL_FAMILY_TOKENS` holds the chars/token ratio, per-message overhead, and confidence label per family (`anthropic`, `openai`, `google`, `deepseek`, `openrouter-generic`, `mistral`, `unknown`). `resolveModelFamily(modelId)` maps a model id or provider id to a table key; unmatched input resolves to `unknown`, whose row is the most conservative (highest estimated token count) and carries `confidence: "low"` / `lowConfidence: true`. Estimates are heuristics, not tokenizers: prose, fenced code, and CJK content are weighted separately, and every calibrated family is `confidence: "medium"` because Prism ships no real tokenizer. The estimator is pure — no network, no I/O, and no content retention. `MODEL_FAMILY_TOKENS` is frozen at runtime (every row and the table), so ratios cannot be overridden in place — recalibration stays a source change plus the live leg below, never a runtime override.

Row provenance and recalibration: reference counts per family are frozen in `src/__tests__/fixtures/usage-calibration.json` — `openai` measured against `o200k_base` (dev-time oracle; no tokenizer ships), `anthropic`/`google`/`mistral` as their published chars/token guidance, and `deepseek`/`openrouter-generic` as row-basis values (no public count endpoint). `src/__tests__/usage-calibration.test.ts` fails when a shipped row drifts outside the recorded bands (prose ±12%, CJK ±20%, per-message overhead ±1 token). To re-measure, run `PRISM_LIVE_PROVIDER_TESTS=1` with `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY`/`GOOGLE_API_KEY` and `node --test scripts/usage-calibration-live.test.mjs` (matrix suite `calibration/vendor-count-tokens`): it posts the fixed corpus to `POST /v1/messages/count_tokens` and `POST /v1beta/models/{model}:countTokens`, asserts each shipped row against the measured count, and refreshes `docs/_evidence/phase103-family-token-calibration.md`. A measurement outside its band means updating the row in `src/usage-estimation.ts` and the fixture counts in one change.

### Automatic fallback (`AgentConfig.usageEstimation`)

`usageEstimation` is `"fallback"` (default), `"off"`, or `"strict"`. With the default, a provider turn that reports no usage records one labeled estimate at the existing usage seam — no adapter changes:

- the `provider_turn_finished.usage` carries `{ inputTokens, estimated: true, confidence }`, and its `budgets.inputTokens`/`runInputUsed` use that estimate, with `budgets.inputTokensSource` labeling the figure's provenance (below), so the attention axes and run limits from plans 086/087 work on non-reporting models;
- ledger `appendUsage` rows (`scope: "provider_turn"` and the `run_total` aggregate) and `AgentRunResult.usage` keep `estimated: true` (plus `confidence`) — a billing surface can always tell an estimate from a report;
- estimates are **never priced**: the cost catalog is not consulted, and estimated usage carries no `cost`/`currency`, so a `maxCost` limit still fails closed instead of blocking on invented numbers;
- `"off"` leaves absent usage absent — no ledger row, no run total, never a zero.
- `"strict"` (plan 103 T5) records nothing and refuses the turn instead. The run ends with `AgentRunResult.error` `{ name: "UsageMissingError", code: "usage_missing" }`, the terminal `error` event carries the same info, exactly one provider attempt is made — the refusal is an observable failure, so no retry policy retries it. No ledger usage row, no `run_total` aggregate, and no cost-catalog lookup happen: `usage` stays absent, never zero. The refusal is a harness decision, not a provider failure: no `failureClass` is stamped, and `metadata.stopReason: "provider_error"` on that turn is the shared error-path stop, not a claim about the provider. Because the refusal is decided before the existing fail-closed `maxCost` breach, a cost-limited host gets `usage_missing` instead of a confusing `budget_exhausted` attribution. A provider that *fails* a turn without reporting usage is not refused — its own error (and the retry policy) still applies, so strict never masks a provider failure.

The estimate covers the turn's own request — messages plus tool declarations and context blocks — and prefers the most exact measurement that already exists (plan 103 T6), in this order:

1. **The budget pass's own measurement.** When `AgentConfig.contextBudget` sets `reportOmissions: true`, the request carries a `ContextBudgetReport`, and the fallback reuses its `keptTokens` verbatim — the same whole-request figure (post-eviction messages, context, skills, tool declarations) that decided evictions, so usage accounting and budget decisions can never show two different numbers for the same request. It is measured at budget time, so content added afterwards (tail segments, middleware edits) is not included — a measured 19.2–19.4% shortfall with an ≈8k-character post-budget append and 0.0% without one (`docs/_evidence/phase112-primitive-review.md` §4.4) — and `confidence` names the basis: `"high"` when a host `tokenEstimator` made the measurement, `"low"` for the built-in ÷4 basis (uncalibrated).
2. **The host tokenizer.** With `contextBudget.tokenEstimator` and no report, the fallback projects the request through that tokenizer — per message plus tool/context portions — using the assembler's own text shapes (the `measureAll` tool-list line and context-block text, never `JSON.stringify` of the schemas), validated exactly like the budget pass validates it. `confidence: "high"`: a host tokenizer's count is still an estimate (`estimated: true`), never `"reported"`.
3. **The family heuristic** (plan 091): the model id's family table for messages (per-message overhead included), and those same assembler text shapes for the tool/context portions.

All three paths keep `estimated: true` and are never priced. `usageEstimation: "off"` and `"strict"` never consult the report or the tokenizer — their behavior is decided before any measurement.

`budgets.inputTokensSource` labels the figure's provenance: `"reported"` when the provider reported that turn's own usage, `"estimated"` for any of the three fallback paths above, and absent together with `inputTokens`. The payload shape is in [Agent events § Run limit events](agent-events.md#run-limit-events).

### `session.contextMeter()`

One state read for host UIs (Clay's token meter, Synapta's model-router budgets):

```ts
const meter = session.contextMeter();
// { inputTokens: 43_000, source: "estimated", inputCap: 200_000, runInputBudget: 500_000, usedRatio: 0.215 }
```

`inputTokens` is the latest provider turn's input tokens — `source: "reported"` when the provider reported them, `"estimated"` when they are the labeled fallback (or, before any provider turn in the session, an estimate of stored history, so a fresh non-reporting model still shows a working meter). `inputCap` is resolved exactly like `provider_turn_finished.budgets.inputCap` (model window minus output reserve minus `attentionCompiler.reserveTokens`), `runInputBudget` is `RunLimits.maxInputTokens` while a run is active, and `usedRatio` is `inputTokens / inputCap`. Cap/budget/ratio are omitted when the model or run cannot derive them. The meter is never billing and never rewrites reported usage; `compact()` drops the pre-compaction reading so the next read re-estimates. Reads are cached — the same frozen object is returned until the history changes (an appended entry, a steer push, a compaction), the branch leaf moves, or the active run's identity changes, so polling the meter per frame costs one estimate per mutation instead of one per read (measured: 1,000 reads over a 200k-character history in 0.11 ms, against ≈0.47 ms for one uncached estimate).

## Clean stops and stop reasons

A run can end without an error but also without the model finishing its thought: a host `RunOptions.turnPolicy.stop`, a `turnPolicy.maxTurns` cap, a loop ceiling, or the stop-hook continuation cap. `AgentRunResult.stopReason` names that outcome — `"host_policy"` for a host policy stop, `"hook_limit"` when `limits.maxStopContinuations` refused a continuation, `"turn_limit"`, `"token_limit"`, or `"refusal"` for loop ceilings — with `turnPolicy.stop`'s own string in `stopDetail`. A natural end carries neither field, so hosts that only care about "did it stop early?" check truthiness. The same values ride the emitted `agent_finished` event (as `finishReason`/`stopDetail`), the finish `RunRecord`, and the projected [Execution Timeline](execution-timeline.md).

A `host_policy` stop is terminal for the run yet resumable: with `runState: { checkpointPolicy: "every-turn" }` the stopped state keeps its frontier, and `resumeAgentRun(..., { decision: "continue" })` picks the loop up at the boundary. A `hook_limit` stop is resumable the same way. Every other terminal state is final. See [Agent loops § Turn policy](agent-loops.md#turn-policy) and [Hooks](hooks.md).

## Provider failure classes

Provider-originated failures carry advisory `ErrorInfo.failureClass` on the failed `AgentRunResult`, terminal `RunRecord`, error events, and any `ToolResult.error` that already carries that `ErrorInfo`. Values are `"quota"`, `"auth"`, `"rate_limited"`, `"transient"`, `"permanent"`, and `"unknown"`. The classifier uses an already-captured HTTP status plus bounded error body: quota-shaped `429` responses (for example `GoUsageLimitError`) are `"quota"`; other `429` values are `"rate_limited"`; `401`/`403` are `"auth"`; `5xx` and known network codes such as `ECONNRESET` are `"transient"`; other `4xx` values are `"permanent"`; anything else is `"unknown"`.

This field is outcome metadata, not a retry control. Existing retry policy, attempt limits, and fail-closed behavior continue to use `ErrorInfo.code` exactly as before. Prism records no provider headers or response bodies beyond the existing redacted error message.

## Durable run state

`RunOptions.runState` writes a bounded, versioned checkpoint only at a safe interruption boundary. Its counters and absolute deadline resume with the run, while transcript history stays in `SessionStore` by session/leaf reference. `AgentRunResult.runState` exposes only redacted identity/status/version data; `interruption` excludes tool arguments. See [Agent/session runtime](agent-session-runtime.md#durable-interruption).

## Outputs / response / events

The adapter receives these record shapes:

`RunRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Same as `runId`. |
| `sessionId` | Session id. |
| `branchId` | Current branch leaf at run start. |
| `model` | Resolved model config for the run. |
| `provider` | Resolved provider id for the run. |
| `idempotencyKey` | Optional host key. |
| `status` | `queued` \| `running` \| `suspended` \| `denied` \| `succeeded` \| `failed` \| `aborted`. |
| `startedAt` / `finishedAt` | ISO timestamps. |
| `abortReason` | Set when status is `aborted`. |
| `stopReason` | Why the loop stopped cleanly instead of reaching a natural end: `host_policy` (`RunOptions.turnPolicy.stop`), `hook_limit` (stop-hook continuation cap), `turn_limit`, `token_limit`, or `refusal`. Absent on a natural end. |
| `stopDetail` | Host stop detail from `turnPolicy.stop` (≤256 bytes, redacted). |
| `error` | `ErrorInfo` when status is `failed`. |
| `tenantId` / `accountId` / `userId` | From active ownership scope. |

`AgentEventRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Unique ledger row id. |
| `runId` / `sessionId` / `entryId` | Correlation ids. |
| `type` | `AgentEvent["type"]` discriminator. |
| `timestamp` | Event emission time. |
| `event` | The emitted `AgentEvent`. |
| `redacted` | `true` when a `SecretRedactor` is active. |

`ToolCallRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Unique ledger row id. |
| `toolCallId` / `name` | From the provider tool call. |
| `arguments` | JSON object passed to the tool. |
| `result` | `ToolResult` for `finished`/`error`/`blocked` rows. |
| `status` | `started` \| `finished` \| `error` \| `blocked`. Progress snapshots reuse `started` with `progress` fields. |
| `reason` | Block reason for `blocked` rows (`unknown_tool`, `tool_denied`, `invalid_arguments`, `permission_denied`, `validation_failed`). |
| `progress` / `progressMetadata` / `progressAt` | Populated on progress snapshots. |
| `startedAt` / `finishedAt` | Tool-call timing. |
| `redacted` | `true` when a `SecretRedactor` is active. |

`UsageRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Unique ledger row id. |
| `runId` / `sessionId` / `entryId` | Correlation ids. |
| `scope` | `provider_turn` for billable source rows; `run_total` for the aggregate. Never sum both scopes. |
| `turn` / `attempt` | Provider-turn attribution; absent on `run_total`. |
| `usage` | `Usage` shape: input/output/total/cache tokens, cost, currency. Cache fields stay absent when provider does not report them; an explicit provider zero remains `0`. |
| `recordedAt` | ISO timestamp. |

## Cost/catalog freshness (host adapter)

Prism ships no pricing tables. Cost fields on usage rows come from exactly two sources: the provider's own reported cost (wins when present), or — when the provider reports none — the optional host-supplied `CostCatalog` adapter on `AgentConfig.costCatalog`:

```ts
import type { CostCatalog } from "@arnilo/prism";

const agent = createAgent({ /* … */, costCatalog: hostCatalog });
```

`CostCatalog.get(modelId)` returns a [`ModelCost`](#related-apis) quote (repo-wide `per_million_tokens` unit convention) or `undefined` for unknown or stale models — a catalog with expired TTL entries must resolve them to `undefined`, not throw, so freshness lapses degrade to usage-only rows instead of wrong money math. Quotes in any other unit are ignored for the same reason. Catalog lookups happen once per provider turn, only when a cost field is missing, and only when a catalog is configured: without one, zero cost code paths execute. Catalog failures (throwing `get`) also degrade to usage-only. Computed cost flows into `provider_turn` rows and the `run_total` aggregate through the normal no-double-billing rules above.

## Prompt provenance

Hosts that resolve prompts from the [versioned prompt registry](prompt-registry.md) can stamp each run with the resolved version's identity. `RunOptions.promptVersion` takes `{ name, version, hash }` — an opaque [ref](#related-apis): `name` is the prompt name (1–256 UTF-8 bytes), `version` the immutable version number (integer in `[1, 2147483647]`), and `hash` the prompt store's SHA-256 body hash (`sha256:` plus 64 lowercase hex). The ref is copied verbatim onto the run's start and finish ledger records; when it is omitted nothing is added and behavior is byte-identical. Malformed refs fail closed with a `TypeError` before the run starts.

```ts
const resolved = await promptStore.resolve({ tenantId, name: "support-agent" });
await session.run(input, {
  promptVersion: { name: resolved.name, version: resolved.version, hash: resolved.hash },
});
```

Provenance is identity, not content: never put prompt bodies in the ref or in `metadata` — the body is recoverable from the store via `hash`, and ledger records/exports run through the existing secret redaction and field-policy boundaries. OTel spans deliberately carry no prompt attribute; the durable ledger record is the provenance of record.

## Run/trace feedback

`RunFeedbackStore.append()` accepts an immutable record only when `resolveRun` finds the same `runId` under the exact `{ tenantId, accountId?, userId? }` scope. A tenant plus account or user is mandatory. Records contain `sessionId`, optional `traceId`, finite `rating` in `[-1, 1]`, comment, tags, scorer IDs, evaluation IDs, timestamp, creator, and metadata. Correction appends a new ID; records are never updated in place. `delete()` is the explicit privacy/retention operation.

```ts
import { createMemoryRunFeedbackStore } from "@arnilo/prism";

const feedback = createMemoryRunFeedbackStore({
  resolveRun: ({ runId }) => runId === result.runId
    ? { runId, sessionId: result.sessionId, tenantId: "t1", userId: "u1" }
    : false,
  redactor,
});
await feedback.append({
  id: "fb_1",
  runId: result.runId,
  rating: 1,
  comment: "Useful and cited",
  tags: ["reviewed"],
  evaluationIds: ["eval_1"],
  tenantId: "t1",
  userId: "u1",
});
const page = await feedback.query({ runId: result.runId, tenantId: "t1", userId: "u1", limit: 50 });
await feedback.delete({ id: "fb_1", tenantId: "t1", userId: "u1" });
```

Default/hard bounds: comment 4/16 KiB, tags 16/64, scorer/evaluation IDs 16/64 each, metadata 16/64 KiB, query page 100/500; tags are 64 characters and identifiers 128. `@arnilo/prism-core/governance/evals` may read `queryRuns/queryEvents/queryToolCalls/queryUsage` only through an explicit owner/session/run-scoped trace resolver with finite cursor pages and aggregate bytes. The store redacts comment/tags/metadata after run ownership validation and before persistence. IDs are linked, not scorer payloads. `ProductionPersistenceStore.feedback?` exposes this capability; first-party SQLite/PostgreSQL adapters implement it in schema migration `003_run_feedback` and reject missing/cross-owned runs.

## Status transitions

```
queued ──> running ──> succeeded
              │
              ├──────> failed
              │
              └──────> aborted
```

- `queued` is reserved for host scheduling and is not emitted by the runtime.
- `running` is written immediately after provider/model resolution and `agent_started`.
- `succeeded` / `failed` / `aborted` are written once in `finally`.
- Only the final `RunRecord` contains `finishedAt`, `abortReason`, or `error`.

## Request/response example

```json
{
  "id": "run_abc",
  "sessionId": "session_1",
  "branchId": "branch_1",
  "provider": "openai",
  "model": { "provider": "openai", "model": "gpt-4o" },
  "status": "succeeded",
  "startedAt": "2024-01-01T00:00:00Z",
  "finishedAt": "2024-01-01T00:00:05Z",
  "tenantId": "tenant_a",
  "idempotencyKey": "run-key-123"
}
```

```json
{
  "id": "toolcall_def",
  "sessionId": "session_1",
  "runId": "run_abc",
  "toolCallId": "call_1",
  "name": "echo",
  "arguments": { "text": "hi" },
  "status": "finished",
  "result": { "toolCallId": "call_1", "name": "echo", "value": { "text": "hi" } },
  "startedAt": "2024-01-01T00:00:01Z",
  "finishedAt": "2024-01-01T00:00:02Z",
  "redacted": false
}
```

## Implementation example

```ts
import {
  cacheUsageReport,
  createAgent,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  type RunLedger,
  type RunRecord,
  type AgentEventRecord,
  type ToolCallRecord,
  type UsageRecord,
} from "@arnilo/prism";

const runs: RunRecord[] = [];
const events: AgentEventRecord[] = [];
const toolCalls: ToolCallRecord[] = [];
const usageRows: UsageRecord[] = [];

const ledger: RunLedger = {
  appendRun: async (record) => { runs.push(record); },
  appendEvent: async (record) => { events.push(record); },
  appendToolCall: async (record) => { toolCalls.push(record); },
  appendUsage: async (record) => { usageRows.push(record); },
};

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone({ inputTokens: 1_000, cacheReadTokens: 800 })]),
  runLedger: ledger,
  ownership: { tenantId: "tenant_a", accountId: "account_a" },
  idempotencyKey: "agent-key",
  redactor: createSecretRedactor([process.env.APP_KEY!]),
});

const session = agent.createSession({ id: "session_1" });

// per-run override
await session.run("Hello", {
  idempotencyKey: "run-key-123",
});

console.log(runs.at(-1)?.status); // succeeded
const billable = usageRows.filter((row) => row.scope === "provider_turn");
const aggregate = usageRows.find((row) => row.scope === "run_total");
console.log(cacheUsageReport(aggregate?.usage));
// { cacheReadTokens: 800, hitRate: 0.8 } — cacheWriteTokens stays absent when unreported
```

## Extension and configuration notes

### Production ledger adapter checklist

- Treat `RunLedger` as write-only from Prism's point of view; expose replay/query APIs through `ProductionPersistenceStore` or host-owned reads.
- Preserve ordering within each `runId`; allocate a monotonic event `sequence` before acknowledging durable writes.
- Store `RunRecord.idempotencyKey` for host-level run deduplication, but never put credentials or provider clients in idempotency rows.
- Redact before durable writes if the adapter transforms records after Prism redaction. Persist `redacted: true` when a redactor was active.
- Test the full persistence path with the network-free [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts) pattern: run, event, tool-call, usage, branch checkout/fork, and resume queries.

- `AgentConfig.runLedger` applies to every run of the agent. `RunOptions.runLedger` overrides it for a single run.
- `AgentConfig.ownership` is the default ownership scope; `RunOptions.ownership` overrides it per run.
- `AgentConfig.idempotencyKey` is the default idempotency key; `RunOptions.idempotencyKey` overrides it per run.
- The runtime resolves `model` and `provider` from `AgentConfig`/`RunOptions`/`AgentDefinition` before writing the start `RunRecord`.
- Adapters should treat appends as ordered within a `runId`: event and tool-call rows preserve emission order because the runtime serializes event ledger appends through one promise chain (concurrency 1), drains pending appends before writing the final `RunRecord`, and propagates append failures by rejecting run completion.
- Billing queries must filter `scope = "provider_turn"`; presentation queries normally read the single `run_total`. `UsageQuery.scope`, `turn`, and `attempt` are explicit filters.
- Adapters that need upsert semantics can use `RunRecord.id` (== `runId`) as the stable key.
- Use `cacheUsageReport(record.usage, model)` for cache diagnostics from normalized usage. It reports `cacheReadTokens` without `cacheWriteTokens` when that is all a provider supplies; neither token field nor hit rate is fabricated as zero. `provider_turn_finished.metadata.cache` carries that same per-attempt report, while `ExecutionTimeline.cacheHitRate` is the input-token-weighted run aggregate.
- **Provider-specific telemetry is package-owned.** Core `Usage` carries token counts and `cost`/`currency`; it has no energy or detailed cost-breakdown fields. Providers that surface extra telemetry (e.g. `@arnilo/prism-providers/neuralwatt` exposes `neuralWattEventsWithTelemetry()`, `parseNeuralWattComment()`, and `mapNeuralWattTelemetry()` for `: energy`/`: cost` SSE comments and non-streaming top-level fields) keep that data in package-specific helpers/types. Telemetry never enters `RunLedger` usage rows unless the host explicitly copies it in; it carries usage/cost numbers only — never prompts, API keys, or headers. Account-level quota is likewise package-owned: `@arnilo/prism-providers/neuralwatt` exports an explicit `getNeuralWattQuota()` helper that the host calls on demand (never during generation); NeuralWatt rate-limits that endpoint to 1 request per second per customer, so the caller owns throttling.
- **Governed provider lifecycle and reservation reconciliation.** For invocation-level accounting outside of or in addition to `RunLedger`, wrap providers with `createGovernedProvider` or `router.createGovernedProvider` from `@arnilo/prism-core/governance/model-router`. The adapter handles atomic admission reservations, bounds streaming, and guarantees explicit settlement: missing actual usage on an interrupted or EOF stream is committed as reserved liability (`unknownUsage: true`) rather than zero, avoiding budget leakages or unmetered oversubscriptions. See [Model routing](model-routing.md).
- **Aggregate task/tenant accounting across all paid work.** Complex agent tasks often span retries, model fallbacks, delegated children, background compactions, embedding jobs, and paid tools. Passing `taskId` and `kind` (`"generation" | "embedding" | "compaction" | "tool"`) coordinates all related calls under a single atomic task-level reservation and budget scope. Committed usage decomposes into separate `byModel` and `byKind` attributions (`router.readBudget({ identity, taskId })`) while preventing double-charging across parent/child boundaries or replayed events. Long-running holds can be safely renewed via `router.renewBudget({ ... })` before expiry without prematurely releasing live liability. See [Model routing](model-routing.md) and [Enterprise PostgreSQL state](enterprise-postgres-state.md).

## Security and performance notes

- **No credentials.** `RunLedger` records never contain `AIProvider`, `CredentialResolver`, `ProviderResolver`, provider API keys, or credential values. They store only ids, status, timestamps, and the public event/result/usage shapes.
- **Redaction.** The runtime calls `redactRunLedgerRecord()` and `redactAgentEvent()` with the active `SecretRedactor` before handing records to the adapter. `AgentEventRecord.redacted` and `ToolCallRecord.redacted` are set to `true` when a redactor is configured. Hosts should still redact before writing to durable storage if they perform additional transformations.
- **Message content stays in `SessionStore`.** `AgentEventRecord.event` may contain `message_delta` / `message_finished` payloads; these are redacted but still belong conceptually to the session store. Do not use the ledger as the source of truth for messages.
- **Cache diagnostics stay numeric.** `cacheUsageReport()` derives reports from `Usage` numbers and optional `ModelConfig.cost`; do not add prompt text, cache keys, headers, credentials, or provider payloads to usage rows.
- **No double billing.** Sum `provider_turn` rows or read `run_total`; never sum both. Run totals add every turn/attempt in O(turns), derive missing per-turn totals from input/output tokens, and omit aggregate cost when reported currencies conflict.
- **Synchronous adapters block the run.** An adapter that performs network or heavy DB writes inline will slow down the agent loop. For high-throughput hosts, buffer or batch inside the adapter and return quickly; the runtime awaits the returned promise. If batching, preserve per-run order before acknowledging a batch: `appendEvent` rows should be pageable by `(runId, sequence)`, run rows by `(sessionId, startedAt, id)`, and usage rows by `(runId, recordedAt, id)`.
- **Idempotency is host-owned.** The runtime writes the key into `RunRecord.idempotencyKey`; enforcing unique keys and deduplicating retries is the host adapter's responsibility.
- **Tenant isolation.** `OwnershipScope` fields are copied from the active ownership scope, but the runtime does not enforce tenant isolation for ledger rows. Feedback is stricter: append/query/delete require tenant plus account/user, and first-party stores compare the exact scope to the linked run.
- **Feedback privacy.** Comments/tags/metadata can contain PII. Configure a feedback redactor, apply retention, and call owned `delete()` for erasure. Never copy comments or tag values into metric labels.
- **Policy audit is separate.** Enterprise allow/deny/modify/approval rows with evidence refs live in optional `@arnilo/prism-core/governance/policy`, not `RunLedger`. See [Policy and audit](policy-and-audit.md).

## Optional batching and durability

```ts
const ledger = createBatchedRunLedger(store, {
  maxBatchEntries: 128,
  maxBatchBytes: 512 * 1024,
  maxDelayMs: 25,
  durability: "flush_on_terminal",
});
```

Modes: `write_through` acknowledges each target write; `flush_on_terminal` buffers but runtime awaits terminal flush; `buffered` acknowledges enqueue only and requires host `flush()` for durability. `status()` distinguishes accepted/flushed/buffered counts. Defaults/hard caps: 128/4,096 batch entries, 512 KiB/8 MiB batch bytes, 25 ms/60 s delay; buffered count/bytes apply backpressure before enqueue. FIFO spans all record kinds. Inputs are already runtime-redacted. Flush errors propagate and retain the failing record for retry. `dispose({ flush: false })` clears memory but deliberately loses unflushed records—same crash-before-flush ceiling as process failure.

Runtime session snapshots cache one leaf/generation for at most one second. Successful append, compaction append, checkout, and durable resume invalidate; failed append does not advance leaf/cache. Cache is session-local and never shared across ownership/session/branch.

## Related APIs

- [Policy and audit](policy-and-audit.md): optional enterprise decision ledger (separate from run usage rows).
- [Performance limits](performance.md): batching, cursor keys, and production sizing assumptions.
- [Agent/session runtime](agent-session-runtime.md): `session.run()` and runtime event emission.
- [Agent events](agent-events.md): `AgentEvent` union and `session.subscribe()`.
- [Tools](tools.md): `ToolResult`, `ToolCallContent`, and `dispatchToolCall()`.
- [Database persistence](database-persistence.md): reference relational schema for runs, events, tool calls, and usage.
- [Session store conformance](session-store-conformance.md): pair ledger tests with the session-store adapter baseline.
- [Session stores](session-stores.md): `SessionStore` contract for session entries and branches.
- [Credentials and redaction](credentials-and-redaction.md): `createSecretRedactor()` and redaction helpers.
- [Provider caching](provider-caching.md): cache hints and `cacheUsageReport()` diagnostics.
- [Observability](observability.md): `provider_turn_*` events, tool duration metadata, OpenTelemetry adapter.
- [Public contracts](public-contracts.md): full contract inventory.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): `AgentEventRecord` pages become redacted, ownership-scoped, at-least-once replay only through an explicit host adapter.
