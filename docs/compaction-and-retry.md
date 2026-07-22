# Compaction and retry policies

## What it does

Compaction helpers summarize older branch history without deleting raw session entries. Retry helpers retry transient provider-turn failures before any assistant output is observed.

Current APIs:

- `createDefaultCompactionStrategy(options?)`
- `isCompactionEntryData(value)`
- `CompactionEntryData`
- `CompactionOptions`
- `DefaultCompactionStrategyOptions`
- `AgentSession.compact(options?)`
- `AgentConfig.compaction` / `RunOptions.compaction`
- `createDefaultRetryPolicy(options?)`
- `isTransientErrorInfo(error)`
- `waitForRetry(decision, signal?)`
- `RetryPolicy`, `RetryContext`, `RetryDecision`, `RetryOptions`, `RetryMiddlewarePayload`
- `AgentConfig.retry` / `RunOptions.retry`

## When to use it

Use compaction when a host wants provider input rebuilt from a summary plus recent messages while preserving the full branch in the session store. Use `session.compact()` for explicit compaction or `thresholdEntries` for opt-in auto-compaction before provider input.

Do not use it as vector memory, semantic search, provider-backed summarization, a store rewrite, a database migration, CLI/RPC command, provider-specific HTTP adapter, or whole-run retry loop.

## Inputs / request

```ts
createDefaultCompactionStrategy(options?: DefaultCompactionStrategyOptions): CompactionStrategy
```

`DefaultCompactionStrategyOptions`:

| Field | Purpose |
| --- | --- |
| `name` | Optional strategy name; defaults to `default-compaction`. |
| `keepRecentEntries` | Number of recent message entries to keep in provider context; defaults to `8`. |
| `maxSummaryChars` | Maximum summary length; defaults to `4000`. |
| `secrets` | Exact known secret strings to redact from generated summaries. |

`CompactionOptions` can be placed on `AgentConfig.compaction`, `RunOptions.compaction`, or passed to `session.compact(options?)`:

| Field | Purpose |
| --- | --- |
| `strategy` | Optional `CompactionStrategy`; defaults to `createDefaultCompactionStrategy()`. |
| `thresholdEntries` | Enables auto-compaction when current branch entries exceed this count. Omit it for no auto-compaction. |
| `keepRecentEntries` | Number of recent message entries kept in provider context. |
| `maxSummaryChars` | Maximum default summary length. |
| `secrets` | Exact known secret strings to redact from summaries/events/store text. |
| `metadata` | Explicit host metadata passed to the compaction strategy only. |
| `signal` | Optional manual compaction abort signal. |

`RunOptions.compaction: false` disables configured auto-compaction for that run. `CompactionContext` also accepts optional `keepRecentEntries`, `trigger`, and `secrets`. Context values override or add to strategy defaults for that compaction call.

Retry policy setup:

```ts
createDefaultRetryPolicy(options?: DefaultRetryPolicyOptions): RetryPolicy
```

`RetryOptions` can be placed on `AgentConfig.retry` or `RunOptions.retry`:

| Field | Purpose |
| --- | --- |
| `policy` | Optional `RetryPolicy`; defaults to `createDefaultRetryPolicy(options)`. |
| `maxAttempts` | Total provider-turn attempts; defaults to `3`. |
| `baseDelayMs` | First retry delay; defaults to `100`. |
| `maxDelayMs` | Backoff cap; defaults to `1000`. |
| `secrets` | Exact known secret strings to redact from retry errors/events. |
| `metadata` | Explicit host metadata for retry policy context. |

`RunOptions.retry: false` disables configured retry for that run. Default classification retries generic transient codes/messages such as `ETIMEDOUT`, `ECONNRESET`, `429`, `500`, `502`, `503`, `504`, `timeout`, `rate_limit`, and `temporarily_unavailable`; aborts and non-transient errors fail closed.

`CompactionEntryData` is stored in `SessionEntry.data` for compaction entries:

| Field | Purpose |
| --- | --- |
| `throughEntryId` | Last older branch entry covered by the summary. |
| `keepEntryIds` | Recent message entry ids to keep as raw provider context. |
| `strategy` | Strategy that produced the entry. |
| `trigger` | `manual`, `auto`, or a host-defined trigger string. |

## Outputs / response / events

`createDefaultCompactionStrategy().compact(context)` returns a `CompactionResult` with:

- `summary`: a conservative text summary of older user/assistant text, summary entries, model changes, labels, and tool-call/result labels.
- `entries`: one `kind: "compaction"` session entry whose parent is the current branch leaf.

`session.compact(options?)` emits `compaction_started`, runs the strategy on the current branch, runs `middleware.run("compaction", { context, result })` when middleware is configured, appends one standard `kind: "compaction"` entry under the current leaf, emits `compaction_finished`, and returns the appended result. Manual compaction rejects while a run is active.

Auto-compaction checks at most once per `run()`, after input/model-change entries are appended and before provider input assembly. It runs only when `AgentConfig.compaction` or `RunOptions.compaction` supplies `thresholdEntries`, and it is skipped by `RunOptions.compaction: false`.

`rebuildSessionContext()` detects the latest compaction entry on a branch. Its returned `entries` still contains the raw full branch, while `messages` contains only messages after the compaction boundary plus `keepEntryIds`, and `summaries` contains the compaction summary plus later summary entries.

Provider-turn retry wraps only the current provider request after input assembly. It emits `retry_scheduled`, waits with native abort-aware timers, and retries only if the failure happened before `message_started`, `message_delta`, or tool-call output was emitted. It does not retry missing providers, aborts, tool dispatch failures, unknown tools, validation failures, or post-output provider failures.

## Request/response example

```json
{
  "kind": "compaction",
  "summary": "user: older question\nassistant: older answer",
  "data": {
    "throughEntryId": "entry_10",
    "keepEntryIds": ["entry_11", "entry_12"],
    "strategy": "default-compaction",
    "trigger": "manual"
  }
}
```

## Implementation example

```ts
import { createAgent, createDefaultCompactionStrategy, createDefaultRetryPolicy, rebuildSessionContext } from "@arnilo/prism";

const strategy = createDefaultCompactionStrategy({
  keepRecentEntries: 4,
  maxSummaryChars: 2000,
  secrets: [apiKey],
});

const result = await strategy.compact({
  sessionId: "s1",
  entries: await store.list("s1"),
  trigger: "manual",
});

for (const entry of result.entries ?? []) await store.append(entry);
const snapshot = rebuildSessionContext(await store.list("s1"));

const agent = createAgent({
  model,
  provider,
  compaction: { strategy, thresholdEntries: 40, keepRecentEntries: 8 },
  retry: { policy: createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 50 }) },
});
const session = agent.createSession({ id: "s1" });
await session.run("hello", { compaction: { thresholdEntries: 20 } });
await session.compact({ keepRecentEntries: 4 });
```

## Extension and configuration notes

Retry policies are ordinary `RetryPolicy` implementations and can be registered as `retryPolicy` contributions. Hosts must still pass the selected policy/config to `createAgent()` or `session.run()`. Retry middleware receives `{ context, decision }` before a retry is scheduled and can reduce delay or stop retrying. First-party providers emit `ErrorInfo.code` as the numeric HTTP status so the default policy's transient-code set (`429`/`500`/`502`/`503`) classifies retryability without provider-specific core branches; `@arnilo/prism-provider-neuralwatt` additionally exports `classifyNeuralWattError()` for hosts that want structured `Retry-After`/`retry_strategy` metadata.

Compaction strategies are ordinary `CompactionStrategy` implementations. Extensions can register strategies through the existing compaction strategy contribution registry, but registration is inert until a host explicitly selects and passes a strategy to runtime code. Extensions can also register `compaction` middleware; the runtime calls it only when the agent/session has that middleware registry configured.

The default strategy does not call a provider. Hosts that need model-generated summaries can use the optional [`@arnilo/prism-compaction-llm` package](compaction-llm.md); its `maxOutputTokens`/`maxSummaryTokens` budget is passed through `model.parameters.maxTokens` and first-party providers serialize that to provider output-token fields. Coding sessions can select that package's `createCodingCompactionStrategy()` preset for paths, patch intent, checks, plans/todos, blockers, and next verification steps; it remains an ordinary `CompactionStrategy` and does not retain complete diffs or add a coding runtime. Hosts that need prepared source-backed memory without a compaction-time model call can use [`@arnilo/prism-compaction-observational-memory`](compaction-observational-memory.md).

## Security and performance notes

- Raw session entries are never deleted or rewritten by these helpers or by runtime compaction.
- Default compaction is O(n) over supplied branch entries and uses only arrays/strings.
- Runtime compaction context excludes provider requests, provider objects, credential resolvers, resolved credentials, settings, and hidden metadata.
- The default summary excludes metadata, provider requests, provider objects, credential resolvers, resolved credentials, settings, and full tool result values.
- Redaction only removes exact known secret strings passed in `secrets`.
- Default retry uses native abort-aware timers only when a retry is scheduled; no worker, queue, network probe, or dependency is used.
- Retry context excludes provider request messages/content, provider objects, credentials, credential resolvers, and settings.

## Related APIs

- [LLM compaction package](compaction-llm.md): optional provider-backed compaction preparation helpers.
- [Observational memory compaction package](compaction-observational-memory.md): optional source-backed memory ledger, worker runtime, fast no-model compaction strategy, projection, render, and recall utilities.
- [Session stores and branching](session-stores-and-branching.md): branch entries, compaction entries, and `rebuildSessionContext()` behavior.
- [Input and prompt assembly](input-and-prompt-assembly.md): compacted summaries become default summary messages for provider input.
- [Agent/session runtime](agent-session-runtime.md): `session.compact()`, opt-in auto-compaction, `RunOptions.retry`, and `retry_scheduled` runtime behavior.
- [Middleware hooks](middleware-hooks.md): `compaction` and `retry` middleware payload timing.
- [Contribution registries](contribution-registries.md): compaction strategy and retry policy contributions.
- [Configuration and manifests](configuration-and-manifests.md): `compactionStrategy` and `retryPolicy` manifest contribution kinds.
- [Provider layer](provider-layer.md): safe provider error codes used by retry classification.
- [Credentials and redaction](credentials-and-redaction.md): exact secret redaction helper used by default compaction and retry error handling.
- [LLM compaction package](compaction-llm.md): `createCodingCompactionStrategy()` is the thin coding-focused preset; see `examples/coding-compaction.ts` for a network-free mock.

Runtime redaction composes with compaction and retry secret lists: configured redactors apply at session serialization boundaries, while compaction/retry `secrets` still redact their local summaries and errors.
