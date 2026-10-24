import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  assembleProviderInput,
  createLoadedSkillSet,
  DEFAULT_MAX_SKILL_CATALOG_ENTRIES,
  DEFAULT_MAX_SKILL_DESCRIPTION_BYTES,
  EMPTY_SKILL_DESCRIPTION,
} from "../index.js";
import { skillMessages, skillPromptText } from "../skill-disclosure.js";

const PREAMBLE = "Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.";

function textOf(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

describe("skill progressive disclosure", () => {
  it("catalog is one message with preamble and one line per skill", () => {
    const messages = skillMessages([
      { name: "brief", description: "Answer briefly.", instructions: "Full body." },
      { name: "verbose", description: "Explain fully.", instructions: "Other body." },
    ]);
    assert.equal(messages.length, 1);
    assert.equal(textOf(messages[0]!), `${PREAMBLE}\n- brief: Answer briefly.\n- verbose: Explain fully.`);
    assert.doesNotMatch(textOf(messages[0]!), /Full body|Other body/);
  });

  it("empty description uses placeholder in the catalog line", () => {
    const text = skillPromptText({ name: "x", instructions: "body" });
    assert.equal(text, `- x: ${EMPTY_SKILL_DESCRIPTION}`);
  });

  it("loaded skill includes instructions as a separate body message", () => {
    const loaded = createLoadedSkillSet();
    loaded.add("brief");
    const text = skillPromptText({ name: "brief", description: "d", instructions: "Full body." }, { disclosure: "progressive", loaded });
    assert.equal(text, "Skill brief:\nFull body.");

    const messages = skillMessages(
      [
        { name: "brief", description: "d", instructions: "Full body." },
        { name: "other", description: "Other.", instructions: "Other body." },
      ],
      { loaded },
    );
    assert.equal(messages.length, 2);
    assert.equal(textOf(messages[0]!), `${PREAMBLE}\n- other: Other.`);
    assert.equal(textOf(messages[1]!), "Skill brief:\nFull body.");
  });

  it("eager mode renders every body and no catalog block", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills: [{ name: "brief", description: "Answer briefly.", instructions: "Be brief." }],
      skillsDisclosure: "eager",
    });
    const text = request.messages.map((m) => m.content.map((p) => (p.type === "text" ? p.text : "")).join("")).join("\n");
    assert.match(text, /Skill brief:\nBe brief\./);
    assert.doesNotMatch(text, /task-specific instructions/);
    assert.doesNotMatch(text, /- brief: Answer briefly\./);
  });

  it("long description truncates without throwing", () => {
    const long = "a".repeat(DEFAULT_MAX_SKILL_DESCRIPTION_BYTES + 10_000);
    const text = skillPromptText({ name: "trim", description: long });
    assert.ok(text!.startsWith("- trim: "));
    assert.ok(text!.endsWith("…"));
    assert.ok(new TextEncoder().encode(text!.replace(/^- trim: /, "")).length <= DEFAULT_MAX_SKILL_DESCRIPTION_BYTES + 4);
  });

  it("catalog entry count truncates at default max and names the unlisted count", () => {
    const skills = Array.from({ length: DEFAULT_MAX_SKILL_CATALOG_ENTRIES + 5 }, (_, i) => ({
      name: `s${i}`,
      description: `d${i}`,
    }));
    const messages = skillMessages(skills);
    assert.equal(messages.length, 1);
    const text = textOf(messages[0]!);
    assert.equal(text.split("\n").filter((line) => line.startsWith("- s")).length, DEFAULT_MAX_SKILL_CATALOG_ENTRIES);
    assert.ok(text.endsWith("(5 more skills are installed but not listed.)"));
  });

  it("catalog over 256 does not throw", () => {
    const skills = Array.from({ length: 300 }, (_, i) => ({ name: `s${i}`, description: `d${i}` }));
    const messages = skillMessages(skills);
    assert.equal(messages.length, 1);
    assert.ok(textOf(messages[0]!).endsWith("(236 more skills are installed but not listed.)"));
  });

  it("20-skill catalog costs one message header instead of one per skill", () => {
    const skills = Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, description: `description ${i}` }));
    const messages = skillMessages(skills);
    assert.equal(messages.length, 1);
    const oneBlock = Buffer.byteLength(JSON.stringify(messages), "utf8");
    const perSkill = skills.reduce(
      (bytes, skill) =>
        bytes +
        Buffer.byteLength(
          JSON.stringify({ role: "system", content: [{ type: "text", text: `Skill ${skill.name}: ${skill.description}` }] }),
          "utf8",
        ),
      0,
    );
    assert.ok(oneBlock < perSkill, `${oneBlock} bytes should be below ${perSkill}`);
  });

  it("assembleProviderInput progressive default omits instructions", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills: [{ name: "brief", instructions: "Secret body." }],
    });
    const text = request.messages.map((m) => m.content.map((p) => (p.type === "text" ? p.text : "")).join("")).join("\n");
    assert.match(text, /- brief: \(no description\)/);
    assert.doesNotMatch(text, /Secret body/);
  });

  it("the kernel prompt composition passes disclosure through catalog shape", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: [{ role: "user", content: [{ type: "text", text: "Q" }] }],
      skills: [{ name: "brief", description: "Short.", instructions: "Long." }],
      skillsDisclosure: "progressive",
    });
    const first = request.messages[0]!.content[0]!;
    assert.equal(first.type === "text" ? first.text : "", `${PREAMBLE}\n- brief: Short.`);
  });
});
