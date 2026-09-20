import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHashEmbedder, createMemory, MemoryLimitError, MemoryValidationError } from "@arnilo/prism-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";
import { createScopedMemoryPolicy } from "@arnilo/prism-memory/scoped";

// Scoped memory demo: policy layer over fabric + createMemory.
//
// What this shows:
//   1. Scope guard: resourceId must equal resolved scopeRoot; threadId required.
//   2. Facts block write + overflow ("consolidate first").
//   3. Post-run reviewer (fake provider) writes candidate facts.
//   4. Recall: abstain floor + topK budget; second use then promotionPass.
//   5. GC proposes an unused candidate; approve forgets it; renderMirror.
//
// Network-free: hash embedder, in-memory stores, fake reviewer.
//
// Run: node examples/scoped-memory.ts

const scopeRoot = await mkdtemp(join(tmpdir(), "scoped-demo-"));
const memory = createMemory({
  tenantId: "demo",
  resourceId: scopeRoot,
  threadId: "scoped",
  embedder: createHashEmbedder({ dimensions: 8 }),
});
const fabric = createMemoryFabric({ memory, consolidate: false });

try {
  createScopedMemoryPolicy({ memory, fabric, scopeRoot: join(scopeRoot, "nope") });
  throw new Error("mismatched scopeRoot should fail closed");
} catch (error) {
  if (!(error instanceof MemoryValidationError)) throw error;
}

const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot });

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
await policy.recall("alphazebra uniquequeryxyz staging ssh");
const promoted = await policy.promotionPass();
if (promoted.promoted !== 1) throw new Error("second use should promote the recalled candidate");

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

const ledgerFile = join(scopeRoot, ".memory", "state.json");
const ledger = JSON.parse(await readFile(ledgerFile, "utf8")) as {
  notes: Record<string, { uses?: number; createdAt?: string }>;
};
const staleId = Object.keys(ledger.notes).find((id) => (ledger.notes[id]?.uses ?? 0) === 0);
if (!staleId) throw new Error("expected an unused candidate for GC");
ledger.notes[staleId]!.createdAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
await writeFile(ledgerFile, JSON.stringify(ledger));

const gc = await policy.gcPass();
if (gc.proposed !== 1) throw new Error("gcPass should propose the stale candidate");
const archive = (await policy.pending()).find((item) => item.kind === "archive");
if (!archive) throw new Error("pending should include the archive proposal");
await policy.approve(archive.id);
await policy.renderMirror();

const notes = await readdir(join(scopeRoot, ".memory", "notes"));
const health = await policy.health();
console.log(
  `scoped-memory: miss.abstained=${miss.abstained} promoted=${promoted.promoted} gc=${gc.proposed} mirror=${notes.length} verified=${health.notes.verified}`,
);
