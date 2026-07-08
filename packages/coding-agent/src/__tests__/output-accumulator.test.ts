import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutputAccumulator } from "../output-accumulator.js";

test("small output: snapshot returns full content, not truncated", () => {
  const acc = new OutputAccumulator();
  acc.append(Buffer.from("hello\n", "utf-8"));
  acc.finish();
  const snap = acc.snapshot();
  assert.equal(snap.content, "hello\n");
  assert.equal(snap.truncation.truncated, false);
  assert.equal(snap.fullOutputPath, undefined);
});

test("finish() is idempotent and append-after-finish throws", () => {
  const acc = new OutputAccumulator();
  acc.finish();
  acc.finish(); // no throw
  assert.throws(() => acc.append(Buffer.from("x")), /Cannot append to a finished/);
});

test("streaming UTF-8 decoder reassembles multibyte char split across chunks", () => {
  // ☃ = U+2603 = E2 98 83. Split across two appends; must decode to "☃" after finish.
  const acc = new OutputAccumulator();
  acc.append(Buffer.from([0xe2]));
  acc.append(Buffer.from([0x98, 0x83]));
  acc.finish();
  assert.equal(acc.snapshot().content, "☃");
});

test("getLastLineBytes tracks open (no-newline) line byte count", () => {
  const acc = new OutputAccumulator();
  acc.append(Buffer.from("hello")); // no newline → open line, 5 bytes
  assert.equal(acc.getLastLineBytes(), 5);
  acc.append(Buffer.from(" world")); // still open, +6
  assert.equal(acc.getLastLineBytes(), 11);
  acc.append(Buffer.from("\n")); // newline closes the line → open line resets to 0
  assert.equal(acc.getLastLineBytes(), 0);
});

test("line truncation: tail snapshot bounded to last N lines", () => {
  const acc = new OutputAccumulator({ maxLines: 2, maxBytes: 10000 });
  acc.append(Buffer.from("line1\nline2\nline3\nline4\n", "utf-8"));
  acc.finish();
  const snap = acc.snapshot();
  assert.equal(snap.truncation.truncated, true);
  assert.equal(snap.truncation.truncatedBy, "lines");
  assert.equal(snap.content, "line3\nline4");
});

test("byte truncation: flagged as bytes when totalDecodedBytes exceeds maxBytes", () => {
  const acc = new OutputAccumulator({ maxBytes: 10, maxLines: 10000 });
  acc.append(Buffer.from("hello world this is a long line\n", "utf-8"));
  acc.finish();
  const snap = acc.snapshot();
  assert.equal(snap.truncation.truncated, true);
  assert.equal(snap.truncation.truncatedBy, "bytes");
});

test("persistIfTruncated spills full output to a readable temp file", async () => {
  const acc = new OutputAccumulator({ maxLines: 2, maxBytes: 10000 });
  acc.append(Buffer.from("line1\nline2\nline3\nline4\n", "utf-8"));
  acc.finish();
  const snap = acc.snapshot({ persistIfTruncated: true });
  assert.ok(snap.fullOutputPath, "expected a temp file path");
  // The write stream opens async, so the host must close (flush) before reading.
  await acc.closeTempFile();
  try {
    const full = await readFile(snap.fullOutputPath!, "utf-8");
    // full file preserves the complete raw output
    assert.equal(full, "line1\nline2\nline3\nline4\n");
    // snapshot content is the bounded tail
    assert.equal(snap.content, "line3\nline4");
  } finally {
    await rm(snap.fullOutputPath!, { force: true });
  }
});

test("tempFilePrefix option names the temp file", async () => {
  const acc = new OutputAccumulator({ maxBytes: 5, maxLines: 10000, tempFilePrefix: "prism-test" });
  acc.append(Buffer.from("aaaaaaaaaaaa", "utf-8")); // >5 bytes → spills to temp file
  acc.finish();
  const snap = acc.snapshot({ persistIfTruncated: true });
  assert.ok(snap.fullOutputPath?.includes("prism-test"));
  await acc.closeTempFile();
  if (snap.fullOutputPath) await rm(snap.fullOutputPath, { force: true });
});

test("rolling tail trims very large output without losing the final tail", () => {
  // maxBytes tiny → maxRollingBytes tiny → trimTail kicks in; tail must still end correctly.
  const acc = new OutputAccumulator({ maxBytes: 4, maxLines: 10000 });
  // many lines so decoded bytes blow past maxRollingBytes (8)
  const payload = "0123456789abcdef\n".repeat(64);
  acc.append(Buffer.from(payload, "utf-8"));
  acc.finish();
  const snap = acc.snapshot({ persistIfTruncated: true });
  assert.equal(snap.truncation.truncated, true);
  // full temp file preserves everything
  assert.ok(snap.fullOutputPath);
  acc.closeTempFile().then(() => {
    if (snap.fullOutputPath) return rm(snap.fullOutputPath, { force: true });
  });
});
