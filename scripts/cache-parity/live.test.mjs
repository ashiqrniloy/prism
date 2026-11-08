import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parityGate, shouldRerun } from "./metrics.mjs";
import { CELLS, DEFERRED_CELLS, preflight, runGate } from "./live.mjs";
import { resolveSuiteState } from "../live-matrix.mjs";
import { REPO_ROOT } from "./run.mjs";

const pass = (id) => ({ id, verdict: "pass" });

describe("parity gate", () => {
  test("parity_gate_passes_when_prism_median_at_least_pi", () => {
    expect(parityGate([pass("a"), pass("b"), { id: "c", verdict: "deferred" }]).pass).toBe(true);
    expect(parityGate([pass("a")], { strict: true }).pass).toBe(true);
  });

  test("parity_gate_fails_on_lower_median", () => {
    const gate = parityGate([pass("a"), { id: "b", verdict: "behind" }]);
    expect(gate.pass).toBe(false);
    expect(gate.failures.map((failure) => failure.id)).toEqual(["b"]);
  });

  test("parity_gate_fails_on_usage_mismatch", () => {
    expect(parityGate([{ id: "a", verdict: "usage_mismatch", reason: "request 2 inputTokens" }]).pass).toBe(false);
    expect(parityGate([{ id: "a", verdict: "budget_exceeded" }]).pass).toBe(false);
    expect(parityGate([{ id: "a", verdict: "reference_config_mutated" }]).pass).toBe(false);
  });

  test("parity_gate_strict_fails_inconclusive", () => {
    const cells = [pass("a"), { id: "b", verdict: "inconclusive" }, { id: "c", verdict: "unmeasurable" }];
    expect(parityGate(cells).pass).toBe(true);
    expect(parityGate(cells, { strict: true }).pass).toBe(false);
    expect(parityGate([{ id: "x", verdict: "something_new" }]).pass).toBe(false);
  });

  test("rerun_is_for_a_first_inconclusive_only", () => {
    expect(shouldRerun("inconclusive", 0)).toBe(true);
    expect(shouldRerun("inconclusive", 1)).toBe(false);
    expect(shouldRerun("behind", 0)).toBe(false);
  });

  test("gate_reruns_inconclusive_once_and_keeps_every_attempt", async () => {
    const calls = [];
    const result = await runGate(
      [{ id: "a" }, { id: "b" }],
      async (spec, attempt) => {
        calls.push(`${spec.id}:${attempt}`);
        const verdict = spec.id === "a" && attempt === 0 ? "inconclusive" : "pass";
        return { cell: { verdict }, requests: { used: 10, ceiling: 120 } };
      },
      { strict: true },
    );
    expect(calls).toEqual(["a:0", "a:1", "b:0"]);
    expect(result.attempts).toHaveLength(3);
    expect(result.gate.pass).toBe(true);
    const stuck = await runGate([{ id: "a" }], async () => ({ cell: { verdict: "inconclusive" }, requests: { used: 1, ceiling: 120 } }), { strict: true });
    expect(stuck.attempts).toHaveLength(2);
    expect(stuck.gate.pass).toBe(false);
  });

  test("gate_stops_when_the_pi_config_changed", async () => {
    const calls = [];
    const result = await runGate(
      [{ id: "a" }, { id: "b" }],
      async (spec) => {
        calls.push(spec.id);
        return { cell: { verdict: "reference_config_mutated" }, requests: { used: 1, ceiling: 120 } };
      },
    );
    expect(calls).toEqual(["a"]);
    expect(result.gate.pass).toBe(false);
  });
});

describe("parity row", () => {
  const row = () => JSON.parse(readFileSync(join(REPO_ROOT, "scripts/live-matrix.json"), "utf8")).suites.find((suite) => suite.id === "release/cache-parity");

  test("parity_row_skips_without_pi", () => {
    expect(preflight({ piHome: "/x", which: () => false, exists: () => true })).toEqual({ ok: false, reason: "pi is not on PATH" });
    const noExtension = preflight({ piHome: "/x", which: () => true, exists: (path) => !path.endsWith("pi-ollama-cloud") });
    expect(noExtension.ok).toBe(false);
    expect(noExtension.reason).toContain("pi-ollama-cloud");
    expect(preflight({ piHome: "/x", which: () => true, exists: () => true }).ok).toBe(true);
  });

  test("parity_row_requires_the_amended_keys_and_skips_without_them", () => {
    const suite = row();
    expect(suite.requires).toEqual(["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_CACHE_PARITY", "COMMAND_CODE_API_KEY", "OLLAMA_API_KEY"]);
    expect(resolveSuiteState(suite, {}).state).toBe("skip");
    expect(resolveSuiteState(suite, Object.fromEntries(suite.requires.map((name) => [name, "1"]))).state).toBe("run");
    expect(suite.command).toBe("bun scripts/cache-parity/live.mjs");
    expect(existsSync(join(REPO_ROOT, suite.source))).toBe(true);
    for (const name of ["Command Code", "Ollama Cloud", "120 requests"]) expect(`${suite.scope} ${suite.cost}`).toContain(name);
  });

  test("cells_match_task_21_matrix_and_deferred_cells_are_not_failures", () => {
    expect(CELLS.map((cell) => cell.model)).toEqual(["minimax/minimax-m3.1-flash", "gpt-5.6-luna", "claude-haiku-5-5", "gemma4:31b"]);
    expect(DEFERRED_CELLS.map((cell) => cell.id)).toEqual(["hyper/chat+messages", "opencode-go/chat+messages", "openrouter/anthropic"]);
    expect(parityGate(DEFERRED_CELLS.map((cell) => ({ id: cell.id, verdict: "deferred" })), { strict: true }).pass).toBe(true);
  });
});

describe("kilo cli reference", () => {
  test("kilo_reference_reuse_uses_main_requests_only", async () => {
    const { summarize, turnPrompts } = await import("./kilo-cli-reference.mjs");
    const prompts = turnPrompts();
    expect(prompts).toHaveLength(4);
    expect(prompts[0].split(" cache").length).toBeGreaterThan(8000);
    const entries = [
      { inputTokens: 100, cacheReadTokens: 0 }, // a small title request is ignored
      { inputTokens: 20000, cacheReadTokens: 0 },
      { inputTokens: 20100, cacheReadTokens: 10000 },
      { inputTokens: 20200, cacheReadTokens: 10000 },
      { inputTokens: 20300, cacheReadTokens: 10000 },
    ];
    const summary = summarize(entries);
    expect(summary.status).toBe("measured");
    expect(summary.reuse).toBeCloseTo(0.5, 5);
    expect(summarize([{ inputTokens: 20000, cacheReadTokens: 0 }]).status).toBe("unmeasurable");
    expect(summarize([{ inputTokens: 20000 }, { inputTokens: 20100 }]).status).toBe("unmeasurable");
  });
});

describe("prism driver model config", () => {
  test("driver_copies_wire_and_cache_fields_from_the_catalog", async () => {
    const { withCatalogFields } = await import("./host-model.ts");
    const catalog = [
      { model: "gpt-5.6-luna", compat: { route: "responses" }, cache: { kind: "implicit" }, limits: { context: 100 } },
      { model: "claude-haiku-5-5", compat: { route: "anthropic" }, cache: { kind: "cache_control", maxBreakpoints: 4 } },
    ];
    const config = {
      models: {
        a: { provider: "commandcode", model: "gpt-5.6-luna" },
        b: { provider: "commandcode", model: "claude-haiku-5-5", cache: { kind: "none" } },
        c: { provider: "commandcode", model: "unknown" },
      },
    };
    withCatalogFields(config, catalog);
    expect(config.models.a.compat).toEqual({ route: "responses" });
    expect(config.models.a.limits).toEqual({ context: 100 });
    expect(config.models.b.compat).toEqual({ route: "anthropic" });
    expect(config.models.b.cache).toEqual({ kind: "none" }); // an explicit host value is never overwritten
    expect(config.models.c).toEqual({ provider: "commandcode", model: "unknown" });
  });
});
