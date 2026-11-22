import type { SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import { measureWorkerJson, truncateWorkerText } from "@arnilo/prism-memory-system/core";

export function serializeSessionEntry(entry: SessionEntry, secrets: readonly (string | undefined)[] = [], maxBytes?: number): string {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1))
    throw new RangeError("maxBytes must be a positive safe integer");
  const value = entry.message ?? entry.summary ?? entry.data ?? entry.event ?? entry.metadata ?? {};
  if (maxBytes !== undefined) {
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`Observational memory source entry exceeds ${maxBytes} bytes`);
    } else {
      measureWorkerJson(value, maxBytes, "Observational memory source entry");
    }
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  // Plan 218 Task 4.1: a message line leads with its stored role, so the worker reads the speaker without parsing JSON.
  const label = entry.kind === "message" && entry.message?.role ? entry.message.role : entry.kind;
  const serialized = redactSecrets(`[${entry.timestamp}] [${entry.id}] ${label}: ${text}`, secrets);
  if (maxBytes !== undefined && Buffer.byteLength(serialized, "utf8") > maxBytes)
    throw new Error(`Observational memory source entry exceeds ${maxBytes} bytes`);
  return serialized;
}

export function serializeSourceEntries(
  entries: readonly SessionEntry[],
  secrets: readonly (string | undefined)[] = [],
  maxBytes?: number,
): string {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1))
    throw new RangeError("maxBytes must be a positive safe integer");
  let output = "";
  let previous: SessionEntry | undefined;
  for (const entry of entries) {
    const gap = gapMarker(previous, entry);
    if (gap) output += `${output ? "\n" : ""}${gap}`;
    previous = entry;
    const remaining = maxBytes === undefined ? undefined : maxBytes - Buffer.byteLength(output, "utf8") - (output ? 1 : 0);
    if (remaining !== undefined && remaining < 1) throw new Error(`Observational memory source entries exceed ${maxBytes} bytes`);
    const serialized = serializeSessionEntry(entry, secrets, remaining);
    output += `${output ? "\n" : ""}${serialized}`;
  }
  return output;
}

/** The `[gap: …]` line written before `entry` when ten minutes or more passed since `previous`. */
function gapMarker(previous: SessionEntry | undefined, entry: SessionEntry): string | undefined {
  const elapsed = previous ? Date.parse(entry.timestamp) - Date.parse(previous.timestamp) : 0;
  if (elapsed < 600_000) return undefined;
  const [unit, size] =
    elapsed >= 86_400_000 ? (["d", 86_400_000] as const) : elapsed >= 3_600_000 ? (["h", 3_600_000] as const) : (["m", 60_000] as const);
  return `[gap: ${Math.floor(elapsed / size)}${unit}]`;
}

/** One ordered slice of the unread tail, serialized to fit a byte budget. */
export interface SourceBatch {
  readonly entries: readonly SessionEntry[];
  readonly text: string;
}

/**
 * Splits `entries` into ordered batches whose serialized text each fits `maxBytes`. A tail that fits
 * is one batch whose text equals `serializeSourceEntries(entries, secrets, maxBytes)`. A single entry
 * larger than the budget is redacted, then cut, and ends with a marker naming its id and full size;
 * the marker never carries the cut bytes.
 *
 * A tool call and its results stay in one batch (plan 218.3 Task 12): when a batch closes before a tool result, the
 * assistant message that made the call (and the results already batched) move to the next batch, so STM never sees
 * an output without its call, or a call without its output. An output larger than the budget is cut to what the call
 * leaves.
 */
export function serializeSourceBatches(
  entries: readonly SessionEntry[],
  secrets: readonly (string | undefined)[],
  maxBytes: number,
  /**
   * Where a batch of several entries closes (plan 217 Task 6): a backlog splits into passes of about this size
   * instead of one batch up to `maxBytes`. Only `maxBytes` ever cuts an entry; one entry larger than the target
   * travels alone (with its call), whole.
   */
  targetBytes: number = maxBytes,
): readonly SourceBatch[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw new RangeError("maxBytes must be a safe integer of at least 256");
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 256) throw new RangeError("targetBytes must be a safe integer of at least 256");
  const closeAt = Math.min(maxBytes, targetBytes);
  const batches: SourceBatch[] = [];
  /** One batched entry: its serialized text, and the gap line before it when it does not open a batch. */
  type Piece = { readonly entry: SessionEntry; readonly serialized: string; readonly gap?: string };
  let batch: Piece[] = [];
  const textOf = (pieces: readonly Piece[]): string =>
    pieces.map((piece, i) => (i > 0 && piece.gap ? `${piece.gap}\n${piece.serialized}` : piece.serialized)).join("\n");
  const bytesOf = (pieces: readonly Piece[]): number => Buffer.byteLength(textOf(pieces), "utf8");
  const close = (keep: Piece[] = []): void => {
    if (batch.length) batches.push({ entries: batch.map((piece) => piece.entry), text: textOf(batch) });
    batch = keep;
  };
  /** The open tool round at the batch's end (its call and the results batched so far), when something precedes it. */
  const openRound = (): Piece[] => {
    let at = batch.length - 1;
    while (at >= 0 && roleOf(batch[at]!.entry) === "tool") at -= 1;
    if (at <= 0 || !hasToolCalls(batch[at]!.entry)) return [];
    return batch.splice(at);
  };
  for (const entry of entries) {
    const serialized = serializeSessionEntry(entry, secrets);
    const size = Buffer.byteLength(serialized, "utf8");
    const gap = gapMarker(batch.at(-1)?.entry, entry);
    const isResult = roleOf(entry) === "tool";
    if (size > maxBytes) {
      // An entry that cannot fit even alone travels cut, with a marker, after its call when it is a tool result.
      let round = isResult ? openRound() : [];
      close();
      let roundBytes = round.length ? bytesOf(round) + 1 : 0;
      if (roundBytes > maxBytes / 4) {
        batches.push({ entries: round.map((piece) => piece.entry), text: textOf(round) });
        round = [];
        roundBytes = 0;
      }
      const cut = truncatedEntry(entry, serialized, size, maxBytes - roundBytes);
      batches.push({ entries: [...round.map((piece) => piece.entry), entry], text: round.length ? `${textOf(round)}\n${cut}` : cut });
      continue;
    }
    const piece: Piece = { entry, serialized, ...(gap ? { gap } : {}) };
    if (batch.length && bytesOf([...batch, piece]) > closeAt) {
      const round = isResult ? openRound() : [];
      close(round);
      // A round that no longer fits with this result goes on alone; the result opens its own batch.
      if (batch.length && bytesOf([...batch, piece]) > maxBytes) close();
    }
    batch.push(piece);
  }
  close();
  return batches;
}

function roleOf(entry: SessionEntry): string | undefined {
  return entry.kind === "message" ? entry.message?.role : undefined;
}

/** Whether `entry` is an assistant message that calls a tool. */
export function hasToolCalls(entry: SessionEntry): boolean {
  if (roleOf(entry) !== "assistant") return false;
  const content = entry.message?.content;
  return Array.isArray(content) && content.some((block) => (block as { type?: string }).type === "tool_call");
}

function truncatedEntry(entry: SessionEntry, full: string, size: number, maxBytes: number): string {
  const marker = `\n[truncated: entry ${entry.id} is ${size} bytes; the rest was not sent]`;
  return `${truncateWorkerText(full, maxBytes - Buffer.byteLength(marker, "utf8"))}${marker}`;
}
