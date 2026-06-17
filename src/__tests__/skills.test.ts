import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleProviderInput,
  createContributionRegistries,
  createDefaultPromptBuilder,
  createExtensionKernel,
  createSkillRegistry,
  resolveActiveSkills,
  type Skill,
  type ToolDefinition,
} from "../index.js";

const skill: Skill = {
  name: "brief",
  instructions: "Answer briefly.",
  toolNames: ["echo"],
};
const tool: ToolDefinition = {
  name: "echo",
  execute() {
    throw new Error("should not execute");
  },
};

describe("skill registry and selection", () => {
  it("registers gets resolves lists and replaces skills", () => {
    const registry = createSkillRegistry([skill]);
    const replacement: Skill = { ...skill, instructions: "One sentence." };

    registry.register(replacement);

    assert.equal(registry.get("brief"), replacement);
    assert.equal(registry.resolve("brief"), replacement);
    assert.deepEqual(registry.list(), [replacement]);
    assert.throws(() => registry.resolve("missing"), /Unknown skill: missing/);
  });

  it("active skill selection includes only requested skills", () => {
    const other: Skill = { name: "verbose", instructions: "Explain fully." };
    const registry = createSkillRegistry([skill, other]);

    assert.deepEqual(resolveActiveSkills({ registry, names: ["brief"], tools: [tool] }), [skill]);
    assert.deepEqual(resolveActiveSkills({ registry, tools: [tool] }), []);
  });

  it("skill referencing missing tool fails closed", () => {
    const registry = createSkillRegistry([skill]);

    assert.throws(() => resolveActiveSkills({ registry, names: ["brief"], tools: [] }), /requires inactive tool: echo/);
  });

  it("extension registered skill is inert until host selects it", async () => {
    const contributions = createContributionRegistries();
    const kernel = createExtensionKernel({ registries: contributions });
    await kernel.load([{ name: "skills", setup: (api) => { api.registerSkill(skill); } }]);
    const registry = createSkillRegistry();

    assert.deepEqual(registry.list(), []);
    registry.register(contributions.skills.resolve("brief"));
    assert.deepEqual(resolveActiveSkills({ registry, names: ["brief"], tools: [tool] }), [skill]);
  });

  it("prompt builder includes selected skill instructions only", async () => {
    const registry = createSkillRegistry([skill, { name: "hidden", instructions: "Do not include." }]);
    const active = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      promptBuilder: createDefaultPromptBuilder(),
      skills: active,
      tools: [tool],
    });
    const text = request.messages.map((message) => message.content.map((part) => part.type === "text" ? part.text : "").join("\n")).join("\n");

    assert.match(text, /Skill brief:\nAnswer briefly\./);
    assert.doesNotMatch(text, /Do not include/);
  });
});
