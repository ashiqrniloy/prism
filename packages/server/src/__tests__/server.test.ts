import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  type AIProvider,
} from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowSchedules,
  defineWorkflow,
  functionNode,
  suspend,
} from "@arnilo/prism-workflows";
import { createPrismHandler } from "../handler.js";

const authorization = { ownership: { tenantId: "tenant-1", userId: "user-1" } };

function jsonRequest(path: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(`https://example.test${path}`, {
    ...init,
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  });
}

function mockAgent(text = "hello") {
  return createAgent({
    model: { provider: "mock", model: "offline" },
    provider: createMockProvider([providerTextDelta(text), providerDone()]),
  });
}

describe("createPrismHandler", () => {
  it("runs selected agents directly and streams bounded SSE events", async () => {
    const calls: string[] = [];
    const handler = createPrismHandler({
      agents: { support: mockAgent() },
      authorize(input) {
        calls.push(`${input.operation}:${input.capabilityId}`);
        return authorization;
      },
    });

    const direct = await handler(jsonRequest("/prism/agents/support/runs", { input: "Hi" }));
    assert.equal(direct.status, 200);
    const result = await direct.json() as { text: string; status: string };
    assert.equal(result.text, "hello");
    assert.equal(result.status, "succeeded");

    const streamed = await handler(jsonRequest("/prism/agents/support/stream", { input: "Hi" }));
    assert.equal(streamed.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const text = await streamed.text();
    assert.match(text, /message_delta/);
    assert.match(text, /agent_finished/);
    assert.deepEqual(calls, ["agent.run:support", "agent.stream:support"]);
  });

  it("runs, loads, resumes, and cancels durable workflow checkpoints", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      id: "publish",
      nodes: {
        review: functionNode({ execute: (ctx) => ctx.resume
          ? { approved: ctx.resume.input }
          : suspend({ reason: "review", resumeSchema: { type: "object" } }) }),
      },
      edges: [],
    });
    const handler = createPrismHandler({
      workflows: { publish: { definition: workflow, checkpoints, runOptions: { validateResume: () => undefined } } },
      authorize: () => authorization,
    });

    const started = await handler(jsonRequest("/prism/workflows/publish/runs", { input: {}, runId: "run-1" }));
    assert.equal(started.status, 200);
    const suspended = await started.json() as { status: string; version: number };
    assert.equal(suspended.status, "suspended");

    const status = await handler(new Request("https://example.test/prism/workflows/publish/runs/run-1"));
    assert.equal(status.status, 200);
    const checkpoint = await status.json() as { version: number; value: { status: string } };
    assert.equal(checkpoint.value.status, "suspended");

    const resumed = await handler(jsonRequest("/prism/workflows/publish/runs/run-1/resume", {
      decision: "approve",
      input: { reviewer: "host" },
      expectedVersion: checkpoint.version,
    }));
    assert.equal(resumed.status, 200, await resumed.clone().text());
    assert.equal((await resumed.json() as { status: string }).status, "succeeded");

    await handler(jsonRequest("/prism/workflows/publish/runs", { input: {}, runId: "run-2" }));
    const cancelled = await handler(new Request("https://example.test/prism/workflows/publish/runs/run-2", { method: "DELETE" }));
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json() as { aborted: boolean }).aborted, true);
  });

  it("enqueues background runs and creates lineage-linked replays", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let calls = 0;
    const workflow = defineWorkflow({
      id: "background",
      nodes: { work: functionNode({ execute: () => ++calls }) },
    });
    const handler = createPrismHandler({
      workflows: { background: { definition: workflow, checkpoints } },
      authorize: () => authorization,
    });
    const queued = await handler(jsonRequest("/prism/workflows/background/enqueue", { input: {}, runId: "queued-1" }));
    assert.equal(queued.status, 202);
    assert.equal((await queued.json() as { status: string }).status, "queued");

    const sourceResponse = await handler(jsonRequest("/prism/workflows/background/runs", { input: {}, runId: "source-1" }));
    assert.equal(sourceResponse.status, 200);
    const replayed = await handler(jsonRequest("/prism/workflows/background/runs/source-1/replay", { fromNodeId: "work", runId: "replay-1" }));
    assert.equal(replayed.status, 200, await replayed.clone().text());
    const result = await replayed.json() as { status: string; lineage: { sourceRunId: string } };
    assert.equal(result.status, "succeeded");
    assert.equal(result.lineage.sourceRunId, "source-1");
    assert.equal(calls, 2);
  });

  it("serves only explicitly registered ownership-scoped schedules", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({ id: "scheduled", nodes: { work: functionNode({ execute: () => true }) } });
    const schedules = createWorkflowSchedules({
      store: createMemoryCheckpointStore(),
      leases: createMemoryLeaseStore(),
      checkpoints,
      workflows: { scheduled: workflow },
      ownership: authorization.ownership,
      ownerId: "server",
    });
    const handler = createPrismHandler({ schedules, authorize: () => authorization });
    const created = await handler(jsonRequest("/prism/schedules/daily", {
      workflowId: "scheduled",
      nextRunAt: "2026-01-01T00:00:00.000Z",
      intervalMs: 60_000,
    }));
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal((await created.json() as { id: string }).id, "daily");
    assert.equal((await handler(jsonRequest("/prism/schedules/daily/pause", {}))).status, 200);
    assert.equal((await handler(jsonRequest("/prism/schedules/daily/resume", { nextRunAt: "2026-01-02T00:00:00.000Z" }))).status, 200);
    assert.equal((await handler(jsonRequest("/prism/schedules/daily/trigger", { idempotencyKey: "manual-1" }))).status, 200);
    const listed = await handler(new Request("https://example.test/prism/schedules?status=active"));
    assert.equal(listed.status, 200);
    assert.equal((await listed.json() as { items: unknown[] }).items.length, 1);
    assert.equal((await handler(new Request("https://example.test/prism/schedules/daily", { method: "DELETE" }))).status, 200);
    assert.equal((await handler(jsonRequest("/prism/schedules/bad", {
      workflowId: "scheduled",
      nextRunAt: "not-a-date",
    }))).status, 400);

    const forbidden = createPrismHandler({
      schedules,
      authorize: () => ({ ownership: { tenantId: "other", userId: "other" } }),
    });
    assert.equal((await forbidden(new Request("https://example.test/prism/schedules"))).status, 403);
  });

  it("streams workflow events and releases its concurrency slot", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      id: "quick",
      nodes: { work: functionNode({ execute: () => "done" }) },
      edges: [],
    });
    const handler = createPrismHandler({
      workflows: { quick: { definition: workflow, checkpoints } },
      authorize: () => authorization,
      limits: { maxConcurrentRuns: 1 },
    });
    const response = await handler(jsonRequest("/prism/workflows/quick/stream", { input: {}, runId: "stream-1" }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /workflow_finished/);
    const again = await handler(jsonRequest("/prism/workflows/quick/runs", { input: {}, runId: "stream-2" }));
    assert.equal(again.status, 200);
  });

  it("fails closed on auth, ownership, routes, content type, body size, host, and origin", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({ id: "safe", nodes: { one: functionNode({ execute: () => 1 }) }, edges: [] });
    const handler = createPrismHandler({
      agents: { allowed: mockAgent() },
      workflows: { safe: { definition: workflow, checkpoints } },
      authorize: ({ request }) => request.headers.get("authorization") === "Bearer ok" ? authorization : false,
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://app.test"],
      limits: { maxRequestBytes: 64 },
    });

    assert.equal((await handler(jsonRequest("/prism/agents/allowed/runs", { input: "x" }))).status, 403);
    assert.equal((await handler(jsonRequest("/prism/agents/missing/runs", { input: "x" }, { headers: { authorization: "Bearer ok" } }))).status, 404);
    assert.equal((await handler(new Request("https://example.test/prism/agents/allowed/runs", { method: "POST", body: "{}", headers: { authorization: "Bearer ok" } }))).status, 415);
    assert.equal((await handler(jsonRequest("/prism/agents/allowed/runs", { input: "x".repeat(100) }, { headers: { authorization: "Bearer ok" } }))).status, 413);
    assert.equal((await handler(jsonRequest("/prism/agents/allowed/runs", { input: "x" }, { headers: { authorization: "Bearer ok", host: "evil.test" } }))).status, 403);
    assert.equal((await handler(jsonRequest("/prism/agents/allowed/runs", { input: "x" }, { headers: { authorization: "Bearer ok", origin: "https://evil.test" } }))).status, 403);

    const timed = createPrismHandler({
      agents: { allowed: mockAgent() },
      authorize: () => new Promise<false>(() => undefined),
      limits: { requestTimeoutMs: 1 },
    });
    assert.equal((await timed(jsonRequest("/prism/agents/allowed/runs", { input: "x" }))).status, 403);
  });

  it("bounds concurrent runs and releases the slot when an SSE consumer disconnects", async () => {
    let providerCalls = 0;
    const provider: AIProvider = {
      id: "slow",
      async *generate(request) {
        providerCalls += 1;
        if (providerCalls === 1) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1_000);
            request.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
          request.signal?.throwIfAborted();
        }
        yield providerDone();
      },
    };
    const agent = createAgent({ model: { provider: "slow", model: "slow" }, provider });
    const handler = createPrismHandler({
      agents: { slow: agent },
      authorize: () => authorization,
      limits: { maxConcurrentRuns: 1 },
    });

    const stream = await handler(jsonRequest("/prism/agents/slow/stream", { input: "wait" }));
    const reader = stream.body!.getReader();
    await reader.read();
    while (providerCalls === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal((await handler(jsonRequest("/prism/agents/slow/runs", { input: "wait" }))).status, 429);
    await reader.cancel("client disconnected");
    assert.equal((await handler(jsonRequest("/prism/agents/slow/runs", { input: "ok" }))).status, 200);
  });

  it("bounds result and event bytes and never returns configured secrets", async () => {
    const secret = "server-canary-secret";
    const handler = createPrismHandler({
      agents: { large: mockAgent(`${secret}-${"x".repeat(200)}`) },
      authorize: () => authorization,
      redactor: createSecretRedactor([secret]),
      limits: { maxResponseBytes: 100, maxEventBytes: 120 },
    });
    const direct = await handler(jsonRequest("/prism/agents/large/runs", { input: "x" }));
    assert.equal(direct.status, 507);
    assert.doesNotMatch(await direct.text(), new RegExp(secret));

    const streamed = await handler(jsonRequest("/prism/agents/large/stream", { input: "x" }));
    const text = await streamed.text();
    assert.match(text, /STREAM_LIMIT/);
    assert.doesNotMatch(text, new RegExp(secret));
  });
});
