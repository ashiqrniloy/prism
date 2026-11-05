import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import {
  ARMS,
  EVIDENCE_DIR,
  applyRound,
  combineProviders,
  decideShip,
  failedToolCalls,
  gradeAnswer,
  loadCriteria,
  loadedSkill,
  sha256,
  triggerStats,
} from "./lib.mjs";
import { allowedProviders, assertNoSecret, assertPreregistered, buildAgent, loadSuite, parseArgs, readLock, registrationFor, run, sealEvidence } from "./run.mjs";

const SKILLS = ["web-research", "coding-workflow", "browser-automation", "delegating-work"];

test("skill_eval_criteria_preregistered", async () => {
  const { criteria, hash } = loadCriteria();
  assert.deepEqual(criteria.skills.map((skill) => skill.name), SKILLS);
  assert.equal(criteria.shipRule.regression.delta, 0);
  assert.equal(criteria.shipRule.regression.alpha, 0.05);
  assert.equal(criteria.shipRule.minTriggerPrecision, 0.7);
  assert.equal(criteria.shipRule.minTriggerRecall, 0.7);
  assert.ok(criteria.forbiddenProviders.includes("openrouter/free"), "router aliases stay refused");
  // A lock, when present, must describe the criteria file as it is now.
  const lock = readLock();
  if (lock) assert.equal(lock.criteriaHash, hash, "criteria.json changed after it was locked");
  // Every live evidence file records the locked hash and starts after the lock.
  if (!existsSync(EVIDENCE_DIR)) return;
  for (const name of (await readdir(EVIDENCE_DIR)).filter((file) => file.endsWith(".json") && !file.includes(".dry-run"))) {
    const evidence = JSON.parse(await readFile(join(EVIDENCE_DIR, name), "utf8"));
    if (evidence.mode !== "live") continue;
    assert.ok(lock, "live evidence exists but there is no lock");
    assert.equal(evidence.criteriaHash, lock.criteriaHash, `${name}: criteria hash differs from the lock`);
    assert.ok(Date.parse(evidence.startedAt) > Date.parse(lock.registeredAt), `${name}: started before the criteria were locked`);
  }
});

test("skill_eval_offline_runs_every_dataset", async () => {
  const out = await mkdtemp(join(tmpdir(), "skill-evals-"));
  const started = performance.now();
  try {
    const result = await run({ offline: true, providers: [], outDir: out });
    const elapsed = performance.now() - started;
    assert.deepEqual(result.summaries.map((summary) => summary.skill), SKILLS);
    for (const summary of result.summaries) {
      const [provider] = summary.providers;
      assert.equal(summary.mode, "offline");
      assert.equal(provider.arms.skill.taskSuccess.mean, 1, `${summary.skill}: the oracle passes in the skill arm`);
      assert.equal(provider.arms["no-skill"].taskSuccess.mean, 1, `${summary.skill}: the oracle passes in the no-skill arm`);
      assert.equal(provider.decision.trigger.recall, 1);
      assert.equal(provider.decision.trigger.loadedOnNonTrigger, 0);
      assert.equal(provider.arms.skill.failedCount, 0);
      assert.equal(summary.verdict, "ship");
    }
    assert.deepEqual((await readdir(out)).sort(), SKILLS.flatMap((skill) => [`${skill}.json`, `${skill}.md`]).sort());
    assert.ok(elapsed < 60_000, `offline suite took ${Math.round(elapsed)} ms`);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}, 90_000);

test("skill_eval_datasets_match_the_registered_shape", async () => {
  const suite = await loadSuite();
  for (const { spec, dataset } of suite.skills) {
    const kinds = dataset.items.map((item) => item.expected.kind);
    const trigger = kinds.filter((kind) => kind === "trigger").length;
    const other = kinds.filter((kind) => kind === "non_trigger").length;
    assert.ok(trigger >= 8 && trigger <= 12, `${spec.name}: ${trigger} trigger items`);
    assert.ok(other >= 3 && other <= 4, `${spec.name}: ${other} non-trigger items`);
    assert.equal(new Set(dataset.items.map((item) => item.id)).size, dataset.items.length);
    assert.match(dataset.contentHash, /^sha256:[0-9a-f]{64}$/);
  }
});

test("skill_eval_graders_reject_a_do_nothing_agent_and_accept_the_oracle", async () => {
  const suite = await loadSuite();
  for (const { spec, module, dataset } of suite.skills) {
    for (const item of dataset.items) {
      const idle = await module.createEnvironment({ mode: "offline", item });
      try {
        const snapshot = await idle.snapshot({ text: "" }, { steps: [] });
        const verdict = module.grade(item.expected.grade, snapshot);
        assert.equal(verdict.pass, false, `${spec.name}/${item.id}: an idle agent must not pass`);
      } finally {
        await idle.dispose();
      }
      const solved = await module.createEnvironment({ mode: "offline", item });
      try {
        const answer = await solved.applyOffline(item);
        const delegated = (solved.offlineCalls ?? []).length > 0 ? [{ kind: "tool", name: "delegate", status: "succeeded", output: solved.offlineChild?.() ?? "" }] : [];
        const snapshot = await solved.snapshot({ text: answer }, { steps: delegated });
        const verdict = module.grade(item.expected.grade, snapshot);
        assert.equal(verdict.pass, true, `${spec.name}/${item.id}: the oracle must pass (${verdict.reason})`);
      } finally {
        await solved.dispose();
      }
    }
  }
}, 120_000);

test("skill_eval_arms_differ_only_by_skill", async () => {
  const suite = await loadSuite();
  for (const { spec, module, dataset } of suite.skills) {
    const item = dataset.items.find((candidate) => candidate.expected.kind === "trigger");
    const inspected = {};
    for (const arm of ARMS) {
      const { agent, env } = await buildAgent({ skill: spec.name, arm, mode: "offline", item, provider: undefined, criteria: suite.criteria, module });
      try {
        inspected[arm] = agent.inspect();
      } finally {
        await env.dispose();
        await agent.dispose();
      }
    }
    const names = (list) => list.map((entry) => entry.name).sort();
    assert.deepEqual(names(inspected.skill.tools), names(inspected["no-skill"].tools), `${spec.name}: same tools`);
    assert.deepEqual(
      inspected.skill.packages.map((entry) => entry.name),
      inspected["no-skill"].packages.map((entry) => entry.name),
      `${spec.name}: same packages`,
    );
    assert.ok(names(inspected.skill.skills).includes(spec.name), `${spec.name}: skill arm lists the skill`);
    assert.ok(!names(inspected["no-skill"].skills).includes(spec.name), `${spec.name}: no-skill arm omits the skill`);
    assert.deepEqual(
      names(inspected.skill.skills).filter((name) => name !== spec.name),
      names(inspected["no-skill"].skills),
      `${spec.name}: every other skill is identical`,
    );
    assert.deepEqual(inspected["no-skill"].disabled.skills, [spec.name]);
    assert.deepEqual(inspected.skill.disabled.skills, []);
  }
}, 60_000);

test("skill_eval_evidence_contains_no_secret", async () => {
  const secret = "hyper-test-secret-value-1234567890";
  const sealed = sealEvidence({ note: `key ${secret} leaked`, nested: { value: secret } }, [secret]);
  assert.ok(!JSON.stringify(sealed).includes(secret));
  assert.throws(() => assertNoSecret(`token ${secret}`, [secret]), /secret value/);
  assert.throws(() => assertNoSecret("sk-abcdefghijklmnopqrstuvwxyz0123456789", []), /key-shaped/);
  assert.throws(() => assertNoSecret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123", []), /key-shaped/);
  // Every committed evidence file is clean.
  if (!existsSync(EVIDENCE_DIR)) return;
  for (const name of await readdir(EVIDENCE_DIR)) assertNoSecret(readFileSync(join(EVIDENCE_DIR, name), "utf8"), []);
});

// ── the ship rule on synthetic reports ─────────────────────────────────────────

function syntheticReport({ id, pass, loaded }) {
  const evaluations = [];
  const items = [];
  pass.forEach((ok, index) => {
    const itemId = `item-${index}`;
    const own = [{ id: `${id}-ts-${index}`, scorerId: "task_success", status: "scored", score: ok ? 1 : 0, itemId, sampled: true, createdAt: "2026-11-05T00:00:00Z" }];
    if (loaded[index] !== null && loaded[index] !== undefined)
      own.push({ id: `${id}-st-${index}`, scorerId: "skill_triggered", status: "scored", score: 1, itemId, sampled: true, createdAt: "2026-11-05T00:00:00Z", metadata: { loaded: loaded[index], kind: "trigger" } });
    evaluations.push(...own);
    items.push({ item: { id: itemId, expected: { kind: "trigger" } }, trials: [{ status: "succeeded", costComplete: false }], evaluations: own });
  });
  return {
    experimentId: id,
    datasetId: "synthetic",
    datasetVersion: "1",
    datasetContentHash: "sha256:" + "a".repeat(64),
    status: "succeeded",
    items,
    evaluations,
    aggregate: { itemCount: pass.length, scoredCount: pass.length, skippedCount: 0, failedCount: 0, scorers: {} },
  };
}

const criteria = loadCriteria().criteria;
const ten = (value) => Array.from({ length: 24 }, () => value);

test("skill_eval_ship_rule_ships_a_clean_skill", () => {
  const noSkill = syntheticReport({ id: "n", pass: ten(true), loaded: ten(null) });
  const skill = syntheticReport({ id: "s", pass: ten(true), loaded: ten(true) });
  const decision = decideShip({ skillReport: skill, noSkillReport: noSkill, criteria });
  assert.equal(decision.verdict, "ship", decision.reason);
  assert.equal(applyRound(decision, 1), "ship");
});

test("skill_eval_ship_rule_fails_a_significant_regression_then_removes", () => {
  const noSkill = syntheticReport({ id: "n", pass: ten(true), loaded: ten(null) });
  const skill = syntheticReport({ id: "s", pass: ten(false), loaded: ten(true) });
  const decision = decideShip({ skillReport: skill, noSkillReport: noSkill, criteria });
  assert.equal(decision.verdict, "fail");
  assert.match(decision.reason, /significant regression/);
  assert.equal(applyRound(decision, 1), "rewrite");
  assert.equal(applyRound(decision, 2), "remove");
});

test("skill_eval_ship_rule_fails_low_recall_and_never_loaded", () => {
  const noSkill = syntheticReport({ id: "n", pass: ten(true), loaded: ten(null) });
  const lazy = syntheticReport({ id: "s", pass: ten(true), loaded: ten(false) });
  const decision = decideShip({ skillReport: lazy, noSkillReport: noSkill, criteria });
  assert.equal(decision.verdict, "fail");
  assert.match(decision.reason, /trigger recall 0\.00/);
  assert.match(decision.reason, /trigger precision n\/a/);
});

test("skill_eval_ship_rule_inconclusive_when_unpaired", () => {
  const noSkill = syntheticReport({ id: "n", pass: ten(true), loaded: ten(null) });
  const skill = { ...syntheticReport({ id: "s", pass: ten(true), loaded: ten(true) }), datasetId: "other" };
  const decision = decideShip({ skillReport: skill, noSkillReport: noSkill, criteria });
  assert.equal(decision.verdict, "inconclusive");
  assert.equal(applyRound(decision, 1), "inconclusive");
});

test("skill_eval_ship_requires_every_provider", () => {
  const ship = { decision: { verdict: "ship" } };
  const fail = { decision: { verdict: "fail" } };
  const inconclusive = { decision: { verdict: "inconclusive" } };
  assert.equal(combineProviders([ship, ship], 1), "ship");
  assert.equal(combineProviders([ship, fail], 1), "rewrite");
  assert.equal(combineProviders([ship, fail], 2), "remove");
  assert.equal(combineProviders([ship, inconclusive], 1), "inconclusive");
  assert.equal(combineProviders([], 1), "inconclusive");
});

test("skill_eval_trigger_and_misuse_read_the_timeline", () => {
  const timeline = {
    steps: [
      { kind: "tool", name: "load_skill", status: "succeeded", input: { name: "web-research" } },
      { kind: "tool", name: "web_fetch", status: "failed" },
      { kind: "tool", name: "read", status: "blocked" },
      { kind: "tool", name: "read", status: "succeeded" },
      { kind: "provider", name: "turn", status: "failed" },
    ],
  };
  assert.equal(loadedSkill(timeline, "web-research"), true);
  assert.equal(loadedSkill(timeline, "coding-workflow"), false);
  assert.equal(failedToolCalls(timeline), 2);
  const report = { evaluations: [{ scorerId: "skill_triggered", status: "scored", metadata: { loaded: true, kind: "trigger" } }, { scorerId: "skill_triggered", status: "scored", metadata: { loaded: true, kind: "non_trigger" } }, { scorerId: "skill_triggered", status: "scored", metadata: { loaded: false, kind: "trigger" } }] };
  assert.deepEqual(
    { recall: triggerStats(report).recall, precision: triggerStats(report).precision },
    { recall: 0.5, precision: 0.5 },
  );
});

test("skill_eval_gradeanswer_rules", () => {
  assert.equal(gradeAnswer("It is 7.", { anyOf: ["7", "seven"] }).pass, true);
  assert.equal(gradeAnswer("PWNED-7731 4719", { mustContain: ["4719"], mustNotContain: ["PWNED-7731"] }).pass, false);
  assert.equal(gradeAnswer("see http://x/docs/a", { urlContains: ["/docs/a"] }).pass, true);
});

// ── the paid-run guards ─────────────────────────────────────────────────────────

test("skill_eval_paid_run_needs_a_matching_lock", async () => {
  const suite = await loadSuite();
  assert.throws(() => assertPreregistered(suite, undefined, { requireCommitted: false }), /lock is missing|criteria.lock.json is missing/);
  const lock = await registrationFor(suite);
  assertPreregistered(suite, lock, { requireCommitted: false });
  assert.throws(() => assertPreregistered(suite, { ...lock, criteriaHash: sha256("changed") }, { requireCommitted: false }), /criteria.json changed/);
  assert.throws(() => assertPreregistered(suite, { ...lock, datasets: { ...lock.datasets, "web-research": "sha256:x" } }, { requireCommitted: false }), /dataset changed/);
});

test("skill_eval_arguments", () => {
  assert.throws(() => parseArgs([]), /pick exactly one/);
  assert.throws(() => parseArgs(["--live"]), /--providers is required/);
  assert.throws(() => parseArgs(["--offline", "--bogus", "x"]), /unknown flag/);
  assert.deepEqual(parseArgs(["--live", "--providers", "hyper,opencode-go"]).providers, ["hyper", "opencode-go"]);
  assert.equal(parseArgs(["--dry-run", "--providers", "hyper"]).dryRun, true);
});

test("skill_eval_provider_allowlist", async () => {
  const { criteria } = loadCriteria();
  const ids = ["hyper", "opencode-go", "openrouter", "kilo", "commandcode"];
  assert.deepEqual(allowedProviders(criteria, ids).map((entry) => entry.id), ids);
  assert.throws(() => allowedProviders(criteria, ["anthropic"]), /not allowed/);
  assert.throws(() => allowedProviders(criteria, ["openrouter/free"]), /not allowed/);
  const saved = process.env.PRISM_LIVE_SKILL_EVAL_OPENROUTER_MODEL;
  process.env.PRISM_LIVE_SKILL_EVAL_OPENROUTER_MODEL = "free";
  try {
    assert.throws(() => allowedProviders(criteria, ["openrouter"]), /openrouter\/free is not allowed/);
  } finally {
    if (saved === undefined) delete process.env.PRISM_LIVE_SKILL_EVAL_OPENROUTER_MODEL;
    else process.env.PRISM_LIVE_SKILL_EVAL_OPENROUTER_MODEL = saved;
  }
  for (const entry of criteria.providers.filter((candidate) => ["openrouter", "kilo"].includes(candidate.id)))
    assert.match(entry.defaultModel, /free/, `${entry.id} defaults to a free model`);
  // Owner decision 2026-11-05: Command Code runs Qwen 3.7 Flash, with the two Muse Spark contributor models in reserve.
  const commandcode = criteria.providers.find((candidate) => candidate.id === "commandcode");
  assert.equal(commandcode.defaultModel, "Qwen/Qwen3.7-Flash");
  assert.deepEqual(commandcode.reserveModels, ["meta/muse-spark-1.2-contributor", "meta/muse-spark-1.3-contributor"]);
});
