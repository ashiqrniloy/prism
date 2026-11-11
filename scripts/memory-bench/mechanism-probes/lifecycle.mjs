/** Plan 210 Task 2: lifecycle probes (verification, archive, capacity, merge, widening, maintain). */
import { join } from "node:path";
import { digest, fabricAgent, lastHits, packages, SCOPE, scripted, TENANT } from "./harness.mjs";

/** A library-level fabric over one in-memory store; the lifecycle code is the package's own. */
export async function lib({ lifecycle = {}, scopes, memoryFor, ...options } = {}) {
  const { fabric } = await packages();
  const core = await import("@arnilo/prism-memory-system/core");
  const store = core.createMemoryVectorStore();
  const make = (resourceId) => fabric.createMemory({ ...SCOPE, resourceId, vectorStore: store });
  const memory = make(SCOPE.resourceId);
  let clock = 0;
  const f = fabric.createLongTermMemory({
    memory,
    vectorStore: store,
    consolidate: false,
    lifecycle: fabric.resolveLifecycleConfig(lifecycle),
    clock: () => clock,
    ...(scopes ? { scopes: scopes(make, memory) } : {}),
    ...options,
  });
  return {
    fabric: f,
    memory,
    store,
    make,
    setClock: (value) => {
      clock = value;
    },
    async sessions(resourceId, count) {
      for (let i = 0; i < count; i++)
        await store.scopeCounter.increment({ tenantId: TENANT, resourceId, name: fabric.SCOPE_CLOCK_COUNTER });
    },
  };
}

/** Episodes are OM-backed; a raw entry is how the lifecycle example seeds one without a session. */
export async function rawEpisode(memory, id, text, extra = {}) {
  const { fabric } = await packages();
  await memory.remember(
    {
      entries: [
        {
          id,
          text,
          createdAt: "2026-01-01T00:00:00.000Z",
          metadata: { fabric: fabric.encodeMemoryNoteMetadata({ kind: "episode", created: 0, ...extra }), status: "candidate" },
        },
      ],
    },
    { wait: true },
  );
  return { id };
}

const statusOf = async (memory, id) => (await memory.getEntry(id))?.metadata?.status;
const recallDigest = async (f, query, options = {}) =>
  digest((await f.recall(query, { minSimilarity: 0, archiveSearch: false, ...options })).hits.map((hit) => [hit.id, hit.status]));

export const probes = [
  {
    id: "lifecycle.verification",
    async run(root) {
      // Library arm: two distinct sessions verify; the same session twice does not.
      const arm = async (verifyAfterSessions) => {
        const l = await lib({ lifecycle: { verifyAfterSessions } });
        const used = await l.fabric.remember({ kind: "fact", content: "orchard gate code rotates monthly" }, { status: "candidate" });
        await l.fabric.remember({ kind: "fact", content: "orchard gate code rotates weekly" }, { status: "candidate" });
        const sameSession = [
          ...(await l.fabric.recordUses("s1", [used.id], { verifyAfterSessions })),
          ...(await l.fabric.recordUses("s1", [used.id], { verifyAfterSessions })),
        ];
        const second = await l.fabric.recordUses("s2", [used.id], { verifyAfterSessions });
        return {
          verified: second.length,
          sameSession: sameSession.length,
          status: await statusOf(l.memory, used.id),
          d: await recallDigest(l.fabric, "orchard gate code rotates"),
        };
      };
      const on = await arm(2);
      const off = await arm(100);
      // Product arm: the package records a use only when the model cites a shown id.
      const product = async (cite) => {
        const s = scripted();
        let id;
        const h = await fabricAgent(join(root, `product-${cite}`), {
          respond: s.respond,
          seed: async ({ writer }) => {
            id = (
              await writer.remember(
                { kind: "fact", content: "violet orchard retains spare keys", scope: "project" },
                { status: "candidate" },
              )
            ).id;
          },
        });
        try {
          for (const key of ["a", "b"]) {
            s.queue({ calls: [{ name: "memory.recall", args: { query: "violet orchard keys" } }], cite });
            await h.run(key, "where are the spare keys?");
            await h.closeSession(key);
          }
          return (await h.notes()).find((note) => note.id === id)?.metadata?.status;
        } finally {
          await h.close();
        }
      };
      const cited = await product(true);
      const uncited = await product(false);
      return {
        surface: "recall-result",
        property:
          "a candidate cited in verifyAfterSessions distinct sessions becomes verified and ranks before candidates; a retrieval alone or a repeat in one session is not a use",
        fires: on.verified,
        reaches: on.d !== off.d,
        correct:
          on.status === "verified" && on.sameSession === 0 && off.status === "candidate" && cited === "verified" && uncited === "candidate",
        on: on.d,
        off: off.d,
        counts: {
          verified: on.verified,
          productCitedVerified: cited === "verified" ? 1 : 0,
          productUncitedVerified: uncited === "verified" ? 1 : 0,
        },
        finding:
          "Fires only on candidate notes the model cites as [id]. The conversational and coding presets turn promotion off, so their notes are written by tools or the exchange archive, not as candidates; under either preset verification has no eligible note (see the replay rates).",
      };
    },
  },
  {
    id: "lifecycle.archive-revival",
    async run() {
      const arm = async (graceSessions) => {
        const l = await lib({ lifecycle: { archive: { graceSessions } } });
        const stale = await rawEpisode(l.memory, "aaaaaaaaaaa1", "debugging the flaky deploy on friday");
        await l.sessions(SCOPE.resourceId, 40);
        const report = await l.fabric.maintain();
        const d = await recallDigest(l.fabric, "flaky deploy friday", { kinds: ["all"] });
        await l.fabric.recordUses("revive", [stale.id], { clock: 40 });
        return {
          archived: report.archived,
          d,
          revived: await statusOf(l.memory, stale.id),
          verb: (await l.memory.getEntry(stale.id))?.metadata?.auditVerb,
        };
      };
      const on = await arm(10);
      const off = await arm(10_000);
      return {
        surface: "recall-result",
        property:
          "a note below both strength thresholds past the grace window is archived (hidden from active recall), and a citation revives it",
        fires: on.archived,
        reaches: on.d !== off.d,
        correct: on.archived === 1 && off.archived === 0 && on.revived === "candidate" && on.verb === "revived",
        on: on.d,
        off: off.d,
        counts: { archived: on.archived },
      };
    },
  },
  {
    id: "lifecycle.capacity-eviction",
    async run() {
      const arm = async (notes) => {
        const l = await lib({ lifecycle: { capacity: { project: { notes, tokens: 60_000 } } } });
        const ids = [];
        for (const content of [
          "amber pipeline uses the shared runner",
          "birch cluster pages oncall at night",
          "cedar invoices close on fridays",
          "delta mirrors sync hourly from origin",
          "ember dashboards hide archived tenants",
        ])
          ids.push((await l.fabric.remember({ kind: "fact", content }, { status: "candidate" })).id);
        await l.fabric.pin(ids[0]);
        const report = await l.fabric.maintain();
        return {
          evicted: report.evicted,
          pinned: await statusOf(l.memory, ids[0]),
          d: await recallDigest(l.fabric, "amber birch cedar delta ember", { topK: 10 }),
          over: report.overBudget.length,
        };
      };
      const on = await arm(2);
      const off = await arm(500);
      return {
        surface: "recall-result",
        property: "over budget, the lowest S·exp(R) notes are evicted to the archive until the scope fits; a pinned note is never evicted",
        fires: on.evicted,
        reaches: on.d !== off.d,
        correct: on.evicted === 3 && on.pinned === "candidate" && off.evicted === 0 && on.over === 0,
        on: on.d,
        off: off.d,
        counts: { evicted: on.evicted },
      };
    },
  },
  {
    id: "lifecycle.exchange-capacity",
    async run() {
      const arm = async (hotTokens) => {
        const l = await lib({ lifecycle: { exchangeCapacity: { hotTokens } } });
        for (const word of ["first", "second", "third", "fourth"])
          await l.fabric.remember({
            kind: "exchange",
            content: `user asked about the ${word} release train schedule and the reply listed dates`,
          });
        const report = await l.fabric.maintain();
        return { evicted: report.evicted, d: await recallDigest(l.fabric, "release train schedule", { kinds: ["exchange"], topK: 10 }) };
      };
      const on = await arm(40);
      const off = await arm(200_000);
      return {
        surface: "recall-result",
        property: "exchanges over hotTokens are demoted to the searchable archive (never deleted), oldest/weakest first",
        fires: on.evicted,
        reaches: on.d !== off.d,
        correct: on.evicted > 0 && on.evicted < 4 && off.evicted === 0,
        on: on.d,
        off: off.d,
        counts: { demoted: on.evicted },
      };
    },
  },
  {
    id: "lifecycle.duplicate-merge",
    async run() {
      const arm = async (duplicateDice) => {
        const l = await lib({ lifecycle: { capacity: { project: { notes: 3, tokens: 60_000 } }, merge: { duplicateDice } } });
        const a = await l.fabric.remember(
          { kind: "fact", content: "the staging database restarts every night at two" },
          { status: "candidate" },
        );
        const b = await l.fabric.remember(
          { kind: "fact", content: "the staging database restarts every night at two am" },
          { status: "candidate" },
        );
        await l.fabric.remember({ kind: "fact", content: "ledger rotation happens quarterly" }, { status: "candidate" });
        await l.fabric.remember({ kind: "fact", content: "the mailroom closes at five" }, { status: "candidate" });
        // The duplicates were used, so plain eviction would drop the unused distinct note instead.
        await l.fabric.recordUses("s1", [a.id, b.id], { clock: 0 });
        const report = await l.fabric.maintain();
        const meta = await Promise.all([a, b].map(async (n) => (await l.memory.getEntry(n.id))?.metadata));
        return {
          merged: report.merged,
          evicted: report.evicted,
          mergedInto: meta.some((m) => m?.auditVerb === "merged"),
          d: await recallDigest(l.fabric, "ledger rotation quarterly mailroom closes five", { topK: 10 }),
        };
      };
      const on = await arm(0.8);
      const off = await arm(1);
      return {
        surface: "recall-result",
        property:
          "over budget, near-duplicates (Dice ≥ duplicateDice) fold into one survivor before any eviction, so a distinct note survives",
        fires: on.merged,
        reaches: on.d !== off.d,
        correct: on.merged === 1 && on.mergedInto && off.merged === 0,
        on: on.d,
        off: off.d,
        counts: { merged: on.merged, evictedOn: on.evicted, evictedOff: off.evicted },
      };
    },
  },
  {
    id: "lifecycle.widen-narrow",
    async run() {
      const arm = async (minProjects) => {
        const l = await lib({ lifecycle: { widen: { minProjects } } });
        const a = l.make("projects/alpha--11111111");
        const b = l.make("projects/beta--22222222");
        const agent = l.make("agent");
        const { fabric } = await packages();
        const projectFabric = (memory) =>
          fabric.createLongTermMemory({
            memory,
            scopes: [
              { level: "project", memory },
              { level: "agent", memory: agent },
            ],
            vectorStore: l.store,
            consolidate: false,
          });
        const inA = projectFabric(a);
        const inB = projectFabric(b);
        const lesson = "Drain the canary pool before every rollback";
        const ids = [
          (await inA.remember({ kind: "procedure", key: "canary.drain", content: lesson })).id,
          (await inB.remember({ kind: "procedure", key: "canary.drain", content: lesson })).id,
        ];
        for (const id of ids) {
          await inA.recordUses("s1", [id], { clock: 1, verifyAfterSessions: 2 });
          await inB.recordUses("s2", [id], { clock: 2, verifyAfterSessions: 2 });
        }
        const maintainer = fabric.createLongTermMemory({
          memory: a,
          scopes: [
            { level: "project", memory: a },
            { level: "project", memory: b },
            { level: "agent", memory: agent },
          ],
          vectorStore: l.store,
          lifecycle: fabric.resolveLifecycleConfig({ widen: { minProjects } }),
          consolidate: false,
        });
        const report = await maintainer.maintain();
        // A third project sees the widened lesson only through the agent scope.
        const c = projectFabric(l.make("projects/gamma--33333333"));
        const seen = (await c.recall("canary pool rollback", { minSimilarity: 0, kinds: ["procedure"] })).hits.length;
        // Single-project text never widens.
        return { widened: report.widened, seen, d: digest(seen) };
      };
      const on = await arm(2);
      const off = await arm(10);
      return {
        surface: "recall-result",
        property:
          "a lesson verified with the same normalized text in minProjects projects widens to the agent scope, readable from a third project",
        fires: on.widened,
        reaches: on.d !== off.d,
        correct: on.widened >= 1 && on.seen >= 1 && off.widened === 0 && off.seen === 0,
        on: on.d,
        off: off.d,
        counts: { widened: on.widened },
      };
    },
  },
  {
    id: "lifecycle.maintain",
    async run(root) {
      const arm = async (name, run) => {
        const h = await fabricAgent(join(root, name), {
          config: { lifecycle: { capacity: { project: { notes: 1, tokens: 60_000 } } } },
          seed: async ({ writer }) => {
            await writer.remember({ kind: "fact", content: "runner alpha", scope: "project" }, { status: "candidate" });
            await writer.remember({ kind: "fact", content: "runner beta", scope: "project" }, { status: "candidate" });
          },
        });
        try {
          const report = run ? await h.command("memory:maintain", {}) : undefined;
          const life = await h.command("memory:lifecycle", {}).catch(() => undefined);
          return { report, life, d: digest((await h.notes()).map((n) => n.metadata?.status)) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "command-result",
        property: "memory:maintain runs one pass and reports its counts; memory:lifecycle reports the lifecycle state",
        fires: on.report === undefined ? 0 : 1,
        reaches: on.d !== off.d,
        correct: on.report?.evicted === 1 && typeof on.report?.text === "string" && on.life !== undefined,
        on: on.d,
        off: off.d,
        counts: { evicted: on.report?.evicted ?? 0, lifecycleCommand: on.life === undefined ? 0 : 1 },
      };
    },
  },
];

void lastHits;
