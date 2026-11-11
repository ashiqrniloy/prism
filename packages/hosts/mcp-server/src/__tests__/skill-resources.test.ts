import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { parseSkillFile, type Skill } from "@arnilo/prism";
import { skillResources } from "../index.js";

const skill = (fields: Partial<Skill> & { name: string }): Skill => ({
  description: "Use when testing.",
  instructions: "Do the thing.",
  ...fields,
});

describe("skillResources", () => {
  it("skill_resources_only_for_served_tools", () => {
    const { resources, skipped } = skillResources(
      [
        skill({ name: "both", requiresTools: ["read", "edit"] }),
        skill({ name: "one", requiresTools: ["read"] }),
        skill({ name: "other", requiresTools: ["read", "shell"] }),
        skill({ name: "none-served", requiresTools: ["shell"] }),
      ],
      ["read", "edit"],
    );
    assert.deepEqual(
      resources.map((resource) => resource.uri),
      ["prism-skill://both", "prism-skill://one"],
    );
    assert.deepEqual(skipped, []);
    for (const resource of resources) assert.equal(resource.mimeType, "text/markdown");
  });

  it("skill_resources_skip_unscoped_skills", () => {
    const { resources, skipped } = skillResources(
      [
        skill({ name: "no-requires" }),
        skill({ name: "empty-requires", requiresTools: [] }),
        skill({ name: "no-body", requiresTools: ["read"], instructions: "  \n" }),
        skill({ name: "ok", requiresTools: ["read"] }),
      ],
      ["read"],
    );
    assert.deepEqual(
      resources.map((resource) => resource.name),
      ["ok"],
    );
    assert.deepEqual(skipped, [], "an unscoped skill is not lent and is not an error");
  });

  it("skill_resources_skip_oversized_and_report", () => {
    const big = skill({ name: "big", requiresTools: ["read"], instructions: "x".repeat(256 * 1024) });
    const { resources, skipped } = skillResources([big, skill({ name: "small", requiresTools: ["read"] })], ["read"]);
    assert.deepEqual(
      resources.map((resource) => resource.name),
      ["small"],
    );
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]?.name, "big");
    assert.equal(skipped[0]?.reason, "oversized");
    assert.ok((skipped[0]?.bytes ?? 0) > 256 * 1024, "reports the rendered size; the text is never truncated");
  });

  it("skill_resources_render_standard_skill_markdown", () => {
    const original = parseSkillFile(
      "---\nname: web-research\ndescription: Use when a task needs facts: search, then read.\nmetadata:\n  prism-requires-tools: web_fetch\n---\n\n# Web research\n\nBody.\n",
      "/skills/web-research/SKILL.md",
    );
    const { resources } = skillResources([original], ["web_fetch"]);
    const text = resources[0]?.text ?? "";
    assert.match(
      text,
      /^---\nname: "web-research"\ndescription: .*\nmetadata:\n {2}prism-requires-tools: "web_fetch"\n---\n\n# Web research/,
    );
    // The rendered file parses back to the same skill: name, description, requirement, and body.
    const reparsed = parseSkillFile(text, "/lent/SKILL.md");
    assert.equal(reparsed.name, original.name);
    assert.equal(reparsed.description, original.description);
    assert.deepEqual(reparsed.requiresTools, ["web_fetch"]);
    assert.equal(reparsed.instructions, original.instructions);
    assert.doesNotMatch(text, /\/skills\/web-research/, "the source path is never sent");
  });

  it("skill_metadata_lists_and_empty_collections_are_preserved", () => {
    const original = skill({
      name: "metadata",
      requiresTools: ["read"],
      metadata: {
        tags: ["read", "edit"],
        examples: [{ tool: "read", count: 1 }],
        empty: [],
        policy: { "quoted key": {} },
      },
    });
    const { resources } = skillResources([original], ["read"]);
    assert.ok(resources[0]);
    assert.equal(
      resources[0].text,
      [
        "---",
        'name: "metadata"',
        'description: "Use when testing."',
        "tags:",
        '  - "read"',
        '  - "edit"',
        "examples:",
        '  - {"tool":"read","count":1}',
        "empty: []",
        "policy:",
        '  "quoted key": {}',
        "---",
        "",
        original.instructions,
      ].join("\n"),
    );
  });

  it("skill_resources_are_deterministic_and_keep_the_first_duplicate", () => {
    const input = [
      skill({ name: "a", requiresTools: ["read"] }),
      skill({ name: "a", requiresTools: ["read"], instructions: "second" }),
      skill({ name: "b", requiresTools: ["read"] }),
    ];
    const first = skillResources(input, ["read"]);
    assert.deepEqual(first, skillResources(input, ["read"]));
    assert.deepEqual(
      first.resources.map((resource) => resource.name),
      ["a", "b"],
    );
    assert.doesNotMatch(first.resources[0]?.text ?? "", /second/);
  });
});
