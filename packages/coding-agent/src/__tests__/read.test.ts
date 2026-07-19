import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile, mkdir, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import {
  createReadTool,
  detectSupportedImageMimeType,
  detectSupportedImageMimeTypeFromFile,
  DEFAULT_MAX_IMAGE_BYTES,
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
type ImageMeta = { mimeType?: string; resized?: boolean; bytes?: number };
function image(r: ToolResult): ImageMeta | undefined {
  return r.metadata?.image as ImageMeta | undefined;
}
function imageData(r: ToolResult): string | undefined {
  const block = r.content?.find((b) => b.type === "image");
  return block && block.type === "image" ? block.data : undefined;
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
    assert.match(t, /^\[Line 1 exceeds 50\.0KB limit\. Use the shell tool: sed/);
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
    readText: async (_path, options) => {
      readFileCalled = true;
      return {
        content: "injected",
        startLine: options.offset,
        outputLines: 1,
        hasMore: false,
        truncatedBy: null,
        firstLineExceedsLimit: false,
        scannedBytes: 8,
        totalLines: 1,
        totalBytes: 8,
      };
    },
    access: async () => {},
    statFile: async () => ({ size: 8 }),
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

test("image within maxImageBytes → ImageContent with byte metadata", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "px.png"), ONE_PX_PNG);
    const tool = createReadTool(cwd, { maxImageBytes: ONE_PX_PNG.length });
    const r = await tool.execute({ path: "px.png" }, ctx());
    assert.equal(r.error, undefined);
    assert.ok(imageData(r));
    assert.equal(image(r)?.bytes, ONE_PX_PNG.length);
    assert.equal(image(r)?.resized, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("image over maxImageBytes → error result without image content", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "big.png"), ONE_PX_PNG);
    const tool = createReadTool(cwd, { maxImageBytes: ONE_PX_PNG.length - 1 });
    const r = await tool.execute({ path: "big.png" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /exceeds/i);
    assert.equal(imageData(r), undefined);
    assert.equal(r.content?.find((b) => b.type === "image"), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("stat rejects oversize image before readFile is called", async () => {
  const cwd = await tmp();
  let readFileCalled = false;
  const fakeOps: ReadOperations = {
    readFile: async () => {
      readFileCalled = true;
      return ONE_PX_PNG;
    },
    readText: async () => { throw new Error("not text"); },
    access: async () => {},
    statFile: async () => ({ size: 99_999_999 }),
    detectImageMimeType: async () => "image/png",
  };
  try {
    const tool = createReadTool(cwd, { operations: fakeOps, maxImageBytes: 100 });
    const r = await tool.execute({ path: "remote.png" }, ctx());
    assert.ok(r.error);
    assert.equal(readFileCalled, false);
    assert.equal(imageData(r), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("spoofed extension with PNG magic bytes still uses image path", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "not-really.txt"), ONE_PX_PNG);
    const tool = createReadTool(cwd);
    const r = await tool.execute({ path: "not-really.txt" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.content?.[1]?.type, "image");
    assert.equal(image(r)?.mimeType, "image/png");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("transformImage callback runs and marks resized metadata", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "px.png"), ONE_PX_PNG);
    const transformed = Buffer.from("smaller");
    const tool = createReadTool(cwd, {
      transformImage: async ({ buffer, mimeType }) => {
        assert.equal(mimeType, "image/png");
        assert.equal(buffer.equals(ONE_PX_PNG), true);
        return transformed;
      },
    });
    const r = await tool.execute({ path: "px.png" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(imageData(r), transformed.toString("base64"));
    assert.equal(image(r)?.resized, true);
    assert.equal(image(r)?.bytes, transformed.length);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("transformImage failure → error result without image content", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "px.png"), ONE_PX_PNG);
    const tool = createReadTool(cwd, {
      transformImage: async () => {
        throw new Error("resize failed");
      },
    });
    const r = await tool.execute({ path: "px.png" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /resize failed/);
    assert.equal(imageData(r), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("transformed image over maxImageBytes → error result", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "px.png"), ONE_PX_PNG);
    const inflated = Buffer.alloc(ONE_PX_PNG.length + 100);
    const tool = createReadTool(cwd, {
      maxImageBytes: ONE_PX_PNG.length,
      transformImage: async () => inflated,
    });
    const r = await tool.execute({ path: "px.png" }, ctx());
    assert.ok(r.error);
    assert.match(r.error!.message, /Transformed image/i);
    assert.equal(imageData(r), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("autoResizeImages without transformImage is ignored (deprecated no-op)", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "px.png"), ONE_PX_PNG);
    const tool = createReadTool(cwd, { autoResizeImages: true });
    const r = await tool.execute({ path: "px.png" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(imageData(r), ONE_PX_PNG.toString("base64"));
    assert.equal(image(r)?.resized, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("streamed text pages stay bounded for sparse and distant-offset files", async () => {
  const cwd = await tmp();
  try {
    const sparse = join(cwd, "sparse.txt");
    await writeFile(sparse, "first\nsecond\n");
    await truncate(sparse, 4 * 1024 * 1024 * 1024);
    const first = await createReadTool(cwd).execute({ path: sparse, limit: 1 }, ctx());
    assert.equal(first.error, undefined);
    assert.match(textOf(first), /^first\n\n\[Showing lines 1-1/);
    assert.ok((first.metadata?.scannedBytes as number) <= 64 * 1024);

    const lines = Array.from({ length: 50_000 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(join(cwd, "distant.txt"), lines);
    const distant = await createReadTool(cwd, { maxScanBytes: 1024 * 1024 }).execute(
      { path: "distant.txt", offset: 49_999, limit: 1 },
      ctx(),
    );
    assert.equal(distant.error, undefined);
    assert.match(textOf(distant), /^line-49999/);
    assert.ok((distant.metadata?.scannedBytes as number) <= 1024 * 1024);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("text scan limit and custom backend over-return fail bounded", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "long.txt"), "x".repeat(4096));
    const limited = await createReadTool(cwd, { maxScanBytes: 1024, maxBytes: 100 }).execute(
      { path: "long.txt", offset: 2 },
      ctx(),
    );
    assert.match(limited.error?.message ?? "", /scan limit/);

    const operations: ReadOperations = {
      access: async () => {},
      statFile: async () => ({ size: 1 }),
      readFile: async () => Buffer.alloc(0),
      detectImageMimeType: async () => null,
      readText: async (path, options) => ({
        content: "x".repeat(options.maxBytes + 1),
        startLine: options.offset,
        outputLines: 1,
        hasMore: false,
        truncatedBy: null,
        firstLineExceedsLimit: false,
        scannedBytes: options.maxBytes + 1,
      }),
    };
    const hostile = await createReadTool(cwd, { operations, maxBytes: 10 }).execute({ path: "remote" }, ctx());
    assert.match(hostile.error?.message ?? "", /beyond the requested bounds/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("read options and request pagination reject invalid limits", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "page.txt"), "a\nb");
    const tool = createReadTool(cwd);
    const invalidPages: JsonObject[] = [
      { path: "page.txt", offset: 0 },
      { path: "page.txt", offset: Infinity },
      { path: "page.txt", limit: -1 },
      { path: "page.txt", limit: 100_001 },
    ];
    for (const args of invalidPages) {
      const result = await tool.execute(args, ctx());
      assert.match(result.error?.message ?? "", /positive safe integer/);
    }
    for (const options of [
      { maxLines: Infinity },
      { maxBytes: 0 },
      { maxImageBytes: 32 * 1024 * 1024 + 1 },
      { maxScanBytes: 1024 * 1024 * 1024 + 1 },
    ]) {
      assert.throws(() => createReadTool(cwd, options), /positive safe integer/);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("DEFAULT_MAX_IMAGE_BYTES is 10 MB", () => {
  assert.equal(DEFAULT_MAX_IMAGE_BYTES, 10_000_000);
});
