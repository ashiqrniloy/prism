import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface ScopedLedgerNote {
  readonly uses: number;
  readonly lastUsedAt?: string;
  readonly createdAt?: string;
  readonly status?: string;
  readonly promotedAt?: string;
}

export interface ScopedMemoryLedger {
  readonly notes: Record<string, ScopedLedgerNote>;
  readonly pending: readonly unknown[];
  readonly stats?: { readonly writes: number; readonly duplicates: number };
}

const EMPTY: ScopedMemoryLedger = Object.freeze({ notes: Object.freeze({}), pending: Object.freeze([]) });

export function scopedLedgerPath(scopeRoot: string): string {
  return join(scopeRoot, ".memory", "state.json");
}

function asNote(row: unknown): ScopedLedgerNote | undefined {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return undefined;
  const rec = row as Record<string, unknown>;
  const uses = rec.uses;
  return {
    uses: typeof uses === "number" && Number.isFinite(uses) && uses >= 0 ? uses : 0,
    ...(typeof rec.lastUsedAt === "string" && rec.lastUsedAt ? { lastUsedAt: rec.lastUsedAt } : {}),
    ...(typeof rec.createdAt === "string" && rec.createdAt ? { createdAt: rec.createdAt } : {}),
    ...(typeof rec.status === "string" && rec.status ? { status: rec.status } : {}),
    ...(typeof rec.promotedAt === "string" && rec.promotedAt ? { promotedAt: rec.promotedAt } : {}),
  };
}

function parseScopedLedger(raw: string): ScopedMemoryLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;
  const notesIn = (parsed as { notes?: unknown }).notes;
  if (notesIn === null || typeof notesIn !== "object" || Array.isArray(notesIn)) return EMPTY;
  const notes: Record<string, ScopedLedgerNote> = {};
  for (const [id, row] of Object.entries(notesIn as Record<string, unknown>)) {
    if (!id) continue;
    const note = asNote(row);
    if (note) notes[id] = note;
  }
  const pending = (parsed as { pending?: unknown }).pending;
  const statsIn = (parsed as { stats?: unknown }).stats;
  const stats =
    statsIn !== null && typeof statsIn === "object" && !Array.isArray(statsIn) ? asStats(statsIn as Record<string, unknown>) : undefined;
  return {
    notes,
    pending: Array.isArray(pending) ? pending : [],
    ...(stats ? { stats } : {}),
  };
}

function asStats(row: Record<string, unknown>): { writes: number; duplicates: number } | undefined {
  const writes = row.writes;
  const duplicates = row.duplicates;
  if (
    typeof writes !== "number" ||
    typeof duplicates !== "number" ||
    !Number.isFinite(writes) ||
    !Number.isFinite(duplicates) ||
    writes < 0 ||
    duplicates < 0
  ) {
    return undefined;
  }
  return { writes, duplicates };
}

export async function loadScopedLedger(path: string): Promise<ScopedMemoryLedger> {
  try {
    return parseScopedLedger(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
}

export function touchScopedLedger(ledger: ScopedMemoryLedger, ids: readonly string[], nowIso: string): ScopedMemoryLedger {
  const notes = { ...ledger.notes };
  for (const id of ids) {
    const prev = notes[id];
    notes[id] = { ...prev, uses: (prev?.uses ?? 0) + 1, lastUsedAt: nowIso };
  }
  return { notes, pending: ledger.pending, ...(ledger.stats ? { stats: ledger.stats } : {}) };
}

export async function saveScopedLedger(path: string, ledger: ScopedMemoryLedger): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.state.${randomBytes(8).toString("hex")}.tmp`);
  // ponytail: last-write-wins rename; per-scope lock if concurrent recalls collide
  try {
    await writeFile(
      tmp,
      JSON.stringify({
        notes: ledger.notes,
        pending: ledger.pending,
        ...(ledger.stats ? { stats: ledger.stats } : {}),
      }),
      { encoding: "utf8", flag: "wx" },
    );
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}
