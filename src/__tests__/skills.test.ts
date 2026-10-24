import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  assembleProviderInput,
  createSkillRegistry,
  HARD_MAX_SKILL_INSTRUCTION_BYTES,
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

  it("strict mode rejects duplicate skill names", () => {
    // Same name, different body: a conflict. Identical registrations (same path and body) are one skill.
    const other: Skill = { ...skill, instructions: "Answer at length." };
    assert.throws(() => createSkillRegistry([skill, other], { duplicate: "error" }), /Duplicate skill: brief/);
    const registry = createSkillRegistry([skill], { duplicate: "error" });
    registry.register({ ...skill });
    assert.equal(registry.list().length, 1);

    assert.throws(() => registry.register(other), /Duplicate skill: brief/);
  });

  it("active skill selection includes only requested skills", () => {
    const other: Skill = { name: "verbose", instructions: "Explain fully." };
    const registry = createSkillRegistry([skill, other]);

    assert.deepEqual(resolveActiveSkills({ registry, names: ["brief"], tools: [tool] }), [skill]);
    assert.deepEqual(resolveActiveSkills({ registry, tools: [tool] }), []);
  });

  it("oversized body is rejected at registration", () => {
    assert.throws(
      () => createSkillRegistry([{ name: "big", instructions: "x".repeat(HARD_MAX_SKILL_INSTRUCTION_BYTES + 1) }]),
      /exceed hard cap/,
    );
  });

  it("skill referencing missing tool fails closed", () => {
    const registry = createSkillRegistry([skill]);

    assert.throws(() => resolveActiveSkills({ registry, names: ["brief"], tools: [] }), /requires inactive tool: echo/);
  });

  it("a skill stays out of the prompt until the host selects it", () => {
    const registry = createSkillRegistry();
    assert.deepEqual(registry.list(), []);
    registry.register(skill);
    assert.deepEqual(resolveActiveSkills({ registry, names: ["brief"], tools: [tool] }), [skill]);
  });

  it("prompt builder includes selected skill catalog in progressive mode", async () => {
    const registry = createSkillRegistry([skill, { name: "hidden", instructions: "Do not include." }]);
    const active = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills: active,
      tools: [tool],
    });
    const text = request.messages
      .map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"))
      .join("\n");

    assert.match(text, /- brief: \(no description\)/);
    assert.doesNotMatch(text, /Answer briefly/);
    assert.doesNotMatch(text, /Do not include/);
  });

  it("prompt builder includes selected skill instructions in eager mode", async () => {
    const registry = createSkillRegistry([skill, { name: "hidden", instructions: "Do not include." }]);
    const active = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills: active,
      tools: [tool],
      skillsDisclosure: "eager",
    });
    const text = request.messages
      .map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"))
      .join("\n");

    assert.match(text, /Skill brief:\nAnswer briefly\./);
    assert.doesNotMatch(text, /Do not include/);
  });
});
