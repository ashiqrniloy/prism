import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  createAgent,
  createDefaultCompactor,
  createMemorySessionStore,
  createSessionEntry,
  definePackage,
  type JsonObject,
  KERNEL_API_LEVEL,
  type ModelProvider,
  type PackageAPI,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  resolveSessionLimits,
  SessionLimitError,
  SessionLimitsUnreadableError,
  type SessionStore,
  toolCallContent,
} from "../index.js";
import type { SessionContext } from "../session-context.js";
import { providerPackage } from "../provider-kit/index.js";
import { assertCompactorConforms } from "../testing/compaction-conformance.js";
import { mockProvider, storeConformance } from "../testing/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;

function usageProvider(
  steps: ReadonlyArray<{
    readonly text?: string;
    readonly usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
      readonly cost?: number;
      readonly currency?: string;
    };
    readonly tool?: { readonly id: string; readonly name: string; readonly args?: JsonObject };
  }>,
  seen?: number[],
): ModelProvider {
  let index = 0;
  return {
    id: "mock",
    async *generate() {
      seen?.push(index);
      const step = steps[index] ?? { text: "ok" };
      index += 1;
      if (step.tool) {
        yield providerToolCall(toolCallContent(step.tool.id, step.tool.name, step.tool.args ?? {}));
      } else {
        yield providerTextDelta(step.text ?? "ok");
      }
      if (step.usage) yield providerUsage(step.usage);
      yield providerDone();
    },
  };
}

function countingTailStore(inner: SessionStore): { store: SessionStore; tailCalls: number } {
  const state = {
    tailCalls: 0,
    store: {
      append: inner.append.bind(inner),
      list: inner.list.bind(inner),
      get: inner.get?.bind(inner),
      listSessions: inner.listSessions?.bind(inner),
      deleteSession: inner.deleteSession?.bind(inner),
      searchSessions: inner.searchSessions?.bind(inner),
      tipCheck: inner.tipCheck,
      appendMany: inner.appendMany?.bind(inner),
      readBranchPath: inner.readBranchPath
        ? (query: Parameters<NonNullable<SessionStore["readBranchPath"]>>[0]) => {
            if (query.from === "compaction") state.tailCalls += 1;
            return inner.readBranchPath!(query);
          }
        : undefined,
    } satisfies SessionStore,
  };
  return state;
}

describe("session limits (plan 239 Task 8)", () => {
  it("session_cost_limit_spans_runs", async () => {
    const store = createMemorySessionStore();
    const provider = usageProvider([
      { text: "r1", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, cost: 0.1, currency: "USD" } },
      { text: "r2", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, cost: 0.1, currency: "USD" } },
      { text: "r3", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, cost: 0.1, currency: "USD" } },
    ]);
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("mock", [provider])],
      slots: { store },
    });
    const session = await agent.session({
      limits: { maxCost: { amount: 0.25, currency: "USD" } },
    });

    const r1 = await session.run("one");
    assert.equal(r1.status, "completed");
    const l1 = await session.limits();
    assert.equal(l1.counters.runs, 1);
    assert.equal(l1.counters.totalTokens, 20);
    assert.equal(l1.counters.cost, 0.1);
    assert.equal(l1.remaining.cost, 0.15);
    assert.equal(l1.remaining.runs, null);

    const r2 = await session.run("two");
    assert.equal(r2.status, "completed");
    const l2 = await session.limits();
    assert.equal(l2.counters.runs, 2);
    assert.equal(l2.counters.cost, 0.2);
    assert.equal(l2.remaining.cost, 0.05);

    const events: AgentEvent[] = [];
    for await (const event of session.stream("three")) events.push(event);
    const failed = events.find((e) => e.type === "run.failed");
    assert.ok(failed && failed.type === "run.failed");
    assert.equal(failed.limit?.limit, "maxCost");
    assert.equal(failed.limit?.scope, "session");
    assert.equal(failed.limit?.maximum, 0.25);
    assert.ok((failed.limit?.observed ?? 0) > 0.25);
    assert.equal(failed.limit?.currency, "USD");
    assert.ok(failed.attribution);

    const l3 = await session.limits();
    assert.equal(l3.counters.runs, 3);
    assert.equal(l3.exhausted, true);
    assert.equal(l3.remaining.cost, 0);

    await agent.dispose();
  });

  it("session_limits_survive_a_process_restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-session-limits-"));
    try {
      const { createJsonlSessionStore } = (await import("@arnilo/prism-extensions/store-jsonl" as string)) as {
        createJsonlSessionStore: (opts: { dir: string }) => SessionStore;
      };

      const store1 = createJsonlSessionStore({ dir });
      const agent1 = await createAgent({
        model: MODEL,
        packages: [
          providerPackage("mock", [
            usageProvider([{ text: "r1", usage: { inputTokens: 40, outputTokens: 60, totalTokens: 100, cost: 0.2, currency: "USD" } }]),
          ]),
        ],
        slots: { store: store1 },
      });
      const session1 = await agent1.session({
        limits: { maxCost: { amount: 0.3, currency: "USD" }, maxTotalTokens: 250, maxRuns: 3 },
      });
      const sessionId = session1.id;
      const r1 = await session1.run("first");
      assert.equal(r1.status, "completed");
      await agent1.dispose();

      // New store and new agent instance over the same JSONL directory (simulated restart).
      const store2 = createJsonlSessionStore({ dir });
      const agent2 = await createAgent({
        model: MODEL,
        packages: [
          providerPackage("mock", [
            usageProvider([
              { text: "r2", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100, cost: 0.05, currency: "USD" } },
              { text: "r3", usage: { inputTokens: 60, outputTokens: 40, totalTokens: 100, cost: 0.1, currency: "USD" } },
            ]),
          ]),
        ],
        slots: { store: store2 },
      });
      const session2 = await agent2.session({
        id: sessionId,
        limits: { maxCost: { amount: 0.3, currency: "USD" }, maxTotalTokens: 250, maxRuns: 3 },
      });
      const restored = await session2.limits();
      assert.equal(restored.counters.runs, 1);
      assert.equal(restored.counters.totalTokens, 100);
      assert.equal(restored.counters.cost, 0.2);
      assert.equal(restored.remaining.runs, 2);
      assert.equal(restored.remaining.totalTokens, 150);
      assert.equal(restored.remaining.cost, 0.1);

      const r2 = await session2.run("second");
      assert.equal(r2.status, "completed");

      const r3 = await session2.run("third");
      assert.equal(r3.status, "failed");
      assert.equal(r3.limit?.scope, "session");
      assert.equal(r3.limit?.limit, "maxTotalTokens");
      assert.equal(r3.limit?.maximum, 250);
      assert.equal(r3.limit?.observed, 300);

      await assert.rejects(session2.run("fourth"), (error) => error instanceof SessionLimitError && error.code === "session_limit");
      await agent2.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("child_run_usage_counts_toward_the_parent_session", async () => {
    let apiRef: PackageAPI | undefined;
    const spawner = definePackage({
      name: "test/spawner",
      version: "0.1.0",
      requires: { api: KERNEL_API_LEVEL },
      capabilities: ["sessions"],
      setup(prism) {
        apiRef = prism;
        prism.tools.register({
          name: "spawn",
          description: "spawn child",
          parameters: { type: "object", properties: {} },
          effects: [],
          async execute(_args, ctx) {
            const child = await apiRef!.sessions.open({ parent: { sessionId: ctx.sessionId } });
            const res = await child.run("child work", { chargeTo: ctx.session });
            return { toolCallId: ctx.toolCallId!, name: "spawn", value: { text: res.text, status: res.status } };
          },
        });
      },
    });
    const store = createMemorySessionStore();
    const provider = usageProvider([
      { tool: { id: "c1", name: "spawn" }, usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
      { text: "child ok", usage: { inputTokens: 150, outputTokens: 150, totalTokens: 300 } },
      { text: "parent done", usage: { inputTokens: 25, outputTokens: 25, totalTokens: 50 } },
      { text: "run2 over", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
    ]);
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("mock", [provider]), spawner],
      slots: { store },
    });
    const parent = await agent.session({ limits: { maxTotalTokens: 500 } });
    const r1 = await parent.run("go");
    assert.equal(r1.status, "completed");
    const status = await parent.limits();
    assert.equal(status.counters.totalTokens, 450);
    assert.equal(status.remaining.totalTokens, 50);

    const r2 = await parent.run("more");
    assert.equal(r2.status, "failed");
    assert.equal(r2.limit?.scope, "session");
    assert.equal(r2.limit?.limit, "maxTotalTokens");
    assert.equal(r2.limit?.maximum, 500);
    assert.equal(r2.limit?.observed, 550);
    await agent.dispose();
  });

  it("async_child_usage_counts_after_the_parent_run_ends", async () => {
    let apiRef: PackageAPI | undefined;
    let capturedView: SessionContext | undefined;
    const capture = definePackage({
      name: "test/capture",
      version: "0.1.0",
      requires: { api: KERNEL_API_LEVEL },
      capabilities: ["sessions"],
      setup(prism) {
        apiRef = prism;
        prism.hooks.on("run.started", (_event, ctx) => {
          capturedView ??= ctx.session;
        });
      },
    });
    const store = createMemorySessionStore();
    const provider = usageProvider([
      { text: "parent ok", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
      { text: "child1 ok", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
      { text: "child2 over", usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } },
    ]);
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("mock", [provider]), capture],
      slots: { store },
    });
    const parent = await agent.session({ limits: { maxTotalTokens: 300 } });
    const r1 = await parent.run("parent run");
    assert.equal(r1.status, "completed");
    assert.ok(capturedView);

    // Parent run has ended; async child charges parent's session tracker across turns.
    const child = await apiRef!.sessions.open({ parent: { sessionId: parent.id } });
    const c1 = await child.run("within budget", { chargeTo: capturedView });
    assert.equal(c1.status, "completed");
    assert.equal((await parent.limits()).counters.totalTokens, 200);
    assert.equal((await parent.limits()).remaining.totalTokens, 100);

    // Persisted in store so even a reopened parent session sees the async child's 100 tokens.
    const reopenedParent = await agent.session({ id: parent.id, limits: { maxTotalTokens: 300 } });
    assert.equal((await reopenedParent.limits()).counters.totalTokens, 200);

    // Second child turn pushes parent session past 300 -> fails child and exhausts parent session.
    const c2 = await child.run("over budget", { chargeTo: capturedView });
    assert.equal(c2.status, "failed");
    assert.equal(c2.limit?.scope, "session");
    assert.equal(c2.limit?.limit, "maxTotalTokens");
    assert.equal(c2.limit?.maximum, 300);
    assert.equal(c2.limit?.observed, 400);

    await assert.rejects(
      parent.run("refused"),
      (error) => error instanceof SessionLimitError && error.code === "session_limit" && error.message.includes("maxTotalTokens"),
    );
    await agent.dispose();
  });

  it("exhausted_session_refuses_a_new_run_and_appends_nothing", async () => {
    const store = createMemorySessionStore();
    const seen: number[] = [];
    const provider = usageProvider([{ text: "only one", usage: { totalTokens: 10 } }], seen);
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("mock", [provider])],
      slots: { store },
    });
    const session = await agent.session({ limits: { maxRuns: 1 } });
    assert.equal((await session.run("run 1")).status, "completed");
    const entriesBefore = (await store.list(session.id)).length;
    assert.equal(seen.length, 1);

    await assert.rejects(
      session.run("run 2"),
      (error) =>
        error instanceof SessionLimitError &&
        error.code === "session_limit" &&
        error.breach.limit === "maxRuns" &&
        error.breach.scope === "session" &&
        error.message.includes("maxRuns"),
    );
    assert.equal((await store.list(session.id)).length, entriesBefore);
    assert.equal(seen.length, 1, "provider must not be called when session limit is exhausted");

    // Expired deadline at start also refuses and appends nothing.
    const expiredSession = await agent.session({ limits: { deadline: new Date(Date.now() - 1000).toISOString() } });
    await assert.rejects(
      expiredSession.run("late"),
      (error) => error instanceof SessionLimitError && error.code === "session_limit" && error.message.includes("deadline"),
    );
    assert.equal((await store.list(expiredSession.id)).length, 0);
    await agent.dispose();
  });

  it("deadline_arms_the_run_wall_timer", async () => {
    const store = createMemorySessionStore();
    const slowProvider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 500);
          request.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(request.signal?.reason ?? new Error("aborted"));
          });
        });
        yield providerTextDelta("too late");
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("mock", [slowProvider])],
      slots: { store },
      limits: { maxWallTimeMs: 60_000 },
    });
    const deadline = new Date(Date.now() + 40).toISOString();
    const session = await agent.session({ limits: { deadline } });
    const result = await session.run("slow");
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "deadline");
    assert.equal(result.limit?.scope, "session");
    assert.ok(result.attribution);

    // If run maxWallTimeMs is shorter than session deadline, run limit wins without `scope`.
    const session2 = await agent.session({ limits: { deadline: new Date(Date.now() + 10_000).toISOString() } });
    const result2 = await session2.run("run wall shorter", { limits: { maxWallTimeMs: 25 } });
    assert.equal(result2.status, "failed");
    assert.equal(result2.limit?.limit, "maxWallTimeMs");
    assert.equal(result2.limit?.scope, undefined);
    await agent.dispose();
  });

  it("malformed_session_limits_entry_fails_closed", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
      slots: { store },
    });
    const session = await agent.session({ limits: { maxRuns: 5 } });
    assert.equal((await session.run("ok")).status, "completed");
    const leaf = session.leafId;
    await store.append(
      createSessionEntry({
        sessionId: session.id,
        parentId: leaf,
        kind: "session_limits",
        data: { schemaVersion: 1, runs: -5, totalTokens: 0, cost: 0 },
      }),
    );

    const reopened = await agent.session({ id: session.id, limits: { maxRuns: 5 } });
    await assert.rejects(
      reopened.run("next"),
      (error) => error instanceof SessionLimitsUnreadableError && error.code === "session_limits_unreadable",
    );
    await assert.rejects(
      reopened.limits(),
      (error) => error instanceof SessionLimitsUnreadableError && error.code === "session_limits_unreadable",
    );

    // Also verify JSONL store passes malformed entry through to fail closed with session_limits_unreadable.
    const dir = mkdtempSync(join(tmpdir(), "prism-malformed-limits-"));
    try {
      const { createJsonlSessionStore } = (await import("@arnilo/prism-extensions/store-jsonl" as string)) as {
        createJsonlSessionStore: (opts: { dir: string }) => SessionStore;
      };
      const jsonlStore = createJsonlSessionStore({ dir });
      await jsonlStore.append(
        createSessionEntry({
          sessionId: "s-bad",
          kind: "session_limits",
          data: "not-an-object",
        }),
      );
      const jsonlAgent = await createAgent({
        model: MODEL,
        packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
        slots: { store: jsonlStore },
      });
      const badSession = await jsonlAgent.session({ id: "s-bad", limits: { maxRuns: 5 } });
      await assert.rejects(
        badSession.run("fail"),
        (error) => error instanceof SessionLimitsUnreadableError && error.code === "session_limits_unreadable",
      );
      await jsonlAgent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await agent.dispose();
  });

  it("no_session_limit_writes_nothing", async () => {
    const store = createMemorySessionStore();
    const provider = usageProvider([
      { tool: { id: "t1", name: "ping" }, usage: { totalTokens: 20 } },
      { text: "done", usage: { totalTokens: 30 } },
    ]);
    const agent = await createAgent({
      model: MODEL,
      durability: "turn",
      tools: {
        add: [
          {
            name: "ping",
            description: "ping",
            parameters: { type: "object", properties: {} },
            effects: [],
            execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId!, name: "ping", value: "pong" }),
          },
        ],
      },
      packages: [providerPackage("mock", [provider])],
      slots: { store },
    });
    const s1 = await agent.session();
    assert.equal((await s1.run("hi")).status, "completed");
    const s1Entries = await store.list(s1.id);
    assert.equal(s1Entries.filter((e) => e.kind === "session_limits").length, 0);
    for (const entry of s1Entries) {
      if (entry.kind === "run_checkpoint") {
        assert.equal((entry.data as { sessionLimits?: unknown }).sessionLimits, undefined);
      }
    }

    const s2 = await agent.session({ limits: { maxRuns: null, maxTotalTokens: null, maxCost: null, deadline: null } });
    assert.equal((await s2.run("hi")).status, "completed");
    assert.equal((await store.list(s2.id)).filter((e) => e.kind === "session_limits").length, 0);
    await agent.dispose();
  });

  it("narrows_agent_session_limits_by_min_and_rejects_invalid_shapes", async () => {
    const t1 = "2026-11-20T00:00:00.000Z";
    const t2 = "2026-11-25T00:00:00.000Z";
    const narrowed = resolveSessionLimits(
      { maxRuns: 10, maxTotalTokens: 1000, maxCost: { amount: 5, currency: "USD" }, deadline: t2 },
      { maxRuns: 4, maxTotalTokens: null, maxCost: { amount: 10, currency: "USD" }, deadline: t1 },
    );
    assert.equal(narrowed.maxRuns, 4);
    assert.equal(narrowed.maxTotalTokens, 1000);
    assert.equal(narrowed.maxCost?.amount, 5);
    assert.equal(narrowed.deadline, t1);

    assert.throws(() => resolveSessionLimits({ maxRuns: 0 }), /positive safe integer/);
    assert.throws(() => resolveSessionLimits({ deadline: "not-a-date" }), /ISO 8601/);
    assert.throws(
      () => resolveSessionLimits({ maxCost: { amount: 1, currency: "USD" } }, { maxCost: { amount: 1, currency: "EUR" } }),
      /currencies/,
    );
    await assert.rejects(createAgent({ model: MODEL, sessionLimits: { unknown: 1 } as never }), /Unknown key|Unknown session limit/i);
  });

  it("session_limits_survive_compaction_and_tail_snapshot", async () => {
    const inner = createMemorySessionStore();
    const counted = countingTailStore(inner);
    const agent = await createAgent({
      model: MODEL,
      compaction: false,
      packages: [
        providerPackage("mock", [
          usageProvider([
            { text: "a1", usage: { totalTokens: 60 } },
            { text: "a2", usage: { totalTokens: 60 } },
            { text: "a3", usage: { totalTokens: 60 } },
          ]),
        ]),
      ],
      slots: { store: counted.store, compaction: createDefaultCompactor() },
    });
    const session = await agent.session({ limits: { maxTotalTokens: 200, maxRuns: 4 } });
    assert.equal((await session.run("u1")).status, "completed");
    assert.equal((await session.run("u2")).status, "completed");
    await session.compact({ keepRecentEntries: 1 });

    // Reopen over the tail-capable store: compaction pinned the newest session_limits entry.
    const reopened = await agent.session({ id: session.id, limits: { maxTotalTokens: 200, maxRuns: 4 } });
    assert.ok(counted.tailCalls > 0);
    const status = await reopened.limits();
    assert.equal(status.counters.runs, 2);
    assert.equal(status.counters.totalTokens, 120);
    assert.equal(status.remaining.totalTokens, 80);

    const r3 = await reopened.run("u3");
    assert.equal(r3.status, "completed");
    assert.equal((await reopened.limits()).counters.totalTokens, 180);
    await agent.dispose();
  });

  it("session_limits_ride_turn_checkpoint_across_crash_and_continue", async () => {
    const store = createMemorySessionStore();
    const calls: string[] = [];
    const provider1: ModelProvider = {
      id: "mock",
      async *generate() {
        calls.push("turn1");
        yield providerToolCall(toolCallContent("call-1", "step", {}));
        yield providerUsage({ inputTokens: 40, outputTokens: 20, totalTokens: 60 });
        yield providerDone();
      },
    };
    const agent1 = await createAgent({
      model: MODEL,
      durability: "turn",
      tools: {
        add: [
          {
            name: "step",
            description: "step",
            parameters: { type: "object", properties: {} },
            effects: [],
            execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId!, name: "step", value: "ok" }),
          },
        ],
      },
      packages: [providerPackage("mock", [provider1])],
      slots: { store },
    });

    // Simulate a crash on turn 2 before run end (abort or throw after turn 1 checkpoint landed? Let's test direct crash simulation: fail on turn 2 throws, wait - failed run writes session_limits; to test a hard crash without run-end append, inspect the checkpoint written after turn 1!).
    let turn = 0;
    const crashingProvider: ModelProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield providerToolCall(toolCallContent("call-1", "step", {}));
          yield providerUsage({ inputTokens: 40, outputTokens: 20, totalTokens: 60 });
          yield providerDone();
          return;
        }
        yield providerTextDelta("turn2");
        yield providerUsage({ inputTokens: 30, outputTokens: 20, totalTokens: 50 });
        yield providerDone();
      },
    };
    await agent1.session({ limits: { maxTotalTokens: 150, maxRuns: 2 } });
    // Run turn 1 tool round and capture entries up to run_checkpoint (simulating process kill right after checkpoint).
    const agentKill = await createAgent({
      model: MODEL,
      durability: "turn",
      tools: {
        add: [
          {
            name: "step",
            description: "step",
            parameters: { type: "object", properties: {} },
            effects: [],
            execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId!, name: "step", value: "ok" }),
          },
        ],
      },
      packages: [providerPackage("mock", [crashingProvider])],
      slots: { store },
    });
    const live = await agentKill.session({ limits: { maxTotalTokens: 150, maxRuns: 2 } });
    await live.run("start");
    const all = await store.list(live.id);
    const checkpointIdx = all.findIndex((e) => e.kind === "run_checkpoint");
    assert.ok(checkpointIdx >= 0);

    // Copy entries up to run_checkpoint into a fresh store (exact post-crash store state: no session_limits entry yet).
    const crashedStore = createMemorySessionStore();
    for (const entry of all.slice(0, checkpointIdx + 1)) {
      await crashedStore.append({ ...entry, sessionId: "crashed" });
    }
    // Wait: continuationCheckpoint checks state.sessionId === sessionId, so replay with exact sessionId:
    const exactCrashStore = createMemorySessionStore();
    for (const entry of all.slice(0, checkpointIdx + 1)) {
      await exactCrashStore.append(entry);
    }

    const agent2 = await createAgent({
      model: MODEL,
      durability: "turn",
      tools: {
        add: [
          {
            name: "step",
            description: "step",
            parameters: { type: "object", properties: {} },
            effects: [],
            execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId!, name: "step", value: "ok" }),
          },
        ],
      },
      packages: [
        providerPackage("mock", [usageProvider([{ text: "resumed ok", usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 } }])]),
      ],
      slots: { store: exactCrashStore },
    });
    const recovered = await agent2.session({ id: live.id, limits: { maxTotalTokens: 150, maxRuns: 2 } });
    const beforeContinue = await recovered.limits();
    assert.equal(beforeContinue.counters.runs, 0);
    assert.equal(beforeContinue.counters.totalTokens, 60);

    const continued = await recovered.continue();
    assert.equal(continued.status, "completed");
    const afterContinue = await recovered.limits();
    assert.equal(afterContinue.counters.runs, 1);
    assert.equal(afterContinue.counters.totalTokens, 100);
    assert.equal(afterContinue.remaining.totalTokens, 50);

    await agent1.dispose();
    await agentKill.dispose();
    await agent2.dispose();
  });

  it("store_and_compaction_conformance_pass_with_session_limits", async () => {
    await storeConformance(() => createMemorySessionStore());
    await assertCompactorConforms(createDefaultCompactor());
  });
});
