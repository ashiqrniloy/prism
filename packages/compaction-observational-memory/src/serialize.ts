import type { SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";

export function serializeSessionEntry(entry: SessionEntry, secrets: readonly (string | undefined)[] = []): string {
  const text = entry.message ? JSON.stringify(entry.message) : entry.summary ?? JSON.stringify(entry.data ?? entry.event ?? entry.metadata ?? {});
  return redactSecrets(`[${entry.id}] ${entry.kind}: ${text}`, secrets);
}

export function serializeSourceEntries(entries: readonly SessionEntry[], secrets: readonly (string | undefined)[] = []): string {
  return entries.map((entry) => serializeSessionEntry(entry, secrets)).join("\n");
}
