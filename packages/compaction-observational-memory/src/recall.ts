import type { SessionEntry } from "@arnilo/prism";
import { activeObservations, foldObservationalMemoryLedger } from "./ledger.js";
import { serializeSourceEntries } from "./serialize.js";
import { isMemoryId, type MemoryObservation, type MemoryReflection } from "./types.js";

export type RecallKind = "observation" | "reflection";

export interface MemoryRecallResult {
  readonly found: boolean;
  readonly id: string;
  readonly kind?: RecallKind;
  readonly observation?: MemoryObservation;
  readonly reflection?: MemoryReflection;
  readonly supportingObservations?: readonly MemoryObservation[];
  readonly sourceEntries?: readonly SessionEntry[];
  readonly missingSourceEntryIds?: readonly string[];
  readonly dropped?: boolean;
  readonly text: string;
  readonly reason?: "invalid_id" | "not_found";
}

export function recallObservationalMemory(entries: readonly SessionEntry[], id: string, secrets: readonly (string | undefined)[] = []): MemoryRecallResult {
  if (!isMemoryId(id)) return { found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." };
  const ledger = foldObservationalMemoryLedger(entries);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const dropped = new Set(ledger.droppedObservationIds);
  const observation = ledger.observations.find((item) => item.id === id);
  if (observation) return recallObservation(id, observation, entryById, dropped.has(id), secrets);

  const reflection = ledger.reflections.find((item) => item.id === id);
  if (reflection) {
    const activeById = new Map(activeObservations(ledger).map((item) => [item.id, item]));
    const supportingObservations = reflection.supportingObservationIds.flatMap((obsId) => activeById.get(obsId) ?? []);
    const sourceIds = new Set(supportingObservations.flatMap((item) => item.sourceEntryIds));
    const sourceEntries = [...sourceIds].flatMap((sourceId) => entryById.get(sourceId) ?? []);
    const missingSourceEntryIds = [...sourceIds].filter((sourceId) => !entryById.has(sourceId));
    const text = [`Reflection [${id}]: ${reflection.content}`, "", "Supporting observations:", ...supportingObservations.map((item) => `- [${item.id}] ${item.content}`), "", "Source evidence:", serializeSourceEntries(sourceEntries, secrets) || "none"].join("\n");
    return { found: true, id, kind: "reflection", reflection, supportingObservations, sourceEntries, missingSourceEntryIds, text };
  }

  return { found: false, id, reason: "not_found", text: `No observation or reflection found for id ${id} on the current branch.` };
}

function recallObservation(id: string, observation: MemoryObservation, entryById: Map<string, SessionEntry>, dropped: boolean, secrets: readonly (string | undefined)[]): MemoryRecallResult {
  const sourceEntries = observation.sourceEntryIds.flatMap((sourceId) => entryById.get(sourceId) ?? []);
  const missingSourceEntryIds = observation.sourceEntryIds.filter((sourceId) => !entryById.has(sourceId));
  const text = [`Observation [${id}]${dropped ? " (dropped)" : ""}: ${observation.content}`, "", "Source evidence:", serializeSourceEntries(sourceEntries, secrets) || "none"].join("\n");
  return { found: true, id, kind: "observation", observation, sourceEntries, missingSourceEntryIds, dropped, text };
}
