import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolDefinition, ToolExecutionContext } from "@arnilo/prism";
import { createAcpFilesystemOperations, type TextFileClient } from "../acp-operations.js";
import { createEditTool } from "../edit.js";
import { createCodingTools } from "../index.js";
import type { ReadOperations } from "../read.js";
import { createReadTool } from "../read.js";

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `acp-fs-${counter++}` };
}

function textOf(result: { content?: readonly { type: string; text?: string }[] }): string {
  const block = result.content?.[0];
  return block?.type === "text" ? (block.text ?? "") : "";
}

function makeClient(initial: Record<string, string>): {
  client: TextFileClient;
  files: Map<string, string>;
  reads: Array<{ path: string; line?: number; limit?: number }>;
  writes: Array<{ path: string; content: string }>;
} {
  const files = new Map(Object.entries(initial));
  const reads: Array<{ path: string; line?: number; limit?: number }> = [];
  const writes: Array<{ path: string; content: string }> = [];
  const client: TextFileClient = {
    async readTextFile(input) {
      reads.push({ ...input });
      const text = files.get(input.path);
      if (text === undefined) throw new Error(`client missing ${input.path}`);
      if (input.line === undefined && input.limit === undefined) return { text };
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      const start = (input.line ?? 1) - 1;
      const limit = input.limit ?? lines.length;
      return { text: lines.slice(start, start + limit).join("\n") };
    },
    async writeTextFile(input) {
      writes.push({ ...input });
      files.set(input.path, input.content);
    },
  };
  return { client, files, reads, writes };
}

function tool(tools: readonly ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found, `${name} tool is present`);
  return found;
}

test("ACP edit round-trip stays in client filesystem and leaves disk untouched", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acp-ops-"));
  try {
    const diskPath = join(cwd, "remote.ts");
    await writeFile(diskPath, "disk content");
    const fake = makeClient({ "/remote.ts": "one\ntwo\nthree\n" });
    const ops = createAcpFilesystemOperations(fake.client);
    const tools = createCodingTools(cwd, {
      read: { operations: ops.read },
      write: { operations: ops.write },
      edit: { operations: ops.edit },
    });

    const result = await tool(tools, "edit").execute({ path: "/remote.ts", edits: [{ oldText: "two", newText: "TWO" }] }, ctx());
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(fake.files.get("/remote.ts"), "one\nTWO\nthree\n");
    assert.equal(await readFile(diskPath, "utf8"), "disk content");
    assert.deepEqual(
      fake.writes.map(({ path, content }) => ({ path, content })),
      [{ path: "/remote.ts", content: "one\nTWO\nthree\n" }],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP read forwards line/limit and findText pages through client text", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acp-ops-"));
  try {
    const fake = makeClient({ "/remote.ts": "a\nb\nc\nd NEEDLE\ne\n" });
    const ops = createAcpFilesystemOperations(fake.client);
    const read = createReadTool(cwd, { operations: ops.read, maxLines: 2 });

    const page = await read.execute({ path: "/remote.ts", offset: 3, limit: 2 }, ctx());
    assert.equal(page.error, undefined, JSON.stringify(page.error));
    assert.equal(textOf(page).split("\n")[0], "c");
    assert.ok(fake.reads.some((input) => input.path === "/remote.ts" && input.line === 3 && input.limit === 2));

    const found = await read.execute({ path: "/remote.ts", findText: "NEEDLE" }, ctx());
    assert.equal(found.error, undefined, JSON.stringify(found.error));
    assert.equal(textOf(found).split("\n")[0], "d NEEDLE");
    assert.ok(fake.reads.filter((input) => input.path === "/remote.ts" && input.line !== undefined).length >= 4);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP write forwards content and mkdir is a no-op", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acp-ops-"));
  try {
    const fake = makeClient({});
    const ops = createAcpFilesystemOperations(fake.client);
    await ops.write.mkdir(join(cwd, "not-created"));
    const result = await tool(createCodingTools(cwd, { write: { operations: ops.write } }), "write").execute(
      { path: "/remote/new.ts", content: "hello" },
      ctx(),
    );
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.deepEqual(fake.writes, [{ path: "/remote/new.ts", content: "hello" }]);
    await assert.rejects(readFile(join(cwd, "not-created")), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP read has no image/binary or disk fallback", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acp-ops-"));
  try {
    const fake = makeClient({ "/image.png": "not-binary-over-acp-text" });
    const ops = createAcpFilesystemOperations(fake.client);
    assert.equal(await ops.read.detectImageMimeType?.("/image.png"), null);
    let binaryReadCalled = false;
    let statCalled = false;
    const guarded: ReadOperations = {
      ...ops.read,
      readFile: async () => {
        binaryReadCalled = true;
        throw new Error("disk fallback");
      },
      statFile: async () => {
        statCalled = true;
        throw new Error("disk fallback");
      },
    };
    const result = await createReadTool(cwd, { operations: guarded }).execute({ path: "/image.png" }, ctx());
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(binaryReadCalled, false);
    assert.equal(statCalled, false);
    assert.match(textOf(result), /not-binary-over-acp-text/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP access failure blocks edit before any client write", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acp-ops-"));
  try {
    const fake = makeClient({});
    const ops = createAcpFilesystemOperations(fake.client);
    const result = await createEditTool(cwd, { operations: ops.edit }).execute(
      { path: "/missing.ts", edits: [{ oldText: "x", newText: "y" }] },
      ctx(),
    );
    assert.ok(result.error);
    assert.match(result.error?.message ?? "", /client missing/);
    assert.equal(fake.writes.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP stat reports UTF-8 bytes and edit refuses oversize before read/write", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acp-ops-"));
  try {
    const fake = makeClient({ "/huge.ts": "é".repeat(20) });
    const ops = createAcpFilesystemOperations(fake.client);
    assert.deepEqual(await ops.edit.statFile("/huge.ts"), { size: Buffer.byteLength("é".repeat(20), "utf8") });
    const result = await createEditTool(cwd, { operations: ops.edit, maxFileBytes: 10 }).execute(
      { path: "/huge.ts", edits: [{ oldText: "é", newText: "x" }] },
      ctx(),
    );
    assert.ok(result.error);
    assert.match(result.error?.message ?? "", /exceeds 10 byte limit/);
    assert.equal(fake.writes.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP readFile returns UTF-8 bytes and honors caller cap", async () => {
  const fake = makeClient({ "/utf8.ts": "éx" });
  const ops = createAcpFilesystemOperations(fake.client);
  assert.deepEqual(await ops.read.readFile("/utf8.ts", { maxBytes: 3 }), Buffer.from("éx", "utf8"));
  await assert.rejects(ops.read.readFile("/utf8.ts", { maxBytes: 2 }), /exceeds 2 byte limit/);
});
