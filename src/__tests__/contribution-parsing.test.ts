import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentFile, parseSkillFile } from "../index.js";

describe("parseSkillFile", () => {
  it("parses frontmatter + body; body becomes instructions", () => {
    const skill = parseSkillFile("---\nname: x\ndescription: d\ntoolNames:\n  - a\n  - b\n---\ninstr", "/p/x/SKILL.md");
    assert.equal(skill.name, "x");
    assert.equal(skill.description, "d");
    assert.deepEqual([...(skill.toolNames ?? [])], ["a", "b"]);
    assert.equal(skill.instructions, "instr");
  });

  it("accepts bracket-list toolNames", () => {
    const skill = parseSkillFile("---\nname: x\ntoolNames: [a, b, c]\n---\nbody", "/p/x/SKILL.md");
    assert.deepEqual([...(skill.toolNames ?? [])], ["a", "b", "c"]);
  });

  it("falls back to parent-dir basename when no frontmatter; body is the file", () => {
    const skill = parseSkillFile("just body text", "/p/some-skill/SKILL.md");
    assert.equal(skill.name, "some-skill");
    assert.equal(skill.instructions, "just body text");
  });

  it("empty file yields name from basename and empty instructions", () => {
    const skill = parseSkillFile("", "/p/e/SKILL.md");
    assert.equal(skill.name, "e");
    assert.equal(skill.instructions, "");
  });

  it("collects unknown frontmatter keys into metadata; not fatal", () => {
    const skill = parseSkillFile("---\nname: x\nrole: dev\nextra: 5\n---\nb", "/p/x/SKILL.md");
    assert.equal(skill.metadata?.role, "dev");
    assert.equal(skill.metadata?.extra, "5");
  });

  it("throws on unterminated frontmatter fence naming the file", () => {
    assert.throws(
      () => parseSkillFile("---\nname: x\nbody", "/p/SKILL.md"),
      /Malformed frontmatter in \/p\/SKILL\.md: unterminated fence/,
    );
  });

  it("throws on invalid name characters naming the file", () => {
    assert.throws(
      () => parseSkillFile("---\nname: bad/name\n---\n", "/p/SKILL.md"),
      /Invalid skill name in \/p\/SKILL\.md/,
    );
  });
});

describe("parseAgentFile", () => {
  it("emits a declaration with kind agent and resource = file path", () => {
    const decl = parseAgentFile("---\nname: agent-x\ndescription: an agent\nrole: dev\n---\nbody", "/p/agent-x/AGENT.md");
    assert.equal(decl.kind, "agent");
    assert.equal(decl.name, "agent-x");
    assert.equal(decl.resource, "/p/agent-x/AGENT.md");
    assert.equal(decl.metadata?.description, "an agent");
    assert.equal(decl.metadata?.role, "dev");
  });

  it("falls back to parent-dir basename when no frontmatter", () => {
    const decl = parseAgentFile("just body", "/p/agent-y/AGENT.md");
    assert.equal(decl.name, "agent-y");
    assert.equal(decl.resource, "/p/agent-y/AGENT.md");
  });
});
