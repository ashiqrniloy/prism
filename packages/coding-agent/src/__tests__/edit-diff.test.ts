import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  fuzzyFindText,
  generateDiffString,
  generateUnifiedPatch,
  normalizeForFuzzyMatch,
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

test("normalizeForFuzzyMatch: trailing ws, quotes, dashes, spaces", () => {
  // trailing whitespace stripped per line
  assert.equal(normalizeForFuzzyMatch("a   \nb  "), "a\nb");
  // smart single/double quotes
  assert.equal(normalizeForFuzzyMatch("\u2018x\u2019 \u201Cy\u201D"), "'x' \"y\"");
  // en-dash / em-dash / minus → hyphen
  assert.equal(normalizeForFuzzyMatch("a\u2013b\u2014c\u2212d"), "a-b-c-d");
  // NBSP / ideographic space → regular space
  assert.equal(normalizeForFuzzyMatch("a\u00A0b\u3000c"), "a b c");
});

test("fuzzyFindText: exact match preferred, usedFuzzyMatch false", () => {
  const r = fuzzyFindText("hello world", "world");
  assert.equal(r.found, true);
  assert.equal(r.usedFuzzyMatch, false);
  assert.equal(r.index, 6);
  assert.equal(r.matchLength, 5);
  assert.equal(r.contentForReplacement, "hello world");
});

test("fuzzyFindText: falls back to fuzzy on unicode dash", () => {
  // en-dash in content, ASCII hyphen in oldText: exact fails, fuzzy normalizes dash→hyphen.
  // (normalizeForFuzzyMatch does NOT collapse multiple internal regular spaces, only
  // trailing-whitespace and unicode-space normalization, so spaces alone won't trigger it.)
  const r = fuzzyFindText("a\u2013b", "a-b");
  assert.equal(r.found, true);
  assert.equal(r.usedFuzzyMatch, true);
  assert.equal(r.matchLength, 3);
  assert.equal(r.contentForReplacement, "a-b");
});

test("fuzzyFindText: not found returns found false", () => {
  const r = fuzzyFindText("abc", "xyz");
  assert.equal(r.found, false);
  assert.equal(r.index, -1);
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

test("applyEditsToNormalizedContent: fuzzy edit preserves unchanged line bytes", () => {
  // Unchanged lines keep their original trailing-space bytes; the en-dash line is
  // matched via fuzzy normalization (hyphen oldText) and rewritten from the normalized base.
  const original = "keep   \nchange\u2013me\nkeep   ";
  const { newContent } = applyEditsToNormalizedContent(
    original,
    [{ oldText: "change-me", newText: "changed" }],
    "f",
  );
  assert.equal(newContent, "keep   \nchanged\nkeep   ");
});

test("applyEditsToNormalizedContent: empty oldText throws", () => {
  assert.throws(
    () => applyEditsToNormalizedContent("a", [{ oldText: "", newText: "b" }], "f"),
    /oldText must not be empty/,
  );
});

test("applyEditsToNormalizedContent: not found throws", () => {
  assert.throws(
    () => applyEditsToNormalizedContent("a\nb", [{ oldText: "zzz", newText: "y" }], "f"),
    /Could not find the exact text in f/,
  );
});

test("applyEditsToNormalizedContent: duplicate match throws", () => {
  assert.throws(
    () => applyEditsToNormalizedContent("x\nx", [{ oldText: "x", newText: "y" }], "f"),
    /Found 2 occurrences/,
  );
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
  assert.throws(
    () => applyEditsToNormalizedContent("a\nb", [{ oldText: "b", newText: "b" }], "f"),
    /No changes made/,
  );
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
