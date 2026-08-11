# Observational memory compaction package

## What it does

`@arnilo/prism-compaction-observational-memory` is an optional package for source-backed observational memory and fast compaction.

Current status: ledger/projection/render/recall utilities, explicit worker runtime, fast compaction strategy, inert extension helper, recall tool, and status/view command factories are available.

This package is distinct from `@arnilo/prism-memory` working/semantic memory: observational memory compresses and recalls source-backed observations/reflections; semantic memory retrieves embeddings; working memory stores the current structured profile/state. Hosts may compose both.

## Four-layer provider context

Observational memory composes four independent layers for long sessions (Mastra-style):

| Layer | What it holds | How it is produced |
| --- | --- | --- |
| **Recent exact messages** | Last `context.recentMessages` user/assistant/tool entries in branch order (optional `recentMessageMaxTokens` trim, oldest first) | `buildObservationalMemoryContextBlocks()` → `recent-messages` ContextBlock; aligned with compaction `keepRecentEntries` |
| **Observation log** | Source-backed facts with 12-hex ids and `sourceEntryIds` | Observer worker on eligible unscanned `message` entries after `observation.messageTokens`; coverage advances even on empty passes |
| **Reflections** | Higher-level summaries over observation ids | Reflector worker on observations after last reflection coverage when `reflection.observationTokens` met |
| **Raw-source retrieval** | Exact branch messages behind a memory id or cursor page | `recallObservationalMemory()` / `recallObservationalMemoryBranchPage()` / `createRecallMemoryTool()` — exact-id or cursor paging only; no semantic search |

Activation is explicit: `createObservationalMemory().attach()` coordinates post-run observe/reflect/drop and `context.compactAfterTokens` compaction. Import and extension `setup` start nothing. Recall, commands, and utilities fail closed on invalid ids, wrong `sessionId`, ambiguous tool input, or oversized pages. Pass `secrets` for exact-value redaction in render/recall/worker paths. Branch isolation: hosts supply current-branch `appendEntry` and `getEntries`; mismatched store/session pairs fail closed after append.

See `examples/observational-memory-lifecycle.ts` for attach → turn → projection/recall/page without live credentials.

## When to use it

Use it when a host wants to opt in to long-session memory that records observations/reflections as session custom entries, renders prepared memory during compaction, and supports exact-id recall.

Use `createObservationalMemoryCompactionStrategy()` when compaction should render prepared memory without a model call. Prism core still does not select this package by default.

## Inputs / request

Memory records use `SessionEntry.kind: "custom"` with `entry.data.type` markers:

| Type | Payload |
| --- | --- |
| `om.observations.recorded` | `{ observations, coversUpToId? }` — successful observer runs append coverage even when `observations` is empty. |
| `om.reflections.recorded` | `{ reflections, coversUpToId? }` |
| `om.observations.dropped` | `{ observationIds, coversUpToId? }` |
| `om.folded` | Compaction `data.memory` folded details. |

Ids are known, source-backed 12-character lowercase hex strings matching `^[a-f0-9]{12}$`.

Worker limits are finite positive safe integers:

| Runtime option | Default | Hard cap | Scope |
| --- | ---: | ---: | --- |
| `maxWorkerTurns` | 16 | 64 | Provider turns per observer/reflector/dropper run; overrides settings `agentMaxTurns` |
| `maxWorkerToolCallsPerTurn` | 32 | 256 | Calls retained from one provider response |
| `maxWorkerToolCalls` | 128 | 1,024 | Calls across all turns in one worker run |
| `maxWorkerArgumentBytes` | 64 KiB | 1 MiB | Each raw and redacted JSON argument object |
| `maxWorkerResultBytes` | 64 KiB | 1 MiB | Full tool result and replayed value/error payload |
| `maxWorkerMessageBytes` | 1 MiB | 8 MiB | System/prompt plus assistant-call/tool-result transcript |
| `maxWorkerErrorBytes` | 1 KiB | 8 KiB | Provider/tool/runtime error text after exact known-secret redaction |
| Rendered memory projection | — | 256 KiB | `renderObservationalMemory()` / context block text |
| Folded compaction payload | — | 512 KiB | `data.memory` JSON; strategy trims lowest-relevance observations before failing |
| Recent-message window | — | 512 KiB | `renderRecentMessageWindow()` hard cap |
| Recall page size | 20 | 100 | `retrieval.pageLimit` / recall tool `limit` |

Direct `runObserver()` / `runReflector()` / `runDropper()` calls retain required `maxTurns` and accept the corresponding shorter worker fields (`maxToolCalls`, `maxResultBytes`, etc.). Named default/hard constants and `resolveMemoryWorkerLimits()` are exported.

## Outputs / response / events

Key exports:

| Export | Purpose |
| --- | --- |
| `foldObservationalMemoryLedger()` | Fold custom memory entries into observations, reflections, drops, and coverage markers. |
| `isEligibleObservationSourceEntry()` / `eligibleObservationSources()` | Select user/assistant/tool `message` entries for observer input. |
| `unscannedEntries()` / `observationsUncoveredByReflection()` | Dual coverage helpers for observation scan and reflection windows. |
| `buildObservationalMemoryProjection()` | Build active/full/folded projections from current branch entries. |
| `buildObservationalMemoryContextBlocks()` | Render observational-memory + recent-messages context blocks for provider input. |
| `selectRecentMessageEntries()` / `renderRecentMessageWindow()` | Bounded exact recent-message suffix; count via `keepRecentEntries`, optional token trim via `estimateEntryTokens`. |
| `createFoldedMemoryDetails()` | Create JSON details for compaction `data.memory`. |
| `renderObservationalMemory()` | Render reflections and observations into a prepared memory summary. |
| `recallObservationalMemory()` | Recover source evidence for a known observation/reflection id from supplied current-branch entries. |
| `recallObservationalMemoryBranchPage()` | Page eligible user/assistant/tool messages around a cursor entry id (`forward`/`backward`, optional `detail: summary|full`). |
| `createMemoryId()` / `isMemoryId()` | Create/check 12-character ids. |
| `resolveObservationalMemorySettings()` | Merge `observational-memory` settings with defaults and overrides. |
| `createObservationalMemory()` / `attach()` | One activation wires post-run observe/reflect/drop and `compactAfterTokens` compaction; returns proxied session, runtime, context provider, and strategy. |
| `createObservationalMemoryRuntime()` | Low-level explicit flush for advanced hosts or tests. |
| `createObservationalMemoryCompactionStrategy()` | Render existing folded memory as a standard Prism compaction summary with `data.memory`. |
| `createObservationalMemoryExtension()` | Inert extension helper that registers the strategy contribution unless disabled. |
| `createRecallMemoryTool()` | Optional `recall` tool factory: exact id lookup or current-branch message paging via host-supplied entries. |
| `createMemoryStatusCommand()` / `createMemoryViewCommand()` | Optional `om:status` and `om:view` command factories. |
| `createObservationalMemoryCommands()` | Convenience factory returning status and view commands. |

Pure utilities create no events, workers, tools, commands, credentials, or provider requests. `createObservationalMemoryExtension()` and import alone start nothing. `createObservationalMemory().attach()` runs workers only after proxied `run`/`prompt`/`stream`/`compact` complete (or after `wrapResumeRun` / `wrapResumeStream`). `createObservationalMemoryRuntime().flush()` remains for manual/advanced use. Attached `contextProvider` renders two blocks each turn: `observational-memory` (active reflections/observations aligned to the recent-message boundary) and `recent-messages` (last `keepRecentEntries` message entries in branch order, optionally trimmed by `recentMessageMaxTokens` using `estimateEntryTokens`; oldest dropped first). Compaction uses the same `keepRecentEntries` setting. Observer input includes only eligible `message` entries (`user`, `assistant`, `tool`); memory/compaction/bookkeeping entries advance `coversUpToId` scan coverage without entering the observer prompt. Successful observer/reflector runs append coverage markers even when they record zero facts. Reflection uses only active observations recorded after the last `om.reflections.recorded` entry unless `flush({ fullReflectionRebuild: true })`. Attached `flush()` skips with `run_active` while a proxied run is in flight. The compaction strategy is O(n) over supplied entries and makes no provider call. Tool and command factories are inert until a host registers/selects them.

## Request/response example

```json
{"id":"aaaaaaaaaaaa","kind":"observation","found":true}
```

## Implementation example

```ts
import {
  buildObservationalMemoryProjection,
  createObservationalMemory,
  createObservationalMemoryCompactionStrategy,
  createObservationalMemoryExtension,
  createObservationalMemoryCommands,
  createObservationalMemoryRuntime,
  createRecallMemoryTool,
  recallObservationalMemory,
  renderObservationalMemory,
} from "@arnilo/prism-compaction-observational-memory";

const om = createObservationalMemory({
  observation: { provider: observerProvider, model: observerModel, messageTokens: 10_000 },
  reflection: { provider: reflectorProvider, model: reflectorModel, observationTokens: 20_000 },
  context: { compactAfterTokens: 81_000, recentMessages: 8 },
  retrieval: { pageLimit: 20 },
});
const attached = om.attach(session, {
  appendEntry: (entry, options) => store.append(entry, options),
  sessionModel: agent.config.model,
});
await attached.session.run("Continue from prior work");

const entries = await session.entries();
const projection = buildObservationalMemoryProjection(entries);
const summary = renderObservationalMemory(projection.reflections, projection.observations);
const evidence = recallObservationalMemory(entries, "aaaaaaaaaaaa");

const memory = createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  observation: { provider: workerProvider, model: workerModel },
  sessionModel: agent.config.model, // fallback when no worker model is configured
  maxWorkerTurns: 8,
  maxWorkerToolCalls: 64,
  maxWorkerResultBytes: 64 * 1024,
  overrides: { thinkingLevel: "low" },
});
await memory.flush();
await session.compact({ strategy: createObservationalMemoryCompactionStrategy({ keepRecentEntries: 8 }) });

const getEntries = (sessionId: string) => sessions.get(sessionId)?.entries() ?? [];
const recallTool = createRecallMemoryTool({ getEntries, secrets: [apiKey] });
const commands = createObservationalMemoryCommands({ getEntries });

await kernel.load([createObservationalMemoryExtension({ recallTool: { getEntries }, commands: { getEntries } })]);
```

## Extension and configuration notes

Settings resolve to nested `observation` / `reflection` / `dropper` / `context` / `retrieval` groups via `resolveObservationalMemorySettings()`. Defaults: `observation.messageTokens: 10000`, `reflection.observationTokens: 20000`, `context.compactAfterTokens: 81000`, `context.recentMessages: 8`, `context.observationsPoolMaxTokens: 20000`, `dropper.targetTokens: 10000` (from `context.observationsPoolTargetTokens`), `retrieval.pageLimit: 20`, `agentMaxTurns: 16`, `passive: false`, `debugLog: false`. Optional `context.recentMessageMaxTokens` trims the recent-message context window (oldest first) after the count limit.

Pre-0.0.19 flat settings keys (`observeAfterTokens`, `reflectAfterTokens`, `compactAfterTokens`, `keepRecentEntries`, `recentMessageMaxTokens`, `observationsPoolMaxTokens`, `observationsPoolTargetTokens`, `workerModel`, `thinkingLevel`, `requireExplicitModel`) were removed in 0.1.5 — pass the nested replacements instead (see [migration](migration.md) for the key-by-key table). Settings-provider JSON or untyped option objects that still carry a removed key fail closed before any worker/provider call, compaction, or session append with a `TypeError` naming the key and its replacement.

Observer/reflector/dropper may use separate providers, models, instructions, thinking levels, credentials, and `requireExplicitModel`. `dropper.policy: "lowest-relevance"` drops deterministically without a model call; default is `"model"`. Workers resolve only from the nested `observation` / `reflection` / `dropper` configs plus `sessionModel` fallback — the top-level `workerProvider` / `workerModel` aliases were removed in 0.1.5.

Token counting uses `estimateEntryTokens()` / `estimateMessageTokens()`.

The runtime requires host-supplied `session`, an `appendEntry` callback bound to that session's owning store/branch, and at least one worker provider (`observation.provider` / `reflection.provider` / `dropper.provider`). Model selection uses [use-case model selection](use-case-model-selection.md): pass per-worker `model` (or settings `observation.model` / `reflection.model` / `dropper.model`) to override, and `sessionModel: agent.config.model` so workers fall back to the session model when no worker model is configured. `requireExplicitModel: true` restores the historical `missing_model` skip when no explicit worker model is set. It no longer accepts a separate `store` option because mismatched session/store pairs can append memory entries outside the active branch. After each memory append, the runtime checks the appended entry is visible at the session leaf and fails closed/restores the previous checkout if the callback points elsewhere. Optional credential resolution is explicit; missing requested credentials skip worker execution. Default credential requests use the **resolved** model's provider id.

`createObservationalMemoryCompactionStrategy()` keeps recent message entries like the default compaction strategy, renders existing observations/reflections as the summary, and returns a standard Prism compaction entry. Its `data` includes `throughEntryId`, `keepEntryIds`, `strategy`, `trigger`, and `memory: { type: "om.folded", version: 1, fullFold, observations, reflections, droppedObservationIds }`. When active observations exceed `context.observationsPoolMaxTokens`, it performs a full fold and synchronously trims lowest-relevance observations until the folded payload fits hard byte/token caps (or throws a typed error).

`createRecallMemoryTool()` accepts either `{ id }` for exact memory recall or `{ cursor, limit?, direction?, detail? }` for current-branch raw-message paging (default limit 20, hard cap 100). Reflection recall resolves supporting observations from the full ledger and reports `droppedSupportingObservationIds` / `missingSupportingObservationIds`; dropped supports still return available raw sources. Invalid ids, ambiguous requests, wrong `sessionId`, missing cursors, non-message cursors, and oversized pages fail closed. It does not search by topic.

`createMemoryStatusCommand()` reports recorded/dropped/active/visible observations, recorded/visible reflections, pool token counts, and optional runtime in-flight/last-error state. `createMemoryViewCommand()` renders visible memory by default or full active recorded memory with `{ mode: "full" }`; other modes return `Usage: /om:view [full]`.

`createObservationalMemoryExtension()` registers only inert contributions. It does not start workers, compact sessions, read settings, resolve credentials, call providers, or execute tools/commands during setup.

## Security and performance notes

- Recall is exact-id only; there is no semantic search, vector store, or transcript browser.
- Recall tool and commands only see current-branch entries supplied by the host callback.
- Invalid or missing ids fail closed; invalid recall tool ids skip entry lookup.
- Utilities and fast compaction are O(n) over supplied entries and use no provider, network, filesystem, timer, worker, credential, or settings access.
- Workers serialize only supplied branch entries within `maxWorkerMessageBytes`, enforce finite turns/calls/arguments/results/messages/errors, and run one consolidation pipeline at a time per runtime. Source serialization and reflection/drop prompts fail before joining beyond the transcript cap.
- Every provider call must name a registered worker tool. Unknown calls, call overflow, oversized/deep/cyclic/non-JSON arguments/results, and transcript overflow fail deterministically; no excess call enters the assistant transcript or executes.
- Raw arguments are measured before tool execution. Full results are measured before redaction/replay; the bounded redacted value/error is then measured again because replacement text can grow. Replayed call arguments, tool values/errors, runtime `lastError`, and debug error data contain exact known-secret redaction. Host tools may already have caused side effects before returning an invalid oversized result; keep worker tools small/idempotent.
- Worker transcripts replay assistant `tool_call` messages before matching role `tool` `tool_result` messages so provider requests stay valid for call/result-pairing providers. Calls produced on the final allowed turn execute and persist, but no additional provider turn starts.
- Compaction preserves raw history; Prism appends one standard compaction entry and rebuilds provider context from its summary plus kept recent messages.
- Pass known secrets to render/recall/runtime/tool/command helpers to redact exact values from prompts, records, structured results, and text output.
- Live tests are opt-in with `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1`.

## Related APIs

- [Use-case model selection](use-case-model-selection.md): session vs worker model binding and `resolveUseCaseModel`.
- [Thinking and reasoning](thinking-and-reasoning.md): `thinkingLevel` → provider `compat`.
- [Compaction and retry policies](compaction-and-retry.md): replaceable compaction strategy boundary.
- [LLM compaction package](compaction-llm.md): existing optional compaction-package pattern.
- [Session stores and branching](session-stores-and-branching.md): branch entries that observational memory reads and appends to.
- [Extensions](extensions.md): inert registration pattern for optional package contributions.
- [Tools](tools.md): host activation and dispatch for optional recall tool contributions.
- [CLI/RPC](cli-rpc.md): command contributions through explicitly wired RPC hosts.
