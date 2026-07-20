import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createBatchedRunLedger, createMockProvider, createSecretRedactor, providerDone, providerTextDelta, redactRunLedgerRecord, type FlushableRunLedger, type RunLedger, type RunRecord } from "../index.js";

const run = (status: RunRecord["status"], id = "run_1"): RunRecord => ({
  id, sessionId: "session_1", status, startedAt: "2026-01-01T00:00:00Z",
});

function target(output: string[], failAt = -1): RunLedger {
  let calls = 0;
  const write = (kind: string, id: string) => {
    calls += 1;
    if (calls === failAt) throw new Error("store failed");
    output.push(`${kind}:${id}`);
  };
  return {
    appendRun: (record) => write("run", `${record.id}:${record.status}`),
    appendEvent: (record) => write("event", record.id),
    appendToolCall: (record) => write("tool", record.id),
    appendUsage: (record) => write("usage", record.id),
  };
}

describe("createBatchedRunLedger", () => {
  it("preserves FIFO order and flushes terminal records with explicit status", async () => {
    const writes: string[] = [];
    const ledger = createBatchedRunLedger(target(writes), { durability: "flush_on_terminal", maxBatchEntries: 8, maxDelayMs: 60_000 });
    await ledger.appendRun(run("running"));
    await ledger.appendEvent({ id: "event_1", sessionId: "session_1", runId: "run_1", type: "agent_started", timestamp: "2026-01-01T00:00:00Z", event: { type: "agent_started", sessionId: "session_1", runId: "run_1" }, redacted: true });
    assert.deepEqual(ledger.status(), { accepted: 2, flushed: 0, buffered: 2 });
    await ledger.appendRun(run("succeeded"));
    assert.deepEqual(writes, ["run:run_1:running", "event:event_1", "run:run_1:succeeded"]);
    assert.deepEqual(ledger.status(), { accepted: 3, flushed: 3, buffered: 0 });
    await ledger.dispose();
  });

  it("applies backpressure, rejects oversized records, and propagates flush failure", async () => {
    const writes: string[] = [];
    const ledger = createBatchedRunLedger(target(writes, 2), { durability: "buffered", maxBatchEntries: 2, maxBufferedEntries: 2, maxBatchBytes: 1024, maxBufferedBytes: 1024, maxDelayMs: 60_000 });
    await ledger.appendRun(run("running", "a"));
    await assert.rejects(async () => ledger.appendRun(run("running", "b")), /store failed/);
    assert.equal(ledger.status().buffered, 1, "failed write remains buffered for retry");
    await assert.rejects(async () => ledger.appendRun({ ...run("running", "large"), metadata: { value: "x".repeat(2000) } }), /byte limit/);
    await ledger.dispose({ flush: false });
    assert.equal(ledger.status().buffered, 0);
  });

  it("runtime explicitly acknowledges a flush-on-terminal ledger", async () => {
    let flushes = 0;
    const ledger: FlushableRunLedger = {
      ...target([]), durability: "flush_on_terminal",
      flush: async () => ({ accepted: 0, flushed: 0, buffered: 0 }),
      status: () => ({ accepted: 0, flushed: 0, buffered: 0 }),
      dispose: async () => undefined,
    };
    ledger.flush = async () => { flushes += 1; return ledger.status(); };
    await createAgent({ model: { provider: "mock", model: "demo" }, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), runLedger: ledger }).createSession().run("hi");
    assert.equal(flushes, 1);
  });

  it("buffers already-redacted records and documents crash-discard semantics", async () => {
    const writes: string[] = [];
    const ledger = createBatchedRunLedger(target(writes), { durability: "buffered", maxDelayMs: 60_000 });
    const redactor = createSecretRedactor(["SECRET_CANARY"]);
    await ledger.appendRun(redactRunLedgerRecord({ ...run("running"), metadata: { value: "SECRET_CANARY" } }, redactor));
    assert.doesNotMatch(JSON.stringify(ledger), /SECRET_CANARY/);
    await ledger.dispose({ flush: false });
    assert.deepEqual(writes, []);
  });
});
