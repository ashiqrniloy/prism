#!/usr/bin/env node
/**
 * Plan 080 Task 9: bounded soak runner for the messaging runtime.
 *
 * Exercises the durable path in a loop — admit (with repeats that must dedup) → drain →
 * listUnresolved/reconcile → prune — against a throwaway sqlite file and a mock provider.
 * No network, no chat accounts, no credentials: it is a script, not a library daemon.
 *
 *   node scripts/fixtures/messaging-soak.mjs --durationMs 3000            # CI smoke
 *   node scripts/fixtures/messaging-soak.mjs --durationMs 259200000       # 72h operator soak
 *   node scripts/fixtures/messaging-soak.mjs --iterations 200 --lanes 8   # iteration-bounded
 *
 * Prints one JSON summary line, exits 0 when the run is clean (or interrupted by SIGINT/SIGTERM).
 * The final sweep prunes with a future `now` so a short CI run still exercises deletion; a real
 * soak deletes by wall clock under the configured retention.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, providerDone, providerTextDelta } from "../../dist/index.js";
import { createMessagingRuntime } from "../../packages/prism-channels/dist/index.js";
import { createSqlitePersistence } from "../../packages/prism-core/dist/sessions/sqlite/index.js";

const DEFAULT_DURATION_MS = 30_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60_000;
const USAGE = "usage: node scripts/fixtures/messaging-soak.mjs [--durationMs n] [--iterations n] [--lanes n] [--pruneEvery n]";

function boundedInteger(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return parsed;
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  if (flag === "--help") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (!flag?.startsWith("--") || process.argv[index + 1] === undefined) throw new Error(`${USAGE}\nunexpected argument: ${flag}`);
  args.set(flag.slice(2), process.argv[index + 1]);
}
if (args.has("help")) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const durationMs = boundedInteger(args.get("durationMs"), DEFAULT_DURATION_MS, 100, MAX_DURATION_MS, "--durationMs");
const iterations = boundedInteger(args.get("iterations"), 0, 0, 10_000_000, "--iterations");
const lanes = boundedInteger(args.get("lanes"), 4, 1, 64, "--lanes");
const pruneEvery = boundedInteger(args.get("pruneEvery"), 25, 1, 10_000, "--pruneEvery");

const identity = {
  tenantId: "soak-tenant",
  userId: "soak-user",
  principal: { kind: "user", id: "soak-user" },
  scopes: ["chat"],
  issuedAt: "1970-01-01T00:00:00.000Z",
  verified: true,
};
const CONNECTION = "soak";
const RETENTION_DAYS = 7;

const provider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("soak reply");
    yield providerDone();
  },
};

let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
});
process.on("SIGTERM", () => {
  interrupted = true;
});
for (const fatal of ["uncaughtException", "unhandledRejection"]) {
  process.on(fatal, (error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, uncaught: fatal, error: error?.message ?? String(error) })}\n`);
    process.exit(1);
  });
}

const dir = mkdtempSync(join(tmpdir(), "prism-channels-soak-"));
const summary = {
  ok: true,
  durationMs: 0,
  iterations: 0,
  admitted: 0,
  repeatAttempts: 0,
  duplicates: 0,
  denied: 0,
  delivered: 0,
  uniqueReplies: 0,
  unsettled: 0,
  reconciled: 0,
  unresolvedSeen: 0,
  pruned: { scanned: 0, deleted: 0, retained: 0 },
  lanes,
  diagnostics: undefined,
};
const started = Date.now();
const deadline = started + durationMs;
const lanesSeen = new Set();
const deliveredTexts = new Set();
let deliveredCount = 0;
const persistence = createSqlitePersistence({ filename: join(dir, "soak.sqlite") });

try {
  const agent = createAgent({
    id: "soak-agent",
    model: { provider: "mock", model: "soak" },
    provider,
    store: persistence,
    runLedger: persistence,
  });
  const runtime = createMessagingRuntime({
    authorize: () => ({ identity, agentAliases: ["primary"], grantRevision: "rev-1" }),
    resolveAgent: () => agent,
    deliver: (reply) => {
      deliveredCount += 1;
      deliveredTexts.add(reply.text);
      return { delivered: true };
    },
    limits: { retentionDays: RETENTION_DAYS },
    checkpoints: persistence.checkpoints,
    leases: persistence.leases,
  });

  while (!interrupted && Date.now() < deadline && (iterations === 0 || summary.iterations < iterations)) {
    summary.iterations += 1;
    const lane = summary.iterations % lanes;
    const externalConversationId = `chat-${lane}`;
    const externalActorId = `user-${lane}`;
    lanesSeen.add(lane);
    const admitted = await runtime.admit({
      connectionId: CONNECTION,
      externalConversationId,
      externalActorId,
      eventId: `soak-${summary.iterations}`,
      text: `iteration ${summary.iterations}`,
    });
    if (admitted.status !== "accepted") summary.denied += 1;
    else summary.admitted += 1;
    const drained = await runtime.drain({ deadlineMs: 5_000 });
    if (!drained.settled) summary.unsettled += 1;

    if (summary.iterations % pruneEvery === 0) {
      // The same event id again: the journal must answer as a duplicate, not a second run.
      summary.repeatAttempts += 1;
      const repeat = await runtime.admit({
        connectionId: CONNECTION,
        externalConversationId,
        externalActorId,
        eventId: `soak-${summary.iterations}`,
        text: `iteration ${summary.iterations}`,
      });
      if (repeat.duplicate === true) summary.duplicates += 1;
      for (const record of await runtime.listUnresolved({ identity })) {
        summary.unresolvedSeen += 1;
        const outcome = await runtime.reconcile({
          identity,
          connectionId: record.connectionId,
          operationId: record.operationId,
          expectedVersion: record.version,
          acknowledgeDuplicateRisk: true,
        });
        if (outcome.status === "resolved") summary.reconciled += 1;
      }
      const sweep = await runtime.prune({ identity });
      summary.pruned.scanned += sweep.scanned;
      summary.pruned.deleted += sweep.deleted;
      summary.pruned.retained += sweep.retained;
    }

    // SQLite is synchronous, so every await above can resolve in the same microtask drain: without
    // a macrotask boundary SIGINT/SIGTERM and timers would starve for the whole soak. One
    // `setImmediate` every 16 iterations costs nothing across 72h and keeps Ctrl-C/stop responsive.
    if (summary.iterations % 16 === 0) await new Promise((resolve) => setImmediate(resolve));
  }

  const remaining = await runtime.listUnresolved({ identity });
  summary.unresolvedAtEnd = remaining.length;
  // Future cutoff: prove the delete path on a short run (a real soak ages records by wall clock).
  const agedCutoff = new Date(Date.now() + (RETENTION_DAYS + 1) * 24 * 60 * 60_000).toISOString();
  const finalSweep = await runtime.prune({ identity, now: agedCutoff });
  summary.pruned.scanned += finalSweep.scanned;
  summary.pruned.deleted += finalSweep.deleted;
  summary.pruned.retained += finalSweep.retained;
  summary.delivered = deliveredCount;
  summary.uniqueReplies = deliveredTexts.size;
  await runtime.stop();
  summary.diagnostics = runtime.diagnostics();
  // One delivery per accepted turn, every repeated event deduped, nothing denied or left unresolved.
  summary.ok =
    remaining.length === 0 &&
    summary.unsettled === 0 &&
    summary.denied === 0 &&
    summary.delivered === summary.admitted &&
    summary.duplicates === summary.repeatAttempts &&
    summary.diagnostics.admitted === summary.admitted + summary.repeatAttempts &&
    summary.diagnostics.deliveries === summary.delivered &&
    summary.diagnostics.failed === 0;
} catch (error) {
  summary.ok = false;
  summary.error = error?.message ?? String(error);
} finally {
  persistence.close();
  rmSync(dir, { recursive: true, force: true });
}

summary.durationMs = Date.now() - started;
summary.interrupted = interrupted;
summary.lanesSeen = lanesSeen.size;
console.log(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);
