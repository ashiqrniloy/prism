/**
 * Plan 210 Task 7: the byte-identical-preset test. Every inert removal (and the removal of a never-set option) must leave the
 * `conversational` and `coding` presets' provider requests and tool schemas exactly as they were. The golden hashes in
 * `fixtures/removal-byte-identical.json` were taken from the tree before the first removal; a removal that changes a byte fails here.
 * Run with `PRISM_UPDATE_REMOVAL_GOLDEN=1` only to record the golden for a measured removal (a behaviour change the plan records).
 */
import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import memoryFabric from "../index.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "fixtures/removal-byte-identical.json");
const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Keep every provider-visible field and nothing the harness stamps per run: the temp root, calendar dates, UUIDs, and the random note ids
 * (12 hex digits, and their 8-digit file-name prefixes), which are renumbered by first appearance, and the directory's file order.
 */
function normalize(value: unknown, root: string): string {
  const text = JSON.stringify(value)
    .split(root)
    .join("<root>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, "<date>")
    // The directory block lists files in filesystem order, which ties on equal mtimes; compare it as a set.
    .replace(/Files: ([^"\\]+)/g, (_all, list: string) => `Files: ${list.split(", ").sort().join(", ")}`);
  const ids = new Map<string, number>();
  for (const [id] of text.matchAll(/(?<![0-9a-f])[0-9a-f]{12}(?![0-9a-f])/g)) if (!ids.has(id)) ids.set(id, ids.size);
  const slug = (short: string) => [...ids].find(([id]) => id.startsWith(short))?.[1];
  return text
    .replace(/(?<![0-9a-f])[0-9a-f]{12}(?![0-9a-f])/g, (id) => `<id${ids.get(id)}>`)
    .replace(/(?<=--)[0-9a-f]{8}(?=\.md)/g, (short) => `<id${slug(short) ?? "?"}>`);
}

async function replay(
  preset: "conversational" | "coding",
): Promise<{ requests: number; request: string[]; tools: string[]; context: string[] }> {
  const root = await mkdtemp(join(tmpdir(), "prism-removal-"));
  dirs.push(root);
  const requests: ProviderRequest[] = [];
  const script: (readonly ProviderEvent[])[] = [
    [
      providerToolCall(toolCallContent("c1", "memory.insert", { kind: "fact", text: "canary rollouts go first on staging deploys" })),
      providerDone(),
    ],
    [providerTextDelta("noted"), providerDone()],
    [providerToolCall(toolCallContent("c2", "memory.recall", { query: "canary rollouts" })), providerDone()],
    [providerTextDelta("recalled"), providerDone()],
    [providerTextDelta("quiet one"), providerDone()],
    [providerTextDelta("quiet two"), providerDone()],
    // A third session writes near-duplicate and same-subject facts, then recalls them: this reaches the near-duplicate
    // link, the grouping marker and the keyword/date enrichment that the plan 210 removals touch.
    [
      providerToolCall(toolCallContent("e1", "memory.insert", { kind: "fact", text: "the deploy window is tuesday afternoon" })),
      providerDone(),
    ],
    [
      providerToolCall(toolCallContent("e2", "memory.insert", { kind: "fact", text: "the deploy window is thursday morning" })),
      providerDone(),
    ],
    [
      providerToolCall(toolCallContent("e3", "memory.insert", { kind: "fact", text: "canary rollouts go first on staging deploys today" })),
      providerDone(),
    ],
    [providerToolCall(toolCallContent("e4", "memory.recall", { query: "deploy window" })), providerDone()],
    [providerToolCall(toolCallContent("e5", "memory.recall", { query: "canary rollouts first" })), providerDone()],
    [providerTextDelta("done"), providerDone()],
  ];
  const agent = await createAgent({
    model: { provider: "mock", model: "main" },
    packages: [mockProvider(script, { onRequest: (request) => requests.push(request) }), memoryFabric({ preset, tools: { root } })],
  });
  try {
    const session = await agent.session({ id: `removal-${preset}`, create: true });
    await session.run("remember that canary rollouts go first");
    await session.run("what do we do first on a deploy?");
    await session.run("thanks");
    await session.close();
    const next = await agent.session({ id: `removal-${preset}-next`, create: true });
    await next.run("remind me about deploys");
    await next.close();
    const writes = await agent.session({ id: `removal-${preset}-writes`, create: true });
    await writes.run("note the deploy facts");
    await writes.close();
  } finally {
    await agent.dispose();
  }
  const each = (pick: (request: ProviderRequest) => unknown) => requests.map((request) => sha(normalize(pick(request), root)));
  return {
    requests: requests.length,
    request: each((request) => ({ messages: request.messages, context: request.context, tools: request.tools })),
    tools: each((request) => request.tools ?? []),
    context: each((request) => request.context ?? []),
  };
}

describe("removals leave the shipped presets byte-identical (plan 210 Task 7)", () => {
  it("removal_leaves_preset_provider_requests_and_tool_schemas_byte_identical", async () => {
    const actual = { conversational: await replay("conversational"), coding: await replay("coding") };
    if (process.env.PRISM_UPDATE_REMOVAL_GOLDEN === "1") {
      await writeFile(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(await readFile(GOLDEN, "utf8"));
    assert.deepEqual(actual.conversational.tools, golden.conversational.tools, "conversational tool schemas changed");
    assert.deepEqual(actual.coding.tools, golden.coding.tools, "coding tool schemas changed");
    assert.deepEqual(actual.conversational.context, golden.conversational.context, "conversational context blocks changed");
    assert.deepEqual(actual.coding.context, golden.coding.context, "coding context blocks changed");
    assert.deepEqual(actual, golden, "provider requests changed");
  });
});
