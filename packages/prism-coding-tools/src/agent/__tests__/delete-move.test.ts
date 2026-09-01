import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createDeleteTool } from "../delete.js";
import { createCodingTools, createReadOnlyTools } from "../index.js";
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

test("delete recursive removes a nested tree (opt-in flag)", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "dist", "sub", "deep"), { recursive: true });
    await writeFile(join(cwd, "dist", "a.js"), "a\n");
    await writeFile(join(cwd, "dist", "sub", "b.js"), "b\n");
    await writeFile(join(cwd, "dist", "sub", "deep", "c.js"), "c\n");
    await writeFile(join(cwd, "keep.txt"), "keep\n");

    const tool = createDeleteTool(cwd);
    // Flagless still refuses (0.1.5 parity).
    const refused = await tool.execute({ path: "dist" }, ctx());
    assert.match(refused.error?.message ?? "", /not empty/);

    const result = await tool.execute({ path: "dist", recursive: true }, ctx());
    assert.equal(result.error, undefined);
    assert.equal(result.metadata?.recursive, true);
    assert.equal(result.metadata?.entriesDeleted, 5);
    await assert.rejects(access(join(cwd, "dist")), /ENOENT/);
    assert.equal(await readFile(join(cwd, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete recursive unlinks symlink children without following them (escape refused)", async () => {
  const cwd = await tmp();
  const outside = join(tmpdir(), `delmv-sym-${Date.now()}`);
  try {
    await mkdir(join(cwd, "tree"), { recursive: true });
    await writeFile(join(cwd, "tree", "inside.txt"), "in\n");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret\n");
    await symlink(join(outside, "secret.txt"), join(cwd, "tree", "link.txt"));
    await symlink(outside, join(cwd, "tree", "linkdir"));

    const result = await createDeleteTool(cwd).execute({ path: "tree", recursive: true }, ctx());
    assert.equal(result.error, undefined);
    await assert.rejects(access(join(cwd, "tree")), /ENOENT/);
    // The outside target is untouched — traversal never followed the links.
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "secret\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("delete recursive enforces the per-call fan-out cap", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "big"), { recursive: true });
    for (let i = 0; i < 10; i++) {
      await writeFile(join(cwd, "big", `f${i}.txt`), "x\n");
    }
    const tool = createDeleteTool(cwd);
    const result = await tool.execute({ path: "big", recursive: true, maxEntries: 3 }, ctx());
    assert.match(result.error?.message ?? "", /fan-out cap of 3 entries/);
    // First entries may be gone, but the cap error is loud and the dir survives.
    const remaining = await readdir(join(cwd, "big"));
    assert.ok(remaining.length > 0, "entries beyond the cap must survive");
    // Invalid maxEntries values refuse.
    const bad = await tool.execute({ path: "big", recursive: true, maxEntries: 0 }, ctx());
    assert.match(bad.error?.message ?? "", /maxEntries must be an integer/);
    const huge = await tool.execute({ path: "big", recursive: true, maxEntries: 100_001 }, ctx());
    assert.match(huge.error?.message ?? "", /maxEntries must be an integer/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete recursive on a file ignores the flag (0.1.5 file path)", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "x\n");
    const result = await createDeleteTool(cwd).execute({ path: "f.txt", recursive: true }, ctx());
    assert.equal(result.error, undefined);
    await assert.rejects(access(join(cwd, "f.txt")), /ENOENT/);
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
