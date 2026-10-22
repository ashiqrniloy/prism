# @arnilo/prism-memory-observational

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
| Compaction | first at the token/trigger gate; then once per observation pass that advances coverage when OM owns the slot | the ledger already in memory, no model call |

One pass runs per session at a time; a request while one is in flight is skipped, not queued.

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
| `context.compactAfterTokens` | `81000` | Estimated input tokens that request the first own compaction, or compaction with a foreign owner |
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
- **`compaction.when`**: uses the configured gate initially and for foreign owners; after an own compaction, advancing observation coverage also requests compaction.
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

`@arnilo/prism-memory-fabric` can promote this package's reflections to long-term notes. With
`memoryFabric({ promote: { observational: true } })` installed beside this package, each new reflection
is written in the background as a candidate fact that earns trust by use (see the fabric README,
"Promotion from observational memory"). This package needs no configuration for it.

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
Custom callers of `runObserver` receive these ledger records through `onRecord`; the package persists
them automatically, and the observation array return value stays unchanged.

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
