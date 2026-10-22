import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createMemoryFabric } from "../../index.js";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory } from "../../index.js";
import { createFabricLifecycle } from "../../lifecycle/index.js";
import { createScopedMemoryPolicy } from "../index.js";
import { loadScopedLedger, saveScopedLedger, scopedLedgerPath } from "../ledger.js";

async function bound(
  options: { readonly onLegacyLedger?: (ignored: number) => void; readonly clock?: number } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "scoped-life-"));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore: createMemoryVectorStore(),
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const policy = createScopedMemoryPolicy({
    memory,
    fabric,
    scopeRoot: root,
    clock: () => options.clock ?? 0,
    ...(options.onLegacyLedger === undefined ? {} : { onLegacyLedger: options.onLegacyLedger }),
  });
  return { root, memory, fabric, policy };
}

/**
 * A note the archive rule selects: written at ordinal 0, used once then never again, so both
 * strengths are low long after the grace window. Calendar age plays no part (Task 4).
 */
async function staleNote(
  memory: ReturnType<typeof createMemory>,
  content: string,
  options: { readonly verified?: boolean; readonly evidence?: boolean } = {},
): Promise<string> {
  const id = randomBytes(6).toString("hex");
  await memory.remember(
    {
      entries: [
        {
          id,
          text: content,
          createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
          consent: { visible: true, source: "agent" },
          metadata: {
            fabric: {
              v: 1,
              kind: "fact",
              created: 0,
              uses: [{ s: 0, at: new Date(Date.now() - 400 * 86_400_000).toISOString() }],
              useSessions: 1,
              ...(options.evidence === true ? { promotion: { score: 1, signals: { explicit: 1 }, pass: "p1" } } : {}),
            },
            ...(options.verified === true ? {} : { status: "candidate" }),
          },
        },
      ],
    },
    { wait: true },
  );
  return id;
}

describe("scoped lifecycle over the unified note lifecycle", () => {
  it("scoped_health_reads_unified_lifecycle", async () => {
    const { memory, fabric, policy } = await bound();
    const candidate = await fabric.remember({ kind: "fact", content: "Staging SSH uses port 2222" }, { status: "candidate" });
    const verified = await fabric.remember({ kind: "fact", content: "Deploys use canaries" });
    const lifecycle = createFabricLifecycle(memory);
    await lifecycle.recordUses("session-1", [candidate.id], { clock: 1 });
    await lifecycle.recordUses("session-2", [candidate.id], { clock: 2 });

    const health = await policy.health();
    assert.deepEqual(health.notes, { candidate: 0, verified: 2, archived: 0 });
    assert.equal(health.conversionRate, 1);
    assert.equal(health.activationRate, 0.5, "only the note with a recorded use counts as active");
    assert.equal((await memory.getEntry(candidate.id))?.metadata?.status, "verified");
    assert.equal((await memory.getEntry(verified.id))?.metadata?.status, undefined);
  });

  it("gc_proposes_what_the_archive_rule_selects_and_approval_forgets", async () => {
    const { memory, policy } = await bound({ clock: 200 });
    const stale = await staleNote(memory, "stale candidate unused for good");
    const fresh = await staleNote(memory, "candidate written this session");
    // A fresh note carries the current ordinal, so the grace window keeps it out of the proposal.
    await createFabricLifecycle(memory).recordUses("s200", [fresh], { clock: 200 });
    const verified = await staleNote(memory, "verified with explicit evidence", { verified: true, evidence: true });
    assert.equal((await memory.getEntry(verified))?.metadata?.status, undefined);

    assert.deepEqual(await policy.gcPass(), { proposed: 1, archived: 0 });
    assert.deepEqual(await policy.gcPass(), { proposed: 0, archived: 0 }, "the proposal is idempotent");

    const pending = await policy.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.id, stale);
    assert.equal(pending[0]?.gist, "lifecycle");

    await policy.approve(stale);
    const identity = { tenantId: "t1", resourceId: memory.scope.resourceId, threadId: "scoped" };
    const live = new Set((await memory.exportMemory({ identity })).entries.map((entry) => entry.id));
    assert.equal(live.has(stale), false);
    assert.equal(live.has(fresh), true, "a note inside the grace window is not proposed");
    assert.equal(live.has(verified), true, "explicit evidence keeps a verified note");
    assert.deepEqual(await policy.pending(), []);
  });

  it("rejecting_an_archive_proposal_leaves_the_note_untouched", async () => {
    const { memory, policy } = await bound({ clock: 200 });
    const stale = await staleNote(memory, "candidate that stays");
    await policy.gcPass();
    const [proposal] = await policy.pending();
    await policy.reject(proposal!.id);
    assert.deepEqual(await policy.pending(), []);
    assert.equal((await memory.getEntry(stale))?.metadata?.status, "candidate");
  });

  it("never_proposes_a_legal_hold_note", async () => {
    const { memory, fabric, policy } = await bound({ clock: 200 });
    const held = await staleNote(memory, "held secret rotation procedure");
    await fabric.forget({ id: held, hold: true });
    assert.deepEqual(await policy.gcPass(), { proposed: 0, archived: 0 });
    assert.deepEqual(await policy.pending(), []);
  });

  it("old_ledger_lifecycle_fields_are_ignored_and_logged_once", async () => {
    const ignored: number[] = [];
    const { root } = await bound({ onLegacyLedger: (count) => ignored.push(count) });
    const file = scopedLedgerPath(root);
    await mkdir(join(root, ".memory"), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        notes: {
          aaaaaaaaaaaa: { uses: 4, status: "verified", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-02T00:00:00.000Z" },
          bbbbbbbbbbbb: { uses: 0, status: "candidate", promotedAt: "2026-01-03T00:00:00.000Z" },
        },
        pending: [{ kind: "review", id: "r1", createdAt: "2026-01-04T00:00:00.000Z", proposal: { kind: "fact", content: "x" } }],
        stats: { writes: 2, duplicates: 1 },
      }),
    );

    const first = await loadScopedLedger(file);
    assert.deepEqual(first, {
      pending: [{ kind: "review", id: "r1", createdAt: "2026-01-04T00:00:00.000Z", proposal: { kind: "fact", content: "x" } }],
      stats: { writes: 2, duplicates: 1 },
    });
    assert.deepEqual(ignored, [2], "the two retired lifecycle rows are reported once");

    await loadScopedLedger(file);
    assert.deepEqual(ignored, [2], "a second read is silent");

    await saveScopedLedger(file, first);
    const rewritten = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    assert.equal("notes" in rewritten, false, "a save writes only what the lifecycle does not own");
    assert.deepEqual(Object.keys(rewritten).sort(), ["pending", "stats"]);
  });
});
