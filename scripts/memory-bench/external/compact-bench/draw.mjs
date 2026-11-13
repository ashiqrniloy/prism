/**
 * Plan 218.1 Task 2: the frozen Compact-Bench draw of the lean screen.
 *
 * - Retention: 30 of the 146 sessions, stratified by `client`, label-blind: only `sample_id` and `client` are read,
 *   never the history or the annotated details. Each stratum gets its largest-remainder share of 30; inside a stratum
 *   the sessions with the smallest `SHA-256("prism-218.1-compact-bench:" + sample_id)` are drawn. Remainder ties break
 *   on the same hash of the client name.
 * - Outcome: the 22 validated task-preservation instances, upstream's PRE-pass cohort `e1/prepass24.txt` minus the two
 *   instances upstream excludes from aggregate rates (`pytest-dev__pytest-10051`, `pytest-dev__pytest-7236`).
 *
 * The draw file holds ids, counts, pins and hashes only. Re-running it on the pinned data must reproduce it byte for
 * byte (`--check`).
 *
 * ```sh
 * bun scripts/memory-bench/external/compact-bench/draw.mjs [--check]
 * ```
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMPACT_BENCH_PIN, compactBenchPaths, parseSha256Sums } from "./fetch.mjs";

export const COMPACT_BENCH_SEED = "prism-218.1-compact-bench";
export const COMPACT_BENCH_RETENTION_N = 30;
/** Upstream's two excluded instances (README, `docs/dataset-card.md`). */
export const COMPACT_BENCH_EXCLUDED = Object.freeze(["pytest-dev__pytest-10051", "pytest-dev__pytest-7236"]);
export const COMPACT_BENCH_DRAW_FILE = "scripts/memory-bench/work-outcome-compact-bench.json";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const rank = (id) => sha256(`${COMPACT_BENCH_SEED}:${id}`);

/** Largest-remainder allocation of `n` over strata sizes; ties break on the seeded hash of the stratum name. */
export function allocateStrata(sizes, n) {
  const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
  if (n > total) throw new Error(`CompactBenchDraw: ${n} exceeds the ${total} available`);
  const rows = Object.entries(sizes).map(([name, size]) => {
    const exact = (size * n) / total;
    return { name, size, take: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = n - rows.reduce((sum, row) => sum + row.take, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || rank(a.name).localeCompare(rank(b.name)))) {
    if (left === 0) break;
    if (row.take < row.size) {
      row.take += 1;
      left -= 1;
    }
  }
  return Object.fromEntries(rows.map((row) => [row.name, row.take]));
}

/**
 * The retention draw from `{ sample_id, client }` rows only. Taking the rows through this narrow shape is what makes
 * the draw label-blind: nothing else reaches it.
 */
export function drawRetention(rows, n = COMPACT_BENCH_RETENTION_N) {
  const byClient = {};
  for (const { sample_id: id, client } of rows) {
    if (typeof id !== "string" || typeof client !== "string") throw new Error("CompactBenchDraw: a session needs sample_id and client");
    (byClient[client] ??= []).push(id);
  }
  const shares = allocateStrata(Object.fromEntries(Object.entries(byClient).map(([client, ids]) => [client, ids.length])), n);
  const strata = {};
  for (const client of Object.keys(byClient).sort()) {
    if (!shares[client]) continue;
    strata[client] = [...byClient[client]].sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, shares[client]);
  }
  return strata;
}

/** The outcome set: the PRE-pass cohort minus the excluded instances, in cohort order. */
export function drawOutcome(prepassText) {
  const cohort = prepassText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return cohort.filter((id) => !COMPACT_BENCH_EXCLUDED.includes(id));
}

/** Read only `sample_id` and `client` from each JSONL line (the history and labels are never kept). */
export function sessionKeys(jsonl) {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const { sample_id, client } = JSON.parse(line);
      return { sample_id, client };
    });
}

export function buildCompactBenchDraw({ pin = COMPACT_BENCH_PIN, dataDir = compactBenchPaths(pin).data } = {}) {
  const sumsText = readFileSync(join(dataDir, "SHA256SUMS"), "utf8");
  if (sha256(sumsText) !== pin.dataset.sha256sums) throw new Error("CompactBenchDraw: SHA256SUMS does not match the pin");
  const sums = Object.fromEntries(parseSha256Sums(sumsText).map((entry) => [entry.path, entry.sha256]));
  const sessionsText = readFileSync(join(dataDir, "e2/sessions.jsonl"), "utf8");
  const prepassText = readFileSync(join(dataDir, "e1/prepass24.txt"), "utf8");
  if (sha256(sessionsText) !== sums["e2/sessions.jsonl"] || sha256(prepassText) !== sums["e1/prepass24.txt"])
    throw new Error("CompactBenchDraw: a source file does not match SHA256SUMS");
  const keys = sessionKeys(sessionsText);
  const retention = drawRetention(keys);
  const outcome = drawOutcome(prepassText);
  const retentionIds = Object.values(retention).flat();
  return {
    kind: "compact-bench-draw-v1",
    plan: "218.1",
    task: 2,
    seed: COMPACT_BENCH_SEED,
    upstream: {
      code: pin.code.repository,
      codeRevision: pin.code.commit,
      data: `https://huggingface.co/datasets/${pin.dataset.repository}`,
      datasetRevision: pin.dataset.revision,
      sha256sums: pin.dataset.sha256sums,
    },
    retention: {
      suite: "compact-bench-retention",
      source: { file: "e2/sessions.jsonl", sha256: sums["e2/sessions.jsonl"], sessions: keys.length },
      draw: `largest-remainder share of ${COMPACT_BENCH_RETENTION_N} per client; inside a client, ascending SHA-256("${COMPACT_BENCH_SEED}:" + sample_id); only sample_id and client are read`,
      clients: clientCounts(keys),
      n: retentionIds.length,
      strata: retention,
      idsHash: sha256(JSON.stringify([...retentionIds].sort())),
    },
    outcome: {
      suite: "compact-bench-outcome",
      source: {
        file: "e1/prepass24.txt",
        sha256: sums["e1/prepass24.txt"],
        cohort: prepassText.split(/\r?\n/).filter((l) => l.trim()).length,
      },
      excluded: [...COMPACT_BENCH_EXCLUDED],
      note: "upstream's historical PRE-pass cohort; the screen recomputes PRE in its own run and reports any instance whose PRE fails",
      n: outcome.length,
      instances: outcome,
      idsHash: sha256(JSON.stringify([...outcome].sort())),
    },
  };
}

/** Sessions per client, by client name. */
function clientCounts(keys) {
  const counts = {};
  for (const { client } of keys) counts[client] = (counts[client] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export const renderDraw = (draw) => `${JSON.stringify(draw, null, 2)}\n`;

if (import.meta.main) {
  const text = renderDraw(buildCompactBenchDraw());
  if (process.argv.includes("--check")) {
    if (readFileSync(COMPACT_BENCH_DRAW_FILE, "utf8") !== text) {
      process.stderr.write("CompactBenchDraw: the frozen draw does not reproduce\n");
      process.exit(1);
    }
    process.stdout.write("draw reproduces\n");
  } else {
    writeFileSync(COMPACT_BENCH_DRAW_FILE, text);
    process.stdout.write(`${COMPACT_BENCH_DRAW_FILE}: ${sha256(text)}\n`);
  }
}
