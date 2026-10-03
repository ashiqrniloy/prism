import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { HOOK_CATALOG, type HookName, type HookRegistrar, type LoopStrategy, type ObserveHookName, defaultLoop } from "../index.js";
import { loopConformance } from "../testing/index.js";

/**
 * Catalog coverage (plan 144 Task 6). Every catalog hook must have a case, and every observe hook
 * must actually reach the session's observe dispatch path from both the default loop and a custom
 * loop. Named hooks are exercised directly; observe hooks get two kinds of proof — a real kernel
 * scenario per emit family (below) and an exhaustive synthetic emission of every observe type
 * (which also covers host-only events like `package.event` and the retired-loop artifact events).
 * Adding a named hook to the catalog without listing it in {@link NAMED_HOOKS} fails the
 * completeness assertion.
 */

const NAMED_HOOKS = [
  "run.input",
  "turn.before",
  "context.build",
  "model.request",
  "model.call",
  "model.response",
  "tool.call",
  "tool.execute",
  "tool.result",
  "message.append",
  "run.end",
  "compaction.when",
] as const;

/** One real kernel scenario per observe emit family, keyed by the family id. */
const OBSERVE_FAMILIES = {
  run: "run.started",
  turn: "turn.started",
  provider: "turn.started",
  message: "message.delta",
  tool: "tool.started",
  compaction: "compaction.started",
  error: "hook.error",
  limits: "run.failed",
} as const satisfies Record<string, ObserveHookName>;

/** Every observe hook in the catalog, derived so a new hook is covered automatically. */
const OBSERVE_HOOKS = (Object.keys(HOOK_CATALOG) as HookName[]).filter(
  (name) => HOOK_CATALOG[name].kind === "observe",
) as ObserveHookName[];

/** A custom plan-then-act loop that routes every tool through `executeTools` and ends through `end`. */
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

const LOOPS: readonly (readonly [string, LoopStrategy])[] = [
  ["defaultLoop", defaultLoop],
  ["customLoop", planThenAct],
];

const alwaysCallsTool = {
  id: "mock",
  async *generate() {
    yield { type: "tool_call" as const, call: { type: "tool_call" as const, id: "loop-call", name: "echo", arguments: {} } };
    yield { type: "done" as const };
  },
};

describe("hook catalog coverage", () => {
  it("every_catalog_hook_has_a_coverage_case", () => {
    const catalogNames = new Set(Object.keys(HOOK_CATALOG) as HookName[]);
    for (const name of catalogNames) {
      if (HOOK_CATALOG[name].kind === "observe") {
        assert.ok(OBSERVE_HOOKS.includes(name as ObserveHookName), `observe hook ${name} is missing from the derived observe list`);
      } else {
        assert.ok((NAMED_HOOKS as readonly string[]).includes(name), `named hook ${name} has no coverage case`);
      }
    }
    // The reverse: no stale case names.
    for (const name of NAMED_HOOKS) assert.ok(catalogNames.has(name), `${name} is not a catalog hook`);
    for (const [family, representative] of Object.entries(OBSERVE_FAMILIES)) {
      assert.ok(catalogNames.has(representative), `family ${family} representative ${representative} is not a catalog hook`);
    }
  });

  for (const [loopName, loop] of LOOPS) {
    for (const name of NAMED_HOOKS) {
      it(`${name}_fires_from_${loopName}`, async () => {
        const forceCompact: ((hooks: HookRegistrar) => void) | undefined =
          name === "compaction.when" ? (hooks) => hooks.on("compaction.when", () => ({ compact: true })) : undefined;
        const { fired } = await loopConformance({ loop, ...(forceCompact ? { hooks: forceCompact } : {}) });
        assert.ok(fired.has(name), `${name} did not fire from ${loopName}`);
      });
    }

    it(`observe_representatives_fire_from_${loopName}`, async () => {
      const base = await loopConformance({ loop });
      for (const family of ["run", "turn", "provider", "message", "tool"] as const) {
        assert.ok(base.fired.has(OBSERVE_FAMILIES[family]), `${OBSERVE_FAMILIES[family]} did not fire from ${loopName}`);
      }
      const compaction = await loopConformance({ loop, hooks: (h) => h.on("compaction.when", () => ({ compact: true })) });
      assert.ok(compaction.fired.has("compaction.started"), `compaction_started did not fire from ${loopName}`);
      const error = await loopConformance({
        loop,
        hooks: (h) =>
          h.on("run.started", () => {
            throw new Error("observer boom");
          }),
      });
      assert.ok(error.fired.has("hook.error"), `hook.error did not fire from ${loopName}`);
      const limits = await loopConformance({ loop, limits: { maxTurns: 1 }, provider: alwaysCallsTool });
      assert.ok(limits.fired.has("run.failed"), `run.failed did not fire from ${loopName}`);
    });

    it(`every_observe_hook_fires_from_${loopName}`, async () => {
      const { fired } = await loopConformance({ loop, emitEvents: OBSERVE_HOOKS });
      for (const name of OBSERVE_HOOKS) assert.ok(fired.has(name), `${name} did not fire from ${loopName}`);
    });
  }
});
