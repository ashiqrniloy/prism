import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import {
  createReadTool,
  detectSupportedImageMimeType,
  detectSupportedImageMimeTypeFromFile,
} from "../read.js";
import type { ReadOperations } from "../read.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}
// metadata is loosely typed (Record<string, unknown>); narrow the nested fields we assert on.
type TruncationMeta = {
  truncated?: boolean;
  truncatedBy?: string | null;
  firstLineExceedsLimit?: boolean;
};
function trunc(r: ToolResult): TruncationMeta | undefined {
  return r.metadata?.truncation as TruncationMeta | undefined;
}
type ImageMeta = { mimeType?: string; resized?: boolean };
function image(r: ToolResult): ImageMeta | undefined {
  return r.metadata?.image as ImageMeta | undefined;
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "read-"));
}

test("text file read → content as TextContent, no truncation, no error", async () => {
  const cwd = await tmp();
  try {
    // No trailing newline → split yields exactly the visible lines, output returned verbatim.
    await writeFile(join(cwd, "note.txt"), "hello\nworld");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "note.txt" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.content?.[0]?.type, "text");
    assert.equal(textOf(r), "hello\nworld");
    assert.equal(trunc(r)?.truncated, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("trailing newline is preserved verbatim in untruncated output (faithful to pi)", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "nl.txt"), "hello\nworld\n");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "nl.txt" }, ctx());
    // truncateHead returns content as-is when not truncated; the trailing \n is kept.
    assert.equal(textOf(r), "hello\nworld\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("offset (1-indexed) slices from the given line", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "lines.txt"), "l1\nl2\nl3\nl4\nl5");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "lines.txt", offset: 3 }, ctx());
    assert.equal(textOf(r), "l3\nl4\nl5");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("offset + limit slices an exact window", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "lines.txt"), "l1\nl2\nl3\nl4\nl5");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "lines.txt", offset: 2, limit: 2 }, ctx());
    assert.equal(textOf(r), "l2\nl3\n\n[2 more lines in file. Use offset=4 to continue.]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("limit with more content remaining → continuation footer names next offset", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "lines.txt"), "l1\nl2\nl3\nl4\nl5");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "lines.txt", limit: 2 }, ctx());
    assert.equal(textOf(r), "l1\nl2\n\n[3 more lines in file. Use offset=3 to continue.]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("large file beyond maxLines → head truncated with continuation footer", async () => {
  const cwd = await tmp();
  try {
    const content = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");
    await writeFile(join(cwd, "big.txt"), content);
    const tool = createReadTool(cwd, { maxLines: 5, maxBytes: 1_000_000 });
    const r = await tool.execute({ path: "big.txt" }, ctx());
    const t = textOf(r);
    assert.equal(trunc(r)?.truncated, true);
    assert.equal(trunc(r)?.truncatedBy, "lines");
    assert.equal(
      t,
      "line1\nline2\nline3\nline4\nline5\n\n[Showing lines 1-5 of 100. Use offset=6 to continue.]",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("offset beyond end of file → error result naming total lines", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "small.txt"), "a\nb");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "small.txt", offset: 99 }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /Offset 99 is beyond end of file \(2 lines total\)/);
    assert.match(textOf(r), /Offset 99 is beyond end of file/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("missing path → error result, no throw", async () => {
  const cwd = await tmp();
  try {
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "nope.txt" }, ctx());
    assert.ok(r.error);
    assert.equal(r.metadata, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("empty/missing path arg → error result naming the requirement", async () => {
  const cwd = await tmp();
  try {
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /path is required/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("first line exceeds byte limit → shell-fallback notice, no dump", async () => {
  const cwd = await tmp();
  try {
    // one giant single line far over the 50KB default (no trailing newline)
    const huge = "x".repeat(100_000);
    await writeFile(join(cwd, "oneline.txt"), huge);
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "oneline.txt" }, ctx());
    const t = textOf(r);
    assert.equal(trunc(r)?.firstLineExceedsLimit, true);
    assert.match(t, /^\[Line 1 is .*, exceeds 50\.0KB limit\. Use the shell tool: sed/);
    assert.ok(t.length < 1000, "must not dump the giant line");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("absolute path outside cwd is still readable (no sandbox)", async () => {
  const cwd = await tmp();
  const outside = await tmp();
  try {
    await writeFile(join(outside, "ext.txt"), "external");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: join(outside, "ext.txt") }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(textOf(r), "external");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("tilde-prefixed path expands to homedir", async () => {
  const cwd = await tmp();
  try {
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "~/.this-read-tool-should-not-exist-xyz" }, ctx());
    assert.ok(r.error, "homedir expansion should resolve then fail access (ENOENT), not treat ~ as a cwd-relative path");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// --- image reads ---

/** Minimal 1×1 PNG (8-bit RGBA) for image-content tests. */
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("PNG file → ImageContent with mimeType image/png and base64 data", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "px.png"), ONE_PX_PNG);
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "px.png" }, ctx());
    assert.equal(r.error, undefined);
    const blocks = r.content ?? [];
    assert.equal(blocks[0]?.type, "text");
    assert.match((blocks[0] as { text: string }).text, /Read image file \[image\/png\]/);
    const img = blocks[1];
    assert.equal(img?.type, "image");
    assert.equal((img as { mimeType?: string }).mimeType, "image/png");
    const data = (img as { data?: string }).data;
    assert.equal(data, ONE_PX_PNG.toString("base64"));
    assert.equal(image(r)?.mimeType, "image/png");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("JPEG magic bytes → image/jpeg", async () => {
  // minimal JPEG: SOI + a non-0xf7 byte + EOI
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "x.jpg"), jpeg);
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "x.jpg" }, ctx());
    assert.equal(r.error, undefined);
    const img = r.content?.[1];
    assert.equal(img?.type, "image");
    assert.equal((img as { mimeType?: string }).mimeType, "image/jpeg");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("non-image binary → text path (decoded, not dumped as image)", async () => {
  const cwd = await tmp();
  try {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await writeFile(join(cwd, "blob.bin"), bin);
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "blob.bin" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.content?.[0]?.type, "text", "non-image must go through the text path, not ImageContent");
    assert.equal(r.content?.[1], undefined, "no image block for non-image binary");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("custom ReadOperations override is used instead of local fs", async () => {
  const cwd = await tmp();
  let readFileCalled = false;
  const fakeOps: ReadOperations = {
    readFile: async () => {
      readFileCalled = true;
      return Buffer.from("injected", "utf-8");
    },
    access: async () => {},
    detectImageMimeType: async () => null,
  };
  try {
    const tool = createReadTool(cwd, { operations: fakeOps });
    const r = await tool.execute({ path: "whatever" }, ctx());
    assert.equal(readFileCalled, true);
    assert.equal(textOf(r), "injected");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// --- MIME detection unit checks ---

test("detectSupportedImageMimeType classifies signatures", () => {
  assert.equal(detectSupportedImageMimeType(ONE_PX_PNG), "image/png");
  assert.equal(
    detectSupportedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    "image/jpeg",
  );
  // SOI + 0xf7 → not a plain JPEG image
  assert.equal(
    detectSupportedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xf7])),
    null,
  );
  assert.equal(detectSupportedImageMimeType(Buffer.from("GIF89a", "ascii")), "image/gif");
  const webp = Buffer.alloc(12);
  Buffer.from("RIFF").copy(webp, 0);
  webp.writeUInt32LE(0, 4);
  Buffer.from("WEBP").copy(webp, 8);
  assert.equal(detectSupportedImageMimeType(webp), "image/webp");
  assert.equal(detectSupportedImageMimeType(Buffer.from("hello world", "utf-8")), null);
  assert.equal(detectSupportedImageMimeType(Buffer.alloc(0)), null);
});

test("detectSupportedImageMimeTypeFromFile reads leading bytes from disk", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "disk.png"), ONE_PX_PNG);
    const mime = await detectSupportedImageMimeTypeFromFile(join(cwd, "disk.png"));
    assert.equal(mime, "image/png");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("nested directory: reading via a subdir path resolves", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "a", "b"), { recursive: true });
    await writeFile(join(cwd, "a", "b", "deep.txt"), "deep");
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "a/b/deep.txt" }, ctx());
    assert.equal(textOf(r), "deep");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("aborted signal before read → error result", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.txt"), "a");
    const tool = createReadTool(cwd);
    const ac = new AbortController();
    ac.abort();
    const r = await tool.execute({ path: "a.txt" }, ctx(ac.signal));
    assert.ok(r.error);
    assert.match(r.error!.message, /aborted/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
