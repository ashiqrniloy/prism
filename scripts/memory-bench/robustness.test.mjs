import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "./campaign.mjs";
import { DATASETS, loadDataset, normalizeDataset, parseJsonArrayIncremental, selectQuestions } from "./datasets.mjs";
import { extractEvidence, gradeEvidence, sessionRounds } from "./replay.mjs";
import { diagnoseRetrieval } from "./retrieval-diagnostics.mjs";
import {
  assertThreeTierCriteriaPin,
  drawRobustnessPartitions,
  ROBUSTNESS_CRITERIA,
  robustnessCriteriaHash,
  robustnessDraw,
  robustnessIdsHash,
  THREE_TIER_CRITERIA,
  threeTierCriteriaHash,
  threeTierManifestPin,
  verifyLongMemEvalMItems,
  verifyThreeTierCriteria,
} from "./robustness.mjs";
import { runBench } from "./run.mjs";

function beamRow(conversationId, sourceChatIds) {
  return {
    conversation_id: conversationId,
    chat: [
      [
        { id: 10, role: "user", content: "old value", time_anchor: "March 15, 2024" },
        { id: 11, role: "assistant", content: "acknowledged" },
        { id: 12, role: "user", content: "new value" },
      ],
    ],
    probing_questions: {
      knowledge_update: [{ question: "latest?", answer: "new value", source_chat_ids: sourceChatIds, rubric: "PRIVATE_RUBRIC" }],
    },
  };
}

test("beam_source_refs_map_lists_and_keyed_objects", () => {
  const questions = normalizeDataset([beamRow("a", [10, 12, 10]), beamRow("b", { original: [10], updated: [12] })], "beam-100k");
  for (const q of questions) {
    assert.deepEqual(q.evidence, [`${q.cluster.slice(5)}:s0:m0`, `${q.cluster.slice(5)}:s0:m2`]);
    assert.equal(q.sessions[0].messages[0].sourceId, 10);
    assert.equal(q.sourceAnnotations.rubric, "PRIVATE_RUBRIC");
    assert.ok(q.sourceAnnotations.references.every((ref) => ref.status === "resolved"));
    const rounds = q.sessions.flatMap(sessionRounds);
    const evidence = extractEvidence(q, rounds);
    assert.equal(evidence.labelSource, "source_chat_ids");
    assert.equal(evidence.messageEvidenceRounds.size, 2);
    assert.equal(gradeEvidence({ evidence, recalledIds: [...evidence.messageEvidenceRounds] }).fineEvidenceRecall, 1);
  }
  assert.deepEqual(
    questions[1].sourceAnnotations.references.map((ref) => ref.label),
    ["original", "updated"],
  );
  const plans = normalizeDataset([{ plans: [beamRow("a", [10]), beamRow("a", [12])] }], "beam-100k");
  assert.equal(plans[1].evidence[0], "a:plan1:s0:m2");
});

test("beam_unknown_refs_are_not_invented_evidence", () => {
  const row = beamRow("a", [999, 10, null]);
  row.chat[0][1].id = 10; // Two messages claim the same original id: no positional guess.
  const [q] = normalizeDataset([row], "beam-100k");
  assert.deepEqual(q.evidence, []);
  assert.deepEqual(
    q.sourceAnnotations.references.map((ref) => ref.status),
    ["unknown", "ambiguous", "unknown"],
  );
  const evidence = extractEvidence(q, q.sessions.flatMap(sessionRounds));
  assert.equal(evidence.allRoundIds.size, 0, "a literal answer match cannot replace an unresolved annotation");
  assert.equal(evidence.unknownSourceReferences.length, 3);
  assert.equal(gradeEvidence({ evidence, recalledIds: ["a:s0-r0"] }).evidenceAllRequired, null);
});

test("original_exploratory_reports_keep_their_bytes_and_protocol_provenance", async () => {
  const root = "docs/_evidence/memory-bench/202/exploratory-original-2026-10-28";
  const provenance = JSON.parse(await readFile(join(root, "provenance.json"), "utf8"));
  for (const file of provenance.files) {
    const bytes = await readFile(join(root, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  assert.equal(provenance.completedReports.length, 7);
  for (const entry of provenance.completedReports) {
    const report = JSON.parse(await readFile(join(root, entry.path), "utf8"));
    assert.equal(report.status, "completed");
    assert.equal(report.results.length, 40);
    assert.equal(entry.protocolHash, report.protocolHash);
    assert.equal(entry.runPathFingerprint, report.runPathFingerprint ?? null);
  }
});

const beamCache = join(process.env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "memory-bench");
test.skipIf(!process.env.PRISM_MEMORY_BENCH_PYTHON || !existsSync(join(beamCache, DATASETS["beam-100k"].file)))(
  "beam_development_annotation_inventory_matches_the_pinned_source",
  async () => {
    const questions = selectQuestions(
      normalizeDataset(
        await loadDataset("beam-100k", {
          cache: beamCache,
          fetch: () => {
            throw new Error("inventory must use cached bytes");
          },
        }),
        "beam-100k",
      ),
      "beam-100k",
      { subset: "dev" },
    );
    const refs = questions.flatMap((q) => q.sourceAnnotations.references);
    assert.equal(questions.length, 40);
    assert.equal(questions.filter((q) => q.ability !== "abstention").length, 36);
    assert.equal(refs.length, 120);
    assert.equal(refs.filter((ref) => ref.status === "resolved").length, 120);
    assert.equal(questions.filter((q) => q.sourceAnnotations.rubric !== null).length, 40);
    for (const q of questions) {
      const messages = new Map(q.sessions.flatMap((s) => s.messages).map((m) => [m.id, m]));
      for (const ref of q.sourceAnnotations.references) assert.equal(String(messages.get(ref.messageId).sourceId), String(ref.sourceId));
    }
  },
);

const DRAWS = [
  "longmemeval-m",
  "beam-100k",
  "beam-500k",
  "beam-1m",
  "locomo",
  "memoryagentbench-cr",
  "memorycode",
  "vibemembench",
  "dreambench-swe",
  "coding-longitudinal",
];

test("every pinned suite has bytes, sha256 and a licence", () => {
  for (const [suite, pin] of Object.entries(DATASETS)) {
    if (pin.generated) {
      assert.ok(pin.license, `${suite} generated pin needs a licence note`);
      continue;
    }
    if (pin.parts) {
      assert.ok(pin.parts.length > 0, `${suite} parts`);
      for (const part of pin.parts) {
        assert.ok(part.bytes > 0 && /^[a-f0-9]{64}$/.test(part.sha256), `${suite} part pin`);
        assert.ok(pin.license && pin.licenseUrl, `${suite} part licence`);
      }
      continue;
    }
    assert.ok(pin.bytes > 0, `${suite} bytes`);
    assert.ok(/^[a-f0-9]{64}$/.test(pin.sha256 ?? ""), `${suite} sha256`);
    assert.ok(pin.license && pin.licenseUrl, `${suite} licence`);
    assert.ok(/^https:\/\//.test(pin.url ?? ""), `${suite} url`);
  }
  assert.deepEqual(ROBUSTNESS_CRITERIA.suites.unavailable, ["statemembench"]);
});

test("robustness_draws_are_label_blind_and_frozen", () => {
  for (const suite of DRAWS) {
    const draw = robustnessDraw(suite);
    const all = [];
    for (const partition of ["dev", "heldout-a", "heldout-b"]) {
      for (const ids of Object.values(draw.abilities[partition])) all.push(...ids);
    }
    assert.equal(new Set(all).size, all.length, `${suite}: an id appears in two partitions`);
    assert.equal(robustnessIdsHash(draw.abilities), draw.idsHash, `${suite}: idsHash drifted`);
    // Re-draw from id/ability metadata only: shuffled order, changed text, same partitions.
    const items = Object.entries(draw.abilities).flatMap(([partition, abilities]) =>
      Object.entries(abilities).flatMap(([ability, ids]) =>
        ids.map((id) => ({ id, ability, question: `text-${partition}-${id}`, answers: ["gold"] })),
      ),
    );
    const shuffled = [...items].reverse();
    const again = drawRobustnessPartitions(shuffled, suite);
    assert.deepEqual(again.abilities, draw.abilities, `${suite}: draw is not deterministic or label-blind`);
  }
});

test("every_ability_has_heldout_items", () => {
  for (const suite of DRAWS) {
    const draw = robustnessDraw(suite);
    for (const ability of Object.keys(draw.abilities.dev)) {
      assert.ok(draw.abilities["heldout-a"][ability]?.length > 0, `${suite}/${ability} missing from heldout-a`);
      assert.ok(draw.abilities["heldout-b"][ability]?.length > 0, `${suite}/${ability} missing from heldout-b`);
    }
    assert.deepEqual(
      Object.keys(draw.abilities.dev).sort(),
      Object.keys(draw.abilities["heldout-a"]).sort(),
      `${suite}: partition abilities differ`,
    );
    assert.deepEqual(
      Object.keys(draw.abilities.dev).sort(),
      Object.keys(draw.abilities["heldout-b"]).sort(),
      `${suite}: partition abilities differ`,
    );
  }
  // Abstention and preference are explicit robust (ii) slices, not leftovers.
  const longmem = robustnessDraw("longmemeval-m").abilities.dev;
  assert.ok(longmem.abstention?.length > 0 && longmem["single-session-preference"]?.length > 0);
  assert.ok(robustnessDraw("beam-1m").abilities["heldout-a"].abstention?.length > 0);
});

test("diagnostics_refuse_every_heldout_partition", async () => {
  for (const subset of ["heldout-a", "heldout-b"]) {
    await assert.rejects(diagnoseRetrieval({ suite: "locomo", subset }), {
      name: "MemoryBenchDatasetError",
    });
  }
});

test("criteria_hash_is_pinned_in_manifests", async () => {
  const expected = robustnessCriteriaHash();
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(buildManifest().criteriaHash, expected);
  const report = await runBench({ offline: true });
  assert.equal(report.criteriaHash, expected);
});

test("json_array_stream_reads_one_question_at_a_time", () => {
  const rows = [
    { question_id: "a", text: 'brace } and quote " and \\ backslash' },
    { question_id: "b", nested: { x: [1, 2] } },
  ];
  const bytes = Buffer.from(`[\n${JSON.stringify(rows[0])},\n${JSON.stringify(rows[1])}\n]`);
  assert.deepEqual(parseJsonArrayIncremental(bytes), rows);
  assert.throws(() => parseJsonArrayIncremental(Buffer.from('[{ "a": 1 }')), { name: "MemoryBenchDatasetError" });
});

test("beam_and_memorycode_normalizers_keep_ability_and_gold", () => {
  const beam = normalizeDataset(
    [
      {
        conversation_id: "c1",
        chat: [
          [
            { content: "hi", role: "user", time_anchor: "March-15, 2024" },
            { content: "hello", role: "assistant", time_anchor: "March-15, 2024" },
          ],
        ],
        probing_questions: {
          abstention: [{ question: "q?", ideal_response: "not stated" }],
          knowledge_update: [{ question: "u?", answer: "new value" }],
        },
      },
    ],
    "beam-100k",
  );
  assert.deepEqual(
    beam.map((row) => row.ability),
    ["abstention", "knowledge_update"],
  );
  assert.deepEqual(
    beam.map((row) => row.answers[0]),
    ["not stated", "new value"],
  );
  assert.equal(beam[0].sessions.length, 1);
  // Ids are stable and derived from metadata only (no order dependence across conversations).
  assert.equal(beam[0].id, "c1:abstention:0");

  const code = normalizeDataset(
    [
      {
        id: 7,
        sessions: JSON.stringify([
          {
            type: ["instruction-add", "instruction-update"],
            topic: ["use zod", "use valibot"],
            session_eval_query: ["latest validation library?"],
            text: "A: use zod",
          },
        ]),
      },
    ],
    "memorycode",
  );
  assert.equal(code[0].ability, "instruction-update");
  assert.deepEqual(code[0].answers, ["use zod", "use valibot"]);
  assert.equal(code[0].question, "latest validation library?");
});

test("longmemeval_m_draw_matches_the_cached_dataset_when_present", async () => {
  const cache = join(process.env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "memory-bench");
  if (!existsSync(join(cache, "longmemeval-m.json"))) return; // the 2.7 GB file is Task 4's download
  verifyLongMemEvalMItems(
    normalizeDataset(await loadDataset("longmemeval-m", { cache }), "longmemeval-m"),
    robustnessDraw("longmemeval-m"),
  );
}, 120_000);

test("selection_uses_only_the_frozen_partition", () => {
  const draw = robustnessDraw("memorycode");
  const questions = Object.entries(draw.abilities.dev).flatMap(([ability, ids]) => ids.map((id) => ({ id, ability })));
  const selected = selectQuestions(questions, "memorycode", { subset: "dev" });
  assert.equal(selected.length, questions.length);
  assert.throws(() => selectQuestions(questions, "memorycode", { subset: "heldout-a" }), { name: "MemoryBenchDatasetError" });
});

test("robustness_criteria_hash_unchanged_by_cache_tasks", () => {
  // Plan 202 Tasks 4.11-4.15 change cache behavior, not the pre-registered criteria. This is the hash every baseline report since 2026-10-27 carries.
  assert.equal(robustnessCriteriaHash(), "dd1add49cd1d4f023c8ecf027145ac69d10d764137db87cb015166bd80e80ea7");
});

test("three_tier_criteria_hash_is_stable_and_pinned_by_manifests", () => {
  const hash = threeTierCriteriaHash();
  assert.match(hash, /^[a-f0-9]{64}$/);
  // Key order and formatting do not move the hash; a content change does.
  const reversed = (value) =>
    Array.isArray(value)
      ? value.map(reversed)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .reverse()
              .map((key) => [key, reversed(value[key])]),
          )
        : value;
  assert.equal(threeTierCriteriaHash(reversed(THREE_TIER_CRITERIA)), hash);
  assert.notEqual(threeTierCriteriaHash({ ...THREE_TIER_CRITERIA, frozen: "2000-01-01" }), hash);
  assert.equal(verifyThreeTierCriteria(), hash);
  assert.equal(threeTierManifestPin().threeTierCriteriaHash, hash);
  assert.equal(threeTierManifestPin().criteriaHash, robustnessCriteriaHash());
  // Plan 202's frozen hash is untouched by this file.
  assert.equal(robustnessCriteriaHash(), THREE_TIER_CRITERIA.pins.robustnessCriteriaHash);
  assertThreeTierCriteriaPin({ ...threeTierManifestPin(), jobs: [] });
});

test("manifest_refuses_three_tier_criteria_drift", () => {
  const pin = threeTierManifestPin();
  assert.throws(() => assertThreeTierCriteriaPin({ criteriaHash: pin.criteriaHash }), /does not pin/);
  assert.throws(() => assertThreeTierCriteriaPin({ ...pin, threeTierCriteriaHash: "0".repeat(64) }), /pins a different/);
  assert.throws(() => assertThreeTierCriteriaPin({ ...pin, criteriaHash: "0".repeat(64) }), /different robustness criteria/);
  // Drift in the file itself: a moved partition pin or a vanished criterion is refused by the validator.
  const moved = structuredClone(THREE_TIER_CRITERIA);
  moved.pins.partitionIdsHash.locomo = "0".repeat(64);
  assert.throws(() => verifyThreeTierCriteria(moved), /locomo partition ids changed/);
  const stale = structuredClone(THREE_TIER_CRITERIA);
  stale.pins.robustnessCriteriaHash = "0".repeat(64);
  assert.throws(() => verifyThreeTierCriteria(stale), /robustness criteria changed/);
  const missing = structuredClone(THREE_TIER_CRITERIA);
  delete missing.criteria.O4;
  assert.throws(() => verifyThreeTierCriteria(missing), /criterion O4 is missing/);
});

test("consolidation_sensitive_abilities_exist_in_every_partition", () => {
  for (const [suite, abilities] of Object.entries(THREE_TIER_CRITERIA.abilities.consolidationSensitive)) {
    const draw = robustnessDraw(suite);
    for (const ability of abilities)
      for (const partition of ["dev", "heldout-a", "heldout-b"])
        assert.ok(draw.abilities[partition][ability]?.length > 0, `${suite}/${ability} empty in ${partition}`);
  }
  // A named ability that a partition lacks is refused.
  const bad = structuredClone(THREE_TIER_CRITERIA);
  bad.abilities.consolidationSensitive.locomo = ["no-such-ability"];
  assert.throws(() => verifyThreeTierCriteria(bad), /no items in dev/);
});
