# Agent configuration

## What it does

`createAgent(config)` creates an agent with a model, optional packages, hooks, slots, and host ports.
The kernel enforces limits, redaction, and fail-closed loading. Packages own identity verification
and policy enforcement.

## When to use it

Create one agent per configured model/tool/package composition, then create sessions for conversations.

## Inputs

| Field | Meaning |
| --- | --- |
| `model?: ModelRef` | `"provider/model"` (split on the first `/`) or a `ModelSpec`. Parsed once by `createAgent`; `agent.config.model` is the parsed `ModelSpec`. Required unless the `loop` slot's strategy declares `usesModel: false`; otherwise `createAgent` rejects with `model_required`. There is no default model or provider. See [models.md](models.md). |
| `principal?: Principal` | Optional opaque host principal (`kind`, `id`, `displayName?`). No default identity is created. |
| `tools?: { add?: readonly ToolDefinition[] }` | Host tools. A duplicate name (including the kernel's `load_skill`/`search_tools`) fails the run closed. |
| `skills?: { dirs?; add?; disclosure?; catalog? }` | Host skills. `dirs` reads through the same reader as `PackageAPI.skills.addDir`; `disclosure` defaults to `progressive`. `catalog: { maxEntries?, maxDescriptionBytes? }` bounds the progressive catalog (defaults 64 skills, 512 bytes per description). A name already taken by a skill with the same `path` and the same `instructions` is a no-op; a different path or body is `skill_conflict`. |
| `packages` | Explicit package instances; installed packages are not automatically loaded. |
| `hooks` | Host registrations on the agent's hook bus. |
| `host` | Optional host ports, including `HostUi`. |
| `slots` | Direct assignments for loop, compaction, store, and credentials. |
| `limits` | Agent-wide policy limits; `RunOptions.limits` narrows each axis. Defaults: 50 turns, 49 tool rounds, 200 tool calls, 15 minutes, no token cap (see [the limits table](#limits)). |
| `sessionLimits?: SessionLimits` | Default session-wide budget across runs (`maxCost`, `maxTotalTokens`, `maxRuns`, `deadline`); `SessionOptions.limits` narrows each axis by `min`. |
| `ceilings?: AgentCeilings` | Host-only process-safety ceilings: request/response bytes, durable run state, pending and sticky decisions, steers, the snapshot-cache TTL bound, skill bytes, package and external state, branch-read pages, tool concurrency. Each is a positive integer; omitted keys keep the shipped value. No run option, package, manifest, tool or model can set one (see [Ceilings](#ceilings)). |
| `compaction?: false \| CompactionOptions` | Sizes and times compaction (the implementation is the `compaction` slot). Omitted, the kernel compacts at 80% of the model's input cap (`DEFAULT_COMPACTION_TRIGGER`) when every `compaction.when` handler abstains; `trigger` or `thresholdEntries` replaces that; `false` turns the kernel trigger off but not overflow recovery. The deterministic compactor is replaced by installing one compaction system: session memory (`@arnilo/prism-memory-system`, `enabled: true`) or LLM compaction (`@arnilo/prism-extensions/compaction`); an agent runs one. See [slots.md](slots.md#when-the-compaction-slot-runs). |
| `retry?: false \| RetryOptions` | Provider-turn retry. Omitted means the default policy (4 attempts, 500 ms base doubling to a 30 s cap, ±25% jitter, `Retry-After` honored up to `maxRetryAfterMs`, default 60 s); `false` turns it off; `RunOptions.retry` overrides it per run. Only failures classified transient are retried. See [models.md](models.md#retry). |
| `ownership` | Persistence scope. Independent of principal; never inferred from it. Narrow-only at agent → session → run (see [Ownership scope](#ownership-scope)). |

### Tools and skills

`tools.validation` (`"schema"` by default, or `"off"`) controls the kernel's check of every tool call's
arguments against the tool's `parameters` before the tool runs; a violation blocks the call with
`reason: "invalid_arguments"`. `validator` and `RunOptions.validate` run after it. See
[tools.md](tools.md) "Argument validation".

`tools.concurrency` (integer 1–16, default `4`) is how many calls of one model turn run at once; `1` is
serial, `RunOptions.tools.concurrency` can only lower it, and a round with an `exclusive` tool, a tool
without `effects`, or an unknown tool stays serial. See [tools.md](tools.md) "Parallel rounds".

`limits.maxToolTimeMs` (default none; layers narrow by min) bounds one tool call, and a tool's own
`timeoutMs` applies too: the smaller wins. An expired call settles with `error.code: "tool_timeout"`; the
run continues. Abort and the wall limit also end a running call (`tool_aborted`). See [tools.md](tools.md)
"Interruption and timeouts".

Every configured skill is active (roadmap §2.3 has no per-run skill narrowing). Progressive
disclosure renders a name+description catalog and registers `load_skill`; `eager` renders every
body each turn and registers no `load_skill`. The progressive catalog is one system message:
`Skills are task-specific instructions. When a task matches a skill below, call load_skill with its
name before starting.` followed by one `- <name>: <description>` line per skill. Descriptions are
truncated at 512 bytes and only the first 64 skills are listed, ending with
`(N more skills are installed but not listed.)`, so a large description or catalog never fails a
run. A skill body over the 256 KiB hard cap is rejected when it is registered (`skill_too_large`)
or skipped by directory discovery instead. The catalog is a named `kernel:context.build`
registration: `inspect().hooks` lists it, and `disable.hooks: ["kernel:context.build"]` removes it.

The same rule covers all three registration paths (`skills.add`, `skills.dirs`, and a package's
`skills.register`): discovering one `SKILL.md` twice — a host directory plus a discovery package such
as `@arnilo/prism-extensions/context-files`, or a delegate child that inherits both — registers one skill, while
reusing a name with another body still fails closed.

In progressive mode `load_skill` returns the header plus the full instructions as its tool result,
once. Later turns carry that result as part of the transcript, so the body sits in the cached prefix
instead of being re-appended to every request. Loading the same skill again is a normal result
(`Skill <name> is already loaded; its instructions are earlier in this conversation.`), not a
failure.

After compaction drops the tool result, only skills loaded in the current run get their body
re-attached at the tail. Earlier-run skills leave the loaded set and are named in one line,
`Previously loaded skills (load again if needed): a, b` (sorted, at most 16 names plus `(+N)`); a
later `load_skill` returns their full body again. A run resumed from a checkpoint belongs to the
checkpoint's run, so its restored bodies re-attach as current. The cost is one body copy per load,
plus one re-attach after a compaction for current-run skills only.

A skill with `requiresTools` is offered only on a request whose advertised tools include all of them;
`load_skill` on one that is not returns a `skill_unavailable` tool error and the run continues. See
[Skills that need tools](tools.md#skills-that-need-tools).

`RunOptions.tools.only` narrows the tool set for one run; an unknown name fails closed, and a
durable resume intersects the list with the checkpointed grant (the stored wire field keeps the
name `toolNames`).

`RunOptions.skills` narrows the run's skills the same way: `{ only: ["name", ...] }` keeps a subset of the agent's
skills (still filtered by `requiresTools` against the run's tools), `false` gives none, and an unknown name fails the
run closed before any event.

### Charging an ancestor run

`RunOptions.chargeTo` takes a `SessionContext` view of an ancestor session (normally the `context.session` a package
tool received while opening a child with `PackageAPI.sessions.open`). Every usage the run records is then also
recorded on that session's active run: its token and cost limits, its `RunResult.usage`, its `run_total`, and one
ledger row of scope `child_run`. A breach there ends the ancestor's run with `run.failed { limit }` and fails the
child run too. The ancestor's own `chargeTo` applies in turn, so a tree is charged up to its root, one call per level.

- The target must be a kernel view of a session of the same agent that is an ancestor by links (checked through open
  sessions); a sibling, a descendant, the session itself, another agent's view or a hand-built context fails the run
  before any event.
- With no active run on the ancestor (an async child outliving its parent's run), nothing is charged to it.
- `child_run` rows mirror the child session's own `provider_turn` and `package_call` rows. A total summed across
  sessions must leave `child_run` out, or child turns count twice; a per-session total that should include its
  children adds it.

### Limits

`AgentConfig.limits` sets each policy axis and `RunOptions.limits` narrows it (`min`); a run may also set
an axis the agent leaves unset, up to the agent's ceiling.
`backgroundSettleMs` is agent-wide only: a per-run value is ignored, because a session outlives a
run.

An axis neither layer sets takes its default (`DEFAULT_RUN_LIMITS`). `null` disables a policy axis.

| Axis | Default | Exceeded |
| --- | --- | --- |
| `maxTurns` | 50 | breach: `run.failed` with `limit` |
| `maxProviderAttempts` | 75, and never below `maxTurns` | breach |
| `maxToolRounds` | 49 | clean stop: `stopped`, `stopReason: "turn_limit"`, the last turn's calls settled undispatched |
| `maxToolCalls` | 200 | breach |
| `maxRepeatedToolRounds` | 5 | breach: a stalled run (see below) |
| `maxWallTimeMs` | 900,000 (15 min) | breach; the run is aborted |
| `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens` | none (`null`) | breach |
| `maxCost` | none | breach |
| `maxRequestBytes`, `maxResponseBytes` | 8 MiB (at most `ceilings.maxRequestBytes` / `maxResponseBytes`, 64 MiB; cannot be `null`) | breach |
| `maxRunStateBytes` | 256 KiB (at most `ceilings.runStateBytes`, 1 MiB; cannot be `null`) | the suspension or `run_checkpoint` save fails |
| `maxContinuations` | 3 | clean stop: `hook_limit` |
| `maxToolTimeMs` | none | the call settles with `tool_timeout` |

`maxToolRounds` sits one below `maxTurns`, so a model that never stops calling tools ends with the clean
stop rather than a breach. The token axes are off by default: `inputTokens` includes cache reads, so a
cumulative input cap grows with the number of turns rather than with spend. Bound spend with `maxCost`
or a token axis.

`maxRepeatedToolRounds` is the stall axis. A tool round repeats when its set of `(name, argHash, resultHash)`
equals one of the run's previous 8 rounds. The run fails when that many repeated rounds come in a row, so a
model stuck re-issuing the same calls to the same answers stops long before `maxToolRounds`. A round with
a new argument or a changed result resets the count, so polling a changing status is not a stall. The
check runs inside `RunController.executeTools`, so custom loops are covered. The `run.failed` attribution
lists the repeated calls' names, `argHash`, and `resultHash`: hashes only, never arguments or results.
With `durability: "turn"`, the window (8 round digests) rides the turn checkpoint, so `session.continue()`
keeps the count. Cost: one canonical serialization and one SHA-256 per tool result.

The defaults bound one run, not a session. To bound spend, tokens, runs, or wall-clock time across all runs of a session, set `AgentConfig.sessionLimits` or `SessionOptions.limits`:

- `maxCost`: `{ amount, currency } | null`
- `maxTotalTokens`: `number | null`
- `maxRuns`: `number | null`
- `deadline`: ISO 8601 instant string | `null`

A session-level setting narrows the agent-level setting by `min` (`null` disables). Usage from turns, package model calls, and child runs charged via `RunOptions.chargeTo` (including async children that outlive the parent run) counts toward the session's budget. When any session limit is configured, counters persist in the store as `session_limits` entries (and ride `run_checkpoint` entries when `durability: "turn"`), survive compaction and restarts, and incur no extra writes when unset. Exhausting a session limit mid-run fails the run with `limit: { limit, scope: "session", maximum, observed }` (`deadline` arms the run's wall timer at `min(maxWallTimeMs, deadline - now)`). Starting a new run after exhaustion rejects with `SessionLimitError` (`code: "session_limit"`) without appending anything; a malformed `session_limits` entry fails closed with `SessionLimitsUnreadableError` (`code: "session_limits_unreadable"`). Call `session.limits()` to inspect current counters and remaining budget.

For work that runs for hours or days (many bounded runs on one session, session limits as the spend guard, the stall axis, the job driver, and recovery), see [long-running.md](long-running.md).

### Ceilings

A ceiling protects the process rather than bounding work. `AgentConfig.ceilings` is the only place a
ceiling is set: `createAgent` resolves it once, freezes it, and binds it to the agent. `RunOptions` has
no `ceilings` key (an unknown key is rejected), a package reads the resolved values as `prism.ceilings`
and cannot change them, and a value written to `agent.config` later is ignored. A value above a ceiling
fails closed, and the error names the ceiling, never the value.

| Ceiling | Default | Bounds |
| --- | --- | --- |
| `maxRequestBytes`, `maxResponseBytes` | 64 MiB | `limits.maxRequestBytes` / `maxResponseBytes` at either layer |
| `runStateBytes` | 1 MiB | `limits.maxRunStateBytes`, and every load of a stored run state (a state above a lowered ceiling fails with `AgentRunStateError`) |
| `pendingDecisions` | 128 | decisions one run suspends on, and one `session.resume` batch |
| `stickyDecisions` | 64 | sticky decisions one run holds |
| `pendingSteers`, `pendingSteerBytes` | 8, 64 KiB | the session's steer queue |
| `snapshotCacheTtlMs` | 30,000 | `SessionOptions.snapshotCacheTtlMs` |
| `skillInstructionBytes` | 256 KiB | one skill's instructions from any source, `load_skill` results, persisted skill bodies |
| `stateValueBytes` | 64 KiB | one package state value or external-state entry |
| `stateLogEntries` | 10,000 | entries one `prism.state.log(key)` holds per branch |
| `externalStateEntries`, `externalStateBytes` | 10,000, 8 MiB | one external-state key per branch |
| `branchReadPages` | 64 | pages a paged branch read follows; past it the read throws `SessionBranchReadLimitError` (`code: "branch_read_limit"`) instead of returning a short branch |
| `toolConcurrency` | 16 | `tools.concurrency` at either layer |

```ts
createAgent({ model, ceilings: { maxResponseBytes: 128 * 1024 * 1024, runStateBytes: 4 * 1024 * 1024 }, limits: { maxResponseBytes: 100 * 1024 * 1024 } });
```

A store's list and search ceilings are set on the store, which the host constructs:
`createMemorySessionStore({ queryLimits })` (see `SessionQueryLimits`). Every limit Prism applies, its
class and where to set it is listed in [limits.md](limits.md).

`limits.bufferOutput` (boolean, default `false`; `true` at the agent or the run wins) holds each turn's
`message.delta` events until the turn's usage has been charged. By default deltas stream live under any
cap, so a turn that breaches `maxOutputTokens`, `maxTotalTokens` or `maxCost` has already shown its deltas
when `turn.completed {error}` and `run.failed` arrive. Set `bufferOutput: true` when no output of a
breaching turn may reach a subscriber; the trade is no streaming. See [events.md](events.md) "Delivery
under caps".

The kernel owns no context-engineering stage. Input budgeting, tool-result folding, tool search, and
the attention compiler are one package, `@arnilo/prism-extensions/context-engineering`, which registers a single
`context.build` handler; `AgentConfig.contextBudget`, `toolResultFold`, `toolsDisclosure`,
`toolsSearch`, and `attentionCompiler` and their `RunOptions` overlays are gone, so a host enables
them the way it enables any package:

```ts
createAgent({ packages: [contextEngineering({ budget: { maxInputTokens: 32_000 } })] });
```

Without that package a turn runs strictly less work than before: no eviction, no fold, no disclosure
narrowing, and no attention pass. `resolveInputCap` and the token estimators stay exported because
the kernel's own accounting (`contextMeter`, the usage fallback, the `input_ratio` compaction gate)
still measures with them.

`RunOptions.principal` overrides the agent principal for that run. The identical object is passed
through to `HookContext.session.principal`, package tool `context.session.principal`, and
`ToolExecutionContext.principal`. Cached session views track the active run, then return to the
agent default. The kernel does not inspect governance fields, verify credentials, or produce
identity telemetry from the object. Sticky decisions use `principal?.id` plus tool/argument scope;
this identifier is not authentication.

`AgentConfig.identity`, `RunOptions.identity`, tool-context `identity`, and `resolveRunIdentity`
are removed. The legacy agent SDK accepts optional `principal`; its retired `identity` field is
rejected, and no local identity profile is synthesized.

## Outputs

An agent and its sessions. Principal is available to package code during execution, not automatically
serialized into events or session entries. Packages may explicitly emit redacted audit metadata.

## Example

```ts
const principal = { kind: "user" as const, id: request.user.id };
const agent = await createAgent({ model, principal, packages: [openai(), governance()] });
const session = await agent.session();
await session.run("hello");
await session.run("delegated request", { principal: delegatePrincipal });
await session.close();
await agent.dispose();
```

### Implementation examples

Three runnable examples import only `@arnilo/prism` and `@arnilo/prism/testing`, run network-free, and are
part of the execution gate:

- [`examples/session.ts`](../examples/session.ts): open a session, stream a run, read the `RunResult`
  and the messages it appended, reopen the session by id, and list it with `agent.sessions`.
- [`examples/approval.ts`](../examples/approval.ts): a tool gated by `tool.call` → `{ ask }`, resolved
  inline by a scripted `HostUi`, then suspended with no UI and resumed by a new agent over the same store with
  `session.resume(decisions)`.
- [`examples/host-hooks.ts`](../examples/host-hooks.ts): the host as an inline package: a `tool.call` deny
  on `network` effects, a `turn.before` budget stop, a `disable` of one tool, and `agent.inspect().hooks`.

```ts
const result = await (await agent.session()).run("Clean up tmp/scratch.txt");
if (result.status === "suspended") {
  const again = await otherProcessAgent.session({ id: result.sessionId });
  for await (const event of again.resume(result.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" })))) render(event);
}
```

## Sessions

`agent.session(options?: SessionOptions): Promise<Session>` is the only way to open a session.

```ts
const agent = await createAgent({ model, packages: [openai()], slots: { store: myStore } });
const s = await agent.session(); // a new session: no store read
const again = await agent.session({ id: s.id }); // resumes through the store slot
```

| Call | Behavior |
| --- | --- |
| `agent.session()` | Opens a new session with a generated id. It reads nothing from the store. |
| `agent.session({ id })` | Reads that session's branch once (`readBranchPath` when the store has it), restores package state, and finds a pending `suspended_run` entry. `leafId` resumes from a branch other than the leaf. |
| unknown `id` | Rejects with `SessionNotFoundError` (`code: "session_not_found"`). It never creates a session under a caller-chosen id unless you ask. |
| `agent.session({ id, create: true })` | For a host that owns the id (an AG-UI thread, an ACP session, a channel). Reads the branch once: a non-empty branch resumes as above, an empty one opens a new session under that id. The ownership check is unchanged, so another scope's id is still `SessionNotFoundError`. |
| `id` owned by another scope | Rejects with the same `SessionNotFoundError`. Every entry on the branch must carry the session's effective scope, so a shared store never reveals another tenant's session or its metadata. |

### One writer per session

Every append a session makes at its own tip is tip-checked (`SessionAppendOptions.tip`, see
[slots.md](slots.md#extension-and-configuration-notes)). When another writer has moved the tip (a second
session object or process on the same id, or a host that re-opened at a stale saved `leafId`), the run fails
with `status: "failed"` and `error.code: "session_conflict"` (`SESSION_CONFLICT_CODE`). Entries the run
appended before the tip moved stay; nothing is written from the conflicting append on. The session then
moves to the store's current leaf, so the next `run()` reads the other writer's entries and appends after
them. To branch from an earlier entry on purpose, call `session.checkout(leafId)` first: the next append is
a branch, not a conflict. `agent.session({ id, leafId })` alone is a tip-checked writer at that leaf. A store
that does not declare `tipCheck` keeps the old behavior: a stale-tip append silently starts a branch.

### Ownership scope

`AgentConfig.ownership` (`tenantId`, `accountId`, `userId`) scopes the sessions an agent may read and
write. It is narrow-only at three levels, one field at a time:

1. `AgentConfig.ownership` is the agent's declared scope.
2. `SessionOptions.ownership` narrows it for one session: it may add a field the agent left undefined or
   repeat the agent's value, but a field that changes it throws `OwnershipScopeError`
   (`code: "ERR_PRISM_OWNERSHIP_WIDEN"`).
3. `RunOptions.ownership` narrows the session's effective scope by the same rule; a conflict fails the run
   before any event.

The effective scope stamps every entry the session writes, so a resume by id fails closed across scopes.
Opening an existing session checks the whole branch against the session's effective scope, and every run and
resume re-checks the branch against the run's effective scope before the first write — a branch with any
entry outside it is `SessionNotFoundError` and writes nothing. `agent.sessions.list/get/delete/search`
apply the agent's scope to a query the same way, except a conflicting query field keeps the agent's value
instead of throwing: a filter is not an identity claim.

The session store is always the resolved `store` slot: a direct `slots.store`, a package's
`slots.store.provide`, or the kernel's in-memory default. The slot is resolved once per `session()`
call, never per run, and a slot conflict fails agent creation closed. `AgentConfig.store`,
`SessionOptions.store` and the per-session store constructors were removed with no alias; a
config that still carries `store` rejects with a `TypeError` naming `slots.store`.

### Handing a conversation to another agent

`selectTranscript(entries, options)` is the kernel's one way to cut a branch down to something another
agent, provider, or tool set can read. It accepts branch entries or live `Message[]`
(`RunEndPayload.history`), walks the branch the way `rebuildSessionContext` does (a compaction entry's
summary replaces what it covers), and keeps only messages and summaries: `package_state`, `custom`,
`event`, `suspended_run`, `metadata`, and `label` entries never travel.

```ts
const slice = selectTranscript(await session.entries(), { lastTurns: 6, maxChars: 24_000 });
// { summaries, pinned, messages, turns, omittedTurns, truncated }
```

- **Portable by construction.** Each message keeps its role (`user` or `assistant`) and text only. A tool
  call becomes `[tool_call <name> <JSON args, first 200 chars>]` in its assistant message; a tool result
  becomes `[tool_result <name>: <text, first maxToolChars chars (default 2,000)>]` in a user-role message.
  Thinking blocks, signatures, and provider metadata are dropped; images become `[image omitted]`.
  An assistant tool call with no result is dropped, so an in-flight call never reaches a consumer as an
  unmatched `tool_use`. Consecutive same-role messages merge.
- **Bounds.** Turns (a turn starts at a `user` message) are taken newest first: up to `lastTurns`, or all
  of them, until `maxChars` is reached. A newest turn that alone exceeds `maxChars` is cut from its oldest
  end and sets `truncated`. Summaries count toward `maxChars` and are cut last.
- **`pinned`** messages are rendered by the same rules and always included: charged against `maxChars`
  first and cut last, and a pinned message that also falls inside the selected turns is not repeated.

### When `session.opened` fires

`session.opened` fires once, as `agent.session()` resolves, so it is eager: `session()` awaits it,
a run does not. It is raised with `restored: false` for a new session and `restored: true` for a
resumed one. Package state is hydrated at the same point, so the first run or command sees it
without a store round trip. The event reaches hooks and `agent.subscribe()`; a session's own stream
still starts with the run's `run.started`. Opening eagerly (instead of at the first run) lets a
host observe a session the moment it exists, and makes a resume by an unknown or foreign id fail
at `session()` rather than at the first `run()`.

## Agent

`createAgent` resolves an `Agent` with these members (`config` stays the host's input, as a documented
kernel member):

| Member | Meaning |
| --- | --- |
| `id` | `AgentConfig.id`, then `name`, else an id generated for this agent. |
| `session(options?)` | See [Sessions](#sessions). |
| `sessions` | `list`, `get`, `delete`, `search` over the `store` slot's declared capabilities. |
| `commands` | `list()` and `run(name, args, { session })`. The command sees `session` as its owning package does. |
| `models` | `list()` and `resolve(ref)` over the registered providers. |
| `tools`, `skills` | Frozen `ToolInfo { name, description, effects, package }` and `SkillInfo { name, description, package }` lists. |
| `inspect()` | What loaded: packages, hooks in execution order, slot owners. Reads the same tool and skill view. |
| `subscribe(options?)` | Agent-scoped events until `dispose()`. |
| `reload()` | Re-assembles skills, packages, and hooks in place without replacing the agent or its open sessions. See [`reload()`](#reload). |
| `dispose()` | Aborts active runs, closes open sessions, then disposes packages in reverse load order and ends every `subscribe()` stream. See [dispose()](#dispose). |

### `reload()`

```ts
await agent.reload();           // live sessions keep their conversation
```

`reload()` re-reads `skills.dirs`, re-runs every loaded package's `setup` on a fresh hook bus and slot
registry, and re-compiles the inline `AgentConfig.hooks`. A package whose `setup` discovers a skill
directory (or re-reads a config file) picks up the edit, and a hook callback that reads host state is
compiled again. `agent.tools`, `agent.skills`, `agent.commands`, and `inspect()` reflect the swap; an
open session sees the new skills and hooks on its next run, because its `hooks()` lookup re-binds to the
new bus. An open session keeps the `store` instance it opened with; new sessions resolve the reloaded
slot.

The swap is atomic: a package whose `setup` throws (or a slot/model conflict) rejects `reload()` and
leaves the committed packages, hooks, slots, skills, and `agent.config` untouched. One reload runs at a
time; concurrent callers await the same attempt. A session with an active run makes `reload()` reject
(`Cannot reload while a session run is active`), because package teardown closes resources that run may
hold, and a run that starts during the swap rejects with `Agent is reloading; retry the run`. After
`dispose()` starts, `reload()` rejects with `AgentDisposedError`.

`SessionStart` hooks do not re-fire for sessions that were already open; use the run-scoped hooks
(`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) for changes that must affect the next turn.

### `dispose()`

```ts
await agent.dispose();          // aborts runs, closes sessions, then unwinds packages
await agent.session();          // throws AgentDisposedError (code "ERR_PRISM_AGENT_DISPOSED")
```

`dispose()` fails closed. It marks the agent disposed, aborts every active run with reason
`agent_disposed`, closes every open session (each `close()` settles background tasks within
`limits.backgroundSettleMs`, then aborts the rest), removes the kernel's hooks, disposes packages in
reverse load order, and closes agent subscribers. It is idempotent: a second call awaits the first, and a
later call is a no-op.

After it starts, `agent.session()` and `agent.commands.run()` throw `AgentDisposedError`, `tools` and
`skills` list nothing, and an active run ends as `run.failed` with `error.code: "agent_disposed"` (status
`aborted`). A loop that ignores its abort signal is still denied: `RunController.executeTools` returns a
denied result for every call once the run's signal has aborted, so no tool executes after `dispose()` begins.

### Session links

```ts
const child = await agent.session({
  parent: { sessionId: parent.id, workflowRunId: "wf-1", agentId: "planner", delegationId: "d-1" },
  actor: { kind: "external", agent: "driver", vendor: "acme" },
});
const page = await agent.sessions.list({ workflowRunId: "wf-1" });
```

`SessionOptions.parent` (`sessionId`, `agentId`, `workflowRunId`, `delegationId`) and `actor`
(`{ kind: "prism" | "external"; agent; vendor? }`) are written once, as the session's first `metadata`
entry (`data.links`), when a session is created. That is the only extra write, and it happens only when
either option is given. They are ignored when the session already exists, so reopening with a different
`parent` never rewrites the link. The entry is the source of truth: `fork` copies it, and SQL stores mirror
it into nullable indexed `prism_sessions` columns (migration `010_session_links`). Ids are opaque strings of
1 to `MAX_SESSION_LINK_ID_LENGTH` (256) characters; `actor` is set by the host and never derived.

A session opened with `parent.sessionId` also gets `depth` in its links: the open parent's depth plus one, or 1 when
the parent is not open in this agent. The kernel stamps it and drops a caller's value. A compaction keeps the links
entry pinned, so a resumed session reads its `depth` and `parentSessionId` (on `SessionContext`) from its branch
without walking its ancestors. Packages open linked children with `PackageAPI.sessions.open` ([Packages](packages.md),
"Child sessions").

`SessionSummary` gains `agentId`, `parentSessionId`, `workflowRunId`, `delegationId`, and `actor`.
`SessionListQuery` and `SessionSearchQuery` gain the matching exact-match filters: `agentId`,
`parentSessionId`, `workflowRunId`, `delegationId`, `actorKind`, `actorAgent`. A filter narrows the
ownership scope and never widens it. SQL stores answer a filtered list with an indexed query; the memory
and JSONL stores use the same capped linear scan as before. A session opened without links lists with the
fields absent.

`createSessionIndex(store, { ownership? })` returns the same `SessionIndex` over a bare store, with no
`Agent`, so a host can list and search sessions across agents. Ownership is enforced exactly as
`agent.sessions` enforces it, and a store without a capability rejects with
`UnsupportedStoreCapabilityError`. `storeConformance` runs a `session-links` leg against every store. Entry kinds are `message`, `event`, `summary`, `metadata`, `model_change`, `label`, `custom`, `compaction`, `suspended_run`, `run_checkpoint` (a turn checkpoint, see [Turn checkpoints](#turn-checkpoints-durability)), `session_limits` (persisted session-budget counters), `package_state`, and `external_state` (a driver loop's archive, see [loop.md](loop.md)); `storeConformance` runs an `external-state`, a `run-checkpoint`, and a `session-limits` leg. A store keeps an entry of a kind it does not know and returns it unchanged (the `unknown-entry-kind` leg); the session ignores it when it rebuilds messages ([compatibility.md](compatibility.md)).

### `agent.sessions`

The index asks the resolved store for what it declares, and every call applies the agent's `ownership`
scope. A caller-supplied scope on a query can narrow it, never widen it.

| Call | Store capability | Notes |
| --- | --- | --- |
| `list({ limit?, cursor?, order? })` | `listSessions` | A page of `SessionSummary` (`sessionId`, `leafId`, `createdAt`, `updatedAt`, `messageCount`, `title?`). It never loads entries or a transcript. |
| `get(id)` | none (the baseline `list`) | The summary, or `undefined` when absent or outside the scope. |
| `delete(id)` | `deleteSession` | Rejects with `SessionNotFoundError` when absent **or outside the scope**, the same answer for both. |
| `search(query)` | `searchSessions` | The store's search; the memory and JSONL stores implement it as a capped linear scan. |

A store that lacks a capability fails the call with `UnsupportedStoreCapabilityError`
(`code: "unsupported_store_capability"`, `capability` names the method). There is no fallback that scans every
session: on a database store that would be a hidden cost. The kernel memory store implements all of
`listSessions`, `deleteSession` and `searchSessions`. The JSONL, SQLite, Postgres and NATS stores and Prism
Code's store do not yet. The type formerly named
`SessionIndex` (the adapter search seam) is now `SessionSearchIndex`, since `SessionIndex` names this surface.

### `agent.models`

`list()` returns the models each registered provider declares through the optional
`ModelProvider.models()`, then the configured model if no provider declared it, so a provider without
discovery still lists the model it serves. Only public fields are returned: `parameters`, `compat`,
`metadata`, `options`, `baseUrl` and `credential` are dropped (they can carry endpoints, headers or a tenant
secret) and the agent's redactor masks the rest. `resolve(ref)` takes a `ModelRef` (a string or a
`ModelSpec`), returns `{ provider, model }` with `model` the parsed `ModelSpec`, and throws `ModelRefError`
(`model_ref_invalid`) on a malformed reference or `Unknown provider: <id>` when none is registered.

### `agent.tools` and `agent.skills`

The merged view after `disable`: the host's `tools.add` / `skills.add` plus every package's contribution.
The list is computed on first read and cached, and a disposed agent lists nothing. `effects` is the tool's
declared capability kinds, or all five for an unannotated tool. The kernel's own generated tools
(`load_skill`, `search_tools`) are per-run and are not listed.

### `agent.subscribe()`

Yields `package.status`, `background.started|completed|failed`, and `session.opened|closed` across every
session, until `dispose()`. Events are redacted with the agent's redactor. Each subscriber has its own bounded
queue under `SubscribeOptions.overflow` (default `coalesce`, bound 4,096; see
[Subscribers and backpressure](events.md#subscribers-and-backpressure)), and pushing never waits, so a slow or abandoned
subscriber cannot hold up a run. A `package.status` note raised during load predates any subscriber, so read
it from `inspect().statusNotes`.

## Session

`agent.session()` resolves a `Session` (the type is `Session`; `AgentSession` was renamed, with no alias).

| Member | Meaning |
| --- | --- |
| `id` | The session id. |
| `run(input, options?)` | Runs one turn loop and resolves its result. |
| `stream(input, options?)` | Subscribes first, starts exactly one run, and yields only that run's events. `options` also takes `SubscribeOptions` (`maxQueuedEvents`, default 4,096; `overflow`, default `coalesce`). Stopping the loop aborts the run. An overflow throws `SubscriberOverflowError` and does **not** abort it: the run settles on its own, its messages are in `messages()` and its terminal event reaches any `acrossRuns` subscriber. |
| `steer(input, options?)` | Queues user text into the active run. Fails closed with no active run, or when the queue passes `DEFAULT_MAX_PENDING_STEERS` messages or `DEFAULT_MAX_PENDING_STEER_BYTES` bytes. `{ softInterrupt: true }` aborts the in-flight provider stream, then continues the same run. |
| `abort(reason?)` | Aborts the active run. |
| `messages()` | The stored messages of the current branch, after `message.append`. It is never the `context.build` draft a provider saw. It reads the branch snapshot cache, so a warm session adds no store read, and it returns a copy. |
| `fork({ at? })` | Copies the branch that ends at entry `at` (default: the current leaf) into a **new** session and resolves that session opened. Package state comes with it, because it is entries on the branch; a pending `suspended_run` entry does not, since that run belongs to the original. The original is untouched. `at` outside the session's own tree rejects. |
| `compact(options?)` | Compacts the branch now. |
| `resume(decisions, options?)` | Continues this session's suspended run and yields its events. See [RunResult and session.resume](#runresult-and-sessionresume). |
| `continue(options?)` / `continueStream(options?)` | Starts a run with no new input on a branch that stopped partway (a crash, a provider failure, a limit, an abort). See [Continuing a run](#continuing-a-run). |
| `limits()` | Returns `{ limits, counters, remaining, exhausted, breach? }` for the session's cross-run budget. |
| `close()` | Closes subscribers and settles background tasks; a second call is a no-op. |

### Kernel members kept beyond the core

These members stay because a host in this repo reads them:

| Member | Why it stays | Used by |
| --- | --- | --- |
| `entries()` | The raw branch, for hosts that project or render the transcript — messages plus the `package_state` entries a package's `state.log` appended and the `external_state` entries a driver loop's `run.state(key)` archived. `messages()` derives from the same snapshot. | Prism Agent, AG-UI, observational memory |
| `checkout(leafId?)` | Re-points a live session at another leaf of its own branch tree. | host branching UIs, `@arnilo/prism-memory-system` (long-term memory), the RPC `checkout` command |
| `contextMeter()` | The context-fill read. | Prism Agent's status line |
| `subscribe(options?)` | A session's live events, run-scoped or `acrossRuns`. | Prism Agent headless, AG-UI |
| `leafId` | The current leaf; advances on every append. | `checkout`, `fork({ at })`, durable handles |
| `getLoadedSkillNames()` / `restoreLoadedSkills()` | Durable resume restores progressive skills. | Task 4 reworks this with `resume` |

Deleted: `prompt` (a bare alias for `run`), `clone`, and `fork({ leafId })` (the old `fork` shared the
session id; `fork({ at })` is the copy that `clone` was). `AgentSessionForkOptions` and
`AgentSessionCloneOptions` became `SessionForkOptions { at? }`.

```ts
const s = await agent.session();
await s.run("hello");
const branch = await s.fork(); // a new session: copies messages and package state (each copy names its source id)
console.log((await branch.messages()).length);
```

## RunResult and session.resume

`session.run` resolves to a `RunResult`. A run that fails or is aborted after it started **returns** its
result; it does not throw. `run` rejects only when it cannot start a run at all (an active run on the
session, an invalid option).

| Field | Meaning |
| --- | --- |
| `status` | `completed`, `stopped`, `suspended`, `failed`, or `aborted`. |
| `stopReason?` | Why a `stopped` run stopped: `turn_limit`, `token_limit`, `refusal`, `hook_stop` (a `turn.before` stop), `hook_limit` (a `run.end` continuation cap), or `denied`. |
| `stopDetail?` | The bounded, redacted reason a `turn.before` handler gave. |
| `pending?` | Present when `suspended`: the unresolved decisions to pass to `session.resume`. Redacted; never the raw arguments. |
| `messages` | The messages this run appended to the branch, as stored (after `message.append`). |
| `usage?`, `error?` | Aggregate usage; the redacted error of a failed run. `error.owner` and `error.hook` name the handler when a hook threw. |
| `limit?`, `attribution?`, `abortReason?` | Kernel extras kept for hosts: the breached ceiling and its attribution; the abort reason. |
| `sessionId`, `runId`, `leafId?`, `text`, `content`, `message?` | Kernel extras kept for hosts: ids, and the final assistant message. |
| `output?`, `outputError?` | Only when the run asked for `providerOptions.structuredOutput` and succeeded (`completed` or `stopped`). The final reply's text, with one surrounding fenced code block tolerated, is parsed as JSON and checked against the schema in the tolerant mode that tool arguments use (keywords outside the kernel subset are ignored). A passing reply sets `output`. Otherwise `outputError` is `{ code: "invalid_json" \| "schema_mismatch", errors: [{ path, message }] }`, at most 8 entries, naming JSON pointer paths and expected shapes, never reply content. `status` and `text` are unchanged either way. |

The statuses replace the 0.12 `succeeded | failed | aborted | suspended | denied`: a bare `succeeded` is
`completed`, a `succeeded` with a finish reason is `stopped`, and `denied` is `stopped` with
`stopReason: "denied"`. `AgentRunError` is deleted. The persisted run-state and ledger vocabulary
(`AgentRunStatus`) is unchanged.

An `ask` that no `HostUi` answers suspends the run. The kernel writes one `suspended_run` entry through the
`store` slot (as the branch tip) and returns `status: "suspended"` with `pending`. No host store is
required. Resume with one `Decision` per pending request:

```ts
const result = await session.run("delete the temp dir");
if (result.status === "suspended") {
  // later, maybe in another process over the same store
  const again = await agent.session({ id: session.id });
  const decisions = result.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" as const }));
  for await (const event of again.resume(decisions)) render(event);
}
```

`session.resume(decisions, options?)` returns the event stream. It first yields `decision.resolved` (one
event listing every decision, keyed by tool call id), then the resumed run from
`run.started { resumed: true }`. It fails closed, before any event or tool call, with:

- no pending suspension on the branch. A suspension is pending only while its entry is the branch tip, so
  it resumes once; a later run or the resumed run's own messages end it (`ERR_PRISM_DECISION_STALE`);
- an unknown, duplicate, or missing decision id, or an empty batch (`ERR_PRISM_DECISION_*`). Unknown and
  foreign ids share one non-enumerating error;
- a `modifiedArguments` rewrite that fails the tool's schema, so a decision can
  not widen the original call;
- a drifted agent: the fingerprint covers the model, tools, skills, instructions, hook ids and the loop
  name and revision, and a mismatch is `Agent definition revision or fingerprint mismatch on resume`.

Every resumed call is re-gated: `tool.call` runs again on the arguments that will execute (including a
`modifiedArguments` rewrite), then `tool.execute` and `tool.result`, then the transcript append — the same
pipeline a fresh turn uses, so a `deny` on the final arguments holds and the tool never runs. The decision
that answered an `ask` satisfies it again only for exactly the call it approved (tool name and arguments);
a gate that rewrites the call to different arguments is staged as a new pending decision and the run
suspends rather than prompting a host that already answered.

### Nested pending decisions

A tool that runs a child (see [Tools that run a child](tools.md#tools-that-run-a-child)) can suspend the
parent run with the child's decisions. Each such entry of `pending` carries:

- `approvalId`: a root-visible id, `sub_<sha256>`, derived from the child's run id and its own approval
  id. Pass this id to `session.resume`; the child's own id is unknown to the parent and fails closed.
- `attribution.path`: root first, two entries per level: the hosting tool call id, then the child's
  session id (its run id when it has none). A grandchild's decision names both levels. A path over
  `MAX_ATTRIBUTION_DEPTH` (8 entries, four levels) fails the run with `ERR_PRISM_DECISION_LIMIT`.
- `scope` and `reason` as the child recorded them: hashes and names, never arguments.

`session.resume(decisions)` on the parent routes each decision only to the child it was raised for, by
the ids recorded at suspension, and calls the hosting tool's `resumeNested` with the child's own ids. The
call then settles with the tool's outcome and the parent continues, or the child suspended again and the
parent suspends again. A nested call that settles is never re-executed. `modifiedArguments` and
elicitation payloads on a nested decision are only bounded here (16 KiB); the child's own resume
validates them against its tools. An `allow_for_run` / `reject_for_run` on a nested decision answers later
asks from the same child with the same scope without a prompt, at most `MAX_NESTED_STICKY_RESUMES` (4)
times in a row before the next ask reaches the host. Several children that suspend in one round surface
as one parent suspension.

Cost: a suspension is one extra entry write plus one bounded, redacted state value. A resume is one branch
read. A run that never suspends writes nothing extra. The suspension is the durable unit: the
`store` slot's entry carries the whole redacted state, so a durable session store is all a host needs
across processes — the 0.12 per-run durable-run configuration and its `every-turn` crash-recovery cadence
are gone, and `@arnilo/prism-extensions/workflows` owns the checkpoints service for the engine.

## Continuing a run

A run can stop partway without suspending: the process dies, the provider fails, a limit or a
`turn.before` stop ends it, or the host aborts it. The branch then holds the work so far and ends in a
user message, tool results, or an assistant message whose tool calls have no results. The branch
"owes a model turn". `session.continue(options?)` picks it up with no new input. `continueStream(options?)`
is its streaming form, as `stream` is of `run`.

```ts
const session = await agent.session({ id }); // after a restart, over the same store
const result = await session.continue({ limits: { maxTurns: 20 } });
```

Before any event or write it fails closed with:

- `SessionContinueError` (`code: "nothing_to_continue"`) when the branch is empty or ends in a completed
  assistant reply. Use `run(input)` for a new turn;
- `AgentDecisionError` when a suspension is pending. Use `resume(decisions)`;
- `SessionNotFoundError` when the branch is outside the run's ownership scope, as for `run`.

Before the first turn, each tool call at the tip with no result gets one, appended to the branch:

| Effect record of the call (from `AgentConfig.effectStore`, by the run that issued it) | Result |
| --- | --- |
| none, no effect store, or no ownership scope | `tool_call_interrupted` |
| `completed` with a stored result | that result |
| `dispatched` (moved to `unknown`) or `unknown` | `tool_call_outcome_unknown`: the tool ran but its outcome was never recorded; verify before repeating |
| `failed_retryable` / `failed_terminal` | the stored failure code |

No tool is dispatched again. The model reads the results and decides what to redo. By default the
continuation is a new run with a new id and fresh limit counters. It fires `run.input` with an empty list,
`run.started { continued: true }`, and every hook a `run` fires, with the same ownership, principal and
active-run checks. The ledger records it as a run of its own.

Cost: one branch read, plus one append per unanswered call.

### Turn checkpoints (`durability`)

`AgentConfig.durability` decides when the kernel writes durable run state to the branch:

| Value | Writes | `continue()` |
| --- | --- | --- |
| `"suspension"` (default) | nothing extra; durable state only when a run suspends for an approval | a new run id and fresh counters |
| `"turn"` | one `run_checkpoint` entry after each completed tool round | the interrupted run continues under its own id, limit counters, wall deadline, tool grant and loop state |

```ts
const agent = await createAgent({ model, durability: "turn" });
```

A checkpoint is a running `StoredAgentRunState` that holds the run id, the counters, `deadlineAt`, the
run's tool grant, and the loop's name, revision and snapshot. It holds no messages, input, pending calls,
decisions or skill bodies. It is redacted and capped at 256 KiB like a suspension; a larger one (in
practice a large loop snapshot) fails the run before its next turn, as does a failed checkpoint append.
A round that staged an approval writes the `suspended_run` entry instead.

`continue()` restores the newest checkpoint only when it belongs to the run that wrote the branch's
newest message and to this session (a `fork()` copies checkpoints but starts fresh). The restore is a
durable resume, so it fails closed like `resume`:

- `AgentRunStateError` when the agent's fingerprint (model, instructions, tools, hooks, loop) changed;
- `ERR_PRISM_LOOP_REVISION` when the loop name or revision changed;
- `RunOptions.model` and `RunOptions.effectStore` are rejected; set them on `AgentConfig`.

`run.started` carries both `resumed: true` and `continued: true`, and turn numbering restarts at 1 while
the counters do not. With `"turn"`, a custom `LoopStrategy` must declare `state: "run"` (its
`run.checkpoint` value is stored, see [loop.md](loop.md#loop-state)) or define `snapshot` and `restore`; a run
on one that does neither fails at start with `ERR_PRISM_LOOP_NOT_DURABLE`. Checkpoints never reach
`messages()` or provider input, and a compaction keeps the newest one readable from the branch tail.

Cost: one extra store append per tool round with `"turn"`; none with the default.

## Errors and security

### Config shape errors

`createAgent` checks the config's shape before any package loads, so a bad config has no side
effect. An unknown top-level key throws a `TypeError` naming the key and, when one is within two
edits, the nearest known key (`AgentConfig has unknown key "tool"; did you mean "tools"?`). A known
key of the wrong shape throws a `TypeError` naming the key and the expected shape
(`AgentConfig.tools must be an object ({ add?: ToolDefinition[], … }); received an array`). Every
`tools.add` entry needs a string `name` and a function `execute`, and every `skills.add` entry a string
`name`. `limits`, `usageEstimation`, `tools.concurrency`, `retry`, and `compaction.trigger` are checked
here too, not first at a run or a close. The nested `tools`, `skills`, `disable`, and `limits` objects
reject unknown keys as well. A key whose value is `undefined` is ignored.

`session.run()` checks `RunOptions` the same way, and `agent.session()` checks `SessionOptions`.
`session.stream()` and `session.resume()` also accept the `SubscribeOptions` keys (`acrossRuns`,
`maxQueuedEvents`, `overflow`). The run validator is `RunOptions.validate`, the agent one
`AgentConfig.validator`; using the other name gets the hint. Messages name keys and shapes, never
values.

### Identity and effects

An opaque principal is **not proof of identity**. The kernel names only `Principal`
(`kind` / `id` / `displayName`) and never synthesizes or verifies one. `@arnilo/prism-extensions/governance`
verifies the session principal before each run when `identity` is configured, and denies a tool call
whose verified identity expired or lacks a required scope.

Durable `ToolEffectKey` inputs require bounded ownership, not identity. Keys and memory-store
partitions include tenant, account, and user, preserving isolation without inferring ownership
from principal. Required effects still fail before execution when ownership or the effect store
is missing; claim/CAS, unknown-outcome reconciliation, and byte caps are unchanged.

The PostgreSQL adapter retains its existing `principal_id` column with a fixed empty partition. Empty cannot match a valid legacy principal id. Before inserting, it rejects a matching legacy identity-scoped call.
Do not run old and new effect-store writers concurrently. Stop old workers and reconcile outstanding
legacy effects before resuming affected runs; do not delete uncertain claims to bypass the guard.

MCP Apps with an effect store require an explicit verified `effectContext`; an opaque tool principal
cannot replace verification. Forge, channel, supervisor, and MCP hosts retain their own identity
checks outside the kernel.

## Extension notes

`Principal` is the only identity type the kernel exports. Verified-identity types and helpers live in
`@arnilo/prism-extensions/governance`. No second principal type, identity alias, or automatic ownership projection
is introduced.

## Frozen surface

A host and a package author import everything from `@arnilo/prism`, and the member names
below are pinned by `src/__tests__/agent-surface-freeze.test.ts`. Changing one is a deliberate edit to that test and
to this page, in the same change.

```ts
import { createAgent, definePackage, type Session, type HostUi, type AgentEvent } from "@arnilo/prism";
import { createMockProvider, packageConformance, loopConformance, createScriptedHostUi } from "@arnilo/prism/testing";
```

**Host API (roadmap §2.3):** `createAgent`, `AgentConfig`, `Agent`, `AgentInspection`, `Session`, `SessionOptions`, `RunOptions`,
`RunResult`, `Decision`, `PendingDecision`, `HostPort`, `HostUi`, `HostUiRequest`, `HostUiResponse`, `AgentEvent`,
`Principal`, `RunLimits`, `ToolInfo`, `SkillInfo`, `SessionIndex`, `ModelIndex`. The roadmap's `UiRequest` and
`UiResponse` ship as `HostUiRequest` and `HostUiResponse`; `Limits` ships as `RunLimits`.

**Loop primitives (§2.5):** `LoopStrategy`, `RunController`.

**Package authoring (§2.6):** `definePackage`, `PackageAPI`, `SessionContext`, `ToolDefinition`, `Skill`.

**Test helpers:** `@arnilo/prism/testing` exports `createMockProvider`, `packageConformance`, `loopConformance`,
`storeConformance` and `createScriptedHostUi`. The per-suite subpaths stay until their owning phases consolidate them.

Pinned member names:

| Type | Members |
| --- | --- |
| `Agent` | `id`, `config`, `commands`, `tools`, `skills`, `sessions`, `models`, `session`, `reload`, `subscribe`, `dispose`, `inspect` |
| `AgentInspection` | `packages`, `tools`, `skills`, `commands`, `hooks`, `slots`, `store`, `disabled`, `statusNotes` |
| `Session` | `id`, `run`, `stream`, `steer`, `abort`, `resume`, `continue`, `continueStream`, `messages`, `fork`, `compact`, `limits`, `close`, plus the kernel members `leafId`, `entries`, `checkout`, `contextMeter`, `subscribe`, `getLoadedSkillNames`, `restoreLoadedSkills` |
| `RunResult` | `sessionId`, `runId`, `status`, `leafId`, `text`, `content`, `message`, `messages`, `usage`, `limit`, `attribution`, `error`, `abortReason`, `stopReason`, `stopDetail`, `pending`, `runState`, `output`, `outputError` |
| `RunOptions` | the per-run overrides (`signal`, `model`, `limits`, `metadata`, `tools`, `principal`, `skills`, `chargeTo`, …); the test lists all 23 |
| `HostUi` | `request` |
| `HostPort` | `ui`, `log` |

The freeze test also asserts that no test seam reaches the root: `createAgentWith`, `CreateAgentInternals`, and
the agent-runtime registry stay internal.

## Related

- [Driver kit](drivers.md): how an external-agent package fills the loop slot, claims the profile, and gates its
  vendor's calls through `run.ask`, with the run's session and suspension rules.
