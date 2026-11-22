/**
 * Plan 231 Task 3: `AgentConfig.durability: "turn"` appends one `run_checkpoint` entry per completed tool round, and
 * `session.continue()` resumes the interrupted run under its own id, counters, wall deadline and loop state.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { StoredAgentRunState } from "../agent-run-state.js";
import {
  AgentRunStateError,
  type Compactor,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  type JsonValue,
  type LoopStrategy,
  type ModelProvider,
  type ProviderRequest,
  type SessionEntry,
  type SessionStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { storeConformance } from "../testing/index.js";

const model = { provider: "mock", model: "demo" } as const;

/** `call:<id>` answers with that tool call, `fail` throws, anything else answers with text. */
function scriptedProvider(requests: ProviderRequest[], script: string[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      const step = script.shift() ?? "done";
      if (step === "fail") throw new Error("provider down");
      if (step.startsWith("call:")) {
        yield { type: "tool_call" as const, call: toolCallContent(step.slice(5), "work", { n: 1 }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta(step);
      yield providerDone();
    },
  };
}

const workTool = {
  name: "work",
  parameters: { type: "object", properties: { n: { type: "number" } } },
  execute: async (_args: unknown, context: { readonly toolCallId: string }) => ({
    toolCallId: context.toolCallId,
    name: "work",
    value: "ok",
  }),
};

async function agentOver(options: {
  store: SessionStore;
  script: string[];
  requests?: ProviderRequest[];
  durability?: "suspension" | "turn";
  loop?: LoopStrategy;
  compaction?: Compactor;
  instructions?: string;
  limits?: Parameters<typeof createAgent>[0]["limits"];
}) {
  return createAgent({
    id: "worker",
    model,
    packages: [providerPackage("p", [scriptedProvider(options.requests ?? [], options.script)])],
    slots: {
      store: options.store,
      ...(options.loop ? { loop: options.loop } : {}),
      ...(options.compaction ? { compaction: options.compaction } : {}),
    },
    tools: { add: [workTool] },
    ...(options.durability ? { durability: options.durability } : {}),
    ...(options.instructions ? { instructions: options.instructions } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  });
}

const checkpointsOf = (entries: readonly SessionEntry[]) => entries.filter((entry) => entry.kind === "run_checkpoint");
const stateOf = (entry: SessionEntry) => entry.data as unknown as StoredAgentRunState;

/** A loop like the default one, with strategy-level state: the number of tool rounds it ran. */
function countingLoop(seen: { restored?: JsonValue }, extra: () => JsonValue = () => null): LoopStrategy {
  let rounds = 0;
  return {
    name: "counting",
    revision: "1",
    snapshot: () => ({ rounds, extra: extra() }),
    restore: (snapshot) => {
      seen.restored = snapshot;
      rounds = (snapshot as { rounds: number }).rounds;
    },
    async run(run) {
      for (;;) {
        const turn = await run.turn();
        if (turn.stopped || turn.toolCalls.length === 0) return;
        rounds += 1;
        await run.executeTools(turn.toolCalls);
      }
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection");
}

describe("turn checkpoints (plan 231 Task 3)", () => {
  it("turn_durability_writes_one_checkpoint_per_tool_round", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOver({ store, durability: "turn", script: ["call:c1", "call:c2", "finished"] });
    const session = await agent.session({ id: "s", create: true });
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    const entries = await session.entries();
    const checkpoints = checkpointsOf(entries);
    assert.equal(checkpoints.length, 2);
    // Each checkpoint follows its round's tool result.
    for (const checkpoint of checkpoints) {
      const before = entries[entries.indexOf(checkpoint) - 1];
      assert.equal(before?.message?.role, "tool");
      assert.equal(checkpoint.runId, result.runId);
      const state = stateOf(checkpoint);
      assert.equal(state.runId, result.runId);
      assert.equal(state.status, "running");
      assert.equal(state.input, undefined);
      assert.equal(state.pendingCalls, undefined);
    }
    assert.deepEqual(
      checkpoints.map((checkpoint) => stateOf(checkpoint).counters.toolRounds),
      [1, 2],
    );
    await agent.dispose();
  });

  it("default_durability_writes_no_checkpoint", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOver({ store, script: ["call:c1", "call:c2", "finished"] });
    const session = await agent.session({ id: "s", create: true });
    assert.equal((await session.run("go")).status, "completed");
    assert.equal(checkpointsOf(await session.entries()).length, 0);
    await agent.dispose();
  });

  it("continue_restores_counters_and_deadline_from_checkpoint", async () => {
    const store = createMemorySessionStore();
    const limits = { maxTurns: 5, maxWallTimeMs: 600_000 };
    // Three tool rounds, then the provider fails on turn 4: the newest checkpoint holds 3 of 5 turns.
    const agent = await agentOver({ store, durability: "turn", limits, script: ["call:c1", "call:c2", "call:c3", "fail"] });
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("go");
    assert.equal(first.status, "failed");
    const saved = stateOf(checkpointsOf(await session.entries()).at(-1)!);
    assert.equal(saved.counters.turns, 3);
    assert.ok(saved.deadlineAt);
    await agent.dispose();

    // A new process: the model keeps calling tools, so only the restored turn budget stops it.
    const next = await agentOver({ store, durability: "turn", limits, script: ["call:c4", "call:c5", "call:c6", "call:c7"] });
    const reopened = await next.session({ id: "s" });
    const result = await reopened.continue();
    assert.equal(result.runId, first.runId, "the interrupted run continues under its own id");
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "maxTurns", "two turns were left, not five");
    const after = checkpointsOf(await reopened.entries()).map(stateOf);
    assert.deepEqual(
      after.map((state) => state.counters.turns),
      [1, 2, 3, 4, 5],
    );
    assert.ok(
      after.every((state) => state.deadlineAt === saved.deadlineAt),
      "the wall deadline is kept, not restarted",
    );
    await next.dispose();
  });

  it("continue_restores_loop_state_and_starts_fresh_without_durability", async () => {
    const store = createMemorySessionStore();
    const seen: { restored?: JsonValue } = {};
    const agent = await agentOver({ store, durability: "turn", loop: countingLoop(seen), script: ["call:c1", "call:c2", "fail"] });
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("go");
    assert.equal(first.status, "failed");
    await agent.dispose();

    const next = await agentOver({ store, durability: "turn", loop: countingLoop(seen), script: ["finished"] });
    const result = await (await next.session({ id: "s" })).continue();
    assert.equal(result.status, "completed");
    assert.equal(result.runId, first.runId);
    assert.deepEqual(seen.restored, { rounds: 2, extra: null });
    await next.dispose();

    // The default durability never reads a checkpoint: a continuation is a fresh run.
    const store2 = createMemorySessionStore();
    const writer = await agentOver({ store: store2, durability: "turn", script: ["call:c1", "fail"] });
    const firstRun = await (await writer.session({ id: "s", create: true })).run("go");
    await writer.dispose();
    const reader = await agentOver({ store: store2, script: ["finished"] });
    const fresh = await (await reader.session({ id: "s" })).continue();
    assert.equal(fresh.status, "completed");
    assert.notEqual(fresh.runId, firstRun.runId);
    await reader.dispose();
  });

  it("fingerprint_drift_fails_closed_on_continue", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOver({ store, durability: "turn", script: ["call:c1", "fail"] });
    assert.equal((await (await agent.session({ id: "s", create: true })).run("go")).status, "failed");
    await agent.dispose();

    const drifted = await agentOver({ store, durability: "turn", instructions: "Be different.", script: ["finished"] });
    const error = await rejection((await drifted.session({ id: "s" })).continue());
    assert.ok(error instanceof AgentRunStateError, String(error));
    assert.match((error as Error).message, /fingerprint mismatch on continue/);
    await drifted.dispose();
  });

  it("checkpoints_are_not_messages_and_not_sent_to_the_provider", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const agent = await agentOver({ store, requests, durability: "turn", script: ["call:c1", "finished"] });
    const session = await agent.session({ id: "s", create: true });
    await session.run("go");
    assert.equal(checkpointsOf(await session.entries()).length, 1);
    assert.deepEqual(
      (await session.messages()).map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    const lastRequest = JSON.stringify(requests.at(-1));
    assert.ok(!lastRequest.includes("toolRounds") && !lastRequest.includes("run_checkpoint"), "no checkpoint field reaches the provider");
    await agent.dispose();
  });

  it("oversized_loop_state_fails_closed", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOver({
      store,
      durability: "turn",
      loop: countingLoop({}, () => "x".repeat(300 * 1024)),
      script: ["call:c1", "never reached"],
    });
    const session = await agent.session({ id: "s", create: true });
    const result = await session.run("go");
    assert.equal(result.status, "failed");
    assert.match(result.error?.message ?? "", /exceeds 262144 bytes/);
    assert.equal(checkpointsOf(await session.entries()).length, 0);
    assert.equal((await session.messages()).at(-1)?.role, "tool", "the run stops before its next turn");
    await agent.dispose();
  });

  it("a_custom_loop_without_snapshot_and_restore_rejects_turn_durability", async () => {
    const store = createMemorySessionStore();
    const loop: LoopStrategy = {
      name: "plain",
      async run(run) {
        await run.turn();
      },
    };
    const agent = await agentOver({ store, durability: "turn", loop, script: ["hi"] });
    const session = await agent.session({ id: "s", create: true });
    const error = await rejection(session.run("go"));
    assert.equal((error as { code?: string }).code, "ERR_PRISM_LOOP_NOT_DURABLE");
    await agent.dispose();
  });

  it("checkpoint_survives_a_tail_snapshot_after_compaction", async () => {
    const store = createMemorySessionStore();
    const writer = await agentOver({ store, durability: "turn", script: ["call:c1", "fail"] });
    const first = await (await writer.session({ id: "s", create: true })).run("go");
    assert.equal(first.status, "failed");
    await writer.dispose();
    // The run's next round got as far as a tool result before the process died: two messages after the checkpoint.
    let parentId = (await store.list("s")).at(-1)!.id;
    for (const message of [
      { role: "assistant" as const, content: [toolCallContent("c2", "work", { n: 1 })] },
      { role: "tool" as const, content: [{ type: "tool_result" as const, toolCallId: "c2", name: "work", value: "ok" }] },
    ]) {
      const entry = createSessionEntry({ sessionId: "s", parentId, runId: first.runId, kind: "message", message });
      await store.append(entry);
      parentId = entry.id;
    }
    // Summarize through the assistant call, keeping nothing: the checkpoint is older than `throughEntryId`.
    const compactor: Compactor = {
      name: "through-the-call",
      compact(context) {
        const through = context.entries.filter((entry) => entry.kind === "message").at(-2);
        return {
          summary: "summary",
          entries: [
            createSessionEntry({
              sessionId: context.sessionId,
              kind: "compaction",
              summary: "summary",
              data: { throughEntryId: through?.id, keepEntryIds: [] },
            }),
          ],
        };
      },
    };
    const compacting = await agentOver({ store, durability: "turn", compaction: compactor, script: [] });
    await (await compacting.session({ id: "s" })).compact();
    await compacting.dispose();
    const checkpointId = checkpointsOf(await store.list("s"))[0]!.id;
    const tail = await store.readBranchPath!({ sessionId: "s", from: "compaction" });
    assert.ok(
      tail.items.some((entry) => entry.id === checkpointId),
      "the tail read returns the pinned checkpoint",
    );

    const next = await agentOver({ store, durability: "turn", script: ["finished"] });
    const result = await (await next.session({ id: "s" })).continue();
    assert.equal(result.status, "completed");
    assert.equal(result.runId, first.runId, "the continuation found the checkpoint through the tail snapshot");
    await next.dispose();
  });

  it("store_conformance_run_checkpoint_kind", async () => {
    // The memory store here; JSONL, SQLite and Postgres run the same leg in their package suites.
    await storeConformance(() => createMemorySessionStore());
  });
});
