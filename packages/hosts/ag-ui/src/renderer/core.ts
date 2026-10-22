/**
 * Task 14: DOM-free A2UI renderer core.
 * Pure state machine: A2UI v0.9 operations -> surface/component model.
 * No DOM, no framework, no host build step. Testable without a browser.
 */
import { type AGUIEvent, EventType } from "@ag-ui/core";
import {
  A2UI_ACTIVITY_TYPE,
  A2UI_OPERATIONS_KEY,
  A2UI_VERSION,
  type ResolvedAgUiA2UiLimits,
  truncateA2UiText,
  validateA2UiOp,
} from "../a2ui.js";
import { DEFAULT_AG_UI_LIMITS, type ResolvedAgUiLimits } from "../limits.js";

export interface A2UiComponentModel {
  readonly id: string;
  readonly type: string;
  /** Flat component properties (A2UI v0.9), minus `id`/`component`. */
  readonly props: Readonly<Record<string, unknown>>;
}

export interface A2UiSurfaceModel {
  readonly surfaceId: string;
  readonly catalogId?: string;
  readonly components: ReadonlyMap<string, A2UiComponentModel>;
  readonly dataModel: unknown;
}

export interface A2UiRenderError {
  readonly code: string;
  readonly message: string;
}

export interface A2UiReduceResult {
  /** Surface ids whose model changed in this batch (in first-touch order). */
  readonly changed: readonly string[];
  /** Present when the whole batch was dropped closed (invalid/oversized). */
  readonly error?: A2UiRenderError;
}

/** Mutable internal state; exposed as `A2UiSurfaceModel`. */
export class A2UiSurfaceState implements A2UiSurfaceModel {
  readonly surfaceId: string;
  readonly catalogId: string | undefined;
  readonly components = new Map<string, A2UiComponentModel>();
  dataModel: unknown;

  constructor(surfaceId: string, catalogId: string | undefined) {
    this.surfaceId = surfaceId;
    this.catalogId = catalogId;
  }
}

/**
 * Apply one A2UI operation batch to the renderer model.
 * Mirrors the server painter's fail-closed rules: a batch with too many ops,
 * an invalid op, or a surface cap breach is dropped whole with a bounded
 * error event; nothing partial is applied.
 *
 * `replace` mirrors ACTIVITY_SNAPSHOT semantics (streaming mode sends
 * cumulative ops under a stable message id; fixed-schema sends one snapshot
 * then deltas): each touched surface is reset before the batch applies.
 */
export function reduceA2UiOps(
  surfaces: Map<string, A2UiSurfaceState>,
  ops: readonly unknown[],
  a2uiLimits: ResolvedAgUiA2UiLimits,
  base: ResolvedAgUiLimits = DEFAULT_AG_UI_LIMITS,
  replace = false,
): A2UiReduceResult {
  if (ops.length === 0) return { changed: [] };
  if (ops.length > a2uiLimits.maxOperationsPerMessage) {
    return { changed: [], error: limitError("ERR_PRISM_A2UI_LIMIT", "Too many A2UI operations", base) };
  }

  const validated: Record<string, unknown>[] = [];
  for (const item of ops) {
    const op = validateA2UiOp(item, a2uiLimits, base);
    if (!op) return { changed: [], error: limitError("ERR_PRISM_A2UI_OP", "Invalid A2UI operation", base) };
    validated.push(op);
  }

  // Surface-cap check first, fail closed like the server painter.
  const toCreate = validated.filter(
    (op) => "createSurface" in op && !surfaces.has(String((op.createSurface as { surfaceId?: unknown }).surfaceId)),
  );
  if (toCreate.length > 0 && surfaces.size + toCreate.length > a2uiLimits.maxSurfacesPerRun) {
    return { changed: [], error: limitError("ERR_PRISM_A2UI_LIMIT", "Too many A2UI surfaces", base) };
  }

  // Structural pre-pass: every op must be applicable before any mutation
  // (fail closed atomically — no partial batch). createSurface ops in this
  // batch count as known surfaces.
  const known = new Set(surfaces.keys());
  for (const op of validated) {
    if ("createSurface" in op) known.add(String((op.createSurface as { surfaceId: string }).surfaceId));
  }
  for (const op of validated) {
    if ("updateComponents" in op) {
      const body = op.updateComponents as { surfaceId: string; components: unknown };
      if (!known.has(body.surfaceId)) {
        return { changed: [], error: limitError("ERR_PRISM_A2UI_OP", "createSurface required before updates", base) };
      }
      if (!validComponents(body.components)) {
        return { changed: [], error: limitError("ERR_PRISM_A2UI_OP", "Invalid A2UI operation", base) };
      }
    }
    if ("updateDataModel" in op) {
      const body = op.updateDataModel as { surfaceId: string; path?: string };
      if (!known.has(body.surfaceId)) {
        return { changed: [], error: limitError("ERR_PRISM_A2UI_OP", "createSurface required before updates", base) };
      }
      const pointer = body.path ?? "/";
      if (pointer.length > 4096 || !pointer.startsWith("/")) {
        return { changed: [], error: limitError("ERR_PRISM_A2UI_OP", "Invalid A2UI operation", base) };
      }
    }
  }

  const changed = new Set<string>();
  const touched = new Set<string>();
  const resetDone = new Set<string>();
  for (const op of validated) {
    if ("createSurface" in op) {
      const body = op.createSurface as { surfaceId: string; catalogId?: string };
      if (surfaces.has(body.surfaceId)) continue; // streaming snapshots re-send createSurface
      surfaces.set(body.surfaceId, new A2UiSurfaceState(body.surfaceId, body.catalogId));
      touched.add(body.surfaceId);
      continue;
    }
    if ("updateComponents" in op) {
      const body = op.updateComponents as { surfaceId: string; components: unknown };
      const state = surfaces.get(body.surfaceId)!;
      if (replace && !resetDone.has(body.surfaceId)) {
        resetSurface(state);
        resetDone.add(body.surfaceId);
      }
      touched.add(body.surfaceId);
      applyComponents(state, body.components);
      continue;
    }
    if ("updateDataModel" in op) {
      const body = op.updateDataModel as { surfaceId: string; path?: string; value?: unknown };
      const state = surfaces.get(body.surfaceId)!;
      if (replace && !resetDone.has(body.surfaceId)) {
        resetSurface(state);
        resetDone.add(body.surfaceId);
      }
      touched.add(body.surfaceId);
      state.dataModel = setAtPointer(state.dataModel, body.path ?? "/", body.value);
      continue;
    }
    if ("deleteSurface" in op) {
      const body = op.deleteSurface as { surfaceId: string };
      if (surfaces.delete(body.surfaceId)) touched.add(body.surfaceId); // safe no-op when absent
    }
  }

  for (const id of touched) if (surfaces.has(id)) changed.add(id);
  return { changed: [...changed] };
}

/**
 * Extract the A2UI operation batch from one AG-UI activity event.
 * Snapshot -> `a2ui_operations` (replace); delta -> RFC 6902 adds to
 * `/a2ui_operations/-` (append). Returns undefined for unrelated events.
 */
export function readA2UiBatch(event: AGUIEvent): { ops: unknown[]; replace: boolean } | undefined {
  if (event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === A2UI_ACTIVITY_TYPE) {
    const content = event.content as Record<string, unknown> | undefined;
    const ops = content?.[A2UI_OPERATIONS_KEY];
    return Array.isArray(ops) ? { ops, replace: true } : undefined;
  }
  if (event.type === EventType.ACTIVITY_DELTA && event.activityType === A2UI_ACTIVITY_TYPE && Array.isArray(event.patch)) {
    const ops: unknown[] = [];
    for (const entry of event.patch) {
      if (
        entry &&
        typeof entry === "object" &&
        (entry as { op?: unknown }).op === "add" &&
        (entry as { path?: unknown }).path === `/${A2UI_OPERATIONS_KEY}/-` &&
        Object.hasOwn(entry as object, "value")
      ) {
        ops.push((entry as { value: unknown }).value);
      }
    }
    return ops.length > 0 ? { ops, replace: false } : undefined;
  }
  return undefined;
}

/** Resolve a JSON Pointer against a value (used for `{"path": "/..."}` bindings). */
export function resolvePointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  let current = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = /^(0|[1-9][0-9]*)$/.test(token) ? Number(token) : -1;
      if (index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (typeof current === "object" && Object.hasOwn(current as object, token)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

function setAtPointer(root: unknown, pointer: string, value: unknown): unknown {
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (tokens.length === 1 && tokens[0] === "") return value; // "/" replaces the whole model
  if (root === null || root === undefined || typeof root !== "object" || Array.isArray(root)) root = {};
  let current: unknown = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i]!;
    const record = current as Record<string, unknown>;
    if (typeof record[token] !== "object" || record[token] === null) record[token] = {};
    current = record[token];
  }
  const last = tokens[tokens.length - 1]!;
  const record = current as Record<string, unknown>;
  if (value === undefined) delete record[last];
  else record[last] = value;
  return root;
}

function validComponents(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const comp = item as Record<string, unknown>;
    if (typeof comp.id !== "string" || comp.id.length === 0 || comp.id.length > 128) return false;
    if (typeof comp.component !== "string" || comp.component.length === 0 || comp.component.length > 256) return false;
  }
  return true;
}

function applyComponents(state: A2UiSurfaceState, raw: unknown): void {
  for (const item of raw as Record<string, unknown>[]) {
    const comp = item;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(comp)) {
      if (key === "id" || key === "component") continue;
      props[key] = value;
    }
    state.components.set(String(comp.id), { id: String(comp.id), type: String(comp.component), props });
  }
}

function resetSurface(state: A2UiSurfaceState): void {
  state.components.clear();
  state.dataModel = undefined;
}

function limitError(code: string, message: string, base: ResolvedAgUiLimits): A2UiRenderError {
  return {
    code: truncateA2UiText(code, 128),
    message: truncateA2UiText(message, Math.min(base.maxErrorBytes, 2_048)),
  };
}

export { A2UI_VERSION };
