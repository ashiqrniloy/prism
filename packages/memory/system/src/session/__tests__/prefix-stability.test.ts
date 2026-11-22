/**
 * Plan 218.3 Task 6: between compactions, every provider request shares the whole previous request as a byte-identical
 * prefix (background STM/WM passes write only to the ledger, and in `pinned` mode `context-cache.ts` freezes the block
 * per compaction). At a compaction, the prefix changes once and is append-only again until the next compaction.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { runPrefixStabilityConformance, scorePrefixStability } from "@arnilo/prism/testing/prefix-stability-conformance";
import memorySystem from "../../index.js";
import { OBSERVATIONS_RECORDED, WM_RECORDED } from "../types.js";

const MODEL = { provider: "main", model: "main-model", limits: { contextWindow: 1_000_000, maxOutputTokens: 0 } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

function workerProvider(): ModelProvider {
  return {
    id: "worker",
    async *generate(request) {
      const text = request.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      if (!request.messages.some((message) => message.role === "tool")) {
        if (request.tools?.some((tool) => tool.name === "record_event")) {
          const ids = [...text.matchAll(/\[[^\]]+\] \[([^\]]+)\] (?:user|assistant|tool|system):/g)].map((m) => m[1]!);
          if (ids.length > 0) {
            yield providerToolCall(
              toolCallContent("stm-1", "record_event", {
                kind: "statement",
                description: `Observed ${ids.join(",")}`,
                relevance: "high",
                sourceEntryIds: [ids[0]!],
              }),
            );
          }
        } else if (request.tools?.some((tool) => tool.name === "judge")) {
          const batch = text.slice(text.indexOf("## New STM records"));
          const keep = [...batch.matchAll(/^- \[r([0-9]+)\]/gm)].map((match) => ({ r: Number(match[1]), reason: "needed" }));
          if (keep.length > 0) yield providerToolCall(toolCallContent("wm-1", "judge", { keep }));
        }
      }
      yield providerDone();
    },
  };
}

const echoTool = definePackage({
  name: "@test/echo",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "echo",
      description: "Echo text.",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      execute: (args, context) => ({
        toolCallId: context.toolCallId,
        name: "echo",
        value: String((args as { text?: string }).text ?? "ok"),
      }),
    });
  },
})();

function mainProvider(requests: ProviderRequest[], options: { toolTurns?: boolean } = {}): ModelProvider {
  let calls = 0;
  return {
    id: "main",
    async *generate(request) {
      requests.push(request);
      calls += 1;
      if (options.toolTurns && request.messages.at(-1)?.role === "user") {
        yield providerToolCall(toolCallContent(`call-${calls}`, "echo", { text: `payload-${calls}` }));
      } else {
        yield providerTextDelta(`reply-${calls}`);
      }
      yield providerDone();
    },
  };
}

function pairPrefixShares(requests: readonly ProviderRequest[]): number[] {
  const shares: number[] = [];
  for (let i = 1; i < requests.length; i += 1) {
    shares.push(scorePrefixStability([requests[i - 1]!, requests[i]!], { minContinuity: 1 }).minContinuity);
  }
  return shares;
}

describe("prefix stability between compactions (plan 218.3 Task 6)", () => {
  it("memory_block_changes_only_at_a_compaction", async () => {
    // 1. Kernel prefix-stability conformance over 10 turns with background STM + WM workers.
    const conformance = await runPrefixStabilityConformance({
      host: {
        model: MODEL,
        instructions: "Stable rules. ".repeat(100),
        packages: [
          providerPackage("worker-provider", [workerProvider()]),
          memorySystem({
            enabled: true,
            stm: { model: "worker/w", triggerTokens: 1, verbatimUserChars: 0 },
            wm: { model: "worker/w", triggerTokens: 1 },
            scope: { text: "Keep prefix stable across turns." },
          }),
        ],
      },
      skills: [
        { name: "alpha", description: "Alpha", instructions: "Alpha body" },
        { name: "beta", description: "Beta", instructions: "Beta body" },
      ],
      turns: 10,
      assertOn: "cacheablePrefix",
      minContinuity: 1,
      allowedResets: 0,
    });
    assert.equal(conformance.requests, 20);
    assert.equal(conformance.cacheableContinuity, 1);
    assert.deepEqual(conformance.resets, []);

    // 2. Ten turns with settled background STM + WM passes after every turn (`own-compaction` mode).
    const requests: ProviderRequest[] = [];
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [
        providerPackage("main-provider", [mainProvider(requests)]),
        providerPackage("worker-provider", [workerProvider()]),
        memorySystem({
          enabled: true,
          stm: { model: "worker/w", triggerTokens: 1, verbatimUserChars: 0 },
          wm: { model: "worker/w", triggerTokens: 1 },
          scope: { text: "Keep prefix stable across turns." },
        }),
      ],
      slots: { store },
    });
    try {
      const session = await agent.session({ id: "ten-turns-own-compaction", create: true });
      for (let turn = 1; turn <= 10; turn += 1) {
        await session.run(`turn ${turn} with background memory passes`);
        await settle();
      }
      assert.equal(requests.length, 10);
      const shares = pairPrefixShares(requests);
      assert.deepEqual(
        shares,
        Array(9).fill(1),
        `own-compaction: every turn repeats 100% of the previous request prefix (${JSON.stringify(shares)})`,
      );
      const sample = scorePrefixStability(requests, { minContinuity: 1 });
      assert.equal(sample.minContinuity, 1);
      assert.deepEqual(sample.resets, []);

      const ledger = (await store.list(session.id))
        .filter((entry) => entry.kind === "package_state")
        .map((entry) => JSON.stringify(entry))
        .join("\n");
      assert.ok(ledger.includes(OBSERVATIONS_RECORDED), "STM wrote records during the 10 turns");
      assert.ok(ledger.includes(WM_RECORDED), "WM ran passes during the 10 turns");
    } finally {
      await agent.dispose();
    }
  });

  it("pinned_memory_block_changes_only_at_a_compaction", async () => {
    const requests: ProviderRequest[] = [];
    const store = createMemorySessionStore();
    const foreign = definePackage({
      name: "@test/foreign-compactor",
      version: "1.0.0",
      requires: { api: 1 },
      capabilities: ["slot:compaction"],
      setup(prism) {
        prism.slots.compaction.provide({
          name: "foreign",
          compact: (context) => prism.slots.compaction.default.compact(context),
        });
      },
    })();
    const agent = await createAgent({
      model: MODEL,
      packages: [
        providerPackage("main-provider", [mainProvider(requests)]),
        providerPackage("worker-provider", [workerProvider()]),
        memorySystem({
          enabled: true,
          stm: { model: "worker/w", triggerTokens: 1, verbatimUserChars: 0 },
          wm: { model: "worker/w", triggerTokens: 1 },
          scope: { text: "Keep prefix stable across turns." },
          context: { compaction: false },
        }),
        foreign,
      ],
      slots: { store },
    });
    try {
      const session = await agent.session({ id: "ten-turns-pinned", create: true });
      await session.run("seed before pin");
      await settle();
      await session.compact();
      const beforeIndex = requests.length;
      for (let turn = 1; turn <= 10; turn += 1) {
        await session.run(`turn ${turn} with background memory passes`);
        await settle();
      }
      const windowRequests = requests.slice(beforeIndex);
      assert.equal(windowRequests.length, 10);
      const shares = pairPrefixShares(windowRequests);
      assert.deepEqual(shares, Array(9).fill(1));
      assert.equal(scorePrefixStability(windowRequests, { minContinuity: 1 }).minContinuity, 1);
      const ledger = (await store.list(session.id))
        .filter((entry) => entry.kind === "package_state")
        .map((entry) => JSON.stringify(entry))
        .join("\n");
      assert.ok(ledger.includes(OBSERVATIONS_RECORDED), "pinned: STM wrote records during the 10 turns");
      assert.ok(ledger.includes(WM_RECORDED), "pinned: WM ran passes during the 10 turns");
      const blocks = windowRequests.map((req) =>
        JSON.stringify(req.messages.filter((message) => JSON.stringify(message).includes("session-memory"))),
      );
      assert.equal(new Set(blocks).size, 1, "pinned memory block stays byte-identical across all 10 turns");
    } finally {
      await agent.dispose();
    }
  });

  it("prefix_breaks_once_per_compaction", async () => {
    // Own-compaction mode: two automatic between-loop compactions separated by turns with settled STM + WM passes.
    {
      const requests: ProviderRequest[] = [];
      const store = createMemorySessionStore();
      const agent = await createAgent({
        model: MODEL,
        packages: [
          providerPackage("main-provider", [mainProvider(requests, { toolTurns: true })]),
          providerPackage("worker-provider", [workerProvider()]),
          echoTool,
          memorySystem({
            enabled: true,
            stm: { model: "worker/w", triggerTokens: 1, verbatimUserChars: 0 },
            wm: { model: "worker/w", triggerTokens: 1 },
            scope: { text: "Keep prefix stable across turns." },
            context: { compactAfterRun: { maxTokens: 700 } },
          }),
        ],
        slots: { store },
      });
      try {
        const session = await agent.session({ id: "two-compactions-own", create: true });
        // Turn 1-2: stay below 700 tokens at run start (~640 tokens total).
        await session.run("alpha ".repeat(240));
        await settle();
        await session.run("beta ".repeat(160));
        await settle();
        assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 0);

        // Turn 3: run start crosses 700 tokens (~760) -> Compaction #1 removes Turns 1-2, keeping "gamma..." (~120 tok).
        const beforeCompact1 = requests.length;
        await session.run("gamma ".repeat(80));
        await settle();
        assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 1);

        // Turn 4: stays below 700 tokens while background STM + WM passes run; prefix must stay 100% stable.
        await session.run("delta ".repeat(100));
        await settle();
        assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 1);

        // Turn 5: pushes over 700 at Turn 5's start -> Compaction #2 removes Turns 3-4, keeping "zeta..." (~180 tok).
        const beforeCompact2 = requests.length;
        await session.run("zeta ".repeat(120));
        await settle();
        assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 2);

        // Turn 6: stays below 500 tokens after Compaction #2.
        await session.run("eta");
        await settle();

        assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 2);
        const sample = scorePrefixStability(requests, { minContinuity: 1 });
        // 1-based request indexes: beforeCompact1 + 1 and beforeCompact2 + 1 are the exact two compaction boundaries.
        assert.deepEqual(sample.resets, [beforeCompact1 + 1, beforeCompact2 + 1]);
        const shares = pairPrefixShares(requests);
        for (let idx = 0; idx < shares.length; idx += 1) {
          const requestIndex = idx + 2;
          if (requestIndex === beforeCompact1 + 1 || requestIndex === beforeCompact2 + 1) {
            assert.ok(shares[idx]! < 1, `request ${requestIndex} breaks prefix at compaction (got ${shares[idx]})`);
          } else {
            assert.equal(shares[idx], 1, `request ${requestIndex} repeats 100% of previous prefix`);
          }
        }
      } finally {
        await agent.dispose();
      }
    }

    // Pinned mode (context.compaction: false): the pinned block stays frozen between compactions and updates once at compaction 2.
    {
      const requests: ProviderRequest[] = [];
      const store = createMemorySessionStore();
      const foreign = definePackage({
        name: "@test/foreign-compactor-two",
        version: "1.0.0",
        requires: { api: 1 },
        capabilities: ["slot:compaction"],
        setup(prism) {
          prism.slots.compaction.provide({
            name: "foreign",
            compact: (context) => prism.slots.compaction.default.compact(context),
          });
        },
      })();
      const agent = await createAgent({
        model: MODEL,
        packages: [
          providerPackage("main-provider", [mainProvider(requests)]),
          providerPackage("worker-provider", [workerProvider()]),
          memorySystem({
            enabled: true,
            stm: { model: "worker/w", triggerTokens: 1, verbatimUserChars: 0 },
            wm: { model: "worker/w", triggerTokens: 1 },
            scope: { text: "Keep prefix stable across turns." },
            context: { compaction: false },
          }),
          foreign,
        ],
        slots: { store },
      });
      try {
        const session = await agent.session({ id: "two-compactions-pinned", create: true });
        await session.run("epoch one turn one");
        await settle();
        const beforeCompact1 = requests.length;
        await session.compact();

        await session.run("epoch two first");
        await settle();
        await session.run("epoch two second");
        await settle();
        await session.run("epoch two third");
        await settle();
        const beforeCompact2 = requests.length;
        await session.compact();

        await session.run("epoch three first");
        await settle();
        await session.run("epoch three second");
        await settle();

        const sample = scorePrefixStability(requests, { minContinuity: 1 });
        assert.deepEqual(sample.resets, [beforeCompact1 + 1, beforeCompact2 + 1]);

        const memoryMsg = (req: ProviderRequest) =>
          JSON.stringify(req.messages.find((message) => JSON.stringify(message).includes("session-memory")));
        const epochTwoBlock = memoryMsg(requests[beforeCompact1]!);
        assert.equal(memoryMsg(requests[beforeCompact1 + 1]!), epochTwoBlock);
        assert.equal(memoryMsg(requests[beforeCompact1 + 2]!), epochTwoBlock);
        const epochThreeBlock = memoryMsg(requests[beforeCompact2]!);
        assert.notEqual(epochThreeBlock, epochTwoBlock, "pinned block updates at the second compaction");
        assert.equal(memoryMsg(requests[beforeCompact2 + 1]!), epochThreeBlock);
      } finally {
        await agent.dispose();
      }
    }
  });

  it("declined_all_tail_compaction_emits_no_error_event_and_keeps_prefix", async () => {
    const requests: ProviderRequest[] = [];
    const events: AgentEvent[] = [];
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [
        providerPackage("main-provider", [mainProvider(requests, { toolTurns: true })]),
        providerPackage("worker-provider", [workerProvider()]),
        echoTool,
        memorySystem({
          enabled: true,
          stm: { model: "worker/w", triggerTokens: 1, verbatimUserChars: 0 },
          wm: false,
          // Between-loop cap 300, mid-loop share 320, and keepRecentTokens 1,000 so both triggers can cross while the
          // active tail still fits in `keepRecentTokens` / trailing user messages.
          context: { compactAfterRun: { maxTokens: 300 }, compactAt: { ratio: 0.000_32 }, keepRecentTokens: 1_000 },
        }),
      ],
      slots: { store },
      hooks: (hooks) => {
        hooks.on("compaction.completed", (event) => {
          events.push(event as AgentEvent);
        });
      },
    });
    try {
      const session = await agent.session({ id: "all-tail", create: true });
      // Run 1 starts with a large input over the 300-token between-loop cap and runs a tool round over the 320-token
      // mid-loop share while all messages fit in `keepRecentTokens`: the vote declines quietly on every check.
      await session.run("large initial user prompt ".repeat(100));
      await settle();
      assert.equal(events.length, 0, "no nothing_to_compact error event noise when the branch is all tail");
      assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 0);

      // Run 2 starts: Run 1 is now before the cut, so one compaction runs cleanly.
      await session.run("follow up");
      await settle();
      assert.equal(events.length, 1);
      assert.equal((events[0] as { error?: unknown }).error, undefined);
      assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 1);

      // Run 3: below the 300-token between-loop cap at run start, and mid-loop check crosses 320 tokens (including
      // summary) while all active messages still fit in keepRecentTokens -> no second compaction and no error event.
      const afterCompact1 = requests.findIndex((r) => r.messages.some((m) => JSON.stringify(m).includes("follow up")));
      await session.run("medium prompt ".repeat(25));
      await settle();
      assert.equal(events.length, 1, "still only the one real compaction event");
      assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 1);
      assert.equal(
        scorePrefixStability(requests.slice(afterCompact1), { minContinuity: 1 }).minContinuity,
        1,
        "prefix stays 100% stable after compaction 1",
      );

      // A manual compaction right after another compaction (keeping 0 between runs) has no active messages to remove
      // and declines instead of resurrecting already-compacted messages from before the first compaction.
      await session.compact(); // compacts "follow up" + "tiny turn" cleanly (2nd compaction)
      assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 2);
      await assert.rejects(session.compact(), /nothing_to_compact|removed nothing/);
      assert.equal((await store.list(session.id)).filter((e) => e.kind === "compaction").length, 2);
    } finally {
      await agent.dispose();
    }
  });
});
