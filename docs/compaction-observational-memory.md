# Observational memory compaction package

## What it does

`@arnilo/prism-compaction-observational-memory` is an optional package for source-backed observational memory and fast compaction.

Current status: ledger/projection/render/recall utilities, explicit worker runtime, fast compaction strategy, inert extension helper, recall tool, and status/view command factories are available.

This package is distinct from `@arnilo/prism-memory` working/semantic memory: observational memory compresses and recalls source-backed observations/reflections; semantic memory retrieves embeddings; working memory stores the current structured profile/state. Hosts may compose both.

## When to use it

Use it when a host wants to opt in to long-session memory that records observations/reflections as session custom entries, renders prepared memory during compaction, and supports exact-id recall.

Use `createObservationalMemoryCompactionStrategy()` when compaction should render prepared memory without a model call. Prism core still does not select this package by default.

## Inputs / request

Memory records use `SessionEntry.kind: "custom"` with `entry.data.type` markers:

| Type | Payload |
| --- | --- |
| `om.observations.recorded` | `{ observations, coversUpToId? }` |
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

Direct `runObserver()` / `runReflector()` / `runDropper()` calls retain required `maxTurns` and accept the corresponding shorter worker fields (`maxToolCalls`, `maxResultBytes`, etc.). Named default/hard constants and `resolveMemoryWorkerLimits()` are exported.

## Outputs / response / events

Key exports:

| Export | Purpose |
| --- | --- |
| `foldObservationalMemoryLedger()` | Fold custom memory entries into observations, reflections, drops, and coverage markers. |
| `buildObservationalMemoryProjection()` | Build active/full/folded projections from current branch entries. |
| `createFoldedMemoryDetails()` | Create JSON details for compaction `data.memory`. |
| `renderObservationalMemory()` | Render reflections and observations into a prepared memory summary. |
| `recallObservationalMemory()` | Recover source evidence for a known observation/reflection id from supplied current-branch entries. |
| `createMemoryId()` / `isMemoryId()` | Create/check 12-character ids. |
| `resolveObservationalMemorySettings()` | Merge `observational-memory` settings with defaults and overrides. |
| `createObservationalMemoryRuntime()` | Explicitly run observer/reflector/dropper workers for a supplied session, owned append callback, and provider. |
| `createObservationalMemoryCompactionStrategy()` | Render existing folded memory as a standard Prism compaction summary with `data.memory`. |
| `createObservationalMemoryExtension()` | Inert extension helper that registers the strategy contribution unless disabled. |
| `createRecallMemoryTool()` | Optional exact-id `recall` tool factory backed by host-supplied current-branch entries. |
| `createMemoryStatusCommand()` / `createMemoryViewCommand()` | Optional `om:status` and `om:view` command factories. |
| `createObservationalMemoryCommands()` | Convenience factory returning status and view commands. |

Pure utilities create no events, workers, tools, commands, credentials, or provider requests. `createObservationalMemoryRuntime()` runs workers only when the host explicitly constructs it and calls `flush()`. The compaction strategy is O(n) over supplied entries and makes no provider call. Tool and command factories are inert until a host registers/selects them.

## Request/response example

```json
{"id":"aaaaaaaaaaaa","kind":"observation","found":true}
```

## Implementation example

```ts
import {
  buildObservationalMemoryProjection,
  createObservationalMemoryCompactionStrategy,
  createObservationalMemoryExtension,
  createObservationalMemoryCommands,
  createObservationalMemoryRuntime,
  createRecallMemoryTool,
  recallObservationalMemory,
  renderObservationalMemory,
} from "@arnilo/prism-compaction-observational-memory";

const entries = await session.entries();
const projection = buildObservationalMemoryProjection(entries);
const summary = renderObservationalMemory(projection.reflections, projection.observations);
const evidence = recallObservationalMemory(entries, "aaaaaaaaaaaa");

const memory = createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  workerProvider,
  sessionModel: agent.config.model, // fallback when workerModel unset
  // workerModel: { provider: "mock", model: "memory" }, // optional override
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

Settings are read from the `observational-memory` key only when a host calls `resolveObservationalMemorySettings()` or `runtime.flush()`. Defaults are `observeAfterTokens: 10000`, `reflectAfterTokens: 20000`, `compactAfterTokens: 81000`, `observationsPoolMaxTokens: 20000`, `observationsPoolTargetTokens: 10000`, `agentMaxTurns: 16`, `passive: false`, and `debugLog: false`. `agentMaxTurns` now rejects non-integer/non-finite/out-of-range input (hard 64) instead of flooring/falling back. Runtime `maxWorkerTurns` takes precedence.

The runtime requires host-supplied `session`, an `appendEntry` callback bound to that session's owning store/branch, and `workerProvider`. Model selection uses [use-case model selection](use-case-model-selection.md): pass optional `workerModel` (or settings `workerModel`) to override, and `sessionModel: agent.config.model` so workers fall back to the session model when no worker model is configured. `requireExplicitModel: true` restores the historical `missing_model` skip when no explicit worker model is set. It no longer accepts a separate `store` option because mismatched session/store pairs can append memory entries outside the active branch. After each memory append, the runtime checks the appended entry is visible at the session leaf and fails closed/restores the previous checkout if the callback points elsewhere. Optional credential resolution is explicit; missing requested credentials skip worker execution. Default credential requests use the **resolved** model's provider id.

`createObservationalMemoryCompactionStrategy()` keeps recent message entries like the default compaction strategy, renders existing observations/reflections as the summary, and returns a standard Prism compaction entry. Its `data` includes `throughEntryId`, `keepEntryIds`, `strategy`, `trigger`, and `memory: { type: "om.folded", version: 1, fullFold, observations, reflections, droppedObservationIds }`. When active observations exceed `observationsPoolMaxTokens`, it performs a full fold into `data.memory`.

`createRecallMemoryTool()` requires `args.id` to match `^[a-f0-9]{12}$`; invalid ids fail before entry lookup. Recall returns text and structured details for observations/reflections, dropped observations, supporting observations, source entries, and missing source ids. It does not search by topic.

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
