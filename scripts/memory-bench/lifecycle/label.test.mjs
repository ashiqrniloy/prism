import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditReport, labelLedgers, samplePairs, validateLabel } from "./label.mjs";
import { synthLedgers } from "./synth.mjs";

const gold = { shouldPromote: true, kind: "fact", scope: "project", key: "deploy.region", ephemeral: false, derivable: false };
async function temporary(run) {
  const out = await mkdtemp(join(tmpdir(), "prism-label-"));
  try {
    await run(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
function recorded() {
  return synthLedgers({ personas: 1, projects: 1, sessions: 1 }).map((l) => ({
    ...l,
    manifest: { ...l.manifest, source: "recorded", consent: true, redactionVersion: "session+scan+identity-v1", labels: [] },
  }));
}
test("label_agreement_writes_label_and_disagreement_queues", () =>
  temporary(async (out) => {
    let calls = 0;
    const judges = ["hyper/a", "opencode-go/b"];
    const generate = async (_prompt, judge) => {
      calls++;
      return JSON.stringify({ ...gold, shouldPromote: judge === judges[0] });
    };
    const first = await labelLedgers({ ledgers: recorded(), out, judges, generate, pairCount: 0 });
    assert.ok(first.queue.length > 0);
    assert.equal(first.labels.length, 0);
    assert.equal(calls, first.queue.length * 2);
    const resolutions = first.queue.map((row) => ({ id: row.id, label: gold }));
    const second = await labelLedgers({
      ledgers: recorded(),
      out,
      judges,
      generate: () => {
        throw Error("warm cache called");
      },
      resolutions,
      pairCount: 0,
    });
    assert.equal(second.queue.length, 0);
    assert.equal(second.labels.length, first.queue.length);
    const third = await labelLedgers({ ledgers: recorded(), out, judges, pairCount: 0 });
    assert.deepEqual(second.labels, third.labels);
    assert.ok(!(await readFile(join(out, "labels.jsonl"), "utf8")).includes("Preference package.manager"));
  }));
test("audit_sample_is_seeded_and_kappa_computed", () =>
  temporary(async (out) => {
    const options = {
      ledgers: recorded(),
      out,
      judges: ["hyper/a", "opencode-go/b"],
      generate: async () => JSON.stringify(gold),
      pairCount: 0,
      seed: 19,
    };
    const first = await labelLedgers(options);
    assert.equal(first.queue.length, Math.ceil(first.labels.length * 0.1));
    assert.ok(first.queue.every((row) => row.reason === "audit"));
    const again = await labelLedgers(options);
    assert.deepEqual(first.queue, again.queue);
    const completed = await labelLedgers({
      ...options,
      resolutions: first.queue.map((row) => ({ id: row.id, label: { ...gold, shouldPromote: false } })),
    });
    assert.equal(completed.report.fields.shouldPromote.errorRate, 1);
    assert.equal(completed.report.fields.shouldPromote.kappa, 0);
    assert.equal(completed.report.fields.shouldPromote.provisional, true);
    assert.equal(completed.queue.length, 0);
  }));
test("low_kappa_field_is_marked_provisional_in_report", () => {
  const report = auditReport([{ judges: [gold, gold], human: { ...gold, scope: "user" }, reason: "audit" }]);
  assert.equal(report.fields.scope.kappa, 0);
  assert.equal(report.fields.scope.provisional, true);
  assert.equal(report.fields.kind.kappa, null); // Constant agreement cannot estimate chance-corrected agreement.
  assert.equal(auditReport([]).fields.scope.provisional, true);
});
test("synthetic_pairs_are_labelled_by_construction_across_dice_bins", () =>
  temporary(async (out) => {
    const result = await labelLedgers({ ledgers: synthLedgers(), out, offline: true });
    assert.equal(result.pairs.length, 200);
    assert.ok(result.pairs.some((p) => p.sameNote));
    assert.ok(result.pairs.some((p) => !p.sameNote));
    assert.ok(new Set(result.pairs.map((p) => p.bin)).size >= 3);
    assert.equal(result.calls, 0);
    assert.equal(result.queue.length, 0);
    assert.deepEqual(result.pairs, (await labelLedgers({ ledgers: synthLedgers(), out, offline: true })).pairs);
    assert.throws(() => samplePairs([], { count: 200 }), /pairs/i);
  }));
test("label_schema_and_trust_boundaries_fail_closed", () =>
  temporary(async (out) => {
    for (const label of [
      { ...gold, shouldPromote: "yes" },
      { ...gold, kind: "other" },
      { ...gold, scope: "path" },
      { ...gold, rawText: "secret" },
      { ...gold, key: "region\n" },
      { ...gold, duplicateOf: `${"a".repeat(64)}\n` },
    ])
      assert.throws(() => validateLabel(label), /label/i);
    await assert.rejects(labelLedgers({ ledgers: recorded(), out, offline: true }), /offline/i);
    await assert.rejects(labelLedgers({ ledgers: recorded(), out, judges: ["hyper/a", "hyper/b"] }), /provider/i);
    await assert.rejects(
      labelLedgers({ ledgers: recorded(), out, judges: ["hyper/a", "opencode-go/b"], pairCount: 0, generate: async () => "{}" }),
      /label/i,
    );
    await assert.rejects(
      labelLedgers({ ledgers: synthLedgers(), out, offline: true, resolutions: [{ id: "unknown", label: gold }] }),
      /resolution/i,
    );
  }));
test("recorded_duplicate_pairs_use_panel_and_human_resolution", () =>
  temporary(async (out) => {
    let calls = 0;
    const options = {
      ledgers: recorded(),
      out,
      judges: ["hyper/a", "opencode-go/b"],
      pairCount: 4,
      generate: async (prompt) => {
        calls++;
        return JSON.stringify(prompt.startsWith("Are these") ? { sameNote: false } : gold);
      },
    };
    const result = await labelLedgers(options);
    assert.equal(result.pairs.length, 4);
    assert.equal(calls, (result.labels.length + 4) * 2);
    const resolutions = result.queue.map((row) => ({ id: row.id, label: row.task === "pair" ? { sameNote: true } : gold }));
    const done = await labelLedgers({ ...options, resolutions });
    assert.equal(done.queue.length, 0);
    assert.equal(calls, (result.labels.length + 4) * 2);
    assert.equal(done.report.duplicateAudit.fields.sameNote.errorRate, 1);
  }));
test("label_cache_is_model_specific_and_secret_input_is_rejected", () =>
  temporary(async (out) => {
    const options = {
      ledgers: recorded(),
      out,
      judges: ["hyper/a", "opencode-go/b"],
      pairCount: 0,
      generate: async () => JSON.stringify(gold),
    };
    const first = await labelLedgers(options);
    const second = await labelLedgers({ ...options, judges: ["hyper/c", "opencode-go/b"] });
    assert.equal(second.calls, first.calls / 2);
    const ledgers = recorded();
    ledgers[0].entries.find((e) => e.message?.role === "user").message.content[0].text = `Remember ${"gh"}${"p_"}${"a".repeat(35)}`;
    await assert.rejects(labelLedgers({ ...options, ledgers }), /Secret scan/);
  }));

test("audit_kappa_matches_known_nonconstant_contingency_table", () => {
  const predictions = [true, true, false, false],
    human = [true, false, false, false];
  const rows = predictions.map((value, i) => ({
    judges: [
      { ...gold, shouldPromote: value },
      { ...gold, shouldPromote: value },
    ],
    human: { ...gold, shouldPromote: human[i] },
    reason: "audit",
  }));
  const report = auditReport(rows);
  assert.equal(report.fields.shouldPromote.kappa, 0.5);
  assert.equal(report.fields.shouldPromote.errorRate, 0.25);
  assert.equal(report.fields.shouldPromote.provisional, true);
});

test("unknown_duplicate_reference_is_rejected_before_cache_publication", () =>
  temporary(async (out) => {
    const options = { ledgers: recorded(), out, judges: ["hyper/a", "opencode-go/b"], pairCount: 0 };
    await assert.rejects(
      labelLedgers({ ...options, generate: async () => JSON.stringify({ ...gold, duplicateOf: "a".repeat(64) }) }),
      /duplicateOf/,
    );
    const done = await labelLedgers({ ...options, generate: async () => JSON.stringify(gold) });
    assert.equal(done.calls, done.labels.length * 2);
  }));
