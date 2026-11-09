/**
 * Plan 210 Task 7: a host config written before the audit removals fails closed with a named error, and
 * `docs/migrate-to-0.13.md` carries the migration hint for each removed field. The shipped presets are untouched.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent, PackageLoadError } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import memorySystem from "../../index.js";

const MIGRATION = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "..", "..", "docs", "migrate-to-0.13.md"), "utf8");

async function load(config: Record<string, unknown>): Promise<void> {
  const agent = await createAgent({
    model: "mock/main",
    packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), memorySystem({ ltm: config as never })],
  });
  await agent.dispose();
}

/** [config a 0.12-era host wrote, the error it fails with, the field name the migration page lists]. */
const unknownKey = (key: string) => new RegExp(`unknown key "${key}"`);
// `consolidate` accepts a boolean or an object, so the kernel names the path rather than the key.
const consolidateShape = /\/consolidate does not match any allowed shape/;
const REMOVED: readonly (readonly [Record<string, unknown>, RegExp, string])[] = [
  [{ scoped: { scopeRoot: "/tmp/x" } }, unknownKey("scoped"), "config `scoped`"],
  [{ retrieval: "hybrid" }, unknownKey("retrieval"), "config `retrieval`"],
  [{ limits: { maxVectorDimensions: 8 } }, unknownKey("maxVectorDimensions"), "`limits.maxVectorDimensions`"],
  [{ linker: true }, unknownKey("linker"), "config `linker`"],
  [{ evolution: true }, unknownKey("evolution"), "`evolution`"],
  [{ passive: true }, unknownKey("passive"), "`passive`"],
  [{ state: true }, unknownKey("state"), "config `state`"],
  [{ consolidate: { decider: "model" } }, consolidateShape, "`consolidate.decider`"],
  [{ consolidate: { model: "mock/main" } }, consolidateShape, "`consolidate.model`"],
  [{ recall: { supersessionHint: "all" } }, unknownKey("supersessionHint"), "`recall.supersessionHint`"],
  [{ lifecycle: { widen: { minProjects: 3 } } }, unknownKey("widen"), "`lifecycle.widen`"],
  // Plan 216 Task 7: long-term working memory and episode merging.
  [{ workingMemoryTemplate: "Name: {{name}}" }, unknownKey("workingMemoryTemplate"), "`ltm.workingMemoryTemplate`"],
  [{ limits: { maxWorkingMemoryBytes: 64 } }, unknownKey("maxWorkingMemoryBytes"), "`ltm.limits.maxWorkingMemoryBytes`"],
  [{ lifecycle: { merge: { episodes: { minCluster: 5 } } } }, unknownKey("episodes"), "`ltm.lifecycle.merge.episodes`"],
  [{ inject: { kinds: ["working"] } }, /\/ltm\/inject/, '`"working"` in `ltm.inject.kinds`'],
];

describe("removed fabric config (plan 210 Task 7)", () => {
  it("previous_revision_host_config_still_validates_or_fails_with_named_migration_error", async () => {
    for (const [config, failure, listed] of REMOVED) {
      await assert.rejects(
        load(config),
        (error: unknown) => error instanceof PackageLoadError && failure.test(error.message),
        `${listed} fails closed with a named error`,
      );
      assert.ok(MIGRATION.includes(listed), `docs/migrate-to-0.13.md lists ${listed}`);
    }
    // A removed decision point is not an enum member any more.
    await assert.rejects(load({ decisions: { model: "mock/d1", points: ["P1"] } }), PackageLoadError);
    assert.ok(MIGRATION.includes('`decisions.points` entries `"P1"`, `"P2"`, `"P6"`'));
    // The shipped presets are unchanged: a config written for revision 1 or 2 still validates.
    await load({ preset: "conversational", store: "memory" });
    await load({ preset: "coding", store: "memory" });
    await load({ preset: "conversational", store: "memory", inject: { budgetTokens: 2000 } });
  });
});
