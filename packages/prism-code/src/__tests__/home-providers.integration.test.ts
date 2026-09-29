/**
 * Offline end-to-end journey (plans/136 Task 8): a *clean* `PRISM_HOME` through first-run store
 * selection, TUI onboarding, the owner-only file credential store, a process restart, a run, a
 * `/model` switch, `/logout`, and the real binary restarting against the same home.
 *
 * All provider traffic is stubbed; the provider instances are mocks bound to the real shipped
 * descriptor ids, so the credential/store/selection plumbing under test is the production one.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createMockProvider, type ProviderRequest, providerDone, providerTextDelta } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import type { PrismCodeConfig } from "../config.js";
import { selectCredentialStore } from "../credentials.js";
import { assembleAppAgent } from "../headless.js";
import { ensureHomeDir, readState, writeState } from "../home.js";
import { createProviderCache, enrichModelConfig } from "../providers.js";
import { createPrismCodeTui } from "../tui/index.js";
import { stubGlobalFetch } from "./helpers/global-fetch.js";

/** Deliberately not secret-shaped: the scanners must never mistake a fixture for a credential. */
const TEST_KEY = "anthropic-integration-key";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-journey-${prefix}-`));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function emitKey(renderer: any, name: string): void {
  renderer.keyInput.emit("keypress", { name, ctrl: false, shift: false, meta: false } as any);
}

/** Everything the stream component renders; command results land here (not in reducer state). */
function streamText(tui: any): string {
  const entryMap = tui.streamComponent?.entryMap as Map<string, { entry: { text?: string; message?: string } }> | undefined;
  if (!entryMap) return "";
  return [...entryMap.values()].map((item) => item.entry.text ?? item.entry.message ?? "").join("\n");
}

function emitText(renderer: any, text: string): void {
  for (const char of text) emitKey(renderer, char);
}

/** Model-list probe + `/model` discovery for anthropic; nothing else is fetched. */
function stubAnthropicModels(): () => void {
  return stubGlobalFetch(
    (async () =>
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5" }, { id: "claude-haiku-4-5" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
  );
}

describe("clean home -> providers -> credentials journey", () => {
  it("onboards, stores the key on disk, restarts, runs, switches model, and signs out", async () => {
    const home = await makeTempDir("home");
    const workspace = await makeTempDir("workspace");
    const restoreFetch = stubAnthropicModels();
    try {
      ensureHomeDir(home);
      const config: PrismCodeConfig = { cwd: workspace, store: { type: "memory" }, credentials: { store: "auto" } };

      // 1. Clean home: nothing stored, no store chosen yet.
      assert.deepEqual(readState(home).state, {});
      assert.strictEqual(existsSync(join(home, "auth.json")), false);

      const first = await selectCredentialStore({
        config,
        state: {},
        home,
        env: {},
        probeKeychain: async () => ({ status: "unavailable" }),
      });
      assert.strictEqual(first.needsChoice, true, "no keychain and no saved choice asks the operator");
      await first.apply("file");
      writeState(home, { credentialStore: "file" });

      // 2. Onboarding in the running renderer: provider -> masked key -> model.
      const env = await createTestRenderer({ width: 80, height: 24 });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config,
        credentialManager: first.manager,
        onExit: () => {},
      });
      const onboarded = tui.onboardProvider();

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker");
      emitText(env.renderer, "anthropic");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      emitText(env.renderer, TEST_KEY);
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "model picker");
      emitKey(env.renderer, "return");

      const model = await onboarded;
      assert.equal(model?.provider, "anthropic");
      assert.equal(model?.model, "claude-sonnet-5");
      assert.equal(await first.manager.getApiKey("anthropic"), TEST_KEY);

      // 3. The key landed in the owner-only file, not in the transcript.
      const authPath = join(home, "auth.json");
      assert.ok(existsSync(authPath), "the file store must persist the key");
      assert.strictEqual(statSync(authPath).mode & 0o077, 0, "auth.json must not be group/other readable");
      assert.ok(readFileSync(authPath, "utf8").includes("anthropic"));
      assert.equal(JSON.stringify((tui as any).state).includes(TEST_KEY), false, "the secret must never reach reducer state");

      // 4. Remembered selection (what the binary's onSelectionChange writes).
      writeState(home, { lastModel: model, lastEffort: "low" });
      await tui.close();
      env.renderer.destroy();

      // 5. Restart: same home, fresh process-level objects, no interactive prompt.
      const restored = readState(home);
      assert.deepEqual(restored.state.lastModel, { provider: "anthropic", model: "claude-sonnet-5" });
      assert.equal(restored.state.lastEffort, "low");

      const second = await selectCredentialStore({
        config,
        state: restored.state,
        home,
        env: {},
        probeKeychain: async () => ({ status: "unavailable" }),
      });
      assert.strictEqual(second.needsChoice, false, "the saved choice is reused on restart");
      assert.strictEqual(second.choice, "file");
      assert.equal(await second.manager.getApiKey("anthropic"), TEST_KEY, "the stored key survives the restart");

      const restoredModel = restored.state.lastModel;
      assert.ok(restoredModel, "state.json must remember the model");
      const enriched = await enrichModelConfig(restoredModel);
      assert.strictEqual(enriched.usedDefaults, false, "the restored model resolves from the shipped catalog");
      assert.ok(enriched.model.capabilities?.thinkingLevels?.includes("low"));

      // 6. Run with the restored selection: mock provider bound to the real descriptor id.
      const requests: ProviderRequest[] = [];
      const provider = createMockProvider([providerTextDelta("restored run"), providerDone()], {
        id: "anthropic",
        onRequest: (request) => requests.push(request),
      });
      const cache = createProviderCache({ credentialManager: second.manager });
      const runConfig: PrismCodeConfig = { ...config, model: enriched.model };
      const definition = await assembleAppAgent(runConfig, provider, undefined, undefined, second.manager, cache);

      const restoredEnv = await createTestRenderer({ width: 80, height: 24 });
      const restoredTui = createPrismCodeTui({
        renderer: restoredEnv.renderer,
        config: runConfig,
        credentialManager: second.manager,
        providerCache: cache,
        initialEffort: restored.state.lastEffort,
        onSelectionChange: ({ model: selection, effort }) => writeState(home, { lastModel: selection, lastEffort: effort }),
        onExit: () => {},
      });
      await restoredTui.start(definition);
      await (restoredTui as any).handlePromptSubmit("after restart");
      await waitFor(() => JSON.stringify((restoredTui as any).state.entries).includes("restored run"), "restored run");

      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0]?.model.provider, "anthropic", "the run uses the restored provider");
      assert.strictEqual(requests[0]?.model.model, "claude-sonnet-5");
      // The anthropic catalog declares the `output_config_effort` family, so a restored "low" effort arrives there.
      assert.deepEqual(requests[0]?.options?.compat?.output_config, { effort: "low" }, "the restored effort rides the run");

      // 7. `/model` switch: live discovery (stubbed) then a different catalog-shaped model.
      void (restoredTui as any).handlePromptSubmit("/model");
      await waitFor(() => (restoredTui as any).pickerComponent?.isVisible === true, "model picker");
      emitText(restoredEnv.renderer, "haiku");
      emitKey(restoredEnv.renderer, "return");
      await waitFor(() => (restoredTui as any).pickerComponent?.isVisible === false, "model picker closed");
      // The command resumes from `picker.show()` in a microtask after the key handler returns.
      await waitFor(() => (restoredTui as any).selection.model.model === "claude-haiku-4-5", "model switch applied");
      assert.deepEqual(readState(home).state.lastModel, { provider: "anthropic", model: "claude-haiku-4-5" }, "the switch is persisted");

      await (restoredTui as any).handlePromptSubmit("after switch");
      await waitFor(() => requests.length === 2, "second run");
      assert.strictEqual(requests[1]?.model.model, "claude-haiku-4-5", "the next run carries the switched model");

      // 8. `/logout` deletes the stored key from disk and leaves env vars alone.
      await (restoredTui as any).handlePromptSubmit("/logout anthropic");
      await waitFor(() => streamText(restoredTui).includes("Signed out"), "sign-out message");
      assert.equal(await second.manager.getApiKey("anthropic"), undefined, "no key is stored after /logout");
      assert.equal(readFileSync(authPath, "utf8").includes("anthropic"), false, "the key is gone from auth.json");
      assert.equal(streamText(restoredTui).includes(TEST_KEY), false, "the deleted key never appears in the stream");
      assert.equal(JSON.stringify((restoredTui as any).state).includes(TEST_KEY), false);

      await restoredTui.close();
      restoredEnv.renderer.destroy();
    } finally {
      restoreFetch();
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  }, 20_000);

  it("the real binary restarts against the same home: state.json model restored and the run executes", async () => {
    const home = await makeTempDir("bin-home");
    const workspace = await makeTempDir("bin-workspace");
    try {
      // The global layer pins the store so the run never depends on this host's keychain.
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "config.json"), JSON.stringify({ credentials: { store: "file" } }));
      await writeFile(
        join(home, "state.json"),
        JSON.stringify({ lastModel: { provider: "mock", model: "brand-new-model" }, lastEffort: "high" }),
      );

      const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
        ? resolve(__dirname, "../../../bin/prism-code.ts")
        : resolve(__dirname, "../../bin/prism-code.ts");
      const result = spawnSync(process.execPath, [binPath, "-p", "restart journey", "--mode", "print"], {
        encoding: "utf8",
        cwd: workspace,
        env: { ...process.env, PRISM_HOME: home },
      });

      assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes("Mock response"), `stdout: ${result.stdout}`);
      assert.ok(
        result.stderr.includes('limits assumed (32,000 ctx) — "brand-new-model" is not in the mock catalog'),
        `stderr: ${result.stderr}`,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});
