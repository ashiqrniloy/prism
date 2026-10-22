import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { CheckpointRestoreError, runCheckpointRestoreHooks } from "../checkpoint-restore.js";

/**
 * Direct coverage of the checkpoint restore-hook runner. The durable-resume integration that used to
 * live here went with the run-state surface (plan 168 Task 5); `runCheckpointRestoreHooks` itself stays
 * the shared executor for hosts and the ported workflows package.
 */
describe("checkpoint restore hooks", () => {
  it("records a failing compensation without masking the original error and keeps the pass going", async () => {
    const calls: string[] = [];
    await assert.rejects(
      runCheckpointRestoreHooks(
        [
          {
            id: "docs",
            restore: () => {
              calls.push("docs:restore");
            },
            compensate: () => {
              calls.push("docs:compensate");
              throw new Error("docs undo failed");
            },
          },
          {
            id: "git",
            restore: () => {
              calls.push("git:restore");
              throw new Error("git restore failed");
            },
            compensate: () => {
              calls.push("git:compensate");
            },
          },
        ],
        { runId: "run-compensate-failure" },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CheckpointRestoreError);
        assert.equal(error.hook, "git");
        assert.equal(error.cause instanceof Error && error.cause.message, "git restore failed");
        assert.deepEqual(error.compensation?.ran, ["git", "docs"]);
        assert.deepEqual(error.compensation?.failed, { hook: "docs", reason: "docs undo failed" });
        return true;
      },
    );
    assert.deepEqual(calls, ["docs:restore", "git:restore", "git:compensate", "docs:compensate"]);
  });

  it("compensates a hook that timed out under the same per-hook ceiling", async () => {
    const calls: string[] = [];
    await assert.rejects(
      runCheckpointRestoreHooks(
        [
          {
            id: "docs",
            restore: () => {
              calls.push("docs:restore");
            },
            compensate: () => {
              calls.push("docs:compensate");
            },
          },
          {
            id: "slow",
            restore: (_checkpoint, signal) =>
              new Promise<void>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("hook saw the timeout")));
              }),
            compensate: () => {
              calls.push("slow:compensate");
            },
          },
        ],
        { runId: "run-compensate-timeout" },
        { timeoutMs: 20 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CheckpointRestoreError);
        assert.equal(error.hook, "slow");
        assert.match(error.message, /timed out after 20ms/);
        assert.deepEqual(error.compensation?.ran, ["slow", "docs"]);
        return true;
      },
    );
    assert.deepEqual(calls, ["docs:restore", "slow:compensate", "docs:compensate"]);
  });

  it("stops compensation on a caller abort and rethrows the abort unchanged", async () => {
    const controller = new AbortController();
    const reason = new Error("host cancelled");
    const calls: string[] = [];
    await assert.rejects(
      runCheckpointRestoreHooks(
        [
          {
            id: "docs",
            restore: () => {
              calls.push("docs:restore");
            },
            compensate: () => {
              calls.push("docs:compensate");
            },
          },
          {
            id: "git",
            restore: () => {
              calls.push("git:restore");
              throw new Error("git restore failed");
            },
            compensate: () => {
              calls.push("git:compensate");
              controller.abort(reason);
            },
          },
        ],
        { runId: "run-compensate-abort" },
        { signal: controller.signal },
      ),
      (error: unknown) => error === reason,
    );
    // The abort stopped the pass before the earlier layer's undo could run.
    assert.deepEqual(calls, ["docs:restore", "git:restore", "git:compensate"]);
  });

  it("never runs compensation after a caller abort during the failing restore", async () => {
    const controller = new AbortController();
    const reason = new Error("host cancelled");
    const calls: string[] = [];
    await assert.rejects(
      runCheckpointRestoreHooks(
        [
          {
            id: "docs",
            restore: () => {
              calls.push("docs:restore");
            },
            compensate: () => {
              calls.push("docs:compensate");
            },
          },
          {
            id: "git",
            restore: () => {
              calls.push("git:restore");
              controller.abort(reason);
              throw new Error("git saw the abort");
            },
            compensate: () => {
              calls.push("git:compensate");
            },
          },
        ],
        { runId: "run-compensate-abort-restore" },
        { signal: controller.signal },
      ),
      (error: unknown) => {
        // The restore-path failure shape is unchanged; only compensation is skipped.
        assert.ok(error instanceof CheckpointRestoreError);
        assert.equal(error.hook, "git");
        assert.equal(Object.hasOwn(error, "compensation"), false);
        return true;
      },
    );
    assert.deepEqual(calls, ["docs:restore", "git:restore"]);
  });
});
