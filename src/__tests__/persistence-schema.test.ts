import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERSISTENCE_SCHEMA_VERSION,
  assertAdapterSchemaMatchesModel,
  assertMigrationUpAndReopen,
  assertParameterizedQuery,
  assertPersistenceMigrationContract,
  assertPersistenceQueryPaginationConforms,
  assertPersistenceSchemaModel,
  assertTenantScopedQueryIsolation,
  createPersistenceMigrationContract,
  createPersistenceSchemaModel,
  getPersistencePaginationCursors,
  tenantScopedUniqueKey,
} from "../testing/persistence-schema.js";
import type { PersistencePage, SessionEntry, SessionEntryQuery } from "../index.js";

void describe("persistence schema model", () => {
  it("canonical model validates and includes required tables", () => {
    const model = createPersistenceSchemaModel();
    assert.equal(model.version, PERSISTENCE_SCHEMA_VERSION);
    assertPersistenceSchemaModel(model);
    assert.ok(model.tables.some((table) => table.name === "prism_session_append_idempotency"));
    assert.ok(model.indexes.some((index) => index.unique && index.table === "prism_session_append_idempotency"));
  });

  it("documents pagination cursors for indexed reads", () => {
    const cursors = getPersistencePaginationCursors();
    assert.ok(cursors.some((cursor) => cursor.columns.includes("sequence")));
    assert.ok(cursors.some((cursor) => cursor.table === "prism_session_entries"));
  });

  it("migration contract is strictly increasing and ends at target version", () => {
    const contract = createPersistenceMigrationContract();
    assertPersistenceMigrationContract(contract);
    assertMigrationUpAndReopen(
      contract,
      [{ name: "001_init", version: "1" }],
      [{ name: "001_init", version: "1" }],
    );
  });

  it("adapter schema matcher requires canonical tables and indexes", () => {
    const model = createPersistenceSchemaModel();
    assertAdapterSchemaMatchesModel(
      model.tables.map((table) => table.name),
      model.indexes.map((index) => index.name),
      model,
    );
  });

  it("tenantScopedUniqueKey prefixes tenant columns", () => {
    assert.deepEqual(tenantScopedUniqueKey(["idempotency_key"]), ["tenant_id", "idempotency_key"]);
  });

  it("rejects interpolated SQL values", () => {
    assert.throws(
      () => assertParameterizedQuery("SELECT * FROM t WHERE id = 'abc'", ["abc"]),
      /interpolate a bound string value/,
    );
    assert.doesNotThrow(() => assertParameterizedQuery("SELECT * FROM t WHERE id = $1", ["abc"]));
  });

  it("pagination conformance detects overlapping cursor pages", async () => {
    const rows = new Map<string, SessionEntry>();
    const fixture = {
      seedEntries(entries: readonly SessionEntry[]) {
        for (const entry of entries) rows.set(entry.id, entry);
      },
      async queryEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>> {
        const items = [...rows.values()]
          .filter((row) => row.sessionId === query.sessionId)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const start = query.cursor ? items.findIndex((row) => row.id === query.cursor) + 1 : 0;
        const page = items.slice(start, start + (query.limit ?? items.length));
        const next = items[start + page.length];
        return { items: page, nextCursor: next?.id };
      },
    };
    await assertPersistenceQueryPaginationConforms(fixture);
  });

  it("tenant query isolation rejects cross-tenant primary id collisions", async () => {
    await assertTenantScopedQueryIsolation(async (tenantId) => {
      if (tenantId === "tenant-a") return [{ id: "run-a", tenantId: "tenant-a" }];
      return [{ id: "run-b", tenantId: "tenant-b" }];
    });
    await assert.rejects(
      () => assertTenantScopedQueryIsolation(async (tenantId) => [{ id: "shared", tenantId }]),
      /Tenant collision/,
    );
  });
});
