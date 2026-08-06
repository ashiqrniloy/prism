/**
 * Phase 8 network-free conformance (plan 008 Task 7).
 * Cross-cuts Task 0 matrices; unit suites remain authoritative per-package.
 * Nested-agent approvals: packages/supervisor nested-approvals (memory CAS is single-process).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { EventSchemas, EventType } from "@ag-ui/core";
import {
  AgentDecisionError,
  AgentLoopStateError,
  AgentRunStateError,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  HARD_MAX_AGENT_RUN_STATE_BYTES,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../dist/index.js";
import {
  A2UI_ACTIVITY_TYPE,
  composeAgUiProjections,
  createActivityFromToolProgressProjection,
  createAgUiEventMapper,
  createMessagesFromSessionProjection,
  createStateFromStoreProjection,
} from "../packages/ag-ui/dist/index.js";

const catalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";

function durable(checkpoints, extra = {}) {
  return { checkpoints, definitionRevision: "1", interruptBeforeTool: true, ...extra };
}

function parallelProvider(count = 2) {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        for (let i = 0; i < count; i += 1) {
          yield { type: "tool_call", call: toolCallContent(`c${i}`, "write", { i }) };
        }
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

function writeAgent(checkpoints, provider = parallelProvider(), loop, validator) {
  const executed = [];
  const agent = createAgent({
    id: "phase8-conformance",
    model: { provider: "mock", model: "demo" },
    store: createMemorySessionStore(),
    provider,
    ...(loop ? { loop } : {}),
    ...(validator ? { validator } : {}),
    tools: [
      {
        name: "write",
        parameters: {},
        execute: (args, context) => {
          executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
          return { toolCallId: context.toolCallId, name: "write", value: "ok" };
        },
      },
    ],
  });
  return { agent, executed, checkpoints };
}

describe("Phase 8 conformance", () => {
  it("rejects hook-less custom loops on durable runs before any provider call", async () => {
    let providerCalls = 0;
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "hookless",
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          providerCalls += 1;
          yield providerDone();
        },
      },
      loop: {
        name: "bare",
        async run(ctx) {
          await ctx.generate(await ctx.assemble([]));
        },
      },
    });
    await assert.rejects(
      () => agent.createSession().run("go", { runState: { checkpoints, definitionRevision: "1" } }),
      (error) => error instanceof AgentLoopStateError && error.code === "ERR_PRISM_LOOP_NOT_DURABLE",
    );
    assert.equal(providerCalls, 0);
  });

  it("restores custom-loop snapshot across batch approval; revision bump fails closed", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const state = { turns: 0, restored: null };
    const loop = {
      name: "research",
      revision: "1",
      snapshot: () => ({ turns: state.turns }),
      restore: (snapshot) => {
        state.restored = snapshot;
        state.turns = snapshot.turns;
      },
      async run(ctx) {
        state.turns += 1;
        const { calls } = await ctx.generate(await ctx.assemble([]));
        await ctx.chargeToolRound?.(calls);
        for (const call of calls) await ctx.dispatchToolCall(call);
      },
    };
    const { agent, executed } = writeAgent(checkpoints, parallelProvider(2), loop);
    const first = await agent.createSession({ id: "loop-s" }).run("go", { runState: durable(checkpoints) });
    assert.equal(first.status, "suspended");
    assert.equal(first.interruption.pendingDecisions.length, 2);

    const done = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState.version,
        decisions: first.interruption.pendingDecisions.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" })),
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(done.status, "succeeded");
    assert.equal(executed.length, 2);
    assert.deepEqual(state.restored, { turns: 1 });

    // Revision bump changes fingerprint → fail closed before restore.
    const drifted = createMemoryCheckpointStore();
    const driftState = { turns: 0 };
    const driftLoop = {
      name: "research",
      revision: "1",
      snapshot: () => ({ turns: driftState.turns }),
      restore: (s) => {
        driftState.turns = s.turns;
      },
      async run(ctx) {
        driftState.turns += 1;
        const { calls } = await ctx.generate(await ctx.assemble([]));
        await ctx.chargeToolRound?.(calls);
        for (const call of calls) await ctx.dispatchToolCall(call);
      },
    };
    const { agent: a2 } = writeAgent(drifted, parallelProvider(1), driftLoop);
    const suspended = await a2.createSession({ id: "drift" }).run("go", { runState: durable(drifted) });
    driftLoop.revision = "2";
    await assert.rejects(
      () =>
        resumeAgentRun(
          a2,
          { runId: suspended.runId, sessionId: suspended.sessionId },
          {
            expectedVersion: suspended.runState.version,
            decisions: suspended.interruption.pendingDecisions.map((d) => ({
              approvalId: d.approvalId,
              outcome: "allow_once",
            })),
          },
          { checkpoints: drifted, definitionRevision: "1" },
        ),
      (error) => error instanceof AgentRunStateError || (error instanceof AgentLoopStateError && error.code === "ERR_PRISM_LOOP_REVISION"),
    );
  });

  it("decision CAS: parallel batch, partial re-suspend, stale/unknown/duplicate fail closed", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const { agent, executed } = writeAgent(checkpoints);
    const first = await agent.createSession({ id: "cas" }).run("go", { runState: durable(checkpoints) });
    assert.equal(first.status, "suspended");
    const pending = first.interruption.pendingDecisions;
    assert.equal(pending.length, 2);
    const ref = { runId: first.runId, sessionId: first.sessionId };
    const options = { checkpoints, definitionRevision: "1" };

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { expectedVersion: 999, decisions: [{ approvalId: pending[0].approvalId, outcome: "allow_once" }] },
          options,
        ),
      (error) =>
        (error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_STALE") ||
        (error instanceof AgentRunStateError && /[Ss]tale/.test(error.message)),
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          {
            expectedVersion: first.runState.version,
            decisions: [
              { approvalId: pending[0].approvalId, outcome: "allow_once" },
              { approvalId: pending[0].approvalId, outcome: "allow_once" },
            ],
          },
          options,
        ),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_DUPLICATE",
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { expectedVersion: first.runState.version, decisions: [{ approvalId: "foreign_id", outcome: "allow_once" }] },
          options,
        ),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_UNKNOWN",
    );

    const partial = await resumeAgentRun(
      agent,
      ref,
      { expectedVersion: first.runState.version, decisions: [{ approvalId: pending[0].approvalId, outcome: "allow_once" }] },
      options,
    );
    assert.equal(partial.status, "suspended");
    assert.equal(partial.interruption.pendingDecisions.length, 1);
    assert.equal(executed.length, 0);

    const done = await resumeAgentRun(
      agent,
      ref,
      {
        expectedVersion: partial.runState.version,
        decisions: [{ approvalId: pending[1].approvalId, outcome: "allow_once" }],
      },
      options,
    );
    assert.equal(done.status, "succeeded");
    assert.equal(executed.length, 2);
  });

  it("sticky allow_for_run matches exact args; reject_for_run blocks; modified args revalidate", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let turn = 0;
    const provider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call", call: toolCallContent("call-1", "write", { value: "same" }) };
          yield providerDone();
          return;
        }
        if (turn === 2) {
          yield { type: "tool_call", call: toolCallContent("call-2", "write", { value: "same" }) };
          yield { type: "tool_call", call: toolCallContent("call-3", "write", { value: "different" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const { agent, executed } = writeAgent(checkpoints, provider);
    const first = await agent.createSession({ id: "sticky" }).run("go", { runState: durable(checkpoints) });
    const second = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState.version,
        decisions: [{ approvalId: first.interruption.pendingDecisions[0].approvalId, outcome: "allow_for_run" }],
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(second.status, "suspended");
    assert.equal(executed.length, 2); // call-1 + sticky call-2
    assert.equal(second.interruption.pendingDecisions.length, 1);

    const done = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: second.runState.version,
        decisions: [{ approvalId: second.interruption.pendingDecisions[0].approvalId, outcome: "reject_for_run", reason: "nope" }],
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(done.status, "succeeded");
    assert.equal(executed.length, 2); // call-3 rejected

    // Modified arguments revalidation
    const c2 = createMemoryCheckpointStore();
    const { agent: modAgent, executed: modExec } = writeAgent(c2, parallelProvider(1), undefined, (_tool, args) =>
      typeof args.value === "string" ? undefined : "value must be a string",
    );
    const sus = await modAgent.createSession({ id: "mod" }).run("go", { runState: durable(c2) });
    await assert.rejects(
      () =>
        resumeAgentRun(
          modAgent,
          { runId: sus.runId, sessionId: sus.sessionId },
          {
            expectedVersion: sus.runState.version,
            decisions: [
              {
                approvalId: sus.interruption.pendingDecisions[0].approvalId,
                outcome: "allow_once",
                modifiedArguments: { value: 42 },
              },
            ],
          },
          { checkpoints: c2, definitionRevision: "1" },
        ),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const ok = await resumeAgentRun(
      modAgent,
      { runId: sus.runId, sessionId: sus.sessionId },
      {
        expectedVersion: sus.runState.version,
        decisions: [
          {
            approvalId: sus.interruption.pendingDecisions[0].approvalId,
            outcome: "allow_once",
            modifiedArguments: { value: "edited" },
          },
        ],
      },
      { checkpoints: c2, definitionRevision: "1" },
    );
    assert.equal(ok.status, "succeeded");
    assert.deepEqual(modExec, ['c0:{"value":"edited"}']);
  });

  it("elicitation pending decisions resolve without tool execution", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let executed = 0;
    let turn = 0;
    const agent = createAgent({
      id: "elicit",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call", call: toolCallContent("ask-1", "ask", { q: "pick" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "ask",
          parameters: {},
          elicitation: () => ({
            schema: { type: "object", properties: { choice: { type: "string" } }, required: ["choice"] },
            reason: "choose",
            validate: (payload) => {
              if (payload.choice !== "yes" && payload.choice !== "no") throw new Error("bad");
            },
          }),
          execute: () => {
            executed += 1;
            return { toolCallId: "ask-1", name: "ask", value: "should-not-run" };
          },
        },
      ],
    });
    const first = await agent.createSession({ id: "el" }).run("go", { runState: durable(checkpoints) });
    assert.equal(first.status, "suspended");
    assert.equal(first.interruption.kind, "elicitation");
    assert.equal(first.interruption.pendingDecisions[0].kind, "elicitation");
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: first.runId, sessionId: first.sessionId },
          {
            expectedVersion: first.runState.version,
            decisions: [
              {
                approvalId: first.interruption.pendingDecisions[0].approvalId,
                outcome: "allow_once",
                elicitation: { choice: "maybe" },
              },
            ],
          },
          { checkpoints, definitionRevision: "1" },
        ),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const done = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState.version,
        decisions: [
          {
            approvalId: first.interruption.pendingDecisions[0].approvalId,
            outcome: "allow_once",
            elicitation: { choice: "yes" },
          },
        ],
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(done.status, "succeeded");
    assert.equal(executed, 0);
  });

  it("A2UI fixed-schema paint and standard projectors validate against EventSchemas", async () => {
    const mapper = createAgUiEventMapper({
      a2ui: { catalogId, mode: "fixed-schema" },
      projection: composeAgUiProjections(
        createMessagesFromSessionProjection({
          getMessages: () => [{ id: "m1", role: "user", content: "hi" }],
        }),
        createStateFromStoreProjection({
          get: () => ({ count: 0 }),
        }),
        createActivityFromToolProgressProjection(),
      ),
    });

    const start = await mapper.map({ type: "agent_started", sessionId: "s", runId: "r" });
    for (const event of start) assert.equal(EventSchemas.safeParse(event).success, true, event.type);

    const painted = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t1",
        name: "paint",
        value: {
          a2ui_operations: [
            { version: "v0.9", createSurface: { surfaceId: "card" } },
            {
              version: "v0.9",
              updateComponents: { surfaceId: "card", components: [{ id: "root", component: "Text", text: "hi" }] },
            },
          ],
        },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    const snapshot = painted.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT && e.activityType === A2UI_ACTIVITY_TYPE);
    assert.ok(snapshot);
    assert.equal(EventSchemas.safeParse(snapshot).success, true);

    const progress = await mapper.map({
      type: "tool_execution_progress",
      sessionId: "s",
      runId: "r",
      toolCallId: "t",
      name: "write",
      progress: { pct: 10 },
    });
    const activity = progress.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT && e.activityType === "tool-progress");
    assert.ok(activity);
    assert.equal(EventSchemas.safeParse(activity).success, true);

    const bad = await createAgUiEventMapper({ a2ui: { catalogId, mode: "fixed-schema" } }).map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t2",
        name: "paint",
        value: { a2ui_operations: [{ version: "v9", createSurface: { surfaceId: "x" } }] },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal(
      bad.some((e) => e.type === EventType.ACTIVITY_SNAPSHOT),
      false,
    );
  });

  it("durable run state with max practical pending stays under hard byte cap", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const blob = "x".repeat(180_000);
    const loop = {
      name: "fat",
      revision: "1",
      snapshot: () => ({ blob }),
      restore: () => {},
      async run(ctx) {
        const { calls } = await ctx.generate(await ctx.assemble([]));
        await ctx.chargeToolRound?.(calls);
        for (const call of calls) await ctx.dispatchToolCall(call);
      },
    };
    const { agent } = writeAgent(checkpoints, parallelProvider(32), loop);
    const first = await agent.createSession({ id: "size" }).run("go", {
      runState: durable(checkpoints, { maxStateBytes: HARD_MAX_AGENT_RUN_STATE_BYTES }),
    });
    assert.equal(first.status, "suspended");
    assert.equal(first.interruption.pendingDecisions.length, 32);
    const bytes = Buffer.byteLength(JSON.stringify(first.runState), "utf8");
    assert.ok(bytes <= HARD_MAX_AGENT_RUN_STATE_BYTES, `run state ${bytes} exceeds hard cap`);
  });

  it("packed Phase 8 examples run to completion", () => {
    for (const file of ["examples/ag-ui-a2ui.ts", "examples/durable-loops-and-approvals.ts"]) {
      const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
      assert.equal(result.status, 0, `${file} exited ${result.status}\n${result.stderr}`);
      assert.ok(result.stdout.trim().length > 0, `${file} produced no output`);
      const payload = JSON.parse(result.stdout.trim().split("\n").at(-1));
      if (file.includes("a2ui")) assert.equal(payload.painted, true);
      else {
        assert.equal(payload.status, "succeeded");
        assert.equal(payload.loopRestored, true);
        assert.deepEqual(payload.executed, ["a", "b"]);
      }
    }
  });
});
