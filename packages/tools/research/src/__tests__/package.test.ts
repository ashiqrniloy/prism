import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import toolsResearch from "../index.js";

const MODEL = { provider: "mock", model: "m" };

describe("@arnilo/prism-tools/research package", () => {
  it("research_package_conformance", async () => {
    const result = await packageConformance(toolsResearch());
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("research_registers_skills_and_cite", async () => {
    const agent = await createAgent({ model: MODEL, packages: [toolsResearch()] });
    try {
      assert.deepEqual(agent.skills.map((skill) => skill.name).sort(), [
        "research-report",
        "research-scoping",
        "research-synthesis",
        "source-triage",
      ]);
      assert.equal(agent.tools.find((tool) => tool.name === "cite")?.effects?.length, 0);
      assert.equal(
        agent.commands.list().some((command) => command.name === "research.verify"),
        true,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("unknown_config_key_rejected", async () => {
    await assert.rejects(() => createAgent({ model: MODEL, packages: [toolsResearch({ nope: true } as never)] }), /unknown key "nope"/);
    await assert.rejects(() => createAgent({ model: MODEL, packages: [toolsResearch({ maxRepairs: 4 })] }), /maxRepairs/);
  });
});
