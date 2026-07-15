// ponytail: dependency-free, runner-agnostic conformance helper for the
// SessionStore adapter contract. Hosts implementing a DB-backed SessionStore
// (see examples/external-app-db-backed.ts) call this once to assert the
// append/idempotency/conflict/branch invariants that the core memory and JSONL
// stores already satisfy. Mirrors the assertion shape already repeated across
// src/__tests__/session-stores.test.ts and node-session-store-jsonl.test.ts so
// adapter authors do not re-derive them. Throws plain Error; no test runner.

import type { SessionEntry, SessionStore } from "../contracts.js";
import { isSessionAppendConflict } from "../contracts.js";

export interface SessionStoreConformanceOptions {
  /** Stable session id used for the conformance run; defaults to "conformance". */
  readonly sessionId?: string;
  /** Secondary session id for branch-isolation probes; defaults to "conformance-other". */
  readonly otherSessionId?: string;
  /**
   * When true, also exercises the optional `readBranchPath` branch-reader path
   * and asserts it returns the ancestor chain in root-to-leaf order. Skipped
   * when the store does not implement `readBranchPath`.
   */
  readonly exerciseReadBranchPath?: boolean;
  /** When true, appends concurrent children of the same parent (fork allowed). */
  readonly exerciseConcurrentParentAppend?: boolean;
  /**
   * When true, the factory is invoked again after writes to assert durable state
   * survives reopen (database adapters only).
   */
  readonly exerciseReopen?: boolean;
}

export type SessionStoreConformanceFactory = () => SessionStore | Promise<SessionStore>;

/**
 * Assert that a `SessionStore` implementation satisfies the core adapter
 * contract: round-trip append/list, duplicate-entry-id rejection,
 * `expectedParentId` conflict (with nothing appended), `idempotencyKey`
 * deduplication, branching from any existing entry (not just the tip), and
 * distinct linear appends sharing a key are not collapsed. Throws on the first
 * violation; returns silently when the store conforms.
 */
export async function assertSessionStoreConforms(
  store: SessionStore,
  options: SessionStoreConformanceOptions = {},
): Promise<void> {
  const sessionId = options.sessionId ?? "conformance";
  const now = () => "2026-01-01T00:00:00.000Z";
  const make = (id: string, parentId?: string): SessionEntry => ({
    id,
    parentId,
    sessionId,
    timestamp: now(),
    kind: "label",
    label: id,
  });

  // 1. append + list round-trip.
  const root = make("root");
  await store.append(root);
  const child = make("child", root.id);
  await store.append(child);
  assertIds(await store.list(sessionId), ["root", "child"], "append/list round-trip dropped entries");

  // 2. duplicate entry id is rejected.
  await reject(
    () => store.append(make("root")),
    /Duplicate session entry id: root/,
    "store must reject a duplicate entry id",
  );

  // 3. expectedParentId mismatch throws SessionAppendConflictError and writes nothing.
  const before = (await store.list(sessionId)).length;
  await reject(
    () => store.append(make("orphan"), { expectedParentId: "missing" }),
    (error: unknown) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "missing",
    "store must throw SessionAppendConflictError when expectedParentId does not exist",
  );
  if ((await store.list(sessionId)).length !== before) {
    throw new Error("A rejected append (missing parent) wrote entries; append must be atomic");
  }

  // 4. idempotencyKey dedup: an exact retry at the same position is rejected as a duplicate.
  await store.append(make("idem-a"), { idempotencyKey: "k1" });
  await reject(
    () => store.append(make("idem-dup"), { idempotencyKey: "k1" }),
    (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    "store must deduplicate an exact retry sharing an idempotencyKey",
  );

  // 5. branching from any existing entry (not just the tip) succeeds.
  const branch = make("branch", root.id);
  await store.append(branch, { expectedParentId: root.id });
  if (!(await store.list(sessionId)).some((entry) => entry.id === "branch")) {
    throw new Error("Branching from a non-tip existing entry was rejected; expectedParentId is existence-validation, not tip-CAS");
  }

  // 6. distinct linear appends sharing a run-level idempotencyKey are NOT collapsed.
  const linearA = make("linear-a");
  await store.append(linearA, { idempotencyKey: "run-1" });
  const linearB = make("linear-b", linearA.id);
  await store.append(linearB, { idempotencyKey: "run-1", expectedParentId: linearA.id });
  if (!(await store.list(sessionId)).some((entry) => entry.id === "linear-b")) {
    throw new Error("Distinct linear appends sharing an idempotencyKey were collapsed; only same-position retries dedup");
  }

  if (options.exerciseReadBranchPath && typeof store.readBranchPath === "function") {
    const chain = await store.readBranchPath({ sessionId, leafId: branch.id });
    const ids = chain.items.map((entry) => entry.id);
    if (ids[0] !== "root" || ids[ids.length - 1] !== "branch") {
      throw new Error(`readBranchPath must return the ancestor chain root→leaf in order; got ${JSON.stringify(ids)}`);
    }
  }

  await assertSessionStoreBranchIsolation(store, options);

  if (options.exerciseConcurrentParentAppend) {
    await assertConcurrentParentAppendAllowed(store, sessionId, now, make);
  }
}

/**
 * Factory-based conformance entry point for durable adapters. Calls the factory
 * to obtain a store, runs the full contract, and optionally reopens through the
 * same factory to assert idempotency rows and entries survive restart.
 */
export async function runSessionStoreConformance(
  factory: SessionStoreConformanceFactory,
  options: SessionStoreConformanceOptions = {},
): Promise<void> {
  const store = await factory();
  await assertSessionStoreConforms(store, options);

  if (!options.exerciseReopen) return;

  const sessionId = options.sessionId ?? "conformance";
  const listed = await store.list(sessionId);
  const parent = listed.at(-1);
  await store.append({
    id: "reopen-target",
    parentId: parent?.id,
    sessionId,
    timestamp: "2026-01-01T00:00:01.000Z",
    kind: "label",
    label: "reopen",
  }, { idempotencyKey: "reopen-idem", expectedParentId: parent?.id });

  const before = (await store.list(sessionId)).map((entry) => entry.id);
  const reopened = await factory();
  const after = (await reopened.list(sessionId)).map((entry) => entry.id);
  if (before.join("\u0000") !== after.join("\u0000")) {
    throw new Error("Session entries did not survive adapter reopen");
  }

  await reject(
    () => reopened.append({
      id: "reopen-idem-dup",
      parentId: parent?.id,
      sessionId,
      timestamp: "2026-01-01T00:00:01.000Z",
      kind: "label",
      label: "dup",
    }, { idempotencyKey: "reopen-idem", expectedParentId: parent?.id }),
    (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    "Restarted store must still deduplicate an exact idempotency retry",
  );
}

async function assertSessionStoreBranchIsolation(
  store: SessionStore,
  options: SessionStoreConformanceOptions,
): Promise<void> {
  const sessionId = options.sessionId ?? "conformance";
  const otherSessionId = options.otherSessionId ?? `${sessionId}-other`;
  const entry: SessionEntry = {
    id: "isolation-entry",
    sessionId: otherSessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "label",
    label: "isolated",
  };
  await store.append(entry);
  const primary = await store.list(sessionId);
  if (primary.some((row) => row.id === "isolation-entry")) {
    throw new Error("SessionStore leaked entries across session ids");
  }
}

async function assertConcurrentParentAppendAllowed(
  store: SessionStore,
  sessionId: string,
  now: () => string,
  make: (id: string, parentId?: string) => SessionEntry,
): Promise<void> {
  const forkRoot = make("fork-root");
  await store.append(forkRoot);
  const childA = make("fork-a", forkRoot.id);
  const childB = make("fork-b", forkRoot.id);
  const results = await Promise.allSettled([
    store.append(childA, { expectedParentId: forkRoot.id }),
    store.append(childB, { expectedParentId: forkRoot.id }),
  ]);
  const succeeded = results.filter((result) => result.status === "fulfilled").length;
  if (succeeded === 0) throw new Error("Concurrent append to an existing parent rejected both writers; at least one fork child must succeed");
  const listed = await store.list(sessionId);
  if (!listed.some((entry) => entry.id === "fork-a") && !listed.some((entry) => entry.id === "fork-b")) {
    throw new Error("Concurrent parent append wrote no child entries");
  }
}

function assertIds(entries: readonly SessionEntry[], expected: readonly string[], message: string): void {
  const actual = entries.map((entry) => entry.id);
  if (actual.length !== expected.length || expected.some((id, i) => actual[i] !== id)) {
    throw new Error(`${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function reject(
  fn: () => Promise<unknown>,
  match: RegExp | ((error: unknown) => boolean),
  message: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    if (match instanceof RegExp) {
      if (!match.test((error as Error).message ?? String(error))) {
        throw new Error(`${message}; error did not match ${match}: ${String(error)}`);
      }
    } else if (!match(error)) {
      throw new Error(`${message}; error did not satisfy predicate: ${String(error)}`);
    }
  }
  if (!threw) throw new Error(message);
}
