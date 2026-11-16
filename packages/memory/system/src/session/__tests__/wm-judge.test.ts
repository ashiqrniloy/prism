/**
 * Plan 218.2 Task 5: WM verdicts in one `judge` call over ordinals, with the records code already protects settled
 * before the model is asked.
 */
import { it } from "bun:test";
import assert from "node:assert/strict";
import type { ModelClient } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import type { ObservationalMemoryLedger } from "../ledger.js";
import type { ProtectionReason } from "../protections.js";
import type { MemoryObservation, MemoryWmItem } from "../types.js";
import { runWm } from "../workers/wm.js";

type ProviderRequest = Parameters<ModelClient["generate"]>[0];

const record = (id: string, description: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  kind: "result",
  description,
  timestamp: "2026-11-12T10:00:00.000Z",
  relevance: "medium",
  sourceEntryIds: [`e-${id.slice(0, 2)}`],
  tokenCount: 10,
  ...extra,
});
const A = record("aaaaaaaaaaaa", "Use pnpm, never npm", { kind: "statement", durable: "constraint" });
const B = record("bbbbbbbbbbbb", "Rename the config loader", { kind: "request" });
const C = record("cccccccccccc", "The loader lives in src/config.ts");
const D = record("dddddddddddd", "Read the README");
const E = record("eeeeeeeeeeee", "Ran the suite; 12 pass");
const OUTSIDE = record("ffffffffffff", "An older record outside the batch");
const W1: MemoryWmItem = {
  id: "111111111111",
  kind: "summary",
  text: "Earlier work",
  relevance: "medium",
  citedIds: ["ffffffffffff"],
  tokenCount: 4,
};

const ledgerOf = (records: readonly MemoryObservation[]): ObservationalMemoryLedger => ({
  observations: [OUTSIDE, ...records],
  wmItems: [W1],
  droppedObservationIds: [],
});

/** A WM model that answers the first request with `calls` and records each request; later turns answer nothing. */
function scripted(calls: readonly [string, Record<string, unknown>][], requests: ProviderRequest[] = []): ModelClient {
  return {
    model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
    async *generate(request) {
      requests.push(request);
      if (!request.messages.some((message) => message.role === "tool"))
        for (const [index, [name, args]] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, name, args as never));
      yield providerDone();
    },
  };
}

const promptOf = (request: ProviderRequest) =>
  request.messages
    .find((message) => message.role === "user")!
    .content.map((block) => (block.type === "text" ? block.text : ""))
    .join("");
const judgeResult = (request: ProviderRequest) => {
  const tool = [...request.messages].reverse().find((message) => message.role === "tool");
  const block = tool?.content.find((part: { type: string }) => part.type === "tool_result") as
    | { result?: Record<string, unknown> }
    | undefined;
  return block?.result as {
    ok: boolean;
    applied: number;
    refused?: { entry: string; reason: string; ordinal?: string; protection?: string }[];
    unjudged: number;
  };
};

const judgeRun = (
  records: readonly MemoryObservation[],
  calls: readonly [string, Record<string, unknown>][],
  protections: ReadonlyMap<string, ProtectionReason> = new Map(),
  extra: Partial<Parameters<typeof runWm>[0]> = {},
) => {
  const requests: ProviderRequest[] = [];
  const run = runWm({
    client: scripted(calls, requests),
    records,
    ledger: ledgerOf(records),
    protections,
    maxTurns: 4,
    endAfterCleanTurn: false,

    ...extra,
  });
  return { run, requests };
};

it("protected_records_are_kept_by_code_and_not_offered_for_verdict", async () => {
  const protections = new Map<string, ProtectionReason>([
    [A.id, "constraint"],
    [B.id, "task_state"],
    [C.id, "fact"],
  ]);
  const { run, requests } = judgeRun(
    [A, B, C, D],
    [["judge", { keep: [{ r: 3, reason: "the fact cites it" }], discard: { finished: [4] } }]],
    protections,
  );
  const output = await run;
  assert.equal(output.verdicts.get(A.id)?.verdict, "keep");
  assert.equal(output.verdicts.get(A.id)?.reason, "protected: constraint");
  assert.equal(output.verdicts.get(B.id)?.reason, "protected: task_state");
  // `fact` still goes to the model: a summary may absorb it.
  assert.equal(output.verdicts.get(C.id)?.verdict, "keep");
  assert.equal(output.verdicts.get(D.id)?.verdict, "discard");
  assert.deepEqual(
    output.items.filter((item) => item.kind === "event").map((item) => item.citedIds[0]),
    [A.id, B.id, C.id],
  );
  const prompt = promptOf(requests[0]!);
  const [kept, offered] = [prompt.split("## Already kept")[1]!.split("## New STM records")[0]!, prompt.split("## New STM records")[1]!];
  assert.match(kept, /\[r1\][^\n]*protected: constraint/);
  assert.match(kept, /\[r2\][^\n]*protected: task_state/);
  assert.doesNotMatch(offered, /\[r1\]|\[r2\]/);
  assert.match(offered, /\[r3\][^\n]*protected: fact/);
  assert.match(offered, /\[r4\]/);
  // Ordinals only: no 12-character id reaches the prompt's record or item lines.
  assert.doesNotMatch(prompt, /\[[a-f0-9]{12}\]/);
  assert.match(prompt, /\[w1\] summary/);
  assert.deepEqual(
    requests[0]!.tools!.map((tool) => tool.name),
    ["judge"],
  );
  // Every record settled: no model call at all.
  const none = judgeRun([A, B], [], protections);
  const all = await none.run;
  assert.equal(none.requests.length, 0);
  assert.equal(all.verdicts.size, 2);
});

it("judge_applies_valid_entries_and_names_each_refused_entry", async () => {
  const { run, requests } = judgeRun(
    [C, D, E],
    [
      [
        "judge",
        {
          keep: [
            { r: 1, reason: "task 3 reads this path", neededLater: "Task 3" },
            { r: 9, reason: "bad ordinal" },
          ],
          discard: { finished: [2], duplicate: [1] },
          summaries: [{ of: [3], text: "  ", relevance: "low" }],
          facts: [{ text: "The loader is src/config.ts", support: ["r1", "w1"], relevance: "high", supersedes: ["w1"] }],
        },
      ],
    ],
  );
  const output = await run;
  assert.equal(output.verdicts.get(C.id)?.verdict, "keep");
  assert.equal(output.verdicts.get(D.id)?.verdict, "discard");
  assert.equal(output.verdicts.has(E.id), false);
  const fact = output.items.find((item) => item.kind === "fact")!;
  assert.deepEqual(fact.citedIds, [C.id, W1.id]);
  assert.deepEqual(output.supersededItemIds, [W1.id]);
  assert.equal(output.items.find((item) => item.citedIds[0] === C.id && item.kind === "event")?.neededLater, "Task 3");
  const answer = judgeResult(requests[1]!);
  assert.equal(answer.ok, false);
  assert.equal(answer.applied, 3);
  assert.equal(answer.unjudged, 1);
  assert.deepEqual(answer.refused, [
    { entry: "keep[1]", reason: "unknown_id", ordinal: "9" },
    { entry: "summaries[0]", reason: "empty_text" },
    { entry: "discard.duplicate[0]", reason: "already_processed", ordinal: "r1" },
  ]);
});

it("judge_ordinal_outside_batch_refused", async () => {
  const { run, requests } = judgeRun(
    [C, D],
    [
      [
        "judge",
        {
          keep: [
            { r: 0, reason: "zero" },
            { r: 1.5, reason: "fraction" },
            { j: 1, reason: "no re-judged records" },
            { r: 1, j: 1, reason: "both" },
          ],
          discard: { finished: [3, -1, "r2x", OUTSIDE.id], stale: [2] },
          summaries: [{ of: [1], text: "Loader path", relevance: "medium", supersedes: ["w2", "r1"] }],
          facts: [{ text: "A fact", support: ["j1"], relevance: "low" }],
        },
      ],
    ],
  );
  const output = await run;
  assert.equal(output.verdicts.size, 0);
  assert.equal(output.items.length, 0);
  const reasons = judgeResult(requests[1]!).refused!.map((entry) => `${entry.entry}:${entry.reason}`);
  assert.deepEqual(reasons, [
    "keep[0]:unknown_id",
    "keep[1]:unknown_id",
    "keep[2]:unknown_id",
    "keep[3]:invalid_arguments",
    "summaries[0]:unknown_id",
    "discard.finished[0]:unknown_id",
    "discard.finished[1]:unknown_id",
    "discard.finished[2]:unknown_id",
    "discard.finished[3]:unknown_id",
    "discard.stale[0]:invalid_arguments",
    "facts[0]:unknown_id",
  ]);
});

it("judge_cannot_discard_a_protected_record", async () => {
  const protections = new Map<string, ProtectionReason>([
    [C.id, "fact"],
    [D.id, "needed_later"],
  ]);
  const { run, requests } = judgeRun([C, D], [["judge", { discard: { finished: [1], "out-of-scope": [2] } }]], protections);
  const output = await run;
  assert.equal(output.verdicts.size, 0);
  assert.deepEqual(judgeResult(requests[1]!).refused, [
    { entry: "discard.finished[0]", reason: "protected", ordinal: "r1", protection: "fact" },
    { entry: "discard.out-of-scope[0]", reason: "protected", ordinal: "r2", protection: "needed_later" },
  ]);
});

it("record_in_no_entry_stays_on_stm_surface", async () => {
  const { run, requests } = judgeRun([C, D, E], [["judge", { keep: [{ r: 2, reason: "later" }] }]]);
  const output = await run;
  assert.deepEqual([...output.verdicts.keys()], [D.id]);
  const answer = judgeResult(requests[1]!);
  assert.equal(answer.ok, true);
  assert.equal(answer.unjudged, 2);
});

it("judge_rejudged_records_take_keep_only", async () => {
  const old = record("999999999999", "A discarded path the new scope needs");
  const { run, requests } = judgeRun(
    [C],
    [["judge", { keep: [{ j: 1, reason: "the new scope reads it" }], discard: { finished: [1] } }]],
    new Map(),
    {
      rejudge: [old],
      ledger: {
        ...ledgerOf([C]),
        observations: [OUTSIDE, old, C],
        tombstones: { [old.id]: { reason: "finished", at: "2026-11-12T10:00:00.000Z" } },
      },
    },
  );
  const output = await run;
  assert.equal(output.verdicts.get(old.id)?.verdict, "keep");
  assert.equal(output.verdicts.get(C.id)?.verdict, "discard");
  assert.match(promptOf(requests[0]!), /\[j1\][^\n]*A discarded path/);
});

it("losing_format_absent_from_tree", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  // The four per-record WM tools (`keep`, `summarize`, `derive`, `discard`) lost to `judge` on the plan 218.2 Task 5
  // replay and were deleted with no alias: no definition, call or argument of theirs is left in the package source.
  const retired =
    /stmIds?\b|supportingIds|name: "(?:keep|summarize|derive|discard)"|toolCallContent\([^,]+, *"(?:keep|summarize|derive|discard)"|\["(?:keep|summarize|derive|discard)", *\{/;
  const hits: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const path = join(entry.parentPath, entry.name);
    if (path.endsWith("wm-judge.test.ts")) continue;
    const text = await readFile(path, "utf8");
    for (const [index, line] of text.split("\n").entries())
      if (retired.test(line)) hits.push(`${path.slice(root.length + 1)}:${index + 1}`);
  }
  assert.deepEqual(hits, []);
});
