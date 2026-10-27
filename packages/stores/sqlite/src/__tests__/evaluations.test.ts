import { test } from "bun:test";
import { evaluationStoreConformance } from "@arnilo/prism-store-codecs";
import { createSqlitePersistence } from "../persistence.js";

test("sqlite_evaluation_store_conformance", async () => {
  const store = createSqlitePersistence({ filename: ":memory:" });
  try {
    await evaluationStoreConformance(() => store);
  } finally {
    store.close();
  }
});

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { createSecretRedactor } from "@arnilo/prism";
import { applySqliteMigrations } from "../migrations.js";

test("migration_upgrades_existing_database_and_reopens_evaluations", async () => {
  const db = new Database(":memory:");
  applySqliteMigrations(db);
  db.exec("DROP TABLE prism_evaluations; DROP TABLE prism_experiment_reports; DELETE FROM prism_migrations WHERE name = '011_evaluations'");
  db.exec("INSERT INTO prism_sessions (id, created_at, updated_at) VALUES ('old', '2026-01-01', '2026-01-01')");
  const history = db.prepare("SELECT name, checksum FROM prism_migrations ORDER BY version").all();
  const store = createSqlitePersistence({ database: db, filename: ":memory:", evaluationRedactor: createSecretRedactor(["eval-secret"]) });
  await store.evaluations.append({
    id: "eval",
    scorerId: "quality",
    status: "scored",
    score: 1,
    sampled: true,
    sessionId: "old",
    reason: "eval-secret",
    metadata: { text: "eval-secret" },
    createdAt: "2026-10-27T00:00:00Z",
  });
  const reopened = createSqlitePersistence({ database: db, filename: ":memory:" });
  assert.ok(db.prepare("SELECT id FROM prism_sessions WHERE id = 'old'").get());
  assert.deepEqual(
    db.prepare("SELECT name, checksum FROM prism_migrations WHERE name != '011_evaluations' ORDER BY version").all(),
    history,
  );
  assert.equal((await reopened.evaluations.query()).items.length, 1);
  assert.ok(!JSON.stringify(db.prepare("SELECT record FROM prism_evaluations").get()).includes("eval-secret"));
  db.exec("INSERT INTO prism_session_entries (id, session_id, timestamp, kind) VALUES ('entry', 'old', '2026-01-01', 'label')");
  assert.equal(await reopened.deleteSession("old"), true);
  assert.deepEqual((await reopened.evaluations.query()).items, []);
  db.close();
});
