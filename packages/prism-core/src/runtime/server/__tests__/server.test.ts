import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEventRecord,
  type AIProvider,
  createAgent,
  createAgentRunLifecycle,
  createMemoryAgentEventSource,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createMemoryWorkflowCheckpoints, createWorkflowSchedules, defineWorkflow, functionNode, suspend } from "../../workflows/index.js";
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
    const result = (await direct.json()) as { text: string; status: string };
    assert.equal(result.text, "hello");
    assert.equal(result.status, "succeeded");

    const streamed = await handler(jsonRequest("/prism/agents/support/stream", { input: "Hi" }));
    assert.equal(streamed.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const text = await streamed.text();
    assert.match(text, /message_delta/);
    assert.match(text, /agent_finished/);
    assert.deepEqual(calls, ["agent.run:support", "agent.stream:support"]);
  });

  it("reconnects durable agent SSE on another handler with Last-Event-ID and no session run", async () => {
    const events = createMemoryAgentEventSource();
    const record = (id: string, event: Pick<AgentEventRecord, "sessionId" | "runId" | "event">, timestamp: string) =>
      events.append({ ...event, id, type: event.event.type, timestamp, redacted: true, ...authorization.ownership });
    await record(
      "event-1",
      { sessionId: "session-1", runId: "stored-run", event: { type: "agent_started", sessionId: "session-1", runId: "stored-run" } },
      "2026-08-04T00:00:00.000Z",
    );
    await record(
      "event-2",
      {
        sessionId: "session-1",
        runId: "stored-run",
        event: { type: "message_delta", sessionId: "session-1", runId: "stored-run", content: { type: "text", text: "durable" } },
      },
      "2026-08-04T00:00:01.000Z",
    );
    await record(
      "event-3",
      { sessionId: "session-1", runId: "stored-run", event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" } },
      "2026-08-04T00:00:02.000Z",
    );
    const page = await events.page({ ownership: authorization.ownership, sessionId: "session-1", runId: "stored-run" });
    let sessions = 0;
    const exposure = {
      sessionFactory: () => {
        sessions += 1;
        throw new Error("reconnect must not create a session");
      },
      events,
      resolveRun: () => ({ sessionId: "session-1", runId: "stored-run" }),
    };
    const replicaA = createPrismHandler({ agents: { support: exposure }, authorize: () => authorization });
    const replicaB = createPrismHandler({ agents: { support: exposure }, authorize: () => authorization });
    const first = await replicaA(
      new Request("https://example.test/prism/agents/support/runs/public-run/events", {
        headers: { "last-event-id": page.items[0]!.cursor },
      }),
    );
    const firstText = await first.text();
    assert.match(firstText, /id: /);
    assert.match(firstText, /durable/);
    const lastId = [...firstText.matchAll(/^id: (.+)$/gm)].at(-1)?.[1];
    assert.ok(lastId);
    const resumed = await replicaB(
      new Request(`https://example.test/prism/agents/support/runs/public-run/events?cursor=${encodeURIComponent(page.items[1]!.cursor)}`, {
        headers: { "last-event-id": page.items[1]!.cursor },
      }),
    );
    assert.match(await resumed.text(), /agent_finished/);
    assert.equal(sessions, 0);

    const conflict = await replicaB(
      new Request("https://example.test/prism/agents/support/runs/public-run/events?cursor=one", {
        headers: { "last-event-id": "two" },
      }),
    );
    assert.equal(conflict.status, 400);
    const tenantless = createPrismHandler({
      agents: { support: exposure },
      authorize: () => ({ ownership: { userId: "user-1" } }),
    });
    assert.equal((await tenantless(new Request("https://example.test/prism/agents/support/runs/public-run/events"))).status, 403);
  });

  it("exposes durable agent status and resume only through explicit lifecycle capabilities", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const secret = "agent-lifecycle-secret";
    let calls = 0;
    let turn = 0;
    const agent = createAgent({
      id: "support",
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
      redactor: createSecretRedactor([secret]),
      store,
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: ++calls }) }],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    const handler = createPrismHandler({
      agents: { support: agent },
      agentRuns: { support: { lifecycle } },
      authorize: () => authorization,
      redactor: createSecretRedactor([secret]),
    });
    const suspended = await handler(jsonRequest("/prism/agents/support/runs", { input: "go" }));
    const started = (await suspended.json()) as { status: string; runId: string; runState: { version: number } };
    assert.equal(started.status, "suspended");
    assert.equal(calls, 0);

    await assert.doesNotReject(() => lifecycle.status({ runId: started.runId }, { ownership: authorization.ownership }));
    const status = await handler(new Request(`https://example.test/prism/agents/support/runs/${started.runId}`));
    assert.equal(status.status, 200);
    const publicState = await status.text();
    assert.match(publicState, /suspended/);
    assert.doesNotMatch(publicState, new RegExp(secret));
    const wrongCapability = createPrismHandler({ agentRuns: { other: { lifecycle } }, authorize: () => authorization });
    assert.equal((await wrongCapability(new Request(`https://example.test/prism/agents/other/runs/${started.runId}`))).status, 404);
    const version = (JSON.parse(publicState) as { version: number }).version;

    const resumed = await handler(
      jsonRequest(`/prism/agents/support/runs/${started.runId}/resume`, { decision: "approve", expectedVersion: version }),
    );
    assert.equal(resumed.status, 200, await resumed.clone().text());
    assert.equal(((await resumed.json()) as { status: string }).status, "succeeded");
    assert.equal(calls, 1);
    assert.equal(
      (await handler(jsonRequest(`/prism/agents/support/runs/${started.runId}/resume`, { decision: "approve", expectedVersion: version })))
        .status,
      404,
    );

    const noExposure = createPrismHandler({ agents: { support: agent }, authorize: () => authorization });
    assert.equal((await noExposure(new Request(`https://example.test/prism/agents/support/runs/${started.runId}`))).status, 404);
  });

  it("accepts a shared decision batch on the agent resume endpoint under the same CAS rules", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    let turn = 0;
    const agent = createAgent({
      id: "batch-support",
      model: { provider: "mock", model: "offline" },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: 1 }) };
            yield { type: "tool_call" as const, call: toolCallContent("call-2", "write", { value: 2 }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      store,
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: ++calls }) }],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
    const handler = createPrismHandler({
      agents: { "batch-support": agent },
      agentRuns: { "batch-support": { lifecycle } },
      authorize: () => authorization,
    });
    const suspended = await handler(jsonRequest("/prism/agents/batch-support/runs", { input: "go" }));
    const started = (await suspended.json()) as { status: string; runId: string; runState: { version: number } };
    assert.equal(started.status, "suspended");
    const status = await handler(new Request(`https://example.test/prism/agents/batch-support/runs/${started.runId}`));
    const publicState = JSON.parse(await status.text()) as {
      version: number;
      state: { interruption?: { pendingDecisions?: readonly { approvalId: string }[] } };
    };
    const pending = publicState.state.interruption!.pendingDecisions!;
    assert.equal(pending.length, 2);

    const resumed = await handler(
      jsonRequest(`/prism/agents/batch-support/runs/${started.runId}/resume`, {
        expectedVersion: publicState.version,
        decisions: pending.map((decision) => ({ approvalId: decision.approvalId, outcome: "allow_once" })),
      }),
    );
    assert.equal(resumed.status, 200, await resumed.clone().text());
    assert.equal(((await resumed.json()) as { status: string }).status, "succeeded");
    assert.equal(calls, 2);

    // Boundary rejects malformed batches without touching the run.
    for (const body of [
      { expectedVersion: publicState.version, decisions: [] },
      { expectedVersion: publicState.version, decisions: [{ outcome: "allow_once" }] },
      { expectedVersion: publicState.version, decisions: [{ approvalId: "a", outcome: "sideways" }] },
      { expectedVersion: publicState.version, decision: "approve", decisions: [{ approvalId: "a", outcome: "allow_once" }] },
    ]) {
      const bad = await handler(jsonRequest(`/prism/agents/batch-support/runs/${started.runId}/resume`, body));
      assert.equal(bad.status, 400, JSON.stringify(body));
    }
  });

  it("accepts editable durable approvals with modifiedArguments, validating schemas and CAS", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const executed: string[] = [];
    let turn = 0;
    const agent = createAgent({
      id: "editable-support",
      model: { provider: "mock", model: "offline" },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "initial" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      store,
      validator: (_tool: unknown, args: unknown) =>
        typeof (args as { value?: unknown }).value === "string" ? undefined : "value must be a string",
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (args: unknown, context: { toolCallId: string }) => {
            executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "write", value: "done" };
          },
        },
      ],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
    const handler = createPrismHandler({
      agents: { "editable-support": agent },
      agentRuns: { "editable-support": { lifecycle } },
      authorize: () => authorization,
    });

    const suspended = await handler(jsonRequest("/prism/agents/editable-support/runs", { input: "go" }));
    const started = (await suspended.json()) as { status: string; runId: string; runState: { version: number } };
    assert.equal(started.status, "suspended");

    const statusResp = await handler(new Request(`https://example.test/prism/agents/editable-support/runs/${started.runId}`));
    const statusData = JSON.parse(await statusResp.text()) as {
      version: number;
      state: { interruption?: { pendingDecisions?: readonly { approvalId: string }[] } };
    };
    const pendingApprovalId = statusData.state.interruption!.pendingDecisions![0]!.approvalId;
    const initialVersion = statusData.version;

    // 1. Malformed modifiedArguments fail closed (non-object -> 400)
    for (const bad of ["not-an-object", 123, true, [1, 2]]) {
      const badResp = await handler(
        jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
          expectedVersion: initialVersion,
          decision: "approve",
          modifiedArguments: bad,
        }),
      );
      assert.equal(badResp.status, 400);
    }

    // 2. Deny cannot carry modifiedArguments -> 400
    const denyWithEdits = await handler(
      jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
        expectedVersion: initialVersion,
        decision: "deny",
        modifiedArguments: { value: "rejected" },
      }),
    );
    assert.equal(denyWithEdits.status, 400);

    // 3. Schema rejection fails closed with 400 (rejection before CAS)
    const invalidArgsResp = await handler(
      jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
        expectedVersion: initialVersion,
        decision: "approve",
        modifiedArguments: { value: 12345 }, // validator expects string
      }),
    );
    assert.equal(invalidArgsResp.status, 400);
    assert.equal(executed.length, 0); // nothing executed

    // Verify still suspended at initialVersion
    const checkState = await lifecycle.status({ runId: started.runId }, { ownership: authorization.ownership });
    assert.equal(checkState.version, initialVersion);
    assert.equal(checkState.state.status, "suspended");

    // 4. Foreign approvalId -> 400
    const foreignResp = await handler(
      jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
        expectedVersion: initialVersion,
        decision: "approve",
        approvalId: "foreign-id",
        modifiedArguments: { value: "ok" },
      }),
    );
    assert.equal(foreignResp.status, 400);

    // 5. Successful approve with modifiedArguments (without explicit approvalId - inferred from single pending)
    const successResp = await handler(
      jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
        expectedVersion: initialVersion,
        decision: "approve",
        modifiedArguments: { value: "edited-payload" },
      }),
    );
    assert.equal(successResp.status, 200);
    const successBody = (await successResp.json()) as { status: string };
    assert.equal(successBody.status, "succeeded");
    assert.equal(executed.length, 1);
    assert.equal(executed[0], 'call-1:{"value":"edited-payload"}');

    // 6. Replay of accepted decision / stale expectedVersion fails closed
    // Without approvalId on completed run: 0 pending decisions -> 400
    const replayNoIdResp = await handler(
      jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
        expectedVersion: initialVersion,
        decision: "approve",
        modifiedArguments: { value: "replay" },
      }),
    );
    assert.equal(replayNoIdResp.status, 400);

    // With explicit approvalId on completed run: CAS / state mismatch -> 404
    const replayWithIdResp = await handler(
      jsonRequest(`/prism/agents/editable-support/runs/${started.runId}/resume`, {
        expectedVersion: initialVersion,
        decision: "approve",
        approvalId: pendingApprovalId,
        modifiedArguments: { value: "replay" },
      }),
    );
    assert.equal(replayWithIdResp.status, 404);

    // 7. Multiple pending decisions: omitting approvalId fails closed with 400
    let multiTurn = 0;
    const multiExecuted: string[] = [];
    const multiCheckpoints = createMemoryCheckpointStore();
    const multiAgent = createAgent({
      id: "multi-editable",
      model: { provider: "mock", model: "offline" },
      provider: {
        id: "mock",
        async *generate() {
          if (++multiTurn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-a", "write", { value: "a" }) };
            yield { type: "tool_call" as const, call: toolCallContent("call-b", "write", { value: "b" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      store: createMemorySessionStore(),
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (args: unknown, context: { toolCallId: string }) => {
            multiExecuted.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "write", value: "done" };
          },
        },
      ],
      runState: { checkpoints: multiCheckpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const multiLifecycle = createAgentRunLifecycle({
      checkpoints: multiCheckpoints,
      resolveAgent: () => ({ agent: multiAgent, definitionRevision: "1" }),
    });
    const multiHandler = createPrismHandler({
      agents: { "multi-editable": multiAgent },
      agentRuns: { "multi-editable": { lifecycle: multiLifecycle } },
      authorize: () => authorization,
    });
    const multiSuspended = await multiHandler(jsonRequest("/prism/agents/multi-editable/runs", { input: "go" }));
    const multiStarted = (await multiSuspended.json()) as { runId: string; runState: { version: number } };

    // Ambiguous inference on 2 pending decisions -> 400
    const ambiguousResp = await multiHandler(
      jsonRequest(`/prism/agents/multi-editable/runs/${multiStarted.runId}/resume`, {
        expectedVersion: multiStarted.runState.version,
        decision: "approve",
        modifiedArguments: { value: "x" },
      }),
    );
    assert.equal(ambiguousResp.status, 400);

    // Providing explicit approvalId for one decision works
    const multiStatus = await multiLifecycle.status({ runId: multiStarted.runId }, { ownership: authorization.ownership });
    const p0 = multiStatus.state.interruption!.pendingDecisions![0]!.approvalId;
    const p1 = multiStatus.state.interruption!.pendingDecisions![1]!.approvalId;
    const explicitResp = await multiHandler(
      jsonRequest(`/prism/agents/multi-editable/runs/${multiStarted.runId}/resume`, {
        expectedVersion: multiStarted.runState.version,
        decision: "approve",
        approvalId: p0,
        modifiedArguments: { value: "explicit-edited" },
      }),
    );
    // Partial decision leaves run suspended
    assert.equal(explicitResp.status, 200);
    const explicitBody = (await explicitResp.json()) as { status: string; runState: { version: number } };
    assert.equal(explicitBody.status, "suspended");

    // Resolve the remaining decision
    const finishResp = await multiHandler(
      jsonRequest(`/prism/agents/multi-editable/runs/${multiStarted.runId}/resume`, {
        expectedVersion: explicitBody.runState.version,
        decision: "approve",
        approvalId: p1,
        modifiedArguments: { value: "b-edited" },
      }),
    );
    assert.equal(finishResp.status, 200);
    assert.equal(((await finishResp.json()) as { status: string }).status, "succeeded");
    assert.equal(multiExecuted.length, 2);
    assert.equal(multiExecuted[0], 'call-a:{"value":"explicit-edited"}');
    assert.equal(multiExecuted[1], 'call-b:{"value":"b-edited"}');
  });

  it("runs, loads, resumes, and cancels durable workflow checkpoints", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      revision: "1",
      id: "publish",
      nodes: {
        review: functionNode({
          execute: (ctx) => (ctx.resume ? { approved: ctx.resume.input } : suspend({ reason: "review", resumeSchema: { type: "object" } })),
        }),
      },
      edges: [],
    });
    const handler = createPrismHandler({
      workflows: { publish: { definition: workflow, checkpoints, runOptions: { validateResume: () => undefined } } },
      authorize: () => authorization,
    });

    const started = await handler(jsonRequest("/prism/workflows/publish/runs", { input: {}, runId: "run-1" }));
    assert.equal(started.status, 200);
    const suspended = (await started.json()) as { status: string; version: number };
    assert.equal(suspended.status, "suspended");

    const status = await handler(new Request("https://example.test/prism/workflows/publish/runs/run-1"));
    assert.equal(status.status, 200);
    const checkpoint = (await status.json()) as { version: number; value: { status: string } };
    assert.equal(checkpoint.value.status, "suspended");

    const resumed = await handler(
      jsonRequest("/prism/workflows/publish/runs/run-1/resume", {
        decision: "approve",
        input: { reviewer: "host" },
        expectedVersion: checkpoint.version,
      }),
    );
    assert.equal(resumed.status, 200, await resumed.clone().text());
    assert.equal(((await resumed.json()) as { status: string }).status, "succeeded");

    await handler(jsonRequest("/prism/workflows/publish/runs", { input: {}, runId: "run-2" }));
    const cancelled = await handler(new Request("https://example.test/prism/workflows/publish/runs/run-2", { method: "DELETE" }));
    assert.equal(cancelled.status, 200);
    assert.equal(((await cancelled.json()) as { aborted: boolean }).aborted, true);
  });

  it("enqueues background runs and creates lineage-linked replays", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let calls = 0;
    const workflow = defineWorkflow({
      revision: "1",
      id: "background",
      nodes: { work: functionNode({ execute: () => ++calls }) },
    });
    const handler = createPrismHandler({
      workflows: { background: { definition: workflow, checkpoints } },
      authorize: () => authorization,
    });
    const queued = await handler(jsonRequest("/prism/workflows/background/enqueue", { input: {}, runId: "queued-1" }));
    assert.equal(queued.status, 202);
    assert.equal(((await queued.json()) as { status: string }).status, "queued");

    const sourceResponse = await handler(jsonRequest("/prism/workflows/background/runs", { input: {}, runId: "source-1" }));
    assert.equal(sourceResponse.status, 200);
    const replayed = await handler(
      jsonRequest("/prism/workflows/background/runs/source-1/replay", { fromNodeId: "work", runId: "replay-1" }),
    );
    assert.equal(replayed.status, 200, await replayed.clone().text());
    const result = (await replayed.json()) as { status: string; lineage: { sourceRunId: string } };
    assert.equal(result.status, "succeeded");
    assert.equal(result.lineage.sourceRunId, "source-1");
    assert.equal(calls, 2);
  });

  it("serves only explicitly registered ownership-scoped schedules", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({ revision: "1", id: "scheduled", nodes: { work: functionNode({ execute: () => true }) } });
    const schedules = createWorkflowSchedules({
      store: createMemoryCheckpointStore(),
      leases: createMemoryLeaseStore(),
      checkpoints,
      workflows: { scheduled: workflow },
      ownership: authorization.ownership,
      ownerId: "server",
    });
    const handler = createPrismHandler({ schedules, authorize: () => authorization });
    const created = await handler(
      jsonRequest("/prism/schedules/daily", {
        workflowId: "scheduled",
        nextRunAt: "2026-01-01T00:00:00.000Z",
        intervalMs: 60_000,
      }),
    );
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal(((await created.json()) as { id: string }).id, "daily");
    assert.equal((await handler(jsonRequest("/prism/schedules/daily/pause", {}))).status, 200);
    assert.equal((await handler(jsonRequest("/prism/schedules/daily/resume", { nextRunAt: "2026-01-02T00:00:00.000Z" }))).status, 200);
    assert.equal((await handler(jsonRequest("/prism/schedules/daily/trigger", { idempotencyKey: "manual-1" }))).status, 200);
    const listed = await handler(new Request("https://example.test/prism/schedules?status=active"));
    assert.equal(listed.status, 200);
    assert.equal(((await listed.json()) as { items: unknown[] }).items.length, 1);
    assert.equal((await handler(new Request("https://example.test/prism/schedules/daily", { method: "DELETE" }))).status, 200);
    assert.equal(
      (
        await handler(
          jsonRequest("/prism/schedules/bad", {
            workflowId: "scheduled",
            nextRunAt: "not-a-date",
          }),
        )
      ).status,
      400,
    );

    const forbidden = createPrismHandler({
      schedules,
      authorize: () => ({ ownership: { tenantId: "other", userId: "other" } }),
    });
    assert.equal((await forbidden(new Request("https://example.test/prism/schedules"))).status, 403);
  });

  it("streams workflow events and releases its concurrency slot", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      revision: "1",
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
    const workflow = defineWorkflow({ revision: "1", id: "safe", nodes: { one: functionNode({ execute: () => 1 }) }, edges: [] });
    const handler = createPrismHandler({
      agents: { allowed: mockAgent() },
      workflows: { safe: { definition: workflow, checkpoints } },
      authorize: ({ request }) => (request.headers.get("authorization") === "Bearer ok" ? authorization : false),
      allowedHosts: ["example.test"],
      allowedOrigins: ["https://app.test"],
      limits: { maxRequestBytes: 64 },
    });

    assert.equal((await handler(jsonRequest("/prism/agents/allowed/runs", { input: "x" }))).status, 403);
    assert.equal(
      (await handler(jsonRequest("/prism/agents/missing/runs", { input: "x" }, { headers: { authorization: "Bearer ok" } }))).status,
      404,
    );
    assert.equal(
      (
        await handler(
          new Request("https://example.test/prism/agents/allowed/runs", {
            method: "POST",
            body: "{}",
            headers: { authorization: "Bearer ok" },
          }),
        )
      ).status,
      415,
    );
    assert.equal(
      (await handler(jsonRequest("/prism/agents/allowed/runs", { input: "x".repeat(100) }, { headers: { authorization: "Bearer ok" } })))
        .status,
      413,
    );
    assert.equal(
      (
        await handler(
          jsonRequest("/prism/agents/allowed/runs", { input: "x" }, { headers: { authorization: "Bearer ok", host: "evil.test" } }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await handler(
          jsonRequest(
            "/prism/agents/allowed/runs",
            { input: "x" },
            { headers: { authorization: "Bearer ok", origin: "https://evil.test" } },
          ),
        )
      ).status,
      403,
    );

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
            request.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
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
