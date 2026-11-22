import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type PackageAPI,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import workflows, {
  AGENT_JOB_WORKFLOW_ID,
  type AgentJobSpec,
  createMemoryWorkflowCheckpoints,
  resumeAgentJob,
  runAgentJob,
  type WorkflowCheckpointAdapter,
} from "../index.js";

type Turn = (request: ProviderRequest, index: number) => readonly ProviderEvent[] | "hang";

/** A provider scripted per model turn; `"hang"` never answers until the run is aborted. */
function scripted(turn: Turn, requests: ProviderRequest[] = []): ModelProvider {
  let index = 0;
  return {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      const events = turn(request, index++);
      if (events === "hang") {
        await new Promise((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason)));
        return;
      }
      yield* events;
    },
  };
}

const text = (value: string): readonly ProviderEvent[] => [providerTextDelta(value), providerDone({ inputTokens: 10, outputTokens: 2 })];

async function agentWith(
  provider: ModelProvider,
  options: { store?: SessionStore; extra?: Parameters<typeof createAgent>[0] } = {},
): Promise<{ agent: Agent; prism: () => PackageAPI; events: { name: string; data: Record<string, unknown> }[] }> {
  let api: PackageAPI | undefined;
  const events: { name: string; data: Record<string, unknown> }[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "m" },
    slots: { store: options.store ?? createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.package === "@arnilo/prism-extensions/workflows" && event.name.startsWith("job.")) {
          events.push({ name: event.name, data: event.data as Record<string, unknown> });
        }
      }),
    ...options.extra,
    packages: [
      providerPackage("p", [provider]),
      workflows,
      definePackage({ name: "job-host", version: "1.0.0", requires: { api: 2 }, setup: (prism) => void (api = prism) }),
      ...((options.extra?.packages as []) ?? []),
    ],
  });
  return { agent, prism: () => api!, events };
}

const baseSpec = (checkpoints: WorkflowCheckpointAdapter): Omit<AgentJobSpec, "done"> => ({
  input: "Start the migration.",
  next: () => "Keep going.",
  checkpoints,
  retry: { baseMs: 0, maxMs: 0 },
});

describe("agent job driver (plan 239 Task 10)", () => {
  it("job_runs_until_done", async () => {
    const replies = ["migrated service a", "migrated service b", "ALL SERVICES MIGRATED"];
    const { agent, prism, events } = await agentWith(scripted((_r, i) => text(replies[i] ?? "extra")));
    const session = await agent.session();
    const result = await runAgentJob(session, {
      ...baseSpec(createMemoryWorkflowCheckpoints()),
      prism: prism(),
      done: ({ lastRunResult }) => lastRunResult?.text.includes("ALL SERVICES MIGRATED") ?? false,
    });
    assert.equal(result.status, "done");
    assert.equal(result.reason, "done");
    assert.equal(result.runs, 3);
    assert.equal(result.usage.inputTokens, 30);
    assert.equal(result.lastRun?.text, "ALL SERVICES MIGRATED");
    const users = (await session.messages()).filter((m) => m.role === "user").map((m) => (m.content[0] as { text: string }).text);
    assert.deepEqual(users, ["Start the migration.", "Keep going.", "Keep going."]);
    assert.deepEqual(
      events.map((event) => event.name),
      ["job.started", "job.run", "job.run", "job.run", "job.stopped"],
    );
    assert.equal(events.at(-1)?.data.reason, "done");
    assert.equal(events[0]?.data.sessionId, session.id);
    await agent.dispose();
  });

  it("job_stops_on_session_limit", async () => {
    const { agent } = await agentWith(
      scripted((_r, i) => text(`reply ${i}`)),
      { extra: { sessionLimits: { maxRuns: 2 } } as never },
    );
    const session = await agent.session();
    const result = await runAgentJob(session, { ...baseSpec(createMemoryWorkflowCheckpoints()), done: () => false });
    assert.equal(result.status, "stopped");
    assert.equal(result.reason, "session_limit");
    assert.equal(result.runs, 2);
    await agent.dispose();
  });

  it("job_stops_after_consecutive_failures_with_backoff", async () => {
    const requests: ProviderRequest[] = [];
    const failure: readonly ProviderEvent[] = [{ type: "error", error: { message: "down", code: "down", failureClass: "permanent" } }];
    const { agent } = await agentWith(scripted(() => failure, requests));
    const session = await agent.session();
    const started = Date.now();
    const result = await runAgentJob(session, {
      ...baseSpec(createMemoryWorkflowCheckpoints()),
      retry: { baseMs: 20, maxMs: 30 },
      done: () => false,
    });
    const elapsed = Date.now() - started;
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "max_consecutive_failures");
    assert.equal(result.runs, 3);
    // Waits of 20 ms then 40 ms capped at 30 ms before the second and third runs.
    assert.ok(elapsed >= 45, `backoff waited ${elapsed} ms`);
    // A failed run is continued, not re-sent: the first message is the only user message.
    assert.equal((await session.messages()).filter((m) => m.role === "user").length, 1);
    assert.equal(requests.length, 3);
    await agent.dispose();
  });

  it("job_stops_on_identical_outcomes", async () => {
    const { agent } = await agentWith(scripted(() => text("no change")));
    const session = await agent.session();
    const result = await runAgentJob(session, { ...baseSpec(createMemoryWorkflowCheckpoints()), done: () => false });
    assert.equal(result.status, "stopped");
    assert.equal(result.reason, "max_identical_outcomes");
    assert.equal(result.runs, 3);
    await agent.dispose();
  });

  it("job_resumes_after_restart_and_continues_the_in_flight_run", async () => {
    const store = createMemorySessionStore();
    const checkpoints = createMemoryWorkflowCheckpoints();
    let reached!: () => void;
    const inFlight = new Promise<void>((resolve) => (reached = resolve));
    // Process A: run 1 completes; run 2 starts and the process "dies" inside its model turn.
    const processA = await agentWith(
      scripted((_r, i) => {
        if (i === 0) return text("first part done");
        reached();
        return "hang";
      }),
      { store },
    );
    const sessionA = await processA.agent.session({ id: "job-session", create: true });
    const controllerA = new AbortController();
    const jobA = runAgentJob(sessionA, {
      ...baseSpec(checkpoints),
      jobId: "job-1",
      signal: controllerA.signal,
      done: ({ lastRunResult }) => lastRunResult?.text === "FINISHED",
    });
    await inFlight;

    // Process B: a fresh agent over the same stores resumes the job.
    const requestsB: ProviderRequest[] = [];
    const processB = await agentWith(
      scripted(() => text("FINISHED"), requestsB),
      { store },
    );
    const sessionB = await processB.agent.session({ id: "job-session" });
    const result = await resumeAgentJob(
      sessionB,
      { ...baseSpec(checkpoints), done: ({ lastRunResult }) => lastRunResult?.text === "FINISHED" },
      "job-1",
    );
    assert.equal(result.status, "done");
    assert.equal(result.runs, 2);
    assert.equal(requestsB.length, 1, "one model turn: the in-flight run is continued");
    assert.equal(requestsB[0]?.messages.at(-1)?.role, "user");
    const users = (await sessionB.messages()).filter((m) => m.role === "user");
    assert.equal(users.length, 2, "the in-flight run's message is not sent again");

    controllerA.abort("process A is gone");
    await jobA.catch(() => undefined);
    await processA.agent.dispose();
    await processB.agent.dispose();
  });

  it("job_suspends_on_approval_and_resumes", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const provider = scripted((_r, i) =>
      i === 0 ? [{ type: "tool_call", call: toolCallContent("c1", "write", {}) }, providerDone()] : text("DONE"),
    );
    const { agent } = await agentWith(provider, {
      extra: {
        hooks: askEveryTool(),
        tools: {
          add: [
            {
              name: "write",
              parameters: {},
              execute: (_a: unknown, c: { toolCallId: string }) => ({ toolCallId: c.toolCallId, name: "write", value: "written" }),
            },
          ],
        },
      } as never,
    });
    const session = await agent.session();
    const spec = {
      ...baseSpec(checkpoints),
      done: ({ lastRunResult }: { lastRunResult?: { text: string } }) => lastRunResult?.text === "DONE",
    };
    const suspended = await runAgentJob(session, { ...spec, jobId: "job-approval" });
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.reason, "approval_required");
    assert.equal(suspended.pending?.length, 1);

    // Without decisions the job stays suspended and reports the same pending decision.
    const still = await resumeAgentJob(session, spec, "job-approval");
    assert.equal(still.status, "suspended");
    assert.equal(still.pending?.[0]?.approvalId, suspended.pending?.[0]?.approvalId);

    const resumed = await resumeAgentJob(session, spec, "job-approval", {
      decisions: [{ approvalId: suspended.pending?.[0]?.approvalId, outcome: "allow_once" }],
    });
    assert.equal(resumed.status, "done");
    assert.equal(resumed.runs, 1);
    await agent.dispose();
  });

  it("job_unbounded_runs_with_null_max_runs", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const { agent } = await agentWith(scripted((_r, i) => text(`reply ${i}`)));
    const session = await agent.session();
    const result = await runAgentJob(session, {
      ...baseSpec(checkpoints),
      jobId: "job-long",
      maxRuns: null,
      done: ({ runs }) => runs >= 150,
    });
    assert.equal(result.status, "done");
    assert.equal(result.runs, 150, "past the default maxRuns of 100");
    await agent.dispose();
  });

  it("job_stops_at_max_runs", async () => {
    const { agent } = await agentWith(scripted((_r, i) => text(`reply ${i}`)));
    const session = await agent.session();
    const result = await runAgentJob(session, { ...baseSpec(createMemoryWorkflowCheckpoints()), maxRuns: 4, done: () => false });
    assert.equal(result.reason, "max_runs");
    assert.equal(result.runs, 4);
    await agent.dispose();
  });

  it("job_checkpoint_stays_bounded_over_1000_supersteps", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const { agent } = await agentWith(scripted((_r, i) => text(`reply ${i}`)));
    const session = await agent.session();
    const sizes: number[] = [];
    const result = await runAgentJob(session, {
      ...baseSpec(checkpoints),
      jobId: "job-bounded",
      maxRuns: null,
      done: async ({ runs }) => {
        const record = await checkpoints.load({ workflowId: AGENT_JOB_WORKFLOW_ID, runId: "job-bounded" });
        sizes.push(JSON.stringify(record?.value).length);
        return runs >= 500;
      },
    });
    assert.equal(result.runs, 500);
    const record = await checkpoints.load({ workflowId: AGENT_JOB_WORKFLOW_ID, runId: "job-bounded" });
    assert.ok((record?.value.execution?.superstep ?? 0) >= 1000, "1,000 supersteps ran");
    // Only counters and ids change width; without `maxIterationRecords` the ledger adds ~700 bytes per run.
    assert.ok(sizes.at(-1)! <= sizes[10]! + 256, `checkpoint grew from ${sizes[10]} to ${sizes.at(-1)} bytes`);
    await agent.dispose();
  }, 60_000);
});
