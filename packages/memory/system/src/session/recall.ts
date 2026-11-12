import type { SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import { isEligibleObservationSourceEntry } from "./coverage-helpers.js";
import { foldObservationalMemoryLedger, type ObservationalMemoryLedger } from "./ledger.js";
import { HARD_MAX_RECALL_PAGE_LIMIT, resolveRecallPageLimit } from "./limits.js";
import { renderRecentMessageWindow } from "./recent-messages.js";
import { serializeSourceEntries } from "./serialize.js";
import {
  isMemoryId,
  type MemoryChunkRef,
  type MemoryObservation,
  type MemoryTaskState,
  type MemoryTombstone,
  type MemoryWmItem,
} from "./types.js";

export type RecallKind = "observation" | "wm_item" | "task_state";
export type RecallPageDirection = "forward" | "backward";
export type RecallPageDetail = "summary" | "full";
/** Where an STM record stands: on the surface, dropped, or tombstoned by a WM verdict (surface removed, still found). */
export type RecallRecordState = "active" | "dropped" | "tombstoned";

/** One chunk of a recalled STM record: its verbatim text, or why it is gone (`dropped`), or neither when not read. */
export interface RecalledChunk extends MemoryChunkRef {
  readonly text?: string;
  readonly dropped?: string;
}

/** A chunk as the store returned it for the executing session, or `undefined` when the session holds no referrer. */
export type RecallChunkTexts = ReadonlyMap<string, { readonly text: string } | undefined>;

export interface MemoryRecallResult {
  readonly found: boolean;
  readonly id: string;
  readonly kind?: RecallKind;
  readonly observation?: MemoryObservation;
  readonly taskState?: MemoryTaskState;
  readonly wmItem?: MemoryWmItem;
  /** A WM item's state: on the WM surface, or superseded by a later item. */
  readonly superseded?: boolean;
  readonly citedObservations?: readonly MemoryObservation[];
  readonly missingCitedIds?: readonly string[];
  readonly sourceEntries?: readonly SessionEntry[];
  readonly missingSourceEntryIds?: readonly string[];
  readonly dropped?: boolean;
  /** An STM record's state (plan 217 Task 4). */
  readonly state?: RecallRecordState;
  readonly tombstone?: MemoryTombstone;
  /** An STM record's or WM item's chunks, verbatim, or with the reason each one is gone. */
  readonly chunks?: readonly RecalledChunk[];
  readonly text: string;
  readonly reason?: "invalid_id" | "unknown_id" | "revoked";
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

export interface RecallMemoryOptions {
  readonly invalidatedIds?: readonly string[];
  /** `full` adds the raw source entries to an STM record's recall. Default `summary`. */
  readonly detail?: RecallPageDetail;
  /** The ledger, when the caller already folded it (the recall tool folds once to find the chunks to read). */
  readonly ledger?: ObservationalMemoryLedger;
  /** The record's chunks as read from the chunk store for the executing session, by chunk id. */
  readonly chunkTexts?: RecallChunkTexts;
}

export function recallObservationalMemory(
  entries: readonly SessionEntry[],
  id: string,
  secrets: readonly (string | undefined)[] = [],
  options?: RecallMemoryOptions,
): MemoryRecallResult {
  if (!isMemoryId(id)) return { found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." };
  const ledger = options?.ledger ?? foldObservationalMemoryLedger(entries);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const dropped = new Set(ledger.droppedObservationIds);
  const invalidated = new Set(options?.invalidatedIds ?? []);
  const taskState = ledger.taskState;
  if (taskState?.id === id) {
    if (invalidated.has(id) || taskState.sourceEntryIds.some((sourceId) => invalidated.has(sourceId)))
      return { found: true, id, kind: "task_state", reason: "revoked", text: `Task state [${id}] withheld (revoked).` };
    const sourceEntries = taskState.sourceEntryIds.flatMap((sourceId) => entryById.get(sourceId) ?? []);
    return {
      found: true,
      id,
      kind: "task_state",
      taskState,
      sourceEntries,
      missingSourceEntryIds: taskState.sourceEntryIds.filter((sourceId) => !entryById.has(sourceId)),
      text: redactSecrets(
        `Task state [${id}]: ${JSON.stringify(taskState)}\n\nSource evidence:\n${serializeSourceEntries(sourceEntries, secrets) || "none"}`,
        secrets,
      ),
    };
  }
  const observation = ledger.observations.find((item) => item.id === id);
  if (observation) {
    const revoked = invalidated.has(id) || observation.sourceEntryIds.some((sourceId) => invalidated.has(sourceId));
    if (revoked) {
      return {
        found: true,
        id,
        kind: "observation",
        dropped: true,
        reason: "revoked",
        text: `Observation [${id}] withheld (revoked). sources: ${observation.sourceEntryIds.join(", ") || "none"}; time: ${observation.timestamp}.`,
      };
    }
    const state: RecallRecordState = Object.hasOwn(ledger.tombstones ?? {}, id) ? "tombstoned" : dropped.has(id) ? "dropped" : "active";
    return recallObservation(id, observation, entryById, state, ledger, secrets, options);
  }

  const wmItem = ledger.wmItems.find((item) => item.id === id);
  if (wmItem) {
    const observationById = new Map(ledger.observations.map((item) => [item.id, item]));
    // Invalidation always wins: an item citing a revoked record (or a record whose source was revoked) is withheld.
    const revoked =
      invalidated.has(id) ||
      wmItem.citedIds.some(
        (cited) =>
          invalidated.has(cited) || (observationById.get(cited)?.sourceEntryIds.some((sourceId) => invalidated.has(sourceId)) ?? false),
      );
    if (revoked) {
      return {
        found: true,
        id,
        kind: "wm_item",
        dropped: true,
        reason: "revoked",
        text: `WM item [${id}] withheld (revoked). cites: ${wmItem.citedIds.join(", ") || "none"}.`,
      };
    }
    const wmIds = new Set(ledger.wmItems.map((item) => item.id));
    const citedObservations = wmItem.citedIds.flatMap((cited) => observationById.get(cited) ?? []);
    const missingCitedIds = wmItem.citedIds.filter((cited) => !observationById.has(cited) && !wmIds.has(cited));
    const superseded = (ledger.supersededWmItemIds ?? []).includes(id);
    const sourceIds = new Set(citedObservations.flatMap((item) => item.sourceEntryIds));
    const sourceEntries = [...sourceIds].flatMap((sourceId) => entryById.get(sourceId) ?? []);
    const chunks = recalledChunks(wmItem.chunkRefs ?? [], options, secrets, () =>
      superseded
        ? "WM item superseded"
        : "no referrer in this session's chunk store (the store was not kept across a restart, or the chunk was deleted)",
    );
    const text = [
      `WM item [${id}]${superseded ? " (superseded)" : ""}: ${wmItem.kind} (${wmItem.relevance}): ${wmItem.text}`,
      ...(wmItem.observedFrom
        ? [`time: ${wmItem.observedFrom}${wmItem.observedTo && wmItem.observedTo !== wmItem.observedFrom ? ` – ${wmItem.observedTo}` : ""}`]
        : []),
      ...(wmItem.reason ? [`kept because: ${wmItem.reason}`] : []),
      "",
      "Cited STM records:",
      ...citedObservations.map((item) => {
        const tombstone = ledger.tombstones?.[item.id];
        return `- [${item.id}]${dropped.has(item.id) ? " (dropped)" : tombstone ? ` (tombstoned: ${tombstone.reason})` : ""} ${item.kind}: ${item.description}`;
      }),
      ...wmItem.citedIds.filter((cited) => wmIds.has(cited)).map((cited) => `- [${cited}] WM item`),
      ...(missingCitedIds.length ? ["", `Missing cited ids: ${missingCitedIds.join(", ")}`] : []),
      ...chunkLines(chunks),
      "",
      "Source evidence:",
      serializeSourceEntries(sourceEntries, secrets) || "none",
    ].join("\n");
    return {
      found: true,
      id,
      kind: "wm_item",
      wmItem,
      superseded,
      citedObservations,
      missingCitedIds,
      sourceEntries,
      missingSourceEntryIds: [...sourceIds].filter((sourceId) => !entryById.has(sourceId)),
      ...(chunks.length ? { chunks } : {}),
      text: redactSecrets(text, secrets),
    };
  }

  return {
    found: false,
    id,
    reason: "unknown_id",
    text: `Unknown memory id ${id}: no record with this id on the current branch.`,
  };
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
  state: RecallRecordState,
  ledger: ObservationalMemoryLedger,
  secrets: readonly (string | undefined)[],
  options: RecallMemoryOptions | undefined,
): MemoryRecallResult {
  const full = options?.detail === "full";
  const tombstone = state === "tombstoned" ? ledger.tombstones?.[id] : undefined;
  const chunks = recalledChunks(observation.chunkRefs ?? [], options, secrets, () => chunkDropReason(id, state, ledger, tombstone));
  const sourceEntries = observation.sourceEntryIds.flatMap((sourceId) => entryById.get(sourceId) ?? []);
  const missingSourceEntryIds = observation.sourceEntryIds.filter((sourceId) => !entryById.has(sourceId));
  const count = observation.count ?? 1;
  const stateLabel = state === "tombstoned" ? ` (tombstoned: ${tombstone?.reason ?? "unknown"})` : state === "dropped" ? " (dropped)" : "";
  const text = [
    `Observation [${id}]${stateLabel}: ${observation.kind}${count > 1 ? ` ×${count}` : ""}: ${observation.description}`,
    `time: ${observation.observedAt ?? observation.timestamp}${count > 1 && observation.lastAt ? `; last seen ${observation.lastAt}` : ""}${observation.referencedAt ? `; refers to ${observation.referencedAt}` : ""}`,
    `sources: ${observation.sourceEntryIds.join(", ") || "none"}`,
    ...chunkLines(chunks),
    ...(full ? ["", "Source evidence:", serializeSourceEntries(sourceEntries, secrets) || "none"] : []),
  ].join("\n");
  return {
    found: true,
    id,
    kind: "observation",
    observation,
    state,
    ...(tombstone ? { tombstone } : {}),
    ...(chunks.length ? { chunks } : {}),
    ...(full ? { sourceEntries } : {}),
    missingSourceEntryIds,
    dropped: state === "dropped",
    text: redactSecrets(text, secrets),
  };
}

/** Why a chunk the record cites is not readable by the executing session. */
function chunkDropReason(
  id: string,
  state: RecallRecordState,
  ledger: ObservationalMemoryLedger,
  tombstone: MemoryTombstone | undefined,
): string {
  if (state === "dropped") return `record ${ledger.dropReasons?.[id] ?? "dropped"}`;
  if (state === "tombstoned") return `record tombstoned (${tombstone?.reason ?? "unknown"})`;
  return "no referrer in this session's chunk store (the store was not kept across a restart, or the chunk was deleted)";
}

function recalledChunks(
  refs: readonly MemoryChunkRef[],
  options: RecallMemoryOptions | undefined,
  secrets: readonly (string | undefined)[],
  dropReason: () => string,
): readonly RecalledChunk[] {
  return refs.map((ref): RecalledChunk => {
    if (!options?.chunkTexts) return ref;
    const stored = options.chunkTexts.get(ref.id);
    if (stored) return { ...ref, text: redactSecrets(stored.text, secrets) };
    return { ...ref, dropped: dropReason() };
  });
}

function chunkLines(chunks: readonly RecalledChunk[]): readonly string[] {
  if (!chunks.length) return [];
  return [
    "",
    "Chunks:",
    ...chunks.map((chunk) =>
      chunk.text !== undefined
        ? `[chunk ${chunk.id}] from ${chunk.sourceEntryId}, ${chunk.bytes} bytes:\n${chunk.text}`
        : chunk.dropped !== undefined
          ? `[chunk ${chunk.id}] from ${chunk.sourceEntryId}: chunk dropped: ${chunk.dropped}`
          : `[chunk ${chunk.id}] from ${chunk.sourceEntryId}, ${chunk.bytes} bytes (not read)`,
    ),
  ];
}
