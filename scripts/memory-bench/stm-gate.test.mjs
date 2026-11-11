import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceFingerprint } from "./acceptance.mjs";
import { createChunkMeter, meteredChunkStore } from "./chunk-meter.mjs";
import { memoryModelGateVerdict } from "./robustness.mjs";
import {
  assertM1Gate,
  assertM1Paired,
  assertM1Partition,
  buildExecutableM1Manifest,
  buildM1Evidence,
  buildM1Manifest,
  M1_ARMS,
  M1_WORKTREE,
  M1_WORKTREE_COPY,
  m1AccuracyPair,
  m1Jobs,
  prepareM1Worktree,
} from "./stm-gate.mjs";
import { parseLongSessionLiveArgs } from "./work-outcome/long-session-live.mjs";

const baselines = JSON.parse(readFileSync("docs/_evidence/memory-bench/memory-model/baselines.json", "utf8"));
const probes = JSON.parse(readFileSync("docs/_evidence/memory-bench/217/stm-probes.json", "utf8"));

/** A scored suite report: `correct(i)` per question, worker tokens per question, evidence coverage on every row. */
function suiteReport(ids, { correct = () => true, workerPerQuestion = 1000, status = "completed" } = {}) {
  return {
    status,
    results: ids.map((id, index) => ({
      id,
      ability: index % 2 ? "a" : "b",
      cluster: `c${index}`,
      outcome: "scored",
      correct: correct(index),
      evidenceAllRequired: true,
      phaseTiming: { answer: 1000 + index },
    })),
    workerUsage: { observer: { calls: ids.length, inputTokens: workerPerQuestion * ids.length, outputTokens: 0 } },
    inputTokens: 10 * ids.length,
    injectedContextTokens: 5 * ids.length,
    cost: { measured: 0.01 },
  };
}

/** A long-session job report for one arm: `rederivations(persona)` per related pair. */
function familyReport(arm, { rederivations = () => 0, workerTokens = 1000 } = {}) {
  const personas = ["ls1", "ls7", "ls10", "ls11"];
  return {
    status: "completed",
    inputTokens: 100,
    report: {
      rows: {
        [arm]: personas.flatMap((persona) =>
          ["p1", "p2"].map((pair) => ({ persona, pair, rederivations: rederivations(persona), success: true })),
        ),
      },
      usage: personas.map((persona) => ({
        persona,
        arm,
        worker: { calls: 3, inputTokens: workerTokens, outputTokens: 0 },
        eligibleTokens: 10_000,
        chunkStorePeakBytes: arm === "STM" ? 64 : null,
      })),
      summary: { [arm]: { rederivationsPerRelatedTask: 0, successRate: 1 } },
    },
  };
}

const ids = Array.from({ length: 12 }, (_, index) => `q${index}`);
function allReports({ stmCorrect, stmWorker = 1000, stmRederivations = () => 0 } = {}) {
  const reports = new Map();
  for (const model of ["small", "large"]) {
    for (const suite of ["longmemeval-m", "beam-1m"]) {
      reports.set(`217-m1.${model}.OM-before.${suite}`, suiteReport(ids));
      reports.set(`217-m1.${model}.STM.${suite}`, suiteReport(ids, { correct: stmCorrect, workerPerQuestion: stmWorker }));
      reports.set(`217-m1.${model}.memory-off.${suite}`, suiteReport(ids, { correct: () => false, workerPerQuestion: 0 }));
    }
    reports.set(`217-m1.${model}.OM-before.long-session`, familyReport("OM-before", { rederivations: () => 2 }));
    reports.set(`217-m1.${model}.STM.long-session`, familyReport("STM", { rederivations: stmRederivations, workerTokens: stmWorker }));
    reports.set(`217-m1.${model}.memory-off.long-session`, familyReport("memory-off", { rederivations: () => 3, workerTokens: 0 }));
  }
  return reports;
}

test("gate_m1_arms_paired_on_identical_items", async () => {
  const jobs = m1Jobs();
  // The family: 2 models x 3 arms; the S4 suite sample: 2 models x 2 suites x {STM, OM-before}.
  assert.equal(jobs.length, 2 * 3 + 2 * 2 * 2);
  assertM1Paired(jobs);
  // Every (model, suite) group holds the three arms, alike in everything but the arm and its tree.
  for (const model of ["small", "large"])
    for (const suite of ["longmemeval-m", "beam-1m", "long-session"]) {
      const group = jobs.filter((job) => job.model_key === model && job.suite === suite);
      const arms = suite === "long-session" ? M1_ARMS.map((arm) => arm.id) : ["OM-before", "STM"];
      assert.deepEqual(group.map((job) => job.arm).sort(), [...arms].sort());
      if (suite !== "long-session") assert.ok(group.every((job) => job.maxQuestions === 2 && job.concurrency === 1));
      assert.equal(new Set(group.map((job) => `${job.provider}/${job.model}|${job.judges}|${job.subset}`)).size, 1);
      assert.ok(group.every((job) => job.subset === "dev"));
    }
  // The worker arms of a pair run back to back, so a halt on a spent allowance leaves whole pairs.
  const workers = jobs.filter((job) => job.config === "om").map((job) => job.id);
  for (let index = 0; index < workers.length; index += 2) {
    assert.match(workers[index], /\.STM\./);
    assert.equal(workers[index + 1], workers[index].replace(".STM.", ".OM-before."));
  }
  // A pair that differs in more than the arm is refused.
  const tampered = jobs.map((job) => (job.id === "217-m1.small.OM-before.beam-1m" ? { ...job, judges: "ollama-cloud/gpt-oss:120b" } : job));
  assert.throws(() => assertM1Paired(tampered), /differ in more than the arm/);
  // Scoring pairs identical items only: a question one arm did not finish is unpaired, never imputed.
  const pair = m1AccuracyPair(suiteReport(ids.slice(0, 10)), suiteReport(ids), "beam-1m", { iterations: 200 });
  assert.equal(pair.n, 10);
  assert.deepEqual(pair.unpaired, { base: 0, arm: 2 });
  // Development partition only, in the manifest, the CLI and the live family child.
  assert.throws(() => assertM1Partition("heldout-a"), /dev partition only/);
  const live = [
    "--job",
    "j",
    "--model",
    "ollama-cloud/deepseek-v4.1-flash",
    "--arm",
    "STM",
    "--max-input-tokens",
    "10",
    "--output",
    "o.json",
    "--state-dir",
    "s",
  ];
  assert.equal(parseLongSessionLiveArgs(live).partition, "dev");
  assert.throws(() => parseLongSessionLiveArgs([...live, "--partition", "heldout-a"]), /dev partition only/);
  assert.throws(() => parseLongSessionLiveArgs(live.map((value) => (value === "STM" ? "P" : value))), /unknown long-session arm/);
});

test("om_before_runs_from_pinned_pre_216_revision", async () => {
  const manifest = await buildM1Manifest();
  const om = baselines.omBefore;
  assert.equal(manifest.productRevision["OM-before"], om.revision);
  assert.deepEqual(manifest.baselines.omBefore, {
    revision: om.revision,
    productHash: om.productHash,
    productPaths: om.productPaths,
    worktree: M1_WORKTREE,
  });
  for (const job of manifest.jobs) {
    if (job.arm === "OM-before") assert.equal(job.cwd, M1_WORKTREE, job.id);
    else assert.equal(job.cwd, undefined, job.id);
  }
  // The worktree must be at the pinned revision, installed, and still hold the pinned observational product.
  const root = mkdtempSync(join(tmpdir(), "m1-worktree-"));
  for (const path of M1_WORKTREE_COPY) {
    const text = path.includes(".") ? readFileSync(path, "utf8") : null;
    mkdirSync(join(root, path.includes(".") ? path.split("/").slice(0, -1).join("/") : path), { recursive: true });
    if (text !== null) writeFileSync(join(root, path), text);
  }
  const worktree = "wt";
  mkdirSync(join(root, worktree, "packages/memory/observational/src"), { recursive: true });
  writeFileSync(join(root, worktree, "packages/memory/observational/src/index.ts"), "export const observer = 1;\n");
  const productHash = await sourceFingerprint(["packages/memory/observational/src"], join(root, worktree));
  const at = (head) => () => ({ stdout: Buffer.from(`${head}\n`) });
  const pin = { root, worktree, revision: om.revision, productHash, productPaths: ["packages/memory/observational/src"] };
  await assert.rejects(prepareM1Worktree({ ...pin, run: at("0".repeat(40)) }), /not the pinned/);
  await assert.rejects(prepareM1Worktree({ ...pin, run: at(om.revision) }), /no node_modules/);
  mkdirSync(join(root, worktree, "node_modules"));
  const ready = await prepareM1Worktree({ ...pin, run: at(om.revision) });
  assert.equal(ready.revision, om.revision);
  assert.equal(
    readFileSync(join(root, worktree, "scripts/memory-bench/work-outcome/long-session-live.mjs"), "utf8"),
    readFileSync("scripts/memory-bench/work-outcome/long-session-live.mjs", "utf8"),
  );
  writeFileSync(join(root, worktree, "packages/memory/observational/src/index.ts"), "export const observer = 2;\n");
  await assert.rejects(prepareM1Worktree({ ...pin, run: at(om.revision) }), /does not hash to the pinned productHash/);
  // The run starts only on the owner's word, bound to this manifest.
  const record = {
    kind: "memory-model-owner-gate",
    gate: "M-1",
    plan: 217,
    approved: false,
    approvedBy: "owner",
    text: "x",
    manifestHash: manifest.manifestHash,
    memoryModelCriteriaHash: manifest.memoryModelCriteriaHash,
    criteriaHash: manifest.criteriaHash,
    partitions: ["dev"],
    budget: { billing: "paid-allowance", provider: "ollama-cloud" },
    models: {
      answers: { large: "ollama-cloud/deepseek-v4.1-flash", small: "ollama-cloud/mimo-v2.6-flash" },
      judges: ["ollama-cloud/gpt-oss:120b", "ollama-cloud/gemma4:31b"],
    },
  };
  assert.throws(() => assertM1Gate(record, manifest), /not approved by the owner/);
  assert.equal(assertM1Gate({ ...record, approved: true }, manifest).approved, true);
  assert.throws(() => assertM1Gate({ ...record, approved: true, manifestHash: "0" }, manifest), /differs from the approved one/);
  assert.throws(() => assertM1Gate({ ...record, approved: true, partitions: ["dev", "heldout-a"] }, manifest), /dev partition only/);
  assert.throws(
    () => assertM1Gate({ ...record, approved: true, models: { ...record.models, judges: ["openrouter/free"] } }, manifest),
    /outside the gate M-1 models/,
  );
  // A gate C-1 route the owner did not name for M-1 is refused.
  assert.throws(
    () => assertM1Gate({ ...record, approved: true, models: { ...record.models, answers: { large: "ollama-cloud/beam" } } }, manifest),
    /outside the gate M-1 models/,
  );
  // The committed record either refuses (not approved) or binds this exact manifest.
  const committed = JSON.parse(readFileSync("docs/_evidence/memory-bench/217/gates/owner-gate-m1.json", "utf8"));
  if (committed.approved) assert.equal((await buildExecutableM1Manifest()).executable, true);
  else await assert.rejects(buildExecutableM1Manifest(), /not approved by the owner/);
});

test("m1_verdicts_computed_from_memory_model_criteria_only", async () => {
  const manifest = await buildM1Manifest();
  // STM matches OM-before on every question, re-derives less, and spends 1.3x the worker tokens.
  const evidence = buildM1Evidence({ reports: allReports({ stmWorker: 1300 }), manifest, probes, iterations: 200 });
  const verdict = memoryModelGateVerdict("M-1", evidence, { partition: "dev" });
  const status = Object.fromEntries(verdict.rows.map((row) => [row.row, row.status]));
  assert.deepEqual(status, { S1: "pass", S2: "pass", S3: "deferred", S4: "miss" });
  assert.equal(verdict.status, "miss");
  assert.equal(evidence.rows.S4.tests["token-ratio"].value, 1.3);
  // S3 is deferred to gate A (owner decision m1S3Deferred); the sample's paired accuracy is a diagnostic only.
  assert.deepEqual(evidence.rows.S3.deferred, { to: "A", decision: "m1S3Deferred" });
  assert.equal(evidence.rows.S3.diagnostic.cells.length, 4);
  // A written justification is the only thing that turns S4's miss into a pass; it is read, never set by the builder.
  const justified = buildM1Evidence({
    reports: allReports({ stmWorker: 1300 }),
    manifest,
    probes,
    justification: "kind and verbatim chunks",
    iterations: 200,
  });
  assert.equal(memoryModelGateVerdict("M-1", justified).rows.find((row) => row.row === "S4").status, "pass");
  // No re-derivation gain is a miss; an accuracy loss no longer decides M-1 (S3 is gate A's).
  const worse = buildM1Evidence({
    reports: allReports({ stmCorrect: (index) => index % 3 !== 0, stmRederivations: () => 2 }),
    manifest,
    probes,
    iterations: 200,
  });
  const worseStatus = Object.fromEntries(memoryModelGateVerdict("M-1", worse).rows.map((row) => [row.row, row.status]));
  assert.equal(worseStatus.S1, "miss");
  assert.equal(worseStatus.S3, "deferred");
  // A missing or unfinished report leaves its row missing, never passed.
  const partial = allReports();
  partial.delete("217-m1.large.OM-before.beam-1m");
  partial.set("217-m1.small.STM.long-session", { ...familyReport("STM"), status: "failed" });
  const missing = Object.fromEntries(
    memoryModelGateVerdict("M-1", buildM1Evidence({ reports: partial, manifest, probes, iterations: 200 })).rows.map((row) => [
      row.row,
      row.status,
    ]),
  );
  assert.deepEqual(missing, { S1: "missing", S2: "pass", S3: "deferred", S4: "missing" });
  // A capped sample (the run reports `partial`) counts once it answered exactly its sample, on the same ids in both arms.
  const capped = allReports({ stmWorker: 1100 });
  for (const [id, report] of capped)
    if (!id.endsWith("long-session")) capped.set(id, { ...report, status: "partial", results: report.results.slice(0, 2) });
  const cappedManifest = {
    ...manifest,
    jobs: manifest.jobs.map((job) => (job.suite === "long-session" ? job : { ...job, maxQuestions: 2 })),
  };
  const cappedEvidence = buildM1Evidence({ reports: capped, manifest: cappedManifest, probes, iterations: 200 });
  assert.equal(memoryModelGateVerdict("M-1", cappedEvidence).rows.find((row) => row.row === "S4").status, "pass");
  const other = capped.get("217-m1.small.STM.beam-1m");
  capped.set("217-m1.small.STM.beam-1m", { ...other, results: [other.results[0], { ...other.results[1], id: "elsewhere" }] });
  const mismatched = buildM1Evidence({ reports: capped, manifest: cappedManifest, probes, iterations: 200 });
  assert.equal(mismatched.cells["small.beam-1m"], "missing");
  // The evidence pins the frozen criteria and carries ids, counts and scores only.
  assert.equal(evidence.memoryModelCriteriaHash, manifest.memoryModelCriteriaHash);
  assert.doesNotMatch(JSON.stringify(evidence), /"(text|answer|question|gold|description)"/);
  // The verdict is the criteria's: a tampered pin is refused.
  assert.throws(
    () => memoryModelGateVerdict("M-1", { ...evidence, memoryModelCriteriaHash: "0".repeat(64) }),
    /different memory-model criteria/,
  );
});

test("chunk_meter_counts_stored_bytes_and_peak", async () => {
  const deleted = new Set();
  const inner = {
    put: async () => {},
    ref: async () => true,
    unref: async (id) => ({ deleted: !deleted.has(id) && deleted.add(id) && true }),
    apply: async (ops) => ({ deleted: ops.filter((op) => op.op === "unref").map((op) => op.id) }),
    get: async () => undefined,
    list: async () => [],
  };
  const meter = createChunkMeter();
  const store = meteredChunkStore(inner, meter);
  const by = { kind: "stm", id: "r", sessionId: "s" };
  await store.apply([
    { op: "put", chunk: { id: "a", bytes: 100 }, by },
    { op: "put", chunk: { id: "b", bytes: 50 }, by },
    { op: "put", chunk: { id: "a", bytes: 100 }, by: { ...by, id: "r2" } },
  ]);
  assert.deepEqual([meter.bytes, meter.peakBytes, meter.chunks], [150, 150, 2]);
  await store.apply([{ op: "unref", id: "a", by }]);
  await store.unref("b", by);
  assert.deepEqual([meter.bytes, meter.peakBytes, meter.chunks, meter.deletes], [0, 150, 0, 2]);
});
