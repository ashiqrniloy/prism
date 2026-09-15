import { redactSecrets, type SessionEntry } from "@arnilo/prism";
import { appendCustomEntry, type CustomEntryAppendOptions } from "./append-custom.js";
import { foldObservationalMemoryLedger } from "./ledger.js";
import { isMemoryId } from "./types.js";

export const SESSION_WORK_SCOPE_ID = "session";
export const WORK_SCOPE_OPENED = "om.scope.opened";
export const WORK_SCOPE_CLOSED = "om.scope.closed";
export const WORK_SCOPE_ENTERED = "om.scope.entered";
export const WORK_SCOPE_LEFT = "om.scope.left";
export const WORK_SCOPE_BOUND = "om.scope.bound";
export const WORK_SCOPE_UNBOUND = "om.scope.unbound";

export const MAX_WORK_SCOPES = 256;
export const MAX_WORK_SCOPE_DEPTH = 8;
export const MAX_WORK_SCOPE_STACK = 8;
export const MAX_WORK_SCOPE_BINDS = 4096;
export const MAX_WORK_SCOPE_LABEL_CHARS = 512;

export type WorkScopeId = string;
export type WorkBindRef = `om:${string}` | `reflection:${string}`;

export interface WorkScopeSpec {
  readonly id: WorkScopeId;
  readonly parentId?: WorkScopeId;
  readonly kind?: string;
  readonly label?: string;
}

export interface WorkScope extends WorkScopeSpec {
  readonly status: "open" | "closed";
}

export interface WorkScopeOpenedData extends WorkScopeSpec {
  readonly type: typeof WORK_SCOPE_OPENED;
}

export interface WorkScopeClosedData {
  readonly type: typeof WORK_SCOPE_CLOSED;
  readonly scopeId: WorkScopeId;
}

export interface WorkScopeEnteredData {
  readonly type: typeof WORK_SCOPE_ENTERED;
  readonly scopeId: WorkScopeId;
}

export interface WorkScopeLeftData {
  readonly type: typeof WORK_SCOPE_LEFT;
}

export interface WorkScopeBoundData {
  readonly type: typeof WORK_SCOPE_BOUND;
  readonly scopeId: WorkScopeId;
  readonly refs: readonly WorkBindRef[];
}

export interface WorkScopeUnboundData {
  readonly type: typeof WORK_SCOPE_UNBOUND;
  readonly scopeId: WorkScopeId;
  readonly refs: readonly WorkBindRef[];
}

export type WorkScopeEntryData =
  | WorkScopeOpenedData
  | WorkScopeClosedData
  | WorkScopeEnteredData
  | WorkScopeLeftData
  | WorkScopeBoundData
  | WorkScopeUnboundData;

export interface WorkScopeMap {
  readonly scopes: ReadonlyMap<WorkScopeId, WorkScope>;
  readonly binds: ReadonlyMap<WorkScopeId, readonly WorkBindRef[]>;
  readonly stack: readonly WorkScopeId[];
}

export interface WorkScopeControllerOptions extends CustomEntryAppendOptions {
  readonly secrets?: readonly (string | undefined)[];
}

export interface WorkScopeController {
  readonly open: (scope: WorkScopeSpec) => Promise<void>;
  readonly close: (scopeId: WorkScopeId) => Promise<void>;
  readonly enter: (scopeId: WorkScopeId) => Promise<void>;
  readonly leave: () => Promise<void>;
  readonly bind: (scopeId: WorkScopeId, refs: readonly WorkBindRef[]) => Promise<void>;
  readonly unbind: (scopeId: WorkScopeId, refs: readonly WorkBindRef[]) => Promise<void>;
  readonly has: (scopeId: WorkScopeId) => Promise<boolean>;
  readonly leaf: () => Promise<WorkScopeId>;
}

export function isWorkScopeId(value: unknown): value is WorkScopeId {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) && !value.includes("..");
}

export function isWorkBindRef(value: unknown): value is WorkBindRef {
  if (typeof value !== "string") return false;
  if (value.startsWith("om:")) return isMemoryId(value.slice(3));
  if (value.startsWith("reflection:")) return isMemoryId(value.slice("reflection:".length));
  return false;
}

export function isWorkScopeOpenedData(value: unknown): value is WorkScopeOpenedData {
  return isRecord(value) && value.type === WORK_SCOPE_OPENED && isWorkScopeSpec(value);
}

export function isWorkScopeClosedData(value: unknown): value is WorkScopeClosedData {
  return isRecord(value) && value.type === WORK_SCOPE_CLOSED && isWorkScopeId(value.scopeId);
}

export function isWorkScopeEnteredData(value: unknown): value is WorkScopeEnteredData {
  return isRecord(value) && value.type === WORK_SCOPE_ENTERED && isWorkScopeId(value.scopeId);
}

export function isWorkScopeLeftData(value: unknown): value is WorkScopeLeftData {
  return isRecord(value) && value.type === WORK_SCOPE_LEFT;
}

export function isWorkScopeBoundData(value: unknown): value is WorkScopeBoundData {
  return isWorkScopeRefsData(value, WORK_SCOPE_BOUND);
}

export function isWorkScopeUnboundData(value: unknown): value is WorkScopeUnboundData {
  return isWorkScopeRefsData(value, WORK_SCOPE_UNBOUND);
}

export function foldWorkScopeMap(entries: readonly SessionEntry[]): WorkScopeMap {
  const scopes = new Map<WorkScopeId, WorkScope>([[SESSION_WORK_SCOPE_ID, { id: SESSION_WORK_SCOPE_ID, status: "open" }]]);
  const binds = new Map<WorkScopeId, Set<WorkBindRef>>();
  const stack: WorkScopeId[] = [SESSION_WORK_SCOPE_ID];

  for (const entry of entries) {
    const data = entry.data;
    if (isWorkScopeOpenedData(data)) {
      const parentId = workScopeParentId(data);
      const parent = scopes.get(parentId);
      const parentLineage = workScopeLineage(scopes, parentId);
      if (
        data.id === SESSION_WORK_SCOPE_ID ||
        scopes.has(data.id) ||
        scopes.size - 1 >= MAX_WORK_SCOPES ||
        parent?.status !== "open" ||
        !parentLineage ||
        parentLineage.length - 1 >= MAX_WORK_SCOPE_DEPTH
      )
        continue;
      scopes.set(data.id, openScope(data));
      continue;
    }
    if (isWorkScopeClosedData(data)) {
      const scope = scopes.get(data.scopeId);
      if (!scope || scope.id === SESSION_WORK_SCOPE_ID || scope.status === "closed") continue;
      scopes.set(scope.id, { ...scope, status: "closed" });
      const index = stack.indexOf(scope.id);
      if (index >= 0) stack.splice(index);
      continue;
    }
    if (isWorkScopeEnteredData(data)) {
      const lineage = workScopeLineage(scopes, data.scopeId);
      if (!lineage || lineage.length - 1 > MAX_WORK_SCOPE_STACK || lineage.some((id) => scopes.get(id)?.status !== "open")) continue;
      stack.splice(0, stack.length, ...lineage);
      continue;
    }
    if (isWorkScopeLeftData(data)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (isWorkScopeBoundData(data)) {
      if (!scopes.has(data.scopeId)) continue;
      const next = new Set(binds.get(data.scopeId) ?? []);
      for (const ref of data.refs) next.add(ref);
      if (next.size > MAX_WORK_SCOPE_BINDS) continue;
      binds.set(data.scopeId, next);
      continue;
    }
    if (isWorkScopeUnboundData(data)) {
      const current = binds.get(data.scopeId);
      if (!current) continue;
      for (const ref of data.refs) current.delete(ref);
      if (current.size === 0) binds.delete(data.scopeId);
    }
  }

  return {
    scopes,
    binds: new Map([...binds].map(([scopeId, refs]) => [scopeId, [...refs]])),
    stack,
  };
}

export function createWorkScopeController(options: WorkScopeControllerOptions): WorkScopeController {
  const map = async () => foldWorkScopeMap(await options.session.entries());
  const append = (data: WorkScopeEntryData) => appendCustomEntry(options, data);

  return {
    async open(input) {
      const scope = redactScope(input, options.secrets ?? []);
      if (scope.id === SESSION_WORK_SCOPE_ID) throw new Error("Work scope session is reserved");
      const current = await map();
      if (current.scopes.has(scope.id)) throw new Error(`Work scope ${scope.id} already exists`);
      if (current.scopes.size - 1 >= MAX_WORK_SCOPES) throw new RangeError(`Work scope limit is ${MAX_WORK_SCOPES}`);
      const parentId = workScopeParentId(scope);
      const parent = current.scopes.get(parentId);
      const parentLineage = workScopeLineage(current.scopes, parentId);
      if (parent?.status !== "open" || !parentLineage) throw new Error(`Work scope parent ${parentId} must be open`);
      if (parentLineage.length - 1 >= MAX_WORK_SCOPE_DEPTH) throw new RangeError(`Work scope depth limit is ${MAX_WORK_SCOPE_DEPTH}`);
      await append({ type: WORK_SCOPE_OPENED, ...scope });
    },

    async close(scopeId) {
      const id = assertWorkScopeId(scopeId, "scope id");
      if (id === SESSION_WORK_SCOPE_ID) throw new Error("Work scope session is reserved");
      const scope = (await map()).scopes.get(id);
      if (!scope || scope.status === "closed") throw new Error(`Work scope ${id} is not open`);
      await append({ type: WORK_SCOPE_CLOSED, scopeId: id });
    },

    async enter(scopeId) {
      const id = assertWorkScopeId(scopeId, "scope id");
      const current = await map();
      const lineage = workScopeLineage(current.scopes, id);
      if (!lineage || lineage.some((item) => current.scopes.get(item)?.status !== "open")) throw new Error(`Work scope ${id} must be open`);
      if (lineage.length - 1 > MAX_WORK_SCOPE_STACK) throw new RangeError(`Work scope stack limit is ${MAX_WORK_SCOPE_STACK}`);
      await append({ type: WORK_SCOPE_ENTERED, scopeId: id });
    },

    async leave() {
      if ((await map()).stack.at(-1) === SESSION_WORK_SCOPE_ID) return;
      await append({ type: WORK_SCOPE_LEFT });
    },

    async bind(scopeId, refs) {
      const id = assertWorkScopeId(scopeId, "scope id");
      const uniqueRefs = assertWorkBindRefs(refs);
      const entries = await options.session.entries();
      const current = foldWorkScopeMap(entries);
      if (!current.scopes.has(id)) throw new Error(`Unknown work scope ${id}`);
      assertKnownWorkBindRefs(uniqueRefs, entries);
      const existing = new Set(current.binds.get(id) ?? []);
      const fresh = uniqueRefs.filter((ref) => !existing.has(ref));
      if (existing.size + fresh.length > MAX_WORK_SCOPE_BINDS) throw new RangeError(`Work scope bind limit is ${MAX_WORK_SCOPE_BINDS}`);
      if (fresh.length) await append({ type: WORK_SCOPE_BOUND, scopeId: id, refs: fresh });
    },

    async unbind(scopeId, refs) {
      const id = assertWorkScopeId(scopeId, "scope id");
      const uniqueRefs = assertWorkBindRefs(refs);
      const entries = await options.session.entries();
      const current = foldWorkScopeMap(entries);
      if (!current.scopes.has(id)) throw new Error(`Unknown work scope ${id}`);
      assertKnownWorkBindRefs(uniqueRefs, entries);
      const bound = new Set(current.binds.get(id) ?? []);
      const removed = uniqueRefs.filter((ref) => bound.has(ref));
      if (removed.length) await append({ type: WORK_SCOPE_UNBOUND, scopeId: id, refs: removed });
    },

    async has(scopeId) {
      return (await map()).scopes.has(assertWorkScopeId(scopeId, "scope id"));
    },

    async leaf() {
      return (await map()).stack.at(-1) ?? SESSION_WORK_SCOPE_ID;
    },
  };
}

export async function withWorkScope<T>(
  controller: WorkScopeController,
  scope: WorkScopeSpec,
  fn: () => T | Promise<T>,
): Promise<Awaited<T>> {
  if (!(await controller.has(scope.id))) await controller.open(scope);
  await controller.enter(scope.id);
  try {
    return await fn();
  } finally {
    await controller.leave();
  }
}

function isWorkScopeSpec(value: unknown): value is WorkScopeSpec {
  return (
    isRecord(value) &&
    isWorkScopeId(value.id) &&
    (value.parentId === undefined || isWorkScopeId(value.parentId)) &&
    isScopeText(value.kind) &&
    isScopeText(value.label)
  );
}

function isWorkScopeRefsData<T extends typeof WORK_SCOPE_BOUND | typeof WORK_SCOPE_UNBOUND>(
  value: unknown,
  type: T,
): value is T extends typeof WORK_SCOPE_BOUND ? WorkScopeBoundData : WorkScopeUnboundData {
  return (
    isRecord(value) && value.type === type && isWorkScopeId(value.scopeId) && Array.isArray(value.refs) && value.refs.every(isWorkBindRef)
  );
}

function isScopeText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= MAX_WORK_SCOPE_LABEL_CHARS);
}

function workScopeParentId(scope: Pick<WorkScopeSpec, "parentId">): WorkScopeId {
  return scope.parentId ?? SESSION_WORK_SCOPE_ID;
}

function openScope(scope: WorkScopeSpec): WorkScope {
  return {
    id: scope.id,
    ...(scope.parentId === undefined ? {} : { parentId: scope.parentId }),
    ...(scope.kind === undefined ? {} : { kind: scope.kind }),
    ...(scope.label === undefined ? {} : { label: scope.label }),
    status: "open",
  };
}

export function workScopeLineage(scopes: ReadonlyMap<WorkScopeId, WorkScope>, scopeId: WorkScopeId): WorkScopeId[] | undefined {
  const lineage: WorkScopeId[] = [];
  let currentId: WorkScopeId | undefined = scopeId;
  while (currentId !== undefined && lineage.length <= MAX_WORK_SCOPE_DEPTH) {
    const current = scopes.get(currentId);
    if (!current || lineage.includes(currentId)) return undefined;
    lineage.push(currentId);
    if (currentId === SESSION_WORK_SCOPE_ID) return lineage.reverse();
    currentId = workScopeParentId(current);
  }
  return undefined;
}

function redactScope(input: unknown, secrets: readonly (string | undefined)[]): WorkScopeSpec {
  if (!isRecord(input)) throw new TypeError("Work scope must be an object");
  const id = assertWorkScopeId(input.id, "scope id");
  const parentId = input.parentId === undefined ? undefined : assertWorkScopeId(input.parentId, "parent id");
  const kind = redactScopeText(input.kind, "kind", secrets);
  const label = redactScopeText(input.label, "label", secrets);
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    ...(kind === undefined ? {} : { kind }),
    ...(label === undefined ? {} : { label }),
  };
}

function redactScopeText(value: unknown, name: string, secrets: readonly (string | undefined)[]): string | undefined {
  if (value === undefined) return undefined;
  if (!isScopeText(value)) throw new RangeError(`Work scope ${name} must be a string at most ${MAX_WORK_SCOPE_LABEL_CHARS} characters`);
  const redacted = redactSecrets(value, secrets);
  if (redacted.length > MAX_WORK_SCOPE_LABEL_CHARS)
    throw new RangeError(`Work scope ${name} exceeds ${MAX_WORK_SCOPE_LABEL_CHARS} characters after redaction`);
  return redacted;
}

function assertWorkScopeId(value: unknown, name: string): WorkScopeId {
  if (!isWorkScopeId(value)) throw new TypeError(`Invalid work scope ${name}`);
  return value;
}

function assertWorkBindRefs(refs: unknown): readonly WorkBindRef[] {
  if (!Array.isArray(refs) || refs.length === 0 || !refs.every(isWorkBindRef))
    throw new TypeError("Work scope refs must be non-empty OM references");
  return [...new Set(refs)];
}

function assertKnownWorkBindRefs(refs: readonly WorkBindRef[], entries: readonly SessionEntry[]): void {
  const ledger = foldObservationalMemoryLedger(entries);
  const known = new Set<WorkBindRef>([
    ...ledger.observations.map((observation) => `om:${observation.id}` as WorkBindRef),
    ...ledger.reflections.map((reflection) => `reflection:${reflection.id}` as WorkBindRef),
  ]);
  if (refs.some((ref) => !known.has(ref))) throw new Error("Work scope refs must name existing observational memory ids");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
