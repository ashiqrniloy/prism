import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRestoredSkillBodies,
  createAgent,
  createAgentRunLifecycle,
  createLoadSkillTool,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createSkillRegistry,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  snapshotLoadedSkillBodies,
  toolCallContent,
  validateLoadedSkillBodies,
  type LoadedSkillBodiesEntry,
} from "../index.js";
import { saveAgentRunState } from "../agent-run-state.js";

describe("agent run lifecycle", () => {
  it("streams an authorized durable approval through the shared core path", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "lifecycle-stream-demo",
      store,
      model: { provider: "mock", model: "demo" },
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-lifecycle", "write", {}) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("finished");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-lifecycle", name: "write", value: ++calls }) }],
    });
    const suspended = await agent.createSession({ id: "lifecycle-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: ({ agentId }) => {
        assert.equal(agentId, "lifecycle-stream-demo");
        return { agent, definitionRevision: "1" };
      },
    });
    const events = [];
    for await (const event of lifecycle.resumeStream(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      {
        decision: "approve",
        expectedVersion: suspended.runState!.version!,
      },
      { agentId: "lifecycle-stream-demo", maxQueuedEvents: 64, overflow: "close" },
    ))
      events.push(event);

    assert.equal(calls, 1);
    assert.equal(
      events.some((event) => event.type === "agent_resumed"),
      true,
    );
    assert.equal(events.at(-1)?.type, "agent_finished");
  });

  it("opt-in includeSkillBodies: exact skill instructions ride the checkpoint and render on resume (plan 018 Task 6)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: Array<{
      readonly messages: ReadonlyArray<{ readonly content: ReadonlyArray<{ readonly text?: string; readonly type: string }> }>;
    }> = [];
    const registry = createSkillRegistry([{ name: "brief", description: "Answer briefly.", instructions: "Be very brief." }]);
    const agent = createAgent({
      id: "persist-bodies-demo",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate(request: { messages: (typeof requests)[number]["messages"] }) {
          requests.push(request as never);
          if (requests.length === 1) {
            // non-durable run 1: load_skill populates the session catalog
            yield { type: "tool_call" as const, call: toolCallContent("call-load", "load_skill", { name: "brief" }) };
            return;
          }
          if (requests.length === 2) {
            yield providerDone();
            return;
          }
          if (requests.length === 3 || requests.length === 5) {
            // durable runs 2 and 3: gated write suspends after "brief" is loaded
            yield { type: "tool_call" as const, call: toolCallContent("call-write", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      skills: registry,
      activateAllSkills: true,
      tools: [
        createLoadSkillTool({ registry }),
        { name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: "done" }) },
      ],
    });
    const session = agent.createSession({ id: "persist-bodies-session" });
    await session.run("go");
    const suspended = await session.run("go", {
      runState: {
        checkpoints,
        definitionRevision: "1",
        interruptBeforeTool: true,
        persistSessionState: true,
        includeSkillBodies: true,
      },
    });
    const record = await checkpoints.loadCheckpoint({ namespace: "prism.agent-run", key: suspended.runId });
    const sessionState = (
      record!.value as {
        sessionState: { loadedSkillNames?: string[]; loadedSkillBodies?: LoadedSkillBodiesEntry[] };
      }
    ).sessionState;
    assert.deepEqual(sessionState.loadedSkillBodies, [{ name: "brief", instructions: "Be very brief." }]);
    assert.deepEqual(sessionState.loadedSkillNames, ["brief"], "bodies mode implies the names catalog too");

    // Resume WITHOUT includeSkillBodies → names-only restore (0.1.3 behavior), no bodies in the render path.
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    const events = [];
    for await (const event of lifecycle.resumeStream(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: suspended.runState!.version! },
      { agentId: "persist-bodies-demo", maxQueuedEvents: 64, overflow: "close", persistSessionState: true },
    )) {
      events.push(event);
    }
    assert.equal(events.at(-1)?.type, "agent_finished");
    assert.equal(requests.length, 4, "resumed run produced the final provider turn");

    // Second suspension to resume WITH bodies.
    const suspended2 = await session.run("again", {
      runState: {
        checkpoints,
        definitionRevision: "1",
        interruptBeforeTool: true,
        persistSessionState: true,
        includeSkillBodies: true,
      },
    });
    const requestsBefore = requests.length;
    const events2 = [];
    for await (const event of lifecycle.resumeStream(
      { runId: suspended2.runId, sessionId: suspended2.sessionId },
      { decision: "approve", expectedVersion: suspended2.runState!.version! },
      { agentId: "persist-bodies-demo", maxQueuedEvents: 64, overflow: "close", persistSessionState: true, includeSkillBodies: true },
    )) {
      events2.push(event);
    }
    assert.equal(events2.at(-1)?.type, "agent_finished");
    const resumedTurn = requests.at(-1)!;
    const resumedText = resumedTurn.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" && b.text ? b.text : ""))
      .join("\n");
    assert.match(resumedText, /Skill brief:\nBe very brief\./, "persisted body renders on resume (no load_skill round-trip)");
    assert.equal(
      requests.length,
      requestsBefore + 1,
      "resumed bodies-mode run needs exactly one provider turn — a load_skill round-trip would add more",
    );
  });

  it("includeSkillBodies off keeps the checkpoint at the 0.1.3 names-only shape (plan 018 Task 6)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be very brief." }]);
    let turns = 0;
    const agent = createAgent({
      id: "persist-bodies-off",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          turns++;
          if (turns === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-load", "load_skill", { name: "brief" }) };
            return;
          }
          if (turns === 2) {
            yield providerDone();
            return;
          }
          if (turns === 3) {
            yield { type: "tool_call" as const, call: toolCallContent("call-write", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerDone();
        },
      },
      skills: registry,
      activateAllSkills: true,
      tools: [
        createLoadSkillTool({ registry }),
        { name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: "done" }) },
      ],
    });
    const session = agent.createSession({ id: "persist-bodies-off" });
    await session.run("go");
    const suspended = await session.run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
    });
    const record = await checkpoints.loadCheckpoint({ namespace: "prism.agent-run", key: suspended.runId });
    const sessionState = (record!.value as { sessionState: Record<string, unknown> }).sessionState;
    assert.deepEqual(sessionState.loadedSkillNames, ["brief"]);
    assert.equal("loadedSkillBodies" in sessionState, false, "no bodies key without includeSkillBodies");
  });

  it("bodies-mode payload bounds and malformed payloads fail closed (plan 018 Task 6)", async () => {
    // validateLoadedSkillBodies unit: shape, count, name, body, and total caps.
    assert.throws(() => validateLoadedSkillBodies("nope" as never), /Loaded-skill bodies/);
    assert.throws(
      () => validateLoadedSkillBodies(Array.from({ length: 65 }, (_, i) => ({ name: `s${i}`, instructions: "x" }))),
      /exceed 64 entries/,
    );
    assert.throws(() => validateLoadedSkillBodies([{ name: "x".repeat(257), instructions: "y" }]), /name exceeds 256 chars/);
    assert.throws(() => validateLoadedSkillBodies([{ name: "s", instructions: "x".repeat(262_145) }]), /exceeds 262144 bytes/);
    assert.throws(
      () => validateLoadedSkillBodies(Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, instructions: "x".repeat(220_000) }))),
      /total bytes/,
    );
    assert.throws(() => validateLoadedSkillBodies([{ name: "s", instructions: 7 as never }]), /instructions must be a string/);
    // applyRestoredSkillBodies: replace by name, append unknown names, leave the rest untouched.
    const applied = applyRestoredSkillBodies(
      [
        { name: "a", instructions: "old-a" },
        { name: "b", instructions: "b" },
      ],
      [
        { name: "a", instructions: "new-a" },
        { name: "c", instructions: "c" },
      ],
    );
    assert.deepEqual(applied, [
      { name: "a", instructions: "new-a" },
      { name: "b", instructions: "b" },
      { name: "c", instructions: "c" },
    ]);
    // snapshotLoadedSkillBodies: loaded names only; loaded-without-instructions skipped; oversize total refuses.
    const loaded = { has: () => false, add: () => {}, list: () => ["a", "no-body"], clear: () => {} };
    assert.deepEqual(snapshotLoadedSkillBodies([{ name: "a", instructions: "instr" }, { name: "no-body" }], loaded), [
      { name: "a", instructions: "instr" },
    ]);
    const big = Array.from({ length: 5 }, (_, i) => ({ name: `big${i}`, instructions: "x".repeat(220_000) }));
    assert.throws(
      () => snapshotLoadedSkillBodies(big, { has: () => false, add: () => {}, list: () => big.map((s) => s.name), clear: () => {} }),
      /total bytes/,
    );
  });

  it("cross-branch non-leak: bodies ride their own run record, ownership-scoped (plan 018 Task 6)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const base = {
      schemaVersion: 1 as const,
      agentId: "leak-demo",
      definitionRevision: "1",
      fingerprint: "fp",
      runId: "run-a",
      sessionId: "session-a",
      model: { provider: "mock" as const, model: "demo" },
      status: "suspended" as const,
      counters: {
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
      },
      deadlineAt: "0",
    };
    await saveAgentRunState({
      checkpoints,
      state: {
        ...base,
        runId: "run-a",
        sessionId: "session-a",
        sessionState: { loadedSkillNames: ["brief"], loadedSkillBodies: [{ name: "brief", instructions: "SECRET BODY" }] },
      },
      expectedVersion: 0,
      ownership: { userId: "user-a" },
    });
    await saveAgentRunState({
      checkpoints,
      state: { ...base, runId: "run-b", sessionId: "session-b" },
      expectedVersion: 0,
      ownership: { userId: "user-b" },
    });
    // Branch B resumes clean: no bodies, no cross-tenant read.
    const b = await loadAgentRunState(checkpoints, { runId: "run-b", sessionId: "session-b" }, { userId: "user-b" });
    assert.equal(b.state.sessionState, undefined);
    // Cross-tenant load of A fails closed (ownership-scoped store lookup).
    await assert.rejects(
      loadAgentRunState(checkpoints, { runId: "run-a", sessionId: "session-a" }, { userId: "user-b" }),
      /ownership mismatch|No durable agent run/,
    );
    const a = await loadAgentRunState(checkpoints, { runId: "run-a", sessionId: "session-a" }, { userId: "user-a" });
    assert.deepEqual(a.state.sessionState?.loadedSkillBodies, [{ name: "brief", instructions: "SECRET BODY" }]);
  });

  it("redaction: persisted bodies ride the checkpoint redaction path (plan 018 Task 6)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const base = {
      schemaVersion: 1 as const,
      agentId: "redact-demo",
      definitionRevision: "1",
      fingerprint: "fp",
      runId: "run-redact",
      sessionId: "session-redact",
      model: { provider: "mock" as const, model: "demo" },
      status: "suspended" as const,
      counters: {
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
      },
      deadlineAt: "0",
    };
    const saved = await saveAgentRunState({
      checkpoints,
      state: {
        ...base,
        sessionState: { loadedSkillNames: ["brief"], loadedSkillBodies: [{ name: "brief", instructions: "Use token ABC123 now" }] },
      },
      expectedVersion: 0,
      redactor: { redact: (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("ABC123", "[REDACTED]")) },
    });
    assert.match(JSON.stringify(saved.record.value), /token \[REDACTED\] now/);
    const loaded = await loadAgentRunState(checkpoints, { runId: "run-redact", sessionId: "session-redact" });
    assert.equal(loaded.state.sessionState?.loadedSkillBodies?.[0]?.instructions, "Use token [REDACTED] now");
  });

  it("opt-in persistSessionState: skill names ride the checkpoint and restore on resume (plan 015 Task 4)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: Array<{
      readonly messages: ReadonlyArray<{ readonly content: ReadonlyArray<{ readonly text?: string; readonly type: string }> }>;
    }> = [];
    const registry = createSkillRegistry([{ name: "brief", description: "Answer briefly.", instructions: "Be very brief." }]);
    const agent = createAgent({
      id: "persist-session-demo",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate(request: { messages: (typeof requests)[number]["messages"] }) {
          requests.push(request as never);
          if (requests.length === 1) {
            // non-durable run 1: load_skill dispatches (no gate) and populates the session catalog
            yield { type: "tool_call" as const, call: toolCallContent("call-load", "load_skill", { name: "brief" }) };
            return;
          }
          if (requests.length === 2) {
            yield providerDone();
            return;
          }
          if (requests.length === 3) {
            // durable run 2: gated write suspends after the catalog already holds "brief"
            yield { type: "tool_call" as const, call: toolCallContent("call-write", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      skills: registry,
      activateAllSkills: true,
      tools: [
        createLoadSkillTool({ registry }),
        { name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: "done" }) },
      ],
    });
    const session = agent.createSession({ id: "persist-session" });
    await session.run("go");
    const suspended = await session.run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
    });
    const record = await checkpoints.loadCheckpoint({ namespace: "prism.agent-run", key: suspended.runId });
    assert.deepEqual(
      (record!.value as { sessionState: { loadedSkillNames: string[] } }).sessionState.loadedSkillNames,
      ["brief"],
      "checkpoint carries the loaded-skill name catalog",
    );

    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    const events = [];
    for await (const event of lifecycle.resumeStream(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: suspended.runState!.version! },
      { agentId: "persist-session-demo", maxQueuedEvents: 64, overflow: "close", persistSessionState: true },
    )) {
      events.push(event);
    }
    assert.equal(events.at(-1)?.type, "agent_finished");
    assert.equal(requests.length, 4, "resumed run produced the final provider turn");
    const resumedTurn = requests[3]!;
    const resumedText = resumedTurn.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" && b.text ? b.text : ""))
      .join("\n");
    assert.match(resumedText, /Skill brief:\nBe very brief\./, "restored catalog renders the body from the live registry");
  });

  it("persistSessionState off keeps the checkpoint at the 0.1.2 shape (plan 015 Task 4)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "persist-session-off",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield { type: "tool_call" as const, call: toolCallContent("call-write", "write", {}) };
          yield providerDone();
        },
      },
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: "done" }) }],
    });
    const suspended = await agent.createSession({ id: "persist-session-off" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const record = await checkpoints.loadCheckpoint({ namespace: "prism.agent-run", key: suspended.runId });
    assert.equal("sessionState" in (record!.value as object), false, "no sessionState key with the opt-in off");
  });
});
