/**
 * Plan 218.3 Task 2: session memory is the compaction system when the host leaves `context.compaction` on. It answers
 * every compaction vote of a memory-on session on two triggers (mid-loop at a window share, between loops at a token cap
 * or share), and no second compaction system can run beside it. With `context.compaction: false` it neither votes nor
 * claims the slot, so a host can list LLM compaction instead.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ModelProvider, ProviderRequest, SessionEntry } from "@arnilo/prism";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem, { type MemorySystemConfig, MemorySystemError } from "../../index.js";

/** A large window, so the mid-loop share is out of reach unless a test lowers it. */
const MODEL = { provider: "main", model: "main-model", limits: { contextWindow: 1_000_000, maxOutputTokens: 0 } };

/** Answers one `noop` tool call on the first turn of each run, then text; `failOn` throws on that call (1-based). */
function mainProvider(requests: ProviderRequest[], options: { failOn?: number } = {}): ModelProvider {
  let calls = 0;
  return {
    id: "main",
    async *generate(request) {
      calls += 1;
      if (options.failOn === calls) throw new Error("provider down");
      requests.push(request);
      const last = request.messages.at(-1);
      if (last?.role === "user") yield providerToolCall(toolCallContent(`c${calls}`, "noop", {}));
      else yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

const noopTool = definePackage({
  name: "@acme/noop",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "noop",
      description: "Does nothing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "noop", value: "ok" }),
    });
  },
})();

async function harness(config: MemorySystemConfig, options: { failOn?: number; spy?: () => void; extra?: unknown[] } = {}) {
  const requests: ProviderRequest[] = [];
  const agent = await createAgent({
    model: MODEL,
    packages: [
      providerPackage("main-provider", [mainProvider(requests, options)]),
      noopTool,
      // `wm: false` and a far STM trigger keep the background pass out of these runs: only the votes are under test.
      memorySystem({ stm: { triggerTokens: 10_000_000 }, wm: false, ...config }),
      ...((options.extra ?? []) as never[]),
    ],
    slots: { store: createMemorySessionStore() },
    ...(options.spy
      ? {
          compaction: {
            trigger: {
              type: "custom" as const,
              shouldCompact: () => {
                options.spy!();
                return false;
              },
            },
          },
        }
      : {}),
  });
  return { agent, requests };
}

/**
 * Stand-ins for the LLM compaction package and context-engineering's fold: each provides the service its real package
 * provides (the real packages are exercised in `@arnilo/prism-extensions`, which depends on this one).
 */
const llmCompaction = () =>
  definePackage({
    name: "@acme/llm-compaction",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["slot:compaction"],
    setup(prism) {
      const other = prism.services.consume<{ name?: string }>("compaction.system");
      if (other) throw new TypeError(`LLM compaction cannot run beside another compaction system ("${other.name}")`);
      prism.slots.compaction.provide({ name: "llm-compaction", compact: (context) => prism.slots.compaction.default.compact(context) });
      prism.services.provide("compaction.system", { name: "llm-compaction" });
    },
  })();
const fold = () =>
  definePackage({
    name: "@acme/fold",
    version: "1.0.0",
    requires: { api: 1 },
    setup(prism) {
      const system = prism.services.consume<{ name?: string }>("compaction.system");
      if (system?.name === "session-memory") throw new TypeError("fold and attention cannot run beside session memory");
      prism.services.provide("context.fold", { name: "@acme/fold" });
    },
  })();

const compactions = (entries: readonly SessionEntry[]) => entries.filter((entry) => entry.kind === "compaction");

describe("session memory as the compaction system (plan 218.3 Task 2)", () => {
  it("session_memory_answers_every_compaction_vote", async () => {
    let consulted = 0;
    const { agent } = await harness({}, { spy: () => (consulted += 1) });
    const on = await agent.session({ id: "on", create: true });
    await agent.commands.run("memory:session", {}, { session: on });
    await on.run("one");
    await on.run("two");
    assert.equal(consulted, 0, "the kernel trigger is never consulted for a memory-on session");
    const off = await agent.session({ id: "off", create: true });
    await off.run("one");
    assert.ok(consulted > 0, "a memory-off session falls through to the kernel trigger");
    await agent.dispose();
  });

  it("mid_loop_trigger_fires_at_the_window_share", async () => {
    // About 3 tokens of the 1M window: the first run's start (its one-token input) stays below it, its second turn (the
    // input, a tool call and its result: about 4) crosses it.
    // `keepRecentTokens: 1` keeps only the newest tool round, so the cut has the input to remove (plan 218.3 Task 3).
    const { agent } = await harness({ enabled: true, context: { compactAt: { ratio: 0.000_003 }, keepRecentTokens: 1 } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("one");
    const done = compactions(await session.entries());
    assert.equal(done.length, 1, "one mid-loop compaction inside the first run");
    assert.equal((done[0]!.data as { strategy?: string }).strategy, "session-memory");
    await agent.dispose();
  });

  it("between_loop_trigger_fires_only_without_a_turn", async () => {
    // A 3-token cap: the first run's start (its one-token input) stays below it; its second turn (about 4) crosses it but
    // is mid-loop, out of reach; the next run's start (about 6) crosses it between loops.
    const { agent } = await harness({ enabled: true, context: { compactAfterRun: { maxTokens: 3 } } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("one");
    assert.equal(compactions(await session.entries()).length, 0, "no compaction inside the loop, past the token cap");
    await session.run("two");
    assert.equal(compactions(await session.entries()).length, 1, "the next run starts with a between-loop compaction");
    await agent.dispose();
  });

  it("resumed_or_continued_run_start_uses_the_mid_loop_trigger", async () => {
    // The first run fails on its second turn, after a tool round (about 4 tokens, past the 3-token cap): the continued
    // run's start check is still inside that loop.
    const { agent } = await harness({ enabled: true, context: { compactAfterRun: { maxTokens: 3 } } }, { failOn: 2 });
    const session = await agent.session({ id: "s", create: true });
    assert.equal((await session.run("one")).status, "failed");
    const result = await session.continue();
    assert.equal(result.status, "completed");
    assert.equal(compactions(await session.entries()).length, 0, "a continued loop is not between loops");
    await session.run("two");
    assert.equal(compactions(await session.entries()).length, 1, "a new run after it is");
    await agent.dispose();
  });

  it("coverage_advance_alone_does_not_compact", async () => {
    const { agent } = await harness({ enabled: true });
    const session = await agent.session({ id: "s", create: true });
    await session.run("one");
    await session.compact();
    const before = compactions(await session.entries()).length;
    await agent.commands.run("memory:session:flush", {}, { session }).catch(() => undefined);
    await session.run("two");
    await session.run("three");
    assert.equal(compactions(await session.entries()).length, before, "below both triggers nothing compacts");
    await agent.dispose();
  });

  it("memory_off_session_uses_the_fallback_compactor", async () => {
    const { agent } = await harness({});
    const session = await agent.session({ id: "s", create: true });
    await session.run("one");
    await session.compact();
    const [entry] = compactions(await session.entries());
    assert.ok(entry);
    assert.notEqual((entry.data as { strategy?: string }).strategy, "session-memory", "the kernel default compacts");
    await agent.dispose();
  });

  it("other_compaction_is_refused_beside_session_memory", async () => {
    const refused = (pattern: RegExp) => (error: unknown) =>
      error instanceof Error && pattern.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`);
    // Memory loads first: the other package refuses. Memory loads last: memory refuses with its named error.
    await assert.rejects(createAgent({ model: MODEL, packages: [memorySystem({}), llmCompaction()] }), refused(/compaction system/));
    await assert.rejects(
      createAgent({ model: MODEL, packages: [llmCompaction(), memorySystem({})] }),
      refused(/memory_system_compaction_conflict: session memory is the compaction system/),
    );
    await assert.rejects(createAgent({ model: MODEL, packages: [memorySystem({}), fold()] }), refused(/session memory/));
    await assert.rejects(
      createAgent({ model: MODEL, packages: [fold(), memorySystem({})] }),
      refused(/memory_system_compaction_conflict: .*fold and attention/),
    );
  });

  it("compaction_off_leaves_the_slot_and_vote_to_another_system", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [memorySystem({ enabled: true, context: { compaction: false } }), llmCompaction(), fold()],
      slots: { store: createMemorySessionStore() },
    });
    assert.equal((await agent.inspect()).slots.compaction, "@acme/llm-compaction");
    await agent.dispose();
  });

  it("conflict_error_is_named", () => {
    assert.equal(new MemorySystemError("memory_system_compaction_conflict", "x").code, "memory_system_compaction_conflict");
  });
});
