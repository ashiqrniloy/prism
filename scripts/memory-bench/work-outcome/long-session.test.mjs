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

// Plan 218.2 Task 8: the baseline arms and the package-default memory arms (the long-horizon family left with plan
// 218.3 Task 12; Session-Bench replaced it).

test("fold_and_llm_summary_arms_load_no_memory_package", async () => {
  const { armMemory, BASELINE_ARMS, LONG_SESSION_ARMS } = await import("./long-session.mjs");
  const { RE_PLAN_ARMS } = await import("./re-plan.mjs");
  for (const arms of [LONG_SESSION_ARMS, RE_PLAN_ARMS]) for (const arm of BASELINE_ARMS) assert.ok(arms.includes(arm));
  const names = async (arm, options) => (await armMemory(arm, options)).map((entry) => entry.definition.name);
  assert.deepEqual(await names("fold"), ["@arnilo/prism-extensions/context-engineering"]);
  assert.deepEqual(await names("llm-summary"), ["@arnilo/prism-extensions/compaction"]);
  // fold is observation masking: old tool output folded, no model call; llm-summary summarises on the arm's worker.
  assert.deepEqual((await armMemory("fold"))[0].config, { fold: { summarize: "truncate" } });
  assert.deepEqual((await armMemory("llm-summary", { workerModel: "w/x" }))[0].config, { model: "w/x" });
  // At the defaults the summary comes at the memory system's compactAt ratio, not at the kernel's entry gate.
  assert.deepEqual((await armMemory("llm-summary", { workerModel: "w/x", defaults: true }))[0].config.trigger, {
    type: "input_ratio",
    ratio: 0.8,
  });
  for (const arm of BASELINE_ARMS) for (const name of await names(arm)) assert.ok(!/memory/.test(name), `${arm} loads ${name}`);
});

test("default_memory_arms_use_package_defaults", async () => {
  // `defaults: true` is the package-default call LOCA-Bench's adapter makes (external/loca-bench/adapter.mjs).
  const { armMemory } = await import("./long-session.mjs");
  const overrides = /triggerTokens|recentMessages|compactAt|messageTokens|"context"/;
  for (const arm of ["WM", "STM-only"]) {
    const [entry] = await armMemory(arm, { defaults: true, stmOverrides: { triggerTokens: 5 } });
    assert.equal(entry.definition.name, "@arnilo/prism-memory-system");
    assert.doesNotMatch(JSON.stringify(entry.config), overrides, `${arm} overrides a trigger`);
  }
  // Without `defaults` (the long-session and re-plan families) the short-session overrides stay.
  const [short] = await armMemory("WM");
  assert.match(JSON.stringify(short.config), /triggerTokens/);
});
