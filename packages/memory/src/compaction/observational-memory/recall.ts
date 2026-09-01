import type { SessionEntry } from "@arnilo/prism";
import { isEligibleObservationSourceEntry } from "./coverage-helpers.js";
import { foldObservationalMemoryLedger } from "./ledger.js";
import { HARD_MAX_RECALL_PAGE_LIMIT, resolveRecallPageLimit } from "./limits.js";
import { renderRecentMessageWindow } from "./recent-messages.js";
import { serializeSourceEntries } from "./serialize.js";
import { isMemoryId, type MemoryObservation, type MemoryReflection } from "./types.js";

export type RecallKind = "observation" | "reflection";
export type RecallPageDirection = "forward" | "backward";
export type RecallPageDetail = "summary" | "full";

export interface MemoryRecallResult {
  readonly found: boolean;
  readonly id: string;
  readonly kind?: RecallKind;
  readonly observation?: MemoryObservation;
  readonly reflection?: MemoryReflection;
  readonly supportingObservations?: readonly MemoryObservation[];
  readonly droppedSupportingObservationIds?: readonly string[];
  readonly missingSupportingObservationIds?: readonly string[];
  readonly sourceEntries?: readonly SessionEntry[];
  readonly missingSourceEntryIds?: readonly string[];
  readonly dropped?: boolean;
  readonly text: string;
  readonly reason?: "invalid_id" | "not_found";
}

export interface RecallBranchPageRequest {
  readonly cursor: string;
  readonly limit?: number;
  readonly direction?: RecallPageDirection;
  readonly detail?: RecallPageDetail;
}

export interface RecallBranchPageResult {
  readonly found: boolean;
  readonly cursor: string;
  readonly direction: RecallPageDirection;
  readonly limit: number;
  readonly entries: readonly SessionEntry[];
  readonly nextCursor?: string;
  readonly prevCursor?: string;
  readonly text: string;
  readonly reason?: "invalid_cursor" | "cursor_not_found" | "cursor_not_message" | "limit_exceeded";
}

export function recallObservationalMemory(
  entries: readonly SessionEntry[],
  id: string,
  secrets: readonly (string | undefined)[] = [],
): MemoryRecallResult {
  if (!isMemoryId(id)) return { found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." };
  const ledger = foldObservationalMemoryLedger(entries);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const dropped = new Set(ledger.droppedObservationIds);
  const observation = ledger.observations.find((item) => item.id === id);
  if (observation) return recallObservation(id, observation, entryById, dropped.has(id), secrets);

  const reflection = ledger.reflections.find((item) => item.id === id);
  if (reflection) {
    const observationById = new Map(ledger.observations.map((item) => [item.id, item]));
    const supportingObservations = reflection.supportingObservationIds.flatMap((obsId) => {
      const item = observationById.get(obsId);
      return item ? [item] : [];
    });
    const droppedSupportingObservationIds = reflection.supportingObservationIds.filter((obsId) => dropped.has(obsId));
    const missingSupportingObservationIds = reflection.supportingObservationIds.filter((obsId) => !observationById.has(obsId));
    const sourceIds = new Set(supportingObservations.flatMap((item) => item.sourceEntryIds));
    const sourceEntries = [...sourceIds].flatMap((sourceId) => entryById.get(sourceId) ?? []);
    const missingSourceEntryIds = [...sourceIds].filter((sourceId) => !entryById.has(sourceId));
    const text = [
      `Reflection [${id}]: ${reflection.content}`,
      "",
      "Supporting observations:",
      ...supportingObservations.map((item) => `- [${item.id}]${dropped.has(item.id) ? " (dropped)" : ""} ${item.content}`),
      ...(missingSupportingObservationIds.length
        ? ["", `Missing supporting observations: ${missingSupportingObservationIds.join(", ")}`]
        : []),
      "",
      "Source evidence:",
      serializeSourceEntries(sourceEntries, secrets) || "none",
    ].join("\n");
    return {
      found: true,
      id,
      kind: "reflection",
      reflection,
      supportingObservations,
      droppedSupportingObservationIds,
      missingSupportingObservationIds,
      sourceEntries,
      missingSourceEntryIds,
      text,
    };
  }

  return { found: false, id, reason: "not_found", text: `No observation or reflection found for id ${id} on the current branch.` };
}

export function recallObservationalMemoryBranchPage(
  entries: readonly SessionEntry[],
  request: RecallBranchPageRequest,
  secrets: readonly (string | undefined)[] = [],
): RecallBranchPageResult {
  const cursor = typeof request.cursor === "string" ? request.cursor.trim() : "";
  const direction: RecallPageDirection = request.direction === "forward" ? "forward" : "backward";
  const detail: RecallPageDetail = request.detail === "full" ? "full" : "summary";
  if (!cursor) {
    return {
      found: false,
      cursor,
      direction,
      limit: 0,
      entries: [],
      reason: "invalid_cursor",
      text: "Invalid cursor; expected a non-empty current-branch entry id.",
    };
  }
  let limit: number;
  try {
    limit = resolveRecallPageLimit(request.limit);
  } catch {
    return {
      found: false,
      cursor,
      direction,
      limit: request.limit ?? 0,
      entries: [],
      reason: "limit_exceeded",
      text: `Page limit must be a positive safe integer at most ${HARD_MAX_RECALL_PAGE_LIMIT}.`,
    };
  }

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const cursorEntry = entryById.get(cursor);
  if (!cursorEntry) {
    return {
      found: false,
      cursor,
      direction,
      limit,
      entries: [],
      reason: "cursor_not_found",
      text: `Cursor entry ${cursor} was not found on the current branch.`,
    };
  }
  if (!isEligibleObservationSourceEntry(cursorEntry)) {
    return {
      found: false,
      cursor,
      direction,
      limit,
      entries: [],
      reason: "cursor_not_message",
      text: `Cursor entry ${cursor} is not an eligible user/assistant/tool message on the current branch.`,
    };
  }

  const messages = entries.filter(isEligibleObservationSourceEntry);
  const index = messages.findIndex((entry) => entry.id === cursor);
  const start = direction === "backward" ? Math.max(0, index - limit + 1) : index;
  const end = direction === "backward" ? index + 1 : Math.min(messages.length, index + limit);
  const page = messages.slice(start, end);
  const text = detail === "full" ? serializeSourceEntries(page, secrets) || "none" : renderRecentMessageWindow(page, secrets) || "none";
  return {
    found: true,
    cursor,
    direction,
    limit,
    entries: page,
    nextCursor: direction === "backward" && start > 0 ? messages[start - 1]?.id : messages[end]?.id,
    prevCursor: direction === "forward" && end < messages.length ? messages[end]?.id : messages[start - 1]?.id,
    text,
  };
}

function recallObservation(
  id: string,
  observation: MemoryObservation,
  entryById: Map<string, SessionEntry>,
  dropped: boolean,
  secrets: readonly (string | undefined)[],
): MemoryRecallResult {
  const sourceEntries = observation.sourceEntryIds.flatMap((sourceId) => entryById.get(sourceId) ?? []);
  const missingSourceEntryIds = observation.sourceEntryIds.filter((sourceId) => !entryById.has(sourceId));
  const text = [
    `Observation [${id}]${dropped ? " (dropped)" : ""}: ${observation.content}`,
    "",
    "Source evidence:",
    serializeSourceEntries(sourceEntries, secrets) || "none",
  ].join("\n");
  return { found: true, id, kind: "observation", observation, sourceEntries, missingSourceEntryIds, dropped, text };
}
