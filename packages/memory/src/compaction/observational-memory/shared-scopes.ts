import type { SessionEntry } from "@arnilo/prism";
import { foldObservationalMemoryLedger } from "./ledger.js";
import {
  foldWorkScopeGrants,
  foldWorkScopeMap,
  isWorkPrincipalId,
  isWorkScopeId,
  type WorkBindRef,
  type WorkScopeId,
  type WorkScopeMap,
} from "./scopes.js";
import type { GetMemoryEntries } from "./tool.js";
import type { MemoryObservation, MemoryReflection } from "./types.js";

/**
 * Shared work scopes: one scope id, an owner branch that carries the append-only grants, and a
 * host-supplied entries callback for cross-session reads. Each participant opens the scope in its
 * own branch and binds its own ids to it; reads fold every granted branch separately and union the
 * id-keyed results (never the raw entry lists — coverage cursors and projection boundaries are
 * positional per branch). The host callback is the tenant/store boundary: the package checks grants,
 * it cannot verify another branch's tenant.
 */
export interface SharedWorkScopeConfigEntry {
  readonly ownerSessionId: string;
  readonly entries: GetMemoryEntries;
}

export type SharedWorkScopeConfig = Readonly<Record<string, SharedWorkScopeConfigEntry>>;

export type SharedScopeAccessReason = "invalid_config" | "unavailable" | "unknown_scope" | "not_opened" | "not_granted";

export interface SharedScopeAccessEvent {
  readonly scopeId: string;
  readonly ownerSessionId: string;
  readonly principalId: string;
  readonly granted: boolean;
  readonly branches: number;
  readonly observations: number;
  readonly reflections: number;
  readonly reason?: SharedScopeAccessReason;
}

/** Scope-bound memory from every readable branch, plus the refs to project it with. */
export interface SharedScopeMemory {
  readonly scopeId: WorkScopeId;
  readonly ownerSessionId: string;
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  readonly refs: readonly WorkBindRef[];
  readonly branches: readonly string[];
  /** Foreign branch entries, for recall source-evidence resolution only. */
  readonly entries: readonly SessionEntry[];
}

export interface ResolveSharedScopesOptions {
  readonly scopes: SharedWorkScopeConfig | undefined;
  readonly principalId: string;
  /** Local (reader) scope map — the scope must be open locally before any branch is read. */
  readonly map: WorkScopeMap;
  readonly onAccess?: (event: SharedScopeAccessEvent) => void;
}

export interface MergedSharedScopes {
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  readonly binds: ReadonlyMap<WorkScopeId, readonly WorkBindRef[]>;
  readonly entries: readonly SessionEntry[];
}

export async function resolveSharedScopes(options: ResolveSharedScopesOptions): Promise<readonly SharedScopeMemory[]> {
  const configured = options.scopes ?? {};
  const resolved: SharedScopeMemory[] = [];
  for (const [scopeId, config] of Object.entries(configured)) {
    const audit = (
      granted: boolean,
      reason?: SharedScopeAccessReason,
      counts?: { branches: number; observations: number; reflections: number },
    ) => {
      options.onAccess?.({
        scopeId,
        ownerSessionId: config?.ownerSessionId ?? "",
        principalId: options.principalId,
        granted,
        branches: counts?.branches ?? 0,
        observations: counts?.observations ?? 0,
        reflections: counts?.reflections ?? 0,
        ...(reason === undefined ? {} : { reason }),
      });
    };
    if (!isWorkScopeId(scopeId) || !isWorkPrincipalId(config?.ownerSessionId) || typeof config?.entries !== "function") {
      audit(false, "invalid_config");
      continue;
    }
    if (!options.map.scopes.has(scopeId)) {
      audit(false, "not_opened");
      continue;
    }
    const ownerEntries = await readEntries(config.entries, config.ownerSessionId);
    if (!ownerEntries) {
      audit(false, "unavailable");
      continue;
    }
    if (!foldWorkScopeMap(ownerEntries).scopes.has(scopeId)) {
      audit(false, "unknown_scope");
      continue;
    }
    const granted = foldWorkScopeGrants(ownerEntries).get(scopeId);
    if (!granted?.has(options.principalId)) {
      audit(false, "not_granted");
      continue;
    }

    const observations = new Map<string, MemoryObservation>();
    const reflections = new Map<string, MemoryReflection>();
    const dropped = new Set<string>();
    const refs = new Set<WorkBindRef>(options.map.binds.get(scopeId) ?? []);
    const entries: SessionEntry[] = [];
    const branches: string[] = [];
    // The owner branch always contributes; grants gate every other principal.
    const branchIds = [...new Set([config.ownerSessionId, ...granted])].filter((id) => id !== options.principalId).sort();
    for (const principalId of branchIds) {
      const branchEntries = principalId === config.ownerSessionId ? ownerEntries : await readEntries(config.entries, principalId);
      if (!branchEntries) continue;
      const branchRefs = new Set(foldWorkScopeMap(branchEntries).binds.get(scopeId) ?? []);
      if (!branchRefs.size) continue;
      const ledger = foldObservationalMemoryLedger(branchEntries);
      for (const observation of ledger.observations)
        if (branchRefs.has(`om:${observation.id}`) && !observations.has(observation.id)) observations.set(observation.id, observation);
      for (const reflection of ledger.reflections)
        if (branchRefs.has(`reflection:${reflection.id}`) && !reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
      for (const id of ledger.droppedObservationIds) dropped.add(id);
      for (const ref of branchRefs) refs.add(ref);
      entries.push(...branchEntries);
      branches.push(principalId);
    }

    audit(true, undefined, { branches: branches.length, observations: observations.size, reflections: reflections.size });
    resolved.push({
      scopeId,
      ownerSessionId: config.ownerSessionId,
      observations: [...observations.values()],
      reflections: [...reflections.values()],
      droppedObservationIds: [...dropped],
      refs: [...refs],
      branches,
      entries,
    });
  }
  return resolved;
}

/** Flatten resolved scopes for render/recall consumers: id-keyed dedupe across scopes, refs by scope. */
export function mergeSharedScopes(shared: readonly SharedScopeMemory[]): MergedSharedScopes {
  const observations = new Map<string, MemoryObservation>();
  const reflections = new Map<string, MemoryReflection>();
  const dropped = new Set<string>();
  const binds = new Map<WorkScopeId, WorkBindRef[]>();
  const entries = new Map<string, SessionEntry>();
  for (const scope of shared) {
    for (const observation of scope.observations) if (!observations.has(observation.id)) observations.set(observation.id, observation);
    for (const reflection of scope.reflections) if (!reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
    for (const id of scope.droppedObservationIds) dropped.add(id);
    const refs = binds.get(scope.scopeId) ?? [];
    refs.push(...scope.refs);
    binds.set(scope.scopeId, refs);
    for (const entry of scope.entries) if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }
  return {
    observations: [...observations.values()],
    reflections: [...reflections.values()],
    droppedObservationIds: [...dropped],
    binds: new Map([...binds].map(([scopeId, refs]) => [scopeId, [...new Set(refs)]])),
    entries: [...entries.values()],
  };
}

async function readEntries(getEntries: GetMemoryEntries, sessionId: string): Promise<readonly SessionEntry[] | undefined> {
  try {
    const entries = await getEntries(sessionId);
    return Array.isArray(entries) ? entries : undefined;
  } catch {
    return undefined;
  }
}
