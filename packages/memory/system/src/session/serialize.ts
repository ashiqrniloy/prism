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
 */
export function serializeSourceBatches(
  entries: readonly SessionEntry[],
  secrets: readonly (string | undefined)[],
  maxBytes: number,
  /**
   * Where a batch of several entries closes (plan 217 Task 6): a backlog splits into passes of about this size
   * instead of one batch up to `maxBytes`. Only `maxBytes` ever cuts an entry; one entry larger than the target
   * travels alone, whole.
   */
  targetBytes: number = maxBytes,
): readonly SourceBatch[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw new RangeError("maxBytes must be a safe integer of at least 256");
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 256) throw new RangeError("targetBytes must be a safe integer of at least 256");
  const closeAt = Math.min(maxBytes, targetBytes);
  const batches: SourceBatch[] = [];
  let batch: SessionEntry[] = [];
  let text = "";
  let bytes = 0;
  const close = (): void => {
    if (batch.length) batches.push({ entries: batch, text });
    batch = [];
    text = "";
    bytes = 0;
  };
  for (const entry of entries) {
    const serialized = serializeSessionEntry(entry, secrets);
    const size = Buffer.byteLength(serialized, "utf8");
    if (size > maxBytes) {
      // An entry that cannot fit even alone travels by itself, cut, with a marker.
      close();
      batches.push({ entries: [entry], text: truncatedEntry(entry, serialized, size, maxBytes) });
      continue;
    }
    // Same text `serializeSourceEntries` writes: a gap line when ten minutes passed in this batch.
    const gap = gapMarker(batch.at(-1), entry);
    const piece = gap ? `${gap}\n${serialized}` : serialized;
    const added = Buffer.byteLength(piece, "utf8") + (text ? 1 : 0);
    if (batch.length && bytes + added > closeAt) {
      close();
      batch.push(entry);
      text = serialized;
      bytes = size;
      continue;
    }
    batch.push(entry);
    text += `${text ? "\n" : ""}${piece}`;
    bytes += added;
  }
  close();
  return batches;
}

function truncatedEntry(entry: SessionEntry, full: string, size: number, maxBytes: number): string {
  const marker = `\n[truncated: entry ${entry.id} is ${size} bytes; the rest was not sent]`;
  return `${truncateWorkerText(full, maxBytes - Buffer.byteLength(marker, "utf8"))}${marker}`;
}
