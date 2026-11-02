/**
 * Plan 202 Task 15: p95 lexical recall at 100k exchanges on SQLite and Postgres.
 *
 * The measurement is the vector store path only: no fabric turns, tool serialization, embedding work,
 * or agent latency. Bodies are bounded synthetic exchanges, seeded in 1,000-row batches outside the
 * query timer. Postgres uses an isolated throwaway schema.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresVectorStore } from "@arnilo/prism-memory-core/postgres";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";

const SCOPE = { tenantId: "growth", resourceId: "archive", threadId: "scale" };
const DIMENSIONS = 8;

function record(index) {
  return {
    ...SCOPE,
    id: noteId(index),
    sequence: index + 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    embedding: new Array(DIMENSIONS).fill(0),
    text: `user: synthetic session ${index} discusses token${index % 1000} and its follow-up\n\nassistant: recorded token${index % 1000} for session ${index}`,
    metadata: { fabric: { v: 1, kind: "exchange" } },
  };
}

function noteId(index) {
  return index.toString(16).padStart(12, "0");
}

function percentile(values, p) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
}

async function seed(store, exchanges) {
  const started = performance.now();
  for (let offset = 0; offset < exchanges; offset += 1_000) {
    const records = [];
    for (let index = offset; index < Math.min(exchanges, offset + 1_000); index++) records.push(record(index));
    await store.upsert(records);
  }
  return performance.now() - started;
}

async function measure(store, exchanges, queries = 200) {
  const writeMs = await seed(store, exchanges);
  const latencies = [];
  for (let index = 0; index < queries; index++) {
    const started = performance.now();
    const hits = await store.lexicalQuery({ ...SCOPE, text: `token${index % 1000}`, topK: 5 });
    latencies.push(performance.now() - started);
    assert.ok(hits.length > 0, "each lexical query returns a hit");
  }
  return {
    exchanges,
    writeMs: Number(writeMs.toFixed(2)),
    querySamples: latencies.length,
    queryP50Ms: Number(percentile(latencies, 0.5).toFixed(3)),
    queryP95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
  };
}

export async function measureExchangeStore(kind, options = {}) {
  const exchanges = options.exchanges ?? 100_000;
  assert.ok(Number.isSafeInteger(exchanges) && exchanges > 0, "exchanges must be positive");
  if (kind === "sqlite") {
    const root = await mkdtemp(join(tmpdir(), "prism-exchange-scale-"));
    let stores;
    try {
      stores = await createSqliteMemoryStores({ path: join(root, "scale.sqlite"), dimensions: DIMENSIONS });
      return { store: "sqlite", ...(await measure(stores.vectorStore, exchanges, options.queries)) };
    } finally {
      await stores?.close();
      await rm(root, { recursive: true, force: true });
    }
  }
  if (kind === "postgres") {
    const connectionString = options.connectionString ?? process.env.PRISM_TEST_POSTGRES_URL;
    if (connectionString === undefined) throw new Error("PRISM_TEST_POSTGRES_URL is required for the Postgres leg");
    const suffix = `${process.pid}_${Date.now()}`;
    const schema = `prism_growth_${suffix}`;
    const store = await createPostgresVectorStore({ connectionString, schema, table: "exchange_scale", dimension: DIMENSIONS });
    try {
      return { store: "postgres", ...(await measure(store, exchanges, options.queries)) };
    } finally {
      await store.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await store.close();
    }
  }
  throw new Error(`Unknown exchange store: ${kind}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const valueOf = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const output = valueOf("--output");
  const exchanges = Number(valueOf("--exchanges") ?? 100_000);
  const stores = (valueOf("--store") ?? "sqlite,postgres").split(",");
  const results = [];
  for (const store of stores) results.push(await measureExchangeStore(store, { exchanges }));
  const report = {
    schemaVersion: 1,
    metric: "p95 lexical recall over the vector store",
    exchanges,
    results,
    criterion: { p95MsMax: 100, pass: results.every((result) => result.queryP95Ms <= 100) },
  };
  if (output !== undefined) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
}
