import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  type ErrorInfo,
  type HostPort,
  type JsonObject,
  type LoopStrategy,
  type RunResult,
  type SessionEntry,
  type ToolDefinition,
  type HookRegistrar,
} from "../index.js";
import { createScriptedHostUi, twoTurnProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

/**
 * Plan 177 Task 2: the `tool.call` gate sees the arguments that execute. A rewrite is re-gated, an
 * `ask` keeps a sanitizing rewrite, a second rewrite is unstable, conflicting rewrites fail closed,
 * the payload is frozen, and `tool.execute` is wrap-only.
 */

function toolResultErrors(entries: readonly SessionEntry[]): ErrorInfo[] {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.message
      ? entry.message.content.flatMap((block) => (block.type === "tool_result" && block.error ? [block.error] : []))
      : [],
  );
}

/** A plan-then-act custom loop, to prove the gate is not the default loop's private behaviour. */
const planThenAct: LoopStrategy = {
  name: "plan-then-act",
  revision: "1",
  async run(run) {
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
};

async function runGate(options: {
  readonly args?: JsonObject;
  readonly hooks?: (hooks: HookRegistrar) => void;
  readonly host?: HostPort;
  readonly loop?: LoopStrategy;
}): Promise<{ readonly executed: readonly JsonObject[]; readonly errors: readonly ErrorInfo[]; readonly result: RunResult }> {
  const executed: JsonObject[] = [];
  const tool: ToolDefinition = {
    name: "echo",
    parameters: {},
    execute: (args, context) => {
      executed.push(args);
      return { toolCallId: context.toolCallId, name: "echo", value: "ok" };
    },
  };
  const provider = twoTurnProvider({ id: "call-1", name: "echo", args: options.args ?? {} });
  const agent = await createAgent({
    model: { provider: provider.id, model: "demo" },
    packages: [providerPackage("gate-integrity-provider", [provider])],
    tools: { add: [tool] },
    slots: { store: createMemorySessionStore(), ...(options.loop ? { loop: options.loop } : {}) },
    ...(options.host ? { host: options.host } : {}),
    hooks: options.hooks,
  });
  const session = await agent.session({ id: "gate-integrity", create: true });
  const result = await session.run("go");
  const errors = toolResultErrors(await session.entries());
  await session.close();
  return { executed, errors, result };
}

describe("tool gate integrity", () => {
  it("rewrite_is_regated_and_denied", async () => {
    const { executed, errors } = await runGate({
      args: { path: "/tmp/inside" },
      hooks: (hooks) => {
        hooks.on("tool.call", (call) => ({ rewrite: { path: String(call.args.path).replace("/tmp/inside", "/etc/shadow") } }));
        hooks.on("tool.call", (call) => (String(call.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      },
    });
    assert.equal(executed.length, 0, "the rewritten call must be re-gated before execution");
    assert.match(errors[0]?.message ?? "", /outside root/);
  });

  it("ask_keeps_sanitizing_rewrite", async () => {
    const scripted = createScriptedHostUi({ confirm: true });
    const { executed } = await runGate({
      args: { path: "/tmp/raw" },
      host: { ui: scripted.ui },
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ ask: "approve the sanitized call?" }));
        hooks.on("tool.call", (call) => ({ rewrite: { path: String(call.args.path).replace("/tmp/raw", "/tmp/sanitized") } }));
      },
    });
    assert.deepEqual(executed, [{ path: "/tmp/sanitized" }], "the sanitizing rewrite survives the ask");
  });

  it("conflicting_rewrites_deny", async () => {
    const { executed, errors } = await runGate({
      args: { path: "a" },
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ rewrite: { path: "b" } }));
        hooks.on("tool.call", () => ({ rewrite: { path: "c" } }));
      },
    });
    assert.equal(executed.length, 0);
    assert.match(errors[0]?.message ?? "", /rewrite_conflict/);
  });

  it("unstable_rewrite_denies", async () => {
    const { executed, errors } = await runGate({
      args: { path: "a" },
      hooks: (hooks) => {
        hooks.on("tool.call", (call) => ({ rewrite: { path: `${String(call.args.path)}!` } }));
      },
    });
    assert.equal(executed.length, 0, "a rewrite that never converges must fail closed");
    assert.match(errors[0]?.message ?? "", /rewrite_unstable/);
  });

  it("tool_call_payload_is_frozen", async () => {
    const { executed, errors } = await runGate({
      args: { path: "a" },
      hooks: (hooks) => {
        hooks.on("tool.call", (call) => {
          (call.args as { path?: string }).path = "b";
          return undefined;
        });
      },
    });
    assert.equal(executed.length, 0, "an in-place payload mutation must not reach execution");
    assert.match(errors[0]?.message ?? "", /tool\.call/);
  });

  it("tool_execute_cannot_swap_name_or_args", async () => {
    const { executed, errors } = await runGate({
      args: { path: "a" },
      hooks: (hooks) => {
        hooks.on("tool.execute", async (payload, next) => next({ ...payload, name: "other" }));
      },
    });
    assert.equal(executed.length, 0, "a swapped call must not execute");
    assert.match(errors[0]?.message ?? "", /may not replace/);
  });

  it("custom_loop_gets_same_gate", async () => {
    const { executed, errors } = await runGate({
      args: { path: "/tmp/inside" },
      loop: planThenAct,
      hooks: (hooks) => {
        hooks.on("tool.call", (call) => ({ rewrite: { path: String(call.args.path).replace("/tmp/inside", "/etc/shadow") } }));
        hooks.on("tool.call", (call) => (String(call.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      },
    });
    assert.equal(executed.length, 0);
    assert.match(errors[0]?.message ?? "", /outside root/);
  });

  it("single_round_without_rewrite", async () => {
    let dispatches = 0;
    const { executed } = await runGate({
      args: { path: "a" },
      hooks: (hooks) => {
        hooks.on("tool.call", () => {
          dispatches += 1;
          return undefined;
        });
      },
    });
    assert.equal(executed.length, 1);
    assert.equal(dispatches, 1, "a call with no rewrite dispatches tool.call once");
  });
});
