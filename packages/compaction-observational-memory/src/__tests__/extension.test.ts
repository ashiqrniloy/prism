import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createExtensionKernel } from "prism";
import { createObservationalMemoryExtension } from "../index.js";

describe("observational memory extension", () => {
  it("observational_memory_extension_registers_inert_contributions", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([createObservationalMemoryExtension({ keepRecentEntries: 3 })]);
    const strategies = kernel.registries.compactionStrategies.list();
    assert.equal(strategies.length, 1);
    assert.equal(strategies[0]?.name, "observational-memory");
    assert.equal(kernel.registries.tools.list().length, 0);
    assert.equal(kernel.registries.commands.list().length, 0);
  });

  it("observational_memory_extension_can_skip_strategy_registration", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([createObservationalMemoryExtension({ registerCompactionStrategy: false })]);
    assert.equal(kernel.registries.compactionStrategies.list().length, 0);
  });

  it("observational_memory_extension_registers_optional_tool_and_commands", async () => {
    const kernel = createExtensionKernel();
    const getEntries = () => [];
    await kernel.load([createObservationalMemoryExtension({ recallTool: { getEntries }, commands: { getEntries } })]);
    assert.equal(kernel.registries.tools.resolve("recall").name, "recall");
    assert.deepEqual(kernel.registries.commands.list().map((command) => command.name), ["om:status", "om:view"]);
  });
});
