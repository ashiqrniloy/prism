/**
 * One memory pass over the session's branch: STM records events → WM reflects → rehearsal drops, appending each recorded
 * batch to the ledger log.
 *
 * The pass is bounded and idempotent enough to run on every turn: it reads the branch once, folds the
 * ledger already in memory, and only calls a model when a threshold is crossed. One pass runs per
 * session at a time; a second request while one is in flight is skipped, not queued.
 */
import type { JsonValue, ModelClient, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";
import { resolveMemoryWorkerLimits, truncateWorkerText } from "@arnilo/prism-memory-core";
import type { ChunkOp, ChunkStoreHandle } from "../chunks.js";
import type { ResolvedMemorySystemConfig, ResolvedWorkerSettings } from "./config.js";
import {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  isEligibleObservationSourceEntry,
  observationsUncoveredByReflection,
  unscannedEntries,
} from "./coverage-helpers.js";
import { activeObservations, activeReflections, boundaryKey, type ObservationalMemoryRecord } from "./ledger.js";
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
  REFLECTIONS_RECORDED,
  TASK_STATE_RECORDED,
} from "./types.js";
import { dropObservationsToTarget, runDropper } from "./workers/dropper.js";
import { runReflector } from "./workers/reflector.js";
import { runStm } from "./workers/stm.js";

export type ObservationalWorkerKind = "observer" | "reflector" | "dropper";

export interface ObservationalFlushResult {
  readonly observations: number;
  readonly reflections: number;
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
  /** The worker model call for one kind, resolved from session state ← config ← the session model. */
  readonly clientFor: (session: SessionContext, kind: ObservationalWorkerKind) => ModelClient;
  /**
   * The session's secret set, forwarded to every worker call so a value redacts from its prompt and
   * errors. It comes from the kernel (branch entries are redacted at append; the compaction context
   * carries the agent's set), never from config text.
   */
  readonly secretsFor?: (session: SessionContext) => readonly (string | undefined)[];
  /**
   * The chunk store. Each pass writes its new chunks and removes the STM referrers of records it dropped in one
   * transaction, after its ledger appends (a failed write leaves a ref that recall reports as dropped, never an
   * unreferenced chunk). Absent, chunks are not stored and the `chunks` argument is off.
   */
  readonly chunks?: ChunkStoreHandle;
  /** `memory.session.status`, emitted on flush start, flush end, and flush failure. */
  readonly onStatus: (session: SessionContext, status: { inFlight: boolean; lastError?: string }) => void;
}

export interface ObservationalFlush {
  flush(
    session: SessionContext,
    options?: { readonly fullReflectionRebuild?: boolean; readonly signal?: AbortSignal },
  ): Promise<ObservationalFlushResult>;
  status(sessionId: string): ObservationalFlushStatus;
}

export function createObservationalFlush(deps: ObservationalFlushDeps): ObservationalFlush {
  const statuses = new Map<string, ObservationalFlushStatus>();
  const limits = resolveMemoryWorkerLimits(deps.config.worker);
  const set = (sessionId: string, next: ObservationalFlushStatus): void => {
    statuses.set(sessionId, next);
  };
  return {
    status: (sessionId) => statuses.get(sessionId) ?? { inFlight: false },
    async flush(session, options = {}) {
      if (statuses.get(session.id)?.inFlight) return { observations: 0, reflections: 0, dropped: 0, skipped: "in_flight" };
      set(session.id, { inFlight: true });
      deps.onStatus(session, { inFlight: true });
      try {
        const result = await pass(session, deps, limits, options);
        set(session.id, { inFlight: false });
        deps.onStatus(session, { inFlight: false });
        return result;
      } catch (error) {
        const lastError = truncateWorkerText(
          error instanceof Error ? error.message : "Observational memory pass failed",
          limits.maxErrorBytes,
        );
        set(session.id, { inFlight: false, lastError });
        deps.onStatus(session, { inFlight: false, lastError });
        throw error;
      }
    },
  };
}

async function pass(
  session: SessionContext,
  deps: ObservationalFlushDeps,
  limits: ReturnType<typeof resolveMemoryWorkerLimits>,
  options: { readonly fullReflectionRebuild?: boolean; readonly signal?: AbortSignal },
): Promise<ObservationalFlushResult> {
  const config = deps.config;
  const workerSessionId = `memory.session:${session.id}`;
  const entries = await session.entries();
  const ledger = ledgerOf(deps.log.entries(session));
  const pending = unscannedEntries(entries, ledger.latestObservationCoverageId);
  const eligibleSources = eligibleObservationSources(pending);
  const eligibleTokens = eligibleObservationTokenCount(eligibleSources);
  const lastScannedId = pending.at(-1)?.id;
  const droppedBefore = new Set(ledger.droppedObservationIds);
  const chunkOps: ChunkOp[] = [];
  try {
    return await passBody();
  } finally {
    if (deps.chunks) {
      const after = ledgerOf(deps.log.entries(session));
      for (const id of after.droppedObservationIds) {
        if (droppedBefore.has(id)) continue;
        const record = after.observations.find((item) => item.id === id);
        for (const ref of record?.chunkRefs ?? [])
          chunkOps.push({ op: "unref", id: ref.id, by: { kind: "stm", id, sessionId: session.id } });
      }
      if (chunkOps.length) await deps.chunks.run((store) => store.apply(chunkOps));
    }
  }

  async function passBody(): Promise<ObservationalFlushResult> {
    let observations = 0;
    let reflections = 0;
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
    // records — never the episode scope, a WM item (reflection) or an LTM note.
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
    const uncovered = observationsUncoveredByReflection(
      deps.log.entries(session),
      afterObservations,
      options.fullReflectionRebuild === true,
    );
    const uncoveredTokens = uncovered.reduce((sum, item) => sum + item.tokenCount, 0);
    if (config.wm.enabled && uncovered.length && uncoveredTokens >= config.wm.observationTokens) {
      const recorded = await runReflector({
        client: deps.clientFor(session, "reflector"),
        observations: uncovered,
        reflections: activeReflections(afterObservations),
        ...limits,
        ...workerPrompt(config.wm),
        secrets,
        sessionId: workerSessionId,
        signal: options.signal,
      });
      await deps.log.append(
        session,
        asJson({
          type: REFLECTIONS_RECORDED,
          reflections: recorded,
          ...(recorded.length
            ? {
                consumedObservationIds: uncovered.map((item) => item.id),
                supersededReflectionIds: activeReflections(afterObservations).map((item) => item.id),
              }
            : {}),
          ...(afterObservations.latestObservationCoverageId === undefined
            ? {}
            : { coversUpToId: afterObservations.latestObservationCoverageId }),
        }),
      );
      reflections = recorded.length;
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

    return { observations, reflections, dropped, ...(boundaries ? { boundaries } : {}) };
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
