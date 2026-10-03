import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, createMockProvider, providerDone } from "@arnilo/prism";
import { observationalMemory } from "../index.js";

describe("observational memory package", () => {
  it("observational_memory_package_registers_nothing_without_options", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "memory" },
      packages: [observationalMemory()],
    });
    try {
      const inspected = agent.inspect();
      assert.equal(inspected.tools.length, 0);
      assert.equal(inspected.commands.length, 0);
    } finally {
      await agent.dispose();
    }
  });

  it("om_package_registers_recall_only_when_enabled", async () => {
    const getEntries = () => [];
    const hidden = observationalMemory({ recallTool: { getEntries }, commands: { getEntries } })({ recall: false });
    let seen: readonly string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "memory" },
      provider: createMockProvider([providerDone()], {
        onRequest: (request) => {
          seen = (request.tools ?? []).map((tool) => tool.name);
        },
      }),
      packages: [hidden],
    });
    try {
      assert.equal(
        agent.inspect().tools.some((tool) => tool.name === "recall"),
        true,
      );
      assert.deepEqual(
        agent
          .inspect()
          .commands.map((command) => command.name)
          .sort(),
        ["om:status", "om:view"],
      );
      const session = await agent.session({ id: "om", create: true });
      await session.run("recall?");
      await session.close();
      assert.equal(seen.includes("recall"), false);
    } finally {
      await agent.dispose();
    }

    seen = [];
    const shown = await createAgent({
      model: { provider: "mock", model: "memory" },
      provider: createMockProvider([providerDone()], {
        onRequest: (request) => {
          seen = (request.tools ?? []).map((tool) => tool.name);
        },
      }),
      packages: [observationalMemory({ recallTool: { getEntries } })],
    });
    try {
      const session = await shown.session({ id: "om-on", create: true });
      await session.run("recall?");
      await session.close();
      assert.equal(seen.includes("recall"), true);
    } finally {
      await shown.dispose();
    }
  });
});
