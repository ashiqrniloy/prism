# Observational memory compaction package

## What it does

`@arnilo/prism-memory/compaction/observational-memory` is an optional subpath for source-backed observational memory and fast compaction.

Current status: ledger/projection/render/recall utilities, optional work-scope indexing, explicit worker runtime, fast compaction strategy, inert extension helper, recall tool, and status/view command factories are available.

This package is distinct from `@arnilo/prism-memory` working/semantic memory: observational memory compresses and recalls source-backed observations/reflections; semantic memory retrieves embeddings; working memory stores the current structured profile/state. Hosts may compose both.

This page's memory stays **episodic**: the ledger records what happened in a session, its observer/reflector/dropper workers are the only writers of observations and reflections, and nothing downstream re-observes the transcript. Typed notes that want to outlive the session (facts, procedures, file references) are a separate layer — the [memory fabric](memory-fabric.md) — which views an observation by id as an `episode` note without copying it, never wraps or replaces these workers, and keeps its own recall path. Promotion out of the ledger is an explicit host write, not a side effect of compaction.

## Four-layer provider context

Observational memory composes four independent layers for long sessions (Mastra-style):

| Layer | What it holds | How it is produced |
| --- | --- | --- |
| **Recent exact messages** | Last `context.recentMessages` user/assistant/tool entries in branch order (optional `recentMessageMaxTokens` trim, oldest first) | `buildObservationalMemoryContextBlocks()` → `recent-messages` ContextBlock; aligned with compaction `keepRecentEntries` |
| **Observation log** | Source-backed facts with 12-hex ids and `sourceEntryIds` | Observer worker on eligible unscanned `message` entries after `observation.messageTokens`; coverage advances even on empty passes |
| **Reflections** | Higher-level summaries over observation ids | Reflector worker on observations after last reflection coverage when `reflection.observationTokens` met |
| **Raw-source retrieval** | Exact branch messages behind a memory id or cursor page | `recallObservationalMemory()` / `recallObservationalMemoryBranchPage()` / `createRecallMemoryTool()` — exact-id or cursor paging only; no semantic search |

The opt-in work-scope index filters the observation and reflection layers for a host-selected working set. It is not a fifth context layer, retrieval system, or session scope.

Activation is explicit: `createObservationalMemory().attach()` coordinates post-run observe/reflect/drop and compaction — by default `context.compactAfterTokens`, or whatever host gate `trigger` / `shouldCompact` supplies. Import and extension `setup` start nothing. Recall, commands, and utilities fail closed on invalid ids, wrong `sessionId`, ambiguous tool input, or oversized pages. Pass `secrets` for exact-value redaction in render/recall/worker paths. Branch isolation: hosts supply current-branch `appendEntry` and `getEntries`; mismatched store/session pairs fail closed after append.

See `examples/observational-memory-lifecycle.ts` for attach → turn → projection/recall/page without live credentials.

## When to use it

Use it when a host wants to opt in to long-session memory that records observations/reflections as session custom entries, renders prepared memory during compaction, and supports exact-id recall.

Use `createObservationalMemoryCompactionStrategy()` when compaction should render prepared memory without a model call. Prism core still does not select this package by default.

## Inputs / request

**Option surfaces** — `appendEntry` takes `ObservationalMemoryAppendOptions` (custom observation/reflection text, trust, and metadata); `createWorkScopeController` takes `WorkScopeControllerOptions` (session, `appendEntry`, optional `secrets`).

Memory records use `SessionEntry.kind: "custom"` with `entry.data.type` markers:

| Type | Payload |
| --- | --- |
| `om.observations.recorded` | `{ observations, coversUpToId? }` — successful observer runs append coverage even when `observations` is empty. |
| `om.reflections.recorded` | `{ reflections, coversUpToId? }` |
| `om.observations.dropped` | `{ observationIds, coversUpToId? }` |
| `om.scope.opened` | `{ id, parentId?, kind?, label? }` — host-defined scope tree node. |
| `om.scope.closed` / `om.scope.entered` / `om.scope.left` | `{ scopeId }` for close/enter; `{}` for leave. |
| `om.scope.bound` / `om.scope.unbound` | `{ scopeId, refs }` — many-to-many `om:<12-hex>` or `reflection:<12-hex>` membership. |
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
| Rendered memory projection | — | 256 KiB | `renderObservationalMemory()` / context block text |
| Folded compaction payload | — | 512 KiB | `data.memory` JSON; strategy trims lowest-relevance observations before failing |
| Recent-message window | — | 512 KiB | `renderRecentMessageWindow()` hard cap |
| Recall page size | 20 | 100 | `retrieval.pageLimit` / recall tool `limit` |

Direct `runObserver()` / `runReflector()` / `runDropper()` calls retain required `maxTurns` and accept the corresponding shorter worker fields (`maxToolCalls`, `maxResultBytes`, etc.). Workers are tool-only: text, thinking, and done events are ignored; a turn with no `tool_call` succeeds as a no-op and records nothing. Named default/hard constants and `resolveMemoryWorkerLimits()` are exported.

## Outputs / response / events

Key exports:

| Export | Purpose |
| --- | --- |
| `foldObservationalMemoryLedger()` | Fold custom memory entries into observations, reflections, drops, and coverage markers. |
| `foldWorkScopeMap()` / `createWorkScopeController()` | Fold the opt-in scope index or append validated open/close/enter/leave/bind/unbind entries. |
| `projectWorkMemory()` | Filter the folded observations/reflections through a scope query; exact-id recall stays unfiltered. |
| `withWorkScope()` | Open a missing scope, enter it for an async callback, and always leave without closing it. |
| `isEligibleObservationSourceEntry()` / `eligibleObservationSources()` | Select user/assistant/tool `message` entries for observer input. |
| `unscannedEntries()` / `observationsUncoveredByReflection()` | Dual coverage helpers for observation scan and reflection windows. |
| `buildObservationalMemoryProjection()` | Build active/full/folded projections from current branch entries. Optional `invalidatedIds` drops observations whose id or `sourceEntryIds` match, and reflections that rest on them. Full ledger stays for audit. |
| `buildObservationalMemoryContextBlocks()` | Render observational-memory + recent-messages context blocks for provider input. Same `invalidatedIds` option. |
| `selectRecentMessageEntries()` / `renderRecentMessageWindow()` | Bounded exact recent-message suffix; count via `keepRecentEntries`, optional token trim via `estimateEntryTokens`. |
| `createFoldedMemoryDetails()` | Create JSON details for compaction `data.memory`. |
| `renderObservationalMemory()` | Render reflections and observations into a prepared memory summary. |
| `recallObservationalMemory()` | Recover source evidence for a known observation/reflection id from supplied current-branch entries. `invalidatedIds` withholds content (`reason: "revoked"`) without injecting derived text. |
| `listInvalidatedIds()` (`@arnilo/prism-memory`) | Read the ids one exact scope currently withholds (`corrected` stays) and pass them as `invalidatedIds`, so blocks that rest on a source revoked mid-turn go stale on the next build. Empty for stores without lineage invalidation. |
| `recallObservationalMemoryBranchPage()` | Page eligible user/assistant/tool messages around a cursor entry id (`forward`/`backward`, optional `detail: summary|full`). |
| `createMemoryId()` / `isMemoryId()` | Create/check 12-character ids. |
| `resolveObservationalMemorySettings()` | Merge `observational-memory` settings with defaults and overrides. |
| `createObservationalMemory()` / `attach()` | One activation wires post-run observe/reflect/drop and compaction (`compactAfterTokens`, or a host `trigger` / `shouldCompact`); returns proxied session, runtime, context provider, and strategy. |
| `createObservationalMemoryRuntime()` | Low-level explicit flush for advanced hosts or tests. |
| `createObservationalMemoryCompactionStrategy()` | Render existing folded memory as a standard Prism compaction summary with `data.memory`. |
| `createObservationalMemoryExtension()` | Inert extension helper that registers the strategy contribution unless disabled. |
| `createRecallMemoryTool()` | Optional `recall` tool factory: exact id lookup (optionally merged with granted shared scopes) or current-branch message paging via host-supplied entries. |
| `createMemoryStatusCommand()` / `createMemoryViewCommand()` | Optional `om:status` and `om:view` command factories. |
| `createObservationalMemoryCommands()` | Convenience factory returning status and view commands. |

Pure utilities create no events, workers, tools, commands, credentials, or provider requests. `createObservationalMemoryExtension()` and import alone start nothing. `createObservationalMemory().attach()` runs workers only after proxied `run`/`prompt`/`stream`/`compact` complete (or after `wrapResumeRun` / `wrapResumeStream`). `createObservationalMemoryRuntime().flush()` remains for manual/advanced use. Attached `contextProvider` renders two blocks each turn: `observational-memory` (active reflections/observations aligned to the recent-message boundary) and `recent-messages` (last `keepRecentEntries` message entries in branch order, optionally trimmed by `recentMessageMaxTokens` using `estimateEntryTokens`; oldest dropped first). Compaction uses the same `keepRecentEntries` setting. Observer input includes only eligible `message` entries (`user`, `assistant`, `tool`); memory/compaction/bookkeeping entries advance `coversUpToId` scan coverage without entering the observer prompt. Successful observer/reflector runs append coverage markers even when they record zero facts. Reflection uses only active observations recorded after the last `om.reflections.recorded` entry unless `flush({ fullReflectionRebuild: true })`. Attached `flush()` skips with `run_active` while a proxied run is in flight. The compaction strategy is O(n) over supplied entries and makes no provider call.

### Work-scope index (opt-in)

`WorkScope` is a host-named, append-only index over one observational-memory ledger. Without `om.scope.*` entries, the map has only its implicit `session` root, context renders the existing active pool, and the dropper keeps its existing behavior. Shared work scopes extend that index across sessions under explicit grants — see "Shared work scopes (opt-in)" below.

Use `createWorkScopeController({ session, appendEntry, secrets? })` to `open`, `close`, `enter`, `leave`, `bind`, `unbind`, `grant`, or `revoke` scopes. Scope ids are host-defined (`[A-Za-z0-9._:/-]{1,128}`, no `..`); there are caps of 256 scopes, depth/stack 8, 4,096 binds and 1,024 principals per scope, and 512 characters for labels or kinds. Invalid ids, missing/closed parents, duplicate scopes, unknown record ids, reserved/closed grant targets, and ownership mismatch fail closed. Labels and kinds receive the same secret redaction as observational-memory text.

`projectWorkMemory(ledger, map, { from, include, closed?, kinds? })` returns a filtered observation/reflection view plus outline. `include` is `self`, `self+ancestors`, `self+descendants`, or `lineage`; `closed: "hide"` is the default, except closed ancestors of `from` remain available. Default attached context uses the current leaf with `self+ancestors`, rendering Scope Outline, Reflections, then Observations. The compaction summary — the layer the next run's pack starts from — renders the same projection, so the full ledger never rides into the prefix; the folded payload keeps every observation, so entering another scope can still surface what that summary hid. `recallObservationalMemory()` still reads the complete current branch by exact id.

After a flush records new observations or reflections, it binds those ids once to the current leaf scope only. A host promotes relevant memory explicitly by binding it to an ancestor; a reflection whose bind sits on a **closed** scope can also graduate into durable semantic memory through the fabric's `remember({ kind: "fact" | "procedure", reflectionId })`. While any host scope exists, the runtime skips the observation dropper; the folded-payload byte cap remains a storage safety cap, not working-set garbage collection. `withWorkScope(controller, spec, fn)` opens `spec` if needed, enters it, runs `fn`, and leaves in `finally`; it never closes a scope. This index does not provide resource-scoped observational memory or budget-based dropping as a working-set mechanism.

### Shared work scopes (opt-in)

A shared work scope lets several sessions contribute to and read one scope under explicit owner grants. Declare it per participant in `attach()`:

```ts
const attached = om.attach(session, {
  appendEntry: (entry, options) => store.append(entry, options),
  sharedScopes: { "build-42": { ownerSessionId: "session-...", entries: (sessionId) => store.list(sessionId) } },
  onScopeAccess: (event) => audit.info("om.scope.access", event),
});
```

Requirements, all fail-closed:

- The participant opens the scope in its own branch (`open`/`enter`) and binds its own observations/reflections to it. Only ids bound to that exact scope id are shared; memory bound to an ancestor, descendant, or other scope stays private.
- The owner branch carries `om.scope.granted` / `om.scope.revoked` records (`controller.grant(scopeId, principalIds)` / `revoke`) and is the only grant authority; grants in any other branch are inert. A grant is symmetric read+write — use separate scopes for asymmetric visibility.
- The host `entries(sessionId)` callback is the store/tenant boundary: the package checks grants, it cannot verify another branch's tenant. Keep the callback inside one `OwnershipScope`.
- Absent, unknown, revoked, unreachable, or not-opened-locally scope state denies the read and reports `onScopeAccess({ granted: false, reason })`. `onScopeAccess` fires for every decision, granted or denied.
- Revocation lands on the next read: each resolve re-reads the owner branch and re-folds the grant map. The local folded payload never contains foreign observations, so revocation also holds across local compaction.

`resolveSharedScopes({ scopes, principalId, map, onAccess? })` reads the owner branch for grants, then the owner and every granted branch, folds each branch separately, and unions the id-keyed results (`mergeObservationalMemoryLedgers`). Raw entry lists are never concatenated across branches — coverage cursors and projection boundaries are positional per branch. Bound memory is merged into the context blocks, `recallObservationalMemory`, the `recall` tool (exact-id only; branch paging stays current-branch), and `om:view`; `om:status` counts stay session-local.

Rendering still follows the work-scope projection: the reader needs the shared scope in its current leaf lineage (`enter`, or a host that keeps it entered) for the context block to include it. Recall by exact id does not depend on the leaf. The compaction strategy and its folded payload stay local, so a shared observation re-enters context from the provider rather than from the summary.

Cost: one branch read and fold per participating branch per context resolve (and per `recall` call that resolves shared scopes) — not per observation. Cache per flush only if profiling demands it.

### Compact-when override

`createObservationalMemory()` accepts a compact-when gate beside the settings: `trigger` (the same union `CompactionOptions.trigger` uses) or the `shouldCompact(context)` shorthand. When either is set it **replaces** `context.compactAfterTokens`; omitted, the token gate is unchanged.

```ts
const om = createObservationalMemory({
  observation: { provider, model },
  shouldCompact: (context) => context.entryCount > 40 || context.estimatedInputTokens / context.inputCapTokens >= 0.9,
});
```

- `context.entryCount` counts current-branch entries; `context.estimatedInputTokens` is this package's own `estimateEntryTokens` sum; `context.inputCapTokens` comes from `resolveInputCap` on `attach({ sessionModel })`.
- Both token numbers resolve lazily, so a callback that only reads counts works with a `sessionModel` that declares no `contextWindow`. Reading the cap without one throws inside the callback, and the gate then decides **false** — the sync loop reports it through the `debug` sink (`observational-memory:compaction-trigger-error`) and never compacts on a guess. `input_ratio` needs a resolvable cap and throws instead.
- An unknown trigger `type` or a non-function `shouldCompact` throws at `createObservationalMemory()`, before any session work. Tool and command factories are inert until a host registers/selects them.

## Request/response example

```json
{"id":"aaaaaaaaaaaa","kind":"observation","found":true}
```

## Implementation example

```ts
import {
  buildObservationalMemoryProjection,
  createObservationalMemory,
  createObservationalMemoryCompactionStrategy,
  createObservationalMemoryExtension,
  createObservationalMemoryCommands,
  createObservationalMemoryRuntime,
  createRecallMemoryTool,
  createWorkScopeController,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  projectWorkMemory,
  recallObservationalMemory,
  renderObservationalMemory,
  withWorkScope,
} from "@arnilo/prism-memory/compaction/observational-memory";

const om = createObservationalMemory({
  observation: { provider: observerProvider, model: observerModel, messageTokens: 10_000 },
  reflection: { provider: reflectorProvider, model: reflectorModel, observationTokens: 20_000 },
  context: { compactAfterTokens: 81_000, recentMessages: 8 },
  retrieval: { pageLimit: 20 },
});
const attached = om.attach(session, {
  appendEntry: (entry, options) => store.append(entry, options),
  sessionModel: agent.config.model,
});
const scopes = createWorkScopeController({ session: attached.session, appendEntry: (entry, options) => store.append(entry, options) });
await scopes.open({ id: "plan:memory", kind: "plan", label: "Memory work" });
await withWorkScope(scopes, { id: "task:cleanup", parentId: "plan:memory", kind: "task" }, () =>
  attached.session.run("Continue from prior work"),
);

const entries = await session.entries();
const projection = buildObservationalMemoryProjection(entries);
const scoped = projectWorkMemory(foldObservationalMemoryLedger(entries), foldWorkScopeMap(entries), {
  from: "task:cleanup",
  include: "self+ancestors",
});
const summary = renderObservationalMemory(scoped.reflections, scoped.observations, { outline: scoped.outline });
const evidence = recallObservationalMemory(entries, "aaaaaaaaaaaa");

const memory = createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  observation: { provider: workerProvider, model: workerModel },
  sessionModel: agent.config.model, // fallback when no worker model is configured
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

Settings resolve to nested `observation` / `reflection` / `dropper` / `context` / `retrieval` groups via `resolveObservationalMemorySettings()`. Defaults: `observation.messageTokens: 10000`, `reflection.observationTokens: 20000`, `context.compactAfterTokens: 81000`, `context.recentMessages: 8`, `context.observationsPoolMaxTokens: 20000`, `dropper.targetTokens: 10000` (from `context.observationsPoolTargetTokens`), `retrieval.pageLimit: 20`, `agentMaxTurns: 16`, `passive: false`, `debugLog: false`. Optional `context.recentMessageMaxTokens` trims the recent-message context window (oldest first) after the count limit.

Pre-0.0.19 flat settings keys (`observeAfterTokens`, `reflectAfterTokens`, `compactAfterTokens`, `keepRecentEntries`, `recentMessageMaxTokens`, `observationsPoolMaxTokens`, `observationsPoolTargetTokens`, `workerModel`, `thinkingLevel`, `requireExplicitModel`) were removed in 0.1.5 — pass the nested replacements instead (see [migration](migration.md) for the key-by-key table). Settings-provider JSON or untyped option objects that still carry a removed key fail closed before any worker/provider call, compaction, or session append with a `TypeError` naming the key and its replacement.

Observer/reflector/dropper may use separate providers, models, instructions, thinking levels, credentials, and `requireExplicitModel`. `dropper.policy: "lowest-relevance"` drops deterministically without a model call; default is `"model"`. Workers resolve only from the nested `observation` / `reflection` / `dropper` configs plus `sessionModel` fallback — the top-level `workerProvider` / `workerModel` aliases were removed in 0.1.5.

Token counting uses `estimateEntryTokens()` / `estimateMessageTokens()`.

Worker `provider.generate` calls use a **derived** correlation id `om:{session.id}` (shared by observer/reflector/dropper of that attach; adapters sanitize via `sanitizeCacheKey`). This is fully separate from the agent session id so OM cache does not collide with chat. Host `providerOptions.sessionId` still wins. Workers may use a different model than the session.

The runtime requires host-supplied `session`, an `appendEntry` callback bound to that session's owning store/branch, and at least one worker provider (`observation.provider` / `reflection.provider` / `dropper.provider`). Model selection uses [use-case model selection](use-case-model-selection.md): pass per-worker `model` (or settings `observation.model` / `reflection.model` / `dropper.model`) to override, and `sessionModel: agent.config.model` so workers fall back to the session model when no worker model is configured. `requireExplicitModel: true` restores the historical `missing_model` skip when no explicit worker model is set. It no longer accepts a separate `store` option because mismatched session/store pairs can append memory entries outside the active branch. After each memory append, the runtime checks the appended entry is visible at the session leaf and fails closed/restores the previous checkout if the callback points elsewhere. Optional credential resolution is explicit; missing requested credentials skip worker execution. Default credential requests use the **resolved** model's provider id.

`createObservationalMemoryCompactionStrategy()` keeps recent message entries like the default compaction strategy, renders existing observations/reflections as the summary, and returns a standard Prism compaction entry. Its `data` includes `throughEntryId`, `keepEntryIds`, `strategy`, `trigger`, and `memory: { type: "om.folded", version: 1, fullFold, observations, reflections, droppedObservationIds }`. When active observations exceed `context.observationsPoolMaxTokens`, it performs a full fold and synchronously trims lowest-relevance observations until the folded payload fits hard byte/token caps (or throws a typed error).

`createRecallMemoryTool()` accepts either `{ id }` for exact memory recall or `{ cursor, limit?, direction?, detail? }` for current-branch raw-message paging (default limit 20, hard cap 100). Reflection recall resolves supporting observations from the full ledger and reports `droppedSupportingObservationIds` / `missingSupportingObservationIds`; dropped supports still return available raw sources. Invalid ids, ambiguous requests, wrong `sessionId`, missing cursors, non-message cursors, and oversized pages fail closed. It does not search by topic.

`createMemoryStatusCommand()` reports recorded/dropped/active/visible observations, recorded/visible reflections, pool token counts, and optional runtime in-flight/last-error state. `createMemoryViewCommand()` renders visible memory by default or full active recorded memory with `{ mode: "full" }`; other modes return `Usage: /om:view [full]`.

`createObservationalMemoryExtension()` registers only inert contributions. It does not start workers, compact sessions, read settings, resolve credentials, call providers, or execute tools/commands during setup.

## Cross-session / delegation-tree recall (opt-in pattern)

Default is per-session: `attach()` + `appendEntry` bind one store/branch, and `recallObservationalMemory(entries, id)` / `createRecallMemoryTool({ getEntries })` see only the entries the host passes for that session. Supervisor children therefore produce observations the parent cannot recall. That is acceptable for v1 — the parent transcript already contains `delegate()` results, so parent OM covers milestones. When the host can read the participating branches, use a shared work scope instead (above); the funnel below remains the option when it cannot (a namespaced multi-tenant store key is still out of scope).

Hosts that need parent recall of child *source* work compose it themselves: wrap the shared `SessionStore.append` so eligible child messages (`isEligibleObservationSourceEntry`) are copied onto a workspace (or parent) session with a **new entry id** and that session's `sessionId`/`parentId`. Parent OM then observes those copies and mints **new** observation ids. Child OM, if attached, stays on the child session with its own ids.

```ts
import { createId, type SessionStore } from "@arnilo/prism";
import { isEligibleObservationSourceEntry } from "@arnilo/prism-memory/compaction/observational-memory";

function funnelChildMessagesToWorkspace(store: SessionStore, workspaceSessionId: string): SessionStore {
  return {
    async append(entry, options) {
      await store.append(entry, options);
      if (entry.sessionId === workspaceSessionId) return;
      if (!isEligibleObservationSourceEntry(entry)) return;
      const leaf = (await store.list(workspaceSessionId)).at(-1);
      await store.append({
        ...entry,
        id: createId("entry"),
        sessionId: workspaceSessionId,
        parentId: leaf?.id,
      });
    },
    list: (sessionId) => store.list(sessionId),
    get: (id) => store.get?.(id) ?? Promise.resolve(undefined),
    searchSessions: (query) => store.searchSessions?.(query) ?? Promise.reject(new Error("searchSessions unsupported")),
    readBranchPath: store.readBranchPath?.bind(store),
  };
}
```

Wire the wrapped store into both the parent session and each supervisor child factory (`createAgent({ store })`). Parent `attach({ appendEntry: (entry, options) => store.append(entry, options) })` and `createRecallMemoryTool({ getEntries: () => parentSession.entries() })` then see funneled child messages plus parent-minted observations. Recreate the parent session with the store `leafId` after a restart so the workspace branch is the one that received the copies. [`examples/autonomous-coding-loop.ts`](../examples/autonomous-coding-loop.ts) shows parent OM attach/compact/recall in the supervisor loop; it records child outcomes on the parent session (same recall, no extra store wrap).

Rules that keep exact-id recall unambiguous:

- Recall always takes **one** branch (`session.entries()` / `getEntries(sessionId)`). Never concatenate parent + child lists into one `recallObservationalMemory()` call. Shared work scopes are the supported exception: they union per-branch folded ledgers (id-keyed), never raw entry lists.
- Copies mint a new `entry.id`. `createMemorySessionStore` rejects duplicate ids globally; JSONL/DB adapters do too.
- Do **not** rewrite the child's OM `appendEntry` onto the workspace session. After each memory append the runtime checks the entry is visible at the **child** leaf and fails closed on a session/store mismatch. Funnel messages; let parent OM observe them.
- Do **not** copy `om.*` custom entries across. Their `sourceEntryIds` point at the origin session and would dangle on the workspace branch.
- Serialize funnel copies if concurrent children share the workspace tip (the sketch's `list().at(-1)` is not a lock).

Cost: the workspace branch grows with every funneled child message; parent `compactAfterTokens` / observation-pool caps still apply but fire sooner. Keep the per-session default unless parent recall of child sources is required.

Ownership: funnel only within the `OwnershipScope` already on the parent agent/store. Child factories receive that ownership from the supervisor; do not share a store across tenants or identities. Observations never leave the store the host scoped — the same rule applies to shared work-scope grants.

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
- [Attention compiler](attention-compiler.md): opt-in per-turn shrink that runs before compaction is considered and resolves the same input cap for `input_ratio` triggers.
- [Thinking and reasoning](thinking-and-reasoning.md): `thinkingLevel` → provider `compat`.
- [Provider request policies](provider-request-policies.md): derived `om:{session.id}` on worker generate.
- [Compaction and retry policies](compaction-and-retry.md): replaceable compaction strategy boundary.
- [Workflows](workflows.md): a host may use a workflow `nodeId` as a scope id with `withWorkScope`; the workflow runner does not enter scopes itself.
- [LLM compaction package](compaction-llm.md): existing optional compaction-package pattern.
- [Session stores and branching](session-stores-and-branching.md): branch entries that observational memory reads and appends to.
- [Memory fabric](memory-fabric.md): optional typed notes over the same stores; `episode` notes are views of these observation ids, and the ledger stays episodic.
- [Supervisor delegation](supervisors.md): child sessions whose messages this page's opt-in funnel can copy onto a workspace branch.
- [Extensions](extensions.md): inert registration pattern for optional package contributions.
- [Tools](tools.md): host activation and dispatch for optional recall tool contributions.
- [CLI/RPC](cli-rpc.md): command contributions through explicitly wired RPC hosts.
