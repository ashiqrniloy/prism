import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JsonObject } from "@arnilo/prism";
import { MemoryValidationError } from "../errors.js";
import { mergeJsonObjects } from "../util.js";

/**
 * Reference implementation of the pre-070.11 merge: sequential per-key deep merge, patch
 * values assigned without cloning. Used only to prove the delegation kept merge *values*
 * identical on the same inputs.
 */
function legacyMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    const bothPlain =
      typeof current === "object" &&
      current !== null &&
      !Array.isArray(current) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value);
    result[key] = bothPlain ? legacyMerge(current as JsonObject, value as JsonObject) : value;
  }
  return result as JsonObject;
}

const FIXTURES: readonly (readonly [JsonObject, JsonObject])[] = [
  [{}, {}],
  [{ a: 1, b: "two", c: null }, {}],
  [{ a: 1 }, { a: 2, b: 3 }],
  [{ nested: { a: 1, b: { c: 2 } } }, { nested: { b: { d: 3 }, e: 4 } }],
  [
    { list: [1, 2, 3], s: "x" },
    { list: [4], s: { deep: true } },
  ],
  [{ obj: { keep: 1 } }, { obj: [1, 2] }],
  [{ obj: [1, 2] }, { obj: { replace: true } }],
  [{ nested: { a: null } }, { nested: { a: { b: 1 } } }],
  [{ nested: { a: { b: 1 } } }, { nested: { a: null } }],
  [{ deep: { one: { two: { three: 3 } } } }, { deep: { one: { two: { four: 4 } } } }],
];

describe("memory json merge (plan 070 Task 11)", () => {
  it("merge_memory_json_objects_is_value_identical_to_the_legacy_merge", () => {
    for (const [base, patch] of FIXTURES) {
      assert.deepEqual(
        mergeJsonObjects(structuredClone(base), structuredClone(patch)),
        legacyMerge(base, patch),
        JSON.stringify({ base, patch }),
      );
    }
  });

  it("merge_memory_json_objects_deep_merges_objects_and_replaces_arrays_and_scalars", () => {
    const merged = mergeJsonObjects({ a: { b: 1, c: 2 }, list: [1, 2], s: "old" }, { a: { c: 3, d: 4 }, list: [9], s: "new" });
    assert.deepEqual(merged, { a: { b: 1, c: 3, d: 4 }, list: [9], s: "new" });
  });

  it("merge_memory_json_objects_clones_patch_and_base_values", () => {
    const base = { keep: { a: 1 } };
    const patch = { added: { b: 2 }, list: [1] };
    const merged = mergeJsonObjects(base, patch);
    assert.deepEqual(merged, { keep: { a: 1 }, added: { b: 2 }, list: [1] });
    assert.notEqual(merged.keep, base.keep, "base object cloned");
    assert.notEqual(merged.added, patch.added, "patch object cloned (legacy aliased it)");
    assert.notEqual(merged.list, patch.list, "patch array cloned");
    (merged.added as { b: number }).b = 99;
    (merged.list as number[]).push(2);
    assert.deepEqual(patch, { added: { b: 2 }, list: [1] }, "mutating the merge result cannot reach the caller's patch");
  });

  it("merge_memory_json_objects_rejects_unsafe_keys_at_any_depth", () => {
    // JSON.parse builds own `__proto__` keys (an object literal would set the prototype).
    const unsafePatches: readonly string[] = [
      '{"__proto__":{"injected":true}}',
      '{"nested":{"constructor":{"x":1}}}',
      '{"nested":{"deep":{"prototype":1}}}',
    ];
    for (const json of unsafePatches) {
      assert.throws(
        () => mergeJsonObjects({}, JSON.parse(json) as JsonObject),
        (error: unknown) => error instanceof MemoryValidationError && error.code === "validation",
        json,
      );
    }
  });

  it("merge_memory_json_objects_rejects_non_json_values", () => {
    const patches: readonly unknown[] = [{ a: undefined }, { a: () => 1 }, { a: Number.NaN }, { a: new Date(0) }, { a: new Map() }];
    for (const patch of patches) {
      assert.throws(
        () => mergeJsonObjects({}, patch as JsonObject),
        (error: unknown) => error instanceof MemoryValidationError && error.code === "validation",
        JSON.stringify(patch) ?? String(patch),
      );
    }
    assert.throws(
      () => mergeJsonObjects(null as unknown as JsonObject, {}),
      (error: unknown) => error instanceof MemoryValidationError && /memory value/.test(error.message),
      "non-object base",
    );
  });
});
