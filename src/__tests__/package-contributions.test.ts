import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgentWith } from "../agent-session/create-agent.js";
import { agentFingerprint } from "../agent-run-state.js";
import { activeTools } from "../agent-tool-dispatch.js";
import {
  type AgentEvent,
  type ModelProvider,
  createAgent,
  createSecretRedactor,
  definePackage,
  type HostUiRequest,
  HARD_MAX_SKILL_INSTRUCTION_BYTES,
  type LoopStrategy,
  type PackageCommand,
  type PackageDefinitionInput,
  PackageLoadError,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type Skill,
  toolCallContent,
  type ToolDefinition,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const SECRET = "sk-live-0123456789abcdef";

type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"] = () => {}, extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra });

const tool = (name: string, onRun?: () => void): ToolDefinition => ({
  name,
  parameters: {},
  execute: (_args, context) => {
    onRun?.();
    return { toolCallId: context.toolCallId, name, value: "ran" };
  },
});

const skill = (name: string): Skill => ({ name, description: name, instructions: `${name} instructions` });

function textProvider(seen: ProviderRequest[] = []): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      seen.push(request);
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

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

describe("package tools", () => {
  it("tool_collision_fails_closed", async () => {
    const a = pkg("@acme/a", ({ tools }) => tools.register(tool("net")));
    const b = pkg("@acme/b", ({ tools }) => tools.register(tool("net")));
    const error = await rejects(
      createAgent({ model: MODEL, packages: [a, b, providerPackage("test-provider", [textProvider()])] }),
      "tool_conflict",
    );
    assert.equal(error.package, "@acme/b");
    assert.match(error.message, /@acme\/a/);
    // Against the host's tools (`tools.add`; the 0.12 registry input no longer exists).
    await rejects(
      createAgent({ model: MODEL, packages: [a, providerPackage("test-provider", [textProvider()])], tools: { add: [tool("net")] } }),
      "tool_conflict",
    );
    // Against the names the kernel generates tools under.
    const shadow = pkg("@acme/shadow", ({ tools }) => tools.register(tool("load_skill")));
    const failure = await rejects(
      createAgent({ model: MODEL, packages: [shadow, providerPackage("test-provider", [textProvider()])] }),
      "tool_conflict",
    );
    assert.match(failure.message, /the kernel/);
    // A failed load leaves no registration behind: the first package was unwound.
    const events: string[] = [];
    const first = pkg("@acme/first", ({ tools, onDispose }) => {
      tools.register(tool("one"));
      onDispose(() => void events.push("first disposed"));
    });
    await rejects(
      createAgent({ model: MODEL, packages: [first, a, b, providerPackage("test-provider", [textProvider()])] }),
      "tool_conflict",
    );
    assert.deepEqual(events, ["first disposed"]);
  });

  it("search_tools_is_a_package_owned_name", async () => {
    // Plan 158 Tasks 7-8: the activation tool belongs to `@arnilo/prism-context-engineering`, and
    // the kernel no longer generates one, so the name carries no reservation.
    const owner = pkg("@acme/search", ({ tools }) => tools.register(tool("search_tools")));
    const agent = await createAgent({ model: MODEL, packages: [owner, providerPackage("test-provider", [textProvider()])] });
    assert.ok(
      agent.inspect().tools.some((entry) => entry.name === "search_tools"),
      "a package may register the name",
    );
    await agent.dispose();
  });

  it("package_tools_reach_every_reader", async () => {
    let ran = 0;
    const adds = pkg("@acme/adds", ({ tools }) => tools.register(tool("added", () => void (ran += 1))));
    const bare = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [textProvider()])] });
    let turn = 0;
    const agent = await createAgent({
      model: MODEL,
      packages: [
        adds,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent("c1", "added", {}) };
              else yield providerTextDelta("done");
              yield providerDone();
            },
          },
        ]),
      ],
    });
    // The shared reader behind dispatch, approval, and the assembler.
    assert.deepEqual(
      activeTools(agent).tools.map((t) => t.name),
      ["added"],
    );
    assert.ok(activeTools(agent).registry.get("added"));
    assert.notEqual(agentFingerprint(agent, "r1"), agentFingerprint(bare, "r1"));
    // And dispatch runs it.
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(ran, 1);
    // `agent.config` stays the host's input: nothing was written into it.
    assert.equal(agent.config.tools, undefined);
  });

  it("package_tool_unwinds_with_its_package", async () => {
    const adds = pkg("@acme/adds", ({ tools, skills, commands }) => {
      tools.register(tool("added"));
      skills.register(skill("s1"));
      commands.register({ name: "c1", description: "c", run: () => 1 });
    });
    const agent = await createAgent({ model: MODEL, packages: [adds, providerPackage("test-provider", [textProvider()])] });
    assert.equal(activeTools(agent).tools.length, 1);
    assert.equal(agent.commands.list().length, 1);
    await agent.dispose();
    assert.equal(activeTools(agent).tools.length, 0, "no tool survives dispose");
    assert.equal(agent.commands.list().length, 0, "no command survives dispose");
    await agent.dispose();
  });

  it("when_hides_tool_per_session", async () => {
    const gated = pkg("@acme/gated", ({ tools }) => tools.register(tool("gated"), { when: (session) => session.id === "A" }));
    const scenario = async (loop?: LoopStrategy) => {
      const advertised: Record<string, readonly string[]> = {};
      const executed: string[] = [];
      let current = "";
      const provider: ModelProvider = {
        id: "mock",
        async *generate(request) {
          advertised[current] = (request.tools ?? []).map((t) => t.name);
          if (!request.messages.some((m) => m.role === "tool")) {
            yield { type: "tool_call" as const, call: toolCallContent(`c-${current}`, "gated", {}) };
          } else yield providerTextDelta("done");
          yield providerDone();
        },
      };
      const owner = loop ? pkg("@acme/loop", ({ slots }) => slots.loop.provide(loop), { capabilities: ["slot:loop"] }) : undefined;
      const wired = pkg("@acme/exec", ({ tools }) =>
        tools.register(
          tool("gated", () => void executed.push(current)),
          { when: (session) => session.id === "A" },
        ),
      );
      const agent = await createAgent({
        model: MODEL,
        packages: [...(owner ? [owner, wired] : [wired]), providerPackage("test-provider", [provider])],
      });
      current = "A";
      await (await agent.session({ id: "A", create: true })).run("go");
      current = "B";
      await (await agent.session({ id: "B", create: true })).run("go");
      return { advertised, executed };
    };
    // Default loop.
    const byDefault = await scenario();
    assert.deepEqual(byDefault.advertised.A, ["gated"]);
    assert.deepEqual(byDefault.advertised.B, [], "hidden in session B");
    assert.deepEqual(byDefault.executed, ["A"], "and uncallable there");
    // A custom loop goes through the same RunController primitives.
    const custom: LoopStrategy = {
      name: "one-round",
      revision: "1",
      async run(run) {
        const turn = await run.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
        const last = await run.turn();
        if (last.stopped) return;
        await run.end();
      },
    };
    const viaLoop = await scenario(custom);
    assert.deepEqual(viaLoop.advertised.A, ["gated"]);
    assert.deepEqual(viaLoop.advertised.B, []);
    assert.deepEqual(viaLoop.executed, ["A"]);
    // The unused package above only proves the registration path; a throwing predicate hides the tool too.
    const throwing = pkg("@acme/throws", ({ tools }) =>
      tools.register(tool("risky"), {
        when: () => {
          throw new Error("boom");
        },
      }),
    );
    const seen: ProviderRequest[] = [];
    const agent = await createAgent({ model: MODEL, packages: [throwing, gated, providerPackage("test-provider", [textProvider(seen)])] });
    await (await agent.session({ id: "A", create: true })).run("hi");
    assert.deepEqual(
      (seen[0]?.tools ?? []).map((t) => t.name),
      ["gated"],
      "the throwing predicate fails closed",
    );
  });

  it("package_tool_context_carries_an_owner_bound_session", async () => {
    let outcome: unknown;
    const owner = pkg("@acme/bg", ({ tools }) =>
      tools.register({
        name: "bg",
        parameters: {},
        execute: (_args, context) => {
          try {
            context.session?.background("job", async () => {});
            outcome = "started";
          } catch (error) {
            outcome = error instanceof PackageLoadError ? error.code : String(error);
          }
          return { toolCallId: context.toolCallId, name: "bg", value: 1 };
        },
      }),
    );
    let turn = 0;
    const agent = await createAgent({
      model: MODEL,
      packages: [
        owner,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent("c", "bg", {}) };
              else yield providerTextDelta("done");
              yield providerDone();
            },
          },
        ]),
      ],
    });
    await (await agent.session()).run("go");
    assert.equal(outcome, "capability_missing", "the package tool's session is bound to a package without `background`");
  });
});

describe("package skills and providers", () => {
  it("skill_and_provider_conflicts_fail_closed", async () => {
    const one = pkg("@acme/one", ({ skills, providers }) => {
      skills.register(skill("review"));
      providers.register({ id: "p", async *generate() {} });
    });
    // A different body under a taken name is a conflict; an identical registration is a no-op.
    const twoSkill = pkg("@acme/two", ({ skills }) => skills.register({ ...skill("review"), instructions: "another review" }));
    const twoProvider = pkg("@acme/three", ({ providers }) => providers.register({ id: "p", async *generate() {} }));
    const config = { model: MODEL };
    assert.equal((await rejects(createAgent({ ...config, packages: [one, twoSkill] }), "skill_conflict")).package, "@acme/two");
    assert.equal((await rejects(createAgent({ ...config, packages: [one, twoProvider] }), "provider_conflict")).package, "@acme/three");
    await rejects(createAgent({ ...config, packages: [one], skills: { add: [{ ...skill("review"), instructions: "another review" }] } }), "skill_conflict");
  });

  it("identical_skill_reregistration_is_noop", async () => {
    // Two packages discovering the same `SKILL.md` (a child inheriting both, or context-files plus a
    // host `skills.dirs`) register one skill. Same name with a different body is still a conflict.
    const shared: Skill = { name: "review", description: "Review.", instructions: "Review the diff.", path: "/repo/.agents/skills/review/SKILL.md" };
    const one = pkg("@acme/one", ({ skills }) => skills.register(shared));
    const two = pkg("@acme/two", ({ skills }) => skills.register({ ...shared }));
    const agent = await createAgent({ model: MODEL, packages: [one, two], skills: { add: [{ ...shared }] } });
    assert.deepEqual((agent.skills as readonly { name: string }[]).filter((entry) => entry.name === "review").length, 1);
    await agent.dispose();
    const differentBody = pkg("@acme/three", ({ skills }) => skills.register({ ...shared, instructions: "Something else." }));
    await rejects(createAgent({ model: MODEL, packages: [one, differentBody] }), "skill_conflict");
    const differentPath = pkg("@acme/four", ({ skills }) => skills.register({ ...shared, path: "/elsewhere/SKILL.md" }));
    await rejects(createAgent({ model: MODEL, packages: [one, differentPath] }), "skill_conflict");
  });

  it("oversized_skill_body_is_skill_too_large_for_register_and_add", async () => {
    const big: Skill = {
      name: "big",
      description: "Too large.",
      instructions: "SENSITIVE_BODY".repeat(Math.ceil((HARD_MAX_SKILL_INSTRUCTION_BYTES + 1) / 14)),
    };
    const registers = pkg("@acme/big", ({ skills }) => skills.register(big));
    const registerError = await rejects(createAgent({ model: MODEL, packages: [registers] }), "skill_too_large");
    assert.match(registerError.message, /big/);
    assert.match(registerError.message, new RegExp(String(HARD_MAX_SKILL_INSTRUCTION_BYTES)));
    assert.ok(!registerError.message.includes("SENSITIVE_BODY"), "the body is never echoed");

    const adds = pkg("@acme/big-dir", ({ skills }) => skills.addDir("/skills/big"));
    const addError = await rejects(
      createAgentWith({ model: MODEL, packages: [adds] }, { readSkillDir: async () => [big] }),
      "skill_too_large",
    );
    assert.ok(!addError.message.includes("SENSITIVE_BODY"), "the add path never echoes the body");
  });

  it("disable_skills_removes_package_and_host_skills", async () => {
    const adds = pkg("@acme/skills", ({ skills }) => {
      skills.register(skill("pkg-skill"));
      skills.register(skill("other"));
    });
    const agent = await createAgent({
      model: MODEL,
      packages: [adds, providerPackage("test-provider", [textProvider()])],
      skills: { add: [skill("host-skill")] },
      disable: { skills: ["pkg-skill", "host-skill"] },
    });
    const names = agent.inspect().skills.map((s) => s.name);
    assert.deepEqual(names, ["other"]);
    // A host registry is never mutated.
    let unregistered = 0;
    const hostRegistry = {
      register() {},
      get: () => undefined,
      resolve: () => skill("h"),
      list: () => [skill("h")],
      unregister: () => {
        unregistered += 1;
        return true;
      },
    };
    const withRegistry = await createAgent({
      model: MODEL,
      packages: [adds, providerPackage("test-provider", [textProvider()])],
      skills: { add: hostRegistry.list() },
      disable: { skills: ["h", "pkg-skill"] },
    });
    assert.deepEqual(
      withRegistry.inspect().skills.map((s) => s.name),
      ["other"],
    );
    assert.equal(unregistered, 0);
  });

  it("skills_addDir_reads_after_setup_through_the_injected_reader", async () => {
    const reads: string[] = [];
    const dirs = pkg("@acme/dirs", ({ skills }) => {
      skills.addDir("/skills/a");
      assert.equal(reads.length, 0, "recorded during setup, read after it returns");
    });
    const agent = await createAgentWith(
      { model: MODEL, packages: [providerPackage("test-provider", [textProvider()]), dirs] },
      {
        readSkillDir: async (path) => {
          reads.push(path);
          return [skill("from-dir")];
        },
      },
    );
    assert.deepEqual(reads, ["/skills/a"]);
    assert.deepEqual(
      agent.inspect().skills.map((s) => s.name),
      ["from-dir"],
    );
    // A read failure fails this package's setup, and an optional one is skipped with a note.
    const failing = {
      readSkillDir: async () => {
        throw new Error(`cannot read ${SECRET}`);
      },
    };
    const error = await rejects(
      createAgentWith(
        { model: MODEL, packages: [providerPackage("test-provider", [textProvider()]), dirs], redactor: createSecretRedactor([SECRET]) },
        failing,
      ),
      "setup_failed",
    );
    assert.equal(error.message.includes(SECRET), false);
    await createAgentWith(
      { model: MODEL, packages: [providerPackage("test-provider", [textProvider()]), dirs({}, { optional: true })] },
      failing,
    );
  });

  it("package_provider_serves_runs_and_models_client", async () => {
    const calls: string[] = [];
    const served: ModelProvider = {
      id: "served",
      async *generate(request) {
        calls.push(request.model.provider);
        yield providerTextDelta("from package");
        yield providerDone();
      },
    };
    let client: { generate(request: { messages: never[] }): AsyncIterable<{ type: string }> } | undefined;
    const owner = pkg(
      "@acme/provider",
      ({ providers, models }) => {
        providers.register(served);
        client = models.client({ provider: "served", model: "m" }) as never;
      },
      { capabilities: ["models"] },
    );
    const agent = await createAgent({ model: { provider: "served", model: "m" }, packages: [owner] });
    const result = await (await agent.session()).run("hi");
    assert.equal(result.status, "completed");
    assert.deepEqual(calls, ["served"]);
    const types: string[] = [];
    for await (const event of client!.generate({ messages: [] })) types.push(event.type);
    assert.ok(types.includes("text_delta") || types.length > 0);
    assert.deepEqual(calls, ["served", "served"]);
    // A direct `AgentConfig.provider` of another id no longer shadows the run's model (plan 151 Task 3).
    const direct = await createAgent({
      model: { provider: "served", model: "m" },
      packages: [pkg("@acme/p2", ({ providers }) => providers.register(served)), providerPackage("test-provider", [textProvider()])],
    });
    await (await direct.session()).run("hi");
    assert.deepEqual(calls, ["served", "served", "served"], "the model's provider answered, not the fixed one");
    // Without the capability the call fails closed.
    const denied = pkg("@acme/nocap", ({ models }) => void models.client());
    await rejects(
      createAgent({ model: MODEL, packages: [denied, providerPackage("test-provider", [textProvider()])] }),
      "capability_missing",
    );
  });
});

describe("package commands", () => {
  it("command_args_validated_and_ctx_wired", async () => {
    const runs: unknown[] = [];
    const asks: HostUiRequest[] = [];
    const command: PackageCommand = {
      name: "greet",
      description: "Greets",
      args: { type: "object", properties: { who: { type: "string" } }, required: ["who"] },
      async run(args, ctx) {
        runs.push(args);
        const answer = await ctx.host.ui?.request({ kind: "confirm", title: "sure?", package: "spoof", sessionId: "spoof" } as never);
        return { greeted: args.who, session: ctx.session?.id, answer, sameAgent: typeof ctx.agent.session };
      },
    };
    const withUi = pkg("@acme/cmd", ({ commands }) => commands.register(command), { capabilities: ["host-ui"] });
    const withoutUi = pkg("@acme/cmd2", ({ commands }) =>
      commands.register({ name: "ui", description: "needs ui", run: (_a, ctx) => ctx.host.ui?.request({ kind: "confirm", title: "x" }) }),
    );
    const agent = await createAgent({
      model: MODEL,
      packages: [withUi, withoutUi, providerPackage("test-provider", [textProvider()])],
      host: {
        ui: {
          request: async (request) => {
            asks.push(request);
            return { status: "answered", value: true } as never;
          },
        },
      },
    });
    assert.deepEqual(agent.commands.list(), [
      { name: "greet", description: "Greets", package: "@acme/cmd" },
      { name: "ui", description: "needs ui", package: "@acme/cmd2" },
    ]);
    const session = await agent.session({ id: "S", create: true });
    const out = (await agent.commands.run("greet", { who: "ada" }, { session })) as { greeted: string; session: string };
    assert.equal(out.greeted, "ada");
    assert.equal(out.session, "S", "ctx.session is the live session as the owning package sees it");
    assert.equal(asks[0]?.package, "@acme/cmd", "the kernel stamps the package");
    assert.equal(asks[0]?.sessionId, "S", "and the session, over whatever the package passed");
    // Invalid arguments fail before `run`, naming the path and never echoing the value.
    runs.length = 0;
    for (const bad of [{}, { who: 1 }, { who: "x", extra: true }] as const) {
      const error = await rejects(agent.commands.run("greet", bad as never), "command_args_invalid");
      assert.equal(error.package, "@acme/cmd");
    }
    const leak = await rejects(agent.commands.run("greet", { who: 1, token: SECRET } as never), "command_args_invalid");
    assert.equal(JSON.stringify(leak).includes(SECRET), false);
    assert.equal(runs.length, 0);
    // Unknown names, and the capability check on ctx.host.
    await rejects(agent.commands.run("missing"), "unknown_command");
    await rejects(agent.commands.run("ui", {}), "capability_missing");
    // Without a schema, the command takes no arguments.
    await rejects(agent.commands.run("ui", { a: 1 }), "command_args_invalid");
  });

  it("command_collision_fails_closed", async () => {
    const make = (name: string) => pkg(name, ({ commands }) => commands.register({ name: "same", description: "d", run: () => 1 }));
    const error = await rejects(
      createAgent({ model: MODEL, packages: [make("@a/x"), make("@b/y"), providerPackage("test-provider", [textProvider()])] }),
      "command_conflict",
    );
    assert.equal(error.package, "@b/y");
    // A bad schema fails at registration, not on first run.
    const bad = pkg("@acme/bad", ({ commands }) =>
      commands.register({ name: "x", description: "d", args: { $ref: "#" } as never, run: () => 1 }),
    );
    await rejects(
      createAgent({ model: MODEL, packages: [bad, providerPackage("test-provider", [textProvider()])] }),
      "config_schema_unsupported",
    );
    // A malformed command is a setup failure.
    const malformed = pkg("@acme/malformed", ({ commands }) => commands.register({ name: "has space", description: "d", run: () => 1 }));
    await rejects(createAgent({ model: MODEL, packages: [malformed, providerPackage("test-provider", [textProvider()])] }), "setup_failed");
  });
});

describe("services", () => {
  it("services_require_and_conflict", async () => {
    const impl = { n: 1 };
    let late: unknown;
    const agent = await createAgent({
      model: MODEL,
      packages: [
        pkg("@acme/user", ({ services }) => void (late = () => services.require("svc")), { requires: { api: 1, services: ["svc"] } }),
        pkg("@acme/provider", ({ services }) => services.provide("svc", impl)),
        providerPackage("test-provider", [textProvider()]),
      ],
    });
    assert.equal((late as () => unknown)(), impl, "visible to an earlier package at call time");
    await agent.dispose();
    await rejects(
      createAgent({
        model: MODEL,
        packages: [
          pkg("@a/a", ({ services }) => services.provide("x", 1)),
          pkg("@b/b", ({ services }) => services.provide("x", 2)),
          providerPackage("test-provider", [textProvider()]),
        ],
      }),
      "service_conflict",
    );
    await rejects(
      createAgent({
        model: MODEL,
        packages: [
          pkg("@a/a", () => {}, { requires: { api: 1, services: ["absent"] } }),
          providerPackage("test-provider", [textProvider()]),
        ],
      }),
      "missing_service",
    );
  });
});

describe("disable", () => {
  it("disable_removes_by_id_and_rejects_unknown_ids", async () => {
    const fired: string[] = [];
    const adds = pkg("@acme/audit", ({ hooks, tools, commands }) => {
      hooks.on("turn.before", () => void fired.push("package hook"));
      hooks.on("tool.call", () => undefined, { id: "gate" });
      tools.register(tool("shell"));
      tools.register(tool("keep"));
      commands.register({ name: "off", description: "d", run: () => 1 });
      commands.register({ name: "on", description: "d", run: () => 1 });
    });
    const base = {
      model: MODEL,
      packages: [adds, providerPackage("test-provider", [textProvider()])],
      tools: { add: [tool("host-tool"), tool("host-keep")] },
    };
    const agent = await createAgent({
      ...base,
      disable: {
        tools: ["shell", "host-tool"],
        hooks: ["@acme/audit:turn.before", "@acme/audit:tool.call#gate"],
        commands: ["off"],
      },
    });
    assert.deepEqual(
      activeTools(agent)
        .tools.map((t) => t.name)
        .sort(),
      ["host-keep", "keep"],
      "package and host tools are gone, the others stay",
    );
    assert.deepEqual(
      agent.commands.list().map((c) => c.name),
      ["on"],
    );
    assert.equal(
      (await import("../agent-session/create-agent.js"))
        .agentRuntime(agent)
        .hooks.registrations()
        .filter((entry) => entry.owner !== "kernel").length,
      0,
      "a disabled hook is not registered at all",
    );
    await (await agent.session()).run("go");
    assert.deepEqual(fired, [], "a disabled hook never fires");
    // The host's own tool array is untouched.
    assert.equal(agent.config.tools?.add?.length, 2);
    // Every kind rejects an id nothing carries, and the message holds no more than a bounded id.
    for (const [kind, ids] of [
      ["tools", ["nope"]],
      ["hooks", ["@acme/audit:nope"]],
      ["commands", ["nope"]],
      ["skills", ["nope"]],
    ] as const) {
      const error = await rejects(createAgent({ ...base, disable: { [kind]: ids } }), "unknown_disable_id");
      assert.match(error.message, new RegExp(`disable\\.${kind}`));
    }
    const long = "x".repeat(500);
    const error = await rejects(createAgent({ ...base, disable: { tools: [long] } }), "unknown_disable_id");
    assert.ok(error.message.length < 200);
    // A failed disable unwinds the packages that loaded.
    const log: string[] = [];
    const tracked = pkg("@acme/tracked", ({ onDispose }) => onDispose(() => void log.push("disposed")));
    await rejects(
      createAgent({ model: MODEL, packages: [tracked, providerPackage("test-provider", [textProvider()])], disable: { tools: ["nope"] } }),
      "unknown_disable_id",
    );
    assert.deepEqual(log, ["disposed"]);
  });

  it("disable_runs_after_setup_so_a_package_cannot_re_add", async () => {
    const adds = pkg("@acme/adds", ({ tools }) => tools.register(tool("shell")));
    const agent = await createAgent({
      model: MODEL,
      packages: [adds, providerPackage("test-provider", [textProvider()])],
      disable: { tools: ["shell"] },
    });
    assert.equal(activeTools(agent).tools.length, 0);
    assert.equal(activeTools(agent).registry.get("shell"), undefined);
  });
});

describe("credentials", () => {
  it("credentials_never_surface", async () => {
    const events: AgentEvent[] = [];
    const logs: unknown[] = [];
    let resolved: unknown;
    let spoken = false;
    const owner = pkg(
      "@acme/creds",
      async ({ credentials, events: out, status, log, hooks }) => {
        resolved = await credentials.resolve("env:ACME_KEY");
        out.emit("ready", { key: (resolved as { value: string }).value });
        status.note("info", `using ${(resolved as { value: string }).value}`);
        log.info(`key ${(resolved as { value: string }).value}`);
        hooks.on("package.event", (event) => void events.push(event));
        spoken = true;
      },
      { capabilities: ["credentials"] },
    );
    process.env.ACME_KEY = SECRET;
    try {
      const agent = await createAgent({
        model: MODEL,
        packages: [owner, providerPackage("test-provider", [textProvider()])],
        host: { log: { debug() {}, error() {}, warn() {}, info: (message, data) => void logs.push([message, data]) } },
      });
      assert.ok(spoken);
      assert.equal((resolved as { value: string }).value, SECRET, "the package itself receives the value");
      const runtime = await (await import("../agent-session/create-agent.js")).agentRuntime(agent);
      // Later events, notes, and logs are redacted, and so is a hook error raised by a throwing handler.
      const late = pkg("@acme/late", ({ hooks }) => {
        hooks.on("turn.completed", () => {
          throw new Error(`failed with ${SECRET}`);
        });
      });
      const again = await createAgent({
        model: MODEL,
        packages: [owner, late, providerPackage("test-provider", [textProvider()])],
        host: { log: { debug() {}, error() {}, warn() {}, info: (message, data) => void logs.push([message, data]) } },
      });
      const seen: AgentEvent[] = [];
      const session = await again.session();
      const draining = (async () => {
        for await (const event of session.subscribe()) seen.push(event);
      })();
      await session.run("hi");
      await draining;
      const everything = JSON.stringify([events, logs, runtime.packages.statusNotes(), runtime.packages.packages, seen]);
      assert.equal(everything.includes(SECRET), false, "the resolved value is absent from every surface");
      assert.match(JSON.stringify(logs), /REDACTED/);
      assert.ok(
        seen.some((event) => event.type === "hook.error"),
        "the throwing handler was reported",
      );
      // And a load error that mentions it is redacted.
      const failing = pkg(
        "@acme/fails",
        async ({ credentials }) => {
          const credential = await credentials.resolve("env:ACME_KEY");
          throw new Error(`connect failed: ${credential?.value}`);
        },
        { capabilities: ["credentials"] },
      );
      const error = await rejects(
        createAgent({ model: MODEL, packages: [failing, providerPackage("test-provider", [textProvider()])] }),
        "setup_failed",
      );
      assert.equal(JSON.stringify(error).includes(SECRET), false);
      assert.equal(error.message.includes(SECRET), false);
    } finally {
      delete process.env.ACME_KEY;
    }
  });

  it("credentials_resolve_needs_the_capability", async () => {
    const denied = pkg("@acme/nocap", async ({ credentials }) => void (await credentials.resolve("env:X")));
    await rejects(
      createAgent({ model: MODEL, packages: [denied, providerPackage("test-provider", [textProvider()])] }),
      "capability_missing",
    );
  });
});
