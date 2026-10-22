import assert from "node:assert/strict";
import { MemoryConflictError, MemoryScopeError, MemoryValidationError } from "@arnilo/prism-memory-core";
import { createMemory } from "./memory.js";
import type { Embedder, VectorStore, WorkingMemoryStore } from "@arnilo/prism-memory-core";

export interface MemoryConformanceStores {
  readonly embedder: Embedder;
  readonly vectorStore: VectorStore & Required<Pick<VectorStore, "listByThread" | "countByThread" | "countByKind" | "topTags">>;
  readonly workingStore: WorkingMemoryStore;
}

/**
 * Shared network-free conformance for Embedder + VectorStore + WorkingMemoryStore trios.
 */
export async function runMemoryConformance(createStores: () => Promise<MemoryConformanceStores> | MemoryConformanceStores): Promise<void> {
  const stores = await createStores();
  const memory = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    threadId: "thread-a",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        preferences: {
          type: "object",
          properties: { format: { type: "string" } },
          required: ["format"],
          additionalProperties: false,
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  });

  await assert.rejects(memory.updateWorking({ preferences: { format: "concise" } }), MemoryValidationError);

  const created = await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
  assert.equal(created.version, 1);
  assert.equal(created.value.name, "Ada");

  const merged = await memory.updateWorking({ preferences: { format: "bullets" } }, { mode: "merge" });
  assert.equal(merged.version, 2);
  assert.equal(merged.value.name, "Ada");
  assert.deepEqual(merged.value.preferences, { format: "bullets" });

  await assert.rejects(memory.updateWorking({ name: "Ada", preferences: { format: "x" } }, { expectedVersion: 1 }), MemoryConflictError);

  const replaced = await memory.updateWorking({ name: "Ada", preferences: { format: "short" } }, { mode: "replace", expectedVersion: 2 });
  assert.equal(replaced.version, 3);

  const otherThread = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    threadId: "thread-b",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  assert.equal(await otherThread.getWorking(), undefined);

  await memory.remember(
    {
      entries: [
        { id: "1", text: "preferred response format is concise bullet points", sequence: 1 },
        { id: "2", text: "User lives in Lisbon and likes coffee", sequence: 2 },
        { id: "3", text: "Deployment window is Tuesday evenings", sequence: 3 },
      ],
    },
    { wait: true },
  );

  assert.deepEqual((await memory.get(["1", "missing", "1"])).map(record => record.id), ["1"]);
  assert.equal((await otherThread.get(["1"])).length, 0);
  assert.equal((await memory.get([])).length, 0);
  await assert.rejects(memory.get([""]), MemoryValidationError);
  await assert.rejects(memory.get(["1"], { signal: AbortSignal.abort() }), /aborted/i);
  await memory.setConsent("2", { visible: false });
  assert.equal((await memory.get(["2"])).length, 0);
  await memory.setConsent("2", { visible: true });

  const recalled = await memory.recall("preferred response format is concise bullet points", { topK: 2, messageRange: 1 });
  assert.ok(recalled.hits.length >= 1);
  assert.equal(recalled.hits[0]!.id, "1");
  assert.ok(recalled.hits.every((hit) => hit.tenantId === "tenant-a" && hit.threadId === "thread-a"));
  assert.ok(recalled.adjacent.every((item) => item.threadId === "thread-a"));
  if (recalled.hits.length > 1) {
    assert.ok(recalled.hits[0]!.score >= recalled.hits[1]!.score);
  }

  // Composite scoring crosses the same adapter contract: stored importance clamps
  // at write, recency uses createdAt/half-life, and the recency/importance blend appears
  // only when enabled. (Pre-fusion cosine `similarity` is a retrieval component, not a blend one.)
  const scoringNow = Date.now();
  await memory.remember(
    {
      entries: [
        {
          id: "scoring-stale",
          text: "scoring conformance marker",
          sequence: 10,
          createdAt: new Date(scoringNow - 10_000_000).toISOString(),
          importance: -5,
        },
        {
          id: "scoring-fresh",
          text: "scoring conformance marker",
          sequence: 11,
          createdAt: new Date(scoringNow).toISOString(),
          importance: 5,
        },
      ],
    },
    { wait: true },
  );
  const scored = await memory.recall("scoring conformance marker", {
    topK: 8,
    scoring: { recencyWeight: 0.4, importanceWeight: 0.4, halfLifeMs: 10_000 },
  });
  const stale = scored.hits.find((hit) => hit.id === "scoring-stale");
  const fresh = scored.hits.find((hit) => hit.id === "scoring-fresh");
  assert.ok(stale && fresh, "composite candidates must survive the shared adapter recall");
  assert.equal(stale.importance, 0);
  assert.equal(fresh.importance, 1);
  assert.ok(fresh.recency! > 0.9);
  assert.ok(stale.recency! < fresh.recency!);
  assert.ok(fresh.score > stale.score, "fresh/high-importance hit must outrank stale/low-importance hit");
  const plainScoring = await memory.recall("scoring conformance marker", { topK: 8 });
  assert.ok(plainScoring.hits.every((hit) => !("recency" in hit)));
  await assert.rejects(memory.recall("scoring conformance marker", { scoring: { recencyWeight: 0.5 } }), MemoryValidationError);

  const empty = await memory.recall("zzzz-no-match-token-xyz", { topK: 3 });
  assert.ok(Array.isArray(empty.hits));

  const foreign = createMemory({
    tenantId: "tenant-b",
    resourceId: "resource-a",
    threadId: "thread-a",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  const foreignRecall = await foreign.recall("concise answers", { topK: 5 });
  assert.equal(foreignRecall.hits.length, 0);

  // Consent + lifecycle: invisible entries never inject; grant/correct/forget/retention are real.
  await memory.remember(
    { entries: [{ id: "c1", text: "hidden preference do not inject", consent: { source: "user", scope: "thread", visible: false } }] },
    { wait: true },
  );
  const hidden = await memory.recall("hidden preference do not inject", { topK: 8 });
  assert.ok(
    hidden.hits.every((hit) => hit.id !== "c1"),
    "invisible memory must not inject",
  );

  const granted = await memory.setConsent("c1", { visible: true });
  assert.equal(granted.consent?.visible, true);
  assert.ok(granted.consent?.grantedAt);
  const visible = await memory.recall("hidden preference do not inject", { topK: 8 });
  assert.ok(
    visible.hits.some((hit) => hit.id === "c1"),
    "granted memory must inject",
  );

  const revoked = await memory.setConsent("c1", { visible: false });
  assert.equal(revoked.consent?.visible, false);
  assert.ok(revoked.consent?.revokedAt);
  const revokedRecall = await memory.recall("hidden preference do not inject", { topK: 8 });
  assert.ok(
    revokedRecall.hits.every((hit) => hit.id !== "c1"),
    "revoked memory must not inject",
  );

  await memory.setConsent("c1", { visible: true });
  const corrected = await memory.correct("c1", "preferred snack is almonds");
  assert.match(corrected.text, /almonds/);
  assert.equal(corrected.consent?.visible, true);

  const forgotten = await memory.forget({ ids: ["c1"] });
  assert.equal(forgotten, 1);
  const afterForget = await memory.recall("almonds", { topK: 8 });
  assert.ok(
    afterForget.hits.every((hit) => hit.id !== "c1"),
    "forgotten memory must be gone",
  );

  await memory.remember(
    {
      entries: [
        { id: "r1", text: "retention one", sequence: 101, createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "r2", text: "retention two", sequence: 102, createdAt: "2020-01-02T00:00:00.000Z" },
        { id: "r3", text: "retention three", sequence: 103, createdAt: new Date().toISOString() },
      ],
    },
    { wait: true },
  );
  const swept = await memory.applyRetention({ maxAgeDays: 30, batchSize: 10 });
  assert.ok(swept.deleted >= 2, "aged entries must be real-deleted");
  const afterSweep = await memory.recall("retention", { topK: 8 });
  assert.ok(afterSweep.hits.every((hit) => hit.id !== "r1" && hit.id !== "r2"));

  const exported = await memory.exportMemory({
    identity: { tenantId: "tenant-a", resourceId: "resource-a", threadId: "thread-a" },
    limit: 1,
  });
  assert.ok(exported.entries.length <= 1);
  assert.ok(exported.entries.every((entry) => entry.consent?.visible === true));
  await assert.rejects(
    memory.exportMemory({ identity: { tenantId: "tenant-b", resourceId: "resource-a", threadId: "thread-a" } }),
    MemoryScopeError,
  );

  let cursor: string | undefined;
  let rebuilt = 0;
  do {
    const page = await memory.rebuildIndex({ cursor, batchSize: 1 });
    rebuilt += page.rebuilt;
    cursor = page.nextCursor;
  } while (cursor);
  assert.ok(rebuilt >= 1, "bounded rebuild must re-embed at least one retained entry");

  const noThread = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  await assert.rejects(noThread.recall("x"), MemoryScopeError);


  // Directory aggregates (plan 188 Task 12): every store counts the same active notes.
  const directory = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    threadId: "thread-directory",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  const note = (id: string, fabric: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id,
    text: `directory note ${id}`,
    metadata: { fabric: { v: 1, ...fabric }, ...extra } as never,
  });
  await directory.remember(
    {
      entries: [
        note("d-fact-1", { kind: "fact", tags: ["deploy", "billing"], keywords: ["deploy"] }),
        note("d-fact-2", { kind: "fact", tags: ["deploy"] }),
        note("d-fact-3", { kind: "fact", keywords: ["billing", "auth"] }),
        note("d-proc-1", { kind: "procedure", tags: ["deploy"] }),
        note("d-file-1", { kind: "file", path: "notes/deploy.md" }),
        note("d-old", { kind: "fact", tags: ["stale"], validTo: "2000-01-01T00:00:00.000Z" }),
        note("d-future", { kind: "fact", tags: ["future"], validFrom: "2999-01-01T00:00:00.000Z" }),
        note("d-candidate", { kind: "fact", tags: ["candidate"] }, { status: "candidate" }),
        note("d-revoked", { kind: "fact", tags: ["revoked"] }),
        note("d-forgotten", { kind: "fact", tags: ["forgotten"] }),
        { id: "d-plain", text: "not a fabric note", metadata: { other: true } },
      ],
    },
    { wait: true },
  );
  await directory.setConsent("d-revoked", { visible: false });
  await directory.forget({ ids: ["d-forgotten"] });
  assert.deepEqual(await directory.countByKind(), { fact: 3, file: 1, procedure: 1 });
  assert.deepEqual(await directory.topTags({ limit: 10 }), [
    { tag: "deploy", count: 3 },
    { tag: "billing", count: 2 },
    { tag: "auth", count: 1 },
  ]);
  assert.deepEqual(await directory.topTags({ limit: 1 }), [{ tag: "deploy", count: 3 }]);
  assert.deepEqual(await directory.countByKind({ asOf: "1999-06-01T00:00:00.000Z" }), { fact: 4, file: 1, procedure: 1 });
  assert.deepEqual(await otherThread.countByKind(), {}, "another thread's notes are never counted");
  await assert.rejects(directory.countByKind({ asOf: "not-a-date" }), MemoryValidationError);
  await assert.rejects(directory.topTags({ limit: 0 }), MemoryValidationError);

  // Lifecycle scan, resource listing, and the scope clock (plan 188.4 Task 2). Each is an optional
  // member, so a store that does not declare it skips the block instead of failing conformance.
  const scanScope = { tenantId: "tenant-a", resourceId: "projects/scan" };
  if (stores.vectorStore.scanMetadata && stores.vectorStore.listResources) {
    const scanned = createMemory({
      ...scanScope,
      threadId: "thread-scan",
      embedder: stores.embedder,
      vectorStore: stores.vectorStore,
      workingStore: stores.workingStore,
    });
    const visible = { source: "user", scope: "thread", visible: true } as const;
    await scanned.remember(
      {
        entries: [
          { id: "scan-1", text: "scan note one", sequence: 1, consent: visible, metadata: { status: "candidate" } },
          { id: "scan-2", text: "scan note two", sequence: 2, consent: visible, metadata: { status: "verified" } },
          { id: "scan-hidden", text: "scan note hidden", sequence: 3, consent: { ...visible, visible: false } },
          { id: "scan-held", text: "scan note held", sequence: 4, consent: visible },
        ],
      },
      { wait: true },
    );
    await scanned.forget({ ids: ["scan-held"], hold: true });

    const first = await stores.vectorStore.scanMetadata({ scope: scanScope, limit: 1 });
    assert.equal(first.rows.length, 1);
    assert.ok(first.nextCursor, "a full page carries a cursor");
    const row = first.rows[0]!;
    assert.equal("text" in row, false, "the scan never returns text");
    assert.equal("embedding" in row, false, "the scan never returns embeddings");
    assert.equal(row.metadata?.status, "candidate");
    assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    const second = await stores.vectorStore.scanMetadata({ scope: scanScope, limit: 1, cursor: first.nextCursor });
    assert.deepEqual([...first.rows, ...second.rows].map((item) => item.id).sort(), ["scan-1", "scan-2"]);
    assert.equal(second.nextCursor, undefined);
    assert.deepEqual(
      (await stores.vectorStore.scanMetadata({ scope: scanScope, limit: 10 })).rows.map((item) => item.id).sort(),
      ["scan-1", "scan-2"],
      "hidden consent and a legal hold stay out of the scan",
    );
    await assert.rejects(stores.vectorStore.scanMetadata({ scope: scanScope, limit: 0 }), MemoryValidationError);

    assert.deepEqual(await stores.vectorStore.listResources({ tenantId: "tenant-a", prefix: "projects/" }), ["projects/scan"]);
    assert.deepEqual(await stores.vectorStore.listResources({ tenantId: "tenant-b" }), []);
  }

  if (stores.vectorStore.scopeCounter) {
    const counter = { tenantId: "tenant-a", resourceId: "projects/scan", name: "sessions" } as const;
    assert.equal(await stores.vectorStore.scopeCounter.get(counter), 0);
    const values = await Promise.all(Array.from({ length: 5 }, () => stores.vectorStore.scopeCounter!.increment(counter)));
    assert.deepEqual(values.sort((a, b) => a - b), [1, 2, 3, 4, 5], "concurrent increments serialize");
    assert.equal(await stores.vectorStore.scopeCounter.get(counter), 5);
  }

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(memory.recall("concise", { signal: controller.signal }), /aborted/i);
}
