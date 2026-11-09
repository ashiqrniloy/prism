import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextDraft, HookContext } from "@arnilo/prism";
import { createAgent, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import { createFabricRules, DEFAULT_RULES_OPTIONS } from "../delivery/rules.js";
import { createFabricDirectory, DEFAULT_DIRECTORY_OPTIONS, memoryRetractionVersion } from "../directory.js";
import memorySystem, { createMemory, createLongTermMemory, exportMemoryOkf, importMemoryOkf } from "../../index.js";
import { MEMORY_NOTE_METADATA_KEY } from "../types.js";

// Plan 188.5 Task 4: the prompt-cache parity claim (plan 184) has to hold for the fabric's own blocks.
// A session that writes nothing between turns must send byte-identical prefix blocks every turn, so a
// provider's cache hits on the directory and core blocks instead of re-ingesting them.

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-prefix-"));
  dirs.push(dir);
  return dir;
}

describe("fabric prefix stability (plan 188.5 Task 4)", () => {
  it("fabric_prefix_is_identical_across_ten_turns_without_writes", async () => {
    const root = await tempRoot();
    const requests: ProviderRequest[] = [];
    const script: (readonly ProviderEvent[])[] = [
      [providerToolCall(toolCallContent("c1", "memory.insert", { kind: "fact", text: "canary rollouts go first" })), providerDone()],
      [providerTextDelta("stored"), providerDone()],
      ...Array.from({ length: 10 }, (_unused, index) => [providerTextDelta(`turn ${index}`), providerDone()] as const),
    ];
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [mockProvider(script, { onRequest: (request) => requests.push(request) }), memorySystem({ ltm: { tools: { root } } })],
    });
    try {
      let session = await agent.session({ id: "seed", create: true });
      await session.run("remember canary rollouts");
      await session.close();
      session = await agent.session({ id: "prefix-stability", create: true });
      for (let turn = 0; turn < 10; turn += 1) await session.run(`turn ${turn}`);

      // Two requests per write round, then one per quiet turn.
      assert.equal(requests.length, 12);
      const prefixes = requests.slice(2).map((request) => JSON.stringify(request.context ?? []));
      assert.equal(new Set(prefixes).size, 1, "ten quiet turns send one identical prefix");
      assert.match(prefixes[0]!, /canary rollouts go first/, "the core block is in the prefix");
      assert.match(prefixes[0]!, /fabric-directory/, "the directory block is in the prefix");
      assert.match(prefixes[0]!, /fabric-rules/, "the core block carries its source");
      // No tail block appears in a quiet turn: nothing new to inject.
      for (const request of requests.slice(2)) {
        assert.equal(
          request.messages.find((message) => message.metadata?.contextBlocks),
          undefined,
        );
      }
      await session.close();
    } finally {
      await agent.dispose();
    }
  });
});

async function epochHarness() {
  const store = createMemoryVectorStore();
  const scope = { tenantId: "t", resourceId: "r", threadId: "thread", vectorStore: store };
  const memory = createMemory(scope);
  const fabric = createLongTermMemory({ memory, consolidate: false });
  const seed = await fabric.remember({ id: "aaaaaaaaaaaa", kind: "fact", content: "violet orchard", scope: "project" });
  const directory = { source: createFabricDirectory({ memory }), options: DEFAULT_DIRECTORY_OPTIONS };
  const core = createFabricRules({
    scopes: [{ level: "project", memory }],
    options: DEFAULT_RULES_OPTIONS,
    scanMetadata: store.scanMetadata!,
  });
  const projection = createFabricContext(memory, fabric.recall, false, {}, directory, undefined, undefined, core);
  const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "orchard" }] }] };
  const build = (id = "s") => projection.build(draft, { sessionId: id } as HookContext);
  return { memory, fabric, seed, projection, build, scope };
}

it("fabric_prefix_survives_insert_and_lifecycle_writes", async () => {
  const h = await epochHarness();
  const before = await h.build();
  await h.fabric.remember({ id: "bbbbbbbbbbbb", kind: "fact", content: "new orchard rule", scope: "project" });
  await h.memory.patchMetadata(h.seed.id, (m) => ({ ...m, retrievalCount: 10, helpful: 2 }));
  assert.deepEqual((await h.build()).context, before.context);
  assert.equal(
    (await h.fabric.recall("new orchard rule", { minSimilarity: 0 })).hits.some((n) => n.id === "bbbbbbbbbbbb"),
    true,
  );
  assert.equal((await h.memory.get(["bbbbbbbbbbbb"])).length, 1);
});

for (const [name, retract] of Object.entries({
  forget: (m: ReturnType<typeof createMemory>) => m.forget({ ids: ["aaaaaaaaaaaa"] }),
  revoke: (m: ReturnType<typeof createMemory>) => m.setConsent("aaaaaaaaaaaa", { visible: false }),
  correct: (m: ReturnType<typeof createMemory>) => m.correct("aaaaaaaaaaaa", "corrected orchard"),
  archive: (m: ReturnType<typeof createMemory>) => m.patchMetadata("aaaaaaaaaaaa", (v) => ({ ...v, status: "archived" })),
  retire: (m: ReturnType<typeof createMemory>) => m.patchMetadata("aaaaaaaaaaaa", (v) => ({ ...v, status: "retired" })),
  validity: (m: ReturnType<typeof createMemory>) =>
    m.patchMetadata("aaaaaaaaaaaa", (v) => ({
      ...v,
      [MEMORY_NOTE_METADATA_KEY]: { ...(v[MEMORY_NOTE_METADATA_KEY] as object), validTo: "2020-01-01T00:00:00Z" },
    })),
  flags: (m: ReturnType<typeof createMemory>) =>
    m.patchMetadata("aaaaaaaaaaaa", (v) => ({
      ...v,
      [MEMORY_NOTE_METADATA_KEY]: { ...(v[MEMORY_NOTE_METADATA_KEY] as object), flags: ["injection"] },
    })),
  retention: (m: ReturnType<typeof createMemory>) => m.applyRetention({ maxEntries: 0 }),
})) {
  it(`${name}_breaks_the_epoch_on_the_next_request`, async () => {
    const h = await epochHarness();
    assert.match(JSON.stringify((await h.build()).context), /violet orchard/);
    await retract(h.memory);
    const after = (await h.build()).context;
    assert.doesNotMatch(JSON.stringify(after ?? []), /violet orchard/);
    assert.deepEqual((await h.build()).context, after);
  });
}

it("new_session_and_refresh_see_writes_from_another_memory_instance", async () => {
  const h = await epochHarness();
  const before = (await h.build()).context;
  const other = createMemory(h.scope);
  await other.remember(
    { entries: [{ id: "bbbbbbbbbbbb", text: "external orchard", metadata: (await h.memory.getEntry(h.seed.id))!.metadata }] },
    { wait: true },
  );
  assert.deepEqual((await h.build()).context, before);
  assert.match(JSON.stringify((await h.build("other")).context), /external orchard/);
  h.projection.refresh();
  assert.match(JSON.stringify((await h.build()).context), /external orchard/);
});

it("epoch_snapshot_is_evicted_on_session_closed", async () => {
  const h = await epochHarness();
  await h.build();
  await h.fabric.remember({ kind: "fact", content: "arrived after close", scope: "project" });
  h.projection.forget("s");
  assert.match(JSON.stringify((await h.build()).context), /arrived after close/);
});

it("conversational_prefix_passes_provider_visible_conformance", async () => {
  await runPrefixStabilityConformance({
    host: { model: "mock/main", packages: [memorySystem({ ltm: { preset: "conversational", store: "memory" } })] },
    skills: [
      { name: "one", description: "one", instructions: "first skill" },
      { name: "two", description: "two", instructions: "second skill" },
    ],
    assertOn: "cacheablePrefix",
  });
});

it("compaction_completed_starts_a_new_epoch_with_new_notes", async () => {
  const root = await tempRoot();
  const requests: ProviderRequest[] = [];
  const agent = await createAgent({
    model: "mock/main",
    packages: [
      mockProvider(
        [
          [providerToolCall(toolCallContent("insert", "memory.insert", { kind: "fact", text: "new epoch canary" })), providerDone()],
          [providerTextDelta("saved"), providerDone()],
          [providerTextDelta("before compact"), providerDone()],
          [providerTextDelta("after compact"), providerDone()],
        ],
        { onRequest: (r) => requests.push(r) },
      ),
      memorySystem({ ltm: { tools: { root } } }),
    ],
  });
  try {
    const session = await agent.session();
    assert.equal((await session.run("save this")).status, "completed");
    assert.equal((await session.run("before")).status, "completed");
    assert.equal(new Set(requests.map((r) => JSON.stringify(r.context))).size, 1);
    await session.compact();
    assert.equal((await session.run("after")).status, "completed");
    assert.match(JSON.stringify(requests.at(-1)?.context), /new epoch canary/);
    await session.close();
  } finally {
    await agent.dispose();
  }
});

it("single_turn_answer_path_context_bytes_unchanged", async () => {
  const h = await epochHarness();
  // Pre-epoch serializer output for this fixture; keys and envelopes are part of the bytes.
  // Plan 209 Task 3 renamed the core block to "Standing rules", so its heading and token count were re-pinned once.
  const expected = [
    {
      title: "Long-term memory",
      content: "1 fact. Recall with memory.recall.",
      metadata: { source: "fabric-directory", tokens: 9, untrusted: true, inert: true, injectionCapable: true },
    },
    {
      title: "Standing rules",
      content: "Standing rules (project): [aaaaaaaaaaaa] violet orchard",
      metadata: { source: "fabric-rules", itemIds: ["aaaaaaaaaaaa"], tokens: 14, untrusted: true, inert: true, injectionCapable: true },
    },
  ];
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash((await h.build()).context), hash(expected));
  await h.fabric.recall("orchard");
  assert.equal(hash((await h.build()).context), hash(expected));
});

it("imported_tombstones_break_an_existing_epoch", async () => {
  const h = await epochHarness();
  const before = await h.build();
  const sourceStore = createMemoryVectorStore();
  const source = createMemory({ ...h.scope, vectorStore: sourceStore });
  const record = (await h.memory.getEntry(h.seed.id))!;
  await source.remember({ entries: [{ id: record.id, text: record.text, metadata: record.metadata }] }, { wait: true });
  await source.forget({ ids: [record.id], hold: true });
  const dir = await tempRoot();
  await exportMemoryOkf(source, { dir, stores: { vectorStore: sourceStore } });
  await importMemoryOkf(h.memory, { dir, stores: { vectorStore: h.scope.vectorStore }, mode: "merge" });
  assert.match(JSON.stringify(before.context), /violet orchard/);
  assert.doesNotMatch(JSON.stringify((await h.build()).context ?? []), /violet orchard/);
});

it("candidate_inserts_and_evidence_patches_stay_reachable_without_retracting", async () => {
  const h = await epochHarness();
  const before = (await h.build()).context;
  const metadata = (await h.memory.getEntry(h.seed.id))!.metadata;
  await h.memory.remember(
    { entries: [{ id: "bbbbbbbbbbbb", text: "candidate orchard rule", metadata: { ...metadata, status: "candidate" } }] },
    { wait: true },
  );
  const version = memoryRetractionVersion(h.memory);
  await h.memory.patchMetadata("bbbbbbbbbbbb", (m) => ({ ...m, retrievalCount: 1 }));
  assert.equal(memoryRetractionVersion(h.memory), version, "evidence updates are additive even for candidate notes");
  assert.deepEqual((await h.build()).context, before);
  assert.equal((await h.memory.get(["bbbbbbbbbbbb"])).length, 1);
  assert.ok(
    (await h.fabric.recall("candidate orchard rule", { minSimilarity: 0 })).hits.some(
      (hit) => hit.id === "bbbbbbbbbbbb" && hit.status === "candidate",
    ),
  );
});

// Plan 202 Task 4.14: cache hygiene.
function revalidationHarness(h: Awaited<ReturnType<typeof epochHarness>>, memory = h.memory) {
  const projection = createFabricContext(
    h.memory,
    h.fabric.recall,
    false,
    {},
    undefined,
    undefined,
    undefined,
    createFabricRules({
      scopes: [{ level: "project", memory }],
      options: DEFAULT_RULES_OPTIONS,
      scanMetadata: h.scope.vectorStore.scanMetadata!,
    }),
    undefined,
    [memory],
  );
  const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "orchard" }] }] };
  return { projection, build: (id = "s") => projection.build(draft, { sessionId: id } as HookContext) };
}

it("tail_cache_is_evicted_on_session_closed", async () => {
  const h = await epochHarness();
  const entries = [
    {
      id: "u1",
      sessionId: "s",
      kind: "message",
      timestamp: "2026-10-17T12:00:00Z",
      message: { role: "user", content: [{ type: "text", text: "orchard" }] },
    },
  ];
  const context = { sessionId: "s", session: { id: "s", entries: async () => entries } } as unknown as HookContext;
  let recalls = 0;
  const projection = createFabricContext(
    h.memory,
    async () => {
      recalls += 1;
      return { hits: [], explain: [] };
    },
    {},
  );
  const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "orchard" }] }] };
  await projection.build(draft, context);
  await projection.build(draft, context);
  assert.equal(recalls, 1, "the same user turn reuses its tail");
  projection.forget("s");
  await projection.build(draft, context);
  assert.equal(recalls, 2, "a closed session keeps no tail entry");
});

it("another_instances_forget_leaves_the_prefix_on_the_next_request", async () => {
  const h = await epochHarness();
  const mine = revalidationHarness(h);
  assert.match(JSON.stringify((await mine.build()).context), /violet orchard/);
  // A second instance over the same store: this process's retraction counter never moves.
  await createMemory(h.scope).forget({ ids: [h.seed.id] });
  const after = (await mine.build()).context;
  assert.doesNotMatch(JSON.stringify(after ?? []), /violet orchard/);
  assert.deepEqual((await mine.build()).context, after, "the rebuilt prefix is pinned again");
});

it("another_instances_additive_write_keeps_the_prefix_pinned", async () => {
  const h = await epochHarness();
  const mine = revalidationHarness(h);
  const before = (await mine.build()).context;
  await createMemory(h.scope).remember(
    { entries: [{ id: "bbbbbbbbbbbb", text: "external orchard", metadata: (await h.memory.getEntry(h.seed.id))!.metadata }] },
    { wait: true },
  );
  assert.deepEqual((await mine.build()).context, before);
});

it("revalidation_failure_drops_the_core_block_instead_of_resending_it", async () => {
  const h = await epochHarness();
  let broken = false;
  const flaky = new Proxy(h.memory, {
    get: (target, key, receiver) =>
      key === "get" && broken
        ? async () => {
            throw new Error("store unavailable");
          }
        : Reflect.get(target, key, receiver),
  });
  const mine = revalidationHarness(h, flaky);
  assert.match(JSON.stringify((await mine.build()).context), /violet orchard/);
  broken = true;
  assert.doesNotMatch(JSON.stringify((await mine.build()).context ?? []), /violet orchard/);
  broken = false;
  assert.match(JSON.stringify((await mine.build()).context), /violet orchard/, "a recovered store restores the pinned core");
});

it("revalidation_abort_propagates", async () => {
  const h = await epochHarness();
  const mine = revalidationHarness(h);
  await mine.build();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(mine.projection.build({ messages: [] }, { sessionId: "s", signal: controller.signal } as HookContext));
});
