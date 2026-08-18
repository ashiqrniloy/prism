import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAgentRunState } from "../agent-run-state.js";
import type { CheckpointStore } from "../contracts-core.js";
import {
  AgentDecisionError,
  type AgentRunResult,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  type JsonObject,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../index.js";

function parallelProvider() {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "a" }) };
        yield { type: "tool_call" as const, call: toolCallContent("call-2", "write", { value: "b" }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("finished");
      yield providerDone();
    },
  };
}

function decisionAgent(executed: string[], provider = parallelProvider()) {
  return createAgent({
    id: "decision-demo",
    model: { provider: "mock", model: "demo" },
    store: createMemorySessionStore(),
    provider,
    tools: [
      {
        name: "write",
        parameters: {},
        execute: (args: JsonObject, context: { toolCallId: string }) => {
          executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
          return { toolCallId: context.toolCallId, name: "write", value: "done" };
        },
      },
    ],
  });
}

const DURABLE = (checkpoints: ReturnType<typeof createMemoryCheckpointStore>) => ({
  checkpoints,
  definitionRevision: "1",
  interruptBeforeTool: true,
});

describe("shared pending decisions", () => {
  it("collects a parallel tool round into one suspension and applies an approve-all batch", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s1" }).run("go", { runState: DURABLE(checkpoints) });

    assert.equal(first.status, "suspended");
    assert.equal(executed.length, 0);
    const pending = first.interruption?.pendingDecisions;
    assert.equal(pending?.length, 2);
    assert.equal(pending?.[0]?.scope.toolName, "write");
    assert.match(pending?.[0]?.scope.argumentsHash ?? "", /^[a-f0-9]{64}$/);

    const result = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState!.version!,
        decisions: pending!.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })),
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, ['call-1:{"value":"a"}', 'call-2:{"value":"b"}']);
  });

  it("re-suspends with the remainder when a batch decides a strict subset", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s2" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;

    const partial: AgentRunResult = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }] },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(partial.status, "suspended");
    assert.equal(partial.runState!.version, first.runState!.version! + 1);
    assert.equal(partial.interruption?.pendingDecisions?.length, 1);
    assert.equal(partial.interruption?.pendingDecisions?.[0]?.approvalId, pending[1]!.approvalId);
    assert.equal(executed.length, 0);

    const done = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: partial.runState!.version!,
        decisions: [{ approvalId: pending[1]!.approvalId, outcome: "allow_once" }],
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(done.status, "succeeded");
    assert.deepEqual(executed, ['call-1:{"value":"a"}', 'call-2:{"value":"b"}']);
  });

  it("fails the whole batch closed on unknown, duplicate, or foreign approval ids", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = decisionAgent([]);
    const first = await agent.createSession({ id: "s3" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;
    const options = { checkpoints, definitionRevision: "1" };
    const ref = { runId: first.runId, sessionId: first.sessionId };

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { expectedVersion: 999, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }] },
          options,
        ),
      /Stale or non-suspended/,
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          {
            expectedVersion: first.runState!.version!,
            decisions: [
              { approvalId: pending[0]!.approvalId, outcome: "allow_once" },
              { approvalId: pending[0]!.approvalId, outcome: "reject_once" },
            ],
          },
          options,
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_DUPLICATE",
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { expectedVersion: first.runState!.version!, decisions: [{ approvalId: "foreign", outcome: "allow_once" }] },
          options,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_UNKNOWN");
        assert.ok(!error.message.includes("foreign")); // non-enumerating
        return true;
      },
    );
    // Every rejection left state and version untouched.
    const { record, state } = await loadAgentRunState(checkpoints, ref);
    assert.equal(record.version, first.runState!.version);
    assert.equal(state.status, "suspended");
    assert.equal(state.interruption?.pendingDecisions?.length, 2);
  });

  it("rejects invalid batches: empty, oversized reasons, mixed decision shapes", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = decisionAgent([]);
    const first = await agent.createSession({ id: "s4" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;
    const options = { checkpoints, definitionRevision: "1" };
    const ref = { runId: first.runId, sessionId: first.sessionId };
    const version = first.runState!.version!;

    await assert.rejects(
      () => resumeAgentRun(agent, ref, { expectedVersion: version, decisions: [] }, options),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          {
            expectedVersion: version,
            decisions: [{ approvalId: pending[0]!.approvalId, outcome: "reject_once", reason: "x".repeat(2049) }],
          },
          options,
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_LIMIT",
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { expectedVersion: version, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once", elicitation: { a: 1 } }] },
          options,
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_SCOPE",
    );
    await assert.rejects(
      () => resumeAgentRun(agent, ref, { expectedVersion: version }, options),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
  });

  it("reject_once continues the run with a blocked result and keeps the reason", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s5" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;

    const result = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState!.version!,
        decisions: [
          { approvalId: pending[0]!.approvalId, outcome: "reject_once", reason: "not safe" },
          { approvalId: pending[1]!.approvalId, outcome: "allow_once" },
        ],
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, ['call-2:{"value":"b"}']);
  });

  it("allow_for_run sticks within the exact scope and expires at run end", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    let turn = 0;
    const agent = decisionAgent(executed, {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "same" }) };
          yield providerDone();
          return;
        }
        if (turn === 2) {
          yield { type: "tool_call" as const, call: toolCallContent("call-2", "write", { value: "same" }) };
          yield { type: "tool_call" as const, call: toolCallContent("call-3", "write", { value: "different" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("finished");
        yield providerDone();
      },
    });
    const first = await agent.createSession({ id: "s6" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;

    const second = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_for_run" }] },
      { checkpoints, definitionRevision: "1" },
    );
    // call-2 matches the sticky scope (same tool + arguments) and runs without a suspension;
    // call-3 has different arguments and suspends the run again.
    assert.equal(second.status, "suspended");
    assert.deepEqual(executed, ['call-1:{"value":"same"}', 'call-2:{"value":"same"}']);
    const remaining = second.interruption!.pendingDecisions!;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.toolCallId, "call-3");

    const done = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: second.runState!.version!, decisions: [{ approvalId: remaining[0]!.approvalId, outcome: "allow_once" }] },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(done.status, "succeeded");
    const { state } = await loadAgentRunState(checkpoints, { runId: first.runId });
    assert.equal(state.stickyDecisions, undefined); // expired at run end
  });

  it("reject_for_run blocks later in-scope calls without executing them", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    let turn = 0;
    const agent = decisionAgent(executed, {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn <= 2) {
          yield { type: "tool_call" as const, call: toolCallContent(`call-${turn}`, "write", { value: "same" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("finished");
        yield providerDone();
      },
    });
    const first = await agent.createSession({ id: "s7" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;
    const result = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState!.version!,
        decisions: [{ approvalId: pending[0]!.approvalId, outcome: "reject_for_run", reason: "denied for run" }],
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, []);
  });

  it("revalidates modified arguments and executes with them exactly once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = createAgent({
      id: "modified-args-demo",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: parallelProvider(),
      validator: (_tool: unknown, args: unknown) =>
        typeof (args as { value?: unknown }).value === "string" ? undefined : "value must be a string",
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (args: JsonObject, context: { toolCallId: string }) => {
            executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "write", value: "done" };
          },
        },
      ],
    });
    const first = await agent.createSession({ id: "s8" }).run("go", { runState: DURABLE(checkpoints) });
    const pending = first.interruption!.pendingDecisions!;
    const options = { checkpoints, definitionRevision: "1" };
    const ref = { runId: first.runId, sessionId: first.sessionId };

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          {
            expectedVersion: first.runState!.version!,
            decisions: [
              { approvalId: pending[0]!.approvalId, outcome: "allow_once", modifiedArguments: { value: 42 } },
              { approvalId: pending[1]!.approvalId, outcome: "allow_once" },
            ],
          },
          options,
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    // Atomic failure: still suspended at the original version, nothing executed.
    const { record } = await loadAgentRunState(checkpoints, ref);
    assert.equal(record.version, first.runState!.version);
    assert.equal(executed.length, 0);

    const result = await resumeAgentRun(
      agent,
      ref,
      {
        expectedVersion: first.runState!.version!,
        decisions: [
          { approvalId: pending[0]!.approvalId, outcome: "allow_once", modifiedArguments: { value: "edited" } },
          { approvalId: pending[1]!.approvalId, outcome: "allow_once" },
        ],
      },
      options,
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, ['call-1:{"value":"edited"}', 'call-2:{"value":"b"}']);
  });

  it("validates elicitation payloads against the recorded schema and resolves the call", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s9" }).run("go", { runState: DURABLE(checkpoints) });
    const ref = { runId: first.runId, sessionId: first.sessionId };
    const options = { checkpoints, definitionRevision: "1" };

    // Rewrite the suspension as an elicitation pending decision (packages map this in Task 4).
    const { record, state } = await loadAgentRunState(checkpoints, ref);
    const approvalId = state.pendingCalls![0]!.approvalId;
    await checkpoints.saveCheckpoint({
      namespace: "prism.agent-run",
      key: first.runId,
      version: record.version + 1,
      expectedVersion: record.version,
      category: "agent-run",
      value: {
        ...state,
        pendingCalls: [state.pendingCalls![0]!],
        interruption: {
          kind: "elicitation",
          reason: "Need operator input",
          pendingDecisions: [
            {
              approvalId,
              kind: "elicitation",
              toolCallId: "call-1",
              scope: { toolName: "write" },
              reason: "Need operator input",
              elicitationSchema: { type: "object", required: ["choice"] },
            },
          ],
        },
      },
    });

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { expectedVersion: record.version + 1, decisions: [{ approvalId, outcome: "allow_once", elicitation: {} }] },
          options,
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const result = await resumeAgentRun(
      agent,
      ref,
      { expectedVersion: record.version + 1, decisions: [{ approvalId, outcome: "allow_once", elicitation: { choice: "a" } }] },
      options,
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, []); // elicitation resolved the call without executing the tool
  });

  it("produces elicitation pending decisions from a tool's declared hook and enforces its validate fn", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    let turn = 0;
    const agent = createAgent({
      id: "elicitation-demo",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "ask", { question: "Pick one" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "ask",
          parameters: {},
          elicitation: () => ({
            schema: { type: "object", required: ["choice"], properties: { choice: { enum: ["a", "b"] } } },
            reason: "Pick one",
            validate: (payload) => {
              if (payload.choice !== "a" && payload.choice !== "b") throw new Error("unknown option");
            },
          }),
          execute: (_args: JsonObject, context: { toolCallId: string }) => {
            executed.push(context.toolCallId);
            return { toolCallId: context.toolCallId, name: "ask", value: "executed" };
          },
        },
      ],
    });
    const first = await agent.createSession({ id: "s10" }).run("go", { runState: DURABLE(checkpoints) });
    assert.equal(first.status, "suspended");
    const pending = first.interruption?.pendingDecisions;
    assert.equal(first.interruption?.kind, "elicitation");
    assert.equal(pending?.length, 1);
    assert.equal(pending?.[0]?.kind, "elicitation");
    assert.equal(pending?.[0]?.reason, "Pick one");
    assert.deepEqual(pending?.[0]?.elicitationSchema?.required, ["choice"]);

    const ref = { runId: first.runId, sessionId: first.sessionId };
    const options = { checkpoints, definitionRevision: "1" };
    // The tool's validate fn rejects out-of-set answers even though required keys are present.
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          {
            expectedVersion: first.runState!.version!,
            decisions: [{ approvalId: pending![0]!.approvalId, outcome: "allow_once", elicitation: { choice: "z" } }],
          },
          options,
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const result = await resumeAgentRun(
      agent,
      ref,
      {
        expectedVersion: first.runState!.version!,
        decisions: [{ approvalId: pending![0]!.approvalId, outcome: "allow_once", elicitation: { choice: "a" } }],
      },
      options,
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, []); // elicitation resolved without executing
  });
});

describe("durable resume input validation (plan 020 Task 2)", () => {
  it("unknown legacy decision fails closed with no checkpoint write and no tool call", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s11" }).run("go", { runState: DURABLE(checkpoints) });
    assert.equal(first.status, "suspended");
    const ref = { runId: first.runId, sessionId: first.sessionId };
    const options = { checkpoints, definitionRevision: "1" };

    await assert.rejects(
      () => resumeAgentRun(agent, ref, { expectedVersion: first.runState!.version!, decision: "sideways" } as never, options),
      (error: unknown) => {
        assert.ok(error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID");
        assert.ok(error.message.includes("Unknown legacy decision"));
        return true;
      },
    );
    // Zero checkpoint writes, zero tool calls, still suspended at the original version.
    const { record, state } = await loadAgentRunState(checkpoints, ref);
    assert.equal(record.version, first.runState!.version);
    assert.equal(state.status, "suspended");
    assert.equal(executed.length, 0);
  });

  it("malformed top-level inputs fail closed before any checkpoint read", async () => {
    const throwing: CheckpointStore = {
      saveCheckpoint: async () => {
        throw new Error("must not write");
      },
      loadCheckpoint: async () => {
        throw new Error("must not read");
      },
      listCheckpoints: async () => {
        throw new Error("must not read");
      },
      deleteCheckpoint: async () => {
        throw new Error("must not write");
      },
    };
    const agent = decisionAgent([]);
    const options = { checkpoints: throwing, definitionRevision: "1" };
    const ref = { runId: "r", sessionId: "s" };
    const cases: Array<[string, unknown]> = [
      ["null", null],
      ["string", "resume"],
      ["number", 42],
      ["zero version", { expectedVersion: 0, decision: "approve" }],
      ["fractional version", { expectedVersion: 1.5, decision: "approve" }],
      ["string version", { expectedVersion: "1", decision: "approve" }],
      ["neither discriminant", { expectedVersion: 1 }],
      ["both discriminants", { expectedVersion: 1, decision: "approve", decisions: [] }],
    ];
    for (const [label, resume] of cases) {
      await assert.rejects(
        () => resumeAgentRun(agent, ref, resume as never, options),
        (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
        label,
      );
    }
  });

  it("malformed batches fail closed with stable AgentDecisionError codes", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s12" }).run("go", { runState: DURABLE(checkpoints) });
    const options = { checkpoints, definitionRevision: "1" };
    const ref = { runId: first.runId, sessionId: first.sessionId };
    const version = first.runState!.version!;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cases: Array<[string, unknown, string]> = [
      ["non-array", { expectedVersion: version, decisions: "not-an-array" }, "ERR_PRISM_DECISION_INVALID"],
      ["empty", { expectedVersion: version, decisions: [] }, "ERR_PRISM_DECISION_INVALID"],
      [
        "over cap",
        { expectedVersion: version, decisions: Array.from({ length: 129 }, (_, i) => ({ approvalId: `a${i}`, outcome: "allow_once" })) },
        "ERR_PRISM_DECISION_LIMIT",
      ],
      ["primitive entry", { expectedVersion: version, decisions: [42] }, "ERR_PRISM_DECISION_INVALID"],
      ["missing approvalId", { expectedVersion: version, decisions: [{ outcome: "allow_once" }] }, "ERR_PRISM_DECISION_INVALID"],
      [
        "empty approvalId",
        { expectedVersion: version, decisions: [{ approvalId: "", outcome: "allow_once" }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "oversized approvalId",
        { expectedVersion: version, decisions: [{ approvalId: "a".repeat(129), outcome: "allow_once" }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "unknown outcome",
        { expectedVersion: version, decisions: [{ approvalId: "a", outcome: "sideways" }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "duplicate id",
        {
          expectedVersion: version,
          decisions: [
            { approvalId: "a", outcome: "allow_once" },
            { approvalId: "a", outcome: "reject_once" },
          ],
        },
        "ERR_PRISM_DECISION_DUPLICATE",
      ],
      [
        "non-string reason",
        { expectedVersion: version, decisions: [{ approvalId: "a", outcome: "allow_once", reason: 42 }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "oversized reason",
        { expectedVersion: version, decisions: [{ approvalId: "a", outcome: "allow_once", reason: "x".repeat(2049) }] },
        "ERR_PRISM_DECISION_LIMIT",
      ],
      [
        "non-object modifiedArguments",
        { expectedVersion: version, decisions: [{ approvalId: "a", outcome: "allow_once", modifiedArguments: "nope" }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "cyclic modifiedArguments",
        { expectedVersion: version, decisions: [{ approvalId: "a", outcome: "allow_once", modifiedArguments: cyclic }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "cyclic elicitation",
        { expectedVersion: version, decisions: [{ approvalId: "a", outcome: "allow_once", elicitation: cyclic }] },
        "ERR_PRISM_DECISION_INVALID",
      ],
      [
        "oversized modifiedArguments",
        {
          expectedVersion: version,
          decisions: [{ approvalId: "a", outcome: "allow_once", modifiedArguments: { big: "x".repeat(16 * 1024) } }],
        },
        "ERR_PRISM_DECISION_LIMIT",
      ],
    ];
    for (const [label, resume, code] of cases) {
      await assert.rejects(
        () => resumeAgentRun(agent, ref, resume as never, options),
        (error: unknown) => error instanceof AgentDecisionError && error.code === code,
        label,
      );
    }
    // Every rejection left state and version untouched; nothing executed.
    const { record, state } = await loadAgentRunState(checkpoints, ref);
    assert.equal(record.version, version);
    assert.equal(state.status, "suspended");
    assert.equal(executed.length, 0);
  });

  it("valid legacy approve and batch paths remain green after the assertion", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const agent = decisionAgent(executed);
    const first = await agent.createSession({ id: "s13" }).run("go", { runState: DURABLE(checkpoints) });
    const ref = { runId: first.runId, sessionId: first.sessionId };
    const options = { checkpoints, definitionRevision: "1" };

    const result = await resumeAgentRun(agent, ref, { expectedVersion: first.runState!.version!, decision: "approve" }, options);
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed, ['call-1:{"value":"a"}', 'call-2:{"value":"b"}']);
  });
});
