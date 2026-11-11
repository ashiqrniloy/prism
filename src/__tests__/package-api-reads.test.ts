import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, definePackage, PackageLoadError, type PackageAPI, type Skill, type ToolDefinition } from "../index.js";

const tool = (name: string): ToolDefinition =>
  ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: (_args, context) => ({ toolCallId: context.toolCallId, name, value: null }),
  }) as ToolDefinition;
const skill = (name: string): Skill => ({ name, description: name, instructions: name });

function pkg(name: string, setup: (prism: PackageAPI<any>) => void | Promise<void>) {
  return definePackage({ name, version: "1.0.0", requires: { api: 1 }, setup });
}

/** A package that keeps its API so the test can read after setup. */
function reader() {
  const held: { api?: PackageAPI<any>; duringSetup?: unknown[] } = {};
  const definition = pkg("reader", (prism) => {
    held.api = prism;
    held.duringSetup = [];
    for (const read of [() => prism.tools.list(), () => prism.skills.list(), () => prism.skills.get("x")]) {
      try {
        read();
      } catch (error) {
        held.duringSetup.push(error);
      }
    }
  });
  return { held, definition };
}

describe("PackageAPI registry reads", () => {
  it("package_api_tools_list_returns_effective_registry", async () => {
    const { held, definition } = reader();
    await createAgent({
      model: { provider: "openai-compatible", model: "m" },
      tools: { add: [tool("host_tool"), tool("hidden")] },
      disable: { tools: ["hidden"] },
      packages: [
        pkg("one", (prism) => prism.tools.register(tool("one_tool"))),
        pkg("two", (prism) => prism.tools.register(tool("two_tool"))),
        definition,
      ],
    });
    const names = held.api!.tools.list().map((entry) => entry.name);
    for (const expected of ["host_tool", "one_tool", "two_tool"]) assert.ok(names.includes(expected), `${expected} is listed`);
    assert.ok(!names.includes("hidden"), "a disabled tool is absent");
  });

  it("package_api_skills_get_and_list", async () => {
    const { held, definition } = reader();
    await createAgent({
      model: { provider: "openai-compatible", model: "m" },
      skills: { add: [skill("host-skill"), skill("hidden-skill")] },
      disable: { skills: ["hidden-skill"] },
      packages: [pkg("one", (prism) => prism.skills.register(skill("pkg-skill"))), definition],
    });
    assert.equal(held.api!.skills.get("pkg-skill")?.name, "pkg-skill");
    assert.equal(held.api!.skills.get("host-skill")?.name, "host-skill");
    assert.equal(held.api!.skills.get("hidden-skill"), undefined);
    assert.deepEqual(
      held
        .api!.skills.list()
        .map((entry) => entry.name)
        .sort(),
      ["host-skill", "pkg-skill"],
    );
  });

  it("package_api_reads_throw_state_not_ready_in_setup", async () => {
    const { held, definition } = reader();
    await createAgent({ model: { provider: "openai-compatible", model: "m" }, packages: [definition] });
    assert.equal(held.duringSetup?.length, 3);
    for (const error of held.duringSetup ?? []) {
      assert.ok(error instanceof PackageLoadError);
      assert.equal(error.code, "state_not_ready");
    }
  });

  it("package_api_reads_are_frozen", async () => {
    const { held, definition } = reader();
    await createAgent({
      model: { provider: "openai-compatible", model: "m" },
      tools: { add: [tool("host_tool")] },
      skills: { add: [skill("host-skill")] },
      packages: [definition],
    });
    const tools = held.api!.tools.list() as ToolDefinition[];
    assert.throws(() => tools.push(tool("x")), TypeError);
    assert.throws(() => {
      (tools[0] as { name: string }).name = "renamed";
    }, TypeError);
    const entry = held.api!.skills.get("host-skill") as { name: string };
    assert.throws(() => {
      entry.name = "renamed";
    }, TypeError);
    assert.throws(() => (held.api!.skills.list() as Skill[]).push(skill("x")), TypeError);
  });
});
