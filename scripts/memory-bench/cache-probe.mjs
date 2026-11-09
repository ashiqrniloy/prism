#!/usr/bin/env bun
/**
 * Plan 202 Task 4.15: informational live multi-turn cache probe. One scripted 12-turn `conversational`
 * session through the plan 182 wire proxy, on one route. It reports per request how much of the input the route
 * served from its prompt cache, next to how much of the request bytes repeated the previous request. It is
 * a `cacheStability` row beside a screen or acceptance verdict, never a criterion. Fixture text only; the
 * report holds counts, token numbers and hashes.
 *
 * Writes happen host-side through a second memory instance over the same store: a live model cannot be scripted
 * to call `memory.insert`/`memory.forget`, and the second instance is also the cross-process case 4.14 revalidates.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PROBE_TURNS = 12;
/** A host-side additive write before this turn: the cache must survive it. */
export const PROBE_INSERT_TURN = 4;
/** A host-side forget before this turn: the one request that may miss. */
export const PROBE_FORGET_TURN = 9;
const CANARY = "canary rollouts go first";
const SECOND = "the retry budget stays small";
const SEED_ID = "aaaaaaaaaaaa";
const scope = { tenantId: "cache-probe", resourceId: "projects/probe--01234567", threadId: "default" };
const PROMPTS = [
  "Say hello in one short sentence.",
  "Name one color in one short sentence.",
  "Name one animal in one short sentence.",
  "Name one city in one short sentence.",
  "Name one fruit in one short sentence.",
  "Name one tool in one short sentence.",
  "Name one river in one short sentence.",
  "Name one instrument in one short sentence.",
  "Name one season in one short sentence.",
  "Name one planet in one short sentence.",
  "Name one metal in one short sentence.",
  "Say goodbye in one short sentence.",
].map((text) => `${text} Do not use tools.`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const round = (value) => Math.round(value * 1e4) / 1e4;

/** Bytes two request bodies share from the start: the most any prefix cache could serve. */
export function sharedPrefixBytes(previous, current) {
  const limit = Math.min(previous.length, current.length);
  let index = 0;
  while (index < limit && previous.charCodeAt(index) === current.charCodeAt(index)) index++;
  return index;
}

/**
 * Per-request rows and the verdict. A request after the first should read from the cache, except the one that follows
 * the forget; the forget request is expected to read less than its predecessor. Pure: no text, only numbers and hashes.
 */
export function analyzeCacheStability(requests, { forgetTurn = PROBE_FORGET_TURN } = {}) {
  const rows = requests.map((request, index) => {
    const previous = requests[index - 1];
    const shared = previous === undefined ? 0 : sharedPrefixBytes(previous.body, request.body);
    return {
      request: index + 1,
      turn: request.turn,
      event: request.event ?? null,
      inputTokens: request.inputTokens,
      cacheReadTokens: request.cacheReadTokens,
      cacheWriteTokens: request.cacheWriteTokens,
      cacheReadShare: request.inputTokens > 0 ? round(request.cacheReadTokens / request.inputTokens) : null,
      cacheablePrefixShare: previous === undefined || request.body.length === 0 ? null : round(shared / request.body.length),
      bodyBytes: Buffer.byteLength(request.body),
      bodySha256: sha256(request.body),
    };
  });
  const breakRow = rows.find((row) => row.turn === forgetTurn);
  const misses = rows.slice(1).filter((row) => row.cacheReadTokens === 0 && row !== breakRow);
  const previous = breakRow ? rows[rows.indexOf(breakRow) - 1] : undefined;
  return {
    kind: "202-cache-stability-row",
    informational: true,
    requests: rows.length,
    firstRequestCacheRead: rows[0]?.cacheReadTokens ?? null,
    requestsReadingCache: rows.slice(1).filter((row) => row.cacheReadTokens > 0).length,
    expectedBreakRequest: breakRow?.request ?? null,
    breakReadsLess: breakRow && previous ? breakRow.cacheReadTokens < previous.cacheReadTokens : null,
    unexpectedMisses: misses.map((row) => row.request),
    status: rows.length > 1 && misses.length === 0 ? "as-expected" : "deviations",
    perRequest: rows,
  };
}

/** The live route: the bench's provider factory behind the wire proxy, with the request bodies seen on the way out. */
export async function liveRoute(ref, { beforeAttempt }) {
  const { liveProviders, loadEnv, refOf } = await import("./run.mjs");
  loadEnv();
  const parsed = refOf(ref);
  const temp = await mkdtemp(join(tmpdir(), "prism-cache-probe-route-"));
  const live = await liveProviders([parsed], temp, { beforeAttempt, maxOutputTokens: 256 });
  const [{ proxy, usageLog }] = live.proxies;
  return {
    model: live.models.get(`${parsed.provider}/${parsed.model}`),
    providers: live.providers,
    async usage() {
      await proxy.drain();
      const text = await readFile(usageLog, "utf8").catch(() => "");
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async close() {
      proxy.stop();
      await rm(temp, { recursive: true, force: true });
    },
  };
}

/**
 * Run the probe on one route. `openRoute(ref, { beforeAttempt })` returns `{ model, providers, usage(), close() }`;
 * tests inject a stub upstream. At most `maxRequests` wire attempts are made; the bound is enforced, not assumed.
 */
export async function runCacheProbe({ ref, turns = PROBE_TURNS, maxRequests = PROBE_TURNS, openRoute = liveRoute } = {}) {
  assert.ok(
    Number.isSafeInteger(turns) && turns >= PROBE_FORGET_TURN && turns <= PROBE_TURNS,
    `turns must be ${PROBE_FORGET_TURN}-${PROBE_TURNS}`,
  );
  const { createAgent } = await import("@arnilo/prism");
  const { providerPackage } = await import("@arnilo/prism/provider-kit");
  const { default: memorySystem, createMemory, createLongTermMemory } = await import("@arnilo/prism-memory-system");
  const { createSqliteMemoryStores } = await import("@arnilo/prism-memory-core/sqlite");
  const dir = await mkdtemp(join(tmpdir(), "prism-cache-probe-"));
  const bodies = [];
  const beforeAttempt = async (_input, init) => {
    if (bodies.length >= maxRequests) throw new Error("MemoryBenchTokenCeiling: cache probe request bound reached");
    bodies.push(typeof init?.body === "string" ? init.body : "");
  };
  let route;
  let stores;
  let agent;
  try {
    route = await openRoute(ref, { beforeAttempt });
    const path = join(dir, "memory.sqlite");
    stores = await createSqliteMemoryStores({ path });
    const memory = createMemory({ ...scope, ...stores });
    const writer = createLongTermMemory({ memory, vectorStore: stores.vectorStore, consolidate: false });
    await writer.remember({ id: SEED_ID, kind: "fact", content: CANARY, scope: "project", keywords: ["canary"] });
    agent = await createAgent({
      model: route.model,
      compaction: false,
      retry: false,
      packages: [
        providerPackage("cache-probe-providers", route.providers),
        memorySystem({ ltm: {
          preset: "conversational",
          tools: { root: dir },
          store: { sqlite: { path } },
          scopes: { tenantId: scope.tenantId, project: { id: "probe--01234567", root: dir }, agent: false, user: false },
        } }),
      ],
    });
    const session = await agent.session({ id: "cache-probe", create: true });
    const turnOfBody = [];
    const events = new Map();
    for (let turn = 1; turn <= turns; turn++) {
      if (turn === PROBE_INSERT_TURN) {
        await writer.remember({ id: "bbbbbbbbbbbb", kind: "fact", content: SECOND, scope: "project" });
        events.set(turn, "insert");
      }
      if (turn === PROBE_FORGET_TURN) {
        await writer.forget({ id: SEED_ID });
        events.set(turn, "forget");
      }
      const before = bodies.length;
      const result = await session.run(PROMPTS[turn - 1]);
      for (let i = before; i < bodies.length; i++) turnOfBody.push(turn);
      assert.equal(
        result.status,
        "completed",
        `cache probe turn ${turn} ${result.status}: ${result.error?.message ?? result.error?.code ?? ""}`,
      );
    }
    const usage = await route.usage();
    assert.equal(usage.length, bodies.length, "every wire attempt must have a usage row");
    const requests = usage.map((row, index) => ({
      turn: turnOfBody[index],
      event: events.get(turnOfBody[index]),
      body: bodies[index],
      inputTokens: row.inputTokens ?? 0,
      cacheReadTokens: row.cacheReadTokens ?? 0,
      cacheWriteTokens: row.cacheWriteTokens ?? 0,
    }));
    const row = analyzeCacheStability(requests);
    return {
      ...row,
      route: ref,
      turns,
      wireAttempts: bodies.length,
      maxRequests,
      schedule: { insertTurn: PROBE_INSERT_TURN, forgetTurn: PROBE_FORGET_TURN },
    };
  } finally {
    await agent?.dispose?.();
    stores?.close?.();
    await route?.close?.();
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const ref = flag("--model");
  assert.ok(ref, "usage: cache-probe.mjs --model <provider/model> [--turns 12] [--out path]  (live: needs an owner gate)");
  const report = await runCacheProbe({ ref, turns: Number(flag("--turns") ?? PROBE_TURNS) });
  const json = `${JSON.stringify({ ...report, sha256: sha256(JSON.stringify(report)) }, null, 2)}\n`;
  if (flag("--out")) {
    await mkdir(dirname(resolve(flag("--out"))), { recursive: true });
    await writeFile(flag("--out"), json);
  } else process.stdout.write(json);
}
