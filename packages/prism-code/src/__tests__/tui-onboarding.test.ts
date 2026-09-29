import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent } from "../headless.js";
import { createPrismCodeTui } from "../tui/index.js";
import { stubGlobalFetch } from "./helpers/global-fetch.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-onboarding-${prefix}-`));
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

function emitText(renderer: any, text: string): void {
  for (const char of text) emitKey(renderer, char);
}

function emitPaste(renderer: any, text: string): void {
  renderer.keyInput.emit("paste", {
    type: "paste",
    bytes: new TextEncoder().encode(text),
    preventDefault: () => {},
  } as any);
}

/** Stubs the provider model-list probe used to verify a key before it is stored. */
function stubModelsFetch(status = 200): () => void {
  return stubGlobalFetch(
    (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
  );
}

describe("TUI first-run onboarding", () => {
  it("walks provider -> API key (typed) -> model, stores the key, then runs the assembled agent", async () => {
    const tempDir = await makeTempDir("happy");
    const restoreFetch = stubModelsFetch();
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir, store: { type: "memory" } },
        credentialManager: manager,
        onExit: () => {},
      });

      const onboarded = tui.onboardProvider();

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker");
      emitText(env.renderer, "anthropic");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      const secret = "sk-ant-onboarding-secret";
      emitText(env.renderer, secret);
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "model picker");
      emitKey(env.renderer, "return");

      const model = await onboarded;
      assert.equal(model?.provider, "anthropic");
      assert.equal(model?.model, "claude-sonnet-5");
      assert.equal(await manager.getApiKey("anthropic"), secret);

      // Agent is constructed only after a usable selection exists, then runs normally.
      // The assembled config carries the onboarded model and the TUI adopts the definition's provider cache.
      const definition = await assembleAppAgent(
        {
          cwd: tempDir,
          store: { type: "memory" },
          model: { provider: "anthropic", model: "claude-sonnet-5" },
          tools: { planes: { coding: false } },
        },
        createMockProvider([providerTextDelta("onboarded run"), providerDone()]),
        undefined,
        undefined,
        manager,
      );
      await tui.start(definition);
      await (tui as any).handlePromptSubmit("hello after onboarding");
      await waitFor(() => JSON.stringify((tui as any).state.entries).includes("onboarded run"), "mock provider response");

      const snapshot = JSON.stringify((tui as any).state);
      assert.equal(snapshot.includes(secret), false, "secret must never appear in reducer state");

      await definition.dispose();
    } finally {
      restoreFetch();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps a model pinned for the onboarded provider instead of re-opening the provider picker", async () => {
    // Regression (plan 140 Task 6 live run): with `--model opencode-go/<id>`, /provider kept the pinned
    // model (no model change) and the onboarding loop kept re-opening the provider picker forever.
    const tempDir = await makeTempDir("pinned");
    const restoreFetch = stubModelsFetch();
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: {
          cwd: tempDir,
          store: { type: "memory" },
          model: { provider: "opencode-go", model: "longcat-2.5-preview-free" },
        } as any,
        credentialManager: manager,
        onExit: () => {},
      });

      const onboarded = tui.onboardProvider();
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker");
      emitText(env.renderer, "opencode-go");
      emitKey(env.renderer, "return");
      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      emitText(env.renderer, "oc-pinned-key");
      emitKey(env.renderer, "return");
      // The catalog picker has no entry for the pinned gateway model: cancel it.
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "model picker");
      emitKey(env.renderer, "escape");

      const model = await onboarded;
      assert.equal(model?.provider, "opencode-go");
      assert.equal(model?.model, "longcat-2.5-preview-free");
      assert.equal(await manager.getApiKey("opencode-go"), "oc-pinned-key");

      await tui.close();
    } finally {
      restoreFetch();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a pasted secret without echoing it, and stores the paste-stripped value", async () => {
    const tempDir = await makeTempDir("paste");
    const restoreFetch = stubModelsFetch();
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir, store: { type: "memory" } },
        credentialManager: manager,
        onExit: () => {},
      });

      const onboarded = tui.onboardProvider();
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker");
      emitText(env.renderer, "openai");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      emitPaste(env.renderer, "sk-pasted-secret\n");
      assert.equal((tui as any).secretInputComponent.length, "sk-pasted-secret".length);
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "model picker");
      emitKey(env.renderer, "return");

      const model = await onboarded;
      assert.equal(model?.provider, "openai");
      assert.equal(await manager.getApiKey("openai"), "sk-pasted-secret");
      assert.equal(JSON.stringify((tui as any).state).includes("sk-pasted-secret"), false);

      await tui.close();
    } finally {
      restoreFetch();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("an unverifiable key is not stored silently, and 'Save anyway' is the explicit override", async () => {
    const tempDir = await makeTempDir("unverified");
    const restoreFetch = stubModelsFetch(401);
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir, store: { type: "memory" } },
        credentialManager: manager,
        onExit: () => {},
      });

      const onboarded = tui.onboardProvider();
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker");
      emitText(env.renderer, "openai");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      emitText(env.renderer, "sk-bad-key");
      emitKey(env.renderer, "return");

      // Verification failed: the save-anyway picker appears and "Discard" stores nothing.
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "save-anyway picker");
      emitText(env.renderer, "discard");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker reopened");
      assert.equal(await manager.getApiKey("openai"), undefined);

      // Pick the provider again and explicitly insist on saving the unverified key.
      emitText(env.renderer, "openai");
      emitKey(env.renderer, "return");
      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      emitText(env.renderer, "sk-bad-but-insisted");
      emitKey(env.renderer, "return");
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "save-anyway picker");
      emitText(env.renderer, "save");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "model picker");
      emitKey(env.renderer, "return");

      const model = await onboarded;
      assert.equal(model?.provider, "openai");
      assert.equal(await manager.getApiKey("openai"), "sk-bad-but-insisted");

      await tui.close();
    } finally {
      restoreFetch();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("Esc during credential entry stores nothing and returns to the provider picker", async () => {
    const tempDir = await makeTempDir("escape");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir, store: { type: "memory" } },
        credentialManager: manager,
        onExit: () => {},
      });

      const onboarded = tui.onboardProvider();
      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker");
      emitText(env.renderer, "openai");
      emitKey(env.renderer, "return");

      await waitFor(() => (tui as any).secretInputComponent?.isVisible === true, "secret prompt");
      emitText(env.renderer, "sk-should-not-stick");
      emitKey(env.renderer, "escape");

      await waitFor(() => (tui as any).pickerComponent?.isVisible === true, "provider picker reopened");
      assert.equal(await manager.getApiKey("openai"), undefined);
      assert.equal(JSON.stringify((tui as any).state).includes("sk-should-not-stick"), false);

      // Escaping the picker itself exits onboarding cleanly.
      emitKey(env.renderer, "escape");
      assert.equal(await onboarded, undefined);

      await tui.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("headless mode without a credential exits 1 naming prism-code and the env var", async () => {
    const tempDir = await makeTempDir("headless-guidance");
    const home = await makeTempDir("headless-home");
    try {
      const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
        ? resolve(__dirname, "../../../bin/prism-code.ts")
        : resolve(__dirname, "../../bin/prism-code.ts");
      const configPath = join(tempDir, "prism-code.json");
      await writeFile(configPath, JSON.stringify({ cwd: tempDir, credentials: { store: "memory" } }), "utf8");

      const env: NodeJS.ProcessEnv = { ...process.env, PRISM_HOME: home };
      delete env.ANTHROPIC_API_KEY;

      const result = spawnSync(
        process.execPath,
        [binPath, "-c", configPath, "-p", "hi", "--mode", "print", "--provider", "anthropic", "--model", "claude-sonnet-5"],
        { encoding: "utf8", env },
      );
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes("prism-code:"), `stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes("ANTHROPIC_API_KEY"), `stderr: ${result.stderr}`);

      const acpResult = spawnSync(
        process.execPath,
        [binPath, "-c", configPath, "--mode", "acp", "--provider", "anthropic", "--model", "claude-sonnet-5"],
        { encoding: "utf8", env },
      );
      assert.equal(acpResult.status, 1);
      assert.ok(acpResult.stderr.includes("ANTHROPIC_API_KEY"), `stderr: ${acpResult.stderr}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
});
