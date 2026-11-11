import { test } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, createSecretRedactor, providerDone, providerTextDelta, type EvaluationRecord, type RunResult } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import type { EvaluationTelemetry } from "@arnilo/prism-extensions/observability";
import { createMemoryEvaluationStore } from "@arnilo/prism-extensions/store-codecs";
import { createUserSimulator, defineDataset, runExperiment, runScenario, scoreRun, scoreRunLive } from "../index.js";
import { skipScorers } from "../score.js";

const result: RunResult = {
  runId: "run",
  sessionId: "session",
  status: "completed",
  text: "private output",
  content: [],
  messages: [],
  usage: {},
};
const scorers = [
  { id: "quality", score: () => ({ score: 0.75, reason: "private reason", metadata: { text: "private metadata" } }) },
  {
    id: "broken",
    score: () => {
      throw new Error("private error");
    },
  },
];
const payload = (record: EvaluationRecord): EvaluationTelemetry => ({
  runId: record.runId ?? record.id,
  name: record.scorerId,
  status: record.status,
  ...(record.score === undefined ? {} : { score: record.score }),
  hasReason: record.reason !== undefined,
});
async function agent(replies = ["reply", "reply"]) {
  return createAgent({ model: "mock/demo", packages: [mockProvider(replies.map((text) => [providerTextDelta(text), providerDone()]))] });
}

test("telemetry_called_once_per_record after redaction, including sampled and step skips", async () => {
  for (const variant of ["normal", "sampled-out", "steps", "no-steps"] as const) {
    const calls: EvaluationTelemetry[] = [];
    let redactions = 0;
    const redactor = createSecretRedactor(["private"]);
    const store = createMemoryEvaluationStore();
    const records = await scoreRun({
      result,
      scorers,
      store,
      sampling: { rate: variant === "sampled-out" ? 0.5 : 1 },
      random: () => 0.9,
      redactor: {
        ...redactor,
        redact(value) {
          redactions++;
          return redactor.redact(value);
        },
      },
      ...(variant === "steps" || variant === "no-steps"
        ? {
            forEach: "tool" as const,
            injectedTimeline: {
              schemaVersion: 1 as const,
              status: "completed",
              startedAt: "now",
              steps:
                variant === "no-steps"
                  ? []
                  : [1, 2].map((n) => ({ id: String(n), kind: "tool", name: "tool", order: n, status: "completed", startedAt: "now" })),
            },
          }
        : {}),
      telemetry: {
        handleEvaluation(e) {
          assert.ok(redactions > 0 || e.status === "skipped");
          calls.push(e);
        },
      },
    });
    assert.equal(records.length, variant === "steps" ? 4 : 2);
    assert.deepEqual(calls, records.map(payload));
    assert.equal((await store.query()).items.length, records.length);
    assert.doesNotMatch(JSON.stringify(calls), /private|reason"|metadata|output|error/);
    assert.doesNotMatch(JSON.stringify(records), /private/);
  }
});

test("throwing_sink_does_not_change_records and live onError receives each failure", async () => {
  const error = new Error("sink failed");
  const telemetry = {
    handleEvaluation(e: EvaluationTelemetry) {
      (e as { score?: number }).score = -1;
      throw error;
    },
  };
  const errors: unknown[] = [];
  const store = createMemoryEvaluationStore();
  const records = await scoreRunLive(result, { scorers, telemetry, store, onError: (e) => errors.push(e) });
  assert.deepEqual(errors, [error, error]);
  assert.deepEqual(
    records.map((r) => [r.status, r.score]),
    [
      ["scored", 0.75],
      ["failed", undefined],
    ],
  );
  assert.equal((await store.query()).items.length, 2);
  const direct = await scoreRun({ result, scorers, telemetry });
  assert.deepEqual(
    direct.map((r) => [r.status, r.score]),
    records.map((r) => [r.status, r.score]),
  );
  assert.equal(
    (
      await scoreRunLive(result, {
        scorers,
        telemetry,
        onError() {
          throw new Error("callback");
        },
      })
    ).length,
    2,
  );
});

test("experiments and scenarios forward telemetry once per trial and scored turn", async () => {
  for (const throws of [false, true]) {
    const target = await agent();
    const calls: EvaluationTelemetry[] = [];
    const telemetry = {
      handleEvaluation(e: EvaluationTelemetry) {
        calls.push(e);
        if (throws) throw new Error("sink");
      },
    };
    try {
      const report = await runExperiment({
        agent: target,
        dataset: defineDataset({ id: "data", items: [{ id: "item", input: "hi" }] }),
        scorers,
        trials: 2,
        telemetry,
      });
      assert.deepEqual(calls, report.evaluations.map(payload));
      assert.equal(calls.length, 4);
      assert.equal(report.evaluations.filter((r) => r.status === "scored").length, 2);
    } finally {
      await target.dispose();
    }
    for (const scoreTurns of ["last", "each"] as const) {
      const target = await agent();
      calls.length = 0;
      try {
        const scenario = await runScenario({ agent: target, turns: ["hi", "again"], scorers, scoreTurns, telemetry });
        assert.equal(scenario.status, "succeeded");
        assert.deepEqual(calls, scenario.evaluations.map(payload));
        assert.equal(calls.length, scoreTurns === "each" ? 4 : 2);
      } finally {
        await target.dispose();
      }
    }
  }
});

test("simulator failure skips emit telemetry even before a run exists", async () => {
  for (const entry of ["experiment", "scenario"] as const) {
    const target = await agent();
    const simulator = await agent([" "]);
    const calls: EvaluationTelemetry[] = [];
    const telemetry = {
      handleEvaluation(e: EvaluationTelemetry) {
        calls.push(e);
      },
    };
    try {
      const user = createUserSimulator({ agent: simulator, persona: "customer", goal: "help" });
      const evaluated =
        entry === "scenario"
          ? await runScenario({ agent: target, user, scorers, telemetry })
          : await runExperiment({
              agent: target,
              dataset: defineDataset({ id: "data", items: [{ id: "item", input: { kind: "scenario" as const, user } }] }),
              scorers,
              telemetry,
            });
      assert.equal(evaluated.evaluations.length, 2);
      assert.ok(evaluated.evaluations.every((r) => r.status === "skipped" && r.runId === undefined));
      assert.deepEqual(calls, evaluated.evaluations.map(payload));
    } finally {
      await target.dispose();
      await simulator.dispose();
    }
  }
  const calls: EvaluationTelemetry[] = [];
  const records = await skipScorers(
    {
      scorers,
      telemetry: {
        handleEvaluation(e) {
          calls.push(e);
          throw new Error("ignored");
        },
      },
    },
    "unavailable",
  );
  assert.deepEqual(calls, records.map(payload));
});
