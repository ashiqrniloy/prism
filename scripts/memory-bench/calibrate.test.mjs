import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSnapshot, memoryConfigs } from "./ablations.mjs";
import { calibrateConsolidation, calibrateFiles, calibrateInjection, calibratePromotion, calibrateRetention } from "./calibrate.mjs";
import defaults from "./defaults.json" with { type: "json" };
import { parseArgs, runBench } from "./run.mjs";

test("retention_fit_enforces_regret_constraint_and_rejects_empty_denominators", () => {
  const reports = [
    { policyHash: "a".repeat(64), status: "completed", metrics: { archiveRegret: 0.03, graveyardIndex: 0 } },
    { policyHash: "b".repeat(64), status: "completed", metrics: { archiveRegret: 0.02, graveyardIndex: 0.1 } },
    { policyHash: "c".repeat(64), status: "completed", metrics: { archiveRegret: null, graveyardIndex: 0 } },
    { policyHash: "d".repeat(64), status: "failed", metrics: { archiveRegret: 0, graveyardIndex: 0 } },
  ];
  assert.equal(calibrateRetention(reports).selected.policyHash, "b".repeat(64));
  assert.equal(calibrateRetention([reports[0], reports[2]]).selected, null);
  assert.throws(() => calibrateRetention([{ ...reports[0], metrics: { archiveRegret: 0, graveyardIndex: -1 } }]));
});

test("config_defaults_match_evidence", () => {
  assert.deepEqual(defaultSnapshot(), defaults.defaults);
  assert.match(defaults.status, /provisional/);
});

test("calibration_preserves_field_audit_and_refuses_missing_cosine", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prism-calibration-"));
  try {
    const pairs = join(dir, "pairs.jsonl"),
      goldReport = join(dir, "gold.json");
    await writeFile(pairs, `${JSON.stringify({ dice: 0.8, sameNote: true })}\n`);
    await writeFile(
      goldReport,
      JSON.stringify({
        dataset: "a".repeat(64),
        provenance: "synthetic-construction",
        provisional: false,
        duplicateAudit: { fields: { sameNote: { provisional: true, n: 0, kappa: null, errorRate: null, text: "private audit notes" } } },
      }),
    );
    const result = await calibrateFiles({ kind: "consolidation", pairs, goldReport });
    assert.equal(result.provisional, true);
    assert.equal(result.audit.provisional, true);
    assert.ok(!JSON.stringify(result).includes("private audit notes"));
    await assert.rejects(calibrateFiles({ kind: "consolidation", pairs, goldReport, mode: "hybrid" }));
    await assert.rejects(calibrateFiles({ kind: "consolidation", pairs }));
    const replay = {
      suite: "lifecycle-replay",
      status: "completed",
      calls: { extractor: 0 },
      policyHash: "b".repeat(64),
      metrics: { archiveRegret: 0, graveyardIndex: 0.2 },
    };
    const replayPath = join(dir, "replay.json");
    await writeFile(replayPath, JSON.stringify([replay]));
    assert.equal((await calibrateFiles({ kind: "retention", reports: [replayPath] })).selected.graveyardIndex, 0.2);
    await writeFile(replayPath, JSON.stringify({ ...replay, calls: { extractor: 1 } }));
    await assert.rejects(calibrateFiles({ kind: "retention", reports: [replayPath] }), /warm/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory_bench_calibrate_picks_lowest_bin_at_half_used_rate", () => {
  const result = calibrateInjection([
    { coverage: 0.05, label: "irrelevant" },
    { coverage: 0.25, label: "used" },
    { coverage: 0.28, label: "irrelevant" },
    { coverage: 1, label: "used" },
    { coverage: null, label: "used" },
  ]);
  assert.equal(result.floor, 0.2);
  assert.equal(result.bins[2].usedRate, 0.5);
  assert.equal(result.bins[9].n, 1);
  assert.equal(result.excluded, 1);
  assert.equal(calibrateInjection([]).floor, null);
  assert.throws(() => calibrateInjection([{ coverage: 1.1, label: "used" }]));
});

test("memory_bench_calibrate_consolidation_threshold_meets_precision_floor", () => {
  const rows = [
    { dice: 0.2, sameNote: false },
    { dice: 0.6, sameNote: false },
    { dice: 0.7, sameNote: true },
    { dice: 0.8, sameNote: true },
    { dice: 0.9, sameNote: true },
  ];
  const result = calibrateConsolidation(rows);
  assert.equal(result.threshold, 0.7);
  assert.equal(result.selected.precision, 1);
  assert.equal(result.selected.f1, 1);
  assert.equal(calibrateConsolidation([{ dice: 1, sameNote: false }]).threshold, null);
  assert.throws(() => calibrateConsolidation([{ dice: 0.5, sameNote: "yes" }]));
  assert.throws(() => calibrateConsolidation(rows, { mode: "hybrid" }));
  assert.equal(
    calibrateConsolidation(
      [
        { cosine: -0.5, sameNote: false },
        { cosine: 0.8, sameNote: true },
      ],
      { mode: "hybrid" },
    ).threshold,
    0.8,
  );
});

test("memory_bench_ablate_flag_toggles_feature", async () => {
  const options = parseArgs(["--offline", "--config", "fabric", "--ablate", "fabric.inject=off", "--ablate", "fabric.directory=off"]);
  const report = await runBench(options);
  assert.equal(report.memoryConfig.fabric.inject, false);
  assert.equal(report.memoryConfig.fabric.directory, false);
  assert.equal(report.injections.length, 0);
  assert.equal(report.recallCalls, 0);
  assert.deepEqual(report.ablations, options.ablate);
  const on = memoryConfigs({ config: "fabric", ablate: ["fabric.inject.budgetTokens=1200", "fabric.inject.query=user"] });
  assert.equal(on.fabric.inject.budgetTokens, 1200);
  assert.equal(on.fabric.inject.query, "user");
  assert.throws(() => memoryConfigs({ config: "full", ablate: ["fabric.inject=off"] }));
  assert.throws(() => memoryConfigs({ config: "fabric", ablate: ["fabric.stem=off"] }));
  assert.throws(() => memoryConfigs({ config: "fabric", ablate: ["fabric.inject.budgetTokens=-1"] }));
  assert.throws(() => memoryConfigs({ config: "fabric", ablate: ["fabric.tools.root=/tmp"] }));
  assert.throws(() => memoryConfigs({ config: "fabric", ablate: ["fabric.inject=off", "fabric.inject.query=user"] }));
  assert.equal(memoryConfigs({ config: "fabric", ablate: ["fabric.consolidate.decider=off"] }).fabric.consolidate.decider, undefined);
  assert.equal(
    memoryConfigs({ config: "fabric", ablate: ["fabric.consolidate.decider=off"] }, { lifecycle: true, policy: { consolidate: false } })
      .fabric.consolidate,
    false,
  );
  assert.throws(() => memoryConfigs({ config: "fabric-agentic", ablate: ["fabric.inject=on"] }));
  assert.throws(() => memoryConfigs({ config: "om", ablate: ["om.dropper.targetTokens=5000"] }));
  const om = memoryConfigs({ config: "om", ablate: ["om.reflector.observationTokens=5000", "om.dropper.targetTokens=5000"] });
  assert.equal(om.observational.dropper.targetTokens, 5000);
  const policy = { inject: { query: "user" } };
  memoryConfigs({ config: "fabric", ablate: ["fabric.inject.query=task"] }, { lifecycle: true, policy });
  assert.equal(policy.inject.query, "user");
  await assert.rejects(runBench({ replay: "ignored", ablate: ["fabric.promote=off"] }), /use --policy/);
  const lifecycle = await runBench({
    suite: "lifecycle",
    config: "om+fabric",
    offline: true,
    projects: 1,
    sessions: 1,
    ablate: ["fabric.promote=off", "om.observer.messageTokens=2"],
  });
  assert.equal(lifecycle.memoryConfig.fabric.promote.enabled, false);
  assert.equal(lifecycle.memoryConfig.observational.observer.messageTokens, 2);
});

test("promotion_fit_splits_personas_preserves_hard_gates_and_never_tunes_heldout", () => {
  const signals = { explicit: 0, correction: 0, outcome: 0, recurrence: 0, generality: 1, ephemerality: 0, derivability: 0, duplicate: 0 };
  const rows = ["a", "b", "c", "d", "e"].flatMap((persona) => [
    { persona, label: true, signals },
    { persona, label: false, signals: { ...signals, generality: 0 } },
    { persona, label: false, signals: { ...signals, explicit: 1, derivability: 1 } },
    { persona, label: false, signals: { ...signals, ephemerality: 1 } },
    { persona, label: true, signals: { ...signals, explicit: 1, ephemerality: 1 } },
  ]);
  const result = calibratePromotion(rows);
  assert.deepEqual(result.split.heldout, ["e"]);
  assert.equal(result.selected.train.precision, 1);
  assert.equal(result.selected.train.f1, 1);
  assert.equal(result.heldout.f1, 1);
  assert.equal(result.provisional, true);
  const changed = rows.map((row) => (row.persona === "e" ? { ...row, label: !row.label } : row));
  assert.deepEqual(calibratePromotion(changed).selected, result.selected);
  assert.deepEqual(calibratePromotion([...rows].reverse()).selected, result.selected);
  assert.throws(() => calibratePromotion(rows.filter((row) => row.persona === "a")), /personas/);
  assert.throws(() => calibratePromotion([{ ...rows[0], signals: { ...signals, duplicate: NaN } }]));
  assert.equal(calibratePromotion(rows, { audit: { n: 20, kappa: 1, errorRate: 0, provisional: true } }).provisional, true);
});

test("promotion_fit_changes_weights_and_keeps_unaudited_gold_provisional", async () => {
  const signals = { explicit: 0, correction: 0, outcome: 0, recurrence: 0, generality: 0, ephemerality: 0, derivability: 0, duplicate: 0 };
  const rows = ["a", "b", "c", "d", "e"].flatMap((persona) => [
    { persona, label: true, signals: { ...signals, recurrence: 1 } },
    { persona, label: false, signals: { ...signals, generality: 1 } },
  ]);
  const result = calibratePromotion(rows);
  assert.equal(result.baseline.train.f1, 2 / 3);
  assert.equal(result.selected.train.f1, 1);
  assert.notDeepEqual(result.selected.weights, result.baseline.weights);
  assert.equal(result.heldout.precision, 1);
  assert.equal(calibratePromotion(rows.map((row) => ({ ...row, label: false }))).selected, null);
  const dir = await mkdtemp(join(tmpdir(), "prism-promotion-calibration-"));
  try {
    const pairs = join(dir, "rows.jsonl"),
      goldReport = join(dir, "gold.json");
    await writeFile(pairs, rows.map((row) => JSON.stringify(row)).join("\n"));
    await writeFile(
      goldReport,
      JSON.stringify({
        dataset: "a".repeat(64),
        provenance: "synthetic-construction",
        status: "complete",
        provisional: false,
        fields: { shouldPromote: { n: 20, kappa: 1, errorRate: 0, provisional: false, text: "private" } },
      }),
    );
    const report = await calibrateFiles({ kind: "promotion", pairs, goldReport });
    assert.equal(report.provisional, true);
    assert.equal(report.audit.kappa, 1);
    assert.ok(!JSON.stringify(report).includes("private"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("calibration_does_not_promote_sparse_or_unaudited_bins_to_defaults", () => {
  const sparse = calibrateInjection([
    { coverage: 0.25, label: "used" },
    { coverage: 0.25, label: "irrelevant" },
  ]);
  assert.equal(sparse.floor, 0.2, "descriptive hint is retained");
  assert.equal(sparse.eligibleFloor, null);
  assert.equal(sparse.defaultEligible, false);
  const dense = calibrateInjection(Array.from({ length: 20 }, (_, i) => ({ coverage: 0.25, label: i < 12 ? "used" : "irrelevant" })));
  assert.equal(dense.eligibleFloor, 0.2);
  assert.equal(dense.defaultEligible, false, "unaudited bins are not a default");
  const audited = calibrateInjection(
    Array.from({ length: 20 }, (_, i) => ({ coverage: 0.25, label: i < 12 ? "used" : "irrelevant" })),
    { auditedGold: true },
  );
  assert.equal(audited.defaultEligible, true);
});

test("bench_fabric_x_tools_is_the_preset", async () => {
  const { resolveMemoryFabricConfig } = await import("@arnilo/prism-memory-fabric");
  const { BENCH_SCOPES } = await import("./bench-scope.mjs");
  // The 188.10 Task 9 `fabric-x-tools` arm as it was spelled before the preset existed.
  const accepted = { retrieval: "lexical", inject: { query: "task", kinds: ["exchange"] }, scopes: BENCH_SCOPES, exchanges: {} };
  for (const config of ["fabric-x", "fabric-x-tools"]) {
    const arm = memoryConfigs({ config }).fabric;
    assert.equal(arm.preset, "conversational", `${config} is expressed as the preset`);
    const { preset, ...resolved } = resolveMemoryFabricConfig(arm);
    assert.equal(preset.name, "conversational");
    assert.deepEqual(resolved, resolveMemoryFabricConfig(accepted), `${config} resolves to the accepted arm`);
  }
  // An ablation of one nested key starts from the preset's field, as the arm did before the preset.
  const ablated = memoryConfigs({ config: "fabric-x-tools", ablate: ["fabric.inject.budgetTokens=1200"] }).fabric;
  assert.deepEqual(ablated.inject, { query: "task", kinds: ["exchange"], budgetTokens: 1200 });
});
