import { test } from "bun:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import type { EditOperations } from "../edit.js";
import { createEditTool } from "../edit.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}
type EditMeta = { path?: string; diff?: string; patch?: string; firstChangedLine?: number };
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
    assert.match(textOf(r), /^Edited f\.txt: 1 block\(s\)\./);
    assert.ok(typeof meta(r)?.patch === "string" && (meta(r)?.patch?.length ?? 0) > 0);
    assert.match(meta(r)?.patch ?? "", /^--- f\.txt$/m);
    assert.match(meta(r)?.patch ?? "", /^\+\+\+ f\.txt$/m);
    assert.match(meta(r)?.patch ?? "", /^-beta$/m);
    assert.match(meta(r)?.patch ?? "", /^\+BETA$/m);
    assert.ok(typeof meta(r)?.firstChangedLine === "number", "firstChangedLine is a number");
    assert.equal(meta(r)?.path, join(cwd, "f.txt"));
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
    assert.match(textOf(r), /Edited f\.txt: 3 block\(s\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit_exact_only_trailing_whitespace_variant_fails", async () => {
  const cwd = await tmp();
  try {
    const before = "line\u00A0with spaces\n";
    await writeFile(join(cwd, "f.txt"), before);
    const r = await createEditTool(cwd).execute({ path: "f.txt", edits: [{ oldText: "line with spaces", newText: "CHANGED" }] }, ctx());
    assert.ok(r.error, "an oldText with an ASCII space is not the file's NBSP, so it must not edit");
    assert.match(r.error!.message, /Could not find the exact text/);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), before, "file must be byte-identical");
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
    const r = await tool.execute({ path: "f.txt", edits: [{ oldText: "does not exist", newText: "x" }] }, ctx());
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
    const r = await tool.execute({ path: "f.txt", edits: [{ oldText: "dup", newText: "x" }] }, ctx());
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
    const r = await tool.execute({ path: "nope.txt", edits: [{ oldText: "a", newText: "b" }] }, ctx());
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
    const r = await tool.execute({ path: "", edits: [{ oldText: "a", newText: "b" }] }, ctx());
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
    const r = await tool.execute({ path: "f.txt", edits: JSON.stringify([{ oldText: "beta", newText: "BETA" }]) }, ctx());
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
    const r = await tool.execute({ path: "bom.txt", edits: [{ oldText: "b", newText: "B" }] }, ctx());
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
    const r = await tool.execute({ path: "/virt.txt", edits: [{ oldText: "hello", newText: "goodbye" }] }, ctx());
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
      readFile: async () => {
        reads++;
        return Buffer.from("hello world");
      },
      writeFile: async () => {
        writes++;
      },
    };
    const countTool = createEditTool(cwd, { operations, maxEdits: 1 });
    const countResult = await countTool.execute(
      {
        path: "/remote",
        edits: [
          { oldText: "a", newText: "b" },
          { oldText: "c", newText: "d" },
        ],
      },
      ctx(),
    );
    assert.match(countResult.error?.message ?? "", /exceeds 1 limit/);

    const inputTool = createEditTool(cwd, { operations, maxInputBytes: 3 });
    const inputResult = await inputTool.execute(
      {
        path: "/remote",
        edits: [{ oldText: "☃", newText: "x" }],
      },
      ctx(),
    );
    assert.match(inputResult.error?.message ?? "", /exceeds 3 byte limit/);

    const targetTool = createEditTool(cwd, { operations, maxFileBytes: 10 });
    const targetResult = await targetTool.execute(
      {
        path: "/remote",
        edits: [{ oldText: "hello", newText: "bye" }],
      },
      ctx(),
    );
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
    const result = await createEditTool(cwd, { maxFileBytes: 10 }).execute(
      {
        path: "link.txt",
        edits: [{ oldText: "0", newText: "x" }],
      },
      ctx(),
    );
    assert.match(result.error?.message ?? "", /target is 11 bytes/);
    assert.equal(await readFile(join(cwd, "target.txt"), "utf-8"), "01234567890");

    for (const options of [{ maxFileBytes: Infinity }, { maxInputBytes: 0 }, { maxEdits: 1_001 }])
      assert.throws(() => createEditTool(cwd, options), /positive safe integer/);
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
    const r = await tool.execute({ path: "f.txt", edits: [{ oldText: "b", newText: "B" }] }, ctx(ac.signal));
    assert.ok(r.error);
    assert.match(r.error!.message, /aborted/i);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), before);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// --- edit miss context + loud fuzzy (plan 030 Task 4) ---

test("edit no-match includes Nearby snippets and leaves the file unchanged", async () => {
  const cwd = await tmp();
  try {
    // oldText diverges from the file after the first 16 chars, so the clipped needle is a shared prefix
    const before = "function createEditTool(opts) {\nother\nfunction createEditTool(config) {\nrest\n";
    await writeFile(join(cwd, "a.ts"), before);
    const tool = createEditTool(cwd);
    const r = await tool.execute({ path: "a.ts", edits: [{ oldText: "function createEditTool(ARGS) {", newText: "z" }] }, ctx());
    assert.ok(r.error, "no-match must be an error result");
    assert.match(r.error!.message, /Could not find the exact text in .*a\.ts/);
    assert.match(r.error!.message, /Nearby:/);
    assert.match(r.error!.message, /L1: function createEditTool\(opts\) \{/);
    assert.match(r.error!.message, /L3: function createEditTool\(config\) \{/);
    assert.equal(await readFile(join(cwd, "a.ts"), "utf-8"), before, "file must be byte-identical");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit rejects a read-prefixed oldText with a precise hint and never strips it", async () => {
  const cwd = await tmp();
  try {
    const before = "alpha\nbeta\n";
    await writeFile(join(cwd, "f.txt"), before);
    const r = await createEditTool(cwd).execute({ path: "f.txt", edits: [{ oldText: "1\talpha\n2\tbeta", newText: "z" }] }, ctx());
    assert.ok(r.error, "read-prefixed oldText must not match");
    assert.match(r.error!.message, /oldText includes read line-number prefixes \("12\\t"\); remove them/);
    assert.equal(await readFile(join(cwd, "f.txt"), "utf-8"), before, "file must be byte-identical");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit does not strip digit-tab lines that really are file text", async () => {
  const cwd = await tmp();
  try {
    // Line 1 literally starts with "7\t": the hint must stay quiet and the edit must apply as asked.
    await writeFile(join(cwd, "tabs.txt"), "7\treal\nkeep\n");
    const r = await createEditTool(cwd).execute({ path: "tabs.txt", edits: [{ oldText: "7\treal", newText: "7\tchanged" }] }, ctx());
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.equal(await readFile(join(cwd, "tabs.txt"), "utf-8"), "7\tchanged\nkeep\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit no-match with no similar line keeps the plain sentence (no Nearby)", async () => {
  const cwd = await tmp();
  try {
    const before = "alpha\nbeta\n";
    await writeFile(join(cwd, "f.txt"), before);
    const tool = createEditTool(cwd);
    const r = await tool.execute({ path: "f.txt", edits: [{ oldText: "zzz unrelated", newText: "y" }] }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /Could not find/);
    assert.doesNotMatch(r.error!.message, /Nearby:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit_exact_match_reports_changed_lines_with_numbers", async () => {
  const cwd = await tmp();
  try {
    const lines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(cwd, "a.ts"), `${lines.join("\n")}\n`);
    const r = await createEditTool(cwd).execute({ path: "a.ts", edits: [{ oldText: "line 4", newText: "LINE 4" }] }, ctx());
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.equal(textOf(r), ["Edited a.ts: 1 block(s).", "2\tline 2", "3\tline 3", "4\tLINE 4", "5\tline 5", "6\tline 6"].join("\n"));
    assert.doesNotMatch(textOf(r), /fuzzy/i);
    assert.equal((meta(r) as { fuzzy?: boolean } | undefined)?.fuzzy, undefined, "no fuzzy flag");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit_unicode_quote_variant_fails_instead_of_fuzzy_editing", async () => {
  const cwd = await tmp();
  try {
    const before = "const s = \u201Cvalue\u201D;\n";
    await writeFile(join(cwd, "f.ts"), before);
    const r = await createEditTool(cwd).execute({ path: "f.ts", edits: [{ oldText: 'const s = "value";', newText: "x" }] }, ctx());
    assert.ok(r.error, "an ASCII quote is not the file's smart quote, so the edit must fail");
    assert.match(r.error!.message, /Could not find the exact text/);
    assert.equal(await readFile(join(cwd, "f.ts"), "utf-8"), before, "file must be byte-identical");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit_report_is_capped", async () => {
  const cwd = await tmp();
  try {
    const before = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(cwd, "big.txt"), before);
    const r = await createEditTool(cwd).execute(
      { path: "big.txt", edits: [{ oldText: before, newText: before.replace(/line (\d+)/g, "LINE $1") }] },
      ctx(),
    );
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    const text = textOf(r);
    const reportLines = text.split("\n");
    assert.equal(reportLines[0], "Edited big.txt: 1 block(s).");
    // 40 numbered lines plus the note line.
    assert.equal(reportLines.length, 42);
    assert.equal(reportLines[1], "1\tLINE 1");
    assert.match(reportLines[reportLines.length - 1], /^\(… 160 more changed lines\)$/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit_crlf_and_bom_preserved", async () => {
  const cwd = await tmp();
  try {
    const before = "\uFEFFalpha\r\nbeta\r\ngamma\r\n";
    await writeFile(join(cwd, "crlf.txt"), before);
    const r = await createEditTool(cwd).execute({ path: "crlf.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, ctx());
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.equal(await readFile(join(cwd, "crlf.txt"), "utf-8"), "\uFEFFalpha\r\nBETA\r\ngamma\r\n");
    assert.equal(textOf(r), ["Edited crlf.txt: 1 block(s).", "1\talpha", "2\tBETA", "3\tgamma"].join("\n"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
