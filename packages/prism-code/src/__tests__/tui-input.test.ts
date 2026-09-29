import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProvider, type ProviderRequest, providerDone, providerTextDelta } from "@arnilo/prism";
import type { CliRenderer } from "@opentui/core";
import { createTestRenderer, KeyCodes } from "@opentui/core/testing";
import type { PrismCodeConfig } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent } from "../headless.js";
import { createProviderCache, enrichModelConfig } from "../providers.js";
import {
  ATTACHMENT_MARKER,
  buildFileIndex,
  buildPromptInput,
  completionContext,
  filterCompletionItems,
  filterFileIndex,
  MAX_ATTACHMENT_BYTES,
} from "../tui/completion.js";
import { InputEditorComponent } from "../tui/components/input.js";
import { sessionEntryToUiActions } from "../tui/history.js";
import { appendPromptHistory, loadPromptHistory, promptHistoryPath } from "../tui/history-store.js";
import { createPrismCodeTui } from "../tui/index.js";
import { CORE_SLASH_COMMANDS } from "../tui/keybindings.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-input-${prefix}-`));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function emitCtrlC(renderer: CliRenderer): void {
  renderer.keyInput.emit("keypress", { name: "c", ctrl: true, shift: false, meta: false } as never);
}

async function assembleTestTui(dir: string, requests: ProviderRequest[]) {
  const env = await createTestRenderer({ width: 100, height: 30 });
  const provider = createMockProvider([providerTextDelta("ok"), providerDone()], {
    id: "mock",
    onRequest: (request) => requests.push(request),
  });
  const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore(), disableKeychain: true });
  const cache = createProviderCache({ credentialManager: manager });
  const { model } = await enrichModelConfig({ provider: "mock", model: "default" });
  const config: PrismCodeConfig = { cwd: dir, store: { type: "memory" }, model };
  const definition = await assembleAppAgent(config, provider, undefined, undefined, manager, cache);
  const tui = createPrismCodeTui({ renderer: env.renderer, config, credentialManager: manager, providerCache: cache, onExit: () => {} });
  await tui.start(definition);
  return { env, tui, definition };
}

describe("TUI input editing", () => {
  it("extracts completion context and ranks commands and paths", () => {
    const command = completionContext("/mo", 3);
    assert.deepEqual(command, { kind: "command", query: "mo", start: 0, end: 3 });
    assert.equal(completionContext("run /mo", 7), undefined, "commands only complete at the start of the buffer");

    const path = completionContext("see @src/ind", 12);
    assert.ok(path);
    assert.equal(path.kind, "path");
    assert.equal(path.query, "src/ind");
    assert.equal(path.start, 4);
    assert.equal(path.end, 12);

    const commands = CORE_SLASH_COMMANDS.map((item) => ({
      name: item.name,
      value: item.name,
      matchKey: item.name.replace(/^\//, ""),
    }));
    assert.equal(filterCompletionItems(commands, "mo")[0]?.value, "/model");
    assert.equal(filterCompletionItems(commands, "res")[0]?.value, "/resume");

    const entries = buildFileIndex(["src/app.ts", "src/index.ts", "README.md"]);
    assert.equal(filterFileIndex(entries, "src/ind")[0]?.path, "src/index.ts");
    assert.equal(filterFileIndex(entries, "zzz").length, 0);
  });

  it("attaches @paths inside the repository and refuses escapes", async () => {
    const parent = await makeTempDir("attach");
    const root = join(parent, "repo");
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "note.txt"), "attached body");
      await writeFile(join(parent, "outside.txt"), "outside secret");

      const result = buildPromptInput("please read @note.txt", root);
      assert.deepEqual(result.references, ["note.txt"]);
      assert.notEqual(typeof result.input, "string");
      const content = Array.isArray(result.input)
        ? []
        : ((result.input as { content: readonly { type: string; text?: string }[] }).content ?? []);
      assert.ok(
        content.some((block) => block.type === "text" && block.text?.startsWith(`${ATTACHMENT_MARKER}note.txt]`) === true),
        "the attachment block carries the file body",
      );
      assert.ok(content.some((block) => block.text?.includes("attached body") === true));

      const relativeEscape = buildPromptInput("read @../outside.txt", root);
      assert.deepEqual(relativeEscape.references, []);
      assert.equal(typeof relativeEscape.input, "string");

      if (process.platform !== "win32") {
        await symlink(join(parent, "outside.txt"), join(root, "link.txt"));
        const symlinkEscape = buildPromptInput("read @link.txt", root);
        assert.deepEqual(symlinkEscape.references, [], "a symlink pointing out of the repo is refused");
      }

      await writeFile(join(root, "big.txt"), "x".repeat(MAX_ATTACHMENT_BYTES + 4096));
      const big = buildPromptInput("read @big.txt", root);
      const bigBlocks = Array.isArray(big.input)
        ? []
        : ((big.input as { content: readonly { type: string; text?: string }[] }).content ?? []);
      const bigText = bigBlocks.find((block) => block.text?.startsWith(ATTACHMENT_MARKER))?.text ?? "";
      assert.ok(bigText.includes("truncated at"), "oversized attachments are truncated");
      assert.ok(bigText.length <= MAX_ATTACHMENT_BYTES + 256);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("skips attachment bodies when replaying a resumed prompt", () => {
    const actions = sessionEntryToUiActions({
      id: "entry_1",
      sessionId: "s",
      timestamp: new Date().toISOString(),
      kind: "message",
      message: {
        role: "user",
        content: [
          { type: "text", text: "please read the file" },
          { type: "text", text: `${ATTACHMENT_MARKER}note.txt]\nbody that should stay out of the transcript` },
        ],
      },
    });
    const prompt = actions.find((action) => action.type === "user_prompt");
    assert.deepEqual(prompt, { type: "user_prompt", text: "please read the file", id: "entry_1" });
    assert.equal(JSON.stringify(actions).includes("body that should stay out of the transcript"), false);
  });

  it("filters 50k paths inside a frame budget", () => {
    const entries = buildFileIndex(
      Array.from({ length: 50_000 }, (_, index) => `packages/pkg-${index % 50}/src/module-${index}/index-${index}.ts`),
    );
    const best = (query: string): number => {
      let bestMs = Number.POSITIVE_INFINITY;
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = performance.now();
        filterFileIndex(entries, query);
        bestMs = Math.min(bestMs, performance.now() - started);
      }
      return bestMs;
    };
    assert.equal(filterFileIndex(entries, "src/ind").length, 8);
    assert.ok(best("module-4999/index") < 16, `50k-path filter took ${best("module-4999/index").toFixed(1)}ms`);
  });

  it("persists prompt history per repository and skips empty entries", async () => {
    const home = await makeTempDir("history");
    try {
      appendPromptHistory("/repo/a", "one", { home });
      appendPromptHistory("/repo/a", "two", { home });
      appendPromptHistory("/repo/b", "other", { home });
      appendPromptHistory("/repo/a", "   ", { home });

      assert.deepEqual(loadPromptHistory("/repo/a", { home }), ["one", "two"]);
      assert.deepEqual(loadPromptHistory("/repo/a", { home, limit: 1 }), ["two"]);
      assert.deepEqual(loadPromptHistory("/repo/b", { home }), ["other"]);
      assert.equal(promptHistoryPath(home), join(home, "history.jsonl"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("inserts newlines on Shift/Alt+Enter and Ctrl+J, and submits on Enter", async () => {
    const env = await createTestRenderer({ width: 80, height: 10, kittyKeyboard: true });
    let submitted: string | undefined;
    const input = new InputEditorComponent(env.renderer, {
      onSubmit: (text) => {
        submitted = text;
      },
    });
    env.renderer.root.add(input.root);
    input.focus();
    try {
      env.mockInput.pressKey("a");
      env.mockInput.pressKey(KeyCodes.RETURN, { shift: true });
      env.mockInput.pressKey("b");
      env.mockInput.pressKey(KeyCodes.RETURN, { meta: true });
      env.mockInput.pressKey("c");
      env.mockInput.pressKey("j", { ctrl: true });
      env.mockInput.pressKey("d");
      await env.renderOnce();

      assert.equal(input.getText(), "a\nb\nc\nd", "Shift+Enter, Alt+Enter and Ctrl+J insert newlines");

      env.mockInput.pressKey(KeyCodes.RETURN);
      assert.equal(submitted, "a\nb\nc\nd", "Enter submits the whole multi-line prompt");
    } finally {
      env.renderer.destroy();
    }
  });

  it("collapses an oversized paste and expands it on submit", async () => {
    const env = await createTestRenderer({ width: 80, height: 10 });
    let submitted: string | undefined;
    const input = new InputEditorComponent(env.renderer, {
      onSubmit: (text) => {
        submitted = text;
      },
    });
    env.renderer.root.add(input.root);
    input.focus();
    try {
      const paste = Array.from({ length: 300 }, (_, index) => `line ${index}`).join("\n");
      assert.equal(input.handlePaste(new TextEncoder().encode(paste)), true);
      await env.renderOnce();
      assert.match(input.getText(), /\[pasted 300 lines\]/);

      input.submit();
      assert.equal(submitted, paste, "the token expands back to the full paste");

      assert.equal(input.handlePaste(new TextEncoder().encode("tiny")), false, "small pastes stay with the textarea");
    } finally {
      env.renderer.destroy();
    }
  });

  it("walks history from the first and last buffer line", async () => {
    const env = await createTestRenderer({ width: 80, height: 10 });
    const input = new InputEditorComponent(env.renderer, { history: ["older", "newer"] });
    env.renderer.root.add(input.root);
    input.focus();
    try {
      input.setText("draft");
      input.textarea.setCursor(0, 0);
      assert.equal(input.isCursorOnFirstLine, true);
      input.historyPrevious();
      assert.equal(input.getText(), "newer");
      input.historyPrevious();
      assert.equal(input.getText(), "older");
      input.historyNext();
      assert.equal(input.getText(), "newer");
      input.historyNext();
      assert.equal(input.getText(), "draft", "the saved draft comes back");

      input.setText("first\nsecond");
      input.textarea.setCursor(1, 6);
      assert.equal(input.isCursorOnLastLine, true);
      assert.equal(input.isCursorOnFirstLine, false);
      input.textarea.setCursor(0, 0);
      assert.equal(input.isCursorOnFirstLine, true);
      assert.equal(input.isCursorOnLastLine, false);
    } finally {
      env.renderer.destroy();
    }
  });

  it("completes /commands and @paths in the running TUI, and attaches file content", async () => {
    const dir = await makeTempDir("e2e");
    const requests: ProviderRequest[] = [];
    const { env, tui, definition } = await assembleTestTui(dir, requests);
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "index.ts"), "export const answer = 42;\n");
      await writeFile(join(dir, "note.txt"), "attached body");
      execFileSync("git", ["init", "-q"], { cwd: dir });

      const input = () => (tui as unknown as { inputComponent: InputEditorComponent }).inputComponent;

      await env.mockInput.typeText("/mo");
      await waitFor(() => (tui as unknown as { completionActive: boolean }).completionActive === true, "command popup");
      env.mockInput.pressTab();
      assert.equal(input().getText(), "/model");
      input().clear();

      await env.mockInput.typeText("@src/ind");
      await waitFor(() => (tui as unknown as { completionActive: boolean }).completionActive === true, "path popup");
      env.mockInput.pressTab();
      assert.equal(input().getText(), "@src/index.ts");

      input().clear();
      await env.mockInput.typeText("trail\\");
      env.mockInput.pressEnter();
      await env.renderOnce();
      assert.equal(input().getText(), "trail\n", "trailing backslash + Enter continues the line");
      input().clear();

      await (tui as unknown as { handlePromptSubmit: (text: string) => Promise<void> }).handlePromptSubmit("please read @note.txt");
      const serialized = JSON.stringify(requests.at(-1)?.messages ?? []);
      assert.ok(serialized.includes(`${ATTACHMENT_MARKER}note.txt]`), "the request carries an attachment block");
      assert.ok(serialized.includes("attached body"), "the attachment carries the file body");
    } finally {
      await tui.close();
      await definition.dispose();
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips history for secret prompts and records normal prompts", async () => {
    const dir = await makeTempDir("history-tui");
    const requests: ProviderRequest[] = [];
    const { env, tui, definition } = await assembleTestTui(dir, requests);
    try {
      const pending = tui.promptSecret("Passphrase: ");
      await env.renderOnce();
      for (const name of ["s", "e", "c"]) {
        env.renderer.keyInput.emit("keypress", { name, ctrl: false, shift: false, meta: false } as never);
      }
      env.renderer.keyInput.emit("keypress", { name: "return", ctrl: false, shift: false, meta: false } as never);
      assert.equal(await pending, "sec");

      await (tui as unknown as { handlePromptSubmit: (text: string) => Promise<void> }).handlePromptSubmit("remember me");
      assert.deepEqual(loadPromptHistory(dir), [], "handlePromptSubmit alone does not touch history");

      const input = (tui as unknown as { inputComponent: InputEditorComponent }).inputComponent;
      input.setText("recorded via submit");
      input.submit();
      await waitFor(() => loadPromptHistory(dir).length === 1, "history append");
      assert.deepEqual(loadPromptHistory(dir), ["recorded via submit"], "secret input never reaches history");
    } finally {
      await tui.close();
      await definition.dispose();
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Ctrl+C aborts a running turn, and a second press within 2s exits", async () => {
    const dir = await makeTempDir("ctrl-c");
    const requests: ProviderRequest[] = [];
    const { env, tui, definition } = await assembleTestTui(dir, requests);
    try {
      const internals = tui as unknown as {
        state: Record<string, unknown>;
        currentAbortController?: AbortController;
        lastCtrlCAt: number;
      };
      const controller = new AbortController();
      internals.state = { ...internals.state, isRunning: true };
      internals.currentAbortController = controller;

      emitCtrlC(env.renderer);
      assert.equal(controller.signal.aborted, true, "the running turn is aborted first");
      assert.equal(tui.isDestroyed, false, "the first Ctrl+C does not quit");

      emitCtrlC(env.renderer);
      await waitFor(() => tui.isDestroyed, "exit after the second Ctrl+C");
    } finally {
      await tui.close();
      await definition.dispose();
      env.renderer.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
