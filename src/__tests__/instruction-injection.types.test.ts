import { describe, it } from "node:test";
import type {
  InstructionContribution,
  InstructionContext,
  InstructionInjector,
  InstructionTiming,
} from "../index.js";

// ponytail: compile-only type test — no runtime assertions. Tasks 5/6 add behavior tests.
describe("InstructionInjector types (compile only)", () => {
  it("accepts an every_turn injector with instructions", () => {
    const injector: InstructionInjector = {
      name: "json-always",
      description: "always require JSON output",
      apply: () => ({ instructions: "Always answer in JSON", when: "every_turn" }),
    };
    const timing: InstructionTiming = injector.apply({} as InstructionContext).when;
    void timing;
  });

  it("accepts an on_input contribution with a predicate and contextBlocks", () => {
    const contribution: InstructionContribution = {
      contextBlocks: [{ id: "schema", content: "type T = string" }],
      when: "on_input",
      predicate: (ctx) => ctx.turn > 0,
    };
    const when: InstructionTiming = contribution.when;
    void when;
  });

  it("InstructionContext mirrors the runtime turn scope", () => {
    const ctx: InstructionContext = {
      sessionId: "s",
      runId: "r",
      turn: 1,
      input: [],
      history: [],
      metadata: {},
      signal: new AbortController().signal,
    };
    if (ctx.turn !== 1) throw new Error("turn should default-in at construction");
  });
});
