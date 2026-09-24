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
import {
  type CreateSupervisorOptions,
  createSupervisor,
  type DelegationChildContext,
  type DelegationCompletion,
  type Supervisor,
  SupervisorDeniedError,
  type SupervisorEvent,
} from "../index.js";

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
  childEvents?: boolean;
  limits?: CreateSupervisorOptions["limits"];
  hooks?: CreateSupervisorOptions["hooks"];
  /** After a resume, this child spawns `spawnChildId` fire-and-forget, then fails its run. */
  resumeSpawn?: { childId: string; spawnChildId: string };
  /** Shared durable state, so a second instance can resume what the first suspended. */
  durable?: {
    checkpoints: ReturnType<typeof createMemoryCheckpointStore>;
    sessions: Map<string, ReturnType<typeof createMemorySessionStore>>;
    /** Per-scope provider turn counters: a rebuilt provider must not replay turn 1. */
    turns: Map<string, number>;
  };
  /** Hold the resumed turn open until this resolves (observes a delegation that is live on resume). */
  resumeGate?: Promise<void>;
}): Harness {
  const checkpoints = options?.durable?.checkpoints ?? createMemoryCheckpointStore();
  const executed: string[] = [];
  const turns = options?.durable?.turns ?? new Map<string, number>();
  // Session stores persist across child-agent rebuilds (hosts use durable stores).
  const sessionStores = options?.durable?.sessions ?? new Map<string, ReturnType<typeof createMemorySessionStore>>();
  const storeFor = (key: string) => {
    let store = sessionStores.get(key);
    if (!store) {
      store = createMemorySessionStore();
      sessionStores.set(key, store);
    }
    return store;
  };
  const childDefs = options?.children ?? { writer: {} };

  const childAgent = (childId: string, scopeKey: string, context: DelegationChildContext): Agent =>
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
          if (options?.resumeSpawn?.childId === childId) {
            context.delegate({ childId: options.resumeSpawn.spawnChildId, input: "slow" }).catch(() => undefined);
            throw new Error(`${childId} exploded after resume`);
          }
          if (options?.resumeGate) await options.resumeGate;
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
    ...(options?.childEvents !== undefined ? { childEvents: options.childEvents } : {}),
    ...(options?.limits !== undefined ? { limits: options.limits } : {}),
    ...(options?.hooks !== undefined ? { hooks: options.hooks } : {}),
    children: Object.fromEntries(
      Object.entries(childDefs).map(([childId, def]) => [
        childId,
        {
          permission: def.permission,
          createAgent: (context) => childAgent(childId, context.resourceId, context),
        },
      ]),
    ),
  });

  const rootPlan = options?.rootTurns ?? [Object.keys(childDefs)[0]!, "text"];
  const root = createAgent({
    id: "root",
    model: { provider: "mock", model: "test" },
    store: storeFor("root-session"),
    provider: {
      id: "mock",
      async *generate() {
        // Shared across instances like the child counters: a rebuilt root must not replay turn 1.
        const rootTurn = (turns.get("root") ?? 0) + 1;
        turns.set("root", rootTurn);
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

/** Drain supervisor events until `until` matches (inclusive) or the stream closes. */
async function pullUntil(iterator: AsyncIterator<SupervisorEvent>, until: (event: SupervisorEvent) => boolean) {
  const seen: SupervisorEvent[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    seen.push(next.value);
    if (until(next.value)) break;
  }
  return seen;
}

/** Suspend the root on one child approval, then resume it with `outcome`. */
async function suspendThenResume(h: Harness, sessionId: string, outcome: "allow_once" | "reject_once" = "allow_once") {
  const first = await h.root.createSession({ id: sessionId }).run("go", { runState: ROOT_RUN_STATE(h) });
  assert.equal(first.status, "suspended");
  const decision = first.interruption?.pendingDecisions?.[0];
  const version = first.runState?.version;
  assert.ok(decision, "the child approval surfaced on the root run");
  assert.ok(version !== undefined, "the root run version is durable");
  return resumeAgentRun(
    h.root,
    { runId: first.runId, sessionId: first.sessionId },
    { expectedVersion: version, decisions: [{ approvalId: decision.approvalId, outcome }] },
    ROOT_RUN_STATE(h),
  ).catch((error: unknown) => error);
}

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
    assert.equal(first.interruption?.reason, "2 approval request(s) need a decision");

    const partial = await resumeAgentRun(
      root,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState!.version!, decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }] },
      runState,
    );
    assert.equal(partial.status, "suspended");
    assert.equal(partial.interruption?.reason, "1 approval request(s) remain");
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

    // Plan 108 T3: the persisted mapping keeps the ancestor delegation ids, so a resumed
    // rebuild reconstructs the same delegation chain instead of the child-id path alone.
    const mappings = (await checkpoints.listCheckpoints()).items.map(
      (record) => record.value as { childId?: string; delegationId?: string; parents?: readonly string[] },
    );
    const leafMapping = mappings.find((mapping) => mapping.childId === "leaf");
    assert.equal(leafMapping?.delegationId, "lead-2");
    assert.deepEqual(leafMapping?.parents, ["lead-1"], "the suspended leaf's mapping carries its ancestor delegation ids");

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

  // BUG-2 regression (integration findings, plan 050 Task 3): the rebuilt
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

  // Plan 078 Task 7: the rebuilt child session gets the same milestone pump as live `delegate()`,
  // and a resumed terminal outcome runs `hooks.after` with the original delegation id.
  it("projects child milestones and runs the terminal hook when a suspended child resumes", async () => {
    const completions: DelegationCompletion[] = [];
    const h = harness({ childEvents: true, hooks: { after: (completion) => void completions.push(completion) } });
    const iterator = h.supervisor.subscribe()[Symbol.asyncIterator]();
    const result = await suspendThenResume(h, "s7");
    assert.equal((result as { status?: string }).status, "succeeded");

    const events = await pullUntil(iterator, (event) => event.type === "delegation_finished");
    const childEvents = events.filter((event) => event.type === "delegation_child_event");
    const types = childEvents.map((event) => event.childEvent.type);
    // One pump run per attempt: the live attempt (started, suspended) and the resume.
    assert.equal(types.filter((type) => type === "agent_started").length, 2);
    assert.ok(types.includes("agent_suspended"));
    // The gated tool only executes after the approval, so these milestones can only come from resume.
    assert.ok(types.includes("tool_execution_started"));
    assert.ok(types.includes("tool_execution_finished"));
    assert.ok(types.includes("agent_finished"));
    assert.equal(types.includes("message_delta") || types.includes("message_started"), false);
    assert.equal(
      childEvents.every((event) => event.childId === "writer" && event.delegationId === "lead-1" && event.depth === 1),
      true,
    );
    const finished = events.at(-1);
    assert.ok(finished && finished.type === "delegation_finished");
    assert.equal(finished.status, "succeeded");

    const [completion] = completions;
    assert.ok(completion);
    assert.equal(completions.length, 1);
    assert.equal(completion.childId, "writer");
    assert.equal(completion.delegationId, "lead-1");
    assert.equal(completion.status, "succeeded");
    assert.equal(completion.text, "writer done");
  });

  it("caps resumed child events with one overflow marker per pump attempt", async () => {
    const h = harness({ childEvents: true, limits: { maxChildEventsPerDelegation: 2 } });
    const iterator = h.supervisor.subscribe()[Symbol.asyncIterator]();
    await suspendThenResume(h, "s8");

    const events = await pullUntil(iterator, (event) => event.type === "delegation_finished");
    const capped = events.filter((event) => event.type === "delegation_child_events_capped");
    // Plan 093 T3: the stream projection now carries per-turn events too, so the live attempt
    // (which stops at the gate) and the resume attempt each surface their own marker.
    assert.equal(capped.length, 2, "live and resume each emit the overflow marker exactly once");
    const [marker] = capped;
    assert.ok(marker && marker.type === "delegation_child_events_capped");
    assert.equal(marker.maxChildEvents, 2);
  });

  it("leaves the resume stream unchanged when childEvents is off and still runs the terminal hook", async () => {
    const completions: DelegationCompletion[] = [];
    const h = harness({ hooks: { after: (completion) => void completions.push(completion) } });
    const iterator = h.supervisor.subscribe()[Symbol.asyncIterator]();
    await suspendThenResume(h, "s9");

    const events = await pullUntil(iterator, (event) => event.type === "delegation_finished");
    assert.deepEqual(
      events.filter((event) => event.type === "delegation_child_event"),
      [],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "delegation_child_events_capped"),
      [],
    );
    assert.equal(completions.length, 1);
    const [completion] = completions;
    assert.ok(completion);
    assert.equal(completion.delegationId, "lead-1");
    assert.equal(completion.status, "succeeded");
  });

  it("treats a denied rebuild as terminal: one rejection event and one terminal hook", async () => {
    const completions: DelegationCompletion[] = [];
    let beforeCalls = 0;
    const h = harness({
      hooks: {
        before: () => (++beforeCalls === 1 ? { allowed: true } : { allowed: false, reason: "revoked" }),
        after: (completion) => void completions.push(completion),
      },
    });
    const iterator = h.supervisor.subscribe()[Symbol.asyncIterator]();
    await suspendThenResume(h, "s10");

    const events = await pullUntil(iterator, (event) => event.type === "delegation_rejected");
    const rejected = events.at(-1);
    assert.ok(rejected && rejected.type === "delegation_rejected");
    assert.equal(rejected.reason, "revoked");
    assert.equal(completions.length, 1);
    const [completion] = completions;
    assert.ok(completion);
    assert.equal(completion.delegationId, "lead-1");
    assert.equal(completion.status, "rejected");
    assert.equal(completion.error, "revoked");
  });

  it("keeps the delegation ancestry across a resume so the failure radius stays exact", async () => {
    const h = harness({
      children: { lead: {}, writer: {} },
      rootTurns: ["lead", "text"],
      resumeSpawn: { childId: "lead", spawnChildId: "writer" },
    });
    const outcome = await suspendThenResume(h, "s11");
    assert.ok(
      outcome instanceof Error || (outcome as { status?: string }).status === "failed",
      "the resumed child failure surfaces on the root run",
    );
    const [lead, writer] = h.supervisor.summary().children;
    assert.equal(lead?.attempts, 1, "a resume is not a new attempt");
    assert.equal(lead?.failures, 1);
    assert.equal(lead?.failureRadius, 1, "a descendant spawned after the resume is attributed to its delegation");
    assert.equal(writer?.outcome, "running", "the spawned descendant is still live (its approval is outstanding)");
  });

  // Plan 108 follow-up: a delegation resumed by a fresh supervisor instance is live again, so its
  // child row does not flip back to a terminal outcome while it runs, and a delegation started
  // after that resume cannot reuse the resumed delegation's id (the registry is keyed by it).
  it("registers a delegation resumed by a fresh supervisor instance as live", async () => {
    const durable = {
      checkpoints: createMemoryCheckpointStore(),
      sessions: new Map<string, ReturnType<typeof createMemorySessionStore>>(),
      turns: new Map<string, number>(),
    };
    const before = harness({ durable });
    const suspended = await before.root.createSession({ id: "s12" }).run("go", { runState: ROOT_RUN_STATE(before) });
    assert.equal(suspended.status, "suspended");
    const decision = suspended.interruption?.pendingDecisions?.[0];
    const version = suspended.runState?.version;
    assert.ok(decision && version !== undefined, "the child approval and the root version are durable");

    // Restart: a new instance over the same checkpoints and session stores. Its first fresh
    // delegation would otherwise take `lead-1`, the id the resumed delegation already holds.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let beforeCalls = 0;
    const after = harness({
      durable,
      resumeGate: gate,
      childEvents: true,
      hooks: { before: () => (++beforeCalls === 1 ? { allowed: true } : { allowed: false, reason: "revoked" }) },
    });
    const iterator = after.supervisor.subscribe()[Symbol.asyncIterator]();
    const resumed = resumeAgentRun(
      after.root,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { expectedVersion: version, decisions: [{ approvalId: decision.approvalId, outcome: "allow_once" }] },
      ROOT_RUN_STATE(after),
    ).catch((error: unknown) => error);
    // The rebuilt delegation replays its one gated call, then holds its run open on the gate.
    await pullUntil(iterator, (event) => event.type === "delegation_child_event" && event.childEvent.type === "tool_execution_finished");
    assert.equal(after.executed.length, 1, "only the resumed delegation ran its gated tool");

    // A second delegation of the same child is rejected while the resumed one is live: the row
    // must stay `running` (and not delete the resumed delegation's live entry).
    await assert.rejects(after.supervisor.delegate({ childId: "writer", input: "again" }), SupervisorDeniedError);
    assert.deepEqual(after.supervisor.summary().children, [
      { childId: "writer", attempts: 1, retries: 0, failures: 0, failureRadius: 0, outcome: "running" },
    ]);

    release();
    const settled = await resumed;
    assert.ok(!(settled instanceof Error), `resumed root run failed: ${String(settled)}`);
    assert.equal((settled as { status?: string }).status, "succeeded");
    assert.deepEqual(after.supervisor.summary().children, [
      { childId: "writer", attempts: 1, retries: 0, failures: 0, failureRadius: 0, outcome: "succeeded" },
    ]);
  });
});
