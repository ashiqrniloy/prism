import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, definePackage, type JsonValue, type RunController, type ToolDefinition } from "../../index.js";
import {
  createDriverLoop,
  createProfiles,
  type DriverDescriptor,
  type DriverRequires,
  type DriverRunContext,
  type DriverRuntime,
  defineDriver,
  driverPackage,
} from "../index.js";

const runtime = {
  tools: () => [],
  skills: () => ({ get: () => undefined, list: () => [] }),
  host: {},
  services: { consume: () => undefined },
} as unknown as DriverRuntime;

const descriptor: DriverDescriptor = {
  vendor: "example",
  usesModel: false,
  models: "passthrough",
  controls: {
    systemPrompt: ["append"],
    builtinTools: "partial",
    clientTools: "mcp",
    skills: true,
    subagents: false,
    permissionCallback: true,
    rewrite: false,
    continueOnStop: true,
    steer: "next-turn",
    resume: "store",
    isolation: "flags",
  },
  capture: {
    textDeltas: true,
    thinking: "final",
    skillActivation: "tool",
    toolCalls: true,
    fileDiffs: false,
    subagents: "none",
    usage: "tokens",
  },
  auth: { modes: [{ name: "key", kind: "api-key", deployments: ["local", "hosted"], protected: { paths: [], env: [] } }] },
};

function make(version: string | undefined, ran: string[] = []) {
  return defineDriver<{ binary?: string }>({
    name: "example-driver",
    vendor: "example",
    revision: "1",
    descriptor,
    config: {
      type: "object",
      properties: {
        binary: { type: "string" },
        vendor: { type: "object", properties: { mode: { type: "string" } }, additionalProperties: false },
      },
    },
    start: {
      probe: async () => (version === undefined ? undefined : { path: "/bin/example", version }),
      run: async ({ spec }) => {
        ran.push(spec.name);
      },
    },
  });
}

const create = async (driver: ReturnType<typeof make>, config: Record<string, unknown>) => {
  const profilesRoot = mkdtempSync(join(tmpdir(), "prism-driver-"));
  if (typeof config.profile === "string") await createProfiles({ root: profilesRoot, driver }).create(config.profile);
  return createAgent({ packages: [driverPackage(driver)], packageConfig: { "example-driver": { profilesRoot, ...config } } });
};

describe("driver kit", () => {
  it("driver_package_claims_loop_and_is_model_less", async () => {
    const ran: string[] = [];
    const agent = await create(make("1.2.0", ran), { name: "planner", profile: "me" });
    const session = await agent.session({ id: "s", create: true });
    const result = await session.run("go");
    assert.equal(result.error, undefined);
    assert.deepEqual(ran, ["planner"]);
    await session.close();
  });

  it("driver_config_extends_spec", async () => {
    await assert.rejects(create(make("1.0.0"), { name: "a", profile: "me", bogus: 1 }), /bogus|unknown/i);
    await assert.rejects(create(make("1.0.0"), { name: "a", profile: "me", vendor: { nope: 1 } }), /nope|unknown/i);
    await assert.rejects(create(make("1.0.0"), { name: "a" }), /profile|required/i);
    const _agent = await create(make("1.0.0"), { name: "a", profile: "me", binary: "x", vendor: { mode: "fast" } });
  });

  it("system_prompt_takes_exactly_one_of_replace_or_append", async () => {
    // The package validator checks object branches under oneOf (plan 164 P1), so the schema owns the
    // rule for the top-level spec and every sub-agent spec.
    await assert.rejects(
      create(make("1.0.0"), { name: "a", profile: "me", binary: "x", systemPrompt: { replace: "r", append: "a" } }),
      /systemPrompt/,
    );
    await assert.rejects(create(make("1.0.0"), { name: "a", profile: "me", binary: "x", systemPrompt: { other: "x" } }), /systemPrompt/);
    await assert.rejects(create(make("1.0.0"), { name: "a", profile: "me", binary: "x", systemPrompt: {} }), /systemPrompt/);
    await assert.rejects(
      create(make("1.0.0"), {
        name: "a",
        profile: "me",
        binary: "x",
        subagents: { child: { name: "c", profile: "me", systemPrompt: { replace: "r", append: "a" } } },
      }),
      /systemPrompt/,
    );
    await create(make("1.0.0"), { name: "a", profile: "me", binary: "x", systemPrompt: { replace: "r" } });
  });

  it("missing_binary_is_status_note_then_driver_unavailable", async () => {
    const agent = await create(make(undefined), { name: "a", profile: "me" });
    const session = await agent.session({ id: "s", create: true });
    const result = await session.run("go");
    assert.match(result.error?.message ?? "", /driver_unavailable/);
    await session.close();
  });

  it("revision_major_mismatch_on_resume", async () => {
    const driver = make("2.0.0");
    // The binary major travels in the run's loop state (`state: "run"`), so one loop serves concurrent runs.
    const controller = (restored?: JsonValue) => {
      const recorded: JsonValue[] = [];
      return { recorded, run: { restored, checkpoint: (value: JsonValue) => recorded.push(value) } as unknown as RunController };
    };
    const loop = createDriverLoop(driver, { name: "a", profile: "me" }, { path: "p", version: "2.4.1" }, undefined, runtime);
    assert.equal(loop.state, "run");
    assert.equal(loop.snapshot, undefined);
    const first = controller();
    await loop.run(first.run);
    assert.deepEqual(first.recorded, [{ binaryMajor: "2" }]);
    const snapshot = first.recorded[0];
    await loop.run(controller(snapshot).run);
    const upgraded = createDriverLoop(driver, { name: "a", profile: "me" }, { path: "p", version: "3.0.0" }, undefined, runtime);
    await assert.rejects(upgraded.run(controller(snapshot).run), /driver_revision_mismatch/);
    const gone = createDriverLoop(driver, { name: "a", profile: "me" }, undefined, undefined, runtime);
    await assert.rejects(gone.run(controller(snapshot).run), /driver_revision_mismatch/);
  });

  it("requires_miss_fails_create_agent", async () => {
    const misses: [string, DriverRequires][] = [
      ["systemPrompt", { systemPrompt: "replace" }],
      ["builtinTools", { builtinTools: "per-tool" }],
      ["steer", { steer: "mid-turn" }],
      ["thinking", { thinking: "deltas" }],
      ["subagents", { subagents: true }],
      ["accountSignIn", { accountSignIn: true }],
    ];
    for (const [control, requires] of misses) {
      await assert.rejects(
        create(make("1.0.0"), { name: "a", profile: "me", requires }),
        (error: Error) => /driver_capability_missing/.test(error.message) && error.message.includes(control),
        control,
      );
    }
    const met: DriverRequires = {
      systemPrompt: "append",
      builtinTools: "partial",
      gated: ["write"],
      steer: "next-turn",
      resume: "store",
      thinking: "summary",
      skillActivation: true,
    };
    const _agent = await create(make("1.0.0"), { name: "a", profile: "me", requires: met });
  });

  it("define_driver_rejects_bad_definitions", () => {
    assert.throws(() => defineDriver({ ...make("1"), vendor: "other" }), /driver_definition_invalid/);
    assert.throws(
      () => defineDriver({ ...make("1"), config: { type: "object", properties: { profile: { type: "string" } } } }),
      /redefine/,
    );
  });

  it("driver_run_context_carries_tools_skills_host_services", async () => {
    let seen: DriverRunContext | undefined;
    const driver = defineDriver({
      name: "ctx-driver",
      vendor: "example",
      revision: "1",
      descriptor,
      start: {
        probe: async () => ({ path: "/bin/example", version: "1.0.0" }),
        run: async (context) => {
          seen = context;
        },
      },
    });
    const other = definePackage({
      name: "other-package",
      version: "1.0.0",
      description: "provides a tool, a skill and a service",
      requires: { api: 2 },
      capabilities: [],
      async setup(prism) {
        prism.tools.register({
          name: "other_tool",
          description: "x",
          parameters: { type: "object", properties: {} },
          execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "other_tool", value: null }),
        } as ToolDefinition);
        prism.skills.register({ name: "other-skill", description: "x", instructions: "y" });
        prism.services.provide("other-service", { ok: true });
      },
    });
    const profilesRoot = mkdtempSync(join(tmpdir(), "prism-driver-"));
    await createProfiles({ root: profilesRoot, driver }).create("me");
    const agent = await createAgent({
      packages: [other, driverPackage(driver)],
      host: { ui: { request: async () => ({ status: "unavailable" }) } as never },
      packageConfig: { "ctx-driver": { profilesRoot, name: "a", profile: "me" } },
    });
    const session = await agent.session({ id: "s", create: true });
    await session.run("go");
    assert.ok(seen, "the driver ran");
    assert.ok(seen.tools.some((tool) => tool.name === "other_tool"));
    assert.equal(seen.skills.get("other-skill")?.name, "other-skill");
    assert.equal(typeof seen.host.ui?.request, "function", "the package's host port reaches the host's UI");
    assert.deepEqual(seen.services.consume("other-service"), { ok: true });
    assert.equal(seen.services.consume("absent"), undefined);
    await session.close();
  });
});

describe("narrowSpec (RunOptions.external)", () => {
  const spec = {
    name: "cli",
    profile: "p",
    systemPrompt: { append: "configured" },
    prismTools: ["lookup", "post"],
    builtinTools: { allow: ["Read", "Grep", "Edit"], deny: ["Bash"] },
    limits: { maxTurns: 10 },
  } as const;
  it("only_narrows_the_configured_spec", async () => {
    const { narrowSpec } = await import("../index.js");
    const narrowed = narrowSpec(
      spec,
      {
        systemPrompt: { append: "run" },
        model: "small",
        prismTools: ["post", "unknown"],
        builtinTools: { allow: ["Read", "Write"], deny: ["WebFetch"] },
        limits: { maxTurns: 50 },
      },
      descriptor,
    );
    assert.deepEqual(narrowed.prismTools, ["post"]);
    assert.deepEqual(narrowed.builtinTools, { allow: ["Read"], deny: ["Bash", "WebFetch"] });
    assert.deepEqual(narrowed.limits, { maxTurns: 10 });
    assert.deepEqual(narrowed.systemPrompt, { append: "run" });
    assert.equal(narrowed.model, "small");
    assert.equal(narrowSpec(spec, undefined, descriptor), spec);
  });
  it("a_prompt_mode_the_driver_cannot_honour_fails_closed", async () => {
    const { narrowSpec } = await import("../index.js");
    assert.throws(() => narrowSpec(spec, { systemPrompt: { replace: "x" } }, descriptor), /cannot replace the system prompt/);
    assert.throws(() => narrowSpec(spec, { model: "m" }, { ...descriptor, models: "none" }), /takes no per-run model/);
  });
});
