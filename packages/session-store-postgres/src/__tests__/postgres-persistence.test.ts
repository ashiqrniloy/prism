import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertAdapterSchemaMatchesModel,
  createPersistenceSchemaModel,
} from "@arnilo/prism/testing/persistence-schema";
import { ADAPTER_INDEX_NAMES, ADAPTER_TABLE_NAMES, buildMigration001Ddl, buildMigration002Ddl, buildMigration003Ddl, buildMigration004Ddl } from "../ddl.js";
import {
  MIGRATION_LOCK_NAMESPACE,
  quoteIdentifier,
  schemaAdvisoryLockKey,
  validateIdentifier,
} from "../identifiers.js";

describe("postgres identifiers", () => {
  it("accepts safe schema names and rejects injection-like identifiers", () => {
    assert.doesNotThrow(() => validateIdentifier("prism"));
    assert.doesNotThrow(() => validateIdentifier("prism_test_1"));
    assert.throws(() => validateIdentifier("prism;drop"), /Invalid PostgreSQL identifier/);
    assert.throws(() => validateIdentifier(`prism"`), /Invalid PostgreSQL identifier/);
    assert.throws(() => validateIdentifier(""), /Invalid PostgreSQL identifier/);
  });

  it("quotes validated identifiers without escaping user content into SQL text", () => {
    assert.equal(quoteIdentifier("prism"), '"prism"');
    assert.throws(() => quoteIdentifier(`prism"`), /Invalid PostgreSQL identifier/);
  });

  it("derives stable advisory-lock keys per schema", () => {
    const first = schemaAdvisoryLockKey("prism");
    const second = schemaAdvisoryLockKey("prism");
    const other = schemaAdvisoryLockKey("prism_alt");
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.equal(typeof first, "number");
    assert.equal(MIGRATION_LOCK_NAMESPACE, 0x70726973);
  });
});

describe("postgres ddl", () => {
  it("declares every adapter table and index from the shared schema model", () => {
    const ddl = buildMigration001Ddl("prism") + buildMigration002Ddl("prism") + buildMigration003Ddl("prism") + buildMigration004Ddl("prism");
    for (const table of ADAPTER_TABLE_NAMES) {
      assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS "prism"."${table}"`, "m"));
    }
    for (const index of ADAPTER_INDEX_NAMES) {
      assert.match(ddl, new RegExp(`CREATE (UNIQUE )?INDEX IF NOT EXISTS ${index}`, "m"));
    }
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS "prism"\."prism_session_search"/);
    assert.match(ddl, /prism_sessions_updated_id_idx/);
    assertAdapterSchemaMatchesModel([...ADAPTER_TABLE_NAMES], [...ADAPTER_INDEX_NAMES], createPersistenceSchemaModel());
  });

  it("creates the schema before tables", () => {
    const ddl = buildMigration001Ddl("prism_custom");
    assert.match(ddl, /CREATE SCHEMA IF NOT EXISTS "prism_custom"/);
    const schemaPos = ddl.indexOf('CREATE SCHEMA IF NOT EXISTS "prism_custom"');
    const tablePos = ddl.indexOf('CREATE TABLE IF NOT EXISTS "prism_custom"."prism_tenants"');
    assert.ok(schemaPos >= 0 && tablePos > schemaPos);
  });
});

describe("postgres integration helpers", () => {
  it("builds unique per-run schema names for isolated live tests", () => {
    const schema = `prism_t_${randomUUID().replace(/-/g, "")}`;
    assert.doesNotThrow(() => validateIdentifier(schema));
  });
});
