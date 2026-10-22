import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type ProviderRequest, type SessionEntry, createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { assertCompactorConforms } from "@arnilo/prism/testing/compaction-conformance";
import { createMockProvider, mockProvider, packageConformance } from "@arnilo/prism/testing";
import definition from "../index.js";
import { createLlmCompactor } from "../strategy.js";
import { summaryClient } from "./helpers.js";

const model = { provider: "mock", model: "main" };
const summaryModel = { provider: "mock", model: "summary" };
const reply = (text = "reply") => [providerTextDelta(text), providerDone()];

/** The last compaction entry's data, which carries the strategy that produced it. */
function compactionData(entries: readonly SessionEntry[]): { strategy?: string } {
  return (entries.filter((entry) => entry.kind === "compaction").at(-1)?.data ?? {}) as { strategy?: string };
}

describe("memory compaction package", () => {
  it("memory_compaction_package_conformance", async () => {
    const result = await packageConformance(definition, { config: { profile: "coding", keepRecentTokens: 100 } });
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });

  it("memory_compaction_compactor_conforms", async () => {
    const compactor = createLlmCompactor({
      clientFor: summaryClient(createMockProvider([providerTextDelta("## Goal\nsummary"), providerDone()]), summaryModel),
      keepRecentTokens: 1,
    });
    const { summary } = await assertCompactorConforms(compactor, { secrets: ["secret-value"], exerciseAbort: true });
    assert.match(summary, /summary/);
  });

  it("memory_compaction_setup_resolves_no_model_and_calls_no_provider", async () => {
    let providerCalls = 0;
    const agent = await createAgent({
      model,
      packages: [definition({ profile: "coding" }), mockProvider([reply()], { onRequest: () => void providerCalls++ })],
    });

    assert.equal(providerCalls, 0, "loading the package calls no provider and resolves no model");
    await agent.dispose();
  });

  it("memory_compaction_claims_slot", async () => {
    const agent = await createAgent({ model, packages: [definition(), mockProvider([reply()])] });
    assert.equal(agent.inspect().slots.compaction, "@arnilo/prism-memory-compaction");
    assert.equal(agent.inspect().slots.store, "kernel", "only the compaction slot is claimed");
  });

  it("memory_compaction_uses_configured_model", async () => {
    const requests: ProviderRequest[] = [];
    const session = await (
      await createAgent({
        model,
        packages: [
          definition({ model: "mock/summary" }),
          mockProvider([reply(), reply(), reply("compact summary")], { onRequest: (request) => requests.push(request) }),
        ],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");
    await session.run("new");

    await session.compact();

    const models = requests.map((request) => request.model.model);
    assert.deepEqual(models.slice(-1), ["summary"], "the summary call goes to the configured model");
    assert.equal(models.includes("main"), true, "the runs stay on the session model");
  });

  it("memory_compaction_default_model_follows_the_session", async () => {
    const requests: ProviderRequest[] = [];
    const session = await (
      await createAgent({
        model,
        packages: [definition(), mockProvider([reply(), reply(), reply("compact summary")], { onRequest: (r) => requests.push(r) })],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");

    await session.compact();

    assert.equal(requests.at(-1)?.model.model, "main");
  });

  it("memory_compaction_coding_profile_marks_the_entry", async () => {
    const session = await (
      await createAgent({
        model,
        packages: [definition({ profile: "coding" }), mockProvider([reply(), reply("compact summary")])],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");

    await session.compact();

    assert.equal(compactionData(await session.entries()).strategy, "coding");
  });

  it("memory_compaction_default_profile_marks_the_entry", async () => {
    const session = await (
      await createAgent({
        model,
        packages: [definition(), mockProvider([reply(), reply("compact summary")])],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");

    await session.compact();

    assert.equal(compactionData(await session.entries()).strategy, "llm-compaction");
  });

  it("memory_compaction_auto_trigger_compacts_on_the_configured_gate", async () => {
    const session = await (
      await createAgent({
        model,
        // The gate is the package's own `compaction.when` handler: no host hook is registered here.
        packages: [
          definition({ trigger: { type: "threshold_tokens", tokens: 1 } }),
          mockProvider([reply("first"), reply("second"), reply("compact summary"), reply("third")]),
        ],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");

    assert.equal(compactionData(await session.entries()).strategy, "llm-compaction", "the token gate compacted the branch");
  });

  it("memory_compaction_auto_trigger_abstains_below_the_gate", async () => {
    const session = await (
      await createAgent({
        model,
        packages: [definition({ trigger: { type: "threshold_tokens", tokens: 1_000_000 } }), mockProvider([reply()])],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");

    const kinds = (await session.entries()).map((entry) => entry.kind);
    assert.equal(kinds.includes("compaction"), false, "an abstaining handler means no compaction");
  });
});
