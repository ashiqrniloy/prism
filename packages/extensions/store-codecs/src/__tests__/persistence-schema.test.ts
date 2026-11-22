import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { PersistencePage, SessionEntry, SessionEntryQuery } from "@arnilo/prism";
import {
  assertAdapterSchemaMatchesModel,
  assertAppliedPersistenceMigrations,
  assertMigrationUpAndReopen,
  assertParameterizedQuery,
  assertPersistenceMigrationContract,
  assertPersistenceQueryPaginationConforms,
  assertPersistenceSchemaModel,
  assertPersistenceSchemaShape,
  assertTenantScopedQueryIsolation,
  createPersistenceMigrationContract,
  createPersistenceSchemaModel,
  getPersistencePaginationCursors,
  PERSISTENCE_SCHEMA_VERSION,
  SESSION_ENTRIES_SEQ_INDEX,
  tenantScopedUniqueKey,
} from "../persistence-schema.js";

void describe("persistence schema model", () => {
  it("canonical model validates and includes required tables", () => {
    const model = createPersistenceSchemaModel();
    assert.equal(model.version, PERSISTENCE_SCHEMA_VERSION);
    assertPersistenceSchemaModel(model);
    assert.ok(model.tables.some((table) => table.name === "prism_session_append_idempotency"));
    assert.deepEqual(model.tables.find((table) => table.name === "prism_session_append_idempotency")?.primaryKey, [
      "session_id",
      "expected_parent_id",
      "idempotency_key",
    ]);
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
    assert.deepEqual(
      assertAppliedPersistenceMigrations(
        contract,
        valid.map((step) => ({ ...step, checksum: null })),
      ),
      { legacyChecksums: true },
    );
    assert.throws(() => assertAppliedPersistenceMigrations(contract, [{ ...valid[0]!, checksum: "bad" }]), /checksum mismatch/);
    assert.throws(() => assertAppliedPersistenceMigrations(contract, [valid[1]!, valid[0]!]), /does not match/);
    assert.throws(
      () => assertAppliedPersistenceMigrations(contract, [...valid.slice(0, 2), { ...valid[2]!, checksum: null }]),
      /incomplete legacy/,
    );
  });

  it("compares complete normalized schema shape", () => {
    const model = createPersistenceSchemaModel();
    const shape = {
      tables: model.tables.map((table) => ({
        name: table.name,
        // Plan 230 Task 4: `seq` and its index are PostgreSQL-only.
        columns: table.columns
          .filter((column) => column.dialects === undefined || column.dialects.includes("sqlite"))
          .map((column) => ({
            name: column.name,
            type:
              column.type === "integer" || column.type === "bigint" || column.type === "boolean"
                ? "INTEGER"
                : column.type === "number"
                  ? "REAL"
                  : "TEXT",
            nullable: column.nullable === true,
            defaultValue: column.defaultValue,
          })),
        primaryKey: table.primaryKey,
        uniqueKeys: table.uniqueKeys ?? [],
        foreignKeys: table.foreignKeys ?? [],
      })),
      indexes: model.indexes
        .filter((index) => index.dialects === undefined || index.dialects.includes("sqlite"))
        .map((index) => ({
          name: index.name,
          table: index.table,
          columns: index.columns,
          unique: index.unique === true,
        })),
    };
    assert.doesNotThrow(() => assertPersistenceSchemaShape(shape, "sqlite", model));
    // The same shape lacks PostgreSQL's `seq`, so it is not a PostgreSQL schema.
    assert.throws(() => assertPersistenceSchemaShape(shape, "postgres", model), /prism_\w+ has unexpected columns|incompatible type/);
    const drifted = structuredClone(shape);
    drifted.tables.find((table) => table.name === "prism_usage")!.columns.find((column) => column.name === "scope")!.defaultValue =
      "'turn'";
    assert.throws(() => assertPersistenceSchemaShape(drifted, "sqlite", model), /incompatible default/);
  });

  it("session_entry_seq_is_postgres_only: migration 013 and the seq index apply to PostgreSQL alone", () => {
    const model = createPersistenceSchemaModel();
    const entries = model.tables.find((table) => table.name === "prism_session_entries");
    assert.deepEqual(
      entries?.columns.find((column) => column.name === "seq"),
      { name: "seq", type: "bigint", dialects: ["postgres"] },
    );
    assert.deepEqual(model.indexes.find((index) => index.name === SESSION_ENTRIES_SEQ_INDEX)?.dialects, ["postgres"]);
    const step = createPersistenceMigrationContract().steps.at(-1);
    assert.equal(step?.name, "013_session_entry_seq");
    assert.equal(step?.version, PERSISTENCE_SCHEMA_VERSION);
    const withoutSeq = model.indexes.filter((index) => index.name !== SESSION_ENTRIES_SEQ_INDEX).map((index) => index.name);
    const tables = model.tables.map((table) => table.name);
    // A SQLite adapter (no dialect named) needs no seq index; a PostgreSQL adapter does.
    assert.doesNotThrow(() => assertAdapterSchemaMatchesModel(tables, withoutSeq, model));
    assert.doesNotThrow(() => assertAdapterSchemaMatchesModel(tables, withoutSeq, model, "sqlite"));
    assert.throws(() => assertAdapterSchemaMatchesModel(tables, withoutSeq, model, "postgres"), /prism_session_entries_session_seq_idx/);
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
    assert.throws(() => assertParameterizedQuery("SELECT * FROM t WHERE id = 'abc'", ["abc"]), /interpolate a bound string value/);
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
    await assert.rejects(() => assertTenantScopedQueryIsolation(async (tenantId) => [{ id: "shared", tenantId }]), /Tenant collision/);
  });
});

it("evaluation migration preserves shipped checksums for steps 1–10", () => {
  assert.deepEqual(
    createPersistenceMigrationContract()
      .steps.slice(0, 10)
      .map((step) => step.checksum),
    [
      "1076a7ec27098334a839403e1eaa401ece2fbb7079647d8c60669a315a797aed",
      "611372c6b892358a43138cc051330be68a2761eb745a75f8467d13a591ab3196",
      "c851934ffe7efe005504c80ace432143b09e9fd55f677d3169535477a640e1e1",
      "b5dab838ef42a425ea878c78b14322e64ccacd427ffede54ffeef74429c90335",
      "8548b1e5e5ceeb29042522c9679319b20214a483f49bb059ad203f32c4ebc27c",
      "12b4a8281cd7b0ff60db51cbdca8012c4ebd459f07f14301588fde5703dbc6d9",
      "7301f3ba7598ff5a12069e9243e21799c7a6616f4f8efc1b13acecf62fff990e",
      "f4b7bb20e97dcadfbf3dd921f3c762659c1f4f8271fea15290adbaaa22d85f99",
      "4e0cd1848160a1209f7de80141d1dcd400ee5aa625a22942a8f6b5a95d5a1e6b",
      "871434bf1c688a29f8d0e437ccfd2f213b5ca360df267215fad0642d07eac7f5",
    ],
  );
});
