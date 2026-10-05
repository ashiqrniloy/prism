import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type AgentEvent, askEveryTool, createAgent, createMemorySessionStore, createSecretRedactor, type Decision, type JsonObject, type LoopStrategy, providerDone, providerTextDelta, type RunResult, type Session, toolCallContent } from "../index.js";
import { createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;

/** A model that calls `write` once, then answers; the tool counts its executions and records its arguments. */
function gatedAgent(options: { readonly store?: ReturnType<typeof createMemorySessionStore>; readonly hooks?: boolean } = {}) {
  const executed: JsonObject[] = [];
  let turn = 0;
  const store = options.store ?? createMemorySessionStore();
  const build = async (gate: boolean) =>
    createAgent({
      id: "resume-agent",
      model: MODEL,
      slots: { store },
      ...(gate ? { hooks: askEveryTool() } : {}),
      validator: (_tool, args) => (typeof args.value === "string" ? undefined : "value must be a string"),
      packages: [providerPackage("test-provider", [{
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
      }])],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object", properties: { value: { type: "string" } } },
            execute: (args, context) => {
              executed.push(args);
              return { toolCallId: context.toolCallId, name: "write", value: "done" };
            },
          },
        ],
      },
    });
  return { build, store, executed };
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const allow = (result: RunResult): Decision[] =>
  (result.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const }));

async function suspendOnce(session: Session): Promise<RunResult> {
  const result = await session.run("go");
  assert.equal(result.status, "suspended");
  assert.equal(result.pending?.length, 1);
  return result;
}

describe("session.resume", () => {
  it("resume_in_new_process_over_same_store_completes_the_run", async () => {
    const { build, store, executed } = gatedAgent();
    const first = await suspendOnce(await (await build(true)).session({ id: "s", create: true }));
    assert.equal(executed.length, 0, "a suspended call has not run");
    // "New process": a new agent over the same store, a session opened by id, no state carried over.
    const reopened = await (await build(true)).session({ id: "s" });
    const events = await collect(reopened.resume(allow(first)));
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.equal(executed.length, 1);
    assert.ok((await reopened.messages()).some((message) => message.role === "assistant"));
    assert.ok((await store.list("s")).some((entry) => entry.kind === "suspended_run"));
  });

  it("resume_with_unknown_decision_id_fails_closed", async () => {
    const { build, executed } = gatedAgent();
    const session = await (await build(true)).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    const stranger: Decision = { approvalId: "approval-that-does-not-exist", outcome: "allow_once" };
    await assert.rejects(collect(session.resume([stranger])), /Unknown approval decision/);
    await assert.rejects(collect(session.resume([...allow(first), stranger])), /Unknown approval decision/);
    assert.equal(executed.length, 0, "a rejected batch runs nothing");
    // Still suspended: the right decision resumes it.
    await collect(session.resume(allow(first)));
    assert.equal(executed.length, 1);
  });

  it("resume_with_missing_or_duplicate_decision_fails_closed", async () => {
    const { build, executed } = gatedAgent();
    const session = await (await build(true)).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    await assert.rejects(collect(session.resume([])), /must not be empty/);
    const [one] = allow(first);
    await assert.rejects(collect(session.resume([one!, one!])), /Duplicate approval decision/);
    assert.equal(executed.length, 0);
  });

  it("resume_without_pending_suspension_fails_closed", async () => {
    const { build } = gatedAgent();
    const agent = await build(false);
    const session = await agent.session({ id: "s", create: true });
    await assert.rejects(collect(session.resume([{ approvalId: "a", outcome: "allow_once" }])), /no suspended run/);
    // A resolved suspension is not resumable twice.
    const gated = await (await gatedAgent().build(true)).session();
    const suspended = await suspendOnce(gated);
    await collect(gated.resume(allow(suspended)));
    await assert.rejects(collect(gated.resume(allow(suspended))), /no suspended run/);
  });

  it("resume_after_a_later_run_fails_closed", async () => {
    const { build } = gatedAgent();
    const session = await (await build(true)).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    // A new run on the branch abandons the suspension: its entry is no longer the tip.
    const provider = await session.run("something else").catch(() => undefined);
    void provider;
    await assert.rejects(collect(session.resume(allow(first))), /no suspended run/);
  });

  it("resume_rewrite_decision_is_revalidated", async () => {
    const { build, executed } = gatedAgent();
    const session = await (await build(true)).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    const approvalId = first.pending![0]!.approvalId;
    await assert.rejects(
      collect(session.resume([{ approvalId, outcome: "allow_once", modifiedArguments: { value: 42 } }])),
      /Modified arguments failed schema validation/,
    );
    assert.equal(executed.length, 0, "an invalid rewrite never executes");
    await collect(session.resume([{ approvalId, outcome: "allow_once", modifiedArguments: { value: "edited" } }]));
    assert.deepEqual(executed, [{ value: "edited" }]);
  });

  it("resume_after_hook_set_drift_fails_closed", async () => {
    const { build, store, executed } = gatedAgent();
    const first = await suspendOnce(await (await build(true)).session({ id: "s", create: true }));
    // Same store, but the resuming agent has no `tool.call` gate.
    const drifted = await (await build(false)).session({ id: "s" });
    await assert.rejects(collect(drifted.resume(allow(first))), /fingerprint mismatch/);
    assert.equal(executed.length, 0);
    assert.ok((await store.list("s")).at(-1)?.kind === "suspended_run", "a refused resume appends nothing");
  });

  it("resume_after_loop_revision_drift_fails_closed", async () => {
    const executed: string[] = [];
    let turn = 0;
    const make = (revision: string) => {
      const loop: LoopStrategy = {
        name: "gated",
        revision,
        snapshot: () => ({ n: 1 }),
        restore: () => undefined,
        async run(run) {
          const turnResult = await run.turn();
          if (turnResult.stopped) return;
          if (turnResult.toolCalls.length > 0) await run.executeTools(turnResult.toolCalls);
          await run.turn();
          await run.end();
        },
      };
      return loop;
    };
    const store = createMemorySessionStore();
    const build = (revision: string) =>
      createAgent({
        id: "loop-agent",
        model: MODEL,
        slots: { store, loop: make(revision) },
        hooks: askEveryTool(),
        packages: [providerPackage("test-provider", [{
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
        }])],
        tools: {
          add: [
            {
              name: "write",
              parameters: {},
              execute: (_a, c) => (executed.push("write"), { toolCallId: c.toolCallId, name: "write", value: "done" }),
            },
          ],
        },
      });
    const first = await suspendOnce(await (await build("1")).session({ id: "s", create: true }));
    const changed = await (await build("2")).session({ id: "s" });
    await assert.rejects(collect(changed.resume(allow(first))), /fingerprint mismatch|revision/);
    assert.deepEqual(executed, []);
  });

  it("decision_resolved_fires_per_decision_on_resume", async () => {
    const { build } = gatedAgent();
    const session = await (await build(true)).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    const events = await collect(session.resume(allow(first)));
    const types = events.map((event) => event.type);
    const resolved = events.filter((event) => event.type === "decision.resolved");
    assert.equal(resolved.length, 1);
    const decisions = resolved[0]?.type === "decision.resolved" ? resolved[0].decisions : [];
    assert.deepEqual(decisions, [{ toolCallId: "call-1", outcome: "allow" }]);
    assert.equal(resolved[0]?.type === "decision.resolved" ? resolved[0].via : undefined, "resume");
    const started = events.find((event) => event.type === "run.started");
    assert.equal(started?.type === "run.started" ? started.resumed : undefined, true);
    assert.ok(types.indexOf("decision.resolved") < types.indexOf("run.started"), "decisions are announced before the run re-opens");
  });

  it("a_rejected_decision_resumes_without_running_the_call", async () => {
    const { build, executed } = gatedAgent();
    const session = await (await build(true)).session({ id: "s", create: true });
    const first = await suspendOnce(session);
    const events = await collect(session.resume([{ approvalId: first.pending![0]!.approvalId, outcome: "reject_once", reason: "no" }]));
    assert.equal(executed.length, 0);
    const resolved = events.find((event) => event.type === "decision.resolved");
    assert.deepEqual(resolved?.type === "decision.resolved" ? resolved.decisions : undefined, [{ toolCallId: "call-1", outcome: "deny" }]);
    assert.equal(events.at(-1)?.type, "run.completed");
  });

  it("pending_and_events_carry_redacted_arguments_only", async () => {
    const secret = "sk-resume-secret-value-123456";
    const store = createMemorySessionStore();
    let turn = 0;
    const agent = await createAgent({
      model: MODEL,
      slots: { store },
      hooks: askEveryTool(),
      redactor: createSecretRedactor([secret]),
      packages: [providerPackage("test-provider", [{
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: secret }) };
            yield providerDone();
            return;
          }
          yield providerDone();
        },
      }])],
      tools: { add: [{ name: "write", parameters: {}, execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "write", value: "done" }) }] },
    });
    const session = await agent.session({ id: "s", create: true });
    const probe = await session.run("go");
    const first = probe;
    assert.equal(first.status, "suspended");
    for (const key of ["pending", "messages", "runState"] as const) {
      assert.equal(JSON.stringify(first[key]).includes(secret), false, `${key} never carries the raw arguments`);
    }
    const events = await collect(session.resume(allow(first)));
    assert.equal(JSON.stringify(events).includes(secret), false);
    assert.equal(JSON.stringify(await store.list("s")).includes(secret), false);
  });
});

describe("RunResult", () => {
  it("run_result_status_map_covers_every_terminal_path", async () => {
    const session = async (provider: ReturnType<typeof createMockProvider>, config: Record<string, unknown> = {}) =>
      (await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider])], ...config })).session();

    const completed = await (await session(createMockProvider([providerTextDelta("hi"), providerDone()]))).run("go");
    assert.equal(completed.status, "completed");
    assert.equal(completed.stopReason, undefined);
    assert.deepEqual(
      completed.messages.map((message) => message.role),
      ["user", "assistant"],
      "messages are the ones this run appended",
    );

    const stopped = await (
      await session(createMockProvider([providerTextDelta("hi"), providerDone()]), {
        hooks: (hooks: { on: (name: string, handler: () => unknown) => void }) => hooks.on("turn.before", () => ({ stop: "enough" })),
      })
    ).run("go");
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.stopReason, "hook_stop");
    assert.equal(stopped.stopDetail, "enough");

    const { build } = gatedAgent();
    const suspended = await suspendOnce(await (await build(true)).session());
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.pending?.[0]?.toolCallId, "call-1");

    const failed = await (
      await session({
        id: "mock",
        async *generate() {
          yield { type: "error", error: { name: "ProviderError", message: "boom" } };
        },
      } as never)
    ).run("go");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error?.message, "boom");
    assert.equal(failed.pending, undefined);

    const controller = new AbortController();
    controller.abort(new Error("stop now"));
    const aborted = await (await session(createMockProvider([providerTextDelta("hi"), providerDone()]))).run("go", {
      signal: controller.signal,
    });
    assert.equal(aborted.status, "aborted");
    assert.match(String(aborted.abortReason), /stop now/);
  });
});
