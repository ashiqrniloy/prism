import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_RUN_STATE_NAMESPACE,
  AgentRunStateError,
  type AgentEvent,
  type AgentSession,
  type CheckpointStore,
  type ProviderRequest,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resumeAgentRun,
  resumeAgentRunStream,
  snapshotRunBundle,
  toolCallContent,
} from "../index.js";

/** Simulates a host process dying: every checkpoint write after the crash is rejected, so the last
 *  persisted checkpoint stays exactly as the crashed process left it. */
function crashableCheckpoints(inner: CheckpointStore) {
  const gate = { open: true };
  const store: CheckpointStore = {
    ...inner,
    async saveCheckpoint(input) {
      if (!gate.open) throw new Error("checkpoint store unavailable (simulated process death)");
      return inner.saveCheckpoint(input);
    },
  };
  return { store, gate };
}

/** Runs a session while collecting its events, returning the run id from `agent_started` (a crashed
 *  run rejects before yielding a result). */
async function runCapturingId(session: AgentSession, input: string, runState: Parameters<AgentSession["run"]>[1]) {
  const events: AgentEvent[] = [];
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  const settle = session.run(input, runState);
  const outcome = await settle.then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  const runId = events.find((event) => event.type === "agent_started")?.runId;
  assert.ok(runId, "run id captured from agent_started");
  return { runId, ...outcome };
}

/** Rewrites the stored checkpoint value in place (bypassing save-side validation) to model a
 *  tampered or foreign checkpoint store. */
async function tamperCheckpoint(checkpoints: CheckpointStore, runId: string, mutate: (state: Record<string, any>) => void) {
  const record = await checkpoints.loadCheckpoint({ namespace: AGENT_RUN_STATE_NAMESPACE, key: runId });
  assert.ok(record, "checkpoint present");
  const state = JSON.parse(JSON.stringify(record.value)) as Record<string, any>;
  mutate(state);
  const version = record.version + 1;
  await checkpoints.saveCheckpoint({
    namespace: AGENT_RUN_STATE_NAMESPACE,
    key: runId,
    value: state,
    version,
  });
  return version;
}

/** Rule names of the pack decisions that actually refused something (allow rows are emitted too). */
const denials = (events: readonly AgentEvent[]): string[] =>
  events.flatMap((event) => (event.type === "guardrail_decision" && event.record.action !== "allow" ? [event.record.guardrail] : []));

describe("guardrail pack durability (plan 104 Task 2)", () => {
  it("validation-respect state rides the checkpoint and the resumed run still denies the mutation", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const mutations: string[] = [];
    let turn = 0;
    const agent = createAgent({
      id: "pack-durability",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            // Non-durable run 1: the failing validation is observed into pack state.
            yield providerToolCall(toolCallContent("call-validate", "verify_build", {}));
            yield providerDone();
            return;
          }
          if (turn === 2) {
            yield providerTextDelta("validated");
            yield providerDone();
            return;
          }
          if (turn === 3) {
            // Durable run 2: a read-only tool the pack allows suspends at the gate and writes the
            // checkpoint (a mutation here would already be denied before the gate).
            yield providerToolCall(toolCallContent("call-inspect", "inspect", {}));
            yield providerDone();
            return;
          }
          if (turn === 4) {
            // First post-resume mutation: the restored state must still deny it.
            yield providerToolCall(toolCallContent("call-write", "write", { path: "a.txt" }));
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "verify_build",
          parameters: {},
          execute: () => ({ toolCallId: "call-validate", name: "verify_build", error: { message: "build failed" } }),
        },
        { name: "inspect", parameters: {}, execute: () => ({ toolCallId: "call-inspect", name: "inspect", value: "ok" }) },
        {
          name: "write",
          parameters: {},
          execute: () => {
            mutations.push("write");
            return { toolCallId: "call-write", name: "write", value: "written" };
          },
        },
      ],
    });
    // A non-default `validationTools` proves the options round-trip too: a recompile with registry
    // defaults would not observe `verify_build` and would re-allow the mutation.
    const packs = [{ id: "validation-respect", options: { validationTools: ["verify_build"] } }];
    const session = agent.createSession({ id: "pack-durability-session", guardrailPacks: packs });
    await session.run("validate");
    const suspended = await session.run("mutate", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
    });
    assert.equal(suspended.status, "suspended");
    const loaded = await loadAgentRunState(checkpoints, { runId: suspended.runId });
    assert.deepEqual(
      loaded.state.sessionState?.guardrailPacks,
      {
        packs: [{ id: "validation-respect", version: 1, options: { validationTools: ["verify_build"] } }],
        state: { "validation-respect": { validationFailed: "verify_build" } },
      },
      "checkpoint carries the pack row and the pack-owned state",
    );

    const events: AgentEvent[] = [];
    const pumps: Promise<void>[] = [];
    let resumedSession: AgentSession | undefined;
    let result = suspended;
    // The durable run keeps `interruptBeforeTool`, so each gated call takes its own approval: the
    // first resume approves the read-only tool, the second reaches the mutation and the pack denies it.
    for (let round = 0; round < 3 && result.status === "suspended"; round += 1) {
      const expectedVersion = result.runState?.version;
      assert.ok(expectedVersion !== undefined, "suspended result carries its checkpoint version");
      result = await resumeAgentRun(
        agent,
        { runId: result.runId, sessionId: result.sessionId },
        { decision: "approve", expectedVersion },
        {
          checkpoints,
          definitionRevision: "1",
          onSession: (reconstructed) => {
            resumedSession = reconstructed;
            const subscription = reconstructed.subscribe();
            pumps.push(
              (async () => {
                for await (const event of subscription) events.push(event);
              })(),
            );
          },
        },
      );
    }
    await Promise.all(pumps);
    assert.equal(result.status, "succeeded");
    assert.deepEqual(mutations, [], "the mutation the suspended run denied stays denied after resume");
    assert.deepEqual(denials(events), ["pack:validation-respect/no-mutation-after-failed-validation"]);
    assert.ok(
      events.some((event) => event.type === "tool_execution_blocked" && event.reason === "guardrail_blocked"),
      "the resumed run reports the pack denial",
    );
    const captured = resumedSession;
    assert.ok(captured, "onSession handed back the resumed session");
    assert.deepEqual(
      captured.guardrailPackRefs,
      [{ id: "validation-respect", version: 1, options: { validationTools: ["verify_build"] } }],
      "the resumed session enforces the restored refs",
    );
    const bundle = snapshotRunBundle({ agent, packs: captured.guardrailPackRefs });
    assert.ok(
      bundle.guardrails.some((row) => row.name === "pack:validation-respect/no-mutation-after-failed-validation"),
      "the resumed run bundle reports the rows the session actually enforces",
    );
  });

  it("destructive-commands refs survive a continue crash recovery without re-passing persistSessionState", async () => {
    const memory = createMemoryCheckpointStore();
    const { store: checkpoints, gate } = crashableCheckpoints(memory);
    const requests: ProviderRequest[] = [];
    let turn = 0;
    let crashed = false;
    let executions = 0;
    const agent = createAgent({
      id: "pack-crash-recovery",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate(request) {
          requests.push(request);
          turn += 1;
          if (turn === 1 || turn === 3) {
            yield providerToolCall(toolCallContent(`call-rm-${turn}`, "shell", { command: "rm -rf /important" }));
            yield providerDone();
            return;
          }
          if (!crashed) {
            crashed = true;
            gate.open = false;
            throw new Error("simulated worker crash");
          }
          yield providerTextDelta("nothing destroyed");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "shell",
          parameters: {},
          execute: () => {
            executions += 1;
            return { toolCallId: "call-rm", name: "shell", value: { exitCode: 0 } };
          },
        },
      ],
    });
    const session = agent.createSession({ id: "pack-crash-session", guardrailPacks: ["destructive-commands"] });
    const crashedRun = await runCapturingId(session, "clean up", {
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn", persistSessionState: true },
    });
    assert.match(String((crashedRun.error as Error).message), /checkpoint store unavailable/);
    assert.equal(executions, 0, "the pre-crash rm -rf never executed");

    const before = await loadAgentRunState(checkpoints, { runId: crashedRun.runId });
    assert.equal(before.state.status, "running");
    assert.deepEqual(before.state.sessionState?.guardrailPacks, {
      packs: [{ id: "destructive-commands", version: 1 }],
    });
    gate.open = true;

    const resumed: AgentEvent[] = [];
    let resumedSession: AgentSession | undefined;
    for await (const event of resumeAgentRunStream(
      agent,
      { runId: crashedRun.runId, sessionId: "pack-crash-session" },
      { decision: "continue", expectedVersion: before.record.version },
      {
        checkpoints,
        definitionRevision: "1",
        onSession: (reconstructed) => {
          resumedSession = reconstructed;
        },
      },
    )) {
      resumed.push(event);
    }
    assert.equal(resumed.at(-1)?.type, "agent_finished");
    assert.equal(executions, 0, "the resumed run's rm -rf is still blocked");
    assert.ok(
      resumed.some((event) => event.type === "tool_execution_blocked" && event.reason === "guardrail_blocked"),
      "the resumed run reports the pack denial",
    );
    assert.deepEqual(resumedSession?.guardrailPackRefs, [{ id: "destructive-commands", version: 1 }]);
  });

  it("fails closed on unknown packs, version mismatches, and malformed or oversized state", async () => {
    /** One suspended run per case, so every tampered checkpoint still has a real fingerprint, run
     *  id, and approval pending. */
    const suspend = async () => {
      const checkpoints = createMemoryCheckpointStore();
      let turn = 0;
      const agent = createAgent({
        id: "pack-fail-closed",
        store: createMemorySessionStore(),
        model: { provider: "mock", model: "demo" },
        provider: {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield providerToolCall(toolCallContent("call-write", "write", { path: "a.txt" }));
              yield providerDone();
              return;
            }
            yield providerTextDelta("done");
            yield providerDone();
          },
        },
        tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: true }) }],
      });
      const session = agent.createSession({ id: "pack-fail-closed-session", guardrailPacks: ["validation-respect"] });
      const suspended = await session.run("mutate", {
        runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
      });
      return { agent, checkpoints, suspended };
    };

    const cases: readonly [string, (state: Record<string, any>) => void, RegExp][] = [
      [
        "unknown pack id",
        (state) => {
          state.sessionState.guardrailPacks = { packs: [{ id: "ghost-pack", version: 1 }] };
        },
        /unknown guardrail pack "ghost-pack"/,
      ],
      [
        "version mismatch",
        (state) => {
          state.sessionState.guardrailPacks.packs[0].version = 99;
        },
        /persisted at version 99 but the installed version is 1/,
      ],
      [
        "more than 8 packs",
        (state) => {
          state.sessionState.guardrailPacks.packs = Array.from({ length: 9 }, (_, index) => ({ id: `pack-${index}`, version: 1 }));
        },
        /Persisted guardrail packs exceed 8 entries/,
      ],
      [
        "malformed state",
        (state) => {
          state.sessionState.guardrailPacks.state = { "validation-respect": "not-an-object" };
        },
        /state must be an object/,
      ],
      [
        "oversized state",
        (state) => {
          state.sessionState.guardrailPacks.state = { "validation-respect": { validationFailed: "x".repeat(9 * 1024) } };
        },
        /exceeds 8192 bytes/,
      ],
      [
        "state for a pack that is not in the checkpoint",
        (state) => {
          state.sessionState.guardrailPacks.state = { "destructive-commands": {} };
        },
        /state names unknown pack "destructive-commands"/,
      ],
    ];

    for (const [name, mutate, expected] of cases) {
      const { agent, checkpoints, suspended } = await suspend();
      const version = await tamperCheckpoint(checkpoints, suspended.runId, mutate);
      await assert.rejects(
        async () => {
          for await (const _event of resumeAgentRunStream(
            agent,
            { runId: suspended.runId, sessionId: suspended.sessionId },
            { decision: "approve", expectedVersion: version },
            { checkpoints, definitionRevision: "1" },
          )) {
            // drain
          }
        },
        (error: unknown) => {
          assert.ok(error instanceof AgentRunStateError, `${name}: AgentRunStateError, got ${String(error)}`);
          assert.match(error.message, expected, name);
          return true;
        },
        name,
      );
    }
  });

  it("keeps the pre-plan-104 checkpoint shape without packs and refuses an over-budget save", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "pack-byte-shape",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        // Every run's first provider turn calls the gated tool; later turns finish.
        async *generate(request: ProviderRequest) {
          const hasToolResult = request.messages.some((message) => message.content.some((block) => block.type === "tool_result"));
          if (!hasToolResult) {
            yield providerToolCall(toolCallContent("call-write", "write", { path: "a.txt" }));
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: true }) }],
    });

    // Without `persistSessionState` the checkpoint is byte-identical to a pre-plan-104 one.
    const defaultSession = agent.createSession({ id: "pack-shape-default", guardrailPacks: ["destructive-commands"] });
    const defaultRun = await defaultSession.run("mutate", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const defaultState = (await loadAgentRunState(checkpoints, { runId: defaultRun.runId })).state;
    assert.equal(defaultState.sessionState, undefined, "no opt-in, no session-state block");

    // With the opt-in but no packs, the key is absent too; the resume finds no packs and no error.
    const plainSession = agent.createSession({ id: "pack-shape-plain" });
    const plainRun = await plainSession.run("mutate", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
    });
    const plainState = (await loadAgentRunState(checkpoints, { runId: plainRun.runId })).state;
    assert.equal(plainState.sessionState?.guardrailPacks, undefined, "no packs, no pack key");
    let resumedPlain: AgentSession | undefined;
    const plainVersion = plainRun.runState?.version;
    assert.ok(plainVersion !== undefined, "suspended run carries its checkpoint version");
    for await (const _event of resumeAgentRunStream(
      agent,
      { runId: plainRun.runId, sessionId: plainRun.sessionId },
      { decision: "approve", expectedVersion: plainVersion },
      {
        checkpoints,
        definitionRevision: "1",
        persistSessionState: true,
        onSession: (reconstructed) => {
          resumedPlain = reconstructed;
        },
      },
    )) {
      // drain
    }
    assert.equal(resumedPlain?.guardrailPackRefs, undefined, "a plan-092 checkpoint resumes with no packs");

    // A lowered `maxStateBytes` refuses the save instead of truncating the pack block.
    const budgetSession = agent.createSession({ id: "pack-shape-budget", guardrailPacks: ["validation-respect"] });
    await assert.rejects(
      budgetSession.run("mutate", {
        runState: {
          checkpoints,
          definitionRevision: "1",
          interruptBeforeTool: true,
          persistSessionState: true,
          maxStateBytes: 256,
        },
      }),
      (error: unknown) => {
        assert.match(String((error as Error).message ?? error), /exceeds 256 bytes/, "the over-budget save refuses, never truncates");
        return true;
      },
    );
    const budgetRecords = await checkpoints.listCheckpoints();
    assert.equal(
      budgetRecords.items.some((record) => record.key === budgetSession.id),
      false,
      "nothing was persisted for the over-budget run",
    );

    // Inline rule packs are closures and cannot be replayed: persisting refuses loudly instead of
    // writing a row that would restore a different (or no) policy.
    const inlineSession = agent.createSession({
      id: "pack-shape-inline",
      guardrailPacks: [{ id: "inline-pack", rules: [{ id: "no-write", tool: "write", deny: () => true }] }],
    });
    await assert.rejects(
      inlineSession.run("mutate", {
        runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
      }),
      (error: unknown) => {
        // The run path wraps the compile error (same shape as the byte-budget refusal above).
        assert.match(String((error as Error).message ?? error), /rule "no-write" cannot be persisted/);
        return true;
      },
    );
  });
});
