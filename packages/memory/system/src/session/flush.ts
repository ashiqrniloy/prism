/**
 * One memory pass over the session's branch: STM records events → WM gives verdicts on them → rehearsal drops, appending
 * each recorded batch to the ledger log.
 *
 * The pass is bounded and idempotent enough to run on every turn: it reads the branch once, folds the
 * ledger already in memory, and only calls a model when a threshold is crossed. One pass runs per
 * session at a time. A request while one is in flight returns `skipped: "in_flight"` and is folded into the running
 * flush: when its pass ends, it runs one more pass over what arrived meanwhile (plan 217 Task 6), so the tail written
 * during a long pass is not left until the next turn.
 */
import type { JsonValue, ModelClient, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";
import { resolveMemoryWorkerLimits, truncateWorkerText } from "@arnilo/prism-memory-system/core";
import type { ChunkOp, ChunkStoreHandle } from "../chunks.js";
import type { ResolvedMemorySystemConfig, ResolvedWorkerSettings } from "./config.js";
import {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  isEligibleObservationSourceEntry,
  observationTokensSinceEmptyWmAttempt,
  unscannedEntries,
  wmBatch,
} from "./coverage-helpers.js";
import { activeObservations, boundaryKey, type ObservationalMemoryRecord } from "./ledger.js";
import { protectedRecords, protectedTokenCount } from "./protections.js";
import { salienceSignals } from "./salience.js";
import { type EpisodeScope, SCOPE_SET } from "./scope.js";
import { serializeSourceBatches } from "./serialize.js";
import { ledgerOf, type ObservationalMemoryState } from "./state.js";

import {
  BOUNDARY_RECORDED,
  type BoundaryRecordedData,
  type MemoryBoundary,
  type MemoryObservation,
  type MemoryTaskState,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  OBSERVATIONS_TOMBSTONED,
  type ObservationsTombstonedData,
  TASK_STATE_RECORDED,
  WM_RECORDED,
  type WmRecordedData,
  type WmRejudge,
} from "./types.js";
import { dropObservationsToTarget, runDropper } from "./workers/dropper.js";
import { runStm } from "./workers/stm.js";
import { deterministicWm, runWm, type WmRecordVerdict, wmTargetTokens } from "./workers/wm.js";

export type ObservationalWorkerKind = "observer" | "wm" | "dropper";

export interface ObservationalFlushResult {
  readonly observations: number;
  /** WM items the pass recorded. */
  readonly wmItems: number;
  /** STM records that received a WM verdict (and were tombstoned). */
  readonly processed: number;
  readonly dropped: number;
  /** Boundary markers this pass recorded. Absent when none. */
  readonly boundaries?: number;
  /** Present when the pass did not run. A pass that ran and recorded nothing has no `skipped` value. */
  readonly skipped?: "in_flight";
}

export interface ObservationalFlushStatus {
  readonly inFlight: boolean;
  readonly lastError?: string;
}

export interface ObservationalFlushDeps {
  readonly log: SessionLog<JsonValue>;
  readonly config: ResolvedMemorySystemConfig;
  /** The per-session toggle and worker model refs. */
  readonly readState: (session: SessionContext) => ObservationalMemoryState;
  /** The session's episode scope (plan 218 Task 1). Only the WM and Rehearsal requests receive it, never STM (I1). */
  readonly scopeFor?: (session: SessionContext) => EpisodeScope | undefined;
  /** The worker model call for one kind, resolved from session state ← config ← the session model. */
  readonly clientFor: (session: SessionContext, kind: ObservationalWorkerKind) => ModelClient;
  /**
   * The session's secret set, forwarded to every worker call so a value redacts from its prompt and
   * errors. It comes from the kernel (branch entries are redacted at append; the compaction context
   * carries the agent's set), never from config text.
   */
  readonly secretsFor?: (session: SessionContext) => readonly (string | undefined)[];
  /**
   * The chunk store. Each pass writes its new chunks, adds a `wm` referrer for every chunk a new WM item cites, then
   * removes the STM referrers of records it dropped or tombstoned, in one transaction after its ledger appends: a chunk
   * a WM item cites survives, an uncited one is deleted (I2–I3). A failed write leaves a ref that recall reports as
   * dropped, never an unreferenced chunk. Absent, chunks are not stored and the `chunks` argument is off.
   */
  readonly chunks?: ChunkStoreHandle;
  /** `memory.session.status`, emitted on flush start, flush end, and flush failure. */
  readonly onStatus: (session: SessionContext, status: { inFlight: boolean; lastError?: string }) => void;
}

export interface ObservationalFlush {
  flush(session: SessionContext, options?: ObservationalFlushOptions): Promise<ObservationalFlushResult>;
  status(sessionId: string): ObservationalFlushStatus;
}

export interface ObservationalFlushOptions {
  /** Run a WM pass over the STM surface even below `wm.triggerTokens` (`memory.system.rehearse({ only: "wm" })`). */
  readonly forceWm?: boolean;
  readonly signal?: AbortSignal;
}

export function createObservationalFlush(deps: ObservationalFlushDeps): ObservationalFlush {
  const statuses = new Map<string, ObservationalFlushStatus>();
  /** Sessions whose flush was requested while a pass was in flight. */
  const requested = new Set<string>();
  const limits = resolveMemoryWorkerLimits(deps.config.worker);
  const set = (sessionId: string, next: ObservationalFlushStatus): void => {
    statuses.set(sessionId, next);
  };
  return {
    status: (sessionId) => statuses.get(sessionId) ?? { inFlight: false },
    async flush(session, options = {}) {
      if (statuses.get(session.id)?.inFlight) {
        requested.add(session.id);
        return { observations: 0, wmItems: 0, processed: 0, dropped: 0, skipped: "in_flight" };
      }
      set(session.id, { inFlight: true });
      deps.onStatus(session, { inFlight: true });
      try {
        let result = await pass(session, deps, limits, options);
        // Requests that arrived during the pass run as follow-up passes, bounded so a session that keeps writing
        // cannot hold the flush forever (its next turn requests again).
        for (let rerun = 0; rerun < MAX_FOLLOW_UP_PASSES && requested.has(session.id) && !options.signal?.aborted; rerun += 1) {
          requested.delete(session.id);
          result = sumFlushResults(result, await pass(session, deps, limits, { ...options, forceWm: false }));
        }
        requested.delete(session.id);
        set(session.id, { inFlight: false });
        deps.onStatus(session, { inFlight: false });
        return result;
      } catch (error) {
        const lastError = truncateWorkerText(
          error instanceof Error ? error.message : "Observational memory pass failed",
          limits.maxErrorBytes,
        );
        requested.delete(session.id);
        set(session.id, { inFlight: false, lastError });
        deps.onStatus(session, { inFlight: false, lastError });
        throw error;
      }
    },
  };
}

/** Follow-up passes one flush may run for requests that arrived while it was in flight. */
export const MAX_FOLLOW_UP_PASSES = 4;

function sumFlushResults(a: ObservationalFlushResult, b: ObservationalFlushResult): ObservationalFlushResult {
  const boundaries = (a.boundaries ?? 0) + (b.boundaries ?? 0);
  return {
    observations: a.observations + b.observations,
    wmItems: a.wmItems + b.wmItems,
    processed: a.processed + b.processed,
    dropped: a.dropped + b.dropped,
    ...(boundaries ? { boundaries } : {}),
  };
}

async function pass(
  session: SessionContext,
  deps: ObservationalFlushDeps,
  limits: ReturnType<typeof resolveMemoryWorkerLimits>,
  options: ObservationalFlushOptions,
): Promise<ObservationalFlushResult> {
  const config = deps.config;
  const workerSessionId = `memory.session:${session.id}`;
  const entries = await session.entries();
  const ledger = ledgerOf(deps.log.entries(session));
  const pending = unscannedEntries(entries, ledger.latestObservationCoverageId);
  const eligibleSources = eligibleObservationSources(pending);
  const eligibleTokens = eligibleObservationTokenCount(eligibleSources);
  const lastScannedId = pending.at(-1)?.id;
  const removedBefore = new Set([...ledger.droppedObservationIds, ...Object.keys(ledger.tombstones ?? {})]);
  const wmItemsBefore = new Set(ledger.wmItems.map((item) => item.id));
  const chunkOps: ChunkOp[] = [];
  try {
    return await passBody();
  } finally {
    if (deps.chunks) {
      const after = ledgerOf(deps.log.entries(session));
      // WM referrers first, in the same transaction: a chunk a new WM item cites never reaches zero referrers.
      for (const item of after.wmItems) {
        if (wmItemsBefore.has(item.id)) continue;
        for (const ref of item.chunkRefs ?? [])
          chunkOps.push({ op: "ref", id: ref.id, by: { kind: "wm", id: item.id, sessionId: session.id } });
      }
      const removed = [...after.droppedObservationIds, ...Object.keys(after.tombstones ?? {})];
      for (const id of new Set(removed)) {
        if (removedBefore.has(id)) continue;
        const record = after.observations.find((item) => item.id === id);
        for (const ref of record?.chunkRefs ?? [])
          chunkOps.push({ op: "unref", id: ref.id, by: { kind: "stm", id, sessionId: session.id } });
      }
      if (chunkOps.length) await deps.chunks.run((store) => store.apply(chunkOps));
    }
  }

  async function passBody(): Promise<ObservationalFlushResult> {
    let observations = 0;
    let wmItems = 0;
    let processed = 0;
    let dropped = 0;
    let boundaries = 0;
    const seenBoundaries = new Set((ledger.boundaries ?? []).map(boundaryKey));
    let taskState = ledger.taskState;
    const appendBoundary = async (boundary: MemoryBoundary): Promise<void> => {
      if (seenBoundaries.has(boundaryKey(boundary))) return;
      seenBoundaries.add(boundaryKey(boundary));
      await deps.log.append(session, asJson({ type: BOUNDARY_RECORDED, ...boundary } satisfies BoundaryRecordedData));
      boundaries += 1;
    };

    // Idle-gap boundaries are deterministic: a user turn after `boundaryGapMinutes` of silence. The marker is
    // recorded whether or not STM runs (a later pass sees the same entry and skips it by key).
    const gaps = idleGapBoundaries(entries, pending, config.stm.boundaryGapMinutes);
    for (const gap of gaps) await appendBoundary(gap);

    const secrets = deps.secretsFor?.(session) ?? [];
    // Scope-blind (I1): the STM request carries the batch, the task state and an index of recent STM
    // records — never the episode scope, a WM item or an LTM note. WM and Rehearsal read `scope`.
    const scope = deps.scopeFor?.(session);
    const recentEvents = () => activeObservations(ledgerOf(deps.log.entries(session)));

    if (pending.length && lastScannedId) {
      if (!eligibleSources.length) {
        // Nothing eligible in the tail: advance coverage so the next pass does not rescan it.
        await deps.log.append(session, asJson({ type: OBSERVATIONS_RECORDED, observations: [], coversUpToId: lastScannedId }));
      } else if (eligibleTokens >= config.stm.triggerTokens || (config.stm.boundaries && gaps.length > 0)) {
        // Below the trigger, a user turn after an idle gap still runs the pass when `stm.boundaries` is on.
        // The tail goes in ordered batches that each fit the message budget, so a tail larger than the
        // budget no longer stalls the pass. Coverage advances after each recorded batch; a failed batch
        // leaves it at the last one recorded. A tail that fits is one batch, the same prompt as before.
        const batches = serializeSourceBatches(
          eligibleSources,
          secrets,
          sourceBudget(limits.maxMessageBytes),
          stmBatchTargetBytes(config.stm.triggerTokens),
        );
        for (const [index, batch] of batches.entries()) {
          const records: ObservationalMemoryRecord[] = [];
          const recorded = await runStm({
            onRecord: (record) => {
              records.push(record);
            },
            taskState: ledgerOf(deps.log.entries(session)).taskState,
            client: deps.clientFor(session, "observer"),
            entries: batch.entries,
            sourceText: batch.text,
            recent: recentEvents(),
            contextTokens: config.stm.contextTokens,
            maxChunksPerEvent: deps.chunks ? config.stm.maxChunksPerEvent : 0,
            maxChunkBytes: config.stm.maxChunkBytes,
            habituation: config.stm.habituation,
            onChunks: (id, chunks) => {
              for (const chunk of chunks) chunkOps.push({ op: "put", chunk, by: { kind: "stm", id, sessionId: session.id } });
            },
            ...limits,
            ...workerPrompt(config.stm),
            secrets,
            sessionId: workerSessionId,
            signal: options.signal,
          });
          const coversUpToId = index === batches.length - 1 ? lastScannedId : batch.entries.at(-1)!.id;
          await deps.log.append(session, asJson({ type: OBSERVATIONS_RECORDED, observations: recorded, coversUpToId }));
          for (const record of records) await deps.log.append(session, asJson(record));
          observations += recorded.length;
          // Outcome and task-state boundaries come from what STM recorded: free, no extra call.
          for (const boundary of recordedBoundaries(recorded, records, taskState, batch.entries)) await appendBoundary(boundary);
          for (const record of records) if (record.type === TASK_STATE_RECORDED) taskState = record.taskState;
        }
      }
    }

    const afterObservations = ledgerOf(deps.log.entries(session));
    const surface = activeObservations(afterObservations);
    const surfaceTokens = surface.reduce((sum, item) => sum + item.tokenCount, 0);
    const boundaryCount = afterObservations.boundaries?.length ?? 0;
    const newBoundary = boundaryCount > (afterObservations.wmBoundariesSeen ?? 0);
    // After an attempt that did nothing, wait for a fresh trigger of new records instead of re-running every pass.
    const sinceEmptyAttempt = observationTokensSinceEmptyWmAttempt(deps.log.entries(session));
    const tokenTrigger =
      surfaceTokens >= config.wm.triggerTokens && (sinceEmptyAttempt === undefined || sinceEmptyAttempt >= config.wm.triggerTokens);
    // Re-judgment (plan 218 Task 4): the first model WM pass after a scope change is also sent the discarded records
    // whose chunks still live, up to `wm.rejudgeTokens`, and may keep them back into WM.
    const scopeChange =
      config.wm.enabled && config.wm.policy === "model" && config.wm.rejudgeTokens > 0
        ? pendingScopeChange(deps.log.entries(session))
        : undefined;
    if (config.wm.enabled && (surface.length || scopeChange) && (options.forceWm === true || tokenTrigger || newBoundary)) {
      // The batch (gate M-1): the oldest records up to `wm.batchTokens`, and no more records than three quarters of the
      // worker's call cap, so one model's output holds a verdict for each. The rest waits for the next pass.
      let batch = wmBatch(surface, config.wm.batchTokens, Math.max(1, Math.floor(limits.maxToolCalls * 0.75)));
      const record = (data: Omit<WmRecordedData, "type">) => deps.log.append(session, asJson({ type: WM_RECORDED, ...data }));
      const rejudge = scopeChange
        ? await rejudgeCandidates(afterObservations, config.wm.rejudgeTokens, session.id, deps.chunks)
        : undefined;
      // Protections (I5) and the target are code: the discard tool refuses a protected record, and a batch whose
      // protected records alone exceed the target records `budget_unmet` instead of losing them.
      let salience = salienceSignals(batch, entries);
      let protections = protectedRecords(afterObservations, batch, { salience });
      let targetTokens = wmTargetTokens(
        batch.reduce((sum, item) => sum + item.tokenCount, 0),
        config.wm.targetRatio,
      );
      let protectedTokens = protectedTokenCount(batch, protections);
      let output: Awaited<ReturnType<typeof runWm>>;
      for (let attempt = 0; ; attempt += 1) {
        try {
          output =
            config.wm.policy === "deterministic"
              ? deterministicWm({ records: batch, protections, salience, targetRatio: config.wm.targetRatio })
              : await runWm({
                  client: deps.clientFor(session, "wm"),
                  records: batch,
                  ledger: afterObservations,
                  salience,
                  protections,
                  targetRatio: config.wm.targetRatio,
                  ...(rejudge?.records.length ? { rejudge: rejudge.records } : {}),
                  ...(scope ? { scope } : {}),
                  ...(afterObservations.taskState ? { taskState: afterObservations.taskState } : {}),
                  ...limits,
                  ...workerPrompt(config.wm),
                  secrets,
                  sessionId: workerSessionId,
                  signal: options.signal,
                });
        } catch (error) {
          // A failed attempt is an empty one: it processes nothing, and the next attempt waits for new records.
          if (!options.signal?.aborted) await record({ items: [], boundaries: boundaryCount });
          throw error;
        }
        // Plan 218 Task 6 (gate M-2): a model call that spent its output limit before giving any verdict retries once on
        // the older half of its batch; the rest stays on the STM surface for the next pass.
        if (attempt > 0 || !output.endedAtOutputCap || output.verdicts.size > 0 || batch.length < 2) break;
        batch = batch.slice(0, Math.ceil(batch.length / 2));
        salience = salienceSignals(batch, entries);
        protections = protectedRecords(afterObservations, batch, { salience });
        targetTokens = wmTargetTokens(
          batch.reduce((sum, item) => sum + item.tokenCount, 0),
          config.wm.targetRatio,
        );
        protectedTokens = protectedTokenCount(batch, protections);
      }
      const byId = new Map(batch.map((item) => [item.id, item]));
      // A re-judged record kept back is already tombstoned: it is not processed again, and its item is not compression.
      const batchVerdicts = new Map([...output.verdicts].filter(([id]) => byId.has(id)));
      const keptBack = [...output.verdicts].filter(([id]) => !byId.has(id));
      const keptBackItemIds = new Set(keptBack.map(([, verdict]) => verdict.itemId));
      const processedIds = [...batchVerdicts.keys()];
      const compression = {
        processedTokens: processedIds.reduce((sum, id) => sum + (byId.get(id)?.tokenCount ?? 0), 0),
        itemTokens: output.items.filter((item) => !keptBackItemIds.has(item.id)).reduce((sum, item) => sum + item.tokenCount, 0),
        targetTokens,
      };
      await record({
        items: output.items,
        ...(output.supersededItemIds.length ? { supersededItemIds: output.supersededItemIds } : {}),
        ...(processedIds.length ? { processedIds, compression } : {}),
        ...(processedIds.length && protectedTokens > targetTokens ? { budgetUnmet: { protectedTokens, targetTokens } } : {}),
        ...(scopeChange && rejudge
          ? {
              rejudge: {
                ...(scopeChange.hash ? { scopeHash: scopeChange.hash } : {}),
                offered: rejudge.records.length,
                kept: keptBack.map(([id]) => id),
                chunkDropped: rejudge.chunkDropped,
              } satisfies WmRejudge,
            }
          : {}),
        boundaries: boundaryCount,
      });
      // Every processed record leaves the STM surface with its verdict as the reason; recall still finds it (I2).
      const at = new Date().toISOString();
      for (const [reason, ids] of tombstoneGroups(batchVerdicts))
        await deps.log.append(
          session,
          asJson({ type: OBSERVATIONS_TOMBSTONED, observationIds: ids, reason, at } satisfies ObservationsTombstonedData),
        );
      wmItems = output.items.length;
      processed = processedIds.length;
    }

    const active = activeObservations(ledgerOf(deps.log.entries(session)));
    const activeTokens = active.reduce((sum, item) => sum + item.tokenCount, 0);
    if (config.rehearsal.enabled && activeTokens > config.rehearsal.targetTokens) {
      const ids =
        config.rehearsal.policy === "lowest-relevance"
          ? dropObservationsToTarget(active, config.rehearsal.targetTokens)
          : await runDropper({
              client: deps.clientFor(session, "dropper"),
              observations: active,
              targetTokens: config.rehearsal.targetTokens,
              ...(scope ? { scope } : {}),
              ...(afterObservations.taskState ? { taskState: afterObservations.taskState } : {}),
              ...limits,
              ...workerPrompt(config.rehearsal),
              secrets,
              sessionId: workerSessionId,
              signal: options.signal,
            });
      if (ids.length) {
        await deps.log.append(
          session,
          asJson({
            type: OBSERVATIONS_DROPPED,
            observationIds: ids,
            ...(afterObservations.latestObservationCoverageId === undefined
              ? {}
              : { coversUpToId: afterObservations.latestObservationCoverageId }),
          }),
        );
        dropped = ids.length;
      }
    }

    return { observations, wmItems, processed, dropped, ...(boundaries ? { boundaries } : {}) };
  }
}

/**
 * Idle-gap boundaries in the unscanned tail: each user message whose time is at least `gapMinutes` after the
 * previous eligible message on the branch (package records written in the background do not break the silence).
 */
export function idleGapBoundaries(
  entries: readonly SessionEntry[],
  pending: readonly SessionEntry[],
  gapMinutes: number,
): readonly MemoryBoundary[] {
  const pendingIds = new Set(pending.map((entry) => entry.id));
  const boundaries: MemoryBoundary[] = [];
  let previous: SessionEntry | undefined;
  for (const entry of entries) {
    if (!isEligibleObservationSourceEntry(entry)) continue;
    if (pendingIds.has(entry.id) && previous && entry.message?.role === "user") {
      const minutes = (Date.parse(entry.timestamp) - Date.parse(previous.timestamp)) / 60_000;
      if (Number.isFinite(minutes) && minutes >= gapMinutes)
        boundaries.push({ reason: "idle_gap", entryId: entry.id, gapMinutes: Math.floor(minutes), at: entry.timestamp });
    }
    previous = entry;
  }
  return boundaries;
}

/**
 * The outcome and task-state boundaries one STM batch produced. A task state is a boundary when its goal, open
 * questions, decisions or next steps changed (its id also hashes the batch's source ids, so it changes every pass).
 */
function recordedBoundaries(
  events: readonly MemoryObservation[],
  records: readonly ObservationalMemoryRecord[],
  previous: MemoryTaskState | undefined,
  batch: readonly SessionEntry[],
): readonly MemoryBoundary[] {
  const boundaries: MemoryBoundary[] = [];
  for (const event of events) {
    const entryId = event.sourceEntryIds.at(-1);
    if (event.kind === "outcome" && entryId)
      boundaries.push({ reason: "outcome", entryId, recordId: event.id, at: event.observedAt ?? event.timestamp });
  }
  let current = previous && taskStateContent(previous);
  for (const record of records) {
    if (record.type !== TASK_STATE_RECORDED || taskStateContent(record.taskState) === current) continue;
    current = taskStateContent(record.taskState);
    const entryId = record.taskState.sourceEntryIds.at(-1);
    const at = batch.find((entry) => entry.id === entryId)?.timestamp ?? new Date().toISOString();
    if (entryId) boundaries.push({ reason: "task_state", entryId, recordId: record.taskState.id, at });
  }
  return boundaries;
}

/**
 * The latest `scope.set` no WM pass has re-judged yet: one after the last `wm.recorded` carrying `rejudge`, whose hash
 * differs from the hash that pass answered. Setting the same scope again re-judges nothing.
 */
export function pendingScopeChange(records: readonly JsonValue[]): { readonly hash?: string } | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (typeof record !== "object" || record === null || Array.isArray(record)) continue;
    if (record.type === WM_RECORDED && typeof record.rejudge === "object" && record.rejudge !== null) return undefined;
    if (record.type !== SCOPE_SET) continue;
    const hash = typeof record.hash === "string" ? record.hash : undefined;
    const answered = lastRejudgedHash(records, index);
    return answered !== undefined && answered === (hash ?? null) ? undefined : hash ? { hash } : {};
  }
  return undefined;
}

/** The scope hash the last re-judging WM pass before `end` answered: `null` after a clear, `undefined` when none ran. */
function lastRejudgedHash(records: readonly JsonValue[], end: number): string | null | undefined {
  for (let index = end - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (typeof record !== "object" || record === null || Array.isArray(record) || record.type !== WM_RECORDED) continue;
    const rejudge = record.rejudge;
    if (typeof rejudge !== "object" || rejudge === null || Array.isArray(rejudge)) continue;
    return typeof rejudge.scopeHash === "string" ? rejudge.scopeHash : null;
  }
  return undefined;
}

/**
 * Discarded STM records a re-judgment may offer, newest tombstone first, up to `maxTokens`. A record whose chunks were
 * all deleted is not offered and is named in `chunkDropped`; a record without chunks is offered on its own line. A chunk
 * is live while this session holds a referrer for it (the store answers `get` per session).
 */
async function rejudgeCandidates(
  ledger: ReturnType<typeof ledgerOf>,
  maxTokens: number,
  sessionId: string,
  chunks: ChunkStoreHandle | undefined,
): Promise<{ readonly records: readonly MemoryObservation[]; readonly chunkDropped: readonly string[] }> {
  const tombstones = ledger.tombstones ?? {};
  const byId = new Map(ledger.observations.map((record) => [record.id, record]));
  const discarded = Object.entries(tombstones)
    .filter(([id, tombstone]) => tombstone.reason.startsWith("wm discard") && byId.has(id))
    .map(([id], index) => ({ record: byId.get(id)!, index }))
    .sort((a, b) => b.index - a.index)
    .map(({ record }) => record);
  const records: MemoryObservation[] = [];
  const chunkDropped: string[] = [];
  let tokens = 0;
  for (const record of discarded) {
    if (tokens + record.tokenCount > maxTokens) continue;
    const refs = record.chunkRefs ?? [];
    if (refs.length) {
      const live = chunks
        ? await chunks.run(async (store) => {
            for (const ref of refs) if (await store.get(ref.id, sessionId)) return true;
            return false;
          })
        : false;
      if (!live) {
        chunkDropped.push(record.id);
        continue;
      }
    }
    records.push(record);
    tokens += record.tokenCount;
  }
  return { records, chunkDropped };
}

/** Tombstone records for one WM pass, one per verdict reason: `wm keep <item>`, `wm summarize <item>`, `wm discard <reason>`. */
function tombstoneGroups(verdicts: ReadonlyMap<string, WmRecordVerdict>): ReadonlyMap<string, readonly string[]> {
  const groups = new Map<string, string[]>();
  for (const [id, verdict] of verdicts) {
    const reason = `wm ${verdict.verdict} ${verdict.verdict === "discard" ? verdict.reason : verdict.itemId}`;
    groups.set(reason, [...(groups.get(reason) ?? []), id]);
  }
  return groups;
}

/** The configured instruction and thinking level a worker call carries, when set. */
function workerPrompt(settings: ResolvedWorkerSettings): { instruction?: string; thinkingLevel?: string } {
  return {
    ...(settings.instruction === undefined ? {} : { instruction: settings.instruction }),
    ...(settings.thinkingLevel === undefined ? {} : { thinkingLevel: settings.thinkingLevel }),
  };
}

/**
 * Bytes one batch of serialized source entries may take: half the worker message budget, so the
 * system prompt, task state, the recent STM index and the worker's own tool turns fit beside it.
 */
export function sourceBudget(maxMessageBytes: number): number {
  return Math.max(256, Math.floor(maxMessageBytes / 2));
}

/**
 * Where an STM batch of several entries closes: about twice the trigger in characters (`triggerTokens` counts
 * `ceil(len / 4)`, so 8 bytes per token is two triggers' worth), and never under 32 KB. A backlog (a failed pass, a pass skipped while
 * another ran) then runs as several trigger-sized passes rather than one large batch, which a model answers with
 * more events per turn than the worker allows (plan 217 Task 6). One entry larger than this still travels whole.
 */
export function stmBatchTargetBytes(triggerTokens: number): number {
  // The floor keeps a small trigger from splitting an ordinary tail into one pass per entry.
  return Math.max(STM_MIN_BATCH_TARGET_BYTES, triggerTokens * 8);
}

/** The smallest STM batch target: about 8k tokens of serialized source. */
export const STM_MIN_BATCH_TARGET_BYTES = 32 * 1024;

function taskStateContent(state: MemoryTaskState): string {
  const { goal, openQuestions = [], decisions = [], nextSteps = [] } = state;
  return JSON.stringify([goal, openQuestions, decisions, nextSteps]);
}

/** A record is JSON by construction (its fields are strings, numbers, and validated observations). */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
