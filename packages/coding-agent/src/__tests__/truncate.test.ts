import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateLine,
  truncateTail,
} from "../truncate.js";

test("formatSize: B / KB / MB boundaries", () => {
  assert.equal(formatSize(0), "0B");
  assert.equal(formatSize(1023), "1023B");
  assert.equal(formatSize(1024), "1.0KB");
  assert.equal(formatSize(50 * 1024), "50.0KB");
  assert.equal(formatSize(1024 * 1024), "1.0MB");
});

test("truncateHead: under both limits → not truncated, exact counts", () => {
  const content = "a\nbb\nccc";
  const r = truncateHead(content);
  assert.equal(r.truncated, false);
  assert.equal(r.truncatedBy, null);
  assert.equal(r.totalLines, 3);
  assert.equal(r.outputLines, 3);
  assert.equal(r.totalBytes, Buffer.byteLength(content, "utf-8"));
  assert.equal(r.outputBytes, r.totalBytes);
  assert.equal(r.content, content);
  assert.equal(r.firstLineExceedsLimit, false);
  assert.equal(r.lastLinePartial, false);
});

test("truncateTail: under both limits → not truncated", () => {
  const content = "x\ny";
  const r = truncateTail(content);
  assert.equal(r.truncated, false);
  assert.equal(r.truncatedBy, null);
  assert.equal(r.totalLines, 2);
  assert.equal(r.content, content);
});

test("truncateHead: line limit keeps first N complete lines", () => {
  const content = "l1\nl2\nl3\nl4\nl5";
  const r = truncateHead(content, { maxLines: 2, maxBytes: DEFAULT_MAX_BYTES });
  assert.equal(r.truncated, true);
  assert.equal(r.truncatedBy, "lines");
  assert.equal(r.outputLines, 2);
  assert.equal(r.content, "l1\nl2");
  assert.equal(r.firstLineExceedsLimit, false);
});

test("truncateHead: byte limit stops mid-way → truncatedBy bytes", () => {
  const content = "aaaa\nbbbb\ncccc"; // each line 4 bytes (+1 newline for joined)
  const r = truncateHead(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: 6 });
  assert.equal(r.truncated, true);
  assert.equal(r.truncatedBy, "bytes");
  // first line (4 bytes) fits; second line (1+4=5 → 4+5=9 > 6) does not
  assert.equal(r.outputLines, 1);
  assert.equal(r.content, "aaaa");
});

test("truncateHead: first line alone exceeds byte limit → empty, flagged", () => {
  const content = "toolongline\nshort";
  const r = truncateHead(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: 3 });
  assert.equal(r.truncated, true);
  assert.equal(r.truncatedBy, "bytes");
  assert.equal(r.content, "");
  assert.equal(r.outputLines, 0);
  assert.equal(r.firstLineExceedsLimit, true);
});

test("truncateTail: line limit keeps last N lines", () => {
  const content = "l1\nl2\nl3\nl4\nl5";
  const r = truncateTail(content, { maxLines: 2, maxBytes: DEFAULT_MAX_BYTES });
  assert.equal(r.truncated, true);
  assert.equal(r.outputLines, 2);
  assert.equal(r.content, "l4\nl5");
  assert.equal(r.lastLinePartial, false);
});

test("truncateTail: single line exceeds byte limit → partial from end", () => {
  const content = "abcdefghij"; // 10 bytes, one line
  const r = truncateTail(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: 4 });
  assert.equal(r.truncated, true);
  assert.equal(r.lastLinePartial, true);
  assert.equal(r.content, "ghij"); // last 4 bytes
  assert.equal(r.outputBytes, 4);
});

test("truncateTail: byte limit across multiple lines keeps fitting tail", () => {
  const content = "aaaa\nbbbb\ncccc";
  const r = truncateTail(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: 6 });
  assert.equal(r.truncated, true);
  // last line "cccc" (4) fits; adding "bbbb" (4+1+4=9 > 6) does not → only "cccc"
  assert.equal(r.content, "cccc");
});

test("truncateHead: UTF-8 multi-byte chars counted as bytes not chars", () => {
  // "😀" is 4 bytes; 5 emojis = 20 bytes, but as a single line under line limit.
  const content = "😀".repeat(5);
  const r = truncateHead(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: 10 });
  assert.equal(r.truncated, true);
  // first line is 20 bytes > 10 → firstLineExceedsLimit path
  assert.equal(r.firstLineExceedsLimit, true);
  assert.equal(r.content, "");
});

test("truncateTail: UTF-8 partial line lands on character boundary", () => {
  const content = "😀".repeat(10); // 40 bytes, single line
  const r = truncateTail(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: 8 });
  assert.equal(r.lastLinePartial, true);
  // 8 bytes = exactly 2 emojis, no broken continuation bytes
  assert.equal(r.content, "😀😀");
  assert.equal(Buffer.byteLength(r.content, "utf-8"), 8);
});

test("truncateLine: under cap unchanged; over cap gets suffix", () => {
  assert.deepEqual(truncateLine("short", 10), { text: "short", wasTruncated: false });
  const out = truncateLine("a".repeat(20), 10);
  assert.equal(out.wasTruncated, true);
  assert.equal(out.text, "a".repeat(10) + "... [truncated]");
});

test("truncateLine: default cap is 500", () => {
  const ok = truncateLine("a".repeat(500));
  assert.equal(ok.wasTruncated, false);
  const over = truncateLine("a".repeat(501));
  assert.equal(over.wasTruncated, true);
});

test("trailing newline is not counted as an extra line", () => {
  const r = truncateHead("a\nb\n", { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  assert.equal(r.totalLines, 2);
  assert.equal(r.truncated, false);
});

test("defaults exported as documented", () => {
  assert.equal(DEFAULT_MAX_LINES, 2000);
  assert.equal(DEFAULT_MAX_BYTES, 50 * 1024);
});
