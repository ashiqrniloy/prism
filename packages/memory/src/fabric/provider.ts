import type { HookRegistrar } from "@arnilo/prism";
import type { Memory, MemoryContextProviderOptions } from "../types.js";

/** Registration id a host uses to tell this contribution apart from other memory handlers. */
export const DEFAULT_MEMORY_FABRIC_PROVIDER_NAME = "memory-fabric";

/**
 * Context seam for the fabric: the blocks `createMemory` already resolves, registered as a
 * `context.build` handler (roadmap §2.4) under the fabric's default name — working memory tagged
 * `working-memory` and semantic recall tagged `semantic-memory`. Notes are semantic memory, so the
 * fabric adds no block type, no layer id and no new consent plane; a compiler that measures blocks
 * and a compiler that is off see the same input (the compiler only measures cost, it does not
 * repack or re-tag).
 *
 * `ponytail:` delegation, not duplication — if hosts need kind/validity-filtered injection, this
 * becomes a handler over the fabric's own `recall(query, { kinds, asOf, budget })`.
 */
export function registerMemoryFabricContext(hooks: HookRegistrar, memory: Memory, options: MemoryContextProviderOptions = {}): void {
  memory.registerContextBuild(hooks, { name: DEFAULT_MEMORY_FABRIC_PROVIDER_NAME, ...options });
}
