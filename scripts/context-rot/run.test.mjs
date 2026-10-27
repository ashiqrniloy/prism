import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import {
  effectiveInputBudget,
  gradeCoding,
  gradeNeedle,
  gradeToolState,
  prepareWorkspace,
  wilson,
} from "./grade.mjs";
import { EXPRESS_PIN, loadPinnedBytes } from "./history.mjs";
import { run } from "./run.mjs";
import tasks from "./tasks.json" with { type: "json" };

const FIXTURE_ROOT = join(import.meta.dir, "fixtures/repo");

test("context_rot_offline_smoke_reports_every_length", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-rot-smoke-"));
  const started = performance.now();
  try {
    const report = await run({ offline: true, cache: root, outputDir: join(root, "evidence") });
    const elapsed = performance.now() - started;
    assert.equal(report.status, "completed");
    assert.deepEqual(report.lengths, [0, 4000]);
    assert.deepEqual(
      report.arms.map((arm) => [arm.length, arm.fold]),
      [
        [0, "none"],
        [0, "fold"],
        [4000, "none"],
        [4000, "fold"],
      ],
    );
    assert.equal(report.taskCount, 3);
    assert.ok(report.arms.every((arm) => arm.runs === 3), "each arm ran the three smoke tasks");
    assert.ok(report.usage.inputTokens > 0);
    assert.ok(await readFile(report.evidence.jsonPath, "utf8"));
    assert.ok(elapsed < 30_000, `offline smoke took ${Math.round(elapsed)} ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context_rot_refuses_history_checksum_mismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-rot-cache-"));
  try {
    await writeFile(join(root, EXPRESS_PIN.file), Buffer.alloc(EXPRESS_PIN.bytes, 7));
    await assert.rejects(() => loadPinnedBytes(EXPRESS_PIN, { cache: root }), /checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context_rot_aborts_at_token_ceiling", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-rot-ceiling-"));
  try {
    const report = await run({ offline: true, cache: root, outputDir: join(root, "evidence"), maxInputTokens: 1 });
    assert.equal(report.status, "ceiling");
    assert.ok(report.results.length < 12, "the loop stopped before every configured run");
    assert.ok(report.evidence.jsonPath.endsWith(".json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("effective_budget_rule_on_fixture_curve", () => {
  const arm = (length, accuracy, interval) => ({ length, accuracy, interval });
  assert.equal(
    effectiveInputBudget([arm(0, 0.9, [0.8, 0.96]), arm(1000, 0.88, [0.78, 0.94]), arm(2000, 0.6, [0.5, 0.7])]),
    1000,
  );
  assert.equal(effectiveInputBudget([arm(0, 0.9, [0.8, 0.96]), arm(1000, 0.5, [0.4, 0.6])]), 0, "none qualify");
  assert.equal(effectiveInputBudget([arm(0, 0.9, [0.8, 0.96]), arm(1000, 0.86, [0.7, 0.95]), arm(2000, 0.85, [0.66, 0.94])]), 2000);
  assert.deepEqual(wilson(3, 3), [0.43849391955098227, 1]);
});

test("context_rot_grader_is_deterministic", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-rot-grade-"));
  try {
    const coding = tasks.coding[0];
    const first = await prepareWorkspace(FIXTURE_ROOT, root, coding);
    const second = await prepareWorkspace(FIXTURE_ROOT, root, coding);
    for (const workspace of [first, second]) {
      const path = join(workspace, "src/bugs.js");
      const source = await readFile(path, "utf8");
      await writeFile(path, source.replace("for (let i = 0; i < n; i += 1) total += i;", "for (let i = 1; i <= n; i += 1) total += i;"));
    }
    assert.deepEqual(await gradeCoding(first, coding), await gradeCoding(second, coding));
    assert.equal(await gradeNeedle("  The blue ceramic pot. ", "the blue ceramic pot"), true);
    const toolTask = tasks.tools[0];
    for (const workspace of [first, second]) {
      await writeFile(join(workspace, "data/records.json"), toolTask.expect["data/records.json"]);
    }
    assert.deepEqual(await gradeToolState(first, toolTask), await gradeToolState(second, toolTask));
    assert.deepEqual(await gradeCoding(first, coding), { score: 1 }, "a solved fixture stays solved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
