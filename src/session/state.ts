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

/** A value kept in process memory for the agent's lifetime, reset to `initial` on dispose. */
export interface AgentState<T> {
  get(): T;
  set(value: T): void;
}

/** The `data` of a `package_state` entry. */
export interface PackageStateData {
  readonly schemaVersion: 1;
  readonly package: string;
  readonly key: string;
  readonly value: JsonValue;
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
}

/** The state one session holds. The session owns it and binds it to every {@link SessionContext} it hands out. */
export class SessionStateStore {
  private values = new Map<string, JsonValue>();
  private hydrated = false;

  constructor(private readonly options: SessionStateStoreOptions) {}

  get isReady(): boolean {
    return this.hydrated;
  }

  /** Replaces the held values with the latest per `(package, key)` on `branch`. A malformed entry is skipped. */
  hydrate(branch: readonly SessionEntry[]): void {
    const next = new Map<string, JsonValue>();
    for (const entry of branch) {
      if (entry.kind !== "package_state" || !isStateData(entry.data)) continue;
      next.set(slot(entry.data.package, entry.data.key), deepFreeze(entry.data.value));
    }
    this.values = next;
    this.hydrated = true;
  }

  read(owner: string, key: string): JsonValue | undefined {
    if (!this.hydrated) {
      throw new PackageLoadError(
        "state_not_ready",
        `Package ${owner} read session state ${key} before the session read its branch. Read it from a hook, tool, or command, or await set first.`,
        { package: owner },
      );
    }
    return this.values.get(slot(owner, key));
  }

  async write(owner: string, key: string, value: unknown): Promise<void> {
    const json = toJsonValue(value);
    if ("error" in json) {
      throw new PackageLoadError("state_not_json", `Package ${owner} state ${key} ${json.error.message} at ${json.error.path}.`, {
        package: owner,
        path: json.error.path,
      });
    }
    // Redact before persisting. `activeRedactor` is unset between runs, so the store applies the agent's own.
    const stored = this.options.redact(json.value);
    const bytes = new TextEncoder().encode(JSON.stringify(stored)).length;
    if (bytes > MAX_STATE_VALUE_BYTES) {
      throw new PackageLoadError(
        "state_too_large",
        `Package ${owner} state ${key} is ${bytes} bytes; the limit is ${MAX_STATE_VALUE_BYTES}.`,
        {
          package: owner,
        },
      );
    }
    await this.options.ready();
    await this.options.append({ schemaVersion: 1, package: owner, key, value: stored });
    this.values.set(slot(owner, key), deepFreeze(stored));
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
