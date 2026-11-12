/** Plan 218 Task 5: the live re-plan family (M1), proved offline. */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertMemoryModelFixture, robustnessIdsHash } from "../robustness.mjs";
import { longSessionChecks, runLongSession } from "./long-session.mjs";
import {
  createRePlanPersona,
  drawRePlanPartitions,
  RE_PLAN_ARMS,
  RE_PLAN_STRATA,
  rePlanPartitionFile,
  rePlanPartitions,
  rePlanPersonaIds,
} from "./re-plan.mjs";

test("re_plan_family_partitions_frozen_and_label_blind", async () => {
  const committed = JSON.parse(await readFile(new URL("../work-outcome-re-plan.json", import.meta.url), "utf8"));
  assert.deepEqual(committed, rePlanPartitionFile(), "the committed file is the draw, byte for byte");
  assert.equal(robustnessIdsHash(committed.abilities), committed.idsHash);
  assert.equal((await rePlanPartitions()).idsHash, committed.idsHash);
  // The criteria pin the frozen file (fixture `re-plan`), so a redraw is refused before gate M-2 reads it.
  assert.match(assertMemoryModelFixture("re-plan"), /^[0-9a-f]{64}$/);
  // Label-blind: the draw reads ids only, so it is a pure function of the id list (order and labels do not enter).
  assert.deepEqual(drawRePlanPartitions([...rePlanPersonaIds()].reverse()), drawRePlanPartitions());
  const parts = ["dev", "heldout-a", "heldout-b"].map((partition) => committed.abilities[partition]["re-plan-coding"]);
  assert.deepEqual(
    parts.map((ids) => ids.length),
    RE_PLAN_STRATA["re-plan-coding"],
  );
  assert.equal(new Set(parts.flat()).size, rePlanPersonaIds().length, "partitions are disjoint and cover every id");
  assert.throws(() => drawRePlanPartitions(rePlanPersonaIds().slice(0, 5)), /RePlanDraw/);
  for (const id of rePlanPersonaIds()) {
    const persona = createRePlanPersona(Number(id.slice(2)));
    const order = persona.tasks.map((task) => task.id);
    assert.deepEqual(order, ["plan", "task1", "task2", "task4", "task5", "replan", "task3", "task6"]);
    // The first plan never mentions what the post-re-plan steps need; the re-plan names neither the file nor the key.
    assert.ok(!persona.plan.includes("src/report.ts") && !persona.plan.includes("docs/retries.md"));
    const after = persona.tasks.slice(order.indexOf("replan")).map((task) => task.prompt);
    for (const prompt of after)
      for (const value of [
        persona.labels.to,
        persona.labels.modulePath,
        persona.labels.moduleBase,
        persona.labels.key,
        persona.labels.configPath,
      ])
        assert.ok(!prompt.includes(value), `${id}: a post-re-plan prompt names a hidden label`);
    // Each scope turn hands the WM arm the plan in force.
    assert.equal(persona.tasks.find((task) => task.id === "plan").scope, persona.plan);
    assert.equal(persona.tasks.find((task) => task.id === "replan").scope, persona.replan);
  }
  // A re-plan persona is not a long-session persona: its own seed draws its own names.
  assert.notEqual(createRePlanPersona(0).labels.to, (await import("./long-session.mjs")).createLongSessionPersona(0).labels.to);
});

test("re_plan_offline_scores_tasks_after_the_re_plan", async () => {
  const report = await runLongSession({ family: "re-plan", offline: true, personaLimit: 2, arms: ["memory-off", "WM", "STM-only"] });
  assert.equal(report.family, "re-plan");
  assert.match(report.metric, /^M1: task success on the tasks after a mid-episode re-plan/);
  for (const arm of ["memory-off", "WM", "STM-only"]) {
    assert.equal(report.summary[arm].relatedTasks, 4, arm);
    assert.ok(
      report.rows[arm].every((row) => row.family === "re-plan" && row.sourceSucceeded && row.status === "completed"),
      arm,
    );
  }
  assert.equal(report.summary.WM.successRate, 1);
  assert.equal(report.summary.WM.rederivationsPerRelatedTask, 0, "WM carries what steps 1 and 3 found across the re-plan");
  assert.ok(report.summary["memory-off"].rederivationsPerRelatedTask > 0, "without memory the agent re-derives after the re-plan");
  const text = JSON.stringify(report);
  for (const id of report.personas) {
    const { labels } = createRePlanPersona(Number(id.slice(2)));
    for (const value of [labels.from, labels.to, labels.key, labels.configPath])
      assert.ok(!text.includes(value), "the report carries no label");
  }
  await assert.rejects(runLongSession({ family: "re-plan", offline: true, personaLimit: 1, arms: ["STM"] }), /re-plan has no arm STM/);
  assert.deepEqual([...RE_PLAN_ARMS], ["memory-off", "WM", "STM-only", "OM-before"]);
  const persona = createRePlanPersona(0);
  assert.deepEqual(longSessionChecks(persona.files, persona.labels), { task1: false, task3: false, task4: false, task6: false });
}, 300_000);
