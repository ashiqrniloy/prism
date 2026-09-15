import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createContributionRegistries,
  resolveContextProviders,
  type JsonObject,
  type Message,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "@arnilo/prism";
import { MemoryAbortError, MemoryValidationError } from "../../errors.js";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "../../index.js";
import { createMemoryFabric, DEFAULT_MEMORY_FABRIC_PROVIDER_NAME, parseMemoryNoteMetadata, type MemoryNoteLink } from "../index.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };
const question: readonly Message[] = [{ role: "user", content: [{ type: "text", text: "Where is the office?" }] }];

function makeMemory() {
  const memory = createMemory({
    ...scope,
    embedder: createHashEmbedder(),
    vectorStore: createMemoryVectorStore(),
    workingStore: createMemoryWorkingStore(),
  });
  return memory;
}

/** Stand-in session: the fabric reads the id (gate) and nothing else. */
function makeSession(id = "s1") {
  let calls = 0;
  return {
    id,
    get calls() {
      return calls;
    },
    entries: async () => {
      calls++;
      return [];
    },
  };
}

async function storedLinks(memory: ReturnType<typeof makeMemory>, query: string, id: string): Promise<readonly MemoryNoteLink[]> {
  const rows = (await memory.recall(query, { topK: 10 })).hits;
  return parseMemoryNoteMetadata(rows.find((row) => row.id === id)?.metadata)?.links ?? [];
}

describe("memory fabric attach", () => {
  it("writes through the API without an attachment and stays out of the transcript", async () => {
    const memory = makeMemory();
    const session = makeSession();
    const fabric = createMemoryFabric({ memory, linker: { enabled: true }, evolution: { enabled: true } });

    const note = await fabric.remember({ kind: "fact", content: "Canary rollout is required" });

    assert.equal(note.links, undefined);
    assert.deepEqual(await storedLinks(memory, "Canary rollout is required", note.id), []);
    assert.equal(session.calls, 0, "the fabric appends no session entries of its own");
  });

  it("runs the opt-in workers only while a session is attached", async () => {
    const memory = makeMemory();
    const session = makeSession();
    const fabric = createMemoryFabric({ memory, consolidate: false, linker: { enabled: true, topK: 2 } });

    const first = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    assert.deepEqual(await storedLinks(memory, "Canary rollout protects deploys", first.id), []);

    const attached = fabric.attach(session);
    assert.equal(attached.session, session);
    assert.equal(attached.settings.linker.enabled, true);

    const second = await fabric.remember({ kind: "fact", content: "Canary rollout protects services" });
    assert.equal((await storedLinks(memory, "Canary rollout protects services", second.id)).length, 1);

    attached.detach();
    attached.detach();
    const third = await fabric.remember({ kind: "fact", content: "Canary rollout protects nightly services" });
    assert.deepEqual(await storedLinks(memory, "Canary rollout protects nightly services", third.id), []);
  });

  it("keeps workers off for a passive fabric even when attached", async () => {
    const memory = makeMemory();
    const fabric = createMemoryFabric({
      memory,
      consolidate: false,
      passive: true,
      linker: { enabled: true },
      evolution: { enabled: true },
    });
    fabric.attach(makeSession());

    const first = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys", keywords: ["canary"] });
    const second = await fabric.remember({ kind: "fact", content: "Dashboards track rollout health", keywords: ["dashboards"] });

    assert.deepEqual(await storedLinks(memory, "Dashboards track rollout health", second.id), []);
    const neighbor = (await memory.recall("Canary rollout protects deploys", { topK: 10 })).hits.find((row) => row.id === first.id);
    assert.deepEqual(parseMemoryNoteMetadata(neighbor?.metadata)?.keywords, ["canary"]);
  });

  it("detaches when the caller's signal aborts and fails closed on a bad attach", async () => {
    const memory = makeMemory();
    const fabric = createMemoryFabric({ memory });
    const controller = new AbortController();
    const attached = fabric.attach(makeSession("s9"), { signal: controller.signal });
    const recall = find(fabric.tools(), "memory.recall");
    assert.equal((await recall.execute({ query: "anything" }, context("s9"))).error, undefined);

    controller.abort();
    assert.deepEqual((await recall.execute({ query: "anything" }, context("s9"))).value, { found: false, reason: "not_attached" });
    assert.equal(attached.settings.passive, false);

    assert.throws(() => fabric.attach(null as unknown as { id: string }), MemoryValidationError);
    assert.throws(() => fabric.attach({ id: "" }), MemoryValidationError);
    assert.throws(() => fabric.attach({ id: "s1", entries: "nope" } as unknown as { id: string }), MemoryValidationError);
    assert.throws(() => fabric.attach({ id: "s1" }, { signal: {} as AbortSignal }), MemoryValidationError);
    const aborted = new AbortController();
    aborted.abort();
    assert.throws(() => fabric.attach({ id: "s1" }, { signal: aborted.signal }), MemoryAbortError);
  });

  it("refuses a session that is not the fabric's observational session", async () => {
    const memory = makeMemory();
    const source = { session: { id: "om-session", entries: async () => [] } };
    const fabric = createMemoryFabric({ memory, observational: source });

    assert.throws(() => fabric.attach({ id: "other" }), MemoryValidationError);
    assert.equal(fabric.attach({ id: "om-session" }).session.id, "om-session");
  });

  it("exposes the compiler seam: blocks tagged like createMemory's provider, with no compiler in scope", async () => {
    const memory = makeMemory();
    const fabric = createMemoryFabric({ memory });
    await fabric.remember({ kind: "fact", content: "Office is in Berlin" });
    await fabric.remember({ kind: "working", block: "core", content: "Prefers terse output" });

    const provider = fabric.createContextProvider({ query: "Where is the office?" });
    assert.equal(provider.name, DEFAULT_MEMORY_FABRIC_PROVIDER_NAME);

    const registries = createContributionRegistries();
    registries.contextProviders.register(DEFAULT_MEMORY_FABRIC_PROVIDER_NAME, provider);
    assert.equal(registries.contextProviders.resolve(DEFAULT_MEMORY_FABRIC_PROVIDER_NAME), provider);

    const blocks = await resolveContextProviders({ providers: [provider], messages: question });
    const semantic = blocks.find((block) => block.metadata?.source === "semantic-memory");
    const working = blocks.find((block) => block.metadata?.source === "working-memory");
    assert.ok(String(semantic?.content).includes("Berlin"), "facts inject as semantic memory");
    assert.ok(String(working?.content).includes("terse"), "working blocks inject as working memory");
  });
});

/** Normalized tool handle: always async, never the sync `ToolResult` half of the signature. */
function find(tools: readonly ToolDefinition[], name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return {
    async execute(args: Record<string, unknown>, callContext: ToolExecutionContext): Promise<ToolResult> {
      return await tool.execute(args as JsonObject, callContext);
    },
  };
}

const context = (sessionId: string): ToolExecutionContext => ({ sessionId, runId: "r1", toolCallId: "c1" });
