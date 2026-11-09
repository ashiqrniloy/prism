import type { HookRegistrar } from "@arnilo/prism";
import type { Memory, MemoryContextProviderOptions } from "@arnilo/prism-memory-core";
import type { MemoryFabricInjectConfig } from "./config.js";
import { createFabricCitationTracker, createFabricContext, type FabricCitationTracker } from "./context.js";
import { createLongTermMemory } from "./create.js";
import type { MemoryFabric } from "./types.js";

/** Registration id a host uses to tell this contribution apart from other memory handlers. */
export const DEFAULT_MEMORY_FABRIC_PROVIDER_NAME = "memory-fabric";

/** Register the fabric-filtered projection after context engineering; passive recall is opt-in. */
export function registerMemoryFabricContext(
  hooks: HookRegistrar,
  memory: Memory,
  options: MemoryContextProviderOptions = {},
  recall?: MemoryFabric["recall"],
  inject: false | MemoryFabricInjectConfig = false,
  tracker?: FabricCitationTracker,
  lifecycle?: { recordUses: (sessionKey: string, ids: readonly string[], options?: { readonly signal?: AbortSignal }) => Promise<unknown> },
  touchedPaths?: (sessionId: string) => readonly string[],
): void {
  const citationTracker = tracker ?? createFabricCitationTracker();
  const projection = createFabricContext(
    memory,
    recall ?? createLongTermMemory({ memory }).recall,
    options.includeSemantic === false ? false : inject || (options.includeSemantic === true ? { topK: options.topK } : false),
    options,
    undefined,
    citationTracker,
    touchedPaths,
  );
  hooks.on("context.build", projection.build, { id: options.name ?? DEFAULT_MEMORY_FABRIC_PROVIDER_NAME, priority: -1_100 });
  hooks.on("compaction.completed", (_event, context) => projection.refresh(context.sessionId));
  hooks.on("session.closed", (_event, context) => {
    projection.forget(context.sessionId);
    citationTracker.clear?.(context.sessionId);
  });
  hooks.on("message.delta", (event, context) => projection.observe(event.content, context));
  hooks.on("turn.completed", (_event, context) => {
    const ids = projection.cited(context);
    if (ids.length) {
      context.session?.background("fabric.touch", async (signal) => {
        await memory.touch(ids, { signal });
        if (lifecycle && context.session) {
          await lifecycle.recordUses(context.session.id, ids, { signal });
        }
      });
    }
  });
}
