import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { createSkillRegistry } from "@arnilo/prism";
import { deployWikiSkills, loadBundledSkills, parseSkillMarkdown, wikiMaintainerSkill, wikiSearcherSkill } from "../skills.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-skills-test");

describe("prism-wiki skills & workspace deployment", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("parseSkillMarkdown_extracts_frontmatter_and_instructions", () => {
    const raw = `---
name: sample-skill
description: A test skill description.
---

# Instructions
Do step 1 and step 2.`;

    const parsed = parseSkillMarkdown(raw);
    assert.equal(parsed.name, "sample-skill");
    assert.equal(parsed.description, "A test skill description.");
    assert.equal(parsed.instructions, "# Instructions\nDo step 1 and step 2.");
  });

  it("deployWikiSkills_copies_skills_to_workspace_agents_skills", async () => {
    const mockWorkspace = join(TEST_DIR, "workspace");
    await mkdir(mockWorkspace, { recursive: true });

    const deployed = await deployWikiSkills(mockWorkspace);
    assert.ok(deployed.length >= 2);

    const maintainerSkillPath = join(mockWorkspace, ".agents/skills/wiki-maintainer/SKILL.md");
    const maintainerYamlPath = join(mockWorkspace, ".agents/skills/wiki-maintainer/agents/openai.yaml");
    const searcherSkillPath = join(mockWorkspace, ".agents/skills/wiki-searcher/SKILL.md");

    const maintainerContent = await readFile(maintainerSkillPath, "utf8");
    const yamlContent = await readFile(maintainerYamlPath, "utf8");
    const searcherContent = await readFile(searcherSkillPath, "utf8");

    assert.ok(maintainerContent.includes("name: wiki-maintainer"));
    assert.ok(yamlContent.includes('display_name: "Wiki Maintainer"'));
    assert.ok(searcherContent.includes("name: wiki-searcher"));
  });

  it("loadBundledSkills_loads_and_registers_in_skill_registry", async () => {
    const skills = await loadBundledSkills();
    assert.ok(skills.has("wiki-maintainer"));
    assert.ok(skills.has("wiki-searcher"));

    const searcher = skills.get("wiki-searcher");
    assert.ok(searcher);
    assert.ok(searcher.toolNames && searcher.toolNames.includes("wiki_search"));

    // Register into Prism SkillRegistry
    const registry = createSkillRegistry();
    for (const skill of skills.values()) {
      registry.register(skill);
    }

    assert.equal(registry.resolve("wiki-maintainer").name, "wiki-maintainer");
    assert.equal(registry.resolve("wiki-searcher").name, "wiki-searcher");
  });
});
