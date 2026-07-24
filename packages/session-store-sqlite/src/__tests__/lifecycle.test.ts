import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { PersistenceLifecycleError } from "@arnilo/prism";
import { createSqlitePersistence } from "../index.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("sqlite persistence lifecycle", () => {
  it("hold blocks retention delete; quota exhausts fail-closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-life-"));
    dirs.push(dir);
    const filename = join(dir, "db.sqlite");
    const store = createSqlitePersistence({ filename });
    try {
      const ownership = { tenantId: "t1", userId: "u1" };
      const now = new Date().toISOString();
      const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const db = new Database(filename);
      db.prepare(
        `INSERT INTO prism_sessions (id, tenant_id, user_id, created_at, updated_at) VALUES
         ('s-held', 't1', 'u1', ?, ?),
         ('s-free', 't1', 'u1', ?, ?)`,
      ).run(old, now, old, now);
      db.close();

      await store.lifecycle.putLegalHold({
        ...ownership,
        resourceKind: "session",
        resourceId: "s-held",
        reason: "hold",
      });
      const result = await store.lifecycle.applyRetention({
        ...ownership,
        policy: { id: "p", createdAt: now, maxAgeDays: 1 },
        candidates: ["s-held", "s-free"],
      });
      assert.deepEqual(result.skippedHeld, ["s-held"]);
      assert.deepEqual(result.deleted, ["s-free"]);

      await store.lifecycle.setTenantQuota({ ...ownership, resourceKind: "run", limit: 1 });
      await store.lifecycle.consumeTenantQuota({ ...ownership, resourceKind: "run" });
      await assert.rejects(
        () => store.lifecycle.consumeTenantQuota({ ...ownership, resourceKind: "run" }),
        (error: unknown) => error instanceof PersistenceLifecycleError && error.code === "ERR_PRISM_LIFECYCLE_QUOTA_EXHAUSTED",
      );
    } finally {
      store.close();
    }
  });
});
