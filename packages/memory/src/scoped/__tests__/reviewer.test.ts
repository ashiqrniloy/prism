import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MemoryValidationError } from "../../errors.js";
import { createMemoryFabric } from "../../fabric/index.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryPolicy } from "../index.js";
import { scopedLedgerPath } from "../ledger.js";

async function bound(knobs?: Parameters<typeof createScopedMemoryPolicy>[0]["policy"]) {
  const root = await mkdtemp(join(tmpdir(), "scoped-review-"));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
  const fabric = createMemoryFabric({ memory });
  const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot: root, policy: knobs });
  return { root, memory, fabric, policy };
}

const correction = [
  {
    kind: "fact",
    content: "User prefers metric units",
    sourceEntryIds: ["aaaaaaaaaaaa"],
  },
];

describe("policy.reviewSession", () => {
  it("drops garbage and unknown fields with zero writes and no throw", async () => {
    const { root, policy } = await bound();
    assert.throws(() => policy.reviewSession("digest", {} as never), MemoryValidationError);

    const bad = [
      policy.reviewSession("digest", { reviewer: async () => "not-json" }),
      policy.reviewSession("digest", { reviewer: async () => ({ kind: "fact" }) }),
      policy.reviewSession("digest", {
        reviewer: async () => [{ ...correction[0], extra: true }],
      }),
      policy.reviewSession("digest", {
        reviewer: async () => {
          throw new Error("model down");
        },
      }),
      policy.reviewSession("digest", {
        reviewer: async () => [correction[0], { kind: "working", content: "x", sourceEntryIds: ["b"] }],
      }),
    ];
    for (const result of await Promise.all(bad)) {
      assert.deepEqual(result, { proposed: 0, written: 0, staged: 0, status: { candidate: 0 } });
    }
    assert.deepEqual(await readdir(root), []);
  });

  it("writes a correction as a candidate fact with sourceEntryIds; a duplicate folds", async () => {
    const { root, fabric, policy } = await bound();
    let calls = 0;
    const reviewer = async (prompt: string) => {
      calls += 1;
      assert.match(prompt, /Most sessions update nothing/);
      assert.match(prompt, /User said metric/);
      return correction;
    };

    const first = await policy.reviewSession("User said metric, not imperial. Remember this.", { reviewer });
    assert.equal(first.proposed, 1);
    assert.equal(first.written, 1);
    assert.equal(first.staged, 0);
    assert.equal(first.status.candidate, 1);

    const { hits } = await fabric.recall("User prefers metric units");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.kind, "fact");
    assert.deepEqual(hits[0]?.sourceEntryIds, ["aaaaaaaaaaaa"]);
    assert.equal(hits[0]?.consent?.visible, true);
    const id = hits[0]?.id;

    const second = await policy.reviewSession("User said metric, not imperial. Remember this.", { reviewer });
    assert.equal(second.written, 1);
    assert.equal(second.status.candidate, 1);
    const again = await fabric.recall("User prefers metric units");
    assert.equal(again.hits.length, 1);
    assert.equal(again.hits[0]?.id, id);

    const ledger = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, { status?: string; content?: string; uses?: number }>;
    };
    assert.equal(Object.keys(ledger.notes).length, 1);
    assert.equal(ledger.notes[id!]?.status, "candidate");
    assert.equal(ledger.notes[id!]?.content, undefined);
    assert.equal(calls, 2);
  });

  it("stages proposals when approval is staged and leaves fabric untouched", async () => {
    const { root, fabric, policy } = await bound({ approval: { default: "staged" } });
    const result = await policy.reviewSession("remember this", { reviewer: async () => JSON.stringify(correction) });
    assert.deepEqual(result, { proposed: 1, written: 0, staged: 1, status: { candidate: 0 } });
    assert.equal((await fabric.recall("User prefers metric units")).hits.length, 0);
    const ledger = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, unknown>;
      pending: readonly { kind: string; proposal: { content: string } }[];
    };
    assert.deepEqual(ledger.notes, {});
    assert.equal(ledger.pending.length, 1);
    assert.equal(ledger.pending[0]?.kind, "review");
    assert.equal(ledger.pending[0]?.proposal.content, "User prefers metric units");
  });
});
