import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DiscoveredContribution, Skill } from "../contracts.js";
import { createContributionRegistries, registerDiscoveredContributions } from "../index.js";

function skillContribution(name: string, skill: Skill): DiscoveredContribution {
  return { kind: "skill", name, origin: "workspace", path: `/s/${name}/SKILL.md`, skill };
}

describe("registerDiscoveredContributions", () => {
  it("registers a skill contribution fully resolvable via registries.skills", () => {
    const registries = createContributionRegistries();
    registerDiscoveredContributions(registries, [
      skillContribution("my-skill", { name: "my-skill", description: "d", instructions: "i", toolNames: ["t"] }),
    ]);

    const skill = registries.skills.resolve("my-skill");
    assert.equal(skill.description, "d");
    assert.deepEqual([...(skill.toolNames ?? [])], ["t"]);
  });

  it("registers a tool descriptor whose execute() throws; no execution", () => {
    const registries = createContributionRegistries();
    registerDiscoveredContributions(registries, [
      {
        kind: "tool",
        name: "t",
        origin: "global",
        path: "/t/manifest.json",
        declaration: { kind: "tool", name: "t", module: "@scope/t", exportName: "default" },
      },
    ]);

    const tool = registries.tools.resolve("t");
    assert.equal(tool.name, "t");
    assert.throws(
      () => tool.execute({}, { sessionId: "s", runId: "r", toolCallId: "c" }),
      /requires host execution/,
    );
  });

  it("registers a context provider descriptor whose resolve() throws", async () => {
    const registries = createContributionRegistries();
    registerDiscoveredContributions(registries, [
      {
        kind: "context",
        name: "ctx",
        origin: "workspace",
        path: "/c/manifest.json",
        declaration: { kind: "contextProvider", name: "ctx", module: "@scope/c" },
      },
    ]);

    const provider = registries.contextProviders.resolve("ctx");
    assert.equal(provider.name, "ctx");
    await assert.rejects(async () => provider.resolve({} as never), /requires host execution/);
  });

  it("registers an instructions descriptor with empty text and resource metadata (host lifts)", () => {
    const registries = createContributionRegistries();
    registerDiscoveredContributions(registries, [
      {
        kind: "instructions",
        name: "instr",
        origin: "workspace",
        path: "/i/manifest.json",
        declaration: { kind: "systemPromptContribution", name: "instr", resource: "/i/prompt.md" },
      },
    ]);

    const contribution = registries.systemPromptContributions.resolve("instr");
    assert.equal(contribution.id, "instr");
    assert.equal(contribution.source, "package");
    assert.equal(contribution.mode, "append");
    assert.equal(contribution.text, ""); // ponytail: core fs-free; Phase 30 lifts resource into text
    assert.equal(contribution.metadata?.discovered, true);
    assert.equal(contribution.metadata?.resource, "/i/prompt.md");
  });

  it("last-write-wins when registering the same (kind, name) twice", () => {
    const registries = createContributionRegistries();
    registerDiscoveredContributions(registries, [
      skillContribution("dup", { name: "dup", description: "first" }),
    ]);
    registerDiscoveredContributions(registries, [
      skillContribution("dup", { name: "dup", description: "second" }),
    ]);

    assert.equal(registries.skills.resolve("dup").description, "second");
    assert.equal(registries.skills.list().length, 1);
  });
});
