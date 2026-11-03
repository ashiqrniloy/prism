# @arnilo/prism-memory-observational

**Tier 0 of Prism's three-tier memory:** it watches the session as it happens. Its ledger of source-backed
observations compacts the session and, with the ordinary `promote` pass, feeds candidate notes to
[`@arnilo/prism-memory-fabric`](../fabric/README.md) (T1, the store of record); [`@arnilo/prism-memory-wiki`](../wiki/README.md)
(T2, opt-in) consolidates those notes into cited concepts. It works alone, and the
[example](../../../examples/three-tier-memory.ts) runs all three.

Observational memory as a package (roadmap §2.11): the observer, the ledger, `recall`, the context
block, and ledger-driven compaction. Installing the package is the opt-in; the `om` command turns it
on per session.

```ts
import { createAgent } from "@arnilo/prism";
import memoryObservational from "@arnilo/prism-memory-observational";

const agent = await createAgent({
  model: "anthropic/claude-sonnet-4-5",
  packages: [memoryObservational({ observer: { messageTokens: 4_000 } })],
});

const session = await agent.session();
await agent.commands.run("om", {}, { session });       // observe this session
await session.run("Plan the migration and keep the retry budget small.");
await agent.commands.run("om:view", {}, { session });  // the rendered ledger
```

**Measured role (plan 202 Task 16, 2026-11-02).** OM is the T0 tier: it observes the session and
feeds fabric consolidation, while its in-session compression stays independent. On a seven-seed
offline lifecycle suite (24 sessions per seed, zero model calls), OM plus fabric scored **0.732** task
success without promotion and **0.732** with promotion. Fabric alone moved from **0.375** to
**0.393** with promotion. Promotion wrote **0.25 notes per session** on OM+fabric and **0.125** on
fabric alone; **none** of those candidates was recalled and cited in a later session, so the
use-verified share was **0**. The reference host therefore keeps promotion off: there is no measured
gain, and an earlier three-seed draw was negative. The full result and limitations are in
`docs/_evidence/memory-bench/202/observational/role.{json,md}`.

A separate six-run live smoke (two free OpenRouter models × `om`, `om+fabric`, `fabric-x-tools`)
completed every one-question LongMemEval-S arm with zero worker errors. It is a completion check, not
quality evidence. The historical `MemoryBenchWorkerError` came from the benchmark aborting on a
background worker failure; current runs show the retained cause is either the arm's token ceiling or
a provider rate limit, and the benchmark now records non-budget failures and continues, matching the
package contract. See `arms.json` and `cost.json` beside the role evidence.

## Cost, security, and failure behavior

Off by default. With the toggle off, the `context.build`, `turn.completed`, and `compaction.when`
handlers each return after one synchronous state read: no model call, no store write, no branch read.

With the toggle on:

| Work | When | Cost |
| --- | --- | --- |
| Observation pass | after a turn, once the unscanned eligible tokens reach `observer.messageTokens` | one branch read, one observer call, one ledger record per recorded batch; date prefixes add about 6 tokens per message, plus gap markers; task state and supersession use the same call |
| Reflection pass | in the same pass, once unreflected observations reach `reflector.observationTokens` | one reflector call, one ledger record |
| Drop pass | after the reflection step (even if it records nothing), once the active pool exceeds `dropper.targetTokens` | one dropper call (or none with `policy: "lowest-relevance"`), one ledger record |
| Context block | after foreign compaction only | pinned ledger in memory; one entry scan and log write per compaction, awaited before the next request; one reconciliation scan on reopen |
| Compaction | first at the `compactAt`/`trigger` gate; then once per observation pass that advances coverage when OM owns the slot | the ledger already in memory, no model call |

One pass runs per session at a time; a request while one is in flight is skipped, not queued.

**Measured live worker cost per 10k source-message tokens** (one LongMemEval-S question, free
OpenRouter route): observer **233,494 input / 3,287 output tokens**, reflector **1,702 / 358**,
dropper not triggered. Total arm input was 2,987,872 tokens for 121,798 source-message tokens. The
reflector trigger was lowered to 1k only to force a pass; the observer ran at its default 10k
trigger. One live question is a cost measurement, not a quality result.
`docs/_evidence/memory-bench/202/observational/cost.{json,md}`.

## Context and caching

`om:status` reports three context modes:

- `none`: before the first compaction, history stays verbatim and OM injects no block.
- `own-compaction`: OM's summary already contains the ledger, ending with `## Current task` when present. No duplicate context block is injected.
- `pinned`: another slot owner compacted the session. OM captures a bounded ledger snapshot synchronously on successful completion, resolves the compaction entry, and persists `om.context.pinned { coversUpToId, compactionEntryId, ledger }`. The next context build awaits that write. Later observation passes do not change the block.

Prefix changes coincide with compaction. Failed and duplicate completion events do not repin.
Reopening reconciles the latest compaction once, using its persisted pin or the ledger records preceding it.
OM records `om.compacted { coversUpToId }` for its own compactions. Once that marker exists,
new observation coverage triggers another own compaction, removing covered old messages while preserving
recent and unobserved messages. Foreign owners retain the existing token/trigger gate.

The observer sees the most recent active observations within `dropper.targetTokens / 4` estimated tokens,
plus new messages and bounded task state. Worker byte limits and redaction still apply.

## Configuration

Every key is optional. `AgentConfig.packageConfig["@arnilo/prism-memory-observational"]` wins over the
defaults below.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Starting value of the per-session toggle |
| `observer.model` | the session's model | Observer model: `"provider/model"` or a model object |
| `observer.messageTokens` | `10000` | Unscanned eligible tokens that trigger an observation pass |
| `reflector.model` | the session's model | Reflector model |
| `reflector.observationTokens` | `20000` | Unreflected observation tokens that trigger a reflection pass |
| `dropper.model` | the session's model | Dropper model |
| `dropper.targetTokens` | `20000` | Active-observation token budget the dropper approaches |
| `dropper.policy` | `"model"` | `"model"` asks the dropper model; `"lowest-relevance"` drops deterministically |
| `context.recentMessages` | `8` | Recent messages the compaction cut keeps verbatim |
| `context.compactAt` | `{ "ratio": 0.6 }` | Requests compaction at `ratio` of the model's input cap, capped by `maxTokens`. A model with no declared window uses `maxTokens` and fails config validation without it. Ignored when `trigger` is set |
| `worker.maxTaskStateBytes` | `2048` | Maximum UTF-8 text bytes in the replaced task state and rendered task section (hard ceiling 65536) |
| `worker.*` | see `limits.ts` | Worker loop ceilings (`maxTurns`, `maxToolCalls`, byte caps) |
| `recall` | `true` | Expose the `recall` tool while the session's toggle is on |

Worker models resolve per call as: the per-session `om:model` ref, else the config's, else the
session's own model. The provider and its key come from the kernel (`prism.models.client`), so the
package holds no credential.

## Commands

| Command | Effect |
| --- | --- |
| `om` | Toggles observational memory for the session and emits `om.status` |
| `om:model { observer?, reflector? }` | Sets the per-session worker model refs. An unknown provider fails the command and leaves state unchanged |
| `om:status` | Counts, thresholds, `contextMode`, whether a pass is in flight, and the last pass error |
| `om:view` | Renders the session's ledger |

## Contributions

- **`recall` tool**, registered with `when: on`, so a session with the toggle off neither sees nor can
  call it. It reads its own session only: exact 12-character ids for memory, or raw-source paging
  around a current-branch message id.
- **`context.build`**: awaits a pending compaction pin or one-time reopen reconciliation, then renders only the pinned ledger for foreign compactors. Steady requests do not read the branch.
- **`turn.completed`**: starts `session.background("om.observe", …)`. A failing pass fails only that
  background task (`background.failed`, error redacted), records `lastError`, and leaves the ledger
  unchanged; the run is unaffected.
- **`compaction.when`**: while the toggle is on, votes `{ compact: true }` past its gate (`min(ratio × model input cap, maxTokens)`) and `{ compact: false }` below it, so the kernel's `thresholdEntries` fallback does not override OM; with the toggle off it abstains (`undefined`) and the host's trigger still fires.
- **`compaction` slot**: summarizes from the ledger instead of the raw transcript. With the toggle off
  for the session it delegates to `prism.slots.compaction.default`.
- **`om.status` event**: `{ enabled, contextMode, observations, reflections, inFlight, lastError? }` on toggle,
  pass start, pass end, and pass failure.

## State

- `prism.state.session("om", …)`: the per-session `enabled` flag and the `om:model` refs. Carried by
  `fork()` and `clone()` like any session state.
- `prism.state.log("ledger")`: append-only `om.observations.recorded`, `om.reflections.recorded`,
  `om.observations.dropped`, and `om.task_state.recorded` records. Later records never replace earlier ones; a fork carries the
  records up to the fork point.

Each record is one `package_state` entry on the branch, so a consumer that only has the session — the
memory fabric's `observational` source, a host's own projection — folds the same ledger from
`session.entries()` without reading the package's log directly.

## Related packages

`@arnilo/prism-memory-fabric` consumes this package's ledger in its consolidation pass. With
`memoryFabric({ promote: {} })` installed beside this package, the extractor sees OM observations,
task-state decisions, and reflections in the session tail and writes accepted notes as candidates
that earn trust by use. The old `promote.observational` flag was retired in plan 188.3; the current
path is the ordinary `promote` object, and the fabric README records the measured result. This
package needs no configuration for it.

## Slot ownership

This package claims the `compaction` slot. With `@arnilo/prism-memory-compaction` also installed, two
packages claim it and `createAgent` fails closed until the host or manifest assigns the owner:

```ts
await createAgent({
  model,
  packages: [memoryCompaction(), memoryObservational()],
  slots: { compaction: "@arnilo/prism-memory-observational" },
});
```

## Example

`examples/observational-memory.ts` runs the whole contract on a temp SQLite store: the observer on its
own model, compaction from the ledger, the per-session toggle, a second process resuming the session
(toggle, worker model, ledger, `recall`), and the `compaction`-slot conflict failing closed.

## Capabilities

`models`, `session-state`, `background`, `slot:compaction`.

## Requirements

- Prism `^0.13.0`
- The kernel's `SessionContext.entries()`, `CompactionContext.session`, and `prism.state.log` seams
  (plan 157 Task 2)

## Ledger

A successful reflection pass rewrites the active reflections and unreflected observations. Its append-only `om.reflections.recorded` record lists `consumedObservationIds` and `supersededReflectionIds`; these fields are optional when reading older ledgers. Empty passes consume nothing. Inactive evidence remains in the ledger for `recall`, marked `(reflected)` or `(dropped)`. Budget drops and consumption never hide a reflection; source invalidation still withholds it.

The dropper is a backstop after reflection. `dropper.targetTokens` must be at least `reflector.observationTokens`, so it cannot trim the pool below the reflection trigger. Rendering removes the oldest observations before reflections when the byte budget is exceeded.


## Dates, updates, and the current task

The observer sees each source message prefixed with its stored ISO timestamp, and gaps of at least
10 minutes marked as `[gap: 10m]`, `[gap: 2h]`, or `[gap: 2d]`. It converts relative time references
using that message time. `record_observation { content, sourceEntryIds, relevance?, referencedAt?,
supersedes? }` derives `observedAt` from the latest source timestamp; `timestamp` remains the recording
time. `referencedAt` accepts a valid `YYYY-MM-DD` date; invalid dates are discarded. A known
`supersedes` id writes a drop record with `reason: "superseded"` and `supersededBy`; unknown ids are
ignored and reported in the tool result without discarding the new observation. Reflection date
ranges come from their evidence. Older observations without `observedAt` use `timestamp`.

`record_task_state { goal, openQuestions?, decisions?, nextSteps? }` replaces the current task.
The last three fields are arrays of strings (at most 32 each). All text shares the
`worker.maxTaskStateBytes` cap and is truncated safely on UTF-8 boundaries. The observer records it
when the task changes and lists assumptions not confirmed by the user under `openQuestions`.
Each record carries the supplied source entry ids; folding keeps only the latest task state.
The observer worker reports these ledger records through `onRecord`; the package persists them
automatically, and the observation array return value stays unchanged.

The block asks the agent to cite memory ids and carries `metadata: { source: "om", itemIds: [...] }`
for the items actually rendered, in display order. Reflections appear first, observations by source
date next, and the current task last:

```text
# Observational Memory
Use these source-backed memories when relevant and cite the ids you rely on as [id]. To inspect evidence, call recall with an id; do not guess ids.

## Reflections
- [112233445566] (2026-10-15T09:12:00.000Z – 2026-10-17T09:12:00.000Z) Deploy history

## Observations
### 2026-10-15
- [a1b2c3d4e5f6] 09:12 (high) User moved the deploy to Friday (refers to 2026-10-17)

## Current task
- [ffeeddccbbaa] Goal: Deploy the release
Open questions:
- Confirm the production window
Next steps:
- Test staging
```

## Compatibility

At API level 1 a host can rely on the export names and signatures in [Stable exports](#stable-exports), the command
and tool names below, the ledger and state record names, and the `contract` config fields, for the whole `0.13.x` line
and every later minor version (the same promise plan 185 Task 5 makes for the kernel).

### Stable

- **Exports.** The names in [Stable exports](#stable-exports); `src/__tests__/root-exports.test.ts` freezes the barrel.
- **Commands and tools.** `om`, `om:model`, `om:status` and `om:view`, with their argument shapes, and the `recall`
  tool (its name is the package option, default `recall`). A host may name them in approval and policy rules. Their
  descriptions may change; the names do not.
- **Records.** The ledger record names (`OBSERVATIONS_RECORDED`, `REFLECTIONS_RECORDED`, `TASK_STATE_RECORDED`), and
  the ledger and state formats: a record this version cannot validate is skipped, never rewritten or deleted.
- **Config.** Every field marked `contract` in [Config stability](#config-stability). A contract field is never removed
  or renamed, and a new field is optional.

### May change in a minor version

- The value of every config field marked `tuning` in [Config stability](#config-stability).
- Prompt text, worker behaviour, thresholds, token budgets and the rendered memory format.

### Needs a new name or an explicit opt-in

- A new required service (a provider key, a model call on a path that makes none today).
- A change to what a default observes, drops or stores.
- A new capability an implementation must provide instead of an optional member.

### Config stability

Every field is `contract` (shape and meaning frozen at API level 1) or `tuning` (its value may change in a minor
version). `@arnilo/prism-memory-fabric`'s `stability.test.ts` checks this table against
`memoryObservationalConfigSchema`.

| field | tier |
| --- | --- |
| `enabled` | contract |
| `observer` | contract |
| `observer.model` | contract |
| `observer.messageTokens` | tuning |
| `reflector` | contract |
| `reflector.model` | contract |
| `reflector.observationTokens` | tuning |
| `dropper` | contract |
| `dropper.model` | contract |
| `dropper.targetTokens` | tuning |
| `dropper.policy` | contract |
| `context` | contract |
| `context.recentMessages` | tuning |
| `context.compactAt` | contract |
| `context.compactAt.ratio` | tuning |
| `context.compactAt.maxTokens` | tuning |
| `context.trigger` | contract |
| `context.trigger.type` | contract |
| `context.trigger.entries` | tuning |
| `context.trigger.tokens` | tuning |
| `context.trigger.ratio` | tuning |
| `worker` | contract |
| `worker.maxTaskStateBytes` | tuning |
| `worker.maxTurns` | tuning |
| `worker.maxToolCallsPerTurn` | tuning |
| `worker.maxToolCalls` | tuning |
| `worker.maxArgumentBytes` | tuning |
| `worker.maxResultBytes` | tuning |
| `worker.maxMessageBytes` | tuning |
| `worker.maxErrorBytes` | tuning |
| `recall` | contract |

### Stable exports

`src/__tests__/root-exports.test.ts` freezes the root barrel. Adding or removing a name is a deliberate API decision.

- **Stable (API level 1).** The default package definition, `memoryObservationalConfigSchema`,
  `resolveMemoryObservationalConfig`, the ledger record names (`OBSERVATIONS_RECORDED`, `REFLECTIONS_RECORDED`,
  `TASK_STATE_RECORDED`), `foldObservationalMemoryLedger`, `activeObservations`, `activeReflections`,
  `buildObservationalMemoryContextBlocks`, `createMemoryId`, and the config, ledger and record types.
- **Memory-package shared helpers — no host promise.** The type guards, worker-limit helpers, token estimates,
  `runMemoryWorkerLoop`, `recallObservationalMemoryBranchPage` and the other names `memory-fabric` imports. A host
  should not. They may change in a minor version.
- **Not exported.** The observer, reflector and dropper workers and their prompts, tuning constants, the settings
  family, flush, commands, the recall tool and the compactor. The commands and the `recall` tool are reached through
  the package, not through imports.
