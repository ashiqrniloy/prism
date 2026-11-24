# Session-Bench Long

Session-Bench Long is the long-session variant of [Session-Bench](../session-bench/README.md). It exists to answer one
question that the short sessions cannot: does working memory (WM) help once a session is long enough that short-term
memory (STM) has to leave records out? Plan 218.5 owns it, and its verdict decides whether plan 218.4 removes WM.

This page covers the generator (plan 218.5 Task 4), the design review behind it (Task 2), and the arms, runner,
instrumentation and guardrails (Task 5). The rule and the verdict arrive with Task 6.

## Why a second benchmark

Session-Bench v3 sessions run 8 to 14 tasks. STM's records for such a session reached at most about 3,100 description
tokens. The compaction block holds 8,678 at a 32K window, so STM never had to leave a record out, and the v3 screen
measured nothing about eviction.

Plan 218.5 Task 2 measured the pressure on 36 stored STM-only sessions (`pressure.mjs`; the summary is in
`docs/_evidence/memory-bench/218.5/gates/owner-gate-long.json` under `design`):

| Measure | Mean | Densest session | Sparsest session |
| --- | --- | --- | --- |
| Active description tokens per task | 156.6 | 215.1 | 118.7 |
| Task at which the pool overflows | 53 | 39 | 70 |

A long session therefore needs well over 53 tasks. The owner chose **100 tasks**, so about half of each session runs
under eviction (benchmark version 1).

**Version 2 (Task 7, 2026-11-24).** Live, on the `beam-free` memory worker, STM recorded much less than the v3 ledgers
showed (the 3 STM-only pilot ledgers of rule `60898b62`, the gate record's `design`; Task 2's record is under
`designHistory`):

| Measure | Mean | Densest session | Sparsest session |
| --- | --- | --- | --- |
| Active description tokens per task | 104.1 | 116.0 | 97.3 |
| Task at which the pool overflows | 84 | 75 | 90 |

The pool overflowed after every version-1 `after` dependent (tasks 64–100), so live G11 could not hold. The owner chose
**150 tasks** over a smaller window or a product pool setting. The offline worker mock now records at the live rates.

## What is taken from v3

Session-Bench v3 is read and never edited. The long bench imports:

- the workspace and its 13 tools (`../session-bench/env/workspace.mjs`);
- the three template families and the filler vocabulary (`../session-bench/templates/families.mjs`);
- the seeded generator and the token estimate (`../session-bench/templates/build.mjs`);
- every check kind (`../session-bench/checks.mjs`) and the scripted plan format (`../session-bench/agents.mjs`).

v3's `templateHash`, `sessionsHash` and `idsHash` do not move; the test `v3_core_files_are_untouched` holds them to the
values plan 218.3 froze.

v3 does not export its four job makers, so `build.mjs` writes them again at the long bench's artifact size. The jobs
do the same work: count the `ERROR` lines in a log, close the tickets a channel reports as resolved, fix the config
value a rule check fails, and assign a ticket to the owner a guide names.

## Sessions (`build.mjs`)

A session runs **150 tasks in six phases of 25** (version 2; version 1 ran 100 in four). Each phase opens with its own scope: a numbered plan with one step per
task of that phase. A real host re-scopes a long session this way, and each new scope makes WM judge its items again.
`session.phases` holds `{ n, from, to, scope }`; the runner sends a phase's scope before the phase's first task.

Every task has a job with its own `C` check, so the context grows by one artifact per task.

### Layout

| Tasks | What sits there |
| --- | --- |
| 1–10 | **Sources.** Every rule, tool fact, own decision and first ship day, at most two per task. |
| 20–38 | **`before` dependents**, one per task. |
| 40–52 | **Mid sources.** A rule is revoked, and two ship days change again. |
| 95–150 | **`after` dependents**, one per task. One ship day changes a third time in tasks 110–125. |

No dependent sits in tasks 39–94. An answer value is never a task number, so no scope step or prompt holds it.

### Distance buckets

The buckets are pre-registered by the dependent's task number, from Task 2's overflow point:

- **`before`**: the dependent comes before task **39**, the task at which the densest measured session would
  overflow the pool.
- **`after`**: the dependent comes after task **63**, the mean overflow task plus 10. That is 37 tasks.

One session yields both buckets on the same history, so the comparison between them is paired.

The buckets are fixed by task number, not by what an arm's block held. Task 5 records, per row, whether each
dependent's source records were still in the block.

### Dependencies

A dependency row is one check occasion. A standing rule checked four times is four rows that share a `group` and their
sources. Each row keeps v3's fields (`sources`, `dependent`, `answer`, `evidence`) and adds `group` and `bucket`.

Every session holds the same dependencies, placed at seeded tasks:

| Class | What the session holds | `before` | `after` |
| --- | --- | --- | --- |
| `D1` tool-fact | Three facts read in tasks 1–10: the same parameter of three services | 1 | 2 |
| `D2` user-only | A ticket label rule, and a signature for each of two team channels | 3 | 6 |
| `D3` own-decision | Three feature flags the agent names itself | 1 | 2 |
| `D4` superseded | Three release trains, each with a ship day that changes 2 or 3 times | 3 | 6 |
| `D2R` revoke | A second ticket label rule, retired in tasks 40–52 | 0 | 2 |

Each `D1`–`D4` class has twice as many `after` dependents as `before`. The builder refuses a session with any other
count.

**Standing rules (`D2`).** Each signature rule is checked once in `before` and three times in `after`, far apart. A
message must carry its own channel's signature and must not carry the other channel's.

**Chains (`D4`).** The user states a train's ship day and later changes it. Each dependent needs the day that is
current at its task:

- one train changes once in tasks 1–10 and again in tasks 40–52;
- one train changes twice in tasks 1–10, so its `after` dependents sit more than 50 tasks from their newest source;
- one train changes once in tasks 1–10, again in tasks 40–52 and a third time in tasks 70–80. One `after` dependent
  comes before the third change and one at least 10 tasks after it, so they need different days.

Each train has a document that still holds its first day. An agent that re-reads it announces a superseded day.

**The revoke (`D2R`).** Two label rules are stated in tasks 1–10. The second is retired in tasks 40–52. A ticket
created after that is scored jointly by the one new check kind, `created-ticket-labels`: the standing label is on and
the retired label is off.

- An agent that remembers neither rule fails, because the standing label is missing.
- An agent that remembers both rules but not the revoke fails, because the retired label is there.

So the amnesic agent cannot pass it by doing nothing. `dependencyEvidence` (`agents.mjs`) names both strings an offline
mock must see to know this dependency: the revoke and the standing rule.

**Interference.** Values of several entities look alike: the three trains share the five weekdays, the three facts
are the same parameter of different services, the two signatures and the two labels have the same shape, and every
flag has three look-alikes.

**What eviction can remove.** Task 2 found that STM rates the user's messages and corrections `high` and tool results
and the agent's own actions `medium`, and that eviction leaves out the lowest relevance first. Within 100 tasks it
removes `medium` records only. So in `after`:

- `D1` and `D3` evidence (a tool result, the agent's own decision) can be left out;
- `D2` and `D4` evidence mostly stays, and has to be found in a full block. About 6 user records per 100 tasks are
  rated `medium` and can be left out under the `relevance` order (Task 3).

### Size rules (refused at build time)

The generator throws on a session that breaks any rule. Sizes are counted at 3.5 characters per token from the scripted
agents' traces.

- **Job artifacts are 6,000 to 9,000 tokens** (`LONG_JOB_ARTIFACT_TOKENS`). v3's 17,000 to 18,500 would not fit: with
  the pool at its bound the block alone is 13,348 tokens. Side artifacts keep v3's 2,500 to 4,000.
- **The worst request after a compaction stays within 90% of the input cap.** `pressure.mjs` `worstRequest` adds the
  fixed part, the block at the pool bound and the newest tool round, for the largest single tool output either
  scripted agent reads, at Task 2's measured worst case (`MEASURED_WORST_CASE`).
- **The worst task fits the window** with the request's fixed part.
- **Every dependency spans at least 3 whole tasks and 1.5 × W** tokens, from its last source to its dependent.
- **Classes are balanced across the buckets** as in the table above, and no dependent sits between the buckets.
- **Every phase scope is under 32 KB.**
- **No answer leaks** (below).

A session has at most two rule jobs, as in v3. Each adds its keys to the config, and `get_config` with no key lists them
all. That listing is what an agent without memory reads to find a flag again, so it has to stay artifact-sized.

With W = 32K the frozen set has these sizes:

| Measure | Value |
| --- | --- |
| Smallest session | 738,923 tokens (23 W) |
| Smallest dependency span | 9 tasks, 61,625 tokens (1.9 W) |
| Job artifacts | 6,004 to 8,821 tokens |
| Largest single tool output | 8,821 tokens |
| Worst request after a compaction | 26,460 tokens (88.3% of the 29,952 cap) |
| Largest task | 16,389 tokens |
| Largest phase scope | 3,609 bytes |

### No leakage (`dependencyLeaks`)

- No dependency's answer or evidence appears in a scope or in its dependent task's prompt.
- A user-only answer (`D2`, `D2R`) appears in no file or tool output of the initial workspace, and in no prompt but its
  sources'.
- A ship day is a weekday that several trains share by design, so the bare word does appear elsewhere. The rule for
  `D4` reads the evidence instead, the train and its day together: it appears in no earlier prompt but its sources' and
  nowhere in the workspace, and the train's own document does not hold the current day.

## Scripted agents (`agents.mjs`)

- **`oracle`** knows every dependency. It passes every check.
- **`amnesic`** knows none. It fails every `D2`, `D4` and `D2R` check and passes every `C` check. It passes `D1` by
  re-reading, and those re-reads are counted. It fails `D3`, because it turns on a look-alike flag.

## Generator and partitions (`generate.mjs`)

A session is a pure function of the seed `prism-218.5-session-bench-long-v1` and its id: `sbl-<family>-<nn>`, with 12
per family. Sessions are rebuilt on demand and never committed. A session is about 3 MB of JSON, and all 36 build in
about 4 seconds.

The **label-blind draw** is v3's: within each family, ids are ordered by `SHA-256(seed + ":" + id)` and split into
`dev` (4), `heldout-a` (4) and `heldout-b` (4). The owner chose 12 dev sessions in Task 2. Plan 218.5's pilot and run
read `dev` only.

`../work-outcome-session-bench-long.json` pins:

- the seed;
- `templateHash`: the bytes of every core file, which are the long bench's five and the five v3 files it imports;
- `sessionsHash` and `scopesHash`: every generated session and every phase scope;
- the draw and its `idsHash`;
- the window rules, the layout and the buckets;
- counts and sizes.

It holds no session text. Any change to a core file is a new benchmark version and voids earlier evidence.

### Power

The owner asked for at least 60 `D2` and 60 `D4` checks in `after` over the dev set. The generator refuses a draw with
fewer. The frozen dev set holds:

| Bucket | `D1` | `D2` | `D3` | `D4` | `D2R` |
| --- | --- | --- | --- | --- | --- |
| `before` | 12 | 36 | 12 | 36 | 0 |
| `after` | 24 | 72 | 24 | 72 | 24 |

## What it cannot tell you

- **The buckets are indexes, not states.** A dependent in `after` comes after the mean overflow task of v3-length
  sessions with larger artifacts. Smaller artifacts mean fewer compactions per task, and four phase scopes add records;
  both move the overflow task. Task 5's G11 checks that the pool overflows before the first `after` dependent, offline
  and then live.
- **Eviction does not reach most user records in 100 tasks.** `D2` and `D4` in `after` test whether a rule or the
  current value is found in a full block, not whether it survives eviction. `D1` and `D3` test survival.
- **There is no `D2R` in `before`.** The revoke comes in tasks 40–52, so the revoke class has no paired bucket.
- **Every session has the same dependency structure.** Only the placement, the values and the jobs vary by seed.
- **The sessions are synthetic,** as in v3: a scripted user, one workspace, three families.

## Arms (`arms.mjs`)

Every arm shares Session-Bench v3's model, sampling, tools, system prompt, scope message, window and limits; only
`memory` differs (G6). Task 6 freezes these configs into the rule.

| Arm | Kind | Memory |
| --- | --- | --- |
| `memory-off-llm` | decision | v3's: Prism's LLM compaction, kept tail matched to session memory's |
| `STM-only` | decision | the memory system at the 0.14.0 defaults (Task 1's fixes; WM off), `context.eviction: "relevance"` |
| `STM-only-protect` | decision | the same with `context.eviction: "protect-user"` (Task 3's candidate) |
| `STM+WM` | decision | WM on, `wm.policy: "model"`, each phase's scope through `memory:scope` |
| `STM+WM-deterministic` | decision | the same with `wm.policy: "deterministic"` (no WM model call) |
| `mem0` | side | v3's: Mem0 at its documented defaults beside `memory-off-llm`'s compaction |
| `amnesic` | calibration (floor) | a fresh session per task, holding that task's phase scope only |
| `oracle-notes` | calibration (ceiling) | `memory-off-llm` plus a harness block, before each task, of every dependency's current evidence |

- **`wm.triggerTokens` is 3,000 on both WM arms,** frozen in Task 6's rule as recommended; the owner's approval of the
  rule's hash confirms it. At the product default (10,000) WM's first pass comes after the pool has overflowed (Task 3
  finding 1).
- **No arm runs the Rehearsal drop.** The memory system turns Rehearsal on only when `wm` and `ltm` are both on, and no
  arm turns `ltm` on (`components.ts`). Configuring `rehearsal` without `ltm` fails the load. The instrumentation still
  counts Rehearsal drops; offline they are 0 on every arm.
- **`oracle-notes` replaces v3's `oracle-context`,** because no window holds a 100-task session. Its block
  (`oracleNotes`) carries, for each dependency story, the closing-line notes of the row whose newest source is the
  latest before the task, so a changed ship day shows its current form only, and a revoke shows both the revoke and
  the standing rule.

## Runner (`run.mjs`)

v3's runner is extended by import and never edited: the window and meter (`windowedProviders`), the shared config, the
system prompt and scope message, and the accumulators are v3's.

- **Phases.** The runner sends each phase's scope before the phase's first task (tasks 1, 26, 51 and 76) to every arm,
  and through `memory:scope` to the WM arms.
- **The offline mock agent** knows a dependency only when every string of `dependencyEvidence(dep)` is visible in its
  request: the transcript, a compaction block or a context block. A `D2R` needs the revoke and the standing rule.
- **The offline STM worker records at Task 2's measured rates** (`workerRates`, read from the gate record's
  `design.pressure`). The product keeps each short user message word for word. The mock adds, per task, one user
  `statement` (`high`, 21.2 tokens) and, at `medium`, the task's closing line as an `outcome` plus one tool-result
  `result` that brings the task to 93.5 tokens.
- **The offline WM mock** keeps every record it is offered except the tool-result padding. v3's mock keeps everything,
  and in a 100-task session its block outgrew the window: 16 overflows on one session before the change.
- **`--jobs N`** splits the sessions across N child processes. The rows come back in session order, so the report does
  not depend on N.

## Instrumentation (`instrument.mjs`)

After each task, the runner reads the session store of a memory-system arm and keeps counts only. They are numbers,
relevance names and 12-hex record ids, never text (`row_counts_hold_no_text`).

**Per task:**

- the block: rendered tokens, description tokens, records, WM items and `fullFold`;
- compactions in the task;
- STM's active pool: tokens and records;
- records the bound left out, by relevance, and how many of them were durable records or user statements;
- Rehearsal drops, and how many were durable records or user statements;
- WM items, tombstones and passes so far.

**Per dependent:** its sources' records (by the task they cite), and which of them were in the block when the task
started. This separates a dependency that eviction removed from one that stayed in a full block, which the index
buckets cannot do.

**Per session:** the first task whose block left a record out, the WM arms' first pass and pass count, and the largest
block and pool.

The product's `isDurableOrUserStatement` is mirrored here, and a test holds the mirror to the product. The run root
keeps each session's ledger through the `inspect` hook; evidence takes the counts only.

An offline request carries the kernel's tool list message, 410 tokens, because the mock model declares no tool
support. So an offline request that fits also fits live.

## Guardrails (`guardrails.mjs`)

G1–G10 are v3's ([Session-Bench, "Guardrails against bias"](../session-bench/README.md)), applied to the long bench's
own files, pins, arms and helpers. A failure stops the run.

| Guardrail | The long bench's form |
| --- | --- |
| **G1** frozen first | The partition file regenerates byte for byte and matches `templateHash`, and the gate record's `sessionBenchLong.benchmark` pins the same hashes. |
| **G2** author separation | The long bench's core files, v3's five among them, and every module they reach import nothing from the memory system. The run reads `dev` only. |
| **G3** checks are correct | The scripted oracle passes every check on every dev session. |
| **G4** dependencies are real | The scripted amnesic agent fails every `D2`, `D4` and `D2R` check and passes every `C` check. |
| **G5** no leakage | The long bench's `dependencyLeaks` (the shared-weekday rule for `D4`). |
| **G6** equal treatment | Every arm but the calibration arms shares one config hash outside `memory`. |
| **G7** blind scoring | v3's scorer refuses a row that names an arm. |
| **G8** pre-registered analysis | `score.mjs` `ANALYSIS_LONG` covers every decision arm and every class. `live.mjs --live` refuses a guardrail report with anything pending. |
| **G9** full cost | A 6-task offline probe on `STM-only`: metered calls equal provider calls, main and workers apart. |
| **G10** third-party arms | `mem0` runs at its documented defaults on the same model, and is an arm. |
| **G11** pressure reached | Offline, `STM-only` with the worker at Task 2's rates overflows the pool before each dev session's first `after` dependent. |

**G11 offline (2026-11-23):** the pool overflows at task 57 or 58 on every dev session; the first `after` dependent
is at task 64 to 68.

### Live guardrails (Task 7's pilot)

`guardrails.mjs --live <report>` reads a live report. A miss stops the run; the fix is a new hash and a new pilot.

| Check | Threshold |
| --- | --- |
| `oracle-notes` solves the bench | ≥ 60% of tasks |
| `amnesic` fails the dependencies | ≥ 70% of each of `D2`, `D4` and `D2R` |
| G11, live | `STM-only`'s pool overflows before the first `after` dependent in ≥ 2 of 3 sessions |
| No window overflow | 0 overflows on any arm |

## Decision (`score.mjs`, `live.mjs`; plan 218.5 Task 6)

The rule (`SESSION_BENCH_LONG_RULE`) is fixed before any paid call. `live.mjs --rule` prints it and its hash;
`--write-gate` writes it to the gate record's `sessionBenchLong`, unapproved. `--live` refuses any rule whose hash
the gate does not approve on the owner's word, and any guardrail report with a miss or anything pending.

**The rule pins:**

- the benchmark (`templateHash`, `sessionsHash`, `scopesHash`, `idsHash`), the product (a hash over
  `packages/memory/system/src`, tests excluded) and the harness (a hash over the long bench's runner, arms, scorer
  and the v3 and shared modules they run). An edit to any of them is a new rule;
- each arm's config hash on the live model, and the shared hash (G6);
- the models: the main agent on `opencode-go/hy4-flash-free`; every memory worker on
  `opencode-go/deepseek-v4.1-flash` (Task 7, owner 2026-11-24, paid; `beam-free` before it hit its free daily allowance, and the screen used `muse-spark-1.3-contributor`) at `workerReasoningEffort: "low"`, `workerOutput: "window"`;
- W = 32K, the 12 dev sessions, concurrency 6, and a ceiling of 2.3B input tokens;
- the screen's harness rules: a worker fault leaves no row; a job's third worker fault or a usage limit halts the run
  with `STOP:`; worker aborts are not faults;
- `wm.triggerTokens: 3000` on both WM arms. No arm runs Rehearsal.

**A window overflow** (a request over W's input cap, rejected by the harness as a provider would) is the arm's
scored outcome, as in the screen: the task fails and the row stays. It is not a fault, because a rerun meets the same
block and would reach the third-fault stop. The pilot's live guardrail allows none. The WM arms' block is not bounded
by the pool, so they can overflow where the STM arms do not.

**Stages:** the offline guardrails; a smoke job (`memory-off-llm` on the smallest pilot session); `amnesic` and
`oracle-notes` on the 3 pilot sessions (one per family); the decision arms and `mem0` on the pilot sessions, then the
live guardrails (Task 7, `--pilot` stops here); then the other 9 dev sessions (Task 8). The pilot's rows count.

**Analysis (`ANALYSIS_LONG`, G8).** Paired by check (or task), sessions as clusters, `pairedClusterPermutation`
(10,000 resamples, seed 7). Metrics: tasks, every class, and the buckets. `before` and `after` pool `D1`–`D4` only,
so both hold the same class mix (1 : 3 : 1 : 3); `D2R`, which exists in `after` only, is its own metric.

**Verdict (`longVerdict`, a pure function):**

1. **The STM reference.** `STM-only-protect` becomes the reference, and `protect-user` the eviction default, if it
   beats `STM-only` on `after` (95% lower bound > 0) with a `C` lower bound > −5 points. Otherwise `STM-only`.
2. **WM.** Each WM arm against the reference on `after`. Holm's step-down over the two arms sets the interval level:
   the arm with the smaller sign-flip p reads a 97.5% interval; the other reads 95% if the first was rejected, else
   97.5% too. `C` is read at the same level.
   - **Keep WM** if a WM arm's lower bound is > 0, its `C` lower bound > −5 points, and its whole-run tokens per
     passed task ≤ 1.5× the reference's. The best such arm sets WM's default policy under a host scope.
   - **Drop WM** if both WM arms' upper bounds are < +5 points.
   - **The owner decides** otherwise. The report gives each arm's `after` − `before` gain (the owner's hypothesis,
     read directly), the detectable effect and the cost.
3. **STM at length.** If reference − `memory-off-llm` has a lower bound ≤ 0 on `after` while `before`'s is > 0, the
   report sends a P1 STM finding to the owner.

`mem0` is compared with every decision arm and reported; the verdict never reads it.

## Reproduce

```sh
timeout 600  bun scripts/memory-bench/session-bench-long/generate.mjs --check
timeout 600  bun scripts/memory-bench/session-bench/generate.mjs --check          # v3 untouched
timeout 1800 bun scripts/memory-bench/session-bench-long/guardrails.mjs           # G1-G11, about 1 minute
timeout 1800 bun scripts/memory-bench/session-bench-long/run.mjs --offline --jobs 6
timeout 900  bun test --timeout=0 scripts/memory-bench/session-bench-long
timeout 120  bun scripts/memory-bench/session-bench-long/live.mjs --rule         # the rule and its hash, no call
```

`generate.mjs --write` writes the partition file. Use it for a new benchmark version only.

The design review's measurement reads stored STM-only sessions, which stay outside the repository:

```sh
timeout 600 bun scripts/memory-bench/session-bench-long/pressure.mjs --ledgers <dir> --window 32000 [--write] [--sessions]
```
