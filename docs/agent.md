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
| `skills?: { dirs?; add?; disclosure? }` | Host skills. `dirs` reads through the same reader as `PackageAPI.skills.addDir`; `disclosure` defaults to `progressive`. |
| `packages` | Explicit package instances; installed packages are not automatically loaded. |
| `hooks` | Host registrations on the agent's hook bus. |
| `host` | Optional host ports, including `HostUi`. |
| `slots` | Direct assignments for loop, compaction, store, and credentials. |
| `limits` | Hard floor; a run may only narrow it. |
| `ownership` | Persistence scope. Independent of principal; never inferred from it. Narrow-only at agent → session → run (see [Ownership scope](#ownership-scope)). |

### Tools and skills

Every configured skill is active (roadmap §2.3 has no per-run skill narrowing). Progressive
disclosure renders a name+description catalog and registers `load_skill`; `eager` renders every
body each turn and registers no `load_skill`. The catalog is a named `kernel:context.build`
registration: `inspect().hooks` lists it, and `disable.hooks: ["kernel:context.build"]` removes it.

`RunOptions.tools.only` narrows the tool set for one run; an unknown name fails closed, and a
durable resume intersects the list with the checkpointed grant (the stored wire field keeps the
name `toolNames`).

`AgentConfig.limits` is the floor and `RunOptions.limits` only narrows each axis (`min`).
`backgroundSettleMs` is agent-wide only: a per-run value is ignored, because a session outlives a
run.

The kernel owns no context-engineering stage. Input budgeting, tool-result folding, tool search, and
the attention compiler are one package, `@arnilo/prism-context-engineering`, which registers a single
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
| `dispose()` | Aborts active runs, closes open sessions, then disposes packages in reverse load order and ends every `subscribe()` stream. See [dispose()](#dispose). |

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

`SessionSummary` gains `agentId`, `parentSessionId`, `workflowRunId`, `delegationId`, and `actor`.
`SessionListQuery` and `SessionSearchQuery` gain the matching exact-match filters: `agentId`,
`parentSessionId`, `workflowRunId`, `delegationId`, `actorKind`, `actorAgent`. A filter narrows the
ownership scope and never widens it. SQL stores answer a filtered list with an indexed query; the memory
and JSONL stores use the same capped linear scan as before. A session opened without links lists with the
fields absent.

`createSessionIndex(store, { ownership? })` returns the same `SessionIndex` over a bare store, with no
`Agent`, so a host can list and search sessions across agents. Ownership is enforced exactly as
`agent.sessions` enforces it, and a store without a capability rejects with
`UnsupportedStoreCapabilityError`. `storeConformance` runs a `session-links` leg against every store. Entry kinds are `message`, `event`, `summary`, `metadata`, `model_change`, `label`, `custom`, `compaction`, `suspended_run`, `package_state`, and `external_state` (a driver loop's archive, see [loop.md](loop.md)); a store rejects an unknown kind, and `storeConformance` runs an `external-state` leg.

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
queue under `SubscribeOptions.overflow` (default `close`), and pushing never waits, so a slow or abandoned
subscriber cannot hold up a run. A `package.status` note raised during load predates any subscriber, so read
it from `inspect().statusNotes`.

## Session

`agent.session()` resolves a `Session` (the type is `Session`; `AgentSession` was renamed, with no alias).

| Member | Meaning |
| --- | --- |
| `id` | The session id. |
| `run(input, options?)` | Runs one turn loop and resolves its result. |
| `stream(input, options?)` | Subscribes first, starts exactly one run, and yields only that run's events. |
| `steer(input, options?)` | Queues user text into the active run. Fails closed with no active run, or when the queue passes `DEFAULT_MAX_PENDING_STEERS` messages or `DEFAULT_MAX_PENDING_STEER_BYTES` bytes. `{ softInterrupt: true }` aborts the in-flight provider stream, then continues the same run. |
| `abort(reason?)` | Aborts the active run. |
| `messages()` | The stored messages of the current branch, after `message.append`. It is never the `context.build` draft a provider saw. It reads the branch snapshot cache, so a warm session adds no store read, and it returns a copy. |
| `fork({ at? })` | Copies the branch that ends at entry `at` (default: the current leaf) into a **new** session and resolves that session opened. Package state comes with it, because it is entries on the branch; a pending `suspended_run` entry does not, since that run belongs to the original. The original is untouched. `at` outside the session's own tree rejects. |
| `compact(options?)` | Compacts the branch now. |
| `resume(decisions, options?)` | Continues this session's suspended run and yields its events. See [RunResult and session.resume](#runresult-and-sessionresume). |
| `close()` | Closes subscribers and settles background tasks; a second call is a no-op. |

### Kernel members kept beyond the core

These members stay because a host in this repo reads them:

| Member | Why it stays | Used by |
| --- | --- | --- |
| `entries()` | The raw branch, for hosts that project or render the transcript — messages plus the `package_state` entries a package's `state.log` appended and the `external_state` entries a driver loop's `run.state(key)` archived. `messages()` derives from the same snapshot. | Prism Agent, AG-UI, observational memory |
| `checkout(leafId?)` | Re-points a live session at another leaf of its own branch tree. | host branching UIs, `@arnilo/prism-memory-fabric`, the RPC `checkout` command |
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
const branch = await s.fork(); // a new session: copies messages and package state
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

Cost: a suspension is one extra entry write plus one bounded, redacted state value. A resume is one branch
read. A run that never suspends writes nothing extra. The suspension is the durable unit: the
`store` slot's entry carries the whole redacted state, so a durable session store is all a host needs
across processes — the 0.12 per-run durable-run configuration and its `every-turn` crash-recovery cadence
are gone, and `@arnilo/prism-workflows` owns the checkpoints service for the engine.

## Errors and security

An opaque principal is **not proof of identity**. The kernel names only `Principal`
(`kind` / `id` / `displayName`) and never synthesizes or verifies one. `@arnilo/prism-governance`
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
`@arnilo/prism-governance`. No second principal type, identity alias, or automatic ownership projection
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
| `Agent` | `id`, `config`, `commands`, `tools`, `skills`, `sessions`, `models`, `session`, `subscribe`, `dispose`, `inspect` |
| `AgentInspection` | `packages`, `tools`, `skills`, `commands`, `hooks`, `slots`, `store`, `disabled`, `statusNotes` |
| `Session` | `id`, `run`, `stream`, `steer`, `abort`, `resume`, `messages`, `fork`, `compact`, `close`, plus the kernel members `leafId`, `entries`, `checkout`, `contextMeter`, `subscribe`, `getLoadedSkillNames`, `restoreLoadedSkills` |
| `RunResult` | `sessionId`, `runId`, `status`, `leafId`, `text`, `content`, `message`, `messages`, `usage`, `limit`, `attribution`, `error`, `abortReason`, `stopReason`, `stopDetail`, `pending`, `runState` |
| `RunOptions` | the per-run overrides (`signal`, `model`, `limits`, `metadata`, `tools`, `principal`, …); the test lists all 26 |
| `HostUi` | `request` |
| `HostPort` | `ui`, `log` |

The freeze test also asserts that no test seam reaches the root: `createAgentWith`, `CreateAgentInternals`, and
the agent-runtime registry stay internal.

## Related

- [Driver kit](drivers.md): how an external-agent package fills the loop slot, claims the profile, and gates its
  vendor's calls through `run.ask`, with the run's session and suspension rules.
