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
  /**
   * When true, also exercises the optional `readBranchPath` branch-reader path
   * and asserts it returns the ancestor chain in root-to-leaf order. Skipped
   * when the store does not implement `readBranchPath`.
   */
  readonly exerciseReadBranchPath?: boolean;
}

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
