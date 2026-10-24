import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  type ModelProvider,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  loadSuspendedRunEntry,
  definePackage,
  providerDone,
  providerTextDelta,
  type ProviderRequest,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { createAgentWith } from "../agent-session/create-agent.js";
import { resolveBackgroundSettleMs, resolveRunLimits } from "../run-limits.js";
import { failedRun } from "./run-result-helpers.js";
import { providerPackage } from "../provider-kit/index.js";

const tool: ToolDefinition = {
  name: "probe",
  description: "probe",
  parameters: { type: "object" },
  execute: () => ({ toolCallId: "c", name: "probe" }),
};
const skill = { name: "guide", description: "Guide", instructions: "SECRET_BODY" };
function provider(seen: ProviderRequest[]) {
  return {
    id: "mock",
    async *generate(request: ProviderRequest) {
      seen.push(request);
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}
const model = { provider: "mock", model: "demo", capabilities: { tools: true } };

test("tools_add_registers_host_tools_and_collides_fail_closed_with_package_tools", async () => {
  const seen: ProviderRequest[] = [];
  const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider(seen)])], tools: { add: [tool] } });
  await (await agent.session()).run("hi");
  assert.deepEqual(
    seen[0]?.tools?.map((t) => t.name),
    ["probe"],
  );
  const pkg = definePackage({
    name: "vendor",
    version: "1.0.0",
    requires: { api: 1 },
    setup(api) {
      api.tools.register(tool);
    },
  })();
  await assert.rejects(createAgent({ model, tools: { add: [tool] }, packages: [pkg] }), /already taken|collid/i);
  await assert.rejects(createAgent({ model, tools: { add: [tool, tool] } }), /duplicate|collid|Duplicate/i);
});

test("skills_dirs_and_add_load_and_disclosure_defaults_to_progressive", async () => {
  const seen: ProviderRequest[] = [];
  const paths: string[] = [];
  const agent = await createAgentWith(
    { model, packages: [providerPackage("test-provider", [provider(seen)])], skills: { add: [skill], dirs: ["skills"] } },
    {
      readSkillDir: async (path) => {
        paths.push(path);
        return [{ ...skill, name: "disk" }];
      },
    },
  );
  await (await agent.session()).run("hi");
  assert.deepEqual(paths, ["skills"]);
  const serialized = JSON.stringify(seen[0]);
  assert.ok(serialized.includes("- guide: Guide"));
  assert.ok(serialized.includes("- disk: Guide"));
  assert.ok(!serialized.includes("SECRET_BODY"));
  assert.ok(seen[0]?.tools?.some((t) => t.name === "load_skill"));
});

test("skills_catalog_is_a_named_kernel_context_build_registration", async () => {
  const seen: ProviderRequest[] = [];
  const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider(seen)])], skills: { add: [skill] } });
  assert.ok(agent.inspect().hooks["context.build"]?.some((h) => h.id === "kernel:context.build"));
  const disabled = await createAgent({
    model,
    packages: [providerPackage("test-provider", [provider(seen)])],
    skills: { add: [skill] },
    disable: { hooks: ["kernel:context.build"] },
  });
  await (await disabled.session()).run("hi");
  assert.ok(!JSON.stringify(seen[0]).includes("- guide:"));
});

test("run_tools_only_narrows_and_unknown_name_fails_closed", async () => {
  const seen: ProviderRequest[] = [];
  const agent = await createAgent({
    model,
    packages: [providerPackage("test-provider", [provider(seen)])],
    tools: { add: [tool, { ...tool, name: "other" }] },
  });
  await (await agent.session()).run("hi", { tools: { only: ["probe"] } });
  assert.deepEqual(
    seen[0]?.tools?.map((t) => t.name),
    ["probe"],
  );
  await failedRun((await agent.session()).run("hi", { tools: { only: ["unknown"] } }), /Unknown run tool/);
});

test("host_load_skill_collision_fails_closed_under_progressive_disclosure", async () => {
  const seen: ProviderRequest[] = [];
  const agent = await createAgent({
    model,
    packages: [providerPackage("test-provider", [provider(seen)])],
    skills: { add: [skill], disclosure: "progressive" },
    tools: { add: [{ ...tool, name: "load_skill" }] },
  });
  await failedRun((await agent.session()).run("hi"), /Duplicate tool: load_skill/);
});

test("resume_intersects_tools_only_with_stored_grant", async () => {
  const store = createMemorySessionStore();
  const seen: string[][] = [];
  let turn = 0;
  const gated: ModelProvider = {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent("call-1", "probe", {}) };
      yield providerDone();
    },
  };
  const agent = await createAgent({
    hooks: askEveryTool(),
    id: "narrow-resume",
    model,
    packages: [providerPackage("test-provider", [gated])],
    slots: { store },
    tools: { add: [tool, { ...tool, name: "other" }] },
  });
  const first = await (await agent.session({ id: "s1", create: true })).run("go", { tools: { only: ["probe"] } });
  assert.equal(first.status, "suspended");
  const stored = await loadSuspendedRunEntry(store, "s1");
  assert.deepEqual(stored?.state.toolNames, ["probe"]);
  const resumeProvider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      seen.push((request.tools ?? []).map((item) => item.name));
      yield providerDone();
    },
  };
  const fresh = await createAgent({ ...agent.config, packages: [providerPackage("test-provider", [resumeProvider])] });
  const resumed = await fresh.session({ id: "s1" });
  for await (const _event of resumed.resume(
    first.pending!.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })),
  )) {
    // drain: the resumed leg keeps the stored per-run allow-list
  }
  assert.deepEqual(seen, [["probe"]]);
});

test("run_limits_only_narrow_the_agent_floor", () => {
  const floor = { maxToolRounds: 2, maxTurns: 3 };
  assert.equal(resolveRunLimits(floor, { maxToolRounds: 5 }).maxToolRounds, 2);
  assert.equal(resolveRunLimits(floor, { maxToolRounds: 1 }).maxToolRounds, 1);
  assert.equal(resolveRunLimits(floor, undefined).maxTurns, 3);
  assert.equal(resolveRunLimits(floor, { maxTurns: 10 }).maxTurns, 3);
  // backgroundSettleMs is agent-wide only: a per-run layer cannot set it (a session outlives a run).
  assert.equal(resolveBackgroundSettleMs({ backgroundSettleMs: 50 }), 50);
  assert.equal(resolveBackgroundSettleMs(undefined), 5_000);
});
