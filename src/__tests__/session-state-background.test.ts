import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { agentRuntime } from "../agent-session/create-agent.js";
import {
  type AgentEvent,
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  definePackage,
  type JsonValue,
  type LoopStrategy,
  PackageLoadError,
  type PackageDefinitionInput,
  providerDone,
  providerTextDelta,
  rebuildSessionContext,
  type SessionContext,
  type SessionState,
  type SessionStore,
} from "../index.js";
import { createJsonlSessionStore } from "../node/session-store-jsonl.js";
import { assertSessionStoreConforms } from "../testing/session-store-conformance.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const SECRET = "sk-live-0123456789abcdef";

type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"] = () => {}, extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", setup, ...extra });

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

async function rejects(promise: Promise<unknown>, code: string): Promise<PackageLoadError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof PackageLoadError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  return assert.fail(`expected PackageLoadError ${code}`);
}

interface Counter {
  readonly n: number;
}

/** A package keeping a counter in session state, with `bump`, `get`, and `set` commands. */
function counterPackage(options: { readonly capabilities?: Loose["capabilities"]; onState?: (state: SessionState<any>) => void } = {}) {
  return pkg(
    "@acme/om",
    ({ state, commands }) => {
      const om = state.session<JsonValue>("om", { n: 0 });
      options.onState?.(om);
      const read = (session: SessionContext | undefined) => (om.get(session!) as unknown as Counter).n;
      commands.register({
        name: "bump",
        description: "adds one",
        run: async (_args, ctx) => {
          await om.set(ctx.session!, { n: read(ctx.session) + 1 });
          return read(ctx.session);
        },
      });
      commands.register({ name: "get", description: "reads", run: (_args, ctx) => read(ctx.session) });
      commands.register({
        name: "set",
        description: "stores any value",
        args: { type: "object", additionalProperties: true },
        run: (args, ctx) => om.set(ctx.session!, args.value as JsonValue),
      });
    },
    { capabilities: options.capabilities ?? ["session-state"] },
  );
}

describe("package session state", () => {
  it("session_state_survives_fork_and_resume", async () => {
    const store = createMemorySessionStore();
    const config = { model: MODEL, provider, packages: [counterPackage()], slots: { store } };
    const agent = await createAgent(config);
    const session = await agent.session({ id: "s", create: true });
    assert.equal(await agent.commands.run("bump", {}, { session }), 1);
    const originalLeaf = session.leafId;

    const fork = await session.fork();
    assert.equal(await agent.commands.run("get", {}, { session: fork }), 1, "a fork carries the state");
    assert.equal(await agent.commands.run("bump", {}, { session: fork }), 2);
    assert.equal(await agent.commands.run("bump", {}, { session: fork }), 3);
    assert.equal(await agent.commands.run("get", {}, { session }), 1, "the original keeps its own value");

    // A fresh agent on the same store restores each session's value from its entries.
    const again = await createAgent({ ...config, packages: [counterPackage()] });
    const original = await again.session({ id: "s", leafId: originalLeaf });
    const forked = await again.session({ id: fork.id });
    assert.equal(await again.commands.run("get", {}, { session: original }), 1);
    assert.equal(await again.commands.run("get", {}, { session: forked }), 3);

    // checkout() moves a live session to another leaf of its branch tree and its state follows.
    assert.equal(await agent.commands.run("bump", {}, { session }), 2);
    await session.checkout(originalLeaf);
    assert.equal(await agent.commands.run("get", {}, { session }), 1);
  });

  it("state_rejects_non_json", async () => {
    const store = createMemorySessionStore();
    let om: SessionState<any> | undefined;
    let view: SessionContext | undefined;
    const raw = pkg(
      "@acme/raw",
      ({ state, commands }) => {
        om = state.session<JsonValue>("k", { n: 0 });
        commands.register({ name: "grab", description: "keeps the session view", run: (_args, ctx) => void (view = ctx.session) });
      },
      { capabilities: ["session-state"] },
    );
    const agent = await createAgent({ model: MODEL, provider, packages: [raw], slots: { store } });
    const session = await agent.session({ id: "s", create: true });
    await agent.commands.run("grab", {}, { session });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [() => 1, new Map(), Number.NaN, cycle, { nested: { fn() {} } }]) {
      await rejects(om!.set(view!, value), "state_not_json");
    }
    assert.equal((await store.list("s")).filter((entry) => entry.kind === "package_state").length, 0, "nothing was persisted");
    // A non-JSON initial value fails the load.
    await rejects(
      createAgent({
        model: MODEL,
        provider,
        packages: [pkg("@acme/bad", ({ state }) => void state.session("k", (() => 1) as never), { capabilities: ["session-state"] })],
      }),
      "state_not_json",
    );
  });

  it("state_requires_hydration_and_rejects_oversize", async () => {
    let handle: SessionState<any> | undefined;
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      provider,
      packages: [counterPackage({ onState: (om) => (handle = om) })],
      slots: { store },
    });
    const session = await agent.session({ id: "s", create: true });
    // A view the session handed out, read before the session read its branch.
    let view: SessionContext | undefined;
    const spy = pkg("@acme/spy", ({ hooks }) => hooks.on("run.started", (_event, ctx) => void (view = ctx.session)));
    const early = await createAgent({ model: MODEL, provider, packages: [counterPackage({ onState: (om) => (handle = om) }), spy] });
    const earlySession = await early.session();
    await earlySession.run("hi");
    assert.ok(view, "a hook saw a session view");
    assert.deepEqual(handle!.get(view!), { n: 0 }, "after a run the session has read its branch");

    // `agent.session()` and `session.fork()` resolve hydrated, so no public session can answer
    // `initial` before it has read its branch; `state_not_ready` guards only internal construction.
    await rejects(agent.commands.run("set", { value: { big: "x".repeat(65 * 1024) } }, { session }), "state_too_large");
    assert.equal((await store.list("s")).filter((entry) => entry.kind === "package_state").length, 0);
    await agent.commands.run("set", { value: { big: "x".repeat(60 * 1024) } }, { session });
  });

  it("state_is_redacted_before_persistence", async () => {
    const store = createMemorySessionStore();
    const redactor = createSecretRedactor([SECRET]);
    // During a run: a hook writes state while the run's redactor is active.
    const writer = pkg(
      "@acme/writer",
      ({ state, hooks }) => {
        const keep = state.session<JsonValue>("keep", "");
        hooks.on("turn.completed", async (_event, ctx) => void (await keep.set(ctx.session!, `token ${SECRET}`)));
      },
      { capabilities: ["session-state"] },
    );
    const agent = await createAgent({ model: MODEL, provider, packages: [counterPackage(), writer], redactor, slots: { store } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("hi");
    // Between runs: a command writes state with no run active.
    await agent.commands.run("set", { value: { secret: SECRET } }, { session });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const persisted = (await store.list("s")).filter((entry) => entry.kind === "package_state");
    assert.ok(persisted.length >= 2, `expected state entries, got ${persisted.length}`);
    assert.equal(JSON.stringify(persisted).includes(SECRET), false, "no persisted state holds the secret");
    assert.equal(JSON.stringify(await store.list("s")).includes(SECRET), false);
  });

  it("package_state_does_not_enter_the_message_view", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({ model: MODEL, provider, packages: [counterPackage()], slots: { store } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("hello");
    const before = rebuildSessionContext(await store.list("s"), {}).messages;
    await agent.commands.run("bump", {}, { session });
    await agent.commands.run("bump", {}, { session });
    const entries = await store.list("s");
    assert.equal(entries.filter((entry) => entry.kind === "package_state").length, 2);
    assert.deepEqual(rebuildSessionContext(entries, {}).messages, before, "state entries add no message");
    // The branch stays linear: state entries chain onto the tip.
    for (const [index, entry] of entries.entries()) if (index > 0) assert.equal(entry.parentId, entries[index - 1]!.id);
  });

  it("state_write_racing_a_run_append_keeps_one_branch", async () => {
    const inner = createMemorySessionStore();
    // A slow store keeps appends in flight, so an unserialized write would start from a stale tip.
    const store: SessionStore = {
      ...inner,
      list: (id) => inner.list(id),
      append: async (entry, options) => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return inner.append(entry, options);
      },
    };
    // The observer's write starts while the run is still appending its own entries.
    const racer = pkg(
      "@acme/racer",
      ({ state, hooks }) => {
        const mark = state.session<JsonValue>("mark", 0);
        hooks.on("message.completed", (_event, ctx) => void mark.set(ctx.session!, 1).catch(() => undefined));
      },
      { capabilities: ["session-state"] },
    );
    const agent = await createAgent({ model: MODEL, provider, packages: [racer], slots: { store } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("one");
    await session.run("two");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const entries = await store.list("s");
    const children = new Map<string | undefined, number>();
    for (const entry of entries) children.set(entry.parentId, (children.get(entry.parentId) ?? 0) + 1);
    assert.deepEqual(
      [...children.values()].filter((count) => count > 1),
      [],
      "no entry has two children: nothing was orphaned",
    );
    assert.equal(entries.filter((entry) => entry.kind === "message").length, 4);
  });

  it("session_state_needs_its_capability", async () => {
    const undeclared = pkg("@acme/nope", ({ state }) => void state.session("k", 1));
    const error = await rejects(createAgent({ model: MODEL, provider, packages: [undeclared] }), "capability_missing");
    assert.match(error.message, /state\.session/);
    assert.equal(error.package, "@acme/nope");
  });

  it("agent_state_is_process_memory_and_reset_on_dispose", async () => {
    let handle: { get(): number; set(value: number): void } | undefined;
    const agent = await createAgent({
      model: MODEL,
      provider,
      packages: [pkg("@acme/mem", ({ state }) => void (handle = state.agent("hits", 0)))],
    });
    handle!.set(5);
    assert.equal(handle!.get(), 5);
    await agent.dispose();
    assert.equal(handle!.get(), 0, "cleared on dispose");
    await rejects(
      createAgent({
        model: MODEL,
        provider,
        packages: [
          pkg("@acme/dup", ({ state }) => {
            state.agent("k", 1);
            state.agent("k", 2);
          }),
        ],
      }),
      "setup_failed",
    );
  });
});

describe("session lifecycle events", () => {
  const observer = (events: string[]) =>
    pkg("@acme/watch", ({ hooks }) => {
      for (const name of [
        "session.opened",
        "session.closed",
        "background.started",
        "background.completed",
        "background.failed",
        "package.status",
      ] as const) {
        hooks.on(name, (event: AgentEvent) => void events.push(`${event.type}${"restored" in event ? `:${event.restored}` : ""}`));
      }
    });

  it("session_opened_and_closed_fire_as_observe_hooks", async () => {
    const custom: LoopStrategy = {
      name: "one",
      revision: "1",
      async run(run) {
        const turn = await run.turn();
        if (turn.stopped) return;
        await run.end();
      },
    };
    for (const loop of [undefined, custom]) {
      const events: string[] = [];
      const packages = [
        observer(events),
        ...(loop ? [pkg("@acme/loop", ({ slots }) => slots.loop.provide(loop), { capabilities: ["slot:loop"] })] : []),
      ];
      const store = createMemorySessionStore();
      const agent = await createAgent({ model: MODEL, provider, packages, slots: { store } });
      const session = await agent.session({ id: "s", create: true });
      const streamed: string[] = [];
      for await (const event of session.stream("hi")) streamed.push(event.type);
      assert.equal(streamed[0], "run.started", "session events do not reach a run's stream");
      await session.close();
      assert.deepEqual(events, ["session.opened:false", "session.closed"], loop ? "custom loop" : "default loop");

      // Reopening a session that has history reports `restored`.
      events.length = 0;
      const reopened = await agent.session({ id: "s", leafId: session.leafId });
      await reopened.close();
      assert.deepEqual(events, ["session.opened:true", "session.closed"]);
    }
  });

  it("package_status_fires_on_every_note", async () => {
    const events: AgentEvent[] = [];
    const first = pkg("@acme/first", ({ hooks }) => hooks.on("package.status", (event: AgentEvent) => void events.push(event)));
    const second = pkg("@acme/second", ({ status }) => {
      status.note("info", `connected with ${SECRET}`);
      status.note("warn", "degraded");
    });
    const agent = await createAgent({ model: MODEL, provider, packages: [first, second], redactor: createSecretRedactor([SECRET]) });
    const notes = events.flatMap((event) => (event.type === "package.status" ? [event] : []));
    assert.deepEqual(
      notes.map(({ package: owner, level }) => [owner, level]),
      [
        ["@acme/second", "info"],
        ["@acme/second", "warn"],
      ],
    );
    assert.equal(notes[1]!.message, "degraded");
    assert.equal(notes[0]!.sessionId, "", "agent-scoped");
    assert.equal(JSON.stringify(events).includes(SECRET), false, "redacted outside a run");
    assert.equal(agentRuntime(agent).packages.statusNotes().length, 2);
  });

  it("session_pack_hooks_removed_on_close", async () => {
    const agent = await createAgent({ model: MODEL, provider });
    const bus = agentRuntime(agent).hooks;
    const sessionHooks = () => bus.registrations().filter((registration) => registration.id.includes("#session-"));
    const before = sessionHooks().length;
    const a = await agent.session();
    const b = await agent.session();
    assert.equal(sessionHooks().length, before + 4);
    await a.close();
    assert.equal(sessionHooks().length, before + 2, "closing one session removes only its own pair");
    await a.close();
    await b.close();
    assert.equal(sessionHooks().length, before);
  });
});

describe("background tasks", () => {
  it("close_settles_background_within_bound_then_aborts", async () => {
    const events: AgentEvent[] = [];
    let hungSignal: AbortSignal | undefined;
    let ignoredSignal: AbortSignal | undefined;
    const runner = pkg(
      "@acme/bg",
      ({ hooks, commands }) => {
        for (const name of ["background.started", "background.completed", "background.failed"] as const) {
          hooks.on(name, (event: AgentEvent) => void events.push(event));
        }
        commands.register({
          name: "start",
          description: "starts tasks",
          run: (_args, ctx) => {
            ctx.session!.background("fast", async () => "done");
            ctx.session!.background("hangs", (signal) => {
              hungSignal = signal;
              return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted by close"))));
            });
            ctx.session!.background("ignores", (signal) => {
              ignoredSignal = signal;
              return new Promise(() => {});
            });
            ctx.session!.background("breaks", async () => {
              throw new Error(`failed with ${SECRET}`);
            });
          },
        });
      },
      { capabilities: ["background"] },
    );
    const agent = await createAgent({
      model: MODEL,
      provider,
      packages: [runner],
      limits: { backgroundSettleMs: 40 },
      redactor: createSecretRedactor([SECRET]),
    });
    const session = await agent.session();
    await agent.commands.run("start", {}, { session });
    const startedAt = performance.now();
    await session.close();
    const waited = performance.now() - startedAt;
    assert.ok(waited >= 35 && waited < 1000, `close waited the bound, not forever (${Math.round(waited)}ms)`);

    const byName = (type: string, name: string) => events.filter((event) => event.type === type && "name" in event && event.name === name);
    assert.equal(events.filter((event) => event.type === "background.started").length, 4);
    assert.equal(byName("background.completed", "fast").length, 1);
    for (const name of ["hangs", "ignores"]) {
      const failed = byName("background.failed", name);
      assert.equal(failed.length, 1, `${name} is reported once`);
      assert.equal((failed[0] as { reason: string }).reason, "aborted");
      assert.equal((failed[0] as { error?: unknown }).error, undefined, "an abort carries no task data");
    }
    assert.equal(hungSignal?.aborted, true, "the task's signal aborted");
    assert.equal(ignoredSignal?.aborted, true);
    const broken = byName("background.failed", "breaks")[0] as { reason: string; error: { message: string }; package?: string };
    assert.equal(broken.reason, "error");
    assert.equal(broken.package, "@acme/bg");
    assert.equal(JSON.stringify(events).includes(SECRET), false, "task errors are redacted");

    // A closed session takes no new work.
    await assert.rejects(agent.commands.run("start", {}, { session }), /closing/);
  });

  it("close_returns_at_once_when_nothing_runs_and_a_zero_bound_aborts_immediately", async () => {
    const agent = await createAgent({
      model: MODEL,
      provider,
      packages: [
        pkg(
          "@acme/slow",
          ({ commands }) =>
            commands.register({
              name: "go",
              description: "x",
              run: (_args, ctx) =>
                ctx.session!.background(
                  "slow",
                  (signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("x")))),
                ),
            }),
          { capabilities: ["background"] },
        ),
      ],
      limits: { backgroundSettleMs: 0 },
    });
    const idle = await agent.session();
    await idle.close();
    const busy = await agent.session();
    await agent.commands.run("go", {}, { session: busy });
    const startedAt = performance.now();
    await busy.close();
    assert.ok(performance.now() - startedAt < 200);
    const bad = await createAgent({ model: MODEL, provider, limits: { backgroundSettleMs: -1 } });
    await assert.rejects((await bad.session({ id: "x", create: true })).close(), /backgroundSettleMs/);
  });
});

describe("package_state in every store", () => {
  it("stores_round_trip_package_state", async () => {
    await assertSessionStoreConforms(createMemorySessionStore(), { exerciseReadBranchPath: true });
    const dir = await mkdtemp(join(tmpdir(), "prism-state-"));
    await assertSessionStoreConforms(createJsonlSessionStore(join(dir, "sessions.jsonl")));
  });
});
