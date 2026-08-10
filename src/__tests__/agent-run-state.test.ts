import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentRunError,
  AgentRunStateError,
  AGENT_RUN_STATE_SCHEMA_VERSION,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  GuardrailError,
  HARD_MAX_AGENT_RUN_STATE_BYTES,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  resumeAgentRunStream,
  toolCallContent,
} from "../index.js";
import { parseAgentRunState, agentFingerprint, saveAgentRunState, type StoredAgentRunState } from "../agent-run-state.js";

describe("durable agent runs", () => {
  it("suspends before a tool, recreates process objects, and executes it once on approval", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "durable-demo",
      model: { provider: "mock", model: "demo" },
      store,
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "ok" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("finished");
            yield providerDone();
          },
        };
      })(),
      tools: [
        {
          name: "write",
          parameters: {},
          execute: () => {
            calls += 1;
            return { toolCallId: "call-1", name: "write", value: "done" };
          },
        },
      ],
    });
    const first = await agent.createSession({ id: "durable-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });

    assert.equal(first.status, "suspended");
    assert.equal(calls, 0);
    assert.equal(first.interruption?.toolCallId, "call-1");

    const result = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        decision: "approve",
        expectedVersion: first.runState!.version!,
      },
      { checkpoints, definitionRevision: "1" },
    );

    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "finished");
    assert.equal(calls, 1);
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: first.runId },
          {
            decision: "approve",
            expectedVersion: first.runState!.version!,
          },
          { checkpoints, definitionRevision: "1" },
        ),
      AgentRunStateError,
    );
  });

  it("never retries an ambiguous dispatched tool", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "ambiguous-durable-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-3", "write", {}) }, providerDone()]),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-3", name: "write" }) }],
    });
    const suspended = await agent
      .createSession()
      .run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    const loaded = await loadAgentRunState(checkpoints, { runId: suspended.runId });
    await checkpoints.saveCheckpoint({
      namespace: "prism.agent-run",
      key: suspended.runId,
      version: loaded.record.version + 1,
      expectedVersion: loaded.record.version,
      value: { ...loaded.state, pending: { ...loaded.state.pending!, status: "dispatched" } },
      category: "agent-run",
    });
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: suspended.runId },
          {
            decision: "approve",
            expectedVersion: loaded.record.version + 1,
          },
          { checkpoints, definitionRevision: "1" },
        ),
      /Ambiguous dispatched tool/,
    );
  });

  it("streams approved durable resume events once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "stream-durable-demo",
      store,
      model: { provider: "mock", model: "demo" },
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-stream", "write", {}) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("finished");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-stream", name: "write", value: ++calls }) }],
    });
    const suspended = await agent.createSession({ id: "stream-durable-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const events = [];
    for await (const event of resumeAgentRunStream(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      {
        decision: "approve",
        expectedVersion: suspended.runState!.version!,
      },
      { checkpoints, definitionRevision: "1", maxQueuedEvents: 64, overflow: "close" },
    ))
      events.push(event);

    assert.equal(calls, 1);
    assert.deepEqual(events.map((event) => event.type).slice(0, 2), ["agent_started", "agent_resumed"]);
    assert.equal(
      events.some((event) => event.type === "tool_execution_started"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "message_delta"),
      true,
    );
    assert.equal(events.at(-1)?.type, "agent_finished");
    assert.equal(
      events.every((event) => !("runId" in event) || event.runId === suspended.runId),
      true,
    );
  });

  it("streams denial without provider or tool execution", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = createAgent({
      id: "stream-deny-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-deny", "write", {}) }, providerDone()]),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-deny", name: "write", value: ++calls }) }],
    });
    const suspended = await agent
      .createSession()
      .run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    const events = [];
    for await (const event of resumeAgentRunStream(
      agent,
      { runId: suspended.runId },
      {
        decision: "deny",
        expectedVersion: suspended.runState!.version!,
      },
      { checkpoints, definitionRevision: "1" },
    ))
      events.push(event);

    assert.equal(calls, 0);
    assert.deepEqual(
      events.map((event) => event.type),
      ["agent_denied"],
    );
  });

  it("aborts before claiming and closes an overflowing resume subscriber", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "stream-bounds-demo",
      store,
      model: { provider: "mock", model: "demo" },
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-bounds", "write", {}) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("one");
            yield providerTextDelta("two");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-bounds", name: "write", value: ++calls }) }],
    });
    const suspended = await agent
      .createSession()
      .run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    const aborted = new AbortController();
    aborted.abort(new Error("disconnect"));
    const rejected = resumeAgentRunStream(
      agent,
      { runId: suspended.runId },
      {
        decision: "approve",
        expectedVersion: suspended.runState!.version!,
      },
      { checkpoints, definitionRevision: "1", signal: aborted.signal },
    )[Symbol.asyncIterator]();
    await assert.rejects(() => rejected.next(), /disconnect/);
    assert.equal((await loadAgentRunState(checkpoints, { runId: suspended.runId })).state.status, "suspended");

    const stream = resumeAgentRunStream(
      agent,
      { runId: suspended.runId },
      {
        decision: "approve",
        expectedVersion: suspended.runState!.version!,
      },
      { checkpoints, definitionRevision: "1", maxQueuedEvents: 1, overflow: "close" },
    )[Symbol.asyncIterator]();
    assert.equal((await stream.next()).value?.type, "event_subscriber_overflow");
    assert.equal((await stream.next()).done, true);
    assert.equal(calls, 1);
  });

  it("redacts checkpointed pending tool arguments and denial never executes", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = createAgent({
      id: "redacted-durable-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-2", "write", { token: "secret" }) }, providerDone()]),
      tools: [
        {
          name: "write",
          parameters: {},
          execute: () => {
            calls += 1;
            return { toolCallId: "call-2", name: "write" };
          },
        },
      ],
    });
    const result = await agent.createSession({ id: "redacted-session" }).run("secret", {
      redactor: createSecretRedactor(["secret"]),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const loaded = await loadAgentRunState(checkpoints, { runId: result.runId });
    assert.equal(JSON.stringify(loaded.state).includes("secret"), false);

    const denied = await resumeAgentRun(
      agent,
      { runId: result.runId },
      {
        decision: "deny",
        expectedVersion: result.runState!.version!,
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(denied.status, "denied");
    assert.equal(calls, 0);
  });

  it("resumes state saved above the default byte cap but within the hard cap", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const zero = {
      turns: 0,
      providerAttempts: 0,
      toolRounds: 0,
      toolCalls: 0,
      wallTimeMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
    };
    // `pad` is an extra JSON key: parse validates required fields only, and boundState
    // round-trips all keys, so it survives save/load and drives the byte count.
    const state = {
      schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
      agentId: "oversized-demo",
      definitionRevision: "1",
      fingerprint: "fingerprint",
      runId: "run-oversized",
      sessionId: "session-oversized",
      model: { provider: "mock", model: "demo" },
      status: "suspended",
      counters: zero,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      // Pad past the 256KB default cap but well under the 1MB hard cap.
      pad: "x".repeat(300 * 1024),
    } as unknown as StoredAgentRunState;
    const saved = await saveAgentRunState({
      checkpoints,
      state,
      expectedVersion: 0,
      maxStateBytes: HARD_MAX_AGENT_RUN_STATE_BYTES,
    });
    const loaded = await loadAgentRunState(checkpoints, { runId: state.runId });
    assert.equal(loaded.state.runId, state.runId);
    assert.equal(loaded.record.version, saved.record.version);
    assert.throws(() => parseAgentRunState({ ...state, pad: "x".repeat(1100 * 1024) }), AgentRunStateError);
  });

  it("treats resume as approval for input-stage interrupt guardrails", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "interrupt-resume-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("approved output"), providerDone()]),
      // Always interrupts: if resume did not count as approval, the resumed run would dead-end.
      guardrails: {
        input: [{ name: "approval", stage: "input", evaluate: () => ({ action: "interrupt" as const, reason: "needs approval" }) }],
      },
    });
    const session = agent.createSession();
    const suspended = await session.run("go", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.interruption?.kind, "input_guardrail");

    const resumed = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: suspended.runState!.version! },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.text, "approved output");
  });

  it("still fails a resumed durable run when an input guardrail blocks", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let evaluations = 0;
    const agent = createAgent({
      id: "interrupt-then-block-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("never reached"), providerDone()]),
      guardrails: {
        input: [
          {
            name: "flip",
            stage: "input",
            evaluate: () => {
              evaluations += 1;
              // First pass (fresh run): interrupt → suspend. Resume re-evaluation: block → fail.
              return evaluations === 1 ? { action: "interrupt" as const } : { action: "block" as const, reason: "denied on re-check" };
            },
          },
        ],
      },
    });
    const session = agent.createSession();
    const suspended = await session.run("go", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(suspended.status, "suspended");

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: suspended.runId, sessionId: suspended.sessionId },
          { decision: "approve", expectedVersion: suspended.runState!.version! },
          { checkpoints, definitionRevision: "1" },
        ),
      (error) => {
        assert.ok(error instanceof AgentRunError);
        assert.ok(error.cause instanceof GuardrailError);
        return true;
      },
    );
  });

  it("fingerprint changes with instructions, system prompt, and skills", () => {
    const base = () =>
      createAgent({
        id: "fp-demo",
        model: { provider: "mock", model: "demo" },
        instructions: "be terse",
        skills: [{ name: "review", instructions: "review the code" }],
      });

    const stable = agentFingerprint(base(), "1");
    assert.equal(agentFingerprint(base(), "1"), stable, "identical config must hash identically");
    assert.notEqual(agentFingerprint(base(), "2"), stable, "revision bump must change the fingerprint");

    assert.notEqual(
      agentFingerprint(createAgent({ id: "fp-demo", model: { provider: "mock", model: "demo" }, instructions: "be verbose" }), "1"),
      stable,
      "instructions change must change the fingerprint",
    );
    assert.notEqual(
      agentFingerprint(
        createAgent({
          id: "fp-demo",
          model: { provider: "mock", model: "demo" },
          instructions: "be terse",
          skills: [{ name: "review", instructions: "review the code harder" }],
        }),
        "1",
      ),
      stable,
      "skill instructions change must change the fingerprint",
    );
    assert.notEqual(
      agentFingerprint(
        createAgent({
          id: "fp-demo",
          model: { provider: "mock", model: "demo" },
          instructions: "be terse",
          skills: [{ name: "review", instructions: "review the code" }],
          systemPrompt: { id: "sp", text: "extra prompt layer" },
        }),
        "1",
      ),
      stable,
      "system prompt change must change the fingerprint",
    );
  });

  it("sessionState (plan 015 Task 4): absent parses, round-trips, malformed fails closed", () => {
    const base = (): StoredAgentRunState => ({
      schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
      agentId: "session-state-demo",
      definitionRevision: "1",
      fingerprint: "fp",
      runId: "run-1",
      sessionId: "session-1",
      model: { provider: "mock", model: "demo" },
      status: "suspended",
      counters: {
        turns: 1,
        providerAttempts: 1,
        toolRounds: 1,
        toolCalls: 1,
        wallTimeMs: 1,
        requestBytes: 1,
        responseBytes: 1,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 1,
        cost: 0,
      },
      deadlineAt: new Date().toISOString(),
    });
    // 0.1.2-shaped checkpoints have no sessionState key and must keep parsing.
    const legacy = parseAgentRunState(base());
    assert.equal(legacy.sessionState, undefined);
    // Round-trip with names.
    const withNames = parseAgentRunState({ ...base(), sessionState: { loadedSkillNames: ["brief", "review"] } });
    assert.deepEqual(withNames.sessionState?.loadedSkillNames, ["brief", "review"]);
    assert.deepEqual(parseAgentRunState({ ...base(), sessionState: {} }).sessionState, {});
    // Malformed blocks fail closed with AgentRunStateError.
    for (const bad of [
      { loadedSkillNames: "brief" },
      { loadedSkillNames: ["brief", 7] },
      { loadedSkillNames: new Array(65).fill("x") },
      { loadedSkillNames: ["a".repeat(257)] },
      { loadedSkillNames: ["ok", undefined] },
      "brief",
    ]) {
      assert.throws(() => parseAgentRunState({ ...base(), sessionState: bad as never }), AgentRunStateError);
    }
  });

  it("saveAgentRunState fails closed on an oversized sessionState (plan 015 Task 4)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const state: StoredAgentRunState = {
      schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
      agentId: "session-state-save",
      definitionRevision: "1",
      fingerprint: "fp",
      runId: "run-save",
      sessionId: "session-save",
      model: { provider: "mock", model: "demo" },
      status: "suspended",
      counters: {
        turns: 1,
        providerAttempts: 1,
        toolRounds: 1,
        toolCalls: 1,
        wallTimeMs: 1,
        requestBytes: 1,
        responseBytes: 1,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 1,
        cost: 0,
      },
      deadlineAt: new Date().toISOString(),
    };
    await assert.rejects(
      saveAgentRunState({
        checkpoints,
        state: { ...state, sessionState: { loadedSkillNames: new Array(65).fill("x") } },
        expectedVersion: 0,
      }),
      AgentRunStateError,
    );
    assert.equal((await checkpoints.listCheckpoints()).items.length, 0, "no partial write on overflow");
  });
});
