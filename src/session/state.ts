/**
 * Package state (roadmap §2.6). Session state is a value per `(package, key)` kept in `package_state`
 * entries on the session's branch: restored when a session reads its branch, and copied by `fork()` and
 * `clone()` because they carry the branch. Agent state is process memory.
 */
import type { SessionEntry } from "../contracts-core/session.js";
import type { JsonValue } from "../contracts.js";
import { PackageLoadError } from "../packages/errors.js";
import { toJsonValue } from "../packages/schema.js";
import type { SessionContext } from "../session-context.js";

/** Largest JSON value one `set` may persist. Every `set` is a store entry, so it is bounded. */
export const MAX_STATE_VALUE_BYTES = 64 * 1024;
/** Most entries one `(package, key)` session log may hold on a branch. */
export const MAX_STATE_LOG_ENTRIES = 10_000;
const MAX_STATE_KEY_LENGTH = 128;

/** A session-scoped value a package owns. `get` is synchronous; `set` appends one `package_state` entry. */
export interface SessionState<T extends JsonValue> {
  /**
   * The latest value on this session's branch, or `initial`. The value is frozen: replace it with `set`.
   * Throws `state_not_ready` before the session has read its branch (a run, command, or `close()` does).
   */
  get(session: SessionContext): T;
  /** Persists `value` (JSON, at most 64 KiB, redacted first) and makes it the value `get` returns. */
  set(session: SessionContext, value: T): Promise<void>;
}

/**
 * A session-scoped append-only record log a package owns. Unlike {@link SessionState}, later records
 * never replace earlier ones: the branch is the order. `entries` is synchronous, because the session
 * already holds the branch it read.
 */
export interface SessionLog<T extends JsonValue> {
  /**
   * Every record on this session's branch since the latest rotation, in append order. Throws `state_not_ready`
   * before the session has read its branch (a run, command, or `close()` does). A fork carries the records
   * up to the fork point.
   */
  entries(session: SessionContext): readonly T[];
  /** Appends `value` (JSON, at most 64 KiB, redacted first) as one `package_state` entry. */
  append(session: SessionContext, value: T): Promise<void>;
  /** Replaces the log with `values` (default empty), dropping earlier records from compaction checkpoints. */
  replace?(session: SessionContext, values?: readonly T[]): Promise<void>;
}

/** A value kept in process memory for the agent's lifetime, reset to `initial` on dispose. */
export interface AgentState<T> {
  get(): T;
  set(value: T): void;
}

/** The `data` of a `package_state` entry. `op` is absent only on entries written before 0.13, which read as `"set"`. */
export interface PackageStateData {
  readonly schemaVersion: 1;
  readonly package: string;
  readonly key: string;
  readonly value: JsonValue;
  /** `"append"` records join the key's log; `"replace"` resets it to the array in `value`. */
  readonly op?: "set" | "append" | "replace";
}

const NO_RECORDS: readonly JsonValue[] = Object.freeze([]);

/**
 * The `package_state` data a hydrate needs from `branch` (and optional prior checkpoint `base`), in fold order
 * (plan 230 Task 3): each key's latest `set`, then each key's active `append` / `replace` records. A `"replace"`
 * entry drops earlier log records for that key so compaction checkpoints stay bounded across rotations.
 */
export function foldPackageState(branch: readonly SessionEntry[], base: readonly PackageStateData[] = []): PackageStateData[] {
  const sets = new Map<string, PackageStateData>();
  const appends = new Map<string, PackageStateData[]>();
  const fold = (data: PackageStateData) => {
    const key = slot(data.package, data.key);
    if (data.op === "append") {
      const list = appends.get(key) ?? [];
      list.push(data);
      appends.set(key, list);
    } else if (data.op === "replace") {
      appends.set(key, [data]);
    } else {
      sets.set(key, data);
    }
  };
  for (const data of base) if (isStateData(data)) fold(data);
  for (const entry of branch) {
    if (entry.kind !== "package_state" || !isStateData(entry.data)) continue;
    fold(entry.data);
  }
  return [...sets.values(), ...[...appends.values()].flat()];
}

const slot = (owner: string, key: string): string => `${owner}\u0000${key}`;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function isStateData(value: unknown): value is PackageStateData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return data.schemaVersion === 1 && typeof data.package === "string" && typeof data.key === "string" && "value" in data;
}

export interface SessionStateStoreOptions {
  /** Appends one `package_state` entry at the branch tip. */
  readonly append: (data: PackageStateData) => Promise<void>;
  /** Reads the branch once, if it has not been read. A `set` waits for it. */
  readonly ready: () => Promise<void>;
  /** The agent's redactor and every resolved secret, applied before a value is persisted. */
  readonly redact: <T>(value: T) => T;
  /** Largest stored value in bytes: the agent's `ceilings.stateValueBytes`. Default {@link MAX_STATE_VALUE_BYTES}. */
  readonly maxValueBytes?: () => number;
  /** Most entries one `state.log(key)` holds per branch: the agent's `ceilings.stateLogEntries`. Default {@link MAX_STATE_LOG_ENTRIES}. */
  readonly maxLogEntries?: () => number;
}

/** The state one session holds. The session owns it and binds it to every {@link SessionContext} it hands out. */
export class SessionStateStore {
  private values = new Map<string, JsonValue>();
  private records = new Map<string, JsonValue[]>();
  /** The newest in-flight or persisted `write` of each key. */
  private latest = new Map<string, JsonValue>();
  private hydrated = false;

  constructor(private readonly options: SessionStateStoreOptions) {}

  get isReady(): boolean {
    return this.hydrated;
  }

  /**
   * Replaces the held state with the branch: the latest value per `(package, key)` for `set` records,
   * and every `append` record in branch order. A malformed entry is skipped.
   */
  hydrate(branch: readonly SessionEntry[], base: readonly PackageStateData[] = []): void {
    const next = new Map<string, JsonValue>();
    const records = new Map<string, JsonValue[]>();
    const fold = (data: unknown) => {
      if (!isStateData(data)) return;
      const key = slot(data.package, data.key);
      const frozen = deepFreeze(data.value);
      if (data.op === "append") {
        const list = records.get(key) ?? [];
        list.push(frozen);
        records.set(key, list);
        return;
      }
      if (data.op === "replace") {
        records.set(key, Array.isArray(frozen) ? [...frozen] : []);
        return;
      }
      next.set(key, frozen);
    };
    // `base` is a compaction checkpoint's fold of the branch before it (plan 230 Task 3); `branch` follows it.
    for (const data of base) fold(data);
    for (const entry of branch) if (entry.kind === "package_state") fold(entry.data);
    this.values = next;
    this.records = records;
    this.hydrated = true;
  }

  read(owner: string, key: string): JsonValue | undefined {
    this.assertReady(owner, key, "state");
    return this.values.get(slot(owner, key));
  }

  readRecords(owner: string, key: string): readonly JsonValue[] {
    this.assertReady(owner, key, "log");
    return this.records.get(slot(owner, key)) ?? NO_RECORDS;
  }

  async write(owner: string, key: string, value: unknown): Promise<void> {
    const keyed = slot(owner, key);
    const stored = this.prepare(owner, key, value);
    // Read-your-writes: the value is visible at once, so tool calls of one round that run together
    // (plan 226 Task 4) see each other's updates instead of a stale snapshot. `latest` names the newest
    // write of a key: only it may re-assert the value after `ready()` hydrated the branch (which
    // replaces `values`) or restore the previous value when its append failed.
    const previous = this.values.get(keyed);
    this.values.set(keyed, stored);
    this.latest.set(keyed, stored);
    try {
      await this.persist(owner, key, stored, "set");
    } catch (error) {
      if (this.latest.get(keyed) === stored) {
        this.latest.delete(keyed);
        if (previous === undefined) this.values.delete(keyed);
        else this.values.set(keyed, previous);
      }
      throw error;
    }
    if (this.latest.get(keyed) === stored) this.values.set(keyed, stored);
  }

  async append(owner: string, key: string, value: unknown): Promise<void> {
    const stored = this.prepare(owner, key, value);
    await this.options.ready();
    const keyed = slot(owner, key);
    const list = this.records.get(keyed) ?? [];
    this.assertLogEntries(owner, key, list.length + 1);
    await this.options.append({ schemaVersion: 1, package: owner, key, value: stored, op: "append" });
    const updated = this.records.get(keyed) ?? [];
    updated.push(stored);
    this.records.set(keyed, updated);
  }

  async replace(owner: string, key: string, values: readonly unknown[] = []): Promise<void> {
    if (!Array.isArray(values)) throw new TypeError("log.replace needs an array of JSON values");
    this.assertLogEntries(owner, key, values.length);
    const prepared = values.map((value) => this.prepareValue(owner, key, value));
    const stored = this.assertMaxBytes(owner, key, deepFreeze(prepared) as JsonValue[]);
    await this.persist(owner, key, stored, "replace");
    this.records.set(slot(owner, key), [...(stored as readonly JsonValue[])]);
  }

  private assertReady(owner: string, key: string, member: "state" | "log"): void {
    if (this.hydrated) return;
    throw new PackageLoadError(
      "state_not_ready",
      `Package ${owner} read session ${member} ${key} before the session read its branch. Read it from a hook, tool, or command, or await set first.`,
      { package: owner },
    );
  }

  private async persist(owner: string, key: string, stored: JsonValue, op: "set" | "append" | "replace"): Promise<void> {
    await this.options.ready();
    await this.options.append({ schemaVersion: 1, package: owner, key, value: stored, op });
  }

  private assertLogEntries(owner: string, key: string, count: number): void {
    const max = this.options.maxLogEntries?.() ?? MAX_STATE_LOG_ENTRIES;
    if (count > max) {
      throw new PackageLoadError(
        "state_log_limit",
        `Package ${owner} log ${key} would hold ${count} entries; ceilings.stateLogEntries is ${max}.`,
        { package: owner },
      );
    }
  }

  private prepareValue(owner: string, key: string, value: unknown): JsonValue {
    const json = toJsonValue(value);
    if ("error" in json) {
      throw new PackageLoadError("state_not_json", `Package ${owner} state ${key} ${json.error.message} at ${json.error.path}.`, {
        package: owner,
        path: json.error.path,
      });
    }
    // Redact before persisting. `activeRedactor` is unset between runs, so the store applies the agent's own.
    return deepFreeze(this.options.redact(json.value));
  }

  private assertMaxBytes(owner: string, key: string, stored: JsonValue): JsonValue {
    const bytes = new TextEncoder().encode(JSON.stringify(stored)).length;
    const max = this.options.maxValueBytes?.() ?? MAX_STATE_VALUE_BYTES;
    if (bytes > max) {
      throw new PackageLoadError(
        "state_too_large",
        `Package ${owner} state ${key} is ${bytes} bytes; ceilings.stateValueBytes is ${max}.`,
        {
          package: owner,
        },
      );
    }
    return stored;
  }

  /** Validate, redact, and size-check a value before it is stored or persisted. */
  private prepare(owner: string, key: string, value: unknown): JsonValue {
    return this.assertMaxBytes(owner, key, this.prepareValue(owner, key, value));
  }
}

const stores = new WeakMap<SessionContext, SessionStateStore>();

/** Called by the session for each view it creates, so `SessionState` can find the session's store. */
export function bindSessionState(view: SessionContext, store: SessionStateStore): void {
  stores.set(view, store);
}

function storeOf(session: SessionContext): SessionStateStore {
  const store = stores.get(session);
  if (!store) throw new TypeError("state needs the SessionContext the kernel passed to a hook, tool, or command");
  return store;
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_STATE_KEY_LENGTH) {
    throw new TypeError(`state key must be 1-${MAX_STATE_KEY_LENGTH} characters`);
  }
}

/** `prism.state.session(key, initial)` for `owner`. State is namespaced by the package that declared it. */
export function createSessionState<T extends JsonValue>(owner: string, key: string, initial: T): SessionState<T> {
  assertKey(key);
  const first = toJsonValue(initial);
  if ("error" in first) {
    throw new PackageLoadError(
      "state_not_json",
      `Package ${owner} state ${key} initial value ${first.error.message} at ${first.error.path}.`,
      {
        package: owner,
        path: first.error.path,
      },
    );
  }
  const frozen = deepFreeze(first.value) as T;
  return {
    get(session) {
      const value = storeOf(session).read(owner, key);
      return (value === undefined ? frozen : value) as T;
    },
    set: (session, value) => storeOf(session).write(owner, key, value),
  };
}

/** `prism.state.log(key)` for `owner`: an append-only record log kept on each session's branch. */
export function createSessionLog<T extends JsonValue>(owner: string, key: string): SessionLog<T> {
  assertKey(key);
  return {
    entries: (session) => storeOf(session).readRecords(owner, key) as readonly T[],
    append: (session, value) => storeOf(session).append(owner, key, value),
    replace: (session, values = []) => storeOf(session).replace(owner, key, values),
  };
}

/** `prism.state.agent(key, initial)`: process memory. `reset` runs on dispose. */
export function createAgentState<T>(key: string, initial: T): AgentState<T> & { reset(): void } {
  assertKey(key);
  let current = initial;
  return {
    get: () => current,
    set(value) {
      current = value;
    },
    reset() {
      current = initial;
    },
  };
}
