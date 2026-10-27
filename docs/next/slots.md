# Slots

## What it does

A slot is a named kernel extension point with exactly one contract and one kernel default. There
are four:

| Slot | Contract | Kernel default |
| --- | --- | --- |
| `loop` | `LoopStrategy` | `defaultLoop` |
| `compaction` | `Compactor { compact(ctx) }` | the default is `createDefaultCompactor` |
| `store` | `SessionStore` | in-memory |
| `credentials` | `CredentialResolver { resolve(ref) }` | `env:NAME` only |

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
| `compaction` | `AgentConfig.slots.compaction` | Consumed when the compaction slot is wired. |
| `store` | `AgentConfig.store` | Not assignable through `slots` until a later phase. |
| `credentials` | `AgentConfig.slots.credentials` | Default resolves only `env:NAME` refs. |

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
slots.provide("credentials", "acme", { resolve: (request) => vault.get(request.name) });
slots.resolve("credentials"); // acme resolver
```

## Extension and configuration notes

- `store` is not assignable through `slots`: `AgentConfig.store` stays the direct store-slot input
  until the `createAgent` rewrite. It is where a suspended run writes its `suspended_run` entry.
- Until packages can provide slots, the only registrants are the kernel defaults and the host.
- Slot conflicts fail closed at agent creation, not at first use.

## Security and performance notes

- A slot cannot widen what a policy allows: the `loop` slot still reaches tools and models only
  through `RunController`.
- Conflict detection names the owners so a misconfiguration is diagnosable without inspecting
  registries.
- Resolution is O(1) per slot and allocates nothing when there is no conflict.

## Related APIs

- `LoopStrategy` / `RunController`: the `loop` slot contract.
- `Compactor`: the `compaction` slot contract.
- `CredentialResolver`: the `credentials` slot contract.
- `createSlotDefaults`: the four kernel defaults.

## Frozen for Phase 2

The four slot names and their contracts are Phase 1's public contract;
`src/__tests__/hook-catalog-freeze.test.ts` pins them as data, alongside the hook catalog and the
decide-hook combination rules in [hooks.md](hooks.md).
