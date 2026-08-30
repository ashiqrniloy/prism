/**
 * Plan 040 Task 2 — inspector server routes: prompt adapter, durable SSE with
 * Last-Event-ID reconnect, paged replay without re-execution, and fail-closed
 * HITL decision resume through the composed server seams.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEventRecord,
  createAgent,
  createMemoryAgentEventSource,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createPrismDevInspector } from "../index.js";

const OWNERSHIP = { tenantId: "local", userId: "local" } as const;

function simpleAgent(text = "done"): ReturnType<typeof createAgent> {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta(text), providerDone()]),
  });
}

function seededRecords(): AgentEventRecord[] {
  const base = { sessionId: "session-1", runId: "stored-run", redacted: true, ...OWNERSHIP };
  return [
    {
      ...base,
      id: "event-1",
      type: "agent_started",
      timestamp: "2026-09-05T00:00:00.000Z",
      event: { type: "agent_started", sessionId: "session-1", runId: "stored-run" },
    },
    {
      ...base,
      id: "event-2",
      type: "message_delta",
      timestamp: "2026-09-05T00:00:01.000Z",
      event: { type: "message_delta", sessionId: "session-1", runId: "stored-run", content: { type: "text", text: "durable" } },
    },
    {
      ...base,
      id: "event-3",
      type: "agent_finished",
      timestamp: "2026-09-05T00:00:02.000Z",
      event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" },
    },
  ];
}

function parseSseEvents(text: string): { cursor: string; type: string; text: string }[] {
  const out: { cursor: string; type: string; text: string }[] = [];
  let current: { id?: string; data?: string } = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("id: ")) current.id = line.slice(4);
    else if (line.startsWith("data: ")) current.data = line.slice(6);
    else if (line === "" && current.id !== undefined && current.data !== undefined) {
      // SSE payload is the normalized AgentEvent itself (redacted at the seam).
      const decoded = JSON.parse(current.data) as { type: string; content?: { type: string; text?: string } };
      out.push({
        cursor: current.id,
        type: decoded.type,
        text: decoded.content?.type === "text" ? (decoded.content.text ?? "") : "",
      });
      current = {};
    }
  }
  return out;
}

async function cursorAfter(events: ReturnType<typeof createMemoryAgentEventSource>): Promise<string[]> {
  const cursors: string[] = [];
  const page = await events.page({ ownership: OWNERSHIP, sessionId: "session-1", runId: "stored-run" });
  for (const record of ["event-1", "event-2", "event-3"]) {
    const envelope = page.items.find((entry) => entry.record.id === record);
    assert.ok(envelope, `missing ${record}`);
    cursors.push(envelope.cursor);
  }
  return cursors;
}

describe("inspector routes (plan 040 Task 2)", () => {
  it("POST /prompt runs the agent through the server handler adapter", async () => {
    const inspector = createPrismDevInspector({ agent: simpleAgent("hello prompt"), port: 0 });
    await inspector.listen();
    try {
      const root = inspector.url.replace(/\/prism$/, "");
      const response = await fetch(`${root}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "run" }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as { text: string; status: string };
      assert.equal(result.text, "hello prompt");
      assert.equal(result.status, "succeeded");
    } finally {
      await inspector.close();
    }
  });

  it("GET /events streams durable events in append order; Last-Event-ID reconnect loses nothing and duplicates nothing", async () => {
    const events = createMemoryAgentEventSource() as ReturnType<typeof createMemoryAgentEventSource> & { close(): void };
    for (const record of seededRecords()) await events.append(record);
    const cursors = await cursorAfter(events);
    const inspector = createPrismDevInspector({
      agent: simpleAgent(),
      port: 0,
      eventSource: events,
      resolveRun: (input) => (input.runId === "public-run" ? { sessionId: "session-1", runId: "stored-run" } : undefined),
    });
    await inspector.listen();
    const root = inspector.url.replace(/\/prism$/, "");
    try {
      // Full stream from the start: SSE event order matches the normalized append order.
      const full = await fetch(`${root}/events?runId=public-run`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(full.status, 200);
      const parsed = parseSseEvents(await full.text());
      assert.deepEqual(
        parsed.map((entry) => entry.type),
        ["agent_started", "message_delta", "agent_finished"],
      );

      // Reconnect after event-1: exactly event-2 and event-3 follow (no duplicates, no loss).
      const reconnect = await fetch(`${root}/events?runId=public-run`, {
        headers: { "last-event-id": cursors[0]! },
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(reconnect.status, 200);
      assert.deepEqual(
        parseSseEvents(await reconnect.text()).map((entry) => entry.type),
        ["message_delta", "agent_finished"],
      );

      // Missing runId fails closed before the server seam is consulted.
      assert.equal((await fetch(`${root}/events`, { signal: AbortSignal.timeout(5_000) })).status, 400);
    } finally {
      await inspector.close();
      events.close();
    }
  });

  it("GET /runs/:id/replay pages a finished run with zero re-execution and applies the host redactor", async () => {
    const events = createMemoryAgentEventSource() as ReturnType<typeof createMemoryAgentEventSource> & { close(): void };
    const secret = "s3cr3t-token";
    const base = { sessionId: "session-1", runId: "stored-run", redacted: true, ...OWNERSHIP };
    await events.append({
      ...base,
      id: "event-1",
      type: "message_delta",
      timestamp: "2026-09-05T00:00:00.000Z",
      event: { type: "message_delta", sessionId: "session-1", runId: "stored-run", content: { type: "text", text: `leak ${secret}` } },
    });
    await events.append({
      ...base,
      id: "event-2",
      type: "agent_finished",
      timestamp: "2026-09-05T00:00:01.000Z",
      event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" },
    });
    const page = await events.page({ ownership: OWNERSHIP, sessionId: "session-1", runId: "stored-run" });
    const cursorOf = (id: string) => page.items.find((entry) => entry.record.id === id)!.cursor;

    const inspector = createPrismDevInspector({
      agent: simpleAgent(),
      port: 0,
      redactor: createSecretRedactor([secret]),
      eventSource: events,
      resolveRun: (input) => (input.runId === "public-run" ? { sessionId: "session-1", runId: "stored-run" } : undefined),
    });
    await inspector.listen();
    const root = inspector.url.replace(/\/prism$/, "");
    try {
      const replay = await fetch(`${root}/runs/public-run/replay`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(replay.status, 200);
      const body = (await replay.json()) as {
        items: { record: { id: string; event: { type: string } } }[];
        terminal: boolean;
        nextCursor?: string;
      };
      assert.deepEqual(
        body.items.map((entry) => entry.record.id),
        ["event-1", "event-2"],
      );
      assert.equal(body.terminal, true);
      assert.ok(!JSON.stringify(body).includes(secret), "host redactor must apply to replayed payloads");
      assert.ok(JSON.stringify(body).includes("leak"));

      // Cursor paging: after event-1 the page holds only the terminal remainder.
      const next = await fetch(`${root}/runs/public-run/replay?cursor=${encodeURIComponent(cursorOf("event-1"))}`, {
        signal: AbortSignal.timeout(5_000),
      });
      const nextBody = (await next.json()) as { items: { record: { id: string } }[]; terminal: boolean };
      assert.deepEqual(
        nextBody.items.map((entry) => entry.record.id),
        ["event-2"],
      );
      assert.equal(nextBody.terminal, true);

      // Runs the resolveRun seam does not own are refused (fail closed, 404).
      assert.equal((await fetch(`${root}/runs/public-other/replay`, { signal: AbortSignal.timeout(5_000) })).status, 404);
    } finally {
      await inspector.close();
      events.close();
    }
  });

  it("replay without a durable event source is a documented 404, never a re-run", async () => {
    const inspector = createPrismDevInspector({ agent: simpleAgent(), port: 0 });
    await inspector.listen();
    try {
      const root = inspector.url.replace(/\/prism$/, "");
      const response = await fetch(`${root}/runs/whatever/replay`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 404);
    } finally {
      await inspector.close();
    }
  });

  it("POST /runs/:runId/decisions/:decisionId resumes a suspended approval; unknown discriminants fail closed", async () => {
    // One provider turn yields a guarded tool call (suspend); the next turn finishes the run.
    const secret = "hitl-secret";
    let calls = 0;
    let turn = 0;
    // One shared, host-owned checkpoint store: the agent's runState and the
    // inspector lifecycle must compose over the SAME store (the host owns both).
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "dev-inspector",
      model: { provider: "mock", model: "offline" },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { secret }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      store: createMemorySessionStore(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: ++calls }) }],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true as const },
    });
    const inspector = createPrismDevInspector({
      agent,
      port: 0,
      checkpoints,
      redactor: createSecretRedactor([secret]),
    });
    await inspector.listen();
    const root = inspector.url.replace(/\/prism$/, "");
    try {
      const post = (path: string, body: unknown) =>
        fetch(`${root}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      const started = await post("/prompt", { input: "go" });
      const run = (await started.json()) as {
        status: string;
        runId: string;
        runState?: { version: number; interruption?: { pendingDecisions?: readonly { approvalId: string }[] } };
      };
      assert.equal(started.status, 200, JSON.stringify(run));
      assert.equal(run.status, "suspended");
      assert.ok(run.runId);
      const expectedVersion = run.runState?.version;
      assert.equal(typeof expectedVersion, "number");

      assert.ok(run.runState);
      const approvalId = run.runState.interruption?.pendingDecisions?.[0]?.approvalId;
      assert.ok(approvalId);

      // Unknown outcome discriminant is rejected fail-closed (400) without a state write:
      // the valid decision below still applies with the unchanged expectedVersion.
      const bad = await post(`/runs/${run.runId}/decisions/${approvalId}`, { outcome: "sideways", expectedVersion });
      assert.equal(bad.status, 400, await bad.clone().text());

      const resumed = await post(`/runs/${run.runId}/decisions/${approvalId}`, { outcome: "allow_once", expectedVersion });
      const result = (await resumed.json()) as { status: string };
      assert.equal(resumed.status, 200, JSON.stringify(result));
      assert.equal(result.status, "succeeded");
      assert.equal(calls, 1, "resumed run executes the approved tool exactly once");
    } finally {
      await inspector.close();
    }
  });
});
