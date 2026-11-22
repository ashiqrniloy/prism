/**
 * Plan 232 Task 3: a child run that suspends inside a tool call suspends the parent run with the
 * child's decisions (attributed to the call), and `session.resume` on the parent routes them back
 * through the tool's `resumeNested`.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type Agent,
  AgentDecisionError,
  AgentDelegationSuspendedError,
  type AgentEvent,
  type AgentRunInterruption,
  createAgent,
  createMemorySessionStore,
  type Decision,
  type HookRegistrar,
  type LoopStrategy,
  MAX_NESTED_STICKY_RESUMES,
  type ModelProvider,
  type NestedRunOutcome,
  type PendingDecision,
  type RunResult,
  type Session,
  type ToolDefinition,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { providerDone, providerTextDelta, toolCallContent } from "../testing/index.js";

type AgentInterruptionLike = AgentRunInterruption;

let counter = 0;

function pendingOf(approvalId: string, extra: Partial<PendingDecision> = {}): PendingDecision {
  return {
    approvalId,
    kind: "tool_approval",
    toolCallId: "child-call",
    scope: { toolName: "write", argumentsHash: "hash-1" },
    reason: "child write needs approval",
    ...extra,
  };
}

interface ResumeCall {
  readonly sessionId: string | undefined;
  readonly toolCallId: string;
  readonly path: readonly string[];
  readonly decisions: readonly Decision[];
  readonly contextSessionId: string;
}

/** A tool whose "child" suspends on `execute` and follows `script` on each `resumeNested`. */
function stubDelegate(
  options: {
    readonly script?: NestedRunOutcome[];
    readonly pending?: (callId: string) => readonly PendingDecision[];
    readonly resumable?: boolean;
  } = {},
) {
  const executed: string[] = [];
  const resumes: ResumeCall[] = [];
  const script = [...(options.script ?? [])];
  const tool: ToolDefinition = {
    name: "delegate",
    effects: ["read"],
    async execute(_args, context) {
      executed.push(context.toolCallId);
      throw new AgentDelegationSuspendedError(
        { runId: `child-run-${context.toolCallId}`, sessionId: `child-${context.toolCallId}` },
        options.pending?.(context.toolCallId) ?? [pendingOf(`c-${context.toolCallId}`)],
      );
    },
    ...(options.resumable === false
      ? {}
      : {
          async resumeNested(nested, decisions, context) {
            resumes.push({
              sessionId: nested.ref.sessionId,
              toolCallId: nested.toolCallId,
              path: nested.path,
              decisions,
              contextSessionId: context.sessionId,
            });
            return script.shift() ?? { status: "completed", value: `child of ${nested.toolCallId} done` };
          },
        }),
  };
  return { tool, executed, resumes };
}

/** Turn 1 emits `calls`; every later turn answers with text. */
function parentProvider(calls: readonly string[]): ModelProvider {
  counter += 1;
  let turn = 0;
  return {
    id: `nested-${counter}`,
    async *generate() {
      turn += 1;
      if (turn === 1) {
        for (const id of calls) yield { type: "tool_call" as const, call: toolCallContent(id, "delegate", { task: id }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("parent done");
      yield providerDone();
    },
  };
}

async function harness(
  tool: ToolDefinition,
  options: { readonly calls?: readonly string[]; readonly extraTools?: readonly ToolDefinition[]; readonly config?: object } = {},
) {
  const provider = parentProvider(options.calls ?? ["call-1"]);
  const agent = await createAgent({
    model: { provider: provider.id, model: "demo" },
    packages: [providerPackage(`nested-package-${counter}`, [provider])],
    tools: { add: [tool, ...(options.extraTools ?? [])] },
    slots: { store: createMemorySessionStore() },
    ...(options.config ?? {}),
  });
  const session = await agent.session({ id: `parent-${counter}`, create: true });
  return { agent, session };
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const decide = (pending: readonly PendingDecision[] | undefined, outcome: Decision["outcome"] = "allow_once"): Decision[] =>
  (pending ?? []).map((entry) => ({ approvalId: entry.approvalId, outcome }));

function toolResults(messages: readonly { readonly content: readonly unknown[] }[]) {
  return messages.flatMap((message) =>
    (message.content as { type: string; toolCallId?: string; result?: unknown; error?: { code?: string } }[]).filter(
      (block) => block.type === "tool_result",
    ),
  );
}

function suspendedPending(events: readonly AgentEvent[]): readonly PendingDecision[] | undefined {
  const suspended = events.find((event) => event.type === "run.suspended") as { readonly interruption: AgentInterruptionLike } | undefined;
  return suspended?.interruption.pendingDecisions;
}

describe("nested suspension (plan 232 Task 3)", () => {
  it("nested_ask_suspends_the_parent_with_attributed_decisions", async () => {
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool);
    const result = await session.run("go");
    assert.equal(result.status, "suspended");
    assert.equal(result.pending?.length, 1);
    const [pending] = result.pending!;
    assert.match(pending!.approvalId, /^sub_[0-9a-f]{64}$/);
    assert.deepEqual(pending!.attribution?.path, ["call-1", "child-call-1"]);
    assert.equal(pending!.scope.toolName, "write");
    // The hosting call has no result yet: the resume writes it.
    assert.equal(toolResults(await session.messages()).length, 0);
    await agent.dispose();
  });

  it("parent_resume_routes_decisions_to_the_child_and_settles_the_call", async () => {
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool);
    const result = await session.run("go");
    const events = await collect(session.resume(decide(result.pending)));
    assert.equal(stub.resumes.length, 1);
    assert.deepEqual(stub.resumes[0]!.decisions, [{ approvalId: "c-call-1", outcome: "allow_once" }]);
    assert.equal(stub.resumes[0]!.sessionId, "child-call-1");
    assert.equal(stub.resumes[0]!.toolCallId, "call-1");
    assert.deepEqual(stub.resumes[0]!.path, ["call-1", "child-call-1"]);
    assert.equal(stub.resumes[0]!.contextSessionId, session.id);
    assert.ok(events.some((event) => event.type === "run.completed"));
    const completed = events.find((event) => event.type === "tool.completed") as { status?: string; toolCallId?: string } | undefined;
    assert.equal(completed?.toolCallId, "call-1");
    assert.equal(completed?.status, "finished");
    const results = toolResults(await session.messages());
    assert.deepEqual(
      results.map((block) => [block.toolCallId, block.result]),
      [["call-1", "child of call-1 done"]],
    );
    await agent.dispose();
  });

  it("settled_nested_call_is_not_re_executed_on_resume", async () => {
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool);
    const result = await session.run("go");
    await collect(session.resume(decide(result.pending)));
    assert.deepEqual(stub.executed, ["call-1"]);
    assert.equal(toolResults(await session.messages()).filter((block) => block.toolCallId === "call-1").length, 1);
    await agent.dispose();
  });

  it("nested_resume_can_suspend_again", async () => {
    const stub = stubDelegate({ script: [{ status: "suspended", pendingDecisions: [pendingOf("c-2", { scope: { toolName: "edit" } })] }] });
    const { agent, session } = await harness(stub.tool);
    const first = await session.run("go");
    const events = await collect(session.resume(decide(first.pending)));
    const again = suspendedPending(events);
    assert.equal(again?.length, 1);
    assert.deepEqual(again![0]!.attribution?.path, ["call-1", "child-call-1"]);
    assert.notEqual(again![0]!.approvalId, first.pending![0]!.approvalId);
    assert.equal(toolResults(await session.messages()).length, 0);
    const done = await collect(session.resume(decide(again, "reject_once")));
    assert.ok(done.some((event) => event.type === "run.completed"));
    assert.deepEqual(stub.resumes[1]!.decisions, [{ approvalId: "c-2", outcome: "reject_once" }]);
    assert.deepEqual(stub.executed, ["call-1"]);
    await agent.dispose();
  });

  it("sticky_allow_for_run_covers_later_nested_asks", async () => {
    // The child asks again with the same scope after the first decision: the run's sticky answers it.
    const stub = stubDelegate({ script: [{ status: "suspended", pendingDecisions: [pendingOf("c-again")] }] });
    const { agent, session } = await harness(stub.tool);
    const first = await session.run("go");
    const events = await collect(session.resume(decide(first.pending, "allow_for_run")));
    assert.equal(suspendedPending(events), undefined);
    assert.ok(events.some((event) => event.type === "run.completed"));
    assert.equal(stub.resumes.length, 2);
    assert.deepEqual(stub.resumes[1]!.decisions, [{ approvalId: "c-again", outcome: "allow_for_run" }]);
    await agent.dispose();
  });

  it("sticky_resumes_are_bounded", async () => {
    const again = (index: number): NestedRunOutcome => ({ status: "suspended", pendingDecisions: [pendingOf(`c-loop-${index}`)] });
    const stub = stubDelegate({ script: Array.from({ length: MAX_NESTED_STICKY_RESUMES + 2 }, (_, index) => again(index)) });
    const { agent, session } = await harness(stub.tool);
    const first = await session.run("go");
    const events = await collect(session.resume(decide(first.pending, "allow_for_run")));
    // One host-routed resume, then MAX sticky resumes, then the next ask reaches the host.
    assert.equal(stub.resumes.length, 1 + MAX_NESTED_STICKY_RESUMES);
    assert.equal(suspendedPending(events)?.length, 1);
    await agent.dispose();
  });

  it("tool_without_resume_nested_fails_closed", async () => {
    const stub = stubDelegate({ resumable: false });
    const { agent, session } = await harness(stub.tool);
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    const [block] = toolResults(await session.messages());
    assert.equal(block?.error?.code, "ERR_PRISM_DECISION_INVALID");
    await agent.dispose();
  });

  it("decision_for_unknown_child_fails_closed", async () => {
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool);
    const result = await session.run("go");
    // The child's own id is not routable from the parent; only the root-visible id is.
    for (const approvalId of ["c-call-1", "sub_0000"]) {
      await assert.rejects(
        collect(session.resume([{ approvalId, outcome: "allow_once" }])),
        (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_UNKNOWN",
      );
    }
    assert.equal(stub.resumes.length, 0);
    // The suspension is intact: the right id still resumes it.
    await collect(session.resume(decide(result.pending)));
    assert.equal(stub.resumes.length, 1);
    await agent.dispose();
  });

  it("attribution_depth_limit_holds_at_three_levels", async () => {
    // A grandchild two levels down already carries four path entries; this level adds two (six ≤ 8).
    const deep = stubDelegate({
      pending: () => [pendingOf("c-deep", { attribution: { path: ["child-call", "grandchild", "gc-call", "great-grandchild"] } })],
    });
    const ok = await harness(deep.tool);
    const suspended = await ok.session.run("go");
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.pending![0]!.attribution?.path.length, 6);
    await ok.agent.dispose();

    // A fourth level below (8 entries) plus this level is 10: over MAX_ATTRIBUTION_DEPTH.
    const tooDeep = stubDelegate({
      pending: () => [pendingOf("c-deep", { attribution: { path: ["a", "b", "c", "d", "e", "f", "g", "h"] } })],
    });
    const over = await harness(tooDeep.tool);
    const failed = await over.session.run("go");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error?.code, "ERR_PRISM_DECISION_LIMIT");
    await over.agent.dispose();
  });

  it("two_nested_suspensions_in_one_parallel_round_suspend_together", async () => {
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool, { calls: ["call-1", "call-2"] });
    const result = await session.run("go");
    assert.equal(result.status, "suspended");
    assert.deepEqual(stub.executed.sort(), ["call-1", "call-2"]);
    assert.deepEqual(result.pending!.map((pending) => pending.attribution?.path[0]).sort(), ["call-1", "call-2"]);
    const events = await collect(session.resume(decide(result.pending)));
    assert.ok(events.some((event) => event.type === "run.completed"));
    assert.deepEqual(stub.resumes.map((resume) => resume.toolCallId).sort(), ["call-1", "call-2"]);
    // Each child got only its own decision.
    for (const resume of stub.resumes) {
      assert.deepEqual(
        resume.decisions.map((decision) => decision.approvalId),
        [`c-${resume.toolCallId}`],
      );
    }
    assert.deepEqual(
      toolResults(await session.messages())
        .map((block) => block.toolCallId)
        .sort(),
      ["call-1", "call-2"],
    );
    await agent.dispose();
  });

  it("nested_modified_arguments_are_not_validated_against_the_parent_registry", async () => {
    // The parent has its own `write` and a validator that refuses everything: a direct decision would fail.
    const write: ToolDefinition = {
      name: "write",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: "parent write" }),
    };
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool, {
      extraTools: [write],
      config: { validator: (tool: ToolDefinition) => (tool.name === "write" ? "refused by parent" : undefined) },
    });
    const result = await session.run("go");
    const approvalId = result.pending![0]!.approvalId;
    const oversize = { blob: "x".repeat(70 * 1024) };
    await assert.rejects(
      collect(session.resume([{ approvalId, outcome: "allow_once", modifiedArguments: oversize }])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    await collect(session.resume([{ approvalId, outcome: "allow_once", modifiedArguments: { path: "child-only" } }]));
    assert.deepEqual(stub.resumes[0]!.decisions, [
      { approvalId: "c-call-1", outcome: "allow_once", modifiedArguments: { path: "child-only" } },
    ]);
    await agent.dispose();
  });

  it("nested_flow_runs_on_a_custom_loop", async () => {
    const customLoop: LoopStrategy = {
      name: "custom-nested",
      revision: "1",
      state: "run",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.stopped) return;
          if (turn.toolCalls.length > 0) {
            await run.executeTools(turn.toolCalls);
            continue;
          }
          const end = await run.end();
          if (!end.continue) return;
        }
      },
    };
    const stub = stubDelegate();
    const { agent, session } = await harness(stub.tool, { config: { slots: { store: createMemorySessionStore(), loop: customLoop } } });
    const result = await session.run("go");
    assert.equal(result.status, "suspended");
    assert.deepEqual(result.pending![0]!.attribution?.path, ["call-1", "child-call-1"]);
    const events = await collect(session.resume(decide(result.pending)));
    assert.ok(events.some((event) => event.type === "run.completed"));
    assert.equal(stub.resumes.length, 1);
    assert.deepEqual(stub.executed, ["call-1"]);
    await agent.dispose();
  });

  it("a_real_child_session_suspends_and_resumes_through_the_parent", async () => {
    // One agent: the parent's `delegate` opens a linked child session whose `write` asks for approval.
    counter += 1;
    const turns = new Map<string, number>();
    const provider: ModelProvider = {
      id: `nested-real-${counter}`,
      async *generate(request) {
        const sessionId = String(request.options?.sessionId);
        const turn = (turns.get(sessionId) ?? 0) + 1;
        turns.set(sessionId, turn);
        if (sessionId.startsWith("child") && turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("child-write", "write", { path: "a" }) };
        } else if (!sessionId.startsWith("child") && turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call-1", "delegate", {}) };
        } else {
          yield providerTextDelta(sessionId.startsWith("child") ? "child finished" : "parent finished");
        }
        yield providerDone();
      },
    };
    const writes: string[] = [];
    const children = new Map<string, Session>();
    let agent: Agent | undefined;
    const childOutcome = async (child: Session, settled: { status: string; pending?: readonly PendingDecision[] }) => {
      if (settled.status === "suspended") return { status: "suspended" as const, pendingDecisions: settled.pending ?? [] };
      const messages = await child.messages();
      const text = messages.at(-1)?.content.find((block) => block.type === "text") as { text?: string } | undefined;
      return { status: "completed" as const, value: text?.text ?? "" };
    };
    const delegate: ToolDefinition = {
      name: "delegate",
      async execute(_args, context) {
        const child = await agent!.session({ id: `child-${context.toolCallId}`, create: true, parent: { sessionId: context.sessionId } });
        children.set(child.id, child);
        const result: RunResult = await child.run("write a", { tools: { only: ["write"] }, interactive: false });
        if (result.status === "suspended")
          throw new AgentDelegationSuspendedError({ runId: result.runId, sessionId: child.id }, result.pending ?? []);
        return { toolCallId: context.toolCallId, name: "delegate", value: result.text };
      },
      async resumeNested(nested, decisions) {
        const child = children.get(nested.ref.sessionId!)!;
        const events = await collect(child.resume(decisions));
        return childOutcome(child, { status: suspendedPending(events) ? "suspended" : "completed", pending: suspendedPending(events) });
      },
    };
    const write: ToolDefinition = {
      name: "write",
      execute: (args, context) => {
        writes.push(String((args as { path?: string }).path));
        return { toolCallId: context.toolCallId, name: "write", value: "written" };
      },
    };
    agent = await createAgent({
      model: { provider: provider.id, model: "demo" },
      packages: [providerPackage(`nested-real-package-${counter}`, [provider])],
      tools: { add: [delegate, write] },
      hooks: (registrar: HookRegistrar) => {
        registrar.on("tool.call", (payload) => (payload.name === "write" ? { ask: "write needs approval" } : undefined));
      },
      slots: { store: createMemorySessionStore() },
    });
    const parent = await agent.session({ id: "parent-real", create: true });
    const result = await parent.run("delegate it", { interactive: false });
    assert.equal(result.status, "suspended");
    assert.equal(writes.length, 0);
    assert.deepEqual(result.pending![0]!.attribution?.path, ["call-1", "child-call-1"]);
    const events = await collect(parent.resume(decide(result.pending), { interactive: false }));
    assert.ok(events.some((event) => event.type === "run.completed"));
    assert.deepEqual(writes, ["a"]);
    const [block] = toolResults(await parent.messages());
    assert.equal(block?.result, "child finished");
    assert.ok((await agent.sessions.list({ parentSessionId: parent.id })).items.some((entry) => entry.sessionId === "child-call-1"));
    await agent.dispose();
  });
});
