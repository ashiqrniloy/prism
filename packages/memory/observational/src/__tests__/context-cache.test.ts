import assert from "node:assert/strict";
import { it } from "bun:test";
import { createSessionEntry, type JsonValue, type SessionContext, type SessionLog } from "@arnilo/prism";
import { createCompactionContextCache } from "../context-cache.js";
import { resolveMemoryObservationalConfig } from "../config.js";

const observation = (content: string) => ({ type: "om.observations.recorded", coversUpToId: content, observations: [{
  id: "aaaaaaaaaaaa", content, timestamp: "2026-10-19T00:00:00Z", relevance: "high", sourceEntryIds: [content], tokenCount: 1,
}] });
function harness(strategy = "foreign") {
  const records: JsonValue[] = [observation("captured")];
  const entries = [createSessionEntry({ id: "compact", sessionId: "s", kind: "compaction", data: { strategy } })];
  let release: (() => void) | undefined;
  let reads = 0;
  const session = { id: "s", entries: async () => { reads++; if (release) await new Promise<void>((resolve) => { release = resolve; }); return entries; } } as unknown as SessionContext;
  const log = { entries: () => records, append: async (_s: unknown, value: JsonValue) => { records.push(value); } } as unknown as SessionLog<JsonValue>;
  const cache = createCompactionContextCache(log, resolveMemoryObservationalConfig({}));
  return { cache, session, records, entries, reads: () => reads, delay: () => { release = () => {}; }, release: () => { const resolve = release; release = undefined; resolve?.(); } };
}
it("foreign_compaction_pin_ready_before_next_model_request", async () => {
  const h = harness();
  h.delay();
  h.cache.completed(h.session);
  h.records.push(observation("later"));
  let ready = false;
  const pending = h.cache.blocks(h.session).then((blocks) => { ready = true; return blocks; });
  await Promise.resolve();
  assert.equal(ready, false);
  h.release();
  const blocks = await pending;
  assert.match(JSON.stringify(blocks), /captured/);
  assert.doesNotMatch(JSON.stringify(blocks), /later/);
  assert.equal(h.cache.mode(h.session), "pinned");
  const count = h.records.length;
  h.cache.completed(h.session);
  await h.cache.blocks(h.session);
  assert.equal(h.records.length, count, "duplicate events never repin");
});
it("reopened_session_reconciles_latest_compaction_once", async () => {
  const h = harness();
  await h.cache.blocks(h.session);
  await h.cache.blocks(h.session);
  assert.equal(h.reads(), 1);
  assert.equal(h.cache.mode(h.session), "pinned");
});
it("om_context_block_empty_after_own_compaction", async () => {
  const h = harness("observational-memory");
  h.cache.completed(h.session);
  assert.deepEqual(await h.cache.blocks(h.session), []);
  assert.equal(h.cache.mode(h.session), "own-compaction");
});
it("om_context_block_empty_before_first_compaction", async () => {
  const h = harness();
  h.entries.length = 0;
  assert.deepEqual(await h.cache.blocks(h.session), []);
  assert.equal(h.cache.mode(h.session), "none");
});

it("foreign_compaction_log_append_is_awaited_by_context_build", async () => {
  const records: JsonValue[] = [observation("captured")];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session = { id: "s", entries: async () => [createSessionEntry({ id: "c", sessionId: "s", kind: "compaction" })] } as unknown as SessionContext;
  const log = { entries: () => records, append: async (_s: unknown, value: JsonValue) => { await gate; records.push(value); } } as unknown as SessionLog<JsonValue>;
  const cache = createCompactionContextCache(log, resolveMemoryObservationalConfig({}));
  cache.completed(session);
  let ready = false;
  const pending = cache.blocks(session).then((blocks) => { ready = true; return blocks; });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(ready, false);
  release();
  assert.match(JSON.stringify(await pending), /captured/);
  const reopened = createCompactionContextCache(log, resolveMemoryObservationalConfig({}));
  records.push(observation("later"));
  assert.deepEqual(await reopened.blocks(session), await cache.blocks(session));
});
