import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Agent,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  type JsonObject,
  type PermissionPolicy,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";
import { createSupervisor, type Supervisor, SupervisorDeniedError } from "../index.js";

const ownership = { tenantId: "tenant", userId: "user" };

interface Harness {
  supervisor: Supervisor;
  root: Agent;
  checkpoints: ReturnType<typeof createMemoryCheckpointStore>;
  executed: string[];
}

/**
 * Root agent with one `delegate` tool wired to supervisor.delegate. Child agents gate a
 * `write` tool behind durable approval (the supervisor sets interruptBeforeTool). Providers
 * are turn-counted per scope key so rebuilt agents resume deterministically.
 */
function harness(options?: {
  children?: Record<string, { permission?: PermissionPolicy }>;
  /** Root turn plan: a child id delegates to that child, "text" ends the run. */
  rootTurns?: string[];
}): Harness {
  const checkpoints = createMemoryCheckpointStore();
  const executed: string[] = [];
  const turns = new Map<string, number>();
  // Session stores persist across child-agent rebuilds (hosts use durable stores).
  const sessionStores = new Map<string, ReturnType<typeof createMemorySessionStore>>();
  const storeFor = (key: string) => {
    let store = sessionStores.get(key);
    if (!store) {
      store = createMemorySessionStore();
      sessionStores.set(key, store);
    }
    return store;
  };
  const childDefs = options?.children ?? { writer: {} };

  const childAgent = (childId: string, scopeKey: string): Agent =>
    createAgent({
      id: `child-${childId}`,
      model: { provider: "mock", model: "test" },
      store: storeFor(childId),
      provider: {
        id: "mock",
        async *generate() {
          const turn = (turns.get(scopeKey) ?? 0) + 1;
          turns.set(scopeKey, turn);
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent(`${scopeKey}-w1`, "write", { v: 1 }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta(`${childId} done`);
          yield providerDone();
        },
      },
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (args: JsonObject, context: { toolCallId: string }) => {
            executed.push(`${childId}:${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "write", value: "done" };
          },
        },
      ],
    });

  const supervisor = createSupervisor({
    id: "lead",
    ownership,
    checkpoints,
    definitionRevision: "1",
    children: Object.fromEntries(
      Object.entries(childDefs).map(([childId, def]) => [
        childId,
        {
          permission: def.permission,
          createAgent: (context: { resourceId: string }) => childAgent(childId, context.resourceId),
        },
      ]),
    ),
  });

  let rootTurn = 0;
  const rootPlan = options?.rootTurns ?? [Object.keys(childDefs)[0]!, "text"];
  const root = createAgent({
    id: "root",
    model: { provider: "mock", model: "test" },
    store: createMemorySessionStore(),
    provider: {
      id: "mock",
      async *generate() {
        rootTurn += 1;
        const step = rootPlan[rootTurn - 1] ?? "text";
        if (step !== "text") {
          yield { type: "tool_call" as const, call: toolCallContent(`root-d${rootTurn}`, "delegate", { childId: step }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("root done");
        yield providerDone();
      },
    },
    tools: [
      {
        name: "delegate",
        parameters: {},
        execute: async (args: JsonObject, context: { toolCallId: string }) => {
          const result = await supervisor.delegate({ childId: String(args.childId), input: "go" });
          return { toolCallId: context.toolCallId, name: "delegate", value: result.text };
        },
      },
    ],
  });
  return { supervisor, root, checkpoints, executed };
}

const ROOT_RUN_STATE = (h: Harness) => ({
  checkpoints: h.checkpoints,
  definitionRevision: "1",
  resumeNestedRun: h.supervisor.resumeNestedRun,
});

describe("nested-agent approval propagation", () => {
  it("surfaces child approvals on the root run with attribution and routes the root batch back", async () => {
    const h = harness();
    const first = await h.root.createSession({ id: "s1" }).run("go", { runState: ROOT_RUN_STATE(h) });

    assert.equal(first.status, "suspended");
    assert.equal(h.executed.length, 0);
    const pending = first.interruption?.pendingDecisions;
    assert.equal(pending?.length, 1);
    assert.match(pending?.[0]?.approvalId ?? "", /^sub_[a-f0-9]{64}$/);
    assert.deepEqual(pending?.[0]?.attribution?.path, ["writer"]);
    assert.equal(pending?.[0]?.scope.toolName, "write");

    const result = await resumeAgentRun(
      h.root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending![0]!.approvalId, outcome: "allow_once" }] },
      ROOT_RUN_STATE(h),
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "root done");
    assert.equal(h.executed.length, 1);
    assert.match(h.executed[0]!, /^writer:.*:\{"v":1\}$/);
  });

  it("re-suspends the root with the remainder when a batch decides a subset of child approvals", async () => {
    const h = harness();
    const checkpoints = h.checkpoints;
    // Child emits two gated calls in one round.
    const turns = new Map<string, number>();
    const executed: string[] = [];
    const writerStore = createMemorySessionStore();
    const supervisor = createSupervisor({
      id: "lead",
      ownership,
      checkpoints,
      definitionRevision: "1",
      children: {
        writer: {
          createAgent: (context) =>
            createAgent({
              id: "child-writer",
              model: { provider: "mock", model: "test" },
              store: writerStore,
              provider: {
                id: "mock",
                async *generate() {
                  const turn = (turns.get(context.resourceId) ?? 0) + 1;
                  turns.set(context.resourceId, turn);
                  if (turn === 1) {
                    yield { type: "tool_call" as const, call: toolCallContent("w1", "write", { v: 1 }) };
                    yield { type: "tool_call" as const, call: toolCallContent("w2", "write", { v: 2 }) };
                    yield providerDone();
                    return;
                  }
                  yield providerTextDelta("writer done");
                  yield providerDone();
                },
              },
              tools: [
                {
                  name: "write",
                  parameters: {},
                  execute: (_args, context: { toolCallId: string }) => {
                    executed.push(context.toolCallId);
                    return { toolCallId: context.toolCallId, name: "write", value: "done" };
                  },
                },
              ],
            }),
        },
      },
    });
    let rootTurn = 0;
    const root = createAgent({
      id: "root",
      model: { provider: "mock", model: "test" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          rootTurn += 1;
          if (rootTurn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("root-d1", "delegate", { childId: "writer" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("root done");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "delegate",
          parameters: {},
          execute: async (args: JsonObject, context: { toolCallId: string }) => {
            const result = await supervisor.delegate({ childId: String(args.childId), input: "go" });
            return { toolCallId: context.toolCallId, name: "delegate", value: result.text };
          },
        },
      ],
    });
    const runState = { checkpoints, definitionRevision: "1", resumeNestedRun: supervisor.resumeNestedRun };
    const first = await root.createSession({ id: "s2" }).run("go", { runState });
    assert.equal(first.status, "suspended");
    const pending = first.interruption!.pendingDecisions!;
    assert.equal(pending.length, 2);

    const partial = await resumeAgentRun(
      root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }] },
      runState,
    );
    assert.equal(partial.status, "suspended");
    assert.equal(partial.interruption?.pendingDecisions?.length, 1);
    assert.equal(partial.interruption?.pendingDecisions?.[0]?.approvalId, pending[1]!.approvalId);
    assert.equal(executed.length, 0);

    const done = await resumeAgentRun(
      root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: partial.runState!.version!, decisions: [{ approvalId: pending[1]!.approvalId, outcome: "allow_once" }] },
      runState,
    );
    assert.equal(done.status, "succeeded");
    assert.deepEqual(executed, ["w1", "w2"]);
  });

  it("preserves grandchild attribution and routes decisions through two levels", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executed: string[] = [];
    const turns = new Map<string, number>();
    const childStores = { middle: createMemorySessionStore(), leaf: createMemorySessionStore() };
    const counted = (key: string, first: () => { type: "tool_call"; call: ReturnType<typeof toolCallContent> }, text: string) => ({
      id: "mock" as const,
      async *generate() {
        const turn = (turns.get(key) ?? 0) + 1;
        turns.set(key, turn);
        if (turn === 1) {
          yield first();
          yield providerDone();
          return;
        }
        yield providerTextDelta(text);
        yield providerDone();
      },
    });
    const supervisor = createSupervisor({
      id: "lead",
      ownership,
      checkpoints,
      definitionRevision: "1",
      children: {
        middle: {
          createAgent: (context) =>
            createAgent({
              id: "child-middle",
              model: { provider: "mock", model: "test" },
              store: childStores.middle,
              provider: counted(
                context.resourceId,
                () => ({ type: "tool_call", call: toolCallContent("m1", "delegate_leaf", {}) }),
                "middle done",
              ),
              tools: [
                {
                  name: "delegate_leaf",
                  parameters: {},
                  execute: async (_args: JsonObject, toolContext: { toolCallId: string }) => {
                    const result = await context.delegate({ childId: "leaf", input: "go" });
                    return { toolCallId: toolContext.toolCallId, name: "delegate_leaf", value: result.text };
                  },
                },
              ],
            }),
        },
        leaf: {
          createAgent: (context) =>
            createAgent({
              id: "child-leaf",
              model: { provider: "mock", model: "test" },
              store: childStores.leaf,
              provider: counted(
                context.resourceId,
                () => ({ type: "tool_call", call: toolCallContent("l1", "write", { v: 9 }) }),
                "leaf done",
              ),
              tools: [
                {
                  name: "write",
                  parameters: {},
                  execute: (args: JsonObject, toolContext: { toolCallId: string }) => {
                    executed.push(JSON.stringify(args));
                    return { toolCallId: toolContext.toolCallId, name: "write", value: "done" };
                  },
                },
              ],
            }),
        },
      },
    });
    let rootTurn = 0;
    const root = createAgent({
      id: "root",
      model: { provider: "mock", model: "test" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          rootTurn += 1;
          if (rootTurn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("root-d1", "delegate", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("root done");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "delegate",
          parameters: {},
          execute: async (_args: JsonObject, context: { toolCallId: string }) => {
            const result = await supervisor.delegate({ childId: "middle", input: "go" });
            return { toolCallId: context.toolCallId, name: "delegate", value: result.text };
          },
        },
      ],
    });
    const runState = { checkpoints, definitionRevision: "1", resumeNestedRun: supervisor.resumeNestedRun };
    const first = await root.createSession({ id: "s3" }).run("go", { runState });

    // Stage 1: the middle child's own gate covers its delegate_leaf call first.
    assert.equal(first.status, "suspended");
    const stage1 = first.interruption!.pendingDecisions!;
    assert.equal(stage1.length, 1);
    assert.deepEqual(stage1[0]!.attribution?.path, ["middle"]);
    assert.equal(stage1[0]!.scope.toolName, "delegate_leaf");

    const second = await resumeAgentRun(
      root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: stage1[0]!.approvalId, outcome: "allow_once" }] },
      runState,
    );

    // Stage 2: the leaf's write approval surfaces through both levels with full attribution.
    assert.equal(second.status, "suspended");
    const stage2 = second.interruption!.pendingDecisions!;
    assert.equal(stage2.length, 1);
    assert.deepEqual(stage2[0]!.attribution?.path, ["middle", "leaf"]);
    assert.equal(stage2[0]!.scope.toolName, "write");
    assert.deepEqual(executed, []);

    const done = await resumeAgentRun(
      root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: second.runState!.version!, decisions: [{ approvalId: stage2[0]!.approvalId, outcome: "allow_once" }] },
      runState,
    );
    assert.equal(done.status, "succeeded");
    assert.equal(done.text, "root done");
    assert.deepEqual(executed, ['{"v":9}']);
  });

  it("rejects forged nested run ids closed and non-enumerating", async () => {
    const h = harness();
    await assert.rejects(
      h.supervisor.resumeNestedRun({ ref: { runId: "run_forged" }, toolCallId: "t1", path: ["writer"] }, [
        { approvalId: "a1", outcome: "allow_once" },
      ]),
      (error: unknown) => {
        assert.ok(error instanceof SupervisorDeniedError);
        assert.ok(!error.message.includes("run_forged"));
        return true;
      },
    );
  });

  // BUG-2 regression (Clay integration findings, plan 050 Task 3): the rebuilt
  // child factory on the resume path gets the same actionable guard as the
  // initial delegation — a session return must not crash at `.config.permission`.
  it("fails closed when a rebuilt child factory returns a non-Agent (resume path)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let valid = true;
    const buildChild = (): Agent =>
      createAgent({
        id: "child-writer",
        model: { provider: "mock", model: "test" },
        store: createMemorySessionStore(),
        provider: {
          id: "mock",
          async *generate() {
            yield { type: "tool_call" as const, call: toolCallContent("w1", "write", { v: 1 }) };
            yield providerDone();
          },
        },
        tools: [
          {
            name: "write",
            parameters: {},
            execute: (_args: JsonObject, context: { toolCallId: string }) => ({
              toolCallId: context.toolCallId,
              name: "write",
              value: "done",
            }),
          },
        ],
      });
    const supervisor = createSupervisor({
      id: "lead",
      ownership,
      checkpoints,
      definitionRevision: "1",
      children: {
        writer: {
          // Valid on the initial delegation; non-Agent on the durable rebuild.
          createAgent: () => (valid ? buildChild() : (buildChild().createSession({ id: "s" }) as unknown as Agent)),
        },
      },
    });
    const root = createAgent({
      id: "root",
      model: { provider: "mock", model: "test" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield { type: "tool_call" as const, call: toolCallContent("root-d1", "delegate", { childId: "writer" }) };
          yield providerDone();
        },
      },
      tools: [
        {
          name: "delegate",
          parameters: {},
          execute: async (args: JsonObject, context: { toolCallId: string }) => {
            const result = await supervisor.delegate({ childId: String(args.childId), input: "go" });
            return { toolCallId: context.toolCallId, name: "delegate", value: result.text };
          },
        },
      ],
    });
    const runState = { checkpoints, definitionRevision: "1", resumeNestedRun: supervisor.resumeNestedRun };
    const first = await root.createSession({ id: "s1" }).run("go", { runState });
    assert.equal(first.status, "suspended");

    valid = false;
    const pending = first.interruption!.pendingDecisions!;
    let failureMessage = "";
    try {
      const result = await resumeAgentRun(
        root,
        { runId: first.runId, sessionId: first.sessionId },
        { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }] },
        runState,
      );
      failureMessage = result.status === "failed" ? (result.error?.message ?? "") : `unexpected status ${result.status}`;
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }
    assert.match(failureMessage, /child "writer" factory must return an Agent, got RuntimeAgentSession/);
  });

  it("cannot widen child permission through a root approval", async () => {
    const readOnly: PermissionPolicy = {
      check: (request) => (request.kind === "tool" ? { allowed: false, reason: "read-only child" } : { allowed: true }),
    };
    const h = harness({ children: { writer: { permission: readOnly } } });
    const first = await h.root.createSession({ id: "s5" }).run("go", { runState: ROOT_RUN_STATE(h) });
    assert.equal(first.status, "suspended");
    const pending = first.interruption!.pendingDecisions!;
    const result = await resumeAgentRun(
      h.root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }] },
      ROOT_RUN_STATE(h),
    );
    // Root approved, but the child's narrowed permission still denied the dispatch.
    assert.equal(result.status, "succeeded");
    assert.deepEqual(h.executed, []);
  });

  it("scopes a root sticky to one child's attribution path, never a sibling's", async () => {
    const h = harness({ children: { c1: {}, c2: {} }, rootTurns: ["c1", "c2", "text"] });
    // Root delegates to c1, then c2; both children call write with identical arguments.
    const first = await h.root.createSession({ id: "s6" }).run("go", { runState: ROOT_RUN_STATE(h) });
    assert.equal(first.status, "suspended");
    const c1Pending = first.interruption!.pendingDecisions!;
    assert.deepEqual(c1Pending[0]!.attribution?.path, ["c1"]);

    const second = await resumeAgentRun(
      h.root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: c1Pending[0]!.approvalId, outcome: "allow_for_run" }] },
      ROOT_RUN_STATE(h),
    );
    // c1 completed under the sticky; c2 suspended and did NOT match the c1 sticky.
    assert.equal(second.status, "suspended");
    const c2Pending = second.interruption!.pendingDecisions!;
    assert.equal(c2Pending.length, 1);
    assert.deepEqual(c2Pending[0]!.attribution?.path, ["c2"]);
    assert.equal(h.executed.filter((entry) => entry.startsWith("c1:")).length, 1);
    assert.equal(h.executed.filter((entry) => entry.startsWith("c2:")).length, 0);

    const done = await resumeAgentRun(
      h.root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: second.runState!.version!, decisions: [{ approvalId: c2Pending[0]!.approvalId, outcome: "allow_once" }] },
      ROOT_RUN_STATE(h),
    );
    assert.equal(done.status, "succeeded");
    assert.equal(h.executed.filter((entry) => entry.startsWith("c2:")).length, 1);
  });
});
