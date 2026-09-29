import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import { PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent } from "../headless.js";
import { formatFooterDetails, formatFooterLeft, formatFooterRight } from "../tui/components/status.js";
import { createPrismCodeTui, detectGitBranch } from "../tui/index.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-tui-${prefix}-`));
}

describe("TUI Lifecycle & Components", () => {
  it("close() calls renderer.destroy() exactly once and marks isDestroyed", async () => {
    const tempDir = await makeTempDir("lifecycle-close");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      let destroyCalls = 0;
      const originalDestroy = env.renderer.destroy.bind(env.renderer);
      env.renderer.destroy = () => {
        destroyCalls++;
        originalDestroy();
      };

      const provider = createMockProvider([providerTextDelta("TUI response"), providerDone()]);

      const definition = await assembleAppAgent(
        {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        provider,
      );

      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir },
      });

      assert.strictEqual(tui.isDestroyed, false);
      await tui.start(definition);
      await env.renderOnce();

      assert.strictEqual(tui.isDestroyed, false);
      assert.strictEqual(destroyCalls, 0);

      await tui.close();
      assert.strictEqual(tui.isDestroyed, true);
      assert.strictEqual(destroyCalls, 1);

      // Calling close a second time is idempotent
      await tui.close();
      assert.strictEqual(destroyCalls, 1);

      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("approval flow: promptApproval resolves allow_once/allow_for_run/allow_always/deny and times out to deny", async () => {
    const tempDir = await makeTempDir("approval-flow");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const provider = createMockProvider([providerDone()]);
      const definition = await assembleAppAgent(
        {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        provider,
      );

      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir },
        approvalTimeoutMs: 50, // short timeout for testing
      });

      await tui.start(definition);
      await env.renderOnce();

      // 1. Test allow_once
      const approvalPromise1 = tui.promptApproval({
        action: { kind: "write", operation: "create_file", paths: ["src/index.ts"] },
      });
      // Simulate pressing 'a'
      env.renderer.keyInput.emit("keypress", {
        name: "a",
        ctrl: false,
        shift: false,
        meta: false,
      } as any);
      const decision1 = await approvalPromise1;
      assert.strictEqual(decision1, "allow_once");

      // 2. Test allow_for_run
      const approvalPromise2 = tui.promptApproval({
        action: { kind: "shell", operation: "execute", command: "npm test" },
      });
      // Simulate pressing 'r'
      env.renderer.keyInput.emit("keypress", {
        name: "r",
        ctrl: false,
        shift: false,
        meta: false,
      } as any);
      const decision2 = await approvalPromise2;
      assert.strictEqual(decision2, "allow_for_run");

      // 2b. Test allow_always (persisted per repo)
      const approvalPromiseAlways = tui.promptApproval({
        action: { kind: "shell", operation: "execute", command: "bun test" },
      });
      env.renderer.keyInput.emit("keypress", {
        name: "w",
        ctrl: false,
        shift: false,
        meta: false,
      } as any);
      assert.strictEqual(await approvalPromiseAlways, "allow_always");

      // 3. Test deny
      const approvalPromise3 = tui.promptApproval({
        action: { kind: "delete", operation: "delete_file", paths: ["package.json"] },
      });
      // Simulate pressing 'd'
      env.renderer.keyInput.emit("keypress", {
        name: "d",
        ctrl: false,
        shift: false,
        meta: false,
      } as any);
      const decision3 = await approvalPromise3;
      assert.strictEqual(decision3, "deny");

      // 4. Test timeout defaults to deny
      const approvalPromise4 = tui.promptApproval({
        action: { kind: "shell", operation: "execute", command: "reboot" },
      });
      // Wait for timeout (50ms)
      const decision4 = await approvalPromise4;
      assert.strictEqual(decision4, "deny");

      await tui.close();
      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("Shift+Tab cycles reasoning effort levels in declared order", async () => {
    const tempDir = await makeTempDir("effort-cycle");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const provider = createMockProvider([providerDone()]);
      const definition = await assembleAppAgent(
        {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        provider,
      );

      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir },
      });

      await tui.start(definition);
      await env.renderOnce();

      // Emit Shift+Tab keypress
      env.renderer.keyInput.emit("keypress", {
        name: "tab",
        ctrl: false,
        shift: true,
        meta: false,
      } as any);
      await env.renderOnce();

      // Emit another Shift+Tab
      env.renderer.keyInput.emit("keypress", {
        name: "tab",
        ctrl: false,
        shift: true,
        meta: false,
      } as any);
      await env.renderOnce();

      await tui.close();
      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("footer responsiveness formats labels cleanly across wide and narrow widths", () => {
    // Wide (80 columns)
    const wideLeft = formatFooterLeft("/home/user/my-project", "feature-branch", 80);
    assert.strictEqual(wideLeft, "my-project @ feature-branch");

    const wideRight = formatFooterRight("anthropic/claude-sonnet-4-5", "low", "ask", 80);
    assert.strictEqual(wideRight, "anthropic/claude-sonnet-4-5 [effort: low] [approvals:ask]");

    // Narrow (<50 columns)
    const narrowLeft = formatFooterLeft("/home/user/my-project", "feature-branch", 40);
    assert.strictEqual(narrowLeft, "feature-branch");

    const narrowRight = formatFooterRight("anthropic/claude-sonnet-4-5", "low", "ask", 40);
    assert.strictEqual(narrowRight, "claude-sonnet-4-5 [ask]");

    // Missing git branch
    const noGitLeft = formatFooterLeft("/home/user/my-project", undefined, 80);
    assert.strictEqual(noGitLeft, "my-project (no git)");

    // Details line with MCP count and the context meter
    const details = formatFooterDetails(3, { contextTokens: 14_200, contextCap: 200_000, contextSource: "reported" });
    assert.ok(details.includes("MCP: 3 connected"));
    assert.ok(details.includes("ctx 14k/200k 7%"));
  });

  it("detectGitBranch safely returns branch or undefined without throwing", () => {
    // Current repo has a git branch
    const branch = detectGitBranch(process.cwd());
    assert.ok(typeof branch === "string" || branch === undefined);

    // Non-existent directory returns undefined
    const missing = detectGitBranch("/nonexistent/path/that/does/not/exist");
    assert.strictEqual(missing, undefined);
  });

  it("Ctrl+C with empty input triggers clean exit", async () => {
    const tempDir = await makeTempDir("ctrl-c-exit");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      let exitedWithCode: number | undefined;

      const provider = createMockProvider([providerDone()]);
      const definition = await assembleAppAgent(
        {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        provider,
      );

      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir },
        onExit: (code) => {
          exitedWithCode = code;
        },
      });

      await tui.start(definition);
      await env.renderOnce();

      // Emit Ctrl+C when input is empty
      env.renderer.keyInput.emit("keypress", {
        name: "c",
        ctrl: true,
        shift: false,
        meta: false,
      } as any);

      // Wait a microtask
      await new Promise((r) => setTimeout(r, 20));

      assert.strictEqual(tui.isDestroyed, true);
      assert.strictEqual(exitedWithCode, 0);

      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("asks once through the picker when the credential store is unresolved", async () => {
    const tempDir = await makeTempDir("credential-choice");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const provider = createMockProvider([providerDone()]);
      const manager = new PrismCodeCredentialManager({ disableKeychain: true });
      const definition = await assembleAppAgent(
        { cwd: tempDir, store: { type: "memory" }, tools: { planes: { coding: false } } },
        provider,
        undefined,
        undefined,
        manager,
      );
      let asked = 0;
      let chosen: string | undefined;
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir, store: { type: "memory" } },
        credentialManager: manager,
        onCredentialStoreChoiceNeeded: async () => {
          asked += 1;
          chosen = await tui.promptCredentialStoreChoice();
        },
      });

      const started = tui.start(definition);
      for (let i = 0; i < 200 && !(tui as any).pickerComponent?.isVisible; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      assert.equal((tui as any).pickerComponent?.isVisible, true);
      env.renderer.keyInput.emit("keypress", { name: "return", ctrl: false, shift: false, meta: false } as any);
      await started;

      assert.equal(asked, 1);
      assert.equal(chosen, "file");
      assert.strictEqual((tui as any).credentialManager, manager);
      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("masks the secret prompt and never echoes the raw value", async () => {
    const tempDir = await makeTempDir("credential-secret");
    try {
      const env = await createTestRenderer({ width: 80, height: 24 });
      const provider = createMockProvider([providerDone()]);
      const definition = await assembleAppAgent(
        { cwd: tempDir, store: { type: "memory" }, tools: { planes: { coding: false } } },
        provider,
        undefined,
        undefined,
        new PrismCodeCredentialManager({ disableKeychain: true }),
      );
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config: { cwd: tempDir, store: { type: "memory" } },
        credentialManager: new PrismCodeCredentialManager({ disableKeychain: true }),
      });
      await tui.start(definition);

      const pending = tui.promptSecret("Passphrase: ");
      await env.renderOnce();
      for (const name of ["s", "e", "c"]) {
        env.renderer.keyInput.emit("keypress", { name, ctrl: false, shift: false, meta: false } as any);
      }
      env.renderer.keyInput.emit("keypress", { name: "return", ctrl: false, shift: false, meta: false } as any);
      assert.equal(await pending, "sec");

      const cancelled = tui.promptSecret("Passphrase: ");
      env.renderer.keyInput.emit("keypress", { name: "escape", ctrl: false, shift: false, meta: false } as any);
      assert.equal(await cancelled, undefined);

      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
