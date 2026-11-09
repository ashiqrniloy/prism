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
