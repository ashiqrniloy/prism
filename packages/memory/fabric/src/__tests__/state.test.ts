import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type ModelClient, providerDone, providerTextDelta } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, parseMemoryNoteMetadata, resolveMemoryFabricConfig } from "../index.js";

const scope = { tenantId: "t", resourceId: "u", threadId: "th" };

function harness(client?: ModelClient) {
  const vectorStore = createMemoryVectorStore();
  const memory = createMemory({ ...scope, embedder: createHashEmbedder({ dimensions: 8 }), vectorStore });
  const fabric = createMemoryFabric({
    memory,
    vectorStore,
    consolidate: false,
    ...(client === undefined ? {} : { state: {}, resolveModelClient: () => client }),
  });
  return { fabric, memory };
}

function tool(fabric: ReturnType<typeof createMemoryFabric>, name: string) {
  const found = fabric.tools().find((candidate) => candidate.name === name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

function text(result: Awaited<ReturnType<ReturnType<typeof tool>["execute"]>>): string {
  const block = result.content?.[0];
  assert.equal(block?.type, "text");
  return (block as { text: string }).text;
}

const context = { sessionId: "s1", runId: "r1", toolCallId: "c1" };

describe("read-time current state (plan 202 Task 7)", () => {
  it("recall_groups_same_subject_newest_first", async () => {
    const { fabric } = harness();
    const older = await fabric.remember({
      kind: "fact",
      content: "project budget is 600 dollars",
      key: "project-budget",
      tRef: "2026-03-10T00:00:00.000Z",
    });
    const newer = await fabric.remember({
      kind: "fact",
      content: "project budget is 450 dollars",
      key: "project-budget",
      tRef: "2026-05-02T00:00:00.000Z",
    });

    const result = await fabric.recall("budget", { kinds: ["fact"] });
    assert.deepEqual(
      result.hits.map((hit) => hit.id),
      [newer.id, older.id],
    );
    assert.equal(result.hits[0]?.supersededBy, undefined);
    assert.deepEqual(result.hits[1]?.supersededBy, { id: newer.id, at: "2026-05-02T00:00:00.000Z" });
  });

  it("supersession_marker_is_a_hint_and_deletes_nothing", async () => {
    const { fabric, memory } = harness();
    const older = await fabric.remember({
      kind: "fact",
      content: "deploy target is staging",
      key: "deploy-target",
      tRef: "2026-03-10T00:00:00.000Z",
    });
    const newer = await fabric.remember({
      kind: "fact",
      content: "deploy target is production",
      key: "deploy-target",
      tRef: "2026-05-02T00:00:00.000Z",
    });
    const output = await tool(fabric, "memory.recall").execute({ query: "deploy target", kinds: ["fact"] }, context);
    assert.match(text(output), new RegExp(`superseded by ${newer.id} on 2026-05-02\\?`));
    assert.ok(text(output).includes(older.id));
    const stored = await memory.getEntry(older.id);
    assert.ok(stored);
    assert.equal(parseMemoryNoteMetadata(stored.metadata)?.status, undefined, "the hint never archives the older note");
  });

  it("exchange_subject_terms_group_without_touching_unrelated_turns", async () => {
    const { fabric } = harness();
    const older = await fabric.remember({
      kind: "exchange",
      content: "I set the kitchen budget to 600 for the renovation",
      keywords: ["budget", "finance", "kitchen"],
      tRef: "2026-03-10T00:00:00.000Z",
    });
    const newer = await fabric.remember({
      kind: "exchange",
      content: "The kitchen budget is now 450 for the renovation",
      keywords: ["budget", "finance", "kitchen"],
      tRef: "2026-05-02T00:00:00.000Z",
    });
    const other = await fabric.remember({
      kind: "exchange",
      content: "My flight to Lisbon is booked",
      keywords: ["travel", "lisbon", "flight"],
      tRef: "2026-04-01T00:00:00.000Z",
    });

    const result = await fabric.recall("kitchen budget", { kinds: ["exchange"] });
    assert.deepEqual(
      result.hits.map((hit) => hit.id),
      [newer.id, older.id],
    );
    assert.equal(result.hits[1]?.supersededBy?.id, newer.id);
    const unrelated = await fabric.recall("flight lisbon", { kinds: ["exchange"] });
    assert.deepEqual(
      unrelated.hits.map((hit) => hit.id),
      [other.id],
      "an unrelated exchange is not pulled into the group",
    );
    assert.equal(unrelated.hits[0]?.supersededBy, undefined);
  });

  it("state_opt_in_makes_one_call_and_cites_ids", async () => {
    let calls = 0;
    let prompt = "";
    let newerId = "";
    const client: ModelClient = {
      model: { provider: "test", model: "state" },
      async *generate(request) {
        calls += 1;
        prompt = request.messages
          .flatMap((message) => message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])))
          .join("\n");
        yield providerTextDelta(`| budget | $450 | [${newerId}] |`);
        yield providerDone();
      },
    };
    const { fabric } = harness(client);
    await fabric.remember({
      kind: "fact",
      content: "budget is 600 dollars",
      key: "budget",
      tRef: "2026-03-10T00:00:00.000Z",
    });
    const newer = await fabric.remember({
      kind: "fact",
      content: "budget is 450 dollars",
      key: "budget",
      tRef: "2026-05-02T00:00:00.000Z",
    });
    newerId = newer.id;
    const recall = tool(fabric, "memory.recall");
    const output = await recall.execute({ query: "budget", kinds: ["fact"] }, context);
    assert.equal(calls, 1);
    assert.ok(prompt.length <= 8_000, `state input stayed within the 2k-token estimate (${prompt.length} chars)`);
    assert.ok(prompt.indexOf(newerId) < prompt.indexOf("600 dollars"), "the state prompt shows the current value first");
    assert.match(text(output), /Current state/);
    assert.ok(text(output).includes(`[${newerId}]`));
    assert.equal((output.value as { state?: string }).state?.includes(newerId), true);
    await recall.execute({ query: "budget", kinds: ["fact"] }, context);
    assert.equal(calls, 2, "each explicit recall makes exactly one state call");
  });

  it("preset_has_no_state_call", () => {
    const resolved = resolveMemoryFabricConfig({ preset: "conversational" });
    assert.equal(resolved.state, false);
    assert.equal(resolveMemoryFabricConfig({}).state, false);
    assert.deepEqual(resolveMemoryFabricConfig({ state: {} }).state, {});
    assert.deepEqual(resolveMemoryFabricConfig({ state: { model: "test/state" } }).state, { model: "test/state" });
  });
});
