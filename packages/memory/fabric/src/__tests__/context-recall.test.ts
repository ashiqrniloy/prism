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

it("inject off makes no recall; working memory stays in the prefix", async () => {
  const h = harness();
  await h.memory.updateWorking({ preference: "concise" });
  const projection = createFabricContext(h.memory, async () => {
    throw new Error("unexpected recall");
  });
  const draft = await projection.build(h.draft, h.context);
  assert.equal(draft.context?.[0]?.metadata?.source, "fabric-working");
  assert.equal(draft.messages.length, 1);
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
  assert.deepEqual(first.messages[0], second.messages[0]);
  assert.match(JSON.stringify(first.messages[0]), /Cite the ids you use/);
  assert.equal(first.context, undefined);
  assert.equal(first.messages[1]?.role, "user");
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

it("the best matching note is injected even when it alone exceeds the snippet budget", async () => {
  const h = harness();
  const note = await h.fabric.remember({ kind: "fact", content: `long ${"fact ".repeat(400)}` });
  const projection = createFabricContext(h.memory, async () => ({ hits: [{ ...note, score: 1 }], explain: [] }), {
    budgetTokens: 20,
    topK: 1,
    kinds: ["fact"],
  });
  const result = await projection.build(h.draft, h.context);
  const tail = result.messages.find((message) => message.metadata?.contextBlocks);
  assert.ok(tail, "the best hit is not silently dropped by its own snippet cost");
  assert.match(JSON.stringify(tail), new RegExp(note.id));
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
