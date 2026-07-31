import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createCodingTools, createReadOnlyTools } from "../index.js";
import { createDeleteTool } from "../delete.js";
import { createMoveTool } from "../move.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "delmv-"));
}

test("createCodingTools includes delete and move (9 tools)", async () => {
  const cwd = await tmp();
  try {
    assert.deepEqual(
      createCodingTools(cwd).map((t) => t.name),
      ["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createReadOnlyTools excludes delete and move", async () => {
  const cwd = await tmp();
  try {
    const names = createReadOnlyTools(cwd).map((t) => t.name);
    assert.ok(!names.includes("delete"));
    assert.ok(!names.includes("move"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete removes file", async () => {
  const cwd = await tmp();
  try {
    const path = join(cwd, "gone.txt");
    await writeFile(path, "bye\n");
    const tool = createDeleteTool(cwd);
    const result = await tool.execute({ path: "gone.txt" }, ctx());
    assert.equal(result.error, undefined);
    await assert.rejects(access(path), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete removes empty directory", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "empty"));
    const tool = createDeleteTool(cwd);
    const result = await tool.execute({ path: "empty" }, ctx());
    assert.equal(result.error, undefined);
    await assert.rejects(access(join(cwd, "empty")), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete rejects non-empty directory", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "dir"));
    await writeFile(join(cwd, "dir", "child.txt"), "x\n");
    const tool = createDeleteTool(cwd);
    const result = await tool.execute({ path: "dir" }, ctx());
    assert.match(result.error?.message ?? "", /not empty/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete missing path fails", async () => {
  const cwd = await tmp();
  try {
    const result = await createDeleteTool(cwd).execute({ path: "nope.txt" }, ctx());
    assert.match(result.error?.message ?? "", /No such file/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete rejects path escape", async () => {
  const cwd = await tmp();
  try {
    const outside = join(tmpdir(), `delmv-out-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret\n");
    try {
      const result = await createDeleteTool(cwd).execute({ path: join(outside, "secret.txt") }, ctx());
      assert.match(result.error?.message ?? "", /escapes workspace root/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete policy deny", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "x.txt"), "x\n");
    const tool = createDeleteTool(cwd, {
      executionPolicy: { check: () => ({ allowed: false, reason: "denied" }) },
    });
    const result = await tool.execute({ path: "x.txt" }, ctx());
    assert.equal(result.error?.message, "denied");
    assert.equal(await readFile(join(cwd, "x.txt"), "utf8"), "x\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("move renames file", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.txt"), "data\n");
    const tool = createMoveTool(cwd);
    const result = await tool.execute({ from: "a.txt", to: "b.txt" }, ctx());
    assert.equal(result.error, undefined);
    assert.equal(await readFile(join(cwd, "b.txt"), "utf8"), "data\n");
    await assert.rejects(access(join(cwd, "a.txt")), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("move fails when destination exists without overwrite", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "src.txt"), "s\n");
    await writeFile(join(cwd, "dst.txt"), "d\n");
    const result = await createMoveTool(cwd).execute({ from: "src.txt", to: "dst.txt" }, ctx());
    assert.match(result.error?.message ?? "", /already exists/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("move overwrite replaces destination file", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "src.txt"), "new\n");
    await writeFile(join(cwd, "dst.txt"), "old\n");
    const result = await createMoveTool(cwd).execute({ from: "src.txt", to: "dst.txt", overwrite: true }, ctx());
    assert.equal(result.error, undefined);
    assert.equal(await readFile(join(cwd, "dst.txt"), "utf8"), "new\n");
    await assert.rejects(access(join(cwd, "src.txt")), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("move missing source fails", async () => {
  const cwd = await tmp();
  try {
    const result = await createMoveTool(cwd).execute({ from: "missing.txt", to: "dst.txt" }, ctx());
    assert.match(result.error?.message ?? "", /Source does not exist/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("move rejects path escape", async () => {
  const cwd = await tmp();
  try {
    const outside = join(tmpdir(), `delmv-out-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    await writeFile(join(cwd, "src.txt"), "inside\n");
    try {
      const result = await createMoveTool(cwd).execute({ from: "src.txt", to: join(outside, "dst.txt") }, ctx());
      assert.match(result.error?.message ?? "", /escapes workspace root/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
