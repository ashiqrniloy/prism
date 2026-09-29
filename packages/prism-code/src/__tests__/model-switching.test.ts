import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProvider, type ProviderRequest, providerDone, providerTextDelta } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import type { PrismCodeConfig } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent } from "../headless.js";
import { createProviderCache, enrichModelConfig, UNKNOWN_MODEL_LIMITS } from "../providers.js";
import { createPrismCodeTui } from "../tui/index.js";
import { selectionRunOptions } from "../tui/selection.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-switch-${prefix}-`));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function emitKey(renderer: any, name: string, shift = false): void {
  renderer.keyInput.emit("keypress", { name, ctrl: false, shift, meta: false } as any);
}

/** A config whose model carries catalog limits/capabilities, the way the binary hands it to the TUI. */
async function mockConfig(cwd: string): Promise<PrismCodeConfig> {
  const { model } = await enrichModelConfig({ provider: "mock", model: "default" });
  return { cwd, store: { type: "memory" }, model };
}

function makeManager(): PrismCodeCredentialManager {
  return new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
}

describe("Provider cache and model enrichment", () => {
  it("priming constructs at most one instance per provider id and shares concurrent attempts", async () => {
    const cache = createProviderCache();
    const model = { provider: "mock", model: "default" };

    const [first, second] = await Promise.all([cache.prime(model), cache.prime(model)]);
    assert.strictEqual(first, second, "concurrent primes must share one construction");
    assert.strictEqual(cache.get(model), first);
    assert.strictEqual(cache.size, 1);
    assert.strictEqual(await cache.prime(model), first, "later primes reuse the cached instance");

    await cache.prime({ provider: "mock", model: "other" });
    assert.strictEqual(cache.size, 1, "same provider id keeps one instance across models");

    cache.clear();
    assert.strictEqual(cache.get(model), undefined);
    assert.strictEqual(cache.size, 0);
  });

  it("run options derive model, provider source, and effort from one selection", () => {
    const cache = createProviderCache();
    const provider = createMockProvider([providerDone()], { id: "mock" });
    cache.seed("mock", provider);
    const model = { provider: "mock", model: "default" };

    const options = selectionRunOptions({ model, effort: "low" }, cache, { signal: undefined });
    assert.deepEqual(options.model, model);
    assert.strictEqual(options.providerSource?.(model), provider);
    assert.strictEqual(options.thinkingLevel, "low");

    // UI-only labels never reach the provider request.
    for (const effort of ["off", "unavailable", "none"]) {
      assert.strictEqual(selectionRunOptions({ model, effort }, cache).thinkingLevel, undefined, effort);
    }
  });

  it("enriches a catalog model with limits/capabilities and falls back to documented defaults otherwise", async () => {
    const known = await enrichModelConfig({ provider: "mock", model: "default" });
    assert.strictEqual(known.usedDefaults, false);
    assert.deepEqual(known.model.capabilities?.thinkingLevels, ["none", "low", "medium", "high"]);

    const unknown = await enrichModelConfig({ provider: "mock", model: "brand-new-model" });
    assert.strictEqual(unknown.usedDefaults, true);
    assert.deepEqual(unknown.model.limits, UNKNOWN_MODEL_LIMITS);
    assert.strictEqual(unknown.model.capabilities, undefined, "enrichment never invents effort levels");

    // A live-discovered selection may carry capabilities but no limits; it still gains catalog limits
    // (the compaction trigger resolves the input cap from them).
    const discovered = { provider: "mock", model: "default", capabilities: { reasoning: false } };
    const completed = await enrichModelConfig(discovered);
    assert.deepEqual(completed.model.limits, known.model.limits);
    assert.strictEqual(completed.usedDefaults, false);

    // A fully described selection is returned untouched (identity).
    const already = {
      provider: "mock",
      model: "default",
      ...(known.model.limits ? { limits: known.model.limits } : {}),
      capabilities: { reasoning: false },
    };
    const unchanged = await enrichModelConfig(already);
    assert.strictEqual(unchanged.model, already);
    assert.strictEqual(unchanged.usedDefaults, false);
  });
});

describe("Per-run model/provider/effort switching", () => {
  it("assembles the headless agent with providerSource, so a /model switch reaches the next run", async () => {
    const dir = await makeTempDir("headless");
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const requestsA: ProviderRequest[] = [];
      const requestsB: ProviderRequest[] = [];
      const providerA = createMockProvider([providerTextDelta("answer from A"), providerDone()], {
        id: "mock-a",
        onRequest: (request) => requestsA.push(request),
      });
      const providerB = createMockProvider([providerTextDelta("answer from B"), providerDone()], {
        id: "mock-b",
        onRequest: (request) => requestsB.push(request),
      });

      const manager = makeManager();
      const cache = createProviderCache({ credentialManager: manager });
      const config = await mockConfig(dir);
      const definition = await assembleAppAgent(config, providerA, undefined, undefined, manager, cache);

      // A fixed agent-level provider would shadow every per-run override in core.
      assert.strictEqual(definition.agent.config.provider, undefined);
      assert.strictEqual(definition.agent.config.providerSource?.({ provider: "mock", model: "default" })?.id, "mock-a");

      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config,
        credentialManager: manager,
        providerCache: cache,
        onExit: () => {},
      });
      await tui.start(definition);

      const providerIds: string[] = [];
      const session = (tui as any).session;
      void (async () => {
        for await (const event of session.subscribe({ acrossRuns: true })) {
          if (event.type === "provider_turn_started") providerIds.push(event.metadata.providerId);
        }
      })();

      await (tui as any).handlePromptSubmit("first");
      assert.strictEqual(requestsA.length, 1, "run 1 must use the primed instance");
      assert.ok(JSON.stringify((tui as any).state.entries).includes("answer from A"));

      // Credential/selection change: the cached instance is replaced, then `/model` re-applies the selection.
      cache.clear();
      cache.seed("mock", providerB);
      void (tui as any).handlePromptSubmit("/model");
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "model picker");
      emitKey(env.renderer, "return");
      await waitFor(() => (tui as any).pickerComponent?.isVisible === false, "picker closed");
      await new Promise((resolve) => setTimeout(resolve, 20));

      await (tui as any).handlePromptSubmit("second");
      assert.strictEqual(requestsA.length, 1, "run 2 must not reuse the replaced instance");
      assert.strictEqual(requestsB.length, 1, "run 2 must use the newly selected provider instance");
      assert.ok(JSON.stringify((tui as any).state.entries).includes("answer from B"));
      assert.strictEqual(requestsB[0]?.model.displayName, "Mock Default Model", "the run carries the selected catalog model");

      await waitFor(() => providerIds.length === 2, "provider turn events");
      assert.deepEqual(providerIds, ["mock-a", "mock-b"]);

      await tui.close();
    } finally {
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Shift+Tab effort (and an effort restored at launch) rides the run as thinkingLevel", async () => {
    const dir = await makeTempDir("effort");
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const requests: ProviderRequest[] = [];
      const provider = createMockProvider([providerTextDelta("ok"), providerDone()], {
        id: "mock",
        onRequest: (request) => requests.push(request),
      });
      const manager = makeManager();
      const cache = createProviderCache({ credentialManager: manager });
      const config = await mockConfig(dir);
      const definition = await assembleAppAgent(config, provider, undefined, undefined, manager, cache);

      const selections: Array<{ model: string; effort: string }> = [];
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config,
        credentialManager: manager,
        providerCache: cache,
        initialEffort: "none",
        onSelectionChange: (selection) => selections.push({ model: selection.model.model, effort: selection.effort }),
        onExit: () => {},
      });
      await tui.start(definition);

      await (tui as any).handlePromptSubmit("no effort yet");
      assert.strictEqual(requests[0]?.options?.compat?.reasoning_effort, undefined);

      emitKey(env.renderer, "tab", true);
      assert.strictEqual((tui as any).selection.effort, "low");
      assert.deepEqual(selections.at(-1), { model: "default", effort: "low" }, "selection change is persisted");

      await (tui as any).handlePromptSubmit("with effort");
      assert.strictEqual(requests[1]?.options?.compat?.reasoning_effort, "low");

      await tui.close();

      // Restart: the remembered effort is restored and applied to the next run.
      const restoredEnv = await createTestRenderer({ width: 80, height: 24 });
      const restored = createPrismCodeTui({
        renderer: restoredEnv.renderer,
        config,
        credentialManager: manager,
        providerCache: cache,
        initialEffort: "high",
        onExit: () => {},
      });
      await restored.start(definition);
      assert.strictEqual((restored as any).selection.effort, "high");
      await (restored as any).handlePromptSubmit("restored effort");
      assert.strictEqual(requests[2]?.options?.compat?.reasoning_effort, "high");
      await restored.close();
      restoredEnv.renderer.destroy();
    } finally {
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clamps a restored effort to the model's declared levels and flags assumed limits in the footer", async () => {
    const dir = await makeTempDir("clamp");
    try {
      const manager = makeManager();
      const config = await mockConfig(dir);
      const tui = createPrismCodeTui({
        config,
        credentialManager: manager,
        initialEffort: "xhigh", // never declared by the mock catalog entry
        modelNotice: "limits assumed",
        onExit: () => {},
      });
      await tui.start(await assembleAppAgent(config, createMockProvider([providerDone()]), undefined, undefined, manager));
      assert.strictEqual((tui as any).selection.effort, "none", "undeclared effort levels are clamped to the first declared level");
      assert.strictEqual((tui as any).state.footer.modelNotice, "limits assumed");
      await tui.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("/compact resolves the current selection through the shared provider cache", async () => {
    const dir = await makeTempDir("compact");
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const compactRequests: ProviderRequest[] = [];
      const compactProvider = createMockProvider([providerTextDelta("{}"), providerDone()], {
        id: "mock-b",
        onRequest: (request) => compactRequests.push(request),
      });
      const manager = makeManager();
      const cache = createProviderCache({ credentialManager: manager });
      const config = await mockConfig(dir);
      const definition = await assembleAppAgent(config, createMockProvider([providerDone()]), undefined, undefined, manager, cache);

      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config,
        credentialManager: manager,
        providerCache: cache,
        onExit: () => {},
      });
      await tui.start(definition);

      cache.clear();
      cache.seed("mock", compactProvider);
      await (tui as any).handlePromptSubmit("/compact");

      assert.strictEqual(compactRequests.length, 1, "/compact must use the cached instance for the active selection");
      assert.strictEqual(compactRequests[0]?.model.provider, "mock");
      await tui.close();
    } finally {
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
