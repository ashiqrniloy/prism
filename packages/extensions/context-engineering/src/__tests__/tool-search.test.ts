/**
 * Tool search, moved from the kernel's `src/tool-search.ts` into
 * `@arnilo/prism-extensions/context-engineering` by plan 158 Task 7.
 *
 * The kernel suite drove disclosure through `assembleProviderInput` and the session's
 * `toolsDisclosure`; the package drives it through `selectDisclosedTools` over the draft, which is
 * the same call the `context.build` handler makes, so these legs test the narrowing directly.
 * `context_engineering_tool_search_respects_when` covers the end-to-end path.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  createActiveToolSet,
  createSearchToolsTool,
  createToolSearchIndex,
  createToolSearchState,
  HARD_MAX_TOOLS_INDEX,
  scoreTools,
  SEARCH_TOOLS_TOOL_NAME,
  selectDisclosedTools,
  ToolDisclosureError,
} from "../tool-search.js";
import type { ToolDefinition } from "@arnilo/prism";

function fixtureTools(count: number, prefix = "tool"): ToolDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}_${index}`,
    description: `Handles domain ${index % 8} with verbs ${index % 5}. Fixture tool ${index} for disclosure testing.`,
    parameters: { type: "object", properties: {} },
    execute: () => ({ toolCallId: "x", name: `${prefix}_${index}` }),
  }));
}

describe("tool search scoring", () => {
  it("exact name match ranks first", () => {
    const tools: ToolDefinition[] = [
      {
        name: "deploy_service",
        description: "Rolls out a service release.",
        parameters: { type: "object", properties: {} },
        execute: () => ({ toolCallId: "x", name: "deploy_service" }),
      },
      ...fixtureTools(24),
    ];
    const index = createToolSearchIndex(tools);
    assert.equal(scoreTools(index, "deploy_service", 5)[0]!.name, "deploy_service");
  });

  it("multi-term IDF ordering is stable and deterministic", () => {
    const index = createToolSearchIndex(fixtureTools(50));
    const first = scoreTools(index, "domain 3 verbs 2", 10);
    assert.deepEqual(
      first.map((match) => match.name),
      scoreTools(index, "domain 3 verbs 2", 10).map((match) => match.name),
    );
    const names = first.map((match) => match.name);
    // tool_2 matches "domain 2" + "verbs 2"; tool_3 matches "domain 3" + "verbs 3": both outrank one-term tools.
    assert.ok(names.includes("tool_2"));
    assert.ok(names.includes("tool_3"));
    assert.ok(names.length <= 10);
  });

  it("empty query returns no matches; oversized query is sliced, not rejected", () => {
    const index = createToolSearchIndex(fixtureTools(10));
    assert.deepEqual(scoreTools(index, "", 5), []);
    assert.deepEqual(scoreTools(index, "   ", 5), []);
    assert.ok(scoreTools(index, `tool_${"x".repeat(200_000)}`, 5).length <= 5);
  });

  it("index build throws past the frozen hard cap", () => {
    assert.throws(() => createToolSearchIndex(fixtureTools(HARD_MAX_TOOLS_INDEX + 1)), ToolDisclosureError);
  });

  it("1024-tool registry indexes and scores within the turn envelope", () => {
    const startedAt = performance.now();
    const index = createToolSearchIndex(fixtureTools(HARD_MAX_TOOLS_INDEX));
    const matches = scoreTools(index, "domain 7 verbs 1 fixture", 16);
    const elapsedMs = performance.now() - startedAt;
    assert.ok(matches.length > 0);
    // ponytail: generous wall-clock envelope to avoid CI flake; catches only gross regressions.
    assert.ok(elapsedMs < 500, `index+score took ${elapsedMs}ms`);
  });
});

describe("draft disclosure", () => {
  it("discloses at most topK plus search_tools, and never widens the input list", () => {
    const tools = fixtureTools(64);
    const disclosed = selectDisclosedTools({ tools, input: "Audit invoices and page on-call now.", search: { topK: 16 } });
    assert.ok(disclosed.length <= 17, "top-k plus the always-on activation tool");
    const names = new Set(tools.map((tool) => tool.name));
    names.add(SEARCH_TOOLS_TOOL_NAME);
    for (const tool of disclosed) assert.ok(names.has(tool.name), `${tool.name} was not in the input list`);
  });

  it("keeps activated and search_tools tools alongside the turn top-k", () => {
    const tools = fixtureTools(64);
    const activated = createActiveToolSet();
    activated.add("tool_60");
    const disclosed = selectDisclosedTools({ tools, input: "page on-call", search: { topK: 4 }, activated });
    assert.ok(disclosed.some((tool) => tool.name === "tool_60"));
    assert.ok(disclosed.length <= 4 + activated.list().length);
  });

  it("fail-closed: index overflow discloses the full input list, never zero", () => {
    const tools = fixtureTools(HARD_MAX_TOOLS_INDEX + 1);
    assert.equal(selectDisclosedTools({ tools, input: "anything", search: { topK: 16 } }).length, tools.length);
  });
});

describe("search_tools tool", () => {
  const context = { sessionId: "s", runId: "r", toolCallId: "c1" } as never;

  function handler() {
    const activated = createActiveToolSet();
    const state = createToolSearchState({ tools: fixtureTools(32), activated, search: { topK: 8 } });
    return { tool: createSearchToolsTool(state), activated };
  }

  it("rejects empty, non-string, and oversized queries; rejects bad k", async () => {
    const { tool } = handler();
    const bad: readonly unknown[] = [
      { query: "" },
      { query: "   " },
      { query: 5 },
      { query: `x${"y".repeat(70_000)}` },
      { query: "ok", k: 0 },
      { query: "ok", k: 1.5 },
      { query: "ok", k: -3 },
      { k: 4 },
    ];
    for (const args of bad) {
      const result = await tool.execute(args as never, context);
      assert.ok(result.error, `expected rejection for ${JSON.stringify(args).slice(0, 40)}`);
    }
  });

  it("activates bounded results and returns inert name+description text", async () => {
    const { tool, activated } = handler();
    const result = await tool.execute({ query: "domain 3 fixture tool" }, context);
    assert.ok(!result.error);
    const names = activated.list();
    assert.ok(names.length > 0 && names.length <= 8);
    const text = result.content?.find((block) => block.type === "text");
    assert.ok(text && "text" in text && text.text.startsWith("- "));
    assert.ok(!JSON.stringify(result).includes('"type":"object"}'), "no schemas leak into search results");
  });

  it("unknown-keyword query returns a bounded miss message without activation", async () => {
    const { tool, activated } = handler();
    const result = await tool.execute({ query: "zzzqqq unmatchable" }, context);
    assert.ok(!result.error);
    assert.equal(activated.list().length, 0);
    const text = result.content?.find((block) => block.type === "text");
    assert.ok(text && "text" in text && text.text.includes("No tools matched"));
  });
});
