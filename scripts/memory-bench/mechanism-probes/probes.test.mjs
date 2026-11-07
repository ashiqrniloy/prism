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
