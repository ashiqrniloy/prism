import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { attributeAnswerPaths, TASK7_TOOLS } from "./preservation.mjs";
import { compareSessionCaptures, normalizeRequestText } from "./session-replay.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const RECORD = "docs/_evidence/memory-bench/216/preservation.json";

test("preservation_record_lists_every_move_and_attributed_difference", async () => {
  const text = await readFile(RECORD, "utf8");
  const record = JSON.parse(text);
  const { sha256: pinned, ...body } = record;
  expect(sha256(JSON.stringify(body))).toBe(pinned);
  expect(record.verdict).toBe("preserved: every difference is attributed");
  expect(record.moves.map((move) => move.task)).toEqual([3, 4, 5, 6, 7]);
  for (const move of record.moves) {
    expect(move.fixtures.length).toBeGreaterThan(0);
    expect(Array.isArray(move.attributedDifferences)).toBe(true);
  }
  const byTask = Object.fromEntries(record.moves.map((move) => [move.task, move]));
  expect(byTask[3].attributedDifferences.length).toBe(1);
  expect(byTask[4].result).toBe("identical-after-attribution");
  expect(byTask[4].differing).toEqual([]);
  expect(byTask[4].attributedDifferences.sort()).toEqual(['"om:s" -> "memory.session:s"', "# Observational Memory -> # Session Memory"]);
  expect(byTask[5].attributedDifferences).toEqual([]);
  // Task 6's dropper change applies only past the rehearsal target.
  expect(byTask[6].attributedDifferences.length > 0).toBe(byTask[6].rehearsal.post.crossed);
  const task7 = byTask[7].attributedDifferences.map((row) => row.what);
  for (const what of [
    "tool-schema re-pin of the plan 210 golden",
    "prefix-probe report shape",
    "readiness CACHE_STABILITY_TESTS",
    "plan 210 mechanisms coverage",
  ])
    expect(task7).toContain(what);
  // The answer paths differ only in the Task 7 tool text, and the record names the files it was built from.
  expect(record.answerPaths.withoutToolText.residual).toBe(0);
  expect(record.answerPaths.unattributedTools).toEqual([]);
  expect(record.answerPaths.withoutToolText.differingTools.every((name) => TASK7_TOOLS.includes(name))).toBe(true);
  expect(record.answerPaths.matchesEquivalenceFile).toBe(true);
  expect(sha256(await readFile(record.answerPaths.equivalence.file, "utf8"))).toBe(record.answerPaths.equivalence.sha256);
  expect(sha256(await readFile(record.golden.file, "utf8"))).toBe(record.golden.sha256);
  expect(record.prefixProbe.scenarios.every((row) => row.sharedBlocksIdentical)).toBe(true);
  expect(record.cleanupCampaignDryRun.errors).toBe(0);
});

test("session_replay_normalizes_run_ids_and_applies_only_named_renames", () => {
  const a = normalizeRequestText('{"id":"0f8e7d6c-1111-2222-3333-444455556666","obs":"[8f274016e053]","at":"2026-11-08T22:51:00.000Z"}');
  const b = normalizeRequestText('{"id":"aaaabbbb-1111-2222-3333-444455556666","obs":"[530e458e5da3]","at":"2026-11-09T01:00:00.000Z"}');
  expect(a).toBe(b);
  const capture = (texts) => ({ requests: texts.map((text) => ({ role: "worker", text })) });
  const renamed = compareSessionCaptures(capture(['{"sessionId":"om:s"}']), capture(['{"sessionId":"memory.session:s"}']));
  expect(renamed.status).toBe("identical-after-attribution");
  const other = compareSessionCaptures(capture(['{"x":"om:s","y":1}']), capture(['{"x":"memory.session:s","y":2}']));
  expect(other.status).toBe("different");
});

test("answer_path_attribution_names_differing_tools_and_counts_residuals", () => {
  const request = (description, extra = "") =>
    JSON.stringify({
      messages: [
        { role: "system", content: [{ type: "text", text: `Available tools:\n- memory.view: ${description}\n- memory.read: same` }] },
        { role: "user", content: [{ type: "text", text: `question${extra}` }] },
      ],
      tools: [{ name: "memory.view", description }],
    });
  const tools = attributeAnswerPaths({ "1.json": request("old") }, { "1.json": request("new") });
  expect(tools).toMatchObject({ residual: 0, differingTools: ["memory.view"] });
  expect(attributeAnswerPaths({ "1.json": request("old") }, { "1.json": request("old", "!") }).residual).toBe(1);
});
