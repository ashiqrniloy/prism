import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  type SessionEntry,
  createAgent,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
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

/** A scripted `mock` provider whose catalog alone declares the window, counting catalog reads. */
function catalogProvider(script: readonly (readonly ProviderEvent[])[], reads: { count: number }) {
  let turn = 0;
  const provider: ModelProvider = {
    id: "mock",
    models: async () => {
      reads.count += 1;
      return [{ provider: "mock", model: "main", limits: { contextWindow: 2_000, maxOutputTokens: 0 } }];
    },
    generate: (request) => createMockProvider(script[Math.min(turn++, script.length - 1)] ?? []).generate(request),
  };
  return providerPackage("mock-catalog", [provider]);
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
    assert.equal(agent.inspect().slots.compaction, "@arnilo/prism-extensions/compaction");
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

  it("memory_compaction_auto_trigger_declines_below_the_gate", async () => {
    // The package votes `false` below its gate, so the host's `thresholdEntries` fallback (which would
    // fire immediately here) cannot override it.
    const session = await (
      await createAgent({
        model,
        compaction: { thresholdEntries: 0 },
        packages: [definition({ trigger: { type: "threshold_tokens", tokens: 1_000_000 } }), mockProvider([reply()])],
      })
    ).session({ id: "s1", create: true });
    await session.run("old");

    const kinds = (await session.entries()).map((entry) => entry.kind);
    assert.equal(kinds.includes("compaction"), false, "a false vote below the gate overrides the host fallback");
  });

  it("input_ratio_trigger_resolves_cap_from_provider_catalog", async () => {
    // Plan 229 Further Actions P2: a bare `"provider/model"` ref carries no window, so the package's
    // `input_ratio` gate reads the cap from the provider catalog. Cap: 2,000 - 1,024 reserve = 976.
    const reads = { count: 0 };
    const agent = await createAgent({
      model: "mock/main",
      packages: [
        definition({ trigger: { type: "input_ratio", ratio: 0.5 } }),
        catalogProvider([reply("first"), reply("compact summary"), reply("second")], reads),
      ],
    });
    assert.equal(reads.count, 0, "createAgent never reads the catalog");
    const session = await agent.session({ id: "s1", create: true });
    await session.run("hi");
    await session.run("y".repeat(4_000));

    assert.equal(compactionData(await session.entries()).strategy, "llm-compaction", "the catalog's window fed the package's gate");
    assert.equal(reads.count, 1, "the catalog is read once per agent");
    await agent.dispose();
  });

  it("compaction_package_without_trigger_uses_kernel_default", async () => {
    // Plan 229 Task 4: with no `trigger` the package registers no vote, so the kernel's default
    // (80% of the input cap) decides, and the package's compactor writes the entry. Cap: 2,000 - 1,024 reserve = 976.
    const agent = await createAgent({
      model: { ...model, limits: { contextWindow: 2_000, maxOutputTokens: 0 } },
      packages: [definition(), mockProvider([reply("first"), reply("compact summary"), reply("second")])],
    });
    assert.equal((agent.inspect().hooks["compaction.when"] ?? []).length, 0, "no vote without a trigger");
    const session = await agent.session({ id: "s1", create: true });
    await session.run("hi");
    await session.run("y".repeat(4_000));

    assert.equal(compactionData(await session.entries()).strategy, "llm-compaction", "the kernel default fired the package's compactor");
    await agent.dispose();
  });
});
