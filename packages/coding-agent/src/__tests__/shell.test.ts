import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createShellTool } from "../shell.js";
import type { BashOperations, BashSpawnContext } from "../shell.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return {
    sessionId: "s",
    runId: "r",
    toolCallId: `tc-${counter++}`,
    signal,
  };
}

function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

test("`echo hello` → output contains hello, exitCode 0, no error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: "echo hello" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.metadata?.exitCode, 0);
    assert.match(textOf(r), /hello/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("stdout + stderr are combined into one stream", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: "echo out; echo err 1>&2" }, ctx());
    assert.equal(r.metadata?.exitCode, 0);
    const t = textOf(r);
    assert.match(t, /out/);
    assert.match(t, /err/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("non-zero exit is surfaced, NOT an error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: "exit 7" }, ctx());
    assert.equal(r.error, undefined, "non-zero exit must not set error");
    assert.equal(r.metadata?.exitCode, 7);
    assert.match(textOf(r), /Command exited with code 7/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("long output beyond maxLines → tail returned + full output spilled to temp file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd, { maxLines: 2, maxBytes: 1_000_000 });
    const r = await tool.execute({ command: "seq 1 100" }, ctx());
    assert.equal(r.metadata?.exitCode, 0);
    const fullOutputPath = r.metadata?.fullOutputPath as string | undefined;
    assert.ok(fullOutputPath, "expected a spilled full-output temp file");
    const full = await readFile(fullOutputPath!, "utf-8");
    assert.equal(full, Array.from({ length: 100 }, (_, i) => String(i + 1)).join("\n") + "\n");
    // tail content is the last 2 lines (truncateTail drops the trailing newline)
    assert.equal(textOf(r).split("\n\n[")[0], "99\n100");
    await rm(fullOutputPath!, { force: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("timeout smaller than sleep → child killed, error reflects timeout, exitCode null", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: "sleep 5; echo done", timeout: 1 }, ctx());
    assert.ok(r.error, "timeout must set error");
    assert.match(r.error!.message, /timed out after 1 seconds/);
    assert.equal(r.metadata?.exitCode, null);
    assert.match(textOf(r), /timed out after 1 seconds/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("context.signal aborted mid-run → child terminated, error reflects abort", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  const ac = new AbortController();
  try {
    const tool = createShellTool(cwd);
    const pending = tool.execute({ command: "sleep 5; echo done" }, ctx(ac.signal));
    // Abort shortly after the run starts.
    setTimeout(() => ac.abort(), 150);
    const r = await pending;
    assert.ok(r.error, "abort must set error");
    assert.equal(r.error!.message, "Command aborted");
    assert.equal(r.metadata?.exitCode, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("empty command → error result, no spawn", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: "" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /command is required/);
    assert.equal(r.metadata?.exitCode, undefined);
    assert.match(textOf(r), /command is required/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("missing/invalid command type → error result", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: 123 }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /command is required/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("commandPrefix is prepended to every command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    // prefix exports a marker var the command reads
    const tool = createShellTool(cwd, { commandPrefix: "export MARKER=prefix-ran" });
    const r = await tool.execute({ command: "echo \"got:$MARKER\"" }, ctx());
    assert.equal(r.metadata?.exitCode, 0);
    assert.match(textOf(r), /got:prefix-ran/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("custom BashOperations override is used instead of local spawn", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  const seen: BashSpawnContext[] = [];
  const fakeOps: BashOperations = {
    exec: async (command, execCwd, { onData }) => {
      seen.push({ command, cwd: execCwd, env: {} });
      onData(Buffer.from("simulated output\n", "utf-8"));
      return { exitCode: 42 };
    },
  };
  try {
    const tool = createShellTool(cwd, { operations: fakeOps });
    const r = await tool.execute({ command: "anything" }, ctx());
    assert.equal(r.metadata?.exitCode, 42);
    assert.match(textOf(r), /simulated output/);
    assert.match(textOf(r), /Command exited with code 42/);
    assert.equal(seen[0]?.command, "anything", "ops.exec should have been invoked with the command");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("spawnHook can rewrite command/cwd/env", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd, {
      spawnHook: (c) => ({ ...c, command: "echo rewritten" }),
    });
    const r = await tool.execute({ command: "echo original" }, ctx());
    assert.equal(r.metadata?.exitCode, 0);
    assert.match(textOf(r), /rewritten/);
    assert.doesNotMatch(textOf(r), /original/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("total output overflow aborts custom and local operations and removes spill", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    let sawAbort = false;
    const operations: BashOperations = {
      exec: async (_command, _cwd, { onData, signal }) => {
        while (!signal?.aborted) onData(Buffer.alloc(1024, 0x78));
        sawAbort = true;
        return { exitCode: null };
      },
    };
    const custom = await createShellTool(cwd, {
      operations,
      maxBytes: 1024,
      maxTotalOutputBytes: 4096,
    }).execute({ command: "infinite" }, ctx());
    assert.equal(sawAbort, true);
    assert.match(custom.error?.message ?? "", /output exceeded 4\.0KB limit/);
    assert.equal(custom.metadata?.totalOutputBytes, 4096);
    assert.equal(custom.metadata?.fullOutputPath, undefined);

    const local = await createShellTool(cwd, {
      maxBytes: 1024,
      maxTotalOutputBytes: 4096,
    }).execute({ command: "yes x" }, ctx());
    assert.match(local.error?.message ?? "", /output exceeded 4\.0KB limit/);
    assert.equal(local.metadata?.totalOutputBytes, 4096);
    assert.equal(local.metadata?.fullOutputPath, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("configured default timeout kills quiet commands without a request timeout", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const result = await createShellTool(cwd, { timeout: 1 }).execute({ command: "sleep 5" }, ctx());
    assert.match(result.error?.message ?? "", /timed out after 1 seconds/);
    assert.equal(result.metadata?.exitCode, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("shell limits reject non-finite, zero, and above-hard-cap values", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    assert.throws(() => createShellTool(cwd, { timeout: Infinity }), /positive safe integer/);
    assert.throws(() => createShellTool(cwd, { maxTotalOutputBytes: 1024 * 1024 * 1024 + 1 }), /positive safe integer/);
    const tool = createShellTool(cwd);
    for (const timeout of [0, Infinity, 3_601]) {
      const result = await tool.execute({ command: "echo no", timeout }, ctx());
      assert.match(result.error?.message ?? "", /positive safe integer/);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cwd is honored for relative paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    const tool = createShellTool(cwd);
    const r = await tool.execute({ command: "pwd" }, ctx());
    assert.equal(r.metadata?.exitCode, 0);
    // resolve symlinks (/tmp may be a symlink on macOS)
    const { realpath } = await import("node:fs/promises");
    assert.equal(realpathSync(textOf(r).trim()), realpathSync(cwd));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
