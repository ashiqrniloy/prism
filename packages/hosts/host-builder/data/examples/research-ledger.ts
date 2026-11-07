/**
 * Offline: bun examples/research-ledger.ts
 * A mock fetch records two sources. One citation passes. An unknown id fails the check.
 */
import { createAgent, type ToolDefinition } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import toolsResearch from "@arnilo/prism-tools-research";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`research_ledger_example: ${message}`);
}

const fetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fixture fetch.",
  effects: ["network"],
  parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  async execute(args, context) {
    return {
      toolCallId: context.toolCallId,
      name: "web_fetch",
      value: { url: args.url, title: "T" },
      content: [{ type: "text", text: "fetched" }],
    };
  },
};

export async function demo() {
  const passed = await createAgent({
    model: { provider: "mock", model: "m" },
    tools: { add: [fetchTool] },
    packages: [
      mockProvider([
        [
          providerToolCall(toolCallContent("c1", "web_fetch", { url: "https://a.test/one" })),
          providerToolCall(toolCallContent("c2", "web_fetch", { url: "https://b.test/two" })),
          providerDone(),
        ],
        [providerTextDelta("Kept [[cite:S1]]."), providerDone()],
      ]),
      toolsResearch({ sourceTools: ["web_fetch"] }),
    ],
  });
  try {
    const session = await passed.session({ id: "ok", create: true });
    await session.run("research");
    const verdict = await passed.commands.run("research.verify", {}, { session });
    assert(verdict !== undefined && typeof verdict === "object", "verify returned nothing");
    const report = verdict as { verdict: string; unresolved: string[]; ledgerSize: number };
    assert(report.verdict === "passed", `expected passed, got ${report.verdict}`);
    assert(report.ledgerSize === 2, `expected 2 sources, got ${report.ledgerSize}`);
    assert(report.unresolved.length === 0, "passed run has unresolved ids");
  } finally {
    await passed.dispose();
  }

  const failed = await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [
      mockProvider([[providerTextDelta("Invented [[cite:S9]]."), providerDone()]]),
      toolsResearch({ sourceTools: ["web_fetch"], maxRepairs: 0 }),
    ],
  });
  try {
    const session = await failed.session({ id: "bad", create: true });
    await session.run("research");
    const report = (await failed.commands.run("research.verify", {}, { session })) as {
      verdict: string;
      unresolved: string[];
    };
    assert(report.verdict === "failed", `expected failed, got ${report.verdict}`);
    assert(report.unresolved.includes("S9"), "failed run did not name S9");
    console.log(JSON.stringify({ passed: { verdict: "passed", ledgerSize: 2 }, failed: report }));
  } finally {
    await failed.dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await demo();
