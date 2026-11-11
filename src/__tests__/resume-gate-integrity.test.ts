import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type Decision,
  type HookRegistrar,
  type JsonObject,
  providerDone,
  providerTextDelta,
  type RunResult,
  type Session,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const allow = (result: RunResult): Decision[] =>
  (result.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const }));

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** A model that calls `write` once, then answers; the tool records its arguments and counts executions. */
function gatedAgent(options: { readonly gate?: (hooks: HookRegistrar) => void } = {}) {
  const executed: JsonObject[] = [];
  const hooks: string[] = [];
  let turn = 0;
  const store = createMemorySessionStore();
  const build = async () =>
    createAgent({
      id: "resume-gate-agent",
      model: MODEL,
      slots: { store },
      hooks: (registrar) => {
        askEveryTool()(registrar);
        registrar.on("tool.call", (payload) => {
          hooks.push(`tool.call:${JSON.stringify(payload.args)}`);
          return undefined;
        });
        registrar.on("tool.execute", async (payload, next) => {
          hooks.push(`tool.execute:${payload.callId}`);
          return next(payload);
        });
        registrar.on("tool.result", (result) => {
          hooks.push(`tool.result:${result.toolCallId}`);
          return result;
        });
        options.gate?.(registrar);
      },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) {
                yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { path: "ok" }) };
                yield providerDone();
                return;
              }
              yield providerTextDelta("finished");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object", properties: { path: { type: "string" } } },
            execute: (args, context) => {
              executed.push(args);
              return { toolCallId: context.toolCallId, name: "write", value: "done" };
            },
          },
        ],
      },
    });
  return { build, store, executed, hooks };
}

async function suspendOnce(session: Session): Promise<RunResult> {
  const result = await session.run("go");
  assert.equal(result.status, "suspended");
  assert.equal(result.pending?.length, 1);
  return result;
}

describe("resume goes through the full tool pipeline (plan 177 Task 3)", () => {
  it("resume_modified_arguments_are_gated", async () => {
    const { build, executed } = gatedAgent({
      gate: (hooks) => {
        hooks.on("tool.call", (payload) => (String(payload.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      },
    });
    const session = await (await build()).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    const events = await collect(
      session.resume([{ approvalId: first.pending![0]!.approvalId, outcome: "allow_once", modifiedArguments: { path: "/etc/shadow" } }]),
    );
    assert.deepEqual(executed, [], "a denied resumed call never executes");
    const denied = (await session.messages())
      .flatMap((message) => message.content)
      .find((block) => block.type === "tool_result" && block.error?.code === "hook_denied");
    assert.ok(denied, "the denied call is recorded as blocked in the transcript");
    assert.equal(events.at(-1)?.type, "run.completed");
  });

  it("gate_denied_call_settles_as_blocked_tool_completed", async () => {
    // Plan 215 Task 32: a `tool.call` deny reached the transcript with no `tool.completed` event.
    const outsideDeny = (hooks: HookRegistrar) => {
      hooks.on("tool.call", (payload) => (String(payload.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
    };
    const resumed = gatedAgent({ gate: outsideDeny });
    const session = await (await resumed.build()).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    const events = await collect(
      session.resume([{ approvalId: first.pending![0]!.approvalId, outcome: "allow_once", modifiedArguments: { path: "/etc/shadow" } }]),
    );
    const blocked = events.filter((event) => event.type === "tool.completed");
    assert.equal(blocked.length, 1, "the resumed denied call settles exactly once");
    assert.ok(blocked[0]?.type === "tool.completed" && blocked[0].status === "blocked" && blocked[0].reason === "outside root");
    assert.equal(blocked[0]?.type === "tool.completed" ? blocked[0].toolCallId : undefined, "call-1");

    // A fresh run's deny settles the same way.
    const fresh = await createAgent({
      model: MODEL,
      hooks: (registrar) => registrar.on("tool.call", () => ({ deny: "never" })),
      packages: [
        providerPackage("fresh-provider", [
          {
            id: "mock",
            async *generate(request) {
              if (request.messages.some((message) => message.role === "tool")) {
                yield providerTextDelta("ok");
              } else {
                yield { type: "tool_call" as const, call: toolCallContent("call-2", "write", { path: "x" }) };
              }
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object" },
            execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: "ran" }),
          },
        ],
      },
    });
    const freshEvents = await collect((await fresh.session()).stream("go"));
    const settled = freshEvents.filter((event) => event.type === "tool.completed");
    assert.equal(settled.length, 1);
    assert.ok(settled[0]?.type === "tool.completed" && settled[0].status === "blocked" && settled[0].error?.code === "hook_denied");
    await fresh.dispose();
  });

  it("resume_fires_execute_and_result_hooks", async () => {
    const { build, executed, hooks } = gatedAgent();
    const session = await (await build()).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    await collect(session.resume(allow(first)));
    assert.deepEqual(executed, [{ path: "ok" }]);
    assert.ok(hooks.includes("tool.execute:call-1"), "tool.execute fired for the resumed call");
    assert.ok(hooks.includes("tool.result:call-1"), "tool.result fired for the resumed call");
  });

  it("resume_matching_approval_satisfies_ask", async () => {
    const { build, executed, hooks } = gatedAgent();
    const session = await (await build()).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    hooks.length = 0;
    const events = await collect(session.resume(allow(first)));
    assert.deepEqual(executed, [{ path: "ok" }], "the approved call runs exactly once");
    assert.equal(
      events.some((event) => event.type === "run.suspended"),
      false,
      "the resumed approval does not suspend again",
    );
    assert.equal(hooks.filter((entry) => entry.startsWith("tool.call:")).length, 1, "tool.call fired once for the resumed call");
  });

  it("resume_rewrite_after_approval_resuspends", async () => {
    let rewriteNext = false;
    const { build, executed } = gatedAgent({
      gate: (hooks) => {
        hooks.on("tool.call", () => (rewriteNext ? { rewrite: { path: "/tmp/moved" } } : undefined));
      },
    });
    const session = await (await build()).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    rewriteNext = true;
    const events = await collect(session.resume(allow(first)));
    assert.deepEqual(executed, [], "a rewritten call the approval does not cover never executes");
    assert.ok(
      events.some((event) => event.type === "run.suspended"),
      "the run suspends again",
    );
    assert.ok(
      events.some((event) => event.type === "decision.pending"),
      "the rewritten call is staged as a new pending decision",
    );
  });

  it("resume_across_process_is_gated", async () => {
    const { build, store, executed } = gatedAgent({
      gate: (hooks) => {
        hooks.on("tool.call", (payload) => (String(payload.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      },
    });
    const first = await suspendOnce(await (await build()).session({ id: "s", create: true }));
    // "New process": a new agent over the same store, a session opened by id, no state carried over.
    const reopened = await (await build()).session({ id: "s" });
    await collect(
      reopened.resume([{ approvalId: first.pending![0]!.approvalId, outcome: "allow_once", modifiedArguments: { path: "/etc/shadow" } }]),
    );
    assert.deepEqual(executed, []);
    assert.ok(
      (await store.list("s")).some((entry) => entry.kind === "suspended_run"),
      "a denied resume leaves the suspension consumed",
    );
  });

  it("no_direct_dispatch_callers", () => {
    const round = readFileSync(new URL("../agent-session/session/tool-round.ts", import.meta.url), "utf8");
    assert.equal(/ctx\.dispatchToolCall\(/.test(round), false, "the resume path must not call ctx.dispatchToolCall directly");
    const controller = readFileSync(new URL("../loop/run-controller.ts", import.meta.url), "utf8");
    assert.equal(
      (controller.match(/internals\.dispatchToolCall\(/g) ?? []).length,
      1,
      "ctx.dispatchToolCall remains only as the tool.execute terminal",
    );
  });
});
