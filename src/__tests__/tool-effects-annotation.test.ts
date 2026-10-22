import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  createLoadSkillTool,
  createSkillRegistry,
  createToolRegistry,
  resolveToolEffects,
  ToolDefinitionError,
  type ToolDefinition,
} from "../index.js";

const noop = (): never => {
  throw new Error("not executed");
};

function tool(effects: unknown): ToolDefinition {
  return { name: "t", effects, execute: noop } as unknown as ToolDefinition;
}

describe("ToolDefinition.effects", () => {
  it("tool_effects_rejects_unknown_duplicate_and_non_array", () => {
    const bad: readonly unknown[] = [["bogus"], ["read", "read"], "read", 5, {}, [null]];
    for (const effects of bad) {
      assert.throws(
        () => createToolRegistry([tool(effects)]),
        (error: unknown) => error instanceof ToolDefinitionError && error.code === "ERR_PRISM_TOOL_EFFECTS",
        `expected ${JSON.stringify(effects)} to be rejected`,
      );
    }
    const registry = createToolRegistry();
    assert.throws(
      () => registry.register(tool(["nope"])),
      (error: unknown) => error instanceof ToolDefinitionError && error.code === "ERR_PRISM_TOOL_EFFECTS",
    );
    // A valid annotation registers, and registration is the only place validation runs.
    registry.register(tool(["read", "network"]));
    assert.deepEqual(registry.resolve("t").effects, ["read", "network"]);
  });

  it("tool_effects_default_is_all_kinds", () => {
    const resolved = resolveToolEffects(tool(undefined));
    assert.notDeepEqual(resolved, []);
    assert.deepEqual([...resolved].sort(), ["execute", "external", "network", "read", "write"]);
    assert.deepEqual(resolveToolEffects(tool(["network"])), ["network"]);
  });

  it("kernel_load_skill_declares_effects", () => {
    assert.deepEqual(createLoadSkillTool({ registry: createSkillRegistry() }).effects, ["read"]);
  });
});
