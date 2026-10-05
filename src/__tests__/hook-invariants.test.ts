import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { askEveryTool, createAgent, createMemoryCheckpointStore, createMemorySessionStore, HookError, loadSuspendedRunEntry, providerDone, providerTextDelta, resumeAgentRun, type Decision, type RunController, type SessionEntry, toolCallContent } from "../index.js";
import { echoTool, loopConformance, textProvider , mockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

/**
 * Phase 1 invariant tests (plan 144 Task 6). These are the security proof for the hook bus: they
 * assert the fail-closed guarantees the roadmap promises, with a custom loop as the variable.
 */

/** A custom plan-then-act loop that routes every tool through `executeTools` and ends through `end`. */
const planThenAct = (onController?: (controller: RunController) => void) => ({
  name: "plan-then-act",
  revision: "1",
  async run(run: RunController) {
    onController?.(run);
    for (;;) {
      for (;;) {
        const turn = await run.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length === 0) {
          if (turn.steered) continue;
          break;
        }
        await run.executeTools(turn.toolCalls);
      }
      const end = await run.end();
      if (!end.continue) return;
    }
  },
});

/** The tool results recorded in the branch. */
function toolResults(entries: readonly SessionEntry[]) {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.message
      ? entry.message.content.filter((block): block is Extract<typeof block, { type: "tool_result" }> => block.type === "tool_result")
      : [],
  );
}

describe("hook invariants", () => {
  it("a_custom_loop_cannot_run_a_tool_without_tool_call_firing", async () => {
    let executed = 0;
    const order: string[] = [];
    let controllerKeys: string[] = [];
    const { fired, result } = await loopConformance({
      loop: planThenAct((controller) => {
        controllerKeys = Object.keys(controller).sort();
      }),
      tools: [echoTool(() => executed++)],
      hooks: (hooks) => {
        hooks.on("tool.call", () => {
          order.push("tool.call");
          return undefined;
        });
        hooks.on("tool.execute", async (payload, next) => {
          order.push("tool.execute");
          return next(payload);
        });
      },
    });
    assert.equal(result?.status, "completed");
    assert.equal(executed, 1);
    assert.ok(fired.has("tool.call"), "tool.call did not fire");
    assert.deepEqual(order, ["tool.call", "tool.execute"]);
    // The loop can reach a tool only through `executeTools`, and a model only through `turn`.
    assert.deepEqual(controllerKeys, ["append", "emit", "end", "executeTools", "input", "limits", "session", "signal", "turn"]);
  });

  it("deny_wins_over_allow_and_ask", async () => {
    let executed = 0;
    const { result, session } = await loopConformance({
      loop: planThenAct(),
      tools: [echoTool(() => executed++)],
      hooks: (hooks) => {
        hooks.on("tool.call", () => "allow");
        hooks.on("tool.call", () => ({ ask: "may I?" }));
        hooks.on("tool.call", () => ({ deny: "blocked by host" }));
      },
    });
    assert.equal(executed, 0);
    assert.equal(result?.status, "completed");
    const [denied] = toolResults(await session.entries());
    assert.equal(denied?.error?.code, "hook_denied");
    assert.match(denied?.error?.message ?? "", /blocked by host/);
  });

  it("deny_wins_even_when_it_is_registered_first", async () => {
    let executed = 0;
    const { result } = await loopConformance({
      loop: planThenAct(),
      tools: [echoTool(() => executed++)],
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ deny: "blocked by host" }));
        hooks.on("tool.call", () => "allow");
      },
    });
    assert.equal(executed, 0);
    assert.equal(result?.status, "completed");
  });

  it("the_first_run_end_continue_wins_and_is_capped", async () => {
    let endFires = 0;
    const { result, session } = await loopConformance({
      loop: planThenAct(),
      provider: textProvider("done"),
      hooks: (hooks) => {
        hooks.on("run.end", () => {
          endFires += 1;
          return { continue: { reason: "first" } };
        });
        hooks.on("run.end", () => ({ continue: { reason: "second" } }));
      },
    });
    assert.equal(result?.status, "stopped");
    assert.equal(result?.stopReason, "hook_limit");
    // Three continuations run, the fourth dispatch is capped with `hook_limit`.
    assert.equal(endFires, 4);
    // The queued continuation text is the first handler's value, not the second's.
    const continuations = (await session.entries())
      .flatMap((entry) =>
        entry.kind === "message" && entry.message?.role === "user"
          ? entry.message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
          : [],
      )
      .filter((text) => text === "first" || text === "second");
    assert.deepEqual(continuations, ["first", "first", "first"]);
  });

  it("an_observer_throw_never_fails_a_run", async () => {
    const { result, fired } = await loopConformance({
      loop: planThenAct(),
      hooks: (hooks) => {
        hooks.on("turn.started", () => {
          throw new Error("observer boom");
        });
      },
    });
    assert.equal(result?.status, "completed");
    assert.ok(fired.has("hook.error"), "hook.error did not fire");
  });

  it("a_transform_throw_fails_closed_and_names_the_owner_and_hook", async () => {
    const { error } = await loopConformance({
      loop: planThenAct(),
      hooks: (hooks) => {
        hooks.on("model.request", () => {
          throw new Error("transform boom");
        });
      },
    });
    assert.equal(error?.name, "HookError");
    assert.equal(error?.owner, "host");
    assert.equal(error?.hook, "model.request");
  });

  it("a_decide_throw_fails_closed_and_names_the_owner_and_hook", async () => {
    const { error } = await loopConformance({
      loop: planThenAct(),
      hooks: (hooks) => {
        hooks.on("turn.before", () => {
          throw new Error("decide boom");
        });
      },
    });
    assert.equal(error?.name, "HookError");
    assert.equal(error?.owner, "host");
    assert.equal(error?.hook, "turn.before");
  });

  it("a_suspended_run_survives_a_process_restart_through_the_store_slot", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const model = { provider: "mock", model: "demo" } as const;
    const tools = [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: "done" }) }];
    const first = await createAgent({
      id: "invariant-suspend",
      model,
      slots: { store },
      packages: [providerPackage("test-provider", [(() => {
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
      })()])],
      tools: { add: tools },
      hooks: askEveryTool(),
    });
    const suspended = await (await first.session({ id: "invariant-restart", create: true })).run("go", {
      runState: { checkpoints, definitionRevision: "1" },
    });
    assert.equal(suspended.status, "suspended");

    // A new process reads the suspended_run entry from the store alone.
    const entry = await loadSuspendedRunEntry(store, "invariant-restart");
    assert.ok(entry, "no suspended_run entry was written");

    const fresh = await createAgent({
      id: "invariant-suspend",
      model,
      slots: { store },
      packages: [mockProvider([[providerTextDelta("finished"), providerDone()]])],
      tools: { add: tools },
      hooks: askEveryTool(),
    });
    const decisions: Decision[] = (entry.state.interruption?.pendingDecisions ?? []).map((pending) => ({
      approvalId: pending.approvalId,
      outcome: "allow_once",
    }));
    const resumed = await resumeAgentRun(
      fresh,
      { runId: entry.runId, sessionId: "invariant-restart" },
      { expectedVersion: entry.state.version ?? 1, decisions },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "completed");
  });

  it("context_build_mutations_never_reach_the_store", async () => {
    const sentinel = "context-build-sentinel-do-not-persist";
    const { result, session } = await loopConformance({
      loop: planThenAct(),
      hooks: (hooks) => {
        hooks.on("context.build", (draft) => ({
          ...draft,
          messages: [
            { role: "system", content: [{ type: "text", text: sentinel }] },
            { role: "user", content: [{ type: "text", text: sentinel }] },
            ...draft.messages,
          ],
        }));
      },
    });
    assert.equal(result?.status, "completed");
    const entries = await session.entries();
    assert.equal(
      entries.some((entry) => JSON.stringify(entry).includes(sentinel)),
      false,
      "a context.build mutation reached the store",
    );
  });
});
