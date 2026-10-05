# Agent configuration

## What it does

`createAgent(config)` creates an agent with a model, optional packages, hooks, slots, and host ports.
The kernel enforces limits, redaction, and fail-closed loading. Packages own identity verification
and policy enforcement.

## When to use it

Create one agent per configured model/tool/package composition, then create sessions for conversations.
This staged page covers the Phase 3 principal contract; later tasks add the remaining agent surface.

## Inputs

| Field | Meaning |
| --- | --- |
| `model: ModelRef` | `"provider/model"` (split on the first `/`) or a `ModelSpec`. Parsed once by `createAgent`; `agent.config.model` is the parsed `ModelSpec`. See [models.md](models.md). |
| `principal?: Principal` | Optional opaque host principal (`kind`, `id`, `displayName?`). No default identity is created. |
| `tools?: { add?: readonly ToolDefinition[] }` | Host tools. A duplicate name (including the kernel's `load_skill`/`search_tools`) fails the run closed. |
| `skills?: { dirs?; add?; disclosure? }` | Host skills. `dirs` reads through the same reader as `PackageAPI.skills.addDir`; `disclosure` defaults to `progressive`. |
| `packages` | Explicit package instances; installed packages are not automatically loaded. |
| `hooks` | Host registrations on the agent's hook bus. |
| `host` | Optional host ports, including `HostUi`. |
| `slots` | Direct assignments for loop, compaction, store, and credentials. |
| `limits` | Hard floor; a run may only narrow it. |
| `ownership` | Persistence scope retained until Phase 6. Independent of principal; never inferred from it. |

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

- [`examples/session.ts`](../../examples/session.ts): open a session, stream a run, read the `RunResult`
  and the messages it appended, reopen the session by id, and list it with `agent.sessions`.
- [`examples/approval.ts`](../../examples/approval.ts): a tool gated by `tool.call` → `{ ask }`, resolved
  inline by a scripted `HostUi`, then suspended with no UI and resumed by a new agent over the same store with
  `session.resume(decisions)`.
- [`examples/host-hooks.ts`](../../examples/host-hooks.ts): the host as an inline package: a `tool.call` deny
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
| `id` owned by another scope | Rejects with the same `SessionNotFoundError`. When `AgentConfig.ownership` is set, every entry on the branch must carry that scope, so a shared store never reveals another tenant's session or its metadata. |

The session store is always the resolved `store` slot: a direct `slots.store`, a package's
`slots.store.provide`, or the kernel's in-memory default. The slot is resolved once per `session()`
call, never per run, and a slot conflict fails agent creation closed. `AgentConfig.store`,
`SessionOptions.store`, `agent.createSession`, and `createAgentSession` were removed with no alias; a
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
kernel member through Phase 11):

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
| `dispose()` | Disposes packages in reverse load order and ends every `subscribe()` stream. |

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
Code's store do not yet; Phase 6 adds `listSessions` and `deleteSession` to them. The type formerly named
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

### Kernel members kept beyond the sketch

The roadmap sketch lists nine members. These stay because a host in this repo reads them, and Phase 11's
export review decides their future:

| Member | Why it stays | Used by |
| --- | --- | --- |
| `entries()` | The raw branch, for hosts that project or render the transcript. `messages()` derives from the same snapshot. | Prism Code, AG-UI, observational memory |
| `checkout(leafId?)` | Re-points a live session at another leaf of its own branch tree. | Prism Code branching, `@arnilo/prism-memory`, the RPC `checkout` command |
| `contextMeter()` | The context-fill read. | Prism Code's status line |
| `subscribe(options?)` | A session's live events, run-scoped or `acrossRuns`. | Prism Code headless, AG-UI |
| `leafId` | The current leaf; advances on every append. | `checkout`, `fork({ at })`, durable handles |
| `guardrailPackRefs` | The pack refs this session enforces. | Phase 9 |
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
| `runState?` | The bounded durable state, when a host configured `runState` checkpoints. |

The statuses replace the 0.12 `succeeded | failed | aborted | suspended | denied`: a bare `succeeded` is
`completed`, a `succeeded` with a finish reason is `stopped`, and `denied` is `stopped` with
`stopReason: "denied"`. `AgentRunError` is deleted. The persisted checkpoint and ledger vocabulary
(`AgentRunStatus`) is unchanged.

An `ask` that no `HostUi` answers suspends the run. The kernel writes one `suspended_run` entry through the
`store` slot (as the branch tip) and returns `status: "suspended"` with `pending`. No `runState` or
`CheckpointStore` is required. Resume with one `Decision` per pending request:

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
- a `modifiedArguments` rewrite that fails the tool's schema or a guardrail pack rule, so a decision can
  not widen the original call;
- a drifted agent: the fingerprint covers the model, tools, skills, instructions, hook ids and the loop
  name and revision, and a mismatch is `Agent definition revision or fingerprint mismatch on resume`.

Cost: a suspension is one extra entry write plus one bounded, redacted state value. A resume is one branch
read. A run that never suspends writes no checkpoint. `RunOptions.checkpointPolicy: "every-turn"` and a
host `runState` checkpoint store remain opt-in 0.12 features: with one configured, a resume claims through
that store's version, so pass the same `runState` on `resume` as the run used.

## Errors and security

An opaque principal is **not proof of identity**. A governance package must verify the caller and
check permissions before permitting effects. `createSecureAgent` remains an opt-in governance
helper until Phase 9: it validates `SecureAgentOptions.identity` at creation and forwards the
verified identity's `principal` object. Kernel runs perform no later expiry/revocation check;
packages requiring those guarantees must check at each protected operation.

Durable `ToolEffectKey` inputs require bounded ownership, not identity. Keys and memory-store
partitions include tenant, account, and user, preserving isolation without inferring ownership
from principal. Required effects still fail before execution when ownership or the effect store
is missing; claim/CAS, unknown-outcome reconciliation, and byte caps are unchanged.

The PostgreSQL adapter retains its existing `principal_id` column with a fixed empty partition
until Phase 6. Empty cannot match a valid legacy principal id. Before inserting, it rejects a matching legacy identity-scoped call.
Do not run old and new effect-store writers concurrently. Stop old workers and reconcile outstanding
legacy effects before resuming affected runs; do not delete uncertain claims to bypass the guard.

MCP Apps with an effect store require an explicit verified `effectContext`; an opaque tool principal
cannot replace verification. Forge, channel, supervisor, and MCP hosts retain their own identity
checks outside the kernel.

## Extension notes

Identity types and opt-in governance helpers remain exported for existing packages until Phase 9.
No second principal type, identity alias, or automatic ownership projection is introduced.

## Frozen for Phase 4

Phase 3 ends here. A host and a package author import everything from `@arnilo/prism`, and the member names
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

**Package authoring (§2.6):** `definePackage`, `PackageAPI`, `SessionContext`, `ToolDefinition`, `Skill`,
`CommandDefinition`.

**Test helpers:** `@arnilo/prism/testing` exports `createMockProvider`, `packageConformance`, `loopConformance`,
`storeConformance` and `createScriptedHostUi`. The per-suite subpaths stay until their owning phases consolidate them.

Pinned member names:

| Type | Members |
| --- | --- |
| `Agent` | `id`, `config`, `commands`, `tools`, `skills`, `sessions`, `models`, `session`, `subscribe`, `dispose`, `inspect` |
| `AgentInspection` | `packages`, `tools`, `skills`, `commands`, `hooks`, `slots`, `store`, `disabled`, `statusNotes` |
| `Session` | `id`, `run`, `stream`, `steer`, `abort`, `resume`, `messages`, `fork`, `compact`, `close`, plus the kernel members `leafId`, `guardrailPackRefs`, `entries`, `checkout`, `contextMeter`, `subscribe`, `getLoadedSkillNames`, `restoreLoadedSkills` |
| `RunResult` | `sessionId`, `runId`, `status`, `leafId`, `text`, `content`, `message`, `messages`, `usage`, `limit`, `attribution`, `error`, `abortReason`, `stopReason`, `stopDetail`, `pending`, `runState` |
| `RunOptions` | the 0.12 per-run overrides still carried until Phase 11's export review (`signal`, `model`, `limits`, `metadata`, `tools`, `principal`, `runState`, …); the test lists all 27 |
| `HostUi` | `request` |
| `HostPort` | `ui`, `log` |

The freeze test also asserts that no test seam reaches the root: `createAgentWith`, `CreateAgentInternals`, and
the agent-runtime registry stay internal.

### The agent SDK

`@arnilo/prism-agent-sdk` is frozen: it receives no features, and its host-contract re-exports follow the
kernel types above. It stays in the workspace because Prism Code assembles through `defineAgent` until Phase 12.
Its kernel-behavior tests (the skills catalog and `load_skill`, the loop slot, the principal, the in-memory store
default, `run.end` hooks) moved to `src/__tests__/agent-sdk-kernel-behavior.test.ts`; its plane tests stay with
it. The npm deprecation is Phase 11, and the package is deleted after Phase 12 removes the last caller.
