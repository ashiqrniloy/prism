import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHashEmbedder, type Memory } from "@arnilo/prism-memory-core";
import {
  createMemory,
  createMemoryFabric,
  encodeMemoryNoteMetadata,
  type MemoryFabric,
  type MemoryFabricScopeBinding,
  parseMemoryNoteMetadata,
} from "../../index.js";
import { MEMORY_NOTE_METADATA_KEY } from "../../types.js";
import type { ExtractedNote } from "../extract.js";
import type { ConsolidationCandidate } from "../gather.js";
import { scorePromotion } from "../score.js";
import { type AcceptedConsolidationNote, type ConsolidationKnownNote, writeConsolidationNotes } from "../write.js";

const PROJECT_ID = "demo--01234567";
const PROJECT_RESOURCE = `projects/${PROJECT_ID}`;
const PASS = "pass-1";

function memory(resourceId: string): Memory {
  return createMemory({ tenantId: "prism", resourceId, threadId: "t", embedder: createHashEmbedder({ dimensions: 8, id: "hash" }) });
}

function scoped(): {
  readonly fabric: MemoryFabric;
  readonly bindings: readonly MemoryFabricScopeBinding[];
  readonly project: Memory;
  readonly user: Memory;
} {
  const project = memory(PROJECT_RESOURCE);
  const user = memory("user");
  const bindings: MemoryFabricScopeBinding[] = [
    { level: "project", memory: project },
    { level: "user", memory: user },
  ];
  return { fabric: createMemoryFabric({ memory: project, scopes: bindings, consolidate: false }), bindings, project, user };
}

function extracted(overrides: Partial<ExtractedNote> = {}): ExtractedNote {
  return {
    text: "This project uses npm for releases.",
    kind: "preference",
    scope: "project",
    keywords: ["npm", "release"],
    aliases: [],
    evidence: ["c1"],
    explicit: false,
    correction: false,
    generality: 0.6,
    ephemerality: 0.1,
    derivable: false,
    ...overrides,
  };
}

function accepted(
  overrides: Partial<ExtractedNote> = {},
  extra: Partial<Omit<AcceptedConsolidationNote, "note" | "score">> = {},
): AcceptedConsolidationNote {
  const note = extracted(overrides);
  const candidates: readonly ConsolidationCandidate[] = [{ source: "decision", text: note.text, evidenceIds: ["e1", "e2"], signals: {} }];
  return {
    note,
    score: scorePromotion(note, { candidates, sessions: 2, minScore: 0 }),
    evidenceEntryIds: ["e1", "e2"],
    ...extra,
  };
}

async function metadataOf(m: Memory, id: string) {
  const [record] = await m.get([id]);
  assert.ok(record, "note exists");
  const metadata = parseMemoryNoteMetadata(record.metadata);
  assert.ok(metadata, "note metadata parses");
  return { record, metadata };
}

function known(id: string, overrides: Partial<ConsolidationKnownNote> = {}): ConsolidationKnownNote {
  return { id, kind: "preference", text: "Use pnpm for everything.", level: "user", key: "package-manager", ...overrides };
}

describe("consolidation writes", () => {
  it("accepted_note_written_as_candidate_with_provenance_and_scores", async () => {
    const { fabric, project } = scoped();
    const note = accepted();
    const result = await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      notes: [note],
      sessionId: "s1",
      pass: PASS,
    });
    assert.deepEqual({ written: result.written, updated: result.updated, retired: result.retired }, { written: 1, updated: 0, retired: 0 });

    const [hit] = (await fabric.recall(note.note.text, { minSimilarity: 0 })).hits;
    assert.ok(hit);
    assert.equal(hit.status, "candidate");
    assert.equal(hit.kind, "preference");
    assert.equal(hit.level, "project");
    const { metadata } = await metadataOf(project, hit.id);
    assert.equal(metadata.generated?.by, "promotion");
    assert.equal(metadata.generated?.session, "s1");
    assert.deepEqual(metadata.sourceEntryIds, ["e1", "e2"]);
    assert.equal(metadata.promotion?.pass, PASS);
    assert.equal(metadata.promotion?.score, note.score.score);
    assert.deepEqual(metadata.promotion?.signals, { ...note.score.signals });
    assert.equal(hit.generated?.by, "promotion", "recall exposes the same provenance");
  });

  it("exchange_links_only_when_the_note_scope_can_read_them", async () => {
    const { fabric, project } = scoped();
    const projectExchange = await fabric.remember({ kind: "exchange", content: "user: npm\n\nassistant: ok", scope: "project" });
    const userExchange = await fabric.remember({ kind: "exchange", content: "user: I ship on Fridays\n\nassistant: noted", scope: "user" });
    const note = accepted(
      { kind: "fact", scope: "user", text: "The user ships on Fridays." },
      { evidenceEntryIds: [projectExchange.id, userExchange.id, "e1"] },
    );
    await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      notes: [note],
      exchangeEvidence: new Map([
        [projectExchange.id, "project"],
        [userExchange.id, "user"],
      ]),
      sessionId: "s1",
      pass: PASS,
    });

    const hit = (await fabric.recall(note.note.text, { minSimilarity: 0, kinds: ["fact"] })).hits[0];
    assert.ok(hit);
    assert.deepEqual(
      (hit.links ?? []).map((link) => link.id),
      [userExchange.id],
      "a user note never links project-only evidence it cannot read",
    );
    assert.deepEqual(hit.sourceEntryIds, ["e1"], "exchange ids are links, not transcript sources");
  });

  it("contradiction_of_user_preference_writes_project_exception_and_counts", async () => {
    const { fabric, project, user, bindings } = scoped();
    const preference = await fabric.remember({
      kind: "preference",
      content: "Use pnpm for everything.",
      scope: "user",
      key: "package-manager",
    });
    const exception: AcceptedConsolidationNote = {
      ...accepted({ text: "This project releases with npm.", key: "package-manager" }),
      contradicts: known(preference.id),
    };
    const result = await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      scopes: bindings,
      notes: [exception],
      sessionId: "s1",
      pass: PASS,
      projectId: PROJECT_ID,
    });
    assert.equal(result.exceptions, 1);
    assert.equal(result.written, 1);
    const hits = (await fabric.recall("release pnpm npm package manager", { minSimilarity: 0 })).hits;
    const written = hits.find((hit) => hit.content === "This project releases with npm.");
    assert.ok(written, "the exception is written in the project scope");
    const { metadata } = await metadataOf(project, written.id);
    assert.equal(metadata.scope, "project");
    assert.equal(metadata.key, "package-manager", "identical key is what makes the shadowing work");
    assert.equal(metadata.overrides, preference.id);
    assert.deepEqual((await metadataOf(user, preference.id)).metadata.contradictedIn, [PROJECT_ID]);
  });

  it("exception_shadows_user_preference_in_that_project_only", async () => {
    const user = memory("user");
    const projectA = memory(PROJECT_RESOURCE);
    const projectB = memory("projects/other--89abcdef");
    const bindings = (project: Memory): MemoryFabricScopeBinding[] => [
      { level: "project", memory: project },
      { level: "user", memory: user },
    ];
    const a = createMemoryFabric({ memory: projectA, scopes: bindings(projectA), consolidate: false });
    const b = createMemoryFabric({ memory: projectB, scopes: bindings(projectB), consolidate: false });
    const preference = await a.remember({ kind: "preference", content: "Use pnpm for everything.", scope: "user", key: "package-manager" });
    await writeConsolidationNotes({
      remember: a.remember,
      memory: projectA,
      scopes: bindings(projectA),
      notes: [{ ...accepted({ text: "This project releases with npm.", key: "package-manager" }), contradicts: known(preference.id) }],
      sessionId: "s1",
      pass: PASS,
      projectId: PROJECT_ID,
    });

    const inA = (await a.recall("release pnpm npm package manager", { minSimilarity: 0 })).hits;
    assert.ok(
      inA.some((hit) => hit.content === "This project releases with npm."),
      "the project exception is visible",
    );
    assert.ok(!inA.some((hit) => hit.id === preference.id), "the wider preference is shadowed by the exception's key");

    const inB = (await b.recall("release pnpm npm package manager", { minSimilarity: 0 })).hits;
    assert.ok(
      inB.some((hit) => hit.id === preference.id),
      "another project still sees the user preference",
    );
    assert.ok(!inB.some((hit) => hit.content === "This project releases with npm."), "the exception never crosses projects");
  });

  it("reconsolidate_flag_updates_note_in_place_or_retires_it", async () => {
    const { fabric, project } = scoped();
    const first = accepted();
    await writeConsolidationNotes({ remember: fabric.remember, memory: project, notes: [first], sessionId: "s1", pass: PASS });
    const [hit] = (await fabric.recall(first.note.text, { minSimilarity: 0 })).hits;
    assert.ok(hit);
    const { metadata } = await metadataOf(project, hit.id);
    await project.patchMetadata(hit.id, (current) => ({
      ...current,
      [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...metadata, reconsolidate: true }),
    }));

    const replacement: AcceptedConsolidationNote = {
      ...accepted({ text: "This project releases with npm and git tags." }),
      replacing: { ...known(hit.id), kind: "preference", text: first.note.text, level: "project", status: "candidate" },
    };
    const updated = await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      notes: [replacement],
      sessionId: "s1",
      pass: PASS,
    });
    assert.equal(updated.updated, 1);
    const again = (await fabric.recall("releases npm git tags", { minSimilarity: 0 })).hits[0];
    assert.equal(again?.id, hit.id, "the note is rewritten in place");
    assert.equal(again?.content, "This project releases with npm and git tags.");
    assert.equal((await metadataOf(project, hit.id)).metadata.reconsolidate, undefined, "the flag is cleared by the rewrite");

    const retire = await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      notes: [],
      retire: [{ id: hit.id, level: "project" }],
      sessionId: "s1",
      pass: PASS,
    });
    assert.equal(retire.retired, 1);
    const { metadata: retired } = await metadataOf(project, hit.id);
    assert.ok(retired.validTo, "retirement sets validTo instead of deleting");
    assert.ok((await fabric.recall("releases npm git tags", { minSimilarity: 0 })).hits.every((row) => row.id !== hit.id));
  });

  it("promotion_never_demotes_verified_note", async () => {
    const { fabric, project } = scoped();
    const verified = await fabric.remember({ kind: "preference", content: "Releases use npm.", scope: "project" });
    assert.equal(verified.status, undefined, "a plain note is verified");
    const result = await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      notes: [
        {
          ...accepted({ text: "Releases use npm or pnpm." }),
          replacing: { ...known(verified.id), kind: "preference", text: verified.content, level: "project", status: "verified" },
        },
      ],
      sessionId: "s1",
      pass: PASS,
    });
    assert.equal(result.updated, 1);
    const { metadata } = await metadataOf(project, verified.id);
    assert.notEqual(metadata.status, "candidate");
    assert.equal((await fabric.recall("releases npm pnpm", { minSimilarity: 0 })).hits[0]?.status, undefined);
  });

  it("per_reflection_promotion_is_gone", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") await walk(path);
        } else if (entry.name.endsWith(".ts")) {
          const text = await readFile(path, "utf8");
          if (/runFabricPromotion|promote\.observational|observational:\s*true/.test(text)) offenders.push(path);
        }
      }
    };
    await walk(root);
    assert.deepEqual(offenders, []);
    const exportsText = await readFile(join(root, "exports.ts"), "utf8");
    assert.ok(!exportsText.includes("runFabricPromotion"), "the runner is not exported");
  });
});

// Plan 207 Task 3: the extractor's subject reaches the stored note.
describe("consolidation writes carry the extractor's subject", () => {
  it("shown_subject_is_stored_and_new_is_not", async () => {
    const { fabric, project } = scoped();
    await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      notes: [
        accepted({ text: "The payments service retries with backoff.", kind: "fact", subject: "payments" }),
        accepted({ text: "The ledger service batches nightly.", kind: "fact", subject: "new" }),
      ],
      sessionId: "s1",
      pass: PASS,
    });
    const hits = (await fabric.recall("payments ledger service", { minSimilarity: 0 })).hits;
    const byText = (needle: string) => hits.find((hit) => hit.content.includes(needle));
    assert.equal((await metadataOf(project, byText("payments")!.id)).metadata.subject, "payments");
    assert.equal(
      (await metadataOf(project, byText("ledger")!.id)).metadata.subject,
      undefined,
      '"new" is a request for the concept pass, not a slug',
    );
  });

  it("subject_is_not_carried_into_a_fallback_scope", async () => {
    // Only the project scope is active, so a `user` note lands in the project: the user-scope slug must not follow it.
    const project = memory(PROJECT_RESOURCE);
    const bindings: MemoryFabricScopeBinding[] = [{ level: "project", memory: project }];
    const fabric = createMemoryFabric({ memory: project, scopes: bindings, consolidate: false });
    await writeConsolidationNotes({
      remember: fabric.remember,
      memory: project,
      scopes: bindings,
      notes: [
        accepted({ text: "The user prefers terse replies from payments tooling.", kind: "preference", scope: "user", subject: "payments" }),
      ],
      sessionId: "s1",
      pass: PASS,
    });
    const [hit] = (await fabric.recall("terse replies", { minSimilarity: 0 })).hits;
    assert.ok(hit);
    assert.equal((await metadataOf(project, hit.id)).metadata.subject, undefined);
  });
});
