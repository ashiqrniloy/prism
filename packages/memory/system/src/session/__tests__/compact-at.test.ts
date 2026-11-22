/**
 * Plan 218.3 Task 2: session memory's two compaction triggers. Mid-loop at `compactAt.ratio` of the model's input cap;
 * between loops at `compactAfterRun` (`maxTokens`, or `ratio` of the cap; the smaller wins), never above the mid-loop
 * threshold. The retired keys fail closed.
 */
import { describe, expect, it } from "bun:test";
import { resolveMemorySystemConfig } from "../../index.js";
import { DEFAULT_COMPACT_AFTER_RUN_TOKENS, DEFAULT_COMPACT_AT_RATIO, resolveCompactionThreshold } from "../config.js";

// A 200k window with no output reserve: resolveInputCap answers the window less its safety margin.
const big = { limits: { contextWindow: 200_000, maxOutputTokens: 0 } };
const cap = resolveCompactionThreshold({ compactAt: { ratio: 1 }, compactAfterRun: { maxTokens: 1 } }, big, "mid-loop");

describe("session memory compaction triggers", () => {
  it("defaults_are_0_8_mid_loop_and_80000_between_loops", () => {
    const { context } = resolveMemorySystemConfig();
    expect(context).toEqual({
      compaction: true,
      compactAt: { ratio: DEFAULT_COMPACT_AT_RATIO },
      compactAfterRun: { maxTokens: DEFAULT_COMPACT_AFTER_RUN_TOKENS },
    });
    expect(DEFAULT_COMPACT_AT_RATIO).toBe(0.8);
    expect(DEFAULT_COMPACT_AFTER_RUN_TOKENS).toBe(80_000);
    expect(resolveCompactionThreshold(context, big, "mid-loop")).toBe(cap * 0.8);
    expect(resolveCompactionThreshold(context, big, "between-loops")).toBe(80_000);
  });

  it("between_loops_smaller_of_max_tokens_and_ratio_and_never_above_mid_loop", () => {
    const both = resolveMemorySystemConfig({ context: { compactAfterRun: { maxTokens: 150_000, ratio: 0.3 } } }).context;
    expect(resolveCompactionThreshold(both, big, "between-loops")).toBe(cap * 0.3);
    const ratioOnly = resolveMemorySystemConfig({ context: { compactAfterRun: { ratio: 0.5 } } }).context;
    expect(ratioOnly.compactAfterRun).toEqual({ ratio: 0.5 });
    expect(resolveCompactionThreshold(ratioOnly, big, "between-loops")).toBe(cap * 0.5);
    const small = { limits: { contextWindow: 32_000, maxOutputTokens: 0 } };
    const defaults = resolveMemorySystemConfig().context;
    expect(resolveCompactionThreshold(defaults, small, "between-loops")).toBe(resolveCompactionThreshold(defaults, small, "mid-loop"));
  });

  it("no_window_needs_compact_after_run_max_tokens", () => {
    const defaults = resolveMemorySystemConfig().context;
    expect(resolveCompactionThreshold(defaults, { limits: {} }, "between-loops")).toBe(80_000);
    expect(resolveCompactionThreshold(defaults, { limits: {} }, "mid-loop")).toBe(Number.POSITIVE_INFINITY);
    const ratioOnly = resolveMemorySystemConfig({ context: { compactAfterRun: { ratio: 0.5 } } }).context;
    expect(() => resolveCompactionThreshold(ratioOnly, { limits: {} }, "between-loops")).toThrow(
      /context\.compactAfterRun\.maxTokens is required.*limits\.contextWindow/,
    );
  });

  it("validates_ratios_and_max_tokens", () => {
    expect(() => resolveMemorySystemConfig({ context: { compactAt: { ratio: 0 } } })).toThrow(/compactAt\.ratio/);
    expect(() => resolveMemorySystemConfig({ context: { compactAfterRun: { maxTokens: 0 } } })).toThrow(/compactAfterRun\.maxTokens/);
    expect(() => resolveMemorySystemConfig({ context: { compactAfterRun: { ratio: 1.5 } } })).toThrow(/compactAfterRun\.ratio/);
  });

  it("retired_context_keys_are_unknown", () => {
    expect(() => resolveMemorySystemConfig({ context: { recentMessages: 4 } } as never)).toThrow(/context\.recentMessages" was retired/);
    expect(() => resolveMemorySystemConfig({ context: { trigger: { type: "each_turn" } } } as never)).toThrow(
      /context\.trigger" was retired/,
    );
    expect(() => resolveMemorySystemConfig({ context: { compactAt: { maxTokens: 9 } } } as never)).toThrow(
      /context\.compactAt\.maxTokens" was retired; use "context\.compactAfterRun\.maxTokens/,
    );
  });
});
