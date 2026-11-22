/**
 * Plan 231 Task 4: loop state belongs to the run. A `state: "run"` loop records its state with
 * `run.checkpoint(value)` and reads it back from `run.restored`; strategy-level `snapshot`/`restore` keep
 * working for one run at a time and fail closed (`ERR_PRISM_LOOP_SHARED_STATE`) when a second run would share them.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  AgentLoopStateError,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type JsonValue,
  type LoopStrategy,
  type ModelProvider,
  type RunResult,
  type Session,
  type SessionStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { assertConcurrentLoopResume } from "../testing/index.js";

const model = { provider: "mock", model: "demo" } as const;

/** First request per session: one `work` call; every later one: text. Keyed by the session's first user message. */
function perSessionProvider(): ModelProvider {
  const turns = new Map<string, number>();
  return {
    id: "mock",
    async *generate(request) {
      const key = JSON.stringify(request.messages.find((message) => message.role === "user")?.content ?? "");
      const turn = (turns.get(key) ?? 0) + 1;
      turns.set(key, turn);
      if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent(`c${turns.size}`, "work", {}) };
      else yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

const workTool = {
  name: "work",
  parameters: { type: "object" },
  execute: (_args: unknown, context: { readonly toolCallId: string }) => ({ toolCallId: context.toolCallId, name: "work", value: "ok" }),
};

/** A per-run loop: checkpoints the run's own input text, records what each run restored. */
function perRunLoop(restored: Record<string, JsonValue | undefined>): LoopStrategy {
  return {
    name: "per-run",
    revision: "1",
    state: "run",
    async run(run) {
      restored[run.session.id] = run.restored;
      const label = typeof run.input === "string" ? run.input : ((run.restored as { label?: string } | undefined)?.label ?? "?");
      run.checkpoint({ label });
      for (;;) {
        const turn = await run.turn();
        if (turn.toolCalls.length === 0) return;
        const results = await run.executeTools(turn.toolCalls);
        if (results.some((result) => result.error?.code === "approval_pending")) return;
      }
    },
  };
}

/** A legacy loop that keeps its state on the strategy object. */
function strategyLoop(state: { restored?: JsonValue; runs: number }, gate?: Promise<void>): LoopStrategy {
  return {
    name: "legacy",
    revision: "1",
    snapshot: () => ({ runs: state.runs }),
    restore: (snapshot) => {
      state.restored = snapshot;
    },
    async run(run) {
      state.runs += 1;
      await gate;
      const turn = await run.turn();
      if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
    },
  };
}

async function agentWith(loop: LoopStrategy, store: SessionStore = createMemorySessionStore()) {
  return createAgent({
    id: "loop-state",
    model,
    packages: [providerPackage("p", [perSessionProvider()])],
    slots: { store, loop },
    tools: { add: [workTool] },
    hooks: askEveryTool(),
  });
}

async function approveAll(session: Session, result: RunResult): Promise<string | undefined> {
  let last: string | undefined;
  for await (const event of session.resume(
    (result.pending ?? []).map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })),
  )) {
    last = event.type;
  }
  return last;
}

const storedLoopSnapshot = async (session: Session) =>
  ((await session.entries()).find((entry) => entry.kind === "suspended_run")?.data as { loop?: { snapshot?: unknown } } | undefined)?.loop
    ?.snapshot;

describe("per-run loop state (plan 231 Task 4)", () => {
  it("per_run_loop_state_survives_suspend_and_resume", async () => {
    const store = createMemorySessionStore();
    const restored: Record<string, JsonValue | undefined> = {};
    const agent = await agentWith(perRunLoop(restored), store);
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("alpha");
    assert.equal(first.status, "suspended");
    assert.deepEqual(await storedLoopSnapshot(session), { label: "alpha" });
    await agent.dispose();

    // A new "process": a fresh agent and loop object over the same store.
    const next = await agentWith(perRunLoop(restored), store);
    const reopened = await next.session({ id: "s" });
    assert.equal(await approveAll(reopened, first), "run.completed");
    assert.deepEqual(restored.s, { label: "alpha" });
    await next.dispose();
  });

  it("two_sessions_resume_with_separate_loop_state", async () => {
    const restored: Record<string, JsonValue | undefined> = {};
    const agent = await agentWith(perRunLoop(restored));
    const [a, b] = await Promise.all([agent.session({ id: "a", create: true }), agent.session({ id: "b", create: true })]);
    const [ra, rb] = await Promise.all([a.run("alpha"), b.run("beta")]);
    assert.equal(ra.status, "suspended");
    assert.equal(rb.status, "suspended");
    assert.deepEqual(await Promise.all([approveAll(a, ra), approveAll(b, rb)]), ["run.completed", "run.completed"]);
    assert.deepEqual(restored, { a: { label: "alpha" }, b: { label: "beta" } });
    await agent.dispose();
  });

  it("shared_strategy_state_fails_closed_on_second_run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = { runs: 0 };
    const loop = strategyLoop(state, gate);
    // One strategy object shared by two agents: the guard counts runs per strategy object, not per agent.
    const [first, second] = await Promise.all([agentWith(loop), agentWith(loop)]);
    const running = (await first.session({ id: "a", create: true })).run("alpha");
    while (state.runs === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const error = await (await second.session({ id: "b", create: true })).run("beta").then(
      () => undefined,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof AgentLoopStateError, String(error));
    assert.equal(error.code, "ERR_PRISM_LOOP_SHARED_STATE");
    release();
    assert.equal((await running).status, "suspended");
    // Once the first run settles, the strategy serves the next run.
    assert.equal((await (await second.session({ id: "c", create: true })).run("gamma")).status, "suspended");
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("legacy_snapshot_restore_still_works_for_one_run", async () => {
    const store = createMemorySessionStore();
    const state: { restored?: JsonValue; runs: number } = { runs: 0 };
    const agent = await agentWith(strategyLoop(state), store);
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("alpha");
    assert.equal(first.status, "suspended");
    assert.deepEqual(await storedLoopSnapshot(session), { runs: 1 });
    assert.equal(await approveAll(session, first), "run.completed");
    assert.deepEqual(state.restored, { runs: 1 });
    await agent.dispose();
  });

  it("loop_conformance_concurrent_resume", async () => {
    const restored: Record<string, JsonValue | undefined> = {};
    const states = await assertConcurrentLoopResume(perRunLoop(restored));
    assert.deepEqual(states, {
      "concurrent-alpha": { label: "go concurrent-alpha" },
      "concurrent-beta": { label: "go concurrent-beta" },
    });
    assert.deepEqual(restored, {
      "concurrent-alpha": { label: "go concurrent-alpha" },
      "concurrent-beta": { label: "go concurrent-beta" },
    });
    // A strategy-level loop cannot serve two concurrent runs.
    await assert.rejects(assertConcurrentLoopResume(strategyLoop({ runs: 0 })), /ERR_PRISM_LOOP_SHARED_STATE|already has an active run/);
  });

  it("turn_checkpoint_carries_run_checkpoint_value", async () => {
    const store = createMemorySessionStore();
    let failNext = true;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        const last = request.messages.at(-1);
        if (last?.role === "user") yield { type: "tool_call" as const, call: toolCallContent("c1", "work", {}) };
        else if (failNext) {
          failNext = false;
          throw new Error("provider down");
        } else yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const restored: Record<string, JsonValue | undefined> = {};
    const make = () =>
      createAgent({
        id: "loop-state",
        model,
        durability: "turn",
        packages: [providerPackage("p", [provider])],
        slots: { store, loop: perRunLoop(restored) },
        tools: { add: [workTool] },
      });
    const agent = await make();
    const first = await (await agent.session({ id: "s", create: true })).run("alpha");
    assert.equal(first.status, "failed");
    await agent.dispose();
    const next = await make();
    const result = await (await next.session({ id: "s" })).continue();
    assert.equal(result.status, "completed");
    assert.deepEqual(restored.s, { label: "alpha" });
    await next.dispose();
  });
});
