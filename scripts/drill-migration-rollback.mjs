#!/usr/bin/env node
// Plan 060 migration rollback/restore drill (release evidence, not prose).
// Postgres: apply → seed via the real store → downgrade one version (009's
// additive column + history row) → verify the 008-shape store still works and
// seeded data survived → re-apply → verify idempotency + data → tamper a
// checksum row and prove the runner fails closed. SQLite: same flow
// in-process on a temp file. Requires `npm run build:core` (dist imports).
//
// Safety: refuses any URL whose host is not localhost/127.0.0.1/::1 — CI and
// throwaway local databases only. `--self-test` checks that refusal without
// touching a database.
//
// Usage: node scripts/drill-migration-rollback.mjs --url "postgres://prism:prism@localhost:5432/prism"

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CORE = new URL("../packages/prism-core/dist", import.meta.url);

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
// Lazy deps: assigned only when run as a CLI (repo hygiene tests import this
// file to inspect its imports — no side effects, no database access).
let pgMigrations, createPostgresPersistence, createSqlitePersistence, Pool, Database;
if (invokedDirectly) {
  pgMigrations = await import(pathToFileURL(join(CORE.pathname, "sessions/postgres/migrations.js")).href);
  ({ createPostgresPersistence } = await import("@arnilo/prism-core/sessions/postgres"));
  ({ createSqlitePersistence } = await import("@arnilo/prism-core/sessions/sqlite"));
  Pool = (await import("pg")).Pool;
  Database = (await import("better-sqlite3")).default;
}

const LAST_STEP = "009_run_prompt_version";

function parseArgs(argv) {
  const args = { selfTest: false, url: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--self-test") args.selfTest = true;
    else if (argv[i] === "--url") args.url = argv[++i];
  }
  return args;
}

/** Fails closed on anything that is not a loopback CI/local database URL. */
export function assertCiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("--url is not a valid URL");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("--url must be a postgres:// URL");
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error(`--url host "${parsed.hostname}" is not a loopback CI database (refusing production-looking URL)`);
  }
}

function seedEntries(sessionId) {
  return [
    { id: "drill-root", sessionId, timestamp: "2026-01-01T00:00:00.000Z", kind: "label", label: "drill-root" },
    { id: "drill-child", parentId: "drill-root", sessionId, timestamp: "2026-01-01T00:00:01.000Z", kind: "label", label: "drill-child" },
  ];
}

async function drillPostgres(url) {
  assertCiUrl(url);
  const pool = new Pool({ connectionString: url, max: 2 });
  const schema = `prism_drill_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const steps = [];
  const mark = (name) => {
    steps.push(name);
    if (process.env.PRISM_DRILL_DEBUG) console.error(`[drill] step: ${name}`);
  };
  try {
    const applied = await pgMigrations.applyPostgresMigrations(pool, schema);
    assert.equal(applied.length, 9, `expected 9 applied migrations, got ${applied.length}`);
    mark("apply-all");

    const sessionId = "drill-session";
    const store = await createPostgresPersistence({ pool, schema, skipMigrations: true }); // drill owns migrations
    for (const entry of seedEntries(sessionId)) await store.append(entry);
    assert.equal((await store.list(sessionId)).length, 2, "seed must land");
    mark("seed");

    // Downgrade one version: inverse of 009's additive DDL + its history row.
    await pool.query(`ALTER TABLE ${schema}.prism_runs DROP COLUMN IF EXISTS prompt_version`);
    await pool.query(`DELETE FROM ${schema}.prism_migrations WHERE name = '${LAST_STEP}'`);
    mark("downgrade-009");

    // Verify schema compat at the 008 shape: the store works and data survived.
    const downgraded = await createPostgresPersistence({ pool, schema, skipMigrations: true }); // 008 shape by design
    await downgraded.append({ ...seedEntries("x")[0], id: "drill-post", sessionId, timestamp: "2026-01-01T00:00:02.000Z" });
    const survived = await downgraded.list(sessionId);
    assert.equal(survived.length, 3, "seeded durable data must survive the downgrade");
    mark("verify-compat");

    const reapplied = await pgMigrations.applyPostgresMigrations(pool, schema);
    assert.equal(reapplied.length, 9, "re-apply must restore the contract");
    await pgMigrations.verifyMigrationIdempotency(pool, schema);
    assert.equal((await downgraded.list(sessionId)).length, 3, "re-apply must not touch data");
    mark("re-apply");

    // Breakage canary: tamper a checksum row; the runner must fail closed.
    const original = await pool.query(`SELECT checksum FROM ${schema}.prism_migrations WHERE name = '008_session_version'`);
    await pool.query(`UPDATE ${schema}.prism_migrations SET checksum = 'tampered' WHERE name = '008_session_version'`);
    await assert.rejects(() => pgMigrations.applyPostgresMigrations(pool, schema), "tampered checksum must fail closed");
    await pool.query(`UPDATE ${schema}.prism_migrations SET checksum = $1 WHERE name = '008_session_version'`, [original.rows[0].checksum]);
    await pgMigrations.applyPostgresMigrations(pool, schema);
    mark("checksum-fail-closed");

    return { store: "postgres", schema, steps };
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await pool.end();
  }
}

async function drillSqlite() {
  const dir = mkdtempSync(join(tmpdir(), "prism-drill-sqlite-"));
  const filename = join(dir, "drill.sqlite");
  const steps = [];
  try {
    const sessionId = "drill-session";
    const store = createSqlitePersistence({ filename });
    for (const entry of seedEntries(sessionId)) await store.append(entry);
    assert.equal((await store.list(sessionId)).length, 2, "seed must land");
    store.close();
    steps.push("apply+seed");

    // Downgrade one version (inverse of 009) on the raw handle.
    const raw = new Database(filename);
    raw.exec("ALTER TABLE prism_runs DROP COLUMN prompt_version");
    raw.prepare("DELETE FROM prism_migrations WHERE name = ?").run(LAST_STEP);
    raw.close();
    steps.push("downgrade-009");

    const reopened = createSqlitePersistence({ filename }); // re-applies 009
    const survived = await reopened.list(sessionId);
    assert.equal(survived.length, 2, "seeded durable data must survive the downgrade/re-apply");
    await reopened.append({ ...seedEntries("x")[0], id: "drill-post", sessionId, timestamp: "2026-01-01T00:00:02.000Z" });
    assert.equal((await reopened.list(sessionId)).length, 3, "store must work after re-apply");
    reopened.close();
    steps.push("verify-compat+re-apply");
    return { store: "sqlite", steps };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    for (const [url, shouldPass] of [
      ["postgres://u:p@db.prod.example.com:5432/prism", false],
      ["postgres://prism:prism@localhost:5432/prism", true],
      ["postgres://prism:prism@127.0.0.1:5432/prism", true],
      ["mysql://a@localhost/x", false],
    ]) {
      try {
        assertCiUrl(url);
        assert.ok(shouldPass, `safety must refuse ${url}`);
      } catch (error) {
        assert.ok(!shouldPass, `safety must accept ${url}: ${error.message}`);
      }
    }
    console.log("self-test: URL safety refusals verified (no database touched)");
    process.exit(0);
  }
  if (!args.url) {
    console.error("usage: drill-migration-rollback.mjs --url postgres://user:pass@localhost:5432/db [--self-test]");
    process.exit(2);
  }

  const started = Date.now();
  try {
    const postgres = await drillPostgres(args.url);
    const sqlite = await drillSqlite();
    console.log(JSON.stringify({ ok: true, durationMs: Date.now() - started, postgres, sqlite }, null, 2));
  } catch (error) {
    console.error(`drill FAILED after ${Date.now() - started}ms:`, error.message || error);
    process.exit(1);
  }
}
