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
  assert.deepEqual([dev.length, a.length, b.length], LONG_SESSION_STRATA["long-session-coding"]);
  assert.equal(new Set([...dev, ...a, ...b]).size, dev.length + a.length + b.length, "partitions are disjoint");
  // A short stratum fails closed instead of drawing a smaller partition.
  assert.throws(() => drawLongSessionPartitions(longSessionPersonaIds().slice(0, 5)), /LongSessionDraw/);
  // The agent never reads a label: no prompt names what a dependent task needs.
  for (const id of longSessionPersonaIds()) {
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
      yield { type: "done", usage: { inputTokens: 40, outputTokens: 7 } };
      yield { type: "content_delta", content: { type: "text", text: "never read" } };
    },
  };
  const meter = { worker: { calls: 0, inputTokens: 0, outputTokens: 0 }, main: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  const log = { eligibleChars: 0 };
  const [metered] = meteredLongSessionProviders([provider], meter, log);
  for await (const chunk of metered.generate({ messages: [], tools: [] })) if (chunk.type === "done") break;
  assert.deepEqual(meter.main, { calls: 1, inputTokens: 40, outputTokens: 7 });
  assert.equal(log.eligibleChars, 5);
  for await (const chunk of metered.generate({ messages: [], tools: [{ name: "record_event" }] })) if (chunk.type === "done") break;
  assert.deepEqual(meter.worker, { calls: 1, inputTokens: 40, outputTokens: 7 });
});
