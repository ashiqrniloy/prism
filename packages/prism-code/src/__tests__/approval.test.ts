import { describe, it } from "bun:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AIProvider,
  createMockProvider,
  type ExecutionAction,
  providerDone,
  providerTextDelta,
  providerToolCall,
} from "@arnilo/prism";
import { applyMcpApprovalPolicy, buildConnectOptions } from "@arnilo/prism-agent-sdk";
import { createTestRenderer } from "@opentui/core/testing";
import {
  commandPrefix,
  createPrismCodeApprovalPolicy,
  loadPermissionRules,
  type PrismCodeApprovalDecision,
  type PrismCodeApprovalPrompt,
} from "../approval.js";
import { assembleAppAgent, runHeadless, type WritableSink } from "../headless.js";
import { PrismCodeConfigError, parsePrismCodeConfigLayer, validateGlobalPrismCodeConfigLayer } from "../index.js";
import { NO_INTERACTIVE_ASK_USER_MESSAGE, resolveCodingToolSet } from "../tools.js";
import { handleSlashCommand } from "../tui/commands.js";
import { PickerComponent } from "../tui/components/picker.js";
import { createPrismCodeTui } from "../tui/index.js";
import { createInitialTuiState } from "../tui/reducer.js";

function textSink(): WritableSink & { content(): string } {
  let content = "";
  return {
    write: (chunk: string) => {
      content += chunk;
      return true;
    },
    content: () => content,
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtempSync(join(tmpdir(), prefix));
}

/** Replays one event list per provider request (the mock provider replays its list on every call). */
function turnProvider(turns: readonly Parameters<typeof createMockProvider>[0][]): AIProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate(request) {
      const events = turns[Math.min(turn, turns.length - 1)] ?? [];
      turn += 1;
      for (const event of events) {
        if (request.signal?.aborted) throw request.signal.reason;
        yield event;
      }
    },
  };
}

function recordingPrompt(decision: PrismCodeApprovalDecision): {
  readonly prompt: PrismCodeApprovalPrompt;
  readonly calls: ExecutionAction[];
} {
  const calls: ExecutionAction[] = [];
  return {
    prompt: async (request) => {
      calls.push(request.action);
      return decision;
    },
    calls,
  };
}

const shellAction = (command: string): ExecutionAction => ({ kind: "shell", operation: "execute", command, paths: [process.cwd()] });
const editAction = (path: string): ExecutionAction => ({ kind: "edit", operation: "edit", paths: [path] });

describe("Prism Code approval policy", () => {
  it("ask prompts for shell and in-repo edits; accept-edits auto-allows edits but still prompts shell", async () => {
    const ask = recordingPrompt("once");
    const askPolicy = createPrismCodeApprovalPolicy({ roots: [process.cwd()], cwd: process.cwd(), mode: "ask", prompt: ask.prompt });
    assert.strictEqual((await askPolicy.policy.check(editAction(join(process.cwd(), "a.ts")))).allowed, true);
    assert.strictEqual(ask.calls.length, 1);
    assert.strictEqual((await askPolicy.policy.check(shellAction("bun test"))).allowed, true);
    assert.strictEqual(ask.calls.length, 2);

    const edits = recordingPrompt("once");
    const editsPolicy = createPrismCodeApprovalPolicy({
      roots: [process.cwd()],
      cwd: process.cwd(),
      mode: "accept-edits",
      prompt: edits.prompt,
    });
    assert.strictEqual((await editsPolicy.policy.check(editAction(join(process.cwd(), "a.ts")))).allowed, true);
    assert.strictEqual(edits.calls.length, 0, "accept-edits must not prompt for in-repo edits");
    assert.strictEqual((await editsPolicy.policy.check(shellAction("bun test"))).allowed, true);
    assert.strictEqual(edits.calls.length, 1, "accept-edits must prompt for shell");
  });

  it("auto allows mutating calls but never the execution-security hard denies", async () => {
    const { prompt, calls } = recordingPrompt("deny");
    const auto = createPrismCodeApprovalPolicy({ roots: [process.cwd()], cwd: process.cwd(), mode: "auto", prompt });
    assert.strictEqual((await auto.policy.check(shellAction("bun test && rm -rf node_modules"))).allowed, true);
    assert.strictEqual(calls.length, 0, "auto must not prompt");
    const denied = await auto.policy.check(shellAction("sudo rm -rf /"));
    assert.strictEqual(denied.allowed, false);
    assert.match(denied.reason ?? "", /deny/i);
    assert.strictEqual(calls.length, 0, "hard denies must not reach the prompt");
  });

  it("mutations outside the workspace prompt in ask and are denied in accept-edits/auto", async () => {
    const outside = join(tmpdir(), "outside-workspace-file.ts");
    const ask = recordingPrompt("once");
    const askPolicy = createPrismCodeApprovalPolicy({ roots: [process.cwd()], cwd: process.cwd(), mode: "ask", prompt: ask.prompt });
    assert.strictEqual((await askPolicy.policy.check(editAction(outside))).allowed, true);
    assert.strictEqual(ask.calls.length, 1);

    const edits = recordingPrompt("once");
    const editsPolicy = createPrismCodeApprovalPolicy({
      roots: [process.cwd()],
      cwd: process.cwd(),
      mode: "accept-edits",
      prompt: edits.prompt,
    });
    assert.strictEqual((await editsPolicy.policy.check(editAction(outside))).allowed, false);
    assert.strictEqual(edits.calls.length, 0);
  });

  it("always-allow persists per repo, applies after restart, and is revocable", async () => {
    const tempDir = await makeTempDir("prism-approval-");
    const home = join(tempDir, "home");
    const workspace = join(tempDir, "workspace");
    try {
      const first = recordingPrompt("always");
      const controller = createPrismCodeApprovalPolicy({
        roots: [workspace],
        cwd: workspace,
        home,
        mode: "ask",
        prompt: first.prompt,
      });
      assert.strictEqual((await controller.policy.check(shellAction("bun test --watch"))).allowed, true);
      assert.strictEqual(controller.listRules().length, 1);
      assert.strictEqual(controller.listRules()[0]?.commandPrefix, "bun test");

      const permissionsPath = join(home, "permissions.json");
      assert.ok(existsSync(permissionsPath));
      if (process.platform !== "win32") {
        assert.strictEqual(statSync(permissionsPath).mode & 0o777, 0o600);
      }
      assert.strictEqual(loadPermissionRules(home, workspace).length, 1);

      // Restart: a fresh controller loads the rule and never prompts for a matching prefix.
      const second = recordingPrompt("deny");
      const restarted = createPrismCodeApprovalPolicy({
        roots: [workspace],
        cwd: workspace,
        home,
        mode: "ask",
        prompt: second.prompt,
      });
      assert.strictEqual((await restarted.policy.check(shellAction("bun test -x"))).allowed, true);
      assert.strictEqual(second.calls.length, 0);
      assert.strictEqual((await restarted.policy.check(shellAction("bun run build"))).allowed, false);
      assert.strictEqual(second.calls.length, 1);

      // Revoke: the same call needs approval again.
      const removed = restarted.removeRule(0);
      assert.ok(removed);
      assert.strictEqual(restarted.listRules().length, 0);
      assert.strictEqual((await restarted.policy.check(shellAction("bun test -x"))).allowed, false);
      assert.strictEqual(second.calls.length, 2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("MCP tool without a read-only effect policy prompts in ask mode; read-only tools bypass entirely", async () => {
    const { prompt, calls } = recordingPrompt("once");
    const policy = createPrismCodeApprovalPolicy({ roots: [process.cwd()], cwd: process.cwd(), mode: "ask", prompt }).policy;
    const mutating = applyMcpApprovalPolicy(
      {
        name: "remote_write",
        execute: async () => ({ toolCallId: "t", name: "remote_write" }),
      },
      policy,
    );
    const result = await mutating.execute({}, { sessionId: "s", runId: "r", toolCallId: "t" });
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.kind, "mcp");

    const readOnly = applyMcpApprovalPolicy(
      {
        name: "remote_read",
        effect: { kind: "none", idempotency: "none" },
        execute: async () => ({ toolCallId: "t", name: "remote_read" }),
      },
      policy,
    );
    await readOnly.execute({}, { sessionId: "s", runId: "r", toolCallId: "t" });
    assert.strictEqual(calls.length, 1, "read-only MCP tools must not consult the policy");

    const connectOptions = buildConnectOptions({ serverId: "ro", command: "echo", allow: "stdio", readOnly: true });
    assert.deepEqual(connectOptions.effect?.({ serverId: "ro", remoteName: "list" }), { kind: "none", idempotency: "none" });
  });

  it("a project prism-code.json cannot set approval.mode auto; the global config can", () => {
    assert.throws(
      () => parsePrismCodeConfigLayer(JSON.stringify({ approval: { mode: "auto" } }), process.cwd(), "prism-code.json"),
      PrismCodeConfigError,
    );
    assert.throws(
      () => parsePrismCodeConfigLayer(JSON.stringify({ approval: { mode: "yolo" } }), process.cwd(), "prism-code.json"),
      PrismCodeConfigError,
    );
    const global = validateGlobalPrismCodeConfigLayer({ approval: { mode: "auto" } }, process.cwd(), "config.json");
    assert.strictEqual(global.approval?.mode, "auto");
    const project = parsePrismCodeConfigLayer(JSON.stringify({ approval: { mode: "accept-edits" } }), process.cwd(), "prism-code.json");
    assert.strictEqual(project.approval?.mode, "accept-edits");
  });

  it("ask_user_decision resolves through the host handler; the headless default returns guidance", async () => {
    const args = {
      question: "Which database?",
      options: [
        { id: "sqlite", label: "SQLite", pros: ["a", "b", "c"], cons: ["a", "b", "c"] },
        { id: "postgres", label: "Postgres", pros: ["a", "b", "c"], cons: ["a", "b", "c"] },
      ],
    };
    const tuiTools = resolveCodingToolSet({ cwd: process.cwd(), askUserHandler: async () => ({ selectedId: "postgres" }) });
    const askTool = tuiTools.find((tool) => tool.name === "ask_user_decision");
    assert.ok(askTool);
    const selected = await askTool.execute(args, { sessionId: "s", runId: "r", toolCallId: "t" });
    assert.match(JSON.stringify(selected.metadata), /postgres/);

    const headlessTools = resolveCodingToolSet({ cwd: process.cwd() });
    const guidanceTool = headlessTools.find((tool) => tool.name === "ask_user_decision");
    assert.ok(guidanceTool);
    const guidance = await guidanceTool.execute(args, {
      sessionId: "s",
      runId: "r",
      toolCallId: "t",
    });
    assert.match(guidance.error?.message ?? "", new RegExp(NO_INTERACTIVE_ASK_USER_MESSAGE));
  });

  it("TUI picker answers ask_user_decision and Escape declines", async () => {
    const tempDir = await makeTempDir("prism-ask-user-");
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const provider = createMockProvider([providerDone()]);
      const definition = await assembleAppAgent(
        { cwd: tempDir, store: { type: "sqlite", path: join(tempDir, "test.db") }, tools: { planes: { coding: false } } },
        provider,
      );
      const tui = createPrismCodeTui({ renderer: env.renderer, config: { cwd: tempDir } });
      await tui.start(definition);
      await env.renderOnce();

      const request = {
        question: "Which database?",
        options: [
          { id: "sqlite", label: "SQLite", pros: ["a", "b", "c"] as const, cons: ["a", "b", "c"] as const },
          { id: "postgres", label: "Postgres", pros: ["a", "b", "c"] as const, cons: ["a", "b", "c"] as const },
        ],
        selectionMode: "single" as const,
        allowCustom: false,
        toolCallId: "t",
        sessionId: "s",
        runId: "r",
      };
      const pending = tui.promptAskUserDecision(request);
      env.renderer.keyInput.emit("keypress", { name: "down", ctrl: false, shift: false, meta: false } as never);
      env.renderer.keyInput.emit("keypress", { name: "return", ctrl: false, shift: false, meta: false } as never);
      assert.deepEqual(await pending, { selectedId: "postgres" });

      const declined = tui.promptAskUserDecision(request);
      env.renderer.keyInput.emit("keypress", { name: "escape", ctrl: false, shift: false, meta: false } as never);
      await assert.rejects(declined, /declined/);

      await tui.close();
      await definition.dispose();
    } finally {
      env.renderer.destroy();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("headless --approve deny refuses shell, reports it to the model, and exits nonzero", async () => {
    const tempDir = await makeTempDir("prism-headless-approval-");
    try {
      const provider = turnProvider([
        [providerToolCall({ type: "tool_call", id: "call_1", name: "shell", arguments: { command: "echo hello" } }), providerDone()],
        [providerTextDelta("I could not run the command."), providerDone()],
      ]);
      const stdout = textSink();
      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          model: { provider: "mock", model: "default" },
          store: { type: "sqlite", path: join(tempDir, "sessions.db") },
        },
        prompt: "Run a shell command",
        provider,
        approve: "deny",
        home: join(tempDir, "home"),
        stdout,
      });
      assert.strictEqual(exitCode, 1);

      const approveAll = await runHeadless({
        config: {
          cwd: tempDir,
          model: { provider: "mock", model: "default" },
          store: { type: "sqlite", path: join(tempDir, "sessions.db") },
        },
        prompt: "Run a shell command",
        provider: turnProvider([
          [providerToolCall({ type: "tool_call", id: "call_2", name: "shell", arguments: { command: "echo hello" } }), providerDone()],
          [providerTextDelta("Ran the command."), providerDone()],
        ]),
        approve: "all",
        home: join(tempDir, "home"),
        stdout: textSink(),
      });
      assert.strictEqual(approveAll, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("/approval switches the mode and footer; /permissions lists and revokes rules", async () => {
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const controller = createPrismCodeApprovalPolicy({ roots: [process.cwd()], cwd: process.cwd(), mode: "ask" });
      controller.addRule("shell", "bun test");
      const streamEntries: Array<{ type?: string; message?: string; text?: string }> = [];
      const footerPatches: Array<Record<string, unknown>> = [];
      const context = {
        state: createInitialTuiState({ repo: process.cwd() }),
        picker: new PickerComponent(env.renderer),
        stream: { appendOrUpdate: (entry: any) => streamEntries.push(entry) },
        status: { update: (patch: any) => footerPatches.push(patch) },
        credentialManager: undefined as never,
        currentModel: { provider: "mock", model: "default" },
        config: { cwd: process.cwd() },
        store: undefined as never,
        approval: controller,
        onUpdateState: (patch: any) => {
          context.state = { ...context.state, ...patch };
        },
        onUpdateModel: () => {},
      } as any;

      await handleSlashCommand("/permissions", context);
      assert.ok(streamEntries.some((entry) => entry.text?.includes("bun test")));

      await handleSlashCommand("/approval auto", context);
      assert.strictEqual(controller.getMode(), "auto");
      assert.strictEqual(context.state.footer.approval, "auto");
      assert.deepEqual(footerPatches.at(-1), { approval: "auto" });

      await handleSlashCommand("/permissions revoke 1", context);
      assert.strictEqual(controller.listRules().length, 0);

      await handleSlashCommand("/approval yolo", context);
      assert.strictEqual(controller.getMode(), "auto", "invalid mode must not change the mode");
      assert.ok(streamEntries.some((entry) => entry.type === "error" && entry.message?.includes("Unknown approval mode")));
    } finally {
      env.renderer.destroy();
    }
  });
});

describe("approval helpers", () => {
  it("commandPrefix keeps the first two tokens and stores only this repo's rules", () => {
    assert.strictEqual(commandPrefix("  bun   test --watch "), "bun test");
    assert.strictEqual(commandPrefix("npm"), "npm");
    const home = mkdtempSync(join(tmpdir(), "prism-permissions-"));
    writeFileSync(join(home, "permissions.json"), JSON.stringify({ rules: [{ repo: "/other", tool: "shell", commandPrefix: "rm" }] }));
    assert.strictEqual(loadPermissionRules(home, home).length, 0);
    assert.strictEqual(readFileSync(join(home, "permissions.json"), "utf8").includes("/other"), true);
  });
});
