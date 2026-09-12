#!/usr/bin/env node
/**
 * Redaction scenario (plan 070 Task 9): single-scan redaction cost vs the per-needle
 * split/join loop it replaced for large strings.
 *
 * Fixture: one transcript-scale string (>= 1 MiB, 16 realistic secret-shaped needles, each
 * present in the text) and one small entry-shaped object. `redactSecrets` is measured
 * against a local copy of the ordered `needles.reduce(split/join)` loop, and the two must
 * stay byte-identical — redaction may get faster, never different, and no needle may
 * survive either path. The measured win is a same-process ratio, so the floor travels
 * across machines; the p95 ceilings are non-flaky sanity bounds. Network-free.
 *
 * Usage: node scripts/benchmark.mjs --scenario redaction
 * Caps: scripts/budgets.json#redaction
 */
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { redactSecrets } from "../../dist/index.js";
import { loadBudgets } from "../budget-gates.mjs";

const REDACTED = "[REDACTED]";

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

/** The algorithm `redactSecrets` used before the fast path: one split/join pass per needle. */
export function orderedLoopRedact(text, needles) {
  return needles.reduce((current, secret) => current.split(secret).join(REDACTED), text);
}

function needlesFor(count) {
  return Array.from({ length: count }, (_, index) => `sk-live-${index}-${"x".repeat(24)}-${index}`);
}

function fixtureText(minBytes, needles) {
  const unit = 'hello transcript line with tool output and a json blob {"a":1}. ';
  let text = unit.repeat(Math.ceil(minBytes / unit.length));
  for (const needle of needles) text += ` ${needle} `;
  return text;
}

function smallEntry(strings, needles) {
  return {
    entry: "user",
    payload: Array.from({ length: strings }, (_, index) => ({
      index,
      // Every fourth string carries a needle; the rest are needle-free small strings.
      text: index % 4 === 0 ? `prefix ${needles[index % needles.length]} suffix` : `bounded observation ${index}`,
    })),
  };
}

function measure(run, operations) {
  const samples = [];
  let last;
  for (let index = 0; index < operations; index += 1) {
    const startedAt = performance.now();
    last = run();
    samples.push(performance.now() - startedAt);
  }
  const p50Ms = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  return {
    operations,
    p50Ms: Number(p50Ms.toFixed(3)),
    p95Ms: Number(p95Ms.toFixed(3)),
    throughputPerSecond: Number((operations / Math.max(samples.reduce((sum, ms) => sum + ms, 0) / 1000, 0.000001)).toFixed(2)),
    last,
  };
}

export async function runScenario() {
  const budget = loadBudgets().redaction;
  const fixture = budget.fixture;
  const needles = needlesFor(fixture.needleCount);
  const text = fixtureText(fixture.transcriptBytes, needles);
  const entry = smallEntry(fixture.smallEntryStrings, needles);

  // Warm up both paths, then compare outputs before measuring: identical bytes or the
  // scenario is meaningless (the fast path must never change what is redacted).
  const shippedText = redactSecrets(text, needles);
  const legacyText = orderedLoopRedact(text, needles);
  const shippedEntry = redactSecrets(entry, needles);

  const shipped = measure(() => Buffer.byteLength(redactSecrets(text, needles), "utf8"), fixture.measuredOperations);
  const legacy = measure(() => Buffer.byteLength(orderedLoopRedact(text, needles), "utf8"), fixture.measuredOperations);
  const small = measure(() => redactSecrets(entry, needles), fixture.smallOperations);
  const speedup = legacy.p50Ms / Math.max(shipped.p50Ms, 0.000001);

  // Every string in the small entry must match what the ordered loop would have produced.
  const entryStringsMatch = entry.payload.every((row, index) => shippedEntry.payload[index]?.text === orderedLoopRedact(row.text, needles));
  const leaked = needles.filter((needle) => String(shippedText).includes(needle) || String(shippedEntry).includes(needle));
  const identical = shippedText === legacyText && entryStringsMatch;

  return {
    version: "0.5.7",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryBytes: totalmem(),
      network: false,
      credentials: false,
    },
    fixture: {
      ...fixture,
      transcriptBytes: Buffer.byteLength(text, "utf8"),
      secretOccurrences: fixture.needleCount * 2,
    },
    ceilingsMs: { transcript: budget.transcriptP95CeilingMs, small: budget.smallP95CeilingMs },
    results: [
      {
        name: "redact_transcript_single_scan",
        operations: shipped.operations,
        p50Ms: shipped.p50Ms,
        p95Ms: shipped.p95Ms,
        throughputPerSecond: shipped.throughputPerSecond,
      },
      {
        name: "redact_transcript_ordered_loop",
        operations: legacy.operations,
        p50Ms: legacy.p50Ms,
        p95Ms: legacy.p95Ms,
        throughputPerSecond: legacy.throughputPerSecond,
      },
      {
        name: "redact_small_entry",
        operations: small.operations,
        p50Ms: small.p50Ms,
        p95Ms: small.p95Ms,
        throughputPerSecond: small.throughputPerSecond,
      },
      { name: "redaction_speedup", value: Number(speedup.toFixed(2)), unit: "ratio" },
      { name: "shipped_small_bytes", value: Buffer.byteLength(JSON.stringify(shippedEntry), "utf8"), unit: "bytes" },
    ],
    checks: [
      { name: "ordered_loop_identical", pass: identical },
      { name: "no_needle_survives", pass: leaked.length === 0 },
      { name: "speedup_ge_min", pass: speedup >= budget.minSpeedup },
      { name: "transcript_p95_le_ceiling", pass: shipped.p95Ms <= budget.transcriptP95CeilingMs },
      { name: "small_p95_le_ceiling", pass: small.p95Ms <= budget.smallP95CeilingMs },
      { name: "transcript_bytes_ge_min", pass: Buffer.byteLength(text, "utf8") >= 1024 * 1024 },
    ],
  };
}

async function main() {
  const report = await runScenario();
  for (const check of report.checks) {
    if (!check.pass) {
      console.error(`BUDGET FAIL: ${check.name}`);
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && new URL(import.meta.url).href.endsWith(process.argv[1].split("/").pop())) main();
