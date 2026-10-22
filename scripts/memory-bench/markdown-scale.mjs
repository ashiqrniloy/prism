import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir, cpus, platform, release } from "node:os";
import { join, dirname } from "node:path";
import { createMarkdownMemoryStores } from "@arnilo/prism-memory-core/fabric";
import { renderNoteFile } from "../../packages/memory/core/src/fabric/okf.ts";
import { noteRelPath } from "../../packages/memory/core/src/fabric/layout.ts";

const scope = { tenantId: "synthetic", resourceId: "scale", threadId: "bench" };
const record = (i) => ({ ...scope, id: `n${String(i).padStart(11, "0")}`, sequence: i + 1,
  createdAt: "2026-10-19T00:00:00.000Z", embedding: [],
  text: `Synthetic project ${i} uses protocol${i % 100} for deployment. The service has a weekly release schedule and a documented rollback procedure.`,
  metadata: { fabric: { v: 1, kind: "fact", tags: [`protocol${i % 100}`] } } });
const pathFor = (root, r) => join(root, noteRelPath({ ...r, kind: "fact", archived: false }));
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
async function diskSize(root) {
  let treeBytes = 0, indexBytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await diskSize(path);
      treeBytes += nested.treeBytes;
      indexBytes += nested.indexBytes;
    } else {
      const { size } = await stat(path);
      treeBytes += size;
      if (entry.name.startsWith(".index.sqlite")) indexBytes += size;
    }
  }
  return { treeBytes, indexBytes };
}

export async function measureMarkdownScale(notes) {
  assert.ok(Number.isSafeInteger(notes) && notes > 0 && notes <= 50000, "notes must be 1..50000");
  const root = await mkdtemp(join(tmpdir(), "prism-markdown-scale-"));
  let store;
  try {
    // Seed canonical files with the production codec; setup is outside the timed rebuild.
    for (let i = 0; i < notes; i++) {
      const r = record(i), path = pathFor(root, r);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, renderNoteFile(r));
    }
    const open = async () => {
      const start = performance.now();
      store = await createMarkdownMemoryStores({ root });
      let extraPasses = 0;
      while (await store.vectorStore.countByThread(scope) !== notes) {
        const report = await store.reconcile();
        assert.equal(report.malformed, 0);
        assert.ok(++extraPasses <= notes && report.indexed > 0, "reconcile made no progress");
      }
      return { ms: performance.now() - start, extraPasses };
    };
    const cold = await open();
    await store.close(); store = undefined;
    const warm = await open();
    await store.close(); store = undefined;
    const editedNotes = Math.max(1, Math.ceil(notes * .01));
    for (let i = 0; i < editedNotes; i++) await appendFile(pathFor(root, record(i)), "\nSynthetic external edit marker.\n");
    const edited = await open();
    const changed = await store.vectorStore.getByIds(scope, [record(0).id, record(editedNotes - 1).id]);
    for (const item of changed) assert.match(item.text, /external edit marker/);
    assert.ok(changed.length > 0);
    const writes = [], recalls = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await store.vectorStore.upsert([record(i % notes)]);
      writes.push(performance.now() - start);
    }
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      const hits = await store.vectorStore.lexicalQuery({ ...scope, text: `protocol${i % Math.min(100, notes)}`, topK: 5 });
      recalls.push(performance.now() - start);
      assert.ok(hits.length > 0);
    }
    await store.close(); store = undefined;
    return { notes, editedNotes, cold, warm, edited, writeSamples: writes.length, recallSamples: recalls.length,
      writeP50Ms: percentile(writes, .5), writeP95Ms: percentile(writes, .95),
      recallP50Ms: percentile(recalls, .5), recallP95Ms: percentile(recalls, .95), ...await diskSize(root) };
  } finally {
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--notes"), "usage: --notes 1000,10000,50000");
  const counts = (args[1] ?? "1000,10000,50000").split(",").map(Number);
  console.log(JSON.stringify({ bun: Bun.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, date: new Date().toISOString() }));
  for (const count of counts) console.log(JSON.stringify(await measureMarkdownScale(count)));
}
