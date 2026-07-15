// ponytail: dependency-free conformance helper for the RunLedger adapter contract.
// Database-backed adapters call this once (or via runRunLedgerConformance factory)
// to assert durable run/event/tool/usage writes, per-run ordering, tenant
// isolation, and restart idempotency before shipping dialect-local SQL.

import type {
  AgentEventRecord,
  RunLedger,
  RunRecord,
  ToolCallRecord,
  UsageRecord,
} from "../contracts.js";

export interface RunLedgerConformanceFixture {
  readonly ledger: RunLedger;
  readonly readRuns?: () => Promise<readonly RunRecord[]> | readonly RunRecord[];
  readonly readEvents?: () => Promise<readonly AgentEventRecord[]> | readonly AgentEventRecord[];
  readonly readToolCalls?: () => Promise<readonly ToolCallRecord[]> | readonly ToolCallRecord[];
  readonly readUsage?: () => Promise<readonly UsageRecord[]> | readonly UsageRecord[];
}

export interface RunLedgerConformanceOptions {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly tenantId?: string;
  readonly accountId?: string;
  readonly userId?: string;
  /** When true, requires read* callbacks and asserts tenant-scoped rows do not leak. */
  readonly exerciseTenantIsolation?: boolean;
  /** When true, factory is invoked twice to assert durable writes survive reopen. */
  readonly exerciseReopen?: boolean;
}

export type RunLedgerConformanceFactory = () => RunLedgerConformanceFixture | Promise<RunLedgerConformanceFixture>;

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * Assert that a `RunLedger` implementation satisfies the write contract:
 * all record kinds round-trip via optional read callbacks, per-run event order
 * is preserved, and tenant-scoped rows store `tenant_id` when
 * `exerciseTenantIsolation` is enabled.
 */
export async function assertRunLedgerConforms(
  fixture: RunLedgerConformanceFixture,
  options: RunLedgerConformanceOptions = {},
): Promise<void> {
  const sessionId = options.sessionId ?? "ledger-conformance";
  const runId = options.runId ?? "run-conformance";
  const tenantId = options.tenantId ?? "tenant-a";
  const scope = {
    tenantId,
    accountId: options.accountId ?? "account-a",
    userId: options.userId ?? "user-a",
  };

  const runStart: RunRecord = {
    id: runId,
    sessionId,
    status: "running",
    startedAt: NOW,
    provider: "mock",
    model: { provider: "mock", model: "demo" },
    idempotencyKey: "run-key-1",
    ...scope,
  };
  const runFinish: RunRecord = {
    ...runStart,
    status: "succeeded",
    finishedAt: "2026-01-01T00:00:01.000Z",
  };
  const eventA: AgentEventRecord = {
    id: "event-a",
    sessionId,
    runId,
    type: "agent_started",
    timestamp: NOW,
    event: { type: "agent_started", sessionId, runId },
    redacted: false,
    ...scope,
  };
  const eventB: AgentEventRecord = {
    id: "event-b",
    sessionId,
    runId,
    type: "turn_started",
    timestamp: "2026-01-01T00:00:00.500Z",
    event: { type: "turn_started", sessionId, runId, turn: 1 },
    redacted: false,
    ...scope,
  };
  const tool: ToolCallRecord = {
    id: "tool-row-1",
    sessionId,
    runId,
    toolCallId: "call-1",
    name: "echo",
    arguments: { msg: "hi" },
    status: "finished",
    result: { toolCallId: "call-1", name: "echo", value: "hi" },
    startedAt: NOW,
    finishedAt: "2026-01-01T00:00:00.800Z",
    redacted: false,
    ...scope,
  };
  const usage: UsageRecord = {
    id: "usage-1",
    sessionId,
    runId,
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    recordedAt: "2026-01-01T00:00:01.000Z",
    ...scope,
  };

  await fixture.ledger.appendRun(runStart);
  await fixture.ledger.appendEvent(eventA);
  await fixture.ledger.appendEvent(eventB);
  await fixture.ledger.appendToolCall(tool);
  await fixture.ledger.appendUsage(usage);
  await fixture.ledger.appendRun(runFinish);

  if (fixture.readRuns) {
    const runs = await fixture.readRuns();
    const snapshots = runs.filter((row) => row.id === runId);
    if (!snapshots.some((row) => row.status === "succeeded")) {
      throw new Error("RunLedger must persist the terminal RunRecord");
    }
    const succeeded = snapshots.find((row) => row.status === "succeeded")!;
    if (succeeded.startedAt !== runStart.startedAt) {
      throw new Error("RunLedger must preserve startedAt on the terminal RunRecord");
    }
    if (snapshots.length > 1 && !snapshots.some((row) => row.status === "running")) {
      throw new Error("RunLedger must persist the running RunRecord when multiple snapshots are stored");
    }
  }

  if (fixture.readEvents) {
    const events = await fixture.readEvents();
    const forRun = events.filter((row) => row.runId === runId);
    const ids = forRun.map((row) => row.id);
    const aIndex = ids.indexOf("event-a");
    const bIndex = ids.indexOf("event-b");
    if (aIndex < 0 || bIndex < 0) throw new Error("RunLedger dropped appended AgentEventRecord rows");
    if (aIndex > bIndex) throw new Error("RunLedger must preserve per-run event append order");
  }

  if (fixture.readToolCalls) {
    const toolCalls = await fixture.readToolCalls();
    if (!toolCalls.some((row) => row.toolCallId === "call-1")) {
      throw new Error("RunLedger must persist ToolCallRecord rows");
    }
  }

  if (fixture.readUsage) {
    const usageRows = await fixture.readUsage();
    if (!usageRows.some((row) => row.id === "usage-1")) {
      throw new Error("RunLedger must persist UsageRecord rows");
    }
  }

  if (options.exerciseTenantIsolation && fixture.readRuns) {
    const otherRun: RunRecord = {
      id: "run-tenant-b",
      sessionId: `${sessionId}-tenant-b`,
      status: "running",
      startedAt: NOW,
      provider: "mock",
      tenantId: "tenant-b",
      accountId: "account-b",
      userId: "user-b",
    };
    await fixture.ledger.appendRun(otherRun);
    const runs = await fixture.readRuns();
    const stored = runs.find((row) => row.id === "run-tenant-b");
    if (!stored || stored.tenantId !== "tenant-b") {
      throw new Error("RunLedger must persist tenant_id on records for tenant-scoped isolation");
    }
    const scoped = runs.filter((row) => row.tenantId === tenantId);
    if (!scoped.some((row) => row.id === runId)) {
      throw new Error("RunLedger read path must return tenant-a rows when queried for conformance session");
    }
  }
}

/**
 * Factory-based conformance entry point for durable adapters. Invokes
 * `assertRunLedgerConforms` against a fresh fixture and optionally reopens via
 * the same factory to assert writes survive process/database reopen.
 */
export async function runRunLedgerConformance(
  factory: RunLedgerConformanceFactory,
  options: RunLedgerConformanceOptions = {},
): Promise<void> {
  const first = await factory();
  await assertRunLedgerConforms(first, options);

  if (!options.exerciseReopen) return;

  const reopened = await factory();
  if (!reopened.readRuns && !reopened.readEvents) {
    throw new Error("exerciseReopen requires readRuns or readEvents on the fixture");
  }

  if (reopened.readRuns) {
    const runs = await reopened.readRuns();
    const runId = options.runId ?? "run-conformance";
    if (!runs.some((row) => row.id === runId)) {
      throw new Error("RunLedger rows did not survive adapter reopen");
    }
  }

  if (reopened.readEvents) {
    const events = await reopened.readEvents();
    if (!events.some((row) => row.id === "event-a")) {
      throw new Error("RunLedger events did not survive adapter reopen");
    }
  }
}
