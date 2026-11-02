/**
 * Plan 207 Task 3: the ontology index and schema-assisted subject binding.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ContextDraft, HookContext } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore, type Memory } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import { mergeNoteMetadata } from "../consolidate.js";
import { createFabricDirectory, DEFAULT_DIRECTORY_OPTIONS, renderFabricDirectory } from "../directory.js";
import {
  createFabricOntology,
  createMemory,
  createMemoryFabric,
  type MemoryFabricScopeBinding,
  parseMemoryNoteMetadata,
} from "../index.js";
import { createSubjectMatcher, DEFAULT_BIND_THRESHOLD } from "../ontology/bind.js";
import { MAX_SHOWN_SUBJECTS, subjectPromptBlock } from "../ontology/index.js";

const PROJECT = "projects/demo--01234567";

function memoryFor(vectorStore: ReturnType<typeof createMemoryVectorStore>, resourceId: string): Memory {
  return createMemory({
    tenantId: "prism",
    resourceId,
    threadId: "default",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore,
  });
}

/** One project scope, an ontology over it, and a fabric that binds through the ontology's subject source. */
function single(bindThreshold?: number) {
  const vectorStore = createMemoryVectorStore();
  const memory = memoryFor(vectorStore, "r1");
  const ontology = createFabricOntology({
    scopes: [{ level: "project", memory }],
    store: vectorStore,
    ...(bindThreshold === undefined ? {} : { bindThreshold }),
  });
  const fabric = createMemoryFabric({ memory, vectorStore, consolidate: false, subjects: ontology.subjects });
  return { vectorStore, memory, ontology, port: ontology.port, fabric };
}

/** A user scope and a project scope over one store, both bound through one ontology. */
function twoScopes() {
  const vectorStore = createMemoryVectorStore();
  const project = memoryFor(vectorStore, PROJECT);
  const user = memoryFor(vectorStore, "user");
  const bindings: MemoryFabricScopeBinding[] = [
    { level: "project", memory: project },
    { level: "user", memory: user },
  ];
  const ontology = createFabricOntology({ scopes: bindings, store: vectorStore });
  const fabric = createMemoryFabric({ memory: project, scopes: bindings, consolidate: false, subjects: ontology.subjects });
  return { vectorStore, project, user, ontology, port: ontology.port, fabric };
}

interface Env {
  readonly port: ReturnType<typeof single>["port"];
  readonly fabric: ReturnType<typeof single>["fabric"];
}

let seeds = 0;

/** A concept needs a cited claim, so each one is born with a seed note that names none of the subjects. */
async function concept(
  env: Env,
  input: { subject: string; title: string; type?: "entity" | "topic"; aliases?: string[]; scope?: "project" | "user"; seed?: string },
): Promise<string> {
  const scope = input.scope ?? "project";
  const seed = input.seed ?? (await env.fabric.remember({ kind: "fact", content: `Seed evidence number ${(seeds += 1)}.`, scope })).id;
  await env.port.applyConceptEdits(
    scope,
    [
      {
        op: "create_subject",
        subject: input.subject,
        title: input.title,
        conceptType: input.type ?? "topic",
        ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
      },
      { op: "add_claim", subject: input.subject, text: `${input.title} exists.`, cites: [seed] },
    ],
    { generatedBy: "consolidation" },
  );
  return seed;
}

async function payments(env: Env, scope: "project" | "user" = "project"): Promise<void> {
  await concept(env, {
    subject: "payments",
    title: "Payments service",
    type: "entity",
    aliases: ["billing service", "payments api"],
    scope,
  });
}

async function stored(memory: Memory, id: string) {
  const entry = await memory.getEntry(id);
  assert.ok(entry, "note is stored");
  const note = parseMemoryNoteMetadata(entry.metadata);
  assert.ok(note, "note metadata parses");
  return note;
}

describe("deterministic binding at write time", () => {
  it("unambiguous_alias_binds_note_on_write", async () => {
    const env = single();
    const { memory, port, fabric } = env;
    await payments(env);

    // Two tokens of one alias, in the text.
    const byText = await fabric.remember({ kind: "fact", content: "The payments api retries on timeout." });
    assert.equal(byText.subject, "payments");
    assert.equal((await stored(memory, byText.id)).subject, "payments", "the binding is stored, not only returned");

    // One exact multi-token alias, case-folded and with a plural.
    const byAlias = await fabric.remember({ kind: "fact", content: "BILLING Services restarted overnight." });
    assert.equal(byAlias.subject, "payments");

    // The write-time enrichment keys count like text.
    const byKeys = await fabric.remember({ kind: "fact", content: "Restart procedure was rehearsed.", keywords: ["payments", "api"] });
    assert.equal(byKeys.subject, "payments");

    // Every evidence kind binds, not only facts.
    for (const kind of ["preference", "procedure", "exchange"] as const) {
      const note = await fabric.remember({ kind, content: `Remember the payments api rule for ${kind}.`, scope: "project" });
      assert.equal(note.subject, "payments", kind);
    }

    // An explicit subject always wins, even over a stronger match.
    const explicit = await fabric.remember({ kind: "fact", content: "The payments api is slow.", subject: "other-thing" });
    assert.equal(explicit.subject, "other-thing");

    // The concept needs another pass: the binding marked it dirty with new evidence.
    assert.deepEqual(await port.dirty("project"), [
      { subject: "payments", conceptId: (await port.subjects("project"))[0]!.conceptId, reasons: ["evidence"] },
    ]);
  });

  it("ambiguous_or_weak_match_leaves_note_unbound", async () => {
    const env = single();
    const { port, fabric } = env;
    await payments(env);
    await concept(env, { subject: "billing", title: "Billing", aliases: ["billing api"] });

    // Two subjects reach the threshold: the pass decides, not a coin flip.
    const ambiguous = await fabric.remember({ kind: "fact", content: "Both the payments api and the billing api time out." });
    assert.equal(ambiguous.subject, undefined);

    // One token of a name is weak at the default threshold of 2.
    const weak = await fabric.remember({ kind: "fact", content: "Payments are fine today." });
    assert.equal(weak.subject, undefined);

    // Nothing about any subject.
    const unrelated = await fabric.remember({ kind: "fact", content: "The user prefers dark mode." });
    assert.equal(unrelated.subject, undefined);

    // Nothing was bound, so nothing is dirty.
    assert.deepEqual(await port.dirty("project"), []);
  });

  it("bind_threshold_is_tuning_and_one_token_binds_at_one", async () => {
    const env = single(1);
    const { fabric } = env;
    await payments(env);
    const note = await fabric.remember({ kind: "fact", content: "Payments are fine today." });
    assert.equal(note.subject, "payments");
    assert.equal(DEFAULT_BIND_THRESHOLD, 2);
  });

  it("no_concepts_means_no_binding_and_no_scan_failure", async () => {
    const { fabric } = single();
    const note = await fabric.remember({ kind: "fact", content: "The payments api retries on timeout." });
    assert.equal(note.subject, undefined);
  });

  it("a_rewrite_keeps_the_subject_it_had", () => {
    const base = { v: 1 as const, kind: "fact" as const, subject: "payments" };
    assert.equal(mergeNoteMetadata(base, { v: 1, kind: "fact" }).subject, "payments");
    assert.equal(mergeNoteMetadata(base, { v: 1, kind: "fact", subject: "billing" }).subject, "billing");
  });

  it("binding_never_crosses_scope", async () => {
    const env = twoScopes();
    const { project, user, fabric } = env;
    await payments(env, "project");

    const userNote = await fabric.remember({ kind: "fact", content: "The payments api retries on timeout.", scope: "user" });
    assert.equal(userNote.subject, undefined, "a user note does not bind a project subject");
    assert.equal((await stored(user, userNote.id)).subject, undefined);

    const projectNote = await fabric.remember({ kind: "fact", content: "The payments api retries on timeout.", scope: "project" });
    assert.equal(projectNote.subject, "payments");
    assert.equal((await stored(project, projectNote.id)).subject, "payments");

    // A path note lives in the project's memory and reads the project's subjects.
    const pathNote = await fabric.remember({
      kind: "fact",
      content: "The payments api needs a timeout here.",
      scope: "path",
      appliesTo: ["src/payments/**"],
    });
    assert.equal(pathNote.subject, "payments");

    // And the other way: a user subject binds user notes only.
    await payments(env, "user");
    const second = await fabric.remember({ kind: "fact", content: "The billing service is flaky.", scope: "user" });
    assert.equal(second.subject, "payments");
  });
});

describe("the subject matcher", () => {
  it("bind_under_1ms_for_500_subjects", () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
    const subjects = Array.from({ length: 500 }, (_unused, index) => {
      const a = words[index % words.length]!;
      const b = words[Math.floor(index / words.length) % words.length]!;
      return { subject: `${a}-${b}-${index}`, title: `${a} ${b} ${index}`, aliases: [`${a} ${b} service`, `${b} ${a} api`] };
    });
    const matcher = createSubjectMatcher(subjects);
    const text = "The alpha bravo service restarted twice after the deploy, and charlie delta kept timing out. ".repeat(4);
    matcher.match(text); // warm
    const runs = 300;
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) matcher.match(text, ["alpha", "service"]);
    const each = (performance.now() - started) / runs;
    assert.ok(each < 1, `binding took ${each.toFixed(3)} ms per note`);
  });

  it("matching_is_whole_token_and_case_folded", () => {
    const matcher = createSubjectMatcher([{ subject: "auth", title: "Auth service", aliases: ["login flow"] }]);
    assert.equal(matcher.match("The LOGIN flow broke"), "auth");
    assert.equal(matcher.match("The loginflow broke"), undefined, "no substring matches");
    assert.equal(matcher.match("The login screen broke"), undefined, "one token of a two-token alias is weak");
  });
});

describe("epoch pinning", () => {
  it("subject_list_is_epoch_snapshotted", async () => {
    const env = single();
    const { memory, fabric, ontology } = env;
    await payments(env);
    const first = await ontology.subjects.snapshot("session-1");
    assert.deepEqual(
      first.map((list) => [list.level, list.subjects.map((entry) => entry.subject)]),
      [["project", ["payments"]]],
    );

    // A concept written mid-epoch is additive: the pinned list is the same object.
    await concept(env, { subject: "auth", title: "Auth" });
    assert.equal(await ontology.subjects.snapshot("session-1"), first);
    assert.equal((await ontology.subjects.listing("project")).length, 2, "the live list sees it");

    // A retraction ends the epoch, exactly as it ends the pinned prefix.
    const doomed = await fabric.remember({ kind: "fact", content: "temporary orchard note" });
    await memory.forget({ ids: [doomed.id] });
    const next = await ontology.subjects.snapshot("session-1");
    assert.notEqual(next, first);
    assert.deepEqual(next[0]!.subjects.map((entry) => entry.subject).sort(), ["auth", "payments"]);

    // Another session pins its own list.
    assert.equal((await ontology.subjects.snapshot("session-2"))[0]!.subjects.length, 2);
  });

  it("prompt_block_caps_subjects_and_names_only_what_it_shows", () => {
    const subjects = Array.from({ length: 100 }, (_unused, index) => ({
      subject: `subject-${String(index).padStart(3, "0")}`,
      title: `A reasonably long subject title number ${index}`,
      aliases: ["first alias here", "second alias here", "third alias here", "fourth alias here"],
      uses: 0,
      evidence: 0,
    }));
    const block = subjectPromptBlock([{ level: "project", subjects }]);
    assert.ok(block);
    const lines = block.prompt.project!;
    assert.ok(lines.length <= MAX_SHOWN_SUBJECTS);
    assert.ok(lines.join("").length <= 6_000);
    assert.equal(block.slugs.get("project")!.size, lines.length, "the accepted slugs are exactly the shown ones");
    assert.equal(subjectPromptBlock([]), undefined);
  });
});

describe("directory line", () => {
  it("directory_concepts_line_within_budget_and_pinned_for_epoch", async () => {
    const env = single();
    const { memory, fabric, ontology } = env;
    await fabric.remember({ id: "aaaaaaaaaaaa", kind: "fact", content: "violet orchard", scope: "project" });
    await payments(env);

    const source = createFabricDirectory({ memory, concepts: (level, signal) => ontology.subjects.listing(level as "project", signal) });
    const snapshot = await source.snapshot();
    assert.deepEqual(snapshot.scopes[0]?.concepts, { count: 1, subjects: ["payments"] });
    const rendered = renderFabricDirectory(snapshot, DEFAULT_DIRECTORY_OPTIONS);
    assert.ok(rendered);
    assert.match(rendered.content, /^2 facts\. Recall with memory\.recall\.$/m);
    assert.match(rendered.content, /^project concepts: 1; subjects: payments$/m);

    // Many subjects: the line names a few, counts the rest, and the block stays inside the budget.
    const seed = (await fabric.remember({ kind: "fact", content: "Shared seed evidence.", scope: "project" })).id;
    for (let index = 0; index < 40; index += 1) await concept(env, { subject: `topic-${index}`, title: `Topic ${index}`, seed });
    const crowded = renderFabricDirectory(await source.snapshot(), DEFAULT_DIRECTORY_OPTIONS);
    assert.ok(crowded);
    assert.match(crowded.content, /^project concepts: 41; subjects: .+ \(\+33\)$/m);
    assert.ok(crowded.tokens <= DEFAULT_DIRECTORY_OPTIONS.maxTokens);
    const tight = renderFabricDirectory(await source.snapshot(), { ...DEFAULT_DIRECTORY_OPTIONS, maxTokens: 20 });
    assert.ok(tight);
    assert.match(tight.content, /project concepts: 41/, "the count survives a tight budget");
    assert.ok(tight.tokens <= 20);

    // No concepts, no line: the directory is byte-identical to today's.
    const bare = createFabricDirectory({ memory: single().memory });
    assert.equal(renderFabricDirectory(await bare.snapshot(), DEFAULT_DIRECTORY_OPTIONS), undefined);
  });

  it("concepts_line_is_pinned_for_the_session_epoch", async () => {
    const env = single();
    const { memory, fabric, ontology } = env;
    await fabric.remember({ id: "aaaaaaaaaaaa", kind: "fact", content: "violet orchard", scope: "project" });
    const directory = {
      source: createFabricDirectory({ memory, concepts: (level, signal) => ontology.subjects.listing(level as "project", signal) }),
      options: DEFAULT_DIRECTORY_OPTIONS,
    };
    const projection = createFabricContext(memory, fabric.recall, false, {}, directory);
    const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "orchard" }] }] };
    const build = () => projection.build(draft, { sessionId: "s" } as HookContext);

    const before = await build();
    assert.doesNotMatch(JSON.stringify(before.context), /concepts:/);
    await payments(env);
    assert.deepEqual((await build()).context, before.context, "a concept written mid-epoch does not rebuild the prefix");

    // A retraction ends the epoch; the next prefix names the concept.
    const doomed = await fabric.remember({ kind: "fact", content: "temporary note" });
    await memory.forget({ ids: [doomed.id] });
    assert.match(JSON.stringify((await build()).context), /project concepts: 1; subjects: payments/);
  });
});
