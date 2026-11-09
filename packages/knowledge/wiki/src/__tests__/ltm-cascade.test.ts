/**
 * Plan 216 Task 3: the wiki reads long-term memory through the read-only `memory.ltm` port, and deletion still
 * cascades deterministically. Deletions arrive by the deletion feed (forget, revoke, legal hold, correction) and by
 * an open-time liveness check (hard deletes: retention, capacity eviction, import replace). A claim whose citation
 * is unreadable is never rendered or returned. No test here makes a model call.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHashEmbedder, createMemoryVectorStore, MemoryScopeError } from "@arnilo/prism-memory-core";
import { createMemory, createLongTermMemory, createMemoryLtmPort, type LtmScope } from "@arnilo/prism-memory-system";
import { parseConceptBody } from "../ontology/codec.js";
import type { LtmPort } from "../ontology/ltm.js";
import { createWikiOntology } from "../ontology/port.js";
import { createMarkdownWikiStore, type WikiStore } from "../store.js";
import { createWikiReadTool, createWikiSearchTool } from "../tools/knowledge.js";

const scope = { tenantId: "t1", threadId: "th1" };

function memorySide() {
  const vectorStore = createMemoryVectorStore();
  const memory = createMemory({ ...scope, resourceId: "r-project", embedder: createHashEmbedder({ dimensions: 8 }), vectorStore });
  const scopes: LtmScope[] = [{ level: "project", memory, store: vectorStore }];
  const ltm = createMemoryLtmPort({ scopes: () => scopes });
  const fabric = createLongTermMemory({ memory, vectorStore, consolidate: false });
  const note = async (text: string) => (await fabric.remember({ kind: "fact", content: text })).id;
  return { vectorStore, memory, scopes, ltm, note };
}

/** A wiki over a markdown store: a fresh `open()` is a wiki loaded later, in another process. */
function wikiSide(root: string, ltm: () => LtmPort | undefined) {
  const open = (store: WikiStore = createMarkdownWikiStore({ root })) => createWikiOntology({ store, ltm });
  return { open };
}

async function seed(port: ReturnType<typeof createWikiOntology>, cites: readonly [string, string]) {
  await port.applyConceptEdits(
    "project",
    [
      { op: "create_subject", subject: "payments", title: "Payments service", conceptType: "entity" },
      { op: "add_claim", subject: "payments", text: "Retries use exponential backoff.", cites: [cites[0]] },
      { op: "add_claim", subject: "payments", text: "Inputs are validated with zod.", cites: [cites[1]] },
    ],
    { generatedBy: "consolidation" },
  );
}

async function claims(port: ReturnType<typeof createWikiOntology>): Promise<readonly string[]> {
  const [record] = await port.concepts("project");
  return record === undefined ? [] : parseConceptBody(record.body, { allowUncited: true }).claims.map((claim) => claim.text);
}

const tempRoot = (): string => mkdtempSync(join(tmpdir(), "prism-wiki-cascade-"));

describe("deletion cascades from long-term memory into the wiki", () => {
  it("forgetting_an_ltm_note_retracts_citing_wiki_claims_without_a_model_call", async () => {
    const root = tempRoot();
    const mem = memorySide();
    const port = wikiSide(root, () => mem.ltm).open();
    const a = await mem.note("payments retries use exponential backoff");
    const b = await mem.note("payments inputs are validated with zod");
    await seed(port, [a, b]);
    await port.refresh();
    await mem.memory.forget({ ids: [a] });
    // The forget bumped the retraction epoch: the next refresh reads the deletion feed. There is no model client here.
    const report = await port.refresh();
    assert.equal(report.removed, 1);
    assert.deepEqual(await claims(port), ["Inputs are validated with zod."]);
    const [record] = await port.concepts("project");
    assert.ok(record!.dirty.includes("removed"), "the concept is queued for repair");
    rmSync(root, { recursive: true, force: true });
  });

  it("wiki_loaded_after_forget_reconciles_from_lineage_before_rendering", async () => {
    const root = tempRoot();
    const mem = memorySide();
    const first = wikiSide(root, () => mem.ltm).open();
    const a = await mem.note("payments retries use exponential backoff");
    const b = await mem.note("payments inputs are validated with zod");
    await seed(first, [a, b]);
    // The wiki is not loaded when the note is forgotten (another process, or the package was off).
    await mem.memory.forget({ ids: [a] });
    const later = wikiSide(root, () => mem.ltm).open();
    const read = createWikiReadTool({ port: () => later, maxClaimsRendered: 8 });
    const result = await read.execute({ subject: "payments" }, { sessionId: "s", runId: "r", toolCallId: "t" });
    const text = (result.content?.[0] as { text: string } | undefined)?.text ?? "";
    assert.equal(text.includes("exponential backoff"), false, "the forgotten claim never renders");
    assert.match(text, /validated with zod/);
    assert.deepEqual(await claims(later), ["Inputs are validated with zod."], "the store itself was reconciled");
    rmSync(root, { recursive: true, force: true });
  });

  it("wiki_loaded_after_retention_delete_retracts_claims_on_open", async () => {
    const root = tempRoot();
    const mem = memorySide();
    const first = wikiSide(root, () => mem.ltm).open();
    const a = await mem.note("payments retries use exponential backoff");
    const b = await mem.note("payments inputs are validated with zod");
    await seed(first, [a, b]);
    // A hard delete (retention, capacity eviction, import replace) leaves no invalidation record.
    await mem.vectorStore.delete({ tenantId: scope.tenantId, resourceId: "r-project", ids: [b] });
    assert.deepEqual((await mem.ltm.deletions("project")).deletions, []);
    const later = wikiSide(root, () => mem.ltm).open();
    const report = await later.refresh();
    assert.equal(report.removed, 1, "the open-time liveness check catches it");
    assert.deepEqual(await claims(later), ["Retries use exponential backoff."]);
    rmSync(root, { recursive: true, force: true });
  });

  it("a_revoked_note_is_never_rendered_and_is_retracted_on_open", async () => {
    const root = tempRoot();
    const mem = memorySide();
    const first = wikiSide(root, () => mem.ltm).open();
    const a = await mem.note("payments retries use exponential backoff");
    const b = await mem.note("payments inputs are validated with zod");
    await seed(first, [a, b]);
    await first.refresh();
    await mem.memory.setConsent(a, { source: "user", scope: "thread", visible: false });
    // Before any reconcile: the read side drops the claim, the store still holds it.
    const search = createWikiSearchTool({ port: () => first, maxClaimsRendered: 8 });
    const found = await search.execute({ query: "payments retries backoff" }, { sessionId: "s", runId: "r", toolCallId: "t" });
    assert.equal(((found.content?.[0] as { text: string } | undefined)?.text ?? "").includes("exponential backoff"), false);
    const later = wikiSide(root, () => mem.ltm).open();
    await later.refresh();
    assert.deepEqual(await claims(later), ["Inputs are validated with zod."]);
    rmSync(root, { recursive: true, force: true });
  });

  it("scope_revocation_retracts_every_claim_and_archives_the_concept", async () => {
    const root = tempRoot();
    const mem = memorySide();
    const port = wikiSide(root, () => mem.ltm).open();
    const a = await mem.note("payments retries use exponential backoff");
    const b = await mem.note("payments inputs are validated with zod");
    await seed(port, [a, b]);
    await port.refresh();
    // Forget everything in the scope's thread: every citation goes, and an empty concept is archived.
    await mem.memory.forget();
    const report = await port.refresh();
    assert.equal(report.removed, 2);
    assert.equal(report.archived, 1);
    assert.equal((await port.subjects("project")).length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it("a_correction_marks_the_citing_claim_stale_and_keeps_it", async () => {
    const root = tempRoot();
    const mem = memorySide();
    const port = wikiSide(root, () => mem.ltm).open();
    const a = await mem.note("payments retries use exponential backoff");
    const b = await mem.note("payments inputs are validated with zod");
    await seed(port, [a, b]);
    await port.refresh();
    await port.reconcile("project");
    await mem.memory.correct(a, "payments retries use linear backoff");
    const report = await port.reconcile("project");
    assert.equal(report.stale, 1);
    assert.equal((await claims(port)).length, 2);
    rmSync(root, { recursive: true, force: true });
  });

  it("the_deletion_feed_carries_ids_reasons_and_times_only", async () => {
    const mem = memorySide();
    const a = await mem.note("payments retries use exponential backoff");
    await mem.memory.forget({ ids: [a] });
    const page = await mem.ltm.deletions("project");
    assert.deepEqual(Object.keys(page.deletions[0] ?? {}).sort(), ["at", "id", "reason"]);
    assert.equal(page.deletions[0]?.id, a);
    assert.deepEqual((await mem.ltm.deletions("project", { since: page.cursor! })).deletions, [], "the cursor resumes after it");
  });

  it("a_citation_must_be_readable_active_evidence_in_the_concepts_own_scope", async () => {
    const mem = memorySide();
    const port = createWikiOntology({ ltm: () => mem.ltm });
    const a = await mem.note("payments retries use exponential backoff");
    await assert.rejects(
      port.applyConceptEdits(
        "project",
        [
          { op: "create_subject", subject: "payments", title: "Payments", conceptType: "entity" },
          { op: "add_claim", subject: "payments", text: "Cites nothing real.", cites: ["0123456789ab"] },
        ],
        { generatedBy: "consolidation" },
      ),
      /not a readable active note/,
    );
    await mem.memory.patchMetadata(a, (metadata) => ({ ...metadata, status: "archived" }));
    await assert.rejects(
      port.applyConceptEdits(
        "project",
        [
          { op: "create_subject", subject: "payments", title: "Payments", conceptType: "entity" },
          { op: "add_claim", subject: "payments", text: "Cites an archived note.", cites: [a] },
        ],
        { generatedBy: "consolidation" },
      ),
      /not a readable active note/,
    );
    assert.equal((await port.concepts("project")).length, 0, "nothing was written");
  });

  it("a_wiki_root_never_serves_two_projects", async () => {
    const root = tempRoot();
    const vectorStore = createMemoryVectorStore();
    const project = (resourceId: string) => {
      const memory = createMemory({ ...scope, resourceId, embedder: createHashEmbedder({ dimensions: 8 }), vectorStore });
      return {
        memory,
        ltm: createMemoryLtmPort({ scopes: () => [{ level: "project", memory, store: vectorStore }] }),
        fabric: createLongTermMemory({ memory, vectorStore, consolidate: false }),
      };
    };
    const a = project("project-a");
    const b = project("project-b");
    const wikiA = wikiSide(root, () => a.ltm).open();
    const note = (await a.fabric.remember({ kind: "fact", content: "alpha retries use backoff" })).id;
    await wikiA.applyConceptEdits(
      "project",
      [
        { op: "create_subject", subject: "alpha", title: "Alpha", conceptType: "topic" },
        { op: "add_claim", subject: "alpha", text: "Alpha retries use backoff.", cites: [note] },
      ],
      { generatedBy: "consolidation" },
    );
    // Project B pointed at project A's wiki root: every read and write of that scope fails closed.
    const wikiB = wikiSide(root, () => b.ltm).open();
    await assert.rejects(wikiB.concepts("project"), MemoryScopeError);
    await assert.rejects(wikiB.subjects("project"), MemoryScopeError);
    await assert.rejects(
      wikiB.applyConceptEdits("project", [{ op: "settle" } as never], { generatedBy: "consolidation" }),
      MemoryScopeError,
    );
    assert.equal((await wikiA.subjects("project")).length, 1, "the owner still reads its own concepts");
    rmSync(root, { recursive: true, force: true });
  });
});
