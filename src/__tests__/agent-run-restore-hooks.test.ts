import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CheckpointRestoreError,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  runCheckpointRestoreHooks,
  toolCallContent,
} from "../index.js";

/** Suspends on the first tool call, then finishes on resume (same harness as agent-run-lifecycle.test.ts). */
function createSuspendingAgent(id: string) {
  return createAgent({
    id,
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: (() => {
      let turn = 0;
      return {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-restore", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      };
    })(),
    tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-restore", name: "write", value: 1 }) }],
  });
}

/** Session suspended mid-run with a pinned sidecar map, ready to resume. */
async function suspend(id: string, checkpointMetadata: Record<string, string> = { gitCommit: "commit-1" }) {
  const checkpoints = createMemoryCheckpointStore();
  const agent = createSuspendingAgent(id);
  const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
  const run = await agent.createSession({ id: `${id}-session` }).run("go", {
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, checkpointMetadata },
  });
  assert.equal(run.status, "suspended");
  const ref = { runId: run.runId, sessionId: run.sessionId };
  const status = await lifecycle.status(ref, { agentId: id });
  return { checkpoints, lifecycle, ref, status };
}

describe("checkpoint restore hooks", () => {
  it("runs hooks sequentially with the recorded metadata, then restores the conversation", async () => {
    const { lifecycle, ref, status } = await suspend("restore-ok");
    const calls: string[] = [];
    const seen: unknown[] = [];
    const events = [];
    const stream = lifecycle.resumeStream(
      ref,
      { decision: "approve", expectedVersion: status.version },
      {
        agentId: "restore-ok",
        restoreHooks: [
          async function restoreGit(checkpoint) {
            seen.push(checkpoint);
            await new Promise((resolve) => setTimeout(resolve, 5));
            calls.push("git");
          },
          function restoreDocs() {
            calls.push("docs");
          },
        ],
      },
    );
    for await (const event of stream) events.push(event);

    assert.deepEqual(calls, ["git", "docs"]);
    assert.equal(seen.length, 1);
    const context = seen[0] as { runId: string; status: string; version: number; metadata?: Record<string, string> };
    assert.equal(context.runId, ref.runId);
    assert.equal(context.status, "suspended");
    assert.equal(context.version, status.version);
    assert.deepEqual(context.metadata, { gitCommit: "commit-1" });

    const resumed = events.find((event) => event.type === "agent_resumed");
    assert.ok(resumed && resumed.type === "agent_resumed");
    assert.deepEqual(
      resumed.restore?.hooks.map((entry) => entry.hook),
      ["restoreGit", "restoreDocs"],
    );
    assert.ok((resumed.restore?.hooks[1]?.durationMs ?? -1) >= 0);
    assert.equal((await lifecycle.status(ref, { agentId: "restore-ok" })).state.status, "succeeded");
  });

  it("aborts before the claim when a hook fails, naming the hook and leaving the run resumable", async () => {
    const { checkpoints, lifecycle, ref, status } = await suspend("restore-fail");
    const calls: string[] = [];
    const boom = new Error("git reset exploded");

    await assert.rejects(
      lifecycle.resume(
        ref,
        { decision: "approve", expectedVersion: status.version },
        {
          agentId: "restore-fail",
          restoreHooks: [
            function restoreGit() {
              calls.push("git");
            },
            function restoreDocs() {
              throw boom;
            },
            function neverRuns() {
              calls.push("never");
            },
          ],
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CheckpointRestoreError);
        assert.equal(error.code, "ERR_PRISM_CHECKPOINT_RESTORE");
        assert.equal(error.hook, "restoreDocs");
        assert.equal(error.cause, boom);
        assert.match(error.message, /restoreDocs failed: git reset exploded/);
        // Plan 109 Task 2: with no compensate anywhere the failure shape is exactly plan 094's.
        assert.equal(error.compensation, undefined);
        assert.deepEqual(Object.keys(error).sort(), ["code", "hook", "name"]);
        return true;
      },
    );

    // All-or-nothing: the later hook never ran and the checkpoint was never claimed.
    assert.deepEqual(calls, ["git"]);
    const after = await lifecycle.status(ref, { agentId: "restore-fail" });
    assert.equal(after.state.status, "suspended");
    assert.equal(after.version, status.version);
    assert.deepEqual((await loadAgentRunState(checkpoints, ref)).record.metadata, { gitCommit: "commit-1" });

    // The failed restore left a working checkpoint: a clean resume still succeeds.
    await lifecycle.resume(ref, { decision: "approve", expectedVersion: after.version }, { agentId: "restore-fail" });
    assert.equal((await lifecycle.status(ref, { agentId: "restore-fail" })).state.status, "succeeded");
  });

  it("treats a hook that overruns its timeout as a failure and aborts its signal", async () => {
    const { lifecycle, ref, status } = await suspend("restore-timeout");
    let aborted = false;
    await assert.rejects(
      lifecycle.resume(
        ref,
        { decision: "approve", expectedVersion: status.version },
        {
          agentId: "restore-timeout",
          restoreHookTimeoutMs: 20,
          restoreHooks: [
            function slowRestore(_checkpoint, signal) {
              return new Promise<void>((_resolve, reject) => {
                signal.addEventListener("abort", () => {
                  aborted = true;
                  reject(new Error("hook saw the timeout"));
                });
              });
            },
          ],
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CheckpointRestoreError);
        assert.equal(error.hook, "slowRestore");
        assert.match(error.message, /timed out after 20ms/);
        return true;
      },
    );
    assert.equal(aborted, true);
    assert.equal((await lifecycle.status(ref, { agentId: "restore-timeout" })).state.status, "suspended");
  });

  it("skips hooks on deny and reports no restore audit when none are registered", async () => {
    const denied = await suspend("restore-deny");
    let deniedHooks = 0;
    const result = await denied.lifecycle.resume(
      denied.ref,
      { decision: "deny", expectedVersion: denied.status.version },
      {
        agentId: "restore-deny",
        restoreHooks: [
          function hookOnDeny() {
            deniedHooks += 1;
          },
        ],
      },
    );
    assert.equal(result.status, "denied");
    assert.equal(deniedHooks, 0);

    const plain = await suspend("restore-none");
    const events = [];
    for await (const event of plain.lifecycle.resumeStream(
      plain.ref,
      { decision: "approve", expectedVersion: plain.status.version },
      {
        agentId: "restore-none",
      },
    ))
      events.push(event);
    const resumed = events.find((event) => event.type === "agent_resumed");
    assert.ok(resumed && resumed.type === "agent_resumed");
    assert.equal(resumed.restore, undefined);
  });

  it("fails closed on a hook that rejects without a timeout, keeping lifecycle-registered hooks ordered first", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createSuspendingAgent("restore-lifecycle-hooks");
    const order: string[] = [];
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
      restoreHooks: [
        function lifecycleHook() {
          order.push("lifecycle");
        },
      ],
    });
    const run = await agent.createSession({ id: "restore-lifecycle-hooks-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const ref = { runId: run.runId, sessionId: run.sessionId };
    const status = await lifecycle.status(ref, { agentId: "restore-lifecycle-hooks" });
    await assert.rejects(
      lifecycle.resume(
        ref,
        { decision: "approve", expectedVersion: status.version },
        {
          agentId: "restore-lifecycle-hooks",
          restoreHooks: [
            function requestHook() {
              order.push("request");
              throw new Error("layer down");
            },
          ],
        },
      ),
      (error: unknown) => error instanceof CheckpointRestoreError && error.hook === "requestHook",
    );
    assert.deepEqual(order, ["lifecycle", "request"]);
  });

  it("compensates the applied layers in reverse when a later hook fails, failing hook first", async () => {
    const { checkpoints, lifecycle, ref, status } = await suspend("restore-compensate");
    const layer = { docs: "v1", git: "c1" };
    const compensateOrder: string[] = [];
    await assert.rejects(
      lifecycle.resume(
        ref,
        { decision: "approve", expectedVersion: status.version },
        {
          agentId: "restore-compensate",
          restoreHooks: [
            {
              id: "docs",
              restore: () => {
                layer.docs = "v2";
              },
              compensate: () => {
                compensateOrder.push("docs");
                layer.docs = "v1";
              },
            },
            {
              id: "git",
              // Half-applied: the layer moved, then the restore failed.
              restore: () => {
                layer.git = "c2";
                throw new Error("git unreachable");
              },
              compensate: () => {
                compensateOrder.push("git");
                layer.git = "c1";
              },
            },
            {
              id: "workspace",
              restore: () => {
                throw new Error("later hook never runs");
              },
              compensate: () => {
                compensateOrder.push("workspace");
              },
            },
          ],
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CheckpointRestoreError);
        assert.equal(error.hook, "git");
        assert.equal(error.cause instanceof Error && error.cause.message, "git unreachable");
        assert.deepEqual(error.compensation?.ran, ["git", "docs"]);
        assert.equal(error.compensation?.failed, undefined);
        return true;
      },
    );
    assert.deepEqual(layer, { docs: "v1", git: "c1" });
    assert.deepEqual(compensateOrder, ["git", "docs"]);
    // Best-effort: the checkpoint was never claimed, and a fixed resume still works.
    const after = await lifecycle.status(ref, { agentId: "restore-compensate" });
    assert.equal(after.state.status, "suspended");
    assert.equal(after.version, status.version);
    assert.deepEqual((await loadAgentRunState(checkpoints, ref)).record.metadata, { gitCommit: "commit-1" });
    await lifecycle.resume(ref, { decision: "approve", expectedVersion: after.version }, { agentId: "restore-compensate" });
    assert.equal((await lifecycle.status(ref, { agentId: "restore-compensate" })).state.status, "succeeded");
  });

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

  it("leaves compensation untouched on a successful resume", async () => {
    const { lifecycle, ref, status } = await suspend("restore-compensate-ok");
    const calls: string[] = [];
    const resumed = await lifecycle.resume(
      ref,
      { decision: "approve", expectedVersion: status.version },
      {
        agentId: "restore-compensate-ok",
        restoreHooks: [
          {
            id: "docs",
            restore: () => {
              calls.push("docs");
            },
            compensate: () => {
              calls.push("docs:compensate");
            },
          },
          {
            id: "git",
            restore: () => {
              calls.push("git");
            },
            compensate: () => {
              calls.push("git:compensate");
            },
          },
          {
            id: "workspace",
            restore: () => {
              calls.push("workspace");
            },
            compensate: () => {
              calls.push("workspace:compensate");
            },
          },
        ],
      },
    );
    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(calls, ["docs", "git", "workspace"]);
  });
});
