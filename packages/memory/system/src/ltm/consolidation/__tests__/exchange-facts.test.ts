/**
 * Plan 188.9 Task 8: the general-purpose extractor, facts linked to their archived exchanges.
 *
 * Every test drives the real pass with a scripted extractor: no live model call runs here.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonObject } from "@arnilo/prism";
import {
  createSessionEntry,
  type ModelClient,
  type ProviderRequest,
  providerDone,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { fitInjection } from "../../excerpt.js";
import { createMemory, createLongTermMemory, type MemoryFabric, parseMemoryNoteMetadata } from "../../../index.js";
import { resolvePromoteConfig } from "../../promote.js";
import type { MemoryNoteHit } from "../../types.js";
import { CONSOLIDATION_EXTRACT_SYSTEM, CONSOLIDATION_EXTRACT_SYSTEM_PROJECT, EXTRACT_NOTE_KINDS } from "../prompts.js";

const COFFEE = "The user's coffee brand is Stumptown.";
const COFFEE_LATER = "The user's coffee brand is La Cabra.";
const DATE = "2026-01-01T00:00:00.000Z";

function userEntry(id: string, text: string): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    timestamp: DATE,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

/** Notes the scripted extractor returns; the prompts it was sent are recorded for inspection. */
function extractor(notes: readonly JsonObject[], seen: { prompts: string[]; system: string[] } = { prompts: [], system: [] }) {
  const client: ModelClient = {
    model: { provider: "test", model: "extractor" },
    async *generate(request: ProviderRequest) {
      seen.system.push(
        request.messages
          .filter((message) => message.role === "system")
          .flatMap((message) => message.content.filter((block) => block.type === "text").map((block) => block.text))
          .join("\n"),
      );
      seen.prompts.push(
        request.messages
          .filter((message) => message.role === "user")
          .flatMap((message) => message.content.filter((block) => block.type === "text").map((block) => block.text))
          .join("\n"),
      );
      yield providerToolCall(toolCallContent("n1", "record_notes", { notes: [...notes] }));
      yield providerDone();
    },
  };
  return { client, seen };
}

function memory() {
  return createMemory({
    tenantId: "t1",
    resourceId: "projects/demo--01234567",
    threadId: "default",
    vectorStore: createMemoryVectorStore(),
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
}

function fabricFor(
  store: ReturnType<typeof memory>,
  client: ModelClient,
  options: { maxCandidates?: number; repositoryRules?: boolean; exchanges?: boolean; projectOnly?: boolean } = {},
) {
  return createLongTermMemory({
    memory: store,
    ...(options.projectOnly === true ? { scopes: [{ level: "project", memory: store }] } : {}),
    promote: resolvePromoteConfig({
      minTurnsBetween: 1,
      derivableFrom: [],
      ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
    }),
    promoteRoot: "/nonexistent-prism-promote-root",
    exchanges: { enabled: options.exchanges !== false },
    ...(options.repositoryRules === true ? { repositoryRules: true } : {}),
    resolveModelClient: () => client,
  });
}

/** One archived exchange note, written the way the archive writes it. */
async function archive(fabric: MemoryFabric, content: string, tRef = DATE): Promise<string> {
  const note = await fabric.remember({ kind: "exchange", content, scope: "project", tRef }, { generatedBy: "host" });
  return note.id;
}

function fact(overrides: JsonObject = {}): JsonObject {
  return {
    text: COFFEE,
    kind: "fact",
    scope: "project",
    keywords: ["coffee"],
    aliases: [],
    evidence: ["c1"],
    explicit: true,
    correction: false,
    generality: 1,
    ephemerality: 0,
    derivable: false,
    tRef: DATE,
    key: "coffee.brand",
    ...overrides,
  };
}

function hit(partial: Pick<MemoryNoteHit, "id" | "kind" | "content" | "tRef">): MemoryNoteHit {
  return {
    level: "project",
    ingestedAt: DATE,
    tokenCount: 10,
    score: 1,
    ...partial,
  };
}

describe("general-purpose consolidation extractor (plan 188.9 Task 8)", () => {
  it("coding_prompt_keeps_repository_rules_and_general_prompt_omits_them", () => {
    assert.ok(CONSOLIDATION_EXTRACT_SYSTEM_PROJECT.includes("Do not record what the repository already records"));
    assert.ok(CONSOLIDATION_EXTRACT_SYSTEM_PROJECT.includes("AGENTS.md"));
    assert.equal(CONSOLIDATION_EXTRACT_SYSTEM.includes("AGENTS.md"), false);
    assert.equal(CONSOLIDATION_EXTRACT_SYSTEM.includes("Do not record what the repository"), false);
    for (const prompt of [CONSOLIDATION_EXTRACT_SYSTEM, CONSOLIDATION_EXTRACT_SYSTEM_PROJECT]) {
      assert.ok(prompt.includes("You consolidate an agent's session"));
      assert.ok(prompt.includes("possessions, events, dates, counts, names, plans and changed values"));
      assert.ok(prompt.includes("tRef:"));
      assert.ok(prompt.includes("key: only for a changeable attribute"));
    }
    assert.deepEqual([...EXTRACT_NOTE_KINDS], ["fact", "procedure", "preference", "episode"], "the kinds are unchanged");
  });

  it("exchange_candidates_are_gathered_bounded_and_marked_consolidated", async () => {
    const { client, seen } = extractor([fact()]);
    const store = memory();
    const fabric = fabricFor(store, client, { maxCandidates: 3 });
    await archive(fabric, COFFEE);
    await archive(fabric, "The user plans a trip to Lisbon.");
    await archive(fabric, "The user's cat is called Miso.");
    const session = {
      id: "s1",
      entries: async () => [userEntry("e1", "Remember: my coffee brand is Stumptown, and I plan a trip to Lisbon.")],
    };
    const first = await fabric.consolidate(session);
    assert.equal(first.ran, true);

    const candidates = (
      JSON.parse(seen.prompts[0]!) as {
        candidates: { id: string; text: string; source: string; tRef?: string }[];
      }
    ).candidates;
    const exchanges = candidates.filter((candidate) => candidate.source === "exchange");
    assert.equal(exchanges.length, 2, "maxCandidates bounds the gathered exchanges");
    assert.ok(exchanges.every((candidate) => candidate.tRef === DATE));
    assert.deepEqual(
      exchanges.map((candidate) => candidate.text).sort(),
      [COFFEE, "The user plans a trip to Lisbon."].sort(),
      "the gathered candidates are the archived exchanges",
    );
    assert.ok(
      exchanges.every((candidate) => candidate.id.startsWith("c")),
      "the extractor cites positional ids",
    );

    await fabric.consolidate(session);
    const second = (JSON.parse(seen.prompts[1]!) as { candidates: { source: string; text: string }[] }).candidates;
    const reread = second.filter((candidate) => candidate.source === "exchange").map((candidate) => candidate.text);
    assert.deepEqual(reread, ["The user's cat is called Miso."], "a read exchange is gathered once; an unread one still arrives");
  });

  it("extracted_fact_links_to_its_exchange_and_carries_tref_and_key", async () => {
    const { client } = extractor([fact()]);
    const store = memory();
    const fabric = fabricFor(store, client);
    const exchangeId = await archive(fabric, COFFEE);
    const result = await fabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });
    assert.equal(result.report?.written, 1);

    const recalled = await fabric.recall(COFFEE, { kinds: ["fact"], minSimilarity: 0 });
    assert.equal(recalled.hits.length, 1);
    const note = recalled.hits[0]!;
    assert.equal(note.tRef, DATE);
    assert.equal(note.key, "coffee.brand");
    assert.deepEqual(note.links, [{ id: exchangeId, relation: "evidence" }]);
    assert.equal((note.sourceEntryIds ?? []).includes(exchangeId), false, "an exchange is linked, not a transcript entry");

    const stored = (await store.get([exchangeId]))[0]!;
    assert.equal(parseMemoryNoteMetadata(stored.metadata)?.consolidatedAt !== undefined, true);
  });

  it("consolidation_runs_with_user_and_agent_scopes_disabled", async () => {
    // Plan 188.9 Task 9: the benchmark runs one project scope with user and agent off. Existing-note
    // gathering used to throw `scope user is not active` before any model call, and an extracted
    // user-scope note would have taken the whole pass down with it.
    const { client } = extractor([fact({ scope: "user" })]);
    const store = memory();
    const fabric = fabricFor(store, client, { projectOnly: true });
    await archive(fabric, COFFEE);
    const result = await fabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });
    assert.equal(result.report?.modelCalls, 1, "the extractor ran instead of failing on an inactive scope");
    assert.equal(result.report?.written, 1);
    const [note] = (await fabric.recall(COFFEE, { kinds: ["fact"], minSimilarity: 0 })).hits;
    assert.ok(note);
    assert.equal(note.level, "project", "a note for a disabled scope lands in the active project scope");
  });

  /**
   * Plan 188.10 Task 6: aggregation needs instances and attributes kept apart. The rules live in the
   * prompt only — no new note kind, no new schema field — so this pins the wording both prompts share.
   */
  it("prompt_states_instance_and_attribute_key_rules", () => {
    for (const prompt of [CONSOLIDATION_EXTRACT_SYSTEM, CONSOLIDATION_EXTRACT_SYSTEM_PROJECT]) {
      assert.ok(prompt.includes("One fact per instance."), "an instance is its own note");
      assert.ok(prompt.includes("Never give two instances the same key"), "a key is for a changeable attribute");
      assert.ok(prompt.includes("the bikes themselves are instances"), "a stated count stays an attribute");
      assert.ok(prompt.includes("2-4 generic category words"), "category keywords");
      assert.ok(prompt.includes("an event with no time of its own takes the date of the candidate"), "dated events");
    }
  });

  it("two_unkeyed_instances_both_stay_active", async () => {
    const { key: _unused, ...visit } = fact({
      text: "The user saw a dermatologist, Dr. Patel, about a rash.",
      tRef: "2023-04-02T00:00:00.000Z",
      keywords: ["doctor", "health", "appointment"],
      aliases: ["dermatologist", "Dr. Patel"],
    });
    const second = { ...visit, text: "The user saw a cardiologist, Dr. Ruiz, about chest pain.", tRef: "2023-07-19T00:00:00.000Z" };
    const { client } = extractor([visit, second]);
    const store = memory();
    const fabric = fabricFor(store, client);
    await archive(fabric, "The user saw two doctors this year.");
    const first = await fabric.consolidate({
      id: "s1",
      entries: async () => [userEntry("e1", "I saw Dr. Patel in April and Dr. Ruiz in July.")],
    });
    assert.equal(first.report?.written, 2, "two instances, two notes");

    const shown = (await fabric.recall("doctor appointment health", { kinds: ["fact"], minSimilarity: 0, topK: 10 })).hits;
    assert.equal(shown.length, 2, "both instances stay active");
    for (const candidate of shown) {
      const row = (await store.get([candidate.id]))[0]!;
      assert.equal(parseMemoryNoteMetadata(row.metadata)?.validTo, undefined, "neither instance was retired");
    }
  });

  it("category_keyword_reaches_fact_phrased_differently", async () => {
    const note = fact({
      text: "The user saw a dermatologist about a rash.",
      keywords: ["doctor", "health", "appointment"],
      aliases: ["dermatologist"],
    });
    const { client } = extractor([note]);
    const store = memory();
    const fabric = fabricFor(store, client);
    await archive(fabric, "The user saw a dermatologist about a rash.");
    await fabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "I saw a dermatologist about a rash.")] });

    const hits = (await fabric.recall("what doctors did I see", { kinds: ["fact"], minSimilarity: 0, topK: 5 })).hits;
    assert.equal(hits[0]?.content, "The user saw a dermatologist about a rash.", "a generic category word reaches the specific fact");
  });

  it("later_value_supersedes_by_key", async () => {
    const { client } = extractor([fact()]);
    const store = memory();
    const fabric = fabricFor(store, client);
    await archive(fabric, COFFEE);
    await fabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });
    const before = (await fabric.recall("coffee brand", { kinds: ["fact"], minSimilarity: 0 })).hits[0]!;

    const later = extractor([fact({ text: COFFEE_LATER, tRef: "2026-02-01T00:00:00.000Z" })]);
    const second = fabricFor(store, later.client);
    await archive(second, COFFEE_LATER, "2026-02-01T00:00:00.000Z");
    await second.consolidate({ id: "s2", entries: async () => [userEntry("e2", "Actually my coffee brand is La Cabra now.")] });

    const current = await second.recall("coffee brand", { kinds: ["fact"], minSimilarity: 0 });
    assert.equal(current.hits.length, 1, "one current value for the key");
    assert.equal(current.hits[0]!.content, COFFEE_LATER);
    const old = (await store.get([before.id]))[0]!;
    const oldMetadata = parseMemoryNoteMetadata(old.metadata);
    assert.ok(oldMetadata !== undefined && (oldMetadata.validTo !== undefined || oldMetadata.status === "archived"));
  });

  it("fact_hit_expands_to_linked_exchange_only_when_exchange_is_requested", async () => {
    const { client } = extractor([fact()]);
    const store = memory();
    const fabric = fabricFor(store, client);
    const exchangeId = await archive(fabric, COFFEE);
    await fabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });

    const both = await fabric.recall("coffee brand", { kinds: ["fact", "exchange"], minSimilarity: 0, topK: 10 });
    assert.ok(
      both.hits.some((candidate) => candidate.id === exchangeId),
      "the linked exchange is returned",
    );
    const factOnly = await fabric.recall("coffee brand", { kinds: ["fact"], minSimilarity: 0, topK: 10 });
    assert.equal(
      factOnly.hits.some((candidate) => candidate.id === exchangeId),
      false,
      "link expansion keeps only requested kinds",
    );
  });

  it("passive_delivery_is_facts_first_then_exchanges_each_in_time_order", () => {
    const delivered = fitInjection(
      [
        hit({ id: "a".repeat(12), kind: "exchange", content: COFFEE_LATER, tRef: "2026-02-01T00:00:00.000Z" }),
        hit({ id: "b".repeat(12), kind: "fact", content: COFFEE, tRef: DATE }),
        hit({ id: "c".repeat(12), kind: "exchange", content: COFFEE, tRef: DATE }),
      ],
      new Set<string>(),
      4000,
      12,
    );
    assert.deepEqual(
      delivered.hits.map((candidate) => candidate.kind),
      ["fact", "exchange", "exchange"],
    );
    assert.deepEqual(
      delivered.hits.slice(1).map((candidate) => candidate.tRef),
      [DATE, "2026-02-01T00:00:00.000Z"],
    );
  });

  it("invented_evidence_id_is_rejected", async () => {
    const { client } = extractor([fact({ evidence: ["c99"] })]);
    const store = memory();
    const fabric = fabricFor(store, client);
    await archive(fabric, COFFEE);
    const failed = await fabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });
    assert.equal(failed.reason, "failed");
    assert.equal(failed.reasonCode, "evidence_not_shown", "an invented id fails the pass by code");
    assert.equal((await fabric.recall(COFFEE, { kinds: ["fact"], minSimilarity: 0 })).hits.length, 0);
  });

  it("repository_rules_reach_the_extractor_only_with_a_project_root", async () => {
    const project = extractor([fact()]);
    const projectFabric = fabricFor(memory(), project.client, { repositoryRules: true });
    await archive(projectFabric, COFFEE);
    await projectFabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });
    assert.ok(project.seen.system[0]!.includes("AGENTS.md"), "a project root keeps the repository rules");

    const general = extractor([fact()]);
    const generalFabric = fabricFor(memory(), general.client);
    await archive(generalFabric, COFFEE);
    await generalFabric.consolidate({ id: "s1", entries: async () => [userEntry("e1", "My coffee brand is Stumptown.")] });
    assert.equal(general.seen.system[0]!.includes("AGENTS.md"), false, "no project root means the domain-neutral prompt");
  });
});
