import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type AgentConfig, createAgent, createMemorySessionStore, type LoopStrategy } from "../index.js";
import { assertGateIntegrity } from "../testing/tool-conformance.js";

/**
 * Plan 177 Task 6: the safety-gate invariants ship as a published conformance check, so a third-party
 * loop proves it keeps them instead of re-deriving the proof. The default loop and a custom loop pass;
 * a loop that skips the tool pipeline fails, named.
 */

/** A plan-then-act custom loop: the gate is not the default loop's private behaviour. */
const planThenAct: LoopStrategy = {
  name: "plan-then-act",
  revision: "1",
  async run(run) {
    for (;;) {
      for (;;) {
        const turn = await run.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length === 0) {
          if (turn.steered) continue;
          break;
        }
        await run.executeTools(turn.toolCalls);
      }
      const end = await run.end();
      if (!end.continue) return;
    }
  },
};

/** Takes every provider turn and dispatches nothing: the gate never sees a tool call. */
const bypass: LoopStrategy = {
  name: "bypass",
  revision: "1",
  async run(run) {
    for (;;) {
      const turn = await run.turn();
      if (turn.stopped) return;
      if (turn.toolCalls.length === 0) {
        if (turn.steered) continue;
        return;
      }
      // No `run.executeTools`: the calls vanish instead of being gated.
    }
  },
};

function withLoop(config: AgentConfig, loop?: LoopStrategy): AgentConfig {
  return {
    ...config,
    slots: { store: createMemorySessionStore(), ...config.slots, ...(loop ? { loop } : {}) },
  };
}

describe("gate integrity conformance (plan 177 Task 6)", () => {
  it("gate_integrity_default_loop", async () => {
    await assertGateIntegrity({ createAgent: (config) => createAgent(withLoop(config)) });
  });

  it("gate_integrity_custom_loop", async () => {
    await assertGateIntegrity({ createAgent: (config) => createAgent(withLoop(config, planThenAct)) });
  });

  it("gate_integrity_detects_bypass", async () => {
    await assert.rejects(
      assertGateIntegrity({ createAgent: (config) => createAgent(withLoop(config, bypass)) }),
      /gate integrity: rewrite_is_regated/,
    );
  });
});
