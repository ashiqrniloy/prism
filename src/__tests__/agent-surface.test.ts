import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type AgentEvent, type ModelProvider, createAgent, createMemorySessionStore, createSecretRedactor, definePackage, isUnsupportedStoreCapability, type ModelConfig, type PackageDefinitionInput, providerDone, providerTextDelta, SessionNotFoundError, type SessionStore, type Skill, type ToolDefinition, UnsupportedStoreCapabilityError } from "../index.js";
import { mockProvider, createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const SECRET = "sk-agent-surface-0123456789";

type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"] = () => {}, extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", setup, ...extra });

const provider = (): ModelProvider => createMockProvider([providerTextDelta("ok"), providerDone()]);
const tool = (name: string, extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name,
  description: `${name} tool`,
  parameters: {},
  execute: (_args, context) => ({ toolCallId: context.toolCallId, name, value: "ran" }),
  ...extra,
});
const skill = (name: string): Skill => ({ name, description: `${name} skill`, instructions: `${name} instructions` });

/** A store with only the baseline contract (`append` and `list`): no listing, deleting, or searching. */
function bareStore(): SessionStore {
  const inner = createMemorySessionStore();
  return { append: inner.append.bind(inner), list: inner.list.bind(inner) };
}

describe("agent.sessions", () => {
  it("sessions_list_get_delete_search_on_memory_store", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [mockProvider([[providerTextDelta("hello there"), providerDone()]])],
      slots: { store },
    });
    const a = await agent.session({ id: "a", create: true });
    await a.run("find the needle");
    await (await agent.session({ id: "b", create: true })).run("another one");

    const page = await agent.sessions.list();
    assert.deepEqual(page.items.map((item) => item.sessionId).sort(), ["a", "b"]);
    const summaryA = page.items.find((item) => item.sessionId === "a");
    assert.equal(summaryA?.messageCount, 2);
    assert.ok(summaryA?.leafId && summaryA.updatedAt && summaryA.createdAt);
    assert.equal(JSON.stringify(summaryA).includes("needle"), false, "a listing never carries the transcript");

    const first = await agent.sessions.list({ limit: 1 });
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor, "a short page hands back a cursor");
    const second = await agent.sessions.list({ limit: 1, cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.notEqual(second.items[0]?.sessionId, first.items[0]?.sessionId);
    assert.equal(second.nextCursor, undefined);

    assert.equal((await agent.sessions.get("a"))?.messageCount, 2);
    assert.equal(await agent.sessions.get("nope"), undefined);

    const hits = await agent.sessions.search({ query: "needle" });
    assert.deepEqual(
      hits.items.map((hit) => hit.sessionId),
      ["a"],
    );

    await agent.sessions.delete("a");
    assert.equal(await agent.sessions.get("a"), undefined);
    assert.deepEqual(
      (await agent.sessions.list()).items.map((item) => item.sessionId),
      ["b"],
    );
    await assert.rejects(agent.sessions.delete("a"), SessionNotFoundError);
  });

  it("sessions_capability_missing_fails_closed", async () => {
    const store = bareStore();
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])], slots: { store } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("hi");
    for (const [capability, call] of [
      ["listSessions", () => agent.sessions.list()],
      ["deleteSession", () => agent.sessions.delete("s")],
      ["searchSessions", () => agent.sessions.search({ query: "hi" })],
    ] as const) {
      await assert.rejects(call(), (error: unknown) => {
        assert.ok(error instanceof UnsupportedStoreCapabilityError);
        assert.ok(isUnsupportedStoreCapability(error));
        assert.equal(error.code, "unsupported_store_capability");
        assert.equal(error.capability, capability);
        return true;
      });
    }
    assert.equal((await store.list("s")).length > 0, true, "a refused delete removed nothing");
    // `get` needs only the baseline contract every store has.
    assert.equal((await agent.sessions.get("s"))?.sessionId, "s");
  });

  it("sessions_respect_ownership_scope", async () => {
    const store = createMemorySessionStore();
    const mine = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])], slots: { store }, ownership: { tenantId: "tenant-a" } });
    const theirs = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])], slots: { store }, ownership: { tenantId: "tenant-b" } });
    await (await mine.session({ id: "mine", create: true })).run("private to a");
    await (await theirs.session({ id: "theirs", create: true })).run("private to b");

    assert.deepEqual(
      (await mine.sessions.list()).items.map((item) => item.sessionId),
      ["mine"],
    );
    assert.deepEqual(
      (await theirs.sessions.list()).items.map((item) => item.sessionId),
      ["theirs"],
    );
    // A caller-supplied scope can narrow the agent's, never widen it.
    assert.deepEqual(
      (await mine.sessions.list({ tenantId: "tenant-b" })).items.map((item) => item.sessionId),
      ["mine"],
    );
    assert.equal(await mine.sessions.get("theirs"), undefined);
    assert.deepEqual(
      (await mine.sessions.search({ query: "private", tenantId: "tenant-b" })).items.map((hit) => hit.sessionId),
      ["mine"],
    );
    await assert.rejects(mine.sessions.delete("theirs"), SessionNotFoundError);
    assert.equal((await store.list("theirs")).length > 0, true, "another scope's session survives a delete");
    await mine.sessions.delete("mine");
    assert.equal((await mine.sessions.list()).items.length, 0);
  });
});

describe("agent.commands", () => {
  it("commands_run_with_session_reaches_owning_package_context", async () => {
    const seen: { session?: string } = {};
    const agent = await createAgent({
      model: MODEL,
      packages: [pkg("@acme/cmd", ({ commands }) => {
          commands.register({
            name: "who",
            description: "reports its session",
            run: (_args, ctx) => {
              seen.session = ctx.session?.id;
              return "ok";
            },
          });
        }), providerPackage("test-provider", [provider()])],
    });
    assert.deepEqual(agent.commands.list(), [{ name: "who", description: "reports its session", package: "@acme/cmd" }]);
    const session = await agent.session({ id: "S", create: true });
    assert.equal(await agent.commands.run("who", {}, { session }), "ok");
    assert.equal(seen.session, "S");
  });
});

describe("agent.models", () => {
  const discovering = (id: string, models: readonly ModelConfig[]): ModelProvider => ({
    ...createMockProvider([providerDone()]),
    id,
    models: async () => models,
  });

  it("models_list_and_resolve_over_registered_providers", async () => {
    const alpha = discovering("alpha", [
      { provider: "alpha", model: "a-1", displayName: "Alpha One", limits: { contextWindow: 1000 } },
      {
        provider: "alpha",
        model: "a-2",
        parameters: { baseUrl: "https://internal.example/v1", headers: { authorization: `Bearer ${SECRET}` } },
        compat: { endpoint: SECRET },
        metadata: { token: SECRET },
        baseUrl: "https://tenant:" + SECRET + "@internal.example/v1",
        credential: "env:ALPHA_KEY",
        options: { token: SECRET },
      } as ModelConfig,
    ]);
    const quiet: ModelProvider = {
      id: "quiet",
      async *generate() {
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "quiet", model: "q-1" },
      packages: [
        pkg("@acme/alpha", ({ providers }) => providers.register(alpha)),
        pkg("@acme/quiet", ({ providers }) => providers.register(quiet)),
      ],
      redactor: createSecretRedactor([SECRET]),
    });
    const listed = await agent.models.list();
    assert.deepEqual(
      listed.map((model) => `${model.provider}/${model.model}`),
      ["alpha/a-1", "alpha/a-2", "quiet/q-1"],
      "discovered models first, then the configured one a provider without discovery still serves",
    );
    assert.equal(listed[0]?.displayName, "Alpha One");
    assert.equal(JSON.stringify(listed).includes(SECRET), false, "no secret reaches a listing");
    assert.equal(JSON.stringify(listed).includes("internal.example"), false, "no endpoint reaches a listing");
    assert.ok(Object.isFrozen(listed));
    for (const model of listed) {
      for (const key of ["baseUrl", "credential", "options", "parameters", "compat", "metadata"]) assert.equal(key in model, false, key);
    }

    assert.equal(agent.models.resolve("alpha/a-1").model.model, "a-1", "a string ref resolves");
    const resolved = agent.models.resolve({ provider: "alpha", model: "a-1" });
    assert.equal(resolved.provider, alpha);
    assert.equal(resolved.model.model, "a-1");
  });

  it("models_resolve_unknown_provider_fails_closed", async () => {
    // Only a provider a package registered can serve a model, so an id nothing registered misses.
    const bare = await createAgent({ model: { provider: "ghost", model: "x" }, packages: [] });
    assert.throws(() => bare.models.resolve({ provider: "ghost", model: "x" }), /Unknown provider: ghost/);
    assert.throws(() => bare.models.resolve({ provider: 7 } as never), TypeError);
    // With nothing registered, the list is just the configured model.
    assert.deepEqual(
      (await bare.models.list()).map((model) => model.model),
      ["x"],
    );
  });
});

describe("agent.tools and agent.skills", () => {
  it("agent_tools_and_skills_reflect_disable", async () => {
    const agent = await createAgent({
      model: MODEL,
      tools: { add: [tool("host-keep", { effects: ["read"] }), tool("host-drop")] },
      skills: { add: [skill("host-skill"), skill("host-skill-drop")] },
      packages: [pkg("@acme/tools", ({ tools, skills }) => {
          tools.register(tool("pkg-keep", { effects: ["write", "network"] }));
          tools.register(tool("pkg-drop"));
          skills.register(skill("pkg-skill"));
        }), providerPackage("test-provider", [provider()])],
      disable: { tools: ["host-drop", "pkg-drop"], skills: ["host-skill-drop"] },
    });
    assert.deepEqual(
      agent.tools.map(({ name, package: owner }) => [name, owner]),
      [
        ["host-keep", "host"],
        ["pkg-keep", "@acme/tools"],
      ],
    );
    assert.deepEqual(agent.tools[0]?.effects, ["read"]);
    assert.deepEqual(agent.tools[1]?.effects, ["write", "network"]);
    assert.equal(agent.tools[0]?.description, "host-keep tool");
    assert.deepEqual(
      agent.skills.map(({ name, package: owner }) => [name, owner]),
      [
        ["host-skill", "host"],
        ["pkg-skill", "@acme/tools"],
      ],
    );
    assert.ok(Object.isFrozen(agent.tools) && Object.isFrozen(agent.tools[0]) && Object.isFrozen(agent.skills));
    assert.equal(agent.tools, agent.tools, "computed once, not rebuilt per access");
    // `inspect()` reads the same merged view.
    assert.deepEqual(
      agent.inspect().tools.map((entry) => entry.name),
      agent.tools.map((entry) => entry.name),
    );
    // An unannotated tool can touch anything.
    const open = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])], tools: { add: [tool("open")] } });
    assert.deepEqual(open.tools[0]?.effects, ["read", "write", "execute", "network", "external"]);

    await agent.dispose();
    assert.equal(agent.tools.length, 0, "a disposed agent exposes no tool");
    assert.equal(agent.skills.length, 0);
  });

  it("agent_id_is_configured_or_generated", async () => {
    assert.equal((await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])], id: "named" })).id, "named");
    assert.equal((await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])], name: "label" })).id, "label");
    const a = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])] });
    const b = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])] });
    assert.ok(a.id.length > 0 && a.id !== b.id, "an unnamed agent gets its own generated id");
  });
});

describe("agent.subscribe", () => {
  async function drain(stream: AsyncIterable<AgentEvent>, until: (event: AgentEvent) => boolean): Promise<AgentEvent[]> {
    const seen: AgentEvent[] = [];
    for await (const event of stream) {
      seen.push(event);
      if (until(event)) break;
    }
    return seen;
  }

  it("agent_subscribe_receives_package_status_background_and_session_events", async () => {
    const agent = await createAgent({
      model: MODEL,
      redactor: createSecretRedactor([SECRET]),
      packages: [pkg(
          "@acme/bg",
          ({ commands, status }) => {
            status.note("info", `starting with ${SECRET}`);
            commands.register({
              name: "start",
              description: "starts a task",
              run: (_args, ctx) => {
                ctx.session!.background("fast", async () => "done");
                return "started";
              },
            });
          },
          { capabilities: ["background"] },
        ), providerPackage("test-provider", [provider()])],
    });
    const subscription = agent.subscribe();
    const collected = drain(subscription, (event) => event.type === "session.closed");
    const session = await agent.session({ id: "s", create: true });
    await agent.commands.run("start", {}, { session });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.close();
    const events = await collected;
    const types = events.map((event) => event.type);
    assert.ok(types.includes("session.opened"));
    assert.ok(types.includes("background.started") && types.includes("background.completed"));
    assert.ok(types.includes("session.closed"));
    assert.equal(JSON.stringify(events).includes(SECRET), false, "agent events pass the agent redactor");
    // `package.status` raised during load predates any subscriber; a note raised later reaches it, redacted.
    let note: ((level: "info" | "warn", message: string) => void) | undefined;
    const noisy = await createAgent({
      model: MODEL,
      redactor: createSecretRedactor([SECRET]),
      packages: [pkg("@acme/noisy", ({ status }) => void (note = (level, message) => status.note(level, message))), providerPackage("test-provider", [provider()])],
    });
    const noisyStream = drain(noisy.subscribe(), (event) => event.type === "package.status");
    note?.("warn", `late note ${SECRET}`);
    const noisySeen = await noisyStream;
    const status = noisySeen.at(-1);
    assert.equal(status?.type, "package.status");
    assert.equal(status?.type === "package.status" ? status.package : undefined, "@acme/noisy");
    assert.equal(JSON.stringify(noisySeen).includes(SECRET), false);
    await agent.dispose();
    await noisy.dispose();
  });

  it("agent_subscribe_slow_consumer_never_blocks_a_run", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [mockProvider([[providerTextDelta("ok"), providerDone(), providerTextDelta("ok"), providerDone()]])],
    });
    // Subscribed and never read, with the smallest queue: the run must still finish, and the subscriber closes by policy.
    const stalled = agent.subscribe({ maxQueuedEvents: 1, overflow: "close" })[Symbol.asyncIterator]();
    const started = performance.now();
    for (let index = 0; index < 5; index += 1) {
      const session = await agent.session();
      await session.close();
    }
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.ok(performance.now() - started < 2000, "an unread subscriber adds no wait");
    await assert.rejects(async () => {
      for (;;) {
        const next = await stalled.next();
        if (next.done) return;
      }
    }, /overflow|queue/i);
  });

  it("dispose_ends_agent_subscriptions", async () => {
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider()])] });
    const iterator = agent.subscribe()[Symbol.asyncIterator]();
    const pending = iterator.next();
    await agent.dispose();
    assert.equal((await pending).done, true);
  });
});
