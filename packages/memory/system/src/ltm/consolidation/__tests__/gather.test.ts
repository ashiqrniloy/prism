/** Candidate gathering for session consolidation: deterministic, bounded, and free of model calls (plan 188.3 Task 1). */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type ContentBlock, createSessionEntry, type SessionEntry } from "@arnilo/prism";
import {
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  TASK_STATE_RECORDED,
} from "@arnilo/prism-memory-system";
import { CONSOLIDATION_PATTERNS, gatherConsolidationCandidates } from "../gather.js";

const sessionId = "s1";
const timestamp = "2026-10-19T00:00:00.000Z";

function message(id: string, role: "user" | "assistant" | "tool", content: readonly ContentBlock[], runId?: string): SessionEntry {
  return createSessionEntry({
    id,
    sessionId,
    timestamp,
    kind: "message",
    ...(runId === undefined ? {} : { runId }),
    message: { role, content },
  });
}

function record(id: string, data: unknown): SessionEntry {
  return createSessionEntry({ id, sessionId, timestamp, kind: "custom", data });
}

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  kind: "statement",
  description: "User wants Bun run with an explicit timeout.",
  timestamp,
  relevance: "high",
  sourceEntryIds: ["e1"],
  tokenCount: 8,
};

const lowObservation: MemoryObservation = {
  id: "cccccccccccc",
  kind: "statement",
  description: "Tests printed a long stack trace.",
  timestamp,
  relevance: "low",
  sourceEntryIds: ["e1"],
  tokenCount: 6,
};

const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "Prefer an explicit timeout on every long command.",
  supportingObservationIds: [observation.id],
  tokenCount: 9,
};

function decisionsEntry(id: string, decisions: readonly string[]): SessionEntry {
  return record(id, {
    type: TASK_STATE_RECORDED,
    taskState: { id: "dddddddddddd", goal: "Add consolidation", decisions, sourceEntryIds: ["e1"] },
  });
}

describe("consolidation candidate gathering", () => {
  it("gather_reads_reflections_decisions_and_high_observations", () => {
    const entries = [
      message("e1", "user", [text("hello")]),
      record("e2", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      decisionsEntry("e3", ["Use Bun for scripts"]),
      record("e4", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
    ];
    const gathered = gatherConsolidationCandidates(entries);
    assert.deepEqual(
      gathered.map((candidate) => candidate.source),
      ["decision", "observation", "reflection"],
    );
    assert.equal(gathered[0]?.text, "Use Bun for scripts");
    assert.ok(gathered[0]?.evidenceIds.includes("e3"));
    assert.equal(gathered[1]?.text, observation.description);
    assert.ok(gathered[1]?.evidenceIds.includes("e2"));
    assert.equal(gathered[2]?.text, reflection.content);
  });

  it("gather_skips_superseded_reflections_and_low_observations", () => {
    const replacement: MemoryReflection = { ...reflection, id: "eeeeeeeeeeee", content: "Prefer short commands." };
    const entries = [
      message("e1", "user", [text("hello")]),
      record("e2", { type: OBSERVATIONS_RECORDED, observations: [observation, lowObservation] }),
      record("e3", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
      record("e4", { type: REFLECTIONS_RECORDED, reflections: [replacement], supersededReflectionIds: [reflection.id] }),
    ];
    const gathered = gatherConsolidationCandidates(entries);
    assert.deepEqual(
      gathered.map((candidate) => candidate.text),
      [observation.description, replacement.content],
    );
    assert.ok(!gathered.some((candidate) => candidate.text === lowObservation.description));
  });

  it("explicit_statement_from_user_only_never_assistant", () => {
    const entries = [
      message("e1", "user", [text("Remember: always run with a timeout. Tests are slow.")]),
      message("e2", "assistant", [text("Always use bun from now on.")]),
    ];
    const gathered = gatherConsolidationCandidates(entries);
    assert.deepEqual(
      gathered.map((candidate) => candidate.source),
      ["explicit"],
    );
    assert.equal(gathered[0]?.text, "Remember: always run with a timeout.");
    assert.deepEqual(gathered[0]?.signals, { explicit: 1 });
    assert.deepEqual(gathered[0]?.evidenceIds, ["e1"]);
  });

  it("correction_candidate_carries_corrected_entry_and_cited_notes", () => {
    const entries = [
      message("e1", "assistant", [text("Use npm to run the tests [aaaaaaaaaaaa].")], "r1"),
      message("e2", "user", [text("No, use bun instead.")], "r2"),
    ];
    const gathered = gatherConsolidationCandidates(entries);
    const [correction] = gathered;
    assert.equal(correction?.source, "correction");
    assert.equal(correction?.text, "No, use bun instead.");
    assert.deepEqual(correction?.evidenceIds, ["e2", "e1"], "evidence ids are session entries only");
    assert.deepEqual(correction?.citedNotes, ["aaaaaaaaaaaa"], "the cited note is harmful evidence, not an entry");
    assert.deepEqual(correction?.signals, { correction: 1 });
  });

  it("outcome_tags_candidates_in_same_run_and_is_never_text", () => {
    const entries = [
      message("e1", "assistant", [{ type: "tool_call", id: "c1", name: "bash", arguments: { command: "bun test" } }], "r1"),
      message("e2", "tool", [{ type: "tool_result", toolCallId: "c1", name: "bash", result: { output: "PASS 12 tests" } }], "r1"),
      message("e3", "user", [text("Always run the suite before a commit.")], "r1"),
      message("e4", "user", [text("Always name files in kebab-case.")], "r2"),
      message("e5", "assistant", [{ type: "tool_call", id: "c2", name: "bash", arguments: { command: "pytest -q" } }], "r2"),
      message("e6", "tool", [{ type: "tool_result", toolCallId: "c2", name: "bash", error: { code: "exit", message: "1 failed" } }], "r2"),
    ];
    const gathered = gatherConsolidationCandidates(entries);
    const suite = gathered.find((candidate) => candidate.text === "Always run the suite before a commit.");
    const naming = gathered.find((candidate) => candidate.text === "Always name files in kebab-case.");
    assert.deepEqual(suite?.signals, { explicit: 1, outcome: 1 });
    assert.deepEqual(naming?.signals, { explicit: 1 });
    assert.ok(gathered.every((candidate) => !candidate.text.includes("PASS") && !candidate.text.includes("1 failed")));
  });

  it("gather_is_bounded_and_priority_ordered", () => {
    const entries = [
      message("e1", "user", [text("Always pass a timeout to shell commands.")]),
      message("e2", "assistant", [text("Running tests now.")], "r1"),
      message("e3", "user", [text("No, that's wrong.")], "r2"),
      decisionsEntry("e4", ["Use Bun for scripts"]),
      record("e5", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      record("e6", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
    ];
    const gathered = gatherConsolidationCandidates(entries, { maxCandidates: 2 });
    assert.deepEqual(
      gathered.map((candidate) => candidate.source),
      ["explicit", "correction"],
    );
    const capped = gatherConsolidationCandidates(entries, { maxTextChars: 4 });
    assert.equal(capped[0]?.text, "Alwa");
  });

  it("gather_is_idempotent_for_same_cursor", () => {
    const entries = [
      message("e1", "user", [text("Always pass a timeout.")]),
      record("e2", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      record("e3", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
      message("e4", "user", [text("Never edit generated files.")]),
    ];
    const first = gatherConsolidationCandidates(entries, { cursor: "e1" });
    const second = gatherConsolidationCandidates(entries, { cursor: "e1" });
    assert.deepEqual(first, second);
    assert.ok(!first.some((candidate) => candidate.text.includes("Always pass a timeout")));
    assert.ok(first.some((candidate) => candidate.text.includes("Never edit generated files")));
    assert.deepEqual(gatherConsolidationCandidates(entries, { cursor: "e4" }), []);
  });

  it("candidate_text_goes_through_the_redactor", () => {
    const entries = [message("e1", "user", [text("Remember the token SECRET123 for the API.")])];
    const gathered = gatherConsolidationCandidates(entries, { redact: (value) => value.replace("SECRET123", "[redacted]") });
    assert.equal(gathered[0]?.text, "Remember the token [redacted] for the API.");
  });

  it("pattern_sets_are_exported_data", () => {
    assert.ok(CONSOLIDATION_PATTERNS.explicit.some((pattern) => new RegExp(pattern, "i").test("I prefer tabs")));
    assert.ok(CONSOLIDATION_PATTERNS.correction.some((pattern) => new RegExp(pattern, "i").test("that's wrong")));
    assert.ok(CONSOLIDATION_PATTERNS.outcomes.some((pattern) => new RegExp(pattern, "i").test("git commit -m x")));
  });
});
