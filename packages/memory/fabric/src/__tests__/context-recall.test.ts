import { it } from "bun:test";
import assert from "node:assert/strict";
import type { ContextDraft, HookContext, SessionEntry } from "@arnilo/prism";
import { createHashEmbedder } from "@arnilo/prism-memory-core";
import { createFabricContext, recallPeriod } from "../context.js";
import { createMemory, createMemoryFabric } from "../index.js";

const user = (id: string): SessionEntry => ({
  id,
  sessionId: "s",
  kind: "message",
  timestamp: "2026-10-17T12:00:00Z",
  message: { role: "user", content: [{ type: "text", text: "question" }] },
});
function harness() {
  let entries: SessionEntry[] = [user("u1")];
  const context = {
    runId: "",
    sessionId: "s",
    session: { id: "s", entries: async () => entries },
    emit() {},
    reject() {},
  } as unknown as HookContext;
  const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "s", embedder: createHashEmbedder() });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const draft: ContextDraft = { messages: [user("u1").message!] };
  return {
    context,
    memory,
    fabric,
    draft,
    entries,
    setEntries(next: SessionEntry[]) {
      entries = next;
    },
  };
}

it("inject off makes no recall; working memory follows the transcript", async () => {
  const h = harness();
  await h.memory.updateWorking({ preference: "concise" });
  const projection = createFabricContext(h.memory, async () => {
    throw new Error("unexpected recall");
  });
  const draft = await projection.build(h.draft, h.context);
  assert.match(JSON.stringify(draft.messages.at(-1)?.metadata), /fabric-working/);
  assert.equal(draft.messages.length, 2);
});

it("semantic tail is computed once including empty results, and resets for new persisted user entries", async () => {
  const h = harness();
  const note = await h.fabric.remember({ kind: "fact", content: "helpful memory" });
  let calls = 0;
  const projection = createFabricContext(
    h.memory,
    async () => {
      calls++;
      return { hits: [{ ...note, score: 1, similarity: 1 }], explain: [] };
    },
    {},
  );
  const first = await projection.build(h.draft, h.context);
  const second = await projection.build(
    { ...h.draft, messages: [...h.draft.messages, { role: "assistant", content: [{ type: "text", text: "tool round" }] }] },
    h.context,
  );
  assert.equal(calls, 1);
  assert.deepEqual(first.messages.at(-1), second.messages.at(-1));
  assert.match(JSON.stringify(first.messages.at(-1)), /Cite the ids you use/);
  assert.equal(first.context, undefined);
  assert.equal(first.messages[0]?.role, "user");
  h.setEntries([user("steer")]);
  await projection.build(h.draft, h.context);
  assert.equal(calls, 2);
  h.setEntries([{ ...user("compacted"), kind: "compaction", message: undefined }]);
  const compacted = await projection.build(h.draft, h.context);
  assert.equal(compacted.messages.length, 1);
  let emptyCalls = 0;
  const empty = createFabricContext(
    h.memory,
    async () => {
      emptyCalls++;
      return { hits: [], explain: [] };
    },
    {},
  );
  h.setEntries([user("u2")]);
  await empty.build(h.draft, h.context);
  await empty.build(h.draft, h.context);
  assert.equal(emptyCalls, 1);
});

it("task query includes OM state and persisted todo metadata after folding", async () => {
  const h = harness();
  h.entries.push({
    id: "state",
    sessionId: "s",
    timestamp: "2026-10-17T12:00:00Z",
    kind: "custom",
    data: { type: "om.task_state.recorded", taskState: { id: "aaaaaaaaaaaa", goal: "fix retry budget", sourceEntryIds: ["u1"] } },
  });
  h.entries.push({ ...user("plan"), message: { role: "tool", content: [], metadata: { todos: [{ content: "ship patch" }] } } });
  let query = "";
  const projection = createFabricContext(
    h.memory,
    async (q) => {
      query = q;
      return { hits: [], explain: [] };
    },
    {},
  );
  await projection.build(h.draft, h.context);
  assert.match(query, /question/);
  assert.match(query, /fix retry budget/);
  assert.match(query, /ship patch/);
});

it("relative dates become validity and reference windows", () => {
  const period = recallPeriod("what did we decide last week", "2026-10-17T12:00:00Z");
  assert.deepEqual(period.options.tRef, { from: "2026-10-05T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" });
  assert.doesNotMatch(period.text, /last week/);
  assert.deepEqual(recallPeriod("in March", "2026-10-17T12:00:00Z").options.tRef, {
    from: "2026-03-01T00:00:00.000Z",
    to: "2026-04-01T00:00:00.000Z",
  });
});

it("defaults_inject_evidence_sized_whole_notes", async () => {
  const h = harness();
  // No budget/topK configured: the opted-in default delivers up to 12 whole notes.
  const notes = await Promise.all(
    Array.from({ length: 14 }, (_, index) => h.fabric.remember({ kind: "fact", content: `harbour note ${index}` })),
  );
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
    { query: "user" },
    { query: "harbour" },
  );
  const { lines } = semanticBlock(await projection.build(h.draft, h.context));
  assert.equal(lines.length, 13, "twelve whole notes and the preamble");
  assert.equal(
    injected(
      lines,
      notes.map((note) => note.id),
    ).length,
    12,
  );
});

it("over_budget_best_hit_is_excerpted_within_budget", async () => {
  const h = harness();
  const note = await h.fabric.remember({ kind: "fact", content: `long ${"fact ".repeat(600)}` });
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: [{ ...note, score: 1 }], explain: [] }),
    { budgetTokens: 600, topK: 1, kinds: ["fact"], query: "user" },
    { query: "fact" },
  );
  const result = await projection.build(h.draft, h.context);
  const { lines } = semanticBlock(result);
  assert.equal(lines.length, 2, "the best hit is shown, alone");
  assert.match(lines[1]!, new RegExp(note.id));
  assert.match(lines[1]!, /memory\.read /, "the excerpt names the read call");
  assert.ok(Math.ceil(lines.join("\n").length / 4) <= 600, "the best hit is cut down to the budget, not past it");
  // Plan 188.9 Task 6: the id the marker names is a real `memory.read` argument, and it returns the note whole.
  const read = h.fabric.tools().find((tool) => tool.name === "memory.read");
  assert.ok(read, "memory.read exists");
  const readResult = await read.execute({ id: note.id }, { sessionId: "s", runId: "r", toolCallId: "c" } as never);
  assert.equal((readResult.value as { notes: Array<{ content: string }> }).notes[0]?.content, note.content);
});

it("dedup refills topK and citations touch only injected used ids", async () => {
  const h = harness();
  const notes = await Promise.all(
    ["om", "source", "file", "use", "uncited"].map((content) =>
      h.fabric.remember({
        kind: content === "file" ? "file" : "fact",
        content,
        ...(content === "file" ? { path: "doc.md" } : {}),
        ...(content === "source" ? { sourceEntryIds: ["u1"] } : {}),
      }),
    ),
  );
  const projection = createFabricContext(h.memory, async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }), {
    topK: 2,
  });
  const result = await projection.build(
    {
      context: [{ content: "om", metadata: { source: "om", itemIds: [notes[0]!.id] } }],
      messages: [
        { ...h.draft.messages[0]!, id: "u1" },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "r1", name: "read", result: { path: "doc.md", text: "file" } }] },
      ],
    },
    h.context,
  );
  const tail = result.messages.find((message) => message.metadata?.contextBlocks);
  assert.match(JSON.stringify(tail), new RegExp(notes[3]!.id));
  assert.match(JSON.stringify(tail), new RegExp(notes[4]!.id));
  for (const note of notes.slice(0, 3)) assert.doesNotMatch(JSON.stringify(tail), new RegExp(note.id));
  h.entries.push({
    ...user("answer"),
    message: { role: "assistant", content: [{ type: "text", text: `Used [${notes[3]!.id}] and [${notes[0]!.id}]` }] },
  });
  projection.observe({ type: "text", text: `Used [${notes[3]!.id.slice(0, 5)}` }, h.context);
  projection.observe({ type: "text", text: `${notes[3]!.id.slice(5)}] and [${notes[0]!.id}]` }, h.context);
  await h.memory.touch(projection.cited(h.context));
  assert.ok((await h.memory.getEntry(notes[3]!.id))?.lastAccessedAt);
  assert.equal((await h.memory.getEntry(notes[4]!.id))?.lastAccessedAt, undefined);
  assert.equal((await h.memory.getEntry(notes[0]!.id))?.lastAccessedAt, undefined);
});

it("passive injection excludes procedures, superseded rows, and low cosines", async () => {
  const h = harness();
  await h.fabric.remember({ kind: "procedure", content: "question" });
  await h.fabric.remember({ kind: "fact", content: "question", validTo: "2020-01-01T00:00:00Z" });
  await h.fabric.remember({ kind: "fact", content: "unrelated" });
  const result = await createFabricContext(h.memory, h.fabric.recall, { minSimilarity: 0.99 }).build(h.draft, h.context);
  assert.equal(result.messages.length, 1);
});

it("iso_datetime_is_never_a_one_day_period", () => {
  const text = "2023-05-30T23:40:00.000Z what did I buy";
  const period = recallPeriod(text, "2026-10-17T12:00:00Z");
  assert.equal(period.options.tRef, undefined);
  assert.equal(period.text, text);
});

/** The semantic block's content lines and metadata, as the model would read them. */
function semanticBlock(result: ContextDraft) {
  const tail = result.messages.find((message) => message.metadata?.contextBlocks);
  const metadata = ((tail?.metadata?.contextBlocks ?? []) as Record<string, unknown>[]).find((block) => block.source === "fabric-semantic");
  assert.ok(tail && metadata, "semantic block present");
  const text = tail.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const content = text.slice(text.indexOf("Semantic memory:\n") + "Semantic memory:\n".length);
  return { lines: content.split("\n- ").map((line, index) => (index === 0 ? line : `- ${line}`)), metadata };
}
const filler = (word: string, count: number) => Array.from({ length: count }, (_, i) => `${word}${i}`).join(" ");
const injected = (lines: readonly string[], ids: readonly string[]) =>
  ids.filter((id) => lines.some((line) => line.startsWith(`- [${id}]`)));

it("later_hits_fill_whole_until_budget_and_skip_without_truncating", async () => {
  const h = harness();
  // The best hit is short; the second cannot fit whole in what remains and is skipped, not cut; the
  // third is short enough that filling continues past the skipped note.
  const best = await h.fabric.remember({ kind: "fact", content: `best harbour note ${filler("keep", 10)}` });
  const huge = await h.fabric.remember({ kind: "fact", content: `${filler("huge", 400)} harbour` });
  const small = await h.fabric.remember({ kind: "fact", content: "small harbour follow-up" });
  const notes = [best, huge, small];
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
    {
      budgetTokens: 600,
      topK: 3,
      query: "user",
    },
    { query: "harbour" },
  );
  const { lines, metadata } = semanticBlock(await projection.build(h.draft, h.context));
  assert.deepEqual(
    injected(
      lines,
      notes.map((note) => note.id),
    ),
    [best.id, small.id],
  );
  const rendered = lines.find((line) => line.startsWith(`- [${huge.id}]`));
  assert.equal(rendered, undefined, "an over-budget later hit is skipped");
  assert.ok(!lines.some((line) => line.includes(`memory.read ${huge.id}`)), "and it is not excerpted either");
  // The partial-selection cue lands after the last note; the note itself is whole, not truncated.
  assert.match(
    lines.find((line) => line.startsWith(`- [${small.id}]`))!,
    /small harbour follow-up(\nShowing \d+ of 3 matching notes\.|$)/,
    "whole, not truncated",
  );
  assert.ok(Math.ceil(lines.join("\n").length / 4) <= 600, "the block fits the budget");
  assert.equal(metadata.untrusted, true);
});

it("shown_hits_render_chronologically_selection_unchanged", async () => {
  const h = harness();
  const [first, second, third] = await Promise.all(
    ["alpha", "beta", "gamma"].map((word) => h.fabric.remember({ kind: "fact", content: `${word} harbour` })),
  );
  // Rank order is first, second, third; delivery order is by tRef else ingestedAt.
  const hits = [
    { ...first, score: 1, ingestedAt: "2026-03-01T00:00:00.000Z" },
    { ...second, score: 1, ingestedAt: "2026-01-01T00:00:00.000Z" },
    { ...third, score: 1, ingestedAt: "2026-05-01T00:00:00.000Z", tRef: "2026-02-01T00:00:00.000Z" },
  ];
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits, explain: [] }),
    { budgetTokens: 600, topK: 3, query: "user" },
    { query: "harbour" },
  );
  const { lines, metadata } = semanticBlock(await projection.build(h.draft, h.context));
  const delivered = lines.slice(1).map((line) => /^- \[([^\]]+)\]/.exec(line)![1]!);
  assert.deepEqual(delivered, [second.id, third.id, first.id], "oldest first, so the newest value is read last");
  assert.deepEqual(metadata.itemIds, delivered, "selection is reported in delivery order");
  assert.match(lines[1]!, /2026-01-01/, "each hit keeps its date header");
  assert.match(lines[2]!, /2026-05-01/);
  assert.equal(delivered.length, 3, "all selected hits survive");
  // Selection is still by rank; skipping and back-filling are covered by the whole-fill test above.
});

it("excerpt_contains_the_densest_matched_window", async () => {
  const h = harness();
  // One stray early match, then the dense span mid-note: head truncation and first-match windows both miss it.
  // The long note is the best hit, so it is the hit that is excerpted when it exceeds the budget.
  const long = await h.fabric.remember({
    kind: "fact",
    content: `lantern ${filler("pad", 200)} the lantern ferry timetable changed to the lantern ferry winter timetable ${filler("tail", 200)}`,
  });
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: [{ ...long, score: 1 }], explain: [] }),
    {
      budgetTokens: 300,
      topK: 2,
      query: "user",
    },
    { query: "lantern ferry timetable" },
  );
  const { lines } = semanticBlock(await projection.build(h.draft, h.context));
  const line = lines.find((candidate) => candidate.startsWith(`- [${long.id}]`));
  assert.ok(line, "the long note is injected");
  assert.match(line, /the lantern ferry timetable changed to the lantern ferry winter timetable/);
  assert.doesNotMatch(line, /pad0 /, "not head-truncated");
  assert.match(line, new RegExp(`memory\\.read ${long.id}`), "the excerpt names the id to read in full");
});

it("short_note_renders_whole_and_unchanged", async () => {
  const h = harness();
  const note = await h.fabric.remember({ kind: "fact", content: "short whole note" });
  const projection = createFabricContext(h.memory, async () => ({ hits: [{ ...note, score: 1 }], explain: [] }), { topK: 3 });
  const { lines } = semanticBlock(await projection.build(h.draft, h.context));
  assert.deepEqual(lines, [
    "Cite the ids you use as [id].",
    `- [${note.id}] project fact (${note.ingestedAt.slice(0, 10)}) short whole note`,
  ]);
});

it("excerpt_never_crosses_notes_or_drops_the_untrusted_envelope", async () => {
  const h = harness();
  const notes = await Promise.all(
    ["red", "green", "blue"].map((word) =>
      h.fabric.remember({ kind: "fact", content: `${filler(word, 300)} signal ${filler(word, 300)}` }),
    ),
  );
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
    {
      budgetTokens: 600,
      topK: 3,
      query: "user",
    },
    { query: "signal" },
  );
  const { lines, metadata } = semanticBlock(await projection.build(h.draft, h.context));
  assert.deepEqual(
    { untrusted: metadata.untrusted, inert: metadata.inert, injectionCapable: metadata.injectionCapable },
    { untrusted: true, inert: true, injectionCapable: true },
  );
  for (const [index, note] of notes.entries()) {
    const line = lines.find((candidate) => candidate.startsWith(`- [${note.id}]`));
    if (!line) continue;
    for (const other of notes.filter((_, j) => j !== index))
      assert.doesNotMatch(line, new RegExp(["red", "green", "blue"][notes.indexOf(other)]!));
  }
});

it("injection_never_exceeds_budget", async () => {
  const h = harness();
  const sizes = [40, 900, 3000, 120, 2200, 600];
  const notes = await Promise.all(
    sizes.map((size, i) => h.fabric.remember({ kind: "fact", content: `note${i} river ${"x".repeat(size)}` })),
  );
  for (const topK of [1, 2, 3, 5]) {
    for (const budgetTokens of [60, 200, 600, 1200]) {
      const projection = createFabricContext(
        h.memory,
        async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
        {
          budgetTokens,
          topK,
          query: "user",
        },
        { query: "river" },
      );
      const { lines } = semanticBlock(
        await projection.build(h.draft, {
          ...h.context,
          session: { id: `s-${topK}-${budgetTokens}`, entries: async () => h.entries },
        } as unknown as HookContext),
      );
      const tokens = Math.ceil(lines.join("\n").length / 4);
      assert.ok(lines.filter((line) => line.startsWith("- [")).length <= topK);
      assert.ok(tokens <= budgetTokens, `topK ${topK} budget ${budgetTokens}: ${tokens} tokens over ${lines.length - 1} hits`);
    }
  }
  // No exception: a best hit larger than the whole budget is excerpted down to it, alone.
  const big = await h.fabric.remember({ kind: "fact", content: `river ${"y".repeat(4000)}` });
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: [big, ...notes].map((note) => ({ ...note, score: 1 })), explain: [] }),
    {
      budgetTokens: 600,
      topK: 3,
      query: "user",
    },
    { query: "river" },
  );
  const { lines } = semanticBlock(await projection.build(h.draft, h.context));
  assert.equal(lines.length, 2, "the best hit is shown, alone");
  assert.match(lines[1]!, /memory\.read /, "the over-budget best hit is excerpted");
  assert.ok(Math.ceil(lines.join("\n").length / 4) <= 600, "and stays inside the budget");
});

/** The raw semantic block text, so a cue line is read as its own line rather than folded into a note. */
function tailText(result: ContextDraft): string {
  const tail = result.messages.find((message) => message.metadata?.contextBlocks);
  assert.ok(tail, "semantic block present");
  return tail.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

const TOOL_CUE =
  "To list, count or compare across past conversations, call memory.recall with several phrasings (queries) and memory.read the ids you need.";

it("partial_selection_cue_states_shown_of_eligible", async () => {
  const h = harness();
  const notes = await Promise.all(
    ["alpha", "beta", "gamma", "delta"].map((word) => h.fabric.remember({ kind: "fact", content: `${word} river ${"x".repeat(40)}` })),
  );
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
    { budgetTokens: 4000, topK: 2, query: "user" },
    { query: "river" },
  );
  const lines = tailText(await projection.build(h.draft, h.context)).split("\n");
  assert.equal(lines.filter((line) => line.startsWith("- [")).length, 2);
  assert.equal(lines.at(-1), `Showing 2 of 4 matching notes. ${TOOL_CUE}`);
  // A host without tools still reads a coherent line, and no benchmark term leaks into the product.
  assert.doesNotMatch(lines.at(-1)!, /longmemeval|haystack|benchmark|screen|gold/i);
});

it("cue_states_shown_of_eligible_and_names_the_tools", async () => {
  const h = harness();
  const notes = await Promise.all(
    Array.from({ length: 5 }, (_, i) => h.fabric.remember({ kind: "fact", content: `note${i} river ${"x".repeat(30)}` })),
  );
  const projection = createFabricContext(
    h.memory,
    async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
    { budgetTokens: 4000, topK: 3, query: "user" },
    { query: "river" },
  );
  const cue = tailText(await projection.build(h.draft, h.context))
    .split("\n")
    .at(-1)!;
  assert.match(cue, /^Showing 3 of 5 matching notes\./);
  // The sentence is unconditional: per-run tool visibility is not visible to the package.
  assert.match(cue, /memory\.recall with several phrasings \(queries\)/);
  assert.match(cue, /memory\.read the ids you need/);
  assert.deepEqual(
    tailText(await projection.build(h.draft, h.context))
      .split("\n")
      .at(-1),
    cue,
    "a rebuild of the same turn repeats the cue byte for byte",
  );
});

it("cue_absent_when_all_eligible_shown_or_inject_off", async () => {
  const h = harness();
  const notes = await Promise.all(["one", "two"].map((word) => h.fabric.remember({ kind: "fact", content: `${word} river` })));
  const shown = createFabricContext(
    h.memory,
    async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
    { budgetTokens: 4000, topK: 12, query: "user" },
    { query: "river" },
  );
  assert.doesNotMatch(tailText(await shown.build(h.draft, h.context)), /Showing \d+ of/);
  // Injection off: no block at all, so no cue either.
  const off = createFabricContext(h.memory, async () => {
    throw new Error("unexpected recall");
  });
  const draft = await off.build(h.draft, h.context);
  assert.equal(draft.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(draft), /Showing \d+ of/);
});

it("injection_with_cue_never_exceeds_budget", async () => {
  const h = harness();
  const notes = await Promise.all(
    Array.from({ length: 6 }, (_, i) => h.fabric.remember({ kind: "fact", content: `note${i} river ${"y".repeat(120 * (i + 1))}` })),
  );
  for (const topK of [1, 2, 4]) {
    for (const budgetTokens of [80, 200, 600]) {
      const projection = createFabricContext(
        h.memory,
        async () => ({ hits: notes.map((note) => ({ ...note, score: 1 })), explain: [] }),
        { budgetTokens, topK, query: "user" },
        { query: "river" },
      );
      const lines = tailText(
        await projection.build(h.draft, {
          ...h.context,
          session: { id: `cue-${topK}-${budgetTokens}`, entries: async () => h.entries },
        } as unknown as HookContext),
      ).split("\n");
      const cue = lines.find((line) => line.startsWith("Showing "));
      assert.ok(Math.ceil(lines.join("\n").length / 4) <= budgetTokens, "the cue counts inside the budget");
      if (cue !== undefined) assert.ok(Math.ceil(cue.length / 4) <= 44, `cue costs ${Math.ceil(cue.length / 4)} tokens`);
      assert.ok(lines.filter((line) => line.startsWith("- [")).length <= topK);
    }
  }
});

it("an excerpt survives a matched token wider than its window", async () => {
  const { queryExcerpt } = await import("../excerpt.js");
  const token = `a${"b".repeat(300)}`;
  const text = queryExcerpt(`head ${token} tail ${"pad ".repeat(100)}`, new Set([token]), 200);
  assert.ok(text.length <= 200);
  assert.match(text, /^…?b+/);
});
