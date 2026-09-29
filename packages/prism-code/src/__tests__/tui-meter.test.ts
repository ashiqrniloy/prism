import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, createMockProvider, providerDone, providerTextDelta, type Usage } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import type { PrismCodeConfig } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent } from "../headless.js";
import { createProviderCache, enrichModelConfig } from "../providers.js";
import {
  CONTEXT_DANGER_COLOR,
  CONTEXT_WARN_COLOR,
  footerDetailSegments,
  formatFooterDetails,
  formatTokenCount,
  formatTokenTotals,
  formatUsageCost,
} from "../tui/components/status.js";
import { createPrismCodeTui } from "../tui/index.js";
import { createInitialTuiState, type TuiState, tuiReducer } from "../tui/reducer.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-meter-${prefix}-`));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function apply(state: TuiState, event: AgentEvent): TuiState {
  return tuiReducer(state, { type: "session_event", event });
}

function turnFinished(usage: Usage, runId = "r1"): AgentEvent {
  return {
    type: "provider_turn_finished",
    sessionId: "s1",
    runId,
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "default" } },
    usage,
  };
}

describe("TUI usage meter", () => {
  it("accumulates per-turn usage, including cache reads, and tracks the context reading", () => {
    let state = createInitialTuiState();
    state = apply(state, turnFinished({ inputTokens: 42_000, outputTokens: 300, cacheReadTokens: 1_000, totalTokens: 43_300 }));
    state = apply(state, turnFinished({ inputTokens: 51_000, outputTokens: 700, cost: 0.25, currency: "USD" }));

    assert.equal(state.footer.usageTotals?.inputTokens, 93_000);
    assert.equal(state.footer.usageTotals?.outputTokens, 1_000);
    assert.equal(state.footer.usageTotals?.cacheReadTokens, 1_000);
    assert.equal(state.footer.usageTotals?.cost, 0.25);
    assert.equal(state.footer.contextTokens, 51_000, "context reading follows the latest reported turn");
    assert.equal(state.footer.contextSource, "reported");

    const estimated = apply(state, turnFinished({ inputTokens: 60_000, estimated: true }));
    assert.equal(estimated.footer.contextSource, "estimated");
  });

  it("does not double count when a run reported per-turn usage", () => {
    let state = createInitialTuiState();
    state = tuiReducer(state, { type: "run_started", runId: "r1" });
    state = apply(state, turnFinished({ inputTokens: 10_000, outputTokens: 100 }));
    state = apply(state, {
      type: "agent_finished",
      sessionId: "s1",
      runId: "r1",
      usage: { inputTokens: 10_000, outputTokens: 100 },
    });
    assert.equal(state.footer.usageTotals?.inputTokens, 10_000, "the run total repeats the counted turns");

    // A deterministic/resumed run with no per-turn usage contributes its run total as a fallback.
    state = tuiReducer(state, { type: "run_started", runId: "r2" });
    state = apply(state, { type: "agent_finished", sessionId: "s1", runId: "r2", usage: { inputTokens: 2_000 } });
    assert.equal(state.footer.usageTotals?.inputTokens, 12_000);
  });

  it("drops the stale context reading after compaction and accepts the lower one", () => {
    let state = createInitialTuiState();
    state = apply(state, turnFinished({ inputTokens: 120_000 }));
    assert.equal(state.footer.contextTokens, 120_000);

    state = apply(state, { type: "compaction_finished", sessionId: "s1", summary: "sum", entriesCompacted: 20 });
    assert.equal(state.footer.contextTokens, undefined, "pre-compaction reading overstates the rebuilt context");

    state = tuiReducer(state, {
      type: "set_footer",
      footer: { contextTokens: 24_000, contextCap: 200_000, contextSource: "estimated" },
    });
    assert.equal(
      formatFooterDetails(3, { contextTokens: state.footer.contextTokens, contextCap: 200_000, contextSource: "estimated" }),
      "MCP: 3 connected | ctx ~24k/200k 12%",
    );
  });

  it("clears accumulated usage when the session is replaced", () => {
    let state = createInitialTuiState();
    state = apply(state, turnFinished({ inputTokens: 5_000, outputTokens: 50, cost: 0.1, currency: "USD" }));
    state = tuiReducer(state, { type: "reset_session", sessionId: "s2" });
    assert.equal(state.footer.usageTotals, undefined);
    assert.equal(state.footer.usage, undefined);
    assert.equal(state.footer.contextTokens, undefined);
  });

  it("formats counts, totals and cost, and hides unknown pricing", () => {
    assert.equal(formatTokenCount(999), "999");
    assert.equal(formatTokenCount(42_000), "42k");
    assert.equal(formatTokenCount(1_200_000), "1.2M");
    assert.equal(formatTokenTotals({ inputTokens: 1_200_000, outputTokens: 48_000, cacheReadTokens: 3 }), "↑1.2M ↓48k");
    assert.equal(formatTokenTotals(undefined), undefined);
    assert.equal(formatUsageCost({ cost: 3.41 }), "$3.41");
    assert.equal(formatUsageCost({ cost: 3.41, currency: "EUR" }), "€3.41");
    assert.equal(formatUsageCost({ cost: 3.41, currency: "XBT" }), "3.41 XBT");
    assert.equal(formatUsageCost({ inputTokens: 10 }), undefined, "no price reported -> no cost segment");

    const meter = {
      contextTokens: 42_000,
      contextCap: 200_000,
      contextSource: "reported" as const,
      usage: { inputTokens: 1_000, cost: 0.5 },
    };
    assert.equal(
      formatFooterDetails(3, meter, "off", "limits assumed", 200),
      "MCP: 3 connected | OM: off | ctx 42k/200k 21% | ↑1k | $0.50 | limits assumed",
    );
  });

  it("color-shifts the context segment at 70% and 90%", () => {
    const colorAt = (tokens: number): string | undefined =>
      footerDetailSegments(1, { contextTokens: tokens, contextCap: 100_000, contextSource: "reported" }).find((segment) =>
        segment.text.includes("ctx"),
      )?.color;
    assert.equal(colorAt(20_000), undefined);
    assert.equal(colorAt(70_000), CONTEXT_WARN_COLOR);
    assert.equal(colorAt(90_000), CONTEXT_DANGER_COLOR);
  });

  it("drops the cost first and the token totals second on narrow terminals", () => {
    const meter = {
      contextTokens: 42_000,
      contextCap: 200_000,
      contextSource: "reported" as const,
      usage: { inputTokens: 1_200_000, outputTokens: 48_000, cost: 3.41 },
    };
    const wide = formatFooterDetails(3, meter, undefined, undefined, 200);
    assert.ok(wide.includes("$3.41") && wide.includes("↑1.2M ↓48k"));

    const medium = formatFooterDetails(3, meter, undefined, undefined, 50);
    assert.ok(!medium.includes("$3.41"), "cost drops first");
    assert.ok(medium.includes("↑1.2M ↓48k"));

    const narrow = formatFooterDetails(3, meter, undefined, undefined, 20);
    assert.ok(!narrow.includes("↑1.2M"), "token totals drop second");
    assert.ok(narrow.includes("ctx 42k/200k 21%"));
  });

  it("renders live usage from a real run and refreshes the context meter once per change", async () => {
    const dir = await makeTempDir("wiring");
    const env = await createTestRenderer({ width: 100, height: 30 });
    const provider = createMockProvider(
      [
        { type: "usage", usage: { inputTokens: 150_000, outputTokens: 400, cacheReadTokens: 1_000 } },
        providerTextDelta("ok"),
        providerDone(),
      ],
      { id: "mock" },
    );
    const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
    const cache = createProviderCache({ credentialManager: manager });
    const { model } = await enrichModelConfig({ provider: "mock", model: "default" });
    const config: PrismCodeConfig = { cwd: dir, store: { type: "memory" }, model };
    const definition = await assembleAppAgent(config, provider, undefined, undefined, manager, cache);
    const tui = createPrismCodeTui({ renderer: env.renderer, config, credentialManager: manager, providerCache: cache, onExit: () => {} });
    const internals = tui as unknown as {
      state: TuiState;
      session: { contextMeter: () => unknown };
      syncContextMeter: () => void;
      statusComponent: { update: (status: unknown) => void };
      handlePromptSubmit: (text: string) => Promise<void>;
    };

    try {
      await tui.start(definition);
      await internals.handlePromptSubmit("hello");
      await waitFor(() => internals.state.footer.usageTotals?.inputTokens === 150_000, "usage totals");

      assert.equal(internals.state.footer.usageTotals?.cacheReadTokens, 1_000);
      assert.equal(internals.state.footer.contextTokens, 150_000);
      assert.equal(internals.state.footer.contextSource, "reported");

      internals.syncContextMeter();
      const settled = internals.state.footer;
      internals.syncContextMeter();
      assert.strictEqual(internals.state.footer, settled, "an unchanged meter reading never re-renders the footer");

      // Manual compaction refreshes the reading from the session; the stub stands in for the
      // post-compaction estimate (the session clears its reported meter on `compact()`).
      internals.session.contextMeter = () => ({ inputTokens: 24_000, source: "estimated", inputCap: 200_000, usedRatio: 0.12 });
      internals.syncContextMeter();
      internals.statusComponent.update(internals.state.footer);

      await env.renderOnce();
      const frame = env.captureCharFrame();
      assert.match(frame, /ctx ~24k\/200k 12%/);
      assert.match(frame, /↑151k ↓400/);
      assert.equal(formatUsageCost(internals.state.footer.usageTotals), undefined, "no priced usage in the mock stream -> no cost segment");
    } finally {
      await tui.close();
      await definition.dispose();
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
