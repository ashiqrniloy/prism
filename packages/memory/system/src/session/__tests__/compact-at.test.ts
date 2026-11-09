import { describe, expect, it } from "bun:test";
import { resolveMemorySystemConfig } from "../../index.js";
import { DEFAULT_COMPACT_AT_RATIO, resolveCompactAtThreshold } from "../config.js";

describe("om context.compactAt", () => {
  it("om_compact_at_ratio_of_input_cap", () => {
    const config = resolveMemorySystemConfig({ context: { compactAt: { ratio: 0.5, maxTokens: 900 } } });
    expect(config.context.compactAt).toEqual({ ratio: 0.5, maxTokens: 900 });
    expect(resolveCompactAtThreshold({ ratio: 0.5 }, { limits: { contextWindow: 4_000, maxOutputTokens: 0 } })).toBe(1_488);
    expect(resolveCompactAtThreshold({ ratio: 0.5, maxTokens: 900 }, { limits: { contextWindow: 4_000, maxOutputTokens: 0 } })).toBe(900);
    expect(resolveMemorySystemConfig().context.compactAt).toEqual({ ratio: DEFAULT_COMPACT_AT_RATIO });
  });

  it("om_compact_at_requires_max_tokens_without_window", () => {
    expect(resolveCompactAtThreshold({ ratio: 0.6, maxTokens: 1_200 }, { limits: {} })).toBe(1_200);
    expect(() => resolveCompactAtThreshold({ ratio: 0.6 }, { limits: {} })).toThrow(/maxTokens is required/);
  });

  it("om_compact_at_validates_ratio_and_max_tokens", () => {
    expect(() => resolveMemorySystemConfig({ context: { compactAt: { ratio: 0 } } })).toThrow(/ratio/);
    expect(() => resolveMemorySystemConfig({ context: { compactAt: { maxTokens: 0 } } })).toThrow(/maxTokens/);
  });
});
