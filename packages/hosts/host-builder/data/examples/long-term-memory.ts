import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createHashEmbedder, type Embedder } from "@arnilo/prism-memory-system/core";
import { createMarkdownMemoryStores } from "@arnilo/prism-memory-system/core/fabric";
import memorySystem, { createMemory, createLongTermMemory } from "@arnilo/prism-memory-system";

// Network-free: session one consolidates an explicit statement into a typed project note through
// `memory:consolidate` and archives the turn itself through `memory:archive`; a second process (a
// fresh agent over the same markdown store) recalls both the fact and the verbatim exchange.
// The store is canonical note files under `<root>/notes` with a derived SQLite index. A third agent
// roots a different project at the same store: it sees the shared user preference but not the first
// project's fact.
const FACT = "Prefer the smallest retry budget.";
const root = await mkdtemp(join(tmpdir(), "prism-long-term-memory-"));

const embeddings = definePackage({
  name: "@example/embeddings",
  version: "0.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.services.provide<Embedder>("embeddings", createHashEmbedder({ dimensions: 32, id: "demo-embeddings" }));
  },
});

try {
  // A preference in the shared `user` scope, written before either project opens the store.
  const seeded = await createMarkdownMemoryStores({ root: join(root, "notes") });
  const userMemory = createMemory({
    tenantId: "prism",
    resourceId: "user",
    threadId: "default",
    vectorStore: seeded.vectorStore,
  });
  await createLongTermMemory({ memory: userMemory, consolidate: false }).remember({
    kind: "preference",
    content: "Prefer terse changelog entries",
    scope: "user",
  });
  await seeded.close();

  const first = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider([
        [providerTextDelta("noted"), providerDone()],
        [
          providerToolCall(
            toolCallContent("n1", "record_notes", {
              notes: [
                {
                  text: FACT,
                  kind: "fact",
                  scope: "project",
                  keywords: ["retry", "budget"],
                  aliases: [],
                  evidence: ["c1"],
                  explicit: true,
                  correction: false,
                  generality: 1,
                  ephemerality: 0,
                  derivable: false,
                },
              ],
            }),
          ),
          providerDone(),
        ],
      ]),
      embeddings(),
      // One extractor call per pass; the command runs regardless of minTurnsBetween.
      memorySystem({ ltm: { tools: { root }, promote: { minTurnsBetween: 8 }, exchanges: {} } }),
    ],
    slots: { store: createMemorySessionStore() },
  });
  const firstSession = await first.session({ id: "session-one", create: true });
  await firstSession.run("Always keep the retry budget small.");
  const consolidated = (await first.commands.run("memory:consolidate", {}, { session: firstSession })) as { written: number };
  console.log(`session one: memory:consolidate wrote ${consolidated.written} project note(s)`);
  const archived = (await first.commands.run("memory:archive", {}, { session: firstSession })) as { totalArchived: number };
  console.log(`session one: exchange archive holds ${archived.totalArchived} turn(s) for this session`);
  await first.dispose();

  const results: string[] = [];
  const second = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider(
        [
          [providerToolCall(toolCallContent("c1", "memory.recall", { query: "retry budget", kinds: ["fact"] })), providerDone()],
          [providerTextDelta("recalled"), providerDone()],
          [providerToolCall(toolCallContent("c2", "memory.recall", { query: "retry budget", kinds: ["exchange"] })), providerDone()],
          [providerTextDelta("recalled"), providerDone()],
        ],
        {
          onRequest: (request) => {
            const last = request.messages.at(-1);
            if (last?.role === "tool") results.push(JSON.stringify(last.content));
          },
        },
      ),
      embeddings(),
      memorySystem({ ltm: { tools: { root } } }),
    ],
  });
  const secondSession = await second.session({ id: "session-two", create: true });
  await secondSession.run("What do you know about retries?");
  await secondSession.run("What exactly did we say about the retry budget?");
  const recalled = results.join("\n");
  console.log(
    "session two:",
    `${recalled.includes("smallest retry budget") ? "recalled the fact" : "no fact"} and ${recalled.includes("Always keep the retry budget small.") ? "the verbatim exchange" : "no exchange"} from the markdown store`,
  );
  await second.dispose();

  const other: string[] = [];
  const third = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider(
        [
          [providerToolCall(toolCallContent("c1", "memory.recall", { query: "retry budget" })), providerDone()],
          [providerTextDelta("nothing"), providerDone()],
          [providerToolCall(toolCallContent("c2", "memory.recall", { query: "changelog preference" })), providerDone()],
          [providerTextDelta("recalled"), providerDone()],
        ],
        {
          onRequest: (request) => {
            const last = request.messages.at(-1);
            if (last?.role === "tool") other.push(JSON.stringify(last.content));
          },
        },
      ),
      embeddings(),
      memorySystem({ ltm: { tools: { root }, scopes: { project: { id: "other--00000001" } } } }),
    ],
  });
  const thirdSession = await third.session({ id: "session-three", create: true });
  await thirdSession.run("What do you know about retries?");
  const factCrossed = other.join("\n").includes("smallest retry budget");
  await thirdSession.run("What do I prefer for changelogs?");
  const preferenceShared = other.join("\n").includes("terse changelog entries");
  if (factCrossed || !preferenceShared) throw new Error("cross-project isolation failed");
  console.log("session three:", "shared preference recalled; project fact stayed in project one");
  await third.dispose();
} finally {
  await rm(root, { recursive: true, force: true });
}
