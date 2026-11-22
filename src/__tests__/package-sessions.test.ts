/**
 * Plan 232 Task 2: a package opens a linked child session on its own agent (`PackageAPI.sessions.open`, capability
 * `sessions`), and a child run charges its ancestor's active run (`RunOptions.chargeTo`).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type Agent,
  type AgentConfig,
  type Compactor,
  type LoopStrategy,
  type ModelProvider,
  type PackageAPI,
  type ProviderRequest,
  type RunLedger,
  type RunResult,
  type Session,
  type SessionContext,
  type Usage,
  type UsageRecord,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  definePackage,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const model = { provider: "mock", model: "demo" } as const;
const PARENT_USAGE: Usage = { inputTokens: 100, outputTokens: 100, totalTokens: 200 };
const CHILD_TASK = "child-task";

const textOf = (request: ProviderRequest): string =>
  request.messages.flatMap((message) => message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))).join("\n");

interface Harness {
  readonly agent: Agent;
  readonly api: () => PackageAPI<any>;
  readonly usageRows: UsageRecord[];
  readonly seen: ProviderRequest[];
  /** What the `spawn` tool saw: the child it opened and the child run's result. */
  readonly spawned: { child?: Session; result?: RunResult; error?: unknown; view?: SessionContext }[];
}

interface HarnessOptions {
  readonly childUsage?: Usage;
  readonly capabilities?: readonly string[];
  readonly config?: Partial<AgentConfig>;
  /** How the spawn tool runs its child; default charges the tool's own session. */
  readonly runChild?: (child: Session, view: SessionContext) => Promise<RunResult>;
  readonly skills?: AgentConfig["skills"];
}

/**
 * A parent run whose first turn calls `spawn`; the tool opens a child of its own session and runs it. Child requests
 * are told apart by the child's input text.
 */
async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const usageRows: UsageRecord[] = [];
  const seen: ProviderRequest[] = [];
  const parentTurns = new Map<string, number>();
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      seen.push(request);
      if (textOf(request).includes(CHILD_TASK)) {
        yield providerTextDelta("child answer");
        yield providerDone(options.childUsage ?? { inputTokens: 1_000, outputTokens: 1_000, totalTokens: 2_000 });
        return;
      }
      const firstUser = [...request.messages].reverse().find((message) => message.role === "user");
      const key = firstUser ? textOf({ ...request, messages: [firstUser] }) : "";
      const turn = (parentTurns.get(key) ?? 0) + 1;
      parentTurns.set(key, turn);
      if (turn === 1 && key.startsWith("spawn")) {
        yield { type: "tool_call" as const, call: toolCallContent(`c-${key}`, "spawn", {}) };
        yield providerDone(PARENT_USAGE);
        return;
      }
      yield providerTextDelta("done");
      yield providerDone(PARENT_USAGE);
    },
  };
  let held: PackageAPI<any> | undefined;
  const spawned: Harness["spawned"] = [];
  const spawner = definePackage<any>({
    name: "@acme/spawner",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: (options.capabilities ?? ["sessions"]) as never,
    setup(prism) {
      held = prism;
      prism.tools.register({
        name: "spawn",
        parameters: {},
        async execute(_args, context) {
          const record: Harness["spawned"][number] = { view: context.session };
          spawned.push(record);
          const child = await prism.sessions.open({ parent: { sessionId: context.sessionId!, delegationId: "d-1" } });
          record.child = child;
          try {
            record.result = await (options.runChild
              ? options.runChild(child, context.session!)
              : child.run(CHILD_TASK, { chargeTo: context.session }));
          } catch (error) {
            record.error = error;
            throw error;
          }
          return { toolCallId: context.toolCallId, name: "spawn", value: record.result!.status };
        },
      });
    },
  });
  const ledger: RunLedger = {
    appendRun: async () => undefined,
    appendEvent: async () => undefined,
    appendToolCall: async () => undefined,
    appendUsage: async (record) => {
      usageRows.push(record);
    },
  };
  const agent = await createAgent({
    model,
    packages: [providerPackage("mock-provider", [provider]), spawner],
    slots: { store: createMemorySessionStore() },
    runLedger: ledger,
    ...(options.skills ? { skills: options.skills } : {}),
    ...options.config,
  });
  return { agent, api: () => held!, usageRows, seen, spawned };
}

describe("PackageAPI.sessions.open (plan 232 Task 2)", () => {
  it("package_opens_a_linked_child_session", async () => {
    const h = await harness();
    const parent = await h.agent.session();
    const result = await parent.run("spawn one");
    assert.equal(result.status, "completed");
    const child = h.spawned[0]!.child!;
    const listed = await h.agent.sessions.list({ parentSessionId: parent.id });
    assert.deepEqual(
      listed.items.map((item) => item.sessionId),
      [child.id],
    );
    assert.equal(listed.items[0]?.delegationId, "d-1");
    assert.equal(h.spawned[0]!.result?.status, "completed");
    // The child's transcript is in the agent's store and outlives the tool call.
    const entries = await h.agent.sessions.get(child.id);
    assert.ok((entries?.messageCount ?? 0) >= 2);
    // Its views see the link synchronously.
    assert.equal(h.spawned[0]!.view?.depth, 0);
    assert.equal(h.spawned[0]!.view?.parentSessionId, undefined);
    await h.agent.dispose();
  });

  it("sessions_open_needs_the_capability", async () => {
    const h = await harness({ capabilities: [] });
    const parent = await h.agent.session();
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: parent.id } }), { code: "capability_missing" });
    await h.agent.dispose();
  });

  it("sessions_open_during_setup_throws_state_not_ready", async () => {
    let failure: unknown;
    const early = definePackage({
      name: "@acme/early",
      version: "1.0.0",
      requires: { api: 1 },
      capabilities: ["sessions"],
      async setup(prism) {
        failure = await prism.sessions.open({ parent: { sessionId: "x" } }).catch((error: unknown) => error);
      },
    });
    const agent = await createAgent({ model, packages: [early], slots: { store: createMemorySessionStore() } });
    assert.equal((failure as { code?: string }).code, "state_not_ready");
    await agent.dispose();
  });

  it("parent_must_be_an_open_session_of_this_agent", async () => {
    const h = await harness();
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: "nope" } }), /open session of this agent/);
    const parent = await h.agent.session();
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: parent.id, agentId: "x" } as never }), /not a child link/);
    await parent.close();
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: parent.id } }), /open session of this agent/);
    await h.agent.dispose();
  });

  it("child_cannot_widen_ownership_scope", async () => {
    const store = createMemorySessionStore();
    const h = await harness({ config: { slots: { store } } });
    const parent = await h.agent.session({ ownership: { tenantId: "t1" } });
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: parent.id }, ownership: { tenantId: "t2" } }), {
      code: "ERR_PRISM_OWNERSHIP_WIDEN",
    });
    const child = await h.api().sessions.open({ parent: { sessionId: parent.id }, ownership: { userId: "u1" } });
    const stored = await store.list(child.id);
    assert.ok(stored.length > 0);
    for (const entry of stored) {
      assert.equal(entry.metadata?.tenantId, "t1", "the parent's scope is inherited");
      assert.equal(entry.metadata?.userId, "u1", "and may be narrowed");
    }
    await h.agent.dispose();
  });

  it("closing_the_parent_closes_children", async () => {
    const h = await harness();
    const parent = await h.agent.session();
    const child = await h.api().sessions.open({ parent: { sessionId: parent.id } });
    const grandchild = await h.api().sessions.open({ parent: { sessionId: child.id } });
    const closed: string[] = [];
    for (const session of [child, grandchild]) {
      const original = session.close.bind(session);
      (session as { close: () => Promise<void> }).close = async () => {
        closed.push(session.id);
        await original();
      };
    }
    await parent.close();
    assert.deepEqual([...closed].sort(), [child.id, grandchild.id].sort(), "the child, and through it the grandchild");
    // The kernel closes the children through their own close path; a closed child cannot be a parent any more.
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: child.id } }), /open session of this agent/);
    await assert.rejects(h.api().sessions.open({ parent: { sessionId: grandchild.id } }), /open session of this agent/);
    await h.agent.dispose();
  });

  it("reopens_a_stored_child_of_its_parent_by_id", async () => {
    // Plan 232 Task 4: a parent resumed in a new process reaches its stored child; another parent's session is refused.
    const store = createMemorySessionStore();
    const first = await harness({ config: { slots: { store } } });
    const parent = await first.agent.session();
    await parent.run("hello");
    const child = await first.api().sessions.open({ parent: { sessionId: parent.id } });
    const other = await first.agent.session();
    const stranger = await first.api().sessions.open({ parent: { sessionId: other.id } });
    await child.run(CHILD_TASK);
    // The same process: the open child is returned as is.
    assert.equal(await first.api().sessions.open({ parent: { sessionId: parent.id }, id: child.id }), child);
    await first.agent.dispose();

    const second = await harness({ config: { slots: { store } } });
    const reopenedParent = await second.agent.session({ id: parent.id });
    const reopened = await second.api().sessions.open({ parent: { sessionId: reopenedParent.id }, id: child.id });
    assert.equal(reopened.id, child.id);
    assert.match(JSON.stringify(await reopened.messages()), /child answer/);
    await assert.rejects(
      second.api().sessions.open({ parent: { sessionId: reopenedParent.id }, id: stranger.id }),
      /id must name a child session of parent.sessionId/,
    );
    await assert.rejects(second.api().sessions.open({ parent: { sessionId: reopenedParent.id }, id: "missing" }), {
      name: "SessionNotFoundError",
    });
    await assert.rejects(
      second.api().sessions.open({ parent: { sessionId: reopenedParent.id }, id: child.id, seed: [] }),
      /seed cannot be given with id/,
    );
    // A reopened child closes with its parent, like a new one.
    await reopenedParent.close();
    await assert.rejects(second.api().sessions.open({ parent: { sessionId: child.id } }), /open session of this agent/);
    await second.agent.dispose();
  });

  it("tool_context_carries_the_run_interactivity", async () => {
    const seen: (boolean | undefined)[] = [];
    const probe = definePackage({
      name: "@acme/probe",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.tools.register({
          name: "probe",
          parameters: {},
          execute: (_args, context) => {
            seen.push(context.interactive);
            return { toolCallId: context.toolCallId, name: "probe", value: "ok" };
          },
        });
      },
    });
    let turns = 0;
    const agent = await createAgent({
      model,
      packages: [
        providerPackage("mock-provider", [
          {
            id: "mock",
            async *generate() {
              turns += 1;
              if (turns % 2 === 1) yield { type: "tool_call" as const, call: toolCallContent(`p-${turns}`, "probe", {}) };
              else yield providerTextDelta("done");
              yield providerDone();
            },
          },
        ]),
        probe,
      ],
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session();
    await session.run("one");
    await session.run("two", { interactive: false });
    assert.deepEqual(seen, [true, false]);
    await agent.dispose();
  });

  it("seeded_child_starts_with_summary_and_messages", async () => {
    const store = createMemorySessionStore();
    const h = await harness({ config: { slots: { store } } });
    const parent = await h.agent.session({ ownership: { tenantId: "t1" } });
    const child = await h.api().sessions.open({
      parent: { sessionId: parent.id },
      seed: [
        { kind: "summary", summary: "earlier work" },
        { kind: "message", message: { role: "user", content: [{ type: "text", text: "seeded question" }] } },
      ],
    });
    const stored = await store.list(child.id);
    assert.deepEqual(
      stored.map((entry) => entry.kind),
      ["metadata", "summary", "message"],
    );
    assert.equal(stored[1]?.parentId, stored[0]?.id);
    assert.equal(stored[2]?.parentId, stored[1]?.id);
    for (const entry of stored) {
      assert.equal(entry.sessionId, child.id);
      assert.equal(entry.metadata?.tenantId, "t1");
    }
    for (const bad of [
      { kind: "compaction", summary: "x" },
      { kind: "message", message: { role: "system", content: [] } },
      { kind: "summary", summary: "x", id: "forged" },
    ]) {
      await assert.rejects(h.api().sessions.open({ parent: { sessionId: parent.id }, seed: [bad as never] }), TypeError);
    }
    await h.agent.dispose();
  });

  it("tools_list_names_the_registering_package", async () => {
    const h = await harness({
      config: {
        tools: { add: [{ name: "host_tool", parameters: {}, execute: () => ({ toolCallId: "x", name: "host_tool", value: 1 }) }] },
      },
    });
    const owners = Object.fromEntries(
      h
        .api()
        .tools.list()
        .map((tool) => [tool.name, tool.package]),
    );
    assert.equal(owners.spawn, "@acme/spawner");
    assert.equal(owners.host_tool, "host");
    await h.agent.dispose();
  });

  it("depth_and_parent_session_id_survive_resume", async () => {
    const store = createMemorySessionStore();
    const keepLast: Compactor = {
      name: "keep-last",
      compact(context) {
        const through = context.entries.at(-2);
        return {
          summary: "summary",
          entries: [
            createSessionEntry({
              sessionId: context.sessionId,
              kind: "compaction",
              summary: "summary",
              data: { throughEntryId: through?.id, keepEntryIds: [context.entries.at(-1)!.id] },
            }),
          ],
        };
      },
    };
    let seenDepth: number | undefined;
    let seenParent: string | undefined;
    const h = await harness({
      config: {
        slots: { store, compaction: keepLast },
        hooks: (hooks) =>
          hooks.on("run.started", (_event, context) => {
            seenDepth = context.session?.depth;
            seenParent = context.session?.parentSessionId;
          }),
      },
    });
    const root = await h.agent.session();
    const child = await h.api().sessions.open({ parent: { sessionId: root.id } });
    const grandchild = await h.api().sessions.open({ parent: { sessionId: child.id } });
    await grandchild.run("one");
    await grandchild.run("two");
    await grandchild.compact();
    await grandchild.run("three");
    // A fresh agent on the same store: nothing is open, so depth comes from the persisted links entry only.
    const fresh = await createAgent({
      model,
      packages: [h.agent.config.packages![0]!],
      slots: { store },
      hooks: (hooks) =>
        hooks.on("run.started", (_event, context) => {
          seenDepth = context.session?.depth;
          seenParent = context.session?.parentSessionId;
        }),
    });
    const resumed = await fresh.session({ id: grandchild.id });
    await resumed.run("four");
    assert.equal(seenDepth, 2);
    assert.equal(seenParent, child.id);
    const stored = await store.list(grandchild.id);
    assert.equal(
      (stored[0]?.data as { links?: { depth?: number } } | undefined)?.links?.depth,
      2,
      "the depth is stamped in the links entry",
    );
    await fresh.dispose();
    await h.agent.dispose();
  });

  it("a_host_link_to_a_parent_session_counts_one_level_and_drops_a_caller_depth", async () => {
    const store = createMemorySessionStore();
    const h = await harness({ config: { slots: { store } } });
    const child = await h.agent.session({ parent: { sessionId: "elsewhere", depth: 9 } as never });
    const stored = await store.list(child.id);
    assert.equal((stored[0]?.data as { links?: { depth?: number } } | undefined)?.links?.depth, 1);
    await h.agent.dispose();
  });
});

describe("RunOptions.chargeTo (plan 232 Task 2)", () => {
  it("child_usage_is_charged_to_the_parent_run", async () => {
    const h = await harness({ childUsage: { inputTokens: 3_000, outputTokens: 3_000, totalTokens: 6_000 } });
    const parent = await h.agent.session();
    const result = await parent.run("spawn one", { limits: { maxTotalTokens: 5_000 } });
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "maxTotalTokens");
    await h.agent.dispose();
  });

  it("parent_breach_aborts_the_child_run", async () => {
    const h = await harness({ childUsage: { inputTokens: 3_000, outputTokens: 3_000, totalTokens: 6_000 } });
    const parent = await h.agent.session();
    await parent.run("spawn one", { limits: { maxTotalTokens: 5_000 } });
    const spawned = h.spawned[0]!;
    const childStatus = spawned.result?.status ?? (spawned.error ? "threw" : undefined);
    assert.ok(childStatus === "failed" || childStatus === "threw", `the child run fails with its parent; got ${String(childStatus)}`);
    await h.agent.dispose();
  });

  it("child_usage_is_in_the_parent_run_usage_and_ledger_as_child_run", async () => {
    const h = await harness();
    const parent = await h.agent.session();
    const result = await parent.run("spawn one");
    assert.equal(result.status, "completed");
    assert.equal(result.usage?.totalTokens, 200 + 200 + 2_000, "two parent turns and the child's one turn");
    const child = h.spawned[0]!.child!;
    const mirrored = h.usageRows.filter((row) => row.scope === "child_run");
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0]?.sessionId, parent.id);
    const childTurns = h.usageRows.filter((row) => row.scope === "provider_turn" && row.sessionId === child.id);
    assert.equal(childTurns.length, 1, "the child keeps its own provider_turn row");
    // A total across sessions counts each turn once only when it leaves child_run rows out.
    // `run_total` rows are aggregates either way; the turn-level rows are what a cross-session total sums.
    const crossSession = h.usageRows
      .filter((row) => row.scope === "provider_turn" || row.scope === "package_call")
      .reduce((sum, row) => sum + (row.usage.totalTokens ?? 0), 0);
    assert.equal(crossSession, 2_400);
    await h.agent.dispose();
  });

  it("child_run_rows_are_scoped_and_no_charge_without_parent_run", async () => {
    let view: SessionContext | undefined;
    const h = await harness({
      config: {
        hooks: (hooks) =>
          hooks.on("run.started", (_event, context) => {
            view ??= context.session;
          }),
      },
    });
    const parent = await h.agent.session();
    await parent.run("plain");
    const before = h.usageRows.length;
    // The parent's run has ended: an async child outliving it charges nothing to it.
    const child = await h.api().sessions.open({ parent: { sessionId: parent.id } });
    const result = await child.run(CHILD_TASK, { chargeTo: view });
    assert.equal(result.status, "completed");
    const rows = h.usageRows.slice(before);
    assert.equal(rows.filter((row) => row.scope === "child_run").length, 0);
    assert.equal(rows.filter((row) => row.scope === "provider_turn" && row.sessionId === child.id).length, 1);
    await h.agent.dispose();
  });

  it("charge_to_must_be_an_ancestor", async () => {
    const views = new Map<string, SessionContext>();
    const h = await harness({
      config: {
        hooks: (hooks) =>
          hooks.on("session.opened", (event, context) => {
            if (context.session) views.set(event.sessionId, context.session);
          }),
      },
    });
    const parent = await h.agent.session();
    const parentView = views.get(parent.id);
    assert.ok(parentView);
    const child = await h.api().sessions.open({ parent: { sessionId: parent.id } });
    const sibling = await h.api().sessions.open({ parent: { sessionId: parent.id } });
    // A sibling is not an ancestor; nor is the session itself, a child, a hand-built context, or another agent's view.
    await assert.rejects(child.run("x", { chargeTo: views.get(sibling.id) }), /not an ancestor/);
    await assert.rejects(child.run("x", { chargeTo: views.get(child.id) }), /not an ancestor/);
    await assert.rejects(parent.run("x", { chargeTo: views.get(child.id) }), /not an ancestor/);
    await assert.rejects(
      child.run("x", { chargeTo: { id: parent.id, entries: async () => [], background: () => undefined } }),
      /not a kernel session view/,
    );
    const other = await harness({
      config: {
        hooks: (hooks) =>
          hooks.on("session.opened", (event, context) => {
            if (context.session) views.set(`other:${event.sessionId}`, context.session);
          }),
      },
    });
    const foreign = await other.agent.session({ id: parent.id, create: true });
    await assert.rejects(child.run("x", { chargeTo: views.get(`other:${foreign.id}`) }), /another agent/);
    // The real ancestor is accepted, and so is the grandparent from a grandchild.
    assert.equal((await child.run(CHILD_TASK, { chargeTo: parentView })).status, "completed");
    const grandchild = await h.api().sessions.open({ parent: { sessionId: child.id } });
    assert.equal((await grandchild.run(CHILD_TASK, { chargeTo: parentView })).status, "completed");
    await other.agent.dispose();
    await h.agent.dispose();
  });

  it("works_from_a_custom_loop", async () => {
    const customLoop: LoopStrategy = {
      name: "custom-parent",
      revision: "1",
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
    const h = await harness({
      config: { slots: { loop: customLoop } },
      childUsage: { inputTokens: 3_000, outputTokens: 3_000, totalTokens: 6_000 },
    });
    const parent = await h.agent.session();
    const ok = await parent.run("spawn under budget");
    assert.equal(ok.status, "completed");
    assert.equal(h.usageRows.filter((row) => row.scope === "child_run" && row.sessionId === parent.id).length, 1);
    const capped = await parent.run("spawn over budget", { limits: { maxTotalTokens: 5_000 } });
    assert.equal(capped.status, "failed");
    assert.equal(capped.limit?.limit, "maxTotalTokens");
    await h.agent.dispose();
  });
});

describe("RunOptions.skills (plan 232 Task 2)", () => {
  const skill = (name: string) => ({ name, description: `${name} skill`, instructions: `use ${name}` });

  it("run_skills_only_narrows_and_false_disables", async () => {
    const h = await harness({ skills: { add: [skill("alpha"), skill("beta")], disclosure: "eager" } });
    const session = await h.agent.session();
    const systemOf = () => {
      const request = h.seen.at(-1)!;
      return JSON.stringify(request.messages.filter((message) => message.role === "system")) + JSON.stringify(request.context ?? "");
    };
    await session.run("plain all");
    assert.match(systemOf(), /use alpha/);
    assert.match(systemOf(), /use beta/);
    await session.run("plain only", { skills: { only: ["beta"] } });
    assert.doesNotMatch(systemOf(), /use alpha/);
    assert.match(systemOf(), /use beta/);
    await session.run("plain none", { skills: false });
    assert.doesNotMatch(systemOf(), /use alpha|use beta/);
    await assert.rejects(session.run("plain unknown", { skills: { only: ["gamma"] } }), /unknown skills: gamma/);
    await assert.rejects(session.run("plain bad", { skills: { only: "beta" } as never }), TypeError);
    await h.agent.dispose();
  });
});
