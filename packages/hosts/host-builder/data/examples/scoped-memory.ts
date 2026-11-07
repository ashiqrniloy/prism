import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLimitError, createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, createMemoryWorkingStore, createScopedMemoryPolicy } from "@arnilo/prism-memory-fabric";

// Scoped memory demo: policy layer over fabric + createMemory.
//
// What this shows:
//   1. The ledger root is independent of the memory's resourceId.
//   2. Facts block write + overflow ("consolidate first").
//   3. Post-run reviewer (fake provider) writes candidate facts.
//   4. Recall: abstain floor + topK budget; a candidate verifies after two sessions cite it.
//   5. GC proposes an unused candidate; approve forgets it; renderMirror.
//   6. Cross-project scopes: a user preference crosses projects, a project fact and a path
//      note stay inside their project, and a touched path earns the path note its prior.
//
// Network-free: hash embedder, in-memory stores, fake reviewer.
//
// Run: node examples/scoped-memory.ts

const scopeRoot = await mkdtemp(join(tmpdir(), "scoped-demo-"));
const memory = createMemory({
  tenantId: "demo",
  resourceId: "projects/scoped-demo--00000000",
  threadId: "scoped",
  embedder: createHashEmbedder({ dimensions: 8 }),
});
const fabric = createMemoryFabric({ memory, consolidate: false });

// The archive rule is measured in scope sessions, so the demo pins one ordinal. Everything the
// sessions used stays above the thresholds; the note nothing ever cited falls below both.
const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot, clock: () => 200 });

await policy.rememberFact("SSH jump host listens on 2222");
try {
  await policy.rememberFact("x".repeat(2200));
  throw new Error("facts overflow should throw");
} catch (error) {
  if (!(error instanceof MemoryLimitError) || !error.message.includes("consolidate first")) throw error;
}

const miss = await policy.recall("unladenswallow airspeed");
if (!miss.abstained) throw new Error("empty library should abstain");

const reviewer = async () => [
  {
    kind: "fact" as const,
    content: "alphazebra uniquequeryxyz staging ssh listens on port 2222",
    sourceEntryIds: ["aaaaaaaaaaaa"],
  },
];
const reviewed = await policy.reviewSession("User said SSH is 2222 not 22. Remember this.", { reviewer });
if (reviewed.written !== 1 || reviewed.status.candidate !== 1) throw new Error("reviewer should write one candidate");

const hit = await policy.recall("alphazebra uniquequeryxyz staging ssh");
if (hit.abstained || hit.hits.length === 0) throw new Error("expected a recall hit above the floor");
if (hit.hits.length > policy.settings.activation.topK) throw new Error("recall exceeded activation.topK");
const recalledId = hit.hits[0]!.id;
const verifiedByUse = (await fabric.recordUses("demo-session-1", [recalledId], { verifyAfterSessions: 2 })).length === 0;
await fabric.recordUses("demo-session-2", [recalledId], { verifyAfterSessions: 2 });
const verified = (await fabric.recall("alphazebra uniquequeryxyz staging ssh")).hits[0]?.status;
if (!verifiedByUse || verified !== undefined && verified !== "verified") throw new Error("two citing sessions should verify the candidate");

const stale = await policy.reviewSession("User said drain the canary pool first. Remember this.", {
  reviewer: async () => [
    {
      kind: "fact" as const,
      content: "betameadow foxtrotnoon drain canary pool before rollback",
      sourceEntryIds: ["bbbbbbbbbbbb"],
    },
  ],
});
if (stale.written !== 1) throw new Error("stale candidate should write");
// The freshly reviewed candidate is used in this session, which keeps it out of the proposal.
const freshId = (await fabric.recall("betameadow foxtrotnoon drain canary")).hits[0]?.id;
if (freshId === undefined) throw new Error("expected the fresh candidate to be recallable");
await fabric.recordUses("demo-session-3", [freshId], { clock: 200 });

// One candidate nothing will ever cite: written at the first session, used once, then abandoned for
// two hundred sessions, so both strengths fall below the archive thresholds.
const staleId = "abcdefabcdef";
const abandonedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
await memory.remember(
  {
    entries: [
      {
        id: staleId,
        text: "gammasandbox hotelindigo unused candidate",
        createdAt: abandonedAt,
        metadata: {
          fabric: { v: 1, kind: "fact", created: 0, uses: [{ s: 0, at: abandonedAt }], useSessions: 1 },
          status: "candidate",
        },
      },
    ],
  },
  { wait: true },
);

const gc = await policy.gcPass();
if (gc.proposed !== 1) throw new Error("gcPass should propose the stale candidate");
const archive = (await policy.pending()).find((item) => item.kind === "archive");
if (!archive) throw new Error("pending should include the archive proposal");
await policy.approve(archive.id);
await policy.renderMirror();

const notes = await readdir(join(scopeRoot, ".memory", "notes"));
const health = await policy.health();
// Cross-project scopes over shared stores: `user` is one resource both projects bind, while
// each project has its own resource. A path note lives in its project and applies to a glob.
const stores = { vectorStore: createMemoryVectorStore(), workingStore: createMemoryWorkingStore() };
const projectA = createMemory({ tenantId: "demo", resourceId: "projects/alpha--00000001", threadId: "default", ...stores });
const projectB = createMemory({ tenantId: "demo", resourceId: "projects/beta--00000002", threadId: "default", ...stores });
const user = createMemory({ tenantId: "demo", resourceId: "user", threadId: "default", ...stores });
const inA = createMemoryFabric({
  memory: projectA,
  scopes: [
    { level: "project", memory: projectA },
    { level: "user", memory: user },
  ],
  consolidate: false,
});
const inB = createMemoryFabric({
  memory: projectB,
  scopes: [
    { level: "project", memory: projectB },
    { level: "user", memory: user },
  ],
  consolidate: false,
});

const preference = await inA.remember({ kind: "preference", content: "Prefer pnpm for shared scripts", scope: "user" });
const factA = await inA.remember({ kind: "fact", content: "Alpha rollout uses a blue canary", key: "rollout.color" });
const pathNote = await inA.remember({
  kind: "procedure",
  content: "Release checklist for alpha",
  scope: "path",
  appliesTo: ["src/**"],
});
const preferenceSeen = (await inB.recall("shared scripts pnpm", { topK: 5 })).hits.some((hit) => hit.id === preference.id);
const factLeaked = (await inB.recall("alpha rollout canary", { topK: 5 })).hits.some((hit) => hit.id === factA.id);
const pathHit = await inA.recall("release checklist alpha", { topK: 5, kinds: ["procedure"], touchedPaths: ["src/release.ts"] });
const pathSeen = pathHit.hits.some((hit) => hit.id === pathNote.id);
const pathLeaked = (await inB.recall("release checklist alpha", { topK: 5, kinds: ["procedure"], touchedPaths: ["src/release.ts"] })).hits.some(
  (hit) => hit.id === pathNote.id,
);
if (!preferenceSeen || factLeaked || !pathSeen || pathLeaked) throw new Error("cross-project scope isolation failed");

console.log(
  `scoped-memory: miss.abstained=${miss.abstained} verified=${verified ?? "verified"} gc=${gc.proposed} mirror=${notes.length} verified-notes=${health.notes.verified}`,
);
console.log(
  `cross-project: preference-shared=${preferenceSeen} project-fact-isolated=${!factLeaked} path-note=${pathSeen} path-isolated=${!pathLeaked}`,
);
