import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgentFile, parseSkillFile } from "../index.js";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "frontmatter");

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

describe("parseSkillFile", () => {
  it("parses frontmatter + body; body becomes instructions", () => {
    const skill = parseSkillFile("---\nname: x\ndescription: d\ntoolNames:\n  - a\n  - b\n---\ninstr", "/p/x/SKILL.md");
    assert.equal(skill.name, "x");
    assert.equal(skill.description, "d");
    assert.equal(skill.path, "/p/x/SKILL.md");
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
    assert.throws(() => parseSkillFile("---\nname: x\nbody", "/p/SKILL.md"), /Malformed frontmatter in \/p\/SKILL\.md: unterminated fence/);
  });

  it("throws on invalid name characters naming the file", () => {
    assert.throws(() => parseSkillFile("---\nname: bad/name\n---\n", "/p/SKILL.md"), /Invalid skill name in \/p\/SKILL\.md/);
  });
});

describe("frontmatter parser", () => {
  it("parses folded block scalars with paragraph breaks (find-docs)", () => {
    const skill = parseSkillFile(fixture("repo-find-docs.md"), "/p/find-docs/SKILL.md");
    assert.equal(
      skill.description,
      'Retrieves up-to-date documentation, API references, and code examples for any developer technology. Use this skill whenever the user asks about a specific library, framework, SDK, CLI tool, or cloud service -- even for well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. Your training data may not reflect recent API changes or version updates.\nAlways use for: API syntax questions, configuration options, version migration issues, "how do I" questions mentioning a library name, debugging that involves library-specific behavior, setup instructions, and CLI tool usage.\nUse even when you think you know the answer -- do not rely on training data for API details, signatures, or configuration options as they are frequently outdated. Always verify against current docs. Prefer this over web search for library documentation and API details.',
    );
  });

  it("parses plain scalars continued on more-indented lines (graft)", () => {
    const skill = parseSkillFile(fixture("repo-graft.md"), "/p/graft/SKILL.md");
    assert.equal(
      skill.description,
      "This repo is indexed by graft/. For ANY task here, whether understanding how something works, finding where code lives, tracing what calls a symbol or what a change breaks, or scoping an edit, get your context from graft before grepping or reading source files.",
    );
  });

  it("keeps quoted scalars and plain scalars unquoted as strings", () => {
    const skill = parseSkillFile(
      `---\nname: x\nsingle: 'it''s'\ndouble: "a \\"b\\": c"\nbool: true\nnumber: 5\nlist: [a, "b, c", 'd''e']\n---\nbody`,
      "/p/x/SKILL.md",
    );
    assert.equal(skill.metadata?.single, "it's");
    assert.equal(skill.metadata?.double, 'a "b": c');
    assert.equal(skill.metadata?.bool, "true");
    assert.equal(skill.metadata?.number, "5");
    assert.deepEqual(skill.metadata?.list, ["a", "b, c", "d'e"]);
  });

  it("parses nested metadata as an object", () => {
    const skill = parseSkillFile(fixture("repo-skill-creator.md"), "/p/skill-creator/SKILL.md");
    assert.deepEqual(skill.metadata, { metadata: { "short-description": "Create or update a skill" } });
    const nested = parseSkillFile("---\nname: x\nmetadata:\n  outer:\n    inner: value\n---\nb", "/p/x/SKILL.md");
    assert.deepEqual(nested.metadata, { metadata: { outer: { inner: "value" } } });
  });

  it("parses literal, strip-chomped and folded block scalars", () => {
    const skill = parseSkillFile(fixture("scalars.md"), "/p/scalars/SKILL.md");
    assert.equal(skill.metadata?.literal, "line one\nline two\n");
    assert.equal(skill.metadata?.strip, "a\nb");
    assert.equal(skill.metadata?.folded, "a b\nc\n");
    assert.equal(skill.metadata?.keep, "a\n");
    assert.equal(skill.metadata?.fence, "---\n");
  });

  it("parses a block list of maps (Claude Code subagent hooks)", () => {
    const decl = parseAgentFile(fixture("claude-subagent.md"), "/p/db-reader/AGENT.md");
    assert.equal(decl.name, "db-reader");
    assert.equal(decl.description, "Execute read-only database queries.");
    assert.equal(decl.instructions.trim(), "You are a database reader.");
    assert.equal(decl.metadata?.tools, "Bash");
    assert.deepEqual(decl.metadata?.hooks, {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./scripts/validate-readonly-query.sh" }] }],
    });
  });

  it("parses a skills-CLI sample with nested metadata and quoted values", () => {
    const skill = parseSkillFile(fixture("claude-skill-docx.md"), "/p/docx/SKILL.md");
    assert.match(skill.description ?? "", /'Word doc'/);
    assert.match(skill.description ?? "", /Triggers include: /);
    assert.equal(skill.metadata?.license, "Complete terms in LICENSE.txt");
    assert.deepEqual(skill.metadata?.metadata, {
      version: "1.0.0",
      "argument-hint": "<file-or-pattern>",
      quote: 'it\'s "quoted"',
    });
    assert.equal(skill.metadata?.escaped, 'say "hi"\nnow');
    assert.deepEqual([...(skill.toolNames ?? [])], ["Read", "Grep", "Glob"]);
  });

  it("parses all six repo skills exactly as recorded", () => {
    const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf8")) as Record<
      string,
      { name: string; description: string; metadata?: Record<string, unknown> }
    >;
    for (const [file, want] of Object.entries(expected)) {
      const skill = parseSkillFile(fixture(file), `/p/${want.name}/SKILL.md`);
      assert.equal(skill.name, want.name, file);
      assert.equal(skill.description, want.description, file);
      assert.deepEqual(skill.metadata, want.metadata, file);
      assert.equal((skill.instructions ?? "").trim(), "fixture body", file);
    }
  });

  it("parses all fixtures in one pass under 5 ms", () => {
    const files = [
      "repo-create-plan.md",
      "repo-find-docs.md",
      "repo-graft.md",
      "repo-prism-execution.md",
      "repo-skill-creator.md",
      "repo-typescript-advanced-types.md",
      "claude-subagent.md",
      "claude-skill-docx.md",
      "scalars.md",
    ];
    const texts = files.map((file) => [file, fixture(file)] as const);
    const started = performance.now();
    for (const [file, text] of texts) {
      if (file.startsWith("repo-")) parseSkillFile(text, `/p/${file}/SKILL.md`);
      else if (file === "claude-subagent.md") parseAgentFile(text, "/p/db-reader/AGENT.md");
      else parseSkillFile(text, `/p/${file}/SKILL.md`);
    }
    assert.ok(performance.now() - started < 5);
  });

  it("rejects unsupported frontmatter syntax with its line", () => {
    for (const value of ["&anchor", "*alias", "!tag"]) {
      assert.throws(
        () => parseSkillFile(`---\nname: x\nvalue: ${value}\n---\nbody`, "/p/x/SKILL.md"),
        /Malformed frontmatter in \/p\/x\/SKILL\.md: unsupported frontmatter syntax .* at line 3/,
      );
    }
    assert.throws(
      () => parseSkillFile("---\nname: x\nlist:\n  - &anchor\n---\nbody", "/p/x/SKILL.md"),
      /unsupported frontmatter syntax .* at line 4/,
    );
    assert.throws(
      () => parseSkillFile("---\nname: x\n__proto__: polluted\n---\nbody", "/p/x/SKILL.md"),
      /Malformed frontmatter in \/p\/x\/SKILL\.md: unsupported frontmatter key at line 3/,
    );
  });

  it("caps nesting at 8 levels", () => {
    const lines = ["---", "name: x", "root:"];
    for (let level = 0; level < 9; level++) lines.push(`${"  ".repeat(level + 1)}level${level}:`);
    lines.push(`${"  ".repeat(10)}value: x`, "---", "");
    assert.throws(
      () => parseSkillFile(lines.join("\n"), "/p/x/SKILL.md"),
      /Malformed frontmatter in \/p\/x\/SKILL\.md: nesting exceeds 8 levels at line \d+/,
    );
  });
});

describe("parseAgentFile", () => {
  it("returns the description, body instructions and metadata", () => {
    const decl = parseAgentFile("---\nname: agent-x\ndescription: an agent\nrole: dev\n---\nbody", "/p/agent-x/AGENT.md");
    assert.equal(decl.kind, "agent");
    assert.equal(decl.name, "agent-x");
    assert.equal(decl.resource, "/p/agent-x/AGENT.md");
    assert.equal(decl.description, "an agent");
    assert.equal(decl.instructions, "body");
    assert.deepEqual(decl.metadata, { role: "dev" });
  });

  it("falls back to parent-dir basename when no frontmatter", () => {
    const decl = parseAgentFile("just body", "/p/agent-y/AGENT.md");
    assert.equal(decl.name, "agent-y");
    assert.equal(decl.resource, "/p/agent-y/AGENT.md");
    assert.equal(decl.instructions, "just body");
  });
});
