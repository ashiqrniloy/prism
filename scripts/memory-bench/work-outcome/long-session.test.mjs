/** Plan 217 Task 5: the live long-session coding family (S1), proved offline. */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultCompactor } from "@arnilo/prism";
import { robustnessIdsHash } from "../robustness.mjs";
import {
  createLongSessionPersona,
  drawLongSessionPartitions,
  LONG_SESSION_STRATA,
  longSessionAgentMock,
  longSessionChecks,
  longSessionPartitionFile,
  longSessionPartitions,
  longSessionPersonaIds,
  longSessionWorkerMock,
  runLongSession,
  runLongSessionPersona,
} from "./long-session.mjs";

const OFFLINE_MODEL = { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

test("long_session_family_partitions_frozen_and_label_blind", async () => {
  const committed = JSON.parse(await readFile(new URL("../work-outcome-long-session.json", import.meta.url), "utf8"));
  assert.deepEqual(committed, longSessionPartitionFile(), "the committed file is the draw, byte for byte");
  assert.equal(robustnessIdsHash(committed.abilities), committed.idsHash);
  assert.equal((await longSessionPartitions()).idsHash, committed.idsHash);
  // Label-blind: the draw reads ids only, so it is a pure function of the id list (order and labels do not enter).
  assert.deepEqual(drawLongSessionPartitions([...longSessionPersonaIds()].reverse()), drawLongSessionPartitions());
  const [dev, a, b] = ["dev", "heldout-a", "heldout-b"].map((partition) => committed.abilities[partition]["long-session-coding"]);
  // The base draw (plan 217 Task 5) is unchanged: same ids hash, same held-out partitions; the extension joins dev only.
  const base = drawLongSessionPartitions();
  assert.equal(committed.extension.baseIdsHash, "db5632ffe5a42e703f1bef5cc96de97471e66101266bc58bc7fdb843b7b3f730");
  assert.equal(base.idsHash, committed.extension.baseIdsHash);
  assert.deepEqual(a, base.abilities["heldout-a"]["long-session-coding"]);
  assert.deepEqual(b, base.abilities["heldout-b"]["long-session-coding"]);
  assert.deepEqual(dev, [...base.abilities.dev["long-session-coding"], ...committed.extension.dev]);
  assert.equal(committed.extension.dev.length, 12);
  assert.ok(committed.extension.dev.every((id) => Number(id.slice(2)) >= 12));
  assert.deepEqual([base.abilities.dev["long-session-coding"].length, a.length, b.length], LONG_SESSION_STRATA["long-session-coding"]);
  assert.equal(new Set([...dev, ...a, ...b]).size, dev.length + a.length + b.length, "partitions are disjoint");
  // A short stratum fails closed instead of drawing a smaller partition.
  assert.throws(() => drawLongSessionPartitions(longSessionPersonaIds().slice(0, 5)), /LongSessionDraw/);
  // The agent never reads a label: no prompt names what a dependent task needs.
  for (const id of [...longSessionPersonaIds(), ...committed.extension.dev]) {
    const persona = createLongSessionPersona(Number(id.slice(2)));
    const [task3, task6] = [persona.tasks[2].prompt, persona.tasks[5].prompt];
    for (const value of [persona.labels.to, persona.labels.modulePath, persona.labels.moduleBase]) assert.ok(!task3.includes(value));
    for (const value of [persona.labels.key, persona.labels.configPath, `to ${persona.labels.after}`]) assert.ok(!task6.includes(value));
  }
});

test("long_session_offline_computes_s1_and_counts_rederivation", async () => {
  const report = await runLongSession({ offline: true, personaLimit: 2 });
  assert.equal(report.mode, "offline");
  for (const arm of ["memory-off", "STM"]) {
    assert.equal(report.summary[arm].relatedTasks, 4);
    assert.equal(typeof report.summary[arm].rederivationsPerRelatedTask, "number");
    assert.ok(
      report.rows[arm].every((row) => row.sourceSucceeded && row.status === "completed"),
      arm,
    );
  }
  assert.equal(report.summary.STM.rederivationsPerRelatedTask, 0, "STM's outcome events carry what the earlier task changed");
  assert.equal(report.summary.STM.successRate, 1);
  const text = JSON.stringify(report);
  for (const id of report.personas) {
    const { labels } = createLongSessionPersona(Number(id.slice(2)));
    for (const value of [labels.from, labels.to, labels.key, labels.configPath])
      assert.ok(!text.includes(value), "the report carries no label");
  }
  // A no-carry control (memory-off with a one-character kernel summary; 0 means unlimited) loses the earlier task from view: the agent re-derives
  // it from the files, and S1 counts it. STM above re-derived nothing on the same personas.
  const temp = await mkdtemp(join(tmpdir(), "prism-long-session-test-"));
  try {
    const persona = createLongSessionPersona(Number(report.personas[0].slice(2)));
    const providers = () => [longSessionAgentMock(), longSessionWorkerMock()];
    const compactor = createDefaultCompactor({ maxSummaryChars: 1 });
    const off = await runLongSessionPersona({ persona, arm: "memory-off", providers: providers(), model: OFFLINE_MODEL, temp, compactor });
    assert.ok(off.reduce((sum, row) => sum + row.rederivations, 0) >= 2, "each related task re-derived without memory");
    assert.ok(
      off.every((row) => row.success),
      "re-deriving still finishes the task",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  // The checks are what run_tests and the grader read.
  const persona = createLongSessionPersona(0);
  assert.deepEqual(longSessionChecks(persona.files, persona.labels), { task1: false, task3: false, task4: false, task6: false });
}, 300_000);

test("metered_providers_count_usage_when_the_consumer_stops_at_done", async () => {
  const { meteredLongSessionProviders } = await import("./long-session.mjs");
  const provider = {
    id: "p",
    async *generate() {
      yield { type: "content_delta", content: { type: "text", text: "hello" } };
      yield { type: "usage", usage: { inputTokens: 40, outputTokens: 7 } };
      yield { type: "done", usage: { inputTokens: 40, outputTokens: 7, cacheReadTokens: 30 } };
      yield { type: "content_delta", content: { type: "text", text: "never read" } };
    },
  };
  const meter = { worker: { calls: 0, inputTokens: 0, outputTokens: 0 }, main: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  const log = { eligibleChars: 0 };
  const [metered] = meteredLongSessionProviders([provider], meter, log);
  for await (const chunk of metered.generate({ messages: [], tools: [] })) if (chunk.type === "done") break;
  // Plan 218 Task 6: cached input is counted per row (gate M-2's cached-input share).
  assert.deepEqual(meter.main, { calls: 1, inputTokens: 40, outputTokens: 7, cacheReadTokens: 30 });
  assert.equal(log.eligibleChars, 5);
  for await (const chunk of metered.generate({ messages: [], tools: [{ name: "record_event" }] })) if (chunk.type === "done") break;
  assert.deepEqual(meter.worker, { calls: 1, inputTokens: 40, outputTokens: 7, cacheReadTokens: 30 });
});

test("project_grep_searches_the_root_and_directories", async () => {
  // Gate M-1 run 1: `grep` with `path: "."` answered "(no matches)", so agents could not find the module to rename.
  const { createLongSessionPersona, longSessionProjectToolsForTest } = await import("./long-session.mjs");
  const persona = createLongSessionPersona(10);
  const tools = longSessionProjectToolsForTest(persona);
  const grep = (args) => tools.grep.execute(args, { toolCallId: "g" }).value;
  const { from, modulePath } = persona.labels;
  for (const path of [undefined, ".", "./", "src", "src/"])
    assert.match(
      grep({ pattern: from, ...(path === undefined ? {} : { path }) }),
      new RegExp(modulePath.replace(/[.]/g, "\\.")),
      String(path),
    );
  assert.equal(grep({ pattern: from, path: "docs" }), "(no matches)");
  assert.match(grep({ pattern: from, path: modulePath }), /:1:export function/);
  assert.equal(grep({ pattern: from, path: "sr" }), "(no matches)");
});

// Plan 218.2 Task 8: the baseline arms, the long-horizon family at the shipped triggers, and whole-run cost.

test("fold_and_llm_summary_arms_load_no_memory_package", async () => {
  const { armMemory, BASELINE_ARMS, LONG_SESSION_ARMS } = await import("./long-session.mjs");
  const { RE_PLAN_ARMS } = await import("./re-plan.mjs");
  const { LONG_HORIZON_ARMS } = await import("./long-horizon.mjs");
  for (const arms of [LONG_SESSION_ARMS, RE_PLAN_ARMS, LONG_HORIZON_ARMS]) for (const arm of BASELINE_ARMS) assert.ok(arms.includes(arm));
  const names = async (arm, options) => (await armMemory(arm, options)).map((entry) => entry.definition.name);
  assert.deepEqual(await names("fold"), ["@arnilo/prism-extensions/context-engineering"]);
  assert.deepEqual(await names("llm-summary"), ["@arnilo/prism-extensions/compaction"]);
  // fold is observation masking: old tool output folded, no model call; llm-summary summarises on the arm's worker.
  assert.deepEqual((await armMemory("fold"))[0].config, { fold: { summarize: "truncate" } });
  assert.deepEqual((await armMemory("llm-summary", { workerModel: "w/x" }))[0].config, { model: "w/x" });
  // At the defaults the summary comes at the memory system's compactAt ratio, not at the kernel's entry gate.
  assert.deepEqual((await armMemory("llm-summary", { workerModel: "w/x", defaults: true }))[0].config.trigger, {
    type: "input_ratio",
    ratio: 0.6,
  });
  for (const arm of BASELINE_ARMS) for (const name of await names(arm)) assert.ok(!/memory/.test(name), `${arm} loads ${name}`);
});

test("long_horizon_arms_use_package_defaults", async () => {
  const { armMemory } = await import("./long-session.mjs");
  const { LONG_HORIZON_ARMS } = await import("./long-horizon.mjs");
  const overrides = /triggerTokens|recentMessages|compactAt|messageTokens|"context"/;
  for (const arm of LONG_HORIZON_ARMS.filter((id) => id === "WM" || id === "STM-only")) {
    const [entry] = await armMemory(arm, { defaults: true, stmOverrides: { triggerTokens: 5 } });
    assert.equal(entry.definition.name, "@arnilo/prism-memory-system");
    assert.doesNotMatch(JSON.stringify(entry.config), overrides, `${arm} overrides a trigger`);
  }
  // Without `defaults` (the long-session and re-plan families) the short-session overrides stay.
  const [short] = await armMemory("WM");
  assert.match(JSON.stringify(short.config), /triggerTokens/);
});

test("long_horizon_family_partitions_frozen_label_blind_and_long", async () => {
  const horizon = await import("./long-horizon.mjs");
  const committed = JSON.parse(await readFile(new URL("../work-outcome-long-horizon.json", import.meta.url), "utf8"));
  assert.deepEqual(committed, horizon.longHorizonPartitionFile(), "the committed file is the draw, byte for byte");
  assert.equal((await horizon.longHorizonPartitions()).idsHash, committed.idsHash);
  assert.deepEqual(horizon.drawLongHorizonPartitions([...horizon.longHorizonSessionIds()].reverse()), horizon.drawLongHorizonPartitions());
  const { MEMORY_MODEL_CRITERIA } = await import("../robustness.mjs");
  const { createHash } = await import("node:crypto");
  const fixture = MEMORY_MODEL_CRITERIA.fixtures.index.find((entry) => entry.id === "long-horizon");
  assert.equal(fixture.hashOf, "scripts/memory-bench/work-outcome-long-horizon.json");
  // The index pins the sha256 of the frozen partition file (the re-plan convention).
  assert.equal(
    fixture.hash,
    createHash("sha256")
      .update(await readFile(new URL("../work-outcome-long-horizon.json", import.meta.url)))
      .digest("hex"),
  );
  const session = horizon.createLongHorizonSession(0);
  assert.equal(session.projects.length, horizon.LONG_HORIZON_PROJECTS);
  // Every project's dependent tasks come after every project's source tasks.
  const firstDependent = session.tasks.findIndex((task) => task.taskId === "task3" || task.taskId === "task6");
  assert.equal(firstDependent, session.projects.length * 4);
  assert.ok(session.tasks.slice(firstDependent).every((task) => task.taskId === "task3" || task.taskId === "task6"));
  // No prompt names what a dependent task needs; each names its own project.
  for (const project of session.projects) {
    const own = session.tasks.filter((task) => task.project === project.id);
    for (const task of own) assert.match(task.prompt, new RegExp(`^Task \\d\\. \\[project ${project.id}\\] `));
    const [task3, task6] = ["task3", "task6"].map((id) => own.find((task) => task.taskId === id).prompt);
    for (const value of [project.labels.to, project.labels.modulePath, project.labels.moduleBase]) assert.ok(!task3.includes(value));
    for (const value of [project.labels.key, project.labels.configPath]) assert.ok(!task6.includes(value));
  }
});

test("long_horizon_refuses_to_run_when_wm_does_not_engage_at_defaults", async () => {
  const { assertLongHorizonEngages, LONG_HORIZON_MIN_WM_PASSES } = await import("./long-horizon.mjs");
  const row = (persona, items) => ({
    persona,
    arm: "WM",
    eligibleTokens: 150_000,
    session: { passes: items.length, items, compactions: 1 },
  });
  const engaged = Array(LONG_HORIZON_MIN_WM_PASSES).fill(2);
  // One session short of the rule (passes with no item do not count) refuses the whole family.
  await assert.rejects(
    assertLongHorizonEngages({ report: { usage: [row("lh3", engaged), row("lh2", [...engaged.slice(1), 0, 0])] } }),
    /LongHorizonPrecondition: .*4 passes with an item in lh2.*not run/,
  );
  await assert.rejects(assertLongHorizonEngages({ report: { usage: [] } }), /LongHorizonPrecondition/);
  const reading = await assertLongHorizonEngages({ report: { usage: [row("lh3", engaged), row("lh2", engaged)] } });
  assert.equal(reading.engaged, true);
});

test("report_carries_whole_run_tokens_per_successful_task_for_every_arm", async () => {
  const { LONG_HORIZON_ARMS, LONG_HORIZON_MIN_ELIGIBLE_TOKENS, createLongHorizonSession, longHorizonEngagement } = await import(
    "./long-horizon.mjs"
  );
  const started = performance.now();
  const report = await runLongSession({ family: "long-horizon", offline: true, personaLimit: 1 });
  assert.deepEqual(report.arms, [...LONG_HORIZON_ARMS]);
  for (const arm of LONG_HORIZON_ARMS) {
    const cost = report.cost[arm];
    for (const side of ["main", "workers"])
      for (const key of ["inputTokens", "cachedInputTokens", "outputTokens"]) assert.equal(typeof cost[side][key], "number");
    assert.equal(
      cost.wholeRunTokens,
      cost.main.inputTokens + cost.main.outputTokens + cost.workers.inputTokens + cost.workers.outputTokens,
    );
    assert.ok(cost.successfulTasks > 0 && cost.successfulTasks <= cost.gradedTasks, arm);
    assert.equal(cost.wholeRunTokensPerSuccessfulTask, Math.round(cost.wholeRunTokens / cost.successfulTasks));
    assert.ok(cost.compactionBlockChars.compactions > 0, `${arm} compacts in a long session`);
  }
  // Only the arms with a worker spend worker tokens; the llm-summary arm's summaries are worker calls.
  assert.equal(report.cost["memory-off"].workers.inputTokens, 0);
  assert.equal(report.cost.fold.workers.inputTokens, 0);
  for (const arm of ["llm-summary", "STM-only", "WM"]) assert.ok(report.cost[arm].workers.inputTokens > 0, arm);
  // A complete session is at least 150K eligible tokens, and WM engages at the defaults on the scripted worker.
  assert.ok(report.usage.find((row) => row.arm === "WM").eligibleTokens >= LONG_HORIZON_MIN_ELIGIBLE_TOKENS);
  assert.equal(longHorizonEngagement(report).engaged, true);
  assert.equal(report.summary.WM.successRate, 1);
  // Ids and counts only: no label of any project.
  const text = JSON.stringify(report);
  for (const project of createLongHorizonSession(Number(report.personas[0].slice(2))).projects)
    for (const value of [project.labels.from, project.labels.to, project.labels.key, project.labels.configPath])
      assert.ok(!text.includes(value));
  assert.ok(performance.now() - started < 600_000, "the offline family stays well under 20 minutes");
}, 900_000);
