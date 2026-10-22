import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  AGENT_DISPOSED_CODE,
  type Agent,
  type AgentEvent,
  AgentDisposedError,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type LoopStrategy,
  type PackageDefinitionInput,
  type SessionStore,
  type ToolDefinition,
  type ToolResult,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { textProvider, twoTurnProvider } from "../testing/index.js";

/**
 * Plan 177 Task 5: `dispose()` fails closed. It aborts active runs, closes open sessions, then unwinds
 * packages; a run that is aborted ends with `code: "agent_disposed"`, and a loop that ignores its abort
 * signal gets denied tool results instead of execution.
 */

const MODEL = { provider: "mock", model: "demo" } as const;
type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"] = () => {}, extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra });

/** A tool that records every execution, so a dispose that fails to stop it is visible. */
function dangerTool(executed: string[]): ToolDefinition {
  return {
    name: "danger",
    parameters: { type: "object", properties: {} },
    execute: (_args, context) => {
      executed.push("danger");
      return { toolCallId: context.toolCallId, name: "danger", value: "ran" };
    },
  };
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Counts every store call, so "dispose of idle sessions reads nothing" is observable. */
function countingStore(inner: SessionStore = createMemorySessionStore()): { readonly store: SessionStore; readonly calls: string[] } {
  const calls: string[] = [];
  const store = new Proxy(inner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        calls.push(key);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { store, calls };
}

describe("fail-closed agent.dispose (plan 177 Task 5)", () => {
  it("dispose_mid_run_executes_no_denied_tool", async () => {
    const executed: string[] = [];
    let agent!: Agent;
    agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("test-provider", [twoTurnProvider({ id: "call-1", name: "danger" })])],
      tools: { add: [dangerTool(executed)] },
      hooks: (registrar) => {
        // The review repro: dispose while the run is mid-tool-round. The call must not execute.
        registrar.on("tool.call", async () => {
          await agent.dispose();
          return undefined;
        });
      },
    });
    const session = await agent.session();
    const result = await session.run("go");
    assert.deepEqual(executed, [], "no tool runs after dispose() starts");
    assert.equal(result.error?.code, "agent_disposed");
    assert.equal(result.status, "aborted");
  });

  it("session_after_dispose_throws", async () => {
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [textProvider()])] });
    await agent.dispose();
    await assert.rejects(
      agent.session(),
      (error: unknown) => error instanceof AgentDisposedError && error.code === AGENT_DISPOSED_CODE,
    );
  });

  it("commands_after_dispose_throw", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [
        pkg("@acme/cmd", ({ commands }) => commands.register({ name: "noop", description: "noop", run: () => "ok" })),
        providerPackage("test-provider", [textProvider()]),
      ],
    });
    await agent.dispose();
    await assert.rejects(agent.commands.run("noop"), AgentDisposedError);
  });

  it("dispose_is_idempotent_and_awaits", async () => {
    let disposals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const agent = await createAgent({
      model: MODEL,
      packages: [
        pkg("@acme/slow-dispose", ({ onDispose }) =>
          onDispose(async () => {
            disposals += 1;
            await gate;
          }),
        ),
        providerPackage("test-provider", [textProvider()]),
      ],
    });
    // Two concurrent calls share one unwind; a third after it resolves is a no-op.
    const first = agent.dispose();
    const second = agent.dispose();
    release();
    await Promise.all([first, second]);
    await agent.dispose();
    assert.equal(disposals, 1);
  });

  it("dispose_bounded_by_settle_timeout", async () => {
    const agent = await createAgent({
      model: MODEL,
      limits: { backgroundSettleMs: 20 },
      packages: [
        pkg(
          "@acme/hang",
          ({ commands }) =>
            commands.register({
              name: "start",
              description: "starts a task that ignores its abort signal",
              run: (_args, ctx) => {
                ctx.session!.background("hang", () => new Promise<void>(() => {}));
                return "started";
              },
            }),
          { capabilities: ["background"] },
        ),
        providerPackage("test-provider", [textProvider()]),
      ],
    });
    const collected = collect(agent.subscribe());
    const session = await agent.session();
    await agent.commands.run("start", {}, { session });
    await tick();
    const startedAt = performance.now();
    await agent.dispose();
    const elapsed = performance.now() - startedAt;
    assert.ok(elapsed < 2000, `dispose() took ${elapsed}ms; the settle bound must cap it`);
    const events = await collected;
    assert.ok(events.some((event) => event.type === "background.failed" && event.reason === "aborted"));
  });

  it("dispose_of_idle_sessions_reads_nothing", async () => {
    const { store, calls } = countingStore();
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [textProvider()])], slots: { store } });
    await Promise.all([0, 1, 2, 3, 4].map(() => agent.session()));
    calls.length = 0;
    await agent.dispose();
    assert.equal(calls.filter((name) => name === "list" || name === "readBranchPath" || name === "get").length, 0);
  });

  it("custom_loop_ignoring_abort_is_denied", async () => {
    const executed: string[] = [];
    const results: ToolResult[] = [];
    let agent!: Agent;
    const ignoringAbort: LoopStrategy = {
      name: "ignoring-abort",
      revision: "1",
      async run(run) {
        const turn = await run.turn();
        results.push(...(await run.executeTools(turn.toolCalls)));
        // The run is aborted now; a loop that ignores the signal must still get denials, not execution.
        results.push(...(await run.executeTools(turn.toolCalls)));
      },
    };
    agent = await createAgent({
      model: MODEL,
      slots: { loop: ignoringAbort },
      packages: [providerPackage("test-provider", [twoTurnProvider({ id: "call-1", name: "danger" })])],
      tools: { add: [dangerTool(executed)] },
      hooks: (registrar) => {
        registrar.on("tool.call", async () => {
          await agent.dispose();
          return undefined;
        });
      },
    });
    const session = await agent.session();
    await session.run("go");
    assert.deepEqual(executed, [], "no tool runs after dispose() starts");
    assert.ok(results.length >= 2, "both ignored rounds return a result");
    assert.ok(results.every((result) => result.error?.code === "agent_disposed"), JSON.stringify(results));
  });
});
