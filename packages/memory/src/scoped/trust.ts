import { MemoryValidationError } from "../errors.js";
import type { MemoryFabric } from "../fabric/types.js";
import { loadScopedLedger, saveScopedLedger } from "./ledger.js";

// Variation selectors (U+FE00-U+FE0F) combine with the preceding character, so they need an
// alternation instead of a character class (biome noMisleadingCharacterClass).
const INVISIBLE = /(?:[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|[\uFE00-\uFE0F])/;
const EXFIL = /\b(?:curl|wget)\s+https?:\/\/|\bexfiltrat|\/etc\/passwd|\binvoke-webrequest\b/i;
const INJECT =
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b|\bdisregard\s+(?:all\s+)?(?:previous|prior)\s+instructions\b|\byou\s+are\s+now\b|\bsystem\s+prompt\b|\bjailbreak\b/i;
const GIST_CHARS = 80;

export function scanScopedMemoryContent(
  text: string,
): { readonly ok: true } | { readonly ok: false; readonly class: "prompt-injection" | "exfil" | "invisible-unicode" } {
  if (typeof text !== "string") return { ok: false, class: "prompt-injection" };
  if (INVISIBLE.test(text)) return { ok: false, class: "invisible-unicode" };
  if (EXFIL.test(text)) return { ok: false, class: "exfil" };
  if (INJECT.test(text)) return { ok: false, class: "prompt-injection" };
  return { ok: true };
}

export function gateScopedMemoryContent(text: string): void {
  const scan = scanScopedMemoryContent(text);
  if (!scan.ok) throw new MemoryValidationError(`scoped memory refused: ${scan.class}`);
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

function gist(value: string): string {
  return value.length <= GIST_CHARS ? value : value.slice(0, GIST_CHARS);
}

export async function listScopedPending(
  ledgerFile: string,
): Promise<readonly { readonly id: string; readonly kind: "review" | "archive"; readonly gist: string; readonly createdAt: string }[]> {
  const ledger = await loadScopedLedger(ledgerFile);
  const out: { id: string; kind: "review" | "archive"; gist: string; createdAt: string }[] = [];
  for (const item of ledger.pending) {
    const rec = asRecord(item);
    if (!rec || typeof rec.id !== "string" || rec.id.length === 0) continue;
    const createdAt = typeof rec.createdAt === "string" ? rec.createdAt : "";
    if (rec.kind === "review") {
      const proposal = asRecord(rec.proposal);
      const content = typeof proposal?.content === "string" ? proposal.content : "";
      out.push({ id: rec.id, kind: "review", gist: gist(content), createdAt });
    } else if (rec.kind === "archive") {
      out.push({ id: rec.id, kind: "archive", gist: typeof rec.reason === "string" ? rec.reason : "archive", createdAt });
    }
  }
  return out;
}

function takePending(pending: readonly unknown[], id: string): { item: Record<string, unknown>; rest: unknown[] } {
  const rest: unknown[] = [];
  let item: Record<string, unknown> | undefined;
  for (const raw of pending) {
    const rec = asRecord(raw);
    if (item === undefined && rec?.id === id) item = rec;
    else rest.push(raw);
  }
  if (!item) throw new MemoryValidationError("unknown pending id");
  return { item, rest };
}

export async function approveScopedPending(input: {
  readonly fabric: MemoryFabric;
  readonly ledgerFile: string;
  readonly id: string;
}): Promise<void> {
  if (typeof input.id !== "string" || input.id.length === 0) throw new MemoryValidationError("id");
  const ledger = await loadScopedLedger(input.ledgerFile);
  const { item, rest } = takePending(ledger.pending, input.id);
  if (item.kind === "review") {
    const proposal = asRecord(item.proposal);
    const kind = proposal?.kind;
    const content = proposal?.content;
    const sourceEntryIds = proposal?.sourceEntryIds;
    if ((kind !== "fact" && kind !== "procedure") || typeof content !== "string") {
      throw new MemoryValidationError("pending review is malformed");
    }
    if (!Array.isArray(sourceEntryIds) || sourceEntryIds.length === 0 || sourceEntryIds.some((id) => typeof id !== "string" || !id)) {
      throw new MemoryValidationError("pending review is malformed");
    }
    gateScopedMemoryContent(content);
    const note = await input.fabric.remember({
      kind,
      content,
      sourceEntryIds,
      consent: { visible: true, source: "agent" },
    });
    const nowIso = new Date().toISOString();
    const notes = { ...ledger.notes };
    const prev = notes[note.id];
    notes[note.id] = {
      uses: prev?.uses ?? 0,
      status: prev?.status ?? "candidate",
      createdAt: prev?.createdAt ?? nowIso,
      ...(prev?.lastUsedAt ? { lastUsedAt: prev.lastUsedAt } : {}),
      ...(prev?.promotedAt ? { promotedAt: prev.promotedAt } : {}),
    };
    await saveScopedLedger(input.ledgerFile, {
      notes,
      pending: rest,
      stats: { writes: (ledger.stats?.writes ?? 0) + 1, duplicates: (ledger.stats?.duplicates ?? 0) + (prev ? 1 : 0) },
    });
    return;
  }
  if (item.kind === "archive") {
    const forgotten = await input.fabric.forget({ id: input.id });
    if (forgotten.held || !forgotten.deleted) throw new MemoryValidationError("pending archive is held");
    await saveScopedLedger(input.ledgerFile, {
      notes: ledger.notes,
      pending: rest,
      ...(ledger.stats ? { stats: ledger.stats } : {}),
    });
    return;
  }
  throw new MemoryValidationError("unknown pending kind");
}

export async function rejectScopedPending(input: { readonly ledgerFile: string; readonly id: string }): Promise<void> {
  if (typeof input.id !== "string" || input.id.length === 0) throw new MemoryValidationError("id");
  const ledger = await loadScopedLedger(input.ledgerFile);
  const { item, rest } = takePending(ledger.pending, input.id);
  const notes = { ...ledger.notes };
  if (item.kind === "archive") {
    const row = notes[input.id];
    if (row) {
      const prevStatus = item.prevStatus === "verified" ? "verified" : "candidate";
      notes[input.id] = { ...row, status: prevStatus };
    }
  }
  await saveScopedLedger(input.ledgerFile, {
    notes,
    pending: rest,
    ...(ledger.stats ? { stats: ledger.stats } : {}),
  });
}
