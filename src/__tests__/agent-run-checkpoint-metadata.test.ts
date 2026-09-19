import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundCheckpointMetadata,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createSecretRedactor,
  loadAgentRunState,
  MAX_AGENT_RUN_METADATA_BYTES,
  providerDone,
  providerTextDelta,
  readCheckpointMetadata,
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
            yield { type: "tool_call" as const, call: toolCallContent("call-metadata", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      };
    })(),
    tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-metadata", name: "write", value: 1 }) }],
  });
}

describe("agent checkpoint sidecar metadata", () => {
  it("bounds, redacts, and reads the map defensively", () => {
    assert.deepEqual(boundCheckpointMetadata({ gitCommit: "abc123" }), { gitCommit: "abc123" });
    assert.deepEqual(boundCheckpointMetadata({ token: "hunter2" }, createSecretRedactor(["hunter2"])).token === "hunter2", false);
    assert.throws(() => boundCheckpointMetadata({ bad: 42 as unknown as string }), /must be a string/);
    assert.throws(
      () => boundCheckpointMetadata({ big: "x".repeat(MAX_AGENT_RUN_METADATA_BYTES) }),
      new RegExp(`exceeds ${MAX_AGENT_RUN_METADATA_BYTES} bytes`),
    );
    // Legacy tolerance: absent, empty, oversize, and non-string entries read as absent/dropped.
    assert.equal(readCheckpointMetadata(undefined), undefined);
    assert.equal(readCheckpointMetadata({}), undefined);
    assert.deepEqual(readCheckpointMetadata({ gitCommit: "abc123", bad: 42 }), { gitCommit: "abc123" });
    assert.equal(readCheckpointMetadata({ big: "x".repeat(MAX_AGENT_RUN_METADATA_BYTES) }), undefined);
  });

  it("pins metadata on the record, preserves it across resume, and serves it from status", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createSuspendingAgent("checkpoint-metadata-demo");
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
    let head = "commit-1";
    const suspended = await agent.createSession({ id: "checkpoint-metadata-session" }).run("go", {
      runState: {
        checkpoints,
        definitionRevision: "1",
        interruptBeforeTool: true,
        // Provider is resolved per write: the map tracks the host's live state.
        checkpointMetadata: () => ({ gitCommit: head, docVersion: "v12" }),
      },
    });
    assert.equal(suspended.status, "suspended");
    head = "commit-2";

    const stored = await loadAgentRunState(checkpoints, { runId: suspended.runId, sessionId: suspended.sessionId });
    assert.deepEqual(stored.record.metadata, { gitCommit: "commit-1", docVersion: "v12" });
    assert.equal("metadata" in (stored.record.value as object), false, "metadata must be record sidecar, not state");

    const before = await lifecycle.status(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { agentId: "checkpoint-metadata-demo" },
    );
    assert.deepEqual(before.metadata, { gitCommit: "commit-1", docVersion: "v12" });

    // Resume with no source: the claim and terminal writes preserve the recorded map.
    await lifecycle.resume(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: before.version },
      { agentId: "checkpoint-metadata-demo" },
    );
    const after = await lifecycle.status(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { agentId: "checkpoint-metadata-demo" },
    );
    assert.equal(after.state.status, "succeeded");
    assert.deepEqual(after.metadata, { gitCommit: "commit-1", docVersion: "v12" });
  });

  it("leaves records without metadata readable (legacy shape)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createSuspendingAgent("checkpoint-metadata-legacy");
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
    const suspended = await agent.createSession({ id: "checkpoint-metadata-legacy-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const status = await lifecycle.status(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { agentId: "checkpoint-metadata-legacy" },
    );
    assert.equal(status.metadata, undefined);
  });
});
