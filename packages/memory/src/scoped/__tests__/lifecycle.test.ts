import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createMemoryFabric } from "../../fabric/index.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryPolicy } from "../index.js";
import { saveScopedLedger, scopedLedgerPath } from "../ledger.js";

async function bound() {
  const root = await mkdtemp(join(tmpdir(), "scoped-life-"));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot: root });
  return { root, memory, fabric, policy };
}

const old = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("policy.promotionPass / gcPass / health", () => {
  it("promotes a candidate with 2 uses once; fabric row unchanged", async () => {
    const { root, fabric, policy } = await bound();
    const note = await fabric.remember({
      kind: "fact",
      content: "Staging SSH uses port 2222, not 22",
      consent: { visible: true, source: "agent" },
    });
    const before = await fabric.recall("Staging SSH uses port 2222");
    assert.equal(before.hits[0]?.id, note.id);

    await saveScopedLedger(scopedLedgerPath(root), {
      notes: { [note.id]: { uses: 2, status: "candidate", createdAt: note.ingestedAt } },
      pending: [],
      stats: { writes: 2, duplicates: 1 },
    });

    assert.deepEqual(await policy.promotionPass(), { promoted: 1 });
    assert.deepEqual(await policy.promotionPass(), { promoted: 0 });

    const after = await fabric.recall("Staging SSH uses port 2222");
    assert.equal(after.hits.length, 1);
    assert.equal(after.hits[0]?.id, note.id);
    assert.equal(after.hits[0]?.content, note.content);
    assert.equal(after.hits[0]?.ingestedAt, note.ingestedAt);
    assert.equal(after.hits[0]?.kind, note.kind);

    const ledger = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, { status?: string; promotedAt?: string; uses?: number }>;
    };
    assert.equal(ledger.notes[note.id]?.status, "verified");
    assert.equal(ledger.notes[note.id]?.uses, 2);
    assert.equal(typeof ledger.notes[note.id]?.promotedAt, "string");

    const health = await policy.health();
    assert.deepEqual(health.notes, { candidate: 0, verified: 1, archived: 0 });
    assert.equal(health.conversionRate, 1);
    assert.equal(health.activationRate, 1);
    assert.equal(health.duplicationRate, 0.5);
  });

  it("proposes stale candidates; forget removes, skip leaves live; pass is idempotent", async () => {
    const { root, memory, fabric, policy } = await bound();
    const stale = await fabric.remember({
      kind: "fact",
      content: "stale candidate unused a month",
      consent: { visible: true, source: "agent" },
    });
    const keep = await fabric.remember({
      kind: "fact",
      content: "verified but decayed, host declines delete",
      consent: { visible: true, source: "agent" },
    });
    await saveScopedLedger(scopedLedgerPath(root), {
      notes: {
        [stale.id]: { uses: 0, status: "candidate", createdAt: old(31) },
        [keep.id]: { uses: 2, status: "verified", createdAt: old(200), lastUsedAt: old(200) },
      },
      pending: [],
    });

    assert.deepEqual(await policy.gcPass(), { proposed: 2, archived: 0 });
    assert.deepEqual(await policy.gcPass(), { proposed: 0, archived: 0 });

    const ledger = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, { status?: string }>;
      pending: readonly { kind: string; id: string; reason: string }[];
    };
    assert.equal(ledger.notes[stale.id]?.status, "archived");
    assert.equal(ledger.notes[keep.id]?.status, "archived");
    assert.equal(ledger.pending.length, 2);
    assert.equal(ledger.pending.find((p) => p.id === stale.id)?.reason, "stale-candidate");
    assert.equal(ledger.pending.find((p) => p.id === keep.id)?.reason, "decay");

    await fabric.forget({ id: stale.id });
    const identity = { tenantId: "t1", resourceId: root, threadId: "scoped" };
    const live = new Set((await memory.exportMemory({ identity })).entries.map((e) => e.id));
    assert.equal(live.has(stale.id), false);
    assert.equal(live.has(keep.id), true);
    assert.equal((await fabric.recall("verified but decayed")).hits[0]?.id, keep.id);
  });

  it("never proposes a legal_hold note", async () => {
    const { root, fabric, policy } = await bound();
    const held = await fabric.remember({
      kind: "fact",
      content: "held secret rotation procedure",
      consent: { visible: true, source: "agent" },
    });
    await saveScopedLedger(scopedLedgerPath(root), {
      notes: { [held.id]: { uses: 0, status: "candidate", createdAt: old(40) } },
      pending: [],
    });
    await fabric.forget({ id: held.id, hold: true });

    assert.deepEqual(await policy.gcPass(), { proposed: 0, archived: 0 });
    assert.deepEqual(await policy.promotionPass(), { promoted: 0 });
    const ledger = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, { status?: string }>;
      pending: readonly unknown[];
    };
    assert.equal(ledger.notes[held.id]?.status, "candidate");
    assert.equal(ledger.pending.length, 0);
  });
});
