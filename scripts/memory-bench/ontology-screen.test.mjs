/**
 * Plan 208 Task 5: the development screen's manifest and gate. No network, no model call.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { ontologyJobArgs } from "./campaign.mjs";
import {
  assertScreen208Gate,
  assertScreen208Jobs,
  assertScreen208Partition,
  buildScreen208Manifest,
  preflightScreen208,
  SCREEN208_JUDGES,
  SCREEN208_MODELS,
  SCREEN208_PAIRED_MODELS,
  SCREEN208_QUICK_QUESTIONS,
  SCREEN208_SERIES_MODEL,
  SCREEN208_SMOKE_MAX_QUESTIONS,
  SCREEN208_SUITES,
  screen208Job,
  screen208Jobs,
  screen208QuickJobs,
  screen208RouteJobs,
  screen208SmokeJobs,
  screen208WorkerJobs,
  screen208WorkerPaths,
} from "./ontology-screen.mjs";
import { judgeFamily, resolveJudgePanel } from "./judge.mjs";
import { parseArgs } from "./run.mjs";

test("plan_208_profile_refuses_heldout_partitions", () => {
  assert.equal(assertScreen208Partition("dev"), "dev");
  for (const partition of ["heldout-a", "heldout-b", "all", undefined])
    assert.throws(() => assertScreen208Partition(partition), /dev partition only/);
  const [job] = screen208Jobs();
  for (const subset of ["heldout-a", "heldout-b"])
    assert.throws(() => assertScreen208Jobs([{ ...job, subset }]), /plan 208 reads dev only/);
  assert.throws(() => assertScreen208Jobs([{ ...job, provider: "openrouter" }]), /not a free Kilo or OpenCode Go job/);
  assert.throws(() => assertScreen208Jobs([{ ...job, freeOnly: false }]), /not a free Kilo or OpenCode Go job/);
  // OpenCode Go runs free only on its `-free` rows.
  assert.throws(() => assertScreen208Jobs([{ ...job, provider: "opencode-go", model: "glm-5" }]), /not a free Kilo or OpenCode Go job/);
});

test("screen_jobs_pair_every_ontology_arm_with_its_base_on_the_same_cohort", () => {
  const jobs = screen208Jobs();
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length, "unique ids");
  // Large runs on Kilo free-only, the third model on OpenCode Go free-only; the paid small slot runs on Command Code.
  assert.ok(jobs.every((job) => job.subset === "dev"));
  const of = (key) => jobs.filter((job) => job.id.startsWith(`208-screen.${key}.`));
  assert.ok(of("large").every((job) => job.provider === "kilo" && job.freeOnly));
  // The small slot runs on Qwen, except MemoryAgentBench-CR, which runs on Muse after Qwen's route refused some of its
  // questions (gate amendment 16); both arms of a pair share the model.
  assert.ok(of("small").every((job) => job.provider === "commandcode" && !job.freeOnly));
  for (const job of of("small"))
    assert.equal(job.model, job.suite === "memoryagentbench-cr" ? "meta/muse-spark-1.2-contributor" : "Qwen/Qwen3.7-Flash", job.id);
  assert.ok(of("beamfree").every((job) => job.provider === "opencode-go" && job.model === "beam-free" && job.freeOnly));
  assert.equal(of("small").length, 6);
  assert.equal(of("beamfree").length, 6, "the third model reads P against P+O on three suites");
  assert.equal(of("large").length, 6, "the large model reads P against P+O only; its trigger-policy arms moved to the series model");
  // The series model (Muse 1.2 Contributor, paid, gate amendment 11) runs the six trigger-policy arms and nothing else.
  assert.ok(of("muse").every((job) => job.provider === "commandcode" && job.model === SCREEN208_SERIES_MODEL.model && !job.freeOnly && job.warmup));
  assert.equal(of("muse").length, 6);
  assert.equal(jobs.length, 24);
  assert.ok(jobs.filter((job) => !job.warmup).every((job) => job.interleaveAbilities), "any prefix is a balanced slice");
  for (const model of SCREEN208_PAIRED_MODELS)
    for (const suite of SCREEN208_SUITES) {
      const base = jobs.find((job) => job.id === `208-screen.${model.key}.P.${suite}`);
      const twin = jobs.find((job) => job.id === `208-screen.${model.key}.P+O.${suite}`);
      assert.ok(base && twin, `${model.key} ${suite} has P and P+O`);
      for (const field of ["suite", "subset", "config", "provider", "model", "judges"]) assert.equal(twin[field], base[field], field);
      assert.equal(base.ontology, undefined);
      assert.equal(twin.ontology, true);
      assert.notEqual(twin.answersDir, base.answersDir, "a pair never shares answer checkpoints");
      assert.notEqual(twin.judgeCacheDir, base.judgeCacheDir);
    }
  // The trigger-policy comparison is the series model's; both series arms see the same warm-up and scored sets.
  const series = jobs.filter((job) => job.warmup);
  assert.deepEqual([...new Set(series.map((job) => job.model))], [SCREEN208_SERIES_MODEL.model]);
  const readTime = series.filter((job) => job.ablate?.length);
  assert.equal(readTime.length, SCREEN208_SUITES.length);
  assert.deepEqual(readTime[0].ablate, ['wiki.consolidate.triggers=["co-read","repair"]']);
  assert.equal(new Set(series.map((job) => job.warmup)).size, 1);
  // The judges are neither answer models nor each other's family.
  const refs = new Set(SCREEN208_MODELS.map((model) => `${model.provider}/${model.model}`));
  assert.ok(jobs[0].judges.split(",").every((judge) => !refs.has(judge)));
});

test("screen_job_flags_reach_run_mjs", () => {
  const job = screen208Job({
    model: SCREEN208_SERIES_MODEL,
    arm: { id: "P+O.series-readtime", ontology: true, series: true, readTimeOnly: true },
    suite: "locomo",
  });
  const options = parseArgs(ontologyJobArgs(job));
  assert.equal(options.ontology, true);
  assert.equal(options.warmup, 2);
  assert.match(options.ontologyArm, /^P\+O\.series-readtime\.muse$/);
});

test("gate_is_bound_to_the_manifest_hash_and_free_kilo_or_an_owner_capped_paid_model", async () => {
  const manifest = await buildScreen208Manifest();
  assert.equal(manifest.executable, false);
  assert.deepEqual(manifest.billing.paidAnswers, ["commandcode/Qwen/Qwen3.7-Flash", "commandcode/meta/muse-spark-1.2-contributor"]);
  assert.deepEqual(manifest.billing.paidFallbacks, []);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  const gate = {
    plan: 208,
    gate: "O-1",
    approved: true,
    approvedBy: "owner",
    text: "Kilo free models only",
    manifestHash: manifest.manifestHash,
    billing: { totalUsd: 0, paidFallbacks: [] },
    amendments: [
      { by: "owner", paidAnswer: { ref: "commandcode/Qwen/Qwen3.7-Flash", usdCap: 25 } },
      { by: "owner", freeAnswers: ["opencode-go/beam-free"] },
      { by: "owner", paidAnswer: { ref: "commandcode/meta/muse-spark-1.2-contributor", uncapped: true } },
    ],
  };
  assert.equal(assertScreen208Gate(gate, manifest), gate);
  // The paid model runs only under an owner amendment with a positive USD cap; a non-Kilo free model only when named.
  assert.throws(() => assertScreen208Gate({ ...gate, amendments: [gate.amendments[1]] }, manifest), /owner-capped paid model/);
  assert.throws(() => assertScreen208Gate({ ...gate, amendments: [gate.amendments[0], gate.amendments[2]] }, manifest), /beamfree.*owner-named free model/);
  assert.throws(
    () =>
      assertScreen208Gate(
        { ...gate, amendments: [{ by: "owner", paidAnswer: { ref: "commandcode/Qwen/Qwen3.7-Flash", usdCap: 0 } }, gate.amendments[1]] },
        manifest,
      ),
    /owner-capped paid model/,
  );
  // "No cap" must be stated outright: a Muse amendment with neither a USD cap nor `uncapped: true` refuses.
  assert.throws(
    () => assertScreen208Gate({ ...gate, amendments: [gate.amendments[0], gate.amendments[1], { by: "owner", paidAnswer: { ref: "commandcode/meta/muse-spark-1.2-contributor" } }] }, manifest),
    /(small|muse)\..*owner-capped paid model/,
  );
  assert.throws(() => assertScreen208Gate({ ...gate, amendments: [gate.amendments[0], gate.amendments[1]] }, manifest), /(small|muse)\..*owner-capped paid model/);
  assert.throws(() => assertScreen208Gate(undefined, manifest), /no gate record/);
  assert.throws(() => assertScreen208Gate({ ...gate, approved: false }, manifest), /not approved/);
  assert.throws(() => assertScreen208Gate({ ...gate, approvedBy: "agent" }, manifest), /not approved by the owner/);
  assert.throws(() => assertScreen208Gate({ ...gate, manifestHash: "0".repeat(64) }, manifest), /changed manifest is a refusal/);
  assert.throws(() => assertScreen208Gate({ ...gate, billing: { totalUsd: 0, paidFallbacks: ["x"] } }, manifest), /no paid fallback/);
  assert.throws(
    () => assertScreen208Gate(gate, { ...manifest, jobs: [{ ...manifest.jobs[0], provider: "hyper" }] }),
    /not a free Kilo job/,
  );
  assert.throws(
    () => assertScreen208Gate(gate, { ...manifest, jobs: [{ ...manifest.jobs[0], provider: "commandcode", model: "Qwen/Qwen3.8-Max", freeOnly: false }] }),
    /owner-capped paid model/,
    "only the named paid model may run paid",
  );
});

test("smoke_is_a_question_filter_on_approved_jobs", async () => {
  const manifest = await buildScreen208Manifest();
  const jobs = screen208SmokeJobs(manifest, "muse.P+O.series-readtime.memoryagentbench-cr");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].maxQuestions, SCREEN208_SMOKE_MAX_QUESTIONS);
  assert.equal(jobs[0].warmup, 2);
  assert.throws(() => screen208SmokeJobs(manifest, "no-such-job"), /no approved job/);
  assert.throws(() => screen208SmokeJobs(manifest, ""), /name the jobs/);
});

test("worker_runs_an_exact_ordered_subset_with_its_own_journal_and_summary", async () => {
  const manifest = await buildScreen208Manifest();
  const ids = [manifest.jobs[5].id, manifest.jobs[0].id].join(",");
  const jobs = screen208WorkerJobs(manifest, ids);
  assert.deepEqual(
    jobs.map((job) => job.id),
    [manifest.jobs[5].id, manifest.jobs[0].id],
  );
  assert.deepEqual(jobs[0], manifest.jobs[5], "a worker keeps the approved job as it is");
  const paths = screen208WorkerPaths(ids);
  assert.notEqual(paths.journalPath, ".cache/memory-bench/208/journal.json");
  assert.notEqual(paths.summaryPath, manifest.summaryPath);
  assert.match(paths.executionManifestPath, /execution-manifest-worker-/);
  assert.notEqual(screen208WorkerPaths(manifest.jobs[0].id).tag, paths.tag);
  assert.throws(() => screen208WorkerJobs(manifest, "no-such-job"), /no approved job/);
  assert.throws(() => screen208WorkerJobs(manifest, `${ids},${manifest.jobs[0].id}`), /listed twice/);
  assert.throws(() => screen208WorkerJobs(manifest, ""), /name the jobs/);
});

test("preflight_checks_each_provider_catalog_for_the_models_a_worker_runs", async () => {
  const manifest = await buildScreen208Manifest();
  const large = manifest.jobs.filter((job) => job.model === SCREEN208_MODELS[0].model);
  const free = (id) => ({ id, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] });
  const commandcode = {
    catalog: ["stealth/glyph-cluster:free", "stealth/crouton-alpha", "Qwen/Qwen3.7-Flash", "meta/muse-spark-1.2-contributor"].map((id) => ({ id, supported_endpoints: ["/chat/completions"] })),
  };
  // A worker is checked for its own models only: a large-only worker never reads the other catalogs.
  const ok = await preflightScreen208({ ...manifest, jobs: large }, { catalog: [free(SCREEN208_MODELS[0].model)], commandcode });
  assert.deepEqual(
    ok.panel.map((row) => row.ref),
    [`kilo/${SCREEN208_MODELS[0].model}`],
  );
  assert.deepEqual(
    ok.commandcode.map((row) => row.ref),
    manifest.models.judges,
    "the judges are checked in Command Code's catalog",
  );
  await assert.rejects(
    preflightScreen208({ ...manifest, jobs: large }, { catalog: [], commandcode }),
    /not in the Kilo catalog/,
  );
  await assert.rejects(
    preflightScreen208(manifest, { catalog: [free(SCREEN208_MODELS[0].model)], commandcode, opencodeGo: { catalog: [] } }),
    /not in the OpenCode Go catalog/,
  );
  // The paid small model passes only as a named paid answer model; a missing judge is refused.
  const qwen = manifest.jobs.filter((job) => job.provider === "commandcode");
  const paid = await preflightScreen208({ ...manifest, jobs: qwen }, { commandcode });
  assert.ok(paid.commandcode.find((row) => row.ref === "commandcode/Qwen/Qwen3.7-Flash")?.paid);
  await assert.rejects(
    preflightScreen208({ ...manifest, jobs: qwen, billing: { ...manifest.billing, paidAnswers: [] } }, { commandcode }),
    /neither free nor a named paid answer model/,
  );
  await assert.rejects(
    preflightScreen208({ ...manifest, jobs: large }, { catalog: [free(SCREEN208_MODELS[0].model)], commandcode: { catalog: commandcode.catalog.slice(1) } }),
    /glyph-cluster:free is not in the Command Code catalog/,
  );
  // OpenCode Go: the row must exist, be priced at zero and take tools.
  const goRow = (price, tools = true) => ({
    id: "beam-free",
    canonical_id: "reflection/beam-1.0-501b-a23b",
    cost: { text: { input: { price }, output: { price } } },
    capabilities: { tools: { supported: tools } },
    limit: { context: 1048576 },
  });
  const go = manifest.jobs.filter((job) => job.provider === "opencode-go");
  const goOk = await preflightScreen208({ ...manifest, jobs: go }, { commandcode, opencodeGo: { catalog: [goRow(0)] } });
  assert.deepEqual(goOk.opencodeGo, [{ ref: "opencode-go/beam-free", contextWindow: 1048576, canonical: "reflection/beam-1.0-501b-a23b" }]);
  await assert.rejects(preflightScreen208({ ...manifest, jobs: go }, { commandcode, opencodeGo: { catalog: [goRow(0.2)] } }), /not priced at zero/);
  await assert.rejects(preflightScreen208({ ...manifest, jobs: go }, { commandcode, opencodeGo: { catalog: [goRow(0, false)] } }), /takes no tools/);
  await assert.rejects(preflightScreen208({ ...manifest, jobs: go }, { commandcode, opencodeGo: { catalog: [] } }), /not in the OpenCode Go catalog/);
});

test("route_override_moves_only_the_jobs_an_owner_amendment_names", async () => {
  const manifest = await buildScreen208Manifest();
  const gate = JSON.parse(await Bun.file("docs/_evidence/memory-bench/208/gates/owner-gate-1.json").text());
  const pair = screen208WorkerJobs(manifest, "208-screen.large.P.beam-100k,208-screen.large.P+O.beam-100k");
  const moved = screen208RouteJobs(pair, gate, "openrouter");
  assert.deepEqual(
    moved.map((job) => [job.id, job.provider, job.model, job.freeOnly]),
    [
      ["208-screen.large.P.beam-100k", "openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free", true],
      ["208-screen.large.P+O.beam-100k", "openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free", true],
    ],
  );
  assert.ok(moved.every((job) => job.answersDir.includes("/208/openrouter/") && job.judgeCacheDir.includes("/208/openrouter/")));
  assert.ok(
    moved.every((job) => job.judges.startsWith("commandcode/")),
    "the judge panel stays on Command Code",
  );
  assert.throws(() => screen208RouteJobs(screen208WorkerJobs(manifest, "208-screen.large.P.locomo"), gate, "openrouter"), /does not move/);
  assert.throws(() => screen208RouteJobs(pair, { ...gate, amendments: [] }, "openrouter"), /no owner amendment/);
  assert.throws(() => screen208RouteJobs(pair, gate, "hyper"), /not an approved route/);
  const paid = structuredClone(gate);
  paid.amendments.find((item) => item.routeOverride).routeOverride.billing.totalUsd = 1;
  assert.throws(() => screen208RouteJobs(pair, paid, "openrouter"), /free models only/);
  // Amendment 4 still names the small jobs, but the small slot is now a paid model, so no free route can move it.
  const small = screen208WorkerJobs(manifest, "208-screen.small.P.locomo");
  assert.throws(() => screen208RouteJobs(small, gate, "openrouter"), /not a :free model/);
  assert.notEqual(screen208WorkerPaths("a", "openrouter").tag, screen208WorkerPaths("a").tag);
});

test("quick_read_runs_a_balanced_prefix_of_each_job_in_its_own_journal", async () => {
  const manifest = await buildScreen208Manifest();
  const ids = ["208-screen.large.P.locomo", "208-screen.muse.P+O.series-default.locomo", "208-screen.beamfree.P+O.beam-100k"].join(",");
  const jobs = screen208QuickJobs(screen208WorkerJobs(manifest, ids));
  // Series arms need whole clusters, so the quick read leaves them to the full run.
  assert.deepEqual(
    jobs.map((job) => [job.id, job.maxQuestions, job.interleaveAbilities]),
    [
      ["208-screen.large.P.locomo", SCREEN208_QUICK_QUESTIONS.locomo, true],
      ["208-screen.beamfree.P+O.beam-100k", SCREEN208_QUICK_QUESTIONS["beam-100k"], true],
    ],
  );
  // Same job and caches as the full run; only the journal differs, so the full run replays the prefix from cache.
  const [full] = screen208WorkerJobs(manifest, "208-screen.large.P.locomo");
  assert.equal(jobs[0].answersDir, full.answersDir);
  assert.notEqual(screen208WorkerPaths(ids, undefined, { quick: true }).journalPath, screen208WorkerPaths(ids).journalPath);
  assert.throws(() => screen208QuickJobs(screen208WorkerJobs(manifest, "208-screen.muse.P+O.series-default.locomo")), /only series arms/);
});

test("the command_code_judge_panel_passes_the_family_rule_for_every_answer_model", () => {
  assert.deepEqual([...SCREEN208_JUDGES].map(judgeFamily), ["glyph", "crouton"]);
  for (const model of SCREEN208_MODELS)
    assert.deepEqual(resolveJudgePanel({ judges: [...SCREEN208_JUDGES], answerModel: `${model.provider}/${model.model}` }).refs, [...SCREEN208_JUDGES]);
});

test("a_slow_model_gets_its_own_ontology_settle_bound_on_its_p_plus_o_jobs_only", () => {
  const jobs = screen208Jobs();
  const bound = (job) => job.ontologySettleMs;
  assert.ok(jobs.filter((job) => job.id.startsWith("208-screen.beamfree.") && job.ontology).every((job) => bound(job) === 600_000));
  assert.ok(jobs.filter((job) => !(job.id.startsWith("208-screen.beamfree.") && job.ontology)).every((job) => bound(job) === undefined), "every other job keeps the default");
  const job = jobs.find((item) => item.id === "208-screen.beamfree.P+O.locomo");
  const options = parseArgs(ontologyJobArgs(job));
  assert.equal(options.ontologySettleMs, 600_000);
  assert.equal(parseArgs(ontologyJobArgs(jobs.find((item) => item.id === "208-screen.small.P+O.locomo"))).ontologySettleMs, undefined);
});

test("a_slot_can_run_one_suite_on_another_model_without_changing_its_ids_or_pairing", () => {
  const jobs = screen208Jobs().filter((job) => job.id.startsWith("208-screen.small.") && job.suite === "memoryagentbench-cr");
  assert.deepEqual(jobs.map((job) => job.id).sort(), ["208-screen.small.P+O.memoryagentbench-cr", "208-screen.small.P.memoryagentbench-cr"]);
  assert.ok(jobs.every((job) => job.model === "meta/muse-spark-1.2-contributor" && job.provider === "commandcode" && !job.freeOnly));
  assert.equal(jobs[0].answersDir.includes("/small/"), true, "caches stay the slot's");
  assert.equal(new Set(jobs.map((job) => `${job.provider}/${job.model}`)).size, 1, "both arms of the pair share the model");
});
