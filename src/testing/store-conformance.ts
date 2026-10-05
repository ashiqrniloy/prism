// ponytail: dependency-free, runner-agnostic conformance suite for the SessionStore adapter
// contract. One entry point, `storeConformance`, covers the kernel memory store, the JSONL store,
// and every durable adapter. Each leg is named so a failure names what broke. Throws plain Error;
// no test runner.

import {
  HARD_MAX_SESSION_SEARCH_LIMIT,
  HARD_MAX_SESSION_SEARCH_QUERY_BYTES,
  isSessionAppendConflict,
  isUnsupportedStoreCapability,
  resolveSessionSearchQuery,
  SESSION_TITLE_METADATA_KEY,
  SessionNotFoundError,
  type SessionEntry,
  type SessionSearchKind,
  type SessionStore,
  type SessionStoreCapability,
} from "../contracts.js";
import { createSessionIndex } from "../agent/sessions.js";
import { entriesInScope, sessionStoreCapabilities } from "../session-stores.js";

export type StoreConformanceFactory = () => SessionStore | Promise<SessionStore>;

/** Every leg `storeConformance` runs, in order. A failure message starts with `[<leg>]`. */
export const STORE_CONFORMANCE_STEPS = [
  "append-and-read",
  "branch-and-fork",
  "package-state",
  "suspended-run",
  "search",
  "title",
  "list-and-delete",
  "restart",
] as const;

export type StoreConformanceStep = (typeof STORE_CONFORMANCE_STEPS)[number];

export interface StoreConformanceOptions {
  /** Stable session id used for the conformance run; defaults to "conformance". */
  readonly sessionId?: string;
  /** Secondary session id for session-isolation probes; defaults to `${sessionId}-other`. */
  readonly otherSessionId?: string;
  /**
   * The optional `agent.sessions` capabilities the store claims (`listSessions`, `deleteSession`,
   * `searchSessions`). Defaults to the methods the store implements. A claimed capability the store
   * does not implement fails; an unclaimed one must answer `agent.sessions` with
   * `UnsupportedStoreCapabilityError`.
   */
  readonly capabilities?: readonly SessionStoreCapability[];
  /**
   * A factory for a second instance over the same backing data. When given, the `restart` leg re-reads
   * every earlier leg's writes through it. One reopen covers all groups, not one per assertion.
   */
  readonly reopen?: StoreConformanceFactory;
  /** When true, appends concurrent children of the same parent (fork allowed). */
  readonly exerciseConcurrentParentAppend?: boolean;
}

/** Merge-capable adapters (SQLite, Postgres) keep the title in the session record, not only on entries. */
type MergeSessionMetadata = (sessionId: string, patch: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;

/**
 * Assert that a `SessionStore` implementation satisfies the full adapter contract: append/list order,
 * `get`, append-conflict rules (duplicate id, `expectedParentId`, `idempotencyKey`), branch and fork
 * isolation, `package_state` and `suspended_run` round-trips, `searchSessions`, the session title,
 * `agent.sessions` list/delete over the store's declared capabilities, and durable survival when a
 * `reopen` factory is given. Throws on the first violation; returns silently when the store conforms.
 */
export async function storeConformance(factory: StoreConformanceFactory, options: StoreConformanceOptions = {}): Promise<void> {
  const store = await factory();
  const sessionId = options.sessionId ?? "conformance";
  const otherSessionId = options.otherSessionId ?? `${sessionId}-other`;
  const claimed = new Set<SessionStoreCapability>(options.capabilities ?? sessionStoreCapabilities(store));
  for (const capability of claimed) {
    if (typeof store[capability] !== "function") {
      throw new Error(`[capabilities] the store claims ${capability} but does not implement it`);
    }
  }
  const sessions = createSessionIndex({ store: () => store, ownership: undefined });
  const title = "conformance title";
  const token = "zzconformancesearchtoken";
  const suffix = Math.random().toString(36).slice(2, 10);
  const tenantA = `tenant-${suffix}-a`;
  const tenantB = `tenant-${suffix}-b`;
  const mine = `index-mine-${suffix}`;
  const newer = `index-new-${suffix}`;
  const doomed = `index-doomed-${suffix}`;
  const theirs = `index-theirs-${suffix}`;
  const foreign = `index-foreign-${suffix}`;
  const now = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
  const entry = (id: string, parentId: string | undefined, at: number, extra: Partial<SessionEntry> = {}): SessionEntry => ({
    id,
    parentId,
    sessionId,
    timestamp: now(at),
    kind: "label",
    label: id,
    ...extra,
  });
  const stamp = (id: string, at: number, tenantId: string): SessionEntry => ({
    id: `${id}-e1`,
    sessionId: id,
    timestamp: now(at),
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "index conformance" }] },
    metadata: { tenantId },
  });
  const tip = async () => (await store.list(sessionId)).at(-1)?.id;
  const chainOf = async (leafId: string) => {
    const chain = await store.readBranchPath!({ sessionId, leafId });
    return chain.items.map((item) => item.id);
  };

  await leg("append-and-read", async () => {
    const root = entry("root", undefined, 0);
    await store.append(root);
    const child = entry("child", root.id, 1);
    await store.append(child);
    assertIds(await store.list(sessionId), ["root", "child"], "append/list round-trip dropped entries");

    if (typeof store.get === "function") {
      const fetched = await store.get(root.id);
      if (fetched?.label !== root.id) throw new Error("get must return the appended entry by id");
    }
    const summary = await sessions.get(sessionId);
    if (summary?.sessionId !== sessionId || typeof summary.leafId !== "string") {
      throw new Error("agent.sessions.get must summarize the appended session");
    }
    if (summary.messageCount !== 0) throw new Error(`agent.sessions.get counted ${summary.messageCount} messages in a label-only session`);

    await reject(
      () => store.append(entry("root", undefined, 2)),
      /Duplicate session entry id: root/,
      "store must reject a duplicate entry id",
    );

    const before = (await store.list(sessionId)).length;
    await reject(
      () => store.append(entry("orphan", "missing", 3), { expectedParentId: "missing" }),
      (error) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "missing",
      "store must throw SessionAppendConflictError when expectedParentId does not exist",
    );
    if ((await store.list(sessionId)).length !== before) {
      throw new Error("A rejected append (missing parent) wrote entries; append must be atomic");
    }

    await store.append(entry("idem-a", undefined, 4), { idempotencyKey: "k1" });
    await reject(
      () => store.append(entry("idem-dup", undefined, 5), { idempotencyKey: "k1" }),
      (error) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
      "store must deduplicate an exact retry sharing an idempotencyKey",
    );
    const linearA = entry("linear-a", undefined, 6);
    await store.append(linearA, { idempotencyKey: "run-1" });
    await store.append(entry("linear-b", linearA.id, 7), { idempotencyKey: "run-1", expectedParentId: linearA.id });
    if (!(await store.list(sessionId)).some((row) => row.id === "linear-b")) {
      throw new Error("Distinct linear appends sharing an idempotencyKey were collapsed; only same-position retries dedup");
    }

    if (typeof store.readBranchPath === "function") {
      assertChain(await chainOf("child"), ["root", "child"], "readBranchPath must return the ancestor chain root→leaf in order");
    }

    if (options.exerciseConcurrentParentAppend) {
      const forkRoot = entry("fork-root", undefined, 8);
      await store.append(forkRoot);
      const results = await Promise.allSettled([
        store.append(entry("fork-a", forkRoot.id, 9), { expectedParentId: forkRoot.id }),
        store.append(entry("fork-b", forkRoot.id, 9), { expectedParentId: forkRoot.id }),
      ]);
      if (results.every((result) => result.status === "rejected")) {
        throw new Error("Concurrent append to an existing parent rejected both writers; at least one fork child must succeed");
      }
      const written = await store.list(sessionId);
      if (!written.some((row) => row.id === "fork-a") && !written.some((row) => row.id === "fork-b")) {
        throw new Error("Concurrent parent append wrote no child entries");
      }
    }
  });

  await leg("branch-and-fork", async () => {
    const branchA = entry("branch-a", "root", 10);
    await store.append(branchA, { expectedParentId: "root" });
    const branchB = entry("branch-b", "root", 11);
    await store.append(branchB, { expectedParentId: "root" });
    if (typeof store.readBranchPath === "function") {
      assertChain(await chainOf("branch-a"), ["root", "branch-a"], "sibling branches must stay isolated");
      assertChain(await chainOf("branch-b"), ["root", "branch-b"], "sibling branches must stay isolated");
    }

    await store.append({ id: "isolation-entry", sessionId: otherSessionId, timestamp: now(12), kind: "label", label: "isolated" });
    if ((await store.list(sessionId)).some((row) => row.id === "isolation-entry")) {
      throw new Error("SessionStore leaked entries across session ids");
    }

    // Fork: copy a branch under a new session id (plan 149 `fork`); the source session must stay untouched.
    const sourceBefore = (await store.list(sessionId)).map((row) => row.id);
    const forkSessionId = `${sessionId}-fork`;
    const source = (await store.list(sessionId)).filter((row) => row.id === "root" || row.id === "branch-a");
    let parentId: string | undefined;
    const copies = source.map((row) => {
      const copy: SessionEntry = { ...row, id: `copy-${row.id}`, sessionId: forkSessionId, ...(parentId === undefined ? {} : { parentId }) };
      parentId = copy.id;
      return copy;
    });
    for (const copy of copies) await store.append(copy);
    assertIds(await store.list(sessionId), sourceBefore, "forking a branch into a new session id must leave the source untouched");
    assertIds(await store.list(forkSessionId), ["copy-root", "copy-branch-a"], "a forked session must carry the branch copy");
    if (typeof store.readBranchPath === "function") {
      assertChain(await chainOf("branch-a"), ["root", "branch-a"], "forking must leave the source branch path untouched");
    }
  });

  await leg("package-state", async () => {
    const first: SessionEntry = {
      id: "package-state-1",
      parentId: await tip(),
      sessionId,
      timestamp: now(20),
      kind: "package_state",
      data: { schemaVersion: 1, package: "@acme/om", key: "ledger", value: { enabled: true, notes: ["a", 1, null] } },
    };
    await store.append(first);
    const stored = (await store.list(sessionId)).find((row) => row.id === first.id);
    if (stored?.kind !== "package_state" || JSON.stringify(stored.data) !== JSON.stringify(first.data)) {
      throw new Error("session store must preserve a package_state entry byte-for-byte");
    }

    const second: SessionEntry = {
      id: "package-state-2",
      parentId: first.id,
      sessionId,
      timestamp: now(21),
      kind: "package_state",
      data: { schemaVersion: 1, package: "@acme/om", key: "ledger", value: { enabled: false } },
    };
    await store.append(second);
    const latest = readLatestPackageState(await store.list(sessionId), "@acme/om", "ledger");
    if (!latest.found || JSON.stringify(latest.value) !== JSON.stringify({ enabled: false })) {
      throw new Error("the latest package_state entry per package and key must win");
    }
  });

  await leg("suspended-run", async () => {
    const suspended: SessionEntry = {
      id: "suspended-run",
      parentId: await tip(),
      sessionId,
      timestamp: now(30),
      kind: "suspended_run",
      data: { schemaVersion: 1, runId: "run-suspended", hookIds: ["host:tool.call"], loop: { name: "default", revision: "1" } },
    };
    await store.append(suspended);
    const stored = (await store.list(sessionId)).find((row) => row.id === suspended.id);
    const data = stored?.data as { readonly runId?: unknown; readonly hookIds?: readonly string[] } | undefined;
    if (stored?.kind !== "suspended_run" || data?.runId !== "run-suspended" || data.hookIds?.[0] !== "host:tool.call") {
      throw new Error("session store must preserve a suspended_run entry and its data payload");
    }
    if (typeof store.readBranchPath === "function") {
      const chain = await chainOf("suspended-run");
      if (chain.at(-1) !== "suspended-run") throw new Error("a suspended_run entry parented to the leaf must be the branch tip");
    }

    await store.append(entry("after-suspend", "suspended-run", 31));
    if (typeof store.readBranchPath === "function") {
      const chain = await chainOf("after-suspend");
      if (chain.at(-1) !== "after-suspend" || chain.includes("suspended-run") === false) {
        throw new Error("an entry appended after a suspended_run must hide it as the branch tip");
      }
    }
  });

  await leg("search", async () => {
    if (!claimed.has("searchSessions")) {
      await reject(() => sessions.search({ limit: 5 }), isUnsupportedStoreCapability, unclaimed("searchSessions", "search"));
      return;
    }
    await assertSessionStoreSearchSessions(store, token);
  });

  await leg("title", async () => {
    const titled: SessionEntry = {
      id: "title-entry",
      parentId: await tip(),
      sessionId,
      timestamp: now(40),
      kind: "metadata",
      metadata: { [SESSION_TITLE_METADATA_KEY]: title },
      data: { source: "conformance" },
    };
    await store.append(titled);
    const stored = (await store.list(sessionId)).find((row) => row.id === titled.id);
    if (stored?.metadata?.[SESSION_TITLE_METADATA_KEY] !== title) {
      throw new Error("session store must preserve entry metadata, including the title key");
    }

    const merge = (store as { mergeSessionMetadata?: MergeSessionMetadata }).mergeSessionMetadata;
    if (typeof merge === "function") {
      const written = await merge.call(store, sessionId, { [SESSION_TITLE_METADATA_KEY]: title });
      if (written === false) throw new Error("mergeSessionMetadata must report the title write for a present session");
    }

    if (claimed.has("listSessions")) {
      const summary = (await sessions.list({ limit: 100 })).items.find((item) => item.sessionId === sessionId);
      if (summary?.title !== title) throw new Error("listSessions must surface the session title");
    } else {
      await reject(() => sessions.list({ limit: 5 }), isUnsupportedStoreCapability, unclaimed("listSessions", "list"));
    }
  });

  await leg("list-and-delete", async () => {
    await store.append(stamp(mine, 50, tenantA));
    await store.append(stamp(newer, 51, tenantA));
    await store.append(stamp(doomed, 52, tenantA));
    await store.append(stamp(theirs, 53, tenantB));
    await store.append(stamp(foreign, 54, tenantB));

    if (claimed.has("listSessions")) {
      const ids = (await store.listSessions!({ tenantId: tenantA, limit: 100 })).items.map((item) => item.sessionId);
      for (const expected of [mine, newer, doomed]) {
        if (!ids.includes(expected)) throw new Error(`listSessions must return the scope's session ${expected}; got ${JSON.stringify(ids)}`);
      }
      if (ids.includes(theirs) || ids.includes(foreign)) {
        throw new Error(`listSessions leaked a session outside the scope; got ${JSON.stringify(ids)}`);
      }
      if (ids.indexOf(newer) > ids.indexOf(mine)) throw new Error("listSessions must page newest-first");
      const page = await store.listSessions!({ tenantId: tenantA, limit: 1 });
      if (page.items.length !== 1) throw new Error("listSessions must honor limit");
      if (JSON.stringify(page.items).includes("index conformance")) throw new Error("listSessions must not carry a transcript");

      const scoped = createSessionIndex({ store: () => store, ownership: { tenantId: tenantA } });
      const scopedIds = (await scoped.list({ limit: 100 })).items.map((item) => item.sessionId);
      if (scopedIds.includes(theirs) || scopedIds.includes(foreign)) throw new Error("agent.sessions.list leaked a foreign-scope session");
      if ((await scoped.get(foreign)) !== undefined) throw new Error("agent.sessions.get must fail closed for a foreign-scope session");
      if (typeof store.readBranchPath === "function") {
        const chain = await store.readBranchPath({ sessionId: foreign, leafId: `${foreign}-e1` });
        if (entriesInScope(chain.items, { tenantId: tenantA })) {
          throw new Error("a foreign-scope readBranchPath chain must fail the kernel's ownership-scope guard");
        }
      }
      await reject(
        () => scoped.delete(theirs),
        (error) => error instanceof SessionNotFoundError,
        "agent.sessions.delete must answer SessionNotFoundError for a foreign-scope session",
      );
    } else {
      await reject(() => sessions.list({ limit: 5 }), isUnsupportedStoreCapability, unclaimed("listSessions", "list"));
    }

    if (claimed.has("deleteSession")) {
      if (await store.deleteSession!(theirs, { tenantId: tenantA })) throw new Error("deleteSession must refuse a session outside the scope");
      if ((await store.list(theirs)).length === 0) throw new Error("a refused deleteSession removed entries");
      if (!(await store.deleteSession!(doomed, { tenantId: tenantA }))) throw new Error("deleteSession must delete an in-scope session");
      if ((await store.list(doomed)).length !== 0) throw new Error("deleteSession must remove every entry");
      if (await store.deleteSession!(doomed, { tenantId: tenantA })) throw new Error("deleteSession of an absent session must resolve false");
      if ((await store.list(mine)).length === 0) throw new Error("deleteSession must not touch another session");
    } else {
      await reject(() => sessions.delete(mine), isUnsupportedStoreCapability, unclaimed("deleteSession", "delete"));
    }
  });

  const reopen = options.reopen;
  if (reopen) {
    await leg("restart", async () => {
      const before = (await store.list(sessionId)).map((row) => row.id);
      const reopened = await reopen();
      const after = await reopened.list(sessionId);
      assertIds(after, before, "Session entries did not survive reopen");
      if (!after.some((row) => row.id === "suspended-run")) throw new Error("a suspended_run entry must survive reopen");
      if (!after.some((row) => row.id === "after-suspend")) {
        throw new Error("the entry that hid the suspended run must survive reopen");
      }
      if (typeof reopened.readBranchPath === "function") {
        const chain = (await reopened.readBranchPath({ sessionId, leafId: "after-suspend" })).items.map((row) => row.id);
        if (chain.at(-1) !== "after-suspend" || !chain.includes("suspended-run")) {
          throw new Error("a suspended_run entry and the entry that hides it must survive reopen as one branch");
        }
      }
      if (after.find((row) => row.id === "title-entry")?.metadata?.[SESSION_TITLE_METADATA_KEY] !== title) {
        throw new Error("entry metadata must survive reopen");
      }
      const latest = readLatestPackageState(after, "@acme/om", "ledger");
      if (!latest.found || JSON.stringify(latest.value) !== JSON.stringify({ enabled: false })) {
        throw new Error("the latest package_state entry per package and key must still win after reopen");
      }

      await reject(
        () => reopened.append(entry("reopen-dup", undefined, 60), { idempotencyKey: "k1" }),
        (error) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
        "Restarted store must still deduplicate an exact idempotency retry",
      );

      if (claimed.has("listSessions")) {
        const summary = (await reopened.listSessions!({ limit: 100 })).items.find((item) => item.sessionId === sessionId);
        if (summary?.title !== title) throw new Error("listSessions must still surface the session title after reopen");
        const scopedIds = (await reopened.listSessions!({ tenantId: tenantA, limit: 100 })).items.map((item) => item.sessionId);
        if (!scopedIds.includes(mine)) throw new Error("a scoped session listing must survive reopen");
      }
      if (claimed.has("searchSessions")) {
        const hits = (await reopened.searchSessions!({ query: token, limit: 5 })).items;
        if (hits.length === 0) throw new Error("searchSessions must still find a match after reopen");
      }
      if (claimed.has("deleteSession")) {
        if (!(await reopened.deleteSession!(mine, { tenantId: tenantA }))) throw new Error("deleteSession must still delete an in-scope session after reopen");
      }
    });
  }
}

/**
 * Bounded search: invalid limit/query/kind rejection via `resolveSessionSearchQuery`, a written-message
 * query round-trip (`entryId`/`runId`/`turn`/`snippet`), the `kind` filter, one hit per session, and the
 * ownership bound.
 */
async function assertSessionStoreSearchSessions(store: SessionStore, token: string): Promise<void> {
  const search = store.searchSessions!;

  await reject(() => search({ limit: 0 }), (error) => error instanceof TypeError, "searchSessions must reject non-positive limit");
  await reject(() => search({ limit: Number.NaN }), (error) => error instanceof TypeError, "searchSessions must reject NaN limit");
  await reject(
    () => search({ limit: HARD_MAX_SESSION_SEARCH_LIMIT + 1 }),
    (error) => error instanceof TypeError,
    "searchSessions must reject oversize limit",
  );
  await reject(
    () => search({ query: "x".repeat(HARD_MAX_SESSION_SEARCH_QUERY_BYTES + 1) }),
    (error) => error instanceof TypeError,
    "searchSessions must reject oversize query string",
  );
  await reject(
    () => search({ kind: "not-an-entry-kind" as SessionSearchKind }),
    (error) => error instanceof TypeError,
    "searchSessions must reject an unknown kind",
  );

  const searchSessionId = "conformance-search";
  const matchedEntry: SessionEntry = {
    id: "conformance-search-entry",
    sessionId: searchSessionId,
    timestamp: "2026-01-01T00:00:05.000Z",
    kind: "message",
    runId: "conformance-run",
    message: { role: "user", content: [{ type: "text", text: `${token} body text` }] },
  };
  await store.append(matchedEntry);
  const found = await search({ query: token, limit: 5 });
  const hit = found.items.find((item) => item.sessionId === searchSessionId);
  if (!hit) throw new Error("searchSessions must find a session by matching message text");
  if (hit.entryId !== matchedEntry.id) throw new Error(`searchSessions must point at the matched entry; got ${String(hit.entryId)}`);
  if (hit.runId !== matchedEntry.runId) throw new Error("searchSessions must carry the matched entry runId");
  if (typeof hit.snippet !== "string" || !hit.snippet.includes(token)) {
    throw new Error("searchSessions snippet must contain the matched text");
  }
  if (!Number.isSafeInteger(hit.turn) || (hit.turn as number) < 1) {
    throw new Error("searchSessions must carry a 1-based matched-entry turn index");
  }
  const annotationOnly = await search({ query: token, kind: "summary", limit: 5 });
  if (annotationOnly.items.some((item) => item.sessionId === searchSessionId)) {
    throw new Error("searchSessions kind filter must exclude non-matching entry kinds");
  }

  await store.append({
    id: "conformance-search-entry-2",
    parentId: matchedEntry.id,
    sessionId: searchSessionId,
    timestamp: "2026-01-01T00:00:06.000Z",
    kind: "summary",
    summary: `${token} recap`,
  });
  const deduped = await search({ query: token, limit: 5 });
  const sessionHits = deduped.items.filter((item) => item.sessionId === searchSessionId);
  if (sessionHits.length !== 1) throw new Error(`searchSessions must return one hit per session; got ${sessionHits.length}`);

  const empty = await search(resolveSessionSearchQuery({ workspaceRoot: "__prism_conformance_empty__", limit: 5 }));
  if (!Array.isArray(empty.items)) throw new Error("searchSessions must return a PersistencePage with an items array");

  const resolved = resolveSessionSearchQuery({ limit: 1 });
  const page = await search(resolved);
  if (page.items.length > resolved.limit) {
    throw new Error(`searchSessions must honor limit; got ${page.items.length} items for limit ${resolved.limit}`);
  }
  for (const item of page.items) {
    if (typeof item.sessionId !== "string" || !item.sessionId) throw new Error("searchSessions hits must include a non-empty sessionId");
    if ("credential" in item || "apiKey" in item || "password" in item) {
      throw new Error("searchSessions hits must not include credential fields");
    }
  }

  const unscoped = await search({ limit: 100 });
  const owned = await search({ tenantId: "__missing_tenant__", limit: 100 });
  if (owned.items.length > unscoped.items.length) {
    throw new Error("searchSessions ownership filter must not return more hits than an unscoped search");
  }
}

function unclaimed(capability: SessionStoreCapability, method: string): string {
  return `a store without ${capability} must answer agent.sessions.${method}() with UnsupportedStoreCapabilityError`;
}

/** The last `package_state` value for a `{ package, key }`, as the package-state reader resolves it. */
function readLatestPackageState(entries: readonly SessionEntry[], pkg: string, key: string): { readonly found: boolean; readonly value: unknown } {
  let found = false;
  let value: unknown;
  for (const entry of entries) {
    if (entry.kind !== "package_state") continue;
    const data = entry.data as { readonly package?: unknown; readonly key?: unknown; readonly value?: unknown } | undefined;
    if (data?.package !== pkg || data.key !== key) continue;
    found = true;
    value = data.value;
  }
  return { found, value };
}

async function leg(name: StoreConformanceStep, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw new Error(`[${name}] ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function assertIds(entries: readonly SessionEntry[], expected: readonly string[], message: string): void {
  assertChain(entries.map((entry) => entry.id), expected, message);
}

function assertChain(actual: readonly string[], expected: readonly string[], message: string): void {
  if (actual.length !== expected.length || expected.some((id, index) => actual[index] !== id)) {
    throw new Error(`${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function reject(fn: () => Promise<unknown>, match: RegExp | ((error: unknown) => boolean), message: string): Promise<void> {
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
