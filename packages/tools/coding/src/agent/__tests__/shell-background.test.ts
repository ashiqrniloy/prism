import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import type { ExecutionPolicy } from "../execution-policy.js";
import { createShellTool, getShellConfig, type ShellToolOptions } from "../shell.js";
import { BACKGROUND_FIRST_OUTPUT_MS, createBackgroundProcesses, HARD_MAX_BACKGROUND_PROCESSES } from "../shell-background.js";
import { createShellOutputTool } from "../shell-output.js";

let counter = 0;
function ctx(sessionId = "s1"): ToolExecutionContext {
  return { sessionId, runId: "r", toolCallId: `tc-${counter++}` };
}

function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

interface Harness {
  readonly cwd: string;
  readonly shell: ReturnType<typeof createShellTool>;
  readonly output: ReturnType<typeof createShellOutputTool>;
  readonly background: ReturnType<typeof createBackgroundProcesses>;
}

async function harness(options: { maxProcesses?: number; policy?: ExecutionPolicy } = {}): Promise<Harness> {
  const cwd = await mkdtemp(join(tmpdir(), "shell-bg-"));
  const background = createBackgroundProcesses({
    shell: getShellConfig(),
    ...(options.maxProcesses !== undefined ? { maxProcesses: options.maxProcesses } : {}),
  });
  const shellOptions: ShellToolOptions = { background };
  const shell = createShellTool(cwd, shellOptions);
  return { cwd, shell, output: createShellOutputTool({ background }), background };
}

test("shell_background_returns_id_and_first_output", async () => {
  const h = await harness();
  try {
    const started = await h.shell.execute({ command: "echo first; sleep 30", background: true }, ctx());
    assert.equal(started.error, undefined, JSON.stringify(started.error));
    const text = textOf(started);
    assert.match(text, /^Started process proc_[0-9a-f]+/);
    assert.match(text, /first/, "the first output arrives with the id");
    assert.match(text, /still running/);
    const id = /^Started process (\S+)/.exec(text)?.[1] as string;
    assert.ok(text.includes(id));
    assert.equal(started.metadata?.background, true);
    assert.equal(started.metadata?.running, true);
    await h.background.killSession("s1");
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("shell_output_returns_incremental_output_and_exit_code", async () => {
  const h = await harness();
  try {
    const started = await h.shell.execute({ command: "echo one; sleep 30", background: true }, ctx());
    const id = /^Started process (\S+)/.exec(textOf(started))?.[1] as string;
    const first = await h.output.execute({ id }, ctx());
    assert.equal(first.error, undefined);
    assert.ok(!textOf(first).includes("one"), "the first output was already returned by shell");
    assert.match(textOf(first), /still running/);

    // A short-lived process: the exit code appears once it ended.
    const short = await h.shell.execute({ command: "echo done", background: true }, ctx());
    const shortId = /^Started process (\S+)/.exec(textOf(short))?.[1] as string;
    const ended = await h.output.execute({ id: shortId, waitSeconds: 10 }, ctx());
    assert.equal(ended.metadata?.running, false);
    assert.equal(ended.metadata?.exitCode, 0);
    assert.match(textOf(ended), /exited with code 0/);
    await h.background.killSession("s1");
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("shell_background_returns_as_soon_as_the_first_output_arrives", async () => {
  const h = await harness();
  try {
    const startedAt = Date.now();
    const started = await h.shell.execute({ command: "echo first; sleep 30", background: true }, ctx());
    const elapsed = Date.now() - startedAt;
    assert.equal(started.error, undefined, JSON.stringify(started.error));
    assert.match(textOf(started), /first/);
    assert.ok(elapsed < 700, `waited ${elapsed}ms; output published at once so the wait ends there`);
    await h.background.killSession("s1");
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("shell_output_drains_every_accumulated_chunk", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-bg-"));
  try {
    const background = createBackgroundProcesses({ shell: getShellConfig(), maxBytes: 512 * 1024 });
    const shell = createShellTool(cwd, { background });
    const output = createShellOutputTool({ background });
    // No output inside the first-output window, then a burst larger than one output chunk (50 KB).
    const started = await shell.execute({ command: "sleep 1.2; head -c 120000 /dev/zero | tr '\\0' a; sleep 30", background: true }, ctx());
    const id = /^Started process (\S+)/.exec(textOf(started))?.[1] as string;
    assert.equal(textOf(started).includes("aaa"), false, "nothing had arrived yet");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const read = await output.execute({ id, waitSeconds: 10 }, ctx());
    assert.equal(read.error, undefined, JSON.stringify(read.error));
    assert.ok(textOf(read).length > 60_000, `one call returned ${textOf(read).length} chars; the 120 KB burst spans several chunks`);
    await background.killSession("s1");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("shell_output_wait_returns_later_output", async () => {
  const h = await harness();
  try {
    // Longer than the 1 s first-output window, so the wait is what sees it.
    const started = await h.shell.execute({ command: "sleep 1.2; echo later; sleep 30", background: true }, ctx());
    const id = /^Started process (\S+)/.exec(textOf(started))?.[1] as string;
    assert.ok(!textOf(started).includes("later"), "the output had not arrived yet");
    const waited = await h.output.execute({ id, waitSeconds: 10 }, ctx());
    assert.match(textOf(waited), /later/);
    assert.equal(waited.metadata?.running, true);
    await h.background.killSession("s1");
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("shell_output_kill_ends_process", async () => {
  const h = await harness();
  try {
    const started = await h.shell.execute({ command: "sleep 30", background: true }, ctx());
    const id = /^Started process (\S+)/.exec(textOf(started))?.[1] as string;
    const killed = await h.output.execute({ id, kill: true }, ctx());
    assert.equal(killed.metadata?.running, false);
    assert.match(textOf(killed), /killed/);
    assert.equal(h.background.liveCount("s1"), 0);
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("shell_output_foreign_session_id_is_error", async () => {
  const h = await harness();
  try {
    const started = await h.shell.execute({ command: "sleep 30", background: true }, ctx("s1"));
    const id = /^Started process (\S+)/.exec(textOf(started))?.[1] as string;
    const foreign = await h.output.execute({ id }, ctx("s2"));
    assert.ok(foreign.error !== undefined, "another session's id must fail");
    assert.match(foreign.error?.message ?? "", /owner mismatch/);
    const unknown = await h.output.execute({ id: "proc_deadbeefdeadbeef" }, ctx("s1"));
    assert.match(unknown.error?.message ?? "", /unknown process/);
    await h.background.killSession("s1");
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("background_processes_killed_on_session_close", async () => {
  const h = await harness();
  try {
    const started = await h.shell.execute({ command: "sleep 30", background: true }, ctx("s1"));
    const id = /^Started process (\S+)/.exec(textOf(started))?.[1] as string;
    assert.equal(h.background.liveCount("s1"), 1);
    // The plugin wires session.closed to this; the runtime must leave nothing running.
    await h.background.killSession("s1");
    assert.equal(h.background.liveCount("s1"), 0);
    const after = await h.output.execute({ id }, ctx("s1"));
    assert.match(after.error?.message ?? "", /unknown process/);
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("background_command_hits_command_rules_deny", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-bg-"));
  const background = createBackgroundProcesses({ shell: getShellConfig() });
  // Same argument, same tool: the hard-deny hook sees `command` and `background` together.
  const shell = createShellTool(cwd, { background });
  try {
    const { createHardDenyHook } = await import("../../hard-deny.js");
    const hook = createHardDenyHook({
      targets: () => ({ paths: [], roots: [cwd] }),
      readOnly: false,
      commandRules: [{ pattern: "rm -rf", action: "deny", reason: "no recursive deletes" }],
    });
    const decision = await hook({ name: "shell", args: { command: "rm -rf /tmp/x", background: true } } as never);
    assert.match(JSON.stringify(decision), /no recursive deletes/);
    const allowed = await hook({ name: "shell", args: { command: "echo hi", background: true } } as never);
    assert.equal(allowed, undefined);
    // And the tool itself enforces the execution policy before starting the process.
    const executionPolicy: ExecutionPolicy = {
      authorize: async () => ({ decision: "deny", reason: "policy says no" }),
    } as unknown as ExecutionPolicy;
    const denied = createShellTool(cwd, { background, executionPolicy });
    const result = await denied.execute({ command: "echo hi", background: true }, ctx());
    assert.ok(result.error !== undefined);
    assert.equal(background.liveCount("s1"), 0, "a denied command never starts a process");
    assert.equal(shell.name, "shell");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("background_process_cap_enforced", async () => {
  const h = await harness({ maxProcesses: 1 });
  try {
    await h.shell.execute({ command: "sleep 30", background: true }, ctx());
    const second = await h.shell.execute({ command: "sleep 30", background: true }, ctx());
    assert.ok(second.error !== undefined, "the cap must reject the second live process");
    assert.match(second.error?.message ?? "", /max 1/);
    await h.background.killSession("s1");
  } finally {
    await rm(h.cwd, { recursive: true, force: true });
  }
});

test("background_schema_and_first_output_bound", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-bg-"));
  try {
    const withoutBackground = createShellTool(cwd);
    const properties = (withoutBackground.parameters as { properties: Record<string, unknown> }).properties;
    assert.equal(properties.background, undefined, "no runtime, no background argument");
    assert.ok(!withoutBackground.description?.includes("background"));

    const background = createBackgroundProcesses({ shell: getShellConfig() });
    const withBackground = createShellTool(cwd, { background });
    const withProperties = (withBackground.parameters as { properties: Record<string, unknown> }).properties;
    assert.ok(withProperties.background !== undefined);
    assert.ok(withBackground.description?.includes("background: true"));
    assert.equal(HARD_MAX_BACKGROUND_PROCESSES, 16);
    assert.equal(background.maxProcesses, 4);
    assert.equal(BACKGROUND_FIRST_OUTPUT_MS, 1000);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("background_is_lazy_no_registry_until_first_call", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-bg-"));
  try {
    const background = createBackgroundProcesses({ shell: getShellConfig() });
    // Reading before any start is an error and never builds a registry.
    await assert.rejects(() => background.read({ id: "proc_x", sessionId: "s1", waitSeconds: 0, kill: false }), /unknown process/);
    const shell = createShellTool(cwd, { background });
    const foreground = await shell.execute({ command: "echo fg" }, ctx());
    assert.equal(foreground.error, undefined);
    assert.match(textOf(foreground), /fg/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
