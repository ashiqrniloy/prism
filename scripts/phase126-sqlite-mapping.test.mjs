import assert from "node:assert/strict";
import { test } from "bun:test";
import { Database } from "bun:sqlite";

// Locks docs/_evidence/phase126-bun-sqlite.md. Fails if bun:sqlite diverges from the recorded row.

test("blob read is Uint8Array, not Buffer", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t(b BLOB)");
  db.prepare("INSERT INTO t(b) VALUES (?)").run(Buffer.from([1, 2, 255]));
  const row = db.prepare("SELECT b FROM t").get();
  assert.equal(Buffer.isBuffer(row.b), false);
  assert.ok(row.b instanceof Uint8Array);
  assert.deepEqual([...row.b], [1, 2, 255]);
  db.close();
});

test("default lastInsertRowid is number; safeIntegers makes bigint", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const ran = db.prepare("INSERT INTO t(v) VALUES (?)").run("a");
  assert.equal(typeof ran.lastInsertRowid, "number");
  assert.equal(ran.lastInsertRowid, 1);
  db.exec("CREATE TABLE n(v INTEGER)");
  db.prepare("INSERT INTO n(v) VALUES (?)").run(9007199254740993n);
  assert.equal(db.prepare("SELECT v FROM n").get().v, 9007199254740992);
  db.close();

  const safe = new Database(":memory:", { safeIntegers: true });
  safe.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  assert.equal(typeof safe.prepare("INSERT INTO t(v) VALUES (?)").run("a").lastInsertRowid, "bigint");
  safe.close();
});

test("undefined positional bind stores NULL", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t(v TEXT)");
  db.prepare("INSERT INTO t(v) VALUES (?)").run(undefined);
  assert.equal(db.prepare("SELECT v, typeof(v) AS t FROM t").get().t, "null");
  db.close();
});

test("get() miss is null, not undefined", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t(id INTEGER)");
  assert.equal(db.prepare("SELECT id FROM t WHERE id = ?").get(1), null);
  db.close();
});
