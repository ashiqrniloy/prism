/**
 * Plan 188.4 Further Action 4: the per-note lifecycle view. Every number and every refusal comes from
 * the rules themselves (`shouldArchive`, `storageStrength`, `retrievalStrength`), so a printed view
 * cannot drift from what `maintain()` does.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { MemoryNoteMetadata } from "../../types.js";
import { describeNote, inspectNote } from "../inspect.js";

function note(fields: Partial<Omit<MemoryNoteMetadata, "v">> = {}): MemoryNoteMetadata {
  return { v: 1, kind: "fact", ...fields };
}

describe("lifecycle inspection (plan 188.4 Further Action 4)", () => {
  it("shows_both_strengths_and_the_use_log", () => {
    const metadata = note({
      uses: [
        { s: 12, at: "2026-01-01T00:00:00.000Z" },
        { s: 40, at: "2026-01-02T00:00:00.000Z" },
      ],
      useSessions: 2,
      created: 12,
    });
    const view = inspectNote({ id: "aaaaaaaaaaaa", metadata, status: "verified", clock: 42 });
    assert.equal(view.status, "verified");
    assert.deepEqual(
      view.uses,
      [
        { s: 12, at: "2026-01-01T00:00:00.000Z" },
        { s: 40, at: "2026-01-02T00:00:00.000Z" },
      ],
      "the log is shown as recorded",
    );
    assert.equal(view.useSessions, 2);
    // R = ln(3^-0.4 + 31^-0.4) at clock 42; S = 0.5·ln(1 + 2) with the default weights.
    const storage = Math.log(3) / 2;
    assert.equal(view.retrieval, Math.round(Math.log(3 ** -0.4 + 31 ** -0.4) * 10_000) / 10_000);
    assert.equal(view.storage, Math.round(storage * 10_000) / 10_000);
    assert.equal(view.importance, Math.round((storage / (1 + storage)) * 10_000) / 10_000);
    assert.equal(view.archive.reasons.includes("grace"), false, "a note written at 12 is past grace at 42");
  });

  it("names_the_archive_gate_that_refuses", () => {
    const fresh = inspectNote({
      id: "bbbbbbbbbbbb",
      metadata: note({ uses: [{ s: 41, at: "2026-01-01T00:00:00.000Z" }], useSessions: 1, created: 41 }),
      status: "verified",
      clock: 42,
    });
    assert.equal(fresh.archive.eligible, false);
    assert.deepEqual(fresh.archive.reasons, ["retrieval", "grace"], "a current use is not archivable");

    const strong = inspectNote({
      id: "cccccccccccc",
      metadata: note({
        created: 0,
        useSessions: 1,
        promotion: { score: 1, pass: "p1", signals: { explicit: 1 } },
      }),
      status: "verified",
      clock: 200,
    });
    assert.equal(strong.archive.eligible, false);
    assert.equal(strong.archive.reasons.includes("storage"), true, "a high-S note is never archived by decay");

    const pinned = inspectNote({
      id: "dddddddddddd",
      metadata: note({ pinned: true, created: 0 }),
      status: "verified",
      clock: 200,
    });
    assert.deepEqual(pinned.archive.reasons, ["pinned"]);

    const stale = inspectNote({ id: "eeeeeeeeeeee", metadata: note({ created: 0 }), status: "candidate", clock: 200 });
    assert.equal(stale.archive.eligible, true, "no uses, no explicit evidence, long past grace");
    assert.deepEqual(stale.archive.reasons, []);
  });

  it("describes_a_note_in_one_line", () => {
    const line = describeNote(
      inspectNote({ id: "111111111111", metadata: note({ key: "canary.drain", created: 0 }), status: "verified", clock: 200 }),
    );
    assert.equal(line, "111111111111 fact key=canary.drain verified S=0 R=-2.1213 uses=0/0 archive=yes");
    const hidden = inspectNote({
      id: "222222222222",
      metadata: note({ kind: "episode", mergedInto: "333333333333", created: 0 }),
      status: "verified",
      clock: 200,
    });
    // An episode decays faster than a fact (d 0.8 vs 0.4), so R is lower and the note is archivable.
    assert.match(describeNote(hidden), /R=-4\.2426 uses=0\/0 archive=yes mergedInto=333333333333$/);
  });
});
