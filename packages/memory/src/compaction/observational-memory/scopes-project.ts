import { activeObservations, reflectionBlockedByInvalidation, type ObservationalMemoryLedger } from "./ledger.js";
import { isWorkBindRef, SESSION_WORK_SCOPE_ID, workScopeLineage, type WorkScope, type WorkScopeId, type WorkScopeMap } from "./scopes.js";
import type { MemoryObservation, MemoryReflection } from "./types.js";

export type WorkScopeInclude = "self" | "self+ancestors" | "self+descendants" | "lineage";
export type WorkScopeClosed = "hide" | "include";

export interface ProjectWorkMemoryOptions {
  readonly from: WorkScopeId;
  readonly include: WorkScopeInclude;
  readonly closed?: WorkScopeClosed;
  readonly kinds?: readonly string[];
}

export interface WorkScopeOutline {
  readonly id: WorkScopeId;
  readonly label?: string;
}

export interface WorkMemoryProjection {
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly outline: readonly WorkScopeOutline[];
}

export function projectWorkMemory(
  ledger: ObservationalMemoryLedger,
  map: WorkScopeMap,
  options: ProjectWorkMemoryOptions,
): WorkMemoryProjection {
  const dropped = new Set(ledger.droppedObservationIds);
  const observations = activeObservations(ledger);
  const reflections = ledger.reflections.filter((reflection) => !reflectionBlockedByInvalidation(reflection, dropped));
  if (map.scopes.size === 1 && map.scopes.has(SESSION_WORK_SCOPE_ID)) return { observations, reflections, outline: [] };

  const lineage = workScopeLineage(map.scopes, options.from);
  if (!lineage) return { observations: [], reflections: [], outline: [] };
  const scopeIds = selectedScopeIds(map, options.from, options.include, lineage);
  if (!scopeIds) return { observations: [], reflections: [], outline: [] };

  const closed = options.closed ?? "hide";
  const ancestors = new Set(lineage.slice(0, -1));
  const kinds = new Set((options.kinds ?? []).filter((kind): kind is string => typeof kind === "string"));
  const scopes = scopeIds
    .map((id) => map.scopes.get(id))
    .filter((scope): scope is WorkScope => Boolean(scope))
    .filter(
      (scope) =>
        (closed === "include" || scope.status !== "closed" || ancestors.has(scope.id)) && (!kinds.size || kinds.has(scope.kind ?? "")),
    );
  const refs = new Set(scopes.flatMap((scope) => (map.binds.get(scope.id) ?? []).filter(isWorkBindRef)));
  return {
    observations: observations.filter((observation) => refs.has(`om:${observation.id}`)),
    reflections: reflections.filter((reflection) => refs.has(`reflection:${reflection.id}`)),
    outline: scopes.map((scope) => ({ id: scope.id, ...(scope.label === undefined ? {} : { label: scope.label }) })),
  };
}

function selectedScopeIds(
  map: WorkScopeMap,
  from: WorkScopeId,
  include: WorkScopeInclude,
  lineage: readonly WorkScopeId[],
): readonly WorkScopeId[] | undefined {
  if (include === "self") return [from];
  if (include === "self+ancestors") return lineage;
  const descendants = [...map.scopes.keys()].filter((id) => workScopeLineage(map.scopes, id)?.includes(from));
  if (include === "self+descendants") return descendants;
  if (include === "lineage") return [...new Set([...lineage, ...descendants])];
  return undefined;
}
