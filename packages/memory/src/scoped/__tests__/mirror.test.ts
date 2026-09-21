import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createMemoryFabric } from "../../fabric/index.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryPolicy } from "../index.js";
import { saveScopedLedger, scopedLedgerPath } from "../ledger.js";

const SECRET = "sk-test-mirror-secret-9f3a";

async function bound(secrets?: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), "scoped-mirror-"));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
    ...(secrets ? { secrets } : {}),
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot: root });
  return { root, memory, fabric, policy };
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string, rel: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const path = join(current, name);
      const next = rel ? `${rel}/${name}` : name;
      if ((await stat(path)).isDirectory()) await walk(path, next);
      else if (name !== "state.json") out[next] = await readFile(path, "utf8");
    }
  }
  await walk(dir, "");
  return out;
}

describe("policy.renderMirror", () => {
  it("two consecutive renders are byte-identical", async () => {
    const { root, fabric, policy } = await bound();
    await fabric.remember({
      kind: "fact",
      content: "Staging SSH uses port 2222, not 22",
      consent: { visible: true, source: "agent" },
    });
    await policy.rememberFact("workspace uses pnpm");
    await policy.renderMirror();
    const first = await snapshot(join(root, ".memory"));
    await policy.renderMirror();
    assert.deepEqual(await snapshot(join(root, ".memory")), first);
    assert.equal(first[".gitignore"], "state.json\n");
    assert.equal(first["facts.md"], "workspace uses pnpm\n");
    assert.equal(
      Object.keys(first).some((k) => k.startsWith("notes/") && k.endsWith(".md")),
      true,
    );
  });

  it("closed validTo and uses render; archived notes are absent", async () => {
    const { root, fabric, policy } = await bound();
    const live = await fabric.remember({
      kind: "fact",
      content: "old port mapping, closed window",
      validTo: "2020-01-01T00:00:00.000Z",
      sourceEntryIds: ["aaaaaaaaaaaa"],
      consent: { visible: true, source: "agent" },
    });
    const archived = await fabric.remember({
      kind: "fact",
      content: "archived candidate stays in fabric",
      consent: { visible: true, source: "agent" },
    });
    await saveScopedLedger(scopedLedgerPath(root), {
      notes: {
        [live.id]: { uses: 4, status: "verified", lastUsedAt: "2026-01-02T00:00:00.000Z" },
        [archived.id]: { uses: 0, status: "archived", createdAt: "2025-01-01T00:00:00.000Z" },
      },
      pending: [],
    });
    await policy.renderMirror();
    const files = await snapshot(join(root, ".memory"));
    const liveFile = files[`notes/${live.id}.md`];
    assert.equal(typeof liveFile, "string");
    assert.match(liveFile!, /validTo: "2020-01-01T00:00:00.000Z"/);
    assert.match(liveFile!, /uses: 4/);
    assert.match(liveFile!, /lastUsedAt: "2026-01-02T00:00:00.000Z"/);
    assert.match(liveFile!, /sourceEntryIds: \["aaaaaaaaaaaa"\]/);
    assert.equal(files[`notes/${archived.id}.md`], undefined);
  });

  it("redacted secret never appears in mirror output", async () => {
    const { root, fabric, policy } = await bound([SECRET]);
    await fabric.remember({
      kind: "fact",
      content: `deploy token ${SECRET} is rotated weekly`,
      consent: { visible: true, source: "agent" },
    });
    await policy.rememberFact(`do not leak ${SECRET}`);
    await policy.renderMirror();
    const files = await snapshot(join(root, ".memory"));
    const blob = Object.values(files).join("\n");
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes("[REDACTED]"), true);
  });
});
