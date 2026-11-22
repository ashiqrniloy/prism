import type { SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import { lexicalCoverage, lexicalTerms, truncateWorkerText } from "@arnilo/prism-memory-system/core";
import { entriesById, isEligibleObservationSourceEntry } from "./coverage-helpers.js";
import { foldObservationalMemoryLedger, type ObservationalMemoryLedger } from "./ledger.js";
import {
  DEFAULT_MAX_RECALL_PAGE_LIMIT,
  DEFAULT_RECALL_QUERY_LIMIT,
  MIN_RECALL_PAGE_BYTES,
  resolveRecallPageBytes,
  resolveRecallPageLimit,
} from "./limits.js";
import { boundedOriginals, headerReserve, originalEntryText, originalPageHeader, originalSlice } from "./original.js";
import { renderRecentMessageWindow } from "./recent-messages.js";
import { isMemoryId, type MemoryObservation, type MemoryTaskState, type MemoryTombstone, type MemoryWmItem } from "./types.js";

export type RecallKind = "observation" | "wm_item" | "task_state";
export type RecallPageDirection = "forward" | "backward";
export type RecallPageDetail = "summary" | "full";
/** Where an STM record stands: on the surface, dropped, or tombstoned by a WM verdict (surface removed, still found). */
export type RecallRecordState = "active" | "dropped" | "tombstoned";

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
  /** `full` adds the original source entries to an STM record's recall. Default `summary`. */
  readonly detail?: RecallPageDetail;
  /** The ledger, when the caller already folded it. */
  readonly ledger?: ObservationalMemoryLedger;
  /** Bytes the answer's text may take; source evidence past it names the `recall { entry, offset }` to read on. Default 16_384. */
  readonly pageBytes?: number;
}

/** `recall { entry, offset, limit }`: one page of one original entry (plan 218.3 Task 4). */
export interface RecallEntryPageRequest {
  /** A current-branch user, assistant or tool message entry id (a parent's id resolves to a fork's copy). */
  readonly entry: string;
  /** Byte offset into the entry's original content. Default 0. */
  readonly offset?: number;
  /** Bytes of content the page may carry, at most the page size. Default the page size. */
  readonly limit?: number;
}

export interface RecallEntryPageResult {
  readonly found: boolean;
  /** The id the entry has on this branch. */
  readonly entry: string;
  readonly offset: number;
  readonly bytes: number;
  readonly totalBytes: number;
  readonly nextOffset?: number;
  /** The page's slice of the redacted original content, verbatim. */
  readonly content: string;
  readonly text: string;
  readonly reason?: "invalid_entry" | "entry_not_found" | "entry_not_message" | "invalid_offset" | "limit_exceeded";
}

export function recallObservationalMemory(
  entries: readonly SessionEntry[],
  id: string,
  secrets: readonly (string | undefined)[] = [],
  options?: RecallMemoryOptions,
): MemoryRecallResult {
  if (!isMemoryId(id)) return { found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." };
  const ledger = options?.ledger ?? foldObservationalMemoryLedger(entries);
  const entryById = entriesById(entries);
  const pageBytes = resolveRecallPageBytes(options?.pageBytes);
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
      text: withEvidence(`Task state [${id}]: ${JSON.stringify(taskState)}`, sourceEntries, secrets, pageBytes),
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
    return recallObservation(id, observation, entryById, state, ledger, secrets, options?.detail === "full", pageBytes);
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
    const head = [
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
      text: withEvidence(head, sourceEntries, secrets, pageBytes),
    };
  }

  return {
    found: false,
    id,
    reason: "unknown_id",
    text: `Unknown memory id ${id}: no record with this id on the current branch.`,
  };
}

/** Where a query hit stands: an STM record's state, or a WM item on the surface or superseded. */
export type RecallQueryHitState = RecallRecordState | "superseded";

/** One query hit: a session record whose description shares terms with the query. */
export interface RecallQueryHit {
  readonly id: string;
  readonly kind: "observation" | "wm_item";
  /** The record's kind (`request`, `error`, … for STM; `fact`, `summary`, `event` for WM). */
  readonly recordKind: string;
  readonly time: string;
  readonly state: RecallQueryHitState;
  /** The tombstone reason (`wm discard <reason>`, `wm keep <id>`, …) or the drop reason. */
  readonly stateReason?: string;
  readonly description: string;
  /** Share of the query's terms the description holds, in (0,1]. */
  readonly coverage: number;
}

export interface RecallQueryRequest {
  readonly query: string;
  readonly limit?: number;
}

export interface RecallQueryResult {
  readonly found: boolean;
  readonly query: string;
  readonly limit: number;
  /** The tiers searched: always `stm` and `wm`. */
  readonly tiers: readonly ("stm" | "wm")[];
  readonly hits: readonly RecallQueryHit[];
  readonly text: string;
  readonly reason?: "invalid_query" | "no_match" | "limit_exceeded";
}

const RECALL_QUERY_TIERS = ["stm", "wm"] as const;

/**
 * Plan 218.2 Task 7: a lexical query over this session's STM record and WM item descriptions, tombstoned, dropped and
 * superseded ones included, so a record WM discarded stays findable without its id. Ordered by term coverage, then
 * newest first. An in-memory scan of the folded ledger: no store read, no model call. Results never enter LTM ranking.
 */
export function recallObservationalMemoryQuery(
  entries: readonly SessionEntry[],
  request: RecallQueryRequest,
  secrets: readonly (string | undefined)[] = [],
  options?: { readonly ledger?: ObservationalMemoryLedger; readonly maxPageLimit?: number; readonly pageBytes?: number },
): RecallQueryResult {
  const query = typeof request.query === "string" ? request.query.trim() : "";
  const base = { query, tiers: RECALL_QUERY_TIERS, hits: [] as RecallQueryHit[] };
  const maxLimit = options?.maxPageLimit ?? DEFAULT_MAX_RECALL_PAGE_LIMIT;
  const limit = request.limit ?? Math.min(DEFAULT_RECALL_QUERY_LIMIT, maxLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    return {
      ...base,
      found: false,
      limit,
      reason: "limit_exceeded",
      text: `Query limit must be a positive safe integer at most ${maxLimit}.`,
    };
  }
  const terms = lexicalTerms(query);
  if (!terms.size) {
    return { ...base, found: false, limit, reason: "invalid_query", text: "Invalid query; expected at least one search term." };
  }
  const ledger = options?.ledger ?? foldObservationalMemoryLedger(entries);
  const dropped = new Set(ledger.droppedObservationIds);
  const superseded = new Set(ledger.supersededWmItemIds ?? []);
  const tombstones = ledger.tombstones ?? {};
  const candidates: RecallQueryHit[] = [];
  const consider = (hit: Omit<RecallQueryHit, "coverage">) => {
    const coverage = recordCoverage(terms, hit.description);
    if (coverage > 0) candidates.push({ ...hit, coverage });
  };
  for (const item of ledger.observations) {
    const tombstone = Object.hasOwn(tombstones, item.id) ? tombstones[item.id] : undefined;
    const state: RecallRecordState = tombstone ? "tombstoned" : dropped.has(item.id) ? "dropped" : "active";
    const stateReason = tombstone ? tombstone.reason : state === "dropped" ? (ledger.dropReasons?.[item.id] ?? "dropped") : undefined;
    consider({
      id: item.id,
      kind: "observation",
      recordKind: item.kind,
      time: item.observedAt ?? item.timestamp,
      state,
      ...(stateReason ? { stateReason } : {}),
      description: item.description,
    });
  }
  for (const item of ledger.wmItems) {
    consider({
      id: item.id,
      kind: "wm_item",
      recordKind: item.kind,
      time: item.observedTo ?? item.observedFrom ?? "",
      state: superseded.has(item.id) ? "superseded" : "active",
      description: item.text,
    });
  }
  const hits = candidates
    .sort((a, b) => b.coverage - a.coverage || (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
    .slice(0, limit)
    .map((hit) => ({ ...hit, description: redactSecrets(hit.description, secrets) }));
  if (!hits.length) {
    return {
      ...base,
      found: false,
      limit,
      reason: "no_match",
      text: `No session memory record matches "${redactSecrets(query, secrets)}" (searched STM records and WM items, discarded ones included).`,
    };
  }
  const line = (hit: RecallQueryHit) => {
    const state = hit.state === "active" || !hit.stateReason ? hit.state : `${hit.state}: ${hit.stateReason}`;
    const time = hit.time ? ` ${hit.time}` : "";
    return `- [${hit.id}] ${hit.kind === "wm_item" ? "WM " : ""}${hit.recordKind}${time} (${state}): ${hit.description}`;
  };
  const answer = (shown: readonly RecallQueryHit[]): RecallQueryResult => {
    const more = hits.length - shown.length;
    const text = redactSecrets(
      [
        `${shown.length} session memory record(s) match; call recall with an id for the record and its original source entries.`,
        ...shown.map(line),
        ...(more ? [`${more} more record(s) match past this page; narrow the query to see them.`] : []),
      ].join("\n"),
      secrets,
    );
    return { ...base, found: true, limit, hits: [...shown], text };
  };
  // Plan 218.3 Task 12: the answer stays within the page bytes like every other recall mode (a query over many long
  // records answered ~200K characters, over a 32K window on its own). The first hit always shows.
  const pageBytes = resolveRecallPageBytes(options?.pageBytes);
  let shown = hits.length;
  let result = answer(hits);
  while (shown > 1 && Buffer.byteLength(JSON.stringify(result), "utf8") > pageBytes) result = answer(hits.slice(0, --shown));
  return result;
}

/** The query scorer `recall { query }` and WM's look-ahead share: the share of the query's terms a description holds. */
function recordCoverage(queryTerms: ReadonlySet<string>, description: string): number {
  return lexicalCoverage(queryTerms, lexicalTerms(description));
}

/** One earlier STM record offered to a WM pass for a coming scope step (plan 218.3 Task 8). */
export interface LookAheadCandidate {
  readonly record: MemoryObservation;
  /** The remaining step ordinal the record matched best. */
  readonly step: number;
  /** Share of that step's terms the record's description holds, in (0,1]. */
  readonly coverage: number;
  readonly state: RecallRecordState;
}

export interface LookAheadOptions {
  /** Most records one pass is offered (`wm.lookAheadRecords`); 0 offers none. */
  readonly maxRecords: number;
  /** Most record tokens one pass is offered (`wm.lookAheadTokens`). */
  readonly maxTokens: number;
  /** Record ids never offered: the flush passes the STM surface (its batches reach WM) and the re-judged records. */
  readonly exclude?: ReadonlySet<string>;
}

/**
 * WM's look-ahead (plan 218.3 Task 8): earlier STM records whose description matches a remaining scope step, whatever
 * their state, except those `exclude` names (the flush passes the STM surface, which WM's batches already reach) and
 * those an active WM item already cites.
 * The scorer is `recall { query }`'s with each step's text as the query; a record must share at least two of the
 * step's terms (all of them for a one-term step). Each record goes to the step it covers best (the earlier step on a
 * tie); the next step's records come first, then higher coverage, then newer. Bounded by records and tokens. A pure
 * read of the folded ledger: no store read, no model call.
 */
export function selectLookAheadRecords(
  ledger: ObservationalMemoryLedger,
  remaining: readonly { readonly step: number; readonly text: string }[],
  options: LookAheadOptions,
): readonly LookAheadCandidate[] {
  if (!remaining.length || options.maxRecords < 1 || options.maxTokens < 1) return [];
  const steps = remaining
    .map((step, position) => ({ ...step, position, terms: lexicalTerms(step.text) }))
    .filter((step) => step.terms.size);
  if (!steps.length) return [];
  const superseded = new Set(ledger.supersededWmItemIds ?? []);
  const inWm = new Set(ledger.wmItems.filter((item) => !superseded.has(item.id)).flatMap((item) => item.citedIds));
  const dropped = new Set(ledger.droppedObservationIds);
  const tombstones = ledger.tombstones ?? {};
  const scored: (LookAheadCandidate & { readonly position: number; readonly index: number })[] = [];
  for (const [index, record] of ledger.observations.entries()) {
    if (inWm.has(record.id) || options.exclude?.has(record.id)) continue;
    const terms = lexicalTerms(record.description);
    let best: { step: number; position: number; coverage: number } | undefined;
    for (const step of steps) {
      let matched = 0;
      for (const term of step.terms) if (terms.has(term)) matched += 1;
      if (matched < Math.min(2, step.terms.size)) continue;
      const coverage = matched / step.terms.size;
      if (!best || coverage > best.coverage) best = { step: step.step, position: step.position, coverage };
    }
    if (!best) continue;
    const state: RecallRecordState = Object.hasOwn(tombstones, record.id) ? "tombstoned" : dropped.has(record.id) ? "dropped" : "active";
    scored.push({ record, step: best.step, coverage: best.coverage, state, position: best.position, index });
  }
  scored.sort((a, b) => a.position - b.position || b.coverage - a.coverage || b.index - a.index);
  const chosen: LookAheadCandidate[] = [];
  let tokens = 0;
  for (const { position: _position, index: _index, ...candidate } of scored) {
    if (chosen.length >= options.maxRecords) break;
    if (tokens + candidate.record.tokenCount > options.maxTokens) continue;
    chosen.push(candidate);
    tokens += candidate.record.tokenCount;
  }
  return chosen;
}

export function recallObservationalMemoryBranchPage(
  entries: readonly SessionEntry[],
  request: RecallBranchPageRequest,
  secrets: readonly (string | undefined)[] = [],
  options?: { readonly pageBytes?: number; readonly maxPageLimit?: number },
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
    limit = resolveRecallPageLimit(request.limit, options?.maxPageLimit);
  } catch {
    return {
      found: false,
      cursor,
      direction,
      limit: request.limit ?? 0,
      entries: [],
      reason: "limit_exceeded",
      text: `Page limit must be a positive safe integer at most ${options?.maxPageLimit ?? DEFAULT_MAX_RECALL_PAGE_LIMIT}.`,
    };
  }

  const cursorEntry = entriesById(entries).get(cursor);
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
  const index = messages.indexOf(cursorEntry);
  const start = direction === "backward" ? Math.max(0, index - limit + 1) : index;
  const end = direction === "backward" ? index + 1 : Math.min(messages.length, index + limit);
  const page = messages.slice(start, end);
  // `full` pages the original entries within the page bytes; an entry past them names the `recall { entry }` to read it.
  const text =
    detail === "full"
      ? boundedOriginals(page, secrets, resolveRecallPageBytes(options?.pageBytes)) || "none"
      : // Plan 218.3 Task 12: the summary page stays within the page bytes too (it rendered every message whole).
        boundedSummary(renderRecentMessageWindow(page, secrets), resolveRecallPageBytes(options?.pageBytes)) || "none";
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

/**
 * `recall { entry, offset, limit }` (plan 218.3 Task 4): one page of one current-branch message entry's original content,
 * read from the session store and redacted, header included within `pageBytes`. The page names the offset to read on.
 * A parent's entry id resolves to a fork's copy; an entry after the fork point is not on the fork's branch.
 */
export function recallObservationalMemoryEntryPage(
  entries: readonly SessionEntry[],
  request: RecallEntryPageRequest,
  secrets: readonly (string | undefined)[] = [],
  options?: { readonly pageBytes?: number },
): RecallEntryPageResult {
  const requested = typeof request.entry === "string" ? request.entry.trim() : "";
  const offset = request.offset ?? 0;
  const empty = { entry: requested, offset, bytes: 0, totalBytes: 0, content: "" };
  if (!requested) return { ...empty, found: false, reason: "invalid_entry", text: "Invalid entry; expected a current-branch entry id." };
  if (!Number.isSafeInteger(offset) || offset < 0)
    return { ...empty, found: false, reason: "invalid_offset", text: "Offset must be a non-negative safe integer." };
  const pageBytes = resolveRecallPageBytes(options?.pageBytes);
  const limit = request.limit ?? pageBytes;
  if (!Number.isSafeInteger(limit) || limit < MIN_RECALL_PAGE_BYTES || limit > pageBytes) {
    return {
      ...empty,
      found: false,
      reason: "limit_exceeded",
      text: `Entry page limit must be a safe integer from ${MIN_RECALL_PAGE_BYTES} to ${pageBytes} bytes.`,
    };
  }
  const entry = entriesById(entries).get(requested);
  if (!entry) return { ...empty, found: false, reason: "entry_not_found", text: `Entry ${requested} was not found on the current branch.` };
  if (!isEligibleObservationSourceEntry(entry)) {
    return {
      ...empty,
      found: false,
      reason: "entry_not_message",
      text: `Entry ${requested} is not a user/assistant/tool message on the current branch.`,
    };
  }
  const totalBytes = Buffer.byteLength(redactSecrets(originalEntryText(entry), secrets), "utf8");
  if (offset > totalBytes) {
    return {
      ...empty,
      entry: entry.id,
      totalBytes,
      found: false,
      reason: "invalid_offset",
      text: `Offset ${offset} is past the end of entry ${entry.id} (${totalBytes} bytes).`,
    };
  }
  const slice = originalSlice(entry, offset, Math.min(limit, pageBytes - headerReserve(entry, totalBytes)), secrets);
  return {
    found: true,
    entry: entry.id,
    offset: slice.offset,
    bytes: slice.bytes,
    totalBytes: slice.totalBytes,
    ...(slice.nextOffset === undefined ? {} : { nextOffset: slice.nextOffset }),
    content: slice.content,
    text: `${originalPageHeader(entry, slice)}\n${slice.content}`,
  };
}

/** A record's lines, then its source entries' original content in the room the page has left. */
function withEvidence(
  head: string,
  sourceEntries: readonly SessionEntry[],
  secrets: readonly (string | undefined)[],
  pageBytes: number,
): string {
  const top = redactSecrets(`${head}\n\nSource evidence:`, secrets);
  const room = Math.max(MIN_RECALL_PAGE_BYTES, pageBytes - Buffer.byteLength(top, "utf8") - 1);
  return `${top}\n${boundedOriginals(sourceEntries, secrets, room) || "none"}`;
}

function recallObservation(
  id: string,
  observation: MemoryObservation,
  entryById: ReadonlyMap<string, SessionEntry>,
  state: RecallRecordState,
  ledger: ObservationalMemoryLedger,
  secrets: readonly (string | undefined)[],
  full: boolean,
  pageBytes: number,
): MemoryRecallResult {
  const tombstone = state === "tombstoned" ? ledger.tombstones?.[id] : undefined;
  const sourceEntries = observation.sourceEntryIds.flatMap((sourceId) => entryById.get(sourceId) ?? []);
  const missingSourceEntryIds = observation.sourceEntryIds.filter((sourceId) => !entryById.has(sourceId));
  const count = observation.count ?? 1;
  const stateLabel = state === "tombstoned" ? ` (tombstoned: ${tombstone?.reason ?? "unknown"})` : state === "dropped" ? " (dropped)" : "";
  const head = [
    `Observation [${id}]${stateLabel}: ${observation.kind}${count > 1 ? ` ×${count}` : ""}: ${observation.description}`,
    `time: ${observation.observedAt ?? observation.timestamp}${count > 1 && observation.lastAt ? `; last seen ${observation.lastAt}` : ""}${observation.referencedAt ? `; refers to ${observation.referencedAt}` : ""}`,
    `sources: ${sourceEntries.map((entry) => entry.id).join(", ") || "none"}${missingSourceEntryIds.length ? `; not on this branch: ${missingSourceEntryIds.join(", ")}` : ""}`,
  ].join("\n");
  return {
    found: true,
    id,
    kind: "observation",
    observation,
    state,
    ...(tombstone ? { tombstone } : {}),
    ...(full ? { sourceEntries } : {}),
    missingSourceEntryIds,
    dropped: state === "dropped",
    text: full ? withEvidence(head, sourceEntries, secrets, pageBytes) : redactSecrets(head, secrets),
  };
}

/** The marker a cut summary page ends with: the entry ids on the page read whole through `recall { entry }`. */
export const RECALL_PAGE_CUT_MARKER = "\n[page cut at the page bytes: read one entry whole with recall { entry: <entry id>, offset }]";

/** A summary page within `pageBytes`; a cut page says how to read an entry whole (plan 218.3 Task 12). */
function boundedSummary(text: string, pageBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= pageBytes) return text;
  return `${truncateWorkerText(text, pageBytes - Buffer.byteLength(RECALL_PAGE_CUT_MARKER, "utf8"))}${RECALL_PAGE_CUT_MARKER}`;
}
