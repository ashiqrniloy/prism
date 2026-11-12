/** Plan 210 Task 2: the probe harness classifies seeded mechanisms correctly, deterministically and without text. */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { armDigest, digest, fabricAgent, packages, probeRow, verdict, withProbeEnv, withTempRoot } from "./harness.mjs";
import { coverageProblems } from "./report.mjs";
import { GROUPS, ledgerRows, loadProbes, runProbes } from "./run.mjs";

const ROOT = join(import.meta.dir, "../../..");

/** A host package whose hook acts only on a trigger word; `counter.n` counts its actions. */
async function seededMechanism({ trigger, mutate }) {
  const { prism } = await packages();
  const counter = { n: 0 };
  const pkg = prism.definePackage({
    name: "@probe/seeded",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      api.hooks.on("context.build", (draft) => {
        const last = draft.messages?.at(-1);
        const text = JSON.stringify(last?.content ?? "");
        if (trigger !== undefined && !text.includes(trigger)) return draft;
        counter.n++;
        return mutate
          ? { ...draft, messages: [...draft.messages, { role: "user", content: [{ type: "text", text: "seeded note" }] }] }
          : draft;
      });
    },
  })();
  return { pkg, counter };
}

async function seededProbe(options) {
  return withProbeEnv(() =>
    withTempRoot(async (root) => {
      const on = await seededMechanism(options);
      // The seeded package is installed in the on arm only; everything else is identical.
      const arms = {};
      for (const [name, pkg] of [
        ["on", on.pkg],
        ["off", undefined],
      ]) {
        const h = await fabricAgent(join(root, `seeded-${name}`), { config: { rules: false }, extraPackages: pkg ? [pkg] : [] });
        try {
          await h.run("probe", "a turn without the trigger");
          arms[name] = armDigest(h);
        } finally {
          await h.close();
        }
      }
      return probeRow("seeded", {
        property: "seeded mechanism",
        fires: on.counter.n,
        reaches: arms.on !== arms.off,
        correct: true,
        on: arms.on,
        off: arms.off,
      });
    }),
  );
}

test("probe_detects_a_seeded_never_firing_mechanism", async () => {
  // The hook waits for a word the scenario never sends: it never runs.
  const row = await seededProbe({ trigger: "xyzzy-never-sent", mutate: true });
  assert.equal(row.fires, 0);
  assert.equal(row.verdict, "never-fires");
  assert.equal(
    verdict({ fires: false, reaches: true, correct: true }),
    "never-fires",
    "a mechanism that never ran cannot be credited with a difference",
  );
});

test("probe_detects_a_seeded_no_effect_mechanism", async () => {
  // The hook runs on every build but returns the draft unchanged: the request bytes are identical.
  const row = await seededProbe({ mutate: false });
  assert.ok(row.fires > 0, "the mechanism ran");
  assert.equal(row.reaches, false, "the agent received byte-identical requests");
  assert.equal(row.verdict, "no-effect");
  // The same harness, with a mutating hook, sees the difference.
  const reached = await seededProbe({ mutate: true });
  assert.equal(reached.verdict, "works");
});

test("probes_deterministic_and_text_free", async () => {
  const ids = [
    "lifecycle.verification",
    "retrieval.strength-priors",
    "delivery.passive-tail",
    "recall.expansion",
    "om.observer",
    "ontology.trigger.co-read",
  ];
  const probes = (await loadProbes()).filter((probe) => ids.includes(probe.id));
  assert.equal(probes.length, ids.length);
  const strip = (rows) => rows.map(({ ms: _ms, ...row }) => row);
  const first = strip((await runProbes(probes)).rows);
  const second = strip((await runProbes(probes)).rows);
  assert.deepEqual(first, second, "two runs give the same rows, hashes included");
  const text = JSON.stringify(first);
  for (const fixture of ["frankfurt", "orchard", "lisbon", "standup", "my mom visits", "Ada"])
    assert.ok(!text.includes(fixture), `no fixture text: ${fixture}`);
  assert.ok(!/\b[0-9a-f]{12}\b/.test(text.replace(/"[a-zA-Z]*Sha256":"[0-9a-f]{64}"/g, "")), "no note id leaves a probe");
  assert.equal(digest({ a: "x 0123456789ab" }), digest({ a: "x ba9876543210" }), "run-local ids are canonicalised before hashing");
});

test("every_ledger_candidate_has_exactly_one_probe", async () => {
  const probes = await loadProbes(GROUPS);
  const { candidates, known } = await ledgerRows();
  assert.deepEqual(coverageProblems(probes, candidates, known), []);
  assert.deepEqual(coverageProblems([...probes, probes[0]], candidates, known), [`probe reported twice: ${probes[0].id}`]);
  assert.deepEqual(coverageProblems(probes.slice(1), candidates, known).length, candidates.includes(probes[0].id) ? 1 : 0);
  // A Task 3.1 variant probe hangs off a known row; one on an unknown row is a problem.
  assert.deepEqual(coverageProblems([...probes, { id: "delivery.directory#x" }], candidates, known), []);
  assert.deepEqual(coverageProblems([...probes, { id: "no.such#x" }], candidates, known), [
    "probe for a row the ledger does not have: no.such#x",
  ]);
});

test("committed_mechanisms_evidence_has_no_problems_and_covers_the_candidates", async () => {
  const path = join(ROOT, "docs/_evidence/memory-bench/210/mechanisms.json");
  assert.ok(existsSync(path), "run.mjs --out writes the evidence");
  const report = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(report.problems, []);
  const { candidates } = await ledgerRows();
  for (const id of candidates)
    assert.ok(
      report.probes.some((row) => row.id === id),
      `probed: ${id}`,
    );
  for (const row of report.probes) assert.ok(["works", "never-fires", "no-effect", "wrong-effect"].includes(row.verdict));
  assert.ok(report.durationSeconds <= 1800, "offline probes finish in 30 minutes");
});

/** Plan 217 Task 5: the long-session fixture and the STM probes. */
const STM_PROBE_IDS = [
  "stm.outcome",
  "stm.recall-verbatim",
  "stm.scope-blind",
  "stm.habituation",
  "stm.boundaries",
  "stm.oversized-tail",
  "stm.referrer-delete",
  "stm.cost",
];

test("long_session_fixture_is_hashed_and_has_its_shape", async () => {
  const { loadLongSessionFixture, longSessionHashes } = await import("../long-session.mjs");
  const fixture = loadLongSessionFixture();
  assert.deepEqual(fixture.hashes, longSessionHashes(), "index.json pins both files");
  assert.ok(fixture.tasks.length >= 6, "at least 6 tasks");
  assert.ok(fixture.messageEntries >= 200, "at least 200 entries");
  const kinds = new Set(fixture.events.map((event) => event.kind));
  for (const kind of ["request", "statement", "action", "result", "change", "decision", "error", "outcome"])
    assert.ok(kinds.has(kind), kind);
  assert.ok(
    fixture.plan.split("\n").filter((line) => /Depends on/.test(line)).length >= 2,
    "a plan whose later steps depend on earlier ones",
  );
  assert.ok(fixture.related.length >= 2, "related task pairs");
  assert.ok(fixture.calls.get("c209").output.length > 16_384, "a large tool result");
  assert.ok(
    fixture.events.some((event) => event.kind === "statement" && /preference/.test(event.description)),
    "a preference stated once",
  );
  assert.equal(fixture.expected.superseded.length, 1, "a superseded fact");
  assert.ok(
    fixture.expected.habituated.some((item) => item.kind === "result" && item.count >= 3),
    "repeated benign polling",
  );
  assert.ok(
    fixture.expected.habituated.some((item) => item.kind === "error" && item.count >= 3),
    "a repeated identical failure",
  );
  assert.ok(
    fixture.turns.some((turn) => turn.gapMinutes >= 10),
    "an idle gap",
  );
  for (const task of fixture.tasks)
    assert.ok(
      fixture.events.some((event) => event.id === task.outcome && event.kind === "outcome"),
      task.id,
    );
  // Plan 218 Task 5: the WM segments.
  const byId = new Map(fixture.events.map((event) => [event.id, event]));
  const { expected } = fixture;
  assert.ok(fixture.replan.includes(`${expected.replan.step}. `), "the re-plan adds a step");
  assert.ok(!fixture.plan.includes(`\n${expected.replan.step}. `), "the added step is not in the first plan");
  assert.ok(
    fixture.turns.some((turn) => turn.id === expected.scope.replanAt && turn.user.includes(fixture.replan)),
    "a mid-episode re-plan turn",
  );
  assert.ok(byId.get(expected.replan.restored).chunks.length === 0, "the restored record has no chunks (its description is the evidence)");
  assert.ok(byId.get(expected.replan.chunkDropped).chunks.length === 1, "the chunk-dropped record had a chunk");
  for (const row of expected.laterSteps)
    assert.ok(
      fixture.plan.split("\n").some((line) => line.startsWith(`${row.step}. `)),
      `step ${row.step} is planned`,
    );
  assert.deepEqual(Object.keys(expected.protected).sort(), ["fact", "open_question", "task_state", "unresolved_error"]);
  assert.equal(byId.get(expected.protected.unresolved_error).kind, "error");
  assert.ok(byId.get(expected.protected.open_question).description.includes("?"));
  assert.ok(
    fixture.taskStates.some((state) => state.openQuestions?.length),
    "a task state with an open question",
  );
  assert.ok(expected.tightTarget.targetRatio < 0.2 && /correction/i.test(byId.get(expected.tightTarget.correction).description));
  const proposal = byId.get(expected.attribution.proposal);
  const figure = byId.get(expected.attribution.userFigure);
  assert.ok(
    proposal.sources.every((source) => source.endsWith(":reply")),
    "the proposal cites only the assistant",
  );
  assert.ok(
    figure.sources.every((source) => source.endsWith(":user")),
    "the real figure cites only the user",
  );
  assert.ok(/\d/.test(proposal.description) && /\d/.test(figure.description), "both carry numbers");
  const update = byId.get(expected.knowledgeUpdate.event);
  assert.ok(update.description.includes(expected.knowledgeUpdate.old) && update.description.includes(expected.knowledgeUpdate.new));
});

test("stm_long_session_probe_covers_probes_1_to_7", async () => {
  const probes = (await loadProbes(["stm"])).filter((probe) => STM_PROBE_IDS.includes(probe.id));
  assert.deepEqual(
    probes.map((probe) => probe.id),
    STM_PROBE_IDS,
  );
  const started = performance.now();
  const { rows, errors } = await runProbes(probes);
  assert.deepEqual(errors, []);
  for (const row of rows) assert.equal(row.verdict, "works", `${row.id}: ${JSON.stringify(row.counts)}`);
  assert.ok(performance.now() - started < 600_000, "the STM probes run in under 10 minutes");
  // The rows carry counts, hashes and verdicts only: no fixture text, no secret.
  const { loadLongSessionFixture } = await import("../long-session.mjs");
  const fixture = loadLongSessionFixture();
  const text = JSON.stringify(rows);
  for (const fragment of ["parseLedgerRow", "ledgerkit", "config/server.json", fixture.secret])
    assert.ok(!text.includes(fragment), fragment);
  // The cost row compares against the pinned pre-redesign observer when its worktree is present.
  const cost = rows.find((row) => row.id === "stm.cost");
  assert.equal(typeof cost.counts.stm.outputPer10k, "number");
  assert.ok(cost.counts.stm.chunkShareOfCovered < 0.25);
}, 600_000);

/** Plan 218 Task 5: the WM probes (1-8 of the plan, plus attribution and the knowledge update). */
const WM_PROBE_IDS = [
  "wm.scope-blind-stm",
  "wm.later-steps",
  "wm.protected",
  "wm.target-ratio",
  "wm.prefix-stable",
  "wm.rejudge",
  "wm.incremental",
  "wm.referrer-delete",
  "wm.attribution",
  "wm.knowledge-update",
];

test("wm_probe_covers_probes_1_to_8", async () => {
  const probes = await loadProbes(["wm"]);
  assert.deepEqual(
    probes.map((probe) => probe.id),
    WM_PROBE_IDS,
  );
  const started = performance.now();
  const { rows, errors } = await runProbes(probes);
  assert.deepEqual(errors, []);
  for (const row of rows) assert.equal(row.verdict, "works", `${row.id}: ${JSON.stringify(row.counts)}`);
  assert.ok(performance.now() - started < 600_000, "the WM probes run in under 10 minutes");
  const counts = Object.fromEntries(rows.map((row) => [row.id, row.counts]));
  assert.equal(counts["wm.protected"].lost, 0, "M2: protected-item loss is 0");
  assert.equal(counts["wm.protected"].expectedClasses, 4);
  assert.ok(counts["wm.target-ratio"].medianRatio <= counts["wm.target-ratio"].target + 0.1, "M3");
  assert.equal(counts["wm.prefix-stable"].breaksWithoutCompaction, 0, "M4");
  assert.equal(counts["wm.incremental"].unnamedSupersedes, 0);
  const { loadLongSessionFixture } = await import("../long-session.mjs");
  const fixture = loadLongSessionFixture();
  const text = JSON.stringify(rows);
  for (const fragment of ["parseLedgerRow", "ledgerkit", "config/server.json", "EPISODE-SCOPE", fixture.secret])
    assert.ok(!text.includes(fragment), fragment);
}, 600_000);

test("wm_prompt_parser_reads_what_the_package_renders", async () => {
  const { parseWmPrompt, remainingSteps } = await import("./wm.mjs");
  const prompt = [
    "<episode_scope>",
    "# Plan",
    "1-7. Done: earlier steps.",
    "8. Add a line.",
    "9. Run the check.",
    "</episode_scope>",
    '## Current task\n{"goal":"re-plan, step 8: a line"}',
    "## Working memory items",
    "- [aaaaaaaaaaaa] event (high) cites bbbbbbbbbbbb: kept",
    "## Target\nThese records hold 90 tokens; aim for items totalling at most 18 tokens (ratio 0.2).",
    "## Keep first (salience order: correction, denial, error, failed_verification)\ncccccccccccc",
    "## New STM records (2; give each at most one verdict)",
    "- [cccccccccccc] 2026-01-01T00:00:00.000Z statement (high) salient: correction: User correction: no",
    "- [dddddddddddd] 2026-01-01T00:00:00.000Z assistant proposal (medium) protected: task_state: Proposed 25 minutes",
  ].join("\n");
  const parsed = parseWmPrompt(prompt);
  assert.equal(parsed.target, 18);
  assert.deepEqual(parsed.keepFirst, ["cccccccccccc"]);
  assert.deepEqual(
    parsed.records.map((record) => [record.id, record.label, record.salient, record.protection]),
    [
      ["cccccccccccc", "statement", ["correction"], null],
      ["dddddddddddd", "assistant proposal", [], "task_state"],
    ],
  );
  assert.equal(parsed.items[0].cites[0], "bbbbbbbbbbbb");
  assert.deepEqual([...remainingSteps(parsed.scope, parsed.taskGoal)], [8, 9]);
  assert.deepEqual([...remainingSteps(parsed.scope, "step 9")], [9]);
});

test("fixture_seeded_secret_redacted_in_chunks", async () => {
  const { replayLongSession } = await import("./stm.mjs");
  const memory = await import("@arnilo/prism-memory-system");
  await withProbeEnv(async () => {
    const store = await memory.createSqliteChunkStore({ path: ":memory:" });
    const h = await replayLongSession({ chunkStore: store, turns: ["t0", "t3"] });
    try {
      const record = await h.recordOf(h.fx.expected.secretEvent);
      assert.equal(record?.chunkRefs?.length, 1, "the .env.local result keeps its chunk");
      const chunk = await store.get(record.chunkRefs[0].id, h.session.id);
      assert.ok(chunk.text.startsWith("LEDGER_API_KEY="), "the chunk is the cited line");
      assert.ok(!chunk.text.includes(h.fx.secret), "the seeded secret is redacted before the chunk is written");
      const afterSecret = h.stmRequests().filter((request) => request.text.includes("LEDGER_API_KEY"));
      assert.ok(afterSecret.length > 0);
      for (const request of afterSecret) assert.ok(!request.text.includes(h.fx.secret), "the STM batch is redacted too");
      assert.ok(!JSON.stringify(await h.session.entries()).includes(`"chunks":[{"sourceEntryId"`), "chunk text never lands on the branch");
    } finally {
      await h.close();
      store.close();
    }
  });
}, 120_000);
