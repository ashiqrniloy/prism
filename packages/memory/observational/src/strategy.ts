import {
  type CompactionContext,
  type CompactionEntryData,
  type CompactionResult,
  type Compactor,
  createSessionEntry,
  redactSecrets,
  type SessionEntry,
} from "@arnilo/prism";
import { eligibleObservationSources, unscannedEntries } from "./coverage-helpers.js";
import { activeObservations, activeReflections, foldObservationalMemoryLedger, type ObservationalMemoryLedger } from "./ledger.js";
import { boundMemoryPayload, HARD_MAX_FOLDED_PAYLOAD_BYTES } from "./memory-bounds.js";
import { buildObservationalMemoryProjection, createFoldedMemoryDetails, type ObservationalMemoryProjection } from "./projection.js";
import { DEFAULT_KEEP_RECENT_ENTRIES, selectRecentMessageEntryIds } from "./recent-messages.js";
import { renderObservationalMemory } from "./render.js";
import type { MemoryObservation, MemoryReflection } from "./types.js";

export interface ObservationalMemoryCompactorOptions {
  readonly name?: string;
  readonly keepRecentEntries?: number;
  readonly observationsPoolMaxTokens?: number;
  readonly secrets?: readonly (string | undefined)[];
  /** Render recall guidance in the summary only when the host exposes recall. Default `true`. */
  readonly advertiseRecall?: boolean;
  /**
   * Reads the ledger. Default: fold the branch's entries (the 0.12 attach path, where records are
   * `custom` entries and a compaction entry carries the folded payload). A package passes the ledger
   * its session log already holds.
   */
  readonly ledgerOf?: (context: CompactionContext) => ObservationalMemoryLedger;
}

const DEFAULT_OBSERVATIONS_POOL_MAX_TOKENS = 20_000;

export function createObservationalMemoryCompactor(options: ObservationalMemoryCompactorOptions = {}): Compactor {
  const name = options.name ?? "observational-memory";
  return {
    name,
    compact(context) {
      throwIfAborted(context.signal);
      const keepRecentEntries = Math.max(0, context.keepRecentEntries ?? options.keepRecentEntries ?? DEFAULT_KEEP_RECENT_ENTRIES);
      const keepEntryIds = coverageAwareKeepEntryIds(context.entries, keepRecentEntries, options.ledgerOf?.(context));
      const firstKeptEntryId = keepEntryIds[0];
      const firstKeptIndex = firstKeptEntryId
        ? context.entries.findIndex((entry) => entry.id === firstKeptEntryId)
        : context.entries.length;
      const oldEntries = context.entries.slice(0, firstKeptIndex < 0 ? context.entries.length : firstKeptIndex);
      const throughEntryId = oldEntries.at(-1)?.id;
      const projection = options.ledgerOf
        ? visibleProjection(options.ledgerOf(context))
        : buildObservationalMemoryProjection(context.entries, firstKeptEntryId);
      const fullActiveObservations = activeObservations(projection.full);
      const fullObservationTokens = fullActiveObservations.reduce((sum, item) => sum + item.tokenCount, 0);
      const maxTokens = options.observationsPoolMaxTokens ?? DEFAULT_OBSERVATIONS_POOL_MAX_TOKENS;
      const fullFold = fullObservationTokens > maxTokens;
      const source = fullFold
        ? {
            observations: fullActiveObservations,
            reflections: activeReflections(projection.full),
            droppedObservationIds: projection.full.droppedObservationIds,
          }
        : {
            observations: projection.observations,
            reflections: projection.reflections,
            droppedObservationIds: projection.droppedObservationIds,
          };
      const bounded = boundMemoryPayload(
        source.observations,
        source.reflections,
        source.droppedObservationIds,
        maxTokens,
        HARD_MAX_FOLDED_PAYLOAD_BYTES,
      );
      const memory = {
        observations: bounded.observations,
        reflections: bounded.reflections,
        droppedObservationIds: bounded.droppedObservationIds,
      };
      const secrets = [...(options.secrets ?? []), ...(context.secrets ?? [])];
      const summary = renderObservationalMemory(memory.reflections, memory.observations, {
        secrets,
        advertiseRecall: options.advertiseRecall,
        taskState: projection.full.taskState,
      });
      const data: CompactionEntryData & { readonly memory: unknown } = {
        throughEntryId,
        keepEntryIds,
        strategy: name,
        trigger: context.trigger,
        memory: redactMemory(memory, bounded.fullFold || fullFold, secrets),
      };
      const parentId = context.entries.at(-1)?.id;
      return {
        summary,
        entries: [createSessionEntry({ sessionId: context.sessionId, parentId, kind: "compaction", summary, data })],
      } satisfies CompactionResult;
    },
  };
}

/**
 * Keep recent messages plus every eligible message after the observation coverage cursor. A
 * skipped or failed observer pass leaves the tail unscanned; retaining it keeps evidence out of a
 * summary that does not cover it, so the next context rebuild cannot lose it silently. Fully
 * covered sessions get exactly the previous recent-window behavior.
 */
function coverageAwareKeepEntryIds(
  entries: readonly SessionEntry[],
  keepRecentEntries: number,
  folded?: ObservationalMemoryLedger,
): readonly string[] {
  const recent = new Set(selectRecentMessageEntryIds(entries, keepRecentEntries));
  const ledger = folded ?? foldObservationalMemoryLedger(entries);
  const uncovered = new Set(
    eligibleObservationSources(unscannedEntries(entries, ledger.latestObservationCoverageId)).map((entry) => entry.id),
  );
  return entries.filter((entry) => recent.has(entry.id) || uncovered.has(entry.id)).map((entry) => entry.id);
}

/**
 * The visible set a log-backed ledger already is: the records are the ledger, so there is no
 * compaction boundary to project through. The full ledger is the same fold.
 */
function visibleProjection(ledger: ObservationalMemoryLedger): ObservationalMemoryProjection {
  return {
    full: ledger,
    ...(ledger.taskState ? { taskState: ledger.taskState } : {}),
    observations: activeObservations(ledger),
    reflections: activeReflections(ledger),
    droppedObservationIds: ledger.droppedObservationIds,
  };
}

function redactMemory(
  memory: {
    readonly observations: readonly MemoryObservation[];
    readonly reflections: readonly MemoryReflection[];
    readonly droppedObservationIds: readonly string[];
  },
  fullFold: boolean,
  secrets: readonly (string | undefined)[],
): unknown {
  const redacted = createFoldedMemoryDetails(memory, fullFold);
  return JSON.parse(redactSecrets(JSON.stringify(redacted), secrets));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Observational memory compaction aborted");
}
