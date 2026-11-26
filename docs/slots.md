# Slots

## What it does

A slot is a named kernel extension point with exactly one contract and one kernel default. There
are four:

| Slot | Contract | Kernel default |
| --- | --- | --- |
| `loop` | `LoopStrategy` | `defaultLoop` |
| `compaction` | `Compactor { compact(ctx) }` | the default is `createDefaultCompactor` |
| `store` | `SessionStore` | in-memory |
| `credentials` | `CredentialResolver { resolve(ref, ctx); store?; delete? }` | `env:NAME` only |

A `store` implements the baseline `append` and `list`, plus optional capabilities the kernel asks for by name:
`readBranchPath`, `appendMany`, `searchSessions`, and, behind `agent.sessions`, `listSessions` and `deleteSession` (see
[agent.md](agent.md#agentsessions)). A store that omits one is still a valid `store`; the call that needs it
fails with `UnsupportedStoreCapabilityError`.

The kernel derives the capability list from method presence: `sessionStoreCapabilities(store)` returns the
implemented names in contract order, `inspect().store` reports them together with the slot owner
(`{ owner, capabilities }`), and `agent.sessions` lights up exactly those calls. A declared capability the
store does not implement is an error, not a skip: `storeConformance` fails the run.

`tipCheck` is the one capability that is declared, not derived: a store sets `tipCheck: true` when its
`append` enforces `SessionAppendOptions.tip`. The session passes `tip: true` on every append it makes at its
own tip. The store marks that row linear and rejects the append with `SessionAppendConflictError` (with
`expectedParentId` and the session's current leaf) when the parent already has a linear child: another
writer moved the tip. The check and the insert are one atomic step, and an exact idempotent retry is
deduplicated before it. Two appends are branches and never tip-checked: the first append after
`session.checkout(leafId)`, and the entries `fork()` copies. A branch never blocks a later tip append, and a
store without `tipCheck` accepts a stale-tip append as a branch, as before. The memory, SQLite, and
Postgres stores enforce it across writers; the JSONL store enforces it within one store instance only. See
[agent.md](agent.md#sessions) for the `session_conflict` run error.

`readBranchPath({ sessionId, leafId, from: "compaction" })` asks for the branch's **tail** only. The walk from
the leaf stops at the newest `compaction` entry's `throughEntryId` (that entry included), and the entries the
compaction's `keepEntryIds` name before it come first; the leaf is last. A branch with no compaction, or a
compaction without `throughEntryId`, comes back whole, and a store may ignore `from` and return the whole
branch. The kernel reads the tail for every session snapshot (the run path, `messages()`, and the open of
`agent.session({ id })`). When it compacts, it writes a `checkpoint` into the compaction entry's `data`: the
branch length, the folded package state (each key's latest `set` and its `append` log), the per-key
`external_state` totals, and the pinned entry ids. Package state, the `external_state` caps, and
`compaction.when`'s `entryCount` start from it, so they still count the whole branch. A compaction without a
checkpoint (written by an older kernel, or rebased onto a tip that moved while it was summarized) makes the
kernel read the whole branch for that snapshot. `session.entries()`, `SessionContext.entries()`, compaction,
`externalState.load()`, `fork()`, and export still read the whole branch. The memory, SQLite, and Postgres
stores implement `from`; JSONL has no `readBranchPath` and is read whole.

`appendMany(entries, { signal? })` writes a batch atomically: every entry or none. The entries belong to one
session and come in branch order; each `parentId` is an earlier entry of the batch, an entry the session
already holds, or undefined. A missing parent throws `SessionAppendConflictError`, and a taken id throws as
`append` does, in both cases before anything is written. Batch entries are not tip-checked and carry no
idempotency key. `validateSessionAppendBatch(entries)` is the shared, store-independent part of that check.
`session.fork()` copies the branch with one `appendMany` call. Against a store without it, fork appends one
entry at a time and, on failure, removes the partial copy with `deleteSession`; when it cannot, the error
names the partial session id. Fork also points each copied compaction's `throughEntryId`, `keepEntryIds`, and
checkpoint at the copies, so a fork of a compacted session keeps its messages. Each copy gets a new id and
records the ids it had before in `metadata.forkedFrom` (oldest first); `sessionEntryForkedFrom(entry)` reads it, so a
package that stored parent entry ids (session memory's records) resolves them to the fork's copies. It rides entry
metadata, so every store keeps it without a schema change. The memory, SQLite, and
Postgres stores write the batch in one transaction or statement (a 5,000-entry fork on Postgres is 2
statements instead of one per entry). JSONL writes the session's new file beside it and renames it into place.

A direct assignment in `AgentConfig.slots` is either an implementation or the **name of the package**
that owns the slot, which resolves a conflict between two package providers (`slots: { compaction: "@a/x" }`).
A name that did not provide the slot fails closed (`UnknownSlotOwnerError`). `createAgent` resolves
every slot while loading, so a conflict fails the load, not the first run. The registry also has
`ownerOf(slot, assigned?)` (`"host"`, a package name, or `"kernel"`) and `remove(owner)`, which
unwinds a package.

Unlike hooks, a slot holds one implementation. `createSlotRegistry(defaults)` exposes `provide`,
`default`, `providers`, and `resolve`; a direct assignment (`AgentConfig.slots`) always wins.

## When to use it

A host replaces a slot when it wants a different loop, compactor, session store, or credential
resolver. A package provides a slot implementation; two packages providing the same slot is a
configuration error the host resolves with a direct assignment.

## Inputs / request

```ts
const registry = createSlotRegistry(createSlotDefaults());
registry.provide("loop", "pkg-a", planThenAct);
registry.resolve("loop"); // planThenAct
```

| Slot | Direct assignment | Notes |
| --- | --- | --- |
| `loop` | `AgentConfig.slots.loop` | See [loop.md](loop.md). |
| `compaction` | `AgentConfig.slots.compaction` | Consumed when the compaction slot is wired. `CompactionContext.session` is the owner's `SessionContext` when a package owns the slot (session state, `entries()`), and absent when the owner is `host` or `kernel`. |
| `store` | `AgentConfig.slots.store` | The only session-store input. Read by `agent.session()`; `inspect().store` reports its owner and derived capabilities. See [agent.md](agent.md#sessions). |
| `credentials` | `AgentConfig.slots.credentials` | Default resolves only `env:NAME` refs and has no `store`. |

## Outputs / response

`resolve(slot, assigned?)`:

- `assigned` present → returns it (a direct assignment always wins).
- exactly one provider → that provider.
- no provider → the kernel default.
- two or more providers → throws `SlotConflictError` (`ERR_PRISM_SLOT_CONFLICT`) naming both owners.

An unknown slot name throws `UnknownSlotError` (`ERR_PRISM_UNKNOWN_SLOT`).

## Request/response example

```json
{
  "slots": {
    "loop": { "name": "plan-then-act", "revision": "1" }
  }
}
```

## Implementation example

```ts
import { createSlotRegistry, createSlotDefaults, SlotConflictError } from "@arnilo/prism";

const slots = createSlotRegistry(createSlotDefaults());
slots.provide("credentials", "acme", {
  resolve: (ref) => vault.get(ref),
  store: (ref, secret) => vault.set(ref, secret),
  delete: (ref) => vault.delete(ref),
});
slots.resolve("credentials"); // acme resolver
```

## Store packages

Three packages fill the `store` slot with a durable implementation: each default-exports a
`definePackage` definition whose `setup` claims the slot, and each ships an instance shorthand for
`packages: [...]` (a manifest host instead names the package in `slots.store`, or installs it with
`prism add` and lets the entry carry the config).

| Package | Config | Implements |
| --- | --- | --- |
| `@arnilo/prism-extensions/store-jsonl` | `{ dir }` — one JSONL file per session | `append`, `appendMany`, `list`, `get`, `readBranchPath`, `searchSessions`, `listSessions`, `deleteSession` |
| `@arnilo/prism-extensions/store-sqlite` | `{ path, busyTimeoutMs? }` — `bun:sqlite`, migrations applied at load | the same eight, over one database file |
| `@arnilo/prism-extensions/store-postgres` | `{ url, schema?, pool? }` — `url` is an `env:` / `keyring:` ref | the same eight, over a shared server |

```ts
import { createAgent } from "@arnilo/prism";
import { sqliteStore } from "@arnilo/prism-extensions/store-sqlite";

const agent = await createAgent({
  model,
  packages: [sqliteStore({ path: ".prism/sessions.db" })],
});
```

Each package declares `capabilities: ["slot:store"]`; `@arnilo/prism-extensions/store-postgres` also declares
`"credentials"`, because its `x-prism-secret` `url` is resolved through the credentials slot once at
setup and fails closed naming the ref, never the value. The drivers stay inside their packages: an
agent that does not list `@arnilo/prism-extensions/store-postgres` never loads `pg`, and one that does not list
`@arnilo/prism-extensions/store-sqlite` never loads `bun:sqlite`. `@arnilo/prism-extensions/store-codecs` is the plain
library the two SQL stores share for row, cursor, and ownership encoding — it claims no slot and no
host lists it.

`agent.sessions` reacts to what the store implements, not to which package provided it:
`get`/`readBranchPath` back `agent.session({ id })`, `searchSessions` backs `agent.sessions.search`,
and `listSessions`/`deleteSession` light up `agent.sessions.list`/`.delete`. The kernel's in-memory
store implements every optional capability, so a host that lists no store package keeps a working
`agent.sessions`; a call a store does not implement throws `UnsupportedStoreCapabilityError`, and
`inspect().store` reports the slot owner plus the derived capability list. Every durable store passes
the same `storeConformance` suite (`@arnilo/prism/testing`) with a `reopen` factory, so a session
written by one process is readable by the next.

## Extension and configuration notes

- `store` is the only session-store input: `AgentConfig.store` and `SessionOptions.store` no longer
  exist. It is where a suspended run writes its `suspended_run` entry, and where `agent.session({ id })`
  resumes from. With `AgentConfig.durability: "turn"` a run also appends one `run_checkpoint` entry per
  completed tool round. When `AgentConfig.sessionLimits` or `SessionOptions.limits` is configured, a
  session persists cumulative counters in `session_limits` entries at run end (and inside
  `run_checkpoint` when `durability: "turn"`). A store keeps these entries like any entry (`data` is opaque
  JSON): no DDL or codec change, and `storeConformance` checks them in the `run-checkpoint` and
  `session-limits` legs.
- Packages provide slots through a declared capability (`slot:store`, `slot:credentials`, …): a package without
  it cannot claim the slot, and two providers of one slot fail the load until `AgentConfig.slots` names an owner.
- Slot conflicts fail closed at agent creation, not at first use.

### When the compaction slot runs

The slot decides how to compact; the kernel's auto trigger decides when. A `compaction.when` vote
decides first (any `true` compacts, else any `false` vetoes). Only when every handler abstains, or none
is registered, the kernel's own trigger applies:

- `AgentConfig.compaction.trigger` (a `CompactionTrigger`) when set,
- else `compaction.thresholdEntries` when set,
- else `DEFAULT_COMPACTION_TRIGGER`, `{ type: "input_ratio", ratio: 0.8 }`: compact once the request's
  estimate reaches 80% of the model's input cap (`contextWindow - maxOutputTokens - 1,024` reserve).

The estimate every trigger reads (and `compaction.when`'s `estimatedTokens`) is the branch's messages and carried
summaries plus what the last main turn sent beside them: instructions, rendered context blocks (a memory block, a
host's `context.build` retrieval) and tool declarations. At a run's start that overhead is the previous turn's. Before
plan 218.5 Task 7 it was the branch alone, so a trigger fired late by the size of every block a package or host added,
and the provider's overflow did the compacting.

```ts
createAgent({ model });                                                              // compacts at 80% of the input cap
createAgent({ model, compaction: false });                                           // no kernel trigger
createAgent({ model, compaction: { trigger: { type: "threshold_tokens", tokens: 96_000 } } });
```

The cap comes from the model's `limits`. When the host's model carries none (a `"provider/model"`
string), the kernel reads the provider's catalog (`ModelProvider.models()`) once per agent, at the
first trigger check, never in `createAgent`. A model with no resolvable window gets no default trigger
and one `info` status note per agent from `kernel` (`package.status`, `inspect().statusNotes`); the run
is not failed. An explicitly configured `input_ratio` trigger on such a model still fails the run.
The package voters read the same catalog: `@arnilo/prism-extensions/compaction` with a cap-reading
`trigger` and the context-engineering attention compiler describe the session model through
`prism.models.client(model).resolve()`, the same cached lookup.

`compaction: false` (agent or run) turns off the kernel trigger only. A package's `true` vote still
compacts, and overflow recovery still compacts after the provider rejects a request for size.

The default is a safety net against provider rejection, not a quality gate. A model's effective
context can sit far below 80% of its declared window: the reference host measured 96,000 tokens on a
1,000,000-token window (`docs/_evidence/context-rot-0.13.0.md`) and sets that as a `threshold_tokens`
trigger. Measure, then set a trigger. Packages that vote below their own gate
(`@arnilo/prism-extensions/compaction` with a `trigger`, context-engineering attention below its
`compactRatio`, the memory-system session tiers below their two triggers) are not overridden by the default.
Prism ships two compaction systems, and an agent runs one:
- session memory (`@arnilo/prism-memory-system` with `enabled: true`) records the session and removes only what it has
  recorded;
- LLM compaction (`@arnilo/prism-extensions/compaction`) summarizes what the cut drops, with one model call per
  compaction.

Without either, the kernel's deterministic compactor runs. Session memory answers every check of a session that has it
on, so the kernel trigger never decides there; it is a compaction system of its own, and listing LLM compaction or context-engineering's `fold` or `attention` beside it fails
`createAgent` unless the host sets the memory system's `context.compaction: false`
(`packages/memory/system/README.md`, Compaction).

### What the default compactor keeps

`createDefaultCompactor` makes no model call. It keeps a recent tail and replaces everything older with
a structured extract.

- **The kept tail** is sized by tokens: the newest messages whose estimate fits `keepRecentTokens`,
  by default 20% of the model's input cap and never below 2,000 tokens (`DEFAULT_KEEP_RECENT_TOKENS_FLOOR`;
  the floor alone when no cap resolves). `compaction.keepRecentEntries` still keeps a fixed message
  count when set. A tool result always stays with the assistant tool call before it.
- **The summary** lists, in order: `Task:` (the first user message, up to 1,500 characters),
  `Latest progress:` (the last assistant text of the dropped span), `Files modified:` / `Files read:`
  (from `read`, `write`, and `edit` calls), `Tools used:` (each tool with its call count), then
  `Recent:` (the newest dropped text that still fits, with the older part marked as cut).
- The summary is capped at `compaction.maxSummaryChars` (default 8,000,
  `DEFAULT_COMPACTION_MAX_SUMMARY_CHARS`; `0` means no cap) and ends in a `[…N characters cut]` marker
  when cut. `secrets` are redacted before the cap.

The session passes the cap and `maxSummaryChars` to every compactor as `CompactionContext.inputCapTokens`
and `CompactionContext.maxSummaryChars`. The cap is resolved the same way as for the trigger.

```text
Task: Port the parser to the new grammar
Latest progress: Parser ported; next: fix the three failing tests
Files modified: src/parser.ts
Files read: src/grammar.ts
Tools used: read ×12, edit ×4, shell ×3
Recent:
[…2593 earlier characters cut]
assistant: …
```

## Security and performance notes

- A slot cannot widen what a policy allows: the `loop` slot still reaches tools and models only
  through `RunController`.
- Conflict detection names the owners so a misconfiguration is diagnosable without inspecting
  registries.
- Resolution is O(1) per slot and allocates nothing when there is no conflict.
- The `credentials` slot resolves per request with no kernel cache; a resolver that wants one owns
  the cache and its invalidation. A resolved `Secret` joins the agent's secret set, so it is redacted
  from events, `inspect()`, persisted entries, and errors from then on.

## Related APIs

- `LoopStrategy` / `RunController`: the `loop` slot contract.
- `Compactor`: the `compaction` slot contract.
- `CredentialResolver`: the `credentials` slot contract (`resolve(ref, ctx)`, optional `store`/`delete`).
- `createSlotDefaults`: the four kernel defaults.

## Frozen surface

The four slot names and their contracts are public contract;
`src/__tests__/hook-catalog-freeze.test.ts` pins them as data, alongside the hook catalog and the
decide-hook combination rules in [hooks.md](hooks.md).
