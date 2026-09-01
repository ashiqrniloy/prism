import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAgentRunState, saveAgentRunState } from "../agent-run-state.js";
import {
  assembleProviderInput,
  createActiveToolSet,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createSearchToolsTool,
  createToolSearchIndex,
  createToolSearchState,
  HARD_MAX_TOOLS_INDEX,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  SEARCH_TOOLS_TOOL_NAME,
  scoreTools,
  selectDisclosedTools,
  ToolDisclosureError,
  toolCallContent,
} from "../index.js";

function fixtureTools(count: number, prefix = "tool") {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}_${index}`,
    description: `Handles domain ${index % 8} with verbs ${index % 5}. Fixture tool ${index} for disclosure testing.`,
    parameters: { type: "object", properties: {} },
    execute: () => ({ toolCallId: "x", name: `${prefix}_${index}` }),
  }));
}

describe("tool search scoring", () => {
  it("exact name match ranks first", () => {
    const tools = [
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
      first.map((m) => m.name),
      scoreTools(index, "domain 3 verbs 2", 10).map((m) => m.name),
    );
    const names = first.map((m) => m.name);
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

describe("tools disclosure in provider assembly", () => {
  const base = { model: { provider: "mock" as const, model: "demo" }, input: "Audit invoices and page on-call now." };

  it("search mode discloses at most topK + search_tools; default mode is byte-identical", async () => {
    const tools = fixtureTools(64);
    const allRequest = await assembleProviderInput({ ...base, tools });
    const searchRequest = await assembleProviderInput({ ...base, tools, toolsDisclosure: "search", toolsSearch: { topK: 16 } });
    assert.equal((allRequest.tools ?? []).length, 64);
    assert.ok((searchRequest.tools ?? []).length <= 17);
    // No search tool at raw-assembly level: only the session run generates one (session test covers it).
    assert.ok(!(searchRequest.tools ?? []).some((tool) => tool.name === SEARCH_TOOLS_TOOL_NAME));
    const defaultRequest = await assembleProviderInput({ ...base, tools });
    assert.equal(JSON.stringify(defaultRequest.tools), JSON.stringify(allRequest.tools));
    assert.equal(JSON.stringify(defaultRequest.messages), JSON.stringify(allRequest.messages));
  });

  it("fail-closed: index overflow discloses the full input list, never zero", async () => {
    const tools = fixtureTools(HARD_MAX_TOOLS_INDEX + 1);
    const request = await assembleProviderInput({ ...base, tools, toolsDisclosure: "search", toolsSearch: { topK: 16 } });
    assert.equal((request.tools ?? []).length, tools.length);
  });

  it("disclosed set is a subset of the input list (search never widens)", async () => {
    const tools = fixtureTools(40);
    const request = await assembleProviderInput({ ...base, tools, toolsDisclosure: "search", toolsSearch: { topK: 8 } });
    const names = new Set(tools.map((tool) => tool.name));
    names.add(SEARCH_TOOLS_TOOL_NAME);
    for (const tool of request.tools ?? []) assert.ok(names.has(tool.name), `${tool.name} was not in the input list`);
  });

  it("selectDisclosedTools keeps activated and search_tools tools alongside the turn top-k", () => {
    const tools = fixtureTools(64);
    const activated = createActiveToolSet();
    activated.add("tool_60");
    const disclosed = selectDisclosedTools({ tools, input: "page on-call", search: { topK: 4 }, activated });
    assert.ok(disclosed.some((tool) => tool.name === "tool_60"));
    assert.ok(disclosed.length <= 4 + activated.list().length);
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
    for (const args of bad)
      assert.ok((await tool.execute(args as never, context)).error, `expected rejection for ${JSON.stringify(args).slice(0, 40)}`);
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

describe("activation persistence", () => {
  it("persists activatedToolNames names-only and restores them; over-cap rejected", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const base = {
      agentId: "a",
      fingerprint: "fp",
      runId: "r1",
      sessionId: "s1",
      model: { provider: "mock" as const, model: "demo" },
      status: "suspended" as const,
      schemaVersion: 1 as const,
      definitionRevision: "1" as const,
      counters: {
        turns: 0,
        providerAttempts: 0,
        toolRounds: 0,
        toolCalls: 0,
        wallTimeMs: 0,
        requestBytes: 0,
        responseBytes: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      },
      deadlineAt: "0",
    };
    await saveAgentRunState({
      checkpoints,
      state: { ...base, sessionState: { activatedToolNames: ["tool_1", "tool_2"] } },
      expectedVersion: 0,
      ownership: { userId: "u" },
    });
    const loaded = await loadAgentRunState(checkpoints, { runId: "r1", sessionId: "s1" }, { userId: "u" });
    assert.deepEqual(loaded.state.sessionState?.activatedToolNames, ["tool_1", "tool_2"]);
    await assert.rejects(
      saveAgentRunState({
        checkpoints,
        state: {
          ...base,
          runId: "r2",
          sessionId: "s2",
          sessionState: { activatedToolNames: Array.from({ length: 129 }, (_, i) => `tool_${i}`) },
        },
        expectedVersion: 0,
        ownership: { userId: "u" },
      }),
      /Activated-tool names exceed/,
    );
  });
});

describe("tool-accuracy fixtures (pick correct tool among distractors, plan 041 Task 3)", () => {
  // Scripted provider emulating a model that reads the DISCLOSED tool list and
  // picks the tool whose name best lexically matches the turn text (token
  // overlap). In "all" mode every tool is visible; in "search" mode only the
  // disclosed subset. Same matcher both modes, so any accuracy gap isolates
  // retrieval loss from disclosure — conformance requires search >= full.
  function overlapPick(query: string, tools: readonly { name: string }[]): string {
    const terms = new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
    let best = tools[0]!.name;
    let bestScore = -1;
    for (const tool of tools) {
      const nameTokens = tool.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      const score = nameTokens.filter((token) => terms.has(token)).length;
      if (score > bestScore) {
        bestScore = score;
        best = tool.name;
      }
    }
    return best;
  }

  async function accuracyBatch(
    mode: "all" | "search",
    toolCount: number,
    subjectCount: number,
  ): Promise<{ picks: number; correct: number }> {
    let picks = 0;
    let correct = 0;
    for (let subject = 0; subject < subjectCount; subject += 1) {
      const intended = `cap_${subject === 0 ? 0 : subject * Math.floor(toolCount / subjectCount)}`;
      const query = `Find and use fixture tool ${parseInt(intended.split("_")[1]!, 10)}`;
      let picked = false;
      const provider = {
        id: "mock",
        async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
          if (!picked) {
            picked = true;
            const disclosed = request.tools ?? [];
            const name = overlapPick(query, disclosed);
            picks += 1;
            if (name === intended) correct += 1;
          }
          yield { type: "tool_call" as const, call: toolCallContent(`call-${subject}`, intended, {}) };
          yield providerTextDelta("done");
          yield providerDone();
        },
      };
      const agent = createAgent({
        id: `accuracy-${mode}-${toolCount}`,
        store: createMemorySessionStore(),
        model: { provider: "mock", model: "demo" },
        provider,
        toolsDisclosure: mode,
        toolsSearch: { topK: 16 },
        tools: fixtureTools(toolCount, "cap"),
      });
      await agent.createSession({ id: `accuracy-${mode}-${toolCount}-${subject}` }).run(query);
      assert.ok(picked);
    }
    return { picks, correct };
  }

  for (const toolCount of [64, 128]) {
    it(`search mode retains full-exposure pick accuracy at ${toolCount} tools`, async () => {
      const subjects = Math.min(16, toolCount / 4);
      const all = await accuracyBatch("all", toolCount, subjects);
      const search = await accuracyBatch("search", toolCount, subjects);
      assert.equal(all.picks, subjects);
      assert.ok(search.picks === subjects);
      // Conformance floor: on-demand disclosure never yields worse tool choice
      // than full exposure on the same fixture and same scripted picker.
      assert.ok(search.correct >= all.correct, `search picked ${search.correct}/${subjects} vs full exposure ${all.correct}/${subjects}`);
      assert.ok(search.correct >= subjects - 1, `search pick accuracy ${search.correct}/${subjects} too low`);
    });
  }
});

describe("progressive tool loading session run", () => {
  it("search mode: model activates a tool via search_tools, then dispatches it next turn", async () => {
    const seenRequests: ProviderRequest[] = [];
    let searched = false;
    const provider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        seenRequests.push(request);
        if (!searched) {
          searched = true;
          yield {
            type: "tool_call" as const,
            call: toolCallContent("call-search", SEARCH_TOOLS_TOOL_NAME, { query: "cap_90 fixture domain" }),
          };
          yield providerDone();
          return;
        }
        yield { type: "tool_call" as const, call: toolCallContent("call-work", "cap_90", {}) };
        yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const agent = createAgent({
      id: "tool-search-demo",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider,
      toolsDisclosure: "search",
      toolsSearch: { topK: 4 },
      tools: fixtureTools(96, "cap"),
    });
    await agent.createSession({ id: "tool-search-session" }).run("Find and use fixture tool 90");
    assert.ok(seenRequests.length >= 2);
    // Turn 1 request already carries the generated search tool and is bounded.
    const first = seenRequests[0]!;
    assert.ok(first.tools!.some((tool) => tool.name === SEARCH_TOOLS_TOOL_NAME));
    assert.ok(first.tools!.length <= 96);
    // Turn 2: the searched tool is in the disclosed set next turn.
    const last = seenRequests[seenRequests.length - 1]!;
    assert.ok(
      last.tools!.some((tool) => tool.name === "cap_90"),
      "activated tool must be disclosed next turn",
    );
  });
});
