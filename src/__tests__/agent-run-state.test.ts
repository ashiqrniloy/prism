import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { agentFingerprint, parseAgentRunState, type StoredAgentRunState, saveAgentRunState } from "../agent-run-state.js";
import {
  AGENT_RUN_STATE_SCHEMA_VERSION,
  type AgentEvent,
  AgentRunStateError,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  HARD_MAX_AGENT_RUN_STATE_BYTES,
  loadSuspendedRunEntry,
  providerDone,
  providerTextDelta,
  SubscriberOverflowError,
  toolCallContent,
} from "../index.js";
import { createMemoryRunStateCell } from "../run-state-cell.js";
import { mockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

describe("durable agent runs", () => {
  it("streams approved durable resume events once", async () => {
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "stream-durable-demo",
      slots: { store },
      model: { provider: "mock", model: "demo" },
      packages: [
        providerPackage("test-provider", [
          (() => {
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
        ]),
      ],
      tools: { add: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-stream", name: "write", value: ++calls }) }] },
    });
    const session = await agent.session({ id: "stream-durable-session", create: true });
    const suspended = await session.run("go");
    const events: AgentEvent[] = [];
    for await (const event of session.resume(
      suspended.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
      { maxQueuedEvents: 64, overflow: "close" },
    ))
      events.push(event);

    assert.equal(calls, 1);
    assert.deepEqual(events.map((event) => event.type).slice(0, 2), ["decision.resolved", "run.started"]);
    assert.equal(
      events.some((event) => event.type === "tool.started"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "message.delta"),
      true,
    );
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.equal(
      events.every((event) => !("runId" in event) || event.runId === suspended.runId),
      true,
    );
  });

  it("aborts before claiming and closes an overflowing resume subscriber", async () => {
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "stream-bounds-demo",
      slots: { store },
      model: { provider: "mock", model: "demo" },
      packages: [
        providerPackage("test-provider", [
          (() => {
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
        ]),
      ],
      tools: { add: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-bounds", name: "write", value: ++calls }) }] },
    });
    const session = await agent.session({ id: "stream-bounds-session", create: true });
    const suspended = await session.run("go");
    const decisions = suspended.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const }));
    const aborted = new AbortController();
    aborted.abort(new Error("disconnect"));
    const rejected = session.resume(decisions, { signal: aborted.signal })[Symbol.asyncIterator]();
    await assert.rejects(() => rejected.next(), /disconnect/);
    assert.equal((await loadSuspendedRunEntry(store, "stream-bounds-session"))?.state.status, "suspended");

    const stream = session.resume(decisions, { maxQueuedEvents: 1, overflow: "close" })[Symbol.asyncIterator]();
    // The default `close` policy fails the iterator loudly instead of synthesizing a marker event.
    await assert.rejects(
      () => stream.next(),
      (error: unknown) => error instanceof SubscriberOverflowError,
    );
    assert.equal(calls, 1);
  });

  it("redacts stored pending tool arguments and a rejection never executes", async () => {
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "redacted-durable-demo",
      model: { provider: "mock", model: "demo" },
      slots: { store },
      packages: [mockProvider([[{ type: "tool_call", call: toolCallContent("call-2", "write", { token: "secret" }) }, providerDone()]])],
      tools: {
        add: [
          {
            name: "write",
            parameters: {},
            execute: () => {
              calls += 1;
              return { toolCallId: "call-2", name: "write" };
            },
          },
        ],
      },
    });
    const session = await agent.session({ id: "redacted-session", create: true });
    const result = await session.run("secret", { redactor: createSecretRedactor(["secret"]) });
    const stored = await loadSuspendedRunEntry(store, "redacted-session");
    assert.equal(JSON.stringify(stored?.state).includes("secret"), false, "the stored arguments are redacted");

    // A rejection is the 0.13 refusal: the gated tool never runs.
    for await (const _event of session.resume(
      result.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "reject_once" as const })),
    )) {
      // drain
    }
    assert.equal(calls, 0);
  });

  it("round-trips state saved above the default byte cap but within the hard cap", async () => {
    const cell = createMemoryRunStateCell();
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
    const saved = await saveAgentRunState({ cell, state, maxStateBytes: HARD_MAX_AGENT_RUN_STATE_BYTES });
    const loaded = await cell.load(state.runId);
    assert.equal((loaded?.value as StoredAgentRunState | undefined)?.runId, state.runId);
    assert.equal(loaded?.version, saved.record.version);
    assert.throws(() => parseAgentRunState({ ...state, pad: "x".repeat(1100 * 1024) }), AgentRunStateError);
  });

  it("fingerprint changes with instructions, system prompt, and skills", async () => {
    const base = async () =>
      await createAgent({
        id: "fp-demo",
        model: { provider: "mock", model: "demo" },
        instructions: "be terse",
        skills: { add: [{ name: "review", instructions: "review the code" }] },
      });

    const stable = agentFingerprint(await base(), "1");
    assert.equal(agentFingerprint(await base(), "1"), stable, "identical config must hash identically");
    assert.notEqual(agentFingerprint(await base(), "2"), stable, "revision bump must change the fingerprint");

    assert.notEqual(
      agentFingerprint(await createAgent({ id: "fp-demo", model: { provider: "mock", model: "demo" }, instructions: "be verbose" }), "1"),
      stable,
      "instructions change must change the fingerprint",
    );
    assert.notEqual(
      agentFingerprint(
        await createAgent({
          id: "fp-demo",
          model: { provider: "mock", model: "demo" },
          instructions: "be terse",
          skills: { add: [{ name: "review", instructions: "review the code harder" }] },
        }),
        "1",
      ),
      stable,
      "skill instructions change must change the fingerprint",
    );
    assert.notEqual(
      agentFingerprint(
        await createAgent({
          id: "fp-demo",
          model: { provider: "mock", model: "demo" },
          instructions: "be terse",
          skills: { add: [{ name: "review", instructions: "review the code" }] },
          systemPrompt: { id: "sp", text: "extra prompt layer" },
        }),
        "1",
      ),
      stable,
      "system prompt change must change the fingerprint",
    );
  });

  it("sessionState (plan 015 Task 4): absent parses, round-trips, malformed fails closed", async () => {
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
    const legacy = parseAgentRunState(await base());
    assert.equal(legacy.sessionState, undefined);
    // No-wall runs (0.5.4+): deadlineAt is optional; old snapshots with a deadline still parse.
    const noWall = parseAgentRunState({ ...(await base()), deadlineAt: undefined });
    assert.equal(noWall.deadlineAt, undefined);
    // Round-trip with names.
    const withNames = parseAgentRunState({ ...(await base()), sessionState: { loadedSkillNames: ["brief", "review"] } });
    assert.deepEqual(withNames.sessionState?.loadedSkillNames, ["brief", "review"]);
    assert.deepEqual(parseAgentRunState({ ...(await base()), sessionState: {} }).sessionState, {});
    // Malformed blocks fail closed with AgentRunStateError.
    for (const bad of [
      { loadedSkillNames: "brief" },
      { loadedSkillNames: ["brief", 7] },
      { loadedSkillNames: new Array(65).fill("x") },
      { loadedSkillNames: ["a".repeat(257)] },
      { loadedSkillNames: ["ok", undefined] },
      "brief",
    ]) {
      await assert.rejects(async () => parseAgentRunState({ ...(await base()), sessionState: bad as never }), AgentRunStateError);
    }
  });

  it("saveAgentRunState fails closed on an oversized sessionState (plan 015 Task 4)", async () => {
    const cell = createMemoryRunStateCell();
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
      saveAgentRunState({ cell, state: { ...state, sessionState: { loadedSkillNames: new Array(65).fill("x") } } }),
      AgentRunStateError,
    );
    assert.equal(await cell.load("run-save"), undefined, "no partial write on overflow");
  });
});
