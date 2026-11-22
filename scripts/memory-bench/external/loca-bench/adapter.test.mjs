/**
 * Plan 218.1 Task 4: the LOCA-Bench adapter, offline. The Prism arms run in-process against a scripted environment
 * with the sidecar's protocol (the real sidecar and LOCA's evaluator run in `pilot.mjs --offline`); the pinned-checkout
 * checks run when the checkout is present.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armMemory, longSessionWorkerMock } from "../../work-outcome/long-session.mjs";
import {
  assertLocaRowHoldsNoText,
  LOCA_PRISM_ARMS,
  locaArmMemoryOptions,
  locaInstances,
  locaReadTools,
  locaScriptedAgent,
  runLocaInstance,
} from "./adapter.mjs";
import { LOCA_BENCH_PIN, LocaBenchFetchError, locaBenchPaths, locaSeamSelfCheck, verifyLocaBenchCode } from "./fetch.mjs";
import { assertPilotGate, LOCA_PILOT_RULE, pilotRuleHash, readRows, screenEstimate, selectPilotLength, wilsonInterval } from "./pilot.mjs";

const MARKER = "TOOL_OUTPUT_MUST_NOT_REACH_EVIDENCE";

/** The sidecar's protocol over a scripted environment: `chars` of output per read, reward 1 on claim_done. */
function scriptedSeam({ chars, reward = 1 }) {
  const calls = [];
  return {
    calls,
    open: async () => ({
      ready: {
        prompt: `Arrange the exams. ${MARKER}`,
        tools: [
          {
            type: "function",
            function: { name: "canvas_list_courses", description: "List courses.", parameters: { type: "object", properties: {} } },
          },
          {
            type: "function",
            function: { name: "canvas_create_course", description: "Create.", parameters: { type: "object", properties: {} } },
          },
          {
            type: "function",
            function: { name: "claim_done_claim_done", description: "Done.", parameters: { type: "object", properties: {} } },
          },
        ],
      },
      async call(_id, name) {
        calls.push(name);
        if (name.endsWith("claim_done")) return { content: "claimed", terminated: true };
        return { content: `${MARKER} ${"x".repeat(chars)}`, terminated: false };
      },
      finish: async () => ({ op: "finished", reward, evaluation: reward >= 1 ? "passed" : "failed", claimed: true }),
      close() {},
    }),
  };
}

const runFake = (arm, { chars, steps, budget, reward } = {}) => {
  const seam = scriptedSeam({ chars, reward });
  return runLocaInstance({
    instance: { id: "CanvasArrangeExamS2LEnv/s1", task: "CanvasArrangeExamS2LEnv", seed: 42, index: 0 },
    arm,
    preset: "64k",
    budget,
    maxOutputTokens: 2_048,
    providers: [locaScriptedAgent({ steps }), longSessionWorkerMock()],
    model: { provider: "mock", model: "loca-scripted" },
    workerModel: "worker/stm",
    open: seam.open,
  }).then((row) => ({ row, calls: seam.calls }));
};

function gitRepo({ license }) {
  const dir = mkdtempSync(join(tmpdir(), "loca-pin-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "README.md"), "loca\n");
  if (license !== undefined) writeFileSync(join(dir, "LICENSE"), license);
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return { dir, commit: git("rev-parse", "HEAD") };
}

test("loca_fetch_refuses_an_unpinned_tree", () => {
  const mit = "MIT License\n\nCopyright (c) 2025 test\n";
  const good = gitRepo({ license: mit });
  const noLicense = gitRepo({});
  const apache = gitRepo({ license: "Apache License\n" });
  try {
    const pin = (commit, text = mit) => ({
      ...LOCA_BENCH_PIN,
      code: { ...LOCA_BENCH_PIN.code, commit, licenseSha256: createHash("sha256").update(text).digest("hex") },
    });
    assert.equal(verifyLocaBenchCode({ pin: pin(good.commit), dir: good.dir }).commit, good.commit);
    assert.throws(() => verifyLocaBenchCode({ pin: pin("0".repeat(40)), dir: good.dir }), /is not the pinned/);
    assert.throws(() => verifyLocaBenchCode({ pin: pin(good.commit, "MIT License\nother\n"), dir: good.dir }), /LICENSE sha256/);
    assert.throws(() => verifyLocaBenchCode({ pin: pin(noLicense.commit), dir: noLicense.dir }), /no LICENSE/);
    assert.throws(() => verifyLocaBenchCode({ pin: pin(apache.commit, "Apache License\n"), dir: apache.dir }), /not the MIT/);
    writeFileSync(join(good.dir, "README.md"), "changed\n");
    assert.throws(() => verifyLocaBenchCode({ pin: pin(good.commit), dir: good.dir }), /local changes/);
    writeFileSync(join(good.dir, "README.md"), "loca\n");
    writeFileSync(join(good.dir, ".env"), "KEY=1\n");
    assert.throws(() => verifyLocaBenchCode({ pin: pin(good.commit), dir: good.dir }), LocaBenchFetchError);
  } finally {
    for (const repo of [good, noLicense, apache]) rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("loca_arms_are_the_gate_m2_arms", async () => {
  const describe = (packages) => packages.map((pkg) => ({ name: pkg.definition?.name, config: pkg.config }));
  assert.deepEqual({ ...locaArmMemoryOptions("w/x") }, { workerModel: "w/x", defaults: true });
  for (const arm of LOCA_PRISM_ARMS) {
    const loca = describe(await armMemory(arm, locaArmMemoryOptions("w/x")));
    const gate = describe(await armMemory(arm, { workerModel: "w/x", defaults: true }));
    assert.deepEqual(loca, gate, arm);
  }
  // The comparison is sensitive: the same arm off the defaults is a different arm.
  for (const arm of ["STM-only", "WM", "llm-summary"])
    assert.notDeepEqual(
      describe(await armMemory(arm, locaArmMemoryOptions("w/x"))),
      describe(await armMemory(arm, { workerModel: "w/x", defaults: false })),
      arm,
    );
});

test("loca_offline_run_scores_every_arm", async () => {
  for (const arm of LOCA_PRISM_ARMS) {
    const { row, calls } = await runFake(arm, { chars: 400, steps: 4, budget: 32_768, reward: 1 });
    assert.equal(row.arm, arm);
    assert.equal(row.reward, 1, arm);
    assert.equal(row.evaluation, "passed", arm);
    assert.equal(row.status, "claimed", arm);
    assert.equal(calls.at(-1), "claim_done_claim_done", arm);
    // The scripted agent reads only: never a write tool, never a tool a Prism package added.
    assert.ok(!calls.includes("canvas_create_course"), arm);
  }
  assert.deepEqual(
    locaReadTools([{ function: { name: "recall", parameters: {} } }, { function: { name: "email_get_emails", parameters: {} } }]),
    ["email_get_emails"],
  );
});

test("loca_run_is_not_cut_by_the_kernel_default_fence", async () => {
  // LOCA allows 500 tool uses; the kernel's unconfigured fence (49 tool rounds, 75 provider attempts) must not end
  // a Prism arm first. 60 rounds then claim_done must claim.
  const { row, calls } = await runFake("memory-off", { chars: 40, steps: 60, budget: 65_536 });
  assert.equal(row.status, "claimed", `status ${row.status} ${row.code ?? ""}`);
  assert.equal(calls.length, 61);
});

test("loca_wm_engages_when_the_environment_exceeds_the_budget", async () => {
  const above = (await runFake("WM", { chars: 40_000, steps: 20, budget: 16_384 })).row;
  assert.ok(above.peakInputTokens > above.budget, "the environment outgrew B");
  assert.ok(above.wmPasses >= 1, `WM passes above B: ${above.wmPasses}`);
  assert.ok(above.compactions >= 1);
  const below = (await runFake("WM", { chars: 40, steps: 6, budget: 32_768 })).row;
  assert.ok(below.peakInputTokens < below.budget * 0.6);
  assert.equal(below.wmPasses, 0, "no WM pass while the environment stays below B");
  assert.equal(below.compactions, 0);
});

test("loca_evidence_holds_no_text", async () => {
  const { row } = await runFake("WM", { chars: 4_000, steps: 6, budget: 32_768 });
  assert.ok(!JSON.stringify(row).includes(MARKER));
  assert.ok(!JSON.stringify(row).includes("Arrange the exams"));
  assert.throws(() => assertLocaRowHoldsNoText({ ...row, note: "x" }), /unknown key/);
  assert.throws(() => assertLocaRowHoldsNoText({ ...row, code: `the tool said ${MARKER}` }), /holds text/);
  assert.throws(() => assertLocaRowHoldsNoText({ ...row, main: { text: "a sentence with spaces" } }), /holds text/);
  const root = mkdtempSync(join(tmpdir(), "loca-rows-"));
  try {
    mkdirSync(join(root, "rows", "64k-32768", "WM"), { recursive: true });
    writeFileSync(join(root, "rows", "64k-32768", "WM", "a.json"), JSON.stringify({ ...row, prompt: "leak" }));
    assert.throws(() => readRows(root), /unknown key/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Synthetic pilot rows: per arm, `passed` of 15 rewarded; WM engaged on `engaged` instances. */
function pilotRows({ preset, budget, react, off, wm = 8, engaged, tokens = 1_000_000 }) {
  const rows = [];
  for (const [arm, passed] of [
    ["loca-react", react],
    ["memory-off", off],
    ["WM", wm],
  ])
    for (let i = 0; i < 15; i++)
      rows.push({
        instance: `T${i}/s1`,
        preset,
        budget,
        arm,
        reward: i < passed ? 1 : 0,
        evaluation: i < passed ? "passed" : "failed",
        wmPasses: arm === "WM" && i < engaged ? 2 : 0,
        main: { inputTokens: tokens, outputTokens: 1_000 },
        worker: { inputTokens: 0, outputTokens: 0 },
        wallMs: 1_000,
      });
  return rows;
}

test("loca_pilot_selects_the_length_by_the_recorded_rule", () => {
  // The approved rule: one length, the 64k environment at B = 64K.
  const [approved] = LOCA_PILOT_RULE.lengths;
  assert.deepEqual(LOCA_PILOT_RULE.lengths, [{ preset: "64k", budget: 65_536 }]);
  let selection = selectPilotLength(pilotRows({ ...approved, react: 6, off: 5, engaged: 12 }));
  assert.equal(selection.verdict, "selected");
  assert.deepEqual(selection.selected, approved);
  assert.ok(screenEstimate(selection).inputTokens > 0);
  // WM engages on 11 of 15: no length qualifies under the approved rule → owner.
  selection = selectPilotLength(pilotRows({ ...approved, react: 6, off: 5, engaged: 11 }));
  assert.equal(selection.verdict, "owner");
  assert.equal(screenEstimate(selection), null);
  // The walk over several lengths (a rule the owner could approve later): the first that qualifies wins.
  const short = { preset: "64k", budget: 32_768 };
  const long = { preset: "128k", budget: 65_536 };
  const two = { ...LOCA_PILOT_RULE, lengths: [short, long] };
  selection = selectPilotLength(
    [...pilotRows({ ...short, react: 6, off: 5, engaged: 11 }), ...pilotRows({ ...long, react: 4, off: 4, engaged: 15 })],
    two,
  );
  assert.deepEqual(selection.selected, long);
  // memory-off at the floor (1 of 15 < 10%) and at the ceiling (13 of 15 > 85%): no length qualifies → owner.
  selection = selectPilotLength(
    [...pilotRows({ ...short, react: 1, off: 1, engaged: 15 }), ...pilotRows({ ...long, react: 13, off: 13, engaged: 15 })],
    two,
  );
  assert.equal(selection.verdict, "owner");
  assert.equal(selection.selected, null);
  // Calibration: memory-off outside loca-react's Wilson interval stops the pilot at that length.
  selection = selectPilotLength(pilotRows({ ...approved, react: 12, off: 3, engaged: 15 }));
  assert.equal(selection.verdict, "calibration-failed");
  assert.equal(selection.owner, true);
  // Too few rows: incomplete, nothing selected.
  selection = selectPilotLength(pilotRows({ ...approved, react: 6, off: 5, engaged: 12 }).slice(1));
  assert.equal(selection.verdict, "incomplete");
  const [low, high] = wilsonInterval(6, 15);
  assert.ok(low < 0.4 && high > 0.4 && low > 0.15 && high < 0.7);
});

test("loca_pilot_gate_refuses_a_changed_rule_or_no_approval", () => {
  const section = { approved: true, approvedBy: "owner", text: "approve", rule: LOCA_PILOT_RULE, ruleHash: pilotRuleHash() };
  assert.equal(assertPilotGate({ locaBenchPilot: section }).approvedBy, "owner");
  assert.throws(() => assertPilotGate({}), /no locaBenchPilot/);
  assert.throws(() => assertPilotGate({ locaBenchPilot: { ...section, approved: false } }), /not approved/);
  const changed = { ...LOCA_PILOT_RULE, ceilingInputTokens: 50_000_000 };
  assert.throws(() => assertPilotGate({ locaBenchPilot: section }, changed), /differs/);
});

const paths = locaBenchPaths();
const pinned = existsSync(join(paths.code, ".git"));

test.skipIf(!pinned)("loca_pinned_checkout_and_seam_hold", () => {
  verifyLocaBenchCode({ dir: paths.code });
  for (const preset of ["64k", "128k"]) {
    const { instances } = locaInstances(paths.code, preset);
    assert.equal(instances.filter((instance) => instance.ordinal === 1).length, 15);
    assert.equal(new Set(instances.map((instance) => instance.id)).size, 75);
  }
  if (existsSync(paths.python)) assert.equal(locaSeamSelfCheck({ paths }).ok, true);
});

test("loca_provider_faults_are_retried_not_scored", async () => {
  const { isProviderFault } = await import("./adapter.mjs");
  for (const code of ["rate_limit", "quota", "overloaded", "provider_error", "HTTP 429", "fetch failed"])
    assert.ok(isProviderFault(code), code);
  // LOCA's own 500-tool budget is an outcome of the task: it stays a row.
  for (const code of ["ERR_PRISM_RUN_LIMIT", "turn_limit", "", undefined]) assert.ok(!isProviderFault(code), String(code));
});
