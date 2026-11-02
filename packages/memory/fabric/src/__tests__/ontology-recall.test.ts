/**
 * Plan 207 Task 4: concepts first, then drill down — recall, read, cues and sharing.
 */
import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextDraft, HookContext, JsonObject, SessionEntry, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createMemoryVectorStore, type Memory, type MemoryVectorRecord } from "@arnilo/prism-memory-core";
import { createFabricContext, createFabricCitationTracker } from "../context.js";
import { createFabricDirectory, DEFAULT_DIRECTORY_OPTIONS, renderFabricDirectory } from "../directory.js";
import { createFabricTeam, resolveFabricTeamOptions, TEAM_RESOURCE, TEAM_TENANT } from "../delivery/team.js";
import { createMemory, createMemoryFabric, createFabricOntology, parseMemoryNoteMetadata } from "../index.js";
import { createFabricLifecycle } from "../lifecycle/index.js";
import { conceptInPlay } from "../ontology/pointer.js";
import { renderConceptClaims, renderConceptRead, resolveConceptPrior, resolveMaxClaimsRendered } from "../ontology/render.js";
import { encodeMemoryNoteMetadata, MEMORY_NOTE_METADATA_KEY } from "../types.js";

const PROJECT = "projects/demo--01234567";
const toolContext: ToolExecutionContext = { sessionId: "s1", runId: "r1", toolCallId: "c1" };

function memoryFor(vectorStore: ReturnType<typeof createMemoryVectorStore>, resourceId = PROJECT): Memory {
  // No embedder: lexical retrieval, so a query that shares words with a note finds it deterministically.
  return createMemory({ tenantId: "prism", resourceId, threadId: "default", vectorStore });
}

interface Options {
  readonly ontology?: { conceptPrior?: number; maxClaimsRendered?: number } | false;
  readonly team?: ReturnType<typeof createMemory>;
}

function setup(options: Options = {}) {
  const vectorStore = createMemoryVectorStore();
  const memory = memoryFor(vectorStore);
  const ontology = createFabricOntology({ scopes: [{ level: "project", memory }], store: vectorStore });
  const tracker = createFabricCitationTracker();
  const fabric = createMemoryFabric({
    memory,
    vectorStore,
    consolidate: false,
    subjects: ontology.subjects,
    ...(options.ontology === false ? {} : { ontology: options.ontology ?? {} }),
    ...(options.team === undefined ? {} : { readOnlyScopes: [{ level: "team" as const, memory: options.team }] }),
  });
  return { vectorStore, memory, ontology, port: ontology.port, fabric, tracker };
}

type Env = ReturnType<typeof setup>;

async function tool(fabric: Env["fabric"], name: string): Promise<ToolDefinition> {
  const found = fabric.tools({}).find((candidate) => candidate.name === name);
  assert.ok(found, `missing ${name}`);
  return found;
}

async function run(definition: ToolDefinition, args: JsonObject): Promise<ToolResult> {
  return await definition.execute(args, toolContext);
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

/** Two evidence notes, one unrelated pattern note, and a `payments` concept citing the first two. */
async function seeded(env: Env) {
  const a = await env.fabric.remember({ kind: "fact", content: "Billing retries use exponential backoff capped at three attempts." });
  const b = await env.fabric.remember({ kind: "fact", content: "Billing inputs are validated with zod rather than yup." });
  await env.port.applyConceptEdits(
    "project",
    [
      { op: "create_subject", subject: "billing", title: "Billing service", conceptType: "entity", aliases: ["payments"] },
      { op: "add_claim", subject: "billing", text: "Retries use exponential backoff capped at three attempts.", cites: [a.id] },
      { op: "add_claim", subject: "billing", text: "Inputs are validated with zod, not yup.", cites: [b.id] },
    ],
    { generatedBy: "consolidation" },
  );
  const [subject] = await env.port.subjects("project");
  assert.ok(subject);
  return { a, b, conceptId: subject.conceptId };
}

describe("concept-first recall", () => {
  it("concept_outranks_its_evidence_but_not_a_better_note", async () => {
    const env = setup();
    const { a, conceptId } = await seeded(env);
    const result = await env.fabric.recall("billing retries exponential backoff");
    const order = result.hits.map((hit) => hit.id);
    assert.ok(order.includes(conceptId), "a concept is part of the default recall");
    assert.ok(order.indexOf(conceptId) < order.indexOf(a.id), "the concept ranks ahead of the note it cites");

    // A note that matches the query far better than the concept still wins: the prior is bounded.
    const exact = await env.fabric.remember({ kind: "fact", content: "zebra quartz marimba orchid lantern" });
    const better = await env.fabric.recall("zebra quartz marimba orchid lantern");
    assert.equal(better.hits[0]?.id, exact.id);

    // The prior is tuning: the same concept scores exactly `conceptPrior` higher than with the prior at 0.
    const flat = setup({ ontology: { conceptPrior: 0 } });
    const seed = await seeded(flat);
    const query = "billing retries exponential backoff";
    const lifted = (await env.fabric.recall(query)).hits.find((hit) => hit.id === conceptId)!;
    const plain = (await flat.fabric.recall(query)).hits.find((hit) => hit.id === seed.conceptId)!;
    assert.ok(Math.abs(lifted.score - plain.score - 0.1) < 1e-9, `lift ${lifted.score - plain.score}`);
    assert.equal(resolveConceptPrior(undefined), 0.1);
    assert.throws(() => resolveConceptPrior(0.9));
    assert.throws(() => resolveMaxClaimsRendered(0));
  });

  it("recall_renders_claims_with_cited_ids_and_drill_down_line", async () => {
    const env = setup();
    const { a, b, conceptId } = await seeded(env);
    const recall = await tool(env.fabric, "memory.recall");
    const result = await run(recall, { query: "billing retries backoff zod" });
    const text = textOf(result);
    assert.match(text, new RegExp(`\\[${conceptId}\\] project concept billing \\d{4}-\\d{2}-\\d{2}`));
    assert.match(text, new RegExp(`\\[c1\\] Retries use exponential backoff capped at three attempts\\. ← ${a.id}`));
    assert.match(text, new RegExp(`\\[c2\\] Inputs are validated with zod, not yup\\. ← ${b.id}`));
    assert.match(text, new RegExp(`drill down: memory.read \\{ ids: \\["${a.id}", "${b.id}"\\] \\}`));
    assert.doesNotMatch(text, /\(stale\)/);

    // memory.read of the concept returns the whole body with claim ids; reading the cited ids returns the notes.
    const read = await tool(env.fabric, "memory.read");
    const whole = await run(read, { id: conceptId });
    assert.match(textOf(whole), /- \[c1\] Retries use exponential backoff capped at three attempts\.\[\^[0-9a-f]{12}\]/);
    const evidence = await run(read, { ids: [a.id, b.id] });
    assert.match(textOf(evidence), /exponential backoff/);

    // maxClaimsRendered is the tuning cap, and the claims shown are the ones that overlap the query.
    const capped = setup({ ontology: { maxClaimsRendered: 1 } });
    await seeded(capped);
    const cappedText = textOf(await run(await tool(capped.fabric, "memory.recall"), { query: "validated zod yup" }));
    assert.match(cappedText, /\[c2\] Inputs are validated/);
    assert.doesNotMatch(cappedText, /\[c1\]/);
  });

  it("uncovered_pattern_returns_as_note_in_same_call", async () => {
    const env = setup();
    await seeded(env);
    await env.fabric.remember({ kind: "fact", content: "Staging deploys run nightly at two in the morning." });
    const text = textOf(await run(await tool(env.fabric, "memory.recall"), { queries: ["nightly staging deploys", "billing retries"] }));
    assert.match(text, /concept billing/, "the concept is in the result");
    assert.match(text, /\[fact\][^\n]*Staging deploys run nightly/, "the uncovered pattern is a plain note in the same call");
  });

  it("stale_claims_never_in_recall_or_passive", async () => {
    const env = setup();
    const { b, conceptId } = await seeded(env);
    // Flag the note c2 cites: the cascade marks the claim stale.
    await env.memory.patchMetadata(b.id, (metadata) => ({
      ...metadata,
      fabric: encodeMemoryNoteMetadata({ ...parseMemoryNoteMetadata(metadata)!, flags: ["prompt-injection"] }),
      status: "candidate",
    }));
    const recalled = textOf(await run(await tool(env.fabric, "memory.recall"), { query: "billing zod yup retries" }));
    assert.doesNotMatch(recalled, /\[c2\]/, "a stale claim is not rendered in recall");
    assert.match(recalled, /\[c1\] Retries use exponential backoff/, "the current claim still is");

    // memory.read labels the stale claim instead of hiding it.
    const read = textOf(await run(await tool(env.fabric, "memory.read"), { id: conceptId }));
    assert.match(read, /validated with zod, not yup\. \(stale\)/);
  });

  it("an_unreadable_citation_drops_the_claim_even_when_the_cascade_did_not_run", async () => {
    const env = setup();
    const { a, conceptId } = await seeded(env);
    // Delete the cited note straight from the store: no retraction event, so no cascade (another process's edit).
    await env.vectorStore.delete({ tenantId: "prism", resourceId: PROJECT, ids: [a.id] });
    const text = textOf(await run(await tool(env.fabric, "memory.recall"), { query: "billing retries backoff zod" }));
    assert.match(text, new RegExp(conceptId));
    assert.doesNotMatch(text, /\[c1\]/, "a claim whose citation is not readable is not delivered");
    assert.match(text, /\[c2\] Inputs are validated with zod/);
  });

  it("flagged_concept_never_delivered", async () => {
    const env = setup();
    const { conceptId } = await seeded(env);
    await env.memory.patchMetadata(conceptId, (metadata) => ({
      ...metadata,
      fabric: encodeMemoryNoteMetadata({ ...parseMemoryNoteMetadata(metadata)!, flags: ["prompt-injection"] }),
    }));
    const text = textOf(await run(await tool(env.fabric, "memory.recall"), { query: "billing retries backoff zod" }));
    assert.match(text, /\[flagged: prompt-injection\]/);
    assert.doesNotMatch(text, /\[c1\]|\[c2\]/, "no claim of a flagged concept is rendered");
    assert.doesNotMatch(text, /drill down/);
  });

  it("without_the_ontology_option_a_named_concept_is_refused_and_all_leaves_it_out", async () => {
    const env = setup({ ontology: false });
    await seeded(env);
    const recall = await tool(env.fabric, "memory.recall");
    const refused = await run(recall, { query: "billing", kinds: ["concept"] });
    assert.deepEqual(refused.value, { found: false, reason: "concept_requires_ontology" });
    const all = textOf(await run(recall, { query: "billing retries backoff", kinds: ["all"] }));
    assert.doesNotMatch(all, /concept billing/);
    const kinds = (((recall.parameters ?? {}).properties as JsonObject).kinds as { items: { enum: string[] } }).items.enum;
    assert.ok(!kinds.includes("concept"));

    const on = setup();
    const onKinds = (((await tool(on.fabric, "memory.recall")).parameters ?? {}).properties as JsonObject).kinds as {
      items: { enum: string[] };
    };
    assert.ok(onKinds.items.enum.includes("concept"));
  });
});

describe("renderers", () => {
  const body = [
    "# Billing",
    "",
    "- [c1] Retries use backoff.[^aaaaaaaaaaaa]",
    "- [c2] Inputs use zod.[^bbbbbbbbbbbb][^cccccccccccc]",
    "- [c3] A person wrote this.",
    "",
  ].join("\n");

  it("claims_pick_by_overlap_skip_stale_and_label_uncited", () => {
    const render = renderConceptClaims("dddddddddddd", { text: body, stale: ["c2"], queryTerms: new Set(["person"]), max: 2 });
    assert.deepEqual(render.claims, 2);
    assert.match(render.lines.join("\n"), /\[c3\] A person wrote this\. \(uncited, human\)/);
    assert.doesNotMatch(render.lines.join("\n"), /zod/);
    assert.deepEqual(render.cited, ["aaaaaaaaaaaa"]);
    // A broken body is never delivered.
    assert.match(
      renderConceptClaims("dddddddddddd", { text: "free text", stale: [], queryTerms: new Set(), max: 3 }).lines[0]!,
      /no current claims/,
    );
    assert.match(renderConceptRead(body, ["c1"]), /\[c1\] Retries use backoff\. \(stale\)/);
  });

  it("passive_pointer_needs_a_name_in_the_turn_or_a_touched_path", () => {
    const hit = { subject: "billing-api", title: "Billing API", aliases: ["payments"], appliesTo: ["services/billing/**"] };
    assert.equal(conceptInPlay(hit, new Set(["unrelated"]), []), false);
    assert.equal(conceptInPlay(hit, new Set(["payment"]), []), true, "an alias in the turn (stemmed)");
    assert.equal(conceptInPlay(hit, new Set(["bill", "api"]), []), true, "the slug as words");
    assert.equal(conceptInPlay({ ...hit, aliases: [] }, new Set(["x"]), ["services/billing/index.ts"]), true, "a touched path");
  });
});

describe("passive delivery", () => {
  function projection(env: Env, inject: Parameters<typeof createFabricContext>[2] = { minSimilarity: 0 }) {
    const entries: SessionEntry[] = [
      {
        id: "u1",
        sessionId: "s",
        kind: "message",
        timestamp: "2026-11-02T12:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "billing retries" }] },
      } as SessionEntry,
    ];
    const context = {
      runId: "",
      sessionId: "s",
      session: { id: "s", entries: async () => entries },
      emit() {},
      reject() {},
    } as unknown as HookContext;
    const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "billing retries" }] }] };
    return {
      build: () => createFabricContext(env.memory, env.fabric.recall, inject, {}).build(draft, context),
    };
  }

  it("concept_never_in_pinned_core_and_pointer_only_in_tail", async () => {
    const env = setup();
    const { conceptId } = await seeded(env);
    const built = await projection(env).build();
    const text = JSON.stringify(built.messages);
    assert.match(text, new RegExp(`- \\[${conceptId}\\] concept billing — memory.read ${conceptId}`), "one pointer line");
    assert.doesNotMatch(text, /exponential backoff capped at three attempts\.\s*←/, "no claim text of the concept");
    assert.ok(!JSON.stringify(built.context ?? []).includes(conceptId), "a concept is never in the pinned prefix");
    assert.equal((text.match(/concept billing/g) ?? []).length, 1, "at most one concept per turn");
  });
});

describe("path cue", () => {
  it("a_path_cue_shows_one_concept_as_a_pointer_without_its_claims", async () => {
    const env = setup();
    const a = await env.fabric.remember({ kind: "fact", content: "The ledger package stores every posting once." });
    await env.port.applyConceptEdits(
      "project",
      [
        { op: "create_subject", subject: "ledger", title: "Ledger", conceptType: "topic", appliesTo: ["packages/ledger/**"] },
        { op: "add_claim", subject: "ledger", text: "Postings are stored once.", cites: [a.id] },
      ],
      { generatedBy: "consolidation" },
    );
    const { createFabricCues, resolveFabricCuesOptions } = await import("../delivery/cues.js");
    const cues = createFabricCues({
      memory: env.memory,
      options: resolveFabricCuesOptions(true, true) as Exclude<ReturnType<typeof resolveFabricCuesOptions>, false>,
      scanMetadata: (query) => env.vectorStore.scanMetadata!(query),
      state: { get: () => undefined, set: async () => {} },
    });
    const session = { id: "s" } as unknown as HookContext["session"];
    const block = await cues.render(session!, ["packages/ledger/src/post.ts"], { turnKey: "t1" });
    assert.ok(block);
    assert.equal(block.lines.length, 1);
    assert.match(block.lines[0]!, /concept ledger \(for packages\/ledger\/\*\*\) — memory\.read [0-9a-f]{12}/);
    assert.doesNotMatch(block.lines[0]!, /Postings/);

    // The passive tail already carries this turn's concept: a path cue adds none.
    const again = createFabricCues({
      memory: env.memory,
      options: resolveFabricCuesOptions(true, true) as Exclude<ReturnType<typeof resolveFabricCuesOptions>, false>,
      scanMetadata: (query) => env.vectorStore.scanMetadata!(query),
      state: { get: () => undefined, set: async () => {} },
    });
    assert.equal(await again.render(session!, ["packages/ledger/src/other.ts"], { turnKey: "t1", conceptTaken: true }), undefined);
  });
});

describe("co-read and uses", () => {
  it("co_read_event_records_ids_only_for_notes_read_and_used_together", async () => {
    const env = setup();
    const { a, b, conceptId } = await seeded(env);
    const lone = await env.fabric.remember({ kind: "fact", content: "An unrelated note that is read alone." });
    const tracker = env.tracker;
    // The model receives a, b and the lone note, then cites a and b in one answering turn and the lone note in another.
    tracker.show("s", [a.id, b.id, lone.id, conceptId]);
    tracker.observe("s", `The retries [${a.id}] and validation [${b.id}] are described together with [${conceptId}].`);
    const turn = tracker.takeCoRead("s");
    assert.deepEqual(turn && [...turn.ids].sort(), [a.id, b.id, conceptId].sort());
    assert.equal(turn?.turn, 0);
    tracker.observe("s", `Separately [${lone.id}].`);
    assert.equal(tracker.takeCoRead("s"), undefined, "one cited note is not a co-read");

    const lifecycle = createFabricLifecycle(env.memory);
    const recorded = await lifecycle.recordCoReads([turn!], { clock: 4 });
    assert.equal(recorded, 2, "only the two evidence notes record it; the concept takes no part");
    const noteA = parseMemoryNoteMetadata((await env.memory.getEntry(a.id))?.metadata);
    assert.deepEqual(noteA?.coRead, [{ s: 4, t: 0, with: [b.id] }]);
    assert.equal(parseMemoryNoteMetadata((await env.memory.getEntry(conceptId))?.metadata)?.coRead, undefined);
    assert.equal(parseMemoryNoteMetadata((await env.memory.getEntry(lone.id))?.metadata)?.coRead, undefined);
    // Ids and indexes only: no text was stored with it.
    const raw = JSON.stringify((await env.memory.getEntry(a.id))?.metadata?.[MEMORY_NOTE_METADATA_KEY]);
    assert.match(raw, /"coRead":\[\{"s":4,"t":0,"with":\["[0-9a-f]{12}"\]\}\]/);

    // memory.read joins the shown set, so a note read and then cited counts toward the co-read.
    tracker.received("s2", [a.id, b.id]);
    tracker.observe("s2", `[${a.id}] [${b.id}]`);
    assert.equal(tracker.takeCoRead("s2")?.ids.length, 2);
  });

  it("recording_a_use_refreshes_the_concept_row_so_the_directory_order_follows", async () => {
    const env = setup();
    const { conceptId } = await seeded(env);
    const a2 = await env.fabric.remember({ kind: "fact", content: "Ledger postings are append only." });
    await env.port.applyConceptEdits(
      "project",
      [
        { op: "create_subject", subject: "ledger", title: "Ledger", conceptType: "topic" },
        { op: "add_claim", subject: "ledger", text: "Postings are append only.", cites: [a2.id] },
      ],
      { generatedBy: "consolidation" },
    );
    assert.deepEqual(
      (await env.ontology.subjects.listing("project")).map((row) => row.subject),
      ["billing", "ledger"],
    );
    const ledgerId = (await env.port.subjects("project")).find((row) => row.subject === "ledger")!.conceptId;
    await createFabricLifecycle(env.memory).recordUses("session-1", [ledgerId], { clock: 1 });
    // The index row is stale until it is refreshed: this is the path index.ts runs after recordUses.
    assert.equal((await env.ontology.subjects.listing("project"))[0]?.subject, "billing");
    await env.ontology.refresh([ledgerId]);
    assert.equal((await env.ontology.subjects.listing("project"))[0]?.subject, "ledger", "the used concept now leads");
    const directory = createFabricDirectory({
      memory: env.memory,
      concepts: (level, signal) => env.ontology.subjects.listing(level as "project", signal),
    });
    const rendered = renderFabricDirectory(await directory.snapshot(), DEFAULT_DIRECTORY_OPTIONS);
    assert.match(rendered?.content ?? "", /subjects: ledger, billing/);
    void conceptId;
  });
});

describe("sharing and shadowing", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
  });

  async function openTeam() {
    const root = await mkdtemp(join(tmpdir(), "concept-team-"));
    dirs.push(root);
    const teamDir = join(root, "project", ".prism", "memory");
    await mkdir(teamDir, { recursive: true });
    await mkdir(join(root, "index"), { recursive: true });
    const resolved = resolveFabricTeamOptions({ dir: ".prism/memory" }, join(root, "project"));
    if (resolved === false) throw new Error("team did not resolve");
    return await createFabricTeam({ options: resolved, index: join(root, "index", "team.sqlite") });
  }

  it("share_concept_requires_confirmation_and_never_copies_evidence", async () => {
    const env = setup();
    const { a, b, conceptId } = await seeded(env);
    // A stale claim and an open question about private evidence stay home.
    await env.port.applyConceptEdits(
      "project",
      [{ op: "add_open_question", subject: "billing", text: "Whether refunds share the budget.", cites: [a.id] }],
      { generatedBy: "consolidation" },
    );
    const team = await openTeam();
    let asked = "";
    const denied = await team.share({
      id: conceptId,
      source: env.memory,
      approve: async (request) => ((asked = request.detail), "denied"),
    });
    assert.equal(denied.ok, false);
    assert.match(asked, /Shares 2 citation id\(s\) without the cited notes/);
    assert.equal((await team.memory.get([conceptId])).length, 0, "a denial writes nothing");
    const unavailable = await team.share({ id: conceptId, source: env.memory, approve: async () => "unavailable" });
    assert.deepEqual(unavailable.ok === false && unavailable.reason, "host_unavailable");

    const approved = await team.share({ id: conceptId, source: env.memory, approve: async () => "approved" });
    assert.ok(approved.ok);
    const [shared] = await team.memory.get([approved.id]);
    assert.ok(shared);
    const note = parseMemoryNoteMetadata(shared.metadata);
    assert.equal(note?.kind, "concept");
    assert.equal(note?.scope, "team");
    assert.equal(note?.subject, "billing");
    assert.deepEqual([...(note?.sources ?? [])].sort(), [a.id, b.id].sort(), "citations stay as provenance");
    assert.equal(note?.links, undefined);
    assert.doesNotMatch(shared.text, /refunds/, "open questions about private evidence are not shared");
    // The cited notes themselves were not copied.
    assert.equal((await team.memory.get([a.id, b.id])).length, 0);
    assert.equal(shared.metadata?.status, undefined);

    // A second share replaces the team's concept for the subject instead of adding a duplicate.
    await env.port.applyConceptEdits(
      "project",
      [{ op: "add_claim", subject: "billing", text: "Refunds follow their own budget.", cites: [b.id] }],
      { generatedBy: "consolidation" },
    );
    const again = await team.share({ id: conceptId, source: env.memory, approve: async () => "approved" });
    assert.ok(again.ok);
    assert.equal(again.id, approved.id, "one concept per subject in the team store");
    assert.match((await team.memory.get([approved.id]))[0]?.text ?? "", /Refunds follow/);

    // A concept with no current claim is refused.
    const empty = await team.share({ id: "ffffffffffff", source: env.memory, approve: async () => "approved" });
    assert.equal(empty.ok === false && empty.reason, "not_found");
    await team.close();
  });

  it("private_concept_shadows_team_concept_by_subject", async () => {
    const env0 = setup();
    const { conceptId } = await seeded(env0);
    const team = await openTeam();
    const shared = await team.share({ id: conceptId, source: env0.memory, approve: async () => "approved" });
    assert.ok(shared.ok);

    // A fabric over the team store alone sees the team concept, rendered with its claims.
    const teamOnly = setup({ team: team.memory });
    const teamRecall = await teamOnly.fabric.recall("billing retries backoff");
    const teamHit = teamRecall.hits.find((hit) => hit.id === shared.id);
    assert.equal(teamHit?.level, "team");
    const teamText = textOf(await run(await tool(teamOnly.fabric, "memory.recall"), { query: "billing retries backoff" }));
    assert.match(teamText, /team concept billing/);
    assert.match(teamText, /exponential backoff/, "a team concept's claims stand on the share, not on private evidence");
    assert.match(teamText, /drill down: memory.read \{ id: /, "its cited notes are not in the team store");

    // The same fabric with its own private concept for the subject: the private one wins.
    const both = setup({ team: team.memory });
    const own = await seeded(both);
    const result = await both.fabric.recall("billing retries backoff");
    const concepts = result.hits.filter((hit) => hit.kind === "concept");
    assert.deepEqual(
      concepts.map((hit) => hit.id),
      [own.conceptId],
    );
    assert.ok(result.explain.some((row) => row.id === shared.id && row.shadowedBy === own.conceptId));
    await team.close();
  });

  it("a_shared_team_note_still_refuses_other_kinds", async () => {
    const env = setup();
    const note = await env.fabric.remember({ kind: "decision", content: "Use zod.", rationale: "one validator" } as never);
    const team = await openTeam();
    const result = await team.share({ id: note.id, source: env.memory, approve: async () => "approved" });
    assert.equal(result.ok === false && result.reason, "not_shareable");
    await team.close();
  });
});

void TEAM_RESOURCE;
void TEAM_TENANT;
void (null as unknown as MemoryVectorRecord);
