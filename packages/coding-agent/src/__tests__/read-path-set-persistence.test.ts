import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckpointConflictError, createMemoryCheckpointStore } from "@arnilo/prism";
import { createReadPathSet, createReadPathSetPersistence, READ_PATH_SET_NAMESPACE } from "../read-path-set.js";

test("read-path persistence: save then restore into a fresh set (plan 015 Task 4)", async () => {
  const checkpoints = createMemoryCheckpointStore();
  const persistence = createReadPathSetPersistence({ checkpoints, key: "session-1" });
  const readPaths = createReadPathSet();
  readPaths.add("/abs/a.ts");
  readPaths.add("/abs/b.ts");
  await persistence.save(readPaths);

  const fresh = createReadPathSet();
  const restored = await persistence.restore(fresh);
  assert.equal(restored, 2);
  assert.deepEqual([...fresh.list()].sort(), ["/abs/a.ts", "/abs/b.ts"]);
  // Save is CAS read-modify-write: same payload bumps the version, then restore still works.
  await persistence.save(fresh);
  const again = createReadPathSet();
  assert.equal(await persistence.restore(again), 2);
  // Record is ownership-scoped and namespaced.
  const record = await checkpoints.loadCheckpoint({ namespace: READ_PATH_SET_NAMESPACE, key: "session-1" });
  assert.deepEqual(record!.value, ["/abs/a.ts", "/abs/b.ts"]);
});

test("read-path persistence: restore under a different ownership scope fails closed (plan 015 Task 4)", async () => {
  const checkpoints = createMemoryCheckpointStore();
  const persistence = createReadPathSetPersistence({
    checkpoints,
    key: "session-1",
    ownership: { tenantId: "tenant-a", userId: "user-1" },
  });
  const readPaths = createReadPathSet();
  readPaths.add("/abs/a.ts");
  await persistence.save(readPaths);

  const other = createReadPathSetPersistence({
    checkpoints,
    key: "session-1",
    ownership: { tenantId: "tenant-b", userId: "user-1" },
  });
  await assert.rejects(other.restore(createReadPathSet()), CheckpointConflictError, "cross-tenant restore must not leak state");
});

test("read-path persistence: bounds overflow fails closed with no partial write (plan 015 Task 4)", async () => {
  const checkpoints = createMemoryCheckpointStore();
  const persistence = createReadPathSetPersistence({ checkpoints, key: "session-1", maxPaths: 2, maxPathChars: 8 });

  const tooMany = createReadPathSet();
  tooMany.add("/a");
  tooMany.add("/b");
  tooMany.add("/c");
  await assert.rejects(persistence.save(tooMany), /exceeds 2 persisted paths/);
  assert.equal((await checkpoints.listCheckpoints()).items.length, 0, "no partial write on overflow");

  const tooLong = createReadPathSet();
  tooLong.add("/a/very/long/path");
  await assert.rejects(persistence.save(tooLong), /exceeds 8 chars/);
  assert.equal((await checkpoints.listCheckpoints()).items.length, 0);

  // Malformed persisted payload is refused on restore.
  const store = createMemoryCheckpointStore();
  await store.saveCheckpoint({ namespace: READ_PATH_SET_NAMESPACE, key: "session-1", version: 1, value: "not-an-array" });
  const bad = createReadPathSetPersistence({ checkpoints: store, key: "session-1" });
  await assert.rejects(bad.restore(createReadPathSet()), /malformed or exceeds bounds/);
  assert.equal(
    await createReadPathSetPersistence({ checkpoints: store, key: "missing" }).restore(createReadPathSet()),
    0,
    "missing record restores nothing",
  );
});
