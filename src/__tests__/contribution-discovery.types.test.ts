import { describe, it } from "node:test";
import type { ContributionFileKind, DiscoveredContribution } from "../index.js";

// ponytail: compile-only type test — no runtime assertions. Task 5 adds behavior tests.
describe("DiscoveredContribution types (compile only)", () => {
  it("accepts a skill-kind contribution carrying a Skill", () => {
    const contribution: DiscoveredContribution = {
      kind: "skill",
      name: "greeter",
      origin: "workspace",
      path: "/.agents/skills/greeter/SKILL.md",
      skill: { name: "greeter", description: "greets", instructions: "say hi", toolNames: ["greet-tool"] },
    };
    const kind: ContributionFileKind = contribution.kind;
    void kind;
  });

  it("accepts a tool-kind contribution carrying a declaration", () => {
    const contribution: DiscoveredContribution = {
      kind: "tool",
      name: "my-tool",
      origin: "workspace",
      path: "/repo/.agents/tools/my-tool/manifest.json",
      declaration: {
        kind: "tool",
        name: "my-tool",
        module: "@scope/my-tool",
        exportName: "default",
        metadata: { discovered: true },
      },
      metadata: { discovered: true },
    };
    const kind: ContributionFileKind = contribution.kind;
    void kind;
  });
});
