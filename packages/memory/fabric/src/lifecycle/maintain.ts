/**
 * One maintenance pass (plan 188.4 Tasks 4-6): archive, capacity, widening, narrowing — in that
 * order, once per active scope, metadata-only except for the opt-in episode merge.
 *
 * The pass is where the lifecycle's slow work happens: no turn waits for it, nothing here runs on
 * the read path, and every step stops where the store says it cannot go.
 */
import type { ModelClient, SecretRedactor } from "@arnilo/prism";
import {
  type Memory,
  MemoryValidationError,
  type MemoryVectorMetadataPage,
  type VectorScanMetadataQuery,
  type VectorStore,
} from "@arnilo/prism-memory-core";
import type { ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import type { ResolvedLifecycleConfig } from "../config.js";
import {
  estimateNoteTokens,
  type MemoryFabric,
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
import { createFabricLifecycle } from "./index.js";
import { duplicateGroups, episodeClusters, mergedMetadata, summarizeEpisodeCluster } from "./merge.js";
import { normalizeNoteStatus } from "./status.js";
import { crossProjectGroups, mergedKeywords, narrowingCandidates, normalizeWidenText, siblingGroups, type WidenNote } from "./widen.js";

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
  readonly remember: MemoryFabric["remember"];
  readonly lifecycle?: ResolvedLifecycleConfig;
  /** Resolved once by the caller: episode merging is the only step that can call a model. */
  readonly workerLimits: ResolvedMemoryWorkerLimits;
  readonly resolveModelClient?: (model?: string) => ModelClient;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly notify?: (message: string) => void;
  /** The process-wide scope ordinal, used when the store has no counter. */
  readonly clock?: () => number;
  /** Opens a project the host did not bind; see `CreateMemoryFabricOptions.openScope`. */
  readonly openScope?: (input: {
    readonly level: MemoryNoteScope;
    readonly tenantId: string;
    readonly resourceId: string;
  }) => Memory | undefined | Promise<Memory | undefined>;
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
 * `enforceCapacity(scope)` (plan 188.4 Task 5): merge duplicates, then episodes, then evict the notes
 * the ranking already valued least, stopping as soon as the scope is inside its budget.
 */
async function enforceCapacity(
  deps: MaintenanceDeps,
  input: {
    readonly index: number;
    readonly level: MemoryNoteScope;
    readonly clock: number;
    readonly notes: readonly CapacityNote[];
    readonly limits: CapacityLimits;
    readonly now: number;
    readonly signal?: AbortSignal;
  },
): Promise<{ readonly merged: number; readonly episodesMerged: number; readonly evicted: number; readonly kept: readonly CapacityNote[] }> {
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
  let episodesMerged = 0;
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

  // 2. Episode clusters: one model call each, off unless configured. A cluster whose summary was not
  // written stays untouched — the episodes outlive a failed call.
  const episodes = lifecycle?.merge.episodes;
  if (episodes !== undefined && over()) {
    const client = deps.resolveModelClient?.(episodes.model);
    if (client === undefined) {
      deps.notify?.("memory-fabric: lifecycle.merge.episodes is on but no model client is available; episode clusters were not merged");
    } else {
      for (const cluster of episodeClusters(live(), episodes.minCluster)) {
        if (!over()) break;
        signal?.throwIfAborted();
        const summary = await summarizeEpisodeCluster({
          cluster,
          client,
          limits: deps.workerLimits,
          ...(deps.redactor === undefined ? {} : { redactor: deps.redactor }),
          ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
          ...(signal === undefined ? {} : { signal }),
        });
        if (summary === undefined) continue;
        const key = cluster.subject.startsWith("#") ? undefined : cluster.subject;
        const written = await deps.remember(
          {
            kind: summary.kind,
            content: summary.text,
            scope: input.level,
            ...(key === undefined ? {} : { key }),
            ...(summary.keywords === undefined ? {} : { keywords: summary.keywords }),
            sourceEntryIds: cluster.notes.map((note) => note.id),
          },
          { status: "candidate", generatedBy: "promotion", ...(signal === undefined ? {} : { signal }) },
        );
        for (const note of cluster.notes) {
          if (!(await archive(note.id, "merged", written.id))) continue;
          removed.add(note.id);
        }
        episodesMerged += 1;
      }
    }
  }

  // 3. Eviction: lowest `S·exp(R)` first, never a pinned note and never one above the archive's
  // storage threshold. A merge never re-embeds, so this is the only step that can free tokens.
  for (const note of evictionOrder(live(), clock, decision)) {
    if (!over()) break;
    if (!(await archive(note.id, "evicted"))) continue;
    removed.add(note.id);
    evicted += 1;
  }
  return { merged, episodesMerged, evicted, kept: live() };
}

/**
 * Every project resource the store lists, tagged with the project it came from. A resource this
 * instance has no `Memory` for is scanned for metadata only (replication evidence) unless the host's
 * `openScope` resolver hands one back: then its text is readable and its notes are rewritable.
 */
async function projectNotes(
  deps: MaintenanceDeps,
  scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>,
  active: ReadonlyMap<number, readonly CapacityNote[]>,
  signal?: AbortSignal,
): Promise<{ readonly rows: readonly WidenNote[]; readonly opened: ReadonlyMap<string, FabricLifecycle> }> {
  const bound = new Map<string, number>();
  deps.memories.forEach((memory, index) => {
    if (deps.levels[index] === "project") bound.set(memory.scope.resourceId, index);
  });
  const resources = [...bound.keys()];
  const tenantId = deps.memories[0]?.scope.tenantId;
  if (tenantId !== undefined) {
    const listed = await deps.store?.listResources?.({ tenantId, prefix: "projects/" });
    for (const resourceId of listed ?? []) if (!bound.has(resourceId)) resources.push(resourceId);
  }
  const rows: WidenNote[] = [];
  const opened = new Map<string, FabricLifecycle>();
  const resolver = new ProjectResolver(deps, tenantId);
  for (const project of resources) {
    const index = bound.get(project);
    let notes: readonly CapacityNote[];
    if (index !== undefined) {
      notes = active.get(index) ?? [];
    } else {
      const identity = { tenantId: tenantId ?? "", resourceId: project };
      const discovered = await scanActiveRows(scanMetadata, identity, signal);
      const memory = await resolver.open(identity);
      if (memory === undefined) {
        notes = discovered.map((row) => ({ id: row.id, metadata: row.metadata, status: row.status, tokens: 0 }));
      } else {
        notes = await capacityNotes(memory, discovered, signal);
        opened.set(project, resolver.lifecycle(memory));
      }
    }
    for (const note of notes) if (note.metadata.scope !== "path") rows.push({ ...note, project });
  }
  return { rows, opened };
}

/**
 * The host's resolver, called once per unbound project (plan 188.4 Further Action 2). A throw, or a
 * memory for a different resource, is treated as "not opened": the pass keeps the resource as
 * metadata-only evidence instead of reading or rewriting the wrong notes.
 */
class ProjectResolver {
  private readonly cache = new Map<string, Memory | null>();
  private readonly lifecycles = new Map<Memory, FabricLifecycle>();
  constructor(
    private readonly deps: MaintenanceDeps,
    private readonly tenantId: string | undefined,
  ) {}

  lifecycle(memory: Memory): FabricLifecycle {
    let lifecycle = this.lifecycles.get(memory);
    if (lifecycle === undefined) {
      lifecycle = createFabricLifecycle(memory);
      this.lifecycles.set(memory, lifecycle);
    }
    return lifecycle;
  }

  async open(identity: { readonly tenantId: string; readonly resourceId: string }): Promise<Memory | undefined> {
    const cached = this.cache.get(identity.resourceId);
    if (cached !== undefined) return cached ?? undefined;
    let memory: Memory | undefined;
    try {
      memory = await this.deps.openScope?.({ level: "project", ...identity });
    } catch {
      memory = undefined;
    }
    const usable =
      memory !== undefined &&
      identity.tenantId !== "" &&
      memory.scope.tenantId === identity.tenantId &&
      memory.scope.resourceId === identity.resourceId
        ? memory
        : null;
    this.cache.set(identity.resourceId, usable);
    return usable ?? undefined;
  }
}

/** Temporal validity travels with a widened note; evidence lineage keeps the copies' source ids. */
function temporalFields(metadata: WidenNote["metadata"]): {
  readonly tRef?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly tags?: readonly string[];
} {
  return {
    ...(metadata.tRef === undefined ? {} : { tRef: metadata.tRef }),
    ...(metadata.validFrom === undefined ? {} : { validFrom: metadata.validFrom }),
    ...(metadata.validTo === undefined ? {} : { validTo: metadata.validTo }),
    ...(metadata.tags === undefined ? {} : { tags: metadata.tags }),
  };
}

function lineageIds(notes: readonly CapacityNote[]): readonly string[] {
  return [...new Set(notes.flatMap((note) => [note.id, ...(note.metadata.sourceEntryIds ?? [])]))];
}

/**
 * Project → agent (plan 188.4 Task 6): a lesson verified in `minProjects` projects becomes an agent
 * candidate with the project notes as evidence; the project copies keep only `widenedTo`. The new
 * note is a candidate on purpose — the agent scope has to use it before it counts for anything.
 */
async function widenToAgent(
  deps: MaintenanceDeps,
  scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>,
  active: ReadonlyMap<number, readonly CapacityNote[]>,
  signal?: AbortSignal,
): Promise<number> {
  const agentIndex = deps.levels.indexOf("agent");
  if (agentIndex < 0) return 0;
  const { rows, opened } = await projectNotes(deps, scanMetadata, active, signal);
  const agentKeys = new Set((active.get(agentIndex) ?? []).flatMap((note) => (note.metadata.key === undefined ? [] : [note.metadata.key])));
  const lifecycle = deps.lifecycle;
  let widened = 0;
  for (const group of crossProjectGroups(rows, {
    duplicateDice: lifecycle?.merge.duplicateDice,
    weights: lifecycle?.storageWeights,
    minProjects: lifecycle?.widen.minProjects,
  })) {
    const key = group.survivor.metadata.key;
    if (key !== undefined && agentKeys.has(key)) continue;
    const content = group.survivor.text;
    if (content === undefined) continue;
    const members = [group.survivor, ...group.others];
    const keywords = mergedKeywords(members, key);
    const written = await deps.remember(
      {
        kind: group.survivor.metadata.kind as "fact" | "procedure",
        content,
        scope: "agent",
        ...(key === undefined ? {} : { key }),
        ...(keywords.length === 0 ? {} : { keywords }),
        ...temporalFields(group.survivor.metadata),
        sourceEntryIds: lineageIds(members),
      },
      { status: "candidate", generatedBy: "promotion" },
    );
    // Never archive a project copy unless the wider note is really at the wider scope and carries the
    // same normalized content. A failed or rewritten write leaves every local note untouched.
    if (written.level !== "agent" || normalizeWidenText(written.content) !== normalizeWidenText(content)) continue;
    for (const note of members.filter((item) => item.text !== undefined && normalizeWidenText(item.text) === normalizeWidenText(content))) {
      const index = deps.memories.findIndex((memory) => memory.scope.resourceId === note.project);
      const lifecycle = index < 0 ? opened.get(note.project) : deps.lifecycles[index];
      if (lifecycle === undefined) continue;
      await lifecycle.archive(note.id, { widenedTo: written.id, auditVerb: "widened" });
    }
    if (key !== undefined) agentKeys.add(key);
    widened += 1;
  }
  return widened;
}

/**
 * Path → project (plan 188.4 Task 6): path notes of one project that agree across sibling subtrees
 * become one project note. The globs were the whole reason the note stayed narrow.
 */
async function widenPaths(deps: MaintenanceDeps, active: ReadonlyMap<number, readonly CapacityNote[]>): Promise<number> {
  let widened = 0;
  for (const [index, notes] of active) {
    if (deps.levels[index] !== "project") continue;
    const projectKeys = new Set(
      notes.flatMap((note) => (note.metadata.key === undefined || note.metadata.scope === "path" ? [] : [note.metadata.key])),
    );
    for (const group of siblingGroups(notes, deps.lifecycle?.widen.minSiblings)) {
      if (projectKeys.has(group.key)) continue;
      const content = group.survivor.text;
      if (content === undefined) continue;
      const members = [group.survivor, ...group.others];
      const keywords = mergedKeywords(members, group.key);
      const written = await deps.remember(
        {
          kind: group.survivor.metadata.kind as "fact" | "procedure",
          content,
          scope: "project",
          key: group.key,
          ...(keywords.length === 0 ? {} : { keywords }),
          ...temporalFields(group.survivor.metadata),
          sourceEntryIds: lineageIds(members),
        },
        { status: "candidate", generatedBy: "promotion" },
      );
      if (written.level !== "project" || normalizeWidenText(written.content) !== normalizeWidenText(content)) continue;
      for (const note of members) await deps.lifecycles[index]!.archive(note.id, { widenedTo: written.id, auditVerb: "widened" });
      projectKeys.add(group.key);
      widened += 1;
    }
  }
  return widened;
}

/**
 * Narrowing (plan 188.4 Task 6): a wider note that `contradictionsToSupersede` projects contradict is
 * superseded, `validTo` set and logged. The project exceptions themselves are untouched: they are
 * the evidence, and they stay valid for their own project.
 */
async function narrowContradicted(
  deps: MaintenanceDeps,
  active: ReadonlyMap<number, readonly CapacityNote[]>,
  now: number,
): Promise<number> {
  let superseded = 0;
  for (const [index, notes] of active) {
    const level = deps.levels[index];
    if (level !== "user" && level !== "agent") continue;
    for (const id of narrowingCandidates(notes, deps.lifecycle?.widen.contradictionsToSupersede)) {
      if (await deps.lifecycles[index]!.supersede(id, { now })) superseded += 1;
    }
  }
  return superseded;
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
  let episodesMerged = 0;
  let evicted = 0;
  const overBudget: MemoryFabricScopeBudget[] = [];
  // What each scope holds after archive and capacity: widening and narrowing read the survivors only.
  const active = new Map<number, readonly CapacityNote[]>();
  for (const { memory, index } of targets) {
    const level: MemoryNoteScope = deps.levels[index] ?? "project";
    const clock = await scopeClock(deps, memory);
    // A concept is never archived, merged or evicted by maintenance: the ontology curator owns it.
    const rows = (await scanActiveRows(scanMetadata, { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId }, signal)).filter(
      (row) => row.metadata.kind !== "concept",
    );
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
        level,
        clock,
        notes: regularNotes,
        limits,
        now,
        ...(signal === undefined ? {} : { signal }),
      });
      merged += result.merged;
      episodesMerged += result.episodesMerged;
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
    active.set(index, [...kept, ...exchanges]);
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

  // Widening compares projects, so it needs the whole pass; a single-scope pass (the consolidation
  // tail) archives and enforces capacity for that scope and stops there.
  let widened = 0;
  let superseded = 0;
  if (options.scope === undefined) {
    widened += await widenToAgent(deps, scanMetadata, active, signal);
    widened += await widenPaths(deps, active);
    superseded += await narrowContradicted(deps, active, now);
  }
  return { archived, merged, episodesMerged, evicted, widened, superseded, overBudget };
}
