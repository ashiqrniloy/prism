import type { Memory, MemoryVectorRecord } from "@arnilo/prism-memory-core";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { type ArchiveConfig, normalizeNoteStatus, shouldArchive } from "../lifecycle/index.js";
import { parseMemoryNoteMetadata } from "../types.js";
import { loadScopedLedger, saveScopedLedger } from "./ledger.js";

/** ponytail: stop if a store lies about nextCursor; 10k pages ≈ 1M rows at default page size */
const MAX_EXPORT_PAGES = 10_000;

async function* exportedRecords(memory: Memory): AsyncGenerator<MemoryVectorRecord> {
  const threadId = memory.scope.threadId;
  if (!threadId) throw new MemoryValidationError("threadId");
  const identity = { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId, threadId };
  let cursor: string | undefined;
  for (let n = 0; n < MAX_EXPORT_PAGES; n++) {
    const page = await memory.exportMemory({ identity, ...(cursor ? { cursor } : {}) });
    yield* page.entries;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

function hasArchivePending(pending: readonly unknown[], id: string): boolean {
  return pending.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const rec = item as { kind?: unknown; id?: unknown };
    return rec.kind === "archive" && rec.id === id;
  });
}

/**
 * Propose archiving the notes the lifecycle's own rule selects (`shouldArchive`: both strengths low,
 * past the grace window). The note keeps its status until the proposal is approved
 * (`approveScopedPending` forgets it), so a rejected proposal changes nothing. This is an approval
 * flow, not a pass: the automatic sweep is `fabric.maintain()`.
 */
export async function runScopedGcPass(input: {
  readonly memory: Memory;
  readonly ledgerFile: string;
  readonly clock?: number;
  readonly archive?: ArchiveConfig;
  readonly now?: number;
}): Promise<{ proposed: number; archived: number }> {
  const ledger = await loadScopedLedger(input.ledgerFile);
  const now = input.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const pending: unknown[] = [...ledger.pending];
  const clock = input.clock ?? 0;
  let proposed = 0;
  for await (const record of exportedRecords(input.memory)) {
    const metadata = parseMemoryNoteMetadata(record.metadata);
    if (metadata === undefined) continue;
    const status = normalizeNoteStatus(record.metadata?.status as string | undefined, "verified");
    if (status !== "candidate" && status !== "verified") continue;
    if (hasArchivePending(pending, record.id)) continue;
    if (!shouldArchive({ ...metadata, kind: metadata.kind }, clock, input.archive === undefined ? {} : { archive: input.archive }))
      continue;
    pending.push({ kind: "archive", createdAt: nowIso, id: record.id, reason: "lifecycle", prevStatus: status });
    proposed += 1;
  }
  if (proposed > 0) {
    await saveScopedLedger(input.ledgerFile, { pending, ...(ledger.stats ? { stats: ledger.stats } : {}) });
  }
  return { proposed, archived: 0 };
}

/** Health reads the unified note lifecycle: status and use counts come from the notes themselves. */
export async function scopedMemoryHealth(
  memory: Memory,
  ledgerFile: string,
): Promise<{
  notes: { candidate: number; verified: number; archived: number };
  conversionRate: number;
  activationRate: number;
  duplicationRate: number;
}> {
  const ledger = await loadScopedLedger(ledgerFile);
  const counts = { candidate: 0, verified: 0, archived: 0 };
  let used = 0;
  let total = 0;
  for await (const record of exportedRecords(memory)) {
    const note = parseMemoryNoteMetadata(record.metadata);
    if (note === undefined) continue;
    total += 1;
    if ((note.useSessions ?? 0) > 0) used += 1;
    const status = normalizeNoteStatus(record.metadata?.status as string | undefined, "verified");
    if (status === "candidate" || status === "verified" || status === "archived") counts[status] += 1;
  }
  const ladder = counts.candidate + counts.verified;
  const writes = ledger.stats?.writes ?? 0;
  return {
    notes: counts,
    conversionRate: ladder > 0 ? counts.verified / ladder : 0,
    activationRate: total > 0 ? used / total : 0,
    duplicationRate: writes > 0 ? (ledger.stats?.duplicates ?? 0) / writes : 0,
  };
}