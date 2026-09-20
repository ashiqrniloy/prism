import { MemoryValidationError } from "../errors.js";
import type { Memory } from "../types.js";
import { loadScopedLedger, saveScopedLedger, type ScopedMemoryLedger } from "./ledger.js";

type LifecycleSettings = {
  readonly promotion: { readonly reuseThreshold: number };
  readonly decay: { readonly tauDays: number; readonly candidateArchiveDays: number };
};

const DAY_MS = 86_400_000;
/** ponytail: floor=1 (one effective use); knob if a workload needs a different cutoff */
const DECAY_FLOOR = 1;
/** ponytail: stop if a store lies about nextCursor; 10k pages ≈ 1M rows at default page size */
const MAX_EXPORT_PAGES = 10_000;

function statusOf(status: string | undefined): "candidate" | "verified" | "archived" {
  return status === "verified" || status === "archived" ? status : "candidate";
}

function ageDays(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, (now - t) / DAY_MS);
}

function decayScore(uses: number, age: number, tauDays: number): number {
  const u = Number.isFinite(uses) && uses > 0 ? uses : 0;
  const tau = Number.isFinite(tauDays) && tauDays > 0 ? tauDays : 30;
  return u * Math.exp(-age / tau);
}

function hasArchivePending(pending: readonly unknown[], id: string): boolean {
  return pending.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const rec = item as { kind?: unknown; id?: unknown };
    return rec.kind === "archive" && rec.id === id;
  });
}

async function listExportedIds(memory: Memory): Promise<Set<string>> {
  if (typeof memory.exportMemory !== "function") {
    throw new MemoryValidationError("promotion/GC requires memory.exportMemory");
  }
  const threadId = memory.scope.threadId;
  if (!threadId) throw new MemoryValidationError("threadId");
  const identity = { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId, threadId };
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let n = 0; n < MAX_EXPORT_PAGES; n++) {
    const page = await memory.exportMemory({ identity, ...(cursor ? { cursor } : {}) });
    for (const entry of page.entries) ids.add(entry.id);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return ids;
}

export async function runScopedPromotionPass(input: {
  readonly memory: Memory;
  readonly ledgerFile: string;
  readonly settings: LifecycleSettings;
  readonly now?: number;
}): Promise<{ promoted: number }> {
  const live = await listExportedIds(input.memory);
  const ledger = await loadScopedLedger(input.ledgerFile);
  const nowIso = new Date(input.now ?? Date.now()).toISOString();
  const notes = { ...ledger.notes };
  let promoted = 0;
  for (const [id, row] of Object.entries(notes)) {
    if (!live.has(id)) continue;
    if (statusOf(row.status) !== "candidate") continue;
    if (row.uses < input.settings.promotion.reuseThreshold) continue;
    notes[id] = {
      uses: row.uses,
      status: "verified",
      promotedAt: nowIso,
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
    };
    promoted += 1;
  }
  if (promoted > 0) {
    await saveScopedLedger(input.ledgerFile, {
      notes,
      pending: ledger.pending,
      ...(ledger.stats ? { stats: ledger.stats } : {}),
    });
  }
  return { promoted };
}

export async function runScopedGcPass(input: {
  readonly memory: Memory;
  readonly ledgerFile: string;
  readonly settings: LifecycleSettings;
  readonly now?: number;
}): Promise<{ proposed: number; archived: number }> {
  const live = await listExportedIds(input.memory);
  const ledger = await loadScopedLedger(input.ledgerFile);
  const now = input.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const notes = { ...ledger.notes };
  const pending: unknown[] = [...ledger.pending];
  let proposed = 0;
  for (const [id, row] of Object.entries(notes)) {
    if (!live.has(id)) continue;
    if (statusOf(row.status) === "archived" || hasArchivePending(pending, id)) continue;
    const unused = ageDays(row.lastUsedAt ?? row.createdAt, now);
    const status = statusOf(row.status);
    let reason: "stale-candidate" | "decay" | undefined;
    if (status === "candidate" && unused !== undefined && unused >= input.settings.decay.candidateArchiveDays) {
      reason = "stale-candidate";
    } else if (status === "verified" && unused !== undefined && decayScore(row.uses, unused, input.settings.decay.tauDays) < DECAY_FLOOR) {
      reason = "decay";
    }
    if (!reason) continue;
    notes[id] = { ...row, status: "archived" };
    pending.push({ kind: "archive", createdAt: nowIso, id, reason, prevStatus: status });
    proposed += 1;
  }
  if (proposed > 0) {
    await saveScopedLedger(input.ledgerFile, {
      notes,
      pending,
      ...(ledger.stats ? { stats: ledger.stats } : {}),
    });
  }
  return { proposed, archived: 0 };
}

export async function scopedMemoryHealth(ledgerFile: string): Promise<{
  notes: { candidate: number; verified: number; archived: number };
  conversionRate: number;
  activationRate: number;
  duplicationRate: number;
}> {
  const ledger: ScopedMemoryLedger = await loadScopedLedger(ledgerFile);
  let candidate = 0;
  let verified = 0;
  let archived = 0;
  let used = 0;
  let total = 0;
  for (const row of Object.values(ledger.notes)) {
    total += 1;
    if (row.uses > 0) used += 1;
    const status = statusOf(row.status);
    if (status === "verified") verified += 1;
    else if (status === "archived") archived += 1;
    else candidate += 1;
  }
  const ladder = candidate + verified;
  const writes = ledger.stats?.writes ?? 0;
  return {
    notes: { candidate, verified, archived },
    conversionRate: ladder > 0 ? verified / ladder : 0,
    activationRate: total > 0 ? used / total : 0,
    duplicationRate: writes > 0 ? (ledger.stats?.duplicates ?? 0) / writes : 0,
  };
}
