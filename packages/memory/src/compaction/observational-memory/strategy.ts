import {
  type CompactionEntryData,
  type CompactionResult,
  type CompactionStrategy,
  createSessionEntry,
  redactSecrets,
  type SessionEntry,
} from "@arnilo/prism";
import { activeObservations, type ObservationalMemoryLedger } from "./ledger.js";
import { boundMemoryPayload, HARD_MAX_FOLDED_PAYLOAD_BYTES } from "./memory-bounds.js";
import { buildObservationalMemoryProjection, createFoldedMemoryDetails } from "./projection.js";
import { DEFAULT_KEEP_RECENT_ENTRIES, selectRecentMessageEntryIds } from "./recent-messages.js";
import { renderObservationalMemory } from "./render.js";
import { foldWorkScopeMap, SESSION_WORK_SCOPE_ID } from "./scopes.js";
import { projectWorkMemory, type WorkScopeOutline } from "./scopes-project.js";
import type { MemoryObservation, MemoryReflection } from "./types.js";

export interface ObservationalMemoryCompactionStrategyOptions {
  readonly name?: string;
  readonly keepRecentEntries?: number;
  readonly observationsPoolMaxTokens?: number;
  readonly secrets?: readonly (string | undefined)[];
}

const DEFAULT_OBSERVATIONS_POOL_MAX_TOKENS = 20_000;

export function createObservationalMemoryCompactionStrategy(
  options: ObservationalMemoryCompactionStrategyOptions = {},
): CompactionStrategy {
  const name = options.name ?? "observational-memory";
  return {
    name,
    compact(context) {
      throwIfAborted(context.signal);
      const keepRecentEntries = Math.max(0, context.keepRecentEntries ?? options.keepRecentEntries ?? DEFAULT_KEEP_RECENT_ENTRIES);
      const keepEntryIds = selectRecentMessageEntryIds(context.entries, keepRecentEntries);
      const firstKeptEntryId = keepEntryIds[0];
      const firstKeptIndex = firstKeptEntryId
        ? context.entries.findIndex((entry) => entry.id === firstKeptEntryId)
        : context.entries.length;
      const oldEntries = context.entries.slice(0, firstKeptIndex < 0 ? context.entries.length : firstKeptIndex);
      const throughEntryId = oldEntries.at(-1)?.id;
      const projection = buildObservationalMemoryProjection(context.entries, firstKeptEntryId);
      const fullActiveObservations = activeObservations(projection.full);
      const fullObservationTokens = fullActiveObservations.reduce((sum, item) => sum + item.tokenCount, 0);
      const maxTokens = options.observationsPoolMaxTokens ?? DEFAULT_OBSERVATIONS_POOL_MAX_TOKENS;
      const fullFold = fullObservationTokens > maxTokens;
      const source = fullFold
        ? {
            observations: fullActiveObservations,
            reflections: projection.full.reflections,
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
      const scoped = projectScopedMemory(context.entries, memory);
      const summary = renderObservationalMemory(scoped.reflections, scoped.observations, {
        secrets,
        ...(scoped.outline.length ? { outline: scoped.outline } : {}),
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
 * The compaction entry is what the next pack carries, so its summary renders the current working
 * set (leaf scope + ancestors) when the host opened work scopes. The folded payload keeps every
 * observation, so a later projection into another scope can still see what this summary hid.
 */
function projectScopedMemory(
  entries: readonly SessionEntry[],
  memory: ObservationalMemoryLedger,
): {
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly outline: readonly WorkScopeOutline[];
} {
  const workScopes = foldWorkScopeMap(entries);
  if (workScopes.scopes.size === 1) return { observations: memory.observations, reflections: memory.reflections, outline: [] };
  return projectWorkMemory(memory, workScopes, {
    from: workScopes.stack.at(-1) ?? SESSION_WORK_SCOPE_ID,
    include: "self+ancestors",
    closed: "hide",
  });
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
