import assert from "node:assert/strict";
import type { ProductionPersistenceStore, SessionStore } from "@arnilo/prism";

/** Filter-only search parity; full-text ranking and SQL binding stay dialect-local. */
export async function assertPersistenceSearchQueryParity(store: SessionStore & ProductionPersistenceStore): Promise<void> {
  if (!store.appendSession || !store.searchSessions) throw new Error("Search and session upsert required");
  const at = "2026-01-01T00:00:00.000Z";
  for (const id of ["query-a", "query-b", "query-foreign"]) {
    const session = {
      id,
      tenantId: id === "query-foreign" ? "foreign" : "tenant",
      accountId: "account",
      userId: "user",
      createdAt: at,
      updatedAt: at,
    };
    await store.appendSession(session);
    await store.append({ id: `${id}-entry`, sessionId: id, kind: "label" as const, label: "matching label", timestamp: at });
    await store.appendSession(session); // Explicit metadata write pins equal activity times after append's wall-clock update.
  }
  const search = (query: Parameters<NonNullable<typeof store.searchSessions>>[0]) => store.searchSessions!(query);
  const scoped = { tenantId: "tenant", accountId: "account", userId: "user", label: "matching", kind: "label" as const };
  for (const [order, expected] of [
    ["asc", ["query-a", "query-b"]],
    ["desc", ["query-b", "query-a"]],
  ] as const) {
    const first = await search({ ...scoped, order, limit: 1 });
    assert.deepEqual(
      first.items.map((hit) => hit.sessionId),
      [expected[0]],
    );
    assert.ok(first.nextCursor);
    const second = await search({ ...scoped, order, limit: 1, cursor: first.nextCursor });
    assert.deepEqual(
      second.items.map((hit) => hit.sessionId),
      [expected[1]],
    );
    assert.equal(second.nextCursor, undefined);
  }
  assert.deepEqual(
    (await search({ ...scoped, fromUpdatedAt: at, toUpdatedAt: at })).items.map((hit) => hit.sessionId),
    ["query-b", "query-a"],
  );
  assert.deepEqual(
    (await search({ ...scoped, tenantId: "foreign" })).items.map((hit) => hit.sessionId),
    ["query-foreign"],
  );
  for (const filter of [{ tenantId: "missing" }, { accountId: "wrong" }, { userId: "wrong" }, { kind: "summary" as const }]) {
    assert.deepEqual((await search({ ...scoped, ...filter })).items, []);
  }
  await assert.rejects(search({ ...scoped, cursor: "bad" }), /Invalid entry pagination cursor/);
  await assert.rejects(search({ ...scoped, kind: "bad" as never }), TypeError);

  const owned = { tenantId: "tenant", accountId: "account", userId: "user", order: "asc" as const, limit: 1 };
  const firstSession = await store.querySessions(owned);
  assert.deepEqual(
    firstSession.items.map((session) => session.id),
    ["query-a"],
  );
  assert.ok(firstSession.nextCursor);
  const secondSession = await store.querySessions({ ...owned, cursor: firstSession.nextCursor });
  assert.deepEqual(
    secondSession.items.map((session) => session.id),
    ["query-b"],
  );
  assert.equal(secondSession.nextCursor, undefined);
  assert.deepEqual((await store.querySessions({ ...owned, tenantId: "" })).items, []);
}
