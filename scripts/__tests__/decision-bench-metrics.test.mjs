import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  agreement,
  brier,
  ece,
  loadItems,
  loadMemoryItems,
  percentile,
  scoreAnswer,
  summarise,
  validateItems,
  validateMemoryItems,
} from "../decision-bench.mjs";

const noulItem = (id, label) => ({
  id,
  category: "tool-result-error",
  state: "x",
  question: { type: "noul", instructions: "failed?", criteria: { true: "failed", false: "succeeded" } },
  label,
});

const choiceItem = (id, label) => ({
  id,
  category: "tool",
  state: "x",
  question: { type: "choice", instructions: "which tool?", criteria: { read: null, grep: null, bash: null } },
  label,
});

const scoreItem = (id, label) => ({
  id,
  category: "approval-risk",
  state: "x",
  question: { type: "score", instructions: "risk?", criteria: ["low", "medium", "high", "critical"] },
  label,
});

test("checked-in fixture validates and stays inside the 150-300 item band", () => {
  const items = loadItems();
  assert.deepEqual(validateItems(items), []);
  assert.ok(items.length >= 150 && items.length <= 300, `got ${items.length}`);
  assert.deepEqual(new Set(items.map((item) => item.category)), new Set(["tool", "route", "tool-result-error", "approval-risk"]));
});

test("memory-gate fixture has at least 100 labelled items per point and choices are reversed", () => {
  const items = loadMemoryItems();
  assert.deepEqual(validateMemoryItems(items), []);
  assert.equal(items.length, 700);
  for (const point of ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]) {
    assert.equal(items.filter((item) => item.point === point).length, 100, point);
  }
  assert.equal(items.filter((item) => item.point === "P2" && item.reversed === true).length, 50);
});

test("validateItems rejects a bad label and a duplicate id", () => {
  const bad = [choiceItem("a", "read"), { ...choiceItem("a", "read"), label: "write" }];
  const problems = validateItems(bad).join("\n");
  assert.match(problems, /expected 150-300 items/);
  assert.match(problems, /duplicate id a/);
  assert.match(problems, /label "write" is not one of its options/);
});

test("percentile is nearest-rank and bounded", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([1, 2, 3, 4, 10], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 10], 95), 10);
});

test("ece and brier match hand-computed values", () => {
  const pairs = [
    [0.9, 1],
    [0.9, 0],
    [0.1, 0],
    [0.1, 1],
  ];
  // 0.9 bin: |0.9 - 0.5| = 0.4; 0.1 bin: |0.1 - 0.5| = 0.4; equal weights -> 0.4.
  assert.equal(ece(pairs), 0.4);
  // (0.01 + 0.81 + 0.01 + 0.81) / 4 = 0.41
  assert.ok(Math.abs(brier(pairs) - 0.41) < 1e-12, `brier ${brier(pairs)}`);
  assert.equal(ece([]), null);
});

test("scoreAnswer maps each answer type to correctness and a label probability", () => {
  assert.deepEqual(scoreAnswer(noulItem("n", true), { type: "noul", noul: 0.9 }), { correct: true, p: 0.9, y: 1 });
  assert.deepEqual(scoreAnswer(noulItem("n", false), { type: "noul", noul: 0.9 }), { correct: false, p: 0.9, y: 0 });

  assert.deepEqual(scoreAnswer(choiceItem("c", "read"), { type: "choice", choice: "read", probabilities: { read: 0.7, grep: 0.3 } }), {
    correct: true,
    p: 0.7,
    y: 1,
  });
  assert.deepEqual(scoreAnswer(choiceItem("c", "read"), { type: "choice", choice: "bash", confidence: 0.6 }), {
    correct: false,
    p: 0.4,
    y: 0,
  });

  assert.deepEqual(scoreAnswer(scoreItem("s", "high"), { type: "score", score: 2.6, confidence: 0.8 }), {
    correct: true,
    p: 0.8,
    y: 1,
  });
  assert.equal(scoreAnswer(scoreItem("s", "high"), { type: "score", score: 1.2, confidence: 0.8 }).correct, false);
  assert.equal(scoreAnswer(noulItem("n", true), undefined), null);
});

test("summarise reports accuracy, calibration, latency, flip rate and tokens", () => {
  const items = [noulItem("a", true), noulItem("b", true), choiceItem("c", "read")];
  const records = [
    { id: "a", timingMs: 10, usage: { inputTokens: 100 }, answer: { type: "noul", noul: 0.9 } },
    { id: "b", timingMs: 20, usage: { inputTokens: 100 }, answer: { type: "noul", noul: 0.2 } },
    {
      id: "c",
      timingMs: 30,
      usage: { inputTokens: 50 },
      answer: { type: "choice", choice: "read", probabilities: { read: 0.6, grep: 0.4 } },
      flippedChoice: "bash",
    },
  ];
  const metrics = summarise(items, records);
  assert.equal(metrics.answered, 3);
  assert.equal(metrics.accuracy, 2 / 3);
  assert.equal(metrics.brier, ((0.9 - 1) ** 2 + (0.2 - 1) ** 2 + (0.6 - 1) ** 2) / 3);
  assert.equal(metrics.p50, 20);
  assert.equal(metrics.p95, 30);
  assert.equal(metrics.flipEligible, 1);
  assert.equal(metrics.flipRate, 1);
  assert.equal(metrics.inputTokens, 250);

  const withError = summarise(items, [...records, { id: "a", error: "boom" }]);
  assert.equal(withError.errors, 1);
});

test("agreement compares comparable answers only", () => {
  const items = [noulItem("a", true), choiceItem("b", "read"), scoreItem("c", "high")];
  const left = [
    { id: "a", answer: { type: "noul", noul: 0.8 } },
    { id: "b", answer: { type: "choice", choice: "read" } },
    { id: "c", answer: { type: "score", score: 2.4 } },
  ];
  const right = [
    { id: "a", answer: { type: "noul", noul: 0.6 } },
    { id: "b", answer: { type: "choice", choice: "bash" } },
    { id: "c", answer: { type: "score", score: 3 } },
  ];
  // a agrees (both >= 0.5); b differs; c differs (2 vs 3).
  assert.deepEqual(agreement(items, left, right), { shared: 3, agree: 1, rate: 1 / 3 });
  assert.deepEqual(agreement(items, left, [{ id: "a", error: "boom" }]), { shared: 0, agree: 0, rate: null });
});
