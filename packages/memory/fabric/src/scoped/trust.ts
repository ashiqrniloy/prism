import { MemoryValidationError } from "@arnilo/prism-memory-core";
import type { MemoryFabric } from "../types.js";
import { loadScopedLedger, saveScopedLedger } from "./ledger.js";

// Variation selectors (U+FE00-U+FE0F) combine with the preceding character, so they need an
// alternation instead of a character class (biome noMisleadingCharacterClass).
const INVISIBLE = /(?:[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|[\uFE00-\uFE0F])/;
// `curl -s https://` and other bounded flag forms are commands too; the gap is capped so this
// cannot scan a whole note.
const EXFIL = /\b(?:curl|wget)\b[^\n]{0,80}?https?:\/\/|\bexfiltrat|\/etc\/passwd|\binvoke-webrequest\b/i;
const INJECT =
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b|\bdisregard\s+(?:all\s+)?(?:previous|prior)\s+instructions\b|\byou\s+are\s+now\b|\bsystem\s+prompt\b|\bjailbreak\b/i;
const GIST_CHARS = 80;

/**
 * Strip only invisible code points that have a normal textual use: emoji variation selectors and
 * ZWJ sequences, spacing/bidi marks next to whitespace or punctuation, the math function-application
 * mark, and a soft hyphen inside mojibake. Deliberately hidden code points between letters (the
 * adversarial shape) survive and are refused. Exchange archive scans and stores this form.
 */
export function normalizeScopedMemoryContent(text: string): string {
  if (typeof text !== "string") return text;
  return text
    .replace(/\u2061/gu, "")
    .replace(/(?<=\p{Extended_Pictographic})\uFE0F/gu, "")
    .replace(/(?<=[0-9#*])\uFE0F(?=\u20E3)/gu, "")
    .replace(/(?<=\p{Extended_Pictographic})\u200D(?=\p{Extended_Pictographic})/gu, "")
    .replace(/(?<=\p{Extended_Pictographic})\u200D(?=$|[^\p{L}])/gu, "")
    .replace(/(^|[\s\p{P}\p{S}])\u200B/gu, "$1")
    .replace(/\u200B(?=$|[\s\p{P}\p{S}])/gu, "")
    .replace(/(?<=[^\x00-\x7F])\u200B|\u200B(?=[^\x00-\x7F])/gu, "")
    .replace(/(^|[\s\p{P}\p{S}])[\u200E\u200F](?=$|[\s\p{P}\p{S}])/gu, "$1")
    .replace(/(^|\n\s*(?:[>*+-]\s+)?)\uFEFF/gu, "$1")
    .replace(/(?<=[\u0080-\u00FF])\u00AD|\u00AD(?=[\u0080-\u00FF])/gu, "");
}

export function scanScopedMemoryContent(
  text: string,
): { readonly ok: true } | { readonly ok: false; readonly class: "prompt-injection" | "exfil" | "invisible-unicode" } {
  if (typeof text !== "string") return { ok: false, class: "prompt-injection" };
  const normalized = normalizeScopedMemoryContent(text);
  if (INVISIBLE.test(normalized)) return { ok: false, class: "invisible-unicode" };
  if (EXFIL.test(normalized)) return { ok: false, class: "exfil" };
  if (INJECT.test(normalized)) return { ok: false, class: "prompt-injection" };
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
    const note = await input.fabric.remember(
      {
        kind,
        content,
        sourceEntryIds,
        consent: { visible: true, source: "agent" },
      },
      { status: "candidate" },
    );
    // A folded rewrite keeps the original write time; a fresh note carries this approval's time.
    const duplicate = note.ingestedAt < new Date().toISOString();
    await saveScopedLedger(input.ledgerFile, {
      pending: rest,
      stats: { writes: (ledger.stats?.writes ?? 0) + 1, duplicates: (ledger.stats?.duplicates ?? 0) + (duplicate ? 1 : 0) },
    });
    return;
  }
  if (item.kind === "archive") {
    const forgotten = await input.fabric.forget({ id: input.id });
    if (forgotten.held || !forgotten.deleted) throw new MemoryValidationError("pending archive is held");
    await saveScopedLedger(input.ledgerFile, { pending: rest, ...(ledger.stats ? { stats: ledger.stats } : {}) });
    return;
  }
  throw new MemoryValidationError("unknown pending kind");
}

export async function rejectScopedPending(input: { readonly ledgerFile: string; readonly id: string }): Promise<void> {
  if (typeof input.id !== "string" || input.id.length === 0) throw new MemoryValidationError("id");
  const ledger = await loadScopedLedger(input.ledgerFile);
  const { rest } = takePending(ledger.pending, input.id);
  // Rejecting a proposal changes nothing: the proposal never touched the note's lifecycle.
  await saveScopedLedger(input.ledgerFile, { pending: rest, ...(ledger.stats ? { stats: ledger.stats } : {}) });
}
