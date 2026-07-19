import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createEditTool } from "../edit.js";
import type { EditOperations } from "../edit.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}
type EditMeta = { diff?: string; patch?: string; firstChangedLine?: number };
function meta(r: ToolResult): EditMeta | undefined {
  return r.metadata as EditMeta | undefined;
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "edit-"));
}

test("single exact edit → content updated, unified patch in metadata, firstChangedLine set", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "alpha\nbeta\ngamma");
    const tool = createEditTool(cwd);
    const r = await tool.execute({ path: "f.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), "alpha\nBETA\ngamma");
    assert.match(textOf(r), /Successfully replaced 1 block\(s\) in f\.txt/);
    assert.ok(typeof meta(r)?.patch === "string" && (meta(r)?.patch?.length ?? 0) > 0);
    assert.match(meta(r)?.patch ?? "", /^--- f\.txt$/m);
    assert.match(meta(r)?.patch ?? "", /^\+\+\+ f\.txt$/m);
    assert.match(meta(r)?.patch ?? "", /^-beta$/m);
    assert.match(meta(r)?.patch ?? "", /^\+BETA$/m);
    assert.ok(typeof meta(r)?.firstChangedLine === "number", "firstChangedLine is a number");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("multiple edits in one call apply against the ORIGINAL file with stable offsets", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "one\ntwo\nthree\nfour\nfive");
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      {
        path: "f.txt",
        edits: [
          { oldText: "one", newText: "ONE" },
          { oldText: "three", newText: "THREE" },
          { oldText: "five", newText: "FIVE" },
        ],
      },
      ctx(),
    );
    assert.equal(r.error, undefined);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), "ONE\ntwo\nTHREE\nfour\nFIVE");
    assert.match(textOf(r), /Successfully replaced 3 block\(s\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("fuzzy match (trailing whitespace) succeeds and writes normalized result", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "  line with spaces  \n");
    const tool = createEditTool(cwd);
    // oldText has collapsed trailing whitespace → fuzzy match must still locate it
    const r = await tool.execute(
      { path: "f.txt", edits: [{ oldText: "line with spaces", newText: "CHANGED" }] },
      ctx(),
    );
    assert.equal(r.error, undefined, `unexpected error: ${r.error?.message}`);
    const onDisk = await readFile(join(cwd, "f.txt"), "utf-8");
    assert.match(onDisk, /CHANGED/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("no-match edit → error result, file BYTE-IDENTICAL to before", async () => {
  const cwd = await tmp();
  try {
    const before = "alpha\nbeta\ngamma\n";
    await writeFile(join(cwd, "f.txt"), before);
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      { path: "f.txt", edits: [{ oldText: "does not exist", newText: "x" }] },
      ctx(),
    );
    assert.ok(r.error, "no-match must be an error result");
    assert.match(r.error!.message, /Could not find/);
    assert.match(r.error!.message, /f\.txt/);
    // file untouched
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), before);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("no-match with multiple edits → error names the failing edit index", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "a\nb\nc");
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      {
        path: "f.txt",
        edits: [
          { oldText: "a", newText: "A" },
          { oldText: "zzz", newText: "Z" },
        ],
      },
      ctx(),
    );
    assert.ok(r.error);
    assert.match(r.error!.message, /edits\[1\]/);
    assert.match(r.error!.message, /f\.txt/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("duplicate (non-unique) oldText → error result", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "dup\ndup\ndup");
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      { path: "f.txt", edits: [{ oldText: "dup", newText: "x" }] },
      ctx(),
    );
    assert.ok(r.error);
    assert.match(r.error!.message, /3 occurrences/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("overlapping edits → error result naming both indices", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "ABCDEFGH");
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      {
        path: "f.txt",
        edits: [
          { oldText: "ABCDE", newText: "X" },
          { oldText: "CDEFG", newText: "Y" },
        ],
      },
      ctx(),
    );
    assert.ok(r.error);
    assert.match(r.error!.message, /overlap/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("missing file → error result naming the path + code", async () => {
  const cwd = await tmp();
  try {
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      { path: "nope.txt", edits: [{ oldText: "a", newText: "b" }] },
      ctx(),
    );
    assert.ok(r.error);
    assert.match(r.error!.message, /Could not edit file: nope\.txt/);
    assert.match(r.error!.message, /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("empty/missing path → error result", async () => {
  const cwd = await tmp();
  try {
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      { path: "", edits: [{ oldText: "a", newText: "b" }] },
      ctx(),
    );
    assert.ok(r.error);
    assert.match(r.error!.message, /path is required/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("empty edits array → error result", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "a\nb");
    const tool = createEditTool(cwd);
    const r = await tool.execute({ path: "f.txt", edits: [] }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /at least one/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("legacy top-level oldText/newText → accepted (model-quirk tolerance)", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "alpha\nbeta");
    const tool = createEditTool(cwd);
    // legacy shape (oldText/newText instead of edits[]) — JsonObject accepts the extra props
    const r = await tool.execute({ path: "f.txt", oldText: "beta", newText: "BETA" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), "alpha\nBETA");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edits sent as JSON string → parsed and applied (model-quirk tolerance)", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "f.txt"), "alpha\nbeta");
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      { path: "f.txt", edits: JSON.stringify([{ oldText: "beta", newText: "BETA" }]) },
      ctx(),
    );
    assert.equal(r.error, undefined, `unexpected error: ${r.error?.message}`);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), "alpha\nBETA");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("BOM + CRLF preserved across an edit", async () => {
  const cwd = await tmp();
  try {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\r\nc", "utf-8")]);
    await writeFile(join(cwd, "bom.txt"), buf);
    const tool = createEditTool(cwd);
    const r = await tool.execute(
      { path: "bom.txt", edits: [{ oldText: "b", newText: "B" }] },
      ctx(),
    );
    assert.equal(r.error, undefined);
    const after = await readFile(join(cwd, "bom.txt"));
    assert.equal(after[0], 0xef, "BOM retained");
    assert.equal(after.toString("utf-8"), "\uFEFFa\r\nB\r\nc", "CRLF line endings retained");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("custom EditOperations override is used instead of local fs", async () => {
  const cwd = await tmp();
  let writeContent: string | null = null;
  const store = new Map<string, string>([["/virt.txt", "hello world"]]);
  const fakeOps: EditOperations = {
    readFile: async (p) => Buffer.from(store.get(p) ?? "", "utf-8"),
    writeFile: async (p, content) => {
      store.set(p, content);
      writeContent = content;
    },
    access: async () => {},
    statFile: async (p) => ({ size: Buffer.byteLength(store.get(p) ?? "", "utf-8") }),
  };
  try {
    const tool = createEditTool(cwd, { operations: fakeOps });
    const r = await tool.execute(
      { path: "/virt.txt", edits: [{ oldText: "hello", newText: "goodbye" }] },
      ctx(),
    );
    assert.equal(r.error, undefined);
    assert.equal(store.get("/virt.txt"), "goodbye world");
    assert.equal(writeContent, "goodbye world");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit count/input/target bounds fail before mutation", async () => {
  const cwd = await tmp();
  let reads = 0;
  let writes = 0;
  try {
    const operations: EditOperations = {
      access: async () => {},
      statFile: async () => ({ size: 11 }),
      readFile: async () => { reads++; return Buffer.from("hello world"); },
      writeFile: async () => { writes++; },
    };
    const countTool = createEditTool(cwd, { operations, maxEdits: 1 });
    const countResult = await countTool.execute({
      path: "/remote",
      edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }],
    }, ctx());
    assert.match(countResult.error?.message ?? "", /exceeds 1 limit/);

    const inputTool = createEditTool(cwd, { operations, maxInputBytes: 3 });
    const inputResult = await inputTool.execute({
      path: "/remote",
      edits: [{ oldText: "☃", newText: "x" }],
    }, ctx());
    assert.match(inputResult.error?.message ?? "", /exceeds 3 byte limit/);

    const targetTool = createEditTool(cwd, { operations, maxFileBytes: 10 });
    const targetResult = await targetTool.execute({
      path: "/remote",
      edits: [{ oldText: "hello", newText: "bye" }],
    }, ctx());
    assert.match(targetResult.error?.message ?? "", /target is 11 bytes/);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("oversized symlink target is rejected and edit limits reject invalid values", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "target.txt"), "01234567890");
    await symlink(join(cwd, "target.txt"), join(cwd, "link.txt"));
    const result = await createEditTool(cwd, { maxFileBytes: 10 }).execute({
      path: "link.txt",
      edits: [{ oldText: "0", newText: "x" }],
    }, ctx());
    assert.match(result.error?.message ?? "", /target is 11 bytes/);
    assert.equal(await readFile(join(cwd, "target.txt"), "utf-8"), "01234567890");

    for (const options of [
      { maxFileBytes: Infinity },
      { maxInputBytes: 0 },
      { maxEdits: 1_001 },
    ]) assert.throws(() => createEditTool(cwd, options), /positive safe integer/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("aborted signal before edit → error result, file unchanged", async () => {
  const cwd = await tmp();
  try {
    const before = "a\nb\nc";
    await writeFile(join(cwd, "f.txt"), before);
    const tool = createEditTool(cwd);
    const ac = new AbortController();
    ac.abort();
    const r = await tool.execute(
      { path: "f.txt", edits: [{ oldText: "b", newText: "B" }] },
      ctx(ac.signal),
    );
    assert.ok(r.error);
    assert.match(r.error!.message, /aborted/i);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), before);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
