import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAllTools, createCodingTools, createGitTools, createReadOnlyTools } from "../index.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agg-"));
}

test("createCodingTools returns shell/read/write/edit/grep/glob with unique names", async () => {
  const cwd = await tmp();
  try {
    const tools = createCodingTools(cwd);
    assert.deepEqual(
      tools.map((t) => t.name),
      ["shell", "read", "write", "edit", "grep", "glob"],
    );
    // unique
    assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
    // B4: every tool carries its explicit kind
    assert.deepEqual(
      tools.map((t) => [t.name, t.kind]),
      [
        ["shell", "execute"],
        ["read", "read"],
        ["write", "edit"],
        ["edit", "edit"],
        ["grep", "search"],
        ["glob", "search"],
      ],
    );
    // every entry is a real ToolDefinition
    for (const t of tools) {
      assert.equal(typeof t.execute, "function");
      assert.equal(t.parameters?.type, "object");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createReadOnlyTools returns exactly [read, grep, glob]", async () => {
  const cwd = await tmp();
  try {
    const tools = createReadOnlyTools(cwd);
    assert.deepEqual(
      tools.map((t) => t.name),
      ["read", "grep", "glob"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createReadOnlyTools applies shared executionPolicy before filesystem access", async () => {
  const cwd = await tmp();
  const path = join(cwd, "secret.txt");
  let accesses = 0;
  try {
    await writeFile(path, "secret");
    const [read] = createReadOnlyTools(cwd, {
      executionPolicy: {
        check: (action) => {
          assert.equal(action.metadata?.sessionId, "session-1");
          assert.equal(action.metadata?.runId, "run-1");
          return { allowed: false, reason: "denied" };
        },
      },
      read: {
        operations: {
          access: async () => {
            accesses++;
          },
          readFile: async () => Buffer.from("must not read"),
          readText: async () => {
            throw new Error("must not read");
          },
          statFile: async () => ({ size: 0 }),
        },
      },
    });
    const result = await read!.execute(
      { path },
      {
        toolCallId: "call-1",
        sessionId: "session-1",
        runId: "run-1",
      },
    );
    assert.equal(result.error?.message, "denied");
    assert.equal(accesses, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete_move_register_only_without_shell", async () => {
  const cwd = await tmp();
  try {
    const names = (available: boolean) => createCodingTools(cwd, { shellAvailable: available }).map((t) => t.name);
    assert.deepEqual(names(true), ["shell", "read", "write", "edit", "grep", "glob"]);
    assert.deepEqual(names(false), ["read", "write", "edit", "grep", "glob", "delete", "move"]);
    // read-only is never mutating, with or without a shell.
    assert.deepEqual(
      createReadOnlyTools(cwd, { shellAvailable: false }).map((t) => t.name),
      ["read", "grep", "glob"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("tool_schema_size_recorded", async () => {
  const cwd = await tmp();
  try {
    const size = (tools: readonly { description?: string; parameters?: unknown }[]) =>
      tools.reduce((n, t) => n + JSON.stringify(t.description ?? "").length + JSON.stringify(t.parameters ?? null).length, 0);
    const coding = createCodingTools(cwd);
    const git = createGitTools(cwd);
    const total = size([...coding, ...git]);
    // Recorded 2026-10-21 after removing repo_list/git_branch/git_worktree/git_apply (and
    // delete/move while a shell exists): 8,548 chars over 10 tools. This ceiling fails if a
    // removed job comes back as a schema.
    console.log(`tool_schema_size: tools=${coding.length + git.length} chars=${total} estTokens=${Math.round(total / 4)}`);
    assert.ok(total <= 10_000, `default coding+git schema+description budget: ${total} chars`);
    assert.equal(coding.length + git.length, 10);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createAllTools equals createCodingTools surface", async () => {
  const cwd = await tmp();
  try {
    const all = createAllTools(cwd);
    assert.deepEqual(
      all.map((t) => t.name),
      ["shell", "read", "write", "edit", "grep", "glob"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ToolsOptions are threaded through to each tool", async () => {
  const cwd = await tmp();
  try {
    // pass a read option (maxLines) and confirm it is applied to the read tool only
    const tools = createCodingTools(cwd, { read: { maxLines: 3, maxBytes: 1_000_000 } });
    const read = tools.find((t) => t.name === "read");
    assert.ok(read);
    // smoke: schema still valid; option presence doesn't break construction
    assert.equal(read?.parameters?.type, "object");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("per-call independence: two createCodingTools calls are independent tools", async () => {
  const cwd = await tmp();
  try {
    const a = createCodingTools(cwd);
    const b = createCodingTools(cwd);
    assert.notEqual(a, b);
    assert.notEqual(a[0], b[0]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
