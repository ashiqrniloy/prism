/**
 * One maintenance pass (plan 188.4 Tasks 4-5): archive, capacity — in that
 * order, once per active scope, metadata-only except for the opt-in episode merge.
 *
 * The pass is where the lifecycle's slow work happens: no turn waits for it, nothing here runs on
 * the read path, and every step stops where the store says it cannot go.
 */
import {
  type Memory,
  MemoryValidationError,
  type MemoryVectorMetadataPage,
  type VectorScanMetadataQuery,
  type VectorStore,
} from "@arnilo/prism-memory-system/core";
import type { ResolvedLifecycleConfig } from "../config.js";
import {
  estimateNoteTokens,
  type MemoryFabricMaintainOptions,
  type MemoryFabricMaintenanceReport,
  type MemoryFabricScopeBudget,
  type MemoryNoteMetadata,
  type MemoryNoteScope,
  type MemoryNoteStatus,
  parseMemoryNoteMetadata,
} from "../types.js";
import { shouldArchive } from "./archive.js";
import {
  type CapacityLimits,
  type CapacityNote,
  capacityForLevel,
  capacityUsage,
  evictionOrder,
  exchangeDemotionOrder,
  overCapacity,
} from "./capacity.js";
import { SCOPE_CLOCK_COUNTER } from "./clock.js";
import type { FabricLifecycle } from "./index.js";
import { duplicateGroups, mergedMetadata } from "./merge.js";
import { normalizeNoteStatus } from "./status.js";

/** `Memory.get` refuses more than 1000 ids, and scan rows span every thread of the resource. */
const MAINTAIN_PAGE = 500;
const MAINTAIN_GET_BATCH = 1_000;

export interface MaintenanceDeps {
  /** Active scope memories, narrowest first, as the package resolved them. */
  readonly memories: readonly Memory[];
  readonly levels: readonly MemoryNoteScope[];
  readonly lifecycles: readonly FabricLifecycle[];
  /** The store behind the memories; `maintain()` needs `scanMetadata`. */
  readonly store?: VectorStore;
  readonly lifecycle?: ResolvedLifecycleConfig;
  readonly notify?: (message: string) => void;
  /** The process-wide scope ordinal, used when the store has no counter. */
  readonly clock?: () => number;
}

interface ActiveRow {
  readonly id: string;
  readonly metadata: MemoryNoteMetadata;
  readonly status: MemoryNoteStatus;
}

/** Every active note of one resource, one `scanMetadata` pass. Held notes never appear. */
async function scanActiveRows(
  scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>,
  identity: { readonly tenantId: string; readonly resourceId: string },
  signal?: AbortSignal,
): Promise<readonly ActiveRow[]> {
  const rows: ActiveRow[] = [];
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = await scanMetadata({
      scope: identity,
      limit: MAINTAIN_PAGE,
      ...(cursor === undefined ? {} : { cursor }),
      ...(signal === undefined ? {} : { signal }),
    });
    for (const row of page.rows) {
      const metadata = parseMemoryNoteMetadata(row.metadata);
      if (metadata === undefined) continue;
      const status = normalizeNoteStatus(row.metadata?.status as string | undefined, "verified");
      if (status !== "candidate" && status !== "verified") continue;
      rows.push({ id: row.id, metadata, status });
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return rows;
}

/**
 * Text and tokens for the rows the pass may rewrite. A row in another thread of the resource has no
 * readable text through `Memory.get`; it still counts against the budget but is never merged.
 */
async function capacityNotes(memory: Memory, rows: readonly ActiveRow[], signal?: AbortSignal): Promise<readonly CapacityNote[]> {
  const text = new Map<string, string>();
  try {
    for (let index = 0; index < rows.length; index += MAINTAIN_GET_BATCH) {
      const ids = rows.slice(index, index + MAINTAIN_GET_BATCH).map((row) => row.id);
      for (const record of await memory.get(ids, signal === undefined ? {} : { signal })) text.set(record.id, record.text);
    }
  } catch {
    // A store without `getByIds` can still be maintained: it just cannot merge or evict.
    text.clear();
  }
  return rows.map((row) => {
    const body = text.get(row.id);
    return {
      id: row.id,
      metadata: row.metadata,
      status: row.status,
      ...(body === undefined ? {} : { text: body }),
      tokens: body === undefined ? 0 : estimateNoteTokens(body),
    };
  });
}

/** The scope's own session ordinal, so an idle scope is never aged by another scope's work. */
async function scopeClock(deps: MaintenanceDeps, memory: Memory): Promise<number> {
  const counter = deps.store?.scopeCounter;
  if (counter !== undefined) {
    const value = await counter.get({
      tenantId: memory.scope.tenantId,
      resourceId: memory.scope.resourceId,
      name: SCOPE_CLOCK_COUNTER,
    });
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return deps.clock?.() ?? 0;
}

/**
 * `enforceCapacity(scope)` (plan 188.4 Task 5): merge duplicates, then evict the notes
 * the ranking already valued least, stopping as soon as the scope is inside its budget.
 */
async function enforceCapacity(
  deps: MaintenanceDeps,
  input: {
    readonly index: number;
    readonly clock: number;
    readonly notes: readonly CapacityNote[];
    readonly limits: CapacityLimits;
    readonly now: number;
    readonly signal?: AbortSignal;
  },
): Promise<{ readonly merged: number; readonly evicted: number; readonly kept: readonly CapacityNote[] }> {
  const { index, clock, limits, now, signal } = input;
  const lifecycle = deps.lifecycle;
  const decision = {
    decay: lifecycle?.decay,
    storageWeights: lifecycle?.storageWeights,
    archive: lifecycle?.archive,
  };
  const removed = new Set<string>();
  const live = () => input.notes.filter((note) => !removed.has(note.id));
  const usage = () => capacityUsage(live());
  const over = () => overCapacity(usage(), limits);
  const archive = (id: string, verb: string, mergedInto?: string) =>
    deps.lifecycles[index]!.archive(id, {
      now,
      auditVerb: verb,
      ...(mergedInto === undefined ? {} : { mergedInto }),
      ...(signal === undefined ? {} : { signal }),
    });
  let merged = 0;
  let evicted = 0;

  // 1. Duplicates: deterministic, no model. The survivor keeps its id and absorbs the rest.
  for (const group of duplicateGroups(live(), { duplicateDice: lifecycle?.merge.duplicateDice, weights: lifecycle?.storageWeights })) {
    if (!over()) break;
    const next = mergedMetadata(
      group.survivor.metadata,
      group.others.map((note) => note.metadata),
    );
    if (!(await deps.lifecycles[index]!.mergeMetadata(group.survivor.id, next, signal === undefined ? {} : { signal }))) continue;
    for (const other of group.others) {
      if (!(await archive(other.id, "merged", group.survivor.id))) continue;
      removed.add(other.id);
      merged += 1;
    }
  }

  // 2. Eviction: lowest `S·exp(R)` first, never a pinned note and never one above the archive's
  // storage threshold. A merge never re-embeds, so this is the only step that can free tokens.
  for (const note of evictionOrder(live(), clock, decision)) {
    if (!over()) break;
    if (!(await archive(note.id, "evicted"))) continue;
    removed.add(note.id);
    evicted += 1;
  }
  return { merged, evicted, kept: live() };
}

export async function runMaintenance(
  deps: MaintenanceDeps,
  options: MemoryFabricMaintainOptions = {},
): Promise<MemoryFabricMaintenanceReport> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const scanMetadata = deps.store?.scanMetadata;
  if (scanMetadata === undefined) throw new MemoryValidationError("maintenance requires scanMetadata");
  const now = Date.now();
  const lifecycle = deps.lifecycle;
  const decision = {
    ...(lifecycle === undefined ? {} : { decay: lifecycle.decay, storageWeights: lifecycle.storageWeights, archive: lifecycle.archive }),
  };
  const targets = deps.memories
    .map((memory, index) => ({ memory, index }))
    .filter(({ memory }) => options.scope === undefined || memory.scope.resourceId === options.scope);
  if (options.scope !== undefined && targets.length === 0) {
    throw new MemoryValidationError(`unknown maintenance scope: ${options.scope}`);
  }

  let archived = 0;
  let merged = 0;
  let evicted = 0;
  const overBudget: MemoryFabricScopeBudget[] = [];
  for (const { memory, index } of targets) {
    const level: MemoryNoteScope = deps.levels[index] ?? "project";
    const clock = await scopeClock(deps, memory);
    const rows = await scanActiveRows(scanMetadata, { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId }, signal);
    const survivors: ActiveRow[] = [];
    for (const row of rows) {
      // Metadata only: archiving never re-embeds and never sets `validTo`.
      if (
        shouldArchive(row.metadata, clock, decision) &&
        (await deps.lifecycles[index]!.archive(row.id, { now, ...(signal === undefined ? {} : { signal }) }))
      ) {
        archived += 1;
        continue;
      }
      survivors.push(row);
    }
    const limits = capacityForLevel(level, lifecycle?.capacity);
    const notes = await capacityNotes(memory, survivors, signal);
    // Raw exchanges have their own size-only tier. They never consume the fact/procedure budget,
    // and a demotion keeps the note text in the searchable archive.
    const regularNotes = notes.filter((note) => note.metadata.kind !== "exchange");
    let exchanges = notes.filter((note) => note.metadata.kind === "exchange");
    let usage = capacityUsage(regularNotes);
    let kept: readonly CapacityNote[] = regularNotes;
    if (overCapacity(usage, limits)) {
      const result = await enforceCapacity(deps, {
        index,
        clock,
        notes: regularNotes,
        limits,
        now,
        ...(signal === undefined ? {} : { signal }),
      });
      merged += result.merged;
      evicted += result.evicted;
      kept = result.kept;
      usage = capacityUsage(kept);
    }
    const hotTokens = lifecycle?.exchangeCapacity.hotTokens;
    if (hotTokens !== undefined) {
      let exchangeTokens = capacityUsage(exchanges).tokens;
      const demoted = new Set<string>();
      for (const note of exchangeDemotionOrder(exchanges, clock, decision)) {
        if (exchangeTokens <= hotTokens) break;
        if (
          !(await deps.lifecycles[index]!.archive(note.id, {
            now,
            auditVerb: "demoted",
            ...(signal === undefined ? {} : { signal }),
          }))
        )
          continue;
        demoted.add(note.id);
        exchangeTokens -= note.tokens;
        evicted += 1;
      }
      if (demoted.size > 0) exchanges = exchanges.filter((note) => !demoted.has(note.id));
    }
    if (overCapacity(usage, limits)) {
      overBudget.push({
        scope: memory.scope.resourceId,
        notes: usage.notes,
        tokens: usage.tokens,
        limitNotes: limits.notes,
        limitTokens: limits.tokens,
      });
      deps.notify?.(
        `memory-fabric: ${memory.scope.resourceId} stays over its capacity budget (${usage.notes}/${limits.notes} notes, ${usage.tokens}/${limits.tokens} tokens): every note left is pinned or holds storage strength`,
      );
    }
  }

  return { archived, merged, evicted, overBudget };
}
