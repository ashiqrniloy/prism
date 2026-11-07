import { beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryConfigs } from "../ablations.mjs";
import { parseLiveArgs, personaCheckpoint } from "./live.mjs";
import { WORK_OUTCOME_ARMS } from "./metrics.mjs";
import { runWorkOutcome, workOutcomeCriteria } from "./run.mjs";
import {
  assertScreen209Gate,
  assertScreen209Jobs,
  assertScreen209Partition,
  assertTuningRevision,
  buildScreen209Manifest,
  buildScreen209Report,
  SCREEN209_MODELS,
  SCREEN209_PW_ABLATE,
  SCREEN209_TUNING_FIELDS,
  screen209Jobs,
  screen209TuningDefaults,
  screen209WorkArgv,
  usdOf,
} from "./screen.mjs";

const liveArgs = (extra = []) => [
  "--job",
  "209-screen.work.large.P",
  "--model",
  "kilo/m",
  "--arm",
  "P",
  "--simulator",
  "kilo/s",
  "--judges",
  "a/b,c/d",
  "--max-input-tokens",
  "1000",
  "--output",
  "/tmp/out.json",
  ...extra,
];

test("plan_209_profile_refuses_heldout_partitions", async () => {
  assert.equal(assertScreen209Partition("dev"), "dev");
  for (const partition of ["heldout-a", "heldout-b", undefined])
    assert.throws(() => assertScreen209Partition(partition), /Screen209Partition: plan 209 reads the dev partition only/);
  // A job can name only `dev`, and the live child refuses a held-out partition before any reservation is read.
  const [job] = screen209Jobs();
  assert.throws(() => assertScreen209Jobs([{ ...job, subset: "heldout-a" }]), /Screen209Partition/);
  assert.throws(() => parseLiveArgs(liveArgs(["--partition", "heldout-b"])), /Screen209Partition/);
  assert.equal(parseLiveArgs(liveArgs()).partition, "dev");
  // The campaign profile refuses it at the CLI.
  const child = Bun.spawnSync(["bun", "scripts/memory-bench/campaign.mjs", "--plan", "209", "--manifest", "--partition", "heldout-a"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  assert.equal(child.exitCode, 1);
  assert.match(child.stderr.toString(), /Screen209Partition/);
}, 60_000);

test("revision_changes_only_tuning_tier_values", () => {
  const before = screen209TuningDefaults();
  assert.deepEqual(Object.keys(before).sort(), [...SCREEN209_TUNING_FIELDS].sort());
  assert.deepEqual(assertTuningRevision({ before, after: { ...before } }), []);
  assert.deepEqual(
    assertTuningRevision({
      before,
      after: { ...before, "exchanges.maxSteps": 16 },
      evidence: { "exchanges.maxSteps": "dev screen: step traces truncated in 0 of N exchanges" },
    }),
    [
      {
        field: "exchanges.maxSteps",
        from: before["exchanges.maxSteps"],
        to: 16,
        evidence: "dev screen: step traces truncated in 0 of N exchanges",
      },
    ],
  );
  // A contract field, an unknown field, a change without evidence, and evidence for an unchanged field are refused.
  assert.throws(
    () =>
      assertTuningRevision({
        before: { ...before, "rules.capture": "confirm" },
        after: { ...before, "rules.capture": "off" },
        evidence: { "rules.capture": "x" },
      }),
    /not a plan 209 tuning-tier value/,
  );
  assert.throws(
    () => assertTuningRevision({ before, after: { ...before, "inject.topK": 3 }, evidence: { "inject.topK": "x" } }),
    /not a plan 209 tuning-tier value/,
  );
  assert.throws(
    () => assertTuningRevision({ before, after: { ...before, "rules.maxTokens": 1500 } }),
    /without naming its development evidence/,
  );
  assert.throws(
    () => assertTuningRevision({ before, after: { ...before, "rules.maxTokens": 0 }, evidence: { "rules.maxTokens": "x" } }),
    /positive integer/,
  );
  assert.throws(
    () => assertTuningRevision({ before, after: before, evidence: { "lessons.archiveAfterSessions": "x" } }),
    /does not change/,
  );
});

test("gate_w1_binds_the_manifest_hash", async () => {
  const manifest = await buildScreen209Manifest();
  const gate = {
    plan: 209,
    gate: "W-1",
    approved: true,
    approvedBy: "owner",
    text: "approved",
    manifestHash: manifest.manifestHash,
    billing: { usdCap: 20, paidFallbacks: [] },
  };
  assert.equal(assertScreen209Gate(gate, manifest), gate);
  assert.throws(() => assertScreen209Gate({ ...gate, manifestHash: "x" }, manifest), /a changed manifest is a refusal/);
  assert.throws(() => assertScreen209Gate({ ...gate, approved: false }, manifest), /not approved/);
  assert.throws(() => assertScreen209Gate({ ...gate, gate: "O-1" }, manifest), /not plan 209 gate W-1/);
  assert.throws(() => assertScreen209Gate({ ...gate, billing: { usdCap: 0 } }, manifest), /no USD cap/);
  // Two answer models (both Command Code after amendment 7), one small; 6 arms each, plus P and P+W on three suites.
  assert.equal(new Set(SCREEN209_MODELS.map((model) => model.model)).size, 2);
  assert.equal(SCREEN209_MODELS.filter((model) => model.small).length, 1);
  assert.equal(manifest.jobs.filter((job) => job.kind === "work-outcome").length, SCREEN209_MODELS.length * WORK_OUTCOME_ARMS.length);
  assert.equal(manifest.jobs.filter((job) => job.id.includes(".noharm.")).length, 6);
  assert.equal(manifest.workOutcomeCriteriaHash.length, 64);
  // Both answer models are named paid models (amendment 7), so no job is free-only; the gate names no free answer route.
  for (const job of manifest.jobs) assert.equal(job.freeOnly, false, job.id);
});

test("no_harm_pw_arm_resolves_to_the_work_outcome_settings", () => {
  const { fabric } = memoryConfigs({ config: "fabric-x-tools", suite: "locomo", ablate: [...SCREEN209_PW_ABLATE] });
  assert.equal(fabric.preset, "conversational");
  assert.deepEqual(fabric.exchanges, { steps: true });
  assert.deepEqual(fabric.rules, { capture: "confirm" });
  assert.deepEqual(fabric.lessons, { nudge: true });
});

test("work_outcome_child_argv_and_usd", () => {
  const job = screen209Jobs().find((item) => item.id === "209-screen.work.small.P+W");
  const argv = screen209WorkArgv(job, { output: "/x.json", maxInput: 123 });
  assert.equal(argv[0], "scripts/memory-bench/work-outcome/live.mjs");
  assert.ok(!argv.includes("--free-only"), "the paid model is not free-only");
  assert.deepEqual(argv.slice(argv.indexOf("--max-input-tokens"), argv.indexOf("--max-input-tokens") + 2), ["--max-input-tokens", "123"]);
  assert.equal(
    usdOf({ inputTokens: 2_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 }, SCREEN209_MODELS[1].usdPerMillion),
    0.03 + 0.006 + 0.13,
  );
  assert.equal(usdOf({ inputTokens: 5 }, undefined), 0);
});

let offline;
beforeAll(async () => {
  offline = await runWorkOutcome({ offline: true, personaLimit: 1, concurrency: 6 });
}, 300_000);

test("screen_report_merges_per_arm_jobs_and_reports_o8", () => {
  // One offline run split into the per-arm job reports a live screen writes, for the large model only.
  const reports = new Map(
    WORK_OUTCOME_ARMS.map((arm) => [
      `209-screen.work.large.${arm}`,
      {
        status: "completed",
        inputTokens: 10,
        cacheReadTokens: 0,
        outputTokens: 1,
        usageComplete: true,
        report: {
          ...offline,
          rows: { [arm]: offline.rows[arm] },
          w5: { [arm]: offline.w5[arm] },
          safety: { [arm]: offline.safety[arm] },
          summary: { [arm]: offline.summary[arm] },
          simulatorLeak: { [arm]: offline.simulatorLeak[arm] },
          curator: offline.curator[arm] ? { [arm]: offline.curator[arm] } : {},
        },
      },
    ]),
  );
  const report = buildScreen209Report({ reports, criteriaOf: workOutcomeCriteria, manifest: null });
  const [large, small] = report.models;
  assert.deepEqual(large.armsCompleted, [...WORK_OUTCOME_ARMS]);
  assert.deepEqual(small.armsCompleted, []);
  assert.deepEqual(Object.keys(large.criteria).sort(), Object.keys(offline.criteria).sort());
  for (const [name, row] of Object.entries(offline.criteria)) assert.deepEqual(large.criteria[name], row, `${name} merges unchanged`);
  assert.deepEqual(large.o8, offline.criteria["ontology-work"]);
  assert.equal(large.w3Valid, true);
  assert.ok(large.curator["P+W+O"].calls > 0, "the ontology arm counts its curator calls");
  assert.equal(report.noHarm.status, "not-computable");
  // The large model is paid (amendment 7), so its tokens cost; the figure is small and positive.
  assert.ok(report.usd > 0);
});

test("persona_checkpoint_round_trips_by_protocol", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-209-ckpt-"));
  try {
    const a = personaCheckpoint({ job: "209-screen.work.large.P", protocol: "a".repeat(64), root });
    const b = personaCheckpoint({ job: "209-screen.work.large.P", protocol: "b".repeat(64), root });
    assert.equal(await a.load("p1|P"), undefined);
    await a.save("p1|P", { rows: [1] });
    assert.deepEqual(await a.load("p1|P"), { rows: [1] });
    assert.equal(await b.load("p1|P"), undefined, "a changed protocol never resumes");
    assert.ok((await readFile(join(a.dir, (await Bun.$`ls ${a.dir}`.text()).trim()), "utf8")).includes("rows"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("simulator_retries_empty_completions_only", async () => {
  const { retryEmptyCompletions } = await import("./run.mjs");
  let calls = 0;
  const flaky = {
    id: "flaky",
    async *generate() {
      calls += 1;
      if (calls < 3) yield { type: "content_delta", content: { type: "text", text: "  " } };
      else yield { type: "content_delta", content: { type: "text", text: "hello" } };
      yield { type: "done", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  };
  const stats = { retries: 0 };
  const [wrapped] = retryEmptyCompletions([flaky], { stats });
  assert.equal(wrapped.id, "flaky");
  const out = [];
  for await (const chunk of wrapped.generate({})) out.push(chunk);
  assert.equal(calls, 3);
  assert.equal(stats.retries, 2);
  assert.equal(out[0].content.text, "hello");
  // A bounded retry: an always-empty route gives up after `attempts` and passes the empty completion on.
  calls = -10;
  const out2 = [];
  for await (const chunk of retryEmptyCompletions([flaky], { attempts: 2 })[0].generate({})) out2.push(chunk);
  assert.equal(out2[0].content.text, "  ");
});

test("action_tool_records_test_commands_only", async () => {
  const { isTestCommand } = await import("./run.mjs");
  const { familyVocabulary } = await import("./personas.mjs");
  const v = familyVocabulary("coding");
  assert.equal(isTestCommand(v.action.wrong, v), true);
  for (const choice of v.action.choices) assert.equal(isTestCommand(choice, v), true);
  assert.equal(isTestCommand("pnpm test", v), true);
  for (const explore of ["ls -la", "cat package.json", "find . -name '*.ts'", "echo hello"]) assert.equal(isTestCommand(explore, v), false);
});

test("work_job_names_the_paid_simulator_and_paid_answers", () => {
  const large = screen209Jobs().find((item) => item.id === "209-screen.work.large.P");
  const argv = screen209WorkArgv(large, { output: "/x.json", maxInput: 1 });
  assert.ok(argv.includes("--simulator-paid"), "the gate names Qwen Flash as the paid simulator");
  assert.ok(!argv.includes("--free-only"), "the large answer model is a named paid model (amendment 7)");
  assert.equal(large.simulator, "commandcode/Qwen/Qwen3.7-Flash");
  assert.ok(!screen209WorkArgv({ ...large, simulatorPaid: false }, { output: "/x.json", maxInput: 1 }).includes("--simulator-paid"));
  assert.equal(parseLiveArgs([...liveArgs(), "--simulator-paid"]).simulatorPaid, true);
});
