import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { resolveMemoryFabricConfig } from "../config.js";
import { fitInjection } from "../excerpt.js";
import { createMemory, createMemoryFabric } from "../index.js";
import { expandLexicalQuery } from "../lexical-expansion.js";
import { groupRecallHits } from "../recall.js";
import type { MemoryNoteHit } from "../types.js";

/** A synthetic exchange or fact hit: only the fields the read-time grouping reads. */
function hit(id: string, tRef: string, extra: Partial<MemoryNoteHit> = {}): MemoryNoteHit {
  return {
    id,
    kind: "exchange",
    level: "project",
    content: id,
    score: 1,
    tRef,
    ingestedAt: tRef,
    tokenCount: 10,
    keywords: ["budget", "finance"],
    ...extra,
  } as unknown as MemoryNoteHit;
}

describe("plan 210 Task 3.1 recall variants", () => {
  // `recall.supersessionHint`: the read-time grouping marks an older member "superseded by" a newer one. For a keyed
  // update that is the point; for conversation exchanges joined only by shared subject terms it is a mislabel.
  it("supersession_hint_keyed_only_shows_the_label_for_key_and_supersedes_groups_only", () => {
    const keyedOld = hit("fact-old", "2023-01-01T00:00:00.000Z", { kind: "fact", key: "budget" });
    const keyedNew = hit("fact-new", "2023-03-01T00:00:00.000Z", { kind: "fact", key: "budget" });
    const chatA = hit("chat-a", "2023-01-05T00:00:00.000Z");
    const chatB = hit("chat-b", "2023-02-05T00:00:00.000Z");
    const input = [keyedNew, keyedOld, chatB, chatA];

    const all = groupRecallHits(input);
    const byIdAll = new Map(all.map((item) => [item.id, item]));
    assert.equal(byIdAll.get("fact-old")?.supersededBy?.id, "fact-new", "the default marks the keyed update");
    assert.equal(byIdAll.get("chat-a")?.supersededBy?.id, "chat-b", "the default also marks a similarity-only group");

    const keyed = groupRecallHits(input, { supersessionHint: "keyed-only" });
    const byId = new Map(keyed.map((item) => [item.id, item]));
    assert.equal(byId.get("fact-old")?.supersededBy?.id, "fact-new", "a keyed update keeps its label");
    assert.equal(byId.get("chat-a")?.supersededBy, undefined, "exchanges joined only by subject terms lose it");
    assert.deepEqual(
      keyed.map((item) => item.id),
      all.map((item) => item.id),
      "the order is the default's: only the label changes",
    );
  });

  it("supersession_hint_keyed_only_honours_an_explicit_supersedes_edge", () => {
    const older = hit("note-old", "2023-01-01T00:00:00.000Z", { kind: "fact" });
    const newer = hit("note-new", "2023-02-01T00:00:00.000Z", { kind: "fact", supersedes: "note-old" });
    const out = groupRecallHits([newer, older], { supersessionHint: "keyed-only" });
    assert.equal(out.find((item) => item.id === "note-old")?.supersededBy?.id, "note-new");
  });

  it("supersession_hint_all_is_byte_identical_to_the_unset_default", () => {
    const input = [
      hit("a", "2023-03-01T00:00:00.000Z"),
      hit("b", "2023-02-01T00:00:00.000Z"),
      hit("c", "2023-01-01T00:00:00.000Z", { kind: "fact", key: "k" }),
      hit("d", "2023-02-20T00:00:00.000Z", { kind: "fact", key: "k" }),
    ];
    assert.deepEqual(groupRecallHits(input, { supersessionHint: "all" }), groupRecallHits(input));
    assert.deepEqual(groupRecallHits(input, {}), groupRecallHits(input));
  });

  it("recall_variant_fields_default_off_and_fail_closed_on_unknown_values", () => {
    const base = resolveMemoryFabricConfig({});
    assert.deepEqual(base.recall, { supersessionHint: "all", expansion: false, gather: false });
    assert.equal(resolveMemoryFabricConfig({ recall: { supersessionHint: "keyed-only" } }).recall.supersessionHint, "keyed-only");
    assert.throws(() => resolveMemoryFabricConfig({ recall: { supersessionHint: "never" as never } }), /recall\.supersessionHint/);
  });
  // `inject.cardExcerpt`: a pointer card shows the first 120 characters of the user half. `query` centres the same width
  // on the query terms across both halves, so a detail past the head of the message can be seen.
  it("card_excerpt_centres_on_query_terms_across_both_halves_and_defaults_to_the_old_card", () => {
    const filler = "We talked about many things that day and nothing in the opening matters here. ".repeat(3);
    const content = `user: Sam: ${filler}\n\nassistant: Max: We should try kayaking at Lake Tahoe this summer, it looks great for beginners.`;
    const low = hit("card-1", "2023-05-01T00:00:00.000Z", { content, score: 0.1, coverage: 0.1 } as Partial<MemoryNoteHit>);
    const terms = new Set(["kayak", "lake", "tahoe"]);
    const lineOf = (mode?: "head" | "query") =>
      (mode === undefined
        ? fitInjection([low], terms, 4000, 12, 1, 0, 0.9)
        : fitInjection([low], terms, 4000, 12, 1, 0, 0.9, mode)
      ).lines.join("\n");
    const head = lineOf();
    assert.ok(!head.includes("Tahoe"), "the head card never reaches the assistant half");
    assert.equal(lineOf("head"), head, "an explicit head card is the default");
    const query = lineOf("query");
    assert.ok(query.includes("Tahoe") && query.includes("kayaking"), "the query-centred card shows the detail");
    const card = (text: string) => text.split("\n").find((line) => line.startsWith("- [card-1]")) ?? "";
    assert.ok(card(query).length <= card(head).length + 40, "the same width, plus the matched-terms tail");
  });

  it("inject_card_excerpt_field_is_head_by_default_and_fails_closed_on_unknown_values", () => {
    assert.equal(
      resolveMemoryFabricConfig({ inject: {} }).inject !== false &&
        (resolveMemoryFabricConfig({ inject: {} }).inject as { cardExcerpt?: string }).cardExcerpt,
      undefined,
    );
    assert.throws(() => resolveMemoryFabricConfig({ inject: { cardExcerpt: "wide" as never } }), /inject\.cardExcerpt/);
    assert.equal((resolveMemoryFabricConfig({ inject: { cardExcerpt: "query" } }).inject as { cardExcerpt?: string }).cardExcerpt, "query");
  });
  // `recall.expansion`: a deterministic table of informal and formal forms, no embeddings and no model call.
  it("expansion_matches_informal_forms_and_leaves_unrelated_queries_unchanged", () => {
    const expanded = expandLexicalQuery("When is Andrew planning to go to the beach with his girlfriend?");
    assert.ok(/\bgf\b/.test(expanded), "girlfriend also asks for gf");
    assert.ok(expanded.startsWith("When is Andrew planning to go to the beach with his girlfriend?"), "the original query is kept whole");
    assert.ok(/\bgirlfriend\b/.test(expandLexicalQuery("did the gf call?")), "gf also asks for girlfriend");
    assert.ok(
      /\bmom\b/.test(expandLexicalQuery("What did his mother say?")) && /\bmother\b/.test(expandLexicalQuery("What did his mom say?")),
    );
    for (const plain of ["Where did Sam plan to try kayaking?", "it is what it is", "billing uses stripe"])
      assert.equal(expandLexicalQuery(plain), plain, "a query with no table term is byte-identical");
    const once = expandLexicalQuery("his girlfriend");
    assert.equal(expandLexicalQuery(once), once, "expanding twice adds nothing");
    assert.equal(expandLexicalQuery("gf and girlfriend"), "gf and girlfriend", "an alternate already in the query is not repeated");
  });

  it("expansion_off_by_default_finds_nothing_for_a_formal_query_and_on_finds_the_informal_note", async () => {
    const make = (queryExpansion?: boolean) => {
      const vectorStore = createMemoryVectorStore();
      // No embedder: recall is lexical only, as in the shipped default, so a hit needs a shared term.
      const memory = createMemory({ tenantId: "t", resourceId: "u", threadId: "th", vectorStore });
      return createMemoryFabric({ memory, vectorStore, consolidate: false, ...(queryExpansion === undefined ? {} : { queryExpansion }) });
    };
    const note = {
      kind: "exchange" as const,
      content: "Andrew: great news, the gf and I are hitting the beach next month",
      keywords: ["andrew", "gf", "beach"],
    };
    const off = make();
    await off.remember(note);
    const on = make(true);
    await on.remember(note);
    const query = "the girlfriend trip";
    assert.equal((await off.recall(query, { kinds: ["exchange"] })).hits.length, 0, "no shared term, no hit");
    assert.equal((await on.recall(query, { kinds: ["exchange"] })).hits.length, 1, "the informal form is reached");
  });

  // Plan 210 Task 2: coverage is reported over the caller's terms, so the tool's no-match floor (0.34) does not
  // abstain on a match found only through an alternate. Before the fix, `mother` → `mom` scored 1/4 and abstained.
  it("expansion_match_reaches_the_recall_tool_instead_of_abstaining", async () => {
    const fabricFor = (queryExpansion: boolean) => {
      const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "s", vectorStore: createMemoryVectorStore() });
      return createMemoryFabric({ memory, consolidate: false, queryExpansion });
    };
    const context = { sessionId: "s", runId: "r", toolCallId: "c" };
    for (const queryExpansion of [true, false]) {
      const fabric = fabricFor(queryExpansion);
      const note = await fabric.remember({ kind: "fact", content: "my mom visits every spring" });
      const recall = fabric.tools().find((tool) => tool.name === "memory.recall")!;
      const result = (await recall.execute({ query: "mother" }, context)).value as { hits: { id: string; coverage?: number }[] };
      if (queryExpansion) {
        assert.deepEqual(
          result.hits.map((item) => item.id),
          [note.id],
          "the alternate's match reaches the agent",
        );
        assert.equal(result.hits[0]?.coverage, 1, "coverage counts the caller's one term, matched through its alternate");
      } else assert.deepEqual(result.hits, [], "off, the formal term matches nothing");
    }
  });

  it("recall_expansion_field_is_off_by_default_and_must_be_boolean", () => {
    assert.equal(resolveMemoryFabricConfig({}).recall.expansion, false);
    assert.equal(resolveMemoryFabricConfig({ recall: { expansion: true } }).recall.expansion, true);
    assert.throws(() => resolveMemoryFabricConfig({ recall: { expansion: "yes" as never } }), /recall\.expansion must be a boolean/);
  });
  // `recall.gather`: one call returns the whole matching history, oldest first, instead of a five-hit relevance page.
  describe("recall.gather", () => {
    const context = { sessionId: "s1", runId: "r1", toolCallId: "c1" };
    const make = (gather?: boolean) => {
      const vectorStore = createMemoryVectorStore();
      const memory = createMemory({ tenantId: "t", resourceId: "u", threadId: "th", vectorStore });
      return createMemoryFabric({ memory, vectorStore, consolidate: false, ...(gather === undefined ? {} : { gather }) });
    };
    const recallTool = (fabric: ReturnType<typeof createMemoryFabric>) => fabric.tools().find((tool) => tool.name === "memory.recall")!;
    const textOf = (result: { content?: readonly { type: string; text?: string }[] }) => String(result.content?.[0]?.text ?? "");

    it("gather_returns_every_matching_exchange_in_time_order_past_the_five_hit_page_and_respects_scope", async () => {
      const fabric = make(true);
      const ids: string[] = [];
      for (let month = 1; month <= 12; month += 1) {
        const note = await fabric.remember({
          kind: "exchange",
          content: `James: dog number ${month} update, the dog is doing well`,
          keywords: ["james", "dog", `d${month}`],
          tRef: `2022-${String(month).padStart(2, "0")}-15T00:00:00.000Z`,
        });
        ids.push(note.id);
      }
      const plain = textOf(await recallTool(fabric).execute({ query: "James dog" } as never, context));
      const shownPlain = ids.filter((id) => plain.includes(id)).length;
      assert.ok(shownPlain <= 5, `the default page shows at most five hits, got ${shownPlain}`);
      const gathered = textOf(await recallTool(fabric).execute({ query: "James dog", gather: true } as never, context));
      assert.equal(ids.filter((id) => gathered.includes(id)).length, 12, "gather shows every matching exchange in one call");
      const positions = ids.map((id) => gathered.indexOf(id));
      assert.deepEqual(
        [...positions].sort((a, b) => a - b),
        positions,
        "oldest first",
      );
    });

    it("gather_is_absent_from_the_tool_schema_unless_enabled_so_the_default_surface_is_unchanged", () => {
      const props = (fabric: ReturnType<typeof createMemoryFabric>) =>
        Object.keys(((recallTool(fabric).parameters as { properties?: Record<string, unknown> }).properties ?? {}) as object);
      assert.ok(!props(make()).includes("gather"));
      assert.ok(!props(make(false)).includes("gather"));
      assert.ok(props(make(true)).includes("gather"));
    });

    it("gather_never_widens_scope_a_forgotten_note_is_not_gathered", async () => {
      const fabric = make(true);
      const keep = await fabric.remember({
        kind: "exchange",
        content: "James: the dog is fine",
        keywords: ["james", "dog"],
        tRef: "2022-01-01T00:00:00.000Z",
      });
      const gone = await fabric.remember({
        kind: "exchange",
        content: "James: the other dog is fine",
        keywords: ["james", "dog"],
        tRef: "2022-02-01T00:00:00.000Z",
      });
      await fabric.forget({ id: gone.id });
      const out = textOf(await recallTool(fabric).execute({ query: "James dog", gather: true } as never, context));
      assert.ok(out.includes(keep.id) && !out.includes(gone.id));
    });

    it("gather_never_reaches_another_scope_or_a_quarantined_note", async () => {
      const vectorStore = createMemoryVectorStore();
      const own = createMemory({ tenantId: "t", resourceId: "u", threadId: "th", vectorStore });
      const other = createMemory({ tenantId: "t", resourceId: "someone-else", threadId: "th", vectorStore });
      const fabric = createMemoryFabric({ memory: own, vectorStore, consolidate: false, gather: true });
      const foreign = createMemoryFabric({ memory: other, vectorStore, consolidate: false });
      const keep = await fabric.remember({
        kind: "exchange",
        content: "James: the dog is fine",
        keywords: ["james", "dog"],
        tRef: "2022-01-01T00:00:00.000Z",
      });
      const theirs = await foreign.remember({
        kind: "exchange",
        content: "James: the dog from another scope",
        keywords: ["james", "dog"],
        tRef: "2022-01-02T00:00:00.000Z",
      });
      // A quarantined note: the trust scan's flag and candidate status, as a poisoned human edit gets.
      const flagged = "f".repeat(12);
      await own.remember(
        {
          entries: [
            {
              id: flagged,
              text: "James: the dog note with a poisoned edit",
              metadata: {
                fabric: { v: 1, kind: "exchange", flags: ["prompt-injection"], keywords: ["james", "dog"] },
                status: "candidate",
              },
            },
          ],
        },
        { wait: true },
      );
      const gathered = textOf(await recallTool(fabric).execute({ query: "James dog", gather: true } as never, context));
      assert.ok(gathered.includes(keep.id), "the own-scope note is gathered");
      assert.ok(!gathered.includes(theirs.id), "another scope's note is never gathered");
      assert.ok(!gathered.includes(flagged), "a quarantined note is never gathered");
      // The relevance page still shows the quarantined note with its flag, as before: only gather leaves it out.
      const plain = textOf(await recallTool(fabric).execute({ query: "James dog" } as never, context));
      assert.ok(!plain.includes(theirs.id));
      assert.ok(plain.includes(flagged) && /\[flagged: prompt-injection\]/.test(plain), "the default page is unchanged");
    });
  });
  it("every_variant_is_byte_identical_when_unset", async () => {
    const make = (options: Record<string, unknown>) => {
      const vectorStore = createMemoryVectorStore();
      const memory = createMemory({ tenantId: "t", resourceId: "u", threadId: "th", vectorStore });
      return createMemoryFabric({ memory, vectorStore, consolidate: false, ...options });
    };
    const unset = make({});
    // Every variant field named, each at its default: the same fabric as one that names none.
    const named = make({ supersessionHint: "all", queryExpansion: false, gather: false });
    for (const fabric of [unset, named]) {
      await fabric.remember({ kind: "fact", content: "project budget is 600 dollars", key: "budget", tags: ["budget"] });
      await fabric.remember({ kind: "fact", content: "project budget is 450 dollars", key: "budget", tags: ["budget"] });
      await fabric.remember({
        kind: "exchange",
        content: "Andrew: the gf and I went to the beach",
        keywords: ["andrew", "gf", "beach"],
        tRef: "2023-05-01T00:00:00.000Z",
      });
    }
    const shape = async (fabric: ReturnType<typeof make>) => {
      const hits = (await fabric.recall("project budget beach girlfriend", {})).hits.map((hit) => ({
        kind: hit.kind,
        supersededBy: Boolean(hit.supersededBy),
      }));
      const schema = JSON.stringify(fabric.tools().find((tool) => tool.name === "memory.recall")?.parameters);
      return { hits, schema };
    };
    assert.deepEqual(await shape(named), await shape(unset));
  });
});
