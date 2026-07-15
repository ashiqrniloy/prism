import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createShellTool, createReadTool, createWriteTool } from "../index.js";
import type { ExecutionPolicy } from "@arnilo/prism";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return {
    sessionId: "s",
    runId: "r",
    toolCallId: `tc-${counter++}`,
    signal,
  };
}

test("execution policy denial blocks shell before spawn", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "exec-policy-shell-"));
  try {
    const policy: ExecutionPolicy = {
      check: () => ({ allowed: false, reason: "shell blocked" }),
    };
    const tool = createShellTool(cwd, { executionPolicy: policy });
    assert.equal(tool.exclusive, true);
    const r = await tool.execute({ command: "echo hi" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /shell blocked/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("execution policy modification is applied to shell command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "exec-policy-mod-"));
  try {
    const policy: ExecutionPolicy = {
      check: (action) => ({
        allowed: true,
        modified: { command: action.command?.replace("secret", "safe") },
      }),
    };
    const tool = createShellTool(cwd, { executionPolicy: policy });
    const r = await tool.execute({ command: "echo secret" }, ctx());
    assert.equal(r.error, undefined);
    assert.match(String(r.content?.[0] && r.content[0].type === "text" ? r.content[0].text : ""), /safe/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("execution policy denial blocks write before filesystem mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "exec-policy-write-"));
  try {
    const policy: ExecutionPolicy = {
      check: () => ({ allowed: false, reason: "write blocked" }),
    };
    const tool = createWriteTool(cwd, { executionPolicy: policy });
    const target = join(cwd, "out.txt");
    const r = await tool.execute({ path: target, content: "x" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /write blocked/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("execution policy denial blocks read before access", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "exec-policy-read-"));
  const file = join(cwd, "a.txt");
  try {
    await writeFile(file, "hello");
    const policy: ExecutionPolicy = {
      check: () => ({ allowed: false, reason: "read blocked" }),
    };
    const tool = createReadTool(cwd, { executionPolicy: policy });
    const r = await tool.execute({ path: file }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /read blocked/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
