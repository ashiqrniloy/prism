# Observational memory compaction package

## What it does

`@prism/compaction-observational-memory` is an optional package for source-backed observational memory and fast compaction.

Current status: ledger/projection/render/recall utilities, explicit worker runtime, fast compaction strategy, inert extension helper, recall tool, and status/view command factories are available.

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
| `createObservationalMemoryRuntime()` | Explicitly run observer/reflector/dropper workers for a supplied session/store/provider. |
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
} from "@prism/compaction-observational-memory";

const entries = await session.entries();
const projection = buildObservationalMemoryProjection(entries);
const summary = renderObservationalMemory(projection.reflections, projection.observations);
const evidence = recallObservationalMemory(entries, "aaaaaaaaaaaa");

const memory = createObservationalMemoryRuntime({
  session,
  store,
  workerProvider,
  workerModel: { provider: "mock", model: "memory" },
});
await memory.flush();
await session.compact({ strategy: createObservationalMemoryCompactionStrategy({ keepRecentEntries: 8 }) });

const getEntries = (sessionId: string) => sessions.get(sessionId)?.entries() ?? [];
const recallTool = createRecallMemoryTool({ getEntries, secrets: [apiKey] });
const commands = createObservationalMemoryCommands({ getEntries });

await kernel.load([createObservationalMemoryExtension({ recallTool: { getEntries }, commands: { getEntries } })]);
```

## Extension and configuration notes

Settings are read from the `observational-memory` key only when a host calls `resolveObservationalMemorySettings()` or `runtime.flush()`. Defaults are `observeAfterTokens: 10000`, `reflectAfterTokens: 20000`, `compactAfterTokens: 81000`, `observationsPoolMaxTokens: 20000`, `observationsPoolTargetTokens: 10000`, `agentMaxTurns: 16`, `passive: false`, and `debugLog: false`.

The runtime requires host-supplied `session`, matching `store`, `workerProvider`, and `workerModel`. Optional credential resolution is explicit; missing requested credentials skip worker execution.

`createObservationalMemoryCompactionStrategy()` keeps recent message entries like the default compaction strategy, renders existing observations/reflections as the summary, and returns a standard Prism compaction entry. Its `data` includes `throughEntryId`, `keepEntryIds`, `strategy`, `trigger`, and `memory: { type: "om.folded", version: 1, fullFold, observations, reflections, droppedObservationIds }`. When active observations exceed `observationsPoolMaxTokens`, it performs a full fold into `data.memory`.

`createRecallMemoryTool()` requires `args.id` to match `^[a-f0-9]{12}$`; invalid ids fail before entry lookup. Recall returns text and structured details for observations/reflections, dropped observations, supporting observations, source entries, and missing source ids. It does not search by topic.

`createMemoryStatusCommand()` reports recorded/dropped/active/visible observations, recorded/visible reflections, pool token counts, and optional runtime in-flight/last-error state. `createMemoryViewCommand()` renders visible memory by default or full active recorded memory with `{ mode: "full" }`; other modes return `Usage: /om:view [full]`.

`createObservationalMemoryExtension()` registers only inert contributions. It does not start workers, compact sessions, read settings, resolve credentials, call providers, or execute tools/commands during setup.

## Security and performance notes

- Recall is exact-id only; there is no semantic search, vector store, or transcript browser.
- Recall tool and commands only see current-branch entries supplied by the host callback.
- Invalid or missing ids fail closed; invalid recall tool ids skip entry lookup.
- Utilities and fast compaction are O(n) over supplied entries and use no provider, network, filesystem, timer, worker, credential, or settings access.
- Workers serialize only supplied branch entries, enforce `agentMaxTurns`, and run one consolidation pipeline at a time per runtime.
- Compaction preserves raw history; Prism appends one standard compaction entry and rebuilds provider context from its summary plus kept recent messages.
- Pass known secrets to render/recall/runtime/tool/command helpers to redact exact values from prompts, records, structured results, and text output.
- Live tests are opt-in with `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1`.

## Related APIs

- [Compaction and retry policies](compaction-and-retry.md): replaceable compaction strategy boundary.
- [LLM compaction package](compaction-llm.md): existing optional compaction-package pattern.
- [Session stores and branching](session-stores-and-branching.md): branch entries that observational memory reads and appends to.
- [Extensions](extensions.md): inert registration pattern for optional package contributions.
- [Tools](tools.md): host activation and dispatch for optional recall tool contributions.
- [CLI/RPC](cli-rpc.md): command contributions through explicitly wired RPC hosts.
