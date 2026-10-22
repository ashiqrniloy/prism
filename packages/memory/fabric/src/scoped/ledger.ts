import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * The scoped ledger keeps only what the note lifecycle does not own: pending approvals and write
 * statistics (plan 188.4 Task 1). Note status and use counts live on the note.
 */
export interface ScopedMemoryLedger {
  readonly pending: readonly unknown[];
  readonly stats?: { readonly writes: number; readonly duplicates: number };
}

const EMPTY: ScopedMemoryLedger = Object.freeze({ pending: Object.freeze([]) });
/** Ledger files already reported as carrying retired lifecycle fields; one log per file per process. */
const reportedLegacy = new Set<string>();

let legacySink: ((ignored: number) => void) | undefined;

/** Where a legacy ledger report goes; the fabric package wires it to `prism.status`. */
export function onLegacyScopedLedger(sink: ((ignored: number) => void) | undefined): void {
  legacySink = sink;
}

export function scopedLedgerPath(scopeRoot: string): string {
  return join(scopeRoot, ".memory", "state.json");
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

/** Retired per-note lifecycle rows (`uses`, `status`, `lastUsedAt`, `promotedAt`, `createdAt`). */
const LEGACY_FIELDS = ["uses", "status", "lastUsedAt", "promotedAt", "createdAt"] as const;

function legacyRowCount(value: unknown): number {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;
  let count = 0;
  for (const row of Object.values(value as Record<string, unknown>)) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    if (LEGACY_FIELDS.some((field) => field in (row as Record<string, unknown>))) count += 1;
  }
  return count;
}

function parseScopedLedger(raw: string): { ledger: ScopedMemoryLedger; ignored: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ledger: EMPTY, ignored: 0 };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ledger: EMPTY, ignored: 0 };
  const pending = (parsed as { pending?: unknown }).pending;
  const statsIn = (parsed as { stats?: unknown }).stats;
  const stats =
    statsIn !== null && typeof statsIn === "object" && !Array.isArray(statsIn) ? asStats(statsIn as Record<string, unknown>) : undefined;
  return {
    ledger: { pending: Array.isArray(pending) ? pending : [], ...(stats ? { stats } : {}) },
    ignored: legacyRowCount((parsed as { notes?: unknown }).notes),
  };
}

/**
 * Read the ledger. A file written by an earlier build is still read for its pending approvals and
 * statistics; its retired note-lifecycle fields are ignored and reported once per file.
 */
export async function loadScopedLedger(
  path: string,
  options: { readonly onLegacy?: (ignored: number) => void } = {},
): Promise<ScopedMemoryLedger> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
  const { ledger, ignored } = parseScopedLedger(raw);
  if (ignored > 0) {
    const key = resolve(path);
    if (!reportedLegacy.has(key)) {
      reportedLegacy.add(key);
      (options.onLegacy ?? legacySink)?.(ignored);
    }
  }
  return ledger;
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