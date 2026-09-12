import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createSkillRegistry } from "@arnilo/prism";
import { deployWikiSkills, loadBundledSkills, parseSkillMarkdown, wikiMaintainerSkill } from "../skills.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "prism-wiki-skills-"));

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
    assert.ok(maintainerContent.includes("Compilation over Duplication"));
    assert.ok(maintainerContent.includes("Precise Source Anchors"));
    assert.ok(maintainerContent.includes("Contradiction Reconciliation"));
    assert.ok(maintainerContent.includes("Synchronized Catalogs and Ledgers"));
    assert.ok(maintainerContent.includes("OKF"));
    assert.ok(maintainerContent.includes("type"));
    assert.ok(maintainerContent.includes("generated"));
    assert.ok(yamlContent.includes('display_name: "Wiki Maintainer"'));
    assert.ok(searcherContent.includes("name: wiki-searcher"));
  });

  it("loadBundledSkills_loads_and_registers_in_skill_registry", async () => {
    const skills = await loadBundledSkills();
    assert.ok(skills.has("wiki-maintainer"));
    assert.ok(skills.has("wiki-searcher"));

    const searcher = skills.get("wiki-searcher");
    assert.ok(searcher);
    assert.ok(searcher.toolNames?.includes("wiki_search"));

    // Register into Prism SkillRegistry
    const registry = createSkillRegistry();
    for (const skill of skills.values()) {
      registry.register(skill);
    }

    assert.equal(registry.resolve("wiki-maintainer").name, "wiki-maintainer");
    assert.equal(registry.resolve("wiki-searcher").name, "wiki-searcher");
  });

  it("wiki_maintainer_skill_contains_ingest_procedure_and_okf_sources", async () => {
    const skills = await loadBundledSkills();
    const maintainer = skills.get("wiki-maintainer");
    assert.ok(maintainer);
    const instructions = maintainer.instructions ?? "";
    // Karpathy ingest procedure: catalog first, integrate don't duplicate, OKF sources, log, immutable raw.
    assert.ok(instructions.includes("Ingest One Source"));
    assert.ok(instructions.includes("sources[].id"));
    assert.ok(instructions.includes("read-only"));
    assert.ok(instructions.includes("**Ingested**"));
    assert.ok(instructions.includes("One source per ingest"));
  });

  it("skill_description_mentions_ingest", async () => {
    const skills = await loadBundledSkills();
    assert.match(skills.get("wiki-maintainer")?.description ?? "", /ingest/i);
    // Fallback static definition stays in sync with the shipped SKILL.md.
    assert.match(wikiMaintainerSkill.description ?? "", /ingest/i);
    assert.match(wikiMaintainerSkill.instructions ?? "", /Ingest/i);
  });
});
