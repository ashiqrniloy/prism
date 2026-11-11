import assert from "node:assert/strict";
import { test } from "bun:test";
import { createStateMatchScorer, scoreRun } from "../index.js";
import type { DatasetItem } from "../index.js";

const result = { sessionId: "s", runId: "r", status: "completed" as const, text: "ok", content: [], messages: [] };

async function grade(expected: unknown, environment: unknown, mode: "exact" | "subset" = "exact", ignore?: readonly string[]) {
  return (await scoreRun({ result, environment, scorers: [createStateMatchScorer({ expected, mode, ignore })] }))[0]!;
}

test("subset_match_passes_with_extra_fields", async () => {
  assert.equal((await grade({ rows: [{ id: 1 }] }, { rows: [{ id: 1, extra: true }, { id: 2 }] }, "subset")).score, 1);
  assert.equal((await grade([1, 2], [2, 1], "subset")).score, 0);
  assert.equal((await grade([1, 1], [1], "subset")).score, 0);
});

test("exact_match_fails_with_extra_fields", async () => {
  assert.equal((await grade({ a: 1 }, { a: 1, b: 2 })).score, 0);
  assert.equal((await grade([1], [1, 2])).score, 0);
  assert.equal((await grade({ a: 1, b: null }, { b: null, a: 1 })).score, 1);
  for (const [expected, actual] of [
    [null, {}],
    [[], {}],
    [1, "1"],
    [{ a: null }, {}],
  ]) {
    assert.equal((await grade(expected, actual)).score, 0);
  }
});

test("ignore_pointer_excludes_field_without_mutating_states", async () => {
  const expected = { "a/b": { "~key": 1 }, rows: [1, 2], updatedAt: "before" };
  const actual = { "a/b": { "~key": 9 }, rows: [9, 2], updatedAt: "after" };
  assert.equal((await grade(expected, actual, "exact", ["/updatedAt", "/a~1b/~0key", "/rows/0", "/absent/child"])).score, 1);
  assert.equal(expected.updatedAt, "before");
  assert.deepEqual(actual.rows, [9, 2]);
  assert.equal((await grade(1, 2, "exact", [""])).score, 1);
  assert.throws(() => createStateMatchScorer({ expected: {}, mode: "exact", ignore: ["/bad~2"] }));
});

test("diff_is_bounded_and_redacted", async () => {
  const expected = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`key${i}`, `private-secret${"😀".repeat(200)}`]));
  const [record] = await scoreRun({
    result,
    environment: Object.fromEntries(Object.keys(expected).map((k) => [k, "different"])),
    secrets: ["private-secret"],
    scorers: [createStateMatchScorer({ expected, mode: "exact" })],
  });
  const diff = record!.metadata!.diff as { path: string; expected: unknown; actual: unknown }[];
  assert.equal(diff.length, 32);
  assert.ok(!JSON.stringify(record).includes("private-secret"));
  for (const entry of diff) {
    assert.ok(Buffer.byteLength(JSON.stringify(entry.expected)) <= 256);
    assert.ok(Buffer.byteLength(JSON.stringify(entry.actual)) <= 256);
    assert.ok(!String(entry.expected).includes("�"));
  }
  const [redacted] = await scoreRun({
    result,
    environment: { token: "second-secret" },
    secrets: ["first-secret", "second-secret"],
    scorers: [createStateMatchScorer({ expected: { token: "first-secret" }, mode: "exact" })],
  });
  assert.equal(redacted!.score, 1, "comparison uses redacted values");
});

test("select_and_item_expected_support_invariants", async () => {
  const scorer = createStateMatchScorer<string, { paid: boolean }>({
    id: "paid",
    expected: (item: DatasetItem<string, { paid: boolean }> | undefined) => item?.expected,
    select: (env) => (env as { order: unknown }).order,
    mode: "subset",
    invariant: true,
  });
  const [record] = await scoreRun({
    result,
    item: { id: "i", input: "pay", expected: { paid: true } },
    environment: { order: { paid: false, id: 1 } },
    scorers: [scorer],
  });
  assert.equal(record!.score, 0);
  assert.equal(record!.scorerId, "paid");
  assert.equal(record!.metadata!.invariant, true);
  assert.deepEqual(record!.metadata!.diff, [{ path: "/paid", expected: true, actual: false }]);
});

test("missing_environment_throws_requirement_error", async () => {
  await assert.rejects(scoreRun({ result, scorers: [createStateMatchScorer({ expected: {}, mode: "exact" })] }), {
    code: "ERR_PRISM_EVAL_ENVIRONMENT_REQUIRED",
  });
});

test("state_bounds_fail_record_with_attributable_code", async () => {
  for (const [expected, actual] of [
    ["x".repeat(1024 * 1024), "ok"],
    ["ok", "😀".repeat(262144)],
  ]) {
    const record = await grade(expected, actual);
    assert.equal(record.status, "failed");
    assert.equal(record.error!.code, "ERR_PRISM_EVAL_STATE_BOUNDS");
  }
  assert.equal((await grade("x".repeat(1024 * 1024 - 2), "x".repeat(1024 * 1024 - 2))).score, 1);
});

test("pointers_and_comparison_use_own_keys", async () => {
  const state = JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"a/b~c":1}');
  assert.equal((await grade(state, {}, "subset")).score, 0);
  assert.equal((await grade(state, {}, "exact", ["/__proto__", "/constructor", "/a~1b~0c"])).score, 1);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  const mismatch = await grade({ "a/b~c": 1 }, { "a/b~c": 2 });
  assert.deepEqual(mismatch.metadata!.diff, [{ path: "/a~1b~0c", expected: 1, actual: 2 }]);
});

test("non_serializable_states_fail_instead_of_matching_lossy_json", async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const state of [cyclic, { n: NaN }, { n: Infinity }, { n: 1n }, { fn: () => 1 }, { s: Symbol() }]) {
    assert.equal((await grade({}, state)).status, "failed");
  }
});
