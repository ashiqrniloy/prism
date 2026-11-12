# @arnilo/prism-memory-system

> **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-memory-system@experimental`. Outside the
> [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md) of the stable packages: its API,
> config, preset contents and defaults may change or be removed in any release until it graduates.
> Graduation is the memory track's final step, which sets the first stable version.

**Prism's memory system**, modelled on human memory: short-term memory (STM) → working memory (WM) →
rehearsal → long-term memory (LTM), plus sleep. A host can use it partly or whole. The package holds
the **session tiers** (`src/session`), which watch the session as it happens, keep a ledger of
source-backed observations, and compact the session from that ledger, and **long-term memory**
(`src/ltm`, the `ltm` component; it was `@arnilo/prism-memory-fabric` until plan 216 Task 5), the only
store of record: typed notes and verbatim exchanges behind the `memory.*` tools. With the ordinary
`promote` pass, long-term memory takes candidate notes from the session tiers. [`@arnilo/prism-knowledge/wiki`](../../knowledge/wiki/README.md),
outside memory, can consolidate those notes into cited concepts in its own store. The session tiers
work alone, and the [example](../../../examples/memory-and-wiki.ts) runs all three.

| Component | Today (unchanged worker behaviour) | Redesigned by |
| --- | --- | --- |
| `stm` | the observer: records source-backed observations and the current task | plan 217 |
| `wm` | working memory: one verdict per STM record (keep, summarize, discard) plus derived facts, incremental ([Working memory](#working-memory)) | plan 218 |
| `rehearsal` | the dropper: trims the active pool to a budget | plan 219 |
| `ltm` | the former fabric: typed notes, scopes, recall, consolidation, lifecycle ([Long-term memory](#long-term-memory)) | plans 219–220 |
| `sleep` | nothing yet: a no-op component | plan 221 |

Installing the package is the opt-in; the `memory:session` command turns the session tiers on per
session. Long-term memory is set up only when `ltm` is configured, and is then on for every session
(the `memory` command toggles it). Each component can be turned off ([Configuration](#configuration)).

```ts
import { createAgent } from "@arnilo/prism";
import memorySystem from "@arnilo/prism-memory-system";

const agent = await createAgent({
  model: "anthropic/claude-sonnet-4-5",
  packages: [memorySystem({ stm: { triggerTokens: 4_000 }, ltm: { preset: "conversational", tools: { root: "./memory" } } })],
});

const session = await agent.session();
await agent.commands.run("memory:session", {}, { session });       // remember this session
await session.run("Plan the migration and keep the retry budget small.");
await agent.commands.run("memory:session:view", {}, { session });  // the rendered ledger
```

## Configuration

Each component is an object (on, with its fields) or `false` (off). Omitted (or `null`), it resolves from the others:

| Component | Omitted | Needs |
| --- | --- | --- |
| `stm` | on | — |
| `wm` | follows `stm` | `stm` |
| `rehearsal` | on only when `wm` and `ltm` are both on | `wm` and `ltm` |
| `ltm` | off | — |
| `sleep` | off (no fields until plan 221) | `ltm` |

`stm`, `wm` and `rehearsal` are still gated per session by `memory:session`. The fields of `stm`, `wm`, `rehearsal`,
`context`, `worker`, `recall` and `enabled` are in [Session memory → Configuration](#configuration-1); `ltm`'s are in
[Long-term memory → Config](#config).

**Fail-closed composition.** A configured component whose dependency is off fails `createAgent` (`PackageLoadError`
`setup_failed`) with a `memory_system_component_missing` message naming both components: `wm` without `stm`,
`rehearsal` without `wm` or without `ltm`, and `sleep` without `ltm`. `resolveMemorySystemComponents(config)` runs the
same check without an agent and throws `MemorySystemError`.

**A component that is off loads and registers nothing:** no hook, tool, command, slot claim, service or model call, and
its code is not imported. With `stm: false` the package does not claim the `compaction` slot; with `ltm: false` it
registers no `memory.*` tool and no `memory.ltm` service. The package's capabilities are computed from the enabled
components (the kernel's `capabilitiesFor`): `stm` declares `models`, `session-state`, `background`,
`slot:compaction` and `host-ui` (`memory:scope { path }` asks the host for the file's text); `ltm` declares `models`, `session-state`, `background`, `credentials` and `host-ui`.

**The `memory.system` service** (`MEMORY_SYSTEM_SERVICE`) is provided whatever the components. `status()` returns
`{ components }`, which components this instance runs. `setScope(session, text)` sets the episode scope
([Episode scope](#episode-scope)). `endEpisode` (plan 218), `rehearse` (plan 219) and `sleep` (plan 221) are declared and
reject with `MemorySystemError` `not_available_yet` until their plans land.

## Profiles

Profiles are recipes, not a config field. Each is tested end to end, and [`examples/memory-system.ts`](../../../examples/memory-system.ts) runs all four:

| Profile | Config | Use |
| --- | --- | --- |
| `ltm` | `{ stm: false, ltm: { … } }` | Notes, recall and standing rules across sessions; no session tiers and no compaction slot |
| `session` | `{ stm: {}, wm: {} }` (the defaults) | Long single sessions with no cross-session store |
| `stm` | `{ stm: {}, wm: false }` | An event log with verbatim recall |
| `full` | `{ stm: {}, wm: {}, rehearsal: {}, ltm: { … }, sleep: {} }` | The whole memory system |

```ts
memorySystem({ stm: {}, wm: false, rehearsal: false, ltm: false }); // event log + recall only
```

## Cost, security, and failure behavior

Both components are opt-in and state their model calls. The session tiers are off by default: with the
`memory:session` toggle off they make no model call, no store write and no branch read; with it on, each STM, WM and
rehearsal pass makes its own model call ([Session cost, security, and failure
behavior](#session-cost-security-and-failure-behavior)). Long-term memory is set up only when `ltm` is configured;
its retrieval is lexical and makes no model call and no embedding call by default; the passes that do call a model are
listed in [Long-term memory cost, security, and failure
behavior](#long-term-memory-cost-security-and-failure-behavior). Session-tier workers get secrets only from the
kernel's secret set, and a Postgres store's `connection` is an `env:`/`keyring:` ref, never a connection string.

## Session memory

The rest of this page describes the session tiers. Measurements below were taken under the package's
former name, `@arnilo/prism-memory-observational` ("OM"), with the same worker behaviour.

**Measured role (plan 217 gate M-1, 2026-11-12).** STM was compared with the pre-redesign observer
(`OM-before`, pinned at `37ee1a24`) on paid Ollama Cloud, development partitions, with DeepSeek V4.1 Flash and MiMo V2.6
Flash answering. S1, re-derivations per related task on the long-session coding family, is a **miss**: DeepSeek
re-derived less with STM (+0.47 [−0.19, 1.16]), MiMo more (−0.34 [−0.69, −0.06]). S2, verbatim chunks, **passes**. S4,
worker tokens STM / OM-before, **passes** at **0.615** in the worst cell (0.29–0.61 across the six). S3, answer accuracy,
is decided at the held-out gate A. On LongMemEval-M and BEAM-1M (two questions per cell) both arms scored the same with
DeepSeek; with MiMo STM lost two answers once WM's whole-log reflections hid an old value. Gate M-2 re-measures S1.
The evidence is `docs/_evidence/memory-bench/memory-model/M-1/`.

**Measured role (plan 202 Task 16, 2026-11-02).** OM (the session tiers) was the T0 tier: it observes the session and
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

### Session cost, security, and failure behavior

Off by default. With the toggle off, the `context.build`, `turn.completed`, and `compaction.when`
handlers each return after one synchronous state read: no model call, no store write, no branch read.

With the toggle on:

| Work | When | Cost |
| --- | --- | --- |
| STM pass | after a turn, once the unscanned eligible tokens reach `stm.triggerTokens` (or, with `stm.boundaries: true`, when the tail holds a user turn after an idle gap: at most one extra STM call per boundary) | one branch read, one STM call per batch of the unread tail (one batch unless the tail exceeds about twice `stm.triggerTokens`, at least 32 KB serialized, or half of `worker.maxMessageBytes`; only the latter cuts an entry), one ledger record per recorded batch; date prefixes add about 6 tokens per message, plus gap markers; task state and supersession use the same call |
| Habituation and boundary markers | inside the STM pass; idle-gap markers on every pass that sees a new one | a string comparison per new event against at most `stm.habituation.windowEvents` records, one ledger record per repeat or marker, no model call |
| Chunk store write | at the end of a pass that stored a chunk or dropped a record with chunks | one store transaction, no model call; a fork or resumed session adds its referrers in one more transaction when it opens ([Chunks](#chunks)) |
| WM pass | in the same pass, once the STM surface (records without a WM verdict) reaches `wm.triggerTokens`, or a boundary marker is new since the last WM attempt; after an attempt that did nothing or failed, once another `wm.triggerTokens` of new records arrive (a new boundary still runs it) | one WM call over at most `wm.batchTokens` of the oldest records (it ends after a clean turn; calls past the per-turn limit are refused, not failed), one `wm.recorded` record plus one tombstone record per verdict reason, and one chunk-store transaction moving referrers ([Working memory](#working-memory)) |
| Rehearsal pass | after the WM step (even if it records nothing), once the active pool exceeds `rehearsal.targetTokens` | one rehearsal call (or none with `policy: "lowest-relevance"`), one ledger record |
| Context block | after foreign compaction only | pinned ledger in memory; one entry scan and log write per compaction, awaited before the next request; one reconciliation scan on reopen |
| Compaction | first at the `compactAt`/`trigger` gate; then once per STM pass that advances coverage when this package owns the slot | the ledger already in memory, no model call |

One pass runs per session at a time; a request while one is in flight is skipped, not queued.

**Large tails.** The unread tail goes to the STM worker in ordered batches that each fit half of
`worker.maxMessageBytes` (the other half holds the prompt, task state, recent observations and the
worker's tool turns). Coverage advances after each recorded batch, so a failed batch leaves coverage at
the last recorded one and the next pass resumes there. A single entry larger than a batch is redacted,
cut, and ends with `[truncated: entry <id> is <n> bytes; the rest was not sent]`; the marker never
carries the cut bytes, and observations may still cite the entry. A tail that fits is one batch, the
same prompt as before.

**Worker settings and secrets.** Each worker call carries its section's `instruction` (appended to
the default prompt; it cannot change the worker's tools) and `thinkingLevel` (default `low`: recording and judging
records needs little reasoning, and a model's own default can spend the output limit first), plus the session's
secret set. Branch entries reach the package already redacted; the secret set the kernel hands the
`compaction` slot is kept per session (bounded) and redacts every later worker prompt and error.
Secrets never come from config text.

**Worker tool results.** `record_event`, `record_task_state`, the WM tools (`keep`, `summarize`, `derive`, `discard`)
and `drop_observations` answer `{ ok: false, reason }` whenever nothing was stored (`invalid_kind`,
`empty_description`, `no_valid_ids`, `unknown_id`, `invalid_event`, `invalid_task_state`, and for WM
`already_processed`, `empty_text`, `citation_outside_active_set`), so the model can correct itself.

**Measured live worker cost per 10k source-message tokens** (one LongMemEval-S question, free
OpenRouter route): observer **233,494 input / 3,287 output tokens**, reflector **1,702 / 358**,
dropper not triggered. Total arm input was 2,987,872 tokens for 121,798 source-message tokens. The
reflector trigger was lowered to 1k only to force a pass; the observer ran at its default 10k
trigger. One live question is a cost measurement, not a quality result.
`docs/_evidence/memory-bench/202/observational/cost.{json,md}`.

### Context and caching

`memory:session:status` reports three context modes:

- `none`: before the first compaction, history stays verbatim and the package injects no block.
- `own-compaction`: the package's summary already contains the ledger, ending with `## Current task` when present. No duplicate context block is injected.
- `pinned`: another slot owner compacted the session. The package captures a bounded ledger snapshot synchronously on successful completion, resolves the compaction entry, and persists `memory.session.context.pinned { coversUpToId, compactionEntryId, ledger }`. The next context build awaits that write. Later observation passes do not change the block.

Prefix changes coincide with compaction (I7). Between compactions, STM, WM and rehearsal passes write only the ledger:
newer material stays in the transcript tail, so the prefix bytes the provider caches stay identical across WM passes
(`prefix_identical_between_compactions_across_wm_passes`: 20 turns, three WM passes, one prefix). Failed and duplicate
completion events do not repin.

The package's compaction (plan 218 Task 4, design §5.1) makes no model call. Its summary renders, in this order, the WM
surface (facts, then summaries, then events), the STM surface not yet processed, then the task state, and keeps
`context.recentMessages` (and any message STM has not covered) verbatim. Tombstoned records and chunk text never enter it:
a record or item with chunks shows only the `[chunk]` marker. One function renders the summary, the pinned block and
`memory:session:view`. Pinned mode under a foreign compaction owner is unchanged.
Reopening reconciles the latest compaction once, using its persisted pin or the ledger records preceding it.
The package records `memory.session.compacted { coversUpToId }` for its own compactions. Once that marker exists,
new observation coverage triggers another own compaction, removing covered old messages while preserving
recent and unobserved messages. Foreign owners retain the existing token/trigger gate.

The STM worker sees the most recent active observations within `rehearsal.targetTokens / 4` estimated tokens,
plus new messages and bounded task state. Worker byte limits and redaction still apply.

### Configuration

Every key is optional. `AgentConfig.packageConfig["@arnilo/prism-memory-system"]` wins over the
defaults below.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Starting value of the per-session toggle |
| `stm.model` | the session's model | STM worker model: `"provider/model"` or a model object |
| `stm.triggerTokens` | `10000` | Unscanned eligible tokens that trigger an STM pass (was `observer.messageTokens`) |
| `stm.contextTokens` | `4000` | Token budget of the recent STM record index (id, kind, first 120 characters) each STM request carries |
| `stm.maxChunksPerEvent` | `2` | Verbatim chunks one STM event may carry (at most 8); `0` removes the `chunks` argument ([Chunks](#chunks)) |
| `stm.maxChunkBytes` | `4096` | Bytes one stored chunk may take, truncation marker included (256 to 65,536) |
| `stm.chunkStore` | `"memory"` | Where the default chunk store lives: `"memory"` (the process lifetime) or `{ "sqlite": { "path": "…" } }`, a file in the host's data directory created mode 0600 |
| `stm.habituation` | `{ "windowEvents": 50 }` | Collapse a repeated identical event into one record with a count, against the newest `windowEvents` active records (1 to 1,000); `false` records every event ([Short-term memory](#short-term-memory)) |
| `stm.boundaries` | `false` | `true` runs an STM pass below `stm.triggerTokens` when a user turn follows an idle gap (one extra STM call per boundary); boundary markers are recorded either way |
| `stm.boundaryGapMinutes` | `10` | Minutes of silence before a user turn that make it an event boundary (1 to 10,080) |
| `stm.instruction`, `wm.instruction`, `rehearsal.instruction` | none | Text appended to that worker's default prompt; it cannot change the worker's tools |
| `stm.thinkingLevel`, `wm.thinkingLevel`, `rehearsal.thinkingLevel` | `low` | Reasoning level for that worker's model calls (`none` … `max`). A model without reasoning levels ignores it; set a level to override |
| `wm.model` | the session's model | WM worker model |
| `wm.triggerTokens` | `10000` | STM surface tokens (records without a WM verdict) that trigger a WM pass (was `wm.observationTokens`, 20,000) |
| `wm.batchTokens` | `3000` | STM record tokens one WM pass is sent, oldest first; the rest waits for the next pass |
| `wm.targetRatio` | `0.2` | Items' tokens over the batch's tokens a WM pass aims at (0.01 to 1), as pressure after relevance; protected records are never cut ([Working memory](#working-memory)) |
| `wm.rejudgeTokens` | `8000` | Tokens of discarded records (chunks still live) the first WM pass after a scope change is also sent to keep back; `0` turns re-judgment off ([Working memory](#working-memory)) |
| `wm.policy` | `"model"` | `"model"` asks the WM model; `"deterministic"` keeps protected records, outcomes and salient records and discards the lowest-relevance oldest to the target, with no model call |
| `rehearsal.model` | the session's model | Rehearsal worker model (today's dropper) |
| `rehearsal.targetTokens` | `20000` | Active-observation token budget rehearsal approaches |
| `rehearsal.policy` | `"model"` | `"model"` asks the rehearsal model; `"lowest-relevance"` drops deterministically |
| `context.recentMessages` | `8` | Recent messages the compaction cut keeps verbatim |
| `context.compactAt` | `{ "ratio": 0.6 }` | Requests compaction at `ratio` of the model's input cap, capped by `maxTokens`. A model with no declared window uses `maxTokens` and fails config validation without it. Ignored when `trigger` is set |
| `worker.maxTaskStateBytes` | `2048` | Maximum UTF-8 text bytes in the replaced task state and rendered task section (hard ceiling 65536) |
| `worker.*` | see `limits.ts` | Worker loop ceilings (`maxTurns`, `maxToolCalls`, byte caps) |
| `recall` | `true` | Expose the `recall` tool while the session's toggle is on |
| `scope.text` | none | Every session's starting episode scope, until `memory:scope` or `setScope` replaces or clears it ([Episode scope](#episode-scope)) |
| `scope.maxBytes` | `32768` | Bytes one episode scope may take (at most 49,152); longer text fails with `scope_too_large` |

`observer`, `reflector` and `dropper` were renamed `stm`, `wm` and `rehearsal` with no alias: config
validation rejects them, and `resolveMemorySystemConfig` names the successor. `wm.observationTokens` was retired with
the whole-log reflector (plan 218 Task 2) the same way, naming `wm.triggerTokens`. `rehearsal` runs today's dropper
until plan 219.

Worker models resolve per call as: the per-session `memory:session:model` ref, else the config's, else the
session's own model. The provider and its key come from the kernel (`prism.models.client`), so the
package holds no credential.

### Commands

| Command | Effect |
| --- | --- |
| `memory:session` | Toggles session memory for the session and emits `memory.session.status` |
| `memory:session:model { stm?, wm? }` | Sets the per-session worker model refs. An unknown provider fails the command and leaves state unchanged |
| `memory:session:status` | Counts, thresholds, `contextMode`, whether a pass is in flight, the last pass error, the episode scope's hash and size (never its text), and `budgetUnmet` when the latest WM pass's protected records exceeded its target |
| `memory:session:view` | Renders the session's ledger |
| `memory:scope { text }`, `{ path }`, `{ clear: true }` | Sets or clears the session's episode scope ([Episode scope](#episode-scope)). Exactly one form; anything else answers `invalid_args` |

### Contributions

- **`recall` tool**, registered with `when: on`, so a session with the toggle off neither sees nor can
  call it. It reads its own session only: exact 12-character ids for memory (an STM record returns its verbatim
  chunks; [Recall](#recall)), or raw-source paging around a current-branch message id.
- **`context.build`**: awaits a pending compaction pin or one-time reopen reconciliation, then renders only the pinned ledger for foreign compactors. Steady requests do not read the branch.
- **`turn.completed`**: starts `session.background("memory.session.observe", …)`. A failing pass fails only that
  background task (`background.failed`, error redacted), records `lastError`, and leaves the ledger
  unchanged; the run is unaffected.
- **`compaction.when`**: while the toggle is on, votes `{ compact: true }` past its gate (`min(ratio × model input cap, maxTokens)`) and `{ compact: false }` below it, so the kernel's `thresholdEntries` fallback does not override the package; with the toggle off it abstains (`undefined`) and the host's trigger still fires.
- **`compaction` slot**: summarizes from the ledger instead of the raw transcript. With the toggle off
  for the session it delegates to `prism.slots.compaction.default`.
- **`memory.session.status` event**: `{ enabled, contextMode, observations, wmItems, inFlight, lastError? }` on toggle,
  pass start, pass end, and pass failure.

### State

- `prism.state.session("memory.session", …)`: the per-session `enabled` flag, the
  `memory:session:model` refs (`stmModel`, `wmModel`) and the episode scope (`scope`, redacted text with its hash; `null`
  after a clear). Carried by `fork()` and `clone()` like any session state.
- `prism.state.log("memory.session.ledger")`: append-only `memory.session.observations.recorded`,
  `memory.session.wm.recorded`, `memory.session.observations.tombstoned`, `memory.session.observations.dropped`, and
  `memory.session.task_state.recorded` records. Later records never replace earlier ones; a fork carries the
  records up to the fork point.

A ledger record or folded memory written under the retired `om.*` types fails closed with
`MemorySessionLedgerError` (`retired_ledger_type`), which names the record type and the way out: export
the session with the old package's `om:view` first, or start a new session. No reader for the old types
is kept.

Each record is one `package_state` entry on the branch, so a consumer that only has the session — the
memory fabric's `observational` source, a host's own projection — folds the same ledger from
`session.entries()` without reading the package's log directly.

### Related packages

[Long-term memory](#long-term-memory) consumes the session ledger in its consolidation pass. With
`memorySystem({ ltm: { promote: {} } })`, the extractor sees session observations,
task-state decisions, and working-memory items in the session tail and writes accepted notes as candidates
that earn trust by use. The old `promote.observational` flag was retired in plan 188.3; the current
path is the ordinary `promote` object, and [Consolidation from sessions](#consolidation-from-sessions) records the measured result. This
package needs no configuration for it.

### Slot ownership

While `stm` is on, this package claims the `compaction` slot (with `stm: false` it does not). With `@arnilo/prism-extensions/compaction` also installed, two
packages claim it and `createAgent` fails closed until the host or manifest assigns the owner:

```ts
await createAgent({
  model,
  packages: [memoryCompaction(), memorySystem()],
  slots: { compaction: "@arnilo/prism-memory-system" },
});
```

### Example

`examples/session-memory.ts` runs the whole contract on a temp SQLite store: the STM worker on its
own model, compaction from the ledger, the per-session toggle, a second process resuming the session
(toggle, worker model, ledger, `recall`), and the `compaction`-slot conflict failing closed.

### Capabilities

`models`, `session-state`, `background`, `slot:compaction` and `host-ui` while `stm` is on; with `stm: false` none of
them comes from the session tiers ([Configuration](#configuration)).

### Requirements

- Prism `^0.13.0`
- The kernel's `SessionContext.entries()`, `CompactionContext.session`, and `prism.state.log` seams
  (plan 157 Task 2)

### Ledger

A WM pass appends one `memory.session.wm.recorded` record (`WM_RECORDED`): `{ items, supersededItemIds?, processedIds?,
boundaries, compression?, budgetUnmet?, rejudge? }`, then one `memory.session.observations.tombstoned` record per verdict reason (`wm keep <item>`, `wm
summarize <item>`, `wm discard <finished|out-of-scope|superseded|duplicate|budget>`; `budget` is the deterministic policy's). The fold adds items and drops only the
superseded ones it names; nothing replaces the WM set. A pass that recorded no item and processed no record (or failed)
is an empty attempt. Inactive evidence remains in the ledger for `recall`, marked `(dropped)` or `(tombstoned:
<reason>)`; source invalidation withholds a WM item that cites it.

The whole-log reflector's `memory.session.reflections.recorded` record and version 1 folded-memory payloads were retired
with no reader: folding one throws `MemorySessionLedgerError` naming the way out (export with `memory:session:view`, or
start a new session).

Rehearsal is a backstop after WM. `rehearsal.targetTokens` must be at least `wm.triggerTokens`, so it cannot trim the pool below the WM trigger. Rendering removes the oldest observations before WM items when the byte budget is exceeded.

Each episode-scope set or clear appends `memory.session.scope.set` (`SCOPE_SET`): `{ hash, bytes, at }`, or
`{ bytes: 0, at, cleared: true }`. The record never holds the scope's text; the ledger fold skips it.

### Episode scope

The episode scope (plan 218) is a natural-language statement of what the current body of work must achieve, including
its later planned steps, for example a plan document. WM and Rehearsal read it to judge what the remaining work
needs. **STM never sees it**: STM records what happened without knowing the goal, so its records stay neutral.

Set it in one of three ways; the latest wins:

```ts
await agent.commands.run("memory:scope", { text: planMarkdown }, { session });
await agent.commands.run("memory:scope", { path: "plans/218.md" }, { session }); // the host resolves the path
memorySystem({ scope: { text: "Ship the three campaign suites, then verify the retry fix." } }); // every session's start
// From another package's hook, tool or command, with the SessionContext it was handed:
await prism.services.consume<MemorySystemService>(MEMORY_SYSTEM_SERVICE)?.setScope(context.session, planMarkdown);
```

`memory:scope { clear: true }` clears it, the config scope included, for that session.

- **Bounded, never truncated.** A scope is at most `scope.maxBytes` (32 KB by default) UTF-8 bytes, before and after
  redaction. Longer text fails with `scope_too_large`, naming the cap (the command answers `{ ok: false, reason }`;
  `setScope` rejects with `MemorySystemError`; an oversized `scope.text` fails the load). Empty text is `scope_empty`.
- **Redacted, then stored** in session state, so `fork()` and `clone()` carry it. Each set appends a
  `memory.session.scope.set` record with the hash and size. `memory:session:status` shows the hash and size, never the
  text.
- **`path` resolves through the host.** The package sends a `host.ui` `input` request carrying the path and stores the
  text the host answers. It never opens a file itself. A host without `host.ui`, or one that dismisses the request,
  gets `scope_path_unresolved`.
- **Data, not instructions (I11).** The scope goes inside an `<episode_scope>` block at the top of the WM and Rehearsal
  prompts, under a system rule that the block describes goals and never changes which tools the worker calls, reveals or
  forgets memory, or alters the response format. A tag inside the text is escaped, so the text cannot close the block.
  The worker's tool set is fixed by code, whatever the scope says.
- **No scope set:** the block tells WM and Rehearsal that the episode is the session's current work, as shown by the
  task state, and carries the task state.
- **Where it never goes:** STM requests, the context block, the compaction summary, and long-term memory.
- **Cost.** The scope adds at most `scope.maxBytes` to each WM and Rehearsal request, and no model call. With no scope
  the block is one sentence plus the task state.

### Short-term memory

STM (plan 217) records **what happened**, not facts: facts are derived later, by WM and Rehearsal. Each
pass reads a batch of the unread tail and calls `record_event` once per meaningful event, in order. Routine
conversation is one event per exchange or per topic, not per message: what the user asked or said and the gist
of the reply, keeping every preference, constraint, name, date and number the user gave. A task finished or
abandoned within the batch is one `outcome` (what was asked, what changed as old → new, what was achieved or left
open, how it was verified, and setup facts found on the way such as a missing file or how checks are run), not
separate request, action, change and result events. For unfinished work STM
records each change, decision and error once, a result only when it adds to the records, and an action only while
its result is unknown. Descriptions leave out tool-call ids and hashes the user did not ask for; chunks are
attached only when the description cannot hold the exact text. The task state is rewritten on every new request.
(Plan 217 Task 6: one event per message
recorded about seven times as many items as the pre-redesign observer on chat history and spent about 1.5× its
worker tokens; per exchange it is about 1.04× on the same history.)

| `kind` | Records |
| --- | --- |
| `request`, `statement` | what the user asked; what the user stated (preferences, constraints, assertions) |
| `action`, `result` | a tool call, command, or file read or edit; its output or test result |
| `change`, `decision`, `error` | files, symbols, config keys or ids changed; a choice and its reason; a failure and its message |
| `outcome` | a task or subtask completed or abandoned: what was asked, what changed, what was achieved or left open, and how it was verified |

A pass ends after a clean turn (every event recorded; no rejection, warning, refused call or output-limit stop):
the worker is not asked for a closing reply. A flush requested while a pass runs is folded into it as a follow-up
pass (at most four) over what arrived meanwhile, so a slow STM model does not fall behind the session by whole turns.

A pass may record more events than one model turn allows (`worker.maxToolCallsPerTurn`, default 32). STM does
not fail the pass for that: the calls past the limit are not run and are answered with a `tool_call_limit` error,
and the model repeats them in its next turn. Past `worker.maxToolCalls` (default 128) the calls within the limit
keep their effect and the pass ends. Before plan 217 Task 6, the 33rd call failed the whole pass, discarded its
events and sent a larger batch next time, which a gate M-1 smoke run showed snowballing.
A call to a tool name the worker was not given (gate M-1 saw `record_rection`) is answered with an `unknown_tool`
error naming the worker's tools, in every memory worker; the other calls keep their effect, it counts toward both
limits, and the pass goes on (plan 218 Task 1.1).

A `description` is one self-contained line: a later model that sees only the description must be
able to judge whether the event helps a new task. For example:

```json
{ "kind": "outcome", "description": "Campaign retries: interrupted attempts no longer count toward maxAttempts (campaign.mjs retryUncounted); 35 campaign tests pass.", "sourceEntryIds": ["e41", "e47"], "relevance": "high" }
```

The stored record keeps `kind`, `description`, `count` (1; habituation raises it), `lastAt`, and
optional `chunkRefs` (id, source entry id, sha256, bytes of verbatim chunks kept outside the branch).
The context block renders `- [id] HH:MM (relevance) kind: description`, with `×N` after the kind once an event
repeated (`kind ×3: description`), and ` [chunk]` at the end when the record has chunks. The block never carries chunk
text; `recall` reads it.

**Speaker attribution (plan 218 Task 4.1).** Each new event stores `attribution: "user" | "assistant" | "tool" |
"mixed"`, derived in `record_event` from the stored roles of the entries it cites; the model sets nothing, so message
text cannot claim to be the user's. User and assistant entries together are `mixed`; tool output beside one side counts
as that side; a non-message entry adds no side. The worker reads each message line as `[time] [id] user:`,
`assistant:` or `tool:` (other entries keep their kind label). The instruction keeps a fact, number, date or decision
the user states as its own event, never folded into one about what the assistant suggested or calculated. The block
marks non-user content: an assistant-only `request`, `statement` or `decision` renders as `assistant proposal:`
instead of its kind, and a `mixed` record as `kind (user + assistant):`. A WM item resting only on assistant proposals
renders `kind (assistant proposal):`, one resting on both sides `kind (user + assistant):`; the WM request shows the
same marks on its records. Records written before Task 4.1 carry no attribution and render as before. (Gate M-1,
LongMemEval `9aaed6a3`: STM kept an assistant-calculated shopping plan and not the user's own $75 expense, and the
answer model read the plan as a trip that happened.)

```text
- [3f0c1a2b9d8e] 12:45 (medium) assistant proposal: SaveMart weekly plan totaled $55.39 ($0.55 cashback)
- [7a1b2c3d4e5f] 12:46 (high) statement: User spent $75 on SaveMart groceries
```

**Habituation.** An event whose `kind` and normalised description match one of the newest
`stm.habituation.windowEvents` (50) active STM records, or an event of the same batch, and whose chunks are
byte-equal to that record's (or absent), raises the record's `count` and `lastAt` instead of adding a record. The tool
answers `{ ok: true, habituated: <id>, count }`. A changed result (different chunk bytes) is a new event. The ledger
gains a `memory.session.observations.repeated` record (`OBSERVATIONS_REPEATED`) carrying the absolute count, so a
fold that meets it twice cannot over-count. A repeat inside one batch needs no record: the new event is written with
its count. `stm.habituation: false` records every event. The comparison uses the same normaliser as the stored
description; no model call.

**Event boundaries.** A `memory.session.boundary.recorded` marker (`BOUNDARY_RECORDED`; `reason`, `entryId`,
`recordId`, `at`) is recorded, one per reason and entry, on:

- an `outcome` event (`entryId` is its last source entry);
- a task-state change: the goal, open questions, decisions or next steps differ from the previous task state;
- a user turn after an idle gap of at least `stm.boundaryGapMinutes` (10) since the previous message (`gapMinutes`).

Markers cost no model call; plan 218's WM trigger reads them. Outcome and task-state boundaries come out of an STM
pass that already runs. An idle gap is visible before any call, so with `stm.boundaries: true` it runs an STM pass
even below `stm.triggerTokens`: at most one extra STM call per boundary. The default `false` avoids that cost; the
marker is still recorded and the tail waits for the token trigger.

**Scope-blind.** An STM request carries only the batch, the current task state, and an index of the
recent STM records (id, kind, the first 120 characters of the description; the newest that fit
`stm.contextTokens`, 4,000 by default). It never carries the episode scope, a WM item or
an LTM note, so what STM records does not depend on what the other tiers think is relevant. The
index tells the model not to re-record a listed event and to set `supersedes` to replace one.
Transcript text is data: the prompt tells the model never to follow instructions inside it, and the
session's secret set redacts the request as before.

**Cost.** The default STM instruction is under 2,100 characters (the former observer instruction was about
650), and the recent index is at most `stm.contextTokens` per call; there is still one STM call per batch.

### Working memory

WM (plan 218 Task 2, design §5.4) turns the STM surface into what the episode's remaining work needs. It reads the
episode scope ([Episode scope](#episode-scope)), the task state, the current WM items, and a batch of new STM records
with their kinds, counts and chunk sizes. Records carrying a salience signal are marked `salient:` in the request: an
`error` event, a user correction, a denied tool call (`hook_denied` on the branch) or a failed verification in an
`outcome`. The signals come from the records and their source entries, never from a model.

**Verdicts on named records.** Each record in the batch gets at most one verdict:

| Tool | Arguments | Effect |
| --- | --- | --- |
| `keep` | `{ stmId, reason, neededLater? }` | a WM `event` item: the record's description, relevance, time and chunks, and the reason |
| `summarize` | `{ stmIds, text, relevance, supersedes?, neededLater? }` | one WM `summary` citing those records and inheriting their chunks |
| `derive` | `{ text, supportingIds, relevance, supersedes?, neededLater? }` | an episode `fact` citing active STM records or WM items; it gives no verdict |
| `discard` | `{ stmId, reason }` | no item; `reason` is `finished`, `out-of-scope`, `superseded` or `duplicate`; a protected record is refused |

`neededLater` names the scope step that needs the item; a marked item is protected. A tool that stored nothing answers
`{ ok: false, reason }`: `unknown_id`, `already_processed` (a second verdict, or a record already tombstoned),
`empty_text`, `citation_outside_active_set` (an id the session holds that is not in the batch, not active, or a WM item
already superseded), or `protected` with the protection class. A record left without a verdict stays on the STM surface and
rendered, for the next pass. The instruction asks for one subject per item in a few sentences, with a changed value
written as old → new with its dates, and to keep what the scope's later planned steps need, not only the current task.

**Incremental (I6).** A pass adds items and supersedes only the WM items its `summarize` or `derive` calls name; it
never replaces the WM set. Every processed record leaves the STM surface with a tombstone carrying its verdict and
stays recallable by id. In the same chunk-store transaction, every chunk a new WM item cites gains a `wm` referrer and
every tombstoned record's `stm` referrer is removed, so a chunk WM cites survives and an uncited one is deleted (I2–I3).
A fork or resumed session adds its own `wm` referrers for the active items' chunks when it opens.

**When it runs.** Once the STM surface reaches `wm.triggerTokens` (10,000), or when a boundary marker is new since the
last WM attempt; no pass runs while one is in flight for the session. A pass sends at most `wm.batchTokens` (3,000) of
the oldest records, and at most three quarters of `worker.maxToolCalls` records, so the verdicts fit one model's
output: plan 217's gate M-1 saw two answer models write nothing when the whole log of about 22k tokens went in one
call. A model call that stops on its output limit before giving any verdict (gate M-2: Muse Spark 1.3 spent the limit
on reasoning in half its calls) retries once on the older half of the batch; the newer half waits for the next pass.
After an attempt that still did nothing, or failed, WM waits for another `wm.triggerTokens` of new records. A host runs
one pass now, below the trigger, with `memory.system.rehearse(session, { only: "wm" })`, which resolves
`{ items, processed }` (or `skipped: "in_flight"`) and rejects with `component_off` when `stm` or `wm` is off.

**Re-judgment after a scope change (plan 218 Task 4).** The first model WM pass after a `memory.session.scope.set` record
whose hash differs from the one last re-judged (a set or a clear; setting the same scope again re-judges nothing) is also
sent the records WM discarded earlier, newest tombstone first, up to `wm.rejudgeTokens` (8,000; 0 turns it off). Only
records whose chunks still live are offered: a chunk is live while this session holds a referrer for it (a WM item, a fork
restored into this session); a discarded record with no chunks is offered on its own line. `keep` may bring one back as a
WM `event`, which takes a `wm` referrer for its chunks; any other verdict on it answers `already_processed`, and a record
left alone stays tombstoned. The pass records `rejudge { scopeHash?, offered, kept, chunkDropped }` on its
`wm.recorded` record; `chunkDropped` names the discarded records whose chunks were all deleted, so the loss is visible.
A scope change does not trigger a pass by itself, and the deterministic policy does not re-judge.

**Compression: the ratio is pressure (plan 218 Task 3).** The request states a target: the items a pass writes aim at
`wm.targetRatio` (0.2) × the batch's tokens, after relevance, never by dropping what later work needs. Salient records
are listed under "Keep first" in priority order (corrections, denials, errors, failed verifications). Protections (I5)
are code in `protections.ts`, shared with plan 219's Rehearsal, not prompt text: `discard` refuses with `protected`

- a `request` or `decision` the current task state was written from (`task_state`);
- a record an active WM `fact` cites (`fact`);
- an `error` no later passing `outcome` resolves (`unresolved_error`);
- a question (`?`) the task state was written from while it lists open questions (`open_question`);
- a record an active WM item marked `neededLater` cites (`needed_later`).

A protected record may still be kept or summarized. When the batch's protected records alone exceed the target, the
request says so, and the pass records `budgetUnmet { protectedTokens, targetTokens }`; nothing more is discarded to meet
it. `memory:session:status` shows the latest pass's `budgetUnmet`, and each `wm.recorded` record carries `compression {
processedTokens, itemTokens, targetTokens }` for the achieved ratio.

**Deterministic policy.** `wm.policy: "deterministic"` makes no model call: it keeps protected records, outcomes and
salient records as `event` items, summarises nothing, and discards the rest lowest relevance first, oldest first within
a relevance, until the kept tokens reach the target (tombstone reason `wm discard budget`). It suits cost-capped hosts;
its items are the records' own lines, so the achieved ratio is often above the target.

**Cost.** One WM call per trigger crossing or new boundary (none with `wm.policy: "deterministic"`), its input bounded
by `wm.batchTokens` plus the active WM items, the task state and the scope (at most `scope.maxBytes`), and, only on the
first pass after a scope change, at most `wm.rejudgeTokens` of re-judged records. The target and
protection marks add one short section and one word per protected record. The whole-log rewrite and its "consume
everything sent" rule are gone.

### Chunks

An event may carry `chunks`: verbatim excerpts of the entries it cites (a command's output, an error, a code
snippet, a quoted request), so a later tier can read the exact text without re-running anything.

```json
{ "kind": "result", "description": "Campaign tests pass after the retry fix (35 tests, 3 files).", "sourceEntryIds": ["e47"], "chunks": [{ "sourceEntryId": "e47", "text": "Ran 35 tests across 3 files. 0 fail" }] }
```

- **Verbatim.** A chunk must cite an entry of the batch, and its text (whitespace-normalised) must be a substring of
  that entry as the worker saw it, or of the entry's own text. Otherwise the event is refused with
  `chunk_not_verbatim` (also `chunk_unknown_entry`, `too_many_chunks`, `empty_chunk`, `invalid_chunks`).
- **Redacted and capped.** The text is redacted with the session's secret set, then cut to `stm.maxChunkBytes`; the
  truncation marker names sizes only, never the cut bytes. A batch's accepted chunks may take at most 25% of its
  serialized transcript bytes (`chunk_budget_exceeded` past that), so stored chunk bytes stay under a quarter of the
  transcript they cover whatever the caps are.
- **Never on the branch.** The ledger keeps only `chunkRefs` (id, source entry id, sha256, bytes). The text lives in
  the chunk store and never enters the context block, the ledger or a shared store.
- **The store.** The default is a SQLite store (`stm.chunkStore`: in memory for the process lifetime, or a file
  created mode 0600, with `secure_delete` on). A package that provides the `memory.chunks` service (a `ChunkStore`:
  `put`, `ref`, `unref`, `apply`, `get`, `list`) replaces it; `createSqliteChunkStore` is exported for that. A file
  that holds another SQLite schema fails closed.
- **Reference counted.** Every chunk has referrers: an STM record (later a WM item or an LTM note), each with its
  session id. When rehearsal or `supersedes` drops an STM record, its referrer is removed; at zero referrers the chunk
  is hard-deleted in the same transaction, and `secure_delete` zeroes the freed pages. Nothing else deletes a chunk.
  A forked (or resumed) session adds its own referrers when it opens, so a drop in the parent cannot delete a chunk
  the child still holds. `get` answers only for a session that holds a referrer.
- **Cost.** No model call. One store transaction per pass (the pass's new chunks, then the referrers of the records it
  dropped), after the pass's ledger appends: a failed write leaves a ref that reads as dropped, never an unreferenced
  chunk. `context.build` never touches the store. On the long-session fixture (204 entries, 46,160 eligible tokens) STM
  stored 9 chunks, 588 bytes: 127 bytes per 10k eligible tokens, 1.8% of the entries they cover and 0.32% of the
  transcript (`docs/_evidence/memory-bench/217/stm-probes.json`).

### Recall

`recall { id }` with an STM record id returns the record and its evidence without re-running anything:

```text
Observation [a1b2c3d4e5f6]: result ×2: Campaign tests pass after the retry fix (35 tests, 3 files).
time: 2026-11-09T10:00:00.000Z; last seen 2026-11-09T10:20:00.000Z
sources: e41, e47

Chunks:
[chunk 0f3c…] from e47, 35 bytes:
Ran 35 tests across 3 files. 0 fail
```

- **What it returns.** The kind, description, time (`lastAt` once repeated), count and source ids, then every chunk
  verbatim, read from the chunk store for the executing session. `detail: "full"` adds the raw source entries
  (`Source evidence:`), as recall returned by default before plan 217. The tool value carries `state`
  (`active | dropped | tombstoned`), `chunks` (each ref with `text`, or `dropped`) and, with `full`,
  `sourceEntries`.
- **Dropped chunks.** A chunk the session's store no longer holds reads `chunk dropped: <reason>`: `record superseded by
  <id>`, `record dropped` (rehearsal or compaction), `record tombstoned (<reason>)`, or, for an active record, no
  referrer in this session's store (the default in-memory store does not survive a restart).
- **Tombstones.** A `memory.session.observations.tombstoned` record (`OBSERVATIONS_TOMBSTONED`: `observationIds`,
  `reason`, `at`) removes records from the surface: they leave the active set and the context block, and `recall`
  still finds them by id with `state: "tombstoned"` and the reason. WM writes one for every record it gives a verdict,
  in the same pass that moves the record's chunk referrers ([Working memory](#working-memory)).
- **WM items.** `recall { id }` with a WM item id returns its kind, relevance, text, time span, the STM records it cites
  (with their state), its chunks verbatim and the cited records' source entries (`kind: "wm_item"`, `superseded`).
- **Session-bound.** An id this session's ledger does not hold answers `unknown_id`, with the same text as an id that
  never existed, so a forged id does not reveal whether another session has it. Chunks are read with the executing
  session's id, so a chunk only another session references reads as dropped.
- **Cost.** One ledger fold (already in memory) and one chunk-store read per chunk; no model call. A store that cannot
  be read lists the chunks as `(not read)` and the call still succeeds.

### Dates, updates, and the current task

The STM worker sees each source message prefixed with its stored ISO timestamp, and gaps of at least
10 minutes marked as `[gap: 10m]`, `[gap: 2h]`, or `[gap: 2d]`. It converts relative time references
using that message time. `record_event { kind, description, sourceEntryIds, relevance?, referencedAt?,
supersedes? }` derives `observedAt` (and `lastAt`) from the latest source timestamp; `timestamp` remains the recording
time. `referencedAt` accepts a valid `YYYY-MM-DD` date; invalid dates are discarded. A known
`supersedes` id writes a drop record with `reason: "superseded"` and `supersededBy`; unknown ids are
ignored and reported in the tool result without discarding the new event. WM item date
ranges come from their evidence. Older observations without `observedAt` use `timestamp`.

`record_task_state { goal, openQuestions?, decisions?, nextSteps? }` replaces the current task.
The last three fields are arrays of strings (at most 32 each). All text shares the
`worker.maxTaskStateBytes` cap and is truncated safely on UTF-8 boundaries. The STM worker records it
when the task changes and lists assumptions not confirmed by the user under `openQuestions`.
Each record carries the supplied source entry ids; folding keeps only the latest task state.
The STM worker reports these ledger records through `onRecord`; the package persists them
automatically, and the event array return value stays unchanged.

The block asks the agent to cite memory ids and carries `metadata: { source: "memory.session", itemIds: [...] }`
for the items actually rendered, in display order. WM items appear first (facts, summaries, then events), observations
(the STM surface) by source date next, and the current task last:

```text
# Session Memory
Use these source-backed memories when relevant and cite the ids you rely on as [id]. To inspect evidence, call recall with an id; [chunk] marks a record whose verbatim source text recall returns. Do not guess ids.

## Working memory
- [112233445566] (2026-10-15T09:12:00.000Z – 2026-10-17T09:12:00.000Z) (high) summary: Deploy moved Thursday → Friday (2026-10-17) [chunk]

## Observations
### 2026-10-15
- [a1b2c3d4e5f6] 09:12 (high) statement: User moved the deploy to Friday (refers to 2026-10-17)

## Current task
- [ffeeddccbbaa] Goal: Deploy the release
Open questions:
- Confirm the production window
Next steps:
- Test staging
```

## Long-term memory

**Long-term memory (LTM), and the only store of record.** Typed notes and verbatim exchanges live here; the
[session tiers](#session-memory) observe the session and feed this store's candidate notes. The ontology is not part of
memory: [`@arnilo/prism-knowledge/wiki`](../../knowledge/wiki/README.md) keeps concepts in its own store and reads long-term memory
only through the read-only [`memory.ltm`](#the-memoryltm-service) service (plan 216 Task 3); the
[example](../../../examples/memory-and-wiki.ts) runs both.

Semantic and scoped memory: the `memory.view`, `memory.read`, `memory.insert`, `memory.replace`,
`memory.recall`, and `memory.forget` tools, a `context.build` block, and per-session enablement. It is the successor to
the 0.12 `@arnilo/prism-memory/{fabric,scoped}` subpaths. Config field paths in this section are relative to `ltm`
(`inject.query` is `ltm.inject.query`). Measurements below name the component by its former name, "fabric".

### Usage

```ts
import memorySystem from "@arnilo/prism-memory-system";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openai/gpt-5",
  // Retrieval is lexical (BM25) and needs no embeddings package.
  packages: [memorySystem({ ltm: { tools: { root: "./memory" } } })],
});
```

For a conversational assistant, one line selects the measured configuration (see
[Conversational preset](#conversational-preset); it archives exchange text, which is a storage decision):

```ts
packages: [memorySystem({ ltm: { preset: "conversational", tools: { root: "./memory" } } })],
```

The fabric is on for every session by default (`enabled: true`); `installing` the package is the
opt-in. Run the `memory` command to toggle it per session. Its tools are hidden from and
uncallable by a session where it is off.

### Private recall diagnostics

Direct SDK callers may pass `onRecall(event)` to `createLongTermMemory`. The callback receives the query/options, ranked valid candidate ids/scores before top-k and budget selection, and returned ids. It does not receive note bodies or change ranking. Observer exceptions are ignored. It is absent by default and adds no model or embedding call; enabling it adds callback and trace-storage overhead.

For the package, a host package may provide the optional `memory-fabric.diagnostics` service with the same callback before loading memory fabric. Queries can contain private user text: retain observations privately, never in public status logs. This observer measures retrieval candidates; inspect the actual model request to distinguish tool/passive rendering and truncation from candidate availability.

### Long-term memory cost, security, and failure behavior

- Retrieval is **lexical**: notes are searched with the store's lexical leg (in-memory term coverage, SQLite
  FTS5/BM25, Postgres full-text). No embeddings package is needed and the fabric makes **no embedding call**.
- The memory directory (below) makes no model or embedding call: one aggregate query per session epoch, at most 500 tokens in the prefix (200 by default).
- The standing rules (below) make no model or embedding call either: one metadata `scanMetadata` page
  per scope at session start, compaction, retraction or explicit refresh, at most `rules.maxTokens`
  in the prefix (600 by default, 2,000 when `rules.capture` is on, hard 3,000). Turns between rebuilds
  reuse the cached block, so a stable session sends byte-identical bytes.
- Path cues (above) make no model or embedding call: after a new touched path, one metadata scan
  (cached until a write changes the index) plus one bounded `get` for the matched text, at most
  `cues.budgetTokens` in the tail (300 by default). A turn with no new path does no work.
- The team store (below) is one extra markdown store opened at setup, when `.prism/memory/` exists:
  one bounded reconcile plus one trust scan of its notes, and one extra query per recall. No model
  call and no embedding call; writes happen only through `memory:share`, after a person approves.
- The exchange archive (below) is off by default and costs **one local fabric write per completed
  turn** (several only when a turn is long enough to split), plus one branch read for the pair. No
  model call, no embedding call in lexical mode, and no added store query: the write runs in
  `session.background` after the reply is stored. Storage grows by about one turn's text per turn, so
  the default is off. `DEFAULT_RECALL_KINDS` includes `exchange`, so an opted-in archive makes passive
  delivery longer by the history it recalls (facts are delivered first, then exchanges).
  `exchanges: { steps: true }` adds a bounded step trace to each exchange: at most `exchanges.maxSteps`
  (24) lines, capped at a quarter of the entry limit (about 1.5 KB at 24 typical steps, so roughly
  1.5 MB per 1,000 turns that each ran 24 tools; a turn with no tool round adds nothing). Same write,
  no extra query, no model call.
- Lessons (below) add no write path of their own: the agent writes one with `memory.insert` in its
  turn, and each `evidence` id costs one `getEntry` per active scope. The opt-in nudge
  (`lessons: { nudge: true }`) adds one branch read per completed turn, pattern matching with no
  model call, and one tail line (about 50 tokens) on the request after a signal turn only.
- Session consolidation (below) is off by default and costs **one model call per pass**, only when a
  pass runs. Verifying a candidate and archiving a stale one are metadata
  updates with no embedding or model call. A turn with no new session material starts no pass.
- **Maintenance** (below) is metadata-only and makes **no model call**. `fabric.maintain()` reads one `scanMetadata` page set per scope
  plus one `get` batch for the text it may rewrite; duplicate merging and eviction make no calls.
- Every state write is one store entry and counts toward compaction thresholds; the package writes
  on toggle, not per event. `store.postgres.connection` is a ref-only secret; a literal fails
  validation, and a resolved value is never echoed.
- **Model tools cannot write the `agent` scope.** `memory.insert` with `scope: "agent"` from a project session
  fails with `agent_scope_not_writable`; only a trusted host write creates an agent note.
- **Provenance and poisoning.** Every durable write stamps `generated: { by, at }` — `agent` (with
  the session id), `promotion` (with the reflection and evidence ids), `human` (an external edit
  found by reconcile), `import`, or `host` — and `log.md` records the actor on each line. Reconcile
  runs `scanScopedMemoryContent` once per externally changed file: a hit sets `status: candidate`
  with `flags: [<class>]`, rewrites the note, and logs `flagged`. A flagged note is never injected
  passively and `memory.recall` renders it `[flagged: <class>]`; only `memory.replace` or a clean
  human edit lifts it. The scan is content-only and heuristic: it quarantines, it does not prove
  safety. Audit memory with `log.md` and `git diff` (MINJA, arXiv 2503.03704).
  `memory.forget` removes a purged id from every survivor's `links`; a later read or export never
  exposes a dangling edge, and derived lineage rows are removed by the existing lineage walk.

### Consolidation

The default makes no model calls. Same normalized text updates a same-kind note in place when the active
similarity meets `consolidate.threshold` (default `0.85`; term-set Dice between the two notes in lexical mode,
pre-fusion cosine for a `Memory` created with an embedder). Different text keeps both notes. The Dice reading of
`0.85` is a tuning default and may change in a minor version. File notes continue to refresh the same path in place;
different paths remain separate.

Retirement requires an explicit `supersedes` id. Explicit supersession requires an accessible fabric note in the
current scope and preserves its metadata while setting `validTo`. `memory.replace`/`correct()` provide explicit
corrections.

| Mode | Extra model calls per indexed write |
| --- | --- |
| Default consolidation or `consolidate: false` | 0 |

#### Consolidation: signals

`gatherConsolidationCandidates(entries, { cursor, maxCandidates, maxTextChars, patterns, redact })`
is the first step of a session consolidation pass, and the only one that makes no model call. It is a
pure function over `session.entries()` output: it reads what observational memory already keeps plus
the signals in the transcript itself, and returns ordered candidates
`{ source, text, evidenceIds, signals }` for the extractor to interpret.

| Source | Read from | Signal |
| --- | --- | --- |
| `explicit` | user messages matching `patterns.explicit`; the matched sentence only | `explicit: 1` |
| `correction` | user messages matching `patterns.correction` when the preceding turn is the assistant's; carries the corrected entry id and the note ids cited in that turn | `correction: 1` |
| `decision` | `MemoryTaskState.decisions` in `om.task_state.recorded` records after the cursor | — |
| `observation` | observations rated `high` or `critical` (`critical` first) | — |
| `reflection` | working-memory items no later WM pass superseded (the source keeps its name until plan 219 retires gather) | — |
| `exchange` | not-yet-consolidated archived exchanges, read through scoped recall with the session tail as the query | `explicit: 1` support when the extractor's note cites it |

An **exchange** candidate is added by the pass, not by `gatherConsolidationCandidates`: when
`exchanges` is enabled, `createLongTermMemory().consolidate()` recalls archived exchanges that no pass
has read yet (metadata `consolidatedAt` absent), scope-tagged, capped by the same `maxCandidates`
budget as the transcript candidates and at `maxTextChars` each, and marks them read once the pass
returns. Its evidence id is the exchange note id and its `tRef` is the exchange's. Measured facts then
carry `links: [{ id, relation: "evidence" }]` to the exchanges behind them, so the fact is the index
and the exchange is the verbatim detail; an exchange outside the note's readable scopes is never
linked.

`patterns` defaults to the exported `CONSOLIDATION_PATTERNS`:

- **explicit**: `remember`, `always`, `never`, `don't`, `do not`, `I prefer`, `from now on`, `make sure to`.
- **correction**: `no,`, `that's wrong`, `actually`, `instead`, `not what I`, `you should have`.
- **outcomes**: `bun test`, `npm test`, `pytest`, `cargo test`, `go test`, `git commit`.

An **outcome** (`outcome: 1`) is not a candidate of its own: a tool result without an error flag
whose call matched `patterns.outcomes`, or an approval grant (`decision.resolved` with `allow`), tags
the candidates whose evidence lies in the same run. Candidates come out in priority order (explicit,
correction, decision, observation, reflection), at most `maxCandidates` (default 48), each capped at
`maxTextChars` (default `memory.limits.maxEntryTextChars`).

The `cursor` is the last entry id a previous pass covered, so a pass reads only new material and
gathering is idempotent for the same cursor. Security: assistant text is never an `explicit`
candidate (the agent cannot promote its own claims as user instructions), tool output is never a
candidate text, and persisted entries are redacted already; `redact` is the second pass for a host
with its own secrets.

#### Consolidation: the extractor

`extractConsolidationNotes({ client, candidates, segments, recallExisting, limits, redactor, secrets })`
is the second step of a pass and the only one that calls a model: **one call for a valid answer, or
two only after one bounded repair**, made through the shared worker loop with a single schema-declared
tool, `record_notes`. The schema in `consolidation/prompts.ts` is the one source for the tool
definition and for parsing. The schema's id fields and kind choices stay constant across sessions;
the runtime parser checks that evidence (`c1`, `c2`, ...), contradiction and episode segment ids
were shown in this pass. An episode without a shown segment is rejected; a `path` note requires
`applies_to`, regardless of how much conditional JSON Schema the provider honours.

The prompt carries the candidates, up to 12 active notes per scope from `recallExisting` (lexical,
over the candidate text), and the session's task segments. It asks for one atomic, self-contained,
typed note each — `fact`, `procedure`, `preference` or `episode` — with a proposed scope, keys and
aliases, evidence ids, generality and ephemerality, and the precision-first scope rule: the narrowest
scope that stays true, never wider than the evidence.

Two system prompts share those rules. `CONSOLIDATION_EXTRACT_SYSTEM` is domain-neutral ("an agent's
session"); `CONSOLIDATION_EXTRACT_SYSTEM_PROJECT` adds the repository and derivability rules and is
used only when a project scope with a declared root is active, so a coding session keeps its
repository rules while a host without a project is not asked for them. Both add the general
fact rules: a specific fact the user stated (a possession, event, date, count, name, plan or changed
value) is durable; `tRef` carries the instant when the evidence has one, and an event with no time of
its own takes the date of the candidate it came from; and `key` names one changeable attribute — a
value a later statement replaces — so a later value supersedes the earlier one instead of piling up
next to it. `tRef` is validated as an ISO 8601 timestamp and stored on the note; a keyed note whose
`tRef` is later than the shown note with the same kind, scope and key supersedes it through the write
path (`supersedes`), so one current value stays current.

Conversational history needs three rules on top of that (plan 188.10 Task 6), and they are prompt
text only: no new note kind, no new field. **One fact per instance** — each event, purchase, visit,
trip, item or person the user mentions is its own note, even when several share a category.
**Keys are for attributes, never instances** — two visits never share a key; an instance takes no key,
or one unique to it (`trip.2023-05-kyoto`), so both stay active and a count across them stays
answerable. A count the user states ("I have 3 bikes") is an attribute; the bikes are instances.
**Category keywords** — every fact carries 2–4 generic words someone would search for ("doctor",
"health", "appointment" for a visit to a dermatologist), while specific names and synonyms go in
`aliases`. Both reach the lexical index (aliases merge into `keywords` on write, weighted above the
body), so "which doctors did I see" finds a note that only says "dermatologist" — which is what makes
cross-session aggregation work without a read-time model call.

- **`agent` scope is downgraded to `project`.** Only the widening pass writes agent-scope notes from
  promotions. An explicit user statement may target `user`.
- **Episodes** are one per task segment (the span between OM task-state goal changes), at most 280
  characters. A second episode for a shown segment fails the answer.
- **Derivability** (project prompt only): anything a reader can derive from `AGENTS.md`,
  `README.md`, `package.json` or the code is not a note.
- **Fail closed**: a malformed answer — invalid shape, an unknown kind or scope, an evidence or
  `contradicts` id that was not shown, more notes than the pass allows, an oversize item — is
  rejected whole. A shape-only failure gets **one** repair call with a safe `reasonCode` and the same
  shown ids; a second invalid answer, an invented id, an unsafe scope, a trust/secret rejection, an
  abort or a worker limit never becomes accepted through repair. The pass then fails with a
  `reasonCode` and call counts (`modelCalls`, `correctionCalls`), writes nothing and keeps its cursor,
  so the material is retried on the next trigger. An aborted call aborts the pass itself.
- **Truncation is its own reason.** A turn that stops on the output limit (`max_output_tokens`) without
  a valid `record_notes` call fails as `output_truncated`, which is repaired once: the repair asks for
  fewer, shorter notes over the same evidence. A second truncation fails the pass. Raising
  `promote.maxOutputTokens` is the fix for losing a long session's facts this way.
- **Per-item rejection**: the trust scan (`scanScopedMemoryContent`) and the secret redactor run on
  every output text, keyword and alias. A flagged or secret-bearing note is dropped and counted as
  `rejected.trust` / `rejected.secret` instead of failing the whole answer.

Cost: one model call per valid pass; a malformed answer costs at most one additional call; exchanges
join that same call rather than adding one. Input is bounded by `maxCandidates × maxTextChars` plus
at most 48 existing-note snippets (240 characters each), all measured against `workerLimits` before it
is sent — the `maxCandidates` budget is shared by transcript and exchange candidates, so enabling
`exchanges` widens a pass's input only up to that ceiling. `promote` off or `exchanges` off avoids the
exchange share entirely. The pass report counts the actual
`modelCalls` and `correctionCalls`, so a repair is attributable, plus `failures` (a tally by
`reasonCode`) and `outputLimited` (calls that stopped on the output limit), which `memory:status`
reads back. The client is resolved by the caller only when a pass runs, so loading the package
resolves none.

Extractor calls share the provider cache key `prism-fabric-extract:default` (domain-neutral) or
`prism-fabric-extract:project` (repository rules), while retaining `sessionId` for attribution.
Only the constant system prompt and tool schema form the shared prefix; candidates, existing
notes and segments stay in the per-session user message. Savings are bounded by that prefix
(roughly 800 system tokens plus the schema, about 1,300 tokens combined with GPT-4.1's tokenizer),
at the route's cache-read discount. They are not a percentage of session cost. Cache eligibility
and hits depend on the route's minimum prefix, routing and retention; this adds no model call.
Different configured note caps can produce different schemas.

Two host knobs tune that one call:

- **`promote.maxOutputTokens`** (integer 256–32,768) re-resolves the extractor's client with
  `parameters.maxTokens = min(maxOutputTokens, model.limits.maxOutputTokens)`, the same rule
  compaction uses. Absent, the model's own parameters apply unchanged. 48 notes do not fit a solver's
  4,096-token answer budget; this is a write-side cost, never the answer's.
- **`promote.thinkingLevel`** (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) is passed to
  the worker loop. Absent, the model's default applies. Reasoning before one large structured answer
  is where truncation hides, so a level is cheaper than a repair.

**Measured overhead** (5 development multi-session haystacks, real prompt builder, offline): the
extractor prompt is ~44 kB with an empty store and ~58 kB with the worst case the constants allow (48
existing notes at the 240-character cap). By part: system 2,845 B, schema 1,621–2,156 B, existing
notes 0–13,383 B, the session's own candidates 39,179 B, segments 0–437 B. The candidates dominate
(~89%), so the harness is a bounded minority and no trim of the existing-note or schema share was
justified. A fixture in `__tests__/extractor-budget.test.ts` pins the parts, so a later overhead
regression fails a test instead of a paid run.

#### Consolidation: scoring and the gate

`scorePromotion(note, context)` decides deterministically whether an extracted note is worth writing.
No model call: every term comes from the extractor's answer or from lexical analysis of the note,
its evidence, and the repository's own documents.

```
score = explicit + correction + outcome·0.5 + recurrence·0.5 + generality·0.5
      − ephemerality − derivability − duplicate·0.5
```

A note is accepted when `score ≥ minScore` (default 0.5). The weights (`promote.weights`) and
`minScore` are **tuning defaults** that may change in a minor version; the default weights live in
`promote.ts`.

| Signal | Meaning |
| --- | --- |
| `explicit` | The user said it directly. Requires an `explicit` (or archived `exchange`, which is verbatim user speech) candidate in the note's evidence; without one the flag is cleared. Never rejected for score. |
| `correction` | The user corrected the agent, and a `correction` candidate supports the note. |
| `outcome` | An outcome tag (a passing test run, a commit, an approval) covers the note's evidence. |
| `recurrence` | `log2(1 + distinct sessions)`, normalised to reach 1 at four distinct sessions and capped there. Repeats inside one session add nothing. |
| `generality` | From the extractor: how broadly the note holds. |
| `ephemerality` | From the extractor, raised to 1 when the text carries a line reference (`:42`), a temp path (`/tmp/` or the scratch directory), a commit hash (7+ hex), a branch name, or a date the note would outlive (a note that states its own `since`/`until`/`as of` bound is durable). |
| `derivability` | 1 when the extractor flags it, or when the note's terms are ≥ 0.9 lexically covered by a `derivableFrom` file. |
| `duplicate` | The highest Dice with an active note **of the same kind in the target scope**. |

Rejection carries one reason code, which `memory:status` reports:

- `ephemeral` — `ephemerality = 1` and the note is not explicit.
- `derivable` — the repository already records it; rejects even an explicit statement.
- `score` — under `minScore`.

Secrets and the trust scan are the extractor's rejections, not this gate's. `loadDerivableSources(root,
files)` reads `derivableFrom` once per pass through the fabric file jail: inside the project root, each
file capped at 64 KiB, with `../` and absolute escapes, symlink escapes, and unreadable files skipped
and reported as `{ path, reason }` instead of trusted.

### Config

```ts
memorySystem({ ltm: {
  preset: "conversational", // default none; expands first, explicit fields below replace the preset's value
  enabled: true, // default
  semantic: true, // default; whether indexed notes are available
  inject: false, // default; opt in with { query: "task" } → minSimilarity 0.2, minScore 0.2, fullTextScore 0.35, cardExcerpt "head", topK 12, budgetTokens 4000
  directory: true, // default when semantic or tools.root is set; or { maxTopics: 8, maxFiles: 10, maxTokens: 200, stopWords: false }
  rules: true, // default; or { capture: "off", maxTokens: 600, scopes: ["user", "project"], kinds: ["fact", "preference", "procedure", "decision"] }
  cues: true, // default; or { budgetTokens: 300, maxPerTurn: 2 }
  team: false, // default; or { dir: ".prism/memory", write: "ask" } — the checked-in team store
  scopes: {
    tenantId: "prism",
    user: true,
    agent: true,
    project: { root: "." },
    // Additive priors after RRF; each in [0, 0.5]. Defaults shown.
    priors: { path: 0.15, project: 0.1, team: 0.075, agent: 0.05, user: 0 },
  },
  store: "markdown", // default when tools.root is set: the notes/ tree under the root
  // Alternatives: { markdown: { dir: "notes" } }, { sqlite: { path: ".prism-memory.sqlite" } },
  // { postgres: { connection: "env:PRISM_PG_URL" } }, or "memory"
  tools: { root: "./memory", maxFileBytes: 50_000 },
  limits: { rebuildBatchSize: 100, rebuildMs: 30_000 },
  consolidate: true | { threshold: 0.85 },
  // The exchange archive: off by default; {} archives each completed user turn verbatim.
  exchanges: false | { enabled: true, steps: false, maxSteps: 24 },
  // Cited lessons (plan 209 Task 4): the opt-in nudge needs the exchange archive.
  lessons: { nudge: false, minTurnsBetweenNudges: 5, archiveAfterSessions: 20 },
  // Verification by use across separate sessions (a citation is a use, a retrieval is not).
  lifecycle: {
    verifyAfterSessions: 2,
    // Retrieval-strength decay per kind; higher forgets faster. Tuning defaults.
    decay: { episode: 0.8, fact: 0.4, procedure: 0.4, preference: 0.2, decision: 0.2, exchange: 0.5 },
    // Storage-strength coefficients of `explicit + sessions·log(1+useSessions) + helpful − harmful + outcome`.
    storageWeights: { explicit: 1, sessions: 0.5, helpful: 0.5, harmful: 1, outcome: 0.5 },
    // Recall priors `w_R·σ(R) + w_S·σ(S)`; each in [0, 0.5], default 0.05.
    recall: { retrieval: 0.05, storage: 0.05 },
    // Archive needs both strengths below the threshold, past the grace window.
    archive: { retrievalBelow: -2, storageBelow: 1, graceSessions: 10 },
    // Per-scope budgets; a path note spends the project budget. Tuning defaults.
    capacity: { user: { notes: 200, tokens: 20_000 }, agent: { notes: 200, tokens: 20_000 }, project: { notes: 500, tokens: 60_000 } },
    // Raw history has its own size-only tier; excess exchanges are demoted, never deleted.
    exchangeCapacity: { hotTokens: 200_000 },
    // Duplicates fold deterministically, with no model call.
    merge: { duplicateDice: 0.8 },
  },
  // Off by default. An object enables session consolidation and its extractor pass.
  promote: {
    model: "hyper/<id>", // default: the agent's model
    minScore: 0.5, // tuning default
    minTurnsBetween: 8,
    maxCandidates: 48,
    derivableFrom: ["AGENTS.md", "README.md", "package.json", "CLAUDE.md"],
    maxOutputTokens: 8192, // default absent: the model's own parameters; capped by its limit
    thinkingLevel: "low", // default absent: the model's default
  },
  // Off by default. Needs a decisions-capable model; absent leaves every incumbent path unchanged.
  decisions: false | { model: "liquid-local/d1-3B", points: ["P3", "P4", "P5", "P7"] },
} });
```

`store.postgres.connection` is a ref (`env:` or `keyring:`) resolved through
`prism.credentials.resolve`; a literal fails config validation. `pg` is loaded only when a
Postgres store is configured.

With `tools.root`, notes persist in the **markdown store** at
`<tools.root>/notes` by default: one OKF note file per note under `<tenant>/<resource-path>/`, a
derived SQLite index at `notes/.index.sqlite`, control state at `notes/<tenant>/<resource-path>/.state.json`,
and the browsable `notes/index.md` / `notes/log.md` audit files. The files are canonical and the index
is rebuildable, so the agent can browse the tree with `memory.view` / `memory.read` and a person can
read and edit it directly. `store.markdown.dir` (default `notes`) resolves against `tools.root`; a path
outside it (including a symlink escape) is rejected. The startup file reconcile and the directory walk
never treat `notes/**` as user files. The `memory:reindex` command rebuilds the derived index from the
files and reports `indexed`, `removed`, and `malformed` counts; pass `{ full: true }` to re-read every
file. Postgres persists both stores; its existing optional `table` setting still selects the vector
table. Agent disposal closes stores after any pending reconcile.

The measured markdown operating envelope is **up to 10k small notes for mixed local read/write
workloads**. The 2026-11-02 run measured warm open 309 ms, p95 lexical recall 0.93 ms and p95 write
36.6 ms at 10k. At 50k, warm open was 1,559 ms, p95 recall 4.39 ms and p95 write 217.4 ms, so 50k is a
measured read-heavy stress point, not the mixed-workload recommendation. Switch to SQLite or Postgres
above 50k, for concurrent/server writers, or when 200 ms writes matter. The separate exchange envelope
is p95 recall **1.06 ms on SQLite and 4.15 ms on Postgres at 100k exchanges** (200 queries, isolated
throwaway schema). These are single-run tmpfs/local-container measurements; validate durable storage
before adopting the envelope. Cold rebuilds can require additional incremental reconciliation passes
before all notes are searchable. See the
[markdown scale evidence](../../../docs/_evidence/memory-markdown-scale-0.13.0.md) and
[exchange scale evidence](../../../docs/_evidence/memory-bench/202/exchange-scale.md).

`{ sqlite: { path } }` and `{ postgres }` stay available but are **not inspectable without
`memory:export`** (plan 188.1 Task 7): they hold rows, not browsable files. Relative SQLite paths
resolve against `tools.root`; paths outside it are rejected. Without a root the default is `"memory"`,
with a warning that memory is lost on process exit. Explicit `store: "memory"` avoids database writes
(file tools still write the files you request).

Startup schedules one background reconcile through the file jail, bounded by
`limits.rebuildBatchSize` and `limits.rebuildMs`. It compares SHA-256 hashes stored on file notes,
re-indexes each changed or new file once, and forgets notes whose file is missing.
Unchanged files cost nothing; no model calls are made. The first context build waits for this
bounded pass. The markdown store's own tree (`notes/**`), the SQLite store file and sidecars,
symlinks, empty files, and files over `maxFileBytes` are skipped. Large directories/indexes can
require an explicit rebuild: the pass
reads at most one index page and visits at most `rebuildBatchSize` entries (directory listings cap
at 200). An incomplete listing is never treated as evidence of deletion.

### Scopes

`scopes` names the levels the fabric reads and writes; a note's resource tells which level it came
from. Levels are resolved narrowest first:

```ts
memorySystem({ ltm: {
  scopes: {
    tenantId: "prism", // default
    user: true, // default: user-wide preferences -> notes/<tenant>/user/
    agent: true, // default: lessons proven across projects -> notes/<tenant>/agent/
    project: { root: "." }, // default on: notes/<tenant>/projects/<slug>--<id8>/
  },
} });
```

The project resource id is `<slug>--<id8>`: a lowercased repository or directory slug plus the first
8 hex characters of SHA-256 over the identity source. The source is the git remote URL (`origin`
preferred), normalised with the scheme, credentials, and trailing `.git` removed and the host
lowercased. Without a remote it is the real path of the git top level, else the real path of the
root. A worktree shares the remote and therefore the id; a moved checkout keeps it too. Reads only:
no `git` subprocess is spawned.

`projects/<slug>--<id8>/project.md` is an OKF `project` concept written on the first setup and
updated under the store lock. It records the identity source and every real root seen, so a move or
a worktree adds a line without splitting memory. Roots are paths, not secrets; credentials are never
written.

`project.id` overrides detection for servers whose projects are not git checkouts and must match
`^[a-z0-9-]{1,40}--[0-9a-f]{8}$`. An invalid id or an unresolvable root disables the project scope
with one `status.note("warn")` and leaves user and agent active; enabling no level at all fails
config validation. The old `scope` key (tenant/resource/thread) is retired with no alias; the thread
id is fixed per memory instance (`default`) and a session id is provenance, not a scope.

#### Write scopes

| Kind | Default scope | Stored under |
| --- | --- | --- |
| `fact`, `procedure`, `episode`, `file` | `project` | `notes/<tenant>/projects/<slug>--<id8>/<dir>/` |
| `preference` | `user` | `notes/<tenant>/user/preferences/` |

`remember` and `memory.insert` accept `scope` (`user | agent | project | path`), `appliesTo`, and
`key`. `team` is never a write scope for a tool: those notes come from `memory:share` (below). `path` notes live in the project resource and carry 1–8 globs relative to the project root
(no absolute path, no `..` segment, no NUL); they apply only where a touched path matches. `key`
(`[a-z0-9.-]{1,64}`) is the stable subject id used for shadowing and widening. A write to a scope
that is not active fails with `scope <x> is not active`. A note's OKF file records the level under
`prism.scope.level` and the globs as `applies_to:`.

Ids are addresses across scopes: `memory.replace`, `memory.forget`, `fabric.verify`, and
`fabric.forget` find the note in `path`/`project` → `agent` → `user` order, one store read per
scope. Superseding a note that lives in another scope is refused (`MemoryScopeError`); narrow a
note instead of replacing one from a wider scope.

#### Recall across scopes

Recall queries every active scope through that scope's own `Memory`, so consent, invalidation, and
share-grant rules still apply per scope. The per-scope rankings are fused with RRF (`fuseRankings`),
then two bounded priors are added: `score + priors[level] + w_R·σ(R) + w_S·σ(S)` (scope defaults path
0.15, project 0.10, team 0.075, agent 0.05, user 0, each in `[0, 0.5]`; strength weights 0.05 each, in
`[0, 0.5]`).
`R` is ACT-R base-level activation over the note's use log in scope sessions, `S` is accumulated
evidence (explicit, sessions used, helpful, harmful, outcome tag), and `σ` is the logistic function.
Both priors are bounded by their weights, so relevance keeps the final word. The floor
(`minSimilarity`) applies per hit before the priors. A `path` note earns the path prior only when one of its `applies_to` globs matches a path
the session touched via `read`, `edit`, or `write`; otherwise it ranks as a project note. Touched
paths are kept workspace-relative, newest first, capped at 256, and persisted once per turn only
when the set changes.

When two hits share a `key`, only the narrower scope's hit is returned (`path` > `project` >
`team` > `agent` > `user`); the wider hit appears in `explain` with `shadowedBy`. Recall results reserve at
least one slot per scope that has a hit, then fill by rank within the token budget, so a project
note cannot crowd out user and agent memory. `memory.recall` and passive injection
both use this path, and every rendered hit starts `[id] <level> [kind] <date>`.

The one active scope case skips fusion and priors: it keeps the mode's own similarity score.

Archived notes are not part of that ranking: `includeArchived`, or a weak best active hit, appends up
to three of them after the active hits, marked `[archived]` (see the lifecycle section).

Isolation is structural: every read and write is bound to a resource id, so a session rooted in
project A cannot see project B's notes even when both use the same store file or tree. The
parameterised isolation suite runs on the in-memory, SQLite, and markdown stores and in the
Postgres integration suite; it also proves that user preferences and agent notes stay shared and
that forgetting project A's note leaves project B untouched.

### Delivery tiers

Memory reaches the model in three tiers (plan 188.5). A cue matching the context a note was encoded
in brings it back, so each tier is triggered by the most specific cue available and the cheap,
always-present tier stays small:

| Tier | Block | Where | Changes when | Cost per turn |
| --- | --- | --- | --- | --- |
| Standing rules | `fabric-rules` | prompt prefix | session start, compaction, retraction, refresh | zero after the first cached turn |
| Path cues | `fabric-semantic` tail | tail | a file tool touches a path for the first time in the session | tokens only on the turn a new path matches; none otherwise |
| Directory | `fabric-directory` | prompt prefix | the same as the rules | one aggregate query per rebuild |
| On demand | — | `memory.recall` | — | normal recall plus one local lexical discovery query per active scope only when default kinds return zero hits |

Two properties hold the cost down, and `packages/memory/system/src/ltm/__tests__/prefix-stability.test.ts`
pins the first one: a quiet turn sends byte-identical prefix blocks (the directory and the rules), so a
provider's prompt cache hits instead of re-ingesting them; and path cues add no lines on a turn that touches no new path.

The team store (below) is a scope, not a tier: it joins recall and injection like `project` and
`agent`, and adds no block of its own.

#### Standing rules

The standing rules are the small, human-editable centre of the memory: a slice of long-term memory
that is always loaded, one line per rule as `[id] text`, user-scope rules first:

```text
Standing rules (user): [41aa…] Prefers bun over npm. [77b0…] Uses fish shell.
Standing rules (project prism): [9c1e…] Run memory suites with --timeout=0. …
rules: 12 shown, 3 more — memory.recall
```

Only `preference`, `fact`, `procedure`, and `decision` notes enter, and only when they are **verified**,
not archived, not flagged, and still readable — a revoked or forgotten note never appears. A
decision must also be `active`: proposed and superseded decisions stay readable through explicit
recall but never reach the prefix. A decision line ends `— why: memory.read <id>`, so the rationale
is one read away. A path-scoped rule (`scope: "path"`) is not in the block: it loads as a cue when a
touched file matches (see Path cues). The block sits after the directory block, stays inside the
untrusted envelope, and its text passes the redactor.

**Budget and overflow.** `rules.maxTokens` is the fixed budget: 600 by default, **2,000 when
`rules.capture` is `"confirm"`** (a captured rule set earns the larger block), hard 3,000. The
budget splits evenly across scopes and unused budget flows to the other scope. Order is human-written
rules first (a person's line in `rules.md`), then pinned, standing decisions, and descending storage
strength `S`; ties break by note id, so the selection is deterministic. A rule that does not fit
drops from the always-loaded block, stays recallable, and the block ends `rules: N shown, k more —
memory.recall`. A human-written rule is never dropped for an agent's; when human rules alone exceed
the budget, `memory:status` warns and names the count.

`rules: false` turns it off; `{ capture, maxTokens, scopes, kinds }` configures it (scopes
`["user", "project"]` by default, and `user` always renders first; kinds default to fact, preference,
procedure and decision).

**Capture** (`rules: { capture: "confirm" }`, default `"off"`; the `coding` preset sets it). A user
turn with a lasting cue becomes a **proposed** rule: a preference (`I prefer…`, `I'd rather…`) in the
user scope, a procedure (`make sure to…`, `whenever you…`, `before you commit…`) in the project, or a
decision (`from now on`, `always`, `never`, `we decided`, `use X instead of Y`, `no, do X`) with a
lexical rationale. A path in the rule (`in src/payments`) makes it path-scoped. No model is called.
The only capture input is the archived user turn, so capture needs the exchange archive (`exchanges`; both
presets turn it on); without it nothing is captured and setup leaves a warning status note. Tool output and assistant text never become rules,
and every proposal passes the trust scan. One batched `host.ui` confirmation per turn makes the
proposal active and pinned; a host that answers `unavailable`, denies, dismisses or throws leaves it a
`candidate`. A correction that names what it replaces (`use zod instead of yup`) retires the matching
active rule: the old note keeps its history with `validTo` set and is never delivered again.

**Cache stability.** Directory and rules blocks are pinned per session epoch and reused byte for
byte across additive writes, including exchange archiving, inserts and lifecycle evidence updates.
An epoch starts at the first context build (including restore), compaction, a retraction, or an
explicit import/export/reindex refresh. Each start re-reads the stores and invalidates the directory,
rules and cue-index caches, so external additions — and a person's `rules.md` edit — appear at the
next epoch boundary. Retractions through this memory instance (forget, revoke, correct, invalidation,
retention, or metadata that retires/quarantines a note) rebuild on the next request. Retractions made
by another process over the same store do the same: each build re-reads only the rule notes the pinned
prefix shows with one bounded `memory.get` per scope, so another process's additions never break the
cache, while a forgotten, revoked or retired note leaves the next request. If that read fails, the
rules block is left out of that request rather than resent stale, and returns once the store answers.
Notes written mid-session remain reachable through recall, passive tail injection and path cues until
the next epoch.

The rules carry no timestamp and make no model call: one metadata `scanMetadata` page per scope,
plus bounded reads for the text of the rules that fit. Without `scanMetadata` on the store, setup
says so once and the rules stay off. Session snapshots are removed on close.

**`rules.md`.** With the markdown store, each scope's rules are written to `<scope>/rules.md` under
the notes tree, one rule per line, so a person can read and correct exactly what the agent always
reads:

```markdown
- [d12] Validate inputs with zod, not yup. (why: memory.read d12)
- [p03] Run memory suites with --timeout=0. (applies to packages/memory/**)
```

The file is **editable**. At the start of each session the fabric compares the file's marker hash
with its body (one read and one hash per scope); if a person edited it, the edit is folded into notes
and the file is regenerated:

- an added line becomes an active, pinned rule with `generated.by: human` (`(applies to a/**)` makes
  it path-scoped);
- a deleted line retires its note;
- a changed line writes a correcting note (history kept: the old note is retired with `validTo`) and
  keeps the rule's scope and globs.

Every added or changed line passes the trust scan; a line that trips it (or whose write fails) is
refused, counted, and dropped from the regenerated file, so an instruction can never become a rule by
editing. Until the edit is folded in, the store keeps the file as the person wrote it and does not
overwrite it. Stores with no file layout (in-memory, SQLite, Postgres) show the block only.

#### Path cues

A path-scoped note (`scope: "path"` with `applies_to` globs) is shown once per session, in the tail,
when a file tool reads or writes a matching file — the file is the retrieval cue:

```text
- [9c1e…] path procedure (for packages/memory/**) Run memory suites with --timeout=0.
- [d12a…] path decision (for src/payments/**) Validate inputs with zod, not yup — why: memory.read d12a…
```

Matching is a glob check over notes bucketed by each glob's first literal segment, so one touched
path checks one bucket, not every path note. A verified note wins; a candidate shows only where no
verified note covers the path, marked `(candidate)`. A decision cue additionally requires
`decisionStatus: "active"` and a verified row; proposed and superseded rules never show. At most
`cues.maxPerTurn` notes per turn (2 by default, 3 in the coding preset) within `cues.budgetTokens` (300 by default, hard 1000), ordered by storage strength `S`,
then retrieval strength `R`. Paths come from the session's touched-path tracker and must be
workspace-relative, so a path outside the project never matches. The lines join the semantic tail
block and stay in the untrusted envelope; the text passes the redactor.

Cross-source dedup drops a note already in the rules block, already injected by topic, already cued, or
whose text is verbatim in a visible file read. Injected cues join the citation tracker, so citing
one counts as a use. The injected set lives in session state, so a restore never shows a cue again,
and a turn with no new path runs no query. `cues: false` makes no index query and adds no lines.

#### The team store

`.prism/memory/` is memory the whole team checks in: a markdown tree beside the code, reviewed like
code. It is off until config names it, and it is opened only when the directory exists in this
checkout:

```ts
memorySystem({ ltm: {
  tools: { root: "~/.prism/memory" },
  team: { dir: ".prism/memory" }, // default dir; write: "ask" (default) or "off"
} });
```

The directory is `<project root>/<team.dir>`, and it is a full markdown store: the tenant and
resource are fixed (`team` / `project`), so every checkout of the project reads the same notes. Only
the derived index is outside the repository, at
`<tools.root>/.team-index/<project id8>.sqlite`; the checked-in tree holds notes (plus the OKF
`index.md` and `log.md` the store maintains).

Recall and injection treat it as scope `team`, one more scope in the union: fused with the others,
prior 0.075 (between `project` 0.10 and `agent` 0.05), and shadowed by the narrower private scopes
when two notes share a `key`. So `path` and `project` notes win over a team note, which wins over
`agent` and `user` — a person's own exception beats the team default, and a team lesson beats a
cross-project guess. The storage level is the store the note lives in, so a team note needs no
`scope:` of its own.

**The directory is untrusted input.** It arrives with someone else's commit, so on load every note
is passed through the trust scan (`prompt-injection`, `exfil`, `invisible-unicode`). A note that
trips it is rewritten as a `candidate` carrying its `flags:` — quarantined like an imported bundle,
never injected, and counted by `memory:status` (`Team store: … (1 quarantined)`). Setup warns once
when anything was quarantined. Team notes never enter the standing rules, never count toward capacity,
and never count toward widening: only private project notes prove a cross-project lesson.

**Writing needs a person.** The agent has no write path: `memory.insert` refuses `scope: "team"`,
and no other tool reaches the store. `memory:share { id }` moves one verified private project note
(`fact`, `preference` or `procedure`) into the team tree:

```text
/memory:share 9c1e2a4b7d10
  → host.ui confirm: the note text and the target path
  → notes/…/facts/facts-team-…md, generated.by: human, sources: [{ id: <private note id> }]
  → team/project/facts/<slug>--<id8>.md in .prism/memory, plus a `shared-to-team` log line
```

The file is written but never committed: reviewing and committing is the person's step in their own
VCS. A candidate, an archived or flagged note, `write: "off"`, a declined prompt, and a host with no
UI (`unavailable`) all refuse the share with a reason (`not_verified`, `write_off`, `denied`,
`host_unavailable`), and nothing is written.

### Exchange archive

Off by default (`exchanges: false`). Turn it on with `exchanges: {}` and every completed turn is
archived as one note of kind `exchange`: the user's text and the assistant reply that followed it,
verbatim, in the order they were said.

```text
user: Remember the launch moved to Monday.
assistant: Noted; I will treat Monday as the launch date.
```

- **Pairing, not messages.** The archive hooks `message.completed`, which fires after the reply is
  appended (not `turn.completed`, which fires inside the provider round before it). Only an
  assistant message with **no `tool_call` block** ends a turn, so a tool round never becomes an
  exchange and tool arguments/results are never stored.
- **Tool steps (opt-in).** `exchanges: { steps: true }` appends a `## Steps` section to the exchange:
  one line per tool result of that turn, in order, up to `exchanges.maxSteps` (default 24, at most
  64; further ones collapse into `- … N more step(s)`), and the whole section stays under a quarter
  of `limits.maxEntryTextChars`.

  ```markdown
  ## Steps
  - bash `bun test packages/memory` → error: ENOENT: no such file '.prism-memory.sqlite' (entry 01JD…)
  - edit `packages/memory/system/src/ltm/config.ts` → ok (entry 01JE…)
  - bash `bun test packages/memory` → ok (entry 01JF…)
  ```

  A line is the tool name, an argument summary (≤ 120 characters: `command`, `cmd`, `path`,
  `file_path`, `file`, `query`, `pattern` or `url`, whichever the tool's declared `parameters`
  include, otherwise the first scalar argument), `ok` or `error`, for an error the first line of its
  message (≤ 200 characters), and the **session entry id of the tool result**, so `memory.read
  { around }` or the host can reach the full output. Result bodies and the other arguments are never
  stored. Step text is indexed with the exchange, so "the migration failed with ENOENT" finds the turn
  where it happened. Steps are untrusted tool input and output: each passes the trust scan and the
  redactor, and a step either flags keeps only its tool name and outcome (counted in `memory:status`
  as `stepsDropped`); an unsafe step never refuses the dialogue. A step trace is evidence for recall,
  not extraction input: consolidation reads the dialogue only. An exchange whose steps contain a
  failed run followed by a passing run of the same command, where the command matches
  `CONSOLIDATION_PATTERNS.outcomes` (`bun test`, `git commit`, …), is tagged `outcome:fixed`. Off by
  default, so both presets and their revisions are unchanged.
- **Dated and source-backed.** `tRef` is the user entry's timestamp. Relative dates in the turn
  ("yesterday", "last Tuesday", "two weeks ago", "in March") are resolved against it by a
  deterministic English resolver and stored as an additive `dates: [{ text, resolved, precision }]`
  field; no model call is made. `sourceEntryIds` are the two
  **session entry** ids (not message ids). Passive delivery uses them to suppress an exchange whose
  turn is still in the prompt, so history is never injected twice.
- **Scope** (settled by plan 188.9 Task 1c): `project` only when the project scope is active **and**
  a root was declared (`scopes.project.root` or `tools.root`); otherwise `user`; otherwise `agent`.
  A conversational host with no declared root therefore does not file history under whatever
  directory the process started in. An exchange is never written to `path`.
- **Long turns split.** Above `limits.maxEntryTextChars` (16,384 by default) a turn splits on the
  message boundary first, then paragraph, then line, then character boundaries. The parts share
  `tRef` and the source ids and link to each other (`relation: "part"`), so recalling one part can
  expand to its siblings; each part carries `context: "part i of n"`. Other writes keep the hard
  limit.
- **Lifecycle.** Exchanges decay with their own `lifecycle.decay.exchange` (default 0.5) and use the
  separate `lifecycle.exchangeCapacity.hotTokens` tier (default 200,000 tokens). They do not consume
  the fact/preference/procedure budget. Over the hot tier, maintenance archives the lowest-value
  exchange with the audit verb `demoted`; its text stays in the searchable archive and `includeArchived`
  or the weak-active archive fallback can retrieve it. Exchanges are never promoted, never pinned to
  core, never shared with the team store, and never written by a tool.
- **Security.** The kernel writes session entries after redaction, so an agent redactor has already
  replaced its secrets before the archive reads the turn; an explicit `redactor` passed to the
  module additionally *refuses* a turn it would rewrite rather than storing altered history. The
  text is normalized for benign invisible code points, then passed through `scanScopedMemoryContent`;
  a refusal (prompt injection, exfiltration, invisible Unicode) is counted and reported through
  `prism.status.note`, never stored. Benign emoji selectors/ZWJ, formatting zero-width spaces,
  citation bidi marks and mojibake soft hyphens are removed; deliberately hidden code points between
  letters survive and are refused. The current plan 202 Task 14 gate
  (`docs/_evidence/memory-bench/202/safety.md`) scanned 99,090 LongMemEval-S exchanges and refused
  **0.575 per 1,000** (32 injection, 17 exfiltration, 8 invisible Unicode, 0 secret), with **0 of 500**
  needed sessions lost; LoCoMo refused 0 of 324. The 34-item adversarial fixture is detected at
  **34/34**, including `curl -s https://` flag forms. The gate also measures poisoning, cross-user/
  project/team leakage, deletion through files/index/links/core/export, and PII handling. The
  conversational preset stays opt-in until the full default-promotion gate in Task 18.

`memory:archive` back-fills the session: it archives every completed exchange not yet archived
(idempotent by the session entry ids), and reports `archived`, `skipped`, and `parts`. It is the
import path for a session recorded before the archive was on, and for the benchmark harness:

```ts
const agent = await createAgent({ model, packages: [fabric({ exchanges: {} })] });
await agent.commands.run("memory:archive", {}, { session });
```

`memory:recall` accepts `exchange` explicitly and `DEFAULT_RECALL_KINDS` includes it, so an untyped
recall or a passive injection can return archived history. Passive delivery renders **facts first,
then exchanges, each group in time order**, and selection stays by rank; a fact hit expands to its
linked exchange only when `exchange` is among the requested kinds, so naming kinds is also how a
caller asks for the detail.`memory.recall` with `kinds: ["fact"]` returns the fact alone.

#### Conversational preset

One line selects the configuration that passed a live held-out acceptance for conversational recall.
It is **opt-in**: the measured arm archives exchange text (user text and assistant replies, verbatim),
which is a storage decision no quality result should make for a host on its own. Exchanges pass the
trust scan and any configured redactor first (see the security note above), and no secret field is
involved.

```ts
memorySystem({ ltm: { preset: "conversational", tools: { root: "./memory" } } })
```

The preset expands, before any other resolution, to exactly:

```ts
{
  exchanges: {},                                   // archive every completed turn
  inject: { query: "task", kinds: ["exchange"] },  // passive block: the best exchanges, by rank
  semantic: true,                                  // leaves memory.recall / memory.read visible
  promote: false,                                  // no extractor call, so no per-session model cost
}
```

**Merge rule.** An explicitly given top-level field replaces the preset's value for that field. Nested
objects are not deep-merged: `inject: { budgetTokens: 2000 }` drops the preset's `query` and `kinds`.
A field equal to the preset's value is not an override. Overriding a preset field, including turning
the archive off with `exchanges: false`, is allowed and emits one `prism.status.note` naming the
fields. An unknown preset name fails config validation (`MemoryValidationError` from
`resolveMemoryFabricConfig`).

**Traceability.** `memory:status` reports `preset: "conversational"` and `presetRevision: 2`
(`CONVERSATIONAL_PRESET_REVISION`), and the same pair is written to a status note at setup, so
`agent.inspect()` shows the revision next to the package config's `preset`.

**The contract.** What `conversational` promises at API level 1:

- it stores verbatim exchanges, makes **no write-path generative model call**, calls a decision model
  only when the host names one (a `decisions` model, plan 202 Task 12), and needs no embeddings
  service;
- a later revision may change ranking, budgets, delivery format, tool descriptions and read-path
  behaviour, so the host line does not change to adopt an improvement;
- adding a write-path generative model call, a new stored kind, or a required service needs a **new
  preset name** or an explicit opt-in field. The `decision` kind therefore arrives with a new preset,
  `coding` (plan 202 Task 11), not as a change to `conversational`.

Measured on 100 unused LongMemEval-S held-out v3 ids (2026-10-23, `mimo-v2.5` at temperature 0; the
same model judged), against the same store with the tools hidden and against a whole-history prompt:

| | Passive only | Passive + tools | Whole history |
| --- | ---: | ---: | ---: |
| Judge accuracy | 49/100 | **76/100** | 69/100 |
| Multi-session | 10/40 | **28/40** | 23/40 |
| Input tokens per question | 6,378 | 29,669 | 112,955 |
| Tool calls per question | 0 | 1.5 | 0 |

Passive plus the read tools is non-inferior to whole-history context on LongMemEval-S held-out v3 at
about a quarter of the input tokens: 76/100 against 69/100, a paired +0.07 (95% CI -0.03..0.17)
inside the 3-point non-inferiority margin, at 29,669 tokens per question against 112,955 (26%),
1.5 tool calls per question, and 2% of questions hitting the eight-turn limit. Passive injection
alone scores below whole-history context (49/100 against 69/100); the read tools are required, and
the gain comes from the agent pulling rounds the block cut (evidence coverage 0.63 → 0.83), not from
a larger injection. Facts (`promote`) were not needed for this result; the `fabric-xc` arm that
extracts them was not selected. Full evidence: `docs/_evidence/memory-bench/188.10/README.md`.

#### Coding preset

`coding` is `conversational` plus standing rules for repository work. It remains opt-in because it
stores decisions as well as exchanges. The preset expands to:

```ts
{
  exchanges: {},                                   // archive every completed turn
  inject: { query: "task", kinds: ["exchange"] },  // conversational history, by rank
  semantic: true,
  promote: false,
  rules: { kinds: ["decision", "preference", "procedure"], capture: "confirm" }, // decisions first; 2,000 tokens
  cues: { budgetTokens: 300, maxPerTurn: 3 },      // path rules, at most 3 per turn
}
```

A user turn with a lasting-rule cue (`from now on`, `always`, `never`, `we decided`, `use X instead
of Y`, `no, do X`) becomes a **proposed** decision with a lexical rationale; preference and procedure
cues become those kinds (see Standing rules). No model is called.
The user turn and assistant reply are already archived, and `sourceEntryIds` names both. An explicit
`memory.insert { kind: "decision" }` is also proposed. The only capture inputs are user turns and the
agent's own typed write: tool output is never captured. Every write runs the trust scan.

Activation is explicit: one batched `host.ui` confirmation per turn (a host that answers
`unavailable` leaves the note proposed), or use in two sessions with no correction. A correction
that writes a new decision with `supersedes` marks the old one `superseded`; it stays readable by
id but is never delivered. Active path decisions arrive through the existing path cue when a touched
file matches `appliesTo`; active project decisions take the rules block. A narrower scope shadows a
wider one through the existing `key` shadowing. The preset makes **no write-path generative model
call** and needs no embeddings service; a decision model is only used when the host names one
(plan 202 Task 12). `memory:status` reports `preset: "coding"` and `presetRevision: 1`.

The 12-persona coding-lifecycle suite, MemoryCode, and VibeMemBench / DreamBench-SWE remain the
measurement gate (plan 202 Task 2 robust criteria; F3/F7 in Task 14). This implementation lands the
functional contract; the measured target stays with Plan 210 Task 9.

#### Known limitations

- **One benchmark family.** The verdict is LongMemEval-S only; no other suite or model family has a
  held-out v3 result. Evidence: `docs/_evidence/memory-bench/188.10/README.md`.
- **Preference and abstention had no held-out ids.** Both stay development-only, so the preset has
  no held-out quality claim for them. Evidence: `scripts/memory-bench/heldout-v3.json`.
- **The judge and the answerer were the same model.** `mimo-v2.5` answered and judged, so judge
  leniency is unquantified; cross-family judging is plan 202 Task 3. Evidence:
  `docs/_evidence/memory-bench/188.10/README.md`.
- **Retrieval is lexical only, and the candidate pool has a measured ceiling.** 11 of 30 multi-session
  questions have a needed round outside the top-32 candidates. Evidence:
  `docs/_evidence/memory-bench/188.10/ms-diagnostics-x.json`.
- **Temporal reasoning is 12/20.** It improved from 7/20 but remains the weakest scored ability.
  Evidence: `docs/_evidence/memory-bench/188.10/README.md`.
- **About 78% of injected blocks were judged irrelevant** (0.777). The tools compensate; the block
  itself is noisy. Evidence: `docs/_evidence/memory-bench/188.10/README.md`.
- **Growth is measured offline, not as model QA.** The 1,427-exchange, 12-month LongMemEval-M run
  passed the pre-registered month-12/month-1 retrieval criterion, and the separate 100k exchange
  store envelope passed on SQLite and Postgres. Accuracy is lexical retrieval of the expected
  month-1 exchange, not a live model answer. Evidence:
  `docs/_evidence/memory-bench/202/growth.md` and `exchange-scale.md`.
- **F3: foreign-context exposure in the lifecycle suite.** The completed paid arm exposed foreign
  context in 13/24 sessions while labelled cross-project leakage stayed 0. Evidence:
  `docs/_evidence/memory-bench/188.7/findings.json` (F3).
- **F4: fact extraction reliability has no completed paid arm.** The schema/repair fix is
  offline-proven only, and `om+fabric` extraction stopped early. Evidence:
  `docs/_evidence/memory-bench/188.7/findings.json` (F4).
- **F7: the lifecycle safety power target was not reached.** Only one persona completed both arms,
  so no safety or power claim is possible. Evidence:
  `docs/_evidence/memory-bench/188.7/findings.json` (F7).
- **F9: the `om+fabric` arm never completed.** It stopped after two questions, so the combined path
  has no completed paid evidence. Evidence: `docs/_evidence/memory-bench/188.7/findings.json` (F9).
- **The exchange archive gates refuse real history.** The offline audit measured 2.271 refusals per
  1,000 LongMemEval-S exchanges, touching 3 of 500 needed-session questions; adversarial detection
  was 33/34. Evidence: `docs/_evidence/memory-bench/188.11/trust-scan.md`.

### Lessons

A lesson is what the working agent learned: what to do differently, a gotcha, the fix that worked
(plan 209 Task 4). It is a `procedure` or `fact` the agent writes itself with `memory.insert`, tagged
`lesson` and citing at least one `evidence` id. There is no `lesson` kind and no background model call:
the agent already has the context in its turn.

```json
{ "tool": "memory.insert", "input": { "kind": "procedure", "text": "Create the SQLite file's parent dir before running memory suites.", "tags": ["lesson"], "evidence": ["4f2a9c1e0b77"] } }
```

- **Evidence.** 1–8 note ids, usually the exchange of the turn where it happened (with `exchanges: { steps:
  true }` its `## Steps` show the failed command and the fix). Each id must be a note in an active scope that
  stays readable wherever the lesson is read: a project or path lesson may cite project, user or agent notes;
  a user or agent lesson may cite only user or agent notes. Anything else, including another project's
  note, rejects the write with `not_found`. Every writer holds the lesson rule, not only the tool.
- **Lifecycle.** A lesson starts as a `candidate` and verifies by the existing use rule (cited in
  `lifecycle.verifyAfterSessions` sessions without correction). A lesson with no use for
  `lessons.archiveAfterSessions` (20) scope sessions since its last use is archived from default recall
  whatever its strengths, never deleted, and a later citation revives it. A pinned lesson never archives.
- **Nudge** (`lessons: { nudge: true }`, default off, needs the exchange archive). After a turn that carried a
  signal, the next request's tail carries one line:

  ```text
  memory: this turn had a correction; if there is a reusable lesson, record it: memory.insert { kind: "procedure", tags: ["lesson"], evidence: ["<exchange id>"] }
  ```

  Signals, by the consolidation gatherer's patterns over the user turn plus the step trace: a correction
  cue, an explicit "remember", an exchange tagged `outcome:fixed` (needs `exchanges.steps`), or an
  approval denial (`decision.resolved` with `deny`) inside the turn. At most once per
  `lessons.minTurnsBetweenNudges` (5) completed turns per session. The line holds the exchange id and fixed
  text only, never note or turn text; it is never in the prefix and is taken by one request. When the trust
  scan refused that exchange, the cited id is not a note and the insert answers `not_found`.

### Memory directory

> **Experimental.** The memory directory block (`directory`, `memory.view`) is held in the experimental tier by the plan 210 owner decision:
> removing it was not shown harmless and it showed no measured benefit. Its config fields and rendering can change or go in a minor version.

With passive injection off by default, the agent still needs to know what long-term memory holds
before it can decide to recall. The fabric renders one `Long-term memory` prefix block
(`metadata.source: "fabric-directory"`):

```text
project: 9 facts, 2 procedures; topics: deploy (5), billing (3). Recall with memory.recall; read files with memory.read.
user: 3 preferences; topics: tooling (2)
agent: 1 procedure
Files: notes/deploy.md, notes/billing.md, … (+2)
```

With one active scope the block keeps the older single line (`12 facts, 3 procedures, …`); with
more, it renders one line per scope with that scope's counts and topics.

It names counts, never content. Counts and topics cover **active** notes only: inside their
validity window at the time of recompute, with visible consent, not invalidated or superseded, and
not an unverified `status: "candidate"`, so they match what `memory.recall` can return. Topics are
the most-used tags and keywords. Files are the most recently modified files under `tools.root`
(hidden files and the store's SQLite index are skipped; at most 1,000 are scanned, six levels deep), as
paths relative to the root. With the markdown store the walk lists the store's own `notes/` tree, so
`notes/index.md` (the regenerated OKF root index) is named as the browsable entry point. Tags and paths
are redacted. The index sums every active scope and keeps each scope's counts on its own line; a
share grant widens recall, not the index.

`directory.stopWords: true` (default `false`, a tuning field) drops topics made only of stop words
(`i`, `it`, `we`), so the topic line names content words; a phrase with a content word stays. It does
no extra work beyond one term check per topic and changes nothing when unset. It is an opt-in variant
of plan 210 Task 3.1 and is measured once before it can ship.

Three disclosure levels keep the prefix small:

1. the directory block (always in the prefix, capped);
2. `memory.view` with no `path`: the same summary plus the full topic and file lists, 50 per page,
   paged by `offset` (topics cap at 200);
3. `memory.recall` and `memory.read` for content.

`memory.view { path }` still lists a directory under the root. Without a directory (`directory:
false`, or a fabric built without one) a path-less `memory.view` lists the root as before.

**Cache stability.** The prompt's directory is pinned with the core for the session epoch described
above; `memory.view` can still read a fresh, write-keyed directory. Counts and labels in the prefix
stay fixed until session start, compaction, retraction or explicit refresh. A note whose `validTo`
passes between boundaries stays counted until the next epoch. The block is dropped silently when
the fabric holds nothing, or when the store cannot aggregate (`countByKind` / `topTags`).

Cost: no model or embedding call; one `GROUP BY` per aggregate per recompute (a scan in the
in-memory store), plus one bounded directory walk when `tools.root` is set. The block is at most
`maxTokens` (default 200, hard cap 500); the topic and file lists shrink first, then the text is cut.

### Consolidation from sessions

Off by default: `promote` absent or `false` makes no extractor call. Opt in with
`promote: { minScore: 0.5, minTurnsBetween: 8 }` (see [triggers](#consolidation-triggers-cost-and-status)).
A pass gathers session material (explicit statements, corrections, decisions, high-value
observations, WM items), makes **one** extractor call (plus at most one shape-only repair), and
writes only what survives the gate.
There is no per-item promotion: a WM item is evidence, not a write. `remember({ reflectionId })` names a WM item id since plan 218 Task 2; plan 219 retires that path.

One write path serves tools and consolidation. Each accepted note goes through `remember` in its
target scope, so write-time consolidation
and the never-demote-a-verified-note rule are the same ones an agent write gets. Each write carries:

- `status: "candidate"` — stored, recallable by tool, never injected passively until used or confirmed;
- `generated: { by: "promotion", at, session }` and `sourceEntryIds` — the evidence entries it rests on;
- `promotion: { score, signals, pass }` — the gate's decision, so a write is explainable afterwards.

**Narrowing by contradiction.** When an accepted note contradicts a note in a wider scope, the
candidate is written as an exception in the narrower scope: the same `key`, plus `overrides` naming
the wider note. Plan 188.2's narrowest-scope-wins shadowing then hides the wider note **in that
project only**; `contradictedIn` on the wider note records the project id (deduplicated, ids only,
never text). An exception never targets `user` or `agent` scope from a project session. A same-scope
contradiction keeps both notes; retire one with an explicit `supersedes`.

**Reconsolidation.** A note marked `reconsolidate: true` (a verified note edited after promotion, or a
correction) is shown to the next pass as an existing note, together with the new evidence. A returned
note with the same `key`, kind and scope updates it in place — same id, correction lineage
(`supersedes`, `sourceEntryIds`) kept. When the extractor returns nothing for that key the note is
retired (`validTo` set). A flagged or archived note is never rewritten.

**Candidates are not trusted yet.** A candidate is never injected passively and is not counted in the
memory directory. `memory.recall` returns it marked `(candidate)`, after verified hits of equal score.
It becomes `verified` when any of these happens:

- it is cited (`[<id>]`) in assistant output across `lifecycle.verifyAfterSessions` (default 2)
  distinct sessions, with no harmful evidence against it;
- the agent writes it again with `memory.insert` and a `kind`, or confirms it with `memory.replace`;
- the host calls `fabric.verify(id)`.

**Archive** (`lifecycle.archive`, plan 188.4 Task 4). A note — candidate or verified — is archived by
`fabric.maintain()` only when both strengths are low (`R < retrievalBelow`, `S < storageBelow`), it is
past `graceSessions` scope sessions since it was written, it is not pinned, and the store does not hold
it. Calendar days play no part. Archiving sets `status: "archived"` and `archivedAt`, remembers the
status to restore, and leaves `validTo` unset: supersession and expiry are the only paths that set it,
so historical time-scoped recall (`asOf` before `archivedAt`) still retrieves the note, while injection
and the directory exclude it via `isActiveNote`.

**Archive search and revival.** `memory.recall { includeArchived: true }` searches active and archived
notes, so an archived procedure or episode takes one call:
`{ kinds: ["all"], includeArchived: true }` (the default kinds would filter it out). Without the flag,
archived notes are searched only when the best active hit is weak (coverage below 0.34); at most three
are appended after the active hits and marked `[archived]`. Passive injection never searches archives
and never shows one. Citing an id that archive search showed revives the note — its previous status returns, the citation counts as a use (resetting `R`), the note's
`useSessions` grows `S`, and the markdown audit line reads `revived`.

**Pinning.** `pinned: true` on the note (frontmatter, `fabric.pin(id)`, or `memory.replace { id, pin }`)
exempts it from archiving and capacity eviction; `pin(id, false)` unpins.

**Capacity and merging** (`lifecycle.capacity`, `lifecycle.merge`, plan 188.4 Task 5).
`fabric.maintain()` measures each active scope against its budget — notes and estimated tokens, one
`get` batch for the text — and only when a scope is over budget does it act, in this order,
stopping as soon as the scope is back inside:

1. **Duplicate merge**, deterministic and without a model: notes of one kind in one scope with an
   equal `key`, or with term-set Dice at or above `merge.duplicateDice` (0.8) and the same globs.
   The survivor is the note with the higher `S`; it keeps its id, text, `key`, and status, and absorbs
   the others' keywords, tags, links, evidence, promotion stamp, and lifecycle counters. The others
   are archived with `mergedInto` naming the survivor and the audit verb `merged`. Episodes are never
   duplicate-merged: an episode records what happened once. (Episode-cluster merging was removed in 0.13.0.)
2. **Eviction**: the lowest `S·exp(R)` notes first — the ones the ranking already valued least —
   archived with the verb `evicted`. A pinned note and a note at or above
   `archive.storageBelow` are never evicted: budget pressure is not a reason to shed knowledge that
   was earned.

**The exchange tier is separate.** Exchange notes are excluded from the scope's notes/tokens budget
and measured only against `lifecycle.exchangeCapacity.hotTokens` (default 200,000). Over that size,
the lowest-value unpinned exchanges are demoted with the audit verb `demoted`; demotion only changes
status to `archived`, so the verbatim text remains in the searchable archive. This keeps a lifetime
transcript from evicting learned facts or growing an unbounded hot set. The 12-month growth run over
1,427 LongMemEval-M exchanges passed the month-12/month-1 criterion in both the shipped archive path
and a 20k-token tier stress arm (`docs/_evidence/memory-bench/202/growth.md`).

Merging is **O(n log n)** per scope through key grouping and lexical candidates, with no model call.
A merge never crosses a scope: the pass runs per resource, and a user note can never fold into
a project note.

What is left over is a scope whose protected notes alone exceed the budget. Then maintenance archives
nothing more, reports the scope in `maintain()['overBudget']`, and the package notes one warning with
the scope and its counts:

```ts
await fabric.maintain();
// { archived: 4, merged: 3, evicted: 6, overBudget: [] }
```

The pass runs per bound scope: `fabric.maintain({ scope })` archives and enforces capacity for one resource, and
`consolidate()` calls that scoped form once at the end of each pass, for the session's project scope. Knowledge
does not move between scopes on its own: a write names its scope, and the model tools cannot write `agent` (plan 210
Task 7 removed scope widening and narrowing).

**Nightly recipe.** Run the full pass once a day with a headless command target — a package command,
not an agent turn:

```ts
import { createScheduler } from "@arnilo/prism-hosts/headless";

const scheduler = createScheduler({
  checkpoints,
  ownership: { tenantId: "ops" }, // must match the agent that runs the package
  targets: { maintain: { kind: "command", agent, command: "memory:maintain", input: {} } },
});
await scheduler.schedule({ id: "memory-maintain", target: "maintain", cron: "0 3 * * *", tz: "UTC" });
scheduler.start();
// Each firing: { firingId, status, sessionId } — the command returns the counts, nothing is persisted from it.
```

The pass makes no model call, so the firing costs one claim write, one completion write, and the scan work.
`memory:maintain` runs archive and capacity for every bound scope; `memory:maintain { "scope": "projects/<slug>--<id8>" }` (as the target's
`input`) runs it for that resource only. A host that schedules with `Bun.cron` or systemd instead can call the same command directly
with `agent.commands.run("memory:maintain", {}, { session })`.

Superseded WM items retire the notes promoted from them with supersedes semantics (`validTo` set, correction lineage
kept, logged `superseded-by-om`). Verified notes edited after promotion (carrying correction lineage)
are not retired; they are marked `reconsolidate: true` and counted in `memory:status`, then
re-extracted by the next consolidation pass.

**One lifecycle for every layer** (`src/ltm/lifecycle/`). Status and every counter live on the note:

| field | meaning |
| --- | --- |
| `uses` | the last 32 uses, each `{ s, at }`: the scope-session ordinal and the wall time |
| `useSessions` | distinct sessions that used the note; a candidate verifies at `verifyAfterSessions` |
| `retrievals` | returns from recall and injection, diagnostics only — never status or strength |
| `helpful` | outcome-tagged turns that cited the note |
| `harmful` | user corrections that cited the note; harmful evidence blocks verification |
| `lastSession` | the last session that counted a use, so one session never counts twice |
| `created` | the scope-session ordinal the note was written in; absent counts as 0 (before the clock) |
| `archivedAt`, `archivedFrom` | when it was archived, and the status a citation restores |
| `pinned` | never archived, never evicted |

An outcome tag in the same run as a citation counts helpful evidence. A user correction whose `[<id>]`
citation names the note counts harmful evidence, sets `reconsolidate: true`, and returns a verified
note to `candidate` so the next consolidation pass can re-extract it. A plain note with no status
(written before the lifecycle) is `verified`.

**Two strengths** (`src/ltm/lifecycle/strength.ts`). Storage strength S accumulates evidence of value —
`a·explicit + b·log(1+useSessions) + c·helpful − d·harmful + e·outcome`, clamped at 0 — and only
harmful evidence lowers it. Retrieval strength R is ACT-R base-level activation,
`ln Σ (clock − s + 1)^(−d)` over the use log, where `clock` is the scope-session ordinal. Time is
therefore sessions the scope was worked in, not calendar days: a project left alone keeps its R while
other projects run. Recall adds `w_R·σ(R) + w_S·σ(S)` after fusion and the scope prior, bounded by the
two weights so relevance keeps the final word. `noteImportance(S)` is written as the note's core
`importance`, so a host that configures core scoring gets evidence instead of a constant 0.5. The same
two strengths decide the archive: `shouldArchive` needs both below the thresholds, which is why a
rarely used but explicitly stated note is never archived.

The `memory:status` command reports candidate, verified, and archived counts, the trust-scan
rejections, and the last consolidation pass's counts and rejection reasons. With the team store
open it adds that store's counts and how many of its notes the load scan quarantined.

**Inspecting one note.** `memory:lifecycle` explains the rules per note instead of counting them:
one line each with S, R, the use log size, and the gate that refused — `archive=no(retrieval,grace)`,
`widen=no(harmful,contradicted)`. It reads the same predicates `maintain()` applies
(`shouldArchive`, `storageStrength`, `retrievalStrength`), so the view cannot drift from the pass.
Arguments: `{ id }` (12-hex note id), `{ key }` (subject), `includeArchived` (default `false`; archived
notes are hidden), and `limit` (default 20, max 100 — the printed rows, not the count). Notes under
legal hold never appear: the store's scan already excludes them. The widening verdict is note-level
only; replication across projects is what `memory:maintain` decides, so `widen=note-eligible` means
"nothing about this note blocks it". `memory:maintain` runs one
maintenance pass (archive, capacity, widening, narrowing) and reports its counts; the `memory:reindex` command re-reads the
markdown store's files into its derived index and reports `indexed`, `removed`, and `malformed`
counts (`{ full: true }` re-reads every file). Run `examples/long-term-memory.ts` for a session that
consolidates a note with `memory:consolidate` and a second process that recalls it from the markdown
store.

#### OM as T0: measured promotion result

Observational memory is the T0 tier: its ledger feeds the ordinary `promote` pass above; there is no
separate `promote.observational` flag. Plan 202 Task 16 measured that path on a seven-seed offline
lifecycle suite (24 sessions per seed, zero model calls). With promotion off → on, task success was
**0.375 → 0.393** for fabric alone and **0.732 → 0.732** for OM+fabric. Promotion wrote **0.125** and
**0.25** notes per session respectively; **none** of the promoted candidates was recalled and cited
in a later session in that suite, so the use-verified share was **0**. The result does not justify
enabling promotion in the reference host, which keeps it off. A six-run one-question live smoke on two
free models completed every `om`, `om+fabric`, and `fabric-x-tools` arm with zero worker errors; that
is a completion check, not a quality comparison. Evidence:
`docs/_evidence/memory-bench/202/observational/role.{json,md}` and `arms.{json,md}`.

A failed OM worker pass is background-only by contract: it fails `memory.session.observe`, leaves the ledger
unchanged, and does not fail the run. The benchmark now records non-budget worker failures and
continues instead of aborting the arm; a token-ceiling cause still ends the arm as a budget result.

#### Consolidation: triggers, cost and status

Three triggers, no timers:

- **`turn.completed`** starts a `fabric.consolidate` background task only when at least
  `promote.minTurnsBetween` turns (default 8) have passed since the last pass **and** observational
  memory recorded a new WM item, a WM supersession, or a task-state decision after the cursor. A turn
  with no new OM material starts no task and makes no model call.
- **`memory:consolidate`** and **`fabric.consolidate(session, { signal })`** run a pass now, regardless
  of `minTurnsBetween`. Run the command before `session.close()`:

  ```ts
  await agent.commands.run("memory:consolidate", {}, { session });
  await session.close();
  ```

- **`session.opened` with `restored: true`** runs one catch-up pass when material after the cursor
  exists, covering a process that closed before its final pass.

One pass per session runs at a time (an in-process lease): a trigger during a running pass is dropped,
not queued. The cursor advances to the pass's last covered entry only after every write succeeded, so
a failed pass leaves the material for the next trigger and fails only its background task
(`background.failed`). `promote: false` (the default) makes no model call at all.

`memory:status` reports the last pass from session state alongside the note census: candidates,
accepted, written, updated, exceptions, retired, model calls, and rejections by reason (`score`,
`ephemeral`, `derivable`, `trust`, `secret`), and — on a failed pass — `failures` by reason code with
`outputLimited` for calls that hit the output limit. `memory:consolidate` returns the same counts.

#### OKF export and import

Any store can be exported to the markdown layout and imported back, which makes SQLite and Postgres
deployments inspectable. `exportMemoryOkf(memory, { dir, stores })` writes the thread's notes,
`.state.json` (tombstones, legal holds, generation), `index.md`, and `log.md`; embeddings are never
written, and the derived index files are removed so the bundle is plain files. `importMemoryOkf(memory,
{ dir, stores, mode })` reads a bundle into any store. `merge` adds and overwrites by id; `replace` also
removes the target's other notes. Imported notes are stamped `generated.by: import` and scanned: a hit is
imported as a `candidate` with its flag, so it is never passively injected. Pass `embedder` to re-embed
(hybrid targets, one batch per page); a lexical target makes no embedding call. A legal hold on the target
is never overwritten, removed, or cleared, and holds in the bundle are added to the target. `stores` is the
pair you gave `createMemory`, because `Memory` does not expose its stores. Source-access grants and share
grants are not exported.

The `memory:export { dir }` and `memory:import { dir, mode }` commands resolve `dir` inside `tools.root`,
refuse without it, and refuse a path that escapes it or overlaps the live `notes` directory.

#### Notes written by a newer version

The team store is shared across agents and versions, so the reader never destroys what it cannot understand.
A note whose `fabric.v` is above 1, or whose `fabric` object carries a field this version refuses, is
**unreadable**: it is excluded from recall, injection, the directory, the core block and `memory.read`
(`not_found`), so a crafted future-version note cannot reach the model or skip the trust scan by being
unparseable, and it is never rewritten, renamed, moved, archived or evicted. `memory:export` and `memory:import`
carry its file byte for byte, `memory:import --mode replace` does not delete it, and `memory.replace` refuses it
with reason `unreadable`. `memory.forget` by id still deletes it, because that is an explicit request.
`memory:reindex` and `memory:status` report `unreadable` and `unreadableReasons` (`version>1`, `invalid-fabric`);
`memory:status` counts every scope of the markdown store.

A readable (`v: 1`) note keeps unknown keys under `fabric` and unknown top-level frontmatter keys through a recall
touch, `memory.replace`, `memory:maintain` and `memory:import`. Only a store that writes OKF files
(`tools.root`) can hold a top-level frontmatter key; on SQLite or Postgres the unknown `fabric` keys are kept in
the row.

### The memory.ltm service

The ontology left memory (plan 216 Task 3, owner decision 2026-11-08): concepts, claims, subject bindings and ingested
sources live in [`@arnilo/prism-knowledge/wiki`](../../knowledge/wiki/README.md)'s own store. This package keeps no `concept` kind (a
concept note an older version stored is unreadable here, reason `retired-concept`), never binds a note to a subject
(a `subject` the writer gives is kept as a topic key), and runs no deletion cascade of its own.

With `semantic` on, `setup` provides one **read-only** port, `memory.ltm` (`createMemoryLtmPort`). A consumer outside
memory reads it at call time (`prism.services.consume("memory.ltm")`); it has no write member.

| Member | What it returns |
| --- | --- |
| `scopes()` | readable scope levels, narrowest first (`team` when the team store is on) |
| `epoch()` | a counter every retraction bumps (forget, revoke, delete, demotion): re-read the deletion feed when it moves |
| `read(scope, ids)` | up to 32 notes through the same scope, consent and invalidation filters as `memory.read`; text capped to the entry limit |
| `scanMetadata(scope, { cursor, limit })` | a page (at most 500) of evidence-note metadata, never text: id, kind, status, flagged, topic key, keywords, links, co-reads, use count |
| `activity(scope, { cursor, limit })` | a page of `use` and `co-read` events: ids and ordinals only |
| `deletions(scope, { since })` | invalidation records newer than `since` (forget, revoke, legal hold, correction): `id`, `reason`, `at` only, oldest first; pass `cursor` back as `since` |

Hard deletes (retention, capacity eviction, import replace) leave no invalidation record, so a consumer confirms what
it cites with `read`; the wiki does that once when it opens. `episode` rows (a reserved kind) are never shown.

### Tools

| Tool | Effects | Needs |
| --- | --- | --- |
| `memory.view` | `read` | `tools.root` for paths; the directory needs none |
| `memory.read` | `read` | `tools.root` for paths; a note id needs none |
| `memory.insert` | `edit` | file path, or fact/preference/procedure/decision kind |
| `memory.replace` | `edit` | file path, or note id |
| `memory.recall` | `read` | — |
| `memory.forget` | `write` | — |

These six names and their effects are **stable at API level 1**: a host may reference them in approval and policy
rules. Their descriptions may change in a minor version; the names and effects do not (see `## Compatibility`, the contract from graduation).

`memory.read` accepts exactly one of `path`, `id`, `ids` (1–8), `around`, or `session`. A note read returns each note in
full with its header — id, scope, kind, date, and the note's path — through the same scope, consent,
invalidation and redaction filters as recall; an unknown, foreign-scope, or revoked id is
`not_found` for that id alone, and the call reads at most 8 notes. A file read stays jailed and
byte-capped.

> **Experimental.** Agentic lexical navigation (`memory.read` with `around` or `session`) is held in the experimental tier
> by the plan 210 owner decision: removing it was not shown harmless and it showed no measured benefit. It can change or go in a minor version.

`memory.read({ around: "<exchange-id>" })` opens that exchange and up to two readable
neighbours on each side in the same archive session. `memory.read({ session: "<session-id>",
page: 0 })` reads eight exchanges at a time in reference-time order; pages start at zero.
Read and recall results expose the archive session id. Navigation uses the SQLite session/time
index (also used by the markdown store); custom stores without `listBySession` use a metadata
scan and emit a status warning. Stores without either capability return `not_found`.
Older notes without archive `session` metadata remain recallable and readable by id;
navigation covers newly archived notes. No existing archive is rewritten.

> **Experimental.** Read-time state grouping is held in the experimental tier by the plan 210 owner decision: removing it was not
> shown harmless and it showed no measured benefit. It can change or go in a minor version.

Recall groups same-subject hits at read time and orders each group newest-first. Facts and other
keyed notes group by `key`; exchanges group when their `keywords` overlap at or above
the provisional Dice floor (value-like numbers are ignored). The exchange archive no longer writes keywords
(plan 210 Task 7), so exchange grouping now fires only for exchanges that carry
keywords, for example ones imported or written through `remember`. An explicit `supersedes` edge also
joins a group. Every earlier member carries `superseded by <id> on <date>?`; the question mark is
the point: this is a hint, not a deletion or an invalidation, and the older note stays readable.
Passive delivery shows the same marker. Ordering is stable and costs no model call.

`recall: { expansion: true }` (default `false`, a tuning field; plan 210 Task 3.1) expands the lexical
query with the informal and formal forms of its words from a small fixed English table in
`lexical-expansion.ts` (`girlfriend`/`gf`, `mother`/`mom`, `photo`/`pic`, `university`/`uni`, and a few
dozen more), so a question that says "girlfriend" reaches a note that says "gf". It makes no model or
embedding call; the original query is kept whole and only missing alternates are appended. Because
alternates add query terms, the relevance floor is scaled by the share of terms that were the caller's
own, so the same threshold still means "how much of the question". Each hit's `coverage` is reported on
that scale too (matched caller terms, an alternate counting for its word), so a match found only through
an alternate clears `memory.recall`'s no-match floor instead of abstaining. A query with no table term is
unchanged, and so is recall when the field is unset.

`recall: { gather: true }` (default `false`, a tuning field; plan 210 Task 3.1) adds a boolean `gather` to
the `memory.recall` tool for list and multi-hop questions ("the names of his dogs", "every place he has
been"). A call with `gather: true` returns the whole matching history in one call, up to the 32-hit
recall window, oldest first, with a snippet budget of 3,000 tokens instead of 1,200; an explicit `topK`
or `budget` still wins. It is the same tool, scope, eligibility and trust path as a normal
recall (a forgotten, archived-away or other-scope note is still excluded), except that a quarantined
(flagged) note is left out instead of being shown with its flag as a normal page shows it. Cost: a gather
call can render up to 3,000 tokens of snippet lines instead of 1,200, and only when the agent asks for
it. With the field unset the tool schema has no `gather` property and results are byte-identical.

#### Decision models

The opt-in `decisions` field binds one [decision model](../../../docs/decisions.md) through
`prism.models.decisions(model)`. Absent or `false`, no decision call is made and every heuristic and
generative path behaves as before. The model must declare the `decisions` capability. Each point
runs as one batched call (at most 64 questions), with a calibrated threshold and an abstain band;
inside the band, or on any `DecisionsError`/timeout, the incumbent path decides and the turn
continues. A decision never deletes, archives or rewrites a note.

| Point | What it gates | Incumbent inside the band |
| --- | --- | --- |
| P3 relevance | passive-injection candidates (top 32) | relevance ranking |
| P4 needed | skips passive injection when memory is clearly not needed | inject anyway |
| P5 sufficient | adds an abstention when shown recall evidence is clearly not enough | the confidence floor |
| P7 instruction-like | coding-preset capture: a clear instruction attempt adds a refusal | the trust scan |

P3, P4 and P7 share one `evaluateTurn` request when they run for the same persisted user turn; the no-candidate P7 result is reused by capture. P7 is additive only: it can refuse a capture, never
remove a refusal from the trust scan. Only already-scoped text is sent; a hosted model receives it
off-machine. The documented default suggestion is local `liquid-local/d1-3B`. At two requests per
turn and roughly 1,000 input tokens per request, hosted `liquid/d1` input costs about **$0.04 per
1,000 turns** at $0.02/Mtok; local inference costs $0 plus hardware (measured p50 330–744 ms per
request). The checked-in `scripts/fixtures/decision-bench-memory.jsonl` has 100 labelled items per
point with reversed-choice repeats; run `bun scripts/decision-bench.mjs --memory` on the authorized
development screen. Thresholds and bands live in `src/ltm/decisions.ts` (tuning tier).

> **Experimental.** Multi-query recall is held in the experimental tier by the plan 210 owner decision: removing it was not shown
> harmless and it showed no measured benefit. It can change or go in a minor version. `memory.recall` accepts `queries`, up to
> four phrasings fused by reciprocal rank into one ranked list.

> **Experimental.** `unmatchedTerms` in recall results is held in the experimental tier for the same reason (it shares the
> multi-query arm). `memory.recall` returns `unmatchedTerms`, the query terms absent from the returned notes and their indexed
> keys; they are not proof that a term is absent from the whole archive.

Both make no model or embedding call. For aggregation questions, list the instances and their ids before counting or totalling,
and use two or three differently worded queries.

`memory.insert` accepts exactly one of `path` or `kind: "fact" | "preference" | "procedure" | "decision"`.
Typed notes accept `supersedes`, `evidence`, `rationale` (decision only), `tRef`, `validFrom`, `validTo`, `tags`,
`keywords`, `scope`, `appliesTo`, and `key`. `evidence` is 1–8 note ids stored as links with relation
`evidence`; an id that is not readable wherever the new note is read returns `not_found` and writes
nothing (see `## Lessons`). A note tagged `lesson` without evidence, or of a kind other than procedure
or fact, returns `lesson_requires_evidence`. A decision inserted by the agent is always `proposed`
and a lifecycle candidate; it needs the user's confirmation or two sessions of use to become active. The scope rule in the description is precision-first: user-wide preferences
→ `user`; anything learned in this repository → `project`; only a lesson proven across projects →
`agent`; `path` with `appliesTo` when the note holds for one subtree; when unsure, the narrower
scope.
`memory.replace { old, new, path | id }` requires exactly one target and one
occurrence (including overlapping matches); missing/duplicate text returns `not_found`/`ambiguous`.
Empty `new` deletes text. File edits stay jailed and refresh the file note; empty files
are indexed by path. Truncated files cannot be edited. Note edits preserve ids and record
correction lineage. Typed writes and note edits scan the resulting content for prompt injection,
exfiltration, and invisible Unicode; refusal returns `refused: <class>` without writing.
Typed writes and note edits make no model or embedding calls.

All tools are hidden when the session's fabric is off. With `semantic: false`, file-path
inserts and replacements remain available and indexed operations fail closed with `indexed_notes_unavailable`.

### Selective injection and recall

Passive semantic injection is **off by default** (`inject: false`). Idle/model turns make no
semantic lexical query; `memory.recall` retrieves detail when the agent asks.
This default has no measured benchmark gain yet: Task 14 must supply paired benchmark evidence
before changing it.

Opt in with `inject: { query: "task" }`; the defaults are `minSimilarity: 0.2`, `minScore: 0.2`,
`fullTextScore: 0.35`, `topK: 12` and `budgetTokens: 4000`, so an opted-in turn adds **about 4,000
tokens** of memory at most (measured mean 3,739 in the ceiling grid and 2,865 in the shipped-query
delivery diagnostic over the 140 development questions). Delivery fills by rank with **whole** notes:
each note renders in full while it fits the remaining budget, up to `topK`, and a later note that
does not fit whole is **skipped, not truncated** — a shorter note after it may still fit. The best
matching note is always shown: when it alone exceeds the budget it renders as an excerpt centred on
the densest run of matched query terms, of the whole budget, ending
`(excerpt; memory.read <id> for the full note)`. Shown notes are delivered in **time order**
(`tRef` else `ingestedAt`, ties by rank) with their date header, so a knowledge update is read after
the value it replaces; ranking still decides *which* notes are selected. Rendering changes how much
of a note is shown, not which notes are ranked or filtered, and adds no query, write, or model call;
injected tokens stay within `budgetTokens` with no exception.

**Confidence gates delivery.** `minScore` drops a hit below the floor; if every hit is dropped the
block is only `Showing 0 of M matching notes.` plus the existing directory prefix, so the agent knows
memory was searched and chose not to paste low-confidence text. Between `minScore` and
`fullTextScore`, an exchange renders as a **pointer card** instead of its text: id, event date, the
user's first 120 characters, and the matched query terms, for example
`- [e81] 2026-04-02 "I picked up the new bike…" · bike, picked`. The agent reads the note by id for
the full exchange. A hit at or above `fullTextScore` renders as before, whole or excerpted. Pointer
cards never show the assistant reply and are always shorter than the note text; neither floor is a
model call, and both are tuning-tier fields under `inject`. The 0.2/0.35 starting values remain to be
calibrated on the Task 8 development screen (plan 202, then Plan 210).

`inject: { cardExcerpt: "query" }` (default `"head"`, a tuning field; plan 210 Task 3.1) keeps the card's
120-character width but centres it on the matched query terms across **both** halves of the exchange,
so a detail past the head of the message, or in the assistant's reply, can be seen without reading the
note. Unset, the card is byte-identical. It adds no model call and no tokens beyond the same width;
the matched-terms tail is unchanged.

**Weak tool-callers get text after two cued turns.** Adaptive delivery is on for the package and
needs no config. It counts user turns that ask for a selection, list, count, comparison, or time
ordering (`all`, `count`, `how many`, `latest`, `when`, …). After **two** such turns in a session with
no `memory.*` tool call, the next passive block switches from pointer cards to full notes (still
inside the same `budgetTokens`, still gates below `minScore`); on the second cued turn the switch is
immediate. Any `memory.*` call — recall, read, remember, forget — resets the counter and the next turn
returns to pointer cards. The state is per session (`fabric.delivery`), never shared across
principals, and makes no model, embedding, or store query. `memory:status` reports it as
`delivery: "pointers" | "excerpts"` plus a `reason`, for example
`Delivery: excerpts (no memory tool use after 2 cued turns).` The model catalog has no tool-reliability
field, so the start mode is always pointers (R10; plan 202 Task 10).

**When the block is a selection, it says so.** If fewer notes are shown than were eligible after the
similarity floor and confidence gate (before `topK` or the budget cut them), the block ends with one line:
`Showing N of M matching notes. To list, count or compare across past conversations, call
memory.recall with several phrasings (queries) and memory.read the ids you need.` It names the two
read tools instead of asking the host, because per-run tool availability is not visible to the
package; a host that hides them still reads a coherent line. It carries counts only, never note
text, and it is absent when everything eligible was shown or when `inject` is off. The line counts
inside `budgetTokens` (about 43 tokens by the block's own `chars / 4` estimate): it takes the
space of the last delivered note rather than overspending, and is dropped only if even one note
leaves no room. The cue is the reason the block can be trusted as complete-or-labelled: an agent
that sees it searches instead of concluding that memory holds no more.

Every injected block — the
directory, the rules, and the semantic tail — is marked
`untrusted`, `inert`, and `injectionCapable`, so remembered text is never treated as host
instructions.
The `minSimilarity` floor (default `0.2`) is applied to query-term coverage (calibrated in plan 188.1
Task 2; a tuning default). Empty results inject nothing; the recall tool says `no matching memory for: <terms>; scopes: <levels>`.

`memory.recall` is the agent's detail channel: one call returns a compact **grouped summary** and at
most **1,200 rendered tokens** in total — `budget` counts the summary, then each snippet's header,
path and matched terms. Each snippet is the densest window of matched query terms in its note,
capped at 600 characters. The summary is two lines: total matches, distinct sessions, date span,
how many are shown, how many more are not, and the next page — for example
`7 matches in 5 sessions (2026-01-04…2026-06-19); showing 4; 3 more not shown; page with
{ query: "...", page: 2 }.`, followed by each session's count and date span (`s1×2 (…)`). It is
counts only, never note text, and is capped under 200 rendered tokens.

`topK` is the page size (default 5); `page` is zero-based over the same 32-hit ranked window, so
`{ query, topK: 4, page: 1 }` returns hits 5–8. The summary counts that window, so a broad query
can say `32` rather than the true archive total; page or narrow the query when it does. Every line
carries the note's relative path; `memory.read <id>` returns the note whole. Without `kinds` the
tool searches **every stored kind**, so a procedure or an exchange from stored history answers without a second
call. It makes exactly one
recall query — there is no kind-discovery follow-up. An empty or weak-only result is an explicit
abstention with no hits: `no matching memory for: <terms>; scopes: <active levels>`, so the agent
can say what it searched instead of guessing.

Fabric recall uses the store's lexical leg, ranked before optional recency/importance scoring. Each scope is queried separately and the union is ranked as described under
[Recall across scopes](#recall-across-scopes); injected lines name the level (`[id] user preference
2026-09-30 …`). Passive kinds default to `fact`, `preference`, and `file`; `inject.kinds` or
recall's `kinds` can name others (`procedure` and `decision` are opt-in), and `kinds: ["all"]` means
every kind (`episode`, `fact`, `preference`, `procedure`, `decision`, `file`, `exchange`). The tool's own default is
wider — every kind — so stored history answers there without changing what an opted-in turn injects.
Validity and consent apply to both query hits and one-hop links.

Link expansion fetches up to `topK` targets in at most one scoped `Memory.get` batch, including notes
outside the query candidates.
Notes embed content plus keywords, tags, and context; stored content stays unchanged, including
on corrections and rebuilds.

The task query joins the latest user message, OM current task, and the latest todo plan, each
bounded to 2,000 characters. Persisted todo metadata supplies the plan after context folding.
`query: "user"` uses only user text. Direct `createLongTermMemory` callers can also set `inject` and register its `registerContextBuild` contribution. ISO dates, `last week`, and named months resolve against the
persisted user message timestamp into UTC validity/reference-time filters, and are removed from
the query text. Notes without `tRef` use their ingestion date for the reference-time window.

Recall is cached by session and persisted user-entry id, including empty results. Tool rounds
reuse identical tail bytes; a new user entry or steer recomputes them. Without a persisted user
entry passive recall is skipped. Notes already represented by OM item ids, verbatim visible
source messages, or a visible file read are dropped before filling `topK`. The budget includes
rendered lines and citation guidance. Lines include `[id]`, kind, ingestion date, and optional
`tRef`; the header asks the model to cite used ids (`Cite [id] for notes you use.`). Recalled and injected
note ids join a shared citation tracker; only cited ids (`[id]` in assistant text) are touched and
recorded for candidate use counting on `turn.completed` (invented ids never verify notes). Verification
counts distinct sessions (`session.id`).

The package declares the `background` capability for citation touches; without injection, it schedules no citation work.

The semantic block sits in the tail after the complete transcript, with `fabric-semantic` source and item-id accounting metadata. It leaves the
prefix stable. Opt-in injection adds one lexical query per
user turn, plus at most one link lookup, with no added model call.

### Recall scoring

`memory.recall` blends similarity with recency and importance when `RecallScoringOptions` sets a weight.
It fetches `topK × 4` candidates (capped at the hard top-K limit), then re-ranks them by
`similarity·similarityWeight + recency·recencyWeight + importance·importanceWeight` and exposes the
`similarity`, `recency`, and `importance` components on each hit. The similarity
component is query-term coverage.

- `recencyWeight` and `importanceWeight` are finite numbers in `[0,1]`; the weights are sum-normalized
  and similarity keeps the remainder, so a pair that sums above 1 normalizes down (similarity 0).
- `halfLifeMs` is mandatory (positive, finite) once `recencyWeight > 0`. Recency decays as
  `2^(-age/halfLifeMs)` and stays neutral for a missing or ill-dated timestamp.
  `recencyBasis` defaults to `"accessed"` (`lastAccessedAt`, falling back to `createdAt`);
  choose `"created"` for creation-based decay.
- Recall never writes access timestamps. `memory.touch(ids)` changes only `lastAccessedAt`
  with one batched upsert. Call it for explicit recall or cited ids only with access-based
  recency, at most once per recall and once per turn with citations. Passive injection must
  not reinforce irrelevant hits by repeatedly refreshing them.
- `importanceFrom` is a write-time hook: it receives the redacted reflection and its result is clamped
  to `[0,1]`. An explicit `entry.importance` wins over the hook. A fabric note with neither gets its
  storage strength S normalised to `[0,1)` (`noteImportance`), so importance means evidence rather
  than the neutral `0.5` a missing value falls back to in core (D14). Importance is never
  LLM-derived in the write path.
- Leaving both weights unset disables scoring, so recall stays unblended and ordered exactly as the
  store returned it.

### Migration from 0.12

- `@arnilo/prism-memory/fabric` → `@arnilo/prism-memory-system` (`ltm`; it was `@arnilo/prism-memory-fabric` until plan 216 Task 5). The 0.12 `scoped` policy layer is removed (plan 210 Task 7): `docs/migrate-to-0.13.md`.
- `createMemory` and `runMemoryConformance` moved here from `@arnilo/prism-memory`. `createMemoryWorkingStore`
  moved here too and was removed in 0.13.0 with long-term working memory (plan 216 Task 7).
- `fabric.attach(session)` is gone. Register the package and use the `memory` command; the tools
  are gated by `prism.state.session`.
- Long-term working memory is removed (plan 216 Task 7; the name belongs to the WM component): `kind: "working"`,
  labeled blocks and the `block` target of `memory.insert` / `memory.replace` / `memory.forget`, the `fabric-working`
  tail block, `workingMemoryTemplate`, `limits.maxWorkingMemoryBytes`, `Memory.getWorking` / `updateWorking` /
  `deleteWorking` / `renderWorking` / `createWorkingMemoryProcessor`, and `createMemoryWorkingStore`.
  `remember({ kind: "working" })` fails with `working_memory_retired`, and a markdown store that still holds a
  `working/` note fails to open with the same code and an export hint. An SQL `working_memory` table is left in
  place and never read.
- The episode view (`remember({ kind: "episode", id })` over an observational-memory id) and episode merging
  (`lifecycle.merge.episodes`) are removed. The `episode` kind stays reserved for the stored episode (plan 219);
  writing it fails with `episode_kind_not_available`. `fabric.maintain()` no longer reports `episodesMerged`.

## Compatibility (the contract from graduation)

> This is the contract the package will keep once it graduates from the experimental line. Until then it is a statement of
> intent, not a promise. From graduation it sits under the kernel's
> [compatibility promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md).

At API level 1 a host can rely on the export names and signatures in [Stable exports](#stable-exports), the command
and tool names below, the ledger and state record names, the long-term memory note files and preset contracts, and the `contract` config fields, for the whole `0.13.x` line
and every later minor version (the same promise plan 185 Task 5 makes for the kernel).

### Stable

- **Exports.** The names in [Stable exports](#stable-exports) and their signatures. `src/session/__tests__/root-exports.test.ts`
  and `src/ltm/__tests__/root-exports.test.ts` freeze the barrel.
- **Session commands and tools.** `memory:session`, `memory:session:model`, `memory:session:status` and `memory:session:view`, with their argument shapes, and the `recall`
  tool (its name is the package option, default `recall`). A host may name them in approval and policy rules. Their
  descriptions may change; the names do not.
- **Session records.** The ledger record names (`OBSERVATIONS_RECORDED`, `OBSERVATIONS_REPEATED`, `REFLECTIONS_RECORDED`,
  `TASK_STATE_RECORDED`, `BOUNDARY_RECORDED`, `OBSERVATIONS_TOMBSTONED`), and
  the ledger and state formats: a record this version cannot validate is skipped, never rewritten or deleted.
- **LTM tools.** The six names in [Tools](#tools) with their `effects`; a host may name them in approval and policy rules.
  `memory.view` and `memory.read` stay `read`, `memory.insert` and `memory.replace` stay `edit`, `memory.recall`
  stays `read`, and `memory.forget` stays `write`. Tool descriptions may change; the names and effects do not.
- **LTM commands.** `memory`, `memory:reindex`, `memory:export`, `memory:import`, `memory:archive`, `memory:consolidate`,
  `memory:maintain`, `memory:status`, `memory:share` and `memory:lifecycle`, with their argument shapes; a new command
  is additive.
- **Config.** Every field marked `contract` in [Config stability](#config-stability). A contract field is never removed
  or renamed, and a new field is optional.
- **LTM notes.** The rule in [Notes written by a newer version](#notes-written-by-a-newer-version): an unknown key is kept,
  an unreadable note is kept as written, and only an explicit `memory.forget` or a store delete by id removes one.
- **LTM presets.** The preset names and their contracts; `conversational` is described in
  [Conversational preset](#conversational-preset), `coding` in [Coding preset](#coding-preset), and
  `CONVERSATIONAL_PRESET_REVISION` / `CODING_PRESET_REVISION` name the revision a measurement ran on.
  A new preset name is additive.

### May change in a minor version

- The value of every config field marked `tuning` in [Config stability](#config-stability).
- Prompt text, worker behaviour, thresholds, token budgets and the rendered memory format.
- Ranking and scoring, injection budgets, the delivery format, prompt text, tool descriptions, and a preset's contents
  inside its contract (a change to those bumps `CONVERSATIONAL_PRESET_REVISION` or `CODING_PRESET_REVISION`).
- Anything classified "Not exported" under [Stable exports](#stable-exports).
- The five **experimental** features (plan 210 Task 7), each marked in its section: Multi-query recall (`memory.recall` `queries`),
  `unmatchedTerms` in recall results, Read-time state grouping, The memory directory (`ltm.directory`, `memory.view`, tier
  `experimental` in [Config stability](#config-stability)), and Agentic lexical navigation (`memory.read` `around` / `session`).

### Experimental features after graduation

The memory feature audit (plan 210) decides every memory feature against pre-registered rules
(`scripts/memory-bench/cleanup-criteria.json`). A feature that has no measured benefit, safety, cost or compatibility
role is removed. The owner may hold such a feature instead, with a written reason, or keep one whose removal could not
be shown harmless. Either way the feature is marked **experimental** here. An experimental feature is outside the API
level 1 promise: it can change or be removed in a minor version. This is the only way a feature without evidence stays
in the package. The audit's holds (2026-11-08), each kept until a measured benefit or a non-inferior removal:

| Feature | Why it is held |
| --- | --- |
| Multi-query recall | Removing the tool affordances is not shown non-inferior (CI lower bound −7.3 to −17.9 points against the −2 margin) and the benefit lower bound is below 0 on both answer models. |
| `unmatchedTerms` in recall results | Shares the same arm and evidence as multi-query recall. |
| Read-time state grouping | Removal is not shown non-inferior (lower bound −4.5 to −21.3) and the benefit lower bound is −15.4 (large) and −4.3 (small). |
| The memory directory | Removal is not shown non-inferior on LoCoMo (lower bound −14.9 large, −9.8 small) and the benefit lower bound is −4.4 and −8.2. |
| Agentic lexical navigation | It missed the frozen plan 202 Task 5 rules, which bars a keep on benefit, and removal is not shown non-inferior (lower bound as low as −20 points). The tool is how an agent pages through neighbours and sessions, and the wave-1 losses say removing it could harm. |

The 31 features wave 1 did not measure are not removed and not held here; they are `unmeasured` and carry no claim
(plan 223 Task 3).

### Needs a new name or an explicit opt-in

- A new required service (a provider key, a model call on a path that makes none today).
- A change to what a default observes, drops or stores.
- A new capability an implementation must provide instead of an optional member.
- A new stored kind (a `memory.*` kind beyond `fact`, `preference`, `file`, `procedure`, `decision`, `episode` and `exchange`).
- A new write-path model call, or any change to what a default stores.
- A new required service for long-term memory (an embedder, a database, a provider key).
- A new capability a store or embedder author must implement instead of an optional method or declared flag.

### Config stability

Every field is `contract` (shape and meaning frozen at API level 1), `tuning` (its value may change in a minor
version) or `experimental` (the feature is an owner hold from the plan 210 audit and can change or go in a minor version;
the schema annotates these fields `tuning`, the kernel schema vocabulary having two tiers). `ltm.*` is the long-term
memory component (the former `@arnilo/prism-memory-fabric` config). `stm`, `wm`, `rehearsal`, `ltm` and `sleep` also take `false`. `src/ltm/__tests__/stability.test.ts` checks this
table against `memorySystemConfigSchema`; a field without a tier, or a tier that disagrees with the table, fails the test.

| field | tier |
| --- | --- |
| `enabled` | contract |
| `stm` | contract |
| `stm.model` | contract |
| `stm.instruction` | contract |
| `stm.thinkingLevel` | tuning |
| `stm.triggerTokens` | tuning |
| `stm.contextTokens` | tuning |
| `stm.maxChunksPerEvent` | tuning |
| `stm.maxChunkBytes` | tuning |
| `stm.chunkStore` | contract |
| `stm.chunkStore.sqlite` | contract |
| `stm.chunkStore.sqlite.path` | contract |
| `stm.habituation` | contract |
| `stm.habituation.windowEvents` | tuning |
| `stm.boundaries` | contract |
| `stm.boundaryGapMinutes` | tuning |
| `wm` | contract |
| `wm.model` | contract |
| `wm.instruction` | contract |
| `wm.thinkingLevel` | tuning |
| `wm.triggerTokens` | tuning |
| `wm.batchTokens` | tuning |
| `wm.targetRatio` | tuning |
| `wm.rejudgeTokens` | tuning |
| `wm.policy` | contract |
| `rehearsal` | contract |
| `rehearsal.model` | contract |
| `rehearsal.instruction` | contract |
| `rehearsal.thinkingLevel` | tuning |
| `rehearsal.targetTokens` | tuning |
| `rehearsal.policy` | contract |
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
| `scope` | contract |
| `scope.text` | contract |
| `scope.maxBytes` | tuning |
| `sleep` | contract |
| `ltm` | contract |
| `ltm.preset` | contract |
| `ltm.enabled` | contract |
| `ltm.inject` | contract |
| `ltm.inject.minSimilarity` | tuning |
| `ltm.inject.minScore` | tuning |
| `ltm.inject.fullTextScore` | tuning |
| `ltm.inject.cardExcerpt` | tuning |
| `ltm.inject.topK` | tuning |
| `ltm.inject.budgetTokens` | tuning |
| `ltm.inject.query` | contract |
| `ltm.inject.kinds` | contract |
| `ltm.semantic` | contract |
| `ltm.directory` | experimental |
| `ltm.directory.maxTopics` | experimental |
| `ltm.directory.maxFiles` | experimental |
| `ltm.directory.maxTokens` | experimental |
| `ltm.directory.stopWords` | experimental |
| `ltm.recall` | contract |
| `ltm.recall.expansion` | tuning |
| `ltm.recall.gather` | tuning |
| `ltm.rules` | contract |
| `ltm.rules.capture` | contract |
| `ltm.rules.maxTokens` | tuning |
| `ltm.rules.scopes` | contract |
| `ltm.rules.kinds` | contract |
| `ltm.cues` | contract |
| `ltm.cues.budgetTokens` | tuning |
| `ltm.cues.maxPerTurn` | tuning |
| `ltm.team` | contract |
| `ltm.team.dir` | contract |
| `ltm.team.write` | contract |
| `ltm.scopes` | contract |
| `ltm.scopes.tenantId` | contract |
| `ltm.scopes.priors` | tuning |
| `ltm.scopes.priors.path` | tuning |
| `ltm.scopes.priors.project` | tuning |
| `ltm.scopes.priors.team` | tuning |
| `ltm.scopes.priors.agent` | tuning |
| `ltm.scopes.priors.user` | tuning |
| `ltm.scopes.user` | contract |
| `ltm.scopes.agent` | contract |
| `ltm.scopes.project` | contract |
| `ltm.scopes.project.root` | contract |
| `ltm.scopes.project.id` | contract |
| `ltm.store` | contract |
| `ltm.store.markdown` | contract |
| `ltm.store.markdown.dir` | contract |
| `ltm.store.sqlite` | contract |
| `ltm.store.sqlite.path` | contract |
| `ltm.store.postgres` | contract |
| `ltm.store.postgres.connection` | contract |
| `ltm.store.postgres.schema` | contract |
| `ltm.store.postgres.table` | contract |
| `ltm.tools` | contract |
| `ltm.tools.root` | contract |
| `ltm.tools.maxFileBytes` | tuning |
| `ltm.limits` | contract |
| `ltm.limits.maxEntryTextChars` | tuning |
| `ltm.limits.rebuildBatchSize` | tuning |
| `ltm.limits.rebuildMs` | tuning |
| `ltm.consolidate` | contract |
| `ltm.consolidate.threshold` | tuning |
| `ltm.exchanges` | contract |
| `ltm.exchanges.enabled` | contract |
| `ltm.exchanges.steps` | contract |
| `ltm.exchanges.maxSteps` | tuning |
| `ltm.lessons` | contract |
| `ltm.lessons.nudge` | contract |
| `ltm.lessons.minTurnsBetweenNudges` | tuning |
| `ltm.lessons.archiveAfterSessions` | tuning |
| `ltm.lifecycle` | contract |
| `ltm.lifecycle.verifyAfterSessions` | tuning |
| `ltm.lifecycle.decay` | contract |
| `ltm.lifecycle.decay.episode` | tuning |
| `ltm.lifecycle.decay.fact` | tuning |
| `ltm.lifecycle.decay.preference` | tuning |
| `ltm.lifecycle.decay.procedure` | tuning |
| `ltm.lifecycle.decay.exchange` | tuning |
| `ltm.lifecycle.storageWeights` | contract |
| `ltm.lifecycle.storageWeights.explicit` | tuning |
| `ltm.lifecycle.storageWeights.sessions` | tuning |
| `ltm.lifecycle.storageWeights.helpful` | tuning |
| `ltm.lifecycle.storageWeights.harmful` | tuning |
| `ltm.lifecycle.storageWeights.outcome` | tuning |
| `ltm.lifecycle.recall` | contract |
| `ltm.lifecycle.recall.retrieval` | tuning |
| `ltm.lifecycle.recall.storage` | tuning |
| `ltm.lifecycle.archive` | contract |
| `ltm.lifecycle.archive.retrievalBelow` | tuning |
| `ltm.lifecycle.archive.storageBelow` | tuning |
| `ltm.lifecycle.archive.graceSessions` | tuning |
| `ltm.lifecycle.capacity` | contract |
| `ltm.lifecycle.capacity.user` | contract |
| `ltm.lifecycle.capacity.user.notes` | tuning |
| `ltm.lifecycle.capacity.user.tokens` | tuning |
| `ltm.lifecycle.capacity.agent` | contract |
| `ltm.lifecycle.capacity.agent.notes` | tuning |
| `ltm.lifecycle.capacity.agent.tokens` | tuning |
| `ltm.lifecycle.capacity.project` | contract |
| `ltm.lifecycle.capacity.project.notes` | tuning |
| `ltm.lifecycle.capacity.project.tokens` | tuning |
| `ltm.lifecycle.exchangeCapacity` | contract |
| `ltm.lifecycle.exchangeCapacity.hotTokens` | tuning |
| `ltm.lifecycle.merge` | contract |
| `ltm.lifecycle.merge.duplicateDice` | tuning |
| `ltm.promote` | contract |
| `ltm.promote.model` | contract |
| `ltm.promote.minScore` | tuning |
| `ltm.promote.weights` | tuning |
| `ltm.promote.weights.explicit` | tuning |
| `ltm.promote.weights.correction` | tuning |
| `ltm.promote.weights.outcome` | tuning |
| `ltm.promote.weights.recurrence` | tuning |
| `ltm.promote.weights.generality` | tuning |
| `ltm.promote.weights.ephemerality` | tuning |
| `ltm.promote.weights.derivability` | tuning |
| `ltm.promote.weights.duplicate` | tuning |
| `ltm.promote.maxCandidates` | tuning |
| `ltm.promote.minTurnsBetween` | tuning |
| `ltm.promote.derivableFrom` | contract |
| `ltm.promote.maxOutputTokens` | tuning |
| `ltm.promote.thinkingLevel` | contract |
| `ltm.decisions` | contract |
| `ltm.decisions.model` | contract |
| `ltm.decisions.points` | contract |
| `ltm.workerLimits` | tuning |

### Stable exports

`src/session/__tests__/root-exports.test.ts` and `src/ltm/__tests__/root-exports.test.ts` freeze the root barrel. Adding or
removing a name is a deliberate API decision.

- **Stable (API level 1).** The default package definition, `memorySystemConfigSchema`, `MemorySessionLedgerError`,
  `resolveMemorySystemConfig`, the ledger record names (`OBSERVATIONS_RECORDED`, `OBSERVATIONS_REPEATED`,
  `WM_RECORDED`, `TASK_STATE_RECORDED`, `BOUNDARY_RECORDED`, `OBSERVATIONS_TOMBSTONED`, `SCOPE_SET`), `foldObservationalMemoryLedger`, `activeObservations`, `activeWmItems`,
  `buildObservationalMemoryContextBlocks`, `createMemoryId`, the chunk store contract (`MEMORY_CHUNK_STORE_SERVICE`,
  `createSqliteChunkStore`, `SqliteChunkStore` and the `ChunkStore` types; [Chunks](#chunks)), and the config, ledger and
  record types. For long-term
  memory: `createMemory`, `createLongTermMemory`, `memoryFabricConfigSchema` (the `ltm`
  section), `resolveMemoryFabricConfig`, `resolveLifecycleConfig`, `parseMemoryNoteMetadata`, `encodeMemoryNoteMetadata`,
  `exportMemoryOkf`, `importMemoryOkf`, `runMemoryConformance`, `SCOPE_CLOCK_COUNTER` (a store's `scopeCounter` name),
  the read-only `MEMORY_LTM_SERVICE`, `createMemoryLtmPort`, `MAX_LTM_READ_IDS`, `MAX_LTM_PAGE` and their types,
  `CONVERSATIONAL_PRESET_REVISION`, `CODING_PRESET_REVISION`, and the config, status, report, note and store-adjacent types.
- **Not exported.** The STM, WM and rehearsal workers (rehearsal is today's dropper) and their prompts, tuning
  constants, the settings family, flush, commands, the recall tool and the compactor; the helpers the session tiers and
  long-term memory share (type guards, token estimates, recall paging), which long-term memory imports in-package.
  Long-term memory's prompts (`EPISODE_MERGE_SYSTEM` and the consolidation extractor prompts), tuning constants
  (`DEFAULT_*`, `MAX_*`, `MIN_*`, `HARD_*`), scoring and eviction helpers (`evictionOrder`, `shouldArchive`,
  `isActiveNote`, `capacityUsage`), and the lifecycle, directory and core-block builders. They carry no promise; the
  commands and tools are reached through the package, not through imports.
