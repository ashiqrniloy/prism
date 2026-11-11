/**
 * Plan 188.4 Task 3: the two strengths. S accumulates evidence of value and R is a power law over
 * use events in scope sessions, so a project left alone does not decay while another one runs.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { MemoryNoteMetadata, MemoryNoteUseEvent } from "../../types.js";
import { DEFAULT_DECAY, DEFAULT_STRENGTH_WEIGHTS, noteImportance, retrievalStrength, storageStrength, strengthPrior } from "../index.js";

const AT = "2026-01-01T00:00:00.000Z";

function use(s: number, at = AT): MemoryNoteUseEvent {
  return { s, at };
}

function note(fields: Partial<MemoryNoteMetadata> = {}): MemoryNoteMetadata {
  return { v: 1, kind: "fact", ...fields };
}

function promotion(signals: Record<string, number>): MemoryNoteMetadata["promotion"] {
  return { score: 1, signals, pass: "p1" };
}

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

describe("retrieval strength (plan 188.4 Task 3)", () => {
  it("retrieval_strength_is_power_law_in_scope_sessions", () => {
    // R = ln Σ (clock − s + 1)^(−d): the ages are 3 and 31 for a clock of 42.
    const meta = note({ uses: [use(12), use(40)], useSessions: 2 });
    close(retrievalStrength(meta, 42, 0.4), Math.log(3 ** -0.4 + 31 ** -0.4));
    // A use in the current session is the strongest; each session of neglect lowers R.
    assert.ok(retrievalStrength(note({ uses: [use(42)], useSessions: 1 }), 42, 0.4) > retrievalStrength(meta, 42, 0.4));
    assert.ok(retrievalStrength(meta, 62, 0.4) < retrievalStrength(meta, 42, 0.4));
    // The per-kind decay changes the shape: an episode forgets faster than a preference.
    assert.ok(retrievalStrength(meta, 62, DEFAULT_DECAY.episode) < retrievalStrength(meta, 62, DEFAULT_DECAY.preference));
  });

  it("idle_project_does_not_decay_while_other_projects_run", () => {
    // Wall time is not time: two notes used in the same sessions rank the same a year later, because
    // `at` is provenance and only the scope's session ordinal moves the age.
    const now = note({ uses: [use(41, "2026-01-01T00:00:00.000Z")], useSessions: 1 });
    const later = note({ uses: [use(41, "2027-01-01T00:00:00.000Z")], useSessions: 1 });
    assert.equal(retrievalStrength(now, 42, 0.4), retrievalStrength(later, 42, 0.4));
    // Another project working does not touch this scope's clock, so R is unchanged.
    assert.equal(retrievalStrength(now, 42, 0.4), retrievalStrength(now, 42, 0.4));
    // The note's own scope advancing by twenty sessions is what costs it.
    assert.ok(retrievalStrength(now, 62, 0.4) < retrievalStrength(now, 42, 0.4));
  });

  it("uses_older_than_the_log_and_unused_notes_have_a_floor", () => {
    // A note with no use ranks as if used once at ordinal 0: finite, negative, never NaN.
    const unused = retrievalStrength(note({}), 10, 0.4);
    close(unused, Math.log(11 ** -0.4));
    assert.ok(Number.isFinite(unused));
    // 40 uses but only the 2 newest logged: the Petrov approximation adds the 38 older ones, so the
    // note stays above a note whose two logged uses are all it ever had.
    const logged = note({ uses: [use(12), use(40)], useSessions: 2 });
    const capped = note({ uses: [use(12), use(40)], useSessions: 40 });
    assert.ok(retrievalStrength(capped, 42, 0.4) > retrievalStrength(logged, 42, 0.4));
    // A clock of 0 still ranks a use at ordinal 0 at age 1, never log(0).
    close(retrievalStrength(note({ uses: [use(0)], useSessions: 1 }), 0, 0.4), 0);
  });
});

describe("storage strength (plan 188.4 Task 3)", () => {
  it("storage_strength_accumulates_and_drops_only_on_harmful", () => {
    // S = a·explicit + b·log(1+useSessions) + c·helpful − d·harmful + e·outcome.
    close(storageStrength(note({ promotion: promotion({ explicit: 1 }) })), 1);
    close(
      storageStrength(note({ promotion: promotion({ explicit: 1, outcome: 1 }), useSessions: 3, helpful: 2 })),
      1 + 0.5 * Math.log(4) + 1 + 0.5,
    );
    // Nothing but harmful lowers S, and S clamps at 0.
    const strong = note({ promotion: promotion({ explicit: 1 }), useSessions: 5, helpful: 4 });
    const corrected = { ...strong, harmful: 1 };
    assert.ok(storageStrength(corrected) < storageStrength(strong));
    close(storageStrength(note({ harmful: 9 })), 0);
    // A never-cited, never-promoted note has no evidence at all.
    close(storageStrength(note({})), 0);
    // Reinforcing one input never lowers S.
    let previous = storageStrength(note({}));
    for (let sessions = 1; sessions <= 6; sessions += 1) {
      const next = storageStrength(note({ useSessions: sessions }));
      assert.ok(next >= previous);
      previous = next;
    }
  });

  it("importance_is_storage_strength_normalised_to_the_unit_interval", () => {
    // D14: importance is evidence, not a constant 0.5. An explicit note lands exactly at 0.5.
    close(noteImportance(storageStrength(note({ promotion: promotion({ explicit: 1 }) }))), 0.5);
    close(noteImportance(0), 0);
    for (const strength of [0, 0.5, 1, 3, 20]) {
      const value = noteImportance(strength);
      assert.ok(value >= 0 && value < 1, `${value} in [0,1)`);
      assert.ok(value >= noteImportance(strength - 0.5), "importance is monotone in S");
    }
  });
});

describe("the two priors (plan 188.4 Task 3)", () => {
  it("priors_are_bounded_by_their_weights", () => {
    const maxed = note({
      useSessions: 500,
      helpful: 500,
      uses: Array.from({ length: 32 }, (_, index) => use(1000 - index)),
      promotion: promotion({ explicit: 1, outcome: 1 }),
    });
    const prior = strengthPrior(maxed, 1000);
    const bound = DEFAULT_STRENGTH_WEIGHTS.retrieval + DEFAULT_STRENGTH_WEIGHTS.storage;
    assert.ok(prior > 0 && prior <= bound, `${prior} in (0,${bound}]`);
    // Even a maximally used note stays under one scope prior, so relevance keeps the final word.
    assert.ok(prior < 0.15);
    // A neglected note still earns its share: both priors are positive, neither is a gate.
    assert.ok(strengthPrior(note({}), 100) > 0);
  });
});
