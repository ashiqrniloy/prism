import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { Pool } from "pg";
import { createEnterpriseStateCleanup } from "../cleanup.js";
import { decodeBoundedJson, encodeBoundedJson } from "../codecs.js";
import { ENTERPRISE_INDEX_NAMES, ENTERPRISE_TABLE_NAMES, buildEnterpriseMigration001Ddl } from "../ddl.js";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import {
  ENTERPRISE_MIGRATION_LOCK_NAMESPACE,
  qualifyTable,
  quoteIdentifier,
  schemaAdvisoryLockKey,
  validateIdentifier,
} from "../identifiers.js";
import { applyEnterpriseMigrations, assertEnterpriseMigrationHistory } from "../migrations.js";

const migrationChecksum = createHash("sha256").update(buildEnterpriseMigration001Ddl("prism"), "utf8").digest("hex");

describe("enterprise PostgreSQL package", () => {
  it("has inert public import and strict identifier/config validation", async () => {
    const loaded = await import("../index.js");
    assert.equal(loaded.packageName, "@arnilo/prism-enterprise-postgres");
    assert.doesNotThrow(() => validateIdentifier("prism_1"));
    assert.throws(() => validateIdentifier(`prism"; DROP SCHEMA prism; --`), EnterprisePostgresError);
    assert.equal(quoteIdentifier("prism"), '"prism"');
    assert.equal(qualifyTable("prism", "prism_work_idempotency"), '"prism"."prism_work_idempotency"');
    assert.equal(schemaAdvisoryLockKey("prism"), schemaAdvisoryLockKey("prism"));
    assert.equal(ENTERPRISE_MIGRATION_LOCK_NAMESPACE, 0x656e7472);
  });

  it("declares every fixed table/index and canonical migration checksum", () => {
    const ddl = buildEnterpriseMigration001Ddl("prism");
    for (const table of ENTERPRISE_TABLE_NAMES) {
      assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS "prism"\\."${table}"`));
    }
    for (const index of ENTERPRISE_INDEX_NAMES) assert.match(ddl, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
    assert.match(ddl, /CREATE SCHEMA IF NOT EXISTS "prism"/);
    assert.match(ddl, /account_key TEXT NOT NULL/);
    assert.match(ddl, /user_key TEXT NOT NULL/);
    assert.equal(migrationChecksum.length, 64);
    assert.throws(
      () => assertEnterpriseMigrationHistory([{ name: "001_enterprise_state", version: "1", checksum: "wrong" }]),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION",
    );
    assert.doesNotThrow(() =>
      assertEnterpriseMigrationHistory([{ name: "001_enterprise_state", version: "1", checksum: migrationChecksum }]),
    );
    assert.throws(() => assertEnterpriseMigrationHistory([{ name: "unknown", version: "1", checksum: migrationChecksum }]));
    assert.throws(() => assertEnterpriseMigrationHistory([{ name: "001_enterprise_state", version: "2", checksum: migrationChecksum }]));
    assert.throws(() =>
      assertEnterpriseMigrationHistory([
        { name: "001_enterprise_state", version: "1", checksum: migrationChecksum },
        { name: "x", version: "2", checksum: "x" },
      ]),
    );
  });

  it("rolls back and releases its checked-out migration client after DDL failure", async () => {
    const calls: string[] = [];
    let released = 0;
    const client = {
      query: async (text: string) => {
        calls.push(text);
        if (text.startsWith("\nCREATE SCHEMA")) throw new Error("injected DDL failure");
        return { rowCount: 0, rows: [] };
      },
      release: () => {
        released += 1;
      },
    };
    const pool = { connect: async () => client } as unknown as Pool;
    await assert.rejects(
      () => applyEnterpriseMigrations(pool, "prism"),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION",
    );
    assert.equal(calls[0], "BEGIN");
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.equal(released, 1);
  });

  it("bounds JSON codecs before storage and after decode", () => {
    assert.equal(encodeBoundedJson({ ok: true }, 32, "metadata"), '{"ok":true}');
    assert.deepEqual(decodeBoundedJson('{"ok":true}', 32, "metadata"), { ok: true });
    assert.throws(() => encodeBoundedJson({ secret: "x".repeat(64) }, 16, "metadata"), EnterprisePostgresError);
    assert.throws(() => decodeBoundedJson("{", 16, "metadata"), EnterprisePostgresError);
  });

  it("validates factory options before SQL and preserves caller pool ownership", async () => {
    let ended = 0;
    const pool = {
      end: async () => {
        ended += 1;
      },
    } as unknown as Pool;
    await assert.rejects(
      () => createPostgresEnterpriseState({ pool, connectionString: "postgres://example", skipMigrations: true }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG",
    );
    await assert.rejects(
      () => createPostgresEnterpriseState({ schema: "prism;drop", connectionString: "postgres://example", skipMigrations: true }),
      EnterprisePostgresError,
    );
    await assert.rejects(
      () => createPostgresEnterpriseState({ connectionString: "postgres://example", poolMax: 0, skipMigrations: true }),
      EnterprisePostgresError,
    );

    const state = await createPostgresEnterpriseState({ pool, schema: "prism_test", skipMigrations: true });
    await state.close();
    assert.equal(ended, 0);
    assert.equal(typeof state.policy.append, "function");
    assert.equal(typeof state.evaluations.query, "function");
    assert.equal(typeof state.modelRouter.consumeRate, "function");
    const owned = await createPostgresEnterpriseState({ connectionString: "postgres://127.0.0.1:1/prism", skipMigrations: true });
    await assert.doesNotReject(() => owned.close());
    await assert.doesNotReject(() => owned.close());
  });

  it("binds cleanup owner values and caps work without a global sweep", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Pool;
    const cleanup = createEnterpriseStateCleanup(pool, "prism");
    const tenantId = `tenant'; DROP TABLE prism_work_idempotency; --`;
    await cleanup({ tenantId, userId: "user", principalId: "agent", limit: 1 });
    assert.equal(queries.length, 6);
    for (const query of queries) {
      assert.equal(query.text.includes(tenantId), false);
      assert.equal(query.values[0], tenantId);
      assert.match(query.text, /"prism"\."prism_/);
    }
    await assert.rejects(
      () => cleanup({ tenantId: "tenant", principalId: "agent", limit: 501 }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS",
    );
  });
});
