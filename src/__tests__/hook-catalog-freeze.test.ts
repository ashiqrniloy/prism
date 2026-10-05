import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { HOOK_CATALOG, createSlotDefaults, createSlotRegistry } from "../index.js";
import { HOOK_COMBINATION, type DecideCombination } from "../hooks/index.js";
import type { SlotContracts, SlotName } from "../index.js";

/**
 * Phase 1 freeze (plan 145 Task 6). Phase 2 (disable/enable, per-slot scopes, extra
 * combination rules) is additive work on top of the catalog Part A defined, so the catalog is
 * pinned as data rather than left to the compat baseline — the baseline records type names, not
 * the runtime hook table, the slot set, or the decide-combination rules.
 *
 * Every change here is deliberate and lands as a one-line diff in review. If Phase 2 needs to
 * widen the surface, edit the frozen array and say why in the same commit; the failure message
 * points at the doc so the contract and the prose are edited together.
 */

const FROZEN_PHASE_1_NAMED_CATALOG: readonly string[] = [
  "run.input:transform",
  "turn.before:decide",
  "context.build:transform",
  "model.request:transform",
  "model.call:around",
  "model.response:transform",
  "tool.call:decide",
  "tool.execute:around",
  "tool.result:transform",
  "message.append:transform",
  "run.end:decide",
  "compaction.when:decide",
];

/**
 * The frozen 0.13.0 event catalog (roadmap §2.3, plan 148 Task 3): every observe hook is one
 * `AgentEventPayload["type"]`, and these are the only legal names. A new event type must be
 * listed here deliberately, in the same edit that widens the union.
 */
const FROZEN_PHASE_1_OBSERVE_CATALOG: readonly string[] = [
  "session.opened",
  "session.closed",
  "run.started",
  "run.completed",
  "run.failed",
  "run.suspended",
  "turn.started",
  "turn.completed",
  "message.delta",
  "message.completed",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "decision.pending",
  "decision.resolved",
  "compaction.started",
  "compaction.completed",
  "background.started",
  "background.completed",
  "background.failed",
  "hook.error",
  "package.status",
  "package.event",
];

const FROZEN_PHASE_1_SLOTS: readonly SlotName[] = ["loop", "compaction", "store", "credentials"];

const FROZEN_PHASE_1_COMBINATION: Readonly<Record<string, DecideCombination>> = {
  "turn.before": "any-stop",
  "tool.call": "tool-call",
  "run.end": "first-continue",
  "compaction.when": "any-compact",
};

const DOCS = "docs/next/events.md (event catalog), docs/next/hooks.md (hook catalog), and docs/next/slots.md (slot contracts)";

describe("hook catalog is frozen for phase 2", () => {
  it("hook_catalog_is_frozen_for_phase_2", () => {
    const entries = Object.entries(HOOK_CATALOG);
    const named = entries.filter(([, entry]) => entry.kind !== "observe").map(([name, entry]) => `${name}:${entry.kind}`);
    const observe = entries.filter(([, entry]) => entry.kind === "observe").map(([name]) => name);

    assert.deepEqual(named, FROZEN_PHASE_1_NAMED_CATALOG, `named hook catalog changed; update ${DOCS}`);
    assert.deepEqual(observe, FROZEN_PHASE_1_OBSERVE_CATALOG, `observe hook catalog changed; update ${DOCS}`);
    // Insertion order is part of the pin: a moved entry is a rename, which is exactly the
    // change a set comparison would hide.
    assert.deepEqual(Object.keys(HOOK_CATALOG), [
      ...FROZEN_PHASE_1_NAMED_CATALOG.map((n) => n.slice(0, n.indexOf(":"))),
      ...FROZEN_PHASE_1_OBSERVE_CATALOG,
    ]);
  });

  it("decide_hook_combination_rules_are_frozen", () => {
    // `tool.call` is the security-relevant one: deny precedence is how a host gate beats a host
    // approval, so a change to this table must never land silently.
    assert.deepEqual(HOOK_COMBINATION, FROZEN_PHASE_1_COMBINATION, `decide combination rules changed; update ${DOCS}`);
  });

  it("slot_names_and_defaults_are_frozen", () => {
    // A fifth slot must be added to SlotContracts and to this list in one change.
    const contracts: readonly (keyof SlotContracts)[] = FROZEN_PHASE_1_SLOTS;
    const registry = createSlotRegistry(createSlotDefaults());
    for (const name of contracts) {
      assert.ok(registry.default(name), `slot ${name} has no kernel default; update ${DOCS}`);
    }
  });
});
