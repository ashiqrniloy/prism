import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERSISTENCE_SCHEMA_VERSION,
  assertAdapterSchemaMatchesModel,
  assertAppliedPersistenceMigrations,
  assertMigrationUpAndReopen,
  assertPersistenceSchemaShape,
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
    assert.deepEqual(model.tables.find((table) => table.name === "prism_session_append_idempotency")?.primaryKey, ["session_id", "expected_parent_id", "idempotency_key"]);
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
      contract.steps.map((step) => ({ name: step.name, version: String(step.version), checksum: step.checksum })),
      contract.steps.map((step) => ({ name: step.name, version: String(step.version), checksum: step.checksum })),
    );
  });

  it("rejects migration history drift and permits only complete legacy checksum backfill", () => {
    const contract = createPersistenceMigrationContract();
    const valid = contract.steps.map((step) => ({ name: step.name, version: String(step.version), checksum: step.checksum }));
    assert.deepEqual(assertAppliedPersistenceMigrations(contract, valid), { legacyChecksums: false });
    assert.deepEqual(assertAppliedPersistenceMigrations(contract, valid.map((step) => ({ ...step, checksum: null }))), { legacyChecksums: true });
    assert.throws(() => assertAppliedPersistenceMigrations(contract, [{ ...valid[0]!, checksum: "bad" }]), /checksum mismatch/);
    assert.throws(() => assertAppliedPersistenceMigrations(contract, [valid[1]!, valid[0]!]), /does not match/);
    assert.throws(() => assertAppliedPersistenceMigrations(contract, [...valid.slice(0, 2), { ...valid[2]!, checksum: null }]), /incomplete legacy/);
  });

  it("compares complete normalized schema shape", () => {
    const model = createPersistenceSchemaModel();
    const shape = {
      tables: model.tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => ({
          name: column.name,
          type: column.type === "integer" || column.type === "boolean" ? "INTEGER" : column.type === "number" ? "REAL" : "TEXT",
          nullable: column.nullable === true,
          defaultValue: column.defaultValue,
        })),
        primaryKey: table.primaryKey,
        uniqueKeys: table.uniqueKeys ?? [],
        foreignKeys: table.foreignKeys ?? [],
      })),
      indexes: model.indexes.map((index) => ({ name: index.name, table: index.table, columns: index.columns, unique: index.unique === true })),
    };
    assert.doesNotThrow(() => assertPersistenceSchemaShape(shape, "sqlite", model));
    const drifted = structuredClone(shape);
    drifted.tables.find((table) => table.name === "prism_usage")!.columns.find((column) => column.name === "scope")!.defaultValue = "'turn'";
    assert.throws(() => assertPersistenceSchemaShape(drifted, "sqlite", model), /incompatible default/);
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
