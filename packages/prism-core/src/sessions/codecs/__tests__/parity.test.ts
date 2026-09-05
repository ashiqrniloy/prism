import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEventRecord, RunRecord, SessionEntry, ToolCallRecord, UsageRecord } from "@arnilo/prism";
import { CheckpointConflictError, LeaseConflictError } from "@arnilo/prism";
import { assertCheckpointInput, assertLeaseInput, createSessionRowMappers, encodeCheckpointJson } from "../index.js";

const sqlite = createSessionRowMappers<number>({
  encode: (redacted) => (redacted ? 1 : 0),
  decode: (redacted) => redacted === 1,
});
const postgres = createSessionRowMappers<boolean>({
  encode: (redacted) => redacted,
  decode: (redacted) => redacted,
});

function jsonStable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const entries: SessionEntry[] = [
  {
    id: "e1",
    sessionId: "s1",
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  },
  {
    id: "e2",
    sessionId: "s1",
    parentId: "e1",
    runId: "r1",
    timestamp: "2026-01-01T00:00:01.000Z",
    kind: "label",
    schemaVersion: 1,
    label: "auth-flake",
    summary: "flaky login",
    metadata: { workspaceRoot: "/tmp/ws" },
  },
];

const runs: RunRecord[] = [
  {
    id: "r1",
    sessionId: "s1",
    startedAt: "2026-01-01T00:00:00.000Z",
    provider: "anthropic",
    model: { provider: "anthropic", model: "claude-sonnet" },
  },
  {
    id: "r2",
    sessionId: "s1",
    branchId: "b1",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:02.000Z",
    tenantId: "t1",
    accountId: "a1",
    userId: "u1",
    abortReason: "none",
    error: { message: "nope" },
    metadata: { k: 1 },
    promptVersion: { name: "pv", version: 1, hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  },
];

const events: AgentEventRecord[] = [
  {
    id: "ev1",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "agent_started",
    event: { type: "agent_started", sessionId: "s1", runId: "r1" },
    redacted: false,
  },
  {
    id: "ev2",
    sessionId: "s1",
    runId: "r1",
    entryId: "e1",
    sequence: 2,
    timestamp: "2026-01-01T00:00:01.000Z",
    type: "turn_started",
    event: { type: "turn_started", sessionId: "s1", runId: "r1", turn: 1 },
    redacted: true,
    tenantId: "t1",
    metadata: { n: 1 },
  },
];

const tools: ToolCallRecord[] = [
  {
    id: "tc1",
    sessionId: "s1",
    runId: "r1",
    toolCallId: "call-1",
    name: "read",
    arguments: { path: "a.ts" },
    startedAt: "2026-01-01T00:00:00.000Z",
    redacted: false,
  },
  {
    id: "tc2",
    sessionId: "s1",
    runId: "r1",
    entryId: "e1",
    toolCallId: "call-2",
    name: "write",
    arguments: { path: "b.ts" },
    result: { toolCallId: "call-2", name: "write", content: [{ type: "text", text: "ok" }] },
    status: "finished",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    redacted: true,
    progress: { pct: 50 },
    progressMetadata: { step: "write" },
    progressAt: "2026-01-01T00:00:00.500Z",
  },
];

const usage: UsageRecord[] = [
  {
    id: "u1",
    sessionId: "s1",
    scope: "run_total",
    usage: { inputTokens: 10, outputTokens: 4 },
    recordedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "u2",
    sessionId: "s1",
    runId: "r1",
    entryId: "e1",
    scope: "provider_turn",
    turn: 1,
    attempt: 2,
    usage: { inputTokens: 3, outputTokens: 1 },
    recordedAt: "2026-01-01T00:00:01.000Z",
    tenantId: "t1",
    metadata: { model: "x" },
  },
];

describe("session codec parity (sqlite INTEGER vs postgres BOOLEAN redacted)", () => {
  it("round-trips session entries identically on both paths", () => {
    for (const entry of entries) {
      const sqliteRow = sqlite.sessionEntryToRow(entry);
      const postgresRow = postgres.sessionEntryToRow(entry);
      assert.deepEqual(sqliteRow, postgresRow);
      assert.deepEqual(jsonStable(sqlite.rowToSessionEntry(sqliteRow)), jsonStable(entry));
      assert.deepEqual(jsonStable(postgres.rowToSessionEntry(postgresRow)), jsonStable(entry));
    }
  });

  it("round-trips runs identically on both paths", () => {
    for (const record of runs) {
      const sqliteRow = sqlite.runRecordToRow(record);
      const postgresRow = postgres.runRecordToRow(record);
      assert.deepEqual(sqliteRow, postgresRow);
      assert.deepEqual(jsonStable(sqlite.rowToRunRecord(sqliteRow)), jsonStable(record));
      assert.deepEqual(jsonStable(postgres.rowToRunRecord(postgresRow)), jsonStable(record));
    }
  });

  it("round-trips events/tool calls with matching decoded records (redacted encoding may differ)", () => {
    for (const record of events) {
      const sqliteRow = sqlite.agentEventRecordToRow(record, record.sequence ?? 1);
      const postgresRow = postgres.agentEventRecordToRow(record, record.sequence ?? 1);
      assert.equal(sqliteRow.redacted, record.redacted ? 1 : 0);
      assert.equal(postgresRow.redacted, record.redacted);
      const { redacted: _s, ...sqliteRest } = sqliteRow;
      const { redacted: _p, ...postgresRest } = postgresRow;
      assert.deepEqual(sqliteRest, postgresRest);
      assert.deepEqual(jsonStable(sqlite.rowToAgentEventRecord(sqliteRow)), jsonStable({ ...record, sequence: record.sequence ?? 1 }));
      assert.deepEqual(jsonStable(postgres.rowToAgentEventRecord(postgresRow)), jsonStable({ ...record, sequence: record.sequence ?? 1 }));
    }
    for (const record of tools) {
      const sqliteRow = sqlite.toolCallRecordToRow(record);
      const postgresRow = postgres.toolCallRecordToRow(record);
      const { redacted: _s, ...sqliteRest } = sqliteRow;
      const { redacted: _p, ...postgresRest } = postgresRow;
      assert.deepEqual(sqliteRest, postgresRest);
      assert.deepEqual(jsonStable(sqlite.rowToToolCallRecord(sqliteRow)), jsonStable(record));
      assert.deepEqual(jsonStable(postgres.rowToToolCallRecord(postgresRow)), jsonStable(record));
    }
  });

  it("round-trips usage identically on both paths", () => {
    for (const record of usage) {
      const sqliteRow = sqlite.usageRecordToRow(record);
      const postgresRow = postgres.usageRecordToRow(record);
      assert.deepEqual(sqliteRow, postgresRow);
      assert.deepEqual(jsonStable(sqlite.rowToUsageRecord(sqliteRow)), jsonStable(record));
      assert.deepEqual(jsonStable(postgres.rowToUsageRecord(postgresRow)), jsonStable(record));
    }
  });

  it("shared validation helpers reject the same invalid input", () => {
    assert.throws(() => assertCheckpointInput({ namespace: "", key: "k", version: 1 }), CheckpointConflictError);
    assert.throws(() => assertLeaseInput("", "k", "owner"), LeaseConflictError);
    assert.equal(encodeCheckpointJson({ a: 1 }, "value"), '{"a":1}');
  });
});
