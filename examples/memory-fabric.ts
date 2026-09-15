import {
  createAgentSession,
  createContributionRegistries,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveAgentDefinition,
  resolveContextProviders,
  toolCallContent,
  type AIProvider,
  type AgentDefinition,
} from "@arnilo/prism";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "@arnilo/prism-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";

// Memory fabric demo: typed notes over the memory stores a host already has.
//
// What this shows:
//   1. Notes: a fact, a procedure (never in an untyped recall), and a working block.
//   2. The write path folds a repeated fact in place and supersedes a changed one
//      (old row keeps its id and gains `validTo`; the new row carries `supersedes`).
//   3. `attach(session)` is the session gate: the tools only serve an attached session,
//      and the opt-in workers (here: the linker) only run while one is attached.
//   4. The context seam: `createContextProvider()` returns the blocks `createMemory`
//      resolves, registered under a host-chosen name for `AgentDefinition.context`.
//
// Network-free: hash embedder, in-memory stores, mock provider.
//
// Run: node examples/memory-fabric.ts

const memory = createMemory({
  tenantId: "demo",
  resourceId: "user-ada",
  threadId: "thread-1",
  embedder: createHashEmbedder({ dimensions: 64 }),
  vectorStore: createMemoryVectorStore(),
  workingStore: createMemoryWorkingStore(),
  // The fabric's blocks live inside the working value under `_fabric`; the host template decides
  // what renders. Both keys below are public: `MEMORY_FABRIC_WORKING_KEY` and the block label.
  workingMemoryTemplate: "Name: {{name}}; notes: {{_fabric.blocks.core.content}}",
});
await memory.updateWorking({ name: "Ada" });

const fabric = createMemoryFabric({ memory, linker: { enabled: true, topK: 3 } });

// 1. Notes. `procedure` stays out of a plain recall; `working` is a labeled block.
const fact = await fabric.remember({ kind: "fact", content: "Deploys go out behind a canary", tags: ["deploy"] });
await fabric.remember({ kind: "procedure", content: "Roll back by draining the canary pool first" });
await fabric.remember({ kind: "working", block: "core", content: "Ada prefers terse commit messages" });

const plain = await fabric.recall("canary deploys");
const withProcedures = await fabric.recall("roll back a canary", { kinds: ["fact", "procedure"] });
if (plain.hits.some((hit) => hit.kind === "procedure")) throw new Error("procedure leaked into an untyped recall");
if (!withProcedures.hits.some((hit) => hit.kind === "procedure")) throw new Error("explicit kinds did not return the procedure");

// 2. Write path: same note folds in place, changed note supersedes.
const folded = await fabric.remember({ kind: "fact", content: "Deploys go out behind a canary", keywords: ["deploy", "rollout"] });
if (folded.id !== fact.id) throw new Error("an identical note should fold into the same row");
const changed = await fabric.remember({ kind: "fact", content: "Deploys go out behind a canary and a feature flag" });
if (changed.supersedes !== fact.id) throw new Error("a changed fact should supersede the old row");
const now = await fabric.recall("canary deploys", { kinds: ["fact"] });
if (now.hits.some((hit) => hit.id === fact.id)) throw new Error("the superseded row is still current");
if (now.explain.some((entry) => entry.link)) console.log("linked neighbors arrived through a `links` edge");

// 3. Session gate: a host registers the provider and the tools on a definition, then attaches
//    the session. Without the attach call every tool below fails closed with `not_attached`.
const definition: AgentDefinition = {
  name: "assistant",
  model: { provider: "mock", model: "demo" },
  context: ["memory-fabric"],
  tools: ["memory.recall"],
  instructions: "Answer using the memory fabric. Cite the note you used.",
};

let round = 0;
const provider: AIProvider = {
  id: "mock",
  async *generate() {
    if (round++ === 0) {
      yield providerToolCall(toolCallContent("call-1", "memory.recall", { query: "canary deploys" }));
      yield providerDone();
      return;
    }
    yield providerTextDelta("Deploys go out behind a canary and a feature flag.");
    yield providerDone();
  },
};

const registries = createContributionRegistries();
registries.contextProviders.register("memory-fabric", fabric.createContextProvider({ includeWorking: true }));
const recallTool = fabric.tools().find((tool) => tool.name === "memory.recall");
if (recallTool === undefined) throw new Error("the fabric did not expose memory.recall");
registries.tools.register("memory.recall", recallTool);

const agent = await resolveAgentDefinition(definition, { registries, providerSource: () => provider });
const session = createAgentSession({ agent });
const attached = fabric.attach(session);
const run = await session.run("How do deploys go out?");
if (round !== 2) throw new Error("the model never called the fabric tool");
console.log(`ran ${run.leafId} with the memory.recall tool; workers ${attached.settings.linker.enabled ? "on" : "off"}`);

// 4. Context seam: the registered provider resolves blocks for the next turn. The attention
//    compiler is not enabled here — blocks still reach the provider input.
const blocks = await resolveContextProviders({
  providers: [attached.contextProvider],
  messages: [{ role: "user", content: [{ type: "text", text: "How do deploys go out?" }] }],
});
for (const block of blocks) console.log(`${block.title} (${String(block.metadata?.source)}) -> ${String(block.content).slice(0, 60)}...`);

// A host can take the gate away again; notes stay until they are forgotten.
attached.detach();
const kept = (await fabric.recall("canary deploys", { kinds: ["fact"] })).hits.length;
await fabric.forget({ id: changed.id });
await fabric.forget({ block: "core" });
const left = (await fabric.recall("canary deploys", { kinds: ["fact"] })).hits.length;
console.log(`detach kept ${kept} current note(s); forget dropped it to ${left}`);
