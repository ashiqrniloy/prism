# Long-running work

## What it does

An agent job that runs for hours or days is many bounded runs on one session. Four pieces make that safe:

- **Run limits** bound one `session.run`. Each policy axis can be set to `null`.
- **Session limits** bound the whole session across runs: spend, tokens, run count, and a deadline. Their counters are kept in the store, so they survive a restart.
- **The stall axis** (`maxRepeatedToolRounds`) stops a run that repeats the same tool round with the same results.
- **The job driver** (`runAgentJob` / `resumeAgentJob` in `@arnilo/prism-extensions/workflows`) runs the session until a host predicate says done. It checkpoints after each run and picks the job up again after a process restart.

Compaction keeps the model's context bounded as the session grows. Turn checkpoints and `session.continue()` let an interrupted run pick up where it stopped.

## When to use it

Use it for work with no natural end inside one model conversation: a migration across many services, a backlog worked item by item, a watch-and-fix job.

**One run or many runs.** One run with every axis set to `null` has no checkpoint between units of work, no point at which the host can decide whether to go on, and one wall timer for the whole job. Many bounded runs on one session keep history and compaction across runs, and each run is a unit the host can count, retry, and stop. The recommendation is many bounded runs on one session, driven by `runAgentJob`. Use one long run only when the work cannot be split, and then bound it with session limits.

## Limits

Every limit Prism applies is one of three classes. [limits.md](limits.md) lists each one, its default, and where to set it.

| Class | Bounds | Who sets it |
| --- | --- | --- |
| policy | the work an agent does: turns, tool calls, tokens, cost, time | the host, at `createAgent`, `agent.session`, or `RunOptions` (narrowing by `min`); `null` disables it where the axis allows |
| ceiling | the process: wire and storage bytes, queue depths, durable state | the host only, at `createAgent` (`AgentConfig.ceilings`), in package config, or on a factory the host builds |
| format | a structural invariant of a wire or storage format | nobody; it is fixed and the reason is listed |

## Inputs

### Run limits

`AgentConfig.limits` and `RunOptions.limits` (see [agent.md](agent.md#limits)). For a long job, keep the defaults per run: 50 turns, 200 tool calls, 15 minutes of wall time, and a stalled run stopped after 5 repeated rounds. A run that needs more can set an axis to `null`. Every axis set to `null` with no session limit is a job with no spend bound.

### Session limits

`AgentConfig.sessionLimits` (the default for every session) and `SessionOptions.limits`. The session value narrows the agent value by `min`.

| Key | Type | Bounds |
| --- | --- | --- |
| `maxCost` | `{ amount, currency } \| null` | spend across every run of the session |
| `maxTotalTokens` | `number \| null` | tokens across every run |
| `maxRuns` | `number \| null` | the number of runs |
| `deadline` | ISO 8601 instant \| `null` | wall-clock time; each run's wall timer is armed at `min(maxWallTimeMs, deadline − now)` |

Usage from turns, package model calls, and child runs charged through `RunOptions.chargeTo` all counts, including an async child that outlives its parent's run. Neither a package nor the model can raise a session limit.

### Ceilings

`AgentConfig.ceilings` (see [agent.md](agent.md#ceilings)). Raise one when a long job hits it for a reason you accept:

- `branchReadPages` when a store pages a very long branch;
- `stateLogEntries` when a package's `prism.state.log(key)` must hold more than 10,000 records on a branch (or rotate the log, below);
- `externalStateEntries` / `externalStateBytes` when a driver loop's archive grows (or rotate it);
- `runStateBytes` when a custom loop's snapshot does not fit a turn checkpoint.

### The stall axis

`limits.maxRepeatedToolRounds` (default 5, `null` disables). A tool round repeats when its set of `(name, argHash, resultHash)` equals one of the run's previous 8 rounds. When that many repeated rounds come in a row, the run fails with `limit: "maxRepeatedToolRounds"`. A new argument or a changed result resets the count, so polling a status that changes is not a stall. With `durability: "turn"`, the window rides the turn checkpoint, so `continue()` keeps the count.

### The job driver

`runAgentJob(session, spec)`. `spec` holds:

| Field | Default | Meaning |
| --- | --- | --- |
| `input` | required | the first message |
| `next(view)` | none | the next message, or `undefined` to only continue a branch that owes a turn |
| `done(view)` | required | the host's predicate, checked after each run that did not fail; it may call a model |
| `maxRuns` | 100 | `null` is unbounded |
| `maxConsecutiveFailures` | 3 | failed runs in a row before the job stops |
| `maxIdenticalOutcomes` | 3 | runs in a row with the same final text and tool calls and results |
| `retry` | `{ baseMs: 30_000, maxMs: 900_000 }` | backoff before the run after a failure, doubling |
| `checkpoints` (or `prism`) | required | the workflow checkpoint store |
| `jobId`, `signal` | generated, none | the job's id; the host's abort |

`resumeAgentJob(session, spec, jobId, { decisions? })` reads the newest checkpoint and continues. Pass the same `spec`, with the same `maxRuns`: the job's definition hash includes it. The workflows README has the full contract under [Agent jobs](../packages/extensions/workflows/README.md#agent-jobs).

### Durability

- `AgentConfig.durability: "turn"` writes one `run_checkpoint` after each completed tool round. After a crash, `session.continue()` resumes the interrupted run under its own id, counters, and wall deadline. With the default `"suspension"`, `continue()` starts a new run with fresh counters. See [agent.md](agent.md#continuing-a-run).
- `session.continue()` answers each unanswered tool call at the tip from the effect store, or with `tool_call_interrupted`. It never dispatches a tool again.
- `resumeAgentJob` continues a run that was in flight when the process died, and records a run that finished after the last checkpoint from the branch instead of sending it again.

### Stores

Use SQLite or Postgres for the session and the job checkpoints. They read the branch tail (`readBranchPath`), so store reads per turn and retained memory stay flat over thousands of turns. The JSONL store has no tail read and caches every entry of a session in memory, so its reads and heap grow linearly with session length. Use it for demos and short jobs. Measured numbers are in [performance.md](performance.md#long-runs).

### Compaction

By default the kernel compacts at 80% of the model's input cap, so a session's context stays bounded however many runs it holds. Keep compaction on for a long job (`compaction: false` turns the trigger off, but not overflow recovery). See [slots.md](slots.md#when-the-compaction-slot-runs). Compaction keeps the newest `run_checkpoint`, the `session_limits` counters, and package state. Two kinds of state grow until a package rotates them:

- a package log: `SessionLog.replace(session, values)` drops earlier records, so compaction checkpoints stop copying them;
- a driver loop's archive: `ExternalStateHandle.replace(entries)` frees the capacity used by earlier entries.

## Outputs and events

`runAgentJob` and `resumeAgentJob` return `AgentJobResult { jobId, status, reason, runs, usage, lastRun, pending?, version }`. `usage` counts only runs whose `RunResult` the driver saw: an approved run resumed through `session.resume` and a run recovered from the branch after a restart add none. `session.limits()` is the budget of record:

```ts
const limits = await sessionB.limits();
// limits.counters.runs, limits.remaining.runs
```

With `prism`, the job emits `job.started`, `job.run`, and `job.stopped` as workflows-package events, each with `jobId` and `sessionId`.

### What stops a job, and what the host sees

| Cause | `status` / `reason` | What the host does |
| --- | --- | --- |
| `done` returns true | `done` / `done` | nothing |
| a session limit, at run start (`SessionLimitError`, `code: "session_limit"`) or mid-run (`limit.scope: "session"`) | `stopped` / `session_limit` | raise the session limit, then resume |
| `maxRuns` | `stopped` / `max_runs` | start a new job on the same session if the work should go on |
| `maxConsecutiveFailures` (a run failed, including a run limit, a provider error, or a stall) | `failed` / `max_consecutive_failures` | read `lastRun` and its `limit` / `error`, fix the cause |
| `maxIdenticalOutcomes` | `stopped` / `max_identical_outcomes` | the agent is going in circles; change `next` or the instructions |
| `next` returns `undefined` with nothing to continue | `stopped` / `nothing_to_continue` | supply input |
| `spec.signal` aborts | `aborted` / `aborted` | nothing; the job is over |
| a run suspends on an approval | `suspended` / `approval_required`, with `pending` | `resumeAgentJob(session, spec, jobId, { decisions })` |
| the process dies | no result | `resumeAgentJob(session, spec, jobId)` in the next process |

An abort is terminal: the job's workflow ends, and a later `resumeAgentJob` returns the stored stop. To pause a job, let the process stop and resume it later; do not abort it.

A malformed `session_limits` entry fails the run closed with `SessionLimitsUnreadableError` (`code: "session_limits_unreadable"`).

## Request/response example

```json
{
  "sessionLimits": { "maxRuns": 40, "maxTotalTokens": 100000 },
  "durability": "turn"
}
```

A finished job (the example below):

```json
{ "status": "done", "reason": "done", "runs": 30, "sessionRuns": 30, "remainingRuns": 10 }
```

## Implementation example

From [`examples/long-running-job.ts`](../examples/long-running-job.ts): a 30-run job whose process dies inside run 12, then resumes in a fresh agent over the same store. The example uses the JSONL store and in-memory checkpoints to run without setup; a real host uses SQLite or Postgres for both.

The agent sets the spend guard for the whole job. Run limits and the stall axis stay at their defaults:

```ts
const agentFor = (model: ModelProvider): Promise<Agent> =>
  createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [jsonlStore({ dir }), providerPackage("demo-provider", [model])],
    tools: { add: [record] },
    // The spend guard for the whole job: every run on the session counts, and the counters survive a restart.
    sessionLimits: { maxRuns: 40, maxTotalTokens: 100_000 },
  });
```

The job spec:

```ts
// The job checkpoints. A real host keeps them in SQLite or Postgres:
// `createWorkflowCheckpoints({ store: persistence.checkpoints })`.
const checkpoints = createMemoryWorkflowCheckpoints();
const spec: Omit<AgentJobSpec, "jobId"> = {
  input: `Record each step until ${RUNS} steps are done.`,
  next: () => "Next step.",
  done: ({ lastRunResult }) => lastRunResult?.text.includes("ALL DONE") === true,
  maxRuns: 50,
  maxIdenticalOutcomes: 3,
  retry: { baseMs: 0, maxMs: 0 },
  checkpoints,
};
```

Process A starts the job, and process B resumes it:

```ts
// Process A: the job starts; run 12 is in flight when the process dies.
const agentA = await agentFor(provider(() => crashed()));
const sessionA = await agentA.session({ id: "migration", create: true });
const processA = new AbortController();
const jobA = runAgentJob(sessionA, { ...spec, jobId: "migration-job", signal: processA.signal });
await died;

// Process B: a fresh agent over the same session directory resumes the job.
const agentB = await agentFor(provider());
const sessionB = await agentB.session({ id: "migration" });
const result = await resumeAgentJob(sessionB, spec, "migration-job");
const limits = await sessionB.limits();

// Release process A's abandoned run only now, so it cannot touch the finished job.
processA.abort("process A is gone");
```

Process B continues run 12 through `session.continue()`; its tool does not run again. Two details show in the output. The hung turn in process A charged no tokens, so the session counters hold only answered turns. And process A's abandoned run is released only after process B finishes: an abort is terminal for the job, and the abandoned run's late writes fail the checkpoint version check, leaving B's branch intact. In a real crash the process is gone and there is nothing to release.

The reference host runs the same job with its coding worker and SQLite checkpoints: the `long-job` scenario in [`apps/prism-agent`](../apps/prism-agent/README.md).

## Extension and configuration notes

- The job is a cyclic workflow of one function node, so it uses the workflows package's checkpoints and suspension. Its checkpoint stays bounded over thousands of runs (`maxIterationRecords: 4`).
- `next` and `done` are host code. `done` can be a model call (for example a `decisions()` question); that call is the host's cost.
- A host that drives runs itself, without the driver, gets the same limits: session limits, the stall axis, and turn checkpoints are kernel features.

## Security and performance notes

**Raising a ceiling is a host decision.** Neither a run, a package, nor the model can raise one. Know what each one costs before you raise it:

- **Memory.** A byte ceiling (`maxRequestBytes`, `maxResponseBytes`, `runStateBytes`, `externalStateBytes`) is how much one request, response, or state value may hold in process memory. Raising it raises the worst case per agent.
- **Spend.** Run limits set to `null` with no session limit leave the job with no bound on spend, tokens, or time. Set at least `maxCost` or `maxTotalTokens`, and a `deadline`, on every long job.

The job runs with the session's principal and limits, and cannot raise either. Stall attribution carries tool names and hashes, never arguments or results. The `session_limits` entry carries counters, never message content. The job checkpoint holds counters, ids, and status, never messages.

### Cost of each knob

| Knob | Cost | Default that avoids it |
| --- | --- | --- |
| Session limits | one store append per run end; none extra with `durability: "turn"` (the counters ride the checkpoint) | unset: no write |
| Stall axis | one canonical serialization and one SHA-256 per tool result; a window of 8 digests | on (default 5); `null` turns it off |
| `durability: "turn"` | one store append per tool round | `"suspension"`: none |
| `session.continue()` | one branch read, plus one append per unanswered call | called only when a branch owes a turn |
| Job driver | one workflow checkpoint write per run (plus one per route step); one SHA-256 over the final text and tool calls per run that did not fail; no model call | not installed |
| `done` | whatever the host makes it; a model call if it asks a model | a string or state check |
| Compaction | one compaction per trigger (a model call with LLM compaction) | on at 80% of the input cap |
| Ceilings | none: resolved once per agent | defaults |

Measured on the mock provider with SQLite, 10,000 turns on one session stay flat: per-turn overhead 1.24× from turn 100 to the end, no retained-heap growth from run 50 to run 200, and a constant 0.77 store reads per turn. See [performance.md](performance.md#long-runs).

## Related APIs

- [Agent](agent.md): run limits, session limits, ceilings, `continue()`, and turn checkpoints.
- [Limits](limits.md): every limit, its class, default, and where to set it.
- [Slots](slots.md): the compaction and store slots.
- [Events](events.md): `run.failed` with `limit` and `limit.scope`.
- [`@arnilo/prism-extensions/workflows`](../packages/extensions/workflows/README.md#agent-jobs): the job driver.
