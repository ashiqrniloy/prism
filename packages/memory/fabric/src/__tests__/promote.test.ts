/** OM → fabric background promotion and the candidate lifecycle (plan 188 Task 13). */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContextDraft, type HookContext, type SessionEntry } from "@arnilo/prism";
import { createHashEmbedder } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import { createMemory, createMemoryFabric } from "../index.js";
import { createFabricLifecycle } from "../lifecycle/index.js";
import { normalizeNoteStatus } from "../lifecycle/status.js";
import { createFabricRecall } from "../recall.js";
import { runScopedGcPass } from "../scoped/lifecycle.js";
import { parseMemoryNoteMetadata } from "../types.js";

const DAY = 86_400_000;

function freshMemory() {
  return createMemory({ tenantId: "t", resourceId: "r", threadId: "s", embedder: createHashEmbedder() });
}

const user = (id: string): SessionEntry => ({
  id,
  sessionId: "s",
  kind: "message",
  timestamp: "2026-10-17T12:00:00Z",
  message: { role: "user", content: [{ type: "text", text: "question" }] },
});

describe("candidate lifecycle", () => {
  it("promoted_fact_is_candidate_and_not_passively_injected", async () => {
    const memory = freshMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const note = await fabric.remember({ kind: "fact", content: "retry budget stays small" }, { status: "candidate" });
    assert.equal(note.status, "candidate");
    const hits = (await fabric.recall("retry budget stays small", { minSimilarity: 0 })).hits;
    assert.equal(hits[0]?.status, "candidate", "tool recall still sees it");
    const context = {
      runId: "",
      sessionId: "s",
      session: { id: "s", entries: async () => [user("u1")] },
      emit() {},
      reject() {},
    } as unknown as HookContext;
    const draft: ContextDraft = { messages: [user("u1").message!] };
    const projection = createFabricContext(memory, fabric.recall, { minSimilarity: 0, minScore: 0 });
    const built = await projection.build(draft, context);
    assert.doesNotMatch(JSON.stringify(built), /retry budget/, "a candidate is never injected passively");
    const verified = await fabric.remember({ kind: "fact", content: "deploys use canaries" });
    assert.equal(verified.status, undefined);
    const injected = await createFabricContext(memory, fabric.recall, { minSimilarity: 0, minScore: 0 }).build(draft, context);
    assert.match(JSON.stringify(injected), /deploys use canaries/);
  });

  it("recall_lists_verified_before_candidate_at_equal_score", async () => {
    const memory = freshMemory();
    const row = (id: string, score: number, status?: "candidate") => ({
      hit: {
        id,
        text: id,
        score,
        createdAt: "2026-10-17T12:00:00Z",
        tenantId: "t",
        resourceId: "r",
        threadId: "s",
        embedding: [],
        sequence: 0,
      },
      metadata: { v: 1 as const, kind: "fact" as const, ...(status ? { status } : {}) },
    });
    const recall = createFabricRecall({
      memory,
      limits: memory.limits,
      loadCandidates: async () => ({
        candidates: [row("c1", 0.9, "candidate"), row("v1", 0.9), row("c2", 0.8, "candidate"), row("v2", 0.7)],
        shadowed: [],
      }),
    });
    const hits = (await recall("q", { topK: 4 })).hits;
    assert.deepEqual(
      hits.map((hit) => hit.id),
      ["v1", "c1", "c2", "v2"],
      "only equal-score runs reorder; ranking is otherwise kept",
    );
  });

  it("candidate_verified_after_uses_in_distinct_sessions", async () => {
    const memory = freshMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const note = await fabric.remember({ kind: "fact", content: "use me" }, { status: "candidate" });
    assert.deepEqual(await fabric.recordUses("session-1", [note.id], { verifyAfterSessions: 2 }), []);
    assert.deepEqual(await fabric.recordUses("session-1", [note.id], { verifyAfterSessions: 2 }), [], "the same session counts once");
    assert.equal((await memory.getEntry(note.id))?.metadata?.status, "candidate");
    assert.deepEqual(await fabric.recordUses("session-2", [note.id], { verifyAfterSessions: 2 }), [note.id]);
    assert.equal((await memory.getEntry(note.id))?.metadata?.status, "verified");
    assert.deepEqual(await fabric.recordUses("session-3", [note.id], { verifyAfterSessions: 2 }), [], "a verified note is left alone");
  });

  it("candidate_verified_by_agent_insert_or_replace_or_host", async () => {
    const memory = freshMemory();
    const fabric = createMemoryFabric({ memory });
    const a = await fabric.remember({ kind: "fact", content: "agent writes this again" }, { status: "candidate" });
    const again = await fabric.remember({ kind: "fact", content: "agent writes this again" });
    assert.equal(again.id, a.id, "consolidation folds the rewrite into the candidate");
    assert.equal(again.status, "verified");
    const b = await fabric.remember({ kind: "fact", content: "host confirms this one" }, { status: "candidate" });
    assert.equal(await fabric.verify(b.id), true);
    assert.equal(await fabric.verify(b.id), false, "already verified");
    assert.equal((await memory.getEntry(b.id))?.metadata?.status, "verified");
  });

  it("promotion_write_never_demotes_a_verified_note", async () => {
    const memory = freshMemory();
    const fabric = createMemoryFabric({ memory });
    const verified = await fabric.remember({ kind: "fact", content: "already trusted" });
    const again = await fabric.remember({ kind: "fact", content: "already trusted" }, { status: "candidate" });
    assert.equal(again.id, verified.id);
    assert.notEqual(again.status, "candidate");
  });

  it("candidate_status_survives_rewrite_and_correction", async () => {
    const memory = freshMemory();
    const fabric = createMemoryFabric({ memory });
    const note = await fabric.remember({ kind: "fact", content: "candidate text" }, { status: "candidate" });
    const again = await fabric.remember({ kind: "fact", content: "candidate text" }, { status: "candidate" });
    assert.equal(again.status, "candidate", "a promotion rewrite keeps it a candidate");
    await memory.correct(note.id, "corrected candidate text");
    const row = await memory.getEntry(note.id);
    assert.equal(row?.metadata?.status, "candidate");
    assert.equal(parseMemoryNoteMetadata(row?.metadata)?.status, "candidate");
  });

  it("unused_candidate_archives_and_is_not_recalled", async () => {
    const memory = freshMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const note = await fabric.remember({ kind: "fact", content: "never used" }, { status: "candidate" });
    const kept = await fabric.remember({ kind: "fact", content: "verified stays" });
    const lifecycle = createFabricLifecycle(memory);
    assert.equal(await lifecycle.archive(note.id), true);
    const row = await memory.getEntry(note.id);
    assert.equal(row?.metadata?.status, "archived");
    assert.equal(parseMemoryNoteMetadata(row?.metadata)?.validTo, undefined);
    assert.ok(parseMemoryNoteMetadata(row?.metadata)?.archivedAt);
    const ids = (await fabric.recall("never used verified stays", { minSimilarity: 0, asOf: new Date(Date.now() + 32 * DAY) })).hits.map(
      (hit) => hit.id,
    );
    assert.equal(ids.includes(note.id), false, "an archived candidate is not recalled");
    assert.equal(ids.includes(kept.id), true);
    assert.deepEqual(await lifecycle.census(), { candidate: 0, verified: 1, archived: 1 });
  });

  it("plain_legacy_note_is_verified_scoped_missing_status_is_candidate", async () => {
    const memory = freshMemory();
    // A note written before the lifecycle existed carries no top-level status.
    await memory.remember(
      { entries: [{ id: "a".repeat(12), text: "legacy", metadata: { fabric: { v: 1, kind: "fact" } } }] },
      { wait: true },
    );
    assert.equal(normalizeNoteStatus(undefined, "verified"), "verified");
    assert.equal(normalizeNoteStatus(undefined, "candidate"), "candidate");
    assert.deepEqual(await createFabricLifecycle(memory).census(), { candidate: 0, verified: 1, archived: 0 });
    assert.equal(parseMemoryNoteMetadata((await memory.getEntry("a".repeat(12)))?.metadata)?.status, undefined);
  });

  it("a_malformed_status_fails_closed", async () => {
    const memory = freshMemory();
    await memory.remember(
      { entries: [{ id: "b".repeat(12), text: "bad", metadata: { fabric: { v: 1, kind: "fact" }, status: "weird" } }] },
      { wait: true },
    );
    assert.equal(parseMemoryNoteMetadata((await memory.getEntry("b".repeat(12)))?.metadata), undefined);
  });

  it("plain_and_scoped_archive_share_the_lifecycle_rule", async () => {
    // Plan 188.4 Task 4: the archive rule is one predicate over the two strengths, not calendar days.
    for (const [clock, acts] of [
      [5, false],
      [200, true],
    ] as const) {
      const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "s", embedder: createHashEmbedder() });
      const fabric = createMemoryFabric({ memory, consolidate: false });
      const note = await fabric.remember({ kind: "fact", content: "archive rule" }, { status: "candidate" });
      const dir = await mkdtemp(join(tmpdir(), "prism-promote-"));
      try {
        const scoped = await runScopedGcPass({ memory, ledgerFile: join(dir, "state.json"), clock });
        assert.equal(scoped.proposed === 1, acts, "the scoped approval pass uses the rule");
        assert.equal((await memory.getEntry(note.id))?.metadata?.status, "candidate", "a proposal never changes the note");
        if (scoped.proposed > 0) {
          // The scoped pass only proposes; the plain lifecycle performs the archive on approval.
          assert.equal(await createFabricLifecycle(memory).archive(note.id), true);
          assert.equal((await memory.getEntry(note.id))?.metadata?.status, "archived");
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});
