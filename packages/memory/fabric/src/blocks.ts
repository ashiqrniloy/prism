import type { JsonObject } from "@arnilo/prism";
import type { Memory, WorkingMemoryRecord } from "@arnilo/prism-memory-core";
import { MemoryConflictError, MemoryValidationError } from "@arnilo/prism-memory-core";
import { createMemoryId, isMemoryId } from "@arnilo/prism-memory-observational";
import { MEMORY_FABRIC_WORKING_KEY, type MemoryNoteProvenance, parseMemoryNoteProvenance } from "./types.js";

/** Block labels an agent may target; matches the label rule `remember({ kind: "working" })` applies. */
export const FABRIC_BLOCK_LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Stored form of one labeled fabric block inside the working-memory value. */
export interface FabricWorkingBlock {
  readonly id: string;
  readonly content: string;
  /** Set when the block was tombstoned; the content is empty and the label is free again. */
  readonly forgottenAt?: string;
  /** Provenance of the last write to this block. */
  readonly generated?: MemoryNoteProvenance;
}

export interface FabricBlockRecord {
  readonly created: boolean;
  readonly block: string;
  readonly content: string;
  readonly record: WorkingMemoryRecord;
}

export function assertFabricBlockLabel(block: unknown): asserts block is string {
  if (typeof block !== "string" || !FABRIC_BLOCK_LABEL.test(block)) {
    throw new MemoryValidationError("block must match [a-z0-9][a-z0-9._-]{0,63}");
  }
}

/** Deterministic id for a block label: the same label keeps the same note id across writes. */
export function fabricBlockId(block: string): string {
  return createMemoryId("fabric", "working", block);
}

/**
 * Fail-closed read of one labeled block. A missing, malformed, or tombstoned block reads as
 * `undefined`, so a corrupt working value can never make the fabric report content it does not have.
 */
export function readFabricBlock(record: WorkingMemoryRecord | undefined, block: string): FabricWorkingBlock | undefined {
  const fabric = record?.value?.[MEMORY_FABRIC_WORKING_KEY];
  if (fabric === null || typeof fabric !== "object" || Array.isArray(fabric)) return undefined;
  const blocks = (fabric as JsonObject).blocks;
  if (blocks === null || typeof blocks !== "object" || Array.isArray(blocks)) return undefined;
  const raw = (blocks as JsonObject)[block];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || !isMemoryId(entry.id)) return undefined;
  if (typeof entry.content !== "string") return undefined;
  if (typeof entry.forgottenAt === "string") return undefined;
  const generated = parseMemoryNoteProvenance(entry.generated);
  return { id: entry.id, content: entry.content, ...(generated === undefined ? {} : { generated }) };
}

function blockPatch(block: string, id: string, content: string, forgottenAt: string | null, generated?: MemoryNoteProvenance): JsonObject {
  return {
    [MEMORY_FABRIC_WORKING_KEY]: { blocks: { [block]: { id, content, forgottenAt, ...(generated === undefined ? {} : { generated }) } } },
  } as JsonObject;
}

/** Replace a block's content (the `remember({ kind: "working" })` write). */
export async function setFabricBlock(
  memory: Memory,
  block: string,
  content: string,
  options: { readonly signal?: AbortSignal; readonly generated?: MemoryNoteProvenance } = {},
): Promise<WorkingMemoryRecord> {
  assertFabricBlockLabel(block);
  return memory.updateWorking(blockPatch(block, fabricBlockId(block), content, null, options.generated), {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

/**
 * Append to a labeled block under the memory text cap, versioned against concurrent writers.
 * The cap is checked before the write, so a rejected append leaves the stored version untouched.
 */
export async function appendFabricBlock(
  memory: Memory,
  block: string,
  text: string,
  options: { readonly signal?: AbortSignal; readonly generated?: MemoryNoteProvenance } = {},
): Promise<FabricBlockRecord> {
  assertFabricBlockLabel(block);
  if (typeof text !== "string" || text.trim().length === 0) throw new MemoryValidationError("text must be a non-empty string");
  const maxChars = memory.limits.maxEntryTextChars;
  // ponytail: 3 bounded OCC attempts; a hotter block wants a store-side append, not more retries.
  for (let attempt = 0; ; attempt += 1) {
    const current = await memory.getWorking({ ...(options.signal === undefined ? {} : { signal: options.signal }) });
    const existing = readFabricBlock(current, block);
    const created = existing === undefined || existing.content.length === 0;
    const content = created ? text : `${existing.content}\n${text}`;
    if (content.length > maxChars) throw new MemoryValidationError(`block content would exceed ${maxChars} characters`);
    try {
      const record = await memory.updateWorking(blockPatch(block, existing?.id ?? fabricBlockId(block), content, null, options.generated), {
        expectedVersion: current?.version,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      return { created, block, content, record };
    } catch (error) {
      if (error instanceof MemoryConflictError && attempt < 2) continue;
      throw error;
    }
  }
}

/** Tombstone a block: content cleared, `forgottenAt` stamped, label reusable. Returns false when absent. */
export async function tombstoneFabricBlock(
  memory: Memory,
  block: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<boolean> {
  assertFabricBlockLabel(block);
  const current = await memory.getWorking({ ...(options.signal === undefined ? {} : { signal: options.signal }) });
  const existing = readFabricBlock(current, block);
  if (existing === undefined) return false;
  await memory.updateWorking(blockPatch(block, existing.id, "", new Date().toISOString()), {
    expectedVersion: current?.version,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return true;
}
