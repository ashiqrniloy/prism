import {
  SlotConflictError,
  UnknownSlotError,
  UnknownSlotOwnerError,
  type SlotContracts,
  type SlotName,
  type SlotProvider,
  type SlotRegistry,
} from "./types.js";

// Typed as `SlotName[]`, so adding a slot to `SlotContracts` without listing it here is a
// compile error rather than a runtime `UnknownSlotError` from `assertSlot`.
export const SLOT_NAMES: readonly SlotName[] = ["loop", "compaction", "store", "credentials"];

const SLOT_NAME_SET: ReadonlySet<string> = new Set(SLOT_NAMES);

function assertSlot(name: string): asserts name is SlotName {
  if (!SLOT_NAME_SET.has(name)) throw new UnknownSlotError(name);
}

export function createSlotRegistry(defaults: SlotContracts): SlotRegistry {
  const providers = new Map<SlotName, SlotProvider<SlotName>[]>();

  const registry: SlotRegistry = {
    provide(name, owner, impl) {
      assertSlot(name);
      const list = providers.get(name) ?? [];
      list.push({ owner, impl } as SlotProvider<SlotName>);
      providers.set(name, list);
    },
    default(name) {
      assertSlot(name);
      return defaults[name];
    },
    providers(name) {
      assertSlot(name);
      return (providers.get(name) ?? []) as readonly SlotProvider<SlotName>[];
    },
    resolve(name, assigned) {
      return pick(name, assigned).impl as SlotContracts[typeof name];
    },
    ownerOf(name, assigned) {
      return pick(name, assigned).owner;
    },
    remove(owner) {
      for (const [name, list] of providers) {
        const kept = list.filter((provider) => provider.owner !== owner);
        if (kept.length === 0) providers.delete(name);
        else providers.set(name, kept);
      }
    },
  };

  function pick(name: SlotName, assigned: unknown): { readonly owner: string; readonly impl: unknown } {
    assertSlot(name);
    const list = providers.get(name) ?? [];
    if (typeof assigned === "string") {
      const match = list.find((provider) => provider.owner === assigned);
      if (!match) throw new UnknownSlotOwnerError(name, assigned);
      return match;
    }
    if (assigned !== undefined) return { owner: "host", impl: assigned };
    if (list.length === 1) return list[0]!;
    if (list.length > 1)
      throw new SlotConflictError(
        name,
        list.map((provider) => provider.owner),
      );
    return { owner: "kernel", impl: defaults[name] };
  }
  return registry;
}
