import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  type AgentSession,
  type AIProvider,
  type CompactionEntryData,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionEntry,
  type ToolDefinition,
  toolCallContent,
} from "@arnilo/prism";
import {
  PRISM_CODE_DEFAULT_COMPACTION_RATIO,
  PRISM_CODE_DEFAULT_COMPACTION_TOKENS,
  PRISM_CODE_DEFAULT_KEEP_RECENT_ENTRIES,
  PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES,
  PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS,
  PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES,
  resolvePrismCodeCompaction,
  resolvePrismCodeContextBudget,
  resolvePrismCodeToolResultFold,
} from "../compaction.js";
import { type PrismCodeConfig, validatePrismCodeConfigLayer } from "../config.js";
import { assembleAppAgent } from "../headless.js";
import { createProviderCache } from "../providers.js";
import { createInitialTuiState, tuiReducer } from "../tui/reducer.js";

const testModel: ModelConfig = {
  provider: "mock",
  model: "test-model",
  limits: { contextWindow: 4_000, maxOutputTokens: 200 },
};

const workTool: ToolDefinition = {
  name: "do_work",
  description: "Performs sample work",
  parameters: { type: "object", properties: { step: { type: "number" } } },
  execute: async (args, ctx) => {
    return {
      toolCallId: ctx.toolCallId,
      name: "do_work",
      value: { done: true, step: (args as { step?: number }).step ?? 1, output: "x".repeat(300) },
    };
  },
};

function multiTurnMockProvider(options: { readonly rounds?: number } = {}): { provider: AIProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  const maxRounds = options.rounds ?? 2;
  let mainTurns = 0;
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        const hasTools = (request.tools ?? []).length > 0;
        if (!hasTools) {
          // Compaction summarization request (has no tools)
          yield providerTextDelta("Summary of previous work");
          yield providerDone();
          return;
        }
        mainTurns += 1;
        if (mainTurns < maxRounds) {
          yield providerToolCall(toolCallContent(`call_${mainTurns}`, "do_work", { step: mainTurns }));
          yield providerDone();
        } else {
          yield providerTextDelta(`Finished work in round ${mainTurns}`);
          yield providerDone();
        }
      },
    },
  };
}

function collectSessionEvents(session: AgentSession): { readonly events: AgentEvent[]; readonly done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.subscribe()) {
      events.push(event);
    }
  })();
  return { events, done };
}

describe("Prism Code context management and long runs", () => {
  describe("resolvePrismCodeCompaction", () => {
    const cache = createProviderCache();
    cache.seed(testModel.provider, multiTurnMockProvider().provider);

    it("resolves default LLM coding compaction with input_ratio trigger (0.8)", () => {
      const compaction = resolvePrismCodeCompaction(undefined, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      assert.equal(compaction.keepRecentEntries, PRISM_CODE_DEFAULT_KEEP_RECENT_ENTRIES);
      assert.deepEqual(compaction.trigger, { type: "input_ratio", ratio: PRISM_CODE_DEFAULT_COMPACTION_RATIO });
      assert.ok(compaction.strategy);
      assert.equal(compaction.strategy.name, "coding");
    });

    it("resolves observational-memory (OM) compaction strategy", () => {
      const compaction = resolvePrismCodeCompaction({ strategy: "om" }, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      assert.ok(compaction.strategy);
      assert.equal(compaction.strategy.name, "observational-memory");
    });

    it("resolves each_turn trigger", () => {
      const compaction = resolvePrismCodeCompaction({ trigger: "each_turn" }, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      assert.deepEqual(compaction.trigger, { type: "each_turn" });
    });

    it("resolves threshold_tokens trigger", () => {
      const compaction = resolvePrismCodeCompaction({ trigger: "threshold_tokens", tokens: 10_000 }, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      assert.deepEqual(compaction.trigger, { type: "threshold_tokens", tokens: 10_000 });
    });

    it("resolves threshold_entries trigger", () => {
      const compaction = resolvePrismCodeCompaction({ trigger: "threshold_entries", entries: 25 }, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      assert.deepEqual(compaction.trigger, { type: "threshold_entries", entries: 25 });
    });

    it("falls back to a token trigger for a model whose input cap cannot be resolved", () => {
      const windowless: ModelConfig = { provider: "mock", model: "raw" };
      const fallback = resolvePrismCodeCompaction(undefined, windowless, cache);
      assert.notEqual(fallback, false);
      if (fallback === false) return;
      assert.deepEqual(fallback.trigger, { type: "threshold_tokens", tokens: PRISM_CODE_DEFAULT_COMPACTION_TOKENS });

      // An explicitly configured ratio keeps the core contract: it fails loudly at run time, not silently.
      const explicit = resolvePrismCodeCompaction({ ratio: 0.5 }, windowless, cache);
      assert.notEqual(explicit, false);
      if (explicit === false) return;
      assert.deepEqual(explicit.trigger, { type: "input_ratio", ratio: 0.5 });

      // A window too small for output + reserve is the same unusable-cap case.
      const cramped = resolvePrismCodeCompaction(
        undefined,
        { provider: "mock", model: "cramped", limits: { contextWindow: 4_000, maxOutputTokens: 4_000 } },
        cache,
      );
      assert.notEqual(cramped, false);
      if (cramped === false) return;
      assert.deepEqual(cramped.trigger, { type: "threshold_tokens", tokens: PRISM_CODE_DEFAULT_COMPACTION_TOKENS });
    });

    it("resolves custom ratio, keepRecentEntries, and maxSummaryChars", () => {
      const compaction = resolvePrismCodeCompaction({ ratio: 0.65, keepRecentEntries: 4, maxSummaryChars: 2_000 }, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      assert.equal(compaction.keepRecentEntries, 4);
      assert.equal(compaction.maxSummaryChars, 2_000);
      assert.deepEqual(compaction.trigger, { type: "input_ratio", ratio: 0.65 });
    });

    it("honors a configured keepRecentTokens budget, capped at half the window", async () => {
      const timestamp = new Date(0).toISOString();
      // Three ~1,200-token entries against testModel's 4,000-token window, whose derived cap is 2,000.
      const entries: SessionEntry[] = ["e1", "e2", "e3"].map((id) => ({
        id,
        sessionId: "s1",
        timestamp,
        kind: "message" as const,
        message: { role: "user", content: [{ type: "text" as const, text: "x".repeat(4_800) }] },
      }));
      const cutWith = async (keepRecentTokens: number | undefined, model: ModelConfig = testModel) => {
        const compaction = resolvePrismCodeCompaction(
          { trigger: "threshold_tokens", tokens: 100_000, ...(keepRecentTokens === undefined ? {} : { keepRecentTokens }) },
          model,
          cache,
        );
        assert.notEqual(compaction, false);
        if (compaction === false) throw new Error("compaction disabled");
        const strategy = compaction.strategy;
        assert.ok(strategy, "the resolver must return a strategy");
        if (!strategy) throw new Error("no strategy");
        const result = await strategy.compact({ sessionId: "s1", entries, trigger: "auto" });
        const data = result.entries?.find((entry) => entry.kind === "compaction")?.data as CompactionEntryData | undefined;
        return data?.keepEntryIds ?? [];
      };

      // testModel's 4,000-token window derives a 2,000-token budget: the last two entries stay.
      assert.deepEqual(await cutWith(undefined), ["e2", "e3"]);
      // A tighter budget keeps only the newest entry.
      assert.deepEqual(await cutWith(1_200), ["e3"]);
      // A budget beyond half the window is clamped back to 2,000 (unclamped, all three would stay).
      assert.deepEqual(await cutWith(3_600), ["e2", "e3"]);
      // Same budget on a wide window is used as-is, so the value itself is what a host gets to tune.
      const wideModel: ModelConfig = { provider: "mock", model: "wide", limits: { contextWindow: 20_000 } };
      assert.deepEqual(await cutWith(3_600, wideModel), ["e1", "e2", "e3"]);
    });

    it("returns false when compaction is explicitly disabled", () => {
      const compaction = resolvePrismCodeCompaction(false, testModel, cache);
      assert.equal(compaction, false);
    });

    it("keeps the latest todo_write turn out of the compaction cut", async () => {
      const compaction = resolvePrismCodeCompaction({ trigger: "threshold_tokens", tokens: 100_000 }, testModel, cache);
      assert.notEqual(compaction, false);
      if (compaction === false) return;

      const timestamp = new Date(0).toISOString();
      const entries: SessionEntry[] = [
        {
          id: "e1",
          sessionId: "s1",
          timestamp,
          kind: "message",
          message: {
            role: "assistant",
            content: [{ type: "tool_call", id: "call_todo", name: "todo_write", arguments: {} }],
          },
        },
        {
          id: "e2",
          sessionId: "s1",
          timestamp,
          kind: "message",
          message: {
            role: "tool",
            content: [{ type: "tool_result", toolCallId: "call_todo", name: "todo_write", result: "- [ ] 1: step" }],
            metadata: { todos: [{ id: "1", content: "step", status: "pending" }] },
          },
        },
        // Large tail entry: the strategy's token budget keeps only this one.
        {
          id: "e3",
          sessionId: "s1",
          timestamp,
          kind: "message",
          message: { role: "user", content: [{ type: "text", text: "x".repeat(12_000) }] },
        },
      ];

      const strategy = compaction.strategy;
      assert.ok(strategy, "the resolver must return a strategy");
      if (!strategy) return;
      const result = await strategy.compact({ sessionId: "s1", entries, trigger: "auto" });
      const data = result.entries?.find((entry) => entry.kind === "compaction")?.data as CompactionEntryData | undefined;
      assert.ok(data, "the strategy must return a compaction entry with data");
      // The plan turn (call + result) is appended to the strategy's own kept entries.
      assert.deepEqual(data?.keepEntryIds, ["e3", "e1", "e2"]);
    });
  });

  describe("resolvePrismCodeToolResultFold", () => {
    it("configures fold limits and summary capping", async () => {
      const fold = resolvePrismCodeToolResultFold();
      assert.equal(fold.minAgeTurns, PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS);
      assert.equal(fold.minBytes, PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES);
      assert.equal(fold.maxSummaryBytes, PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES);

      const largeText = "a".repeat(10_000);
      const summaryResult = fold.summarize({
        sessionId: "s1",
        runId: "r1",
        turn: 3,
        toolName: "read_file",
        toolCallId: "call_1",
        text: largeText,
      });
      const summary = typeof summaryResult === "string" ? summaryResult : await summaryResult;
      assert.ok(summary.includes("Folded output of read_file"));
      assert.ok(Buffer.byteLength(summary, "utf8") <= PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES);
    });
  });

  describe("resolvePrismCodeContextBudget", () => {
    it("sets budget to 95% of model context window", () => {
      const budget = resolvePrismCodeContextBudget(testModel);
      assert.equal(budget.maxInputTokens, Math.floor(4_000 * 0.95));
      assert.equal(budget.reportOmissions, true);
    });

    it("falls back to 32,000 window when unspecified", () => {
      const modelWithoutWindow: ModelConfig = { provider: "mock", model: "raw" };
      const budget = resolvePrismCodeContextBudget(modelWithoutWindow);
      assert.equal(budget.maxInputTokens, Math.floor(32_000 * 0.95));
      assert.equal(budget.reportOmissions, true);
    });
  });

  describe("config validation for compaction", () => {
    it("accepts valid compaction configuration", () => {
      const validated = validatePrismCodeConfigLayer({
        compaction: {
          strategy: "om",
          trigger: "each_turn",
          keepRecentEntries: 6,
          keepRecentTokens: 4_000,
          maxSummaryChars: 1500,
        },
      });
      assert.deepEqual(validated.compaction, {
        strategy: "om",
        trigger: "each_turn",
        keepRecentEntries: 6,
        keepRecentTokens: 4_000,
        maxSummaryChars: 1500,
      });

      const disabled = validatePrismCodeConfigLayer({ compaction: false });
      assert.equal(disabled.compaction, false);
    });

    it("rejects invalid compaction options", () => {
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { strategy: "unknown" as any } }), /compaction.strategy/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { trigger: "invalid" as any } }), /compaction.trigger/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { ratio: 1.5 } }), /compaction.ratio/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { ratio: -0.1 } }), /compaction.ratio/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { tokens: -5 } }), /compaction.tokens/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { entries: 0 } }), /compaction.entries/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { keepRecentTokens: -1 } }), /compaction.keepRecentTokens/);
      assert.throws(() => validatePrismCodeConfigLayer({ compaction: { keepRecentTokens: 1.5 } }), /compaction.keepRecentTokens/);
    });
  });

  describe("TUI reducer compaction event handling", () => {
    it("creates system note for compaction_finished", () => {
      const initial = createInitialTuiState();
      const next = tuiReducer(initial, {
        type: "session_event",
        event: {
          type: "compaction_finished",
          sessionId: "test-session",
          summary: "Summary of compaction",
          entriesCompacted: 7,
        },
      });

      const entry = next.entries.find((e) => e.type === "message" && e.role === "system");
      assert.ok(entry);
      if (entry && entry.type === "message") {
        assert.equal(entry.text, "[Compacted history]\nSummary of compaction");
      }
    });

    it("creates system note with counts when the compaction summary is empty", () => {
      const initial = createInitialTuiState();
      const withCount = tuiReducer(initial, {
        type: "session_event",
        event: {
          type: "compaction_finished",
          sessionId: "test-session",
          summary: "",
          entriesCompacted: 7,
        },
      });
      const counted = withCount.entries.find((e) => e.type === "message" && e.role === "system");
      assert.ok(counted);
      if (counted && counted.type === "message") {
        assert.equal(counted.text, "Compacted 7 entries");
      }

      const withoutCount = tuiReducer(initial, {
        type: "session_event",
        event: {
          type: "compaction_finished",
          sessionId: "test-session",
          summary: "",
        },
      });
      const generic = withoutCount.entries.find((e) => e.type === "message" && e.role === "system");
      assert.ok(generic);
      if (generic && generic.type === "message") {
        assert.equal(generic.text, "Compacted context");
      }
    });

    it("creates warning system note for compaction_failed", () => {
      const initial = createInitialTuiState();
      const next = tuiReducer(initial, {
        type: "session_event",
        event: {
          type: "compaction_failed",
          sessionId: "test-session",
          error: {
            name: "CompactionError",
            message: "Context too large for summarizer",
          },
        },
      });

      const entry = next.entries.find((e) => e.type === "message" && e.role === "system");
      assert.ok(entry);
      if (entry && entry.type === "message") {
        assert.ok(entry.text.includes("Warning: Compaction failed (Context too large for summarizer), continuing uncompacted"));
      }
    });
  });

  describe("End-to-end multi-turn compaction via assembleAppAgent", () => {
    it("runs mid-run compaction between turns when each_turn is configured", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "prism-long-run-"));
      try {
        const { provider, requests } = multiTurnMockProvider({ rounds: 2 });
        const config: PrismCodeConfig = {
          cwd: tempDir,
          model: testModel,
          tools: { planes: { coding: false } },
          compaction: {
            strategy: "coding",
            trigger: "each_turn",
            keepRecentEntries: 2,
          },
        };

        const definition = await assembleAppAgent(config, provider);
        const session = definition.createSession();
        ((session as any).agent.config.tools as any).register(workTool);

        const { events, done } = collectSessionEvents(session);
        const result = await session.run("Run multi-turn coding task");
        await done;

        assert.equal(result.status, "succeeded");
        const mainRequests = requests.filter((r) => (r.tools ?? []).length > 0);
        assert.equal(mainRequests.length, 2, "Ran exactly 2 agent turns");

        // Verify compaction_finished event was emitted
        const finished = events.find((e) => e.type === "compaction_finished");
        assert.ok(finished, "compaction_finished event emitted");
        if (finished && finished.type === "compaction_finished") {
          assert.ok(typeof finished.entriesCompacted === "number");
          assert.ok(finished.entriesCompacted > 0);
        }

        // Verify entries in session store contain compaction entry
        const entries = await session.entries();
        const compactionEntry = entries.find((e) => e.kind === "compaction");
        assert.ok(compactionEntry, "Compaction record persisted in session entries");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("runs mid-run compaction with OM strategy", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "prism-long-run-om-"));
      try {
        const { provider } = multiTurnMockProvider({ rounds: 2 });
        const config: PrismCodeConfig = {
          cwd: tempDir,
          model: testModel,
          tools: { planes: { coding: false } },
          compaction: {
            strategy: "om",
            trigger: "each_turn",
            keepRecentEntries: 2,
          },
        };

        const definition = await assembleAppAgent(config, provider);
        const session = definition.createSession();
        ((session as any).agent.config.tools as any).register(workTool);

        const { events, done } = collectSessionEvents(session);
        const result = await session.run("Run OM multi-turn task");
        await done;

        assert.equal(result.status, "succeeded");
        const finished = events.find((e) => e.type === "compaction_finished");
        assert.ok(finished, "compaction_finished event emitted with OM strategy");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not run compaction when compaction: false is set", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "prism-long-run-disabled-"));
      try {
        const { provider } = multiTurnMockProvider({ rounds: 2 });
        const config: PrismCodeConfig = {
          cwd: tempDir,
          model: testModel,
          tools: { planes: { coding: false } },
          compaction: false,
        };

        const definition = await assembleAppAgent(config, provider);
        const session = definition.createSession();
        ((session as any).agent.config.tools as any).register(workTool);

        const { events, done } = collectSessionEvents(session);
        const result = await session.run("Run without compaction");
        await done;

        assert.equal(result.status, "succeeded");
        const finished = events.find((e) => e.type === "compaction_finished");
        assert.equal(finished, undefined, "No compaction when compaction: false");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
