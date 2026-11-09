/**
 * The `context.build` contribution: the rendered memory as one context block.
 *
 * The block comes from the session's ledger (already in memory) — never from a branch read, and never
 * written back to the store. Recent messages are not repeated here: the kernel's own assembly already
 * carries them, and a compaction keeps the recent window verbatim.
 */
import type { ContextBlock } from "@arnilo/prism";

import { activeObservations, activeReflections, type ObservationalMemoryLedger } from "./ledger.js";
import { renderObservationalMemory } from "./render.js";
import type { MemoryObservation, MemoryReflection, MemoryTaskState } from "./types.js";

export interface MemoryBlockOptions {
  readonly taskState?: MemoryTaskState;
  readonly maxTaskStateBytes?: number;
  readonly secrets?: readonly (string | undefined)[];
  /** Render recall guidance only while the `recall` tool is actually exposed. */
  readonly advertiseRecall?: boolean;
  readonly maxBytes?: number;
}

export function observationalMemoryBlock(ledger: ObservationalMemoryLedger, options: MemoryBlockOptions = {}): readonly ContextBlock[] {
  const observations = activeObservations(ledger);
  const reflections: readonly MemoryReflection[] = activeReflections(ledger);
  return memoryBlocksFrom(reflections, observations, { ...options, taskState: ledger.taskState });
}

export function memoryBlocksFrom(
  reflections: readonly MemoryReflection[],
  observations: readonly MemoryObservation[],
  options: MemoryBlockOptions = {},
): readonly ContextBlock[] {
  const content = renderObservationalMemory(reflections, observations, {
    taskState: options.taskState,
    maxTaskStateBytes: options.maxTaskStateBytes,
    secrets: options.secrets ?? [],
    advertiseRecall: options.advertiseRecall,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
  return content
    ? [
        {
          title: "session-memory",
          content,
          priority: 10,
          metadata: { source: "memory.session", itemIds: [...content.matchAll(/^- \[([a-f0-9]{12})\]/gm)].map((match) => match[1]!) },
        },
      ]
    : [];
}
