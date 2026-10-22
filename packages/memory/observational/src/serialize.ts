import type { SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import { measureWorkerJson } from "./limits.js";

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
  const serialized = redactSecrets(`[${entry.timestamp}] [${entry.id}] ${entry.kind}: ${text}`, secrets);
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
    const elapsed = previous ? Date.parse(entry.timestamp) - Date.parse(previous.timestamp) : 0;
    if (elapsed >= 600_000) {
      const [unit, size] =
        elapsed >= 86_400_000
          ? (["d", 86_400_000] as const)
          : elapsed >= 3_600_000
            ? (["h", 3_600_000] as const)
            : (["m", 60_000] as const);
      output += `${output ? "\n" : ""}[gap: ${Math.floor(elapsed / size)}${unit}]`;
    }
    previous = entry;
    const remaining = maxBytes === undefined ? undefined : maxBytes - Buffer.byteLength(output, "utf8") - (output ? 1 : 0);
    if (remaining !== undefined && remaining < 1) throw new Error(`Observational memory source entries exceed ${maxBytes} bytes`);
    const serialized = serializeSessionEntry(entry, secrets, remaining);
    output += `${output ? "\n" : ""}${serialized}`;
  }
  return output;
}
