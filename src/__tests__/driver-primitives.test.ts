import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent, ExternalActivity, ExternalToolDecision, Message, RunController, ToolCallDecision } from "../index.js";
import { createScriptedHostUi, loopConformance } from "../testing/index.js";

/** A driver-shaped loop: it never calls `turn()`, so every effect goes through the driver primitives. */
function driverLoop(body: (run: RunController) => Promise<void>, durable = false) {
  return {
    name: "driver",
    revision: "1",
    run: body,
    ...(durable ? { snapshot: () => null, restore: () => {} } : {}),
  };
}

const request = (name = "write_file") => ({ toolCallId: "t1", name, args: { path: "a.ts" }, effects: ["write" as const] });
const of = (events: readonly AgentEvent[], type: string) => events.filter((event) => event.type === type);

describe("driver primitives", () => {
  it("observe_never_fires_tool_call", async () => {
    let probes = 0;
    const { events } = await loopConformance({
      probe: false,
      loop: driverLoop(async (run) => {
        await run.observe({ kind: "tool.started", call: { id: "t1", name: "write_file", args: { path: "a.ts" } } });
        await run.observe({ kind: "tool.progress", toolCallId: "t1", progress: "half" });
        await run.observe({ kind: "tool.completed", toolCallId: "t1", status: "finished", result: "ok" });
      }),
      hooks: (hooks) => {
        hooks.on("tool.call", () => {
          probes += 1;
          return undefined;
        });
      },
    });
    assert.equal(probes, 0);
    for (const type of ["tool.started", "tool.progress", "tool.completed"]) {
      const [event] = of(events, type);
      assert.equal(event?.origin?.executedBy, "external", type);
    }
    assert.equal((of(events, "tool.completed")[0] as { status: string }).status, "finished");
  });

  it("thinking_deltas_persist_as_thinking_content", async () => {
    const { events, session } = await loopConformance({
      loop: driverLoop(async (run) => {
        await run.observe({ kind: "message.delta", content: { type: "thinking", text: "hm" } });
        await run.observe({
          kind: "message",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", text: "hm" },
              { type: "text", text: "done" },
            ],
          },
        });
      }),
    });
    assert.equal(of(events, "message.delta").length, 1);
    const assistant = (await session!.messages()).find((message) => message.role === "assistant");
    assert.deepEqual(
      assistant?.content.map((block) => block.type),
      ["thinking", "text"],
    );
    assert.equal((assistant?.metadata?.origin as { executedBy?: string } | undefined)?.executedBy, "external");
  });

  it("observe_every_activity_kind", async () => {
    const activities: ExternalActivity[] = [
      { kind: "message.delta", content: { type: "text", text: "a" } },
      { kind: "message", message: { role: "assistant", content: [{ type: "text", text: "a" }] } },
      { kind: "tool.started", call: { id: "t1", name: "x" } },
      { kind: "tool.progress", toolCallId: "t1", progress: 1 },
      { kind: "tool.completed", toolCallId: "t1", status: "error", error: "boom" },
      { kind: "skill", name: "s", source: "native", resolved: true },
      { kind: "file", path: "a", change: "created", source: "agent" },
      { kind: "plan", entries: [{ title: "x", status: "done" }] },
      { kind: "subagent", phase: "started", id: "sa", name: "n", parentToolCallId: "t0" },
      { kind: "file", path: "b", change: "modified", source: "diff" },
      { kind: "subagent", phase: "completed", id: "sa", result: "r" },
      { kind: "file", path: "c", change: "deleted", source: "diff" },
      { kind: "compaction", phase: "started" },
      { kind: "notice", level: "warn", code: "rate", message: "slow" },
      { kind: "usage", usage: { inputTokens: 3, outputTokens: 4 } },
      { kind: "raw", vendor: "v", type: "t", data: { a: 1 } },
    ];
    const { events, result } = await loopConformance({
      loop: driverLoop(async (run) => {
        for (const activity of activities) await run.observe(activity);
      }),
    });
    const packages = events.filter((event): event is Extract<AgentEvent, { type: "package.event" }> => event.type === "package.event");
    const names = packages.map((event) => event.name).filter((name) => name.startsWith("agent."));
    assert.deepEqual(names, [
      "agent.skill",
      "agent.file",
      "agent.plan",
      "agent.subagent",
      "agent.file",
      "agent.subagent",
      "agent.file",
      "agent.compaction",
      "agent.notice",
      "agent.raw",
    ]);
    const owners = new Set(packages.filter((event) => event.name.startsWith("agent.")).map((event) => event.package));
    assert.equal(owners.size, 1, "agent.* events are owned by the loop slot owner");
    // Activity inside a subagent inherits the nested scope; activity outside does not.
    const files = packages.filter((event) => event.name === "agent.file");
    assert.equal(files[0]?.origin?.depth, 0);
    assert.equal(files[1]?.origin?.depth, 1);
    assert.equal(files[1]?.origin?.subagentId, "sa");
    assert.equal(files[1]?.origin?.parentToolCallId, "t0");
    assert.equal(files[2]?.origin?.depth, 0);
    assert.equal((of(events, "tool.completed")[0] as { status: string }).status, "error");
    assert.equal(result?.usage?.inputTokens, 3);
    assert.equal(result?.usage?.outputTokens, 4);
  });

  it("observed_tool_calls_count_against_limits", async () => {
    const { result, error } = await loopConformance({
      limits: { maxToolCalls: 1 },
      loop: driverLoop(async (run) => {
        await run.observe({ kind: "tool.started", call: { id: "t1", name: "x" } });
        await run.observe({ kind: "tool.started", call: { id: "t2", name: "x" } });
      }),
    });
    assert.notEqual(result?.status, "completed");
    assert.ok(error, "expected the second observed call to exceed maxToolCalls");
  });

  it("non_resumable_ask_without_ui_denies", async () => {
    let decision: ExternalToolDecision | undefined;
    await loopConformance({
      loop: driverLoop(async (run) => {
        decision = await run.ask(request());
      }),
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ ask: "needs approval" }) satisfies ToolCallDecision);
      },
    });
    assert.deepEqual(decision, { allow: false, reason: "non_interactive" });
  });

  it("ask_inline_confirm", async () => {
    const run = async (answer: boolean | { status: "dismissed" }) => {
      let decision: ExternalToolDecision | undefined;
      const scripted = createScriptedHostUi({ confirm: answer });
      await loopConformance({
        host: { ui: scripted.ui },
        loop: driverLoop(async (controller) => {
          decision = await controller.ask(request());
        }),
        hooks: (hooks) => {
          hooks.on("tool.call", () => ({ ask: "needs approval" }) satisfies ToolCallDecision);
        },
      });
      return decision;
    };
    assert.deepEqual(await run(true), { allow: true });
    assert.equal(((await run(false)) as { allow: boolean }).allow, false);
    assert.equal(((await run({ status: "dismissed" })) as { allow: boolean }).allow, false);
  });

  it("resumable_ask_stages_and_suspends_at_loop_end", async () => {
    let decision: ExternalToolDecision | undefined;
    const { result, events } = await loopConformance({
      loop: driverLoop(async (run) => {
        decision = await run.ask(request());
      }, true),
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ ask: "needs approval" }) satisfies ToolCallDecision);
      },
    });
    assert.deepEqual(decision, { allow: false, reason: "approval_pending" });
    assert.equal(of(events, "decision.pending").length, 1);
    assert.equal(result?.status, "suspended");
  });

  it("ask_rewrite_and_respond_flags", async () => {
    const decide = async (hookResult: ToolCallDecision, support: { rewrite?: boolean; respond?: boolean }) => {
      let decision: ExternalToolDecision | undefined;
      await loopConformance({
        loop: driverLoop(async (run) => {
          decision = await run.ask(request(), support);
        }),
        hooks: (hooks) => {
          hooks.on("tool.call", () => hookResult);
        },
      });
      return decision;
    };
    const rewrite: ToolCallDecision = { rewrite: { path: "b.ts" } };
    assert.deepEqual(await decide(rewrite, {}), { allow: false, reason: "rewrite_unsupported" });
    assert.deepEqual(await decide(rewrite, { rewrite: true }), { allow: true, args: { path: "b.ts" } });
    const respond: ToolCallDecision = { respond: { toolCallId: "t1", name: "write_file", value: "cached" } };
    assert.deepEqual(await decide(respond, {}), { allow: false, reason: "respond_unsupported" });
    assert.deepEqual(await decide(respond, { respond: true }), { respond: "cached" });
    assert.deepEqual(await decide({ deny: "no" }, {}), { allow: false, reason: "no" });
    assert.deepEqual(await decide("allow", {}), { allow: true });
  });

  it("driver_ask_regates_a_rewrite", async () => {
    let decision: ExternalToolDecision | undefined;
    await loopConformance({
      loop: driverLoop(async (run) => {
        decision = await run.ask(request(), { rewrite: true });
      }),
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ rewrite: { path: "b.ts" } }));
        hooks.on("tool.call", (call) => (String(call.args.path).endsWith(".ts") ? { deny: "no ts" } : undefined));
      },
    });
    assert.deepEqual(decision, { allow: false, reason: "no ts" });
  });

  it("ask_throwing_gate_denies", async () => {
    let decision: ExternalToolDecision | undefined;
    await loopConformance({
      probe: false,
      loop: driverLoop(async (run) => {
        decision = await run.ask(request());
      }),
      hooks: (hooks) => {
        hooks.on("tool.call", () => {
          throw new Error("gate down");
        });
      },
    });
    assert.equal((decision as { allow: boolean }).allow, false);
  });

  it("steers_yields_queued_input_without_turn", async () => {
    const seen: string[] = [];
    const { events } = await loopConformance({
      loop: driverLoop(async (run) => {
        const iterator = run.steers()[Symbol.asyncIterator]();
        const first = iterator.next();
        run.session.steer("keep this");
        run.session.steer("drop this");
        run.session.steer("and this");
        const a = (await first).value as Message;
        const b = (await iterator.next()).value as Message;
        seen.push(...[a, b].map((message) => (message.content[0] as { text: string }).text));
        await iterator.return?.();
      }),
      hooks: (hooks) => {
        hooks.on("run.input", (messages: readonly Message[]) =>
          messages.filter((message) => (message.content[0] as { text?: string }).text !== "drop this"),
        );
      },
    });
    assert.deepEqual(seen, ["keep this", "and this"]);
    assert.equal(of(events, "turn.started").length, 0);
  });

  it("end_returns_reason_from_callback", async () => {
    const results: unknown[] = [];
    await loopConformance({
      limits: { maxContinuations: 1 },
      loop: driverLoop(async (run) => {
        for (let i = 0; i < 2; i += 1) {
          results.push(await new Promise((resolve) => setTimeout(() => void run.end().then(resolve), 1)));
        }
      }),
      hooks: (hooks) => {
        hooks.on("run.end", () => ({ continue: { reason: "keep going" } }));
      },
    });
    assert.deepEqual(results, [{ continue: true, reason: "keep going" }, { continue: false }]);
  });
});
