import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createWriteTool } from "../write.js";
import type { WriteOperations } from "../write.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}
type WriteMeta = { bytes?: number; lines?: number; path?: string };
function meta(r: ToolResult): WriteMeta | undefined {
  return r.metadata as WriteMeta | undefined;
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "write-"));
}

test("write new file with nested missing dirs → file created, confirmation names absolute path", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const r = await tool.execute({ path: "a/b/c.txt", content: "hello\nworld" }, ctx());
    assert.equal(r.error, undefined);
    const onDisk = await readFile(join(cwd, "a", "b", "c.txt"), "utf-8");
    assert.equal(onDisk, "hello\nworld");
    // confirmation names the absolute path
    assert.match(textOf(r), /Successfully wrote 11 bytes \(2 lines\) to .*\/a\/b\/c\.txt$/);
    assert.equal(meta(r)?.bytes, 11);
    assert.equal(meta(r)?.lines, 2);
    assert.equal(meta(r)?.path, join(cwd, "a", "b", "c.txt"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("byte count is UTF-8 correct (not UTF-16 code-unit count like pi)", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    // ☃ is 3 UTF-8 bytes, 1 UTF-16 code unit. pi's content.length would say 1 byte.
    const r = await tool.execute({ path: "u.txt", content: "☃" }, ctx());
    assert.equal(meta(r)?.bytes, 3, "☃ must count as 3 UTF-8 bytes");
    assert.equal(meta(r)?.lines, 1);
    const onDisk = await readFile(join(cwd, "u.txt"), "utf-8");
    assert.equal(onDisk, "☃");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("overwrite existing file → content replaced", async () => {
  const cwd = await tmp();
  try {
    const filePath = join(cwd, "exist.txt");
    await writeFile(filePath, "old content here");
    const tool = createWriteTool(cwd);
    const r = await tool.execute({ path: "exist.txt", content: "new" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(await readFile(filePath, "utf-8"), "new");
    assert.match(textOf(r), /Successfully wrote 3 bytes \(1 lines\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("empty content → creates empty file, 0 bytes / 0 lines", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const r = await tool.execute({ path: "empty.txt", content: "" }, ctx());
    assert.equal(r.error, undefined);
    const st = await stat(join(cwd, "empty.txt"));
    assert.equal(st.size, 0);
    assert.equal(meta(r)?.bytes, 0);
    assert.equal(meta(r)?.lines, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("concurrent writes to the SAME file serialize (no interleaved corruption)", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const a = tool.execute({ path: "same.txt", content: "AAAA" }, ctx());
    const b = tool.execute({ path: "same.txt", content: "BBBB" }, ctx());
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.error, undefined);
    assert.equal(rb.error, undefined);
    const final = await readFile(join(cwd, "same.txt"), "utf-8");
    // serialized → final content is exactly one of the two, never corruption
    assert.ok(final === "AAAA" || final === "BBBB", `expected AAAA or BBBB, got ${JSON.stringify(final)}`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("concurrent writes to DIFFERENT files run without blocking each other", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    await Promise.all([
      tool.execute({ path: "x.txt", content: "x" }, ctx()),
      tool.execute({ path: "y.txt", content: "y" }, ctx()),
      tool.execute({ path: "z.txt", content: "z" }, ctx()),
    ]);
    assert.equal(await readFile(join(cwd, "x.txt"), "utf-8"), "x");
    assert.equal(await readFile(join(cwd, "y.txt"), "utf-8"), "y");
    assert.equal(await readFile(join(cwd, "z.txt"), "utf-8"), "z");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("custom WriteOperations override is used instead of local fs", async () => {
  const cwd = await tmp();
  const calls: string[] = [];
  const fakeOps: WriteOperations = {
    mkdir: async (dir) => {
      calls.push(`mkdir:${dir}`);
    },
    writeFile: async (absolutePath, content) => {
      calls.push(`write:${absolutePath}:${content}`);
    },
  };
  try {
    const tool = createWriteTool(cwd, { operations: fakeOps });
    const r = await tool.execute({ path: "anywhere/f.txt", content: "payload" }, ctx());
    assert.equal(r.error, undefined);
    assert.ok(calls.some((c) => c.startsWith("mkdir:")));
    assert.ok(calls.some((c) => c.startsWith("write:") && c.endsWith(":payload")));
    // nothing actually written to local fs
    await assert.rejects(() => stat(join(cwd, "anywhere", "f.txt")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("missing path → error result, no fs mutation", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const r = await tool.execute({ path: "", content: "x" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /path is required/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("non-string content → error result", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const r = await tool.execute({ path: "f.txt", content: 123 }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /content is required and must be a string/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("aborted signal before write → error result, file not written", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const ac = new AbortController();
    ac.abort();
    const r = await tool.execute({ path: "aborted.txt", content: "x" }, ctx(ac.signal));
    assert.ok(r.error);
    assert.match(r.error!.message, /aborted/i);
    await assert.rejects(() => stat(join(cwd, "aborted.txt")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("absolute path outside cwd is writable (no sandbox)", async () => {
  const cwd = await tmp();
  const outside = await tmp();
  try {
    const tool = createWriteTool(cwd);
    const target = join(outside, "ext.txt");
    const r = await tool.execute({ path: target, content: "ext" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(await readFile(target, "utf-8"), "ext");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("tilde-prefixed path resolves to homedir", async () => {
  const cwd = await tmp();
  try {
    const tool = createWriteTool(cwd);
    // Writing to a homedir path we control: ~/.<uniq>.tmpwrite
    const uniq = `.prism-write-tool-test-${process.pid}-${Date.now()}`;
    const r = await tool.execute({ path: `~/${uniq}`, content: "tilde" }, ctx());
    assert.equal(r.error, undefined);
    const { homedir } = await import("node:os");
    assert.equal(await readFile(join(homedir(), uniq), "utf-8"), "tilde");
    await rm(join(homedir(), uniq), { force: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
