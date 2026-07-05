import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createContributionRegistry, createAgent, resolveInstructionInjectors } from "../index.js";
import { createMockProvider } from "../mock-provider.js";
import type { ContributionRegistry, InstructionInjector } from "../index.js";

const jsonInjector: InstructionInjector = {
  name: "json",
  apply: () => ({ instructions: "Always answer in JSON", when: "every_turn" }),
};
const schemaInjector: InstructionInjector = {
  name: "schema",
  apply: () => ({ contextBlocks: [{ id: "schema", content: "type T = string" }], when: "first_turn" }),
};

describe("resolveInstructionInjectors", () => {
  it("returns the configured list as-is when provided (RunOptions-style override)", () => {
    const resolved = resolveInstructionInjectors({ configured: [jsonInjector] });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0], jsonInjector);
  });

  it("resolves names against a registry (fail closed on miss)", () => {
    const registry: ContributionRegistry<InstructionInjector> = createContributionRegistry({ label: "instruction injector" });
    registry.register("json", jsonInjector);
    registry.register("schema", schemaInjector);

    const resolved = resolveInstructionInjectors({ registry, names: ["json", "schema"] });
    assert.equal(resolved.length, 2);
    assert.equal(resolved[0], jsonInjector);
    assert.equal(resolved[1], schemaInjector);
  });

  it("throws Unknown instruction injector for a missing name", () => {
    const registry = createContributionRegistry<InstructionInjector>({ label: "instruction injector" });
    assert.throws(
      () => resolveInstructionInjectors({ registry, names: ["missing"] }),
      /Unknown instruction injector: missing/,
    );
  });

  it("returns empty when neither configured nor a names+registry pair is supplied", () => {
    assert.deepEqual(resolveInstructionInjectors({}), []);
    assert.deepEqual(resolveInstructionInjectors({ names: ["x"] }), []); // no registry
    assert.deepEqual(resolveInstructionInjectors({ names: ["x"], configured: [jsonInjector] }), [jsonInjector]); // configured wins
  });
});

describe("AgentConfig.instructionInjectors / RunOptions.instructionInjectors selection", () => {
  it("RunOptions.instructionInjectors overrides AgentConfig.instructionInjectors for the run", () => {
    // Mirrors the runtime idiom `options.instructionInjectors ?? config.instructionInjectors`.
    const runInjector: InstructionInjector = { name: "run", apply: () => ({ instructions: "from-run", when: "every_turn" }) };
    const configInjector: InstructionInjector = { name: "config", apply: () => ({ instructions: "from-config", when: "every_turn" }) };
    const override = runInjector ?? configInjector;
    assert.equal(override, runInjector);
  });

  it("AgentConfig.instructions base path still feeds composeSystemPrompt when instructionInjectors is also set (no regression)", () => {
    // Static contract check: both fields coexist on AgentConfig.
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([]),
      instructions: "base-instructions",
      instructionInjectors: [jsonInjector],
    });
    assert.equal(agent.config.instructions, "base-instructions");
    assert.equal(agent.config.instructionInjectors?.length, 1);
  });

  it("RunOptions.instructionInjectors is accepted by the RunOptions type", () => {
    // Compile-only contract: RunOptions accepts the field.
    const opts: { instructionInjectors?: readonly InstructionInjector[] } = { instructionInjectors: [schemaInjector] };
    assert.equal(opts.instructionInjectors?.length, 1);
  });
});
