import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  applySqlitePromptMigrations,
  createMemoryPromptStore,
  createPostgresPromptStore,
  createSqlitePromptStore,
  PromptLimitError,
  PromptMigrationError,
  runPromptStoreConformance,
} from "../index.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDb(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "prism-prompts-"));
  tempDirs.push(directory);
  return join(directory, `${name}.db`);
}

describe("../index.js", () => {
  it("passes memory conformance", async () => {
    await runPromptStoreConformance(() => createMemoryPromptStore());
  });

  it("passes SQLite conformance and survives reopen", async () => {
    const filename = tempDb("prompts");
    await runPromptStoreConformance(() => createSqlitePromptStore({ filename }));
    const reopened = createSqlitePromptStore({ filename });
    assert.equal((await reopened.resolve({ tenantId: "prompt-tenant", userId: "prompt-user", name: "support-agent" }))?.version, 2);
    reopened.close();
  });

  it("passes PostgreSQL conformance in the protected integration profile", { skip: !process.env.PRISM_TEST_POSTGRES_URL }, async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.PRISM_TEST_POSTGRES_URL });
    const schema = `prism_prompts_test_${process.pid}_${Date.now()}`;
    try {
      const store = await createPostgresPromptStore({ pool, schema });
      await runPromptStoreConformance(() => store);
      await store.close();
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it("rejects prompt migration checksum drift", () => {
    const database = new Database(":memory:");
    applySqlitePromptMigrations(database);
    database.prepare("UPDATE prism_prompt_migrations SET checksum = ? WHERE name = ?").run("tampered", "001_init");
    assert.throws(() => applySqlitePromptMigrations(database), PromptMigrationError);
    database.close();
  });

  it("fails closed on body and diff limits", async () => {
    const store = createMemoryPromptStore({ limits: { maxBodyBytes: 4, maxDiffLines: 1 } });
    await assert.rejects(store.put({ name: "x", body: "12345" }), PromptLimitError);
    await store.put({ name: "x", body: "a" });
    await store.put({ name: "x", body: "b" });
    assert.equal((await store.diff("x", 1, 2)).truncated, true);
  });
});
