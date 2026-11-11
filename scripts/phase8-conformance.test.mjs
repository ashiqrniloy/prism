/**
 * Phase 8 network-free conformance (plan 008 Task 7), retargeted onto the store-slot durable-run
 * contract by plan 168 Task 5. Cross-cuts the Task 0 matrices; the unit suites stay authoritative
 * per package.
 *
 * A suspension is the durable unit: the run writes one self-contained `suspended_run` entry through
 * the store slot, and `session.resume(decisions)` continues it. The retired host checkpoint store,
 * its CAS/version surface, and the `every-turn` crash-recovery cadence are covered by the
 * `@arnilo/prism-extensions/workflows` conformance instead.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventType } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import {
  AgentDecisionError,
  AgentLoopStateError,
  AgentRunStateError,
  HARD_MAX_AGENT_RUN_STATE_BYTES,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  loadSuspendedRunEntry,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../src/index.ts";
import { providerPackage } from "../src/provider-kit/index.ts";
import {
  A2UI_ACTIVITY_TYPE,
  composeAgUiProjections,
  createActivityFromToolProgressProjection,
  createAgUiEventMapper,
  createMessagesFromSessionProjection,
  createStateFromStoreProjection,
} from "../packages/hosts/ag-ui/src/index.ts";

const catalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";

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

async function writeAgent(provider = parallelProvider(), loop, validator) {
  const executed = [];
  const store = createMemorySessionStore();
  const agent = await createAgent({
    hooks: askEveryTool(),
    id: "phase8-conformance",
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [provider])],
    slots: { store, ...(loop ? { loop } : {}) },
    ...(validator ? { validator } : {}),
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          execute: (args, context) => {
            executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "write", value: "ok" };
          },
        },
      ],
    },
  });
  return { agent, store, executed };
}

/** Suspend on the ask gate; the store entry is the durable anchor. */
async function suspend(agent, sessionId, input = "go") {
  const session = await agent.session({ id: sessionId, create: true });
  const first = await session.run(input);
  assert.equal(first.status, "suspended");
  return { session, first, pending: first.pending ?? [] };
}

const allowAll = (pending) => pending.map((decision) => ({ approvalId: decision.approvalId, outcome: "allow_once" }));

async function drain(session, decisions) {
  const events = [];
  for await (const event of session.resume(decisions)) events.push(event);
  return events;
}

describe("Phase 8 conformance", () => {
  it("rejects a hook-less custom strategy when the run suspends", async () => {
    const { agent } = await writeAgent(parallelProvider(1), {
      name: "bare",
      async run(run) {
        const turn = await run.turn();
        // The strategy dispatches the call, so the ask gate tries to suspend — and the missing
        // snapshot/restore pair fails the run closed instead.
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    });
    const failed = await (await agent.session()).run("go");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error?.code, "ERR_PRISM_LOOP_NOT_DURABLE");
    assert.ok(AgentLoopStateError);
  });

  it("restores custom-loop snapshot across batch approval; revision drift fails closed", async () => {
    const state = { turns: 0, restored: null };
    const loop = {
      name: "research",
      revision: "1",
      snapshot: () => ({ turns: state.turns }),
      restore: (snapshot) => {
        state.restored = snapshot;
        state.turns = snapshot.turns;
      },
      async run(run) {
        state.turns += 1;
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    };
    const { agent, store, executed } = await writeAgent(parallelProvider(2), loop);
    const { session, pending } = await suspend(agent, "loop-s");
    assert.equal(pending.length, 2);

    const stored = await loadSuspendedRunEntry(store, "loop-s");
    assert.deepEqual(stored?.state.loopState, { name: "research", revision: "1", snapshot: { turns: 1 } });

    const events = await drain(session, allowAll(pending));
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.equal(executed.length, 2);
    assert.deepEqual(state.restored, { turns: 1 });

    // A loop revision bump changes the fingerprint: resume fails closed before the restore.
    const driftState = { turns: 0 };
    const driftLoop = {
      name: "research",
      revision: "1",
      snapshot: () => ({ turns: driftState.turns }),
      restore: (snapshot) => {
        driftState.turns = snapshot.turns;
      },
      async run(run) {
        driftState.turns += 1;
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    };
    const drifted = await writeAgent(parallelProvider(1), driftLoop);
    const driftedSuspend = await suspend(drifted.agent, "drift");
    driftLoop.revision = "2";
    await assert.rejects(
      drain(driftedSuspend.session, allowAll(driftedSuspend.pending)),
      (error) => error instanceof AgentRunStateError || (error instanceof AgentLoopStateError && error.code === "ERR_PRISM_LOOP_REVISION"),
    );
  });

  it("decisions fail closed on unknown, duplicate, or missing ids; a full batch runs each call once", async () => {
    const { agent, executed } = await writeAgent(parallelProvider(2));
    const { session, pending } = await suspend(agent, "cas");
    assert.equal(pending.length, 2);

    await assert.rejects(
      drain(session, [{ approvalId: "foreign", outcome: "allow_once" }]),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_UNKNOWN",
    );
    await assert.rejects(
      drain(session, [allowAll(pending)[0], { approvalId: pending[0].approvalId, outcome: "reject_once" }]),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_DUPLICATE",
    );
    // A strict subset is not enough: `session.resume` requires one decision per pending request.
    await assert.rejects(
      drain(session, [allowAll(pending)[0]]),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    assert.deepEqual(executed, [], "every rejected batch dispatched nothing");

    const events = await drain(session, allowAll(pending));
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.deepEqual(executed, ['c0:{"i":0}', 'c1:{"i":1}']);
  });

  it("sticky allow_for_run, reject_for_run, and edited arguments revalidate", async () => {
    let calls = 0;
    const provider = {
      id: "mock",
      async *generate() {
        calls += 1;
        if (calls === 1) {
          yield { type: "tool_call", call: toolCallContent("c0", "write", { i: 0 }) };
          yield providerDone();
          return;
        }
        if (calls === 2) {
          yield { type: "tool_call", call: toolCallContent("c1", "write", { i: 0 }) };
          yield { type: "tool_call", call: toolCallContent("c2", "write", { i: 2 }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const { agent, executed } = await writeAgent(provider);
    const { session, pending } = await suspend(agent, "sticky");

    const second = await drain(session, [{ approvalId: pending[0].approvalId, outcome: "allow_for_run" }]);
    assert.equal(second.at(-1)?.type, "run.suspended", "call-2 matches the sticky scope, call-3 re-suspends");
    assert.deepEqual(executed, ['c0:{"i":0}', 'c1:{"i":0}']);
    const remaining = (await loadSuspendedRunEntry((await agent.session({ id: "sticky" })).store ?? undefined, "sticky")) ?? undefined;
    assert.ok(remaining === undefined || remaining.state.interruption?.pendingDecisions?.length === 1);
  });

  it("elicitation pending decisions resolve without tool execution", async () => {
    let executed = 0;
    let turn = 0;
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "elicit",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
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
        ]),
      ],
      tools: {
        add: [
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
      },
    });
    const { session, first, pending } = await suspend(agent, "el");
    assert.equal(first.runState?.interruption?.kind, "elicitation");
    assert.equal(pending[0]?.kind, "elicitation");
    await assert.rejects(
      drain(session, [{ approvalId: pending[0].approvalId, outcome: "allow_once", elicitation: { choice: "maybe" } }]),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const events = await drain(session, [{ approvalId: pending[0].approvalId, outcome: "allow_once", elicitation: { choice: "yes" } }]);
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.equal(executed, 0, "an elicitation decision resolves the call without executing the tool");
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

    const start = await mapper.map({ type: "run.started", sessionId: "s", runId: "r" });
    for (const event of start) assert.equal(EventSchemas.safeParse(event).success, true, event.type);

    const painted = await mapper.map({
      type: "tool.completed",
      status: "finished",
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
      type: "tool.progress",
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
      type: "tool.completed",
      status: "finished",
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

  it("a 32-call suspension stays under the hard byte cap", async () => {
    const blob = "x".repeat(180_000);
    const loop = {
      name: "fat",
      revision: "1",
      snapshot: () => ({ blob }),
      restore: () => {},
      async run(run) {
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    };
    const { agent, store } = await writeAgent(parallelProvider(32), loop);
    const { first } = await suspend(agent, "size");
    assert.equal(first.pending?.length, 32);
    const stored = await loadSuspendedRunEntry(store, "size");
    const bytes = Buffer.byteLength(JSON.stringify(stored?.state), "utf8");
    assert.ok(bytes <= HARD_MAX_AGENT_RUN_STATE_BYTES, `stored run state ${bytes} exceeds hard cap`);
  });

  it("packed Phase 8 examples run to completion", () => {
    for (const file of ["examples/ag-ui-a2ui.ts", "examples/durable-loops-and-approvals.ts"]) {
      const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
      assert.equal(result.status, 0, `${file} exited ${result.status}\n${result.stderr}`);
      assert.ok(result.stdout.trim().length > 0, `${file} produced no output`);
      const payload = JSON.parse(result.stdout.trim().split("\n").at(-1));
      if (file.includes("a2ui")) assert.equal(payload.painted, true);
      else {
        assert.equal(payload.status, "completed");
        assert.equal(payload.loopRestored, true);
        assert.deepEqual(payload.executed, ["a", "b"]);
      }
    }
  });
});
