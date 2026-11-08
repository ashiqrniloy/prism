/**
 * One observation pass over the session's branch: observe → reflect → drop, appending each recorded
 * batch to the ledger log.
 *
 * The pass is bounded and idempotent enough to run on every turn: it reads the branch once, folds the
 * ledger already in memory, and only calls a model when a threshold is crossed. One pass runs per
 * session at a time; a second request while one is in flight is skipped, not queued.
 */
import type { JsonValue, ModelClient, SessionContext, SessionLog } from "@arnilo/prism";

import type { ResolvedMemoryObservationalConfig } from "./config.js";
import {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  observationsUncoveredByReflection,
  unscannedEntries,
} from "./coverage-helpers.js";
import { activeObservations, activeReflections, type ObservationalMemoryRecord } from "./ledger.js";
import { resolveMemoryWorkerLimits, truncateWorkerText } from "@arnilo/prism-memory-core";
import { ledgerOf, type ObservationalMemoryState } from "./state.js";
import { OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "./types.js";
import { dropObservationsToTarget, runDropper } from "./workers/dropper.js";
import { runObserver } from "./workers/observer.js";
import { runReflector } from "./workers/reflector.js";

export type ObservationalWorkerKind = "observer" | "reflector" | "dropper";

export interface ObservationalFlushResult {
  readonly observations: number;
  readonly reflections: number;
  readonly dropped: number;
  /** Present when the pass did not run. A pass that ran and recorded nothing has no `skipped` value. */
  readonly skipped?: "in_flight";
}

export interface ObservationalFlushStatus {
  readonly inFlight: boolean;
  readonly lastError?: string;
}

export interface ObservationalFlushDeps {
  readonly log: SessionLog<JsonValue>;
  readonly config: ResolvedMemoryObservationalConfig;
  /** The per-session toggle and worker model refs. */
  readonly readState: (session: SessionContext) => ObservationalMemoryState;
  /** The worker model call for one kind, resolved from session state ← config ← the session model. */
  readonly clientFor: (session: SessionContext, kind: ObservationalWorkerKind) => ModelClient;
  /** `om.status`, emitted on flush start, flush end, and flush failure. */
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
  const omSessionId = `om:${session.id}`;
  const entries = await session.entries();
  const ledger = ledgerOf(deps.log.entries(session));
  const pending = unscannedEntries(entries, ledger.latestObservationCoverageId);
  const eligibleSources = eligibleObservationSources(pending);
  const eligibleTokens = eligibleObservationTokenCount(eligibleSources);
  const lastScannedId = pending.at(-1)?.id;
  let observations = 0;
  let reflections = 0;
  let dropped = 0;

  if (pending.length && lastScannedId) {
    if (!eligibleSources.length) {
      // Nothing eligible in the tail: advance coverage so the next pass does not rescan it.
      await deps.log.append(session, asJson({ type: OBSERVATIONS_RECORDED, observations: [], coversUpToId: lastScannedId }));
    } else if (eligibleTokens >= config.observer.messageTokens) {
      const records: ObservationalMemoryRecord[] = [];
      const recorded = await runObserver({
        onRecord: (record) => {
          records.push(record);
        },
        taskState: ledger.taskState,
        client: deps.clientFor(session, "observer"),
        entries: eligibleSources,
        observations: (() => {
          const recent = [...activeObservations(ledger)].sort((a, b) => Date.parse(a.observedAt ?? a.timestamp) - Date.parse(b.observedAt ?? b.timestamp));
          let tokens = recent.reduce((sum, item) => sum + item.tokenCount, 0);
          while (recent.length && tokens > config.dropper.targetTokens / 4) tokens -= recent.shift()!.tokenCount;
          return recent;
        })(),
        ...limits,
        sessionId: omSessionId,
        signal: options.signal,
      });
      await deps.log.append(session, asJson({ type: OBSERVATIONS_RECORDED, observations: recorded, coversUpToId: lastScannedId }));
      for (const record of records) await deps.log.append(session, asJson(record));
      observations = recorded.length;
    }
  }

  const afterObservations = ledgerOf(deps.log.entries(session));
  const uncovered = observationsUncoveredByReflection(deps.log.entries(session), afterObservations, options.fullReflectionRebuild === true);
  const uncoveredTokens = uncovered.reduce((sum, item) => sum + item.tokenCount, 0);
  if (uncovered.length && uncoveredTokens >= config.reflector.observationTokens) {
    const recorded = await runReflector({
      client: deps.clientFor(session, "reflector"),
      observations: uncovered,
      reflections: activeReflections(afterObservations),
      ...limits,
      sessionId: omSessionId,
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
  if (activeTokens > config.dropper.targetTokens) {
    const ids =
      config.dropper.policy === "lowest-relevance"
        ? dropObservationsToTarget(active, config.dropper.targetTokens)
        : await runDropper({
            client: deps.clientFor(session, "dropper"),
            observations: active,
            targetTokens: config.dropper.targetTokens,
            ...limits,
            sessionId: omSessionId,
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

  return { observations, reflections, dropped };
}

/** A record is JSON by construction (its fields are strings, numbers, and validated observations). */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
