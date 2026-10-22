import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateChangedLinePreview,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../edit-diff.js";

test("detectLineEnding / normalizeToLF / restoreLineEndings", () => {
  assert.equal(detectLineEnding("a\nb"), "\n");
  assert.equal(detectLineEnding("a\r\nb"), "\r\n");
  assert.equal(detectLineEnding("no newlines"), "\n");
  assert.equal(normalizeToLF("a\r\nb\rc"), "a\nb\nc");
  assert.equal(restoreLineEndings("a\nb", "\r\n"), "a\r\nb");
  assert.equal(restoreLineEndings("a\nb", "\n"), "a\nb");
});

test("stripBom: removes BOM and returns it", () => {
  assert.deepEqual(stripBom("\uFEFFhello"), { bom: "\uFEFF", text: "hello" });
  assert.deepEqual(stripBom("hello"), { bom: "", text: "hello" });
});

test("applyEditsToNormalizedContent: a unicode variant fails instead of editing", () => {
  // The file has smart quotes and an en-dash; an ASCII oldText is not found and nothing is written.
  const content = "const s = \u201Cvalue\u201D; // a\u2013b\n";
  assert.throws(
    () => applyEditsToNormalizedContent(content, [{ oldText: 'const s = "value";', newText: "x" }], "f"),
    /Could not find the exact text in f/,
  );
});

test("applyEditsToNormalizedContent: single exact edit", () => {
  const { baseContent, newContent } = applyEditsToNormalizedContent("a\nb\nc", [{ oldText: "b", newText: "B" }], "f");
  assert.equal(baseContent, "a\nb\nc");
  assert.equal(newContent, "a\nB\nc");
});

test("applyEditsToNormalizedContent: multiple disjoint edits, stable offsets", () => {
  const { newContent } = applyEditsToNormalizedContent(
    "one\ntwo\nthree",
    [
      { oldText: "one", newText: "ONE" },
      { oldText: "three", newText: "THREE" },
    ],
    "f",
  );
  assert.equal(newContent, "ONE\ntwo\nTHREE");
});

test("applyEditsToNormalizedContent: exact edit preserves unchanged line bytes", () => {
  const original = "keep   \nchange me\nkeep   ";
  const { newContent } = applyEditsToNormalizedContent(original, [{ oldText: "change me", newText: "changed" }], "f");
  assert.equal(newContent, "keep   \nchanged\nkeep   ");
});

test("applyEditsToNormalizedContent: empty oldText throws", () => {
  assert.throws(() => applyEditsToNormalizedContent("a", [{ oldText: "", newText: "b" }], "f"), /oldText must not be empty/);
});

test("applyEditsToNormalizedContent: not found throws", () => {
  assert.throws(() => applyEditsToNormalizedContent("a\nb", [{ oldText: "zzz", newText: "y" }], "f"), /Could not find the exact text in f/);
});

test("applyEditsToNormalizedContent: duplicate match throws", () => {
  assert.throws(() => applyEditsToNormalizedContent("x\nx", [{ oldText: "x", newText: "y" }], "f"), /Found 2 occurrences/);
});

test("applyEditsToNormalizedContent: overlapping edits throw", () => {
  assert.throws(
    () =>
      applyEditsToNormalizedContent(
        "abcdef",
        [
          { oldText: "abcd", newText: "X" },
          { oldText: "cdef", newText: "Y" },
        ],
        "f",
      ),
    /overlap/,
  );
});

test("applyEditsToNormalizedContent: identical replacement throws no-change", () => {
  assert.throws(() => applyEditsToNormalizedContent("a\nb", [{ oldText: "b", newText: "b" }], "f"), /No changes made/);
});

test("generateUnifiedPatch: header-only (no Index/underline), starts with file headers", () => {
  const patch = generateUnifiedPatch("f", "a\nb\n", "a\nB\n");
  assert.ok(patch.startsWith("--- f"), `patch should start with --- f, got: ${patch.slice(0, 20)}`);
  assert.ok(/^\+\+\+ f/m.test(patch));
  assert.ok(!patch.includes("Index:"), "FILE_HEADERS_ONLY must omit Index:");
  assert.ok(!patch.includes("==="), "FILE_HEADERS_ONLY must omit the === underline");
});

test("generateDiffString: returns diff and first changed line", () => {
  const { diff, firstChangedLine } = generateDiffString("a\nb\nc", "a\nB\nc");
  assert.ok(diff.length > 0);
  assert.equal(firstChangedLine, 2); // line 2 changed in new file
  assert.ok(diff.includes("+2 B"));
  assert.ok(diff.includes("-2 b"));
});

test("generateChangedLinePreview: read-style numbers with two lines of context", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const preview = generateChangedLinePreview(before, before.replace("line 20", "LINE 20"));
  assert.equal(preview.more, 0);
  assert.equal(preview.text, ["18\tline 18", "19\tline 19", "20\tLINE 20", "21\tline 21", "22\tline 22"].join("\n"));
});

test("generateChangedLinePreview: distant changes get one window each", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const after = before.replace("line 3", "LINE 3").replace("line 28", "LINE 28");
  const preview = generateChangedLinePreview(before, after);
  assert.deepEqual(preview.text.split("\n"), [
    "1\tline 1",
    "2\tline 2",
    "3\tLINE 3",
    "4\tline 4",
    "5\tline 5",
    "26\tline 26",
    "27\tline 27",
    "28\tLINE 28",
    "29\tline 29",
    "30\tline 30",
  ]);
  assert.equal(preview.more, 0);
});

test("generateChangedLinePreview: caps at 40 lines and counts the changed lines it dropped", () => {
  const before = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
  const after = before.replace(/line (\d+)/g, "LINE $1");
  const preview = generateChangedLinePreview(before, after);
  assert.equal(preview.text.split("\n").length, 40);
  assert.equal(preview.more, 60);
  const small = generateChangedLinePreview(before, after, 2, 10);
  assert.equal(small.text.split("\n").length, 10);
  assert.equal(small.more, 90);
});

test("applyEditsToNormalizedContent: no-match error includes Nearby snippets when a similar line exists", () => {
  // oldText diverges from the file AFTER the first 16 chars, so the clipped needle is a shared prefix
  const content = "function createEditTool(opts) {\nother\nfunction createEditTool(config) {\nrest";
  assert.throws(
    () => applyEditsToNormalizedContent(content, [{ oldText: "function createEditTool(ARGS) {", newText: "z" }], "src/a.ts"),
    (err: Error) =>
      /Could not find the exact text in src\/a\.ts/.test(err.message) &&
      /Nearby:/.test(err.message) &&
      /L1: function createEditTool\(opts\) \{/.test(err.message) &&
      /L3: function createEditTool\(config\) \{/.test(err.message),
  );
});

test("applyEditsToNormalizedContent: no-match with no similar line keeps the plain sentence", () => {
  assert.throws(
    () => applyEditsToNormalizedContent("alpha\nbeta\n", [{ oldText: "zzz unrelated", newText: "y" }], "f"),
    (err: Error) => /Could not find the exact text in f/.test(err.message) && !/Nearby:/.test(err.message),
  );
});

test("applyEditsToNormalizedContent: no-match needle shorter than 4 chars keeps the plain sentence", () => {
  // first line "ab" trims to 2 chars < 4 → no Nearby
  assert.throws(
    () => applyEditsToNormalizedContent("ab\nab\n", [{ oldText: "ab\nmore", newText: "y" }], "f"),
    (err: Error) => !/Nearby:/.test(err.message),
  );
});
