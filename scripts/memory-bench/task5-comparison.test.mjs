import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stableHash } from "./journal.mjs";
import { BENCH_MAX_TURNS } from "./replay.mjs";
import { robustnessDraw } from "./robustness.mjs";
import {
  assertTask5CandidateClean,
  assertTask5ComparisonManifest,
  assertTask5OwnerGate,
  assertTask5RefreezeDiff,
  auditTask5Comparison,
  buildTask5ComparisonManifest,
  gitTreeFingerprint,
  TASK5_CALL_RATES,
  TASK5_CONTROL_PRODUCT_SOURCE,
  TASK5_HISTORICAL_FABRIC_HASH,
  TASK5_JUDGES,
  TASK5_PRODUCT_PATHS,
  TASK5_REVISION1_PRODUCT_HASH,
  TASK5_SUITES,
  task5ArmDiff,
  task5ControlRevision,
  task5FreezeDiff,
  task5ManifestHash,
  task5OwnerGate,
  task5PostFreezePaths,
  task5RefreezeAllowed,
  task5UncommittedPaths,
  task5UnexpectedPaths,
} from "./task5-comparison.mjs";
import {
  archiveFinishedTask5Journal,
  assertTask5FreeTier,
  assertTask5SmokeReports,
  assertTask5TraceProductNames,
  freeTierFromKeyResponse,
  readOpenRouterKeyTier,
  task5CampaignFingerprint,
} from "./task5-execute.mjs";

const manifest = await buildTask5ComparisonManifest();
const clone = () => structuredClone(manifest);
// A drifted proposal can only be meaningfully refused if its own hash is recomputed, as a forger would.
const refreeze = (value) => {
  value.manifestHash = task5ManifestHash(value);
  return value;
};
const idsHash = (ids) => stableHash([...ids].map(String).sort());

test("task5_manifest_refuses_product_or_cohort_drift", async () => {
  assert.equal(manifest.kind, "202-task5-development-comparison");
  assert.equal(manifest.executable, false);
  assert.notEqual(manifest.product.control.productHash, manifest.product.candidate.productHash);
  assert.equal(manifest.baselineReuse.reusedCells, 0);
  assert.equal(assertTask5ComparisonManifest(clone()).manifestHash, manifest.manifestHash, "the frozen proposal is accepted unchanged");

  assert.throws(() => assertTask5ComparisonManifest(clone(), { observedProductHash: "0".repeat(64) }), /candidate product drifted/);
  assert.throws(() => assertTask5ComparisonManifest(clone(), { observedControlProductHash: "1".repeat(64) }), /control product drifted/);

  const identical = clone();
  identical.product.candidate.productHash = identical.product.control.productHash;
  assert.throws(() => assertTask5ComparisonManifest(refreeze(identical)), /identical/);

  const unknownId = clone();
  unknownId.cells[0].questionIds = [unknownId.cells[0].questionIds[0].replace(/.$/, "x"), ...unknownId.cells[0].questionIds.slice(1)];
  unknownId.cells[0].idsHash = idsHash(unknownId.cells[0].questionIds);
  assert.throws(() => assertTask5ComparisonManifest(refreeze(unknownId)), /frozen development draw|frozen development cohort/);

  const driftedCohort = clone();
  const [first, ...rest] = driftedCohort.cells[0].questionIds;
  const other = robustnessDraw(driftedCohort.cells[0].suite).abilities.dev;
  const foreign = Object.values(other)
    .flat()
    .find((id) => id !== first);
  driftedCohort.cells[0].questionIds = [String(foreign), ...rest.map(String)];
  driftedCohort.cells[0].idsHash = idsHash(driftedCohort.cells[0].questionIds);
  assert.throws(() => assertTask5ComparisonManifest(refreeze(driftedCohort)), /cohort hash|frozen development draw/);

  const observed = Object.fromEntries(
    TASK5_SUITES.map((suite) => [suite, [...Object.values(robustnessDraw(suite).abilities.dev).flat()].map(String)]),
  );
  observed["beam-100k"] = [...observed["beam-100k"].slice(1), "replacement-id"];
  assert.throws(() => assertTask5ComparisonManifest(clone(), { observedCohort: observed }), /observed cohort differs/);

  // Source is the authority: the committed revision-1 tree and the current product must both reproduce.
  // A prepared control worktree is checked in preflight, not here, so the test does not need the cache.
  const audited = await auditTask5Comparison(clone(), { worktree: null });
  assert.equal(audited.controlProductHash, manifest.product.control.productHash);
  assert.equal(audited.candidateProductHash, manifest.product.candidate.productHash);
});

test("task5_control_differs_from_candidate_only_in_product_paths", async () => {
  const control = manifest.product.control.revision;
  const candidate = manifest.product.candidate.revision;
  assert.notEqual(control, candidate, "the control is an overlay commit, not the candidate");
  const moved = await task5ArmDiff(control, candidate);
  assert.ok(moved.length > 0, "the arms do differ in the product");
  assert.deepEqual(task5UnexpectedPaths(moved), [], "every committed arm difference is under the product paths");
  // A kernel or harness difference is exactly what the guard must refuse.
  assert.deepEqual(task5UnexpectedPaths(["src/provider-kit/codecs/openai-chat.ts"]), ["src/provider-kit/codecs/openai-chat.ts"]);
  assert.deepEqual(task5UnexpectedPaths(["scripts/memory-bench/replay.mjs"]), ["scripts/memory-bench/replay.mjs"]);
  assert.deepEqual(task5UnexpectedPaths(["packages/memory/fabric/src/tools.ts"]), []);
  // r2 is reproducible from the candidate plus the product source, so a hand-made ref cannot pass.
  assert.equal(await task5ControlRevision(candidate), control, "the overlay commit reproduces deterministically");
  assert.equal(manifest.product.control.sourceRevision, TASK5_CONTROL_PRODUCT_SOURCE);
});

test("task5_control_product_hash_reproduces_revision1", async () => {
  const control = manifest.product.control.revision;
  assert.equal(await gitTreeFingerprint(TASK5_PRODUCT_PATHS, control), TASK5_REVISION1_PRODUCT_HASH);
  assert.equal(manifest.product.control.productHash, TASK5_REVISION1_PRODUCT_HASH);
  assert.equal(await gitTreeFingerprint(["packages/memory/fabric/src"], TASK5_CONTROL_PRODUCT_SOURCE), TASK5_HISTORICAL_FABRIC_HASH);
  assert.equal(await gitTreeFingerprint(TASK5_PRODUCT_PATHS, TASK5_CONTROL_PRODUCT_SOURCE), TASK5_REVISION1_PRODUCT_HASH);
  assert.notEqual(manifest.product.candidate.productHash, TASK5_REVISION1_PRODUCT_HASH, "the candidate carries the treatment");
});

test("task5_refuses_uncommitted_candidate", async () => {
  assert.deepEqual(task5UncommittedPaths(" M packages/memory/fabric/src/tools.ts\n?? .cache/memory-bench/task5/journal.json\n"), [
    "packages/memory/fabric/src/tools.ts",
  ]);
  await assert.rejects(assertTask5CandidateClean({ status: " M packages/memory/fabric/src/tools.ts\n" }), /uncommitted changes/);
  await assert.rejects(assertTask5CandidateClean({ status: "?? src/provider-kit/new.ts\n" }), /uncommitted changes/);
  await assert.doesNotReject(assertTask5CandidateClean({ status: "?? .cache/memory-bench/task5/journal.json\n" }));
  // Another writer's plans and docs cannot change an arm's bytes: they are reported, not refused.
  const foreign = await assertTask5CandidateClean({ status: "?? plans/207-new-plan.md\n M docs/provider-kit.md\n M roadmap.md\n" });
  assert.deepEqual(foreign.ignored, ["plans/207-new-plan.md", "docs/provider-kit.md", "roadmap.md"]);
  // A commit after the pin may carry plans and docs, but never code.
  assert.deepEqual(task5PostFreezePaths(["plans/207-new-plan.md", "docs/provider-kit.md", "plans/README.md", "roadmap.md"]), []);
  assert.deepEqual(task5PostFreezePaths(["docs/a.md", "scripts/memory-bench/run.mjs"]), ["scripts/memory-bench/run.mjs"]);
  assert.deepEqual(task5PostFreezePaths(["packages/memory/core/src/x.ts", "docs/a.md"]), ["packages/memory/core/src/x.ts"]);
  // A dirty README inside a code root is still refused: the root is the unit, not the file type.
  await assert.rejects(assertTask5CandidateClean({ status: " M packages/memory/fabric/README.md\n" }), /uncommitted changes/);
});

test("task5_expected_calls_use_measured_rate_not_turn_cap", () => {
  const campaign = manifest.budgets.campaign;
  // The turn-cap formula prices every question at 8 turns plus 2 judges (4,200 calls for 210 ids
  // per arm); the baseline measured 3.2 solver and 2.25 judge calls per question.
  assert.notEqual(campaign.expectedPhysicalCalls, 2 * 210 * (BENCH_MAX_TURNS.standard + 2));
  assert.equal(campaign.physicalCallEstimate.questionRuns, 420);
  assert.equal(campaign.expectedPhysicalCalls, Math.round(420 * (TASK5_CALL_RATES.solver + TASK5_CALL_RATES.judge)));
  assert.ok(campaign.expectedPhysicalCalls >= 2289 && campaign.expectedPhysicalCalls <= 2700);
  assert.equal(campaign.expectedPhysicalCallsRange.low, campaign.expectedPhysicalCalls);
  assert.equal(campaign.expectedPhysicalCallsRange.high, 2625);
  assert.equal(campaign.maxPhysicalCalls, 16800, "the hard cap does not move with the estimate");
  assert.equal(campaign.physicalCallEstimate.injectionCalls, 0, "labelInjections off means no injection-label calls");
  assert.match(campaign.physicalCallEstimate.source, /preset-r1\.openrouter\.nvidia-nemotron-3\.5-lightning:free/);
  assert.equal(campaign.physicalCallEstimate.solverPerQuestionSource.calls, 127);
  assert.equal(campaign.physicalCallEstimate.judgePerQuestionSource.calls, 90);
});

test("task5_manifest_refuses_heldout", () => {
  const heldoutPartition = clone();
  heldoutPartition.cells[0].subset = "heldout-a";
  assert.throws(() => assertTask5ComparisonManifest(refreeze(heldoutPartition)), /development partition/);

  const heldoutId = clone();
  const heldout = Object.values(robustnessDraw(heldoutId.cells[0].suite).abilities["heldout-a"]).flat().map(String);
  heldoutId.cells[0].questionIds = [heldout[0], ...heldoutId.cells[0].questionIds.slice(1)];
  heldoutId.cells[0].idsHash = idsHash(heldoutId.cells[0].questionIds);
  assert.throws(() => assertTask5ComparisonManifest(refreeze(heldoutId)), /held-out question id|drifted/);

  const leakedContent = clone();
  leakedContent.cells[0].question = "What did the user say?";
  assert.throws(() => assertTask5ComparisonManifest(refreeze(leakedContent)), /content field/);

  const leakedSuite = clone();
  leakedSuite.coverage.applicableSuites = [...leakedSuite.coverage.applicableSuites, "longmemeval-s"];
  assert.throws(() => assertTask5ComparisonManifest(refreeze(leakedSuite)), /applicable suites drifted|not an applicable Task-5 suite/);

  const security = clone();
  security.security.heldoutAccess = true;
  assert.throws(() => assertTask5ComparisonManifest(refreeze(security)), /security guard/);
});

test("task5_comparison_requires_matching_budgets_and_evidence_protocol", () => {
  for (const key of ["maxInputTokens", "maxOutputTokens", "maxTurns", "concurrency"]) {
    const drifted = clone();
    const candidate = drifted.cells.find((cell) => cell.role === "candidate");
    candidate[key] += 1;
    assert.throws(() => assertTask5ComparisonManifest(refreeze(drifted)), /shared budget/);
  }
  for (const key of ["judges", "model", "provider", "judgeProtocol", "labelInjections", "config"]) {
    const drifted = clone();
    drifted.cells.find((cell) => cell.role === "candidate")[key] = key === "judges" ? TASK5_JUDGES[0] : `${drifted.cells[0][key]}-drift`;
    assert.throws(() => assertTask5ComparisonManifest(refreeze(drifted)), /differ on|frozen models and judges/);
  }

  const estimate = clone();
  estimate.cells.find((cell) => cell.role === "candidate").estimate.inputTokens += 1;
  assert.throws(() => assertTask5ComparisonManifest(refreeze(estimate)), /shared input budget/);

  const protocol = clone();
  protocol.cells[0].evidenceProtocolHash = "2".repeat(64);
  assert.throws(() => assertTask5ComparisonManifest(protocol), /evidenceProtocolHash/);

  // Rules are frozen before outcomes: editing the criteria after the freeze is refused, not re-scored.
  const postHoc = clone();
  postHoc.criteria.candidateGap.halving = "candidateGap <= 0.75 * controlGap";
  assert.throws(() => assertTask5ComparisonManifest(postHoc), /criteria changed/);

  const postHocMargin = clone();
  postHocMargin.criteria.abilityGuard.margin = 0.1;
  postHocMargin.criteriaHash = stableHash(postHocMargin.criteria);
  for (const cell of postHocMargin.cells) cell.criteriaHash = postHocMargin.criteriaHash;
  assert.throws(() => assertTask5ComparisonManifest(refreeze(postHocMargin)), /evidence protocol is not bound to the frozen criteria/);

  const analysis = clone();
  analysis.analysis.pairing = "per-session pairing";
  assert.throws(() => assertTask5ComparisonManifest(refreeze(analysis)), /analysis protocol changed/);
});

test("task5_execution_refuses_unapproved_or_changed_manifest", () => {
  const gate = task5OwnerGate(manifest, {
    text: "Complete - [ ] Task 5.3: Record the paid-development owner gate against the frozen proposal and update the plan once done. Only use free model from openrouter for paid runs",
    approvedAt: "2026-10-30",
  });
  assert.equal(assertTask5OwnerGate(gate, manifest).approved, true);
  assert.equal(gate.billing.totalUsd, 0);

  const refused = (mutate, pattern) => {
    const changed = structuredClone(gate);
    mutate(changed);
    assert.throws(() => assertTask5OwnerGate(changed, manifest), pattern);
  };
  refused((value) => (value.approved = false), /not approved/);
  refused((value) => (value.text = ""), /approval text is missing/);
  refused((value) => (value.proposal.manifestHash = "0".repeat(64)), /not bound to the frozen manifest/);
  refused((value) => (value.journal.fingerprint = "0".repeat(64)), /not bound to the campaign journal identity/);
  refused((value) => (value.billing.mode = "paid-commandcode"), /free \w+ products/);
  refused((value) => (value.billing.paidFallbacks = ["commandcode/meta/muse-spark-1.3-contributor"]), /free \w+ products/);
  refused((value) => (value.billing.totalUsd = 6.83), /paid estimate is not authorized/);
  refused((value) => (value.caps.reservedInputTokens += 1000), /reservedInputTokens differs/);
  refused((value) => (value.scope.cells -= 1), /does not cover the frozen cells/);

  // A paid or cross-gateway route cannot be gated even if the manifest and gate are internally consistent.
  const paid = clone();
  paid.models.judges = [`${paid.models.answers[0].split("/")[0]}/anthropic/claude-haiku-4.5`];
  assert.throws(() => task5OwnerGate(refreeze(paid), { text: "paid screen" }), /not a free \w+ route/);
});

test("task5_execution_fingerprint_matches_the_frozen_journal_identity", () => {
  // The campaign journal refuses a different identity; the frozen proposal and the gate must agree.
  assert.equal(task5CampaignFingerprint(manifest), manifest.stopResume.manifestFingerprint);
  const gate = task5OwnerGate(manifest, { text: "gate 5", approvedAt: "2026-10-30" });
  assert.equal(task5CampaignFingerprint(manifest), gate.journal.fingerprint);

  const changed = clone();
  changed.cells[0].maxInputTokens += 1;
  assert.notEqual(task5CampaignFingerprint(changed), manifest.stopResume.manifestFingerprint);
});

test("task5_preflight_refuses_an_account_below_the_daily_free_tier", async () => {
  // The tier is decided by the account's free-model allowance, not by USD credit.
  const paid = freeTierFromKeyResponse({ data: { is_free_tier: false, limit_remaining: 49.94, usage: 0.06 } });
  assert.deepEqual(paid, { paidTier: true, dailyFreeRequests: 1000, limitRemainingUsd: 49.94, usageUsd: 0.06 });
  const free = freeTierFromKeyResponse({ data: { is_free_tier: true } });
  assert.equal(free.dailyFreeRequests, 50);
  assert.equal(free.limitRemainingUsd, null, "absent counts stay absent, never zero");
  assert.doesNotThrow(() => assertTask5FreeTier(paid));
  assert.throws(() => assertTask5FreeTier(free), /needs 1000/);
  assert.throws(() => assertTask5FreeTier(undefined), /needs 1000/);
  // The key is used by reference and the response is reduced before it can reach evidence.
  let seen;
  const tier = await readOpenRouterKeyTier({
    apiKey: "sk-or-test",
    fetchImpl: async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return { ok: true, json: async () => ({ data: { is_free_tier: false, limit_remaining: 10 } }) };
    },
  });
  assert.equal(seen.url, "https://openrouter.ai/api/v1/key");
  assert.equal(seen.auth, "Bearer sk-or-test");
  assert.equal(tier.dailyFreeRequests, 1000);
  assert.deepEqual(Object.keys(tier).sort(), ["dailyFreeRequests", "limitRemainingUsd", "paidTier", "usageUsd"]);
  await assert.rejects(readOpenRouterKeyTier({ apiKey: "", fetchImpl: async () => ({ ok: false, status: 401 }) }), /OPENROUTER_API_KEY/);
});

test("task5_gate_diff_lists_only_pin_and_estimate_changes", () => {
  // A re-freeze may move the candidate/control/harness pins and the recomputed call estimate only.
  const archived = structuredClone(manifest);
  archived.product.candidate.revision = "0".repeat(40);
  archived.product.control.revision = "1".repeat(40);
  archived.product.harnessHash = "2".repeat(64);
  archived.cells = archived.cells.map((cell) => ({
    ...cell,
    productRevision: cell.role === "control" ? archived.product.control.revision : archived.product.candidate.revision,
    harnessHash: archived.product.harnessHash,
  }));
  archived.budgets.campaign.expectedPhysicalCalls += 10;
  const changes = assertTask5RefreezeDiff(archived, manifest);
  assert.ok(changes.length > 0, "the re-freeze did list its changes");
  for (const path of changes) assert.ok(task5RefreezeAllowed(path), `${path} is not an allowed re-freeze change`);
  assert.ok(changes.includes("product.candidate.revision"), "the candidate pin moved");
  assert.ok(changes.includes("budgets.campaign.expectedPhysicalCalls"), "the estimate moved");
  assert.ok(!changes.some((path) => /evidenceProtocol/.test(path)), "the evidence protocol stayed byte-identical");
  // The frozen semantics never move: cohort, criteria, protocol, models, judges, budgets and caps.
  for (const path of changes) {
    assert.ok(!/^(cohort|criteria|criteriaHash|models|baselineReuse)\./.test(path), `${path} must not move`);
    assert.ok(!/^budgets\.(perCell|cost)\./.test(path), `${path} must not move`);
    assert.ok(!/^budgets\.campaign\.(ceiling|maxPhysicalCalls|reservedInputTokens|wallTimeCapHours)\./.test(path), `${path} must not move`);
  }
  // A moved cohort, judge, cap or criterion is a refusal, not a silent re-freeze.
  const moved = [
    (copy) => copy.cells[0].questionIds.push("heldout-999"),
    (copy) => (copy.models.judges[0] = "openrouter/other:free"),
    (copy) => (copy.budgets.campaign.maxPhysicalCalls = 20_000),
    (copy) => (copy.criteriaHash = "deadbeef"),
    (copy) => (copy.model = "something-else"),
  ];
  for (const mutate of moved) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => assertTask5RefreezeDiff(archived, copy), /changed frozen fields/);
  }
  assert.deepEqual(task5FreezeDiff(manifest, structuredClone(manifest)), []);
});

test("task5_finished_journal_is_archived_not_resumed", async () => {
  const { mkdtemp, mkdir, readFile: read, writeFile: write } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "prism-task5-journal-"));
  const journalPath = ".cache/memory-bench/task5/journal.json";
  await mkdir(join(root, ".cache/memory-bench/task5"), { recursive: true });
  const journal = {
    campaignId: "campaign-42aa7a93ee64",
    status: "finished",
    attempts: [{ attemptId: "a@1", status: "failed", reservedInputTokens: 7_500_000, confirmedInputTokens: 0 }],
  };
  await write(join(root, journalPath), JSON.stringify(journal));
  const archived = await archiveFinishedTask5Journal({ root });
  assert.deepEqual(archived, {
    campaignId: "campaign-42aa7a93ee64",
    archived: "docs/_evidence/memory-bench/202/task5/journal-campaign-42aa7a93ee64.json",
  });
  assert.deepEqual(JSON.parse(await read(join(root, archived.archived), "utf8")), journal, "the archived bytes are the journal's");
  assert.equal(existsSync(join(root, journalPath)), false, "the finished journal is gone, so it cannot be resumed");
  // An open journal (a daily-quota halt) is left alone: that is the resume point.
  await write(join(root, journalPath), JSON.stringify({ ...journal, campaignId: "campaign-new", status: "quota-daily", attempts: [] }));
  assert.equal(await archiveFinishedTask5Journal({ root }), null);
  assert.equal(existsSync(join(root, journalPath)), true);
});

test("task5_traces_record_product_tool_names_not_wire_names", () => {
  const report = (names) => ({
    trace: {
      requests: [
        {
          messages: [
            { content: names.map((name) => ({ type: "tool_use", name, input: {} })) },
            {
              content: names.map((name) => ({
                type: "tool_result",
                name,
                result: name === "memory.recall" ? { hits: [{ id: "r1" }, { id: "r2" }] } : { notes: [{ id: "r3" }] },
              })),
            },
          ],
        },
      ],
    },
  });
  assert.deepEqual(assertTask5TraceProductNames(report(["memory.recall", "memory.read"])), ["memory.read", "memory.recall"]);
  // A wire name would make surfacing read zero with no error, so it must fail, not pass quietly.
  assert.throws(() => assertTask5TraceProductNames(report(["memory_recall", "memory.read"])), /wire tool names memory_recall/);
  assert.throws(() => assertTask5TraceProductNames(report(["memory.recall", "memory_read"])), /wire tool names memory_read/);
  assert.throws(() => assertTask5TraceProductNames(report(["memory.recall", "memory.forget"])), /unexpected tool names/);
  const good = assertTask5SmokeReports([report(["memory.recall", "memory.read"]), report(["memory.recall", "memory.read"])]);
  assert.deepEqual(good, { toolNames: ["memory.read", "memory.recall"], hits: 6, reports: 2 });
  // Real hits are the point: a smoke that returns nothing cannot prove the surfacing count.
  const empty = {
    trace: {
      requests: [
        {
          messages: [
            { content: [{ type: "tool_use", name: "memory.recall", input: {} }] },
            { content: [{ type: "tool_result", name: "memory.recall", result: { hits: [] } }] },
            { content: [{ type: "tool_use", name: "memory.read", input: {} }] },
            { content: [{ type: "tool_result", name: "memory.read", result: { notes: [] } }] },
          ],
        },
      ],
    },
  };
  assert.throws(() => assertTask5SmokeReports([empty]), /no notes were returned/);
  assert.throws(() => assertTask5SmokeReports([]), /no report/);
  // Recall is the call the route refused before Task 5.4.1: a smoke without it proves nothing.
  assert.throws(() => assertTask5SmokeReports([report(["memory.read"])]), /no memory.recall call appears/);
});
