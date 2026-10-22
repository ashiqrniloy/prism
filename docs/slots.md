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
`readBranchPath`, `searchSessions`, and, behind `agent.sessions`, `listSessions` and `deleteSession` (see
[agent.md](agent.md#agentsessions)). A store that omits one is still a valid `store`; the call that needs it
fails with `UnsupportedStoreCapabilityError`.

The kernel derives the capability list from method presence: `sessionStoreCapabilities(store)` returns the
implemented names in contract order, `inspect().store` reports them together with the slot owner
(`{ owner, capabilities }`), and `agent.sessions` lights up exactly those calls. A declared capability the
store does not implement is an error, not a skip: `storeConformance` fails the run.

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
| `@arnilo/prism-store-jsonl` | `{ dir }` — one JSONL file per session | `append`, `list`, `get`, `readBranchPath`, `searchSessions`, `listSessions`, `deleteSession` |
| `@arnilo/prism-store-sqlite` | `{ path, busyTimeoutMs? }` — `bun:sqlite`, migrations applied at load | the same seven, over one database file |
| `@arnilo/prism-store-postgres` | `{ url, schema?, pool? }` — `url` is an `env:` / `keyring:` ref | the same seven, over a shared server |

```ts
import { createAgent } from "@arnilo/prism";
import { sqliteStore } from "@arnilo/prism-store-sqlite";

const agent = await createAgent({
  model,
  packages: [sqliteStore({ path: ".prism/sessions.db" })],
});
```

Each package declares `capabilities: ["slot:store"]`; `@arnilo/prism-store-postgres` also declares
`"credentials"`, because its `x-prism-secret` `url` is resolved through the credentials slot once at
setup and fails closed naming the ref, never the value. The drivers stay inside their packages: an
agent that does not list `@arnilo/prism-store-postgres` never loads `pg`, and one that does not list
`@arnilo/prism-store-sqlite` never loads `bun:sqlite`. `@arnilo/prism-store-codecs` is the plain
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
  resumes from.
- Packages provide slots through a declared capability (`slot:store`, `slot:credentials`, …): a package without
  it cannot claim the slot, and two providers of one slot fail the load until `AgentConfig.slots` names an owner.
- Slot conflicts fail closed at agent creation, not at first use.

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
