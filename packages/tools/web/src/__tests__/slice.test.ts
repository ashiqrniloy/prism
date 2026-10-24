import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  createFetchMemo,
  DEFAULT_FETCH_CHARS,
  fetchParameters,
  fetchSliceArgs,
  fetchSliceText,
  fetchSliceValue,
  HARD_FETCH_CHARS,
  sliceMarkdown,
  truncateUtf8Bytes,
} from "../slice.js";

const args = (offset = 0, maxChars = DEFAULT_FETCH_CHARS) => ({ offset, maxChars });

describe("sliceMarkdown", () => {
  it("returns the requested window with a next offset", () => {
    const page = "a".repeat(DEFAULT_FETCH_CHARS + 8_000);
    const slice = sliceMarkdown(page, args());
    assert.equal(slice.markdown.length, DEFAULT_FETCH_CHARS);
    assert.equal(slice.offset, 0);
    assert.equal(slice.end, DEFAULT_FETCH_CHARS);
    assert.equal(slice.totalChars, page.length);
    assert.equal(slice.truncated, true);
    assert.equal(slice.nextOffset, DEFAULT_FETCH_CHARS);
    const last = sliceMarkdown(page, args(slice.nextOffset!));
    assert.equal(last.markdown.length, 8_000);
    assert.equal(last.truncated, false);
    assert.equal(last.nextOffset, undefined);
  });

  it("prefers a paragraph, then a line break, in the last tenth of the window", () => {
    const page = `${"a".repeat(95)}\n\n${"b".repeat(5_000)}\n${"c".repeat(5_000)}`;
    const window = 100;
    const slice = sliceMarkdown(page, args(0, window));
    assert.equal(slice.markdown.endsWith("\n"), true, "the slice ends on a block boundary");
    assert.equal(slice.end <= window, true);
    assert.equal(page.slice(slice.offset, slice.end), slice.markdown, "paging is contiguous");
    const next = sliceMarkdown(page, args(slice.nextOffset!, window));
    assert.equal(slice.markdown + next.markdown, page.slice(0, next.end), "no characters are skipped");
    // A break far before the last tenth is not worth a short slice.
    const early = sliceMarkdown(`a\n${"b".repeat(10_000)}`, args(0, 1_000));
    assert.equal(early.markdown.length, 1_000);
  });

  it("never splits a surrogate pair", () => {
    const page = `${"a".repeat(9)}😀${"b".repeat(100)}`;
    const slice = sliceMarkdown(page, args(0, 10));
    assert.equal(slice.markdown, "a".repeat(9), "the pair is excluded, not halved");
    assert.equal(slice.nextOffset, 9);
    const pairOnly = sliceMarkdown("😀", args(0, 1));
    assert.equal(pairOnly.markdown, "😀", "a one-character window keeps the pair whole");
  });

  it("rejects a bad window, naming the argument", () => {
    assert.throws(() => fetchSliceArgs({ offset: -1 }), (error: Error) => /offset/.test(error.message));
    assert.throws(() => fetchSliceArgs({ offset: 1.5 }), /offset/);
    assert.throws(() => fetchSliceArgs({ max_chars: 0 }), /max_chars/);
    assert.throws(() => fetchSliceArgs({ max_chars: HARD_FETCH_CHARS + 1 }), /max_chars/);
    assert.throws(() => fetchSliceArgs({ max_chars: "10" }), /max_chars/);
    assert.throws(() => sliceMarkdown("abc", args(3)), /offset/);
    assert.equal(sliceMarkdown("", args(0)).markdown, "", "an empty page has one empty slice");
    assert.equal(sliceMarkdown("", args(0)).truncated, false);
  });

  it("describes the slice and how to continue", () => {
    const page = "a".repeat(100);
    const first = fetchSliceText(sliceMarkdown(page, args(0, 40)));
    assert.match(first, /^Showing characters 0–40 of 100\.\nCall web_fetch again with offset=40 for more\.\n\na{40}$/);
    const last = fetchSliceText(sliceMarkdown(page, args(80, 40)));
    assert.match(last, /^Showing characters 80–100 of 100\.\n\na{20}$/);
    const cut = fetchSliceText(sliceMarkdown(page, args(0, 40)), true);
    assert.match(cut, /cut at 100 characters/);
  });

  it("keeps the citation fields and replaces the page body with the slice", () => {
    const page = { citationId: "web:firecrawl:x", provider: "firecrawl" as const, url: "https://example.com/", markdown: "page", untrusted: true as const };
    const value = fetchSliceValue(page, sliceMarkdown("0123456789", args(2, 3)));
    assert.equal(value.citationId, "web:firecrawl:x");
    assert.equal(value.url, "https://example.com/");
    assert.equal(value.markdown, "234");
    assert.equal(value.offset, 2);
    assert.equal(value.totalChars, 10);
    assert.equal(value.truncated, true);
    assert.equal(value.nextOffset, 5);
  });

  it("declares the slice window in the tool schema", () => {
    const schema = fetchParameters();
    assert.deepEqual(Object.keys(schema.properties as object).sort(), ["max_chars", "offset", "url"]);
    assert.deepEqual((schema.properties as Record<string, { default?: number }>).max_chars.default, DEFAULT_FETCH_CHARS);
  });
});

describe("truncateUtf8Bytes", () => {
  it("cuts on a code point boundary", () => {
    assert.equal(truncateUtf8Bytes("0123456789", 4), "0123");
    assert.equal(truncateUtf8Bytes("aé", 2), "a", "two-byte é does not fit whole");
    assert.equal(truncateUtf8Bytes("aé", 3), "aé");
    assert.equal(truncateUtf8Bytes("😀", 3), "", "a partial surrogate pair is dropped");
    assert.equal(truncateUtf8Bytes("short", 10), "short");
  });
});

describe("createFetchMemo", () => {
  it("keys by session and URL, bounds entries, and expires after ten minutes", () => {
    let now = 0;
    const memo = createFetchMemo<{ page: string }>(() => now);
    memo.set("s1", "https://a", { page: "A" });
    assert.equal(memo.get("s1", "https://a")?.page, "A");
    assert.equal(memo.get("s2", "https://a"), undefined, "another session never reads it");
    now = 10 * 60_000;
    assert.equal(memo.get("s1", "https://a")?.page, "A", "the last ten minutes still count");
    now += 1;
    assert.equal(memo.get("s1", "https://a"), undefined, "an older page is refetched");
    for (let i = 0; i < 10; i++) memo.set("s1", `https://${i}`, { page: String(i) });
    assert.equal(memo.get("s1", "https://10"), undefined);
    assert.equal(memo.get("s1", "https://0"), undefined, "the oldest entry is evicted first");
    assert.equal(memo.get("s1", "https://9")?.page, "9");
  });
});
