import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleProviderInput,
  createDefaultPromptBuilder,
  createLoadedSkillSet,
  DEFAULT_MAX_SKILL_CATALOG_ENTRIES,
  DEFAULT_MAX_SKILL_DESCRIPTION_BYTES,
  EMPTY_SKILL_DESCRIPTION,
  HARD_MAX_SKILL_CATALOG_ENTRIES,
  HARD_MAX_SKILL_DESCRIPTION_BYTES,
  SkillDisclosureError,
} from "../index.js";
import { skillMessages, skillPromptText } from "../skill-disclosure.js";

describe("skill progressive disclosure", () => {
  it("progressive mode renders catalog name+description without instructions", async () => {
    const messages = skillMessages([{ name: "brief", description: "Answer briefly.", instructions: "Full body." }]);
    assert.equal(messages.length, 1);
    assert.match(messages[0]!.content[0]!.type === "text" ? messages[0]!.content[0]!.text : "", /Skill brief: Answer briefly\./);
    assert.doesNotMatch(messages[0]!.content[0]!.type === "text" ? messages[0]!.content[0]!.text : "", /Full body/);
  });

  it("empty description uses placeholder", () => {
    const text = skillPromptText({ name: "x", instructions: "body" });
    assert.equal(text, `Skill x: ${EMPTY_SKILL_DESCRIPTION}`);
  });

  it("loaded skill includes instructions in progressive mode", () => {
    const loaded = createLoadedSkillSet();
    loaded.add("brief");
    const text = skillPromptText({ name: "brief", description: "d", instructions: "Full body." }, { disclosure: "progressive", loaded });
    assert.equal(text, "Skill brief:\nFull body.");
  });

  it("eager mode restores full instructions every turn", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills: [{ name: "brief", description: "Answer briefly.", instructions: "Be brief." }],
      skillsDisclosure: "eager",
    });
    const text = request.messages.map((m) => m.content.map((p) => (p.type === "text" ? p.text : "")).join("")).join("\n");
    assert.match(text, /Skill brief:\nBe brief\./);
    assert.doesNotMatch(text, /Skill brief: Answer briefly\./);
  });

  it("oversize description fails closed above hard cap", () => {
    const huge = "x".repeat(HARD_MAX_SKILL_DESCRIPTION_BYTES + 1);
    assert.throws(() => skillPromptText({ name: "big", description: huge }), SkillDisclosureError);
  });

  it("description truncates at default cap", () => {
    const long = "a".repeat(DEFAULT_MAX_SKILL_DESCRIPTION_BYTES + 100);
    const text = skillPromptText({ name: "trim", description: long });
    assert.ok(text!.endsWith("…"));
    assert.ok(new TextEncoder().encode(text!.replace(/^Skill trim: /, "")).length <= DEFAULT_MAX_SKILL_DESCRIPTION_BYTES + 4);
  });

  it("catalog entry count truncates at default max", () => {
    const skills = Array.from({ length: DEFAULT_MAX_SKILL_CATALOG_ENTRIES + 5 }, (_, i) => ({
      name: `s${i}`,
      description: `d${i}`,
    }));
    const messages = skillMessages(skills);
    assert.equal(messages.length, DEFAULT_MAX_SKILL_CATALOG_ENTRIES);
  });

  it("catalog entry count fails closed above hard max", () => {
    const skills = Array.from({ length: HARD_MAX_SKILL_CATALOG_ENTRIES + 1 }, (_, i) => ({
      name: `s${i}`,
      description: `d${i}`,
    }));
    assert.throws(() => skillMessages(skills), SkillDisclosureError);
  });

  it("assembleProviderInput progressive default omits instructions", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills: [{ name: "brief", instructions: "Secret body." }],
    });
    const text = request.messages.map((m) => m.content.map((p) => (p.type === "text" ? p.text : "")).join("")).join("\n");
    assert.match(text, /Skill brief: \(no description\)/);
    assert.doesNotMatch(text, /Secret body/);
  });

  it("default prompt builder passes disclosure through catalog shape", async () => {
    const messages = await createDefaultPromptBuilder().build({
      messages: [{ role: "user", content: [{ type: "text", text: "Q" }] }],
      skills: [{ name: "brief", description: "Short.", instructions: "Long." }],
      skillsDisclosure: "progressive",
    });
    assert.match(messages[0]!.content[0]!.type === "text" ? messages[0]!.content[0]!.text : "", /Skill brief: Short\./);
  });
});
