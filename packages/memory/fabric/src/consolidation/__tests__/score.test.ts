import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtractedNote } from "../extract.js";
import type { ConsolidationCandidate } from "../gather.js";
import {
  DEFAULT_PROMOTION_MIN_SCORE,
  DERIVABLE_COVERAGE,
  ephemeralReason,
  loadDerivableSources,
  recurrenceSignal,
  scorePromotion,
} from "../score.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prism-derivable-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text);
  return root;
}

const explicitCandidate: ConsolidationCandidate = {
  source: "explicit",
  text: "Always run bun with a timeout.",
  evidenceIds: ["e1"],
  signals: { explicit: 1 },
};
const decisionCandidate: ConsolidationCandidate = {
  source: "decision",
  text: "Use SQLite for local state.",
  evidenceIds: ["e2"],
  signals: {},
};

function note(overrides: Partial<ExtractedNote> = {}): ExtractedNote {
  return {
    text: "Bun commands run with an explicit timeout.",
    kind: "procedure",
    scope: "project",
    keywords: ["bun"],
    aliases: [],
    evidence: ["c1"],
    explicit: false,
    correction: false,
    generality: 0.8,
    ephemerality: 0.1,
    derivable: false,
    ...overrides,
  };
}

describe("consolidation scoring", () => {
  it("explicit_user_statement_passes_gate_regardless_of_score", () => {
    const scored = scorePromotion(note({ explicit: true, generality: 0.1, ephemerality: 0.9 }), {
      candidates: [explicitCandidate],
      sessions: 1,
    });
    assert.equal(scored.signals.explicit, 1);
    assert.ok(scored.score < DEFAULT_PROMOTION_MIN_SCORE);
    assert.equal(scored.accepted, true);
    assert.equal(scored.reason, undefined);

    // Without the extraction flag (or without an explicit candidate) it is an ordinary scored note.
    assert.equal(scorePromotion(note({ explicit: false }), { candidates: [explicitCandidate], sessions: 1 }).accepted, false);
    assert.equal(scorePromotion(note({ explicit: true }), { candidates: [decisionCandidate], sessions: 1 }).signals.explicit, 0);
  });

  it("line_number_or_temp_path_marks_ephemeral_and_rejects", () => {
    for (const text of ["The bug is at src/app.ts:42.", "The scratch copy lives in /tmp/run.md.", "Revert commit 3f9a1b2."]) {
      const scored = scorePromotion(note({ text, explicit: false }), { candidates: [decisionCandidate], sessions: 2 });
      assert.equal(scored.signals.ephemerality, 1, text);
      assert.equal(scored.reason, "ephemeral", text);
    }
    assert.equal(ephemeralReason("Always check out branch feat/scope-work first."), "branch-name");
    assert.equal(ephemeralReason("The release happened on 2026-10-19."), "date");
    assert.equal(ephemeralReason("Until 2027-01-01 the old store is still read."), undefined);
    assert.equal(ephemeralReason("Run the suite with an explicit timeout."), undefined);
    // An explicit statement is still kept: the user said it on purpose.
    assert.equal(
      scorePromotion(note({ text: "Always keep the scratch file in /tmp/prism.md.", explicit: true }), {
        candidates: [explicitCandidate],
        sessions: 1,
      }).accepted,
      true,
    );
  });

  it("note_covered_by_readme_is_derivable_and_rejected", async () => {
    const readme = "Run bun test with an explicit timeout before every commit.";
    const root = await projectRoot({ "README.md": readme });
    const { sources, skipped } = await loadDerivableSources(root, ["README.md"]);
    assert.deepEqual(skipped, []);
    assert.equal(sources.length, 1);

    const covered = scorePromotion(note({ text: readme }), { candidates: [decisionCandidate], sessions: 4, derivable: sources });
    assert.equal(covered.signals.derivability, 1);
    assert.equal(covered.reason, "derivable");

    const fresh = scorePromotion(note({ text: "Promoted notes carry their evidence ids." }), {
      candidates: [decisionCandidate],
      sessions: 4,
      derivable: sources,
    });
    assert.equal(fresh.signals.derivability, 0);
    assert.equal(fresh.accepted, true);

    // The extractor's own flag is enough, and it wins even for an explicit statement.
    assert.equal(scorePromotion(note({ derivable: true }), { candidates: [], sessions: 1 }).reason, "derivable");
    assert.equal(
      scorePromotion(note({ explicit: true, derivable: true }), { candidates: [explicitCandidate], sessions: 1 }).accepted,
      false,
    );
    assert.ok(DERIVABLE_COVERAGE > 0.5);
  });

  it("recurrence_counts_distinct_sessions_not_repeats", () => {
    assert.equal(recurrenceSignal(1), 0, "repeats inside one session add nothing");
    assert.ok(recurrenceSignal(2) > recurrenceSignal(1));
    assert.ok(recurrenceSignal(3) > recurrenceSignal(2));
    assert.equal(recurrenceSignal(4), 1);
    assert.equal(recurrenceSignal(50), 1, "capped at 1");

    const once = scorePromotion(note(), { candidates: [decisionCandidate], sessions: 1 });
    const repeated = scorePromotion(note(), { candidates: [decisionCandidate], sessions: 1 });
    assert.equal(once.score, repeated.score);
    const spaced = scorePromotion(note(), { candidates: [decisionCandidate], sessions: 4 });
    assert.ok(spaced.score > once.score);
  });

  it("duplicate_lowers_score", () => {
    const fresh = scorePromotion(note(), { candidates: [decisionCandidate], sessions: 4 });
    const duplicated = scorePromotion(note(), {
      candidates: [decisionCandidate],
      sessions: 4,
      existing: [{ id: "aaaaaaaaaaaa", kind: "procedure", text: "Bun commands run with an explicit timeout." }],
    });
    assert.ok(duplicated.signals.duplicate > 0.9);
    assert.ok(duplicated.score < fresh.score);
    assert.equal(fresh.accepted, true);
    assert.equal(duplicated.accepted, false, "a duplicate of an active note falls under minScore");
    assert.equal(duplicated.reason, "score");

    const otherKind = scorePromotion(note(), {
      candidates: [decisionCandidate],
      sessions: 4,
      existing: [{ id: "bbbbbbbbbbbb", kind: "preference", text: "Bun commands run with an explicit timeout." }],
    });
    assert.equal(otherKind.signals.duplicate, 0, "the duplicate term compares the same kind only");
  });

  it("derivable_from_path_outside_root_is_skipped_with_note", async () => {
    const root = await projectRoot({ "README.md": "Bun runs the test suite." });
    const { sources, skipped } = await loadDerivableSources(root, ["../outside.md", "/etc/hosts", "README.md", "missing.md"]);
    assert.deepEqual(
      skipped.map((entry) => [entry.path, entry.reason]),
      [
        ["../outside.md", "outside-root"],
        ["/etc/hosts", "outside-root"],
        ["missing.md", "missing"],
      ],
    );
    assert.deepEqual(
      sources.map((source) => source.path),
      ["README.md"],
    );
  });
});
