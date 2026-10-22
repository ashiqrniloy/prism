import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgent, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

import memoryFabric from "../index.js";

// Plan 188.5 Task 4: the prompt-cache parity claim (plan 184) has to hold for the fabric's own blocks.
// A session that writes nothing between turns must send byte-identical prefix blocks every turn, so a
// provider's cache hits on the working, directory, and core blocks instead of re-ingesting them.

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
      packages: [mockProvider(script, { onRequest: (request) => requests.push(request) }), memoryFabric({ tools: { root } })],
    });
    try {
      const session = await agent.session({ id: "prefix-stability", create: true });
      await session.run("remember canary rollouts");
      for (let turn = 0; turn < 10; turn += 1) await session.run(`turn ${turn}`);

      // Two requests per write round, then one per quiet turn.
      assert.equal(requests.length, 12);
      const prefixes = requests.slice(2).map((request) => JSON.stringify(request.context ?? []));
      assert.equal(new Set(prefixes).size, 1, "ten quiet turns send one identical prefix");
      assert.match(prefixes[0]!, /canary rollouts go first/, "the core block is in the prefix");
      assert.match(prefixes[0]!, /fabric-directory/, "the directory block is in the prefix");
      assert.match(prefixes[0]!, /fabric-core/, "the core block carries its source");
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
